// test/store.test.mjs — Track C store tests. Run: node --test
// Stubs globalThis.localStorage with a Map-based mock (optionally failing) and
// resets the store's in-memory state before each case for isolation.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SETTINGS_KEY } from '../src/contracts.js';
import { TAT_LOOKUP } from '../src/seeds/tat-lookup.js';
import { SCORECARD_SEED } from '../src/seeds/scorecard.js';
import {
  HISTORICAL_CONSTANTS_SEED, SNAPSHOT_SEED, GRAFANA_SEED, REPORT_OPTIONS_SEED,
  AUTOMATION_SEED,
} from '../src/seeds/defaults.js';
import * as store from '../src/store.js';
// The delta-mode enum has exactly ONE owner (model/delta-baseline.js). The seed is
// pinned against DEFAULT_DELTA_MODE below so a future default change cannot land in
// the model without the stored seed following it.
import { DEFAULT_DELTA_MODE, DELTA_MODES } from '../src/model/delta-baseline.js';

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

  // snapshot full number set: completed 437 (2026-07-28 rule — 422 dated + 15
  // rejected), read from the seed so the two can never drift apart.
  assert.equal(s.snapshot.numbers.completed, 437);
  assert.equal(s.snapshot.numbers.completed, SNAPSHOT_SEED.numbers.completed);
  assert.equal(s.snapshot.asOf, SNAPSHOT_SEED.asOf);

  assert.equal(store.isEphemeral(), false);
  // Actually persisted to storage.
  assert.ok(mock.getItem(SETTINGS_KEY) != null, 'seed doc persisted');
  const stored = JSON.parse(mock.getItem(SETTINGS_KEY));
  assert.equal(stored.snapshot.numbers.completed, SNAPSHOT_SEED.numbers.completed);
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

// ---- v1 → v2 migration ------------------------------------------------------
const MANUAL_SEED = { '2026-01': 8, '2026-02': 1, '2026-03': 30, '2026-04': 4 }; // sum 43

test('v1 stored doc migrates to v2: cancelledByMonth reset to the manual seed, other fields preserved', () => {
  const mock = fresh();
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      schemaVersion: 1,
      tatLookup: { 'CUSTOM EDIT': 7 },
      displayNames: { 'Long Name': 'LN' },
      scorecard: [{ lab: 'L1', target: 5 }],
      historicalConstants: {
        // v1 max-era values: manual months PLUS data-derived 2026-05/06 that
        // would double-count under v2's additive engine.
        cancelledByMonth: { '2026-01': 8, '2026-02': 1, '2026-03': 30, '2026-04': 4, '2026-05': 6, '2026-06': 4 },
      },
      snapshot: { asOf: '2026-06-01', numbers: { completed: 400 } },
      grafana: { baseUrl: 'https://g/h', accessToken: 'tk', panelId: 12, enabled: true },
      cachedTracker: { model: { tasks: [{ task: 'x' }] }, updatedAt: '2026-05-01T00:00:00.000Z' },
    }),
  );

  const s = store.loadSettings();
  assert.equal(s.schemaVersion, store.SCHEMA_VERSION); // migrated forward to current
  // cancelledByMonth reset to manual-only seed (data-derived months dropped).
  assert.deepEqual(s.historicalConstants.cancelledByMonth, MANUAL_SEED);
  const sum = Object.values(s.historicalConstants.cancelledByMonth).reduce((a, b) => a + b, 0);
  assert.equal(sum, 43);
  // Every other field preserved.
  assert.equal(s.tatLookup['CUSTOM EDIT'], 7);
  assert.equal(s.displayNames['Long Name'], 'LN');
  assert.equal(s.scorecard[0].lab, 'L1');
  assert.equal(s.snapshot.numbers.completed, 400);
  assert.equal(s.snapshot.asOf, '2026-06-01');
  assert.equal(s.grafana.baseUrl, 'https://g/h');
  assert.equal(s.grafana.panelId, 12);
  assert.equal(s.cachedTracker.model.tasks.length, 1);
  // Persisted with the bump so the migration runs only once.
  const stored = JSON.parse(mock.getItem(SETTINGS_KEY));
  assert.equal(stored.schemaVersion, store.SCHEMA_VERSION);
  assert.deepEqual(stored.historicalConstants.cancelledByMonth, MANUAL_SEED);
});

test('current-schema stored doc round-trips without migration', () => {
  fresh();
  const s = store.loadSettings();
  assert.equal(s.schemaVersion, store.SCHEMA_VERSION);
  s.tatLookup['RT TEST'] = 5;
  s.historicalConstants.cancelledByMonth['2026-01'] = 21; // user edit survives
  store.saveSettings(s);

  store.__resetForTests();
  const reloaded = store.loadSettings();
  assert.equal(reloaded.schemaVersion, store.SCHEMA_VERSION);
  assert.equal(reloaded.tatLookup['RT TEST'], 5);
  // No reset on a v2 reload — the user edit stays.
  assert.equal(reloaded.historicalConstants.cancelledByMonth['2026-01'], 21);
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
  // v1 and v2 are both accepted now; only other versions are rejected.
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 99, tatLookup: {} })),
    /إصدار المخطط غير مدعوم|schemaVersion|99/,
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
    // v2 import: cancelledByMonth merges (import wins) rather than being reset —
    // the v1 reset transform is exercised separately below.
    schemaVersion: 2,
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

// ---- import: v1 backups + v2 merge ------------------------------------------
test('importSettings accepts a v1 backup and resets cancelledByMonth to the manual seed', () => {
  fresh();
  store.loadSettings();

  const summary = store.importSettings(
    JSON.stringify({
      schemaVersion: 1,
      tatLookup: { 'IMPORTED TAT': 3 },
      // v1 max-era map with data-derived months — must be discarded on import.
      historicalConstants: { cancelledByMonth: { '2026-01': 99, '2026-05': 6, '2026-06': 4 } },
    }),
  );
  assert.ok(summary); // imported without throwing

  const after = store.loadSettings();
  assert.equal(after.schemaVersion, store.SCHEMA_VERSION);
  // v1 cancelledByMonth dropped in favor of the manual seed.
  assert.deepEqual(after.historicalConstants.cancelledByMonth, MANUAL_SEED);
  // Other imported fields still land.
  assert.equal(after.tatLookup['IMPORTED TAT'], 3);
});

test('importSettings v2 backup merges cancelledByMonth (import wins) without resetting', () => {
  fresh();
  store.loadSettings();

  store.importSettings(
    JSON.stringify({
      schemaVersion: 2,
      historicalConstants: { cancelledByMonth: { '2026-01': 15, '2026-07': 2 } },
    }),
  );

  const after = store.loadSettings();
  assert.equal(after.historicalConstants.cancelledByMonth['2026-01'], 15); // import won
  assert.equal(after.historicalConstants.cancelledByMonth['2026-07'], 2); // added
  assert.equal(after.historicalConstants.cancelledByMonth['2026-03'], 30); // seed preserved
});

test('importSettings folds a finite legacy prevCompleted but drops a non-finite one', () => {
  fresh();
  store.loadSettings();

  // Finite → folds into numbers.completed.
  store.importSettings(JSON.stringify({ schemaVersion: 2, snapshot: { asOf: '2026-08-01', prevCompleted: 321 } }));
  assert.equal(store.loadSettings().snapshot.numbers.completed, 321);

  // Non-finite → dropped; the previous value survives the merge.
  store.importSettings(JSON.stringify({ schemaVersion: 2, snapshot: { asOf: '2026-08-02', prevCompleted: 'oops' } }));
  const after = store.loadSettings();
  assert.equal(after.snapshot.numbers.completed, 321); // unchanged, not NaN
  assert.equal(after.snapshot.asOf, '2026-08-02');
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
  assert.deepEqual(s.grafana, { baseUrl: 'https://elab.seha.sa/hpapm', accessToken: '', panelId: 49, enabled: false, dataKey: '' });
  assert.equal(s.grafana.enabled, false);
  assert.equal(s.grafana.panelId, 49);
  assert.equal(s.cachedTracker, null);
  // Seed is copied, not the frozen module object.
  assert.notEqual(s.grafana, GRAFANA_SEED);
});

