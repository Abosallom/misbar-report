// test/users.test.mjs — per-user account crypto. Run: node --test
//
// Exercises the REAL src/auth/users.js used by the sign-in gate and by
// scripts/make-user.mjs, against Node's global WebCrypto (the same API the browser
// gives us). Everything here is genuine PBKDF2 at 310000 rounds — roughly 26 ms per
// derivation on this machine — so the suite deliberately keeps the number of accounts
// and attempts small rather than mocking the crypto away.
//
// The load-bearing property proved below is the USERNAME BINDING: a row sealed for one
// person must be inert under anybody else's name, even with the identical password.
// Without it, the public data/users.json could be edited to promote any user's row.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PBKDF2_ITERATIONS,
  normalizeUsername,
  deriveUserKey,
  sealForUser,
  unsealForUser,
  listUsernames,
} from '../src/auth/users.js';
// Safe to import: make-user.mjs only runs main() when invoked directly as a CLI.
import { passwordProblems, generatePassword } from '../scripts/make-user.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const USERS_JSON = join(ROOT, 'data/users.json');
const USERS_SRC = join(ROOT, 'src/auth/users.js');

const PAYLOAD = {
  grafana: {
    baseUrl: 'https://elab.seha.sa/hpapm',
    accessToken: 'glsa_public_view_token_xyz',
    panelId: 49,
    dataKey: 'dk-2f9a1c',
  },
  grantedAt: '2026-07-27T00:00:00.000Z',
};

const PW = 'Kq7#mZv2Rt9$Wpx';
const wrap = (users) => ({ v: 1, iterations: PBKDF2_ITERATIONS, users });

// ---- constants ---------------------------------------------------------------
test('PBKDF2_ITERATIONS is the agreed 310000', () => {
  assert.equal(PBKDF2_ITERATIONS, 310000);
});

// ---- normalizeUsername --------------------------------------------------------
test('normalizeUsername trims, lowercases and collapses whitespace', () => {
  assert.equal(normalizeUsername('  Aziz  '), 'aziz');
  assert.equal(normalizeUsername('AZIZ'), 'aziz');
  assert.equal(normalizeUsername('Az   Al   Saloom'), 'az al saloom');
  assert.equal(normalizeUsername('Badr\tAl\nOtaibi'), 'badr al otaibi');
});

test('normalizeUsername returns empty string for blank/absent input', () => {
  assert.equal(normalizeUsername(null), '');
  assert.equal(normalizeUsername(undefined), '');
  assert.equal(normalizeUsername('   '), '');
  assert.equal(normalizeUsername(''), '');
});

// ---- round trip ----------------------------------------------------------------
test('sealForUser → unsealForUser returns the exact payload', async () => {
  const rec = await sealForUser({ username: 'aziz', password: PW, payload: PAYLOAD });
  const out = await unsealForUser({ users: wrap([rec]), username: 'aziz', password: PW });
  assert.deepEqual(out, PAYLOAD);
});

test('a record has exactly u/salt/iv/ct, base64, with the right byte lengths', async () => {
  const rec = await sealForUser({ username: 'aziz', password: PW, payload: PAYLOAD });
  assert.deepEqual(Object.keys(rec).sort(), ['ct', 'iv', 'salt', 'u']);
  assert.equal(rec.u, 'aziz');
  assert.equal(Buffer.from(rec.salt, 'base64').length, 16);
  assert.equal(Buffer.from(rec.iv, 'base64').length, 12);
  assert.ok(Buffer.from(rec.ct, 'base64').length > 16, 'ciphertext must exceed the GCM tag');
  // the payload must not be sitting in the clear anywhere in the record
  const blob = JSON.stringify(rec);
  assert.ok(!blob.includes('glsa_public_view_token_xyz'));
  assert.ok(!blob.includes('dk-2f9a1c'));
  assert.ok(!blob.includes(PW), 'the password must never appear in the record');
});

test('the username is stored normalized regardless of how it was typed', async () => {
  const rec = await sealForUser({ username: '  Badr   Al Otaibi ', password: PW, payload: PAYLOAD });
  assert.equal(rec.u, 'badr al otaibi');
});

