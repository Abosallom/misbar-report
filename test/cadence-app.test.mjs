// test/cadence-app.test.mjs — «دورية التقرير» (weekly / daily) and the tracker status history,
// the APP side (2026-10-18, CONTRACT A + C). Run: node --test
//
// The deck builders' own cadence rules (cover title, the weekly-only «المهام المكتملة خلال
// الأسبوع» unit; and, in either cadence, no Completed task on the task slides — 2026-10-18)
// are pinned in the slides' tests. This file pins that the
// APP carries the option and the history to them, end to end:
//   • ONE enum (contracts.js re-exports model/slide-order.js's), the seed agrees;
//   • the store backfills / validates / imports / exports reportOptions.cadence;
//   • the review pills, Settings' radio and the share text read it; the weekly-only chip and
//     order row say so in a daily report;
//   • every model that carries projectTracker carries trackerStatusLog (review, generate
//     fallback, buildReportModel, buildBothModel, the automation run);
//   • a review model → buildSpec: daily = «اليومي» + no completed-this-week slide, weekly = both.
// SYNTHETIC data only (made-up WBS ids, task texts, labs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SETTINGS_KEY, CADENCES, DEFAULT_CADENCE, canonicalCadence, normalizeCadence, isDailyCadence,
} from '../src/contracts.js';
import { REPORT_CADENCES, DEFAULT_REPORT_CADENCE, reportCadence, SLIDE_ORDER_KEYS } from '../src/model/slide-order.js';
import { REPORT_OPTIONS_SEED } from '../src/seeds/defaults.js';
import * as store from '../src/store.js';
import {
  modelFor, reportOptionsFromSettings, mergeReportOptions, slideUnitHidden, slideOrderRows,
  slideTogglesFor, CADENCE_PILLS, sessionStatusLog,
} from '../src/ui/screen-review.js';
import { CADENCE_OPTIONS } from '../src/ui/screen-settings.js';
import { fallbackModel, shareText } from '../src/ui/screen-generate.js';
import { buildReportModel, trackerStatusLogOf, projectedStatusLog } from '../src/model/report-model.js';
import * as hospitalReport from '../src/model/hospital-report.js';
import { runAutomation, AUTOMATION_DEFAULTS } from '../src/automation/pipeline.js';
import { buildSpec } from '../src/slidespec/build-spec.js';
import { compute } from '../src/engine/engine.js';
import { takeOrders } from '../src/model/hospital.js';
import { TRACKER_FORMAT, TASK_FIELDS } from '../src/ingest/task-tracker.js';
import { STR } from '../src/i18n/ar.js';

// ---- fixtures -----------------------------------------------------------------------------

const REPORT_DATE = '2026-10-15'; // a Thursday — its week opens Friday 2026-10-09
const task = (wbs, extra = {}) => {
  const t = {};
  for (const f of TASK_FIELDS) t[f] = '';
  return {
    ...t, id: wbs, wbs, track: 'Track Q', milestone: 'Stage Q', task: `Synthetic task ${wbs}`,
    owner: 'Person Q', priority: 'High', status: 'In Progress', due: '2026-12-01', ...extra,
  };
};
/** 4.1 in progress; 4.2 became Completed on 2026-10-12 (it was Late); 4.3 was always done. */
const trackerDoc = () => ({
  format: TRACKER_FORMAT, fileName: 'synthetic.xlsx', loadedAt: '2026-10-12T12:00:00.000Z', editedAt: null, warnings: [],
  tasks: [
    task('4.1'),
    task('4.2', { status: 'Completed', task: 'Synthetic finished-this-week task' }),
    task('4.3', { status: 'Completed', task: 'Synthetic long-done task' }),
  ],
});
const LOG = Object.freeze({
  v: 1,
  tasks: {
    '4.1': [{ at: '2026-10-01', status: 'inProgress' }],
    '4.2': [{ at: '2026-10-01', status: 'late' }, { at: '2026-10-12', status: 'completed' }],
    '4.3': [{ at: '2026-10-01', status: 'completed' }],
  },
});

