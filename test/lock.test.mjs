// test/lock.test.mjs — access-lock crypto tests. Run: node --test
// Exercises the REAL seal/unseal used by both the browser lock screen and the
// make-seal CLI, plus applyUnlock/lock/isUnlocked against a localStorage mock.
// Uses Node's global crypto (Web Crypto) — the same API the browser provides.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  seal, unseal, SEAL, UNLOCKED_KEY, USER_KEY,
  isUnlocked, lock, applyUnlock,
  signIn, currentUser, rememberUser,
  USERS_URL, SEAL_URL, FAIL_DELAY_MS, GENERIC_AUTH_ERROR,
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

// ---- signIn(): per-user first, shared seal second, degrade never strand -----
// signIn fetches USERS_URL / SEAL_URL via global fetch, so each test installs a
// route-table stub and restores the real fetch in finally. The auth module is
// ALWAYS injected through the ctx seam here — src/auth/users.js exists in this
// repo, so an un-injected call would lazy-import the real module and make these
// orchestration tests depend on another file's behavior.

const SHARED_BLOB = await seal(PHRASE, PAYLOAD); // one PBKDF2 run, reused below

function stubFetch(routes) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const route = routes[String(url)];
    if (route === undefined) throw new TypeError('unexpected fetch: ' + url);
    return (typeof route === 'function') ? route() : route;
  };
  return () => { globalThis.fetch = orig; };
}

const okJson = (doc) => ({ ok: true, json: async () => doc, text: async () => JSON.stringify(doc) });
const okText = (text) => ({ ok: true, json: async () => JSON.parse(text), text: async () => text });
const http404 = { ok: false, status: 404, json: async () => { throw new Error('no body'); }, text: async () => 'Not Found' };
// GH Pages serves its HTML 404 page with status 200 on some soft-404 setups:
const htmlAs200 = { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); }, text: async () => '<!doctype html><h1>404</h1>' };

const USERS_DOC = { version: 1, users: [{ username: 'aziz', seal: 'irrelevant-here' }] };

test('signIn: per-user success returns payload + normalized name, never touches the seal', async () => {
  let sealFetched = false;
  const restore = stubFetch({
    [USERS_URL]: okJson(USERS_DOC),
    [SEAL_URL]: () => { sealFetched = true; return okText(SHARED_BLOB); },
  });
  try {
    const auth = {
      async unsealForUser({ users, username, password }) {
        assert.deepEqual(users, USERS_DOC);
        return (username === 'Aziz' && password === 'pw-secret-1') ? PAYLOAD : null;
      },
      normalizeUsername: (n) => String(n).trim().toLowerCase(),
    };
    const out = await signIn({ username: '  Aziz ', password: 'pw-secret-1', auth });
    assert.deepEqual(out.payload, PAYLOAD);
    assert.equal(out.user, 'aziz'); // normalized display name, not the raw input
    assert.equal(sealFetched, false); // fallback ordering: per-user won, seal untouched
  } finally { restore(); }
});

test('signIn: empty username skips the per-user path entirely (user: null)', async () => {
  let authCalled = false;
  const restore = stubFetch({ [SEAL_URL]: okText(SHARED_BLOB) }); // no USERS_URL route on purpose
  try {
    const auth = { unsealForUser() { authCalled = true; return PAYLOAD; } };
    const out = await signIn({ username: '   ', password: PHRASE, auth });
    assert.deepEqual(out.payload, PAYLOAD);
    assert.equal(out.user, null); // shared phrase identifies nobody
    assert.equal(authCalled, false);
  } finally { restore(); }
});

test('signIn: users.json 404 degrades to the shared seal', async () => {
  let authCalled = false;
  const restore = stubFetch({ [USERS_URL]: http404, [SEAL_URL]: okText(SHARED_BLOB) });
  try {
    const auth = { unsealForUser() { authCalled = true; return null; } };
    const out = await signIn({ username: 'aziz', password: PHRASE, auth });
    assert.deepEqual(out.payload, PAYLOAD);
    assert.equal(out.user, null);
    assert.equal(authCalled, false); // no user list → auth module never consulted
  } finally { restore(); }
});

test('signIn: users.json served as HTML with status 200 degrades to the shared seal', async () => {
  const restore = stubFetch({ [USERS_URL]: htmlAs200, [SEAL_URL]: okText(SHARED_BLOB) });
  try {
    const out = await signIn({ username: 'aziz', password: PHRASE, auth: { unsealForUser: () => null } });
    assert.deepEqual(out.payload, PAYLOAD);
    assert.equal(out.user, null);
  } finally { restore(); }
});

