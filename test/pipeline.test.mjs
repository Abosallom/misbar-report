// test/pipeline.test.mjs — pure-logic tests for the automation pipeline core.
// Run with:  node --test
//
// Everything DOM-shaped (the Grafana fetch, the engine, produceReportFiles, the
// late-labs writer, Track 5's .eml builder) is injected through runAutomation's
// own `deps` seam, so this suite is plain node: no jsdom, no vendor bundles, no
// network, and no patient data.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTOMATION_DEFAULTS, AUTOMATION_STEPS, runAutomation, shouldAutoDownloadFiles,
} from '../src/automation/pipeline.js';
// The lifecycle module is pure and tiny — injected through the same deps seam so the
// taskLog cases assert the REAL key/entry shape rather than a re-implementation.
import * as taskLifecycle from '../src/model/task-lifecycle.js';
import { slideOrderOf, normalizeSlideOrder, reportCadence } from '../src/model/slide-order.js';

const { taskKey } = taskLifecycle;

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

// Two synthetic order lines — shape only, no real data.
const ROWS = [
  { orderId: '1', testName: 'TEST A', facility: 'Lab A' },
  { orderId: '2', testName: 'TEST B', facility: 'Lab B' },
];

const ALL_ON = Object.freeze({
  ...AUTOMATION_DEFAULTS,
  enabled: true,
  autoPull: true,
  autoGenerate: true,
  autoLabFiles: true,
  autoEmailDrafts: true,
});

function makeStore(settingsOver = {}) {
  return {
    settings: {
      grafana: { enabled: true, baseUrl: 'https://grafana.test', accessToken: 'tok', panelId: 1, dataKey: '' },
      tatLookup: {},
      ...settingsOver,
    },
    snapshots: [],
    // Docs handed to saveSettings, so a case can assert what the run persisted.
    // The stub deliberately stays minimal (loadSettings returns a doc with NO taskLog
    // key): the lifecycle write must tolerate exactly this shape.
    docs: [],
    updateSnapshot(s) { this.snapshots.push(s); },
    loadSettings() { return { snapshotHistory: {} }; },
    saveSettings(doc) { this.docs.push(doc); },
    setTat() {},
  };
}

function makeState() {
  return {
    files: { csv: null, tracker: null },
    parsed: { orders: null, tracker: null, summary: null },
    engineOutput: null,
    reportModel: null,
    edits: {},
    reportDate: '2026-07-20',
    settings: null,
  };
}

function fakeDeps(over = {}) {
  return {
    loadGrafana: async () => ({
      yearStartMs: () => 0,
      fetchKamcOrders: async () => ({ rows: ROWS, errors: [] }),
      fetchKamcSnapshot: async () => ({ rows: ROWS, errors: [], fetchedAt: '2026-07-20T05:00:00.000Z' }),
    }),
    loadEngine: async () => ({
      compute: () => ({ totals: { total: 2 }, funnel: {}, buckets: { completed: 1 } }),
    }),
    loadReportModel: async () => ({
      buildReportModel: ({ engineOutput, reportDate }) => ({ reportDate, kpi: engineOutput }),
    }),
    loadDeltaBaseline: async () => null,
    // The MAIN report's builder (model/hospital-report.js buildBothModel) — faked like the
    // engine: KAMC's sub-model carries the engine fake's numbers over the KAMC rows it was
    // handed (scopedRows, as the real one), SGH's is empty. stampBothDeltas: a no-op.
    loadHospitalReport: async () => ({
      buildBothModel: ({ kamcRows, sghRows, reportDate }) => ({
        hospital: 'both',
        reportDate,
        kamc: { hospital: 'kamc', reportDate, kpi: { totals: { total: 2 }, funnel: {}, buckets: { completed: 1 } }, scopedRows: kamcRows },
        sgh: { hospital: 'sgh', reportDate, kpi: { totals: { total: 0 }, funnel: {}, buckets: { completed: 0 } }, scopedRows: sghRows },
        combined: {},
        deltaWindow: null,
      }),
      stampBothDeltas: () => null,
    }),
    loadLateLabs: async () => ({
      buildLateLabWorkbooks: () => [{ lab: 'Lab A', fileName: 'Lab A.xlsx', xlsxBytes: new Uint8Array([1, 2]) }],
    }),
    loadTatSuggest: async () => null,
    loadTatLoinc: async () => null,
    loadEmlDraft: async () => ({
      buildLabEmailDraft: ({ lab }) => ({ fileName: `${lab}.eml`, blob: { size: 1 } }),
    }),
    loadDownload: async () => null,
    produceReportFiles: async () => [{ def: { name: 'report.pptx' }, blob: { size: 2 } }],
    now: () => 1770000000000,
    ...over,
  };
}

const run = (opts = {}) => runAutomation({
  store: opts.store || makeStore(),
  state: opts.state || makeState(),
  options: opts.options || ALL_ON,
  deps: opts.deps || fakeDeps(),
  onEvent: opts.onEvent,
  signal: opts.signal,
  cadence: opts.cadence,
});

