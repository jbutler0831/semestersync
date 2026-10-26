// What's left of Supabase: study rooms (Realtime presence and broadcast, nothing stored), and a one-time
// copy of an old Supabase account's courses to this computer. Accounts themselves use our own API (account.js).
// Both are temporary: rooms move to our own server in a later stage, then this file and the Supabase project go.
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const TABLE = 'user_docs';
function readConfig() {
  let file = {};
  // Read fresh each time (not require) so filling in config.json takes effect without a restart.
  try { file = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch { /* optional */ }
  return {
    url: process.env.SUPABASE_URL || file.supabaseUrl || '',
    anonKey: process.env.SUPABASE_ANON_KEY || file.supabaseAnonKey || '',
  };
}

/* An old Supabase sign-in (access + refresh token), encrypted with the OS keychain. */
const sessionFile = () => path.join(app.getPath('userData'), 'session.bin');
let queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn, fn));
async function readSession() {
  try {
    const buf = await fs.readFile(sessionFile());
    return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8'));
  } catch { return {}; }
}
async function writeSession(obj) {
  const text = JSON.stringify(obj);
  await fs.mkdir(path.dirname(sessionFile()), { recursive: true });
  await fs.writeFile(sessionFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text), { mode: 0o600 });
  await fs.chmod(sessionFile(), 0o600); // owner-only, also for files written by older builds
}
const sessionStorage = {
  getItem: key => serial(async () => (await readSession())[key] ?? null),
  setItem: (key, value) => serial(async () => { const s = await readSession(); s[key] = value; await writeSession(s); }),
  removeItem: key => serial(async () => { const s = await readSession(); delete s[key]; await writeSession(s); }),
};

let client = null;
function getClient() {
  const { url, anonKey } = readConfig();
  if (!url || !anonKey) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { storage: sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
    });
  }
  return client;
}

/* ---------- Old Supabase accounts: copy their courses to this computer, once ---------- */
async function hasSession() {
  try { await fs.access(sessionFile()); return true; } catch { return false; }
}
function registerLegacy(ipcMain) {
  ipcMain.handle('legacy:status', async () => {
    if (!(await hasSession())) return { session: false };
    const c = getClient();
    if (!c) return { session: true, email: '' };
    const { data } = await c.auth.getSession().catch(() => ({ data: null }));
    const u = data && data.session && data.session.user;
    return { session: true, email: u ? String(u.email || '') : '' };
  });
  // Row-level security limits this to the signed-in person's own rows.
  ipcMain.handle('legacy:export', async () => {
    const c = getClient();
    if (!c || !(await hasSession())) return { ok: false, message: 'No old account on this computer.' };
    try {
      const { data: s } = await c.auth.getSession();
      if (!s || !s.session) return { ok: false, code: 'signed_out', message: 'The old account’s sign-in has expired.' };
      const { data, error } = await c.from(TABLE).select('id, body');
      if (error) return { ok: false, message: 'Couldn’t reach the old account.' };
      return { ok: true, docs: (data || []).map(x => ({ id: String(x.id), body: x.body })) };
    } catch { return { ok: false, message: 'Couldn’t reach the old account.' }; }
  });
  // Ends the old sign-in on this computer and deletes its saved session.
  ipcMain.handle('legacy:forget', async () => {
    const c = getClient();
    if (c) { try { await c.auth.signOut({ scope: 'local' }); } catch { /* offline: deleting the file is enough */ } }
    await fs.rm(sessionFile(), { force: true });
    client = null;
    return { ok: true };
  });
}

/* ---------- Study rooms (Supabase Realtime presence + broadcast; nothing is stored) ---------- */
let room = null; // { channel, key, name }
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, n);
// Everything from other people is untrusted: keep only short strings and a well-formed timer.
function cleanPresence(p) {
  const t = p && p.timer;
  const timer = t && (t.mode === 'focus' || t.mode === 'break') && Number.isFinite(+t.ends) ? { mode: t.mode, ends: +t.ends } : null;
  return { name: clip(p && p.name, 32), task: clip(p && p.task, 120), timer };
}
async function leaveRoom() {
  if (!room) return { ok: true };
  const r = room; room = null;
  try { await r.channel.untrack(); } catch { /* already gone */ }
  try { await getClient().removeChannel(r.channel); } catch { /* already gone */ }
  return { ok: true };
}
function registerRooms(ipcMain) {
  ipcMain.handle('room:join', async (event, { code }) => {
    const c = getClient();
    if (!c) return { ok: false, message: 'Study rooms aren’t set up in this build.' };
    code = clip(code, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) return { ok: false, message: 'Room codes are at least 4 letters or numbers.' };
    await leaveRoom();
    const key = require('node:crypto').randomUUID();
    const sender = event.sender;
    const send = (name, data) => { if (!sender.isDestroyed()) sender.send('room:' + name, data); };
    const channel = c.channel('study-' + code, { config: { presence: { key }, broadcast: { self: false } } });
    channel.on('presence', { event: 'sync' }, () => {
      const peers = Object.entries(channel.presenceState()).slice(0, 50)
        .map(([k, metas]) => ({ id: k, me: k === key, ...cleanPresence(metas[metas.length - 1]) }));
      send('peers', peers);
    });
    channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
      const text = clip(payload && payload.text, 500);
      if (text) send('message', { id: clip(payload.from, 40), name: clip(payload.name, 32), text, at: Date.now() });
    });
    const status = await new Promise(resolve => {
      let first = true;
      const timer = setTimeout(() => { if (first) { first = false; resolve('TIMED_OUT'); } }, 10000);
      channel.subscribe(s => {
        if (first && ['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(s)) { first = false; clearTimeout(timer); resolve(s); return; }
        if (room && room.channel === channel) send('connection', s === 'SUBSCRIBED');
      });
    });
    if (status !== 'SUBSCRIBED') {
      try { await c.removeChannel(channel); } catch { /* never connected */ }
      return { ok: false, message: 'Couldn\'t connect to the study room. Check your internet connection and try again.' };
    }
    room = { channel, key, name: '' };
    return { ok: true };
  });
  ipcMain.handle('room:presence', async (_e, p) => {
    if (!room) return { ok: false };
    const clean = cleanPresence(p);
    room.name = clean.name;
    const res = await room.channel.track(clean);
    return { ok: res === 'ok' };
  });
  ipcMain.handle('room:send', async (_e, { text }) => {
    if (!room) return { ok: false, code: 'not_connected', message: 'Not in a room' };
    const res = await room.channel.send({ type: 'broadcast', event: 'chat', payload: { from: room.key, name: room.name, text: clip(text, 500) } });
    return res === 'ok' ? { ok: true } : { ok: false, code: 'upstream_error', message: 'Message didn\'t send.' };
  });
  ipcMain.handle('room:leave', leaveRoom);
}

module.exports = { register: ipcMain => { registerLegacy(ipcMain); registerRooms(ipcMain); } };
