// ingest/csv.js — parse the KAMC daily CSV export (30 cols) into normalized OrderRow[].
// Library is injected (browser loads PapaParse separately); never imported here.
// PII (patient/staff fields) is read but NEVER copied into OrderRow or persisted.
import { normFacility } from '../contracts.js?v=v2026-07-22.7';

// Columns we actually map. Missing ones are reported in errors[] (fail soft).
export const MAPPED_COLUMNS = [
  'Order ID',
  'Order date time',
  'Performing facility name',
  'Order Status',
  'Specimen collected date time',
  'Dispatch date time',
  'Received date time',
  'Result report date time',
  'Test code',
  'Test name',
  'TAT - Days',
];

const clean = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};
const dateOnly = (v) => {
  const s = clean(v);
  return s == null ? null : s.slice(0, 10);
};
const intOrNull = (v) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

/**
 * @param {string} text - raw CSV text (UTF-8)
 * @param {*} Papa - the PapaParse library object
 * @returns {{rows: import('../contracts.js').OrderRow[], summary: Object, errors: string[]}}
 */
export function parseKamcCsv(text, Papa) {
  const errors = [];
  const res = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    // no dynamicTyping — ID columns keep leading zeros / stay strings
  });

  const fields = (res.meta && res.meta.fields) || [];
  for (const col of MAPPED_COLUMNS) {
    if (!fields.includes(col)) errors.push(`Missing column: ${col}`);
  }
  if (res.errors && res.errors.length) {
    for (const e of res.errors.slice(0, 25)) {
      errors.push(`Parse error (row ${e.row}): ${e.code} — ${e.message}`);
    }
  }

  const data = res.data || [];
  const rows = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const orderId = clean(r['Order ID']);
    if (orderId == null) continue; // garbage row without an order id
    rows.push({
      orderDate: dateOnly(r['Order date time']),
      facility: normFacility(r['Performing facility name']),
      orderId, // string — leading zeros preserved
      lineNo: i, // CSV has no line-number column; use the data-row index
      loinc: clean(r['Test code']),
      testName: clean(r['Test name']) ?? '',
      collected: clean(r['Specimen collected date time']),
      dispatched: clean(r['Dispatch date time']),
      received: clean(r['Received date time']),
      resulted: clean(r['Result report date time']),
      rawStatus: r['Order Status'] == null ? '' : String(r['Order Status']).trim(),
      tatDaysCsv: intOrNull(r['TAT - Days']),
      // Operational identifiers for the per-lab "Late & Due" export (NOT patient
      // data). Kept as strings (leading zeros preserved, like orderId). CSV header
      // names differ from the export's headers: 'Specimen Id' → specimenNo. The
      // 'Performing facility id' column is absent from this export → null.
      specimenNo: clean(r['Specimen Id']),
      shipmentId: clean(r['Shipment ID']),
      orderingFacilityId: clean(r['Ordering facility ID']),
      performingFacilityId: clean(r['Performing facility id']),
    });
  }

  // ---- summary (aggregate only; no PII) ----
  const distinct = new Set();
  const statusCounts = {};
  let resultedCount = 0;
  let min = null;
  let max = null;
  for (const x of rows) {
    distinct.add(x.orderId);
    statusCounts[x.rawStatus] = (statusCounts[x.rawStatus] || 0) + 1;
    if (x.resulted) resultedCount++;
    if (x.orderDate) {
      if (min === null || x.orderDate < min) min = x.orderDate;
      if (max === null || x.orderDate > max) max = x.orderDate;
    }
  }

  return {
    rows,
    summary: {
      rowCount: rows.length,
      distinctOrders: distinct.size,
      dateRange: { min, max },
      resultedCount,
      statusCounts,
    },
    errors,
  };
}
