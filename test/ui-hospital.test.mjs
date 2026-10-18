// test/ui-hospital.test.mjs — run with:  node --test
// The three REPORT TYPES wired through the app (KAMC + SGH = the MAIN report and the
// default since the 2026-10-11 user rule / KAMC-only / SGH-only; the main report's own
// rules — names, default, banner, history, automation — are in ui-main-report.test.mjs):
//   • mode switching on the review screen (ui/screen-review.js modelFor /
//     buildOrderFigures): each type is built from ITS hospital's rows only, a switch
//     rebuilds and drops the overrides and the scope, and a failed SGH / BOTH build falls
//     back to KAMC LOUDLY;
//   • the empty-hospital guard (hospitalAvailability): a type with no rows is blocked,
//     never swapped for KAMC;
//   • side reports: SGH never writes the snapshot, the history or the task log
//     (automation/pipeline.js recordRunSnapshot), and the unattended run refuses it;
//   • file names (i18n/ar.js buildFileName / pipeline.js buildFileDefs): the main
//     report untagged (historic), KAMC and SGH tagged;
//   • the unattended pipeline publishes the main report; its KAMC-side steps (engine
//     hero, TAT, lab files) never see an SGH (or third-hospital) row;
//   • the generate screen's share text and the hospital-aware chip stamper.
// SYNTHETIC rows only (made-up ids, labs and tests); the hospital name/id pairs are the
// source's own spellings — organisations, not patients.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOrderFigures, modelFor, hospitalAvailability, reportHospitalOf, bannerDeltasOf,
  slideTogglesFor,
} from '../src/ui/screen-review.js';
import { shareText } from '../src/ui/screen-generate.js';
import {
  AUTOMATION_DEFAULTS, applyWindowDeltas, buildFileDefs, isKamcReport, recordRunSnapshot,
  runAutomation,
} from '../src/automation/pipeline.js';
import { STR, buildFileName, hospitalFileTag } from '../src/i18n/ar.js';
import * as hospitalReport from '../src/model/hospital-report.js';
import { hospitalOf, takeOrders } from '../src/model/hospital.js';
import { compute } from '../src/engine/engine.js';
import { stampWindowDeltas } from '../src/model/delta-window.js';
import { EMPTY_SCOPE, normalizeScope } from '../src/model/scope.js';

const KAMC = { orderingFacilityId: '31763', hospital: 'King Abdul ah Medical City' };
const SGH = { orderingFacilityId: '1037', hospital: 'Saudi German Hospital  Alzahraa Branch' };
const THIRD = { orderingFacilityId: '9002', hospital: 'Another  Hospital' };

const DATE = '2026-10-08';
let seq = 0;
/** A synthetic OrderRow (shape of ingest's output). */
const row = (h, facility, testName, od, over = {}) => {
  seq += 1;
  const d = (x) => (x ? `${x} 00:00:00` : null);
  return {
    orderDate: d(od), facility, orderId: `8${String(seq).padStart(5, '0')}`, lineNo: seq,
    loinc: null, testName, collected: d(over.col), dispatched: d(over.dis), received: d(over.rec),
    resulted: d(over.res), rawStatus: over.status || 'Order Created', tatDaysCsv: over.tatCsv ?? null,
    specimenNo: null, shipmentId: over.ship ?? null, performingFacilityId: null, ...h,
  };
};

// KAMC: 4 lines (one late against the KAMC TAT table), 2 labs.
const kamcRows = () => [
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-09-01', { col: '2026-09-01', dis: '2026-09-01', rec: '2026-09-02', status: 'Specimen Courier Received' }),
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-04', { col: '2026-10-04', dis: '2026-10-04', rec: '2026-10-05', res: '2026-10-07', status: 'Result Approved' }),
  row(KAMC, 'Lab Beta', 'Assay K', '2026-10-06', { col: '2026-10-06', dis: '2026-10-06', status: 'Shipment Dispatched' }),
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-07', { col: '2026-10-07', status: 'Specimen Collected' }),
];
// SGH: 3 lines. 'Assay K' IS in the KAMC TAT table and the first row even carries a CSV
// «TAT - Days» — under KAMC's policy it would be late; under SGH's it never is.
const sghRows = () => [
  row(SGH, 'Saudi Diagnostics Limited Company', 'Assay K', '2026-09-28', { col: '2026-09-28', dis: '2026-09-29', rec: '2026-09-30', tatCsv: 1, status: 'Specimen Courier Received', ship: 'ELAB900001' }),
  row(SGH, 'Company TEMKIN SAHA Medical', 'Assay S', '2026-10-05', { col: '2026-10-05', dis: '2026-10-05', rec: '2026-10-06', res: '2026-10-07', status: 'Result Approved', ship: 'ELAB900002' }),
  row(SGH, 'Company TEMKIN SAHA Medical', 'Assay S', '2026-10-06', { col: '2026-10-06', status: 'Specimen Collected' }),
];
const thirdRows = () => [row(THIRD, 'Lab Gamma', 'Assay Z', '2026-10-01', { col: '2026-10-01' })];

const SETTINGS = {
  tatLookup: { 'Assay K': 2 },
  historicalConstants: { cancelledByMonth: { '2026-01': 2 } },
  snapshot: undefined,
  reportOptions: { excludeNoTat: false, deltaMode: 'week' },
};
const makeStore = () => ({ settings: SETTINGS });

