// test/turnaround-spec.test.mjs — `node --test test/turnaround-spec.test.mjs`
//
// THE TURNAROUND BLOCK, PINNED AGAINST THE USER'S OWN SPEC (round 6, 2026-08-25).
//
// WHAT CHANGED IN ROUND 6 — and, far more importantly, what did NOT. The monthly slide's
// turnaround block (navy overall-average card + الفعلي/المتوقع line chart) was OPT-IN since
// 2026-07-26 (build-spec OPT_IN_CARDS, seed reportOptions.kpiCards.turnaround === false). The
// user's reference image is his own historic deck, which shows the block, so it is now ON BY
// DEFAULT. Round 6 therefore does exactly three things: REVEAL an existing block, DELETE two
// card lines, and ADD data labels to the line chart. THE CALCULATION IS UNTOUCHED — every
// number this file asserts is what engine.js already produced before the round started.
//
// WHY THIS FILE EXISTS. Everything the user actually specified about turnaround lives in
// engine.js buildTurnaround (~25 lines) and one `if (showTurnaround)` branch in build-spec.js,
// and until now NOTHING pinned it: the golden suite checks the block's aggregate values through
// the 628-row fixture, which cannot isolate a single rule, and the block was invisible by
// default so no render test walked it. A block about to become VISIBLE ON EVERY DELIVERED DECK
// needs its rules asserted one at a time, in the terms the user stated them, against data small
// enough to derive by hand. Hence: hand-built rows, hand-computed means, no fixture arithmetic.
//
// THE USER'S CALCULATION SPEC, restated (engine.js buildTurnaround — MUST NOT be changed):
//   measured = non-cancelled, non-rejected rows that carry BOTH a Received and a Result date
//   actual   = mean(resulted − received) in CALENDAR days — weekends INCLUDED, time-of-day kept
//   expected = mean(due − received) in CALENDAR days over the SAME measured set
//   per-month by ORDER date (never by received/resulted date); both means rounded to 1 decimal
//   a month with no measured order is a NULL GAP in the chart — never a zero
//
// THE CARD RULE (user, verbatim): "Two figures only ... Do not add an order count, a
// percentage, or a third figure to the card — two numbers only." The card used to render FOUR
// lines under its title — الفعلي, المتوقع, a الفارق variance line and a (ن = N طلب) sample-size
// line. The last two are gone; the ON-vs-OFF diff below is what holds them gone.
//
// THE CHART RULE (user, verbatim): "Keep it a line chart with markers and data labels." The
// markers were already specified per series (circle / diamond); dataLabels was not, and is now.
//
// THE CALENDAR-DAY TRAP, and why case 2 exists. This repo has TWO day arithmetics and they
// disagree on purpose:
//   • the DUE DATE is a WORKDAY count — Friday+Saturday are skipped (Saudi weekend, Talal
//     2026-08-05; see workday.js and test/workday-oracle.test.mjs), and it lands on MIDNIGHT;
//   • the TURNAROUND spans are CALENDAR days — calDaysBetween(), fractional, weekends INCLUDED.
// So a test received Thursday and resulted Sunday is 3.5 turnaround days even though it is one
// business day. Anyone "unifying" the two would halve the actual mean on the delivered slide,
// which is precisely the edit this file has to fail on.
import test from 'node:test';
import assert from 'node:assert/strict';

import { compute } from '../src/engine/engine.js';
import { buildSpec, DEFAULT_LABELS } from '../src/slidespec/build-spec.js';
import { REPORT_OPTIONS_SEED } from '../src/seeds/defaults.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';

// ============================================================================
// Fixtures — the smallest rows that can carry a turnaround
// ============================================================================

// ONE probe test at TAT = 2 BUSINESS days, so every due date below is re-derivable from
// test/workday-oracle.test.mjs's hand-drawn calendar instead of from workday() itself.
const PROBE = 'TURNAROUND PROBE';
const TAT = { [PROBE]: 2 };
// A second test that is deliberately ABSENT from the lookup and carries no CSV fallback,
// used once to reach the engine's dueMs guard (see the 'no due date' case).
const NO_TAT_PROBE = 'UNMATCHED PROBE';
const ASOF = '2026-08-25';

