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

// The new export returns raw XLSX bytes (a dependency-free styled writer replaced
// SheetJS on the WRITE path). SheetJS remains the PARSER: re-read the bytes to
// verify values/headers/autofilter/counts exactly as before. Plain read → empty
// styled cells are absent (undefined); styled read (cellStyles) → !cols is
// populated (SheetJS only parses <cols> when cellStyles is on).
const readWs = (w) => {
  const wb = XLSX.read(w.xlsxBytes, { type: 'array' });
  return wb.Sheets[wb.SheetNames[0]];
};
const readWsStyled = (w) => {
  const wb = XLSX.read(w.xlsxBytes, { type: 'array', cellStyles: true });
  return wb.Sheets[wb.SheetNames[0]];
};
const readSheetNames = (w) => XLSX.read(w.xlsxBytes, { type: 'array' }).SheetNames;

// Extract one entry's text from a STORE-method (uncompressed) ZIP by scanning
// local-file-header signatures (PK\x03\x04) — the styled writer never deflates,
// so each entry's bytes are the raw part contents. ~20 lines, no dependencies.
function unzipEntry(bytes, wantName) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let i = 0;
  while (i + 4 <= bytes.length && dv.getUint32(i, true) === 0x04034b50) {
    const method = dv.getUint16(i + 8, true);
    const size = dv.getUint32(i + 18, true);   // compressed size (== raw size for STORE)
    const nameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const nameStart = i + 30;
    const name = dec.decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    if (name === wantName) {
      assert.equal(method, 0, 'STORE method expected (no compression)');
      return dec.decode(bytes.subarray(dataStart, dataStart + size));
    }
    i = dataStart + size;
  }
  return null;
}

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

  const wbs = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs });
  assert.equal(wbs.length, 1, 'all rows share one facility ⇒ a single workbook');
  const w = wbs[0];
  assert.equal(w.lab, 'Synthetic Lab');
  assert.equal(w.late, 3, 'three LATE test LINES counted (order not collapsed to 1)');
  assert.equal(w.dueSoon, 1, 'one due-soon test line');
  assert.ok(w.xlsxBytes instanceof Uint8Array, 'workbook returned as raw bytes');
  assert.doesNotThrow(() => XLSX.read(w.xlsxBytes, { type: 'array' }), 'SheetJS re-reads the bytes');

  const ws = readWs(w);
  const rng = usedRange(ws);
  assert.equal(rng.e.r - rng.s.r, 4, 'four data rows = 3 late + 1 due-soon (per LINE, order never deduped)');

  // Order ID column (col 4): the SAME order (000501 → 501) appears on THREE rows.
  const orderIds = [];
  for (let r = rng.s.r + 1; r <= rng.e.r; r++) orderIds.push(cellAt(ws, r, 4)?.v);
  assert.equal(orderIds.filter((v) => v === 501).length, 3, 'one order contributes three rows');
  assert.equal(orderIds.filter((v) => v === 777).length, 1, 'the other order contributes one row');
});

test('reference styling — styles.xml + sheet1.xml reproduce the navy computed block', () => {
  // Synthetic rows (no CSV needed): one LATE row and one DUE-SOON row, with the
  // datetime/id columns populated so we can assert their per-column cell styles.
  const rows = [
    orderRow({
      orderId: '000501', lineNo: 1, testName: 'ALPHA TEST',
      orderDate: '2026-06-01', collected: '2026-06-01 07:30:00',
      dispatched: '2026-06-01 08:00:00', received: '2026-06-01 08:30:00',
      specimenNo: '9900000526', rawStatus: 'Received', tatDaysCsv: 1,
    }),
    orderRow({
      orderId: '000777', lineNo: 1, testName: 'DELTA TEST',
      received: '2026-07-09 09:00:00', tatDaysCsv: 0,
    }),
  ];
  const [w] = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs });
  const styles = unzipEntry(w.xlsxBytes, 'xl/styles.xml');
  const sheet = unzipEntry(w.xlsxBytes, 'xl/worksheets/sheet1.xml');
  assert.ok(styles && sheet, 'styles.xml and sheet1.xml present in the STORE zip');

  // styles.xml: navy fill, white-bold font, the three custom number formats.
  assert.ok(styles.includes('FF1F4E78'), 'navy fill fgColor FF1F4E78 present');
  assert.ok(styles.includes('bgColor rgb="FF003366"'), 'navy fill bgColor FF003366 present');
  assert.match(
    styles,
    /<b val="true"\/><sz val="11"\/><color rgb="FFFFFFFF"\/><name val="Aptos Narrow"\/>/,
    'white bold Aptos Narrow font present',
  );
  for (const id of ['165', '166', '167']) {
    assert.ok(styles.includes(`numFmtId="${id}"`), `numFmt ${id} present`);
  }
  assert.ok(styles.includes('formatCode="m/d/yyyy"'), 'numFmt 165 = m/d/yyyy');
  assert.ok(styles.includes('m/d/yyyy\\ h:mm'), 'numFmt 167 = datetime');

  // Header row: A1–N1 plain (s=1), O1–T1 navy (s=2).
  for (const col of ['A', 'B', 'H', 'N']) assert.ok(sheet.includes(`<c r="${col}1" s="1"`), `${col}1 header s=1`);
  for (const col of ['O', 'P', 'Q', 'R', 'S', 'T']) assert.ok(sheet.includes(`<c r="${col}1" s="2"`), `${col}1 navy header s=2`);

  // Data row 2: A date xf (3); E numeric int xf (5); J/M datetime xf (7);
  // O,P,S,T navy general (8); Q navy date (9); R navy int (10).
  assert.ok(sheet.includes('<c r="A2" s="3">'), 'A2 date xf');
  assert.match(sheet, /<c r="E2" s="5"><v>501<\/v><\/c>/, 'E2 numeric Order ID, int xf');
  assert.ok(sheet.includes('<c r="J2" s="7">'), 'J2 datetime xf');
  assert.ok(sheet.includes('<c r="M2" s="7">'), 'M2 datetime xf');
  for (const col of ['O', 'P', 'S', 'T']) assert.ok(sheet.includes(`<c r="${col}2" s="8"`), `${col}2 navy general xf`);
  assert.ok(sheet.includes('<c r="Q2" s="9">'), 'Q2 navy date xf');
  assert.ok(sheet.includes('<c r="R2" s="10">'), 'R2 navy int xf');

  // Empty cells still carry their column style (reference behaviour): N is empty
  // by scope but keeps the datetime column style (s=7), self-closing (no <v>).
  assert.match(sheet, /<c r="N2" s="7"\/>/, 'empty N2 keeps its column style');

  // autoFilter over the used range; 20 custom-width columns with the ref widths.
  assert.ok(sheet.includes('<autoFilter ref="A1:T3"/>'), 'autofilter spans used range');
  assert.ok(sheet.includes('<col min="1" max="1" width="17.5" customWidth="true"/>'), 'col A ref width');
  assert.ok(sheet.includes('<col min="8" max="8" width="55" customWidth="true"/>'), 'col H ref width');

  // Inline strings (no sharedStrings part) carry the unicode flag verbatim.
  assert.ok(unzipEntry(w.xlsxBytes, 'xl/sharedStrings.xml') === null, 'no sharedStrings part (inline strings)');
  assert.ok(sheet.includes('⚠ DUE ≤24H'), 'due-soon flag written inline');
});

