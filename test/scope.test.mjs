// test/scope.test.mjs — `node --test`
// model/scope.js: narrowing the ORDER ROWS a side report is computed from.
//
// THE PROOF (section 6) is the one that matters most. A date range does not just
// filter orders, it reads every kept order AS OF 'to' by blanking what happened
// later — a row-level restatement of engine/asof.js's key-by-key rules. If the two
// ever drift, a scoped deck would print headline numbers that the history panel
// (asof) contradicts for the very same day. So the ENGINE, run on applyScope's
// rows at asOf=to, must reproduce computeNumbersAsOf on the same order cohort for
// all 10 keys, over several golden ranges — including ranges where the shift is
// load-bearing (proved non-trivial below, not assumed).
//
// Every synthetic lab/shipment name here is invented ('Lab A', 'ELAB000001'): the
// repo is public and catalogue content never goes into source.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_SCOPE, normalizeScope, isScoped, hasRange, normShipmentId, parseShipmentIds,
  labOptions, findShipments, applyScope, shipmentDetails,
} from '../src/model/scope.js';
import { compute } from '../src/engine/engine.js';
// The review screen's order-figure builder: the one place scoped rows meet BOTH
// consumers that re-infer blank facilities (see the ambiguous-blank test in section 3).
import { buildOrderFigures } from '../src/ui/screen-review.js';
import { computeNumbersAsOf, NUMBER_KEYS } from '../src/engine/asof.js';
import { normFacility } from '../src/contracts.js';
import { GOLDEN_ORDERS } from './fixtures/golden-orders.js';
import { TAT_LOOKUP } from '../src/seeds/tat-lookup.js';

// The 10 published numbers pulled out of an EngineOutput — a COPY of
// test/asof.test.mjs's helper (itself a copy of screen-generate.js's
// currentNumbersOf), so the proof compares the SAME projection the app publishes.
// Copied, not imported: a test file is not a module other tests may depend on.
function currentNumbersOf(kpi) {
  const t = kpi.totals; const f = kpi.funnel; const b = kpi.buckets;
  return {
    total: t.total, collected: f.collected, dispatched: f.dispatched, received: f.received,
    completed: b.completed, rejected: b.rejected, awaitingDispatch: b.awaitingDispatch,
    shippedNotReceived: b.shippedNotReceived, awaitingResults: b.awaitingResults, lateNoResult: b.lateNoResult,
  };
}
// excludeNoTat is left OFF (compute's default: only `=== true` excludes).
const engineNumbers = (rows, asOf) => currentNumbersOf(compute(rows, TAT_LOOKUP, { asOf }));

/** A synthetic order line; only the fields scope.js and the engine read. */
const mk = (o = {}) => ({
  orderDate: '2026-09-15', facility: 'Lab A', orderId: 'O1', testName: 'TEST ONE',
  collected: null, dispatched: null, received: null, resulted: null,
  rawStatus: 'Order Confirmed', tatDaysCsv: null, shipmentId: null, ...o,
});

const orderDay = (r) => String(r.orderDate).slice(0, 10);

// =============================================================================
// 1. normalizeScope / isScoped / hasRange
// =============================================================================

test('normalizeScope: undefined and garbage collapse to the empty scope', () => {
  for (const g of [undefined, null, 42, 'labs', [], [1, 2], true, () => {}]) {
    assert.deepEqual(normalizeScope(g), { ...EMPTY_SCOPE, labs: [], shipments: [] }, `input ${String(g)}`);
    assert.equal(isScoped(g), false);
    assert.equal(hasRange(g), false);
  }
  assert.equal(isScoped(EMPTY_SCOPE), false);
  // Garbage INSIDE an object: non-string labs, object shipments, non-date dates.
  const n = normalizeScope({ labs: [null, 7, {}, '   '], shipments: [{}, null, '  '], from: 5, to: {} });
  assert.deepEqual(n, { labs: [], shipments: [], from: null, to: null, shipmentSlide: true });
});

test('normalizeScope: labs normFacility\'d + deduped, shipments normShipmentId\'d + deduped, order kept', () => {
  const n = normalizeScope({
    labs: ['  Lab   B ', 'Lab A', 'Lab B'], // '  Lab   B ' → 'Lab B' (whitespace collapsed) → dup of the 3rd
    shipments: [' elab2', 'ELAB1', 'elab2 ', ''], // → ELAB2, ELAB1 (dup + blank dropped)
  });
  assert.deepEqual(n.labs, ['Lab B', 'Lab A']);
  assert.deepEqual(n.shipments, ['ELAB2', 'ELAB1']);
  assert.equal(isScoped(n), true);
  assert.equal(hasRange(n), false);
  // A NEW object: normalising never hands back (or aliases) its input.
  const src = { labs: ['Lab A'] };
  const out = normalizeScope(src);
  assert.notEqual(out, src);
  assert.notEqual(out.labs, src.labs);
});

