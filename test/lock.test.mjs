// test/lock.test.mjs — access-lock crypto tests. Run: node --test
// Exercises the REAL seal/unseal used by both the browser lock screen and the
// make-seal CLI, plus applyUnlock/lock/isUnlocked against a localStorage mock.
// Uses Node's global crypto (Web Crypto) — the same API the browser provides.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  seal, unseal, SEAL, UNLOCKED_KEY,
  isUnlocked, lock, applyUnlock,
} from '../src/ui/lock.js';

const PHRASE = 'correct horse battery staple';
const PAYLOAD = {
  grafana: {
    baseUrl: 'https://elab.seha.sa/hpapm',
    accessToken: 'glsa_public_view_token_xyz',
    panelId: 49,
    dataKey: 'dk-2f9a1c',
  },
  grantedAt: '2026-07-22T00:00:00.000Z',
};

// ---- seal ⇄ unseal roundtrip ------------------------------------------------
test('seal → unseal roundtrip returns the exact payload', async () => {
  const blob = await seal(PHRASE, PAYLOAD);
  assert.equal(typeof blob, 'string');
  const out = await unseal(PHRASE, blob);
  assert.deepEqual(out, PAYLOAD);
});

test('seal blob carries salt(16)+iv(12)+ciphertext+tag(16) in base64', async () => {
  const blob = await seal(PHRASE, PAYLOAD);
  const bytes = Buffer.from(blob, 'base64');
  // must exceed the fixed prefix + GCM tag, with room for the JSON ciphertext
  assert.ok(bytes.length > SEAL.SALT_BYTES + SEAL.IV_BYTES + SEAL.TAG_BYTES);
});

// ---- wrong passphrase -------------------------------------------------------
test('wrong passphrase throws BAD_PASSPHRASE', async () => {
  const blob = await seal(PHRASE, PAYLOAD);
  await assert.rejects(() => unseal('not the phrase', blob), /BAD_PASSPHRASE/);
});

// ---- tampering --------------------------------------------------------------
test('tampered ciphertext throws (GCM auth failure)', async () => {
  const blob = await seal(PHRASE, PAYLOAD);
  const bytes = Buffer.from(blob, 'base64');
  bytes[bytes.length - 1] ^= 0xff; // flip a bit in the GCM tag
  await assert.rejects(() => unseal(PHRASE, bytes.toString('base64')), /BAD_PASSPHRASE/);
});

test('tampered salt throws (derives the wrong key)', async () => {
  const blob = await seal(PHRASE, PAYLOAD);
  const bytes = Buffer.from(blob, 'base64');
  bytes[0] ^= 0xff; // corrupt the salt
  await assert.rejects(() => unseal(PHRASE, bytes.toString('base64')), /BAD_PASSPHRASE/);
});

test('truncated blob throws SEAL_MALFORMED', async () => {
  const short = Buffer.alloc(SEAL.SALT_BYTES + SEAL.IV_BYTES).toString('base64');
  await assert.rejects(() => unseal(PHRASE, short), /SEAL_MALFORMED/);
});

// ---- randomness -------------------------------------------------------------
test('two seals of the same payload differ (random salt/iv) yet both unseal', async () => {
  const a = await seal(PHRASE, PAYLOAD);
  const b = await seal(PHRASE, PAYLOAD);
  assert.notEqual(a, b);
  assert.deepEqual(await unseal(PHRASE, a), PAYLOAD);
  assert.deepEqual(await unseal(PHRASE, b), PAYLOAD);
});

// ---- store-backed lock state ------------------------------------------------
function makeStore(initialGrafana = { baseUrl: '', accessToken: '', panelId: 49, enabled: false, dataKey: '' }) {
  let doc = { schemaVersion: 2, grafana: { ...initialGrafana } };
  return {
    loadSettings: () => doc,
    saveSettings: (s) => { doc = { ...s }; return doc; },
    _doc: () => doc,
  };
}

function mockLocalStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
  return map;
}

test('isUnlocked is false with no marker, true after applyUnlock, false after lock', () => {
  const map = mockLocalStorage();
  const store = makeStore();

  assert.equal(isUnlocked(store), false); // no marker, empty dataKey

  applyUnlock(store, PAYLOAD);
  assert.equal(store._doc().grafana.dataKey, PAYLOAD.grafana.dataKey);
  assert.equal(store._doc().grafana.accessToken, PAYLOAD.grafana.accessToken);
  assert.equal(store._doc().grafana.enabled, true);
  assert.equal(typeof JSON.parse(map.get(UNLOCKED_KEY)).at, 'string');
  assert.equal(isUnlocked(store), true);

  lock(store);
  assert.equal(map.has(UNLOCKED_KEY), false);
  assert.equal(store._doc().grafana.dataKey, '');
  assert.equal(store._doc().grafana.accessToken, '');
  assert.equal(isUnlocked(store), false);
});

test('isUnlocked is false when marker exists but dataKey is empty', () => {
  const map = mockLocalStorage();
  const store = makeStore();
  map.set(UNLOCKED_KEY, JSON.stringify({ at: new Date().toISOString() }));
  assert.equal(isUnlocked(store), false); // dataKey still empty
});

test('isUnlocked is try/catch-safe when localStorage throws', () => {
  globalThis.localStorage = { getItem() { throw new Error('denied'); } };
  const store = makeStore({ baseUrl: '', accessToken: '', panelId: 49, enabled: false, dataKey: 'x' });
  assert.equal(isUnlocked(store), false);
});
