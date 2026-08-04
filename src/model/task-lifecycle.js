// model/task-lifecycle.js — the stateful "show a newly-closed task exactly one
// more report, then drop it" rule (user decision 2026-08-04).
//
// Pure, total and idempotent, mirroring model/delta-baseline.js's role: this
// module owns the SHAPE and the TRANSITIONS of settings.taskLog, nothing else.
// It never touches storage (store.js persists), never renders, and never throws
// on malformed input — every entry point tolerates null/undefined/garbage logs.
//
// The rule, per report date D (identical for BOTH deck variants, applied inside
// each variant's own task list):
//   1. status ≠ مغلق                     → include.
//   2. status = مغلق                     → include ONLY if the row was shown
//      non-closed in an earlier report and has not yet had its ONE closed
//      appearance ("grace"). It renders with the green مغلق status so the reader
//      sees the work finished.
//   3. after that single closed appearance → excluded from every later report.
//   4. tasks already مغلق before this feature shipped have no log entry at all →
//      never shown (an empty taskLog IS the pre-ship exclusion mechanism).
// Same-day regeneration is idempotent: a grace consumed TODAY (closedOn === D)
// still counts as a grace row for D, and only becomes "consumed" for D+1.
//
// Data class: the log stores task TEXT (project-management content), the same
// class as store.cachedTracker — never patient data. Plaintext and auditable on
// purpose: a user who exports settings can read exactly which task strings the
// app remembers.

/** Tracker status that marks a task done. */
export const CLOSED = 'مغلق';

/** List ids — WHICH ARRAY a row lives in, never row.category (review's newTask()
 *  creates rows with category:'' and they still belong to a list). */
export const LIST_EXTERNAL = 'ext'; // tasksCurrent — the NUPCO/نوبكو deck
export const LIST_INTERNAL = 'int'; // tasksInternal — the داخلي (لين) deck

/** Hard cap on stored entries (most-recently-touched wins). */
export const TASK_LOG_LIMIT = 300;
/** Max characters of task text inside a key (keys stay bounded for storage). */
export const TASK_KEY_MAX = 160;
/** An entry still open after this many days is stale bookkeeping — pruned. */
export const STALE_OPEN_DAYS = 120;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const oneLine = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();

