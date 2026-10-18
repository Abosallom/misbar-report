// test/tracker-translate-data.test.mjs — `node --test test/tracker-translate-data.test.mjs`
//
// THE BUILT-IN TRANSLATION MEMORY (data/tracker-ar.enc): built by
// scripts/build-tracker-translations.mjs, read by src/ingest/tracker-translations.js.
// The entries are the project's own task texts and the repo is PUBLIC, so the load-bearing
// assertions are about confidentiality as much as correctness: the file decrypts only with
// the right key, the build prints counts and never an entry, the plaintext never lands
// beside the ciphertext, and every failure degrades to null (English shown), never a crash.
// SYNTHETIC entries and a SYNTHETIC key only; the script runs in a temp directory, so the
// repo's data/ is never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fetchTrackerTranslations, loadTrackerTranslations } from '../src/ingest/tracker-translations.js';
import { applyTrackerTranslations, normEn } from '../src/model/tracker-translate.js';
import { TRACKER_FORMAT } from '../src/ingest/task-tracker.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'build-tracker-translations.mjs');
const KEY = 'c'.repeat(64);
const ENTRIES = {
  tasks: { [normEn('Synthetic build task')]: 'مهمة بناء تجريبية' },
  tracks: { [normEn('Synthetic Track')]: 'مسار تجريبي' },
  milestones: {},
  owners: {},
  entities: {},
};

/** Encrypt a payload exactly as the build script does. */
function seal(payload, keyHex = KEY) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const body = Buffer.concat([c.update(Buffer.from(JSON.stringify(payload), 'utf8')), c.final(), c.getAuthTag()]);
  return Buffer.concat([iv, body]).toString('base64');
}
const resp = (text, ok = true, status = 200) => async () => ({ ok, status, text: async () => text });
const quiet = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

test('a sealed memory round-trips through the real decrypt path, keys re-normalised', async () => {
  const got = await fetchTrackerTranslations(KEY, {
    fetchImpl: resp(seal({ generatedAt: 'g', entries: { ...ENTRIES, tasks: { '  Synthetic   BUILD task ': 'مهمة بناء تجريبية' } } })),
  });
  assert.equal(got.generatedAt, 'g');
  assert.deepEqual(got.entries, ENTRIES);
});

test('the default URL is data/tracker-ar.enc, fetched uncached', async () => {
  let seen = null;
  await fetchTrackerTranslations(KEY, {
    fetchImpl: async (url, init) => { seen = [url, init]; return { ok: true, status: 200, text: async () => seal({ entries: ENTRIES }) }; },
  });
  assert.deepEqual(seen, ['data/tracker-ar.enc', { cache: 'no-store' }]);
});

test('the WRONG key cannot read it — and the error names no content', async () => {
  const sealed = seal({ generatedAt: 'g', entries: ENTRIES });
  await assert.rejects(
    () => fetchTrackerTranslations('d'.repeat(64), { fetchImpl: resp(sealed) }),
    (e) => {
      assert.match(e.message, /فشل فك تشفير/);
      assert.ok(!/Synthetic|تجريبي/.test(e.message), 'an error must not leak entry content');
      return true;
    },
  );
});

test('a malformed key is refused before anything is fetched', async () => {
  let fetched = 0;
  const spy = async () => { fetched++; return { ok: true, text: async () => '' }; };
  for (const bad of ['', 'short', 'z'.repeat(64), null, undefined, 42]) {
    await assert.rejects(() => fetchTrackerTranslations(bad, { fetchImpl: spy }));
  }
  assert.equal(fetched, 0);
});

test('404 / HTTP error / truncated / tampered / empty each raise; the forgiving loader returns null', async () => {
  await assert.rejects(() => fetchTrackerTranslations(KEY, { fetchImpl: resp('', false, 404) }), /غير متوفر/);
  await assert.rejects(() => fetchTrackerTranslations(KEY, { fetchImpl: resp('', false, 503) }), /HTTP 503/);
  await assert.rejects(() => fetchTrackerTranslations(KEY, { fetchImpl: resp('AAAA') }));
  const raw = Buffer.from(seal({ entries: ENTRIES }), 'base64');
  raw[raw.length - 20] ^= 0xff;
  await assert.rejects(() => fetchTrackerTranslations(KEY, { fetchImpl: resp(raw.toString('base64')) }));
  await assert.rejects(() => fetchTrackerTranslations(KEY, { fetchImpl: resp(seal({ entries: {} })) }), /فارغ/);
  await assert.rejects(() => fetchTrackerTranslations(KEY, { fetchImpl: resp(seal(['not', 'an', 'object'])) }), /فارغ/);
  await quiet(async () => {
    assert.equal(await loadTrackerTranslations(KEY, { fetchImpl: resp('', false, 404) }), null);
    assert.equal(await loadTrackerTranslations('bad', { fetchImpl: resp('') }), null);
    assert.equal(await loadTrackerTranslations(KEY, { fetchImpl: async () => { throw new Error('offline'); } }), null);
  });
});

