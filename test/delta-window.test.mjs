// test/delta-window.test.mjs — `node --test test/delta-window.test.mjs`
//
// THE WEEK'S ACTIVITY behind the small green chips (Talal, 2026-08-05).
//
// THE INVARIANT, restated because every case below depends on it: the BIG numbers
// on slides 2/3/4 — the exec KPI cards, the journey stage counts, the monthly table,
// the compliance table — REMAIN CUMULATIVE TOTALS, untouched. ONLY the small green
// delta chips change meaning: they become the events dated Sunday..report-day,
// counted from the CSV's OWN date columns. This file pins that new meaning and
// nothing else; the totals are pinned by engine.test.mjs and reconciliation.test.mjs.
//
// What died: the chips used to be a DIFF AGAINST A STORED REPORT
// (delta-baseline.js's pickDeltaBaseline). No stored history participates here at
// all — the stamper is a pure function of rows + report date, so it is IDEMPOTENT
// by construction, which is asserted directly below.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeWindowDeltas, windowFor, stampWindowDeltas, isoFromDays, isoToDays,
} from '../src/model/delta-window.js';
import { NUMBER_KEYS } from '../src/engine/asof.js';
import { DEFAULT_DELTA_MODE } from '../src/model/delta-baseline.js';

const EVENT_KEYS = ['total', 'collected', 'dispatched', 'received', 'completed', 'rejected'];
const STATE_KEYS = ['awaitingDispatch', 'shippedNotReceived', 'awaitingResults', 'lateNoResult'];

/** A full OrderRow with everything nulled — only the fields a case cares about are set. */
const row = (o) => ({
  orderDate: null, facility: 'Lab W', orderId: null, lineNo: null, loinc: null,
  testName: 'ANY TEST', collected: null, dispatched: null, received: null, resulted: null,
  rawStatus: 'In Progress', tatDaysCsv: 5,
  specimenNo: null, shipmentId: null, orderingFacilityId: null, performingFacilityId: null,
  ...o,
});

// A calendar anchor used throughout. 2026-07-05 is a SUNDAY; the Saudi work week
// runs Sun 07-05 → Thu 07-09, and Fri 07-10 / Sat 07-11 are the weekend.
//   Sun 07-05, Mon 07-06, Tue 07-07, Wed 07-08, Thu 07-09, Fri 07-10, Sat 07-11
const SUN = '2026-07-05';
const THU = '2026-07-09';
const FRI = '2026-07-10';
const SAT = '2026-07-11';

// =============================================================================
// 1. THE WINDOW — where Sunday starts and how the weekend folds back
// =============================================================================

test('window: week mode spans [Sunday-of-week, reportDate]; a Sunday maps to itself', () => {
  assert.deepEqual(windowFor(SUN, 'week'), { start: SUN, end: SUN, mode: 'week' });
  assert.deepEqual(windowFor('2026-07-06', 'week'), { start: SUN, end: '2026-07-06', mode: 'week' });
  assert.deepEqual(windowFor(THU, 'week'), { start: SUN, end: THU, mode: 'week' });
  // Every day of the work week resolves to the SAME Sunday — that is what makes a
  // Thursday report "the whole week" rather than "since whenever we last ran".
  for (const d of [SUN, '2026-07-06', '2026-07-07', '2026-07-08', THU]) {
    assert.equal(windowFor(d, 'week').start, SUN, `${d} must open at ${SUN}`);
  }
});

test('window: a FRIDAY or SATURDAY report folds back into the week that JUST ENDED', () => {
  // The weekend is Fri+Sat, so a report generated on one of them is reporting on the
  // Sun–Thu week behind it, not opening a new one. Without this the chips on a
  // Saturday run would read '+0' for a week of real work.
  assert.deepEqual(windowFor(FRI, 'week'), { start: SUN, end: FRI, mode: 'week' });
  assert.deepEqual(windowFor(SAT, 'week'), { start: SUN, end: SAT, mode: 'week' });
  // …and the NEXT Sunday opens a fresh window, so the fold-back is bounded.
  assert.equal(windowFor('2026-07-12', 'week').start, '2026-07-12');
});