const isValidDate = (v) => typeof v === 'string' && ISO_DATE_RE.test(v);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toUTC(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

/** Whole days from `a` to `b` (both 'YYYY-MM-DD'); null when either is unparsable. */
function dayGap(a, b) {
  const ta = toUTC(a);
  const tb = toUTC(b);
  if (ta == null || tb == null) return null;
  return Math.round((tb - ta) / 86400000);
}

/**
 * Stable key for a task row: list id + normalized task text.
 * Tracker rows carry NO stable id (confirmed in ingest) — the text IS the
 * identity, whitespace-collapsed so a reformatted cell keeps its history, and
 * sliced so one pathological cell cannot dominate the log.
 * @param {'ext'|'int'} listId
 * @param {{task?:string}|string} task - a task row (or the text itself)
 * @returns {string}
 */
export function taskKey(listId, task) {
  const text = typeof task === 'string' ? task : oneLine(task && task.task);
  return `${listId}|${oneLine(text).slice(0, TASK_KEY_MAX)}`;
}

/**
 * Coerce anything into a well-formed task log.
 * Entry = { openOn: 'YYYY-MM-DD', closedOn: 'YYYY-MM-DD'|null }. openOn is
 * MANDATORY — it is what distinguishes "was shown open" from "never seen" and it
 * drives stale pruning; an entry without it is meaningless and is dropped.
 * @param {*} log
 * @returns {Object<string,{openOn:string, closedOn:string|null}>} a NEW object
 */
export function sanitizeTaskLog(log) {
  const out = {};
  if (!isPlainObject(log)) return out;
  for (const [key, entry] of Object.entries(log)) {
    if (typeof key !== 'string' || !key) continue;
    if (!isPlainObject(entry)) continue;
    if (!isValidDate(entry.openOn)) continue;
    const closedOn = isValidDate(entry.closedOn) ? entry.closedOn : null;
    out[key] = { openOn: entry.openOn, closedOn };
  }
  return out;
}

/**
 * Is this CLOSED row still owed its one closed appearance on `reportDate`?
 * True when an entry exists with a valid openOn AND (closedOn == null — grace
 * not yet taken — OR closedOn === reportDate — this very report already took it,
 * so a same-day regeneration reproduces the identical row set).
 * A BACKDATED regeneration (closedOn > reportDate) cannot resurrect the row.
 * @param {*} log
 * @param {'ext'|'int'} listId
 * @param {{task?:string}} task
 * @param {string} reportDate - 'YYYY-MM-DD'
 * @returns {boolean}
 */
export function isGraceRow(log, listId, task, reportDate) {
  if (!isPlainObject(log)) return false;
  const entry = log[taskKey(listId, task)];
  if (!isPlainObject(entry) || !isValidDate(entry.openOn)) return false;
  if (entry.closedOn == null) return true;
  return isValidDate(entry.closedOn) && entry.closedOn === reportDate;
}

const isClosedRow = (t) => t && t.status === CLOSED;

/**
 * Record what a published report actually SHOWED, and prune. Called only after a
 * generation succeeded, from the FINAL model — so manual review edits are
 * recorded exactly as published.
 *
 * Two passes, in this order:
 *  1. non-closed rows OVERWRITE their entry with {openOn: reportDate, closedOn: null}.
 *     Overwrite, not merge: a task that reopens RESETS its cycle and therefore
 *     earns a fresh grace when it closes again.
 *  2. closed rows set closedOn ONCE (first write wins) — the grace is being
 *     consumed by this report. A closed row with NO entry is ignored: it never
 *     had a non-closed appearance (pre-ship task, or one typed straight into the
 *     review screen as closed), so it never earns a grace.
 * Then prune: consumed graces (closedOn < reportDate), stale opens (openOn more
 * than STALE_OPEN_DAYS before reportDate), and anything past TASK_LOG_LIMIT by
 * most-recently-touched.
 *
 * Total and idempotent: f(f(log, args), args) deep-equals f(log, args).
 * @param {*} log - previous settings.taskLog (null/undefined/garbage tolerated)
 * @param {{reportDate?:string, tasksCurrent?:Array, tasksInternal?:Array}} args
 * @returns {Object<string,{openOn:string, closedOn:string|null}>} a NEW log
 */
export function recordShownTasks(log, args) {
  // Destructured defensively (not in the signature): an explicit `null` bag is a
  // real call shape here — recordRunSnapshot passes whatever the model carried.
  const { reportDate, tasksCurrent, tasksInternal } = (args && typeof args === 'object') ? args : {};
  const next = sanitizeTaskLog(log);
  if (!isValidDate(reportDate)) return prune(next, null); // no usable date → no writes
  const lists = [
    [LIST_EXTERNAL, Array.isArray(tasksCurrent) ? tasksCurrent : []],
    [LIST_INTERNAL, Array.isArray(tasksInternal) ? tasksInternal : []],
  ];
  // A row with no description has no identity — it is never recorded (junk rows,
  // and the blank row the review screen's newTask() adds before it is filled in).
  const keyOf = (listId, t) => {
    if (!t || typeof t !== 'object') return null;
    const text = oneLine(t.task);
    return text ? taskKey(listId, text) : null;
  };
  // Pass 1 — everything still running is (re)opened as of this report.
  for (const [listId, rows] of lists) {
    for (const t of rows) {
      if (isClosedRow(t)) continue;
      const key = keyOf(listId, t);
      if (!key) continue;
      next[key] = { openOn: reportDate, closedOn: null };
    }
  }
  // Pass 2 — closed rows consume their grace, first write wins.
  for (const [listId, rows] of lists) {
    for (const t of rows) {
      if (!isClosedRow(t)) continue;
      const key = keyOf(listId, t);
      if (!key) continue;
      const entry = next[key];
      if (!entry) continue; // never shown open → nothing to consume
      if (entry.closedOn == null) entry.closedOn = reportDate;
    }
  }
  return prune(next, reportDate);
}

/** Drop consumed graces + stale opens, then cap by most-recently-touched. */
function prune(log, reportDate) {
  const kept = {};
  for (const [key, entry] of Object.entries(log)) {
    if (reportDate) {
      // Grace already spent on an EARLIER report → the task is done being shown.
      if (entry.closedOn != null && entry.closedOn < reportDate) continue;
      // Open for longer than the window → stale bookkeeping, not a live task.
      const age = dayGap(entry.openOn, reportDate);
      if (entry.closedOn == null && age != null && age > STALE_OPEN_DAYS) continue;
    }
    kept[key] = entry;
  }
  const keys = Object.keys(kept);
  if (keys.length <= TASK_LOG_LIMIT) return kept;
  const touched = (k) => {
    const e = kept[k];
    return e.closedOn != null && e.closedOn > e.openOn ? e.closedOn : e.openOn;
  };
  // Most recently touched first; ties broken by key so the result is deterministic.
  keys.sort((a, b) => (touched(a) < touched(b) ? 1 : touched(a) > touched(b) ? -1 : (a < b ? -1 : 1)));
  const capped = {};
  for (const k of keys.slice(0, TASK_LOG_LIMIT)) capped[k] = kept[k];
  return capped;
}
