// test/delta-definition-version.test.mjs — `node --test`
// The ONE-TIME honesty guard for the 2026-07-28 definition change ("a rejected
// result is a COMPLETED result"). settings.snapshotHistory holds numbers recorded
// under the OLD rule, so the first report after the change would show a completed
// delta inflated by ~the rejected count (~+15 live) that is a definition change,
// not progress. Stored history is NEVER rewritten (it is the published record);
// instead pickDeltaBaseline DISCLOSES it via definitionShift:true, exactly the way
// it already returns anchored:false for a week-to-date baseline with no report stored
// before the week's Sunday.
//
// Companion to test/delta-baseline.test.mjs, which stays green untouched: the flag
// is emitted only for a baseline that actually carries a `completed` number (one
// without it produces no completed delta, so there is nothing definitional to say).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pickDeltaBaseline, recordSnapshot,
  COMPLETED_DEF_VERSION, COMPLETED_DEF_SINCE,
} from '../src/model/delta-baseline.js';
import { SNAPSHOT_SEED } from '../src/seeds/defaults.js';

// A full-ish published number set (only `completed` matters to the flag).
const nums = (completed, extra = {}) => ({ total: 700, completed, rejected: 15, ...extra });

test('constants: v2 = "completed includes rejected", effective from the change date', () => {
  assert.equal(COMPLETED_DEF_VERSION, 2);
  assert.equal(COMPLETED_DEF_SINCE, '2026-07-28');
});

// ---- the real scenario ------------------------------------------------------
test('a pre-change baseline is flagged: the +15 completed jump is definitional', () => {
  // 2026-07-27 report: completed 666 under the old rule (rejected EXCLUDED).
  // Today's engine says 681 = 666 + 15 rejected. The chip would read '+15 مكتمل'.
  const history = { '2026-07-27': nums(666) };
  const out = pickDeltaBaseline({ history, reportDate: '2026-07-28', mode: 'daily' });
  assert.equal(out.baselineDate, '2026-07-27');
  assert.equal(out.definitionShift, true, 'must disclose that completed changed meaning');
  // The picker still returns the STORED numbers verbatim — nothing is re-stated.
  assert.deepEqual(out.numbers, nums(666));
  assert.equal(681 - out.numbers.completed, 15); // the inflated delta the flag explains
});

test('a baseline recorded on/after the change date is NOT flagged', () => {
  const history = { '2026-07-28': nums(681), '2026-07-27': nums(666) };
  const out = pickDeltaBaseline({ history, reportDate: '2026-07-29', mode: 'daily' });
  assert.equal(out.baselineDate, '2026-07-28');
  assert.equal(out.definitionShift, undefined, 'same-definition baseline: nothing to disclose');
  assert.equal('definitionShift' in out, false); // key absent, not false
});

test('the change date itself is inclusive (>= COMPLETED_DEF_SINCE is new)', () => {
  const before = pickDeltaBaseline({ history: { '2026-07-27': nums(666) }, reportDate: '2026-08-01', mode: 'daily' });
  const onDay = pickDeltaBaseline({ history: { '2026-07-28': nums(681) }, reportDate: '2026-08-01', mode: 'daily' });
  assert.equal(before.definitionShift, true);
  assert.equal(onDay.definitionShift, undefined);
});

// ---- explicit stamp wins over the date inference -----------------------------
test('an explicit numeric defVersion stamp overrides the date inference (both ways)', () => {
  // Old date, but stamped as current → not flagged (a back-dated regeneration).
  const stampedNew = pickDeltaBaseline({
    history: { '2026-07-20': nums(437, { defVersion: COMPLETED_DEF_VERSION }) },
    reportDate: '2026-07-29', mode: 'daily',
  });
  assert.equal(stampedNew.definitionShift, undefined);
  // New date, but explicitly stamped as v1 → flagged.
  const stampedOld = pickDeltaBaseline({
    history: { '2026-07-30': nums(666, { defVersion: 1 }) },
    reportDate: '2026-07-31', mode: 'daily',
  });
  assert.equal(stampedOld.definitionShift, true);
});

test('the stamp is a finite number, so it survives recordSnapshot (and store validation)', () => {
  const h = recordSnapshot({}, '2026-07-29', nums(681, { defVersion: COMPLETED_DEF_VERSION }));
  assert.equal(h['2026-07-29'].defVersion, COMPLETED_DEF_VERSION);
  for (const v of Object.values(h['2026-07-29'])) assert.equal(typeof v, 'number');
});