// facility / orderId / lineNo / loinc / collected / dispatched are INERT for turnaround —
// the metric reads orderDate, received, resulted, rawStatus and the resolved TAT only. They
// are filled with constants so every row below differs only in the fields that matter.
const row = (o) => ({
  orderDate: '2026-07-05', facility: 'Lab T', orderId: 'T-1', lineNo: 1, loinc: null,
  testName: PROBE, collected: null, dispatched: null,
  received: null, resulted: null, rawStatus: 'In Progress', tatDaysCsv: null,
  ...o,
});

/** compute() -> the turnaround block only. asOf is irrelevant to turnaround (no rule reads
 *  it) but compute() requires one, so it is a constant everywhere in this file. */
const ta = (rows) => compute(rows, TAT, { asOf: ASOF }).turnaround;

// THE ANCHOR ROW, hand-derived once and reused by cases 1–3.
// Ordered Sun 2026-07-05 (→ month 2026-07), received Thu 2026-07-09 08:00, resulted
// Sun 2026-07-12 20:00.
//   actual   = 2026-07-12 20:00 − 2026-07-09 08:00 = 3 days + 12h = 3.5 calendar days.
//              Fri 07-10 and Sat 07-11 are COUNTED. (Under workday math this span is
//              ONE business day — the number 3.5 is the whole point of the case.)
//   due      = workday(Thu 2026-07-09, 2) = Mon 2026-07-13 (oracle row 'Thu +2 → Mon'),
//              and workday() returns MIDNIGHT, so due carries no time-of-day.
//   expected = 2026-07-13 00:00 − 2026-07-09 08:00 = 3 days + 16h = 3.6667 → round1 3.7.
const ANCHOR = row({
  orderDate: '2026-07-05',
  received: '2026-07-09 08:00:00',
  resulted: '2026-07-12 20:00:00',
  rawStatus: 'Result Available',
});
const ANCHOR_ACTUAL = 3.5;
const ANCHOR_EXPECTED = 3.7;

// ============================================================================
// 1. THE MEASURED SET — four ways to NOT be measured, none of them a zero
// ============================================================================

test('MEASURED SET: unresulted / cancelled / rejected / no-received rows are EXCLUDED, not zeroed', () => {
  // The distinction this case exists for: EXCLUDED (the row leaves the denominator) versus
  // COUNTED AS ZERO (the row stays in the denominator with a 0-day span). Both "ignore" the
  // row; only one of them keeps the published average honest. With the anchor plus the four
  // non-measurable rows below:
  //   excluded  → mean over 1 row  = 3.5 / 3.7   ← the engine, and the user's spec
  //   zero-fill → mean over 5 rows = 0.7 / 0.74  ← what a `?? 0` anywhere in the chain gives
  // so the assertions below cannot both hold; 3.5 is the one that means "excluded".
  const rows = [
    ANCHOR,
    // (a) received, never resulted — work still in flight. It HAS a due date, so a
    // "measure everything that has a due date" reading would sweep it in at 0 actual.
    row({ received: '2026-07-06 08:00:00', rawStatus: 'In Progress' }),
    // (b) cancelled — dropped upstream of buildTurnaround by compute()'s nonCancelled
    // filter, and carries a full received+resulted pair so only the STATUS can exclude it.
    row({
      received: '2026-07-06 08:00:00', resulted: '2026-07-08 08:00:00',
      rawStatus: 'Order Cancelled',
    }),
    // (c) rejected — a terminal outcome and therefore COMPLETED everywhere else in the
    // engine (buckets/byLab/monthly all count it), but NOT measurable here: a rejection is
    // not a result, so there is no received→result duration to average. This is the row a
    // "completed should mean completed everywhere" cleanup would wrongly fold in.
    row({
      received: '2026-07-06 08:00:00', resulted: '2026-07-08 08:00:00',
      rawStatus: 'Result Rejected',
    }),
    // (d) a result with NO received date — the span has no start. calDaysBetween would
    // coerce the null to epoch 0 and contribute ≈ −20,600 days (engine.js's own warning),
    // so this row is the one whose zero-fill failure mode is catastrophic rather than merely
    // dilutive: the mean would go NEGATIVE, not just small.
    row({ resulted: '2026-07-08 08:00:00', rawStatus: 'Result Available' }),
  ];
  const t = ta(rows);
  assert.equal(t.measuredCount, 1, 'exactly ONE of the five rows is measurable');
  assert.equal(t.overallActual, ANCHOR_ACTUAL, 'the anchor alone sets the actual mean (not 0.7)');
  assert.equal(t.overallExpected, ANCHOR_EXPECTED, 'and the expected mean (not 0.74)');
  assert.ok(t.overallActual > 0, 'a negative or zero mean means an excluded row got counted');
  // …and the month carries the same single-row mean, i.e. the exclusion happened BEFORE the
  // grouping, not after it. All five rows share order-month 2026-07, so a row that leaked
  // into the group would land here even if the overall means were fixed up separately.
  assert.deepEqual(t.perMonth, [
    { month: '2026-07', actual: ANCHOR_ACTUAL, expected: ANCHOR_EXPECTED },
  ]);
});

