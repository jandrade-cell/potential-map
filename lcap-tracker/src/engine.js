// ============================================================
// LCAP TRACKER ENGINE
// Pure data logic: value parsing, metric inference, the timeline
// model, status rules, templated insights, and priority summaries.
// No DOM access, so it can be tested under Node.
// ============================================================
(function (root) {
'use strict';

// ------------------------------------------------------------
// LCFF reference data
// ------------------------------------------------------------
const PRIORITY_NAMES = {
  1: 'Basic Services', 2: 'Implementation of State Standards', 3: 'Parental Involvement',
  4: 'Pupil Achievement', 5: 'Pupil Engagement', 6: 'School Climate',
  7: 'Course Access', 8: 'Other Pupil Outcomes'
};

// The 28 metrics a school district LCAP must address.
const REQUIRED = [
  ['1A', 'Local', 'Appropriately assigned / credentialed teachers'],
  ['1B', 'Local', 'Access to standards-aligned instructional materials'],
  ['1C', 'Local', 'Facilities maintained in good repair'],
  ['2A', 'Local', 'Implementation of state academic standards'],
  ['2B', 'Local', 'EL access to state standards and ELD standards'],
  ['3A', 'Local', 'Parent input in decision-making'],
  ['3B', 'Local', 'Parent participation: unduplicated students'],
  ['3C', 'Local', 'Parent participation: students with disabilities'],
  ['4A', 'State', 'Statewide assessments (ELA, Math, Science)'],
  ['4B', 'State', 'UC/CSU A–G completion'],
  ['4C', 'State', 'CTE pathway completion'],
  ['4D', 'State', 'Completion of both A–G and CTE'],
  ['4E', 'State', 'EL progress toward English proficiency (ELPI)'],
  ['4F', 'State', 'EL reclassification rate'],
  ['4G', 'State', 'AP exam passage (3+)'],
  ['4H', 'State', 'College preparedness (EAP)'],
  ['5A', 'State', 'School attendance rate'],
  ['5B', 'State', 'Chronic absenteeism rate'],
  ['5C', 'State', 'Middle school dropout rate'],
  ['5D', 'State', 'High school dropout rate'],
  ['5E', 'State', 'High school graduation rate'],
  ['6A', 'State', 'Suspension rate'],
  ['6B', 'State', 'Expulsion rate'],
  ['6C', 'Local', 'School climate survey: safety & connectedness'],
  ['7A', 'Local', 'Access to a broad course of study'],
  ['7B', 'Local', 'Programs/services for unduplicated students'],
  ['7C', 'Local', 'Programs/services for students with disabilities'],
  ['8A', 'State', 'Other pupil outcomes'],
].map(([code, type, name]) => ({ code, type, name, priority: +code[0] }));
const REQUIRED_BY_CODE = Object.fromEntries(REQUIRED.map(r => [r.code, r]));

// Keyword rules win over the LCAP's own "4d"-style labels, which districts
// sometimes number differently from the statute. First match wins.
const KEYWORD_RULES = [
  [/both\s+a[\s–-]*g.*cte|a[\s–-]*g\b.*\b(and|&)\b.*\b(cte|career technical)/i, ['4D']],
  [/\bcte\b|career technical/i, ['4C']],
  [/\ba[\s–-]*g\b|uc\/csu/i, ['4B']],
  [/\bEAP\b|early assessment/i, ['4H']],
  [/\bAP\b|advanced placement/i, ['4G']],
  [/reclassif/i, ['4F']],
  [/\bELPI\b|progress toward english|english (learner )?proficiency|making progress/i, ['4E']],
  [/\bEL\b.*standards|ELD standards|EL standards/i, ['2B']],
  [/chronic/i, ['5B']],
  [/middle school dropout/i, ['5C']],
  [/high school dropout/i, ['5D']],
  [/graduation/i, ['5E']],
  [/attendance rate|school attendance|\bADA\b/i, ['5A']],
  [/suspension/i, ['6A']],
  [/expulsion/i, ['6B']],
  [/climate|connectedness|sense of safety|safety and/i, ['6C']],
  [/broad course/i, ['7A', '7B', '7C']],
  [/credential|misassign|teacher assignment/i, ['1A']],
  [/instructional materials/i, ['1B']],
  [/facilit|good repair|\bFIT\b/i, ['1C']],
  [/parent|family engagement|famil/i, ['3A', '3B', '3C']],
  [/implementation of (the )?(state )?(academic )?standards|standards implementation/i, ['2A']],
  [/\bCCI\b|college\/career|college and career indicator/i, ['8A']],
  [/NWEA|\bMAP\b|mCLASS|DIBELS|iReady|i-Ready|STAR|local assessment|other pupil outcome/i, ['8A']],
  [/CAASPP|SBAC|statewide assessment|\bCAST\b|distance from standard|\bELA\b|\bmath/i, ['4A']],
  [/dropout/i, ['5D']],
];

const DOWN_IS_GOOD = /chronic|absentee|suspension|expulsion|dropout|misassign|vacanc|long[\s-]term english|LTEL|referral|tardy|truan|fail/i;

const GROUP_NAMES = {
  ALL: 'All students', AA: 'African American', AI: 'American Indian', AS: 'Asian', FI: 'Filipino',
  HI: 'Hispanic', PI: 'Pacific Islander', WH: 'White', MR: 'Two or more races', EL: 'English learners',
  ELO: 'English learners only', RFP: 'Reclassified fluent', EO: 'English only', LTEL: 'Long-term English learners',
  SED: 'Socioeconomically disadvantaged', SWD: 'Students with disabilities', FOS: 'Foster youth', HOM: 'Homeless',
  AR: 'At-risk long-term EL', MIG: 'Migrant'
};
const COLOR_NAMES = { 1: 'Red', 2: 'Orange', 3: 'Yellow', 4: 'Green', 5: 'Blue' };

const STATUS = {
  Priority: 'Below target with little or no progress, or declining',
  Watch: 'Partial or unstable progress',
  Sustain: 'Met or nearly met target; maintain',
  Review: 'Cannot be scored automatically yet'
};

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const norm = s => String(s ?? '').replace(/[‒-―−]/g, '-').replace(/\s+/g, ' ').trim();
const round = (n, d = 1) => (n == null || !isFinite(n)) ? n : Math.round(n * 10 ** d) / 10 ** d;

function fmtValue(v, unit) {
  if (v == null || !isFinite(v)) return '—';
  const r = Math.abs(v) >= 100 ? round(v, 1) : round(v, 2);
  if (unit === '%') return r + '%';
  if (unit === 'pts') return (r > 0 ? '+' : '') + r + ' pts';
  if (unit === 'rating') return r + '/5';
  if (unit === 'fit') return FIT_NAMES[Math.round(v)] || String(r);
  return String(r);
}
function fmtDelta(d, unit) {
  if (d == null || !isFinite(d)) return '—';
  const r = round(d, 2);
  const s = (r > 0 ? '+' : '') + r;
  if (unit === '%') return s + ' percentage points';
  if (unit === 'pts') return s + ' points';
  return s;
}

// ------------------------------------------------------------
// Periods: turn "2023–24", "Fall 2025", "Dashboard 2024" into a sortable number.
// ------------------------------------------------------------
const TERM_OFFSET = { fall: 0.8, boy: 0.75, winter: 0.1, moy: 0.1, spring: 0.4, eoy: 0.45, summer: 0.55 };

function periodOrder(label) {
  const s = norm(label).toLowerCase();
  let m = s.match(/(20\d\d)\s*-\s*(20)?(\d\d)\b/);           // school year 2023-24 / 2023-2024
  const term = Object.keys(TERM_OFFSET).find(t => new RegExp('\\b' + t + '\\b').test(s));
  if (m) {
    const start = +m[1];
    if (term) return (['fall', 'boy'].includes(term) ? start : start + 1) + TERM_OFFSET[term];
    return start + 1 + 0.45;                                   // end of that school year
  }
  m = s.match(/\b(20\d\d)\b/);
  if (m) return +m[1] + (term ? TERM_OFFSET[term] : 0.5);
  return null;
}

// Leading "2023:" / "2024–25:" / "Winter 2024:" labels on an LCAP cell.
function leadingPeriod(text) {
  const m = norm(text).match(/^((?:(?:fall|winter|spring|boy|moy|eoy)\s+)?20\d\d(?:\s*-\s*(?:20)?\d\d)?)\s*(?:[a-z ]{0,12})?:/i);
  return m ? m[1] : null;
}

// ------------------------------------------------------------
// Value parsing from LCAP prose.
// ------------------------------------------------------------
const NUM = '(-?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?)';
const FIT = { exemplary: 4, good: 3, fair: 2, poor: 1 };
const FIT_NAMES = { 4: 'Exemplary', 3: 'Good', 2: 'Fair', 1: 'Poor' };
const toNum = s => parseFloat(String(s).replace(/,/g, ''));

function parseValue(text, hint = {}) {
  const raw = norm(text);
  const out = { value: null, unit: hint.unit || null, period: leadingPeriod(raw) };
  if (!raw) return out;
  if (/not (offer|applicable|available)|^n\/?a$|no data|not reported/i.test(raw)) return out;
  let s = raw;
  if (out.period) s = s.slice(s.indexOf(':') + 1);            // drop the year label
  // Prefer an explicitly labeled district / all-students figure.
  const lab = s.match(new RegExp('(?:district(?:wide)?|all students|LEA|overall)\\s*(?:[:=-]|rate|average)?\\s*' + NUM + '\\s*(%|points?)?', 'i'));
  // Distance from standard.
  const dfs = s.match(new RegExp(NUM + '\\s*(?:points?\\s*)?(below|above)\\b(?!\\s*(?:the\\s*)?(?:target|baseline|average|state))', 'i'));
  if (dfs && (!lab || hint.unit === 'pts')) {
    const n = toNum(dfs[1]);
    return { ...out, value: /below/i.test(dfs[2]) ? -Math.abs(n) : Math.abs(n), unit: 'pts' };
  }
  if (lab) {
    return { ...out, value: toNum(lab[1]), unit: lab[2] === '%' ? '%' : (lab[2] ? 'pts' : out.unit) };
  }
  const fit = s.match(/\b(exemplary|good repair|good|fair|poor)\b/i);
  if (fit && !/\d/.test(s)) return { ...out, value: FIT[fit[1].toLowerCase().replace(' repair', '')], unit: 'fit' };
  const rating = s.match(/\b([0-5](?:\.\d)?)\s*\/\s*5\b/);
  const pct = s.match(new RegExp(NUM + '\\s*%'));
  if (pct && (!rating || s.indexOf(pct[0]) < s.indexOf(rating[0]) || hint.unit === '%')) {
    return { ...out, value: toNum(pct[1]), unit: '%' };
  }
  if (rating) return { ...out, value: +rating[1], unit: 'rating' };
  // Any other number that is not a year or a grade span.
  const cleaned = s.replace(/\b20\d\d(\s*-\s*(20)?\d\d)?\b/g, ' ').replace(/grades?\s*\d+\s*-\s*\d+/gi, ' ');
  const n = cleaned.match(new RegExp(NUM));
  if (n) return { ...out, value: toNum(n[1]) };
  return out;
}

function parseTarget(text, hint = {}) {
  const raw = norm(text);
  const maintain = /^maintain|maintain (the )?(status|rate|at)|remain at/i.test(raw);
  const v = parseValue(raw, hint);
  return { value: v.value, unit: v.unit, maintain };
}

// ------------------------------------------------------------
// Metric inference
// ------------------------------------------------------------
function inferCodes(name, extra = '') {
  const t = norm(name + ' ' + extra);
  for (const [re, codes] of KEYWORD_RULES) if (re.test(t)) return codes.slice();
  // Fall back to the LCAP's own label: "4a", "3a.b.c", "7a, b, c", "Priority 5".
  const m = norm(name).match(/\b([1-8])([a-h])((?:\s*[.,&/]\s*[a-h]\b)*)/i);
  if (m) {
    const letters = [m[2], ...(m[3].match(/[a-h]/gi) || [])];
    return letters.map(l => m[1] + l.toUpperCase()).filter(c => REQUIRED_BY_CODE[c]);
  }
  const p = norm(name).match(/priority\s*([1-8])/i);
  if (p) return REQUIRED.filter(r => r.priority === +p[1]).slice(0, 1).map(r => r.code);
  return [];
}

function inferDirection(name, baseline, target, maintainHint) {
  if (baseline != null && target != null) {
    if (Math.abs(target - baseline) < 1e-9) return 'maintain';
    return target > baseline ? 'up' : 'down';
  }
  if (maintainHint) return 'maintain';
  return DOWN_IS_GOOD.test(name) ? 'down' : 'up';
}

// ------------------------------------------------------------
// Model
// ------------------------------------------------------------
function newDistrict(name = 'New district', cycleStart = null) {
  return {
    schema: 1, id: uid(), name, cycleStart, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), metrics: [], notes: {}, imports: [], ai: { summary: null }
  };
}

function makeMetric({ goal = '', metricNo = '', name = '', codes = null, unit = null, direction = null,
                      targetText = '', targetValue, lcapText = {} } = {}) {
  return {
    id: uid(), goal: String(goal || ''), metricNo: String(metricNo || ''), name: norm(name),
    codes: codes || inferCodes(name), unit, direction, targetText: norm(targetText),
    targetValue: targetValue ?? null, primaryGroup: 'ALL', lcapText, points: [], ai: null
  };
}

function addPoint(metric, p) {
  const point = {
    id: uid(), period: norm(p.period) || 'Undated', order: p.order ?? periodOrder(p.period),
    value: (p.value === '' || p.value == null || !isFinite(p.value)) ? null : +p.value,
    text: norm(p.text || ''), group: p.group || 'ALL', role: p.role || null, color: p.color || null,
    source: p.source || 'Manual', addedAt: new Date().toISOString()
  };
  // Same period + group + source replaces the older reading (re-uploads don't duplicate).
  const i = metric.points.findIndex(q => q.period === point.period && q.group === point.group && q.source === point.source);
  if (i >= 0) { point.id = metric.points[i].id; metric.points[i] = point; return { point, replaced: true }; }
  metric.points.push(point);
  return { point, replaced: false };
}

// Build metrics from rows extracted from an LCAP (PDF, AI, or the example file).
// Existing metrics with the same number and a similar name get the new
// outcome columns merged in, so importing next year's LCAP extends history.
function importLcapRows(district, rows, { cycleStart, sourceLabel = 'LCAP' } = {}) {
  const start = cycleStart || district.cycleStart || new Date().getFullYear();
  district.cycleStart = district.cycleStart || start;
  const roles = [['baseline', 'Baseline', -1], ['y1', 'Year 1', 0], ['y2', 'Year 2', 1], ['y3', 'Year 3', 2]];
  const summary = { added: 0, updated: 0, points: 0 };
  for (const r of rows) {
    const name = norm(r.metric || r.name);
    if (!name && !r.metricNo) continue;
    let m = district.metrics.find(x => x.metricNo && x.metricNo === String(r.metricNo) && similar(x.name, name));
    const baseParsed = parseValue(r.baseline);
    const tgt = parseTarget(r.target, { unit: baseParsed.unit });
    if (!m) {
      m = makeMetric({ goal: r.goal || String(r.metricNo || '').split('.')[0], metricNo: r.metricNo, name,
        targetText: r.target, targetValue: tgt.value, codes: r.codes && r.codes.length ? r.codes : null });
      district.metrics.push(m); summary.added++;
    } else {
      summary.updated++;
      if (r.target) { m.targetText = norm(r.target); m.targetValue = tgt.value; }
      if (r.codes && r.codes.length) m.codes = r.codes;
    }
    m.lcapText = { baseline: r.baseline, y1: r.y1, y2: r.y2, y3: r.y3, target: r.target, diff: r.diff, page: r.page };
    const unitVotes = [];
    for (const [role, label, off] of roles) {
      const text = norm(r[role]);
      if (!text || /^(n\/?a|—|-|tbd|to be determined)$/i.test(text)) continue;
      const pv = parseValue(text, { unit: baseParsed.unit });
      if (pv.unit) unitVotes.push(pv.unit);
      const yr = start + off;                                     // cycle 2024: baseline ~2023, Y1 ~2024
      addPoint(m, { period: pv.period ? `${label} · ${pv.period}` : label,
        order: (pv.period && periodOrder(pv.period)) ?? (yr + 0.5),
        value: pv.value, text, role, source: sourceLabel });
      summary.points++;
    }
    m.unit = m.unit || mode(unitVotes) || tgt.unit || null;
    const base = m.points.find(p => p.role === 'baseline' && p.group === 'ALL');
    m.direction = m.direction || inferDirection(m.name, base?.value ?? null, m.targetValue, tgt.maintain);
  }
  district.updatedAt = new Date().toISOString();
  return summary;
}

function similar(a, b) {
  const wa = new Set(norm(a).toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const wb = norm(b).toLowerCase().split(/\W+/).filter(w => w.length > 2);
  if (!wa.size || !wb.length) return true;
  return wb.filter(w => wa.has(w)).length / Math.min(wa.size, wb.length) >= 0.5;
}
function mode(arr) {
  const c = {}; let best = null;
  for (const a of arr) { c[a] = (c[a] || 0) + 1; if (!best || c[a] > c[best]) best = a; }
  return best;
}

// ------------------------------------------------------------
// Analysis: the rules that replace a one-time spreadsheet review.
// ------------------------------------------------------------
function series(metric, group) {
  const g = group || metric.primaryGroup || 'ALL';
  return metric.points.filter(p => p.group === g && p.value != null)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function analyze(metric) {
  const s = series(metric);
  const dir = metric.direction || 'up';
  const sign = goodSign(metric);
  const unit = metric.unit;
  const target = metric.targetValue;
  const reasons = [];
  const a = { status: 'Review', reasons, series: s, unit, direction: dir, target, groups: latestByGroup(metric) };

  const naText = Object.values(metric.lcapText || {}).join(' ');
  if (!s.length) {
    reasons.push(/not offer|not applicable/i.test(naText) ? 'Metric is marked not applicable in the LCAP.' : 'No numeric results yet. Add data or set values on the review screen.');
    a.na = /not offer|not applicable/i.test(naText);
    return a;
  }
  const base = s.find(p => p.role === 'baseline') || s[0];
  const after = s.filter(p => (p.order ?? 0) >= (base.order ?? 0));
  const latest = after[after.length - 1];
  const prev = after.length > 1 ? after[after.length - 2] : null;
  Object.assign(a, { baseline: base, latest, prev, points: after.length });
  a.change = latest.value - base.value;
  a.better = a.change * sign;                                    // >0 means improved
  if (after.length < 2) {
    reasons.push('Only one data point so far; status will update as results are added.');
    if (target != null && dir !== 'maintain') {
      a.met = (latest.value - target) * sign >= 0;
      if (a.met) { a.status = 'Sustain'; reasons.push('Already at or beyond the target.'); }
    }
    return a;
  }
  // Peak (best point) and whether the latest point gave back gains.
  const best = after.reduce((b, p) => ((p.value - b.value) * sign > 0 ? p : b), base);
  a.peak = best;
  const peakGain = (best.value - base.value) * sign;
  const lostFromPeak = (best.value - latest.value) * sign;
  a.gaveBack = best !== latest && peakGain > 0 && lostFromPeak >= 0.5 * peakGain;
  a.lastStep = prev ? (latest.value - prev.value) * sign : 0;
  const worst = after.slice(1, -1).reduce((w, p) => ((p.value - w.value) * sign < 0 ? p : w), base);
  a.dipped = worst !== base && (worst.value - base.value) * sign < 0 && a.better >= 0;
  a.dip = a.dipped ? worst : null;
  a.flat = after.every(p => Math.abs(p.value - base.value) < 1e-9);

  const scale = Math.max(Math.abs(target ?? 0), Math.abs(base.value), 1);
  const eps = 0.001 * scale;
  if (target != null) {
    if (dir === 'maintain') {
      a.met = (latest.value - target) * sign >= -(eps + 0.005 * scale);
      a.progress = a.met ? 1 : 0;
    } else {
      const need = (target - base.value) * sign;
      a.met = (latest.value - target) * sign >= -eps;
      a.progress = need > eps ? a.better / need : (a.met ? 1 : 0);
      a.gap = (target - latest.value) * sign;
    }
  }

  // Status rules (see README for the reasoning behind each threshold).
  const redAll = latest.color === 1;
  const redGroups = a.groups.filter(g => g.group !== 'ALL' && g.color === 1);
  if (target == null) {
    a.status = a.better > 0 && !a.gaveBack ? 'Watch' : 'Review';
    reasons.push('No numeric target, so progress is judged on direction only.');
  } else if (a.met || (a.progress != null && a.progress >= 0.9)) {
    if (a.gaveBack) { a.status = 'Watch'; reasons.push(`Target ${a.met ? 'met' : 'nearly met'}, but more than half of the gain at its peak (${best.period}) has been lost.`); }
    else if (a.dipped) { a.status = 'Watch'; reasons.push(`Target ${a.met ? 'met' : 'nearly met'} after a dip below baseline in ${worst.period}; results have been volatile.`); }
    else { a.status = 'Sustain'; reasons.push(a.met ? 'At or beyond the target.' : 'Within 10% of the distance to target.'); }
  } else if (a.better <= 0) {
    a.status = 'Priority';
    reasons.push(a.flat ? 'No movement from baseline.' : 'Latest result is at or below baseline.');
  } else if (a.progress >= 0.5) {
    a.status = 'Watch'; reasons.push(`Improved and ${Math.round(a.progress * 100)}% of the way to target.`);
  } else if (a.lastStep < 0 || a.progress < 0.25) {
    a.status = 'Priority';
    reasons.push(a.lastStep < 0 ? 'Improved over baseline but declined in the latest result, and less than half way to target.'
      : `Only ${Math.round(a.progress * 100)}% of the way to target.`);
  } else {
    a.status = 'Watch'; reasons.push(`Improving (${Math.round(a.progress * 100)}% of the way to target).`);
  }
  if (redAll && a.status !== 'Priority') { a.status = 'Priority'; reasons.push('All students are Red on the Dashboard for this indicator.'); }
  else if (redGroups.length && a.status === 'Sustain') { a.status = 'Watch'; reasons.push(`Student group(s) in Red: ${redGroups.map(g => groupName(g.group)).join(', ')}.`); }
  else if (redGroups.length) reasons.push(`Student group(s) in Red: ${redGroups.map(g => groupName(g.group)).join(', ')}.`);
  return a;
}

function latestByGroup(metric) {
  const by = {};
  for (const p of metric.points) {
    if (p.value == null) continue;
    if (!by[p.group] || (p.order ?? 0) >= (by[p.group].order ?? 0)) by[p.group] = p;
  }
  return Object.entries(by).map(([group, p]) => ({ group, value: p.value, color: p.color, period: p.period }));
}
// +1 when higher is better, -1 when lower is better ("maintain 0% dropout" is lower-is-better).
function goodSign(metric) {
  if (metric.direction === 'down') return -1;
  if (metric.direction === 'up') return 1;
  return DOWN_IS_GOOD.test(metric.name) ? -1 : 1;
}
const groupName = g => GROUP_NAMES[g] || g;

// ------------------------------------------------------------
// Templated insight (used when AI is off, or when AI text is out of date)
// ------------------------------------------------------------
const CONSIDERATIONS = {
  '1A': 'track recruitment, assignment, induction, and retention so vacancies, authorizations, and hard-to-staff subjects can be told apart',
  '1B': 'confirm that newly adopted or supplemental materials stay aligned and reach every student',
  '1C': 'pair the annual rating with timely response to site facility needs so deficiencies surface before they affect learning',
  '2A': 'set a few implementation milestones per content area with observable evidence of professional learning, materials, and classroom use',
  '2B': 'turn access to ELD materials into consistent designated and integrated ELD practice, with evidence of EL access to grade-level content',
  '3A': 'measure a small set of engagement practices consistently and disaggregate participation by family group',
  '3B': 'add a distinct measure of participation or feedback from low-income, EL, and foster youth families',
  '3C': 'pair meeting counts with a participation rate or family-experience measure',
  '4A': 'center student-group needs and use interim measures (NWEA, mCLASS, benchmarks) aligned to the state assessment so progress is visible before annual results',
  '4B': 'analyze course access, successful completion, scheduling, counseling, and credit recovery by student group',
  '4C': 'monitor pathway enrollment, persistence, and completion by student group so access turns into completers',
  '4D': 'check whether schedules and counseling make completing both A–G and a CTE pathway realistic',
  '4E': 'look at which sites and which EL typologies (including long-term ELs) are driving or lagging the result',
  '4F': 'pair reclassification with post-reclassification monitoring so RFEP students keep academic access and success',
  '4G': 'document non-applicability and use dual enrollment, CTE, and A–G to show access to advanced coursework',
  '4H': 'use course-level analysis to see where students lose readiness between coursework and grade 11 results',
  '5A': 'report attendance at a consistent level (district or site) and by student group',
  '5B': 'disaggregate by student group and site to see who remains chronically absent',
  '5C': 'watch early-warning signals (attendance, course failure, engagement) to catch risk early',
  '5D': 'track individual early-warning factors and cohort context to explain year-to-year swings',
  '5E': 'monitor credit accumulation and graduation status before senior year',
  '6A': 'disaggregate by student group so a low overall rate does not hide disproportionality',
  '6B': 'keep monitoring exclusionary discipline and alternatives to removal',
  '6C': 'check whether gains hold by site and student group, and include parent and staff surveys',
  '7A': 'add enrollment and successful-completion data by student group, since access alone does not show participation',
  '7B': 'add a measure of course or pathway participation for unduplicated students',
  '7C': 'add a course-access or outcome measure for students with disabilities',
  '8A': 'check that local results line up with state results so local growth can be read as readiness',
};

function insight(metric, a) {
  a = a || analyze(metric);
  const u = metric.unit;
  const name = metric.name || 'This metric';
  const code = (metric.codes || [])[0];
  const out = [];
  if (!a.series.length) {
    out.push(a.na ? `${name} is not applicable to the current program, so it shows no progress.`
      : `${name} has no numeric results yet.`);
    out.push(a.na ? 'For the next cycle, continue documenting non-applicability and show related access through other measures.'
      : 'Add the latest results (or correct the parsed LCAP values) to calculate progress.');
    return out.join(' ');
  }
  const b = a.baseline, l = a.latest;
  if (a.points < 2) {
    out.push(`${name} has one result so far: ${fmtValue(l.value, u)} (${l.period}).`);
  } else if (a.flat) {
    out.push(`${name} stayed at ${fmtValue(l.value, u)} across all ${a.points} reporting points.`);
  } else {
    const verb = a.better > 0 ? 'improved' : 'declined';
    out.push(`${name} ${verb} from ${fmtValue(b.value, u)} at baseline to ${fmtValue(l.value, u)} (${l.period}), ${fmtDelta(a.change, u)}.`);
    if (a.gaveBack) out.push(`Much of the gain seen in ${a.peak.period} (${fmtValue(a.peak.value, u)}) was not sustained.`);
    else if (a.dipped) out.push(`Results dipped to ${fmtValue(a.dip.value, u)} in ${a.dip.period} before recovering.`);
    else if (a.points >= 3 && a.series.every((p, i, arr) => i === 0 || (p.value - arr[i - 1].value) * goodSign(metric) >= 0) && a.better > 0)
      out.push('Results improved at every reporting point.');
  }
  if (a.target != null) {
    if (a.met) out.push(`That meets the target of ${fmtValue(a.target, u)}.`);
    else if (a.progress != null && metric.direction !== 'maintain') out.push(`It is ${fmtDelta(Math.abs(a.gap), u).replace(/^\+/, '')} short of the ${fmtValue(a.target, u)} target${a.progress > 0 ? ` (${Math.round(a.progress * 100)}% of the way there)` : ''}.`);
    else if (metric.direction === 'maintain') out.push(`The target is to maintain ${fmtValue(a.target, u)}.`);
  }
  const groups = a.groups.filter(g => g.group !== 'ALL' && g.group !== metric.primaryGroup);
  if (groups.length >= 2) {
    const sign = goodSign(metric);
    const sorted = groups.slice().sort((x, y) => (x.value - y.value) * sign);
    const low = sorted.slice(0, 2);
    const red = groups.filter(g => g.color === 1);
    if (red.length) out.push(`${red.map(g => groupName(g.group)).join(', ')} ${red.length > 1 ? 'were' : 'was'} Red in the latest results.`);
    else out.push(`The lowest-performing groups in the latest results were ${low.map(g => `${groupName(g.group)} (${fmtValue(g.value, u)})`).join(' and ')}.`);
  }
  const consider = CONSIDERATIONS[code];
  const lead = {
    Sustain: 'For the next cycle, treat this as a maintenance measure',
    Watch: 'For the next cycle, find out what drove the movement and add interim checkpoints',
    Priority: 'For the next cycle, this warrants a focused root-cause analysis',
    Review: 'For the next cycle, define a numeric baseline and target'
  }[a.status];
  out.push(consider ? `${lead}; ${consider}.` : `${lead}.`);
  return out.join(' ');
}

// ------------------------------------------------------------
// Priority-level synthesis (the "Next Cycle Summary" sheet, computed)
// ------------------------------------------------------------
const EQUITY_Q = {
  1: 'Which subjects, grades, or student groups are most affected by vacancies, misassignments, or non-full credentials?',
  2: 'Where do English learners experience the largest gap between available materials and enacted grade-level instruction?',
  3: 'Which families participate least often, and what barriers do EL, low-income, foster youth, and SWD families report?',
  4: 'Which instructional, course-taking, and student-group patterns explain the gap between local assessment growth and state outcomes?',
  5: 'Which student groups and attendance patterns are concentrated among chronically absent students and non-graduates?',
  6: 'Are climate and discipline gains shared across student groups, sites, and grade spans?',
  7: 'Who enrolls in and successfully completes CTE, A–G, dual enrollment, and arts courses?',
  8: 'How well do local assessment gains predict state assessment and college/career readiness for each student group?'
};
const DIRECTION = {
  1: 'Separate staffing-capacity measures from basic-services maintenance measures.',
  2: 'Use fewer implementation milestones with observable evidence of classroom practice.',
  3: 'Add disaggregated participation and experience measures tied to specific engagement practices.',
  4: 'Center student-group gaps and use interim measures aligned to state outcomes.',
  5: 'Keep what is working on attendance and add student-group and early-warning measures.',
  6: 'Keep overall measures but add student-group and site views so averages do not hide disparities.',
  7: 'Move from access-only reporting to access, participation, and completion by student group.',
  8: 'Use a coherent outcome set that connects local growth to state and college/career results.'
};

function prioritySummary(district, p) {
  const ms = district.metrics.filter(m => (m.codes || []).some(c => +c[0] === p));
  const rows = ms.map(m => ({ m, a: analyze(m) }));
  const counts = { Priority: 0, Watch: 0, Sustain: 0, Review: 0 };
  rows.forEach(r => counts[r.a.status]++);
  const missing = REQUIRED.filter(r => r.priority === p && !ms.some(m => m.codes.includes(r.code)));
  const scored = rows.filter(r => r.a.progress != null || r.a.met);
  const best = scored.slice().sort((x, y) => ((y.a.met ? 2 : y.a.progress) - (x.a.met ? 2 : x.a.progress)))[0];
  const need = rows.filter(r => r.a.status === 'Priority').sort((x, y) => (x.a.progress ?? -9) - (y.a.progress ?? -9))[0]
    || rows.filter(r => r.a.status === 'Watch')[0];
  const describe = r => {
    const a = r.a, u = r.m.unit;
    if (!a.latest) return r.m.name;
    return `${r.m.name}: ${a.points > 1 ? `${fmtValue(a.baseline.value, u)} → ` : ''}${fmtValue(a.latest.value, u)}${a.target != null ? ` (target ${fmtValue(a.target, u)})` : ''}.`;
  };
  const parts = [];
  if (!ms.length) parts.push('No LCAP metrics are mapped to this priority yet.');
  else {
    const bits = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k.toLowerCase()}`);
    parts.push(`${ms.length} metric${ms.length > 1 ? 's' : ''}: ${bits.join(', ')}.`);
  }
  if (missing.length) parts.push(`Not found in the LCAP: ${missing.map(r => r.code).join(', ')}.`);
  const redGroups = new Set();
  rows.forEach(r => r.a.groups.forEach(g => { if (g.group !== 'ALL' && g.color === 1) redGroups.add(groupName(g.group)); }));
  return {
    priority: p, name: PRIORITY_NAMES[p], counts, metrics: ms, missing,
    pattern: parts.join(' '),
    progress: best && (best.a.better > 0 || best.a.met) ? describe(best) : 'No metric shows measurable progress yet.',
    need: need ? describe(need) : (missing.length ? `Required metric(s) ${missing.map(r => r.code).join(', ')} are not measured.` : 'No metric is flagged as a priority.'),
    equity: redGroups.size ? `${EQUITY_Q[p]} (Red in latest data: ${[...redGroups].join(', ')}.)` : EQUITY_Q[p],
    direction: DIRECTION[p]
  };
}

// ------------------------------------------------------------
// Next-cycle draft: latest result becomes the new baseline, with a
// suggested Year 3 target. Suggestions are starting points for
// educational-partner discussion, never final targets.
// ------------------------------------------------------------
function suggestTarget(m, a, gapPct = 30) {
  const u = m.unit, l = a.latest;
  if (!l) return { value: null, text: 'Set once a baseline is established', basis: 'No numeric result yet.' };
  if (u === 'fit') return { value: 3, text: 'Maintain Good or Exemplary', basis: 'Facilities maintenance measure.' };
  if (m.direction === 'maintain') {
    const v = m.targetValue ?? l.value;
    return { value: v, text: `Maintain ${fmtValue(v, u)}`, basis: 'Maintenance measure in the current LCAP.' };
  }
  const sign = goodSign(m);
  const g = gapPct / 100;
  let v, basis;
  if (u === 'rating') {
    v = Math.min(5, Math.floor(l.value) + 1);
    basis = 'One level higher on the 5-point implementation scale.';
  } else if (u === '%') {
    const ideal = sign > 0 ? 100 : 0;
    v = round(l.value + (ideal - l.value) * g, 1);
    basis = `Closes ${gapPct}% of the gap between the latest result and ${ideal}%.`;
  } else if (u === 'pts') {
    const ideal = l.value < 0 ? 0 : l.value + 30;
    v = round(l.value + (ideal - l.value) * g, 1);
    basis = l.value < 0 ? `Closes ${gapPct}% of the distance to standard.` : `Grows ${round(30 * g, 1)} points above standard.`;
  } else {
    v = round(l.value * (1 + sign * g / 3), 1);
    basis = `Improves the latest result by about ${round(gapPct / 3, 1)}%.`;
  }
  // Name an unmet, more ambitious current target so the team can choose between the two.
  if (m.targetValue != null && !a.met && (m.targetValue - v) * sign > 0) {
    basis += ` The current-cycle target (${fmtValue(m.targetValue, u)}) was not reached; carrying it forward is the more ambitious option.`;
  }
  return { value: v, text: fmtValue(v, u), basis };
}

function nextCycleRows(district, { gapPct = 30 } = {}) {
  const rows = [];
  const byNo = (x, y) => String(x.metricNo).localeCompare(String(y.metricNo), undefined, { numeric: true });
  for (const m of district.metrics.slice().sort(byNo)) {
    const a = analyze(m);
    const s = suggestTarget(m, a, gapPct);
    const flags = [];
    const red = a.groups.filter(g => g.group !== 'ALL' && g.color === 1).map(g => groupName(g.group));
    if (red.length) flags.push(`Red student groups: ${red.join(', ')}; consider group-specific targets.`);
    if (a.latest && a.latest.source === 'LCAP') flags.push('Latest value is from the current LCAP; add newer data first.');
    if (!a.latest) flags.push(a.na ? 'Marked not applicable in the current LCAP.' : 'No numeric result; define how this will be measured.');
    if ((m.codes || []).length > 1) flags.push(`Reports ${m.codes.join(', ')} together; consider a separate measure for each.`);
    if (/;/.test((m.lcapText && m.lcapText.baseline) || '') && (String(m.lcapText.baseline).match(/\d+(\.\d+)?%?/g) || []).length > 2)
      flags.push('Baseline cell combines several values (sites or subjects); consider separate metrics.');
    rows.push({
      id: m.id, codes: m.codes, metricNo: m.metricNo, metric: m.name,
      baseline: a.latest ? `${fmtValue(a.latest.value, m.unit)} (${a.latest.period.replace(/^(Baseline|Year \d) · /, '')})` : ((m.lcapText && m.lcapText.y2) || (m.lcapText && m.lcapText.baseline) || ''),
      target: s.text, targetBasis: s.basis, priorTarget: m.targetText || (m.targetValue != null ? fmtValue(m.targetValue, m.unit) : ''),
      priorStatus: a.status, flags
    });
  }
  for (const r of REQUIRED) {
    if (district.metrics.some(m => (m.codes || []).includes(r.code))) continue;
    rows.push({ id: 'req:' + r.code, codes: [r.code], metricNo: '', metric: r.name, baseline: '', target: '', targetBasis: '', priorTarget: '',
      priorStatus: 'Missing', flags: ['Required LCFF metric not in the current LCAP; add it to the new plan.'] });
  }
  return rows;
}

// Stable signature of a metric's data; AI text is "current" only while this matches.
function dataSig(metric) {
  const s = JSON.stringify([metric.targetValue, metric.direction, metric.primaryGroup,
    metric.points.map(p => [p.period, p.group, p.value]).sort()]);
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

root.LCAP = {
  PRIORITY_NAMES, REQUIRED, REQUIRED_BY_CODE, GROUP_NAMES, COLOR_NAMES, STATUS,
  uid, norm, round, fmtValue, fmtDelta, periodOrder, leadingPeriod, parseValue, parseTarget,
  inferCodes, inferDirection, newDistrict, makeMetric, addPoint, importLcapRows,
  series, analyze, insight, goodSign, prioritySummary, groupName, dataSig, suggestTarget, nextCycleRows
};
})(typeof window !== 'undefined' ? window : globalThis);