// ---- load-time softening backfills the new keys -----------------------------
test('load backfills missing grafana/cachedTracker on an old (v1) stored doc during migration', () => {
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
  assert.equal(s.schemaVersion, store.SCHEMA_VERSION); // v1 → current migration stamps the bump
  assert.deepEqual(s.grafana, { baseUrl: 'https://elab.seha.sa/hpapm', accessToken: '', panelId: 49, enabled: false, dataKey: '' });
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

// ---- reportOptions seeding + backfill ---------------------------------------
test('first run seeds reportOptions from the seed (deep-copied)', () => {
  fresh();
  const s = store.loadSettings();
  assert.deepEqual(s.reportOptions, REPORT_OPTIONS_SEED);
  // Copied, not the frozen seed object (top-level + nested).
  assert.notEqual(s.reportOptions, REPORT_OPTIONS_SEED);
  assert.notEqual(s.reportOptions.slides, REPORT_OPTIONS_SEED.slides);
  assert.notEqual(s.reportOptions.kpiCards, REPORT_OPTIONS_SEED.kpiCards);
  assert.equal(s.reportOptions.excludeNoTat, false);
  assert.equal(s.reportOptions.slides.execFunnel, true);
  // 7 exec KPI cards + the 'turnaround' key (monthly slide line chart + overall-average
  // card). ON since v9 (round 6): the block is part of the delivered deck, and the seed
  // writes it EXPLICITLY so build-spec's gate sees a true rather than a missing key.
  assert.equal(Object.keys(s.reportOptions.kpiCards).length, 8);
  assert.equal(s.reportOptions.kpiCards.turnaround, true);
  assert.deepEqual(s.reportOptions.labels, {});
});

test('load backfills a fully missing reportOptions from the seed', () => {
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, JSON.stringify({ schemaVersion: 2, tatLookup: { X: 1 } }));
  const s = store.loadSettings();
  assert.deepEqual(s.reportOptions, REPORT_OPTIONS_SEED);
});

test('load backfills missing reportOptions subkeys while preserving user values', () => {
  const mock = fresh();
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      schemaVersion: 2,
      tatLookup: { X: 1 },
      // partial reportOptions: an on excludeNoTat, one slide flag, nothing else.
      reportOptions: { excludeNoTat: true, slides: { execFunnel: false } },
    }),
  );
  const s = store.loadSettings();
  // User values preserved.
  assert.equal(s.reportOptions.excludeNoTat, true);
  assert.equal(s.reportOptions.slides.execFunnel, false);
  // Missing slide subkeys backfilled from the seed (future-key resilience).
  assert.equal(s.reportOptions.slides.monthly, true);
  assert.equal(s.reportOptions.slides.compliance, true);
  assert.equal(s.reportOptions.slides.action, true);
  // Missing kpiCards + labels fully backfilled.
  assert.deepEqual(s.reportOptions.kpiCards, REPORT_OPTIONS_SEED.kpiCards);
  assert.deepEqual(s.reportOptions.labels, {});
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
        dataKey: 'ab'.repeat(32),
        secretExtra: 'nope',
        evil: { x: 1 },
      },
    }),
  );

  const after = store.loadSettings();
  assert.deepEqual(Object.keys(after.grafana).sort(), ['accessToken', 'baseUrl', 'dataKey', 'enabled', 'panelId']);
  assert.equal(after.grafana.dataKey, 'ab'.repeat(32));
  assert.equal(after.grafana.secretExtra, undefined);
  assert.equal(after.grafana.evil, undefined);
});

// ---- import validation + whitelisting for reportOptions ---------------------
test('importSettings validates reportOptions container shapes and label types', () => {
  fresh();
  store.loadSettings();

  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 2, reportOptions: [] })),
    /reportOptions/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 2, reportOptions: { slides: 5 } })),
    /reportOptions\.slides/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 2, reportOptions: { kpiCards: 5 } })),
    /reportOptions\.kpiCards/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 2, reportOptions: { labels: 5 } })),
    /reportOptions\.labels/,
  );
  // Non-string label value is rejected.
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 2, reportOptions: { labels: { total: 5 } } })),
    /reportOptions\.labels/,
  );
});

test('importSettings whitelists reportOptions keys, coerces flags, drops unknown subkeys', () => {
  fresh();
  store.loadSettings();

  store.importSettings(
    JSON.stringify({
      schemaVersion: 2,
      reportOptions: {
        excludeNoTat: 1, // coerce → true
        slides: { execFunnel: 0, monthly: 1, bogusSlide: true }, // bogus dropped
        kpiCards: { total: 0, evilCard: 1 }, // evil dropped
        labels: { total: 'الإجمالي' }, // string kept
        unknownSub: { x: 1 }, // whole key dropped
      },
    }),
  );

  const ro = store.loadSettings().reportOptions;
  assert.equal(ro.excludeNoTat, true); // coerced from 1
  assert.equal(ro.slides.execFunnel, false); // coerced from 0
  assert.equal(ro.slides.monthly, true); // coerced from 1
  assert.equal(ro.slides.bogusSlide, undefined); // unknown slide dropped
  assert.equal(ro.slides.compliance, true); // untouched seed key survives the merge
  assert.equal(ro.slides.action, true);
  assert.equal(ro.kpiCards.total, false); // coerced from 0
  assert.equal(ro.kpiCards.evilCard, undefined); // unknown card dropped
  assert.equal(ro.kpiCards.completed, true); // untouched seed key survives
  assert.equal(ro.labels.total, 'الإجمالي');
  assert.equal(ro.unknownSub, undefined); // unknown top-level reportOptions key dropped
});

// ---- reportOptions.deltaMode: week-to-date (the default since 2026-08-04) ----
test('first run seeds deltaMode week and the definitions slide OFF (simple 6-slide deck)', () => {
  fresh();
  const ro = store.loadSettings().reportOptions;
  assert.equal(ro.deltaMode, 'week');
  assert.equal(ro.deltaMode, REPORT_OPTIONS_SEED.deltaMode);
  // PARITY PIN: the seed is not allowed to drift from the model's declared default.
  assert.equal(REPORT_OPTIONS_SEED.deltaMode, DEFAULT_DELTA_MODE);
  // The delivered deck is cover · exec · monthly · compliance · action · thanks.
  assert.equal(ro.slides.definitions, false);
  assert.equal(ro.slides.execFunnel, true);
  assert.equal(ro.slides.monthly, true);
  assert.equal(ro.slides.compliance, true);
  assert.equal(ro.slides.action, true);
});

test("the retired weekly deltaMode values migrate to 'week' on load", () => {
  // 'weekly' (pre-split), 'weekly-sun' and 'weekly-thu' (the weekday-anchored round) all
  // meant "compare against a week ago"; week-to-date is what that now IS, so an existing
  // install keeps a weekly comparison instead of being reset.
  for (const legacy of ['weekly', 'weekly-sun', 'weekly-thu']) {
    const mock = fresh();
    mock.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        schemaVersion: store.SCHEMA_VERSION,
        reportOptions: { ...REPORT_OPTIONS_SEED, deltaMode: legacy },
      }),
    );
    assert.equal(store.loadSettings().reportOptions.deltaMode, 'week', `${legacy} → week`);
  }
});

test('the two deltaMode values survive a load; anything else resets to the seed', () => {
  assert.deepEqual(DELTA_MODES, ['daily', 'week']);
  for (const mode of DELTA_MODES) {
    const mock = fresh();
    mock.setItem(
      SETTINGS_KEY,
      JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: { ...REPORT_OPTIONS_SEED, deltaMode: mode } }),
    );
    assert.equal(store.loadSettings().reportOptions.deltaMode, mode, `${mode} preserved`);
  }
  // 'toString' is the prototype-key probe: a plain-object alias map would resolve it to
  // an inherited function and persist garbage as a mode.
  for (const bad of ['weekly-mon', 'WEEK', '', 7, null, 'toString', 'constructor']) {
    const mock = fresh();
    mock.setItem(
      SETTINGS_KEY,
      JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: { ...REPORT_OPTIONS_SEED, deltaMode: bad } }),
    );
    assert.equal(store.loadSettings().reportOptions.deltaMode, 'week', `${String(bad)} → seed`);
  }
});

