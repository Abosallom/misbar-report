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
//
// ROUND 4 (2026-08-06) — THE TWO KEY CLASSES SPLIT, and only one of them moved.
// The paragraph above still describes the six EVENT keys exactly: they stay the
// in-window event count, asof(end) − asof(dayBefore(start)). The four QUEUE keys
// (engine/asof.js QUEUE_KEYS) stopped being a signed net change and became
// SURVIVING ENTRANTS — rows that ENTERED the state inside the window and are STILL
// in it at the window's end. That makes them a COUNT, so they are always ≥ 0, and
// it makes them answer the question Talal actually asked ("how much work landed in
// this queue this week?") instead of the one a net change answers ("how much did
// the pile move?"). The two questions genuinely differ: a queue whose TOTAL FELL
// across the window can still report a POSITIVE number, because many pre-window
// members left while a few in-window entrants stayed. That is not a contradiction
// with the big cumulative number beside it — it is the point — and it is pinned as
// its own flagship case in section 3.
// Chips are POSITIVE-ONLY on both surfaces now (build-spec fmtDelta, screen-review
// bannerChipVisible), so a negative was never renderable; what changed here is the
// MEANING of the number, not merely its sign.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeWindowDeltas, windowFor, stampWindowDeltas, isoFromDays, isoToDays,
} from '../src/model/delta-window.js';
// QUEUE_KEYS is IMPORTED, not re-declared: this file used to carry its own STATE_KEYS
// literal, so the exhaustive-split assertion below could only ever prove the local copy
// was exhaustive — a key promoted to the queue class in asof.js and forgotten here would
// have kept passing while every case in section 3 silently tested the wrong four keys.
// computeNumbersAsOf is imported for ONE purpose: the flagship case reads the raw as-of
// depths at both window endpoints, so "the total fell while the delta is positive" is
// SHOWN from the fixture rather than asserted by narration.
import { NUMBER_KEYS, QUEUE_KEYS, computeNumbersAsOf } from '../src/engine/asof.js';
import { DEFAULT_DELTA_MODE } from '../src/model/delta-baseline.js';

const EVENT_KEYS = ['total', 'collected', 'dispatched', 'received', 'completed', 'rejected'];

/** A full OrderRow with everything nulled — only the fields a case cares about are set. */
const row = (o) => ({
  orderDate: null, facility: 'Lab W', orderId: null, lineNo: null, loinc: null,
  testName: 'ANY TEST', collected: null, dispatched: null, received: null, resulted: null,
  rawStatus: 'In Progress', tatDaysCsv: 5,
  specimenNo: null, shipmentId: null, orderingFacilityId: null, performingFacilityId: null,
  ...o,
});

// A calendar anchor used throughout. The DELTA week runs Fri → Thu, so the week
// containing 2026-07-05 opens on Fri 2026-07-03 and closes on Thu 2026-07-09.
//   Fri 07-03, Sat 07-04, Sun 07-05, Mon 07-06, Tue 07-07, Wed 07-08, Thu 07-09
// Fri 07-10 then OPENS the next week; Sat 07-11 is its second day.
const WEEK_FRI = '2026-07-03';
const SUN = '2026-07-05';
const THU = '2026-07-09';
const FRI = '2026-07-10';
const SAT = '2026-07-11';

// =============================================================================
// 1. THE WINDOW — where Friday opens it and how consecutive weeks tile
// =============================================================================

test('window: week mode spans [Friday-of-week, reportDate]; a Friday maps to itself', () => {
  assert.deepEqual(windowFor(WEEK_FRI, 'week'), { start: WEEK_FRI, end: WEEK_FRI, mode: 'week' });
  assert.deepEqual(windowFor(SUN, 'week'), { start: WEEK_FRI, end: SUN, mode: 'week' });
  assert.deepEqual(windowFor(THU, 'week'), { start: WEEK_FRI, end: THU, mode: 'week' });
  // Every day resolves to the SAME Friday — that is what makes a Thursday report
  // "the whole week" (a full seven days) rather than "since whenever we last ran".
  for (const d of [WEEK_FRI, '2026-07-04', SUN, '2026-07-06', '2026-07-07', '2026-07-08', THU]) {
    assert.equal(windowFor(d, 'week').start, WEEK_FRI, `${d} must open at ${WEEK_FRI}`);
  }
});

