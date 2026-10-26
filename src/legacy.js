// What's left of Supabase: a one-time copy of an old Supabase account's courses (versions 1.0 to 1.4) to this
// computer. Accounts, sync and study rooms use our own server (account.js, rooms.js). This file and the
// Supabase project can go once people have had time to upgrade.
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

module.exports = { register: registerLegacy };