/** A review-screen state after a load through THE door (takeOrders). */
function loadedState(rows, over = {}) {
  const parsed = { orders: null, tracker: { tasks: [], challenges: [], risks: [] }, summary: null, excludedHospitals: [] };
  takeOrders(parsed, rows);
  return { parsed, reportDate: DATE, reportModel: null, engineOutput: null, edits: {}, ...over };
}

const notifier = () => {
  const calls = [];
  return { calls, notify: (msg, type) => calls.push({ msg, type }) };
};

const everyRowIs = (rows, h) => Array.isArray(rows) && rows.every((r) => hospitalOf(r) === h);

/* ------------------------------------------------------------------ *
 * Mode switching (review screen)
 * ------------------------------------------------------------------ */

// UPDATED 2026-10-11 (user rule): unset → 'both', the MAIN weekly report (was 'kamc').
test('reportHospitalOf: unset / unknown → both (the main report); the three modes pass through', () => {
  assert.equal(reportHospitalOf({}), 'both');
  assert.equal(reportHospitalOf(undefined), 'both');
  assert.equal(reportHospitalOf({ reportHospital: 'kamk' }), 'both');
  for (const h of ['kamc', 'sgh', 'both']) assert.equal(reportHospitalOf({ reportHospital: h }), h);
});

test('buildOrderFigures kamc: today\'s figures over parsed.orders (KAMC rows only) + hospital', () => {
  // KAMC chosen explicitly: an unset report type is now the main KAMC + SGH report.
  const state = loadedState([...kamcRows(), ...sghRows(), ...thirdRows()], { reportHospital: 'kamc' });
  const fig = buildOrderFigures(state, makeStore(), undefined, compute);
  assert.equal(fig.hospital, 'kamc');
  assert.ok(everyRowIs(fig.scopedRows, 'kamc'), 'no SGH / third row in the KAMC figures');
  assert.equal(fig.scopedRows.length, 4);
  // The exact compute the screen always made (engineInputs, unscoped).
  const want = compute(state.parsed.orders, SETTINGS.tatLookup, {
    asOf: DATE, cancelledByMonth: SETTINGS.historicalConstants.cancelledByMonth, snapshot: undefined, excludeNoTat: false,
  });
  assert.deepEqual(fig.kpi, want);
  assert.equal('noTestMenu' in fig, false);
});

test('buildOrderFigures sgh: SGH rows only, SGH policy (no TAT, no constants), counts-only send-out', () => {
  const state = loadedState([...kamcRows(), ...sghRows()], { reportHospital: 'sgh' });
  const fig = buildOrderFigures(state, makeStore(), undefined, compute, { hospitalReport });
  assert.equal(fig.hospital, 'sgh');
  assert.equal(fig.noTestMenu, true);
  assert.ok(everyRowIs(fig.scopedRows, 'sgh'));
  assert.equal(fig.kpi.totals.total, 3);
  assert.equal(fig.kpi.buckets.lateNoResult, 0, 'never late: no TAT table, no CSV fallback');
  assert.equal(fig.sendout.noTestMenu, true);
  assert.equal(fig.sendout.total, 3);
  // The same numbers model/hospital-report.js gives for those rows directly.
  const direct = hospitalReport.buildHospitalModel({
    hospital: 'sgh', rows: state.parsed.ordersByHospital.sgh, settings: SETTINGS, reportDate: DATE, scope: EMPTY_SCOPE,
  });
  assert.deepEqual(fig.kpi, direct.kpi);
});

test('buildOrderFigures sgh: a scope narrows SGH\'s OWN rows (its labs, its shipment ids)', () => {
  const state = loadedState([...kamcRows(), ...sghRows()], { reportHospital: 'sgh' });
  const fig = buildOrderFigures(state, makeStore(), { shipments: ['ELAB900002'] }, compute, { hospitalReport });
  assert.equal(fig.scopedRows.length, 1);
  assert.ok(everyRowIs(fig.scopedRows, 'sgh'));
  assert.deepEqual(fig.scope.shipments, ['ELAB900002']);
  assert.equal(fig.shipmentDetails.length, 1);
});

test('buildOrderFigures both: each hospital on its own rows, no scope, no top-level kpi', () => {
  const state = loadedState([...kamcRows(), ...sghRows()], { reportHospital: 'both' });
  const fig = buildOrderFigures(state, makeStore(), { labs: ['Lab Alpha'] }, compute, { hospitalReport });
  assert.equal(fig.hospital, 'both');
  assert.deepEqual(fig.scope, EMPTY_SCOPE, 'scope filters are disabled in BOTH');
  assert.equal(fig.scopedRows, null);
  assert.equal('kpi' in fig, false);
  assert.ok(everyRowIs(fig.kamc.scopedRows, 'kamc'));
  assert.ok(everyRowIs(fig.sgh.scopedRows, 'sgh'));
  assert.equal(fig.combined.cards.total.kamc, 4);
  assert.equal(fig.combined.cards.total.sgh, 3);
  assert.equal(fig.combined.cards.total.combined, 7);
  assert.equal(fig.combined.cards.lateNoResult.sgh, null, 'SGH late is unknown, never 0');
});

test('buildOrderFigures sgh/both without the model module THROWS — never KAMC figures under another name', () => {
  const state = loadedState([...kamcRows(), ...sghRows()]);
  for (const hospital of ['sgh', 'both']) {
    assert.throws(() => buildOrderFigures(state, makeStore(), undefined, compute, { hospital }));
  }
  assert.throws(() => buildOrderFigures(state, makeStore(), undefined, compute, { hospital: 'kamk', hospitalReport }));
});

