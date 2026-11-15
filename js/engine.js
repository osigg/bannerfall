// Bannerfall engine. Pure, deterministic functions over a plain JSON state.
// Time model: the world stores the last processed game-minute (state.t). Any
// client calls advance(state, Date.now()) to simulate forward in fixed ticks,
// then applies the player's action. Same state + same time = same result, so
// it does not matter whose browser does the catching up.
import { CONFIG, UNITS, BUILDINGS, TECHS, SPELLS, TERRAIN, WALL, HOUSING, RESOURCES } from './data.js';
import { rand, seedFrom } from './rng.js';
import { generateMap, findPath, dist, neighbors, ownedTiles, visibleSet } from './map.js';
import { resolveBattle, armyPower } from './battle.js';

const C = CONFIG;
const COLORS = ['#c0392b', '#2471a3', '#239b56', '#b9770e', '#7d3c98', '#17a589', '#a04000', '#5d6d7e'];
let botBrain = null;
export function registerBotBrain(fn) { botBrain = fn; }

// ------------------------------------------------------------------ setup
export function createGame({ seed = 'bannerfall', players, speed = 1, realNow = Date.now(), seasonDays = C.SEASON_DAYS }) {
  const state = {
    version: 1,
    seed: String(seed),
    rng: seedFrom(seed),
    clock: { anchorReal: realNow, anchorMin: 0, speed },
    t: 0,
    seasonEnd: seasonDays * 24 * 60,
    ended: false,
    players: {},
    tiles: {},
    marches: [],
    sieges: [],
    reports: [],
    nextId: 1,
  };
  players.forEach((p, i) => {
    state.players[p.id] = {
      id: p.id, name: p.name, bot: !!p.bot, color: COLORS[i % COLORS.length],
      res: { ...C.START_RES },
      peasants: C.START_PEASANTS,
      army: { militia: 10 },
      buildings: Object.fromEntries(Object.keys(BUILDINGS).map((b) => [b, 0])),
      techs: {},
      research: [],
      buildQueue: [],
      trainQueues: {},
      doctrine: { auto: !!p.bot, target: 'expand', sendFrac: 0.6, homeGuard: 0.3, retreatAt: 0.35, garrisonFrac: 0.2, minRatio: 1.4, siegeCastles: false },
      stance: 'battle',
      wallHp: 0,
      shieldUntil: 0,
      cooldowns: {},
      effects: { wardUntil: 0, scry: {} },
      seen: {},
      stats: { kills: 0, losses: 0, sacks: 0, tilesTaken: 0 },
    };
    Object.assign(state.players[p.id].buildings, { keep: 1, housing: 1, farm: 1, market: 1, quarry: 1, barracks: 1 });
  });
  generateMap(state, players.map((p) => p.id));
  for (const pid of Object.keys(state.players)) updateSeen(state, pid);
  return state;
}

// ------------------------------------------------------------------ time
export function nowMin(state, realNow = Date.now()) {
  const c = state.clock;
  return c.anchorMin + ((realNow - c.anchorReal) * c.speed) / 60000;
}
export function setSpeed(state, speed, realNow = Date.now()) {
  state.clock = { anchorMin: nowMin(state, realNow), anchorReal: realNow, speed };
}
export function skipTime(state, minutes, realNow = Date.now()) {
  state.clock.anchorMin += minutes;
  return advance(state, realNow);
}
export function advance(state, realNow = Date.now(), maxTicks = Infinity) {
  const target = Math.min(state.seasonEnd, Math.floor(nowMin(state, realNow) / C.TICK_MIN) * C.TICK_MIN);
  let n = 0;
  while (state.t + C.TICK_MIN <= target && n < maxTicks && !state.ended) { tick(state); n++; }
  if (state.t >= state.seasonEnd && !state.ended) endSeason(state);
  return n;
}

