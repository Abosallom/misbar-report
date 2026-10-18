// model/tracker-status.js — the project tracker's STATUS RULES (Aziz, 2026-10-18).
//
// One pure module owns every decision the user spelled out about a tracker task's
// status, so the task slides, the summary pills, the open-tasks filter and the weekly
// «المهام المكتملة خلال الأسبوع» slide can never disagree with each other:
//
//   1. A task that is not Completed and whose due date is strictly before the REPORT
//      date becomes Late (متأخر) — a blank / «Not Found» / unknown status included.
//      Exception: Stopped (متوقف) stays Stopped when overdue. Either way the date of an
//      overdue Late or Stopped task prints red, and it counts as «متجاوزة الموعد».
//   2. Inside one stage the tasks sort Late, Stopped, In Progress, Not Started,
//      Completed (see sortStageTasks for the per-group keys).
//   3. The summary pills count exactly the statuses the tables show.
//
// The report date — never today's clock — is the overdue reference, like the old
// isOverdue in slidespec/build-tracker.js: a re-run of an old report must print what
// that report said.
//
// It also owns the SHAPE of settings.trackerStatusLog — the per-task status history
// that lets the weekly deck say "this task was Late last week and is Completed now".
// Like model/task-lifecycle.js it never touches storage, never renders and never
// throws on malformed input; store.js persists what these functions return.
//
// Data class: the log stores WBS ids / task ids and status keys only — never task
// text, owners or any patient data.

/** Status keys in display AND sort order (rule 2). */
export const STATUS_KEYS = ['late', 'stopped', 'inProgress', 'notStarted', 'completed'];

/** Arabic label per status — the Status column is Arabic in every language (rule 4). */
export const STATUS_AR = {
  late: 'متأخر', stopped: 'متوقف', inProgress: 'قيد التنفيذ', notStarted: 'لم يبدأ', completed: 'مكتمل',
};

/** Arabic label per priority — the Priority column is Arabic in every language. */
export const PRIORITY_AR = { critical: 'حرجة', high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };

/** Max history entries kept per task (the newest win). ~one change a day for two months. */
export const STATUS_LOG_ENTRY_LIMIT = 60;
/** Max tasks kept in the log; tasks no longer in the tracker are dropped first. */
export const STATUS_LOG_TASK_LIMIT = 1000;
/** Max characters of a log key — a WBS id is short; this only bounds a pathological id. */
export const STATUS_LOG_KEY_MAX = 120;

// ---- normalisation ---------------------------------------------------------------------

// Lower-case, collapse spaces/underscores/hyphens, strip Arabic diacritics and tatweel
// (so «معلّق» == «معلق») and fold hamza-alef forms (so «متاخر» typed without the
// hamza still lands on Late).
function norm(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
}

const alias = (pairs) => {
  const m = new Map();
  for (const [key, words] of pairs) for (const w of words) m.set(norm(w), key);
  return m;
};

// English as the workbook writes it (incl. its misspelt 'Deleyed') plus the Arabic words
// themselves, so a status typed in Arabic on the website lands in the same bucket.
// Blocked and On Hold both mean "stopped" to the user (one «متوقف» box). 'Closed' /
// «مغلق» are completion words — mapped so an overdue closed task is never turned Late.
// A blank status, the Portfolio sheet's «Not Found» and the old «غير محدد» box all mean
// "nobody started it" (rule 3 renames that box to «لم يبدأ»).
const STATUS_ALIASES = alias([
  ['completed', ['completed', 'complete', 'done', 'closed', 'مكتمل', 'مكتملة', 'منجز', 'منجزة', 'مغلق', 'مغلقة']],
  ['stopped', ['blocked', 'stopped', 'on hold', 'onhold', 'hold', 'متوقف', 'متوقفة', 'معلّق', 'معلقة']],
  ['late', ['deleyed', 'delayed', 'late', 'overdue', 'متأخر', 'متأخرة']],
  ['inProgress', ['in progress', 'inprogress', 'ongoing', 'قيد التنفيذ', 'جاري', 'جارية', 'قيد العمل']],
  ['notStarted', ['not started', 'notstarted', 'not found', 'لم يبدأ', 'لم تبدأ', 'غير محدد']],
]);

/**
 * The status a task's raw text names, before the overdue rule.
 * @param {*} raw - the task's status text (English or Arabic, any case)
 * @returns {'late'|'stopped'|'inProgress'|'notStarted'|'completed'|'other'}
 */
export function baseStatus(raw) {
  const k = norm(raw);
  if (!k) return 'notStarted';
  return STATUS_ALIASES.get(k) || 'other';
}

