// test/store.test.mjs — Track C store tests. Run: node --test
// Stubs globalThis.localStorage with a Map-based mock (optionally failing) and
// resets the store's in-memory state before each case for isolation.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SETTINGS_KEY } from '../src/contracts.js';
import { TAT_LOOKUP } from '../src/seeds/tat-lookup.js';
import { SCORECARD_SEED } from '../src/seeds/scorecard.js';
import { HISTORICAL_CONSTANTS_SEED, SNAPSHOT_SEED, GRAFANA_SEED } from '../src/seeds/defaults.js';
import * as store from '../src/store.js';

// ---- localStorage mocks -----------------------------------------------------
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

// A mock whose writes throw (Safari private mode); reads return null.
function makeThrowingWriteMock() {
  return {
    getItem: () => null,
    setItem: () => {
      throw new DOMException('QuotaExceededError');
    },
    removeItem: () => {},
    clear: () => {},
  };
}

// A mock that throws on every access (fully denied storage).
function makeDeniedMock() {
  return {
    get getItem() {
      throw new Error('denied');
    },
  };
}

function fresh(mock = makeMock()) {
  globalThis.localStorage = mock;
  store.__resetForTests();
  return mock;
}

// ---- first-run seeding ------------------------------------------------------
test('first run seeds from the frozen seeds and persists', () => {
  const mock = fresh();
  const s = store.loadSettings();

  assert.equal(s.schemaVersion, store.SCHEMA_VERSION);
  assert.ok(typeof s.updatedAt === 'string' && s.updatedAt.length > 0);

  // 59 TAT entries.
  assert.equal(Object.keys(s.tatLookup).length, 59);
  assert.equal(Object.keys(s.tatLookup).length, Object.keys(TAT_LOOKUP).length);

  // 13 scorecard rows.
  assert.equal(s.scorecard.length, 13);
  assert.equal(s.scorecard.length, SCORECARD_SEED.length);

  // manual cancelled additions sum 43 (Jan–Apr only; May/June come from data).
  const cancelledSum = Object.values(s.historicalConstants.cancelledByMonth).reduce(
    (a, b) => a + b,
    0,
  );
  assert.equal(cancelledSum, 43);

  // snapshot full number set: completed 437.
  assert.equal(s.snapshot.numbers.completed, 437);
  assert.equal(s.snapshot.asOf, SNAPSHOT_SEED.asOf);

  assert.equal(store.isEphemeral(), false);
  // Actually persisted to storage.
  assert.ok(mock.getItem(SETTINGS_KEY) != null, 'seed doc persisted');
  const stored = JSON.parse(mock.getItem(SETTINGS_KEY));
  assert.equal(stored.snapshot.numbers.completed, 437);
});

test('displayNames seeds empty and historicalConstants matches seed', () => {
  fresh();
  const s = store.loadSettings();
  assert.deepEqual(s.displayNames, {});
  assert.deepEqual(
    s.historicalConstants.cancelledByMonth,
    HISTORICAL_CONSTANTS_SEED.cancelledByMonth,
  );
});

// ---- save / load roundtrip --------------------------------------------------
test('save/load roundtrip persists edits and restamps updatedAt', () => {
  fresh();
  const s = store.loadSettings();
  const before = s.updatedAt;
  s.tatLookup['NEW TEST'] = 9;
  s.snapshot.numbers.completed = 500;

  const saved = store.saveSettings(s);
  assert.equal(saved.tatLookup['NEW TEST'], 9);
  assert.ok(saved.updatedAt >= before);

  // Reload from storage sees the change.
  store.__resetForTests();
  const reloaded = store.loadSettings();
  assert.equal(reloaded.tatLookup['NEW TEST'], 9);
  assert.equal(reloaded.snapshot.numbers.completed, 500);
});

// ---- snapshot migration (legacy {prevCompleted} → {numbers}) -----------------
test('legacy snapshot {prevCompleted} migrates in-place to {numbers.completed}', () => {
  const mock = fresh();
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      schemaVersion: 1,
      tatLookup: { X: 1 },
      snapshot: { prevCompleted: 400, asOf: '2026-06-01' },
    }),
  );

  const s = store.loadSettings();
  assert.equal(s.snapshot.numbers.completed, 400);
  assert.equal(s.snapshot.asOf, '2026-06-01');
  // Remaining numbers backfilled from the seed.
  assert.equal(s.snapshot.numbers.total, SNAPSHOT_SEED.numbers.total);
  // No stray legacy key left behind.
  assert.equal(s.snapshot.prevCompleted, undefined);
});

