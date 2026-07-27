// users.js — per-user accounts for the static Misbar site.
//
// WHAT THIS IS. The site used to be gated by ONE shared passphrase (src/ui/lock.js,
// data/access.seal). This module adds per-user accounts on top of the same idea: each
// colleague gets a username + password, and their record holds a private copy of the
// SAME payload the shared seal holds (the Grafana config: accessToken + dataKey).
// Signing in decrypts that copy. Revoking one person = deleting one record; nobody
// else is disturbed, and the shared passphrase keeps working as the legacy fallback.
//
// FILE FORMAT — data/users.json, served PUBLICLY like every other static asset:
//   { "v": 1, "iterations": 310000,
//     "users": [ { "u": "aziz", "salt": "b64(16)", "iv": "b64(12)", "ct": "b64" } ] }
// Per record: key = PBKDF2-SHA256(`${normalizeUsername(u)}\u0000${password}`, salt,
// 310000) → AES-256-GCM(256b); ct = that key over UTF-8 JSON of the payload.
//
// WHY THE USERNAME IS INSIDE THE KDF INPUT. If the key came from the password alone,
// anyone could copy Badr's record, rewrite its "u" to "aziz", and Badr's password would
// unseal it under Aziz's name. Feeding the normalized username into the PBKDF2 input
// binds the ciphertext to the name it is filed under, so a record is worthless outside
// its own row. test/users.test.mjs proves this ("sealed for A does not open under B").
//
// HONEST SECURITY MODEL — READ THIS BEFORE TRUSTING IT.
// There is no server here. data/users.json is downloadable by anyone who can load the
// page, so an attacker can take it away and mount an OFFLINE brute-force against any
// user's password at whatever rate their hardware allows. Nothing in this file can
// rate-limit, lock out, or even observe that attempt. The only real defences are:
//   1. a high PBKDF2 iteration count (310000), which sets the per-guess cost, and
//   2. a genuinely strong password, which scripts/make-user.mjs REFUSES to skip.
// Treat this as "keeps the honest public out and lets Aziz revoke one person", NOT as
// protection against a determined attacker who has the file. Do not put anything here
// that would be catastrophic to lose.
//
// PURITY. No DOM, no imports, no dependencies — WebCrypto only, so this runs unchanged
// in the browser and in Node (crypto.subtle, btoa/atob are global in both). The base64
// helpers are duplicated from lock.js on purpose rather than imported: this module must
// stay standalone so scripts and tests can pull it in without dragging in lock-screen
// DOM code. Nothing here ever logs, throws, or echoes a password.

/**
 * PBKDF2 rounds used when SEALING a user record (scripts/make-user.mjs writes this same
 * number into data/users.json as "iterations", so file and rows always agree). Matches
 * SEAL.PBKDF2_ITERATIONS in lock.js so the two gates cost the same per guess — bump both
 * together if it ever moves. On the UNSEAL side the file's own declared "iterations" is
 * honoured when sane (see declaredIterations), so rows sealed under an older count keep
 * opening after a bump instead of a fleet-wide silent lockout; this constant is only the
 * fallback for files that declare nothing (bare arrays) or nonsense.
 * @type {number}
 */
export const PBKDF2_ITERATIONS = 310000;

/**
 * Sanity clamp for a file-declared iteration count. Outside this range we ignore the
 * declaration and fall back to PBKDF2_ITERATIONS: below the floor a (tampered) file
 * would be asking us to derive at a discount, above the ceiling it could stall the
 * browser for minutes per record. Wrong-but-sane declarations simply fail decryption,
 * which collapses into the same generic null as a wrong password.
 */
const MIN_ITERATIONS = 100000;
const MAX_ITERATIONS = 2000000;

/**
 * The PBKDF2 iteration count a parsed users.json declares for its rows, or
 * PBKDF2_ITERATIONS when it declares nothing usable. Accepts only an integer within
 * [MIN_ITERATIONS, MAX_ITERATIONS]; bare record arrays carry no declaration.
 * @param {object|Array} users parsed data/users.json object, or a bare record array
 * @returns {number}
 */
