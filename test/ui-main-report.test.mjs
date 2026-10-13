// test/ui-main-report.test.mjs — run with:  node --test
// THE MAIN REPORT (user rule, 2026-10-11): "the file name should be the same as before
// WHEN it is for BOTH (SGH + KAMC) as it will be the MAIN report from now on as a weekly";
// a single-hospital report (KAMC or SGH) is the special case and carries its code in the
// file name. Pinned here, rule by rule:
//   1. file names — main report historic (scoped rules unchanged), KAMC / SGH tagged in
//      the same place, a model with no report type = legacy KAMC = tagged; every model
//      the review builds names its files by its REAL type;
//   2. the default report type is the main report, also with no SGH rows in the load
//      (never silently KAMC); a failed main build still falls back to KAMC, loudly;
//   3. the review wording — the hint names the main report and the file-name tag; no
//      side-report banner for the main or the unscoped KAMC report, kept for SGH;
//   4. published history — an unscoped main report records KAMC's numbers from its KAMC
//      sub-model, EQUAL to what a KAMC report records for the same date; KAMC keeps
//      snapshot + history; SGH writes nothing; NO report type writes the (retired,
//      2026-10-13) closed-task log;
//   5. the automation publishes the main report (historic names, the real combined
//      model) and keeps TAT / lab files / history on KAMC's rows and numbers.
// SYNTHETIC rows only (made-up ids, labs and tests); the hospital name/id pairs are the
// source's own spellings — organisations, not patients.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  modelFor, hospitalAvailability, reportHospitalOf, sideReportNotice, historyPanelPlan,
} from '../src/ui/screen-review.js';
import {
  AUTOMATION_DEFAULTS, buildFileDefs, isMainReport, recordRunSnapshot, runAutomation,
} from '../src/automation/pipeline.js';
import { STR } from '../src/i18n/ar.js';
import { state as appState, resetRunData } from '../src/state.js';
import * as hospitalReport from '../src/model/hospital-report.js';
import { hospitalOf, takeOrders } from '../src/model/hospital.js';
import { compute } from '../src/engine/engine.js';
import { recordSnapshot } from '../src/model/delta-baseline.js';
import { recordShownTasks } from '../src/model/task-lifecycle.js';
import { normalizeScope } from '../src/model/scope.js';

const KAMC = { orderingFacilityId: '31763', hospital: 'King Abdul ah Medical City' };
const SGH = { orderingFacilityId: '1037', hospital: 'Saudi German Hospital  Alzahraa Branch' };
const THIRD = { orderingFacilityId: '9002', hospital: 'Another  Hospital' };

const DATE = '2026-10-08';
const HISTORIC = [
  'تقرير مسبار الداخلي 08102026.pptx', 'تقرير مسبار 08102026.pptx',
  'تقرير مسبار الداخلي 08102026.pdf', 'تقرير مسبار 08102026.pdf',
];
const tagged = (tag) => HISTORIC.map((n) => n.replace(' 08102026.', ` - ${tag} - 08102026.`));

let seq = 0;
/** A synthetic OrderRow (shape of ingest's output). */
const row = (h, facility, testName, od, over = {}) => {
  seq += 1;
  const d = (x) => (x ? `${x} 00:00:00` : null);
  return {
    orderDate: d(od), facility, orderId: `7${String(seq).padStart(5, '0')}`, lineNo: seq,
    loinc: null, testName, collected: d(over.col), dispatched: d(over.dis), received: d(over.rec),
    resulted: d(over.res), rawStatus: over.status || 'Order Created', tatDaysCsv: over.tatCsv ?? null,
    specimenNo: null, shipmentId: over.ship ?? null, performingFacilityId: null, ...h,
  };
};