test('window: a FRIDAY OPENS the next week, and consecutive weeks TILE with no gap', () => {
  // THE BUG THIS PINS (Aziz, 2026-08-31): with a Sunday start, Thursday-to-Thursday
  // reporting never counted the Friday and Saturday in between — they belonged to a
  // window nobody looked at. A Friday start makes Fri..Thu a full seven days, so
  // back-to-back Thursday readings cover 14 contiguous days with no gap or overlap.
  assert.deepEqual(windowFor(FRI, 'week'), { start: FRI, end: FRI, mode: 'week' });
  assert.deepEqual(windowFor(SAT, 'week'), { start: FRI, end: SAT, mode: 'week' });

  const thisThu = windowFor(THU, 'week');          // Fri 07-03 .. Thu 07-09
  const nextThu = windowFor('2026-07-16', 'week'); // Fri 07-10 .. Thu 07-16
  assert.equal(thisThu.start, WEEK_FRI);
  assert.equal(nextThu.start, FRI);
  // the second window opens the very next day after the first one closes
  const dayAfter = new Date(new Date(thisThu.end + 'T00:00:00Z').getTime() + 86400000)
    .toISOString().slice(0, 10);
  assert.equal(nextThu.start, dayAfter, 'no day may fall between two consecutive weeks');
  assert.equal(nextThu.start, '2026-07-10');
  assert.ok(FRI >= thisThu.end, 'the Friday that used to be skipped now opens a week');
});

test('window: daily mode is the report date on both ends', () => {
  assert.deepEqual(windowFor(THU, 'daily'), { start: THU, end: THU, mode: 'daily' });
  assert.deepEqual(windowFor(FRI, 'daily'), { start: FRI, end: FRI, mode: 'daily' });
});

