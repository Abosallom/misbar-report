// model/drafts.js — auto-draft the editable report content from the tracker.
// Every output is a heuristic seed the user edits on the review screen.
import {
  LIST_EXTERNAL, LIST_INTERNAL, isGraceRow, taskKey,
} from './task-lifecycle.js?v=v2026-08-10.1';

const CLOSED = 'مغلق'; // closed/done
const CAT_INTERNAL = 'لين'; // فئة التقرير value that routes a task to the internal slide (داخلي)

// Display mapping for the status column on the task slides.
const displayStatus = (s) => (s === 'مفتوح' ? 'قيد التنفيذ' : s);

// A concrete dd-mm-yyyy date somewhere in the (verbatim) due-date string.
const DATE_RE = /\d{1,2}-\d{1,2}-\d{4}/;
const hasConcreteDate = (due) => DATE_RE.test(due || '');

// A non-closed task is "scheduled/active" (worth showing on the deck) when it is
// ongoing/late, or has a concrete target date. Backlog rows whose due is empty or a
// non-date placeholder ('يومي', 'غير محدد') and whose status is مفتوح/blank are dropped.
// This is the rule that reproduces the published 09-07 split (8 current / 5 internal).
const isScheduled = (t) =>
  t.status === 'مستمر' || t.status === 'متأخر' || hasConcreteDate(t.dueDate);

const oneLine = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();

function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

// Last dd-mm-yyyy token in a due-date string (ranges list the completion date last).
function lastDate(due) {
  const re = /(\d{1,2})-(\d{1,2})-(\d{4})/g;
  let m;
  let last = null;
  while ((m = re.exec(due || ''))) last = m;
  if (!last) return null;
  return new Date(Date.UTC(+last[3], +last[2] - 1, +last[1]));
}

const dayDiff = (a, b) => Math.round((a.getTime() - b.getTime()) / 86400000);

/**
 * splitTaskLists(tasks, {taskLog, reportDate}) -> {tasksCurrent, tasksInternal}
 *
 * THE SINGLE OWNER of the task split + the closed-task lifecycle. Every caller —
 * autoDraft, the review screen's fallback, the generate screen's fallback — goes
 * through here, so the rule cannot drift again (two hand-written duplicates once
 * did, and one of them emptied the internal table).
 *
 * Membership, per list, in TRACKER ORDER (one filter, nothing appended):
 *  - non-closed rows: the NUPCO side additionally requires isScheduled (the
 *    published-deck filter, unchanged since 2026-07-22); the internal side takes
 *    EVERY non-closed لين row, scheduled or not.
 *  - closed rows: included only as a GRACE row — the task was shown non-closed in
 *    an earlier report and has not yet had its single closed appearance
 *    (model/task-lifecycle.js isGraceRow) — AND only when no open twin with the
 *    same text is already in that list, so "X قيد التنفيذ" and "X مغلق" can never
 *    render side by side.
 *    A grace row BYPASSES isScheduled deliberately: it already earned its slot,
 *    and filtering it out would leave the grace unconsumed forever (the row would
 *    pop back up months later). The real tracker has exactly this shape — a closed
 *    نوبكو row whose due date is the prose 'يومان بعد تسليم…'.
 * Called with an empty bag ({}), it degrades safely to non-closed-only — never to
 * the old "show everything" behaviour.
 *
 * The `hidden` flag and every other field survive the {...t} spread; the status
 * display mapping (مفتوح → قيد التنفيذ) is applied to both lists, leaving مغلق
 * verbatim so a grace row renders green.
 *
 * @param {import('../contracts.js').TrackerTask[]} tasks
 * @param {{taskLog?:Object, reportDate?:string}} [opts]
 * @returns {{tasksCurrent:import('../contracts.js').TrackerTask[],
 *            tasksInternal:import('../contracts.js').TrackerTask[]}}
 */