test('window: daily mode is the report date on both ends', () => {
  assert.deepEqual(windowFor(THU, 'daily'), { start: THU, end: THU, mode: 'daily' });
  assert.deepEqual(windowFor(FRI, 'daily'), { start: FRI, end: FRI, mode: 'daily' });
});

test('window: the DEFAULT mode is week, and an unknown mode never silently goes daily', () => {
  assert.equal(DEFAULT_DELTA_MODE, 'week');
  for (const m of [undefined, null, '', 'weekly-sun', 'weekly-thu', 'nonsense', 42]) {
    assert.equal(windowFor(THU, m).mode, 'week', `mode ${JSON.stringify(m)} must resolve to week`);
    assert.equal(windowFor(THU, m).start, SUN);
  }
});

test('window: a missing or malformed report date throws (the stampers catch it)', () => {
  for (const bad of [undefined, null, '', '2026-7-9', '09-07-2026', 'today', 20260709]) {
    assert.throws(() => windowFor(bad, 'week'), /reportDate/, `must reject ${JSON.stringify(bad)}`);
  }
});

// =============================================================================
// 2. EVENT SEMANTICS — the chips equal a HAND COUNT of in-window events
// =============================================================================

// Rows built so the answer can be counted by eye. All dates are inside July 2026.
//  A: ordered+collected BEFORE the week (Thu 07-02), dispatched Mon 07-06, received Tue 07-07
//  B: ordered Sun 07-05, collected Sun 07-05, nothing after
//  C: ordered Wed 07-08, collected Wed 07-08, dispatched Wed 07-08, received Wed 07-08,
//     resulted Thu 07-09
//  D: ordered+collected+dispatched+received all BEFORE the week (07-01/02), resulted Mon 07-06
//  E: entirely BEFORE the week — ordered..resulted all by 07-02 (must contribute NOTHING)
//  F: ordered AFTER the report date (Sun 07-12) — must contribute NOTHING to a 07-09 report
const WEEK_ROWS = [
  row({ orderId: 'A', orderDate: '2026-07-02', collected: '2026-07-02 08:00:00', dispatched: '2026-07-06 09:00:00', received: '2026-07-07 10:00:00' }),
  row({ orderId: 'B', orderDate: SUN, collected: '2026-07-05 08:00:00' }),
  row({ orderId: 'C', orderDate: '2026-07-08', collected: '2026-07-08 07:00:00', dispatched: '2026-07-08 08:00:00', received: '2026-07-08 09:00:00', resulted: '2026-07-09 15:00:00', rawStatus: 'Result Available' }),
  row({ orderId: 'D', orderDate: '2026-07-01', collected: '2026-07-01 08:00:00', dispatched: '2026-07-01 09:00:00', received: '2026-07-02 10:00:00', resulted: '2026-07-06 11:00:00', rawStatus: 'Result Available' }),
  row({ orderId: 'E', orderDate: '2026-07-01', collected: '2026-07-01 08:00:00', dispatched: '2026-07-01 09:00:00', received: '2026-07-01 10:00:00', resulted: '2026-07-02 11:00:00', rawStatus: 'Result Available' }),
  row({ orderId: 'F', orderDate: '2026-07-12', collected: '2026-07-12 08:00:00' }),
];

test('EVENT keys are the in-window event COUNT, matching a hand count of the dates', () => {
  const res = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate: THU, mode: 'week' });
  assert.deepEqual(res.window, { start: SUN, end: THU });

  // Hand count over Sun 07-05 .. Thu 07-09 — read straight off the rows above:
  //   total      (order dated in-window): B, C                    = 2
  //   collected  (collected in-window):   B, C                    = 2
  //   dispatched (dispatched in-window):  A (07-06), C (07-08)    = 2
  //   received   (received in-window):    A (07-07), C (07-08)    = 2
  //   completed  (result/reject dated):   D (07-06), C (07-09)    = 2
  //   rejected                                                    = 0
  // E is wholly before the window and F wholly after: neither may appear anywhere.
  for (const [k, want] of Object.entries({
    total: 2, collected: 2, dispatched: 2, received: 2, completed: 2, rejected: 0,
  })) {
    assert.equal(res.deltas[k], want, `event key ${k}`);
  }
});

