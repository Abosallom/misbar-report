// test/csv-filter.test.mjs — `node --test`
// model/csv-filter.js: the optional «تنزيل CSV مُصفّى» tool — choose labs and order
// stages, download the ORIGINAL uploaded rows (every column) for the matching orders.
//
// WHAT MUST HOLD, and why each matters:
//   • every line sits in exactly ONE stage (status first, then the LAST milestone), so
//     two ticks can never export one row twice and the counts partition the file;
//   • a ladder selection is one unbroken run — canToggle can never build a gap (proved
//     over all 32 subsets AND by reachability from the empty selection), and
//     filterOrders throws on one;
//   • labs are matched on the FULL-set facility inference, yet the ORIGINAL objects
//     come back (the exported record is the file's own, blank facility and all);
//   • the file ROUND-TRIPS: Papa.parse of the output gives back exactly the selected
//     original records — commas, quotes, newlines, CRLF inside a value, edge spaces,
//     leading zeros, Arabic and formula-looking text all untouched;
//   • a raw that does not belong to the orders is REFUSED, never exported.
//
// EVERY ROW HERE IS SYNTHETIC — obviously fake names ('Test Patient A', 'مريض تجريبي ١'),
// national ids '00000000NN', invented labs/tests. test/samples/ holds real patient data
// and is never read by this suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  LADDER, STATUS_STAGES, stageOf, isContiguous, canToggle, stageCounts, labCounts,
  filterOrders, buildFilteredCsv, filteredFileName,
} from '../src/model/csv-filter.js';
import { labOptions } from '../src/model/scope.js';
import { normFacility } from '../src/contracts.js';

const require = createRequire(import.meta.url);
const Papa = require('../vendor/papaparse.min.js');

const BOM = '\uFEFF';
const C = '2026-09-01 09:00:00'; // collected
const D = '2026-09-02 10:00:00'; // dispatched (shipped)
const R = '2026-09-03 11:00:00'; // received
const S = '2026-09-05 12:00:00'; // resulted
const OD = '2026-09-01 08:00:00'; // order date

/** A synthetic OrderRow; only the fields csv-filter.js reads. */
const mk = (o = {}) => ({
  orderDate: '2026-09-01', facility: 'Lab A', orderId: 'O1', lineNo: 0, testName: 'TEST ONE',
  collected: null, dispatched: null, received: null, resulted: null,
  rawStatus: 'In Progress', ...o,
});

// =============================================================================
// THE SYNTHETIC UPLOAD — a KAMC-shaped CSV with patient columns, written BY HAND
// (not by Papa) so the round-trip compares Papa against an independent input.
// Index in res.data (= lineNo) and the hand-derived stage of every line:
//   0  O-001 Lab A  no dates                       → notCollected   MRN '007'
//   1  O-002 Lab A  collected                      → notShipped     Arabic name, comma note
//   2  O-003 Lab B  collected+dispatched           → notReceived    "quoted" name, \n note
//   3  O-004 Lab B  …+received                     → notResulted    ' 0099 ' MRN, \r\n note
//      (an empty line — skipped by skipEmptyLines 'greedy', so NOT an index)
//   4  O-005 Lab A  all four dates                 → resulted       note '=1+2'
//   5  O-006 Lab B  'Result Rejected' + dates      → rejected       Arabic note with commas
//   6  (stray footer, no Order ID — not an order, so lineNo 6 is absent from the orders)
//   7  O-007 Lab A  'Order Cancelled' + dates      → cancelled
//   8  O-008 blank  TEST ONE (only ever Lab A)     → notCollected   inferred Lab A
//   9  O-009 blank  TEST SHARED (Lab A AND Lab B)  → notReceived    dispatched w/o collected; stays blank
//  10  O-010 Lab A  resulted only                  → resulted       anomaly: no received
//  11  O-011 Lab B  collected+dispatched+received  → notResulted
//  12  O-012 'Lab  C ' received only              → notResulted    normFacility → 'Lab C'
// =============================================================================

const HEADER = [
  'Order ID', 'Patient Name', 'National ID', 'MRN', 'Order date time', 'Performing facility name',
  'Order Status', 'Specimen collected date time', 'Dispatch date time', 'Received date time',
  'Result report date time', 'Test name', 'Notes',
];

