(() => {
const SAMPLES = [
`PSYC 214: Cognitive Psychology, Fall 2026
Instructor: Dr. M. Okafor · Tue/Thu 10:30–11:45 AM · Hallam Hall 204
Office hours: Wed 2:00–4:00 PM, Hallam 311
Term: August 24 – December 11, 2026

COURSE DESCRIPTION
How people perceive, attend, remember, and decide. Weekly lab
sessions replicate classic experiments using the PsychoPy toolkit.

GRADING
Reading responses (10 × 2%) .................. 20%
Lab reports (3) .............................. 24%
Midterm exam ................................. 20%
Research proposal ............................ 16%
Final exam ................................... 20%

SCHEDULE OF DELIVERABLES
Sep 4  Reading Response 1 due (Ch. 1–2)
Sep 11  Reading Response 2 due (Ch. 3)
Sep 18  Lab Report 1: Stroop interference, due by 11:59 PM
Sep 25  Reading Response 3 due (Ch. 4)
Oct 2  Reading Response 4 due (Ch. 5)
Oct 6  Research proposal topic approval (ungraded)
Oct 9  Reading Response 5 due (Ch. 6)
Oct 15  Midterm Exam, in class 10:30 AM (Ch. 1–7)
Oct 23  Lab Report 2: Serial position effect, due 5:00 PM
Oct 30  Reading Response 6 due (Ch. 8)
Nov 6  Reading Response 7 due (Ch. 9)
Nov 10  Research proposal draft for peer review
Nov 13  Reading Response 8 due (Ch. 10)
11/17  Peer feedback comments due on Canvas
Nov 20  Lab Report 3: Change blindness replication
Nov 24  Research Proposal final due
Dec 1  Reading Response 9 due (Ch. 11)
Dec 4  Reading Response 10 due (Ch. 12)
Dec 10  Final Exam, cumulative, 8:00 AM, Hallam 101

No class: Sep 7 (Labor Day), Nov 25–27 (Thanksgiving break)`,
`CS 220: Data Structures, Fall 2026
Instructor: Prof. R. Lindqvist · Mon/Wed/Fri 1:00–1:50 PM · Engineering 140
Term: August 24 – December 11, 2026

GRADING
Problem sets (6) ............................. 30%
Quizzes (4 × 2.5%) ........................... 10%
Programming projects (2) ..................... 25%
Midterm exam ................................. 15%
Final exam ................................... 20%

DUE DATES
Sep 9  Problem Set 1: Asymptotic analysis
Sep 16  Quiz 1 (arrays and linked lists), in class
Sep 23  Problem Set 2: Stacks and queues
Oct 7  Problem Set 3: Hashing
Oct 12  Project 1: LRU cache, due 11:59 PM
Oct 14  Quiz 2 (trees), in class
Oct 16  Midterm Exam, 1:00 PM
Oct 28  Problem Set 4: Heaps and priority queues
Nov 4  Quiz 3 (graphs), in class
Nov 11  Problem Set 5: Shortest paths
Nov 18  Quiz 4 (dynamic programming), in class
Nov 23  Problem Set 6: Dynamic programming
Dec 7  Project 2: Route planner, due 11:59 PM
Dec 14  Final Exam, 1:00 PM, Engineering 140

No class: Sep 7 (Labor Day), Nov 25–27 (Thanksgiving break)`,
`ECON 201: Intermediate Microeconomics, Fall 2026
Instructor: Dr. A. Basu · Tue/Thu 2:00–3:15 PM · Whitman 12
Term: August 24 – December 11, 2026

GRADING
Homework (5) ................................. 25%
Policy memo .................................. 15%
Midterm exam ................................. 25%
Final exam ................................... 35%

KEY DATES
Sep 15  Homework 1 due: consumer choice
Sep 29  Homework 2 due: production and cost
Oct 13  Midterm Exam, 2:00 PM
Oct 27  Homework 3 due: market structure
Nov 10  Homework 4 due: game theory
Nov 19  Policy memo due: carbon pricing (1,500 words)
Dec 3  Homework 5 due: general equilibrium
Dec 9  Final Exam, 3:30 PM, Whitman 12`,
];

const TYPES = [
  { key: 'Exam',     re: /\b(midterm|final exam|exam|test)\b/i,                       base: 8,   lead: 6 },
  { key: 'Quiz',     re: /\bquiz(zes)?\b/i,                                           base: 2,   lead: 2 },
  { key: 'Lab',      re: /\blab\b/i,                                                  base: 5,   lead: 5 },
  { key: 'Project',  re: /\b(project|proposal|presentation|portfolio|capstone)\b/i,   base: 5,   lead: 8 },
  { key: 'Paper',    re: /\b(essay|paper|report|thesis|memo)\b/i,                     base: 6,   lead: 6 },
  { key: 'Reading',  re: /\b(reading|response|chapter)\b/i,                           base: 1.5, lead: 2 },
  { key: 'Homework', re: /\b(homework|hw|problem set|pset|assignment|exercise|discussion|visit|scribe)\b/i,   base: 3,   lead: 3 },
];
const TYPE_KEYS = TYPES.map(t => t.key).concat('Other');
const MONTH = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
const MONTH_SRC = '\\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b';
const NUM_SRC = '\\b(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?\\b';
const TIME_SRC = '\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b';
const SKIP_RE = /\b(no class|holiday|break|office hours|instructor|term:|recess|semester:)\b/i;
const SERIES = ['--s1','--s2','--s3','--s4','--s5','--s6','--s7','--s8'];
const MAX_COURSES = 8;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, reduce ? 0 : ms));
const DAY = 86400000;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const TODAY = startOfDay(new Date());
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fromIso = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtDay = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtDow = d => d.toLocaleDateString('en-US', { weekday: 'short' });
const fmtTime = t => { const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; return `${((h + 11) % 12) + 1}:${String(m).padStart(2,'0')} ${ap}`; };
const round5 = n => Math.round(n * 2) / 2;
const fmtH = n => (Math.round(n * 10) / 10).toString();
const uid = () => Math.random().toString(36).slice(2, 8);

const state = {
  courses: [], view: 'all', editId: null, gradeId: null,
  sortKey: 'date', sortDir: 1, filter: 'All',
  synced: null, lastSync: null, connected: false, freshIds: new Set(),
  parser: 'local', aiReady: false, dirty: false,
};

/* ---------- Courses ---------- */
const courseById = id => state.courses.find(c => c.id === id);
const editCourse = () => courseById(state.editId) || state.courses[0] || null;
const colorOf = c => `var(${SERIES[c.color % 8]})`;
const allItems = () => state.courses.flatMap(c => c.items);
const visibleCourses = () => state.view === 'all' ? state.courses : state.courses.filter(c => c.id === state.view);
const visibleItems = () => visibleCourses().flatMap(c => c.items);
const itemCourse = it => courseById(it.cid);
function nextColor() {
  const used = new Set(state.courses.map(c => c.color));
  for (let i = 0; i < 8; i++) if (!used.has(i)) return i;
  return state.courses.length % 8;
}
function newCourse(text) {
  return { id: 'c' + uid(), code: 'New course', title: '', text: text || '', categories: [], items: [], color: nextColor(), parser: 'local', order: Date.now() + state.courses.length };
}
function courseCode(line) {
  const m = line.match(/^\s*([A-Z]{2,5}[\s-]?\d{2,4}[A-Z]?)\b/);
  if (m) return m[1].replace('-', ' ');
  return line.split(/[,:—–]/)[0].trim().slice(0, 18) || 'Course';
}

/* ---------- Local parser ---------- */
function detectYear(text) { const m = text.match(/\b(20\d\d)\b/); return m ? +m[1] : TODAY.getFullYear(); }
function findDate(line, year) {
  let m = line.match(new RegExp(MONTH_SRC, 'i'));
  if (m) return { date: new Date(year, MONTH[m[1].slice(0,3).toLowerCase()], +m[2]), span: m[0], named: true };
  m = line.match(new RegExp(NUM_SRC));
  if (m && +m[1] <= 12 && +m[2] <= 31) {
    let y = m[3] ? +m[3] : year; if (y < 100) y += 2000;
    return { date: new Date(y, +m[1] - 1, +m[2]), span: m[0], named: false };
  }
  return null;
}
function findTime(line) {
  const m = line.match(new RegExp(TIME_SRC, 'i'));
  if (!m) return null;
  let h = +m[1] % 12; if (m[3].toLowerCase() === 'pm') h += 12;
  return `${String(h).padStart(2,'0')}:${m[2] || '00'}`;
}
function classify(line) {
  for (const t of TYPES) { const m = line.match(t.re); if (m) return { type: t.key, word: m[0] }; }
  return null;
}
const stem = w => w.toLowerCase().replace(/[^a-z]/g,'').replace(/zzes$/, 'z').replace(/ies$/, 'y').replace(/(ses|s)$/, m => m === 'ses' ? 's' : '');
const STOP = new Set(['and','the','for','due','each','total','grade','final']);

