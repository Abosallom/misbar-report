// model/delta-baseline.js — the published-report history (recordSnapshot), the
// delta-MODE enum, and the Sun-based work-week calendar math. PURE functions only:
// no I/O, no Date.now(); all date math is on ISO 'yyyy-mm-dd' strings so the same
// inputs always yield the same output (golden-testable).
//
// 2026-08-05 — THE BASELINE PICKER IS GONE. pickDeltaBaseline (and the anchored /
// definitionShift disclosures that hung off it) has been DELETED. The exec delta chips
// no longer diff the current run against a STORED previous report; they are now THE
// WEEK'S ACTIVITY, computed from the rows' own date columns by model/delta-window.js
// (deltas[key] = asof(reportDate) − asof(the day before the window opens)). That kills
// the whole disclosure family with it: there is no baseline to be un-anchored, and no
// stored numbers speaking an older `completed` definition, because no stored numbers
// are read at all. THE INVARIANT of that change — the big numbers on slides 2/3/4 stay
// CUMULATIVE TOTALS; only the small green chips changed meaning — is stated in full at
// the top of model/delta-window.js.
//
// What survives here, and why:
//   • recordSnapshot + HISTORY_LIMIT — snapshotHistory is still WRITTEN after every
//     successful run (it is the published record) and still READ by the history panel
//     (ui/history-table.js: published vs computed vs restated numbers). Only the chips
//     stopped consuming it.
//   • COMPLETED_DEF_VERSION / COMPLETED_DEF_SINCE — the history panel imports
//     COMPLETED_DEF_SINCE to mark rows recorded under the pre-2026-07-28 `completed`
//     rule (a rejected result is a lab's final outcome, so rejected became a SUBSET of
//     completed). Stored history is never rewritten, so that boundary date stays load-
//     bearing for as long as pre-change entries are still on screen.
//   • the deltaMode enum (DELTA_MODES / DEFAULT_DELTA_MODE / canonicalDeltaMode /
//     normalizeDeltaMode / isWeekDeltaMode) — SAME two values, SAME storage key, and
//     store.js imports the enum, so these exports must stay stable. Their SEMANTICS
//     changed, though: the mode used to pick which stored report to compare against;
//     it now picks the SIZE OF THE ACTIVITY WINDOW ('week' = Friday..report-day,
//     'daily' = the report day alone). See contracts.js reportOptions.deltaMode.
//   • the calendar math (isoToDays / isoWeekday / weekStartDay) — now
//     EXPORTED. delta-window.js imports it instead of keeping a second copy, so there
//     is exactly ONE definition of "which Friday opens this week" behind the banner,
//     the deck legend and the history panel.
// The Saudi work week is Sun–Thu. Fri/Sat report dates need no special case anywhere:
// weekStartDay() maps every day back to the Friday that opens its week, which is the
// week their numbers belong to.
// The weekday-anchored 'weekly-sun' / 'weekly-thu' modes of an earlier round are
// RETIRED: they, and the older bare 'weekly', are aliases of 'week' now (see
// DELTA_MODE_ALIASES) so no stored setting is orphaned. Any unknown value falls back
// to DEFAULT_DELTA_MODE.

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Current definition version of the report's number set. Bumped whenever a headline
 * number changes MEANING (v1 → v2 on 2026-07-28: completed now includes rejected).
 */
export const COMPLETED_DEF_VERSION = 2;

/**
 * The report date from which numbers are recorded under COMPLETED_DEF_VERSION.
 * A stored entry is dated by the report it belongs to, and every report issued from
 * this date on is produced by the new engine, so the date IS the version for the
 * whole existing history — no stamp to backfill, no stored entry to rewrite.
 */
export const COMPLETED_DEF_SINCE = '2026-07-28';

/**
 * First report date produced under the 2026-08-05 rules: the Fri/Sat weekend (due
 * dates were Excel's Sat/Sun convention before) AND the due-today-or-overdue late
 * boundary. Snapshots PUBLISHED before this date carry `lateNoResult` (and the
 * due-derived splits) under the old rules; entries on/after it speak the new ones.
 * Same role as COMPLETED_DEF_SINCE one rule-change earlier: the history panel uses
 * the LATER of the two boundaries to decide when a published row must be recomputed
 * (`restated`) instead of trusted, so one range never zigzags between definitions.
 * Stored history is never rewritten.
 */
