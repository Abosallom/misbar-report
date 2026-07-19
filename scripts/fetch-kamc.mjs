// scripts/fetch-kamc.mjs — GitHub Actions exporter.
// Fetches KAMC order data from the Grafana PUBLIC-dashboard API (server-side,
// no CORS), maps it through the SAME ingest module the page uses (OrderRow shape
// — patient fields are never included), encrypts with AES-256-GCM, and writes
// data/kamc-live.enc for the static site to consume.
//
// Env: GRAFANA_URL (default https://elab.seha.sa/hpapm), GRAFANA_TOKEN (secret),
//      GRAFANA_PANEL (default 49), DATA_KEY (secret, 64 hex chars).
// Exit 0 always; prints "changed" or "unchanged" for the workflow's commit step.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fetchKamcOrders, yearStartMs } from '../src/ingest/grafana.js';

const baseUrl = process.env.GRAFANA_URL || 'https://elab.seha.sa/hpapm';
const accessToken = process.env.GRAFANA_TOKEN;
const panelId = Number(process.env.GRAFANA_PANEL || 49);
const keyHex = process.env.DATA_KEY;
if (!accessToken) throw new Error('GRAFANA_TOKEN is not set');
if (!/^[0-9a-fA-F]{64}$/.test(keyHex || '')) throw new Error('DATA_KEY must be 64 hex chars');

const nowRiyadh = new Date(Date.now() + 10_800_000);
const asOfIso = nowRiyadh.toISOString().slice(0, 10);

// Cloudflare fronts the instance; present browser-like headers, and on failure
// dump the response diagnostics (cf-mitigated etc.) before the error propagates.
const browserFetch = async (url, init = {}) => {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'ar,en;q=0.9',
      'Referer': `${baseUrl}/public-dashboards/${accessToken}`,
    },
  });
  if (!res.ok) {
    const diag = {};
    for (const k of ['server', 'cf-ray', 'cf-mitigated', 'cf-cache-status', 'content-type']) diag[k] = res.headers.get(k);
    console.error('DIAG status:', res.status, JSON.stringify(diag));
    console.error('DIAG body head:', (await res.clone().text()).slice(0, 300).replace(/\s+/g, ' '));
  }
  return res;
};

const { rows, summary } = await fetchKamcOrders(
  { baseUrl, accessToken, panelId, enabled: true },
  { fromMs: yearStartMs(asOfIso), toMs: Date.now(), fetchImpl: browserFetch },
);
console.log(`fetched ${rows.length} rows (${summary.dateRange?.min} -> ${summary.dateRange?.max})`);

// Deterministic content hash (rows only) so unchanged data skips the commit.
const rowsJson = JSON.stringify(rows);
const hash = createHash('sha256').update(rowsJson).digest('hex');
const metaPath = 'data/kamc-live.meta.json';
if (existsSync(metaPath)) {
  try {
    const prev = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (prev.hash === hash) { console.log('unchanged'); process.exit(0); }
  } catch { /* rewrite below */ }
}

const fetchedAt = new Date().toISOString();
const plaintext = new TextEncoder().encode(JSON.stringify({ fetchedAt, source: 'grafana', rows }));
const keyBytes = Uint8Array.from(keyHex.match(/../g).map((b) => parseInt(b, 16)));
const iv = crypto.getRandomValues(new Uint8Array(12));
const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
const payload = new Uint8Array(iv.length + cipher.length);
payload.set(iv, 0);
payload.set(cipher, iv.length);

mkdirSync('data', { recursive: true });
writeFileSync('data/kamc-live.enc', Buffer.from(payload).toString('base64'));
writeFileSync(metaPath, JSON.stringify({ fetchedAt, rowCount: rows.length, hash }, null, 2) + '\n');
console.log(`changed — wrote data/kamc-live.enc (${rows.length} rows, fetchedAt ${fetchedAt})`);
