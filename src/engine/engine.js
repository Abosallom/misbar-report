// engine/engine.js — pure JS port of the KAMC Order-Summary Excel report engine.
// compute(rows, tatLookup, opts) -> EngineOutput  (see src/contracts.js).
// No DOM / no Node APIs: runs identically under `node --test` and in the browser.
//
// The exact rules below were reverse-engineered from the source workbook's
// formulas (test/fixtures/summary-tables.json) and verified row-by-row against
// the 628 cached rows in test/fixtures/golden-orders.js. Key semantics:
//   • StdTAT   = XLOOKUP(Test → lookup); miss → CSV "TAT - Days" fallback.
//   • DueDate  = workday(INT(Received), StdTAT)  (excl. start, skip weekends).
//   • Delay    = asOf − DueDate  (whole days).  asOf mirrors the sheet's TODAY().
//   • Status cascade (the sheet's "T" column, incl. resulted rows):
//       Order Cancelled → Cancelled ; Result Rejected → Rejected ;
//       no Received → In Progress / Not Received ; no StdTAT → No Match ;
//       Delay < 0 → On Time ; else → Late.
//     NB: a resulted row is still labelled On Time / Late off asOf−Due, exactly
//     as the workbook does (verified against every _cachedStatus).
//
// TWO STAKEHOLDER RULE CHANGES (Talal, 2026-08-05) DIVERGE FROM THE WORKBOOK:
//   1. WEEKEND = Friday+Saturday (business days Sun–Thu), not Excel's Sat+Sun.
//      See src/engine/workday.js — every DueDate above is computed under the
//      Saudi weekend now, so 189/628 golden due dates moved.
//   2. LATE = due TODAY or overdue (Delay ≥ 0), was strictly past due (Delay > 0).
//      "Due today with no result" means less than 24h of TAT remain and nothing
//      has come back, which the business counts as late.
// Both changes make the golden workbook's _cachedDue/_cachedDelay/_cachedStatus
// an OUT-OF-DATE external oracle for due-derived fields — deliberately.

import { normTest, normFacility } from '../contracts.js?v=v2026-10-07.1';
import {
  parseDateTime, toEpochDay, workday, dayDiff, calDaysBetween, monthKey,
} from './workday.js?v=v2026-10-07.1';
import { buildTatIndex, resolveTat, CHART_TEST_CATALOG } from './tat.js?v=v2026-10-07.1';
import { dedupeRows } from './dedupe.js?v=v2026-10-07.1';
import { fillBlankFacilities } from './infer-facility.js?v=v2026-10-07.1';

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
  // LATE BOUNDARY (Talal 2026-08-05): due TODAY counts as LATE, not On Time.
  // Was `delay <= 0 → ON_TIME` (strictly-past-due), now `delay < 0` — i.e. only
  // a row whose due day is still in the FUTURE is On Time here.
  else if (delay < 0) status = STATUS.ON_TIME;
  else status = STATUS.LATE;

  // "success" = resulted within TAT, DAY-granular: non-cancelled, non-rejected
  // row that has both a Result report date and a Due date, with the resulted
  // calendar day on or before the due calendar day. Independent of asOf/status.
  //
  // THE ASYMMETRY, ON PURPOSE (Talal 2026-08-05) — the due day belongs to the
  // lab until it ends:
  //   • RESULTED on the due day  → onTime  (`resulted ≤ due`, ≤ kept below): the
  //     lab delivered inside its TAT, the last day included.
  //   • UNRESULTED on the due day → LATE   (`delay < 0` cascade above): fewer
  //     than 24h of TAT remain and nothing has come back, which is exactly the
  //     "TAT below 24h AND no result" alarm the business asked for.
  // So the same calendar day reads as a success for a delivered test and as a
  // late one for an undelivered test. That is intended, not a boundary bug.
  const onTime = !cancelled && !rejected && resultedMs != null && dueMs != null
    && toEpochDay(resultedMs) <= toEpochDay(dueMs);

  return {
    row,
    facility: normFacility(row.facility),
    testName: row.testName,
    orderMs, collectedMs, dispatchedMs, receivedMs, resultedMs,
    stdTat: tat, matched, dueMs, delay, status, cancelled, rejected, onTime,
    hasCreated: orderMs != null, // sheet's "col E non-empty" = order exists
  };
}

