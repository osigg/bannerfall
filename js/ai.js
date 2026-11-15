// Simple deterministic bots so you can test a season solo and so the balance
// sim has opponents. They are deliberately mediocre: spend, build, expand.
import { BUILDINGS, UNITS, TECHS } from './data.js';
import * as E from './engine.js';
import { rand } from './rng.js';

const PERSONAS = {
  builder: { army: 0.25, mix: { militia: 3, archer: 2, pike: 1 }, aggro: 'expand' },
  warlord: { army: 0.5, mix: { militia: 2, pike: 2, archer: 2, horsemen: 1, knight: 1, catapult: 0.3 }, aggro: 'any' },
  mystic:  { army: 0.35, mix: { militia: 2, archer: 2, mage: 1, shield: 1, crossbow: 1 }, aggro: 'expand' },
};
const PERSONA_KEYS = Object.keys(PERSONAS);

export function botThink(state, pid) {
  const p = state.players[pid];
  const persona = PERSONAS[PERSONA_KEYS[(pid.charCodeAt(pid.length - 1) || 0) % PERSONA_KEYS.length]];
  const r = E.rates(state, pid);
  const safe = (fn) => { try { fn(); return true; } catch { return false; } };

  // Train with a share of gold, keeping enough peasants to staff the economy.
  const spare = Math.floor(p.peasants - r.laborNeed * 0.95);
  const qBusy = Object.values(p.trainQueues).reduce((a, q) => a + q.length, 0);
  if (spare > 3 && qBusy < 3 && r.net.food > 0 && r.net.gold > 5) {
    const reserve = E.buildCost('keep', p.buildings.keep + 1).gold * 0.8;
    const budget = Math.max(p.res.gold * 0.1, p.res.gold - reserve) * persona.army;
    const opts = Object.entries(persona.mix).filter(([t]) => !E.canTrain(p, t));
    if (opts.length) {
      const wsum = opts.reduce((a, [, w]) => a + w, 0);
      let roll = rand(state) * wsum, pick = opts[0][0];
      for (const [t, w] of opts) { roll -= w; if (roll <= 0) { pick = t; break; } }
      const n = Math.min(spare, Math.floor(budget / Math.max(1, UNITS[pick].cost.gold || 1)), 40);
      if (n > 0) safe(() => E.train(state, pid, pick, n));
    }
  }

  // Build: fix the worst problem first, otherwise grow the economy and keep.
  const slots = 1 + (E.mods(p).buildSlots || 0);
  if (p.buildQueue.length < slots + 1) {
    const urgent = [];
    if (r.net.food < 5) urgent.push('farm');
    if (p.peasants + E.total(E.allUnits(state, pid)) > E.popCap(p) * 0.85 || r.labor < 0.9) urgent.push('housing');
    if (r.net.gold < 10) urgent.push('market');
    let done = urgent.some((b) => safe(() => E.build(state, pid, b)));
    const keepL = E.queuedLevel(p, 'keep');
    const econ = ['farm', 'market', 'quarry', 'housing'];
    const wantKeep = econ.filter((b) => E.queuedLevel(p, b) >= keepL + 1).length >= 2;
    if (!done && wantKeep) done = safe(() => E.build(state, pid, 'keep')) || true; // save up for the keep
    if (!done) {
      const rest = [...econ, 'barracks', 'walls', 'range', 'magetower', 'watchtower', 'stables', 'workshop']
        .sort((a, b) => E.queuedLevel(p, a) - E.queuedLevel(p, b));
      for (const b of rest) if (safe(() => E.build(state, pid, b))) break;
    }
  }

  // Research: cheapest available.
  if (p.research.length < 1) {
    const opts = E.availableTechs(p).sort((a, b) => cost(TECHS[a].cost) - cost(TECHS[b].cost));
    for (const id of opts) if (safe(() => E.research(state, pid, id))) break;
  }

  // Doctrine: expand early, turn on rivals once the map fills up.
  const day = state.t / 1440;
  p.doctrine.target = day < 10 ? 'expand' : persona.aggro;
  p.doctrine.auto = r.net.gold > 0;   // stop grabbing land you cannot afford
  p.doctrine.siegeCastles = persona.aggro === 'any' && day > 14 && (p.army.catapult || 0) + (p.army.trebuchet || 0) > 2;
}

const cost = (c) => Object.values(c).reduce((a, b) => a + b, 0);