// ---- scope of the flag -------------------------------------------------------
test('no completed number → no flag (nothing definitional can be shown)', () => {
  // Why every pre-existing delta-baseline test keeps its exact output shape.
  const out = pickDeltaBaseline({ history: { '2026-07-22': { total: 22 } }, reportDate: '2026-07-23', mode: 'daily' });
  assert.deepEqual(out, { numbers: { total: 22 }, baselineDate: '2026-07-22', mode: 'daily' });
  // A non-finite completed is not a number set either.
  const bad = pickDeltaBaseline({ history: { '2026-07-22': { total: 22, completed: NaN } }, reportDate: '2026-07-23' });
  assert.equal(bad.definitionShift, undefined);
});

test("the flag rides alongside anchored on the week-to-date mode", () => {
  // 2026-07-29 is a Wednesday, so its week starts Sunday 2026-07-26 and the baseline is
  // the last report strictly before that Sunday — 07-23, which is pre-change.
  const history = {
    '2026-07-19': nums(640), // Sun, pre-change
    '2026-07-23': nums(650), // Thu, pre-change — the pre-Sunday baseline for the 07-26 week
  };
  const week = pickDeltaBaseline({ history, reportDate: '2026-07-29', mode: 'week' });
  assert.deepEqual(week, {
    numbers: nums(650), baselineDate: '2026-07-23', mode: 'week', anchored: true, definitionShift: true,
  });
  // anchored:false and definitionShift are INDEPENDENT disclosures — both can show at
  // once. Here history starts inside the week (07-27 Mon), so there is no pre-Sunday
  // report to anchor on AND the degraded baseline still speaks the old definition.
  const inWeekOnly = pickDeltaBaseline({ history: { '2026-07-27': nums(660) }, reportDate: '2026-07-29', mode: 'week' });
  assert.equal(inWeekOnly.baselineDate, '2026-07-27');
  assert.equal(inWeekOnly.anchored, false);
  assert.equal(inWeekOnly.definitionShift, true);
});

// ---- legacy snapshot fallback ------------------------------------------------
test('legacy fallback: a stored pre-change snapshot is flagged', () => {
  const out = pickDeltaBaseline({
    history: {},
    legacySnapshot: { asOf: '2026-07-20', numbers: nums(660) }, // user's own last run, old rule
    reportDate: '2026-07-29',
  });
  assert.equal(out.mode, 'legacy');
  assert.equal(out.definitionShift, true);
});

test('legacy fallback: the SHIPPED seed is already new-definition → NOT flagged', () => {
  // SNAPSHOT_SEED.asOf (2026-07-09) predates the change, but its completed was
  // re-baselined to the new rule, and defVersion (sibling of numbers) says so.
  assert.equal(SNAPSHOT_SEED.defVersion, COMPLETED_DEF_VERSION);
  assert.equal(SNAPSHOT_SEED.numbers.completed, 437); // 422 resulted + 15 rejected
  const out = pickDeltaBaseline({ history: {}, legacySnapshot: SNAPSHOT_SEED, reportDate: '2026-07-29' });
  assert.equal(out.mode, 'legacy');
  assert.equal(out.baselineDate, '2026-07-09');
  assert.equal(out.definitionShift, undefined, 'the shipped baseline must not raise a false alarm');
});

test('a legacy snapshot with an unknown date is treated as pre-change (disclose, never hide)', () => {
  const out = pickDeltaBaseline({ history: {}, legacySnapshot: { numbers: nums(600) }, reportDate: '2026-07-29' });
  assert.equal(out.baselineDate, null);
  assert.equal(out.definitionShift, true);
});

// ---- stored history is never rewritten ---------------------------------------
test('recordSnapshot does NOT rewrite or re-stamp pre-change entries', () => {
  const before = { '2026-07-27': nums(666) };
  const after = recordSnapshot(before, '2026-07-29', nums(681));
  assert.deepEqual(after['2026-07-27'], nums(666)); // untouched, byte for byte
  assert.deepEqual(before, { '2026-07-27': nums(666) }); // input not mutated
  // …and the newly written entry needs no stamp: its date carries the version.
  const out = pickDeltaBaseline({ history: after, reportDate: '2026-07-30', mode: 'daily' });
  assert.equal(out.baselineDate, '2026-07-29');
  assert.equal(out.definitionShift, undefined);
});
