// test/delta-baseline.test.mjs — Worker H. Pure delta-baseline model. Run: node --test
// Covers recordSnapshot (add/update-in-place + 45-date trim) and pickDeltaBaseline
// (daily most-recent-before; the two WEEKDAY-ANCHORED weekly modes 'weekly-sun' /
// 'weekly-thu' — the weekly report is issued on Sunday and Thursday — including the
// anchored:false degrade, the legacy 'weekly' alias and timezone-independent weekday
// math; strictly-before enforcement, legacySnapshot fallback, and the null case).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recordSnapshot, pickDeltaBaseline, normalizeDeltaMode, DELTA_MODES, HISTORY_LIMIT,
} from '../src/model/delta-baseline.js';

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

// ---- pickDeltaBaseline: weekday-anchored weekly ------------------------------
// Real July-2026 weekdays (verified against Date.UTC): Sundays 05/12/19/26,
// Thursdays 02/09/16/23. reportDate 2026-07-26 is itself a Sunday.
const THREE_WEEKS = {
  '2026-07-02': { total: 2 },  // Thu
  '2026-07-05': { total: 5 },  // Sun
  '2026-07-09': { total: 9 },  // Thu
  '2026-07-12': { total: 12 }, // Sun
  '2026-07-16': { total: 16 }, // Thu
  '2026-07-19': { total: 19 }, // Sun
  '2026-07-21': { total: 21 }, // Tue — never an anchor
  '2026-07-23': { total: 23 }, // Thu
  '2026-07-25': { total: 25 }, // Sat — most recent overall (the daily pick)
  '2026-07-26': { total: 999 }, // SAME DAY as reportDate (Sun) — must be excluded
  '2026-08-02': { total: 888 }, // FUTURE Sunday — must be excluded
};

test('weekly-sun picks the most recent PRIOR Sunday (not same-day, not future)', () => {
  const out = pickDeltaBaseline({ history: THREE_WEEKS, reportDate: '2026-07-26', mode: 'weekly-sun' });
  assert.deepEqual(out, {
    numbers: { total: 19 }, baselineDate: '2026-07-19', mode: 'weekly-sun', anchored: true,
  });
});

test('weekly-thu picks the most recent PRIOR Thursday', () => {
  const out = pickDeltaBaseline({ history: THREE_WEEKS, reportDate: '2026-07-26', mode: 'weekly-thu' });
  assert.deepEqual(out, {
    numbers: { total: 23 }, baselineDate: '2026-07-23', mode: 'weekly-thu', anchored: true,
  });
});

test('the two weekly options never collapse onto the same baseline', () => {
  // Same history + same report date, three weeks deep: each mode walks back to its
  // own weekday, and neither takes the most recent date (07-25) the daily mode takes.
  const sun = pickDeltaBaseline({ history: THREE_WEEKS, reportDate: '2026-07-26', mode: 'weekly-sun' });
  const thu = pickDeltaBaseline({ history: THREE_WEEKS, reportDate: '2026-07-26', mode: 'weekly-thu' });
  const day = pickDeltaBaseline({ history: THREE_WEEKS, reportDate: '2026-07-26', mode: 'daily' });
  assert.notEqual(sun.baselineDate, thu.baselineDate);
  assert.equal(day.baselineDate, '2026-07-25');
  // Earlier weeks are reachable: drop the latest anchors and it steps one week back.
  const older = { ...THREE_WEEKS };
  delete older['2026-07-19'];
  delete older['2026-07-23'];
  assert.equal(pickDeltaBaseline({ history: older, reportDate: '2026-07-26', mode: 'weekly-sun' }).baselineDate, '2026-07-12');
  assert.equal(pickDeltaBaseline({ history: older, reportDate: '2026-07-26', mode: 'weekly-thu' }).baselineDate, '2026-07-16');
});

