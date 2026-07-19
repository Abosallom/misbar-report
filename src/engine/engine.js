// engine/engine.js — pure JS port of the KAMC Order-Summary Excel report engine.
// compute(rows, tatLookup, opts) -> EngineOutput  (see src/contracts.js).
// No DOM / no Node APIs: runs identically under `node --test` and in the browser.
//
// The exact rules below were reverse-engineered from the source workbook's
// formulas (test/fixtures/summary-tables.json) and verified row-by-row against
// the 628 cached rows in test/fixtures/golden-orders.js. Key semantics:
//   • StdTAT   = XLOOKUP(Test → lookup); miss → CSV "TAT - Days" fallback.
//   • DueDate  = WORKDAY(INT(Received), StdTAT)  (excl. start, skip weekends).
//   • Delay    = asOf − DueDate  (whole days).  asOf mirrors the sheet's TODAY().
//   • Status cascade (the sheet's "T" column, incl. resulted rows):
//       Order Cancelled → Cancelled ; Result Rejected → Rejected ;
//       no Received → In Progress / Not Received ; no StdTAT → No Match ;
//       Delay ≤ 0 → On Time ; else → Late.
//     NB: a resulted row is still labelled On Time / Late off asOf−Due, exactly
//     as the workbook does (verified against every _cachedStatus).

import { normTest, normFacility } from '../contracts.js';
import {
  parseDateTime, toEpochDay, workday, dayDiff, calDaysBetween, monthKey,
} from './workday.js';
import { buildTatIndex, resolveTat, CHART_TEST_CATALOG } from './tat.js';
import { dedupeRows } from './dedupe.js';

export const STATUS = Object.freeze({
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
  IN_PROGRESS: 'In Progress / Not Received',
  NO_MATCH: 'No Match',
  ON_TIME: 'On Time',
  LATE: 'Late',
});

/** Round to 1 decimal place, report-style (half-up, EPSILON-guarded). */
export function round1(x) {
  return Math.round((x + Number.EPSILON) * 10) / 10;
}

/**
 * Enrich one OrderRow with all derived fields the aggregates need.
 * @returns {{row, facility, testName, orderMs, collectedMs, dispatchedMs,
 *   receivedMs, resultedMs, stdTat, matched, dueMs, delay, status,
 *   cancelled, rejected, hasCreated}}
 */
function enrichRow(row, tatIndex, asOfMs, opts) {
  const { tat, matched } = resolveTat(row, tatIndex, opts);
  const orderMs = parseDateTime(row.orderDate);
  const collectedMs = parseDateTime(row.collected);
  const dispatchedMs = parseDateTime(row.dispatched);
  const receivedMs = parseDateTime(row.received);
  const resultedMs = parseDateTime(row.resulted);
  const cancelled = row.rawStatus === 'Order Cancelled';
  const rejected = row.rawStatus === 'Result Rejected';

  let dueMs = null;
  let delay = null;
  if (receivedMs != null && tat != null) {
    dueMs = workday(receivedMs, tat);
    delay = dayDiff(asOfMs, dueMs);
  }

  let status;
  if (cancelled) status = STATUS.CANCELLED;
  else if (rejected) status = STATUS.REJECTED;
  else if (receivedMs == null) status = STATUS.IN_PROGRESS;
  else if (tat == null) status = STATUS.NO_MATCH;
  else if (delay <= 0) status = STATUS.ON_TIME;
  else status = STATUS.LATE;

  return {
    row,
    facility: normFacility(row.facility),
    testName: row.testName,
    orderMs, collectedMs, dispatchedMs, receivedMs, resultedMs,
    stdTat: tat, matched, dueMs, delay, status, cancelled, rejected,
    hasCreated: orderMs != null, // sheet's "col E non-empty" = order exists
  };
}

/**
 * Slide-3 funnel — all counts exclude cancelled.
 * Resulted counts ONLY rows with a Result report date (resultedMs != null).
 * Rejected rows have no result date and are NO LONGER counted here (user
 * decision 2026-07-19). This supersedes the old workbook C6 behavior, which
 * folded rejectedAll into resulted.
 */