function declaredIterations(users) {
  if (users && typeof users === 'object' && !Array.isArray(users)
    && Number.isInteger(users.iterations)
    && users.iterations >= MIN_ITERATIONS && users.iterations <= MAX_ITERATIONS) {
    return users.iterations;
  }
  return PBKDF2_ITERATIONS;
}

/** Random salt bytes per user record. */
const SALT_BYTES = 16;
/** AES-GCM nonce bytes per user record. */
const IV_BYTES = 12;
/** AES-GCM auth tag, appended to the ciphertext by WebCrypto. */
const TAG_BYTES = 16;
const HASH = 'SHA-256';
const CIPHER = 'AES-GCM';
const KEY_BITS = 256;

/** Separator between username and password in the KDF input. */
const BIND_SEP = '\u0000';

// ---- base64 <-> bytes (btoa/atob are global in browsers AND Node) -----------
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

function subtleCrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('WEBCRYPTO_UNAVAILABLE');
  return c;
}

// ---- usernames ---------------------------------------------------------------
/**
 * Canonical form of a username. USERNAMES ARE CASE-INSENSITIVE: "Aziz", "AZIZ" and
 * "  aziz  " are the same account. Also NFKC-normalised (so visually identical Unicode
 * spellings collapse to one), trimmed, and internal whitespace runs collapse to a single
 * space — "Az  Alsaloom" and "az alsaloom" are the same person.
 *
 * This exact function feeds both the stored "u" field and the KDF input, so storage and
 * derivation can never disagree about who a record belongs to. Locale-independent
 * toLowerCase() is deliberate (toLocaleLowerCase would map Turkish "I" differently on a
 * Turkish device and lock that user out of their own account).
 *
 * @param {unknown} u
 * @returns {string} normalized username ('' for null/undefined/blank input)
 */
