// engine/asof.js — reconstruct the report's 10 headline numbers AS OF any past
// date, from the order rows' OWN timestamps. Lets the page show "last week's
// report numbers" even for days with no recorded snapshot.
//
// This MIRRORS src/engine/engine.js semantics (enrichRow → buildFunnel /
// buildBuckets) but TIME-SHIFTED: every "is present" test the engine writes as
// `<field>Ms != null` becomes "was present by the as-of day", i.e. the field's
// calendar day is on or before the as-of calendar day. It reuses the engine's
// own date helpers (workday.js) and TAT resolution (tat.js) so the day-granular
// LATE rule and StdTAT lookup (incl. the CSV fallback) match the engine exactly.
//
// CROWN INVARIANT — identity at the report date. For a dataset whose current
// state IS its as-of state (no timestamp later than the report date, e.g. the
// 2026-07-09 golden snapshot), computeNumbersAsOf at that date reproduces the
// engine's own 10 numbers exactly: every "≤ asOf" filter then admits every
// non-null value, collapsing to the engine's "!= null" checks, and current
// cancelled/rejected status equals as-of status. See test/asof.test.mjs.
//
// `approx` flags keys whose as-of value is only an approximation, because the
// underlying event has NO timestamp to shift by:
//   • total   — cancellation has no timestamp; membership uses the row's CURRENT
//               cancelled status ∩ orderDate ≤ asOf. Flagged when any cancelled
//               row falls in range (it may not have been cancelled yet back then).
//   • rejected — rejection has no timestamp; a rejected row is dated by its
//               resulted/report datetime when present, else by orderDate ≤ asOf.
//               Flagged when any counted rejected row used the orderDate fallback.

import { parseDateTime, toEpochDay, workday, MS_PER_DAY } from './workday.js?v=v2026-07-23.1';
import { buildTatIndex, resolveTat } from './tat.js?v=v2026-07-23.1';

// engine.js's cascade keys off these exact rawStatus literals (not exported).
const RAW_CANCELLED = 'Order Cancelled';
const RAW_REJECTED = 'Result Rejected';

/** The 10 published numbers, in the app's canonical order (currentNumbersOf). */
export const NUMBER_KEYS = Object.freeze([
  'total', 'collected', 'dispatched', 'received', 'completed', 'rejected',
  'awaitingDispatch', 'shippedNotReceived', 'awaitingResults', 'lateNoResult',
]);

/** Excel INT() of a datetime string → midnight epoch-ms of that UTC day, or null. */
function dayOf(s) {
  return toEpochDay(parseDateTime(s));
}

