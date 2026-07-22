// test/tat-suggest.test.mjs — `node --test test/tat-suggest.test.mjs`
// Unit-tests the analytical TAT suggester: one case per rule, precedence,
// mode/median math, similarity threshold, and empty-input / order safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { suggestTats } from '../src/ingest/tat-suggest.js';

// Minimal OrderRow factory — only the fields the suggester reads.
const row = (o = {}) => ({
  orderDate: '2026-06-01', facility: null, orderId: '1', lineNo: 1,
  loinc: null, testName: 'X', collected: null, dispatched: null,
  received: null, resulted: null, rawStatus: '', tatDaysCsv: null, ...o,
});

// A tiny lookup + LOINC pair mirroring the seed's shape.
const LOOKUP = {
  'SEND OUT TEST COPPER BLOOD DRC-ICP-MS': 3,
  'SEND OUT TEST VITAMIN E BLOOD LC-MS/MS': 8,
};
const LOINC = {
  'SEND OUT TEST COPPER BLOOD DRC-ICP-MS': '12556-7',
  'SEND OUT TEST VITAMIN E BLOOD LC-MS/MS': '1823-4',
};

test('rule 1 — LOINC exact-code match yields high-confidence suggestion', () => {
  const out = suggestTats({
    unmatched: ['MYSTERY COPPER PANEL'],
    rows: [row({ testName: 'MYSTERY COPPER PANEL', loinc: '12556-7' })],
    tatLookup: LOOKUP, tatLoinc: LOINC,
  });
  assert.equal(out.length, 1);
  assert.deepEqual(
    { ...out[0], evidence: undefined },
    { testName: 'MYSTERY COPPER PANEL', suggested: 3, source: 'loinc', confidence: 'high', evidence: undefined },
  );
  assert.match(out[0].evidence, /LOINC 12556-7/);
  assert.match(out[0].evidence, /COPPER BLOOD DRC-ICP-MS/);
  assert.match(out[0].evidence, /TAT 3/);
});

test('rule 2 — CSV mode picks the most frequent TAT-Days value', () => {
  const out = suggestTats({
    unmatched: ['NEW SEND OUT'],
    rows: [
      row({ testName: 'NEW SEND OUT', tatDaysCsv: 5 }),
      row({ testName: 'NEW SEND OUT', tatDaysCsv: 5 }),
      row({ testName: 'NEW SEND OUT', tatDaysCsv: 7 }),
      row({ testName: 'NEW SEND OUT', tatDaysCsv: null }),
    ],
    tatLookup: LOOKUP, tatLoinc: LOINC,
  });
  assert.equal(out[0].suggested, 5); // mode of [5,5,7]
  assert.equal(out[0].source, 'csv');
  assert.equal(out[0].confidence, 'high');
  assert.match(out[0].evidence, /3 سطر/); // 3 non-null CSV rows counted
});

test('mode — ties break by first appearance', () => {
  const out = suggestTats({
    unmatched: ['TIEBREAK'],
    rows: [row({ testName: 'TIEBREAK', tatDaysCsv: 9 }), row({ testName: 'TIEBREAK', tatDaysCsv: 2 })],
    tatLookup: {}, tatLoinc: {},
  });
  assert.equal(out[0].suggested, 9); // both count 1 -> first seen wins
});

test('rule 3 — token-set similarity above threshold suggests the nearest lookup name', () => {
  // Shares COPPER/BLOOD/ICP; 'SEND OUT TEST' prefix stripped before tokenizing.
  const out = suggestTats({
    unmatched: ['SEND OUT TEST COPPER BLOOD ICP-MS'],
    rows: [row({ testName: 'SEND OUT TEST COPPER BLOOD ICP-MS' })],
    tatLookup: LOOKUP, tatLoinc: LOINC,
  });
  assert.equal(out[0].source, 'similar');
  assert.equal(out[0].confidence, 'medium');
  assert.equal(out[0].suggested, 3); // matches the COPPER lookup entry
  assert.match(out[0].evidence, /COPPER BLOOD DRC-ICP-MS/);
  assert.match(out[0].evidence, /تشابه \d+%/);
});

test('similarity threshold — a score below 0.5 falls through to the next rule (here: none)', () => {
  // unmatched {ALPHA, GAMMA, DELTA} vs lookup {ALPHA, BETA}:
  // shared=1, union=4 -> Jaccard 0.25 (< 0.5), so SIMILAR is rejected.
  const lookup = { 'ALPHA BETA': 1 };
  const out = suggestTats({
    unmatched: ['ALPHA GAMMA DELTA'],
    rows: [row({ testName: 'ALPHA GAMMA DELTA' })],
    tatLookup: lookup, tatLoinc: {},
  });
  assert.equal(out[0].source, null);
  assert.equal(out[0].suggested, null);
  assert.equal(out[0].evidence, 'لا توجد بيانات كافية للاقتراح');
});

