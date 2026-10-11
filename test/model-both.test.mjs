// test/model-both.test.mjs — run with:  node --test
// The per-hospital report models (model/hospital-report.js):
//   • buildHospitalModel('kamc') IS today's model (compute → buildReportModel), + hospital;
//   • buildHospitalModel('sgh') runs SGH's own policy — no TAT (lookup or CSV), no KAMC
//     constants, no snapshot — and carries the counts-only send-out block;
//   • buildBothModel stamps each hospital's week chips from its own rows and `combined`
//     holds every number the BOTH deck prints (KAMC-only late / turnaround / countries).
// SYNTHETIC rows only: every order id, lab, test and catalogue line below is made up; the
// hospital name/id pairs are the source's own spellings (organisations, not patients).
// Every expected number is derived BY HAND in the comments next to the rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHospitalModel, buildBothModel, combineHospitals, stampHospitalDeltas, stampBothDeltas,
  hospitalPolicy, sghSendout,
} from '../src/model/hospital-report.js';
import { buildReportModel } from '../src/model/report-model.js';
import { compute } from '../src/engine/engine.js';
import { stampWindowDeltas } from '../src/model/delta-window.js';
import { applyScope, normalizeScope } from '../src/model/scope.js';
import { analyseSendout } from '../src/model/sendout.js';
import { GOLDEN_ORDERS } from './fixtures/golden-orders.js';
import { TAT_LOOKUP } from '../src/seeds/tat-lookup.js';
import { HISTORICAL_CONSTANTS_SEED, SNAPSHOT_SEED, REPORT_OPTIONS_SEED } from '../src/seeds/defaults.js';

const KAMC = { orderingFacilityId: '31763', hospital: 'King Abdul ah Medical City' };
const SGH = { orderingFacilityId: '1037', hospital: 'Saudi German Hospital Alzahraa Branch' };

let seq = 0;
/** A synthetic OrderRow. Dates are midnight so every turnaround mean is a whole day. */
const row = (h, facility, testName, od, over = {}) => {
  seq += 1;
  const d = (x) => (x ? `${x} 00:00:00` : null);
  return {
    orderDate: d(od), facility, orderId: `9${String(seq).padStart(5, '0')}`, lineNo: seq,
    loinc: null, testName, collected: d(over.col), dispatched: d(over.dis), received: d(over.rec),
    resulted: d(over.res), rawStatus: over.status || 'Order Created', tatDaysCsv: over.tatCsv ?? null,
    specimenNo: null, shipmentId: over.ship ?? null, performingFacilityId: null, ...h,
  };
};

// Report day Thu 2026-10-08 → week window Fri 10-02 … Thu 10-08. Weekend Fri+Sat.
const DATE = '2026-10-08';
const TAT = { 'Assay K': 2, 'Assay U': 10 };
const SETTINGS = {
  tatLookup: TAT,
  historicalConstants: { cancelledByMonth: { '2026-01': 2 } }, // KAMC history only
  // A KAMC published snapshot: must never seed SGH's deltas.
  snapshot: { asOf: '2026-10-01', numbers: { total: 1, collected: 1, dispatched: 1, received: 1, completed: 0, rejected: 0, awaitingDispatch: 0, shippedNotReceived: 0, awaitingResults: 0, lateNoResult: 0 } },
  reportOptions: { excludeNoTat: false, deltaMode: 'week', slides: { monthly: true } },
};
// Catalogue: Lab Alpha single-country (Germany); Lab Beta two countries, settled per test.
const MASTER = [
  { vendor: 'Lab Alpha', country: 'Germany', reflab: 'Ref A', item: 'Assay K' },
  { vendor: 'Lab Beta', country: 'Saudi Arabia', reflab: 'Ref B1', item: 'Assay K' },
  { vendor: 'Lab Beta', country: 'USA', reflab: 'Ref B2', item: 'Assay U' },
];

