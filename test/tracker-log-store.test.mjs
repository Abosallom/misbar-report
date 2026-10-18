// test/tracker-log-store.test.mjs — settings.trackerStatusLog, the STORE side (2026-10-18,
// CONTRACT C). Run: node --test
//
// The weekly «المهام المكتملة خلال الأسبوع» slide needs to know WHEN a task became Completed,
// so the store keeps a per-task status history. This file pins its lifecycle:
//   • SEEDED once from an existing cachedTracker (dated by its editedAt || loadedAt) when the
//     doc has no history — derived on load without writing; the first real write persists it;
//   • RECORDED by updateCachedTracker (every upload, every website edit) — an entry only for a
//     task whose effective status changed;
//   • survives a reload, an export → import round trip; an import REPLACES it (a backup with
//     a tracker but no history drops this device's and re-seeds from the imported document);
//   • validated / bounded on import like every other stored key.
// SYNTHETIC documents only (made-up WBS ids and task texts — never the user's tracker).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SETTINGS_KEY } from '../src/contracts.js';
import * as store from '../src/store.js';
import { TRACKER_FORMAT, TASK_FIELDS } from '../src/ingest/task-tracker.js';
import { completedDuring } from '../src/model/tracker-status.js';

function makeMock() {
  const map = new Map();
  let writes = 0;
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { writes += 1; map.set(k, String(v)); },
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    get writes() { return writes; },
    raw: () => map.get(SETTINGS_KEY),
  };
}
function fresh(mock = makeMock()) {
  globalThis.localStorage = mock;
  store.__resetForTests();
  return mock;
}

/** The operator's local calendar day — what the store dates a write with. */
function localToday() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Midday UTC: the same calendar day in every time zone between UTC−11 and UTC+11, so the
// seed's expected date does not depend on where the suite runs.
const SEED_EDITED = '2026-01-07T12:00:00.000Z';
const SEED_DAY = '2026-01-07';

function task(wbs, extra = {}) {
  const t = {};
  for (const f of TASK_FIELDS) t[f] = '';
  return { ...t, id: wbs, wbs, task: `Synthetic task ${wbs}`, status: 'In Progress', due: '', ...extra };
}
/** A tagged synthetic tracker: A in progress (undated), B delayed, C overdue in progress
 *  (late by date), D already completed. */
function trackerDoc(over = {}, tasks = null) {
  return {
    format: TRACKER_FORMAT, fileName: 'synthetic.xlsx', loadedAt: '2026-01-06T12:00:00.000Z',
    editedAt: SEED_EDITED, warnings: [],
    tasks: tasks || [
      task('9.1'),
      task('9.2', { status: 'Delayed' }),
      task('9.3', { due: '2026-01-02' }),
      task('9.4', { status: 'Completed' }),
    ],
    ...over,
  };
}
/** A stored v-current doc with a cached tracker and NO status history (every install from
 *  before this feature). */
function storeLegacy(mock, model = trackerDoc()) {
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    cachedTracker: { model, updatedAt: '2026-01-07T12:00:01.000Z' },
  }));
}

// ---- seeding ------------------------------------------------------------------------------

test('seed: a cached tracker with no history is seeded on load, dated by its editedAt day — and the load writes nothing', () => {
  const mock = fresh();
  storeLegacy(mock);
  const before = mock.raw();
  const writesBefore = mock.writes;
  const doc = store.loadSettings();
  assert.deepEqual(doc.trackerStatusLog, {
    v: 1,
    tasks: {
      '9.1': [{ at: SEED_DAY, status: 'inProgress' }],
      '9.2': [{ at: SEED_DAY, status: 'late' }],
      '9.3': [{ at: SEED_DAY, status: 'late' }], // overdue on the seed day → recorded as Late
      '9.4': [{ at: SEED_DAY, status: 'completed' }],
    },
  });
  assert.equal(mock.writes, writesBefore, 'a clean same-version load still writes nothing');
  assert.equal(mock.raw(), before);
  // Deterministic: every load derives the very same seed.
  store.__resetForTests();
  assert.deepEqual(store.loadSettings().trackerStatusLog, doc.trackerStatusLog);
  assert.deepEqual(store.getTrackerStatusLog(), doc.trackerStatusLog);
});

