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

// QUEUE_KEYS (section 5) is imported rather than re-listed locally: it is the module's own
// statement of which four keys the `sinceIso` gate narrows, and the event class is asserted
// below as its COMPLEMENT, so promoting a key to the queue class in asof.js and forgetting
// it here is a test failure instead of silent under-coverage.
import { computeNumbersAsOf, buildWeekNumbers, NUMBER_KEYS, QUEUE_KEYS } from '../src/engine/asof.js';
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

test('excludeNoTat drops ONLY received No-Match rows — never cancelled, rejected, or pre-received ones', () => {
  // Four rows that must survive the flag plus one that must not. The flag mirrors
  // engine compute(): 'No Match' means received present but StdTAT unresolvable
  // from lookup AND CSV; cancelled/rejected resolve earlier in the cascade and a
  // row not yet received has nothing to be late against, so none of those may
  // ever be dropped by it.
  const mk = (o) => ({
    orderDate: '2026-07-06 00:00:00', facility: 'Lab X', orderId: null, lineNo: null,
    loinc: null, testName: 'UNKNOWN TEST', collected: null, dispatched: null,
    received: null, resulted: null, rawStatus: 'In Progress', tatDaysCsv: null,
    specimenNo: null, shipmentId: null, orderingFacilityId: null, performingFacilityId: null,
    ...o,
  });
  const rows = [
    mk({ orderId: 'DROP', received: '2026-07-07 09:00:00' }),                       // No Match → dropped
    mk({ orderId: 'CANC', received: '2026-07-07 09:00:00', rawStatus: 'Order Cancelled' }),
    mk({ orderId: 'REJ', received: '2026-07-07 09:00:00', rawStatus: 'Result Rejected' }),
    mk({ orderId: 'PRE', collected: '2026-07-06 08:00:00' }),                       // never received
    mk({ orderId: 'TAT', received: '2026-07-07 09:00:00', tatDaysCsv: 3 }),         // resolves via CSV
  ];
  const off = computeNumbersAsOf({ rows, tatTests: {}, asOfIso: '2026-07-09' }).numbers;
  const on = computeNumbersAsOf({ rows, tatTests: {}, asOfIso: '2026-07-09', opts: { excludeNoTat: true } }).numbers;
  // Exactly one row vanishes, and it is the received No-Match one.
  assert.equal(off.total - on.total, 1);
  assert.equal(off.received - on.received, 1);
  // The cancelled and pre-received rows are untouched: total still counts CANC's
  // exclusion the same way (cancelled is its own KPI, subtracted from total by the
  // engine's rule), and rejected stays exactly as it was.
  assert.equal(on.rejected, off.rejected, 'rejected must never be dropped by the flag');
  // The engine gate is `=== true`: a truthy non-boolean must NOT exclude, or the
  // as-of mirror would count a different row set than the deck's totals.
  const truthy = computeNumbersAsOf({ rows, tatTests: {}, asOfIso: '2026-07-09', opts: { excludeNoTat: 1 } }).numbers;
  assert.deepEqual(truthy, off, 'non-boolean truthy flag must behave as OFF, matching the engine');
});

// =============================================================================
// 5. SURVIVING ENTRANTS — the OPTIONAL `sinceIso` gate (round 4, 2026-08-06)
// =============================================================================
// `sinceIso` narrows the four QUEUE_KEYS — and ONLY those four — to rows that ENTERED
// the state on or after that day and are STILL in it at asOf. It exists so ONE gated
// call can serve both key classes: model/delta-window.js subtracts two as-of states for
// the six EVENT keys and reads this same call directly for the four queue keys.
//
// THE ENTRY DAY IS PER-KEY, and it is the day the row's membership test FIRST flipped
// true — not the day the row was last touched:
//   awaitingDispatch   → orderDate
//   shippedNotReceived → dispatched
//   awaitingResults    → received
//   lateNoResult       → the DUE day (a row enters lateness when it falls due, and it
//                        can fall due long after it was received — see the late case)
// Everything else — the six event keys, the cancelled/rejected dating, the approx flags
// and opts.excludeNoTat — must behave EXACTLY as it does ungated. The cases below pin
// each of those halves separately, because a gate that leaked into the event keys would
// silently re-scope the deck's cumulative numbers, which is the one thing this round was
// forbidden to touch.

