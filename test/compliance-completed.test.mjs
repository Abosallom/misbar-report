// test/compliance-completed.test.mjs — run with:  node --test
//
// Locks the compliance slide's 'فحوصات مكتملة' (completed tests) column, added
// 2026-07-27 to buildCompliance (src/slidespec/build-spec.js), and the deck-wide
// agreement of every surface that reports that metric.
//
// WHAT THE NUMBER MEANS (user decision 2026-07-28: "consider rejected as completed
// test"). Rejection is the lab's FINAL outcome for a test, so a rejected line is
// finished work, not work in progress:
//   completed = non-cancelled AND (has a result date OR is rejected)
//             = resulted + rejected                 (engine.js isCompleted())
// The engine publishes it as byLab.completed, buckets.completed, funnel.completed
// (alias funnel.resulted) and monthly[].results — one rule, four fields.
//
// THE PARTITION the compliance table has to add up to (engine.js buildByLab):
//   total = pipeline + awaitingResult + completed
// with rejected, onTime and resultedLate all SUBSETS of completed. That is why the
// مرفوضة column carries the deck's subset idiom ('↳ منها' prefix + a lighter header
// fill): the columns must not read as an add-up list, or a reader would count the
// rejected lines twice. The tests below pin BOTH the arithmetic and that presentation.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compute } from '../src/engine/engine.js';
import { buildSpec, DEFAULT_LABELS } from '../src/slidespec/build-spec.js';
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
const cellFill = (c) => (c && typeof c === 'object' ? c.fill : undefined);

function specOf(engineOutput, opts = {}) {
  return buildSpec({ ...MOCK_REPORT_MODEL, kpi: engineOutput, ...opts }, { variant: 'internal' });
}
function complianceTable(engineOutput) {
  const spec = specOf(engineOutput);
  const slide = spec.find((s) => s.id === 'compliance');
  assert.ok(slide, 'compliance slide is missing from the spec');
  const table = slide.elements.find((e) => e.t === 'table');
  assert.ok(table, 'compliance slide has no table');
  return table;
}
// The completed figure the deck is expected to print everywhere, from the engine.
const completedOf = (r) => (r.completed != null ? r.completed : r.resulted + (r.rejected || 0));

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

test('the مرفوضة column is presented as a SUBSET of فحوصات مكتملة, not a sibling', () => {
  // Rejected is counted INSIDE completed, so the column must not read as another
  // addend. The deck's idiom for that (see DEFAULT_LABELS.defMLate '↳ منها متأخرة',
  // a subset of بانتظار النتائج) is the '↳ منها' prefix plus a lighter header fill.
  assert.equal(DEFAULT_LABELS.compRejected, '↳ منها مرفوضة');
  const table = complianceTable(OUT);
  const header = logical(table.rows[0]);
  const rejCell = header[COL.rejected];
  assert.equal(cellText(rejCell), '↳ منها مرفوضة');
  assert.ok(
    cellText(rejCell).startsWith('↳'),
    'the rejected header must carry the deck\'s ↳ subset prefix',
  );
  // lighter fill than the rest of the header row, which inherits table.header.fill
  assert.ok(cellFill(rejCell), 'the rejected header cell must carry its own lighter fill');
  assert.notEqual(cellFill(rejCell), table.header.fill,
    'the subset header must NOT reuse the plain header fill');
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  assert.ok(lum(cellFill(rejCell)) > lum(table.header.fill),
    `subset header fill ${cellFill(rejCell)} must be LIGHTER than ${table.header.fill}`);
  // every other header cell is a plain string (inherits the navy header fill)
  [COL.hash, COL.lab, COL.total, COL.completed, COL.awaiting, COL.late, COL.latePct]
    .forEach((c) => assert.equal(cellFill(header[c]), undefined,
      `column ${c} must not carry a per-cell header fill`));
});