test('the new definitions default only fills an ABSENT key — a stored value is never flipped', () => {
  // Stored TRUE (an install that opted into منهجية الأرقام) must stay true…
  let mock = fresh();
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      schemaVersion: store.SCHEMA_VERSION,
      reportOptions: { excludeNoTat: false, slides: { execFunnel: true, definitions: true }, kpiCards: {}, labels: {}, deltaMode: 'daily' },
    }),
  );
  assert.equal(store.loadSettings().reportOptions.slides.definitions, true);
  // …while a doc predating the slide gets the new default (false).
  mock = fresh();
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      schemaVersion: store.SCHEMA_VERSION,
      reportOptions: { excludeNoTat: false, slides: { execFunnel: true, monthly: true, compliance: true, action: true }, kpiCards: {}, labels: {}, deltaMode: 'daily' },
    }),
  );
  const s = store.loadSettings();
  assert.equal(s.reportOptions.slides.definitions, false);
  assert.equal(s.reportOptions.slides.execFunnel, true); // other user values untouched
});

test('importSettings validates deltaMode, aliases the retired weekly values, round-trips daily', () => {
  fresh();
  store.loadSettings();
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 3, reportOptions: { deltaMode: 'weekly-mon' } })),
    /deltaMode/,
    'a value that was never a mode is still rejected outright',
  );
  // Every retired weekly value lands as canonical 'week'.
  for (const legacy of ['weekly', 'weekly-sun', 'weekly-thu']) {
    store.importSettings(JSON.stringify({ schemaVersion: 3, reportOptions: { deltaMode: legacy } }));
    assert.equal(store.loadSettings().reportOptions.deltaMode, 'week', `${legacy} imports as week`);
  }
  // A PRE-v7 backup's 'daily' is the old unchosen default, not a choice — the import
  // fixup drops it so the migrated week default stands (see the dedicated pre-v7 test
  // below; a deliberate post-v7 'daily' travels in a v7 backup and imports verbatim).
  store.importSettings(JSON.stringify({ schemaVersion: 3, reportOptions: { deltaMode: 'daily' } }));
  assert.equal(store.loadSettings().reportOptions.deltaMode, 'week');
  // And an export of the doc re-imports unchanged.
  const { blob } = store.exportSettings();
  assert.ok(blob);
});

// ---- reportOptions.autoDownloadFiles (R2) -----------------------------------
// Governs the MANUAL generate flow only: ON = the 4 files download by themselves after
// توليد التقارير (the shipped desktop behaviour), OFF = the operator picks them from the
// per-file buttons. STRICTLY independent from automation.autoDownload, which belongs to
// the unattended run — a presentation checkbox must never arm a background download.
test('autoDownloadFiles defaults to TRUE (absent = the shipped behaviour) and is seeded', () => {
  fresh();
  assert.equal(REPORT_OPTIONS_SEED.autoDownloadFiles, true, 'the seed ships the current behaviour');
  assert.equal(store.loadSettings().reportOptions.autoDownloadFiles, true);
  // A doc written before the flag existed backfills to ON, so nobody silently loses
  // their downloads on upgrade.
  const mock = fresh();
  const { autoDownloadFiles, ...noFlag } = REPORT_OPTIONS_SEED;
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: noFlag }),
  );
  assert.equal(store.loadSettings().reportOptions.autoDownloadFiles, true, 'absent → ON');
});

test('a stored autoDownloadFiles:false survives load and a save round-trip', () => {
  const mock = fresh();
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      schemaVersion: store.SCHEMA_VERSION,
      reportOptions: { ...REPORT_OPTIONS_SEED, autoDownloadFiles: false },
    }),
  );
  const s = store.loadSettings();
  assert.equal(s.reportOptions.autoDownloadFiles, false, 'the backfill must never flip a stored boolean');
  store.saveSettings(s);
  assert.equal(store.loadSettings().reportOptions.autoDownloadFiles, false, 'still off after a save/reload');
  assert.equal(JSON.parse(mock.getItem(SETTINGS_KEY)).reportOptions.autoDownloadFiles, false, 'persisted');
});

test('importSettings coerces autoDownloadFiles and still drops unknown reportOptions keys', () => {
  fresh();
  store.loadSettings();
  store.importSettings(JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    reportOptions: { autoDownloadFiles: 0, mysteryFlag: true },
  }));
  const ro = store.loadSettings().reportOptions;
  assert.equal(ro.autoDownloadFiles, false, '0 coerces to false like every other imported flag');
  assert.equal(ro.mysteryFlag, undefined, 'unknown reportOptions keys are still discarded');
  // …and a truthy import turns it back on.
  store.importSettings(JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    reportOptions: { autoDownloadFiles: 1 },
  }));
  assert.equal(store.loadSettings().reportOptions.autoDownloadFiles, true);
});

// ---- automation block (v4) --------------------------------------------------
const AUTOMATION_FLAGS = [
  'enabled', 'autoPull', 'autoGenerate', 'autoDownload', 'autoLabFiles',
  'autoEmailDrafts', 'autoAcceptTat',
];

test('first run seeds automation with every switch OFF (deep-copied)', () => {
  fresh();
  const s = store.loadSettings();
  assert.deepEqual(s.automation, AUTOMATION_SEED);
  // Copied, not the seed object itself (top-level + nested map).
  assert.notEqual(s.automation, AUTOMATION_SEED);
  assert.notEqual(s.automation.labRecipients, AUTOMATION_SEED.labRecipients);
  // The safety invariant: automation is opt-in, nothing is armed on a fresh install.
  for (const k of AUTOMATION_FLAGS) {
    assert.equal(s.automation[k], false, `${k} must default to false`);
  }
  assert.equal(s.automation.dailyTime, '08:00');
  assert.deepEqual(s.automation.labRecipients, {});
});

test('v3 stored doc migrates to v4: automation backfilled all-false, other fields preserved', () => {
  const mock = fresh();
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      schemaVersion: 3,
      tatLookup: { 'CUSTOM EDIT': 7 },
      snapshot: { asOf: '2026-07-01', numbers: { completed: 410 } },
      snapshotHistory: { '2026-07-01': { completed: 410 } },
      reportOptions: { ...REPORT_OPTIONS_SEED, excludeNoTat: true },
      grafana: { baseUrl: 'https://g/h', accessToken: 'tk', panelId: 12, enabled: true, dataKey: '' },
    }),
  );

  const s = store.loadSettings();
  assert.equal(s.schemaVersion, store.SCHEMA_VERSION);
  assert.deepEqual(s.automation, AUTOMATION_SEED);
  // Pre-v4 fields untouched by the bump.
  assert.equal(s.tatLookup['CUSTOM EDIT'], 7);
  assert.equal(s.snapshot.numbers.completed, 410);
  assert.deepEqual(s.snapshotHistory, { '2026-07-01': { completed: 410 } });
  assert.equal(s.reportOptions.excludeNoTat, true);
  assert.equal(s.grafana.panelId, 12);
  // Persisted with the bump so the migration runs only once.
  const stored = JSON.parse(mock.getItem(SETTINGS_KEY));
  assert.equal(stored.schemaVersion, store.SCHEMA_VERSION);
  assert.deepEqual(stored.automation, AUTOMATION_SEED);
});

test('v1/v2 stored docs chain all the way to v4 and gain the automation block', () => {
  for (const v of [1, 2]) {
    const mock = fresh();
    mock.setItem(SETTINGS_KEY, JSON.stringify({ schemaVersion: v, tatLookup: { X: 1 } }));
    const s = store.loadSettings();
    assert.equal(s.schemaVersion, store.SCHEMA_VERSION, `v${v} → current`);
    assert.deepEqual(s.automation, AUTOMATION_SEED, `v${v} automation backfilled`);
  }
});