const CSV_TEXT = [
  HEADER.join(','),
  `O-001,Test Patient A,0000000001,007,${OD},Lab A,Order Confirmed,,,,,TEST ONE,plain`,
  `O-002,مريض تجريبي ١,0000000002,0042,${OD},Lab A,In Progress,${C},,,,TEST ONE,"comma, inside"`,
  `O-003,"Test ""Quoted"" Patient",0000000003,MRN-3,${OD},Lab B,In Progress,${C},${D},,,TEST TWO,"line one\nline two"`,
  `O-004,Test Patient D,0000000004," 0099 ",${OD},Lab B,In Progress,${C},${D},${R},,TEST TWO,"crlf\r\ninside"`,
  '',
  `O-005,Test Patient E,0000000005,0005,${OD},Lab A,Resulted,${C},${D},${R},${S},TEST ONE,=1+2`,
  `O-006,Test Patient F,0000000006,0006,${OD},Lab B,Result Rejected,${C},${D},${R},${S},TEST TWO,"سطر عربي، بفاصلة, and a comma"`,
  ',,,,,,,,,,,,stray footer',
  `O-007,Test Patient G,0000000007,0007,${OD},Lab A,Order Cancelled,${C},${D},,,TEST ONE,`,
  `O-008,Test Patient H,0000000008,0008,${OD},,Order Confirmed,,,,,TEST ONE,blank facility`,
  `O-009,Test Patient I,0000000009,0009,${OD},,In Progress,,${D},,,TEST SHARED,dispatched without collected`,
  `O-010,Test Patient J,0000000010,0010,${OD},Lab A,Resulted,,,,${S},TEST SHARED,resulted without received`,
  `O-011,Test Patient K,0000000011,0011,${OD},Lab B,In Progress,${C},${D},${R},,TEST SHARED,`,
  `O-012,Test Patient L,0000000012,0012,${OD},"Lab  C ",In Progress,,,${R},,TEST THREE,received only`,
].join('\r\n') + '\r\n';

/** raw exactly as the pinned contract defines it: Papa's fields + data, csv.js's options. */
function rawOf(text) {
  const res = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
  return { fields: res.meta.fields, records: res.data };
}

/** OrderRows mirroring ingest/csv.js's mapping (lineNo = index into res.data). */
function ordersOf(raw) {
  const clean = (v) => { const s = v == null ? '' : String(v).trim(); return s === '' ? null : s; };
  const out = [];
  raw.records.forEach((r, i) => {
    const orderId = clean(r['Order ID']);
    if (orderId == null) return;
    out.push({
      orderDate: (clean(r['Order date time']) || '').slice(0, 10) || null,
      facility: normFacility(r['Performing facility name']),
      orderId,
      lineNo: i,
      testName: clean(r['Test name']) ?? '',
      collected: clean(r['Specimen collected date time']),
      dispatched: clean(r['Dispatch date time']),
      received: clean(r['Received date time']),
      resulted: clean(r['Result report date time']),
      rawStatus: r['Order Status'] == null ? '' : String(r['Order Status']).trim(),
    });
  });
  return out;
}

const RAW = rawOf(CSV_TEXT);
const ORDERS = ordersOf(RAW);
const ids = (rows) => rows.map((r) => r.orderId);
const byId = (id) => ORDERS.find((o) => o.orderId === id);

/** Parse a filtered file back the way the app ingests a CSV (Papa strips the BOM). */
const parseBack = (text) => Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });

test('fixture sanity: the hand-written CSV parses to what the stage table above says', () => {
  assert.deepEqual(RAW.fields, HEADER);
  assert.equal(RAW.records.length, 13, 'the empty line is skipped, the stray footer is a record');
  assert.equal(ORDERS.length, 12, 'the stray footer has no Order ID, so it is not an order');
  assert.deepEqual(ORDERS.map((o) => o.lineNo), [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]);
  assert.equal(RAW.records[0].MRN, '007');
  assert.equal(RAW.records[1]['Patient Name'], 'مريض تجريبي ١');
  assert.equal(RAW.records[2]['Patient Name'], 'Test "Quoted" Patient');
  assert.equal(RAW.records[2].Notes, 'line one\nline two');
  assert.equal(RAW.records[3].Notes, 'crlf\r\ninside');
  assert.equal(RAW.records[3].MRN, ' 0099 ');
  assert.equal(RAW.records[4].Notes, '=1+2');
  assert.equal(RAW.records[12]['Performing facility name'], 'Lab  C ');
  assert.equal(byId('O-012').facility, 'Lab C');
});

// =============================================================================
// 1. stageOf
// =============================================================================

test('LADDER / STATUS_STAGES: the pinned keys, in pipeline order, frozen', () => {
  assert.deepEqual([...LADDER], ['notCollected', 'notShipped', 'notReceived', 'notResulted', 'resulted']);
  assert.deepEqual([...STATUS_STAGES], ['rejected', 'cancelled']);
  assert.ok(Object.isFrozen(LADDER) && Object.isFrozen(STATUS_STAGES));
});

test('stageOf: one stage per milestone reached, in order', () => {
  assert.equal(stageOf(mk()), 'notCollected');
  assert.equal(stageOf(mk({ collected: C })), 'notShipped');
  assert.equal(stageOf(mk({ collected: C, dispatched: D })), 'notReceived');
  assert.equal(stageOf(mk({ collected: C, dispatched: D, received: R })), 'notResulted');
  assert.equal(stageOf(mk({ collected: C, dispatched: D, received: R, resulted: S })), 'resulted');
});