test('signIn: users.json network failure degrades to the shared seal', async () => {
  const restore = stubFetch({
    [USERS_URL]: () => { throw new TypeError('network down'); },
    [SEAL_URL]: okText(SHARED_BLOB),
  });
  try {
    const out = await signIn({ username: 'aziz', password: PHRASE, auth: { unsealForUser: () => null } });
    assert.deepEqual(out.payload, PAYLOAD);
    assert.equal(out.user, null);
  } finally { restore(); }
});

test('signIn: a throwing auth module degrades to the shared seal', async () => {
  const restore = stubFetch({ [USERS_URL]: okJson(USERS_DOC), [SEAL_URL]: okText(SHARED_BLOB) });
  try {
    const auth = { unsealForUser() { throw new Error('auth module bug'); } };
    const out = await signIn({ username: 'aziz', password: PHRASE, auth });
    assert.deepEqual(out.payload, PAYLOAD); // the safety net held
    assert.equal(out.user, null);
  } finally { restore(); }
});

test('signIn: wrong per-user credentials then wrong shared phrase rejects BAD_PASSPHRASE', async () => {
  // BAD_PASSPHRASE is the code renderLock maps onto GENERIC_AUTH_ERROR — the
  // caller must be able to tell "bad credentials" apart from "deployment broken".
  const restore = stubFetch({ [USERS_URL]: okJson(USERS_DOC), [SEAL_URL]: okText(SHARED_BLOB) });
  try {
    const auth = { unsealForUser: async () => null }; // wrong user/password pair
    await assert.rejects(
      () => signIn({ username: 'aziz', password: 'not the phrase either', auth }),
      /BAD_PASSPHRASE/,
    );
  } finally { restore(); }
});

test('signIn: SEAL_UNAVAILABLE when users.json and access.seal are both missing', async () => {
  const restore = stubFetch({ [USERS_URL]: http404, [SEAL_URL]: http404 });
  try {
    await assert.rejects(
      () => signIn({ username: 'aziz', password: PHRASE, auth: { unsealForUser: () => null } }),
      /SEAL_UNAVAILABLE/,
    );
  } finally { restore(); }
});

// ---- rememberUser / currentUser / applyUnlock's username argument -----------

test('rememberUser/currentUser round-trip: trim, truncate to 64, clear on falsy', () => {
  const map = mockLocalStorage();

  assert.equal(currentUser(), null); // nothing remembered yet

  rememberUser('  Aziz Alsaloom  ');
  assert.equal(currentUser(), 'Aziz Alsaloom'); // trimmed
  const marker = JSON.parse(map.get(USER_KEY));
  assert.deepEqual(Object.keys(marker).sort(), ['at', 'u']); // display name + time, NOTHING else
  assert.equal(typeof marker.at, 'string');

  rememberUser('a'.repeat(80));
  assert.equal(currentUser().length, 64); // MAX_USERNAME cap

  rememberUser('');
  assert.equal(map.has(USER_KEY), false);
  assert.equal(currentUser(), null);

  rememberUser('x');
  rememberUser(null); // main.js's defensive "forget the user"
  assert.equal(currentUser(), null);
});

test('currentUser and rememberUser are try/catch-safe when localStorage throws', () => {
  globalThis.localStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  assert.equal(currentUser(), null);
  assert.doesNotThrow(() => rememberUser('aziz'));
  assert.doesNotThrow(() => rememberUser(null));
});

test('applyUnlock remembers the username; omitting it (shared phrase) clears a stale name', () => {
  const map = mockLocalStorage();
  const store = makeStore();

  applyUnlock(store, PAYLOAD, '  Aziz  '); // per-user sign-in
  assert.equal(currentUser(), 'Aziz');
  assert.equal(isUnlocked(store), true);

  // Later, someone unlocks the same device with the SHARED phrase: the stale
  // name must be cleared so the session is never attributed to the wrong person.
  applyUnlock(store, PAYLOAD);
  assert.equal(isUnlocked(store), true);
  assert.equal(currentUser(), null);
  assert.equal(map.has(USER_KEY), false);
});

// ---- failure-UX constants (renderLock's contract with the design) -----------

test('GENERIC_AUTH_ERROR is a single non-revealing message and FAIL_DELAY_MS is a real pause', () => {
  assert.equal(typeof GENERIC_AUTH_ERROR, 'string');
  assert.ok(GENERIC_AUTH_ERROR.trim().length > 0);
  assert.ok(Number.isFinite(FAIL_DELAY_MS) && FAIL_DELAY_MS > 0);
});
