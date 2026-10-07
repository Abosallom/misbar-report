// test/hospital.test.mjs — run with:  node --test
// The KAMC-only cut (model/hospital.js) and how the ordering-hospital columns reach
// OrderRow through the manual CSV path (ingest/csv.js). The Grafana path's mapping is
// in test/grafana.test.mjs (it shares csv.js findHospitalColumns).
// SYNTHETIC rows only — every order id, lab and patient value below is made up. The two
// hospital name/id pairs are the source's own spellings (organisations, not patients):
// KAMC 31763 'King Abdul ah Medical City' (sic) and SGH 1037 'Saudi German Hospital
// Alzahraa Branch' with the DOUBLE space the source writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { KAMC_FACILITY_ID, isKamcRow, splitByHospital, takeKamcOrders } from '../src/model/hospital.js';
import {
  parseKamcCsv, MAPPED_COLUMNS, findHospitalColumns, columnKey,
} from '../src/ingest/csv.js';

const require = createRequire(import.meta.url);
const Papa = require('../vendor/papaparse.min.js');

const KAMC_NAME = 'King Abdul ah Medical City';
const SGH_NAME_RAW = 'Saudi German Hospital  Alzahraa Branch'; // double space, as the source sends it
const SGH_NAME = 'Saudi German Hospital Alzahraa Branch'; // what ingest stores (collapsed)

/** A synthetic OrderRow; `over` sets the hospital fields (and anything else). */
const row = (orderId, over = {}) => ({
  orderDate: '2026-10-01', facility: 'Test Lab A', orderId, lineNo: 0, loinc: '0000-0',
  testName: 'Test Assay', collected: null, dispatched: null, received: null, resulted: null,
  rawStatus: 'Order Created', tatDaysCsv: null, specimenNo: null, shipmentId: null,
  orderingFacilityId: null, performingFacilityId: null, ...over,
});

// ---- isKamcRow ----------------------------------------------------------------------

test('KAMC_FACILITY_ID is the source id of KAMC, as a string', () => {
  assert.equal(KAMC_FACILITY_ID, '31763');
});

test('isKamcRow — the live shapes: KAMC kept, SGH ignored', () => {
  assert.equal(isKamcRow(row('1', { orderingFacilityId: '31763', hospital: KAMC_NAME })), true);
  assert.equal(isKamcRow(row('2', { orderingFacilityId: '1037', hospital: SGH_NAME_RAW })), false);
  assert.equal(isKamcRow(row('3', { orderingFacilityId: '1037', hospital: SGH_NAME })), false);
});

test('isKamcRow — rows that PREDATE the hospital columns are KAMC (legacy files, golden fixture)', () => {
  assert.equal(isKamcRow(row('1')), true, 'both null');
  const bare = row('2');
  delete bare.orderingFacilityId; // older snapshots never had the key at all
  delete bare.hospital;
  assert.equal(isKamcRow(bare), true, 'both keys absent');
  assert.equal(isKamcRow(row('3', { orderingFacilityId: '', hospital: '  ' })), true, 'blank cells');
});

test('isKamcRow — the facility id is authoritative over the name', () => {
  // A re-spelled or wrong name cannot pull an order across the line: the id decides.
  assert.equal(isKamcRow(row('1', { orderingFacilityId: '1037', hospital: KAMC_NAME })), false);
  assert.equal(isKamcRow(row('2', { orderingFacilityId: '31763', hospital: SGH_NAME })), true);
  // Ids are compared as trimmed strings (a numeric cell or a padded one still matches).
  assert.equal(isKamcRow(row('3', { orderingFacilityId: 31763 })), true);
  assert.equal(isKamcRow(row('4', { orderingFacilityId: ' 31763 ' })), true);
  assert.equal(isKamcRow(row('5', { orderingFacilityId: '317630' })), false);
  // Any OTHER hospital id is ignored too, not only SGH's.
  assert.equal(isKamcRow(row('6', { orderingFacilityId: '99999' })), false);
});