/**
 * COMPLETED — the single definition every "مكتمل / completed" surface uses.
 *
 * user decision 2026-07-28: "consider rejected as completed test". Rejection is a
 * lab's FINAL outcome for a test, so a rejected line is finished work, not work in
 * progress. A completed line is therefore a non-cancelled line that has reached a
 * terminal state: it either carries a Result report date OR was rejected.
 *
 *   completed = non-cancelled AND (resultedMs != null OR rejected)
 *             = resulted + rejected            (the two are disjoint in practice:
 *               a rejected row never carries a result date in live or golden data,
 *               and the OR keeps the count exact even if one ever did)
 *
 * HISTORY: 2026-07-19 → 2026-07-28 completed counted ONLY dated rows (rejected
 * excluded); before that the workbook's C6 folded rejectedAll in. This restores
 * rejected to the completed side, deliberately.
 *
 * `rejected` is still published as its own value everywhere, but it is now a
 * SUBSET of completed — never add the two together.
 * @param {{resultedMs:number|null, rejected:boolean}} e enriched, already non-cancelled
 */
function isCompleted(e) {
  return e.resultedMs != null || e.rejected;
}

/**
 * THE LADDER — the ONE stage a non-cancelled line sits in: the FURTHEST milestone it
 * has reached (the user's rule: the procedure is a ladder, an order cannot skip a rung,
 * so each order belongs to exactly one stage). Top rung first, so a later milestone
 * WINS over an earlier blank:
 *   completed          isCompleted(): a result date OR rejected
 *   awaitingResults    received, and not completed
 *   shippedNotReceived dispatched, not received, and not completed
 *   awaitingDispatch   everything else — no dispatch, no receipt, not completed.
 *                      NO date is required here, not even an order date: totals.total
 *                      is EVERY non-cancelled line, so the bottom rung must be the
 *                      plain remainder or a dateless line would fall out of all four.
 * A line the source system carried with a LATER date but a blank EARLIER one (a result
 * with no dispatch / receipt scan) did pass the blank rung — the lab cannot result a
 * sample it never received; the scan is what is missing — so it is filed at the rung
 * its latest date proves. model/csv-filter.js stageOf reads the same ladder for the
 * download tool (its notCollected + notShipped = awaitingDispatch here, its resulted +
 * rejected = completed).
 *
 * Exclusive by CONSTRUCTION: a function returns one value, so buildBuckets and
 * buildByLab (which both classify through this) can never count a line twice or drop
 * it — the identity total = Σ stages holds for any data, not just clean data.
 * @param {{resultedMs:number|null, rejected:boolean, receivedMs:number|null,
 *   dispatchedMs:number|null}} e enriched, already non-cancelled
 * @returns {'completed'|'awaitingResults'|'shippedNotReceived'|'awaitingDispatch'}
 */
function ladderStage(e) {
  if (isCompleted(e)) return 'completed';
  if (e.receivedMs != null) return 'awaitingResults';
  if (e.dispatchedMs != null) return 'shippedNotReceived';
  return 'awaitingDispatch';
}

/**
 * Slide-3 funnel — all counts exclude cancelled.
 * FINAL STAGE (user decision 2026-07-28): the funnel ends at COMPLETED, i.e.
 * isCompleted() — a result date OR a rejection, because both are terminal lab
 * outcomes. `completed` is the canonical field; `resulted` is kept as an alias
 * carrying the SAME number so the long-lived override key 'funnel.resulted'
 * (contracts.js, i18n, screen-review) and the slide that reads it can never show a
 * different figure from the exec KPI card. It is NOT the dated-only count anymore.
 *
 * NOT THE LADDER, AND NOT GUARANTEED MONOTONE. Each funnel stage is a CUMULATIVE DATE
 * COUNT — the lines that CARRY that timestamp — not the lines that reached that rung.
 * A skipped-step line (a result recorded with no dispatch / receipt scan, two live KAMC
 * orders on 2026-10-07) is counted at `completed` but at neither `dispatched` nor
 * `received`, so a stage CAN legitimately read below the stage after it (received <
 * completed once enough lines skip the receipt scan). That is the funnel reporting the
 * timestamps the source system actually holds. The four stage cards cannot do this:
 * buildBuckets files every line ONCE, at its furthest rung (ladderStage), so they always
 * sum to total. The golden fixture has no skipped-step rows, so its funnel happens to be
 * monotone — a property of that data, not of this function.
 */
