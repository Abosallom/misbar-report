// test/tracker-ar-data-store.test.mjs — store.js side of the Arabic task translations
// (2026-10-13): reportOptions.trackerLang ('ar' | 'en' | 'both', default 'ar') seeded,
// backfilled, validated and imported like deltaMode; a tracker cached BEFORE the
// taskAr / trackAr / milestoneAr fields existed stays a valid document (the fields read
// ''); and the fields persist / import like every other task field.
// Map-based localStorage mock, SYNTHETIC tracker documents only.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SETTINGS_KEY } from '../src/contracts.js';
import { REPORT_OPTIONS_SEED } from '../src/seeds/defaults.js';
import * as store from '../src/store.js';
import { TRACKER_FORMAT, TASK_FIELDS } from '../src/ingest/task-tracker.js';

const AR = ['taskAr', 'trackAr', 'milestoneAr'];
// The 17 task keys a tracker cached before the translations existed carries.
const OLD_FIELDS = TASK_FIELDS.filter((f) => !AR.includes(f));

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

/** A SYNTHETIC tracker; `fields` = the task keys it carries (OLD_FIELDS = a pre-translation cache). */
function trackerDoc(fields = TASK_FIELDS, extra = {}) {
  const task = (wbs, over = {}) => {
    const t = {};
    for (const f of fields) t[f] = '';
    return { ...t, id: wbs, wbs, task: `Synthetic task ${wbs}`, track: 'Synthetic Track', status: 'In Progress', ...over };
  };
  return {
    format: TRACKER_FORMAT, fileName: 'synthetic.xlsx', loadedAt: '2026-10-13T08:00:00.000Z',
    editedAt: null, warnings: [], tasks: [task('1.1.1', extra), task('1.2.1')],
  };
}

function storeDoc(mock, over) {
  mock.setItem(SETTINGS_KEY, JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, ...over }));
  store.__resetForTests();
}

// ---- trackerLang: seed / backfill ---------------------------------------------------------

test('first run seeds trackerLang \'ar\'', () => {
  fresh();
  assert.equal(REPORT_OPTIONS_SEED.trackerLang, 'ar');
  assert.equal(store.loadSettings().reportOptions.trackerLang, 'ar');
});

test('a stored doc without trackerLang is backfilled to \'ar\'; ar / en / both survive; junk resets', () => {
  const mock = fresh();
  const { trackerLang: _drop, ...noLang } = REPORT_OPTIONS_SEED;
  storeDoc(mock, { reportOptions: noLang });
  assert.equal(store.loadSettings().reportOptions.trackerLang, 'ar', 'missing → seed');
  for (const v of ['ar', 'en', 'both']) {
    storeDoc(mock, { reportOptions: { ...REPORT_OPTIONS_SEED, trackerLang: v } });
    assert.equal(store.loadSettings().reportOptions.trackerLang, v, `${v} preserved`);
  }
  storeDoc(mock, { reportOptions: { ...REPORT_OPTIONS_SEED, trackerLang: ' Both ' } });
  assert.equal(store.loadSettings().reportOptions.trackerLang, 'both', 'case / spaces forgiven');
  for (const bad of ['fr', '', 1, null, { v: 'en' }]) {
    storeDoc(mock, { reportOptions: { ...REPORT_OPTIONS_SEED, trackerLang: bad } });
    assert.equal(store.loadSettings().reportOptions.trackerLang, 'ar', `${JSON.stringify(bad)} → seed`);
  }
});

test('an OLD-schema doc migrates with trackerLang \'ar\' and keeps its other report options', () => {
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: 8,
    reportOptions: { excludeNoTat: true, slides: { execFunnel: false }, kpiCards: {}, labels: {}, deltaMode: 'week' },
  }));
  store.__resetForTests();
  const ro = store.loadSettings().reportOptions;
  assert.equal(ro.trackerLang, 'ar');
  assert.equal(ro.excludeNoTat, true);
  assert.equal(ro.slides.execFunnel, false);
});

test('saveSettings keeps an edited trackerLang across a reload', () => {
  fresh();
  const s = store.loadSettings();
  s.reportOptions.trackerLang = 'both';
  store.saveSettings(s);
  store.__resetForTests();
  assert.equal(store.loadSettings().reportOptions.trackerLang, 'both');
});

// ---- trackerLang: import --------------------------------------------------------------------

