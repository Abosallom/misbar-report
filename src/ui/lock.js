// lock.js — cryptographic access gate for the static Misbar site.
//
// The site ships a sealed blob at data/access.seal:
//   base64( salt(16) || iv(12) || AES-256-GCM ciphertext(+16B tag) )
// Key   = PBKDF2-SHA256(passphrase, salt, 310000 iterations) → AES-256-GCM (256b).
// Plain = UTF-8 JSON { grafana:{baseUrl,accessToken,panelId,dataKey}, grantedAt }.
//
// Visitors see a full-viewport lock screen until they enter the correct access
// phrase. Unlock = fetch+unseal the blob → merge grafana config into settings
// via the store → set an unlocked marker in localStorage → onUnlocked(). A wrong
// phrase surfaces a clear Arabic error with no lockout counter.
//
// IMPORTANT: this module is DOM-free at the top level so Node can import the
// crypto primitives (seal/unseal + SEAL constants) — the DOM is only touched
// inside renderLock(). Crypto uses crypto.subtle only (browser + Node 20), no deps.

// ---- shared crypto constants (imported by scripts/make-seal.mjs) ------------
export const SEAL = Object.freeze({
  SALT_BYTES: 16,
  IV_BYTES: 12,
  TAG_BYTES: 16, // AES-GCM auth tag appended to ciphertext by WebCrypto
  PBKDF2_ITERATIONS: 310000,
  HASH: 'SHA-256',
  CIPHER: 'AES-GCM',
  KEY_BITS: 256,
});

/** localStorage marker written on unlock; value = {at: ISO}. */
export const UNLOCKED_KEY = 'misbar.unlocked.v1';
/** Sealed-blob URL, relative to the document (works under a GH Pages subpath). */
export const SEAL_URL = 'data/access.seal';

// ---- base64 <-> bytes (btoa/atob are global in browsers AND Node 20) --------
function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(String(b64).trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- crypto core ------------------------------------------------------------
function subtleCrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('WEBCRYPTO_UNAVAILABLE');
  return c;
}

async function deriveKey(passphrase, salt, usages) {
  const c = subtleCrypto();
  const baseKey = await c.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(passphrase)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: SEAL.PBKDF2_ITERATIONS, hash: SEAL.HASH },
    baseKey,
    { name: SEAL.CIPHER, length: SEAL.KEY_BITS },
    false,
    usages,
  );
}

/**
 * Seal a payload into the base64 blob format. Pure — used by make-seal.mjs and
 * the tests. A fresh random salt+iv is generated on every call.
 * @param {string} passphrase
 * @param {object|string} payload  object (JSON-stringified) or a raw JSON string
 * @returns {Promise<string>} base64( salt || iv || ciphertext+tag )
 */
export async function seal(passphrase, payload) {
  const c = subtleCrypto();
  const salt = c.getRandomValues(new Uint8Array(SEAL.SALT_BYTES));
  const iv = c.getRandomValues(new Uint8Array(SEAL.IV_BYTES));
  const key = await deriveKey(passphrase, salt, ['encrypt']);
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const ctBuf = await c.subtle.encrypt(
    { name: SEAL.CIPHER, iv },
    key,
    new TextEncoder().encode(text),
  );
  const ct = new Uint8Array(ctBuf);
  const out = new Uint8Array(salt.length + iv.length + ct.length);
  out.set(salt, 0);
  out.set(iv, salt.length);
  out.set(ct, salt.length + iv.length);
  return bytesToB64(out);
}

/**
 * Unseal the base64 blob back into the payload object. Pure — used by the lock
 * screen and the tests. Throws:
 *   'WEBCRYPTO_UNAVAILABLE' — no crypto.subtle
 *   'SEAL_MALFORMED'        — blob too short to hold salt+iv+tag
 *   'BAD_PASSPHRASE'        — GCM auth failure (wrong phrase OR tampered bytes)
 *   'SEAL_CORRUPT'          — decrypts but plaintext is not JSON
 * @param {string} passphrase
 * @param {string} sealB64
 * @returns {Promise<object>}
 */
