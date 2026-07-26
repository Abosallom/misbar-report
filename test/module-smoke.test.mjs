// test/module-smoke.test.mjs — run with:  node --test
//
// WHY THIS EXISTS. `node --check foo.js` parses a .js file in this repo as a CommonJS
// script (package.json has no "type"), so it accepts a file whose ES-module syntax is
// broken — a mid-line `//` comment that swallowed the rest of an object literal passed
// --check cleanly and only failed at import time. Combined with the fact that the deck
// builder and the UI screens are not imported by any other test, a syntax error in them
// could reach production. This suite imports EVERY module under src/ as a real ES module,
// so any parse or top-level evaluation error fails the build.
//
// DOM-dependent modules are fine to import: they only touch document/window inside
// functions. Anything that genuinely needs a DOM at module scope belongs in SKIP with a
// reason, not in a silent exclusion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, copyFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

// Modules that cannot be EVALUATED in bare node, with the reason. These are still
// parse-checked as ES modules below (copied to a .mjs so node stops treating them as
// CommonJS), so a syntax error in them still fails this suite.
const SKIP = new Map([
  ['src/main.js', 'app entry point: boots the router and touches document on import'],
]);

/** Parse-only ES-module check: copy to .mjs so node cannot fall back to script parsing. */
function assertParsesAsEsm(file, rel) {
  const dir = mkdtempSync(join(tmpdir(), 'misbar-esm-'));
  const copy = join(dir, 'mod.mjs');
  copyFileSync(file, copy);
  try {
    execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stderr && e.stderr.toString()) || (e.message || '');
    throw new Error(`${rel} does not parse as an ES module:\n${msg.split('\n').slice(0, 4).join('\n')}`);
  }
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const files = walk(SRC).sort();

test('every src module parses and evaluates as an ES module', async () => {
  assert.ok(files.length > 20, `expected the full src tree, found ${files.length} files`);
  const failures = [];
  for (const file of files) {
    const rel = relative(join(HERE, '..'), file);
    if (SKIP.has(rel)) {
      try { assertParsesAsEsm(file, rel); } catch (e) { failures.push(e.message); }
      continue;
    }
    try {
      await import(pathToFileURL(file).href);
    } catch (e) {
      failures.push(`${rel}: ${(e && e.message) || e}`);
    }
  }
  assert.deepEqual(failures, [], `modules failed to import:\n${failures.join('\n')}`);
});

test('the deck builder actually builds both variants', async () => {
  // The builder is the one module whose breakage is invisible to every other test, and
  // it is what produces the client-facing files. Import it and exercise it for real.
  const { buildSpec } = await import(pathToFileURL(join(SRC, 'slidespec', 'build-spec.js')).href);
  const { MOCK_REPORT_MODEL } = await import(
    pathToFileURL(join(HERE, 'fixtures', 'mock-report-model.js')).href
  );
  for (const variant of ['nupco', 'internal']) {
    const spec = buildSpec(MOCK_REPORT_MODEL, { variant });
    assert.ok(Array.isArray(spec) && spec.length >= 6, `${variant}: expected >=6 slides`);
    for (const [i, slide] of spec.entries()) {
      assert.ok(Array.isArray(slide.elements) && slide.elements.length, `${variant} slide ${i} is empty`);
    }
  }
});