test('normalizeScope: dates are both-or-neither, strict YYYY-MM-DD, never swapped', () => {
  // only one end → no range at all (and not scoped, since nothing else is set)
  assert.deepEqual(normalizeScope({ from: '2026-09-11' }), { ...EMPTY_SCOPE, labs: [], shipments: [] });
  assert.equal(hasRange({ to: '2026-09-23' }), false);
  assert.equal(isScoped({ to: '2026-09-23' }), false);
  // one end invalid → both null (a half range is never kept)
  assert.equal(normalizeScope({ from: '2026-09-11', to: 'yesterday' }).from, null);
  // an impossible calendar date is rejected, not rolled over into the next month
  assert.equal(hasRange({ from: '2026-02-01', to: '2026-02-30' }), false);
  // from > to → both null (the review screen validates; this layer never guesses)
  assert.deepEqual(
    [normalizeScope({ from: '2026-09-23', to: '2026-09-11' }).from, normalizeScope({ from: '2026-09-23', to: '2026-09-11' }).to],
    [null, null],
  );
  // a datetime string is not a date input's value
  assert.equal(hasRange({ from: '2026-09-11 00:00:00', to: '2026-09-23' }), false);
  // valid (with stray whitespace), and a single-day range from == to
  const n = normalizeScope({ from: ' 2026-09-11 ', to: '2026-09-23' });
  assert.deepEqual([n.from, n.to], ['2026-09-11', '2026-09-23']);
  assert.equal(hasRange({ from: '2026-09-23', to: '2026-09-23' }), true);
  assert.equal(isScoped({ from: '2026-09-23', to: '2026-09-23' }), true);
});

test('normalizeScope: shipmentSlide is true unless explicitly false', () => {
  assert.equal(normalizeScope({}).shipmentSlide, true);
  assert.equal(normalizeScope({ shipmentSlide: 0 }).shipmentSlide, true);
  assert.equal(normalizeScope({ shipmentSlide: 'false' }).shipmentSlide, true);
  assert.equal(normalizeScope({ shipmentSlide: false }).shipmentSlide, false);
  // shipmentSlide alone does not make a report scoped — it only toggles a slide.
  assert.equal(isScoped({ shipmentSlide: false }), false);
});

test('EMPTY_SCOPE is frozen all the way down (a pushed lab would poison every reset)', () => {
  assert.ok(Object.isFrozen(EMPTY_SCOPE));
  assert.ok(Object.isFrozen(EMPTY_SCOPE.labs));
  assert.ok(Object.isFrozen(EMPTY_SCOPE.shipments));
  assert.throws(() => { EMPTY_SCOPE.labs.push('Lab A'); }, TypeError);
  assert.deepEqual(EMPTY_SCOPE, { labs: [], shipments: [], from: null, to: null, shipmentSlide: true });
});

// =============================================================================
// 2. Shipment ids: parse, normalise, find
// =============================================================================

test('parseShipmentIds: commas (Latin + Arabic), semicolons, whitespace, newlines; upper-cased, deduped', () => {
  // '  elab1, ELAB2،elab3\nELAB1 ' → elab1 | ELAB2 | elab3 | ELAB1 → upper → ELAB1 ELAB2 ELAB3 ELAB1
  // → the second ELAB1 is a duplicate of the first.
  assert.deepEqual(parseShipmentIds('  elab1, ELAB2،elab3\nELAB1 '), ['ELAB1', 'ELAB2', 'ELAB3']);
  assert.deepEqual(parseShipmentIds('a;b؛c\t\td  ,, ;'), ['A', 'B', 'C', 'D']);
  assert.deepEqual(parseShipmentIds(''), []);
  assert.deepEqual(parseShipmentIds(undefined), []);
  assert.deepEqual(parseShipmentIds(' ,،; \n'), []);
});

test('normShipmentId: trim + upper-case, never throws on null', () => {
  assert.equal(normShipmentId('  elab626016 '), 'ELAB626016');
  assert.equal(normShipmentId(null), '');
  assert.equal(normShipmentId(undefined), '');
  assert.equal(normShipmentId(12), '12');
});

test('findShipments: found/missing in input order, against ALL rows (cancelled included)', () => {
  const rows = [
    mk({ shipmentId: 'ELAB000001' }),
    mk({ shipmentId: ' elab000002 ' }), // row side normalised too
    mk({ shipmentId: 'ELAB000003', rawStatus: 'Order Cancelled' }), // still "exists"
    mk({ shipmentId: null }),
  ];
  // requested: 3, 9, 2, 1, 8, 1(dup) → found keeps 3,2,1 in that order; missing 9,8.
  const r = findShipments(rows, ['elab000003', 'ELAB000009', 'ELAB000002', 'ELAB000001', 'elab000008', 'ELAB000001']);
  assert.deepEqual(r, { found: ['ELAB000003', 'ELAB000002', 'ELAB000001'], missing: ['ELAB000009', 'ELAB000008'] });
  // pasted text works the same as an array
  assert.deepEqual(findShipments(rows, 'elab000001، elab000009').missing, ['ELAB000009']);
  assert.deepEqual(findShipments(rows, []), { found: [], missing: [] });
  assert.deepEqual(findShipments(undefined, ['X']), { found: [], missing: ['X'] });
});

