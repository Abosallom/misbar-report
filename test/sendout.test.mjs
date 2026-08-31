// test/sendout.test.mjs — run with:  node --test
// Send-out attribution: where KAMC's tests are actually PERFORMED.
//
// The load-bearing assertions here are the ones that protect against a WRONG
// answer rather than a missing one: that a Saudi vendor shipping abroad counts
// as International, that a multi-country vendor is split on TEST NAME and never
// on LOINC, that an unrecognised lab is reported rather than guessed, and that
// all three tables reconcile to the same total.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  analyseSendout, hasMaster, norm, share, reflabShort, LOCAL_COUNTRY, CANCELLED_STATUS,
  FACILITY_TO_VENDOR, FACILITY_DISPLAY, AR_COUNTRY,
} from '../src/model/sendout.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '../src/model/sendout.js'), 'utf8');
// Source with comments stripped — several assertions below are about what the
// CODE does, and the comments deliberately discuss the things it must not do.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// A tiny master exercising every shape: single-country, and a two-country vendor
// whose split is decided per test.
const MASTER = [
  { vendor: 'Agent Co -Orig-', country: 'Germany', reflab: 'RefLab North', item: 'TEST A' },
  { vendor: 'Local Lab -Orig-', country: 'Saudi Arabia', reflab: 'CRL', item: 'TEST B' },
  { vendor: 'Split Vendor -Orig-', country: 'Saudi Arabia', reflab: 'RefLab Home', item: 'TEST HOME' },
  { vendor: 'Split Vendor -Orig-', country: 'USA', reflab: 'RefLab West', item: 'TEST AWAY' },
];
const ALIAS = {
  'agent co': 'agent co',
  'local lab': 'local lab',
  'split vendor': 'split vendor',
};
// Point the module's lookup tables at the fixture vendors for these unit tests.
for (const [k, v] of Object.entries(ALIAS)) {
  FACILITY_TO_VENDOR[k] = v;
  FACILITY_DISPLAY[k] = k.replace(/\b\w/g, (c) => c.toUpperCase());
}

const order = (facility, testName, rawStatus = 'Result Approved', orderId = 'x') =>
  ({ facility, testName, rawStatus, orderId });

test('norm strips the master file\'s -Orig- suffix and collapses spacing', () => {
  assert.equal(norm('Saudi Diagnostic Limited Co. -Orig-'), 'saudi diagnostic limited co.');
  assert.equal(norm('Anwa  Medical   Company'), 'anwa medical company');
  assert.equal(norm('  EUROFINS Clinical '), 'eurofins clinical');
  assert.equal(norm(null), '');
});

test('cancelled orders are excluded from EVERY count and percentage', () => {
  const r = analyseSendout([
    order('Agent Co', 'TEST A'),
    order('Agent Co', 'TEST A', CANCELLED_STATUS),
    order('Agent Co', 'TEST A', CANCELLED_STATUS),
  ], MASTER);
  assert.equal(r.total, 1);
  assert.equal(r.international, 1);
  assert.equal(r.byCountry.reduce((a, c) => a + c.orders, 0), 1);
});

test("'Result Rejected' is NOT cancelled — those orders still count", () => {
  const r = analyseSendout([order('Agent Co', 'TEST A', 'Result Rejected')], MASTER);
  assert.equal(r.total, 1);
  assert.equal(r.international, 1);
});

test('LOCAL means PERFORMED in Saudi Arabia, not ordered from a Saudi company', () => {
  // 'Agent Co' is the shape that matters: a local agent whose reference lab is
  // in Germany. Counting it as Local because the vendor is Saudi would be the
  // single most damaging error these slides can make.
  const r = analyseSendout([order('Agent Co', 'TEST A'), order('Local Lab', 'TEST B')], MASTER);
  assert.equal(r.local, 1, 'only the lab that actually runs it in-Kingdom is Local');
  assert.equal(r.international, 1);
  assert.equal(r.byCountry.find((c) => c.country === 'Germany').orders, 1);
});

test('a multi-country vendor splits by TEST NAME, giving one row per country', () => {
  const r = analyseSendout([
    order('Split Vendor', 'TEST HOME'),
    order('Split Vendor', 'TEST AWAY'),
    order('Split Vendor', 'TEST AWAY'),
  ], MASTER);
  assert.equal(r.local, 1);
  assert.equal(r.international, 2);
  const rows = r.byLab.filter((x) => x.lab === 'Split Vendor');
  assert.equal(rows.length, 2, 'a lab in two countries produces TWO rows');
  assert.deepEqual(rows.map((x) => x.country), ['Saudi Arabia', 'USA']);
  assert.deepEqual(rows.map((x) => x.reflab), ['RefLab Home', 'RefLab West']);
});