test('stageOf: the LAST milestone wins in an anomalous row (the procedure is sequential)', () => {
  // A result with no receipt date WAS received — the scan is what is missing.
  assert.equal(stageOf(mk({ resulted: S })), 'resulted');
  assert.equal(stageOf(mk({ collected: C, resulted: S })), 'resulted');
  // A dispatch with no collection date WAS collected.
  assert.equal(stageOf(mk({ dispatched: D })), 'notReceived');
  // A receipt with no dispatch/collection date was shipped.
  assert.equal(stageOf(mk({ received: R })), 'notResulted');
});

test('stageOf: Order Status decides before any date (cancelled, rejected)', () => {
  const allDates = { collected: C, dispatched: D, received: R, resulted: S };
  assert.equal(stageOf(mk({ rawStatus: 'Order Cancelled', ...allDates })), 'cancelled');
  assert.equal(stageOf(mk({ rawStatus: 'Order Cancelled' })), 'cancelled');
  assert.equal(stageOf(mk({ rawStatus: 'Result Rejected', ...allDates })), 'rejected');
  assert.equal(stageOf(mk({ rawStatus: 'Result Rejected', resulted: S })), 'rejected');
  assert.equal(stageOf(mk({ rawStatus: 'Result Rejected' })), 'rejected');
  // Any other status is a live line, read by its dates (the engine's literals).
  assert.equal(stageOf(mk({ rawStatus: 'Resulted' })), 'notCollected');
  assert.equal(stageOf(mk({ rawStatus: 'Order Confirmed', received: R })), 'notResulted');
});

test('stageOf: a date counts only when parseDateTime reads it (the engine\'s presence test)', () => {
  for (const bad of ['', '   ', 'N/A', '11/09/2026', null, undefined]) {
    assert.equal(stageOf(mk({ resulted: bad, received: bad, dispatched: bad, collected: bad })), 'notCollected',
      `unparseable ${JSON.stringify(bad)} must read as absent`);
  }
  assert.equal(stageOf(mk({ resulted: 'pending', received: '2026-09-03' })), 'notResulted');
  assert.equal(stageOf(mk({ collected: '2026-09-01T09:00' })), 'notShipped');
});

test('stageOf: never throws on a non-row', () => {
  for (const v of [null, undefined, 42, 'x']) assert.equal(stageOf(v), 'notCollected');
});

test('stageOf: the synthetic upload matches the hand-derived stage table', () => {
  const expected = {
    'O-001': 'notCollected', 'O-002': 'notShipped', 'O-003': 'notReceived', 'O-004': 'notResulted',
    'O-005': 'resulted', 'O-006': 'rejected', 'O-007': 'cancelled', 'O-008': 'notCollected',
    'O-009': 'notReceived', 'O-010': 'resulted', 'O-011': 'notResulted', 'O-012': 'notResulted',
  };
  assert.deepEqual(Object.fromEntries(ORDERS.map((o) => [o.orderId, stageOf(o)])), expected);
});

// =============================================================================
// 2. isContiguous / canToggle — exhaustive over the 32 subsets of LADDER
// =============================================================================

/** Independent oracle: are the set bits of `mask` one run? (strip trailing zeros; then
 *  a run of ones is m with m & (m+1) === 0). Does not touch the module under test. */
function runOracle(mask) {
  if (mask === 0) return true;
  let m = mask;
  while ((m & 1) === 0) m >>= 1;
  return (m & (m + 1)) === 0;
}
const keysOf = (mask) => LADDER.filter((_, i) => mask & (1 << i));
const MASKS = Array.from({ length: 32 }, (_, m) => m);

test('isContiguous: agrees with the bit oracle on all 32 subsets; exactly 16 are runs', () => {
  let runs = 0;
  for (const m of MASKS) {
    const want = runOracle(m);
    assert.equal(isContiguous(keysOf(m)), want, `subset ${JSON.stringify(keysOf(m))}`);
    // input order, duplicates, status keys and a Set never change the answer
    assert.equal(isContiguous([...keysOf(m)].reverse()), want);
    assert.equal(isContiguous([...keysOf(m), ...keysOf(m), 'rejected', 'cancelled']), want);
    assert.equal(isContiguous(new Set(keysOf(m))), want);
    if (want) runs++;
  }
  // 5 + 4 + 3 + 2 + 1 non-empty runs of a 5-step ladder, plus the empty selection.
  assert.equal(runs, 16);
});

test('isContiguous: hand cases', () => {
  assert.equal(isContiguous([]), true);
  assert.equal(isContiguous(['rejected', 'cancelled']), true);
  assert.equal(isContiguous(['notShipped', 'notResulted']), false);
  assert.equal(isContiguous(['notShipped', 'notReceived', 'notResulted']), true);
  assert.equal(isContiguous(['resulted', 'notResulted']), true);
  assert.equal(isContiguous(['notCollected', 'resulted']), false);
  assert.equal(isContiguous(undefined), true);
});

