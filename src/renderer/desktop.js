// Desktop-only additions: settings, native calendar export, menu shortcuts and deadline reminders.
(() => {
  const d = window.desktop;
  const $ = id => document.getElementById(id);
  const toast = msg => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600); };
  const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  document.documentElement.classList.add('is-desktop', 'platform-' + d.platform);

  /* ---------- Top bar ---------- */
  const pill = document.querySelector('.demo-pill');
  pill.textContent = 'Google sync simulated';
  pill.title = 'Google account sync is simulated. Use "Open in Calendar" to add events to Apple Calendar or Outlook for real.';
  const gear = document.createElement('button');
  gear.type = 'button'; gear.className = 'theme-btn'; gear.id = 'settingsBtn';
  gear.setAttribute('aria-label', 'Settings'); gear.title = 'Settings'; gear.innerHTML = GEAR;
  $('themeBtn').before(gear);

  /* ---------- Settings dialog ---------- */
  const dlg = document.createElement('dialog');
  dlg.className = 'settings';
  dlg.innerHTML = `
    <form method="dialog" id="settingsForm">
      <h2>Settings</h2>
      <section class="field">
        <label for="apiKey">Claude API key</label>
        <input type="password" id="apiKey" autocomplete="off" spellcheck="false" placeholder="sk-ant-…">
        <p class="hint" id="keyHint">Used to read syllabi with Claude. The key is encrypted with your system keychain and only sent to Anthropic.</p>
        <p class="hint">Don't have one? <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">Create a key in the Claude Console</a>.</p>
        <p class="msg" id="keyMsg" hidden></p>
      </section>
      <div class="toggle-row">
        <div>Deadline reminders<small>A desktop notification the day before something is due</small></div>
        <label class="switch"><input type="checkbox" id="remindersToggle" aria-label="Deadline reminders"><span></span></label>
      </div>
      <div class="actions">
        <button type="button" class="btn ghost danger" id="removeKey">Remove key</button>
        <span style="flex:1"></span>
        <button type="button" class="btn" id="cancelSettings">Cancel</button>
        <button type="submit" class="btn primary" id="saveSettings">Save</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);

  let settings = { hasKey: false, reminders: true };
  async function openSettings() {
    settings = await d.settings.get();
    $('apiKey').value = '';
    $('apiKey').placeholder = settings.hasKey ? (settings.keyFromEnv ? 'Using ANTHROPIC_API_KEY from your environment' : 'Saved. Paste a new key to replace it') : 'sk-ant-…';
    $('removeKey').hidden = !settings.hasKey || settings.keyFromEnv;
    $('remindersToggle').checked = settings.reminders;
    $('keyMsg').hidden = true;
    dlg.showModal();
    $('apiKey').focus();
  }
  function keyMsg(text, bad) { const m = $('keyMsg'); m.textContent = text; m.className = 'msg' + (bad ? ' bad' : ''); m.hidden = false; }
  $('cancelSettings').onclick = () => dlg.close();
  $('removeKey').onclick = async () => { await d.settings.set({ apiKey: '' }); dlg.close(); location.reload(); };
  $('settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const key = $('apiKey').value.trim();
    const reminders = $('remindersToggle').checked;
    if (key) {
      $('saveSettings').disabled = true; keyMsg('Checking key…');
      const test = await d.settings.testKey(key);
      $('saveSettings').disabled = false;
      if (!test.ok) { keyMsg(test.message, true); return; }
      const res = await d.settings.set({ apiKey: key, reminders });
      if (!res.ok) { keyMsg(res.message, true); return; }
      dlg.close(); location.reload(); // re-runs the page's Claude check with the new key
      return;
    }
    await d.settings.set({ reminders });
    settings.reminders = reminders;
    dlg.close();
    toast('Settings saved');
    checkReminders();
  });
  gear.onclick = openSettings;

  /* ---------- Claude availability hint ---------- */
  d.claude.available().then(ok => {
    if (ok) return;
    const tag = $('modelTag');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn sm'; b.textContent = 'Add Claude API key';
    b.onclick = openSettings;
    tag.after(b);
    setTimeout(() => { $('useAi').title = 'Add a Claude API key in Settings to read syllabi with Claude'; }, 1000);
  });

  /* ---------- Real calendar export ---------- */
  async function exportIcs(open) {
    const text = $('ics').textContent;
    if (!/BEGIN:VEVENT/.test(text)) { toast('Nothing to export. Turn on sync for some deliverables first.'); return; }
    const res = await d.saveIcs(text, open);
    if (res.ok) toast(open ? 'Opened in your calendar app to import' : 'Saved calendar file');
  }
  const icsBar = document.querySelector('details.ics .bar');
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button'; saveBtn.className = 'btn sm'; saveBtn.textContent = 'Save .ics file…';
  saveBtn.onclick = () => exportIcs(false);
  icsBar.prepend(saveBtn);
  icsBar.querySelector('span').textContent = 'Import it into Apple Calendar, Outlook or Google Calendar.';
  const openBtn = document.createElement('button');
  openBtn.type = 'button'; openBtn.className = 'btn'; openBtn.id = 'openInCalendar';
  openBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M8 8.5v4M6 10.5h4"/></svg> Open in Calendar app';
  openBtn.title = 'Save a calendar file and open it in Apple Calendar or Outlook to import every event';
  openBtn.onclick = () => exportIcs(true);
  $('syncBtn').after(openBtn);

  /* ---------- Account ---------- */
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  const PERSON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="5.5" r="2.8"/><path d="M2.8 14c.6-2.7 2.7-4.2 5.2-4.2s4.6 1.5 5.2 4.2"/></svg>';
  const acctBtn = document.createElement('button');
  acctBtn.type = 'button'; acctBtn.className = 'acct-btn'; acctBtn.id = 'accountBtn';
  gear.before(acctBtn);

  const adlg = document.createElement('dialog');
  adlg.className = 'settings account';
  document.body.appendChild(adlg);
  let acct = { configured: false, user: null };
  let mode = 'in';

  function paintAcctBtn() {
    if (acct.user) {
      acctBtn.innerHTML = `<span class="avatar">${esc(acct.user.email[0].toUpperCase())}</span><span class="who">${esc(acct.user.email)}</span>`;
      acctBtn.title = `Signed in as ${acct.user.email}`;
    } else {
      acctBtn.innerHTML = `${PERSON}<span class="who">Sign in</span>`;
      acctBtn.title = 'Sign in or create an account';
    }
  }
  function renderAccount(msg, bad) {
    const note = msg ? `<p class="msg${bad ? ' bad' : ''}">${esc(msg)}</p>` : '';
    if (!acct.configured) {
      adlg.innerHTML = `<form method="dialog"><h2>Accounts</h2>
        <p class="hint">Accounts aren't set up in this build yet. The app still works and saves your courses on this computer.</p>
        <p class="hint">To turn accounts on, follow <b>Accounts</b> in the project README (about 5 minutes with a free Supabase project).</p>
        <div class="actions"><span style="flex:1"></span><button class="btn primary" value="close">OK</button></div></form>`;
      return;
    }
    if (acct.user) {
      adlg.innerHTML = `<form method="dialog"><h2>Your account</h2>
        <div class="acct-card"><span class="avatar lg">${esc(acct.user.email[0].toUpperCase())}</span><div><b>${esc(acct.user.email)}</b><span>Your courses sync to this account. Only you can see them.</span></div></div>
        ${note}
        <div class="actions"><button type="button" class="btn ghost danger" id="signOutBtn">Sign out</button><span style="flex:1"></span><button class="btn primary" value="close">Done</button></div></form>`;
      adlg.querySelector('#signOutBtn').onclick = async () => { await d.account.signOut(); location.reload(); };
      return;
    }
    const actions = (label) => `<div class="actions"><span style="flex:1"></span><button type="button" class="btn" id="authCancel">Cancel</button><button type="submit" class="btn primary" id="authSubmit">${label}</button></div>`;
    if (mode === 'google') {
      adlg.innerHTML = `<form id="authForm"><h2>Continue in your browser</h2>
        <p class="hint">We opened Google sign-in in your web browser. Choose your account there, and you'll be signed in here automatically.</p>
        <div class="waiting"><span class="spinner" aria-hidden="true"></span>Waiting for Google…</div>
        ${note}
        <div class="actions"><span style="flex:1"></span><button type="button" class="btn" id="authCancel">Cancel</button></div></form>`;
      $('authCancel').onclick = () => { d.account.cancelGoogle(); mode = 'in'; renderAccount(); };
      return;
    }
    if (mode === 'reset1') {
      adlg.innerHTML = `<form id="authForm"><h2>Reset your password</h2>
        <p class="hint">Enter your account's email. We'll send a code you can use to choose a new password.</p>
        <section class="field"><label for="authEmail">Email</label><input type="email" id="authEmail" autocomplete="email" required></section>
        ${note}${actions('Send code')}</form>`;
    } else if (mode === 'reset2') {
      adlg.innerHTML = `<form id="authForm"><h2>Choose a new password</h2>
        <p class="hint">If an account exists for <b>${esc(resetEmail)}</b>, we sent it a code. It can take a minute to arrive, so check spam too.</p>
        <section class="field"><label for="authCode">Code from the email</label><input type="text" id="authCode" class="code-in" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required></section>
        <section class="field"><label for="authPass">New password</label><input type="password" id="authPass" autocomplete="new-password" minlength="8" required><p class="hint">At least 8 characters.</p></section>
        ${note}
        <p class="hint"><button type="button" class="linkish" id="resendCode">Send a new code</button></p>
        ${actions('Save password')}</form>`;
      $('resendCode').onclick = async () => { const r = await d.account.requestReset(resetEmail); renderAccount(r.ok ? 'Sent a new code.' : r.message, !r.ok); };
    } else {
      const up = mode === 'up';
      adlg.innerHTML = `<form id="authForm"><h2>${up ? 'Create your account' : 'Sign in'}</h2>
        <div class="seg" role="group" aria-label="Account action"><button type="button" data-m="in" aria-pressed="${!up}">Sign in</button><button type="button" data-m="up" aria-pressed="${up}">Create account</button></div>
        <button type="button" class="btn google-btn" id="googleBtn">${GOOGLE_G}Continue with Google</button>
        <div class="or"><span>or use email</span></div>
        <section class="field"><label for="authEmail">Email</label><input type="email" id="authEmail" autocomplete="email" required></section>
        <section class="field"><div class="label-row"><label for="authPass">Password</label>${up ? '' : '<button type="button" class="linkish" id="forgotBtn">Forgot password?</button>'}</div>
          <input type="password" id="authPass" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="8" required>
          ${up ? '<p class="hint">At least 8 characters.</p>' : ''}</section>
        ${up ? '<p class="hint">The courses on this computer move into your new account, so nothing is lost.</p>' : ''}
        ${note}${actions(up ? 'Create account' : 'Sign in')}</form>`;
      adlg.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; const em = $('authEmail').value; renderAccount(); $('authEmail').value = em; $('authEmail').focus(); });
      $('googleBtn').onclick = startGoogle;
      if (!up) $('forgotBtn').onclick = () => { const em = $('authEmail').value; mode = 'reset1'; renderAccount(); $('authEmail').value = em; $('authEmail').focus(); };
    }
    $('authCancel').onclick = () => { if (mode.startsWith('reset')) { mode = 'in'; renderAccount(); } else adlg.close(); };
    $('authForm').addEventListener('submit', onAuthSubmit);
  }
  let resetEmail = '';
  async function finishSignIn() {
    await moveLocalCoursesIntoAccount();
    location.reload(); // the page reloads and loads courses from the account
  }
  async function startGoogle() {
    mode = 'google'; renderAccount();
    const res = await d.account.google();
    if (mode !== 'google') return; // cancelled in the meantime
    if (res.ok) { await finishSignIn(); return; }
    mode = 'in';
    renderAccount(res.cancelled ? '' : res.message, !res.cancelled);
  }
  async function moveLocalCoursesIntoAccount() {
    const listed = await d.cloud.list();
    if (!listed.ok || listed.docs.some(x => x.id === 'meta')) return; // account already has courses: keep them
    let local = [];
    try { local = JSON.parse(localStorage.getItem('ssync-courses-v1') || '[]'); } catch { /* nothing saved locally */ }
    await d.cloud.set('meta', { v: 1 });
    for (const json of local) {
      try { const c = JSON.parse(json); await d.cloud.set('course-' + c.id, { json }); } catch { /* skip unreadable course */ }
    }
  }
  async function onAuthSubmit(e) {
    e.preventDefault();
    const btn = $('authSubmit'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Working…';
    const keep = (msg, bad) => { const em = $('authEmail') && $('authEmail').value; renderAccount(msg, bad); if (em && $('authEmail')) $('authEmail').value = em; };
    if (mode === 'reset1') {
      resetEmail = $('authEmail').value.trim();
      const r = await d.account.requestReset(resetEmail);
      if (!r.ok) { keep(r.message, true); return; }
      mode = 'reset2'; renderAccount(); $('authCode').focus(); return;
    }
    if (mode === 'reset2') {
      const r = await d.account.completeReset(resetEmail, $('authCode').value.trim(), $('authPass').value);
      if (!r.ok) { const code = $('authCode').value; renderAccount(r.message, true); $('authCode').value = code; return; }
      await finishSignIn(); return;
    }
    const email = $('authEmail').value.trim(), password = $('authPass').value;
    const res = mode === 'up' ? await d.account.signUp(email, password) : await d.account.signIn(email, password);
    if (!res.ok) { keep(res.message, true); btn.textContent = label; return; }
    if (res.needsConfirm) { mode = 'in'; renderAccount(`Almost done. We sent a confirmation link to ${email}. Click it, then sign in here.`); $('authEmail').value = email; return; }
    await finishSignIn();
  }
  async function openAccount() {
    acct = await d.account.status();
    if (mode !== 'google') mode = mode === 'up' ? 'up' : 'in';
    renderAccount();
    adlg.showModal();
    const em = $('authEmail'); if (em) em.focus();
  }
  acctBtn.onclick = openAccount;
  d.account.status().then(s => { acct = s; paintAcctBtn(); });
  paintAcctBtn();

  /* ---------- Menu shortcuts ---------- */
  d.onMenu('account', openAccount);
  d.onMenu('settings', openSettings);
  d.onMenu('new-course', () => { const b = $('addCourse'); if (b) b.click(); else toast('You can track up to 8 courses'); });
  d.onMenu('open-file', () => $('fileInput').click());
  d.onMenu('export-ics', () => exportIcs(true));
  d.onMenu('theme', () => $('themeBtn').click());

  /* ---------- Deadline reminders ---------- */
  const NOTIFIED_KEY = 'ssync-notified-v1';
  function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  async function checkReminders() {
    if (!settings.reminders || !('Notification' in window)) return;
    const courses = readJson('ssync-courses-v1', []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    if (!courses.length) return;
    const notified = new Set(readJson(NOTIFIED_KEY, []));
    const now = Date.now(), soon = now + 36 * 3600 * 1000;
    for (const c of courses) for (const it of c.items || []) {
      if (!it.sync) continue;
      const [y, m, day] = it.date.split('-').map(Number);
      const [h, mi] = (it.time || '23:59').split(':').map(Number);
      const due = new Date(y, m - 1, day, h, mi).getTime();
      const key = `${it.id}|${it.date}|${it.time}`;
      if (due <= now || due > soon || notified.has(key)) continue;
      const when = new Date(due).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      new Notification(`${c.code}: ${it.title}`, { body: `Due ${when}${it.weight ? ` · ${it.weight}% of your grade` : ''}`, silent: false });
      notified.add(key);
    }
    try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notified].slice(-500))); } catch { /* storage full; reminders may repeat */ }
  }
  d.settings.get().then(s => { settings = s; setTimeout(checkReminders, 4000); });
  setInterval(checkReminders, 30 * 60 * 1000);
})();
