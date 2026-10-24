const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, nativeImage, safeStorage, nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk');
const cloud = require('./cloud');

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

cloud.register(ipcMain);

/* ---------- Settings IPC ---------- */
ipcMain.handle('settings:get', async () => {
  const s = await readSettings();
  return { hasKey: !!(await getApiKey()), keyFromEnv: !s.apiKey && !!process.env.ANTHROPIC_API_KEY, reminders: s.reminders !== false, keepInTray: s.keepInTray !== false, canEncrypt: safeStorage.isEncryptionAvailable() };
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
ipcMain.handle('backup:list', async () => {
  try {
    const names = (await fs.readdir(backupDir())).filter(n => BACKUP_RE.test(n)).sort().reverse();
    const files = await Promise.all(names.map(async name => ({ name, mtime: (await fs.stat(path.join(backupDir(), name))).mtimeMs })));
    return { ok: true, files };
  } catch { return { ok: true, files: [] }; }
});
ipcMain.handle('backup:read', async (_e, name) => {
  if (!BACKUP_RE.test(String(name))) return { ok: false };
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
    if (s.overdue) items.push({ type: 'separator' }, { label: `⚠ ${s.overdue} overdue: open the plan`, click: () => showWindow({ channel: 'menu:tab-2' }) });
    items.push({ type: 'separator' });
  }
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

/* ---------- Window ---------- */
function createWindow() {
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
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
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
        ...['Today', 'Semester', 'Plan', 'Grades', 'Study', 'Coach', 'Rooms', 'Insights'].map((label, i) => ({ label, accelerator: `CmdOrCtrl+${i + 1}`, click: () => send('menu:tab-' + i) })),
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
    readSettings().then(s => { keepInTray = s.keepInTray !== false; });
    createWindow();
    createTray();
    app.on('activate', () => showWindow());
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
