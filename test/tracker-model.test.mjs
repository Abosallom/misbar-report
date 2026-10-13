// test/tracker-model.test.mjs — run with:  node --test
// THE PROJECT TRACKER on every report model (tracker CONTRACT §1.4, §1.7, §1.8), pinned:
//   1. buildReportModel / buildHospitalModel / buildBothModel carry `projectTracker` — the
//      parsed tracker, else settings.cachedTracker when TAGGED, else null — and no longer
//      produce tasksCurrent / tasksInternal; a review edit (edits.projectTracker) wins;
//      challenges / risks / support lines are manual content (empty unless edited);
//   2. the generate screen's fallback model carries the real tracker or null — never the
//      mock (buildMockTracker once leaked fake tasks into real decks this way);
//   3. the AUTOMATION's main deck (real engine, real models, real deck builders) carries
//      the tracker slides with the `tracker` toggle on, omits them with it off, prints the
//      same slides in both variants, publishes the PERSISTED (cached) tracker only — never
//      state.parsed.tracker, the mock's home — and NOTHING writes settings.taskLog.
// SYNTHETIC data only: made-up WBS ids, tasks, owners and order lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReportModel, isProjectTracker, projectTrackerFor, resolveProjectTracker,
} from '../src/model/report-model.js';
import { TRACKER_FORMAT } from '../src/ingest/task-tracker.js';
import { buildBothModel, buildHospitalModel } from '../src/model/hospital-report.js';
import { AUTOMATION_DEFAULTS, buildFileDefs, runAutomation } from '../src/automation/pipeline.js';
import { buildSpec } from '../src/slidespec/build-spec.js';
import { fallbackModel } from '../src/ui/screen-generate.js';

const DATE = '2026-10-08';

/** A SYNTHETIC tagged ProjectTracker with `n` tasks over two tracks. */
const tracker = (n = 4, over = {}) => ({
  format: TRACKER_FORMAT,
  fileName: 'synthetic-tracker.xlsx',
  loadedAt: '2026-10-07T06:00:00.000Z',
  editedAt: null,
  warnings: [],
  tasks: Array.from({ length: n }, (_, i) => ({
    id: `7.${i + 1}`, wbs: `7.${i + 1}`,
    track: i < n / 2 ? 'Track Alpha' : 'Track Beta', milestone: `Milestone ${i % 2 ? 'B' : 'A'}`,
    workstream: 'Synthetic WS', workPackage: 'Synthetic WP', task: `Synthetic deliverable ${i + 1}`,
    taskType: 'Deliverable', organization: i % 2 ? 'LEAN' : 'NUPCO / LEAN', owner: `Owner ${i + 1}`,
    priority: ['Critical', 'High', 'Medium', 'Low'][i % 4],
    status: ['In Progress', 'Deleyed', 'Completed', 'Blocked'][i % 4],
    due: i === 3 ? 'daily' : `2026-10-${String(10 + i).padStart(2, '0')}`,
    predecessor: '', nextAction: '', definitionOfDone: '', notes: '',
  })),
  ...over,
});
const OLD_TRACKER = () => ({
  tasks: [{ task: 'مهمة قديمة', status: 'مستمر', dueDate: '10-10-2026', category: 'لين', owner: 'x', hidden: false }],
  challenges: [{ title: 'تحدٍ', status: 'مفتوح', solution: 'حل' }],
  risks: [{ title: 'خطر' }],
});
const cached = (model) => ({ model, updatedAt: '2026-10-07T07:00:00.000Z' });

/* ------------------------------------------------------------------ *
 * 1. The models
 * ------------------------------------------------------------------ */

test('isProjectTracker / resolveProjectTracker: tagged only; parsed first, then the cache', () => {
  const t = tracker();
  const c = tracker(2);
  assert.equal(isProjectTracker(t), true);
  for (const bad of [null, undefined, {}, [], 'x', OLD_TRACKER(), { format: TRACKER_FORMAT }, { ...t, format: 'v0' }]) {
    assert.equal(isProjectTracker(bad), false, JSON.stringify(bad));
  }
  assert.equal(resolveProjectTracker(t, { cachedTracker: cached(c) }), t, 'parsed wins');
  assert.equal(resolveProjectTracker(null, { cachedTracker: cached(c) }), c, 'cache fallback');
  assert.equal(resolveProjectTracker(OLD_TRACKER(), { cachedTracker: cached(c) }), c, 'untagged parsed → cache');
  assert.equal(resolveProjectTracker(null, { cachedTracker: cached(OLD_TRACKER()) }), null, 'untagged cache → null');
  assert.equal(resolveProjectTracker(null, { cachedTracker: c }), c, 'a bare tagged cache is tolerated');
  assert.equal(resolveProjectTracker(null, { cachedTracker: null }), null);
  assert.equal(resolveProjectTracker(null, null), null);
  assert.equal(projectTrackerFor(t, {}, { projectTracker: null }), null, 'an explicit null edit wins');
  assert.equal(projectTrackerFor(t, {}, { projectTracker: c }), c, 'an edited tracker wins');
  assert.equal(projectTrackerFor(t, {}, { projectTracker: OLD_TRACKER() }), null, 'an untagged edit is no tracker');
});