// KAMC — 9 lines, 8 non-cancelled.
const kamcRows = () => [
  // k1 Aug: rec Tue 08-04, due Thu 08-06, resulted 08-05 → completed; turnaround 1 / 2.
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-08-03', { col: '2026-08-03', dis: '2026-08-03', rec: '2026-08-04', res: '2026-08-05', status: 'Result Approved' }),
  // k2 Sep: rec Wed 09-02, due Sun 09-06 → LATE (due before the window: no late chip).
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-09-01', { col: '2026-09-01', dis: '2026-09-01', rec: '2026-09-02', status: 'Specimen Courier Received' }),
  // k3 Oct: Lab Beta / Assay U (USA), rec 10-06 in window, TAT 10 → awaiting, not late.
  row(KAMC, 'Lab Beta', 'Assay U', '2026-10-05', { col: '2026-10-05', dis: '2026-10-05', rec: '2026-10-06', status: 'Specimen Courier Received' }),
  // k4 Oct: Lab Beta / Assay K (Saudi Arabia), dispatched 10-06 → shipped, not received.
  row(KAMC, 'Lab Beta', 'Assay K', '2026-10-06', { col: '2026-10-06', dis: '2026-10-06', status: 'Shipment Dispatched' }),
  // k5 Oct: collected only → awaiting dispatch.
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-07', { col: '2026-10-07', status: 'Specimen Collected' }),
  // k6 Sep: cancelled (in data) — off every count, +1 in the cancelled note.
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-09-10', { status: 'Order Cancelled' }),
  // k7 Sep: rejected after receipt → completed (rejected ⊂ completed). Lab Beta / SA.
  row(KAMC, 'Lab Beta', 'Assay K', '2026-09-15', { col: '2026-09-15', dis: '2026-09-15', rec: '2026-09-16', status: 'Result Rejected' }),
  // k8 Oct: rec Mon 10-05, due Wed 10-07, resulted 10-07 → completed on time; 2 / 2.
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-04', { col: '2026-10-04', dis: '2026-10-04', rec: '2026-10-05', res: '2026-10-07', status: 'Result Approved' }),
  // k9 Oct: rec Thu 10-01 (before the window), due Mon 10-05 (IN it) → late, late chip +1.
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-01', { col: '2026-10-01', dis: '2026-10-01', rec: '2026-10-01', status: 'Specimen Courier Received' }),
];

// SGH — 5 lines, 4 non-cancelled. 'Assay K' IS in the KAMC TAT table and s1 even carries a
// CSV «TAT - Days»: either one would make s1 late — SGH's policy must use neither.
const sghRows = () => [
  // s1 Sep (SGH's first order month): received 09-30 → awaiting results.
  row(SGH, 'Saudi Diagnostics Limited Company', 'Assay K', '2026-09-28', { col: '2026-09-28', dis: '2026-09-29', rec: '2026-09-30', tatCsv: 1, status: 'Specimen Courier Received' }),
  // s2 Oct: resulted 10-07 → completed (no due date: no turnaround).
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-05', { col: '2026-10-05', dis: '2026-10-05', rec: '2026-10-06', res: '2026-10-07', status: 'Result Approved' }),
  // s3 Oct: collected only → awaiting dispatch.
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-06', { col: '2026-10-06', status: 'Specimen Collected' }),
  // s4 Oct: dispatched 10-07 → shipped, not received.
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-07', { col: '2026-10-07', dis: '2026-10-07', status: 'Shipment Dispatched' }),
  // s5 Oct: cancelled in data → SGH's cancelled note is 1 (NOT 1 + KAMC's 2 constants).
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-03', { status: 'Order Cancelled' }),
];

const both = () => buildBothModel({
  kamcRows: kamcRows(), sghRows: sghRows(), settings: SETTINGS, reportDate: DATE, tracker: null, sendoutMaster: MASTER,
});

// ---- KAMC = today's model ----------------------------------------------------------------

