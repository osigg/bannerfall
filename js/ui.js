// Game UI: plain DOM + template strings, no framework or build step.
import { UNITS, BUILDINGS, TECHS, SPELLS, TERRAIN, CONFIG, RESOURCES } from './data.js';
import * as E from './engine.js';
import { parse } from './map.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = { gold: '🪙', food: '🌾', stone: '🪨', mana: '🔮' };
const fmt = (n) => (Math.abs(n) >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.floor(n).toLocaleString());
const costStr = (c) => Object.entries(c).filter(([, v]) => v).map(([r, v]) => `${ICON[r]}${fmt(v)}`).join(' ') || 'free';
export function dur(min) {
  min = Math.max(0, Math.round(min));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
const clock = (t) => `Day ${Math.floor(t / 1440) + 1}, ${String(Math.floor((t % 1440) / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const unitList = (u) => Object.entries(u || {}).filter(([, n]) => n >= 1).map(([t, n]) => `${Math.floor(n)} ${UNITS[t].name}`).join(', ') || 'none';
const affordable = (p, cost) => Object.entries(cost).every(([r, v]) => (p.res[r] || 0) >= v);

let store, tab = 'castle', selected = null, extras = {}, tipKey = null, tipPinned = false;
document.addEventListener('click', () => { if (tipPinned) { tipPinned = false; tipKey = null; renderTop(); } });
const TABS = [['castle', 'Castle'], ['army', 'Army'], ['map', 'Map'], ['research', 'Research'], ['reports', 'Reports']];

export function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms);
}

async function act(fn, ok) {
  try { await store.mutate(fn); if (ok) toast(ok); } catch (e) { toast(e.message || String(e)); }
  render(true);
}

export function startGameUI(s, opts = {}) {
  store = s; extras = opts;
  if (extras.dev) TABS.push(['dev', 'Dev']);
  render(true);
  setInterval(() => { store.tick(); renderTop(); render(false); }, 1000);
}

function me() { return store.state.players[store.me]; }

const RES_USE = {
  gold: 'Spent on nearly everything. Pays army upkeep and the upkeep on every tile beyond your first.',
  food: 'Eaten by every peasant and soldier. Peasants only grow while food is in surplus; at zero, people desert.',
  stone: 'Keep upgrades, walls, siege engines, and most mid-game buildings.',
  mana: 'Mages, spells, and arcane research. Comes from the Mage tower and ley-line tiles.',
};
function tipContent(k, st, p, r) {
  const row = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="${v < 0 ? 'bad' : v > 0 ? 'good' : 'dim'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}/h</td></tr>`;
  if (k === 'peasants') {
    const pop = p.peasants + E.total(E.allUnits(st, store.me));
    return `<b>👥 Peasants</b><table>
      <tr><td>Working peasants</td><td>${fmt(p.peasants)}</td></tr>
      <tr><td>Needed to staff your buildings</td><td class="${r.labor < 1 ? 'bad' : ''}">${r.laborNeed} (labor ${Math.round(r.labor * 100)}%)</td></tr>
      <tr><td>Soldiers (count toward housing)</td><td>${fmt(pop - p.peasants)}</td></tr>
      <tr><td>Population / housing cap</td><td>${fmt(pop)} / ${fmt(E.popCap(p))}</td></tr></table>
      <p class="small dim">Peasants grow while food is in surplus and there is room in Housing. Training a soldier uses one up.</p>`;
  }
  const m = E.mods(p), mult = 1 + (m[`${k}Mult`] || 0);
  const pr = r.parts;
  let rows = (pr.buildings[k] ? row('Buildings', pr.buildings[k] * mult) : '') + (pr.tiles[k] ? row('Territory', pr.tiles[k] * mult) : '');
  if (k === 'gold') rows += row('Peasant tax', pr.tax);
  if (pr.unitUpkeep[k]) rows += row('Army upkeep', -pr.unitUpkeep[k]);
  if (k === 'food') rows += row('Peasants eating', -pr.peasantFood);
  if (k === 'gold' && pr.tileUpkeep) rows += row('Tile upkeep', -pr.tileUpkeep);
  rows += row('Net', r.net[k], 'total');
  const cap = E.storageCap(p), hrs = r.net[k] > 0 ? (cap - p.res[k]) / r.net[k] : null;
  return `<b>${ICON[k]} ${k[0].toUpperCase() + k.slice(1)}</b> <span class="dim small">${fmt(p.res[k])} / ${fmt(cap)}</span>
    <table>${rows}</table>
    ${mult !== 1 ? `<p class="small dim">Research bonus: +${Math.round((mult - 1) * 100)}% production</p>` : ''}
    ${hrs !== null ? `<p class="small ${hrs < 12 ? 'bad' : 'dim'}">${hrs <= 0 ? 'Storage full: production is being wasted. Upgrade the Keep.' : `Storage full in ${dur(hrs * 60)}.`}</p>` : ''}
    <p class="small dim">${RES_USE[k]}</p>`;
}

