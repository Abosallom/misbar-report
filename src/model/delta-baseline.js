// model/delta-baseline.js — rolling per-date history of report numbers plus the
// baseline picker that drives the exec-summary delta chips. PURE functions only:
// no I/O, no Date.now(); all date math is on ISO 'yyyy-mm-dd' strings so the same
// inputs always yield the same output (golden-testable).
//
// The exec chips compare the current run against a chosen previous report. The
// window is user-selectable in Settings (reportOptions.deltaMode):
//   • 'daily'  → the most recent stored report STRICTLY BEFORE the report date.
//   • 'weekly' → the stored report closest to (reportDate − 7 days), among dates
//                strictly before the report date; ties resolve to the OLDER date.
// When history has no qualifying entry we fall back to the single legacy snapshot
// (settings.snapshot {asOf, numbers}); with neither, there is no baseline (null).

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * pickDeltaBaseline({history, legacySnapshot, reportDate, mode}) → the baseline
 * numbers the delta chips compare against, or null.
 *   mode 'daily'  → most recent history date STRICTLY BEFORE reportDate.
 *   mode 'weekly' → history date closest to (reportDate − 7 days) among dates
 *                   strictly before reportDate; ties → the OLDER date.
 * Fallback (no qualifying history entry): legacySnapshot {asOf, numbers} →
 *   { numbers, baselineDate: asOf, mode: 'legacy' }. Null when that is absent too.
 * @param {{history?:Object<string,Object<string,number>>,
 *          legacySnapshot?:{asOf?:string, numbers?:Object<string,number>},
 *          reportDate?:string, mode?:('daily'|'weekly')}} args
 * @returns {{numbers:Object<string,number>, baselineDate:(string|null), mode:string}|null}
 */
export function pickDeltaBaseline({ history, legacySnapshot, reportDate, mode } = {}) {
  const hist = isPlainObject(history) ? history : {};
  const wantWeekly = mode === 'weekly';

  // Candidate dates: valid ISO keys strictly before the (valid ISO) report date.
  const candidates = isIso(reportDate)
    ? Object.keys(hist).filter((d) => isIso(d) && isPlainObject(hist[d]) && d < reportDate)
    : [];

  if (candidates.length > 0) {
    let chosen;
    if (wantWeekly) {
      const targetDays = isoToDays(reportDate) - 7;
      chosen = candidates.reduce((best, d) => {
        if (best == null) return d;
        const dd = Math.abs(isoToDays(d) - targetDays);
        const bd = Math.abs(isoToDays(best) - targetDays);
        if (dd < bd) return d;
        if (dd > bd) return best;
        return d < best ? d : best; // tie → older (smaller ISO date)
      }, null);
    } else {
      // daily (default): the largest (most recent) date strictly before reportDate
      chosen = candidates.reduce((best, d) => (best == null || d > best ? d : best), null);
    }
    return { numbers: hist[chosen], baselineDate: chosen, mode: wantWeekly ? 'weekly' : 'daily' };
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