test('load backfills missing automation subkeys while preserving user values', () => {
  const mock = fresh();
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      schemaVersion: 3,
      tatLookup: { X: 1 },
      // partial automation: two switches on, a bad dailyTime, a junk recipient value.
      automation: {
        enabled: true,
        autoPull: true,
        dailyTime: '99:99',
        labRecipients: { 'Lab A': 'a@x.com, b@x.com', 'Lab B': 5 },
      },
    }),
  );
  const s = store.loadSettings();
  // User values preserved.
  assert.equal(s.automation.enabled, true);
  assert.equal(s.automation.autoPull, true);
  // Missing switches backfilled false (never inferred from `enabled`).
  assert.equal(s.automation.autoGenerate, false);
  assert.equal(s.automation.autoDownload, false);
  assert.equal(s.automation.autoLabFiles, false);
  assert.equal(s.automation.autoEmailDrafts, false);
  assert.equal(s.automation.autoAcceptTat, false);
  // Malformed dailyTime resets to the seed; non-string recipient dropped.
  assert.equal(s.automation.dailyTime, '08:00');
  assert.deepEqual(s.automation.labRecipients, { 'Lab A': 'a@x.com, b@x.com' });
});

test('importSettings accepts a valid automation block and round-trips it', () => {
  fresh();
  store.loadSettings();

  const automation = {
    enabled: true,
    autoPull: true,
    autoGenerate: true,
    autoDownload: false,
    autoLabFiles: true,
    autoEmailDrafts: false,
    autoAcceptTat: true,
    dailyTime: '23:59',
    labRecipients: { 'Lab A': 'a@x.com, b@x.com', 'Lab B': '' },
  };
  store.importSettings(JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, automation }));

  store.__resetForTests();
  const after = store.loadSettings();
  assert.deepEqual(after.automation, automation);

  // Export → import round-trip preserves the block verbatim.
  const { blob } = store.exportSettings();
  return blob.text().then((text) => {
    fresh();
    store.loadSettings(); // fresh all-false defaults
    store.importSettings(text);
    assert.deepEqual(store.loadSettings().automation, automation);
  });
});

test('importSettings rejects a malformed automation block', () => {
  fresh();
  store.loadSettings();

  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 3, automation: [] })),
    /automation/,
  );
  // Non-boolean switch: NOT coerced — an unattended run must be armed deliberately.
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 3, automation: { enabled: 1 } })),
    /automation\.enabled/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 3, automation: { autoPull: 'yes' } })),
    /automation\.autoPull/,
  );
  // dailyTime must match HH:MM.
  for (const bad of ['8:00', '24:00', '12:60', 'morning', 830]) {
    assert.throws(
      () => store.importSettings(JSON.stringify({ schemaVersion: 3, automation: { dailyTime: bad } })),
      /automation\.dailyTime/,
      `dailyTime ${JSON.stringify(bad)} must be rejected`,
    );
  }
  // labRecipients must be a plain object of strings.
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 3, automation: { labRecipients: [] } })),
    /automation\.labRecipients/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 3, automation: { labRecipients: 'a@x.com' } })),
    /automation\.labRecipients/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 3, automation: { labRecipients: { 'Lab A': 5 } } })),
    /automation\.labRecipients/,
  );

  // Nothing landed: the stored block is still the all-false seed.
  assert.deepEqual(store.loadSettings().automation, AUTOMATION_SEED);
});

test('importSettings drops unknown automation subkeys before persisting', () => {
  fresh();
  store.loadSettings();

  store.importSettings(
    JSON.stringify({
      schemaVersion: 3,
      automation: {
        enabled: true,
        dailyTime: '07:30',
        labRecipients: { 'Lab A': 'a@x.com' },
        autoNuke: true, // unknown switch
        evil: { x: 1 }, // unknown subkey
      },
    }),
  );

  const a = store.loadSettings().automation;
  assert.deepEqual(Object.keys(a).sort(), [...AUTOMATION_FLAGS, 'dailyTime', 'labRecipients'].sort());
  assert.equal(a.enabled, true);
  assert.equal(a.dailyTime, '07:30');
  assert.equal(a.autoGenerate, false); // untouched seed switch survives the merge
  assert.equal(a.autoNuke, undefined);
  assert.equal(a.evil, undefined);
  assert.equal(a.labRecipients['Lab A'], 'a@x.com');
});

test('v4 stored doc migrates to v5: the definitions default is reset once, then user opt-in sticks', () => {
  const mock = fresh();
  // The real existing-install case: 'منهجية الأرقام' shipped ON by default, so every
  // pre-simplification install persisted definitions:true — a default nobody chose.
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      schemaVersion: 4,
      reportOptions: {
        excludeNoTat: false,
        slides: { execFunnel: true, monthly: true, compliance: true, action: true, definitions: true },
        kpiCards: {}, labels: {}, deltaMode: 'weekly',
      },
    }),
  );
  const s = store.loadSettings();
  assert.equal(s.schemaVersion, store.SCHEMA_VERSION, 'migrated to the current schema');
  assert.equal(s.reportOptions.slides.definitions, false, 'definitions default reset exactly once');
  assert.equal(s.reportOptions.slides.execFunnel, true, 'other slide choices untouched');
  // The chain must also run the standard backfill pass, and then the v6→v7 step: the
  // legacy bare 'weekly' lands on the canonical week-to-date mode either way.
  assert.equal(s.reportOptions.deltaMode, 'week', 'legacy weekly canonicalized');

  // Switching it back on afterwards is a real choice and must survive reloads.
  s.reportOptions.slides.definitions = true;
  store.saveSettings(s);
  assert.equal(store.loadSettings().reportOptions.slides.definitions, true, 'opt-in persists');
});

/* ------------------------------------------------------------------ *
 * v6 — settings.taskLog (the task-lifecycle state)
 *
 * taskLog is a map of stable task key -> { openOn:'YYYY-MM-DD', closedOn:'YYYY-MM-DD'|null }.
 * It is the same data class as cachedTracker (project-management content, never PHI).
 * An EMPTY map is load-bearing: it is exactly what makes tasks that were already مغلق
 * before this feature shipped stay off the deck, so the v5→v6 migration backfills {}
 * rather than inventing entries.
 * ------------------------------------------------------------------ */

const LOG_A = { openOn: '2026-07-01', closedOn: null };
const LOG_B = { openOn: '2026-06-20', closedOn: '2026-07-02' };

test('first run seeds an EMPTY taskLog (the pre-ship exclusion mechanism)', () => {
  fresh();
  const s = store.loadSettings();
  assert.equal(s.schemaVersion, 9, 'schema v9');
  assert.equal(store.SCHEMA_VERSION, 9);
  assert.ok(s.taskLog && typeof s.taskLog === 'object' && !Array.isArray(s.taskLog));
  assert.deepEqual(s.taskLog, {}, 'empty on first run — no closed task has an open appearance yet');
});

test('v5 stored doc migrates to the current schema and gains an empty taskLog, other fields preserved', () => {
  const mock = fresh();
  mock.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      schemaVersion: 5,
      tatLookup: { 'CBC': 2 },
      displayNames: { A: 'a' },
      scorecard: [{ lab: 'X' }],
      snapshotHistory: { '2026-07-08': { completed: 5 } },
      reportOptions: { slides: { execFunnel: false }, kpiCards: {}, labels: {}, deltaMode: 'daily' },
      automation: { ...AUTOMATION_SEED, enabled: true },
    }),
  );
  const s = store.loadSettings();
  assert.equal(s.schemaVersion, 9, 'migrated');
  assert.deepEqual(s.taskLog, {}, 'backfilled empty');
  assert.equal(s.tatLookup.CBC, 2, 'tatLookup preserved');
  assert.deepEqual(s.displayNames, { A: 'a' });
  assert.deepEqual(s.scorecard, [{ lab: 'X' }]);
  assert.deepEqual(s.snapshotHistory, { '2026-07-08': { completed: 5 } });
  assert.equal(s.reportOptions.slides.execFunnel, false, 'user slide choice untouched');
  assert.equal(s.automation.enabled, true, 'automation untouched');
  // The chain passes through v6→v7, which forces the new week-to-date default once.
  assert.equal(s.reportOptions.deltaMode, 'week', 'v6→v7 forces the new default');
  // Persisted, not just returned.
  assert.equal(JSON.parse(mock.getItem(SETTINGS_KEY)).schemaVersion, 9);
});