// The header is built once and then patched in place every second, so taps and
// hovers never land on an element that was just replaced.
function buildTop() {
  const top = $('#top');
  top.innerHTML = `
    <div class="clock"><span id="h-clock"></span><span id="h-season"></span></div>
    <div class="res">${RESOURCES.map((k) => `<span data-tip="${k}">${ICON[k]} <b id="v-${k}"></b><span id="r-${k}" class="small"></span></span>`).join('')}
      <span data-tip="peasants">👥 <b id="v-peasants"></b><span id="r-peasants" class="small dim"></span></span>
      <span class="small dim" id="h-cap"></span></div>
    <div id="tip" class="tip" hidden></div>`;
  top.querySelectorAll('[data-tip]').forEach((el) => {
    el.onmouseenter = () => { if (!tipPinned) { tipKey = el.dataset.tip; renderTop(); } };
    el.onmouseleave = () => { if (!tipPinned) { tipKey = null; renderTop(); } };
    el.onclick = (e) => {
      e.stopPropagation();
      const same = tipKey === el.dataset.tip && tipPinned;
      tipKey = same ? null : el.dataset.tip; tipPinned = !same; renderTop();
    };
  });
  $('#tip').onclick = (e) => e.stopPropagation();
}

let lastTabs = '';
function renderTop() {
  const st = store.state, p = me(), r = E.rates(st, store.me);
  if (!$('#h-clock')) buildTop();
  const cap = E.storageCap(p), pop = p.peasants + E.total(E.allUnits(st, store.me));
  $('#h-clock').textContent = `🏰 ${p.name} · ${clock(st.t)}${st.clock.speed !== 1 ? ` · ${st.clock.speed}x` : ''}`;
  $('#h-season').textContent = st.ended ? 'Season over' : `Season ends in ${dur(st.seasonEnd - st.t)}`;
  for (const k of RESOURCES) {
    $(`#v-${k}`).textContent = fmt(p.res[k]);
    const el = $(`#r-${k}`);
    el.textContent = `${r.net[k] >= 0 ? '+' : ''}${r.net[k].toFixed(0)}/h`;
    el.className = `small ${r.net[k] < 0 ? 'bad' : 'dim'}`;
  }
  $('#v-peasants').textContent = fmt(p.peasants);
  $('#r-peasants').textContent = ` ${fmt(pop)}/${fmt(E.popCap(p))}`;
  $('#h-cap').textContent = `cap ${fmt(cap)}`;
  document.querySelectorAll('#top [data-tip]').forEach((el) => el.classList.toggle('on', el.dataset.tip === tipKey));
  const tip = $('#tip');
  tip.hidden = !tipKey;
  if (tipKey) tip.innerHTML = tipContent(tipKey, st, p, r);

  const tabs = TABS.map(([k, n]) => {
    const alert = k === 'army' && (E.incoming(st, store.me).length || st.sieges.some((x) => x.target === store.me));
    return `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${n}${alert ? ' ⚠️' : ''}</button>`;
  }).join('');
  if (tabs !== lastTabs) {
    lastTabs = tabs;
    $('#tabs').innerHTML = tabs;
    $('#tabs').querySelectorAll('button').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(true); }));
  }
}

let lastRender = 0;
function render(force) {
  if (!store.state) return;
  const focused = document.activeElement && ['INPUT', 'SELECT'].includes(document.activeElement.tagName);
  if (!force && (focused || Date.now() - lastRender < 4000)) return;
  lastRender = Date.now();
  renderTop();
  const view = $('#view');
  const y = window.scrollY;
  view.innerHTML = { castle: castleView, army: armyView, map: mapView, research: researchView, reports: reportsView, dev: devView }[tab]();
  bind(view);
  if (!force) window.scrollTo(0, y);
}