test('event counts are counts of EVENTS, not of rows — one row can fire several keys', () => {
  // Row C alone crosses five milestones inside the window; each key counts it once.
  const only = [WEEK_ROWS.find((r) => r.orderId === 'C')];
  const res = computeWindowDeltas({ rows: only, tatTests: {}, reportDate: THU, mode: 'week' });
  assert.deepEqual(
    Object.fromEntries(EVENT_KEYS.map((k) => [k, res.deltas[k]])),
    { total: 1, collected: 1, dispatched: 1, received: 1, completed: 1, rejected: 0 },
  );
});

test('a row entirely outside the window contributes ZERO to every key', () => {
  const outside = WEEK_ROWS.filter((r) => r.orderId === 'E' || r.orderId === 'F');
  const res = computeWindowDeltas({ rows: outside, tatTests: {}, reportDate: THU, mode: 'week' });
  for (const k of NUMBER_KEYS) assert.equal(res.deltas[k], 0, `key ${k} must be 0`);
});

test('the window is INCLUSIVE at both ends — Sunday\'s and the report day\'s own events count', () => {
  // The anchor is the day BEFORE the window opens precisely so Sunday survives.
  // B is ordered ON Sunday; C is resulted ON Thursday. Drop either endpoint and one
  // of these two silently vanishes from the chips.
  const bc = WEEK_ROWS.filter((r) => r.orderId === 'B' || r.orderId === 'C');
  const res = computeWindowDeltas({ rows: bc, tatTests: {}, reportDate: THU, mode: 'week' });
  assert.equal(res.deltas.total, 2, 'Sunday-dated order is inside the window');
  assert.equal(res.deltas.completed, 1, 'Thursday-dated result is inside the window');
});

// =============================================================================
// 3. STATE KEYS — signed net change, never a count
// =============================================================================

test('STATE keys are a SIGNED NET CHANGE — a queue that drained shows a negative', () => {
  // One row that was already sitting in awaitingResults before the week (received
  // 07-02) and got its result INSIDE the week (07-06). Nothing entered the queue,
  // one thing left it: the net change must be −1, not 0 and not +1.
  const drained = [WEEK_ROWS.find((r) => r.orderId === 'D')];
  const res = computeWindowDeltas({ rows: drained, tatTests: {}, reportDate: THU, mode: 'week' });
  assert.equal(res.deltas.awaitingResults, -1, 'the queue drained by one');
  assert.equal(res.deltas.completed, 1, 'and the event key counts the completion');
  // The event keys for milestones it passed BEFORE the week stay at 0 — a state key
  // going negative must never leak into an event key.
  assert.equal(res.deltas.total, 0);
  assert.equal(res.deltas.received, 0);
});