const statusOf = (res, id) => (res.steps.find((s) => s.id === id) || {}).status;

/* ------------------------------------------------------------------ *
 * Contract surface
 * ------------------------------------------------------------------ */

test('AUTOMATION_DEFAULTS is the frozen contract shape', () => {
  assert.ok(Object.isFrozen(AUTOMATION_DEFAULTS));
  assert.deepEqual(AUTOMATION_DEFAULTS, {
    enabled: false, autoPull: false, autoGenerate: false, autoDownload: false,
    autoLabFiles: false, autoEmailDrafts: false, autoAcceptTat: false, dailyTime: '08:00',
  });
});

test('AUTOMATION_STEPS is the published order', () => {
  assert.deepEqual(AUTOMATION_STEPS, ['pull', 'engine', 'generate', 'labs', 'emails']);
});

/* ------------------------------------------------------------------ *
 * Option gating
 * ------------------------------------------------------------------ */

test('with every option off no step does any work', async () => {
  const deps = fakeDeps({
    loadGrafana: async () => { throw new Error('pull must not run'); },
    produceReportFiles: async () => { throw new Error('generate must not run'); },
    loadLateLabs: async () => { throw new Error('labs must not run'); },
    loadEmlDraft: async () => { throw new Error('emails must not run'); },
  });
  const res = await run({ options: AUTOMATION_DEFAULTS, deps });

  assert.equal(res.ok, true);
  assert.deepEqual(res.steps.map((s) => s.id), AUTOMATION_STEPS);
  assert.deepEqual(res.steps.map((s) => s.status), ['skip', 'skip', 'skip', 'skip', 'skip']);
  assert.deepEqual(res.files, []);
  assert.deepEqual(res.labFiles, []);
  assert.deepEqual(res.drafts, []);
  assert.deepEqual(res.errors, []);
});

test('each false option skips exactly its own step', async () => {
  for (const [option, step] of [
    ['autoPull', 'pull'], ['autoGenerate', 'generate'],
    ['autoLabFiles', 'labs'], ['autoEmailDrafts', 'emails'],
  ]) {
    // Seed the rows a skipped pull would have fetched, so the only thing under
    // test is the gate itself and not the data cascade behind it.
    const state = makeState();
    state.parsed.orders = ROWS;
    const res = await run({ state, options: { ...ALL_ON, [option]: false } });
    assert.equal(statusOf(res, step), 'skip', `${step} should skip when ${option} is false`);
    // Every other gated step still ran (emails needs labs' output, so it only
    // survives when labs itself ran).
    for (const other of ['pull', 'generate', 'labs']) {
      if (other === step) continue;
      assert.equal(statusOf(res, other), 'done', `${other} should still run when only ${option} is off`);
    }
  }
});

test('generate is not a prerequisite for labs or emails', async () => {
  const res = await run({ options: { ...ALL_ON, autoGenerate: false } });
  assert.equal(statusOf(res, 'generate'), 'skip');
  assert.equal(statusOf(res, 'labs'), 'done');
  assert.equal(statusOf(res, 'emails'), 'done');
  assert.equal(res.drafts.length, 1);
  assert.equal(res.ok, true);
});

/* ------------------------------------------------------------------ *
 * Step ordering + results
 * ------------------------------------------------------------------ */

test('a full run walks the steps in order and returns the contract shape', async () => {
  const store = makeStore();
  const state = makeState();
  const events = [];
  let seenModel = null;
  const deps = fakeDeps({
    produceReportFiles: async ({ model, onProgress, host }) => {
      seenModel = model;
      assert.equal(onProgress, null); // headless: no UI to paint
      assert.equal(host, null);
      return [{ def: { name: 'report.pptx' }, blob: { size: 2 } }];
    },
  });
  const res = await run({ store, state, deps, onEvent: (e) => events.push(e) });

  assert.equal(res.ok, true);
  assert.deepEqual(res.steps.map((s) => s.id), AUTOMATION_STEPS);
  assert.deepEqual(res.steps.map((s) => s.status), ['done', 'done', 'done', 'done', 'done']);
  assert.deepEqual(res.files, [{ name: 'report.pptx', blob: { size: 2 } }]);
  assert.deepEqual(res.labFiles, [{ lab: 'Lab A', fileName: 'Lab A.xlsx', bytes: new Uint8Array([1, 2]) }]);
  assert.deepEqual(res.drafts, [{ lab: 'Lab A', fileName: 'Lab A.eml', blob: { size: 1 } }]);
  assert.deepEqual(res.errors, []);

  // The pulled rows reached state, the model was assembled from them, and the
  // successful generate persisted the snapshot through the store. The model is the MAIN
  // report (KAMC + SGH); the snapshot carries its KAMC sub-model's numbers.
  assert.equal(state.parsed.orders, ROWS);
  assert.equal(state.reportModel, seenModel);
  assert.equal(seenModel.hospital, 'both');
  assert.equal(seenModel.reportDate, '2026-07-20');
  assert.deepEqual(store.snapshots.map((s) => s.asOf), ['2026-07-20']);
  assert.equal(store.snapshots[0].numbers.completed, 1);

  // onEvent fired start→done for every step, with monotonic pct.
  assert.deepEqual(events.map((e) => e.step),
    ['pull', 'pull', 'engine', 'engine', 'generate', 'generate', 'labs', 'labs', 'emails', 'emails']);
  assert.deepEqual(events.map((e) => e.status),
    ['start', 'done', 'start', 'done', 'start', 'done', 'start', 'done', 'start', 'done']);
  assert.deepEqual(events.filter((e) => e.status === 'done').map((e) => e.pct), [20, 40, 60, 80, 100]);
});

