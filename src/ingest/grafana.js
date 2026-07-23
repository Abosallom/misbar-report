// ingest/grafana.js — live-ingest the KAMC order report straight from the Grafana
// PUBLIC-dashboard query API, producing the SAME { rows, summary, errors } contract
// as ingest/csv.js. No auth (public dashboard, server-side-masked data). Pure module:
// fetch is injectable (fetchImpl) and there are NO vendor/ or DOM imports.
// PII (patient/staff fields) is read but NEVER copied into OrderRow or persisted.
import { normFacility } from '../contracts.js?v=v2026-07-22.13';
import { MAPPED_COLUMNS } from './csv.js?v=v2026-07-22.13';

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
 * Aggregate-only summary over OrderRow[] (mirrors csv.js's summary block). No PII.
 * @param {import('../contracts.js').OrderRow[]} rows
 * @param {{source:string, fetchedAt:string}} meta
 * @returns {Object}
 */
function buildSummary(rows, { source, fetchedAt }) {
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
    rowCount: rows.length,
    distinctOrders: distinct.size,
    dateRange: { min, max },
    resultedCount,
    statusCounts,
    source,
    fetchedAt,
  };
}

// ---- crypto helpers for the encrypted live snapshot (WebCrypto; browser + Node 20+) ----
function getSubtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('واجهة التشفير WebCrypto غير متوفرة في هذه البيئة.');
  }
  return c.subtle;
}

/** 64-hex → 32-byte Uint8Array (AES-256 key). Assumes a validated hex string. */
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/** base64 → Uint8Array. Throws on invalid base64 (caller maps to a decrypt error). */
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Load + decrypt the server-published KAMC live snapshot (the automatic CORS
 * fallback). The GitHub Action fetches KAMC server-side, strips ALL patient
 * fields, and publishes base64( iv(12) || AES-GCM ciphertext+tag ) at a
 * site-relative path. Same result contract as fetchKamcOrders, plus `fetchedAt`.
 * @param {string} dataKeyHex - 64 hex chars (AES-256 key)
 * @param {{url?:string, fetchImpl?:Function}} [opts]
 * @returns {Promise<{rows: import('../contracts.js').OrderRow[], summary: Object, errors: string[], fetchedAt: string}>}
 */
export async function fetchKamcSnapshot(dataKeyHex, { url = 'data/kamc-live.enc', fetchImpl = fetch } = {}) {
  // ---- validate the key (64 hex chars → AES-256) --------------------------
  const keyHex = typeof dataKeyHex === 'string' ? dataKeyHex.trim() : '';
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('مفتاح فك تشفير البيانات غير صالح — يجب أن يكون 64 خانة ست عشرية (hex).');
  }

  // ---- fetch the encrypted file (relative URL → works under the Pages subpath) ----
  const res = await fetchImpl(url, { cache: 'no-store' });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('ملف البيانات المشفر غير متوفر بعد — سيُنشأ بعد أول تشغيل للمزامنة الخلفية.');
    }
    throw new Error(`فشل تحميل ملف البيانات المشفر (HTTP ${res.status})`);
  }

  // ---- decode + decrypt (any corruption/wrong-key → one clear Arabic error) ----
  let plainText;
  try {
    const raw = base64ToBytes((await res.text()).trim());
    if (raw.length <= 12) throw new Error('ciphertext too short');
    const iv = raw.slice(0, 12);
    const cipher = raw.slice(12);
    const key = await getSubtle().importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['decrypt']);
    const plainBuf = await getSubtle().decrypt({ name: 'AES-GCM', iv }, key, cipher);
    plainText = new TextDecoder().decode(plainBuf);
  } catch (_e) {
    throw new Error('فشل فك التشفير — تحقق من مفتاح البيانات');
  }

  // ---- parse + trust-but-validate the plaintext JSON ----------------------
  let payload;
  try {
    payload = JSON.parse(plainText);
  } catch (_e) {
    throw new Error('محتوى ملف البيانات المشفر غير صالح (JSON).');
  }
  const rows = payload && payload.rows;
  if (!Array.isArray(rows)) {
    throw new Error('محتوى ملف البيانات المشفر غير صالح: الحقل rows يجب أن يكون مصفوفة.');
  }
  // Sample a few rows: they must already be in OrderRow shape (orderId + testName).
  const sampleN = Math.min(rows.length, 5);
  for (let i = 0; i < sampleN; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object' || r.orderId == null || r.testName == null) {
      throw new Error('محتوى ملف البيانات المشفر غير صالح: صف بلا orderId أو testName.');
    }
  }

  const fetchedAt = typeof payload.fetchedAt === 'string' ? payload.fetchedAt : new Date().toISOString();
  return {
    rows,
    summary: buildSummary(rows, { source: 'grafana-snapshot', fetchedAt }),
    errors: [],
    fetchedAt,
  };
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
      // Operational identifiers for the per-lab "Late & Due" export (mirror csv.js).
      // Not patient data. Absent Grafana columns coerce to null via clean().
      specimenNo: clean(r['Specimen Id']),
      shipmentId: clean(r['Shipment ID']),
      orderingFacilityId: clean(r['Ordering facility ID']),
      performingFacilityId: clean(r['Performing facility id']),
    });
  }

  // ---- summary (aggregate only; no PII) — same shape as csv.js + source/fetchedAt ----
  return {
    rows,
    summary: buildSummary(rows, { source: 'grafana', fetchedAt: new Date().toISOString() }),
    errors,
  };
}