// =============================================================================
// 3. Labs: options + filter, with blank-facility inference on the FULL set
// =============================================================================

test('labOptions: non-cancelled counts, inferred blanks included, busiest first then name', () => {
  const rows = [
    mk({ facility: 'Lab B', testName: 'T2' }),
    mk({ facility: 'Lab B', testName: 'T2' }),
    mk({ facility: 'Lab A', testName: 'T1' }),
    mk({ facility: null, testName: 'T1' }), // T1 only ever runs at Lab A → inferred Lab A
    mk({ facility: 'Lab C', testName: 'T3' }),
    mk({ facility: 'Lab C', testName: 'T3', rawStatus: 'Order Cancelled' }), // not counted
    mk({ facility: '  Lab   C', testName: 'T3', rawStatus: 'Order Cancelled' }), // not counted either
    mk({ facility: '', testName: 'T4' }), // T4 has no named lab anywhere → stays blank → omitted
  ];
  // Lab A 2 (1 + 1 inferred), Lab B 2, Lab C 1 (its two cancelled lines dropped).
  // Lab A and Lab B tie on 2 → name ascending puts A first.
  assert.deepEqual(labOptions(rows), [
    { lab: 'Lab A', count: 2 }, { lab: 'Lab B', count: 2 }, { lab: 'Lab C', count: 1 },
  ]);
  assert.deepEqual(labOptions(undefined), []);
});

test('lab filter: keeps only chosen labs; [] ("All Labs") keeps everything', () => {
  const rows = [
    mk({ orderId: '1', facility: 'Lab A' }),
    mk({ orderId: '2', facility: ' Lab  B ' }), // normFacility → 'Lab B'
    mk({ orderId: '3', facility: 'Lab C' }),
    mk({ orderId: '4', facility: 'Lab A', rawStatus: 'Order Cancelled' }), // cancelled lines are filtered like any other
  ];
  const ab = applyScope(rows, { labs: ['Lab A', 'Lab B'] });
  assert.deepEqual(ab.map((r) => r.orderId), ['1', '2', '4']);
  assert.deepEqual(applyScope(rows, { labs: ['Lab C'] }).map((r) => r.orderId), ['3']);
  assert.deepEqual(applyScope(rows, { labs: ['Nobody'] }), []);
  // All Labs = no lab filter = every row, and (unscoped) the very same row objects.
  const all = applyScope(rows, { labs: [] });
  assert.equal(all.length, rows.length);
  all.forEach((r, i) => assert.equal(r, rows[i]));
});

