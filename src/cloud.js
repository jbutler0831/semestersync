// Accounts and cloud sync (Supabase). Runs in the main process only; the page reaches it through preload IPC.
const { app, safeStorage, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const TABLE = 'user_docs';
// Google sends people back to this address after they sign in. Add it under
// Supabase → Authentication → URL Configuration → Redirect URLs.
const OAUTH_PORT = 53682;
const OAUTH_REDIRECT = `http://127.0.0.1:${OAUTH_PORT}/auth/callback`;

function readConfig() {
  let file = {};
  // Read fresh each time (not require) so filling in config.json takes effect without a restart.
  try { file = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch { /* optional */ }
  return {
    url: process.env.SUPABASE_URL || file.supabaseUrl || '',
    anonKey: process.env.SUPABASE_ANON_KEY || file.supabaseAnonKey || '',
  };
}

/* Supabase keeps its session (access + refresh token) here, encrypted with the OS keychain. */
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

function friendly(error) {
  const msg = (error && error.message) || '';
  if (/invalid login credentials/i.test(msg)) return 'That email and password don\'t match an account.';
  if (/email not confirmed/i.test(msg)) return 'Confirm your email first. Check your inbox for the link, then sign in.';
  if (/already registered|already exists/i.test(msg)) return 'An account with that email already exists. Sign in instead.';
  if (/password should be|weak password/i.test(msg)) return 'Choose a stronger password: at least 8 characters.';
  if (/rate limit|security purposes/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
  if (/token has expired|otp.*(expired|invalid)|invalid.*(otp|token)/i.test(msg)) return 'That code is wrong or has expired. Request a new one.';
  if (/same.*password|different from the old/i.test(msg)) return 'Choose a password you haven\'t used for this account before.';
  if (/provider is not enabled|unsupported provider/i.test(msg)) return 'Google sign-in isn\'t turned on for this app yet.';
  if (/EADDRINUSE/i.test(msg)) return 'Another sign-in is already open in your browser. Finish or close it, then try again.';
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(msg)) return 'Couldn\'t reach the account server. Check your internet connection.';
  return msg || 'Something went wrong. Try again.';
}

async function currentUser() {
  const c = getClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  const u = data && data.session && data.session.user;
  return u ? { id: u.id, email: u.email } : null;
}

function register(ipcMain) {
  ipcMain.handle('account:status', async () => ({ configured: !!getClient(), user: await currentUser() }));

  ipcMain.handle('account:sign-up', async (_e, { email, password }) => {
    const c = getClient();
    if (!c) return { ok: false, message: 'Accounts aren\'t set up in this build.' };
    const { data, error } = await c.auth.signUp({ email, password });
    if (error) return { ok: false, message: friendly(error) };
    if (!data.session) return { ok: true, needsConfirm: true };
    return { ok: true, user: { id: data.user.id, email: data.user.email } };
  });

  ipcMain.handle('account:sign-in', async (_e, { email, password }) => {
    const c = getClient();
    if (!c) return { ok: false, message: 'Accounts aren\'t set up in this build.' };
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: friendly(error) };
    return { ok: true, user: { id: data.user.id, email: data.user.email } };
  });

  ipcMain.handle('account:sign-out', async () => {
    const c = getClient();
    if (c) await c.auth.signOut({ scope: 'local' });
    return { ok: true };
  });

  // Row-level security in the database limits every query to the signed-in user's own rows.
  ipcMain.handle('cloud:list', async () => {
    const c = getClient(), u = await currentUser();
    if (!c || !u) return { ok: false, message: 'Not signed in' };
    const { data, error } = await c.from(TABLE).select('id, body');
    if (error) return { ok: false, message: friendly(error) };
    return { ok: true, docs: data };
  });

  ipcMain.handle('cloud:set', async (_e, { id, body }) => {
    const c = getClient(), u = await currentUser();
    if (!c || !u) return { ok: false, message: 'Not signed in' };
    const { error } = await c.from(TABLE).upsert({ user_id: u.id, id, body, updated_at: new Date().toISOString() });
    return error ? { ok: false, message: friendly(error) } : { ok: true };
  });

  ipcMain.handle('cloud:delete', async (_e, { id }) => {
    const c = getClient(), u = await currentUser();
    if (!c || !u) return { ok: false, message: 'Not signed in' };
    const { error } = await c.from(TABLE).delete().eq('id', id);
    return error ? { ok: false, message: friendly(error) } : { ok: true };
  });
}

/* ---------- Sign in with Google: system browser + loopback redirect (PKCE) ---------- */
const PAGE = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#edf0f4;color:#111a26}
main{background:#fff;padding:32px 36px;border-radius:14px;box-shadow:0 8px 30px -12px rgba(0,0,0,.25);max-width:420px;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#586577}</style><main><h1>${title}</h1><p>${body}</p></main>`;
let pendingOAuth = null; // { server, timer, reject }

function cancelOAuth(reason) {
  if (!pendingOAuth) return;
  const p = pendingOAuth; pendingOAuth = null;
  clearTimeout(p.timer); p.server.close();
  p.reject(new Error(reason || 'cancelled'));
}

function signInWithGoogle() {
  const c = getClient();
  if (!c) return Promise.resolve({ ok: false, message: 'Accounts aren\'t set up in this build.' });
  cancelOAuth('superseded');
  return new Promise(resolve => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, OAUTH_REDIRECT);
      if (url.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
      const code = url.searchParams.get('code');
      const err = url.searchParams.get('error_description') || url.searchParams.get('error');
      let result;
      if (err || !code) result = { ok: false, message: err ? friendly({ message: err }) : 'Google sign-in didn\'t finish.' };
      else {
        const { data, error } = await c.auth.exchangeCodeForSession(code);
        result = error ? { ok: false, message: friendly(error) } : { ok: true, user: { id: data.user.id, email: data.user.email } };
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(result.ok
        ? PAGE('You\'re signed in', 'Return to SemesterSync. You can close this tab.')
        : PAGE('Sign-in didn\'t finish', 'Return to SemesterSync and try again.'));
      clearTimeout(pendingOAuth && pendingOAuth.timer); pendingOAuth = null; server.close();
      resolve(result);
    });
    server.on('error', e => { pendingOAuth = null; resolve({ ok: false, message: friendly(e) }); });
    server.listen(OAUTH_PORT, '127.0.0.1', async () => {
      const timer = setTimeout(() => cancelOAuth('timeout'), 5 * 60 * 1000);
      pendingOAuth = { server, timer, reject: e => resolve({ ok: false, cancelled: e.message === 'cancelled', message: e.message === 'timeout' ? 'Google sign-in timed out. Try again.' : '' }) };
      const { data, error } = await c.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
      });
      if (error || !data.url) { cancelOAuth('failed'); resolve({ ok: false, message: friendly(error) }); return; }
      shell.openExternal(data.url);
    });
  });
}

