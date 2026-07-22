// test/late-labs.test.mjs — run with:  node --test
// Builds the per-lab "TAT Late & Due" workbooks from the REAL sample CSV and
// asserts the export reproduces the reference format exactly. Skips (does not
// fail) when the gitignored sample CSV is absent, mirroring test/ingest.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as XLSX from '../vendor/xlsx.mjs';
import { parseKamcCsv } from '../src/ingest/csv.js';
import {
  buildLateLabWorkbooks, LATE_LAB_HEADERS, labSheetName, labFileName,
} from '../src/export/late-labs.js';
import { buildTatIndex, resolveTat } from '../src/engine/tat.js';
import {
  parseDateTime, toEpochDay, workday, dayDiff,
} from '../src/engine/workday.js';

const require = createRequire(import.meta.url);
const Papa = require('../vendor/papaparse.min.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const firstExisting = (...paths) => paths.find((p) => existsSync(p)) || null;
const CSV_PATH = firstExisting(
  join(HERE, 'samples/orders.csv'),
  '/Users/aziz/KAMC Order details-data-2026-07-19 10_23_40.csv',
);
const SKIP = !CSV_PATH;

// As-of = the day AFTER the sample CSV's max order date (2026-07-08) → 2026-07-09.
// Injected (never Date.now()) so the whole suite is deterministic.
const AS_OF = '2026-07-09';
const asOfMs = toEpochDay(parseDateTime(AS_OF));

const csvText = CSV_PATH ? readFileSync(CSV_PATH, 'utf8') : '';
const load = () => parseKamcCsv(csvText, Papa).rows;

// Independent re-implementation of the documented method, used to cross-check the
// module. Empty tatTests → resolveTat falls back to the CSV "TAT - Days" column.
function independentInclude(rows) {
  const tatIndex = buildTatIndex({});
  const asOfDay = toEpochDay(asOfMs);
  const per = new Map();
  for (const row of rows) {
    if (row.rawStatus === 'Order Cancelled' || row.rawStatus === 'Result Rejected') continue;
    const receivedMs = parseDateTime(row.received);
    if (receivedMs == null) continue;
    if (parseDateTime(row.resulted) != null) continue;
    const { tat } = resolveTat(row, tatIndex, {});
    if (tat == null) continue;
    const dueMs = workday(receivedMs, tat);
    const delay = dayDiff(asOfDay, dueMs);
    const late = delay > 0;
    const dueSoon = !late && delay >= -1 && delay <= 0;
    if (!late && !dueSoon) continue;
    const lab = row.facility;
    if (lab == null || String(lab).trim() === '') continue;
    if (!per.has(lab)) per.set(lab, []);
    per.get(lab).push({ row, tat, dueMs, delay, late, dueSoon });
  }
  return per;
}

const usedRange = (ws) => XLSX.utils.decode_range(ws['!ref']);
const cellAt = (ws, r, c) => ws[XLSX.utils.encode_cell({ r, c })];

// Synthetic OrderRow builder — only the fields the export reads; the rest default
// to null. Matches the OrderRow shape in src/contracts.js. Empty tatTests → the
// export resolves StdTAT from tatDaysCsv (the CSV "TAT - Days" fallback).
const orderRow = (o) => ({
  orderDate: '2026-06-01', facility: 'Synthetic Lab',
  orderId: null, lineNo: null, loinc: null, testName: null,
  collected: null, dispatched: null, received: null, resulted: null,
  rawStatus: 'Received', tatDaysCsv: null,
  specimenNo: null, shipmentId: null, orderingFacilityId: null, performingFacilityId: null,
  ...o,
});

test('counts are per TEST line, not per order', () => {
  const rows = [
    // ONE order (000501) with THREE test lines — all LATE: received long before
    // asOf with a 1-business-day StdTAT ⇒ delay ≫ 0 for each line.
    orderRow({ orderId: '000501', lineNo: 1, testName: 'ALPHA TEST', received: '2026-06-01 08:00:00', tatDaysCsv: 1 }),
    orderRow({ orderId: '000501', lineNo: 2, testName: 'BETA TEST',  received: '2026-06-01 09:00:00', tatDaysCsv: 1 }),
    orderRow({ orderId: '000501', lineNo: 3, testName: 'GAMMA TEST', received: '2026-06-01 10:00:00', tatDaysCsv: 1 }),
    // A DIFFERENT order with a single DUE-SOON line — due on asOf day (delay 0).
    orderRow({ orderId: '000777', lineNo: 1, testName: 'DELTA TEST', received: '2026-07-09 09:00:00', tatDaysCsv: 0 }),
  ];

  const wbs = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs, XLSX });
  assert.equal(wbs.length, 1, 'all rows share one facility ⇒ a single workbook');
  const w = wbs[0];
  assert.equal(w.lab, 'Synthetic Lab');
  assert.equal(w.late, 3, 'three LATE test LINES counted (order not collapsed to 1)');
  assert.equal(w.dueSoon, 1, 'one due-soon test line');

  const ws = w.wb.Sheets[w.sheetName];
  const rng = usedRange(ws);
  assert.equal(rng.e.r - rng.s.r, 4, 'four data rows = 3 late + 1 due-soon (per LINE, order never deduped)');

  // Order ID column (col 4): the SAME order (000501 → 501) appears on THREE rows.
  const orderIds = [];
  for (let r = rng.s.r + 1; r <= rng.e.r; r++) orderIds.push(cellAt(ws, r, 4)?.v);
  assert.equal(orderIds.filter((v) => v === 501).length, 3, 'one order contributes three rows');
  assert.equal(orderIds.filter((v) => v === 777).length, 1, 'the other order contributes one row');
});