// ------------------------------------------------------------------ derived values
export function mods(p) {
  const m = {};
  for (const id of Object.keys(p.techs)) {
    for (const [k, v] of Object.entries(TECHS[id].effects)) m[k] = (m[k] || 0) + v;
  }
  return m;
}
const grow = (base, g, L) => base * Math.pow(g, L - 1);
export function buildCost(b, level) {
  const out = {};
  for (const [r, v] of Object.entries(BUILDINGS[b].cost)) out[r] = Math.round(grow(v, C.BUILD_COST_GROWTH, level));
  return out;
}
export function buildTime(b, level) { return Math.round(grow(BUILDINGS[b].time, C.BUILD_TIME_GROWTH, level)); }
export function storageCap(p) { return Math.round(grow(C.STORAGE_BASE, C.STORAGE_GROWTH, p.buildings.keep)); }
export function popCap(p) {
  const L = p.buildings.housing;
  return Math.round(HOUSING.base + HOUSING.perLevel * L * Math.pow(HOUSING.growth, Math.max(0, L - 1)));
}
export function wallMax(p) {
  const L = p.buildings.walls;
  if (!L) return 0;
  return Math.round(WALL.hpBase * L * Math.pow(WALL.hpGrowth, L - 1) * (1 + (mods(p).wallHp || 0)));
}
export function unitTime(p, type) {
  const u = UNITS[type];
  const L = p.buildings[u.building] || 1;
  return u.time / (1 + 0.08 * (L - 1)) / (1 + (mods(p).trainSpeed || 0));
}
export function visionBonus(p) { return Math.floor((p.buildings.watchtower || 0) / 3) + (mods(p).vision || 0); }

const addUnits = (a, b) => { for (const [t, n] of Object.entries(b)) if (n > 0) a[t] = (a[t] || 0) + n; return a; };
const total = (u) => Object.values(u).reduce((s, n) => s + n, 0);

export function allUnits(state, pid) {
  const u = addUnits({}, state.players[pid].army);
  for (const m of state.marches) if (m.owner === pid) addUnits(u, m.units);
  for (const s of state.sieges) if (s.owner === pid) addUnits(u, s.units);
  for (const t of Object.values(state.tiles)) if (t.owner === pid && !t.capital) addUnits(u, t.garrison);
  for (const q of Object.values(state.players[pid].trainQueues)) for (const it of q) u[it.type] = (u[it.type] || 0) + it.count;
  return u;
}

export function rates(state, pid) {
  const p = state.players[pid], m = mods(p);
  const r = { gold: 0, food: 0, stone: 0, mana: 0 };
  const parts = { buildings: { ...r }, tiles: { ...r }, tax: 0, unitUpkeep: { ...r }, tileUpkeep: 0, peasantFood: 0 };
  let need = 0;
  for (const [b, def] of Object.entries(BUILDINGS)) if (def.econ) need += (p.buildings[b] || 0) * C.LABOR_PER_LEVEL;
  const labor = need ? Math.min(1, p.peasants / need) : 1;
  for (const [b, def] of Object.entries(BUILDINGS)) {
    const L = p.buildings[b] || 0;
    if (!def.prod || !L) continue;
    for (const [res, base] of Object.entries(def.prod)) parts.buildings[res] += base * L * Math.pow(C.PROD_GROWTH, L - 1) * labor;
  }
  const owned = ownedTiles(state, pid);
  for (const k of owned) {
    const t = state.tiles[k];
    if (t.unrestUntil > state.t) continue;
    for (const [res, v] of Object.entries(TERRAIN[t.terrain].yield)) parts.tiles[res] += v;
  }
  const mult = { gold: 1 + (m.goldMult || 0), food: 1 + (m.foodMult || 0), stone: 1 + (m.stoneMult || 0), mana: 1 + (m.manaMult || 0) };
  for (const res of RESOURCES) r[res] = (parts.buildings[res] + parts.tiles[res]) * mult[res];
  parts.tax = p.peasants * C.PEASANT_TAX * (1 + (m.taxMult || 0));
  r.gold += parts.tax;
  const up = 1 + (m.upkeepMult || 0);
  for (const [t, n] of Object.entries(allUnits(state, pid))) {
    for (const [res, v] of Object.entries(UNITS[t].upkeep)) parts.unitUpkeep[res] += n * v * (res === 'food' ? 1 : up);
  }
  parts.peasantFood = p.peasants * C.PEASANT_FOOD;
  parts.tileUpkeep = C.TILE_UPKEEP_K * Math.pow(Math.max(0, owned.length - 1), C.TILE_UPKEEP_P) * (1 + (m.tileUpkeep || 0));
  for (const res of RESOURCES) r[res] -= parts.unitUpkeep[res];
  r.food -= parts.peasantFood;
  r.gold -= parts.tileUpkeep;
  return { net: r, labor, laborNeed: need, parts };
}

