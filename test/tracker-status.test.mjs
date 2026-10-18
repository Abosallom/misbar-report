// test/tracker-status.test.mjs — the tracker status rules (Aziz, 2026-10-18). Run: node --test
//
// Pure synthetic data only (no workbook, no staff names, no task texts): the rules must
// hold on any install, so this suite never skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUS_KEYS, STATUS_AR, PRIORITY_AR,
  baseStatus, priorityKey, dueISO, effectiveStatus, sortStageTasks, trackerSummary, dailyTasks, openTasks,
  taskLogKey, recordStatusLog, completedDuring, normalizeStatusLog,
  STATUS_LOG_ENTRY_LIMIT, STATUS_LOG_TASK_LIMIT,
} from '../src/model/tracker-status.js';

const RD = '2026-10-18'; // report date (a Sunday)
const T = (o) => ({ id: o.id || o.wbs || 'x', wbs: '', status: '', priority: '', due: '', ...o });
const ids = (list) => list.map((t) => t.id);

// ---- constants ---------------------------------------------------------------------------

test('constants: status keys in display order, Arabic labels', () => {
  assert.deepEqual(STATUS_KEYS, ['late', 'stopped', 'inProgress', 'notStarted', 'completed']);
  assert.deepEqual(STATUS_AR, { late: 'متأخر', stopped: 'متوقف', inProgress: 'قيد التنفيذ', notStarted: 'لم يبدأ', completed: 'مكتمل' });
  assert.deepEqual(PRIORITY_AR, { critical: 'حرجة', high: 'عالية', medium: 'متوسطة', low: 'منخفضة' });
});

// ---- baseStatus --------------------------------------------------------------------------

test('baseStatus: every English spelling the workbook and the website use', () => {
  const cases = {
    Completed: 'completed', completed: 'completed', COMPLETE: 'completed', Done: 'completed', Closed: 'completed',
    Blocked: 'stopped', Stopped: 'stopped', 'On Hold': 'stopped', on_hold: 'stopped', 'on-hold': 'stopped', OnHold: 'stopped',
    Deleyed: 'late', Delayed: 'late', Late: 'late', Overdue: 'late',
    'In Progress': 'inProgress', 'in  progress': 'inProgress', in_progress: 'inProgress', InProgress: 'inProgress', Ongoing: 'inProgress',
    'Not Started': 'notStarted', 'not started': 'notStarted', NotStarted: 'notStarted', 'Not Found': 'notStarted', 'NOT FOUND': 'notStarted',
  };
  for (const [raw, key] of Object.entries(cases)) assert.equal(baseStatus(raw), key, raw);
});

test('baseStatus: Arabic values, with and without diacritics / hamza / tatweel', () => {
  const cases = {
    'مكتمل': 'completed', 'مكتملة': 'completed', 'مغلق': 'completed',
    'متوقف': 'stopped', 'متوقفة': 'stopped', 'معلّق': 'stopped', 'معلق': 'stopped',
    'متأخر': 'late', 'متاخر': 'late', 'متأخرة': 'late', 'متـأخر': 'late',
    'قيد التنفيذ': 'inProgress', ' قيد  التنفيذ ': 'inProgress',
    'لم يبدأ': 'notStarted', 'لم يبدا': 'notStarted', 'لم تبدأ': 'notStarted', 'غير محدد': 'notStarted',
  };
  for (const [raw, key] of Object.entries(cases)) assert.equal(baseStatus(raw), key, raw);
});

test('baseStatus: blank / nullish → notStarted; unmappable text → other', () => {
  for (const v of ['', '   ', null, undefined, ' ']) assert.equal(baseStatus(v), 'notStarted', JSON.stringify(v));
  for (const v of ['Cancelled', 'Pending review', 'xyz', '42']) assert.equal(baseStatus(v), 'other', v);
});

// ---- priorityKey -------------------------------------------------------------------------

test('priorityKey: English + Arabic, case-insensitive; unknown/blank → null', () => {
  const cases = {
    Critical: 'critical', CRITICAL: 'critical', 'حرجة': 'critical',
    High: 'high', high: 'high', 'عالية': 'high',
    Medium: 'medium', ' medium ': 'medium', 'متوسطة': 'medium',
    Low: 'low', 'منخفضة': 'low',
  };
  for (const [raw, key] of Object.entries(cases)) assert.equal(priorityKey(raw), key, raw);
  for (const v of ['', null, undefined, 'P1', 'whatever']) assert.equal(priorityKey(v), null, String(v));
});

// ---- dueISO ------------------------------------------------------------------------------

test('dueISO: real dates (ISO, ISO+time, day-first d/m/yyyy . -) → ISO day', () => {
  assert.equal(dueISO('2026-10-25'), '2026-10-25');
  assert.equal(dueISO('2026-9-6'), '2026-09-06');
  assert.equal(dueISO('2026-10-25T00:00:00Z'), '2026-10-25');
  assert.equal(dueISO('25/10/2026'), '2026-10-25');
  assert.equal(dueISO('6/9/2026'), '2026-09-06'); // day first
  assert.equal(dueISO('17.9.2026'), '2026-09-17');
  assert.equal(dueISO('17-9-2026'), '2026-09-17');
  assert.equal(dueISO(' 2026-10-25 '), '2026-10-25');
});

