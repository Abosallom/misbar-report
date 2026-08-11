// lock.js — cryptographic sign-in gate for the static Misbar site.
//
// TWO WAYS IN, ONE OUTCOME. Both release the same payload — the Grafana config
// ({baseUrl, accessToken, panelId, dataKey}) that lets this device decrypt the
// published snapshot — and both end in applyUnlock().
//
//   1. PER-USER ACCOUNT (preferred). data/users.json holds one independently
//      sealed copy of the payload per colleague, each under that person's own
//      password. src/auth/users.js does the unsealing; this module only asks.
//      Revoking one person = deleting their row, which touches nobody else.
//   2. SHARED PASSPHRASE (legacy fallback). data/access.seal, the original
//      single-phrase blob, unsealed with whatever is in the password field.
//      Every device and phrase that worked before this change still works.
//
// The per-user path is attempted first and only when a username was typed; if
// users.json is missing, unreadable, or src/auth/users.js has not shipped, the
// gate degrades silently to the shared phrase rather than locking everyone out.
//
// Sealed-blob format (identical for access.seal and every users.json row):
//   base64( salt(16) || iv(12) || AES-256-GCM ciphertext(+16B tag) )
// Key   = PBKDF2-SHA256(secret, salt, 310000 iterations) → AES-256-GCM (256b).
//
// HONEST SECURITY MODEL — this is client-side auth on a static host. Both
// data/users.json and data/access.seal are PUBLIC files: anyone can download
// them and mount an OFFLINE brute-force. There is no server, so there is no
// real rate limiting. The mitigations are a high PBKDF2 iteration count, a
// per-user random salt, and strong passwords enforced by the account tool. The
// ~600 ms post-failure delay here only blunts casual scripted guessing AGAINST
// THE PAGE; it does nothing for an attacker working offline. Say so out loud
// rather than implying the gate is stronger than it is.
//
// PASSWORDS ARE NEVER PERSISTED. On success the device remembers the unlocked
// marker and the DISPLAY USERNAME only — never the password, and it is never
// logged or echoed. Failures show ONE generic Arabic message that does not
// disclose whether the username or the password was the wrong half.
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
/** localStorage marker for WHO signed in; value = {u: string, at: ISO}. Display
 *  name only — the password is never written here or anywhere else. */
export const USER_KEY = 'misbar.user.v1';
/** Sealed-blob URL, relative to the document (works under a GH Pages subpath). */
export const SEAL_URL = 'data/access.seal';
/** Per-user account file, same relative-URL rules as SEAL_URL. PUBLIC by nature. */
export const USERS_URL = 'data/users.json';
/** Track 1's auth module. Imported lazily so its absence degrades, not breaks. */
export const AUTH_MODULE_URL = '../auth/users.js?v=v2026-08-11.1';

/** Longest display username we will store or paint. Guards the app bar chip. */
const MAX_USERNAME = 64;
/** Deliberate pause after a bad credential pair before submit re-enables. */
export const FAIL_DELAY_MS = 600;
/** The ONLY credential-failure message. Never says which half was wrong. */
export const GENERIC_AUTH_ERROR = 'اسم المستخدم أو كلمة المرور غير صحيحة';

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
 * Who is signed in on this device, or null. The value is a DISPLAY USERNAME
 * only — it is what the app bar paints and carries no authority of its own
 * (isUnlocked() is what actually gates the app). A shared-passphrase sign-in
 * identifies nobody, so it deliberately leaves this null.
 * @returns {string|null}
 */
