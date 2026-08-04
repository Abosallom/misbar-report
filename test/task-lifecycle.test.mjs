// test/task-lifecycle.test.mjs — the stateful task-lifecycle rule. Run: node --test
//
// The rule (user decision 2026-08-04, supersedes the 2026-07-22 "internal shows the
// COMPLETE لين log" decision) is the same for BOTH task lists, within their category
// split (internal = لين, external/NUPCO = the rest):
//   1. status ≠ مغلق            → include (external additionally requires isScheduled)
//   2. status = مغلق            → include ONLY if the task was shown non-closed in an
//                                 earlier report and has not yet had its one "closed"
//                                 appearance (the grace row, rendered as مغلق)
//   3. after that one appearance → excluded forever
//   4. tasks already مغلق before this feature shipped have no recorded open
//      appearance → never shown (an empty taskLog IS the pre-ship exclusion)
//
// Every case here is PURE SYNTHETIC data (no sample workbook), so this suite never
// skips — the lifecycle is the one part of the split that must hold on any install.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { taskKey, isGraceRow, recordShownTasks } from '../src/model/task-lifecycle.js';
import { autoDraft, splitTaskLists } from '../src/model/drafts.js';

// ---- helpers ----------------------------------------------------------------

/** A tracker row. Defaults: external (نوبكو), open, scheduled by a concrete date. */
const mk = (over = {}) => ({
  num: null,
  task: 'مهمة',
  responsible: 'لين',
  owner: 'مالك',
  dueDate: '01-07-2026',
  status: 'مفتوح',
  category: 'نوبكو',
  hidden: false,
  ...over,
});

const INT = (over = {}) => mk({ category: 'لين', ...over });

const D1 = '2026-07-01';
const D2 = '2026-07-02';
const D3 = '2026-07-03';
const D4 = '2026-07-04';
const D5 = '2026-07-05';

const split = (tasks, taskLog, reportDate) => splitTaskLists(tasks, { taskLog, reportDate });
const record = (log, reportDate, s) => recordShownTasks(log, {
  reportDate,
  tasksCurrent: s.tasksCurrent,
  tasksInternal: s.tasksInternal,
});

/** reportDate shifted by n days (n<0 = earlier), as 'YYYY-MM-DD'. */
const shift = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// ---- 1. key ------------------------------------------------------------------

test('taskKey — list prefix + whitespace normalization + 160-char truncation', () => {
  // Whitespace collapses so a re-typed row (or an Excel line break) keeps its identity.
  assert.equal(taskKey('int', mk({ task: '  رفع   قائمة\n الفحوصات  ' })), 'int|رفع قائمة الفحوصات');
  assert.equal(taskKey('ext', mk({ task: 'رفع قائمة الفحوصات' })), 'ext|رفع قائمة الفحوصات');
  // The list id comes from WHICH ARRAY the row is in, never row.category: the review
  // screen's newTask() creates rows with category:'' and they must still key stably.
  assert.equal(
    taskKey('int', mk({ task: 'X', category: '' })),
    taskKey('int', mk({ task: 'X', category: 'نوبكو' })),
  );
  // Same text in the two lists = two independent lifecycles.
  assert.notEqual(taskKey('int', mk({ task: 'X' })), taskKey('ext', mk({ task: 'X' })));
  // Long descriptions truncate to 160 chars (keeps localStorage bounded).
  const k = taskKey('int', mk({ task: 'ا'.repeat(400) }));
  assert.equal(k, `int|${'ا'.repeat(160)}`);
  assert.equal(k.length, 164);
});

// ---- 2. the three-report life ------------------------------------------------

