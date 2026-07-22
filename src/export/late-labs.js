// export/late-labs.js — build one Excel workbook PER performing lab of the tests
// that are LATE vs their standard TAT or DUE within the next 24h. The output
// format exactly reproduces the reference file the team already emails to labs
// (single sheet named the lab; autofilter over the used range; custom column
// widths; 20 verbatim headers — the 'Lonic code' typo is the established format).
//
// PURE module: no DOM, no vendor imports, no Date.now(). SheetJS (XLSX) and the
// as-of instant are injected so the browser and `node --test` share one code path
// and results are deterministic. Method mirrors src/engine/engine.js exactly:
//   • Scope   = rows with a Received datetime and NO result yet, excluding
//               cancelled ('Order Cancelled') / rejected ('Result Rejected'), and
//               excluding rows with no resolvable StdTAT (engine's 'No Match').
//   • StdTAT  = TAT lookup by test name, else CSV "TAT - Days" fallback (resolveTat).
//   • dueMs   = workday(receivedMs, stdTat)   (business days, Sat–Sun weekend).
//   • delay   = dayDiff(asOfDay, dueMs)        (whole calendar days, asOf − due).
//   • Status  = delay > 0 → 'Late', else 'On Time'.
//   • Late Risk (next 24h) = '⚠ DUE ≤24H' when NOT late and −1 ≤ delay ≤ 0; else ''.
//   • A row is INCLUDED when Late OR flagged due-soon; a lab gets a file only if
//     it has ≥1 included row.
//   • GRAIN = per test LINE (order line): counts (late/dueSoon) and data rows are
//     NEVER deduplicated by order — one order with 3 qualifying tests contributes
//     3 rows and counts as 3, not 1.
import { buildTatIndex, resolveTat } from '../engine/tat.js?v=v2026-07-22.10';
import {
  parseDateTime, toEpochDay, workday, dayDiff,
} from '../engine/workday.js?v=v2026-07-22.10';
import { writeStyledXlsx } from './xlsx-styled.js?v=v2026-07-22.10';

/** The 20 export columns, VERBATIM (keep the 'Lonic code' typo — established format). */
export const LATE_LAB_HEADERS = Object.freeze([
  'Order date time',
  'Ordering facility ID',
  'Performing facility id',
  'Performing facility name',
  'Order ID',
  'Order line number',
  'Lonic code',
  'Test name',
  'Specimen no',
  'Specimen collected date time',
  'Shipment ID',
  'Dispatch date time',
  'Received date time',
  'Result report date time',
  'Order Status',
  'Standard TAT (business days)',
  'Due Date',
  'Delay (days)',
  'Status',
  'Late Risk (next 24h)',
]);

// Column widths — the EXACT <col width="…"> values from the reference sheet1.xml
// (20 columns). These are raw OOXML width units (as LibreOffice wrote them); when
// re-read by SheetJS they yield the wch char-widths the prior export used
// (17.5 → 16.67, etc.), so the columns render identically to the reference.
const COL_WIDTH = Object.freeze([
  17.5, 22.5, 24.51, 26.5, 14.51, 19.51, 12.5, 55, 13.5, 30.51,
  13.5, 20.51, 20.51, 25.51, 27.5, 30.51, 10.51, 14.51, 9, 22.5,
]);

const DUE_SOON_FLAG = '⚠ DUE ≤24H';

// Per-column DATA cell style indices (into xlsx-styled.js cellXfs), replicating the
// reference workbook's per-column map A..T. See xlsx-styled.js for what each means.
//   3 date · 4 general · 5 int · 6 test-name(wrap/top) · 7 datetime
//   8 navy general · 9 navy date · 10 navy int
const DATA_STYLE = Object.freeze([
  3, 4, 4, 4, 5, 4, 4, 6, 4, 7, 7, 7, 7, 7, 8, 8, 9, 10, 8, 8,
]);
// Header row styles: A..N = 1 (plain body font, no fill); O..T = 2 (navy header).
const HEADER_STYLE = Object.freeze([
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2,
]);
const EMPTY = Object.freeze({ t: 'empty' });

/**
 * Typed cells for the writer. d/dt carry epoch-ms (converted to Excel serials by
 * xlsx-styled.js); s (string) / n (number) carry the literal value; empty cells
 * are still emitted so they keep their column style — matching the reference.
 */