test('per-lab counts + which labs qualify (deterministic, CSV-fallback TAT)', { skip: SKIP }, () => {
  const wbs = buildLateLabWorkbooks({ rows: load(), tatTests: {}, asOfMs });
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
  const wbs = buildLateLabWorkbooks({ rows: load(), tatTests: {}, asOfMs });
  assert.equal(LATE_LAB_HEADERS.length, 20);
  for (const w of wbs) {
    const ws = readWs(w);
    const rng = usedRange(ws);
    const hdr = [];
    for (let c = rng.s.c; c <= rng.e.c; c++) hdr.push(cellAt(ws, 0, c)?.v ?? null);
    assert.deepEqual(hdr, [...LATE_LAB_HEADERS], `headers for ${w.lab}`);
  }
});

test('sheet name = lab (sanitized ≤31); autofilter + ref span the used range; !cols present', { skip: SKIP }, () => {
  const wbs = buildLateLabWorkbooks({ rows: load(), tatTests: {}, asOfMs });
  for (const w of wbs) {
    const names = readSheetNames(w);
    assert.equal(names.length, 1);
    assert.equal(names[0], labSheetName(w.lab), 'sheet named the (sanitized) lab');
    assert.equal(w.sheetName, labSheetName(w.lab), 'entry sheetName is the sanitized lab');
    assert.ok(w.sheetName.length <= 31, 'sheet name ≤ 31 chars');
    const ws = readWs(w);
    const nRows = w.late + w.dueSoon; // data rows
    const expectRef = `A1:T${nRows + 1}`; // header + data, 20 cols (A..T)
    assert.equal(ws['!ref'], expectRef, `!ref for ${w.lab}`);
    assert.deepEqual(ws['!autofilter'], { ref: expectRef }, `autofilter for ${w.lab}`);
    // !cols only surfaces when SheetJS parses styles (cellStyles); it round-trips
    // the reference widths to their char-width (wch) equivalents.
    const wsStyled = readWsStyled(w);
    assert.ok(Array.isArray(wsStyled['!cols']) && wsStyled['!cols'].length === 20, '!cols has 20 entries');
    assert.ok(wsStyled['!cols'].every((c) => typeof c.wch === 'number'), 'every col has a wch width');
  }
});

test('every included row is in scope (received && !resulted, not cancelled/rejected) and obeys the Status/flag rules', { skip: SKIP }, () => {
  const rows = load();
  const wbs = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs });
  const expected = independentInclude(rows);

  for (const w of wbs) {
    const ws = readWs(w);
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
  const wbs = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs });
  const w = wbs.find((x) => x.lab === 'Advanced Laboratory Services .Co');
  const ws = readWs(w);
  assert.equal(cellAt(ws, 1, 17).v, delay, 'Delay cell equals the hand-computed delay');
  assert.equal(cellAt(ws, 1, 18).v, delay > 0 ? 'Late' : 'On Time', 'Status matches delay sign');
  // Due Date cell is the Excel serial of dueMs (integer day).
  const serial = dueMs / 86400000 + 25569;
  assert.equal(cellAt(ws, 1, 16).v, serial, 'Due Date serial matches workday(received, tat)');
});

test('deterministic, correct file names — same output across runs', { skip: SKIP }, () => {
  const rows = load();
  const a = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs });
  const b = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs });
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
  const wbs = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs });
  const ws = readWs(wbs[0]);
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

  const wbs = buildLateLabWorkbooks({ rows: load(), tatTests: {}, asOfMs });
  assert.ok(wbs.length > 0);
  for (const w of wbs) {
    const ws = readWs(w);
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