test('master switch off — every step skips, nothing starts', async () => {
  const events = [];
  // AUTOMATION_DEFAULTS carries enabled:false. Off means off: not even the
  // ungated 'engine' compute may start, or the master switch is a suggestion.
  await run({ options: AUTOMATION_DEFAULTS, deps: fakeDeps(), onEvent: (e) => events.push(e) });
  assert.deepEqual(events.map((e) => `${e.step}:${e.status}`), [
    'pull:skip', 'engine:skip', 'generate:skip', 'labs:skip', 'emails:skip',
  ]);
  assert.equal(events.filter((e) => e.status === 'start').length, 0, 'no step may start');
  for (const id of AUTOMATION_STEPS) {
    assert.ok(events.some((e) => e.step === id && e.status === 'skip'), `${id} must report a skip`);
  }
});

test('master on, options off — gated steps skip; engine starts then skips itself', async () => {
  const events = [];
  // The complementary case: with the master ON the shared 'engine' prerequisite
  // is allowed to run, and skips itself for want of order data.
  await run({
    options: { ...AUTOMATION_DEFAULTS, enabled: true },
    deps: fakeDeps(),
    onEvent: (e) => events.push(e),
  });
  assert.deepEqual(events.map((e) => `${e.step}:${e.status}`), [
    'pull:skip', 'engine:start', 'engine:skip', 'generate:skip', 'labs:skip', 'emails:skip',
  ]);
});

test('a throwing onEvent listener cannot break the run', async () => {
  const res = await run({ onEvent: () => { throw new Error('bad listener'); } });
  assert.equal(res.ok, true);
  assert.equal(res.steps.length, AUTOMATION_STEPS.length);
});

/* ------------------------------------------------------------------ *
 * Concurrent-run guard
 * ------------------------------------------------------------------ */

test('a second concurrent run is refused with already-running', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = fakeDeps({
    loadGrafana: async () => {
      await gate;
      return { yearStartMs: () => 0, fetchKamcOrders: async () => ({ rows: ROWS, errors: [] }) };
    },
  });

  const first = run({ deps: slow });
  const second = await run();

  assert.deepEqual(second, {
    ok: false, steps: [], files: [], labFiles: [], drafts: [], errors: ['already-running'],
  });

  release();
  const firstRes = await first;
  assert.equal(firstRes.ok, true);

  // The guard released — a later run works again.
  const third = await run();
  assert.equal(third.ok, true);
});

/* ------------------------------------------------------------------ *
 * Abort
 * ------------------------------------------------------------------ */

test('an already-aborted signal skips every step', async () => {
  const controller = new AbortController();
  controller.abort();
  const deps = fakeDeps({
    loadGrafana: async () => { throw new Error('nothing may run after abort'); },
  });
  const res = await run({ signal: controller.signal, deps });

  assert.equal(res.ok, false);
  assert.deepEqual(res.errors, ['aborted']);
  assert.deepEqual(res.steps.map((s) => s.status), ['skip', 'skip', 'skip', 'skip', 'skip']);
  assert.deepEqual(res.files, []);
});

test('aborting mid-run stops before the next step', async () => {
  const controller = new AbortController();
  const deps = fakeDeps({
    loadGrafana: async () => ({
      yearStartMs: () => 0,
      fetchKamcOrders: async () => { controller.abort(); return { rows: ROWS, errors: [] }; },
    }),
    loadEngine: async () => { throw new Error('engine must not run after abort'); },
  });
  const res = await run({ signal: controller.signal, deps });

  assert.equal(statusOf(res, 'pull'), 'done');
  assert.deepEqual(res.steps.slice(1).map((s) => s.status), ['skip', 'skip', 'skip', 'skip']);
  assert.deepEqual(res.errors, ['aborted']);
  assert.equal(res.ok, false);
});

/* ------------------------------------------------------------------ *
 * Error isolation
 * ------------------------------------------------------------------ */

test('a failing engine records one error and leaves labs/emails running', async () => {
  const deps = fakeDeps({
    loadEngine: async () => { throw new Error('engine exploded'); },
  });
  const res = await run({ deps });

  assert.equal(statusOf(res, 'pull'), 'done');
  assert.equal(statusOf(res, 'engine'), 'error');
  assert.equal(statusOf(res, 'generate'), 'skip'); // no model to render
  assert.equal(statusOf(res, 'labs'), 'done');
  assert.equal(statusOf(res, 'emails'), 'done');
  assert.deepEqual(res.errors, ['engine: engine exploded']);
  assert.equal(res.labFiles.length, 1);
  assert.equal(res.drafts.length, 1);
  assert.equal(res.ok, false);
});

