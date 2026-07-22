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
import { buildTatIndex, resolveTat } from '../engine/tat.js?v=v2026-07-22.7';
import {
  parseDateTime, toEpochDay, workday, dayDiff,
} from '../engine/workday.js?v=v2026-07-22.7';

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

// Column widths copied from the reference file's !cols wch values (20 columns).
const COL_WCH = Object.freeze([
  16.67, 21.67, 23.67, 25.67, 13.67, 18.67, 11.67, 54.17, 12.67, 29.67,
  12.67, 19.67, 19.67, 24.67, 26.67, 29.67, 9.67, 13.67, 8.17, 21.67,
]);

const DUE_SOON_FLAG = '⚠ DUE ≤24H';

const MS_PER_DAY = 86400000;
// Excel serial 25569 == 1970-01-01 (both are naïve/UTC-anchored here, so no TZ drift).
const EXCEL_EPOCH_OFFSET = 25569;
const toSerial = (ms) => ms / MS_PER_DAY + EXCEL_EPOCH_OFFSET;

/** Date-only cell (M/D/YYYY): integer Excel serial from a 'YYYY-MM-DD' string. */
function dateCell(str) {
  const ms = parseDateTime(str);
  if (ms == null) return null;
  return { t: 'n', v: toSerial(toEpochDay(ms)), z: 'm/d/yyyy' };
}
/** Full-datetime cell (M/D/YYYY H:mm): fractional Excel serial, time preserved. */
function dtCell(str) {
  const ms = parseDateTime(str);
  if (ms == null) return null;
  return { t: 'n', v: toSerial(ms), z: 'm/d/yyyy\\ h:mm' };
}
/** Date-only cell straight from a midnight epoch-ms (Due Date). */
function dueCell(ms) {
  if (ms == null) return null;
  return { t: 'n', v: toSerial(ms), z: 'm/d/yyyy' };
}
/** A string cell, or null for empty. */
function strCell(v) {
  if (v == null) return null;
  const s = String(v);
  return s === '' ? null : { t: 's', v: s };
}
/**
 * An identifier cell. Reference stores these as numbers (leading zeros dropped by
 * Excel) when purely numeric; fall back to a string for non-numeric or oversized
 * ids (>15 digits would lose precision as an IEEE double).
 * @param {*} v @param {string} [z]  number format (default 'General')
 */
function idCell(v, z) {
  if (v == null) return null;
  const s = String(v);
  if (s === '') return null;
  if (/^\d+$/.test(s) && s.length <= 15) return { t: 'n', v: Number(s), z: z || 'General' };
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
    dateCell(row.orderDate),                                   // 0  Order date time
    idCell(row.orderingFacilityId),                            // 1  Ordering facility ID
    idCell(row.performingFacilityId),                          // 2  Performing facility id
    strCell(row.facility),                                     // 3  Performing facility name
    idCell(row.orderId, '0'),                                  // 4  Order ID
    strCell(`${row.orderId}:${row.lineNo}`),                   // 5  Order line number
    strCell(row.loinc),                                        // 6  Lonic code
    strCell(row.testName),                                     // 7  Test name
    idCell(row.specimenNo),                                    // 8  Specimen no
    dtCell(row.collected),                                     // 9  Specimen collected date time
    strCell(row.shipmentId),                                   // 10 Shipment ID
    dtCell(row.dispatched),                                    // 11 Dispatch date time
    dtCell(row.received),                                      // 12 Received date time
    null,                                                      // 13 Result report date time (empty by scope)
    strCell(row.rawStatus),                                    // 14 Order Status
    { t: 'n', v: tat, z: 'General' },                          // 15 Standard TAT (business days)
    dueCell(dueMs),                                            // 16 Due Date
    { t: 'n', v: delay, z: '0' },                              // 17 Delay (days)
    strCell(status),                                           // 18 Status
    risk ? { t: 's', v: risk } : null,                         // 19 Late Risk (next 24h)
  ];

  return { late, dueSoon, cells };
}

/** Assemble a SheetJS worksheet object from the pre-built 20-cell data rows. */
function buildSheet(sheetName, dataRows, XLSX) {
  const ws = {};
  const nCols = LATE_LAB_HEADERS.length;
  LATE_LAB_HEADERS.forEach((h, c) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: h };
  });
  dataRows.forEach((cells, ri) => {
    cells.forEach((cell, c) => {
      if (cell == null) return;                   // empty cells are simply absent
      ws[XLSX.utils.encode_cell({ r: ri + 1, c })] = cell;
    });
  });
  const ref = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: dataRows.length, c: nCols - 1 },
  });
  ws['!ref'] = ref;
  ws['!autofilter'] = { ref };                    // autofilter spans the used range
  ws['!cols'] = COL_WCH.map((wch) => ({ wch }));
  return ws;
}

/**
 * Build one "Late & Due" workbook per performing lab.
 * @param {Object} args
 * @param {import('../contracts.js').OrderRow[]} args.rows
 * @param {Object<string,number>} [args.tatTests]  test name → business days (TAT lookup)
 * @param {number} args.asOfMs                     the report/as-of instant (epoch-ms; injected)
 * @param {*} args.XLSX                            the SheetJS library
 * @param {{tatFallbackFromCsv?:boolean}} [args.opts]  passed to resolveTat (fallback ON by default)
 * @returns {{lab:string, sheetName:string, fileName:string, late:number, dueSoon:number, wb:Object}[]}
 *   one entry per lab with ≥1 included row, sorted by total desc then lab name asc.
 */
export function buildLateLabWorkbooks({
  rows, tatTests, asOfMs, XLSX, opts = {},
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  if (asOfMs == null || !Number.isFinite(Number(asOfMs))) {
    throw new Error('buildLateLabWorkbooks: asOfMs (epoch-ms) is required');
  }
  if (!XLSX || !XLSX.utils || typeof XLSX.utils.encode_cell !== 'function') {
    throw new Error('buildLateLabWorkbooks: XLSX (SheetJS) must be injected');
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
    const ws = buildSheet(sheetName, g.dataRows, XLSX);
    const wb = { SheetNames: [sheetName], Sheets: { [sheetName]: ws } };
    out.push({
      lab, sheetName, fileName: labFileName(lab), late: g.late, dueSoon: g.dueSoon, wb,
    });
  }
  // Deterministic order: worst (largest total) first, ties broken by lab name.
  out.sort((a, b) => (b.late + b.dueSoon) - (a.late + a.dueSoon) || a.lab.localeCompare(b.lab));
  return out;
}

export default buildLateLabWorkbooks;