// ------------------------------------------------------------------ tick
function tick(state) {
  state.t += C.TICK_MIN;
  const dtH = C.TICK_MIN / 60;
  const hourly = state.t % 60 === 0;
  for (const pid of Object.keys(state.players)) economy(state, pid, dtH);
  for (const pid of Object.keys(state.players)) queues(state, pid);
  const due = state.marches.filter((m) => m.arriveT <= state.t).sort((a, b) => a.arriveT - b.arriveT || a.id - b.id);
  for (const m of due) { state.marches = state.marches.filter((x) => x !== m); arrive(state, m); }
  if (hourly) {
    for (const s of [...state.sieges]) siegeHour(state, s);
    for (const pid of Object.keys(state.players)) {
      const p = state.players[pid];
      if (!state.sieges.some((s) => s.target === pid)) p.wallHp = Math.min(wallMax(p), p.wallHp + wallMax(p) * C.WALL_REPAIR_PER_H);
      updateSeen(state, pid);
      if (p.bot && botBrain) botBrain(state, pid);
    }
  }
  if (state.t % (C.DOCTRINE_EVERY_H * 60) === 0) {
    for (const pid of Object.keys(state.players)) if (state.players[pid].doctrine.auto) runDoctrine(state, pid);
  }
}

function economy(state, pid, dtH) {
  const p = state.players[pid];
  const { net } = rates(state, pid);
  const cap = storageCap(p);
  for (const res of RESOURCES) p.res[res] = Math.min(cap, p.res[res] + net[res] * dtH);
  // Starvation and unpaid troops cause desertion instead of negative stockpiles.
  if (p.res.food < 0) {
    p.res.food = 0;
    p.peasants *= 1 - 0.02 * dtH;
    for (const t of Object.keys(p.army)) p.army[t] *= 1 - 0.02 * dtH;
  }
  if (p.res.gold < 0) {
    p.res.gold = 0;
    for (const t of Object.keys(p.army)) if (t !== 'peasant') p.army[t] *= 1 - 0.02 * dtH;
  }
  for (const res of ['stone', 'mana']) if (p.res[res] < 0) p.res[res] = 0;
  // Logistic peasant growth; soldiers count against housing.
  const pop = p.peasants + total(allUnits(state, pid));
  if (p.res.food > 0 && rates(state, pid).net.food > 0) p.peasants += Math.max(0, C.POP_GROWTH * p.peasants * (1 - pop / popCap(p))) * dtH + 0.5 * dtH * (pop < popCap(p) ? 1 : 0);
  for (const t of Object.keys(p.army)) if (p.army[t] < 0.5) delete p.army[t];
}

function queues(state, pid) {
  const p = state.players[pid], m = mods(p);
  const slots = 1 + (m.buildSlots || 0);
  for (const item of p.buildQueue.slice(0, slots)) item.remaining -= C.TICK_MIN;
  while (p.buildQueue.length && p.buildQueue.slice(0, slots).some((i) => i.remaining <= 0)) {
    const idx = p.buildQueue.findIndex((i, j) => j < slots && i.remaining <= 0);
    const [done] = p.buildQueue.splice(idx, 1);
    p.buildings[done.b] = done.level;
    if (done.b === 'walls') p.wallHp = Math.min(wallMax(p), p.wallHp + (wallMax(p) - p.wallHp) * 0.5 + 1);
    report(state, [pid], `${BUILDINGS[done.b].name} reached level ${done.level}`, []);
  }
  for (const [b, q] of Object.entries(p.trainQueues)) {
    if (!q.length) continue;
    const it = q[0];
    it.progress += C.TICK_MIN;
    const ut = unitTime(p, it.type);
    while (it.count > 0 && it.progress >= ut) { it.progress -= ut; it.count--; p.army[it.type] = (p.army[it.type] || 0) + 1; }
    if (it.count <= 0) { q.shift(); if (q[0]) q[0].progress += it.progress; }
  }
  if (p.research.length) {
    const r = p.research[0];
    r.remaining -= C.TICK_MIN;
    if (r.remaining <= 0) {
      p.research.shift();
      p.techs[r.id] = true;
      report(state, [pid], `Research complete: ${TECHS[r.id].name}`, []);
    }
  }
}

// ------------------------------------------------------------------ combat flow
function supply(state, pid, tileKey) {
  const p = state.players[pid];
  const d = dist(p.capital, tileKey);
  const pen = C.SUPPLY_PENALTY * (1 - (mods(p).supply || 0));
  return Math.max(C.SUPPLY_FLOOR, 1 - pen * Math.max(0, d - C.SUPPLY_FREE_RANGE));
}

function sendHome(state, pid, fromKey, units) {
  if (total(units) <= 0) return;
  const p = state.players[pid];
  const path = findPath(state, fromKey, p.capital);
  const speed = marchSpeed(p, units);
  const cost = path ? path.cost : dist(fromKey, p.capital);
  state.marches.push({ id: state.nextId++, owner: pid, units, from: fromKey, to: p.capital, path: path ? path.path : [fromKey, p.capital],
    departT: state.t, arriveT: state.t + Math.ceil((cost / speed) * 60), mission: 'return' });
}

