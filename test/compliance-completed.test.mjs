// test/compliance-completed.test.mjs — run with:  node --test
//
// Locks the compliance slide's 'فحوصات مكتملة' (completed tests) column, added
// 2026-07-27 to buildCompliance (src/slidespec/build-spec.js).
//
// WHAT THE NUMBER MEANS (established from src/engine/engine.js buildByLab):
//   byLab.resulted = non-cancelled, NOT rejected, resultedMs != null
//                  = onTime + resultedLate  (the two halves of "has a result date")
// The documented per-lab partition (engine.js, buildByLab doc comment) is
//   total = pipeline + awaitingResult + onTime + resultedLate + rejected
// i.e. with the convenience subtotal:
//   total = pipeline + awaitingResult + resulted + rejected
// so the new column is exactly the missing partition term, not a derived ratio.
//
// RELATION TO THE EXEC CARD: the exec slide's 'فحوصات مكتملة' KPI is
// buckets.completed = nonCancelled.filter(e => e.resultedMs != null) — it does
// NOT exclude rejected rows. byLab.resulted DOES. The two therefore differ by
// exactly the number of rejected rows that carry a result date. That count is 0
// in the golden set and 0 in live data, so the surfaces agree today; the last
// test below pins the divergence explicitly so a future data shape that breaks
// the agreement fails here instead of shipping two different numbers for the
// same Arabic label on two slides.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compute } from '../src/engine/engine.js';
import { buildSpec } from '../src/slidespec/build-spec.js';
import { goldenOpts } from './assertions.js';
import { GOLDEN_ORDERS } from './fixtures/golden-orders.js';
import { TAT_LOOKUP } from '../src/seeds/tat-lookup.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';

const OUT = compute(GOLDEN_ORDERS, TAT_LOOKUP, goldenOpts());

// The table is authored in logical (RTL right→left) order and emitted through
// rev(); un-reverse to read it back in the authored order:
//   [#, lab, total, completed, awaitingResult, rejected, late, latePct]
const COL = { hash: 0, lab: 1, total: 2, completed: 3, awaiting: 4, rejected: 5, late: 6, latePct: 7 };
const logical = (row) => row.slice().reverse();
const cellText = (c) => (c && typeof c === 'object' ? c.text : c);

function complianceTable(engineOutput) {
  const spec = buildSpec({ ...MOCK_REPORT_MODEL, kpi: engineOutput }, { variant: 'internal' });
  const slide = spec.find((s) => s.id === 'compliance');
  assert.ok(slide, 'compliance slide is missing from the spec');
  const table = slide.elements.find((e) => e.t === 'table');
  assert.ok(table, 'compliance slide has no table');
  return table;
}

test('compliance table has the 8-column shape with فحوصات مكتملة in the completed slot', () => {
  const table = complianceTable(OUT);
  const header = logical(table.rows[0]);
  assert.equal(header.length, 8, 'header must have 8 columns');
  assert.equal(cellText(header[COL.completed]), 'فحوصات مكتملة');
  assert.equal(cellText(header[COL.total]), 'مجموع الطلبات');
  assert.equal(table.colW.length, 8, 'colW must have one width per column');
  // widths still budget to the authored table width
  assert.ok(
    Math.abs(table.colW.reduce((s, w) => s + w, 0) - table.w) < 1e-9,
    `colW sums to ${table.colW.reduce((s, w) => s + w, 0)}, expected ${table.w}`,
  );
  // header + one row per lab + totals row
  assert.equal(table.rows.length, OUT.byLab.length + 2);
});

test('per-lab completed cell equals the engine byLab `resulted` for that lab', () => {
  const table = complianceTable(OUT);
  const labRows = table.rows.slice(1, -1);
  assert.equal(labRows.length, OUT.byLab.length);
  labRows.forEach((raw, i) => {
    const row = logical(raw);
    const lab = OUT.byLab[i];
    assert.equal(cellText(row[COL.lab]), lab.lab, `row ${i} lab name`);
    assert.equal(
      cellText(row[COL.completed]), String(lab.resulted),
      `row ${i} (${lab.lab}) completed cell must be byLab.resulted`,
    );
    // and `resulted` really is "has a result date" = the onTime/late split's parent
    assert.equal(
      lab.resulted, lab.onTime + lab.resultedLate,
      `${lab.lab}: resulted must equal onTime + resultedLate`,
    );
    // the other columns stay wired to their own engine fields (no shifted column)
    assert.equal(cellText(row[COL.total]), String(lab.total));
    assert.equal(cellText(row[COL.awaiting]), String(lab.awaitingResult));
    assert.equal(cellText(row[COL.rejected]), String(lab.rejected || 0));
    assert.equal(cellText(row[COL.late]), String(lab.late));
  });
});

