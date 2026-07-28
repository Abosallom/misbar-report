// model/delta-baseline.js — rolling per-date history of report numbers plus the
// baseline picker that drives the exec-summary delta chips. PURE functions only:
// no I/O, no Date.now(); all date math is on ISO 'yyyy-mm-dd' strings so the same
// inputs always yield the same output (golden-testable).
//
// The exec chips compare the current run against a chosen previous report. The
// window is user-selectable in Settings (reportOptions.deltaMode). The Saudi work
// week is Sun–Thu and the weekly report is issued on SUNDAY and on THURSDAY, so the
// weekly window is WEEKDAY-ANCHORED (not "7 days back") with exactly two options:
//   • 'daily'      → the most recent stored report STRICTLY BEFORE the report date.
//   • 'weekly-sun' → the most recent stored report strictly before the report date
//                    that was issued on a SUNDAY.
//   • 'weekly-thu' → …the same, on a THURSDAY.
// Legacy stored settings saying 'weekly' are read as 'weekly-sun'; any unknown value
// falls back to 'daily'. While history is still filling up, a weekly mode with no
// matching weekday uses the most recent prior report and says so via anchored:false.
// When history has no qualifying entry at all we fall back to the single legacy
// snapshot (settings.snapshot {asOf, numbers}); with neither, no baseline (null).

// DEFINITION VERSIONING (2026-07-28). The `completed` number changed meaning on
// 2026-07-28: a REJECTED result is a lab's final outcome, so completed now counts
// non-cancelled rows that either carry a result date OR are rejected (rejected
// became a SUBSET of completed instead of being excluded from it). Every number
// already sitting in settings.snapshotHistory was recorded under the OLD rule, so
// the first report after the change would show a completed delta inflated by ~the
// rejected count — a definition change wearing the costume of progress.
// Stored history is NEVER rewritten (it is the published record). Instead the
// picker DISCLOSES: pickDeltaBaseline returns definitionShift:true when the chosen
// baseline speaks the old definition, exactly as it already returns anchored:false
// for a weekly baseline that missed its weekday, and the review banner / deck
// legend can say so. See COMPLETED_DEF_VERSION below for how the version is read.

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

/** The three valid reportOptions.deltaMode values, in UI order. */
export const DELTA_MODES = ['daily', 'weekly-sun', 'weekly-thu'];

// Anchor weekday per weekly mode: 0 = Sunday … 4 = Thursday (see isoWeekday).
const WEEKLY_ANCHOR = { 'weekly-sun': 0, 'weekly-thu': 4 };

/**
 * Canonical delta mode for any stored/user value: the legacy 'weekly' reads as
 * 'weekly-sun' (so settings saved before the Sunday/Thursday split keep working)
 * and anything unknown falls back to 'daily'.
 * @param {*} mode
 * @returns {'daily'|'weekly-sun'|'weekly-thu'}
 */