test('per-lab counts + which labs qualify (deterministic, CSV-fallback TAT)', { skip: SKIP }, () => {
  const wbs = buildLateLabWorkbooks({ rows: load(), tatTests: {}, asOfMs, XLSX });
  const byLab = Object.fromEntries(wbs.map((w) => [w.lab, { late: w.late, dueSoon: w.dueSoon }]));

  // Exactly three labs get a file (labs with zero qualifying rows are absent).
  assert.equal(wbs.length, 3, 'three labs qualify');
  assert.deepEqual(byLab['Advanced Laboratory Services .Co'], { late: 38, dueSoon: 9 });
  assert.deepEqual(byLab['Fal Specialized Medical Lab'], { late: 1, dueSoon: 0 });
  assert.deepEqual(byLab['Saudi Diagnostics Limited Company'], { late: 1, dueSoon: 0 });
  // Labs present in the data but with no qualifying rows must NOT get a file.
  for (const absent of ['Eurofins clinical', 'king Abdullaziz Medical city in Riyadh', 'Anwa Medical Company', '']) {
    assert.ok(!(absent in byLab), `lab must be absent: ${JSON.stringify(absent)}`);
  }
});

test('header row is exactly the 20 verbatim strings', { skip: SKIP }, () => {
  const wbs = buildLateLabWorkbooks({ rows: load(), tatTests: {}, asOfMs, XLSX });
  assert.equal(LATE_LAB_HEADERS.length, 20);
  for (const w of wbs) {
    const ws = w.wb.Sheets[w.sheetName];
    const rng = usedRange(ws);
    const hdr = [];
    for (let c = rng.s.c; c <= rng.e.c; c++) hdr.push(cellAt(ws, 0, c)?.v ?? null);
    assert.deepEqual(hdr, [...LATE_LAB_HEADERS], `headers for ${w.lab}`);
  }
});

test('sheet name = lab (sanitized ≤31); autofilter + ref span the used range; !cols present', { skip: SKIP }, () => {
  const wbs = buildLateLabWorkbooks({ rows: load(), tatTests: {}, asOfMs, XLSX });
  for (const w of wbs) {
    assert.equal(w.wb.SheetNames.length, 1);
    assert.equal(w.wb.SheetNames[0], labSheetName(w.lab), 'sheet named the (sanitized) lab');
    assert.ok(w.sheetName.length <= 31, 'sheet name ≤ 31 chars');
    const ws = w.wb.Sheets[w.sheetName];
    const nRows = w.late + w.dueSoon; // data rows
    const expectRef = `A1:T${nRows + 1}`; // header + data, 20 cols (A..T)
    assert.equal(ws['!ref'], expectRef, `!ref for ${w.lab}`);
    assert.deepEqual(ws['!autofilter'], { ref: expectRef }, `autofilter for ${w.lab}`);
    assert.ok(Array.isArray(ws['!cols']) && ws['!cols'].length === 20, '!cols has 20 entries');
    assert.ok(ws['!cols'].every((c) => typeof c.wch === 'number'), 'every col has a wch width');
  }
});