/** Date-only cell from a 'YYYY-MM-DD[ HH:MM]' string (INT applied by the writer). */
function dateCell(str) {
  const ms = parseDateTime(str);
  return ms == null ? EMPTY : { t: 'd', v: ms };
}
/** Full-datetime cell from a datetime string (fractional serial, time preserved). */
function dtCell(str) {
  const ms = parseDateTime(str);
  return ms == null ? EMPTY : { t: 'dt', v: ms };
}
/** Date-only cell straight from a midnight epoch-ms (Due Date). */
function dueCell(ms) {
  return ms == null ? EMPTY : { t: 'd', v: ms };
}
/** A string cell, or an (empty-but-styled) cell for null/''. */
function strCell(v) {
  if (v == null) return EMPTY;
  const s = String(v);
  return s === '' ? EMPTY : { t: 's', v: s };
}
/** A number cell. */
function numCell(v) {
  return { t: 'n', v };
}
/**
 * An identifier cell. Reference stores these as numbers (leading zeros dropped by
 * Excel) when purely numeric; fall back to a string for non-numeric or oversized
 * ids (>15 digits would lose precision as an IEEE double).
 * @param {*} v
 */
function idCell(v) {
  if (v == null) return EMPTY;
  const s = String(v);
  if (s === '') return EMPTY;
  if (/^\d+$/.test(s) && s.length <= 15) return { t: 'n', v: Number(s) };
  return { t: 's', v: s };
}

/**
 * Excel sheet names cannot exceed 31 chars or contain []:*?/\ — sanitize while
 * staying as close to the lab name as possible. The full lab name is still used
 * for the 'Performing facility name' column and the file name.
 * @param {string} lab @returns {string}
 */
export function labSheetName(lab) {
  let s = String(lab == null ? '' : lab).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > 31) s = s.slice(0, 31).trim();
  return s || 'Sheet1';
}

/** File name for a lab's workbook — full (un-truncated) lab name. */
export function labFileName(lab) {
  return `${lab} - TAT Late & Due.xlsx`;
}

/**
 * Classify one OrderRow against asOf. Returns null when the row is out of scope
 * (no receipt / already resulted / cancelled / rejected / no StdTAT) or neither
 * late nor due-soon. Otherwise returns the derived fields + the 20-cell array.
 */
function classifyRow(row, tatIndex, asOfDay, opts) {
  const cancelled = row.rawStatus === 'Order Cancelled';
  const rejected = row.rawStatus === 'Result Rejected';
  if (cancelled || rejected) return null;

  const receivedMs = parseDateTime(row.received);
  if (receivedMs == null) return null;            // not received yet → out of scope
  const resultedMs = parseDateTime(row.resulted);
  if (resultedMs != null) return null;            // already resulted → out of scope

  const { tat } = resolveTat(row, tatIndex, opts);
  if (tat == null) return null;                   // 'No Match' → cannot compute a due date

  const dueMs = workday(receivedMs, tat);
  const delay = dayDiff(asOfDay, dueMs);          // whole calendar days: asOf − due
  const late = delay > 0;
  const dueSoon = !late && delay >= -1 && delay <= 0;
  if (!late && !dueSoon) return null;             // neither late nor due-soon → excluded

  const status = late ? 'Late' : 'On Time';
  const risk = dueSoon ? DUE_SOON_FLAG : '';

  const cells = [
    dateCell(row.orderDate),                                   // 0  A Order date time
    idCell(row.orderingFacilityId),                            // 1  B Ordering facility ID
    idCell(row.performingFacilityId),                          // 2  C Performing facility id
    strCell(row.facility),                                     // 3  D Performing facility name
    idCell(row.orderId),                                       // 4  E Order ID (number, fmt 0)
    strCell(`${row.orderId}:${row.lineNo}`),                   // 5  F Order line number
    strCell(row.loinc),                                        // 6  G Lonic code
    strCell(row.testName),                                     // 7  H Test name
    idCell(row.specimenNo),                                    // 8  I Specimen no
    dtCell(row.collected),                                     // 9  J Specimen collected date time
    strCell(row.shipmentId),                                   // 10 K Shipment ID (string, datetime col style)
    dtCell(row.dispatched),                                    // 11 L Dispatch date time
    dtCell(row.received),                                      // 12 M Received date time
    EMPTY,                                                     // 13 N Result report date time (empty by scope)
    strCell(row.rawStatus),                                    // 14 O Order Status
    numCell(tat),                                              // 15 P Standard TAT (business days)
    dueCell(dueMs),                                            // 16 Q Due Date
    numCell(delay),                                            // 17 R Delay (days)
    strCell(status),                                           // 18 S Status
    risk ? { t: 's', v: risk } : EMPTY,                        // 19 T Late Risk (next 24h)
  ];

  return { late, dueSoon, cells };
}