test('buildReportModel: carries projectTracker, no tasksCurrent / tasksInternal, manual challenges', () => {
  const t = tracker();
  const m = buildReportModel({ engineOutput: { totals: { total: 0 } }, tracker: t, settings: {}, reportDate: DATE });
  assert.equal(m.projectTracker, t, 'the very document (the review edits it in place)');
  assert.equal('tasksCurrent' in m, false);
  assert.equal('tasksInternal' in m, false);
  assert.deepEqual(m.challenges, []);
  assert.deepEqual(m.risks, []);
  assert.deepEqual(m.panels, { supportRequired: [] }, 'support lines are manual — nothing drafted');

  // Cache fallback, and the OLD shape fed in by a stale caller drafts NOTHING from it.
  const c = tracker(2);
  const fromCache = buildReportModel({ engineOutput: {}, tracker: OLD_TRACKER(), settings: { cachedTracker: cached(c) }, reportDate: DATE });
  assert.equal(fromCache.projectTracker, c);
  assert.deepEqual(fromCache.challenges, [], 'the old file\'s challenges never reach a model');
  assert.deepEqual(fromCache.panels.supportRequired, []);
  assert.equal(buildReportModel({ engineOutput: {}, tracker: null, settings: {}, reportDate: DATE }).projectTracker, null);

  // Review edits: the edited tracker and the manual lists win.
  const edited = tracker(1);
  const e = buildReportModel({
    engineOutput: {}, tracker: t, settings: {}, reportDate: DATE,
    edits: { projectTracker: edited, challenges: [{ title: 'c' }], risks: [{ title: 'r' }], panels: { supportRequired: ['s'] } },
  });
  assert.equal(e.projectTracker, edited);
  assert.deepEqual(e.challenges, [{ title: 'c' }]);
  assert.deepEqual(e.risks, [{ title: 'r' }]);
  assert.deepEqual(e.panels.supportRequired, ['s']);
});

test('buildHospitalModel (KAMC / SGH / scoped) and buildBothModel carry the same projectTracker', () => {
  const c = tracker(3);
  const settings = { tatLookup: {}, cachedTracker: cached(c), reportOptions: {} };
  for (const args of [{ hospital: 'kamc' }, { hospital: 'sgh' }, { hospital: 'kamc', scope: { labs: ['Lab Z'] } }]) {
    const m = buildHospitalModel({ ...args, rows: [], settings, reportDate: DATE, tracker: null });
    assert.equal(m.projectTracker, c, JSON.stringify(args));
    assert.equal('tasksCurrent' in m, false);
  }
  const both = buildBothModel({ kamcRows: [], sghRows: [], settings, reportDate: DATE, tracker: null });
  assert.equal(both.projectTracker, c, 'TOP level — the BOTH deck reads only top-level + combined');
  assert.equal(both.kamc.projectTracker, c);
  assert.equal(both.sgh.projectTracker, c);
  const parsed = tracker(1);
  assert.equal(buildBothModel({ kamcRows: [], sghRows: [], settings, reportDate: DATE, tracker: parsed }).projectTracker, parsed);
  const none = buildBothModel({ kamcRows: [], sghRows: [], settings: { ...settings, cachedTracker: cached(OLD_TRACKER()) }, reportDate: DATE });
  assert.equal(none.projectTracker, null, 'an old-format cache is no tracker');
});

/* ------------------------------------------------------------------ *
 * 2. The generate screen's fallback — the real tracker or nothing, never the mock
 * ------------------------------------------------------------------ */

test('generate fallbackModel: projectTracker = parsed, else cache, else null — no mock, no task lists', () => {
  const c = tracker(2);
  const p = tracker(1);
  const st = (t) => ({ parsed: { tracker: t }, engineOutput: { totals: { total: 0 } }, reportDate: DATE });
  const fm = (state, settings) => fallbackModel(state, { settings });
  assert.equal(fm(st(p), { cachedTracker: cached(c) }).projectTracker, p);
  assert.equal(fm(st(null), { cachedTracker: cached(c) }).projectTracker, c);
  const none = fm(st(null), {});
  assert.equal(none.projectTracker, null, 'no tracker → null (never buildMockTracker)');
  assert.equal('tasksCurrent' in none, false);
  assert.equal('tasksInternal' in none, false);
  assert.deepEqual(none.challenges, []);
  assert.deepEqual(none.risks, []);
  assert.equal(fm(st(OLD_TRACKER()), {}).projectTracker, null, 'an old-format parsed tracker is no tracker');
});

