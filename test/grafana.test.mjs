// test/grafana.test.mjs — run with:  node --test
// SYNTHETIC fixture only (no real patient values — masked-style rows). Exercises the
// Grafana live-ingest path (columnar frames → OrderRow[]) with an injected fetch stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { fetchKamcOrders, fetchKamcSnapshot, yearStartMs } from '../src/ingest/grafana.js';

// ---- 30-field schema, EXACT names/types matching the real public-dashboard panel ----
const FIELDS = [
  { name: 'Patient Name', type: 'string' },
  { name: 'National Id', type: 'string' },
  { name: 'MRN ID', type: 'string' },
  { name: 'DOB', type: 'time' },
  { name: 'Gender', type: 'string' },
  { name: 'Order ID', type: 'string' },
  { name: 'Order date time', type: 'string' },
  { name: 'Performing facility name', type: 'string' },
  { name: 'Order Status', type: 'string' },
  { name: 'Specimen Id', type: 'string' },
  { name: 'Specimen Type', type: 'string' },
  { name: 'Specimen collected date time', type: 'time' },
  { name: 'Shipment ID', type: 'string' },
  { name: 'Shipment Created date time', type: 'time' },
  { name: 'Batch Id', type: 'string' },
  { name: 'Dispatch date time', type: 'time' },
  { name: 'Received date time', type: 'time' },
  { name: 'Result report date time', type: 'time' },
  { name: 'Test code', type: 'string' },
  { name: 'Test name', type: 'string' },
  { name: 'Ordering facility ID', type: 'string' },
  { name: 'Ordered By', type: 'string' },
  { name: 'Collected By', type: 'string' },
  { name: 'Shipment Created By', type: 'string' },
  { name: 'Received By', type: 'string' },
  { name: 'Result Entered By', type: 'string' },
  { name: 'Result Approved By', type: 'string' },
  { name: 'TAT - Days', type: 'string' },
  { name: 'TAT Due Date', type: 'time' },
  { name: 'Severity Label', type: 'string' },
];

// Pivot masked row-objects into a Grafana columnar frame (values[] per field).
function makeFrame(rowObjs) {
  return {
    schema: { fields: FIELDS },
    data: { values: FIELDS.map((f) => rowObjs.map((o) => (f.name in o ? o[f.name] : null))) },
  };
}

const TZ_MS = 1776928534000; // VERIFIED: UTC 07:15:34 → Riyadh '2026-04-23 10:15:34'

// Frame 1 — a fully-populated row (timezone + leading-zero id) and a sparse/null row.
const A1 = {
  'Patient Name': 'MASKED-A1',
  'National Id': '1XXXXXXXX1',
  'MRN ID': 'MRN-0001',
  'Order ID': '00990000000463', // leading zeros must survive as a string
  'Order date time': '2026-04-23',
  'Performing facility name': 'KAMC  Lab', // double space → normFacility collapses
  'Order Status': 'Result Approved',
  'Specimen collected date time': TZ_MS,
  'Dispatch date time': TZ_MS,
  'Received date time': TZ_MS,
  'Result report date time': TZ_MS,
  'Test code': '48378-4',
  'Test name': 'Vitamin D',
  'Result Approved By': 'STAFF-X',
  'TAT - Days': '3', // STRING → parses to 3
};
const A2 = {
  'Patient Name': 'MASKED-A2',
  'MRN ID': null, // null MRN cell
  'Order ID': '00990000000999',
  'Order date time': '2026-05-01',
  'Performing facility name': 'KAMC Lab',
  'Order Status': 'Received',
  'Specimen collected date time': null, // null datetime cells
  'Dispatch date time': null,
  'Received date time': TZ_MS,
  'Result report date time': null,
  'Test code': null,
  'Test name': 'CBC',
  'TAT - Days': null, // null TAT
};

// Frame 2 — proves multi-frame concatenation + a SKIP row (no Order ID AND no Test name).
const B1 = {
  'Patient Name': 'MASKED-B1',
  'MRN ID': 'MRN-0002',
  'Order ID': '00990000000463', // same order as A1, different test → distinctOrders counts once
  'Order date time': '2026-04-23',
  'Performing facility name': 'KAMC Lab',
  'Order Status': 'Result Approved',
  'Result report date time': TZ_MS,
  'Test code': '99999-9',
  'Test name': 'Ferritin',
  'TAT - Days': '5',
};
const B2 = {
  'Patient Name': 'MASKED-B2',
  'Order ID': null, // no order id ...
  'Order date time': '2026-06-01',
  'Performing facility name': 'KAMC Lab',
  'Order Status': 'Cancelled',
  'Test name': null, // ... and no test name → skipped (must not touch summary)
};