test('isKamcRow — no id: the NAME decides (KAMC spellings yes, anything else no)', () => {
  for (const name of [KAMC_NAME, 'KING ABDUL AH MEDICAL CITY', 'King Abdullah Medical City', 'king abdulah medical city']) {
    assert.equal(isKamcRow(row('1', { hospital: name })), true, name);
  }
  for (const name of [SGH_NAME_RAW, SGH_NAME, 'Some Other Hospital']) {
    assert.equal(isKamcRow(row('2', { hospital: name })), false, name);
  }
  // King ABDULAZIZ Medical City (NGHA) is a different hospital — a send-out lab in this
  // app already — and must not ride in on the loose KAMC pattern.
  for (const name of ['King Abdulaziz Medical City', 'King Abdul Aziz Medical City']) {
    assert.equal(isKamcRow(row('3', { hospital: name })), false, name);
  }
});

// ---- splitByHospital ----------------------------------------------------------------

test('splitByHospital — kept = the KAMC rows, ORIGINAL objects in ORIGINAL order; excluded grouped by hospital', () => {
  const rows = [
    row('01', { orderingFacilityId: '31763', hospital: KAMC_NAME }),
    row('02', { orderingFacilityId: '1037', hospital: SGH_NAME }),
    row('03'), // legacy: kept
    row('04', { hospital: 'Other Clinic' }), // name only, not KAMC
    row('05', { orderingFacilityId: '1037', hospital: SGH_NAME }),
    row('06', { orderingFacilityId: '31763', hospital: KAMC_NAME }),
    row('07', { orderingFacilityId: '1037', hospital: null }), // same hospital by id, no name
    row('08', { hospital: 'other  clinic' }), // same name, other case/spacing → same group
    row('09', { orderingFacilityId: '1037', hospital: SGH_NAME }),
  ];
  const before = JSON.stringify(rows);
  const { kept, excluded } = splitByHospital(rows);

  assert.deepEqual(kept.map((r) => r.orderId), ['01', '03', '06']);
  assert.equal(kept[0], rows[0], 'kept holds the original object, not a copy');
  assert.equal(kept[1], rows[2]);
  assert.equal(kept[2], rows[5]);

  assert.deepEqual(excluded, [
    { id: '1037', name: SGH_NAME, count: 4 },
    { id: null, name: 'Other Clinic', count: 2 },
  ]);
  assert.equal(JSON.stringify(rows), before, 'input rows are not mutated');
});

test('splitByHospital — a group\'s name is filled from a later row when the first had none', () => {
  const { excluded } = splitByHospital([
    row('1', { orderingFacilityId: '1037', hospital: null }),
    row('2', { orderingFacilityId: '1037', hospital: SGH_NAME_RAW }),
  ]);
  assert.deepEqual(excluded, [{ id: '1037', name: SGH_NAME, count: 2 }]);
});

test('splitByHospital — ties sort by label, so the result never depends on row order', () => {
  const a = row('1', { orderingFacilityId: '2001', hospital: 'Beta Hospital' });
  const b = row('2', { orderingFacilityId: '2002', hospital: 'Alpha Hospital' });
  const one = splitByHospital([a, b]).excluded.map((g) => g.name);
  const two = splitByHospital([b, a]).excluded.map((g) => g.name);
  assert.deepEqual(one, ['Alpha Hospital', 'Beta Hospital']);
  assert.deepEqual(two, one);
});

test('splitByHospital — an all-KAMC (or legacy) set passes through whole, nothing excluded', () => {
  const rows = [row('1'), row('2', { orderingFacilityId: '31763', hospital: KAMC_NAME })];
  const { kept, excluded } = splitByHospital(rows);
  assert.equal(kept.length, 2);
  assert.ok(kept.every((r, i) => r === rows[i]));
  assert.deepEqual(excluded, []);
  assert.deepEqual(splitByHospital([]), { kept: [], excluded: [] });
  assert.deepEqual(splitByHospital(null), { kept: [], excluded: [] });
});

// ---- ingest/csv.js: the hospital columns through parseKamcCsv ------------------------

