// test/monthly-pct-colors.test.mjs — `node --test test/monthly-pct-colors.test.mjs`
//
// THE نسبة الاكتمال ROW'S CONDITIONAL COLOUR (user, round 5, 2026-08-11). Slide 3's monthly
// table has four body rows; three of them are counts and the fourth is a RATIO AGAINST A
// TARGET, which is the only one a reader can judge without doing arithmetic. So that row —
// and only that row — is now colour-coded:
//   • value < 100  → RED   (C.red        #DC2626) — the month still has orders with no
//                                                   terminal outcome (no result, no rejection)
//   • value === 100 → GREEN (C.greenBright #00B050) — everything raised that month is done
//   • no data ('-') → the table's DEFAULT body colour, no `color` key emitted at all
// There is no amber band and no tunable threshold: the ask was done vs not-done. A null
// month has no denominator, so painting it red would assert a shortfall nobody measured —
// hence the third branch, which is the one a "simplification" is most likely to delete.
//
// THE INVARIANT, and the reason this file checks strings as hard as it checks colours: NOT
// ONE DIGIT MOVES. pctMonthly stays the single formatter; the cells merely changed SHAPE
// from a bare string to { text, color, bold }. Every case below therefore asserts the
// rendered TEXT alongside the colour, computed here from the fixture's own completionPct so
// a formatter change cannot slip through behind a correct-looking palette.
//
// CELL SHAPE, and why 'plain string' is load-bearing. Both renderers accept either form
// (html-renderer.js line ~104 and pptx-renderer.js line ~58 read `c.color || default`), so a
// '-' cell left as a string is not a leftover — it is how a cell says "I have no opinion
// about colour". Asserting typeof on it pins that distinction, which an `{ text: '-' }`
// refactor would quietly erase.
//
// COLOURS ARE IMPORTED, NOT RETYPED — with ONE literal pin. This file's subject is the
// RULE (which band gets which brand colour), not the brand palette itself, so the cases read
// C.red / C.greenBright and cannot drift out of step with theme.js. The single
// 'the palette' case below still writes the two hexes out, so that a palette edit fails
// HERE, once, with a legible message instead of silently repainting a delivered slide.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSpec, DEFAULT_LABELS } from '../src/slidespec/build-spec.js';
import { COLORS as C } from '../src/theme.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';

/** The monthly slide's one table (slide 3). */
function monthlyTable(model = MOCK_REPORT_MODEL) {
  const slide = buildSpec(model, { variant: 'internal' }).find((s) => s.id === 'monthly');
  assert.ok(slide, 'the monthly slide is missing from the spec');
  const table = slide.elements.find((e) => e.t === 'table');
  assert.ok(table, 'the monthly slide has no table');
  return table;
}

// Rows are authored in logical (RTL right→left) order — [label, months…, الإجمالي] — and
// emitted through rev(); un-reverse to read them back the way they were written.
const logical = (row) => row.slice().reverse();
const cellText = (c) => (c && typeof c === 'object' ? c.text : c);

/** The نسبة الاكتمال row, in logical order. */
function completionRow(model = MOCK_REPORT_MODEL) {
  const table = monthlyTable(model);
  const row = table.rows
    .map(logical)
    .find((r) => cellText(r[0]) === DEFAULT_LABELS.monthlyRowCompletion);
  assert.ok(row, 'the monthly table must carry the نسبة الاكتمال row');
  return row;
}

// build-spec's pctMonthly, restated. Deliberately a SECOND implementation: the point of
// every text assertion here is that the colour work did not disturb the formatter, and
// importing the formatter to check itself would test nothing.
const pct = (n) => (n == null ? '-' : n === 100 ? '100%' : n.toFixed(1) + '%');

const MONTHS = MOCK_REPORT_MODEL.kpi.monthly;

test('the palette this file colours against', () => {
  // The two hexes the user named, pinned once so a theme.js edit lands here and not on a
  // delivered slide. Everything below reads C.* instead of repeating these.
  assert.equal(C.red, '#DC2626', 'the below-100 colour');
  assert.equal(C.greenBright, '#00B050', 'the exactly-100 colour');
});