function buildFunnel(nonCancelled) {
  const completed = nonCancelled.filter(isCompleted).length;
  return {
    created: nonCancelled.filter((e) => e.hasCreated).length,
    collected: nonCancelled.filter((e) => e.collectedMs != null).length,
    dispatched: nonCancelled.filter((e) => e.dispatchedMs != null).length,
    received: nonCancelled.filter((e) => e.receivedMs != null).length,
    resulted: completed, // legacy alias of `completed` — same number, by design
    completed,
  };
}

/**
 * Slide-2 status buckets.
 * PARTITION (user decision 2026-07-28; made exclusive by construction 2026-10-07):
 *   total = awaitingDispatch + shippedNotReceived + awaitingResults + completed
 * where total is EVERY non-cancelled line (totals.total) and each line is counted in
 * exactly ONE of the four — its ladderStage(), the furthest milestone it reached.
 * completed follows isCompleted() (result date OR rejected). `rejected` is still
 * reported as its own value but is a SUBSET of completed — it must never be added
 * alongside completed, or the rejected lines get counted twice.
 *
 * WHY THE LADDER (2026-10-07, "the four cards always sum to total + 2"). Each bucket
 * used to test only its OWN rung — awaitingDispatch was "no dispatch date",
 * shippedNotReceived "dispatched, not received" — and nothing excluded the rungs ABOVE.
 * Two live KAMC orders carry order + collected + RESULT dates with no dispatch and no
 * receipt date (status 'Result Approved'), so each sat in awaitingDispatch AND
 * completed. The same hole existed one rung up (dispatched + resulted, no receipt →
 * shippedNotReceived AND completed), and awaitingDispatch also swallowed a line
 * RECEIVED with no dispatch date (→ awaitingDispatch AND awaitingResults). The old
 * `!e.rejected` guards (rejected = completed since 2026-07-28) were the same fix for
 * ONE shape of the problem; ladderStage generalises it to every shape. awaitingDispatch
 * also dropped its order-date requirement (`hasCreated`): total never had one, so a
 * dateless line used to fall out of all four. The golden fixture has no skipped-step
 * and no dateless rows — none of its numbers moved.
 */
function buildBuckets(nonCancelled) {
  const stages = { awaitingDispatch: 0, shippedNotReceived: 0, awaitingResults: 0, completed: 0 };
  for (const e of nonCancelled) stages[ladderStage(e)]++;
  const { awaitingDispatch, shippedNotReceived, awaitingResults, completed } = stages;
  // rejected surfaced as its own value (user decision 2026-07-19): non-cancelled
  // rows whose Order Status was 'Result Rejected'. Since 2026-07-28 it is a SUBSET
  // of completed above (rejection = a terminal outcome), NOT a sibling of it.
  const rejected = nonCancelled.filter((e) => e.rejected).length;
  const lateNoResult = nonCancelled.filter(
    (e) => e.status === STATUS.LATE && e.resultedMs == null,
  ).length;
  const latePct = awaitingResults > 0 ? round1((lateNoResult / awaitingResults) * 100) : 0;
  return {
    awaitingDispatch, shippedNotReceived, awaitingResults, completed, rejected, lateNoResult, latePct,
  };
}