test('MEASURED SET: a resulted row with NO due date (unmatched test, no CSV TAT) is excluded too', () => {
  // NOT one of the user's four exclusions — this is the engine's own defensive guard
  // (`e.dueMs != null`, engine.js), and it is pinned because deleting it is the single most
  // attractive "simplification" in buildTurnaround: the filter reads like it is checking the
  // same thing twice. It is not. Without a due date, expectedOf() computes
  // calDaysBetween(null, received) = (0 − received)/DAY ≈ −20,600 days, which would drag the
  // published المتوقع figure to a large negative number the moment one unmatched test
  // arrives with a result. The row below is resulted and non-rejected — the user's spec
  // alone would measure it — and has no lookup entry and no tatDaysCsv fallback.
  const orphan = row({
    testName: NO_TAT_PROBE, tatDaysCsv: null,
    received: '2026-07-06 08:00:00', resulted: '2026-07-08 08:00:00',
    rawStatus: 'Result Available',
  });
  const t = ta([ANCHOR, orphan]);
  assert.equal(t.measuredCount, 1, 'the due-less row is not measured');
  assert.equal(t.overallActual, ANCHOR_ACTUAL);
  assert.equal(t.overallExpected, ANCHOR_EXPECTED, 'المتوقع stayed positive and unmoved');
});

// ============================================================================
// 2. CALENDAR DAYS — the opposite convention to the due date beside it
// ============================================================================

test('CALENDAR DAYS: Thu→Sun is 3.5 turnaround days (Fri+Sat COUNTED), while its due date skips them', () => {
  // The anchor row, asserted as its own case because it is the one rule that reads backwards
  // from everything else in the engine. Received Thu 2026-07-09 08:00, resulted Sun
  // 2026-07-12 20:00 — the span crosses the Saudi weekend (Fri 07-10, Sat 07-11).
  //   ACTUAL, calendar: 09→12 is 3 whole days, plus 08:00→20:00 is a half day → 3.5.
  //   ACTUAL, if weekends were skipped like the due date: Thu +1 business day = Sun, i.e. 1.
  // 3.5 vs 1 is a 3.5× error on the headline figure of the card, so the fractional value is
  // asserted exactly rather than approximately.
  const t = ta([ANCHOR]);
  assert.equal(t.measuredCount, 1);
  assert.equal(t.overallActual, 3.5, 'weekend days are INSIDE the turnaround span');
  assert.notEqual(t.overallActual, 1, 'a workday-count actual would read 1 day here');

  // EXPECTED, over the SAME row: due − received, also in calendar days — but the DUE date
  // itself is produced by workday(), which does skip Fri+Sat. Both conventions therefore
  // appear in this one number, in this order:
  //   1. workday(Thu 2026-07-09, TAT 2) = Mon 2026-07-13 — hand-derived in
  //      test/workday-oracle.test.mjs ('2026-07-09', 2 → '2026-07-13'), reused verbatim
  //      here rather than recomputed, because that table is the hand-drawn calendar.
  //   2. calendar span Thu 07-09 08:00 → Mon 07-13 00:00 = 4 days − 8 hours = 3.66667,
  //      round1 → 3.7.
  // Note the ASYMMETRY that makes 3.7 the right answer and 4.0 the wrong one: workday()
  // returns MIDNIGHT, so the expected span ends at 00:00 while it starts at the real 08:00
  // receipt time. The engine keeps that partial day on purpose (calDaysBetween, not dayDiff).
  assert.equal(t.overallExpected, 3.7, 'due Mon 2026-07-13 00:00 − received Thu 08:00 = 3.6667');
  assert.notEqual(t.overallExpected, 4, 'time-of-day is kept — this is not a whole-day diff');

  // …and both figures are rounded to ONE decimal, which is also what the card prints.
  for (const v of [t.overallActual, t.overallExpected]) {
    assert.equal(Math.round(v * 10) / 10, v, `${v} must already be a 1-decimal figure`);
  }
});

