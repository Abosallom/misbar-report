// test/core-hospital.test.mjs — run with:  node --test
// The hospital registry and the ONE door rows come in through (model/hospital.js):
// HOSPITALS, hospitalOf (name FIRST, then id; no name + no id = KAMC, the legacy rule;
// anything else = a third hospital), hasTestMenu, partitionHospitals, takeOrders,
// rowsForMode — plus state.js's parsed bucket (ordersByHospital beside the raw accessor)
// and the hospital-name columns on the CSV path.
// SYNTHETIC rows only — every order id, lab and patient value is made up. The hospital
// name/id pairs are the source's own spellings (organisations, not patients).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  HOSPITALS, HOSPITAL_MODES, KAMC_FACILITY_ID, SGH_FACILITY_ID,
  hospitalOf, hasTestMenu, partitionHospitals, takeOrders, takeKamcOrders, rowsForMode,
  isKamcRow, splitByHospital,
} from '../src/model/hospital.js';
import { state, resetRunData } from '../src/state.js';
import { parseKamcCsv, findHospitalColumns, columnKey } from '../src/ingest/csv.js';

const require = createRequire(import.meta.url);
const Papa = require('../vendor/papaparse.min.js');

const KAMC_NAME = 'King Abdul ah Medical City'; // sic — the source's spelling
const SGH_NAME = 'Saudi German Hospital Alzahraa Branch';
const SGH_NAME_RAW = 'Saudi German Hospital  Alzahraa Branch'; // double space, as sent

/** A synthetic OrderRow; `over` sets the hospital fields (and anything else). */
const row = (orderId, over = {}) => ({
  orderDate: '2026-10-01', facility: 'Test Lab A', orderId, lineNo: Number(orderId) || 0,
  loinc: '0000-0', testName: 'Test Assay', collected: null, dispatched: null, received: null,
  resulted: null, rawStatus: 'Order Created', tatDaysCsv: null, specimenNo: null,
  shipmentId: null, orderingFacilityId: null, performingFacilityId: null, hospital: null, ...over,
});

// ---- the registry -------------------------------------------------------------------

test('HOSPITALS — the contract shape: KAMC has the Test Menu, SGH does not; modes', () => {
  assert.deepEqual({ ...HOSPITALS.kamc }, { key: 'kamc', code: 'KAMC', id: '31763', hasTestMenu: true });
  assert.deepEqual({ ...HOSPITALS.sgh }, {
    key: 'sgh', code: 'SGH', id: '1037', hasTestMenu: false, arName: 'مستشفى الألماني السعودي',
  });
  assert.deepEqual(Object.keys(HOSPITALS), ['kamc', 'sgh'], 'display order');
  assert.deepEqual([...HOSPITAL_MODES], ['kamc', 'sgh', 'both']);
  assert.equal(KAMC_FACILITY_ID, '31763');
  assert.equal(SGH_FACILITY_ID, '1037');
  assert.ok(Object.isFrozen(HOSPITALS) && Object.isFrozen(HOSPITALS.sgh), 'one switch, not editable at runtime');
});

// ---- hospitalOf: the classification matrix --------------------------------------------

test('hospitalOf — the live shapes', () => {
  assert.equal(hospitalOf(row('1', { orderingFacilityId: '31763', hospital: KAMC_NAME })), 'kamc');
  assert.equal(hospitalOf(row('2', { orderingFacilityId: '1037', hospital: SGH_NAME })), 'sgh');
  assert.equal(hospitalOf(row('3', { orderingFacilityId: '1037', hospital: SGH_NAME_RAW })), 'sgh');
});

test('hospitalOf — NAME first: every KAMC / SGH spelling, with no id', () => {
  for (const name of [KAMC_NAME, 'KING ABDUL AH MEDICAL CITY', 'King Abdullah Medical City', 'king abdulah medical city', ' King  Abdul ah ']) {
    assert.equal(hospitalOf(row('1', { hospital: name })), 'kamc', name);
  }
  for (const name of [SGH_NAME, SGH_NAME_RAW, 'SAUDI GERMAN HOSPITAL', 'saudigerman hospital']) {
    assert.equal(hospitalOf(row('2', { hospital: name })), 'sgh', name);
  }
});