test('a failing pull does not stop the independent steps', async () => {
  const state = makeState();
  state.parsed.orders = ROWS; // yesterday's rows are still in memory
  const deps = fakeDeps({
    loadGrafana: async () => ({
      yearStartMs: () => 0,
      fetchKamcOrders: async () => { throw new Error('HTTP 503'); },
    }),
  });
  const res = await run({ state, deps });

  assert.equal(statusOf(res, 'pull'), 'error');
  assert.deepEqual(res.errors, ['pull: HTTP 503']);
  assert.equal(statusOf(res, 'engine'), 'done');
  assert.equal(statusOf(res, 'generate'), 'done');
  assert.equal(statusOf(res, 'labs'), 'done');
  assert.equal(res.files.length, 1);
});

test('produceReportFiles returning nothing is a generate error, not a throw', async () => {
  const store = makeStore();
  const deps = fakeDeps({ produceReportFiles: async () => [] });
  const res = await run({ store, deps });

  assert.equal(statusOf(res, 'generate'), 'error');
  assert.equal(res.errors.length, 1);
  assert.deepEqual(store.snapshots, []); // nothing produced → nothing persisted
  assert.equal(statusOf(res, 'labs'), 'done'); // still independent
});

/* ------------------------------------------------------------------ *
 * Graceful degradation
 * ------------------------------------------------------------------ */

test('emails skip cleanly when Track 5 eml-draft is absent', async () => {
  const res = await run({ deps: fakeDeps({ loadEmlDraft: async () => null }) });
  assert.equal(statusOf(res, 'emails'), 'skip');
  assert.match(res.steps[4].message, /\S/); // a human-readable reason, not an empty skip
  assert.deepEqual(res.drafts, []);
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});

test('pull skips when the live source is not configured', async () => {
  const store = makeStore({ grafana: { enabled: false } });
  const res = await run({ store, deps: fakeDeps({ loadGrafana: async () => { throw new Error('never'); } }) });
  assert.equal(statusOf(res, 'pull'), 'skip');
  assert.equal(statusOf(res, 'engine'), 'skip'); // no orders → nothing to compute
  assert.equal(statusOf(res, 'generate'), 'skip'); // no model
  assert.equal(statusOf(res, 'labs'), 'skip'); // no rows
  assert.equal(res.ok, true);
});

test('the snapshot fallback runs when the direct query fails with a TypeError', async () => {
  const store = makeStore({
    grafana: { enabled: true, baseUrl: 'https://grafana.test', accessToken: 'tok', panelId: 1, dataKey: 'ab'.repeat(32) },
  });
  const state = makeState();
  let snapshotUsed = false;
  const deps = fakeDeps({
    loadGrafana: async () => ({
      yearStartMs: () => 0,
      fetchKamcOrders: async () => { throw new TypeError('Failed to fetch'); },
      fetchKamcSnapshot: async () => {
        snapshotUsed = true;
        return { rows: ROWS, errors: [], fetchedAt: '2026-07-20T05:00:00.000Z' };
      },
    }),
  });
  const res = await run({ store, state, deps, options: { ...ALL_ON, autoGenerate: false } });

  assert.equal(snapshotUsed, true);
  assert.equal(statusOf(res, 'pull'), 'done');
  assert.equal(state.parsed.orders, ROWS);
  assert.equal(res.ok, true);
});

/* ------------------------------------------------------------------ *
 * Task-lifecycle state (settings.taskLog) + the project tracker
 *
 * UPDATED 2026-10-13 (tracker CONTRACT §1.4 / §1.8): the closed-task log is RETIRED —
 * nothing writes settings.taskLog any more (the old tracker's "closed task shown once"
 * rule keyed on its Arabic categories/statuses; the new tracker is a persisted document
 * shown as it is). The automation does not even load model/task-lifecycle.js. The run's
 * model carries the NEW tracker as `projectTracker` — resolved from this run's parsed
 * tracker, else the cached (web-edited) document, tagged ProjectTrackers only.
 * (Previously: the run's model carried the drafted tasksCurrent/tasksInternal and the
 * guard lived in recordRunSnapshot's main-report branch.)
 * ------------------------------------------------------------------ */

/** A SYNTHETIC tagged ProjectTracker (made-up WBS / tasks / owners). */
const projectTracker = (n = 2, tag = 'misbar-task-tracker-v1') => ({
  format: tag, fileName: 'synthetic-tracker.xlsx', loadedAt: '2026-07-19T06:00:00.000Z', editedAt: null, warnings: [],
  tasks: Array.from({ length: n }, (_, i) => ({
    id: `9.${i + 1}`, wbs: `9.${i + 1}`, track: 'Track Z', milestone: 'Milestone Z', workstream: 'WS', workPackage: 'WP',
    task: `Synthetic task ${i + 1}`, taskType: 'Deliverable', organization: 'LEAN', owner: 'Owner Z', priority: 'High',
    status: 'In Progress', due: '2026-07-30', predecessor: '', nextAction: '', definitionOfDone: '', notes: '',
  })),
});