// The 11 mapped columns + the operational ids, in a deliberately non-MAPPED order.
const BASE_HEADER = [
  'Order ID', 'Order date time', 'Performing facility name', 'Order Status',
  'Specimen collected date time', 'Dispatch date time', 'Received date time',
  'Result report date time', 'Test code', 'Test name', 'TAT - Days', 'Specimen Id',
];
// One synthetic line per BASE_HEADER column (orderId first; lab name chosen per row).
const baseCells = (orderId, lab) => [
  orderId, '2026-10-01 08:00:00', lab, 'Order Created', '', '', '', '', '0000-0', 'Test Assay', '', `SP-${orderId}`,
];
/** CSV text from a header and rows of cells (cells never contain commas here). */
const csv = (header, lines) => [header.join(','), ...lines.map((c) => c.join(','))].join('\n');

test('csv — the hospital columns are optional: not in MAPPED_COLUMNS, a legacy file stays error-free', () => {
  for (const col of MAPPED_COLUMNS) {
    assert.notEqual(columnKey(col), 'facilityname', `${col} must not be the hospital column`);
    assert.notEqual(columnKey(col), 'facilityid', `${col} must not be the hospital id column`);
  }
  const text = csv([...BASE_HEADER, 'Ordering facility ID'], [
    [...baseCells('00990000001', 'Test Lab A'), '31763'],
    [...baseCells('00990000002', 'Test Lab B'), ''],
  ]);
  const { rows, errors } = parseKamcCsv(text, Papa);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].hospital, null);
  assert.equal(rows[0].orderingFacilityId, '31763');
  assert.equal(rows[1].hospital, null);
  assert.equal(rows[1].orderingFacilityId, null);
  assert.deepEqual(splitByHospital(rows).kept, rows, 'a legacy file is all KAMC');
});

test('csv — every spelling of the hospital-name header maps to OrderRow.hospital (collapsed)', () => {
  for (const nameHeader of ['facility_name', 'Facility Name', 'FACILITY NAME', 'Facility_Name', ' facility  name ']) {
    const text = csv([...BASE_HEADER, nameHeader, 'Ordering facility ID'], [
      [...baseCells('00990000001', 'Test Lab A'), KAMC_NAME, '31763'],
      [...baseCells('00990000002', 'Test Lab B'), SGH_NAME_RAW, '1037'],
      [...baseCells('00990000003', 'Test Lab B'), '', ''],
    ]);
    const { rows, errors } = parseKamcCsv(text, Papa);
    assert.deepEqual(errors, [], nameHeader);
    assert.equal(rows[0].hospital, KAMC_NAME, nameHeader);
    assert.equal(rows[1].hospital, SGH_NAME, `${nameHeader}: the double space is collapsed`);
    assert.equal(rows[2].hospital, null, `${nameHeader}: a blank cell is null, not ''`);
    // The LAB stays the lab: the hospital column never leaks into `facility`.
    assert.equal(rows[0].facility, 'Test Lab A');
    assert.equal(rows[1].facility, 'Test Lab B');
  }
});

test('csv — \'Performing facility name\' and \'Ordering facility ID\' are never taken as the hospital columns', () => {
  assert.deepEqual(
    findHospitalColumns(['Performing facility name', 'Ordering facility ID', 'Performing facility id']),
    { nameCol: null, idCol: null },
  );
  assert.deepEqual(
    findHospitalColumns(['Performing facility name', 'facility_name', 'facility_id', 'Facility Name']),
    { nameCol: 'facility_name', idCol: 'facility_id' },
    'first match wins',
  );
  assert.deepEqual(findHospitalColumns(undefined), { nameCol: null, idCol: null });
});