test('canToggle: from a run, allowed ⇔ the result is a run ⇔ ends / adjacents (all 16 × 5)', () => {
  for (const m of MASKS.filter(runOracle)) {
    const sel = keysOf(m);
    const idx = LADDER.map((_, i) => i).filter((i) => m & (1 << i));
    const lo = idx[0];
    const hi = idx[idx.length - 1];
    LADDER.forEach((key, i) => {
      const after = m ^ (1 << i);
      const got = canToggle(sel, key);
      assert.equal(got, runOracle(after), `${JSON.stringify(sel)} toggle ${key}`);
      // The spec's own wording, derived independently of the oracle:
      let spec;
      if (!idx.length) spec = true;                       // nothing ticked: any stage
      else if (m & (1 << i)) spec = i === lo || i === hi;  // remove: an end (or the sole)
      else spec = i === lo - 1 || i === hi + 1;            // add: right next to an end
      assert.equal(got, spec, `spec rule: ${JSON.stringify(sel)} toggle ${key}`);
    });
  }
});

test('canToggle: from a gapped selection, additions must close the gap, removals always allowed', () => {
  for (const m of MASKS.filter((x) => !runOracle(x))) {
    LADDER.forEach((key, i) => {
      const after = m ^ (1 << i);
      const removing = (m & (1 << i)) !== 0;
      assert.equal(canToggle(keysOf(m), key), removing ? true : runOracle(after),
        `${JSON.stringify(keysOf(m))} toggle ${key}`);
    });
  }
});

test('canToggle: from nothing, allowed moves reach EXACTLY the 16 runs — never a gap', () => {
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const m = queue.shift();
    LADDER.forEach((key, i) => {
      if (!canToggle(keysOf(m), key)) return;
      const next = m ^ (1 << i);
      assert.ok(runOracle(next), `an allowed move built a gap: ${JSON.stringify(keysOf(next))}`);
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    });
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), MASKS.filter(runOracle));
});

test('canToggle: a gapped selection can always be dug out of (no trap)', () => {
  for (const start of MASKS.filter((x) => !runOracle(x))) {
    const seen = new Set([start]);
    const queue = [start];
    let escaped = false;
    while (queue.length && !escaped) {
      const m = queue.shift();
      LADDER.forEach((key, i) => {
        if (!canToggle(keysOf(m), key)) return;
        const next = m ^ (1 << i);
        if (runOracle(next)) escaped = true;
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      });
    }
    assert.ok(escaped, `stuck in ${JSON.stringify(keysOf(start))}`);
  }
});

test('canToggle: status stages always; unknown keys never; status ticks never block the ladder', () => {
  for (const m of MASKS) {
    for (const s of STATUS_STAGES) assert.equal(canToggle(keysOf(m), s), true);
    assert.equal(canToggle(keysOf(m), 'shipped'), false);
    LADDER.forEach((key) => {
      assert.equal(canToggle([...keysOf(m), 'rejected', 'cancelled'], key), canToggle(keysOf(m), key));
    });
  }
  assert.equal(canToggle(undefined, 'notReceived'), true);
  assert.equal(canToggle(new Set(['notShipped', 'notReceived', 'notResulted']), 'notReceived'), false);
  assert.equal(canToggle(['notReceived'], 'notReceived'), true, 'the sole member can be unticked');
});

// =============================================================================
// 3. stageCounts / labCounts
// =============================================================================

test('stageCounts: all labs — the hand count, seven keys in order, sums to every line', () => {
  const c = stageCounts(ORDERS);
  assert.deepEqual(c, {
    notCollected: 2, notShipped: 1, notReceived: 2, notResulted: 3, resulted: 2, rejected: 1, cancelled: 1,
  });
  assert.deepEqual(Object.keys(c), [...LADDER, ...STATUS_STAGES]);
  assert.equal(Object.values(c).reduce((a, b) => a + b, 0), ORDERS.length);
  assert.deepEqual(stageCounts(ORDERS, []), c, '[] = «كل المختبرات»');
});

test('stageCounts: per lab, inferred blanks included, partitions the lab\'s lines', () => {
  assert.deepEqual(stageCounts(ORDERS, ['Lab A']), {
    notCollected: 2, notShipped: 1, notReceived: 0, notResulted: 0, resulted: 2, rejected: 0, cancelled: 1,
  });
  assert.deepEqual(stageCounts(ORDERS, ['Lab B']), {
    notCollected: 0, notShipped: 0, notReceived: 1, notResulted: 2, resulted: 0, rejected: 1, cancelled: 0,
  });
  const ac = stageCounts(ORDERS, ['Lab A', ' Lab  C ']);
  assert.equal(ac.notResulted, 1);
  assert.equal(Object.values(ac).reduce((a, b) => a + b, 0), 7);
  // every lab's partition sums to that lab's labCounts line count
  for (const { lab, count } of labCounts(ORDERS)) {
    assert.equal(Object.values(stageCounts(ORDERS, [lab])).reduce((a, b) => a + b, 0), count, lab);
  }
  assert.deepEqual(Object.values(stageCounts([], ['Lab A'])), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Object.values(stageCounts(undefined)), [0, 0, 0, 0, 0, 0, 0]);
});