test('modelFor: switching KAMC → SGH → BOTH → KAMC rebuilds per type, drops overrides and leftovers', () => {
  const state = loadedState([...kamcRows(), ...sghRows()], { reportHospital: 'kamc' });
  const store = makeStore();
  const n = notifier();
  const opts = { hospitalReport, notify: n.notify };

  const kamc = modelFor(state, store, compute, opts);
  assert.equal(kamc.hospital, 'kamc');
  assert.equal(modelFor(state, store, compute, opts), kamc, 'same inputs → the same model object');
  kamc.overrides = { total: 99 };
  kamc.tasksCurrent = [{ task: 'edited by the operator' }];

  state.reportHospital = 'sgh';
  const sgh = modelFor(state, store, compute, opts);
  assert.notEqual(sgh, kamc);
  assert.equal(sgh.hospital, 'sgh');
  assert.equal(sgh.noTestMenu, true);
  assert.deepEqual(sgh.overrides, {}, 'an override typed against KAMC means nothing for SGH');
  assert.deepEqual(sgh.tasksCurrent, [{ task: 'edited by the operator' }], 'non-order edits carry over');
  assert.ok(n.calls.some((c) => c.msg === STR.review.hospital.overridesCleared), 'the operator is told');
  assert.ok(everyRowIs(sgh.scopedRows, 'sgh'));

  state.reportHospital = 'both';
  const both = modelFor(state, store, compute, opts);
  assert.equal(both.hospital, 'both');
  for (const k of ['kpi', 'sendout', 'noTestMenu']) assert.equal(k in both, false, `no SGH leftover: ${k}`);
  assert.ok(both.kamc && both.sgh && both.combined);

  state.reportHospital = 'kamc';
  const back = modelFor(state, store, compute, opts);
  assert.equal(back.hospital, 'kamc');
  for (const k of ['kamc', 'sgh', 'combined', 'noTestMenu']) assert.equal(k in back, false, `no BOTH leftover: ${k}`);
  assert.equal(back.kpi.totals.total, 4);
});

test('modelFor: a failed SGH build falls back to KAMC LOUDLY and resets the choice', () => {
  const state = loadedState([...kamcRows(), ...sghRows()], { reportHospital: 'sgh' });
  const n = notifier();
  const m = modelFor(state, makeStore(), compute, { hospitalReport: null, notify: n.notify });
  assert.equal(m.hospital, 'kamc');
  assert.equal(state.reportHospital, 'kamc');
  assert.deepEqual(n.calls, [{ msg: STR.review.hospital.failed('SGH'), type: 'err' }]);
});

test('modelFor: BOTH drops any scope (decision 7); a scope survives a KAMC rebuild only', () => {
  const state = loadedState([...kamcRows(), ...sghRows()], { reportHospital: 'kamc' });
  const store = makeStore();
  const opts = { hospitalReport, notify: () => {} };
  modelFor(state, store, compute, opts); // binds the scope to this load
  state.scope = normalizeScope({ labs: ['Lab Alpha'] });
  const scoped = modelFor(state, store, compute, opts);
  assert.deepEqual(scoped.scope.labs, ['Lab Alpha']);
  state.reportHospital = 'both';
  const both = modelFor(state, store, compute, opts);
  assert.deepEqual(both.scope, EMPTY_SCOPE);
  assert.deepEqual(state.scope, EMPTY_SCOPE);
});

test('modelFor: an SGH-only file still binds a scope (the load, not the empty KAMC array)', () => {
  const state = loadedState(sghRows(), { reportHospital: 'sgh' });
  const store = makeStore();
  const opts = { hospitalReport, notify: () => {} };
  modelFor(state, store, compute, opts);
  assert.ok(state.scopeEpoch > 0, 'a load exists → an epoch');
  state.scope = normalizeScope({ labs: ['Company TEMKIN SAHA Medical'] });
  const m = modelFor(state, store, compute, opts);
  assert.deepEqual(m.scope.labs, ['Company TEMKIN SAHA Medical']);
  assert.equal(m.scopedRows.length, 2);
});

test('bannerDeltasOf: BOTH sums the hospitals\' chips; lateness from the Test-Menu hospital only', () => {
  const model = {
    hospital: 'both',
    kamc: { kpi: { deltas: { total: 3, completed: 1, lateNoResult: 2 } } },
    sgh: { kpi: { deltas: { total: 2, completed: 0, lateNoResult: 5 } } },
  };
  const d = bannerDeltasOf(model);
  assert.equal(d.total, 5);
  assert.equal(d.completed, 1);
  assert.equal(d.lateNoResult, 2, 'SGH has no Test Menu: its late chip is never counted');
  // KAMC / SGH: the model's own deltas, as always.
  const k = { kpi: { deltas: { total: 7 } } };
  assert.equal(bannerDeltasOf(k), k.kpi.deltas);
});

/* ------------------------------------------------------------------ *
 * Empty-hospital guard
 * ------------------------------------------------------------------ */