// ============================================================================
// 3. SAME-SET INVARIANT — one denominator, shared by both series
// ============================================================================

test('SAME SET: adding an unresulted order moves NEITHER الفعلي NOR المتوقع', () => {
  // The user's spec ties the two means to ONE row set: expected is the mean of (due −
  // received) "over the SAME set", not over every row that happens to have a due date. An
  // unresulted order HAS a due date, so a المتوقع computed over its own natural population
  // would move while الفعلي stood still — the two lines on the chart would then be measuring
  // different things and their gap would stop meaning anything.
  //
  // Two-row baseline so the means are real averages rather than a single value: the anchor
  // (3.5 / 3.7) plus a second July row received Sun 2026-07-05 12:00, resulted Wed
  // 2026-07-08 12:00 →
  //   actual   = exactly 3 calendar days (no weekend crossed, same time of day) = 3.0
  //   due      = workday(Sun 2026-07-05, 2) = Tue 2026-07-07 (oracle: 'Sun +2 → Tue')
  //   expected = Tue 07-07 00:00 − Sun 07-05 12:00 = 1 day + 12h = 1.5
  // means: actual (3.5 + 3.0)/2 = 3.25 → round1 3.3 ; expected (3.6667 + 1.5)/2 = 2.5833 →
  // round1 2.6. Both are rounded ONCE, at the end — averaging the per-row rounded values
  // would give (3.5+3.0)/2 and (3.7+1.5)/2 = 2.6 as well here, so no claim is made on that.
  const second = row({
    orderDate: '2026-07-05',
    received: '2026-07-05 12:00:00', resulted: '2026-07-08 12:00:00',
    rawStatus: 'Result Available',
  });
  const base = ta([ANCHOR, second]);
  assert.equal(base.measuredCount, 2);
  assert.equal(base.overallActual, 3.3, '(3.5 + 3.0) / 2 = 3.25 → 3.3');
  assert.equal(base.overallExpected, 2.6, '(3.6667 + 1.5) / 2 = 2.5833 → 2.6');

  // Now add two unresulted orders — one in a month that ALREADY has measured rows (2026-07),
  // one in a month that has none at all (2026-05). Neither may touch a single field of the
  // block: not the means, not measuredCount, and not perMonth (2026-05 must not appear as a
  // month with a due-only expected value and a null actual).
  const withPending = ta([
    ANCHOR,
    second,
    row({ orderDate: '2026-07-05', received: '2026-07-06 08:00:00', rawStatus: 'In Progress' }),
    row({ orderDate: '2026-05-04', received: '2026-05-04 08:00:00', rawStatus: 'In Progress' }),
  ]);
  assert.deepEqual(withPending, base, 'the turnaround block is byte-identical with the two pending rows added');
});

// ============================================================================
// 4. MONTH ATTRIBUTION — the ORDER date, never the received or resulted date
// ============================================================================

test('MONTH: an order raised in June but received AND resulted in August scores in JUNE only', () => {
  // Per-month grouping is monthKey(orderMs). Every other date on the row says August, so
  // this single row separates the order-date rule from all three plausible alternatives
  // (received month, resulted month, "the month the work happened in").
  //   ordered  Mon 2026-06-15
  //   received Mon 2026-08-03 08:00
  //   resulted Thu 2026-08-06 08:00
  //   actual   = 08-06 08:00 − 08-03 08:00 = exactly 3.0 calendar days (same time of day)
  //   due      = workday(Mon 2026-08-03, 2) = Wed 2026-08-05 (Mon +1 = Tue, +2 = Wed; no
  //              weekend in the way — 2026-08-02 is a Sunday, so 08-03 is a Monday)
  //   expected = Wed 08-05 00:00 − Mon 08-03 08:00 = 1 day + 16h = 1.6667 → round1 1.7
  const t = ta([row({
    orderDate: '2026-06-15',
    received: '2026-08-03 08:00:00', resulted: '2026-08-06 08:00:00',
    rawStatus: 'Result Available',
  })]);
  assert.deepEqual(t.perMonth, [{ month: '2026-06', actual: 3, expected: 1.7 }]);
  assert.equal(t.perMonth.length, 1, 'ONE point, not one for the order month and one for August');
  assert.equal(
    t.perMonth.find((p) => p.month === '2026-08'), undefined,
    'the received/resulted month must not appear at all',
  );
  // The overall figures are the same row seen ungrouped — they never re-attribute anything.
  assert.equal(t.overallActual, 3);
  assert.equal(t.overallExpected, 1.7);
});