test('two seals of the same payload differ (fresh salt+iv) yet both open', async () => {
  const a = await sealForUser({ username: 'aziz', password: PW, payload: PAYLOAD });
  const b = await sealForUser({ username: 'aziz', password: PW, payload: PAYLOAD });
  assert.notEqual(a.ct, b.ct);
  assert.notEqual(a.salt, b.salt);
  assert.deepEqual(await unsealForUser({ users: wrap([a]), username: 'aziz', password: PW }), PAYLOAD);
  assert.deepEqual(await unsealForUser({ users: wrap([b]), username: 'aziz', password: PW }), PAYLOAD);
});

// ---- failure modes all collapse to null -------------------------------------------
test('wrong password returns null', async () => {
  const rec = await sealForUser({ username: 'aziz', password: PW, payload: PAYLOAD });
  const out = await unsealForUser({ users: wrap([rec]), username: 'aziz', password: 'Xw4%bTn8Lc2@Vhq' });
  assert.equal(out, null);
});

test('wrong username returns null — indistinguishable from a wrong password', async () => {
  const rec = await sealForUser({ username: 'aziz', password: PW, payload: PAYLOAD });
  const noSuchUser = await unsealForUser({ users: wrap([rec]), username: 'nobody', password: PW });
  const badPassword = await unsealForUser({ users: wrap([rec]), username: 'aziz', password: 'Xw4%bTn8Lc2@Vhq' });
  assert.equal(noSuchUser, null);
  assert.equal(badPassword, null); // same value, same shape: the caller learns nothing
});

test('empty roster, blank password and blank username all return null without throwing', async () => {
  const rec = await sealForUser({ username: 'aziz', password: PW, payload: PAYLOAD });
  assert.equal(await unsealForUser({ users: wrap([]), username: 'aziz', password: PW }), null);
  assert.equal(await unsealForUser({ users: wrap([rec]), username: 'aziz', password: '' }), null);
  assert.equal(await unsealForUser({ users: wrap([rec]), username: '   ', password: PW }), null);
  assert.equal(await unsealForUser({}), null);
  assert.equal(await unsealForUser(), null);
});

test('a corrupt or truncated record returns null instead of throwing', async () => {
  const rec = await sealForUser({ username: 'aziz', password: PW, payload: PAYLOAD });
  const tampered = { ...rec, ct: Buffer.from('too short').toString('base64') };
  assert.equal(await unsealForUser({ users: wrap([tampered]), username: 'aziz', password: PW }), null);

  const bytes = Buffer.from(rec.ct, 'base64');
  bytes[bytes.length - 1] ^= 0xff; // flip a bit in the GCM tag
  const flipped = { ...rec, ct: bytes.toString('base64') };
  assert.equal(await unsealForUser({ users: wrap([flipped]), username: 'aziz', password: PW }), null);
});

// ---- username case / whitespace insensitivity ---------------------------------------
test('sign-in is case- and whitespace-insensitive in the username', async () => {
  const rec = await sealForUser({ username: 'Badr Al Otaibi', password: PW, payload: PAYLOAD });
  const users = wrap([rec]);
  for (const typed of ['badr al otaibi', 'BADR AL OTAIBI', '  Badr   Al   Otaibi  ', 'BaDr\tAl Otaibi']) {
    // eslint-disable-next-line no-await-in-loop -- sequential is fine in a test
    const out = await unsealForUser({ users, username: typed, password: PW });
    assert.deepEqual(out, PAYLOAD, `should have opened for ${JSON.stringify(typed)}`);
  }
});

test('the password stays case-SENSITIVE even though the username is not', async () => {
  const rec = await sealForUser({ username: 'aziz', password: PW, payload: PAYLOAD });
  const out = await unsealForUser({ users: wrap([rec]), username: 'aziz', password: PW.toLowerCase() });
  assert.equal(out, null);
});