function buildFunnel(nonCancelled) {
  return {
    created: nonCancelled.filter((e) => e.hasCreated).length,
    collected: nonCancelled.filter((e) => e.collectedMs != null).length,
    dispatched: nonCancelled.filter((e) => e.dispatchedMs != null).length,
    received: nonCancelled.filter((e) => e.receivedMs != null).length,
    resulted: nonCancelled.filter((e) => e.resultedMs != null).length,
  };
}

/**
 * Slide-2 status buckets.
 * completed counts ONLY rows with a Result report date (resultedMs != null);
 * Rejected rows are NO LONGER counted (user decision 2026-07-19), superseding
 * the old workbook C6 behavior that added rejectedAll here.
 */
function buildBuckets(nonCancelled) {
  const awaitingDispatch = nonCancelled.filter(
    (e) => e.dispatchedMs == null && e.hasCreated,
  ).length;
  const shippedNotReceived = nonCancelled.filter(
    (e) => e.dispatchedMs != null && e.receivedMs == null,
  ).length;
  const awaitingResults = nonCancelled.filter(
    (e) => e.receivedMs != null && e.resultedMs == null && !e.rejected,
  ).length;
  const completed = nonCancelled.filter((e) => e.resultedMs != null).length;
  const lateNoResult = nonCancelled.filter(
    (e) => e.status === STATUS.LATE && e.resultedMs == null,
  ).length;
  const latePct = awaitingResults > 0 ? round1((lateNoResult / awaitingResults) * 100) : 0;
  return { awaitingDispatch, shippedNotReceived, awaitingResults, completed, lateNoResult, latePct };
}

/**
 * Slide-4 monthly breakdown (order-month, excl. cancelled) merged with the
 * manual historical cancelledByMonth constants ADDITIVELY (workbook C6 prompt):
 *   cancelled(m) = countedFromCsv(m) + manualConstants[m]
 * Months present only in the manual map still surface (orders 0, cancelled =
 * manual). This replaces the earlier max(stored, computed) merge.
 *
 * Per-month `results` counts ONLY rows with a Result report date
 * (resultedMs != null); Rejected rows are NO LONGER added (user decision
 * 2026-07-19), superseding the old workbook C6 behavior that folded
 * rejectedAll into each month's results.
 * @returns {{monthly: object[], cancelledNote: number}}
 */
function buildMonthly(nonCancelled, cancelledEnriched, cancelledByMonth) {
  // computed cancelled-in-data per order-month
  const dataCancel = new Map();
  for (const e of cancelledEnriched) {
    const m = monthKey(e.orderMs);
    if (m) dataCancel.set(m, (dataCancel.get(m) || 0) + 1);
  }
  // union of every month that should surface a row
  const months = new Set();
  for (const e of nonCancelled) if (e.hasCreated) months.add(monthKey(e.orderMs));
  for (const m of Object.keys(cancelledByMonth || {})) months.add(m);
  for (const m of dataCancel.keys()) months.add(m);
  months.delete(null);
  const sorted = [...months].sort();

  const merged = new Map();
  for (const m of sorted) {
    // ADDITIVE (C6): computed-from-CSV + manual constant for the same month.
    merged.set(m, (dataCancel.get(m) || 0) + Number(cancelledByMonth?.[m] || 0));
  }
  // cancelledNote sums the additive value over every month (the "* N طلب ملغي" note)
  let cancelledNote = 0;
  for (const v of merged.values()) cancelledNote += v;

  const monthly = sorted.map((m) => {
    const orders = nonCancelled.filter((e) => e.hasCreated && monthKey(e.orderMs) === m).length;
    const results =
      nonCancelled.filter((e) => e.resultedMs != null && monthKey(e.orderMs) === m).length;
    const cancelled = merged.get(m) || 0;
    const incomplete = orders - results;
    const completionPct = orders > 0 ? round1((results / orders) * 100) : null;
    return { month: m, orders, results, incomplete, completionPct, cancelled };
  });

  return { monthly, cancelledNote };
}

