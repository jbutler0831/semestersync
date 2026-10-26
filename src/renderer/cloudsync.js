// Cloud sync with the SemesterSync account server (desktop only). Loaded after app.js and works on its page
// state: this computer's copy stays complete and is always saved first; sync sends and receives documents.
//
// Each synced document (a course, the Inbox, settings, a study set) remembers the server version this computer
// last saw, and its text then on both sides (r: the account's, l: this computer's). A sync pulls what changed
// on the server, takes changes only made there, combines changes made on both sides (merge.js), and pushes
// this computer's changes with the version they were based on. The server refuses a push that didn't see the
// latest version, so nothing is ever overwritten unseen. What can't be combined goes to "Needs your choice".
(() => {
  const d = window.desktop;
  if (!d || !d.sync || !window.SyncMerge || !window.SSyncPage) return;
  const M = window.SyncMerge, P = window.SSyncPage;
  const { localDocs, applyDocs, saveLocal, snapshot, courseById, editCourse, paintSaveStatus, clockTime, toast, openData, makeDialog, uid, esc, HERE, INBOX_ID, MAX_COURSES } = P;
  const KEY = uid => 'ssync-sync-' + uid;
  const DOC = /^(course-[A-Za-z0-9_-]{1,40}|extras|deck-[A-Za-z0-9_-]{1,40})$/;
  const MAX_DOC = 1000000, BATCH = 50, BATCH_BYTES = 3000000;
  const RETRY = [5, 15, 30, 60, 120];
  const byId = id => document.getElementById(id);

  let user = null; // { id, email }
  let st = null;   // saved sync state for this account, or null when sync is off
  let status = 'off', lastOk = 0, fails = 0, retryAt = 0, problem = '', timer = null, running = null, again = false;
  const rejected = {}; // doc id -> message, for documents the server refused (too large, account full)

  function read(uid) { try { const v = JSON.parse(localStorage.getItem(KEY(uid)) || 'null'); return v && v.v === 1 ? v : null; } catch (_) { return null; } }
  function write() { if (!st || !user) return; try { localStorage.setItem(KEY(user.id), JSON.stringify(st)); } catch (_) { /* full: next sync compares again */ } }
  const on = () => !!(st && user);
  const conflictCount = () => (st ? Object.keys(st.conflicts).length : 0);

  /* ---------- What syncs ---------- */
  const kindOf = id => (id.startsWith('course-') && id !== 'course-' + INBOX_ID ? 'course' : id.startsWith('deck-') ? 'deck' : 'extras');
  const parse = j => { if (j === undefined || j === null) return null; try { return JSON.parse(j); } catch (_) { return null; } };
  function courseOn(cid) { return !st.off.includes(cid); }
  // `json` is the document's text when this computer doesn't have it (for a study set, says which course it belongs to).
  function syncable(id, json) {
    if (!DOC.test(id)) return false;
    if (id === 'extras' || id === 'course-' + INBOX_ID) return st.settings !== false;
    if (id.startsWith('course-')) {
      const cid = id.slice(7), c = courseById(cid);
      return courseOn(cid) && !(c && c.sample);
    }
    const local = P.decks.find(x => 'deck-' + x.id === id);
    const cid = local ? local.cid : (parse(json) || {}).cid;
    const c = cid ? courseById(cid) : null;
    if (c && c.sample) return false;
    return cid ? courseOn(cid) : st.settings !== false;
  }

  /* ---------- One sync ---------- */
  async function ipc(p) {
    const r = await p;
    if (!r || !r.ok) throw { offline: r && r.code === 'offline', signedOut: r && r.signedOut, message: (r && r.message) || 'Sync failed.' };
    return r;
  }
  const typing = () => { const a = document.activeElement; return !!(a && a.closest && a.closest('main input, main textarea, main select, dialog[open] input, dialog[open] textarea')); };

  // What to do with one document from the server (pulled, or handed back by a refused push).
  function incoming(doc, local, adopt, merged) {
    const id = doc.doc_id;
    if (!DOC.test(id)) return;
    const rb = doc.deleted ? undefined : doc.body, rv = doc.version;
    if (!syncable(id, rb)) return;
    const m = st.docs[id], l = local.get(id);
    if (m && m.v === rv && !doc.purged) return; // already seen (our own push coming back)
    if (st.conflicts[id]) { Object.assign(st.conflicts[id], { theirs: rb, rv, device: doc.device || '', at: doc.updated_at || '' }); return; }
    if (!m) {
      if (l === undefined) {
        if (rb === undefined) { st.docs[id] = { v: rv }; return; }
        if (kindOf(id) === 'course' && P.state.courses.length + [...adopt.keys()].filter(k => kindOf(k) === 'course' && adopt.get(k) !== undefined && !courseById(k.slice(7))).length >= MAX_COURSES) { st.docs[id] = { v: rv, r: rb, hidden: true }; return; }
        adopt.set(id, rb); st.docs[id] = { v: rv, r: rb }; return;
      }
      if (rb === undefined) { st.docs[id] = { v: rv }; return; } // deleted there before this computer ever synced it: this copy goes up again
      if (l === rb) { st.docs[id] = { v: rv, r: rb, l }; return; }
      return combine(id, null, l, rb, doc, adopt, merged);
    }
    if (l === m.l) { // only the account changed it
      if (rb === undefined && l !== undefined) snapshot(`Before ${nameOf(id, l)} was removed on ${doc.device || 'another computer'}`, null, { only: [id, l] });
      adopt.set(id, rb); st.docs[id] = { v: rv, r: rb }; return;
    }
    combine(id, m.l, l, rb, doc, adopt, merged);
  }
  function combine(id, baseJson, l, rb, doc, adopt, merged) {
    const at = Date.parse(doc.updated_at || '') || 0;
    const res = M.merge(kindOf(id), parse(baseJson), parse(l), parse(rb), { preferTheirs: at > (P.store.dirtySince || Date.now()) });
    const meta = { v: doc.version, r: rb };
    if (!res.conflicts.length) {
      const json = res.value ? JSON.stringify(res.value) : undefined;
      if (json !== l) adopt.set(id, json);
      st.docs[id] = meta; merged.add(id);
      return;
    }
    st.docs[id] = { ...(st.docs[id] || {}), held: true };
    st.conflicts[id] = { id, base: baseJson === null ? undefined : baseJson, mine: l, theirs: rb, rv: doc.version, device: doc.device || '', at: doc.updated_at || '', list: res.conflicts.slice(0, 30) };
  }
  // Applies documents to the page, then records what this computer's copy of each now looks like.
  function apply(adopt, merged) {
    // A computer with only the sample courses swaps them for the account's real ones.
    if ([...adopt].some(([k, v]) => kindOf(k) === 'course' && v !== undefined) && P.state.courses.length && P.state.courses.every(c => c.sample)) P.state.courses = [];
    if (adopt.size) { applyDocs(adopt); saveLocal(); }
    const after = localDocs();
    for (const id of adopt.keys()) if (st.docs[id] && !merged.has(id)) st.docs[id].l = after.get(id);
    // A combined copy goes back up unless it ended up the same as the account's.
    for (const id of merged) if (st.docs[id]) st.docs[id].l = after.get(id) === st.docs[id].r ? after.get(id) : null;
  }

  // Returns false, changing nothing, when changes arrived while the person is typing (they'd re-render the page under them).
  async function pull(force) {
    const before = JSON.stringify(st);
    const local = localDocs(), adopt = new Map(), merged = new Set(), seen = new Set();
    let since = st.cursor || 0, full = false;
    for (let pages = 0; pages < 100; pages++) {
      const r = await ipc(d.sync.changes(since));
      if (st.epoch == null) st.epoch = r.epoch;
      else if (r.epoch !== st.epoch) throw { cleared: true };
      if (r.reset && !full) { full = true; since = 0; continue; }
      for (const doc of r.docs || []) { seen.add(doc.doc_id); incoming(doc, local, adopt, merged); }
      since = r.cursor;
      if (!r.more) break;
    }
    // Deletion markers older than 90 days are gone: anything this computer synced that the server no longer lists was deleted.
    if (full) for (const id of Object.keys(st.docs)) if (!seen.has(id)) { const v = st.docs[id]; if (v.r !== undefined || v.l !== undefined) incoming({ doc_id: id, version: 0, deleted: true, purged: true }, local, adopt, merged); else delete st.docs[id]; }
    if (adopt.size && !force && typing()) { st = JSON.parse(before); return false; }
    apply(adopt, merged);
    st.cursor = since;
    return true;
  }
  // Courses that didn't fit (8 at most): added here once there's room.
  function unhide() {
    const adopt = new Map();
    for (const [id, m] of Object.entries(st.docs)) {
      if (!m.hidden || P.state.courses.length + adopt.size >= MAX_COURSES) continue;
      adopt.set(id, m.r); st.docs[id] = { v: m.v, r: m.r };
    }
    if (adopt.size) apply(adopt, new Set());
  }

  async function push(round = 0) {
    const local = localDocs(), changes = [];
    for (const id of new Set([...local.keys(), ...Object.keys(st.docs)])) {
      const m = st.docs[id], l = local.get(id);
      if (!syncable(id, m && m.r) || st.conflicts[id] || (m && (m.hidden || m.held))) continue;
      if (m ? l === m.l : l === undefined) continue;
      if (l !== undefined && l.length > MAX_DOC) { rejected[id] = `${nameOf(id, l)} is too large to sync (over 1 MB).`; continue; }
      changes.push(l === undefined ? { doc_id: id, base_version: m ? m.v : 0, deleted: true } : { doc_id: id, base_version: m ? m.v : 0, body: l });
    }
    const refused = [];
    for (let i = 0; i < changes.length;) {
      const batch = []; let bytes = 0;
      while (i < changes.length && batch.length < BATCH && (!batch.length || bytes + (changes[i].body || '').length <= BATCH_BYTES)) { bytes += (changes[i].body || '').length; batch.push(changes[i++]); }
      const r = await ipc(d.sync.push(batch));
      if (st.epoch != null && r.epoch !== st.epoch) throw { cleared: true };
      for (const res of r.results || []) {
        const c = batch.find(x => x.doc_id === res.doc_id); if (!c) continue;
        if (res.status === 'ok') { st.docs[c.doc_id] = c.deleted ? { v: res.version } : { v: res.version, r: c.body, l: c.body }; delete rejected[c.doc_id]; }
        else if (res.status === 'conflict' && res.server) refused.push(res.server);
        else rejected[c.doc_id] = res.message || 'The account refused this change.';
      }
      write();
    }
    // Someone else saved first: combine with their copy, then try once more.
    if (refused.length) {
      const adopt = new Map(), merged = new Set(), now = localDocs();
      for (const doc of refused) incoming(doc, now, adopt, merged);
      apply(adopt, merged);
      if (round < 2) await push(round + 1);
    }
  }

  async function cycle(force) {
    if (!on()) return;
    if (running) { again = true; return running; }
    clearTimeout(timer);
    running = (async () => {
      status = 'syncing'; paint();
      try {
        if (!(await pull(force))) { status = 'idle'; schedule(2500); return; }
        unhide(); await push();
        fails = 0; lastOk = Date.now(); problem = Object.values(rejected)[0] || '';
        status = conflictCount() ? 'conflict' : problem ? 'problem' : 'ok';
      } catch (e) {
        if (e && e.cleared) { stop('Your synced data was removed from your account on another computer, so sync is off here. Everything is still on this computer.'); return; }
        if (e && e.signedOut) { stop('You were signed out of your account, so sync is off. Everything is still on this computer.'); return; }
        const wait = RETRY[Math.min(fails, RETRY.length - 1)];
        fails++; retryAt = Date.now() + wait * 1000;
        status = e && e.offline ? 'offline' : 'problem'; problem = (e && e.message) || 'Sync failed.';
        schedule(wait * 1000);
      }
      write(); paint();
    })();
    try { await running; } finally { running = null; if (again) { again = false; schedule(600); } }
  }
  function schedule(ms) { clearTimeout(timer); if (on()) timer = setTimeout(() => cycle(), ms); }
  function stop(msg) {
    if (user) try { localStorage.removeItem(KEY(user.id)); } catch (_) {}
    st = null; status = 'off'; clearTimeout(timer); paint();
    if (msg) toast(msg);
  }

  /* ---------- Status ---------- */
  const ago = t => clockTime(t);
  function label(pageStatus) {
    if (!on() || ['saving', 'error', 'none'].includes(pageStatus)) return null;
    const n = conflictCount();
    if (status === 'syncing') return ['busy', 'Syncing…'];
    if (n || status === 'conflict') return ['warn', `${n} change${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} your choice · click to review`];
    if (status === 'offline') { const s = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)); return ['warn', `Offline · saved ${HERE}, syncing again ${s ? `in ${s} s` : 'now'}`]; }
    if (status === 'problem') return ['warn', `Saved ${HERE} · ${problem}`];
    if (status === 'ok') return ['ok', `Synced to your account${lastOk ? ' · ' + ago(lastOk) : ''}`];
    return ['', `Saved ${HERE}`];
  }
  function paint() { paintSaveStatus(); paintCourse(); if (P.dataDlg && P.dataDlg.open) renderData(); }
  setInterval(() => { if (status === 'offline') paintSaveStatus(); }, 1000);
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#saveStatus') && conflictCount()) openData(); });

  /* ---------- Your data: sync section and "Needs your choice" ---------- */
  const LABEL = { title: 'Title', date: 'Due date', time: 'Due time', weight: 'Weight', score: 'Score', done: 'Done', notes: 'Notes', type: 'Type', hours: 'Hours', code: 'Course code', credits: 'Credits', target: 'Target grade', text: 'Syllabus text', categories: 'Grading categories', meets: 'Class times', q: 'Question', a: 'Answer', name: 'Name', prio: 'Priority', spent: 'Time spent', deleted: 'Deleted', document: 'Whole course' };
  const show = v => v === undefined || v === null || v === '' ? 'empty' : v === true ? 'yes' : v === false ? 'no' : typeof v === 'object' ? 'changed' : String(v).slice(0, 60);
  function nameOf(id, json) {
    const v = parse(json) || {};
    if (id === 'course-' + INBOX_ID) return 'Your Inbox';
    if (id.startsWith('course-')) return v.code || 'A course';
    if (id.startsWith('deck-')) return `Study set “${v.name || 'Untitled'}”`;
    return 'Your settings';
  }
  const when = iso => { const t = Date.parse(iso); return t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
  async function renderData() {
    const el = P.dataDlg.querySelector('#cloudSec'); if (!el) return;
    const s = await d.account.status().catch(() => null);
    if (!s || !s.user || !s.sync) { el.hidden = true; return; }
    el.hidden = false;
    if (!on() || (user && user.id !== s.user.id)) {
      el.innerHTML = `<h3>Cloud sync</h3><p class="hint">Off. You’re signed in as <b>${esc(s.user.email)}</b>, and nothing is uploaded.</p><div class="row"><button type="button" class="btn sm primary" id="csOn">Turn on cloud sync…</button></div>`;
      el.querySelector('#csOn').onclick = () => { P.dataDlg.close(); document.dispatchEvent(new CustomEvent('ssync:open', { detail: 'sync' })); };
      return;
    }
    const cs = Object.values(st.conflicts);
    const hidden = Object.values(st.docs).filter(m => m.hidden).length;
    const off = P.state.courses.filter(c => !c.sample && !courseOn(c.id));
    el.innerHTML = `<h3>Cloud sync</h3>
      <p class="hint">On for <b>${esc(user.email)}</b>. Synced courses are kept in your account and on this computer.${off.length ? ` Only on this computer: ${esc(off.map(c => c.code).join(', '))}.` : ''}${st.settings === false ? ' Settings and study history stay on this computer.' : ''} <span id="csUsage"></span></p>
      ${hidden ? `<p class="msg">Your account has ${hidden} more course${hidden === 1 ? '' : 's'} than fit here (8 at most). Remove a course here to make room.</p>` : ''}
      ${Object.values(rejected).map(m => `<p class="msg bad">${esc(m)}</p>`).join('')}
      ${cs.length ? `<div class="needs"><h4>Needs your choice</h4><p class="hint">These changed on this computer and on another one in ways that can’t be combined. Until you choose, this computer keeps its version and the rest keeps syncing.</p>
        ${cs.map(c => conflictCard(c)).join('')}</div>` : ''}
      <div class="row"><button type="button" class="btn sm" id="csNow">Sync now</button><button type="button" class="btn sm ghost" id="csOff">Turn off cloud sync</button><button type="button" class="btn sm ghost danger" id="csClear">Remove my data from the account…</button></div>
      <div id="csClearForm" hidden><p class="hint">Deletes everything synced to <b>${esc(user.email)}</b> from the server and turns sync off on every computer. Your account stays, and so does everything on this computer.</p>
        <div class="row"><input type="password" id="csPass" placeholder="Your account password" autocomplete="current-password" maxlength="128" required><button type="button" class="btn sm danger-fill" id="csClearGo">Remove from account</button></div><p class="msg bad" id="csMsg" hidden></p></div>`;
    const q = s2 => el.querySelector(s2);
    q('#csNow').onclick = () => cycle(true);
    let armed = false;
    q('#csOff').onclick = () => {
      if (!armed) { armed = true; q('#csOff').textContent = 'Turn off? Everything stays on this computer. Click again'; return; }
      stop(); toast('Cloud sync is off. Everything is still on this computer.'); renderData();
    };
    q('#csClear').onclick = () => { q('#csClearForm').hidden = false; q('#csPass').focus(); };
    q('#csClearGo').onclick = async () => {
      if (!q('#csPass').value) { q('#csPass').focus(); return; }
      const r = await d.sync.clear(q('#csPass').value);
      if (!r.ok) { q('#csMsg').textContent = r.message; q('#csMsg').hidden = false; return; }
      stop('Removed your synced data from the account. Sync is off; everything is still on this computer.'); renderData();
    };
    el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => resolve(b.dataset.id, b.dataset.pick));
    d.sync.usage().then(u => { const x = q('#csUsage'); if (x && u.ok) x.textContent = `Using ${u.bytes < 1048576 ? Math.max(1, Math.round(u.bytes / 1024)) + ' KB' : (u.bytes / 1048576).toFixed(1) + ' MB'} of ${Math.round(u.max_bytes / 1048576)} MB.`; }).catch(() => {});
  }
  function conflictCard(c) {
    const both = c.mine !== undefined && c.theirs !== undefined && kindOf(c.id) !== 'extras';
    const roomForBoth = kindOf(c.id) !== 'course' || P.state.courses.length < MAX_COURSES;
    const name = nameOf(c.id, c.mine !== undefined ? c.mine : c.theirs);
    const diffs = c.list.slice(0, 6).map(x => x.field === 'document' || x.field === 'deleted'
      ? `<li>${esc(x.what && x.field === 'deleted' ? x.what + ': ' : '')}${esc(x.mine)} here, ${esc(x.theirs)} on ${esc(c.device || 'the other computer')}</li>`
      : `<li>${esc(x.what && x.what !== 'Course' && x.what !== 'Study set' ? x.what + ' · ' : '')}${esc(LABEL[x.field] || x.field)}: <b>${esc(show(x.mine))}</b> here, <b>${esc(show(x.theirs))}</b> on ${esc(c.device || 'the other computer')}</li>`).join('');
    return `<div class="conflict" data-conflict="${esc(c.id)}"><b>${esc(name)}</b><small>Changed here and on ${esc(c.device || 'another computer')}${c.at ? ', ' + esc(when(c.at)) : ''}</small>
      <ul>${diffs}${c.list.length > 6 ? `<li>…and ${c.list.length - 6} more</li>` : ''}</ul>
      <div class="row"><button type="button" class="btn sm" data-pick="mine" data-id="${esc(c.id)}">Keep this computer’s</button><button type="button" class="btn sm" data-pick="theirs" data-id="${esc(c.id)}">Keep the other</button>${both ? `<button type="button" class="btn sm" data-pick="both" data-id="${esc(c.id)}"${roomForBoth ? '' : ' disabled title="You already have 8 courses"'}>Keep both</button>` : ''}</div></div>`;
  }
  function resolve(id, pick) {
    const c = st.conflicts[id]; if (!c) return;
    const meta = { v: c.rv, r: c.theirs };
    if (pick === 'mine') {
      if (c.theirs !== undefined) snapshot(`Other copy of ${nameOf(id, c.theirs)} (you kept this computer’s)`, null, { only: [id, c.theirs] });
      st.docs[id] = { ...meta, l: null }; // goes up on the next sync
    } else if (pick === 'theirs') {
      if (c.mine !== undefined) snapshot(`This computer’s copy of ${nameOf(id, c.mine)} (you kept the other)`, null, { only: [id, c.mine] });
      st.docs[id] = meta;
      applyDocs(new Map([[id, c.theirs]])); saveLocal();
      st.docs[id].l = localDocs().get(id);
    } else if (pick === 'both') {
      const v = parse(c.theirs); if (!v) return;
      const old = v.id, nid = uid();
      v.id = nid;
      if (kindOf(id) === 'course') { v.code = String(v.code || 'Course').slice(0, 14) + ' (2)'; v.order = (v.order || 0) + 0.5; (v.items || []).forEach(it => { it.cid = nid; if (String(it.id).startsWith(old)) it.id = nid + String(it.id).slice(old.length); }); }
      else v.name = (v.name || 'Study set') + ' (other copy)';
      st.docs[id] = { ...meta, l: null };
      applyDocs(new Map([[(kindOf(id) === 'course' ? 'course-' : 'deck-') + nid, JSON.stringify(v)]])); saveLocal();
    }
    delete st.conflicts[id];
    write(); paint();
    toast(pick === 'mine' ? 'Kept this computer’s version' : pick === 'theirs' ? 'Kept the other version' : 'Kept both');
    cycle(true);
  }

  /* ---------- Each course: synced, or only on this computer ---------- */
  const pdlg = makeDialog('course-sync');
  function paintCourse() {
    let b = byId('courseSync');
    const c = editCourse();
    if (!b) {
      const rm = byId('removeCourse'); if (!rm) return;
      b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ghost'; b.id = 'courseSync';
      rm.before(b);
      b.onclick = () => askCourse();
    }
    b.hidden = !on() || !c || c.sample;
    if (!b.hidden) { const synced = courseOn(c.id); b.textContent = synced ? 'Synced' : 'Only on this computer'; b.title = synced ? 'This course syncs to your account. Click to change.' : 'This course isn’t uploaded. Click to sync it.'; b.setAttribute('aria-label', `${c.code}: ${b.textContent}. Change sync`); }
  }
  function askCourse() {
    const c = editCourse(); if (!c || !on()) return;
    const id = 'course-' + c.id, synced = courseOn(c.id);
    pdlg.innerHTML = synced
      ? `<form method="dialog"><h2>Stop syncing ${esc(c.code)}?</h2><p class="hint">It stays on this computer either way.</p>
        <p class="hint"><b>Remove it from the account</b> deletes the account’s copy; other computers keep a safety copy. <b>Keep the account’s copy</b> leaves it there as it is now, and stops updating it from here.</p>
        <div class="actions"><button class="btn" value="cancel">Cancel</button><span style="flex:1"></span><button type="button" class="btn" data-cs="keep">Keep the account’s copy</button><button type="button" class="btn danger" data-cs="remove">Remove it from the account</button></div></form>`
      : `<form method="dialog"><h2>Sync ${esc(c.code)}?</h2><p class="hint">Uploads ${esc(c.code)}, with its deliverables, scores, notes, syllabus text and study sets, to your account, and keeps it up to date there.</p>
        <div class="actions"><button class="btn" value="cancel">Cancel</button><span style="flex:1"></span><button type="button" class="btn primary" data-cs="on">Sync this course</button></div></form>`;
    pdlg.querySelectorAll('[data-cs]').forEach(b => b.onclick = async () => {
      const how = b.dataset.cs;
      pdlg.close();
      const deckIds = P.decks.filter(x => x.cid === c.id).map(x => 'deck-' + x.id);
      if (how === 'on') { st.off = st.off.filter(x => x !== c.id); delete st.docs[id]; deckIds.forEach(k => delete st.docs[k]); write(); paint(); cycle(true); return; }
      if (how === 'remove') {
        const gone = [id, ...deckIds].filter(k => st.docs[k] && (st.docs[k].r !== undefined || st.docs[k].l !== undefined)).map(k => ({ doc_id: k, base_version: st.docs[k].v, deleted: true }));
        if (gone.length) { const r = await d.sync.push(gone).catch(() => null); if (!r || !r.ok) { toast((r && r.message) || 'Couldn’t reach your account. Try again when you’re online.'); return; } }
      }
      st.off.push(c.id); delete st.docs[id]; delete st.conflicts[id]; deckIds.forEach(k => { delete st.docs[k]; delete st.conflicts[k]; });
      write(); paint();
      toast(how === 'remove' ? `Removed ${c.code} from your account. It’s still on this computer.` : `${c.code} stays on this computer only`);
    });
    pdlg.showModal();
  }

  /* ---------- Starting ---------- */
  async function start() {
    const s = await d.account.status().catch(() => null);
    user = s && s.user ? s.user : null;
    st = user && s.sync ? read(user.id) : null;
    status = on() ? 'idle' : 'off';
    paint();
    if (on()) schedule(400);
  }
  // Called by the consent dialog: `off` lists courses to keep only on this computer.
  async function enable({ off, settings }) {
    const s = await d.account.status();
    if (!s.user) return;
    user = s.user;
    st = { v: 1, cursor: 0, epoch: null, docs: {}, off: off || [], settings: settings !== false, conflicts: {} };
    write(); await cycle(true);
  }
  // Every course and study set in the account, for the consent dialog.
  async function accountDocs() {
    const out = []; let since = 0;
    for (let i = 0; i < 100; i++) {
      const r = await d.sync.changes(since);
      if (!r.ok) return null;
      for (const x of r.docs) if (!x.deleted) out.push(x);
      since = r.cursor; if (!r.more) break;
    }
    return out;
  }

  setInterval(() => { if (!document.hidden) cycle(); }, 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cycle(); });
  addEventListener('online', () => cycle());

  window.CloudSync = {
    start, enable, accountDocs, label, renderData, paintCourse,
    changed: () => { if (on()) schedule(1200); },
    syncNow: () => cycle(true),
    isOn: () => on(),
    where: () => (on() ? `Synced to your account, with a complete copy ${HERE}.` : null),
    forget: uid => { try { localStorage.removeItem(KEY(uid)); } catch (_) {} if (user && user.id === uid) { st = null; status = 'off'; clearTimeout(timer); paint(); } },
  };
  if (P.store.loaded) start();
})();
