// Phased battle resolution: volley (3 rounds) -> charge -> melee (up to 6 rounds).
// Counts are tracked as floats during the fight and stochastically rounded at the end.
import { UNITS, COUNTERS } from './data.js';
import { rand } from './rng.js';

const has = (type, tag) => UNITS[type].tags.includes(tag);

function hpOf(units) {
  let s = 0;
  for (const [t, n] of Object.entries(units)) s += n * UNITS[t].hp;
  return s;
}
function countOf(units) { return Object.values(units).reduce((a, b) => a + b, 0); }

export function armyPower(units, mods = {}) {
  // Rough strength estimate used by bots and doctrine targeting.
  let p = 0;
  for (const [t, n] of Object.entries(units)) {
    const u = UNITS[t];
    const atk = u.atk * (u.volley ? 1.5 : 1) + (u.siege ? u.siege * 0.2 : 0);
    p += n * Math.sqrt(Math.max(1, atk) * u.hp * (1 + (u.armor + (mods.armor || 0)) / 10));
  }
  return p;
}

function counter(src, tgt, mods) {
  let m = 1;
  const table = COUNTERS[src];
  if (table) for (const tag of UNITS[tgt].tags) if (table[tag]) m = Math.max(m, table[tag]);
  if (src === 'pike' && has(tgt, 'cavalry')) m += mods.pikeVsCav || 0;
  return m;
}

function weight(type, phase) {
  const u = UNITS[type];
  if (phase === 'volley') {
    if (u.screen) return u.screen;
    if (has(type, 'ranged') || has(type, 'mage')) return 0.5;
    if (has(type, 'siege')) return 0.6;
    return 1;
  }
  if (has(type, 'ranged')) return 0.7;
  if (has(type, 'siege')) return 0.3;
  if (has(type, 'mage')) return 0.5;
  return 1;
}

function baseAtk(side, type, rng) {
  const u = UNITS[type], m = side.mods || {};
  let a = u.atk * (side.supply ?? 1);
  if (has(type, 'infantry') && type !== 'peasant') a *= 1 + (m.infantryAtk || 0);
  if (type === 'peasant') a *= 1 + (m.peasantAtk || 0);
  if (type === 'knight') a *= 1 + (m.knightAtk || 0);
  if (type === 'mage') a *= 1 + (m.mageAtk || 0);
  if (side.isDefender && side.isCastle) a *= 1 + (m.defAtk || 0);
  if (u.accuracy) a *= u.accuracy * (0.6 + 0.8 * rand(rng));
  return a;
}

// Returns map targetType -> damage dealt by `src` side to `tgt` side for this phase/round.
function fire(src, tgt, phase, round, ctx, rng) {
  const out = {};
  const tgtTotal = countOf(tgt.units);
  if (tgtTotal <= 0) return { out, shock: 0 };
  const infShare = Object.entries(tgt.units).filter(([t]) => has(t, 'infantry')).reduce((s, [, n]) => s + n, 0) / tgtTotal;
  const wardMages = tgt.stance === 'ward' ? (tgt.units.mage || 0) : 0;
  const ward = phase === 'volley' ? Math.min(0.4, (3 * wardMages) / tgtTotal) : 0;
  let shock = 0;

  for (const [type, n] of Object.entries(src.units)) {
    if (n <= 0) continue;
    const u = UNITS[type];
    let mult = 0;
    if (phase === 'volley') mult = u.volley && u.volley.includes(round) ? 1 : 0;
    else if (phase === 'charge') mult = u.charge || 0;
    else mult = u.melee || 0;
    if (type === 'mage' && src.stance === 'ward' && phase === 'volley') mult = 0;
    if (!mult) continue;
    if (u.wallPenalty && !src.isDefender && ctx.wallUp) mult *= u.wallPenalty;

    let dmg = n * baseAtk(src, type, rng) * mult;
    if (type === 'mage') dmg *= 1 + infShare;   // area damage rewards clumped infantry

    let targets = Object.entries(tgt.units).filter(([, c]) => c > 0);
    if (phase === 'charge' && type === 'pike') targets = targets.filter(([t]) => has(t, 'cavalry'));
    if (!targets.length) continue;
    const wsum = targets.reduce((s, [t, c]) => s + c * weight(t, phase), 0);
    for (const [t, c] of targets) {
      const armor = UNITS[t].armor + (t !== 'peasant' ? (tgt.mods?.armor || 0) : 0);
      const armorF = u.pierce ? 1 : 10 / (10 + armor);
      let d = dmg * (c * weight(t, phase) / wsum) * counter(type, t, src.mods || {}) * armorF * (1 - ward);
      if (phase === 'volley' && UNITS[t].evasive) d *= UNITS[t].evasive;
      if (tgt.isDefender) {
        d *= 1 - (ctx.terrainDef || 0);
        if (ctx.wallUp) d *= 0.5;
      }
      out[t] = (out[t] || 0) + d;
    }
    if (u.shock) shock += dmg;
  }
  return { out, shock };
}