/** A full row with everything nulled; the gate cases set only the dates they turn on. */
const qrow = (o) => ({
  orderDate: null, facility: 'Lab Q', orderId: null, lineNo: null, loinc: null,
  testName: 'ANY TEST', collected: null, dispatched: null, received: null, resulted: null,
  rawStatus: 'In Progress', tatDaysCsv: null,
  specimenNo: null, shipmentId: null, orderingFacilityId: null, performingFacilityId: null,
  ...o,
});

// The July 2026 calendar these cases are counted on. 07-05 is a SUNDAY, so the Saudi work
// week runs Sun 07-05 → Thu 07-09 and Fri 07-03 / Sat 07-04 are the PRECEDING weekend:
//   Wed 07-01, Thu 07-02, Fri 07-03, Sat 07-04, Sun 07-05, Mon 07-06, Tue 07-07,
//   Wed 07-08, Thu 07-09
const Q_ASOF = '2026-07-09';  // the window's end — every gated call below reads this day
const Q_SINCE = '2026-07-05'; // the window's floor — Sunday
const Q_ZERO = {
  total: 0, collected: 0, dispatched: 0, received: 0, completed: 0, rejected: 0,
  awaitingDispatch: 0, shippedNotReceived: 0, awaitingResults: 0, lateNoResult: 0,
};
const gated = (rows, sinceIso) => computeNumbersAsOf({ rows, tatTests: {}, asOfIso: Q_ASOF, sinceIso }).numbers;
const ungated = (rows) => computeNumbersAsOf({ rows, tatTests: {}, asOfIso: Q_ASOF }).numbers;

test('sinceIso ABSENT is the identity — the gate cannot change a call that never asked for it', () => {
  // Every pre-round-4 caller (buildWeekNumbers, the CROWN identity above, the history
  // panel) passes no sinceIso at all, so "absent ⇒ byte-identical" is what keeps this
  // whole feature additive. Asserted on the richest row set there is, and on BOTH halves
  // of the return value: `approx` is a statement about DATING, not about membership, so
  // the gate must not perturb it either.
  const base = { rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: GOLDEN_ASOF };
  const absent = computeNumbersAsOf(base);
  // An explicitly-undefined key must behave exactly like a missing one: callers build this
  // bag by spreading options, so `sinceIso: opts.sinceIso` with nothing stored is the
  // NORMAL shape, not an edge case.
  const undef = computeNumbersAsOf({ ...base, sinceIso: undefined });
  const nul = computeNumbersAsOf({ ...base, sinceIso: null });
  for (const [name, got] of [['undefined', undef], ['null', nul]]) {
    assert.deepEqual(got.numbers, absent.numbers, `sinceIso ${name} must not gate anything`);
    assert.deepEqual(got.approx, absent.approx, `sinceIso ${name} must not perturb approx`);
  }
  // A floor older than every row is the same statement reached from the other side: every
  // entry day is ≥ it, so every gate conjunct is true and the counts are the ungated ones.
  assert.deepEqual(
    computeNumbersAsOf({ ...base, sinceIso: '2000-01-01' }).numbers, absent.numbers,
    'a floor before all data admits everything',
  );
  // But a PRESENT-and-unparseable floor is a caller bug, not a no-op: silently ungating it
  // would ship a chip counting the whole history under a legend naming one week. Note that
  // '' is UNPARSEABLE, not absent — only undefined and null mean "no gate", and the
  // difference is exactly the one a `sinceIso || undefined` shorthand would erase.
  for (const bad of ['', '2026-7-5', '05-07-2026', 'sunday']) {
    assert.throws(() => computeNumbersAsOf({ ...base, sinceIso: bad }), /sinceIso/,
      `must reject ${JSON.stringify(bad)}`);
  }
  // sinceIso and asOfIso share ONE parser (workday.js parseDateTime), so they are lenient
  // in exactly the same places — notably a raw epoch-ms number, which parseDateTime passes
  // through by design. Pinned as a PAIR rather than asserted of sinceIso alone: the claim
  // worth keeping is that the two params cannot drift into different accepted shapes, not
  // that either one hand-validates an ISO string of its own.
  const ms = Date.UTC(2026, 6, 5); // = '2026-07-05' as epoch-ms
  assert.deepEqual(
    computeNumbersAsOf({ ...base, sinceIso: ms }).numbers,
    computeNumbersAsOf({ ...base, sinceIso: '2026-07-05' }).numbers,
    'an epoch-ms floor resolves to the same day as its ISO spelling',
  );
  assert.deepEqual(
    computeNumbersAsOf({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: Date.UTC(2026, 6, 9) }).numbers,
    absent.numbers,
    'asOfIso is exactly as lenient — same parser, same shapes',
  );
});