test('hospitalOf — a name that names a hospital beats a CONTRADICTING id (name first)', () => {
  assert.equal(hospitalOf(row('1', { orderingFacilityId: '1037', hospital: KAMC_NAME })), 'kamc');
  assert.equal(hospitalOf(row('2', { orderingFacilityId: '31763', hospital: SGH_NAME })), 'sgh');
  // The legacy isKamcRow is id-first and is kept as it was: the two only disagree on
  // such contradicting rows (none exist in the live feed).
  assert.equal(isKamcRow(row('4', { orderingFacilityId: '1037', hospital: KAMC_NAME })), false);
});

test('hospitalOf — a FOREIGN id makes a third hospital whatever the name says (review R-4)', () => {
  // The name patterns are loose (the source misspells KAMC); a different hospital whose
  // name merely CONTAINS «King Abdullah …» / «Saudi German …» is told apart by its own id.
  for (const [name, id] of [
    ['King Abdullah Specialized Children Hospital', '40001'],
    ['King Abdullah Hospital Bisha', '50002'],
    [KAMC_NAME, '99999'],
    ['Saudi German Hospital Riyadh', '2001'],
    [SGH_NAME, '99999'],
  ]) {
    assert.equal(hospitalOf(row('1', { orderingFacilityId: id, hospital: name })), null, `${name} / ${id}`);
    assert.equal(hasTestMenu(row('1', { orderingFacilityId: id, hospital: name })), false, `${name} / ${id}`);
  }
  // …and they are tallied in the notice under their own names, never counted.
  const rows = [
    row('1', { orderingFacilityId: '31763', hospital: KAMC_NAME }),
    row('2', { orderingFacilityId: '40001', hospital: 'King Abdullah Specialized Children Hospital' }),
    row('3', { orderingFacilityId: '2001', hospital: 'Saudi German Hospital Riyadh' }),
    row('4', { orderingFacilityId: '1037', hospital: SGH_NAME }),
  ];
  const p = partitionHospitals(rows);
  assert.deepEqual(p.kamc, [rows[0]]);
  assert.deepEqual(p.sgh, [rows[3]]);
  assert.deepEqual(p.excluded.map((e) => [e.id, e.name, e.count]), [
    ['40001', 'King Abdullah Specialized Children Hospital', 1],
    ['2001', 'Saudi German Hospital Riyadh', 1],
  ]);
  // The legacy isKamcRow (id-first) already agreed on these rows.
  assert.equal(isKamcRow(rows[1]), false);
});

test('hospitalOf — a KNOWN-FOREIGN name (NGHA) is a third hospital even with one of OUR ids (review R-1)', () => {
  for (const id of ['31763', '1037', '']) {
    for (const name of ['King Abdulaziz Medical City', 'King Abdul Aziz Medical City', 'KING ABDUL-AZIZ MEDICAL CITY']) {
      assert.equal(hospitalOf(row('1', { orderingFacilityId: id, hospital: name })), null, `${name} / ${id}`);
      assert.equal(hasTestMenu(row('1', { orderingFacilityId: id, hospital: name })), false, `${name} / ${id}`);
    }
  }
});

test('hospitalOf — no recognisable name: the id decides (ids trimmed, numbers coerced)', () => {
  assert.equal(hospitalOf(row('1', { orderingFacilityId: '31763' })), 'kamc');
  assert.equal(hospitalOf(row('2', { orderingFacilityId: 31763 })), 'kamc');
  assert.equal(hospitalOf(row('3', { orderingFacilityId: ' 1037 ' })), 'sgh');
  assert.equal(hospitalOf(row('4', { orderingFacilityId: 1037, hospital: '   ' })), 'sgh', 'blank name = no name');
  // An UNRECOGNISED name with a reported hospital's id stays that hospital's order
  // (a re-spelled name must not push a hospital's own orders out of its report).
  assert.equal(hospitalOf(row('5', { orderingFacilityId: '31763', hospital: 'Current Hospital' })), 'kamc');
  assert.equal(hospitalOf(row('6', { orderingFacilityId: '1037', hospital: 'SGH Zahraa' })), 'sgh');
  // Near-miss ids are not ours.
  assert.equal(hospitalOf(row('7', { orderingFacilityId: '317630' })), null);
  assert.equal(hospitalOf(row('8', { orderingFacilityId: '10370' })), null);
});