test('STATE keys go POSITIVE when the queue grew, and every key is a finite number', () => {
  // B alone: collected Sunday, never dispatched → it enters awaitingDispatch inside
  // the window and is still sitting there on Thursday. +1.
  const onlyB = computeWindowDeltas({
    rows: [WEEK_ROWS.find((r) => r.orderId === 'B')], tatTests: {}, reportDate: THU, mode: 'week',
  });
  assert.equal(onlyB.deltas.awaitingDispatch, 1, 'B entered awaitingDispatch and stayed');

  const res = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate: THU, mode: 'week' });
  // On the FULL set awaitingDispatch nets to 0 — and that is the correct answer, not
  // a missing count: B entered the queue (+1) while A, which was already waiting
  // since 07-02, was dispatched on 07-06 and left it (−1). A state key reports the
  // NET depth change; the two dispatch EVENTS are what the `dispatched` chip counts.
  assert.equal(res.deltas.awaitingDispatch, 0, 'one in, one out ⇒ net 0');
  assert.equal(res.deltas.dispatched, 2, '…while the event key still counts both dispatches');
  // Same churn story one stage later: A and C both entered and left the transit queue
  // inside the window, so shippedNotReceived nets 0 with 2 receipts counted.
  assert.equal(res.deltas.shippedNotReceived, 0);
  assert.equal(res.deltas.received, 2);
  for (const k of NUMBER_KEYS) {
    assert.equal(typeof res.deltas[k], 'number', `key ${k} is a number`);
    assert.ok(Number.isFinite(res.deltas[k]), `key ${k} is finite`);
  }
  // All ten keys are present — a missing key would render as a blank chip.
  assert.deepEqual(Object.keys(res.deltas).sort(), [...NUMBER_KEYS].sort());
  // Event keys can never be negative on real data: they count dated milestones,
  // which only ever accumulate.
  for (const k of EVENT_KEYS) assert.ok(res.deltas[k] >= 0, `event key ${k} must not be negative`);
  // And the state keys are exactly the remaining four — the split is exhaustive.
  assert.deepEqual([...EVENT_KEYS, ...STATE_KEYS].sort(), [...NUMBER_KEYS].sort());
});

// =============================================================================
// 4. DAILY MODE
// =============================================================================

test('daily mode counts ONLY the report day, and the week is the union of its days', () => {
  // Wednesday alone: C's five milestones are all dated 07-08 except its result.
  const wed = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate: '2026-07-08', mode: 'daily' });
  assert.deepEqual(wed.window, { start: '2026-07-08', end: '2026-07-08' });
  assert.deepEqual(
    Object.fromEntries(EVENT_KEYS.map((k) => [k, wed.deltas[k]])),
    { total: 1, collected: 1, dispatched: 1, received: 1, completed: 0, rejected: 0 },
  );
  // Summing the five daily windows Sun..Thu must reproduce the week's EVENT keys
  // exactly — the week is a partition of its days, with no double counting at the
  // seams and nothing dropped between them.
  const days = [SUN, '2026-07-06', '2026-07-07', '2026-07-08', THU];
  const summed = Object.fromEntries(EVENT_KEYS.map((k) => [k, 0]));
  for (const d of days) {
    const one = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate: d, mode: 'daily' });
    for (const k of EVENT_KEYS) summed[k] += one.deltas[k];
  }
  const week = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate: THU, mode: 'week' });
  assert.deepEqual(summed, Object.fromEntries(EVENT_KEYS.map((k) => [k, week.deltas[k]])));
});

// =============================================================================
// 5. APPROXIMATION BUBBLING
// =============================================================================

test('approx bubbles the as-of rejected-dating caveat, and is absent when clean', () => {
  // A rejection carries no timestamp of its own, so asof.js dates it by the last
  // milestone the row is known to have reached and flags the keys it affects. That
  // caveat has to survive the subtraction — the review banner discloses it.
  const rejectedNoDate = [row({
    orderId: 'R', orderDate: '2026-07-06', collected: '2026-07-06 08:00:00',
    dispatched: '2026-07-06 09:00:00', received: '2026-07-07 10:00:00',
    resulted: '', rawStatus: 'Result Rejected',
  })];
  const res = computeWindowDeltas({ rows: rejectedNoDate, tatTests: {}, reportDate: THU, mode: 'week' });
  assert.ok(res.approx, 'the caveat must be present');
  assert.equal(res.approx.rejected, true);
  assert.equal(res.approx.completed, true, 'completed is affected too — it contains rejected');
  assert.equal(res.deltas.rejected, 1);
  assert.equal(res.deltas.completed, 1, 'counted ONCE, in both keys, on the same day');

  // Clean data → no `approx` key at all, so a banner can test for its presence.
  const clean = computeWindowDeltas({ rows: [WEEK_ROWS[2]], tatTests: {}, reportDate: THU, mode: 'week' });
  assert.equal(clean.approx, undefined, 'no caveat ⇒ the key is omitted, not set to {}');
});