test('weekly falls back to the most recent prior report with anchored:false', () => {
  // History has no Sunday before the report date (07-21 Tue, 07-23 Thu) → the chips
  // still work off the most recent prior date, flagged as not weekday-anchored.
  const history = { '2026-07-21': { total: 21 }, '2026-07-23': { total: 23 } };
  const out = pickDeltaBaseline({ history, reportDate: '2026-07-26', mode: 'weekly-sun' });
  assert.deepEqual(out, {
    numbers: { total: 23 }, baselineDate: '2026-07-23', mode: 'weekly-sun', anchored: false,
  });
  // Symmetric: no Thursday in history → same degrade for weekly-thu.
  const noThu = pickDeltaBaseline({
    history: { '2026-07-19': { total: 19 }, '2026-07-21': { total: 21 } },
    reportDate: '2026-07-26',
    mode: 'weekly-thu',
  });
  assert.deepEqual(noThu, {
    numbers: { total: 21 }, baselineDate: '2026-07-21', mode: 'weekly-thu', anchored: false,
  });
});

test("legacy 'weekly' is an alias of 'weekly-sun'", () => {
  const legacy = pickDeltaBaseline({ history: THREE_WEEKS, reportDate: '2026-07-26', mode: 'weekly' });
  const sun = pickDeltaBaseline({ history: THREE_WEEKS, reportDate: '2026-07-26', mode: 'weekly-sun' });
  assert.deepEqual(legacy, sun);
  assert.equal(legacy.mode, 'weekly-sun'); // canonicalized in the output too
  assert.equal(normalizeDeltaMode('weekly'), 'weekly-sun');
});

test('an unknown mode falls back to daily', () => {
  for (const bad of ['weekly-mon', 'WEEKLY-SUN', '', null, undefined, 7, {}]) {
    assert.equal(normalizeDeltaMode(bad), 'daily', `${String(bad)} → daily`);
  }
  const out = pickDeltaBaseline({ history: THREE_WEEKS, reportDate: '2026-07-26', mode: 'monthly' });
  assert.deepEqual(out, { numbers: { total: 25 }, baselineDate: '2026-07-25', mode: 'daily' });
  assert.deepEqual(DELTA_MODES, ['daily', 'weekly-sun', 'weekly-thu']);
});

test('weekday anchoring is timezone-independent', () => {
  // A local-midnight Date() shifts the day for negative UTC offsets, which would make
  // 'weekly-sun' pick a Saturday in America/* and a Sunday in Asia/Riyadh. Run the
  // same pick under several TZs (process.env.TZ is honoured on the next Date call in
  // Node) and assert the answer never moves. Also pin the two edge weekdays: 07-25
  // (Sat) must never anchor Sunday, and 07-27 (Mon) must never anchor Sunday either.
  const original = process.env.TZ;
  const history = {
    '2026-07-19': { total: 19 }, // Sun
    '2026-07-23': { total: 23 }, // Thu
    '2026-07-25': { total: 25 }, // Sat
  };
  try {
    for (const tz of ['UTC', 'Asia/Riyadh', 'Pacific/Kiritimati', 'Pacific/Midway', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      const sun = pickDeltaBaseline({ history, reportDate: '2026-07-26', mode: 'weekly-sun' });
      const thu = pickDeltaBaseline({ history, reportDate: '2026-07-26', mode: 'weekly-thu' });
      assert.deepEqual(
        [sun.baselineDate, sun.anchored, thu.baselineDate, thu.anchored],
        ['2026-07-19', true, '2026-07-23', true],
        `TZ=${tz}`,
      );
      // The Saturday is only ever the DAILY pick, never a Sunday anchor.
      assert.equal(pickDeltaBaseline({ history, reportDate: '2026-07-26', mode: 'daily' }).baselineDate, '2026-07-25');
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});

test('weekly enforces strictly-before across a year boundary', () => {
  // 2025-12-28 is a Sunday, 2026-01-04 the next one. Report date 2026-01-01 → the
  // 2026 Sunday is in the future and excluded; the December one anchors.
  const history = { '2025-12-28': { total: 1 }, '2026-01-04': { total: 2 } };
  const out = pickDeltaBaseline({ history, reportDate: '2026-01-01', mode: 'weekly-sun' });
  assert.equal(out.baselineDate, '2025-12-28');
  assert.equal(out.anchored, true);
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