// ---- schema mismatch --------------------------------------------------------
test('schema mismatch resets to seeds with a console warning', () => {
  const mock = fresh();
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({ schemaVersion: 999, tatLookup: { X: 1 }, junk: true }),
  );

  const warnings = [];
  const orig = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const s = store.loadSettings();
    assert.equal(s.schemaVersion, store.SCHEMA_VERSION);
    assert.equal(Object.keys(s.tatLookup).length, 59); // reseeded
  } finally {
    console.warn = orig;
  }
  assert.ok(warnings.some((w) => /schemaVersion/.test(w)), 'warned about schema');
});

test('corrupt JSON resets to seeds', () => {
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, '{not valid json');
  const orig = console.warn;
  console.warn = () => {};
  try {
    const s = store.loadSettings();
    assert.equal(Object.keys(s.tatLookup).length, 59);
  } finally {
    console.warn = orig;
  }
});

// ---- updateSnapshot ---------------------------------------------------------
test('updateSnapshot merges partial numbers over existing and updates asOf', () => {
  fresh();
  store.loadSettings();
  // Only completed + total provided; the rest of the seeded numbers must survive.
  const out = store.updateSnapshot({ asOf: '2026-08-01', numbers: { completed: 612, total: 700 } });
  assert.equal(out.snapshot.numbers.completed, 612);
  assert.equal(out.snapshot.numbers.total, 700);
  assert.equal(out.snapshot.numbers.awaitingResults, SNAPSHOT_SEED.numbers.awaitingResults);
  assert.equal(out.snapshot.asOf, '2026-08-01');

  store.__resetForTests();
  const reloaded = store.loadSettings();
  assert.equal(reloaded.snapshot.numbers.completed, 612);
  assert.equal(reloaded.snapshot.numbers.total, 700);
  assert.equal(reloaded.snapshot.asOf, '2026-08-01');
});

// ---- export -----------------------------------------------------------------
test('exportSettings returns dated filename and a blob of the doc', async () => {
  fresh();
  store.loadSettings();
  const { filename, blob } = store.exportSettings();
  assert.match(filename, /^misbar-settings-\d{8}\.json$/);
  assert.ok(blob instanceof Blob);
  const text = await blob.text();
  const parsed = JSON.parse(text);
  assert.equal(parsed.schemaVersion, store.SCHEMA_VERSION);
  assert.equal(Object.keys(parsed.tatLookup).length, 59);
});

// ---- import validation + merge ----------------------------------------------
test('importSettings rejects a bad schemaVersion', () => {
  fresh();
  store.loadSettings();
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 2, tatLookup: {} })),
    /إصدار المخطط غير مدعوم|schemaVersion|2/,
  );
});

test('importSettings rejects malformed root and bad field shapes', () => {
  fresh();
  store.loadSettings();
  assert.throws(() => store.importSettings('null'), /غير صالح/);
  assert.throws(() => store.importSettings('123'), /غير صالح/);
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 1, tatLookup: [] })),
    /tatLookup/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 1, scorecard: {} })),
    /scorecard/,
  );
  // New snapshot shape: snapshot must be an object; numbers an object of finite numbers.
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 1, snapshot: [] })),
    /snapshot/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 1, snapshot: { numbers: 5 } })),
    /snapshot/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 1, snapshot: { numbers: { completed: 'x' } } })),
    /snapshot\.numbers/,
  );
});