test('dueISO: undated values and impossible dates → null', () => {
  for (const v of ['', '   ', null, undefined, '–', '-', 'daily', 'Daily', 'TBD', 'tbd', 'ASAP',
    '2026-02-30', '31/9/2026', '2026-13-01', '13/13/2026', '2026/10/25x']) {
    assert.equal(dueISO(v), null, String(v));
  }
});

// ---- effectiveStatus (rule 1) ------------------------------------------------------------

test('effectiveStatus: overdue boundary is due < reportDate (strict)', () => {
  const before = effectiveStatus(T({ status: 'In Progress', due: '2026-10-17' }), RD);
  assert.deepEqual(before, { key: 'late', label: 'متأخر', pastDue: true, red: true });
  const same = effectiveStatus(T({ status: 'In Progress', due: '2026-10-18' }), RD);
  assert.deepEqual(same, { key: 'inProgress', label: 'قيد التنفيذ', pastDue: false, red: false });
  const after = effectiveStatus(T({ status: 'In Progress', due: '2026-10-19' }), RD);
  assert.equal(after.key, 'inProgress');
  assert.equal(after.pastDue, false);
});

test('effectiveStatus: overdue non-completed → Late — blank, Not Found, not started, unknown text included', () => {
  for (const status of ['', 'Not Found', 'Not Started', 'لم يبدأ', 'In Progress', 'Deleyed', 'Cancelled', 'غير محدد']) {
    const e = effectiveStatus(T({ status, due: '2026-09-01' }), RD);
    assert.deepEqual(e, { key: 'late', label: 'متأخر', pastDue: true, red: true }, status);
  }
});

test('effectiveStatus: Stopped stays Stopped when overdue, but is past due and red', () => {
  for (const status of ['Blocked', 'Stopped', 'On Hold', 'متوقف']) {
    assert.deepEqual(effectiveStatus(T({ status, due: '2026-09-01' }), RD),
      { key: 'stopped', label: 'متوقف', pastDue: true, red: true }, status);
    assert.deepEqual(effectiveStatus(T({ status, due: '2026-11-01' }), RD),
      { key: 'stopped', label: 'متوقف', pastDue: false, red: false }, status);
  }
});

test('effectiveStatus: Completed is never late, past due or red', () => {
  for (const status of ['Completed', 'Done', 'مكتمل']) {
    assert.deepEqual(effectiveStatus(T({ status, due: '2020-01-01' }), RD),
      { key: 'completed', label: 'مكتمل', pastDue: false, red: false });
  }
});

test('effectiveStatus: undated tasks are never overdue; status kept', () => {
  for (const due of ['', '–', 'daily', 'TBD']) {
    assert.deepEqual(effectiveStatus(T({ status: '', due }), RD), { key: 'notStarted', label: 'لم يبدأ', pastDue: false, red: false });
    assert.equal(effectiveStatus(T({ status: 'In Progress', due }), RD).key, 'inProgress');
  }
});

test('effectiveStatus: Late status without a date stays Late, not red (nothing to colour)', () => {
  assert.deepEqual(effectiveStatus(T({ status: 'Deleyed', due: 'TBD' }), RD), { key: 'late', label: 'متأخر', pastDue: false, red: false });
  assert.deepEqual(effectiveStatus(T({ status: 'Delayed', due: '2026-12-01' }), RD), { key: 'late', label: 'متأخر', pastDue: false, red: false });
});

test('effectiveStatus: unmappable, not overdue → other with the raw label verbatim', () => {
  assert.deepEqual(effectiveStatus(T({ status: '  Cancelled ', due: '2026-12-01' }), RD),
    { key: 'other', label: 'Cancelled', pastDue: false, red: false });
});

test('effectiveStatus: day-first text due dates count; invalid reportDate disables the rule; garbage-safe', () => {
  assert.equal(effectiveStatus(T({ status: 'In Progress', due: '17/9/2026' }), RD).key, 'late');
  assert.equal(effectiveStatus(T({ status: 'In Progress', due: '2026-09-01' }), '').key, 'inProgress');
  assert.equal(effectiveStatus(T({ status: 'In Progress', due: '2026-09-01' }), '18/10/2026').pastDue, false);
  assert.deepEqual(effectiveStatus(null, RD), { key: 'notStarted', label: 'لم يبدأ', pastDue: false, red: false });
  assert.deepEqual(effectiveStatus(undefined, undefined), { key: 'notStarted', label: 'لم يبدأ', pastDue: false, red: false });
});

// ---- sortStageTasks (rule 2) -------------------------------------------------------------

test('sortStageTasks: group order late, stopped, inProgress, notStarted, other, completed', () => {
  const tasks = [
    T({ id: 'c', status: 'Completed', due: '2026-09-01' }),
    T({ id: 'o', status: 'Cancelled', due: '2026-12-01' }),
    T({ id: 'n', status: 'Not Started', due: '2026-12-01' }),
    T({ id: 'i', status: 'In Progress', due: '2026-12-01' }),
    T({ id: 's', status: 'Blocked', due: '2026-12-01' }),
    T({ id: 'l', status: 'Deleyed', due: '2026-12-01' }),
  ];
  assert.deepEqual(ids(sortStageTasks(tasks, RD)), ['l', 's', 'i', 'n', 'o', 'c']);
});