test('v1..v5 stored docs chain all the way to the current schema and land on the week default', () => {
  for (const v of [1, 2, 3, 4, 5]) {
    const mock = fresh();
    mock.setItem(SETTINGS_KEY, JSON.stringify({
      schemaVersion: v,
      tatLookup: { 'CBC': 2 },
      snapshot: { asOf: '2026-07-01', prevCompleted: 11 },
    }));
    const s = store.loadSettings();
    assert.equal(s.schemaVersion, 9, `v${v} → v9`);
    assert.deepEqual(s.taskLog, {}, `v${v} chain backfills taskLog`);
    assert.equal(s.tatLookup.CBC, 2, `v${v} keeps user data`);
    assert.equal(s.reportOptions.deltaMode, 'week', `v${v} chain lands on the week default`);
    assert.equal(s.reportOptions.autoDownloadFiles, true, `v${v} chain keeps auto-download ON`);
    // The rest of the chain still runs (v1's snapshot widening, v4→v5 definitions reset).
    assert.equal(s.snapshot.numbers.completed, 11, `v${v} snapshot widened`);
    assert.ok(s.automation && s.reportOptions && s.snapshotHistory);
  }
});

/* ------------------------------------------------------------------ *
 * v6 → v7: the week-to-date default has to REACH existing installs.
 * The ordinary backfill only fills ABSENT keys, so every install created
 * before 2026-08-04 carries a persisted deltaMode ('daily' or one of the
 * retired weekly values) that no backfill would ever touch — the default
 * change would be a no-op on exactly the installs that matter. So the
 * migration FORCES it once, precedent migrateV4toV5 (definitions slide).
 * It runs once: choosing 'daily' afterwards sticks, because a same-version
 * load never rewrites a stored value again.
 * ------------------------------------------------------------------ */
test("v6 → v7 forces a stored 'daily' to 'week' exactly once, then a manual 'daily' sticks", () => {
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: 6,
    tatLookup: { 'CBC': 2 },
    reportOptions: { excludeNoTat: false, slides: {}, kpiCards: {}, labels: {}, deltaMode: 'daily' },
    taskLog: { 'int|أ': { openOn: '2026-07-01', closedOn: null } },
  }));
  const s = store.loadSettings();
  assert.equal(s.schemaVersion, 9, 'stamped with the current schema (v6→v7→v8→v9)');
  assert.equal(s.reportOptions.deltaMode, 'week', 'the new default reached the existing install');
  assert.equal(s.tatLookup.CBC, 2, 'user data untouched');
  assert.deepEqual(s.taskLog, { 'int|أ': { openOn: '2026-07-01', closedOn: null } }, 'taskLog untouched');
  assert.equal(JSON.parse(mock.getItem(SETTINGS_KEY)).reportOptions.deltaMode, 'week', 'persisted');

  // The user goes back to daily: it must SURVIVE every later load.
  s.reportOptions.deltaMode = 'daily';
  store.saveSettings(s);
  assert.equal(store.loadSettings().reportOptions.deltaMode, 'daily', 'the manual choice sticks');
  assert.equal(store.loadSettings().reportOptions.deltaMode, 'daily', 'and stays stuck on a second load');
});

test("v6 → v7 also migrates the retired weekly values to 'week'", () => {
  for (const legacy of ['weekly', 'weekly-sun', 'weekly-thu']) {
    const mock = fresh();
    mock.setItem(SETTINGS_KEY, JSON.stringify({
      schemaVersion: 6,
      reportOptions: { excludeNoTat: false, slides: {}, kpiCards: {}, labels: {}, deltaMode: legacy },
    }));
    const s = store.loadSettings();
    assert.equal(s.schemaVersion, 9);
    assert.equal(s.reportOptions.deltaMode, 'week', `${legacy} → week`);
  }
});

test('a stored taskLog survives a same-version load and a save round-trip', () => {
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: 7,
    taskLog: { 'int|أ': { ...LOG_A }, 'ext|ب': { ...LOG_B } },
  }));
  const s = store.loadSettings();
  assert.deepEqual(s.taskLog, { 'int|أ': LOG_A, 'ext|ب': LOG_B }, 'load must never blank an existing log');

  // The pipeline/generate write path: mutate the doc and save it back.
  s.taskLog['ext|ج'] = { openOn: '2026-07-09', closedOn: null };
  store.saveSettings(s);
  const back = store.loadSettings();
  assert.deepEqual(back.taskLog, {
    'int|أ': LOG_A, 'ext|ب': LOG_B, 'ext|ج': { openOn: '2026-07-09', closedOn: null },
  });
  assert.deepEqual(JSON.parse(mock.getItem(SETTINGS_KEY)).taskLog, back.taskLog, 'persisted');
});

test('importSettings rejects every malformed taskLog shape (and an oversized one)', () => {
  fresh();
  store.loadSettings();
  const bad = [
    [],                                                   // not an object
    'nope',
    42,
    { 'int|a': 'nope' },                                  // entry not an object
    { 'int|a': [] },
    { 'int|a': null },
    { 'int|a': { closedOn: null } },                      // openOn missing
    { 'int|a': { openOn: '2026-7-1', closedOn: null } },  // openOn not ISO
    { 'int|a': { openOn: 20260701, closedOn: null } },
    { 'int|a': { openOn: '2026-07-01', closedOn: 'soon' } }, // closedOn neither ISO nor null
    { 'int|a': { openOn: '2026-07-01', closedOn: 5 } },
  ];
  for (const taskLog of bad) {
    assert.throws(
      () => store.importSettings(JSON.stringify({ schemaVersion: 7, taskLog })),
      /taskLog/,
      `should reject ${JSON.stringify(taskLog)}`,
    );
  }
  // Hard cap: a backup carrying more than 300 entries is not a backup this app wrote.
  const huge = {};
  for (let i = 0; i < 301; i += 1) huge[`int|k${i}`] = { openOn: '2026-07-01', closedOn: null };
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 7, taskLog: huge })),
    /taskLog/,
    'over the 300-entry cap',
  );
  // …and exactly 300 is fine.
  delete huge['int|k300'];
  assert.doesNotThrow(() => store.importSettings(JSON.stringify({ schemaVersion: 7, taskLog: huge })));
  assert.equal(Object.keys(store.loadSettings().taskLog).length, 300);
});

test('importSettings round-trips a valid taskLog with a per-key union', () => {
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: 7,
    taskLog: { 'int|أ': { ...LOG_A }, 'ext|ب': { ...LOG_B } },
  }));
  store.loadSettings();
  store.importSettings(JSON.stringify({
    schemaVersion: 7,
    taskLog: {
      'ext|ب': { openOn: '2026-06-20', closedOn: null },  // import wins on the shared key
      'ext|ج': { openOn: '2026-07-05', closedOn: null },  // new key
    },
  }));
  const s = store.loadSettings();
  assert.deepEqual(s.taskLog, {
    'int|أ': LOG_A,                                        // untouched local entry survives
    'ext|ب': { openOn: '2026-06-20', closedOn: null },      // import wins
    'ext|ج': { openOn: '2026-07-05', closedOn: null },
  });
});

test('pickImportKeys sanitizes taskLog entries down to {openOn, closedOn}', () => {
  fresh();
  store.loadSettings();
  store.importSettings(JSON.stringify({
    schemaVersion: 7,
    taskLog: { 'int|أ': { openOn: '2026-07-01', closedOn: null, note: 'junk', shownOn: 3 } },
  }));
  assert.deepEqual(store.loadSettings().taskLog, { 'int|أ': { openOn: '2026-07-01', closedOn: null } });
});

test('export → import → export is identity for the taskLog', async () => {
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: 7,
    taskLog: { 'int|أ': { ...LOG_A }, 'ext|ب': { ...LOG_B } },
  }));
  store.loadSettings();
  const first = JSON.parse(await store.exportSettings().blob.text());
  assert.deepEqual(first.taskLog, { 'int|أ': LOG_A, 'ext|ب': LOG_B }, 'the export carries the log');

  fresh(); // a different device
  store.loadSettings();
  store.importSettings(JSON.stringify(first));
  const second = JSON.parse(await store.exportSettings().blob.text());
  assert.deepEqual(second.taskLog, first.taskLog, 'restored verbatim on the new device');
});

