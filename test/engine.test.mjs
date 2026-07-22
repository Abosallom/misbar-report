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
import { SNAPSHOT_SEED } from '../src/seeds/defaults.js';

const ZERO_DELTAS = {
  total: 0, collected: 0, dispatched: 0, received: 0, completed: 0, rejected: 0,
  awaitingDispatch: 0, shippedNotReceived: 0, awaitingResults: 0, lateNoResult: 0,
};

test('WORKDAY matches Excel (excl. start, skip weekends)', () => {
  // Thu 2026-04-30 + 3 business days -> Tue 2026-05-05
  assert.equal(workday(parseDateTime('2026-04-30 10:00:00'), 3), parseDateTime('2026-05-05'));
  // Fri + 1 -> next Mon (skip weekend)
  assert.equal(workday(parseDateTime('2026-05-01'), 1), parseDateTime('2026-05-04'));
  // 0 business days -> same day (INT of start)
  assert.equal(workday(parseDateTime('2026-06-18 15:50:16'), 0), parseDateTime('2026-06-18'));
});

test('per-row StdTAT / Due / Delay / Status match all cached workbook fields', () => {
  const idx = new Map(Object.entries(TAT_LOOKUP));
  const asOf = toEpochDay(parseDateTime(goldenOpts().asOf)); // 2026-07-09
  let stdMismatch = 0, dueMismatch = 0, delayMismatch = 0, statusMismatch = 0;

  for (const r of GOLDEN_ORDERS) {
    // resolve StdTAT the same way the engine does (lookup, else CSV fallback)
    let tat = idx.has(r.testName) ? idx.get(r.testName)
      : (r.tatDaysCsv != null && r.tatDaysCsv !== '' ? Number(r.tatDaysCsv) : null);

    if (typeof r._cachedStdTat === 'number' && tat !== r._cachedStdTat) stdMismatch++;

    const recv = parseDateTime(r.received);
    if (recv != null && tat != null) {
      const due = workday(recv, tat);
      const cachedDue = parseDateTime(r._cachedDue);
      if (cachedDue != null && due !== cachedDue) dueMismatch++;
      if (typeof r._cachedDelay === 'number') {
        const delay = Math.round((asOf - due) / 86400000);
        if (delay !== r._cachedDelay) delayMismatch++;
      }
    }

    // full status cascade
    let status;
    if (r.rawStatus === 'Order Cancelled') status = 'Cancelled';
    else if (r.rawStatus === 'Result Rejected') status = 'Rejected';
    else if (recv == null) status = 'In Progress / Not Received';
    else if (tat == null) status = 'No Match';
    else status = (Math.round((asOf - workday(recv, tat)) / 86400000) <= 0) ? 'On Time' : 'Late';
    if (r._cachedStatus !== status) statusMismatch++;
  }

  assert.equal(stdMismatch, 0, 'StdTAT mismatches');
  assert.equal(dueMismatch, 0, 'DueDate mismatches');
  assert.equal(delayMismatch, 0, 'Delay mismatches (asOf=2026-07-09 reproduces every cached Delay)');
  assert.equal(statusMismatch, 0, 'Status cascade mismatches');
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

test('monthly partition: orders = results + rejected + pending (per month AND total)', () => {
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  const acc = { orders: 0, results: 0, rejected: 0, pending: 0 };
  for (const m of out.monthly) {
    // Every month's three disjoint states partition its orders exactly.
    assert.equal(
      m.results + m.rejected + m.pending,
      m.orders,
      `partition holds for ${m.month}`,
    );
    // incomplete stays LEGACY (= orders − results) and double-counts rejected.
    assert.equal(m.incomplete, m.orders - m.results, `legacy incomplete for ${m.month}`);
    for (const k of Object.keys(acc)) acc[k] += m[k];
  }
  // Totals partition too, and total pending = 181.
  assert.equal(acc.results + acc.rejected + acc.pending, acc.orders);
  assert.equal(acc.orders, 618);
  assert.equal(acc.pending, 181);
  // May is where the incoherence was visible: pending 15 vs legacy incomplete 29.
  const may = out.monthly.find((m) => m.month === '2026-05');
  assert.deepEqual(
    { orders: may.orders, results: may.results, rejected: may.rejected, pending: may.pending, incomplete: may.incomplete },
    { orders: 105, results: 76, rejected: 14, pending: 15, incomplete: 29 },
  );
});

test('turnaround (order-month; expected = calendar span of WORKDAY window)', () => {
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  assert.equal(out.turnaround.overallActual, 12.0);
  assert.equal(out.turnaround.overallExpected, 7.0);
  assert.equal(out.turnaround.measuredCount, 422);
  assert.deepEqual(out.turnaround.perMonth, GOLDEN_EXPECTED.turnaround.perMonth);
});

test('byLab + byTest (curated catalog, sum 56)', () => {
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  assert.deepEqual(out.byLab, GOLDEN_EXPECTED.byLab);
  assert.deepEqual(out.byTest, GOLDEN_EXPECTED.byTest);
  assert.equal(out.byTest.reduce((s, t) => s + t.late, 0), 56);
});

test('byLab partition: total = pipeline + awaitingResult + onTime + resultedLate + rejected (per lab AND totals)', () => {
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  const acc = { total: 0, pipeline: 0, awaitingResult: 0, onTime: 0, resulted: 0, resultedLate: 0, rejected: 0 };
  for (const l of out.byLab) {
    // Every row's disjoint states partition its total exactly.
    assert.equal(
      l.pipeline + l.awaitingResult + l.onTime + l.resultedLate + l.rejected,
      l.total,
      `partition holds for ${l.lab}`,
    );
    // resulted is the onTime + resultedLate subtotal.
    assert.equal(l.resulted, l.onTime + l.resultedLate, `resulted subtotal for ${l.lab}`);
    for (const k of Object.keys(acc)) acc[k] += l[k];
  }
  // Totals partition too.
  assert.equal(acc.pipeline + acc.awaitingResult + acc.onTime + acc.resultedLate + acc.rejected, acc.total);
  assert.equal(acc.total, 618);
  assert.equal(acc.pipeline, 22); // = total 618 − received 596 (all pre-receipt lines)
  assert.equal(acc.resulted, 422); // matches completed / funnel.resulted
  assert.equal(acc.resultedLate, 252);
  // Spot values for the top lab (Advanced), where the incoherence was most visible.
  const adv = out.byLab.find((l) => l.lab.startsWith('Advanced'));
  assert.deepEqual(
    {
      total: adv.total, pipeline: adv.pipeline, awaitingResult: adv.awaitingResult,
      onTime: adv.onTime, resulted: adv.resulted, resultedLate: adv.resultedLate, rejected: adv.rejected,
    },
    { total: 301, pipeline: 11, awaitingResult: 89, onTime: 29, resulted: 187, resultedLate: 158, rejected: 14 },
  );
});

test('onTime "success" metric: byLab column sums to 170; byTest catalog sums to 58', () => {
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  // Every byLab row carries an onTime count (day-granular resulted <= due).
  for (const l of out.byLab) assert.equal(typeof l.onTime, 'number');
  assert.equal(out.byLab.reduce((s, l) => s + l.onTime, 0), 170);
  // A catalog test now surfaces when EITHER late>0 OR onTime>0.
  for (const t of out.byTest) assert.equal(typeof t.onTime, 'number');
  assert.equal(out.byTest.reduce((s, t) => s + t.onTime, 0), 58);
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
test('deltas: full snapshot.numbers baseline → only completed rises (+47)', () => {
  // prev = the seed set except completed=375; every other current value equals
  // its prev, so only completed produces a positive delta (422 − 375 = 47).
  const prevNumbers = { ...SNAPSHOT_SEED.numbers, completed: 375 };
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, {
    asOf: goldenOpts().asOf,
    cancelledByMonth: goldenOpts().cancelledByMonth,
    snapshot: { asOf: '2026-07-01', numbers: prevNumbers },
  });
  assert.deepEqual(out.deltas, { ...ZERO_DELTAS, completed: 47 });
});

test('deltas: no snapshot → every delta is 0', () => {
  const opts = goldenOpts();
  delete opts.prevCompleted; // no baseline of any kind
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, opts);
  assert.deepEqual(out.deltas, ZERO_DELTAS);
});

test('deltas: a lower prev rejected → positive rejected delta', () => {
  // prev rejected below current (15) → deltas.rejected = 15 − 10 = 5; completed
  // held at current (422) so it stays 0; every other key equals its seed.
  const prevNumbers = { ...SNAPSHOT_SEED.numbers, completed: 422, rejected: 10 };
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
    snapshot: { asOf: '2026-07-01', numbers: { ...SNAPSHOT_SEED.numbers, completed: 999 } },
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