/**
 * Slide-4 monthly breakdown (order-month, excl. cancelled) merged with the
 * manual historical cancelledByMonth constants ADDITIVELY (workbook C6 prompt):
 *   cancelled(m) = countedFromCsv(m) + manualConstants[m]
 * Months present only in the manual map still surface (orders 0, cancelled =
 * manual). This replaces the earlier max(stored, computed) merge.
 *
 * Per-month `results` is the COMPLETED count for that order-month — isCompleted()
 * (a Result report date OR a rejection), user decision 2026-07-28. It is the same
 * rule as buckets.completed / funnel.completed / byLab.completed, so Σ results
 * over the months equals the exec KPI card exactly.
 *
 * PARTITION: each month's orders split into two disjoint states —
 *   orders = results + pending          (pending = orders − results)
 * `rejected` is still reported per month as its own value but is a SUBSET of
 * `results`, so it is NOT a partition term anymore (adding it would double-count).
 * `pending` and `incomplete` are now the SAME number (both orders − results): the
 * 2026-07-22 split existed only because rejected sat outside results, and moving
 * rejected inside completed removes that incoherence. `incomplete` is kept as the
 * name the monthly slide's third row uses; its VALUES change (it no longer
 * double-counts the rejected lines).
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
    // results = the COMPLETED rule (result date OR rejected) for this order-month.
    const results =
      nonCancelled.filter((e) => isCompleted(e) && monthKey(e.orderMs) === m).length;
    // rejected per order-month — own value, but a SUBSET of results above.
    const rejected =
      nonCancelled.filter((e) => e.rejected && monthKey(e.orderMs) === m).length;
    const cancelled = merged.get(m) || 0;
    // pending / incomplete: the partition remainder — orders = results + pending.
    // Same number by construction now that rejected lives inside results; both
    // names are published because both are read downstream.
    const pending = orders - results;
    const incomplete = orders - results;
    const completionPct = orders > 0 ? round1((results / orders) * 100) : null;
    return { month: m, orders, results, rejected, pending, incomplete, completionPct, cancelled };
  });

  return { monthly, cancelledNote };
}

/**
 * Slide-4 turnaround (resulted rows, excl. Rejected). Per order-month + overall.
 * Deliberately NOT the completed set: a rejected line has no result timestamp, so
 * it cannot contribute a received→result duration. measuredCount is therefore
 * `resulted` (422 golden), which is LESS than completed (437) — that is expected.
 *   actual   = mean(resulted − received)  [fractional calendar days]
 *   expected = mean(dueDate − received)    [calendar span of the WORKDAY window]
 * Both keep time-of-day; values are rounded to 1 decimal, report-style.
 */