test('buildHospitalModel kamc — deep-equals compute → buildReportModel (golden rows, seed settings) + hospital', () => {
  const settings = {
    tatLookup: TAT_LOOKUP, historicalConstants: HISTORICAL_CONSTANTS_SEED, snapshot: SNAPSHOT_SEED,
    reportOptions: REPORT_OPTIONS_SEED,
  };
  const tracker = { tasks: [{ task: 't', status: 'مستمر', dueDate: '10-07-2026', category: 'لين' }], challenges: [], risks: [] };
  for (const excludeNoTat of [false, true]) {
    const s = { ...settings, reportOptions: { ...REPORT_OPTIONS_SEED, excludeNoTat } };
    // automation/pipeline.js stepEngine, verbatim.
    const out = compute(GOLDEN_ORDERS, s.tatLookup, {
      asOf: '2026-07-09', cancelledByMonth: s.historicalConstants.cancelledByMonth, snapshot: s.snapshot, excludeNoTat,
    });
    const want = buildReportModel({
      engineOutput: out, tracker, settings: s, reportDate: '2026-07-09', orders: GOLDEN_ORDERS, sendoutMaster: MASTER, edits: {},
    });
    const got = buildHospitalModel({
      hospital: 'kamc', rows: GOLDEN_ORDERS, settings: s, reportDate: '2026-07-09', tracker, sendoutMaster: MASTER,
    });
    assert.equal(got.hospital, 'kamc');
    const { hospital, ...rest } = got;
    assert.deepStrictEqual(rest, want, `excludeNoTat=${excludeNoTat}`);
    assert.equal('noTestMenu' in got, false, 'the KAMC model carries no SGH flag');
    assert.equal('scope' in got, false, 'no scope given → no scope fields (the automation model)');
  }
});

test('stampHospitalDeltas kamc — the very chips pipeline.js applyWindowDeltas stamps', () => {
  const rows = kamcRows();
  const a = buildHospitalModel({ hospital: 'kamc', rows, settings: SETTINGS, reportDate: DATE, sendoutMaster: MASTER });
  const b = buildHospitalModel({ hospital: 'kamc', rows, settings: SETTINGS, reportDate: DATE, sendoutMaster: MASTER });
  b.reportOptions = SETTINGS.reportOptions;
  // applyWindowDeltas' call: rows, settings.tatLookup, the stored mode.
  stampWindowDeltas(b, { rows, tatTests: SETTINGS.tatLookup, mode: SETTINGS.reportOptions.deltaMode });
  stampHospitalDeltas(a, { rows, settings: SETTINGS });
  assert.deepEqual(a.kpi.deltas, b.kpi.deltas);
  assert.deepEqual(a.deltaWindow, b.deltaWindow);
  assert.deepEqual(a.kpi.deltas, {
    total: 4, collected: 4, dispatched: 3, received: 2, completed: 1, rejected: 0,
    awaitingDispatch: 1, shippedNotReceived: 1, awaitingResults: 1, lateNoResult: 1,
  });
});

test('buildHospitalModel kamc scoped — applyScope + the scoped policy + a no-inference send-out pass', () => {
  const rows = kamcRows();
  // Lab Alpha over Sep 1 – Oct 7: k2, k5, k6 (cancelled), k8, k9.
  const scope = { labs: ['Lab Alpha'], from: '2026-09-01', to: '2026-10-07' };
  const got = buildHospitalModel({ hospital: 'kamc', rows, settings: SETTINGS, reportDate: DATE, sendoutMaster: MASTER, scope });
  const sc = normalizeScope(scope);
  const scoped = applyScope(rows, sc);
  const kpi = compute(scoped, TAT, { asOf: '2026-10-07', cancelledByMonth: {}, snapshot: undefined, excludeNoTat: false, inferBlanks: false });
  assert.deepStrictEqual(got.kpi, kpi);
  assert.deepStrictEqual(got.sendout, analyseSendout(scoped, MASTER, { inferBlanks: false }));
  assert.equal(got.reportDate, '2026-10-07', 'a range moves the date to its end');
  assert.deepStrictEqual(got.scope, sc);
  assert.deepStrictEqual(got.scopedRows, scoped);
  assert.deepStrictEqual(got.shipmentDetails, []);
  assert.equal(got.kpi.cancelledNote, 1, 'scoped: no constants (would be +2), only k6\'s data cancellation');
  assert.equal(got.kpi.totals.total, 4);
});