test('hospitalOf — THIRD hospitals are null: unknown id, unknown name, NGHA', () => {
  assert.equal(hospitalOf(row('1', { orderingFacilityId: '9001' })), null, 'unknown id only');
  assert.equal(hospitalOf(row('2', { hospital: 'Some Other Hospital' })), null, 'unknown name only');
  assert.equal(hospitalOf(row('3', { orderingFacilityId: '9001', hospital: 'Some Other Hospital' })), null);
  // King ABDULAZIZ Medical City (NGHA) is a different hospital, never KAMC.
  for (const name of ['King Abdulaziz Medical City', 'King Abdul Aziz Medical City', 'King Abdul-Aziz Medical City']) {
    assert.equal(hospitalOf(row('4', { hospital: name })), null, name);
  }
});

test('hospitalOf — LEGACY: no name and no id (null, blank, or keys absent) is KAMC', () => {
  assert.equal(hospitalOf(row('1')), 'kamc', 'both null');
  assert.equal(hospitalOf(row('2', { orderingFacilityId: '', hospital: '  ' })), 'kamc', 'blank cells');
  const bare = row('3');
  delete bare.orderingFacilityId;
  delete bare.hospital;
  assert.equal(hospitalOf(bare), 'kamc', 'keys absent (older snapshots, golden fixture)');
  assert.equal(hospitalOf({ testName: 'X' }), 'kamc', 'a minimal object');
});

test('hospitalOf — a hole is no hospital\'s order', () => {
  for (const v of [null, undefined, 0, '', 'row']) assert.equal(hospitalOf(v), null, String(v));
});

test('hasTestMenu — true for KAMC and legacy rows only', () => {
  assert.equal(hasTestMenu(row('1', { orderingFacilityId: '31763', hospital: KAMC_NAME })), true);
  assert.equal(hasTestMenu(row('2')), true, 'legacy = KAMC');
  assert.equal(hasTestMenu(row('3', { orderingFacilityId: '1037', hospital: SGH_NAME })), false, 'SGH: no menu yet');
  assert.equal(hasTestMenu(row('4', { hospital: SGH_NAME })), false);
  assert.equal(hasTestMenu(row('5', { orderingFacilityId: '9001' })), false, 'third hospital');
  assert.equal(hasTestMenu(null), false);
});

// ---- partitionHospitals --------------------------------------------------------------

const MIXED = [
  row('01', { orderingFacilityId: '31763', hospital: KAMC_NAME }),
  row('02', { orderingFacilityId: '1037', hospital: SGH_NAME }),
  row('03'), // legacy → KAMC
  row('04', { hospital: 'Other Clinic' }), // third, name only
  null, // a hole
  row('05', { orderingFacilityId: '1037', hospital: null }), // SGH by id
  row('06', { orderingFacilityId: '31763', hospital: KAMC_NAME }),
  row('07', { hospital: 'other  clinic' }), // same third hospital, other case/spacing
  row('08', { orderingFacilityId: '9002' }), // another third hospital, id only
  row('09', { hospital: SGH_NAME_RAW }), // SGH by name, no id
];

test('partitionHospitals — each row in exactly one place; ORIGINAL objects, ORIGINAL order', () => {
  const before = JSON.stringify(MIXED);
  const { kamc, sgh, excluded } = partitionHospitals(MIXED);
  assert.deepEqual(kamc.map((r) => r.orderId), ['01', '03', '06']);
  assert.deepEqual(sgh.map((r) => r.orderId), ['02', '05', '09']);
  assert.equal(kamc[1], MIXED[2], 'the original object, not a copy');
  assert.equal(sgh[1], MIXED[5]);
  // THIRD hospitals only — SGH is never in the notice.
  assert.deepEqual(excluded, [
    { id: null, name: 'Other Clinic', count: 2 },
    { id: '9002', name: null, count: 1 },
  ]);
  assert.equal(JSON.stringify(MIXED), before, 'nothing mutated');
  const counted = kamc.length + sgh.length + excluded.reduce((n, g) => n + g.count, 0);
  assert.equal(counted, MIXED.filter(Boolean).length, 'every real row accounted for once');
});

