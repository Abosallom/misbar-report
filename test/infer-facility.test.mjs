// test/infer-facility.test.mjs — run with:  node --test
// Filling a MISSING performing facility from the rest of the data.
//
// This rule has exactly one implementation because two surfaces read it: the
// compliance table (engine byLab) and the send-out slides. When they disagreed,
// one order showed up as a phantom lab called 'غير محدد' on one slide while the
// real lab's row sat one short on the other. The assertions that matter here are
// the ones that keep it CONSERVATIVE: it may only fill a blank, only when the
// answer is unambiguous, and it may never touch a name it simply does not know.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inferBlankFacilities, fillBlankFacilities } from '../src/engine/infer-facility.js';

const row = (facility, testName, extra = {}) => ({ facility, testName, ...extra });

test('a blank facility is filled from the other orders of the same test', () => {
  const rows = [
    row('Lab A', 'TEST ONE'),
    row('Lab A', 'TEST ONE'),
    row(null, 'TEST ONE'),
  ];
  const map = inferBlankFacilities(rows);
  assert.equal(map.size, 1);
  assert.equal(map.get(2), 'Lab A');
  const out = fillBlankFacilities(rows);
  assert.equal(out[2].facility, 'Lab A');
});

test('AMBIGUOUS stays blank — a test at two labs is never a coin flip', () => {
  const rows = [
    row('Lab A', 'TEST ONE'),
    row('Lab B', 'TEST ONE'),
    row(null, 'TEST ONE'),
  ];
  assert.equal(inferBlankFacilities(rows).size, 0);
  assert.equal(fillBlankFacilities(rows)[2].facility, null,
    'one unattributed order beats one credited to the wrong lab');
});

test('every empty shape counts as blank, and whitespace is not a facility', () => {
  for (const empty of [null, undefined, '', '   ', '\t']) {
    const rows = [row('Lab A', 'T'), row(empty, 'T')];
    assert.equal(fillBlankFacilities(rows)[1].facility, 'Lab A', `${JSON.stringify(empty)}`);
  }
});

test('an UNRECOGNISED name is left alone — only a blank is ever filled', () => {
  // A name nothing recognises is a gap in the reference data, not in the order.
  // Overwriting it would hide the very thing that needs fixing at source.
  const rows = [row('Lab A', 'TEST ONE'), row('Lab A', 'TEST ONE'), row('Who Is This', 'TEST ONE')];
  assert.equal(inferBlankFacilities(rows).size, 0);
  assert.equal(fillBlankFacilities(rows)[2].facility, 'Who Is This');
});

test('a blank row with no test name either cannot be inferred', () => {
  const rows = [row('Lab A', 'TEST ONE'), row(null, null), row(null, '  ')];
  assert.equal(inferBlankFacilities(rows).size, 0);
});

test('test names match case- and whitespace-insensitively', () => {
  const rows = [row('Lab A', 'Test  One'), row(null, '  TEST ONE ')];
  assert.equal(fillBlankFacilities(rows)[1].facility, 'Lab A');
});

test('two blanks of DIFFERENT tests each resolve to their own lab', () => {
  const rows = [
    row('Lab A', 'TEST ONE'), row('Lab B', 'TEST TWO'),
    row(null, 'TEST ONE'), row(null, 'TEST TWO'),
  ];
  const out = fillBlankFacilities(rows);
  assert.equal(out[2].facility, 'Lab A');
  assert.equal(out[3].facility, 'Lab B');
});

test('the input is never mutated, and an untouched list keeps its identity', () => {
  const rows = [row('Lab A', 'T'), row(null, 'T')];
  const out = fillBlankFacilities(rows);
  assert.equal(rows[1].facility, null, 'the caller\'s own row objects are shared — never mutate');
  assert.notEqual(out, rows);
  // nothing to fill → the SAME array back, so the common path costs nothing
  const clean = [row('Lab A', 'T'), row('Lab B', 'T')];
  assert.equal(fillBlankFacilities(clean), clean);
});

test('junk input degrades quietly', () => {
  for (const bad of [null, undefined, 'nonsense', 42, {}]) {
    assert.equal(inferBlankFacilities(bad).size, 0);
    assert.equal(fillBlankFacilities(bad), bad);
  }
  assert.doesNotThrow(() => fillBlankFacilities([null, undefined, 7]));
});

test('a blank is filled even when its own lab appears only once', () => {
  // One supporting order is still unambiguous — the bar is "exactly one lab",
  // not "several orders".
  const rows = [row('Lab A', 'RARE TEST'), row(null, 'RARE TEST')];
  assert.equal(fillBlankFacilities(rows)[1].facility, 'Lab A');
});

test('POLICY: the rule is pure — no clock, no I/O, no DOM', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../src/engine/infer-facility.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const bad of ['Date.now', 'new Date', 'fetch(', 'document.', 'window.', 'localStorage']) {
    assert.ok(!code.includes(bad), `infer-facility must not reference ${bad}`);
  }
});
