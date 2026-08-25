// ui/screen-review.js — review/edit report content with a live slide preview (Track E).
import { STR, todayISO, formatDateAr } from '../i18n/ar.js?v=v2026-08-25.1';
import { el, editableTable, textareaField, toast } from './components.js?v=v2026-08-25.1';
import { buildMockEngineOutput, buildMockTracker } from './screen-upload.js?v=v2026-08-25.1';
import { autoDraft, splitTaskLists } from '../model/drafts.js?v=v2026-08-25.1';
import { buildHistoryPanel } from './history-table.js?v=v2026-08-25.1';
import {
  normalizeDeltaMode, isWeekDeltaMode, DEFAULT_DELTA_MODE,
} from '../model/delta-baseline.js?v=v2026-08-25.1';
// Same module instance drafts.js already imports (identical specifier) — the grace
// re-check below MUST use task-lifecycle's own identity/status vocabulary, never a
// second local copy of it. Static, not guarded: drafts.js (imported above) already
// depends on this module, so there is no new failure mode.
import {
  CLOSED as CLOSED_STATUS, LIST_EXTERNAL, LIST_INTERNAL, taskKey,
} from '../model/task-lifecycle.js?v=v2026-08-25.1';

/* small local module helpers (kept local to avoid cross-screen coupling) */
async function tryImport(path) { try { return await import(path); } catch { return null; } }
function pickFn(mod, names) {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function') return mod[n];
  if (typeof mod.default === 'function') return mod.default;
  return null;
}
// The task split (which list a row belongs to, and whether a مغلق row still gets its
// one grace appearance) is owned entirely by model/drafts.js splitTaskLists — this
// screen no longer keeps a local copy of that rule. isClosed below is only a display
// helper: it tints closed rows in the editable table.
const isClosed = (t) => /مغلق|closed|منجز|مكتمل/i.test((t && (t.status || '')) || '');
// The EXACT predicate splitTaskLists and recordShownTasks use (status === 'مغلق').
// Membership decisions must never ride on the looser display regex above: a row whose
// status reads 'مكتمل' is not "closed" to the lifecycle rule, so treating it as closed
// here would drop a row the deck is supposed to carry.
const isClosedStatus = (t) => !!t && typeof t === 'object' && t.status === CLOSED_STATUS;
const linesToArr = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

/* THE DELTA CHIPS (2026-08-05, Talal). THE INVARIANT first: the BIG numbers on slides
 * 2/3/4 — exec KPI cards, journey stage counts, monthly table, compliance table — REMAIN
 * CUMULATIVE TOTALS, untouched. ONLY the small green chips changed meaning: they are now
 * THE WEEK'S ACTIVITY, the events dated Sunday..report-day, counted from the CSV's own
 * date columns. Nothing else on those slides moves.
 *
 * So this screen no longer diffs the run against a STORED previous report. The local
 * currentNumbersOf + applyDeltaBaseline pair (kpi numbers minus pickDeltaBaseline's
 * numbers) is DELETED; model/delta-window.js stampWindowDeltas is the one stamper, and
 * it is a PURE function of (rows, reportDate, mode) — so the re-runs below (report-date
 * change, mode switch, preview rebuild) and screen-generate's re-run on this very model
 * object all produce the identical stamp. That re-run disagreement was a live bug class
 * under the baseline stamper; it cannot exist against a pure function.
 * model.deltaWindow {start, end, mode, approx?} REPLACES model.deltaBaseline.
 *
 * The delta MODE enum is still OWNED by model/delta-baseline.js: normalizeDeltaMode,
 * isWeekDeltaMode and DEFAULT_DELTA_MODE are imported, never re-implemented here, so the
 * review pills, the settings radio (screen-settings.js) and the persisted/validated store
 * value (store.js — same module) can never disagree about the enum. There are exactly TWO
 * modes: 'daily' and 'week' (the default). What changed is what they SELECT — the size of
 * the activity WINDOW, not which stored report to compare against. The local
 *     const isWeeklyMode = (m) => normalizeDeltaMode(m).startsWith('weekly');
 * stays DELETED: 'week' does not start with 'weekly', so it returned false for the one
 * mode that needs the week wording. Guard the enum with isWeekDeltaMode, never a prefix. */

const STATUS_OPTIONS = [
  STR.review.status.open, STR.review.status.ongoing,
  STR.review.status.late, STR.review.status.inProgress, STR.review.status.closed,
];

/* All-on presentation defaults for a doc that predates reportOptions. slides keys
 * drive the middle-slide toggles; kpiCards mirror the deltas keys; labels overrides
 * the DEFAULT_LABELS registry (empty = built-in text). See Settings.reportOptions. */
function defaultReportOptions() {
  return {
    excludeNoTat: false,
    slides: { execFunnel: true, monthly: true, compliance: true, action: true },
    kpiCards: {
      total: true, awaitingDispatch: true, awaitingResults: true, completed: true,
      rejected: true, lateNoResult: true, shippedNotReceived: true,
      collected: true, dispatched: true, received: true,
    },
    labels: {},
    // Week-to-date is the DEFAULT (2026-08-04 user request) — taken from the model
    // module's constant, never re-typed, so a future default change lands here too.
    deltaMode: DEFAULT_DELTA_MODE,
    // R2: auto-download of the 4 files after a manual generation. TRUE = the shipped
    // behaviour, which is also what an ABSENT key must mean for every doc written
    // before this option existed (see reportOptionsFromSettings below).
    autoDownloadFiles: true,
  };
}

/* Deep-copy settings.reportOptions over the all-on defaults so every key exists. */
function reportOptionsFromSettings(settings) {
  const base = defaultReportOptions();
  const ro = settings && settings.reportOptions;
  if (!ro || typeof ro !== 'object') return base;
  return {
    excludeNoTat: ro.excludeNoTat != null ? !!ro.excludeNoTat : base.excludeNoTat,
    slides: { ...base.slides, ...(ro.slides || {}) },
    kpiCards: { ...base.kpiCards, ...(ro.kpiCards || {}) },
    labels: { ...(ro.labels || {}) },
    deltaMode: normalizeDeltaMode(ro.deltaMode),
    // Absent/non-boolean → the default (ON). Only an explicit false turns it off, so a
    // doc written before R2 keeps auto-downloading exactly as it always did.
    autoDownloadFiles: ro.autoDownloadFiles != null ? !!ro.autoDownloadFiles : base.autoDownloadFiles,
  };
}

// Editable KPI override registry. key === the ReportModel.overrides key build-spec
// reads as `override ?? computed`; get() pulls the computed value out of EngineOutput.
const OVERRIDE_FIELDS = [
  { key: 'total', get: (k) => k.totals && k.totals.total },
  { key: 'awaitingDispatch', get: (k) => k.buckets && k.buckets.awaitingDispatch },
  { key: 'awaitingResults', get: (k) => k.buckets && k.buckets.awaitingResults },
  { key: 'completed', get: (k) => k.buckets && k.buckets.completed },
  { key: 'rejected', get: (k) => k.buckets && k.buckets.rejected },
  { key: 'lateNoResult', get: (k) => k.buckets && k.buckets.lateNoResult },
  { key: 'shippedNotReceived', get: (k) => k.buckets && k.buckets.shippedNotReceived },
  { key: 'funnel.created', get: (k) => k.funnel && k.funnel.created },
  { key: 'funnel.collected', get: (k) => k.funnel && k.funnel.collected },
  { key: 'funnel.dispatched', get: (k) => k.funnel && k.funnel.dispatched },
  { key: 'funnel.received', get: (k) => k.funnel && k.funnel.received },
  { key: 'funnel.resulted', get: (k) => k.funnel && k.funnel.resulted },
  { key: 'cancelledNote', get: (k) => k.cancelledNote },
  { key: 'turnaround.actual', get: (k) => k.turnaround && k.turnaround.overallActual },
  { key: 'turnaround.expected', get: (k) => k.turnaround && k.turnaround.overallExpected },
];

const SLIDE_TOGGLES = [
  { key: 'execFunnel', label: STR.review.slideToggles.execFunnel },
  { key: 'monthly', label: STR.review.slideToggles.monthly },
  { key: 'compliance', label: STR.review.slideToggles.compliance },
  { key: 'action', label: STR.review.slideToggles.action },
  { key: 'challenges', label: STR.review.slideToggles.challenges },
];