test('seed: no editedAt → the loadedAt day; no cached tracker → no history at all', () => {
  const mock = fresh();
  storeLegacy(mock, trackerDoc({ editedAt: null }));
  const log = store.loadSettings().trackerStatusLog;
  assert.equal(log.tasks['9.1'][0].at, '2026-01-06');
  fresh();
  const plain = store.loadSettings();
  assert.equal('trackerStatusLog' in plain, false, 'a fresh install has no history');
  assert.equal(store.getTrackerStatusLog(), null);
});

test('seed: runs ONCE — a stored history (even an empty one) is never re-seeded', () => {
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    cachedTracker: { model: trackerDoc(), updatedAt: '2026-01-07T12:00:01.000Z' },
    trackerStatusLog: { v: 1, tasks: {} },
  }));
  assert.deepEqual(store.loadSettings().trackerStatusLog, { v: 1, tasks: {} });
});

// ---- recording ----------------------------------------------------------------------------

test('record: an upload is compared with the SEEDED previous document — a task that became Completed is found', () => {
  const mock = fresh();
  storeLegacy(mock);
  store.loadSettings();
  // This week's upload: 9.2 (delayed) and 9.3 (late by date) are now Completed.
  const next = trackerDoc({ editedAt: null, loadedAt: new Date().toISOString() }, [
    task('9.1'),
    task('9.2', { status: 'Completed' }),
    task('9.3', { status: 'Completed', due: '2026-01-02' }),
    task('9.4', { status: 'Completed' }),
  ]);
  store.updateCachedTracker(next);
  const today = localToday();
  const log = store.getTrackerStatusLog();
  assert.deepEqual(log.tasks['9.2'], [{ at: SEED_DAY, status: 'late' }, { at: today, status: 'completed' }]);
  assert.deepEqual(log.tasks['9.1'], [{ at: SEED_DAY, status: 'inProgress' }], 'unchanged → no entry');
  assert.deepEqual(log.tasks['9.4'], [{ at: SEED_DAY, status: 'completed' }], 'still completed → no entry');
  // The persisted history is what the weekly slide reads.
  const done = completedDuring(log, next, SEED_DAY, today, today);
  assert.deepEqual(done.map((d) => [d.task.wbs, d.previousStatus, d.completedAt]), [
    ['9.2', 'late', today],
    ['9.3', 'late', today],
  ], '9.4 was already completed when first seen — not "completed this week"');
});

test('record: an edit with no status change appends nothing; a change appends one dated entry', () => {
  fresh();
  store.loadSettings();
  const doc = trackerDoc({ editedAt: null }, [task('7.1'), task('7.2', { status: 'Not Started' })]);
  store.updateCachedTracker(doc);
  const today = localToday();
  const first = store.getTrackerStatusLog();
  assert.deepEqual(first.tasks, {
    '7.1': [{ at: today, status: 'inProgress' }],
    '7.2': [{ at: today, status: 'notStarted' }],
  }, 'the first document ever cached: every task recorded once');
  // A website edit of a NON-status field.
  const edited = trackerDoc({ editedAt: new Date().toISOString() }, [task('7.1', { owner: 'Synthetic Owner' }), task('7.2', { status: 'Not Started' })]);
  store.updateCachedTracker(edited);
  assert.deepEqual(store.getTrackerStatusLog(), first, 'no status changed → the history is unchanged');
  // A status edit on the task's FIRST day keeps that day's first reading as the baseline
  // and records the new one after it (tracker-status.js pushEntry: a transition seen only
  // on the first day must not collapse into a lone entry)…
  edited.tasks[1].status = 'In Progress';
  store.updateCachedTracker(edited);
  assert.deepEqual(store.getTrackerStatusLog().tasks['7.2'],
    [{ at: today, status: 'notStarted' }, { at: today, status: 'inProgress' }]);
  // …and a further correction the same day replaces only that newer reading.
  edited.tasks[1].status = 'Completed';
  store.updateCachedTracker(edited);
  assert.deepEqual(store.getTrackerStatusLog().tasks['7.2'],
    [{ at: today, status: 'notStarted' }, { at: today, status: 'completed' }]);
  // Back to the baseline the same day: no transition left.
  edited.tasks[1].status = 'Not Started';
  store.updateCachedTracker(edited);
  assert.deepEqual(store.getTrackerStatusLog().tasks['7.2'], [{ at: today, status: 'notStarted' }]);
});

