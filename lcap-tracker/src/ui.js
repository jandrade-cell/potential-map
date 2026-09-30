// ============================================================
// LCAP TRACKER UI
// ============================================================
(function () {
'use strict';
const L = window.LCAP, P = window.LcapPdf, I = window.LcapImport, AI = window.LcapAI;

const STORE_KEY = 'lcapTracker.v1';
const KEY_KEY = 'lcapTracker.apiKey';
const STATUS_COLOR = { Priority: 'var(--st-priority)', Watch: 'var(--st-watch)', Sustain: 'var(--st-sustain)', Review: 'var(--st-review)' };

const S = {
  store: { districts: {}, currentId: null },
  apiKey: '', remember: false,
  filter: { status: '', prio: '', type: '', q: '' },
  flash: new Set(), view: 'dashboard'
};

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = () => S.store.districts[S.store.currentId] || null;
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return iso; } };
const primaryPriority = m => m.codes && m.codes.length ? +m.codes[0][0] : 0;
const metricType = m => (m.codes || []).map(c => L.REQUIRED_BY_CODE[c]?.type).filter(Boolean)[0] || '';
const badge = st => `<span class="badge" style="--c:${STATUS_COLOR[st]}">${esc(st)}</span>`;
const pageRef = m => /^LCAP/i.test(m.lcapText.page) ? m.lcapText.page : 'LCAP ' + m.lcapText.page;
const slug = s => String(s || 'district').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function toast(msg, err) {
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), err ? 6500 : 4200);
}
function loading(msg) { $('loading').hidden = !msg; if (msg) $('loading-text').textContent = msg; }

function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

// ------------------------------------------------------------
// Storage (browser + district files)
// ------------------------------------------------------------
function loadStore() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.districts) S.store = s; } catch (e) { /* private window or blocked storage */ }
  try { S.apiKey = localStorage.getItem(KEY_KEY) || ''; S.remember = !!S.apiKey; } catch (e) { /* same */ }
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S.store)); }
    catch (e) { toast('This browser would not save the data. Use Save File to keep your work.', true); }
  }, 120);
}
function changed() { const d = D(); if (d) d.updatedAt = new Date().toISOString(); persist(); render(); }

function addDistrict(d) {
  S.store.districts[d.id] = d;
  S.store.currentId = d.id;
  S.filter = { status: '', prio: '', type: '', q: '' };
  persist();
}

function saveFile() {
  const d = D(); if (!d) return;
  const payload = { format: 'lcap-tracker', version: 1, savedAt: new Date().toISOString(), district: d };
  download(`${slug(d.name)}-lcap-tracker-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 1));
  toast('District file saved. Share it with your team or open it on another computer.');
}

async function openFile(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.format === 'lcap-tracker' && j.district && Array.isArray(j.district.metrics)) {
      const d = j.district;
      if (S.store.districts[d.id] && !confirm(`Replace the copy of "${d.name}" in this browser with the file's version (saved ${fmtDate(j.savedAt)})?`)) return;
      addDistrict(d); render(); toast(`Opened ${d.name}.`);
    } else if (j.format === 'lcap-extract' && Array.isArray(j.rows)) {
      loadExtract(j, file.name);
    } else throw new Error('Not a district file');
  } catch (e) { toast('That file is not an LCAP Tracker district file (.json).', true); }
}

function loadExtract(j, fileName) {
  const d = L.newDistrict(j.district || 'District', j.cycleStart);
  const r = L.importLcapRows(d, j.rows, { cycleStart: j.cycleStart, sourceLabel: 'LCAP' });
  // Carry over narrative written outside the tracker; it goes stale like AI text once data changes.
  const at = new Date().toISOString(), label = j.insightLabel || 'Imported';
  j.rows.forEach(row => {
    const m = row.insight && d.metrics.find(x => x.metricNo === row.metricNo);
    if (m) m.ai = { text: row.insight, at, sig: L.dataSig(m), label };
  });
  if (j.summary) d.ai = { summary: { at, label, sigs: AI.prioritySigs(d), priorities: j.summary } };
  d.imports.push({ at: new Date().toISOString(), type: 'LCAP', file: fileName || j.source || 'LCAP', count: r.points });
  addDistrict(d); render();
  toast(`Loaded ${d.metrics.length} metrics for ${d.name}.`);
}

// ------------------------------------------------------------
// Rendering
// ------------------------------------------------------------
function render() {
  const d = D();
  const has = !!d;
  $('welcome').hidden = has;
  ['tabs', 'district-row', 'btn-add-data', 'btn-save', 'btn-print', 'btn-report'].forEach(id => $(id).hidden = !has);
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', has && v.id === 'view-' + S.view));
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.view === S.view));
  if (!has) return;
  renderDistrictRow(d);
  const A = new Map(d.metrics.map(m => [m.id, L.analyze(m)]));
  if (S.view === 'dashboard') renderDashboard(d, A);
  if (S.view === 'summary') renderSummary(d);
  if (S.view === 'draft') renderDraft(d);
  if (S.view === 'coverage') renderCoverage(d, A);
  if (S.view === 'log') renderLog(d);
  if (S.view === 'settings') renderSettings(d);
}