test('sortStageTasks: an overdue task joins Late, an overdue Stopped stays in Stopped', () => {
  const tasks = [
    T({ id: 'ip-future', status: 'In Progress', due: '2026-12-01' }),
    T({ id: 'blk-over', status: 'Blocked', due: '2026-09-01' }),
    T({ id: 'blank-over', status: '', due: '2026-09-05' }),
    T({ id: 'ip-over', status: 'In Progress', due: '2026-10-01' }),
  ];
  assert.deepEqual(ids(sortStageTasks(tasks, RD)), ['blank-over', 'ip-over', 'blk-over', 'ip-future']);
});

test('sortStageTasks: Late — priority first, then most overdue first', () => {
  const tasks = [
    T({ id: 'med-old', status: 'In Progress', priority: 'Medium', due: '2026-08-01' }),
    T({ id: 'crit-new', status: 'In Progress', priority: 'Critical', due: '2026-10-10' }),
    T({ id: 'high-a', status: 'Deleyed', priority: 'High', due: '2026-09-13' }),
    T({ id: 'crit-old', status: 'Deleyed', priority: 'حرجة', due: '2026-09-01' }),
    T({ id: 'none', status: 'Deleyed', priority: '', due: '2026-07-01' }),
    T({ id: 'low', status: 'Deleyed', priority: 'Low', due: '2026-07-01' }),
    T({ id: 'high-b', status: '', priority: 'High', due: '2026-09-06' }),
  ];
  assert.deepEqual(ids(sortStageTasks(tasks, RD)), ['crit-old', 'crit-new', 'high-b', 'high-a', 'med-old', 'low', 'none']);
});

test('sortStageTasks: Stopped — same rule as Late', () => {
  const tasks = [
    T({ id: 's-high-late', status: 'Blocked', priority: 'High', due: '2026-10-01' }),
    T({ id: 's-crit-future', status: 'Blocked', priority: 'Critical', due: '2026-12-01' }),
    T({ id: 's-high-early', status: 'Stopped', priority: 'High', due: '2026-08-01' }),
    T({ id: 's-crit-old', status: 'On Hold', priority: 'Critical', due: '2026-09-01' }),
  ];
  assert.deepEqual(ids(sortStageTasks(tasks, RD)), ['s-crit-old', 's-crit-future', 's-high-early', 's-high-late']);
});

test('sortStageTasks: In Progress — priority first, then closest to becoming late first', () => {
  const tasks = [
    T({ id: 'h-far', status: 'In Progress', priority: 'High', due: '2027-01-01' }),
    T({ id: 'm-near', status: 'In Progress', priority: 'Medium', due: '2026-10-18' }),
    T({ id: 'h-near', status: 'In Progress', priority: 'High', due: '2026-10-20' }),
    T({ id: 'c-far', status: 'قيد التنفيذ', priority: 'Critical', due: '2026-12-30' }),
  ];
  assert.deepEqual(ids(sortStageTasks(tasks, RD)), ['c-far', 'h-near', 'h-far', 'm-near']);
});

test('sortStageTasks: Not Started — priority then date', () => {
  const tasks = [
    T({ id: 'm', status: 'Not Started', priority: 'Medium', due: '2026-11-01' }),
    T({ id: 'h2', status: '', priority: 'High', due: '2026-12-01' }),
    T({ id: 'h1', status: 'Not Found', priority: 'High', due: '2026-11-15' }),
  ];
  assert.deepEqual(ids(sortStageTasks(tasks, RD)), ['h1', 'h2', 'm']);
});

test('sortStageTasks: Completed — priority only (dates ignored), stable among equals', () => {
  const tasks = [
    T({ id: 'm-early', status: 'Completed', priority: 'Medium', due: '2026-01-01' }),
    T({ id: 'h-late', status: 'Completed', priority: 'High', due: '2026-12-01' }),
    T({ id: 'c', status: 'Completed', priority: 'Critical', due: '2026-10-01' }),
    T({ id: 'h-early', status: 'Completed', priority: 'High', due: '2026-02-01' }),
  ];
  assert.deepEqual(ids(sortStageTasks(tasks, RD)), ['c', 'h-late', 'h-early', 'm-early']);
});

