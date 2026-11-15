// Prints an equal-value 1v1 matchup matrix (value = all resources + 30 per peasant consumed): row attacks column, cell = attacker survival % (or L for loss).
// Usage: node tools/matrix.js [gold=3000]
import { resolveBattle } from '../js/battle.js';
import { UNITS } from '../js/data.js';
const gold = Number(process.argv[2] || 3000);
const types = Object.keys(UNITS).filter((t) => UNITS[t].cost.gold && !['catapult', 'trebuchet', 'cannoneer'].includes(t));
const value = (t) => Object.entries(UNITS[t].cost).reduce((a, [r, v]) => a + v * (r === 'mana' ? 2 : 1), 0) + 30;
const n = (t) => Math.floor(gold / value(t));
console.log('att\\def'.padEnd(10) + types.map((t) => t.slice(0, 8).padStart(9)).join(''));
for (const a of types) {
  let row = a.padEnd(10);
  for (const d of types) {
    let wins = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const r = resolveBattle({ units: { [a]: n(a) }, mods: {}, stance: 'battle', retreatAt: 0.2 },
        { units: { [d]: n(d) }, mods: {}, stance: 'battle', retreatAt: 0.2 }, { terrainDef: 0, wallUp: false }, { rng: seed });
      if (r.winner === 'att') wins++;
    }
    row += `${wins}/5`.padStart(9);
  }
  console.log(row);
}
