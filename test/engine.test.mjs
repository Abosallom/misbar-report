// test/engine.test.mjs — `node --test test/engine.test.mjs`
// Asserts the ported engine reproduces the published 09-07-2026 KAMC report.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compute } from '../src/engine/engine.js';
import { workday, parseDateTime, toEpochDay } from '../src/engine/workday.js';
import { runGoldenAssertions, goldenOpts } from './assertions.js';
import { GOLDEN_ORDERS } from './fixtures/golden-orders.js';
import { TAT_LOOKUP } from '../src/seeds/tat-lookup.js';
import { GOLDEN_EXPECTED } from './fixtures/golden-expected.js';

const ZERO_DELTAS = {
  total: 0, collected: 0, dispatched: 0, received: 0, completed: 0, rejected: 0,
  awaitingDispatch: 0, shippedNotReceived: 0, awaitingResults: 0, lateNoResult: 0,
};

/** The engine's OWN ten published numbers for the golden run — the same projection
 *  screen-generate.js persists as a snapshot. The delta tests below build their
 *  "previous report" from THIS, not from the shipped SNAPSHOT_SEED: they are about
 *  the delta ARITHMETIC ("every key except the one I moved must come out 0"), and
 *  deriving the baseline from the engine keeps them true no matter which figures a
 *  rule change moves. The seed-equals-engine identity is a different claim and is
 *  asserted in exactly one place, asof.test.mjs's CROWN test.
 *  (Before 2026-08-05 these read SNAPSHOT_SEED.numbers and broke when the late
 *  boundary moved lateNoResult 67 -> 73 — a false failure about the seed, not
 *  about deltas.) */
function currentGoldenNumbers() {
  const o = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  const { totals: t, funnel: f, buckets: b } = o;
  return {
    total: t.total, collected: f.collected, dispatched: f.dispatched, received: f.received,
    completed: b.completed, rejected: b.rejected, awaitingDispatch: b.awaitingDispatch,
    shippedNotReceived: b.shippedNotReceived, awaitingResults: b.awaitingResults,
    lateNoResult: b.lateNoResult,
  };
}

test('workday() skips the SAUDI weekend — Friday + Saturday (business days Sun-Thu)', () => {
  // 2026-08-05 rule change. This function used to skip Saturday + Sunday, which
  // was Excel's WORKDAY() default and matched the source workbook. That framing
  // is GONE ON PURPOSE: the Excel convention was deliberately replaced by the
  // real Saudi weekend, so "matches Excel WORKDAY" is no longer true and must
  // not be asserted. Only the SHAPE is still Excel's (start day excluded, INT of
  // start, symmetric for negative days).
  //
  // The audit's reference table — Wed/Thu/Sat starts, +2 business days:
  //   Wed 2026-06-03 + 2 -> Sun 2026-06-07  (Thu is day 1; Fri+Sat skipped; Sun is day 2)
  assert.equal(workday(parseDateTime('2026-06-03'), 2), parseDateTime('2026-06-07'));
  //   Thu 2026-06-04 + 2 -> Mon 2026-06-08  (Fri+Sat skipped; Sun 1, Mon 2)
  assert.equal(workday(parseDateTime('2026-06-04'), 2), parseDateTime('2026-06-08'));
  //   Sat 2026-06-06 + 2 -> Mon 2026-06-08  (Sun 1, Mon 2 — a weekend start just
  //   walks forward; it is never itself counted)
  assert.equal(workday(parseDateTime('2026-06-06'), 2), parseDateTime('2026-06-08'));
  // Thursday + 1 -> Sunday: the single-step proof that Fri and Sat are BOTH off.
  assert.equal(workday(parseDateTime('2026-06-04'), 1), parseDateTime('2026-06-07'));
  // Friday + 1 -> Sunday too (Fri is a weekend day, so it cannot be day 1).
  assert.equal(workday(parseDateTime('2026-06-05'), 1), parseDateTime('2026-06-07'));
  // Sunday..Wednesday + 1 is simply the next calendar day — mid-week is unaffected.
  assert.equal(workday(parseDateTime('2026-06-07'), 1), parseDateTime('2026-06-08'));
  // 0 business days -> same day (INT of start), time-of-day dropped. Unchanged.
  assert.equal(workday(parseDateTime('2026-06-18 15:50:16'), 0), parseDateTime('2026-06-18'));
  // Negative days are symmetric: Sun - 1 -> the previous Thursday.
  assert.equal(workday(parseDateTime('2026-06-07'), -1), parseDateTime('2026-06-04'));
});