test('per-lab completed cell equals the engine byLab `completed` (rejected-inclusive)', () => {
  const table = complianceTable(OUT);
  const labRows = table.rows.slice(1, -1);
  assert.equal(labRows.length, OUT.byLab.length);
  // the golden fixture must actually exercise the rule (else this test proves nothing)
  assert.ok(OUT.byLab.reduce((s, r) => s + (r.rejected || 0), 0) > 0,
    'golden data must contain rejected rows for this test to be meaningful');
  labRows.forEach((raw, i) => {
    const row = logical(raw);
    const lab = OUT.byLab[i];
    assert.equal(cellText(row[COL.lab]), lab.lab, `row ${i} lab name`);
    assert.equal(
      cellText(row[COL.completed]), String(completedOf(lab)),
      `row ${i} (${lab.lab}) completed cell must be byLab.completed`,
    );
    // completed really is "reached a terminal outcome" = resulted + rejected,
    // and `resulted` remains the onTime/resultedLate split's parent inside it
    assert.equal(
      lab.completed, lab.resulted + (lab.rejected || 0),
      `${lab.lab}: completed must equal resulted + rejected`,
    );
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
  assert.equal(sumCompleted, OUT.byLab.reduce((s, r) => s + completedOf(r), 0));
  // the pre-existing totals are still self-consistent alongside the new column
  assert.equal(Number(cellText(totals[COL.total])), sumCol(COL.total));
  assert.equal(Number(cellText(totals[COL.awaiting])), sumCol(COL.awaiting));
  assert.equal(Number(cellText(totals[COL.rejected])), sumCol(COL.rejected));
  assert.equal(Number(cellText(totals[COL.late])), sumCol(COL.late));
  // …and the printed columns satisfy the partition ON THE PAGE: the three disjoint
  // terms add to the printed total, with مرفوضة NOT among them (it is inside completed).
  const totalsRow = Number(cellText(totals[COL.total]));
  const pipelineTot = OUT.byLab.reduce((s, r) => s + r.pipeline, 0);
  assert.equal(pipelineTot + sumCol(COL.awaiting) + sumCompleted, totalsRow,
    'printed total must equal pipeline + awaitingResult + completed');
  assert.ok(sumCol(COL.rejected) <= sumCompleted,
    'the printed rejected column must be a subset of the printed completed column');
});

test('the engine partition holds: total = pipeline + awaitingResult + completed', () => {
  // This is the identity documented on buildByLab. `completed` is its headline term,
  // so the column can never be a number that does not belong to the row. rejected,
  // onTime and resultedLate are all SUBSETS of it and are never added alongside it.
  for (const r of OUT.byLab) {
    assert.equal(
      r.pipeline + r.awaitingResult + completedOf(r), r.total,
      `${r.lab}: partition must sum to total`,
    );
    assert.ok((r.rejected || 0) <= completedOf(r), `${r.lab}: rejected must be a subset of completed`);
    assert.ok(r.late <= r.awaitingResult, `${r.lab}: late must be a subset of awaitingResult`);
  }
  const sum = (k) => OUT.byLab.reduce((s, r) => s + (r[k] || 0), 0);
  assert.equal(sum('pipeline') + sum('awaitingResult') + sum('completed'), OUT.totals.total);
  // and the same identity on the aggregate buckets the exec slide prints
  const b = OUT.buckets;
  assert.equal(
    b.awaitingDispatch + b.shippedNotReceived + b.awaitingResults + b.completed,
    OUT.totals.total,
    'aggregate: total = awaitingDispatch + shippedNotReceived + awaitingResults + completed',
  );
});

test('every surface that says "completed" prints the SAME number', () => {
  // compliance column ↔ exec KPI card ↔ funnel final stage ↔ monthly results row.
  const perLab = OUT.byLab.reduce((s, r) => s + completedOf(r), 0);
  assert.equal(perLab, OUT.buckets.completed, 'compliance total vs exec card');
  assert.equal(perLab, OUT.funnel.completed ?? OUT.funnel.resulted, 'compliance total vs funnel stage 5');
  assert.equal(OUT.funnel.resulted, OUT.funnel.completed,
    'funnel.resulted must stay an alias of funnel.completed (the override key reads it)');
  assert.equal(perLab, OUT.monthly.reduce((s, m) => s + m.results, 0), 'compliance total vs monthly results');

  // …and the numbers actually RENDERED on the three slides, not just the engine fields.
  const spec = specOf(OUT);
  const texts = (id) => spec.find((s) => s.id === id).elements
    .filter((e) => e.t === 'text').map((e) => e.text);
  const execTexts = texts('execFunnel');
  const iCard = execTexts.indexOf(DEFAULT_LABELS.kpiCompleted);
  assert.ok(iCard > 0, 'exec slide must carry the فحوصات مكتملة card');
  assert.equal(execTexts[iCard - 1], String(perLab), 'exec card value element precedes its label');
  // funnel stage 5 value is emitted alongside its stage label
  const iStage = execTexts.indexOf('5. إصدار نتيجة');
  assert.ok(iStage >= 0, 'exec slide must carry funnel stage 5');
  assert.equal(execTexts[iStage + 1], String(perLab), 'funnel stage 5 prints the completed figure');
  // monthly table: the results row's totals cell
  const mTable = spec.find((s) => s.id === 'monthly').elements.find((e) => e.t === 'table');
  const mRow = mTable.rows.find((r) => logical(r).some((c) => cellText(c) === DEFAULT_LABELS.monthlyRowResults));
  assert.ok(mRow, 'monthly table must carry the completed row');
  assert.equal(Number(cellText(logical(mRow).at(-1))), perLab, 'monthly completed row total');
  // compliance totals row
  const cTotals = logical(complianceTable(OUT).rows.at(-1));
  assert.equal(Number(cellText(cTotals[COL.completed])), perLab, 'compliance totals row');
});

test('the monthly slide never renders rejected as a sibling of the completed row', () => {
  // orders = completed + incomplete is the ONLY partition on that slide; a rejected
  // row there would be counted twice. Guard both the table and the bar chart.
  const spec = specOf(OUT);
  const monthly = spec.find((s) => s.id === 'monthly');
  const table = monthly.elements.find((e) => e.t === 'table');
  const labels = table.rows.map((r) => cellText(logical(r)[0]));
  assert.ok(!labels.includes(DEFAULT_LABELS.monthlyRowRejected),
    'the monthly table must not carry a rejected row alongside the completed row');
  const chart = monthly.elements.find((e) => e.t === 'chart');
  assert.ok(!chart.series.some((s) => s.name === DEFAULT_LABELS.monthlyRowRejected),
    'the monthly chart must not carry a rejected series alongside the completed series');
  // rows add up on the page: orders = completed + incomplete, per month and in total
  const rowOf = (label) => logical(table.rows.find((r) => cellText(logical(r)[0]) === label));
  const orders = rowOf(DEFAULT_LABELS.monthlyRowOrders);
  const done = rowOf(DEFAULT_LABELS.monthlyRowResults);
  const notDone = rowOf(DEFAULT_LABELS.monthlyRowIncomplete);
  for (let i = 1; i < orders.length; i++) {
    assert.equal(
      Number(cellText(done[i])) + Number(cellText(notDone[i])), Number(cellText(orders[i])),
      `monthly column ${i}: completed + incomplete must equal orders`,
    );
  }
});

test('SYNTHETIC: a rejected row moves INTO completed, and every surface follows', () => {
  // Turn one dated, approved golden row into a rejected one WITHOUT a result date —
  // the shape live data actually has (all 15 live rejected rows carry a blank result
  // date). Under the old rule this row left completed; under the new rule it stays,
  // so completed is UNCHANGED while rejected rises by one and resulted falls by one.
  const donor = GOLDEN_ORDERS.find((r) => r.rawStatus === 'Result Approved' && r.resulted);
  assert.ok(donor, 'golden data must contain a dated, approved row to convert');
  const synthetic = GOLDEN_ORDERS.map((r) => (r === donor
    ? { ...r, rawStatus: 'Result Rejected', resulted: '' }
    : r));
  const out2 = compute(synthetic, TAT_LOOKUP, goldenOpts());

  assert.equal(out2.buckets.completed, OUT.buckets.completed,
    'converting a dated row to a (dateless) rejection must NOT change completed');
  assert.equal(out2.buckets.rejected, OUT.buckets.rejected + 1, 'rejected rises by one');
  const resulted2 = out2.byLab.reduce((s, r) => s + r.resulted, 0);
  const resulted1 = OUT.byLab.reduce((s, r) => s + r.resulted, 0);
  assert.equal(resulted2, resulted1 - 1, 'the dated-only subtotal falls by one');

  // the identity and the cross-slide agreement survive on the perturbed data
  const perLab2 = out2.byLab.reduce((s, r) => s + completedOf(r), 0);
  assert.equal(perLab2, out2.buckets.completed);
  assert.equal(perLab2, out2.funnel.completed ?? out2.funnel.resulted);
  assert.equal(perLab2, out2.monthly.reduce((s, m) => s + m.results, 0));
  for (const r of out2.byLab) {
    assert.equal(r.pipeline + r.awaitingResult + completedOf(r), r.total, `${r.lab}: partition`);
  }
  // and the compliance table renders that same number in both the cell and the totals
  const t2 = complianceTable(out2);
  const totals2 = logical(t2.rows.at(-1));
  assert.equal(Number(cellText(totals2[COL.completed])), perLab2);
  assert.equal(Number(cellText(totals2[COL.rejected])), out2.buckets.rejected);
});

test('SYNTHETIC: a rejected row that DOES carry a result date is counted once', () => {
  // The old code had a real divergence here (buckets counted it, byLab did not). Under
  // the OR rule the two clauses overlap harmlessly: the row is completed either way and
  // is counted exactly once by every surface. Pin that the gap is gone, not just absent.
  const donor = GOLDEN_ORDERS.find((r) => r.rawStatus === 'Result Approved' && r.resulted);
  const synthetic = GOLDEN_ORDERS.map((r) => (r === donor ? { ...r, rawStatus: 'Result Rejected' } : r));
  const out3 = compute(synthetic, TAT_LOOKUP, goldenOpts());
  const perLab3 = out3.byLab.reduce((s, r) => s + completedOf(r), 0);

  assert.equal(out3.buckets.completed, OUT.buckets.completed,
    'a rejected row that keeps its result date is still exactly one completed row');
  assert.equal(perLab3 - out3.buckets.completed, 0,
    'the exec card and the per-lab table can no longer disagree');
  assert.equal(perLab3, out3.funnel.completed ?? out3.funnel.resulted);
  assert.equal(perLab3, out3.monthly.reduce((s, m) => s + m.results, 0));
  for (const r of out3.byLab) {
    assert.equal(r.pipeline + r.awaitingResult + completedOf(r), r.total, `${r.lab}: partition`);
    assert.ok((r.rejected || 0) <= completedOf(r), `${r.lab}: rejected ⊂ completed`);
  }
});
