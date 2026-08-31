// model/delta-window.js — THE WEEK'S ACTIVITY behind the small green delta chips.
// PURE functions only: no I/O, no Date.now(), no stored history. Same rows + same
// report date ⇒ same answer, always (golden-testable, and IDEMPOTENT by construction).
//
// THE INVARIANT (Talal, 2026-08-05) — repeat it before touching anything here:
//   The BIG numbers on slides 2/3/4 — the exec KPI cards, the journey stage counts,
//   the monthly table, the compliance table — REMAIN CUMULATIVE TOTALS, untouched,
//   exactly as the deck has always shipped them. ONLY the small green delta chips
//   (▲ +N) change meaning: they become the WEEK'S ACTIVITY, i.e. the events dated
//   Sunday..report-day, counted from the CSV's OWN date columns.
//   (Due-derived values — onTime / late / turnaround-expected — move only because of
//   the weekend + late rule changes of this same round, NEVER because of the chips.)
//
// WHAT DIED HERE. Until 2026-08-05 the chips were a DIFF AGAINST A STORED REPORT
// (model/delta-baseline.js pickDeltaBaseline): "current numbers minus the numbers we
// published last Wednesday". That answered a question nobody asked — it depended on
// whether a report happened to have been generated, it drifted when history was
// missing (the anchored:false degrade), it needed a definition-version disclosure
// because old stored numbers spoke an older `completed`, and it was NOT idempotent
// in spirit: two runs on one day compared against different baselines. The chips now
// come from the DATA: a window on the calendar, and the rows' own timestamps.
//
// THE RULE — TWO KEY CLASSES, TWO MEANINGS (round 4, 2026-08-06). Both are read off the
// same pair of as-of states, but they are NOT the same arithmetic:
//   • CUMULATIVE / EVENT keys (total, collected, dispatched, received, completed,
//     rejected) — monotone counters of dated milestones, so
//         deltas[key] = asof(windowEnd)[key] − asof(dayBefore(windowStart))[key]
//     IS the in-window event count: "3 orders dated this week" ⇒ deltas.total === 3.
//   • QUEUE keys (asof.js QUEUE_KEYS: awaitingDispatch, shippedNotReceived,
//     awaitingResults, lateNoResult) — depths, not counters. Their DIFFERENCE was a
//     signed net change, which answered a question the chip never asked: a week in which
//     10 samples shipped and 12 were received rendered '−2' beside a queue that had in
//     fact taken in 10 new members. They are now SURVIVING ENTRANTS —
//         deltas[key] = asof(windowEnd, sinceIso = windowStart)[key]
//     read DIRECTLY off the gated pass — i.e. rows that ENTERED the state inside the
//     window and are STILL in it at the end. That count is a subset of the end depth, so
//     it is ALWAYS ≥ 0 (see asof.js's monotone-exit argument), and it can be POSITIVE
//     while the queue's own big cumulative number FELL. That divergence is the point, not
//     a defect: the card is a depth, the chip is the week's intake that is still waiting.
// WHY ONE gated end-pass serves both classes: asof.js's sinceIso gate touches ONLY the
// four queue increments, leaving the six event counters (and every approx flag) exactly
// as the ungated call produces them — so the subtraction above is unaffected by it. The
// "before" pass is PLAIN (never gated): its queue depths are simply unread.
//
// THE WINDOW.
//   mode 'week' (the DEFAULT) → [Sunday-of-week(reportDate), reportDate].
//        The Saudi work week is Sun–Thu. weekStartDay() maps a Friday or Saturday
//        report date back to the Sunday of the week that JUST ENDED, so a weekend
//        report folds into the week its numbers belong to — no special case anywhere.
//   mode 'daily' → [reportDate, reportDate]: one single day.
// The subtraction is anchored at the day BEFORE the window start, because as-of is
// INCLUSIVE ("everything dated on or before this day"): to keep Sunday's own events
// inside the window we must measure from Saturday's close.
//
// IDEMPOTENCY. stampWindowDeltas() recomputes kpi.deltas from scratch and overwrites;
// it never reads its own previous output, never accumulates. screen-generate re-runs
// it on the very model object screen-review already stamped, and pipeline re-runs it
// on its own — under the old baseline stamper that re-run was a live bug class (the
// two copies could pick different baselines and the deck silently won). A pure
// function of (rows, reportDate, mode) cannot disagree with itself.