const KAMC = { orderingFacilityId: '31763', hospital: 'King Abdul ah Medical City' };
let seq = 0;
const row = (testName, od) => {
  seq += 1;
  return {
    orderDate: `${od} 00:00:00`, facility: 'Lab Alpha', orderId: `6${String(seq).padStart(5, '0')}`, lineNo: seq,
    loinc: null, testName, collected: null, dispatched: null, received: null, resulted: null,
    rawStatus: 'Order Created', tatDaysCsv: null, specimenNo: null, shipmentId: null, performingFacilityId: null, ...KAMC,
  };
};
function reviewState(tracker, reportHospital = 'kamc') {
  const parsed = { orders: null, tracker, summary: null, excludedHospitals: [] };
  takeOrders(parsed, [row('Assay K', '2026-10-05'), row('Assay K', '2026-10-08')]);
  return { parsed, files: { tracker: null }, reportDate: REPORT_DATE, reportModel: null, engineOutput: null, edits: {}, reportHospital };
}
const settingsWith = (ro = {}, extra = {}) => ({
  tatLookup: { 'Assay K': 2 }, historicalConstants: { cancelledByMonth: {} },
  reportOptions: { deltaMode: 'week', ...ro }, trackerStatusLog: LOG, ...extra,
});

function makeMock() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k), clear: () => map.clear() };
}
function fresh() {
  globalThis.localStorage = makeMock();
  store.__resetForTests();
  return globalThis.localStorage;
}

// ---- the enum -----------------------------------------------------------------------------

test('one enum: contracts.js re-exports the slide-order leaf\'s; the seed and both readers agree', () => {
  // (deepEqual, not equal: the app imports the leaf with its ?v= stamp, a separate module
  // instance from this test's plain import — the same source, so the same values.)
  assert.deepEqual(CADENCES, REPORT_CADENCES, 'the slide-order leaf\'s list');
  assert.ok(Object.isFrozen(CADENCES));
  assert.deepEqual(CADENCES, ['weekly', 'daily']);
  assert.equal(DEFAULT_CADENCE, DEFAULT_REPORT_CADENCE);
  assert.equal(REPORT_OPTIONS_SEED.cadence, DEFAULT_CADENCE, 'first-run copy = the default');
  assert.equal(REPORT_OPTIONS_SEED.slides.trackerCompleted, true, 'the completed-this-week slide ships ON');
  for (const v of ['daily', ' Daily ', 'DAILY', 'weekly', 'Weekly', undefined, null, '', 'monthly', 7]) {
    assert.equal(normalizeCadence(v), reportCadence(v), `normalizeCadence(${JSON.stringify(v)}) = the decks' reading`);
  }
  assert.equal(canonicalCadence(' Daily '), 'daily');
  assert.equal(canonicalCadence('monthly'), null, 'strict: an import rejects it');
  assert.equal(canonicalCadence(undefined), null);
  assert.equal(isDailyCadence('daily'), true);
  assert.equal(isDailyCadence(undefined), false);
});

// ---- the store ----------------------------------------------------------------------------

test('store: a fresh install is weekly; a stored doc without the key is backfilled weekly; a junk value too', () => {
  fresh();
  assert.equal(store.loadSettings().reportOptions.cadence, 'weekly');
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: { deltaMode: 'week' } }));
  assert.equal(store.loadSettings().reportOptions.cadence, 'weekly');
  mock.setItem(SETTINGS_KEY, JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: { cadence: 'fortnightly' } }));
  assert.equal(store.loadSettings().reportOptions.cadence, 'weekly');
  mock.setItem(SETTINGS_KEY, JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: { cadence: 'daily' } }));
  assert.equal(store.loadSettings().reportOptions.cadence, 'daily', 'a stored choice is kept');
});

test('store: the choice persists across a reload and an export → import round trip', async () => {
  fresh();
  const doc = store.loadSettings();
  doc.reportOptions.cadence = 'daily';
  store.saveSettings(doc);
  store.__resetForTests();
  assert.equal(store.loadSettings().reportOptions.cadence, 'daily');
  const backup = await store.exportSettings().blob.text();
  assert.equal(JSON.parse(backup).reportOptions.cadence, 'daily');
  fresh();
  store.loadSettings();
  store.importSettings(backup);
  assert.equal(store.loadSettings().reportOptions.cadence, 'daily');
});

test('store import: a cadence must be weekly / daily (case-insensitive); absent keeps this device\'s', () => {
  fresh();
  store.loadSettings();
  const imp = (ro) => store.importSettings(JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: ro }));
  for (const bad of ['monthly', 3, null, ['daily'], '']) {
    assert.throws(() => imp({ cadence: bad }), /reportOptions\.cadence غير صالح/, JSON.stringify(bad));
  }
  imp({ cadence: ' DAILY ' });
  assert.equal(store.loadSettings().reportOptions.cadence, 'daily', 'canonicalised');
  imp({ deltaMode: 'week' }); // an old backup without the key
  assert.equal(store.loadSettings().reportOptions.cadence, 'daily', 'this device\'s choice stays');
});