export const LATE_DEF_SINCE = '2026-08-05';

/** The two valid reportOptions.deltaMode values, in UI order. */
export const DELTA_MODES = ['daily', 'week'];

/**
 * The mode a fresh install gets and the fallback for anything unrecognized
 * (2026-08-04 user request: "instead of daily"). Seeded by seeds/defaults.js and
 * FORCED onto existing installs once by store.js migrateV6toV7 — a default change
 * that never reaches the installs that already persisted the old default is not a
 * default change at all (precedent: migrateV4toV5).
 */
export const DEFAULT_DELTA_MODE = 'week';

// Retired mode values → their replacement. NULL-PROTOTYPE on purpose: a plain object
// literal would resolve 'toString' / 'constructor' / '__proto__' through Object.prototype
// and hand back a FUNCTION as if it were a mode, so a hostile or corrupt stored value
// could slip past canonicalDeltaMode's null gate. With no prototype the lookup for any
// non-own key is undefined, full stop.
// 'weekly'     — the pre-split value (before weekly-sun/weekly-thu existed).
// 'weekly-sun' / 'weekly-thu' — the weekday-anchored pair, superseded by week-to-date.
const DELTA_MODE_ALIASES = Object.assign(Object.create(null), {
  weekly: 'week',
  'weekly-sun': 'week',
  'weekly-thu': 'week',
});

/**
 * Canonical delta mode for any stored/user value, or NULL when the value is not a
 * mode at all. THE SINGLE OWNER of this mapping — store.js imports it (it used to
 * keep a private copy that had to be edited in lockstep). Retired values migrate
 * through DELTA_MODE_ALIASES instead of being discarded, so an install that chose a
 * weekly comparison keeps one.
 * @param {*} v
 * @returns {'daily'|'week'|null}
 */
export function canonicalDeltaMode(v) {
  if (DELTA_MODES.includes(v)) return v;
  return typeof v === 'string' ? (DELTA_MODE_ALIASES[v] || null) : null;
}

/**
 * Canonical delta mode with a guaranteed answer: unknown → DEFAULT_DELTA_MODE.
 * NOTE it falls back to the DEFAULT, not to 'daily'. This is the window builder's own
 * entry point (model/delta-window.js) and it runs on paths with no backfill behind them (the ephemeral
 * in-memory doc, a hand-built model in a test), so falling back to 'daily' would
 * silently re-daily-ify a user who never asked for daily.
 * @param {*} mode
 * @returns {'daily'|'week'}
 */
export function normalizeDeltaMode(mode) {
  return canonicalDeltaMode(mode) || DEFAULT_DELTA_MODE;
}

/**
 * True when a stored/user mode means the WEEK-WIDE activity window (Friday..report-day)
 * rather than the single report day. Consumers MUST use this rather than a
 * startsWith('weekly') test: the canonical value is 'week', which FAILS that prefix
 * check, so every surface hanging off it (the review banner heading, the week-window
 * explainer) would silently vanish while the chips kept counting a whole week.
 *
 * It answers for the EFFECTIVE mode (normalizeDeltaMode), not just the canonical one,
 * so it can never disagree with the window delta-window.js actually built: an
 * unrecognized stored value resolves to DEFAULT_DELTA_MODE ('week') in both places.
 * A UI that says "daily" over a week's activity is the bug this guards against.
 * @param {*} mode
 * @returns {boolean}
 */
export function isWeekDeltaMode(mode) {
  return normalizeDeltaMode(mode) === 'week';
}

// Most recent N report dates are retained; older entries are trimmed away.
export const HISTORY_LIMIT = 45;

/** True for a well-formed 'yyyy-mm-dd' string. */
function isIso(s) {
  return typeof s === 'string' && ISO_RE.test(s);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Whole UTC-day count for an ISO date — deterministic, no Date.now(). EXPORTED as of
 * 2026-08-05: model/delta-window.js builds the activity window on this same primitive
 * rather than re-deriving it, so the banner, the deck legend and the history panel can
 * never disagree about what day a date is.
 * @param {string} iso - 'yyyy-mm-dd'
 * @returns {number} whole-UTC-day count
 */
export function isoToDays(iso) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return Date.UTC(y, m - 1, d) / 86400000;
}