function parseCategories(text) {
  const cats = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const pm = line.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*$/) || line.match(/[.\s:–-]{2,}(\d{1,3}(?:\.\d+)?)\s*%/);
    if (!pm || findDate(line, 2000)) continue;
    let label = line.slice(0, line.indexOf(pm[0])).replace(/[.\s:–-]+$/,'');
    let count = null, per = null;
    const cm = label.match(/\((\d+)\s*(?:[×x]\s*(\d+(?:\.\d+)?)\s*%)?\)/);
    if (cm) { count = +cm[1]; if (cm[2]) per = +cm[2]; label = label.replace(cm[0], '').trim(); }
    label = label.replace(/\b\d+\s*(?:total\s+)?(?:points?|pts)\b(?:\s+each)?/ig, '').replace(/\s{2,}/g, ' ').trim();
    if (!label) continue;
    const words = label.split(/\s+/).map(stem).filter(w => w.length > 2 && !STOP.has(w));
    if (/\bfinal\b/i.test(label)) words.push('final');
    cats.push({ label, pct: +pm[1], count, per, words, type: (classify(label) || {}).type || 'Other' });
  }
  return cats;
}
function mapToCategories(items, categories) {
  for (const it of items) {
    if (it.ungraded) { it.cat = null; continue; }
    const words = it.title.split(/\s+/).map(stem);
    let best = null, bestScore = 0;
    categories.forEach((c, ci) => {
      const cw = c.words || c.label.split(/\s+/).map(stem).filter(w => w.length > 2 && !STOP.has(w));
      let s = cw.filter(w => words.includes(w)).length;
      if (c.type === it.type) s += 0.75;
      if (s > bestScore) { bestScore = s; best = ci; }
    });
    it.cat = bestScore >= 0.75 ? best : null;
  }
}
function finishItems(items, categories, setWeights) {
  categories.forEach((c, ci) => {
    let members = items.filter(it => it.cat === ci);
    if (c.count && members.length > c.count) {
      const numbered = members.filter(it => /\d/.test(it.title));
      if (numbered.length === c.count) { members.filter(it => !numbered.includes(it)).forEach(it => { it.cat = null; it.weight = 0; }); members = numbered; }
    }
    c.found = members.length;
    if (setWeights) {
      const per = c.per != null ? c.per : (members.length ? c.pct / (c.count || members.length) : 0);
      members.forEach(it => { it.weight = Math.round(per * 100) / 100; });
    }
  });
  for (const it of items) {
    const t = TYPES.find(t => t.key === it.type) || { base: 3 };
    it.hours = it.ungraded ? round5(Math.max(1, t.base * 0.3)) : round5(t.base + it.weight * 0.3);
  }
}
const CODE_RE = /\b([A-Z]{2,5})[\s-]?(\d{3,4}[A-Z]?)(?:[-.]\d{2,3})?\b/;
function detectCourse(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const generic = t => /^((course|class)\s+)?((schedule|syllabus|calendar|outline)\s*)+$/i.test(t);
  let code = '', title = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CODE_RE);
    if (!m) continue;
    let rest = lines[i].replace(m[0], ' ').replace(/,?\s*(fall|spring|summer|winter)\b.*$/i, '').replace(/^[\s:–—|-]+|[\s:–—,|-]+$/g, '').replace(/\s{2,}/g, ' ');
    if (rest && rest.split(' ').length < 3 && i > 0 && !CODE_RE.test(lines[i - 1]) && !generic(lines[i - 1]) && lines[i - 1].length < 80) rest = `${lines[i - 1]} ${rest}`;
    if (generic(rest)) rest = '';
    if (/^course\s+(schedule|syllabus|calendar)\b/i.test(rest)) rest = rest.replace(/^course\s+(schedule|syllabus|calendar)\b[\s:–—-]*/i, '');
    if (generic(rest)) rest = '';
    if (!code) code = `${m[1]} ${m[2]}`;
    if (!title && rest && `${m[1]} ${m[2]}` === code) title = rest.slice(0, 80);
    if (code && title) break;
  }
  return { code, title };
}
const ROW_RE = /^(.{0,40}?)\((\d{1,2})\/(\d{1,2})\s*[–-]\s*(\d{1,2})\/(\d{1,2})\)\s*\|(.*)$/;
const DELIV_RE = /(?:\b[A-Z][A-Za-z'-]*\s+){0,3}\b(?:Quiz|Exam|Test|Midterm|Visit|Discussion|Assignment|Project|Paper|Essay|Report|Lab|Homework|Problem Set|Presentation|Scribe|Notebook|Reflection|Case Study)\b(?:\s+\d{1,2}\b)?/g;
function dueRule(text) {
  const m = text.match(/\bdue\s+(?:by|on|before)[\s·]+(?:each\s+|every\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b(?:\s*(?:at|by)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/i);
  if (!m) return null;
  let time = '23:59';
  if (m[2]) { const t = m[2].match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i); let h = +t[1]; if (t[3]) h = h % 12 + (/pm/i.test(t[3]) ? 12 : 0); time = `${String(Math.min(h, 23)).padStart(2, '0')}:${t[2] || '00'}`; }
  return { weekday: m[1], time };
}
// One row of a week-by-week schedule table: every deliverable in it is due at the end of the week's range.
function rowDeliverables(line, year, rule) {
  const m = line.match(ROW_RE);
  if (!m) return null;
  const [, label, m1, d1, m2, d2, rest] = m;
  const end = new Date(+m2 < +m1 ? year + 1 : year, +m2 - 1, +d2);
  const found = [];
  for (const seg of rest.split(/\s[|·]\s/)) {
    for (const hit of seg.matchAll(DELIV_RE)) {
      const before = seg.slice(0, hit.index).split(/[.!?;]/).pop() + hit[0]; // same sentence as the match
      if (/\b(no|not|without)\b/i.test(before)) continue; // "No Clinical Patient Visit or Quiz This Week!"
      const title = hit[0].trim().replace(/^(Complete|Submit|Due|Take)\s+/i, '');
      const key = title.toLowerCase();
      if (found.some(f => f.key.includes(key) || key.includes(f.key))) continue;
      found.push({ key, title, notes: `${label.trim()} · ${m1}/${d1}–${m2}/${d2}`, time: findTime(seg) });
    }
  }
  return { end, found, time: rule ? rule.time : '23:59' };
}
function parseLocal(text, cid) {
  const year = detectYear(text);
  const rule = dueRule(text);
  const lines = text.split('\n');
  const first = (lines.find(l => l.trim()) || 'Untitled course').trim();
  const categories = parseCategories(text);
  const items = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || SKIP_RE.test(line)) return;
    const row = rowDeliverables(line, year, rule);
    if (row) {
      row.found.forEach((f, k) => {
        const cls = classify(f.title);
        items.push({ id: `${cid}-${i}-${k}`, cid, line: i, title: f.title, notes: f.notes, type: cls ? cls.type : 'Other',
          date: iso(row.end), time: f.time || row.time, weight: 0, hours: 0, conf: 0, sync: true, ungraded: false,
          _conf: 46 + 14 + (cls ? 15 : 0) + (rule ? 5 : 0) + (i * 7 + k) % 4 - 1 });
      });
      return;
    }
    const d = findDate(line, year);
    if (!d) return;
    const cls = classify(line);
    const hasDue = /\bdue\b/i.test(line);
    if (!cls && !hasDue) return;
    const time = findTime(line);
    let title = line.replace(d.span, '').replace(/^[\s—–:\-·|,]+/, '');
    let notes = '';
    const dm = title.match(/\s*\b(?:is\s+)?due\b[:\s]*(.*)$/i);
    if (dm) { title = title.slice(0, dm.index); notes = dm[1]; }
    const cut = title.search(/[,(]/);
    if (cut > 3) { notes = [title.slice(cut).replace(/^[,\s]+/, ''), notes].filter(Boolean).join(' · '); title = title.slice(0, cut); }
    title = title.replace(/[\s—–:\-·,]+$/, '').trim() || line;
    const ungraded = /\bungraded|not graded|no credit\b/i.test(line);
    const it = { id: cid + '-' + i, cid, line: i, title, notes: notes.replace(/^[,\s]+/, ''), type: cls ? cls.type : 'Other',
      date: iso(d.date), time: time || (rule ? rule.time : '23:59'), weight: 0, hours: 0, conf: 0, sync: true, ungraded };
    let conf = 46 + (d.named ? 22 : 14) + (cls ? 15 : 0) + (hasDue || time ? 5 : 0);
    if (title.length < 5) conf -= 18;
    it._conf = conf + (i * 7) % 4 - 1;
    items.push(it);
  });
  mapToCategories(items, categories);
  finishItems(items, categories, true);
  items.forEach(it => { it.conf = Math.max(30, Math.min(99, it._conf + (it.cat != null || it.ungraded ? 11 : 0))); delete it._conf; });
  const found = detectCourse(text);
  return { code: found.code || courseCode(first), title: found.title || first.replace(/^[^:]*:\s*/, '').replace(/,\s*(fall|spring|summer|winter)\s+\d{4}$/i, '').replace(/^((course|class)\s+)?(schedule|syllabus|calendar|outline)$/i, ''), categories, items };
}

/* ---------- Claude parser ---------- */
let sampleFn = null, aiCtl = null;
function aiPrompt(text) {
  const numbered = text.split('\n').map((l, i) => `${i + 1}| ${l}`).join('\n');
  return `You extract structured data from a college course syllabus for a student's planner. Today is ${iso(TODAY)}.

Reply with ONLY a JSON object, no prose, in exactly this shape:
{"code":"short course code, e.g. PSYC 214","title":"course title without code or term",
 "categories":[{"label":"grading category as written","pct":number,"count":number or null}],
 "items":[{"title":"short name, under 60 chars","type":"Exam|Quiz|Lab|Project|Paper|Reading|Homework|Other",
   "date":"YYYY-MM-DD","time":"HH:MM 24h","category":"exact label from categories, or null",
   "weight":number,"ungraded":boolean,"notes":"extra detail or empty string","line":number,"confidence":number}]}

Rules:
- Include every dated deliverable: exams, quizzes, labs, projects, papers, homework, readings or responses with due dates, drafts and peer reviews.
- Skip holidays, no-class days, office hours and class meeting times.
- Schedules are often week-by-week tables. A row like "Week 4 (9/6–9/13) | … | Graded Quiz 1" means that deliverable is due at the end of the week's range unless a specific day is given. Apply general rules such as "All assignments are due by Sunday at 23:59 each week".
- One row can hold several deliverables: list each. Skip any the row says aren't happening ("No quiz this week").
- Ignore browser print headers and footers (timestamps, URLs, page numbers).
- Infer the year from the term. "time" is the stated due or start time; use "23:59" when none is given.
- "weight" is this single item's percent of the final grade. Split a category's weight evenly across its items unless the syllabus says otherwise. Ungraded items get 0.
- "line" is the 1-based line number shown before the | where the item appears.
- "confidence" (0-100) is how sure you are the date, type and weight are right. Go below 80 when you had to guess.

Syllabus:
${numbered}`;
}
async function parseWithClaude(text, cid, onProgress) {
  aiCtl = new AbortController();
  const raw = await sampleFn.json(aiPrompt(text), {
    signal: aiCtl.signal, modelTier: 'default',
    onText: ({ text: t }) => onProgress(t.length),
  });
  if (!raw || !Array.isArray(raw.items)) throw { code: 'invalid_json', message: 'No items in the reply' };
  const nLines = text.split('\n').length;
  const categories = (Array.isArray(raw.categories) ? raw.categories : []).filter(c => c && c.label && isFinite(+c.pct)).map(c => ({
    label: String(c.label).slice(0, 80), pct: +c.pct, count: Number.isInteger(c.count) ? c.count : null, per: null,
    type: (classify(String(c.label)) || {}).type || 'Other',
  }));
  const catIdx = new Map(categories.map((c, i) => [c.label.toLowerCase(), i]));
  const items = raw.items.filter(x => x && x.title && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && !isNaN(fromIso(x.date))).map((x, n) => {
    const line = Number.isInteger(x.line) && x.line >= 1 && x.line <= nLines ? x.line - 1 : -1;
    return {
      id: `${cid}-ai${n}`, cid, line, title: String(x.title).slice(0, 90), notes: String(x.notes || '').slice(0, 160),
      type: TYPE_KEYS.includes(x.type) ? x.type : 'Other', date: x.date,
      time: /^\d{2}:\d{2}$/.test(x.time) ? x.time : '23:59',
      weight: Math.max(0, Math.min(100, +x.weight || 0)), ungraded: !!x.ungraded,
      cat: x.category != null && catIdx.has(String(x.category).toLowerCase()) ? catIdx.get(String(x.category).toLowerCase()) : undefined,
      conf: Math.max(1, Math.min(99, Math.round(+x.confidence || 70))), sync: true, hours: 0,
    };
  });
  const unmapped = items.filter(i => i.cat === undefined);
  if (unmapped.length) mapToCategories(unmapped, categories);
  finishItems(items, categories, false);
  return { code: String(raw.code || courseCode(text.split('\n')[0] || '')).slice(0, 18), title: String(raw.title || '').slice(0, 80), categories, items };
}
function aiErrorCopy(e) {
  switch (e && e.code) {
    case 'not_granted': return 'Claude access was declined for this page. Using local rules instead.';
    case 'rate_limited': return 'Too many requests right now. Used local rules; try Claude again in a minute.';
    case 'prompt_too_large': return 'This syllabus is too long to send. Used local rules instead.';
    case 'invalid_json': return 'Claude\'s reply wasn\'t usable. Used local rules instead.';
    case 'cancelled': return 'Stopped. Kept the previous result.';
    default: return 'Claude couldn\'t finish the extraction. Used local rules instead.';
  }
}

/* ---------- Annotated source ---------- */
const ANNOT_RE = (() => {
  const nc = s => s.replace(/\((?!\?)/g, '(?:');
  const types = TYPES.map(t => t.re.source.replace(/^\\b|\\b$/g, '')).join('|');
  return new RegExp(`(${nc(MONTH_SRC)})|(${nc(NUM_SRC)})|(${nc(TIME_SRC)})|(\\d{1,3}(?:\\.\\d+)?\\s*%)|\\b(${nc(types)})\\b`, 'gi');
})();
function annotateLine(line) {
  let out = '', last = 0, m;
  ANNOT_RE.lastIndex = 0;
  while ((m = ANNOT_RE.exec(line))) {
    if (!m[0]) { ANNOT_RE.lastIndex++; continue; }
    out += esc(line.slice(last, m.index));
    const cls = m[1] || m[2] ? 'm-date' : m[3] ? 'm-time' : m[4] ? 'm-pct' : 'm-type';
    out += `<span class="m ${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(line.slice(last));
}
function renderAnnotated(pending) {
  const c = editCourse(), el = $('annotated');
  if (!c || !c.text.trim()) { el.innerHTML = `<div class="empty-source">No syllabus text yet. Choose <b>Edit text</b> and paste it, or upload a .txt file.</div>`; return; }
  const hits = new Map(c.items.filter(it => it.line >= 0).map(it => [it.line, it]));
  const catLines = new Set();
  c.text.split('\n').forEach((l, i) => { if (/%/.test(l) && c.categories.some(k => l.toLowerCase().includes(k.label.toLowerCase()))) catLines.add(i); });
  el.innerHTML = c.text.split('\n').map((l, i) => {
    const hit = hits.get(i);
    const tag = hit ? `→ ${hit.type.toLowerCase()}` : catLines.has(i) ? '→ weight' : '';
    return `<div class="ln${pending ? ' pending' : ''}${tag ? ' hit-able' : ''}${!pending && tag ? ' hit' : ''}"><span class="no">${i + 1}</span><span>${annotateLine(l) || ' '}</span><span class="tag">${tag}</span></div>`;
  }).join('');
  el.classList.add('on');
}

/* ---------- Pipeline ---------- */
const STEPS_LOCAL = [
  ['Segment document', 'Split into lines and sections'],
  ['Detect dates & times', 'Month names, numeric dates, clock times'],
  ['Classify deliverables', 'Exam, lab, project, reading, homework…'],
  ['Extract grading scheme', 'Category weights and item counts'],
  ['Estimate effort', 'Hours per item from type and weight'],
];
const STEPS_AI = [
  ['Send to Claude', 'Numbered syllabus text and output schema'],
  ['Read & extract', 'Claude reads the whole document'],
  ['Validate reply', 'Check dates, types and weights'],
  ['Map grading scheme', 'Link items to grade categories'],
  ['Estimate effort', 'Hours per item from type and weight'],
];
function renderSteps(steps, st, times) {
  $('steps').innerHTML = steps.map(([t, s], i) =>
    `<li class="step ${st[i]}"><span class="dot"><svg viewBox="0 0 10 10" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.2l2 2 4-4.4"/></svg></span><span class="lbl">${t}<small>${s}</small></span><span class="ms">${times[i] || ''}</span></li>`).join('');
}
function logLine(html, cls) {
  const d = document.createElement('div'); if (cls) d.className = cls; d.innerHTML = html;
  $('log').appendChild(d); $('log').scrollTop = $('log').scrollHeight;
  return d;
}
function summaryLog(c) {
  const lines = c.text.split('\n');
  const sum = c.categories.reduce((a, k) => a + k.pct, 0);
  const low = c.items.filter(i => i.conf < 80).length;
  return [
    [`Read <b>${lines.length}</b> lines · ${c.text.length.toLocaleString()} chars`],
    [`Found <b>${c.items.length}</b> dated deliverables, <b>${c.items.filter(i => i.time !== '23:59').length}</b> with explicit times`],
    [`Classified across <b>${new Set(c.items.map(i => i.type)).size}</b> types`],
    c.categories.length ? [`Matched <b>${c.categories.length}</b> grading categories totaling <b>${sum}%</b>`, sum === 100 ? null : 'wn'] : ['No grading table in this file. Upload the syllabus to add grade weights.', 'wn'],
    [`Estimated <b>${fmtH(c.items.reduce((a, i) => a + i.hours, 0))} h</b> of work for ${esc(c.code)}`],
    low ? [`${low} item${low > 1 ? 's' : ''} below 80% confidence. Check them in the table.`, 'wn'] : ['All items above 80% confidence', 'ok'],
  ];
}
function applyResult(c, r, parser) {
  const prev = new Set(c.items.map(i => i.id + i.date + i.title));
  Object.assign(c, { code: r.code, title: r.title, categories: r.categories, items: r.items, parser });
  state.freshIds = new Set(c.items.filter(i => !prev.has(i.id + i.date + i.title)).map(i => i.id));
}
let running = false;
async function runParse(animate) {
  const c = editCourse();
  if (running || !c) return;
  running = true; $('parseBtn').disabled = true;
  $('log').innerHTML = '';
  const useAi = animate && state.parser === 'ai' && sampleFn;
  if (!animate) {
    applyResult(c, parseLocal(c.text, c.id), 'local');
    renderSteps(STEPS_LOCAL, STEPS_LOCAL.map(() => 'done'), ['4 ms','9 ms','12 ms','6 ms','3 ms']);
    summaryLog(c).forEach(([h, k]) => logLine(h, k));
    renderAnnotated(false); renderAll();
    running = false; $('parseBtn').disabled = false;
    return;
  }
  setView('ann');
  const steps = useAi ? STEPS_AI : STEPS_LOCAL;
  const st = steps.map(() => 'wait'), times = [];
  renderSteps(steps, st, times);
  let parser = 'local', result;
  if (useAi) {
    renderAnnotated(true);
    st[0] = 'run'; renderSteps(steps, st, times);
    const t0 = performance.now();
    logLine(`Sending ${c.text.split('\n').length} lines to Claude…`, 'ai');
    const prog = logLine('Waiting for Claude (the first reply can take up to a minute)…');
    $('stopBtn').hidden = false;
    let started = false;
    try {
      result = await parseWithClaude(c.text, c.id, n => {
        if (!started) { started = true; times[0] = Math.round(performance.now() - t0) + ' ms'; st[0] = 'done'; st[1] = 'run'; renderSteps(steps, st, times); }
        prog.innerHTML = `Receiving structured output… <b>${n.toLocaleString()}</b> chars`;
      });
      parser = 'ai';
      times[1] = ((performance.now() - t0) / 1000).toFixed(1) + ' s';
      st[0] = st[1] = 'done'; renderSteps(steps, st, times);
      logLine(`Claude returned <b>${result.items.length}</b> deliverables`, 'ok');
    } catch (e) {
      $('stopBtn').hidden = true;
      st[0] = st[1] = 'done'; times[1] = 'fallback';
      logLine(aiErrorCopy(e), 'wn');
      if (e && e.code === 'not_granted') { sampleFn = null; setParser('local'); $('useAi').disabled = true; }
      if (e && e.code === 'cancelled') { renderSteps(steps, steps.map(() => 'wait'), []); renderAnnotated(false); running = false; $('parseBtn').disabled = false; return; }
      result = parseLocal(c.text, c.id);
    }
    $('stopBtn').hidden = true;
    applyResult(c, result, parser);
    renderAnnotated(true);
    const lineEls = [...document.querySelectorAll('#annotated .ln')];
    for (let s = 2; s < steps.length; s++) {
      st[s] = 'run'; renderSteps(steps, st, times);
      const t1 = performance.now();
      if (s === 2) for (const el of lineEls) el.classList.remove('pending');
      if (s === 3) for (const el of lineEls.filter(e => e.classList.contains('hit-able'))) { el.classList.add('hit'); el.scrollIntoView({ block: 'nearest' }); await wait(30); }
      else await wait(260);
      times[s] = Math.round(performance.now() - t1) + ' ms'; st[s] = 'done'; renderSteps(steps, st, times);
    }
  } else {
    applyResult(c, parseLocal(c.text, c.id), 'local');
    renderAnnotated(true);
    const lineEls = [...document.querySelectorAll('#annotated .ln')];
    const logs = summaryLog(c);
    for (let s = 0; s < steps.length; s++) {
      st[s] = 'run'; renderSteps(steps, st, times);
      const t0 = performance.now();
      if (s === 1) { for (const el of lineEls) { el.classList.remove('pending'); el.scrollIntoView({ block: 'nearest' }); await wait(14); } }
      else if (s === 2) { for (const el of lineEls.filter(e => e.classList.contains('hit-able'))) { el.classList.add('hit'); await wait(35); } }
      else await wait(380 + s * 50);
      times[s] = Math.round(performance.now() - t0) + ' ms'; st[s] = 'done'; renderSteps(steps, st, times);
      if (logs[s]) logLine(logs[s][0], logs[s][1]);
    }
  }
  const logs = summaryLog(c);
  if (useAi) [logs[3], logs[4], logs[5]].forEach(([h, k]) => logLine(h, k));
  else logLine(logs[5][0], logs[5][1]);
  $('annotated').scrollTop = 0;
  renderAll(); markDirty();
  toast(`${c.code}: ${c.items.length} deliverables${parser === 'ai' ? ' (Claude)' : ''}`);
  running = false; $('parseBtn').disabled = false;
}
function setParser(p) {
  state.parser = p;
  $('useAi').setAttribute('aria-pressed', p === 'ai'); $('useLocal').setAttribute('aria-pressed', p !== 'ai');
  $('modelTag').textContent = p === 'ai' ? 'Claude Opus 5.5 · your API key' : 'local rules · runs in-browser';
  $('parseBtn').lastChild.textContent = p === 'ai' ? ' Parse with Claude' : ' Re-parse syllabus';
}

/* ---------- Derived ---------- */
const dueDate = it => fromIso(it.date);
function statusOf(it) {
  const diff = Math.round((dueDate(it) - TODAY) / DAY);
  if (diff < 0) return ['past', 'Past'];
  if (diff === 0) return ['soon', 'Today'];
  if (diff <= 7) return ['soon', `In ${diff} day${diff > 1 ? 's' : ''}`];
  if (diff <= 21) return ['next', `In ${Math.ceil(diff / 7)} wks`];
  return ['later', 'Upcoming'];
}
function computeLoad(items) {
  const load = new Map(); // iso -> {h, items:[[item, h]]}
  for (const it of items) {
    const t = TYPES.find(t => t.key === it.type) || { lead: 3 };
    const L = Math.max(1, t.lead), sum = L * (L + 1) / 2, due = dueDate(it);
    for (let k = 1; k <= L; k++) {
      const key = iso(addDays(due, -(L - k + 1)));
      const h = it.hours * k / sum;
      const e = load.get(key) || { h: 0, items: [] };
      e.h += h; e.items.push([it, h]); load.set(key, e);
    }
  }
  return load;
}
function termRange(items) {
  if (!items.length) return null;
  const ds = items.map(dueDate).sort((a, b) => a - b);
  const s = addDays(ds[0], -12), e = ds[ds.length - 1];
  return [addDays(s, -((s.getDay() + 6) % 7)), addDays(e, 6 - ((e.getDay() + 6) % 7))];
}
const bin = h => h <= 0.05 ? 0 : h < 1 ? 1 : h < 2.5 ? 2 : h < 4 ? 3 : h < 6 ? 4 : 5;
const tagHtml = c => c ? `<span class="course-tag"><i style="background:${colorOf(c)}"></i>${esc(c.code)}</span>` : '';

/* ---------- Render: course bar ---------- */
function renderCourseBar() {
  const total = allItems().length;
  $('coursebar').innerHTML =
    `<button type="button" class="cchip" data-view="all" aria-pressed="${state.view === 'all'}">All courses<span class="c">${total}</span></button>` +
    state.courses.map(c => `<button type="button" class="cchip" data-view="${c.id}" aria-pressed="${state.view === c.id}"><span class="dot" style="background:${colorOf(c)}"></span>${esc(c.code)}<span class="c">${c.items.length}</span></button>`).join('') +
    (state.courses.length < MAX_COURSES ? `<button type="button" class="cchip add" id="addCourse">+ Add course</button>` : '') +
    `<span class="save-status" id="saveStatus"></span>`;
  paintSaveStatus();
}

/* ---------- Render: summary ---------- */
function examPileups(items) {
  const byWeek = new Map();
  items.filter(i => i.type === 'Exam' || i.type === 'Quiz' && i.weight >= 5).forEach(i => {
    const d = dueDate(i), mon = iso(addDays(d, -((d.getDay() + 6) % 7)));
    const a = byWeek.get(mon) || []; a.push(i); byWeek.set(mon, a);
  });
  return [...byWeek.entries()].filter(([, a]) => new Set(a.map(i => i.cid)).size >= 2).map(([k, a]) => ({ start: fromIso(k), items: a }));
}
function renderSummary(weeks) {
  const items = visibleItems();
  const upcoming = items.filter(i => dueDate(i) >= TODAY).sort((a, b) => dueDate(a) - dueDate(b) || a.time.localeCompare(b.time));
  const next = upcoming[0];
  const peak = weeks.reduce((a, w) => w.h > (a ? a.h : -1) ? w : a, null);
  const hrs = items.reduce((a, i) => a + i.hours, 0);
  const one = state.view !== 'all' ? courseById(state.view) : null;
  const stats = [['Deliverables', items.length, `${upcoming.length} still ahead · ${fmtH(hrs)} h estimated`]];
  if (one) {
    const total = one.categories.reduce((a, c) => a + c.pct, 0);
    if (!one.categories.length) stats.push(['Grading total', '—', 'No grading table yet. Upload the syllabus to add weights.']);
    else stats.push(['Grading total', `${total}%`, total === 100 ? `${one.categories.length} categories, adds up` : `Check the scheme: off by ${Math.abs(100 - total)}%`]);
  } else {
    const piles = examPileups(items).filter(p => addDays(p.start, 7) > TODAY);
    stats.push(['Exam pile-ups', piles.length, piles.length ? `Next: week of ${fmtDay(piles[0].start)} (${piles[0].items.length} exams)` : `No weeks with exams in 2+ courses`]);
  }
  stats.push(['Next deadline', next ? fmtDay(dueDate(next)) : '—', next ? `${state.view === 'all' ? itemCourse(next).code + ' · ' : ''}${next.title}` : 'Nothing upcoming']);
  stats.push(['Heaviest week', peak ? `${fmtH(peak.h)} h` : '—', peak ? `Week of ${fmtDay(peak.start)}` : '']);
  $('summary').innerHTML = stats.map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v">${esc(String(v))}</div><div class="d">${esc(d)}</div></div>`).join('');
}

/* ---------- Render: table ---------- */
function renderFilters() {
  const counts = {}, items = visibleItems();
  items.forEach(i => counts[i.type] = (counts[i.type] || 0) + 1);
  const keys = ['All', ...TYPE_KEYS.filter(k => counts[k])];
  if (!keys.includes(state.filter)) state.filter = 'All';
  $('filters').innerHTML = keys.map(k => `<button type="button" class="chip" data-f="${k}" aria-pressed="${state.filter === k}">${k}<span class="c">${k === 'All' ? items.length : counts[k]}</span></button>`).join('');
}
function eventWindow(it) {
  const d = dueDate(it), [h, m] = it.time.split(':').map(Number);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
  if (it.type === 'Exam' && it.time !== '23:59') return [end, new Date(end.getTime() + 120 * 60000)];
  return [new Date(end.getTime() - 30 * 60000), end];
}
const icsStamp = x => `${iso(x).replace(/-/g, '')}T${String(x.getHours()).padStart(2,'0')}${String(x.getMinutes()).padStart(2,'0')}00`;
function gcalUrl(it) {
  const [s, e] = eventWindow(it), c = itemCourse(it);
  const p = new URLSearchParams({ action: 'TEMPLATE', text: `${c ? c.code + ': ' : ''}${it.title}`, dates: `${icsStamp(s)}/${icsStamp(e)}`, details: `${it.type}${it.weight ? ` · ${it.weight}% of grade` : ''}${it.notes ? `\n${it.notes}` : ''}\nEstimated effort: ${fmtH(it.hours)} h` });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
function renderTable() {
  const k = state.sortKey, dir = state.sortDir, showCourse = state.view === 'all';
  $('thCourse').hidden = !showCourse;
  const list = visibleItems().filter(i => state.filter === 'All' || i.type === state.filter).sort((a, b) => {
    const va = k === 'date' ? a.date + a.time : a[k], vb = k === 'date' ? b.date + b.time : b[k];
    return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
  });
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const on = th.dataset.sort === k;
    if (on) th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort');
    th.querySelector('.arr').textContent = on ? (dir > 0 ? '↑' : '↓') : '↕';
  });
  $('rows').innerHTML = list.length ? list.map(it => {
    const [sc, sl] = statusOf(it);
    const lowConf = it.conf < 80;
    return `<tr data-id="${it.id}" class="${sc === 'past' ? 'past' : ''}${state.freshIds.has(it.id) ? ' fresh' : ''}">
      <td class="c-date"><div style="display:flex;align-items:center;flex-wrap:wrap"><input class="cell-in date" type="date" id="date-${it.id}" value="${it.date}" data-k="date" aria-label="Due date"><span class="due-meta">${fmtDow(dueDate(it))} ${fmtTime(it.time)}</span></div></td>
      ${showCourse ? `<td class="c-course">${tagHtml(itemCourse(it))}</td>` : ''}
      <td class="c-title"><input class="cell-in title" type="text" id="title-${it.id}" value="${esc(it.title)}" data-k="title" aria-label="Title">${it.notes ? `<div class="due-meta" style="padding-left:8px;white-space:normal">${esc(it.notes)}</div>` : ''}</td>
      <td class="c-type" data-label="Type"><select class="cell-in" id="type-${it.id}" data-k="type" aria-label="Type">${TYPE_KEYS.map(t => `<option${t === it.type ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
      <td class="c-weight" data-label="Weight %" style="text-align:right"><input class="cell-in n" type="number" min="0" max="100" step="0.5" id="weight-${it.id}" value="${it.weight}" data-k="weight" aria-label="Weight percent"></td>
      <td class="c-hours" data-label="Est. hrs" style="text-align:right"><input class="cell-in n" type="number" min="0" max="80" step="0.5" id="hours-${it.id}" value="${it.hours}" data-k="hours" aria-label="Estimated hours"></td>
      <td class="c-conf"><span class="conf${lowConf ? ' low' : ''}" title="${lowConf ? 'Low confidence: check this row against the syllabus' : 'Parser confidence'}"><span class="bar"><i style="width:${it.conf}%"></i></span>${it.conf}%</span></td>
      <td class="c-status"><span class="status st-${sc}">${sl}</span></td>
      <td class="c-act"><div class="row-actions">
        <a class="icon-btn" href="${gcalUrl(it)}" target="_blank" rel="noopener" title="Open this event in Google Calendar" aria-label="Add ${esc(it.title)} to Google Calendar"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M8 8.5v4M6 10.5h4"/></svg></a>
        <button type="button" class="icon-btn" data-del="${it.id}" title="Remove" aria-label="Remove ${esc(it.title)}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
        <label class="switch" title="Include in calendar sync"><input type="checkbox" id="sync-${it.id}" data-k="sync" ${it.sync ? 'checked' : ''} aria-label="Sync ${esc(it.title)}"><span></span></label>
      </div></td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="${showCourse ? 9 : 8}">${state.courses.length ? 'No deliverables found. Paste a syllabus with dated lines like “Oct 14 Midterm exam” and parse again.' : 'No courses yet. Add a course to get started.'}</td></tr>`;
  state.freshIds = new Set();
  renderTableNote();
}
function renderTableNote() {
  const items = visibleItems();
  const low = items.filter(i => i.conf < 80).length;
  $('tableNote').textContent = `${low ? `${low} low-confidence row${low > 1 ? 's' : ''} flagged. ` : ''}${state.view === 'all' ? `${state.courses.length} courses. ` : ''}Edits update the heatmap and sync plan.`;
}

/* ---------- Render: grading ---------- */
function renderGrading() {
  if (!courseById(state.gradeId)) state.gradeId = (state.view !== 'all' && state.view) || (editCourse() || {}).id;
  const c = courseById(state.gradeId);
  $('gradeCourse').innerHTML = state.courses.map(x => `<option value="${x.id}"${x.id === state.gradeId ? ' selected' : ''}>${esc(x.code)}</option>`).join('');
  $('gradeCourse').hidden = state.courses.length < 2;
  const cats = c ? c.categories : [];
  const total = cats.reduce((a, k) => a + k.pct, 0);
  const tint = i => c ? `color-mix(in srgb, ${colorOf(c)} ${Math.max(22, 100 - i * 17)}%, var(--surface))` : 'var(--line)';
  $('stack').innerHTML = cats.map((k, i) => `<i style="flex-grow:${k.pct};background:${tint(i)}" title="${esc(k.label)} ${k.pct}%"></i>`).join('');
  $('stack').setAttribute('aria-label', cats.map(k => `${k.label} ${k.pct}%`).join(', '));
  $('stack').hidden = !cats.length;
  $('gradeRows').innerHTML = cats.length ? cats.map((k, i) => {
    const per = k.per != null ? k.per : k.found ? k.pct / (k.count || k.found) : 0;
    const expected = k.count || k.found;
    const mismatch = k.count && k.found !== k.count;
    return `<div class="grade-row"><span class="sw" style="background:${tint(i)}"></span><span class="nm">${esc(k.label)}<small>${expected ? `${expected} item${expected > 1 ? 's' : ''} · ${Math.round(per * 100) / 100}% each` : 'No dated items matched'}${mismatch ? ` · found ${k.found}` : ''}</small></span><span class="ct">${k.type}</span><span class="pc">${k.pct}%</span></div>`;
  }).join('') : `<div class="sync-note" style="display:grid;gap:10px"><span>${c && c.items.length ? `${esc(c.code)} has due dates but no grade weights yet. That's normal when the schedule and the syllabus are separate files.` : 'No grading table found yet.'} Upload the syllabus PDF that has the grading table (lines like “Midterm exam ..... 20%”) and it's added to this course.</span><label class="btn sm" for="fileInput" style="justify-self:start;cursor:pointer">Upload syllabus PDF</label></div>`;
  if (!cats.length) {
    $('gradeTotal').innerHTML = '<span class="mono">—</span>';
    renderWhatIf();
    return;
  }
  $('gradeTotal').innerHTML = `<span class="mono">${total}%</span> ${total === 100 ? '<span class="badge good">✓ Adds to 100</span>' : `<span class="badge warn">! ${total > 100 ? 'Over' : 'Under'} by ${Math.abs(100 - total)}%</span>`}`;
  renderWhatIf();
}
function renderWhatIf() {
  const c = courseById(state.gradeId), avg = +$('whatifRange').value;
  $('whatifVal').textContent = avg + '%';
  const items = c ? c.items : [];
  const doneW = items.filter(i => dueDate(i) < TODAY && i.weight > 0).reduce((a, i) => a + i.weight, 0);
  const totalW = items.reduce((a, i) => a + (i.weight > 0 ? i.weight : 0), 0);
  const left = totalW - doneW;
  if (!totalW) { $('whatifOut').textContent = 'Add weights to see grade projections.'; return; }
  const target = [[90, 'A−'], [80, 'B−'], [70, 'C−']].map(([g, lbl]) => {
    if (left <= 0) return `${lbl}: term complete`;
    const need = (g * totalW / 100 - avg * doneW / 100) / left * 100;
    return `${lbl} (${g}%) needs <b class="mono">${need <= 0 ? 'any score' : need > 100 ? 'out of reach' : Math.ceil(need) + '%'}</b>`;
  });
  $('whatifOut').innerHTML = `<span style="color:var(--muted)">In ${esc(c.code)}, ${fmtH(doneW)}% of the grade is behind you and ${fmtH(left)}% is ahead. On the remaining work:</span><br>${target.join(' · ')}`;
}

/* ---------- Render: heatmap ---------- */
let heatData = { load: new Map(), due: new Map(), weeks: [] };
function renderHeat() {
  const items = visibleItems(), courses = visibleCourses();
  const range = termRange(items);
  const heat = $('heat'), bars = $('weekbars');
  $('courseLegend').innerHTML = courses.length > 1 ? `<span>Weekly bars by course:</span>` + courses.map(tagHtml).join('') : '<span>Bars: hours per week</span>';
  if (!range) { heat.innerHTML = ''; bars.innerHTML = ''; $('callouts').innerHTML = ''; heatData.weeks = []; return []; }
  const [mon, sun] = range;
  const nWeeks = Math.min(30, Math.round((sun - mon) / DAY + 1) / 7);
  heat.style.setProperty('--weeks', nWeeks); bars.style.setProperty('--weeks', nWeeks);
  const load = computeLoad(items);
  const dueMap = new Map();
  items.forEach(i => { const a = dueMap.get(i.date) || []; a.push(i); dueMap.set(i.date, a); });
  let html = '<span></span>', lastM = -1;
  const weeks = [];
  for (let w = 0; w < nWeeks; w++) {
    const d = addDays(mon, w * 7), m = addDays(d, 6).getMonth();
    html += `<span class="mlab">${m !== lastM ? new Date(d.getFullYear(), m, 1).toLocaleDateString('en-US', { month: 'short' }) : ''}</span>`;
    lastM = m;
    weeks.push({ start: d, h: 0, byCourse: new Map(), items: new Map() });
  }
  const DOW = ['Mon','','Wed','','Fri','','Sun'];
  for (let r = 0; r < 7; r++) {
    html += `<span class="dlab">${DOW[r]}</span>`;
    for (let w = 0; w < nWeeks; w++) {
      const d = addDays(mon, w * 7 + r), key = iso(d), e = load.get(key), h = e ? e.h : 0;
      weeks[w].h += h;
      if (e) e.items.forEach(([it, x]) => {
        weeks[w].byCourse.set(it.cid, (weeks[w].byCourse.get(it.cid) || 0) + x);
        weeks[w].items.set(it, (weeks[w].items.get(it) || 0) + x);
      });
      const dues = dueMap.get(key);
      const cls = ['c', dues ? 'due' : '', key === iso(TODAY) ? 'today' : ''].filter(Boolean).join(' ');
      html += `<button type="button" class="${cls}" data-b="${bin(h)}" data-day="${key}" aria-label="${fmtDow(d)} ${fmtDay(d)}: ${fmtH(h)} hours${dues ? ', due: ' + esc(dues.map(x => x.title).join(', ')) : ''}"></button>`;
    }
  }
  heat.innerHTML = html;
  const maxW = Math.max(1, ...weeks.map(w => w.h)), barPx = 60;
  bars.innerHTML = `<span class="yl">${Math.ceil(maxW)}h</span>` + weeks.map((w, i) => {
    const segs = courses.map(c => [c, w.byCourse.get(c.id) || 0]).filter(([, h]) => h > 0)
      .map(([c, h]) => `<span style="height:${Math.max(2, h / maxW * barPx - 2)}px;background:${colorOf(c)}"></span>`).join('');
    return `<button type="button" class="wb" data-w="${i}" aria-label="Week of ${fmtDay(w.start)}: ${fmtH(w.h)} hours">${segs}</button>`;
  }).join('');
  heatData = { load, due: dueMap, weeks };
  requestAnimationFrame(() => {
    const wrap = heat.parentElement, t = heat.querySelector('.today');
    if (t && wrap.scrollWidth > wrap.clientWidth) wrap.scrollLeft = Math.max(0, t.offsetLeft - wrap.clientWidth / 2);
  });

  const peakIdx = weeks.reduce((a, w, i) => w.h > weeks[a].h ? i : a, 0);
  const peak = weeks[peakIdx];
  const avg = weeks.reduce((a, w) => a + w.h, 0) / weeks.length;
  const crunch = weeks.filter(w => w.h > avg * 1.6).length;
  const top = [...peak.items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([it]) => (courses.length > 1 ? itemCourse(it).code + ' ' : '') + it.title);
  const thisWeek = weeks.find(w => TODAY >= w.start && TODAY < addDays(w.start, 7));
  let out = `
    <div class="callout"><div class="t"><span class="badge warn">Crunch</span>Week of ${fmtDay(peak.start)}</div><p>${fmtH(peak.h)} h, about ${(peak.h / Math.max(avg, .1)).toFixed(1)}× a typical week. Driven by ${top.map(esc).join(', ')}.</p></div>
    <div class="callout"><div class="t">${thisWeek ? 'This week' : 'Term average'}</div><p>${thisWeek ? `${fmtH(thisWeek.h)} h planned against a ${fmtH(avg)} h weekly average.` : `${fmtH(avg)} h per week.`} ${crunch} week${crunch === 1 ? '' : 's'} run well above average; start those early.</p></div>`;
  if (courses.length > 1) {
    const piles = examPileups(items);
    if (piles.length) out += `<div class="callout" style="grid-column:1/-1"><div class="t"><span class="badge warn">Pile-up</span>Exams in 2+ courses the same week</div><p>${piles.map(p => `<b>${fmtDay(p.start)}</b>: ${p.items.sort((a, b) => a.date.localeCompare(b.date)).map(i => `${esc(itemCourse(i).code)} ${esc(i.title.toLowerCase())} (${fmtDow(dueDate(i))})`).join(', ')}`).join('<br>')}</p></div>`;
  }
  $('callouts').innerHTML = out;
  return weeks;
}

/* ---------- Tooltip ---------- */
const tip = $('tip');
function showTip(target, html) {
  tip.innerHTML = html; tip.hidden = false;
  const r = target.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
  if (y < 8) y = r.bottom + 8;
  x = Math.max(8, Math.min(x, innerWidth - tw - 8));
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideTip() { tip.hidden = true; }
const multi = () => visibleCourses().length > 1;
const itemLabel = it => (multi() ? itemCourse(it).code + ' · ' : '') + it.title;
function cellTip(el) {
  const key = el.dataset.day, e = heatData.load.get(key), dues = heatData.due.get(key), d = fromIso(key);
  let h = `<b>${fmtDow(d)}, ${fmtDay(d)}</b> <span class="tm">· ${fmtH(e ? e.h : 0)} h</span>`;
  if (dues) h += `<div style="margin-top:4px">Due: ${dues.map(x => esc(itemLabel(x))).join(', ')}</div>`;
  if (e) h += `<ul>${e.items.slice().sort((a, b) => b[1] - a[1]).slice(0, 4).map(([it, x]) => `<li><span>${esc(itemLabel(it))}</span><span class="tm">${fmtH(x)} h</span></li>`).join('')}</ul>`;
  showTip(el, h);
}
function weekTip(el) {
  const w = heatData.weeks[+el.dataset.w]; if (!w) return;
  const courses = visibleCourses().filter(c => w.byCourse.get(c.id));
  const rows = courses.length > 1
    ? courses.map(c => `<li><span>${esc(c.code)}</span><span class="tm">${fmtH(w.byCourse.get(c.id))} h</span></li>`)
    : [...w.items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([it, x]) => `<li><span>${esc(it.title)}</span><span class="tm">${fmtH(x)} h</span></li>`);
  showTip(el, `<b>${fmtDay(w.start)} – ${fmtDay(addDays(w.start, 6))}</b> <span class="tm">· ${fmtH(w.h)} h</span>${rows.length ? `<ul>${rows.join('')}</ul>` : ''}`);
}
for (const [id, fn, sel] of [['heat', cellTip, '.c'], ['weekbars', weekTip, '.wb']]) {
  $(id).addEventListener('pointerover', e => { const el = e.target.closest(sel); if (el) fn(el); });
  $(id).addEventListener('pointerout', e => { if (e.target.closest(sel)) hideTip(); });
  $(id).addEventListener('focusin', e => { const el = e.target.closest(sel); if (el) fn(el); });
  $(id).addEventListener('focusout', hideTip);
}
for (const [id, fn, sel] of [['heat', cellTip, '.c'], ['weekbars', weekTip, '.wb']]) {
  $(id).addEventListener('click', e => { const el = e.target.closest(sel); if (el) { fn(el); e.stopPropagation(); } });
}
document.addEventListener('click', hideTip);
addEventListener('scroll', hideTip, { passive: true });

/* ---------- Sync ---------- */
const reminderMins = () => [...document.querySelectorAll('#reminders .chip[aria-pressed="true"]')].map(b => +b.dataset.min);
const calFor = c => $('perCourse').checked ? `${c.code} · Deadlines` : ($('calName').value.trim() || 'Semester deadlines');
function buildEvents() {
  const skipPast = $('skipPast').checked, rem = reminderMins().join(',');
  const evs = [];
  const load = computeLoad(allItems());
  for (const c of state.courses) for (const it of c.items) {
    if (!it.sync || (skipPast && dueDate(it) < TODAY)) continue;
    const cal = calFor(c);
    evs.push({ id: it.id, kind: 'due', when: dueDate(it), time: it.time, title: it.title, it, c, cal, hash: [it.title, it.date, it.time, it.weight, rem, cal].join('|') });
    if ($('studyBlocks').checked && it.hours > 5) {
      const t = TYPES.find(t => t.key === it.type) || { lead: 3 };
      const days = [];
      for (let k = 1; k <= t.lead; k++) days.push(addDays(dueDate(it), -k));
      days.sort((a, b) => (load.get(iso(b))?.h || 0) - (load.get(iso(a))?.h || 0));
      days.slice(0, 2).sort((a, b) => a - b).forEach((d, n) => {
        if (skipPast && d < TODAY) return;
        evs.push({ id: it.id + '-s' + n, kind: 'study', when: d, time: '15:00', title: `Study: ${it.title}`, it, c, cal, hash: [it.title, iso(d), it.hours, cal].join('|') });
      });
    }
  }
  return evs.sort((a, b) => a.when - b.when || a.time.localeCompare(b.time));
}
function diffEvents(evs) {
  const prev = state.synced || new Map();
  const res = { add: 0, upd: 0, ok: 0, status: new Map() };
  for (const e of evs) {
    const p = prev.get(e.id);
    const s = p == null ? 'add' : p !== e.hash ? 'upd' : 'ok';
    res[s]++; res.status.set(e.id, s);
  }
  const ids = new Set(evs.map(e => e.id));
  res.removed = [...prev.keys()].filter(k => !ids.has(k));
  res.del = res.removed.length;
  return res;
}
const LABEL = { add: 'New', upd: 'Changed', ok: 'In sync' };
let syncing = false;
function renderSync() {
  $('calNameField').hidden = $('perCourse').checked;
  const evs = buildEvents(), df = diffEvents(evs);
  const pending = df.add + df.upd + df.del;
  const cals = new Set(evs.map(e => e.cal)).size;
  $('diff').innerHTML = state.synced
    ? (pending ? `${df.add ? `<span class="add">+${df.add} new</span>` : ''}${df.upd ? `<span class="upd">~${df.upd} changed</span>` : ''}${df.del ? `<span class="del">−${df.del} removed</span>` : ''}<span>${df.ok} in sync</span>` : `<span class="add">✓ Calendar is up to date</span>`)
    : `<span>${evs.length} events</span><span>${cals} calendar${cals === 1 ? '' : 's'}</span><span>${evs.filter(e => e.kind === 'study').length} study blocks</span>`;
  $('syncBtn').disabled = !state.connected || syncing || !!(state.synced && !pending) || !evs.length && !df.del;
  $('syncBtn').textContent = !state.connected ? 'Connect to sync' : state.synced ? (pending ? `Push ${pending} change${pending > 1 ? 's' : ''}` : 'Up to date') : `Sync ${evs.length} events`;
  const removedRows = df.removed.map(() => `<li><span class="ck"></span><span class="when">—</span><span class="what" style="color:var(--muted)">Event no longer in your plan</span><span class="st del">Remove</span></li>`).join('');
  const many = state.courses.length > 1;
  $('events').innerHTML = evs.length || removedRows ? evs.map(e => {
    const s = state.synced ? df.status.get(e.id) : 'add';
    return `<li data-e="${e.id}"><span class="ck${state.synced && s === 'ok' ? ' done' : ''}"><svg viewBox="0 0 10 10" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.2l2 2 4-4.4"/></svg></span><span class="when">${fmtDay(e.when)}</span><span class="what" title="${esc(e.c.code + ': ' + e.title)}">${many ? `<span class="course-tag" style="margin-right:6px"><i style="background:${colorOf(e.c)}"></i>${esc(e.c.code)}</span>` : ''}${e.kind === 'study' ? '<span style="color:var(--muted)">' + esc(e.title) + '</span>' : esc(e.title)} <span class="due-meta" style="padding:0">${fmtTime(e.time)}</span></span><span class="st ${state.synced ? s : ''}">${state.synced ? LABEL[s] : e.kind === 'study' ? 'Block' : 'Deadline'}</span></li>`;
  }).join('') + removedRows : `<li style="display:block;color:var(--muted)">Nothing selected to sync. Turn on rows in the Deliverables table.</li>`;
  $('ics').textContent = buildIcs(evs);
  $('syncNote').innerHTML = state.lastSync ? `Last sync ${state.lastSync.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} to ${cals} calendar${cals === 1 ? '' : 's'}. Edits in the table show up here as pending changes.` : `Each deadline becomes a 30-minute event ending at its due time. Exams with a start time get a 2-hour block.`;
}
function buildIcs(evs) {
  const rems = reminderMins();
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SemesterSync//EN', `X-WR-CALNAME:${$('perCourse').checked ? 'Semester deadlines' : calFor({})}`];
  for (const e of evs) {
    let s, f;
    if (e.kind === 'study') { const [h, m] = e.time.split(':').map(Number); s = new Date(e.when.getFullYear(), e.when.getMonth(), e.when.getDate(), h, m); f = new Date(s.getTime() + 90 * 60000); }
    else [s, f] = eventWindow(e.it);
    out.push('BEGIN:VEVENT', `UID:${e.id}-${iso(e.when)}@syllabus-sync`, `DTSTART:${icsStamp(s)}`, `DTEND:${icsStamp(f)}`,
      `SUMMARY:${(e.c.code + ': ' + e.title).replace(/[,;]/g, '\\$&')}`, `CATEGORIES:${e.c.code.replace(/[,;]/g, '')}`,
      `DESCRIPTION:${e.it.type}${e.it.weight ? ` · ${e.it.weight}% of grade` : ''} · est. ${fmtH(e.it.hours)} h`);
    if (e.kind === 'due') rems.forEach(r => out.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-PT${r}M`, `DESCRIPTION:${e.title}`, 'END:VALARM'));
    out.push('END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\n');
}
async function doSync() {
  if (syncing) return;
  syncing = true; $('syncBtn').disabled = true;
  const evs = buildEvents(), df = diffEvents(evs);
  const work = evs.filter(e => !state.synced || df.status.get(e.id) !== 'ok');
  $('progress').style.width = '0%';
  let n = 0;
  for (const e of work) {
    const li = document.querySelector(`#events li[data-e="${e.id}"]`);
    await wait(45);
    if (li) { li.querySelector('.ck').classList.add('done'); li.scrollIntoView({ block: 'nearest' }); }
    n++; $('progress').style.width = (n / Math.max(work.length, 1) * 100) + '%';
  }
  await wait(200);
  state.synced = new Map(evs.map(e => [e.id, e.hash]));
  state.lastSync = new Date();
  syncing = false;
  const total = work.length + df.del;
  toast(`Synced ${total} change${total === 1 ? '' : 's'} (simulated)`);
  $('events').scrollTop = 0;
  renderSync();
}

/* ---------- Saving ---------- */
const store = { mode: 'none', col: null, saved: new Map(), timer: null, status: 'sample', busy: false };
const STORE_KEY = 'ssync-courses-v1';
const serialize = c => JSON.stringify({ id: c.id, code: c.code, title: c.title, text: c.text, categories: c.categories, items: c.items, color: c.color, parser: c.parser, order: c.order });
function paintSaveStatus() {
  const el = $('saveStatus'); if (!el) return;
  const copy = {
    sample: ['', store.mode === 'db' ? 'Sample courses · your changes save to your account' : store.mode === 'local' ? 'Sample courses · your changes save on this computer' : 'Sample courses'],
    saving: ['busy', 'Saving…'],
    saved: ['ok', store.mode === 'db' ? 'Saved to your account' : 'Saved on this computer'],
    error: ['err', 'Couldn\'t save. Changes are kept on this page until you reload.'],
    none: ['', 'Changes last until you reload'],
  }[store.status] || ['', ''];
  el.className = 'save-status ' + copy[0]; el.textContent = copy[1];
}
function markDirty() {
  state.dirty = true;
  if (store.mode === 'none') { store.status = 'none'; paintSaveStatus(); return; }
  store.status = 'saving'; paintSaveStatus();
  clearTimeout(store.timer);
  store.timer = setTimeout(flushSave, 800);
}
async function flushSave() {
  if (store.busy) { store.timer = setTimeout(flushSave, 400); return; }
  store.busy = true;
  try {
    if (store.mode === 'db') {
      const ids = new Set(state.courses.map(c => c.id));
      if (!store.saved.has('meta')) { await store.col.doc('meta').set({ v: 1 }); store.saved.set('meta', '1'); }
      for (const c of state.courses) {
        const s = serialize(c);
        if (store.saved.get(c.id) !== s) { await store.col.doc('course-' + c.id).set({ json: s }); store.saved.set(c.id, s); }
      }
      for (const id of [...store.saved.keys()]) if (id !== 'meta' && !ids.has(id)) { await store.col.doc('course-' + id).delete(); store.saved.delete(id); }
    } else if (store.mode === 'local') {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.courses.map(serialize)));
    }
    store.status = 'saved';
  } catch (e) { store.status = 'error'; }
  store.busy = false;
  paintSaveStatus();
}
function adoptCourses(list) {
  const courses = list.filter(c => c && c.id && Array.isArray(c.items)).sort((a, b) => (a.order || 0) - (b.order || 0)).slice(0, MAX_COURSES);
  courses.forEach(c => { c.items.forEach(it => { it.cid = c.id; }); c.categories = c.categories || []; });
  state.courses = courses;
  state.view = 'all'; state.editId = courses[0] ? courses[0].id : null; state.gradeId = state.editId;
  state.synced = null;
  renderAnnotated(false);
  const c = editCourse();
  $('log').innerHTML = '';
  if (c) { renderSteps(c.parser === 'ai' ? STEPS_AI : STEPS_LOCAL, STEPS_LOCAL.map(() => 'done'), []); logLine(`Loaded ${courses.length} saved course${courses.length === 1 ? '' : 's'}`, 'ok'); summaryLog(c).forEach(([h, k]) => logLine(h, k)); }
  renderAll();
}
async function initStore() {
  const api = window.claude && window.claude.use ? window.claude : null;
  let loaded = null;
  if (api) {
    try {
      const [db, user] = await Promise.all([api.use('db'), api.use('user')]);
      const id = user ? await user.id() : null;
      if (db && id) {
        const col = db.collection('data/users/' + id);
        const snap = await col.get();
        store.mode = 'db'; store.col = col;
        if (snap.docs.some(d => d.id === 'meta' && d.exists)) {
          store.saved.set('meta', '1');
          loaded = [];
          for (const d of snap.docs) {
            if (!d.exists || !d.id.startsWith('course-')) continue;
            try { const json = d.data().json; const c = JSON.parse(json); store.saved.set(c.id, json); loaded.push(c); } catch (_) {}
          }
        }
      }
    } catch (_) { store.mode = 'none'; }
  }
  if (store.mode !== 'db') {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      store.mode = 'local';
      if (raw) loaded = JSON.parse(raw).map(s => JSON.parse(s));
    } catch (_) { store.mode = 'none'; }
  }
  if (loaded && !state.dirty) { adoptCourses(loaded); store.status = 'saved'; }
  else if (state.dirty) { markDirty(); return; }
  else store.status = store.mode === 'none' ? 'none' : 'sample';
  paintSaveStatus();
}
async function initAi() {
  const api = window.claude && window.claude.use ? window.claude : null;
  try { sampleFn = api ? await api.use('sample') : null; } catch (_) { sampleFn = null; }
  $('useAi').disabled = !sampleFn;
  $('useAi').title = sampleFn ? 'Extract with Claude using your API key' : 'Claude isn\'t available in this view';
  if (sampleFn) setParser('ai');
}

/* ---------- Glue ---------- */
function renderAll() {
  if (state.view !== 'all' && !courseById(state.view)) state.view = 'all';
  const c = editCourse();
  $('courseTitle').innerHTML = c ? `${tagHtml(c)} <span style="margin-left:4px">${esc(c.title || 'Syllabus')}</span>` : 'No course selected';
  $('removeCourse').hidden = !c;
  renderCourseBar(); renderFilters(); renderTable(); renderGrading();
  const weeks = renderHeat(); renderSummary(weeks); renderSync();
}
function renderDerived() {
  renderCourseBar();
  const weeks = renderHeat(); renderSummary(weeks); renderSync(); renderGrading(); renderTableNote();
}
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function setView(v) {
  const ann = v === 'ann', c = editCourse();
  $('viewAnn').setAttribute('aria-pressed', ann); $('viewEdit').setAttribute('aria-pressed', !ann);
  $('annotated').hidden = !ann; $('syllabusInput').hidden = ann;
  if (!ann) { $('syllabusInput').value = c ? c.text : ''; $('syllabusInput').focus(); }
}
function selectCourse(id) {
  state.view = id;
  if (id !== 'all') { state.editId = id; state.gradeId = id; }
  setView('ann'); renderAnnotated(false);
  const c = editCourse();
  $('log').innerHTML = '';
  if (c) { renderSteps(c.parser === 'ai' ? STEPS_AI : STEPS_LOCAL, STEPS_LOCAL.map(() => 'done'), []); summaryLog(c).forEach(([h, k]) => logLine(h, k)); }
  renderAll();
}
function addCourse(text) {
  if (state.courses.length >= MAX_COURSES) { toast(`You can track up to ${MAX_COURSES} courses`); return null; }
  const c = newCourse(text);
  state.courses.push(c);
  return c;
}

$('coursebar').addEventListener('click', e => {
  if (e.target.closest('#addCourse')) {
    const c = addCourse('');
    if (!c) return;
    state.view = c.id; state.editId = c.id; state.gradeId = c.id;
    $('log').innerHTML = ''; renderSteps(STEPS_LOCAL, STEPS_LOCAL.map(() => 'wait'), []);
    logLine('Paste the syllabus text, then choose Parse.');
    renderAll(); setView('edit');
    $('syllabusInput').placeholder = 'Paste your syllabus here: course title on the first line, then the grading table and dated deliverables.';
    document.getElementById('source').scrollIntoView({ block: 'start' });
    return;
  }
  const b = e.target.closest('[data-view]'); if (b) selectCourse(b.dataset.view);
});
let removeArmed = null;
$('removeCourse').onclick = () => {
  const c = editCourse(); if (!c) return;
  const btn = $('removeCourse');
  if (removeArmed !== c.id) {
    removeArmed = c.id; btn.classList.add('armed'); btn.textContent = `Remove ${c.code}? Click again`;
    setTimeout(() => { if (removeArmed === c.id) { removeArmed = null; btn.classList.remove('armed'); btn.textContent = 'Remove course'; } }, 3500);
    return;
  }
  removeArmed = null; btn.classList.remove('armed'); btn.textContent = 'Remove course';
  state.courses = state.courses.filter(x => x !== c);
  state.view = 'all'; state.editId = state.courses[0] ? state.courses[0].id : null; state.gradeId = state.editId;
  selectCourse('all'); markDirty();
  toast(`Removed ${c.code}`);
};
$('viewAnn').onclick = () => {
  const c = editCourse();
  if (c && c.text !== $('syllabusInput').value) { c.text = $('syllabusInput').value; runParse(true); }
  else setView('ann');
};
$('viewEdit').onclick = () => setView('edit');
$('parseBtn').onclick = () => {
  let c = editCourse();
  if (!c) { c = addCourse(''); state.editId = c.id; state.view = c.id; }
  if (!$('syllabusInput').hidden) c.text = $('syllabusInput').value;
  if (!c.text.trim()) { toast('Paste the syllabus text first'); setView('edit'); return; }
  runParse(true);
};
$('stopBtn').onclick = () => aiCtl && aiCtl.abort();
$('useAi').onclick = () => sampleFn && setParser('ai');
$('useLocal').onclick = () => setParser('local');
$('loadSample').onclick = () => {
  const have = new Set(state.courses.map(c => c.code));
  let added = 0;
  for (const text of SAMPLES) {
    const code = courseCode(text.split('\n')[0]);
    if (have.has(code)) continue;
    const c = addCourse(text); if (!c) break;
    applyResult(c, parseLocal(text, c.id), 'local'); added++;
  }
  if (!added) { toast('Sample courses are already here'); return; }
  $('fileNote').hidden = true;
  selectCourse('all'); markDirty();
  toast(`Added ${added} sample course${added > 1 ? 's' : ''}`);
};
/* ---------- PDF reading (pdf.js; text stays on this device) ---------- */
// Groups text items into table cells: lines that touch vertically and overlap horizontally.
function pdfCells(items) {
  const parent = items.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j], h = Math.min(a.h, b.h), dy = Math.abs(a.y - b.y);
    const gap = a.x < b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
    if ((dy < h * 0.3 && gap < h * 0.9) || (dy >= h * 0.3 && dy <= h * 1.8 && gap < 2)) parent[find(i)] = find(j);
  }
  const groups = new Map();
  items.forEach((it, i) => { const k = find(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
  return [...groups.values()].map(g => {
    const top = Math.max(...g.map(t => t.y + t.h)), bottom = Math.min(...g.map(t => t.y));
    const lines = pdfLines(g).map(l => l.text);
    let text = '';
    lines.forEach((l, i) => {
      if (!i) { text = l; return; }
      const open = (text.match(/\(/g) || []).length > (text.match(/\)/g) || []).length;
      const joins = open || /[,&/(-]$|\b(of|for|and|or|the|to|in|on|with|a|an|by|at|from|is|are|be|due)$/i.test(text) || /^[a-z0-9(&-]/.test(l);
      text += joins ? ' ' + l : ' · ' + l;
    });
    return { items: g, top, bottom, center: (top + bottom) / 2, left: Math.min(...g.map(t => t.x)), text: text.replace(/\s+/g, ' ').trim() };
  });
}
// Visual lines (top to bottom) from loose text items.
function pdfLines(items) {
  const rows = [];
  for (const t of items) {
    let row = rows.find(r => Math.abs(r.y - t.y) < Math.min(r.h, t.h) * 0.5);
    if (!row) rows.push(row = { y: t.y, h: t.h, items: [] });
    row.items.push(t);
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    let text = '', end = null;
    for (const t of r.items) {
      if (end !== null) { const gap = t.x - end; text += gap > t.h * 1.2 ? '  ' : gap > t.h * 0.12 && !/\s$/.test(text) && !/^\s/.test(t.s) ? ' ' : ''; }
      text += t.s; end = t.x + t.w;
    }
    return { y: r.y, h: r.h, text: text.replace(/\s+$/, '') };
  });
}
// Week-by-week schedule tables: anchor each row on its date-range cell ("9/6-9/13"), then
// attach every cell whose vertical center (or top) lines up with it.
const RANGE_RE = /(\d{1,2}\/\d{1,2})\s*[–-]\s*(\d{1,2}\/\d{1,2})/;
function pdfScheduleRows(items) {
  const cells = pdfCells(items);
  const anchors = cells.filter(c => c.text.length <= 40 && RANGE_RE.test(c.text.replace(/[–-]\s+/g, '-')));
  if (!anchors.length) return { rows: [], used: new Set(), top: 0 };
  const taken = new Set(anchors);
  const rows = anchors.map(a => {
    const label = cells.filter(c => !taken.has(c) && c.text.length <= 40 && c.bottom >= a.top - 2 && c.bottom - a.top <= 30 && Math.abs(c.left - a.left) < 60)
      .sort((x, y) => (/^(week|wk|finals?)\b/i.test(y.text) - /^(week|wk|finals?)\b/i.test(x.text)) || Math.abs(x.left - a.left) - Math.abs(y.left - a.left))[0];
    if (label) taken.add(label);
    const range = a.text.replace(/[–-]\s+/g, '-').match(RANGE_RE);
    const name = ((label ? label.text + ' ' : '') + a.text.replace(/[–-]\s+/g, '-').replace(RANGE_RE, '')).replace(/\s+/g, ' ').trim() || 'Week';
    const top = Math.max(a.top, label ? label.top : 0), bottom = a.bottom;
    return { name, range: `${range[1]}–${range[2]}`, top, center: (top + bottom) / 2, cells: [] };
  });
  for (const c of cells) {
    if (taken.has(c)) continue;
    let best = null, bestD = Infinity;
    for (const r of rows) { const d = Math.min(Math.abs(c.center - r.center), Math.abs(c.top - r.top)); if (d < bestD) { bestD = d; best = r; } }
    if (best && bestD <= 35) { if (!/^\d{1,2}$/.test(c.text)) best.cells.push(c); taken.add(c); }
    else if (/^\d{1,2}$/.test(c.text) && c.top <= Math.max(...rows.map(r => r.top)) + 20) taken.add(c); // merged module-number cells
  }
  const used = new Set();
  for (const c of taken) c.items.forEach(t => used.add(t));
  return {
    used,
    top: Math.max(...rows.map(r => Math.max(r.top, ...r.cells.map(c => c.top)))),
    rows: rows.map(r => ({ y: r.top, h: 12, text: `${r.name} (${r.range}) | ` + r.cells.sort((a, b) => a.left - b.left).map(c => c.text).filter(Boolean).join(' | ') })),
  };
}
async function pdfToText(file) {
  const lib = window.pdfjsLib;
  if (!lib) throw { code: 'no_lib' };
  // isEvalSupported:false keeps pdf.js from compiling code out of font data in untrusted PDFs.
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const height = page.view[3];
    const { items: raw } = await page.getTextContent();
    // Icon-font glyphs (private-use characters) would show up as empty boxes, so they're dropped.
    const items = raw.map(it => ({ x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10, s: (it.str || '').replace(/[\uE000-\uF8FF\uFFFD]/g, '') })).filter(t => t.s.trim())
      .filter(t => t.y > 28 && t.y < height - 28); // browser print headers/footers: timestamp, URL, page numbers
    const table = pdfScheduleRows(items);
    if (table.rows.length) {
      const head = pdfCells(items.filter(t => !table.used.has(t))).filter(c => c.bottom >= table.top - 2 && c.bottom - table.top < 70 && c.text.length < 160);
      if (head.length >= 2) {
        head.forEach(c => c.items.forEach(t => table.used.add(t)));
        table.rows.push({ y: Math.max(...head.map(c => c.top)), h: 12, text: head.sort((a, b) => a.left - b.left).map(c => c.text).join(' | ') });
      }
    }
    const lines = pdfLines(items.filter(t => !table.used.has(t))).concat(table.rows).sort((a, b) => b.y - a.y);
    const out = [];
    lines.forEach((l, i) => { if (i && lines[i - 1].y - l.y > l.h * 2.2 && !(l.text.includes(' | ') && lines[i - 1].text.includes(' | '))) out.push(''); out.push(l.text); });
    pages.push(out.join('\n'));
    page.cleanup();
  }
  await doc.destroy();
  return pages.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
function fileNote(msg) { $('fileNote').textContent = msg; $('fileNote').hidden = !msg; }
function useSyllabusText(text) {
  const code = detectCourse(text).code;
  const same = code && state.courses.find(x => x.text.trim() && x.code === code);
  if (same) {
    same.text = `${same.text.replace(/\s+$/, '')}\n\n${text}`;
    state.editId = same.id; state.view = same.id; state.gradeId = same.id;
    $('syllabusInput').value = same.text; fileNote('');
    toast(`Added to ${code}`);
    renderAll(); runParse(true);
    return;
  }
  let c = editCourse();
  if (!c || c.text.trim()) { c = addCourse(''); if (!c) return; }
  state.editId = c.id; state.view = c.id; state.gradeId = c.id;
  c.text = text; $('syllabusInput').value = c.text; fileNote('');
  renderAll(); runParse(true);
}
async function readPdf(f) {
  fileNote(''); toast(`Reading ${f.name}…`);
  let text;
  try { text = await pdfToText(f); }
  catch (e) {
    if (e && e.name === 'PasswordException') fileNote(`${f.name} is password-protected. Open it, remove the password (or print it to a new PDF), then upload that.`);
    else if (e && e.code === 'no_lib') fileNote('PDF reading didn\'t load. Check your internet connection and reload, or paste the text instead.');
    else fileNote(`Couldn't read ${f.name}. It may be damaged. Try exporting it again, or paste the text instead.`);
    return;
  }
  if (text.replace(/\s/g, '').length < 40) {
    // A scan has no text layer: with an API key, Claude reads the page images instead.
    const d = window.desktop;
    if (!(d && await d.claude.available())) { fileNote(`${f.name} looks like a scanned image with no text to read. Add a Claude API key in Settings to read scans, or paste the text with Edit text.`); return; }
    toast('This PDF is a scan. Asking Claude to read it…');
    fileNote(`Reading the scanned pages of ${f.name} with Claude. This can take up to a minute.`);
    const res = await d.claude.transcribePdf(new Uint8Array(await f.arrayBuffer()));
    if (!res.ok) { fileNote(res.message || `Claude couldn't read ${f.name}. Paste the text instead.`); return; }
    text = res.text;
  }
  useSyllabusText(text);
}
function loadFile(f) {
  if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') { readPdf(f); return; }
  if (/\.(docx?|pages|rtf)$/i.test(f.name)) {
    fileNote(`${f.name} is a ${f.name.split('.').pop().toUpperCase()} file. Save it as PDF (File → Export or Print → Save as PDF) and upload that, or paste the text.`);
    return;
  }
  const r = new FileReader();
  r.onload = () => useSyllabusText(String(r.result));
  r.onerror = () => fileNote(`Couldn't read ${f.name}. Try pasting its text instead.`);
  r.readAsText(f);
}
$('fileInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadFile(f); });
const srcPanel = document.querySelector('#source .panel');
srcPanel.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); srcPanel.classList.add('drop'); } });
srcPanel.addEventListener('dragleave', e => { if (!srcPanel.contains(e.relatedTarget)) srcPanel.classList.remove('drop'); });
srcPanel.addEventListener('drop', e => { e.preventDefault(); srcPanel.classList.remove('drop'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
$('syllabusInput').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('parseBtn').click(); } });
if ('IntersectionObserver' in window) {
  const links = [...document.querySelectorAll('.bottomnav a, .nav a')];
  const io = new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id || (en.target.id === 'grading' && a.getAttribute('href') === '#workload')));
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['source', 'deliverables', 'grading', 'workload', 'sync'].forEach(id => io.observe($(id)));
}

$('filters').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; state.filter = b.dataset.f; renderFilters(); renderTable(); });
document.querySelectorAll('th[data-sort] button').forEach(b => b.onclick = () => {
  const k = b.parentElement.dataset.sort;
  state.sortDir = state.sortKey === k ? -state.sortDir : (k === 'date' ? 1 : -1); state.sortKey = k; renderTable();
});
const findItem = id => { for (const c of state.courses) { const it = c.items.find(i => i.id === id); if (it) return [c, it]; } return [null, null]; };
$('rows').addEventListener('change', e => {
  const el = e.target, tr = el.closest('tr'); if (!tr || !el.dataset.k) return;
  const [, it] = findItem(tr.dataset.id); if (!it) return;
  const k = el.dataset.k;
  if (k === 'sync') it.sync = el.checked;
  else if (k === 'weight' || k === 'hours') it[k] = Math.max(0, +el.value || 0);
  else if (k === 'date') { if (!el.value) { el.value = it.date; return; } it.date = el.value; }
  else if (k === 'title') it.title = el.value.trim() || it.title;
  else it[k] = el.value;
  if (k !== 'sync') it.conf = 99;
  if (k === 'date' || k === 'type') { renderFilters(); renderTable(); }
  else if (k !== 'sync') { const c = tr.querySelector('.conf'); c.className = 'conf'; c.innerHTML = `<span class="bar"><i style="width:99%"></i></span>99%`; c.title = 'Confirmed by you'; }
  renderDerived(); markDirty();
});
$('rows').addEventListener('click', e => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  const [c, it] = findItem(b.dataset.del); if (!it) return;
  c.items = c.items.filter(i => i !== it);
  renderFilters(); renderTable(); renderDerived(); markDirty();
  toast(`Removed “${it.title}”`);
});
$('addRow').onclick = () => {
  let c = state.view !== 'all' ? courseById(state.view) : editCourse();
  if (!c) { toast('Add a course first'); return; }
  const it = { id: c.id + '-u' + uid(), cid: c.id, line: -1, title: 'New deliverable', notes: '', type: 'Homework', date: iso(addDays(TODAY, 7)), time: '23:59', weight: 0, hours: 3, conf: 99, sync: true };
  c.items.push(it); state.freshIds = new Set([it.id]); state.filter = 'All';
  renderFilters(); renderTable(); renderDerived(); markDirty();
  const inp = $('title-' + it.id); if (inp) { inp.focus(); inp.select(); }
};
$('gradeCourse').addEventListener('change', e => { state.gradeId = e.target.value; renderGrading(); });
$('whatifRange').addEventListener('input', renderWhatIf);