function apply(side, dmg) {
  for (const [t, d] of Object.entries(dmg)) {
    side.units[t] = Math.max(0, side.units[t] - d / UNITS[t].hp);
  }
}

function roundUnits(units, rng) {
  const r = {};
  for (const [t, n] of Object.entries(units)) {
    const v = Math.floor(n + rand(rng) * 0.999);
    if (v > 0) r[t] = v;
  }
  return r;
}

/**
 * att / def: { units, mods, stance: 'battle'|'ward', retreatAt, supply }
 * ctx: { terrainDef, wallUp, isCastle }
 * rng: the game state object (holds rng seed)
 */
export function resolveBattle(attIn, defIn, ctx, rng) {
  const A = { ...attIn, units: { ...attIn.units }, isDefender: false, isCastle: ctx.isCastle, moraleHit: 0 };
  const D = { ...defIn, units: { ...defIn.units }, isDefender: true, isCastle: ctx.isCastle, moraleHit: 0 };
  const startA = hpOf(A.units), startD = hpOf(D.units);
  const log = [];
  if (startD <= 0) return finish('att', 'Undefended.');
  if (startA <= 0) return finish('def', 'No attackers.');

  const phases = [['volley', 1], ['volley', 2], ['volley', 3], ['charge', 1],
    ['melee', 1], ['melee', 2], ['melee', 3], ['melee', 4], ['melee', 5], ['melee', 6]];

  for (const [phase, round] of phases) {
    const fa = fire(A, D, phase, round, ctx, rng);
    const fd = fire(D, A, phase, round, ctx, rng);
    apply(D, fa.out); apply(A, fd.out);
    const hA = hpOf(A.units), hD = hpOf(D.units);
    if (fa.shock && hD > 0) D.moraleHit += Math.min(0.15, fa.shock / hD);
    if (fd.shock && hA > 0) A.moraleHit += Math.min(0.15, fd.shock / hA);
    if (hD <= 0.5) return finish('att', `Defenders wiped out in ${phase} ${round}.`);
    if (hA <= 0.5) return finish('def', `Attackers wiped out in ${phase} ${round}.`);
    const fracA = hA / startA - A.moraleHit, fracD = hD / startD - D.moraleHit;
    const breakA = fracA < (A.retreatAt ?? 0.35), breakD = fracD < (D.retreatAt ?? 0.35);
    if (breakA || breakD) {
      const loser = breakA && breakD ? (fracA <= fracD ? 'A' : 'D') : breakA ? 'A' : 'D';
      const s = loser === 'A' ? A : D;
      for (const t of Object.keys(s.units)) s.units[t] *= 0.9;   // rout losses
      log.push(`${loser === 'A' ? 'Attackers' : 'Defenders'} broke in ${phase} ${round}.`);
      return finish(loser === 'A' ? 'def' : 'att');
    }
  }
  return finish('def', 'Attack stalled; attackers withdraw.');

  function finish(winner, msg) {
    if (msg) log.push(msg);
    const att = roundUnits(A.units, rng), def = roundUnits(D.units, rng);
    const loss = (start, now) => {
      const l = {};
      for (const [t, n] of Object.entries(start)) { const d = n - (now[t] || 0); if (d > 0) l[t] = d; }
      return l;
    };
    return { winner, att, def, attLoss: loss(attIn.units, att), defLoss: loss(defIn.units, def), log };
  }
}