test('every included row is in scope (received && !resulted, not cancelled/rejected) and obeys the Status/flag rules', { skip: SKIP }, () => {
  const rows = load();
  const wbs = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs, XLSX });
  const expected = independentInclude(rows);

  for (const w of wbs) {
    const ws = w.wb.Sheets[w.sheetName];
    const rng = usedRange(ws);
    let lateSeen = 0;
    let dueSoonSeen = 0;
    for (let r = rng.s.r + 1; r <= rng.e.r; r++) {
      const status = cellAt(ws, r, 18)?.v;       // Status
      const delay = cellAt(ws, r, 17)?.v;        // Delay (days) — a number
      const risk = cellAt(ws, r, 19)?.v ?? '';   // Late Risk (next 24h)
      const resultCell = cellAt(ws, r, 13);      // Result report date time — must be empty
      assert.equal(resultCell, undefined, 'no result-report cell (scope: not yet resulted)');
      assert.equal(typeof delay, 'number', 'Delay written as a number');
      if (status === 'Late') {
        assert.ok(delay > 0, 'Late ⇒ delay > 0');
        assert.equal(risk, '', 'Late rows carry no due-soon flag');
        lateSeen += 1;
      } else {
        assert.equal(status, 'On Time', 'non-Late status is "On Time"');
        assert.ok(delay >= -1 && delay <= 0, 'due-soon ⇒ −1 ≤ delay ≤ 0');
        assert.equal(risk, '⚠ DUE ≤24H', 'due-soon rows are flagged');
        dueSoonSeen += 1;
      }
    }
    assert.equal(lateSeen, w.late, 'Late count matches the summary');
    assert.equal(dueSoonSeen, w.dueSoon, 'due-soon count matches the summary');
    // Cross-check against the independent scope computation.
    const exp = expected.get(w.lab) || [];
    assert.equal(exp.length, w.late + w.dueSoon, `independent include count for ${w.lab}`);
    for (const e of exp) {
      assert.ok(parseDateTime(e.row.received) != null, 'included row has Received');
      assert.equal(parseDateTime(e.row.resulted), null, 'included row has NO result');
      assert.notEqual(e.row.rawStatus, 'Order Cancelled');
      assert.notEqual(e.row.rawStatus, 'Result Rejected');
    }
  }
});

test('delay math spot-check — recompute one row by hand with workday()', { skip: SKIP }, () => {
  const rows = load();
  const expected = independentInclude(rows);
  const advanced = expected.get('Advanced Laboratory Services .Co');
  assert.ok(advanced && advanced.length, 'have Advanced rows');
  const first = advanced[0]; // first included Advanced row in CSV order == workbook data row 1

  // Hand computation from the raw row fields.
  const receivedMs = parseDateTime(first.row.received);
  const tat = first.tat;
  const dueMs = workday(receivedMs, tat);
  const delay = dayDiff(toEpochDay(asOfMs), dueMs);
  assert.equal(delay, first.delay, 'independent + hand delays agree');

  // The workbook cell must carry that exact delay, in the same lab's data row 1.
  const wbs = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs, XLSX });
  const w = wbs.find((x) => x.lab === 'Advanced Laboratory Services .Co');
  const ws = w.wb.Sheets[w.sheetName];
  assert.equal(cellAt(ws, 1, 17).v, delay, 'Delay cell equals the hand-computed delay');
  assert.equal(cellAt(ws, 1, 18).v, delay > 0 ? 'Late' : 'On Time', 'Status matches delay sign');
  // Due Date cell is the Excel serial of dueMs (integer day).
  const serial = dueMs / 86400000 + 25569;
  assert.equal(cellAt(ws, 1, 16).v, serial, 'Due Date serial matches workday(received, tat)');
});