// 2026-10-18: PRIORITY FIRST (the user's "by priority first"); the undated tasks go after
// the dated ones of the SAME priority — they can't be ordered by date.
test('sortStageTasks: priority first; undated (–, daily, TBD, blank) after the dated ones of the same priority', () => {
  const tasks = [
    T({ id: 'ip-crit-dated', status: 'In Progress', priority: 'Critical', due: '2026-12-15' }),
    T({ id: 'ip-crit-tbd', status: 'In Progress', priority: 'Critical', due: 'TBD' }),
    T({ id: 'ip-low-dated', status: 'In Progress', priority: 'Low', due: '2026-12-01' }),
    T({ id: 'ip-high-daily', status: 'In Progress', priority: 'High', due: 'daily' }),
    T({ id: 'ns-blank', status: '', priority: 'Critical', due: '' }),
    T({ id: 'ns-dated', status: '', priority: 'Low', due: '2026-12-01' }),
    T({ id: 'late-dash', status: 'Deleyed', priority: 'Critical', due: '–' }),
    T({ id: 'late-dated', status: 'Deleyed', priority: 'Low', due: '2026-09-01' }),
    T({ id: 'c-tbd', status: 'Completed', priority: 'Critical', due: 'TBD' }),
    T({ id: 'c-dated', status: 'Completed', priority: 'Low', due: '2026-09-01' }),
  ];
  assert.deepEqual(ids(sortStageTasks(tasks, RD)), [
    'late-dash', 'late-dated',
    'ip-crit-dated', 'ip-crit-tbd', 'ip-high-daily', 'ip-low-dated',
    'ns-blank', 'ns-dated',
    'c-tbd', 'c-dated',
  ]);
});

test('sortStageTasks: full ties keep the input order; returns a new array; input untouched', () => {
  const tasks = ['a', 'b', 'c', 'd', 'e'].map((id) => T({ id, status: 'In Progress', priority: 'High', due: '2026-11-01' }));
  const before = ids(tasks);
  const out = sortStageTasks(tasks, RD);
  assert.deepEqual(ids(out), ['a', 'b', 'c', 'd', 'e']);
  assert.notEqual(out, tasks);
  assert.deepEqual(ids(tasks), before);
  const undated = ['p', 'q', 'r'].map((id) => T({ id, status: '', due: 'daily' }));
  assert.deepEqual(ids(sortStageTasks(undated, RD)), ['p', 'q', 'r']);
});

test('sortStageTasks: garbage-safe', () => {
  assert.deepEqual(sortStageTasks(null, RD), []);
  assert.deepEqual(sortStageTasks(undefined), []);
  assert.equal(sortStageTasks([{}], RD).length, 1);
});

// ---- trackerSummary / dailyTasks (rule 3) ------------------------------------------------

const MIX = [
  T({ id: 'c1', status: 'Completed', due: '2026-09-01' }),
  T({ id: 'c2', status: 'Done', due: '' }),
  T({ id: 'ip', status: 'In Progress', due: '2026-12-01' }),
  T({ id: 'ipOver', status: 'In Progress', due: '2026-10-01' }), // → late, past due
  T({ id: 'blankOver', status: '', due: '2026-09-06' }), // → late, past due
  T({ id: 'del', status: 'Deleyed', due: 'TBD' }), // late, no date → not past due
  T({ id: 'stOver', status: 'Blocked', due: '2026-09-01' }), // stopped, past due
  T({ id: 'st', status: 'Blocked', due: '2026-11-01' }),
  T({ id: 'ns', status: 'Not Found', due: 'daily' }),
  T({ id: 'ns2', status: '', due: '2026-10-18' }), // due today → not overdue
  T({ id: 'oth', status: 'Cancelled', due: '2026-12-01' }),
];

test('trackerSummary: counts match effectiveStatus; pastDue includes Late and overdue Stopped', () => {
  assert.deepEqual(trackerSummary(MIX, RD), {
    total: 11, completed: 2, inProgress: 1, late: 3, stopped: 2, notStarted: 2, other: 1, pastDue: 3,
  });
  const s = trackerSummary(MIX, RD);
  assert.equal(s.completed + s.inProgress + s.late + s.stopped + s.notStarted + s.other, s.total);
  // the buckets equal what effectiveStatus would print, task by task
  for (const k of STATUS_KEYS) {
    assert.equal(s[k], MIX.filter((t) => effectiveStatus(t, RD).key === k).length, k);
  }
});

// 2026-10-18 user correction: the task slides show no Completed task in EITHER cadence (it was
// the daily deck's rule), so excludeCompleted / openTasks describe every deck's task slides.
test('trackerSummary: excludeCompleted counts only the tasks the task slides show', () => {
  assert.deepEqual(trackerSummary(MIX, RD, { excludeCompleted: true }), {
    total: 9, completed: 0, inProgress: 1, late: 3, stopped: 2, notStarted: 2, other: 1, pastDue: 3,
  });
  assert.deepEqual(trackerSummary(dailyTasks(MIX, RD), RD), trackerSummary(MIX, RD, { excludeCompleted: true }));
});

test('trackerSummary: empty / garbage → zeros', () => {
  const zero = { total: 0, completed: 0, inProgress: 0, late: 0, stopped: 0, notStarted: 0, other: 0, pastDue: 0 };
  assert.deepEqual(trackerSummary([], RD), zero);
  assert.deepEqual(trackerSummary(null, RD), zero);
});

test('openTasks (= dailyTasks, its former name): drops every Completed task (any spelling), keeps order and everything else', () => {
  assert.equal(dailyTasks, openTasks, 'one list under both names');
  assert.deepEqual(ids(openTasks(MIX, RD)), ['ip', 'ipOver', 'blankOver', 'del', 'stOver', 'st', 'ns', 'ns2', 'oth']);
  assert.deepEqual(ids(openTasks([T({ id: 'a', status: 'مكتمل' }), T({ id: 'b', status: 'complete' })], RD)), []);
  assert.deepEqual(openTasks(null, RD), []);
});