test('LATE BOUNDARY: due exactly on asOf is LATE; resulted on the due day is ON TIME', () => {
  // Talal 2026-08-05. The two rules point opposite ways ON PURPOSE, and that
  // asymmetry is the whole content of the change:
  //   • an UNRESULTED test whose due day IS today has < 24h of TAT left and no
  //     result to show for it -> it is reported LATE (engine status cascade,
  //     `delay < 0 -> ON_TIME`, so delay === 0 falls through to LATE);
  //   • a test that WAS RESULTED on its due day met the turnaround -> ON TIME
  //     (the success metric is `resulted <= due`, day-granular, unchanged).
  // Same row, same due date, two different answers depending on whether a result
  // exists. Below: received Wed 2026-06-03 + tat 2 -> due Sun 2026-06-07 (Fri/Sat
  // weekend), and asOf is that exact due day.
  const base = {
    orderDate: '2026-06-01', facility: 'Lab Z', orderId: 'B1', lineNo: 1, loinc: null,
    testName: 'BOUNDARY TEST', collected: '2026-06-01', dispatched: '2026-06-02',
    received: '2026-06-03 10:00:00', rawStatus: 'In Progress', tatDaysCsv: 2,
  };
  const DUE = parseDateTime('2026-06-07');
  assert.equal(workday(parseDateTime(base.received), 2), DUE, 'due date precondition');

  // (a) no result, asOf === due day -> LATE, and it is an awaiting-results row.
  const unresulted = compute([base], { 'BOUNDARY TEST': 2 }, { asOf: '2026-06-07' });
  assert.equal(unresulted.buckets.lateNoResult, 1, 'due TODAY with no result is LATE');
  assert.equal(unresulted.buckets.awaitingResults, 1, 'late is a subset of awaitingResults');
  assert.equal(unresulted.byLab[0].late, 1);

  // (b) the day BEFORE due, still no result -> not late (one full day of TAT left).
  const dayBefore = compute([base], { 'BOUNDARY TEST': 2 }, { asOf: '2026-06-04' });
  assert.equal(dayBefore.buckets.lateNoResult, 0, 'due tomorrow is not yet late');

  // (c) RESULTED on the due day -> on time, never late, even though (a) says a
  // row sitting at that same instant with no result is late.
  const resultedOnDue = compute(
    [{ ...base, resulted: '2026-06-07 16:00:00', rawStatus: 'Result Available' }],
    { 'BOUNDARY TEST': 2 }, { asOf: '2026-06-07' },
  );
  assert.equal(resultedOnDue.byLab[0].onTime, 1, 'resulted ON the due day is ON TIME');
  assert.equal(resultedOnDue.byLab[0].resultedLate, 0);
  assert.equal(resultedOnDue.buckets.lateNoResult, 0);

  // (d) resulted the day AFTER due -> late-resulted (the other side of the line).
  const resultedAfter = compute(
    [{ ...base, resulted: '2026-06-08 09:00:00', rawStatus: 'Result Available' }],
    { 'BOUNDARY TEST': 2 }, { asOf: '2026-06-08' },
  );
  assert.equal(resultedAfter.byLab[0].onTime, 0);
  assert.equal(resultedAfter.byLab[0].resultedLate, 1);
});

