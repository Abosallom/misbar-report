// test/delta-definition-version.test.mjs — what survives of the "completed changed
// meaning" disclosure. Run: node --test test/delta-definition-version.test.mjs
//
// RETIRED 2026-08-05 (Talal's rule 1+2 round). Every CHIP case in this file is gone
// with pickDeltaBaseline: the `definitionShift` flag existed because the green chips
// diffed today's numbers against a STORED report, and a report published before
// 2026-07-28 spoke an older `completed` (rejected excluded), so a +15 jump had to be
// disclosed as definitional rather than real. The chips no longer read stored numbers
// at all — they are the WEEK'S ACTIVITY, recomputed from the rows' own date columns by
// src/model/delta-window.js under ONE definition, every time. A cross-definition
// comparison is therefore impossible by construction, and a flag warning about one is
// a warning about a deleted product.
//
// WHAT REMAINS, and why it is still load-bearing: COMPLETED_DEF_VERSION and
// COMPLETED_DEF_SINCE are still consumed by the HISTORY PANEL, which does still show
// stored numbers side by side with computed ones and still has to label a pre-change
// row honestly. The seed stamp still has to be a finite number so it survives
// recordSnapshot and store validation, and recordSnapshot still must never rewrite a
// stored entry into today's definition.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recordSnapshot, COMPLETED_DEF_VERSION, COMPLETED_DEF_SINCE,
} from '../src/model/delta-baseline.js';
import { SNAPSHOT_SEED } from '../src/seeds/defaults.js';

// A full-ish published number set (only `completed` matters to the version stamp).
const nums = (completed, extra = {}) => ({ total: 700, completed, rejected: 15, ...extra });

test('constants: v2 = "completed includes rejected", effective from the change date', () => {
  assert.equal(COMPLETED_DEF_VERSION, 2);
  assert.equal(COMPLETED_DEF_SINCE, '2026-07-28');
});

test('the stamp is a finite number, so it survives recordSnapshot (and store validation)', () => {
  const h = recordSnapshot({}, '2026-07-29', nums(681, { defVersion: COMPLETED_DEF_VERSION }));
  assert.equal(h['2026-07-29'].defVersion, COMPLETED_DEF_VERSION);
  for (const v of Object.values(h['2026-07-29'])) assert.equal(typeof v, 'number');
});

test('recordSnapshot does NOT rewrite or re-stamp pre-change entries', () => {
  // Stored history is an archive of what was PUBLISHED. Silently restating an old
  // row into today's definition would make the history panel lie about the past.
  const before = { '2026-07-27': nums(666) };
  const after = recordSnapshot(before, '2026-07-29', nums(681));
  assert.deepEqual(after['2026-07-27'], nums(666)); // untouched, byte for byte
  assert.deepEqual(before, { '2026-07-27': nums(666) }); // input not mutated
  assert.deepEqual(after['2026-07-29'], nums(681)); // and the new entry is written as given
});

test('the SHIPPED seed already speaks the new definition, and says so', () => {
  // SNAPSHOT_SEED.asOf (2026-07-09) predates the 07-28 change, so a date-based reader
  // would treat it as pre-change. The explicit defVersion sibling is what stops that.
  // (It is a SIBLING of `numbers`, never a key inside it — an eleventh key inside
  // `numbers` would leak into every snapshot round-trip. See defaults.js.)
  assert.equal(SNAPSHOT_SEED.defVersion, COMPLETED_DEF_VERSION);
  assert.equal(SNAPSHOT_SEED.numbers.completed, 437); // 422 resulted + 15 rejected
  assert.ok(SNAPSHOT_SEED.asOf < COMPLETED_DEF_SINCE, 'the seed does predate the change date');
});