// ============================================================================
// Slide helpers — the monthly slide, with the turnaround block on or off
// ============================================================================

/** Model variant: MOCK_REPORT_MODEL with some kpi fields replaced and an explicit
 *  kpiCards bundle. MOCK_REPORT_MODEL.reportOptions is undefined (the "all defaults"
 *  fixture), so the spread below is how this file states an explicit toggle. */
const modelWith = (kpiPatch, kpiCards = { turnaround: true }) => ({
  ...MOCK_REPORT_MODEL,
  kpi: { ...MOCK_REPORT_MODEL.kpi, ...kpiPatch },
  reportOptions: { ...MOCK_REPORT_MODEL.reportOptions, kpiCards },
});

function monthlySlide(model) {
  const slide = buildSpec(model, { variant: 'internal' }).find((s) => s.id === 'monthly');
  assert.ok(slide, 'the monthly slide is missing from the spec');
  return slide;
}
/** The turnaround chart is the slide's only LINE chart — the monthly orders/results/
 *  incomplete chart beside it is 'colClustered', so kind alone identifies it. */
const turnaroundChart = (slide) => {
  const c = slide.elements.find((e) => e.t === 'chart' && e.kind === 'line');
  assert.ok(c, 'the monthly slide has no turnaround LINE chart');
  return c;
};
const textsOf = (slide) => slide.elements.filter((e) => e.t === 'text').map((e) => e.text);
/** The two card figures, exactly as the user framed them: "<label>: <one-decimal> يوم". */
const FIGURE_RE = /^(الفعلي|المتوقع): \d+\.\d يوم$/;

// ============================================================================
// 5. GAPS — an empty month is a hole in the line, never a zero
// ============================================================================

// Three order-months, only two of them measurable. July has an order (so the monthly TABLE
// beside the chart shows a July column, and the chart therefore has a July CATEGORY) but no
// result, so it contributes nothing to either mean.
//   JUNE   ordered Mon 2026-06-01, received 06-01 00:00, resulted Thu 06-04 12:00
//          actual   = 3 days + 12h = 3.5
//          due      = workday(Mon 2026-06-01, 2) = Wed 2026-06-03 ; expected = 2.0 exactly
//   JULY   ordered Mon 2026-07-06, received 07-06 00:00, NO result → not measured
//   AUGUST ordered Mon 2026-08-03, received 08-03 00:00, resulted Tue 08-04 06:00
//          actual   = 1 day + 6h = 1.25 → round1 1.3 (round1 is half-up: 12.5 → 13)
//          due      = workday(Mon 2026-08-03, 2) = Wed 2026-08-05 ; expected = 2.0 exactly
// overall actual = (3.5 + 1.25)/2 = 2.375 → 2.4 ; overall expected = 2.0
const GAP_ROWS = [
  row({
    orderDate: '2026-06-01', received: '2026-06-01 00:00:00',
    resulted: '2026-06-04 12:00:00', rawStatus: 'Result Available',
  }),
  row({ orderDate: '2026-07-06', received: '2026-07-06 00:00:00', rawStatus: 'In Progress' }),
  row({
    orderDate: '2026-08-03', received: '2026-08-03 00:00:00',
    resulted: '2026-08-04 06:00:00', rawStatus: 'Result Available',
  }),
];

test('GAPS (engine): a month with no measured order is simply ABSENT from perMonth', () => {
  const out = compute(GAP_ROWS, TAT, { asOf: ASOF });
  // The monthly table lists all three months — the July column is real, it just has no
  // turnaround in it. This is the precondition that makes the chart assertion below mean
  // something: category count and series length must disagree about July, or there is no gap.
  assert.deepEqual(
    out.monthly.map((m) => m.month), ['2026-06', '2026-07', '2026-08'],
    'July raised orders, so it is a month on this slide',
  );
  assert.deepEqual(out.turnaround.perMonth, [
    { month: '2026-06', actual: 3.5, expected: 2 },
    { month: '2026-08', actual: 1.3, expected: 2 },
  ], 'no 2026-07 entry — not a zero entry, not a null-valued entry, no entry');
  assert.equal(out.turnaround.measuredCount, 2);
  assert.equal(out.turnaround.overallActual, 2.4, '(3.5 + 1.25) / 2 = 2.375 → 2.4');
  assert.equal(out.turnaround.overallExpected, 2);
});