// ---------------------------------------------------------------- views
function castleView() {
  const st = store.state, p = me(), r = E.rates(st, store.me), slots = 1 + (E.mods(p).buildSlots || 0);
  const q = p.buildQueue.map((it, i) => `<li class="row">${BUILDINGS[it.b].name} → ${it.level}
      <span class="dim small">${i < slots ? `${dur(it.remaining)} left` : 'waiting'}</span>
      <button class="danger small" data-act="cancelBuild" data-i="${i}">✕</button></li>`).join('');
  const shown = shownBuildings(p);
  const teasers = nextBuildingUnlocks(p, shown);
  const cards = Object.entries(BUILDINGS).filter(([b]) => shown.has(b) || teasers.has(b)).map(([b, def]) => {
    if (teasers.has(b)) {
      return `<div class="card locked"><div class="row"><h3>🔒 ${def.name}</h3><span class="pill">new</span></div>
        <p class="small dim">${def.desc}</p><p class="small">Unlocks at ${E.missingReqs(p, b).map(([r, l]) => `${BUILDINGS[r].name} ${l}`).join(' + ')}</p></div>`;
    }
    const next = E.queuedLevel(p, b) + 1, cost = E.buildCost(b, next), max = E.maxLevel(p, b);
    const blocked = next > max ? `Needs Keep ${next - CONFIG.KEEP_LEAD}` : p.buildQueue.length >= 5 ? 'Queue full' : !affordable(p, cost) ? '' : null;
    return `<div class="card"><div class="row"><h3>${def.name}</h3><span class="pill">Lv ${p.buildings[b]}</span></div>
      <p class="small dim">${def.desc}</p>${buildingEffect(b, p)}
      <div class="row small"><span>${costStr(cost)} · ${dur(E.buildTime(b, next))}</span>
      <button data-act="build" data-b="${b}" ${blocked !== null ? 'disabled' : ''} title="${blocked || ''}">${blocked ? esc(blocked) : `Upgrade → ${next}`}</button></div></div>`;
  }).join('');
  const wm = E.wallMax(p);
  return `
    <h2>Build queue <span class="small dim">(${slots} at a time, max 5)</span></h2>
    ${q ? `<ul class="list">${q}</ul>` : '<p class="dim">Nothing building. Your builders are idle.</p>'}
    <h2>Realm</h2>
    <div class="card small">
      Labor: <b class="${r.labor < 1 ? 'bad' : 'good'}">${Math.round(r.labor * 100)}%</b> (${fmt(p.peasants)} peasants / ${r.laborNeed} needed by economic buildings)<br>
      Peasant tax ${ICON.gold}${r.parts.tax.toFixed(1)}/h · Tile upkeep ${ICON.gold}-${r.parts.tileUpkeep.toFixed(1)}/h · Army upkeep ${Object.values(r.parts.unitUpkeep).some((v) => v >= 0.5) ? `${costStr(Object.fromEntries(Object.entries(r.parts.unitUpkeep).map(([k, v]) => [k, Math.round(v)])))}/h` : 'none'}<br>
      Tiles: ${E.ownedTiles(st, store.me).length}${wm ? ` · Walls ${fmt(p.wallHp)}/${fmt(wm)}
      <div class="bar"><i style="width:${(100 * p.wallHp) / wm}%"></i></div>` : '<br>'}
      Score: <b class="gold">${E.score(st, store.me)}</b></div>
    <h2>Buildings</h2><div class="grid">${cards}</div>`;
}

// Buildings you have, are building, or can build right now.
function shownBuildings(p) {
  return new Set(Object.keys(BUILDINGS).filter((b) => p.buildings[b] > 0 || E.buildingUnlocked(p, b) || p.buildQueue.some((i) => i.b === b)));
}
// For each building you own, the next tier of locked buildings that depend on it.
// Further tiers stay hidden so the castle screen grows with you.
function nextBuildingUnlocks(p, shown) {
  const out = new Set();
  for (const src of Object.keys(BUILDINGS)) {
    if (!(p.buildings[src] > 0)) continue;
    const locked = Object.entries(BUILDINGS).filter(([b, d]) => !shown.has(b) && d.requires && d.requires[src] > p.buildings[src]);
    if (!locked.length) continue;
    const tier = Math.min(...locked.map(([, d]) => d.requires[src]));
    for (const [b, d] of locked) {
      if (d.requires[src] === tier && E.missingReqs(p, b).every(([r]) => p.buildings[r] > 0)) out.add(b);
    }
  }
  return out;
}
// Units a building has unlocked, plus the next tier only.
function visibleUnits(p, building) {
  const L = p.buildings[building] || 0;
  if (!L) return [];
  const list = Object.entries(UNITS).filter(([, u]) => u.building === building);
  const nextTier = Math.min(...list.filter(([, u]) => u.unlock > L).map(([, u]) => u.unlock));
  return list.filter(([, u]) => u.unlock <= L || u.unlock === nextTier).map(([t]) => t);
}

function buildingEffect(b, p) {
  const L = p.buildings[b], def = BUILDINGS[b];
  if (def.prod) {
    const [res, base] = Object.entries(def.prod)[0];
    const at = (l) => (l ? base * l * Math.pow(CONFIG.PROD_GROWTH, l - 1) : 0);
    return `<p class="small">${ICON[res]} ${at(L).toFixed(0)}/h → ${at(L + 1).toFixed(0)}/h at full labor</p>`;
  }
  if (b === 'housing') return `<p class="small">Pop cap ${E.popCap(p)}</p>`;
  if (b === 'keep') return `<p class="small">Storage ${fmt(E.storageCap(p))} each · others up to Lv ${E.maxLevel(p, 'farm')}</p>`;
  if (b === 'walls') return `<p class="small">Max wall HP ${fmt(E.wallMax(p))}</p>`;
  if (b === 'watchtower') return `<p class="small">Vision +${E.visionBonus(p)}${L >= 3 ? ' · see incoming army makeup' : ''}</p>`;
  if (b === 'magetower') return '';
  const next = Object.values(UNITS).filter((u) => u.building === b && u.unlock > L).sort((x, y) => x.unlock - y.unlock)[0];
  const have = Object.values(UNITS).filter((u) => u.building === b && u.unlock <= L).map((u) => u.name);
  return `<p class="small">${have.length ? `Trains: ${have.join(', ')}` : ''}${next ? `${have.length ? ' · ' : ''}Next: ${next.name} at Lv ${next.unlock}` : ''}</p>`;
}

