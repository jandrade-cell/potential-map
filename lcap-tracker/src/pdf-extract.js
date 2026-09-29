// ============================================================
// LCAP PDF EXTRACTION
// Finds the state template's "Measuring and Reporting Results" tables
// (Metric # | Metric | Baseline | Year 1 Outcome | Year 2 Outcome |
//  Target for Year 3 Outcome | Current Difference from Baseline)
// using the x/y position of each piece of text on the page.
// ============================================================
(function (root) {
'use strict';

const COLS = ['metricNo', 'metric', 'baseline', 'y1', 'y2', 'y3', 'target', 'diff'];
const METRIC_NO = /^\d{1,2}(\.\d{1,2}){0,2}[a-z]?$/i;
const TABLE_END = /^(goal analysis|insert or delete rows|actions?\s*#?$|action\s*#|an explanation of|a description of any substantive|goal\s*#|required descriptions|increased or improved services|engaging educational partners)/i;
const NOISE = /page \d+ of \d+|local control and accountability plan for|^\s*$/i;

let workerReady = false;
function ensureWorker() {
  if (workerReady || !root.pdfjsLib) return;
  const el = typeof document !== 'undefined' && document.getElementById('pdf-worker-src');
  if (el) {
    const url = URL.createObjectURL(new Blob([el.textContent], { type: 'text/javascript' }));
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = url;
  }
  workerReady = true;
}

// Read every page into positioned text items (y measured from the top).
async function readPdf(data, onProgress) {
  ensureWorker();
  const doc = await root.pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter(it => it.str && it.str.trim()).map(it => ({
      str: it.str.replace(/\s+/g, ' '), x: it.transform[4], y: vp.height - it.transform[5],
      w: it.width, h: Math.abs(it.transform[3]) || it.height || 8
    }));
    pages.push({ n, width: vp.width, height: vp.height, items });
    if (onProgress) onProgress(n, doc.numPages);
  }
  return pages;
}

// Group items into visual lines.
function lines(items) {
  const sorted = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - it.y) <= Math.max(2, it.h * 0.35)) last.items.push(it);
    else out.push({ y: it.y, items: [it] });
  }
  out.forEach(l => { l.items.sort((a, b) => a.x - b.x); l.text = l.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim(); });
  return out;
}

function classifyHeader(text) {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^metric\s*#|^metric\s*no|^#$/.test(t)) return 'metricNo';
  if (/^metrics?$|^metric\/indicator|^metric description/.test(t)) return 'metric';
  if (/^baseline/.test(t)) return 'baseline';
  if (/^year 1\b/.test(t)) return 'y1';
  if (/^year 2\b/.test(t)) return 'y2';
  if (/^year 3 outcome/.test(t)) return 'y3';
  if (/^target|^desired outcome/.test(t)) return 'target';
  if (/^current( difference)?$|^current difference|^difference( from)?|difference from baseline/.test(t)) return 'diff';
  return null;
}