export function normalizeUsername(u) {
  if (u == null) return '';
  return String(u).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

// ---- key derivation -----------------------------------------------------------
/**
 * Derive the AES-256-GCM key for one user record.
 *
 * The KDF input is `${normalizeUsername(username)}\u0000${password}` — the username is
 * bound INTO the key, not merely stored next to it, so a record cannot be replayed under
 * another name (see the module header). NUL is the separator because it cannot appear in
 * a typed username, which keeps ("ab","c") and ("a","bc") from colliding.
 *
 * The returned key is non-extractable and carries both usages, since both seal and
 * unseal go through here.
 *
 * @param {string} username        raw or normalized — normalised internally either way
 * @param {string} password        never logged, never stored, never echoed
 * @param {Uint8Array} saltBytes   per-record random salt (16 bytes)
 * @param {number} [iterations]    PBKDF2 rounds; defaults to PBKDF2_ITERATIONS. Sealing
 *   always uses the default; unsealing passes the file's declared (clamped) count.
 * @returns {Promise<CryptoKey>} AES-GCM key, extractable=false, usages encrypt+decrypt
 */
export async function deriveUserKey(username, password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const c = subtleCrypto();
  const material = `${normalizeUsername(username)}${BIND_SEP}${password == null ? '' : String(password)}`;
  const baseKey = await c.subtle.importKey(
    'raw',
    new TextEncoder().encode(material),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: HASH },
    baseKey,
    { name: CIPHER, length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---- sealing ------------------------------------------------------------------
/**
 * Build one user record. A fresh random salt and IV are drawn on every call, so sealing
 * the same payload for the same user twice yields two different records — that is
 * expected, and both open with the same password.
 *
 * @param {{username: string, password: string, payload: object}} args
 * @returns {Promise<{u: string, salt: string, iv: string, ct: string}>} base64 fields
 * @throws {Error} 'USERNAME_REQUIRED' | 'PASSWORD_REQUIRED' | 'PAYLOAD_REQUIRED'
 *   — argument-shape errors only. The password's VALUE is never inspected here and never
 *   appears in a message; strength is scripts/make-user.mjs's job.
 */
export async function sealForUser({ username, password, payload } = {}) {
  const u = normalizeUsername(username);
  if (!u) throw new Error('USERNAME_REQUIRED');
  if (typeof password !== 'string' || password.length === 0) throw new Error('PASSWORD_REQUIRED');
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('PAYLOAD_REQUIRED');
  }

  const c = subtleCrypto();
  const salt = c.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = c.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveUserKey(u, password, salt);
  const ctBuf = await c.subtle.encrypt(
    { name: CIPHER, iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return {
    u,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ct: bytesToB64(new Uint8Array(ctBuf)),
  };
}

// ---- unsealing ----------------------------------------------------------------
/** Pull the record array out of either a whole users.json object or a bare array. */
function recordsOf(users) {
  if (Array.isArray(users)) return users;
  if (users && typeof users === 'object' && Array.isArray(users.users)) return users.users;
  return [];
}

/** True when a record has the four base64 string fields we need. */
function isRecord(r) {
  return !!r && typeof r === 'object'
    && typeof r.u === 'string'
    && typeof r.salt === 'string'
    && typeof r.iv === 'string'
    && typeof r.ct === 'string';
}

/** Try one record. Resolves to the payload object, or null for any failure at all. */
async function tryRecord(record, username, password, iterations) {
  try {
    const salt = b64ToBytes(record.salt);
    const iv = b64ToBytes(record.iv);
    const ct = b64ToBytes(record.ct);
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || ct.length <= TAG_BYTES) return null;
    const key = await deriveUserKey(username, password, salt, iterations);
    const ptBuf = await subtleCrypto().subtle.decrypt({ name: CIPHER, iv }, key, ct);
    const parsed = JSON.parse(new TextDecoder().decode(ptBuf));
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (_e) {
    // Wrong password, wrong user, corrupt base64, GCM tag mismatch, non-JSON plaintext —
    // all collapse to the same nothing. The caller must not learn which.
    return null;
  }
}

/**
 * Sign in: find the record this username+password opens and return its payload.
 *
 * RETURNS null FOR EVERY FAILURE — no such username, wrong password, damaged record,
 * empty file. The caller cannot tell these apart, and MUST NOT try: the gate UI shows
 * one generic "credentials are incorrect" message so a visitor cannot use the login form
 * to discover who has an account.
 *
 * Every record is attempted and the loop always runs to completion — no early exit on a
 * hit, no username pre-filter — so the work done (and therefore the time taken) depends
 * only on how many records the file has, never on whether the username existed or the
 * password was right. Cost is one PBKDF2 derivation per record (~26 ms in Node, a few
 * hundred ms per record in a browser), which is why this file is meant to hold a handful
 * of colleagues, not hundreds.
 *
 * Never throws and never logs; the password is used and discarded.
 *
 * @param {{users: object|Array, username: string, password: string}} args
 *   `users` accepts the parsed data/users.json object OR a bare record array.
 * @returns {Promise<object|null>} the payload, or null
 */
export async function unsealForUser({ users, username, password } = {}) {
  const records = recordsOf(users).filter(isRecord);
  if (records.length === 0) return null;
  if (typeof password !== 'string' || password.length === 0) return null;
  if (!normalizeUsername(username)) return null;

  // Derive with the count the file itself declares (clamped; see declaredIterations),
  // so rows sealed under an older PBKDF2_ITERATIONS still open after a constant bump.
  const iterations = declaredIterations(users);

  let found = null;
  for (const record of records) {
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: uniform work
    const payload = await tryRecord(record, username, password, iterations);
    if (payload && !found) found = payload; // keep the first hit, but do NOT break
  }
  return found;
}

// ---- admin helpers --------------------------------------------------------------
/**
 * The usernames on file, in file order. ADMIN / CLI USE ONLY — scripts/make-user.mjs
 * `list` calls this. Do NOT render it in the gate UI: publishing the roster hands an
 * offline attacker the exact set of names worth grinding passwords for. (They can still
 * read data/users.json directly; there is no reason to make it easier.)
 *
 * Names come back in their stored normalized form, which is also their display form —
 * records carry no separate display field.
 *
 * @param {object|Array} users parsed data/users.json object, or a bare record array
 * @returns {string[]}
 */
export function listUsernames(users) {
  return recordsOf(users).filter(isRecord).map((r) => r.u);
}