// ---- SGH = its own policy -------------------------------------------------------------

test('hospitalPolicy — SGH: empty lookup, CSV fallback off, no constants, no snapshot', () => {
  const p = hospitalPolicy('sgh', SETTINGS, { asOf: DATE });
  assert.deepStrictEqual(p.tat, {});
  assert.deepStrictEqual(p.opts, { asOf: DATE, cancelledByMonth: {}, snapshot: undefined, excludeNoTat: false, tatFallbackFromCsv: false });
  assert.deepStrictEqual(p.deltaTat, {});
  assert.deepStrictEqual(p.deltaOpts, { excludeNoTat: false, tatFallbackFromCsv: false });
  assert.equal(hospitalPolicy('sgh', SETTINGS, { asOf: DATE, scoped: true }).opts.inferBlanks, false);
  const k = hospitalPolicy('kamc', SETTINGS, { asOf: DATE });
  assert.equal(k.tat, TAT);
  assert.deepStrictEqual(k.opts, { asOf: DATE, cancelledByMonth: { '2026-01': 2 }, snapshot: SETTINGS.snapshot, excludeNoTat: false });
  assert.throws(() => hospitalPolicy('ngha', SETTINGS, { asOf: DATE }), /unknown hospital/);
});

test('buildHospitalModel sgh — counts and stages only; never KAMC\'s TAT, constants or snapshot', () => {
  const m = buildHospitalModel({
    hospital: 'sgh', rows: sghRows(), settings: SETTINGS, reportDate: DATE, sendoutMaster: MASTER,
    // A caller's extra opts may add, never re-introduce KAMC inputs.
    engineOpts: { cancelledByMonth: { '2026-01': 99 }, tatFallbackFromCsv: true, snapshot: SETTINGS.snapshot },
  });
  assert.equal(m.hospital, 'sgh');
  assert.equal(m.noTestMenu, true);
  assert.deepEqual(m.kpi.totals.total, 4);
  assert.deepEqual(m.kpi.buckets, {
    awaitingDispatch: 1, shippedNotReceived: 1, awaitingResults: 1, completed: 1, rejected: 0,
    lateNoResult: 0, latePct: 0, // computed 0 = "unknown": no TAT at all (s1 would be late on KAMC's)
  });
  assert.equal(m.kpi.cancelledNote, 1, 'only its own data cancellation, never KAMC\'s constants');
  assert.deepEqual(m.kpi.monthly.map((x) => x.month), ['2026-09', '2026-10'], 'no constants months');
  assert.equal(m.kpi.turnaround.overallActual, null);
  assert.equal(m.kpi.turnaround.measuredCount, 0);
  assert.deepEqual(Object.values(m.kpi.deltas), Array(10).fill(0), 'KAMC\'s snapshot does not seed SGH deltas');
  assert.deepStrictEqual(m.sendout, {
    noTestMenu: true, total: 4,
    byLab: [{ lab: 'Company TEMKIN SAHA Medical', orders: 3 }, { lab: 'Saudi Diagnostics Limited Company', orders: 1 }],
    local: null, international: null, byCountry: [],
  });
  assert.equal(m.sendout.total, m.kpi.totals.total);
});

test('stampHospitalDeltas sgh — the late chip never borrows a TAT', () => {
  const rows = sghRows();
  const m = buildHospitalModel({ hospital: 'sgh', rows, settings: SETTINGS, reportDate: DATE });
  stampHospitalDeltas(m, { rows, settings: SETTINGS });
  assert.deepEqual(m.kpi.deltas, {
    total: 3, collected: 3, dispatched: 2, received: 1, completed: 1, rejected: 0,
    awaitingDispatch: 1, shippedNotReceived: 1, awaitingResults: 0, lateNoResult: 0,
  });
  // approx.total: a cancelled line (s5) is in range and a cancellation carries no date
  // (asof.js discloses it); the window itself is the week's.
  assert.deepEqual(m.deltaWindow, { start: '2026-10-02', end: '2026-10-08', mode: 'week', approx: { total: true } });
});