$('connectBtn').onclick = async () => {
  if (state.connected) {
    state.connected = false; state.synced = null; state.lastSync = null;
    $('acct').classList.remove('on'); $('acctName').textContent = 'Not connected'; $('acctSub').textContent = 'Connect to push deliverables as events';
    $('connectBtn').textContent = 'Connect'; $('connectBtn').classList.add('primary'); $('progress').style.width = '0%';
    renderSync(); return;
  }
  $('connectBtn').disabled = true; $('connectBtn').textContent = 'Authorizing…';
  await wait(900);
  state.connected = true;
  $('acct').classList.add('on'); $('acctName').textContent = 'Demo student account'; $('acctSub').textContent = 'Simulated connection · calendar.events scope';
  $('connectBtn').disabled = false; $('connectBtn').textContent = 'Disconnect'; $('connectBtn').classList.remove('primary');
  toast('Connected (simulated)');
  renderSync();
};
$('syncBtn').onclick = doSync;
$('reminders').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); renderSync(); });
['studyBlocks', 'skipPast', 'perCourse'].forEach(id => $(id).addEventListener('change', renderSync));
$('calName').addEventListener('input', renderSync);
$('copyIcs').onclick = () => {
  const txt = $('ics').textContent;
  const fallback = () => { const r = document.createRange(); r.selectNodeContents($('ics')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Selected. Press Ctrl/⌘+C to copy'); };
  try { navigator.clipboard.writeText(txt).then(() => toast('Copied .ics text'), fallback); } catch (_) { fallback(); }
};

/* ---------- Theme toggle ---------- */
const root = document.documentElement;
const SUN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M3.05 12.95l1.13-1.13M11.82 4.18l1.13-1.13"/></svg>';
const MOON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3z"/></svg>';
const currentTheme = () => {
  const t = root.getAttribute('data-theme');
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};
function paintThemeBtn() {
  const dark = currentTheme() === 'dark';
  $('themeBtn').innerHTML = dark ? SUN : MOON;
  $('themeBtn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  $('themeBtn').title = dark ? 'Light mode' : 'Dark mode';
}
function setTheme(t, save) {
  root.setAttribute('data-theme', t);
  if (save) { try { localStorage.setItem('ssync-theme', t); } catch (_) {} }
  paintThemeBtn();
}
try { const saved = localStorage.getItem('ssync-theme'); if (saved === 'light' || saved === 'dark') setTheme(saved, false); } catch (_) {}
paintThemeBtn();
$('themeBtn').onclick = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeBtn);

/* ---------- Boot: sample courses render at once; saved ones replace them when the store answers ---------- */
for (const text of SAMPLES) { const c = addCourse(text); applyResult(c, parseLocal(text, c.id), 'local'); }
state.freshIds = new Set();
state.editId = state.courses[0].id; state.gradeId = state.editId;
runParse(false);
setParser('local');
initStore();
initAi();
})();