import { computeNumbersAsOf, NUMBER_KEYS, QUEUE_KEYS } from '../engine/asof.js?v=v2026-08-31.2';
// The Sun-based calendar math has ONE owner — model/delta-baseline.js — and this module
// imports it rather than re-deriving it. A second copy of "which Sunday opens this week"
// is exactly how the review banner, the deck legend and the history panel drift apart.
// Re-exported below so a consumer can reach the math through either module.
import {
  isoToDays, isoWeekday, weekStartDay, normalizeDeltaMode,
} from './delta-baseline.js?v=v2026-08-31.2';

export { isoToDays, isoWeekday, weekStartDay };

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// The queue key class as a SET — asof.js owns the list, this module only needs the O(1)
// "which arithmetic does this key take?" lookup inside the per-key loop below.
const QUEUE_KEY_SET = new Set(QUEUE_KEYS);

/** True for a well-formed 'yyyy-mm-dd' string. */
function isIso(s) {
  return typeof s === 'string' && ISO_RE.test(s);
}

/**
 * 'yyyy-mm-dd' for a whole-UTC-day count — the inverse of isoToDays. Arithmetic on the
 * UTC epoch, never the host zone (the app runs at +03 but must not depend on it).
 * @param {number} days
 * @returns {string}
 */
export function isoFromDays(days) {
  const d = new Date(days * 86400000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * The [start, end] activity window for a report date, per mode. PURE, and the single
 * definition of the window — computeWindowDeltas, the review banner and the deck legend
 * all read the object this produces rather than re-deriving dates of their own.
 * @param {string} reportDate  'yyyy-mm-dd'
 * @param {*} [mode]  raw stored/user mode; normalized through delta-baseline
 * @returns {{start:string, end:string, mode:('daily'|'week')}}
 */
export function windowFor(reportDate, mode) {
  if (!isIso(reportDate)) {
    throw new Error('delta-window: reportDate (YYYY-MM-DD) is required');
  }
  const m = normalizeDeltaMode(mode);
  // 'week' → back to this week's Sunday (a Sunday maps to itself; Fri/Sat map back into
  // the week that just ended). 'daily' → the report date is both ends.
  const start = m === 'week' ? isoFromDays(weekStartDay(reportDate)) : reportDate;
  return { start, end: reportDate, mode: m };
}

/**
 * computeWindowDeltas({rows, tatTests, reportDate, mode, opts}) → the chips.
 *
 *   { deltas, window: {start, end}, mode, approx }
 *
 * deltas holds all 10 NUMBER_KEYS: the six CUMULATIVE keys as signed in-window event
 * counts, the four QUEUE_KEYS as surviving-entrant counts (≥ 0 by construction — read
 * the header's two-class rule before trying to reconcile one against its card).
 * `approx` is the UNION of the two as-of
 * approximation maps and is present only when non-empty; it bubbles asof.js's own
 * caveats, of which one is operator-visible: `rejected` (and therefore `completed`)
 * when a counted rejected row had to be dated by the last milestone it reached, because
 * a rejection carries no timestamp of its own. The review banner discloses exactly that.
 *
 * Throws on a missing/!ISO reportDate — the stampers catch and degrade to the engine's
 * own deltas rather than shipping a window they cannot describe.
 * @param {Object} args
 * @param {import('../contracts.js').OrderRow[]} args.rows
 * @param {Object<string,number>} args.tatTests  test name → business days
 * @param {string} args.reportDate  'yyyy-mm-dd'
 * @param {*} [args.mode]  'daily' | 'week' (or a retired alias); unknown → default
 * @param {Object} [args.opts]  forwarded to computeNumbersAsOf (TAT resolution opts)
 * @returns {{deltas:Object<string,number>, window:{start:string,end:string},
 *            mode:('daily'|'week'), approx?:Object<string,boolean>}}
 */
export function computeWindowDeltas({ rows, tatTests, reportDate, mode, opts = {} } = {}) {
  const w = windowFor(reportDate, mode);
  // As-of is INCLUSIVE, so the "before" anchor is the day BEFORE the window opens —
  // otherwise Sunday's own events would be subtracted right back out of the week.
  const beforeIso = isoFromDays(isoToDays(w.start) - 1);
  const rowsArr = Array.isArray(rows) ? rows : [];

  // TWO passes, and only two — the gate makes the second do double duty (header rule).
  // `before` is PLAIN: it is the subtrahend for the six cumulative keys, and its own queue
  // depths are deliberately unread. `end` is GATED at the window start, so its six
  // cumulative counters are still the full as-of totals (the gate cannot reach them) while
  // its four queue counters are already the window's surviving entrants.
  const before = computeNumbersAsOf({ rows: rowsArr, tatTests, asOfIso: beforeIso, opts });
  const end = computeNumbersAsOf({
    rows: rowsArr, tatTests, asOfIso: w.end, sinceIso: w.start, opts,
  });

  const deltas = {};
  for (const k of NUMBER_KEYS) {
    const b = Number(end.numbers[k]);
    if (QUEUE_KEY_SET.has(k)) {
      // Queue key: the gated end value IS the answer — an entrant COUNT, not a difference.
      // Subtracting `before` here would double-count the drain and could go negative again.
      deltas[k] = Number.isFinite(b) ? b : 0;
      continue;
    }
    const a = Number(before.numbers[k]);
    deltas[k] = (Number.isFinite(a) && Number.isFinite(b)) ? b - a : 0;
  }

  // A caveat that applies at EITHER endpoint applies to the difference between them.
  const approx = { ...(before.approx || {}), ...(end.approx || {}) };
  const out = { deltas, window: { start: w.start, end: w.end }, mode: w.mode };
  if (Object.keys(approx).length > 0) out.approx = approx;
  return out;
}

/**
 * stampWindowDeltas(model, {rows, tatTests, settings, mode, opts}) — the ONE stamper.
 * Writes model.kpi.deltas — NOT clamped here: it stores whatever computeWindowDeltas
 * produced, which is a signed event count for the six cumulative keys and an entrant
 * count (≥ 0) for the four queue keys. Suppressing non-positive values is a RENDERING
 * decision and belongs to the surfaces, so that the deck, the review banner and any
 * future reader all decide from the same unedited numbers. It also writes
 * model.deltaWindow {start, end, mode, approx?}, which REPLACES the retired
 * model.deltaBaseline everywhere (build-spec's legend, the review banner).
 *
 * Mode resolution: an explicit `mode` wins, else the settings-like bag's
 * reportOptions.deltaMode, else DEFAULT_DELTA_MODE — all through normalizeDeltaMode,
 * so an unrecognized stored value can never re-daily-ify a user who never asked for it.
 *
 * DEGRADES, never throws: with no rows (a mock-data preview, an unparsed CSV) or an
 * unusable report date it leaves kpi.deltas exactly as the engine produced them and
 * returns null. Chips the operator cannot trust are worse than the engine's own.
 *
 * PURE + IDEMPOTENT: it recomputes from rows and overwrites. Call it twice on one model
 * and the second call produces a deep-equal result — screen-generate does exactly that
 * on the model screen-review already stamped.
 * @param {Object} model  the ReportModel being stamped (mutated in place)
 * @param {{rows?:Array, tatTests?:Object, settings?:Object, mode?:*, opts?:Object}} [args]
 * @returns {{start:string,end:string,mode:string,approx?:Object}|null} the stamped window
 */
export function stampWindowDeltas(model, { rows, tatTests, settings, mode, opts } = {}) {
  if (!model || !model.kpi) return null;
  const rowsArr = Array.isArray(rows) ? rows : [];
  if (rowsArr.length === 0) return null; // no data to date events by → keep engine deltas
  let wantMode = mode;
  if (wantMode === undefined || wantMode === null || wantMode === '') {
    const ro = (settings && settings.reportOptions) || (model.reportOptions) || {};
    wantMode = ro.deltaMode;
  }
  let res = null;
  try {
    // ROW SCOPING MUST MATCH THE BIG NUMBERS (review finding 2026-08-05): the engine
    // drops 'No Match' rows before aggregation when reportOptions.excludeNoTat is on,
    // so the chips must speak the same row set or `card − chip` stops reconciling at
    // the window anchor. Derive the flag from the same options doc the engine reads
    // whenever the caller did not pass opts explicitly.
    let windowOpts = opts;
    if (!windowOpts) {
      const ro = (settings && settings.reportOptions) || model.reportOptions || {};
      windowOpts = { excludeNoTat: !!ro.excludeNoTat };
    }
    res = computeWindowDeltas({
      rows: rowsArr,
      tatTests: tatTests || {},
      reportDate: model.reportDate,
      mode: wantMode,
      opts: windowOpts,
    });
  } catch (e) {
    console.warn('[delta-window] computeWindowDeltas failed; keeping engine deltas', e);
    return null;
  }
  model.kpi.deltas = res.deltas;
  const stamped = { start: res.window.start, end: res.window.end, mode: res.mode };
  if (res.approx) stamped.approx = res.approx;
  model.deltaWindow = stamped;
  // The retired stamp must not linger on a model object that survives a screen change:
  // nothing reads it any more, but a stale deltaBaseline on the same model is a trap for
  // the next reader ("which one is live?"). Deleting it makes the replacement total.
  if ('deltaBaseline' in model) delete model.deltaBaseline;
  return stamped;
}

export default computeWindowDeltas;