test('window: the DEFAULT mode is week, and an unknown mode never silently goes daily', () => {
  assert.equal(DEFAULT_DELTA_MODE, 'week');
  for (const m of [undefined, null, '', 'weekly-sun', 'weekly-thu', 'nonsense', 42]) {
    assert.equal(windowFor(THU, m).mode, 'week', `mode ${JSON.stringify(m)} must resolve to week`);
    assert.equal(windowFor(THU, m).start, WEEK_FRI);
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
  assert.deepEqual(res.window, { start: WEEK_FRI, end: THU });

  // Hand count over Fri 07-03 .. Thu 07-09 — read straight off the rows above:
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

test('REGRESSION: events dated on the FRIDAY or SATURDAY are counted, not skipped', () => {
  // The exact defect Aziz hit: under a Sunday-opening week these two rows landed in
  // the gap between one Thursday reading and the next, so their results were never
  // reflected in any chip — the completed count simply jumped between readings with
  // no delta to explain it. They must now land inside the Thursday window.
  const weekendRows = [
    row({ orderId: 'G', orderDate: '2026-07-03', collected: '2026-07-03 08:00:00', dispatched: '2026-07-03 09:00:00', received: '2026-07-03 10:00:00', resulted: '2026-07-03 12:00:00', rawStatus: 'Result Available' }),
    row({ orderId: 'H', orderDate: '2026-07-04', collected: '2026-07-04 08:00:00', dispatched: '2026-07-04 09:00:00', received: '2026-07-04 10:00:00', resulted: '2026-07-04 12:00:00', rawStatus: 'Result Available' }),
  ];
  const res = computeWindowDeltas({ rows: weekendRows, tatTests: {}, reportDate: THU, mode: 'week' });
  assert.equal(res.window.start, WEEK_FRI);
  assert.equal(res.deltas.completed, 2, 'both weekend results must appear in the Thursday chip');
  assert.equal(res.deltas.total, 2);
  assert.equal(res.deltas.received, 2);
  // And they are counted ONCE: the following Thursday's window must not repeat them.
  const next = computeWindowDeltas({ rows: weekendRows, tatTests: {}, reportDate: '2026-07-16', mode: 'week' });
  assert.equal(next.deltas.completed, 0, 'a later week must not re-count them');
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
// 3. QUEUE KEYS — SURVIVING ENTRANTS, a count that can never be negative
// =============================================================================

test('QUEUE keys are SURVIVING ENTRANTS — a queue that only DRAINED shows 0, not −1', () => {
  // Row D alone, re-derived field by field from the fixture above:
  //   orderDate 07-01, collected 07-01, dispatched 07-01, received 07-02,
  //   resulted 07-06, rawStatus 'Result Available'.
  // Window Sun 07-05 .. Thu 07-09, so the queue pass runs at asOf 07-09 with
  // sinceIso 07-05 and the event anchor is Sat 07-04.
  //
  // QUEUE keys — membership at asOf 07-09, before the entry-day gate even matters:
  //   awaitingDispatch   needs !dispatched≤07-09; dispatched 07-01 ⇒ OUT  ⇒ 0
  //   shippedNotReceived needs !received≤07-09;   received 07-02   ⇒ OUT  ⇒ 0
  //   awaitingResults    needs !resulted≤07-09;   resulted 07-06   ⇒ OUT  ⇒ 0
  //   lateNoResult       is a subset of awaitingResults            ⇒ 0
  // D sat in awaitingResults from 07-02 and left on 07-06, i.e. it ENTERED before the
  // window opened and did not survive to its end — it fails BOTH halves of "surviving
  // entrant" and contributes nothing. Under the retired net-change rule this same row
  // produced −1 (depth 1 → 0); the drain is real, but it is not activity that ARRIVED
  // this week, and a count of arrivals has no way to express it. That is the whole
  // change: the chip stopped reporting the pile's motion and started reporting intake.
  const drained = [WEEK_ROWS.find((r) => r.orderId === 'D')];
  const res = computeWindowDeltas({ rows: drained, tatTests: {}, reportDate: THU, mode: 'week' });
  assert.equal(res.deltas.awaitingResults, 0, 'a drain is not an entrant — 0, never −1');
  for (const k of QUEUE_KEYS) {
    assert.equal(res.deltas[k], 0, `queue key ${k} has no surviving entrant here`);
  }
  // EVENT keys, hand-counted the same way — asof(07-09) − asof(07-04):
  //   total      order 07-01 ≤ both ends            ⇒ 1 − 1 = 0
  //   received   received 07-02 ≤ both ends         ⇒ 1 − 1 = 0
  //   completed  resulted 07-06: in at 07-09, out at 07-04 ⇒ 1 − 0 = 1
  assert.equal(res.deltas.completed, 1, 'and the event key still counts the completion');
  assert.equal(res.deltas.total, 0);
  assert.equal(res.deltas.received, 0);
  // No key may go negative any more, on this row or any other.
  for (const k of NUMBER_KEYS) assert.ok(res.deltas[k] >= 0, `key ${k} must not be negative`);
});

test('QUEUE keys count entrants that SURVIVED; churn inside the window counts for nothing', () => {
  // B alone: ordered AND collected on Sunday 07-05, never dispatched → at asOf 07-09 it
  // is still in awaitingDispatch, and its entry day (the ORDER day, which is when a row
  // joins the pre-dispatch queue) is 07-05 — exactly the window's first day. The gate is
  // `entry ≥ since`, so this is the INCLUSIVE boundary: shift it to `>` and Sunday's own
  // arrivals disappear from the week that is named after Sunday.
  const onlyB = computeWindowDeltas({
    rows: [WEEK_ROWS.find((r) => r.orderId === 'B')], tatTests: {}, reportDate: THU, mode: 'week',
  });
  assert.equal(onlyB.deltas.awaitingDispatch, 1, 'B entered on the window\'s first day and stayed');

  const res = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate: THU, mode: 'week' });
  // FULL SET, awaitingDispatch — who is in the queue at asOf 07-09, and did each enter
  // on or after 07-05?
  //   A  dispatched 07-06 ⇒ OUT of the queue
  //   B  never dispatched ⇒ IN,  entry = order 07-05 ≥ 07-05  ⇒ COUNTS
  //   C  dispatched 07-08 ⇒ OUT ;  D, E dispatched 07-01 ⇒ OUT
  //   F  ordered 07-12, after the window's end ⇒ not counted at all
  // ⇒ 1. This is where the rewrite is VISIBLE on the shared fixture: the old rule netted
  // this to 0, because A — which had been waiting since 07-02 — was dispatched inside the
  // window and its exit cancelled B's arrival. A pre-window row leaving no longer offsets
  // an in-window row arriving; only B's own arrival is the week's intake.
  assert.equal(res.deltas.awaitingDispatch, 1, 'B arrived and stayed; A\'s exit no longer cancels it');
  assert.equal(res.deltas.dispatched, 2, '…and the event key still counts both dispatches');
  // FULL SET, shippedNotReceived — still 0, but for an entirely NEW reason. The transit
  // queue is EMPTY at 07-09 (A received 07-07, C received 07-08), so nobody can be a
  // survivor: A entered on 07-06 and C on 07-08, both inside the window, and both left it
  // inside the window too. They are entrants, not SURVIVING entrants. The old rule reached
  // the same 0 by netting +2 arrivals against −2 departures; identical number, opposite
  // derivation, which is exactly why it needs saying here.
  assert.equal(res.deltas.shippedNotReceived, 0, 'both entrants exited before the window closed');
  assert.equal(res.deltas.received, 2);
  // FULL SET, awaitingResults — A is received 07-07 with no result, so it is IN at 07-09
  // and its entry day 07-07 is inside the window ⇒ 1. (D's pre-window arrival drained in
  // the same week and, per the case above, contributes nothing either way.)
  assert.equal(res.deltas.awaitingResults, 1, 'A arrived in the results queue and is still there');
  // FULL SET, lateNoResult — 0. A is the only row awaiting a result: received Tue 07-07
  // with tatDaysCsv 5, so Due = WORKDAY(07-07, 5) = Wed 07-08, Thu 07-09, Sun 07-12,
  // Mon 07-13, Tue 07-14 under the Fri+Sat weekend. 07-14 is past the window's end, so A
  // has not entered lateness at all yet.
  assert.equal(res.deltas.lateNoResult, 0, 'A is not due until 07-14 — nothing has fallen late');

  for (const k of NUMBER_KEYS) {
    assert.equal(typeof res.deltas[k], 'number', `key ${k} is a number`);
    assert.ok(Number.isFinite(res.deltas[k]), `key ${k} is finite`);
  }
  // All ten keys are present — a missing key would render as a blank chip.
  assert.deepEqual(Object.keys(res.deltas).sort(), [...NUMBER_KEYS].sort());
  // NO key may be negative now. Event keys count dated milestones, which only ever
  // accumulate; queue keys are a filtered COUNT of rows sitting in a state, never a
  // difference of two counts. Negativity is unreachable for both classes.
  for (const k of NUMBER_KEYS) assert.ok(res.deltas[k] >= 0, `key ${k} must not be negative`);
  // And the queue keys are exactly the remaining four — the split is exhaustive, checked
  // against the IMPORTED QUEUE_KEYS so asof.js owns the membership.
  assert.deepEqual([...EVENT_KEYS, ...QUEUE_KEYS].sort(), [...NUMBER_KEYS].sort());
});

// The flagship case for the round-4 rule, and the one the user called out by name.
//   X1, X2 — ordered 07-01, still undispatched when the window opens, then dispatched,
//            received and resulted INSIDE the window. Two pre-window members leaving.
//   Y      — ordered 07-06 and never dispatched. One in-window entrant staying.
// awaitingDispatch depth: 2 at the anchor (Sat 07-04) → 1 at the end (Thu 07-09).
const FALLING_QUEUE_ROWS = [
  row({ orderId: 'X1', orderDate: '2026-07-01', collected: '2026-07-01 08:00:00', dispatched: '2026-07-06 09:00:00', received: '2026-07-06 10:00:00', resulted: '2026-07-07 11:00:00', rawStatus: 'Result Available' }),
  row({ orderId: 'X2', orderDate: '2026-07-01', collected: '2026-07-01 08:00:00', dispatched: '2026-07-06 09:00:00', received: '2026-07-06 10:00:00', resulted: '2026-07-07 11:00:00', rawStatus: 'Result Available' }),
  row({ orderId: 'Y', orderDate: '2026-07-06', collected: '2026-07-06 08:00:00' }),
];

test('FLAGSHIP: a queue whose TOTAL FELL still reports a POSITIVE delta', () => {
  // The scenario the spec calls out, shown from the raw as-of depths rather than
  // described. The big number on the card is the cumulative depth and it went DOWN;
  // the chip is the week's intake and it is UP. Both are true at once, and any rule
  // that forces them to share a sign is wrong about one of them.
  const anchor = computeNumbersAsOf({ rows: FALLING_QUEUE_ROWS, tatTests: {}, asOfIso: '2026-07-04' }).numbers;
  const end = computeNumbersAsOf({ rows: FALLING_QUEUE_ROWS, tatTests: {}, asOfIso: THU }).numbers;
  assert.equal(anchor.awaitingDispatch, 2, 'X1+X2 are waiting when the window opens');
  assert.equal(end.awaitingDispatch, 1, 'only Y is waiting when it closes');
  assert.ok(end.awaitingDispatch < anchor.awaitingDispatch, 'the queue TOTAL fell across the week');

  const res = computeWindowDeltas({ rows: FALLING_QUEUE_ROWS, tatTests: {}, reportDate: THU, mode: 'week' });
  // Surviving entrants at 07-09 with since 07-05: X1/X2 are OUT of the queue (dispatched
  // 07-06); Y is IN and entered on its order day 07-06 ≥ 07-05 ⇒ 1.
  assert.equal(res.deltas.awaitingDispatch, 1, 'one in-window arrival survived ⇒ +1');
  // The retired net-change rule produced end − anchor = 1 − 2 = −1 here, which the
  // positive-only chip would then have hidden: a week in which a new order arrived and is
  // still sitting unshipped would have rendered NOTHING on the card.
  assert.notEqual(res.deltas.awaitingDispatch, end.awaitingDispatch - anchor.awaitingDispatch);
  assert.ok(res.deltas.awaitingDispatch > 0, 'and it is renderable — chips are positive-only');

  // The other three queues are empty at 07-09 (X1/X2 resulted 07-07, Y never dispatched).
  assert.equal(res.deltas.shippedNotReceived, 0);
  assert.equal(res.deltas.awaitingResults, 0);
  assert.equal(res.deltas.lateNoResult, 0);
  // Event keys, hand-counted as asof(07-09) − asof(07-04):
  //   total      X1,X2 (07-01) at both ends + Y (07-06) at the end only ⇒ 3 − 2 = 1
  //   collected  same dates as the orders                               ⇒ 3 − 2 = 1
  //   dispatched X1,X2 on 07-06                                         ⇒ 2 − 0 = 2
  //   received   X1,X2 on 07-06                                         ⇒ 2 − 0 = 2
  //   completed  X1,X2 resulted 07-07                                   ⇒ 2 − 0 = 2
  assert.deepEqual(
    Object.fromEntries(EVENT_KEYS.map((k) => [k, res.deltas[k]])),
    { total: 1, collected: 1, dispatched: 2, received: 2, completed: 2, rejected: 0 },
  );
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
  assert.deepEqual(stamped, { start: WEEK_FRI, end: THU, mode: 'week' });
  assert.deepEqual(model.deltaWindow, { start: WEEK_FRI, end: THU, mode: 'week' });
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

test('CROSS-SURFACE: a Friday reading OPENS a new week and does not inherit Thursday\'s', () => {
  // Under the old Sunday start, Fri/Sat folded back and repeated Thursday's chips.
  // They now open the NEXT week: the floor moves to the Friday itself, so the week
  // just reported on is not counted a second time. The fixture has nothing dated on
  // 07-10/07-11, so the new week legitimately starts empty on the event keys.
  const thu = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate: THU, mode: 'week' });
  const fri = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate: FRI, mode: 'week' });
  const sat = computeWindowDeltas({ rows: WEEK_ROWS, tatTests: {}, reportDate: SAT, mode: 'week' });
  assert.equal(thu.window.start, WEEK_FRI);
  assert.equal(fri.window.start, FRI, 'a Friday opens its own week');
  assert.equal(sat.window.start, FRI, 'Saturday is day two of that same week');
  // Fri and Sat sit in one window, so they agree with each other …
  assert.deepEqual(sat.deltas, fri.deltas);
  // … and the week's events are NOT re-counted into it.
  assert.notDeepEqual(fri.deltas, thu.deltas, 'the new week must not repeat the old one');
  for (const k of ['total', 'collected', 'dispatched', 'received', 'completed', 'rejected']) {
    assert.equal(fri.deltas[k], 0, `${k}: nothing is dated inside the new week yet`);
  }
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
  // The flag has to scope the QUEUE pass too, not just the event subtraction — that pass
  // is a separate gated call to computeNumbersAsOf and could have been given a different
  // row set by accident. N is received 07-08 with no result, so at asOf 07-09 it sits in
  // awaitingResults with entry day 07-08, inside the window: a surviving entrant. Kept
  // ⇒ A (entry 07-07) + N = 2; dropped ⇒ A alone = 1.
  assert.equal(kept.kpi.deltas.awaitingResults, 2, 'N is a surviving entrant when kept');
  assert.equal(dropped.kpi.deltas.awaitingResults, 1, 'and vanishes from the queue pass when excluded');
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