test('partitionHospitals — a third hospital\'s id-only and name-only rows make ONE notice line', () => {
  const { excluded } = partitionHospitals([
    row('1', { orderingFacilityId: '9001', hospital: 'Test Other Hospital' }),
    row('2', { orderingFacilityId: '9001', hospital: '' }),
    row('3', { orderingFacilityId: '', hospital: 'Test  Other Hospital' }),
  ]);
  assert.deepEqual(excluded, [{ id: '9001', name: 'Test Other Hospital', count: 3 }]);
});

test('partitionHospitals — non-arrays and empties never throw', () => {
  for (const v of [null, undefined, 'x', {}, []]) {
    assert.deepEqual(partitionHospitals(v), { kamc: [], sgh: [], excluded: [] });
  }
});

test('splitByHospital (legacy) still tallies SGH among the excluded — unchanged contract', () => {
  const { kept, excluded } = splitByHospital(MIXED);
  assert.deepEqual(kept.map((r) => r.orderId), ['01', '03', '06']);
  assert.deepEqual(excluded.find((g) => g.id === '1037'), { id: '1037', name: SGH_NAME, count: 3 });
});

// ---- takeOrders ----------------------------------------------------------------------

test('takeOrders — all-KAMC source: parsed.orders IS the source array; sgh empty; no notice', () => {
  for (const rows of [
    [row('1', { orderingFacilityId: '31763', hospital: KAMC_NAME }), row('2')],
    [row('1'), row('2')], // legacy file
    [],
  ]) {
    const parsed = { orders: null, excludedHospitals: null };
    assert.equal(takeOrders(parsed, rows), rows);
    assert.equal(parsed.orders, rows, 'the SAME array object');
    assert.equal(parsed.ordersByHospital.kamc, rows, 'ordersByHospital.kamc is that very array');
    assert.deepEqual(parsed.ordersByHospital.sgh, []);
    assert.deepEqual(parsed.excludedHospitals, []);
  }
});

test('takeOrders — mixed source: orders = KAMC only; sgh beside it; third hospitals in the notice', () => {
  const parsed = { orders: null, excludedHospitals: null };
  const got = takeOrders(parsed, MIXED);
  assert.deepEqual(got.map((r) => r.orderId), ['01', '03', '06']);
  assert.equal(parsed.orders, got);
  assert.notEqual(got, MIXED, 'a filtered array when anything was not KAMC');
  assert.equal(parsed.ordersByHospital.kamc, parsed.orders, 'kamc and orders are ONE array');
  assert.deepEqual(parsed.ordersByHospital.sgh.map((r) => r.orderId), ['02', '05', '09']);
  assert.deepEqual(parsed.excludedHospitals.map((g) => g.name || g.id), ['Other Clinic', '9002']);
  assert.ok(!parsed.excludedHospitals.some((g) => g.id === '1037' || /german/i.test(g.name || '')), 'SGH is not excluded');
});

test('takeOrders — an SGH-only source leaves NO KAMC orders (empty array, not the SGH rows)', () => {
  const rows = [row('1', { orderingFacilityId: '1037', hospital: SGH_NAME })];
  const parsed = { orders: null, excludedHospitals: null };
  assert.deepEqual(takeOrders(parsed, rows), []);
  assert.deepEqual(parsed.ordersByHospital.sgh, rows);
  assert.deepEqual(parsed.excludedHospitals, []);
});

test('takeOrders — every call makes a NEW ordersByHospital object (a load\'s identity); bad input never throws', () => {
  const parsed = { orders: null, excludedHospitals: null };
  takeOrders(parsed, MIXED);
  const first = parsed.ordersByHospital;
  takeOrders(parsed, MIXED);
  assert.notEqual(parsed.ordersByHospital, first);
  assert.deepEqual(takeOrders(parsed, undefined), []);
  assert.deepEqual(parsed.ordersByHospital, { kamc: [], sgh: [] });
  assert.deepEqual(parsed.excludedHospitals, []);
  assert.equal(takeKamcOrders, takeOrders, 'the old name is the same door');
});