// ---- THE username binding ------------------------------------------------------------
test('a record sealed for A does NOT open under B, even with the same password', async () => {
  const forA = await sealForUser({ username: 'aziz', password: PW, payload: PAYLOAD });

  // Rename the row — exactly what an attacker with the public file would try.
  const renamed = { ...forA, u: 'badr' };
  const out = await unsealForUser({ users: wrap([renamed]), username: 'badr', password: PW });
  assert.equal(out, null, 'renaming a row must not make it open under the new name');

  // And the genuine two-account case: same password, different people, no crossover.
  const forB = await sealForUser({ username: 'badr', password: PW, payload: { who: 'badr' } });
  const users = wrap([forA, forB]);
  assert.deepEqual(await unsealForUser({ users, username: 'aziz', password: PW }), PAYLOAD);
  assert.deepEqual(await unsealForUser({ users, username: 'badr', password: PW }), { who: 'badr' });
});

test('deriveUserKey produces a different key per username for one password+salt', async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kA = await deriveUserKey('aziz', PW, salt);
  const kB = await deriveUserKey('badr', PW, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kA, new TextEncoder().encode('hi'));
  await assert.rejects(() => crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kB, ct));
});

test('deriveUserKey normalizes the username, so casing cannot fork the key', async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k1 = await deriveUserKey('  AZIZ ', PW, salt);
  const k2 = await deriveUserKey('aziz', PW, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, new TextEncoder().encode('hi'));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k2, ct);
  assert.equal(new TextDecoder().decode(pt), 'hi');
});

// ---- argument validation ----------------------------------------------------------------
test('sealForUser rejects a missing username, password or payload', async () => {
  await assert.rejects(() => sealForUser({ username: '  ', password: PW, payload: PAYLOAD }), /USERNAME_REQUIRED/);
  await assert.rejects(() => sealForUser({ username: 'aziz', password: '', payload: PAYLOAD }), /PASSWORD_REQUIRED/);
  await assert.rejects(() => sealForUser({ username: 'aziz', password: PW, payload: null }), /PAYLOAD_REQUIRED/);
  await assert.rejects(() => sealForUser({ username: 'aziz', password: PW, payload: [1, 2] }), /PAYLOAD_REQUIRED/);
});

test('sealForUser never puts the password into a thrown error message', async () => {
  await assert.rejects(
    () => sealForUser({ username: '', password: PW, payload: PAYLOAD }),
    (e) => !String(e.message).includes(PW) && !String(e.stack || '').includes(PW),
  );
});

// ---- input shape tolerance + listUsernames -----------------------------------------------
test('unsealForUser accepts the whole users.json object or a bare record array', async () => {
  const rec = await sealForUser({ username: 'aziz', password: PW, payload: PAYLOAD });
  assert.deepEqual(await unsealForUser({ users: wrap([rec]), username: 'aziz', password: PW }), PAYLOAD);
  assert.deepEqual(await unsealForUser({ users: [rec], username: 'aziz', password: PW }), PAYLOAD);
});

test('listUsernames reads both shapes and skips malformed rows', async () => {
  const a = await sealForUser({ username: 'aziz', password: PW, payload: PAYLOAD });
  const b = await sealForUser({ username: 'Badr', password: PW, payload: PAYLOAD });
  assert.deepEqual(listUsernames(wrap([a, b])), ['aziz', 'badr']);
  assert.deepEqual(listUsernames([a, b]), ['aziz', 'badr']);
  assert.deepEqual(listUsernames(wrap([a, null, { u: 'x' }, 'nope'])), ['aziz']);
  assert.deepEqual(listUsernames(null), []);
  assert.deepEqual(listUsernames(undefined), []);
  assert.deepEqual(listUsernames({}), []);
});

// ---- the shipped data/users.json ------------------------------------------------------------
test('data/users.json exists and matches the documented envelope', () => {
  const doc = JSON.parse(readFileSync(USERS_JSON, 'utf8'));
  assert.equal(doc.v, 1, 'schema version must be 1');
  assert.equal(doc.iterations, PBKDF2_ITERATIONS, 'file must declare the shared iteration count');
  assert.ok(Array.isArray(doc.users), 'users must be an array');
  assert.deepEqual(Object.keys(doc).sort(), ['iterations', 'users', 'v']);
});

