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

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

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
 * @param {{history?:Object<string,Object<string,number>>,
 *          legacySnapshot?:{asOf?:string, numbers?:Object<string,number>},
 *          reportDate?:string, mode?:('daily'|'weekly-sun'|'weekly-thu'|'weekly')}} args
 * @returns {{numbers:Object<string,number>, baselineDate:(string|null), mode:string,
 *            anchored?:boolean}|null}
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
      return { numbers: hist[chosen], baselineDate: chosen, mode: 'daily' };
    }
    // weekly-sun / weekly-thu: the most recent prior report issued on that weekday;
    // if history holds none yet, the most recent prior report (anchored:false) so the
    // chips still work while history builds.
    const onAnchor = candidates.filter((d) => isoWeekday(d) === anchorDay);
    const anchored = onAnchor.length > 0;
    const chosen = mostRecent(anchored ? onAnchor : candidates);
    return { numbers: hist[chosen], baselineDate: chosen, mode: wantMode, anchored };
  }

  // Fallback: the single legacy snapshot.
  if (isPlainObject(legacySnapshot) && isPlainObject(legacySnapshot.numbers)) {
    return {
      numbers: legacySnapshot.numbers,
      baselineDate: legacySnapshot.asOf != null ? legacySnapshot.asOf : null,
      mode: 'legacy',
    };
  }
  return null;
}