const OV_INPUT_STYLE = 'flex:1;min-width:0;border:1px solid var(--border-dark);border-radius:6px;padding:6px 8px;min-height:36px;background:var(--white);color:var(--text);font-weight:700;text-align:right';
const OV_BADGE_STYLE = 'align-items:center;background:var(--warn-bg,#FEF3C7);color:var(--warn-text,#92400E);border:1px solid var(--amber);font-size:.68rem;font-weight:700;padding:1px 8px;border-radius:999px;white-space:nowrap';
const OV_RESET_STYLE = 'align-items:center;justify-content:center;flex:0 0 auto;width:32px;height:32px;border:1px solid var(--border-dark);background:var(--white);color:var(--slate-600);border-radius:6px;cursor:pointer;font-size:1rem;line-height:1';
const chipStyle = (on) => 'border-radius:999px;padding:6px 14px;font-weight:700;font-size:.85rem;cursor:pointer;min-height:36px;'
  + (on
    ? 'background:var(--navy);color:#fff;border:1px solid var(--navy);'
    : 'background:var(--white);color:var(--slate-500);border:1px solid var(--border-dark);text-decoration:line-through;opacity:.75;');

/* 'ما الجديد' banner — delta keys → Arabic chip label + colour intent. Keys mirror
 * EngineOutput.deltas; labels are tuned for the '+N {label}' phrasing — chips are
 * POSITIVE-ONLY and always signed '+' (see bannerChipVisible below), never '−N'.
 * Order = display order (headline & concerns first, flow counts last). */
const DELTA_META = [
  { key: 'completed', label: 'نتائج مكتملة', intent: 'good' },
  { key: 'total', label: 'طلبات جديدة', intent: 'info' },
  { key: 'rejected', label: 'مرفوضة', intent: 'bad' },
  { key: 'lateNoResult', label: 'متأخرة', intent: 'bad' },
  { key: 'awaitingResults', label: 'بانتظار النتائج', intent: 'wait' },
  { key: 'awaitingDispatch', label: 'بانتظار الإرسال', intent: 'wait' },
  { key: 'shippedNotReceived', label: 'أُرسلت ولم تُستلم', intent: 'wait' },
  { key: 'collected', label: 'تم سحبها', intent: 'info' },
  { key: 'dispatched', label: 'تم إرسالها', intent: 'info' },
  { key: 'received', label: 'تم استلامها', intent: 'info' },
];
const DELTA_CHIP_TONE = {
  good: 'background:var(--good-bg,#DCFCE7);color:var(--good-text,#166534);border:1px solid rgba(22,163,74,.35)',
  bad: 'background:var(--bad-bg,#FEE2E2);color:var(--bad-text,#991B1B);border:1px solid rgba(220,38,38,.35)',
  wait: 'background:var(--warn-bg,#FEF3C7);color:var(--warn-text,#92400E);border:1px solid rgba(245,158,11,.45)',
  info: 'background:var(--info-bg,#E0E7FF);color:var(--info-text,#1E3A8A);border:1px solid rgba(30,58,138,.30)',
};
const DELTA_CHIP_BASE = 'display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:6px 13px;font-weight:800;font-size:.82rem;line-height:1.3;white-space:nowrap';

/* THE BANNER CHIP FILTER (R4, 2026-08-10) — POSITIVE-ONLY, and that can never hide a
 * real drop, because after R4 no chip value IS a drop:
 *   • the four QUEUE keys (awaitingDispatch / shippedNotReceived / awaitingResults /
 *     lateNoResult) are SURVIVING ENTRANTS — rows that ENTERED the state inside the
 *     window and are STILL in it at window end (model/delta-window.js). That counts
 *     arrivals, not net queue movement, so it is >= 0 BY CONSTRUCTION and can read '+N'
 *     on a week whose queue shrank overall.
 *   • the six CUMULATIVE keys (total/collected/dispatched/received/completed/rejected)
 *     stay in-window event counts — asof(end) − asof(dayBefore(start)) over monotonic
 *     counters — so they are >= 0 too.
 *   • the engine's own deltas, the fallback that survives when rows are unavailable and
 *     nothing was stamped, are already clamped: Math.max(0, …) in engine/engine.js.
 * So '> 0' drops zeros and nothing else. It is ALSO the deck's rule — build-spec's
 * fmtDelta emits a chip only for n > 0 — so the operator's banner and the delivered
 * slide can never disagree about which chips exist. A '!== 0' filter here would have
 * manufactured exactly that disagreement the moment a value went negative.
 * EXPORTED so node tests can pin the predicate without a DOM. */
export const bannerChipVisible = (n) => Number.isFinite(n) && n > 0;

/* Delta-mode pills — MODULE SCOPE and EXPORTED so the registry test can pin them against
 * DELTA_MODES (model/delta-baseline.js) and against screen-settings' DELTA_MODE_OPTIONS:
 * one enum, three surfaces. Order = DELTA_MODES order (RTL → 'يومي' sits on the right).
 * Two pills only; the retired weekly-sun/weekly-thu pair is an ALIAS of 'week' now, so a
 * doc holding either lights up the أسبوعي pill instead of matching nothing. */
export const DELTA_MODE_PILLS = [
  {
    mode: 'daily',
    label: 'يومي — نشاط اليوم',
    title: 'الأحداث المؤرخة في يوم التقرير وحده',
  },
  {
    mode: 'week',
    label: 'أسبوعي — نشاط الأسبوع (الأحد–الخميس)',
    title: 'الأحداث المؤرخة من أحد هذا الأسبوع حتى تاريخ التقرير — والأرقام الكبيرة تبقى تراكمية',
  },
];

/* Banner wording — the SINGLE decision of how the run describes its ACTIVITY WINDOW.
 * The subject is the window (model.deltaWindow, stamped by model/delta-window.js), not a
 * baseline report: 'week' = the events dated from this week's Sunday through the report
 * date; 'daily' = the report day alone. The stamped window's own `mode` WINS over the
 * settings mode when present — it is what the numbers were actually computed over, and a
 * banner that names a different window than the chips count is the bug this ordering
 * prevents. With no stamp at all (rows unavailable → the engine's own deltas survive) it
 * falls back to the settings mode and drops the dates.
 *
 * It stays in step with build-spec's deltaLegendText, which reads the SAME
 * model.deltaWindow: the operator's banner and the audience's slide can never claim
 * different windows. Any future edit to the rule belongs HERE and there.
 *
 * MODULE SCOPE and EXPORTED (2026-08-04 review): as a closure inside render() this was
 * unreachable from node, so the operator-facing half of that contract had zero tests
 * while the deck half is pinned (test/delta-mode-registry.test.mjs). Explicit
 * (deltaMode, deltaWindow) parameters instead of reading `model` from the enclosing
 * scope — the call site passes model.reportOptions.deltaMode / model.deltaWindow.
 * Dates are rendered with the shared Arabic formatter (formatDateAr), same as the deck.
 * @param {*} deltaMode  reportOptions.deltaMode (fallback only)
 * @param {{start?:string,end?:string,mode?:string}} [deltaWindow]  model.deltaWindow
 * @returns {{heading:string, sub:string, empty:string}} */
export function deltaWording(deltaMode, deltaWindow) {
  const dw = deltaWindow && typeof deltaWindow === 'object' ? deltaWindow : null;
  // The stamped mode is authoritative; settings only answer when nothing was stamped.
  const week = dw && dw.mode ? dw.mode !== 'daily' : isWeekDeltaMode(deltaMode);
  const ar = (iso) => (iso ? (formatDateAr(iso) || String(iso)) : '');
  const startAr = ar(dw && dw.start);
  const endAr = ar(dw && dw.end);
  if (week) {
    const span = startAr && endAr ? ` (الأحد ${startAr} – ${endAr})` : ' (الأحد–الخميس)';
    return {
      heading: 'نشاط الأسبوع' + span,
      sub: 'الأحداث المؤرخة داخل هذه النافذة — الأرقام الكبيرة في الشرائح تبقى تراكمية',
      empty: 'لا نشاط خلال هذا الأسبوع' + span,
    };
  }
  const day = endAr ? ` (${endAr})` : '';
  return {
    heading: 'نشاط اليوم' + day,
    sub: 'الأحداث المؤرخة في يوم التقرير — الأرقام الكبيرة في الشرائح تبقى تراكمية',
    empty: 'لا نشاط في هذا اليوم' + day,
  };
}

