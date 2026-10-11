// test/core-failsafe.test.mjs — run with:  node --test
// DEFENCE IN DEPTH for a hospital WITHOUT a Test Menu (SGH today; any third hospital).
// Callers compute each hospital on its own rows with its own policy; these are the
// guards that hold even when a caller mixes them by mistake:
//   • engine/tat.js resolveTat gives such a row NO TAT — not from the lookup (even when
//     its test name IS in KAMC's table), not from its own 'TAT - Days' cell;
//   • engine/engine.js and engine/asof.js never drop such rows under excludeNoTat;
//   • model/sendout.js puts them in a 'noTestMenu' bucket, never attributed;
//   • and for KAMC / legacy rows every output is exactly what it was.
// SYNTHETIC rows only. Catalogue countries / reference labs are placeholders (public repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTatIndex, resolveTat } from '../src/engine/tat.js';
import { compute } from '../src/engine/engine.js';
import { computeNumbersAsOf } from '../src/engine/asof.js';
import { analyseSendout, FACILITY_TO_VENDOR, FACILITY_DISPLAY } from '../src/model/sendout.js';
import { TAT_LOOKUP } from '../src/seeds/tat-lookup.js';
import { GOLDEN_ORDERS } from './fixtures/golden-orders.js';
import { goldenOpts } from './assertions.js';

const KAMC = { orderingFacilityId: '31763', hospital: 'King Abdul ah Medical City' };
const SGH = { orderingFacilityId: '1037', hospital: 'Saudi German Hospital Alzahraa Branch' };
const OTHER = { orderingFacilityId: '9001', hospital: 'Test Other Hospital' };
/** A test name that IS in KAMC's TAT table (the shared-lab hazard). */
const KAMC_TEST = Object.keys(TAT_LOOKUP)[0];
const KAMC_TAT = TAT_LOOKUP[KAMC_TEST];
const ASOF = '2026-10-08';

/** A received, unresulted synthetic line — 'Late' if it has a TAT that fell due. */
const line = (orderId, hosp, over = {}) => ({
  orderDate: '2026-09-01', facility: 'Test Lab A', orderId, lineNo: Number(orderId),
  loinc: null, testName: KAMC_TEST, collected: '2026-09-01 08:00:00',
  dispatched: '2026-09-01 10:00:00', received: '2026-09-02 09:00:00', resulted: null,
  rawStatus: 'Specimen Courier Received', tatDaysCsv: null, specimenNo: null, shipmentId: null,
  orderingFacilityId: null, performingFacilityId: null, hospital: null, ...hosp, ...over,
});

// ---- engine/tat.js ---------------------------------------------------------------------

test('resolveTat — an SGH row whose test name IS in TAT_LOOKUP gets NO TAT', () => {
  const idx = buildTatIndex(TAT_LOOKUP);
  assert.deepEqual(resolveTat(line('1', KAMC), idx), { tat: KAMC_TAT, matched: true, fromCsv: false });
  assert.deepEqual(resolveTat(line('2', SGH), idx), { tat: null, matched: false, fromCsv: false });
  // SGH identified by name alone, or by id alone — still no menu.
  assert.equal(resolveTat(line('3', { hospital: SGH.hospital }), idx).tat, null);
  assert.equal(resolveTat(line('4', { orderingFacilityId: '1037' }), idx).tat, null);
  // A third hospital has no menu either.
  assert.equal(resolveTat(line('5', OTHER), idx).tat, null);
});

test('resolveTat — the CSV \'TAT - Days\' fallback is closed for a row without a menu', () => {
  const idx = buildTatIndex({});
  assert.deepEqual(resolveTat(line('1', KAMC, { tatDaysCsv: 7 }), idx), { tat: 7, matched: false, fromCsv: true });
  assert.deepEqual(resolveTat(line('2', SGH, { tatDaysCsv: 7 }), idx), { tat: null, matched: false, fromCsv: false });
  assert.deepEqual(resolveTat(line('3', SGH, { tatDaysCsv: 7 }), idx, { tatFallbackFromCsv: true }).tat, null);
});

test('resolveTat — legacy rows (no hospital fields) are KAMC: unchanged', () => {
  const idx = buildTatIndex(TAT_LOOKUP);
  const bare = line('1', {});
  delete bare.orderingFacilityId;
  delete bare.hospital;
  assert.equal(resolveTat(bare, idx).tat, KAMC_TAT);
  assert.equal(resolveTat({ testName: 'nope', tatDaysCsv: 4 }, idx).tat, 4);
});

// ---- engine/engine.js ------------------------------------------------------------------