test('test-name matching ignores case and whitespace, and never uses LOINC', () => {
  const r = analyseSendout([
    order('Split Vendor', '  test   home  '),
    { facility: 'Split Vendor', testName: 'TEST AWAY', loinc: '94818-2', rawStatus: 'ok' },
  ], MASTER);
  assert.equal(r.local, 1);
  assert.equal(r.international, 1);
  assert.equal(r.unresolved.length, 0);
  // The module must not consult a LOINC field at all: the two files disagree on
  // codes, and one code exists in the master against a different test abroad.
  // Comments MENTION loinc (explaining why it is avoided), so strip them first
  // and assert on executable code only.
  assert.ok(!/\.loinc\b|\['loinc'\]|\bloinc\s*:/i.test(CODE),
    'sendout must never read a LOINC field');
});

test("a multi-country vendor's unknown test is Unresolved — never split arbitrarily", () => {
  const r = analyseSendout([order('Split Vendor', 'TEST NOBODY HAS')], MASTER);
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.local + r.international, 0, 'an unresolved order is attributed to no country');
  assert.equal(r.total, 1, 'but it still counts toward the basis');
});

test('an UNRECOGNISED lab name is reported, never guessed and never merged', () => {
  const r = analyseSendout([
    order('Some Lab Nobody Mapped', 'TEST A'),
    order('Agent Co', 'TEST A'),
  ], MASTER);
  assert.equal(r.unmapped.length, 1);
  assert.equal(r.unmapped[0].facility, 'Some Lab Nobody Mapped');
  assert.equal(r.byLab.length, 1, 'the unmapped lab gets no row of its own');
  assert.ok(!r.byLab.some((x) => /Nobody/.test(x.lab)));
  assert.equal(r.byCountry.reduce((a, c) => a + c.orders, 0), 1, 'and no country');
});

test('a BLANK facility is inferred from the same test — but only if unambiguous', () => {
  // Unambiguous: every other order of TEST A goes to one lab.
  const ok = analyseSendout([
    order('Agent Co', 'TEST A'), order('Agent Co', 'TEST A'),
    order(null, 'TEST A'),
  ], MASTER);
  assert.equal(ok.inferred.length, 1);
  assert.equal(ok.unmapped.length, 0);
  assert.equal(ok.inferred[0].lab, 'Agent Co');
  assert.equal(ok.inferred[0].country, 'Germany');
  assert.equal(ok.inferred[0].support, 2, 'reports how many orders back the inference');
  assert.equal(ok.byLab.find((x) => x.lab === 'Agent Co').orders, 3);

  // Ambiguous: that test runs at two different labs, so inferring would be a coin
  // flip. It must stay unmapped rather than be credited to either.
  const split = analyseSendout([
    order('Split Vendor', 'TEST HOME'),
    { facility: 'Local Lab', testName: 'TEST HOME', rawStatus: 'ok' },
    order(null, 'TEST HOME'),
  ], [...MASTER, { vendor: 'Local Lab -Orig-', country: 'Saudi Arabia', reflab: 'CRL', item: 'TEST HOME' }]);
  assert.equal(split.inferred.length, 0);
  assert.equal(split.unmapped.length, 1, 'ambiguous inference must not be made');
});

test('an unrecognised NAME is never inferred, even when the test is unambiguous', () => {
  // This is the distinction that keeps master-file holes visible: a blank field
  // is a gap in the order, but a name we do not know is a gap in the MASTER, and
  // inferring past it would hide the thing Aziz needs to fix.
  const r = analyseSendout([
    order('Agent Co', 'TEST A'), order('Agent Co', 'TEST A'),
    order('Totally Unknown Lab', 'TEST A'),
  ], MASTER);
  assert.equal(r.inferred.length, 0);
  assert.equal(r.unmapped.length, 1);
});

test('percentages are one decimal and shares reconcile', () => {
  assert.equal(share(39, 1287), 3);
  assert.equal(share(574, 1287), 44.6);
  assert.equal(share(0, 0), 0);
});