test('record: clearing the tracker keeps the history (a re-upload continues it)', () => {
  const mock = fresh();
  storeLegacy(mock);
  const seeded = store.loadSettings().trackerStatusLog;
  store.updateCachedTracker(null);
  store.__resetForTests();
  const doc = store.loadSettings();
  assert.equal(doc.cachedTracker, null);
  assert.deepEqual(doc.trackerStatusLog, seeded, 'persisted by that write, kept');
});

test('record: a task with no WBS and no id is not tracked — the document is still saved', () => {
  fresh();
  store.loadSettings();
  // A task with no WBS and no id cannot be tracked — the document is still saved.
  const odd = trackerDoc({ editedAt: null }, [task('5.1'), { ...task(''), id: '', wbs: '' }]);
  const out = store.updateCachedTracker(odd);
  assert.ok(out.cachedTracker, 'the document is cached');
  assert.ok(store.getTrackerStatusLog().tasks['5.1']);
});

// ---- persistence: reload, export → import, import rules -----------------------------------

test('persist: the history survives a reload and an export → import round trip', async () => {
  const mock = fresh();
  storeLegacy(mock);
  store.loadSettings();
  store.updateCachedTracker(trackerDoc({ editedAt: null }, [task('9.1', { status: 'Completed' }), task('9.2'), task('9.3'), task('9.4', { status: 'Completed' })]));
  const log = store.getTrackerStatusLog();
  store.__resetForTests();
  assert.deepEqual(store.getTrackerStatusLog(), log, 'reload');
  const exported = JSON.parse(await store.exportSettings().blob.text());
  assert.deepEqual(exported.trackerStatusLog, log, 'exported');
  // Another device (no tracker, no history) imports the backup.
  fresh();
  store.loadSettings();
  store.importSettings(JSON.stringify(exported));
  assert.deepEqual(store.getTrackerStatusLog(), log, 'imported verbatim');
  store.__resetForTests();
  assert.deepEqual(store.getTrackerStatusLog(), log, 'and still there after a reload');
});

test('import: a backup history REPLACES this device\'s (never a per-task union)', () => {
  const mock = fresh();
  storeLegacy(mock);
  store.loadSettings();
  store.updateCachedTracker(trackerDoc({ editedAt: null }));
  const backupLog = { v: 1, tasks: { 'Z.1': [{ at: '2026-02-01', status: 'late' }, { at: '2026-02-03', status: 'completed' }] } };
  store.importSettings(JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, trackerStatusLog: backupLog }));
  assert.deepEqual(store.getTrackerStatusLog(), backupLog);
});

test('import: a backup with a tracker but NO history drops this device\'s and re-seeds from the imported document', () => {
  fresh();
  store.loadSettings();
  store.updateCachedTracker(trackerDoc({ editedAt: null }, [task('1.1'), task('1.2')]));
  assert.ok(store.getTrackerStatusLog().tasks['1.1']);
  const imported = trackerDoc({ editedAt: '2026-03-04T12:00:00.000Z' }, [task('8.1', { status: 'On Hold' })]);
  store.importSettings(JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    cachedTracker: { model: imported, updatedAt: '2026-03-04T12:00:01.000Z' },
  }));
  assert.deepEqual(store.getTrackerStatusLog(), { v: 1, tasks: { '8.1': [{ at: '2026-03-04', status: 'stopped' }] } },
    'the history of the imported document, not this device\'s');
});

