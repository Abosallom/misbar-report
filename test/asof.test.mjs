// test/asof.test.mjs — `node --test`
// As-of reconstruction of the report's 10 headline numbers from row timestamps.
//
// CROWN PROOF (identity): at a date whose CURRENT state IS its as-of state (no
// timestamp later than that date), computeNumbersAsOf reproduces the ENGINE's own
// 10 numbers exactly. The 2026-07-09 golden snapshot (GOLDEN_ORDERS) is such a
// dataset, so identity there is exact and ties to the published report. The
// sample CSV is a LATER (2026-07-19) export carrying post-report updates, so the
// same identity is asserted at a SATURATED as-of past its last timestamp; at
// 2026-07-09 the as-of numbers intentionally reconstruct the historical snapshot
// (fewer completed than the raw engine over the full export) — the feature working.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeNumbersAsOf, buildWeekNumbers, NUMBER_KEYS } from '../src/engine/asof.js';
import { compute } from '../src/engine/engine.js';
import { GOLDEN_ORDERS } from './fixtures/golden-orders.js';
import { TAT_LOOKUP } from '../src/seeds/tat-lookup.js';
import { SNAPSHOT_SEED } from '../src/seeds/defaults.js';
import { GOLDEN_ASOF } from './fixtures/golden-expected.js';

// The 10 published numbers pulled out of an EngineOutput — a copy of
// screen-generate.js's currentNumbersOf, so the identity is against the SAME
// projection the app persists as its snapshot.
function currentNumbersOf(kpi) {
  const t = kpi.totals; const f = kpi.funnel; const b = kpi.buckets;
  return {
    total: t.total, collected: f.collected, dispatched: f.dispatched, received: f.received,
    completed: b.completed, rejected: b.rejected, awaitingDispatch: b.awaitingDispatch,
    shippedNotReceived: b.shippedNotReceived, awaitingResults: b.awaitingResults, lateNoResult: b.lateNoResult,
  };
}
const engineNumbers = (rows, asOf) => currentNumbersOf(compute(rows, TAT_LOOKUP, { asOf }));

// ---- optional sample CSV (skip-if-missing, mirrors ingest.test.mjs) ----------
const HERE = dirname(fileURLToPath(import.meta.url));
const firstExisting = (...paths) => paths.find((p) => existsSync(p)) || null;
const CSV_PATH = firstExisting(
  join(HERE, 'samples/orders.csv'),
  '/Users/aziz/KAMC Order details-data-2026-07-19 10_23_40.csv',
);
let csvRows = null;
if (CSV_PATH) {
  const require = createRequire(import.meta.url);
  const Papa = require('../vendor/papaparse.min.js');
  const { parseKamcCsv } = await import('../src/ingest/csv.js');
  csvRows = parseKamcCsv(readFileSync(CSV_PATH, 'utf8'), Papa).rows;
}
const SKIP_CSV = { skip: !csvRows };

// =============================================================================
// 1. IDENTITY — the crown proof
// =============================================================================

test('CROWN identity: as-of @ 2026-07-09 == engine\'s own 10 numbers (GOLDEN_ORDERS)', () => {
  // GOLDEN_ORDERS is the true 07-09 snapshot: no timestamp is later than the
  // report date, so as-of state == current state and every key must match exactly.
  const eng = engineNumbers(GOLDEN_ORDERS, GOLDEN_ASOF);
  const { numbers } = computeNumbersAsOf({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: GOLDEN_ASOF });
  for (const k of NUMBER_KEYS) {
    assert.equal(numbers[k], eng[k], `key ${k}: as-of ${numbers[k]} !== engine ${eng[k]}`);
  }
  assert.deepEqual(numbers, eng);
  // And it equals the published 09-07 snapshot the app ships as its baseline.
  assert.deepEqual(numbers, SNAPSHOT_SEED.numbers);
});

test('CROWN identity: approx flags total (cancelled-in-range) and rejected (no reject timestamp)', () => {
  const { approx } = computeNumbersAsOf({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: GOLDEN_ASOF });
  // Both are principled approximations: cancellation & rejection carry no timestamp.
  assert.equal(approx.total, true);
  assert.equal(approx.rejected, true);
  // The other 8 keys are exact (timestamp-driven) — never flagged.
  for (const k of NUMBER_KEYS) {
    if (k !== 'total' && k !== 'rejected') assert.equal(approx[k], undefined, `${k} must not be approx`);
  }
});

test('IDENTITY on the real sample CSV at a saturated as-of (current == as-of state)', SKIP_CSV, () => {
  // The CSV's newest timestamp is a 2026-07-19 result; past it, every "≤ asOf"
  // filter admits every non-null value → collapses to the engine's "!= null".
  const SAT = '2026-07-20';
  const eng = engineNumbers(csvRows, SAT);
  const { numbers } = computeNumbersAsOf({ rows: csvRows, tatTests: TAT_LOOKUP, asOfIso: SAT });
  assert.deepEqual(numbers, eng);
});

test('FEATURE: as-of @ 2026-07-09 reconstructs history from the 2026-07-19 export', SKIP_CSV, () => {
  // The whole point: the current export carries post-report updates the 07-09
  // report never had. Reconstructing 07-09 must DROP them, so completed/received
  // are strictly below the date-blind engine run over the full export.
  const asof = computeNumbersAsOf({ rows: csvRows, tatTests: TAT_LOOKUP, asOfIso: '2026-07-09' }).numbers;
  const engFull = engineNumbers(csvRows, '2026-07-09'); // engine ignores dates: counts future results
  assert.ok(asof.completed < engFull.completed, `completed ${asof.completed} should be < ${engFull.completed}`);
  assert.ok(asof.received < engFull.received, `received ${asof.received} should be < ${engFull.received}`);
});