// The OLD rows a legacy model carried — kept on the fake to prove that even a model that
// still HAS task arrays gets no task-log write.
const LIFECYCLE_ROWS = {
  tasksCurrent: [{ task: 'مهمة خارجية', status: 'قيد التنفيذ', category: 'نوبكو', hidden: false }],
  tasksInternal: [{ task: 'مهمة داخلية', status: 'مستمر', category: 'لين', hidden: false }],
};

/** Deps whose report-model fake records the `tracker` it was handed and carries it on as
 *  projectTracker (as the real one does), plus a lifecycle seam that counts every touch. */
const withTasksDeps = (over = {}) => {
  const seen = { trackers: [], bothTrackers: [], lifecycleLoads: 0, shownTasks: 0 };
  const deps = fakeDeps({
    loadReportModel: async () => ({
      buildReportModel: ({ engineOutput, reportDate, tracker }) => {
        seen.trackers.push(tracker);
        return { reportDate, kpi: engineOutput, projectTracker: tracker, ...LIFECYCLE_ROWS };
      },
    }),
    loadTaskLifecycle: async () => {
      seen.lifecycleLoads += 1;
      return { ...taskLifecycle, recordShownTasks: (...a) => { seen.shownTasks += 1; return taskLifecycle.recordShownTasks(...a); } };
    },
    ...over,
  });
  const bothDeps = deps.loadHospitalReport;
  deps.loadHospitalReport = async () => {
    const hr = await bothDeps();
    return { ...hr, buildBothModel: (args) => { seen.bothTrackers.push(args.tracker); return hr.buildBothModel(args); } };
  };
  return { deps, seen };
};

test('a successful (main-report) run records the numbers but NEVER the task log', async () => {
  const store = makeStore({ cachedTracker: { model: projectTracker(), updatedAt: '2026-07-19T06:00:00.000Z' } });
  const state = makeState();
  const { deps, seen } = withTasksDeps();
  const res = await run({ store, state, deps });
  assert.equal(statusOf(res, 'generate'), 'done');
  assert.equal(state.reportModel.projectTracker, store.settings.cachedTracker.model, 'the model carries the cached tracker');
  assert.equal(seen.lifecycleLoads, 0, 'the task-lifecycle module is not even loaded');
  assert.equal(seen.shownTasks, 0, 'recordShownTasks is never called');
  assert.deepEqual(store.docs, [], 'no settings write (snapshotHistory is null in the fakes)');
  // The numbers path still ran, under the run's report date.
  assert.equal(store.snapshots.length, 1);
  assert.equal(store.snapshots[0].asOf, '2026-07-20');
  assert.ok(taskKey, 'taskKey stays importable (task-lifecycle.js is kept, inert)');
});

// UPDATED 2026-10-13 (review R-2, tracker CONTRACT §1.7/§1.8): was "parsed tracker first".
// The run publishes the PERSISTED document only — state.parsed.tracker is the same document
// in a real session, but the never-persisted (tagged) buildMockTracker one in a mock/dev tab.
test('resolveTracker: the cached (persisted) document only — tagged ProjectTrackers only; parsed is never read', async () => {
  const cached = projectTracker(3);
  const parsed = projectTracker(1);
  const cache = (model) => ({ cachedTracker: { model, updatedAt: '2026-07-19T06:00:00.000Z' } });
  const OLD = { tasks: [{ task: 'مهمة', status: 'مستمر', category: 'لين' }], challenges: [], risks: [] };
  const cases = [
    { name: 'cache only', settings: cache(cached), parsedTracker: null, want: cached },
    { name: 'the cache wins over a parsed (e.g. mock) tracker', settings: cache(cached), parsedTracker: parsed, want: cached },
    { name: 'a parsed tracker alone (never persisted) = no tracker', settings: {}, parsedTracker: parsed, want: null },
    { name: 'no tracker anywhere', settings: {}, parsedTracker: null, want: null },
    { name: 'untagged (OLD-format) cache = no tracker', settings: cache(OLD), parsedTracker: null, want: null },
    { name: 'wrong tag = no tracker', settings: cache(projectTracker(2, 'misbar-task-tracker-v0')), parsedTracker: null, want: null },
    { name: 'untagged parsed falls through to the tagged cache', settings: cache(cached), parsedTracker: OLD, want: cached },
  ];
  for (const c of cases) {
    const store = makeStore(c.settings);
    const state = makeState();
    state.parsed.tracker = c.parsedTracker;
    const { deps, seen } = withTasksDeps();
    const res = await run({ store, state, deps });
    assert.equal(statusOf(res, 'engine'), 'done', c.name);
    assert.deepEqual(seen.trackers, [c.want], `${c.name}: buildReportModel's tracker`);
    assert.deepEqual(seen.bothTrackers, [c.want], `${c.name}: buildBothModel's tracker`);
    assert.equal(state.reportModel.projectTracker, c.want, `${c.name}: the main model's projectTracker`);
  }
});