test('importSettings: trackerLang validated, normalized, imported; absent keeps the device\'s', () => {
  fresh();
  store.loadSettings();
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: { trackerLang: 'french' } })),
    /trackerLang/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: { trackerLang: 2 } })),
    /'ar' أو 'en' أو 'both'/,
    'the message lists the accepted values, built from the enum',
  );
  assert.equal(store.loadSettings().reportOptions.trackerLang, 'ar', 'a rejected import changes nothing');

  store.importSettings(JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: { trackerLang: 'EN' } }));
  assert.equal(store.loadSettings().reportOptions.trackerLang, 'en', 'imported, canonical case');

  store.importSettings(JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: { excludeNoTat: true } }));
  assert.equal(store.loadSettings().reportOptions.trackerLang, 'en', 'a backup without the key keeps this device\'s choice');

  // An OLD backup (no trackerLang at all) imports and leaves the device's value.
  store.importSettings(JSON.stringify({ schemaVersion: 7, reportOptions: { slides: { tracker: true } } }));
  assert.equal(store.loadSettings().reportOptions.trackerLang, 'en');
});

test('export → import round-trips trackerLang', async () => {
  fresh();
  const s = store.loadSettings();
  s.reportOptions.trackerLang = 'both';
  store.saveSettings(s);
  const json = await store.exportSettings().blob.text();
  assert.equal(JSON.parse(json).reportOptions.trackerLang, 'both');
  fresh();
  store.loadSettings();
  store.importSettings(json);
  assert.equal(store.loadSettings().reportOptions.trackerLang, 'both');
});

// ---- the translation fields in the cached tracker -------------------------------------------

test('a tracker cached BEFORE the translation fields existed loads valid, its tasks reading \'\'', () => {
  const mock = fresh();
  const old = trackerDoc(OLD_FIELDS, { owner: 'Synthetic Owner' });
  old.editedAt = '2026-10-13T09:00:00.000Z';
  storeDoc(mock, { reportOptions: { ...REPORT_OPTIONS_SEED }, cachedTracker: { model: old, updatedAt: '2026-10-13T09:00:00.000Z' } });
  const raw = mock.getItem(SETTINGS_KEY);
  const ct = store.loadSettings().cachedTracker;
  assert.ok(ct, 'still the cached document (not dropped as stale)');
  assert.equal(ct.model.tasks.length, 2);
  for (const t of ct.model.tasks) {
    assert.deepEqual(Object.keys(t).sort(), [...TASK_FIELDS].sort(), t.id);
    for (const f of AR) assert.equal(t[f], '', `${t.id}.${f}`);
  }
  // Nothing else moved: the edit, its stamp, the English text.
  assert.equal(ct.model.editedAt, '2026-10-13T09:00:00.000Z');
  assert.equal(ct.model.tasks[0].owner, 'Synthetic Owner');
  assert.equal(ct.model.tasks[0].task, 'Synthetic task 1.1.1');
  assert.equal(mock.getItem(SETTINGS_KEY), raw, 'a same-version load still writes nothing');
});

test('updateCachedTracker persists the translations; the English stays beside them', () => {
  fresh();
  store.loadSettings();
  const doc = trackerDoc(TASK_FIELDS, { taskAr: 'مهمة تجريبية\nبسطرين', trackAr: 'مسار تجريبي', milestoneAr: 'مرحلة تجريبية' });
  store.updateCachedTracker(doc);
  store.__resetForTests();
  const t = store.loadSettings().cachedTracker.model.tasks[0];
  assert.deepEqual([t.task, t.taskAr, t.track, t.trackAr, t.milestoneAr],
    ['Synthetic task 1.1.1', 'مهمة تجريبية\nبسطرين', 'Synthetic Track', 'مسار تجريبي', 'مرحلة تجريبية']);
  // An old-shape (pre-translation) document handed to the store is completed with ''.
  store.updateCachedTracker(trackerDoc(OLD_FIELDS));
  store.__resetForTests();
  for (const x of store.loadSettings().cachedTracker.model.tasks) for (const f of AR) assert.equal(x[f], '', f);
});

test('importSettings: a backup tracker with or without the translation fields is valid', () => {
  fresh();
  store.loadSettings();
  // Pre-translation backup.
  store.importSettings(JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    cachedTracker: { model: trackerDoc(OLD_FIELDS), updatedAt: '2026-10-13T08:00:00.000Z' },
  }));
  let m = store.loadSettings().cachedTracker.model;
  for (const t of m.tasks) {
    assert.deepEqual(Object.keys(t).sort(), [...TASK_FIELDS].sort());
    for (const f of AR) assert.equal(t[f], '', f);
  }
  // Backup with translations: kept verbatim (non-strings coerced like any task field).
  store.importSettings(JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    cachedTracker: { model: trackerDoc(TASK_FIELDS, { taskAr: 'مهمة مستوردة', trackAr: 5 }), updatedAt: '2026-10-13T08:00:00.000Z' },
  }));
  m = store.loadSettings().cachedTracker.model;
  assert.equal(m.tasks[0].taskAr, 'مهمة مستوردة');
  assert.equal(m.tasks[0].trackAr, '5');
  assert.equal(m.tasks[0].task, 'Synthetic task 1.1.1');
});
