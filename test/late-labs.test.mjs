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
    // RE-IMPLEMENTED under Talal's 2026-08-05 rules:
    //   LATE = due TODAY or overdue -> `delay >= 0` (was `delay > 0`).
    //   DUE-SOON = not late AND due on the NEXT BUSINESS DAY. Expressed in
    //   BUSINESS terms, not `delay === -1`: because due dates come out of
    //   workday(), the next calendar day may be Friday or Saturday, in which case
    //   the next due-able day is Sunday and delay is −3, not −1. Comparing
    //   `dueMs === workday(asOfDay, 1)` is the only formulation that survives the
    //   weekend flip.
    const late = delay >= 0;
    const dueSoon = !late && dueMs === workday(asOfDay, 1);
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

// Column index BY HEADER NAME, never a bare number. The sheet gained a column
// mid-row in 2026-09 (DOB, after 'Specimen no') and every hardcoded index after it
// silently pointed one column to the LEFT of what it meant. A named lookup keeps
// each assertion on the column it is about, whatever is inserted later.
const col = (name) => {
  const i = LATE_LAB_HEADERS.indexOf(name);
  assert.ok(i >= 0, `no export column named '${name}'`);
  return i;
};
/** The same column as its A1 letter(s), for assertions against raw sheet XML. */
const colLetterOf = (name) => XLSX.utils.encode_col(col(name));
/** The last column's letter — the right edge of !ref and the autofilter. */
const LAST_COL = XLSX.utils.encode_col(LATE_LAB_HEADERS.length - 1);

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
    // A DIFFERENT order with a single line that is DUE-SOON. RE-BASELINED
    // 2026-08-05: this used to be "due on the asOf day (delay 0)", which is now
    // LATE, not due-soon. asOf is Thu 2026-07-09, so the next BUSINESS day is Sun
    // 2026-07-12 (Fri+Sat are the weekend) — received on the asOf day with a
    // 1-business-day TAT lands exactly there.
    orderRow({ orderId: '000777', lineNo: 1, testName: 'DELTA TEST', received: '2026-07-09 09:00:00', tatDaysCsv: 1 }),
    // …and one line due EXACTLY on the asOf day with no result: under the new
    // rule that is LATE (under 24h of TAT left, nothing to show), not 'On Time'
    // with a ⚠ flag. This is the boundary, pinned in the export surface too.
    orderRow({ orderId: '000888', lineNo: 1, testName: 'EPSILON TEST', received: '2026-07-09 09:00:00', tatDaysCsv: 0 }),
  ];

  const wbs = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs });
  assert.equal(wbs.length, 1, 'all rows share one facility ⇒ a single workbook');
  const w = wbs[0];
  assert.equal(w.lab, 'Synthetic Lab');
  assert.equal(w.late, 4, 'four LATE test LINES counted (order not collapsed to 1) — 3 overdue + 1 due TODAY');
  assert.equal(w.dueSoon, 1, 'one due-soon test line (due on the NEXT BUSINESS day, Sun 07-12)');
  assert.ok(w.xlsxBytes instanceof Uint8Array, 'workbook returned as raw bytes');
  assert.doesNotThrow(() => XLSX.read(w.xlsxBytes, { type: 'array' }), 'SheetJS re-reads the bytes');

  const ws = readWs(w);
  const rng = usedRange(ws);
  assert.equal(rng.e.r - rng.s.r, 5, 'five data rows = 4 late + 1 due-soon (per LINE, order never deduped)');

  // Order ID column (col 4): the SAME order (000501 → 501) appears on THREE rows.
  const orderIds = [];
  for (let r = rng.s.r + 1; r <= rng.e.r; r++) orderIds.push(cellAt(ws, r, col('Order ID'))?.v);
  assert.equal(orderIds.filter((v) => v === 501).length, 3, 'one order contributes three rows');
  assert.equal(orderIds.filter((v) => v === 777).length, 1, 'the due-soon order contributes one row');
  assert.equal(orderIds.filter((v) => v === 888).length, 1, 'the due-TODAY order contributes one row');

  // The boundary, read straight out of the sheet: the due-TODAY line is 'Late'
  // with delay 0 and NO ⚠ flag; the next-business-day line is 'On Time' + ⚠.
  const rowOf = (id) => {
    for (let r = rng.s.r + 1; r <= rng.e.r; r++) if (cellAt(ws, r, col('Order ID'))?.v === id) return r;
    return -1;
  };
  const dueToday = rowOf(888);
  assert.equal(cellAt(ws, dueToday, col('Delay (days)')).v, 0, 'due TODAY ⇒ delay 0');
  assert.equal(cellAt(ws, dueToday, col('Status')).v, 'Late', 'delay 0 with no result is LATE (2026-08-05 rule)');
  assert.equal(cellAt(ws, dueToday, col('Late Risk (next 24h)'))?.v ?? '', '', 'a LATE row never carries the ⚠ due-soon flag');
  const dueNext = rowOf(777);
  assert.equal(cellAt(ws, dueNext, col('Status')).v, 'On Time', 'due on the next business day is not late yet');
  assert.equal(cellAt(ws, dueNext, col('Late Risk (next 24h)')).v, '⚠ DUE ≤24H', 'and it is the row that carries the flag');
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
      dob: '1985-03-12 00:00:00', // SYNTHETIC — no real patient; shape as the CSV writes it
    }),
    // RE-BASELINED 2026-08-05: tatDaysCsv was 0 (due ON the asOf day), which now
    // classifies as LATE and therefore carries NO ⚠ flag — the flag assertion at
    // the end of this test needs a genuinely due-soon row. asOf is Thu 07-09, so
    // 1 business day out is Sun 07-12 (Fri+Sat off) = the next business day.
    orderRow({
      orderId: '000777', lineNo: 1, testName: 'DELTA TEST',
      received: '2026-07-09 09:00:00', tatDaysCsv: 1,
    }),
  ];
  const [w] = buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs });
  assert.deepEqual({ late: w.late, dueSoon: w.dueSoon }, { late: 1, dueSoon: 1 }, 'one of each, so both style paths are exercised');
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

  // Every cell below is located BY HEADER NAME. DOB was inserted at J in 2026-09 and
  // moved every letter after it; the old letter-based checks did not all FAIL on
  // that — M2 kept passing, because a different datetime column had slid into M.
  // A check that survives a layout change by coincidence is not checking anything.
  const at = (h, row) => `<c r="${colLetterOf(h)}${row}"`;

  // Header row: the SOURCE-DATA block A..O is plain (s=1) — DOB included — and the
  // six COMPUTED columns P..U are navy (s=2).
  const NAVY = ['Order Status', 'Standard TAT (business days)', 'Due Date',
    'Delay (days)', 'Status', 'Late Risk (next 24h)'];
  for (const h of ['Order date time', 'Ordering facility ID', 'Test name', 'DOB', 'Result report date time']) {
    assert.ok(sheet.includes(`${at(h, 1)} s="1"`), `${h}: plain header s=1`);
  }
  for (const h of NAVY) assert.ok(sheet.includes(`${at(h, 1)} s="2"`), `${h}: navy header s=2`);
  // …and the navy block is still exactly those six, contiguous, closing the row.
  assert.deepEqual(NAVY.map(col), [15, 16, 17, 18, 19, 20], 'navy block = the last six columns');

  // Data row 2: date xf (3) on Order date; numeric int xf (5) on Order ID; datetime
  // xf (7) on the collected/received stamps; navy general (8) on the four computed
  // text/number columns; navy date (9) on Due Date; navy int (10) on Delay.
  assert.ok(sheet.includes(`${at('Order date time', 2)} s="3">`), 'Order date: date xf');
  assert.match(sheet, new RegExp(`${at('Order ID', 2)} s="5"><v>501</v></c>`), 'numeric Order ID, int xf');
  assert.ok(sheet.includes(`${at('Specimen collected date time', 2)} s="7">`), 'collected: datetime xf');
  assert.ok(sheet.includes(`${at('Received date time', 2)} s="7">`), 'received: datetime xf');
  for (const h of ['Order Status', 'Standard TAT (business days)', 'Status', 'Late Risk (next 24h)']) {
    assert.ok(sheet.includes(`${at(h, 2)} s="8"`), `${h}: navy general xf`);
  }
  assert.ok(sheet.includes(`${at('Due Date', 2)} s="9">`), 'Due Date: navy date xf');
  assert.ok(sheet.includes(`${at('Delay (days)', 2)} s="10">`), 'Delay: navy int xf');
  // DOB is a REAL Excel date in the plain date style — not text a lab cannot sort or
  // filter. The fixture's synthetic 1985-03-12 is serial 31118, derived by hand:
  // 1985-01-01 is 31048, then + 31 (Jan) + 28 (Feb) + 11 = 31118.
  assert.ok(sheet.includes(`${at('DOB', 2)} s="3"><v>31118</v>`), 'DOB: real date serial, date xf');

  // Empty cells still carry their column style (reference behaviour): Result report
  // is empty by scope but keeps the datetime column style (s=7), self-closing (no <v>).
  assert.ok(sheet.includes(`${at('Result report date time', 2)} s="7"/>`),
    'empty Result report cell keeps its column style');

  // autoFilter over the used range; custom-width columns with the ref widths.
  assert.ok(sheet.includes(`<autoFilter ref="A1:${LAST_COL}3"/>`), 'autofilter spans used range');
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
  // RE-BASELINED 2026-08-05, re-derived by RUNNING the real module on the sample
  // CSV at asOf 2026-07-09 (a Thursday). Advanced: late 38 → 41, dueSoon 9 → 6.
  //   • The weekend flip alone was measured at dueSoon 9 → 3: with Fri+Sat off,
  //     the "next business day" after Thursday is SUNDAY, so the set of rows due
  //     on it is a different (smaller) set than the old Friday one.
  //   • The late boundary (due today ⇒ late) then moves 3 rows that were due
  //     EXACTLY on 07-09 out of dueSoon and into late: 38 + 3 = 41, and the
  //     dueSoon side lands at 6 rather than 3 because the Sunday due-date set
  //     picked up rows the Friday one did not.
  //   • Included rows total 47 either way (38+9 = 41+6): the union of "late or
  //     due-soon" is unchanged here, only the split between the two columns moved.
  // The other two labs are unaffected (1 late, 0 due-soon each).
  assert.deepEqual(byLab['Advanced Laboratory Services .Co'], { late: 41, dueSoon: 6 });
  assert.deepEqual(byLab['Fal Specialized Medical Lab'], { late: 1, dueSoon: 0 });
  assert.deepEqual(byLab['Saudi Diagnostics Limited Company'], { late: 1, dueSoon: 0 });
  // Labs present in the data but with no qualifying rows must NOT get a file.
  for (const absent of ['Eurofins clinical', 'king Abdullaziz Medical city in Riyadh', 'Anwa Medical Company', '']) {
    assert.ok(!(absent in byLab), `lab must be absent: ${JSON.stringify(absent)}`);
  }
});

