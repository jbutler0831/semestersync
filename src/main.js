const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, nativeImage, safeStorage, nativeTheme, globalShortcut, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk');
const legacy = require('./legacy');
const rooms = require('./rooms');
const account = require('./account');

const isMac = process.platform === 'darwin';
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const MODEL = 'claude-opus-5-5';

// The app was first released as "Syllabus Sync". Keep using that data folder so people
// who update keep their saved courses, settings and sign-in.
// SEMESTERSYNC_DATA_DIR runs the app on a separate profile (for testing) without touching your data.
app.setPath('userData', process.env.SEMESTERSYNC_DATA_DIR || path.join(app.getPath('appData'), 'Syllabus Sync'));

let win = null;
const inflight = new Map(); // request id -> AbortController

/* ---------- Settings (API key encrypted with the OS keychain via safeStorage) ---------- */
async function readSettings() {
  try { return JSON.parse(await fs.readFile(SETTINGS_FILE(), 'utf8')); } catch { return {}; }
}
async function writeSettings(s) {
  await fs.mkdir(path.dirname(SETTINGS_FILE()), { recursive: true });
  await fs.writeFile(SETTINGS_FILE(), JSON.stringify(s, null, 2));
}
async function getApiKey() {
  const s = await readSettings();
  if (s.apiKey && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(s.apiKey, 'base64')); } catch { /* fall through */ }
  }
  return process.env.ANTHROPIC_API_KEY || null;
}

/* ---------- Claude extraction ---------- */
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const SYLLABUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'title', 'categories', 'items'],
  properties: {
    code: { type: 'string' },
    title: { type: 'string' },
    categories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'pct', 'count'],
        properties: { label: { type: 'string' }, pct: { type: 'number' }, count: nullable({ type: 'integer' }) },
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'type', 'date', 'time', 'category', 'weight', 'ungraded', 'notes', 'line', 'confidence'],
        properties: {
          title: { type: 'string' },
          type: { type: 'string', enum: ['Exam', 'Quiz', 'Lab', 'Project', 'Paper', 'Reading', 'Homework', 'Other'] },
          date: { type: 'string' },
          time: { type: 'string' },
          category: nullable({ type: 'string' }),
          weight: { type: 'number' },
          ungraded: { type: 'boolean' },
          notes: { type: 'string' },
          line: { type: 'integer' },
          confidence: { type: 'integer' },
        },
      },
    },
  },
};

function errorCode(err) {
  if (err && err.name === 'AbortError') return 'cancelled';
  if (err instanceof Anthropic.APIUserAbortError) return 'cancelled';
  if (err instanceof Anthropic.AuthenticationError) return 'not_granted';
  if (err instanceof Anthropic.PermissionDeniedError) return 'not_granted';
  if (err instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (err instanceof Anthropic.BadRequestError) return /too long|too large|context/i.test(err.message) ? 'prompt_too_large' : 'invalid_request';
  if (err instanceof Anthropic.APIConnectionError) return 'upstream_error';
  if (err instanceof Anthropic.APIError) return 'upstream_error';
  return 'upstream_error';
}

ipcMain.handle('claude:available', async () => !!(await getApiKey()));

ipcMain.handle('claude:extract', async (event, { id, prompt }) => {
  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, code: 'not_granted', message: 'Add a Claude API key in Settings.' };
  const ctl = new AbortController();
  inflight.set(id, ctl);
  try {
    const client = new Anthropic({ apiKey });
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SYLLABUS_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    }, { signal: ctl.signal });
    let chars = 0;
    stream.on('text', delta => {
      chars += delta.length;
      if (!event.sender.isDestroyed()) event.sender.send('claude:progress', { id, chars });
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') return { ok: false, code: 'refused', message: 'Claude declined this request.' };
    if (message.stop_reason === 'max_tokens') return { ok: false, code: 'invalid_json', message: 'The reply was cut off.' };
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    try { return { ok: true, data: JSON.parse(text) }; }
    catch { return { ok: false, code: 'invalid_json', message: 'Claude returned malformed JSON.' }; }
  } catch (err) {
    return { ok: false, code: errorCode(err), message: err && err.message ? String(err.message).slice(0, 300) : 'Request failed' };
  } finally {
    inflight.delete(id);
  }
});