// ---- taskLogKey --------------------------------------------------------------------------

test('taskLogKey: wbs, else id, trimmed and bounded', () => {
  assert.equal(taskLogKey({ wbs: '1.2.3', id: 'row-4' }), '1.2.3');
  assert.equal(taskLogKey({ wbs: '', id: 'new-2' }), 'new-2');
  assert.equal(taskLogKey({ wbs: ' 2.1 ' }), '2.1');
  assert.equal(taskLogKey({}), '');
  assert.equal(taskLogKey(null), '');
  assert.equal(taskLogKey({ wbs: 'x'.repeat(500) }).length, 120);
});

// ---- recordStatusLog ---------------------------------------------------------------------

const trk = (...tasks) => ({ format: 'x', tasks });
const W = (wbs, o = {}) => T({ id: wbs, wbs, ...o });

test('recordStatusLog: first recording of an empty / garbage log', () => {
  for (const log of [undefined, null, 'junk', 42, [], { v: 1 }, { tasks: 'no' }]) {
    const out = recordStatusLog(log, trk(W('1.1', { status: 'In Progress', due: '2026-12-01' })), '2026-10-13');
    assert.deepEqual(out, { v: 1, tasks: { '1.1': [{ at: '2026-10-13', status: 'inProgress' }] } });
  }
});

test('recordStatusLog: records the EFFECTIVE status as of that day', () => {
  const t = trk(W('a', { status: 'In Progress', due: '2026-10-15' }), W('b', { status: 'Blocked', due: '2026-10-01' }));
  const l1 = recordStatusLog(null, t, '2026-10-13');
  assert.deepEqual(l1.tasks.a, [{ at: '2026-10-13', status: 'inProgress' }]);
  assert.deepEqual(l1.tasks.b, [{ at: '2026-10-13', status: 'stopped' }]);
  const l2 = recordStatusLog(l1, t, '2026-10-18'); // a is now overdue → late
  assert.deepEqual(l2.tasks.a, [{ at: '2026-10-13', status: 'inProgress' }, { at: '2026-10-18', status: 'late' }]);
  assert.deepEqual(l2.tasks.b, [{ at: '2026-10-13', status: 'stopped' }]);
});

test('recordStatusLog: appends only on change; returns a NEW log, input untouched', () => {
  const t = trk(W('a', { status: 'Deleyed' }));
  const l1 = recordStatusLog(null, t, '2026-10-01');
  const snap = JSON.stringify(l1);
  const l2 = recordStatusLog(l1, t, '2026-10-05');
  assert.equal(JSON.stringify(l1), snap);
  assert.notEqual(l2, l1);
  assert.deepEqual(l2.tasks.a, [{ at: '2026-10-01', status: 'late' }]);
  const l3 = recordStatusLog(l2, trk(W('a', { status: 'Completed' })), '2026-10-16');
  assert.deepEqual(l3.tasks.a, [{ at: '2026-10-01', status: 'late' }, { at: '2026-10-16', status: 'completed' }]);
});

test('recordStatusLog: a second change on the same day replaces that day; a same-day revert leaves no trace', () => {
  let log = recordStatusLog(null, trk(W('a', { status: 'Deleyed' })), '2026-10-13');
  log = recordStatusLog(log, trk(W('a', { status: 'In Progress' })), '2026-10-18');
  log = recordStatusLog(log, trk(W('a', { status: 'Completed' })), '2026-10-18');
  assert.deepEqual(log.tasks.a, [{ at: '2026-10-13', status: 'late' }, { at: '2026-10-18', status: 'completed' }]);
  log = recordStatusLog(log, trk(W('a', { status: 'Deleyed' })), '2026-10-18');
  assert.deepEqual(log.tasks.a, [{ at: '2026-10-13', status: 'late' }]);
});

test('recordStatusLog: on a task\'s FIRST day the first reading stays as the baseline (a same-day transition is kept)', () => {
  // a new row uploaded In Progress and marked Completed in the editor the same day
  let log = recordStatusLog(null, trk(W('a', { status: 'In Progress' })), '2026-10-18');
  log = recordStatusLog(log, trk(W('a', { status: 'Completed' })), '2026-10-18');
  assert.deepEqual(log.tasks.a, [{ at: '2026-10-18', status: 'inProgress' }, { at: '2026-10-18', status: 'completed' }]);
  // a further same-day change replaces only the reading after the baseline (bounded: 2 entries)
  log = recordStatusLog(log, trk(W('a', { status: 'Blocked' })), '2026-10-18');
  assert.deepEqual(log.tasks.a, [{ at: '2026-10-18', status: 'inProgress' }, { at: '2026-10-18', status: 'stopped' }]);
  // back to the baseline → just the baseline
  log = recordStatusLog(log, trk(W('a', { status: 'In Progress' })), '2026-10-18');
  assert.deepEqual(log.tasks.a, [{ at: '2026-10-18', status: 'inProgress' }]);
  // first seen Completed, a same-day revert and re-complete → still first seen Completed
  let l2 = recordStatusLog(null, trk(W('b', { status: 'Completed' })), '2026-10-18');
  l2 = recordStatusLog(l2, trk(W('b', { status: 'In Progress' })), '2026-10-18');
  l2 = recordStatusLog(l2, trk(W('b', { status: 'Completed' })), '2026-10-18');
  assert.deepEqual(l2.tasks.b, [{ at: '2026-10-18', status: 'completed' }]);
  // the next day the usual one-entry-per-day rule applies again
  log = recordStatusLog(log, trk(W('a', { status: 'Deleyed' })), '2026-10-19');
  log = recordStatusLog(log, trk(W('a', { status: 'Completed' })), '2026-10-19');
  assert.deepEqual(log.tasks.a, [{ at: '2026-10-18', status: 'inProgress' }, { at: '2026-10-19', status: 'completed' }]);
});