// =============================================================================
// 6. THE STAMPER — purity, idempotency, degradation
// =============================================================================

/** Minimal ReportModel shaped like the real one, with engine-supplied deltas. */
const mkModel = (reportDate = THU, deltaMode) => ({
  reportDate,
  reportOptions: deltaMode ? { deltaMode } : {},
  kpi: {
    totals: { total: 6 },
    deltas: { total: 999, collected: 999, dispatched: 999, received: 999, completed: 999, rejected: 999, awaitingDispatch: 999, shippedNotReceived: 999, awaitingResults: 999, lateNoResult: 999 },
  },
});

test('stamp: writes model.kpi.deltas and model.deltaWindow, and retires model.deltaBaseline', () => {
  const model = mkModel();
  model.deltaBaseline = { mode: 'week', baselineDate: '2026-06-28', numbers: {} }; // the retired stamp
  const stamped = stampWindowDeltas(model, { rows: WEEK_ROWS, tatTests: {} });
  assert.deepEqual(stamped, { start: SUN, end: THU, mode: 'week' });
  assert.deepEqual(model.deltaWindow, { start: SUN, end: THU, mode: 'week' });
  // The engine's placeholder 999s are gone — the window values replaced them.
  assert.equal(model.kpi.deltas.total, 2);
  // A stale baseline stamp left on the same model is a trap for the next reader.
  assert.ok(!('deltaBaseline' in model), 'the retired deltaBaseline must be deleted');
});

test('stamp: IDEMPOTENT — stamping twice on one model produces an identical result', () => {
  // This is the bug class the rewrite kills: screen-generate re-runs the stamper on
  // the very model screen-review already stamped. The old baseline stamper could
  // pick a DIFFERENT baseline on the second pass and the deck silently won. A pure
  // function of (rows, reportDate, mode) cannot disagree with itself.
  const model = mkModel();
  const first = stampWindowDeltas(model, { rows: WEEK_ROWS, tatTests: {} });
  const afterFirst = JSON.parse(JSON.stringify({ deltas: model.kpi.deltas, window: model.deltaWindow }));
  const second = stampWindowDeltas(model, { rows: WEEK_ROWS, tatTests: {} });
  const afterSecond = JSON.parse(JSON.stringify({ deltas: model.kpi.deltas, window: model.deltaWindow }));
  assert.deepEqual(second, first);
  assert.deepEqual(afterSecond, afterFirst);
  // A third pass, and one through a fresh model object, agree too.
  stampWindowDeltas(model, { rows: WEEK_ROWS, tatTests: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(model.kpi.deltas)), afterFirst.deltas);
  const fresh = mkModel();
  stampWindowDeltas(fresh, { rows: WEEK_ROWS, tatTests: {} });
  assert.deepEqual(fresh.kpi.deltas, model.kpi.deltas);
});

test('stamp: mode precedence — explicit arg > settings.reportOptions > model > default', () => {
  const explicit = mkModel(THU, 'week');
  stampWindowDeltas(explicit, { rows: WEEK_ROWS, tatTests: {}, mode: 'daily' });
  assert.equal(explicit.deltaWindow.mode, 'daily', 'the explicit arg wins');

  const fromSettings = mkModel(THU, 'week');
  stampWindowDeltas(fromSettings, { rows: WEEK_ROWS, tatTests: {}, settings: { reportOptions: { deltaMode: 'daily' } } });
  assert.equal(fromSettings.deltaWindow.mode, 'daily', 'settings beat the model copy');

  const fromModel = mkModel(THU, 'daily');
  stampWindowDeltas(fromModel, { rows: WEEK_ROWS, tatTests: {} });
  assert.equal(fromModel.deltaWindow.mode, 'daily', 'the model\'s own reportOptions are read');

  const bare = mkModel(THU);
  stampWindowDeltas(bare, { rows: WEEK_ROWS, tatTests: {} });
  assert.equal(bare.deltaWindow.mode, 'week', 'nothing stored ⇒ the default, week');

  // A retired stored value can never re-daily-ify a user who never asked for it.
  const retired = mkModel(THU, 'weekly-thu');
  stampWindowDeltas(retired, { rows: WEEK_ROWS, tatTests: {} });
  assert.equal(retired.deltaWindow.mode, 'week');
});