export function splitTaskLists(tasks, opts = {}) {
  // Junk rows (null holes, stray primitives) are dropped up front so every filter
  // below can read .category/.status straight off the object.
  const rows = (Array.isArray(tasks) ? tasks : []).filter((t) => t && typeof t === 'object');
  const log = (opts && opts.taskLog) || null;
  const reportDate = (opts && opts.reportDate) || null;
  const toDisplay = (t) => ({ ...t, status: displayStatus(t.status) });

  const pick = (listId, inList, keepOpen) => {
    const own = rows.filter(inList);
    // Open keys FIRST: an included non-closed row suppresses its closed twin.
    const openKeys = new Set();
    for (const t of own) {
      if (t.status !== CLOSED && keepOpen(t)) openKeys.add(taskKey(listId, t));
    }
    return own
      .filter((t) => (t.status === CLOSED
        ? isGraceRow(log, listId, t, reportDate) && !openKeys.has(taskKey(listId, t))
        : keepOpen(t)))
      .map(toDisplay);
  };

  return {
    tasksCurrent: pick(LIST_EXTERNAL, (t) => t.category !== CAT_INTERNAL, isScheduled),
    tasksInternal: pick(LIST_INTERNAL, (t) => t.category === CAT_INTERNAL, () => true),
  };
}

/**
 * autoDraft(tracker, reportDate, {taskLog}) -> draft panels + task splits.
 *
 * SUPERSESSION (user decision 2026-08-04): the 2026-07-22 rule "tasksInternal is
 * the COMPLETE لين log — every task at every status, مغلق and hidden included" is
 * REPLACED. Both variants now follow ONE rule — non-closed rows, plus a closed row
 * for exactly ONE report after it closes ("…it applies for both داخلي and the
 * other one"). The internal table therefore drops from 31 rows to the ~8 that are
 * actually live, and the reader still sees each task's completion once.
 * The split itself lives in splitTaskLists above; the NUPCO isScheduled filter is
 * unchanged for non-closed rows.
 *
 * @param {import('../contracts.js').TrackerModel} tracker
 * @param {string} reportDate - 'YYYY-MM-DD'
 * @param {{taskLog?:Object}} [opts] - settings.taskLog; OPTIONAL, so the existing
 *   two-argument callers stay valid and simply get the non-closed-only degradation.
 * @returns {{supportRequired:string[], completedTasks:string[], plannedTasks:string[],
 *            tasksCurrent:import('../contracts.js').TrackerTask[],
 *            tasksInternal:import('../contracts.js').TrackerTask[]}}
 */
export function autoDraft(tracker, reportDate, opts = {}) {
  const tasks = (tracker && tracker.tasks) || [];
  const challenges = (tracker && tracker.challenges) || [];
  const rd = parseISO(reportDate);

  // ---- Task slides ----
  const { tasksCurrent, tasksInternal } = splitTaskLists(tasks, {
    taskLog: opts && opts.taskLog,
    reportDate,
  });

  // ---- supportRequired: solutions of OPEN (مفتوح) challenges ----
  const supportRequired = challenges
    .filter((ch) => ch.status === 'مفتوح')
    .map((ch) => oneLine(ch.solution))
    .filter(Boolean);

  // ---- completedTasks: closed tasks completed within 10 days before reportDate ----
  const completedTasks = tasks
    .filter((t) => t.status === CLOSED)
    .map((t) => ({ t, d: lastDate(t.dueDate) }))
    .filter(({ d }) => d && rd && dayDiff(rd, d) >= 0 && dayDiff(rd, d) <= 10)
    .map(({ t }) => oneLine(t.task))
    .filter(Boolean);

  // ---- plannedTasks: open tasks due within 14 days after reportDate ----
  const plannedTasks = tasks
    .filter((t) => t.status !== CLOSED)
    .map((t) => ({ t, d: lastDate(t.dueDate) }))
    .filter(({ d }) => d && rd && dayDiff(d, rd) >= 0 && dayDiff(d, rd) <= 14)
    .map(({ t }) => oneLine(t.task))
    .filter(Boolean);

  return { supportRequired, completedTasks, plannedTasks, tasksCurrent, tasksInternal };
}
