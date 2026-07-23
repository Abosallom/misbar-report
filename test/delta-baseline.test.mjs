// test/delta-baseline.test.mjs — Worker H. Pure delta-baseline model. Run: node --test
// Covers recordSnapshot (add/update-in-place + 45-date trim) and pickDeltaBaseline
// (daily most-recent-before, weekly closest-to-7-days-back with older-wins ties,
// strictly-before enforcement, legacySnapshot fallback, and the null case).

import test from 'node:test';
import assert from 'node:assert/strict';

import { recordSnapshot, pickDeltaBaseline, HISTORY_LIMIT } from '../src/model/delta-baseline.js';

// Deterministic ISO-date generator for fixtures (UTC; no Date.now in the module).
function iso(base, addDays) {
  const t = Date.UTC(+base.slice(0, 4), +base.slice(5, 7) - 1, +base.slice(8, 10)) + addDays * 86400000;
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// ---- recordSnapshot ---------------------------------------------------------
test('recordSnapshot adds an entry without mutating the input', () => {
  const before = { '2026-07-01': { total: 1 } };
  const after = recordSnapshot(before, '2026-07-02', { total: 2 });
  assert.deepEqual(after, { '2026-07-01': { total: 1 }, '2026-07-02': { total: 2 } });
  // Input untouched (pure function).
  assert.deepEqual(before, { '2026-07-01': { total: 1 } });
  assert.notEqual(after, before);
});

test('recordSnapshot updates the same date in place (replaces, no duplicate)', () => {
  let h = { '2026-07-01': { total: 1 } };
  h = recordSnapshot(h, '2026-07-01', { total: 9, completed: 5 });
  assert.deepEqual(Object.keys(h), ['2026-07-01']);
  assert.deepEqual(h['2026-07-01'], { total: 9, completed: 5 });
});

test('recordSnapshot drops non-finite numeric leaves', () => {
  const h = recordSnapshot({}, '2026-07-01', { total: 10, bad: NaN, str: 'x', inf: Infinity, ok: 0 });
  assert.deepEqual(h['2026-07-01'], { total: 10, ok: 0 });
});

test('recordSnapshot trims to the most recent 45 dates', () => {
  let h = {};
  // 50 consecutive days starting 2026-01-01.
  for (let i = 0; i < 50; i++) h = recordSnapshot(h, iso('2026-01-01', i), { total: i });
  const keys = Object.keys(h).sort();
  assert.equal(keys.length, HISTORY_LIMIT);
  assert.equal(keys.length, 45);
  // Oldest 5 (days 0..4) dropped; the newest 45 (days 5..49) kept.
  assert.equal(keys[0], iso('2026-01-01', 5));
  assert.equal(keys[keys.length - 1], iso('2026-01-01', 49));
  assert.equal(h[iso('2026-01-01', 5)].total, 5);
  assert.equal(h[iso('2026-01-01', 0)], undefined);
});

test('recordSnapshot tolerates a non-object history and ignores an invalid date', () => {
  assert.deepEqual(recordSnapshot(null, '2026-07-01', { total: 1 }), { '2026-07-01': { total: 1 } });
  // Invalid isoDate → the date is not added; a clean copy of prior entries is returned.
  assert.deepEqual(recordSnapshot({ '2026-07-01': { total: 1 } }, 'not-a-date', { total: 2 }), {
    '2026-07-01': { total: 1 },
  });
});

// ---- pickDeltaBaseline: daily -----------------------------------------------
test('daily picks the most recent history date strictly before reportDate (not same-day)', () => {
  const history = {
    '2026-07-10': { total: 10 },
    '2026-07-20': { total: 20 },
    '2026-07-22': { total: 22 },
    '2026-07-23': { total: 999 }, // same day as reportDate — must be excluded
  };
  const out = pickDeltaBaseline({ history, reportDate: '2026-07-23', mode: 'daily' });
  assert.deepEqual(out, { numbers: { total: 22 }, baselineDate: '2026-07-22', mode: 'daily' });
});

test('daily is the default when mode is omitted/unknown', () => {
  const history = { '2026-07-19': { total: 1 }, '2026-07-22': { total: 2 } };
  const out = pickDeltaBaseline({ history, reportDate: '2026-07-23' });
  assert.equal(out.baselineDate, '2026-07-22');
  assert.equal(out.mode, 'daily');
});

// ---- pickDeltaBaseline: weekly ----------------------------------------------
test('weekly picks the history date closest to (reportDate − 7 days)', () => {
  // reportDate 2026-07-23 → target 2026-07-16.
  const history = {
    '2026-07-10': { total: 10 }, // 6 off
    '2026-07-15': { total: 15 }, // 1 off  ← closest
    '2026-07-20': { total: 20 }, // 4 off
    '2026-07-22': { total: 22 }, // 6 off
  };
  const out = pickDeltaBaseline({ history, reportDate: '2026-07-23', mode: 'weekly' });
  assert.deepEqual(out, { numbers: { total: 15 }, baselineDate: '2026-07-15', mode: 'weekly' });
});

test('weekly breaks equidistant ties toward the OLDER date', () => {
  // target 2026-07-16; 07-14 and 07-18 are both 2 days off → older (07-14) wins.
  const history = {
    '2026-07-14': { total: 14 },
    '2026-07-18': { total: 18 },
  };
  // Prove order-independence: same result whichever key iterates first.
  const a = pickDeltaBaseline({ history, reportDate: '2026-07-23', mode: 'weekly' });
  const b = pickDeltaBaseline({
    history: { '2026-07-18': { total: 18 }, '2026-07-14': { total: 14 } },
    reportDate: '2026-07-23',
    mode: 'weekly',
  });
  assert.equal(a.baselineDate, '2026-07-14');
  assert.equal(b.baselineDate, '2026-07-14');
});

test('weekly still enforces strictly-before (a nearer future date is ignored)', () => {
  // target 2026-07-16; 2026-07-25 is closer to target than 2026-07-10 by 2 days,
  // but it is on/after reportDate 2026-07-23 → excluded, so 07-10 is chosen.
  const history = { '2026-07-10': { total: 10 }, '2026-07-25': { total: 25 } };
  const out = pickDeltaBaseline({ history, reportDate: '2026-07-23', mode: 'weekly' });
  assert.equal(out.baselineDate, '2026-07-10');
});

// ---- strictly-before across a month boundary --------------------------------
test('strictly-before is a real date comparison, not string prefix', () => {
  const history = { '2026-06-30': { total: 1 }, '2026-07-01': { total: 2 } };
  const out = pickDeltaBaseline({ history, reportDate: '2026-07-01', mode: 'daily' });
  // 07-01 equals reportDate (excluded); 06-30 is the most recent strictly-before.
  assert.equal(out.baselineDate, '2026-06-30');
});

// ---- fallback to legacySnapshot ---------------------------------------------
test('falls back to legacySnapshot when history has no qualifying entry', () => {
  const legacySnapshot = { asOf: '2026-07-09', numbers: { total: 618 } };
  // Empty history.
  const empty = pickDeltaBaseline({ history: {}, legacySnapshot, reportDate: '2026-07-23', mode: 'daily' });
  assert.deepEqual(empty, { numbers: { total: 618 }, baselineDate: '2026-07-09', mode: 'legacy' });
  // History exists but every entry is on/after reportDate → still legacy.
  const future = pickDeltaBaseline({
    history: { '2026-07-23': { total: 1 }, '2026-08-01': { total: 2 } },
    legacySnapshot,
    reportDate: '2026-07-23',
    mode: 'weekly',
  });
  assert.equal(future.mode, 'legacy');
  assert.equal(future.baselineDate, '2026-07-09');
});

test('legacySnapshot fallback yields baselineDate null when asOf is missing', () => {
  const out = pickDeltaBaseline({ history: {}, legacySnapshot: { numbers: { total: 5 } }, reportDate: '2026-07-23' });
  assert.deepEqual(out, { numbers: { total: 5 }, baselineDate: null, mode: 'legacy' });
});

// ---- null when nothing qualifies --------------------------------------------
test('returns null when neither history nor legacySnapshot yields a baseline', () => {
  assert.equal(pickDeltaBaseline({ history: {}, reportDate: '2026-07-23', mode: 'daily' }), null);
  assert.equal(pickDeltaBaseline({}), null);
  // History present but all on/after reportDate, and no legacy → null.
  assert.equal(
    pickDeltaBaseline({ history: { '2026-07-23': { total: 1 } }, reportDate: '2026-07-23', mode: 'daily' }),
    null,
  );
  // Legacy present but with no numbers object → not a usable baseline → null.
  assert.equal(pickDeltaBaseline({ history: {}, legacySnapshot: { asOf: '2026-07-09' }, reportDate: '2026-07-23' }), null);
});

// ---- history preferred over legacy ------------------------------------------
test('a qualifying history entry wins over the legacySnapshot fallback', () => {
  const out = pickDeltaBaseline({
    history: { '2026-07-22': { total: 22 } },
    legacySnapshot: { asOf: '2026-07-09', numbers: { total: 618 } },
    reportDate: '2026-07-23',
    mode: 'daily',
  });
  assert.equal(out.baselineDate, '2026-07-22');
  assert.equal(out.mode, 'daily');
});