/* ------------------------------------------------------------------ *
 * 3. The automation's main deck
 * ------------------------------------------------------------------ */

const KAMC = { orderingFacilityId: '31763', hospital: 'King Abdul ah Medical City' };
const SGH = { orderingFacilityId: '1037', hospital: 'Saudi German Hospital  Alzahraa Branch' };
let seq = 0;
const row = (h, facility, od, over = {}) => {
  seq += 1;
  const d = (x) => (x ? `${x} 00:00:00` : null);
  return {
    orderDate: d(od), facility, orderId: `8${String(seq).padStart(5, '0')}`, lineNo: seq, loinc: null,
    testName: 'Assay K', collected: d(over.col), dispatched: d(over.dis), received: d(over.rec), resulted: d(over.res),
    rawStatus: over.status || 'Order Created', tatDaysCsv: null, specimenNo: null, shipmentId: null,
    performingFacilityId: null, ...h,
  };
};
const pulled = () => [
  row(KAMC, 'Lab Alpha', '2026-10-04', { col: '2026-10-04', dis: '2026-10-04', rec: '2026-10-05', res: '2026-10-07', status: 'Result Approved' }),
  row(KAMC, 'Lab Beta', '2026-10-06', { col: '2026-10-06', dis: '2026-10-06', status: 'Shipment Dispatched' }),
  row(SGH, 'Company TEMKIN SAHA Medical', '2026-10-05', { col: '2026-10-05', status: 'Specimen Collected' }),
];

/** A settings store that persists like the real one (ui-main-report.test.mjs's memStore). */
function memStore(settings) {
  let doc = { ...settings };
  return {
    get settings() { return doc; },
    snapshots: [],
    updateSnapshot(s) { this.snapshots.push(s); doc = { ...doc, snapshot: s }; },
    loadSettings() { return structuredClone(doc); },
    saveSettings(d) { doc = structuredClone(d); },
    setTat() {},
  };
}

/** runAutomation over a synthetic pull with the REAL engine, models and deck builders;
 *  produceReportFiles is replaced by the very buildSpec call it makes per variant. */
async function automate({ settings = {}, parsedTracker = null } = {}) {
  const seen = { decks: null, model: null, lifecycleLoads: 0, shownTasks: 0 };
  const store = memStore({
    tatLookup: { 'Assay K': 2 },
    historicalConstants: { cancelledByMonth: {} },
    grafana: { enabled: true, baseUrl: 'https://grafana.test', accessToken: 'tok', dataKey: '' },
    ...settings,
  });
  const state = {
    files: { csv: null, tracker: null },
    parsed: { orders: null, tracker: parsedTracker, summary: null, excludedHospitals: [] },
    reportModel: null, edits: {}, reportDate: DATE,
  };
  const res = await runAutomation({
    store,
    state,
    options: { ...AUTOMATION_DEFAULTS, enabled: true, autoPull: true, autoGenerate: true },
    deps: {
      loadGrafana: async () => ({ yearStartMs: () => 0, fetchKamcOrders: async () => ({ rows: pulled(), errors: [] }) }),
      loadSendoutMaster: async () => null,
      // The retired lifecycle seam: a run must not even load it.
      loadTaskLifecycle: async () => {
        seen.lifecycleLoads += 1;
        return { recordShownTasks: (log) => { seen.shownTasks += 1; return log; } };
      },
      loadLateLabs: async () => ({ buildLateLabWorkbooks: () => [] }),
      loadTatSuggest: async () => null,
      loadTatLoinc: async () => null,
      loadDownload: async () => null,
      produceReportFiles: async ({ model }) => {
        seen.model = model;
        seen.decks = { internal: buildSpec(model, { variant: 'internal' }), nupco: buildSpec(model, { variant: 'nupco' }) };
        return buildFileDefs(model.reportDate, model.scope, model.hospital).map((def) => ({ def, blob: { size: 1 } }));
      },
      now: () => Date.parse('2026-10-08T08:00:00Z'),
    },
  });
  return { res, seen, store, state };
}

const ids = (deck) => deck.map((s) => s.id);
const trackerSlides = (deck) => deck.filter((s) => /^tracker(-|$)/.test(s.id));
const LOG = Object.freeze({ 'ext|synthetic': { openOn: '2026-09-01', closedOn: null } });