// ---- the build script ---------------------------------------------------------------------

function runBuild(dir, args, env = { DATA_KEY: KEY }) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir, env: { ...process.env, ...env }, encoding: 'utf8',
  });
}

test('build script: JSON {tasks, tracks, milestones} → encrypted envelope the loader reads and the app applies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'misbar-tr-ar-'));
  const input = join(dir, 'in.json');
  writeFileSync(input, JSON.stringify({
    tasks: {
      'Synthetic  build TASK': 'مهمة بناء تجريبية',
      'synthetic build task': 'مكرر مختلف', // same key, different Arabic → first kept, reported
      'Synthetic empty': '  ',
    },
    tracks: { 'Synthetic Track': 'مسار تجريبي' },
  }));
  const r = runBuild(dir, [input]);
  assert.equal(r.status, 0, r.stderr);
  const out = join(dir, 'data', 'tracker-ar.enc');
  assert.ok(existsSync(out), 'writes data/tracker-ar.enc relative to the working directory');
  assert.match(r.stdout, /1 tasks · 1 tracks · 0 milestones · 0 owners · 0 entities · 1 empty\/oversized skipped · 1 conflicting duplicates/);
  // Counts only: no entry, English or Arabic, ever reaches the console.
  for (const s of ['Synthetic', 'synthetic', 'مهمة', 'مسار']) {
    assert.ok(!r.stdout.includes(s) && !r.stderr.includes(s), `console leaks "${s}"`);
  }
  const cipher = readFileSync(out, 'utf8');
  assert.ok(!/Synthetic|synthetic|مهمة/.test(cipher) && !/Synthetic|مهمة/.test(Buffer.from(cipher, 'base64').toString('utf8')));
  assert.deepEqual(readdirSync(join(dir, 'data')), ['tracker-ar.enc'], 'nothing but the ciphertext is written');

  const got = await fetchTrackerTranslations(KEY, { fetchImpl: resp(cipher) });
  assert.deepEqual(got.entries, ENTRIES);
  assert.match(got.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  const tr = { format: TRACKER_FORMAT, fileName: null, loadedAt: '', editedAt: null, warnings: [],
    tasks: [{ id: 'a', task: 'Synthetic build task', track: 'Synthetic Track', milestone: '', taskAr: '', trackAr: '', milestoneAr: '' }] };
  const applied = applyTrackerTranslations(tr, { builtin: got });
  assert.deepEqual([applied.tasks[0].taskAr, applied.tasks[0].taskArSource, applied.tasks[0].trackAr],
    ['مهمة بناء تجريبية', 'builtin', 'مسار تجريبي']);
});

test('build script: an explicit output path; a bad key / input / empty set exits non-zero and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'misbar-tr-ar-'));
  const input = join(dir, 'in.json');
  writeFileSync(input, JSON.stringify({ milestones: { 'Synthetic Stage': 'مرحلة' } }));
  assert.equal(runBuild(dir, [input, join(dir, 'x', 'custom.enc')]).status, 0);
  assert.ok(existsSync(join(dir, 'x', 'custom.enc')));

  const dir2 = mkdtempSync(join(tmpdir(), 'misbar-tr-ar-'));
  const in2 = join(dir2, 'in.json');
  writeFileSync(in2, JSON.stringify({ tasks: { a: 'ب' } }));
  assert.notEqual(runBuild(dir2, [in2], { DATA_KEY: 'short' }).status, 0, 'bad key');
  assert.notEqual(runBuild(dir2, []).status, 0, 'no input');
  writeFileSync(join(dir2, 'bad.json'), '{not json');
  assert.notEqual(runBuild(dir2, [join(dir2, 'bad.json')]).status, 0, 'not JSON');
  writeFileSync(join(dir2, 'empty.json'), JSON.stringify({ tasks: { a: '' } }));
  assert.notEqual(runBuild(dir2, [join(dir2, 'empty.json')]).status, 0, 'no usable entries');
  writeFileSync(join(dir2, 'arr.json'), JSON.stringify({ tasks: ['x'] }));
  assert.notEqual(runBuild(dir2, [join(dir2, 'arr.json')]).status, 0, 'a map that is not an object');
  assert.ok(!existsSync(join(dir2, 'data')), 'no output on any failure');
});

test('the repo carries no plaintext translation memory (only the .enc may exist)', () => {
  const root = join(HERE, '..');
  const files = readdirSync(join(root, 'data'));
  assert.ok(!files.some((f) => /tracker.*\.json$/i.test(f)), 'no plaintext tracker JSON in data/');
});