test('sghSendout — captions via FACILITY_DISPLAY, two spellings of one lab merge, A→Z', () => {
  const so = sghSendout({ byLab: [
    { lab: 'saudi diagnostic limited co.', total: 2 },
    { lab: 'Zeta  Lab', total: 1 },
    { lab: 'Saudi Diagnostics Limited Company', total: 3 },
  ] });
  assert.deepEqual(so.byLab, [{ lab: 'Saudi Diagnostics Limited Company', orders: 5 }, { lab: 'Zeta Lab', orders: 1 }]);
  assert.equal(so.total, 6);
  assert.deepEqual(sghSendout(null), { noTestMenu: true, total: 0, byLab: [], local: null, international: null, byCountry: [] });
});

test('buildHospitalModel — an unknown hospital throws (never KAMC under another name)', () => {
  assert.throws(() => buildHospitalModel({ hospital: 'both', rows: [], settings: SETTINGS, reportDate: DATE }), /unknown hospital/);
  assert.throws(() => buildHospitalModel({ hospital: undefined, rows: [], settings: SETTINGS, reportDate: DATE }), /unknown hospital/);
});

// ---- BOTH = per-hospital, then summed ------------------------------------------------------

test('buildBothModel — shape: per-hospital models stamped from their OWN rows; no top-level kpi', () => {
  const m = both();
  assert.equal(m.hospital, 'both');
  assert.equal(m.reportDate, DATE);
  assert.equal(m.reportOptions, SETTINGS.reportOptions);
  assert.equal('kpi' in m, false, 'single-hospital stampers (applyWindowDeltas) leave it alone');
  assert.equal(m.kamc.hospital, 'kamc');
  assert.equal(m.sgh.hospital, 'sgh');
  assert.equal(m.kamc.scopedRows.length, 9);
  assert.equal(m.sgh.scopedRows.length, 5);
  assert.equal(m.kamc.kpi.deltas.lateNoResult, 1);
  assert.equal(m.sgh.kpi.deltas.lateNoResult, 0);
  // The union of both hospitals' as-of caveats: cancelled lines (k6, s5) → total; k7's
  // rejection dated by its receipt → rejected + completed.
  assert.deepEqual(m.deltaWindow, {
    start: '2026-10-02', end: '2026-10-08', mode: 'week', approx: { total: true, rejected: true, completed: true },
  });
  assert.equal(m.deltaWindow, m.combined.window);
});

test('combined — cards, cancelled split and the journey (every slide-2 number)', () => {
  const c = both().combined;
  assert.deepEqual(c.testMenu, { kamc: true, sgh: false });
  assert.deepEqual(c.dataWindow, { first: '2026-08', last: '2026-10' });
  const card = (k) => { const x = c.cards[k]; return [x.kamc, x.sgh, x.combined, x.delta.kamc, x.delta.sgh, x.delta.combined]; };
  assert.deepEqual(card('total'), [8, 4, 12, 4, 3, 7]);
  assert.deepEqual(card('awaitingDispatch'), [1, 1, 2, 1, 1, 2]);
  assert.deepEqual(card('shippedNotReceived'), [1, 1, 2, 1, 1, 2]);
  assert.deepEqual(card('awaitingResults'), [3, 1, 4, 1, 0, 1]);
  assert.deepEqual(card('completed'), [3, 1, 4, 1, 1, 2]);
  // Late: SGH unknown (null → «–»), combined = KAMC; % over KAMC's awaiting (2/3), not 2/4.
  assert.deepEqual(card('lateNoResult'), [2, null, 2, 1, null, 1]);
  assert.equal(c.cards.lateNoResult.pct, 66.7);
  assert.equal(c.cards.lateNoResult.pctBasis, 3);
  assert.deepEqual(c.cancelled, { kamc: 3, sgh: 1, combined: 4 }, 'KAMC 2 constants + 1 data; SGH 1 data');
  assert.deepEqual(c.funnel.map((s) => [s.key, s.kamc, s.sgh, s.combined, s.delta.kamc, s.delta.sgh, s.delta.combined, s.remaining]), [
    ['created', 8, 4, 12, 4, 3, 7, 0],
    ['collected', 8, 4, 12, 4, 3, 7, 0],
    ['dispatched', 7, 3, 10, 3, 2, 5, 2],
    ['received', 6, 2, 8, 2, 1, 3, 4],
    ['completed', 3, 1, 4, 1, 1, 2, 8],
  ]);
});