function buildTurnaround(nonCancelled) {
  // receivedMs/dueMs must be present: calDaysBetween would coerce null to epoch-0
  // and poison the means with ±10,000-day values (dirty rows: resulted with blank
  // Received, or unmatched test with blank CSV TAT). Golden set is unaffected (422).
  // `!e.rejected` is a DELIBERATE SUPERSET of the natural fallout the header describes:
  // rejected rows normally lack a result timestamp and would fall out via resultedMs
  // anyway, but a rejected row that DOES carry one (the completed/rejected dating in
  // asof.js proves the shape exists) must still never be measured — a rejection is not
  // a turnaround, whatever timestamps it carries.
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

/**
 * Slide-5 by-lab table (facility-normalized, excl. cancelled), total-desc.
 *
 * HEADLINE PARTITION (user decision 2026-07-28) — three disjoint states, read off the
 * SAME ladderStage() buildBuckets uses, so each lab's total splits exactly as the exec
 * cards split theirs:
 *   total = pipeline + awaitingResult + completed
 *   • pipeline       = ladder rung awaitingDispatch OR shippedNotReceived: no received
 *                      date AND not completed (pre-receipt: awaiting dispatch / in
 *                      transit). Σ over labs = buckets.awaitingDispatch +
 *                      buckets.shippedNotReceived.
 *   • awaitingResult = rung awaitingResults: received, no result yet, not rejected
 *   • completed      = rung completed — isCompleted(): a result date OR rejected
 *                      (= resulted + rejected)
 * This is the identity the compliance table's columns must add up to. Until 2026-10-07
 * pipeline was "no received date, not rejected" alone, so a line RESULTED with no
 * receipt date (see buildBuckets' WHY THE LADDER) counted in pipeline AND completed and
 * the lab's columns overshot its total.
 *
 * FINER BREAKDOWN of `completed`, all still published, all SUBSETS of it — never
 * add any of them alongside `completed`:
 *   completed = onTime + resultedLate + rejected  (= resulted + rejected)
 *   • onTime       = resulted within due (day-granular "success")
 *   • resultedLate = resulted − onTime: resulted AFTER the due date. Resulted rows
 *                    with NO due (No-Match TAT, dueMs null) also land here so the
 *                    split stays exact.
 *   • rejected     = Result Rejected (own value; terminal outcome, hence completed)
 *   • resulted     = onTime + resultedLate — non-rejected rows WITH a result date
 * `late` (late-no-result, a SUBSET of awaitingResult) and `latePct` are unchanged.
 */
function buildByLab(nonCancelled) {
  const labs = new Map();
  const get = (name) => {
    if (!labs.has(name)) {
      labs.set(name, {
        lab: name, total: 0, pipeline: 0, awaitingResult: 0,
        onTime: 0, resulted: 0, completed: 0, rejected: 0, late: 0,
      });
    }
    return labs.get(name);
  };
  for (const e of nonCancelled) {
    // Reachable only when the blank could NOT be resolved (engine/infer-facility.js
    // already filled every unambiguous one — in compute(), or for a scoped report in
    // applyScope over the FULL rows): the test runs at more than one lab, or the row
    // carries no test name either. Such a row is genuinely unattributable and must
    // stay visible rather than be folded into somebody else's row.
    const L = get(e.facility ?? 'غير محدد');
    L.total++;
    // The headline terms: ONE ladder rung per line, so exactly one of the three moves.
    const stage = ladderStage(e);
    if (stage === 'completed') L.completed++; // result date OR rejected
    else if (stage === 'awaitingResults') L.awaitingResult++;
    else L.pipeline++; // awaitingDispatch or shippedNotReceived — pre-receipt lines
    // resulted: parent of the onTime / resultedLate split (non-rejected, has a result).
    if (!e.rejected && e.resultedMs != null) L.resulted++;
    if (e.onTime) L.onTime++; // resulted within TAT (day-granular "success")
    if (e.rejected) L.rejected++; // rejected count per lab (own value, ⊂ completed)
    // late = COUNTIFS(D=lab, T="Late", N="") — "Late" already excludes cancelled/rejected
    if (e.status === STATUS.LATE && e.resultedMs == null) L.late++;
  }
  return [...labs.values()]
    .map((L) => ({
      lab: L.lab,
      total: L.total,
      pipeline: L.pipeline,
      awaitingResult: L.awaitingResult,
      completed: L.completed, // headline: total = pipeline + awaitingResult + completed
      onTime: L.onTime,
      resulted: L.resulted,
      resultedLate: L.resulted - L.onTime, // resulted after due (+ No-Match resulted)
      rejected: L.rejected,
      late: L.late,
      latePct: L.awaitingResult > 0 ? round1((L.late / L.awaitingResult) * 100) : 0,
    }))
    // ALPHABETICAL by lab, matching the send-out slides (user request 2026-08-31) so
    // the two tables in one deck can be read side by side without re-finding a lab.
    // Previously total-DESC, which put the same labs in a different order on each.
    .sort((a, b) => String(a.lab ?? '').localeCompare(String(b.lab ?? '')));
}

/**
 * Slide-5 by-test chart. Late-no-result AND on-time ("success", resulted within
 * TAT, day-granular) counted per full test name, restricted to the curated
 * CHART_TEST_CATALOG (see tat.js). A catalog entry is emitted when EITHER its
 * late OR its onTime count is nonzero. Sorted late-ascending, ties broken by
 * DESCENDING catalog index — reproducing the published bar order exactly (the
 * onTime column rides along on that same ordering and never affects the sort).
 */
function buildByTest(nonCancelled, chartTests) {
  const lateByTest = new Map();
  const onTimeByTest = new Map();
  for (const e of nonCancelled) {
    if (e.status === STATUS.LATE && e.resultedMs == null) {
      lateByTest.set(e.testName, (lateByTest.get(e.testName) || 0) + 1);
    }
    if (e.onTime) {
      onTimeByTest.set(e.testName, (onTimeByTest.get(e.testName) || 0) + 1);
    }
  }
  // match catalog entries against data via normTest, but emit the catalog's own label
  const lateNorm = new Map();
  for (const [name, cnt] of lateByTest) lateNorm.set(normTest(name), (lateNorm.get(normTest(name)) || 0) + cnt);
  const onTimeNorm = new Map();
  for (const [name, cnt] of onTimeByTest) onTimeNorm.set(normTest(name), (onTimeNorm.get(normTest(name)) || 0) + cnt);

  const rows = [];
  chartTests.forEach((name, i) => {
    const late = lateNorm.get(normTest(name)) || 0;
    const onTime = onTimeNorm.get(normTest(name)) || 0;
    if (late > 0 || onTime > 0) rows.push({ testName: name, late, onTime, _i: i });
  });
  rows.sort((a, b) => a.late - b.late || b._i - a._i);
  return rows.map(({ testName, late, onTime }) => ({ testName, late, onTime }));
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
 * @param {boolean} [opts.excludeNoTat=false] drop rows whose status is 'No Match'
 *   (no StdTAT from lookup OR CSV fallback) BEFORE aggregation. Cancelled/rejected
 *   rows are never 'No Match', so cancelled counting is untouched. The count of
 *   dropped rows surfaces as EngineOutput.excludedNoTat.
 * @param {boolean} [opts.inferBlanks=true]   fill blank facilities from the rows given
 *   (engine/infer-facility.js). Only `=== false` skips it — for rows whose facilities
 *   are ALREADY FINAL, i.e. a scoped report's (model/scope.js "SCOPED ROWS ARE FINAL").
 *   Every other caller omits it, so the full report is computed exactly as before.
 * @returns {import('../contracts.js').EngineOutput}
 */
export function compute(rows, tatLookup, opts = {}) {
  const asOfMs = toEpochDay(parseDateTime(opts.asOf));
  if (asOfMs == null) throw new Error('compute: opts.asOf (YYYY-MM-DD) is required');

  const tatIndex = buildTatIndex(tatLookup);
  const chartTests = opts.chartTests || CHART_TEST_CATALOG;
  const cancelledByMonth = opts.cancelledByMonth || {};

  // A row whose 'Performing facility name' is EMPTY takes the facility of the other
  // orders of the same test, when they all name one lab (engine/infer-facility.js).
  // Without this the hole became its own phantom lab — 'غير محدد' — on the compliance
  // table, while the real lab's row sat one short. An unrecognised NAME is never
  // touched; only a genuinely blank field is filled.
  //
  // opts.inferBlanks === false SKIPS it, and exists for ONE caller: a scoped report.
  // The rule's answer depends on which rows it is shown, so applyScope (model/scope.js)
  // runs it on the FULL row set before filtering; a blank that survives is one the
  // full report leaves unattributed on purpose (its test runs at two labs). Run again
  // here on a shipment or date-range SUBSET holding only one of those labs' rows, it
  // would look settled and credit the order to that lab — a count the full report
  // never gives it. Opt-in, so the unscoped report (which passes nothing, and whose
  // own pass here IS the full-set inference) stays byte-identical.
  const deduped = opts.dedupe === true ? dedupeRows(rows) : rows;
  const source = opts.inferBlanks === false ? deduped : fillBlankFacilities(deduped);
  // enrichedAll keeps EVERY row; unmatchedTests reporting reads from it so the
  // upload warning still lists no-TAT tests even when they are excluded below.
  const enrichedAll = source.map((r) => enrichRow(r, tatIndex, asOfMs, opts));

  // opts.excludeNoTat drops 'No Match' rows (received present, StdTAT null from
  // both lookup and CSV) before ANY aggregation. Cancelled rows resolve to
  // 'Cancelled' in the cascade, never 'No Match', so cancelled counting is safe.
  let enriched = enrichedAll;
  let excludedNoTat = 0;
  if (opts.excludeNoTat === true) {
    enriched = enrichedAll.filter((e) => e.status !== STATUS.NO_MATCH);
    excludedNoTat = enrichedAll.length - enriched.length;
  }

  const nonCancelled = enriched.filter((e) => !e.cancelled);
  const cancelledEnriched = enriched.filter((e) => e.cancelled);

  const totals = {
    lines: enriched.length,
    cancelledInData: cancelledEnriched.length,
    total: enriched.length - cancelledEnriched.length,
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

  // tests present in the data but absent from the TAT lookup (flagged for review).
  // Computed over enrichedAll (pre-exclusion) so excludeNoTat never hides the
  // upload warning for the very rows it drops.
  const unmatchedSet = new Set();
  for (const e of enrichedAll) if (!tatIndex.has(normTest(e.testName))) unmatchedSet.add(e.testName);
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
    rejected: buckets.rejected,
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
    byLab, byTest, unmatchedTests, excludedNoTat, deltas,
  };
}

export default compute;
