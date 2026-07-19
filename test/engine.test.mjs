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
  total: 0, collected: 0, dispatched: 0, received: 0, completed: 0,
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

test('dedupe is a no-op on the clean golden data', () => {
  const a = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());
  const b = compute(GOLDEN_ORDERS, TAT_LOOKUP, { ...goldenOpts(), dedupe: true });
  assert.deepEqual(b.totals, a.totals);
  assert.deepEqual(b.byTest, a.byTest);
});

// ---- deltas (E6: full 9-key set, increase-only) -----------------------------
test('deltas: full snapshot.numbers baseline → only completed rises (+47)', () => {
  // prev = the seed set except completed=390; every other current value equals
  // its prev, so only completed produces a positive delta (437 − 390 = 47).
  const prevNumbers = { ...SNAPSHOT_SEED.numbers, completed: 390 };
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

test('deltas: a lower current value never goes negative (clamped at 0)', () => {
  // prev completed above current → delta clamps to 0, not −N.
  const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, {
    asOf: goldenOpts().asOf,
    cancelledByMonth: goldenOpts().cancelledByMonth,
    snapshot: { asOf: '2026-07-01', numbers: { ...SNAPSHOT_SEED.numbers, completed: 999 } },
  });
  assert.equal(out.deltas.completed, 0);
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