export function marchSpeed(p, units) {
  const s = Math.min(...Object.keys(units).filter((t) => units[t] > 0).map((t) => UNITS[t].speed));
  return s * (1 + (mods(p).marchSpeed || 0));
}

function splitGarrison(units, frac) {
  const g = {}, rest = {};
  for (const [t, n] of Object.entries(units)) {
    if (UNITS[t].tags.includes('siege')) { rest[t] = n; continue; }
    const k = Math.round(n * frac);
    if (k) g[t] = k;
    if (n - k) rest[t] = n - k;
  }
  if (!total(g)) { // always leave at least one body behind
    const t = Object.keys(rest).find((x) => !UNITS[x].tags.includes('siege'));
    if (t) { g[t] = 1; rest[t]--; if (!rest[t]) delete rest[t]; }
  }
  return { g, rest };
}

function arrive(state, m) {
  const tile = state.tiles[m.to];
  const p = state.players[m.owner];
  if (m.mission === 'return' || tile.owner === m.owner) {
    if (tile.capital === m.owner || m.mission === 'return') addUnits(p.army, m.units);
    else addUnits(tile.garrison, m.units);
    return;
  }
  if (tile.capital) {
    const def = state.players[tile.capital];
    if (def.shieldUntil > state.t) {
      report(state, [m.owner], `Your army reached ${def.name}'s castle, which is still recovering from a sack. They turn back.`, []);
      return sendHome(state, m.owner, m.to, m.units);
    }
    const existing = state.sieges.find((s) => s.owner === m.owner && s.tile === m.to);
    if (existing) { addUnits(existing.units, m.units); return; }
    const setupH = Math.max(0, ...Object.keys(m.units).map((t) => UNITS[t].setupH || 0));
    state.sieges.push({ id: state.nextId++, owner: m.owner, target: tile.capital, tile: m.to, units: m.units, startT: state.t,
      setupDoneT: state.t + setupH * 60, assaultAt: state.t + C.SIEGE_ASSAULT_AFTER_H * 60, stance: m.stance || p.stance,
      retreatAt: m.retreatAt ?? p.doctrine.retreatAt });
    report(state, [m.owner, tile.capital], `${p.name} has laid siege to ${def.name}'s castle!`,
      [`Walls: ${Math.round(def.wallHp)}/${wallMax(def)}. Auto-assault in ${C.SIEGE_ASSAULT_AFTER_H}h unless the walls fall first.`]);
    return;
  }
  // Field battle for a tile (neutral or enemy-held).
  const defOwner = tile.owner;
  const defP = defOwner ? state.players[defOwner] : null;
  const result = resolveBattle(
    { units: m.units, mods: mods(p), stance: m.stance || p.stance, retreatAt: m.retreatAt ?? p.doctrine.retreatAt, supply: supply(state, m.owner, m.to) },
    { units: tile.garrison, mods: defP ? mods(defP) : {}, stance: defP ? defP.stance : 'battle', retreatAt: defP ? 0.25 : 0.2 },
    { terrainDef: TERRAIN[tile.terrain].def, wallUp: false, isCastle: false }, state);
  tally(state, m.owner, defOwner, result);
  const where = `${TERRAIN[tile.terrain].name} (${m.to})`;
  if (result.winner === 'att') {
    tile.owner = m.owner;
    tile.unrestUntil = state.t + C.TILE_UNREST_H * 60;
    const { g, rest } = splitGarrison(result.att, p.doctrine.garrisonFrac);
    tile.garrison = g;
    p.stats.tilesTaken++;
    sendHome(state, m.owner, m.to, rest);
    report(state, [m.owner, defOwner].filter(Boolean), `${p.name} captured ${where}${defP ? ` from ${defP.name}` : ''}`, battleLines(result));
  } else {
    tile.garrison = result.def;
    sendHome(state, m.owner, m.to, result.att);
    report(state, [m.owner, defOwner].filter(Boolean), `${p.name}'s attack on ${where} was repulsed`, battleLines(result));
  }
}

function tally(state, attId, defId, r) {
  const a = state.players[attId], d = defId ? state.players[defId] : null;
  a.stats.kills += total(r.defLoss); a.stats.losses += total(r.attLoss);
  if (d) { d.stats.kills += total(r.attLoss); d.stats.losses += total(r.defLoss); }
}

function battleLines(r) {
  const fmt = (u) => Object.entries(u).map(([t, n]) => `${n} ${UNITS[t].name}`).join(', ') || 'none';
  return [...r.log, `Attacker lost: ${fmt(r.attLoss)}`, `Defender lost: ${fmt(r.defLoss)}`];
}