test('recordStatusLog: a reading older than the last entry is ignored (the log only moves forward)', () => {
  const log = recordStatusLog(null, trk(W('a', { status: 'In Progress' })), '2026-10-18');
  const out = recordStatusLog(log, trk(W('a', { status: 'Completed' })), '2026-10-10');
  assert.deepEqual(out.tasks.a, [{ at: '2026-10-18', status: 'inProgress' }]);
});

test('recordStatusLog: a full timestamp is cut to its day; an invalid date records nothing', () => {
  const t = trk(W('a', { status: '' }));
  assert.deepEqual(recordStatusLog(null, t, '2026-10-13T09:15:00.000Z').tasks.a, [{ at: '2026-10-13', status: 'notStarted' }]);
  for (const bad of ['', null, undefined, '13/10/2026', '2026-02-30', 123]) {
    assert.deepEqual(recordStatusLog(null, t, bad), { v: 1, tasks: {} }, String(bad));
  }
});

test('recordStatusLog: tasks absent from this tracker keep their history; null tracker is a no-op', () => {
  const l1 = recordStatusLog(null, trk(W('gone', { status: 'In Progress' })), '2026-10-01');
  const l2 = recordStatusLog(l1, trk(W('new', { status: '' })), '2026-10-02');
  assert.deepEqual(Object.keys(l2.tasks).sort(), ['gone', 'new']);
  assert.deepEqual(recordStatusLog(l2, null, '2026-10-03'), l2);
  // a bare task array is accepted too
  assert.deepEqual(recordStatusLog(null, [W('z', { status: 'Done' })], '2026-10-03').tasks.z, [{ at: '2026-10-03', status: 'completed' }]);
});

test('recordStatusLog: key = wbs, else id; a repeated wbs falls back to the unique id; keyless rows skipped', () => {
  const t = trk(
    T({ id: '3.1', wbs: '3.1', status: 'In Progress' }),
    T({ id: '3.1#2', wbs: '3.1', status: 'Completed' }),
    T({ id: 'new-1', wbs: '', status: 'Blocked' }),
    { status: 'Done' },
  );
  const log = recordStatusLog(null, t, '2026-10-13');
  assert.deepEqual(log.tasks, {
    '3.1': [{ at: '2026-10-13', status: 'inProgress' }],
    '3.1#2': [{ at: '2026-10-13', status: 'completed' }],
    'new-1': [{ at: '2026-10-13', status: 'stopped' }],
  });
});

test('recordStatusLog: per-task history is capped (the newest entries win)', () => {
  let log = null;
  const statuses = ['In Progress', 'Blocked'];
  const start = Date.UTC(2026, 0, 1);
  const N = STATUS_LOG_ENTRY_LIMIT + 15;
  for (let i = 0; i < N; i++) {
    const at = new Date(start + i * 86400000).toISOString().slice(0, 10);
    log = recordStatusLog(log, trk(W('a', { status: statuses[i % 2] })), at);
  }
  const list = log.tasks.a;
  assert.equal(list.length, STATUS_LOG_ENTRY_LIMIT);
  assert.equal(list[list.length - 1].at, new Date(start + (N - 1) * 86400000).toISOString().slice(0, 10));
  assert.equal(list[0].at, new Date(start + 15 * 86400000).toISOString().slice(0, 10));
});

test('recordStatusLog: the task count is capped — tasks in the current tracker are never the ones dropped', () => {
  const tasks = {};
  for (let i = 0; i < STATUS_LOG_TASK_LIMIT + 10; i++) tasks[`old-${i}`] = [{ at: '2026-01-01', status: 'completed' }];
  const out = recordStatusLog({ v: 1, tasks }, trk(W('live', { status: 'In Progress' })), '2026-10-18');
  assert.equal(Object.keys(out.tasks).length, STATUS_LOG_TASK_LIMIT);
  assert.ok(out.tasks.live);
});

// ---- normalizeStatusLog ------------------------------------------------------------------