test('import: a null history is ignored (this device\'s kept); no key at all keeps it too', () => {
  const mock = fresh();
  storeLegacy(mock);
  store.loadSettings();
  store.updateCachedTracker(trackerDoc({ editedAt: null }));
  const mine = store.getTrackerStatusLog();
  store.importSettings(JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, trackerStatusLog: null }));
  assert.deepEqual(store.getTrackerStatusLog(), mine);
  store.importSettings(JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, displayNames: {} }));
  assert.deepEqual(store.getTrackerStatusLog(), mine);
});

test('import validation: containers and bounds enforced; a malformed ENTRY is dropped, not an error', () => {
  fresh();
  store.loadSettings();
  const imp = (trackerStatusLog) => store.importSettings(JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, trackerStatusLog }));
  for (const bad of ['x', 3, [], { tasks: [] }, { tasks: { a: 'x' } }, { tasks: { a: Array(501).fill({ at: '2026-01-01', status: 'late' }) } }]) {
    assert.throws(() => imp(bad), /trackerStatusLog/, JSON.stringify(bad).slice(0, 60));
  }
  const tooMany = { v: 1, tasks: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`k${i}`, []])) };
  assert.throws(() => imp(tooMany), /trackerStatusLog كبير جداً/);
  imp({ v: 1, tasks: {
    ok: [{ at: '2026-01-01', status: 'late' }, { at: 'yesterday', status: 'late' }, { at: '2026-01-02', status: 'Not A Key' }, { at: '2026-01-03', status: 'completed', extra: 1 }],
    empty: [],
  } });
  assert.deepEqual(store.getTrackerStatusLog(), { v: 1, tasks: {
    ok: [{ at: '2026-01-01', status: 'late' }, { at: '2026-01-03', status: 'completed' }],
  } });
});

test('load: a junk stored history is removed (then re-seeded from the cache); a dirty one is cleaned', () => {
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    cachedTracker: { model: trackerDoc(), updatedAt: '2026-01-07T12:00:01.000Z' },
    trackerStatusLog: 'junk',
  }));
  assert.equal(store.loadSettings().trackerStatusLog.tasks['9.1'][0].at, SEED_DAY, 'junk → absent → seeded');
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    trackerStatusLog: { v: 1, tasks: { a: [{ at: '2026-01-02', status: 'late' }, { at: '2026-01-01', status: 'inProgress' }, { at: '2026-01-02', status: 'late' }] } },
  }));
  assert.deepEqual(store.loadSettings().trackerStatusLog.tasks.a, [
    { at: '2026-01-01', status: 'inProgress' }, { at: '2026-01-02', status: 'late' },
  ], 'sorted, duplicates collapsed (the status module\'s shape rule)');
});

test('sanitizeStatusLog: the status module\'s shape + the store\'s size bound', () => {
  assert.deepEqual(store.sanitizeStatusLog(null), { v: 1, tasks: {} });
  // 1000 tasks × 60 entries would pass 200k chars: each history is cut to its last 5.
  const tasks = {};
  for (let i = 0; i < 1000; i += 1) {
    tasks[`task-${i}`] = Array.from({ length: 60 }, (_, d) => ({
      at: `2026-${String(1 + Math.floor(d / 28)).padStart(2, '0')}-${String(1 + (d % 28)).padStart(2, '0')}`,
      status: d % 2 ? 'late' : 'inProgress',
    }));
  }
  const out = store.sanitizeStatusLog({ v: 1, tasks });
  assert.equal(Object.keys(out.tasks).length, 1000);
  assert.ok(Object.values(out.tasks).every((l) => l.length === 5));
  assert.deepEqual(out.tasks['task-0'].at(-1), tasks['task-0'].at(-1), 'the most recent entries kept');
});