// ---- the review / Settings / generate surfaces -------------------------------------------

test('review: reportOptionsFromSettings and the chip / pill merge carry the cadence (absent → weekly)', () => {
  assert.equal(reportOptionsFromSettings({}).cadence, 'weekly');
  assert.equal(reportOptionsFromSettings({ reportOptions: { cadence: 'daily' } }).cadence, 'daily');
  assert.equal(reportOptionsFromSettings({ reportOptions: { cadence: 'junk' } }).cadence, 'weekly');
  const merged = mergeReportOptions({ deltaMode: 'week', cadence: 'weekly' }, { ...reportOptionsFromSettings({}), cadence: 'daily' });
  assert.equal(merged.cadence, 'daily', 'a pill click persists through persistReportOptions\' merge');
  assert.equal(merged.deltaMode, 'week', 'independent of the activity window');
});

test('review pills and Settings radio: one list, CADENCES order, the same Arabic words', () => {
  assert.deepEqual(CADENCE_PILLS.map((p) => p.value), [...CADENCES]);
  assert.deepEqual(CADENCE_PILLS.map((p) => p.label), ['أسبوعي', 'يومي']);
  assert.deepEqual(CADENCE_OPTIONS.map((o) => o.value), [...CADENCES]);
  CADENCE_OPTIONS.forEach((o, i) => assert.ok(o.label.startsWith(CADENCE_PILLS[i].label), o.label));
  assert.equal(STR.review.cadence.title, 'دورية التقرير');
  assert.equal(STR.review.cadence.weeklyOnly, 'أسبوعي فقط');
});

test('review: the weekly-only chip / order row — hidden in a daily deck, its own switch in a weekly one', () => {
  for (const hospital of ['kamc', 'sgh', 'both']) {
    assert.ok(slideTogglesFor(hospital).some((c) => c.key === 'trackerCompleted' && c.weeklyOnly), hospital);
    assert.equal(slideUnitHidden('trackerCompleted', { hospital, slides: {}, cadence: 'daily' }), true, `${hospital} daily`);
    assert.equal(slideUnitHidden('trackerCompleted', { hospital, slides: {}, cadence: 'weekly' }), false, `${hospital} weekly`);
    assert.equal(slideUnitHidden('trackerCompleted', { hospital, slides: {} }), false, `${hospital}: absent = weekly`);
    assert.equal(slideUnitHidden('trackerCompleted', { hospital, slides: { trackerCompleted: false }, cadence: 'weekly' }), true, `${hospital}: switched off`);
    assert.equal(slideUnitHidden('tracker', { hospital, slides: {}, cadence: 'daily' }), false, `${hospital}: the task slides stay in daily`);
  }
  const rows = slideOrderRows({ hospital: 'kamc', slides: {}, order: SLIDE_ORDER_KEYS, cadence: 'daily' });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.trackerCompleted.hidden, true, 'the row keeps its place, marked «مخفية»');
  assert.equal(by.trackerCompleted.label, 'المهام المكتملة خلال الأسبوع');
  assert.equal(by.tracker.label, 'متابعة المهام');
});

test('share text: the heading names the cadence the cover names', () => {
  const m = (cadence) => ({ hospital: 'kamc', kpi: { totals: { total: 10 }, buckets: { completed: 5 } }, reportOptions: cadence ? { cadence } : {}, overrides: {} });
  assert.match(shareText(m(), REPORT_DATE, 4).split('\n')[0], /^تقرير مسبار الأسبوعي — /);
  assert.match(shareText(m('weekly'), REPORT_DATE, 4).split('\n')[0], /^تقرير مسبار الأسبوعي — /);
  assert.match(shareText(m('daily'), REPORT_DATE, 4).split('\n')[0], /^تقرير مسبار اليومي — /);
  assert.match(shareText({ ...m('daily'), reportOptions: undefined }, REPORT_DATE, 4), /^تقرير مسبار الأسبوعي/, 'no options → weekly');
});

// ---- every model carries the history ------------------------------------------------------

const ENGINE_STUB = Object.freeze({ totals: { total: 0 }, funnel: {}, buckets: {} });