// SCOPED 2026-08-05. `_cachedDue`, `_cachedDelay` and the On Time / Late values of
// `_cachedStatus` in golden-orders.js are the SOURCE WORKBOOK's outputs, computed
// with Excel's SAT/SUN weekend and the old strictly-past-due late rule. They are an
// EXTERNAL ORACLE — transcribed ground truth that cannot be "fixed" or re-derived —
// and we have now DELIBERATELY DIVERGED from both conventions (Talal's rules 1+2).
// So this test no longer compares due/delay/late-status against the workbook; it
// asserts only the fields those two rules do NOT touch. The due-derived
// expectations are re-derived engine-side instead, in golden-expected.js.
// golden-orders.js rows are never edited.
test('per-row oracle (non-due-derived only): StdTAT + the terminal status branches match the workbook', () => {
  const idx = new Map(Object.entries(TAT_LOOKUP));
  let stdMismatch = 0, statusMismatch = 0, statusChecked = 0;

  for (const r of GOLDEN_ORDERS) {
    // resolve StdTAT the same way the engine does (lookup, else CSV fallback).
    // StdTAT is an input to the due date, never an output of it — weekend-independent.
    const tat = idx.has(r.testName) ? idx.get(r.testName)
      : (r.tatDaysCsv != null && r.tatDaysCsv !== '' ? Number(r.tatDaysCsv) : null);
    if (typeof r._cachedStdTat === 'number' && tat !== r._cachedStdTat) stdMismatch++;

    // Status cascade, but ONLY its due-independent branches. Cancelled / Rejected /
    // not-received / no-TAT are decided before any due date is consulted, so the
    // workbook is still a valid oracle for them. The final On Time vs Late split IS
    // due-derived (both rules move it) and is skipped here on purpose.
    const recv = parseDateTime(r.received);
    let status = null;
    if (r.rawStatus === 'Order Cancelled') status = 'Cancelled';
    else if (r.rawStatus === 'Result Rejected') status = 'Rejected';
    else if (recv == null) status = 'In Progress / Not Received';
    else if (tat == null) status = 'No Match';
    if (status !== null) {
      statusChecked++;
      if (r._cachedStatus !== status) statusMismatch++;
    }
  }

  assert.equal(stdMismatch, 0, 'StdTAT mismatches');
  assert.equal(statusMismatch, 0, 'Status cascade mismatches (due-independent branches only)');
  // Guard the scoping itself: if a future refactor silently emptied the checked
  // set this test would pass vacuously. The golden fixture carries 10 cancelled,
  // 15 rejected, 22 not-received and 2 no-TAT lines.
  assert.ok(statusChecked >= 40, `expected the due-independent branches to cover 40+ rows, got ${statusChecked}`);
});

test('golden aggregates: every published figure reproduces exactly', () => {
  const { pass, failures, checks } = runGoldenAssertions(compute);
  if (!pass) {
    const msg = failures
      .map((f) => `  ✗ ${f.name}\n      expected: ${JSON.stringify(f.expected)}\n      actual:   ${JSON.stringify(f.actual)}`)
      .join('\n');
    assert.fail(`${failures.length}/${checks} golden checks failed:\n${msg}`);
  }
  assert.ok(pass);
});

// Spot checks so a regression names the exact section that broke.
test('totals / funnel / buckets', () => {
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  assert.deepEqual(out.totals, GOLDEN_EXPECTED.totals);
  assert.deepEqual(out.funnel, GOLDEN_EXPECTED.funnel);
  assert.deepEqual(out.buckets, GOLDEN_EXPECTED.buckets);
});

test('monthly + cancelledNote', () => {
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  assert.deepEqual(out.monthly, GOLDEN_EXPECTED.monthly);
  assert.equal(out.cancelledNote, GOLDEN_EXPECTED.cancelledNote);
});