test('the fixture still spans all three branches, so the cases below mean what they say', () => {
  // Three nulls (Jan–Mar, no orders), one exact 100 (أبريل: 3 of 3), three shortfalls
  // (85.7 / 83.2 / 3.0). If a re-baseline ever flattens this spread the cases stop covering
  // the rule, so the shape of the fixture is asserted rather than assumed.
  const pcts = MONTHS.map((m) => m.completionPct);
  assert.equal(pcts.filter((p) => p == null).length, 3, 'three no-data months');
  assert.equal(pcts.filter((p) => p === 100).length, 1, 'exactly one 100% month (أبريل)');
  assert.ok(pcts.filter((p) => p != null && p < 100).length >= 2, 'at least two shortfall months');
});

test('every PER-MONTH completion cell is coloured by its own value', () => {
  const row = completionRow();
  // [label, …N months…, الإجمالي] — the months sit between the two ends, one per fixture row.
  assert.equal(row.length, MONTHS.length + 2, 'label + one cell per month + الإجمالي');
  MONTHS.forEach((m, i) => {
    const cell = row[i + 1];
    const where = `${m.month} (${m.completionPct})`;
    if (m.completionPct == null) {
      // NO DATA — a bare string, so the renderers fall through to the table's body colour.
      assert.equal(typeof cell, 'string', `${where}: a no-data cell must stay a plain string`);
      assert.equal(cell, '-', `${where}: and print '-'`);
      return;
    }
    assert.equal(typeof cell, 'object', `${where}: a valued cell must carry its colour`);
    assert.equal(cell.text, pct(m.completionPct), `${where}: the printed number must not move`);
    assert.equal(cell.bold, true, `${where}: valued completion cells are bold`);
    assert.equal(
      cell.color,
      m.completionPct === 100 ? C.greenBright : C.red,
      `${where}: ${m.completionPct === 100 ? '100 must be green' : 'below 100 must be red'}`,
    );
  });
});

test('the boundary is EXACTLY 100 — 99.9 is red, 100 is green', () => {
  // The rule has one edge and it is an equality, not a threshold: 99.9% still means a month
  // with unfinished work in it. Driven through a model variant rather than the fixture so
  // the two sides of the edge are adjacent in one case.
  const at = (p) => {
    const monthly = MOCK_REPORT_MODEL.kpi.monthly.map((m, i) => (i === 0
      ? { ...m, orders: 10, results: 10, incomplete: 0, completionPct: p }
      : m));
    return completionRow({ ...MOCK_REPORT_MODEL, kpi: { ...MOCK_REPORT_MODEL.kpi, monthly } })[1];
  };
  assert.equal(at(100).color, C.greenBright, '100 is the only green');
  assert.equal(at(99.9).color, C.red, '99.9 falls on the red side');
  assert.equal(at(99.9).text, '99.9%', 'and still prints its own number');
  assert.equal(at(0).color, C.red, 'a zero month is red, not blank');
  assert.equal(at(0).text, '0.0%', "0 is a VALUE, not no-data — pctMonthly's '-' is null only");
});

test('the الإجمالي cell keeps its fill and bold, and GAINS the same colour rule', () => {
  // The totals cell already carried { fill, bold } from the table's own styling. The colour
  // is added ALONGSIDE that, never instead of it — dropping the fill would visibly break the
  // totals column, which is why both are asserted in one place.
  const row = completionRow();
  const total = row.at(-1);
  const oTot = MONTHS.reduce((s, m) => s + m.orders, 0);
  const rTot = MONTHS.reduce((s, m) => s + m.results, 0);
  const expected = Math.round((rTot / oTot) * 1000) / 10;   // 437 / 618 = 70.7
  assert.equal(total.text, pct(expected), 'the printed total must not move');
  assert.equal(total.fill, C.bgLight, 'the totals fill survives');
  assert.equal(total.bold, true, 'the totals bold survives');
  assert.ok(expected < 100, 'the fixture total is a shortfall, so it must be the red branch');
  assert.equal(total.color, C.red);
});