function renderDistrictRow(d) {
  $('district-select').innerHTML = Object.values(S.store.districts)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(x => `<option value="${x.id}" ${x.id === d.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const cyc = d.cycleStart ? `${d.cycleStart}–${String(d.cycleStart + 3).slice(2)} LCAP` : 'LCAP cycle not set';
  $('district-meta').textContent = `${cyc} · ${d.metrics.length} metrics · updated ${fmtDate(d.updatedAt)}`;
}

function currentInsight(m, a) {
  const label = (m.ai && m.ai.label) || 'AI';
  if (m.ai && m.ai.sig === L.dataSig(m)) return { text: m.ai.text, src: `${label} · ${fmtDate(m.ai.at)}` };
  return { text: L.insight(m, a), src: m.ai ? `Rules (${label} text out of date: data changed)` : 'Rules', stale: !!m.ai };
}

function matches(m, a) {
  const f = S.filter;
  if (f.status && a.status !== f.status) return false;
  if (f.prio && !(m.codes || []).some(c => c[0] === f.prio) && !(f.prio === '0' && !m.codes.length)) return false;
  if (f.type && metricType(m) !== f.type) return false;
  if (f.q) {
    const hay = (m.metricNo + ' ' + m.name + ' ' + m.codes.join(' ') + ' ' + m.targetText).toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

function renderDashboard(d, A) {
  const counts = { Priority: 0, Watch: 0, Sustain: 0, Review: 0 };
  d.metrics.forEach(m => counts[A.get(m.id).status]++);
  $('tiles').innerHTML = Object.keys(counts).map(k => `
    <button class="tile" style="--c:${STATUS_COLOR[k]}" data-status="${k}" aria-pressed="${S.filter.status === k}">
      <div class="tile-num">${counts[k]}</div><div class="tile-label">${k}</div><div class="tile-desc">${esc(L.STATUS[k])}</div>
    </button>`).join('');

  // AI bar
  const bar = $('ai-bar');
  if (S.apiKey && d.metrics.length) {
    const withAi = d.metrics.filter(m => m.ai && !m.ai.label);
    const stale = withAi.filter(m => m.ai.sig !== L.dataSig(m)).length;
    const msg = !withAi.length ? 'Narrative insights have not been generated yet.'
      : stale ? `${stale} metric insight${stale > 1 ? 's are' : ' is'} out of date because data changed. Rules-based text is shown for those.`
      : `AI insights are current (written ${fmtDate(withAi[0].ai.at)}).`;
    bar.innerHTML = `<span class="grow">✦ ${esc(msg)}</span><button class="btn btn-sm" data-act="ai-insights">${withAi.length ? 'Refresh AI insights' : 'Write AI insights'}</button>`;
    bar.hidden = false;
  } else bar.hidden = true;

  const prios = [...new Set(d.metrics.map(primaryPriority))].sort();
  $('prio-chips').innerHTML = [['', 'All'], ...prios.map(p => [String(p), p ? 'P' + p : 'Unmapped'])]
    .map(([v, l]) => `<button class="chip" data-prio="${v}" aria-pressed="${S.filter.prio === v}" title="${esc(L.PRIORITY_NAMES[v] || '')}">${l}</button>`).join('');
  $('type-filter').value = S.filter.type;

  const list = d.metrics.filter(m => matches(m, A.get(m.id)));
  $('result-count').textContent = `${list.length} of ${d.metrics.length} metrics`;
  if (!d.metrics.length) {
    $('metric-list').innerHTML = '<div class="empty">No metrics yet. Use <strong>Import LCAP</strong>, or add required metrics from the Required Metrics tab.</div>';
    return;
  }
  if (!list.length) { $('metric-list').innerHTML = '<div class="empty">No metrics match these filters.</div>'; return; }
  const groups = {};
  list.forEach(m => (groups[primaryPriority(m)] ||= []).push(m));
  $('metric-list').innerHTML = Object.keys(groups).sort((a, b) => a - b).map(p => `
    <section class="prio-group">
      <div class="prio-head"><span class="prio-dot"></span><span class="prio-name">${+p ? `Priority ${p} — ${esc(L.PRIORITY_NAMES[p])}` : 'Not mapped to a state priority'}</span><span class="pill">${groups[p].length}</span></div>
      ${groups[p].sort((a, b) => a.metricNo.localeCompare(b.metricNo, undefined, { numeric: true })).map(m => metricCard(m, A.get(m.id))).join('')}
    </section>`).join('');
  S.flash.clear();
}

function metricCard(m, a) {
  const c = STATUS_COLOR[a.status];
  const u = m.unit;
  const ins = currentInsight(m, a);
  const pct = a.met ? 100 : Math.max(0, Math.min(100, Math.round((a.progress ?? 0) * 100)));
  const tgt = m.targetValue != null ? L.fmtValue(m.targetValue, u) : '—';
  const step = (label, p, cls = '') => `<div class="step ${cls}"><div class="step-label">${label}</div>
      <div class="step-val">${p ? esc(L.fmtValue(p.value, u)) : '—'}</div><div class="step-per">${p ? esc(p.period) : ''}</div></div>`;
  return `
  <button class="card ${S.flash.has(m.id) ? 'flash' : ''}" style="--c:${c}" data-metric="${m.id}">
    <div class="card-head">
      <div class="card-title">${esc(m.name || 'Untitled metric')}<div class="card-sub">${m.metricNo ? 'Metric ' + esc(m.metricNo) : ''}${m.goal ? ' · Goal ' + esc(m.goal) : ''}</div></div>
      ${S.flash.has(m.id) ? '<span class="pill new">Updated</span>' : ''}
      ${(m.codes || []).map(cd => `<span class="pill" title="${esc(L.REQUIRED_BY_CODE[cd]?.name || '')}">${cd}</span>`).join('')}
      ${badge(a.status)}
    </div>
    <div class="strip">
      ${step('Baseline', a.baseline)}
      ${step(a.prev && a.prev !== a.baseline ? 'Previous' : '—', a.prev && a.prev !== a.baseline ? a.prev : null)}
      ${step('Latest', a.latest)}
      <div class="step target"><div class="step-label">Target</div><div class="step-val">${esc(tgt)}</div>
        <div class="step-per">${m.targetValue == null && m.targetText ? esc(m.targetText) : (a.target != null && m.direction !== 'maintain' ? `${pct}% of the way` : esc(m.direction === 'maintain' ? 'maintain' : ''))}</div>
        ${a.target != null && m.direction !== 'maintain' ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>
    </div>
    <p class="insight">${esc(ins.text)}</p>
    <div class="card-foot"><span>${esc(a.reasons[0] || '')}</span><span>${esc(ins.src)}${m.lcapText?.page ? ' · ' + esc(pageRef(m)) : ''}</span></div>
  </button>`;
}

// ------------------------------------------------------------
// Next-cycle summary
// ------------------------------------------------------------
function summaryFor(d, p) {
  const s = L.prioritySummary(d, p);
  const ai = d.ai && d.ai.summary;
  if (ai && ai.sigs && ai.sigs[p] === AI.prioritySigs(d)[p] && ai.priorities[p]) return { ...s, ...ai.priorities[p], src: `${ai.label || 'AI'} · ${fmtDate(ai.at)}` };
  return { ...s, src: ai ? `Rules (${ai.label || 'AI'} summary out of date)` : 'Rules' };
}

function renderSummary(d) {
  $('summary-grid').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(p => {
    const s = summaryFor(d, p);
    const mini = Object.entries(s.counts).filter(([, n]) => n).map(([k, n]) => `<span style="--c:${STATUS_COLOR[k]}">${n} ${k}</span>`).join('');
    const note = d.notes[p] || '';
    return `<article class="sum-card">
      <div class="sum-head"><h3>Priority ${p} — ${esc(L.PRIORITY_NAMES[p])}</h3><div class="mini-status">${mini}</div></div>
      <p class="sum-pattern">${esc(s.pattern)}</p>
      <dl class="sum-field"><dt>Strongest evidence of progress</dt><dd>${esc(s.progress)}</dd></dl>
      <dl class="sum-field"><dt>Most important unresolved need</dt><dd>${esc(s.need)}</dd></dl>
      <dl class="sum-field q"><dt>Equity / data question for next cycle</dt><dd>${esc(s.equity)}</dd></dl>
      <dl class="sum-field dir"><dt>Planning direction to consider</dt><dd>${esc(s.direction)}</dd></dl>
      <div><label class="lbl" style="display:flex;justify-content:space-between"><span>Team notes</span><span class="src-tag">${esc(s.src)}</span></label>
        <textarea class="ctl notes" data-note="${p}" placeholder="Educational-partner input, data to pull, proposed actions…">${esc(note)}</textarea>
        <div class="notes-print" data-note-print="${p}">${esc(note)}</div></div>
    </article>`;
  }).join('');
}

function exportNotes() {
  const d = D();
  const lines = [`${d.name} — LCAP Next-Cycle Planning Notes`, 'Exported ' + new Date().toLocaleString(), ''];
  for (let p = 1; p <= 8; p++) {
    const s = summaryFor(d, p);
    lines.push(`PRIORITY ${p} — ${L.PRIORITY_NAMES[p].toUpperCase()}`, 'Pattern: ' + s.pattern,
      'Planning direction to consider: ' + s.direction, 'Team notes: ' + ((d.notes[p] || '').trim() || '(none)'), '');
  }
  download(`${slug(d.name)}-next-cycle-notes.txt`, lines.join('\r\n'), 'text/plain');
}

// ------------------------------------------------------------
// Next-cycle draft metrics table
// ------------------------------------------------------------
const TEMPLATE_COLS = ['Metric #', 'Metric', 'Baseline', 'Year 1 Outcome', 'Year 2 Outcome', 'Target for Year 3 Outcome', 'Current Difference from Baseline'];

function draftRows(d) {
  const edits = d.draft || {};
  return L.nextCycleRows(d, { gapPct: d.draftGap || 30 }).map(r => ({
    ...r, baseline: edits[r.id]?.baseline ?? r.baseline, target: edits[r.id]?.target ?? r.target,
    edited: !!edits[r.id]
  }));
}

function renderDraft(d) {
  const start = (d.cycleStart || 2024) + 3;
  $('draft-cycle').textContent = `${start}–${String(start + 3).slice(2)}`;
  $('draft-gap').value = d.draftGap || 30;
  const rows = draftRows(d);
  const missing = rows.filter(r => r.priorStatus === 'Missing').length;
  $('draft-count').textContent = `${rows.length - missing} metrics${missing ? ` + ${missing} required metric${missing > 1 ? 's' : ''} to add` : ''}`;
  $('draft-body').innerHTML = rows.map(r => `<tr class="${r.priorStatus === 'Missing' ? 'missing-row' : ''}">
    <td class="num">${esc(r.codes.join(', '))}</td><td class="num">${esc(r.metricNo)}</td><td>${esc(r.metric)}</td>
    <td class="wide"><input class="ctl" data-draft="${esc(r.id)}" data-k="baseline" value="${esc(r.baseline)}" aria-label="Baseline"></td>
    <td class="blank"></td><td class="blank"></td>
    <td class="wide"><input class="ctl" data-draft="${esc(r.id)}" data-k="target" value="${esc(r.target)}" aria-label="Target"></td>
    <td class="blank"></td>
    <td class="notes-cell">${r.priorStatus === 'Missing' ? '' : badge(r.priorStatus) + ' '}${r.priorTarget ? `Current target: ${esc(r.priorTarget.replace(/\.+$/, ''))}. ` : ''}${esc(r.targetBasis)}
      ${r.flags.length ? `<ul>${r.flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</td></tr>`).join('');
}

function draftCsv(d) {
  const q = s => /[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  const head = ['LCFF metric(s)', ...TEMPLATE_COLS, 'Current-cycle status', 'Current-cycle target', 'Target basis', 'Planning flags'];
  const lines = [head.map(q).join(',')];
  for (const r of draftRows(d)) lines.push([r.codes.join(' '), r.metricNo, r.metric, r.baseline, '', '', r.target, '',
    r.priorStatus, r.priorTarget, r.targetBasis, r.flags.join(' ')].map(q).join(','));
  return '\uFEFF' + lines.join('\r\n');
}

async function copyDraft(d) {
  const rows = draftRows(d);
  const cell = s => `<td style="border:1px solid #999;padding:4px;vertical-align:top">${esc(s)}</td>`;
  const html = `<table style="border-collapse:collapse;font-family:Arial;font-size:10pt"><tr>${TEMPLATE_COLS.map(h => `<th style="border:1px solid #999;padding:4px;background:#eee">${esc(h)}</th>`).join('')}</tr>
    ${rows.map(r => `<tr>${[r.metricNo, r.metric, r.baseline, '', '', r.target, ''].map(cell).join('')}</tr>`).join('')}</table>`;
  const text = [TEMPLATE_COLS.join('\t'), ...rows.map(r => [r.metricNo, r.metric, r.baseline, '', '', r.target, ''].join('\t'))].join('\n');
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } catch (e) {
    // Older browsers / file pages: copy a rendered copy of the table.
    const box = document.createElement('div');
    box.innerHTML = html; box.style.position = 'fixed'; box.style.left = '-9999px';
    document.body.appendChild(box);
    const range = document.createRange(); range.selectNodeContents(box);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    document.execCommand('copy'); sel.removeAllRanges(); box.remove();
  }
  toast('Table copied. Paste it into the LCAP template in Word.');
}

// ------------------------------------------------------------
// One-page summary report (print)
// ------------------------------------------------------------
function printReport() {
  const d = D(); if (!d) return;
  const A = new Map(d.metrics.map(m => [m.id, L.analyze(m)]));
  const counts = { Priority: 0, Watch: 0, Sustain: 0, Review: 0 };
  d.metrics.forEach(m => counts[A.get(m.id).status]++);
  const covered = L.REQUIRED.filter(r => d.metrics.some(m => m.codes.includes(r.code))).length;
  const attention = d.metrics.filter(m => A.get(m.id).status === 'Priority');
  const v = (p, m) => p ? esc(L.fmtValue(p.value, m.unit)) : '—';
  $('view-report').innerHTML = `<div class="report">
    <img class="rpt-logo" src="${document.querySelector('.logo').src}" alt="Modoc County Office of Education logo">
    <div class="eyebrow">Modoc County Office of Education · LCAP Tracker</div>
    <h2>${esc(d.name)}: LCAP Progress Summary</h2>
    <div class="rpt-meta">${d.cycleStart ? `${d.cycleStart}–${String(d.cycleStart + 3).slice(2)} LCAP` : ''} · Prepared ${new Date().toLocaleDateString()} · ${d.metrics.length} metrics · ${covered} of 28 required LCFF metrics addressed</div>
    <div class="rpt-counts">${Object.entries(counts).map(([k, n]) => `<div style="--c:${STATUS_COLOR[k]}"><b>${n}</b>${k}</div>`).join('')}</div>
    <h3>By LCFF priority</h3>
    <table><thead><tr><th>Priority</th><th>Metrics</th><th>Most important unresolved need</th><th>Planning direction to consider</th></tr></thead><tbody>
    ${[1, 2, 3, 4, 5, 6, 7, 8].map(p => { const s = summaryFor(d, p); return `<tr><td>${p}. ${esc(L.PRIORITY_NAMES[p])}</td>
      <td>${Object.entries(s.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || '—'}</td><td>${esc(s.need)}</td><td>${esc(s.direction)}</td></tr>`; }).join('')}
    </tbody></table>
    <h3>Metrics needing attention (Priority)</h3>
    <table><thead><tr><th>Metric</th><th>Baseline</th><th>Latest</th><th>Target</th><th>Why</th></tr></thead><tbody>
    ${attention.map(m => { const a = A.get(m.id); return `<tr><td>${esc(m.metricNo)} ${esc(m.name)}</td><td>${v(a.baseline, m)}</td>
      <td>${v(a.latest, m)}${a.latest ? ' (' + esc(a.latest.period) + ')' : ''}</td><td>${m.targetValue != null ? esc(L.fmtValue(m.targetValue, m.unit)) : esc(m.targetText)}</td><td>${esc(a.reasons.join(' '))}</td></tr>`; }).join('') || '<tr><td colspan="5">None.</td></tr>'}
    </tbody></table>
    <p class="rpt-meta" style="margin-top:14px">Statuses are calculated from each metric's baseline, latest result, and target. They are planning prompts for educational-partner discussion, not conclusions.</p>
  </div>`;
  const view = $('view-report');
  document.body.classList.add('print-report'); view.classList.add('printing');
  window.print();
  document.body.classList.remove('print-report'); view.classList.remove('printing');
}

// ------------------------------------------------------------
// Guide
// ------------------------------------------------------------
function openGuide() {
  S.modal = { type: 'guide' };
  openModal(`${modalHead('Using the LCAP Tracker to develop your LCAP', 'A suggested sequence for superintendents and LCAP teams')}
  <div class="guide">
    <p>The tracker turns your adopted LCAP into a working data set: every metric, its baseline, each year's outcome, and your target, scored automatically. Use it all year to monitor progress, and in the spring to build the next plan.</p>
    <h3><span class="when">Start · any time</span><br>1. Import your current LCAP</h3>
    <ol><li>Choose <strong>Import LCAP</strong> and select the adopted plan (PDF from the state template).</li>
      <li>On the review screen, check each metric's <em>parsed</em> numbers. Correct any cell where the number is wrong, and check the <em>Indicators</em> column (1A–8A) for each metric.</li>
      <li>Import. The Dashboard shows every metric as <strong>Priority</strong>, <strong>Watch</strong>, <strong>Sustain</strong>, or <strong>Review</strong>. Open any metric to see why.</li></ol>
    <h3><span class="when">December · when the Dashboard is released</span><br>2. Add the newest state data</h3>
    <ol><li>Download the California School Dashboard data files (ELA, Math, ELPI, Chronic Absenteeism, Suspension, Graduation, CCI) from the CDE Dashboard downloadable data files page.</li>
      <li>Choose <strong>+ Add Data</strong> and upload each file. Every student group and its color is recorded, and groups in Red are flagged on the metric.</li></ol>
    <h3><span class="when">Fall · winter · spring</span><br>3. Add local results as they come in</h3>
    <ul><li><strong>NWEA MAP</strong> and <strong>mCLASS</strong> exports: student rows are summarized into percentages on this computer and never saved or sent.</li>
      <li>Attendance, climate surveys, A–G, CTE, and other local data: use the <strong>CSV template</strong>, any spreadsheet, or type a single result on the metric.</li></ul>
    <h3><span class="when">Winter · spring</span><br>4. Needs assessment and educational-partner engagement</h3>
    <ul><li><strong>Next-Cycle Summary</strong>: one card per LCFF priority with the pattern, strongest progress, most important need, an equity question, and a planning direction. Record partner input in <em>Team notes</em>.</li>
      <li><strong>Summary Report</strong>: a printable overview for board meetings, parent advisory committees, and staff.</li>
      <li><strong>Required Metrics</strong>: confirms your plan addresses all 28 required metrics and lets you add any that are missing.</li></ul>
    <h3><span class="when">Spring · drafting the plan</span><br>5. Draft the next LCAP's metrics table</h3>
    <ul><li><strong>Next-Cycle Draft</strong> lists every metric with its latest result as the new baseline and a suggested Year 3 target, plus flags such as Red student groups or combined measures.</li>
      <li>Adjust targets with your team, then <strong>Copy table</strong> into the LCAP template in Word or <strong>Download for Excel</strong>.</li></ul>
    <h3>Saving and sharing</h3>
    <ul><li>Your work is kept in this browser on this computer. Choose <strong>Save File</strong> to create a district file you can share with your LCAP team or open on another computer with <strong>Open File</strong>.</li>
      <li>Nothing is sent over the internet unless you turn on the optional AI features in <strong>Settings &amp; AI</strong>. Even then, only district-level LCAP data is sent.</li></ul>
  </div>`);
}

// ------------------------------------------------------------
// Required metric coverage
// ------------------------------------------------------------
function renderCoverage(d, A) {
  let covered = 0;
  $('coverage-body').innerHTML = L.REQUIRED.map(r => {
    const ms = d.metrics.filter(m => m.codes.includes(r.code));
    if (ms.length) covered++;
    return `<tr class="${ms.length ? '' : 'missing'}">
      <td class="num">${r.code}</td><td>${esc(r.name)}</td><td>${r.type}</td>
      <td>${ms.length ? ms.map(m => `<button class="linkish" data-metric="${m.id}">${esc(m.metricNo)} ${esc(m.name)}</button>`).join('<br>')
        : `Not found in the LCAP <button class="btn btn-ghost btn-sm no-print" data-add-code="${r.code}" style="margin-left:6px">+ Add metric</button>`}</td>
      <td>${ms.map(m => badge(A.get(m.id).status)).join('<br>')}</td></tr>`;
  }).join('');
  $('coverage-note').innerHTML = `<strong>${covered} of ${L.REQUIRED.length}</strong> required LCFF metrics are mapped to an LCAP metric. Mappings are inferred from each metric's name and label. Correct them from a metric's detail view (Indicators field).`;
}

// ------------------------------------------------------------
// Data log
// ------------------------------------------------------------
function renderLog(d) {
  $('imports-body').innerHTML = d.imports.length ? d.imports.slice().reverse().map(i =>
    `<tr><td>${esc(new Date(i.at).toLocaleString())}</td><td>${esc(i.type)}</td><td>${esc(i.file || '')}</td><td class="num">${i.count}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">No imports yet.</td></tr>';
  const mSel = $('log-metric'), sSel = $('log-source');
  const mv = mSel.value, sv = sSel.value;
  mSel.innerHTML = '<option value="">All metrics</option>' + d.metrics.map(m => `<option value="${m.id}">${esc(m.metricNo + ' ' + m.name)}</option>`).join('');
  const sources = [...new Set(d.metrics.flatMap(m => m.points.map(p => p.source)))];
  sSel.innerHTML = '<option value="">All sources</option>' + sources.map(s => `<option>${esc(s)}</option>`).join('');
  mSel.value = mv; sSel.value = sv;
  const rows = d.metrics.filter(m => !mSel.value || m.id === mSel.value).flatMap(m =>
    m.points.filter(p => !sSel.value || p.source === sSel.value).map(p => ({ m, p })))
    .sort((a, b) => a.m.metricNo.localeCompare(b.m.metricNo, undefined, { numeric: true }) || (a.p.order ?? 0) - (b.p.order ?? 0));
  $('points-body').innerHTML = rows.slice(0, 1500).map(({ m, p }) => `<tr>
    <td><button class="linkish" data-metric="${m.id}">${esc(m.metricNo)} ${esc(m.name)}</button></td><td>${esc(p.period)}</td>
    <td>${esc(L.groupName(p.group))}</td><td class="num">${p.value == null ? esc(p.text.slice(0, 40) || '—') : esc(L.fmtValue(p.value, m.unit))}</td>
    <td>${esc(p.source)}</td><td>${esc(fmtDate(p.addedAt))}</td>
    <td><button class="x" title="Delete result" data-del-point="${m.id}|${p.id}">✕</button></td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">No results.</td></tr>';
}

// ------------------------------------------------------------
// Settings
// ------------------------------------------------------------
function renderSettings(d) {
  $('set-name').value = d.name;
  $('set-cycle').value = String(d.cycleStart || 2024);
  $('set-key').value = S.apiKey;
  $('set-remember').checked = S.remember;
  $('ai-model-note').innerHTML = `<span style="font-size:11px;color:var(--muted)">Model: <code>${AI.MODEL}</code>. Calls go directly from this browser to api.anthropic.com and are billed to the key's account.</span>`;
}

// ------------------------------------------------------------
// Modal
// ------------------------------------------------------------
function openModal(html, narrow) {
  $('modal-inner').className = 'modal-inner' + (narrow ? ' narrow' : '');
  $('modal-inner').innerHTML = html;
  $('modal').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() { $('modal').hidden = true; $('modal-inner').innerHTML = ''; document.body.style.overflow = ''; S.modal = null; }
const modalHead = (title, sub) => `<div class="modal-head"><h2>${title}${sub ? `<div class="modal-sub">${sub}</div>` : ''}</h2><button class="btn btn-ghost btn-sm" data-act="close">✕ Close</button></div>`;

// ------------------------------------------------------------
// Metric detail
// ------------------------------------------------------------
function chartSvg(m, a) {
  const s = a.series;
  if (!s.length) return '<div class="empty" style="padding:20px">No numeric results to chart yet.</div>';
  const W = 640, H = 210, l = 74, r = 76, t = 18, b = 38;
  const vals = s.map(p => p.value).concat(m.targetValue != null ? [m.targetValue] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
  if (m.unit === '%') { lo = Math.max(lo, 0); hi = Math.min(hi, 100); if (hi <= lo) hi = lo + 1; }
  const x = i => s.length === 1 ? l + (W - l - r) / 2 : l + i * (W - l - r) / (s.length - 1);
  const y = v => t + (hi - v) * (H - t - b) / (hi - lo);
  const u = m.unit;
  const tick = v => Math.abs(hi - lo) >= 6 ? Math.round(v) : L.round(v, 1);
  const grid = [lo, (lo + hi) / 2, hi].map(tick).map(v => `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-width="1"/>
    <text x="${l - 8}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(L.fmtValue(v, u))}</text>`).join('');
  const tgt = m.targetValue != null ? `<line x1="${l}" x2="${W - r}" y1="${y(m.targetValue)}" y2="${y(m.targetValue)}" stroke="var(--accent2)" stroke-width="1.5" stroke-dasharray="5 4"/>
    <text x="${W - r + 6}" y="${y(m.targetValue) + 3}" font-size="10" fill="var(--text2)">Target ${esc(L.fmtValue(m.targetValue, u))}</text>` : '';
  const path = s.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const labels = s.map((p, i) => `<text x="${x(i)}" y="${H - b + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(p.period.replace(/^(Baseline|Year \d) · /, '$1 ').slice(0, 18))}</text>`).join('');
  const direct = [0, s.length - 1].filter((v, i, arr) => arr.indexOf(v) === i).map(i =>
    `<text x="${x(i)}" y="${y(s[i].value) - 10}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text)">${esc(L.fmtValue(s[i].value, u))}</text>`).join('');
  const dots = s.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.value)}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
    <circle cx="${x(i)}" cy="${y(p.value)}" r="14" fill="transparent" data-tip="${esc(`${p.period}: ${L.fmtValue(p.value, u)} (${p.source})`)}"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.name)} over time for ${esc(L.groupName(m.primaryGroup))}">
    ${grid}${tgt}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>${dots}${direct}${labels}</svg>
    <div class="progress-line">${esc(L.groupName(m.primaryGroup))} · ${m.direction === 'down' ? 'lower is better' : m.direction === 'maintain' ? 'maintain target' : 'higher is better'}</div>`;
}

function openMetric(id) {
  const d = D(); const m = d.metrics.find(x => x.id === id); if (!m) return;
  S.modal = { type: 'metric', id };
  const a = L.analyze(m);
  const ins = currentInsight(m, a);
  const groups = a.groups.filter(g => g.group !== m.primaryGroup);
  const groupOpts = [...new Set(['ALL', ...m.points.map(p => p.group)])];
  const pts = m.points.slice().sort((x, y) => (x.order ?? 0) - (y.order ?? 0) || x.group.localeCompare(y.group));
  const unitOpts = [['%', 'Percent'], ['pts', 'Points (e.g. distance from standard)'], ['rating', 'Rating out of 5'], ['fit', 'FIT rating'], ['', 'Number / count']];
  openModal(`
    ${modalHead(`${esc(m.name || 'Untitled metric')} ${badge(a.status)}`, `${m.metricNo ? 'Metric ' + esc(m.metricNo) + ' · ' : ''}${m.goal ? 'Goal ' + esc(m.goal) + ' · ' : ''}${esc(m.codes.join(', ') || 'no state priority mapped')}${m.lcapText?.page ? ' · ' + esc(pageRef(m)) : ''}`)}
    <div class="grid2">
      <div>${chartSvg(m, a)}</div>
      <div>
        <h3 class="lbl">Why this status</h3>
        <ul class="reasons">${a.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="section"><h3 class="lbl">Insight <span class="src-tag" style="text-transform:none;letter-spacing:0">(${esc(ins.src)})</span></h3>
          <p class="insight" style="--c:${STATUS_COLOR[a.status]}">${esc(ins.text)}</p>
          ${S.apiKey ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px" data-act="ai-insights">✦ ${m.ai ? 'Refresh' : 'Write'} AI insights</button>` : ''}</div>
      </div>
    </div>
    ${groups.length ? `<div class="section"><h3>Latest by student group / site</h3><div class="table-wrap"><table>
      <thead><tr><th>Group</th><th>Value</th><th>Dashboard color</th><th>Period</th></tr></thead><tbody>
      ${groups.sort((x, y) => (x.value - y.value) * L.goodSign(m)).map(g => `<tr><td>${esc(L.groupName(g.group))}</td><td class="num">${esc(L.fmtValue(g.value, m.unit))}</td><td>${g.color ? esc(L.COLOR_NAMES[g.color]) : ''}</td><td>${esc(g.period)}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    <div class="section"><h3>Results timeline</h3><div class="table-wrap"><table>
      <thead><tr><th>Period</th><th>Group</th><th>Value</th><th>As written / note</th><th>Source</th><th></th></tr></thead><tbody>
      ${pts.map(p => `<tr><td>${esc(p.period)}</td><td>${esc(L.groupName(p.group))}</td><td class="num">${esc(L.fmtValue(p.value, m.unit))}</td>
        <td style="max-width:360px">${esc(p.text)}</td><td>${esc(p.source)}</td><td><button class="x" title="Delete" data-del-point="${m.id}|${p.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No results yet.</td></tr>'}
      </tbody></table></div></div>
    <div class="section"><h3>Add a result</h3>
      <div class="add-row">
        <div class="field"><label class="lbl" for="np-period">Period</label><input class="ctl" id="np-period" placeholder="2025-26, Winter 2026, Dashboard 2025"></div>
        <div class="field"><label class="lbl" for="np-value">Value${m.unit ? ' (' + esc(m.unit === 'pts' ? 'points, below = negative' : m.unit) + ')' : ''}</label><input class="ctl" id="np-value" inputmode="decimal"></div>
        <div class="field"><label class="lbl" for="np-group">Group</label><input class="ctl" id="np-group" list="np-groups" value="ALL"><datalist id="np-groups">${Object.keys(L.GROUP_NAMES).concat(groupOpts).filter((v, i, a2) => a2.indexOf(v) === i).map(g => `<option value="${esc(g)}">${esc(L.groupName(g))}</option>`).join('')}</datalist></div>
        <div class="field"><label class="lbl" for="np-note">Note (optional)</label><input class="ctl" id="np-note"></div>
        <button class="btn" data-act="add-point">Add</button>
      </div></div>
    <details class="section"><summary style="cursor:pointer;font-size:12px;color:var(--muted)">Metric settings (name, indicator mapping, direction, target)</summary>
      <div class="grid3" style="margin-top:10px">
        <div class="field"><label class="lbl">Metric name</label><input class="ctl" id="ms-name" value="${esc(m.name)}"></div>
        <div class="field"><label class="lbl">Metric #</label><input class="ctl" id="ms-no" value="${esc(m.metricNo)}"></div>
        <div class="field"><label class="lbl">Indicators (e.g. 4A or 3A, 3B)</label><input class="ctl" id="ms-codes" value="${esc(m.codes.join(', '))}"></div>
        <div class="field"><label class="lbl">Better when</label><select class="ctl" id="ms-dir">
          ${[['up', 'Higher is better'], ['down', 'Lower is better'], ['maintain', 'Maintain the target']].map(([v, t]) => `<option value="${v}" ${m.direction === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label class="lbl">Unit</label><select class="ctl" id="ms-unit">${unitOpts.map(([v, t]) => `<option value="${v}" ${(m.unit || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label class="lbl">Target value</label><input class="ctl" id="ms-tv" inputmode="decimal" value="${m.targetValue ?? ''}"></div>
        <div class="field" style="grid-column:span 2"><label class="lbl">Target as written</label><input class="ctl" id="ms-tt" value="${esc(m.targetText)}"></div>
        <div class="field"><label class="lbl">Score progress using</label><select class="ctl" id="ms-group">${groupOpts.map(g => `<option value="${esc(g)}" ${m.primaryGroup === g ? 'selected' : ''}>${esc(L.groupName(g))}</option>`).join('')}</select></div>
      </div>
      <div class="actions" style="margin-top:10px"><button class="btn" data-act="save-metric">Save settings</button><button class="btn btn-danger" data-act="delete-metric">Delete metric</button></div>
      ${m.lcapText && m.lcapText.baseline != null ? `<div class="note-box" style="margin-top:12px"><strong>As written in the LCAP.</strong><br>Baseline: ${esc(m.lcapText.baseline)}<br>Year 1: ${esc(m.lcapText.y1 || '')}<br>Year 2: ${esc(m.lcapText.y2 || '')}<br>Target: ${esc(m.lcapText.target || '')}</div>` : ''}
    </details>`);
}

function addPointFromForm() {
  const d = D(); const m = d.metrics.find(x => x.id === S.modal.id);
  const period = $('np-period').value.trim(), raw = $('np-value').value.trim();
  if (!period) { toast('Enter a period, for example 2025-26 or Winter 2026.', true); return; }
  const value = raw === '' ? null : parseFloat(raw.replace(/[%,]/g, ''));
  if (raw !== '' && !isFinite(value)) { toast('Value must be a number.', true); return; }
  const before = L.analyze(m).status;
  L.addPoint(m, { period, value, group: I.groupCode($('np-group').value), text: $('np-note').value.trim(), source: 'Manual' });
  d.imports.push({ at: new Date().toISOString(), type: 'Manual entry', file: m.metricNo + ' ' + m.name, count: 1 });
  const after = L.analyze(m).status;
  S.flash.add(m.id);
  changed(); openMetric(m.id);
  toast(before !== after ? `Status changed: ${before} → ${after}` : `Result added. Status: ${after}.`);
}

function saveMetricSettings() {
  const d = D(); const m = d.metrics.find(x => x.id === S.modal.id);
  m.name = $('ms-name').value.trim();
  m.metricNo = $('ms-no').value.trim();
  m.goal = (m.metricNo.match(/^(\d+)/) || [])[1] || m.goal;
  m.codes = $('ms-codes').value.toUpperCase().split(/[\s,;]+/).filter(c => L.REQUIRED_BY_CODE[c]);
  m.direction = $('ms-dir').value;
  m.unit = $('ms-unit').value || null;
  const tv = $('ms-tv').value.trim();
  m.targetValue = tv === '' ? null : parseFloat(tv);
  m.targetText = $('ms-tt').value.trim();
  m.primaryGroup = $('ms-group').value;
  changed(); openMetric(m.id); toast('Metric updated.');
}

// ------------------------------------------------------------
// LCAP import + review
// ------------------------------------------------------------
async function handleLcapFile(file) {
  if (!/\.pdf$/i.test(file.name)) { toast('Choose the LCAP as a PDF file.', true); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  loading('Reading the LCAP…');
  try {
    const res = await P.extractLcapPdf(bytes.slice(), (n, t) => loading(`Reading page ${n} of ${t}…`));
    loading(null);
    openReview({ ...res, fileName: file.name, pdfBytes: bytes, method: 'Read offline from the PDF text' });
  } catch (e) {
    loading(null);
    toast('Could not read that PDF: ' + e.message, true);
  }
}

function openReview(r) {
  const d = D();
  S.review = r;
  S.modal = { type: 'review' };
  r.rows.forEach(row => { if (!row.codes) row.codes = L.inferCodes(row.metric); if (row.include == null) row.include = true; });
  const pages = [...new Set(r.rows.map(x => x.page))];
  const warn = !r.rows.length ? `<div class="note-box warn">No metrics tables were found${r.scanned ? '. The PDF looks scanned (no selectable text)' : ''}. ${S.apiKey ? 'Try <strong>Read with AI</strong> below.' : 'Add an API key in Settings &amp; AI to read unusual or scanned LCAPs, or add rows manually below.'}</div>` : '';
  const cell = (i, k) => `<textarea class="ctl" data-i="${i}" data-k="${k}">${esc(r.rows[i][k])}</textarea><div class="parsed" data-parsed="${i}-${k}">${esc(parsedLabel(r.rows[i][k]))}</div>`;
  const districtName = r.district || (d && !d.metrics.length ? d.name : '') || '';
  openModal(`
    ${modalHead('Review LCAP metrics', `${esc(r.fileName || '')}${r.pageCount ? ` · ${r.pageCount} pages` : ''} · ${esc(r.method || '')}`)}
    ${warn}
    ${r.rows.length ? `<div class="note-box">Found <strong>${r.rows.length} metrics</strong>${pages.length ? ` on ${esc(pages.slice(0, 8).join(', '))}${pages.length > 8 ? '…' : ''}` : ''}. Check the text and the <em>parsed</em> numbers under each cell; the tracker scores progress from those numbers. Fix anything that looks off before importing. You can also change it later.</div>` : ''}
    <div class="grid3">
      <div class="field"><label class="lbl" for="rv-name">District</label><input class="ctl" id="rv-name" value="${esc(districtName)}"></div>
      <div class="field"><label class="lbl" for="rv-cycle">LCAP cycle</label><select class="ctl" id="rv-cycle">
        ${[2024, 2027, 2030].map(y => `<option value="${y}" ${(r.cycleStart || 2024) === y ? 'selected' : ''}>${y}–${String(y + 3).slice(2)} (baseline ≈ ${y - 1}–${String(y).slice(2)})</option>`).join('')}</select></div>
      <div class="field"><label class="lbl" for="rv-target">Add to</label><select class="ctl" id="rv-target">
        <option value="new">A new district</option>
        ${Object.values(S.store.districts).map(x => `<option value="${x.id}" ${d && x.id === d.id && (!r.district || L.norm(x.name).toLowerCase() === L.norm(r.district).toLowerCase()) ? 'selected' : ''}>Update: ${esc(x.name)}</option>`).join('')}</select></div>
    </div>
    <div class="table-wrap section"><table class="review-table">
      <thead><tr><th></th><th>#</th><th>Metric</th><th>Indicators</th><th>Baseline</th><th>Year 1</th><th>Year 2</th><th>Target (Year 3)</th></tr></thead>
      <tbody>${r.rows.map((row, i) => `<tr>
        <td><input type="checkbox" data-inc="${i}" ${row.include ? 'checked' : ''} aria-label="Include"></td>
        <td style="width:62px"><input class="ctl" data-i="${i}" data-k="metricNo" value="${esc(row.metricNo)}"></td>
        <td style="min-width:170px"><textarea class="ctl" data-i="${i}" data-k="metric">${esc(row.metric)}</textarea><div class="parsed">${esc(row.page || '')}</div></td>
        <td style="width:86px"><input class="ctl" data-i="${i}" data-k="codes" value="${esc(row.codes.join(', '))}"></td>
        <td style="min-width:150px">${cell(i, 'baseline')}</td><td style="min-width:130px">${cell(i, 'y1')}</td>
        <td style="min-width:130px">${cell(i, 'y2')}</td><td style="min-width:130px">${cell(i, 'target')}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="actions section" style="justify-content:space-between">
      <div class="actions"><button class="btn btn-ghost" data-act="review-add-row">+ Add row</button>
        ${S.apiKey && r.pdfBytes ? '<button class="btn btn-ghost" data-act="review-ai">✦ Read with AI</button>' : ''}</div>
      <div class="actions"><button class="btn btn-ghost" data-act="close">Cancel</button><button class="btn" data-act="review-import" ${r.rows.length ? '' : 'disabled'}>Import ${r.rows.length} metrics</button></div>
    </div>`);
}

function parsedLabel(text) {
  if (!String(text || '').trim()) return '';
  const p = L.parseValue(text);
  return p.value == null ? 'parsed: (no number)' : `parsed: ${L.fmtValue(p.value, p.unit)}${p.period ? ' · ' + p.period : ''}`;
}

function reviewImport() {
  const r = S.review;
  const rows = r.rows.filter(x => x.include && (x.metric || x.metricNo)).map(x => ({ ...x,
    codes: String(Array.isArray(x.codes) ? x.codes.join(',') : x.codes).toUpperCase().split(/[\s,;]+/).filter(c => L.REQUIRED_BY_CODE[c]) }));
  if (!rows.length) { toast('Select at least one metric to import.', true); return; }
  const cycle = +$('rv-cycle').value;
  const name = $('rv-name').value.trim() || 'District';
  let d;
  if ($('rv-target').value === 'new') { d = L.newDistrict(name, cycle); addDistrict(d); }
  else { d = S.store.districts[$('rv-target').value]; S.store.currentId = d.id; d.name = name || d.name; d.cycleStart = d.cycleStart || cycle; }
  const before = new Map(d.metrics.map(m => [m.id, L.analyze(m).status]));
  const res = L.importLcapRows(d, rows, { cycleStart: cycle, sourceLabel: 'LCAP' });
  d.imports.push({ at: new Date().toISOString(), type: 'LCAP', file: r.fileName || 'LCAP', count: res.points });
  d.metrics.forEach(m => { if (before.size && (!before.has(m.id) || before.get(m.id) !== L.analyze(m).status)) S.flash.add(m.id); });
  closeModal(); S.view = 'dashboard'; changed();
  toast(`Imported ${res.added} new and ${res.updated} updated metrics (${res.points} results).`);
}

async function reviewWithAI() {
  const r = S.review;
  loading('Claude is reading the LCAP… this can take a minute or two.');
  try {
    let b64 = '';
    const bytes = r.pdfBytes;
    for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    b64 = btoa(b64);
    const out = await AI.extractLcap({ apiKey: S.apiKey, pdfBase64: b64, onText: n => loading(`Claude is reading the LCAP… (${n.toLocaleString()} characters received)`) });
    loading(null);
    openReview({ ...r, rows: out.rows, district: out.district || r.district, cycleStart: out.cycleStart || r.cycleStart, method: 'Read with AI' });
  } catch (e) { loading(null); toast('AI extraction failed: ' + e.message, true); }
}

// ------------------------------------------------------------
// Add data
// ------------------------------------------------------------
function metricOptions(d, selected, blank = true) {
  return (blank ? '<option value="">— skip —</option>' : '') + d.metrics.slice()
    .sort((a, b) => a.metricNo.localeCompare(b.metricNo, undefined, { numeric: true }))
    .map(m => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc((m.metricNo ? m.metricNo + ' ' : '') + m.name)} ${m.codes.length ? '(' + m.codes.join(',') + ')' : ''}</option>`).join('');
}

function openAddData() {
  S.modal = { type: 'add' };
  S.add = null;
  openModal(`
    ${modalHead('Add data', 'New results update statuses, insights, and the summary immediately')}
    <div class="grid2">
      <div class="drop" id="add-drop" style="padding:28px"><input type="file" id="add-file" accept=".csv,.txt,.tsv,.xlsx,.xls"><strong>Choose a data file</strong> or drag it here<br>
        <span style="font-size:11px">CSV template · CA Dashboard download (.txt) · NWEA MAP export · mCLASS export · DataQuest or any spreadsheet</span></div>
      <div class="start-card" style="padding:14px">
        <p style="font-size:12px;color:var(--text2)">No file? Download the <strong>CSV template</strong> (one row per metric), fill in the period and value, and upload it here. Or open any metric to type a single result.</p>
        <div class="actions"><button class="btn btn-ghost btn-sm" data-act="template">Download CSV template</button>
          <button class="btn btn-ghost btn-sm" data-act="manual-pick">Enter one result</button></div>
      </div>
    </div>
    <div id="add-step"></div>`);
}

async function handleDataFile(file) {
  try {
    loading('Reading ' + file.name + '…');
    const tables = await I.readTable(file);
    loading(null);
    if (!tables.length) { toast('No rows found in that file.', true); return; }
    S.add = { file: file.name, tables, sheet: 0, kind: I.detectKind(tables[0], file.name), cfg: {} };
    initAddConfig();
    renderAddStep();
  } catch (e) { loading(null); toast('Could not read that file: ' + e.message, true); }
}

function initAddConfig() {
  const d = D(), a = S.add, t = a.tables[a.sheet];
  const c = a.cfg = {};
  if (a.kind === 'dashboard') {
    c.indicator = I.dashboardIndicatorFromName(a.file) || 'ela';
    const def = I.DASH_INDICATORS[c.indicator];
    c.metricId = I.findMetric(d, def.codes, def.re, def.not)?.id || '';
    const ds = I.dashboardDistricts(t);
    const guess = ds.find(x => L.norm(x.name).toLowerCase().includes(L.norm(d.name).toLowerCase().split(' ')[0])) || ds[0];
    c.districtKey = guess ? guess.key : '';
    c.includeSites = false;
  } else if (a.kind === 'nwea') {
    const info = I.nweaInfo(t);
    const nw = d.metrics.find(m => /NWEA|\bMAP\b/i.test(m.name)) || I.findMetric(d, ['8A'], /local|other pupil/i);
    const pm = nw && (nw.name + ' ' + (nw.lcapText?.baseline || '') + ' ' + (nw.lcapText?.target || '')).match(/(\d{2})(?:st|nd|rd|th)?\s*percentile/i);
    c.threshold = pm ? +pm[1] : 61;
    c.map = {};
    const combined = nw && /math/i.test(nw.name + ' ' + (nw.lcapText?.baseline || '')) && /reading|ELA/i.test(nw.name + ' ' + (nw.lcapText?.baseline || ''));
    for (const s of info.subjects) {
      const sub = /math/i.test(s) ? 'Math' : /read/i.test(s) ? 'Reading' : s;
      const useful = /math|read/i.test(s);
      c.map[s] = { metricId: useful && nw ? nw.id : '', group: combined ? sub : 'ALL' };
    }
  } else if (a.kind === 'mclass') {
    c.metricId = (d.metrics.find(m => /mCLASS|DIBELS|early literacy/i.test(m.name)) || {}).id || '';
    const hasYear = I.col(t.headers, 'School Year', /school.?year/i);
    const now = new Date(); const sy = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    c.schoolYear = hasYear ? '' : `${sy}-${String(sy + 1).slice(2)}`;
    c.bySchool = false; c.byGrade = false;
  } else if (a.kind === 'generic') {
    const H = t.headers;
    c.metricId = '';
    const notValue = /county|code|cds|\bid\b|name|year|level|category|group/i;
    c.valueCol = H.find(h => /rate|percent|%/i.test(h) && !notValue.test(h))
      || H.find(h => /value|status|score|count\b/i.test(h) && !notValue.test(h)) || H[H.length - 1];
    c.periodCol = H.find(h => /year|period|term|date/i.test(h)) || '';
    c.periodFixed = '';
    c.groupCol = H.find(h => /group|subgroup|student ?group/i.test(h)) || '';
    c.filterCol = ''; c.filterVal = '';
  }
}

function proposalsFor() {
  const d = D(), a = S.add, t = a.tables[a.sheet], c = a.cfg;
  if (a.kind === 'template') return I.fromTemplate(t, d);
  if (a.kind === 'dashboard') return c.metricId ? I.fromDashboard(t, c) : { proposals: [], skipped: ['Choose the LCAP metric these results belong to.'] };
  if (a.kind === 'nwea') return I.fromNwea(t, c);
  if (a.kind === 'mclass') return c.metricId ? I.fromMclass(t, c) : { proposals: [], skipped: ['Choose the LCAP metric for mCLASS results.'] };
  if (!c.metricId || !c.valueCol) return { proposals: [], skipped: ['Choose a metric and a value column.'] };
  return I.fromGeneric(t, c);
}

function renderAddStep() {
  const d = D(), a = S.add, t = a.tables[a.sheet], c = a.cfg;
  const H = t.headers;
  const colOpts = (sel, blank) => (blank ? `<option value="">${blank}</option>` : '') + H.map(h => `<option ${h === sel ? 'selected' : ''}>${esc(h)}</option>`).join('');
  const kinds = { template: 'CSV template', dashboard: 'CA Dashboard file', nwea: 'NWEA MAP export', mclass: 'mCLASS export', generic: 'Other spreadsheet' };
  let form = '';
  if (a.kind === 'template') form = '<div class="note-box">Rows are matched to metrics by <strong>metric_no</strong>. Leave rows without a value blank to skip them.</div>';
  if (a.kind === 'dashboard') {
    const ds = I.dashboardDistricts(t);
    form = `<div class="grid3">
      <div class="field"><label class="lbl">Dashboard indicator</label><select class="ctl" data-cfg="indicator">${Object.entries(I.DASH_INDICATORS).map(([k, v]) => `<option value="${k}" ${c.indicator === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
      <div class="field"><label class="lbl">LCAP metric</label><select class="ctl" data-cfg="metricId">${metricOptions(d, c.metricId)}</select></div>
      <div class="field"><label class="lbl">District in file</label><select class="ctl" data-cfg="districtKey">${ds.map(x => `<option value="${esc(x.key)}" ${x.key === c.districtKey ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    </div><label style="font-size:12px;display:flex;gap:6px;margin-top:8px"><input type="checkbox" data-cfg="includeSites" ${c.includeSites ? 'checked' : ''}> Also record each school's All-students result</label>
    <p class="progress-line">All student groups are recorded, with Dashboard colors, so the tracker can flag groups in Red.</p>`;
  }
  if (a.kind === 'nwea') {
    const info = I.nweaInfo(t);
    form = `<div class="grid3"><div class="field"><label class="lbl">Count students at or above percentile</label><input class="ctl" type="number" min="1" max="99" data-cfg="threshold" value="${c.threshold}"></div>
      <div class="field" style="grid-column:span 2"><p class="progress-line">Terms found: ${esc(info.terms.join(', '))}. Student rows are summarized here and never saved.</p></div></div>
      <div class="table-wrap section"><table><thead><tr><th>Subject in file</th><th>LCAP metric</th><th>Record as group</th></tr></thead><tbody>
      ${info.subjects.map(s => `<tr><td>${esc(s)}</td><td><select class="ctl" data-nwea-metric="${esc(s)}">${metricOptions(d, c.map[s].metricId)}</select></td>
        <td><input class="ctl" data-nwea-group="${esc(s)}" value="${esc(c.map[s].group)}" title="ALL = the metric's main result; use a name like Math or Reading when one metric tracks several subjects"></td></tr>`).join('')}
      </tbody></table></div>`;
  }
  if (a.kind === 'mclass') {
    form = `<div class="grid3">
      <div class="field"><label class="lbl">LCAP metric</label><select class="ctl" data-cfg="metricId">${metricOptions(d, c.metricId)}</select></div>
      ${c.schoolYear !== '' || !I.col(H, 'School Year', /school.?year/i) ? `<div class="field"><label class="lbl">School year</label><input class="ctl" data-cfg="schoolYear" value="${esc(c.schoolYear)}"></div>` : '<div></div>'}
      <div class="field"><label class="lbl">Also record</label>
        <label style="font-size:12px;display:flex;gap:6px"><input type="checkbox" data-cfg="bySchool" ${c.bySchool ? 'checked' : ''}> each school</label>
        <label style="font-size:12px;display:flex;gap:6px"><input type="checkbox" data-cfg="byGrade" ${c.byGrade ? 'checked' : ''}> each grade</label></div>
    </div><p class="progress-line">Result = percent of students At or Above Benchmark on the DIBELS 8 composite, per benchmark period. Student rows are summarized here and never saved.</p>
    ${!c.metricId ? '<div class="note-box warn">Your LCAP has no mCLASS/DIBELS metric. Pick a related metric (for example 8A Other Pupil Outcomes) or add one from the Required Metrics tab.</div>' : ''}`;
  }
  if (a.kind === 'generic') {
    form = `<div class="grid3">
      <div class="field"><label class="lbl">LCAP metric</label><select class="ctl" data-cfg="metricId">${metricOptions(d, c.metricId)}</select></div>
      <div class="field"><label class="lbl">Value column</label><select class="ctl" data-cfg="valueCol">${colOpts(c.valueCol)}</select></div>
      <div class="field"><label class="lbl">Period column</label><select class="ctl" data-cfg="periodCol">${colOpts(c.periodCol, '(same period for all rows)')}</select></div>
      <div class="field"><label class="lbl">…or period for all rows</label><input class="ctl" data-cfg="periodFixed" value="${esc(c.periodFixed)}" placeholder="2025-26"></div>
      <div class="field"><label class="lbl">Student group column</label><select class="ctl" data-cfg="groupCol">${colOpts(c.groupCol, '(all rows = All students)')}</select></div>
      <div class="field"><label class="lbl">Only rows where</label><div style="display:flex;gap:6px"><select class="ctl" data-cfg="filterCol" style="flex:1">${colOpts(c.filterCol, '(no filter)')}</select><input class="ctl" data-cfg="filterVal" value="${esc(c.filterVal)}" placeholder="equals…" style="flex:1"></div></div>
    </div><p class="progress-line">DataQuest tip: filter on the aggregate-level column (for example "Aggregate Level" = D) to keep only district rows.</p>`;
  }
  const { proposals, skipped } = proposalsFor();
  const byId = Object.fromEntries(d.metrics.map(m => [m.id, m]));
  $('add-step').innerHTML = `
    <div class="section">
      <div class="kind-row">
        <span class="pill">${esc(a.file)}</span>
        ${a.tables.length > 1 ? `<select class="ctl" data-add="sheet">${a.tables.map((x, i) => `<option value="${i}" ${i === a.sheet ? 'selected' : ''}>Sheet: ${esc(x.name)}</option>`).join('')}</select>` : ''}
        <select class="ctl" data-add="kind">${Object.entries(kinds).map(([k, v]) => `<option value="${k}" ${k === a.kind ? 'selected' : ''}>Read as: ${v}</option>`).join('')}</select>
        <span class="pill">${t.rows.length.toLocaleString()} rows</span>
      </div>
      ${form}
    </div>
    <div class="section"><h3>Preview: ${proposals.length} result${proposals.length === 1 ? '' : 's'}</h3>
      ${skipped.length ? `<div class="note-box warn">${esc(skipped.slice(0, 4).join(' · '))}${skipped.length > 4 ? ` · +${skipped.length - 4} more` : ''}</div>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Metric</th><th>Period</th><th>Group</th><th>Value</th><th>Detail</th></tr></thead><tbody>
      ${proposals.slice(0, 60).map(p => `<tr><td>${esc(byId[p.metricId]?.metricNo || '')} ${esc(byId[p.metricId]?.name || '')}</td><td>${esc(p.period)}</td><td>${esc(L.groupName(p.group))}</td>
        <td class="num">${esc(L.fmtValue(p.value, byId[p.metricId]?.unit))}</td><td>${esc(p.text || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing to add yet.</td></tr>'}
      ${proposals.length > 60 ? `<tr><td colspan="5">…and ${proposals.length - 60} more</td></tr>` : ''}</tbody></table></div>
      <div class="actions section" style="justify-content:flex-end"><button class="btn btn-ghost" data-act="close">Cancel</button>
        <button class="btn" data-act="commit" ${proposals.length ? '' : 'disabled'}>Add ${proposals.length} result${proposals.length === 1 ? '' : 's'}</button></div>
    </div>`;
}

function commitAdd() {
  const d = D();
  const { proposals } = proposalsFor();
  const before = new Map(d.metrics.map(m => [m.id, L.analyze(m).status]));
  let added = 0, replaced = 0;
  const touched = new Set();
  for (const p of proposals) {
    const m = d.metrics.find(x => x.id === p.metricId);
    if (!m) continue;
    const r = L.addPoint(m, p);
    r.replaced ? replaced++ : added++;
    touched.add(m.id);
  }
  const kinds = { template: 'CSV template', dashboard: 'CA Dashboard', nwea: 'NWEA MAP', mclass: 'mCLASS', generic: 'Spreadsheet' };
  d.imports.push({ at: new Date().toISOString(), type: kinds[S.add.kind], file: S.add.file, count: added + replaced });
  const changes = [];
  touched.forEach(id => {
    const m = d.metrics.find(x => x.id === id);
    const now = L.analyze(m).status;
    S.flash.add(id);
    changes.push({ m, from: before.get(id), to: now });
  });
  changed();
  S.modal = { type: 'result' };
  const moved = changes.filter(c => c.from !== c.to);
  openModal(`${modalHead('Data added')}
    <p style="font-size:14px;margin-bottom:12px">${added} new result${added === 1 ? '' : 's'}${replaced ? ` and ${replaced} updated` : ''} across ${touched.size} metric${touched.size === 1 ? '' : 's'}.</p>
    ${moved.length ? `<h3 class="lbl">Status changes</h3><ul class="changes">${moved.map(c => `<li><strong>${esc(c.m.metricNo)} ${esc(c.m.name)}</strong>: ${badge(c.from)} → ${badge(c.to)}</li>`).join('')}</ul>`
      : '<p class="progress-line">No metric changed status, but insights and the next-cycle summary now include the new results.</p>'}
    ${S.apiKey && touched.size ? '<p class="progress-line">AI insights for these metrics are now out of date. Refresh them from the dashboard.</p>' : ''}
    <div class="actions section" style="justify-content:flex-end"><button class="btn" data-act="close">Done</button></div>`, true);
}

// ------------------------------------------------------------
// AI insights
// ------------------------------------------------------------
async function runAIInsights() {
  const d = D();
  if (!S.apiKey) { S.view = 'settings'; closeModal(); render(); toast('Add an API key first.', true); return; }
  const reopen = S.modal && S.modal.type === 'metric' ? S.modal.id : null;
  loading(`Claude is writing insights for ${d.metrics.length} metrics… this can take a minute or two.`);
  try {
    const n = await AI.writeInsights({ apiKey: S.apiKey, district: d, onText: k => loading(`Claude is writing insights… (${k.toLocaleString()} characters received)`) });
    loading(null); changed();
    if (reopen) openMetric(reopen);
    toast(`AI insights written for ${n} metrics and the next-cycle summary.`);
  } catch (e) { loading(null); toast('AI request failed: ' + e.message, true); }
}

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------
function wireDrop(el, onFile) {
  if (!el) return;
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('over'); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
}

function pickLcap() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.pdf';
  inp.onchange = () => inp.files[0] && handleLcapFile(inp.files[0]);
  inp.click();
}

function wire() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { S.view = t.dataset.view; render(); }));
  $('btn-import-lcap').addEventListener('click', pickLcap);
  $('welcome-pdf').addEventListener('change', e => e.target.files[0] && handleLcapFile(e.target.files[0]));
  wireDrop($('welcome-drop'), handleLcapFile);
  $('welcome-open').addEventListener('change', e => e.target.files[0] && openFile(e.target.files[0]));
  $('open-file').addEventListener('change', e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; });
  $('btn-example').addEventListener('click', () => window.EXAMPLE_DISTRICT && loadExtract(window.EXAMPLE_DISTRICT, 'Example: TBJUSD All State and Local Indicators'));
  $('btn-save').addEventListener('click', saveFile);
  $('btn-add-data').addEventListener('click', openAddData);
  $('btn-report').addEventListener('click', printReport);
  $('btn-guide').addEventListener('click', openGuide);
  $('draft-gap').addEventListener('change', e => { const v = Math.max(5, Math.min(100, +e.target.value || 30)); D().draftGap = v; changed(); });
  $('draft-body').addEventListener('input', e => {
    const id = e.target.dataset.draft; if (!id) return;
    const d = D(); d.draft = d.draft || {};
    d.draft[id] = { ...(d.draft[id] || {}), [e.target.dataset.k]: e.target.value };
    persist();
  });
  $('btn-draft-reset').addEventListener('click', () => { if (confirm('Discard your edits to the draft table?')) { D().draft = {}; changed(); } });
  $('btn-draft-copy').addEventListener('click', () => copyDraft(D()));
  $('btn-draft-csv').addEventListener('click', () => download(`${slug(D().name)}-next-cycle-metrics-draft.csv`, draftCsv(D()), 'text/csv'));
  $('btn-print').addEventListener('click', () => {
    const v = document.querySelector('.view.active'); if (!v) return;
    v.classList.add('printing'); window.print(); v.classList.remove('printing');
  });
  $('district-select').addEventListener('change', e => { S.store.currentId = e.target.value; persist(); render(); });

  // Dashboard filters
  $('tiles').addEventListener('click', e => { const t = e.target.closest('.tile'); if (!t) return; S.filter.status = S.filter.status === t.dataset.status ? '' : t.dataset.status; render(); });
  $('prio-chips').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; S.filter.prio = c.dataset.prio; render(); });
  $('type-filter').addEventListener('change', e => { S.filter.type = e.target.value; render(); });
  $('search').addEventListener('input', e => { S.filter.q = e.target.value.trim(); render(); });

  // Notes
  $('summary-grid').addEventListener('input', e => {
    const p = e.target.dataset.note; if (!p) return;
    D().notes[p] = e.target.value;
    document.querySelector(`[data-note-print="${p}"]`).textContent = e.target.value;
    persist();
  });
  $('btn-export-notes').addEventListener('click', exportNotes);

  // Log filters
  $('log-metric').addEventListener('change', render);
  $('log-source').addEventListener('change', render);

  // Settings
  $('set-name').addEventListener('change', e => { D().name = e.target.value.trim() || D().name; changed(); });
  $('set-cycle').addEventListener('change', e => { D().cycleStart = +e.target.value; changed(); });
  const saveKey = () => {
    S.apiKey = $('set-key').value.trim(); S.remember = $('set-remember').checked;
    try { if (S.remember && S.apiKey) localStorage.setItem(KEY_KEY, S.apiKey); else localStorage.removeItem(KEY_KEY); } catch (e) { /* storage blocked */ }
  };
  $('set-key').addEventListener('change', () => { saveKey(); toast(S.apiKey ? 'API key set. AI features are on.' : 'API key removed.'); });
  $('set-remember').addEventListener('change', saveKey);
  $('btn-new-district').addEventListener('click', () => {
    const name = prompt('District name'); if (!name) return;
    addDistrict(L.newDistrict(name.trim(), 2024)); S.view = 'dashboard'; render();
    toast('District created. Import its LCAP, or add metrics from the Required Metrics tab.');
  });
  $('btn-delete-district').addEventListener('click', () => {
    const d = D();
    if (!confirm(`Remove "${d.name}" from this browser? Save a district file first if you want to keep it.`)) return;
    delete S.store.districts[d.id];
    S.store.currentId = Object.keys(S.store.districts)[0] || null;
    S.view = 'dashboard'; persist(); render();
  });

  // Delegated actions (cards, modal buttons, tables)
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-metric],[data-act],[data-del-point],[data-add-code]');
    if (!el) { if (e.target === $('modal')) closeModal(); return; }
    if (el.dataset.metric) return openMetric(el.dataset.metric);
    if (el.dataset.addCode) {
      const r = L.REQUIRED_BY_CODE[el.dataset.addCode];
      const m = L.makeMetric({ name: r.name, codes: [r.code], metricNo: '' });
      m.direction = L.inferDirection(r.name, null, null, false);
      D().metrics.push(m); changed(); return openMetric(m.id);
    }
    if (el.dataset.delPoint) {
      const [mid, pid] = el.dataset.delPoint.split('|');
      const m = D().metrics.find(x => x.id === mid);
      const p = m && m.points.find(x => x.id === pid);
      if (!p || !confirm(`Delete the ${p.period} result (${L.groupName(p.group)})?`)) return;
      m.points = m.points.filter(x => x.id !== pid);
      changed(); if (S.modal && S.modal.type === 'metric') openMetric(mid);
      return;
    }
    const act = el.dataset.act;
    if (act === 'close') closeModal();
    else if (act === 'guide') openGuide();
    else if (act === 'ai-insights') runAIInsights();
    else if (act === 'add-point') addPointFromForm();
    else if (act === 'save-metric') saveMetricSettings();
    else if (act === 'delete-metric') {
      const d = D(); const m = d.metrics.find(x => x.id === S.modal.id);
      if (!confirm(`Delete metric "${m.name}" and all ${m.points.length} results?`)) return;
      d.metrics = d.metrics.filter(x => x.id !== m.id); closeModal(); changed();
    }
    else if (act === 'review-import') reviewImport();
    else if (act === 'review-ai') reviewWithAI();
    else if (act === 'review-add-row') {
      S.review.district = $('rv-name').value; S.review.cycleStart = +$('rv-cycle').value;
      S.review.rows.push({ metricNo: '', metric: '', baseline: '', y1: '', y2: '', target: '', diff: '', page: 'added', include: true, codes: [] });
      openReview(S.review);
    }
    else if (act === 'template') download(`${slug(D().name)}-lcap-results-template.csv`, I.templateCsv(D()), 'text/csv');
    else if (act === 'manual-pick') {
      S.modal = { type: 'pick' };
      openModal(`${modalHead('Enter one result')}<div class="field"><label class="lbl">Metric</label><select class="ctl" id="pick-metric">${metricOptions(D(), '', false)}</select></div>
        <div class="actions section" style="justify-content:flex-end"><button class="btn" data-act="pick-go">Continue</button></div>`, true);
    }
    else if (act === 'pick-go') openMetric($('pick-metric').value);
    else if (act === 'commit') commitAdd();
  });

  // Inputs inside the modal
  $('modal').addEventListener('input', e => {
    const t = e.target;
    if (S.modal?.type === 'review' && t.dataset.i != null) {
      const row = S.review.rows[+t.dataset.i];
      row[t.dataset.k] = t.value;
      const out = document.querySelector(`[data-parsed="${t.dataset.i}-${t.dataset.k}"]`);
      if (out) out.textContent = parsedLabel(t.value);
    }
  });
  $('modal').addEventListener('change', e => {
    const t = e.target;
    if (S.modal?.type === 'review' && t.dataset.inc != null) { S.review.rows[+t.dataset.inc].include = t.checked; return; }
    if (t.id === 'add-file' && t.files[0]) return handleDataFile(t.files[0]);
    if (!S.add) return;
    if (t.dataset.add === 'sheet') { S.add.sheet = +t.value; S.add.kind = I.detectKind(S.add.tables[S.add.sheet], S.add.file); initAddConfig(); return renderAddStep(); }
    if (t.dataset.add === 'kind') { S.add.kind = t.value; initAddConfig(); return renderAddStep(); }
    if (t.dataset.cfg) {
      const k = t.dataset.cfg;
      S.add.cfg[k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? +t.value : t.value;
      if (k === 'indicator') {
        const def = I.DASH_INDICATORS[t.value];
        S.add.cfg.metricId = I.findMetric(D(), def.codes, def.re, def.not)?.id || '';
      }
      return renderAddStep();
    }
    if (t.dataset.nweaMetric != null) { S.add.cfg.map[t.dataset.nweaMetric].metricId = t.value; return renderAddStep(); }
    if (t.dataset.nweaGroup != null) { S.add.cfg.map[t.dataset.nweaGroup].group = t.value.trim() || 'ALL'; return renderAddStep(); }
  });
  $('modal').addEventListener('dragover', e => { const z = e.target.closest('#add-drop'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  $('modal').addEventListener('drop', e => {
    const z = e.target.closest('#add-drop'); if (!z) return;
    e.preventDefault(); z.classList.remove('over');
    if (e.dataTransfer.files[0]) handleDataFile(e.dataTransfer.files[0]);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });

  // Chart tooltip
  document.addEventListener('mousemove', e => {
    const tip = $('chart-tip');
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    tip.textContent = el.dataset.tip; tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
  });
}

loadStore();
wire();
render();
window.LcapTrackerUI = { S, render, openMetric, handleLcapFile, handleDataFile };
})();
