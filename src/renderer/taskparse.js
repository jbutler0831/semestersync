// Reads a task typed in plain English ("Biology paper due Friday, 5 pages") into fields to review.
// Runs entirely on the device: no network, no API key. Used by the Inbox, the Quick Add window and the tests.
// Anything uncertain is returned as choices or an issue, never silently filled in.
(function (root) {
  const DAY = 86400000;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sod = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const monday = d => add(d, -((d.getDay() + 6) % 7));
  const label = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
  const WD = 'sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?';
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const MO = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
  const NUMS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const num = w => NUMS[w] != null ? NUMS[w] : +w;
  // Effort when nothing better is known, in hours (matches the syllabus parser's estimates).
  const BASE = { Exam: 8, Quiz: 2, Lab: 5, Project: 5, Paper: 6, Reading: 1.5, Homework: 3, Study: 1, Other: 2 };
  // Subject words a student might type, and course-code prefixes they usually mean.
  const SUBJECTS = {
    biology: ['BIO', 'BIOL', 'BSC', 'BIOS'], bio: ['BIO', 'BIOL'], chemistry: ['CHEM', 'CHM'], chem: ['CHEM', 'CHM'], physics: ['PHYS', 'PHY'],
    calculus: ['MATH', 'MAT', 'MTH', 'CALC'], calc: ['MATH', 'MAT', 'MTH', 'CALC'], math: ['MATH', 'MAT', 'MTH'], algebra: ['MATH', 'MAT', 'MTH'], statistics: ['STAT', 'STA', 'STATS'], stats: ['STAT', 'STA'],
    history: ['HIST', 'HIS', 'HST'], psychology: ['PSYC', 'PSY'], psych: ['PSYC', 'PSY'], economics: ['ECON', 'ECO'], econ: ['ECON', 'ECO'],
    english: ['ENG', 'ENGL'], writing: ['ENG', 'ENGL', 'WRIT', 'WRT'], literature: ['ENG', 'ENGL', 'LIT'], sociology: ['SOC', 'SOCI'], philosophy: ['PHIL', 'PHI'],
    programming: ['CS', 'CSC', 'CSCI', 'COMP', 'CMSC', 'CIS'], 'computer science': ['CS', 'CSC', 'CSCI', 'COMP', 'CMSC'], spanish: ['SPAN', 'SPA'], french: ['FREN', 'FRE'], art: ['ART', 'ARTH'], music: ['MUS', 'MUSC'],
    'political science': ['POLS', 'PSCI', 'POL'], government: ['GOVT', 'POLS', 'GOV'], anthropology: ['ANTH', 'ANT'], geology: ['GEOL', 'GEO'], nursing: ['NURS', 'NUR'], accounting: ['ACCT', 'ACC'], business: ['BUS', 'BUSN', 'MGMT'],
  };
  const TITLE_STOP = new Set(['introduction', 'intro', 'principles', 'general', 'fundamentals', 'topics', 'advanced', 'intermediate', 'course', 'and', 'the', 'of', 'to', 'for', 'in', 'with', 'i', 'ii', 'iii']);

  // Month/day order for numeric dates like 3/4, from the computer's locale (US: month first).
  function localDateOrder() {
    try {
      const parts = new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric' }).formatToParts(new Date(2026, 10, 22));
      return parts.findIndex(p => p.type === 'day') < parts.findIndex(p => p.type === 'month') ? 'DM' : 'MD';
    } catch (_) { return 'MD'; }
  }

  function matchCourses(text, courses) {
    const low = ' ' + text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
    const scored = [];
    let subjectWord = null;
    for (const [word, prefixes] of Object.entries(SUBJECTS)) if (low.includes(' ' + word + ' ')) { subjectWord = subjectWord && subjectWord.length > word.length ? subjectWord : word; }
    for (const c of courses) {
      const code = String(c.code || '').toUpperCase(), m = code.match(/^([A-Z]{2,5})\s*-?\s*(\d{2,4}[A-Z]?)?/);
      let score = 0;
      if (m) {
        const pre = m[1].toLowerCase(), nb = (m[2] || '').toLowerCase();
        if (nb && (low.includes(` ${pre} ${nb} `) || low.includes(` ${pre}${nb} `))) score = 3;
        else if (low.includes(` ${pre} `) && pre.length >= 2 && !['in', 'on', 'at', 'to', 'by', 'or', 'an', 'as', 'is', 'it'].includes(pre)) score = 2;
        if (!score && subjectWord && SUBJECTS[subjectWord].includes(m[1])) score = 2;
      }
      if (!score) {
        const words = String(c.title || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3 && !TITLE_STOP.has(w));
        if (words.some(w => low.includes(' ' + w + ' '))) score = 2;
      }
      if (score) scored.push([c, score]);
    }
    const top = Math.max(0, ...scored.map(s => s[1]));
    const best = scored.filter(s => s[1] === top).map(s => s[0]);
    return { best, subjectWord };
  }

  function parseTask(input, opts = {}) {
    const now = opts.now ? new Date(opts.now) : new Date();
    const today = sod(now);
    const courses = Array.isArray(opts.courses) ? opts.courses : [];
    const order = opts.dateOrder || localDateOrder();
    const text = String(input || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    let rest = ' ' + text + ' ';
    const out = { input: text, title: '', cid: null, courseChoices: [], courseNote: '', date: null, dateChoices: [], dateNote: '', time: null, type: 'Other', hours: null, hoursFrom: null, notes: '', prio: 'normal', issues: [] };
    const take = re => { const m = rest.match(re); if (m) rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length); return m; };
    const notes = [];

    // Priority
    if (take(/\s(?:urgent|asap|important|high[- ]priority)\b|!+(?=\s*$)/i)) out.prio = 'high';
    else if (take(/\s(?:low[- ]priority|someday|whenever)\b/i)) out.prio = 'low';

    // Effort: "for 45 minutes", "2 hours", "1h30", "half an hour"
    let m = take(/\s(?:for\s+)?(?:about\s+|~)?(\d+)\s*h(?:ours?|rs?)?\s*(?:and\s*)?(\d+)\s*m(?:in(?:ute)?s?)?\b/i);
    if (m) { out.hours = +m[1] + +m[2] / 60; out.hoursFrom = 'input'; }
    if (!m && (m = take(/\s(?:for\s+)?(?:about\s+|~)?half an? hour\b/i))) { out.hours = 0.5; out.hoursFrom = 'input'; }
    if (!m && (m = take(/\s(?:for\s+)?(?:about\s+|~)?(\d+(?:\.\d+)?|an?|one|two|three|four|five|six)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i))) {
      const n = num(m[1].toLowerCase()); out.hours = /^h/i.test(m[2]) ? n : n / 60; out.hoursFrom = 'input';
    }

    // Length: "5 pages", "1,500 words"
    let pages = null, words = null;
    if ((m = take(/\s(\d+)\s*-?\s*(?:pages?|pgs?|pp)\b/i))) { pages = +m[1]; notes.push(`${pages} page${pages === 1 ? '' : 's'}`); }
    if ((m = take(/\s(\d{1,2},?\d{3}|\d{2,4})\s*-?\s*words?\b/i))) { words = +m[1].replace(',', ''); notes.push(`${words.toLocaleString('en-US')} words`); }

    // Time of day
    if ((m = take(/\s(?:at|by|@|before)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\W)/i))) out.time = `${pad(+m[1] % 12 + (/p/i.test(m[3]) ? 12 : 0))}:${m[2] || '00'}`;
    else if ((m = take(/\s(?:at|by|@|before)\s+([01]?\d|2[0-3]):([0-5]\d)\b/i))) out.time = `${pad(+m[1])}:${m[2]}`;
    else if (take(/\s(?:at|by)?\s*noon\b/i)) out.time = '12:00';
    else if (take(/\s(?:at|by)?\s*(?:midnight|end of (?:the )?day|eod)\b/i)) out.time = '23:59';

    // Dates
    const pick = (d, why) => { out.date = iso(d); if (why) out.dateNote = why; };
    const choose = (list, why) => { out.dateChoices = list.map(d => ({ date: iso(d), label: label(d) })); out.dateNote = why; };
    const nextWeekday = (wd, includeToday) => { const k = (wd - today.getDay() + 7) % 7; return add(today, k === 0 && !includeToday ? 7 : k); };
    if ((m = take(/\s(?:due\s+)?(?:on\s+)?(?:the\s+)?day after tomorrow\b/i))) pick(add(today, 2));
    else if ((m = take(/\s(?:due\s+)?(today|tonight|tonite|tomorrow|tmrw|tmr)\b/i))) {
      pick(/^to(day|night|nite)/i.test(m[1]) ? today : add(today, 1));
      if (/night|nite/i.test(m[1]) && !out.time) out.time = '23:59';
    } else if ((m = take(/\s(?:due\s+)?in\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?)\b/i))) {
      pick(add(today, num(m[1].toLowerCase()) * (/^w/i.test(m[2]) ? 7 : 1)));
    } else if ((m = take(/\s(?:due\s+)?(?:by\s+)?(?:the\s+)?(?:end of (?:the )?week|this week)\b/i))) {
      const fri = add(monday(today), 4);
      if (fri >= today) pick(fri, 'End of this week (Friday)'); else choose([add(fri, 7)], '“This week” has already ended. Is it next Friday?');
    } else if ((m = take(/\s(?:due\s+)?(?:by\s+)?next week\b/i))) {
      const mon = add(monday(today), 7);
      choose([mon, add(mon, 4)], '“Next week” doesn’t say which day. Pick one, or set the date yourself.');
    } else if ((m = take(/\s(?:due\s+)?(?:(?:by|on)\s+)?(?:this\s+)?weekend\b/i))) {
      const sat = nextWeekday(6, true); choose([sat, add(sat, 1)], 'Which day of the weekend?');
    } else if ((m = take(new RegExp(`\\s(?:due\\s+)?(?:(?:by|on)\\s+)?(next|this|coming)?\\s*(${WD})\\b`, 'i')))) {
      const wd = WEEKDAYS[m[2].toLowerCase()], which = (m[1] || '').toLowerCase();
      const coming = nextWeekday(wd, false);
      if (which === 'this') pick(nextWeekday(wd, true));
      else if (which === 'next') {
        // "next Tuesday": clear when the coming Tuesday is already in next week; otherwise people mean either.
        if (+monday(coming) > +monday(today)) pick(coming);
        else choose([coming, add(coming, 7)], `“Next ${m[2]}” could mean ${label(coming)} or ${label(add(coming, 7))}.`);
      } else if (today.getDay() === wd) choose([today, add(today, 7)], `Today is ${m[2]}. Did you mean today or next week?`);
      else pick(coming);
    } else if ((m = take(new RegExp(`\\s(?:due\\s+)?(?:on\\s+)?(${MO})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d\\d))?\\b`, 'i')) || take(new RegExp(`\\s(?:due\\s+)?(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MO})\\.?(?:,?\\s+(20\\d\\d))?\\b`, 'i')))) {
      const monthFirst = isNaN(+m[1]);
      const mo = MONTHS[(monthFirst ? m[1] : m[2]).slice(0, 3).toLowerCase()];
      const dd = +(monthFirst ? m[2] : m[1]);
      resolveDayMonth(mo, dd, m[3] ? +m[3] : null);
    } else if ((m = take(/\s(?:due\s+)?(?:on\s+)?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?=\W)/))) {
      const a = +m[1], b = +m[2], mo = (order === 'DM' ? b : a) - 1, dd = order === 'DM' ? a : b;
      let y = m[3] ? +m[3] : null; if (y != null && y < 100) y += 2000;
      if (mo < 0 || mo > 11 || dd < 1 || dd > 31) out.issues.push(`“${m[0].trim()}” isn’t a date I can read.`);
      else resolveDayMonth(mo, dd, y);
    } else if ((m = take(/\s(?:due\s+)?on\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b/i))) {
      const dd = +m[1]; let d = new Date(today.getFullYear(), today.getMonth(), dd);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, dd);
      if (d.getDate() !== dd) out.issues.push(`There’s no ${m[1]} that month.`); else pick(d);
    }
    function resolveDayMonth(mo, dd, y) {
      if (y != null) { const d = new Date(y, mo, dd); if (d.getMonth() !== mo) { out.issues.push('That date doesn’t exist.'); return; } pick(d); if (d < today) out.dateNote = 'That date has already passed.'; return; }
      const d = new Date(today.getFullYear(), mo, dd);
      if (d.getMonth() !== mo) { out.issues.push('That date doesn’t exist.'); return; }
      if (d >= today) { pick(d); return; }
      const nextYear = new Date(today.getFullYear() + 1, mo, dd);
      if ((today - d) / DAY > 60) pick(nextYear, `${label(nextYear)}, next year`);
      else choose([d, nextYear], `${label(d)} has already passed. Did you mean it, or next year?`);
    }
    if (!out.date && !out.dateChoices.length && /\bdue\b/i.test(text) && !out.issues.length) out.issues.push('It says “due” but no date I could read. Set the date below.');

    // Type, from the words used. A leading "study"/"review" makes it a study session even if it mentions an exam.
    const low = text.toLowerCase();
    const TYPES = [['Exam', /\b(midterm|final exam|exam|test)\b/], ['Quiz', /\bquiz(zes)?\b/], ['Lab', /\blab\b/], ['Project', /\b(project|presentation|proposal|poster|portfolio|research)\b/],
      ['Paper', /\b(paper|essay|report|memo|thesis|draft|write[- ]?up)\b/], ['Reading', /\b(read(ing)?|chapters?|ch\.)\b/], ['Homework', /\b(homework|hw|problem set|pset|assignment|worksheet|exercises?|discussion post)\b/],
      ['Study', /\b(study|review|practice|revise|prep(are)?|flashcards)\b/]];
    if (/^(study|review|practice|revise|prep(are)?|go over)\b/.test(low)) out.type = 'Study';
    else for (const [t, re] of TYPES) if (re.test(low)) { out.type = t; break; }

    // Course: only one the student already has. Ties and unknown subjects are left for them to pick.
    const cm = matchCourses(text, courses);
    if (cm.best.length === 1) out.cid = cm.best[0].id;
    else if (cm.best.length > 1) { out.courseChoices = cm.best.map(c => c.id); out.courseNote = `More than one course matches. Pick ${cm.best.map(c => c.code).join(' or ')}.`; }
    else if (cm.subjectWord) out.courseNote = `You don’t have a course matching “${cm.subjectWord}”. Pick one, or leave it unassigned.`;

    // Effort: what was typed, else from the length, else a typical amount for the type.
    if (out.hours == null) {
      if (pages && (out.type === 'Paper' || out.type === 'Other' || out.type === 'Homework')) { out.hours = Math.min(20, Math.max(1, pages)); out.hoursFrom = 'pages'; }
      else if (pages && out.type === 'Reading') { out.hours = Math.max(0.5, Math.round(pages / 15 * 2) / 2); out.hoursFrom = 'pages'; }
      else if (words) { out.hours = Math.min(20, Math.max(1, Math.round(words / 400 * 2) / 2)); out.hoursFrom = 'pages'; }
      else { out.hours = BASE[out.type] || 2; out.hoursFrom = 'type'; }
    }
    out.hours = Math.round(out.hours * 100) / 100;

    // Title: what's left after dates, times and amounts, minus dangling connector words.
    let title = rest.replace(/\s(?:due|by|on|at|for|in|before)(?=\s*(?:[,;.]|$))/gi, ' ').replace(/[,;]+\s*(?=[,;]|$)/g, ' ')
      .replace(/\s+/g, ' ').replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, '').replace(/\s+(due|by|on|for)$/i, '').replace(/^(due|by|on)\s+/i, '');
    title = title.replace(/\s*,\s*,/g, ',').trim();
    out.title = title ? title[0].toUpperCase() + title.slice(1) : '';
    if (!out.title) out.issues.push('Add a short title.');
    out.notes = notes.join(' · ');
    if (!out.date && !out.dateChoices.length) out.issues.push('No due date yet. Add one now, or save it to fill in later.');
    else if (out.dateChoices.length) out.issues.push('Pick which date you meant.');
    if (out.courseChoices.length || out.courseNote) out.issues.push(out.courseNote);
    return out;
  }

  const api = { parseTask, localDateOrder, matchCourses };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SSTaskParse = api;
})(typeof self !== 'undefined' ? self : this);