const PAYLOAD = { results: { A: { frames: [makeFrame([A1, A2]), makeFrame([B1, B2])] } } };

// Injectable fetch stub; records calls for URL/body assertions.
function stubFetch(payload, { ok = true, status = 200 } = {}) {
  const impl = async (url, init) => {
    impl.calls.push({ url, init });
    return { ok, status, json: async () => payload };
  };
  impl.calls = [];
  return impl;
}

const CFG = { baseUrl: 'https://elab.seha.sa/hpapm/', accessToken: 'tok123', panelId: 12 };

test('fetchKamcOrders — maps frames → OrderRow[] and summary (mirrors csv.js)', async () => {
  const fetchImpl = stubFetch(PAYLOAD);
  const fromMs = 1767214800000;
  const toMs = 1776999999000;
  const { rows, summary, errors } = await fetchKamcOrders(CFG, { fromMs, toMs, fetchImpl });

  assert.equal(errors.length, 0, `unexpected errors: ${errors.join(' | ')}`);

  // 4 source rows, 1 skipped (B2) → 3 kept.
  assert.equal(summary.rowCount, 3);
  assert.equal(rows.length, 3);
  assert.equal(summary.distinctOrders, 2); // {..463, ..999}
  assert.equal(summary.resultedCount, 2); // A1, B1 (A2 has null resulted)
  assert.deepEqual(summary.dateRange, { min: '2026-04-23', max: '2026-05-01' }); // B2's 2026-06 excluded
  assert.deepEqual(summary.statusCounts, { 'Result Approved': 2, Received: 1 });
  assert.equal(summary.source, 'grafana');
  assert.match(summary.fetchedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

  // Row A1 — timezone conversion, leading-zero id, facility normalization, string TAT.
  const r0 = rows[0];
  assert.equal(r0.collected, '2026-04-23 10:15:34'); // UTC+3 render
  assert.equal(r0.dispatched, '2026-04-23 10:15:34');
  assert.equal(r0.received, '2026-04-23 10:15:34');
  assert.equal(r0.resulted, '2026-04-23 10:15:34');
  assert.equal(typeof r0.orderId, 'string');
  assert.equal(r0.orderId, '00990000000463');
  assert.equal(r0.facility, 'KAMC Lab');
  assert.equal(r0.orderDate, '2026-04-23');
  assert.equal(r0.loinc, '48378-4');
  assert.equal(r0.testName, 'Vitamin D');
  assert.equal(r0.rawStatus, 'Result Approved');
  assert.equal(r0.tatDaysCsv, 3);
  assert.equal(r0.lineNo, 0);

  // Row A2 — null MRN/datetime cells, null TAT, present-only 'received'.
  const r1 = rows[1];
  assert.equal(r1.collected, null);
  assert.equal(r1.dispatched, null);
  assert.equal(r1.resulted, null);
  assert.equal(r1.received, '2026-04-23 10:15:34');
  assert.equal(r1.loinc, null);
  assert.equal(r1.tatDaysCsv, null);
  assert.equal(r1.orderId, '00990000000999');
  assert.equal(r1.lineNo, 1);

  // Row B1 — came from the SECOND frame (concatenation) with running lineNo.
  const r2 = rows[2];
  assert.equal(r2.testName, 'Ferritin');
  assert.equal(r2.tatDaysCsv, 5);
  assert.equal(r2.orderId, '00990000000463');
  assert.equal(r2.lineNo, 2);

  // No PII/staff fields leaked onto any row (same guard as ingest.test.mjs).
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      assert.ok(!/patient|national|mrn|dob|gender|by$/i.test(k), `unexpected PII-ish key: ${k}`);
    }
  }

  // Request was well-formed: trailing slash stripped, epoch-ms as strings.
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, 'https://elab.seha.sa/hpapm/api/public/dashboards/tok123/panels/12/query');
  assert.equal(init.method, 'POST');
  const sent = JSON.parse(init.body);
  assert.equal(sent.intervalMs, 60000);
  assert.equal(sent.maxDataPoints, 50000);
  assert.deepEqual(sent.timeRange, { from: '1767214800000', to: '1776999999000' });
});

test('fetchKamcOrders — reports missing expected fields (fail-soft)', async () => {
  // Drop 'Test name' and 'Order Status' from the schema/columns entirely.
  const trimmed = FIELDS.filter((f) => f.name !== 'Test name' && f.name !== 'Order Status');
  const frame = {
    schema: { fields: trimmed },
    data: { values: trimmed.map(() => ['00990000000001']) },
  };
  const payload = { results: { A: { frames: [frame] } } };
  const { errors } = await fetchKamcOrders(CFG, { fromMs: 1, toMs: 2, fetchImpl: stubFetch(payload) });
  assert.ok(errors.includes('Missing column: Test name'));
  assert.ok(errors.includes('Missing column: Order Status'));
});