// KAMC: 5 lines over two labs, one late against the TAT table, one rejected-free result,
// a January order (the cancelled-by-month constants apply to KAMC only).
const kamcRows = () => [
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-01-12', { col: '2026-01-12', dis: '2026-01-12', rec: '2026-01-13', res: '2026-01-15', status: 'Result Approved' }),
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-09-01', { col: '2026-09-01', dis: '2026-09-01', rec: '2026-09-02', status: 'Specimen Courier Received' }),
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-04', { col: '2026-10-04', dis: '2026-10-04', rec: '2026-10-05', res: '2026-10-07', status: 'Result Approved' }),
  row(KAMC, 'Lab Beta', 'Assay K', '2026-10-06', { col: '2026-10-06', dis: '2026-10-06', status: 'Shipment Dispatched' }),
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-07', { col: '2026-10-07', status: 'Specimen Collected' }),
];
// SGH: 3 lines; 'Assay K' IS in the KAMC TAT table and one carries a CSV TAT — never used.
const sghRows = () => [
  row(SGH, 'Saudi Diagnostics Limited Company', 'Assay K', '2026-09-28', { col: '2026-09-28', dis: '2026-09-29', rec: '2026-09-30', tatCsv: 1, status: 'Specimen Courier Received' }),
  row(SGH, 'Company TEMKIN SAHA Medical', 'Assay S', '2026-10-05', { col: '2026-10-05', dis: '2026-10-05', rec: '2026-10-06', res: '2026-10-07', status: 'Result Approved' }),
  row(SGH, 'Company TEMKIN SAHA Medical', 'Assay S', '2026-10-06', { col: '2026-10-06', status: 'Specimen Collected' }),
];
const thirdRows = () => [row(THIRD, 'Lab Gamma', 'Assay Z', '2026-10-01', { col: '2026-10-01' })];

// A SYNTHETIC tagged ProjectTracker (UPDATED 2026-10-13, tracker CONTRACT §1.2 — the old
// {tasks, challenges, risks} fixture is now "no tracker"): an open task, a delayed one and
// a completed one (under the retired lifecycle a closed row's one grace showing was what
// a report "spent" — nothing spends anything now).
const TRACKER = () => ({
  format: 'misbar-task-tracker-v1', fileName: 'synthetic-tracker.xlsx', loadedAt: '2026-10-07T06:00:00.000Z', editedAt: null, warnings: [],
  tasks: [['1.1', 'In Progress'], ['1.2', 'Delayed'], ['1.3', 'Completed']].map(([wbs, status]) => ({
    id: wbs, wbs, track: 'Track Q', milestone: 'Milestone Q', workstream: 'WS', workPackage: 'WP', task: `Synthetic ${wbs}`,
    taskType: 'Deliverable', organization: 'NUPCO / LEAN', owner: 'Owner Q', priority: 'Medium', status, due: '2026-10-20',
    predecessor: '', nextAction: '', definitionOfDone: '', notes: '',
  })),
});

const SETTINGS = () => ({
  tatLookup: { 'Assay K': 2 },
  historicalConstants: { cancelledByMonth: { '2026-01': 2 } },
  snapshot: undefined,
  reportOptions: { excludeNoTat: false, deltaMode: 'week' },
});

/** A review-screen state after a load through THE door (takeOrders). */
function loadedState(rows, over = {}) {
  const parsed = { orders: null, tracker: TRACKER(), summary: null, excludedHospitals: [] };
  takeOrders(parsed, rows);
  return { parsed, reportDate: DATE, reportModel: null, engineOutput: null, edits: {}, ...over };
}

/** A settings store that persists like the real one: loadSettings hands a copy of the
 *  doc, saveSettings replaces it, updateSnapshot writes doc.snapshot. */
function memStore(settings = SETTINGS()) {
  let doc = { ...settings };
  return {
    get settings() { return doc; },
    snapshots: [],
    updateSnapshot(s) { this.snapshots.push(s); doc = { ...doc, snapshot: s }; },
    loadSettings() { return structuredClone(doc); },
    saveSettings(d) { doc = structuredClone(d); },
  };
}