test('labCounts: INCLUDES cancelled lines; inferred blanks counted; ambiguous blanks omitted', () => {
  assert.deepEqual(labCounts(ORDERS), [
    { lab: 'Lab A', count: 6 }, // 001 002 005 007(cancelled) 008(inferred) 010
    { lab: 'Lab B', count: 4 }, // 003 004 006 011
    { lab: 'Lab C', count: 1 }, // 012
  ]);
  // Same semantics as scope.js labOptions, plus each lab's cancelled lines.
  const cancelledByLab = { 'Lab A': 1, 'Lab B': 0, 'Lab C': 0 };
  const opts = Object.fromEntries(labOptions(ORDERS).map((o) => [o.lab, o.count]));
  for (const { lab, count } of labCounts(ORDERS)) assert.equal(count, opts[lab] + cancelledByLab[lab], lab);
});

test('labCounts: busiest first, then code-unit name order; garbage-tolerant', () => {
  const rows = [
    mk({ facility: 'Lab Z' }), mk({ facility: 'Lab B' }), mk({ facility: 'Lab Z' }), mk({ facility: 'Lab A' }),
    null, mk({ facility: 'Lab Z', rawStatus: 'Order Cancelled' }),
  ];
  assert.deepEqual(labCounts(rows), [
    { lab: 'Lab Z', count: 3 }, { lab: 'Lab A', count: 1 }, { lab: 'Lab B', count: 1 },
  ]);
  assert.deepEqual(labCounts(undefined), []);
});

// =============================================================================
// 4. filterOrders
// =============================================================================

test('filterOrders: no options → every order, the SAME objects, lineNo order', () => {
  const all = filterOrders(ORDERS);
  assert.equal(all.length, ORDERS.length);
  all.forEach((r, i) => assert.equal(r, ORDERS[i], 'original object, not a copy'));
  assert.deepEqual(ids(filterOrders(ORDERS, {})), ids(ORDERS));
  assert.deepEqual(ids(filterOrders(ORDERS, null)), ids(ORDERS));
  assert.deepEqual(ids(filterOrders(ORDERS, { labs: [], stages: [] })), ids(ORDERS));
  assert.deepEqual(ids(filterOrders(ORDERS, { stages: [...LADDER, ...STATUS_STAGES] })), ids(ORDERS));
});

test('filterOrders: by labs — normalised names; an inferable blank counted under its lab, returned untouched', () => {
  const a = filterOrders(ORDERS, { labs: [' Lab  A '] });
  assert.deepEqual(ids(a), ['O-001', 'O-002', 'O-005', 'O-007', 'O-008', 'O-010']);
  const o8 = a.find((r) => r.orderId === 'O-008');
  assert.equal(o8, byId('O-008'), 'the original object');
  assert.equal(o8.facility, '', 'its own facility is still blank — only the match used the inference');
  assert.deepEqual(ids(filterOrders(ORDERS, { labs: ['Lab B'] })), ['O-003', 'O-004', 'O-006', 'O-011']);
  assert.deepEqual(ids(filterOrders(ORDERS, { labs: ['Lab C'] })), ['O-012']);
  assert.deepEqual(ids(filterOrders(ORDERS, { labs: ['Lab B', 'Lab C'] })), ['O-003', 'O-004', 'O-006', 'O-011', 'O-012']);
  assert.deepEqual(ids(filterOrders(ORDERS, { labs: ['Lab Z'] })), []);
  // The ambiguous blank (O-009) belongs to no lab — exported only under all labs.
  for (const lab of ['Lab A', 'Lab B', 'Lab C']) {
    assert.ok(!ids(filterOrders(ORDERS, { labs: [lab] })).includes('O-009'), lab);
  }
  assert.ok(ids(filterOrders(ORDERS)).includes('O-009'));
});

test('filterOrders: by stages, and combined with labs', () => {
  assert.deepEqual(ids(filterOrders(ORDERS, { stages: ['notReceived', 'notResulted'] })),
    ['O-003', 'O-004', 'O-009', 'O-011', 'O-012']);
  assert.deepEqual(ids(filterOrders(ORDERS, { labs: ['Lab B'], stages: ['notReceived', 'notResulted'] })),
    ['O-003', 'O-004', 'O-011']);
  assert.deepEqual(ids(filterOrders(ORDERS, { labs: ['Lab A'], stages: ['notCollected'] })), ['O-001', 'O-008']);
  assert.deepEqual(ids(filterOrders(ORDERS, { stages: ['cancelled'] })), ['O-007']);
  assert.deepEqual(ids(filterOrders(ORDERS, { stages: ['rejected', 'cancelled'] })), ['O-006', 'O-007']);
  assert.deepEqual(ids(filterOrders(ORDERS, { stages: ['resulted', 'rejected'] })), ['O-005', 'O-006', 'O-010']);
  assert.deepEqual(ids(filterOrders(ORDERS, { labs: ['Lab A'], stages: ['notReceived'] })), []);
  // filter size always equals the matching stageCounts cell(s)
  for (const lab of ['Lab A', 'Lab B']) {
    const c = stageCounts(ORDERS, [lab]);
    for (const k of [...LADDER, ...STATUS_STAGES]) {
      assert.equal(filterOrders(ORDERS, { labs: [lab], stages: [k] }).length, c[k], `${lab}/${k}`);
    }
  }
});

