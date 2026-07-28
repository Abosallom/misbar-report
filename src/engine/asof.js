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
//               resulted/report datetime when present, else by the LAST milestone
//               the row is known to have reached (received, else dispatched, else
//               orderDate) ≤ asOf. Flagged when any counted rejected row used that
//               milestone fallback.
//   • completed — since 2026-07-28 completed CONTAINS rejected (a rejection is a
//               lab's FINAL outcome, i.e. finished work), so it inherits the
//               rejected key's approximation: flagged on exactly the same
//               condition (a counted rejected row dated by the milestone fallback).
//
// PER-KEY as-of rule (the 10 numbers), all over NON-CANCELLED rows:
//   total              orderDate ≤ asOf
//   collected          collected ≤ asOf
//   dispatched         dispatched ≤ asOf
//   received           received ≤ asOf
//   completed          resulted ≤ asOf  OR  (rejected AND its dated day ≤ asOf)
//   rejected           rawStatus 'Result Rejected' AND dated day ≤ asOf, where the
//                      dated day = resulted day when present, else the LAST
//                      milestone the row is known to have reached: received, else
//                      dispatched, else orderDate
//   awaitingDispatch   orderDate ≤ asOf AND NOT dispatched ≤ asOf
//   shippedNotReceived dispatched ≤ asOf AND NOT received ≤ asOf
//   awaitingResults    received ≤ asOf AND NOT resulted ≤ asOf AND NOT rejected
//   lateNoResult       awaitingResults ∩ StdTAT resolved ∩ due day < asOf day
// completed and rejected share ONE dated-day computation per row (below), so the
// two can never disagree about when a rejected row entered the picture, and a
// rejected row that DOES carry a result date is counted once, not twice.
//
// WHY THE LAST MILESTONE, NOT THE FIRST — a rejection cannot precede receipt.
// Dating an undated rejection by its ORDER day reported the row as finished while
// the very same row was still counted in awaitingDispatch or shippedNotReceived
// (neither excludes rejected, mirroring the engine), breaking the stage partition
//   total = awaitingDispatch + shippedNotReceived + awaitingResults + completed
// on 6 days of the golden range (e.g. 2026-05-19: completed 14 for rows received
// only on 2026-05-20). Harmless while `rejected` was a key no surface summed;
// since completed CONTAINS rejected it would inflate the headline مكتملة and the
// history panel's نسبة الاكتمال. Dating by the last reached milestone is the
// earliest defensible day and restores the partition, while still resolving to
// SOME day for every row so the CROWN identity at a saturated as-of is unchanged.

import { parseDateTime, toEpochDay, workday, MS_PER_DAY } from './workday.js?v=v2026-07-23.7';
import { buildTatIndex, resolveTat } from './tat.js?v=v2026-07-23.7';

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

    // rejected (engine: nonCancelled ∩ rawStatus 'Result Rejected'). No rejection
    // timestamp → date by resulted/report datetime when present, else by the LAST
    // milestone the row is known to have reached (received → dispatched → order).
    // A rejection cannot precede receipt, so the first milestone would date it
    // before the sample physically moved — see the header note on the partition.
    // Computed BEFORE completed because completed now consumes this same flag.
    let rejectedByAsOf = false;
    if (isRejected) {
      if (resultedD != null) {
        rejectedByAsOf = resultedD <= asOfDay;
      } else {
        const datedD = receivedD != null ? receivedD : (dispatchedD != null ? dispatchedD : orderD);
        rejectedByAsOf = datedD != null && datedD <= asOfDay;
        if (rejectedByAsOf) rejectedFallbackUsed = true;
      }
      if (rejectedByAsOf) rejected++;
    }

    // completed (engine buildBuckets, 2026-07-28 rule): a lab's FINAL outcome —
    // resulted day ≤ asOf OR the row is rejected and its dated day ≤ asOf. The
    // OR counts a rejected row that also carries a result date exactly ONCE, so
    // rejected is a SUBSET of completed here, never an addition on top of it.
    if (resultedByAsOf || rejectedByAsOf) completed++;

    // awaitingDispatch / shippedNotReceived — the pre-completion buckets. The engine
    // guards both with !rejected (a rejection is completed work, so it must leave the
    // pipeline), and the identity total = awaitingDispatch + shippedNotReceived +
    // awaitingResults + completed depends on it.
    //
    // Time-shifted, the guard is `rejectedByAsOf`, NOT `isRejected`: a row that is
    // rejected TODAY was still genuinely awaiting dispatch on a date before its
    // rejection was dated. Guarding on isRejected would drop it out of every bucket in
    // that window and break the identity from the other side (total 1, buckets 0).
    // Guarding on rejectedByAsOf keeps every row in exactly ONE bucket on every date.
    if (orderByAsOf && !dispatchedByAsOf && !rejectedByAsOf) awaitingDispatch++;

    if (dispatchedByAsOf && !receivedByAsOf && !rejectedByAsOf) shippedNotReceived++;

    // awaitingResults (engine: receivedMs != null && resultedMs == null && !rejected).
    if (receivedByAsOf && !resultedByAsOf && !rejectedByAsOf) awaitingResults++;

    // lateNoResult (engine: status === LATE && resultedMs == null). LATE =
    // non-cancelled, non-rejected, received, StdTAT resolved, and DueDate strictly
    // before the as-of day (delay = asOfDay − due > 0). Due = WORKDAY(received, tat)
    // with the engine's exact StdTAT resolution (lookup, then CSV fallback).
    // Same time-shifted guard as awaitingResults: a row rejected LATER was genuinely
    // late-without-a-result on the earlier date, and lateNoResult is a subset of
    // awaitingResults, so the two guards must agree or the subset breaks.
    if (!rejectedByAsOf && receivedByAsOf && !resultedByAsOf) {
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
  // completed CONTAINS rejected, so the rejected dating approximation is now a
  // completed approximation too — flagged together, never one without the other.
  if (rejectedFallbackUsed) { approx.rejected = true; approx.completed = true; }
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