test('open → closed (shown once) → gone, over three consecutive reports', () => {
  const openRow = mk({ task: 'T', status: 'مفتوح' });
  const closedRow = { ...openRow, status: 'مغلق' };
  let log = {};

  // D1: open — normal inclusion, and the open appearance is recorded.
  let s = split([openRow], log, D1);
  assert.equal(s.tasksCurrent.length, 1, 'D1 shows the open row');
  log = record(log, D1, s);
  const key = taskKey('ext', openRow);
  assert.equal(log[key].openOn, D1);
  assert.equal(log[key].closedOn, null);

  // D2: closed — the grace row, rendered with the green مغلق status.
  s = split([closedRow], log, D2);
  assert.equal(s.tasksCurrent.length, 1, 'D2 shows the closed row once');
  assert.equal(s.tasksCurrent[0].status, 'مغلق', 'the closed status is shown verbatim');
  assert.ok(isGraceRow(log, 'ext', closedRow, D2), 'isGraceRow agrees on D2');
  log = record(log, D2, s);
  assert.equal(log[key] && log[key].closedOn, D2, 'the grace is marked consumed on D2');

  // D3: gone — consumed grace is never shown again, and recording D3 prunes the entry.
  s = split([closedRow], log, D3);
  assert.equal(s.tasksCurrent.length, 0, 'D3 drops the closed row');
  assert.equal(isGraceRow(log, 'ext', closedRow, D3), false);
  log = record(log, D3, s);
  assert.equal(log[key], undefined, 'the consumed entry is pruned by the next report');

  // Internal (لين) follows the identical rule.
  const iOpen = INT({ task: 'L', status: 'مفتوح' });
  const iClosed = { ...iOpen, status: 'مغلق' };
  let ilog = {};
  let is = split([iOpen], ilog, D1);
  assert.equal(is.tasksInternal.length, 1);
  ilog = record(ilog, D1, is);
  is = split([iClosed], ilog, D2);
  assert.equal(is.tasksInternal.length, 1, 'internal grace row shows once');
  ilog = record(ilog, D2, is);
  is = split([iClosed], ilog, D3);
  assert.equal(is.tasksInternal.length, 0, 'internal grace row then disappears');
});

// ---- 3. same-day idempotency -------------------------------------------------

test('same-day regeneration is idempotent — write twice, identical log, row still shown', () => {
  const row = mk({ task: 'T' });
  const closed = { ...row, status: 'مغلق' };
  let log = record({}, D1, split([row], {}, D1));

  const s = split([closed], log, D2);
  assert.equal(s.tasksCurrent.length, 1);
  const once = record(log, D2, s);
  const twice = record(once, D2, split([closed], once, D2));
  assert.deepEqual(twice, once, 'f(f(log)) === f(log) on the same report date');

  // Re-running today's report after the write still produces the same rows: the
  // grace is consumed ON D2, so closedOn === reportDate still counts as grace.
  const again = split([closed], once, D2);
  assert.equal(again.tasksCurrent.length, 1, 'regenerating the same report keeps the row');
  assert.deepEqual(again.tasksCurrent.map((t) => t.task), s.tasksCurrent.map((t) => t.task));

  // A BACKDATED regeneration cannot resurrect a grace consumed later.
  assert.equal(isGraceRow(once, 'ext', closed, D1), false, 'closedOn > reportDate is not grace');
});

// ---- 4. pre-ship exclusion ---------------------------------------------------

test('pre-ship closed tasks are never shown — empty/null/undefined logs, and no entry is created', () => {
  const closed = mk({ task: 'قديمة', status: 'مغلق' });
  const closedInt = INT({ task: 'قديمة داخلية', status: 'مغلق' });
  for (const bag of [{}, null, undefined]) {
    const s = splitTaskLists([closed, closedInt], { taskLog: bag, reportDate: D1 });
    assert.equal(s.tasksCurrent.length, 0, `no external closed row with taskLog=${String(bag)}`);
    assert.equal(s.tasksInternal.length, 0, `no internal closed row with taskLog=${String(bag)}`);
  }
  // Degradation path used by the hand-written fallbacks: no bag at all.
  const bare = splitTaskLists([closed, closedInt], {});
  assert.equal(bare.tasksCurrent.length, 0);
  assert.equal(bare.tasksInternal.length, 0);

  // Recording a report that contains a closed row NOT in the log creates nothing —
  // otherwise the next report would flood with months of old closed work.
  const log = recordShownTasks({}, {
    reportDate: D1, tasksCurrent: [closed], tasksInternal: [closedInt],
  });
  assert.deepEqual(log, {}, 'an unknown closed row earns no entry');
});

// ---- 5. reopen resets the cycle ---------------------------------------------