test('gate: awaitingDispatch enters on the ORDER day, inclusive at the floor', () => {
  // Three rows ordered and collected, none ever dispatched, so all three are sitting in
  // awaitingDispatch at 07-09 and the ONLY thing that separates them is their entry day.
  const rows = [
    qrow({ orderId: 'AD_BEFORE', orderDate: '2026-07-02', collected: '2026-07-02 08:00:00' }), // Thu, before
    qrow({ orderId: 'AD_ON', orderDate: '2026-07-05', collected: '2026-07-05 08:00:00' }),     // Sun, the floor ITSELF
    qrow({ orderId: 'AD_AFTER', orderDate: '2026-07-07', collected: '2026-07-07 08:00:00' }),  // Tue, inside
  ];
  assert.deepEqual(ungated(rows), { ...Q_ZERO, total: 3, collected: 3, awaitingDispatch: 3 });
  // The gate is `entry ≥ since`, so AD_ON — which entered ON Sunday — is IN. Make that a
  // strict `>` and every arrival on the window's first day vanishes from the week that is
  // named after that very day.
  assert.deepEqual(gated(rows, Q_SINCE), { ...Q_ZERO, total: 3, collected: 3, awaitingDispatch: 2 });
  // The three EVENT keys these rows touch (total, collected) are untouched by the gate —
  // visible above, and stated here so the claim is not an accident of the deepEqual.
  assert.equal(gated(rows, Q_SINCE).total, ungated(rows).total);
});

test('gate: shippedNotReceived enters on the DISPATCH day, not the order day', () => {
  // All three ordered on the SAME pre-window day (07-01) and never received, so if the
  // gate read orderDate here — the awaitingDispatch entry day — all three would be
  // excluded and the count would be 0 instead of 2.
  const rows = [
    qrow({ orderId: 'SN_BEFORE', orderDate: '2026-07-01', collected: '2026-07-01 08:00:00', dispatched: '2026-07-02 09:00:00' }),
    qrow({ orderId: 'SN_ON', orderDate: '2026-07-01', collected: '2026-07-01 08:00:00', dispatched: '2026-07-05 09:00:00' }), // the floor itself
    qrow({ orderId: 'SN_AFTER', orderDate: '2026-07-01', collected: '2026-07-01 08:00:00', dispatched: '2026-07-08 09:00:00' }),
  ];
  assert.deepEqual(ungated(rows), { ...Q_ZERO, total: 3, collected: 3, dispatched: 3, shippedNotReceived: 3 });
  assert.deepEqual(gated(rows, Q_SINCE), { ...Q_ZERO, total: 3, collected: 3, dispatched: 3, shippedNotReceived: 2 });
});

