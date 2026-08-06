// test/delta-baseline.test.mjs — the SURVIVING half of the delta-baseline model.
// Run: node --test test/delta-baseline.test.mjs
//
// RETIRED 2026-08-05 (Talal's rule 1+2 round). `pickDeltaBaseline` and every case
// that exercised it are GONE, along with the whole chip vocabulary it carried —
// the daily most-recent-before pick, the week-to-date accumulation, the week
// rollover, the anchored:false degrade, the legacySnapshot fallback and the null
// case. The green chips no longer diff against a STORED REPORT at all: they are
// the WEEK'S ACTIVITY, computed from the rows' own date columns by
// src/model/delta-window.js, and pinned by test/delta-window.test.mjs. A baseline
// that has to exist before a chip can be drawn was exactly the fragility that got
// removed, so testing how one was chosen would be testing a deleted product.
//
// WHAT REMAINS HERE, and why each piece is still load-bearing:
//   • recordSnapshot — the HISTORY PANEL still writes and reads snapshotHistory
//     (recordRunSnapshot, store validation/import). Its purity, its
//     update-in-place, its non-finite filtering and the 45-date trim are all
//     still live behaviour.
//   • the deltaMode ENUM and its normalizers — reportOptions.deltaMode survives
//     with the SAME storage key and the SAME two values ['daily','week'], default
//     'week'. Only the SEMANTICS moved: the value used to choose a baseline, it
//     now chooses a WINDOW SIZE. So the enum, the retired-alias mapping and the
//     prototype-key guard all still have to hold.
//   • isWeekDeltaMode — still the predicate the review screen switches on.
// The Sunday week math (isoToDays / isoWeekday / weekStartDay) also lives on in
// this module and is now SHARED with delta-window.js; it is exercised through the
// window in test/delta-window.test.mjs, and directly at the bottom of this file.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recordSnapshot, normalizeDeltaMode, canonicalDeltaMode, isWeekDeltaMode,
  isoToDays, isoWeekday, weekStartDay,
  DELTA_MODES, DEFAULT_DELTA_MODE, HISTORY_LIMIT,
} from '../src/model/delta-baseline.js';

// Deterministic ISO-date generator for fixtures (UTC; no Date.now in the module).
function iso(base, addDays) {
  const t = Date.UTC(+base.slice(0, 4), +base.slice(5, 7) - 1, +base.slice(8, 10)) + addDays * 86400000;
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// ---- recordSnapshot (still live: the history panel) --------------------------
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

// ---- the deltaMode enum (same key, same values; the SEMANTICS moved) --------
test('the mode enum is the two published modes and week is the default', () => {
  assert.deepEqual(DELTA_MODES, ['daily', 'week']);
  assert.equal(DEFAULT_DELTA_MODE, 'week');
  assert.ok(DELTA_MODES.includes(DEFAULT_DELTA_MODE), 'the default must be a member of the enum');
});

test('an unknown mode falls back to the default, and canonicalDeltaMode says null', () => {
  for (const bad of ['weekly-mon', 'WEEK', 'monthly', '', null, undefined, 7, {}]) {
    assert.equal(normalizeDeltaMode(bad), DEFAULT_DELTA_MODE, `${String(bad)} → ${DEFAULT_DELTA_MODE}`);
    assert.equal(canonicalDeltaMode(bad), null, `canonicalDeltaMode(${String(bad)}) → null`);
  }
  // PROTOTYPE-KEY GUARD: the alias table must be null-prototype, or a stored deltaMode of
  // 'toString' / 'constructor' would resolve to an inherited Function and be treated as a
  // real mode (store.js then persists it and every consumer switches on garbage).
  for (const proto of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.equal(canonicalDeltaMode(proto), null, `canonicalDeltaMode('${proto}') must be null`);
    assert.equal(normalizeDeltaMode(proto), DEFAULT_DELTA_MODE, `'${proto}' → ${DEFAULT_DELTA_MODE}`);
  }
  assert.equal(canonicalDeltaMode('nope'), null);
  assert.equal(canonicalDeltaMode('daily'), 'daily');
  assert.equal(canonicalDeltaMode('week'), 'week');
});

test('isWeekDeltaMode is true for week and every alias, false for daily', () => {
  // screen-review's old isWeeklyMode used startsWith('weekly') — 'week' FAILS that, which
  // would silently delete both baseline disclosures. This predicate is its replacement.
  assert.equal(isWeekDeltaMode('week'), true);
  assert.equal(isWeekDeltaMode('weekly'), true);
  assert.equal(isWeekDeltaMode('weekly-sun'), true);
  assert.equal(isWeekDeltaMode('weekly-thu'), true);
  assert.equal(isWeekDeltaMode('daily'), false);
  // Unknown values normalize to the DEFAULT, which is 'week' — the disclosures stay on.
  assert.equal(isWeekDeltaMode('nonsense'), DEFAULT_DELTA_MODE === 'week');
});

// ---- strictly-before across a month boundary --------------------------------

// ---- the Sunday week math, now SHARED with model/delta-window.js -------------
test('weekStartDay maps every day of a Sun-Thu week to the SAME Sunday', () => {
  // This is the calendar primitive the activity window is built on: delta-window's
  // windowFor() calls it to decide where the week opens. It has ONE owner (this
  // module) precisely so the review banner, the deck legend and the history panel
  // cannot drift apart.
  const SUN = '2026-07-05';
  for (const d of [SUN, '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09']) {
    assert.equal(weekStartDay(d), isoToDays(SUN), `${d} opens at ${SUN}`);
  }
  // Friday and Saturday are the WEEKEND (Fri+Sat, 2026-08-05 rule), so they belong
  // to the week that just ended, not to the next one.
  assert.equal(weekStartDay('2026-07-10'), isoToDays(SUN), 'Friday folds back');
  assert.equal(weekStartDay('2026-07-11'), isoToDays(SUN), 'Saturday folds back');
  // …and the next Sunday opens a fresh week, so the fold-back is bounded.
  assert.equal(weekStartDay('2026-07-12'), isoToDays('2026-07-12'));
});

test('isoWeekday is Sunday-based, and the week math is timezone-independent', () => {
  assert.equal(isoWeekday('2026-07-05'), 0, 'Sunday is 0');
  assert.equal(isoWeekday('2026-07-09'), 4, 'Thursday is 4');
  assert.equal(isoWeekday('2026-07-10'), 5, 'Friday is 5');
  assert.equal(isoWeekday('2026-07-11'), 6, 'Saturday is 6');
  // A local-midnight Date() shifts the day for negative UTC offsets, which would
  // move the week boundary by one and put a Sunday report in the previous week.
  // The math runs on the UTC epoch; assert that under five zones spanning
  // UTC-11 .. UTC+14 (the app runs at +03 but must not depend on it).
  const original = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Asia/Riyadh', 'Pacific/Kiritimati', 'Pacific/Midway', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      assert.equal(weekStartDay('2026-07-26'), isoToDays('2026-07-26'), `TZ=${tz} Sunday maps to itself`);
      assert.equal(weekStartDay('2026-07-27'), isoToDays('2026-07-26'), `TZ=${tz} Monday`);
      assert.equal(isoWeekday('2026-07-26'), 0, `TZ=${tz} weekday`);
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});