const quiet = { hospitalReport, notify: () => {} };
const namesOf = (m) => buildFileDefs(m.reportDate, m.scope, m.hospital).map((d) => d.name);

/* ------------------------------------------------------------------ *
 * 1. File names follow the REAL report type of the model
 * ------------------------------------------------------------------ */

test('names: every model the review builds is named by its real type — main historic, KAMC/SGH tagged', () => {
  const rows = [...kamcRows(), ...sghRows()];
  const byType = {};
  for (const h of ['both', 'kamc', 'sgh']) {
    const m = modelFor(loadedState(rows, { reportHospital: h }), memStore(), compute, quiet);
    assert.equal(m.hospital, h);
    byType[h] = namesOf(m);
  }
  assert.deepEqual(byType.both, HISTORIC, 'the main report = the historic names, byte for byte');
  assert.deepEqual(byType.kamc, tagged('KAMC'));
  assert.deepEqual(byType.sgh, tagged('SGH'));
  // The default (no choice made) is the main report → historic names.
  assert.deepEqual(namesOf(modelFor(loadedState(rows), memStore(), compute, quiet)), HISTORIC);
  // A legacy model (no report type: its numbers are KAMC's alone) is never untagged.
  assert.deepEqual(buildFileDefs(DATE, undefined, undefined).map((d) => d.name), tagged('KAMC'));
});

test('names: a scoped single-hospital report keeps its tag and the scope rules on top', () => {
  const state = loadedState([...kamcRows(), ...sghRows()], { reportHospital: 'kamc' });
  const store = memStore();
  modelFor(state, store, compute, quiet); // binds the scope to this load
  state.scope = normalizeScope({ from: '2026-10-01', to: '2026-10-07' });
  const m = modelFor(state, store, compute, quiet);
  assert.deepEqual(namesOf(m), HISTORIC.map((n) => n.replace(' 08102026.', ' - KAMC - 01102026-07102026 (مخصص).')));
});

/* ------------------------------------------------------------------ *
 * 2. The default report type is the main report
 * ------------------------------------------------------------------ */

test('default: a fresh run is KAMC + SGH, and «تقرير جديد» returns to it', () => {
  resetRunData();
  assert.equal(appState.reportHospital, 'both');
  assert.equal(reportHospitalOf(appState), 'both');
});

test('default: a load WITHOUT SGH rows is still the main report (SGH 0, the missing notice) — never KAMC', () => {
  const state = loadedState(kamcRows());
  const m = modelFor(state, memStore(), compute, quiet);
  assert.equal(m.hospital, 'both');
  assert.equal(state.reportHospital, undefined, 'the choice is not rewritten');
  assert.equal(m.combined.cards.total.sgh, 0);
  assert.equal(m.combined.cards.total.combined, m.combined.cards.total.kamc);
  assert.deepEqual(hospitalAvailability(state), { loaded: true, blocked: false, missing: ['sgh'] });
  assert.deepEqual(namesOf(m), HISTORIC);
});

test('default: a failed main build falls back to KAMC exactly as before — loudly, choice reset, tagged names', () => {
  const state = loadedState([...kamcRows(), ...sghRows()]);
  const calls = [];
  const m = modelFor(state, memStore(), compute, { hospitalReport: null, notify: (msg, type) => calls.push({ msg, type }) });
  assert.equal(m.hospital, 'kamc');
  assert.equal(state.reportHospital, 'kamc');
  assert.deepEqual(calls, [{ msg: STR.review.hospital.failed('KAMC + SGH'), type: 'err' }]);
  // What is now on screen is KAMC's report, and its files say so.
  assert.deepEqual(namesOf(m), tagged('KAMC'));
});

/* ------------------------------------------------------------------ *
 * 3. Review wording: hint + side-report banner
 * ------------------------------------------------------------------ */