test('combined — monthly: months with orders only, «before the hospital joined», recomputed %', () => {
  const mo = both().combined.monthly;
  assert.deepEqual(mo.months, ['2026-08', '2026-09', '2026-10'], 'KAMC\'s constants month 2026-01 has no orders → no column');
  assert.deepEqual(mo.joined, { kamc: '2026-08', sgh: '2026-09' });
  const cell = (orders, results, incomplete, completionPct, beforeJoin = false) => ({ orders, results, incomplete, completionPct, beforeJoin });
  const pre = cell(0, 0, 0, null, true);
  assert.deepStrictEqual(mo.rows, [
    { month: '2026-08', kamc: cell(1, 1, 0, 100), sgh: pre, combined: cell(1, 1, 0, 100) },
    { month: '2026-09', kamc: cell(2, 1, 1, 50), sgh: cell(1, 0, 1, 0), combined: cell(3, 1, 2, 33.3) },
    { month: '2026-10', kamc: cell(5, 1, 4, 20), sgh: cell(3, 1, 2, 33.3), combined: cell(8, 2, 6, 25) },
  ]);
  assert.deepStrictEqual(mo.totals, { kamc: cell(8, 3, 5, 37.5), sgh: cell(4, 1, 3, 25), combined: cell(12, 4, 8, 33.3) });
  assert.deepStrictEqual(mo.chart, { kamc: [1, 2, 5], sgh: [0, 1, 3], total: [1, 3, 8] }, 'pre-join = 0 in the chart');
});

test('combined — turnaround is KAMC\'s, over KAMC\'s own engine month list', () => {
  const t = both().combined.turnaround;
  assert.deepStrictEqual(t, {
    hospital: 'kamc', actual: 1.5, expected: 2, measuredCount: 2,
    months: ['2026-01', '2026-08', '2026-09', '2026-10'],
    perMonth: { actual: [null, 1, null, 2], expected: [null, 2, null, 2] },
  });
});

test('combined — countries (KAMC basis + SGH count) and labs (combined basis, per hospital)', () => {
  const c = both().combined;
  assert.deepStrictEqual(c.countries, {
    hospital: 'kamc', total: 8, local: 2, international: 6, localPct: 25, internationalPct: 75,
    byCountry: [
      { country: 'Germany', orders: 5, pct: 62.5 },
      { country: 'Saudi Arabia', orders: 2, pct: 25 },
      { country: 'USA', orders: 1, pct: 12.5 },
    ],
    sgh: { orders: 4 },
  });
  assert.deepStrictEqual(c.labs.basis, { kamc: 8, sgh: 4, combined: 12 });
  assert.equal(c.labs.total, 12);
  assert.deepStrictEqual(c.labs.rows.map((r) => [r.hospital, r.lab, r.country, r.reflab, r.orders, r.share, r.underTenth]), [
    ['kamc', 'Lab Alpha', 'Germany', 'Ref A', 5, 41.7, false],
    ['kamc', 'Lab Beta', 'Saudi Arabia', 'Ref B1', 2, 16.7, false],
    ['kamc', 'Lab Beta', 'USA', 'Ref B2', 1, 8.3, false],
    ['sgh', 'Company TEMKIN SAHA Medical', null, null, 3, 25, false],
    ['sgh', 'Saudi Diagnostics Limited Company', null, null, 1, 8.3, false],
  ]);
  assert.deepStrictEqual(c.labs.multiCountry, [{ lab: 'Lab Beta', countries: 2 }]);
});