test('importSettings accepts v4 and v5 backups (version-gate fix)', () => {
  // PRE-EXISTING BUG, fixed with this feature: validateImport gated on {1,2,3,current},
  // so every schema bump silently orphaned the previous version's backups — v4 was
  // already unimportable and v5 would have joined it. IMPORTABLE_VERSIONS = {1..8, current}.
  for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    fresh();
    store.loadSettings();
    assert.doesNotThrow(
      () => store.importSettings(JSON.stringify({ schemaVersion: v, displayNames: { [`v${v}`]: 'x' } })),
      `v${v} backup must import`,
    );
    assert.equal(store.loadSettings().displayNames[`v${v}`], 'x', `v${v} content landed`);
    assert.equal(store.loadSettings().schemaVersion, 9, 'and the doc is stamped current');
  }
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 0 })),
    /إصدار المخطط غير مدعوم|schemaVersion/,
  );
  assert.throws(
    () => store.importSettings(JSON.stringify({ schemaVersion: 99 })),
    /إصدار المخطط غير مدعوم|schemaVersion/,
  );
});

test('importing a pre-v7 backup does not undo the week-default migration', () => {
  fresh();
  // Device is migrated: deltaMode 'week'. A v6 backup carries the old default 'daily'
  // — a value nobody chose (migrateV6toV7's premise). The import must drop it so the
  // device's migrated 'week' stands; saveSettings stamps schemaVersion 7, so nothing
  // would ever re-run the migration otherwise.
  store.loadSettings();
  store.importSettings(JSON.stringify({
    schemaVersion: 6,
    reportOptions: { excludeNoTat: true, slides: {}, kpiCards: {}, labels: {}, deltaMode: 'daily' },
  }));
  const s = store.loadSettings();
  assert.equal(s.reportOptions.deltaMode, 'week', 'pre-v7 deltaMode dropped, migrated default stands');
  assert.equal(s.reportOptions.excludeNoTat, true, 'the rest of the backup imported normally');

  // A CURRENT (v7) backup carrying a deliberate 'daily' imports untouched.
  store.importSettings(JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    reportOptions: { excludeNoTat: false, slides: {}, kpiCards: {}, labels: {}, deltaMode: 'daily' },
  }));
  assert.equal(store.loadSettings().reportOptions.deltaMode, 'daily', 'post-v7 choice imports verbatim');
});

/* ------------------------------------------------------------------ *
 * v7 → v8: the cover-title rename has to REACH installs that used the
 * labels editor.
 *
 * build-spec's labelOf reads `reportOptions.labels[key] ?? DEFAULT_LABELS[key]`,
 * so a STORED override beats the default outright — and the labels editor
 * (ui/screen-review.js) persists one for every field the user typed into.
 * Renaming DEFAULT_LABELS.coverTitle to 'تقرير مسبار الأسبوعي' therefore reaches
 * everyone EXCEPT those installs, which would print the daily title forever:
 * backfillReportOptions only fills an ABSENT key, it never clears a stored one.
 * So the migration DELETES the override — restoring the real "no override"
 * state, so the cover also follows any FUTURE rename — and only when it matches
 * the old default EXACTLY, so a genuine edit survives. Precedent: migrateV6toV7
 * (deltaMode) and migrateV4toV5 (definitions slide).
 *
 * The old default is a LITERAL here on purpose, exactly as store.js pins it:
 * importing it from build-spec would make these cases chase whatever the current
 * default is and stop testing the migration at all.
 * ------------------------------------------------------------------ */
const V7_COVER_TITLE = 'تقرير مسبار اليومي';

test('v7 → v8 deletes a coverTitle override that is only the old default, exactly once', () => {
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: 7,
    tatLookup: { 'CBC': 2 },
    reportOptions: {
      excludeNoTat: false, slides: {}, kpiCards: {}, deltaMode: 'week',
      labels: { coverTitle: V7_COVER_TITLE, kpiCompleted: 'فحوصات منجزة' },
    },
    taskLog: { 'int|أ': { openOn: '2026-07-01', closedOn: null } },
  }));
  const s = store.loadSettings();
  assert.equal(s.schemaVersion, 9, 'stamped current (v7→v8→v9)');
  // DELETED, not overwritten with the new title — the key must be absent so the cover
  // falls through to DEFAULT_LABELS today AND after the next rename.
  assert.ok(!('coverTitle' in s.reportOptions.labels), 'the stale override is gone, not rewritten');
  assert.equal(s.reportOptions.labels.kpiCompleted, 'فحوصات منجزة', 'other label overrides untouched');
  assert.equal(s.tatLookup.CBC, 2, 'user data untouched');
  assert.deepEqual(s.taskLog, { 'int|أ': { openOn: '2026-07-01', closedOn: null } }, 'taskLog untouched');
  assert.equal(s.reportOptions.deltaMode, 'week', 'the v7 deltaMode choice untouched');
  // Persisted with the bump, so this runs ONCE.
  const stored = JSON.parse(mock.getItem(SETTINGS_KEY));
  assert.equal(stored.schemaVersion, 9, 'persisted');
  assert.ok(!('coverTitle' in stored.reportOptions.labels), 'persisted without the override');

  // Typing the old title back in afterwards is a real choice and must SURVIVE every
  // later load — a same-version load never rewrites a stored value again.
  s.reportOptions.labels.coverTitle = V7_COVER_TITLE;
  store.saveSettings(s);
  assert.equal(store.loadSettings().reportOptions.labels.coverTitle, V7_COVER_TITLE, 'the manual choice sticks');
  assert.equal(store.loadSettings().reportOptions.labels.coverTitle, V7_COVER_TITLE, 'and stays stuck on a second load');
});

test('v7 → v8 leaves any coverTitle that is not byte-for-byte the old default', () => {
  // Exact match only. The near-misses are built by concatenation, not retyped, so an
  // invisible difference in this RTL string can never be what makes the case pass.
  const CUSTOM = [
    'عنوان الغلاف الخاص بي',   // a genuinely different title
    `${V7_COVER_TITLE} `,      // trailing space
    ` ${V7_COVER_TITLE}`,      // leading space
    `${V7_COVER_TITLE}!`,      // one character longer
    '',                        // empty is still a stored value, not the old default
  ];
  for (const custom of CUSTOM) {
    const mock = fresh();
    mock.setItem(SETTINGS_KEY, JSON.stringify({
      schemaVersion: 7,
      reportOptions: {
        excludeNoTat: false, slides: {}, kpiCards: {}, deltaMode: 'week',
        labels: { coverTitle: custom },
      },
    }));
    const s = store.loadSettings();
    assert.equal(s.schemaVersion, 9);
    assert.equal(s.reportOptions.labels.coverTitle, custom, `${JSON.stringify(custom)} survives`);
    assert.equal(
      JSON.parse(mock.getItem(SETTINGS_KEY)).reportOptions.labels.coverTitle, custom, 'and is persisted',
    );
  }
});

test('v7 → v8 tolerates an absent/malformed reportOptions or labels', () => {
  // migrateSnapshotShape guarantees both containers before the delete, but a doc that
  // reached storage hand-edited must not make the DELETE the thing that throws.
  const CASES = [
    ['no reportOptions at all', undefined],
    ['reportOptions without labels', { excludeNoTat: false, slides: {}, kpiCards: {}, deltaMode: 'week' }],
    ['labels null', { labels: null }],
    ['labels not an object', { labels: 'nope' }],
    ['labels without coverTitle', { labels: { kpiCompleted: 'فحوصات منجزة' } }],
  ];
  for (const [name, ro] of CASES) {
    const mock = fresh();
    const doc = { schemaVersion: 7, tatLookup: { X: 1 } };
    if (ro !== undefined) doc.reportOptions = ro;
    mock.setItem(SETTINGS_KEY, JSON.stringify(doc));

    const s = store.loadSettings();
    assert.equal(s.schemaVersion, 9, `${name} → v9`);
    assert.ok(s.reportOptions && typeof s.reportOptions.labels === 'object' && s.reportOptions.labels !== null,
      `${name}: labels container backfilled`);
    // The migration only ever REMOVES — it never invents a title.
    assert.ok(!('coverTitle' in s.reportOptions.labels), `${name}: no title invented`);
    assert.equal(s.tatLookup.X, 1, `${name}: user data untouched`);
  }
  // The one label present in the last case is not collateral damage.
  assert.equal(store.loadSettings().reportOptions.labels.kpiCompleted, 'فحوصات منجزة');
});