test('hospitalAvailability: a report type with no rows is BLOCKED, never swapped for KAMC', () => {
  const kamcOnly = loadedState(kamcRows());
  assert.deepEqual(hospitalAvailability(kamcOnly, 'kamc'), { loaded: true, blocked: false, missing: [] });
  assert.deepEqual(hospitalAvailability(kamcOnly, 'sgh'), { loaded: true, blocked: true, missing: ['sgh'] });
  // BOTH with one hospital absent: allowed, the absence named.
  assert.deepEqual(hospitalAvailability(kamcOnly, 'both'), { loaded: true, blocked: false, missing: ['sgh'] });

  const sghOnly = loadedState(sghRows());
  assert.equal(hospitalAvailability(sghOnly, 'kamc').blocked, true, 'no KAMC report from an SGH-only file');
  assert.equal(hospitalAvailability(sghOnly, 'sgh').blocked, false);
  assert.deepEqual(hospitalAvailability(sghOnly, 'both').missing, ['kamc']);

  // A third hospital alone is no reported hospital's data — but it IS a load, so every
  // report type is BLOCKED (never the nothing-loaded preview path, which would let an SGH
  // or KAMC + SGH choice still in force generate a deck of zeros).
  const thirdOnly = loadedState(thirdRows());
  assert.deepEqual(hospitalAvailability(thirdOnly, 'kamc'), { loaded: true, blocked: true, missing: ['kamc'] });
  assert.deepEqual(hospitalAvailability(thirdOnly, 'sgh'), { loaded: true, blocked: true, missing: ['sgh'] });
  assert.deepEqual(hospitalAvailability(thirdOnly, 'both'), { loaded: true, blocked: true, missing: ['kamc', 'sgh'] });
  // A CSV with no data rows at all: the same — a load with nothing to report.
  assert.equal(hospitalAvailability(loadedState([]), 'sgh').blocked, true);
  // Nothing loaded (mock / tracker-only session): today's preview path, not blocked.
  assert.deepEqual(hospitalAvailability({ parsed: { orders: null } }, 'sgh'), { loaded: false, blocked: false, missing: [] });
});

test('the SGH empty state still builds SGH figures over [] (zeros) — never KAMC\'s', () => {
  const state = loadedState(kamcRows(), { reportHospital: 'sgh' });
  const m = modelFor(state, makeStore(), compute, { hospitalReport, notify: () => {} });
  assert.equal(m.hospital, 'sgh');
  assert.equal(m.kpi.totals.total, 0);
  assert.deepEqual(m.scopedRows, []);
  assert.equal(state.reportHospital, 'sgh', 'the choice is kept; the screen says it is empty');
});

/* ------------------------------------------------------------------ *
 * Side reports: no history / snapshot / taskLog
 * ------------------------------------------------------------------ */

function spyStore() {
  return {
    snapshots: [], docs: [], loads: 0,
    updateSnapshot(s) { this.snapshots.push(s); },
    loadSettings() { this.loads += 1; return { snapshotHistory: {} }; },
    saveSettings(doc) { this.docs.push(doc); },
  };
}
const fullModel = (over = {}) => ({
  reportDate: DATE,
  scope: EMPTY_SCOPE,
  kpi: { totals: { total: 10 }, funnel: {}, buckets: { completed: 5 } },
  tasksCurrent: [{ task: 'a', status: 'مغلق' }],
  tasksInternal: [{ task: 'b', status: 'مستمر' }],
  ...over,
});

// UPDATED 2026-10-11 (user rule): the main KAMC + SGH report now records (KAMC's numbers
// from its KAMC sub-model — ui-main-report.test.mjs). A 'both' model WITHOUT that
// sub-model (this fake) still writes nothing: there is no KAMC report in it to record.
test('recordRunSnapshot: SGH / unknown types (and a BOTH model with no KAMC sub-model) write NOTHING', () => {
  for (const hospital of ['sgh', 'both', 'SGH', 'kamc ', 'BOTH']) {
    const st = spyStore();
    const calls = { snapshot: 0, tasks: 0 };
    recordRunSnapshot({
      model: fullModel({ hospital }), store: st, state: {}, date: DATE,
      recordSnapshot: () => { calls.snapshot += 1; return {}; },
      recordShownTasks: () => { calls.tasks += 1; return {}; },
    });
    assert.equal(st.snapshots.length, 0, `${hospital}: no updateSnapshot`);
    assert.equal(st.docs.length, 0, `${hospital}: no saveSettings`);
    assert.equal(st.loads, 0, `${hospital}: the settings doc is not even read`);
    assert.deepEqual(calls, { snapshot: 0, tasks: 0 }, `${hospital}: neither writer called`);
  }
});

// UPDATED 2026-10-13 (tracker CONTRACT §1.4): the KAMC report still records its numbers,
// but NOTHING writes the task log any more — the old tracker's closed-task-once lifecycle
// is retired (the new tracker slides show the document as it is), even for a model that
// still carries old task lists.
test('recordRunSnapshot: the KAMC report (explicit or absent hospital) records its numbers, never the task log', () => {
  for (const over of [{}, { hospital: 'kamc' }, { hospital: null }]) {
    const st = spyStore();
    const calls = { snapshot: 0, tasks: 0 };
    recordRunSnapshot({
      model: fullModel(over), store: st, state: {}, date: DATE,
      recordSnapshot: () => { calls.snapshot += 1; return {}; },
      recordShownTasks: () => { calls.tasks += 1; return {}; },
    });
    assert.equal(st.snapshots.length, 1, JSON.stringify(over));
    assert.deepEqual(calls, { snapshot: 1, tasks: 0 });
  }
});

