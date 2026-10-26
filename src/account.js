// SemesterSync accounts, talking to our own API (backend/). Runs in the main process only; the page
// reaches it through preload IPC and never sees the session token.
//
// The API address comes from SEMESTERSYNC_API_URL or "apiUrl" in config.json. Installed builds only
// accept https:// addresses; http:// works only for a server on this computer while developing.
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

function apiBase() {
  let file = {};
  try { file = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch { /* optional */ }
  const raw = process.env.SEMESTERSYNC_API_URL || file.apiUrl || '';
  let u;
  try { u = new URL(raw); } catch { return ''; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol === 'https:' || (u.protocol === 'http:' && local && !app.isPackaged)) return u.origin + u.pathname.replace(/\/+$/, '');
  return '';
}

/* The session token is kept in a file encrypted with the system keychain. Without a keychain it's
   kept in memory only, so you stay signed in until the app quits. */
const tokenFile = () => path.join(app.getPath('userData'), 'account.bin');
let memory = null; // { token, user }
let loaded = false;
async function readAuth() {
  if (loaded) return memory;
  loaded = true;
  if (!safeStorage.isEncryptionAvailable()) return memory;
  try {
    const obj = JSON.parse(safeStorage.decryptString(await fs.readFile(tokenFile())));
    if (obj && typeof obj.token === 'string' && obj.user && obj.user.id) memory = { token: obj.token, user: { id: String(obj.user.id), email: String(obj.user.email) } };
  } catch { /* none saved */ }
  return memory;
}
async function writeAuth(obj) {
  memory = obj; loaded = true;
  if (!obj) { await fs.rm(tokenFile(), { force: true }); return; }
  if (!safeStorage.isEncryptionAvailable()) return;
  await fs.mkdir(path.dirname(tokenFile()), { recursive: true });
  const tmp = tokenFile() + '.tmp';
  await fs.writeFile(tmp, safeStorage.encryptString(JSON.stringify(obj)), { mode: 0o600 });
  await fs.rename(tmp, tokenFile());
}

const OFFLINE = 'Couldn’t reach the SemesterSync account server. Check your internet connection and try again.';
const deviceName = () => `${process.platform === 'darwin' ? 'Mac' : process.platform === 'win32' ? 'Windows PC' : 'Computer'} · SemesterSync ${app.getVersion()}`;
const userOf = u => ({ id: String(u.id), email: String(u.email) });

// Every request: JSON in and out, a time limit, no redirects (so the token can't be sent somewhere else).
async function call(method, route, body, { token, timeout = 15000 } = {}) {
  const base = apiBase();
  if (!base) return { ok: false, status: 0, code: 'not_configured', message: 'Accounts aren’t set up in this build yet. Everything still works and saves on this computer.' };
  let res;
  try {
    res = await fetch(base + route, {
      method, redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { return { ok: false, status: 0, code: 'offline', message: OFFLINE }; }
  let data = null;
  try { data = await res.json(); } catch { /* empty or not JSON */ }
  if (res.ok) return { ok: true, status: res.status, data };
  const err = (data && data.error) || {};
  return { ok: false, status: res.status, code: err.code || 'error', message: err.message || (res.status >= 500 ? 'The account server had a problem. Try again in a moment.' : 'Something went wrong. Try again.') };
}
const fail = r => ({ ok: false, code: r.code, message: r.message });

// Calls that need the person's session. A rejected session signs this computer out.
async function authed(method, route, body, timeout) {
  const a = await readAuth();
  if (!a) return { ok: false, status: 401, code: 'unauthorized', message: 'Sign in first.' };
  const r = await call(method, route, body, { token: a.token, timeout });
  if (r.status === 401 && r.code === 'unauthorized') { await writeAuth(null); r.signedOut = true; }
  return r;
}
let syncAvailable = false; // remembered from the last check, so offline computers keep their sync status
const clean = s => String(s ?? '').trim().slice(0, 320);
const secret = s => String(s ?? '').slice(0, 200);

async function signedIn(data) {
  const user = userOf(data.user);
  await writeAuth({ token: data.token, user });
  return { ok: true, user };
}

const api = {
  async status() {
    const configured = !!apiBase();
    const a = configured ? await readAuth() : null;
    if (!a) return { configured, user: null, sync: false };
    // Check the session is still good; offline, trust the saved one.
    const r = await authed('GET', '/v1/account', null);
    if (r.ok) {
      const user = userOf(r.data);
      syncAvailable = r.data.sync_available === true;
      if (user.email !== a.user.email) await writeAuth({ token: a.token, user });
      return { configured, user, sync: syncAvailable };
    }
    return { configured, user: r.signedOut ? null : a.user, sync: syncAvailable, offline: r.code === 'offline' };
  },
  async signUp({ email, password }) {
    const r = await call('POST', '/v1/auth/register', { email: clean(email), password: secret(password) });
    return r.ok ? { ok: true, needsCode: true } : fail(r);
  },
  async verify({ email, code }) {
    const r = await call('POST', '/v1/auth/verify', { email: clean(email), code: clean(code).replace(/\s/g, ''), device: deviceName() });
    return r.ok ? signedIn(r.data) : fail(r);
  },
  async resend({ email }) {
    const r = await call('POST', '/v1/auth/resend', { email: clean(email) });
    return r.ok ? { ok: true } : fail(r);
  },
  async signIn({ email, password }) {
    const r = await call('POST', '/v1/auth/login', { email: clean(email), password: secret(password), device: deviceName() });
    if (r.ok) return signedIn(r.data);
    if (r.code === 'email_not_verified') return { ok: false, needsCode: true, message: r.message };
    return fail(r);
  },
  async signOut() {
    const a = await readAuth();
    if (a) await call('POST', '/v1/auth/logout', null, { token: a.token, timeout: 5000 }); // best effort: offline still signs out here
    await writeAuth(null);
    return { ok: true };
  },
  async requestReset({ email }) {
    const r = await call('POST', '/v1/auth/password-reset/request', { email: clean(email) });
    return r.ok ? { ok: true } : fail(r);
  },
  async completeReset({ email, code, password }) {
    const r = await call('POST', '/v1/auth/password-reset/confirm', { email: clean(email), code: clean(code).replace(/\s/g, ''), new_password: secret(password) });
    if (!r.ok) return fail(r);
    await writeAuth(null);
    return api.signIn({ email, password });
  },
  async changePassword({ current, next }) {
    const r = await authed('POST', '/v1/account/password', { current_password: secret(current), new_password: secret(next) });
    return r.ok ? { ok: true } : fail(r);
  },
  async sessions() {
    const r = await authed('GET', '/v1/account/sessions', null);
    if (!r.ok) return fail(r);
    return { ok: true, sessions: (Array.isArray(r.data) ? r.data : []).map(s => ({ id: String(s.id), device: String(s.device || ''), lastSeen: s.last_seen_at, created: s.created_at, current: !!s.current })) };
  },
  async revokeSession({ id }) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) return { ok: false, message: 'That device isn’t signed in.' };
    const r = await authed('DELETE', '/v1/account/sessions/' + id, null);
    return r.ok ? { ok: true } : fail(r);
  },
  async revokeOthers() {
    const r = await authed('POST', '/v1/account/sessions/revoke-others', null);
    return r.ok ? { ok: true } : fail(r);
  },
  /* Sync: the page sends and receives documents; the server decides whose they are from the session. */
  async syncChanges({ since }) {
    const r = await authed('GET', '/v1/sync/changes?since=' + Math.max(0, Math.floor(+since || 0)), null);
    return r.ok ? { ok: true, ...r.data } : { ...fail(r), signedOut: !!r.signedOut };
  },
  async syncPush({ changes }) {
    if (!Array.isArray(changes) || changes.length > 50) return { ok: false, message: 'Too many changes at once.' };
    const list = changes.map(c => ({ doc_id: String(c.doc_id), base_version: Math.max(0, Math.floor(+c.base_version || 0)), ...(c.deleted ? { deleted: true } : { body: String(c.body) }) }));
    const r = await authed('POST', '/v1/sync/push', { changes: list }, 60000);
    return r.ok ? { ok: true, ...r.data } : { ...fail(r), signedOut: !!r.signedOut };
  },
  async syncUsage() {
    const r = await authed('GET', '/v1/sync/usage', null);
    return r.ok ? { ok: true, ...r.data } : fail(r);
  },
  async syncClear({ password }) {
    const r = await authed('POST', '/v1/sync/clear', { password: secret(password) });
    return r.ok ? { ok: true } : fail(r);
  },
  async deleteAccount({ password }) {
    const r = await authed('POST', '/v1/account/delete', { password: secret(password) });
    if (!r.ok) return fail(r);
    await writeAuth(null);
    return { ok: true };
  },
};

function register(ipcMain) {
  const routes = {
    'account:status': 'status', 'account:sign-up': 'signUp', 'account:verify': 'verify', 'account:resend': 'resend',
    'account:sign-in': 'signIn', 'account:sign-out': 'signOut', 'account:reset-request': 'requestReset',
    'account:reset-complete': 'completeReset', 'account:change-password': 'changePassword', 'account:sessions': 'sessions',
    'account:revoke-session': 'revokeSession', 'account:revoke-others': 'revokeOthers', 'account:delete': 'deleteAccount',
    'sync:changes': 'syncChanges', 'sync:push': 'syncPush', 'sync:usage': 'syncUsage', 'sync:clear': 'syncClear',
  };
  for (const [ch, fn] of Object.entries(routes)) ipcMain.handle(ch, (_e, args) => api[fn](args || {}));
}

module.exports = { register, api, apiBase };