test('header row is exactly the 21 verbatim strings (the reference 20 + DOB)', { skip: SKIP }, () => {
  const wbs = buildLateLabWorkbooks({ rows: load(), tatTests: {}, asOfMs });
  assert.equal(LATE_LAB_HEADERS.length, 21);
  // DOB sits directly after 'Specimen no' — the pair a lab checks together.
  assert.equal(col('DOB'), col('Specimen no') + 1, 'DOB follows Specimen no');
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
    const expectRef = `A1:${LAST_COL}${nRows + 1}`; // header + data, all columns
    assert.equal(ws['!ref'], expectRef, `!ref for ${w.lab}`);
    assert.deepEqual(ws['!autofilter'], { ref: expectRef }, `autofilter for ${w.lab}`);
    // !cols only surfaces when SheetJS parses styles (cellStyles); it round-trips
    // the reference widths to their char-width (wch) equivalents.
    const wsStyled = readWsStyled(w);
    // One width per column, whatever the column count — pinned to the header list,
    // not a number (this was '=== 20' and outlived the DOB column by a test run).
    assert.ok(Array.isArray(wsStyled['!cols']) && wsStyled['!cols'].length === LATE_LAB_HEADERS.length,
      `!cols has one entry per column (${LATE_LAB_HEADERS.length})`);
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
      const status = cellAt(ws, r, col('Status'))?.v;
      const delay = cellAt(ws, r, col('Delay (days)'))?.v; // a number
      const risk = cellAt(ws, r, col('Late Risk (next 24h)'))?.v ?? '';
      const resultCell = cellAt(ws, r, col('Result report date time')); // must be empty
      assert.equal(resultCell, undefined, 'no result-report cell (scope: not yet resulted)');
      assert.equal(typeof delay, 'number', 'Delay written as a number');
      if (status === 'Late') {
        // RE-BASELINED 2026-08-05: `>= 0`, not `> 0` — due TODAY is late.
        assert.ok(delay >= 0, 'Late ⇒ delay >= 0 (due today or overdue)');
        assert.equal(risk, '', 'Late rows carry no due-soon flag');
        lateSeen += 1;
      } else {
        assert.equal(status, 'On Time', 'non-Late status is "On Time"');
        // The flag means "due on the NEXT BUSINESS DAY", so delay is −1 on a
        // normal midweek day but −3 when asOf is a Thursday (next business day is
        // Sunday). The invariant that survives the Fri+Sat weekend is
        // `due === workday(asOf, 1)`, which is what the module actually tests.
        // due day reconstructed from the Delay cell: delay = asOfDay − due.
        const dueDay = toEpochDay(asOfMs) - delay * 86400000;
        assert.equal(dueDay, workday(toEpochDay(asOfMs), 1), 'due-soon ⇒ due on the NEXT BUSINESS day');
        assert.ok(delay < 0, 'due-soon ⇒ not yet due');
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
  assert.equal(cellAt(ws, 1, col('Delay (days)')).v, delay, 'Delay cell equals the hand-computed delay');
  assert.equal(cellAt(ws, 1, col('Status')).v, delay > 0 ? 'Late' : 'On Time', 'Status matches delay sign');
  // Due Date cell is the Excel serial of dueMs (integer day).
  const serial = dueMs / 86400000 + 25569;
  assert.equal(cellAt(ws, 1, col('Due Date')).v, serial, 'Due Date serial matches workday(received, tat)');
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
  for (let r = rng.s.r + 1; r <= rng.e.r; r++) if (cellAt(ws, r, col('Specimen no')) != null) sawSpecimen = true;
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
  // DOB is EXPORTED ON PURPOSE since 2026-09-28 (its own tests below pin it), so it
  // is the ONE patient column not harvested here — excluded by its EXACT header,
  // matching the exact-key exception in ingest.test.mjs. Anything else DOB-ish, and
  // every other patient/staff column, is still a leak.
  // Without this exclusion the guard would not have FAILED — it would have kept
  // passing by accident: it compares the raw text '1985-03-12 00:00:00' against the
  // re-read cell, which is a date serial / 'm/d/yyyy', and the two never match. A
  // guard that passes for the wrong reason is worse than none, so it is explicit.
  const EXPORTED_ON_PURPOSE = new Set(['DOB']);
  const piiCols = headers.filter((h) => !EXPORTED_ON_PURPOSE.has(h.trim())
    && /patient|national|mrn|dob|birth|gender|by$|by /i.test(h.trim()));
  assert.ok(piiCols.length >= 5, `expected PII columns in the raw CSV, got: ${piiCols.join(' | ')}`);
  // The exemption must not have cost the guard its teeth on the fields that matter.
  for (const must of ['Patient Name', 'National Id', 'MRN ID', 'Gender']) {
    assert.ok(piiCols.includes(must), `the leak guard must still cover '${must}'`);
  }
  assert.ok(!piiCols.includes('DOB'), 'DOB is exported on purpose and is not guarded as a leak');
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

// ── DOB (user request 2026-09-28) ──────────────────────────────────────────────
// The one patient field the export carries. Everything below compares DOBs as Excel
// SERIALS and reports failures by ORDER LINE, never by birthdate: an assertion
// message is printed on failure, and a real patient's DOB must not land in a log.
const dobSerial = (dob) => {
  const ms = toEpochDay(parseDateTime(dob));
  return ms == null ? null : ms / 86400000 + 25569;
};
/** Every exported data row as { key: 'orderId:lineNo', dob: <DOB cell> }, all labs. */
function exportedDobs(wbs) {
  const out = [];
  for (const w of wbs) {
    const ws = readWs(w);
    const rng = usedRange(ws);
    for (let r = rng.s.r + 1; r <= rng.e.r; r++) {
      out.push({
        key: String(cellAt(ws, r, col('Order line number'))?.v),
        dob: cellAt(ws, r, col('DOB')),
      });
    }
  }
  return out;
}

test('DOB: every exported row carries ITS OWN patient\'s birthdate, as a real date', { skip: SKIP }, () => {
  // Not merely "the column is populated": each row is matched back to the exact CSV
  // line it came from (Order line number = orderId:lineNo, unique per line) and its
  // DOB checked against THAT line's. A shifted or mis-joined column would put a
  // real birthdate on the wrong patient's specimen — the failure that matters.
  const rows = load();
  const want = new Map(rows.map((r) => [`${r.orderId}:${r.lineNo}`, r.dob]));
  const got = exportedDobs(buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs }));
  assert.ok(got.length > 0, 'the sample produces exported rows to check');
  for (const { key, dob } of got) {
    assert.ok(want.has(key), `exported line ${key} maps back to a CSV line`);
    const expected = dobSerial(want.get(key));
    assert.ok(expected != null, `CSV line ${key} has a parseable DOB`);
    assert.ok(dob, `line ${key}: DOB cell present`);
    assert.equal(dob.t, 'n', `line ${key}: DOB is a date serial, not text`);
    assert.equal(dob.v, expected, `line ${key}: DOB is that line's own birthdate`);
  }
});

test('DOB: rows WITHOUT one (the automated path) export an empty DOB column and change nothing else', { skip: SKIP }, () => {
  // The live pull (ingest/grafana.js) deliberately never carries DOB, so its lab
  // files must come out with the column present but empty — and DOB must affect
  // ONLY its own column: every other cell is byte-for-byte what it would be anyway.
  const withDob = load();
  const withoutDob = withDob.map(({ dob, ...rest }) => rest);
  const a = buildLateLabWorkbooks({ rows: withDob, tatTests: {}, asOfMs });
  const b = buildLateLabWorkbooks({ rows: withoutDob, tatTests: {}, asOfMs });
  assert.deepEqual(b.map((w) => [w.lab, w.late, w.dueSoon]), a.map((w) => [w.lab, w.late, w.dueSoon]),
    'DOB changes neither which labs get a file nor their counts');
  for (const { key, dob } of exportedDobs(b)) {
    assert.ok(dob == null || dob.v === '' || dob.v == null, `line ${key}: no DOB on the automated path`);
  }
  const dobCol = col('DOB');
  for (let i = 0; i < a.length; i++) {
    const wa = readWs(a[i]); const wb = readWs(b[i]);
    const rng = usedRange(wa);
    for (let r = rng.s.r; r <= rng.e.r; r++) {
      for (let c = rng.s.c; c <= rng.e.c; c++) {
        if (c === dobCol) continue;
        assert.deepEqual(cellAt(wb, r, c)?.v, cellAt(wa, r, c)?.v,
          `${a[i].lab} ${XLSX.utils.encode_cell({ r, c })}: only the DOB column may differ`);
      }
    }
  }
});

test('DOB: an unparseable value is written as TEXT, never silently blanked', { skip: SKIP }, () => {
  // Every DOB in the CSV so far parses — but a lab working from this file must never
  // be handed an empty birthdate for a patient who has one, so a format change falls
  // back to the raw text rather than to nothing.
  const rows = load().map((r) => ({ ...r, dob: 'NOT-A-DATE' }));
  const got = exportedDobs(buildLateLabWorkbooks({ rows, tatTests: {}, asOfMs }));
  assert.ok(got.length > 0);
  for (const { key, dob } of got) {
    assert.ok(dob, `line ${key}: DOB cell present`);
    assert.equal(dob.t, 's', `line ${key}: falls back to text`);
    assert.equal(dob.v, 'NOT-A-DATE', `line ${key}: the raw value, untouched`);
  }
});