test('isKamcReport: only kamc / absent', () => {
  assert.equal(isKamcReport({}), true);
  assert.equal(isKamcReport({ hospital: 'kamc' }), true);
  assert.equal(isKamcReport(null), true);
  for (const h of ['sgh', 'both', 'KAMC', '']) assert.equal(isKamcReport({ hospital: h }), false, h);
});

/* ------------------------------------------------------------------ *
 * File names
 * ------------------------------------------------------------------ */

// UPDATED 2026-10-11 (user rule): the MAIN report (KAMC + SGH) keeps the historic name;
// a single-hospital report is tagged with its code (was: KAMC untagged, BOTH ' - KAMC SGH -').
test('file names: the main report (both) historic, KAMC and SGH tagged, absent = KAMC', () => {
  const P = 'تقرير مسبار';
  assert.equal(buildFileName(P, DATE, 'pptx', EMPTY_SCOPE, 'both'), 'تقرير مسبار 08102026.pptx');
  assert.equal(buildFileName(P, DATE, 'pptx', undefined, 'both'), 'تقرير مسبار 08102026.pptx');
  assert.equal(buildFileName(P, DATE, 'pptx', EMPTY_SCOPE, 'kamc'), 'تقرير مسبار - KAMC - 08102026.pptx');
  assert.equal(buildFileName(P, DATE, 'pdf', EMPTY_SCOPE, 'sgh'), 'تقرير مسبار - SGH - 08102026.pdf');
  // No report type = a legacy KAMC-only model = tagged KAMC.
  assert.equal(buildFileName(P, DATE, 'pptx'), 'تقرير مسبار - KAMC - 08102026.pptx');
  // The scope rules apply on top, unchanged.
  assert.equal(
    buildFileName(P, DATE, 'pptx', { from: '2026-10-01', to: DATE }, 'sgh'),
    'تقرير مسبار - SGH - 01102026-08102026 (مخصص).pptx',
  );
  assert.equal(hospitalFileTag('both'), '');
  assert.equal(hospitalFileTag('kamc'), ' - KAMC -');
  assert.equal(hospitalFileTag(undefined), ' - KAMC -');
  assert.equal(hospitalFileTag(null), ' - KAMC -');
  assert.equal(hospitalFileTag('sgh'), ' - SGH -');
  assert.throws(() => hospitalFileTag('sgx'), /unknown report type/);
  assert.throws(() => hospitalFileTag('KAMC SGH'), /unknown report type/);
});

test('buildFileDefs: the same four files in every report type, each name tagged per type', () => {
  const main = buildFileDefs(DATE, EMPTY_SCOPE, 'both');
  assert.deepEqual(main.map((d) => d.name), [
    'تقرير مسبار الداخلي 08102026.pptx', 'تقرير مسبار 08102026.pptx',
    'تقرير مسبار الداخلي 08102026.pdf', 'تقرير مسبار 08102026.pdf',
  ], 'the main report = the historic names, byte for byte');
  assert.deepEqual(buildFileDefs(DATE, EMPTY_SCOPE), buildFileDefs(DATE, EMPTY_SCOPE, 'kamc'), 'absent = kamc');
  for (const h of ['kamc', 'sgh']) {
    const defs = buildFileDefs(DATE, EMPTY_SCOPE, h);
    assert.deepEqual(defs.map((d) => [d.id, d.variant, d.kind]), main.map((d) => [d.id, d.variant, d.kind]));
    const tag = h === 'sgh' ? ' - SGH - ' : ' - KAMC - ';
    // The tag sits right after the prefix, before the date — the same place for both codes.
    main.forEach((m, i) => assert.equal(defs[i].name, m.name.replace(' 08102026.', `${tag}08102026.`)));
    // Never the main deck's name: no overwrite in Downloads.
    for (const d of defs) assert.ok(!main.some((k) => k.name === d.name));
  }
});

/* ------------------------------------------------------------------ *
 * The unattended pipeline: the MAIN report's deck, KAMC-only everything else
 * UPDATED 2026-10-11 (user rule): was "KAMC-only in every step". The deck is now the
 * combined KAMC + SGH report; engine hero / TAT / lab files stay KAMC's rows.
 * ------------------------------------------------------------------ */