export async function unseal(passphrase, sealB64) {
  const c = subtleCrypto();
  const bytes = b64ToBytes(sealB64);
  const min = SEAL.SALT_BYTES + SEAL.IV_BYTES + SEAL.TAG_BYTES;
  if (bytes.length < min) throw new Error('SEAL_MALFORMED');
  const salt = bytes.subarray(0, SEAL.SALT_BYTES);
  const iv = bytes.subarray(SEAL.SALT_BYTES, SEAL.SALT_BYTES + SEAL.IV_BYTES);
  const ct = bytes.subarray(SEAL.SALT_BYTES + SEAL.IV_BYTES);
  const key = await deriveKey(passphrase, salt, ['decrypt']);
  let ptBuf;
  try {
    ptBuf = await c.subtle.decrypt({ name: SEAL.CIPHER, iv }, key, ct);
  } catch (_e) {
    throw new Error('BAD_PASSPHRASE'); // GCM tag mismatch = wrong key or tamper
  }
  const text = new TextDecoder().decode(ptBuf);
  try {
    return JSON.parse(text);
  } catch (_e) {
    throw new Error('SEAL_CORRUPT');
  }
}

// ---- lock state (store-backed) ----------------------------------------------
/**
 * True when this device is already unlocked: the marker is present AND the
 * store's grafana.dataKey is non-empty. Fully try/catch-safe — any failure
 * (denied storage, missing store) resolves to false so the lock re-shows.
 * @param {{loadSettings:Function}} store
 * @returns {boolean}
 */
export function isUnlocked(store) {
  try {
    const raw = globalThis.localStorage.getItem(UNLOCKED_KEY);
    if (!raw) return false;
    const marker = JSON.parse(raw);
    if (!marker || typeof marker.at !== 'string') return false;
    const s = store.loadSettings();
    return !!(s && s.grafana && typeof s.grafana.dataKey === 'string' && s.grafana.dataKey.length > 0);
  } catch (_e) {
    return false;
  }
}

/**
 * Return the device to the locked state: remove the marker AND blank the
 * sensitive grafana fields (accessToken + dataKey) in settings via the store.
 * @param {{loadSettings:Function, saveSettings:Function}} store
 */
export function lock(store) {
  try {
    globalThis.localStorage.removeItem(UNLOCKED_KEY);
  } catch (_e) { /* denied storage — nothing to remove */ }
  try {
    const s = store.loadSettings();
    const next = {
      ...s,
      grafana: { ...(s.grafana || {}), accessToken: '', dataKey: '' },
    };
    store.saveSettings(next);
  } catch (_e) { /* store unavailable — leave settings as-is */ }
}

/**
 * Merge an unsealed payload's grafana config into settings and write the
 * unlocked marker. Exported for reuse/testing; called by renderLock on success.
 * @param {{loadSettings:Function, saveSettings:Function}} store
 * @param {object} payload  unsealed { grafana:{...}, grantedAt }
 */
export function applyUnlock(store, payload) {
  const g = payload && typeof payload === 'object' && payload.grafana ? payload.grafana : {};
  const s = store.loadSettings();
  const merged = { ...(s.grafana || {}), enabled: true };
  if (typeof g.baseUrl === 'string') merged.baseUrl = g.baseUrl;
  if (typeof g.accessToken === 'string') merged.accessToken = g.accessToken;
  if (typeof g.panelId === 'number' && Number.isFinite(g.panelId)) merged.panelId = g.panelId;
  if (typeof g.dataKey === 'string') merged.dataKey = g.dataKey;
  store.saveSettings({ ...s, grafana: merged });
  try {
    globalThis.localStorage.setItem(UNLOCKED_KEY, JSON.stringify({ at: new Date().toISOString() }));
  } catch (_e) { /* marker write failed (private mode) — settings still hold */ }
}

// ---- lock screen (DOM; only referenced inside this function) ----------------
/**
 * Render a full-viewport lock screen into `container`. Inline styles only.
 * On a correct phrase: fetch+unseal data/access.seal → merge grafana config →
 * set marker → onUnlocked(). Errors are shown in Arabic; no lockout counter.
 * @param {HTMLElement} container
 * @param {{store:object, onUnlocked:Function}} ctx
 */