/**
 * Slide-4 turnaround (resulted rows, excl. Rejected). Per order-month + overall.
 *   actual   = mean(resulted − received)  [fractional calendar days]
 *   expected = mean(dueDate − received)    [calendar span of the WORKDAY window]
 * Both keep time-of-day; values are rounded to 1 decimal, report-style.
 */
function buildTurnaround(nonCancelled) {
  // receivedMs/dueMs must be present: calDaysBetween would coerce null to epoch-0
  // and poison the means with ±10,000-day values (dirty rows: resulted with blank
  // Received, or unmatched test with blank CSV TAT). Golden set is unaffected (422).
  const measured = nonCancelled.filter(
    (e) => e.resultedMs != null && !e.rejected && e.receivedMs != null && e.dueMs != null,
  );
  const groups = new Map();
  for (const e of measured) {
    const m = monthKey(e.orderMs);
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(e);
  }
  const mean = (arr, f) => arr.reduce((s, e) => s + f(e), 0) / arr.length;
  const actualOf = (e) => calDaysBetween(e.resultedMs, e.receivedMs);
  const expectedOf = (e) => calDaysBetween(e.dueMs, e.receivedMs);

  const perMonth = [...groups.keys()].sort().map((m) => {
    const arr = groups.get(m);
    return { month: m, actual: round1(mean(arr, actualOf)), expected: round1(mean(arr, expectedOf)) };
  });
  const overallActual = measured.length ? round1(mean(measured, actualOf)) : null;
  const overallExpected = measured.length ? round1(mean(measured, expectedOf)) : null;
  return { overallActual, overallExpected, perMonth, measuredCount: measured.length };
}