test('runAutomation: the deck is KAMC + SGH; engine, TAT, lab files see KAMC rows only; the pull line says SGH is in', async () => {
  const pulled = [...kamcRows(), ...sghRows(), ...thirdRows()];
  const seen = {};
  const state = {
    files: { csv: null, tracker: null },
    parsed: { orders: null, tracker: null, summary: null, excludedHospitals: [] },
    reportModel: null, edits: {}, reportDate: DATE,
    reportHospital: 'both', // the operator's review choice — never read by the automation
  };
  const store = {
    settings: {
      grafana: { enabled: true, baseUrl: 'https://grafana.test', accessToken: 'tok', dataKey: '' },
      tatLookup: {},
    },
    updateSnapshot() {}, loadSettings() { return {}; }, saveSettings() {}, setTat() {},
  };
  const res = await runAutomation({
    store,
    state,
    options: {
      ...AUTOMATION_DEFAULTS, enabled: true, autoPull: true, autoGenerate: true, autoLabFiles: true, autoEmailDrafts: true, autoAcceptTat: true,
    },
    deps: {
      loadGrafana: async () => ({ yearStartMs: () => 0, fetchKamcOrders: async () => ({ rows: pulled, errors: [] }) }),
      loadEngine: async () => ({ compute: (rows) => { seen.engine = rows; return { totals: { total: rows.length }, funnel: {}, buckets: { completed: 0 } }; } }),
      loadReportModel: async () => ({
        buildReportModel: ({ engineOutput, reportDate, orders }) => { seen.model = orders; return { reportDate, kpi: engineOutput }; },
      }),
      loadDeltaBaseline: async () => null,
      // The KAMC stamper must never touch the main report (its chips are per hospital).
      loadDeltaWindow: async () => ({ stampWindowDeltas: (m, { rows }) => { seen.deltas = rows; } }),
      // The REAL main-report builder, so the deck below is the true combined model.
      loadHospitalReport: async () => hospitalReport,
      loadTaskLifecycle: async () => null,
      loadSendoutMaster: async () => null,
      loadLateLabs: async () => ({ buildLateLabWorkbooks: ({ rows }) => { seen.labs = rows; return []; } }),
      loadTatSuggest: async () => ({ suggestTats: ({ rows, unmatched }) => { seen.tat = rows; seen.unmatched = unmatched; return []; } }),
      loadTatLoinc: async () => null,
      loadEmlDraft: async () => null,
      loadLabContacts: async () => null,
      loadDownload: async () => null,
      produceReportFiles: async ({ model }) => { seen.produced = model; return [{ def: { name: 'x.pptx', variant: 'internal' }, blob: { size: 1 } }]; },
      now: () => Date.parse('2026-10-08T08:00:00Z'),
    },
  });
  for (const k of ['engine', 'model', 'labs', 'tat']) {
    assert.ok(Array.isArray(seen[k]), `${k} step ran`);
    assert.equal(seen[k].length, 4, `${k}: the 4 KAMC rows`);
    assert.ok(everyRowIs(seen[k], 'kamc'), `${k}: KAMC rows only`);
  }
  assert.equal(seen.deltas, undefined, 'the KAMC stamper is never run on the main report');
  assert.ok(!seen.unmatched.includes('Assay S'), 'no SGH test name is ever offered a TAT');
  // The deck: the main report, each hospital from its own rows, no third hospital.
  const m = seen.produced;
  assert.equal(m.hospital, 'both', 'the automation builds the MAIN report');
  assert.ok(everyRowIs(m.kamc.scopedRows, 'kamc') && m.kamc.scopedRows.length === 4);
  assert.ok(everyRowIs(m.sgh.scopedRows, 'sgh') && m.sgh.scopedRows.length === 3);
  assert.equal(m.combined.cards.total.combined, 7, 'KAMC 4 + SGH 3; the third hospital never counted');
  assert.equal('kpi' in m, false, 'no single-hospital leftover');
  const pull = res.steps.find((s) => s.id === 'pull');
  assert.ok(pull.message.includes(STR.upload.sghInAutomated(3)), pull.message);
  assert.ok(pull.message.includes(STR.upload.hospitalExcludedShort(1, 'Another Hospital')), pull.message);
});

test('runAutomation: the pull line claims SGH is "in the automatic report" only when a deck can exist', async () => {
  // Review round 2026-10-11: an SGH-only load (engine skips: no KAMC rows) or a run with
  // generate switched off makes no deck — the pull line then gives a neutral count.
  const run = async (pulled, autoGenerate) => runAutomation({
    store: {
      settings: { grafana: { enabled: true, baseUrl: 'https://grafana.test', accessToken: 'tok', dataKey: '' }, tatLookup: {} },
      updateSnapshot() {}, loadSettings() { return {}; }, saveSettings() {}, setTat() {},
    },
    state: {
      files: { csv: null, tracker: null },
      parsed: { orders: null, tracker: null, summary: null, excludedHospitals: [] },
      reportModel: null, edits: {}, reportDate: DATE,
    },
    options: { ...AUTOMATION_DEFAULTS, enabled: true, autoPull: true, autoGenerate },
    deps: {
      loadGrafana: async () => ({ yearStartMs: () => 0, fetchKamcOrders: async () => ({ rows: pulled, errors: [] }) }),
      loadEngine: async () => ({ compute: (rows) => ({ totals: { total: rows.length }, funnel: {}, buckets: {} }) }),
      loadReportModel: async () => ({ buildReportModel: ({ reportDate, engineOutput }) => ({ reportDate, kpi: engineOutput }) }),
      loadHospitalReport: async () => hospitalReport,
      loadDeltaWindow: async () => null,
      loadDeltaBaseline: async () => null,
      loadTaskLifecycle: async () => null,
      loadSendoutMaster: async () => null,
      produceReportFiles: async () => [{ def: { name: 'x', variant: 'internal' }, blob: { size: 1 } }],
      now: () => Date.parse('2026-10-08T08:00:00Z'),
    },
  });
  const pullMsg = (res) => res.steps.find((s) => s.id === 'pull').message;
  // SGH-only load, generate on: no deck (engine skips) → neutral count.
  const sghOnly = await run(sghRows(), true);
  assert.equal(sghOnly.steps.find((s) => s.id === 'engine').status, 'skip');
  assert.ok(pullMsg(sghOnly).includes(STR.upload.sghPulledOnly(3)), pullMsg(sghOnly));
  assert.ok(!pullMsg(sghOnly).includes(STR.upload.sghInAutomated(3)), pullMsg(sghOnly));
  // Generate switched off: neutral count.
  const off = await run([...kamcRows(), ...sghRows()], false);
  assert.ok(pullMsg(off).includes(STR.upload.sghPulledOnly(3)), pullMsg(off));
  assert.ok(!pullMsg(off).includes(STR.upload.sghInAutomated(3)), pullMsg(off));
  // Both conditions met: the "in the automatic report" line, as before.
  const on = await run([...kamcRows(), ...sghRows()], true);
  assert.ok(pullMsg(on).includes(STR.upload.sghInAutomated(3)), pullMsg(on));
  assert.equal(on.steps.find((s) => s.id === 'generate').status, 'done');
});

