// model/drafts.js — auto-draft the editable report content from the tracker.
// Every output is a heuristic seed the user edits on the review screen.

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
 * autoDraft(tracker, reportDate) -> draft panels + task splits.
 * @param {import('../contracts.js').TrackerModel} tracker
 * @param {string} reportDate - 'YYYY-MM-DD'
 * @returns {{supportRequired:string[], completedTasks:string[], plannedTasks:string[],
 *            tasksCurrent:import('../contracts.js').TrackerTask[],
 *            tasksInternal:import('../contracts.js').TrackerTask[]}}
 */
export function autoDraft(tracker, reportDate) {
  const tasks = (tracker && tracker.tasks) || [];
  const challenges = (tracker && tracker.challenges) || [];
  const rd = parseISO(reportDate);

  // ---- Task slides: non-closed + scheduled, split by فئة التقرير ----
  const active = tasks.filter((t) => t.status !== CLOSED && isScheduled(t));
  const toDisplay = (t) => ({ ...t, status: displayStatus(t.status) });
  const tasksInternal = active.filter((t) => t.category === CAT_INTERNAL).map(toDisplay);
  const tasksCurrent = active.filter((t) => t.category !== CAT_INTERNAL).map(toDisplay);

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
