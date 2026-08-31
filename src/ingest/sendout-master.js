// ingest/sendout-master.js — load + decrypt the send-out catalogue.
//
// The catalogue decides which COUNTRY every send-out order belongs to. It is
// commercial tender data (vendors, their reference labs, every contracted test),
// and this repo is public, so it ships as ciphertext at data/sendout-master.enc
// — written by scripts/build-sendout-master.mjs, readable only with the data key
// the access seal hands over at sign-in. Exactly the arrangement kamc-live.enc
// already uses for the order rows.
//
// A failure here is never fatal: the caller gets null, the report model carries
// no send-out block, and build-spec omits both slides. A deck missing two slides
// is a far better outcome than a deck that attributes orders to the wrong country.
const CIPHER = 'AES-GCM';
const IV_BYTES = 12;

/** WebCrypto, or a clear error rather than a TypeError deep in the call stack. */
function getSubtle() {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (!c || !c.subtle) throw new Error('WebCrypto غير متاح في هذا المتصفح.');
  return c.subtle;
}

const hexToBytes = (hex) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
};

const base64ToBytes = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** A row is only usable if it can actually place an order in a country. */
const validRow = (r) => r && typeof r === 'object'
  && typeof r.vendor === 'string' && r.vendor.trim()
  && typeof r.country === 'string' && r.country.trim();

/**
 * Fetch and decrypt the send-out catalogue.
 *
 * @param {string} dataKeyHex 64 hex chars — the same AES-256 key as the snapshot.
 * @param {{url?:string, fetchImpl?:Function}} [opts]
 * @returns {Promise<Array<{vendor:string,country:string,reflab:string,item:string}>>}
 * @throws on a bad key, a missing file, or corrupt ciphertext.
 */
export async function fetchSendoutMaster(dataKeyHex, {
  url = 'data/sendout-master.enc', fetchImpl = fetch,
} = {}) {
  const keyHex = typeof dataKeyHex === 'string' ? dataKeyHex.trim() : '';
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('مفتاح فك تشفير البيانات غير صالح — يجب أن يكون 64 خانة ست عشرية (hex).');
  }

  const res = await fetchImpl(url, { cache: 'no-store' });
  if (!res || !res.ok) {
    const status = res ? res.status : '?';
    if (status === 404) throw new Error('ملف الموردين الرئيسي المشفر غير متوفر.');
    throw new Error(`فشل تحميل ملف الموردين الرئيسي المشفر (HTTP ${status})`);
  }

  let payload;
  try {
    const raw = base64ToBytes((await res.text()).trim());
    if (raw.length <= IV_BYTES) throw new Error('ciphertext too short');
    const key = await getSubtle().importKey('raw', hexToBytes(keyHex), CIPHER, false, ['decrypt']);
    const buf = await getSubtle().decrypt(
      { name: CIPHER, iv: raw.slice(0, IV_BYTES) }, key, raw.slice(IV_BYTES),
    );
    payload = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new Error('فشل فك تشفير ملف الموردين الرئيسي — تحقق من مفتاح البيانات');
  }

  const rows = (payload && Array.isArray(payload.rows) ? payload.rows : []).filter(validRow);
  if (!rows.length) throw new Error('ملف الموردين الرئيسي فارغ أو تالف.');
  return rows.map((r) => ({
    vendor: String(r.vendor).trim(),
    country: String(r.country).trim(),
    reflab: String(r.reflab || '').trim(),
    item: String(r.item || '').trim(),
  }));
}

/**
 * The forgiving form used by the screens: resolves to null instead of throwing,
 * so a missing key or an offline load simply drops the two slides.
 */
export async function loadSendoutMaster(dataKeyHex, opts) {
  try {
    return await fetchSendoutMaster(dataKeyHex, opts);
  } catch (e) {
    console.warn('[sendout] catalogue unavailable; slides omitted', e && e.message);
    return null;
  }
}

export default fetchSendoutMaster;