test('compute — SGH rows never turn Late, even with a KAMC test name and a CSV TAT', () => {
  const rows = [line('1', SGH), line('2', SGH, { tatDaysCsv: 1 })];
  const out = compute(rows, TAT_LOOKUP, { asOf: ASOF });
  assert.equal(out.buckets.lateNoResult, 0);
  assert.equal(out.buckets.awaitingResults, 2, 'still counted as awaiting results');
  assert.equal(out.turnaround.measuredCount, 0);
  // The same lines as KAMC ARE late — the guard, not the data, made the difference.
  const asKamc = compute([line('1', KAMC), line('2', KAMC, { tatDaysCsv: 1 })], TAT_LOOKUP, { asOf: ASOF });
  assert.equal(asKamc.buckets.lateNoResult, 2);
});

test('compute — excludeNoTat never drops a row without a Test Menu (KAMC No-Match rows still go)', () => {
  const rows = [
    line('1', SGH),
    line('2', SGH, { testName: 'SGH ONLY TEST' }),
    line('3', KAMC, { testName: 'KAMC TEST NOT IN TABLE' }), // a genuine KAMC gap
    line('4', KAMC),
  ];
  const off = compute(rows, TAT_LOOKUP, { asOf: ASOF });
  const on = compute(rows, TAT_LOOKUP, { asOf: ASOF, excludeNoTat: true });
  assert.equal(on.excludedNoTat, 1, 'only the KAMC gap row is excluded');
  assert.equal(on.totals.total, off.totals.total - 1);
  assert.equal(on.funnel.received, off.funnel.received - 1);
  // An SGH-only compute with the setting on keeps every received order.
  const sghOnly = compute(rows.slice(0, 2), {}, { asOf: ASOF, excludeNoTat: true, tatFallbackFromCsv: false });
  assert.equal(sghOnly.excludedNoTat, 0);
  assert.equal(sghOnly.totals.total, 2);
  assert.equal(sghOnly.buckets.awaitingResults, 2);
});

test('compute — KAMC outputs are byte-identical whether golden rows carry the KAMC fields or none', () => {
  const stamped = GOLDEN_ORDERS.map((r) => ({ ...r, ...KAMC }));
  for (const extra of [{}, { excludeNoTat: true }, { tatFallbackFromCsv: false }]) {
    const a = compute(GOLDEN_ORDERS, TAT_LOOKUP, { ...goldenOpts(), ...extra });
    const b = compute(stamped, TAT_LOOKUP, { ...goldenOpts(), ...extra });
    assert.deepEqual(b, a, JSON.stringify(extra));
  }
});

test('compute — adding SGH rows to a KAMC call never changes the late / turnaround numbers', () => {
  const kamc = GOLDEN_ORDERS.map((r) => ({ ...r, ...KAMC }));
  const sgh = GOLDEN_ORDERS.slice(0, 40).map((r, i) => ({ ...r, ...SGH, orderId: `S${i}`, tatDaysCsv: 1 }));
  const a = compute(kamc, TAT_LOOKUP, goldenOpts());
  const b = compute([...kamc, ...sgh], TAT_LOOKUP, goldenOpts());
  assert.equal(b.buckets.lateNoResult, a.buckets.lateNoResult);
  assert.deepEqual(b.turnaround, a.turnaround);
  assert.deepEqual(b.byTest, a.byTest);
});

// ---- engine/asof.js --------------------------------------------------------------------

test('computeNumbersAsOf — the same excludeNoTat exemption, and no as-of lateness for SGH', () => {
  const rows = [line('1', SGH), line('2', SGH, { tatDaysCsv: 1 }), line('3', KAMC, { testName: 'KAMC GAP' }), line('4', KAMC)];
  const off = computeNumbersAsOf({ rows, tatTests: TAT_LOOKUP, asOfIso: ASOF });
  const on = computeNumbersAsOf({ rows, tatTests: TAT_LOOKUP, asOfIso: ASOF, opts: { excludeNoTat: true } });
  assert.equal(off.numbers.total, 4);
  assert.equal(on.numbers.total, 3, 'only the KAMC gap row is dropped');
  assert.equal(on.numbers.awaitingResults, 3);
  assert.equal(off.numbers.lateNoResult, 1, 'only the KAMC row with a TAT is late');
  // engine and as-of agree on the row set (the invariant asof.js is built around).
  const eng = compute(rows, TAT_LOOKUP, { asOf: ASOF, excludeNoTat: true });
  assert.equal(on.numbers.total, eng.totals.total);
  assert.equal(on.numbers.lateNoResult, eng.buckets.lateNoResult);
});

test('computeNumbersAsOf — legacy/KAMC rows unchanged by the exemption (golden rows, stamped or bare)', () => {
  const stamped = GOLDEN_ORDERS.map((r) => ({ ...r, ...KAMC }));
  for (const opts of [{}, { excludeNoTat: true }]) {
    const a = computeNumbersAsOf({ rows: GOLDEN_ORDERS, tatTests: TAT_LOOKUP, asOfIso: goldenOpts().asOf, opts });
    const b = computeNumbersAsOf({ rows: stamped, tatTests: TAT_LOOKUP, asOfIso: goldenOpts().asOf, opts });
    assert.deepEqual(b, a);
  }
});

// ---- model/sendout.js ------------------------------------------------------------------