const PRIORITY_ALIASES = alias([
  ['critical', ['critical', 'urgent', 'حرجة', 'حرج']],
  ['high', ['high', 'عالية', 'عالي', 'مرتفعة', 'مرتفع']],
  ['medium', ['medium', 'normal', 'متوسطة', 'متوسط']],
  ['low', ['low', 'منخفضة', 'منخفض']],
]);
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * @param {*} raw - the task's priority text
 * @returns {'critical'|'high'|'medium'|'low'|null}
 */
export function priorityKey(raw) {
  return PRIORITY_ALIASES.get(norm(raw)) || null;
}

// ---- dates -----------------------------------------------------------------------------

const isRealDate = (y, mo, d) => {
  const t = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1900 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};
const pad = (n) => String(n).padStart(2, '0');
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const isIsoDay = (v) => {
  const m = typeof v === 'string' && v.match(ISO_DAY);
  return !!m && isRealDate(+m[1], +m[2], +m[3]);
};

/**
 * The ISO day of a REAL due date, else null. Accepts exactly what build-tracker's
 * formatDue prints as a date — ISO 'yyyy-mm-dd' (optionally with a time) and day-first
 * 'd/m/yyyy' ('.' / '-' too) — so a cell that prints as a date is the cell that sorts
 * and turns red as one. 'daily', 'TBD', '–' and blank are undated.
 * @param {*} due
 * @returns {string|null}
 */
export function dueISO(due) {
  const s = String(due ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ][\d:.]+Z?)?$/);
  if (m && isRealDate(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m && isRealDate(+m[3], +m[2], +m[1])) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return null;
}

// ---- effective status (rule 1) ---------------------------------------------------------

/**
 * The status the report shows for a task on `reportDate`.
 *   key     — a STATUS_KEYS key, or 'other' for a truly unmappable text that is not overdue
 *   label   — STATUS_AR[key]; for 'other' the raw text verbatim (never guessed at)
 *   pastDue — not completed AND due < reportDate (overdue Stopped included)
 *   red     — the due date prints red (= pastDue: overdue Late or Stopped)
 * An invalid reportDate disables the overdue rule (nothing can be judged late).
 * @param {object} task - { status, due, … }
 * @param {string} reportDate - 'yyyy-mm-dd'
 */
export function effectiveStatus(task, reportDate) {
  const raw = String(task?.status ?? '').trim();
  const base = baseStatus(raw);
  const due = dueISO(task?.due);
  // Strictly before: a task due ON the report date is still on time that day.
  const pastDue = base !== 'completed' && !!due && isIsoDay(reportDate) && due < reportDate;
  const key = pastDue && base !== 'stopped' ? 'late' : base;
  return { key, label: key === 'other' ? raw : STATUS_AR[key], pastDue, red: pastDue };
}

// ---- order within one stage (rule 2) ---------------------------------------------------

// 'other' (an unmappable, not-overdue status) sits right after Not Started.
const GROUP_RANK = { late: 0, stopped: 1, inProgress: 2, notStarted: 3, other: 4, completed: 5 };

/**
 * The tasks of ONE stage (milestone group) in the user's order — a NEW array.
 *   groups: Late, Stopped, In Progress, Not Started, (other), Completed;
 *   inside a group PRIORITY first (حرجة → عالية → متوسطة → منخفضة → none) — the user's
 *   rule says "by priority first" for every group; then, within one priority, the DATED
 *   tasks before the undated ones ('–', 'daily', 'TBD', blank: "Tasks with no date go
 *   after the dated tasks"); then due date ascending — for Late/Stopped "most overdue
 *   first", for In Progress / Not Started "closest to becoming late first". Completed is
 *   by priority only (no date key). Ties keep the input (Portfolio) order — stable.
 *   (2026-10-18: an earlier cut put every dated task before every undated one, so a
 *   Medium dated task preceded a Critical «TBD» one — against "priority first".)
 * @param {object[]} tasks
 * @param {string} reportDate
 */
export function sortStageTasks(tasks, reportDate) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list
    .map((task, i) => {
      const { key } = effectiveStatus(task, reportDate);
      const due = dueISO(task?.due);
      const p = priorityKey(task?.priority);
      return {
        task, i,
        g: GROUP_RANK[key],
        undated: due ? 0 : 1,
        p: p ? PRIORITY_RANK[p] : 4,
        d: key === 'completed' ? '' : due || '',
      };
    })
    .sort((a, b) => a.g - b.g || a.p - b.p || a.undated - b.undated
      || (a.d < b.d ? -1 : a.d > b.d ? 1 : 0) || a.i - b.i)
    .map((x) => x.task);
}

// ---- summary pills (rule 3) ------------------------------------------------------------

