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
// A district (container) holds plans; D() is the active plan, which has the
// same shape as a single-plan district so the views work on either plan.
const C = () => S.store.districts[S.store.currentId] || null;
const D = () => { const c = C(); return c ? (c.plans.find(p => p.id === c.activePlanId) || c.plans[0]) : null; };
const shortCycle = cs => cs ? `${cs}–${String(cs + 3).slice(2)}` : '';
const planTitle = p => p.kind === 'current' ? `${shortCycle(p.cycleStart)} LCAP · monitoring` : `Previous LCAP ${shortCycle(p.cycleStart)} · reflection`;
const cycleOptions = sel => Array.from({ length: 16 }, (_, i) => 2017 + i)
  .map(y => `<option value="${y}" ${+sel === y ? 'selected' : ''}>${L.cycleLabel(y)}</option>`).join('');
const roleOptions = (plan, sel) => ['baseline', 'y1', 'y2', 'y3'].map(r => `<option value="${r}" ${sel === r ? 'selected' : ''}>${esc(L.planYearLabel(plan, r))}</option>`).join('')
  + `<option value="" ${sel === '' ? 'selected' : ''}>Not an LCAP-year outcome (monitoring only)</option>`;
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
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.districts) {
      const out = {};
      for (const [k, v] of Object.entries(s.districts)) { const c = L.migrate(v); out[c.id] = c; if (s.currentId === k) s.currentId = c.id; }
      s.districts = out; S.store = s;
    }
  } catch (e) { /* private window or blocked storage */ }
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
function changed() { const d = D(); if (d) d.updatedAt = C().updatedAt = new Date().toISOString(); persist(); render(); }

function addDistrict(plan) {
  const c = L.newContainer(plan);
  S.store.districts[c.id] = c;
  S.store.currentId = c.id;
  S.filter = { status: '', prio: '', type: '', q: '' };
  persist();
}

function saveFile() {
  const d = C(); if (!d) return;
  const payload = { format: 'lcap-tracker', version: 2, savedAt: new Date().toISOString(), district: d };
  download(`${slug(d.name)}-lcap-tracker-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 1));
  toast('District file saved. Share it with your team or open it on another computer.');
}

async function openFile(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.format === 'lcap-tracker' && j.district && (Array.isArray(j.district.metrics) || Array.isArray(j.district.plans))) {
      const c = L.migrate(j.district);
      if (S.store.districts[c.id] && !confirm(`Replace the copy of "${c.name}" in this browser with the file's version (saved ${fmtDate(j.savedAt)})?`)) return;
      S.store.districts[c.id] = c; S.store.currentId = c.id; persist();
      render(); toast(`Opened ${c.name}.`);
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
  if (has && d.kind === 'current' && S.view === 'draft') S.view = 'dashboard';
  document.querySelector('.tab[data-view="draft"]').hidden = has && d.kind === 'current';
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', has && v.id === 'view-' + S.view));
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.view === S.view));
  if (!has) return;
  renderDistrictRow(d);
  const A = new Map(d.metrics.map(m => [m.id, L.analyze(m)]));
  if (S.view === 'dashboard') renderDashboard(d, A);
  if (S.view === 'summary') renderSummary(d);
  if (S.view === 'reflect') renderReflect(d);
  if (S.view === 'draft') renderDraft(d);
  if (S.view === 'coverage') renderCoverage(d, A);
  if (S.view === 'log') renderLog(d);
  if (S.view === 'settings') renderSettings(d);
}