ipcMain.on('claude:cancel', (_e, id) => { const c = inflight.get(id); if (c) c.abort(); });

// Scanned PDFs have no text layer: Claude reads the pages and returns the text, line by line.
ipcMain.handle('claude:transcribe-pdf', async (_e, bytes) => {
  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, message: 'Add a Claude API key in Settings to read scanned PDFs.' };
  if (!bytes || bytes.byteLength > 30 * 1024 * 1024) return { ok: false, message: 'That PDF is over 30 MB. Export a smaller copy and try again.' };
  try {
    const client = new Anthropic({ apiKey });
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } },
          { type: 'text', text: 'This is a scanned course syllabus. Transcribe all of its text exactly as written, keeping the original line breaks and the order of the page, including tables (one table row per line). Reply with the transcription only, no commentary.' },
        ],
      }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') return { ok: false, message: 'Claude declined to read this file.' };
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return text ? { ok: true, text } : { ok: false, message: 'Claude couldn\'t find any text in this PDF.' };
  } catch (err) {
    const code = errorCode(err);
    return { ok: false, message: code === 'not_granted' ? 'Your Claude API key was rejected. Check it in Settings.' : code === 'rate_limited' ? 'Claude is busy. Try again in a minute.' : 'Couldn\'t reach Claude to read the scan. Check your connection.' };
  }
});

// Everything else the page asks Claude: the semester coach, study sets and photos of a syllabus.
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
ipcMain.handle('claude:ask', async (event, { id, messages, images, schema, effort }) => {
  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, code: 'not_granted', message: 'Add a Claude API key in Settings.' };
  if (!Array.isArray(messages) || !messages.length || messages.length > 40) return { ok: false, code: 'invalid_request', message: 'Bad request' };
  const turns = messages.map(m => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: String((m && m.content) || '').slice(0, 60000) || '…' }));
  if (turns[0].role !== 'user' || turns[turns.length - 1].role !== 'user') return { ok: false, code: 'invalid_request', message: 'Bad request' };
  if (Array.isArray(images) && images.length) {
    const blocks = images.slice(0, 8)
      .filter(im => im && IMAGE_TYPES.includes(im.type) && im.data && im.data.byteLength <= MAX_IMAGE_BYTES)
      .map(im => ({ type: 'image', source: { type: 'base64', media_type: im.type, data: Buffer.from(im.data).toString('base64') } }));
    if (!blocks.length) return { ok: false, code: 'image_rejected', message: 'That image type or size isn\'t supported.' };
    const last = turns[turns.length - 1];
    last.content = [...blocks, { type: 'text', text: last.content }];
  }
  const format = schema && typeof schema === 'object' && JSON.stringify(schema).length < 20000 ? { format: { type: 'json_schema', schema } } : {};
  const ctl = new AbortController();
  inflight.set(id, ctl);
  try {
    const client = new Anthropic({ apiKey });
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: ['low', 'medium', 'high'].includes(effort) ? effort : 'medium', ...format },
      messages: turns,
    }, { signal: ctl.signal });
    stream.on('text', delta => { if (!event.sender.isDestroyed()) event.sender.send('claude:delta', { id, delta }); });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') return { ok: false, code: 'refused', message: 'Claude declined this request.' };
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return { ok: true, text, truncated: message.stop_reason === 'max_tokens' };
  } catch (err) {
    return { ok: false, code: errorCode(err), message: err && err.message ? String(err.message).slice(0, 300) : 'Request failed' };
  } finally {
    inflight.delete(id);
  }
});

account.register(ipcMain);
legacy.register(ipcMain);
rooms.register(ipcMain);