/* Slide-pager (preview) chrome. */
const PAGER_BAR_STYLE = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap';
const PAGER_ARROW_STYLE = 'min-width:40px;height:40px;flex:0 0 auto;border:1px solid var(--border-dark);background:var(--white);color:var(--brand-ink);border-radius:8px;font-size:1.1rem;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center';
const PAGER_COUNT_STYLE = 'font-weight:700;color:var(--slate-600);font-size:.85rem;white-space:nowrap';
const pagerDotStyle = (on) => 'min-width:30px;height:30px;flex:0 0 auto;border-radius:6px;font-size:.78rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;'
  + (on ? 'background:var(--navy);color:#fff;border:1px solid var(--navy)'
        : 'background:var(--white);color:var(--slate-600);border:1px solid var(--border-dark)');

/* Assemble an editable ReportModel from engineOutput + tracker + settings.
 * Task splitting/panels go through model/drafts.js autoDraft — the CANONICAL
 * rule (internal = فئة التقرير 'لين'). A local regex here once diverged and
 * rendered the internal variant's task table empty with real tracker data. */
function buildDraftReportModel(state, store) {
  const kpi = state.engineOutput || buildMockEngineOutput(store.settings);
  const tracker = state.parsed.tracker || buildMockTracker();
  const reportDate = state.reportDate || todayISO();

  let d;
  try {
    // settings.taskLog carries the closed-task grace state (model/task-lifecycle.js).
    d = autoDraft(tracker, reportDate, { taskLog: store.settings && store.settings.taskLog });
  } catch (e) {
    console.warn('[review] autoDraft failed; falling back to local split', e);
    // The split is NOT re-derived here any more — splitTaskLists (model/drafts.js) is
    // its single owner, so this path cannot drift from the real rule again. Called
    // with an empty bag it degrades to non-closed rows only: strictly a subset of the
    // real answer (no grace rows), never the old "show every مغلق task" behaviour.
    const allTasks = tracker.tasks || [];
    const visible = allTasks.filter((t) => !t.hidden);
    d = {
      ...splitTaskLists(allTasks, {}),
      completedTasks: visible.filter(isClosed).map((t) => t.task),
      plannedTasks: visible.filter((t) => !isClosed(t) && t.category !== 'لين').map((t) => t.task),
      supportRequired: (tracker.challenges || []).map((c) => c.title).filter(Boolean),
    };
  }

  return {
    reportDate,
    kpi,
    panels: {
      supportRequired: d.supportRequired || [],
      completedTasks: d.completedTasks || [],
      plannedTasks: d.plannedTasks || [],
    },
    tasksCurrent: (d.tasksCurrent || []).map((t) => ({ ...t })),
    tasksInternal: (d.tasksInternal || []).map((t) => ({ ...t })),
    challenges: (tracker.challenges || []).map((c) => ({ ...c })),
    risks: (tracker.risks || []).map((r) => ({ ...r })),
    scorecard: (store.settings && store.settings.scorecard) || [],
    displayNames: (store.settings && store.settings.displayNames) || {},
    // Presentation options (persisted defaults) + per-run manual number overrides.
    reportOptions: reportOptionsFromSettings(store.settings),
    overrides: {},
  };
}

/* Report-date change → RE-DECIDE the مغلق rows (bug fix 2026-08-04).
 *
 * The task lists are drafted ONCE (render() guards with `if (!state.reportModel)`), but
 * the closed-row grace rule is a FUNCTION OF THE REPORT DATE: task-lifecycle's isGraceRow
 * admits a مغلق row only while its log entry is unspent (closedOn == null) or was spent on
 * THIS very date (closedOn === reportDate — what makes a same-day regeneration idempotent).
 * Stamping model.reportDate alone froze the grace decision at draft time while
 * recordRunSnapshot recorded the write under the NEW date, so a task closed and published
 * on D was published a SECOND time on D+1 (its closedOn === D entry grants nothing for
 * D+1) — and prune then dropped the entry, so nothing could ever catch it. Reachable from
 * the ordinary "kept-open PWA tab, next morning" and "drafting tomorrow's deck" flows. The
 * mirror case (moving onto a date that EQUALS a stored closedOn) withheld a row the deck
 * should carry.
 *
 * Reconcile, do NOT re-draft: the operator's edits (added rows, retyped text, flipped
 * statuses, deleted rows) must survive a date correction. Only a row the TRACKER reports as
 * مغلق can gain or lose a grace, so:
 *   - drop a مغلق row that is tracker-sourced-closed and the new date does not grant;
 *   - re-admit a مغلق row the new date grants that the OLD date did not (so a grace row the
 *     operator deliberately deleted is not resurrected by an unrelated date edit), placed in
 *     tracker order;
 *   - never touch non-closed rows — their membership is date-independent (isScheduled reads
 *     status/dueDate only) — nor any row the operator typed in by hand.
 * Which list a row belongs to stays drafts.js's business: splitTaskLists is called for both
 * dates and this function only compares its answers. panels.completedTasks/plannedTasks
 * carry the other date-anchored windows but are NOT rendered (build-spec reads only
 * panels.supportRequired), so they are deliberately left alone.
 *
 * @returns {boolean} true when a list actually changed (caller remounts those tables).
 */
function reconcileGraceRows(model, state, store, prevDate) {
  const tracker = (state.parsed && state.parsed.tracker) || buildMockTracker();
  const rows = (tracker && tracker.tasks) || [];
  const taskLog = store.settings && store.settings.taskLog;
  let fresh; let before;
  try {
    fresh = splitTaskLists(rows, { taskLog, reportDate: state.reportDate });
    before = splitTaskLists(rows, { taskLog, reportDate: prevDate });
  } catch (e) {
    console.warn('[review] grace re-check failed; task lists left as drafted', e);
    return false;
  }
  // Keys of every tracker row that is مغلق, registered under BOTH list ids: this set only
  // answers "did this row arrive closed from the tracker?" (i.e. it can only be here via
  // the grace rule), so it must not encode the category split. The list-aware half of the
  // test is `granted`, which comes straight from splitTaskLists.
  const trackerClosed = new Set();
  for (const t of rows) {
    if (!isClosedStatus(t)) continue;
    trackerClosed.add(taskKey(LIST_EXTERNAL, t));
    trackerClosed.add(taskKey(LIST_INTERNAL, t));
  }
  let changed = false;
  for (const [field, listId] of [['tasksCurrent', LIST_EXTERNAL], ['tasksInternal', LIST_INTERNAL]]) {
    const cur = Array.isArray(model[field]) ? model[field] : [];
    const freshRows = Array.isArray(fresh[field]) ? fresh[field] : [];
    const k = (t) => taskKey(listId, t);
    const granted = new Set(freshRows.filter(isClosedStatus).map(k));
    const grantedBefore = new Set((before[field] || []).filter(isClosedStatus).map(k));
    // 1. Removals — a spent grace must not ride along under the new date.
    const out = cur.filter((r) => !(isClosedStatus(r) && trackerClosed.has(k(r)) && !granted.has(k(r))));
    let touched = out.length !== cur.length;
    // 2. Additions — newly granted only, spliced in after the nearest preceding fresh row
    //    that is still on the list so tracker order survives.
    const present = new Set(out.map(k));
    for (let i = 0; i < freshRows.length; i++) {
      const r = freshRows[i];
      const key = k(r);
      if (!isClosedStatus(r) || present.has(key) || grantedBefore.has(key)) continue;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) {
        const prevKey = k(freshRows[j]);
        const idx = out.findIndex((x) => k(x) === prevKey);
        if (idx >= 0) { at = idx + 1; break; }
      }
      out.splice(at, 0, { ...r });
      present.add(key);
      touched = true;
    }
    if (touched) { model[field] = out; changed = true; }
  }
  return changed;
}