function siegeHour(state, s) {
  const att = state.players[s.owner], def = state.players[s.target], dm = mods(def);
  // Siege engines pound the walls.
  let sd = 0;
  for (const [t, n] of Object.entries(s.units)) {
    const u = UNITS[t];
    if (!u.siege) continue;
    if (u.setupH && state.t < s.setupDoneT) continue;
    sd += n * u.siege;
  }
  sd *= 1 + (dm.siegeTaken || 0);
  if (def.effects.wardUntil > state.t) sd *= 0.5;
  def.wallHp = Math.max(0, def.wallHp - sd);
  // Towers and ballistas on the wall shoot back while the walls stand.
  if (def.wallHp > 0) {
    let shots = WALL.towerDmg * def.buildings.walls * (1 + (dm.towerDmg || 0)) + (def.army.ballista || 0) * UNITS.ballista.atk * 0.5
      + (def.army.archer || 0) * UNITS.archer.atk * 0.25 + (def.army.crossbow || 0) * UNITS.crossbow.atk * 0.25;
    const hp = Object.entries(s.units).reduce((a, [t, n]) => a + n * UNITS[t].hp, 0);
    for (const [t, n] of Object.entries(s.units)) {
      const share = (n * UNITS[t].hp) / hp;
      const lost = (shots * share) / UNITS[t].hp;
      s.units[t] = Math.max(0, n - lost);
    }
  }
  for (const t of Object.keys(s.units)) if (s.units[t] < 0.5) delete s.units[t];
  if (!total(s.units)) {
    state.sieges = state.sieges.filter((x) => x !== s);
    report(state, [s.owner, s.target], `The siege of ${def.name}'s castle collapsed under tower fire`, []);
    return;
  }
  for (const t of Object.keys(s.units)) s.units[t] = Math.round(s.units[t] * 1000) / 1000;
  if (def.wallHp <= 0 || state.t >= s.assaultAt || s.assaultNow) assault(state, s);
}

function assault(state, s) {
  const att = state.players[s.owner], def = state.players[s.target];
  state.sieges = state.sieges.filter((x) => x !== s);
  const wallUp = def.wallHp > 0;
  const result = resolveBattle(
    { units: s.units, mods: mods(att), stance: s.stance, retreatAt: s.retreatAt, supply: supply(state, s.owner, s.tile) },
    { units: def.army, mods: mods(def), stance: def.stance, retreatAt: 0.1 },
    { terrainDef: 0, wallUp, isCastle: true }, state);
  tally(state, s.owner, s.target, result);
  def.army = result.def;
  const lines = battleLines(result);
  if (result.winner === 'att') {
    const loot = {};
    for (const r of RESOURCES) { loot[r] = Math.floor(def.res[r] * C.SACK_LOOT); def.res[r] -= loot[r]; att.res[r] += loot[r]; }
    def.shieldUntil = state.t + C.SACK_SHIELD_H * 60;
    att.stats.sacks++;
    // The two defender tiles closest to the attacker defect.
    const lost = ownedTiles(state, s.target).filter((k) => !state.tiles[k].capital)
      .sort((a, b) => dist(a, att.capital) - dist(b, att.capital)).slice(0, 2);
    for (const k of lost) { state.tiles[k].owner = s.owner; state.tiles[k].garrison = {}; state.tiles[k].unrestUntil = state.t + C.TILE_UNREST_H * 60; }
    lines.push(`Loot: ${Object.entries(loot).map(([r, v]) => `${v} ${r}`).join(', ')}`, `Tiles defected: ${lost.length}`);
    report(state, [s.owner, s.target], `${att.name} SACKED ${def.name}'s castle!`, lines);
  } else {
    report(state, [s.owner, s.target], `${def.name} held the castle against ${att.name}'s assault`, lines);
  }
  sendHome(state, s.owner, s.tile, result.att);
}

