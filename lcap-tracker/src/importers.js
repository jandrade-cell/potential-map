// ============================================================
// DATA IMPORTERS
// Every importer turns a file into "proposed results":
//   { metricId, period, group, value, color, text, source }
// The UI previews them, then commits them with LCAP.addPoint.
// Student-level files (NWEA, mCLASS) are rolled up in memory;
// only the aggregate percentages are ever stored.
// ============================================================
(function (root) {
'use strict';
const L = root.LCAP;

// ------------------------------------------------------------
// Reading files
// ------------------------------------------------------------
function parseDelimited(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

// Arrays of cells -> {headers, rows[]} using the first row that looks like a header.
function toTable(matrix, name) {
  let h = 0;
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const filled = matrix[i].filter(c => String(c).trim() !== '').length;
    if (filled >= Math.min(3, Math.max(...matrix.slice(0, 15).map(r => r.length)))) { h = i; break; }
  }
  const headers = matrix[h].map((c, i) => String(c).trim() || `Column ${i + 1}`);
  const rows = matrix.slice(h + 1).map(r => Object.fromEntries(headers.map((k, i) => [k, r[i] == null ? '' : String(r[i]).trim()])));
  return { name, headers, rows };
}

async function readTable(file) {
  const lower = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xls)$/.test(lower)) {
    const wb = root.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return wb.SheetNames.map(n => toTable(root.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false }), n))
      .filter(t => t.rows.length);
  }
  return [toTable(parseDelimited(await file.text()), file.name)];
}

const col = (headers, ...tests) => {
  for (const t of tests) {
    const h = headers.find(x => typeof t === 'string' ? x.toLowerCase() === t.toLowerCase() : t.test(x));
    if (h) return h;
  }
  return null;
};

function detectKind(t, fileName = '') {
  const H = t.headers;
  if (col(H, 'metric_no') && col(H, 'period') && col(H, 'value')) return 'template';
  if (col(H, 'studentgroup') && col(H, 'currstatus')) return 'dashboard';
  if (col(H, 'Benchmark Period') && col(H, 'Composite Level')) return 'mclass';
  if (col(H, /^termname$/i, /term/i) && col(H, /testpercentile/i, /percentile(?!.*quintile)/i)) return 'nwea';
  return 'generic';
}

// ------------------------------------------------------------
// Metric suggestions
// ------------------------------------------------------------
function findMetric(district, codes, nameRe, notRe) {
  const ms = district.metrics.filter(m => (!codes || m.codes.some(c => codes.includes(c))));
  return ms.find(m => (!nameRe || nameRe.test(m.name)) && !(notRe && notRe.test(m.name))) || null;
}

