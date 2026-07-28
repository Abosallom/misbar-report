// test/assertions.js — golden assertions shared by node:test and the browser
// selftest page. Pure ES module: no node:test, no DOM. Give it a compute fn and
// it returns { pass, failures[] } where each failure is {name, expected, actual}.

import { GOLDEN_ORDERS } from './fixtures/golden-orders.js';
import { TAT_LOOKUP } from '../src/seeds/tat-lookup.js';
import {
  GOLDEN_EXPECTED, GOLDEN_ASOF, GOLDEN_CANCELLED_BY_MONTH, GOLDEN_PREV_COMPLETED,
} from './fixtures/golden-expected.js';

/** Options for the published golden run. */
export function goldenOpts() {
  return {
    asOf: GOLDEN_ASOF,
    cancelledByMonth: { ...GOLDEN_CANCELLED_BY_MONTH },
    tatFallbackFromCsv: true,
    prevCompleted: GOLDEN_PREV_COMPLETED,
  };
}

function isObj(x) { return x !== null && typeof x === 'object'; }

/** Deep structural equality for the plain data the engine emits. */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Run every golden assertion against a compute implementation.
 * @param {(rows:any[], tatLookup:object, opts:object)=>object} computeFn
 * @returns {{pass:boolean, failures:{name:string, expected:any, actual:any}[], checks:number}}
 */