// ------------------------------------------------------------------ doctrine (standing orders)
function runDoctrine(state, pid) {
  const p = state.players[pid], d = p.doctrine;
  if (state.marches.filter((m) => m.owner === pid && m.mission !== 'return').length >= 2) return;
  const avail = {};
  for (const [t, n] of Object.entries(p.army)) {
    if (t === 'peasant') continue;
    const k = Math.floor(n * (1 - d.homeGuard) * d.sendFrac);
    if (k > 0) avail[t] = k;
  }
  if (total(avail) < 5) return;
  const myPower = armyPower(avail, mods(p));
  const owned = new Set(ownedTiles(state, pid));
  const frontier = new Set();
  for (const k of owned) for (const n of neighbors(state, k)) if (!owned.has(n) && state.tiles[n].terrain !== 'mountain') frontier.add(n);
  const vis = visibleSet(state, pid, visionBonus(p));
  let best = null;
  for (const k of frontier) {
    const t = state.tiles[k];
    if (state.marches.some((m) => m.owner === pid && m.to === k)) continue;
    if (d.target === 'expand' && t.owner) continue;
    if (d.target !== 'expand' && d.target !== 'any' && t.owner !== d.target && t.owner) continue;
    if (t.capital && !d.siegeCastles) continue;
    if (t.capital && state.players[t.capital].shieldUntil > state.t) continue;
    const theirs = t.capital ? armyPower(state.players[t.capital].army) * 2 + wallMax(state.players[t.capital]) / 20
      : armyPower(t.garrison, t.owner ? mods(state.players[t.owner]) : {}) * (1 + TERRAIN[t.terrain].def);
    const known = vis.has(k) ? theirs : theirs * 1.5;
    const ours = myPower * supply(state, pid, k);
    if (ours < d.minRatio * known) continue;
    const value = Object.values(TERRAIN[t.terrain].yield).reduce((a, b) => a + b, 0) + (t.owner ? 4 : 0) + (t.capital ? 20 : 0);
    const score = value / (1 + known) - dist(p.capital, k) * 0.01;
    if (!best || score > best.score) best = { k, score };
  }
  if (best) {
    try { sendArmy(state, pid, best.k, avail, { auto: true }); } catch { /* path blocked etc. */ }
  }
}

// ------------------------------------------------------------------ visibility
function updateSeen(state, pid) {
  const p = state.players[pid];
  for (const k of visibleSet(state, pid, visionBonus(p))) p.seen[k] = 1;
}
export function canSee(state, pid, k) {
  return visibleSet(state, pid, visionBonus(state.players[pid])).has(k);
}

// Marches heading into the player's land, with what they are allowed to know.
export function incoming(state, pid) {
  const p = state.players[pid];
  return state.marches.filter((m) => m.owner !== pid && m.mission !== 'return' && state.tiles[m.to].owner === pid)
    .map((m) => ({ id: m.id, from: state.players[m.owner].name, to: m.to, eta: m.arriveT - state.t,
      units: p.buildings.watchtower >= 3 ? m.units : null, size: p.buildings.watchtower >= 1 ? total(m.units) : null, hexed: !!m.hexed }));
}

// ------------------------------------------------------------------ reports & scoring
function report(state, to, title, lines) {
  state.reports.push({ t: state.t, to, title, lines });
  if (state.reports.length > 400) state.reports.splice(0, state.reports.length - 400);
}

export function score(state, pid) {
  const p = state.players[pid];
  const tiles = ownedTiles(state, pid).length;
  const lv = Object.values(p.buildings).reduce((a, b) => a + b, 0);
  return tiles * 10 + lv + Object.keys(p.techs).length * 3 + p.stats.sacks * 25 + Math.floor(p.stats.kills / 50);
}

function endSeason(state) {
  state.ended = true;
  const ranking = Object.keys(state.players).map((pid) => ({ pid, score: score(state, pid) })).sort((a, b) => b.score - a.score);
  state.final = ranking;
  report(state, Object.keys(state.players), `Season over! ${state.players[ranking[0].pid].name} wins with ${ranking[0].score} points`,
    ranking.map((r, i) => `${i + 1}. ${state.players[r.pid].name}: ${r.score}`));
}

// ------------------------------------------------------------------ player actions
function pay(p, cost) {
  for (const [r, v] of Object.entries(cost)) if ((p.res[r] || 0) < v) throw new Error(`Not enough ${r} (need ${v}, have ${Math.floor(p.res[r] || 0)})`);
  for (const [r, v] of Object.entries(cost)) p.res[r] -= v;
}
const scale = (cost, n) => Object.fromEntries(Object.entries(cost).map(([r, v]) => [r, v * n]));

export function queuedLevel(p, b) {
  return Math.max(p.buildings[b], ...p.buildQueue.filter((i) => i.b === b).map((i) => i.level));
}

export function maxLevel(p, b) {
  return b === 'keep' ? BUILDINGS.keep.max : Math.min(C.BUILDING_MAX, queuedLevel(p, 'keep') + C.KEEP_LEAD);
}

export function build(state, pid, b) {
  const p = state.players[pid];
  if (!BUILDINGS[b]) throw new Error('Unknown building');
  if (p.buildQueue.length >= 5) throw new Error('Build queue is full (5)');
  const level = queuedLevel(p, b) + 1;
  const max = maxLevel(p, b);
  if (level > max) throw new Error(b === 'keep' ? 'Keep is maxed' : `Upgrade your Keep first (level ${level} needs Keep ${level - C.KEEP_LEAD})`);
  pay(p, buildCost(b, level));
  p.buildQueue.push({ b, level, remaining: buildTime(b, level) });
}