export async function render(container, ctx) {
  const { state, store, navigate } = ctx;

  if (!state.reportDate) state.reportDate = todayISO();
  if (!state.reportModel) state.reportModel = buildDraftReportModel(state, store);
  const model = state.reportModel;
  { // settings may have been edited since the model was drafted — re-source them
    const s = store.settings || {};
    if (s.scorecard) model.scorecard = s.scorecard;
    if (s.displayNames) model.displayNames = s.displayNames;
  }
  // reportOptions (slides / kpiCards / excludeNoTat / labels / deltaMode) lives in the
  // shared settings doc and BOTH screens write it — the Settings checkboxes autosave and
  // this screen's chips/pills call persistReportOptions. So re-source the WHOLE thing from
  // settings on every render, not just deltaMode: the model is drafted once (and only
  // dropped on a new upload), so a cached copy goes stale against any Settings edit made
  // afterwards — the preview/generate would keep the old slide set AND persistReportOptions
  // would write the stale copy back over the fresher settings. This also backfills a model
  // drafted by older code (before reportOptions existed) and guarantees .labels exists.
  model.reportOptions = reportOptionsFromSettings(store.settings);
  if (!model.overrides) model.overrides = {};
  // THE WEEK'S ACTIVITY chips (2026-08-05). model/delta-window.js recomputes
  // model.kpi.deltas from the ROWS' OWN DATES over the window [Sunday, reportDate]
  // ('week', default) or [reportDate, reportDate] ('daily') and stamps
  // model.deltaWindow for the banner + the deck legend. THE INVARIANT: only these
  // chips changed meaning — the big cumulative numbers on slides 2/3/4 are untouched.
  // Guarded import, exactly as the retired picker was: a build without the module
  // degrades to the engine's own deltas instead of throwing. Re-run below on a
  // report-date change and on a mode switch; being PURE, every re-run agrees.
  const dwMod = await tryImport('../model/delta-window.js?v=v2026-08-25.1');
  const stampWindow = dwMod && dwMod.stampWindowDeltas;
  // The chips need the parsed CSV rows: with no upload in this session (mock preview)
  // stampWindowDeltas leaves the engine's deltas alone and stamps no window, and the
  // banner/legend fall back to their undated wording.
  const stampDeltas = () => {
    if (typeof stampWindow !== 'function') return;
    stampWindow(model, {
      rows: (state.parsed && state.parsed.orders) || null,
      tatTests: (store.settings && store.settings.tatLookup) || {},
      mode: normalizeDeltaMode(model.reportOptions && model.reportOptions.deltaMode),
    });
  };
  stampDeltas();
  const kpi = model.kpi;

  // Persist reportOptions (slides + labels + deltaMode) to settings as the new defaults.
  // store.settings is a fresh clone each read → load, MERGE, save. The merge is
  // deliberate: this screen only knows the reportOptions keys it renders, so a straight
  // overwrite would drop any slide/card key (or future top-level key) the settings doc
  // carries but this screen never modelled. labels is a full replace — deleting a label
  // override must actually delete it. Overrides are per-run and are NEVER written here.
  const persistReportOptions = () => {
    try {
      const doc = store.loadSettings();
      const cur = (doc.reportOptions && typeof doc.reportOptions === 'object') ? doc.reportOptions : {};
      const ro = model.reportOptions;
      doc.reportOptions = {
        ...cur,
        excludeNoTat: !!ro.excludeNoTat,
        slides: { ...(cur.slides || {}), ...ro.slides },
        kpiCards: { ...(cur.kpiCards || {}), ...ro.kpiCards },
        labels: { ...(ro.labels || {}) },
        deltaMode: normalizeDeltaMode(ro.deltaMode),
        // R2 — written as a real boolean so the settings mirror, the store validator and
        // pipeline.js shouldAutoDownloadFiles all read one shape.
        autoDownloadFiles: ro.autoDownloadFiles !== false,
      };
      store.saveSettings(doc);
    } catch (e) { console.warn('[review] persist reportOptions failed', e); }
  };

  /* ---------- Preview machinery ---------- */
  const scaleEl = el('div', { class: 'preview-scale' });
  // A one-slide-tall scroll window: the full slide stack scrolls inside it and the
  // pager pages between slides (see applyScale + the slide-pager block below).
  const viewport = el('div', { class: 'preview-viewport', style: 'position:relative;overflow-y:auto;overflow-x:hidden' }, [scaleEl]);
  const previewHead = el('div', { class: 'preview-frame__head' }, [
    el('div', { class: 'card__title', style: 'margin:0', text: STR.review.previewTitle }),
    el('span', { class: 'small muted', text: STR.review.variantsNote }),
  ]);
  const pagerBar = el('div', { class: 'preview-pager', style: PAGER_BAR_STYLE });
  const previewFrame = el('div', { class: 'preview-frame' }, [previewHead, pagerBar, viewport]);

  // Pager state — mounted slides + the active index (shared with applyScale).
  let slideEls = [];
  let curSlide = 0;

  let renderToken = 0;
  function applyScale() {
    const avail = viewport.clientWidth || 320;
    const scale = Math.min(1, avail / 1280);
    scaleEl.style.transform = `scale(${scale})`;
    scaleEl.style.transformOrigin = 'top right';
    requestAnimationFrame(() => {
      // Viewport = one scaled slide tall, so the pager moves one slide per step and
      // the stack scrolls within. Fall back to the full scaled height when no slides
      // are mounted (placeholder states).
      const one = (slideEls[0] && slideEls[0].getBoundingClientRect().height) || 0;
      const h = one > 0 ? one : scaleEl.scrollHeight * scale;
      // Guard: setting height retriggers the ResizeObserver — only write real changes
      // to break the resize feedback loop.
      if (h > 0 && Math.abs(h - (parseFloat(viewport.style.height) || 0)) > 1) {
        viewport.style.height = h + 'px';
        // Keep the active slide aligned after a width/scale change.
        if (slideEls.length) requestAnimationFrame(() => { viewport.scrollTop = slideTargetTop(curSlide); });
      }
    });
  }

  async function renderPreview() {
    const token = ++renderToken;
    model.reportDate = state.reportDate;
    stampDeltas(); // re-window the chips for the current report date (pure → idempotent)
    const specMod = await tryImport('../slidespec/build-spec.js?v=v2026-08-25.1');
    const buildSpec = pickFn(specMod, ['buildSpec', 'build', 'makeSpec', 'toSpec']);
    const rendMod = await tryImport('../render/html-renderer.js?v=v2026-08-25.1');
    const renderFn = pickFn(rendMod, ['renderSpec', 'renderSlides', 'renderHtml', 'render']);

    if (!buildSpec || !renderFn) {
      scaleEl.innerHTML = '';
      viewport.style.height = 'auto';
      viewport.appendChild(el('div', { class: 'preview-placeholder', text: STR.review.previewMissing }));
      syncPager();
      return;
    }
    let spec = null;
    try {
      spec = buildSpec(model, { variant: 'internal' }); // preview = internal (the superset)
      if (spec && spec.then) spec = await spec;
      if (spec && !Array.isArray(spec) && spec.slides) spec = spec.slides;
    } catch (e) { console.warn('[review] buildSpec failed', e); }
    if (token !== renderToken) return;
    if (!Array.isArray(spec)) {
      scaleEl.innerHTML = '';
      viewport.appendChild(el('div', { class: 'preview-placeholder', text: STR.review.previewMissing }));
      syncPager();
      return;
    }
    scaleEl.innerHTML = '';
    try {
      let r = renderFn(spec, { variant: 'internal' });
      if (r && r.then) r = await r;
      if (token !== renderToken) return;
      if (r instanceof Node) scaleEl.appendChild(r);
      else if (Array.isArray(r)) r.forEach((n) => n instanceof Node && scaleEl.appendChild(n));
    } catch (e) {
      console.warn('[review] html render failed', e);
      scaleEl.appendChild(el('div', { class: 'preview-placeholder', text: STR.review.previewMissing }));
    }
    applyScale();
    // Slides just (re)mounted — re-sync the pager (N may have changed via a toggle).
    syncPager();
  }

  let debTimer = null;
  const schedulePreview = () => { clearTimeout(debTimer); debTimer = setTimeout(renderPreview, 260); };

  /* ---------- Slide pager ---------- */
  let dotEls = [];
  let prevBtn = null, nextBtn = null, counterEl = null;
  let pagerCount = -1;
  let scrollRaf = 0;

  const refreshSlideEls = () => { slideEls = Array.from(scaleEl.querySelectorAll('.sl-slide')); };

  // scrollTop that pulls slide i to the top of the viewport (measured from the
  // rendered — i.e. transformed/scaled — geometry, so it is scale-independent).
  function slideTargetTop(i) {
    const s = slideEls[i];
    if (!s) return 0;
    return viewport.scrollTop + (s.getBoundingClientRect().top - viewport.getBoundingClientRect().top);
  }
  function nearestIndex() {
    if (!slideEls.length) return 0;
    const vTop = viewport.getBoundingClientRect().top;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < slideEls.length; i++) {
      const d = Math.abs(slideEls[i].getBoundingClientRect().top - vTop);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  function goTo(i) {
    if (!slideEls.length) return;
    curSlide = Math.max(0, Math.min(slideEls.length - 1, i));
    // Direct scrollTop assignment — reliable everywhere (smooth-scroll is a silent
    // no-op under some automated/reduced-motion Chromes). The resulting scroll event
    // re-computes the same index, so it never fights this navigation.
    viewport.scrollTop = slideTargetTop(curSlide);
    paintPager();
  }
  function paintPager() {
    const N = slideEls.length;
    if (N <= 1) return;
    if (counterEl) counterEl.textContent = `الشريحة ${curSlide + 1} من ${N}`;
    if (prevBtn) { prevBtn.disabled = curSlide <= 0; prevBtn.style.opacity = curSlide <= 0 ? '.4' : '1'; }
    if (nextBtn) { nextBtn.disabled = curSlide >= N - 1; nextBtn.style.opacity = curSlide >= N - 1 ? '.4' : '1'; }
    dotEls.forEach((d, i) => { d.style.cssText = pagerDotStyle(i === curSlide); });
  }
  function buildPager() {
    const N = slideEls.length;
    pagerBar.innerHTML = '';
    dotEls = []; prevBtn = nextBtn = counterEl = null;
    pagerCount = N;
    if (N <= 1) { pagerBar.style.display = 'none'; return; }
    pagerBar.style.display = 'flex';
    // RTL order: previous (lower index) sits on the right, next (higher) on the left.
    prevBtn = el('button', { type: 'button', text: '▶', title: 'الشريحة السابقة', 'aria-label': 'الشريحة السابقة', style: PAGER_ARROW_STYLE, onClick: () => goTo(curSlide - 1) });
    nextBtn = el('button', { type: 'button', text: '◀', title: 'الشريحة التالية', 'aria-label': 'الشريحة التالية', style: PAGER_ARROW_STYLE, onClick: () => goTo(curSlide + 1) });
    counterEl = el('span', { style: PAGER_COUNT_STYLE });
    const dots = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center;flex:1 1 auto' });
    for (let i = 0; i < N; i++) {
      const d = el('button', { type: 'button', text: String(i + 1), title: `الشريحة ${i + 1}`, style: pagerDotStyle(false), onClick: () => goTo(i) });
      dotEls.push(d); dots.appendChild(d);
    }
    pagerBar.append(prevBtn, counterEl, dots, nextBtn);
    paintPager();
  }
  // Re-sync after slides (re)mount. Rebuild the bar only when N changed; otherwise
  // just re-index against the current scroll position and repaint.
  function syncPager() {
    refreshSlideEls();
    const N = slideEls.length;
    if (!N) { pagerBar.style.display = 'none'; pagerCount = 0; return; }
    curSlide = Math.min(nearestIndex(), N - 1);
    if (N !== pagerCount) buildPager(); else paintPager();
  }
  // Track the active slide when the operator scrolls the preview by hand.
  viewport.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const i = nearestIndex();
      if (i !== curSlide) { curSlide = i; paintPager(); }
    });
  }, { passive: true });

  /* ---------- Controls ---------- */
  const dateInput = el('input', { type: 'date', value: state.reportDate });
  dateInput.addEventListener('change', () => {
    const prevDate = state.reportDate;
    state.reportDate = dateInput.value || todayISO();
    model.reportDate = state.reportDate; // sync immediately — generate must never see a stale date
    dateHint.textContent = formatDateAr(state.reportDate);
    // The مغلق rows are date-dependent (see reconcileGraceRows): re-decide them for the
    // new date and remount the affected tables, so what the operator reviews is exactly
    // what generate publishes AND what recordShownTasks then writes under that date.
    if (state.reportDate !== prevDate && reconcileGraceRows(model, state, store, prevDate)) {
      mountCurrentTable();
      mountInternalTable();
      toast('تم تحديث المهام المغلقة حسب تاريخ التقرير الجديد', 'ok');
    }
    renderHistory(); // window anchor moved → rebuild the last-week panel
    // The activity WINDOW moved with the date, so the banner's wording AND its chip
    // values are stale until re-stamped — schedulePreview() re-stamps for the deck,
    // but the banner is painted separately and kept showing the previous window
    // (review finding 2026-08-05: banner said one week, the generated files another).
    stampDeltas();
    refreshBanner();
    schedulePreview();
  });
  const dateHint = el('div', { class: 'hint', text: formatDateAr(state.reportDate) });

  const dateField = el('div', { class: 'card' }, [
    el('div', { class: 'field', style: 'margin:0' }, [
      el('label', { text: STR.review.reportDate }),
      dateInput, dateHint,
    ]),
    el('p', { class: 'small muted', style: 'margin-top:8px', text: STR.review.variantsNote }),
  ]);

  // الدعم المطلوب editor (feeds the combined action slide). The المنجزة/المخطط
  // panels are no longer in the report — their editors were removed.
  const panelsCard = el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: STR.review.panelSupport }),
    textareaField({
      label: STR.review.panelSupport, hint: STR.review.panelHint,
      value: model.panels.supportRequired.join('\n'),
      onInput: (v) => { model.panels.supportRequired = linesToArr(v); schedulePreview(); },
    }),
  ]);

  // Task tables
  const taskCols = [
    { key: 'task', label: STR.review.colTask, type: 'textarea', width: '45%' },
    { key: 'status', label: STR.review.colStatus, type: 'select', options: STATUS_OPTIONS, width: '110px' },
    { key: 'dueDate', label: STR.review.colDate, type: 'date', width: '110px' },
    { key: 'owner', label: STR.review.colOwner, type: 'text', width: '110px' },
  ];
  const newTask = () => ({ task: '', status: STATUS_OPTIONS[0], dueDate: '', owner: '', responsible: '', category: '', hidden: false });

  // Both task tables live in a host div and are (re)built by a mount function: a report-date
  // change re-decides their مغلق rows (reconcileGraceRows) and editableTable snapshots its
  // `rows` into private state at construction time, so the DOM must be rebuilt from the new
  // array — otherwise the operator would review one list and publish another.
  const tasksCurrentHost = el('div');
  function mountCurrentTable() {
    tasksCurrentHost.innerHTML = '';
    tasksCurrentHost.appendChild(editableTable({
      columns: taskCols, rows: model.tasksCurrent, minWidth: '520px', newRow: newTask,
      onChange: (rows) => { model.tasksCurrent = rows; schedulePreview(); },
    }));
  }
  mountCurrentTable();
  const tasksCurrentCard = el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: STR.review.tasksCurrentTitle }),
    tasksCurrentHost,
  ]);
  // Internal (لين) task table = non-closed rows plus any one-shot مغلق grace rows
  // (lifecycle rule, 2026-08-04 — supersedes the old "complete 31-row log", so the
  // steady state is ~8-10 rows). The collapse stays as a guard for a pathological
  // tracker; grace rows are EXEMPT from it (see decorateInternalTable) — the one
  // row the operator most needs to review must never load hidden. Dim hidden rows
  // (with a 'مخفي في الجدول' chip) and give مغلق rows a subtle done tint.
  // editableTable rebuilds its <tbody> on add/remove, so the decoration is
  // re-applied from onChange (and once per mount). Like tasksCurrent, the table
  // lives in a host and is remounted by reconcileGraceRows on a report-date change
  // — editableTable snapshots `rows` at construction, so a new array needs a new DOM.
  const COLLAPSE_ROWS = 8;
  let internalExpanded = false;
  const tasksInternalHost = el('div');
  let internalTable = null;
  function mountInternalTable() {
    tasksInternalHost.innerHTML = '';
    internalTable = editableTable({
      columns: taskCols, rows: model.tasksInternal, minWidth: '520px', newRow: newTask,
      onChange: (rows) => { model.tasksInternal = rows; decorateInternalTable(); schedulePreview(); },
    });
    tasksInternalHost.appendChild(internalTable);
    decorateInternalTable();
  }
  const internalToggle = el('button', {
    type: 'button', class: 'btn btn--ghost btn--sm', style: 'margin-top:8px;display:none',
    onClick: () => { internalExpanded = !internalExpanded; decorateInternalTable(); },
  });
  function decorateInternalTable() {
    const tbody = internalTable && internalTable.querySelector('tbody');
    if (!tbody) return;
    const rows = model.tasksInternal || [];
    const trs = Array.from(tbody.children);
    // Idempotent: strip decoration from any prior pass before re-applying.
    tbody.querySelectorAll('.rev-hidden-chip').forEach((n) => n.remove());
    trs.forEach((tr, i) => {
      const r = rows[i] || {};
      // Collapse everything past the threshold unless expanded — EXCEPT مغلق rows:
      // a grace row is the one-shot "completed" announcement and tends to sit last
      // in tracker order, exactly where the collapse would hide it from review.
      tr.style.display = (!internalExpanded && i >= COLLAPSE_ROWS && !isClosed(r)) ? 'none' : '';
      // مغلق → subtle green 'done' tint; hidden (collapsed done-work) → dimmed + chip.
      tr.style.background = isClosed(r) ? 'var(--closed-tint,rgba(22,163,74,.08))' : '';
      tr.style.opacity = r.hidden ? '0.55' : '';
      if (r.hidden) {
        const firstCell = tr.firstElementChild;
        if (firstCell) firstCell.appendChild(el('span', {
          class: 'rev-hidden-chip',
          style: 'display:inline-block;margin-top:5px;font-size:.68rem;font-weight:700;color:var(--slate-600);background:var(--border);border:1px solid var(--border-dark);border-radius:999px;padding:1px 8px;white-space:nowrap',
          text: 'مخفي في الجدول',
        }));
      }
    });
    const N = trs.length;
    if (N > COLLAPSE_ROWS) {
      internalToggle.style.display = '';
      internalToggle.textContent = internalExpanded ? 'عرض أقل' : `عرض كل المهام (${N})`;
    } else {
      internalToggle.style.display = 'none';
    }
  }
  const tasksInternalCard = el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: STR.review.tasksInternalTitle }),
    tasksInternalHost,
    internalToggle,
  ]);
  mountInternalTable(); // build + decorate the initial rows

  // Challenges
  const challengeCols = [
    { key: 'title', label: STR.review.colTitle, type: 'text', width: '22%' },
    { key: 'desc', label: STR.review.colDesc, type: 'textarea', width: '34%' },
    { key: 'impact', label: STR.review.colImpact, type: 'text', width: '90px' },
    { key: 'owner', label: STR.review.colOwner, type: 'text', width: '110px' },
    { key: 'status', label: STR.review.colStatus, type: 'select', options: STATUS_OPTIONS, width: '110px' },
    { key: 'solution', label: STR.review.colSolution, type: 'textarea', width: '30%' },
  ];
  const newChallenge = () => ({ id: 'c' + Date.now(), title: '', desc: '', impact: '', owner: '', status: STATUS_OPTIONS[0], solution: '' });
  const challengesCard = el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: STR.review.challengesTitle }),
    editableTable({
      columns: challengeCols, rows: model.challenges, minWidth: '720px', newRow: newChallenge,
      onChange: (rows) => { model.challenges = rows; schedulePreview(); },
    }),
  ]);

  // Risks
  const riskCols = [
    { key: 'title', label: STR.review.colTitle, type: 'text', width: '24%' },
    { key: 'desc', label: STR.review.colDesc, type: 'textarea', width: '40%' },
    { key: 'probability', label: STR.review.colProbability, type: 'text', width: '90px' },
    { key: 'impact', label: STR.review.colImpact, type: 'text', width: '90px' },
    { key: 'owner', label: STR.review.colOwner, type: 'text', width: '110px' },
    { key: 'status', label: STR.review.colStatus, type: 'select', options: STATUS_OPTIONS, width: '110px' },
  ];
  const newRisk = () => ({ id: 'r' + Date.now(), title: '', desc: '', probability: '', impact: '', owner: '', status: STATUS_OPTIONS[0] });
  const risksCard = el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: STR.review.risksTitle }),
    editableTable({
      columns: riskCols, rows: model.risks, minWidth: '760px', newRow: newRisk,
      onChange: (rows) => { model.risks = rows; schedulePreview(); },
    }),
  ]);

  // KPI overrides (editable). Each row prefills the computed value; editing sets a
  // per-run override (model.overrides[key]) + shows a 'يدوي' badge + a ↺ reset. Grid
  // reuses .kpi-list (two columns desktop, single column ≤420px).
  function overrideRow(field) {
    const label = STR.review.overrideLabels[field.key] || field.key;
    const computed = field.get(kpi);
    const compStr = computed == null ? '' : String(computed);
    const hasOv = Object.prototype.hasOwnProperty.call(model.overrides, field.key);

    const input = el('input', {
      type: 'number', step: 'any', inputmode: 'decimal', style: OV_INPUT_STYLE,
      value: hasOv ? String(model.overrides[field.key]) : compStr,
    });
    const badge = el('span', { text: STR.review.manualBadge, style: OV_BADGE_STYLE });
    const reset = el('button', { type: 'button', title: STR.review.resetOverride, text: '↺', style: OV_RESET_STYLE });

    const paintState = (on) => {
      badge.style.display = on ? 'inline-flex' : 'none';
      reset.style.display = on ? 'inline-flex' : 'none';
    };
    input.addEventListener('input', () => {
      const raw = input.value.trim();
      const n = Number(raw);
      if (raw !== '' && Number.isFinite(n)) { model.overrides[field.key] = n; paintState(true); }
      else { delete model.overrides[field.key]; paintState(false); }
      schedulePreview();
    });
    reset.addEventListener('click', () => {
      delete model.overrides[field.key];
      input.value = compStr;
      paintState(false);
      schedulePreview();
    });
    paintState(hasOv);

    // min-width:0 clamps the grid item's auto-minimum so the reused .kpi-list
    // `1fr 1fr` columns stay equal — without it the wide number inputs force the
    // columns past the card and the left column spills under the preview.
    return el('div', { class: 'kpi-item', style: 'min-width:0' }, [
      el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px' }, [
        el('span', { class: 'kpi-item__label', text: label }),
        badge,
      ]),
      el('div', { style: 'display:flex;align-items:center;gap:6px' }, [input, reset]),
    ]);
  }
  // Analyst note: surface how many lines the engine dropped for lacking a
  // standard TAT — only when the engine actually excluded some.
  const excludedNote = (kpi && kpi.excludedNoTat > 0)
    ? el('p', { class: 'small muted', style: 'margin:0 0 10px', text: `استُبعد ${kpi.excludedNoTat} سطراً بدون مدة معيارية (TAT)` })
    : null;
  // Collapsed by default (daily flow rarely overrides numbers); styled like the
  // labels card so it reads as an advanced/optional section.
  const kpiCard = el('details', { class: 'card' }, [
    el('summary', { class: 'card__title', style: 'cursor:pointer', text: STR.review.kpiEditTitle }),
    el('p', { class: 'small muted', style: 'margin:-4px 0 10px', text: STR.review.kpiEditHint }),
    excludedNote,
    el('div', { class: 'kpi-list' }, OVERRIDE_FIELDS.map(overrideRow)),
  ]);

  // Slide-toggle chips (bound to reportOptions.slides.*). Toggling updates the model,
  // persists to settings as the new default, and live-refreshes the preview.
  function slideChip(t) {
    const btn = el('button', { type: 'button' });
    const paint = () => {
      const on = model.reportOptions.slides[t.key] !== false;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.textContent = (on ? '✓ ' : '') + t.label;
      btn.style.cssText = chipStyle(on);
    };
    btn.addEventListener('click', () => {
      model.reportOptions.slides[t.key] = model.reportOptions.slides[t.key] === false;
      paint();
      persistReportOptions();
      schedulePreview();
    });
    paint();
    return btn;
  }
  const slideToggleRow = el('div', {
    class: 'slide-toggles',
    style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px',
  }, [
    el('span', { class: 'small muted', style: 'margin-inline-end:2px', text: STR.review.slideTogglesTitle }),
    ...SLIDE_TOGGLES.map(slideChip),
  ]);

  // Labels editor (collapsible, collapsed by default). One field per LABEL_NAMES key,
  // placeholder = DEFAULT_LABELS[key], value = reportOptions.labels[key] (empty =
  // default). Registry lives in build-spec.js — graceful if not exported yet.
  const labelsHost = el('details', { class: 'card' }, [
    el('summary', { class: 'card__title', style: 'cursor:pointer', text: STR.review.labelsCardTitle }),
  ]);
  (async () => {
    const specMod = await tryImport('../slidespec/build-spec.js?v=v2026-08-25.1');
    const LABEL_NAMES = specMod && specMod.LABEL_NAMES;
    const DEFAULT_LABELS = (specMod && specMod.DEFAULT_LABELS) || {};
    if (!LABEL_NAMES || typeof LABEL_NAMES !== 'object') {
      labelsHost.appendChild(el('p', { class: 'small muted', text: STR.review.labelsUnavailable }));
      return;
    }
    const labels = model.reportOptions.labels;
    labelsHost.appendChild(el('p', { class: 'small muted', style: 'margin:2px 0 10px', text: STR.review.labelsCardHint }));
    for (const key of Object.keys(LABEL_NAMES)) {
      const def = DEFAULT_LABELS[key] != null ? String(DEFAULT_LABELS[key]) : '';
      const input = el('input', { type: 'text', value: labels[key] || '', placeholder: def });
      input.addEventListener('input', () => {
        if (input.value.trim() === '') delete labels[key];
        else labels[key] = input.value;
        persistReportOptions();
        schedulePreview();
      });
      const restore = el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: STR.review.restoreDefault,
        onClick: () => { delete labels[key]; input.value = ''; persistReportOptions(); schedulePreview(); },
      });
      labelsHost.appendChild(el('div', { class: 'field' }, [
        el('label', { text: LABEL_NAMES[key] }),
        el('div', { style: 'display:flex;gap:8px;align-items:center' }, [input, restore]),
      ]));
    }
  })();

  const genButton = el('button', {
    class: 'btn btn--primary btn--block', text: STR.review.generate,
    onClick: () => {
      genButton.disabled = true; // guard against a double-click launching two runs
      model.reportDate = state.reportDate; // beat the 260ms preview debounce
      // Settings edited after the model was drafted (scorecard, display names)
      // must reach the generated files.
      const s = store.settings || {};
      model.scorecard = s.scorecard || model.scorecard;
      model.displayNames = s.displayNames || model.displayNames;
      state.reportModel = model;
      navigate('generate');
    },
  });
  // R2 — auto-download switch, attached to the generate button because that is the
  // moment it acts on: ON (default, and what an absent key means) saves the 4 files the
  // instant they are ready; OFF leaves the success panel's per-file buttons as the only
  // download. The label is deliberately NOT the automation tab's identically-meaning
  // 'تنزيل ملفات التقرير تلقائياً' — that switch arms UNATTENDED runs and this one must
  // never be mistaken for it. Persisted through the same persistReportOptions path the
  // pills and slide chips use; screen-generate reads the decision back through
  // pipeline.js shouldAutoDownloadFiles (which also enforces "mobile never auto-saves").
  // .checked is set IMPERATIVELY: el() skips a false-valued attribute, so passing
  // checked:false would leave a stale ON box after the user turned it off.
  const autoDlCheck = el('input', {
    type: 'checkbox',
    // Explicit name: the wrapping <label> gives a visual association but the a11y tree
    // read this control as an unnamed checkbox, which is what a screen reader announces.
    'aria-label': 'تنزيل الملفات الأربعة تلقائياً بعد التوليد',
    style: 'width:18px;height:18px;flex:0 0 auto;accent-color:var(--navy)',
  });
  autoDlCheck.checked = model.reportOptions.autoDownloadFiles !== false;
  autoDlCheck.addEventListener('change', () => {
    model.reportOptions.autoDownloadFiles = autoDlCheck.checked;
    persistReportOptions();
    toast(autoDlCheck.checked
      ? 'سيتم تنزيل الملفات الأربعة تلقائياً بعد التوليد'
      : 'لن يُنزَّل أي ملف تلقائياً — اختر الملفات بعد التوليد', 'ok');
  });
  // OPAQUE background on purpose: .sticky-actions paints a gradient that is transparent
  // at its TOP 30%, which was fine while the bar held only the solid full-width button.
  // This row lands in that transparent band, so at a 390px phone width the card scrolling
  // underneath (the report-date hint) showed straight through the label text. --bg-lighter
  // is the same colour the gradient resolves to, so the patch is invisible on both themes.
  const autoDlRow = el('label', {
    style: 'display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px;font-weight:600;font-size:.85rem;color:var(--slate-600);background:var(--bg-lighter);padding:6px 8px;border-radius:8px',
  }, [
    autoDlCheck,
    el('span', { text: 'تنزيل الملفات الأربعة تلقائياً بعد التوليد' }),
  ]);
  const generateBtn = el('div', { class: 'sticky-actions' }, [autoDlRow, genButton]);

  // 'نشاط الأسبوع' banner — the first thing the operator sees. Reads model.kpi.deltas,
  // which model/delta-window.js computed as the IN-WINDOW ACTIVITY from the rows' own
  // dates: a coloured '+N' chip per POSITIVE delta (bannerChipVisible — queue keys are
  // surviving entrants, so a drained queue still reports the week's arrivals), else a
  // calm single line. Rebuilt on a delta-mode switch.
  //
  // TWO DISCLOSURES DIED HERE with the baseline they described. anchorFallbackNote
  // ("no report was stored before this week's Sunday, so we compared to the newest one
  // available") and definitionShiftNote ("the baseline's مكتملة predates the 2026-07-28
  // rule") both disclosed properties of a STORED BASELINE. There is no stored baseline
  // any more — the chips are computed from the CSV's date columns — so their subject no
  // longer exists and retaining either would state something untrue about this run.
  //
  // ONE muted note survives, and it is about the DATA, not a baseline: a rejection
  // carries no timestamp of its own, so engine/asof.js dates a rejected row by its
  // result date when it has one and otherwise by the last milestone it is known to have
  // reached. When any counted rejected row needed that fallback, computeWindowDeltas
  // bubbles it as deltaWindow.approx.rejected and the operator is told.
  function approxNote() {
    const dw = model.deltaWindow;
    const approx = dw && dw.approx;
    if (!approx || (!approx.rejected && !approx.total)) return null;
    const lines = [];
    if (approx.rejected) lines.push('تأريخ بعض المرفوضات تقديري (لا يحمل الرفض طابعاً زمنياً)');
    // approx.total: cancelled rows are excluded at BOTH window endpoints, so an order
    // created inside the week and cancelled afterwards does not appear in the new-orders
    // count. That is the correct reading of "cancelled counts toward nothing but its own
    // KPI" — but it must be SAID, not silent (review finding 2026-08-05).
    if (approx.total) lines.push('لا يشمل عدّ الطلبات الجديدة طلباتٍ أُلغيت لاحقاً');
    return el('p', {
      class: 'small muted',
      style: 'margin:10px 0 0',
      text: lines.join(' • '),
    });
  }

  // Banner wording lives at MODULE scope (exported deltaWording, next to
  // DELTA_MODE_PILLS) so the same rule the deck legend uses is reachable from node and
  // can be pinned by test/delta-mode-registry.test.mjs. Read its comment before editing
  // the week-vs-day window wording.

  function buildDeltaBanner() {
    const deltas = (kpi && kpi.deltas) || {};
    // Positive-only, through the module-scope exported predicate — read its comment
    // (why > 0 cannot hide a real negative, and why the deck applies the same rule)
    // before ever relaxing this back to '!== 0'. Zero ⇒ no chip; all-zero ⇒ words.empty.
    // The value is passed RAW, not Number()-coerced: build-spec's fmtDelta receives the
    // raw value too, so a corrupt string '5' is rejected by Number.isFinite on BOTH
    // surfaces instead of chipping here and not on the deck.
    const active = DELTA_META.filter((m) => bannerChipVisible(deltas[m.key]));
    // week vs single-day window phrasing, one decision — read at call time from the
    // stamped window (authoritative) with the settings mode as the only fallback.
    const words = deltaWording(model.reportOptions.deltaMode, model.deltaWindow);
    const note = approxNote(); // shown in BOTH branches: an approximated rejection date
    // can just as easily net a chip to zero as inflate it.
    if (!active.length) {
      return el('div', { class: 'card', style: 'padding:14px 16px' }, [
        el('div', { style: 'display:flex;align-items:center;gap:8px' }, [
          el('span', { text: '✓', style: 'color:var(--green);font-weight:800;font-size:1.1rem' }),
          el('span', { text: words.empty, style: 'color:var(--slate-600);font-weight:600;font-size:.92rem' }),
        ]),
        note,
      ]);
    }
    // ALWAYS the ASCII '+' — a surviving chip is > 0 by the filter above, and build-spec's
    // fmtDelta prints the same '+N' for the same key, so the banner and the exec slide of
    // one run never read differently. The '−' branch is GONE with the signed model; do not
    // reintroduce it without changing both surfaces at once.
    // RTL: the signed number is its OWN dir=ltr flex item. As part of one Arabic
    // text run the leading '+' (bidi class ES → ON → resolved to the RTL paragraph
    // level) rendered on the WRONG side of the digits ('12+' instead of '+12'). Same
    // isolation the history panel's delta and the upload hero pill use.
    const chips = active.map((m) => {
      const n = Number(deltas[m.key]);
      return el('span', {
        style: DELTA_CHIP_BASE + ';' + (DELTA_CHIP_TONE[m.intent] || DELTA_CHIP_TONE.info),
      }, [
        el('span', { dir: 'ltr', text: '+' + n }),
        el('span', { text: m.label }),
      ]);
    });
    return el('div', { class: 'card', style: 'padding:16px 18px;border-inline-start:4px solid var(--navy)' }, [
      el('div', { style: 'font-weight:800;font-size:1.05rem;color:var(--navy);margin-bottom:3px', text: words.heading }),
      el('div', { class: 'small muted', style: 'margin-bottom:12px', text: words.sub }),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' }, chips),
      note,
    ]);
  }

  // Delta-mode segmented control (يومي / أسبوعي) — the deltaMode option surfaced in the
  // MAIN flow, right above the نشاط banner whose window it sizes. Two pills, driven by the exported module-scope DELTA_MODE_PILLS.
  // Clicking persists reportOptions.deltaMode through the SAME settings save path the
  // slide chips use (persistReportOptions), re-picks the baseline, and live-refreshes the
  // banner + preview + progress panel. Initial state comes from settings (default
  // 'week'), so this stays in sync with the settings-screen radio.
  // Compact enough that both pills sit on one row at a 390px phone width; labels never
  // break mid-pill (white-space:nowrap) and the row wraps as a whole if narrower.
  const dmPillStyle = (on) => 'border-radius:999px;padding:6px 12px;font-weight:700;font-size:.78rem;cursor:pointer;min-height:32px;line-height:1;white-space:nowrap;transition:background .12s;'
    + (on
      ? 'background:var(--navy);color:#fff;border:1px solid var(--navy);'
      : 'background:var(--white);color:var(--slate-600);border:1px solid var(--border-dark);');
  const dmPillEls = {};
  function paintDeltaMode() {
    const mode = normalizeDeltaMode(model.reportOptions.deltaMode);
    for (const p of DELTA_MODE_PILLS) {
      const btn = dmPillEls[p.mode];
      if (!btn) continue;
      const on = p.mode === mode;
      btn.style.cssText = dmPillStyle(on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  // Refreshable banner host so the baseline date + chips update live on a mode switch.
  const bannerHost = el('div');
  const refreshBanner = () => { bannerHost.innerHTML = ''; bannerHost.appendChild(buildDeltaBanner()); };
  function setDeltaMode(mode) {
    if (model.reportOptions.deltaMode === mode) return;
    model.reportOptions.deltaMode = mode;
    persistReportOptions();                         // (1) canonical settings save path
    stampDeltas();                                  // (2a) re-window the chips for the new mode
    refreshBanner();                                // (2b) banner date + chips update live
    renderPreview();                                // (2c) preview re-renders (re-applies too)
    renderHistory();                                // (2d) progress panel re-anchors its شهر samples
    paintDeltaMode();                               // (3) flip the active pill
  }
  // RTL: the first child (يومي) sits on the right, أسبوعي on the left.
  const dmPillRow = el('div', { class: 'delta-mode-seg__pills', style: 'display:inline-flex;gap:6px;flex-wrap:wrap' });
  for (const p of DELTA_MODE_PILLS) {
    const btn = el('button', {
      type: 'button', text: p.label, title: p.title, 'aria-pressed': 'false',
      onClick: () => setDeltaMode(p.mode),
    });
    dmPillEls[p.mode] = btn;
    dmPillRow.appendChild(btn);
  }
  paintDeltaMode();
  const deltaModeControl = el('div', {
    class: 'delta-mode-seg',
    style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px',
  }, [
    el('span', { text: 'نافذة النشاط:', style: 'font-weight:700;font-size:.85rem;color:var(--slate-600);white-space:nowrap' }),
    dmPillRow,
  ]);
  refreshBanner();
  const deltaArea = el('div', { class: 'delta-area' }, [deltaModeControl, bannerHost]);

  // 'أرقام التقارير والتقدم' — a collapsed-by-default RTL progress card (range pills
  // أسبوع/شهر/منذ البداية driving a per-sample table + trend chart) mounted right below
  // the delta switcher. Rebuilt when the report date changes (the window/anchor) and when
  // the delta mode changes — under 'week' the شهر range samples THURSDAYS (the
  // week-closing report, so a row-to-row gap is exactly one week's chips); the
  // open/closed state is preserved across rebuilds. Numbers come from
  // engine/asof.js (guarded inside the panel → published-history-only, chart hidden).
  const historyHost = el('div', { class: 'history-host' });
  let historyOpen = false;
  function renderHistory() {
    const s = store.settings || {};
    const panel = buildHistoryPanel({
      rows: (state.parsed && state.parsed.orders) || null,
      tatTests: s.tatLookup || {},
      history: s.snapshotHistory || {},
      endIso: state.reportDate,
      deltaMode: normalizeDeltaMode(model.reportOptions.deltaMode),
    });
    panel.open = historyOpen;
    panel.addEventListener('toggle', () => { historyOpen = panel.open; });
    historyHost.innerHTML = '';
    historyHost.appendChild(panel);
  }
  renderHistory();

  // Banner FIRST, then the week-history panel, then daily-edited items (date →
  // support → tasks → challenges/risks), then the advanced KPI-override and
  // label-customisation cards, then generate.
  const controls = el('div', { class: 'review-controls' }, [
    deltaArea, historyHost, dateField, panelsCard, tasksCurrentCard, tasksInternalCard, challengesCard, risksCard, kpiCard, labelsHost, generateBtn,
  ]);
  const preview = el('div', { class: 'review-preview' }, [slideToggleRow, previewFrame]);

  const head = el('div', { class: 'screen__head' }, [
    el('h1', { text: STR.review.title }),
    el('p', { text: STR.review.subtitle }),
  ]);

  // Source order: controls first (RTL => right), preview second (left/main).
  container.appendChild(el('div', { class: 'screen' }, [
    head,
    el('div', { class: 'review-layout' }, [controls, preview]),
  ]));

  // Observe width changes to keep the scaled preview fitted.
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => applyScale());
    ro.observe(viewport);
  } else {
    window.addEventListener('resize', applyScale);
  }

  renderPreview();
}
