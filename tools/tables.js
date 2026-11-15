// Prints markdown tables of the live game data (used to keep docs/DESIGN.md honest).
import { UNITS, BUILDINGS, TECHS, CONFIG } from '../js/data.js';
import { buildCost, buildTime } from '../js/engine.js';
const c = (o) => Object.entries(o).map(([k, v]) => `${v} ${k}`).join(', ') || '-';
const dur = (m) => (m >= 1440 ? `${(m / 1440).toFixed(1)}d` : m >= 60 ? `${(m / 60).toFixed(1)}h` : `${m}m`);
console.log('| Unit | Atk | HP | Armor | Speed (hex/h) | Siege | Fires in | Cost | Train | Upkeep/h | Unlock |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const [t, u] of Object.entries(UNITS)) {
  const fires = [u.volley ? `volley ${u.volley.join('/')}` : '', u.charge ? `charge x${u.charge}` : '', u.melee ? `melee x${u.melee}` : ''].filter(Boolean).join(', ');
  const unlock = u.building ? `${BUILDINGS[u.building].name} ${u.unlock}${u.needs ? `, Stables ${u.needs.stables}` : ''}${u.tech ? `, ${TECHS[u.tech].name}` : ''}` : 'draft';
  console.log(`| ${u.name} | ${u.atk} | ${u.hp} | ${u.armor} | ${u.speed} | ${u.siege || '-'} | ${fires} | ${c(u.cost)} | ${u.time ? `${u.time}m` : 'instant'} | ${c(u.upkeep)} | ${unlock} |`);
}
console.log('\n| Building | Lv 2 cost | Lv 5 cost | Lv 10 cost | Lv 15 cost | Time Lv 5 / 10 / 15 / 20 |');
console.log('|---|---|---|---|---|---|');
for (const b of Object.keys(BUILDINGS)) {
  console.log(`| ${BUILDINGS[b].name} | ${c(buildCost(b, 2))} | ${c(buildCost(b, 5))} | ${c(buildCost(b, 10))} | ${c(buildCost(b, 15))} | ${[5, 10, 15, 20].map((l) => dur(buildTime(b, l))).join(' / ')} |`);
}
const trees = {};
for (const [id, t] of Object.entries(TECHS)) (trees[t.tree] ||= []).push(t);
for (const [tree, list] of Object.entries(trees)) {
  console.log(`\n**${tree}**\n\n| Tech | Keep | Requires | Cost | Time | Effect |\n|---|---|---|---|---|---|`);
  for (const t of list) console.log(`| ${t.name} | ${t.keep} | ${(t.req || []).map((r) => TECHS[r].name).join(', ') || '-'} | ${c(t.cost)} | ${dur(t.time)} | ${JSON.stringify(t.effects).replace(/[{}"]/g, '') || 'unlocks gunpowder units'} |`);
}
