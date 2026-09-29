// Run: node lcap-tracker/tests/engine.test.js
// Checks value parsing, indicator mapping, and status rules against the
// example district (Tulelake Basin JUSD, 2024–27 LCAP).
const assert = require('assert');
const path = require('path');
require(path.join(__dirname, '../src/engine.js'));
const L = globalThis.LCAP;
const ex = require(path.join(__dirname, '../samples/tbjusd-2026-27.lcap.json'));

// Parsing LCAP prose
const pv = t => { const p = L.parseValue(t); return [p.value, p.unit]; };
assert.deepStrictEqual(pv('74.3 points below standard (Red).'), [-74.3, 'pts']);
assert.deepStrictEqual(pv('ELA 50.3 below (Orange); Math 124.6 below'), [-50.3, 'pts']);
assert.deepStrictEqual(pv('2023: 43.2% chronically absent.'), [43.2, '%']);
assert.deepStrictEqual(pv('2023–24 district: 92.53%.'), [92.53, '%']);
assert.deepStrictEqual(pv('Most areas remained 3/5'), [3, 'rating']);
assert.deepStrictEqual(pv('In Good Repair'), [3, 'fit']);
assert.deepStrictEqual(pv('TBJUSD does not offer AP courses.'), [null, null]);
assert.strictEqual(L.parseValue('2024: 25.4%').period, '2024');

// Indicator mapping (keywords beat the LCAP's own "4d" style labels)
assert.deepStrictEqual(L.inferCodes('4d A-G completion rate'), ['4B']);
assert.deepStrictEqual(L.inferCodes('4b A-G completion and CTE pathway completion rate'), ['4D']);
assert.deepStrictEqual(L.inferCodes('3a.b.c Parental involvement and input'), ['3A', '3B', '3C']);
assert.deepStrictEqual(L.inferCodes('5b Chronic Absenteeism'), ['5B']);

// Period ordering
assert.ok(L.periodOrder('Fall 2025-2026') < L.periodOrder('Winter 2026'));
assert.ok(L.periodOrder('2024-25') < L.periodOrder('Dashboard 2025'));

// Status rules on the example district
const d = L.newDistrict(ex.district, ex.cycleStart);
L.importLcapRows(d, ex.rows, { cycleStart: ex.cycleStart });
const status = no => L.analyze(d.metrics.find(m => m.metricNo === no)).status;
const expected = {
  '1.1': 'Priority', '1.2': 'Sustain', '1.5': 'Priority', '1.6': 'Watch', '1.7': 'Sustain', '1.8': 'Review',
  '1.9': 'Sustain', '1.11': 'Priority', '2.1': 'Priority', '2.2': 'Watch', '2.3': 'Priority', '2.5': 'Priority',
  '3.3': 'Watch', '3.4': 'Watch', '3.5': 'Sustain', '3.8': 'Sustain', '3.10': 'Sustain'
};
for (const [no, st] of Object.entries(expected)) assert.strictEqual(status(no), st, `metric ${no}`);

// Real-time adjustment: a new result changes the status
const chronic = d.metrics.find(m => m.metricNo === '3.10');
L.addPoint(chronic, { period: '2026', value: 27.5, source: 'Manual' });
assert.strictEqual(L.analyze(chronic).status, 'Watch');
// Re-uploading the same period replaces instead of duplicating
L.addPoint(chronic, { period: '2026', value: 19.0, source: 'Manual' });
assert.strictEqual(chronic.points.filter(p => p.period === '2026').length, 1);
assert.strictEqual(L.analyze(chronic).status, 'Sustain');

// Red student groups on the Dashboard flag an otherwise-met target
const ela = d.metrics.find(m => m.metricNo === '1.4');
L.addPoint(ela, { period: 'Dashboard 2026', value: -60, source: 'CA Dashboard' });
L.addPoint(ela, { period: 'Dashboard 2026', value: -98, group: 'EL', color: 1, source: 'CA Dashboard' });
const a = L.analyze(ela);
assert.strictEqual(a.status, 'Watch');
assert.ok(a.reasons.some(r => /English learners/.test(r)));

// Coverage: every required metric is mapped in the example
const covered = L.REQUIRED.filter(r => d.metrics.some(m => m.codes.includes(r.code))).length;
assert.strictEqual(covered, 28);

// Next-cycle draft: latest result becomes the baseline; targets are suggested
const draft = L.nextCycleRows(d, { gapPct: 30 });
const row = no => draft.find(r => r.metricNo === no);
assert.strictEqual(row('3.10').baseline, '19% (2026)');               // latest chronic absenteeism result
assert.strictEqual(row('3.10').target, '13.3%');                        // closes 30% of the gap to 0%
assert.strictEqual(row('1.2').target, 'Maintain 100%');
assert.strictEqual(row('1.3').target, '4/5');
assert.ok(/not reached/.test(row('2.1').targetBasis));                  // names the unmet 70% A–G target
assert.ok(row('1.4').flags.some(f => /English learners/.test(f)));      // Red groups flagged
const d2 = L.newDistrict('No 4D', 2024);
L.importLcapRows(d2, ex.rows.filter(r => r.metricNo !== '2.3'), { cycleStart: 2024 });
assert.ok(L.nextCycleRows(d2).some(r => r.id === 'req:4D' && r.priorStatus === 'Missing'));

console.log('engine tests passed');