test('fetchKamcOrders — HTTP error throws Arabic message with status', async () => {
  const fetchImpl = stubFetch(null, { ok: false, status: 500 });
  await assert.rejects(
    fetchKamcOrders(CFG, { fromMs: 1, toMs: 2, fetchImpl }),
    /فشل الاتصال بـ Grafana \(HTTP 500\)/,
  );
});

test('fetchKamcOrders — results.A.error propagates as the thrown message', async () => {
  const fetchImpl = stubFetch({ results: { A: { error: 'panel query failed: timeout' } } });
  await assert.rejects(
    fetchKamcOrders(CFG, { fromMs: 1, toMs: 2, fetchImpl }),
    /panel query failed: timeout/,
  );
});

test('fetchKamcOrders — a fetch TypeError (CORS/network) propagates unchanged', async () => {
  const fetchImpl = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(fetchKamcOrders(CFG, { fromMs: 1, toMs: 2, fetchImpl }), TypeError);
});

test('fetchKamcOrders — invalid config throws before any fetch', async () => {
  const guard = () => {
    throw new Error('fetch must not be called for invalid cfg');
  };
  await assert.rejects(fetchKamcOrders(null, { fetchImpl: guard }), /Grafana/);
  await assert.rejects(
    fetchKamcOrders({ baseUrl: '  ', accessToken: 't', panelId: 1 }, { fetchImpl: guard }),
    /baseUrl/,
  );
  await assert.rejects(
    fetchKamcOrders({ baseUrl: 'https://x', accessToken: '', panelId: 1 }, { fetchImpl: guard }),
    /accessToken/,
  );
  await assert.rejects(
    fetchKamcOrders({ baseUrl: 'https://x', accessToken: 't', panelId: 'nope' }, { fetchImpl: guard }),
    /panelId/,
  );
});

test('yearStartMs — Jan-1 00:00 Asia/Riyadh (UTC+3) for the year', () => {
  // Exact spec example: '2026-07-19' → Date.UTC(2026,0,1) - 3h.
  assert.equal(yearStartMs('2026-07-19'), 1767214800000);
  assert.equal(yearStartMs('2025-12-31'), Date.UTC(2025, 0, 1) - 10_800_000);
  assert.throws(() => yearStartMs('not-a-date'), /السنة/);
});

// ===========================================================================
// fetchKamcSnapshot — encrypted server-published live snapshot (CORS fallback).
// Builds a REAL encrypted fixture in-test with WebCrypto so the decrypt path is
// exercised end-to-end (same file format the GitHub Action produces).
// ===========================================================================

const subtle = webcrypto.subtle;
const KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64 hex → 32 bytes
const WRONG_KEY_HEX = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Produce base64( iv(12) || AES-GCM ciphertext+tag ) for a plaintext object.
async function makeEncFile(plaintextObj, keyHex = KEY_HEX) {
  const key = await subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(plaintextObj));
  const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const combined = new Uint8Array(iv.length + cipher.length);
  combined.set(iv, 0);
  combined.set(cipher, iv.length);
  return Buffer.from(combined).toString('base64');
}

// Injectable fetch stub returning text (records calls for URL/init assertions).
function stubTextFetch(b64, { ok = true, status = 200 } = {}) {
  const impl = async (url, init) => {
    impl.calls.push({ url, init });
    return { ok, status, text: async () => b64 };
  };
  impl.calls = [];
  return impl;
}

// Two already-OrderRow-shaped rows (no patient fields; Riyadh-local date strings).
const SNAP_ROWS = [
  {
    orderDate: '2026-04-23', facility: 'KAMC Lab', orderId: '00990000000463', lineNo: 0,
    loinc: '48378-4', testName: 'Vitamin D', collected: '2026-04-23 10:15:34',
    dispatched: null, received: null, resulted: '2026-04-23 10:15:34',
    rawStatus: 'Result Approved', tatDaysCsv: 3,
  },
  {
    orderDate: '2026-05-01', facility: 'KAMC Lab', orderId: '00990000000999', lineNo: 1,
    loinc: null, testName: 'CBC', collected: null, dispatched: null,
    received: '2026-04-23 10:15:34', resulted: null, rawStatus: 'Received', tatDaysCsv: null,
  },
];
const SNAP_PAYLOAD = { fetchedAt: '2026-07-19T07:15:00.000Z', source: 'grafana', rows: SNAP_ROWS };