test('automation main deck: the CACHED tracker\'s slides with the toggle on, in both variants, after compliance', async () => {
  const c = tracker(4);
  const { res, seen, store } = await automate({
    settings: { cachedTracker: cached(c), taskLog: LOG, reportOptions: { slides: { tracker: true } } },
  });
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.equal(seen.model.hospital, 'both');
  assert.equal(seen.model.projectTracker, c, 'the run published the cached (web-edited) tracker');
  for (const variant of ['internal', 'nupco']) {
    const deck = seen.decks[variant];
    const tr = trackerSlides(deck);
    assert.ok(tr.length >= 1, `${variant}: tracker slides present — ${ids(deck).join(',')}`);
    assert.equal(tr[0].id, 'tracker');
    const at = ids(deck).indexOf('tracker');
    assert.ok(at > ids(deck).indexOf('compliance'), `${variant}: after compliance`);
    assert.equal(deck[at + tr.length].id, 'thanks', `${variant}: right before thanks`);
    assert.ok(tr.every((s) => !s.internalOnly), `${variant}: never internal-only`);
  }
  assert.deepEqual(trackerSlides(seen.decks.nupco), trackerSlides(seen.decks.internal), 'identical in both variants');
  // No taskLog write: the seam is never loaded and the stored log survives byte for byte.
  assert.equal(seen.lifecycleLoads, 0);
  assert.equal(seen.shownTasks, 0);
  assert.deepEqual(store.loadSettings().taskLog, LOG);
});

test('automation main deck: absent toggle = ON (default); toggle OFF omits every tracker slide', async () => {
  const c = tracker(4);
  const on = await automate({ settings: { cachedTracker: cached(c), reportOptions: {} } });
  assert.equal(on.res.ok, true, on.res.errors.join('; '));
  assert.ok(trackerSlides(on.seen.decks.internal).length >= 1, 'absent key ⇒ ON');

  const off = await automate({ settings: { cachedTracker: cached(c), reportOptions: { slides: { tracker: false } } } });
  assert.equal(off.res.ok, true, off.res.errors.join('; '));
  assert.equal(off.seen.model.projectTracker, c, 'the model still carries it…');
  for (const variant of ['internal', 'nupco']) {
    assert.deepEqual(trackerSlides(off.seen.decks[variant]), [], `${variant}: …but the deck omits it`);
  }
  // Everything else in the main deck is untouched by the toggle.
  const strip = (deck) => ids(deck).filter((id) => !/^tracker(-|$)/.test(id));
  assert.deepEqual(strip(off.seen.decks.internal), strip(on.seen.decks.internal));
  assert.equal(off.store.loadSettings().taskLog, undefined, 'no taskLog created');
  assert.equal(on.store.loadSettings().taskLog, undefined, 'no taskLog created');
});

test('automation main deck: no tracker / an OLD-format cache ⇒ no tracker slides (never a mock)', async () => {
  for (const settings of [{}, { cachedTracker: cached(OLD_TRACKER()) }, { cachedTracker: null }]) {
    const { res, seen, store } = await automate({ settings });
    assert.equal(res.ok, true, res.errors.join('; '));
    assert.equal(seen.model.projectTracker, null, JSON.stringify(settings));
    assert.deepEqual(trackerSlides(seen.decks.internal), []);
    assert.deepEqual(trackerSlides(seen.decks.nupco), []);
    assert.equal(seen.lifecycleLoads, 0);
    assert.equal(store.loadSettings().taskLog, undefined);
  }
});

test('automation main deck: publishes the PERSISTED tracker only — a parsed (e.g. ?mock=1) one never reaches it', async () => {
  // CONTRACT §1.7/§1.8 (review R-2): in a real session parsed === the cached document, so
  // reading only the cache changes nothing there; in a mock/dev tab state.parsed.tracker
  // is the TAGGED, never-persisted buildMockTracker document, which must not be published.
  const parsed = tracker(2, { fileName: 'mock-task-tracker.xlsx' });
  const c = tracker(5);
  const withCache = await automate({ parsedTracker: parsed, settings: { cachedTracker: cached(c) } });
  assert.equal(withCache.res.ok, true, withCache.res.errors.join('; '));
  assert.equal(withCache.seen.model.projectTracker, c, 'parsed A + cache B ⇒ B');

  const noCache = await automate({ parsedTracker: parsed, settings: {} });
  assert.equal(noCache.res.ok, true, noCache.res.errors.join('; '));
  assert.equal(noCache.seen.model.projectTracker, null, 'parsed only (never persisted) ⇒ no tracker');
  assert.deepEqual(trackerSlides(noCache.seen.decks.internal), []);
  assert.deepEqual(trackerSlides(noCache.seen.decks.nupco), []);
});
