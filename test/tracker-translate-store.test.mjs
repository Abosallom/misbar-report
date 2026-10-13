// test/tracker-translate-store.test.mjs — store.js side of the AUTOMATIC tracker Arabic
// (2026-10-13): settings.trackerTranslations (the user's corrections, «النص الأصلي» choices
// and the on-device machine cache) is never seeded, cleaned on load, written through
// updateTrackerTranslations (bounded), exported, validated / sanitized / UNION-merged on
// import; and a cached tracker keeps its translation bookkeeping (sources, showOriginal).
// Map-based localStorage mock, SYNTHETIC text only.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SETTINGS_KEY } from '../src/contracts.js';
import * as store from '../src/store.js';
import { TRACKER_FORMAT, TASK_FIELDS } from '../src/ingest/task-tracker.js';
import {
  emptyTranslationMemory, setUserTranslation, setOriginal, addMachineTranslations,
  applyTrackerTranslations, TM_ENTRY_LIMIT, TM_MAX_CHARS, TM_VALUE_MAX,
} from '../src/model/tracker-translate.js';

function makeMock() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}
function fresh(mock = makeMock()) {
  globalThis.localStorage = mock;
  store.__resetForTests();
  return mock;
}
const stored = (mock) => JSON.parse(mock.getItem(SETTINGS_KEY));
function storeDoc(mock, over) {
  mock.setItem(SETTINGS_KEY, JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, ...over }));
  store.__resetForTests();
}
const backup = (over) => JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, ...over });

function trackerDoc(tasks) {
  return { format: TRACKER_FORMAT, fileName: 'synthetic.xlsx', loadedAt: '2026-10-13T08:00:00.000Z', editedAt: null, warnings: [], tasks };
}
function task(o) {
  const t = {};
  for (const f of TASK_FIELDS) t[f] = '';
  return { ...t, ...o };
}

const SAMPLE = addMachineTranslations(
  setOriginal(setUserTranslation(emptyTranslationMemory(), 'tasks', 'Synthetic user task', 'تصحيح'), 'Synthetic user task', true),
  { tasks: { 'Synthetic machine task': 'آلية' } },
);

// ---- never seeded / get / update ------------------------------------------------------------

test('never seeded: a first run has no trackerTranslations; get returns the empty memory', () => {
  const mock = fresh();
  const doc = store.loadSettings();
  assert.ok(!('trackerTranslations' in doc));
  assert.ok(!('trackerTranslations' in stored(mock)));
  assert.deepEqual(store.getTrackerTranslations(), emptyTranslationMemory());
});

test('updateTrackerTranslations persists the clean memory; get reads it back; null removes it', () => {
  const mock = fresh();
  store.loadSettings();
  store.updateTrackerTranslations({ ...SAMPLE, junk: 1, tasks: { ...SAMPLE.tasks, '  Raw KEY ': ' ع ' } });
  const tt = stored(mock).trackerTranslations;
  assert.deepEqual(Object.keys(tt).sort(), ['machine', 'milestones', 'original', 'tasks', 'tracks']);
  assert.deepEqual(tt.tasks, { 'synthetic user task': 'تصحيح', 'raw key': 'ع' });
  assert.deepEqual(tt.original, { 'synthetic user task': true });
  assert.deepEqual(tt.machine.tasks, { 'synthetic machine task': 'آلية' });
  assert.deepEqual(store.getTrackerTranslations(), tt);
  store.updateTrackerTranslations(null);
  assert.ok(!('trackerTranslations' in stored(mock)));
  assert.deepEqual(store.getTrackerTranslations(), emptyTranslationMemory());
});

test('updateTrackerTranslations refuses a memory past TM_MAX_CHARS and keeps the stored one', () => {
  const mock = fresh();
  store.loadSettings();
  store.updateTrackerTranslations(SAMPLE);
  const huge = { tasks: {}, machine: { tasks: {} } };
  const val = 'ع'.repeat(TM_VALUE_MAX);
  for (let i = 0; i < 120; i++) { huge.tasks[`synthetic ${i}`] = val; huge.machine.tasks[`synthetic ${i}`] = val; }
  assert.ok(JSON.stringify(huge).length >= TM_MAX_CHARS);
  assert.throws(() => store.updateTrackerTranslations(huge), /كبيرة جداً/);
  assert.deepEqual(stored(mock).trackerTranslations.tasks, { 'synthetic user task': 'تصحيح' });
});

test('load: a stored memory is cleaned in memory; a junk (non-object) value is removed, not seeded', () => {
  const mock = fresh();
  storeDoc(mock, { trackerTranslations: { tasks: { ' A  B ': 'أب', bad: 3 }, extra: true } });
  const doc = store.loadSettings();
  assert.deepEqual(doc.trackerTranslations, { ...emptyTranslationMemory(), tasks: { 'a b': 'أب' } });
  for (const junk of [null, 'x', 5, ['a']]) {
    storeDoc(mock, { trackerTranslations: junk });
    assert.ok(!('trackerTranslations' in store.loadSettings()), JSON.stringify(junk));
  }
});

// ---- export / import ------------------------------------------------------------------------

test('export carries the memory and import restores it (round trip)', async () => {
  fresh();
  store.loadSettings();
  store.updateTrackerTranslations(SAMPLE);
  const { blob } = store.exportSettings();
  const text = await blob.text();
  assert.deepEqual(JSON.parse(text).trackerTranslations, store.getTrackerTranslations());
  const mock2 = fresh();
  store.loadSettings();
  store.importSettings(text);
  assert.deepEqual(stored(mock2).trackerTranslations, JSON.parse(text).trackerTranslations);
});