test('monthly partition: orders = results + pending, results follows the completed rule (per month AND total)', () => {
  // 2026-07-28 "rejected counts as completed": each month's `results` is the
  // COMPLETED count (result date OR rejected), so `rejected` is a SUBSET of it and
  // the partition is two-way. pending === incomplete now (both orders − results).
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  const acc = { orders: 0, results: 0, rejected: 0, pending: 0, incomplete: 0 };
  for (const m of out.monthly) {
    assert.equal(m.results + m.pending, m.orders, `partition holds for ${m.month}`);
    assert.equal(m.incomplete, m.orders - m.results, `incomplete for ${m.month}`);
    assert.equal(m.pending, m.incomplete, `pending === incomplete for ${m.month}`);
    // rejected inside results — never a sibling term (would double-count).
    assert.ok(m.rejected <= m.results, `rejected must be a subset of results (${m.month})`);
    for (const k of Object.keys(acc)) acc[k] += m[k];
  }
  // Totals partition too.
  assert.equal(acc.results + acc.pending, acc.orders);
  assert.equal(acc.orders, 618);
  assert.equal(acc.results, 437); // 422 dated + 15 rejected
  assert.equal(acc.pending, 181);
  assert.equal(acc.incomplete, 181); // was 196 under the old rule (double-counted rejected)
  // May carries 14 of the 15 rejected rows — the month where the change is visible.
  const may = out.monthly.find((m) => m.month === '2026-05');
  assert.deepEqual(
    { orders: may.orders, results: may.results, rejected: may.rejected, pending: may.pending, incomplete: may.incomplete },
    { orders: 105, results: 90, rejected: 14, pending: 15, incomplete: 15 }, // results was 76, incomplete was 29
  );
});

test('turnaround (order-month; expected = calendar span of WORKDAY window)', () => {
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  assert.equal(out.turnaround.overallActual, 12.0);
  // RE-BASELINED 2026-08-05: 7.0 -> 7.4. `expected` is the CALENDAR span of the
  // received->due window, and the Fri+Sat weekend makes that window longer in
  // calendar days than the old Sat+Sun one. Actual (12.0) is timestamp-to-
  // timestamp and involves no due date, so it does not move.
  assert.equal(out.turnaround.overallExpected, 7.4);
  // 422, NOT completed (437): a rejected line has no result timestamp to measure.
  assert.equal(out.turnaround.measuredCount, 422);
  assert.deepEqual(out.turnaround.perMonth, GOLDEN_EXPECTED.turnaround.perMonth);
});

test('byLab + byTest (curated catalog, late sum 58)', () => {
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  assert.deepEqual(out.byLab, GOLDEN_EXPECTED.byLab);
  assert.deepEqual(out.byTest, GOLDEN_EXPECTED.byTest);
  // RE-BASELINED 2026-08-05: 56 -> 58 (weekend flip + the due-today-is-late rule).
  assert.equal(out.byTest.reduce((s, t) => s + t.late, 0), 58);
});