/**
 * Weekday of an ISO 'yyyy-mm-dd' date, 0 = Sunday … 6 = Saturday, computed
 * ARITHMETICALLY from the UTC day count — NOT with `new Date(iso).getDay()`, which
 * parses the string as UTC midnight and then reports the LOCAL day (one day earlier
 * for negative offsets). The app runs at +03 but must not depend on the host zone.
 * Day 0 of the UTC epoch (1970-01-01) was a Thursday, hence the +4.
 * @param {string} iso - 'yyyy-mm-dd'
 * @returns {number} 0..6
 */
export function isoWeekday(iso) {
  return (((isoToDays(iso) + 4) % 7) + 7) % 7;
}

/**
 * The weekday a delta week OPENS on: 5 = Friday.
 *
 * WHY FRIDAY AND NOT SUNDAY (Aziz, 2026-08-31). The delta week used to open on
 * Sunday, which silently DROPPED every event dated Friday or Saturday from the
 * numbers anyone actually saw. A Thursday reading covered Sun..Thu; the next
 * Thursday covered the following Sun..Thu; nothing in between ever reported the
 * Friday and Saturday in the gap. Observed live: a Thursday reading of 988
 * completed, then 1,001 on the Sunday with NO chip explaining the 13 — they had
 * landed on the Friday and Saturday that no window contained.
 *
 * Opening on Friday makes the weeks TILE the calendar with no gap and no overlap:
 * Fri..Thu is a full seven days, so a Thursday reading now accounts for every day
 * since the previous Thursday. This is about which DAYS a chip counts and has
 * nothing to do with the Sun–Thu working week that engine/workday.js uses for due
 * dates — that math does not import this module and is deliberately untouched.
 */
export const WEEK_START_WEEKDAY = 5;

/**
 * Whole-UTC-day count of the FRIDAY that opens the Fri–Thu delta week containing
 * `iso`. Reuses the two primitives above so there is exactly one definition of
 * "what day is this" in the module.
 *
 * A Friday maps to ITSELF; every other day maps BACK to the most recent Friday, so
 * Thursday — six days on — closes the week. No day needs a special case.
 * @param {string} iso - 'yyyy-mm-dd'
 * @returns {number} whole-UTC-day count of that week's Friday
 */
export function weekStartDay(iso) {
  const offset = (((isoWeekday(iso) - WEEK_START_WEEKDAY) % 7) + 7) % 7;
  return isoToDays(iso) - offset;
}

/** Keep only finite numeric leaves — mirrors how snapshot.numbers is sanitized. */
function cleanNumbers(numbers) {
  const out = {};
  if (isPlainObject(numbers)) {
    for (const [k, v] of Object.entries(numbers)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

/**
 * recordSnapshot(history, isoDate, numbers) → a NEW history object with the
 * {isoDate: numbers} entry added or replaced, keyed by ISO date, and trimmed to
 * the most recent HISTORY_LIMIT (45) dates. The input history is never mutated;
 * an invalid isoDate returns a (filtered) copy unchanged. Non-ISO keys are dropped.
 * The stored entry shape is UNCHANGED by definition versioning — an entry's report
 * date already tells the picker which definition it speaks (COMPLETED_DEF_SINCE), so
 * nothing has to be stamped here and no stored entry is ever rewritten. A caller that
 * wants an explicit stamp may pass a numeric `defVersion` inside `numbers`; it is a
 * finite number, so it survives cleanNumbers and store.js validation, and the picker
 * prefers it over the date inference.
 * @param {Object<string,Object<string,number>>} history
 * @param {string} isoDate - 'yyyy-mm-dd'
 * @param {Object<string,number>} numbers
 * @returns {Object<string,Object<string,number>>}
 */
export function recordSnapshot(history, isoDate, numbers) {
  const base = isPlainObject(history) ? history : {};
  const next = {};
  for (const [k, v] of Object.entries(base)) {
    if (isIso(k) && isPlainObject(v)) next[k] = v;
  }
  if (isIso(isoDate)) next[isoDate] = cleanNumbers(numbers);

  const dates = Object.keys(next).sort(); // ISO strings sort chronologically
  const kept = dates.length > HISTORY_LIMIT ? dates.slice(dates.length - HISTORY_LIMIT) : dates;
  const out = {};
  for (const d of kept) out[d] = next[d];
  return out;
}
