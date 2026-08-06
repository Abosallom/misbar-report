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
  // NOTE the comparison is against the ENGINE's live output — never a hardcoded
  // completed — so the as-of `completed` rule and the engine's cannot drift apart:
  // change one definition without the other and this test fails.
  const eng = engineNumbers(GOLDEN_ORDERS, GOLDEN_ASOF);
  const { numbers } = computeNumbersAsOf({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: GOLDEN_ASOF });
  for (const k of NUMBER_KEYS) {
    assert.equal(numbers[k], eng[k], `key ${k}: as-of ${numbers[k]} !== engine ${eng[k]}`);
  }
  assert.deepEqual(numbers, eng);
  // And it equals the published 09-07 snapshot the app ships as its baseline.
  // RE-BASELINE NOTE (2026-08-05): the late boundary rule (due TODAY counts as
  // late) moves lateNoResult on this fixture from 67 to 73 — 6 rows are due
  // exactly on asOf 2026-07-09 with no result. SNAPSHOT_SEED.numbers.lateNoResult
  // must be re-baselined to 73 in src/seeds/defaults.js for this identity to hold;
  // this is the ONE place the shipped seed is checked against the live engine, on
  // purpose, so a stale seed surfaces here and nowhere else.
  assert.deepEqual(numbers, SNAPSHOT_SEED.numbers);
});

test('COMPLETED CONTAINS REJECTED: completed == resulted + rejected on the golden data', () => {
  // 2026-07-28 rule: a rejection is the lab's FINAL outcome, so a rejected row is
  // completed work. Derived from the fixture, not hardcoded: in GOLDEN_ORDERS every
  // rejected row has a BLANK result date, so the two sets are disjoint and completed
  // must be exactly their sum — proving rejected is counted, and counted ONCE.
  const nonCancelled = GOLDEN_ORDERS.filter((r) => r.rawStatus !== 'Order Cancelled');
  const hasResult = (r) => r.resulted != null && String(r.resulted).trim() !== '';
  const resultedCount = nonCancelled.filter(hasResult).length;
  const rejectedRows = nonCancelled.filter((r) => r.rawStatus === 'Result Rejected');
  assert.equal(rejectedRows.filter(hasResult).length, 0, 'fixture assumption: rejected rows carry no result date');

  const { numbers } = computeNumbersAsOf({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: GOLDEN_ASOF });
  assert.equal(numbers.rejected, rejectedRows.length);
  assert.equal(numbers.completed, resultedCount + numbers.rejected);
  // rejected is a SUBSET of completed, never an addition on top of it.
  assert.ok(numbers.completed >= numbers.rejected);
  // The shipped baseline seed speaks the same definition (no silent 15-row gap).
  assert.equal(SNAPSHOT_SEED.numbers.completed, resultedCount + SNAPSHOT_SEED.numbers.rejected);
});