test('combined — compliance: own byLab per hospital, continuous numbering, KAMC-only late', () => {
  const comp = both().combined.compliance;
  assert.deepStrictEqual(comp.rows.map((r) => [r.no, r.hospital, r.lab, r.total, r.completed, r.awaitingResult, r.rejected, r.pipeline, r.late, r.latePct]), [
    [1, 'kamc', 'Lab Alpha', 5, 2, 2, 0, 1, 2, 100],
    [2, 'kamc', 'Lab Beta', 3, 1, 1, 1, 1, 0, 0],
    [3, 'sgh', 'Company TEMKIN SAHA Medical', 3, 1, 0, 0, 2, null, null],
    [4, 'sgh', 'Saudi Diagnostics Limited Company', 1, 0, 1, 0, 0, null, null],
  ]);
  // late% total = KAMC late / KAMC awaiting = 2/3 (not 2/4).
  assert.deepStrictEqual(comp.totals, { total: 12, completed: 4, awaitingResult: 4, rejected: 1, pipeline: 4, late: 2, latePct: 66.7, lateBasis: 3 });
});

test('stampBothDeltas — idempotent: a re-stamp (the generate screen) is deep-equal', () => {
  const m = both();
  const before = structuredClone({ combined: m.combined, k: m.kamc.kpi.deltas, s: m.sgh.kpi.deltas, w: m.deltaWindow });
  assert.deepEqual(stampBothDeltas(m, { settings: SETTINGS }), before.w);
  assert.deepStrictEqual({ combined: m.combined, k: m.kamc.kpi.deltas, s: m.sgh.kpi.deltas, w: m.deltaWindow }, before);
  assert.equal(stampBothDeltas({ hospital: 'kamc' }, {}), null, 'only a BOTH model');
});

test('buildBothModel — SGH with no orders: its rows and labels stay, every value 0 / «–»', () => {
  const m = buildBothModel({ kamcRows: kamcRows(), sghRows: [], settings: SETTINGS, reportDate: DATE, sendoutMaster: MASTER });
  const c = m.combined;
  assert.deepEqual([c.cards.total.sgh, c.cards.total.delta.sgh, c.cards.lateNoResult.sgh], [0, 0, null]);
  assert.equal(c.monthly.joined.sgh, null);
  assert.ok(c.monthly.rows.every((r) => r.sgh.beforeJoin), 'every month «–»');
  assert.equal(c.monthly.totals.sgh.beforeJoin, true);
  assert.deepEqual(c.monthly.chart.sgh, [0, 0, 0]);
  assert.deepEqual(c.countries.sgh, { orders: 0 });
  assert.deepEqual(c.labs.basis, { kamc: 8, sgh: 0, combined: 8 });
  assert.equal(c.labs.rows.filter((r) => r.hospital === 'sgh').length, 0);
  assert.equal(c.compliance.rows.length, 2);
  assert.deepEqual(m.sgh.sendout, { noTestMenu: true, total: 0, byLab: [], local: null, international: null, byCountry: [] });
  assert.deepEqual(m.deltaWindow, {
    start: '2026-10-02', end: '2026-10-08', mode: 'week', approx: { total: true, rejected: true, completed: true },
  });
});

test('buildBothModel — no rows at all: the window is still described, nothing throws', () => {
  const m = buildBothModel({ kamcRows: null, sghRows: undefined, settings: SETTINGS, reportDate: DATE, sendoutMaster: MASTER });
  assert.deepEqual(m.deltaWindow, { start: '2026-10-02', end: '2026-10-08', mode: 'week' });
  assert.equal(m.combined.dataWindow, null);
  assert.deepEqual(m.combined.monthly.months, []);
  assert.equal(m.combined.countries, null, 'no KAMC send-out block → no country/lab slides');
  assert.equal(m.combined.labs, null);
  assert.equal(m.combined.cards.lateNoResult.pct, 0);
});