test('every row in data/users.json is well formed, normalized and unique', () => {
  const doc = JSON.parse(readFileSync(USERS_JSON, 'utf8'));
  const seen = new Set();
  for (const r of doc.users) {
    assert.deepEqual(Object.keys(r).sort(), ['ct', 'iv', 'salt', 'u'], `row ${r && r.u}`);
    assert.equal(typeof r.u, 'string');
    assert.equal(r.u, normalizeUsername(r.u), `row "${r.u}" is not stored normalized`);
    assert.equal(Buffer.from(r.salt, 'base64').length, 16, `row "${r.u}" salt must be 16 bytes`);
    assert.equal(Buffer.from(r.iv, 'base64').length, 12, `row "${r.u}" iv must be 12 bytes`);
    assert.ok(Buffer.from(r.ct, 'base64').length > 16, `row "${r.u}" ciphertext too short`);
    assert.ok(!seen.has(r.u), `duplicate username "${r.u}"`);
    seen.add(r.u);
  }
});

// ---- no secret ever reaches a log --------------------------------------------------------------
test('src/auth/users.js contains no logging or alerting calls at all', () => {
  const src = readFileSync(USERS_SRC, 'utf8');
  // Strip comments first so prose mentioning these names cannot fail the test.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['console.', 'alert(', 'process.stdout', 'process.stderr', 'debugger']) {
    assert.ok(!code.includes(banned), `src/auth/users.js must not use ${banned}`);
  }
});

test('src/auth/users.js keeps the password out of every thrown error string', () => {
  const src = readFileSync(USERS_SRC, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Every throw site must use a bare uppercase error code, never an interpolated value.
  const throws = code.match(/throw new Error\([^)]*\)/g) || [];
  assert.ok(throws.length > 0, 'expected some throw sites to inspect');
  for (const t of throws) {
    assert.ok(!t.includes('${'), `throw must not interpolate anything: ${t}`);
    assert.ok(/^throw new Error\('[A-Z0-9_]+'\)$/.test(t), `throw must be a bare code: ${t}`);
  }
});

// ---- the account tool's password policy ----------------------------------------------------
test('scripts/make-user.mjs refuses weak passwords and accepts strong ones', () => {
  const weak = {
    'too short': 'Ab3$xQ9!',
    'too few distinct characters': 'ababababababab',
    'a repeated run': 'Zx9$aaaaQw2#Lm',
    'an alphabet run': 'Xq7$abcdRm2#Lp',
    'a digit run': 'Xq$m1234Rm#Lpz',
    'a keyboard run': 'Xq7$qwerRm2#Lp',
    'a common word': 'Password123!x',
    'only two character classes': 'abcxmzqrtvwy',
  };
  for (const [why, pw] of Object.entries(weak)) {
    assert.ok(passwordProblems(pw).length > 0, `should have rejected ${why}`);
  }

  assert.deepEqual(passwordProblems('Kq7#mZv2Rt9$Wpx'), [], 'a strong password must pass');
  assert.ok(passwordProblems('Kq7#mZv2Rt9$Wpx-aziz', 'aziz').length > 0, 'must reject its own username');
  assert.ok(passwordProblems('').length > 0);
  assert.ok(passwordProblems(null).length > 0);

  // Generated passwords must always satisfy the tool's own checker.
  for (let i = 0; i < 25; i += 1) {
    const pw = generatePassword('aziz');
    assert.equal(pw.length, 20);
    assert.deepEqual(passwordProblems(pw, 'aziz'), [], `generated password failed its own policy: length ${pw.length}`);
  }
});

test('generatePassword does not repeat itself', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) seen.add(generatePassword('aziz'));
  assert.equal(seen.size, 50, 'every generated password must be distinct');
});

test('a generated password actually works end to end as a real credential', async () => {
  const pw = generatePassword('aziz');
  const rec = await sealForUser({ username: 'aziz', password: pw, payload: PAYLOAD });
  assert.deepEqual(await unsealForUser({ users: wrap([rec]), username: 'AZIZ', password: pw }), PAYLOAD);
});