test('byLab partition: total = pipeline + awaitingResult + completed (per lab AND totals)', () => {
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  const acc = {
    total: 0, pipeline: 0, awaitingResult: 0, completed: 0,
    onTime: 0, resulted: 0, resultedLate: 0, rejected: 0,
  };
  for (const l of out.byLab) {
    // HEADLINE identity (2026-07-28): three disjoint states partition the total.
    assert.equal(
      l.pipeline + l.awaitingResult + l.completed,
      l.total,
      `headline partition holds for ${l.lab}`,
    );
    // completed = resulted + rejected, and rejected is INSIDE it (no double count).
    assert.equal(l.completed, l.resulted + l.rejected, `completed = resulted + rejected for ${l.lab}`);
    assert.ok(l.rejected <= l.completed, `rejected must be a subset of completed (${l.lab})`);
    // The finer 5-way split is still exactly true — completed groups its last three.
    assert.equal(
      l.pipeline + l.awaitingResult + l.onTime + l.resultedLate + l.rejected,
      l.total,
      `finer partition holds for ${l.lab}`,
    );
    // resulted is the onTime + resultedLate subtotal.
    assert.equal(l.resulted, l.onTime + l.resultedLate, `resulted subtotal for ${l.lab}`);
    for (const k of Object.keys(acc)) acc[k] += l[k];
  }
  // Totals partition too.
  assert.equal(acc.pipeline + acc.awaitingResult + acc.completed, acc.total);
  assert.equal(acc.pipeline + acc.awaitingResult + acc.onTime + acc.resultedLate + acc.rejected, acc.total);
  assert.equal(acc.total, 618);
  assert.equal(acc.pipeline, 22); // = total 618 − received 596 (all pre-receipt lines)
  assert.equal(acc.completed, 437); // matches buckets.completed / funnel.completed
  assert.equal(acc.resulted, 422); // dated-only subtotal (was the old completed)
  assert.equal(acc.resultedLate, 227); // RE-BASELINED 2026-08-05: was 252 (weekend flip)
  assert.equal(acc.rejected, 15); // 437 − 422 = exactly the rejected rows
  // Spot values for the top lab (Advanced), which carries 14 of the 15 rejected rows.
  const adv = out.byLab.find((l) => l.lab.startsWith('Advanced'));
  assert.deepEqual(
    {
      total: adv.total, pipeline: adv.pipeline, awaitingResult: adv.awaitingResult,
      completed: adv.completed, onTime: adv.onTime, resulted: adv.resulted,
      resultedLate: adv.resultedLate, rejected: adv.rejected,
    },
    {
      // total / pipeline / awaitingResult / completed / resulted / rejected are
      // UNCHANGED (the invariant). onTime 29 -> 31 and resultedLate 158 -> 156
      // are the 2026-08-05 weekend flip; their sum is still `resulted` = 187.
      total: 301, pipeline: 11, awaitingResult: 89, completed: 201,
      onTime: 31, resulted: 187, resultedLate: 156, rejected: 14,
    },
  );
});

test('COMPLETED means the same thing on every surface (exec KPI, compliance, monthly, funnel)', () => {
  // The user-visible invariant of the 2026-07-28 change: one definition, one number.
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  const perLab = out.byLab.reduce((s, l) => s + l.completed, 0);
  const perMonth = out.monthly.reduce((s, m) => s + m.results, 0);
  assert.equal(out.buckets.completed, 437, 'exec KPI card');
  assert.equal(perLab, out.buckets.completed, 'compliance column Σ vs exec card');
  assert.equal(perMonth, out.buckets.completed, 'monthly results row Σ vs exec card');
  assert.equal(out.funnel.completed, out.buckets.completed, 'funnel final stage vs exec card');
  assert.equal(out.funnel.resulted, out.funnel.completed, 'legacy funnel.resulted alias');

  // Rejected is reported, and it is INSIDE completed — the whole point of the change.
  assert.equal(out.buckets.rejected, 15);
  assert.equal(out.buckets.completed - out.buckets.rejected, 422, 'completed − rejected = dated-only');
  // Stage partition with rejected folded in: no bucket is counted twice.
  const b = out.buckets;
  assert.equal(
    b.awaitingDispatch + b.shippedNotReceived + b.awaitingResults + b.completed,
    out.totals.total,
    'total = awaitingDispatch + shippedNotReceived + awaitingResults + completed',
  );
});

test('a rejected row that DOES carry a result date is counted ONCE, not twice', () => {
  // completed uses OR, not addition, so the surfaces stay equal even on data where
  // the "rejected rows have a blank result date" property of today's CSVs breaks.
  const donor = GOLDEN_ORDERS.find((r) => r.rawStatus !== 'Order Cancelled' && r.resulted);
  const synthetic = [...GOLDEN_ORDERS, { ...donor, rawStatus: 'Result Rejected' }];
  const out = compute(synthetic, TAT_LOOKUP, goldenOpts());
  assert.equal(out.buckets.completed, 438, 'one extra completed line, not two');
  assert.equal(out.buckets.rejected, 16);
  const perLab = out.byLab.reduce((s, l) => s + l.completed, 0);
  assert.equal(perLab, out.buckets.completed, 'compliance Σ still equals the exec card');
  assert.equal(out.funnel.completed, out.buckets.completed, 'funnel still equals the exec card');
  assert.equal(
    out.monthly.reduce((s, m) => s + m.results, 0), out.buckets.completed,
    'monthly Σ still equals the exec card',
  );
  for (const l of out.byLab) {
    assert.equal(l.pipeline + l.awaitingResult + l.completed, l.total, `partition holds for ${l.lab}`);
  }
});