// ---- rowsForMode ---------------------------------------------------------------------

test('rowsForMode — kamc = parsed.orders, sgh = ordersByHospital.sgh, both = the two apart', () => {
  const parsed = { orders: null, excludedHospitals: null };
  takeOrders(parsed, MIXED);
  assert.equal(rowsForMode(parsed, 'kamc'), parsed.orders);
  assert.equal(rowsForMode(parsed, 'sgh'), parsed.ordersByHospital.sgh);
  const both = rowsForMode(parsed, 'both');
  assert.equal(both.kamc, parsed.orders);
  assert.equal(both.sgh, parsed.ordersByHospital.sgh);
  assert.ok(!Array.isArray(both), 'never the union');
});

test('rowsForMode — nothing loaded / a bucket that predates ordersByHospital; unknown mode throws', () => {
  assert.equal(rowsForMode({ orders: null }, 'kamc'), null);
  assert.equal(rowsForMode({ orders: null }, 'sgh'), null);
  assert.deepEqual(rowsForMode(null, 'both'), { kamc: null, sgh: null });
  for (const bad of ['KAMC', 'all', '', undefined]) {
    assert.throws(() => rowsForMode({ orders: [] }, bad), /unknown report type/);
  }
});

// ---- state.js: the parsed bucket ---------------------------------------------------

test('state.js — a fresh run: nothing loaded for EITHER hospital, no exclusions, report type KAMC', () => {
  resetRunData();
  // null, like orders (review R-2): never [] = "loaded, zero rows".
  assert.deepEqual(state.parsed.ordersByHospital, { kamc: null, sgh: null });
  assert.equal(state.parsed.ordersByHospital.kamc, state.parsed.orders, 'kamc IS orders, also before a load');
  assert.equal(rowsForMode(state.parsed, 'kamc'), null);
  assert.equal(rowsForMode(state.parsed, 'sgh'), null, 'sgh: nothing loaded, same as kamc');
  assert.deepEqual(rowsForMode(state.parsed, 'both'), { kamc: null, sgh: null });
  assert.deepEqual(state.parsed.excludedHospitals, []);
  assert.equal(state.reportHospital, 'kamc');
  state.reportHospital = 'both';
  resetRunData();
  assert.equal(state.reportHospital, 'kamc', '«تقرير جديد» goes back to the historic report');
});

test('state.js — takeOrders on the real bucket, then raw (the CSV order): raw survives, pairing holds', () => {
  resetRunData();
  const RAW = { fields: ['Order ID'], records: [] };
  takeOrders(state.parsed, MIXED);
  state.parsed.raw = RAW;
  assert.equal(state.parsed.raw, RAW);
  assert.deepEqual(state.parsed.ordersByHospital.sgh.map((r) => r.orderId), ['02', '05', '09']);
  assert.equal(state.parsed.ordersByHospital.kamc, state.parsed.orders);
  // Writing ordersByHospital never touches raw (it is a plain field).
  state.parsed.ordersByHospital = { kamc: state.parsed.orders, sgh: [] };
  assert.equal(state.parsed.raw, RAW);
  resetRunData();
});

test('state.js — a writer that assigns orders DIRECTLY drops raw AND the previous load\'s SGH rows', () => {
  resetRunData();
  takeOrders(state.parsed, MIXED);
  state.parsed.raw = { fields: [], records: [] };
  const next = [row('1')];
  state.parsed.orders = next; // e.g. a pull step that knows nothing of hospitals
  assert.equal(state.parsed.raw, null);
  assert.equal(state.parsed.ordersByHospital.kamc, next);
  assert.deepEqual(state.parsed.ordersByHospital.sgh, [], 'no stale SGH rows beside new KAMC rows');
  // Re-assigning the SAME array is a no-op for both.
  const obh = state.parsed.ordersByHospital;
  state.parsed.orders = next;
  assert.equal(state.parsed.ordersByHospital, obh);
  state.parsed.orders = null;
  assert.deepEqual(state.parsed.ordersByHospital, { kamc: null, sgh: null }, 'orders dropped = nothing loaded');
  assert.equal(rowsForMode(state.parsed, 'sgh'), null);
  state.parsed.orders = [];
  assert.deepEqual(state.parsed.ordersByHospital, { kamc: [], sgh: [] }, 'an empty load is a load');
  assert.equal(state.parsed.ordersByHospital.kamc, state.parsed.orders);
  resetRunData();
});