// ------------------------------------------------------------
// CSV template
// ------------------------------------------------------------
function templateCsv(district) {
  const q = s => /[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  const lines = ['metric_no,metric_name,period,value,student_group,note'];
  for (const m of district.metrics) lines.push([m.metricNo, m.name, '', '', 'ALL', ''].map(q).join(','));
  lines.push(['# Example:', '', '2025-26', '87.5', 'ALL', 'Periods can be 2025-26, Fall 2025, Winter 2026, Dashboard 2025…'].map(q).join(','));
  return lines.join('\r\n');
}

const GROUP_BY_NAME = Object.fromEntries(Object.entries(L.GROUP_NAMES).map(([k, v]) => [v.toLowerCase(), k]));
// DataQuest "Reporting Category" codes.
const DATAQUEST = { TA: 'ALL', SE: 'SED', SD: 'SWD', SF: 'FOS', SH: 'HOM', SM: 'MIG', RB: 'AA', RI: 'AI', RA: 'AS',
  RF: 'FI', RH: 'HI', RP: 'PI', RT: 'MR', RW: 'WH', RD: 'Not reported', GF: 'Female', GM: 'Male', GX: 'Non-binary' };
function groupCode(g) {
  const s = String(g || '').trim();
  if (!s) return 'ALL';
  if (L.GROUP_NAMES[s.toUpperCase()]) return s.toUpperCase();
  if (DATAQUEST[s.toUpperCase()]) return DATAQUEST[s.toUpperCase()];
  if (/^(all|total|all students|districtwide)$/i.test(s)) return 'ALL';
  return GROUP_BY_NAME[s.toLowerCase()] || s;
}
function num(v) {
  const s = String(v ?? '').replace(/[%,\s]/g, '');
  if (s === '' || s === '*' || /^n\/?a$/i.test(s)) return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function fromTemplate(t, district) {
  const H = t.headers, out = [], skipped = [];
  const cNo = col(H, 'metric_no'), cName = col(H, 'metric_name'), cP = col(H, 'period'), cV = col(H, 'value'),
    cG = col(H, 'student_group'), cN = col(H, 'note');
  for (const r of t.rows) {
    if (String(r[cNo]).startsWith('#') || (!r[cP] && !r[cV])) continue;
    const m = district.metrics.find(x => x.metricNo === String(r[cNo]).trim())
      || (cName && district.metrics.find(x => x.name.toLowerCase() === String(r[cName]).toLowerCase().trim()));
    if (!m) { skipped.push(`Unknown metric "${r[cNo]}"`); continue; }
    const value = num(r[cV]);
    out.push({ metricId: m.id, period: r[cP] || 'Undated', group: groupCode(cG && r[cG]), value,
      text: (cN && r[cN]) || (value == null ? r[cV] : ''), source: 'CSV' });
  }
  return { proposals: out, skipped };
}

// ------------------------------------------------------------
// CA School Dashboard downloadable data files
// (eladownload, mathdownload, chronicdownload, suspdownload, graddownload, elpidownload, ccidownload)
// ------------------------------------------------------------
const DASH_INDICATORS = {
  ela: { label: 'ELA (distance from standard)', codes: ['4A'], re: /\bELA\b|english language arts|reading/i, not: /EAP|NWEA|MAP|mCLASS|DIBELS/i },
  math: { label: 'Math (distance from standard)', codes: ['4A'], re: /math/i, not: /EAP|NWEA|MAP/i },
  elpi: { label: 'English Learner Progress (ELPI)', codes: ['4E'] },
  chronic: { label: 'Chronic absenteeism', codes: ['5B'] },
  susp: { label: 'Suspension rate', codes: ['6A'] },
  grad: { label: 'Graduation rate', codes: ['5E'] },
  cci: { label: 'College/Career Indicator', codes: ['8A'], re: /CCI|college/i },
};
function dashboardIndicatorFromName(name) {
  const n = name.toLowerCase();
  if (/elpi/.test(n)) return 'elpi';
  if (/ela/.test(n)) return 'ela';
  if (/math/.test(n)) return 'math';
  if (/chronic|chron/.test(n)) return 'chronic';
  if (/susp/.test(n)) return 'susp';
  if (/grad/.test(n)) return 'grad';
  if (/cci/.test(n)) return 'cci';
  return null;
}
function dashboardDistricts(t) {
  const H = t.headers, cR = col(H, 'rtype'), cD = col(H, 'districtname'), cC = col(H, 'cds');
  const set = new Map();
  for (const r of t.rows) if (!cR || r[cR] === 'D') set.set(r[cC] || r[cD], r[cD] || r[cC]);
  return [...set.entries()].map(([key, name]) => ({ key, name }));
}
function fromDashboard(t, { metricId, districtKey, includeSites }) {
  const H = t.headers;
  const cR = col(H, 'rtype'), cD = col(H, 'districtname'), cC = col(H, 'cds'), cS = col(H, 'schoolname'),
    cG = col(H, 'studentgroup'), cV = col(H, 'currstatus'), cCol = col(H, 'color'), cY = col(H, 'reportingyear'), cDen = col(H, 'currdenom');
  const cdsDistrict = r => String(r[cC] || '').slice(0, 7);
  const keyDistrict = String(districtKey || '');
  const out = [];
  for (const r of t.rows) {
    const isD = !cR || r[cR] === 'D';
    const matches = !keyDistrict || r[cC] === keyDistrict || r[cD] === keyDistrict || (cC && cdsDistrict(r) === keyDistrict.slice(0, 7));
    if (!matches) continue;
    let group;
    if (isD) group = groupCode(r[cG]);
    else if (includeSites && cR && r[cR] === 'S' && String(r[cG]).toUpperCase() === 'ALL') group = `Site: ${r[cS]}`;
    else continue;
    const value = num(r[cV]);
    if (value == null) continue;
    const color = +r[cCol] >= 1 && +r[cCol] <= 5 ? +r[cCol] : null;
    const year = r[cY] || '';
    out.push({ metricId, period: year ? `Dashboard ${year}` : 'Dashboard', order: year ? +year + 0.6 : null, group, value, color,
      text: `${L.groupName(group)}: ${value}${color ? ` (${L.COLOR_NAMES[color]})` : ''}${cDen && r[cDen] ? `, n=${r[cDen]}` : ''}`, source: 'CA Dashboard' });
  }
  return { proposals: out, skipped: [] };
}

// ------------------------------------------------------------
// NWEA MAP Growth (AssessmentResults / Combined Data File)
// ------------------------------------------------------------
function nweaInfo(t) {
  const H = t.headers;
  const cTerm = col(H, /^termname$/i, /term/i), cSub = col(H, /^subject$/i, /discipline/i, /^course$/i, /measurementscale/i),
    cPct = col(H, /testpercentile/i, /percentile(?!.*quintile)/i), cId = col(H, /studentid/i, /student.?id/i);
  const subjects = [...new Set(t.rows.map(r => r[cSub]).filter(Boolean))];
  const terms = [...new Set(t.rows.map(r => r[cTerm]).filter(Boolean))];
  return { cTerm, cSub, cPct, cId, subjects, terms };
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
function fromNwea(t, { threshold = 61, map }) {
  const i = nweaInfo(t);
  const agg = {};
  const seen = new Set();
  for (const r of t.rows) {
    const sub = r[i.cSub], term = r[i.cTerm], p = num(r[i.cPct]);
    if (!map[sub] || !map[sub].metricId || !term || p == null) continue;
    const k = `${r[i.cId]}|${sub}|${term}`;
    if (i.cId && seen.has(k)) continue;
    seen.add(k);
    const a = agg[`${sub}|${term}`] ||= { sub, term, n: 0, hit: 0 };
    a.n++; if (p >= threshold) a.hit++;
  }
  const out = Object.values(agg).map(a => ({
    metricId: map[a.sub].metricId, period: a.term, group: map[a.sub].group || 'ALL',
    value: L.round(100 * a.hit / a.n, 1), text: `${a.sub}: ${a.hit} of ${a.n} students at/above the ${ordinal(threshold)} percentile`, source: 'NWEA MAP'
  }));
  return { proposals: out, skipped: [] };
}

// ------------------------------------------------------------
// mCLASS / DIBELS 8 benchmark export
// ------------------------------------------------------------
function fromMclass(t, { metricId, schoolYear, bySchool, byGrade }) {
  const H = t.headers;
  const cP = col(H, 'Benchmark Period'), cL = col(H, 'Composite Level'), cY = col(H, 'School Year', /school.?year/i),
    cId = col(H, 'Student Primary ID'), cS = col(H, 'School Name'), cGr = col(H, 'Enrollment Grade');
  const agg = {}; const seen = new Set();
  const bump = (key, period, group, ok) => { const a = agg[key] ||= { period, group, n: 0, hit: 0 }; a.n++; if (ok) a.hit++; };
  for (const r of t.rows) {
    const level = r[cL], period = r[cP];
    if (!level || !period) continue;
    const yr = (cY && r[cY]) || schoolYear || '';
    const label = `${period}${yr ? ' ' + yr : ''}`;
    const k = `${r[cId]}|${label}`;
    if (cId && seen.has(k)) continue;
    seen.add(k);
    const ok = /^(at|above) benchmark$/i.test(level.trim());
    bump(label + '|ALL', label, 'ALL', ok);
    if (bySchool && cS && r[cS]) bump(label + '|S' + r[cS], label, `Site: ${r[cS]}`, ok);
    if (byGrade && cGr && r[cGr]) bump(label + '|G' + r[cGr], label, `Grade ${r[cGr]}`, ok);
  }
  const out = Object.values(agg).map(a => ({ metricId, period: a.period, group: a.group,
    value: L.round(100 * a.hit / a.n, 1), text: `${a.hit} of ${a.n} students At or Above Benchmark`, source: 'mCLASS' }));
  return { proposals: out, skipped: [] };
}

// ------------------------------------------------------------
// Any other table (DataQuest downloads, local reports)
// ------------------------------------------------------------
function fromGeneric(t, { metricId, periodCol, periodFixed, valueCol, groupCol, filterCol, filterVal }) {
  const out = [], skipped = [];
  for (const r of t.rows) {
    if (filterCol && String(r[filterCol]).trim() !== String(filterVal).trim()) continue;
    const value = num(r[valueCol]);
    if (value == null) { skipped.push(`Non-numeric value "${r[valueCol]}"`); continue; }
    out.push({ metricId, period: periodCol ? r[periodCol] : periodFixed || 'Undated',
      group: groupCol ? groupCode(r[groupCol]) : 'ALL', value, text: '', source: 'Spreadsheet' });
  }
  // Rows that collapse onto the same period+group keep the first value.
  const seen = new Set();
  const dedup = out.filter(p => { const k = p.period + '|' + p.group; if (seen.has(k)) { skipped.push(`Duplicate ${k}`); return false; } seen.add(k); return true; });
  return { proposals: dedup, skipped };
}

root.LcapImport = {
  parseDelimited, toTable, readTable, detectKind, findMetric, templateCsv,
  DASH_INDICATORS, dashboardIndicatorFromName, dashboardDistricts, fromDashboard,
  nweaInfo, fromNwea, fromMclass, fromTemplate, fromGeneric, groupCode, col
};
})(typeof window !== 'undefined' ? window : globalThis);