test('gate: awaitingResults enters on the RECEIPT day, not the order or dispatch day', () => {
  // Same trap one stage on: identical pre-window order+dispatch days, so only the receipt
  // day can produce 2. tatDaysCsv 30 keeps every row far from its due date, which isolates
  // this queue from lateNoResult (they overlap by definition — late ⊆ awaiting).
  const rows = [
    qrow({ orderId: 'AR_BEFORE', orderDate: '2026-06-25', collected: '2026-06-25 08:00:00', dispatched: '2026-06-26 09:00:00', received: '2026-07-02 10:00:00', tatDaysCsv: 30 }),
    qrow({ orderId: 'AR_ON', orderDate: '2026-06-25', collected: '2026-06-25 08:00:00', dispatched: '2026-06-26 09:00:00', received: '2026-07-05 10:00:00', tatDaysCsv: 30 }), // the floor itself
    qrow({ orderId: 'AR_AFTER', orderDate: '2026-06-25', collected: '2026-06-25 08:00:00', dispatched: '2026-06-26 09:00:00', received: '2026-07-08 10:00:00', tatDaysCsv: 30 }),
  ];
  assert.deepEqual(ungated(rows), { ...Q_ZERO, total: 3, collected: 3, dispatched: 3, received: 3, awaitingResults: 3 });
  assert.deepEqual(gated(rows, Q_SINCE), { ...Q_ZERO, total: 3, collected: 3, dispatched: 3, received: 3, awaitingResults: 2 });
});

test('gate: lateNoResult enters on its DUE day — receipt is not when a row becomes late', () => {
  // THE ONE KEY WHOSE ENTRY DAY IS DERIVED, not read off a column. All three rows are
  // received BEFORE or EARLY IN the week and unresulted, so all three are late at 07-09;
  // what separates them is when each FELL due, under the Fri+Sat weekend with tat 1:
  //   LATE_PRE  received Wed 07-01 → Due = WORKDAY(07-01, 1) = Thu 07-02 — overdue since
  //             BEFORE the window opened, so it is not this week's news ⇒ EXCLUDED
  //   LATE_ON   received Thu 07-02 → Fri 07-03 and Sat 07-04 are the weekend, so the next
  //             business day is Sun 07-05 — the floor ITSELF ⇒ INCLUDED (inclusive)
  //   LATE_IN   received Tue 07-07 → Due = Wed 07-08, squarely inside ⇒ INCLUDED
  const rows = [
    qrow({ orderId: 'LATE_PRE', orderDate: '2026-06-25', collected: '2026-06-25 08:00:00', dispatched: '2026-06-26 09:00:00', received: '2026-07-01 10:00:00', tatDaysCsv: 1 }),
    qrow({ orderId: 'LATE_ON', orderDate: '2026-06-25', collected: '2026-06-25 08:00:00', dispatched: '2026-06-26 09:00:00', received: '2026-07-02 10:00:00', tatDaysCsv: 1 }),
    qrow({ orderId: 'LATE_IN', orderDate: '2026-06-25', collected: '2026-06-25 08:00:00', dispatched: '2026-06-26 09:00:00', received: '2026-07-07 10:00:00', tatDaysCsv: 1 }),
  ];
  const off = ungated(rows);
  assert.deepEqual(off, { ...Q_ZERO, total: 3, collected: 3, dispatched: 3, received: 3, awaitingResults: 3, lateNoResult: 3 });
  const on = gated(rows, Q_SINCE);
  assert.equal(on.lateNoResult, 2, 'LATE_ON (due on the floor) and LATE_IN, but never LATE_PRE');

  // THE CONSEQUENCE A READER MUST NOT MISTAKE FOR A BUG: the two queues gate on DIFFERENT
  // entry days, so the ungated subset relation late ⊆ awaitingResults does NOT survive the
  // gate. LATE_ON was received 07-02 — before the window — so it is not a surviving
  // ENTRANT of awaitingResults, while its due day 07-05 makes it one of lateNoResult.
  assert.equal(on.awaitingResults, 1, 'only LATE_IN was RECEIVED inside the window');
  assert.ok(on.lateNoResult > on.awaitingResults,
    'gated late may EXCEED gated awaiting — different entry days, deliberately');
  // …while the CUMULATIVE numbers, which are what the slides print, keep the subset.
  assert.ok(off.lateNoResult <= off.awaitingResults, 'the ungated subset relation is untouched');
  // Gate on the received day instead and lateNoResult would read 1 here, silently hiding a
  // sample that went overdue this week. That is the regression this case exists for.
  assert.notEqual(on.lateNoResult, on.awaitingResults);
});