// AUTOMATIC ARABIC (CONTRACT-AUTO §5): the unattended deck's tracker carries the same
// translations the review applies — the built-in memory (decrypted with the data key, once
// per session; a session copy on the state is reused), the user's corrections and the
// machine cache from settings. A translated COPY: the cache itself is never rewritten. With
// nothing to translate the cached document passes through untouched (the test above).
test('the automation deck\'s tracker is translated: built-in memory (data key) + user corrections, cache untouched', async () => {
  const cached = projectTracker(3);
  const before = JSON.stringify(cached);
  const KEY = 'a'.repeat(64);
  const keys = [];
  const store = makeStore({
    grafana: { enabled: true, baseUrl: 'https://grafana.test', accessToken: 'tok', panelId: 1, dataKey: KEY },
    cachedTracker: { model: cached, updatedAt: '2026-07-19T06:00:00.000Z' },
    trackerTranslations: {
      tasks: { 'synthetic task 2': 'تصحيح المستخدم للمهمة 2' },
      original: { 'synthetic task 3': true },
      machine: { tasks: { 'synthetic task 3': 'ترجمة آلية للمهمة 3' } },
    },
  });
  const state = makeState();
  const builtin = {
    generatedAt: '2026-10-13T00:00:00.000Z',
    entries: {
      tasks: { 'synthetic task 1': 'المهمة التجريبية 1', 'synthetic task 2': 'نص معتمد يُغلب' },
      tracks: { 'track z': 'المسار ز' },
      milestones: {},
    },
  };
  const { deps, seen } = withTasksDeps({
    loadTrackerTranslations: async () => ({ loadTrackerTranslations: async (k) => { keys.push(k); return builtin; } }),
  });
  const res = await run({ store, state, deps });
  assert.equal(statusOf(res, 'engine'), 'done');
  assert.deepEqual(keys, [KEY], 'the built-in memory is decrypted with the data key');
  assert.equal(state.trackerBuiltinTM, builtin, 'left on the state for the screens (once per session)');
  const t = state.reportModel.projectTracker;
  assert.equal(seen.trackers[0], t, 'buildReportModel got the translated tracker');
  assert.equal(seen.bothTrackers[0], t);
  assert.notEqual(t, cached, 'a copy');
  assert.equal(JSON.stringify(cached), before, 'the cached document is not rewritten by a run');
  assert.deepEqual(t.tasks.map((x) => [x.taskAr, x.taskArSource]), [
    ['المهمة التجريبية 1', 'builtin'],
    ['تصحيح المستخدم للمهمة 2', 'user'],
    ['ترجمة آلية للمهمة 3', 'machine'],
  ]);
  assert.deepEqual(t.tasks.map((x) => x.trackAr), ['المسار ز', 'المسار ز', 'المسار ز']);
  assert.deepEqual(t.tasks.map((x) => x.showOriginal), [false, false, true], '«النص الأصلي» honoured');
  assert.deepEqual(t.tasks.map((x) => x.task), ['Synthetic task 1', 'Synthetic task 2', 'Synthetic task 3'], 'English untouched');

  // A second run in the same session reuses the state's copy — no second decrypt.
  await run({ store, state, deps });
  assert.equal(keys.length, 1);
});

test('the automation deck without a data key: no built-in load, the other layers still apply', async () => {
  const cached = projectTracker(2);
  let loads = 0;
  const store = makeStore({
    cachedTracker: { model: cached, updatedAt: '2026-07-19T06:00:00.000Z' },
    trackerTranslations: { tasks: { 'synthetic task 1': 'تصحيح' } },
  });
  const state = makeState();
  const { deps } = withTasksDeps({ loadTrackerTranslations: async () => { loads += 1; return null; } });
  await run({ store, state, deps });
  assert.equal(loads, 0, 'nothing to decrypt with');
  assert.equal(state.reportModel.projectTracker.tasks[0].taskAr, 'تصحيح');
  assert.equal(state.reportModel.projectTracker.tasks[1].taskAr, '');
});

test('the minimal model fake (no task arrays) triggers NO taskLog write', async () => {
  // Regression guard for the store stub the rest of this suite uses: a model without
  // tasksCurrent/tasksInternal must not persist an empty log (that would look like a
  // report in which every task vanished) and must not throw.
  const store = makeStore();
  const res = await run({ store });
  assert.equal(statusOf(res, 'generate'), 'done');
  assert.deepEqual(store.docs, [], 'nothing written when the model carries no task lists');
  assert.equal(store.snapshots.length, 1, 'the snapshot path still ran');
});