test('stamp: DEGRADES rather than throwing — no rows, no model, no usable date', () => {
  // With nothing to date events by, the engine's own deltas must survive untouched:
  // chips the operator cannot trust are worse than the engine's.
  const noRows = mkModel();
  assert.equal(stampWindowDeltas(noRows, { rows: [], tatTests: {} }), null);
  assert.equal(noRows.kpi.deltas.total, 999, 'engine deltas left alone');
  assert.equal(noRows.deltaWindow, undefined, 'and no window is claimed');

  const badDate = mkModel('not-a-date');
  assert.equal(stampWindowDeltas(badDate, { rows: WEEK_ROWS, tatTests: {} }), null);
  assert.equal(badDate.kpi.deltas.total, 999);

  assert.equal(stampWindowDeltas(null, { rows: WEEK_ROWS, tatTests: {} }), null);
  assert.equal(stampWindowDeltas({}, { rows: WEEK_ROWS, tatTests: {} }), null);
  assert.equal(stampWindowDeltas(mkModel(), undefined), null, 'no args bag at all');
});

test('stamp: no STORED HISTORY participates — the same rows+date give the same chips', () => {
  // The whole point of the rewrite. Two "runs" with wildly different engine-supplied
  // starting deltas converge on the identical window answer, because nothing outside
  // (rows, reportDate, mode) is read.
  const a = mkModel();
  const b = mkModel();
  b.kpi.deltas = Object.fromEntries(NUMBER_KEYS.map((k) => [k, -12345]));
  stampWindowDeltas(a, { rows: WEEK_ROWS, tatTests: {} });
  stampWindowDeltas(b, { rows: WEEK_ROWS, tatTests: {} });
  assert.deepEqual(b.kpi.deltas, a.kpi.deltas);
});

// =============================================================================
// 7. CROSS-SURFACE — the stamped model agrees with the pure function
// =============================================================================

test('CROSS-SURFACE: stamped model.kpi.deltas === computeWindowDeltas output', () => {
  // One stamper, one definition. If a caller ever re-derives chips of its own, this
  // is the test that catches it.
  for (const mode of ['week', 'daily']) {
    for (const reportDate of [SUN, '2026-07-07', THU, FRI, SAT]) {
      const model = mkModel(reportDate, mode);
      const stamped = stampWindowDeltas(model, { rows: WEEK_ROWS, tatTests: {} });
      const pure = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate, mode });
      assert.deepEqual(model.kpi.deltas, pure.deltas, `deltas disagree for ${mode} @ ${reportDate}`);
      assert.deepEqual(
        { start: stamped.start, end: stamped.end, mode: stamped.mode },
        { start: pure.window.start, end: pure.window.end, mode: pure.mode },
        `window disagrees for ${mode} @ ${reportDate}`,
      );
    }
  }
});

test('CROSS-SURFACE: a Friday and a Saturday report describe the SAME just-ended week', () => {
  // Fri/Sat fold back to the same Sunday, and no work is dated on the weekend in this
  // fixture, so the two runs must produce identical chips — and identical to Thursday's.
  const thu = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate: THU, mode: 'week' });
  const fri = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate: FRI, mode: 'week' });
  const sat = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate: SAT, mode: 'week' });
  assert.equal(fri.window.start, SUN);
  assert.equal(sat.window.start, SUN);
  assert.deepEqual(fri.deltas, thu.deltas);
  assert.deepEqual(sat.deltas, thu.deltas);
});