test('hint: names KAMC + SGH as the main weekly report and the hospital code in a single report\'s file name', () => {
  const h = STR.review.hospital.hint;
  assert.ok(h.includes('KAMC + SGH'), h);
  assert.ok(h.includes('الرئيسي'), h);
  assert.ok(h.includes('اسم الملف'), h);
  assert.ok(h.includes('KAMC أو SGH'), h);
  assert.ok(!h.includes('جانبي'), 'the main report is no longer called a side report');
  // Bidi: Arabic at both ends of the sentence.
  assert.match(h, /^[؀-ۿ]/);
  assert.match(h, /[؀-ۿ]\.$/);
});

test('banner: none for the main report or the unscoped KAMC report; kept for SGH and any scope', () => {
  const rows = [...kamcRows(), ...sghRows()];
  const built = (h) => modelFor(loadedState(rows, { reportHospital: h }), memStore(), compute, quiet);
  assert.equal(sideReportNotice(built('both')), null, 'main report: recorded, no side banner');
  assert.equal(sideReportNotice(built('kamc')), null, 'unscoped KAMC: recorded, no side banner');
  assert.equal(sideReportNotice({ kpi: {} }), null, 'legacy model (= KAMC), unscoped');
  assert.deepEqual(sideReportNotice(built('sgh')), {
    title: STR.generate.reportType('SGH'), text: STR.review.hospital.sideReport,
  });
  const scopedKamc = { hospital: 'kamc', scope: normalizeScope({ labs: ['Lab Alpha'] }) };
  assert.deepEqual(sideReportNotice(scopedKamc), { title: STR.review.scope.active, text: STR.review.scope.sideReport });
  const scopedSgh = { hospital: 'sgh', scope: normalizeScope({ labs: ['Company TEMKIN SAHA Medical'] }) };
  assert.deepEqual(sideReportNotice(scopedSgh), {
    title: `${STR.generate.reportType('SGH')} · ${STR.review.scope.active}`, text: STR.review.hospital.sideReport,
  });
});

test('history panel: SHOWN for the main report on KAMC\'s rows with a KAMC-only note; hidden for SGH; KAMC as always', () => {
  // Review round 2026-10-11: the default (main) report writes the published KAMC series,
  // so it keeps the panel — charting KAMC's rows, never the summed figures — and is never
  // told the published numbers have nothing to do with it.
  const rows = [...kamcRows(), ...sghRows()];
  const st = (h) => loadedState(rows, { reportHospital: h });
  const built = (h) => modelFor(st(h), memStore(), compute, quiet);
  const HS = STR.review.hospital;

  const both = historyPanelPlan(built('both'), st('both'), 'both');
  assert.equal(both.hidden, null, 'the main report shows the panel');
  assert.equal(both.note, HS.historyKamcSeries);
  assert.ok(Array.isArray(both.rows) && both.rows.length === kamcRows().length);
  assert.ok(both.rows.every((r) => hospitalOf(r) === 'kamc'), 'KAMC rows only — never SGH\'s');
  assert.ok(HS.historyKamcSeries.includes('KAMC') && HS.historyKamcSeries.includes('سجل التقارير'), HS.historyKamcSeries);
  assert.ok(!HS.historyKamcSeries.includes('لا تظهر'), 'never says the numbers do not belong to this report');

  const kamcState = st('kamc');
  const kamc = historyPanelPlan(built('kamc'), kamcState, 'kamc');
  assert.equal(kamc.hidden, null);
  assert.equal(kamc.note, null, 'the KAMC report needs no note');
  assert.deepEqual(kamc.rows.map((r) => r.orderId), both.rows.map((r) => r.orderId), 'the same KAMC series as the main report');

  assert.deepEqual(historyPanelPlan(built('sgh'), st('sgh'), 'sgh'), { hidden: HS.historyHidden, note: null, rows: null });
  const scoped = { hospital: 'kamc', scope: normalizeScope({ labs: ['Lab Alpha'] }) };
  assert.equal(historyPanelPlan(scoped, kamcState, 'kamc').hidden, STR.review.scope.historyHidden);
});

/* ------------------------------------------------------------------ *
 * 4. Published history
 * ------------------------------------------------------------------ */