// =============================================================================
// 2. MONOTONICITY
// =============================================================================

test('monotonicity: cumulative keys + total are non-decreasing over 2026-07-01..09', () => {
  const dates = Array.from({ length: 9 }, (_, i) => `2026-07-0${i + 1}`); // 01..09
  const CUMULATIVE = ['total', 'collected', 'dispatched', 'received', 'completed'];
  let prev = null;
  for (const d of dates) {
    const { numbers } = computeNumbersAsOf({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: d });
    if (prev) {
      for (const k of CUMULATIVE) {
        assert.ok(numbers[k] >= prev[k], `${k} dropped ${prev[k]}→${numbers[k]} at ${d}`);
      }
    }
    prev = numbers;
  }
  // Sanity: the window actually grows (not a trivially-constant series).
  const first = computeNumbersAsOf({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: '2026-07-01' }).numbers;
  const last = computeNumbersAsOf({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: '2026-07-09' }).numbers;
  assert.ok(last.completed > first.completed);
  assert.ok(last.total > first.total);
});

// =============================================================================
// 3. HAND-CHECK — one row's bucket membership across three dates
// =============================================================================

test('hand-check: a single line moves through the buckets as its timestamps pass', () => {
  // One synthetic line with explicit timestamps. tatDaysCsv=2 → Due = WORKDAY(
  // received 2026-06-03 Wed, 2) = Fri 2026-06-05 (engine TAT/workday, CSV fallback).
  const row = {
    orderDate: '2026-06-01', collected: '2026-06-01 08:00:00', dispatched: '2026-06-02 09:00:00',
    received: '2026-06-03 10:00:00', resulted: '2026-06-10 11:00:00',
    rawStatus: 'Result Available', facility: 'Lab X', testName: 'ANY TEST', tatDaysCsv: 2,
  };
  const at = (iso) => computeNumbersAsOf({ rows: [row], tatTests: {}, asOfIso: iso }).numbers;
  const ZERO = {
    total: 0, collected: 0, dispatched: 0, received: 0, completed: 0, rejected: 0,
    awaitingDispatch: 0, shippedNotReceived: 0, awaitingResults: 0, lateNoResult: 0,
  };

  // (a) 2026-05-31 — before the order even exists: nothing.
  assert.deepEqual(at('2026-05-31'), ZERO);

  // (b) 2026-06-02 — dispatched, not yet received → in transit.
  assert.deepEqual(at('2026-06-02'), {
    ...ZERO, total: 1, collected: 1, dispatched: 1, shippedNotReceived: 1,
  });

  // (c) 2026-06-09 — received, Due (06-05) has passed, still no result → LATE, awaiting.
  assert.deepEqual(at('2026-06-09'), {
    ...ZERO, total: 1, collected: 1, dispatched: 1, received: 1, awaitingResults: 1, lateNoResult: 1,
  });

  // (d) 2026-06-10 — resulted → completed; no longer awaiting/late.
  assert.deepEqual(at('2026-06-10'), {
    ...ZERO, total: 1, collected: 1, dispatched: 1, received: 1, completed: 1,
  });
});

// =============================================================================
// 4. buildWeekNumbers
// =============================================================================

test('buildWeekNumbers: correct oldest→newest date list, days param respected', () => {
  const week = buildWeekNumbers({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, history: {}, endIso: '2026-07-09' });
  assert.equal(week.length, 7);
  assert.deepEqual(week.map((w) => w.date), [
    '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
  ]);
  // days param respected.
  const three = buildWeekNumbers({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, history: {}, endIso: '2026-07-09', days: 3 });
  assert.deepEqual(three.map((w) => w.date), ['2026-07-07', '2026-07-08', '2026-07-09']);
  // With no history, every day is computed and carries the newest date's identity.
  for (const w of three) assert.equal(w.source, 'computed');
  assert.deepEqual(three.at(-1).numbers, SNAPSHOT_SEED.numbers);
});

test('buildWeekNumbers: a published snapshot is preferred over the computed value', () => {
  // Sentinel numbers that could never be computed, on one date inside the window.
  const sentinel = {
    total: 111, collected: 222, dispatched: 333, received: 444, completed: 555, rejected: 666,
    awaitingDispatch: 777, shippedNotReceived: 888, awaitingResults: 999, lateNoResult: 1010,
  };
  const history = { '2026-07-05': sentinel };
  const week = buildWeekNumbers({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, history, endIso: '2026-07-09' });
  const published = week.find((w) => w.date === '2026-07-05');
  assert.equal(published.source, 'published');
  assert.deepEqual(published.numbers, sentinel); // taken verbatim from history, not computed
  assert.equal(published.approx, undefined); // published rows never carry approx
  // Every other date falls back to computed.
  for (const w of week) {
    if (w.date !== '2026-07-05') assert.equal(w.source, 'computed', `${w.date} should be computed`);
  }
  // Computed rows over the golden data carry the approx flags (cancelled + rejected).
  const computedDay = week.find((w) => w.date === '2026-07-09');
  assert.deepEqual(computedDay.approx, { total: true, rejected: true });
});

test('buildWeekNumbers: pure — identical inputs yield identical output (no Date.now)', () => {
  const args = { rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, history: {}, endIso: '2026-07-09', days: 5 };
  assert.deepEqual(buildWeekNumbers(args), buildWeekNumbers(args));
});