test('a reopened task earns a fresh grace — before and after the entry was pruned', () => {
  const row = mk({ task: 'T' });
  const closed = { ...row, status: 'مغلق' };
  const key = taskKey('ext', row);

  // D1 open, D2 closed+shown → entry consumed and pruned on D3.
  let log = record({}, D1, split([row], {}, D1));
  log = record(log, D2, split([closed], log, D2));
  log = record(log, D3, split([closed], log, D3));
  assert.equal(log[key], undefined, 'pruned after the grace was consumed');

  // D4: the same task is reopened (status مستمر) — it is shown again and the cycle restarts.
  const reopened = { ...row, status: 'مستمر' };
  let s = split([reopened], log, D4);
  assert.equal(s.tasksCurrent.length, 1, 'a reopened task is shown again');
  log = record(log, D4, s);
  assert.equal(log[key].openOn, D4);
  assert.equal(log[key].closedOn, null, 'reopening RESETS closedOn');

  // D5: re-closed → a brand-new grace row.
  s = split([closed], log, D5);
  assert.equal(s.tasksCurrent.length, 1, 'the re-closed task earns a fresh grace');

  // Reopen within the SAME report as an unconsumed grace also resets the entry.
  const mid = recordShownTasks({ [key]: { openOn: D1, closedOn: D2 } }, {
    reportDate: D3, tasksCurrent: [reopened], tasksInternal: [],
  });
  assert.deepEqual(mid[key], { openOn: D3, closedOn: null });
});

// ---- 6. isScheduled interplay ------------------------------------------------

test('isScheduled — applies to non-closed external rows only; grace rows bypass it', () => {
  // 1) external, non-closed, scheduled (concrete date) → in.
  const extSched = mk({ task: 'A', status: 'مفتوح', dueDate: '10-07-2026' });
  // 2) external, non-closed, UNscheduled ('يومي' placeholder + مفتوح) → out.
  const extUnsched = mk({ task: 'B', status: 'مفتوح', dueDate: 'يومي' });
  // 3) external, CLOSED + unscheduled + grace → IN (the real tracker has exactly this
  //    shape: a مغلق نوبكو row whose due is 'يومان بعد تسليم قائمة الفحوصات'. If the
  //    isScheduled filter applied to grace rows the grace could never be consumed and
  //    the task would pop up months later.)
  const extGrace = mk({ task: 'C', status: 'مغلق', dueDate: 'يومان بعد تسليم قائمة الفحوصات' });
  // 4) external, CLOSED + scheduled but with NO log entry → out.
  const extClosedNoGrace = mk({ task: 'D', status: 'مغلق', dueDate: '10-07-2026' });

  const log = { [taskKey('ext', extGrace)]: { openOn: D1, closedOn: null } };
  const s = split([extSched, extUnsched, extGrace, extClosedNoGrace], log, D2);
  assert.deepEqual(s.tasksCurrent.map((t) => t.task), ['A', 'C']);

  // Internal never applies isScheduled: an unscheduled non-closed لين row still shows.
  const intUnsched = INT({ task: 'L1', status: 'مفتوح', dueDate: 'غير محدد' });
  const intBlank = INT({ task: 'L2', status: '', dueDate: '' });
  const si = split([intUnsched, intBlank], {}, D2);
  assert.deepEqual(si.tasksInternal.map((t) => t.task), ['L1', 'L2']);
});

// ---- 7. duplicate twins ------------------------------------------------------

test('duplicate texts — an open twin suppresses the closed twin, in either order', () => {
  const open = mk({ task: 'TWIN', status: 'مستمر' });
  const closed = mk({ task: 'TWIN', status: 'مغلق' });
  const log = { [taskKey('ext', open)]: { openOn: D1, closedOn: null } };

  for (const rows of [[open, closed], [closed, open]]) {
    const s = split(rows, log, D2);
    assert.equal(s.tasksCurrent.length, 1, 'never "X قيد التنفيذ" and "X مغلق" side by side');
    assert.equal(s.tasksCurrent[0].status, 'مستمر', 'the live row wins');
  }
  // …and recording keeps the entry OPEN (the open pass wins), so the grace survives
  // for whenever the task really closes.
  const after = record(log, D2, split([open, closed], log, D2));
  assert.equal(after[taskKey('ext', open)].closedOn, null);

  // Two CLOSED twins share one entry: both render in that one report, then both go.
  const c2 = { ...closed, owner: 'آخر' };
  let log2 = { [taskKey('ext', closed)]: { openOn: D1, closedOn: null } };
  const s2 = split([closed, c2], log2, D2);
  assert.equal(s2.tasksCurrent.length, 2, 'identical closed rows both take the one grace');
  log2 = record(log2, D2, s2);
  assert.equal(split([closed, c2], log2, D3).tasksCurrent.length, 0, 'and both disappear next report');
});