test('totals row completed equals the sum of the per-lab completed cells', () => {
  const table = complianceTable(OUT);
  const labRows = table.rows.slice(1, -1);
  const totals = logical(table.rows.at(-1));
  assert.equal(cellText(totals[COL.lab]), 'المجموع');

  const sumCol = (c) => labRows.reduce((s, r) => s + Number(cellText(logical(r)[c])), 0);
  const sumCompleted = sumCol(COL.completed);
  assert.equal(Number(cellText(totals[COL.completed])), sumCompleted);
  assert.equal(sumCompleted, OUT.byLab.reduce((s, r) => s + r.resulted, 0));
  // the pre-existing totals are still self-consistent alongside the new column
  assert.equal(Number(cellText(totals[COL.total])), sumCol(COL.total));
  assert.equal(Number(cellText(totals[COL.awaiting])), sumCol(COL.awaiting));
  assert.equal(Number(cellText(totals[COL.rejected])), sumCol(COL.rejected));
  assert.equal(Number(cellText(totals[COL.late])), sumCol(COL.late));
});

test('the engine partition holds: total = pipeline + awaitingResult + resulted + rejected', () => {
  // This is the identity documented on buildByLab. `completed` is the `resulted`
  // term of it, so the column can never be a number that does not belong to the row.
  for (const r of OUT.byLab) {
    assert.equal(
      r.pipeline + r.awaitingResult + r.resulted + (r.rejected || 0), r.total,
      `${r.lab}: partition must sum to total`,
    );
    assert.ok(r.late <= r.awaitingResult, `${r.lab}: late must be a subset of awaitingResult`);
  }
  const sum = (k) => OUT.byLab.reduce((s, r) => s + (r[k] || 0), 0);
  assert.equal(sum('pipeline') + sum('awaitingResult') + sum('resulted') + sum('rejected'), OUT.totals.total);
});

test('per-lab completed sum agrees with the exec KPI card and the monthly results row', () => {
  const perLab = OUT.byLab.reduce((s, r) => s + r.resulted, 0);
  // exec slide card 'فحوصات مكتملة' → buckets.completed; funnel stage 5 → funnel.resulted
  assert.equal(perLab, OUT.buckets.completed, 'compliance total vs exec card');
  assert.equal(perLab, OUT.funnel.resulted, 'compliance total vs funnel stage 5');
  // monthly slide results column, summed over months
  assert.equal(perLab, OUT.monthly.reduce((s, m) => s + m.results, 0), 'compliance total vs monthly results');
});

test('KNOWN GAP: a rejected row WITH a result date would split the two surfaces', () => {
  // buckets.completed counts every non-cancelled row with a result date; byLab.resulted
  // excludes rejected rows. Golden and live data contain zero rejected-with-result rows,
  // so the numbers match. If that ever changes, the exec card would read HIGHER than the
  // compliance totals row by exactly that count — visible to any reader comparing the
  // two slides. Assert the current data really is clean, and pin the size of the gap.
  const rejectedWithResult = GOLDEN_ORDERS.filter(
    (r) => r.rawStatus === 'Result Rejected' && r.resulted,
  ).length;
  assert.equal(rejectedWithResult, 0, 'golden data must stay free of rejected-with-result rows');

  // synthetic proof of the rule, so the relationship is locked rather than assumed
  const synthetic = [
    ...GOLDEN_ORDERS,
    { ...GOLDEN_ORDERS.find((r) => r.rawStatus === 'Result Approved' && r.resulted), rawStatus: 'Result Rejected' },
  ];
  const out2 = compute(synthetic, TAT_LOOKUP, goldenOpts());
  const perLab2 = out2.byLab.reduce((s, r) => s + r.resulted, 0);
  assert.equal(
    out2.buckets.completed - perLab2, 1,
    'a rejected row carrying a result date is counted by the exec card but not by the per-lab table',
  );
});
