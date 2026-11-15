// Local store: the whole world lives in this browser's localStorage. Good for
// solo testing against bots, hot-seat play, and fast-forwarding time.
import { createGame, advance } from './engine.js';

const KEY = 'bannerfall:local';

export function createLocalStore() {
  let state = null;
  try { state = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { state = null; }
  let lastSave = 0;
  const store = {
    kind: 'local',
    me: state?.me || null,
    get state() { return state; },
    newGame(opts) {
      state = createGame(opts);
      state.me = opts.players.find((p) => !p.bot).id;
      store.me = state.me;
      store.save(true);
    },
    tick() {                       // called by the UI loop
      if (!state) return;
      advance(state, Date.now());
      store.save();
    },
    async mutate(fn) {
      advance(state, Date.now());
      const out = fn(state);
      store.save(true);
      return out;
    },
    switchPlayer(pid) { state.me = pid; store.me = pid; store.save(true); },
    save(force) {
      if (!state) return;
      if (!force && Date.now() - lastSave < 5000) return;
      lastSave = Date.now();
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); }
    },
    reset() { localStorage.removeItem(KEY); state = null; store.me = null; },
    exportJSON() { return JSON.stringify(state); },
    importJSON(text) { state = JSON.parse(text); store.me = state.me || Object.keys(state.players)[0]; store.save(true); },
  };
  return store;
}