// ---- 8. prune ----------------------------------------------------------------

test('prune — consumed graces, stale open entries, and the 300-entry cap', () => {
  const live = mk({ task: 'LIVE' });
  const liveKey = taskKey('ext', live);

  // Consumed grace (closedOn strictly before the report date) is dropped.
  const consumed = { openOn: shift(D3, -10), closedOn: shift(D3, -1) };
  // A grace consumed TODAY stays (same-day regeneration must keep showing it).
  const today = { openOn: shift(D3, -10), closedOn: D3 };
  // Stale open entry (> 120 days) is dropped; a 100-day-old one survives.
  const stale = { openOn: shift(D3, -200), closedOn: null };
  const oldish = { openOn: shift(D3, -100), closedOn: null };

  const pruned = recordShownTasks({
    'ext|consumed': consumed, 'ext|today': today, 'ext|stale': stale, 'ext|oldish': oldish,
  }, { reportDate: D3, tasksCurrent: [live], tasksInternal: [] });

  assert.equal(pruned['ext|consumed'], undefined, 'consumed grace dropped');
  assert.deepEqual(pruned['ext|today'], today, 'a grace consumed today is kept');
  assert.equal(pruned['ext|stale'], undefined, 'stale open entry dropped');
  assert.deepEqual(pruned['ext|oldish'], oldish, 'a 100-day-old open entry survives');
  assert.deepEqual(pruned[liveKey], { openOn: D3, closedOn: null }, 'this run was recorded');

  // Hard cap 300, keeping the most-recently-touched entries. 400 valid, non-stale
  // entries + this run's row → at most 300 survive, the freshest ones.
  const big = {};
  for (let i = 0; i < 400; i += 1) big[`ext|old${i}`] = { openOn: shift(D3, -(i % 100) - 1), closedOn: null };
  const capped = recordShownTasks(big, { reportDate: D3, tasksCurrent: [live], tasksInternal: [] });
  const keys = Object.keys(capped);
  assert.ok(keys.length <= 300, `cap holds (got ${keys.length})`);
  assert.ok(keys.length > 250, `the cap does not over-prune (got ${keys.length})`);
  assert.ok(capped[liveKey], "this report's own row is never the one dropped");
  assert.equal(capped['ext|old99'], undefined, 'the oldest entries are the ones dropped');
  assert.ok(capped['ext|old0'], 'the freshest entries are kept');
});

// ---- 9. malformed tolerance --------------------------------------------------

test('malformed input is tolerated — no throw, junk dropped, a bad reportDate writes nothing', () => {
  const row = mk({ task: 'T' });

  // A null/undefined/garbage log never throws.
  for (const bag of [null, undefined, 'nope', 42, []]) {
    const out = recordShownTasks(bag, { reportDate: D1, tasksCurrent: [row], tasksInternal: [] });
    assert.ok(out && typeof out === 'object' && !Array.isArray(out), `log bag ${String(bag)} tolerated`);
    assert.deepEqual(out[taskKey('ext', row)], { openOn: D1, closedOn: null });
  }
  // Garbage arguments entirely.
  assert.doesNotThrow(() => recordShownTasks({}, {}));
  assert.doesNotThrow(() => recordShownTasks({}, null));
  assert.doesNotThrow(() => recordShownTasks());

  // Junk entries are dropped rather than persisted forever.
  const junk = {
    'ext|a': 'string', 'ext|b': { closedOn: D1 }, 'ext|c': { openOn: 'not-a-date' },
    'ext|d': null, 'ext|e': [], 'ext|f': { openOn: 42, closedOn: null },
  };
  const cleaned = recordShownTasks(junk, { reportDate: D1, tasksCurrent: [row], tasksInternal: [] });
  for (const k of Object.keys(junk)) assert.equal(cleaned[k], undefined, `junk entry ${k} dropped`);
  assert.ok(cleaned[taskKey('ext', row)], 'the valid write still happened');

  // A non-ISO report date writes NOTHING (a bad date must not stamp the log).
  const base = { 'ext|keep': { openOn: D1, closedOn: null } };
  for (const bad of ['nope', '2026-7-1', '', null, undefined, 20260701]) {
    const out = recordShownTasks(base, { reportDate: bad, tasksCurrent: [row], tasksInternal: [] });
    assert.deepEqual(out, base, `reportDate ${String(bad)} writes nothing`);
  }

  // Junk ROWS never throw and never create entries.
  const messy = recordShownTasks({}, {
    reportDate: D1,
    tasksCurrent: [null, undefined, {}, { task: '   ' }, 'string', 7],
    tasksInternal: null,
  });
  assert.deepEqual(messy, {}, 'no entry from rows without a description');

  // isGraceRow is total too.
  assert.equal(isGraceRow(null, 'ext', row, D1), false);
  assert.equal(isGraceRow({ 'ext|T': 'junk' }, 'ext', row, D1), false);
  assert.equal(isGraceRow({}, 'ext', null, D1), false);
  assert.doesNotThrow(() => isGraceRow());

  // The split tolerates a junk task array / junk bag.
  assert.doesNotThrow(() => splitTaskLists(null, { taskLog: null, reportDate: D1 }));
  assert.doesNotThrow(() => splitTaskLists([null, undefined, {}], { taskLog: 'x', reportDate: 'x' }));
});