test('similarity threshold — exactly 0.5 is accepted', () => {
  // {ALPHA, BETA} vs {ALPHA, BETA, GAMMA}: shared=2, union=3 -> 0.666 (>=0.5)
  const lookup = { 'ALPHA BETA': 4 };
  const out = suggestTats({
    unmatched: ['ALPHA BETA GAMMA'],
    rows: [row({ testName: 'ALPHA BETA GAMMA' })],
    tatLookup: lookup, tatLoinc: {},
  });
  assert.equal(out[0].source, 'similar');
  assert.equal(out[0].suggested, 4);
});

test('rule 4 — OBSERVED uses median actual calendar days, rounded up, min 1', () => {
  const out = suggestTats({
    unmatched: ['OBSERVED ONLY'],
    rows: [
      row({ testName: 'OBSERVED ONLY', received: '2026-06-01 08:00:00', resulted: '2026-06-04 12:00:00' }), // 3.16d
      row({ testName: 'OBSERVED ONLY', received: '2026-06-01 08:00:00', resulted: '2026-06-06 12:00:00' }), // 5.16d
      row({ testName: 'OBSERVED ONLY', received: '2026-06-01 08:00:00', resulted: null }), // ignored (no resulted)
    ],
    tatLookup: {}, tatLoinc: {},
  });
  assert.equal(out[0].source, 'observed');
  assert.equal(out[0].confidence, 'low');
  // median([3.16, 5.16]) = 4.16 -> ceil -> 5
  assert.equal(out[0].suggested, 5);
  assert.match(out[0].evidence, /2 نتيجة/);
});

test('rule 4 — same-day received/resulted floors to the minimum of 1 day', () => {
  const out = suggestTats({
    unmatched: ['SAME DAY'],
    rows: [row({ testName: 'SAME DAY', received: '2026-06-01 08:00:00', resulted: '2026-06-01 10:00:00' })],
    tatLookup: {}, tatLoinc: {},
  });
  assert.equal(out[0].suggested, 1); // ceil(0.08)=1, min 1
  assert.equal(out[0].source, 'observed');
});

test('precedence — LOINC beats CSV, CSV beats SIMILAR, SIMILAR beats OBSERVED', () => {
  // A single test row carrying everything: a matching LOINC, a CSV value,
  // a near-identical name, and received/resulted dates. LOINC must win.
  const loincWins = suggestTats({
    unmatched: ['SEND OUT TEST COPPER BLOOD DRC'],
    rows: [row({
      testName: 'SEND OUT TEST COPPER BLOOD DRC', loinc: '1823-4', // -> VITAMIN E (TAT 8)
      tatDaysCsv: 99, received: '2026-06-01', resulted: '2026-06-20',
    })],
    tatLookup: LOOKUP, tatLoinc: LOINC,
  });
  assert.equal(loincWins[0].source, 'loinc');
  assert.equal(loincWins[0].suggested, 8);

  // No LOINC -> CSV wins over similarity + observed.
  const csvWins = suggestTats({
    unmatched: ['SEND OUT TEST COPPER BLOOD DRC-ICP-MS'],
    rows: [row({
      testName: 'SEND OUT TEST COPPER BLOOD DRC-ICP-MS',
      tatDaysCsv: 42, received: '2026-06-01', resulted: '2026-06-20',
    })],
    tatLookup: LOOKUP, tatLoinc: LOINC,
  });
  assert.equal(csvWins[0].source, 'csv');
  assert.equal(csvWins[0].suggested, 42);

  // No LOINC, no CSV -> similarity wins over observed.
  const simWins = suggestTats({
    unmatched: ['SEND OUT TEST COPPER BLOOD DRC-ICP-MS'],
    rows: [row({
      testName: 'SEND OUT TEST COPPER BLOOD DRC-ICP-MS',
      received: '2026-06-01', resulted: '2026-06-20',
    })],
    tatLookup: LOOKUP, tatLoinc: LOINC,
  });
  assert.equal(simWins[0].source, 'similar');
  assert.equal(simWins[0].suggested, 3);
});

test('rule 5 — no signal at all yields a null suggestion', () => {
  const out = suggestTats({
    unmatched: ['TOTALLY UNKNOWN ZZZ'],
    rows: [row({ testName: 'TOTALLY UNKNOWN ZZZ' })], // no loinc, no csv, no dates
    tatLookup: LOOKUP, tatLoinc: LOINC,
  });
  assert.deepEqual(out[0], {
    testName: 'TOTALLY UNKNOWN ZZZ', suggested: null, source: null,
    confidence: null, evidence: 'لا توجد بيانات كافية للاقتراح',
  });
});

test('empty input — no unmatched tests yields an empty array', () => {
  assert.deepEqual(suggestTats({ unmatched: [], rows: [], tatLookup: {}, tatLoinc: {} }), []);
  // Also safe with a wholly empty/omitted argument object.
  assert.deepEqual(suggestTats({}), []);
  assert.deepEqual(suggestTats(), []);
});

test('output — one entry per unmatched test, original order preserved', () => {
  const names = ['ZZZ', 'AAA', 'MMM'];
  const out = suggestTats({ unmatched: names, rows: [], tatLookup: {}, tatLoinc: {} });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((o) => o.testName), names);
});