test('fetchKamcSnapshot — happy path: rows + fetchedAt round-trip, snapshot summary', async () => {
  const b64 = await makeEncFile(SNAP_PAYLOAD);
  const fetchImpl = stubTextFetch(b64);
  const out = await fetchKamcSnapshot(KEY_HEX, { fetchImpl });

  assert.deepEqual(out.rows, SNAP_ROWS); // exact round-trip
  assert.equal(out.fetchedAt, '2026-07-19T07:15:00.000Z');
  assert.deepEqual(out.errors, []);

  // Summary matches the module's shared shape, tagged as the snapshot source.
  assert.equal(out.summary.source, 'grafana-snapshot');
  assert.equal(out.summary.fetchedAt, '2026-07-19T07:15:00.000Z');
  assert.equal(out.summary.rowCount, 2);
  assert.equal(out.summary.distinctOrders, 2);
  assert.equal(out.summary.resultedCount, 1); // only row 0 has `resulted`
  assert.deepEqual(out.summary.dateRange, { min: '2026-04-23', max: '2026-05-01' });
  assert.deepEqual(out.summary.statusCounts, { 'Result Approved': 1, Received: 1 });

  // Fetched the relative Pages path with no-store caching.
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, 'data/kamc-live.enc');
  assert.equal(fetchImpl.calls[0].init.cache, 'no-store');
});

test('fetchKamcSnapshot — custom url is honored', async () => {
  const b64 = await makeEncFile(SNAP_PAYLOAD);
  const fetchImpl = stubTextFetch(b64);
  await fetchKamcSnapshot(KEY_HEX, { url: 'sub/path/kamc-live.enc', fetchImpl });
  assert.equal(fetchImpl.calls[0].url, 'sub/path/kamc-live.enc');
});

test('fetchKamcSnapshot — wrong key → decrypt error', async () => {
  const b64 = await makeEncFile(SNAP_PAYLOAD, KEY_HEX); // encrypted with the RIGHT key
  const fetchImpl = stubTextFetch(b64);
  await assert.rejects(
    fetchKamcSnapshot(WRONG_KEY_HEX, { fetchImpl }), // decrypt with the WRONG key
    /فشل فك التشفير — تحقق من مفتاح البيانات/,
  );
});

test('fetchKamcSnapshot — corrupt base64 → decrypt error', async () => {
  const fetchImpl = stubTextFetch('@@@ this is not valid base64 @@@');
  await assert.rejects(
    fetchKamcSnapshot(KEY_HEX, { fetchImpl }),
    /فشل فك التشفير — تحقق من مفتاح البيانات/,
  );
});

test('fetchKamcSnapshot — 404 → "not published yet" Arabic message', async () => {
  const fetchImpl = stubTextFetch('', { ok: false, status: 404 });
  await assert.rejects(
    fetchKamcSnapshot(KEY_HEX, { fetchImpl }),
    /ملف البيانات المشفر غير متوفر بعد/,
  );
});

test('fetchKamcSnapshot — non-404 HTTP → generic Arabic HTTP error', async () => {
  const fetchImpl = stubTextFetch('', { ok: false, status: 503 });
  await assert.rejects(
    fetchKamcSnapshot(KEY_HEX, { fetchImpl }),
    /فشل تحميل ملف البيانات المشفر \(HTTP 503\)/,
  );
});

test('fetchKamcSnapshot — invalid key format → error before any fetch', async () => {
  const guard = () => {
    throw new Error('fetch must not be called for an invalid key');
  };
  await assert.rejects(fetchKamcSnapshot('too-short', { fetchImpl: guard }), /مفتاح|hex/);
  await assert.rejects(fetchKamcSnapshot('', { fetchImpl: guard }), /مفتاح|hex/);
  await assert.rejects(fetchKamcSnapshot('g'.repeat(64), { fetchImpl: guard }), /مفتاح|hex/); // non-hex chars
  await assert.rejects(fetchKamcSnapshot(null, { fetchImpl: guard }), /مفتاح|hex/);
});

test('fetchKamcSnapshot — decrypts but rows is not an array → validation error', async () => {
  const b64 = await makeEncFile({ fetchedAt: '2026-07-19T07:15:00.000Z', source: 'grafana', rows: 'nope' });
  await assert.rejects(
    fetchKamcSnapshot(KEY_HEX, { fetchImpl: stubTextFetch(b64) }),
    /rows/,
  );
});

test('fetchKamcSnapshot — decrypts but a sampled row lacks orderId/testName → validation error', async () => {
  const b64 = await makeEncFile({
    fetchedAt: '2026-07-19T07:15:00.000Z', source: 'grafana',
    rows: [{ orderId: '1', testName: 'X' }, { orderId: null, testName: 'Y' }],
  });
  await assert.rejects(
    fetchKamcSnapshot(KEY_HEX, { fetchImpl: stubTextFetch(b64) }),
    /orderId أو testName/,
  );
});
