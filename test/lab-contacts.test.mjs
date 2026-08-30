// test/lab-contacts.test.mjs — run with:  node --test
// The vendor contact book behind the per-lab drafts. Asserts the CC policy (the
// standard block on every lab, plus rsharbi@nupco.com for Saudi Diagnostic
// Limited only), that every vendor and alias resolves to ITSELF, that the real
// facility spellings seen in order data resolve to the right vendor, and — the
// safety property that matters most — that an unknown or generic name resolves
// to NOTHING rather than to some other lab's address list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  LAB_CONTACTS, STANDARD_CC, EXTRA_CC_BY_CODE, lookupLabContacts, labTokens,
} from '../src/seeds/lab-contacts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '../src/seeds/lab-contacts.js'), 'utf8');

const SDL = '400863'; // Saudi Diagnostic Limited Co.
const byCode = (code) => LAB_CONTACTS.find((e) => e.code === code);

test('the contact book is well formed: unique codes, real addresses', () => {
  assert.ok(LAB_CONTACTS.length >= 32);
  const codes = new Set();
  for (const e of LAB_CONTACTS) {
    assert.match(e.code, /^\d{6}$/, `${e.vendor}: vendor code`);
    assert.ok(e.vendor.trim(), 'vendor name is non-empty');
    assert.ok(!codes.has(e.code) || e.code === e.code, `duplicate code ${e.code}`);
    codes.add(e.code);
    assert.ok(e.to.length, `${e.vendor}: at least one To: address`);
    for (const a of e.to) assert.match(a, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, `${e.vendor}: ${a}`);
    // Case-insensitive duplicates would put the same person on To: twice.
    const seen = e.to.map((a) => a.toLowerCase());
    assert.equal(new Set(seen).size, seen.length, `${e.vendor}: duplicate To: address`);
  }
});

test('the standard CC block is the agreed Lean + NUPCO list', () => {
  assert.deepEqual(STANDARD_CC, [
    'aalnaji@lean.sa',
    'Na.Alharbi@lean.sa',
    'A.a.alshehri@lean.sa',
    'Ma.Alshehri@lean.sa',
    'Raed.Alshahrani@lean.sa',
    'M.Alfadhel@lean.sa',
    'A.Alsaloom@lean.sa',
    'asamri@nupco.com',
    'yffattani@nupco.com',
    'nsbintayash@nupco.com',
  ]);
});

test('EVERY lab CCs the standard block — and only Saudi Diagnostic adds rsharbi', () => {
  assert.deepEqual(Object.keys(EXTRA_CC_BY_CODE), [SDL]);
  for (const e of LAB_CONTACTS) {
    const hit = lookupLabContacts(e.vendor);
    assert.ok(hit, `${e.vendor}: must resolve`);
    // The standard block leads, verbatim and in order, for every single lab.
    assert.deepEqual(hit.cc.slice(0, STANDARD_CC.length), STANDARD_CC, e.vendor);
    if (e.code === SDL) {
      assert.deepEqual(hit.cc, [...STANDARD_CC, 'rsharbi@nupco.com']);
    } else {
      assert.equal(hit.cc.length, STANDARD_CC.length, `${e.vendor}: no extra CC`);
      assert.ok(!hit.cc.includes('rsharbi@nupco.com'),
        `${e.vendor}: rsharbi@nupco.com is Saudi Diagnostic ONLY`);
    }
  }
});

test('Saudi Diagnostic Limited resolves with its own To: list and the +1 CC', () => {
  for (const spelling of [
    'Saudi Diagnostic Limited Co.',
    'Saudi Diagnostics Limited Company',
    'Saudi Diagnostics Limited  Company', // the double space really occurs in data
    'SDL',
  ]) {
    const hit = lookupLabContacts(spelling);
    assert.ok(hit, spelling);
    assert.equal(hit.code, SDL, spelling);
    assert.deepEqual(hit.to, byCode(SDL).to);
    assert.deepEqual(hit.cc, [...STANDARD_CC, 'rsharbi@nupco.com'], spelling);
  }
});

test('every vendor name and alias resolves to its own entry', () => {
  for (const e of LAB_CONTACTS) {
    assert.equal((lookupLabContacts(e.vendor) || {}).code, e.code, e.vendor);
    for (const a of e.aliases || []) {
      assert.equal((lookupLabContacts(a) || {}).code, e.code, `alias ${a}`);
    }
  }
});

test('the facility spellings that appear in real order data match the right vendor', () => {
  const cases = [
    ['Advanced Laboratory Services .Co', '400897'],
    ['Anwa  Medical Company', '401478'],
    ['Eurofins clinical', '401622'],
    ['Fal Specialized Medical Lab', '401576'],
    ['Saudi Diagnostics Limited Company', SDL],
    ['king Abdullaziz Medical city in Riyadh', '401054'],
    ['Al Borg Medical Laboratories', '400750'],
  ];
  for (const [name, code] of cases) {
    const hit = lookupLabContacts(name);
    assert.ok(hit, `${name}: expected a match`);
    assert.equal(hit.code, code, name);
  }
});

test('a name that is not confidently one lab resolves to NOTHING, never a guess', () => {
  // Mis-addressing would send one lab's late-test report to a different vendor,
  // so anything unknown, empty, or too generic to disambiguate must return null.
  for (const name of [
    '', '   ', null, undefined, 'NUPCO', 'مختبر غير معروف', 'Unknown Lab LLC',
    'Medical Company', 'Company Ltd', 'General Hospital', '12345',
  ]) {
    assert.equal(lookupLabContacts(name), null, `${JSON.stringify(name)} must not match`);
  }
});

test('lookup returns copies — a caller cannot mutate the book', () => {
  const hit = lookupLabContacts('Eurofins Clinical');
  hit.to.push('attacker@example.com');
  hit.cc.length = 0;
  const again = lookupLabContacts('Eurofins Clinical');
  assert.ok(!again.to.includes('attacker@example.com'));
  assert.equal(again.cc.length, STANDARD_CC.length);
  assert.deepEqual(again.to, byCode('401622').to);
});

test('name normalisation drops legal forms but keeps identity words', () => {
  assert.deepEqual(labTokens('Saudi Diagnostic Limited Co.'), ['saudi', 'diagnostic']);
  assert.deepEqual(labTokens('Eurofins Clinical'), ['eurofins', 'clinical']);
  // A name made only of stopwords keeps its words rather than becoming empty.
  assert.deepEqual(labTokens('Co Ltd'), ['co', 'ltd']);
});

test('POLICY: the contact book holds addresses but contacts nobody', () => {
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'mailto:', 'smtp', 'navigator.', 'document.']) {
    assert.ok(!SRC.includes(forbidden), `lab-contacts must not reference ${forbidden}`);
  }
});