test('byLab keeps a lab\'s country rows ADJACENT and labs alphabetical', () => {
  const r = analyseSendout([
    order('Split Vendor', 'TEST AWAY'),
    order('Agent Co', 'TEST A'),
    order('Split Vendor', 'TEST HOME'),
    order('Local Lab', 'TEST B'),
  ], MASTER);
  const labs = r.byLab.map((x) => x.lab);
  assert.deepEqual(labs, ['Agent Co', 'Local Lab', 'Split Vendor', 'Split Vendor']);
  // adjacency: a lab's rows form one contiguous run
  for (const lab of new Set(labs)) {
    const idx = labs.map((l, i) => (l === lab ? i : -1)).filter((i) => i >= 0);
    assert.equal(idx[idx.length - 1] - idx[0], idx.length - 1, `${lab} rows must be adjacent`);
  }
});

test('RECONCILIATION: local + international + unresolved + unmapped == total', () => {
  const r = analyseSendout([
    order('Agent Co', 'TEST A'),
    order('Local Lab', 'TEST B'),
    order('Split Vendor', 'TEST NOBODY HAS'),
    order('Who Knows', 'TEST A'),
    order('Agent Co', 'TEST A', CANCELLED_STATUS),
  ], MASTER);
  assert.equal(r.local + r.international + r.unresolved.length + r.unmapped.length, r.total);
  const byCountry = r.byCountry.reduce((a, c) => a + c.orders, 0);
  const byLab = r.byLab.reduce((a, l) => a + l.orders, 0);
  assert.equal(byCountry, byLab, 'table B and table C must agree');
  assert.equal(byCountry + r.unresolved.length + r.unmapped.length, r.total);
  // and per country
  for (const c of r.byCountry) {
    const s = r.byLab.filter((l) => l.country === c.country).reduce((a, l) => a + l.orders, 0);
    assert.equal(s, c.orders, `country ${c.country}: C must equal B`);
  }
});

test('a country with no orders this period is OMITTED, not shown as zero', () => {
  const r = analyseSendout([order('Agent Co', 'TEST A')], MASTER);
  assert.deepEqual(r.byCountry.map((c) => c.country), ['Germany']);
  assert.ok(!r.byCountry.some((c) => c.orders === 0));
});

test('empty / junk input degrades quietly rather than throwing', () => {
  for (const bad of [null, undefined, [], 'nonsense', 42]) {
    const r = analyseSendout(bad, MASTER);
    assert.equal(r.total, 0);
    assert.deepEqual(r.byCountry, []);
    assert.deepEqual(r.byLab, []);
  }
  assert.equal(analyseSendout([order('Agent Co', 'TEST A')], []).unmapped.length, 1);
});

test('a missing or empty catalogue is refused by hasMaster, not silently analysed', () => {
  // With no catalogue EVERY order comes back unmapped. Callers must gate on this
  // and omit the slides; a deck that reported every lab as unmapped would be
  // worse than no deck, and one that guessed would be worse still.
  for (const bad of [null, undefined, [], 'nope', 42]) assert.equal(hasMaster(bad), false);
  assert.equal(hasMaster(MASTER), true);
  const r = analyseSendout([order('Agent Co', 'TEST A')], []);
  assert.equal(r.unmapped.length, 1, 'no catalogue => nothing can be attributed');
  assert.equal(r.byLab.length, 0);
});

test('every country the catalogue can contain has an Arabic name for the slides', () => {
  // The real workbook's countries, as of the 2026 master file. A country with no
  // Arabic label would render its raw English name mid-sentence on an RTL slide.
  for (const c of ['Saudi Arabia', 'Germany', 'Bahrain', 'USA', 'Jordan', 'Finland', 'Romania', 'South Korea']) {
    assert.ok(AR_COUNTRY[c], `no Arabic label for country '${c}'`);
  }
});

test('POLICY: the module is pure — no DOM, no clock, no network', () => {
  for (const bad of ['document.', 'window.', 'fetch(', 'Date.now', 'new Date', 'localStorage']) {
    assert.ok(!CODE.includes(bad), `sendout must not reference ${bad}`);
  }
});

test('reflabShort abbreviates a long SHOUTED name and leaves others alone', () => {
  assert.equal(reflabShort('BIG NATIONAL SPECIALIST HOSPITAL'), 'BNSH');
  assert.equal(reflabShort('RefLab North'), 'RefLab North', 'mixed case is left as written');
  assert.equal(reflabShort('SHORT LAB'), 'SHORT LAB', 'a short name is not abbreviated');
  assert.equal(reflabShort(''), '');
  assert.equal(reflabShort(null), '');
});
