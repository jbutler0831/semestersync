// Unit tests for the plain-English task reader. Run with: node test/taskparse.test.js
const assert = require('node:assert/strict');
const { parseTask } = require('../src/renderer/taskparse.js');

const COURSES = [
  { id: 'bio', code: 'BIO 150', title: 'Introduction to Biology' },
  { id: 'hist', code: 'HIST 210', title: 'Modern Europe' },
  { id: 'cs', code: 'CS 220', title: 'Data Structures' },
  { id: 'psyc', code: 'PSYC 214', title: 'Cognitive Psychology' },
];
const WED = new Date(2026, 9, 21, 10, 0); // Wednesday, Oct 21 2026, 10:00 local
const MON = new Date(2026, 9, 19, 10, 0);
const FRI = new Date(2026, 9, 23, 10, 0);
const P = (text, now = WED, courses = COURSES) => parseTask(text, { now, courses, dateOrder: 'MD' });
let n = 0, failed = 0;
function t(name, fn) { n++; try { fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`); } }

t('“Biology paper due Friday, 5 pages”', () => {
  const r = P('Biology paper due Friday, 5 pages');
  assert.equal(r.title, 'Biology paper'); assert.equal(r.cid, 'bio'); assert.equal(r.date, '2026-10-23');
  assert.equal(r.type, 'Paper'); assert.equal(r.notes, '5 pages'); assert.equal(r.hours, 5); assert.equal(r.hoursFrom, 'pages');
});
t('“Study calculus for 45 minutes tomorrow” (no calculus course)', () => {
  const r = P('Study calculus for 45 minutes tomorrow');
  assert.equal(r.title, 'Study calculus'); assert.equal(r.cid, null); assert.match(r.courseNote, /calculus/);
  assert.equal(r.date, '2026-10-22'); assert.equal(r.hours, 0.75); assert.equal(r.hoursFrom, 'input'); assert.equal(r.type, 'Study');
});
t('“Study calculus …” matches a MATH course when there is one', () => {
  const r = P('Study calculus for 45 minutes tomorrow', WED, [...COURSES, { id: 'm', code: 'MATH 151', title: 'Calculus I' }]);
  assert.equal(r.cid, 'm');
});
t('“History reading, next Tuesday” from a Wednesday is next week’s Tuesday', () => {
  const r = P('History reading, next Tuesday');
  assert.equal(r.title, 'History reading'); assert.equal(r.cid, 'hist'); assert.equal(r.date, '2026-10-27'); assert.equal(r.type, 'Reading');
});
t('“next Tuesday” said on a Monday is ambiguous', () => {
  const r = P('History reading next Tuesday', MON);
  assert.equal(r.date, null); assert.deepEqual(r.dateChoices.map(c => c.date), ['2026-10-20', '2026-10-27']);
});
t('a bare weekday said on that weekday is ambiguous', () => {
  const r = P('Lab report Friday', FRI);
  assert.equal(r.date, null); assert.deepEqual(r.dateChoices.map(c => c.date), ['2026-10-23', '2026-10-30']);
});
t('“this Friday” on a Friday means today', () => assert.equal(P('quiz this Friday', FRI).date, '2026-10-23'));
t('today, tonight, tomorrow, day after tomorrow', () => {
  assert.equal(P('Homework today').date, '2026-10-21');
  const night = P('Discussion post tonight'); assert.equal(night.date, '2026-10-21'); assert.equal(night.time, '23:59');
  assert.equal(P('Homework tomorrow').date, '2026-10-22');
  assert.equal(P('Homework the day after tomorrow').date, '2026-10-23');
});
t('“in 3 days” and “in two weeks”', () => {
  assert.equal(P('Lab report in 3 days').date, '2026-10-24');
  assert.equal(P('Project in two weeks').date, '2026-11-04');
});
t('“next week” asks which day', () => {
  const r = P('CS quiz next week');
  assert.equal(r.date, null); assert.deepEqual(r.dateChoices.map(c => c.date), ['2026-10-26', '2026-10-30']); assert.equal(r.cid, 'cs'); assert.equal(r.type, 'Quiz');
});
t('month names, numeric dates and times', () => {
  const a = P('Essay due Oct 30 at 5pm'); assert.equal(a.date, '2026-10-30'); assert.equal(a.time, '17:00'); assert.equal(a.title, 'Essay');
  const b = P('Problem set 10/30 by 11:59 pm'); assert.equal(b.date, '2026-10-30'); assert.equal(b.time, '23:59');
  assert.equal(parseTask('Essay 3/11', { now: WED, dateOrder: 'DM' }).date, '2026-11-03');
  assert.equal(P('Midterm December 3rd at noon').time, '12:00');
});
t('a date a few days past is a question, not a guess', () => {
  const r = P('Quiz Oct 1');
  assert.equal(r.date, null); assert.deepEqual(r.dateChoices.map(c => c.date), ['2026-10-01', '2027-10-01']);
});
t('a date long past rolls to next year', () => assert.equal(P('Final paper March 2').date, '2027-03-02'));
t('no date: left empty and flagged', () => {
  const r = P('Read chapter 4');
  assert.equal(r.date, null); assert.equal(r.dateChoices.length, 0); assert.equal(r.type, 'Reading'); assert.equal(r.title, 'Read chapter 4');
  assert.ok(r.issues.some(i => /No due date/.test(i)));
});
t('“due” with no readable date says so', () => assert.ok(P('Paper due soonish').issues.some(i => /no date I could read/.test(i))));
t('two matching courses are offered, not chosen', () => {
  const r = P('math homework tomorrow', WED, [{ id: 'a', code: 'MATH 151', title: 'Calculus I' }, { id: 'b', code: 'MATH 220', title: 'Linear Algebra' }]);
  assert.equal(r.cid, null); assert.deepEqual(r.courseChoices, ['a', 'b']);
});
t('a course named by code, with or without a space', () => {
  assert.equal(P('psyc 214 response friday').cid, 'psyc');
  assert.equal(P('cs220 project friday').cid, 'cs');
});
t('an unknown subject never invents a course', () => {
  const r = P('Astronomy homework Friday');
  assert.equal(r.cid, null); assert.equal(r.courseChoices.length, 0); assert.equal(r.title, 'Astronomy homework');
});
t('effort: hours, minutes, “an hour”, “1h30”', () => {
  assert.equal(P('review notes for 2 hours').hours, 2);
  assert.equal(P('review notes for an hour').hours, 1);
  assert.equal(P('review notes 1h30m').hours, 1.5);
  assert.equal(P('flashcards for half an hour').hours, 0.5);
});
t('priority words', () => {
  assert.equal(P('Urgent: lab report friday').prio, 'high');
  assert.equal(P('lab report friday!').prio, 'high');
  assert.equal(P('organize notes someday').prio, 'low');
});
t('words count gives an estimate and a note', () => {
  const r = P('Policy memo 1,500 words due Nov 19'); assert.equal(r.notes, '1,500 words'); assert.equal(r.hours, 4); assert.equal(r.date, '2026-11-19');
});
t('empty and nonsense input never throws', () => {
  for (const s of ['', '   ', '!!!', 'due', '13/45', 'Feb 30']) { const r = P(s); assert.ok(Array.isArray(r.issues)); }
  assert.ok(P('Essay Feb 30').issues.some(i => /doesn’t exist/.test(i)));
});
t('original text is kept', () => assert.equal(P('  Biology paper   due Friday ').input, 'Biology paper due Friday'));
console.log(`\n${n - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