export function currentUser() {
  try {
    const raw = globalThis.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const marker = JSON.parse(raw);
    const u = marker && typeof marker.u === 'string' ? marker.u.trim() : '';
    return u ? u.slice(0, MAX_USERNAME) : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Record (or clear, when falsy) the signed-in display username. Passwords are
 * never an input here. Exported so main.js can forget the user defensively.
 * @param {string|null|undefined} username
 */
export function rememberUser(username) {
  const u = typeof username === 'string' ? username.trim().slice(0, MAX_USERNAME) : '';
  try {
    if (!u) globalThis.localStorage.removeItem(USER_KEY);
    else globalThis.localStorage.setItem(USER_KEY, JSON.stringify({ u, at: new Date().toISOString() }));
  } catch (_e) { /* denied storage — the app bar simply shows no chip */ }
}

/**
 * Sign out / return the device to the locked state: remove BOTH markers (the
 * unlocked flag and the remembered username) AND blank the sensitive grafana
 * fields (accessToken + dataKey) in settings via the store.
 * @param {{loadSettings:Function, saveSettings:Function}} store
 */
export function lock(store) {
  try {
    globalThis.localStorage.removeItem(UNLOCKED_KEY);
  } catch (_e) { /* denied storage — nothing to remove */ }
  rememberUser(null);
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
 * @param {string} [username]  display username to remember. Omitted/empty (the
 *   shared-passphrase path, which identifies nobody) CLEARS any stale name so
 *   the app bar can never attribute a session to the wrong person.
 */
export function applyUnlock(store, payload, username) {
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
  rememberUser(username);
}

// ---- credential resolution (network + Track 1's auth module) ----------------
/**
 * Load Track 1's per-user auth module, or null when it has not shipped / does
 * not satisfy the contract. `injected` is a test seam (renderLock's ctx.auth).
 * @param {object} [injected]
 * @returns {Promise<{unsealForUser:Function, normalizeUsername?:Function}|null>}
 */
async function resolveAuthModule(injected) {
  if (injected && typeof injected.unsealForUser === 'function') return injected;
  try {
    const mod = await import(AUTH_MODULE_URL);
    return (mod && typeof mod.unsealForUser === 'function') ? mod : null;
  } catch (_e) {
    return null; // module absent — the shared phrase is still a way in
  }
}

/**
 * Fetch + shape-check data/users.json. Never throws.
 * `reachable:false` — the file could not be loaded at all (network throw,
 * non-OK status, or the body died mid-read): a CONNECTIVITY/DEPLOYMENT problem
 * the caller may want to name instead of blaming the user's credentials.
 * `doc:null` with `reachable:true` — loaded fine but the shape is wrong:
 * degrade silently to the shared phrase, exactly as before.
 * @returns {Promise<{doc:object|null, reachable:boolean}>}
 */
async function fetchUsers() {
  let doc;
  try {
    const res = await fetch(USERS_URL, { cache: 'no-store' });
    if (!res.ok) return { doc: null, reachable: false };
    doc = await res.json();
  } catch (_e) {
    return { doc: null, reachable: false };
  }
  return {
    doc: (doc && typeof doc === 'object' && Array.isArray(doc.users)) ? doc : null,
    reachable: true,
  };
}

/** Fetch the legacy shared seal. Throws 'SEAL_UNAVAILABLE' when not reachable. */
async function fetchSeal() {
  let text = '';
  try {
    const res = await fetch(SEAL_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('SEAL_UNAVAILABLE');
    text = (await res.text()).trim();
  } catch (_e) {
    throw new Error('SEAL_UNAVAILABLE');
  }
  if (!text) throw new Error('SEAL_UNAVAILABLE');
  return text;
}

/**
 * Resolve one credential pair to a payload. Per-user account first (only when a
 * username was typed), shared passphrase second. The password is used and
 * dropped; it is never stored, logged, or returned.
 *
 * Throws 'SEAL_UNAVAILABLE' (deployment problem), 'WEBCRYPTO_UNAVAILABLE'
 * (browser problem), 'USERS_UNAVAILABLE' (a username was typed but users.json
 * could not be LOADED — flaky network, not wrong credentials — and the shared
 * seal did not match either) or 'BAD_PASSPHRASE' (credential problem) — the
 * caller maps the last one, and anything unexpected, onto GENERIC_AUTH_ERROR.
 * 'USERS_UNAVAILABLE' leaks nothing about which accounts exist: it depends only
 * on network state, never on whether the typed username matches a row.
 *
 * @param {{username?:string, password:string, auth?:object}} o
 * @returns {Promise<{payload:object, user:string|null}>} user = display name,
 *   or null when the shared phrase (which identifies nobody) was what matched.
 */
export async function signIn({ username, password, auth } = {}) {
  const name = typeof username === 'string' ? username.trim() : '';
  let usersUnreachable = false;

  if (name) {
    const mod = await resolveAuthModule(auth);
    let users = null;
    if (mod) {
      const fetched = await fetchUsers();
      users = fetched.doc;
      usersUnreachable = !fetched.reachable;
    }
    if (mod && users) {
      let payload = null;
      try {
        payload = await mod.unsealForUser({ users, username: name, password });
      } catch (_e) {
        payload = null; // a throwing auth module must not strand the fallback
      }
      if (payload && typeof payload === 'object') {
        let display = name;
        try {
          if (typeof mod.normalizeUsername === 'function') {
            const n = mod.normalizeUsername(name);
            if (typeof n === 'string' && n) display = n;
          }
        } catch (_e) { /* keep the typed name */ }
        return { payload, user: display };
      }
    }
  }

  // Legacy shared passphrase — the password field alone, exactly as before.
  try {
    const payload = await unseal(password, await fetchSeal());
    return { payload, user: null };
  } catch (err) {
    // Their personal password was never even CHECKED (users.json unreachable),
    // so a seal mismatch here means connectivity, not bad credentials.
    if (usersUnreachable && err && err.message === 'BAD_PASSPHRASE') {
      throw new Error('USERS_UNAVAILABLE');
    }
    throw err;
  }
}

// ---- sign-in screen (DOM; only referenced inside renderLock) ----------------
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Which palette the gate paints in. The gate renders BEFORE the app shell, so
 * the theme toggle does not exist yet and the choice cannot change while the
 * gate is up — reading it once at mount is enough. Mirrors main.js: an explicit
 * data-theme wins, otherwise follow the OS.
 * @returns {'dark'|'light'}
 */
function gateTheme() {
  try {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  } catch (_e) {
    return 'dark';
  }
}

/* Inline-style palettes. The gate cannot use the app's class-based CSS tokens
   because it paints into a bare #app-shell before any stylesheet-driven screen
   mounts, so both themes are spelled out here — values taken from styles/app.css
   (:root for light, the dark-mode block for dark) so the gate and the app agree. */
const GATE_PALETTES = Object.freeze({
  dark: {
    backdrop: 'radial-gradient(1200px 600px at 50% -10%, #143a6b 0%, #0b1f3a 55%, #081428 100%)',
    text: '#e8eef7', muted: '#9db4d6', label: '#c3d2ea',
    card: '#0f294d', cardBorder: '#1e3f70', cardShadow: '0 24px 70px rgba(0,0,0,0.5)',
    field: '#0a1e3c', fieldBorder: '#2a4c82', fieldFocus: '#5b90ee',
    accent: 'linear-gradient(135deg,#3b7bff,#1b4fc4)', link: '#7fa8e6', error: '#ff8f8f',
  },
  light: {
    backdrop: 'radial-gradient(1200px 600px at 50% -10%, #dbe7fb 0%, #eef3fb 55%, #f8fafc 100%)',
    text: '#1e293b', muted: '#64748b', label: '#334155',
    card: '#ffffff', cardBorder: '#e2e8f0', cardShadow: '0 24px 70px rgba(15,23,42,0.14)',
    field: '#f8fafc', fieldBorder: '#cbd5e1', fieldFocus: '#2563eb',
    accent: 'linear-gradient(135deg,#2563eb,#1e3a8a)', link: '#2563eb', error: '#dc2626',
  },
});

/**
 * Render the full-viewport sign-in gate into `container`. Inline styles only.
 *
 * On submit: per-user account (username + password) first, shared passphrase
 * (password field alone) second → merge grafana config into settings → mark the
 * device unlocked → remember the display username → onUnlocked(). Every
 * credential failure produces the SAME message after a ~600 ms pause.
 *
 * @param {HTMLElement} container
 * @param {{store:object, onUnlocked:Function, auth?:object}} ctx
 *   `auth` injects a Track 1-shaped auth module ({unsealForUser, normalizeUsername})
 *   in place of the lazy import — a test seam, unused in production.
 * @returns {HTMLElement} the gate root
 */
export function renderLock(container, { store, onUnlocked, auth } = {}) {
  container.textContent = '';
  const C = GATE_PALETTES[gateTheme()];

  const root = document.createElement('div');
  root.setAttribute('dir', 'rtl');
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '9999',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxSizing: 'border-box', padding: 'clamp(12px, 4vw, 24px)', overflowY: 'auto',
    background: C.backdrop,
    fontFamily: "'Cairo', 'Segoe UI', Tahoma, 'Noto Sans Arabic', sans-serif",
    color: C.text,
  });

  const card = document.createElement('form');
  card.setAttribute('aria-labelledby', 'misbar-gate-title');
  Object.assign(card.style, {
    width: '100%', maxWidth: '380px', boxSizing: 'border-box',
    background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: '16px',
    padding: '30px 22px 26px', textAlign: 'center', boxShadow: C.cardShadow,
  });

  const icon = document.createElement('div');
  icon.textContent = 'م';
  Object.assign(icon.style, {
    width: '74px', height: '74px', lineHeight: '74px', margin: '0 auto 18px',
    borderRadius: '20px', background: C.accent,
    color: '#fff', fontSize: '40px', fontWeight: '800',
  });

  const title = document.createElement('h1');
  title.id = 'misbar-gate-title';
  title.textContent = 'بوابة تقرير مسبار';
  Object.assign(title.style, { margin: '0 0 8px', fontSize: '22px', fontWeight: '700' });

  const subtitle = document.createElement('p');
  subtitle.textContent = 'سجّل الدخول بحسابك للاطلاع على التقارير';
  Object.assign(subtitle.style, { margin: '0 0 22px', fontSize: '14px', color: C.muted });

  /* One labelled field. Values are latin/digits, so each input is dir="ltr"
     (per the repo rule) but stays right-aligned to sit correctly in the RTL
     card. `padLeft` leaves room for the show/hide button on the password field. */
  const field = (id, name, labelText, type, autocomplete, padLeft) => {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position: 'relative', margin: '0 0 14px', textAlign: 'right' });

    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = labelText;
    Object.assign(label.style, {
      display: 'block', margin: '0 2px 6px', fontSize: '13px',
      fontWeight: '600', color: C.label,
    });

    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.name = name;
    input.autocomplete = autocomplete; // lets the browser offer to save/fill
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('dir', 'ltr');
    Object.assign(input.style, {
      width: '100%', boxSizing: 'border-box',
      padding: '13px 16px 13px ' + padLeft,
      borderRadius: '10px', border: '1px solid ' + C.fieldBorder, background: C.field,
      color: C.text, fontSize: '15px', outline: 'none', textAlign: 'right',
    });
    input.addEventListener('focus', () => { input.style.borderColor = C.fieldFocus; });
    input.addEventListener('blur', () => { input.style.borderColor = C.fieldBorder; });

    wrap.appendChild(label);
    wrap.appendChild(input);
    return { wrap, input };
  };

  const userField = field('misbar-username', 'username', 'اسم المستخدم', 'text', 'username', '16px');
  const passField = field('misbar-password', 'password', 'كلمة المرور', 'password', 'current-password', '66px');
  const userInput = userField.input;
  const passInput = passField.input;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'إظهار';
  toggle.setAttribute('aria-label', 'إظهار كلمة المرور');
  Object.assign(toggle.style, {
    position: 'absolute', left: '8px', bottom: '9px',
    background: 'transparent', border: 'none', color: C.link,
    fontSize: '13px', cursor: 'pointer', padding: '4px 6px',
  });
  toggle.addEventListener('click', () => {
    const show = passInput.type === 'password';
    passInput.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'إخفاء' : 'إظهار';
    toggle.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    passInput.focus();
  });
  passField.wrap.appendChild(toggle);

  const error = document.createElement('div');
  Object.assign(error.style, {
    minHeight: '18px', margin: '2px 0 14px', fontSize: '13px',
    color: C.error, textAlign: 'right', visibility: 'hidden',
  });
  error.setAttribute('role', 'alert');
  error.textContent = ' ';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'تسجيل الدخول';
  Object.assign(submit.style, {
    width: '100%', boxSizing: 'border-box', padding: '13px 16px',
    borderRadius: '10px', border: 'none', cursor: 'pointer',
    background: C.accent, color: '#fff', fontSize: '16px', fontWeight: '700',
  });

  // What a first-time colleague needs to know: there is no self-signup here.
  const hint = document.createElement('p');
  hint.textContent = 'لطلب حساب، تواصل مع عبدالعزيز السلوم';
  Object.assign(hint.style, {
    margin: '16px 0 0', fontSize: '12.5px', lineHeight: '1.7', color: C.muted,
  });

  const setLoading = (on) => {
    submit.disabled = on;
    userInput.disabled = on;
    passInput.disabled = on;
    toggle.disabled = on;
    submit.style.opacity = on ? '0.6' : '1';
    submit.style.cursor = on ? 'default' : 'pointer';
    submit.textContent = on ? 'جارٍ التحقق…' : 'تسجيل الدخول';
  };
  const showError = (msg) => {
    error.textContent = msg;
    error.style.visibility = 'visible';
  };
  const clearError = () => {
    error.textContent = ' ';
    error.style.visibility = 'hidden';
  };

  card.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = userInput.value.trim();
    const password = passInput.value;
    if (!password) { showError('أدخل كلمة المرور'); passInput.focus(); return; }
    clearError();
    setLoading(true);

    // 1) resolve the credentials — per-user account, else shared passphrase
    let result;
    try {
      result = await signIn({ username, password, auth });
    } catch (err) {
      const code = err && err.message;
      if (code === 'SEAL_UNAVAILABLE') {
        setLoading(false);
        showError('ملف الوصول غير متوفر');
        return;
      }
      if (code === 'WEBCRYPTO_UNAVAILABLE') {
        setLoading(false);
        showError('المتصفح لا يدعم التشفير المطلوب');
        return;
      }
      // Their password was never checked against their account — users.json
      // would not load (flaky network / partial cache hit). Blame connectivity,
      // not their credentials, or they will ask for a needless password reset.
      if (code === 'USERS_UNAVAILABLE') {
        setLoading(false);
        showError('تعذّر تحميل ملف الحسابات — تحقق من الاتصال ثم أعد المحاولة');
        return;
      }
      // Wrong username, wrong password, or a wrong pair — indistinguishable on
      // purpose, and slowed down on purpose. See the security note up top.
      await sleep(FAIL_DELAY_MS);
      setLoading(false);
      showError(GENERIC_AUTH_ERROR);
      try { passInput.focus(); passInput.select(); } catch (_e2) { /* non-interactive host */ }
      return;
    }

    // 2) merge config + set markers (display username only, never the password)
    try {
      applyUnlock(store, result.payload, result.user);
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
  card.appendChild(userField.wrap);
  card.appendChild(passField.wrap);
  card.appendChild(error);
  card.appendChild(submit);
  card.appendChild(hint);
  root.appendChild(card);
  container.appendChild(root);

  // Focus the username field once mounted.
  try { userInput.focus(); } catch (_e) { /* non-interactive host */ }

  return root;
}
