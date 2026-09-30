// ============================================================
// OPTIONAL AI (Claude API)
// Only used when a district pastes its own API key in Settings.
// Everything sent is public, district-level LCAP data; student-level
// rows never leave the browser (importers aggregate them first).
// Plain fetch is used because this is a single offline HTML file
// with no bundler to include an SDK.
// ============================================================
(function (root) {
'use strict';
const L = root.LCAP;
const MODEL = 'claude-opus-5-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

async function callClaude({ apiKey, system, content, schema, maxTokens = 32000, onText }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: maxTokens, stream: true, fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      system, messages: [{ role: 'user', content }]
    })
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch (e) { /* keep status text */ }
    if (res.status === 401) msg = 'The API key was rejected. Check it in Settings.';
    if (res.status === 429) msg = 'Rate limited by the API. Wait a minute and try again.';
    throw new Error(msg);
  }
  // Server-sent events: accumulate text deltas; thinking deltas are ignored.
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', stop = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if (!data) continue;
      let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { text += ev.delta.text; onText && onText(text.length); }
      else if (ev.type === 'message_delta' && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
      else if (ev.type === 'error') throw new Error(ev.error?.message || 'The API returned an error.');
    }
  }
  if (stop === 'refusal') throw new Error('The model declined this request. Try again, or use the rules-based results.');
  if (stop === 'max_tokens') throw new Error('The response was cut off. Try again with fewer metrics.');
  try { return JSON.parse(text); }
  catch (e) { throw new Error('The AI response was not valid JSON.'); }
}

const str = { type: 'string' };
const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['district', 'lcapYear', 'rows', 'goals', 'actions'],
  properties: {
    district: str,
    lcapYear: { type: 'string', description: 'First year of the LCAP school year, e.g. "2026" for 2026-27' },
    rows: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['goal', 'metricNo', 'metric', 'baseline', 'y1', 'y2', 'target', 'diff', 'page'],
        properties: { goal: str, metricNo: str, metric: str, baseline: str, y1: str, y2: str, target: str, diff: str, page: str }
      }
    },
    goals: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['no', 'description', 'type'],
      properties: { no: str, description: str, type: str } } },
    actions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['goal', 'no', 'title', 'description', 'funds', 'contributing'],
      properties: { goal: str, no: str, title: str, description: str, funds: str, contributing: str } } }
  }
};

async function extractLcap({ apiKey, pdfBase64, onText }) {
  const system = 'You extract data from California Local Control and Accountability Plans (LCAPs) exactly as written. Never invent or round values.';
  const prompt = `From this LCAP, list every row of every goal's "Measuring and Reporting Results" metrics table.
Copy each cell's text verbatim: Metric #, Metric, Baseline, Year 1 Outcome, Year 2 Outcome, Target for Year 3 Outcome, Current Difference from Baseline.
Use an empty string for blank cells or columns the table does not have. "goal" is the goal number. "page" is the PDF page the row starts on, like "p. 14".
Also list each goal (Goal #, Description, Type of Goal) and each action in the goals' Actions tables (Action #, Title, Description, Total Funds, Contributing), verbatim.
Also give the LEA (district) name and the LCAP year.`;
  const out = await callClaude({ apiKey, onText, schema: EXTRACT_SCHEMA, system, content: [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
    { type: 'text', text: prompt }
  ] });
  const y = parseInt(out.lcapYear, 10);
  return { rows: out.rows, goals: out.goals, actions: out.actions, district: out.district, lcapYear: y || null };
}

const INSIGHT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['metrics', 'priorities'],
  properties: {
    metrics: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'insight'], properties: { id: str, insight: str } } },
    priorities: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['priority', 'pattern', 'progress', 'need', 'equity', 'direction'],
      properties: { priority: { type: 'integer' }, pattern: str, progress: str, need: str, equity: str, direction: str } } }
  }
};