test('importSettings deep-merges import-wins and returns correct counts', () => {
  fresh();
  const base = store.loadSettings();
  const existingName = Object.keys(base.tatLookup)[0];
  const existingVal = base.tatLookup[existingName];

  const incoming = {
    schemaVersion: 1,
    tatLookup: {
      'BRAND NEW TEST A': 11, // added
      'BRAND NEW TEST B': 12, // added
      [existingName]: existingVal + 5, // updated
    },
    displayNames: { 'Some Long Test Name': 'Short' }, // added
    historicalConstants: {
      cancelledByMonth: {
        '2026-01': 999, // updated (seed has 8)
        '2026-12': 3, // added
      },
    },
    snapshot: { asOf: '2026-09-09', numbers: { completed: 700, total: 800 } },
  };

  const summary = store.importSettings(JSON.stringify(incoming));

  assert.deepEqual(summary.tatLookup, { added: 2, updated: 1 });
  assert.deepEqual(summary.displayNames, { added: 1, updated: 0 });
  assert.deepEqual(summary.cancelledByMonth, { added: 1, updated: 1 });
  assert.equal(summary.snapshotChanged, true);
  // No scorecard in import -> preserved, not replaced.
  assert.equal(summary.scorecard.replaced, false);
  assert.equal(summary.scorecard.before, 13);
  assert.equal(summary.scorecard.after, 13);

  // Verify the merge actually landed and import won.
  store.__resetForTests();
  const after = store.loadSettings();
  assert.equal(after.tatLookup['BRAND NEW TEST A'], 11);
  assert.equal(after.tatLookup[existingName], existingVal + 5);
  assert.equal(after.historicalConstants.cancelledByMonth['2026-01'], 999);
  assert.equal(after.historicalConstants.cancelledByMonth['2026-12'], 3);
  // Snapshot numbers: imported leaves win, unspecified seed leaves survive the merge.
  assert.equal(after.snapshot.numbers.completed, 700);
  assert.equal(after.snapshot.numbers.total, 800);
  assert.equal(after.snapshot.numbers.awaitingResults, SNAPSHOT_SEED.numbers.awaitingResults);
  assert.equal(after.snapshot.asOf, '2026-09-09');
  // Untouched seed months preserved.
  assert.equal(after.historicalConstants.cancelledByMonth['2026-03'], 30);
  // Scorecard preserved.
  assert.equal(after.scorecard.length, 13);
});

test('importSettings can replace the scorecard array wholesale', () => {
  fresh();
  store.loadSettings();
  const incoming = {
    schemaVersion: 1,
    scorecard: [
      { lab: 'Only Lab', pct: '50%', target: 4, uploaded: 2, notUploaded: 2, needFix: 0, canOrder: true, available: 2 },
    ],
  };
  const summary = store.importSettings(JSON.stringify(incoming));
  assert.equal(summary.scorecard.replaced, true);
  assert.equal(summary.scorecard.before, 13);
  assert.equal(summary.scorecard.after, 1);
  const after = store.loadSettings();
  assert.equal(after.scorecard.length, 1);
  assert.equal(after.scorecard[0].lab, 'Only Lab');
});

// ---- ephemeral fallback -----------------------------------------------------
test('ephemeral fallback when localStorage write throws', () => {
  fresh(makeThrowingWriteMock());
  const s = store.loadSettings(); // first run tries to persist -> throws -> memory
  assert.equal(Object.keys(s.tatLookup).length, 59);
  assert.equal(store.isEphemeral(), true);

  // Edits still work in memory across load/save.
  s.tatLookup['MEM TEST'] = 3;
  store.saveSettings(s);
  const again = store.loadSettings();
  assert.equal(again.tatLookup['MEM TEST'], 3);
  assert.equal(store.isEphemeral(), true);
});

test('ephemeral fallback when localStorage is fully denied', () => {
  fresh(makeDeniedMock());
  const s = store.loadSettings();
  assert.equal(Object.keys(s.tatLookup).length, 59);
  assert.equal(store.isEphemeral(), true);

  s.snapshot.numbers.completed = 111;
  store.saveSettings(s);
  assert.equal(store.loadSettings().snapshot.numbers.completed, 111);
});

// ---- grafana + cachedTracker seeding ----------------------------------------
test('first run seeds grafana defaults (enabled false, panelId 49) and null cachedTracker', () => {
  fresh();
  const s = store.loadSettings();
  assert.deepEqual(s.grafana, { baseUrl: '', accessToken: '', panelId: 49, enabled: false });
  assert.equal(s.grafana.enabled, false);
  assert.equal(s.grafana.panelId, 49);
  assert.equal(s.cachedTracker, null);
  // Seed is copied, not the frozen module object.
  assert.notEqual(s.grafana, GRAFANA_SEED);
});

// ---- load-time softening backfills the new keys -----------------------------
test('load adds missing grafana/cachedTracker to an old stored doc (no schema bump)', () => {
  const mock = fresh();
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      schemaVersion: 1,
      tatLookup: { X: 1 },
      snapshot: { asOf: '2026-06-01', numbers: { completed: 400 } },
    }),
  );

  const s = store.loadSettings();
  assert.equal(s.schemaVersion, 1); // no bump
  assert.deepEqual(s.grafana, { baseUrl: '', accessToken: '', panelId: 49, enabled: false });
  assert.equal(s.cachedTracker, null);
  // Existing fields untouched.
  assert.equal(s.snapshot.numbers.completed, 400);
});