test('filterOrders: output is in lineNo order whatever the input order; input never mutated', () => {
  const before = JSON.stringify(ORDERS);
  const shuffled = [ORDERS[7], ORDERS[0], ORDERS[11], ORDERS[3], ORDERS[5], ORDERS[1], ORDERS[9],
    ORDERS[2], ORDERS[10], ORDERS[4], ORDERS[8], ORDERS[6]];
  const out = filterOrders(shuffled);
  assert.deepEqual(out.map((r) => r.lineNo), [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]);
  out.forEach((r) => assert.ok(ORDERS.includes(r)));
  assert.deepEqual(ids(filterOrders(shuffled, { labs: ['Lab B'], stages: ['notReceived', 'notResulted'] })),
    ['O-003', 'O-004', 'O-011']);
  assert.equal(JSON.stringify(ORDERS), before);
  assert.equal(shuffled[0], ORDERS[7], 'the caller\'s array is not re-ordered in place');
});

test('filterOrders: throws on a ladder gap and on an unknown stage key', () => {
  const gaps = [
    ['notShipped', 'notResulted'], ['notCollected', 'resulted'], ['notCollected', 'notReceived', 'rejected'],
  ];
  for (const stages of gaps) assert.throws(() => filterOrders(ORDERS, { stages }), Error, JSON.stringify(stages));
  assert.throws(() => filterOrders(ORDERS, { stages: ['shipped'] }), Error);
  assert.throws(() => filterOrders(ORDERS, { stages: ['notReceived', 'all'] }), Error);
});

test('filterOrders: blank facilities are inferred on the FULL set, before the stage filter', () => {
  // LOSES-an-attribution case: the blank row's lab is evident only from a row in ANOTHER stage.
  const lose = [
    mk({ orderId: 'X1', lineNo: 0, facility: '', testName: 'TEST X' }),                   // notCollected
    mk({ orderId: 'X2', lineNo: 1, facility: 'Lab B', testName: 'TEST X', resulted: S }), // resulted
  ];
  assert.deepEqual(ids(filterOrders(lose, { labs: ['Lab B'], stages: ['notCollected'] })), ['X1']);
  assert.equal(stageCounts(lose, ['Lab B']).notCollected, 1);
  // INVENTS-an-attribution case: TEST S runs at two labs, so the blank stays unattributed —
  // even though, among the notReceived rows alone, only Lab A has TEST S.
  const invent = [
    mk({ orderId: 'Y1', lineNo: 0, facility: '', testName: 'TEST S', dispatched: D }),          // notReceived
    mk({ orderId: 'Y2', lineNo: 1, facility: 'Lab A', testName: 'TEST S', dispatched: D }),     // notReceived
    mk({ orderId: 'Y3', lineNo: 2, facility: 'Lab B', testName: 'TEST S', resulted: S }),       // resulted
  ];
  assert.deepEqual(ids(filterOrders(invent, { labs: ['Lab A'], stages: ['notReceived'] })), ['Y2']);
  assert.equal(stageCounts(invent, ['Lab A']).notReceived, 1);
  assert.deepEqual(ids(filterOrders(invent, { stages: ['notReceived'] })), ['Y1', 'Y2']);
});

test('filterOrders: garbage-tolerant (non-array, null rows, non-string labs)', () => {
  assert.deepEqual(filterOrders(undefined), []);
  assert.deepEqual(ids(filterOrders([null, mk({ orderId: 'Z1' }), 7])), ['Z1']);
  assert.deepEqual(ids(filterOrders([mk({ orderId: 'Z1' })], { labs: [null, 42, ''] })), ['Z1'], 'no usable lab = all labs');
  assert.deepEqual(ids(filterOrders([mk({ orderId: 'Z1' })], { labs: 'Lab A' })), ['Z1'], 'a lone string is one lab');
});

// =============================================================================
// 5. buildFilteredCsv — BOM, header, CRLF, only the selection, exact round-trip
// =============================================================================

/** Strip RFC-4180 quoted sections, so a newline INSIDE a value is not a record break. */
const outsideQuotes = (s) => s.replace(/"(?:[^"]|"")*"/g, '');