test('csv — the hospital id column fills orderingFacilityId only when \'Ordering facility ID\' is absent or blank', () => {
  // (a) no 'Ordering facility ID' column at all → the hospital id column is used.
  for (const idHeader of ['facility_id', 'Facility ID', 'FACILITY_ID']) {
    const text = csv([...BASE_HEADER, 'Facility Name', idHeader], [
      [...baseCells('00990000001', 'Test Lab A'), KAMC_NAME, '31763'],
      [...baseCells('00990000002', 'Test Lab B'), SGH_NAME_RAW, '1037'],
    ]);
    const { rows, errors } = parseKamcCsv(text, Papa);
    assert.deepEqual(errors, [], idHeader);
    assert.deepEqual(rows.map((r) => r.orderingFacilityId), ['31763', '1037'], idHeader);
  }
  // (b) both present → 'Ordering facility ID' wins; a blank cell falls back.
  const text = csv([...BASE_HEADER, 'Ordering facility ID', 'Facility ID'], [
    [...baseCells('00990000001', 'Test Lab A'), '31763', '55555'],
    [...baseCells('00990000002', 'Test Lab B'), '', '1037'],
  ]);
  const { rows } = parseKamcCsv(text, Papa);
  assert.deepEqual(rows.map((r) => r.orderingFacilityId), ['31763', '1037']);
});

test('csv → splitByHospital end to end: the SGH lines drop out, KAMC lines keep lineNo', () => {
  const text = csv([...BASE_HEADER, 'Ordering facility ID', 'Facility Name', 'Facility ID'], [
    [...baseCells('00990000001', 'Test Lab A'), '31763', KAMC_NAME, '31763'],
    [...baseCells('00990000002', 'Test Lab B'), '1037', SGH_NAME_RAW, '1037'],
    [...baseCells('00990000003', 'Test Lab B'), '31763', KAMC_NAME, '31763'],
    [...baseCells('00990000004', 'Test Lab C'), '1037', SGH_NAME_RAW, '1037'],
    [...baseCells('00990000005', 'Test Lab C'), '1037', SGH_NAME_RAW, '1037'],
  ]);
  const { rows, raw } = parseKamcCsv(text, Papa);
  const { kept, excluded } = splitByHospital(rows);
  assert.deepEqual(kept.map((r) => r.orderId), ['00990000001', '00990000003']);
  // The raw.records[lineNo] link (filtered-CSV download) survives the cut.
  for (const r of kept) assert.equal(raw.records[r.lineNo]['Order ID'], r.orderId);
  assert.deepEqual(excluded, [{ id: '1037', name: SGH_NAME, count: 3 }]);
});

test('splitByHospital: one notice line per hospital even when some of its rows lack the id or the name', () => {
  const rows = [
    row('00990000011', { orderingFacilityId: '1037', hospital: SGH_NAME }),
    row('00990000012', { orderingFacilityId: '1037', hospital: '' }),      // id only
    row('00990000013', { orderingFacilityId: '', hospital: SGH_NAME }),    // name only
    row('00990000014', { orderingFacilityId: '777', hospital: '' }),       // unknown hospital, id only
  ];
  const { kept, excluded } = splitByHospital(rows);
  assert.equal(kept.length, 0);
  assert.deepEqual(excluded, [
    { id: '1037', name: SGH_NAME, count: 3 },
    { id: '777', name: null, count: 1 },
  ]);
});

test('takeKamcOrders: writes orders + excludedHospitals together; untouched array when nothing dropped', () => {
  const allKamc = [row('00990000021', { orderingFacilityId: KAMC_FACILITY_ID, hospital: KAMC_NAME })];
  const parsed = { orders: null, excludedHospitals: null };
  assert.equal(takeKamcOrders(parsed, allKamc), allKamc, 'same array object back');
  assert.equal(parsed.orders, allKamc);
  assert.deepEqual(parsed.excludedHospitals, []);

  const mixed = [
    row('00990000022', { orderingFacilityId: '1037', hospital: SGH_NAME }),
    allKamc[0],
  ];
  const got = takeKamcOrders(parsed, mixed);
  assert.deepEqual(got, [allKamc[0]]);
  assert.equal(parsed.orders, got);
  assert.deepEqual(parsed.excludedHospitals, [{ id: '1037', name: SGH_NAME, count: 1 }]);

  // Never throws on a bad source: empty orders, no notice.
  assert.deepEqual(takeKamcOrders(parsed, undefined), []);
  assert.deepEqual(parsed.excludedHospitals, []);
});