// =============================================================================
// 8. THE DATE HELPERS the module re-exports
// =============================================================================

test('isoFromDays / isoToDays round-trip on the UTC epoch, not the host zone', () => {
  for (const iso of ['2026-01-01', '2026-07-05', '2026-12-31', '2027-02-28']) {
    assert.equal(isoFromDays(isoToDays(iso)), iso);
  }
  // The day BEFORE a window start — the anchor the whole subtraction hangs on —
  // crosses a month boundary correctly.
  assert.equal(isoFromDays(isoToDays('2026-08-02') - 1), '2026-08-01');
  assert.equal(isoFromDays(isoToDays('2026-01-01') - 1), '2025-12-31');
});

// =============================================================================
// 5. excludeNoTat — the stamper must count the SAME row set the deck's totals do
// =============================================================================
// reportOptions.excludeNoTat drops 'No Match' rows (received present, StdTAT
// unresolvable from lookup AND CSV) from the engine's totals. The chips must speak
// that same row set, so stampWindowDeltas derives the flag from settings/model
// reportOptions when the caller passes no opts. A NOMATCH fixture row: every date
// in-window, but an unknown test name and no CSV TAT.
const NOMATCH = row({
  orderId: 'N', orderDate: '2026-07-08', testName: 'TEST WITH NO TAT ANYWHERE',
  tatDaysCsv: null, collected: '2026-07-08 07:30:00', dispatched: '2026-07-08 08:30:00',
  received: '2026-07-08 09:30:00',
});

test('excludeNoTat: the flag changes the chips — a No Match row counts only when kept', () => {
  const kept = mkModel();
  kept.reportOptions.excludeNoTat = false;
  stampWindowDeltas(kept, { rows: [...WEEK_ROWS, NOMATCH], tatTests: {} });

  const dropped = mkModel();
  dropped.reportOptions.excludeNoTat = true;
  stampWindowDeltas(dropped, { rows: [...WEEK_ROWS, NOMATCH], tatTests: {} });

  for (const k of ['total', 'collected', 'dispatched', 'received']) {
    assert.equal(kept.kpi.deltas[k] - dropped.kpi.deltas[k], 1,
      `${k}: the No Match row must count when kept and vanish when excluded`);
  }
  // WEEK_ROWS all resolve a TAT via tatDaysCsv, so the flag may touch nothing else.
  assert.equal(kept.kpi.deltas.completed, dropped.kpi.deltas.completed);
});

test('excludeNoTat: settings.reportOptions beat the model copy, like deltaMode', () => {
  const model = mkModel();
  model.reportOptions.excludeNoTat = false; // stale model copy says keep
  stampWindowDeltas(model, {
    rows: [...WEEK_ROWS, NOMATCH], tatTests: {},
    settings: { reportOptions: { excludeNoTat: true } },
  });
  const bare = mkModel();
  bare.reportOptions.excludeNoTat = true;
  stampWindowDeltas(bare, { rows: [...WEEK_ROWS, NOMATCH], tatTests: {} });
  assert.deepEqual(model.kpi.deltas, bare.kpi.deltas,
    'the settings flag must win over the model copy');
});

test('excludeNoTat: stamping stays IDEMPOTENT with the flag active', () => {
  const model = mkModel();
  model.reportOptions.excludeNoTat = true;
  stampWindowDeltas(model, { rows: [...WEEK_ROWS, NOMATCH], tatTests: {} });
  const first = JSON.parse(JSON.stringify({ deltas: model.kpi.deltas, window: model.deltaWindow }));
  stampWindowDeltas(model, { rows: [...WEEK_ROWS, NOMATCH], tatTests: {} });
  assert.deepEqual(JSON.parse(JSON.stringify({ deltas: model.kpi.deltas, window: model.deltaWindow })), first);
});