/* ---------- Settings IPC ---------- */
ipcMain.handle('settings:get', async () => {
  const s = await readSettings();
  return { hasKey: !!(await getApiKey()), keyFromEnv: !s.apiKey && !!process.env.ANTHROPIC_API_KEY, reminders: s.reminders !== false, keepInTray: s.keepInTray !== false, quickKey: s.quickKey === undefined ? DEFAULT_QUICK_KEY : s.quickKey, quickDefault: DEFAULT_QUICK_KEY, quickStatus: quickState, canEncrypt: safeStorage.isEncryptionAvailable() };
});
ipcMain.handle('settings:set', async (_e, patch) => {
  const s = await readSettings();
  if (typeof patch.apiKey === 'string') {
    const key = patch.apiKey.trim();
    if (!key) delete s.apiKey;
    else if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: 'This computer has no secure storage for the key. Set the ANTHROPIC_API_KEY environment variable instead.' };
    else s.apiKey = safeStorage.encryptString(key).toString('base64');
  }
  if (typeof patch.reminders === 'boolean') s.reminders = patch.reminders;
  if (typeof patch.keepInTray === 'boolean') { s.keepInTray = patch.keepInTray; keepInTray = patch.keepInTray; }
  if (typeof patch.quickKey === 'string') {
    const res = registerQuick(patch.quickKey);
    if (!res.ok) return { ok: false, message: res.message }; // keep the old setting
    s.quickKey = patch.quickKey;
  }
  await writeSettings(s);
  return { ok: true };
});
ipcMain.handle('settings:test-key', async (_e, key) => {
  try {
    const client = new Anthropic({ apiKey: key.trim() });
    await client.models.retrieve(MODEL);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Anthropic.AuthenticationError ? 'That key was rejected. Check it and try again.' : 'Couldn\'t reach Claude. Check your internet connection.' };
  }
});