const COL_A = 'A'.charCodeAt(0);
/** 0-based column index → A1 column letters (A..T only needs a single letter). */
function colLetter(c) {
  let n = c;
  let s = '';
  do {
    s = String.fromCharCode(COL_A + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * Build the styled XLSX bytes for one lab from the pre-built 20-cell data rows.
 * Every cell (header + data, including empties) carries its per-column style so
 * the workbook reproduces the reference formatting exactly.
 */
function buildXlsxBytes(sheetName, dataRows) {
  const nCols = LATE_LAB_HEADERS.length;
  const headerCells = LATE_LAB_HEADERS.map((h, c) => ({ t: 's', v: h, s: HEADER_STYLE[c] }));
  const styledRows = dataRows.map((cells) => cells.map((cell, c) => ({ ...cell, s: DATA_STYLE[c] })));
  const autofilterRef = `A1:${colLetter(nCols - 1)}${dataRows.length + 1}`;
  return writeStyledXlsx({
    sheetName,
    headerCells,
    dataRows: styledRows,
    colWidths: COL_WIDTH,
    autofilterRef,
  });
}

/**
 * Build one "Late & Due" workbook per performing lab.
 * @param {Object} args
 * @param {import('../contracts.js').OrderRow[]} args.rows
 * @param {Object<string,number>} [args.tatTests]  test name → business days (TAT lookup)
 * @param {number} args.asOfMs                     the report/as-of instant (epoch-ms; injected)
 * @param {{tatFallbackFromCsv?:boolean}} [args.opts]  passed to resolveTat (fallback ON by default)
 * @returns {{lab:string, sheetName:string, fileName:string, late:number, dueSoon:number, xlsxBytes:Uint8Array}[]}
 *   one entry per lab with ≥1 included row, sorted by total desc then lab name asc.
 *
 * NOTE: the workbook bytes are produced by the dependency-free styled writer
 * (src/export/xlsx-styled.js) — SheetJS is NOT used on the write path (it drops
 * cell styling). SheetJS remains only as a PARSER elsewhere (ingest, tests).
 */
export function buildLateLabWorkbooks({
  rows, tatTests, asOfMs, opts = {},
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  if (asOfMs == null || !Number.isFinite(Number(asOfMs))) {
    throw new Error('buildLateLabWorkbooks: asOfMs (epoch-ms) is required');
  }
  const asOfDay = toEpochDay(Number(asOfMs));
  const tatIndex = buildTatIndex(tatTests);

  // Group included rows by lab (skip rows with no lab name — they cannot key a file).
  const byLab = new Map();
  for (const row of rows) {
    const c = classifyRow(row, tatIndex, asOfDay, opts);
    if (!c) continue;
    const lab = row.facility;
    if (lab == null || String(lab).trim() === '') continue;
    if (!byLab.has(lab)) byLab.set(lab, { late: 0, dueSoon: 0, dataRows: [] });
    const g = byLab.get(lab);
    if (c.late) g.late += 1; else g.dueSoon += 1;
    g.dataRows.push(c.cells);
  }

  const out = [];
  for (const [lab, g] of byLab) {
    const sheetName = labSheetName(lab);
    const xlsxBytes = buildXlsxBytes(sheetName, g.dataRows);
    out.push({
      lab, sheetName, fileName: labFileName(lab), late: g.late, dueSoon: g.dueSoon, xlsxBytes,
    });
  }
  // Deterministic order: worst (largest total) first, ties broken by lab name.
  out.sort((a, b) => (b.late + b.dueSoon) - (a.late + a.dueSoon) || a.lab.localeCompare(b.lab));
  return out;
}

export default buildLateLabWorkbooks;
