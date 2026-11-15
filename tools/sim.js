// Balance sim: run a full season with bots and print a daily snapshot.
// Usage: node tools/sim.js [players=4] [days=35] [seed=sim]
import { createGame, advance, registerBotBrain, rates, score, ownedTiles, mods } from '../js/engine.js';
import { botThink } from '../js/ai.js';

registerBotBrain(botThink);
const N = Number(process.argv[2] || 4), DAYS = Number(process.argv[3] || 35), SEED = process.argv[4] || 'sim';
const players = Array.from({ length: N }, (_, i) => ({ id: `p${i}`, name: `Bot${i}`, bot: true }));
const t0 = 0;
const state = createGame({ seed: SEED, players, speed: 1, realNow: t0, seasonDays: DAYS });
const started = Date.now();
const pad = (s, n) => String(s).padStart(n);

for (let day = 1; day <= DAYS; day++) {
  advance(state, t0 + day * 86400000);
  if (day % 5 === 0 || day === 1 || day === DAYS) {
    console.log(`--- day ${day}`);
    for (const pid of Object.keys(state.players)) {
      const p = state.players[pid], r = rates(state, pid);
      const army = Object.values(p.army).reduce((a, b) => a + b, 0);
      console.log(`${p.name}: keep ${pad(p.buildings.keep, 2)} farm ${pad(p.buildings.farm, 2)} mkt ${pad(p.buildings.market, 2)} ` +
        `walls ${pad(p.buildings.walls, 2)} tiles ${pad(ownedTiles(state, pid).length, 3)} peas ${pad(Math.floor(p.peasants), 4)} ` +
        `army ${pad(Math.floor(army), 4)} gold/h ${pad(r.net.gold.toFixed(0), 5)} food/h ${pad(r.net.food.toFixed(0), 5)} ` +
        `techs ${pad(Object.keys(p.techs).length, 2)} sacks ${p.stats.sacks} kills ${p.stats.kills} score ${score(state, pid)}`);
    }
  }
}
const sieges = state.reports.filter((r) => /siege|SACKED|held the castle/.test(r.title)).length;
const caps = state.reports.filter((r) => /captured/.test(r.title)).length, pvp = state.reports.filter((r) => /captured.* from /.test(r.title)).length;
console.log(`captures ${caps} (pvp ${pvp}), siege events ${sieges}, sim time ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (state.final) console.log('final', state.final.map((f) => `${state.players[f.pid].name}:${f.score}`).join(' '));