test('normalizeStatusLog: drops junk entries/keys, sorts, collapses duplicates and same-day entries', () => {
  const out = normalizeStatusLog({
    v: 7,
    extra: 'dropped',
    tasks: {
      a: [
        { at: '2026-10-18', status: 'completed' },
        { at: '2026-10-01', status: 'late' },
        { at: '2026-10-05', status: 'late' }, // consecutive duplicate
        { at: '2026-10-18', status: 'completed', junk: 1 },
        { at: 'yesterday', status: 'late' },
        { at: '2026-10-10', status: 'bogus' },
        null, 'x',
      ],
      b: 'not a list',
      c: [],
      '': [{ at: '2026-10-01', status: 'late' }],
      // a FIRST day keeps its first reading as the baseline plus the day's latest reading
      d: [{ at: '2026-10-01', status: 'inProgress' }, { at: '2026-10-01', status: 'stopped' }],
      e: [
        { at: '2026-10-01', status: 'inProgress' }, { at: '2026-10-01', status: 'late' },
        { at: '2026-10-01', status: 'completed' },
      ],
      // …but a later day with an earlier baseline still holds one entry
      f: [
        { at: '2026-09-01', status: 'notStarted' },
        { at: '2026-10-01', status: 'inProgress' }, { at: '2026-10-01', status: 'stopped' },
      ],
    },
  });
  assert.deepEqual(out, {
    v: 1,
    tasks: {
      a: [{ at: '2026-10-01', status: 'late' }, { at: '2026-10-18', status: 'completed' }],
      d: [{ at: '2026-10-01', status: 'inProgress' }, { at: '2026-10-01', status: 'stopped' }],
      e: [{ at: '2026-10-01', status: 'inProgress' }, { at: '2026-10-01', status: 'completed' }],
      f: [{ at: '2026-09-01', status: 'notStarted' }, { at: '2026-10-01', status: 'stopped' }],
    },
  });
  assert.deepEqual(normalizeStatusLog('garbage'), { v: 1, tasks: {} });
  // idempotent
  assert.deepEqual(normalizeStatusLog(out), out);
});

// ---- completedDuring ---------------------------------------------------------------------

// The week the 2026-10-18 report opens on: Friday 2026-10-16 .. the report date.
const WS = '2026-10-16';

function history(entries) {
  const tasks = {};
  for (const [k, list] of Object.entries(entries)) tasks[k] = list.map(([at, status]) => ({ at, status }));
  return { v: 1, tasks };
}

test('completedDuring: a task Late last week and Completed this week → listed with its previous status', () => {
  const tracker = trk(W('a', { status: 'Completed', due: '2026-09-01' }), W('b', { status: 'In Progress', due: '2026-12-01' }));
  const log = history({ a: [['2026-10-13', 'late'], ['2026-10-18', 'completed']], b: [['2026-10-13', 'inProgress']] });
  const out = completedDuring(log, tracker, WS, RD, RD);
  assert.equal(out.length, 1);
  assert.equal(out[0].task, tracker.tasks[0]);
  assert.equal(out[0].previousStatus, 'late');
  assert.equal(out[0].completedAt, '2026-10-18');
});

test('completedDuring: the end-to-end flow — seed at the previous upload, record this upload, then ask', () => {
  const prev = trk(
    W('w1', { status: 'Deleyed', due: '2026-09-06' }),
    W('w2', { status: 'In Progress', due: '2026-12-01' }),
    W('w3', { status: 'Blocked', due: '2026-09-01' }),
    W('w4', { status: 'Completed', due: '2026-09-01' }),
    W('w5', { status: '', due: '2026-10-01' }),
  );
  const now = trk(
    W('w1', { status: 'Completed', due: '2026-09-06' }),
    W('w2', { status: 'Completed', due: '2026-12-01' }),
    W('w3', { status: 'Completed', due: '2026-09-01' }),
    W('w4', { status: 'Completed', due: '2026-09-01' }), // completed before — first seen completed
    W('w5', { status: 'In Progress', due: '2026-10-01' }),
    W('w6', { status: 'Completed', due: '2026-10-17' }), // brand-new row, first seen completed
  );
  let log = recordStatusLog(undefined, prev, '2026-10-13');
  log = recordStatusLog(log, now, '2026-10-18');
  const out = completedDuring(log, now, WS, RD, RD);
  assert.deepEqual(out.map((x) => [x.task.wbs, x.previousStatus, x.completedAt]), [
    ['w1', 'late', '2026-10-18'],
    ['w2', 'inProgress', '2026-10-18'],
    ['w3', 'stopped', '2026-10-18'],
  ]);
});

test('completedDuring: first reading In Progress and Completed on the same day D → listed (previousStatus inProgress)', () => {
  const D = '2026-10-17';
  const done = trk(W('a', { status: 'Completed', due: '2026-12-01' }));
  let log = recordStatusLog(null, trk(W('a', { status: 'In Progress', due: '2026-12-01' })), D);
  log = recordStatusLog(log, done, D);
  assert.deepEqual(completedDuring(log, done, WS, RD, RD).map((r) => [r.task.id, r.previousStatus, r.completedAt]),
    [['a', 'inProgress', D]]);
  // the seed case: a cached document dated today, then an upload today
  const seeded = recordStatusLog(null, trk(W('s', { status: 'Deleyed' })), RD);
  const after = recordStatusLog(seeded, trk(W('s', { status: 'Completed' })), RD);
  assert.deepEqual(completedDuring(after, trk(W('s', { status: 'Completed' })), WS, RD, RD)
    .map((r) => [r.task.id, r.previousStatus, r.completedAt]), [['s', 'late', RD]]);
});

