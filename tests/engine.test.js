import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { resolveBattle } from '../js/battle.js';
import { UNITS } from '../js/data.js';
import { botThink } from '../js/ai.js';

const H = 3600000; // one real hour at speed 1 = one game hour
const newGame = (bots = false, seed = 'test') =>
  E.createGame({ seed, players: ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase(), bot: bots })), realNow: 0 });

test('advance is deterministic and chunk-independent', () => {
  E.registerBotBrain(botThink);
  const s1 = newGame(true), s2 = newGame(true);
  E.advance(s1, 72 * H);
  for (let h = 1; h <= 72; h++) E.advance(s2, h * H);
  assert.equal(JSON.stringify(s1), JSON.stringify(s2));
  E.registerBotBrain(null);
});

test('economy produces resources and peasants grow', () => {
  const s = newGame();
  const before = { ...s.players.a.res }, peas = s.players.a.peasants;
  E.advance(s, 10 * H);
  assert.ok(s.players.a.res.gold > before.gold);
  assert.ok(s.players.a.res.food > before.food);
  assert.ok(s.players.a.peasants > peas);
});

test('buildings respect keep lead and complete over time', () => {
  const s = newGame();
  const p = s.players.a;
  p.res = { gold: 1e6, food: 1e6, stone: 1e6, mana: 1e6 };
  for (let i = 0; i < 3; i++) E.build(s, 'a', 'farm');
  assert.throws(() => E.build(s, 'a', 'farm'), /Keep/);
  E.advance(s, 48 * H);
  assert.equal(p.buildings.farm, 4);
});

test('training consumes peasants and produces units; draft/release round-trips', () => {
  const s = newGame();
  const p = s.players.a;
  p.res.gold = 10000; p.res.food = 10000;
  const peas = p.peasants;
  E.train(s, 'a', 'militia', 10);
  assert.equal(p.peasants, peas - 10);
  E.advance(s, 2 * H);
  assert.equal(p.army.militia, 20);
  E.draft(s, 'a', 5);
  assert.equal(p.army.peasant, 5);
  E.release(s, 'a', 5);
  assert.equal(p.army.peasant, undefined);
});

// Equal-gold matchups for the counter loop.
function fight(aType, bType, gold = 3000, seed = 'x') {
  const n = (t) => Math.floor(gold / UNITS[t].cost.gold);
  const s = { rng: 42 };
  return resolveBattle({ units: { [aType]: n(aType) }, mods: {}, stance: 'battle', retreatAt: 0.2 },
    { units: { [bType]: n(bType) }, mods: {}, stance: 'battle', retreatAt: 0.2 }, { terrainDef: 0, wallUp: false }, s);
}
for (const [a, b] of [['pike', 'horsemen'], ['horsemen', 'archer'], ['crossbow', 'knight'], ['ballista', 'knight'], ['ballista', 'mage']]) {
  test(`counter: ${a} beats ${b} at equal gold (both as attacker and defender)`, () => {
    assert.equal(fight(a, b).winner, 'att');
    assert.equal(fight(b, a).winner, 'def');
  });
}

test('march captures a neutral tile and the rest of the army returns', () => {
  const s = newGame();
  const p = s.players.a;
  p.army = { militia: 200, archer: 60 };
  const target = E.visibleSet(s, 'a').values().next().value;
  const near = [...E.visibleSet(s, 'a')].find((k) => E.dist(k, p.capital) === 1 && s.tiles[k].terrain !== 'mountain');
  E.sendArmy(s, 'a', near, { militia: 100, archer: 30 });
  E.advance(s, 24 * H);
  assert.equal(s.tiles[near].owner, 'a');
  assert.ok(E.total(s.tiles[near].garrison) > 0);
  assert.ok(p.army.militia > 100, 'survivors came home');
  assert.ok(target);
});

function siegeSetup() {
  const s = newGame();
  const a = s.players.a, b = s.players.b;
  b.buildings.walls = 2; b.wallHp = E.wallMax(b);
  b.army = { militia: 30 };
  a.army = { catapult: 20, militia: 300, pike: 100 };
  // Teleport the march next to b's castle to keep the test fast.
  const m = E.sendArmy(s, 'a', b.capital, { catapult: 20, militia: 300, pike: 100 });
  m.arriveT = s.t + 60;
  return s;
}

test('siege breaks walls, assaults, and sacks the castle', () => {
  const s = siegeSetup();
  const goldBefore = s.players.b.res.gold;
  E.advance(s, 2 * H);
  assert.equal(s.sieges.length, 1);
  E.advance(s, 30 * H);
  assert.equal(s.sieges.length, 0);
  assert.equal(s.players.a.stats.sacks, 1);
  assert.ok(s.players.b.shieldUntil > s.t);
  assert.ok(s.reports.some((r) => /SACKED/.test(r.title)));
  assert.ok(goldBefore > 0);
});

test('defender can sally out and break a siege', () => {
  const s = siegeSetup();
  E.advance(s, 2 * H);
  const siege = s.sieges[0];
  s.players.b.army = { horsemen: 400, knight: 80 };
  const r = E.sally(s, 'b', siege.id, { horsemen: 400, knight: 80 });
  assert.equal(r.winner, 'att');
  assert.equal(s.sieges.length, 0);
});

test('hex of sloth delays an incoming march', () => {
  const s = siegeSetup();
  const b = s.players.b;
  const m = s.marches[0];
  m.arriveT = s.t + 600;
  b.techs.hex_of_sloth = true; b.res.mana = 1000;
  const before = m.arriveT;
  E.cast(s, 'b', 'hex', m.id);
  assert.ok(m.arriveT > before);
  assert.throws(() => E.cast(s, 'b', 'hex', m.id), /cooldown|Already/);
});

test('season ends and produces a ranking', () => {
  const s = E.createGame({ seed: 'end', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], realNow: 0, seasonDays: 1 });
  E.advance(s, 30 * H);
  assert.ok(s.ended);
  assert.equal(s.final.length, 2);
});

test('applyAction dispatches and validates', () => {
  const s = newGame();
  E.applyAction(s, 'a', { type: 'setStance', args: ['ward'] });
  assert.equal(s.players.a.stance, 'ward');
  assert.throws(() => E.applyAction(s, 'a', { type: 'nope' }));
});
