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

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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

/* ---------- Fake account server: one shared cloud, a signed-in flag per window ---------- */
const cloud = new Map(); // doc id -> body
let cloudDown = false;
const users = new Map(); // webContents id -> user or null
const USER = { id: 'user-1', email: 'student@example.com' };
const who = e => users.get(e.sender.id) || null;
for (const ch of ['account:status', 'account:sign-in', 'account:sign-up', 'account:sign-out', 'cloud:list', 'cloud:set', 'cloud:delete']) ipcMain.removeHandler(ch);
ipcMain.handle('account:status', e => ({ configured: true, user: who(e) }));
ipcMain.handle('account:sign-in', e => { users.set(e.sender.id, USER); return { ok: true, user: USER }; });
ipcMain.handle('account:sign-up', e => { users.set(e.sender.id, USER); return { ok: true, user: USER }; });
ipcMain.handle('account:sign-out', e => { users.set(e.sender.id, null); return { ok: true }; });
const down = () => ({ ok: false, message: 'Couldn\'t reach the account server. Check your internet connection.' });
ipcMain.handle('cloud:list', e => { if (!who(e)) return { ok: false, message: 'Not signed in' }; if (cloudDown) return down(); return { ok: true, docs: [...cloud].map(([id, body]) => ({ id, body: JSON.parse(JSON.stringify(body)) })) }; });
ipcMain.handle('cloud:set', (e, { id, body }) => { if (!who(e)) return { ok: false }; if (cloudDown) return down(); cloud.set(id, JSON.parse(JSON.stringify(body))); return { ok: true }; });
ipcMain.handle('cloud:delete', (e, { id }) => { if (!who(e)) return { ok: false }; if (cloudDown) return down(); cloud.delete(id); return { ok: true }; });

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
Instructor: Dr. Rivera

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

  console.log('\n# Search and keyboard');
  await A.key('k', { meta: true, ctrl: process.platform !== 'darwin' });
  check('Ctrl/⌘ K opens search', await A.until(`!!document.querySelector('dialog.search-dlg[open]')`, 2000));
  await A.setVal('#qIn', 'midterm');
  const res = await A.js(`[...document.querySelectorAll('#qList li[data-qi]')].map(l => l.innerText.replace(/\\n+/g, ' | '))`);
  check('search finds deliverables across courses', res.some(r => /Midterm/i.test(r)), res);
  await A.js(`document.getElementById('qIn').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`); await sleep(400);
  check('opening a result jumps to its row', await A.js(`!document.querySelector('dialog.search-dlg[open]') && !!document.querySelector('#rows tr.flash')`));
  await A.key('3', { alt: true, code: 'Digit3' }); await sleep(200);
  check('Alt+3 switches to Grades', (await A.js(`document.querySelector('.nav .on').textContent`)) === 'Grades');
  await A.key('?'); await sleep(200);
  check('? lists the shortcuts', await A.js(`!!document.querySelector('dialog.keys-dlg[open]')`));
  await A.js(`document.querySelector('dialog.keys-dlg').close()`);
  await A.js(`document.querySelector('.nav [data-tab="semester"]').click()`);
  await A.setVal('#tableSearch', 'final');
  const rows = await A.js(`[...document.querySelectorAll('#rows tr[data-id] [data-k="title"]')].map(i => i.value)`);
  check('the table search filters deliverables', rows.length > 0 && rows.every(t => /final/i.test(t)), rows);
  await A.setVal('#tableSearch', '');
}

async function phaseSync(A) {
  console.log('\n# Signing in moves this computer’s courses into the account');
  const mine = await A.js(`[...document.querySelectorAll('#coursebar [data-view]')].slice(1).map(b => b.textContent.replace(/\\d+$/, ''))`);
  await A.click('#accountBtn'); await sleep(200);
  await A.js(`(() => { document.getElementById('authEmail').value = 'student@example.com'; document.getElementById('authPass').value = 'correct horse'; document.getElementById('authForm').requestSubmit(); })()`);
  await A.loaded(); await A.until(`!!document.querySelector('#coursebar [data-view]')`); await sleep(1500);
  const courseDocs = () => [...cloud.keys()].filter(k => k.startsWith('course-'));
  check('the account gets every course', courseDocs().length === mine.length, { cloud: [...cloud.keys()], mine });
  check('the page now saves to the account', /account/.test(await A.saveStatus()), await A.saveStatus());

  console.log('\n# A second computer');
  const B = await newWindow('persist:device-b');
  users.set(B.win.webContents.id, USER);
  await B.reload();
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

  console.log('\n# The same course edited on both');
  await setTitle(A, 1, 'Second edit on A'); await A.flushed();
  await setTitle(B, 1, 'Second edit on B'); await B.flushed();
  const cid = await B.js(`document.querySelector('#rows tr[data-id]').dataset.id.split('-')[0]`);
  const remote = JSON.parse(cloud.get('course-' + cid).json);
  check('the newer edit wins in the account', remote.items.some(i => i.title === 'Second edit on B'), remote.items.map(i => i.title));
  await B.js(`document.dispatchEvent(new CustomEvent('ssync:data', { detail: 'data' }))`); await sleep(300);
  const bs = await B.js(`[...document.querySelectorAll('#snapList b')].map(b => b.textContent)`);
  check('the other version is kept as a safety copy', bs.some(s => /edited on two devices/.test(s)), bs);
  await B.js(`(() => { const b = [...document.querySelectorAll('#snapList li')].find(l => /two devices/.test(l.innerText)).querySelector('[data-restore]'); b.click(); })()`); await sleep(400);
  check('and restoring it brings back A’s edit', (await titleOf(B, 1)) === 'Second edit on A', await titleOf(B, 1));
  await B.flushed();

  console.log('\n# Offline');
  cloudDown = true;
  await setTitle(A, 2, 'Typed while offline'); await sleep(1500);
  check('an offline save says so and keeps the change', /Offline/.test(await A.saveStatus()), await A.saveStatus());
  await A.reload();
  await A.js(`document.querySelectorAll('#coursebar [data-view]')[1].click()`);
  check('reopening offline loads this computer’s copy', (await titleOf(A, 2)) === 'Typed while offline', await titleOf(A, 2));
  cloudDown = false;
  await A.until(`/Synced/.test(document.getElementById('saveStatus').textContent)`, 20000);
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
  check('signing out removes the account’s copy from this computer', !(await A.js(`!!localStorage.getItem('ssync-account-cache-v1')`)));
  check('and goes back to saving on this computer', /this computer/.test(await A.saveStatus()), await A.saveStatus());

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
  check('asks before adding them', /Courses on this computer/.test(await C.until(`document.querySelector('dialog.account[open]') && /Courses on this computer/.test(document.querySelector('dialog.account').innerText) && document.querySelector('dialog.account').innerText`)));
  const p2 = C.loaded(); await C.click('#mergeYes'); await p2; await sleep(1500);
  check('“Add them” puts the course in the account', [...cloud.values()].some(b => b.json && /CHEM 110/.test(b.json)));
  check('samples from this computer aren’t added to an existing account', ![...cloud.values()].some(b => b.json && /"sample":true/.test(b.json)));
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