test('gate: an undated REJECTED row is still excluded from every queue, and approx is gate-blind', () => {
  // A rejection carries no timestamp, so asof.js dates it by the last milestone the row
  // reached (receipt, 07-07) and flags the approximation. The row's entry day into all
  // THREE pre-completion queues is inside the window (order 07-06, dispatch 07-06, receipt
  // 07-07), so a gate written as a standalone filter — rather than one more conjunct on
  // the existing membership tests — would re-admit it to queues the rejection guard had
  // already removed it from, and break the partition
  //   total = awaitingDispatch + shippedNotReceived + awaitingResults + completed.
  const rows = [
    qrow({
      orderId: 'REJ', orderDate: '2026-07-06', collected: '2026-07-06 08:00:00',
      dispatched: '2026-07-06 09:00:00', received: '2026-07-07 10:00:00',
      resulted: '', rawStatus: 'Result Rejected',
    }),
    // A cancelled row ordered in-window, so approx.total is exercised too: cancellation has
    // no timestamp either, and that caveat is likewise a dating statement.
    qrow({ orderId: 'CANC', orderDate: '2026-07-06', collected: '2026-07-06 08:00:00', rawStatus: 'Order Cancelled' }),
  ];
  const off = computeNumbersAsOf({ rows, tatTests: {}, asOfIso: Q_ASOF });
  const on = computeNumbersAsOf({ rows, tatTests: {}, asOfIso: Q_ASOF, sinceIso: Q_SINCE });
  const expected = {
    ...Q_ZERO, total: 1, collected: 1, dispatched: 1, received: 1, completed: 1, rejected: 1,
  };
  assert.deepEqual(off.numbers, expected, 'ungated: rejected leaves the pipeline entirely');
  assert.deepEqual(on.numbers, expected, 'gated: the exclusion holds, and no queue re-opens');
  for (const k of QUEUE_KEYS) assert.equal(on.numbers[k], 0, `${k} must stay empty for a rejected row`);
  // approx describes HOW rows were dated, never WHICH window they fall in, so it cannot
  // move with the gate. Both caveats must be present and identical on both calls.
  assert.deepEqual(on.approx, { total: true, rejected: true, completed: true });
  assert.deepEqual(on.approx, off.approx, 'the gate must not touch the disclosure');
});

test('gate: the six EVENT keys are byte-identical gated vs ungated, on the golden data', () => {
  // The invariant of the whole round, checked where it matters most — the 618-row snapshot
  // whose numbers ARE the published deck. The cumulative headline figures (total …
  // rejected) must not move by a single unit when a window floor is supplied, or the chips
  // would have re-scoped the big numbers they sit beside.
  const off = computeNumbersAsOf({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: GOLDEN_ASOF });
  const on = computeNumbersAsOf({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: GOLDEN_ASOF, sinceIso: '2026-07-05' });
  const EVENT_KEYS = NUMBER_KEYS.filter((k) => !QUEUE_KEYS.includes(k));
  assert.deepEqual(EVENT_KEYS, ['total', 'collected', 'dispatched', 'received', 'completed', 'rejected'],
    'the event class is the complement of QUEUE_KEYS — nothing else may be in it');
  for (const k of EVENT_KEYS) {
    assert.equal(on.numbers[k], off.numbers[k], `event key ${k} must not move with the gate`);
  }
  assert.deepEqual(on.approx, off.approx);
  // The queue keys are a SUBSET filter, so each is bounded by its ungated value and by 0 —
  // a count, never a difference of two counts, hence never negative.
  for (const k of QUEUE_KEYS) {
    assert.ok(on.numbers[k] >= 0, `${k} must not be negative`);
    assert.ok(on.numbers[k] <= off.numbers[k], `${k}: gated ${on.numbers[k]} exceeds ungated ${off.numbers[k]}`);
    // …and the gate must actually BITE on this fixture, or every bound above is vacuous.
    assert.ok(on.numbers[k] < off.numbers[k], `${k}: the gate did nothing (${off.numbers[k]})`);
  }
});