export function runGoldenAssertions(computeFn) {
  const failures = [];
  let checks = 0;
  const check = (name, expected, actual) => {
    checks++;
    if (!deepEqual(expected, actual)) failures.push({ name, expected, actual });
  };

  let out;
  try {
    out = computeFn(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  } catch (err) {
    return { pass: false, checks: 1, failures: [{ name: 'compute() threw', expected: 'EngineOutput', actual: String(err && err.stack || err) }] };
  }
  const G = GOLDEN_EXPECTED;

  // 1. totals
  check('totals', G.totals, out.totals);

  // 2. funnel
  check('funnel', G.funnel, out.funnel);

  // 3. buckets
  check('buckets', G.buckets, out.buckets);

  // 4. monthly
  check('monthly[] length', G.monthly.length, out.monthly.length);
  for (const exp of G.monthly) {
    const got = (out.monthly || []).find((m) => m.month === exp.month);
    check(`monthly ${exp.month}`, exp, got);
  }
  // Per-month PARTITION identity (user decision 2026-07-28, "rejected counts as
  // completed"): orders = results + pending, where `results` IS the completed
  // count (result date OR rejected). `rejected` is a SUBSET of `results`, never a
  // sibling term — adding it back would double-count every rejected line.
  for (const m of out.monthly || []) {
    check(`monthly partition ${m.month}`, m.orders, m.results + m.pending);
    check(`monthly rejected subset of results ${m.month}`, true, m.rejected <= m.results);
  }
  // derived monthly totals
  const mt = (out.monthly || []).reduce(
    (a, m) => ({
      orders: a.orders + m.orders,
      results: a.results + m.results,
      rejected: a.rejected + m.rejected,
      pending: a.pending + m.pending,
      incomplete: a.incomplete + m.incomplete,
    }),
    { orders: 0, results: 0, rejected: 0, pending: 0, incomplete: 0 },
  );
  check('monthly totals: orders', G.monthlyTotals.orders, mt.orders);
  check('monthly totals: results', G.monthlyTotals.results, mt.results);
  check('monthly totals: rejected', G.monthlyTotals.rejected, mt.rejected);
  check('monthly totals: pending', G.monthlyTotals.pending, mt.pending);
  check('monthly totals: incomplete', G.monthlyTotals.incomplete, mt.incomplete);
  // Totals-level partition identity: orders = results + pending, rejected ⊂ results.
  check('monthly totals partition', mt.orders, mt.results + mt.pending);
  check('monthly totals: rejected subset of results', true, mt.rejected <= mt.results);
  check(
    'monthly totals: completionPct',
    G.monthlyTotals.completionPct,
    mt.orders ? Math.round((mt.results / mt.orders) * 1000) / 10 : null,
  );
  check('cancelledNote', G.cancelledNote, out.cancelledNote);

  // 5. turnaround
  check('turnaround.overallActual', G.turnaround.overallActual, out.turnaround.overallActual);
  check('turnaround.overallExpected', G.turnaround.overallExpected, out.turnaround.overallExpected);
  check('turnaround.measuredCount', G.turnaround.measuredCount, out.turnaround.measuredCount);
  check('turnaround.perMonth[] length', G.turnaround.perMonth.length, (out.turnaround.perMonth || []).length);
  for (const exp of G.turnaround.perMonth) {
    const got = (out.turnaround.perMonth || []).find((m) => m.month === exp.month);
    check(`turnaround ${exp.month}`, exp, got);
  }

  // 6. byLab
  check('byLab (ordered array)', G.byLab, out.byLab);
  // Partition identity: every row's disjoint states sum to its total, and the
  // resulted subtotal = onTime + resultedLate. This is the user-visible coherence
  // the compliance table depends on.
  for (const l of out.byLab || []) {
    // HEADLINE three-way partition (2026-07-28): total = pipeline + awaitingResult
    // + completed, with completed = a result date OR rejected. This is the identity
    // the exec KPI card, the compliance column, the monthly results row and the
    // funnel's final stage all have to agree on.
    check(
      `byLab completed partition ${l.lab}`,
      l.total,
      l.pipeline + l.awaitingResult + l.completed,
    );
    // FINER breakdown of `completed`, all subsets of it — never added alongside it.
    check(`byLab completed subtotal ${l.lab}`, l.completed, l.resulted + l.rejected);
    check(
      `byLab partition ${l.lab}`,
      l.total,
      l.pipeline + l.awaitingResult + l.onTime + l.resultedLate + l.rejected,
    );
    check(`byLab resulted subtotal ${l.lab}`, l.resulted, l.onTime + l.resultedLate);
  }
  const lt = (out.byLab || []).reduce(
    (a, l) => ({
      total: a.total + l.total,
      pipeline: a.pipeline + l.pipeline,
      awaitingResult: a.awaitingResult + l.awaitingResult,
      completed: a.completed + l.completed,
      onTime: a.onTime + l.onTime,
      resulted: a.resulted + l.resulted,
      resultedLate: a.resultedLate + l.resultedLate,
      rejected: a.rejected + l.rejected,
      late: a.late + l.late,
    }),
    { total: 0, pipeline: 0, awaitingResult: 0, completed: 0, onTime: 0, resulted: 0, resultedLate: 0, rejected: 0, late: 0 },
  );
  check('byLab totals: total', G.byLabTotals.total, lt.total);
  check('byLab totals: pipeline', G.byLabTotals.pipeline, lt.pipeline);
  check('byLab totals: awaitingResult', G.byLabTotals.awaitingResult, lt.awaitingResult);
  check('byLab totals: completed', G.byLabTotals.completed, lt.completed);
  check('byLab totals: onTime', G.byLabTotals.onTime, lt.onTime);
  check('byLab totals: resulted', G.byLabTotals.resulted, lt.resulted);
  check('byLab totals: resultedLate', G.byLabTotals.resultedLate, lt.resultedLate);
  check('byLab totals: rejected', G.byLabTotals.rejected, lt.rejected);
  check('byLab totals: late', G.byLabTotals.late, lt.late);
  check(
    'byLab totals: latePct',
    G.byLabTotals.latePct,
    lt.awaitingResult ? Math.round((lt.late / lt.awaitingResult) * 1000) / 10 : 0,
  );
  // Totals-level partition identities: the headline three-way first, then the
  // finer breakdown of `completed` it expands into.
  check(
    'byLab totals completed partition',
    lt.total,
    lt.pipeline + lt.awaitingResult + lt.completed,
  );
  check('byLab totals: completed subtotal', lt.completed, lt.resulted + lt.rejected);
  check(
    'byLab totals partition',
    lt.total,
    lt.pipeline + lt.awaitingResult + lt.onTime + lt.resultedLate + lt.rejected,
  );

  // 6b. ONE completed number across every surface. The exec KPI card (buckets),
  // the funnel's final stage, the compliance table's column (byLab) and the
  // monthly results row must all publish the same total, or a reader comparing
  // two slides sees the deck contradict itself.
  const completedKPI = out.buckets?.completed;
  check('completed agrees: funnel final stage', completedKPI, out.funnel?.completed);
  check('completed agrees: funnel resulted alias', completedKPI, out.funnel?.resulted);
  check('completed agrees: byLab column total', completedKPI, lt.completed);
  check('completed agrees: monthly results row', completedKPI, mt.results);
  // Exec bucket partition: the four states tile totals.total exactly, with
  // rejected living INSIDE completed (adding it as a fifth term double-counts).
  check(
    'buckets partition',
    out.totals?.total,
    out.buckets?.awaitingDispatch + out.buckets?.shippedNotReceived
      + out.buckets?.awaitingResults + out.buckets?.completed,
  );
  check('buckets: rejected subset of completed', true, out.buckets?.rejected <= completedKPI);

  // 7. byTest (exact ordered array + late sum + onTime sum)
  check('byTest (ordered array)', G.byTest, out.byTest);
  check('byTest sum', G.byTestSum, (out.byTest || []).reduce((s, t) => s + t.late, 0));
  check('byTest onTime sum', G.byTestOnTimeSum, (out.byTest || []).reduce((s, t) => s + t.onTime, 0));

  // 8. unmatchedTests
  check('unmatchedTests', G.unmatchedTests, out.unmatchedTests);

  // 9. deltas
  check('deltas', G.deltas, out.deltas);

  return { pass: failures.length === 0, failures, checks };
}

export default runGoldenAssertions;