test('a failed generate writes no taskLog at all', async () => {
  const store = makeStore();
  const { deps } = withTasksDeps({ produceReportFiles: async () => [] });
  const res = await run({ store, deps });
  assert.equal(statusOf(res, 'generate'), 'error');
  assert.deepEqual(store.docs, [], 'no files produced → no lifecycle write');
  assert.deepEqual(store.snapshots, [], 'and no snapshot, as before');
});

/* ------------------------------------------------------------------ *
 * shouldAutoDownloadFiles (R2) — the MANUAL generate flow's gate.
 *
 * reportOptions.autoDownloadFiles decides whether the 4 files the operator
 * just generated push themselves into the browser's downloads (ON = the
 * shipped desktop behaviour) or wait behind the per-file buttons. The
 * predicate is pure so it can be pinned here without a DOM; screen-generate
 * wraps its download loop in it.
 *
 * It is STRICTLY INDEPENDENT from automation.autoDownload. That flag belongs
 * to the UNATTENDED run — a presentation checkbox on the review screen must
 * never arm a background download, and turning the presentation checkbox off
 * must never disarm a run the user deliberately automated. Two settings, two
 * owners, no cross-reads: the independence case below is the executable
 * statement of that rule.
 * ------------------------------------------------------------------ */
test('shouldAutoDownloadFiles truth table: default ON, explicit false OFF', () => {
  const withFlag = (v) => ({ reportOptions: { autoDownloadFiles: v } });
  // Explicit values.
  assert.equal(shouldAutoDownloadFiles({ settings: withFlag(true), mobile: false }), true);
  assert.equal(shouldAutoDownloadFiles({ settings: withFlag(false), mobile: false }), false);
  // Absent / empty / missing settings → ON. An install that never stored the flag keeps
  // downloading exactly as it did before the toggle shipped.
  assert.equal(shouldAutoDownloadFiles({ settings: { reportOptions: {} }, mobile: false }), true);
  assert.equal(shouldAutoDownloadFiles({ settings: {}, mobile: false }), true);
  assert.equal(shouldAutoDownloadFiles({ settings: undefined, mobile: false }), true);
  assert.equal(shouldAutoDownloadFiles({ mobile: false }), true);
  assert.equal(shouldAutoDownloadFiles({}), true);
  assert.equal(shouldAutoDownloadFiles(), true);
});

test('shouldAutoDownloadFiles is always false on mobile, whatever the setting says', () => {
  // Unchanged platform reality: iOS Safari drops programmatic anchor clicks, so the
  // mobile flow has always used the per-file buttons. The new toggle cannot turn that on.
  for (const v of [true, false, undefined]) {
    assert.equal(
      shouldAutoDownloadFiles({ settings: { reportOptions: { autoDownloadFiles: v } }, mobile: true }),
      false,
      `mobile + autoDownloadFiles:${String(v)}`,
    );
  }
  assert.equal(shouldAutoDownloadFiles({ settings: {}, mobile: true }), false);
});

test('automation.autoDownload is INDEPENDENT of reportOptions.autoDownloadFiles', async () => {
  // The unattended run downloads because the user armed automation.autoDownload. The
  // review screen's presentation checkbox (autoDownloadFiles:false) must not reach into
  // it: if this ever fails, an operator who tidied up their manual flow has silently
  // disarmed their scheduled run.
  const downloaded = [];
  const store = makeStore({
    reportOptions: { autoDownloadFiles: false, slides: {}, kpiCards: {}, labels: {}, deltaMode: 'week' },
  });
  const deps = fakeDeps({
    loadDownload: async () => ({ triggerDownload: (blob, name) => downloaded.push(name) }),
  });
  const res = await run({
    store,
    deps,
    // Deck only — the lab-file and email steps have their own download paths.
    options: { ...ALL_ON, autoDownload: true, autoLabFiles: false, autoEmailDrafts: false },
  });
  assert.equal(statusOf(res, 'generate'), 'done');
  assert.deepEqual(downloaded, ['report.pptx'], 'the automated run downloaded despite autoDownloadFiles:false');
  // And the predicate still reports OFF for the manual flow on the same settings — the
  // two answers are allowed to disagree, which is the whole point.
  assert.equal(shouldAutoDownloadFiles({ settings: store.settings, mobile: false }), false);
});

test('automation.autoDownload:false downloads nothing even with autoDownloadFiles ON', () => {
  // The mirror image, stated as a predicate check: the manual gate says ON, but that
  // says nothing about the unattended run, which stays off until its own flag is armed.
  const settings = { reportOptions: { autoDownloadFiles: true } };
  assert.equal(shouldAutoDownloadFiles({ settings, mobile: false }), true);
  assert.equal(AUTOMATION_DEFAULTS.autoDownload, false, 'automation is opt-in, never inferred');
});

/* ------------------------------------------------------------------ *
 * Slide order — the unattended run publishes the SAVED order only.
 *
 * The review screen's one-report order lives in the app state (state.slideOrder) and is
 * overlaid onto ITS model as model.slideOrder. The automation builds its own model from
 * settings, so neither may reach the published deck: what the run renders must be
 * settings.reportOptions.slideOrder (absent → the default).
 * ------------------------------------------------------------------ */