// UPDATED 2026-10-11 (user rule): the guard now refuses anything that is not the MAIN
// report (was: anything not KAMC). Each builder answer below must be refused.
test('runAutomation: stepGenerate refuses a model that is not the main report (belt and braces)', async () => {
  for (const hospital of ['kamc', 'sgh', undefined, 'BOTH']) {
    let produced = 0;
    const res = await runAutomation({
      store: { settings: { grafana: {}, tatLookup: {} } },
      state: {
        files: { csv: null, tracker: null },
        parsed: { orders: kamcRows(), tracker: null, summary: null, excludedHospitals: [] },
        reportDate: DATE, edits: {},
      },
      options: { ...AUTOMATION_DEFAULTS, enabled: true, autoGenerate: true },
      deps: {
        loadEngine: async () => ({ compute: () => ({ totals: { total: 4 }, funnel: {}, buckets: {} }) }),
        loadReportModel: async () => ({ buildReportModel: ({ reportDate, engineOutput }) => ({ reportDate, kpi: engineOutput }) }),
        loadHospitalReport: async () => ({
          buildBothModel: ({ reportDate }) => ({ hospital, reportDate, kamc: {}, sgh: {}, combined: {} }),
        }),
        loadDeltaWindow: async () => null,
        loadSendoutMaster: async () => null,
        produceReportFiles: async () => { produced += 1; return []; },
      },
    });
    const gen = res.steps.find((s) => s.id === 'generate');
    assert.equal(gen.status, 'error', String(hospital));
    assert.equal(produced, 0, `${hospital}: no file is produced`);
  }
});

test('runAutomation: the drafted model\'s own fields never decide the deck type — the builder does', async () => {
  // buildReportModel only drafts the non-order content; a stray `hospital` on it (here
  // 'kamc') is replaced by buildBothModel's answer, so the deck is still the main report.
  let seenModel = null;
  const res = await runAutomation({
    store: { settings: { grafana: {}, tatLookup: {} } },
    state: {
      files: { csv: null, tracker: null },
      parsed: { orders: kamcRows(), tracker: null, summary: null, excludedHospitals: [] },
      reportDate: DATE, edits: {},
    },
    options: { ...AUTOMATION_DEFAULTS, enabled: true, autoGenerate: true },
    deps: {
      loadEngine: async () => ({ compute: () => ({ totals: { total: 4 }, funnel: {}, buckets: {} }) }),
      loadReportModel: async () => ({ buildReportModel: ({ reportDate, engineOutput }) => ({ reportDate, kpi: engineOutput, hospital: 'kamc' }) }),
      loadHospitalReport: async () => hospitalReport,
      loadDeltaWindow: async () => null,
      loadDeltaBaseline: async () => null,
      loadTaskLifecycle: async () => null,
      loadSendoutMaster: async () => null,
      produceReportFiles: async ({ model }) => { seenModel = model; return [{ def: { name: 'x', variant: 'internal' }, blob: { size: 1 } }]; },
    },
  });
  assert.equal(res.steps.find((s) => s.id === 'generate').status, 'done');
  assert.equal(seenModel.hospital, 'both');
});

/* ------------------------------------------------------------------ *
 * Generate screen: chips + share text per report type
 * ------------------------------------------------------------------ */

test('applyWindowDeltas: an SGH model is stamped by its own policy — never the KAMC stamper or rows', () => {
  const state = loadedState([...kamcRows(), ...sghRows()], { reportHospital: 'sgh' });
  const fig = buildOrderFigures(state, makeStore(), undefined, compute, { hospitalReport });
  const model = { ...fig, reportOptions: SETTINGS.reportOptions };
  let kamcStamper = 0;
  applyWindowDeltas(model, state, makeStore(), () => { kamcStamper += 1; }, hospitalReport);
  assert.equal(kamcStamper, 0, 'the KAMC stamper (settings.tatLookup) is never used');
  // Deep-equal to what the review screen's own SGH stamp gives.
  const again = { ...fig, kpi: { ...fig.kpi }, reportOptions: SETTINGS.reportOptions };
  hospitalReport.stampHospitalDeltas(again, { rows: fig.scopedRows, settings: SETTINGS, mode: 'week' });
  assert.deepEqual(model.kpi.deltas, again.kpi.deltas);
  assert.deepEqual(model.deltaWindow, again.deltaWindow);
  // Without the module: the built chips stay, nothing throws, still no KAMC stamper.
  applyWindowDeltas({ ...fig }, state, makeStore(), () => { kamcStamper += 1; }, null);
  assert.equal(kamcStamper, 0);
});

