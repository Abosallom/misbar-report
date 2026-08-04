// test/delta-baseline.test.mjs — Worker H. Pure delta-baseline model. Run: node --test
// Covers recordSnapshot (add/update-in-place + 45-date trim) and pickDeltaBaseline
// (daily most-recent-before; the WEEK-TO-DATE mode 'week' — the DEFAULT since
// 2026-08-04 — including in-week accumulation, week rollover, the Fri/Sat tail of a
// just-ended week, the anchored:false degrade, the weekly/weekly-sun/weekly-thu
// aliases and timezone-independent week math; strictly-before enforcement,
// legacySnapshot fallback, and the null case).
//
// WHY 'week' REPLACED THE TWO WEEKDAY-ANCHORED MODES (user decision 2026-08-04,
// Talal): the green chips must accumulate THROUGH the Sun–Thu work week so the
// Thursday deck — the one that is actually sent — shows the whole week's movement.
// So every report in a week shares ONE baseline: the most recent stored report
// STRICTLY BEFORE that week's Sunday. The week's own Sunday report is deliberately
// NOT a candidate; using it would silently drop Sunday's own movement out of
// Thursday's numbers. 'weekly-sun' / 'weekly-thu' are now aliases of 'week'.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recordSnapshot, pickDeltaBaseline, normalizeDeltaMode, canonicalDeltaMode,
  isWeekDeltaMode, DELTA_MODES, DEFAULT_DELTA_MODE, HISTORY_LIMIT,
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

// ---- pickDeltaBaseline: week-to-date ----------------------------------------
// Real weekdays (verified against Date.UTC): 2026-07-26 and 2026-08-02 are SUNDAYS;
// 2026-07-23 and 2026-07-30 are THURSDAYS; 2026-07-25 and 2026-08-01 are SATURDAYS.
// weekStart(iso) = iso − isoWeekday(iso), so the whole Sun-26 → Sat-01 span shares the
// week that starts 2026-07-26 and therefore the same pre-Sunday baseline: 2026-07-25.
const WEEK_HISTORY = {
  '2026-07-19': { total: 19 }, // Sun, previous-previous week
  '2026-07-23': { total: 23 }, // Thu, previous week
  '2026-07-25': { total: 25 }, // Sat — the last report BEFORE Sunday 07-26 → THE baseline
  '2026-07-26': { total: 26 }, // Sun — the week's OWN opening report; never its baseline
  '2026-07-27': { total: 27 }, // Mon
  '2026-07-28': { total: 28 }, // Tue
  '2026-07-30': { total: 30 }, // Thu — the deck that is actually sent
  '2026-08-01': { total: 999 }, // Sat — belongs to the 07-26 week; baseline for 08-02
};

test('week: every report in one Sun–Thu week accumulates against the SAME pre-Sunday baseline', () => {
  // Sunday, Monday, Tuesday and the sent-on-Thursday deck all compare to 2026-07-25.
  for (const reportDate of ['2026-07-26', '2026-07-27', '2026-07-28', '2026-07-30']) {
    const out = pickDeltaBaseline({ history: WEEK_HISTORY, reportDate, mode: 'week' });
    assert.deepEqual(out, {
      numbers: { total: 25 }, baselineDate: '2026-07-25', mode: 'week', anchored: true,
    }, `report ${reportDate}`);
    // THE trap this whole design exists to avoid: the week's own Sunday report is not a
    // candidate. Anchoring on it would drop Sunday's movement out of Thursday's chips.
    assert.notEqual(out.baselineDate, '2026-07-26', `${reportDate} must not anchor its own Sunday`);
  }
});

test('week: the baseline rolls over on the next Sunday', () => {
  // 2026-08-02 is the NEXT Sunday: its week starts that day, so the baseline becomes the
  // last report before it (Sat 08-01) — the previous week's numbers stop accumulating.
  const out = pickDeltaBaseline({ history: WEEK_HISTORY, reportDate: '2026-08-02', mode: 'week' });
  assert.deepEqual(out, {
    numbers: { total: 999 }, baselineDate: '2026-08-01', mode: 'week', anchored: true,
  });
});

test('week: Friday and Saturday belong to the just-ended week (no special case)', () => {
  // weekStart uses the same formula for every weekday, so Fri 07-31 and Sat 08-01 land
  // on the 07-26 week and produce EXACTLY Thursday 07-30's answer — byte for byte.
  const thu = pickDeltaBaseline({ history: WEEK_HISTORY, reportDate: '2026-07-30', mode: 'week' });
  const fri = pickDeltaBaseline({ history: WEEK_HISTORY, reportDate: '2026-07-31', mode: 'week' });
  const sat = pickDeltaBaseline({ history: WEEK_HISTORY, reportDate: '2026-08-01', mode: 'week' });
  assert.deepEqual(fri, thu);
  assert.deepEqual(sat, thu);
  assert.equal(fri.baselineDate, '2026-07-25');
});

