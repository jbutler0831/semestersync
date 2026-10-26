// End-to-end regression tests. Runs the real app in Electron on a throwaway profile, with a fake
// Claude API and a fake account server, so nothing touches your data, your Claude key or Supabase.
//
//   npm test                 run everything
//   npm test -- --keep       leave the windows open at the end
//
// Each check prints PASS or FAIL; the process exits non-zero if anything failed.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'semestersync-test-'));
process.env.SEMESTERSYNC_DATA_DIR = path.join(TMP, 'profile');
process.env.ANTHROPIC_API_KEY = 'sk-test-not-a-real-key';
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:54417';
process.env.SUPABASE_URL = 'http://127.0.0.1:9'; // never contacted: the account handlers below replace it
process.env.SUPABASE_ANON_KEY = 'test';

const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut } = require('electron');
// Test windows overlap. Windows treats a covered window as hidden and throttles it, which stalls the run.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// A stuck step fails the run instead of hanging it.
setTimeout(() => { console.log('FAIL  test run took over 12 minutes; stopping'); app.exit(1); }, 12 * 60 * 1000).unref();
const fake = require('./fake-claude');
fake.serve(54417);

/* ---------- Native dialogs answer themselves ---------- */
const saved = [];
let saveN = 0;
dialog.showSaveDialog = async (_w, opts) => { const p = path.join(TMP, `save-${++saveN}-${path.basename(opts.defaultPath)}`); saved.push(p); return { canceled: false, filePath: p }; };
const opened = [];
shell.openPath = async p => { opened.push(p); return ''; };
shell.openExternal = async () => {};

require('../src/main.js');
let traySummary = null;
ipcMain.on('tray:update', (_e, s) => { traySummary = s; });

/* ---------- Fake account server: one shared cloud, a signed-in flag per window ---------- */
const cloud = new Map(); // doc id -> body
let cloudDown = false;
const users = new Map(); // webContents id -> user or null
const USER = { id: 'user-1', email: 'student@example.com' };
const who = e => users.get(e.sender.id) || null;
// Sync isn't offered by the real account server yet (Stage 4); these tests keep the page's sync code working for when it is.
for (const ch of ['account:status', 'account:sign-in', 'account:sign-up', 'account:sign-out', 'cloud:list', 'cloud:set', 'cloud:delete', 'legacy:status', 'legacy:export', 'legacy:forget']) ipcMain.removeHandler(ch);
ipcMain.handle('account:status', e => ({ configured: true, user: who(e), sync: true }));
ipcMain.handle('account:sign-in', e => { users.set(e.sender.id, USER); return { ok: true, user: USER }; });
ipcMain.handle('account:sign-up', e => { users.set(e.sender.id, USER); return { ok: true, user: USER }; });
ipcMain.handle('account:sign-out', e => { users.set(e.sender.id, null); return { ok: true }; });
const down = () => ({ ok: false, message: 'Couldn\'t reach the account server. Check your internet connection.' });
ipcMain.handle('cloud:list', e => { if (!who(e)) return { ok: false, message: 'Not signed in' }; if (cloudDown) return down(); return { ok: true, docs: [...cloud].map(([id, body]) => ({ id, body: JSON.parse(JSON.stringify(body)) })) }; });
ipcMain.handle('cloud:set', (e, { id, body }) => { if (!who(e)) return { ok: false }; if (cloudDown) return down(); cloud.set(id, JSON.parse(JSON.stringify(body))); return { ok: true }; });
ipcMain.handle('cloud:delete', (e, { id }) => { if (!who(e)) return { ok: false }; if (cloudDown) return down(); cloud.delete(id); return { ok: true }; });

/* ---------- Fake old (Supabase) account, per window ---------- */
const oldAccounts = new Map(); // webContents id -> { email, docs, down, forgot }
ipcMain.handle('legacy:status', e => { const o = oldAccounts.get(e.sender.id); return o && !o.forgot ? { session: true, email: o.email } : { session: false }; });
ipcMain.handle('legacy:export', e => { const o = oldAccounts.get(e.sender.id); if (!o || o.forgot) return { ok: false }; if (o.down) return { ok: false, message: 'offline' }; return { ok: true, docs: o.docs.map(([id, json]) => ({ id, body: { json, at: 1 } })) }; });
ipcMain.handle('legacy:forget', e => { const o = oldAccounts.get(e.sender.id); if (o) o.forgot = true; return { ok: true }; });

/* ---------- Helpers ---------- */
const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `\n      got: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
function device(win) {
  const errors = [];
  win.webContents.on('console-message', e => { if (e.level === 'error' || e.level >= 3) errors.push(String(e.message).slice(0, 300)); });
  win.webContents.setBackgroundThrottling(false);
  const js = src => Promise.race([win.webContents.executeJavaScript(src), new Promise((_, no) => setTimeout(() => no(new Error('page didn’t answer within 20 s: ' + src.slice(0, 80))), 20000))]);
  const until = async (src, ms = 8000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { try { v = await js(src); if (v) return v; } catch (_) {} await sleep(100); } return v; };
  const loaded = () => new Promise((ok, no) => { const t = setTimeout(() => no(new Error('page didn’t load within 30 s')), 30000); win.webContents.once('did-finish-load', () => { clearTimeout(t); ok(); }); });
  const reload = async () => { const p = loaded(); win.webContents.reload(); await p; await until(`!!document.querySelector('#coursebar [data-view]')`); await sleep(1200); };
  const click = sel => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const setVal = (sel, v) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  // The next file picker the page opens gets this file instead of a native dialog.
  const nextFile = (name, text, type) => js(`(() => { const f = new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }); const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type !== 'file') return orig.call(this); HTMLInputElement.prototype.click = orig; const dt = new DataTransfer(); dt.items.add(f); this.files = dt.files; this.dispatchEvent(new Event('change')); }; return true; })()`);
  const key = (k, mods = {}) => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, code: ${JSON.stringify(mods.code || '')}, metaKey: ${!!mods.meta}, ctrlKey: ${!!mods.ctrl}, altKey: ${!!mods.alt}, bubbles: true }))`);
  const saveStatus = () => js(`document.getElementById('saveStatus').textContent`);
  const flushed = async () => { await sleep(1100); await until(`!/Saving/.test(document.getElementById('saveStatus').textContent)`, 6000); };
  return { win, js, until, reload, click, setVal, nextFile, key, errors, saveStatus, flushed, loaded };
}
function newWindow(partition) {
  // Shown (off to the side) because hidden pages count as in the background and don't sync on focus.
  const win = new BrowserWindow({ width: 1100, height: 800, x: 40 + BrowserWindow.getAllWindows().length * 60, y: 40, show: true, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition } });
  const dev = device(win);
  const p = dev.loaded();
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  return p.then(() => dev.until(`!!document.querySelector('#coursebar [data-view]')`)).then(() => sleep(1200)).then(() => dev);
}

const SYLLABUS = `BIO 150: Introduction to Biology
Instructor: Dr. Rivera · Mon/Wed 9:00–9:50 AM · Life Sciences 101

GRADING
Lab reports (3) ........ 30%
Midterm exam ........ 30%
Final exam ........ 30%

DUE DATES
9/10  Lab Report 1 due
Oct 1  Lab Report 2 due
Oct 14  Midterm Exam, 10:00 AM
Dec 9  Final Exam, 9:00 AM`;