test('buildFilteredCsv: BOM, header = raw.fields in order, CRLF, only the selected records', () => {
  const sel = filterOrders(ORDERS, { stages: ['notShipped', 'notReceived', 'notResulted', 'rejected'] });
  assert.deepEqual(ids(sel), ['O-002', 'O-003', 'O-004', 'O-006', 'O-009', 'O-011', 'O-012']);
  const out = buildFilteredCsv(RAW, sel, Papa);
  assert.ok(out.startsWith(BOM), 'BOM first, so Excel opens the Arabic correctly');
  assert.ok(!out.startsWith(BOM + BOM));
  assert.equal(out.slice(1).split('\r\n')[0], HEADER.join(','));
  const bare = outsideQuotes(out);
  assert.ok(!/[^\r]\n/.test(bare) && !/\r(?!\n)/.test(bare), 'every record break is CRLF');
  assert.equal(bare.split('\r\n').length, 1 + sel.length, 'header + one line per selected order');
  const back = parseBack(out);
  assert.deepEqual(back.errors, []);
  assert.equal(back.meta.linebreak, '\r\n');
  assert.deepEqual(back.meta.fields, RAW.fields);
  assert.deepEqual(back.data, sel.map((o) => RAW.records[o.lineNo]));
  assert.deepEqual(back.data.map((r) => r['Order ID']), ['O-002', 'O-003', 'O-004', 'O-006', 'O-009', 'O-011', 'O-012']);
});

test('buildFilteredCsv: ROUND-TRIP keeps every awkward value byte-for-byte', () => {
  const sel = filterOrders(ORDERS, { labs: ['Lab A', 'Lab B'] });
  const back = parseBack(buildFilteredCsv(RAW, sel, Papa));
  assert.deepEqual(back.data, sel.map((o) => RAW.records[o.lineNo]));
  const rec = Object.fromEntries(back.data.map((r) => [r['Order ID'], r]));
  assert.equal(rec['O-001'].MRN, '007', 'leading zeros kept (no numeric typing)');
  assert.equal(rec['O-001']['National ID'], '0000000001');
  assert.equal(rec['O-002']['Patient Name'], 'مريض تجريبي ١');
  assert.equal(rec['O-002'].Notes, 'comma, inside');
  assert.equal(rec['O-003']['Patient Name'], 'Test "Quoted" Patient');
  assert.equal(rec['O-003'].Notes, 'line one\nline two');
  assert.equal(rec['O-004'].Notes, 'crlf\r\ninside');
  assert.equal(rec['O-004'].MRN, ' 0099 ', 'edge spaces kept');
  assert.equal(rec['O-005'].Notes, '=1+2', 'no formula escaping — the value is the user\'s own');
  assert.equal(rec['O-006'].Notes, 'سطر عربي، بفاصلة, and a comma');
  assert.equal(rec['O-007']['Order Status'], 'Order Cancelled');
  assert.equal(rec['O-008']['Performing facility name'], '', 'an inferred lab is NOT written into the file');
  // The whole upload comes back exactly, minus only the stray footer (not an order).
  const full = parseBack(buildFilteredCsv(RAW, filterOrders(ORDERS), Papa));
  assert.deepEqual(full.data, RAW.records.filter((_, i) => i !== 6));
});

test('buildFilteredCsv: the record\'s own key order never leaks; a short record gives \'\'', () => {
  const raw = {
    fields: ['Order ID', 'B', 'A', 'Missing'],
    records: [{ A: '1', 'Order ID': 'X1', B: '2' }, { 'Order ID': 'X2', B: 'b', A: 'a', Missing: 'm' }],
  };
  const orders = [{ orderId: 'X1', lineNo: 0 }, { orderId: 'X2', lineNo: 1 }];
  assert.equal(buildFilteredCsv(raw, orders, Papa), `${BOM}Order ID,B,A,Missing\r\nX1,2,1,\r\nX2,b,a,m`);
  assert.equal(buildFilteredCsv(raw, [orders[1]], Papa), `${BOM}Order ID,B,A,Missing\r\nX2,b,a,m`);
});

test('buildFilteredCsv: an empty selection is the header alone and parses to no rows', () => {
  const out = buildFilteredCsv(RAW, [], Papa);
  assert.ok(out.startsWith(BOM + HEADER.join(',')));
  const back = parseBack(out);
  assert.deepEqual(back.meta.fields, HEADER);
  assert.deepEqual(back.data, []);
  assert.equal(buildFilteredCsv(RAW, undefined, Papa), out);
});

test('buildFilteredCsv: never mutates raw or the orders', () => {
  const rawBefore = JSON.stringify(RAW);
  const ordersBefore = JSON.stringify(ORDERS);
  buildFilteredCsv(RAW, filterOrders(ORDERS, { labs: ['Lab A'] }), Papa);
  assert.equal(JSON.stringify(RAW), rawBefore);
  assert.equal(JSON.stringify(ORDERS), ordersBefore);
});

