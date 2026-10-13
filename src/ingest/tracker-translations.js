// ingest/tracker-translations.js — load + decrypt the BUILT-IN tracker translation memory.
//
// The reviewed Arabic for the project tracker's tasks / tracks / milestones ships with the
// app so the user's normal English tracker is in Arabic on the slides with nothing to
// prepare (model/tracker-translate.js, layer 'builtin'). Those texts are the project's own
// task list, and this repo is PUBLIC, so the memory ships as ciphertext at
// data/tracker-ar.enc — written by scripts/build-tracker-translations.mjs, readable only
// with the data key the access seal hands over at sign-in. The same arrangement (envelope,
// cipher, key) as data/sendout-master.enc and data/kamc-live.enc; this file mirrors
// ingest/sendout-master.js.
//
// A failure here is never fatal: the caller gets null and the tracker keeps whatever the
// other layers give it (the user's corrections, the on-device machine cache, or the
// English). A deck in English is a far better outcome than no deck.
import { sanitizeEntries } from '../model/tracker-translate.js?v=v2026-10-13.7';

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

/**
 * Fetch and decrypt the built-in translation memory.
 *
 * @param {string} dataKeyHex 64 hex chars — the same AES-256 key as the snapshot.
 * @param {{url?:string, fetchImpl?:Function}} [opts]
 * @returns {Promise<{generatedAt:string, entries:{tasks:Object<string,string>,
 *   tracks:Object<string,string>, milestones:Object<string,string>}}>} keys normEn'd
 * @throws on a bad key, a missing file, corrupt ciphertext or an empty memory.
 */
export async function fetchTrackerTranslations(dataKeyHex, {
  url = 'data/tracker-ar.enc', fetchImpl = fetch,
} = {}) {
  const keyHex = typeof dataKeyHex === 'string' ? dataKeyHex.trim() : '';
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('مفتاح فك تشفير البيانات غير صالح — يجب أن يكون 64 خانة ست عشرية (hex).');
  }

  const res = await fetchImpl(url, { cache: 'no-store' });
  if (!res || !res.ok) {
    const status = res ? res.status : '?';
    if (status === 404) throw new Error('ملف ترجمة المهام المشفر غير متوفر.');
    throw new Error(`فشل تحميل ملف ترجمة المهام المشفر (HTTP ${status})`);
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
    // Never echo the plaintext or the exception text: it could carry project content.
    throw new Error('فشل فك تشفير ملف ترجمة المهام — تحقق من مفتاح البيانات');
  }

  // Re-normalised on the way in (sanitizeEntries → normEn): a file built by an older
  // script, or by hand, still keys the way applyTrackerTranslations looks up.
  const entries = sanitizeEntries(payload && typeof payload === 'object' ? payload.entries : null);
  const count = Object.keys(entries.tasks).length + Object.keys(entries.tracks).length
    + Object.keys(entries.milestones).length;
  if (!count) throw new Error('ملف ترجمة المهام فارغ أو تالف.');
  return {
    generatedAt: payload && typeof payload.generatedAt === 'string' ? payload.generatedAt : '',
    entries,
  };
}

/**
 * The forgiving form used by the screens / automation: resolves to null instead of
 * throwing, so a missing key, an offline load or an absent file simply means "no
 * built-in translations" (the tasks show in English, or from the other layers).
 */
export async function loadTrackerTranslations(dataKeyHex, opts) {
  try {
    return await fetchTrackerTranslations(dataKeyHex, opts);
  } catch (e) {
    console.warn('[tracker-ar] built-in translations unavailable', e && e.message);
    return null;
  }
}

export default fetchTrackerTranslations;