test('a 100% TOTAL turns the الإجمالي cell green — the branch is shared, not hardcoded red', () => {
  // The fixture can only ever exercise the red side of the totals cell, so the green side
  // needs a variant: every month fully completed ⇒ rTot === oTot ⇒ 100. Built by mapping
  // the fixture's own months (never by mutating them — MOCK_REPORT_MODEL is shared).
  const monthly = MOCK_REPORT_MODEL.kpi.monthly.map((m) => ({
    ...m, results: m.orders, incomplete: 0, completionPct: m.orders > 0 ? 100 : null,
  }));
  const row = completionRow({ ...MOCK_REPORT_MODEL, kpi: { ...MOCK_REPORT_MODEL.kpi, monthly } });
  const total = row.at(-1);
  assert.equal(total.text, '100%');
  assert.equal(total.color, C.greenBright);
  assert.equal(total.fill, C.bgLight, 'and it is still a totals cell');
  assert.equal(total.bold, true);
  // …and the no-data months are STILL uncoloured in this variant: a month with zero orders
  // has no denominator even when every month that has one is perfect.
  assert.equal(typeof row[1], 'string', 'يناير has no orders, so it stays a plain \'-\' cell');
});

test('the OTHER THREE rows are untouched — plain strings, no colour', () => {
  // The colour rule is scoped to the one row that has a target. الفحوصات / فحوصات مكتملة /
  // النتائج غير المكتملة are counts: colouring them would invent a judgement the data does
  // not support, and it is exactly the kind of thing a copy-paste of pctCell would do.
  const table = monthlyTable();
  for (const key of ['monthlyRowOrders', 'monthlyRowResults', 'monthlyRowIncomplete']) {
    const row = table.rows.map(logical).find((r) => cellText(r[0]) === DEFAULT_LABELS[key]);
    assert.ok(row, `the monthly table must carry the ${key} row`);
    row.slice(1, -1).forEach((cell, i) => {
      assert.equal(typeof cell, 'string', `${key} ${MONTHS[i].month}: count cells stay plain strings`);
    });
    assert.equal(row.at(-1).color, undefined, `${key}: its totals cell must not be coloured`);
  }
});

test('NOT ONE DIGIT MOVED: the completion row still prints exactly what it printed before', () => {
  // THE round-5 invariant, stated once against the whole row rather than cell by cell: the
  // texts are the fixture's completionPct values through the same formatter, and the totals
  // cell is round1(results/orders). If this case and the colour cases ever disagree, the
  // colour work reached the numbers and the change is wrong regardless of how it looks.
  const row = completionRow();
  const oTot = MONTHS.reduce((s, m) => s + m.orders, 0);
  const rTot = MONTHS.reduce((s, m) => s + m.results, 0);
  assert.deepEqual(
    row.map(cellText),
    [DEFAULT_LABELS.monthlyRowCompletion, ...MONTHS.map((m) => pct(m.completionPct)),
      pct(Math.round((rTot / oTot) * 1000) / 10)],
  );
  // and the row label itself is still the right-aligned label cell, not a coloured one
  assert.equal(row[0].align, 'right');
  assert.equal(row[0].color, undefined, 'the row LABEL is not part of the colour rule');
});

test('a NULL total (no orders anywhere) leaves the الإجمالي cell uncoloured but styled', () => {
  // The one branch the other totals cases cannot reach: oTot === 0 ⇒ cPct === null ⇒
  // pctColor(null) is undefined and the conditional spread must add NO color key at all —
  // while the cell keeps being a totals cell (fill + bold) and prints pctMonthly's '-'.
  const monthly = MOCK_REPORT_MODEL.kpi.monthly.map((m) => ({
    ...m, orders: 0, results: 0, incomplete: 0, completionPct: null,
  }));
  const row = completionRow({ ...MOCK_REPORT_MODEL, kpi: { ...MOCK_REPORT_MODEL.kpi, monthly } });
  const total = row.at(-1);
  assert.equal(total.text, '-');
  assert.equal(total.fill, C.bgLight, 'the totals fill survives the null branch');
  assert.equal(total.bold, true, 'the totals bold survives the null branch');
  assert.equal('color' in total, false, 'no color KEY at all — not color:undefined');
});
