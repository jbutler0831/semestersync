// Unit tests for combining two edited copies of a synced document. Run with: node test/merge.test.js
const assert = require('node:assert/strict');
const { merge } = require('../src/renderer/merge.js');

let n = 0, failed = 0;
function t(name, fn) { n++; try { fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`); } }
const item = (id, o = {}) => ({ id, cid: 'c1', title: 'Lab ' + id, date: '2026-10-01', time: '23:59', weight: 10, ...o });
const course = (items, o = {}) => ({ id: 'c1', code: 'BIO 150', title: 'Biology', credits: 3, items, ...o });
const clone = x => JSON.parse(JSON.stringify(x));
const base = course([item('a'), item('b'), item('c')]);

t('different deliverables changed on each side are combined', () => {
  const m = clone(base); m.items[0].score = 91;
  const th = clone(base); th.items[1].date = '2026-10-05';
  const r = merge('course', base, m, th);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.value.items[0].score, 91); assert.equal(r.value.items[1].date, '2026-10-05');
});
t('different fields of the same deliverable are combined', () => {
  const m = clone(base); m.items[0].score = 88;
  const th = clone(base); th.items[0].date = '2026-10-09';
  const r = merge('course', base, m, th);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.value.items[0].score, 88); assert.equal(r.value.items[0].date, '2026-10-09');
});
t('the same field changed differently is a conflict, keeping this side for now', () => {
  const m = clone(base); m.items[2].date = '2026-10-14';
  const th = clone(base); th.items[2].date = '2026-10-16';
  const r = merge('course', base, m, th);
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.conflicts[0], { id: 'c', what: 'Lab c', field: 'date', mine: '2026-10-14', theirs: '2026-10-16' });
  assert.equal(r.value.items[2].date, '2026-10-14');
});
t('the same change on both sides is not a conflict', () => {
  const m = clone(base); m.items[0].done = true;
  const r = merge('course', base, m, clone(m));
  assert.deepEqual(r.conflicts, []); assert.equal(r.value.items[0].done, true);
});
t('deliverables added on either side are kept', () => {
  const m = clone(base); m.items.push(item('m1'));
  const th = clone(base); th.items.push(item('t1'));
  const r = merge('course', base, m, th);
  assert.deepEqual(r.value.items.map(i => i.id), ['a', 'b', 'c', 'm1', 't1']);
});
t('a deliverable deleted on one side and untouched on the other is deleted', () => {
  const m = clone(base); m.items.splice(1, 1);
  const th = clone(base); th.items[0].score = 70;
  const r = merge('course', base, m, th);
  assert.deepEqual(r.conflicts, []); assert.deepEqual(r.value.items.map(i => i.id), ['a', 'c']); assert.equal(r.value.items[0].score, 70);
  const r2 = merge('course', base, th, m);
  assert.deepEqual(r2.value.items.map(i => i.id), ['a', 'c']);
});
t('deleted on one side but edited on the other is a conflict', () => {
  const m = clone(base); m.items.splice(1, 1);
  const th = clone(base); th.items[1].score = 99;
  const r = merge('course', base, m, th);
  assert.equal(r.conflicts.length, 1); assert.equal(r.conflicts[0].field, 'deleted');
});
t('course details merge field by field', () => {
  const m = clone(base); m.credits = 4;
  const th = clone(base); th.target = 'A-';
  const r = merge('course', base, m, th);
  assert.deepEqual(r.conflicts, []); assert.equal(r.value.credits, 4); assert.equal(r.value.target, 'A-');
  const m2 = clone(base); m2.title = 'Bio I';
  const th2 = clone(base); th2.title = 'Biology One';
  assert.equal(merge('course', base, m2, th2).conflicts[0].field, 'title');
});
t('with no common base, differing copies of the same deliverable conflict, extra ones are kept', () => {
  const m = course([item('a', { score: 1 }), item('x')]);
  const th = course([item('a', { score: 2 }), item('y')]);
  const r = merge('course', null, m, th);
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.value.items.map(i => i.id), ['a', 'x', 'y']);
});
t('a whole course deleted on one side and untouched on the other goes', () => {
  assert.equal(merge('course', base, null, clone(base)).value, null);
  assert.equal(merge('course', base, clone(base), null).value, null);
});
t('a whole course deleted on one side and edited on the other is a conflict', () => {
  const th = clone(base); th.items[0].score = 50;
  const r = merge('course', base, null, th);
  assert.equal(r.conflicts.length, 1); assert.equal(r.conflicts[0].field, 'document');
});
t('Inbox drafts merge like deliverables', () => {
  const b = course([], { inbox: true, drafts: [{ id: 'd1', title: 'Read' }] });
  const m = clone(b); m.drafts.push({ id: 'd2', title: 'Mine' });
  const th = clone(b); th.drafts[0].title = 'Read ch. 3';
  const r = merge('course', b, m, th);
  assert.deepEqual(r.conflicts, []); assert.deepEqual(r.value.drafts.map(d => d.title), ['Read ch. 3', 'Mine']);
});
t('study sets: cards merge, review history from both computers is kept', () => {
  const b = { id: 'd', name: 'Set', cards: [{ id: 'k1', q: 'Q1', a: 'A1' }, { id: 'k2', q: 'Q2', a: 'A2' }], log: [{ at: 1, k: 'c', r: 'k1', s: 1 }], quiz: [] };
  const m = clone(b); m.cards[0].a = 'A1 better'; m.log.push({ at: 5, k: 'c', r: 'k2', s: 0 });
  const th = clone(b); th.cards.push({ id: 'k3', q: 'Q3', a: 'A3' }); th.log.push({ at: 3, k: 'c', r: 'k1', s: 1 });
  const r = merge('deck', b, m, th);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.value.cards[0].a, 'A1 better'); assert.equal(r.value.cards.length, 3);
  assert.deepEqual(r.value.log.map(a => a.at), [1, 3, 5]);
  const m2 = clone(b); m2.cards[1].a = 'X'; const t2 = clone(b); t2.cards[1].a = 'Y';
  assert.equal(merge('deck', b, m2, t2).conflicts.length, 1);
});
t('settings never conflict: the newer setting wins, history is combined', () => {
  const b = { planner: { hours: [1, 1, 1, 1, 1, 1, 1], block: 1.5 }, remind: { on: true, at: [24] }, history: [{ id: 'h1', at: 1, h: 1 }], weak: { x: { at: 1 } } };
  const m = clone(b); m.planner.block = 2; m.history.push({ id: 'h2', at: 3, h: 1 }); m.remind.at = [48];
  const th = clone(b); th.remind.on = false; th.history.push({ id: 'h3', at: 2, h: 2 }); th.remind.at = [12]; th.weak.y = { at: 2 };
  const older = merge('extras', b, m, th, { preferTheirs: false });
  assert.deepEqual(older.conflicts, []);
  assert.equal(older.value.planner.block, 2); assert.equal(older.value.remind.on, false);
  assert.deepEqual(older.value.history.map(x => x.id), ['h1', 'h3', 'h2']);
  assert.deepEqual(older.value.remind.at, [48]); assert.ok(older.value.weak.x && older.value.weak.y);
  assert.deepEqual(merge('extras', b, m, th, { preferTheirs: true }).value.remind.at, [12]);
});
t('history removed on one side stays removed', () => {
  const b = { history: [{ id: 'h1', at: 1 }, { id: 'h2', at: 2 }] };
  const m = { history: [{ id: 'h2', at: 2 }] };
  const th = { history: [{ id: 'h1', at: 1 }, { id: 'h2', at: 2 }, { id: 'h3', at: 3 }] };
  assert.deepEqual(merge('extras', b, m, th).value.history.map(x => x.id), ['h2', 'h3']);
});
t('key order never counts as a change', () => {
  const m = { id: 'c1', code: 'X', items: [{ id: 'a', title: 't', date: 'd' }] };
  const th = { items: [{ date: 'd', title: 't', id: 'a' }], code: 'X', id: 'c1' };
  assert.deepEqual(merge('course', null, m, th).conflicts, []);
});

console.log(`\n${n - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