test('onTime "success" metric: byLab column sums to 195; byTest catalog sums to 60', () => {
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  // Every byLab row carries an onTime count (day-granular resulted <= due).
  // RE-BASELINED 2026-08-05: 170 -> 195. The Fri+Sat weekend pushes 189 of the
  // fixture's due dates later, so rows that missed the old due date now meet it.
  // The success rule itself (resulted <= due, INCLUSIVE) did not change.
  for (const l of out.byLab) assert.equal(typeof l.onTime, 'number');
  assert.equal(out.byLab.reduce((s, l) => s + l.onTime, 0), 195);
  // A catalog test now surfaces when EITHER late>0 OR onTime>0. 58 -> 60.
  for (const t of out.byTest) assert.equal(typeof t.onTime, 'number');
  assert.equal(out.byTest.reduce((s, t) => s + t.onTime, 0), 60);
  // onTime-only tests (late 0) are included; BK Virus is the top success test.
  const bk = out.byTest.find((t) => t.testName.includes('BK VIRUS'));
  assert.ok(bk && bk.late === 0 && bk.onTime === 20);
});

test('dedupe is a no-op on the clean golden data', () => {
  const a = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  const b = compute(GOLDEN_ORDERS, TAT_LOOKUP, { ...goldenOpts(), dedupe: true });
  assert.deepEqual(b.totals, a.totals);
  assert.deepEqual(b.byTest, a.byTest);
});

// ---- deltas (E6: full 9-key set, increase-only) -----------------------------
test('deltas: full snapshot.numbers baseline → only completed rises (+62)', () => {
  // prev = the seed set except completed=375; every other current value equals
  // its prev, so only completed produces a positive delta (437 − 375 = 62).
  // Was 47 when completed was the dated-only 422 (2026-07-28 definition change).
  const prevNumbers = { ...currentGoldenNumbers(), completed: 375 };
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, {
    asOf: goldenOpts().asOf,
    cancelledByMonth: goldenOpts().cancelledByMonth,
    snapshot: { asOf: '2026-07-01', numbers: prevNumbers },
  });
  assert.deepEqual(out.deltas, { ...ZERO_DELTAS, completed: 62 });
});

test('deltas: no snapshot → every delta is 0', () => {
  const opts = goldenOpts();
  delete opts.prevCompleted; // no baseline of any kind
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, opts);
  assert.deepEqual(out.deltas, ZERO_DELTAS);
});

test('deltas: a lower prev rejected → positive rejected delta', () => {
  // prev rejected below current (15) → deltas.rejected = 15 − 10 = 5; completed
  // held at current (437) so it stays 0; every other key equals its seed.
  const prevNumbers = { ...currentGoldenNumbers(), completed: 437, rejected: 10 };
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, {
    asOf: goldenOpts().asOf,
    cancelledByMonth: goldenOpts().cancelledByMonth,
    snapshot: { asOf: '2026-07-01', numbers: prevNumbers },
  });
  assert.deepEqual(out.deltas, { ...ZERO_DELTAS, rejected: 5 });
});

test('deltas: a lower current value never goes negative (clamped at 0)', () => {
  // prev completed above current → delta clamps to 0, not −N.
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, {
    asOf: goldenOpts().asOf,
    cancelledByMonth: goldenOpts().cancelledByMonth,
    snapshot: { asOf: '2026-07-01', numbers: { ...currentGoldenNumbers(), completed: 999 } },
  });
  assert.equal(out.deltas.completed, 0);
});