test('GAPS (slide): the empty month is NULL on BOTH series of the line chart, never 0', () => {
  // The slide is where a gap can silently become a zero: build-spec keys the series off the
  // CATEGORY list (the derived month list) rather than off perMonth, precisely so an absent
  // month stays a hole in place instead of shifting every later point one band to the right.
  // The `?? null` in that lookup is the whole mechanism, and `?? 0` is its obvious-looking
  // typo — which would draw July as a dive to zero days, i.e. a month of instant results.
  const out = compute(GAP_ROWS, TAT, { asOf: ASOF });
  const chart = turnaroundChart(monthlySlide(modelWith({
    monthly: out.monthly, turnaround: out.turnaround,
  })));
  assert.equal(chart.categories.length, 3, 'three month categories — June, July, August');
  const [actual, expected] = chart.series;
  assert.deepEqual(actual.values, [3.5, null, 1.3], 'الفعلي: June, GAP, August');
  assert.deepEqual(expected.values, [2, null, 2], 'المتوقع: the SAME hole, not a due-only point');
  // deepEqual would accept `undefined` where `null` is written, and both renderers treat the
  // two differently from 0 — so the July slot is asserted identity-wise as well.
  for (const se of chart.series) {
    assert.ok(Object.is(se.values[1], null), `${se.name}: July must be exactly null`);
    assert.notEqual(se.values[1], 0, `${se.name}: July must not be zero`);
  }
  // MARKERS are part of the user's chart rule ("a line chart with markers and data labels")
  // and are per-series, so they are checked where the series are in hand.
  assert.equal(chart.kind, 'line', 'still a line chart — not a bar or an area');
  assert.ok(actual.marker, 'الفعلي carries a marker');
  assert.ok(expected.marker, 'المتوقع carries a marker');
});

// ============================================================================
// 6. THE CARD — two figures, and the chart's data labels
// ============================================================================

test('CARD: the block adds exactly THREE texts — a title and TWO figures', () => {
  // "Two figures only ... Do not add an order count, a percentage, or a third figure to the
  // card — two numbers only." (user, verbatim.)
  //
  // Asserted as a DIFF between the same slide built with the block off and on, rather than by
  // counting texts inside a card-shaped rectangle. Two reasons: it needs no geometry (the
  // parallel round-6 track is re-sizing the figures, and a coordinate filter would then be
  // asserting the layout instead of the rule), and it is closed — a fourth line added
  // anywhere on the slide by the block fails here even if it sits outside the navy card.
  const off = textsOf(monthlySlide(modelWith({}, { turnaround: false })));
  const on = textsOf(monthlySlide(modelWith({}, { turnaround: true })));
  assert.equal(on.length - off.length, 3, 'the turnaround block contributes 3 texts, no more');
  const added = on.filter((t) => !off.includes(t));
  assert.equal(added.length, 3, 'and all three are NEW strings (no duplicated line)');

  const figures = added.filter((t) => FIGURE_RE.test(t));
  assert.equal(figures.length, 2, 'exactly two of them are figures');
  // The third is the card's title — a label, not a number.
  const rest = added.filter((t) => !FIGURE_RE.test(t));
  assert.deepEqual(rest, [DEFAULT_LABELS.overallAvgTitle], 'the only non-figure text is the card title');

  // The two figures are the engine's own overall means, printed to one decimal. MOCK's
  // turnaround is 12.0 actual / 7.0 expected, so this also pins the "يوم" unit and the
  // "<label>: " prefix that the user's reference image shows.
  assert.deepEqual(figures.sort(), ['المتوقع: 7.0 يوم', 'الفعلي: 12.0 يوم'].sort());
});