function armyView() {
  const st = store.state, p = me(), pid = store.me;
  const inc = E.incoming(st, pid);
  const onMe = st.sieges.filter((s) => s.target === pid);
  const mine = st.sieges.filter((s) => s.owner === pid);
  const marches = st.marches.filter((m) => m.owner === pid);
  const threats = [
    ...onMe.map((s) => `<div class="card alert"><h3>⚔️ ${esc(st.players[s.owner].name)} is besieging your castle</h3>
      <p class="small">Walls ${fmt(p.wallHp)}/${fmt(E.wallMax(p))}. Besiegers: ${unitList(s.units)}.
      ${s.setupDoneT > st.t ? `Trebuchets ready in ${dur(s.setupDoneT - st.t)}. ` : ''}Assault in ≤ ${dur(s.assaultAt - st.t)}.</p>
      <div class="controls">${unitInputs(p.army, `sally-${s.id}`)}<button class="primary" data-act="sally" data-id="${s.id}">Sally out</button></div></div>`),
    ...inc.map((m) => `<div class="card alert"><h3>🚩 ${esc(m.from)} marching on ${m.to}${m.hexed ? ' (hexed)' : ''}</h3>
      <p class="small">Arrives in ${dur(m.eta)}. ${m.units ? unitList(m.units) : m.size ? `~${m.size} troops (Watchtower 3 to see makeup)` : 'Size unknown (build a Watchtower)'}</p>
      ${p.techs.hex_of_sloth && !m.hexed ? `<button data-act="cast" data-spell="hex" data-arg="${m.id}">Hex of sloth (${SPELLS.hex.mana} mana)</button>` : ''}</div>`),
  ].join('');
  const trainable = Object.keys(BUILDINGS).flatMap((b) => visibleUnits(p, b)).map((t) => {
    const u = UNITS[t];
    const why = E.canTrain(p, t);
    const maxN = Math.floor(Math.min(p.peasants, ...Object.entries(u.cost).map(([r, v]) => (p.res[r] || 0) / v)));
    return `<div class="card ${why ? 'dim' : ''}"><div class="row"><h3>${u.name}</h3><span class="pill">${Math.floor(p.army[t] || 0)} home</span></div>
      <p class="small dim">${u.desc}</p>
      <p class="small">⚔️${u.atk}${u.siege ? ` 🧱${u.siege}` : ''} ❤️${u.hp} 🛡️${u.armor} 🏃${u.speed}/h · ${costStr(u.cost)} · ${dur(E.unitTime(p, t))} each</p>
      ${why ? `<p class="small bad">🔒 ${why}</p>` : `<div class="controls"><input type="number" min="1" value="${Math.min(10, Math.max(1, maxN))}" id="n-${t}">
      <button data-max="${maxN}" data-for="n-${t}">max ${maxN}</button><button class="primary" data-act="train" data-t="${t}">Train</button></div>`}</div>`;
  }).join('');
  const tq = Object.entries(p.trainQueues).flatMap(([b, q]) => q.map((it, i) => `<li>${it.count} ${UNITS[it.type].name} <span class="dim small">(${BUILDINGS[b].name}${i ? ', waiting' : `, next in ${dur(E.unitTime(p, it.type) - it.progress)}`})</span></li>`)).join('');
  const d = p.doctrine;
  const rivals = Object.values(st.players).filter((x) => x.id !== pid);
  const spells = Object.entries(SPELLS).filter(([, sp]) => p.techs[sp.tech] && sp !== SPELLS.hex).map(([k, sp]) => {
    const cd = (p.cooldowns[k] || 0) - st.t;
    const target = k === 'scry' ? `<select id="scry-target">${rivals.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>` : '';
    return `<div class="controls"><b>${sp.name}</b> <span class="small dim">${sp.desc}</span> ${target}
      <button data-act="cast" data-spell="${k}" ${cd > 0 ? 'disabled' : ''}>${cd > 0 ? `ready in ${dur(cd)}` : `Cast (${sp.mana} mana)`}</button></div>`;
  }).join('');
  const scryed = Object.entries(p.effects.scry || {}).filter(([, until]) => until > st.t).map(([id]) => {
    const x = st.players[id];
    return `<li>🔮 ${esc(x.name)}: ${unitList(x.army)} · walls ${fmt(x.wallHp)}/${fmt(E.wallMax(x))}</li>`;
  }).join('');
  return `
    ${threats ? `<h2>Threats</h2>${threats}` : ''}
    <h2>Home army</h2>
    <div class="card"><p>${unitList(p.army)}</p>
      <div class="controls">Peasant levies: <input type="number" id="draft-n" value="20" min="1">
      <button data-act="draft">Draft</button><button data-act="release">Release</button>
      <span class="small dim">Levies fight instantly but stop working.</span></div>
      ${p.buildings.magetower ? `<div class="controls">Mage stance:
        <button data-act="stance" data-v="battle" ${p.stance === 'battle' ? 'class="primary"' : ''}>Battle</button>
        <button data-act="stance" data-v="ward" ${p.stance === 'ward' ? 'class="primary"' : ''}>Ward</button></div>` : ''}</div>
    ${marches.length || mine.length ? `<h2>Armies in the field</h2><ul class="list">
      ${marches.map((m) => `<li>${m.mission === 'return' ? '↩️ Returning' : `➡️ To ${m.to}`} · ${unitList(m.units)} · ${dur(m.arriveT - st.t)}
        ${m.mission === 'attack' ? `<button data-act="recall" data-id="${m.id}">Recall</button>` : ''}</li>`).join('')}
      ${mine.map((s) => `<li>🏰 Sieging ${esc(st.players[s.target].name)} · walls ${fmt(st.players[s.target].wallHp)} · ${unitList(s.units)}
        <button class="primary" data-act="assault" data-id="${s.id}">Assault now</button> <button data-act="lift" data-id="${s.id}">Lift siege</button></li>`).join('')}</ul>` : ''}
    ${p.buildings.barracks ? `<h2>Standing orders</h2>
    <div class="card small">
      <div class="controls"><label class="inline"><input type="checkbox" id="d-auto" ${d.auto ? 'checked' : ''}> Armies act on their own every ${CONFIG.DOCTRINE_EVERY_H}h</label></div>
      <div class="controls">Target <select id="d-target"><option value="expand" ${d.target === 'expand' ? 'selected' : ''}>Expand into neutral land</option>
        <option value="any" ${d.target === 'any' ? 'selected' : ''}>Weakest neighbor (anyone)</option>
        ${rivals.map((x) => `<option value="${x.id}" ${d.target === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <label class="inline"><input type="checkbox" id="d-siege" ${d.siegeCastles ? 'checked' : ''}> may besiege castles</label></div>
      <div class="controls">Keep home <input type="number" id="d-guard" value="${Math.round(d.homeGuard * 100)}" min="0" max="100">%
        Send <input type="number" id="d-send" value="${Math.round(d.sendFrac * 100)}" min="0" max="100">% of the rest</div>
      <div class="controls">Retreat at <input type="number" id="d-retreat" value="${Math.round(d.retreatAt * 100)}" min="5" max="90">% strength
        Garrison <input type="number" id="d-garrison" value="${Math.round(d.garrisonFrac * 100)}" min="0" max="100">% on captured tiles
        Only attack at <input type="number" id="d-ratio" value="${d.minRatio}" step="0.1" min="0.5" max="5">x their strength</div>
      <button class="primary" data-act="doctrine">Save orders</button></div>` : ''}
    ${spells || scryed ? `<h2>Spells</h2><div class="card">${spells}${scryed ? `<ul class="list small">${scryed}</ul>` : ''}</div>` : ''}
    ${tq ? `<h2>Training</h2><ul class="list">${tq}</ul>` : ''}
    <h2>Recruit</h2>${trainable ? `<div class="grid">${trainable}</div>` : `<p class="dim">No military buildings yet. ${p.buildings.keep ? 'Build Barracks on the Castle tab.' : 'Raise a Keep to unlock the Barracks.'}</p>`}`;
}

function unitInputs(units, prefix) {
  return Object.entries(units).filter(([, n]) => n >= 1).map(([t, n]) =>
    `<label class="inline small">${UNITS[t].name} <input type="number" min="0" max="${Math.floor(n)}" value="${Math.floor(n)}" data-unit="${t}" data-group="${prefix}"></label>`).join('') || '<span class="dim small">No troops at home.</span>';
}
function readUnits(prefix) {
  const out = {};
  document.querySelectorAll(`[data-group="${prefix}"]`).forEach((i) => { const v = Number(i.value); if (v > 0) out[i.dataset.unit] = v; });
  return out;
}

function hexPoints(cx, cy, s) {
  return Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 180) * (60 * i - 30); return `${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`; }).join(' ');
}
const TERRAIN_COLOR = { plains: '#5d6b3a', forest: '#2f4a2a', hills: '#7a6a4a', river: '#3c6a80', leyline: '#5a3f7a', mountain: '#3a3a3a' };

function mapView() {
  const st = store.state, p = me(), pid = store.me;
  const vis = E.visibleSet(st, pid, E.visionBonus(p));
  const S = 18, R = st.radius;
  const pos = (k) => { const [q, r] = parse(k); return [S * Math.sqrt(3) * (q + r / 2), S * 1.5 * r]; };
  const W = S * Math.sqrt(3) * (2 * R + 1) + 4, Hh = S * 1.5 * 2 * R + 2 * S + 4;
  let svg = '';
  for (const [k, t] of Object.entries(st.tiles)) {
    const [x, y] = pos(k);
    const seen = p.seen[k], now = vis.has(k);
    let fill = seen ? TERRAIN_COLOR[t.terrain] : '#141210';
    const owner = seen && t.owner ? st.players[t.owner] : null;
    svg += `<polygon points="${hexPoints(x, y, S - 0.5)}" fill="${fill}" opacity="${now ? 1 : seen ? 0.45 : 1}" data-k="${k}" class="${selected === k ? 'sel' : ''}"/>`;
    if (owner) svg += `<polygon points="${hexPoints(x, y, S * 0.55)}" fill="${owner.color}" opacity="${now ? 0.85 : 0.4}" pointer-events="none"/>`;
    if (seen && t.capital) svg += `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="15" pointer-events="none">🏰</text>`;
    else if (seen && t.terrain === 'mountain') svg += `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" pointer-events="none">⛰️</text>`;
  }
  for (const m of st.marches) {
    if (m.owner !== pid && !vis.has(m.to) && !m.path.some((k) => vis.has(k))) continue;
    const pts = m.path.map((k) => pos(k).join(',')).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${st.players[m.owner].color}" stroke-width="2.5" stroke-dasharray="${m.mission === 'return' ? '2 4' : '6 3'}" pointer-events="none"/>`;
    const frac = Math.min(1, (st.t - m.departT) / Math.max(1, m.arriveT - m.departT));
    const idx = Math.min(m.path.length - 1, Math.floor(frac * (m.path.length - 1)));
    const [x, y] = pos(m.path[idx]);
    svg += `<circle cx="${x}" cy="${y}" r="5" fill="${st.players[m.owner].color}" stroke="#fff" pointer-events="none"/>`;
  }
  for (const s of st.sieges) {
    const [x, y] = pos(s.tile);
    svg += `<circle cx="${x}" cy="${y}" r="${S - 3}" fill="none" stroke="${st.players[s.owner].color}" stroke-width="3" pointer-events="none"/>`;
  }
  return `<svg id="map" viewBox="${-W / 2} ${-Hh / 2} ${W} ${Hh}">${svg}</svg>
    <p class="small dim">${Object.values(st.players).map((x) => `<span style="color:${x.color}">■</span> ${esc(x.name)}`).join(' · ')}</p>
    <div id="tile">${tilePanel()}</div>`;
}

function tilePanel() {
  if (!selected) return '<p class="dim">Tap a tile.</p>';
  const st = store.state, p = me(), pid = store.me, t = st.tiles[selected];
  if (!p.seen[selected]) return '<div class="card">Unexplored. Expand or march nearby to reveal it.</div>';
  const vis = E.canSee(st, pid, selected);
  const owner = t.owner ? st.players[t.owner] : null;
  const tr = TERRAIN[t.terrain];
  const d = E.dist(p.capital, selected);
  let garrison = t.capital ? (t.capital === pid ? unitList(p.army) : p.effects.scry?.[t.capital] > st.t ? unitList(st.players[t.capital].army) : 'hidden inside the castle (Scry to reveal)')
    : vis || t.owner === pid ? unitList(t.garrison) : 'not in sight';
  const send = t.terrain !== 'mountain' && selected !== p.capital;
  return `<div class="card"><div class="row"><h3>${tr.name} ${selected}</h3><span class="pill">${owner ? esc(owner.name) : 'Neutral'}</span></div>
    <p class="small">${t.capital ? `🏰 ${esc(owner.name)}'s capital. ` : ''}Yield ${costStr(tr.yield)}/h · defense +${Math.round(tr.def * 100)}% · ${d} hexes from your castle</p>
    <p class="small">Garrison: ${garrison}</p>
    ${t.unrestUntil > st.t ? `<p class="small bad">Unrest for ${dur(t.unrestUntil - st.t)}</p>` : ''}
    ${send ? `<div class="controls">${unitInputs(p.army, 'send')}</div><button class="primary" data-act="send">${t.owner === pid ? 'Reinforce' : t.capital ? 'March to siege' : 'Attack'}</button>
      <span class="small dim">Armies attack at ${Math.round(100 * Math.max(CONFIG.SUPPLY_FLOOR, 1 - CONFIG.SUPPLY_PENALTY * (1 - (E.mods(p).supply || 0)) * Math.max(0, d - CONFIG.SUPPLY_FREE_RANGE)))}% strength this far from home.</span>` : ''}</div>`;
}

function researchView() {
  const p = me();
  if (!p.buildings.keep) return '<h2>Research</h2><p class="dim">Scholars arrive once you build a Keep.</p>';
  const avail = new Set(E.availableTechs(p));
  const trees = {};
  for (const [id, t] of Object.entries(TECHS)) (trees[t.tree] ||= []).push(id);
  const q = p.research.map((r, i) => `<li>${TECHS[r.id].name} <span class="small dim">${i ? 'queued' : `${dur(r.remaining)} left`}</span></li>`).join('');
  return `<h2>Research queue <span class="small dim">(max 3)</span></h2>${q ? `<ul class="list">${q}</ul>` : '<p class="dim">No research running.</p>'}
    ${Object.entries(trees).map(([tree, ids]) => techTree(p, tree, ids, avail)).join('')}`;
}

// Lay a tree out by prerequisite depth and draw it as boxes joined by lines.
// Only researched, queued, and currently available techs are named; the rest are fogged.
function techTree(p, tree, ids, avail) {
  const depth = {};
  const d = (id) => depth[id] ?? (depth[id] = Math.max(-1, ...(TECHS[id].req || []).filter((r) => ids.includes(r)).map(d)) + 1);
  ids.forEach(d);
  const rows = [];
  for (const id of ids) (rows[depth[id]] ||= []).push(id);
  const col = {};
  rows.forEach((row, r) => {
    if (r) row.sort((a, b) => avgCol(a) - avgCol(b));
    row.forEach((id, i) => { col[id] = (i + 0.5) / row.length; });
  });
  function avgCol(id) { const ps = (TECHS[id].req || []).filter((x) => x in col); return ps.length ? ps.reduce((s, x) => s + col[x], 0) / ps.length : 0; }
  const ROW = 128, NODE_H = 104, widest = Math.max(...rows.map((r) => r.length));
  const w = Math.min(31, 100 / widest - 2.5);
  const state = (id) => (p.techs[id] ? 'done' : p.research.some((r) => r.id === id) ? 'queued' : avail.has(id) ? 'open' : 'fog');
  let lines = '';
  for (const id of ids) {
    for (const r of TECHS[id].req || []) {
      if (!(r in col)) continue;
      const lit = state(r) === 'done';
      lines += `<line x1="${col[r] * 100}%" y1="${depth[r] * ROW + NODE_H}" x2="${col[id] * 100}%" y2="${depth[id] * ROW}"
        stroke="${lit ? '#d9a441' : '#3d3427'}" stroke-width="${lit ? 2.5 : 2}" ${lit ? '' : 'stroke-dasharray="4 4"'}/>`;
    }
  }
  const nodes = ids.map((id) => {
    const t = TECHS[id], st = state(id);
    const pos = `left:${col[id] * 100 - w / 2}%;top:${depth[id] * ROW}px;width:${w}%;height:${NODE_H}px`;
    if (st === 'fog') return `<div class="tech fog" style="${pos}"><span>?</span></div>`;
    const q = p.research.findIndex((r) => r.id === id);
    const foot = st === 'done' ? '<span class="good">Researched</span>'
      : st === 'queued' ? `<span class="gold">${q ? 'Queued' : `${dur(p.research[0].remaining)} left`}</span>`
      : `<button data-act="research" data-id="${id}" ${affordable(p, t.cost) && p.research.length < 3 ? '' : 'disabled'}>${costStr(t.cost)}<br>${dur(t.time)}</button>`;
    return `<div class="tech ${st}" style="${pos}" title="${esc(effectText(t.effects))}"><b>${st === 'done' ? '✅ ' : ''}${t.name}</b>
      <span class="small">${effectText(t.effects)}</span>${foot}</div>`;
  }).join('');
  const done = ids.filter((id) => p.techs[id]).length;
  return `<h2>${tree} <span class="small dim">${done}/${ids.length}</span></h2>
    <div class="tree" style="height:${(rows.length - 1) * ROW + NODE_H + 4}px"><svg class="tree-lines" width="100%" height="100%">${lines}</svg>${nodes}</div>`;
}

const EFFECT_TEXT = {
  foodMult: 'food', goldMult: 'gold', stoneMult: 'stone', manaMult: 'mana', taxMult: 'peasant tax', infantryAtk: 'infantry attack', peasantAtk: 'levy attack',
  pikeVsCav: 'pike bonus vs cavalry', trainSpeed: 'training speed', knightAtk: 'knight attack', mageAtk: 'mage attack', wallHp: 'wall HP', towerDmg: 'tower damage',
  defAtk: 'defender attack in castle', siegeTaken: 'siege damage taken', marchSpeed: 'march speed', upkeepMult: 'army gold upkeep', supply: 'supply penalty reduction', tileUpkeep: 'tile upkeep',
};
function effectText(e) {
  const parts = Object.entries(e).map(([k, v]) => {
    if (k === 'buildSlots') return '+1 build slot';
    if (k === 'armor') return `+${v} armor (trained troops)`;
    if (k === 'vision') return `+${v} vision`;
    if (k.startsWith('spell_')) return `Unlocks spell: ${SPELLS[k.slice(6)].name}`;
    return `${v > 0 ? '+' : ''}${Math.round(v * 100)}% ${EFFECT_TEXT[k] || k}`;
  });
  if (!parts.length) return 'Unlocks Musketeers and Cannoneers';
  return parts.join(', ');
}

function reportsView() {
  const st = store.state;
  const mine = st.reports.filter((r) => r.to.includes(store.me)).slice(-80).reverse();
  return `<h2>Reports</h2><ul class="list">${mine.map((r) => `<li><span class="small dim">${clock(r.t)}</span><br>${esc(r.title)}
    ${r.lines.length ? `<div class="small dim">${r.lines.map(esc).join('<br>')}</div>` : ''}</li>`).join('') || '<li class="dim">Nothing yet.</li>'}</ul>
    ${st.final ? `<h2>Final standings</h2><ol>${st.final.map((f) => `<li>${esc(st.players[f.pid].name)}: ${f.score}</li>`).join('')}</ol>` : ''}`;
}

function devView() {
  const st = store.state;
  return `<h2>Test controls</h2>
    <div class="card"><div class="controls">Speed
      ${[1, 60, 360, 1440].map((s) => `<button data-act="speed" data-v="${s}" ${st.clock.speed === s ? 'class="primary"' : ''}>${s}x</button>`).join('')}</div>
      <p class="small dim">1x is real time. 1440x makes a game day pass in one real minute.</p>
      <div class="controls">Skip ahead ${[60, 360, 1440, 7 * 1440].map((m) => `<button data-act="skip" data-v="${m}">+${dur(m)}</button>`).join('')}</div>
      <div class="controls">Play as <select id="as">${Object.values(st.players).map((x) => `<option value="${x.id}" ${x.id === store.me ? 'selected' : ''}>${esc(x.name)}${x.bot ? ' (bot)' : ''}</option>`).join('')}</select>
        <button data-act="as">Switch</button></div>
      <div class="controls"><button data-act="cheat">+5000 everything</button><button data-act="export">Export save</button><button data-act="import">Import save</button>
        <button class="danger" data-act="reset">Delete game</button></div></div>`;
}

// ---------------------------------------------------------------- events
function bind(view) {
  const pid = store.me;
  view.querySelectorAll('[data-max]').forEach((b) => (b.onclick = () => { document.getElementById(b.dataset.for).value = b.dataset.max; }));
  view.querySelectorAll('polygon[data-k]').forEach((h) => (h.onclick = () => { selected = h.dataset.k; render(true); }));
  view.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
    const a = b.dataset.act, val = (id) => document.getElementById(id)?.value;
    switch (a) {
      case 'build': return act((s) => E.build(s, pid, b.dataset.b), 'Construction started');
      case 'cancelBuild': return act((s) => E.cancelBuild(s, pid, Number(b.dataset.i)), 'Cancelled (75% refunded)');
      case 'train': return act((s) => E.train(s, pid, b.dataset.t, Number(val(`n-${b.dataset.t}`))), 'Training queued');
      case 'draft': return act((s) => E.draft(s, pid, Number(val('draft-n'))), 'Levies drafted');
      case 'release': return act((s) => E.release(s, pid, Number(val('draft-n'))), 'Levies sent back to work');
      case 'stance': return act((s) => E.setStance(s, pid, b.dataset.v));
      case 'research': return act((s) => E.research(s, pid, b.dataset.id), 'Research queued');
      case 'recall': return act((s) => E.recall(s, pid, Number(b.dataset.id)), 'Army recalled');
      case 'assault': return act((s) => E.orderAssault(s, pid, Number(b.dataset.id)), 'Assault ordered. Check reports.');
      case 'lift': return act((s) => E.liftSiege(s, pid, Number(b.dataset.id)), 'Siege lifted');
      case 'sally': { const u = readUnits(`sally-${b.dataset.id}`); return act((s) => E.sally(s, pid, Number(b.dataset.id), u), 'Sally resolved. Check reports.'); }
      case 'send': { const u = readUnits('send'); return act((s) => E.sendArmy(s, pid, selected, u), 'Army on the march'); }
      case 'cast': {
        const arg = b.dataset.spell === 'scry' ? val('scry-target') : b.dataset.arg ? Number(b.dataset.arg) : undefined;
        return act((s) => E.cast(s, pid, b.dataset.spell, arg), 'Spell cast');
      }
      case 'doctrine': return act((s) => E.setDoctrine(s, pid, {
        auto: document.getElementById('d-auto').checked, target: val('d-target'), siegeCastles: document.getElementById('d-siege').checked,
        homeGuard: Number(val('d-guard')) / 100, sendFrac: Number(val('d-send')) / 100, retreatAt: Number(val('d-retreat')) / 100,
        garrisonFrac: Number(val('d-garrison')) / 100, minRatio: Number(val('d-ratio')),
      }), 'Orders saved');
      // dev-only
      case 'speed': return act((s) => E.setSpeed(s, Number(b.dataset.v)), `Speed ${b.dataset.v}x`);
      case 'skip': return act((s) => E.skipTime(s, Number(b.dataset.v)), `Skipped ${dur(Number(b.dataset.v))}`);
      case 'as': store.switchPlayer(val('as')); return render(true);
      case 'cheat': return act((s) => { for (const r of RESOURCES) s.players[pid].res[r] += 5000; }, 'Riches!');
      case 'export': navigator.clipboard?.writeText(store.exportJSON()); return toast('Save copied to clipboard');
      case 'import': { const t = prompt('Paste save JSON'); if (t) { store.importJSON(t); render(true); } return; }
      case 'reset': if (confirm('Delete this local game?')) { store.reset(); location.reload(); } return;
    }
  }));
}