test('deterministic, correct file names — same output across runs', { skip: SKIP }, () => {
  const rows = load();
  const a = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs, XLSX });
  const b = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs, XLSX });
  assert.deepEqual(a.map((w) => w.fileName), b.map((w) => w.fileName), 'stable order + names');
  for (const w of a) {
    assert.equal(w.fileName, `${w.lab} - TAT Late & Due.xlsx`);
    assert.equal(w.fileName, labFileName(w.lab));
  }
  // Sorted worst-first: Advanced (47) before the two single-row labs.
  assert.equal(a[0].lab, 'Advanced Laboratory Services .Co');
});

test('new OrderRow identifier fields are populated (specimenNo etc.) and performingFacilityId is null', { skip: SKIP }, () => {
  const rows = load();
  assert.ok(rows.some((r) => r.specimenNo != null && r.specimenNo !== ''), 'specimenNo present on ≥1 row');
  assert.ok(rows.some((r) => r.shipmentId != null && r.shipmentId !== ''), 'shipmentId present on ≥1 row');
  assert.ok(rows.some((r) => r.orderingFacilityId != null && r.orderingFacilityId !== ''), 'orderingFacilityId present on ≥1 row');
  // 'Performing facility id' column is absent from this CSV export → always null.
  assert.ok(rows.every((r) => r.performingFacilityId == null), 'performingFacilityId null (column absent)');
  // The identifiers must survive into the workbook (Specimen no = col 8, non-empty somewhere).
  const wbs = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs, XLSX });
  const ws = wbs[0].wb.Sheets[wbs[0].sheetName];
  const rng = usedRange(ws);
  let sawSpecimen = false;
  for (let r = rng.s.r + 1; r <= rng.e.r; r++) if (cellAt(ws, r, 8) != null) sawSpecimen = true;
  assert.ok(sawSpecimen, 'Specimen no column populated in the workbook');
});

test('PII value guard — no patient/staff value from the raw CSV appears in any exported cell', { skip: SKIP }, () => {
  // Harvest the actual VALUES of every patient/staff column straight from the raw
  // CSV (names, national ids, MRNs, DOBs, and the staff full names in the
  // "… By" columns), then assert none of them appears in any exported cell.
  // This is value-based on purpose: a misnamed field carrying PII would slip past
  // the key-pattern guard in ingest.test.mjs but not past this.
  const raw = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data;
  const headers = Object.keys(raw[0] || {});
  const piiCols = headers.filter((h) => /patient|national|mrn|dob|birth|gender|by$|by /i.test(h.trim()));
  assert.ok(piiCols.length >= 5, `expected PII columns in the raw CSV, got: ${piiCols.join(' | ')}`);
  const piiValues = new Set();
  for (const r of raw) {
    for (const c of piiCols) {
      const v = String(r[c] ?? '').trim();
      if (v.length >= 3) piiValues.add(v); // len<3 (e.g. gender letters) can't be matched meaningfully
    }
  }
  assert.ok(piiValues.size > 0, 'harvested at least one PII value to guard against');

  const wbs = buildLateLabWorkbooks({ rows: load(), tatTests: {}, asOfMs, XLSX });
  assert.ok(wbs.length > 0);
  for (const w of wbs) {
    const ws = w.wb.Sheets[w.sheetName];
    const rng = usedRange(ws);
    for (let r = rng.s.r; r <= rng.e.r; r++) {
      for (let c = rng.s.c; c <= rng.e.c; c++) {
        const cell = cellAt(ws, r, c);
        if (cell == null) continue;
        for (const cand of [cell.v, cell.w]) {
          if (cand == null) continue;
          assert.ok(
            !piiValues.has(String(cand).trim()),
            `PII value leaked into "${w.lab}" at ${XLSX.utils.encode_cell({ r, c })}: ${String(cand).slice(0, 6)}…`,
          );
        }
      }
    }
  }
});