async function phaseLocal(A) {
  console.log('\n# First launch, signed out');
  check('onboarding opens on first launch', await A.until(`!!document.querySelector('dialog.onboard[open]')`));
  check('sample courses load behind it', (await A.js(`document.querySelectorAll('#coursebar .tagline').length`)) === 3);
  await A.click('[data-choice="mine"]'); await A.click('[data-ob="next"]');
  check('onboarding explains what needs Claude', /Uses Claude/.test(await A.js(`document.querySelector('dialog.onboard').innerText`)));
  await A.click('[data-ob="next"]');
  check('onboarding offers an account or skipping it', /Sign in or create an account/.test(await A.js(`document.querySelector('dialog.onboard').innerText`)));
  await A.click('[data-ob="next"]');
  await A.setVal('#obWeek', '4'); await A.setVal('#obEnd', '1');
  await A.click('[data-ob="done"]'); await A.flushed();
  check('choosing "my first syllabus" clears the samples and opens the editor', await A.js(`!document.querySelector('#coursebar .tagline') && !document.getElementById('syllabusInput').hidden`));

  console.log('\n# Syllabus review');
  await A.js(`document.getElementById('syllabusInput').value = ${JSON.stringify(SYLLABUS)}`);
  await A.click('#useLocal'); await A.click('#parseBtn');
  await A.until(`!document.getElementById('parseBtn').disabled && document.querySelectorAll('#rows tr[data-id]').length >= 4`, 15000);
  const rv = await A.js(`({ shown: !document.getElementById('review').hidden, text: document.getElementById('review').innerText, flags: document.querySelectorAll('#review .rv').length, chip: document.querySelector('#coursebar .flag')?.textContent })`);
  check('review panel opens after parsing', rv.shown, rv);
  check('flags the missing year', /never states a year/.test(rv.text), rv.text.slice(0, 300));
  check('flags the ambiguous 9/10 date', /Ambiguous date/.test(rv.text) && /Could it be Oct 9/.test(rv.text), rv.text.slice(0, 400));
  check('flags weights that don’t add to 100', /add up to 90%/.test(rv.text));
  check('course chip shows how many items to check', +rv.chip > 0, rv.chip);
  await A.js(`(() => { const r = [...document.querySelectorAll('#review .rv')].find(x => /Ambiguous/.test(x.innerText)); const i = r.querySelector('[data-rk="date"]'); i.value = '2026-10-09'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('fixing a date clears its flag', !/Ambiguous date/.test(await A.js(`document.getElementById('review').innerText`)));
  await A.click('#reviewDone');
  check('confirming hides the review panel', await A.js(`document.getElementById('review').hidden`));
  check('source document is noted', true); // text pasted: no file, so only uploads get a source line (checked below)

  console.log('\n# Calendar export');
  saved.length = 0;
  await A.click('#syncBtn'); await sleep(500);
  const ics = saved[0] && fs.readFileSync(saved[0], 'utf8');
  check('exports a calendar file', ics && /BEGIN:VCALENDAR/.test(ics));
  check('events have stable IDs and timestamps', ics && /UID:[\w-]+@semestersync\r\n/.test(ics) && /DTSTAMP:\d{8}T\d{6}Z/.test(ics));
  check('lines use CRLF and are folded to 75 octets', ics && !/[^\r]\n/.test(ics) && ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75));
  check('opens it in the calendar app', opened.some(p => p === saved[0]));
  await A.js(`(() => { const all = [...document.querySelectorAll('#rows input[data-k="date"]')], i = all[all.length - 1]; i.value = '2026-12-08'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const diff = await A.js(`document.getElementById('diff').innerText`);
  const changed = +((diff.match(/~(\d+) changed/) || [])[1] || 0);
  check('moving the final shows its event (and its study blocks) as changed', changed >= 1 && !/new/.test(diff), diff);
  saved.length = 0;
  await A.click('#syncBtn'); await sleep(500);
  const ics2 = saved[0] && fs.readFileSync(saved[0], 'utf8');
  check('second export carries only the changes, with a higher SEQUENCE', ics2 && (ics2.match(/BEGIN:VEVENT/g) || []).length === changed && /SEQUENCE:1/.test(ics2), ics2 && ics2.slice(0, 600));
  check('after exporting, the calendar is up to date', /up to date/.test(await A.js(`document.getElementById('diff').innerText`)));

  console.log('\n# Backups and restore');
  saved.length = 0;
  await A.js(`document.dispatchEvent(new CustomEvent('ssync:data', { detail: 'export' }))`); await sleep(600);
  const backup = saved[0] && JSON.parse(fs.readFileSync(saved[0], 'utf8'));
  check('exports a backup with every course', backup && backup.app === 'SemesterSync' && backup.courses.length === 1 && backup.courses[0].code === 'BIO 150', backup && backup.courses.map(c => c.code));
  await A.js(`document.querySelectorAll('#coursebar [data-view]')[1].click()`);
  await A.click('#removeCourse'); await A.click('#removeCourse'); await sleep(300);
  check('removing a course works', (await A.js(`document.querySelectorAll('#coursebar [data-view]').length`)) === 1);
  await A.click('#toast .toast-act'); await sleep(400);
  check('undo brings the course back', (await A.js(`[...document.querySelectorAll('#coursebar [data-view]')].map(b => b.textContent).join()`)).includes('BIO 150'));
  await A.js(`document.dispatchEvent(new CustomEvent('ssync:data', { detail: 'data' }))`); await sleep(200);
  await A.click('#dataWipe'); await A.click('#dataWipe'); await sleep(300);
  check('delete everything empties the app', (await A.js(`document.querySelectorAll('#coursebar [data-view]').length`)) === 1);
  await A.nextFile('backup.json', JSON.stringify(backup), 'application/json');
  await A.js(`document.dispatchEvent(new CustomEvent('ssync:data', { detail: 'import' }))`);
  check('restore asks Replace or Add', await A.until(`!!document.querySelector('dialog.import-dlg[open]')`));
  await A.click('#impReplace'); await sleep(400);
  check('restoring the backup brings the course back', (await A.js(`[...document.querySelectorAll('#coursebar [data-view]')].map(b => b.textContent).join()`)).includes('BIO 150'));
  await A.nextFile('notes.json', '{"hello": 1}', 'application/json');
  await A.js(`document.dispatchEvent(new CustomEvent('ssync:data', { detail: 'import' }))`); await sleep(300);
  check('a file that isn’t a backup is refused', /isn’t a SemesterSync backup/.test(await A.js(`document.getElementById('toast').textContent`)) && !(await A.js(`!!document.querySelector('dialog.import-dlg[open]')`)));
  await A.js(`document.dispatchEvent(new CustomEvent('ssync:data', { detail: 'data' }))`); await sleep(300);
  const snaps = await A.js(`[...document.querySelectorAll('#snapList b')].map(b => b.textContent)`);
  check('safety copies were taken before each removal', snaps.some(s => /Before removing BIO 150/.test(s)) && snaps.some(s => /Before deleting everything/.test(s)) && snaps.some(s => /Before restoring a backup/.test(s)), snaps);
  await A.js(`document.querySelector('dialog.data-dlg').close()`);
  await A.flushed();
  check('a daily backup is written to the Backups folder', fs.existsSync(path.join(TMP, 'profile', 'Backups')) && fs.readdirSync(path.join(TMP, 'profile', 'Backups')).some(n => /^SemesterSync-\d{4}-\d{2}-\d{2}\.json$/.test(n)));

  console.log('\n# Damaged saved data');
  await A.js(`(() => { const list = JSON.parse(localStorage.getItem('ssync-courses-v1')); list.push('{not json'); localStorage.setItem('ssync-courses-v1', JSON.stringify(list)); })()`);
  await A.reload();
  const prob = await A.js(`({ banner: document.querySelector('.banner.problem')?.innerText || '', courses: [...document.querySelectorAll('#coursebar [data-view]')].map(b => b.textContent).join(), kept: Object.keys(localStorage).some(k => k.startsWith('ssync-damaged-')) })`);
  check('one damaged course is skipped, not the whole semester', prob.courses.includes('BIO 150'), prob);
  check('the damage is explained and a copy kept', /couldn’t be read/.test(prob.banner) && prob.kept, prob);
  check('onboarding doesn’t reappear', !(await A.js(`!!document.querySelector('dialog.onboard[open]')`)));

  console.log('\n# Upload keeps the original file');
  await A.click('#useLocal'); // a Claude key is set, so the app switches Claude parsing on at every start
  await A.nextFile('econ-syllabus.txt', 'ECON 101: Principles of Economics, Fall 2026\nGRADING\nFinal exam ........ 100%\nDec 8  Final Exam, 2:00 PM', 'text/plain');
  await A.js(`document.getElementById('fileInput').click()`);
  await A.until(`/ECON 101/.test(document.getElementById('coursebar').innerText) && !document.getElementById('parseBtn').disabled`, 15000); await sleep(800);
  const meta = await A.js(`document.getElementById('srcMeta').innerText`);
  check('the course remembers where it came from', /econ-syllabus\.txt/.test(meta), meta);
  check('the original file is saved on this computer', fs.existsSync(path.join(TMP, 'profile', 'Sources')) && /original file is saved/.test(meta), meta);

  console.log('\n# Claude parsing and fallback');
  await A.click('#addCourse');
  await A.js(`document.getElementById('syllabusInput').value = 'HIST 101: World History\\nEssays (2) ... 60%\\nFinal exam ... 40%\\nNov 6 Essay 1\\nNov 20 Essay 2\\nDec 10 Final exam'`);
  await A.click('#useAi'); await A.click('#parseBtn');
  await A.until(`/HIST 101/.test(document.getElementById('coursebar').innerText) && !document.getElementById('parseBtn').disabled`, 15000); await sleep(600);
  const ai = await A.js(`({ log: document.getElementById('log').innerText, review: document.getElementById('review').innerText })`);
  check('Claude extraction fills the course', /Claude returned 3 deliverables/.test(ai.log), ai.log.slice(0, 300));
  check('low-confidence Claude items are flagged for review', /Low confidence/.test(ai.review), ai.review.slice(0, 300));
  await A.click('#reviewDone');

  console.log('\n# Plan: locks, reasons, clashes, missed work');
  await A.js(`document.querySelector('.nav [data-tab="plan"]').click()`); await sleep(300);
  await A.click('#planDays .blk [data-lock]'); await sleep(200);
  check('locking a session keeps it locked after re-planning', (await A.js(`document.querySelectorAll('#planDays .blk.locked').length`)) >= 1);
  const clash = await A.js(`(() => { const d = new Date(); d.setDate(d.getDate() + 5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`);
  await A.js(`document.querySelector('.nav [data-tab="semester"]').click()`);
  await A.js(`document.querySelectorAll('#coursebar [data-view]')[1].click()`);
  for (let n = 0; n < 2; n++) {
    await A.click('#addRow'); await sleep(100);
    await A.js(`(() => { const tr = [...document.querySelectorAll('#rows tr[data-id]')].find(t => t.querySelector('[data-k="title"]').value === 'New deliverable'); const s = (k, v) => { const i = tr.querySelector('[data-k="' + k + '"]'); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); }; s('weight', '15'); s('title', 'Big thing ${n}'); s('date', '${clash}'); })()`);
  }
  await A.js(`document.querySelector('.nav [data-tab="plan"]').click()`); await sleep(300);
  check('two big deadlines on one day are called out', /more than one big deadline/.test(await A.js(`document.getElementById('planRisk').innerText`)));
  await A.click('#deadlines [data-why]');
  const why = await A.js(`[...document.querySelectorAll('#deadlines .why-line')].find(x => !x.hidden)?.textContent || ''`);
  check('priority explains itself', /because it’s .*worth 15%/.test(why), why);
  // Pretend yesterday's plan booked 2 h that were never logged.
  await A.flushed();
  await A.js(`(() => { const ex = JSON.parse(localStorage.getItem('ssync-extras-v1')); const e = ex.find(x => x[0] === 'extras'); const v = JSON.parse(e[1]); const c = JSON.parse(JSON.parse(localStorage.getItem('ssync-courses-v1'))[0]); const loc = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); const it = c.items.find(i => !i.done && i.date >= loc(new Date())); const y = new Date(); y.setDate(y.getDate() - 1); v.planner.snap = { day: loc(y), items: { [it.id]: [2, it.spent || 0] } }; e[1] = JSON.stringify(v); localStorage.setItem('ssync-extras-v1', JSON.stringify(ex)); })()`);
  const keep = await A.js(`[...document.querySelectorAll('#coursebar [data-view]')].map(b => b.textContent).join()`);
  await A.reload();
  const after = await A.js(`[...document.querySelectorAll('#coursebar [data-view]')].map(b => b.textContent).join()`);
  check('opening on the Plan tab still loads saved courses', after === keep, { keep, after });
  await A.js(`document.querySelector('.nav [data-tab="plan"]').click()`); await sleep(300);
  check('missed work is named and re-planned', /wasn’t logged/.test(await A.js(`document.getElementById('planRisk').innerText`)));
  await A.click('#missedLog'); await sleep(200);
  check('"I did it" logs the missed hours', !(await A.js(`!!document.getElementById('missedBanner')`)) && /Logged 2 h/.test(await A.js(`document.getElementById('toast').textContent`)));

  console.log('\n# Today, class times and reminders');
  await A.js(`document.querySelector('.nav [data-tab="today"]').click()`); await sleep(300);
  const td = await A.js(`({ top: document.querySelectorAll('#todayTop .dl.top').length, due: document.querySelectorAll('#todayDue .dl').length, title: document.getElementById('todayTitle').textContent })`);
  check('Today shows the top 3 priorities and what’s due next', td.top === 3 && td.due > 0, td);
  const meets = await A.js(`[...document.querySelectorAll('#meetsEdit .meets')].map(m => m.querySelector('.mh').textContent + ' :: ' + [...m.querySelectorAll('input[data-day]:checked')].map(i => i.dataset.day).join(',') + ' ' + [...m.querySelectorAll('input[type=time]')].map(i => i.value).join('-') + ' ' + (m.querySelector('.where') ? m.querySelector('.where').value : ''))`);
  check('class times are read from the syllabus', meets.some(m => /BIO 150.*:: 1,3 09:00-09:50 Life Sciences 101/s.test(m)), meets);
  await A.js(`(() => { const d = new Date().getDay(); const m = [...document.querySelectorAll('#meetsEdit .meets')].find(x => /BIO 150/.test(x.textContent)); const box = m.querySelector('input[data-day="' + d + '"]'); if (!box.checked) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); } })()`); await sleep(300);
  check('a class meeting today shows under Classes today', /BIO 150/.test(await A.js(`document.getElementById('todayClasses').innerText`)));
  await A.js(`window.__notes = []; window.Notification = function (t, o) { window.__notes.push(t + ' | ' + ((o && o.body) || '')); }; 1`);
  const toggle = async (k, on) => A.js(`(() => { const q = document.querySelector('#remindBody [data-r="${k}"]'); if (q.checked !== ${on}) { q.checked = ${on}; q.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
  const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  await toggle('quiet', false);
  await A.click('#remindBody [data-at="168"]');
  await A.setVal('#remindBody [data-r="summaryTime"]', hhmm(new Date(Date.now() - 60000)));
  // Something big due tomorrow, to trigger a high-priority warning.
  await A.js(`document.querySelector('.nav [data-tab="semester"]').click()`);
  await A.click('#addRow'); await sleep(100);
  await A.js(`(() => { const d = new Date(); d.setDate(d.getDate() + 1); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); const tr = [...document.querySelectorAll('#rows tr[data-id]')].find(t => t.querySelector('[data-k="title"]').value === 'New deliverable'); const s = (k, v) => { const i = tr.querySelector('[data-k="' + k + '"]'); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); }; s('weight', '25'); s('hours', '8'); s('title', 'Urgent essay'); s('date', k); })()`);
  await A.js(`document.querySelector('.nav [data-tab="today"]').click()`); await sleep(300);
  const check1 = async () => { await A.js(`window.__notes = []; document.dispatchEvent(new Event('ssync:remind-check')); 1`); return A.js(`window.__notes`); };
  const n1 = await check1();
  check('deadline reminders go out at the chosen intervals', n1.some(n => /Big thing/.test(n) && /Due in/.test(n)), n1);
  check('the morning summary goes out once', n1.some(n => /^Your day/.test(n)), n1);
  check('high-priority work gets a warning', n1.some(n => /^High priority: Urgent essay/.test(n)), n1);
  check('nothing is sent twice', (await check1()).length === 0);
  await A.js(`localStorage.removeItem('ssync-notified-v2')`);
  await toggle('quiet', true);
  await A.setVal('#remindBody [data-r="quietStart"]', hhmm(new Date(Date.now() - 60000)));
  await A.setVal('#remindBody [data-r="quietEnd"]', hhmm(new Date(Date.now() + 3600000)));
  check('quiet hours hold reminders back', (await check1()).length === 0);
  await toggle('quiet', false);
  await A.click('#remindBody [data-pause="60"]');
  check('pausing holds reminders back', (await check1()).length === 0);
  await A.click('#remindBody [data-pause="0"]');
  check('resuming sends what’s waiting', (await check1()).length > 0);
  await sleep(600);
  check('the menu-bar/tray companion gets today’s summary', traySummary && traySummary.top.length === 3 && traySummary.due.length > 0, traySummary);

  console.log('\n# More reminders: study nudge, weekly report, muting a course');
  await A.js(`localStorage.removeItem('ssync-notified-v2')`);
  await toggle('study', true);
  await A.setVal('#remindBody [data-r="studyTime"]', hhmm(new Date(Date.now() - 60000)));
  await A.setVal('#remindBody [data-r="weeklyDay"]', String(new Date().getDay()));
  await A.setVal('#remindBody [data-r="weeklyTime"]', hhmm(new Date(Date.now() - 60000)));
  const n2 = await check1();
  check('the study nudge names today’s planned work', n2.some(n => /^Time to study/.test(n)), n2);
  check('the weekly report arrives on the chosen day', n2.some(n => /^Your week/.test(n)), n2);
  await A.js(`localStorage.removeItem('ssync-notified-v2')`);
  await A.js(`[...document.querySelectorAll('#remindBody [data-mute]')].find(b => /BIO 150/.test(b.textContent)).click()`);
  const n3 = await check1();
  check('a muted course sends no reminders', n3.length > 0 && !n3.some(n => /BIO 150|Urgent essay|Big thing/.test(n)), n3);
  await A.js(`[...document.querySelectorAll('#remindBody [data-mute]')].find(b => /BIO 150/.test(b.textContent)).click()`);

  console.log('\n# Focus timer and study history');
  await A.setVal('#focusLen', '15');
  await A.click('#focusStart'); await sleep(1300);
  check('the focus timer runs and shows on every tab', /^Focus 1[45]:\d\d/.test(await A.js(`document.getElementById('focusPill').textContent`)) && !(await A.js(`document.getElementById('focusPill').hidden`)));
  const task = await A.js(`document.getElementById('focusTask').selectedOptions[0].textContent`);
  await A.js(`(() => { const f = JSON.parse(localStorage.getItem('ssync-focus-v1')); f.ends = Date.now() - 1000; localStorage.setItem('ssync-focus-v1', JSON.stringify(f)); })()`);
  await A.reload(); await sleep(1500);
  check('a session that ends logs its time, even across a restart', /Nice work: 15 min logged/.test(await A.js(`document.getElementById('toast').textContent`)), await A.js(`document.getElementById('toast').textContent`));
  await A.js(`document.querySelector('.nav [data-tab="insights"]').click()`); await sleep(400);
  const hist = await A.js(`({ list: [...document.querySelectorAll('#histList li')].map(l => l.innerText.replace(/\\s+/g, ' ')), kpis: document.getElementById('histKpis').innerText, bars: document.querySelectorAll('#histChart .col').length })`);
  check('study history lists the session', hist.list[0] && /Focus session/.test(hist.list[0]) && /15 min/.test(hist.list[0]) && task.includes(hist.list[0].split('Focus session')[0].trim().split(' ').slice(-1)[0]), { hist, task });
  check('and charts the last 14 days', hist.bars === 14 && /this week/i.test(hist.kpis), hist);
  const before = hist.list.length;
  await A.click('#histList [data-hdel]'); await sleep(200);
  await A.click('#toast .toast-act'); await sleep(300);
  check('a wrong entry can be deleted and undone', (await A.js(`document.querySelectorAll('#histList li').length`)) === before);

  console.log('\n# Weekly report');
  await A.click('#repNext'); await sleep(200);
  const rep = await A.js(`({ title: document.getElementById('repTitle').textContent, body: document.getElementById('repBody').innerText })`);
  check('the weekly report covers time, deadlines, grades and next week', /so far/.test(rep.title) && /h studied/.test(rep.body) && /Deadlines/.test(rep.body) && /Grades/.test(rep.body) && /Next week/.test(rep.body), rep);
  saved.length = 0;
  await A.click('#repSave'); await sleep(500);
  const md = saved[0] && fs.readFileSync(saved[0], 'utf8');
  check('the report saves as a file', md && /^# SemesterSync weekly report/.test(md) && /## Next week/.test(md), md && md.slice(0, 200));
  await A.js(`document.querySelector('.nav [data-tab="grades"]').click()`); await sleep(200);

  console.log('\n# Grades: final-exam targets, weighted calculator, GPA estimate');
  await sleep(300);
  await A.js(`[...document.querySelectorAll('#gradeChips [data-gc]')].find(b => /BIO 150/.test(b.textContent)).click()`); await sleep(200);
  await A.js(`(() => { const ins = [...document.querySelectorAll('#scoreRows [data-score]')]; [88, 76].forEach((v, i) => { ins[i].value = v; ins[i].dispatchEvent(new Event('change', { bubbles: true })); }); })()`); await sleep(200);
  const fin = await A.js(`({ title: document.getElementById('finalTitle').textContent, rows: [...document.querySelectorAll('#finalRows .target')].map(t => t.innerText.replace(/\\n+/g, ' ')), note: document.getElementById('finalNote').innerText })`);
  check('final-exam targets show the score needed for each grade', /Final Exam/.test(fin.title) && fin.rows.length >= 10 && fin.rows.every(r => /(\d+%|Locked in|Out of reach)/.test(r)), fin);
  await A.setVal('#finalIf', '100'); const ifHi = await A.js(`document.getElementById('finalIfOut').innerText`);
  await A.setVal('#finalIf', '0'); const ifLo = await A.js(`document.getElementById('finalIfOut').innerText`);
  check('the final-score slider changes the finishing grade', ifHi !== ifLo && /finish BIO 150 with/.test(ifHi), [ifHi, ifLo]);
  const calc1 = await A.js(`({ rows: [...document.querySelectorAll('#calcRows tr')].map(r => r.innerText.replace(/\\s+/g, ' ')), total: document.getElementById('calcTotal').innerText })`);
  check('the calculator fills category averages from scores', calc1.rows.some(r => /Lab reports.*from \d+ scores?/.test(r)) && /%/.test(calc1.total), calc1);
  await A.js(`(() => { const tr = [...document.querySelectorAll('#calcRows tr')].find(r => /Midterm/.test(r.innerText)); const i = tr.querySelector('[data-ck="avg"]'); i.value = '95'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const calc2 = await A.js(`document.getElementById('calcTotal').innerText`);
  check('typing a category average updates the weighted grade', calc2 !== calc1.total, [calc1.total, calc2]);
  const nRows = await A.js(`document.querySelectorAll('#calcRows tr').length`);
  await A.click('#calcAdd');
  check('you can add your own category', (await A.js(`document.querySelectorAll('#calcRows tr').length`)) === nRows + 1);
  check('the semester GPA shows a likely value and a range', /likely \d\.\d\d.*Ace everything left: \d\.\d\d.*Slip 15 points.*\d\.\d\d/.test(await A.js(`document.getElementById('gpaRange').innerText`)));

  console.log('\n# Flashcards');
  await A.js(`document.querySelector('.nav [data-tab="study"]').click()`); await sleep(200);
  await A.js(`(() => { document.getElementById('genTopic').value = 'Flashcard check'; document.getElementById('genEmpty').click(); })()`); await sleep(200);
  await A.js(`(() => { document.getElementById('cardQ').value = 'What is 2 + 2?'; document.getElementById('cardA').value = '4'; document.getElementById('cardForm').requestSubmit(); })()`); await sleep(100);
  await A.js(`document.querySelector('#smModes [data-mode="review"]').click()`); await sleep(100);
  check('flashcard review shows the card', /What is 2 \+ 2\?/.test(await A.js(`(document.getElementById('flash') || {}).innerText || ''`)));
  await A.js(`document.getElementById('showAns').click()`); await sleep(50);
  await A.js(`document.querySelector('#smBody [data-q="2"]').click()`); await sleep(100);
  check('rating it finishes the review', /1 card reviewed/.test(await A.js(`document.getElementById('smBody').innerText`)));

  await phaseInbox(A);
  await phaseWeak(A);

  console.log('\n# Search and keyboard');
  await A.key('k', { meta: true, ctrl: process.platform !== 'darwin' });
  check('Ctrl/⌘ K opens search', await A.until(`!!document.querySelector('dialog.search-dlg[open]')`, 2000));
  await A.setVal('#qIn', 'midterm');
  const res = await A.js(`[...document.querySelectorAll('#qList li[data-qi]')].map(l => l.innerText.replace(/\\n+/g, ' | '))`);
  check('search finds deliverables across courses', res.some(r => /Midterm/i.test(r)), res);
  await A.js(`document.getElementById('qIn').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`); await sleep(400);
  check('opening a result jumps to its row', await A.js(`!document.querySelector('dialog.search-dlg[open]') && !!document.querySelector('#rows tr.flash')`));
  await A.key('5', { alt: true, code: 'Digit5' }); await sleep(200);
  check('Alt+5 switches to Grades', (await A.js(`document.querySelector('.nav .on').textContent`)) === 'Grades');
  await A.key('?'); await sleep(200);
  check('? lists the shortcuts', await A.js(`!!document.querySelector('dialog.keys-dlg[open]')`));
  await A.js(`document.querySelector('dialog.keys-dlg').close()`);
  await A.js(`document.querySelector('.nav [data-tab="semester"]').click()`);
  await A.setVal('#tableSearch', 'final');
  const rows = await A.js(`[...document.querySelectorAll('#rows tr[data-id] [data-k="title"]')].map(i => i.value)`);
  check('the table search filters deliverables', rows.length > 0 && rows.every(t => /final/i.test(t)), rows);
  await A.setVal('#tableSearch', '');
}

const dayPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
async function addTask(D, text) {
  await D.js(`document.querySelector('.nav [data-tab="inbox"]').click()`);
  await D.setVal('#qaIn', text);
  await D.js(`document.getElementById('qaForm').requestSubmit()`); await sleep(150);
  return D.js(`(() => { const q = k => document.querySelector('#qaReview [data-tf="' + k + '"]'); return { title: q('title') && q('title').value, course: q('cid') && q('cid').selectedOptions[0].textContent, date: q('date') && q('date').value, type: q('type') && q('type').value, notes: q('notes') && q('notes').value, hours: q('hours') && q('hours').value, text: document.getElementById('qaReview').innerText, save: document.querySelector('#qaReview [data-tsave]') && document.querySelector('#qaReview [data-tsave]').textContent }; })()`);
}
const inboxRows = D => D.js(`[...document.querySelectorAll('#inboxList .irow')].map(r => r.innerText.replace(/\\s+/g, ' '))`);
const rowAction = (D, title, sel) => D.js(`(() => { const r = [...document.querySelectorAll('#inboxList .irow')].find(x => x.querySelector('.tt') && x.querySelector('.tt').textContent === ${JSON.stringify(title)}); const b = r && r.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);

async function phaseInbox(A) {
  console.log('\n# Assignment Inbox: capture and review');
  const r1 = await addTask(A, 'BIO lab writeup in 2 days, 3 pages');
  check('plain English is read into fields to review', r1.title === 'BIO lab writeup' && r1.course === 'BIO 150' && r1.date === dayPlus(2) && r1.type === 'Lab' && r1.notes === '3 pages' && +r1.hours === 3, r1);
  check('the original text is shown until saved', /You typed: BIO lab writeup in 2 days, 3 pages/.test(r1.text) && (await A.js(`document.getElementById('qaIn').value`)) === 'BIO lab writeup in 2 days, 3 pages');
  await A.click('#qaReview [data-tsave]'); await sleep(300);
  check('saving clears the field and lists the task', (await A.js(`document.getElementById('qaIn').value`)) === '' && (await inboxRows(A)).some(r => /BIO lab writeup/.test(r) && /BIO 150/.test(r)));
  await A.js(`document.querySelector('.nav [data-tab="semester"]').click(); [...document.querySelectorAll('#coursebar [data-view]')].find(b => /BIO 150/.test(b.textContent)).click()`); await sleep(200);
  check('a task with a course joins that course’s deliverables', (await A.js(`[...document.querySelectorAll('#rows [data-k="title"]')].map(i => i.value)`)).includes('BIO lab writeup'));
  await A.js(`document.querySelector('.nav [data-tab="today"]').click()`); await sleep(200);
  check('it shows in Today’s “Due next”', /BIO lab writeup/.test(await A.js(`document.getElementById('todayDue').innerText`)));
  await A.js(`document.querySelector('.nav [data-tab="plan"]').click()`); await sleep(200);
  check('and in the Plan’s deadlines and study days', /BIO lab writeup/.test(await A.js(`document.getElementById('deadlines').innerText`)) && /BIO lab writeup/.test(await A.js(`document.getElementById('planDays').innerText`)));

  const r2 = await addTask(A, 'Read the article next week');
  check('an ambiguous date is offered as choices, not filled in', r2.date === '' && /doesn’t say which day/.test(r2.text) && r2.save === 'Save without a date', r2);
  await A.js(`document.querySelectorAll('#qaReview [data-pickdate]')[1].click()`);
  check('picking a choice fills the date', (await A.js(`document.querySelector('#qaReview [data-tf="date"]').value`)) !== '' && (await A.js(`document.querySelector('#qaReview [data-tsave]').textContent`)) === 'Save task');
  await A.click('#qaReview [data-tcancel]');
  check('cancel keeps what was typed', (await A.js(`document.getElementById('qaIn').value`)) === 'Read the article next week' && await A.js(`document.getElementById('qaReview').hidden`));

  const r3 = await addTask(A, 'Read chapter 9');
  check('no date: it can still be saved', r3.date === '' && r3.save === 'Save without a date' && /No due date/.test(r3.text) === false || r3.save === 'Save without a date', r3);
  await A.click('#qaReview [data-tsave]'); await sleep(300);
  let rows = await inboxRows(A);
  check('it waits under “Needs a date”', (await A.js(`document.getElementById('inboxList').innerText`)).includes('NEEDS A DATE') || /Needs a date/i.test(await A.js(`document.getElementById('inboxList').innerText`)));
  check('and is flagged: no date, no course', rows.some(r => /Read chapter 9/.test(r) && /No date/.test(r) && /No course/.test(r)), rows);
  await A.js(`document.querySelector('.nav [data-tab="today"]').click()`); await sleep(200);
  check('Today points to tasks that need a look', /in your Inbox need/.test(await A.js(`document.getElementById('todayAlerts').innerText`)));
  await A.js(`document.querySelector('.nav [data-tab="inbox"]').click()`); await sleep(100);
  await rowAction(A, 'Read chapter 9', '[data-tedit]'); await sleep(100);
  await A.js(`(() => { const f = document.querySelector('#inboxList .editing'); f.querySelector('[data-tf="date"]').value = '${dayPlus(1)}'; f.querySelector('[data-tsave]').click(); })()`); await sleep(300);
  rows = await inboxRows(A);
  check('giving it a date moves it into the schedule', rows.some(r => /Read chapter 9/.test(r) && !/No date/.test(r)) && (await A.js(`document.getElementById('todayDue') && 1`)) === 1);

  const r4 = await addTask(A, 'Astronomy homework tomorrow');
  check('an unknown course is left unassigned', r4.course === 'No course yet' && r4.title === 'Astronomy homework', r4);
  await A.click('#qaReview [data-tsave]'); await sleep(300);
  const r5 = await addTask(A, 'Astronomy homework tomorrow');
  check('a duplicate is caught before saving', /You already have “Astronomy homework”/.test(r5.text) || (await A.js(`document.getElementById('qaReview').innerText`)).includes('already have') || (await A.click('#qaReview [data-tsave]'), await sleep(200), /already have/.test(await A.js(`document.getElementById('qaReview').innerText`))));
  if (!(await A.js(`document.getElementById('qaReview').hidden`))) { await A.click('#qaReview [data-tsave]'); await sleep(300); }
  rows = await inboxRows(A);
  check('“Save anyway” keeps both and marks the copy', rows.filter(r => /Astronomy homework/.test(r)).length === 2 && rows.some(r => /Possible duplicate/.test(r)), rows);
  await A.js(`(() => { const r = [...document.querySelectorAll('#inboxList .irow')].filter(x => /Astronomy homework/.test(x.innerText)).pop(); r.querySelector('[data-tdel]').click(); })()`); await sleep(200);
  check('deleting works', (await inboxRows(A)).filter(r => /Astronomy homework/.test(r)).length === 1);
  await A.click('#toast .toast-act'); await sleep(200);
  check('and can be undone', (await inboxRows(A)).filter(r => /Astronomy homework/.test(r)).length === 2);
  await A.js(`(() => { const r = [...document.querySelectorAll('#inboxList .irow')].filter(x => /Astronomy homework/.test(x.innerText)).pop(); r.querySelector('[data-tdel]').click(); })()`); await sleep(200);
  await A.js(`(() => { const r = [...document.querySelectorAll('#inboxList .irow')].find(x => /Astronomy homework/.test(x.innerText)); const s = r.querySelector('[data-tmove]'); s.value = [...s.options].find(o => o.textContent === 'HIST 101').value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(300);
  rows = await inboxRows(A);
  check('“Move to course” links it to the course', rows.some(r => /Astronomy homework/.test(r) && /HIST 101/.test(r)), rows);

  console.log('\n# Inbox: completing, planning, calendar, reminders');
  await A.js(`(() => { const r = [...document.querySelectorAll('#inboxList .irow')].find(x => /BIO lab writeup/.test(x.innerText)); r.querySelector('[data-tplan]').click(); })()`); await sleep(300);
  await A.js(`document.querySelector('.nav [data-tab="plan"]').click()`); await sleep(200);
  check('“Plan today” books locked time for it today', await A.js(`[...document.querySelectorAll('#planDays .day.today .blk.locked')].some(b => /BIO lab writeup/.test(b.innerText))`));
  await A.js(`document.querySelector('.nav [data-tab="inbox"]').click()`); await sleep(100);
  await rowAction(A, 'Read chapter 9', '[data-tdone]'); await sleep(300);
  await A.js(`document.querySelector('.nav [data-tab="today"]').click()`); await sleep(200);
  check('completing a task updates Today at once', !/Read chapter 9/.test(await A.js(`document.getElementById('todayDue').innerText`)));
  await A.js(`document.querySelector('.nav [data-tab="inbox"]').click(); document.querySelector('#inboxFilters [data-if="done"]').click()`); await sleep(100);
  await rowAction(A, 'Read chapter 9', '[data-tdone]'); await sleep(300);
  await A.js(`document.querySelector('#inboxFilters [data-if="all"]').click()`);
  check('and reopening brings it back', (await inboxRows(A)).some(r => /Read chapter 9/.test(r)));
  await A.js(`document.querySelector('.nav [data-tab="semester"]').click()`); await sleep(100);
  const diff1 = await A.js(`document.getElementById('diff').innerText`);
  saved.length = 0; await A.click('#syncBtn'); await sleep(500);
  const ics = saved[0] ? fs.readFileSync(saved[0], 'utf8') : '';
  check('new tasks go into the calendar export once each', /\+\d+ new/.test(diff1) && (ics.match(/SUMMARY:BIO 150: BIO lab writeup/g) || []).length === 1, { diff1, n: (ics.match(/BIO lab writeup/g) || []).length });
  await A.js(`document.querySelector('.nav [data-tab="inbox"]').click()`); await rowAction(A, 'BIO lab writeup', '[data-tedit]'); await sleep(100);
  await A.js(`(() => { const f = document.querySelector('#inboxList .editing'); f.querySelector('[data-tf="title"]').value = 'BIO lab write-up (final)'; f.querySelector('[data-tsave]').click(); })()`); await sleep(300);
  await A.js(`document.querySelector('.nav [data-tab="semester"]').click()`); await sleep(100);
  const diff2 = await A.js(`document.getElementById('diff').innerText`);
  check('editing a task updates its calendar event instead of adding another', /~\d+ changed/.test(diff2) && !/new/.test(diff2), diff2);
  await A.js(`localStorage.removeItem('ssync-notified-v2'); window.Notification = function (t, o) { window.__notes.push(t + ' | ' + ((o && o.body) || '')); }; 1`);
  await A.js(`document.querySelector('.nav [data-tab="today"]').click()`); await sleep(200);
  const n1 = await A.js(`window.__notes = []; document.dispatchEvent(new Event('ssync:remind-check')); const a = window.__notes.slice(); window.__notes = []; document.dispatchEvent(new Event('ssync:remind-check')); a.concat(window.__notes)`);
  check('tasks get reminders like any deadline (at most 4 a minute, the rest a minute later)', n1.some(x => /Astronomy homework/.test(x)) && n1.filter(x => /\| Due/.test(x)).length > 4, n1);
  const n2 = await A.js(`window.__notes = []; document.dispatchEvent(new Event('ssync:remind-check')); window.__notes`);
  check('without repeating them', !n2.some(x => /Astronomy homework|\| Due/.test(x)), n2);

  console.log('\n# Inbox: courses, restarts, Quick Add');
  await A.js(`document.querySelector('.nav [data-tab="semester"]').click(); [...document.querySelectorAll('#coursebar [data-view]')].find(b => /HIST 101/.test(b.textContent)).click()`); await sleep(200);
  await A.click('#removeCourse'); await A.click('#removeCourse'); await sleep(300);
  await A.js(`document.querySelector('.nav [data-tab="inbox"]').click()`); await sleep(100);
  rows = await inboxRows(A);
  check('deleting a course keeps the tasks you added, back in the Inbox', rows.some(r => /Astronomy homework/.test(r) && /No course/.test(r)), rows);
  await A.click('#toast .toast-act'); await sleep(300);
  check('and undo puts the course and task back together', (await inboxRows(A)).some(r => /Astronomy homework/.test(r) && /HIST 101/.test(r)));
  await A.flushed();
  await A.reload();
  await A.js(`document.querySelector('.nav [data-tab="inbox"]').click()`); await sleep(200);
  rows = await inboxRows(A);
  check('tasks are still there after restarting', ['BIO lab write-up (final)', 'Read chapter 9', 'Astronomy homework'].every(t => rows.some(r => r.includes(t))), rows);

  const mac = process.platform === 'darwin', M = mac ? 'Command' : 'Control';
  check('the Quick Add shortcut is registered at startup', globalShortcut.isRegistered(mac ? 'Command+Shift+Space' : 'Control+Shift+Space'));
  globalShortcut.register(`${M}+Alt+K`, () => {});
  const taken = await A.js(`window.desktop.settings.set({ quickKey: '${M}+Alt+K' })`);
  check('a shortcut another app holds is refused with a clear message', !taken.ok && /already used/.test(taken.message), taken);
  check('and the old shortcut keeps working', globalShortcut.isRegistered(mac ? 'Command+Shift+Space' : 'Control+Shift+Space'));
  const reserved = await A.js(`window.desktop.settings.set({ quickKey: '${mac ? 'Command+Space' : 'Alt+F4'}' })`);
  check('system shortcuts are refused', !reserved.ok, reserved);
  const changed = await A.js(`window.desktop.settings.set({ quickKey: '${M}+Alt+J' })`);
  check('a free shortcut can be chosen', changed.ok && globalShortcut.isRegistered(`${M}+Alt+J`) && !globalShortcut.isRegistered(mac ? 'Command+Shift+Space' : 'Control+Shift+Space'), changed);
  globalShortcut.unregister(`${M}+Alt+K`);
  await A.js(`window.desktop.settings.set({ quickKey: '${mac ? 'Command+Shift+Space' : 'Control+Shift+Space'}' })`);
  A.win.hide();
  app.emit('semestersync-quick-add'); await sleep(1500);
  app.emit('semestersync-quick-add'); await sleep(500);
  const qws = BrowserWindow.getAllWindows().filter(w => w.getTitle() === 'Quick Add');
  check('the shortcut opens one Quick Add window, even pressed twice, with the main window hidden', qws.length === 1 && qws[0].isVisible(), qws.length);
  const Q = device(qws[0]);
  await Q.js(`document.getElementById('text').value = 'Psych reading for 30 minutes tomorrow'; document.getElementById('f').requestSubmit(); 1`); await sleep(300);
  const qv = await Q.js(`({ title: document.getElementById('title').value, date: document.getElementById('date').value, hours: document.getElementById('hours').value, type: document.getElementById('type').value })`);
  check('Quick Add proposes the details', qv.title === 'Psych reading' && qv.date === dayPlus(1) && +qv.hours === 0.5 && qv.type === 'Reading', qv);
  await Q.js(`document.getElementById('save').click(); 1`); await sleep(1600);
  A.win.show();
  await A.js(`document.querySelector('.nav [data-tab="inbox"]').click()`); await sleep(300);
  rows = await inboxRows(A);
  check('the task lands in the Inbox, marked as new', rows.some(r => /Psych reading/.test(r) && /New from Quick Add/.test(r)), rows);
  check('and leaves the on-disk queue once saved', JSON.parse(fs.readFileSync(path.join(TMP, 'profile', 'quick-queue.json'), 'utf8')).length === 0);
  check('the Quick Add window hides after saving', !qws[0].isVisible());
  // A task left in the queue (the app closed before the page took it) is picked up at the next start.
  fs.writeFileSync(path.join(TMP, 'profile', 'quick-queue.json'), JSON.stringify([{ id: 'qtestqueued1', title: 'Queued while closed', input: 'Queued while closed', date: dayPlus(3), time: '23:59', type: 'Homework', hours: 1, notes: '', prio: 'normal', cid: null }]));
  await A.reload(); await A.js(`document.querySelector('.nav [data-tab="inbox"]').click()`); await sleep(400);
  check('a task waiting in the queue is added at the next start, exactly once', (await inboxRows(A)).filter(r => /Queued while closed/.test(r)).length === 1 && JSON.parse(fs.readFileSync(path.join(TMP, 'profile', 'quick-queue.json'), 'utf8')).length === 0);
  await A.js(`document.querySelector('.nav [data-tab="semester"]').click()`);
}

async function phaseWeak(A) {
  console.log('\n# Weak spots: what you keep getting wrong');
  await A.js(`document.querySelector('.nav [data-tab="study"]').click()`); await sleep(200);
  await A.js(`(() => { const s = document.getElementById('genCourse'); s.value = [...s.options].find(o => /BIO 150/.test(o.textContent)).value; s.dispatchEvent(new Event('change')); document.getElementById('genTopic').value = 'Cell biology'; document.getElementById('genEmpty').click(); })()`); await sleep(200);
  for (const [topic, n] of [['Cellular respiration', 3], ['Mitosis', 3]]) for (let i = 1; i <= n; i++) {
    await A.js(`(() => { document.getElementById('cardQ').value = '${topic} question ${i}'; document.getElementById('cardTopic').value = '${topic}'; document.getElementById('cardA').value = '${topic} answer ${i}'; document.getElementById('cardForm').requestSubmit(); })()`); await sleep(60);
  }
  await A.js(`document.querySelector('#smModes [data-mode="review"]').click()`); await sleep(100);
  // Miss every respiration card, get every mitosis card right.
  for (let i = 0; i < 14; i++) {
    const q = await A.js(`(document.querySelector('#flash') || {}).innerText || ''`);
    if (!q) break;
    await A.js(`document.getElementById('showAns') && document.getElementById('showAns').click()`); await sleep(40);
    await A.js(`(() => { const resp = /Cellular/.test(document.querySelector('#flash').innerText); document.querySelector('#smBody [data-q="' + (resp ? 0 : 2) + '"]').click(); })()`); await sleep(60);
  }
  await sleep(300);
  let w = await A.js(`({ list: document.getElementById('weakList').innerText, summary: document.getElementById('weakSummary').innerText })`);
  check('a topic missed again and again is flagged as weak', /Cellular respiration[\s\S]*Weak/.test(w.list), w);
  check('a topic answered right isn’t', !/Mitosis/.test(w.list), w.list.slice(0, 300));
  check('the missed questions are shown with their answers', /Cellular respiration question \d[\s\S]*Answer: Cellular respiration answer/.test(w.list));
  await A.js(`document.querySelector('.nav [data-tab="inbox"]').click()`); await sleep(200);
  let rows = await inboxRows(A);
  check('a review session is scheduled automatically', rows.some(r => /Review: Cellular respiration/.test(r) && /Study/.test(r) && /BIO 150/.test(r) && /Practice/.test(r)), rows.filter(r => /Review/.test(r)));
  await rowAction(A, 'Review: Cellular respiration', '[data-tdone]'); await sleep(300);
  await A.js(`document.querySelector('.nav [data-tab="study"]').click()`); await sleep(200);
  w = await A.js(`document.getElementById('weakList').innerText`);
  check('finishing the review session alone doesn’t count as knowing it', /Weak/.test(w) && /marked done, but your answers don’t show it yet/.test(w), w);
  const before = await A.js(`document.querySelectorAll('#deckList .deck')[0].innerText`);
  await A.js(`[...document.querySelectorAll('#weakList [data-wmore]')][0].click()`); await sleep(2500);
  const after = await A.js(`document.querySelectorAll('#deckList .deck')[0].innerText`);
  check('Claude writes extra questions on the weak topic', /9 cards/.test(after) && /2-question quiz/.test(after), { before, after });
  // Practice until the answers show it
  for (let round = 0; round < 3; round++) {
    if (round === 0) await A.js(`[...document.querySelectorAll('#weakList [data-wpractice]')][0].click()`);
    else await A.js(`document.getElementById('practiceAgain') && document.getElementById('practiceAgain').click()`);
    await sleep(150);
    if (round === 0) check('practice focuses on the weak topic', /Practice: Cellular respiration/.test(await A.js(`document.getElementById('smTitle').textContent`)));
    for (let i = 0; i < 12; i++) {
      if (!(await A.js(`!!document.querySelector('#flash')`))) break;
      await A.js(`document.getElementById('showAns') && document.getElementById('showAns').click()`); await sleep(30);
      await A.js(`document.querySelector('#smBody [data-q="2"]').click()`); await sleep(40);
    }
  }
  await sleep(300);
  w = await A.js(`document.getElementById('weakList').innerText`);
  check('right answers in practice mark it improved, with before and after', /Cellular respiration[\s\S]*Improved/.test(w) && /0% → (8|9|10)\d?%/.test(w), w);
  check('and the toast says so', /improved on “Cellular respiration”/.test(await A.js(`document.getElementById('toast').textContent`)) || /Improved/.test(w));
  await A.js(`document.getElementById('practiceQuiz') && document.getElementById('practiceQuiz').click()`); await sleep(200);
  const quiz = await A.js(`({ n: document.querySelectorAll('#smBody .quiz-q').length, note: document.querySelector('#smBody .note').innerText })`);
  check('the quiz can be narrowed to the topic', quiz.n === 2 && /Questions on Cellular respiration only/.test(quiz.note), quiz);
  const nBefore = await A.js(`document.getElementById('weakSummary').innerText`);
  await A.js(`(() => { const q = document.querySelector('#smBody .quiz-q'); const wrong = [...q.querySelectorAll('[data-ch]')].find(b => b.dataset.ch !== '1'); wrong.click(); })()`); await sleep(200);
  check('quiz answers count as evidence too', (await A.js(`document.getElementById('weakSummary').innerText`)) !== nBefore);
  w = await A.js(`document.getElementById('weakSummary').innerText`);
  check('studying and knowing are shown apart', /h\s*studied this week/.test(w) && /questions answered/.test(w) && /Only answers count toward mastery/.test(w), w);
  await A.flushed();
  await A.reload();
  await A.js(`document.querySelector('.nav [data-tab="study"]').click()`); await sleep(300);
  w = await A.js(`document.getElementById('weakList').innerText`);
  check('answers and results are kept after restarting', /Cellular respiration[\s\S]*Improved/.test(w), w);
  await A.js(`document.querySelector('.nav [data-tab="insights"]').click(); document.getElementById('repNext').click()`); await sleep(200);
  check('the weekly report shows what you showed you know', /What you showed you know[\s\S]*questions answered[\s\S]*Improved[\s\S]*Cellular respiration/.test(await A.js(`document.getElementById('repBody').innerText`)));
  await A.js(`document.querySelector('.nav [data-tab="semester"]').click()`);
}

// Data saved by earlier versions, in their own shapes, must load unchanged after the local-first upgrade,
// and the exact saved text must be backed up to a file before anything is written.
async function phaseUpgrade(A) {
  console.log('\n# Data from earlier versions');
  const F = await newWindow('persist:device-f');
  const old = [
    { id: 'c10', code: 'OLD 100', title: 'Saved by 1.0', text: 'OLD 100 syllabus', categories: [{ label: 'Exams', pct: 100, count: null, per: null, words: ['exam'], type: 'Exam' }], items: [{ id: 'c10-1', cid: 'c10', line: 1, title: 'Old exam', notes: '', type: 'Exam', date: '2026-12-01', time: '09:00', weight: 100, hours: 8, conf: 90, sync: true }], color: 0, parser: 'local', order: 1 },
    { id: 'c13', code: 'MID 130', title: 'Saved by 1.3', text: '', categories: [], items: [{ id: 'c13-1', cid: 'c13', line: -1, title: 'Graded lab', notes: '', type: 'Lab', date: '2026-10-01', time: '23:59', weight: 20, hours: 5, conf: 99, sync: true, done: true, doneAt: '2026-10-01', score: 91, spent: 2 }], color: 1, parser: 'local', order: 2, credits: 4, target: 'B+', meets: [{ days: [1, 3], start: '09:00', end: '09:50', where: 'Room 1', kind: 'Class' }] },
    { id: 'inbox', code: 'Inbox', title: '', text: '', categories: [], inbox: true, items: [{ id: 'qa1', cid: 'inbox', line: -1, title: 'Old inbox task', notes: '', type: 'Homework', date: '2026-11-20', time: '23:59', weight: 0, hours: 1, conf: 99, sync: true, src: 'inbox' }], drafts: [{ id: 'qd1', title: 'Undated old task', type: 'Reading', hours: 1, src: 'inbox' }], color: 0, parser: 'local', order: 0 },
  ];
  const ex = [['extras', JSON.stringify({ planner: { hours: [1, 2, 3, 4, 5, 6, 7], block: 1.5 }, gpa: { prior: '3.1', priorCredits: '30', goal: '' }, review: { days: {} } })], ['deck-d1', JSON.stringify({ id: 'd1', cid: 'c10', name: 'Old deck', cards: [{ id: 'k1', q: 'Old question?', a: 'Old answer' }], quiz: [], guide: '', created: 1 })]];
  await F.js(`localStorage.clear(); localStorage.setItem('ssync-courses-v1', ${JSON.stringify(JSON.stringify(old.map(c => JSON.stringify(c))))}); localStorage.setItem('ssync-extras-v1', ${JSON.stringify(JSON.stringify(ex))}); localStorage.setItem('ssync-onboarded', '1'); 1`);
  const backupsBefore = fs.readdirSync(path.join(TMP, 'profile', 'Backups')).filter(n => /before-local-first/.test(n)).length;
  await F.reload();
  const bar = await F.js(`document.getElementById('coursebar').innerText`);
  check('courses saved by 1.0 and 1.3 load', /OLD 100/.test(bar) && /MID 130/.test(bar), bar);
  await F.js(`document.querySelector('.nav [data-tab="inbox"]').click()`); await sleep(200);
  const inb = await F.js(`document.getElementById('inboxList').innerText`);
  check('Inbox tasks saved by 1.4 load, dated and undated', /Old inbox task/.test(inb) && /Undated old task/.test(inb), inb);
  await F.js(`document.querySelector('.nav [data-tab="study"]').click()`); await sleep(200);
  check('study sets and settings load', /Old deck/.test(await F.js(`document.getElementById('deckList').innerText`)) && (await F.js(`document.querySelector('.nav [data-tab="plan"]').click(), document.querySelector('#hoursGrid input[data-dow="0"]').value`)) === '1');
  await F.js(`document.querySelector('.nav [data-tab="grades"]').click(); [...document.querySelectorAll('#gradeChips [data-gc]')].find(b => /MID 130/.test(b.textContent)).click()`); await sleep(200);
  check('scores and progress are kept', (await F.js(`[...document.querySelectorAll('#scoreRows [data-score]')].map(i => i.value)`)).includes('91'));
  const raws = fs.readdirSync(path.join(TMP, 'profile', 'Backups')).filter(n => /before-local-first/.test(n));
  const newest = raws.slice().sort().pop(), raw = newest && JSON.parse(fs.readFileSync(path.join(TMP, 'profile', 'Backups', newest), 'utf8'));
  check('the exact saved data was backed up to a file first', raws.length === backupsBefore + 1 && raw && raw.kind === 'raw-before-upgrade' && /OLD 100/.test(raw.raw.courses) && /Old deck/.test(raw.raw.extras));
  check('and the upgrade is recorded, so it happens once', (await F.js(`localStorage.getItem('ssync-format')`)) === '2');
  await F.reload();
  check('a second start doesn’t back up again', fs.readdirSync(path.join(TMP, 'profile', 'Backups')).filter(n => /before-local-first/.test(n)).length === backupsBefore + 1);
  await F.nextFile(newest, fs.readFileSync(path.join(TMP, 'profile', 'Backups', newest), 'utf8'), 'application/json');
  await F.js(`document.dispatchEvent(new CustomEvent('ssync:data', { detail: 'import' }))`);
  check('that backup can be restored like any other', /OLD 100/.test(await F.until(`document.querySelector('dialog.import-dlg[open]') && document.querySelector('dialog.import-dlg').innerText`)));
  await F.js(`document.querySelector('dialog.import-dlg').close()`);
  F.errors.forEach(e => A.errors.push(e));
  if (!process.argv.includes('--keep')) F.win.destroy();
}

async function phaseOldAccount(A) {
  console.log('\n# Upgrading while signed in to an old (Supabase) account');
  const course = (id, code, title, order) => JSON.stringify({ id, code, title: code + ' course', text: '', categories: [], items: [{ id: id + '-1', cid: id, line: -1, title, notes: '', type: 'Homework', date: '2026-11-20', time: '23:59', weight: 0, hours: 1, conf: 99, sync: true }], color: 0, parser: 'local', order });
  const G = await newWindow('persist:device-g');
  const stale = [course('cL', 'LOCAL 1', 'Only on this computer', 5)];
  const cache = { uid: 'old-1', dirtySince: 0,
    docs: [['course-cA', course('cA', 'ACCT 1', 'Edited here while offline', 1)], ['course-cB', course('cB', 'ACCT 2', 'Old B', 2)], ['extras', JSON.stringify({ planner: { hours: [2, 2, 2, 2, 2, 2, 2], block: 1.5 } })]],
    base: [['course-cA', { r: course('cA', 'ACCT 1', 'Original A', 1), l: course('cA', 'ACCT 1', 'Original A', 1) }], ['course-cB', { r: course('cB', 'ACCT 2', 'Old B', 2), l: course('cB', 'ACCT 2', 'Old B', 2) }]] };
  const remote = [['meta', '{}'], ['course-cA', course('cA', 'ACCT 1', 'Changed on another computer', 1)], ['course-cB', course('cB', 'ACCT 2', 'Newer B from the account', 2)], ['course-cC', course('cC', 'ACCT 3', 'Only in the account', 3)],
    ['deck-dz', JSON.stringify({ id: 'dz', cid: 'cC', name: 'Account deck', cards: [{ id: 'k1', q: 'Q?', a: 'A' }], quiz: [], guide: '', created: 1 })]];
  oldAccounts.set(G.win.webContents.id, { email: 'old@example.com', docs: remote });
  await G.js(`localStorage.clear(); localStorage.setItem('ssync-courses-v1', ${JSON.stringify(JSON.stringify(stale))}); localStorage.setItem('ssync-account-cache-v1', ${JSON.stringify(JSON.stringify(cache))}); localStorage.setItem('ssync-sync-consent-old-1', '1'); localStorage.setItem('ssync-onboarded', '1'); 1`);
  await G.reload();
  const bar = await G.js(`document.getElementById('coursebar').innerText`);
  check('the old account’s courses are copied to this computer', /ACCT 1/.test(bar) && /ACCT 2/.test(bar) && /ACCT 3/.test(bar), bar);
  check('this computer’s own course is kept too', /LOCAL 1/.test(bar), bar);
  const saved = await G.js(`localStorage.getItem('ssync-courses-v1')`);
  check('edits made here that never reached the account are kept', saved.includes('Edited here while offline') && !saved.includes('Changed on another computer'));
  check('the account’s newer copy is used where this computer hadn’t changed it', saved.includes('Newer B from the account') && !saved.includes('Old B'));
  check('the other version of a course changed in both places is a safety copy', (await G.js(`localStorage.getItem('ssync-snapshots-v1') || ''`)).includes('Changed on another computer'));
  check('study sets from the account come too', /Account deck/.test(await G.js(`localStorage.getItem('ssync-extras-v1') || ''`)));
  check('a raw copy of the old account is saved to a backup file first', fs.readdirSync(path.join(TMP, 'profile', 'Backups')).some(n => /old-account-copy/.test(n) && /Only in the account/.test(fs.readFileSync(path.join(TMP, 'profile', 'Backups', n), 'utf8'))));
  check('it explains what happened', /old@example\.com/.test(await G.js(`(document.getElementById('migratedBanner') || {}).innerText || ''`)));
  check('the old sign-in is removed and nothing syncs', oldAccounts.get(G.win.webContents.id).forgot && !(await G.js(`!!localStorage.getItem('ssync-account-cache-v1') || !!localStorage.getItem('ssync-sync-consent-old-1')`)) && /this computer/.test(await G.saveStatus()), await G.saveStatus());
  await G.reload();
  check('it happens once', !(await G.js(`!!document.getElementById('migratedBanner')`)) && /ACCT 3/.test(await G.js(`document.getElementById('coursebar').innerText`)));

  const H = await newWindow('persist:device-h');
  oldAccounts.set(H.win.webContents.id, { email: 'old@example.com', docs: remote, down: true });
  await H.js(`localStorage.clear(); localStorage.setItem('ssync-courses-v1', ${JSON.stringify(JSON.stringify(stale))}); localStorage.setItem('ssync-onboarded', '1'); 1`);
  await H.reload();
  check('offline with no cached copy, nothing changes and it tries again later', !(await H.js(`!!localStorage.getItem('ssync-migrated-supabase')`)) && !oldAccounts.get(H.win.webContents.id).forgot && /LOCAL 1/.test(await H.js(`document.getElementById('coursebar').innerText`)));
  oldAccounts.get(H.win.webContents.id).down = false;
  await H.reload();
  check('and copies the courses once the old account answers', /ACCT 3/.test(await H.js(`document.getElementById('coursebar').innerText`)) && /LOCAL 1/.test(await H.js(`document.getElementById('coursebar').innerText`)));
  for (const D of [G, H]) { D.errors.forEach(e => A.errors.push(e)); if (!process.argv.includes('--keep')) D.win.destroy(); }
}

async function phaseSync(A) {
  console.log('\n# Signing in never uploads without asking');
  const mine = await A.js(`[...document.querySelectorAll('#coursebar [data-view]')].slice(1).map(b => b.textContent.replace(/\\d+$/, ''))`);
  const courseDocs = () => [...cloud.keys()].filter(k => k.startsWith('course-') && k !== 'course-inbox');
  const syncDialog = D => D.until(`document.querySelector('dialog.account[open]') && /Cloud sync/.test(document.querySelector('dialog.account').innerText) && document.querySelector('dialog.account').innerText`);
  await A.click('#accountBtn'); await sleep(200);
  await A.js(`(() => { document.getElementById('authEmail').value = 'student@example.com'; document.getElementById('authPass').value = 'correct horse'; document.getElementById('authForm').requestSubmit(); })()`);
  const ask = await syncDialog(A);
  check('after signing in, it asks before uploading, and lists what would go', /Upload this computer’s|Upload this computer's/.test(ask) && /BIO 150/.test(ask), ask);
  let p0 = A.loaded(); await A.click('[data-sc="no"]'); await p0; await A.until(`!!document.querySelector('#coursebar [data-view]')`); await sleep(1500);
  check('“Not now” uploads nothing', cloud.size === 0, [...cloud.keys()]);
  check('and everything stays on this computer, with sync shown as off', (await A.js(`[...document.querySelectorAll('#coursebar [data-view]')].length - 1`)) === mine.length && /sync off/.test(await A.saveStatus()), await A.saveStatus());
  await A.js(`document.dispatchEvent(new CustomEvent('ssync:data', { detail: 'data' }))`); await sleep(200);
  await A.click('#syncOnBtn');
  await syncDialog(A);
  p0 = A.loaded(); await A.click('[data-sc="add"]'); await p0; await A.until(`!!document.querySelector('#coursebar [data-view]')`); await sleep(1500);
  check('turning sync on later uploads every course', courseDocs().length === mine.length, { cloud: [...cloud.keys()], mine });
  check('the page now saves to the account', /account/.test(await A.saveStatus()), await A.saveStatus());

  console.log('\n# A second computer');
  const B = await newWindow('persist:device-b');
  users.set(B.win.webContents.id, USER);
  await B.reload();
  check('a newly signed-in computer doesn’t sync until asked', /sync off/.test(await B.saveStatus()), await B.saveStatus());
  await B.js(`document.querySelector('dialog.onboard')?.close(); document.dispatchEvent(new CustomEvent('ssync:open', { detail: 'sync' }))`);
  check('it offers to turn sync on', /Your account has \d+ course/.test(await syncDialog(B)));
  { const p = B.loaded(); await B.click('[data-sc="use"]'); await p; await B.until(`!!document.querySelector('#coursebar [data-view]')`); await sleep(1500); }
  const bCourses = await B.js(`[...document.querySelectorAll('#coursebar [data-view]')].length - 1`);
  check('signs in and sees the same courses', bCourses === mine.length, bCourses);
  check('doesn’t show onboarding to a returning account', !(await B.js(`!!document.querySelector('dialog.onboard[open]')`)));

  console.log('\n# Changes flow between devices');
  const titleOf = (D, n) => D.js(`document.querySelectorAll('#rows tr[data-id] [data-k="title"]')[${n}].value`);
  const setTitle = (D, n, v) => D.js(`(() => { const i = document.querySelectorAll('#rows tr[data-id] [data-k="title"]')[${n}]; i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('change', { bubbles: true })); i.blur(); })()`);
  for (const D of [A, B]) await D.js(`document.querySelectorAll('#coursebar [data-view]')[1].click()`);
  await setTitle(A, 0, 'Edited on A'); await A.flushed();
  B.win.focus(); await B.js(`document.dispatchEvent(new Event('visibilitychange'))`); await sleep(800);
  check('an edit on A shows up on B', (await titleOf(B, 0)) === 'Edited on A', await titleOf(B, 0));
  await addTask(A, 'Group meeting prep in 4 days'); await A.click('#qaReview [data-tsave]'); await A.flushed();
  B.win.focus(); await B.js(`document.dispatchEvent(new Event('visibilitychange'))`); await sleep(800);
  await B.js(`document.querySelector('.nav [data-tab="inbox"]').click()`); await sleep(200);
  check('a task added on A shows up in B’s Inbox', (await inboxRows(B)).some(r => /Group meeting prep/.test(r)));
  await B.js(`document.querySelector('.nav [data-tab="semester"]').click()`);
  check('with sync on, every change is also saved on this computer', (await A.js(`localStorage.getItem('ssync-courses-v1') || ''`)).includes('Edited on A'));
  check('just opening the account never counts as an edit', ![...cloud.values()].some(b => b.json && b.json.includes('"title":"Lab Report 2"')) && !(await B.js(`(localStorage.getItem('ssync-snapshots-v1') || '').includes('two devices')`)));

  console.log('\n# The same course edited on both');
  await setTitle(A, 1, 'Second edit on A'); await A.flushed();
  await setTitle(B, 1, 'Second edit on B'); await B.flushed();
  const cid = await B.js(`document.querySelector('#rows tr[data-id]').dataset.id.split('-')[0]`);
  const remote = JSON.parse(cloud.get('course-' + cid).json);
  check('the newer edit wins in the account', remote.items.some(i => i.title === 'Second edit on B'), remote.items.map(i => i.title));
  await B.js(`document.dispatchEvent(new CustomEvent('ssync:data', { detail: 'data' }))`); await sleep(300);
  const bs = await B.js(`[...document.querySelectorAll('#snapList b')].map(b => b.textContent)`);
  check('the other version is kept as a safety copy', bs.some(s => /edited on two devices/.test(s)), bs);
  await B.js(`(() => { const b = [...document.querySelectorAll('#snapList li')].find(l => /Other copy of BIO 150.*two devices/.test(l.innerText)).querySelector('[data-restore]'); b.click(); })()`); await sleep(400);
  check('and restoring it brings back A’s edit', (await titleOf(B, 1)) === 'Second edit on A', await titleOf(B, 1));
  await B.flushed();

  console.log('\n# Offline');
  cloudDown = true;
  await setTitle(A, 2, 'Typed while offline');
  await addTask(A, 'Offline task tomorrow'); await A.click('#qaReview [data-tsave]'); await sleep(1500);
  await A.js(`document.querySelector('.nav [data-tab="semester"]').click()`);
  check('an offline save says so and keeps the change', /Offline/.test(await A.saveStatus()), await A.saveStatus());
  await A.reload();
  await A.js(`document.querySelectorAll('#coursebar [data-view]')[1].click()`);
  check('reopening offline loads this computer’s copy', (await titleOf(A, 2)) === 'Typed while offline', await titleOf(A, 2));
  cloudDown = false;
  await A.until(`/Synced/.test(document.getElementById('saveStatus').textContent)`, 20000);
  check('a task created offline reaches the account too', [...cloud.values()].some(b => b.json && b.json.includes('Offline task')));
  check('it syncs by itself when the account is back', JSON.parse(cloud.get('course-' + cid).json).items.some(i => i.title === 'Typed while offline'), await A.saveStatus());

  console.log('\n# Deleting on one device');
  B.win.focus(); await B.js(`document.dispatchEvent(new Event('visibilitychange'))`); await sleep(800);
  const before = await A.js(`document.querySelectorAll('#coursebar [data-view]').length`);
  await B.js(`document.querySelectorAll('#coursebar [data-view]')[1].click()`);
  await B.click('#removeCourse'); await B.click('#removeCourse'); await B.flushed();
  A.win.focus(); await A.js(`document.activeElement && document.activeElement.blur(); document.dispatchEvent(new Event('visibilitychange'))`); await sleep(800);
  check('a course removed on B disappears on A', (await A.js(`document.querySelectorAll('#coursebar [data-view]').length`)) === before - 1);

  console.log('\n# Signing out');
  await A.click('#accountBtn'); await sleep(200);
  const p = A.loaded(); await A.click('#signOutBtn'); await p; await sleep(1500);
  check('signing out keeps your courses on this computer', (await A.js(`document.querySelectorAll('#coursebar [data-view]').length`)) === before - 1 && !(await A.js(`!!localStorage.getItem('ssync-account-cache-v1')`)));
  check('and goes back to saving on this computer', /this computer/.test(await A.saveStatus()), await A.saveStatus());
  // Legacy: a computer that was syncing before consent existed keeps syncing.
  await B.js(`localStorage.removeItem('ssync-sync-consent-user-1')`); await B.reload();
  check('a computer that was already syncing keeps syncing after the update', /account/.test(await B.saveStatus()), await B.saveStatus());

  console.log('\n# A computer with its own courses signs into an account that has some');
  const C = await newWindow('persist:device-c');
  await C.click('[data-ob="skip"]');
  await C.js(`document.getElementById('addCourse').click()`);
  await C.js(`document.getElementById('syllabusInput').value = 'CHEM 110: General Chemistry\\nGRADING\\nFinal exam ... 100%\\nDec 11 Final exam'`);
  await C.click('#useLocal'); await C.click('#parseBtn');
  await C.until(`/CHEM 110/.test(document.getElementById('coursebar').innerText) && !document.getElementById('parseBtn').disabled`, 15000);
  await C.flushed();
  await C.click('#accountBtn'); await sleep(200);
  await C.js(`(() => { document.getElementById('authEmail').value = 'student@example.com'; document.getElementById('authPass').value = 'correct horse'; document.getElementById('authForm').requestSubmit(); })()`);
  const askC = await syncDialog(C);
  check('asks before adding them', /This computer has 1 of its own/.test(askC) && /CHEM 110/.test(askC), askC);
  const p2 = C.loaded(); await C.click('[data-sc="add"]'); await p2; await sleep(1500);
  check('“Add mine to the account” puts the course in the account', [...cloud.values()].some(b => b.json && /CHEM 110/.test(b.json)));
  check('samples from this computer aren’t added to an existing account', ![...cloud.values()].some(b => b.json && /"sample":true/.test(b.json)));
  check('and C now shows the account’s courses too', /BIO 150|ECON 101/.test(await C.js(`document.getElementById('coursebar').innerText`)));
  await C.click('#accountBtn'); await sleep(200);
  await C.js(`document.getElementById('wipeLocal').checked = true`);
  { const p = C.loaded(); await C.click('#signOutBtn'); await p; await sleep(1500); }
  check('signing out with “remove from this computer” clears it', !(await C.js(`!!localStorage.getItem('ssync-courses-v1') && /CHEM 110/.test(localStorage.getItem('ssync-courses-v1'))`)) && !/CHEM 110/.test(await C.js(`document.getElementById('coursebar').innerText`)));

  console.log('\n# Choosing the account’s courses keeps this computer’s in a backup');
  const E = await newWindow('persist:device-e');
  await E.click('[data-ob="skip"]');
  await E.js(`document.getElementById('addCourse').click()`);
  await E.js(`document.getElementById('syllabusInput').value = 'PHYS 101: Physics\\nGRADING\\nFinal exam ... 100%\\nDec 12 Final exam'`);
  await E.click('#useLocal'); await E.click('#parseBtn');
  await E.until(`/PHYS 101/.test(document.getElementById('coursebar').innerText) && !document.getElementById('parseBtn').disabled`, 15000);
  await E.js(`document.querySelectorAll('#coursebar [data-view]').length && document.getElementById('clearSamples') && document.getElementById('clearSamples').click()`); await E.flushed();
  await E.click('#accountBtn'); await sleep(200);
  await E.js(`(() => { document.getElementById('authEmail').value = 'student@example.com'; document.getElementById('authPass').value = 'correct horse'; document.getElementById('authForm').requestSubmit(); })()`);
  await syncDialog(E);
  { const p = E.loaded(); await E.click('[data-sc="use"]'); await p; await E.until(`!!document.querySelector('#coursebar [data-view]')`); await sleep(1500); }
  check('“Use the account’s courses” shows the account’s', !/PHYS 101/.test(await E.js(`document.getElementById('coursebar').innerText`)) && /BIO 150|ECON 101/.test(await E.js(`document.getElementById('coursebar').innerText`)));
  check('and this computer’s course is kept in a safety copy and a backup file', /PHYS 101/.test(await E.js(`localStorage.getItem('ssync-snapshots-v1') || ''`)) && fs.readdirSync(path.join(TMP, 'profile', 'Backups')).some(n => /before-account-switch/.test(n) && /PHYS 101/.test(fs.readFileSync(path.join(TMP, 'profile', 'Backups', n), 'utf8'))));
  check('nothing from it was uploaded', ![...cloud.values()].some(b => b.json && /PHYS 101/.test(b.json)));
  for (const D of [E]) D.errors.forEach(e => A.errors.push(e));
  if (!process.argv.includes('--keep')) E.win.destroy();
  await phaseUpgrade(A);
  await phaseOldAccount(A);
  for (const D of [B, C]) D.errors.forEach(e => A.errors.push(e));
  if (!process.argv.includes('--keep')) { B.win.destroy(); C.win.destroy(); }
}

app.on('browser-window-created', (_e, win) => {
  if (win.__seen) return; win.__seen = true;
  if (BrowserWindow.getAllWindows().length !== 1) return; // only the app's own first window drives the run
  const A = device(win);
  users.set(win.webContents.id, null);
  win.webContents.once('did-finish-load', async () => {
    try {
      await A.until(`!!document.querySelector('#coursebar [data-view]')`); await sleep(1500);
      await phaseLocal(A);
      await phaseSync(A);
    } catch (e) { check('test run finished without crashing', false, String(e && e.stack || e)); }
    const errs = A.errors.filter(e => !/Failed to load resource|fonts\.g/.test(e));
    check('no errors in the page console', !errs.length, errs);
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    if (!process.argv.includes('--keep')) {
      try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* Windows keeps the profile locked until exit */ }
      app.exit(failed ? 1 : 0);
    }
  });
});
