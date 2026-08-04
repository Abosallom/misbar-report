// model/delta-baseline.js — rolling per-date history of report numbers plus the
// baseline picker that drives the exec-summary delta chips. PURE functions only:
// no I/O, no Date.now(); all date math is on ISO 'yyyy-mm-dd' strings so the same
// inputs always yield the same output (golden-testable).
//
// The exec chips compare the current run against a chosen previous report. The
// window is user-selectable in Settings (reportOptions.deltaMode) and has exactly
// TWO values — the Saudi work week is Sun–Thu:
//   • 'daily' → the most recent stored report STRICTLY BEFORE the report date.
//   • 'week'  → WEEK-TO-DATE (the DEFAULT since 2026-08-04, user request): every
//               report inside one Sun–Thu week compares against the SAME baseline —
//               the most recent stored report strictly BEFORE that week's Sunday. So
//               the chips ACCUMULATE through the week and Thursday's deck (the last
//               one sent) shows the whole week's movement. The week's own Sunday
//               report is NOT a candidate: using it would drop Sunday's own movement
//               out of every later report in the week.
// Fri/Sat report dates need no special case — weekStartDay() maps them to the Sunday
// of the week that just ended, which is the week their numbers belong to.
// The weekday-anchored 'weekly-sun' / 'weekly-thu' modes of the previous round are
// RETIRED: they, and the older bare 'weekly', are aliases of 'week' now (see
// DELTA_MODE_ALIASES) so no stored setting is orphaned. Any unknown value falls back
// to DEFAULT_DELTA_MODE.
// While history is still filling up, 'week' with no pre-week entry uses the most
// recent prior report and says so via anchored:false (the flag predates this change
// — build-spec downgrades to the daily legend wording on it and both stampers
// forward it). When history has no qualifying entry at all we fall back to the single
// legacy snapshot (settings.snapshot {asOf, numbers}); with neither, no baseline (null).

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
 * NOTE it falls back to the DEFAULT, not to 'daily'. This is the picker's own
 * entry point and it runs on paths with no backfill behind them (the ephemeral
 * in-memory doc, a hand-built model in a test), so falling back to 'daily' would
 * silently re-daily-ify a user who never asked for daily.
 * @param {*} mode
 * @returns {'daily'|'week'}
 */
export function normalizeDeltaMode(mode) {
  return canonicalDeltaMode(mode) || DEFAULT_DELTA_MODE;
}

/**
 * True when a stored/user mode means the week-to-date comparison. Consumers MUST use
 * this rather than a startsWith('weekly') test: the canonical value is 'week', which
 * FAILS that prefix check, so every disclosure hanging off it (the review banner, the
 * week-window explainer) would silently vanish while the deck kept comparing weekly.
 *
 * It answers for the EFFECTIVE mode (normalizeDeltaMode), not just the canonical one,
 * so it can never disagree with the baseline the picker actually chose: an
 * unrecognized stored value resolves to DEFAULT_DELTA_MODE ('week') in both places.
 * A UI that says "daily" over week-to-date numbers is the bug this guards against.
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

/**
 * Whole-UTC-day count of the SUNDAY that opens the Sun–Thu work week containing
 * `iso` — i.e. the day count of the date itself minus its weekday index (Sunday = 0).
 * Reuses the two primitives above so there is exactly one definition of "what day is
 * this" in the module.
 * A Sunday maps to ITSELF. Friday and Saturday map back to the Sunday of the week that
 * just ended, which is the week their numbers belong to — that is why Fri/Sat report
 * dates need no special case anywhere in the picker.
 * @param {string} iso - 'yyyy-mm-dd'
 * @returns {number} whole-UTC-day count of that week's Sunday
 */
function weekStartDay(iso) {
  return isoToDays(iso) - isoWeekday(iso);
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
 *   mode 'daily' → the most recent such history date.
 *   mode 'week'  → WEEK-TO-DATE: the most recent history date strictly BEFORE the
 *                  Sunday that opens reportDate's work week (weekStartDay). Every
 *                  report Sun→Thu therefore shares ONE baseline and the chips
 *                  accumulate across the week; Fri/Sat fall in the week just ended.
 *                  With no pre-week entry yet (history still filling up) it degrades
 *                  to the most recent prior report and returns anchored:false;
 *                  anchored:true when a genuine pre-week baseline was found.
 *   'weekly' / 'weekly-sun' / 'weekly-thu' are accepted as retired aliases of 'week';
 *   anything unknown → DEFAULT_DELTA_MODE.
 * `anchored` is present for 'week' only. Fallback (no qualifying history
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
 *          reportDate?:string,
 *          mode?:('daily'|'week'|'weekly'|'weekly-sun'|'weekly-thu')}} args
 * @returns {{numbers:Object<string,number>, baselineDate:(string|null),
 *            mode:('daily'|'week'|'legacy'),
 *            anchored?:boolean, definitionShift?:true}|null}
 */
export function pickDeltaBaseline({ history, legacySnapshot, reportDate, mode } = {}) {
  const hist = isPlainObject(history) ? history : {};
  const wantMode = normalizeDeltaMode(mode);

  // Candidate dates: valid ISO keys strictly before the (valid ISO) report date.
  const candidates = isIso(reportDate)
    ? Object.keys(hist).filter((d) => isIso(d) && isPlainObject(hist[d]) && d < reportDate)
    : [];

  if (candidates.length > 0) {
    if (wantMode === 'daily') {
      // daily: the most recent date strictly before reportDate.
      const chosen = mostRecent(candidates);
      return withDefinitionShift({ numbers: hist[chosen], baselineDate: chosen, mode: 'daily' });
    }
    // week (default): ONE baseline for the whole Sun–Thu week — the most recent report
    // strictly BEFORE this week's Sunday, so Sun/Mon/Tue/Wed/Thu all measure from the
    // same point and Thursday's deck carries the full week's movement.
    //
    // The comparison is `<` against weekStart, NOT `<=`: the week's own Sunday report is
    // deliberately EXCLUDED. Including it would make Monday…Thursday measure from Sunday
    // evening, i.e. Sunday's own movement would be missing from every later report in
    // the week — the exact accumulation the user asked for, lost.
    // Note the day-count comparison (not a string compare): weekStart is a day count,
    // and its ISO rendering is not needed anywhere.
    const weekStart = weekStartDay(reportDate);
    const preWeek = candidates.filter((d) => isoToDays(d) < weekStart);
    const anchored = preWeek.length > 0;
    // Nothing before this week's Sunday yet (a fresh install, or the first week of
    // history): degrade to the most recent prior report so the chips still work, and
    // SAY SO with anchored:false — build-spec then prints the daily legend wording,
    // which is what that baseline actually is, and the review banner discloses it.
    const chosen = mostRecent(anchored ? preWeek : candidates);
    return withDefinitionShift({ numbers: hist[chosen], baselineDate: chosen, mode: 'week', anchored });
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