// ---- updateCachedTracker ----------------------------------------------------
test('updateCachedTracker stores, clears, and enforces the size cap', () => {
  fresh();
  store.loadSettings();

  const model = { tasks: [{ task: 'a' }, { task: 'b' }], challenges: [], risks: [] };
  const out = store.updateCachedTracker(model);
  assert.ok(out.cachedTracker);
  assert.deepEqual(out.cachedTracker.model, model);
  assert.ok(typeof out.cachedTracker.updatedAt === 'string' && out.cachedTracker.updatedAt.length > 0);

  // Persisted across a reload.
  store.__resetForTests();
  const reloaded = store.loadSettings();
  assert.equal(reloaded.cachedTracker.model.tasks.length, 2);

  // Clearing with null.
  const cleared = store.updateCachedTracker(null);
  assert.equal(cleared.cachedTracker, null);
  store.__resetForTests();
  assert.equal(store.loadSettings().cachedTracker, null);

  // Size cap: a model serializing to >= 300k chars must throw and not persist.
  const huge = { tasks: [{ task: 'x'.repeat(300000) }] };
  assert.throws(() => store.updateCachedTracker(huge), /كبير|الحد|300000/);
  assert.equal(store.loadSettings().cachedTracker, null);
});

// ---- import validation for the new shapes -----------------------------------
test('importSettings validates grafana and cachedTracker shapes', () => {
  fresh();
  store.loadSettings();

  // grafana: must be an object; typed leaves enforced.
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 1, grafana: [] })),
    /grafana/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 1, grafana: { baseUrl: 5 } })),
    /baseUrl/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 1, grafana: { accessToken: 5 } })),
    /accessToken/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 1, grafana: { panelId: 'x' } })),
    /panelId/,
  );

  // cachedTracker: null OR {model:object, updatedAt:string}.
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 1, cachedTracker: 5 })),
    /cachedTracker/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 1, cachedTracker: { model: 'x', updatedAt: 'y' } })),
    /cachedTracker\.model/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 1, cachedTracker: { model: {}, updatedAt: 5 } })),
    /cachedTracker\.updatedAt/,
  );
});

test('importSettings accepts valid grafana/cachedTracker and coerces enabled', () => {
  fresh();
  store.loadSettings();

  store.importSettings(
    JSON.stringify({
      schemaVersion: 1,
      grafana: { baseUrl: 'https://x/y', accessToken: 'tok', panelId: 7, enabled: 1 },
      cachedTracker: { model: { tasks: [{ task: 'a' }] }, updatedAt: '2026-07-01T00:00:00.000Z' },
    }),
  );

  const after = store.loadSettings();
  assert.equal(after.grafana.baseUrl, 'https://x/y');
  assert.equal(after.grafana.accessToken, 'tok');
  assert.equal(after.grafana.panelId, 7);
  assert.equal(after.grafana.enabled, true); // coerced from 1
  assert.equal(after.cachedTracker.model.tasks.length, 1);
  assert.equal(after.cachedTracker.updatedAt, '2026-07-01T00:00:00.000Z');

  // A null cachedTracker import clears it.
  store.importSettings(JSON.stringify({ schemaVersion: 1, cachedTracker: null }));
  assert.equal(store.loadSettings().cachedTracker, null);
});

// ---- pickImportKeys strips unknown grafana subkeys --------------------------
test('importSettings strips unknown grafana subkeys before persisting', () => {
  fresh();
  store.loadSettings();

  store.importSettings(
    JSON.stringify({
      schemaVersion: 1,
      grafana: {
        baseUrl: 'https://a/b',
        accessToken: 't',
        panelId: 3,
        enabled: true,
        secretExtra: 'nope',
        evil: { x: 1 },
      },
    }),
  );

  const after = store.loadSettings();
  assert.deepEqual(Object.keys(after.grafana).sort(), ['accessToken', 'baseUrl', 'enabled', 'panelId']);
  assert.equal(after.grafana.secretExtra, undefined);
  assert.equal(after.grafana.evil, undefined);
});