/** recordRunSnapshot with the REAL writers into a fresh store; what it persisted. */
function record(model, settings = SETTINGS()) {
  const store = memStore(settings);
  const shown = [];
  recordRunSnapshot({
    model, store, state: {}, date: model.reportDate,
    recordSnapshot,
    recordShownTasks: (log, args) => { shown.push(args); return recordShownTasks(log, args); },
  });
  const doc = store.loadSettings();
  return { store, doc, shown, snapshots: store.snapshots };
}

test('history PROOF: a main report for D records exactly the numbers a KAMC report for D records', () => {
  const rows = [...kamcRows(), ...sghRows(), ...thirdRows()];
  for (const date of ['2026-10-08', '2026-10-06', '2026-09-03']) {
    const build = (h) => modelFor(loadedState(rows, { reportHospital: h, reportDate: date }), memStore(), compute, quiet);
    const kamc = build('kamc');
    const both = build('both');
    assert.equal(both.reportDate, kamc.reportDate, date);
    // Same engine output underneath: KAMC's sub-model IS the KAMC report's build. (The
    // week chips differ only because buildBothModel stamps its sub-models at build time
    // while the review stamps a KAMC model at render — chips are never recorded.)
    const noChips = ({ deltas, ...kpi }) => kpi;
    assert.deepEqual(noChips(both.kamc.kpi), noChips(kamc.kpi), `${date}: same KAMC engine output`);
    const k = record(kamc);
    const b = record(both);
    assert.equal(b.snapshots.length, 1, `${date}: the main report records`);
    assert.deepEqual(b.snapshots, k.snapshots, `${date}: same snapshot {asOf, numbers}`);
    assert.deepEqual(b.doc.snapshotHistory, k.doc.snapshotHistory, `${date}: same snapshotHistory entry`);
    assert.deepEqual(Object.keys(b.doc.snapshotHistory), [date]);
    // And they are KAMC's numbers — SGH's 3 lines never reach the published series.
    assert.equal(b.snapshots[0].numbers.total, kamc.kpi.totals.total);
    assert.notEqual(b.snapshots[0].numbers.total, both.combined.cards.total.combined);
  }
});

// UPDATED 2026-10-13 (tracker CONTRACT §1.4): was "the main report never touches the task
// log; KAMC still writes it". The closed-task log is retired, so NO report type writes it —
// not even when a legacy caller still hands recordShownTasks — and an existing log survives
// byte for byte. The numbers rules are unchanged.
test('history: NO report type touches the task log; KAMC + main record numbers; SGH writes nothing', () => {
  const rows = [...kamcRows(), ...sghRows()];
  const build = (h) => modelFor(loadedState(rows, { reportHospital: h }), memStore(), compute, quiet);
  const log = { 'ext|x': { openOn: '2026-10-01', closedOn: '2026-10-01' } };

  const kamc = build('kamc');
  const k = record(kamc);
  assert.deepEqual(k.shown, [], 'KAMC: recordShownTasks never called');
  assert.equal(k.doc.taskLog, undefined, 'KAMC: taskLog untouched');
  assert.equal(k.snapshots.length, 1, 'KAMC: the numbers ARE recorded');
  assert.deepEqual(record(kamc, { ...SETTINGS(), taskLog: log }).doc.taskLog, log, 'KAMC: an existing log survives');

  const both = build('both');
  const b = record(both);
  assert.deepEqual(b.shown, [], 'main report: recordShownTasks never called');
  assert.equal(b.doc.taskLog, undefined, 'main report: taskLog untouched');
  assert.equal(b.snapshots.length, 1, '…while the numbers ARE recorded');
  assert.deepEqual(record(both, { ...SETTINGS(), taskLog: log }).doc.taskLog, log, 'main: an existing log survives');

  const s = record(build('sgh'));
  assert.deepEqual(s.snapshots, [], 'SGH: no snapshot');
  assert.deepEqual(s.shown, [], 'SGH: no task log');
  assert.equal(s.doc.snapshotHistory, undefined, 'SGH: no history');
});