// Find a metrics table header on a page; returns column left edges.
function findHeader(page) {
  const baseItems = page.items.filter(i => /^baseline\b/i.test(i.str.trim()));
  for (const b of baseItems) {
    const band = page.items.filter(i => i.y >= b.y - 14 && i.y <= b.y + 30);
    const cols = {};
    const metricHeads = [];
    for (const it of band.sort((p, q) => p.x - q.x)) {
      let k = classifyHeader(it.str);
      if (k === 'metric') {
        // "Metric" with a "#" beside or wrapped beneath it is the number column.
        const hash = band.find(o => o.str.trim() === '#' && o.x >= it.x - 3 && o.x <= it.x + it.w + 12 && Math.abs(o.y - it.y) < 20);
        if (hash && cols.metricNo == null) k = 'metricNo';
        else { metricHeads.push(it.x); continue; }
      }
      if (k && cols[k] == null) cols[k] = it.x;
    }
    // Two "Metric" headings and no "#": the left one numbers the rows.
    const heads = [...new Set(metricHeads.map(x => Math.round(x)))];
    if (cols.metricNo == null && heads.length >= 2) { cols.metricNo = heads[0]; cols.metric = heads[1]; }
    else if (heads.length) cols.metric = heads.find(x => cols.metricNo == null || x > cols.metricNo + 5) ?? cols.metric;
    if (cols.baseline != null && (cols.y1 != null || cols.target != null) && (cols.metric != null || cols.metricNo != null)) {
      const bottom = Math.max(...band.filter(i => classifyHeader(i.str) || /outcome|from baseline|for year|#/i.test(i.str)).map(i => i.y + i.h * 0.3));
      return { cols, bottom, top: b.y - 14 };
    }
  }
  return null;
}

function columnOf(cols, x) {
  const edges = Object.entries(cols).sort((a, b) => a[1] - b[1]);
  let key = edges[0][0];
  for (const [k, left] of edges) if (x >= left - 8) key = k;
  return key;
}

function extractTables(pages) {
  const rows = [];
  let active = null;          // header carried across a page break
  let current = null;         // row being filled
  const flush = () => { if (current) { rows.push(current); current = null; } };

  for (const page of pages) {
    const header = findHeader(page);
    let startY = -Infinity;
    if (header) { flush(); active = header; startY = header.bottom; }
    if (!active) continue;
    const cols = active.cols;
    for (const line of lines(page.items)) {
      if (line.y <= startY) continue;
      if (NOISE.test(line.text) && line.items.length <= 3 && (line.y < 50 || line.y > page.height - 60)) continue;
      if (TABLE_END.test(line.text)) { flush(); active = null; break; }
      // A repeated header on a continuation page.
      if (line.items.some(i => /^baseline\b/i.test(i.str)) && line.items.some(i => classifyHeader(i.str) === 'y1' || classifyHeader(i.str) === 'target')) continue;
      for (const it of line.items) {
        const col = columnOf(cols, it.x);
        const txt = it.str.trim();
        if (col === 'metricNo' && METRIC_NO.test(txt)) {
          flush();
          current = { page: page.n, cells: {} };
        }
        if (!current) {
          if (cols.metricNo != null) continue;          // text before the first numbered row
          current = { page: page.n, cells: {} };        // tables without a Metric # column
        }
        // Fragments of one word sit edge to edge on the same line: join without a space.
        const last = current.last && current.last[col];
        const glued = last && Math.abs(last.y - it.y) < it.h * 0.4 && it.x - (last.x + last.w) < it.h * 0.12;
        current.cells[col] = (current.cells[col] ? current.cells[col] + (glued ? '' : ' ') : '') + txt;
        (current.last ||= {})[col] = it;
      }
    }
  }
  flush();
  return rows.map(r => {
    const o = { page: 'p. ' + r.page };
    for (const k of COLS) o[k] = (r.cells[k] || '').replace(/\s+/g, ' ').replace(/(\w)- (\w)/g, '$1-$2').trim();
    if (!o.metricNo && o.metric) o.metricNo = '';
    o.goal = (o.metricNo.match(/^(\d+)/) || [])[1] || '';
    return o;
  }).filter(r => r.metric || r.baseline);
}

function detectMeta(pages) {
  const text = pages.slice(0, 3).map(p => lines(p.items).map(l => l.text).join('\n')).join('\n');
  const all = pages.map(p => lines(p.items).slice(-4).map(l => l.text).join('\n')).join('\n');
  let district = null;
  let m = (text + '\n' + all).match(/Local Control and Accountability Plan for\s+(.+?)(?:\s+Page \d+|\n|$)/i);
  if (m) district = m[1].trim();
  if (!district) {
    m = text.match(/Local Educational Agency \(LEA\) Name\s*\n?\s*(.+)/i);
    if (m) district = m[1].split(/Contact Name/i)[0].trim();
  }
  let lcapYear = null;
  m = (text + all).match(/(20\d\d)\s*[-–]\s*(?:20)?\d\d\s+Local Control and Accountability Plan/i);
  if (m) lcapYear = +m[1];
  // Statewide three-year cycles: 2024–27, 2027–30, ...
  const cycleStart = lcapYear ? 2024 + 3 * Math.floor((lcapYear - 2024) / 3) : null;
  return { district, lcapYear, cycleStart };
}

async function extractLcapPdf(data, onProgress) {
  const pages = await readPdf(data, onProgress);
  const rows = extractTables(pages);
  const meta = detectMeta(pages);
  const textChars = pages.reduce((n, p) => n + p.items.reduce((k, i) => k + i.str.length, 0), 0);
  return { rows, ...meta, pageCount: pages.length, scanned: textChars < pages.length * 40 };
}

root.LcapPdf = { extractLcapPdf, readPdf, extractTables, detectMeta, lines };
})(typeof window !== 'undefined' ? window : globalThis);