// A placeholder catalogue: one single-country vendor and one whose test is unique in it.
const MASTER = [
  { vendor: 'Shared Lab Co -Orig-', country: 'Germany', reflab: 'RefLab North', item: 'TEST SHARED' },
  { vendor: 'Unique Test Vendor', country: 'USA', reflab: 'RefLab West', item: 'TEST UNIQUE' },
];
FACILITY_TO_VENDOR['shared lab'] = 'shared lab co';
FACILITY_DISPLAY['shared lab'] = 'Shared Lab';

const sendLine = (orderId, hosp, facility, testName, rawStatus = 'Result Approved') => ({
  orderId, facility, testName, rawStatus, ...hosp,
});

test('analyseSendout — rows without a Test Menu land in noTestMenu: in total, never attributed', () => {
  const rows = [
    sendLine('1', KAMC, 'Shared Lab', 'TEST SHARED'),
    sendLine('2', SGH, 'Shared Lab', 'TEST SHARED'), // aliased shared lab — would resolve
    sendLine('3', SGH, 'Unknown SGH Lab', 'TEST UNIQUE'), // unique catalogue test — would byTestName
    sendLine('4', SGH, '', 'TEST SHARED'), // blank facility
    sendLine('5', SGH, 'Shared Lab', 'TEST SHARED', 'Order Cancelled'), // cancelled: out of every count
    sendLine('6', OTHER, 'Shared Lab', 'TEST SHARED'),
  ];
  const so = analyseSendout(rows, MASTER);
  assert.equal(so.total, 5);
  assert.deepEqual(so.noTestMenu.map((o) => o.orderId), ['2', '3', '4', '6']);
  assert.equal(so.local + so.international, 1, 'only the KAMC order is attributed');
  assert.deepEqual(so.byCountry, [{ country: 'Germany', orders: 1 }]);
  assert.deepEqual(so.byLab.map((l) => [l.lab, l.orders]), [['Shared Lab', 1]]);
  assert.deepEqual(so.byTestName, []);
  assert.deepEqual(so.unmapped, [], 'not a gap: no alias is missing');
  assert.deepEqual(so.unresolved, []);
  const buckets = so.byLab.reduce((n, l) => n + l.orders, 0) + so.unmapped.length + so.unresolved.length + so.noTestMenu.length;
  assert.equal(buckets, so.total, 'the five buckets reconcile to total');
});

test('analyseSendout — another hospital\'s rows never fill (or block) a KAMC blank facility', () => {
  // KAMC's blank 'TEST X' line: the only KAMC line of that test names Shared Lab, so it
  // is inferred there. An SGH line of the same test at another lab must not make it
  // ambiguous (and is never itself attributed).
  const rows = [
    sendLine('1', KAMC, 'Shared Lab', 'TEST X'),
    sendLine('2', KAMC, '', 'TEST X'),
    sendLine('3', SGH, 'Other Lab', 'TEST X'),
    sendLine('4', SGH, '', 'TEST X'),
  ];
  const so = analyseSendout(rows, MASTER);
  assert.equal(so.byLab.find((l) => l.lab === 'Shared Lab').orders, 2, 'the KAMC blank is inferred to Shared Lab');
  assert.deepEqual(so.inferred.map((x) => [x.order.orderId, x.support]), [['2', 1]], 'support counts KAMC lines only');
  assert.deepEqual(so.noTestMenu.map((o) => o.orderId), ['3', '4']);
  assert.equal(so.noTestMenu[1].facility, '', 'an SGH blank is never filled');
});

test('analyseSendout — a KAMC-only (or legacy) set: noTestMenu empty, everything else identical', () => {
  const kamc = [
    sendLine('1', KAMC, 'Shared Lab', 'TEST SHARED'),
    sendLine('2', KAMC, '', 'TEST SHARED'),
    sendLine('3', KAMC, 'Unknown Lab', 'TEST UNIQUE'),
    sendLine('4', KAMC, 'Unknown Lab', 'TEST NOWHERE'),
  ];
  const legacy = kamc.map(({ orderingFacilityId, hospital, ...r }) => r);
  const a = analyseSendout(kamc, MASTER);
  const b = analyseSendout(legacy, MASTER);
  // The bucket key is ABSENT when empty (review R-3/R-5): a KAMC result is field-for-
  // field the historic shape, so the KAMC model stays deep-equal to HEAD's.
  assert.equal('noTestMenu' in a, false);
  assert.equal('noTestMenu' in b, false);
  const strip = (so) => JSON.parse(JSON.stringify({ ...so, inferred: so.inferred.map((x) => ({ ...x, order: x.order.orderId })) },
    (k, v) => (k === 'orderingFacilityId' || k === 'hospital' ? undefined : v)));
  assert.deepEqual(strip(b), strip(a));
  assert.equal(a.total, 4);
  assert.equal(a.byTestName.length, 1);
  assert.equal(a.unmapped.length, 1);
});