test('history: a main report with NO KAMC lines in the load records nothing (no KAMC report exists for D)', () => {
  const m = modelFor(loadedState(sghRows()), memStore(), compute, quiet);
  assert.equal(m.hospital, 'both');
  const r = record(m);
  assert.deepEqual(r.snapshots, []);
  assert.equal(r.doc.snapshotHistory, undefined);
  assert.deepEqual(r.shown, []);
});

test('history: a main report is recorded only unscoped — a scope on it or on its KAMC sub-model writes nothing', () => {
  const both = modelFor(loadedState([...kamcRows(), ...sghRows()]), memStore(), compute, quiet);
  assert.deepEqual(record({ ...both, scope: normalizeScope({ labs: ['Lab Alpha'] }) }).snapshots, []);
  const subScoped = { ...both, kamc: { ...both.kamc, scope: normalizeScope({ labs: ['Lab Alpha'] }) } };
  assert.deepEqual(record(subScoped).snapshots, []);
  assert.equal(isMainReport(both), true);
  for (const m of [null, {}, { hospital: 'kamc' }, { hospital: 'sgh' }, { hospital: 'BOTH' }]) {
    assert.equal(isMainReport(m), false, JSON.stringify(m));
  }
});

/* ------------------------------------------------------------------ *
 * 5. The automation publishes the main report
 * ------------------------------------------------------------------ */

/** A runAutomation over a pulled load with the REAL engine / report model / main-report
 *  builder; only the I/O seams are faked. */
async function automate(pulled, { options = {}, deps = {}, settings = SETTINGS() } = {}) {
  const seen = { produced: null, labs: null, tat: null };
  // A real session: the uploaded tracker is ALSO the persisted document (upload and every
  // edit write both) — and the automation publishes the persisted one (tracker CONTRACT
  // §1.8; UPDATED 2026-10-13 review R-2: state.parsed.tracker is no longer read by the run).
  const store = memStore({
    cachedTracker: { model: TRACKER(), updatedAt: '2026-10-07T06:00:00.000Z' },
    ...settings,
    grafana: { enabled: true, baseUrl: 'https://grafana.test', accessToken: 'tok', dataKey: '' },
  });
  store.setTat = () => {};
  const state = {
    files: { csv: null, tracker: null },
    parsed: { orders: null, tracker: TRACKER(), summary: null, excludedHospitals: [] },
    reportModel: null, edits: {}, reportDate: DATE,
  };
  const res = await runAutomation({
    store,
    state,
    options: { ...AUTOMATION_DEFAULTS, enabled: true, autoPull: true, autoGenerate: true, autoLabFiles: true, ...options },
    deps: {
      loadGrafana: async () => ({ yearStartMs: () => 0, fetchKamcOrders: async () => ({ rows: pulled, errors: [] }) }),
      loadSendoutMaster: async () => null,
      loadTaskLifecycle: async () => ({ recordShownTasks: (log, args) => { seen.shownTasks = args; return recordShownTasks(log, args); } }),
      loadLateLabs: async () => ({ buildLateLabWorkbooks: ({ rows }) => { seen.labs = rows; return []; } }),
      loadTatSuggest: async () => ({ suggestTats: ({ rows, unmatched }) => { seen.tat = rows; seen.unmatched = unmatched; return []; } }),
      loadTatLoinc: async () => null,
      loadDownload: async () => null,
      // The very call produceReportFiles makes for its names (scope + type off the model).
      produceReportFiles: async ({ model }) => {
        seen.produced = model;
        return buildFileDefs(model.reportDate, model.scope, model.hospital).map((def) => ({ def, blob: { size: 1 } }));
      },
      now: () => Date.parse('2026-10-08T08:00:00Z'),
      ...deps,
    },
  });
  return { res, seen, state, store };
}