test('completedDuring: window edges are inclusive; outside the window is excluded', () => {
  const tracker = trk(...['fri', 'thu', 'end', 'after'].map((k) => W(k, { status: 'Completed' })));
  const log = history({
    fri: [['2026-10-10', 'inProgress'], ['2026-10-16', 'completed']], // = start
    thu: [['2026-10-10', 'inProgress'], ['2026-10-15', 'completed']], // day before start
    end: [['2026-10-10', 'inProgress'], ['2026-10-18', 'completed']], // = end
    after: [['2026-10-10', 'inProgress'], ['2026-10-19', 'completed']], // after end
  });
  assert.deepEqual(completedDuring(log, tracker, WS, RD, RD).map((x) => x.task.wbs), ['fri', 'end']);
});

test('completedDuring: first-seen-completed tasks are excluded (when they finished is unknown)', () => {
  const tracker = trk(W('a', { status: 'Completed' }));
  assert.deepEqual(completedDuring(history({ a: [['2026-10-17', 'completed']] }), tracker, WS, RD, RD), []);
  assert.deepEqual(completedDuring({ v: 1, tasks: {} }, tracker, WS, RD, RD), []);
  assert.deepEqual(completedDuring(null, tracker, WS, RD, RD), []);
});

test('completedDuring: reverted tasks are excluded (current status decides)', () => {
  const tracker = trk(W('a', { status: 'In Progress', due: '2026-12-01' }));
  const log = history({ a: [['2026-10-13', 'late'], ['2026-10-16', 'completed'], ['2026-10-17', 'inProgress']] });
  assert.deepEqual(completedDuring(log, tracker, WS, RD, RD), []);
  // and when the tracker says Completed but the log has not seen it yet → not listed
  const done = trk(W('a', { status: 'Completed' }));
  assert.deepEqual(completedDuring(history({ a: [['2026-10-13', 'late']] }), done, WS, RD, RD), []);
});

test('completedDuring: completed in an earlier week, reopened, completed again this week → listed with the reopen status', () => {
  const tracker = trk(W('a', { status: 'Completed' }));
  const log = history({ a: [
    ['2026-09-01', 'inProgress'], ['2026-09-10', 'completed'], ['2026-10-01', 'stopped'], ['2026-10-17', 'completed'],
  ] });
  assert.deepEqual(completedDuring(log, tracker, WS, RD, RD).map((x) => [x.previousStatus, x.completedAt]),
    [['stopped', '2026-10-17']]);
});

test('completedDuring: previousStatus is the last non-completed status (any key, other included)', () => {
  const tracker = trk(...['l', 's', 'i', 'n', 'o'].map((k) => W(k, { status: 'Done' })));
  const log = history({
    l: [['2026-10-01', 'inProgress'], ['2026-10-10', 'late'], ['2026-10-17', 'completed']],
    s: [['2026-10-10', 'stopped'], ['2026-10-17', 'completed']],
    i: [['2026-10-10', 'inProgress'], ['2026-10-17', 'completed']],
    n: [['2026-10-10', 'notStarted'], ['2026-10-17', 'completed']],
    o: [['2026-10-10', 'other'], ['2026-10-17', 'completed']],
  });
  assert.deepEqual(completedDuring(log, tracker, WS, RD, RD).map((x) => [x.task.wbs, x.previousStatus]),
    [['l', 'late'], ['s', 'stopped'], ['i', 'inProgress'], ['n', 'notStarted'], ['o', 'other']]);
});

test('completedDuring: result follows the tracker order; invalid window → []', () => {
  const tracker = trk(W('z', { status: 'Completed' }), W('a', { status: 'Completed' }));
  const log = history({ a: [['2026-10-10', 'late'], ['2026-10-16', 'completed']], z: [['2026-10-10', 'late'], ['2026-10-18', 'completed']] });
  assert.deepEqual(completedDuring(log, tracker, WS, RD, RD).map((x) => x.task.wbs), ['z', 'a']);
  assert.deepEqual(completedDuring(log, tracker, RD, WS, RD), []); // start after end
  assert.deepEqual(completedDuring(log, tracker, '', RD, RD), []);
  assert.deepEqual(completedDuring(log, null, WS, RD, RD), []);
});

test('completedDuring: repeated wbs uses the same keys recordStatusLog wrote', () => {
  const before = trk(T({ id: '3.1', wbs: '3.1', status: 'In Progress' }), T({ id: '3.1#2', wbs: '3.1', status: 'Blocked' }));
  const after = trk(T({ id: '3.1', wbs: '3.1', status: 'In Progress' }), T({ id: '3.1#2', wbs: '3.1', status: 'Completed' }));
  let log = recordStatusLog(null, before, '2026-10-13');
  log = recordStatusLog(log, after, '2026-10-17');
  const out = completedDuring(log, after, WS, RD, RD);
  assert.deepEqual(out.map((x) => [x.task.id, x.previousStatus]), [['3.1#2', 'stopped']]);
});
