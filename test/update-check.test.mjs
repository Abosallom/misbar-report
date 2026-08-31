// test/update-check.test.mjs — run with:  node --test
// The stale-index.html escape hatch. Asserts the check is fetched uncached, that
// a broken check is silent rather than noisy, that the reload URL is guaranteed
// to miss the cache (or the banner would loop forever), and that version.json
// cannot drift from APP_VERSION.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  fetchDeployedVersion, isUpdateAvailable, reloadUrlFor, startUpdateWatch,
  VERSION_URL, MIN_INTERVAL_MS,
} from '../src/update-check.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const ok = (body) => async () => ({ ok: true, json: async () => body });

test('the check is fetched with cache:no-store — it must not be answered by the stale cache', async () => {
  const calls = [];
  const f = async (url, opts) => { calls.push([url, opts]); return { ok: true, json: async () => ({ version: 'v2' }) }; };
  assert.equal(await fetchDeployedVersion(f), 'v2');
  assert.equal(calls[0][0], VERSION_URL);
  assert.equal(calls[0][1].cache, 'no-store',
    "without no-store the update check is itself cacheable — the whole point is lost");
});

test('a broken check is silent: offline, 404, HTML error page, junk JSON all yield ""', async () => {
  const cases = [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false, status: 404, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('<!DOCTYPE html>'); } }),
    async () => ({ ok: true, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => ({ version: '' }) }),
    async () => ({ ok: true, json: async () => ({ version: 'a b c<script>' }) }),
    async () => null,
  ];
  for (const f of cases) assert.equal(await fetchDeployedVersion(f), '');
});

test('an update is any DIFFERENCE, so a rollback also prompts', () => {
  assert.ok(isUpdateAvailable('v2026-08-30.2', 'v2026-08-31.1'));
  assert.ok(isUpdateAvailable('v2026-08-31.1', 'v2026-08-30.2'), 'a rollback still needs a reload');
  assert.ok(!isUpdateAvailable('v2026-08-31.1', 'v2026-08-31.1'));
  for (const [a, b] of [['', 'v1'], ['v1', ''], [null, 'v1'], ['v1', undefined]]) {
    assert.ok(!isUpdateAvailable(a, b), `${a} / ${b} must not prompt`);
  }
});

test('the reload URL is a DIFFERENT url — a plain reload could be served from cache and loop', () => {
  const href = 'https://x.github.io/misbar-report/';
  const u = new URL(reloadUrlFor('v2026-08-31.1', href));
  assert.equal(u.searchParams.get('v'), 'v2026-08-31.1');
  assert.notEqual(u.toString(), href);
  // an existing v= is REPLACED, never appended, so the URL cannot grow each time
  const again = new URL(reloadUrlFor('v3', reloadUrlFor('v2', href)));
  assert.deepEqual(again.searchParams.getAll('v'), ['v3']);
  // other params survive
  const keep = new URL(reloadUrlFor('v2', href + '?auto=daily'));
  assert.equal(keep.searchParams.get('auto'), 'daily');
});

test('watch fires onUpdate exactly once, even across repeated visibility changes', async () => {
  const hits = [];
  const listeners = {};
  const doc = {
    visibilityState: 'visible',
    addEventListener: (n, fn) => { listeners[n] = fn; },
    removeEventListener: () => { delete listeners.visibilitychange; },
  };
  let t = 0;
  const stop = startUpdateWatch({
    current: 'v1', onUpdate: (v) => hits.push(v), fetchImpl: ok({ version: 'v2' }),
    doc, now: () => t,
  });
  await new Promise((r) => setTimeout(r, 5));
  t += MIN_INTERVAL_MS * 2;
  listeners.visibilitychange();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(hits, ['v2'], 'the banner is raised once, not once per check');
  stop();
});

test('watch throttles: a visibility flap inside the window does not re-fetch', async () => {
  let n = 0;
  const listeners = {};
  const doc = {
    visibilityState: 'visible',
    addEventListener: (k, fn) => { listeners[k] = fn; },
    removeEventListener: () => {},
  };
  const stop = startUpdateWatch({
    current: 'v1', onUpdate: () => {},
    fetchImpl: async () => { n++; return { ok: true, json: async () => ({ version: 'v1' }) }; },
    doc, now: () => 1000,
  });
  await new Promise((r) => setTimeout(r, 5));
  for (let i = 0; i < 5; i++) listeners.visibilitychange();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(n, 1, 'mobile flaps visibility constantly — one fetch per window');
  stop();
});

test('a throwing onUpdate cannot break boot, and stop() silences the watch', async () => {
  const listeners = {};
  const doc = { visibilityState: 'visible', addEventListener: (k, f) => { listeners[k] = f; }, removeEventListener: () => { delete listeners.visibilitychange; } };
  const stop = startUpdateWatch({
    current: 'v1', onUpdate: () => { throw new Error('banner blew up'); },
    fetchImpl: ok({ version: 'v2' }), doc, now: () => 0,
  });
  await new Promise((r) => setTimeout(r, 5));
  stop();
  assert.equal(listeners.visibilitychange, undefined);
});

test('missing fetch or missing current version disables the watch harmlessly', () => {
  assert.equal(typeof startUpdateWatch({ current: '', fetchImpl: ok({}) }), 'function');
  assert.equal(typeof startUpdateWatch({ current: 'v1', fetchImpl: null, doc: null }), 'function');
});

test('version.json matches APP_VERSION — a drift breaks the banner in both directions', () => {
  const v = readFileSync(join(ROOT, 'src/version.js'), 'utf8').match(/APP_VERSION\s*=\s*'([^']+)'/)[1];
  const published = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf8')).version;
  assert.equal(published, v,
    'run scripts/stamp-version.mjs — version.json is generated, never hand-edited');
});

test('index.html ?v= stamps match APP_VERSION too', () => {
  const v = readFileSync(join(ROOT, 'src/version.js'), 'utf8').match(/APP_VERSION\s*=\s*'([^']+)'/)[1];
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const stamps = [...new Set([...html.matchAll(/\?v=([^"'\s>&]+)/g)].map((m) => m[1]))];
  assert.deepEqual(stamps, [v], 'a stale index.html stamp is exactly the bug this feature exists to catch');
});

test('POLICY: the update check reads, never writes — no storage, no mutation', () => {
  const src = readFileSync(join(ROOT, 'src/update-check.js'), 'utf8');
  for (const bad of ['localStorage', 'sessionStorage', 'document.cookie', 'innerHTML']) {
    assert.ok(!src.includes(bad), `update-check must not touch ${bad}`);
  }
});
