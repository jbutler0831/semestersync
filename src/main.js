const { app, BrowserWindow, ipcMain, shell, dialog, Menu, safeStorage, nativeTheme } = require('electron');
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
  return { hasKey: !!(await getApiKey()), keyFromEnv: !s.apiKey && !!process.env.ANTHROPIC_API_KEY, reminders: s.reminders !== false, canEncrypt: safeStorage.isEncryptionAvailable() };
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

/* ---------- Calendar file export ---------- */
ipcMain.handle('ics:save', async (_e, { text, open }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save calendar file',
    defaultPath: path.join(app.getPath('documents'), 'semester-deadlines.ics'),
    filters: [{ name: 'Calendar', extensions: ['ics'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  await fs.writeFile(filePath, text.replace(/\r?\n/g, '\r\n'), 'utf8');
  if (open) await shell.openPath(filePath); // hands the file to Apple Calendar / Outlook to import
  return { ok: true, filePath };
});

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
  win.once('ready-to-show', () => win.show());
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
      submenu: [{ label: 'Get a Claude API Key', click: () => shell.openExternal('https://platform.claude.com/settings/keys') }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.syllabussync.desktop'); // needed for Windows notifications
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