export function cancelBuild(state, pid, index) {
  const p = state.players[pid];
  const [it] = p.buildQueue.splice(index, 1);
  if (!it) return;
  if (p.buildQueue.some((x) => x.b === it.b && x.level > it.level)) { p.buildQueue.splice(index, 0, it); throw new Error('Cancel the higher level first'); }
  for (const [r, v] of Object.entries(buildCost(it.b, it.level))) p.res[r] += Math.floor(v * 0.75);
}

export function canTrain(p, type) {
  const u = UNITS[type];
  if (!u.building) return 'Drafted, not trained';
  if ((p.buildings[u.building] || 0) < u.unlock) return `Needs ${BUILDINGS[u.building].name} ${u.unlock}`;
  for (const [b, l] of Object.entries(u.needs || {})) if ((p.buildings[b] || 0) < l) return `Needs ${BUILDINGS[b].name} ${l}`;
  if (u.tech && !p.techs[u.tech]) return `Needs ${TECHS[u.tech].name}`;
  return null;
}

export function train(state, pid, type, count) {
  const p = state.players[pid];
  count = Math.floor(count);
  if (!UNITS[type] || count < 1) throw new Error('Bad unit or count');
  const why = canTrain(p, type);
  if (why) throw new Error(why);
  if (p.peasants < count) throw new Error(`Only ${Math.floor(p.peasants)} peasants available to train`);
  pay(p, scale(UNITS[type].cost, count));
  p.peasants -= count;
  const q = (p.trainQueues[UNITS[type].building] ||= []);
  q.push({ type, count, progress: 0 });
}

export function draft(state, pid, count) {
  const p = state.players[pid];
  count = Math.min(Math.floor(count), Math.floor(p.peasants));
  if (count < 1) throw new Error('No peasants to draft');
  p.peasants -= count; p.army.peasant = (p.army.peasant || 0) + count;
}
export function release(state, pid, count) {
  const p = state.players[pid];
  count = Math.min(Math.floor(count), Math.floor(p.army.peasant || 0));
  if (count < 1) throw new Error('No levies to release');
  p.army.peasant -= count; p.peasants += count;
  if (!p.army.peasant) delete p.army.peasant;
}

export function availableTechs(p) {
  return Object.entries(TECHS).filter(([id, t]) => !p.techs[id] && !p.research.some((r) => r.id === id)
    && p.buildings.keep >= t.keep && (t.req || []).every((r) => p.techs[r] || p.research.some((x) => x.id === r))).map(([id]) => id);
}

export function research(state, pid, id) {
  const p = state.players[pid], t = TECHS[id];
  if (!t) throw new Error('Unknown tech');
  if (!availableTechs(p).includes(id)) throw new Error('Not available yet');
  if (p.research.length >= 3) throw new Error('Research queue is full (3)');
  pay(p, t.cost);
  p.research.push({ id, remaining: t.time });
}

export function sendArmy(state, pid, toKey, units, opts = {}) {
  const p = state.players[pid];
  const tile = state.tiles[toKey];
  if (!tile || tile.terrain === 'mountain') throw new Error('Cannot march there');
  if (toKey === p.capital) throw new Error('Already home');
  const send = {};
  for (const [t, n] of Object.entries(units)) {
    const k = Math.floor(n);
    if (k <= 0) continue;
    if ((p.army[t] || 0) < k) throw new Error(`Not enough ${UNITS[t].name} at home`);
    send[t] = k;
  }
  if (!total(send)) throw new Error('Select some troops');
  const path = findPath(state, p.capital, toKey);
  if (!path) throw new Error('No route');
  for (const [t, n] of Object.entries(send)) { p.army[t] -= n; if (p.army[t] <= 0) delete p.army[t]; }
  const speed = marchSpeed(p, send);
  state.marches.push({ id: state.nextId++, owner: pid, units: send, from: p.capital, to: toKey, path: path.path,
    departT: state.t, arriveT: state.t + Math.max(C.TICK_MIN, Math.ceil((path.cost / speed) * 60)), mission: 'attack',
    stance: p.stance, retreatAt: p.doctrine.retreatAt, auto: !!opts.auto });
  return state.marches[state.marches.length - 1];
}