export function renderLock(container, { store, onUnlocked } = {}) {
  container.textContent = '';

  const root = document.createElement('div');
  root.setAttribute('dir', 'rtl');
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '9999',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxSizing: 'border-box', padding: '24px',
    background: 'radial-gradient(1200px 600px at 50% -10%, #143a6b 0%, #0b1f3a 55%, #081428 100%)',
    fontFamily: "'Segoe UI', Tahoma, 'Noto Sans Arabic', sans-serif",
    color: '#e8eef7',
  });

  const card = document.createElement('form');
  Object.assign(card.style, {
    width: '100%', maxWidth: '380px', boxSizing: 'border-box',
    background: '#0f294d', border: '1px solid #1e3f70', borderRadius: '16px',
    padding: '34px 28px 30px', textAlign: 'center',
    boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
  });

  const icon = document.createElement('div');
  icon.textContent = 'م';
  Object.assign(icon.style, {
    width: '74px', height: '74px', lineHeight: '74px', margin: '0 auto 20px',
    borderRadius: '20px', background: 'linear-gradient(135deg,#3b7bff,#1b4fc4)',
    color: '#fff', fontSize: '40px', fontWeight: '800',
  });

  const title = document.createElement('h1');
  title.textContent = 'بوابة تقرير مسبار';
  Object.assign(title.style, { margin: '0 0 8px', fontSize: '22px', fontWeight: '700' });

  const subtitle = document.createElement('p');
  subtitle.textContent = 'أدخل عبارة الوصول للمتابعة';
  Object.assign(subtitle.style, { margin: '0 0 24px', fontSize: '14px', color: '#9db4d6' });

  const inputWrap = document.createElement('div');
  Object.assign(inputWrap.style, { position: 'relative', marginBottom: '14px' });

  const input = document.createElement('input');
  input.type = 'password';
  input.autocomplete = 'off';
  input.placeholder = 'عبارة الوصول';
  input.setAttribute('aria-label', 'عبارة الوصول');
  Object.assign(input.style, {
    width: '100%', boxSizing: 'border-box',
    padding: '13px 16px 13px 66px', // room for the toggle on the (visual) left
    borderRadius: '10px', border: '1px solid #2a4c82', background: '#0a1e3c',
    color: '#e8eef7', fontSize: '15px', outline: 'none', textAlign: 'right',
  });

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'إظهار';
  Object.assign(toggle.style, {
    position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
    background: 'transparent', border: 'none', color: '#7fa8e6',
    fontSize: '13px', cursor: 'pointer', padding: '4px 6px',
  });
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'إخفاء' : 'إظهار';
    input.focus();
  });

  inputWrap.appendChild(input);
  inputWrap.appendChild(toggle);

  const error = document.createElement('div');
  Object.assign(error.style, {
    minHeight: '18px', margin: '2px 0 14px', fontSize: '13px',
    color: '#ff8f8f', textAlign: 'right', visibility: 'hidden',
  });
  error.setAttribute('role', 'alert');
  error.textContent = ' ';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'دخول';
  Object.assign(submit.style, {
    width: '100%', boxSizing: 'border-box', padding: '13px 16px',
    borderRadius: '10px', border: 'none', cursor: 'pointer',
    background: 'linear-gradient(135deg,#3b7bff,#1b4fc4)', color: '#fff',
    fontSize: '16px', fontWeight: '700',
  });

  const setLoading = (on) => {
    submit.disabled = on;
    input.disabled = on;
    submit.style.opacity = on ? '0.6' : '1';
    submit.style.cursor = on ? 'default' : 'pointer';
    submit.textContent = on ? 'جارٍ التحقق…' : 'دخول';
  };
  const showError = (msg) => {
    error.textContent = msg;
    error.style.visibility = 'visible';
  };
  const clearError = () => {
    error.textContent = ' ';
    error.style.visibility = 'hidden';
  };

  card.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phrase = input.value;
    if (!phrase) { showError('أدخل عبارة الوصول'); return; }
    clearError();
    setLoading(true);

    // 1) fetch the sealed blob
    let sealB64;
    try {
      const res = await fetch(SEAL_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('SEAL_404');
      sealB64 = (await res.text()).trim();
      if (!sealB64) throw new Error('SEAL_404');
    } catch (_e) {
      setLoading(false);
      showError('ملف الوصول غير متوفر');
      return;
    }

    // 2) unseal with the phrase
    let payload;
    try {
      payload = await unseal(phrase, sealB64);
    } catch (err) {
      setLoading(false);
      if (err && err.message === 'WEBCRYPTO_UNAVAILABLE') {
        showError('المتصفح لا يدعم التشفير المطلوب');
      } else {
        showError('عبارة الوصول غير صحيحة');
      }
      return;
    }

    // 3) merge config + set marker
    try {
      applyUnlock(store, payload);
    } catch (_e) {
      setLoading(false);
      showError('تعذّر حفظ الإعدادات');
      return;
    }

    setLoading(false);
    if (typeof onUnlocked === 'function') onUnlocked();
  });

  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(subtitle);
  card.appendChild(inputWrap);
  card.appendChild(error);
  card.appendChild(submit);
  root.appendChild(card);
  container.appendChild(root);

  // Focus the phrase field once mounted.
  try { input.focus(); } catch (_e) { /* non-interactive host */ }

  return root;
}