test('buildBothModel — KAMC with no orders: SGH keeps its country count and lab rows, KAMC at 0', () => {
  const m = buildBothModel({ kamcRows: [], sghRows: sghRows(), settings: SETTINGS, reportDate: DATE, sendoutMaster: MASTER });
  const c = m.combined;
  assert.equal(m.kamc.sendout, null, 'buildReportModel leaves an order-less KAMC without a block');
  assert.equal(c.cards.total.kamc, 0);
  assert.deepEqual(
    { total: c.countries.total, local: c.countries.local, international: c.countries.international, byCountry: c.countries.byCountry, sgh: c.countries.sgh },
    { total: 0, local: 0, international: 0, byCountry: [], sgh: { orders: 4 } },
  );
  assert.deepEqual(c.labs.basis, { kamc: 0, sgh: 4, combined: 4 });
  assert.equal(c.labs.total, 4);
  assert.ok(c.labs.rows.length > 0 && c.labs.rows.every((r) => r.hospital === 'sgh' && r.country === null));
  assert.equal(c.labs.rows.reduce((n, r) => n + r.orders, 0), 4);
  assert.equal(c.labs.rows.reduce((n, r) => n + r.share, 0), 100);
  assert.deepEqual(c.labs.multiCountry, []);
  // Without a catalogue an order-less KAMC changes nothing about the SGH counts…
  const nm = buildBothModel({ kamcRows: [], sghRows: sghRows(), settings: SETTINGS, reportDate: DATE, sendoutMaster: null });
  assert.deepEqual(nm.combined.countries.sgh, { orders: 4 });
  // …but a KAMC WITH orders and no catalogue cannot be attributed: no country/lab slides.
  const nk = buildBothModel({ kamcRows: kamcRows(), sghRows: sghRows(), settings: SETTINGS, reportDate: DATE, sendoutMaster: null });
  assert.equal(nk.combined.countries, null);
  assert.equal(nk.combined.labs, null);
});

test('combineHospitals — the «<0.1%» input, a zero-card ring and a non-monotone funnel', () => {
  const kpi = (over) => ({
    totals: { total: 0 }, funnel: { created: 0, collected: 0, dispatched: 0, received: 0, completed: 0 },
    buckets: { awaitingResults: 0, lateNoResult: 0 }, deltas: {}, monthly: [], byLab: [], ...over,
  });
  const c = combineHospitals({
    kamc: {
      kpi: kpi({ funnel: { created: 2100, collected: 2100, dispatched: 2100, received: 2101, completed: 0 } }),
      sendout: { total: 2100, local: 1, international: 2099, byCountry: [{ country: 'Saudi Arabia', orders: 1 }, { country: 'Germany', orders: 2099 }],
        byLab: [{ lab: 'A', country: 'Germany', reflab: 'R', orders: 2099 }, { lab: 'B', country: 'Saudi Arabia', reflab: 'S', orders: 1 }] },
    },
    sgh: { kpi: kpi({ totals: { total: 5 } }), sendout: { noTestMenu: true, total: 5, byLab: [{ lab: 'C', orders: 5 }] } },
  });
  // 1 / 2105 = 0.0475% → share 0.0 → «<0.1%»; slide 4's KAMC-basis 1 / 2100 prints 0.0.
  const b = c.labs.rows.find((r) => r.lab === 'B');
  assert.deepEqual([b.share, b.underTenth], [0, true]);
  assert.equal(c.countries.byCountry.find((x) => x.country === 'Saudi Arabia').pct, 0);
  assert.deepEqual(c.cards.lateNoResult, { kamc: 0, sgh: null, combined: 0, delta: { kamc: 0, sgh: null, combined: 0 }, pct: 0, pctBasis: 0 });
  assert.equal(c.funnel.find((s) => s.key === 'received').remaining, 0, 'received > created never draws a negative track');
  assert.equal(c.window, null, 'unstamped models → no window here (stampBothDeltas describes one)');
  assert.equal(c.turnaround, null, 'no KAMC turnaround block → null');
});