function registerExtra(ipcMain) {
  ipcMain.handle('account:google', () => signInWithGoogle());
  ipcMain.on('account:google-cancel', () => cancelOAuth('cancelled'));

  // Forgot password: Supabase emails a one-time code; the person types it here with a new password.
  ipcMain.handle('account:reset-request', async (_e, { email }) => {
    const c = getClient();
    if (!c) return { ok: false, message: 'Accounts aren\'t set up in this build.' };
    const { error } = await c.auth.resetPasswordForEmail(email);
    // Don't reveal whether an account exists for this email; only surface rate limits and network trouble.
    if (error && /rate limit|security purposes|fetch failed|network/i.test(error.message || '')) return { ok: false, message: friendly(error) };
    return { ok: true };
  });
  ipcMain.handle('account:reset-complete', async (_e, { email, code, password }) => {
    const c = getClient();
    if (!c) return { ok: false, message: 'Accounts aren\'t set up in this build.' };
    const v = await c.auth.verifyOtp({ email, token: code, type: 'recovery' });
    if (v.error) return { ok: false, message: friendly(v.error) };
    const u = await c.auth.updateUser({ password });
    if (u.error) return { ok: false, message: friendly(u.error) };
    return { ok: true, user: { id: u.data.user.id, email: u.data.user.email } };
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
    if (!c) return { ok: false, message: 'Study rooms use the account server. Set up Supabase (see the README) first.' };
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

module.exports = { register: ipcMain => { register(ipcMain); registerExtra(ipcMain); registerRooms(ipcMain); } };