export function recall(state, pid, marchId) {
  const m = state.marches.find((x) => x.id === marchId && x.owner === pid && x.mission === 'attack');
  if (!m) throw new Error('No such march');
  const elapsed = state.t - m.departT;
  state.marches = state.marches.filter((x) => x !== m);
  state.marches.push({ ...m, id: state.nextId++, mission: 'return', to: m.from, from: m.to, path: [...m.path].reverse(),
    departT: state.t, arriveT: state.t + Math.max(C.TICK_MIN, elapsed) });
}

export function setDoctrine(state, pid, patch) {
  const d = state.players[pid].doctrine;
  for (const [k, v] of Object.entries(patch)) if (k in d) d[k] = v;
}
export function setStance(state, pid, stance) {
  if (!['battle', 'ward'].includes(stance)) throw new Error('Bad stance');
  state.players[pid].stance = stance;
}

export function orderAssault(state, pid, siegeId) {
  const s = state.sieges.find((x) => x.id === siegeId && x.owner === pid);
  if (!s) throw new Error('No such siege');
  assault(state, s);
}
export function liftSiege(state, pid, siegeId) {
  const s = state.sieges.find((x) => x.id === siegeId && x.owner === pid);
  if (!s) throw new Error('No such siege');
  state.sieges = state.sieges.filter((x) => x !== s);
  sendHome(state, pid, s.tile, s.units);
}

// Defender sallies out of the castle to hit the siege camp in the open.
export function sally(state, pid, siegeId, units) {
  const p = state.players[pid];
  const s = state.sieges.find((x) => x.id === siegeId && x.target === pid);
  if (!s) throw new Error('No siege on your castle');
  const send = {};
  for (const [t, n] of Object.entries(units)) { const k = Math.min(Math.floor(n), Math.floor(p.army[t] || 0)); if (k > 0) send[t] = k; }
  if (!total(send)) throw new Error('Select troops to sally with');
  for (const [t, n] of Object.entries(send)) p.army[t] -= n;
  const att = state.players[s.owner];
  const result = resolveBattle(
    { units: send, mods: mods(p), stance: p.stance, retreatAt: 0.4, supply: 1 },
    { units: s.units, mods: mods(att), stance: s.stance, retreatAt: s.retreatAt },
    { terrainDef: 0, wallUp: false, isCastle: false }, state);
  tally(state, pid, s.owner, result);
  addUnits(p.army, result.att);
  const lines = battleLines(result);
  if (result.winner === 'att') {
    state.sieges = state.sieges.filter((x) => x !== s);
    sendHome(state, s.owner, s.tile, result.def);
    report(state, [pid, s.owner], `${p.name} sallied out and broke ${att.name}'s siege!`, lines);
  } else {
    s.units = result.def;
    report(state, [pid, s.owner], `${p.name}'s sally was driven back inside the walls`, lines);
  }
  return result;
}

export function cast(state, pid, spell, arg) {
  const p = state.players[pid], sp = SPELLS[spell];
  if (!sp) throw new Error('Unknown spell');
  if (!p.techs[sp.tech]) throw new Error(`Research ${TECHS[sp.tech].name} first`);
  if ((p.cooldowns[spell] || 0) > state.t) throw new Error(`On cooldown for ${Math.ceil((p.cooldowns[spell] - state.t) / 60)}h`);
  if (p.res.mana < sp.mana) throw new Error('Not enough mana');
  if (spell === 'scry') {
    if (!state.players[arg] || arg === pid) throw new Error('Pick a rival');
    p.effects.scry[arg] = state.t + 12 * 60;
  } else if (spell === 'hex') {
    const m = state.marches.find((x) => x.id === arg && x.owner !== pid && state.tiles[x.to].owner === pid && x.mission === 'attack');
    if (!m) throw new Error('Pick an enemy march heading into your land');
    if (m.hexed) throw new Error('Already hexed');
    m.arriveT += Math.ceil((m.arriveT - state.t) * 0.4); m.hexed = true;
  } else if (spell === 'ward') {
    if (!p.buildings.walls) throw new Error('You have no walls');
    p.wallHp = Math.min(wallMax(p), p.wallHp + wallMax(p) * 0.3);
    p.effects.wardUntil = state.t + 12 * 60;
  }
  p.res.mana -= sp.mana;
  p.cooldowns[spell] = state.t + sp.cooldownH * 60;
}

// Action dispatcher, used by the multiplayer adapter so actions can be logged/replayed.
export const ACTIONS = { build, cancelBuild, train, draft, release, research, sendArmy, recall, setDoctrine, setStance, orderAssault, liftSiege, sally, cast };
export function applyAction(state, pid, action) {
  const fn = ACTIONS[action.type];
  if (!fn) throw new Error(`Unknown action ${action.type}`);
  return fn(state, pid, ...(action.args || []));
}

export { armyPower, total, visibleSet, ownedTiles, dist };
