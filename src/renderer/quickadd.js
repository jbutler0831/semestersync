// The Quick Add window: type a task, check what was understood, save. The main app does the saving.
(() => {
  const q = window.desktop.quick;
  const $ = id => document.getElementById(id);
  const TYPES = ['Exam', 'Quiz', 'Lab', 'Project', 'Paper', 'Reading', 'Homework', 'Study', 'Other'];
  let ctx = { courses: [] }, parsed = null, prio = 'normal';
  const uid = () => Math.random().toString(36).slice(2, 10);
  const fit = () => q.resize(Math.ceil(document.querySelector('main').getBoundingClientRect().height));
  $('type').innerHTML = TYPES.map(t => `<option>${t}</option>`).join('');
  function setPrio(p) { prio = p; document.querySelectorAll('#prio [data-p]').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === p)); }
  function reset(clear) {
    parsed = null; $('review').hidden = true; $('hint').hidden = false; $('done').hidden = true; $('err').hidden = true;
    if (clear) $('text').value = '';
    $('text').disabled = false; $('text').focus(); fit();
  }
  function show() {
    const p = parsed;
    $('title').value = p.title;
    $('course').innerHTML = '<option value="">No course yet</option>' + ctx.courses.map(c => `<option value="${c.id}"${c.id === p.cid ? ' selected' : ''}>${c.code.replace(/</g, '&lt;')}${p.courseChoices.includes(c.id) ? ' (matches)' : ''}</option>`).join('');
    $('type').value = p.type; $('date').value = p.date || ''; $('time').value = p.time || '23:59';
    $('hours').value = p.hours ?? ''; $('notes').value = p.notes; setPrio(p.prio);
    const ch = $('choices');
    ch.hidden = !p.dateChoices.length;
    ch.innerHTML = p.dateChoices.length ? `<span></span>` + p.dateChoices.map(c => `<button type="button" class="chip" data-d="${c.date}" aria-pressed="false">${c.label}</button>`).join('') : '';
    if (p.dateChoices.length) ch.querySelector('span').textContent = p.dateNote;
    const warn = [p.courseNote, !p.dateChoices.length && p.dateNote].filter(Boolean).join(' ');
    $('warn').hidden = !warn; $('warn').textContent = warn;
    syncSave();
    $('review').hidden = false; $('hint').hidden = true; fit();
    (p.dateChoices.length ? ch.querySelector('[data-d]') : $('title')).focus();
  }
  function syncSave() { $('save').textContent = $('date').value ? 'Save task' : 'Save without a date'; $('saveHint').textContent = $('date').value ? '' : 'It waits in your Inbox until it has a date.'; }
  $('f').addEventListener('submit', e => {
    e.preventDefault();
    const text = $('text').value.trim(); if (!text) return;
    parsed = window.SSTaskParse.parseTask(text, { courses: ctx.courses });
    show();
  });
  $('choices').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (!b) return; $('date').value = b.dataset.d; $('choices').querySelectorAll('[data-d]').forEach(x => x.setAttribute('aria-pressed', x === b)); syncSave(); });
  $('date').addEventListener('input', syncSave);
  $('prio').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) setPrio(b.dataset.p); });
  $('back').onclick = () => reset(false);
  $('save').onclick = async () => {
    const title = $('title').value.trim(); if (!title) { $('title').focus(); return; }
    const task = { id: 'q' + uid() + uid(), input: parsed ? parsed.input : $('text').value.trim(), title, cid: $('course').value || null, type: $('type').value, date: $('date').value || null, time: $('time').value || '23:59', hours: $('hours').value === '' ? null : +$('hours').value, notes: $('notes').value.trim(), prio };
    $('save').disabled = true;
    const res = await q.submit(task).catch(() => ({ ok: false }));
    $('save').disabled = false;
    if (!res || !res.ok) { $('err').hidden = false; $('err').textContent = (res && res.message) || 'Couldn’t save. Your task is still here; try again.'; fit(); return; }
    $('review').hidden = true; $('done').hidden = false; $('done').textContent = `✓ Added “${title}”${task.date ? '' : ' (no date yet)'}`; fit();
    $('text').value = '';
    setTimeout(() => { reset(true); q.hide(); }, 900);
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); if (!$('review').hidden) reset(false); else { $('text').value = ''; q.hide(); } }
    else if (e.key === 'Enter' && !$('review').hidden && (e.metaKey || e.ctrlKey || (e.target.matches('input') && !['date', 'time'].includes(e.target.type)))) { e.preventDefault(); $('save').click(); }
  });
  // Shown again: get fresh course names, keep whatever was typed so far.
  q.onShown(async () => { ctx = await q.getContext().catch(() => ctx) || ctx; if ($('review').hidden) $('text').focus(); else $('title').focus(); fit(); });
  q.getContext().then(c => { ctx = c || ctx; }).catch(() => {});
  fit();
})();
