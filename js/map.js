// Hex map on axial coordinates (q, r). Tile keys are "q,r".
import { TERRAIN, CONFIG } from './data.js';
import { rand } from './rng.js';

export const key = (q, r) => `${q},${r}`;
export const parse = (k) => k.split(',').map(Number);
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function dist(a, b) {
  const [q1, r1] = typeof a === 'string' ? parse(a) : a;
  const [q2, r2] = typeof b === 'string' ? parse(b) : b;
  return (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(q1 + r1 - q2 - r2)) / 2;
}

export function neighbors(state, k) {
  const [q, r] = parse(k);
  return DIRS.map(([dq, dr]) => key(q + dq, r + dr)).filter((n) => state.tiles[n]);
}

export function generateMap(state, playerIds) {
  const R = Math.max(5, 2 + Math.round(playerIds.length * 1.5));
  state.radius = R;
  const tiles = {};
  const total = Object.values(TERRAIN).reduce((s, t) => s + t.weight, 0);
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      let roll = rand(state) * total, terrain = 'plains';
      for (const [name, t] of Object.entries(TERRAIN)) { roll -= t.weight; if (roll <= 0) { terrain = name; break; } }
      tiles[key(q, r)] = { terrain, owner: null, garrison: {}, unrestUntil: 0 };
    }
  }
  state.tiles = tiles;

  // Capitals on a ring at ~2/3 radius, evenly spaced, forced to plains with plains around them.
  const ringR = Math.round(R * 0.66);
  const ring = [];
  let [q, r] = [-ringR, ringR];
  for (let side = 0; side < 6; side++) {
    for (let i = 0; i < ringR; i++) { ring.push(key(q, r)); q += DIRS[side][0]; r += DIRS[side][1]; }
  }
  const offset = Math.floor(rand(state) * ring.length);
  playerIds.forEach((pid, i) => {
    const k = ring[(offset + Math.floor((i * ring.length) / playerIds.length)) % ring.length];
    const t = tiles[k];
    t.terrain = 'plains'; t.owner = pid; t.capital = pid;
    for (const n of neighbors(state, k)) if (tiles[n].terrain === 'mountain') tiles[n].terrain = 'plains';
    state.players[pid].capital = k;
  });

  // Neutral barbarian garrisons scale with distance from the nearest capital.
  const caps = playerIds.map((p) => state.players[p].capital);
  for (const [k, t] of Object.entries(tiles)) {
    if (t.owner || t.terrain === 'mountain') continue;
    const d = Math.min(...caps.map((c) => dist(c, k)));
    const s = Math.pow(d, CONFIG.BARBARIAN_SCALE);
    t.garrison = { militia: Math.round(6 * s), archer: Math.round(2 * s) };
    if (d >= 4) t.garrison.pike = Math.round(1.5 * s);
    if (d >= 6) t.garrison.horsemen = Math.round(0.8 * s);
  }
}

// Weighted shortest path (Dijkstra on move cost). Returns { path, cost } or null.
export function findPath(state, from, to) {
  const costs = { [from]: 0 }, prev = {};
  const open = new Set([from]);
  while (open.size) {
    let cur = null;
    for (const k of open) if (cur === null || costs[k] < costs[cur]) cur = k;
    open.delete(cur);
    if (cur === to) break;
    for (const n of neighbors(state, cur)) {
      const m = TERRAIN[state.tiles[n].terrain].move;
      if (!isFinite(m)) continue;
      const c = costs[cur] + m;
      if (costs[n] === undefined || c < costs[n]) { costs[n] = c; prev[n] = cur; open.add(n); }
    }
  }
  if (costs[to] === undefined) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return { path, cost: costs[to] };
}

export function ownedTiles(state, pid) {
  return Object.keys(state.tiles).filter((k) => state.tiles[k].owner === pid);
}

// Tiles a player can currently see.
export function visibleSet(state, pid, visionBonus = 0) {
  const vis = new Set();
  const radius = 2 + visionBonus;
  const owned = ownedTiles(state, pid);
  for (const k of Object.keys(state.tiles)) {
    if (owned.some((o) => dist(o, k) <= radius)) vis.add(k);
  }
  for (const m of state.marches) if (m.owner === pid) for (const k of m.path) vis.add(k);
  return vis;
}
