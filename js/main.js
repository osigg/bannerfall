// Entry point: setup screen (local or online) then hand off to the game UI.
import { registerBotBrain } from './engine.js';
import { botThink } from './ai.js';
import { createLocalStore } from './store-local.js';
import * as Online from './store-supabase.js';
import { startGameUI, toast } from './ui.js';

registerBotBrain(botThink);
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function boot() {
  const worldId = params.get('world');
  if (worldId && Online.onlineConfigured()) return bootOnline(worldId);
  const local = createLocalStore();
  if (local.state) return startGameUI(local, { dev: true });
  setupScreen(local);
}

function setupScreen(local) {
  $('#tabs').innerHTML = '';
  $('#top').innerHTML = '<div class="clock"><span>🏰 Bannerfall</span><span>a slow castle war for friends</span></div>';
  $('#view').innerHTML = `<div class="setup">
    <div class="card"><h3>Local test game</h3>
      <p class="small dim">Runs entirely in this browser. Bots play the other kingdoms; use the Dev tab to speed up time.</p>
      <label>Your name</label><input id="s-name" value="You">
      <label>Bot kingdoms</label><input id="s-bots" type="number" min="1" max="7" value="3">
      <label>Hot-seat humans besides you (switch in Dev tab)</label><input id="s-humans" type="number" min="0" max="5" value="0">
      <label>Speed</label><select id="s-speed"><option value="1">1x (real time)</option><option value="60">60x (1 day = 24 min)</option>
        <option value="360" selected>360x (1 day = 4 min)</option><option value="1440">1440x (1 day = 1 min)</option></select>
      <label>Season length (days)</label><input id="s-days" type="number" min="1" max="120" value="35">
      <label>Map seed</label><input id="s-seed" value="${Math.random().toString(36).slice(2, 8)}">
      <p><button class="primary" id="s-go">Start local game</button></p></div>
    <div class="card"><h3>Online with friends</h3>${Online.onlineConfigured()
      ? '<p class="small">Online play is configured.</p><button id="s-online">Sign in / pick a world</button>'
      : '<p class="small dim">Not configured. Add your Supabase URL and anon key to <code>js/config.js</code> (see README).</p>'}</div></div>`;
  $('#s-go').onclick = () => {
    const bots = Number($('#s-bots').value), humans = Number($('#s-humans').value);
    const players = [{ id: 'you', name: $('#s-name').value || 'You' }];
    for (let i = 0; i < humans; i++) players.push({ id: `h${i + 1}`, name: `Player ${i + 2}` });
    const names = ['Ironhold', 'Ashvale', 'Mirewatch', 'Stormcrest', 'Duskmoor', 'Highfen', 'Ravensgate'];
    for (let i = 0; i < bots; i++) players.push({ id: `bot${i}`, name: names[i % names.length], bot: true });
    local.newGame({ seed: $('#s-seed').value, players, speed: Number($('#s-speed').value), seasonDays: Number($('#s-days').value) });
    startGameUI(local, { dev: true });
  };
  if ($('#s-online')) $('#s-online').onclick = onlineLobby;
}

async function onlineLobby() {
  const user = await Online.currentUser();
  const v = $('#view');
  if (!user) {
    v.innerHTML = `<div class="setup card"><h3>Sign in</h3><p class="small dim">We'll email you a magic link.</p>
      <input id="o-email" type="email" placeholder="you@example.com"> <button class="primary" id="o-send">Send link</button></div>`;
    $('#o-send').onclick = async () => { try { await Online.signIn($('#o-email').value); toast('Check your email'); } catch (e) { toast(e.message); } };
    return;
  }
  const worlds = await Online.myWorlds();
  v.innerHTML = `<div class="setup">
    <div class="card"><h3>Your worlds</h3><ul class="list">${worlds.map((w) => `<li>${esc(w.worlds.name)} · <code>${w.world_id}</code><br>
      ${w.worlds.state ? `<a href="?world=${w.world_id}"><button class="primary">Play</button></a>`
        : `<span class="dim small">Lobby</span> <button data-lobby="${w.world_id}">Who's in?</button>${w.worlds.owner === user.id ? ` <button class="primary" data-start="${w.world_id}">Start season</button>` : ''}`}</li>`).join('') || '<li class="dim">None yet.</li>'}</ul></div>
    <div class="card"><h3>Create a world</h3><label>World name</label><input id="o-wname" value="The Realm">
      <label>Your kingdom name</label><input id="o-kname" value="">
      <label>Speed for this season</label><select id="o-speed"><option value="1">1x (real, recommended)</option><option value="24">24x (1 day/hour, for a test run)</option></select>
      <p><button class="primary" id="o-create">Create</button></p></div>
    <div class="card"><h3>Join with a code</h3><input id="o-code" placeholder="world code"> <input id="o-jname" placeholder="your kingdom name">
      <button id="o-join">Join</button></div>
    <button id="o-out">Sign out</button></div>`;
  v.querySelectorAll('[data-lobby]').forEach((b) => (b.onclick = async () => toast((await Online.lobby(b.dataset.lobby)).map((m) => m.name).join(', '), 5000)));
  v.querySelectorAll('[data-start]').forEach((b) => (b.onclick = async () => {
    try { await Online.startWorld(b.dataset.start, { speed: Number(sessionStorage.getItem(`speed:${b.dataset.start}`) || 1) }); location.search = `?world=${b.dataset.start}`; } catch (e) { toast(e.message); }
  }));
  $('#o-create').onclick = async () => {
    try {
      const id = await Online.createWorld($('#o-wname').value, $('#o-kname').value || user.email.split('@')[0]);
      sessionStorage.setItem(`speed:${id}`, $('#o-speed').value);
      toast('Created. Share the world code with friends.'); onlineLobby();
    } catch (e) { toast(e.message); }
  };
  $('#o-join').onclick = async () => { try { await Online.joinWorld($('#o-code').value.trim(), $('#o-jname').value || user.email.split('@')[0]); onlineLobby(); } catch (e) { toast(e.message); } };
  $('#o-out').onclick = async () => { await Online.signOut(); onlineLobby(); };
}

async function bootOnline(worldId) {
  try {
    if (!(await Online.currentUser())) { setupScreen(createLocalStore()); return onlineLobby(); }
    const store = await Online.createOnlineStore(worldId);
    startGameUI(store, { dev: false });
  } catch (e) {
    $('#view').innerHTML = `<div class="setup card"><p class="bad">${esc(e.message)}</p><a href="./">Back</a></div>`;
  }
}

boot();