test('applyWindowDeltas: a BOTH model is re-stamped idempotently; a KAMC model as always', () => {
  const state = loadedState([...kamcRows(), ...sghRows()], { reportHospital: 'both' });
  const fig = buildOrderFigures(state, makeStore(), undefined, compute, { hospitalReport });
  const before = JSON.stringify(fig.combined);
  applyWindowDeltas(fig, state, makeStore(), () => assert.fail('KAMC stamper on BOTH'), hospitalReport);
  assert.equal(JSON.stringify(fig.combined), before);

  const kstate = loadedState(kamcRows(), { reportHospital: 'kamc' });
  const k = buildOrderFigures(kstate, makeStore(), undefined, compute);
  let rowsSeen = null;
  applyWindowDeltas(k, kstate, makeStore(), (m, a) => { rowsSeen = a.rows; return stampWindowDeltas(m, a); });
  assert.equal(rowsSeen, k.scopedRows);
});

test('shareText: KAMC / SGH (single-hospital) name their type; SGH prints «–» for late; BOTH (main) keeps the historic heading and sums', () => {
  const kamc = { reportDate: DATE, kpi: { totals: { total: 10 }, buckets: { completed: 5, awaitingResults: 2, lateNoResult: 1, rejected: 1 }, cancelledNote: 0 }, overrides: {} };
  // The 2026-10-11 naming rule, applied to the pasted text: KAMC-only is a single-hospital
  // report, so it names itself — a legacy model (no hospital field) and an explicit 'kamc'.
  for (const m of [kamc, { ...kamc, hospital: 'kamc' }]) {
    const kl = shareText(m, DATE, 4).split('\n');
    assert.ok(kl[0].startsWith('تقرير مسبار الأسبوعي — '), kl[0]);
    assert.equal(kl[1], STR.generate.reportType('KAMC'), 'the KAMC-only message names its type');
    assert.ok(kl.includes('• إجمالي الطلبات: 10'));
  }

  const sgh = { ...kamc, hospital: 'sgh', noTestMenu: true };
  const lines = shareText(sgh, DATE, 4).split('\n');
  assert.equal(lines[1], STR.generate.reportType('SGH'));
  assert.ok(lines.includes('↳ منها متأخرة: –'), lines.join('|'));
  // A hand-typed late figure wins on SGH exactly as on the deck's late card (build-spec.js
  // lateUnknown = no-Test-Menu AND no override): the pasted text must match the deck.
  const sghOv = shareText({ ...sgh, overrides: { lateNoResult: 3 } }, DATE, 4).split('\n');
  assert.ok(sghOv.some((l) => l.startsWith('↳ منها متأخرة: 3')), sghOv.join('|'));

  const both = {
    hospital: 'both', reportDate: DATE,
    kamc: { kpi: { totals: { total: 10 }, buckets: { completed: 5, awaitingResults: 2, rejected: 1, lateNoResult: 1 }, cancelledNote: 2 } },
    sgh: { kpi: { totals: { total: 3 }, buckets: { completed: 1, awaitingResults: 1, rejected: 0, lateNoResult: 0 }, cancelledNote: 0 } },
    combined: { cards: { lateNoResult: { combined: 1 } } },
  };
  const b = shareText(both, DATE, 4).split('\n');
  // The MAIN report: the historic heading straight into the bullets — no type line at all.
  assert.ok(b[0].startsWith('تقرير مسبار الأسبوعي — '));
  assert.equal(b[1], '• إجمالي الطلبات: 13', 'no type line under the main report heading');
  assert.ok(!b.some((l) => l.startsWith('نوع التقرير')), b.join('|'));
  assert.ok(b.includes('• إجمالي الطلبات: 13'));
  assert.ok(b.includes('• فحوصات مكتملة (تشمل المرفوضة): 6 (46%)'));
  assert.ok(b.includes('↳ منها متأخرة: 1 (KAMC)'));
  assert.ok(b.includes('• ملغاة: 2'));
});

// UPDATED 2026-10-13 (tracker CONTRACT §1.5): the «متابعة المشروع» chip ('tracker')
// replaced «المهام» ('action', retired with the old tracker) and is offered in ALL three
// report types — the tracker slides sit in the main KAMC + SGH deck too.
// UPDATED 2026-10-18: + 'trackerCompleted' (the weekly «المهام المكتملة خلال الأسبوع» slide),
// right after the task slides, in every deck type.
test('slide chips: KAMC / SGH offer all seven; KAMC + SGH the five its deck honours (tracker included)', () => {
  const keys = (h) => slideTogglesFor(h).map((t) => t.key);
  const all = ['execFunnel', 'monthly', 'sendout', 'compliance', 'tracker', 'trackerCompleted', 'challenges'];
  assert.deepEqual(keys('kamc'), all);
  assert.deepEqual(keys('sgh'), all);
  // build-spec-both.js reads on('monthly' | 'sendout' | 'compliance' | 'tracker' | 'trackerCompleted').
  assert.deepEqual(keys('both'), ['monthly', 'sendout', 'compliance', 'tracker', 'trackerCompleted']);
  for (const h of ['kamc', 'sgh', 'both']) assert.ok(!keys(h).includes('action'), `${h}: the retired «المهام» chip`);
});

test('upload notices: SGH lines are KEPT (counted + pointed at the review screen), third hospitals excluded', () => {
  const s = STR.upload.sghRows(41);
  assert.ok(s.includes('41') && s.includes('SGH') && s.includes('شاشة المراجعة'), s);
  const parsed = { orders: null, excludedHospitals: [] };
  takeOrders(parsed, [...kamcRows(), ...sghRows(), ...thirdRows()]);
  assert.equal(parsed.ordersByHospital.sgh.length, 3);
  assert.deepEqual(parsed.excludedHospitals.map((h) => h.count), [1], 'only the third hospital is excluded');
});