test('every migration entry point (v1..v7) lands on the current schema and clears the stale title', () => {
  // The whole chain must reach migrateV7toV8 — a wrapper that forgets the new step
  // would leave exactly the oldest installs on the daily cover title.
  for (const v of [1, 2, 3, 4, 5, 6, 7]) {
    const mock = fresh();
    mock.setItem(SETTINGS_KEY, JSON.stringify({
      schemaVersion: v,
      tatLookup: { 'CBC': 2 },
      snapshot: { asOf: '2026-07-01', prevCompleted: 11 },
      reportOptions: { labels: { coverTitle: V7_COVER_TITLE } },
    }));
    const s = store.loadSettings();
    assert.equal(s.schemaVersion, 9, `v${v} → v9`);
    assert.ok(!('coverTitle' in s.reportOptions.labels), `v${v} chain reaches the v7→v8 step`);
    // Every earlier step still runs: v1's snapshot widening, the v4→v5 definitions
    // reset, the v5→v6 taskLog backfill and the v6→v7 week default.
    assert.equal(s.tatLookup.CBC, 2, `v${v} keeps user data`);
    assert.equal(s.snapshot.numbers.completed, 11, `v${v} snapshot widened`);
    assert.equal(s.reportOptions.slides.definitions, false, `v${v} definitions still reset`);
    assert.deepEqual(s.taskLog, {}, `v${v} still backfills taskLog`);
    assert.equal(s.reportOptions.deltaMode, 'week', `v${v} still lands on the week default`);
    assert.equal(JSON.parse(mock.getItem(SETTINGS_KEY)).schemaVersion, 9, `v${v} persisted`);
  }
});

test('importing a pre-rename backup does not resurrect the retired daily cover title', () => {
  // The IMPORT twin of the load-path migration above, and the exact sibling of
  // 'importing a pre-v7 backup does not undo the week-default migration': migrate()
  // only runs on a doc read from STORAGE, so an imported v1-v7 backup carrying the old
  // default as a labels override would merge import-wins and get stamped
  // SCHEMA_VERSION — the stale title would then print forever, with nothing left to
  // clear it. Cutoff is <= 7 here (v7 was the last daily-title schema), one higher than
  // the deltaMode fixup's <= 6.
  const mock = fresh();
  // Device is a MIGRATED v7 install: coverTitle already cleared, another label kept.
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: 7,
    reportOptions: {
      excludeNoTat: false, slides: {}, kpiCards: {}, deltaMode: 'week',
      labels: { coverTitle: V7_COVER_TITLE, kpiCompleted: 'فحوصات منجزة' },
    },
  }));
  assert.ok(!('coverTitle' in store.loadSettings().reportOptions.labels), 'precondition: migrated');

  store.importSettings(JSON.stringify({
    schemaVersion: 7,
    tatLookup: { 'CBC': 9 },
    reportOptions: { excludeNoTat: true, slides: {}, kpiCards: {}, labels: { coverTitle: V7_COVER_TITLE } },
  }));
  const s = store.loadSettings();
  assert.ok(!('coverTitle' in s.reportOptions.labels), 'stale override dropped, migrated state stands');
  assert.equal(s.reportOptions.labels.kpiCompleted, 'فحوصات منجزة', "the device's other override survives");
  assert.equal(s.reportOptions.excludeNoTat, true, 'the rest of the backup imported normally');
  assert.equal(s.tatLookup.CBC, 9, 'user data imported normally');
  assert.equal(s.schemaVersion, 9, 'stamped current');
  assert.ok(
    !('coverTitle' in JSON.parse(mock.getItem(SETTINGS_KEY)).reportOptions.labels),
    'and persisted without it — nothing would clear it on a later load',
  );

  // Every pre-rename version, not just the newest one: the oldest backups are the ones
  // most likely to carry the retired default.
  for (const v of [1, 2, 3, 4, 5, 6, 7]) {
    fresh();
    store.loadSettings();
    store.importSettings(JSON.stringify({
      schemaVersion: v,
      reportOptions: { slides: {}, kpiCards: {}, labels: { coverTitle: V7_COVER_TITLE } },
    }));
    assert.ok(
      !('coverTitle' in store.loadSettings().reportOptions.labels),
      `v${v} backup does not resurrect the daily title`,
    );
  }

  // A title retyped in the labels editor AFTER v8 shipped is a real choice: it travels
  // in a v8 backup and imports verbatim, even when it happens to be the old default.
  fresh();
  store.loadSettings();
  store.importSettings(JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    reportOptions: { slides: {}, kpiCards: {}, labels: { coverTitle: V7_COVER_TITLE } },
  }));
  assert.equal(
    store.loadSettings().reportOptions.labels.coverTitle, V7_COVER_TITLE,
    'post-rename choice imports verbatim',
  );

  // And any OTHER title imports verbatim from any version — exact match only, same
  // scoping as migrateV7toV8. Concatenated, never retyped: an invisible difference in
  // this RTL string must not be what makes the case pass.
  for (const custom of ['عنوان الغلاف الخاص بي', `${V7_COVER_TITLE} `, `${V7_COVER_TITLE}!`, '']) {
    fresh();
    store.loadSettings();
    store.importSettings(JSON.stringify({
      schemaVersion: 6,
      reportOptions: { slides: {}, kpiCards: {}, labels: { coverTitle: custom } },
    }));
    assert.equal(
      store.loadSettings().reportOptions.labels.coverTitle, custom,
      `${JSON.stringify(custom)} imports from a v6 backup`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * v8 → v9: the TURNAROUND block joins the delivered monthly slide.
 *
 * The navy overall-average card + الفعلي/المتوقع line chart shipped OPT-IN with
 * kpiCards.turnaround seeded FALSE, so every install that has ever run the app
 * persisted that false — "a default nobody chose". Round 6 makes the block part
 * of the delivered deck (the user's own historic layout), and the ordinary
 * backfill only fills ABSENT keys, so the new seed alone would reach nobody who
 * already uses the app. migrateV8toV9 therefore FORCES it true ONCE. Third
 * repeat of the pattern: migrateV4toV5 (definitions), migrateV6toV7 (deltaMode),
 * migrateV7toV8 (coverTitle).
 *
 * REVEAL ONLY: the engine's turnaround numbers are untouched by this schema
 * bump — the block was always computed, it was just not drawn.
 * ------------------------------------------------------------------ */

test('v8 → v9 forces a stored turnaround:false to true, exactly once, then a manual OFF sticks', () => {
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: 8,
    tatLookup: { 'CBC': 2 },
    reportOptions: {
      excludeNoTat: true, slides: { definitions: true }, deltaMode: 'daily', labels: { kpiCompleted: 'فحوصات منجزة' },
      kpiCards: { total: false, completed: true, turnaround: false },
    },
    taskLog: { 'int|أ': { openOn: '2026-07-01', closedOn: null } },
  }));
  const s = store.loadSettings();
  assert.equal(s.schemaVersion, 9, 'stamped v9');
  assert.equal(s.reportOptions.kpiCards.turnaround, true, 'the new default reached the existing install');
  // Everything else the user actually chose is untouched — this migration writes ONE key.
  assert.equal(s.reportOptions.kpiCards.total, false, 'other card choices untouched');
  assert.equal(s.reportOptions.kpiCards.completed, true);
  assert.equal(s.reportOptions.excludeNoTat, true, 'excludeNoTat untouched');
  assert.equal(s.reportOptions.slides.definitions, true, 'a v8 doc is past v4→v5: the slide choice is a real one');
  assert.equal(s.reportOptions.deltaMode, 'daily', 'a v8 doc is past v6→v7: the daily choice is a real one');
  assert.equal(s.reportOptions.labels.kpiCompleted, 'فحوصات منجزة', 'label overrides untouched');
  assert.equal(s.tatLookup.CBC, 2, 'user data untouched');
  assert.deepEqual(s.taskLog, { 'int|أ': { openOn: '2026-07-01', closedOn: null } }, 'taskLog untouched');
  // Persisted with the bump, which is what makes the force run ONCE.
  const stored = JSON.parse(mock.getItem(SETTINGS_KEY));
  assert.equal(stored.schemaVersion, 9, 'persisted');
  assert.equal(stored.reportOptions.kpiCards.turnaround, true, 'persisted turned on');

  // Unticking the box afterwards is a real choice and must SURVIVE every later load: the
  // stored doc is now at 9, so migrate() takes the same-version branch (softening +
  // backfill only, which never flips a stored boolean) and never re-forces.
  s.reportOptions.kpiCards.turnaround = false;
  store.saveSettings(s);
  assert.equal(store.loadSettings().reportOptions.kpiCards.turnaround, false, 'the manual OFF sticks');
  assert.equal(store.loadSettings().reportOptions.kpiCards.turnaround, false, 'and stays off on a second load');
  assert.equal(
    JSON.parse(mock.getItem(SETTINGS_KEY)).reportOptions.kpiCards.turnaround, false,
    'and is persisted off — no load rewrites it',
  );
});