test('CARD: NO variance line and NO sample-size line survive anywhere on the slide', () => {
  // The two deleted lines, named explicitly so a revert reads as a failure about the user's
  // rule rather than as an off-by-one in the count above:
  //   الفارق: +5.0 يوم عن المستهدف   ← a THIRD figure (actual − expected)
  //   (ن = 422 طلب)                  ← an ORDER COUNT (measuredCount)
  // measuredCount is still PUBLISHED by the engine and still exercised by case 1 — it is
  // removed from the CARD, not from the model, so nothing else that reads it breaks.
  const on = textsOf(monthlySlide(modelWith({}, { turnaround: true })));
  for (const t of on) {
    assert.ok(!t.includes('الفارق'), `variance line is back on the slide: ${t}`);
    // /ن\s*=/ rather than the literal 'ن = ' so a re-spaced or reworded sample-size line is
    // caught too. The partition footnote beside the table contains '=' but the token before
    // it is 'الفحوصات' (…ت), so it cannot trip this.
    assert.ok(!/ن\s*=/.test(t), `sample-size line is back on the slide: ${t}`);
  }
  // The block is genuinely rendered in this model — otherwise the loop above passes vacuously.
  assert.equal(on.filter((t) => FIGURE_RE.test(t)).length, 2, 'the card is on for this check');
});

test('CHART: the turnaround line chart carries DATA LABELS', () => {
  // "Keep it a line chart with markers and data labels." (user, verbatim.) opts.dataLabels is
  // the one switch that asks for per-point values; the monthly BAR chart on this same slide
  // already sets it and both renderers honour it there (charts-svg col()/barH() draw the
  // label, pptx-renderer maps it to showValue).
  // IT IS A NO-OP FOR kind 'line' TODAY — neither renderer has a value-label pass on that
  // branch — and this case is asserted anyway, on purpose: the SPEC is the contract
  // (contracts.js declares opts.dataLabels for every chart kind), so the flag is what the
  // renderer work will read when it lands, and dropping it as "dead" would silently delete
  // the user's rule. The renderers are owned elsewhere; this file pins the spec only.
  const chart = turnaroundChart(monthlySlide(modelWith({}, { turnaround: true })));
  assert.equal(chart.opts.dataLabels, true, 'opts.dataLabels must be exactly true');
  // The pre-existing chart options are additive neighbours, not casualties of the new flag.
  assert.equal(chart.opts.legend, 'bottom', 'the legend survives');
  assert.equal(chart.opts.valMin, 0, 'the zero-based value axis survives');
});

// ============================================================================
// 7. DEFAULT ON — the reveal itself
// ============================================================================

test('DEFAULT: the SEED turns the turnaround block on', () => {
  // The round-6 change in one line. Before: `turnaround: false` in REPORT_OPTIONS_SEED, so a
  // stock install rendered the 20-07 reference monthly slide (table + one bar chart) and the
  // block was reachable only by hand-editing settings. The user's reference image is his own
  // historic deck WITH the block, so the default flipped.
  assert.equal(
    REPORT_OPTIONS_SEED.kpiCards.turnaround, true,
    'the shipped default for the turnaround block is ON',
  );
  // …and the seed actually reaches the slide. Driven through the WHOLE seed object, not a
  // hand-written { turnaround: true }, so this fails if the seed and build-spec's toggle
  // mechanism ever disagree about what "on" means for this key.
  const slide = monthlySlide({ ...MOCK_REPORT_MODEL, reportOptions: REPORT_OPTIONS_SEED });
  assert.ok(turnaroundChart(slide), 'a stock install renders the turnaround line chart');
  assert.equal(
    textsOf(slide).filter((t) => FIGURE_RE.test(t)).length, 2,
    'and the two-figure card beside it',
  );
});

test('DEFAULT: the toggle still WORKS — kpiCards.turnaround false hides chart and card', () => {
  // On-by-default is not the same as always-on. The Settings checkbox keeps its meaning, so
  // an explicit false must still produce the reference-shape monthly slide.
  const slide = monthlySlide({
    ...MOCK_REPORT_MODEL,
    reportOptions: {
      ...REPORT_OPTIONS_SEED,
      kpiCards: { ...REPORT_OPTIONS_SEED.kpiCards, turnaround: false },
    },
  });
  assert.equal(
    slide.elements.find((e) => e.t === 'chart' && e.kind === 'line'), undefined,
    'no turnaround line chart when the flag is explicitly false',
  );
  assert.equal(
    textsOf(slide).filter((t) => FIGURE_RE.test(t)).length, 0,
    'and no card figures',
  );
  // The rest of the slide is untouched — this is a HIDE, not an empty slide. The monthly
  // bar chart and the four-row table are what the reference deck shows on their own.
  assert.ok(
    slide.elements.find((e) => e.t === 'chart' && e.kind === 'colClustered'),
    'the monthly bar chart still renders',
  );
  assert.ok(slide.elements.find((e) => e.t === 'table'), 'the monthly table still renders');
});