test('week degrades to the most recent prior report with anchored:false', () => {
  // History starts INSIDE the week (07-26 Sun, 07-27 Mon): there is no report before the
  // week's Sunday yet, so the chips still work off the most recent prior report and the
  // result says so — the deck/banner then use the daily wording instead of asserting a
  // week-to-date comparison the baseline cannot support.
  const history = { '2026-07-26': { total: 26 }, '2026-07-27': { total: 27 } };
  const out = pickDeltaBaseline({ history, reportDate: '2026-07-28', mode: 'week' });
  assert.deepEqual(out, {
    numbers: { total: 27 }, baselineDate: '2026-07-27', mode: 'week', anchored: false,
  });
});

test('week enforces strictly-before across a year boundary', () => {
  // 2025-12-28 is a Sunday and 2026-01-01 a Thursday, so the report's week starts
  // 2025-12-28 — the SAME day the only prior entry carries. The own-week Sunday is not a
  // week baseline and 2026-01-04 is a future Sunday, so neither anchors: the picker
  // degrades to the most recent report strictly before the report date and discloses it.
  const history = { '2025-12-28': { total: 1 }, '2026-01-04': { total: 2 } };
  const out = pickDeltaBaseline({ history, reportDate: '2026-01-01', mode: 'week' });
  assert.deepEqual(out, {
    numbers: { total: 1 }, baselineDate: '2025-12-28', mode: 'week', anchored: false,
  });
});

test('week math is timezone-independent (the Sunday boundary never moves)', () => {
  // A local-midnight Date() shifts the day for negative UTC offsets, which would push
  // the week boundary one day and make 07-26's baseline the Sunday itself in America/*.
  // Run the same pick under five zones spanning UTC−11 … UTC+14 and assert it is fixed.
  const original = process.env.TZ;
  const history = {
    '2026-07-23': { total: 23 }, // Thu
    '2026-07-25': { total: 25 }, // Sat — the pre-Sunday baseline in EVERY zone
    '2026-07-26': { total: 26 }, // Sun — the report's own week start
  };
  try {
    for (const tz of ['UTC', 'Asia/Riyadh', 'Pacific/Kiritimati', 'Pacific/Midway', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      const out = pickDeltaBaseline({ history, reportDate: '2026-07-26', mode: 'week' });
      assert.deepEqual(
        [out.baselineDate, out.anchored, out.mode],
        ['2026-07-25', true, 'week'],
        `TZ=${tz}`,
      );
      // Monday of the same week resolves identically — the boundary is the week, not the day.
      assert.equal(
        pickDeltaBaseline({ history, reportDate: '2026-07-27', mode: 'week' }).baselineDate,
        '2026-07-25',
        `TZ=${tz} (Mon)`,
      );
      // The daily mode still takes the most recent date, whatever the zone.
      assert.equal(pickDeltaBaseline({ history, reportDate: '2026-07-26', mode: 'daily' }).baselineDate, '2026-07-25');
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});

// ---- mode registry: aliases, enum, fallback ---------------------------------
test("the retired weekly modes are aliases of 'week' (stored settings keep working)", () => {
  const week = pickDeltaBaseline({ history: WEEK_HISTORY, reportDate: '2026-07-30', mode: 'week' });
  for (const alias of ['weekly', 'weekly-sun', 'weekly-thu']) {
    const out = pickDeltaBaseline({ history: WEEK_HISTORY, reportDate: '2026-07-30', mode: alias });
    assert.deepEqual(out, week, `${alias} → week`);
    assert.equal(out.mode, 'week', `${alias} is canonicalized in the output too`);
    assert.equal(normalizeDeltaMode(alias), 'week');
    assert.equal(canonicalDeltaMode(alias), 'week');
  }
});

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

test('week is the mode when none is given (the default reaches the picker)', () => {
  const out = pickDeltaBaseline({ history: WEEK_HISTORY, reportDate: '2026-07-30' });
  assert.equal(out.mode, 'week');
  assert.equal(out.baselineDate, '2026-07-25');
  assert.equal(out.anchored, true);
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
    mode: 'week',
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
  // Same in week mode: nothing strictly before the report date at all → null, not a
  // degraded anchored:false result (there is no baseline to degrade TO).
  assert.equal(
    pickDeltaBaseline({ history: { '2026-07-30': { total: 1 } }, reportDate: '2026-07-30', mode: 'week' }),
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