test('automation: the deck is the combined report — the real buildBothModel over the load — under the historic names', async () => {
  const kRows = kamcRows();
  const sRows = sghRows();
  // An EMPTY TAT table, so both hospitals' test names are unmatched and the auto-accept
  // step really runs — it must be offered KAMC's only.
  const settings = { ...SETTINGS(), tatLookup: {} };
  const { res, seen, state } = await automate([...kRows, ...sRows, ...thirdRows()], { settings, options: { autoAcceptTat: true } });
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.deepEqual(res.files.map((f) => f.name), HISTORIC);
  const m = seen.produced;
  assert.equal(m.hospital, 'both');
  assert.equal(state.reportModel, m);
  assert.deepEqual(m.projectTracker, state.parsed.tracker, 'the deck\'s model carries the session\'s (persisted) project tracker');
  // Byte-for-byte the main report the review would build from the same load and date.
  const direct = hospitalReport.buildBothModel({
    kamcRows: state.parsed.orders, sghRows: state.parsed.ordersByHospital.sgh, settings,
    reportDate: DATE, tracker: state.parsed.tracker, sendoutMaster: null, edits: {}, mode: 'week',
  });
  assert.deepEqual(m.combined, direct.combined);
  assert.deepEqual(m.kamc.kpi, direct.kamc.kpi);
  assert.deepEqual(m.sgh.kpi, direct.sgh.kpi);
  const review = modelFor(loadedState([...kRows, ...sRows]), memStore(settings), compute, quiet);
  assert.deepEqual(m.combined, review.combined, 'the same combined numbers as the review screen\'s main report');
  // KAMC-only everything else: TAT suggestions and lab files never see an SGH row.
  for (const k of ['tat', 'labs']) {
    assert.ok(Array.isArray(seen[k]) && seen[k].length === 5, k);
    assert.ok(seen[k].every((r) => hospitalOf(r) === 'kamc'), `${k}: KAMC rows only`);
  }
  assert.deepEqual(seen.unmatched, ['Assay K'], 'no SGH test name (Assay S) is ever offered a TAT');
  assert.equal(state.engineOutput.totals.total, 5, 'the hero engine output stays KAMC\'s');
});

test('automation: history = the KAMC numbers a KAMC report records for the date; no task log', async () => {
  const kRows = kamcRows();
  const { seen, store } = await automate([...kRows, ...sghRows()]);
  const kamcReport = modelFor(loadedState(kRows, { reportHospital: 'kamc' }), memStore(), compute, quiet);
  const k = record(kamcReport);
  assert.deepEqual(store.snapshots, k.snapshots, 'same snapshot {asOf, numbers}');
  assert.equal(seen.shownTasks, undefined, 'the main report never records shown tasks');
  assert.equal(store.loadSettings().taskLog, undefined);
});

test('automation: a load with NO SGH rows still publishes the main report (historic names, SGH 0)', async () => {
  const { res, seen } = await automate(kamcRows());
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.equal(seen.produced.hospital, 'both');
  assert.equal(seen.produced.combined.cards.total.sgh, 0);
  assert.deepEqual(res.files.map((f) => f.name), HISTORIC);
  const pull = res.steps.find((s) => s.id === 'pull');
  assert.ok(!pull.message.includes('SGH'), pull.message);
});

test('automation: no main-report builder → engine error, NO deck (never another report as the weekly one); labs still run', async () => {
  const { res, seen, store } = await automate([...kamcRows(), ...sghRows()], {
    deps: { loadHospitalReport: async () => { throw new Error('missing module'); } },
  });
  const status = (id) => res.steps.find((s) => s.id === id).status;
  assert.equal(status('engine'), 'error');
  assert.equal(status('generate'), 'skip');
  assert.equal(seen.produced, null);
  assert.deepEqual(res.files, []);
  assert.deepEqual(store.snapshots, [], 'nothing recorded');
  assert.equal(status('labs'), 'done', 'the KAMC lab files do not depend on the deck');
});