test('CROWN identity: approx flags total (cancelled-in-range), rejected + completed (no reject timestamp)', () => {
  const { approx } = computeNumbersAsOf({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: GOLDEN_ASOF });
  // All principled approximations: cancellation & rejection carry no timestamp.
  assert.equal(approx.total, true);
  assert.equal(approx.rejected, true);
  // completed CONTAINS rejected since 2026-07-28, so it inherits that approximation
  // — the two are always flagged together, never one without the other.
  assert.equal(approx.completed, true);
  // The other 7 keys are exact (timestamp-driven) — never flagged.
  const APPROX_KEYS = ['total', 'rejected', 'completed'];
  for (const k of NUMBER_KEYS) {
    if (!APPROX_KEYS.includes(k)) assert.equal(approx[k], undefined, `${k} must not be approx`);
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

test('hand-check: a REJECTED line counts as completed from its dated day onward', () => {
  // 2026-07-28 rule: rejection is the lab's final outcome → completed work. The row
  // is dated by the SAME rule the rejected bucket uses (result date when present,
  // else orderDate), so completed and rejected can never disagree about the day.
  const ZERO = {
    total: 0, collected: 0, dispatched: 0, received: 0, completed: 0, rejected: 0,
    awaitingDispatch: 0, shippedNotReceived: 0, awaitingResults: 0, lateNoResult: 0,
  };
  const at = (row, iso) => computeNumbersAsOf({ rows: [row], tatTests: {}, asOfIso: iso });

  // (a) rejected with NO result date → dated by the LAST milestone it is known to
  // have reached, which here is RECEIPT (2026-06-03), not the order day: a rejection
  // cannot precede the sample physically arriving at the lab, so dating it at the
  // order would report the lab as finished before it had the specimen.
  const noDate = {
    orderDate: '2026-06-01', collected: '2026-06-01 08:00:00', dispatched: '2026-06-02 09:00:00',
    received: '2026-06-03 10:00:00', resulted: '',
    rawStatus: 'Result Rejected', facility: 'Lab X', testName: 'ANY TEST', tatDaysCsv: 2,
  };
  assert.deepEqual(at(noDate, '2026-05-31').numbers, ZERO); // before the order exists
  // On the ORDER day the rejection is not dated yet, so the row is still in the
  // pipeline — awaiting dispatch, and NOT yet completed.
  assert.deepEqual(at(noDate, '2026-06-01').numbers, {
    ...ZERO, total: 1, collected: 1, awaitingDispatch: 1,
  });
  // On the RECEIPT day the rejection is dated: it leaves the pipeline and becomes
  // completed, counted once, on the same day in both keys.
  assert.deepEqual(at(noDate, '2026-06-03').numbers, {
    ...ZERO, total: 1, collected: 1, dispatched: 1, received: 1, completed: 1, rejected: 1,
  });
  // Later — never awaiting a result, never LATE (rejected is excluded from both),
  // and never counted twice in completed.
  assert.deepEqual(at(noDate, '2026-06-20').numbers, {
    ...ZERO, total: 1, collected: 1, dispatched: 1, received: 1, completed: 1, rejected: 1,
  });
  // The orderDate fallback is disclosed on BOTH keys it affects.
  assert.deepEqual(at(noDate, '2026-06-20').approx, { rejected: true, completed: true });

  // (b) rejected WITH a result date → dated by the result date (2026-06-10), and
  // counted ONCE: the row satisfies both the resulted and rejected tests.
  const dated = { ...noDate, resulted: '2026-06-10 11:00:00' };
  // Before the result date the row is genuinely still awaiting a result — and late,
  // since its due date (received + 2 business days) has passed. A row rejected LATER
  // must not be retro-actively removed from the day it really was late.
  assert.deepEqual(at(dated, '2026-06-09').numbers, {
    ...ZERO, total: 1, collected: 1, dispatched: 1, received: 1,
    awaitingResults: 1, lateNoResult: 1, // not completed yet
  });
  const after = at(dated, '2026-06-10');
  assert.deepEqual(after.numbers, {
    ...ZERO, total: 1, collected: 1, dispatched: 1, received: 1, completed: 1, rejected: 1,
  });
  assert.equal(after.numbers.completed, 1, 'a rejected row WITH a result date is counted once, not twice');
  assert.equal(after.approx.completed, undefined); // exact: no orderDate fallback used
  assert.equal(after.approx.rejected, undefined);
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
  // Compared against the ENGINE's own 07-09 numbers, not the shipped
  // SNAPSHOT_SEED: the claim here is "the last computed day equals the report
  // date's figures". Whether the seed constant still matches the engine is a
  // separate claim, asserted once in the CROWN identity test above (2026-08-05 —
  // this used to read SNAPSHOT_SEED.numbers and turned a stale-seed problem into
  // a misleading buildWeekNumbers failure).
  assert.deepEqual(three.at(-1).numbers, engineNumbers(GOLDEN_ORDERS, '2026-07-09'));
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
  // Computed rows over the golden data carry the approx flags (cancelled + rejected,
  // and completed with it since completed now contains rejected).
  const computedDay = week.find((w) => w.date === '2026-07-09');
  assert.deepEqual(computedDay.approx, { total: true, rejected: true, completed: true });
});

test('buildWeekNumbers: pure — identical inputs yield identical output (no Date.now)', () => {
  const args = { rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, history: {}, endIso: '2026-07-09', days: 5 };
  assert.deepEqual(buildWeekNumbers(args), buildWeekNumbers(args));
});

// =============================================================================
// LATE BOUNDARY (Talal 2026-08-05) — asof.js must agree with the engine
// =============================================================================

test('as-of LATE BOUNDARY: due exactly on the as-of day counts as late', () => {
  // asof.js compares `asOfDay >= dueMs` (it was a strict `>`). Same synthetic row
  // as engine.test.mjs's boundary suite: received Wed 2026-06-03 + tat 2 -> due
  // Sun 2026-06-07 under the Fri+Sat weekend.
  const row = {
    orderDate: '2026-06-01', collected: '2026-06-01 08:00:00', dispatched: '2026-06-02 09:00:00',
    received: '2026-06-03 10:00:00', resulted: '',
    rawStatus: 'In Progress', facility: 'Lab X', testName: 'ANY TEST', tatDaysCsv: 2,
  };
  const at = (iso) => computeNumbersAsOf({ rows: [row], tatTests: {}, asOfIso: iso }).numbers;

  // 06-06 (Saturday, the day before due) — not late yet.
  assert.equal(at('2026-06-06').lateNoResult, 0, 'the day before due is not late');
  // 06-07 — the DUE day itself, still no result -> LATE. This is the boundary.
  assert.equal(at('2026-06-07').lateNoResult, 1, 'due TODAY with no result is LATE');
  // 06-08 — overdue, obviously still late.
  assert.equal(at('2026-06-08').lateNoResult, 1);
  // late is always a subset of awaitingResults, at the boundary too.
  for (const iso of ['2026-06-07', '2026-06-08']) {
    const n = at(iso);
    assert.ok(n.lateNoResult <= n.awaitingResults, `late ⊆ awaitingResults on ${iso}`);
  }
});

test('as-of LATE BOUNDARY: a row RESULTED on its due day is never late on any day', () => {
  // The asymmetry, from the as-of side: this row met its TAT, so no as-of date
  // may ever report it as late-with-no-result — not even the due day itself.
  const row = {
    orderDate: '2026-06-01', collected: '2026-06-01 08:00:00', dispatched: '2026-06-02 09:00:00',
    received: '2026-06-03 10:00:00', resulted: '2026-06-07 16:00:00',
    rawStatus: 'Result Available', facility: 'Lab X', testName: 'ANY TEST', tatDaysCsv: 2,
  };
  const at = (iso) => computeNumbersAsOf({ rows: [row], tatTests: {}, asOfIso: iso }).numbers;
  for (const iso of ['2026-06-06', '2026-06-07', '2026-06-08', '2026-06-30']) {
    assert.equal(at(iso).lateNoResult, 0, `resulted-on-due-day must not be late on ${iso}`);
  }
  // …and from the due day onward it is simply completed.
  assert.equal(at('2026-06-07').completed, 1);
});

test('as-of LATE BOUNDARY: rejected and cancelled rows are never late, due day or not', () => {
  const base = {
    orderDate: '2026-06-01', collected: '2026-06-01 08:00:00', dispatched: '2026-06-02 09:00:00',
    received: '2026-06-03 10:00:00', resulted: '',
    facility: 'Lab X', testName: 'ANY TEST', tatDaysCsv: 2,
  };
  const at = (row, iso) => computeNumbersAsOf({ rows: [row], tatTests: {}, asOfIso: iso }).numbers;
  // Due day and well past it — the "no result AND not rejected/cancelled" clause.
  for (const iso of ['2026-06-07', '2026-06-20']) {
    assert.equal(at({ ...base, rawStatus: 'Result Rejected' }, iso).lateNoResult, 0, `rejected @ ${iso}`);
    assert.equal(at({ ...base, rawStatus: 'Order Cancelled' }, iso).lateNoResult, 0, `cancelled @ ${iso}`);
  }
});

test('as-of LATE BOUNDARY: the as-of series and the engine agree on the boundary day', () => {
  // Cross-surface: whatever the boundary does, BOTH implementations must do it.
  // Guards against flipping asof.js's `asOfDay >= dueMs` and engine.js's status
  // cascade independently, or fixing one and forgetting the other.
  //
  // Every row here is UNRESULTED on purpose: the engine's buckets are CURRENT
  // state while computeNumbersAsOf replays history, so the two are only
  // comparable over a row set with no timestamp later than the compared date
  // (the same precondition the CROWN identity test states). With no result dates
  // at all, every date at or after receipt satisfies that — and the late boundary
  // is precisely a claim about unresulted rows, so nothing is lost.
  // Due dates (Fri+Sat weekend): T1 received Wed 06-03 + 2 -> Sun 06-07;
  //                              T2 received Thu 06-04 + 2 -> Mon 06-08.
  const rows = [
    { orderDate: '2026-06-01', collected: '2026-06-01', dispatched: '2026-06-02', received: '2026-06-03 10:00:00', resulted: '', rawStatus: 'In Progress', facility: 'L', testName: 'T1', tatDaysCsv: 2 },
    { orderDate: '2026-06-01', collected: '2026-06-01', dispatched: '2026-06-02', received: '2026-06-04 10:00:00', resulted: '', rawStatus: 'In Progress', facility: 'L', testName: 'T2', tatDaysCsv: 2 },
  ];
  const expectLate = { '2026-06-06': 0, '2026-06-07': 1, '2026-06-08': 2, '2026-06-09': 2 };
  for (const [iso, late] of Object.entries(expectLate)) {
    const asofN = computeNumbersAsOf({ rows, tatTests: {}, asOfIso: iso }).numbers;
    const engN = engineNumbers(rows, iso);
    assert.deepEqual(asofN, engN, `as-of and engine disagree on ${iso}`);
    // …and they agree on the hand-counted value, not merely with each other.
    assert.equal(asofN.lateNoResult, late, `lateNoResult on ${iso}`);
  }
});
