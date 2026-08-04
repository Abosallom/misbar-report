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
  AUTOMATION_DEFAULTS, AUTOMATION_STEPS, runAutomation,
} from '../src/automation/pipeline.js';
// The lifecycle module is pure and tiny — injected through the same deps seam so the
// taskLog cases assert the REAL key/entry shape rather than a re-implementation.
import * as taskLifecycle from '../src/model/task-lifecycle.js';

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
  // successful generate persisted the snapshot through the store.
  assert.equal(state.parsed.orders, ROWS);
  assert.equal(state.reportModel, seenModel);
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
 * Task-lifecycle state (settings.taskLog)
 *
 * A successful automated run owes the lifecycle the same write the manual generate
 * screen makes — otherwise the unattended path would keep showing a task as open
 * forever, and a task closed overnight would never get its one grace report.
 * The write reads the FINAL model (manual review edits are recorded exactly as
 * published) and only happens once files were actually produced.
 * ------------------------------------------------------------------ */

const LIFECYCLE_ROWS = {
  tasksCurrent: [{ task: 'مهمة خارجية', status: 'قيد التنفيذ', category: 'نوبكو', hidden: false }],
  tasksInternal: [{ task: 'مهمة داخلية', status: 'مستمر', category: 'لين', hidden: false }],
};

// A model fake that DOES carry the two task arrays (the real report-model always does).
const withTasksDeps = (over = {}) => fakeDeps({
  loadReportModel: async () => ({
    buildReportModel: ({ engineOutput, reportDate }) => ({
      reportDate, kpi: engineOutput, ...LIFECYCLE_ROWS,
    }),
  }),
  loadTaskLifecycle: async () => taskLifecycle,
  ...over,
});

test('a successful run records the shown tasks into settings.taskLog', async () => {
  const store = makeStore();
  const res = await run({ store, deps: withTasksDeps() });
  assert.equal(statusOf(res, 'generate'), 'done');

  // loadDeltaBaseline is null in the fakes, so the snapshotHistory block writes
  // nothing: every saveSettings here belongs to the lifecycle write.
  assert.equal(store.docs.length, 1, 'exactly one settings write');
  const doc = store.docs[0];
  assert.deepEqual(doc.taskLog, {
    [taskKey('ext', LIFECYCLE_ROWS.tasksCurrent[0])]: { openOn: '2026-07-20', closedOn: null },
    [taskKey('int', LIFECYCLE_ROWS.tasksInternal[0])]: { openOn: '2026-07-20', closedOn: null },
  }, 'both lists recorded under the run’s report date');
  // The existing snapshot path is untouched by the new block.
  assert.equal(store.snapshots.length, 1);
  assert.equal(store.snapshots[0].asOf, '2026-07-20');
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
  const deps = withTasksDeps({ produceReportFiles: async () => [] });
  const res = await run({ store, deps });
  assert.equal(statusOf(res, 'generate'), 'error');
  assert.deepEqual(store.docs, [], 'no files produced → no lifecycle write');
  assert.deepEqual(store.snapshots, [], 'and no snapshot, as before');
});