/** Slide-5 by-lab table (facility-normalized, excl. cancelled), total-desc. */
function buildByLab(nonCancelled) {
  const labs = new Map();
  const get = (name) => {
    if (!labs.has(name)) labs.set(name, { lab: name, total: 0, awaitingResult: 0, late: 0 });
    return labs.get(name);
  };
  for (const e of nonCancelled) {
    const L = get(e.facility ?? 'غير محدد');
    L.total++;
    if (e.receivedMs != null && e.resultedMs == null && !e.rejected) L.awaitingResult++;
    // late = COUNTIFS(D=lab, T="Late", N="") — "Late" already excludes cancelled/rejected
    if (e.status === STATUS.LATE && e.resultedMs == null) L.late++;
  }
  return [...labs.values()]
    .map((L) => ({
      ...L,
      latePct: L.awaitingResult > 0 ? round1((L.late / L.awaitingResult) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total || String(a.lab ?? '').localeCompare(String(b.lab ?? '')));
}

/**
 * Slide-5 by-test chart. Late-no-result counted per full test name, but the
 * output is restricted to the curated CHART_TEST_CATALOG (see tat.js) and to
 * nonzero counts. Sorted late-ascending, ties broken by DESCENDING catalog
 * index — reproducing the published bar order exactly.
 */
function buildByTest(nonCancelled, chartTests) {
  const lateByTest = new Map();
  for (const e of nonCancelled) {
    if (e.status === STATUS.LATE && e.resultedMs == null) {
      lateByTest.set(e.testName, (lateByTest.get(e.testName) || 0) + 1);
    }
  }
  const idxOf = new Map();
  chartTests.forEach((name, i) => idxOf.set(normTest(name), i));
  // match catalog entries against data via normTest, but emit the catalog's own label
  const byNorm = new Map();
  for (const [name, cnt] of lateByTest) byNorm.set(normTest(name), (byNorm.get(normTest(name)) || 0) + cnt);

  const rows = [];
  chartTests.forEach((name, i) => {
    const cnt = byNorm.get(normTest(name)) || 0;
    if (cnt > 0) rows.push({ testName: name, late: cnt, _i: i });
  });
  rows.sort((a, b) => a.late - b.late || b._i - a._i);
  return rows.map(({ testName, late }) => ({ testName, late }));
}

/**
 * Port of the KAMC Order-Summary report. Pure function of its inputs.
 * @param {import('../contracts.js').OrderRow[]} rows
 * @param {Object<string, number>} tatLookup  test name → business days
 * @param {Object} [opts]
 * @param {string}  opts.asOf                'YYYY-MM-DD' — the report/TODAY date
 * @param {Object<string,number>} [opts.cancelledByMonth] manual additive cancels (C6)
 * @param {boolean} [opts.tatFallbackFromCsv=true]  use CSV "TAT - Days" on lookup miss
 * @param {string[]} [opts.chartTests]        override the by-test chart catalog
 * @param {{asOf?:string, numbers?:Object<string,number>}} [opts.snapshot]
 *   previous report's published numbers, baseline for the full deltas set (E6).
 *   Legacy {prevCompleted} is tolerated via opts.prevCompleted below.
 * @param {number}  [opts.prevCompleted]      LEGACY baseline for deltas.completed
 *   (used only when opts.snapshot.numbers is absent)
 * @param {boolean} [opts.dedupe=false]       collapse duplicate order-lines first
 * @returns {import('../contracts.js').EngineOutput}
 */
export function compute(rows, tatLookup, opts = {}) {
  const asOfMs = toEpochDay(parseDateTime(opts.asOf));
  if (asOfMs == null) throw new Error('compute: opts.asOf (YYYY-MM-DD) is required');

  const tatIndex = buildTatIndex(tatLookup);
  const chartTests = opts.chartTests || CHART_TEST_CATALOG;
  const cancelledByMonth = opts.cancelledByMonth || {};

  const source = opts.dedupe === true ? dedupeRows(rows) : rows;
  const enriched = source.map((r) => enrichRow(r, tatIndex, asOfMs, opts));

  const nonCancelled = enriched.filter((e) => !e.cancelled);
  const cancelledEnriched = enriched.filter((e) => e.cancelled);

  const totals = {
    lines: source.length,
    cancelledInData: cancelledEnriched.length,
    total: source.length - cancelledEnriched.length,
  };

  const funnel = buildFunnel(nonCancelled);
  const buckets = buildBuckets(nonCancelled);
  const { monthly, cancelledNote } = buildMonthly(
    nonCancelled, cancelledEnriched, cancelledByMonth,
  );
  const t = buildTurnaround(nonCancelled);
  const turnaround = {
    overallActual: t.overallActual,
    overallExpected: t.overallExpected,
    perMonth: t.perMonth,
    measuredCount: t.measuredCount,
  };
  const byLab = buildByLab(nonCancelled);
  const byTest = buildByTest(nonCancelled, chartTests);

  // tests present in the data but absent from the TAT lookup (flagged for review)
  const unmatchedSet = new Set();
  for (const e of enriched) if (!tatIndex.has(normTest(e.testName))) unmatchedSet.add(e.testName);
  const unmatchedTests = [...unmatchedSet].sort();

  // Full deltas set (E6): INCREASE of each published number vs the previous
  // report's snapshot. max(0, current − prev) when prev is a number, else 0.
  // Resolve prev numbers from opts.snapshot.numbers, tolerating legacy shapes:
  // a bare opts.prevCompleted (or a legacy {prevCompleted} snapshot forwarded as
  // opts.prevCompleted) seeds only the completed baseline.
  const prevNumbers =
    opts.snapshot && opts.snapshot.numbers && typeof opts.snapshot.numbers === 'object'
      ? opts.snapshot.numbers
      : opts.prevCompleted != null
        ? { completed: opts.prevCompleted }
        : null;
  const currentNumbers = {
    total: totals.total,
    collected: funnel.collected,
    dispatched: funnel.dispatched,
    received: funnel.received,
    completed: buckets.completed,
    awaitingDispatch: buckets.awaitingDispatch,
    shippedNotReceived: buckets.shippedNotReceived,
    awaitingResults: buckets.awaitingResults,
    lateNoResult: buckets.lateNoResult,
  };
  const deltas = {};
  for (const key of Object.keys(currentNumbers)) {
    const prev = prevNumbers ? prevNumbers[key] : undefined;
    deltas[key] = typeof prev === 'number' ? Math.max(0, currentNumbers[key] - prev) : 0;
  }

  return {
    totals, funnel, buckets, monthly, cancelledNote, turnaround,
    byLab, byTest, unmatchedTests, deltas,
  };
}

export default compute;