export function normalizeDeltaMode(mode) {
  if (mode === 'weekly') return 'weekly-sun'; // legacy alias
  return DELTA_MODES.includes(mode) ? mode : 'daily';
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

/** Whole UTC-day count for an ISO date — deterministic, no Date.now(). */
function isoToDays(iso) {
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
function isoWeekday(iso) {
  return (((isoToDays(iso) + 4) % 7) + 7) % 7;
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

/**
 * Definition version a stored number set speaks. An EXPLICIT numeric `defVersion`
 * always wins — a history entry may carry it as a numeric leaf (store.js validates
 * snapshotHistory values as finite numbers, so a stamp survives save/load/import)
 * and the legacy snapshot carries it as a sibling of `numbers` (see
 * seeds/defaults.js SNAPSHOT_SEED). With no stamp the entry's own report DATE
 * decides: on/after COMPLETED_DEF_SINCE it was produced by the new engine, before
 * it by the old one. Unknown/undated → treated as OLD (disclose rather than hide).
 * @param {Object<string,number>} numbers
 * @param {string|null} isoDate
 * @param {*} [explicit]  stamp found outside the numbers map (legacy snapshot)
 * @returns {number}
 */
function definitionVersionOf(numbers, isoDate, explicit) {
  const stamp = [explicit, isPlainObject(numbers) ? numbers.defVersion : undefined]
    .find((v) => typeof v === 'number' && Number.isFinite(v));
  if (stamp !== undefined) return stamp;
  return isIso(isoDate) && isoDate >= COMPLETED_DEF_SINCE ? COMPLETED_DEF_VERSION : 1;
}

/**
 * True when this baseline would make the completed delta partly definitional.
 * Requires an actual `completed` number: a baseline that carries none produces no
 * completed delta, so there is nothing definitional to disclose about it.
 */
function isDefinitionShift(numbers, isoDate, explicit) {
  if (!isPlainObject(numbers)) return false;
  const c = numbers.completed;
  if (typeof c !== 'number' || !Number.isFinite(c)) return false;
  return definitionVersionOf(numbers, isoDate, explicit) < COMPLETED_DEF_VERSION;
}

/** Attach definitionShift:true to a result — the key is ABSENT when there is
 *  nothing to disclose, so a caller can test it with a plain truthiness check. */
function withDefinitionShift(result, explicit) {
  if (isDefinitionShift(result.numbers, result.baselineDate, explicit)) {
    result.definitionShift = true;
  }
  return result;
}

/** The largest (most recent) ISO date in a list, or null for an empty list. */
function mostRecent(dates) {
  return dates.reduce((best, d) => (best == null || d > best ? d : best), null);
}

/**
 * pickDeltaBaseline({history, legacySnapshot, reportDate, mode}) → the baseline
 * numbers the delta chips compare against, or null. Every candidate is STRICTLY
 * BEFORE reportDate (never the same day, never a future date).
 *   mode 'daily'      → the most recent such history date.
 *   mode 'weekly-sun' → the most recent such history date falling on a SUNDAY;
 *   mode 'weekly-thu' → …on a THURSDAY. With no matching weekday yet (history still
 *                       filling up) it degrades to the most recent such date and
 *                       returns anchored:false; anchored:true when the weekday matched.
 *   'weekly' is accepted as a legacy alias of 'weekly-sun'; unknown → 'daily'.
 * `anchored` is present for the weekly modes only. Fallback (no qualifying history
 * entry): legacySnapshot {asOf, numbers} → { numbers, baselineDate: asOf,
 * mode: 'legacy' }. Null when that is absent too.
 *
 * `definitionShift` is present (and always true) ONLY when the chosen baseline
 * carries a `completed` number recorded under a PRE-2026-07-28 definition, i.e.
 * before rejected results counted as completed — so part of that key's delta is a
 * definition change, not movement. It is left off entirely when there is nothing to
 * disclose (current-definition baseline, or one with no completed number at all).
 * Callers disclose it the way anchored:false is disclosed. Stored history is never
 * rewritten to make the flag go away.
 * @param {{history?:Object<string,Object<string,number>>,
 *          legacySnapshot?:{asOf?:string, numbers?:Object<string,number>, defVersion?:number},
 *          reportDate?:string, mode?:('daily'|'weekly-sun'|'weekly-thu'|'weekly')}} args
 * @returns {{numbers:Object<string,number>, baselineDate:(string|null), mode:string,
 *            anchored?:boolean, definitionShift?:true}|null}
 */
export function pickDeltaBaseline({ history, legacySnapshot, reportDate, mode } = {}) {
  const hist = isPlainObject(history) ? history : {};
  const wantMode = normalizeDeltaMode(mode);
  const anchorDay = WEEKLY_ANCHOR[wantMode];

  // Candidate dates: valid ISO keys strictly before the (valid ISO) report date.
  const candidates = isIso(reportDate)
    ? Object.keys(hist).filter((d) => isIso(d) && isPlainObject(hist[d]) && d < reportDate)
    : [];

  if (candidates.length > 0) {
    if (anchorDay === undefined) {
      // daily (default): the most recent date strictly before reportDate.
      const chosen = mostRecent(candidates);
      return withDefinitionShift({ numbers: hist[chosen], baselineDate: chosen, mode: 'daily' });
    }
    // weekly-sun / weekly-thu: the most recent prior report issued on that weekday;
    // if history holds none yet, the most recent prior report (anchored:false) so the
    // chips still work while history builds.
    const onAnchor = candidates.filter((d) => isoWeekday(d) === anchorDay);
    const anchored = onAnchor.length > 0;
    const chosen = mostRecent(anchored ? onAnchor : candidates);
    return withDefinitionShift({ numbers: hist[chosen], baselineDate: chosen, mode: wantMode, anchored });
  }

  // Fallback: the single legacy snapshot. Its definition stamp lives NEXT TO the
  // numbers (SNAPSHOT_SEED.defVersion), so pass it explicitly — the shipped seed is
  // already stated in the new definition even though its asOf predates the change.
  if (isPlainObject(legacySnapshot) && isPlainObject(legacySnapshot.numbers)) {
    return withDefinitionShift({
      numbers: legacySnapshot.numbers,
      baselineDate: legacySnapshot.asOf != null ? legacySnapshot.asOf : null,
      mode: 'legacy',
    }, legacySnapshot.defVersion);
  }
  return null;
}