/* ---------- Files the page saves: calendar, backups, spreadsheets ---------- */
const SAVE_KINDS = {
  ics: { name: 'Calendar', crlf: true },
  json: { name: 'SemesterSync backup' },
  csv: { name: 'Spreadsheet', crlf: true },
  md: { name: 'Report' },
};
ipcMain.handle('file:save', async (_e, { name, text, open }) => {
  const ext = String(name || '').split('.').pop().toLowerCase();
  const kind = SAVE_KINDS[ext];
  if (!kind || typeof text !== 'string' || text.length > 100 * 1024 * 1024) return { ok: false };
  const safe = path.basename(String(name)).replace(/[^\w .-]/g, '_').slice(0, 120);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: ext === 'ics' ? 'Save calendar file' : ext === 'json' ? 'Save backup' : ext === 'md' ? 'Save report' : 'Save spreadsheet',
    defaultPath: path.join(app.getPath('documents'), safe),
    filters: [{ name: kind.name, extensions: [ext] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  await fs.writeFile(filePath, kind.crlf ? text.replace(/\r?\n/g, '\r\n') : text, 'utf8');
  if (open && ext === 'ics') await shell.openPath(filePath); // hands the file to Apple Calendar / Outlook to import
  return { ok: true };
});

/* ---------- Daily backups in the app's data folder ---------- */
const backupDir = () => path.join(app.getPath('userData'), 'Backups');
const BACKUP_RE = /^SemesterSync-\d{4}-\d{2}-\d{2}\.json$/;
const ANY_BACKUP_RE = /^SemesterSync-(?:[a-z-]{3,40}-)?\d{4}-\d{2}-\d{2}(?:-\d{6})?\.json$/;
ipcMain.handle('backup:auto', async (_e, text) => {
  if (typeof text !== 'string' || text.length > 100 * 1024 * 1024) return { ok: false };
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await fs.mkdir(backupDir(), { recursive: true });
  const file = path.join(backupDir(), `SemesterSync-${day}.json`);
  await fs.writeFile(file + '.tmp', text, 'utf8');
  await fs.rename(file + '.tmp', file); // a crash mid-write never leaves a half-written backup
  const names = (await fs.readdir(backupDir())).filter(n => BACKUP_RE.test(n)).sort().reverse();
  for (const n of names.slice(30)) await fs.unlink(path.join(backupDir(), n)).catch(() => {});
  return { ok: true };
});
// A named backup, kept alongside the daily ones (e.g. before an upgrade or an account switch).
ipcMain.handle('backup:write', async (_e, { name, text }) => {
  if (!/^[a-z-]{3,40}$/.test(String(name)) || typeof text !== 'string' || text.length > 100 * 1024 * 1024) return { ok: false };
  const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  try {
    await fs.mkdir(backupDir(), { recursive: true });
    const file = path.join(backupDir(), `SemesterSync-${name}-${stamp}.json`);
    await fs.writeFile(file + '.tmp', text, 'utf8');
    await fs.rename(file + '.tmp', file);
    return { ok: true, file: path.basename(file) };
  } catch { return { ok: false }; }
});
// Removes this app's backup files (only when the person asks, when signing out and clearing this computer).
ipcMain.handle('backup:clear', async () => { await fs.rm(backupDir(), { recursive: true, force: true }); return { ok: true }; });
ipcMain.handle('backup:list', async () => {
  try {
    const names = (await fs.readdir(backupDir())).filter(n => ANY_BACKUP_RE.test(n)).sort((a, b) => b.localeCompare(a));
    const files = await Promise.all(names.map(async name => ({ name, mtime: (await fs.stat(path.join(backupDir(), name))).mtimeMs })));
    return { ok: true, files };
  } catch { return { ok: true, files: [] }; }
});
ipcMain.handle('backup:read', async (_e, name) => {
  if (!ANY_BACKUP_RE.test(String(name))) return { ok: false };
  try { return { ok: true, text: await fs.readFile(path.join(backupDir(), name), 'utf8') }; } catch { return { ok: false }; }
});
ipcMain.handle('backup:open-folder', async () => { await fs.mkdir(backupDir(), { recursive: true }); await shell.openPath(backupDir()); return { ok: true }; });

/* ---------- Original syllabus files, kept next to each course ---------- */
const sourceDir = cid => path.join(app.getPath('userData'), 'Sources', cid);
const CID_RE = /^[\w-]{1,40}$/;
ipcMain.handle('source:keep', async (_e, { cid, name, bytes }) => {
  if (!CID_RE.test(String(cid)) || !bytes || bytes.byteLength > 25 * 1024 * 1024) return { ok: false };
  const safe = path.basename(String(name || 'syllabus')).replace(/[^\w .()-]/g, '_').slice(0, 120) || 'syllabus';
  await fs.mkdir(sourceDir(cid), { recursive: true });
  await fs.writeFile(path.join(sourceDir(cid), safe), Buffer.from(bytes));
  const all = await fs.readdir(sourceDir(cid));
  if (all.length > 6) {
    const dated = await Promise.all(all.map(async n => [n, (await fs.stat(path.join(sourceDir(cid), n))).mtimeMs]));
    for (const [n] of dated.sort((a, b) => b[1] - a[1]).slice(6)) await fs.unlink(path.join(sourceDir(cid), n)).catch(() => {});
  }
  return { ok: true };
});
ipcMain.handle('source:open', async (_e, cid) => {
  if (!CID_RE.test(String(cid))) return { ok: false };
  try {
    const all = await fs.readdir(sourceDir(cid));
    if (!all.length) return { ok: false };
    // One file opens directly; several open the folder so the person can pick.
    const err = await shell.openPath(all.length === 1 ? path.join(sourceDir(cid), all[0]) : sourceDir(cid));
    return { ok: !err };
  } catch { return { ok: false }; }
});
ipcMain.handle('source:clear', async () => { await fs.rm(path.join(app.getPath('userData'), 'Sources'), { recursive: true, force: true }); return { ok: true }; });

/* ---------- Menu-bar / system-tray companion ---------- */
// The page sends a summary of today; the tray shows it as a menu, and on the Mac the menu bar
// shows how many things are due today. Closing the window hides it, so reminders keep coming.
let tray = null, quitting = false, keepInTray = true, traySummary = null, trayTipShown = false;
app.on('before-quit', () => { quitting = true; });
function showWindow(then) {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (then) win.webContents.send(then.channel, then.arg);
}
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
function buildTrayMenu() {
  const s = traySummary;
  const head = (label) => ({ label, enabled: false });
  const items = [];
  if (s) {
    items.push(head(`SemesterSync · ${clip(s.date, 30)}`), { type: 'separator' });
    items.push(head(s.classes.length ? 'Classes still to come today' : 'No more classes today'));
    for (const c of s.classes) items.push({ label: '   ' + clip(c.label, 60), click: () => showWindow({ channel: 'menu:open-today' }) });
    items.push({ type: 'separator' }, head(s.top.length ? 'Top priorities' : 'Nothing pressing'));
    s.top.forEach((t, i) => items.push({ label: `   ${i + 1}. ${clip(t.label, 60)}`, click: () => showWindow({ channel: 'menu:open-item', arg: t.iid }) }));
    if (s.due.length) { items.push({ type: 'separator' }, head('Due next')); for (const d of s.due) items.push({ label: '   ' + clip(d.label, 64), click: () => showWindow({ channel: 'menu:open-item', arg: d.iid }) }); }
    if (s.overdue) items.push({ type: 'separator' }, { label: `⚠ ${s.overdue} overdue: open the plan`, click: () => showWindow({ channel: 'menu:tab-3' }) });
    items.push({ type: 'separator' });
  }
  items.push({ label: `Quick Add…${quickState.ok && quickState.label ? `   ${quickState.label}` : ''}`, click: () => showQuickAdd() });
  items.push({ label: 'Open Today', click: () => showWindow({ channel: 'menu:open-today' }) });
  if (s && s.paused) items.push({ label: 'Resume reminders', click: () => showWindow({ channel: 'menu:snooze-all', arg: '0' }) });
  else items.push({ label: 'Pause reminders', submenu: [
    { label: 'For 1 hour', click: () => win && win.webContents.send('menu:snooze-all', '60') },
    { label: 'Until tomorrow', click: () => win && win.webContents.send('menu:snooze-all', 'tomorrow') },
  ] });
  items.push({ type: 'separator' }, { label: 'Quit SemesterSync', click: () => { quitting = true; app.quit(); } });
  return Menu.buildFromTemplate(items);
}
function createTray() {
  if (tray || process.env.SEMESTERSYNC_SMOKE) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', isMac ? 'trayTemplate.png' : 'tray.png'));
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('SemesterSync');
  tray.setContextMenu(buildTrayMenu());
  if (!isMac) tray.on('click', () => showWindow({ channel: 'menu:open-today' })); // Windows: left-click opens, right-click shows the menu
}
ipcMain.on('tray:update', (_e, s) => {
  if (!s || typeof s !== 'object') return;
  const list = (a, n) => (Array.isArray(a) ? a : []).slice(0, n).map(x => ({ label: clip(x && x.label, 80), iid: clip(x && x.iid, 60) }));
  traySummary = { date: clip(s.date, 30), badge: clip(s.badge, 12), classes: list(s.classes, 5), top: list(s.top, 3), due: list(s.due, 5), overdue: Math.max(0, Math.min(99, +s.overdue || 0)), paused: !!s.paused };
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
  if (isMac) tray.setTitle(traySummary.badge ? ' ' + traySummary.badge : '');
  tray.setToolTip(`SemesterSync${traySummary.badge ? ` · ${traySummary.badge} today` : ''}`);
});
ipcMain.on('app:show', () => showWindow());

/* ---------- Quick Add: a global shortcut and a small window ---------- */
// One Quick Add window, created on first use and hidden (not closed) afterwards, so pressing the
// shortcut again never opens a second one. Tasks go to a queue file first and leave it only when the
// main page says it has saved them, so a task is never lost if the app closes or the page isn't ready.
const DEFAULT_QUICK_KEY = isMac ? 'Command+Shift+Space' : 'Control+Shift+Space';
const MODS = ['Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta'];
// Shortcuts the system or almost every app relies on.
const RESERVED = new Set(['Command+Space', 'Control+Space', 'Command+Tab', 'Alt+Tab', 'Command+Q', 'Command+W', 'Command+H', 'Command+M', 'Command+C', 'Command+V', 'Command+X', 'Command+Z', 'Command+A',
  'Control+C', 'Control+V', 'Control+X', 'Control+Z', 'Control+A', 'Control+Alt+Delete', 'Alt+F4', 'Command+Alt+Escape', 'Command+Shift+3', 'Command+Shift+4', 'Command+Shift+5', 'Control+Escape', 'Control+Shift+Escape', 'Super+L', 'Super+D', 'Super+Tab']);
let quickWin = null, quickKey = null, quickState = { ok: false, label: '', message: 'Not set up yet' }, quickCtx = { courses: [] };
const quickQueueFile = () => path.join(app.getPath('userData'), 'quick-queue.json');
const keyLabel = a => isMac ? a.replace(/CommandOrControl|CmdOrCtrl|Command|Cmd/g, '⌘').replace(/Control|Ctrl/g, '⌃').replace(/Alt|Option/g, '⌥').replace(/Shift/g, '⇧').replace(/\+/g, '') : a.replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Ctrl').replace(/Super/g, 'Win');
function checkAccel(a) {
  const parts = String(a || '').split('+').map(p => p.trim()).filter(Boolean);
  const mods = parts.filter(p => MODS.includes(p)), keys = parts.filter(p => !MODS.includes(p));
  if (keys.length !== 1 || !/^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Plus|[-=\[\];',./`\\])$/.test(keys[0])) return 'Use one key plus modifiers, like ⌘⇧Space or Ctrl+Shift+Space.';
  if (!mods.some(m => m !== 'Shift')) return 'Include Command, Control or Option/Alt, so typing never triggers it by accident.';
  const norm = parts.map(p => ({ Cmd: 'Command', Ctrl: 'Control', Option: 'Alt', CmdOrCtrl: isMac ? 'Command' : 'Control', CommandOrControl: isMac ? 'Command' : 'Control' }[p] || p)).join('+');
  if (RESERVED.has(norm)) return 'Your computer or most apps already use that one. Pick another.';
  return '';
}
// Registers the shortcut, or reports why it couldn't. '' turns it off.
function registerQuick(accel) {
  if (accel) { const bad = checkAccel(accel); if (bad) return { ok: false, message: bad }; }
  const prev = quickKey;
  if (prev) { try { globalShortcut.unregister(prev); } catch (_) {} quickKey = null; }
  if (!accel) { quickState = { ok: true, off: true, label: '', message: 'Turned off' }; sendQuickStatus(); return { ok: true }; }
  let ok = false;
  try { ok = globalShortcut.register(accel, () => app.emit('semestersync-quick-add')); } catch (_) { ok = false; }
  if (ok) { quickKey = accel; quickState = { ok: true, accel, label: keyLabel(accel), message: '' }; sendQuickStatus(); return { ok: true }; }
  // Couldn't take it (another app has it): put the old one back.
  if (prev) { try { if (globalShortcut.register(prev, () => app.emit('semestersync-quick-add'))) { quickKey = prev; quickState = { ok: true, accel: prev, label: keyLabel(prev), message: '' }; } } catch (_) {} }
  else quickState = { ok: false, label: '', message: `${keyLabel(accel)} is already used by another app. Choose a different shortcut in Settings, or use File → Quick Add.` };
  sendQuickStatus();
  return { ok: false, message: `${keyLabel(accel)} is already used by another app. Pick a different one.` };
}
function sendQuickStatus() { if (win && !win.isDestroyed()) win.webContents.send('menu:quick-status', quickState); }
async function readQueue() { try { const v = JSON.parse(await fs.readFile(quickQueueFile(), 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } }
let queueP = Promise.resolve();
const withQueue = fn => (queueP = queueP.then(async () => { const q = await readQueue(); const out = await fn(q); await fs.mkdir(path.dirname(quickQueueFile()), { recursive: true }); await fs.writeFile(quickQueueFile() + '.tmp', JSON.stringify(q)); await fs.rename(quickQueueFile() + '.tmp', quickQueueFile()); return out; }));
function cleanQuickTask(t) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !/^[\w.-]{1,60}$/.test(t.id)) return null;
  const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
  return { id: t.id, input: str(t.input, 300), title: str(t.title, 120), cid: t.cid ? str(t.cid, 40) : null, type: str(t.type, 12), date: /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') ? t.date : null,
    time: /^\d{2}:\d{2}$/.test(t.time || '') ? t.time : '23:59', hours: isFinite(+t.hours) && t.hours !== null ? Math.max(0, Math.min(200, +t.hours)) : null, notes: str(t.notes, 300), prio: ['low', 'high'].includes(t.prio) ? t.prio : 'normal', at: Date.now() };
}
function placeQuickWin() {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w] = quickWin.getSize();
  quickWin.setPosition(Math.round(d.x + (d.width - w) / 2), Math.round(d.y + d.height * 0.18));
}
function showQuickAdd() {
  if (!quickWin || quickWin.isDestroyed()) {
    quickWin = new BrowserWindow({
      width: 560, height: 120, show: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true,
      title: 'Quick Add', backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b1017' : '#f6f7fa',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    quickWin.setMenuBarVisibility(false);
    quickWin.loadFile(path.join(__dirname, 'renderer', 'quickadd.html'));
    quickWin.on('close', e => { if (!quitting) { e.preventDefault(); quickWin.hide(); } });
    quickWin.on('blur', () => { if (quickWin && !quickWin.isDestroyed() && !quickWin.webContents.isDevToolsOpened()) quickWin.hide(); }); // what was typed stays for next time
    quickWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    quickWin.webContents.on('will-navigate', e => e.preventDefault());
    quickWin.once('ready-to-show', () => { placeQuickWin(); quickWin.show(); quickWin.focus(); });
    return;
  }
  placeQuickWin();
  quickWin.show(); quickWin.focus();
  quickWin.webContents.send('quick:shown');
}
app.on('semestersync-quick-add', showQuickAdd);
ipcMain.handle('quick:context', () => quickCtx);
ipcMain.on('quick:set-context', (_e, c) => {
  if (!c || !Array.isArray(c.courses)) return;
  quickCtx = { courses: c.courses.slice(0, 12).map(x => ({ id: String(x.id || '').slice(0, 40), code: String(x.code || '').slice(0, 18), title: String(x.title || '').slice(0, 80) })) };
});
ipcMain.handle('quick:submit', async (_e, t) => {
  const task = cleanQuickTask(t);
  if (!task || !task.title) return { ok: false, message: 'Add a title first.' };
  try { await withQueue(q => { if (!q.some(x => x.id === task.id)) q.push(task); }); }
  catch (_) { return { ok: false, message: 'Couldn’t save the task to disk. It’s still here; try again.' }; }
  if (!win || win.isDestroyed()) createWindow(true); // the page picks the task up from the queue when it loads
  else win.webContents.send('menu:quick-task', task);
  return { ok: true };
});
ipcMain.handle('quick:drain', () => readQueue());
ipcMain.on('quick:ack', (_e, id) => { withQueue(q => { const n = q.findIndex(x => x.id === id); if (n >= 0) q.splice(n, 1); }).catch(() => {}); });
ipcMain.handle('quick:status', () => quickState);
ipcMain.on('quick:hide', () => {
  if (!quickWin || quickWin.isDestroyed()) return;
  quickWin.hide();
  // Hand focus back to the app the student was in, unless SemesterSync's own window is open.
  if (isMac && !(win && !win.isDestroyed() && win.isVisible())) app.hide();
});
ipcMain.on('quick:resize', (_e, h) => { if (quickWin && !quickWin.isDestroyed()) quickWin.setContentSize(560, Math.max(90, Math.min(640, Math.round(+h || 120)))); });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (_) {} });

/* ---------- Window ---------- */
function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 380,
    minHeight: 560,
    title: 'SemesterSync',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b1017' : '#edf0f4',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.once('ready-to-show', () => { if (!hidden && !process.argv.includes('--hidden')) win.show(); });
  win.on('close', e => {
    if (quitting || !tray || !keepInTray) return;
    e.preventDefault(); win.hide(); // keeps reminders running; the tray or Dock brings it back
    if (!isMac && !trayTipShown && tray.displayBalloon) { trayTipShown = true; tray.displayBalloon({ title: 'SemesterSync is still running', content: 'Reminders keep coming. Find it in the system tray, or quit it there.' }); }
  });
  if (process.env.SEMESTERSYNC_SMOKE) smokeTest(win, process.env.SEMESTERSYNC_SMOKE);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Links (e.g. "Add to Google Calendar") open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); }
  });
}