// ---- ingest: the hospital-name header, robustly ----------------------------------------

const BASE_HEADER = [
  'Order ID', 'Order date time', 'Performing facility name', 'Order Status',
  'Specimen collected date time', 'Dispatch date time', 'Received date time',
  'Result report date time', 'Test code', 'Test name', 'TAT - Days',
];
const baseCells = (orderId, lab) => [
  orderId, '2026-10-01 08:00:00', lab, 'Order Created', '', '', '', '', '0000-0', 'Test Assay', '',
];
const csv = (header, lines) => [header.join(','), ...lines.map((c) => c.join(','))].join('\n');

test('csv — header variants (BOM, NBSP, hyphen, dot, zero-width) all map to OrderRow.hospital', () => {
  for (const h of ['﻿facility_name', 'Facility Name', 'Facility-Name', 'facility.name', 'Fac​ility Name', 'FACILITY NAME']) {
    assert.equal(columnKey(h), 'facilityname', JSON.stringify(h));
    const { rows, errors } = parseKamcCsv(csv([...BASE_HEADER, h], [
      [...baseCells('00990000001', 'Test Lab A'), KAMC_NAME],
      [...baseCells('00990000002', 'Test Lab B'), SGH_NAME_RAW],
    ]), Papa);
    assert.deepEqual(errors, [], JSON.stringify(h));
    assert.deepEqual(rows.map(hospitalOf), ['kamc', 'sgh'], `${JSON.stringify(h)}: classified by NAME (no id column)`);
    assert.equal(rows[1].hospital, SGH_NAME, 'whitespace collapsed');
  }
});

test('csv — \'Ordering facility name\' is a second-choice name header; facility_name wins wherever it sits', () => {
  assert.deepEqual(findHospitalColumns(['Ordering Facility Name', 'x']), { nameCol: 'Ordering Facility Name', idCol: null });
  assert.deepEqual(findHospitalColumns(['Ordering facility name', 'Facility Name']), { nameCol: 'Facility Name', idCol: null });
  // Never the lab, never the id.
  assert.deepEqual(findHospitalColumns(['Performing facility name', 'Ordering facility ID']), { nameCol: null, idCol: null });
});

test('csv → takeOrders end to end: SGH rows kept beside KAMC with their lineNo into raw', () => {
  const { rows, raw } = parseKamcCsv(csv([...BASE_HEADER, 'Facility Name', 'Facility ID'], [
    [...baseCells('00990000001', 'Test Lab A'), KAMC_NAME, '31763'],
    [...baseCells('00990000002', 'Test Lab B'), SGH_NAME_RAW, '1037'],
    [...baseCells('00990000003', 'Test Lab B'), 'Test Other Hospital', '9001'],
    [...baseCells('00990000004', 'Test Lab C'), '', ''], // legacy-shaped line → KAMC
  ]), Papa);
  const parsed = { orders: null, excludedHospitals: null };
  takeOrders(parsed, rows);
  assert.deepEqual(parsed.orders.map((r) => r.orderId), ['00990000001', '00990000004']);
  assert.deepEqual(parsed.ordersByHospital.sgh.map((r) => r.orderId), ['00990000002']);
  for (const r of [...parsed.orders, ...parsed.ordersByHospital.sgh]) {
    assert.equal(raw.records[r.lineNo]['Order ID'], r.orderId);
  }
  assert.deepEqual(parsed.excludedHospitals, [{ id: '9001', name: 'Test Other Hospital', count: 1 }]);
});