// ---- 10. order ---------------------------------------------------------------

test('tracker order is preserved — grace rows keep their original position', () => {
  const rows = [
    mk({ task: 'A', status: 'مستمر' }),
    mk({ task: 'B', status: 'مغلق' }),          // grace row, in the middle
    mk({ task: 'C', status: 'مفتوح', dueDate: '10-07-2026' }),
    INT({ task: 'L1', status: 'مفتوح' }),
    INT({ task: 'L2', status: 'مغلق' }),        // internal grace row
    INT({ task: 'L3', status: 'مستمر' }),
  ];
  const log = {
    [taskKey('ext', rows[1])]: { openOn: D1, closedOn: null },
    [taskKey('int', rows[4])]: { openOn: D1, closedOn: null },
  };
  const s = split(rows, log, D2);
  assert.deepEqual(s.tasksCurrent.map((t) => t.task), ['A', 'B', 'C'], 'no append-at-the-end');
  assert.deepEqual(s.tasksInternal.map((t) => t.task), ['L1', 'L2', 'L3']);
});

// ---- 11. field survival ------------------------------------------------------

test('hidden is ignored by the rule and every field survives the spread', () => {
  const hiddenGrace = mk({
    task: 'H', status: 'مغلق', hidden: true, num: 7, owner: 'مالك', responsible: 'لين',
    dueDate: 'يومان بعد التسليم', category: 'نوبكو',
  });
  const log = { [taskKey('ext', hiddenGrace)]: { openOn: D1, closedOn: null } };
  const s = split([hiddenGrace], log, D2);
  assert.equal(s.tasksCurrent.length, 1, 'a hidden row is not filtered by the lifecycle rule');
  const out = s.tasksCurrent[0];
  assert.equal(out.hidden, true);
  assert.equal(out.num, 7);
  assert.equal(out.owner, 'مالك');
  assert.equal(out.responsible, 'لين');
  assert.equal(out.dueDate, 'يومان بعد التسليم');
  assert.equal(out.category, 'نوبكو');
  assert.equal(out.status, 'مغلق', 'مغلق is kept verbatim (only مفتوح is remapped)');

  // The display mapping still runs through autoDraft, with the log threaded in.
  const tracker = {
    tasks: [
      mk({ task: 'A', status: 'مفتوح', dueDate: '10-07-2026' }),
      INT({ task: 'L', status: 'مفتوح' }),
      INT({ task: 'G', status: 'مغلق', hidden: true }),
    ],
    challenges: [],
    risks: [],
  };
  const graceLog = { [taskKey('int', tracker.tasks[2])]: { openOn: D1, closedOn: null } };
  const d = autoDraft(tracker, D2, { taskLog: graceLog });
  assert.deepEqual(d.tasksCurrent.map((t) => t.status), ['قيد التنفيذ'], 'مفتوح → قيد التنفيذ');
  assert.deepEqual(d.tasksInternal.map((t) => t.task), ['L', 'G']);
  assert.deepEqual(d.tasksInternal.map((t) => t.status), ['قيد التنفيذ', 'مغلق']);
  assert.equal(d.tasksInternal[1].hidden, true, 'hidden survives the spread');

  // The 2-argument call stays valid (existing callers) and degrades to non-closed only.
  const legacy = autoDraft(tracker, D2);
  assert.deepEqual(legacy.tasksInternal.map((t) => t.task), ['L'], 'no bag → no grace rows');
});