function metricBrief(m) {
  const a = L.analyze(m);
  const pts = m.points.slice().sort((x, y) => (x.order ?? 0) - (y.order ?? 0))
    .map(p => `${p.period} [${L.groupName(p.group)}]: ${p.value ?? ''}${p.color ? ' ' + L.COLOR_NAMES[p.color] : ''}${p.text && p.value == null ? ' "' + p.text.slice(0, 200) + '"' : ''}`);
  return { id: m.id, metricNo: m.metricNo, name: m.name, indicators: m.codes, unit: m.unit, betterWhen: m.direction,
    target: m.targetText, computedStatus: a.status, statusReasons: a.reasons, results: pts };
}

async function writeInsights({ apiKey, district, onText }) {
  const system = `You are an LCAP data analyst helping a California school district plan its next three-year LCAP cycle.
Write analytical planning considerations grounded only in the data provided. They are not district conclusions: avoid blame, avoid inventing causes, and name data the district should look at next.`;
  const prompt = `District: ${district.name}. LCAP cycle starting ${district.cycleStart || 'unknown'}.
For each metric, write one paragraph (70–110 words): describe the trend from baseline to the latest result against the target, note instability or student-group gaps visible in the data, then give one concrete next-cycle consideration. Use the metric's own units. Return every metric id given.
Then, for each LCFF priority 1–8 that has metrics, write a short synthesis: overall pattern, strongest evidence of progress, most important unresolved need, one equity/data question, and one planning direction to consider.

Metrics (JSON):
${JSON.stringify(district.metrics.map(metricBrief))}`;
  const out = await callClaude({ apiKey, onText, schema: INSIGHT_SCHEMA, system, content: [{ type: 'text', text: prompt }] });
  const at = new Date().toISOString();
  let n = 0;
  for (const r of out.metrics) {
    const m = district.metrics.find(x => x.id === r.id);
    if (m) { m.ai = { text: r.insight, at, sig: L.dataSig(m) }; n++; }
  }
  district.ai = district.ai || {};
  district.ai.summary = { at, sigs: prioritySigs(district), priorities: Object.fromEntries(out.priorities.map(p => [p.priority, p])) };
  return n;
}

const REFLECT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['goals', 'successes', 'needs'],
  properties: {
    goals: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['goal', 'effectiveness', 'changes'],
      properties: { goal: str, effectiveness: str, changes: str } } },
    successes: str, needs: str
  }
};

// Draft reflection text for the LCAP template (goal analysis and plan summary reflections).
async function writeReflections({ apiKey, plan, key = 'cycle', yearLabel, onText }) {
  const goals = L.planGoals(plan).map(g => ({
    goal: g.no, description: g.description,
    metrics: plan.metrics.filter(m => String(m.goal) === String(g.no)).map(metricBrief),
    actions: (plan.actions || []).filter(a => String(a.goal) === String(g.no))
      .map(a => { const r = L.actionReview(a, key); return { no: a.no, title: a.title, description: a.description, funds: a.funds, teamRating: r.rating || 'not rated', evidence: r.evidence || '' }; })
  }));
  const system = `You help California school district leaders write the reflection sections of their LCAP.
Write in plain, professional language suitable for a board-adopted plan. Ground every statement in the data provided. Do not invent causes, numbers, or action results; where evidence is missing, say what the district should confirm.`;
  const prompt = `District: ${plan.name}. ${yearLabel}.
For each goal, draft:
- "effectiveness": 90–160 words on how effective the goal's actions were in making progress toward the goal, citing metric results against targets and the team's action ratings and evidence. Name student groups in Red where the data shows them.
- "changes": 40–100 words on changes to the goal, metrics, targets, or actions that result from this reflection.
Then draft the Plan Summary reflections: "successes" (60–120 words) and "needs" (60–140 words: lowest-performing indicators and student groups, and required metrics not measured).

Goals (JSON):
${JSON.stringify(goals)}`;
  return callClaude({ apiKey, onText, schema: REFLECT_SCHEMA, system, content: [{ type: 'text', text: prompt }] });
}

// One signature per priority, so new data only marks that priority's summary out of date.
const prioritySigs = d => Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(p =>
  [p, d.metrics.filter(m => m.codes.some(c => +c[0] === p)).map(L.dataSig).join('|')]));

root.LcapAI = { MODEL, callClaude, extractLcap, writeInsights, writeReflections, prioritySigs };
})(typeof window !== 'undefined' ? window : globalThis);
