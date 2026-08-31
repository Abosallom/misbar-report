// test/sendout-master.test.mjs — run with:  node --test
// Loading the ENCRYPTED send-out catalogue.
//
// The repo is public and this catalogue is commercial tender data, so the
// load-bearing assertions here are about confidentiality as much as correctness:
// the published artefact must decrypt only with the right key, the plaintext must
// never appear in the repo, and every failure path must degrade to "no slides"
// rather than to a wrong answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import { fetchSendoutMaster, loadSendoutMaster } from '../src/ingest/sendout-master.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ENC = join(ROOT, 'data/sendout-master.enc');

const KEY = 'a'.repeat(64);
const ROWS = [
  { vendor: 'Agent Co -Orig-', country: 'Germany', reflab: 'RefLab North', item: 'TEST A' },
  { vendor: 'Local Lab -Orig-', country: 'Saudi Arabia', reflab: 'RefLab Home', item: 'TEST B' },
];

/** Encrypt a payload exactly as scripts/build-sendout-master.mjs does. */
function seal(payload, keyHex = KEY) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const body = Buffer.concat([c.update(Buffer.from(JSON.stringify(payload), 'utf8')), c.final(), c.getAuthTag()]);
  return Buffer.concat([iv, body]).toString('base64');
}
const resp = (text, ok = true, status = 200) => async () => ({ ok, status, text: async () => text });

test('a sealed catalogue round-trips through the real decrypt path', async () => {
  const rows = await fetchSendoutMaster(KEY, {
    fetchImpl: resp(seal({ generatedAt: 'x', rows: ROWS })),
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { vendor: 'Agent Co -Orig-', country: 'Germany', reflab: 'RefLab North', item: 'TEST A' });
});

test('the WRONG key cannot read it — and the error names no content', async () => {
  const sealed = seal({ generatedAt: 'x', rows: ROWS });
  await assert.rejects(
    () => fetchSendoutMaster('b'.repeat(64), { fetchImpl: resp(sealed) }),
    (e) => {
      assert.match(e.message, /فشل فك تشفير/);
      assert.ok(!/Agent Co|RefLab|Germany/.test(e.message), 'an error must not leak catalogue content');
      return true;
    },
  );
});

test('a malformed key is refused before anything is fetched', async () => {
  let fetched = 0;
  const spy = async () => { fetched++; return { ok: true, text: async () => '' }; };
  for (const bad of ['', 'short', 'z'.repeat(64), null, undefined, 123]) {
    await assert.rejects(() => fetchSendoutMaster(bad, { fetchImpl: spy }));
  }
  assert.equal(fetched, 0, 'a bad key must not even reach the network');
});

test('tampered ciphertext is rejected — GCM authentication, not just decryption', async () => {
  const good = seal({ generatedAt: 'x', rows: ROWS });
  const raw = Buffer.from(good, 'base64');
  raw[raw.length - 20] ^= 0xff; // flip a bit inside the ciphertext body
  await assert.rejects(() => fetchSendoutMaster(KEY, { fetchImpl: resp(raw.toString('base64')) }));
});

test('404 / HTTP error / truncated file each raise a clear error', async () => {
  await assert.rejects(() => fetchSendoutMaster(KEY, { fetchImpl: resp('', false, 404) }),
    /غير متوفر/);
  await assert.rejects(() => fetchSendoutMaster(KEY, { fetchImpl: resp('', false, 500) }),
    /HTTP 500/);
  await assert.rejects(() => fetchSendoutMaster(KEY, { fetchImpl: resp('AAAA') }));
});

test('rows that cannot place an order in a country are dropped', async () => {
  const rows = await fetchSendoutMaster(KEY, {
    fetchImpl: resp(seal({
      rows: [
        ...ROWS,
        { vendor: '', country: 'Germany' },        // no vendor
        { vendor: 'X -Orig-', country: '' },        // no country
        { vendor: 'Y -Orig-' },                     // missing country entirely
        null, 'nonsense', 42,
      ],
    })),
  });
  assert.equal(rows.length, 2);
  for (const r of rows) assert.ok(r.vendor && r.country);
});

test('an empty catalogue is an error, not an empty success', async () => {
  // Returning [] would let the caller analyse with no catalogue and report every
  // lab as unmapped. Failing loudly keeps that path unreachable.
  await assert.rejects(() => fetchSendoutMaster(KEY, { fetchImpl: resp(seal({ rows: [] })) }), /فارغ/);
  await assert.rejects(() => fetchSendoutMaster(KEY, { fetchImpl: resp(seal({})) }), /فارغ/);
});

test('loadSendoutMaster swallows every failure and resolves to null', async () => {
  assert.equal(await loadSendoutMaster('bad-key', { fetchImpl: resp('') }), null);
  assert.equal(await loadSendoutMaster(KEY, { fetchImpl: resp('', false, 404) }), null);
  assert.equal(await loadSendoutMaster(KEY, { fetchImpl: async () => { throw new Error('offline'); } }), null);
  const okRows = await loadSendoutMaster(KEY, { fetchImpl: resp(seal({ rows: ROWS })) });
  assert.equal(okRows.length, 2);
});

test('CONFIDENTIALITY: the published catalogue is ciphertext, and no plaintext copy is in the repo', () => {
  assert.ok(existsSync(ENC), 'data/sendout-master.enc must exist — run scripts/build-sendout-master.mjs');
  const enc = readFileSync(ENC, 'utf8').trim();
  assert.match(enc, /^[A-Za-z0-9+/=]+$/, 'the published file must be base64 ciphertext only');
  // Prove it is opaque WITHOUT naming a single real lab: this test lives in the
  // same public repo, so spelling out the secrets here would leak exactly what
  // the encryption protects. The plaintext is JSON, so had any of it survived,
  // its own field names and punctuation would be readable.
  for (const marker of ['vendor', 'country', 'reflab', 'item', 'generatedAt', '{', '"']) {
    assert.ok(!enc.includes(marker), `ciphertext must not contain plaintext '${marker}'`);
  }

  // And no plaintext catalogue may sit anywhere in the tracked tree — the old
  // src/seeds/sendout-master.js in particular must stay gone.
  assert.ok(!existsSync(join(ROOT, 'src/seeds/sendout-master.js')),
    'the plaintext seed must not come back — the catalogue ships encrypted');
  const skip = new Set(['.git', 'node_modules', 'test', 'data', 'vendor', 'assets']);
  const offenders = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(js|mjs|json|html|css)$/.test(name)) continue;
      const body = readFileSync(full, 'utf8');
      // A real reference lab name appearing in source means the catalogue leaked.
      // Generic shapes, so this guard leaks nothing itself: a corporate suffix,
      // or an ALL-CAPS multi-word clinical name of the kind reference labs use.
      if (/\bGmbH\b/.test(body) || /\b(?:KING|ROYAL|NATIONAL)\s+[A-Z]{3,}\s+[A-Z]{3,}/.test(body)) {
        offenders.push(relative(ROOT, full));
      }
    }
  }(ROOT));
  assert.deepEqual(offenders, [], 'catalogue content found in tracked source');
});