test('lab filter: a BLANK-but-inferable facility is kept under its inferred lab — inferred BEFORE filtering', () => {
  // The only evidence that T1 runs at Lab A is row 'x', which the SHIPMENT filter
  // removes. Inferring after filtering would leave 'b' blank and drop it from a Lab A
  // report the full report credits it to. Inferring on the full set first keeps it.
  const rows = [
    mk({ orderId: 'x', facility: 'Lab A', testName: 'T1', shipmentId: 'ELAB000002' }),
    mk({ orderId: 'b', facility: null, testName: 'T1', shipmentId: 'ELAB000001' }),
    mk({ orderId: 'y', facility: 'Lab B', testName: 'T2', shipmentId: 'ELAB000001' }),
  ];
  const out = applyScope(rows, { labs: ['Lab A'], shipments: ['ELAB000001'] });
  assert.deepEqual(out.map((r) => [r.orderId, r.facility]), [['b', 'Lab A']]);
  // Same with a range that excludes the informant row's order date.
  const byDate = [
    mk({ orderId: 'x', facility: 'Lab A', testName: 'T1', orderDate: '2026-08-01' }),
    mk({ orderId: 'b', facility: '  ', testName: 'T1', orderDate: '2026-09-15' }),
  ];
  const out2 = applyScope(byDate, { labs: ['Lab A'], from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(out2.map((r) => [r.orderId, r.facility]), [['b', 'Lab A']]);
  // The input row itself is untouched (inference fills a COPY).
  assert.equal(rows[1].facility, null);
  assert.equal(byDate[1].facility, '  ');
});

test('lab filter: an AMBIGUOUS blank matches no lab (dropped), but survives range-only and shipment-only scopes still blank', () => {
  const rows = [
    mk({ orderId: '1', facility: 'Lab A', testName: 'T1', shipmentId: 'ELAB000009' }),
    mk({ orderId: '2', facility: 'Lab B', testName: 'T1', shipmentId: 'ELAB000001' }),
    mk({ orderId: '3', facility: null, testName: 'T1', shipmentId: 'ELAB000009' }), // T1 at two labs → never guessed
  ];
  assert.deepEqual(applyScope(rows, { labs: ['Lab A'] }).map((r) => r.orderId), ['1']);
  const ranged = applyScope(rows, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(ranged.map((r) => [r.orderId, r.facility]), [['1', 'Lab A'], ['2', 'Lab B'], ['3', null]]);
  // The dangerous one: the shipment holds only Lab A's T1 row, so inferring on THIS
  // subset would credit '3' to Lab A. Inferred on the full set, it stays blank.
  const shipped = applyScope(rows, { shipments: ['ELAB000009'] });
  assert.deepEqual(shipped.map((r) => [r.orderId, r.facility]), [['1', 'Lab A'], ['3', null]]);
});

// applyScope's rows are only half of it: compute() and analyseSendout() BOTH run the
// shared inference on whatever rows they are handed, by default. Shown the shipment-only
// subset above, that pass sees one lab for the test and credits the ambiguous order to
// it, which the full report never does. Both therefore take `inferBlanks: false`, and
// the builder passes it ONLY for a scoped build (unscoped, their own pass IS the
// full-set inference, so skipping it there would break the byte-identical path). This
// check goes through the real builder (ui/screen-review.js buildOrderFigures → compute
// + analyseSendout) rather than the two consumers alone, so it fails if EITHER half —
// a consumer honouring the flag, or the builder passing it — goes missing.
// (engine.test.mjs and sendout.test.mjs pin the flag on each consumer directly.)
test('an AMBIGUOUS blank stays unattributed END TO END under a scope that hides the ambiguity (compliance + send-out)', () => {
  const rows = [
    mk({ orderId: 'a1', facility: 'Lab A', testName: 'TEST SHARED', shipmentId: 'ELAB000009' }),
    mk({ orderId: 'a2', facility: 'Lab A', testName: 'TEST SHARED', shipmentId: 'ELAB000001' }),
    mk({ orderId: 'b1', facility: 'Lab B', testName: 'TEST SHARED', shipmentId: 'ELAB000001' }),
    mk({ orderId: 'z', facility: null, testName: 'TEST SHARED', shipmentId: 'ELAB000009' }), // at A and B → never guessed
  ];
  // Placeholder one-row catalogue. Neither lab has a vendor alias, so the send-out
  // credits each by TEST NAME (contract [B] byTestName): the path a re-inferred 'z'
  // would take into Lab A's row. A blank facility itself is always `unmapped`.
  const master = [{ vendor: 'Vendor Q -Orig-', country: 'Country Q', reflab: 'RefLab Q', item: 'TEST SHARED' }];
  const state = { parsed: { orders: rows }, sendoutMaster: master, reportDate: '2026-09-29' };
  const store = { settings: { tatLookup: TAT_LOOKUP } };
  const kpiLab = (kpi, lab) => (kpi.byLab.find((l) => l.lab === lab) || { total: 0 }).total;
  const unattributed = (kpi) => kpi.byLab.filter((l) => l.lab !== 'Lab A' && l.lab !== 'Lab B')
    .reduce((n, l) => n + l.total, 0);
  const sendoutLab = (so, lab) => (so.byLab.find((l) => l.lab === lab) || { orders: 0 }).orders;

  // Baseline: the FULL report leaves 'z' unattributed on both surfaces.
  const full = buildOrderFigures(state, store, undefined, compute);
  assert.equal(kpiLab(full.kpi, 'Lab A'), 2);
  assert.equal(unattributed(full.kpi), 1);
  assert.deepEqual(full.sendout.unmapped.map((o) => o.orderId), ['z']);
  assert.equal(sendoutLab(full.sendout, 'Lab A'), 2);

  const scoped = buildOrderFigures(state, store, { shipments: ['ELAB000009'] }, compute);
  // applyScope already did its part: 'z' reaches the builder blank.
  assert.deepEqual(scoped.scopedRows.map((r) => [r.orderId, r.facility]), [['a1', 'Lab A'], ['z', null]]);
  assert.equal(kpiLab(scoped.kpi, 'Lab A'), 1, 'compliance: z must not be credited to Lab A');
  assert.equal(unattributed(scoped.kpi), 1, 'compliance: z stays counted, unattributed');
  assert.deepEqual(scoped.sendout.unmapped.map((o) => o.orderId), ['z'], 'send-out: z must stay unmapped');
  assert.equal(sendoutLab(scoped.sendout, 'Lab A'), 1, 'send-out: z must not be credited to Lab A');
});

test('shipment filter: normShipmentId on both sides; AND-combined with labs', () => {
  const rows = [
    mk({ orderId: '1', facility: 'Lab A', shipmentId: 'elab000001 ' }),
    mk({ orderId: '2', facility: 'Lab B', shipmentId: 'ELAB000001' }),
    mk({ orderId: '3', facility: 'Lab A', shipmentId: 'ELAB000002' }),
    mk({ orderId: '4', facility: 'Lab A', shipmentId: null }), // no shipment → never selected
  ];
  assert.deepEqual(applyScope(rows, { shipments: ['ELAB000001'] }).map((r) => r.orderId), ['1', '2']);
  assert.deepEqual(applyScope(rows, { shipments: ['ELAB000001'], labs: ['Lab A'] }).map((r) => r.orderId), ['1']);
  assert.deepEqual(applyScope(rows, { shipments: 'elab000002' }).map((r) => r.orderId), ['3']);
});

// =============================================================================
// 4. Date range + as-of time-shift
// =============================================================================

test('range: the user\'s example — received 22 Sep + resulted 24 Sep, to = 23 Sep ⇒ received, NOT resulted', () => {
  const row = mk({
    orderDate: '2026-09-11 00:00:00', collected: '2026-09-11 09:00:00', dispatched: '2026-09-20 10:00:00',
    received: '2026-09-22 10:00:00', resulted: '2026-09-24 09:00:00', rawStatus: 'Result Approved',
  });
  const [out] = applyScope([row], { from: '2026-09-11', to: '2026-09-23' });
  assert.equal(out.received, '2026-09-22 10:00:00'); // 22 ≤ 23 → kept verbatim
  assert.equal(out.resulted, null);                  // 24 > 23 → had not happened yet
  assert.equal(out.dispatched, '2026-09-20 10:00:00');
  assert.equal(out.rawStatus, 'Result Approved');     // only the rejected literal is ever rewritten
  // And the engine reads it as received-awaiting-result on 23 Sep, not completed.
  const n = engineNumbers([out], '2026-09-23');
  assert.equal(n.received, 1);
  assert.equal(n.awaitingResults, 1);
  assert.equal(n.completed, 0);
});

test('range: orders before \'from\' or after \'to\' are dropped; day-granular at both ends; no order date ⇒ dropped', () => {
  const rows = [
    mk({ orderId: 'before', orderDate: '2026-09-10 23:59:59' }),
    mk({ orderId: 'first', orderDate: '2026-09-11 00:00:00' }),
    mk({ orderId: 'last', orderDate: '2026-09-23 23:59:59' }), // same DAY as 'to' → in
    mk({ orderId: 'after', orderDate: '2026-09-24' }),
    mk({ orderId: 'none', orderDate: null }),
    mk({ orderId: 'junk', orderDate: 'n/a' }),
  ];
  assert.deepEqual(
    applyScope(rows, { from: '2026-09-11', to: '2026-09-23' }).map((r) => r.orderId),
    ['first', 'last'],
  );
});

test('range: every milestone after \'to\' is blanked; ON \'to\' (any hour) it happened', () => {
  const row = mk({
    orderDate: '2026-09-20', collected: '2026-09-23 23:59:00', // on 'to' → kept
    dispatched: '2026-09-24 00:01:00', received: '2026-09-25', resulted: '2026-09-30', // all after → null
  });
  const [out] = applyScope([row], { from: '2026-09-20', to: '2026-09-23' });
  assert.deepEqual(
    [out.collected, out.dispatched, out.received, out.resulted],
    ['2026-09-23 23:59:00', null, null, null],
  );
});

test('range: a rejection dated after \'to\' is not a rejection yet; on/before \'to\' it stays rejected', () => {
  const R = { from: '2026-09-11', to: '2026-09-23' };
  const rows = [
    // (a) no result date → dated by the LAST milestone reached = received 25 Sep > 23 → not yet rejected.
    //     Must be dated off the ORIGINAL received: after the shift only dispatched (20 Sep) is left,
    //     which would wrongly date the rejection before the sample had even arrived.
    mk({ orderId: 'a', rawStatus: 'Result Rejected', dispatched: '2026-09-20', received: '2026-09-25' }),
    // (b) received 22 Sep ≤ 23 → rejected by 'to'.
    mk({ orderId: 'b', rawStatus: 'Result Rejected', dispatched: '2026-09-20', received: '2026-09-22' }),
    // (c) a result date is the rejection's date when present: 24 Sep > 23 → not yet rejected,
    //     even though it was received (20 Sep) inside the range.
    mk({ orderId: 'c', rawStatus: 'Result Rejected', received: '2026-09-20', resulted: '2026-09-24' }),
    // (d) nothing but an order date (15 Sep ≤ 23) → dated by the order day → rejected.
    mk({ orderId: 'd', rawStatus: 'Result Rejected' }),
    // (e) cancelled has no timestamp: stays cancelled even though its receipt is post-'to'.
    mk({ orderId: 'e', rawStatus: 'Order Cancelled', received: '2026-09-25' }),
  ];
  const out = Object.fromEntries(applyScope(rows, R).map((r) => [r.orderId, r]));
  assert.equal(out.a.rawStatus, 'In Progress');
  assert.equal(out.a.received, null);
  assert.equal(out.a.dispatched, '2026-09-20');
  assert.equal(out.b.rawStatus, 'Result Rejected');
  assert.equal(out.c.rawStatus, 'In Progress');
  assert.deepEqual([out.c.received, out.c.resulted], ['2026-09-20', null]);
  assert.equal(out.d.rawStatus, 'Result Rejected');
  assert.equal(out.e.rawStatus, 'Order Cancelled');
  assert.equal(out.e.received, null);
  // Engine view on 23 Sep: a → in transit, b → completed+rejected, c → awaiting result,
  // d → completed+rejected, e → cancelled (out of every number).
  const n = engineNumbers(Object.values(out), R.to);
  assert.equal(n.total, 4);
  assert.equal(n.rejected, 2);
  assert.equal(n.completed, 2);
  assert.equal(n.shippedNotReceived, 1);
  assert.equal(n.awaitingResults, 1);
});

test('applyScope never mutates its input, and a scoped result holds NEW row objects', () => {
  const rows = [
    mk({ orderId: '1', facility: null, testName: 'T1', received: '2026-09-25', rawStatus: 'Result Rejected' }),
    mk({ orderId: '2', facility: 'Lab A', testName: 'T1', resulted: '2026-09-30' }),
    mk({ orderId: '3', facility: 'Lab B', testName: 'T2', shipmentId: 'elab000001' }),
  ];
  const before = structuredClone(rows);
  for (const sc of [
    { from: '2026-09-11', to: '2026-09-23' },
    { labs: ['Lab A'] },
    { shipments: ['ELAB000001'] },
    { labs: ['Lab A', 'Lab B'], shipments: ['ELAB000001'], from: '2026-09-01', to: '2026-09-20' },
  ]) {
    const out = applyScope(rows, sc);
    assert.notEqual(out, rows);
    for (const r of out) assert.ok(!rows.includes(r), 'a scoped row must be a copy, never a shared object');
  }
  assert.deepEqual(rows, before);
});

test('UNSCOPED: a shallow copy of the SAME row objects — no inference, no copying (byte-identical path)', () => {
  const rows = [mk({ facility: 'Lab A', testName: 'T1' }), mk({ facility: null, testName: 'T1' })];
  for (const sc of [undefined, EMPTY_SCOPE, {}, { labs: [] }, { from: '2026-09-11' }, { from: '2026-09-23', to: '2026-09-11' }]) {
    const out = applyScope(rows, sc);
    assert.notEqual(out, rows, 'a new array, so a caller may push/sort it freely');
    assert.equal(out.length, rows.length);
    out.forEach((r, i) => assert.equal(r, rows[i]));
    assert.equal(out[1].facility, null, 'unscoped rows are handed to the engine exactly as they came');
  }
  assert.deepEqual(applyScope(undefined, { labs: ['Lab A'] }), []);
});

// =============================================================================
// 5. Shipment details
// =============================================================================

test('shipmentDetails: buckets, rejected ⊂ completed, earliest dispatch / latest receipt, status', () => {
  const rows = [
    // S1 — three lines, all finished: two resulted, one rejected with no result date.
    mk({ shipmentId: 'ELAB000001', orderId: 'O1', facility: 'Lab B', dispatched: '2026-09-12 08:00:00', received: '2026-09-14', resulted: '2026-09-17' }),
    mk({ shipmentId: 'elab000001', orderId: 'O1', facility: 'Lab A', dispatched: '2026-09-11 16:00:00', received: '2026-09-16 09:00:00', rawStatus: 'Result Rejected' }),
    mk({ shipmentId: 'ELAB000001', orderId: 'O2', facility: 'Lab A', dispatched: '2026-09-13', received: '2026-09-15', resulted: '2026-09-18' }),
    // S2 — one line in each live bucket + one cancelled → mixed.
    mk({ shipmentId: 'ELAB000002', orderId: 'O3' }),                                                  // notShipped
    mk({ shipmentId: 'ELAB000002', orderId: 'O3', dispatched: '2026-09-15' }),                       // inTransit
    mk({ shipmentId: 'ELAB000002', orderId: 'O4', dispatched: '2026-09-15', received: '2026-09-16' }), // awaitingResult
    mk({ shipmentId: 'ELAB000002', orderId: 'O5', rawStatus: 'Order Cancelled', resulted: '2026-09-18' }), // cancelled wins over a result
    // S3 — everything cancelled.
    mk({ shipmentId: 'ELAB000003', orderId: 'O6', rawStatus: 'Order Cancelled' }),
    // S5 — dispatched, nothing received yet.
    mk({ shipmentId: 'ELAB000005', orderId: 'O7', dispatched: '2026-09-20' }),
    mk({ shipmentId: 'ELAB000005', orderId: 'O8', dispatched: '2026-09-21' }),
    // a shipment nobody asked for
    mk({ shipmentId: 'ELAB000099', orderId: 'O9' }),
  ];
  // Requested order: S3, S4 (no rows → omitted), S1, S2, s1 (duplicate), S5.
  const out = shipmentDetails(rows, ['elab000003', 'ELAB000004', 'ELAB000001', 'ELAB000002', 'elab000001', 'ELAB000005']);
  assert.deepEqual(out.map((s) => s.id), ['ELAB000003', 'ELAB000001', 'ELAB000002', 'ELAB000005']);
  const by = Object.fromEntries(out.map((s) => [s.id, s]));

  // S1: labs sorted; 3 lines over 2 distinct orders (O1 twice); earliest dispatch is the
  // 11 Sep line (not the first row's 12 Sep); latest receipt is 16 Sep (not the last row's 15).
  // completed 3 = 2 resulted + 1 rejected; rejected 1 is a SUBSET, not an extra bucket.
  assert.deepEqual(by.ELAB000001, {
    id: 'ELAB000001', labs: ['Lab A', 'Lab B'], lines: 3, orders: 2,
    dispatched: '2026-09-11', received: '2026-09-16',
    counts: { notShipped: 0, inTransit: 0, awaitingResult: 0, completed: 3, rejected: 1, cancelled: 0 },
    status: 'completed',
  });
  // S2: one line in four different buckets → mixed. dispatched = 15 Sep, received = 16 Sep.
  assert.deepEqual(by.ELAB000002.counts, { notShipped: 1, inTransit: 1, awaitingResult: 1, completed: 0, rejected: 0, cancelled: 1 });
  assert.equal(by.ELAB000002.status, 'mixed');
  assert.deepEqual([by.ELAB000002.lines, by.ELAB000002.orders], [4, 3]);
  assert.deepEqual([by.ELAB000002.dispatched, by.ELAB000002.received], ['2026-09-15', '2026-09-16']);
  // S3: only cancelled → cancelled; no dates.
  assert.equal(by.ELAB000003.status, 'cancelled');
  assert.deepEqual([by.ELAB000003.dispatched, by.ELAB000003.received], [null, null]);
  // S5: two in-transit lines → inTransit (a single non-zero bucket, even with 2 lines).
  assert.equal(by.ELAB000005.status, 'inTransit');
  assert.equal(by.ELAB000005.counts.inTransit, 2);
  assert.equal(by.ELAB000005.dispatched, '2026-09-20');

  assert.deepEqual(shipmentDetails(rows, []), []);
  assert.deepEqual(shipmentDetails(undefined, ['ELAB000001']), []);
});

test('shipmentDetails on SCOPED rows describes the shipment as of \'to\'; ids filtered out by other scopes are omitted', () => {
  const rows = [
    mk({ shipmentId: 'ELAB000001', orderDate: '2026-09-15', facility: 'Lab A', dispatched: '2026-09-20', received: '2026-09-24', resulted: '2026-09-26' }),
    mk({ shipmentId: 'ELAB000002', orderDate: '2026-09-15', facility: 'Lab B', dispatched: '2026-09-20' }),
  ];
  const ids = ['ELAB000001', 'ELAB000002'];
  const scoped = applyScope(rows, { labs: ['Lab A'], shipments: ids, from: '2026-09-11', to: '2026-09-23' });
  const out = shipmentDetails(scoped, ids);
  // S2 is Lab B → gone from the scoped rows → omitted. S1 today is completed, but on 23 Sep
  // it had only been dispatched (received 24 > 23) → in transit, no receipt date.
  assert.deepEqual(out.map((s) => [s.id, s.status, s.received]), [['ELAB000001', 'inTransit', null]]);
});

// =============================================================================
// 6. THE PROOF — engine(applyScope(rows, range), asOf=to) === computeNumbersAsOf(cohort, to)
// =============================================================================

// Ranges inside the golden fixture's order dates (2026-04-23 .. 2026-07-08), chosen so
// every as-of rule is exercised somewhere:
//   05-18..05-19  14 rejected rows ordered here are received 05-20 — AFTER 'to' — so all 14
//                 must stop being rejected/completed (the ORIGINAL-fields dating rule).
//   05-01..05-31  the same 14 rejections now dated ≤ 'to' → rejected 14; late rows present.
//   06-01..06-18  the 06-17 rejection is received 06-21 → not yet rejected.
//   06-15..06-30  results and receipts straddle 'to'.
//   07-01..07-08  a range whose 'to' is past its rows' last events (the shift is a no-op).
//   04-23..07-08  the whole order span, ending one day before the snapshot's own date.
//   06-10..06-10  a single day.
const RANGES = [
  ['2026-05-18', '2026-05-19'],
  ['2026-05-01', '2026-05-31'],
  ['2026-06-01', '2026-06-18'],
  ['2026-06-15', '2026-06-30'],
  ['2026-07-01', '2026-07-08'],
  ['2026-04-23', '2026-07-08'],
  ['2026-06-10', '2026-06-10'],
];
const cohortOf = (rows, from, to) => rows.filter((r) => orderDay(r) >= from && orderDay(r) <= to);

for (const [from, to] of RANGES) {
  test(`PROOF ${from}..${to}: engine on applyScope rows @to === computeNumbersAsOf(cohort, to), all 10 keys`, () => {
    const cohort = cohortOf(GOLDEN_ORDERS, from, to);
    assert.ok(cohort.length > 0, 'range must hold golden orders');
    const scoped = applyScope(GOLDEN_ORDERS, { from, to });
    assert.equal(scoped.length, cohort.length, 'the range keeps exactly the order-date cohort');
    const eng = engineNumbers(scoped, to);
    const { numbers } = computeNumbersAsOf({ rows: cohort, tatTests: TAT_LOOKUP, asOfIso: to });
    for (const k of NUMBER_KEYS) {
      assert.equal(eng[k], numbers[k], `key ${k}: engine(scoped) ${eng[k]} !== asof(cohort) ${numbers[k]}`);
    }
  });
}

test('PROOF is not vacuous: the time-shift changes the numbers, rejected included', () => {
  // Without the shift (engine on the raw cohort) the numbers would read TODAY's state of
  // those orders. For 05-18..05-19 that is 14 rejected; as of 19 May none was yet — they
  // were received on 20 May. Hand-derived from the fixture: 14 rejected rows ordered
  // 18/19 May, all received 2026-05-20, none with a result date.
  const [from, to] = ['2026-05-18', '2026-05-19'];
  const cohort = cohortOf(GOLDEN_ORDERS, from, to);
  const naive = engineNumbers(cohort, to);
  const shifted = engineNumbers(applyScope(GOLDEN_ORDERS, { from, to }), to);
  assert.equal(naive.rejected, 14);
  assert.equal(shifted.rejected, 0);
  assert.ok(shifted.received < naive.received);
  assert.ok(shifted.completed < naive.completed);
  // And across all ranges, at least one late-no-result count is non-zero, so the
  // due-date branch of the proof is exercised too.
  assert.ok(RANGES.some(([f, t]) => engineNumbers(applyScope(GOLDEN_ORDERS, { from: f, to: t }), t).lateNoResult > 0));
});

test('PROOF with filters AND-combined: lab + range === computeNumbersAsOf(lab ∩ cohort, to)', () => {
  // The lab filter narrows the cohort; the time-shift must commute with it. Labs are
  // read off the fixture (never typed into source).
  const labs = labOptions(GOLDEN_ORDERS).map((o) => o.lab);
  assert.ok(labs.length >= 2);
  for (const lab of labs.slice(0, 2)) {
    for (const [from, to] of [['2026-05-01', '2026-05-31'], ['2026-06-01', '2026-06-18']]) {
      const cohort = cohortOf(GOLDEN_ORDERS, from, to).filter((r) => normFacility(r.facility) === lab);
      const eng = engineNumbers(applyScope(GOLDEN_ORDERS, { labs: [lab], from, to }), to);
      const { numbers } = computeNumbersAsOf({ rows: cohort, tatTests: TAT_LOOKUP, asOfIso: to });
      assert.deepEqual(eng, numbers, `lab #${labs.indexOf(lab)} ${from}..${to}`);
    }
  }
});

test('golden: labOptions sums to the non-cancelled lines; a lab filter keeps that lab\'s lines (cancelled too)', () => {
  const opts = labOptions(GOLDEN_ORDERS);
  const nonCancelled = GOLDEN_ORDERS.filter((r) => r.rawStatus !== 'Order Cancelled').length;
  // The golden fixture has no blank facility, so every non-cancelled line lands on a lab.
  assert.equal(opts.reduce((s, o) => s + o.count, 0), nonCancelled);
  for (let i = 1; i < opts.length; i++) assert.ok(opts[i - 1].count >= opts[i].count, 'busiest first');
  const top = opts[0].lab;
  const scoped = applyScope(GOLDEN_ORDERS, { labs: [top] });
  assert.equal(scoped.length, GOLDEN_ORDERS.filter((r) => normFacility(r.facility) === top).length);
  assert.equal(scoped.filter((r) => r.rawStatus !== 'Order Cancelled').length, opts[0].count);
  // A lab-only scope does not time-shift: engine numbers equal the engine on the plain subset.
  const plain = GOLDEN_ORDERS.filter((r) => normFacility(r.facility) === top);
  assert.deepEqual(engineNumbers(scoped, '2026-07-09'), engineNumbers(plain, '2026-07-09'));
});