/**
 * Counts over the tasks a deck SHOWS (pass excludeCompleted for the «متابعة المهام» slides,
 * which show no Completed task at all in either cadence — 2026-10-18 user correction —
 * unless reportOptions.trackerShowCompleted puts them back, rows and pill),
 * computed from effectiveStatus so the pills always
 * match the table cells. `other` (unmappable statuses) is reported too so the buckets
 * always add up to `total`.
 * @returns {{ total:number, completed:number, inProgress:number, late:number, stopped:number,
 *             notStarted:number, other:number, pastDue:number }}
 */
export function trackerSummary(tasks, reportDate, { excludeCompleted = false } = {}) {
  const out = { total: 0, completed: 0, inProgress: 0, late: 0, stopped: 0, notStarted: 0, other: 0, pastDue: 0 };
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const e = effectiveStatus(t, reportDate);
    if (excludeCompleted && e.key === 'completed') continue;
    out.total++;
    out[e.key]++;
    if (e.pastDue) out.pastDue++;
  }
  return out;
}

/**
 * The «متابعة المهام» slides' task list, in BOTH cadences: every task whose effective status
 * is not Completed. 2026-10-18 user correction: «Completed Tasks should be ONLY mentioned in
 * the Completed During the Week SLIDE and nothing else (even Task Tracker whether Daily or
 * Weekly)» — so this was the daily deck's rule and is now every deck's.
 */
export function openTasks(tasks, reportDate) {
  return (Array.isArray(tasks) ? tasks : []).filter((t) => effectiveStatus(t, reportDate).key !== 'completed');
}
/** The former name (the rule began as the daily deck's) — kept so callers and tests that
 *  still say dailyTasks read the very same list. */
export const dailyTasks = openTasks;

// ---- status history (settings.trackerStatusLog) ----------------------------------------
//
// Shape: { v:1, tasks: { [key]: [{ at:'yyyy-mm-dd', status:<key> }, …] } }, entries in
// date order, no two consecutive entries with the same status, at most ONE entry per day
// (a later change on the same day replaces that day's entry — the log records "the status
// as of a day", so an editor slip corrected the same afternoon leaves no trace and the
// previous status stays the one the week actually started with). One exception: on a
// task's FIRST day the first reading is kept as the baseline and the latest reading of
// that day may follow it (at most two entries that day), so a transition seen only on the
// first day is not lost.

/** The log key of a task: its WBS id (stable across uploads) or, without one, its id. */
export function taskLogKey(task) {
  return String(task?.wbs || task?.id || '').trim().slice(0, STATUS_LOG_KEY_MAX);
}

const LOG_STATUSES = new Set([...STATUS_KEYS, 'other']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const tasksOf = (tracker) => (Array.isArray(tracker) ? tracker : Array.isArray(tracker?.tasks) ? tracker.tasks : [])
  .filter(isObj);

/**
 * A task → key map for one tracker. A WBS id that REPEATS inside the tracker would merge
 * two tasks' histories, so the repeats fall back to their unique id (the ingest names
 * them 'wbs#2', … — the first keeps the plain wbs, i.e. taskLogKey's answer).
 */
function keyedTasks(tracker) {
  const out = [];
  const used = new Set();
  for (const t of tasksOf(tracker)) {
    let k = taskLogKey(t);
    if (k && used.has(k)) k = String(t.id || '').trim().slice(0, STATUS_LOG_KEY_MAX);
    if (!k || used.has(k)) continue; // no stable identity → cannot be tracked
    used.add(k);
    out.push([k, t]);
  }
  return out;
}

/**
 * A clean copy of any value as a status log: unknown keys dropped, entries validated
 * (real ISO day, known status), sorted, same-day and consecutive duplicates collapsed,
 * caps applied. Never throws; garbage → an empty log. Exported for store.js validate /
 * import.
 * @returns {{ v:1, tasks: Object<string, {at:string,status:string}[]> }}
 */
export function normalizeStatusLog(log) {
  const tasks = {};
  const src = isObj(log) && isObj(log.tasks) ? log.tasks : {};
  for (const [rawKey, list] of Object.entries(src)) {
    const key = String(rawKey).trim().slice(0, STATUS_LOG_KEY_MAX);
    if (!key || !Array.isArray(list)) continue;
    const entries = list
      .filter((e) => isObj(e) && isIsoDay(e.at) && LOG_STATUSES.has(e.status))
      .map((e, i) => ({ at: e.at, status: e.status, i }))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.i - b.i));
    const clean = [];
    for (const { at, status } of entries) pushEntry(clean, at, status);
    if (clean.length) tasks[key] = clean.slice(-STATUS_LOG_ENTRY_LIMIT);
  }
  return { v: 1, tasks: capTasks(tasks, null) };
}