/** 'YYYY-MM-DD' for a midnight epoch-ms (UTC). Pure, deterministic. */
function isoOf(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Restrict an arbitrary number set to the 10 canonical keys, numbers only. */
function pickNumbers(numbers) {
  const out = {};
  const src = isPlainObject(numbers) ? numbers : {};
  for (const k of NUMBER_KEYS) {
    out[k] = typeof src[k] === 'number' && Number.isFinite(src[k]) ? src[k] : 0;
  }
  return out;
}

/**
 * Reconstruct the 10 headline numbers as of `asOfIso`, from row timestamps.
 * @param {Object} args
 * @param {import('../contracts.js').OrderRow[]} args.rows
 * @param {Object<string,number>} args.tatTests  test name → business days (engine TAT lookup)
 * @param {string} args.asOfIso  'YYYY-MM-DD' — the as-of / TODAY date
 * @param {{tatFallbackFromCsv?:boolean}} [args.opts]  TAT resolution opts (engine defaults: fallback ON)
 * @returns {{numbers:Object<string,number>, approx:Object<string,boolean>}}
 */
export function computeNumbersAsOf({ rows, tatTests, asOfIso, opts = {} } = {}) {
  const asOfDay = toEpochDay(parseDateTime(asOfIso));
  if (asOfDay == null) {
    throw new Error('computeNumbersAsOf: asOfIso (YYYY-MM-DD) is required');
  }
  const tatIndex = buildTatIndex(tatTests);
  const rowsArr = Array.isArray(rows) ? rows : [];

  let total = 0;
  let collected = 0;
  let dispatched = 0;
  let received = 0;
  let completed = 0;
  let rejected = 0;
  let awaitingDispatch = 0;
  let shippedNotReceived = 0;
  let awaitingResults = 0;
  let lateNoResult = 0;

  let cancelledInRange = false; // → approx.total
  let rejectedFallbackUsed = false; // → approx.rejected

  for (const row of rowsArr) {
    const cancelled = row.rawStatus === RAW_CANCELLED;
    const isRejected = row.rawStatus === RAW_REJECTED;

    const orderD = dayOf(row.orderDate);
    const collectedD = dayOf(row.collected);
    const dispatchedD = dayOf(row.dispatched);
    const receivedD = dayOf(row.received);
    const resultedD = dayOf(row.resulted);

    // "existed / happened by the as-of day" — the time-shift of engine's `!= null`.
    const orderByAsOf = orderD != null && orderD <= asOfDay; // scope: rows with orderDate ≤ asOf
    const collectedByAsOf = collectedD != null && collectedD <= asOfDay;
    const dispatchedByAsOf = dispatchedD != null && dispatchedD <= asOfDay;
    const receivedByAsOf = receivedD != null && receivedD <= asOfDay;
    const resultedByAsOf = resultedD != null && resultedD <= asOfDay;

    // Cancelled rows are excluded from ALL 10 non-cancelled numbers, exactly as
    // the engine builds funnel/buckets over nonCancelled. As-of cancellation time
    // is unknowable → approximate membership by CURRENT cancelled status.
    if (cancelled) {
      if (orderByAsOf) cancelledInRange = true;
      continue;
    }

    // total: non-cancelled rows whose order exists by asOf (engine: nonCancelled,
    // all of which have hasCreated in this data).
    if (orderByAsOf) total++;

    // funnel (engine buildFunnel): each field's day ≤ asOf. Engine counts != null;
    // time-shifted, that is "day on or before asOf".
    if (collectedByAsOf) collected++;
    if (dispatchedByAsOf) dispatched++;
    if (receivedByAsOf) received++;

    // completed (engine buildBuckets: resultedMs != null): resulted day ≤ asOf.
    if (resultedByAsOf) completed++;

    // rejected (engine: nonCancelled ∩ rawStatus 'Result Rejected'). No rejection
    // timestamp → date by resulted/report datetime when present, else orderDate.
    if (isRejected) {
      let inRange;
      if (resultedD != null) {
        inRange = resultedD <= asOfDay;
      } else {
        inRange = orderByAsOf;
        if (orderByAsOf) rejectedFallbackUsed = true;
      }
      if (inRange) rejected++;
    }

    // awaitingDispatch (engine: dispatchedMs == null && hasCreated). NB: engine
    // does NOT exclude rejected here — mirror that (no isRejected guard).
    if (orderByAsOf && !dispatchedByAsOf) awaitingDispatch++;

    // shippedNotReceived (engine: dispatchedMs != null && receivedMs == null).
    // Engine does NOT exclude rejected here either — mirror that.
    if (dispatchedByAsOf && !receivedByAsOf) shippedNotReceived++;

    // awaitingResults (engine: receivedMs != null && resultedMs == null && !rejected).
    if (receivedByAsOf && !resultedByAsOf && !isRejected) awaitingResults++;

    // lateNoResult (engine: status === LATE && resultedMs == null). LATE =
    // non-cancelled, non-rejected, received, StdTAT resolved, and DueDate strictly
    // before the as-of day (delay = asOfDay − due > 0). Due = WORKDAY(received, tat)
    // with the engine's exact StdTAT resolution (lookup, then CSV fallback).
    if (!isRejected && receivedByAsOf && !resultedByAsOf) {
      const { tat } = resolveTat(row, tatIndex, opts);
      if (tat != null) {
        const dueMs = workday(receivedD, tat); // workday floors start internally
        if (asOfDay > dueMs) lateNoResult++; // day-granular: due day strictly before asOf day
      }
    }
  }

  const numbers = {
    total, collected, dispatched, received, completed, rejected,
    awaitingDispatch, shippedNotReceived, awaitingResults, lateNoResult,
  };
  const approx = {};
  if (cancelledInRange) approx.total = true;
  if (rejectedFallbackUsed) approx.rejected = true;
  return { numbers, approx };
}

/**
 * Build a rolling window of the 10 numbers for the `days` dates ENDING at endIso
 * (inclusive), oldest → newest. Each date prefers a PUBLISHED snapshot from
 * `history` (settings.snapshotHistory: { 'YYYY-MM-DD': numbers }); otherwise it
 * is COMPUTED via computeNumbersAsOf from the row timestamps. Pure — no Date.now().
 * @param {Object} args
 * @param {import('../contracts.js').OrderRow[]} args.rows
 * @param {Object<string,number>} args.tatTests
 * @param {Object<string,Object<string,number>>} args.history  published-number snapshots by date
 * @param {string} args.endIso  'YYYY-MM-DD' — newest date in the window
 * @param {number} [args.days=7]
 * @param {Object} [args.opts]  forwarded to computeNumbersAsOf (TAT opts)
 * @returns {{date:string, numbers:Object<string,number>, source:('published'|'computed'), approx?:Object}[]}
 */
export function buildWeekNumbers({ rows, tatTests, history, endIso, days = 7, opts = {} } = {}) {
  const endDay = toEpochDay(parseDateTime(endIso));
  if (endDay == null) {
    throw new Error('buildWeekNumbers: endIso (YYYY-MM-DD) is required');
  }
  const n = Math.max(0, Math.trunc(days));
  const hist = isPlainObject(history) ? history : {};
  const out = [];
  // oldest → newest: endDay-(n-1) … endDay
  for (let i = n - 1; i >= 0; i--) {
    const dayMs = endDay - i * MS_PER_DAY;
    const date = isoOf(dayMs);
    const published = hist[date];
    if (isPlainObject(published)) {
      out.push({ date, numbers: pickNumbers(published), source: 'published' });
    } else {
      const { numbers, approx } = computeNumbersAsOf({ rows, tatTests, asOfIso: date, opts });
      const entry = { date, numbers, source: 'computed' };
      if (approx && Object.keys(approx).length > 0) entry.approx = approx;
      out.push(entry);
    }
  }
  return out;
}

export default computeNumbersAsOf;
