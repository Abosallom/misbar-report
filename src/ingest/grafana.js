// ingest/grafana.js — live-ingest the KAMC order report straight from the Grafana
// PUBLIC-dashboard query API, producing the SAME { rows, summary, errors } contract
// as ingest/csv.js. No auth (public dashboard, server-side-masked data). Pure module:
// fetch is injectable (fetchImpl) and there are NO vendor/ or DOM imports.
// PII (patient/staff fields) is read but NEVER copied into OrderRow or persisted.
import { normFacility } from '../contracts.js';
import { MAPPED_COLUMNS } from './csv.js';

// ---- cell coercers (mirror csv.js semantics; Grafana cells may be null/number/string) ----
const clean = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};
const dateOnly = (v) => {
  const s = clean(v);
  return s == null ? null : s.slice(0, 10); // 'Order date time' is already 'yyyy-mm-dd'
};
const intOrNull = (v) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

// Grafana "time" fields arrive as epoch-MILLISECOND numbers in TRUE UTC. The app's
// canonical string form is Asia/Riyadh local = fixed UTC+3 (no DST). Null-safe.
const RIYADH_OFFSET_MS = 10_800_000; // +3h
const toRiyadh = (ms) => {
  if (ms == null) return null;
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return new Date(n + RIYADH_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
};

/**
 * epoch-ms of Jan-1 00:00 Asia/Riyadh (UTC+3) for the year of `asOfIso`.
 * e.g. '2026-07-19' → Date.UTC(2026,0,1) - 3h = 1767214800000.
 * @param {string} asOfIso - 'YYYY-MM-DD' (or any string whose first 4 chars are the year)
 * @returns {number}
 */
export function yearStartMs(asOfIso) {
  const year = Number(String(asOfIso ?? '').slice(0, 4));
  if (!Number.isFinite(year) || year < 1970) {
    throw new Error(`تعذّر تحديد السنة من التاريخ: ${asOfIso}`);
  }
  return Date.UTC(year, 0, 1) - RIYADH_OFFSET_MS;
}

/**
 * Fetch the live KAMC orders from the Grafana public-dashboard query endpoint and
 * normalize to OrderRow[]. Same result contract as parseKamcCsv.
 * @param {{baseUrl:string, accessToken:string, panelId:number}} grafanaCfg
 * @param {{fromMs:(number|string), toMs:(number|string), fetchImpl?:Function}} [opts]
 * @returns {Promise<{rows: import('../contracts.js').OrderRow[], summary: Object, errors: string[]}>}
 */
export async function fetchKamcOrders(grafanaCfg, { fromMs, toMs, fetchImpl = fetch } = {}) {
  // ---- validate config (descriptive Arabic errors) ----
  if (!grafanaCfg || typeof grafanaCfg !== 'object') {
    throw new Error('إعدادات Grafana مفقودة.');
  }
  const baseUrl = typeof grafanaCfg.baseUrl === 'string' ? grafanaCfg.baseUrl.trim() : '';
  if (!baseUrl) {
    throw new Error('إعدادات Grafana غير مكتملة: عنوان الخادم (baseUrl) مطلوب.');
  }
  const accessToken =
    typeof grafanaCfg.accessToken === 'string' ? grafanaCfg.accessToken.trim() : '';
  if (!accessToken) {
    throw new Error('إعدادات Grafana غير مكتملة: رمز الوصول (accessToken) مطلوب.');
  }
  if (typeof grafanaCfg.panelId !== 'number' || !Number.isFinite(grafanaCfg.panelId)) {
    throw new Error('إعدادات Grafana غير مكتملة: معرّف اللوحة (panelId) يجب أن يكون رقماً.');
  }

  const root = baseUrl.replace(/\/+$/, '');
  const url = `${root}/api/public/dashboards/${accessToken}/panels/${grafanaCfg.panelId}/query`;
  const body = JSON.stringify({
    intervalMs: 60000,
    maxDataPoints: 50000,
    timeRange: { from: String(fromMs), to: String(toMs) },
  });

  // A TypeError from fetch (CORS/network) is allowed to propagate to the caller.
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
  });

  if (!res.ok) {
    throw new Error(`فشل الاتصال بـ Grafana (HTTP ${res.status})`);
  }

  const json = await res.json();
  const a = json && json.results && json.results.A;
  if (a && a.error) {
    throw new Error(String(a.error));
  }

  // ---- columnar frames → row objects (concatenate all frames of results.A) ----
  const frames = (a && a.frames) || [];
  const fieldNames = new Set();
  const rowObjects = [];
  for (const frame of frames) {
    const flds = (frame && frame.schema && frame.schema.fields) || [];
    const cols = (frame && frame.data && frame.data.values) || [];
    for (const f of flds) fieldNames.add(f.name);
    const nRows = cols.length && cols[0] ? cols[0].length : 0;
    for (let j = 0; j < nRows; j++) {
      const obj = {};
      for (let c = 0; c < flds.length; c++) {
        const col = cols[c];
        obj[flds[c].name] = col ? col[j] : null;
      }
      rowObjects.push(obj);
    }
  }

  // ---- fail-soft field validation (mirror csv.js's header check) ----
  const errors = [];
  for (const col of MAPPED_COLUMNS) {
    if (!fieldNames.has(col)) errors.push(`Missing column: ${col}`);
  }

  // ---- map to OrderRow (mirror csv.js exactly; datetimes go through toRiyadh) ----
  const rows = [];
  for (let i = 0; i < rowObjects.length; i++) {
    const r = rowObjects[i];
    const orderId = clean(r['Order ID']); // string — leading zeros preserved
    const testName = clean(r['Test name']) ?? '';
    if (orderId == null) continue; // strict csv.js parity: a row without an Order ID is not an order line
    rows.push({
      orderDate: dateOnly(r['Order date time']),
      facility: normFacility(r['Performing facility name']),
      orderId,
      lineNo: i, // running row index across concatenated frames
      loinc: clean(r['Test code']),
      testName,
      collected: toRiyadh(r['Specimen collected date time']),
      dispatched: toRiyadh(r['Dispatch date time']),
      received: toRiyadh(r['Received date time']),
      resulted: toRiyadh(r['Result report date time']),
      rawStatus: r['Order Status'] == null ? '' : String(r['Order Status']).trim(),
      tatDaysCsv: intOrNull(r['TAT - Days']),
    });
  }

  // ---- summary (aggregate only; no PII) — same shape as csv.js + source/fetchedAt ----
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
      source: 'grafana',
      fetchedAt: new Date().toISOString(),
    },
    errors,
  };
}