test('the automation publishes with the SAVED slide order — never the review\'s one-report order', async () => {
  const SAVED = ['compliance', 'tracker', 'trackerCompleted', 'execFunnel', 'shipments', 'monthly', 'sendout', 'challenges', 'definitions'];
  const TEMP = ['challenges', 'definitions', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'tracker', 'trackerCompleted'];
  const handed = [];
  const store = makeStore({ reportOptions: { slides: {}, kpiCards: {}, labels: {}, deltaMode: 'week', slideOrder: SAVED } });
  const state = makeState();
  // A review session left a one-report order behind: in the state AND on its pinned model.
  state.slideOrder = { order: TEMP, epoch: 0 };
  state.reportModel = { reportDate: '2026-07-20', slideOrder: TEMP, reportOptions: { slideOrder: TEMP } };
  const deps = fakeDeps({ produceReportFiles: async ({ model }) => { handed.push(model); return [{ def: { name: 'report.pptx' }, blob: { size: 2 } }]; } });
  const res = await run({ store, state, deps });
  assert.equal(statusOf(res, 'generate'), 'done');
  assert.equal(handed.length, 1);
  const [model] = handed;
  assert.equal('slideOrder' in model, false, 'no one-report order on the run\'s model');
  assert.equal(model.reportOptions, store.settings.reportOptions, 'the settings\' reportOptions, verbatim');
  assert.deepEqual(slideOrderOf(model), SAVED, 'the deck builders read the saved order');
  // And with no saved order, the default — still never the state's one.
  const handed2 = [];
  const store2 = makeStore({ reportOptions: { slides: {}, kpiCards: {}, labels: {}, deltaMode: 'week' } });
  const deps2 = fakeDeps({ produceReportFiles: async ({ model: m }) => { handed2.push(m); return [{ def: { name: 'report.pptx' }, blob: { size: 2 } }]; } });
  await run({ store: store2, state, deps: deps2 });
  assert.deepEqual(slideOrderOf(handed2[0]), normalizeSlideOrder(undefined));
});

/* ------------------------------------------------------------------ *
 * Cadence — the trigger's ?mode= wins for THAT run, never saved.
 *
 * scripts/misbar-daily.sh opens the Thursday job with &mode=weekly; main.js hands it to
 * runAutomation as `cadence`. A «يومي» the operator last saved on the review screen must
 * not turn the weekly report daily (cover «اليومي», no
 * «المهام المكتملة خلال الأسبوع» slide — the only slide with Completed tasks) — and the override must not leak into settings.
 * ------------------------------------------------------------------ */

test('cadence: a saved «يومي» + the weekly trigger (cadence:\'weekly\') publishes a WEEKLY deck; settings untouched', async () => {
  const opts = () => ({ slides: {}, kpiCards: {}, labels: {}, deltaMode: 'week', cadence: 'daily' });
  const grab = () => {
    const handed = [];
    const deps = fakeDeps({ produceReportFiles: async ({ model }) => { handed.push(model); return [{ def: { name: 'report.pptx' }, blob: { size: 2 } }]; } });
    return { handed, deps };
  };
  // The weekly job.
  const store = makeStore({ reportOptions: opts() });
  const a = grab();
  const res = await run({ store, deps: a.deps, cadence: 'weekly' });
  assert.equal(statusOf(res, 'generate'), 'done');
  assert.equal(a.handed[0].reportOptions.cadence, 'weekly', 'the run\'s model is weekly');
  assert.equal(reportCadence(a.handed[0].reportOptions.cadence), 'weekly', 'as the deck builders read it');
  assert.equal(a.handed[0].reportOptions.deltaMode, 'week', 'every other saved option carried over');
  assert.notEqual(a.handed[0].reportOptions, store.settings.reportOptions, 'a copy — the settings object is not rewritten');
  assert.equal(store.settings.reportOptions.cadence, 'daily', 'the saved cadence is unchanged');
  // The plain daily trigger (no mode) — the saved cadence, verbatim.
  const store2 = makeStore({ reportOptions: opts() });
  const b = grab();
  await run({ store: store2, deps: b.deps });
  assert.equal(b.handed[0].reportOptions, store2.settings.reportOptions);
  assert.equal(b.handed[0].reportOptions.cadence, 'daily');
  // An explicit daily trigger over a saved weekly; junk = the saved one.
  const store3 = makeStore({ reportOptions: { ...opts(), cadence: 'weekly' } });
  const c = grab();
  await run({ store: store3, deps: c.deps, cadence: 'DAILY' });
  assert.equal(c.handed[0].reportOptions.cadence, 'daily');
  assert.equal(store3.settings.reportOptions.cadence, 'weekly');
  const d = grab();
  await run({ store: store3, deps: d.deps, cadence: 'fortnightly' });
  assert.equal(d.handed[0].reportOptions, store3.settings.reportOptions, 'an unknown value = no override');
});