/** Append `status` at day `at` to an in-order entry list, keeping the log invariants. */
function pushEntry(list, at, status) {
  const last = list[list.length - 1];
  if (last && at < last.at) return; // the log only moves forward; an older reading is ignored
  if (last && last.at === at) {
    if (list[0].at === at) {
      // The task's FIRST day: there is no earlier-dated baseline, so the day's first
      // reading IS the baseline — keep it and let the newer reading replace only what
      // came after it. Otherwise a row first seen In Progress and completed the same day
      // (new row + editor, or a seed dated today + an upload today) would collapse to a
      // lone Completed entry and be dropped as "first seen completed". Bounded: a first
      // day holds at most two entries.
      list.length = 1;
      if (list[0].status !== status) list.push({ at, status });
      return;
    }
    list.pop(); // same day: the newer reading replaces the day's entry
    const prev = list[list.length - 1];
    if (!prev || prev.status !== status) list.push({ at, status });
    return;
  }
  if (!last || last.status !== status) list.push({ at, status });
}

/** Keep at most STATUS_LOG_TASK_LIMIT tasks: those in `liveKeys` first, then the most recently changed. */
function capTasks(tasks, liveKeys) {
  const keys = Object.keys(tasks);
  if (keys.length <= STATUS_LOG_TASK_LIMIT) return tasks;
  const lastAt = (k) => tasks[k][tasks[k].length - 1].at;
  keys.sort((a, b) => {
    const la = liveKeys && liveKeys.has(a) ? 0 : 1, lb = liveKeys && liveKeys.has(b) ? 0 : 1;
    return la - lb || (lastAt(a) > lastAt(b) ? -1 : lastAt(a) < lastAt(b) ? 1 : 0);
  });
  const out = {};
  for (const k of keys.slice(0, STATUS_LOG_TASK_LIMIT)) out[k] = tasks[k];
  return out;
}

/**
 * A NEW log with every task's effective status as of `atISO`'s day recorded — appended
 * only when it differs from that task's last entry (same day → replaces it, except on the
 * task's first day, whose first reading stays as the baseline). Tasks
 * absent from this tracker keep their history (a task may come back next upload).
 * Recording the EFFECTIVE status means a task that silently passed its due date is
 * remembered as Late, which is what the user "remembers" it as.
 * @param {*} log - the current settings.trackerStatusLog (any value)
 * @param {object} tracker - a ProjectTracker ({ tasks }) or a task array
 * @param {string} atISO - 'yyyy-mm-dd' (a longer ISO timestamp is cut to its day —
 *   pass the LOCAL date: the caller knows the zone, this module does not)
 */
export function recordStatusLog(log, tracker, atISO) {
  const out = normalizeStatusLog(log);
  const at = typeof atISO === 'string' ? atISO.slice(0, 10) : '';
  if (!isIsoDay(at)) return out;
  const live = new Set();
  for (const [k, t] of keyedTasks(tracker)) {
    live.add(k);
    const list = out.tasks[k] ? out.tasks[k].slice() : [];
    pushEntry(list, at, effectiveStatus(t, at).key);
    if (list.length) out.tasks[k] = list.slice(-STATUS_LOG_ENTRY_LIMIT);
    else delete out.tasks[k];
  }
  out.tasks = capTasks(out.tasks, live);
  return out;
}

/**
 * The tasks that BECAME Completed inside [startISO, endISO] (both inclusive) — the weekly
 * «المهام المكتملة خلال الأسبوع» slide. A task qualifies when
 *   - its CURRENT effective status (as of reportDate) is Completed (a task reverted since
 *     is not shown), and
 *   - its log ends in a Completed run whose first entry is dated inside the window, and
 *   - a non-Completed entry precedes that run: a task first ever seen Completed (the
 *     seed, or a brand-new row) is skipped — when it finished is unknown.
 * previousStatus = the last non-Completed status before the run (a STATUS key or 'other').
 * Result is in tracker order.
 * @returns {{ task:object, previousStatus:string, completedAt:string }[]}
 */
export function completedDuring(log, tracker, startISO, endISO, reportDate) {
  if (!isIsoDay(startISO) || !isIsoDay(endISO) || startISO > endISO) return [];
  const { tasks } = normalizeStatusLog(log);
  const out = [];
  for (const [k, task] of keyedTasks(tracker)) {
    if (effectiveStatus(task, reportDate).key !== 'completed') continue;
    const list = tasks[k];
    if (!list || !list.length) continue;
    let i = list.length - 1;
    if (list[i].status !== 'completed') continue; // the log never saw it complete
    while (i > 0 && list[i - 1].status === 'completed') i--;
    if (i === 0) continue; // first seen completed
    const completedAt = list[i].at;
    if (completedAt < startISO || completedAt > endISO) continue;
    out.push({ task, previousStatus: list[i - 1].status, completedAt });
  }
  return out;
}