test('models: buildReportModel / buildBothModel / the generate fallback carry trackerStatusLog beside projectTracker', () => {
  const settings = settingsWith({ cadence: 'daily' });
  const t = trackerDoc();
  const rm = buildReportModel({ engineOutput: ENGINE_STUB, tracker: t, settings, reportDate: REPORT_DATE, orders: [] });
  assert.equal(rm.projectTracker, t);
  assert.equal(rm.trackerStatusLog, LOG, 'the stored history');
  const ed = buildReportModel({ engineOutput: ENGINE_STUB, tracker: t, settings, reportDate: REPORT_DATE, orders: [], edits: { trackerStatusLog: null } });
  assert.equal(ed.trackerStatusLog, null, 'an edit bundle may override it');
  const both = hospitalReport.buildBothModel({ kamcRows: [], sghRows: [], settings, reportDate: REPORT_DATE, tracker: t });
  assert.equal(both.trackerStatusLog, LOG);
  assert.equal(both.reportOptions.cadence, 'daily');
  const fb = fallbackModel({ parsed: { tracker: t }, reportDate: REPORT_DATE }, { settings });
  assert.equal(fb.trackerStatusLog, LOG);
  assert.equal(fb.reportOptions.cadence, 'daily');
  assert.equal(trackerStatusLogOf({}), null, 'no history yet → null');
  assert.equal(trackerStatusLogOf({ trackerStatusLog: 'junk' }), null);
});

test('review session history: the stored one with the document\'s CURRENT statuses projected', () => {
  const t = trackerDoc();
  t.tasks[0].status = 'Completed'; // marked done in the editor a moment ago, not saved yet
  const log = sessionStatusLog({ settings: settingsWith() }, t, '2026-10-14');
  assert.deepEqual(log.tasks['4.1'], [{ at: '2026-10-01', status: 'inProgress' }, { at: '2026-10-14', status: 'completed' }]);
  assert.deepEqual(log.tasks['4.2'], LOG.tasks['4.2'], 'unchanged tasks: no entry');
  assert.equal(settingsWith().trackerStatusLog.tasks['4.1'].length, 1, 'the stored history is not mutated');
  assert.equal(sessionStatusLog({ settings: settingsWith() }, null), null, 'no document → no history');
  // No stored history yet: the projection starts one (first seen → never "completed this week").
  const first = projectedStatusLog({}, trackerDoc(), '2026-10-14');
  assert.deepEqual(Object.keys(first.tasks), ['4.1', '4.2', '4.3']);
  assert.equal(projectedStatusLog({ trackerStatusLog: LOG }, trackerDoc(), 'not a date'), LOG, 'no usable date → the stored one');
});

test('automation: the run\'s model carries the STORED history and the SAVED cadence', async () => {
  const t = trackerDoc();
  const handed = [];
  const settings = {
    grafana: { enabled: true, baseUrl: 'https://grafana.test', accessToken: 'tok', panelId: 1, dataKey: '' },
    tatLookup: {},
    reportOptions: { slides: {}, kpiCards: {}, labels: {}, deltaMode: 'week', cadence: 'daily' },
    cachedTracker: { model: t, updatedAt: '2026-10-12T12:00:00.000Z' },
    trackerStatusLog: LOG,
  };
  const st = {
    settings, docs: [], snapshots: [],
    updateSnapshot(s) { this.snapshots.push(s); }, loadSettings() { return { snapshotHistory: {} }; },
    saveSettings(doc) { this.docs.push(doc); }, setTat() {},
  };
  const ROWS = [{ orderId: '1', testName: 'TEST A', facility: 'Lab A' }];
  const res = await runAutomation({
    store: st,
    state: { files: { csv: null, tracker: null }, parsed: { orders: null, tracker: null, summary: null }, engineOutput: null, reportModel: null, edits: {}, reportDate: REPORT_DATE, settings: null },
    options: { ...AUTOMATION_DEFAULTS, enabled: true, autoPull: true, autoGenerate: true },
    deps: {
      loadGrafana: async () => ({
        yearStartMs: () => 0,
        fetchKamcOrders: async () => ({ rows: ROWS, errors: [] }),
        fetchKamcSnapshot: async () => ({ rows: ROWS, errors: [], fetchedAt: '2026-10-15T05:00:00.000Z' }),
      }),
      loadEngine: async () => ({ compute: () => ({ totals: { total: 1 }, funnel: {}, buckets: { completed: 1 } }) }),
      // The REAL model builders: their trackerStatusLog answer is what the run must keep.
      loadReportModel: async () => ({ buildReportModel }),
      loadHospitalReport: async () => ({
        buildBothModel: ({ reportDate }) => ({
          hospital: 'both', reportDate, kamc: { hospital: 'kamc', reportDate, kpi: { totals: { total: 1 }, funnel: {}, buckets: {} } },
          sgh: { hospital: 'sgh', reportDate, kpi: { totals: { total: 0 }, funnel: {}, buckets: {} } }, combined: {}, deltaWindow: null,
        }),
        stampBothDeltas: () => null,
      }),
      loadDeltaBaseline: async () => null,
      loadTatSuggest: async () => null,
      loadTatLoinc: async () => null,
      loadDownload: async () => null,
      produceReportFiles: async ({ model }) => { handed.push(model); return [{ def: { name: 'report.pptx' }, blob: { size: 2 } }]; },
      now: () => 1770000000000,
    },
  });
  assert.equal((res.steps.find((s) => s.id === 'generate') || {}).status, 'done');
  assert.equal(handed.length, 1);
  assert.equal(handed[0].trackerStatusLog, LOG, 'the stored history');
  assert.equal(handed[0].reportOptions.cadence, 'daily', 'the cadence the user last saved');
  assert.ok(handed[0].projectTracker && handed[0].projectTracker.tasks.length === 3);
});