test('buildFilteredCsv: REFUSES a raw that does not belong to the orders — and the error names no patient value', () => {
  const noLeak = (e) => e instanceof Error && !/Test Patient|مريض|0000000|O-0\d\d/.test(e.message);
  // no raw at all (live pull / snapshot / reset)
  for (const raw of [null, undefined, {}, { fields: HEADER }, { records: [] }]) {
    assert.throws(() => buildFilteredCsv(raw, ORDERS, Papa), noLeak);
  }
  // lineNo pointing nowhere
  assert.throws(() => buildFilteredCsv(RAW, [{ ...byId('O-001'), lineNo: 99 }], Papa), noLeak);
  assert.throws(() => buildFilteredCsv(RAW, [{ ...byId('O-001'), lineNo: null }], Papa), noLeak);
  assert.throws(() => buildFilteredCsv(RAW, [{ ...byId('O-001'), lineNo: 1.5 }], Papa), noLeak);
  // the stray footer is a record but not this order
  assert.throws(() => buildFilteredCsv(RAW, [{ ...byId('O-007'), lineNo: 6 }], Papa), noLeak);
  // a STALE raw: another upload's rows, shifted by one — would export the wrong patients
  const otherRaw = { fields: RAW.fields, records: RAW.records.slice(1) };
  assert.throws(() => buildFilteredCsv(otherRaw, [byId('O-002')], Papa), noLeak);
  // Order ID compared trimmed, as ingest/csv.js derives it
  const spaced = { fields: ['Order ID', 'N'], records: [{ 'Order ID': ' X1 ', N: 'n' }] };
  // (Papa quotes an edge-spaced value, so its spaces survive the round trip.)
  assert.equal(buildFilteredCsv(spaced, [{ orderId: 'X1', lineNo: 0 }], Papa), `${BOM}Order ID,N\r\n" X1 ",n`);
  // without an 'Order ID' column there is nothing to compare: lineNo alone selects
  const noId = { fields: ['N'], records: [{ N: 'only' }] };
  assert.equal(buildFilteredCsv(noId, [{ orderId: 'whatever', lineNo: 0 }], Papa), `${BOM}N\r\nonly`);
});

test('end to end: Lab B, "not received yet" … "not resulted yet" → exactly those patients\' original rows', () => {
  const sel = filterOrders(ORDERS, { labs: ['Lab B'], stages: ['notReceived', 'notResulted'] });
  const back = parseBack(buildFilteredCsv(RAW, sel, Papa));
  assert.deepEqual(back.data.map((r) => [r['Order ID'], r['Patient Name'], r['National ID']]), [
    ['O-003', 'Test "Quoted" Patient', '0000000003'],
    ['O-004', 'Test Patient D', '0000000004'],
    ['O-011', 'Test Patient K', '0000000011'],
  ]);
  // …and the re-uploaded file is a valid input for the same tool again (BOM stripped).
  const again = ordersOf({ fields: back.meta.fields, records: back.data });
  assert.deepEqual(again.map(stageOf), ['notReceived', 'notResulted', 'notResulted']);
});

// =============================================================================
// 6. filteredFileName
// =============================================================================

test('filteredFileName: upload name minus .csv, the mark, DDMMYYYY', () => {
  assert.equal(filteredFileName('KAMC Order details-data-2026-10-05 10_23_40.csv', '2026-10-05'),
    'KAMC Order details-data-2026-10-05 10_23_40 - مُصفّى 05102026.csv');
  assert.equal(filteredFileName('orders.CSV', '2026-09-11'), 'orders - مُصفّى 11092026.csv');
  assert.equal(filteredFileName('orders', '2026-09-11'), 'orders - مُصفّى 11092026.csv');
  assert.equal(filteredFileName('  spaced name.csv  ', '2026-09-11'), 'spaced name - مُصفّى 11092026.csv');
  assert.equal(filteredFileName('ملف الطلبات.csv', '2026-09-11'), 'ملف الطلبات - مُصفّى 11092026.csv');
  assert.equal(filteredFileName('orders.csv', '2026-09-11T10:00:00'), 'orders - مُصفّى 11092026.csv');
});

test('filteredFileName: blank name → the KAMC stem; bad date → no date part', () => {
  for (const blank of ['', '   ', null, undefined, '.csv', ' .CSV ']) {
    assert.equal(filteredFileName(blank, '2026-10-05'), 'KAMC Order details - مُصفّى 05102026.csv', JSON.stringify(blank));
  }
  for (const bad of ['', null, undefined, '05/10/2026', 'today']) {
    assert.equal(filteredFileName('orders.csv', bad), 'orders - مُصفّى.csv', JSON.stringify(bad));
  }
});

test('filteredFileName: filtering a filtered file replaces the mark instead of stacking it', () => {
  assert.equal(filteredFileName('orders - مُصفّى 05102026.csv', '2026-10-06'), 'orders - مُصفّى 06102026.csv');
  assert.equal(filteredFileName('orders - مُصفّى.csv', '2026-10-06'), 'orders - مُصفّى 06102026.csv');
  const once = filteredFileName('orders.csv', '2026-10-05');
  assert.equal(filteredFileName(once, '2026-10-05'), once);
});