test('import UNIONS with this device\'s memory, the backup winning per key; junk entries dropped', () => {
  const mock = fresh();
  store.loadSettings();
  store.updateTrackerTranslations({ tasks: { mine: 'لي', shared: 'قديم' }, original: { mine: true } });
  store.importSettings(backup({
    trackerTranslations: { tasks: { shared: 'جديد', theirs: 'لهم', bad: 7 }, machine: { tasks: { m: 'م' } }, extra: 1 },
  }));
  const tt = stored(mock).trackerTranslations;
  assert.deepEqual(tt.tasks, { shared: 'جديد', theirs: 'لهم', mine: 'لي' });
  assert.deepEqual(tt.original, { mine: true });
  assert.deepEqual(tt.machine.tasks, { m: 'م' });
  assert.ok(!('extra' in tt));
});

test('import without the key (or with null) keeps this device\'s memory; an import never seeds one', () => {
  const mock = fresh();
  store.loadSettings();
  store.importSettings(backup({ displayNames: {} }));
  assert.ok(!('trackerTranslations' in stored(mock)), 'no key in, no key stored');
  store.updateTrackerTranslations(SAMPLE);
  store.importSettings(backup({ displayNames: {} }));
  store.importSettings(backup({ trackerTranslations: null }));
  assert.deepEqual(stored(mock).trackerTranslations.tasks, { 'synthetic user task': 'تصحيح' });
});

test('import validation: bad containers, too many entries, too large → rejected, nothing stored', () => {
  const mock = fresh();
  store.loadSettings();
  store.updateTrackerTranslations(SAMPLE);
  const before = mock.getItem(SETTINGS_KEY);
  const many = {};
  for (let i = 0; i <= TM_ENTRY_LIMIT; i++) many[`k${i}`] = 'ع';
  const val = 'ع'.repeat(TM_VALUE_MAX);
  const big = {};
  for (let i = 0; i < 120; i++) big[`synthetic ${i}`] = val;
  const cases = [
    [{ trackerTranslations: 'x' }, /trackerTranslations غير صالح/],
    [{ trackerTranslations: [] }, /trackerTranslations غير صالح/],
    [{ trackerTranslations: { tasks: [] } }, /trackerTranslations\.tasks غير صالح/],
    [{ trackerTranslations: { original: 'x' } }, /trackerTranslations\.original غير صالح/],
    [{ trackerTranslations: { machine: 3 } }, /trackerTranslations\.machine غير صالح/],
    [{ trackerTranslations: { machine: { tracks: 'x' } } }, /trackerTranslations\.machine\.tracks غير صالح/],
    [{ trackerTranslations: { tasks: many } }, /كبير جداً/],
    [{ trackerTranslations: { tasks: big, machine: { tasks: big } } }, /كبير جداً/],
  ];
  for (const [doc, re] of cases) assert.throws(() => store.importSettings(backup(doc)), re, JSON.stringify(doc).slice(0, 60));
  assert.equal(mock.getItem(SETTINGS_KEY), before);
});

test('import merge stays bounded: a full backup trims this device\'s extra keys first', () => {
  const mock = fresh();
  store.loadSettings();
  store.updateTrackerTranslations({ tasks: { 'device only': 'ج' } });
  const full = {};
  for (let i = 0; i < TM_ENTRY_LIMIT; i++) full[`b${i}`] = 'ع';
  store.importSettings(backup({ trackerTranslations: { tasks: full } }));
  const tasks = stored(mock).trackerTranslations.tasks;
  assert.equal(Object.keys(tasks).length, TM_ENTRY_LIMIT);
  assert.ok(!('device only' in tasks));
});

// ---- the cached tracker keeps its bookkeeping -----------------------------------------------

test('updateCachedTracker keeps taskArSource / trackArSource / milestoneArSource and showOriginal', () => {
  const mock = fresh();
  store.loadSettings();
  const applied = applyTrackerTranslations(trackerDoc([
    task({ id: '1', task: 'Synthetic user task', track: 'Synthetic Track' }),
    task({ id: '2', task: 'Synthetic other task', taskAr: 'من الملف' }),
    task({ id: '3', task: 'Synthetic machine task' }),
  ]), { user: SAMPLE, builtin: { tracks: { 'synthetic track': 'مسار' } } });
  store.updateCachedTracker(applied);
  const [a, b, c] = stored(mock).cachedTracker.model.tasks;
  assert.deepEqual([a.taskAr, a.taskArSource, a.showOriginal, a.trackAr, a.trackArSource], ['تصحيح', 'user', true, 'مسار', 'builtin']);
  assert.deepEqual([b.taskAr, b.taskArSource, 'showOriginal' in b], ['من الملف', 'file', false]);
  assert.deepEqual([c.taskAr, c.taskArSource], ['آلية', 'machine']);
  assert.ok(!('trackArSource' in b) && !('milestoneArSource' in a), 'no empty source persisted');
  // Survives a reload (backfill leaves present keys alone) and an export → import.
  store.__resetForTests();
  assert.equal(store.loadSettings().cachedTracker.model.tasks[0].taskArSource, 'user');
  const text = JSON.stringify(stored(mock));
  const mock2 = fresh();
  store.loadSettings();
  store.importSettings(text);
  assert.deepEqual(stored(mock2).cachedTracker.model.tasks, stored(mock).cachedTracker.model.tasks);
});
