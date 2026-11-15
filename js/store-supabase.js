// Online store backed by Supabase (Postgres + auth). One row per world holds
// the full JSON state plus a version number. Every action does
// read -> advance to now -> apply -> write-if-version-unchanged, retrying on
// conflict. Because advance() is deterministic, it does not matter which
// friend's browser catches the world up.
//
// UNTESTED against a live Supabase project at the time of writing. See README.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createGame, advance } from './engine.js';

let sb = null;
async function client() {
  if (sb) return sb;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return sb;
}

export const onlineConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export async function currentUser() {
  const c = await client();
  const { data } = await c.auth.getUser();
  return data.user || null;
}
export async function signIn(email) {
  const c = await client();
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0] } });
  if (error) throw error;
}
export async function signOut() { const c = await client(); await c.auth.signOut(); }

export async function createWorld(name, displayName) {
  const c = await client();
  const user = await currentUser();
  const { data, error } = await c.from('worlds').insert({ name, owner: user.id }).select().single();
  if (error) throw error;
  await joinWorld(data.id, displayName);
  return data.id;
}
export async function joinWorld(worldId, displayName) {
  const c = await client();
  const user = await currentUser();
  const { error } = await c.from('world_members').upsert({ world_id: worldId, user_id: user.id, name: displayName });
  if (error) throw error;
}
export async function myWorlds() {
  const c = await client();
  const user = await currentUser();
  const { data, error } = await c.from('world_members').select('world_id, name, worlds(name, state, owner)').eq('user_id', user.id);
  if (error) throw error;
  return data;
}
export async function lobby(worldId) {
  const c = await client();
  const { data, error } = await c.from('world_members').select('user_id, name').eq('world_id', worldId);
  if (error) throw error;
  return data;
}
// Host only: freeze the member list into a new season.
export async function startWorld(worldId, { speed = 1, seasonDays = 35 } = {}) {
  const c = await client();
  const members = await lobby(worldId);
  const state = createGame({ seed: worldId, speed, seasonDays, players: members.map((m) => ({ id: m.user_id, name: m.name })) });
  const { error } = await c.from('worlds').update({ state, version: 1 }).eq('id', worldId);
  if (error) throw error;
}

export async function createOnlineStore(worldId) {
  const c = await client();
  const user = await currentUser();
  let state = null, version = 0;

  async function pull() {
    const { data, error } = await c.from('worlds').select('state, version').eq('id', worldId).single();
    if (error) throw error;
    state = data.state; version = data.version;
  }
  await pull();
  if (!state) throw new Error('This world has not started yet. The host needs to press Start.');

  const store = {
    kind: 'online',
    me: user.id,
    worldId,
    get state() { return state; },
    tick() { advance(state, Date.now()); },          // local catch-up for display only
    async refresh() { await pull(); },
    async mutate(fn) {
      for (let attempt = 0; attempt < 4; attempt++) {
        await pull();
        advance(state, Date.now());
        const out = fn(state);
        const { data, error } = await c.from('worlds').update({ state, version: version + 1 })
          .eq('id', worldId).eq('version', version).select('version');
        if (error) throw error;
        if (data && data.length) { version += 1; return out; }
      }
      throw new Error('Too many conflicting updates; try again.');
    },
  };
  // Pick up other players' changes once a minute.
  setInterval(() => pull().catch(() => {}), 60000);
  return store;
}