// ---- excludeNoTat (drop 'No Match' rows before aggregation) -----------------
const SYN_TAT = { 'KNOWN TEST': 3 };
// Four synthetic lines: one matched+resulted, two no-TAT (No Match), one no-TAT
// but CANCELLED (must survive as cancelled, never treated as No Match).
function synRows() {
  return [
    { orderDate: '2026-07-01', facility: 'Lab A', orderId: '1', lineNo: 1, loinc: 'X', testName: 'KNOWN TEST', collected: '2026-07-01', dispatched: '2026-07-01', received: '2026-07-02', resulted: '2026-07-03', rawStatus: 'Result Available', tatDaysCsv: null },
    { orderDate: '2026-07-01', facility: 'Lab A', orderId: '2', lineNo: 1, loinc: null, testName: 'MYSTERY A', collected: '2026-07-01', dispatched: '2026-07-01', received: '2026-07-02', resulted: null, rawStatus: 'In Progress', tatDaysCsv: null },
    { orderDate: '2026-07-01', facility: 'Lab B', orderId: '3', lineNo: 1, loinc: null, testName: 'MYSTERY B', collected: '2026-07-01', dispatched: '2026-07-01', received: '2026-07-02', resulted: null, rawStatus: 'In Progress', tatDaysCsv: '' },
    { orderDate: '2026-07-01', facility: 'Lab A', orderId: '4', lineNo: 1, loinc: null, testName: 'MYSTERY C', collected: null, dispatched: null, received: null, resulted: null, rawStatus: 'Order Cancelled', tatDaysCsv: null },
  ];
}

test('excludeNoTat off (default): golden output unchanged and excludedNoTat = 0', () => {
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  assert.equal(out.excludedNoTat, 0);
  assert.deepEqual(out.totals, GOLDEN_EXPECTED.totals);
  // Explicit false behaves identically to the default (off).
  const off = compute(GOLDEN_ORDERS, TAT_LOOKUP, { ...goldenOpts(), excludeNoTat: false });
  assert.equal(off.excludedNoTat, 0);
  assert.deepEqual(off.totals, GOLDEN_EXPECTED.totals);
});

test('excludeNoTat on: drops the 2 No-Match rows; totals shrink by 2; excludedNoTat = 2', () => {
  const off = compute(synRows(), SYN_TAT, { asOf: '2026-07-09' });
  assert.equal(off.excludedNoTat, 0);
  assert.deepEqual(off.totals, { lines: 4, cancelledInData: 1, total: 3 });

  const on = compute(synRows(), SYN_TAT, { asOf: '2026-07-09', excludeNoTat: true });
  assert.equal(on.excludedNoTat, 2);
  assert.deepEqual(on.totals, { lines: 2, cancelledInData: 1, total: 1 });
  // Totals shrank by exactly the 2 dropped rows.
  assert.equal(on.totals.lines, off.totals.lines - 2);
  assert.equal(on.totals.total, off.totals.total - 2);
  // unmatchedTests still reports the dropped tests (pre-exclusion warning).
  assert.ok(on.unmatchedTests.includes('MYSTERY A'));
  assert.ok(on.unmatchedTests.includes('MYSTERY B'));
});

test('excludeNoTat never drops a no-TAT CANCELLED row from cancelled counting', () => {
  const on = compute(synRows(), SYN_TAT, { asOf: '2026-07-09', excludeNoTat: true });
  // The cancelled MYSTERY C line has no TAT but is 'Cancelled', not 'No Match'.
  assert.equal(on.totals.cancelledInData, 1);
  // Only the 2 non-cancelled No-Match rows were excluded.
  assert.equal(on.excludedNoTat, 2);
});

// ---- additive cancelled (C6) ------------------------------------------------
test('manual-only cancelled month surfaces (orders 0, cancelled = manual)', () => {
  // 2026-01 has no orders and no in-data cancels; it appears solely from the
  // manual constant (8), with orders 0.
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  const jan = out.monthly.find((m) => m.month === '2026-01');
  assert.ok(jan, '2026-01 present in monthly');
  assert.equal(jan.cancelled, 8);
  assert.equal(jan.orders, 0);
  assert.equal(jan.results, 0);
});