test('v8 → v9 tolerates an absent/malformed reportOptions or kpiCards', () => {
  // migrateSnapshotShape guarantees both containers before the write, but a doc that
  // reached storage hand-edited must not make the WRITE the thing that throws.
  const CASES = [
    ['no reportOptions at all', undefined],
    ['reportOptions without kpiCards', { excludeNoTat: false, slides: {}, labels: {}, deltaMode: 'week' }],
    ['kpiCards null', { kpiCards: null }],
    ['kpiCards not an object', { kpiCards: 'nope' }],
    ['kpiCards without the turnaround key', { kpiCards: { total: false } }],
  ];
  for (const [name, ro] of CASES) {
    const mock = fresh();
    const doc = { schemaVersion: 8, tatLookup: { X: 1 } };
    if (ro !== undefined) doc.reportOptions = ro;
    mock.setItem(SETTINGS_KEY, JSON.stringify(doc));

    const s = store.loadSettings();
    assert.equal(s.schemaVersion, 9, `${name} → v9`);
    assert.equal(s.reportOptions.kpiCards.turnaround, true, `${name}: the block is on`);
    assert.equal(s.tatLookup.X, 1, `${name}: user data untouched`);
    assert.equal(
      JSON.parse(mock.getItem(SETTINGS_KEY)).reportOptions.kpiCards.turnaround, true, `${name}: persisted`,
    );
  }
  // The one card choice present in the last case is not collateral damage.
  assert.equal(store.loadSettings().reportOptions.kpiCards.total, false);
});

test('every migration entry point (v1..v8) lands on schemaVersion 9 with the turnaround block ON', () => {
  // The whole chain must reach migrateV8toV9 — a wrapper that forgets the new step would
  // leave exactly the oldest installs without the block the user asked to see.
  for (const v of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const mock = fresh();
    mock.setItem(SETTINGS_KEY, JSON.stringify({
      schemaVersion: v,
      tatLookup: { 'CBC': 2 },
      snapshot: { asOf: '2026-07-01', prevCompleted: 11 },
      reportOptions: { kpiCards: { turnaround: false }, labels: { coverTitle: V7_COVER_TITLE } },
    }));
    const s = store.loadSettings();
    assert.equal(s.schemaVersion, 9, `v${v} → v9`);
    assert.equal(s.reportOptions.kpiCards.turnaround, true, `v${v} chain reaches the v8→v9 step`);
    // Every earlier step still runs: v1's snapshot widening, the v4→v5 definitions reset,
    // the v5→v6 taskLog backfill, the v6→v7 week default and the v7→v8 title clear.
    assert.equal(s.tatLookup.CBC, 2, `v${v} keeps user data`);
    assert.equal(s.snapshot.numbers.completed, 11, `v${v} snapshot widened`);
    assert.deepEqual(s.taskLog, {}, `v${v} still backfills taskLog`);
    assert.equal(JSON.parse(mock.getItem(SETTINGS_KEY)).schemaVersion, 9, `v${v} persisted`);
    // v8 is PAST the three older forces, so they must NOT re-run on it; v1-v7 still get them.
    if (v <= 7) {
      assert.equal(s.reportOptions.slides.definitions, false, `v${v} definitions still reset`);
      assert.equal(s.reportOptions.deltaMode, 'week', `v${v} still lands on the week default`);
      assert.ok(!('coverTitle' in s.reportOptions.labels), `v${v} still clears the stale title`);
    } else {
      assert.equal(s.reportOptions.labels.coverTitle, V7_COVER_TITLE, 'a v8 doc keeps its own title');
    }
  }
});

test('importing a pre-v9 backup does not hide the turnaround block again', () => {
  // The IMPORT twin of the load-path migration above, and the exact sibling of the
  // deltaMode and coverTitle import fixups: migrate() only runs on a doc read from
  // STORAGE, so a v1-v8 backup carrying the retired default would merge import-wins and
  // get stamped SCHEMA_VERSION — the block would then stay hidden on every future load,
  // with nothing left to reveal it. Cutoff is <= 8 here (v8 was the last opt-in schema),
  // one higher than the cover-rename fixup's <= 7.
  const mock = fresh();
  // Device is a MIGRATED v8 install: the block is on, one other card deliberately off.
  mock.setItem(SETTINGS_KEY, JSON.stringify({
    schemaVersion: 8,
    reportOptions: {
      excludeNoTat: false, slides: {}, labels: {}, deltaMode: 'week',
      kpiCards: { turnaround: false, total: false },
    },
  }));
  assert.equal(store.loadSettings().reportOptions.kpiCards.turnaround, true, 'precondition: migrated');

  store.importSettings(JSON.stringify({
    schemaVersion: 8,
    tatLookup: { 'CBC': 9 },
    reportOptions: { excludeNoTat: true, slides: {}, labels: {}, kpiCards: { turnaround: false, completed: false } },
  }));
  const s = store.loadSettings();
  assert.equal(s.reportOptions.kpiCards.turnaround, true, 'retired default dropped, migrated state stands');
  assert.equal(s.reportOptions.kpiCards.completed, false, "the backup's OTHER card choices import normally");
  assert.equal(s.reportOptions.kpiCards.total, false, "the device's own card choice survives");
  assert.equal(s.reportOptions.excludeNoTat, true, 'the rest of the backup imported normally');
  assert.equal(s.tatLookup.CBC, 9, 'user data imported normally');
  assert.equal(s.schemaVersion, 9, 'stamped current');
  assert.equal(
    JSON.parse(mock.getItem(SETTINGS_KEY)).reportOptions.kpiCards.turnaround, true,
    'and persisted ON — nothing would turn it on again on a later load',
  );

  // Every pre-v9 version, not just the newest: the oldest backups are the likeliest to
  // carry the retired default.
  for (const v of [1, 2, 3, 4, 5, 6, 7, 8]) {
    fresh();
    store.loadSettings();
    store.importSettings(JSON.stringify({
      schemaVersion: v,
      reportOptions: { slides: {}, labels: {}, kpiCards: { turnaround: false } },
    }));
    assert.equal(
      store.loadSettings().reportOptions.kpiCards.turnaround, true,
      `v${v} backup does not hide the block`,
    );
  }

  // A pre-v9 TRUE was a deliberate opt-in: it is not the retired default, so the fixup
  // leaves it alone (and it agrees with the migrated state anyway).
  fresh();
  store.loadSettings();
  store.importSettings(JSON.stringify({
    schemaVersion: 7,
    reportOptions: { slides: {}, labels: {}, kpiCards: { turnaround: true } },
  }));
  assert.equal(store.loadSettings().reportOptions.kpiCards.turnaround, true, 'a pre-v9 opt-in imports untouched');

  // An OFF chosen AFTER v9 shipped is a real choice: it travels in a v9 backup and imports
  // verbatim. This is the whole point of listing 'turnaround' in REPORT_OPTION_CARD_KEYS —
  // while the key was unlisted, pickImportKeys dropped it and the choice never crossed
  // devices at all.
  fresh();
  store.loadSettings();
  store.importSettings(JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    reportOptions: { slides: {}, labels: {}, kpiCards: { turnaround: false } },
  }));
  assert.equal(
    store.loadSettings().reportOptions.kpiCards.turnaround, false,
    'post-v9 choice imports verbatim (and coerces like every other card flag)',
  );
  // …and it coerces, exactly like the other card flags.
  store.importSettings(JSON.stringify({
    schemaVersion: store.SCHEMA_VERSION,
    reportOptions: { kpiCards: { turnaround: 1 } },
  }));
  assert.equal(store.loadSettings().reportOptions.kpiCards.turnaround, true, '1 coerces to true');
});