// Used by the release workflow to check a built installer actually starts: loads the page,
// collects console errors, writes a JSON report to the given path and quits.
function smokeTest(w, out) {
  const errors = [];
  w.webContents.on('console-message', e => { if ((e.level === 'error' || e.level >= 3)) errors.push(String(e.message).slice(0, 300)); });
  w.webContents.once('did-finish-load', () => setTimeout(async () => {
    let page = {};
    try { page = await w.webContents.executeJavaScript(`({ title: document.title, tabs: document.querySelectorAll('.nav [data-tab]').length, panes: document.querySelectorAll('[data-pane]').length, courses: document.querySelectorAll('#coursebar [data-view]').length, rows: document.querySelectorAll('#rows tr').length })`); } catch (e) { errors.push(String(e)); }
    // Every tab has its page, and the sample semester rendered.
    await fs.writeFile(out, JSON.stringify({ ok: !errors.length && page.tabs > 0 && page.tabs === page.panes && page.rows > 0, version: app.getVersion(), page, errors }, null, 2));
    app.exit(0);
  }, 4000));
}

function send(channel) { if (win && !win.isDestroyed()) win.webContents.send(channel); }

function buildMenu() {
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('menu:settings') },
        { label: 'Account…', click: () => send('menu:account') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Quick Add Task…', click: () => showQuickAdd() },
        { label: 'New Course', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new-course') },
        { label: 'Open Syllabus File…', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open-file') },
        { label: 'Export Calendar File…', accelerator: 'CmdOrCtrl+E', click: () => send('menu:export-ics') },
        { type: 'separator' },
        { label: 'Export Backup…', accelerator: 'CmdOrCtrl+Shift+B', click: () => send('menu:backup-export') },
        { label: 'Restore From Backup…', click: () => send('menu:backup-import') },
        { label: 'Your Data…', click: () => send('menu:data') },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' }] : [
          { label: 'Settings…', accelerator: 'Ctrl+,', click: () => send('menu:settings') },
          { label: 'Account…', click: () => send('menu:account') },
          { type: 'separator' },
          { role: 'quit' },
        ]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...['Today', 'Inbox', 'Semester', 'Plan', 'Grades', 'Study', 'Coach', 'Rooms', 'Insights'].map((label, i) => ({ label, accelerator: `CmdOrCtrl+${i + 1}`, click: () => send('menu:tab-' + i) })),
        { label: 'Search…', accelerator: 'CmdOrCtrl+K', click: () => send('menu:search') },
        { type: 'separator' },
        { label: 'Toggle Light/Dark', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('menu:theme') },
        { type: 'separator' },
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Welcome Guide', click: () => send('menu:welcome') },
        { label: 'Keyboard Shortcuts', click: () => send('menu:keys') },
        { type: 'separator' },
        { label: 'Get a Claude API Key', click: () => shell.openExternal('https://platform.claude.com/settings/keys') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.syllabussync.desktop'); // needed for Windows notifications
    buildMenu();
    readSettings().then(s => {
      keepInTray = s.keepInTray !== false;
      if (!process.env.SEMESTERSYNC_SMOKE) registerQuick(s.quickKey === undefined ? DEFAULT_QUICK_KEY : s.quickKey);
    });
    createWindow();
    createTray();
    app.on('activate', () => showWindow());
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