// ---- end to end: review model → deck ------------------------------------------------------

/** What the review's render() does: modelFor, re-source reportOptions + the session history. */
function reviewModel(settings, hospital = 'kamc') {
  const t = trackerDoc();
  const state = reviewState(t, hospital);
  const m = modelFor(state, { settings }, compute, { hospitalReport, notify: () => {} });
  m.reportOptions = reportOptionsFromSettings(settings);
  m.trackerStatusLog = sessionStatusLog({ settings }, m.projectTracker, '2026-10-12');
  return m;
}
const deckText = (spec) => JSON.stringify(spec);

for (const hospital of ['kamc', 'both']) {
  test(`deck (${hospital}): weekly = «الأسبوعي» + the completed-this-week slide; daily = «اليومي», no such slide, no Completed task`, () => {
    for (const variant of ['internal', 'nupco']) {
      const weekly = buildSpec(reviewModel(settingsWith({ cadence: 'weekly' }), hospital), { variant });
      const wIds = weekly.map((s) => s.id);
      assert.ok(deckText(weekly[0]).includes('تقرير مسبار الأسبوعي'), `${variant}: weekly cover`);
      assert.ok(wIds.includes('trackerCompleted'), `${variant}: weekly has the completed-this-week slide`);
      const done = weekly.filter((s) => s.id.startsWith('trackerCompleted'));
      assert.ok(deckText(done).includes('Synthetic finished-this-week task'), 'the task that became Completed this week');
      assert.ok(!deckText(done).includes('Synthetic long-done task'), 'a task already done when first seen is not "this week"');

      const daily = buildSpec(reviewModel(settingsWith({ cadence: 'daily' }), hospital), { variant });
      const dIds = daily.map((s) => s.id);
      assert.ok(deckText(daily[0]).includes('تقرير مسبار اليومي'), `${variant}: daily cover`);
      assert.ok(!deckText(daily[0]).includes('الأسبوعي'), `${variant}: no weekly word on the daily cover`);
      assert.ok(!dIds.some((id) => id.startsWith('trackerCompleted')), `${variant}: no completed-this-week slide in daily`);
      const tasks = daily.filter((s) => s.id === 'tracker' || s.id.startsWith('tracker-cont'));
      assert.ok(tasks.length, 'the task slides are there');
      assert.ok(deckText(tasks).includes('Synthetic task 4.1'), 'a non-completed task is shown');
      assert.ok(!deckText(tasks).includes('Synthetic finished-this-week task') && !deckText(tasks).includes('Synthetic long-done task'),
        'no Completed task at all in daily');
      // Switching the weekly-only slide off removes it from the weekly deck only.
      const off = buildSpec(reviewModel(settingsWith({ cadence: 'weekly', slides: { trackerCompleted: false } }), hospital), { variant });
      assert.ok(!off.some((s) => s.id.startsWith('trackerCompleted')));
      assert.ok(off.some((s) => s.id === 'tracker'), 'the task slides are a separate unit');
    }
  });
}