function renderDistrictRow(d) {
  const c = C();
  $('district-select').innerHTML = Object.values(S.store.districts)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(x => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  $('plan-select').innerHTML = c.plans.slice().sort((a, b) => (a.cycleStart || 0) - (b.cycleStart || 0))
    .map(p => `<option value="${p.id}" ${p.id === d.id ? 'selected' : ''}>${esc(planTitle(p))}</option>`).join('');
  $('district-meta').textContent = `${d.metrics.length} metrics · updated ${fmtDate(d.updatedAt)}`;
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
    <div class="rpt-meta">${esc(planTitle(d))} · Prepared ${new Date().toLocaleDateString()} · ${d.metrics.length} metrics · ${covered} of 28 required LCFF metrics addressed</div>
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
// Reflection (previous LCAP) and annual update (current LCAP)
// ------------------------------------------------------------
const RATINGS = [['', 'Not rated'], ['effective', 'Effective'], ['somewhat', 'Somewhat effective'], ['not', 'Not effective'], ['unclear', 'Unclear / not enough data']];

function reflectKey(d) {
  if (d.kind !== 'current') return 'cycle';
  if (!S.reflectRole || !['y1', 'y2', 'y3'].includes(S.reflectRole)) {
    const r = L.currentRole(d); S.reflectRole = r === 'baseline' ? 'y1' : r;
  }
  return S.reflectRole;
}
function reflectTitle(d, key) {
  return d.kind === 'current' ? `Annual update: ${L.planYearLabel(d, key)}` : `Reflection on the previous LCAP (${L.cycleLabel(d.cycleStart)})`;
}

// Saved text wins; otherwise the draft is generated from current data.
function reflectText(d, key) {
  const saved = (d.reflections && d.reflections[key]) || {};
  const sum = L.summaryReflection(d);
  const goals = {};
  for (const g of L.planGoals(d)) {
    const gen = L.goalReflection(d, g.no, key);
    const sv = (saved.goals || {})[g.no] || {};
    goals[g.no] = { effectiveness: sv.effectiveness ?? gen.effectiveness, changes: sv.changes ?? gen.changes,
      editedE: sv.effectiveness != null, editedC: sv.changes != null };
  }
  const ss = saved.summary || {};
  return { summary: { successes: ss.successes ?? sum.successes, needs: ss.needs ?? sum.needs, editedS: ss.successes != null, editedN: ss.needs != null }, goals };
}

function templateTable(rows, withStatus, d) {
  const y3 = rows.some(r => r.y3);
  const A = withStatus ? new Map(d.metrics.map(m => [m.id, L.analyze(m)])) : null;
  return `<div class="table-wrap"><table><thead><tr><th>Metric #</th><th>Metric</th><th>Baseline</th><th>Year 1 Outcome</th><th>Year 2 Outcome</th>${y3 ? '<th>Year 3 Outcome</th>' : ''}<th>Target for Year 3 Outcome</th><th>Current Difference from Baseline</th>${withStatus ? '<th>Status</th>' : ''}</tr></thead><tbody>
    ${rows.map(r => `<tr><td class="num">${esc(r.metricNo)}</td><td><button class="linkish" data-metric="${r.id}">${esc(r.metric)}</button></td><td>${esc(r.baseline)}</td><td>${esc(r.y1)}</td><td>${esc(r.y2)}</td>${y3 ? `<td>${esc(r.y3)}</td>` : ''}<td>${esc(r.target)}</td><td class="num">${esc(r.diff)}</td>${withStatus ? `<td>${badge(A.get(r.id).status)}</td>` : ''}</tr>`).join('')
      || `<tr><td colspan="${withStatus ? 9 : 8}" class="empty">No metrics for this goal.</td></tr>`}</tbody></table></div>`;
}

function renderReflect(d) {
  const key = reflectKey(d);
  const T = reflectText(d, key);
  const rows = L.templateRows(d);
  const c = C();
  const next = c.plans.find(p => p.kind === 'current');
  const rev = a => L.actionReview(a, key);
  const editedTag = (ed, field) => ed ? `<button class="linkish no-print" data-redraft="${field}" title="Replace your edits with a fresh draft from the data">↺ Redraft from data</button>` : '<span class="src-tag">Draft from data. Edit freely.</span>';
  const goalHtml = L.planGoals(d).map(g => {
    const acts = (d.actions || []).filter(a => String(a.goal) === String(g.no));
    const t = T.goals[g.no];
    return `<section class="refl-card">
      <div class="refl-goal-head"><h3>Goal ${esc(g.no)}</h3>${g.type ? `<span class="pill">${esc(g.type)}</span>` : ''}</div>
      <textarea class="ctl goal-desc" data-goal-desc="${esc(g.no)}" rows="2" placeholder="Goal description (from the LCAP)">${esc(g.description)}</textarea>
      <h4>Measuring and reporting results</h4>
      ${templateTable(rows.filter(r => String(r.goal) === String(g.no)), true, d)}
      <h4>Actions${acts.length ? '' : ' <span class="src-tag">None found in the PDF. Add them to rate effectiveness.</span>'}</h4>
      ${acts.length ? `<div class="table-wrap"><table class="actions-table"><thead><tr><th>#</th><th>Title</th><th>Total funds</th><th>Contributing</th><th>Effectiveness</th><th>Evidence / notes</th><th></th></tr></thead><tbody>
        ${acts.map(a => `<tr><td class="num">${esc(a.no)}</td><td><strong>${esc(a.title)}</strong><div class="act-desc">${esc(a.description)}</div></td>
          <td class="num">${esc(a.funds)}</td><td>${esc(a.contributing)}</td>
          <td><select class="ctl" data-act-rating="${a.id}">${RATINGS.map(([v, l]) => `<option value="${v}" ${rev(a).rating === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          <td><textarea class="ctl" rows="2" data-act-evidence="${a.id}" placeholder="What shows it worked or not?">${esc(rev(a).evidence || '')}</textarea></td>
          <td><button class="x no-print" title="Remove action" data-del-action="${a.id}">✕</button></td></tr>`).join('')}</tbody></table></div>` : ''}
      <button class="btn btn-ghost btn-sm no-print" data-add-action="${esc(g.no)}" style="margin-top:8px">+ Add action</button>
      <div class="refl-text">
        <label class="lbl">How effective were the actions in making progress toward the goal? ${editedTag(t.editedE, `goals.${g.no}.effectiveness`)}</label>
        <textarea class="ctl refl" data-refl="goals.${esc(g.no)}.effectiveness" rows="6">${esc(t.effectiveness)}</textarea>
        <div class="notes-print">${esc(t.effectiveness)}</div>
        <label class="lbl">Changes to the goal, metrics, targets, or actions ${editedTag(t.editedC, `goals.${g.no}.changes`)}</label>
        <textarea class="ctl refl" data-refl="goals.${esc(g.no)}.changes" rows="4">${esc(t.changes)}</textarea>
        <div class="notes-print">${esc(t.changes)}</div>
      </div>
    </section>`;
  }).join('');
  $('reflect-body').innerHTML = `
    <div class="refl-head">
      <div><h2>${esc(reflectTitle(d, key))}</h2>
        <p class="refl-sub">${d.kind === 'current'
          ? 'Add each year\'s results with <strong>+ Add Data</strong> (they fill the Year 1 and Year 2 outcome columns), rate the actions, and edit the drafts for the annual update.'
          : 'Drafts for the new LCAP template\'s reflection sections, built from this plan\'s results. Rate each action, add evidence, and edit the text. Drafts refresh from the data until you edit them.'}</p></div>
      ${d.kind === 'current' ? `<label class="lbl no-print">Year<select class="ctl" id="reflect-year">${['y1', 'y2', 'y3'].map(r => `<option value="${r}" ${key === r ? 'selected' : ''}>${esc(L.planYearLabel(d, r))}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="toolbar">
      ${S.apiKey ? '<button class="btn btn-ghost" id="btn-refl-ai">✦ Draft with AI</button>' : ''}
      <button class="btn btn-ghost" id="btn-refl-redraft">Redraft all from data</button>
      <button class="btn btn-ghost" id="btn-refl-table">Copy metrics table</button>
      <button class="btn" id="btn-refl-copy">Copy reflections (paste into Word)</button>
    </div>
    <section class="refl-card">
      <h3>Plan Summary: Reflections, Annual Performance</h3>
      <label class="lbl">Successes ${editedTag(T.summary.editedS, 'summary.successes')}</label>
      <textarea class="ctl refl" data-refl="summary.successes" rows="4">${esc(T.summary.successes)}</textarea>
      <div class="notes-print">${esc(T.summary.successes)}</div>
      <label class="lbl">Identified needs (lowest performance, student groups in Red, unmet metrics) ${editedTag(T.summary.editedN, 'summary.needs')}</label>
      <textarea class="ctl refl" data-refl="summary.needs" rows="5">${esc(T.summary.needs)}</textarea>
      <div class="notes-print">${esc(T.summary.needs)}</div>
    </section>
    ${goalHtml || '<div class="empty">No goals yet. Import an LCAP to begin.</div>'}
    ${d.kind !== 'current' ? `<section class="refl-card next-plan no-print">
      <h3>Start the next LCAP</h3>
      ${next ? `<p>This district already has a <strong>${esc(planTitle(next))}</strong> plan. <button class="linkish" data-open-plan="${next.id}">Open it →</button> Creating it again replaces that plan and its results.</p>` : ''}
      <p>Creates the new three-year plan from this one: the same goals, metrics${(d.actions || []).length ? ', and actions' : ''}, with the <strong>Next-Cycle Draft</strong> baselines and targets (edit them there first). Then add each year's results to it.</p>
      <div class="actions" style="align-items:center">
        <label class="lbl" style="margin:0">New cycle <select class="ctl" id="np-cycle">${cycleOptions((d.cycleStart || 2023) + 3)}</select></label>
        ${(d.actions || []).length ? '<label style="font-size:12px;display:flex;gap:6px"><input type="checkbox" id="np-actions" checked> Copy actions</label>' : ''}
        <button class="btn" id="btn-create-plan">${next ? 'Recreate' : 'Create'} the new LCAP</button>
      </div></section>` : ''}`;
}

function setReflect(d, path, value) {
  const key = reflectKey(d);
  d.reflections = d.reflections || {};
  const root = d.reflections[key] ||= {};
  const parts = path.split('.');
  let o = root;
  for (const p of parts.slice(0, -1)) o = o[p] ||= {};
  if (value === undefined) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = value;
}

function createPlan(prior, cycleStart, includeActions) {
  const c = C();
  const existing = c.plans.find(p => p.kind === 'current');
  if (existing && !confirm(`Replace the existing ${planTitle(existing)} and its ${existing.metrics.reduce((n, m) => n + m.points.length, 0)} results?`)) return;
  const plan = L.newPlanFromPrior(prior, { cycleStart, draftRows: draftRows(prior), includeActions });
  c.plans = c.plans.filter(p => p !== existing).concat(plan);
  c.activePlanId = plan.id;
  plan.imports.push({ at: new Date().toISOString(), type: 'New plan', file: `Started from ${planTitle(prior)}`, count: plan.metrics.length });
  S.view = 'dashboard'; S.reflectRole = null; changed();
  toast(`Created the ${shortCycle(cycleStart)} LCAP with ${plan.metrics.length} metrics. Add each year's results with + Add Data.`);
}

function reflectionHtml(d) {
  const key = reflectKey(d);
  const T = reflectText(d, key);
  const rows = L.templateRows(d);
  const p = s => `<p style="font-family:Arial;font-size:11pt">${esc(s)}</p>`;
  const tbl = rs => { const y3 = rs.some(r => r.y3); const cols = ['Metric #', 'Metric', 'Baseline', 'Year 1 Outcome', 'Year 2 Outcome', ...(y3 ? ['Year 3 Outcome'] : []), 'Target for Year 3 Outcome', 'Current Difference from Baseline'];
    return `<table style="border-collapse:collapse;font-family:Arial;font-size:10pt"><tr>${cols.map(h => `<th style="border:1px solid #999;padding:4px;background:#eee">${esc(h)}</th>`).join('')}</tr>
    ${rs.map(r => `<tr>${[r.metricNo, r.metric, r.baseline, r.y1, r.y2, ...(y3 ? [r.y3] : []), r.target, r.diff].map(v => `<td style="border:1px solid #999;padding:4px;vertical-align:top">${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`; };
  let html = `<h2 style="font-family:Arial">${esc(C().name)}: ${esc(reflectTitle(d, key))}</h2>
    <h3 style="font-family:Arial">Reflections: Annual Performance</h3><p style="font-family:Arial;font-size:11pt"><strong>Successes.</strong> ${esc(T.summary.successes)}</p><p style="font-family:Arial;font-size:11pt"><strong>Identified needs.</strong> ${esc(T.summary.needs)}</p>`;
  for (const g of L.planGoals(d)) {
    const acts = (d.actions || []).filter(a => String(a.goal) === String(g.no));
    html += `<h3 style="font-family:Arial">Goal ${esc(g.no)}</h3>${g.description ? p(g.description) : ''}${tbl(rows.filter(r => String(r.goal) === String(g.no)))}`;
    if (acts.length) html += `<p style="font-family:Arial;font-size:11pt"><strong>Actions reviewed:</strong> ${acts.map(a => `${esc(a.no)} ${esc(a.title)} (${esc(RATINGS.find(x => x[0] === (L.actionReview(a, key).rating || ''))[1].toLowerCase())})`).join('; ')}</p>`;
    html += `<p style="font-family:Arial;font-size:11pt"><strong>Effectiveness of the actions.</strong> ${esc(T.goals[g.no].effectiveness)}</p><p style="font-family:Arial;font-size:11pt"><strong>Changes resulting from reflection.</strong> ${esc(T.goals[g.no].changes)}</p>`;
  }
  const text = html.replace(/<\/(p|h2|h3|tr)>/g, '\n').replace(/<\/t[dh]>/g, '\t').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return { html, text };
}

async function runAIReflections() {
  const d = D(); const key = reflectKey(d);
  const saved = d.reflections && d.reflections[key];
  if (saved && (saved.summary || saved.goals) && !confirm('Replace your edited reflection text with AI drafts?')) return;
  loading('Claude is drafting the reflections… this can take a minute or two.');
  try {
    const out = await AI.writeReflections({ apiKey: S.apiKey, plan: d, key, yearLabel: reflectTitle(d, key), onText: k => loading(`Claude is drafting the reflections… (${k.toLocaleString()} characters received)`) });
    d.reflections = d.reflections || {};
    d.reflections[key] = { summary: { successes: out.successes, needs: out.needs },
      goals: Object.fromEntries(out.goals.map(g => [String(g.goal), { effectiveness: g.effectiveness, changes: g.changes }])) };
    loading(null); changed(); toast('AI drafts added. Review and edit them before using them in the LCAP.');
  } catch (e) { loading(null); toast('AI request failed: ' + e.message, true); }
}

async function copyHtml(html, text, msg) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } catch (e) {
    const box = document.createElement('div');
    box.innerHTML = html; box.style.position = 'fixed'; box.style.left = '-9999px';
    document.body.appendChild(box);
    const range = document.createRange(); range.selectNodeContents(box);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    document.execCommand('copy'); sel.removeAllRanges(); box.remove();
  }
  toast(msg);
}

// ------------------------------------------------------------
// Guide
// ------------------------------------------------------------
function openGuide() {
  S.modal = { type: 'guide' };
  openModal(`${modalHead('Using the LCAP Tracker for the new LCAP cycle', 'Reflect on the previous LCAP, build the new three-year plan, then update it each year')}
  <div class="guide">
    <p>A district keeps two plans in the tracker: the <strong>previous LCAP</strong>, which it reflects on, and the <strong>new three-year LCAP</strong> (for example 2026–27 through 2028–29), which it monitors each year. Switch between them with the plan menu under the district name.</p>
    <h3><span class="when">Part 1 · Reflect on the previous LCAP</span><br>1. Import the previous LCAP</h3>
    <ol><li>Choose <strong>Import LCAP</strong>, select the PDF, and on the review screen choose <em>"The previous LCAP"</em> and its three-year cycle.</li>
      <li>Check each metric's <em>parsed</em> numbers and its <em>Indicators</em> (1A–8A). The tracker also reads each goal's description and its actions.</li></ol>
    <h3>2. Add the newest results</h3>
    <ul><li><strong>+ Add Data</strong>: California School Dashboard files (every student group and color), NWEA MAP, mCLASS, DataQuest, the CSV template, or single results. Choose which LCAP year each upload <em>counts toward</em>.</li>
      <li>NWEA and mCLASS student rows are summarized into percentages on this computer and are never saved or sent.</li></ul>
    <h3>3. Write the reflections (Reflection tab)</h3>
    <ul><li>For each goal: review the metrics against their targets, rate each action (effective, somewhat, not effective, unclear), and add evidence.</li>
      <li>The tracker drafts <em>how effective the actions were</em> and <em>changes resulting from reflection</em> for each goal, plus the Plan Summary's <em>successes</em> and <em>identified needs</em>. Edit the drafts; <strong>Copy reflections</strong> pastes them into the template in Word.</li>
      <li>Use the <strong>Next-Cycle Summary</strong>, <strong>Summary Report</strong>, and <strong>Required Metrics</strong> tabs with educational partners.</li></ul>
    <h3><span class="when">Part 2 · Build the new plan</span><br>4. Draft the new metrics and start the new LCAP</h3>
    <ul><li><strong>Next-Cycle Draft</strong> lists every metric with its latest result as the new baseline and a suggested Year 3 target. Edit targets with your team.</li>
      <li>Choose <strong>Create the new LCAP</strong>. The tracker copies the goals, metrics, and actions into a new three-year plan with those baselines and targets.</li>
      <li>After the board adopts the plan, you can import the adopted LCAP PDF as <em>"The current three-year LCAP"</em> to replace the draft.</li></ul>
    <h3><span class="when">Part 3 · Every year of the new plan</span><br>5. Add the year's results and write the annual update</h3>
    <ul><li>Each year (2026–27, 2027–28, 2028–29), add results with <strong>+ Add Data</strong> and choose the LCAP year they count toward. They fill the template's Year 1 and Year 2 outcome columns and the current difference from baseline.</li>
      <li>On the <strong>Reflection</strong> tab, pick the year, rate the actions, and edit the drafted goal analysis and annual performance reflections.</li></ul>
    <h3>Saving and sharing</h3>
    <ul><li>Work is kept in this browser. <strong>Save File</strong> creates a district file with both plans that your LCAP team can open on any computer with <strong>Open File</strong>.</li>
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
  $('set-cycle').innerHTML = cycleOptions(d.cycleStart || 2023);
  $('set-name').value = C().name;
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
        <div class="field"><label class="lbl" for="np-role">Counts toward</label><select class="ctl" id="np-role">${roleOptions(D(), L.currentRole(D()))}</select></div>
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
  const role = $('np-role').value || null;
  L.addPoint(m, { period, value, group: I.groupCode($('np-group').value), text: $('np-note').value.trim(), source: 'Manual',
    role, order: role ? L.roleOrder(d, role, period) : undefined });
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
  const c = C();
  const districtName = r.district || (c && !d.metrics.length ? c.name : '') || '';
  const sameName = x => !r.district || L.norm(x.name).toLowerCase() === L.norm(r.district).toLowerCase();
  const targetId = r.targetId ?? (c && sameName(c) ? c.id : 'new');
  const target = S.store.districts[targetId];
  const kind = r.kind || (target && target.plans.some(p => p.kind === 'prior') && !target.plans.some(p => p.kind === 'current') ? 'current' : 'prior');
  const cycle = r.cycleStart || (kind === 'current' ? (r.lcapYear || 2026) : (r.lcapYear ? r.lcapYear - 2 : 2023));
  const existing = target && target.plans.find(p => p.kind === kind);
  const counts = [r.goals && r.goals.length ? `${r.goals.length} goals` : '', r.actions && r.actions.length ? `${r.actions.length} actions` : ''].filter(Boolean);
  openModal(`
    ${modalHead('Review LCAP metrics', `${esc(r.fileName || '')}${r.pageCount ? ` · ${r.pageCount} pages` : ''} · ${esc(r.method || '')}`)}
    ${warn}
    ${r.rows.length ? `<div class="note-box">Found <strong>${r.rows.length} metrics</strong>${pages.length ? ` on ${esc(pages.slice(0, 8).join(', '))}${pages.length > 8 ? '…' : ''}` : ''}${counts.length ? `, plus <strong>${counts.join(' and ')}</strong> (used for reflections)` : ''}. Check the text and the <em>parsed</em> numbers under each cell; the tracker scores progress from those numbers. Fix anything that looks off before importing. You can also change it later.</div>` : ''}
    <div class="grid2">
      <div class="field"><label class="lbl" for="rv-name">District</label><input class="ctl" id="rv-name" value="${esc(districtName)}"></div>
      <div class="field"><label class="lbl" for="rv-target">Add to</label><select class="ctl" id="rv-target" data-rv="targetId">
        <option value="new">A new district</option>
        ${Object.values(S.store.districts).map(x => `<option value="${x.id}" ${x.id === targetId ? 'selected' : ''}>Update: ${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label class="lbl" for="rv-kind">This LCAP is</label><select class="ctl" id="rv-kind" data-rv="kind">
        <option value="prior" ${kind === 'prior' ? 'selected' : ''}>The previous LCAP: reflect on it and draft the next plan</option>
        <option value="current" ${kind === 'current' ? 'selected' : ''}>The current three-year LCAP: monitor it each year</option></select></div>
      <div class="field"><label class="lbl" for="rv-cycle">Three-year cycle</label><select class="ctl" id="rv-cycle" data-rv="cycleStart">${cycleOptions(cycle)}</select></div>
    </div>
    ${existing && existing.metrics.length ? `<label style="font-size:12px;display:flex;gap:6px;margin-top:8px"><input type="checkbox" id="rv-replace" ${existing.fromPlanId ? 'checked' : ''}>
      Replace the ${existing.metrics.length} metrics, goals, and actions already in this district's ${kind === 'current' ? 'current' : 'previous'} LCAP${existing.fromPlanId ? ' (currently a draft started from the previous LCAP)' : ''}. Unchecked: update matching metrics and add new ones.</label>` : ''}
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

function mergeGoalsActions(d, goals, actions) {
  d.goals = d.goals || []; d.actions = d.actions || [];
  for (const g of goals) {
    const old = d.goals.find(x => String(x.no) === String(g.no));
    if (old) Object.assign(old, { description: g.description || old.description, type: g.type || old.type });
    else d.goals.push({ no: String(g.no), description: g.description || '', type: g.type || '' });
  }
  for (const a of actions) {
    const old = d.actions.find(x => String(x.no) === String(a.no));
    const fields = { goal: String(a.goal || String(a.no).split('.')[0]), no: String(a.no), title: a.title || '', description: a.description || '',
      funds: a.funds || '', contributing: a.contributing || '' };
    if (old) Object.assign(old, fields);
    else d.actions.push({ id: L.uid(), ...fields, rating: '', evidence: '' });
  }
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
  const kind = $('rv-kind').value;
  const name = $('rv-name').value.trim() || 'District';
  let d;
  if ($('rv-target').value === 'new') { d = { ...L.newDistrict(name, cycle), kind }; addDistrict(d); }
  else {
    const c = S.store.districts[$('rv-target').value];
    S.store.currentId = c.id; c.name = name || c.name;
    d = c.plans.find(p => p.kind === kind);
    if (!d) { d = { ...L.newDistrict(c.name, cycle), kind }; c.plans.push(d); }
    else if ($('rv-replace') && $('rv-replace').checked) { d.metrics = []; d.goals = []; d.actions = []; d.reflections = {}; delete d.fromPlanId; }
    d.cycleStart = cycle; c.activePlanId = d.id; c.plans.forEach(p => p.name = c.name);
  }
  const before = new Map(d.metrics.map(m => [m.id, L.analyze(m).status]));
  const res = L.importLcapRows(d, rows, { cycleStart: cycle, sourceLabel: 'LCAP' });
  mergeGoalsActions(d, r.goals || [], r.actions || []);
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
    openReview({ ...r, rows: out.rows, goals: out.goals, actions: out.actions, district: out.district || r.district, lcapYear: out.lcapYear || r.lcapYear, method: 'Read with AI' });
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
    S.add = { file: file.name, tables, sheet: 0, kind: I.detectKind(tables[0], file.name), cfg: {}, role: L.currentRole(D()) };
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
        <label style="font-size:12px;display:flex;gap:6px;align-items:center;margin-left:auto">Counts toward
          <select class="ctl" data-add="role">${roleOptions(d, a.role)}</select></label>
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
    const role = S.add.role || null;
    const r = L.addPoint(m, { ...p, role, order: role ? L.roleOrder(d, role, p.period) : p.order });
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
  // Reflection view
  const rv = $('view-reflect');
  rv.addEventListener('input', e => {
    const t = e.target, d = D();
    if (t.dataset.refl) {
      setReflect(d, t.dataset.refl, t.value);
      const pr = t.nextElementSibling; if (pr && pr.classList.contains('notes-print')) pr.textContent = t.value;
      persist();
    } else if (t.dataset.goalDesc != null) {
      d.goals = d.goals || [];
      let g = d.goals.find(x => String(x.no) === t.dataset.goalDesc);
      if (!g) { g = { no: t.dataset.goalDesc, description: '', type: '' }; d.goals.push(g); }
      g.description = t.value; persist();
    }
  });
  rv.addEventListener('change', e => {
    const t = e.target, d = D();
    if (t.id === 'reflect-year') { S.reflectRole = t.value; return render(); }
    const act = (d.actions || []).find(a => a.id === (t.dataset.actRating || t.dataset.actEvidence));
    if (!act) return;
    const key = reflectKey(d);
    act.ratings = act.ratings || {};
    const cur = { ...L.actionReview(act, key) };
    if (t.dataset.actRating != null) cur.rating = t.value; else cur.evidence = t.value.trim();
    act.ratings[key] = cur;
    changed();
  });
  rv.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    const d = D();
    if (t.dataset.redraft) { setReflect(d, t.dataset.redraft, undefined); changed(); }
    else if (t.dataset.addAction) {
      const title = prompt(`Title of the new action for Goal ${t.dataset.addAction}`); if (!title) return;
      const nums = (d.actions || []).filter(a => String(a.goal) === t.dataset.addAction).map(a => +String(a.no).split('.')[1] || 0);
      (d.actions ||= []).push({ id: L.uid(), goal: t.dataset.addAction, no: `${t.dataset.addAction}.${(nums.length ? Math.max(...nums) : 0) + 1}`,
        title: title.trim(), description: '', funds: '', contributing: '', rating: '', evidence: '' });
      changed();
    }
    else if (t.dataset.delAction) {
      const a = d.actions.find(x => x.id === t.dataset.delAction);
      if (a && confirm(`Remove action ${a.no} ${a.title}?`)) { d.actions = d.actions.filter(x => x !== a); changed(); }
    }
    else if (t.dataset.openPlan) { C().activePlanId = t.dataset.openPlan; S.view = 'dashboard'; persist(); render(); }
    else if (t.id === 'btn-refl-ai') runAIReflections();
    else if (t.id === 'btn-refl-redraft') {
      if (!confirm('Replace all edited reflection text on this page with fresh drafts from the data? Action ratings and evidence are kept.')) return;
      if (d.reflections) delete d.reflections[reflectKey(d)]; changed();
    }
    else if (t.id === 'btn-refl-copy') { const r = reflectionHtml(d); copyHtml(r.html, r.text, 'Reflections copied. Paste them into the LCAP template in Word.'); }
    else if (t.id === 'btn-refl-table') {
      const rows = L.templateRows(d); const y3 = rows.some(r => r.y3);
      const cols = ['Metric #', 'Metric', 'Baseline', 'Year 1 Outcome', 'Year 2 Outcome', ...(y3 ? ['Year 3 Outcome'] : []), 'Target for Year 3 Outcome', 'Current Difference from Baseline'];
      const vals = r => [r.metricNo, r.metric, r.baseline, r.y1, r.y2, ...(y3 ? [r.y3] : []), r.target, r.diff];
      const html = `<table style="border-collapse:collapse;font-family:Arial;font-size:10pt"><tr>${cols.map(h => `<th style="border:1px solid #999;padding:4px;background:#eee">${esc(h)}</th>`).join('')}</tr>${rows.map(r => `<tr>${vals(r).map(v => `<td style="border:1px solid #999;padding:4px">${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`;
      copyHtml(html, [cols.join('\t'), ...rows.map(r => vals(r).join('\t'))].join('\n'), 'Metrics table copied. Paste it into the LCAP template in Word.');
    }
    else if (t.id === 'btn-create-plan') createPlan(d, +$('np-cycle').value, $('np-actions') ? $('np-actions').checked : false);
  });
  $('btn-draft-create').addEventListener('click', () => createPlan(D(), (D().cycleStart || 2023) + 3, true));

  $('btn-draft-reset').addEventListener('click', () => { if (confirm('Discard your edits to the draft table?')) { D().draft = {}; changed(); } });
  $('btn-draft-copy').addEventListener('click', () => copyDraft(D()));
  $('btn-draft-csv').addEventListener('click', () => download(`${slug(D().name)}-next-cycle-metrics-draft.csv`, draftCsv(D()), 'text/csv'));
  $('btn-print').addEventListener('click', () => {
    const v = document.querySelector('.view.active'); if (!v) return;
    v.classList.add('printing'); window.print(); v.classList.remove('printing');
  });
  $('district-select').addEventListener('change', e => { S.store.currentId = e.target.value; persist(); render(); });
  $('plan-select').addEventListener('change', e => { C().activePlanId = e.target.value; S.filter.status = ''; persist(); render(); });

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
  $('set-name').addEventListener('change', e => { const c = C(); c.name = e.target.value.trim() || c.name; c.plans.forEach(p => p.name = c.name); changed(); });
  $('set-cycle').addEventListener('change', e => { D().cycleStart = +e.target.value; changed(); });
  const saveKey = () => {
    S.apiKey = $('set-key').value.trim(); S.remember = $('set-remember').checked;
    try { if (S.remember && S.apiKey) localStorage.setItem(KEY_KEY, S.apiKey); else localStorage.removeItem(KEY_KEY); } catch (e) { /* storage blocked */ }
  };
  $('set-key').addEventListener('change', () => { saveKey(); toast(S.apiKey ? 'API key set. AI features are on.' : 'API key removed.'); });
  $('set-remember').addEventListener('change', saveKey);
  $('btn-new-district').addEventListener('click', () => {
    const name = prompt('District name'); if (!name) return;
    addDistrict(L.newDistrict(name.trim(), 2023)); S.view = 'dashboard'; render();
    toast('District created. Import its LCAP, or add metrics from the Required Metrics tab.');
  });
  $('btn-delete-district').addEventListener('click', () => {
    const d = C();
    if (!confirm(`Remove "${d.name}" (all plans) from this browser? Save a district file first if you want to keep it.`)) return;
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
      S.review.district = $('rv-name').value; S.review.cycleStart = +$('rv-cycle').value; S.review.kind = $('rv-kind').value; S.review.targetId = $('rv-target').value;
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
    if (S.modal?.type === 'review' && t.dataset.rv) {
      const r = S.review;
      r.district = $('rv-name').value;
      r[t.dataset.rv] = t.dataset.rv === 'cycleStart' ? +t.value : t.value;
      if (t.dataset.rv === 'kind') delete r.cycleStart;
      if (t.dataset.rv !== 'cycleStart') { r.kind = $('rv-kind').value; if (t.dataset.rv === 'targetId') delete r.kind; }
      return openReview(r);
    }
    if (t.id === 'add-file' && t.files[0]) return handleDataFile(t.files[0]);
    if (!S.add) return;
    if (t.dataset.add === 'sheet') { S.add.sheet = +t.value; S.add.kind = I.detectKind(S.add.tables[S.add.sheet], S.add.file); initAddConfig(); return renderAddStep(); }
    if (t.dataset.add === 'kind') { S.add.kind = t.value; initAddConfig(); return renderAddStep(); }
    if (t.dataset.add === 'role') { S.add.role = t.value; return; }
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
