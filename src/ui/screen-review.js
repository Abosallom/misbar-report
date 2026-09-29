// ui/screen-review.js — review/edit report content with a live slide preview (Track E).
import { STR, todayISO, formatDateAr, formatRangeAr } from '../i18n/ar.js?v=v2026-09-29.1';
import { el, editableTable, textareaField, toast } from './components.js?v=v2026-09-29.1';
import { buildMockEngineOutput, buildMockTracker } from './screen-upload.js?v=v2026-09-29.1';
import { autoDraft, splitTaskLists } from '../model/drafts.js?v=v2026-09-29.1';
import { analyseSendout, hasMaster, AR_COUNTRY } from '../model/sendout.js?v=v2026-09-29.1';
import { buildHistoryPanel } from './history-table.js?v=v2026-09-29.1';
// REPORT SCOPE (2026-09-29). STATIC, not guarded like delta-window below: scope decides
// WHICH ROWS every number is computed from, and there is no safe degraded answer — a
// build that silently ignored a chosen scope would publish the full programme's numbers
// under a «مخصص» label. scope.js is pure (no DOM, no vendor), and ar.js / pipeline.js
// already import it statically, so this adds no new failure mode.
import {
  EMPTY_SCOPE, normalizeScope, isScoped, hasRange, parseShipmentIds, labOptions,
  findShipments, applyScope, shipmentDetails,
} from '../model/scope.js?v=v2026-09-29.1';
import {
  normalizeDeltaMode, isWeekDeltaMode, DEFAULT_DELTA_MODE,
} from '../model/delta-baseline.js?v=v2026-09-29.1';
// Same module instance drafts.js already imports (identical specifier) — the grace
// re-check below MUST use task-lifecycle's own identity/status vocabulary, never a
// second local copy of it. Static, not guarded: drafts.js (imported above) already
// depends on this module, so there is no new failure mode.
import {
  CLOSED as CLOSED_STATUS, LIST_EXTERNAL, LIST_INTERNAL, taskKey,
} from '../model/task-lifecycle.js?v=v2026-09-29.1';

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
  { key: 'sendout', label: STR.review.slideToggles.sendout },
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

/* «نطاق التقرير» chrome. The lab chips are a SELECTION, not the slide toggles' on/off:
 * an unselected lab is merely not chosen, so it gets a plain outline — never chipStyle's
 * strike-through, which reads as "removed from the report". */
const scopeChipStyle = (on) => 'display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 12px;font-weight:700;font-size:.82rem;cursor:pointer;min-height:36px;line-height:1.3;max-width:100%;text-align:start;'
  + (on
    ? 'background:var(--navy);color:#fff;border:1px solid var(--navy);'
    : 'background:var(--white);color:var(--slate-600);border:1px solid var(--border-dark);');
const SCOPE_COUNT_STYLE = 'font-size:.72rem;font-weight:700;padding:0 7px;border-radius:999px;background:rgba(127,127,127,.2);unicode-bidi:isolate';
const scopePillStyle = (scoped) => 'font-size:.72rem;font-weight:700;padding:2px 10px;border-radius:999px;white-space:nowrap;'
  + (scoped
    ? 'background:var(--warn-bg,#FEF3C7);color:var(--warn-text,#92400E);border:1px solid var(--amber)'
    : 'background:var(--bg-lighter);color:var(--slate-600);border:1px solid var(--border-dark)');
const SCOPE_ACTIVE_STYLE = 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 12px;margin-bottom:16px;border-radius:var(--radius-sm);background:var(--info-bg,#E0E7FF);color:var(--info-text,#1E3A8A)';
const SCOPE_INFO_STYLE = 'margin:8px 0 0;padding:6px 10px;border-radius:6px;overflow-wrap:anywhere;background:var(--info-bg,#E0E7FF);color:var(--info-text,#1E3A8A)';
// The active-scope line lists at most this many shipment ids (+N for the rest) — the
// same cut the generate screen's share text makes, for the same reason.
const SCOPE_MAX_IDS = 5;

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
    label: 'أسبوعي — نشاط الأسبوع (الجمعة–الخميس)',
    title: 'الأحداث المؤرخة من جمعة هذا الأسبوع حتى تاريخ التقرير — والأرقام الكبيرة تبقى تراكمية',
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
    const span = startAr && endAr ? ` (الجمعة ${startAr} – ${endAr})` : ' (الجمعة–الخميس)';
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

/* ---------- Report scope: session state + the ONE order-figures builder ---------- */

/** The session's parsed order rows, or null (mock / tracker-only session). */
function allRowsOf(state) {
  const o = state && state.parsed && state.parsed.orders;
  return Array.isArray(o) && o.length ? o : null;
}

/* WHICH DATA a scope was chosen against. The scope lives on `state` (memory only —
 * never settings: it is a choice about ONE run, and runAutomation never reads it) and
 * must not outlive the rows it was chosen for: shipment ids typed against this
 * morning's export mean nothing for tomorrow's, and a lab picked yesterday would
 * silently narrow a fresh upload into a side report nobody asked for.
 *
 * THE DATA IS THE ORDERS ARRAY ITSELF, BY IDENTITY. Every reload path assigns a NEW
 * array to state.parsed.orders — the upload screen's live pull and CSV parse, the mock
 * loader, the automation's pull — and a reused pull keeps the same one, so identity is
 * exactly "is this still the data the scope was chosen against". A content fingerprint
 * (row count + first/last order id) was tried and is WRONG for the commonest reload: a
 * re-pull minutes later where only statuses moved has the same shape, so the old scope
 * survived onto new data, and on the app-bar home path (which keeps state.reportModel)
 * the figures were never rebuilt at all. «تقرير جديد» (state.js resetRunData) needs no
 * clean-up here either: it drops the orders, and whatever is loaded next is a new array
 * the old scope was never bound to.
 *
 * The binding is a WeakMap keyed by the orders array (→ the epoch it was bound under),
 * with only the epoch number on state: a strong reference to the array would keep a
 * dropped pull's patient-adjacent rows alive after «تقرير جديد» for no reason. The epoch
 * also keys the figures cache and the typed-but-unapplied scope input below, so all
 * three reset together. Nothing about the rows is logged or stored beyond memory. */
const scopeBinding = new WeakMap();
let dataEpoch = 0;

/** The scope in force for this render: state.scope, reset to EMPTY_SCOPE when the
 *  loaded orders array is not the one it was chosen against, or when there are no
 *  rows to scope (epoch 0). */
function currentScope(state) {
  const rows = allRowsOf(state);
  if (!rows || !state.scope || !state.scopeEpoch || scopeBinding.get(rows) !== state.scopeEpoch) {
    state.scope = EMPTY_SCOPE;
    state.scopeEpoch = rows ? ++dataEpoch : 0;
    if (rows) scopeBinding.set(rows, state.scopeEpoch);
  }
  return state.scope;
}

/** '' for every unscoped value (a lone unticked shipment-slide box is not a scope),
 *  else the normalised ROW FILTERS (labs, shipments, range) — so "does this model match
 *  the chosen scope" is one string compare that can never disagree with isScoped. The
 *  shipment-slide flag is left OUT on purpose: it picks a slide, not rows, so ticking it
 *  is neither a new number set (no rebuild — its handler writes the flag onto both
 *  state.scope and model.scope) nor a scope change that drops the operator's overrides. */
const scopeKey = (s) => {
  if (!isScoped(s)) return '';
  const { labs, shipments, from, to } = normalizeScope(s);
  return JSON.stringify({ labs, shipments, from, to });
};

/** The date the numbers are evaluated at AND the deck is dated: a range's END when one
 *  is active (a ranged report is the data "as of 'to'"), else the chosen report date. */
function effectiveReportDate(state, scope) {
  return hasRange(scope) ? normalizeScope(scope).to : (state.reportDate || todayISO());
}

/* View memory that must survive ctx.rerender() — a scope or report-date change rebuilds
 * the whole screen around a FRESH model, and without this the operator would lose their
 * place (scroll, open cards, the previewed slide) on every chip click. VIEW state only:
 * never rows, never numbers. `restore` is set immediately before OUR rerender and taken
 * by the next render, so ordinary navigation still opens the screen as it always did.
 * `draft` holds typed-but-unapplied scope input (the «مراجعة الأرقام» answer keeps the
 * text) and is dropped when the data changes (a new state.scopeEpoch), exactly like the
 * scope itself. */
const view = { restore: null, draft: { epoch: null, shipText: null, from: null, to: null } };

/** Send-out figures for the given rows, or null. Never throws: a failure here must
 *  not take down the whole review screen, and no catalogue means no slides rather
 *  than every lab reported as unmapped. The rows are the SCOPED rows, so the
 *  محلي/دولي slides and the gaps card below describe the same orders as the cards.
 *  `opts` is passed only for a scoped build (see SCOPED ROWS ARE FINAL below);
 *  unscoped it is undefined, so the call is the two-argument one it always was. */
function sendoutFor(rows, master, opts) {
  if (!Array.isArray(rows) || !rows.length || !hasMaster(master)) return null;
  try {
    return analyseSendout(rows, master, opts);
  } catch (e) {
    console.warn('[review] send-out analysis failed; slides omitted', e);
    return null;
  }
}

/* compute()'s SETTINGS-SIDE inputs for one build, in ONE place: buildOrderFigures hands
 * the engine exactly these, and figuresKeyOf fingerprints exactly these — so a Settings
 * edit to anything the numbers depend on (a TAT, «استبعاد بدون TAT», the historical
 * cancellation constants, the published snapshot) and a return here can never serve
 * figures computed from the old value, and a new engine input added HERE is covered by
 * the cache key with no second edit. The date is one of them (opts.asOf).
 * UNSCOPED ⇒ screen-upload.js engineOpts() verbatim (pipeline.js keeps the same list).
 * SCOPED ⇒ three opts differ from the full run's:
 *   • cancelledByMonth — the manual historical cancellation constants are organisation
 *     totals; merged into one lab's (or one week's) monthly table they would be false.
 *   • snapshot — the published full-report numbers; the engine's own deltas against
 *     them would be nonsense for a subset (and are re-stamped from the rows anyway).
 *   • inferBlanks:false — SCOPED ROWS ARE FINAL (model/scope.js header). applyScope has
 *     already filled every blank facility the FULL row set can settle; a blank that
 *     survives is one the full report leaves unattributed on purpose (its test runs at
 *     two labs). compute() and analyseSendout() both run that inference on whatever they
 *     are handed, and a shipment or range subset holding only ONE of those labs' rows
 *     makes the blank look settled — crediting it to a lab, and on the send-out slides a
 *     country, the full report never gives it. So a scoped build asks both to skip the
 *     step (their `inferBlanks` option, default on), and ONLY a scoped one: unscoped,
 *     applyScope infers nothing and their own pass IS the full-set inference.
 *     test/scope.test.mjs checks it end to end through this builder. */
function engineInputs(state, settings, sc) {
  const s = settings || {};
  const asOf = effectiveReportDate(state, sc);
  const excludeNoTat = !!(s.reportOptions && s.reportOptions.excludeNoTat);
  const opts = isScoped(sc)
    ? { asOf, cancelledByMonth: {}, snapshot: undefined, excludeNoTat, inferBlanks: false }
    : { asOf, cancelledByMonth: (s.historicalConstants || {}).cancelledByMonth || {}, snapshot: s.snapshot, excludeNoTat };
  return { tat: s.tatLookup, opts };
}

/* THE ONE BUILDER of the order-based half of the ReportModel (2026-09-29): scope the
 * rows, then compute EVERY number from them — kpi, send-out, shipment details.
 *
 * ALWAYS RECOMPUTES, as of the effective report date (a deliberate fix, announced to the
 * user). The model used to take kpi = state.engineOutput, computed on the upload screen as
 * of the date chosen THERE; a report-date change here re-stamped the chips but never the
 * engine, so late/on-time and every as-of bucket stayed tied to the upload-time date. It
 * also has to be a FRESH compute() result for a second reason: stampWindowDeltas mutates
 * model.kpi.deltas, and model.kpi used to BE state.engineOutput — a scoped stamp must
 * never write into the full run's cache. A range moves asOf to its end: applyScope
 * time-shifts the rows to 'to', and the engine must judge lateness on that same day or a
 * line would be "late" as of a date the report does not claim to know.
 *
 * UNSCOPED ⇒ BYTE-IDENTICAL on the default path (date not changed here): applyScope(rows,
 * EMPTY) is a copy of the same row objects in the same order, and engineInputs above
 * passes screen-upload's engineOpts() verbatim, so compute() returns exactly what the
 * upload screen cached. The chips (stampDeltas here, applyWindowDeltas on generate) and
 * the unscoped history panel read model.scopedRows, so they count the same population.
 *
 * FALLBACK: no rows, no engine, or a compute failure → the upload's cached output (or
 * the mock), exactly as before — but only when UNSCOPED. A scoped build that cannot
 * compute THROWS: publishing the full numbers under a «مخصص» label is the one outcome
 * worse than an error, so the caller (modelFor) falls back to the full report and says so.
 * EXPORTED so node can pin both paths without a DOM. Never logs a row.
 * @returns {{reportDate:string, kpi:Object, sendout:(Object|null), scope:Object,
 *   scopedRows:(Array|null), shipmentDetails:Array}} contract [C]'s model fields */
export function buildOrderFigures(state, store, scope, compute) {
  const sc = normalizeScope(scope);
  const scoped = isScoped(sc);
  const { tat, opts } = engineInputs(state, store && store.settings, sc);
  const allRows = allRowsOf(state);
  const scopedRows = allRows ? applyScope(allRows, sc) : null;

  let kpi = null;
  if (scopedRows && typeof compute === 'function') {
    try {
      const out = compute(scopedRows, tat, opts);
      if (out && out.totals) kpi = out;
    } catch (e) {
      console.warn('[review] engine recompute failed', e && e.message);
    }
  }
  if (!kpi) {
    if (scoped) throw new Error('scoped figures unavailable (engine did not run)');
    kpi = state.engineOutput || buildMockEngineOutput(store && store.settings);
  }

  return {
    reportDate: opts.asOf,
    kpi,
    // Send-out attribution runs off the (scoped) order rows, not the engine output.
    // Guarded: no parsed orders (mock/tracker-only session) -> no send-out block,
    // and build-spec omits both slides instead of drawing empty ones.
    sendout: sendoutFor(scopedRows, state.sendoutMaster || null, scoped ? { inferBlanks: false } : undefined),
    // Contract [C]: EMPTY_SCOPE when unscoped (build-spec, pipeline and the file names
    // all treat it as "the full report"); the normalised scope otherwise.
    scope: scoped ? sc : EMPTY_SCOPE,
    // The rows the numbers above came from — all rows when unscoped. The chips
    // (stampDeltas here, applyWindowDeltas on generate) and the unscoped history panel
    // read THIS field, so every surface of the deck counts the same population. The
    // per-lab Late & Due workbooks deliberately do NOT: they are operational chase lists
    // and screen-generate always builds them from the full state.parsed.orders.
    scopedRows,
    shipmentDetails: (sc.shipments.length && scopedRows) ? shipmentDetails(scopedRows, sc.shipments) : [],
  };
}

/* A FRESH model object whenever the figures went stale (see figuresFor): a changed
 * scope, a changed report date, reloaded data, or an engine setting edited in Settings.
 * Shallow copy of the old
 * one — the operator's edits (tasks, support lines, challenges, risks) are not
 * order-based and carry over untouched — with the order figures rebuilt. NEVER a swap of
 * model.kpi in place: render() captures `const kpi = model.kpi` for the override card and
 * the banner, so a changed number set must arrive as a new model + ctx.rerender().
 * deltaWindow is dropped because it described the OLD kpi; render() re-stamps it.
 * dropOverrides: a manual override typed against one population means nothing for
 * another, so a scope change clears them (a date change, a reload or a Settings edit
 * that keeps the scope keeps them, as the model always has). */
function refreshedModel(prev, state, store, compute, { dropOverrides = false } = {}) {
  const next = { ...prev, ...buildOrderFigures(state, store, state.scope, compute) };
  delete next.deltaWindow;
  if (dropOverrides) next.overrides = {};
  return next;
}

/* Assemble an editable ReportModel: the order figures above + tracker + settings.
 * Task splitting/panels go through model/drafts.js autoDraft — the CANONICAL
 * rule (internal = فئة التقرير 'لين'). A local regex here once diverged and
 * rendered the internal variant's task table empty with real tracker data. */
function buildDraftReportModel(state, store, compute) {
  const figures = buildOrderFigures(state, store, currentScope(state), compute);
  const tracker = state.parsed.tracker || buildMockTracker();
  // The task slides are NOT order-based, so scope never touches them: they are drafted
  // for the CHOSEN report date even when a range moves the deck's date to its end. A
  // scoped run writes no taskLog (pipeline.js recordRunSnapshot), so no grace is spent.
  const taskDate = state.reportDate || todayISO();

  let d;
  try {
    // settings.taskLog carries the closed-task grace state (model/task-lifecycle.js).
    d = autoDraft(tracker, taskDate, { taskLog: store.settings && store.settings.taskLog });
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
    // reportDate, kpi, sendout, scope, scopedRows, shipmentDetails — see buildOrderFigures.
    ...figures,
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

/* WHAT A MODEL'S FIGURES WERE COMPUTED FOR — (scope, data, engine inputs) — kept in a
 * module-scope WeakMap keyed by the model object, so the model carries nothing extra
 * into build-spec or the generate screen. modelFor() compares it with what the operator
 * has chosen NOW and rebuilds on any difference. That one comparison covers every way
 * the figures go stale:
 *   • a scope change (scopeKey: the row filters; the shipment-slide flag is not one);
 *   • ANY data reload that did not drop state.reportModel — the app-bar home button
 *     returns here with the old model — because the data part is the orders array's
 *     identity (state.scopeEpoch, see currentScope), which moves on every reload, a
 *     same-shape re-pull included;
 *   • a report-date change (the debounced rerender below, a generate click inside the
 *     debounce, or a navigation away and back before it fired) and a Settings edit to an
 *     engine input — both through engineInputs(), whose tat + opts are fingerprinted
 *     whole (the date is opts.asOf).
 * WHY A CACHE AT ALL, when compute() is cheap (measured 2026-09-29: ≈2 ms on the 628-row
 * golden fixture, ≈40 ms on 12.5k rows; the JSON fingerprint of the ~4 KB TAT table is
 * µs): a cache hit hands back the SAME model object, so a plain re-render (navigation, a
 * rerender for view reasons) and the generate click never trade the object the operator
 * is editing for a copy, and a real export pays the compute only when an input moved.
 * A model this module did not build (absent from the map) is always rebuilt. */
const figuresFor = new WeakMap();
const figuresKeyOf = (state, store) => {
  const { tat, opts } = engineInputs(state, store && store.settings, state.scope);
  return `${scopeKey(state.scope)}|${state.scopeEpoch || 0}|${JSON.stringify([tat, opts])}`;
};

// The pending report-date refresh (see the date input's change handler). Module scope
// so the NEXT render can cancel one left behind by the screen it replaces.
let dateRefreshTimer = 0;

/* The ReportModel for this render, rebuilt when its figures are stale (see figuresFor).
 * Also the gate the generate button goes through, so a click inside the date debounce
 * can never ship numbers computed for the previous date.
 * SCOPED FIGURES THAT CANNOT BE COMPUTED (no engine, or it failed) → back to the FULL
 * report with an error that names the scope: buildOrderFigures refuses to label the full
 * numbers «مخصص», and a scope that silently did nothing would be the same lie told the
 * other way round. The generate button checks the scope it gets back against the one on
 * screen, so a click can never publish that swap unseen either. */
function modelFor(state, store, compute) {
  currentScope(state);
  const prev = state.reportModel || null;
  const want = figuresKeyOf(state, store);
  if (prev && figuresFor.get(prev) === want) return prev;
  // Asked per attempt, not once: the fallback below resets the scope, and a scope that
  // falls back to the one prev already had is no scope change — its overrides stay and
  // no «overrides cleared» toast claims otherwise.
  const scopeChanged = () => !!prev && scopeKey(prev.scope) !== scopeKey(state.scope);
  const build = () => (prev
    ? refreshedModel(prev, state, store, compute, { dropOverrides: scopeChanged() })
    : buildDraftReportModel(state, store, compute));
  let next;
  try {
    next = build();
  } catch (e) {
    console.warn('[review] scoped figures unavailable; showing the full report', e && e.message);
    state.scope = EMPTY_SCOPE;
    // Specific, not the bare «خطأ»: the operator must learn that the SCOPE was dropped
    // and the full report is what they are now looking at.
    const SC = STR.review.scope;
    toast(str('scope', 'failed', `${STR.common.error}: ${SC.title} — ${SC.reset}`), 'err');
    // Falling back to the very figures prev already carries (the usual case: a scope
    // tried on the full report) keeps prev itself — no second compute, no new object.
    // Otherwise rebuild unscoped, which never throws: a compute, else the cached engine
    // output, else the mock.
    next = (prev && figuresFor.get(prev) === figuresKeyOf(state, store)) ? prev : build();
  }
  if (scopeChanged() && prev.overrides && Object.keys(prev.overrides).length) {
    toast(str('scope', 'overridesCleared'), 'warn');
  }
  figuresFor.set(next, figuresKeyOf(state, store));
  state.reportModel = next;
  return next;
}

/* Report-date change → RE-DECIDE the مغلق rows (bug fix 2026-08-04).
 *
 * The task lists are drafted ONCE (modelFor drafts only when there is no model; every later
 * rebuild — scope, date, data or an engine setting — COPIES them forward via
 * refreshedModel), but
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


/* STR.review[group][key] — the send-out and scope strings live in ar.js (the round-1
 * PENDING_STR stop-gap is gone). Read through this one null-safe lookup rather than a
 * bare property chain so a key ar.js does not carry (yet) degrades to `fallback` instead
 * of throwing out of render(); a fallback is only ever composed from strings ar.js
 * already has — never a new literal here. */
function str(group, key, fallback) {
  const g = STR.review && STR.review[group];
  return g && g[key] != null ? g[key] : fallback;
}

/** Orders grouped by keyOf(item), busiest group first (ties keep first-seen order),
 *  each with its per-test counts. `orderOf` unwraps a {order, …} attribution entry. */
function groupOrders(items, keyOf, orderOf = (x) => x) {
  const groups = new Map();
  for (const it of items || []) {
    const key = keyOf(it);
    let g = groups.get(key);
    if (!g) { g = { first: it, n: 0, tests: new Map() }; groups.set(key, g); }
    g.n += 1;
    const o = orderOf(it);
    const t = (o && o.testName) || '—';
    g.tests.set(t, (g.tests.get(t) || 0) + 1);
  }
  return [...groups.values()].sort((a, b) => b.n - a.n);
}

/** One group line: caption nodes, '— N طلبًا', then its tests with counts. */
function orderGroupItem(caption, g) {
  return el('li', { style: 'margin-bottom:4px' }, [
    ...caption,
    el('span', { class: 'small muted', text: ` — ${str('sendout', 'orders', String)(g.n)}` }),
    el('div', { class: 'small muted', dir: 'auto', style: 'margin-inline-start:10px' },
      [[...g.tests.entries()].map(([t, n]) => `${t} (${n})`).join('، ')]),
  ]);
}

/* Send-out orders that could NOT be attributed to a country. These are kept OFF
 * the slides deliberately — a wrong country is worse than a missing row — so the
 * only way the gap ever gets fixed is if the reviewer is told about it HERE,
 * before generating. Silence would let a master-file hole persist for months.
 * TWO SECTIONS, because the two causes need different fixes and the old single hint
 * sent reviewers to correct a supplier file that was already right:
 *   unmapped   — no country could be pinned from the lab name OR the test name (a blank
 *                lab, an unlinked lab whose test sits under no single supplier, …);
 *   unresolved — the vendor is known (several countries) but not for THIS test.
 * The exact cases live next to their hints in i18n/ar.js — change the two together.
 * Reads the model's (possibly scoped) send-out analysis, so a scoped deck lists only
 * the gaps of the orders it covers. Returns null when everything attributed cleanly,
 * which is the normal case. */
function sendoutGapsCard(model) {
  const so = model && model.sendout;
  if (!so) return null;
  const sections = [
    [so.unmapped, str('sendout', 'unmappedHint')],
    [so.unresolved, str('sendout', 'unresolvedHint')],
  ].filter(([list]) => Array.isArray(list) && list.length);
  if (!sections.length) return null;

  const noLab = str('sendout', 'noLab');
  const labOf = (o) => (o && o.facility) || noLab;
  return el('div', {
    class: 'card',
    style: 'border:1px solid var(--amber);background:var(--warn-bg,#FEF3C7);color:var(--warn-text,#92400E)',
  }, [
    el('div', { class: 'card__title', text: str('sendout', 'gapsTitle') }),
    ...sections.map(([list, hint], i) => el('div', {
      style: i ? 'margin-top:12px;padding-top:10px;border-top:1px dashed var(--amber)' : '',
    }, [
      el('p', { class: 'small', style: 'margin:0 0 6px', text: hint }),
      el('ul', { style: 'margin:0;padding-inline-start:18px' },
        groupOrders(list, labOf).map((g) => orderGroupItem(
          [el('span', { style: 'font-weight:700', dir: 'auto', text: labOf(g.first) })], g))),
    ])),
  ]);
}

/* Orders attributed by TEST NAME (sendout.js byTestName): the facility name matched no
 * catalogue vendor, but the test sits under exactly one vendor+country, so the order IS
 * on the slides — under its own lab name. NOT a gap, so INFORMATIONAL styling (a plain
 * card with a blue stripe), never the amber warning above: an attributed order dressed
 * as a problem teaches reviewers to ignore the card that lists real ones. Still shown,
 * because the lab name needs its alias (FACILITY_TO_VENDOR) and nobody adds one for a
 * mapping they never saw. Grouped by lab AND country: one lab's tests can land in two. */
function sendoutByTestNameCard(model) {
  const list = model && model.sendout && model.sendout.byTestName;
  if (!Array.isArray(list) || !list.length) return null;
  const SEP = '\u001F'; // lab/country names contain spaces — same trick as sendout.js keyOf
  const groups = groupOrders(list, (b) => `${b.lab}${SEP}${b.country}`, (b) => b.order);
  return el('div', {
    class: 'card',
    style: 'border-inline-start:4px solid var(--blue)',
  }, [
    el('div', { class: 'card__title' }, [
      el('span', { text: 'ℹ︎', style: 'color:var(--blue)' }),
      el('span', { text: str('sendout', 'byTestNameTitle') }),
    ]),
    el('p', { class: 'small muted', style: 'margin:0 0 6px', text: str('sendout', 'byTestNameHint') }),
    el('ul', { style: 'margin:0;padding-inline-start:18px' }, groups.map((g) => orderGroupItem([
      el('span', { style: 'font-weight:700', dir: 'auto', text: g.first.lab }),
      el('span', { class: 'small muted', text: ` · ${AR_COUNTRY[g.first.country] || g.first.country}` }),
    ], g))),
  ]);
}

export async function render(container, ctx) {
  const { state, store, navigate } = ctx;

  if (!state.reportDate) state.reportDate = todayISO();
  // The send-out catalogue ships encrypted; decrypt it ONCE per session with the
  // key the access seal unsealed at sign-in. Cached on state so re-renders (and
  // the model re-draft after a new upload) do not re-fetch. Resolves to null on
  // any failure, which simply omits the two slides.
  if (state.sendoutMaster === undefined) {
    const dataKey = ((store.settings || {}).grafana || {}).dataKey || '';
    const mod = await tryImport('../ingest/sendout-master.js?v=v2026-09-29.1');
    state.sendoutMaster = (mod && mod.loadSendoutMaster)
      ? await mod.loadSendoutMaster(dataKey)
      : null;
  }
  // Our own rerender (scope / report-date change) left the operator's place here.
  const restore = view.restore;
  view.restore = null;
  clearTimeout(dateRefreshTimer); // a pending date refresh belongs to the screen being replaced
  // Guarded exactly like the upload screen's hero run: no engine → the full report is the
  // upload's cached output, and a scope falls back to it with an error (modelFor).
  // ctx.compute is a DEV-HARNESS seam only (test/review-harness.html wraps the real
  // engine to count runs and to fail a scoped build on demand); main.js never sets it,
  // so the app always takes the guarded import.
  const compute = typeof ctx.compute === 'function'
    ? ctx.compute
    : pickFn(await tryImport('../engine/engine.js?v=v2026-09-29.1'), ['compute', 'runEngine', 'run']);
  const model = modelFor(state, store, compute);
  { // settings may have been edited since the model was drafted — re-source them
    const s = store.settings || {};
    if (s.scorecard) model.scorecard = s.scorecard;
    if (s.displayNames) model.displayNames = s.displayNames;
  }
  // reportOptions (slides / kpiCards / excludeNoTat / labels / deltaMode) lives in the
  // shared settings doc and BOTH screens write it — the Settings checkboxes autosave and
  // this screen's chips/pills call persistReportOptions. So re-source the WHOLE thing from
  // settings on every render, not just deltaMode: the model is drafted once and then only
  // COPIED forward (refreshedModel: a scope, date, data or engine-setting change) until
  // the upload screen's «متابعة» drops it, so its reportOptions go stale against any
  // Settings edit made
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
  const dwMod = await tryImport('../model/delta-window.js?v=v2026-09-29.1');
  const stampWindow = dwMod && dwMod.stampWindowDeltas;
  // The chips need the parsed CSV rows: with no upload in this session (mock preview)
  // stampWindowDeltas leaves the engine's deltas alone and stamps no window, and the
  // banner/legend fall back to their undated wording.
  // WHICH rows: model.scopedRows — the rows the big numbers came from (all rows when
  // unscoped) — chosen by the SAME rule as pipeline.js applyWindowDeltas, which re-stamps
  // this model on generate: an array (even an empty one, a scope that matched nothing) is
  // honoured, anything else falls back to the parsed orders. Different rules here and
  // there would make the preview's chips and the generated deck's disagree.
  const stampRows = () => (Array.isArray(model.scopedRows)
    ? model.scopedRows
    : ((state.parsed && state.parsed.orders) || null));
  const stampDeltas = () => {
    if (typeof stampWindow !== 'function') return;
    stampWindow(model, {
      rows: stampRows(),
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
    // A range's END when one is active (the deck is dated 'to'), else the chosen date.
    model.reportDate = effectiveReportDate(state, model.scope);
    stampDeltas(); // re-window the chips for the current report date (pure → idempotent)
    const specMod = await tryImport('../slidespec/build-spec.js?v=v2026-09-29.1');
    const buildSpec = pickFn(specMod, ['buildSpec', 'build', 'makeSpec', 'toSpec']);
    const rendMod = await tryImport('../render/html-renderer.js?v=v2026-09-29.1');
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
    // After our own rerender, return to the slide the operator was looking at (two
    // frames: applyScale sizes the viewport in the first, goTo measures in the second).
    if (pendingSlide != null) {
      const i = pendingSlide;
      pendingSlide = null;
      requestAnimationFrame(() => requestAnimationFrame(() => goTo(i)));
    }
  }
  let pendingSlide = (restore && Number.isInteger(restore.slide)) ? restore.slide : null;

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

  /* ---------- Rerender (scope / report-date change) ---------- */
  // A changed number set arrives as a FRESH model + a full rerender (see refreshedModel:
  // `kpi` above is captured once and read by the override card and the banner). The
  // operator's place is handed to the next render through view.restore.
  //
  // THE MODEL ON SCREEN IS THE ONE TO BUILD ON. state.reportModel is SHARED: an automation
  // run started from the upload screen's panel writes ITS model there (pipeline.js
  // stepEngine) while this screen can still be open, and modelFor() starts from whatever
  // state.reportModel holds. So every path that leaves this render to rebuild on purpose
  // — a scope change, the date debounce, the generate click — first puts back the model
  // the operator is LOOKING AT and editing; modelFor then refreshes its figures if they
  // are stale (new data included) and carries the operator's edits forward. Without it
  // the automation's model — its support lines, task tables and overrides, not the
  // operator's — is what the next render shows, or worse, what generate publishes.
  const pinShownModel = () => { state.reportModel = model; };
  let scopeCard = null; // the «نطاق التقرير» <details>, when rows exist (built below)
  function rerenderKeepingPlace(extra = {}) {
    clearTimeout(debTimer);
    clearTimeout(dateRefreshTimer);
    view.restore = {
      scrollY: window.scrollY || 0,
      scopeOpen: !!(scopeCard && scopeCard.open),
      historyOpen,
      slide: curSlide,
      ...extra,
    };
    if (typeof ctx.rerender === 'function') ctx.rerender();
    else navigate('review');
  }
  /** Adopt a new scope. modelFor() (next render) sees the key change and rebuilds the
   *  figures — the one path, whether the scope grew, shrank or was reset. */
  function setScope(next) {
    const sc = normalizeScope(next);
    if (JSON.stringify(sc) === JSON.stringify(normalizeScope(state.scope))) return;
    state.scope = sc;
    pinShownModel();
    rerenderKeepingPlace();
  }

  /* ---------- Controls ---------- */
  const SC = STR.review.scope;
  // A RANGE OWNS THE DATE: the deck is dated 'to' and every number is evaluated as of it,
  // so the report-date input shows 'to' and is locked; «إعادة ضبط» (or clearing the range)
  // hands it back, still holding the date the operator had chosen (state.reportDate).
  const ranged = hasRange(model.scope);
  const dateInput = el('input', {
    type: 'date', value: ranged ? model.scope.to : state.reportDate,
    disabled: ranged, title: ranged ? SC.range : null,
  });
  dateInput.addEventListener('change', () => {
    if (hasRange(model.scope)) return; // locked by the range (see above)
    const prevDate = state.reportDate;
    state.reportDate = dateInput.value || todayISO();
    model.reportDate = state.reportDate; // sync immediately — generate must never see a stale date
    dateHint.textContent = formatDateAr(state.reportDate);
    if (state.reportDate === prevDate) return;
    // The مغلق rows are date-dependent (see reconcileGraceRows): re-decide them for the
    // new date and remount the affected tables, so what the operator reviews is exactly
    // what generate publishes AND what recordShownTasks then writes under that date.
    // They are reconciled on THIS model, which the refresh below copies forward.
    if (reconcileGraceRows(model, state, store, prevDate)) {
      mountCurrentTable();
      mountInternalTable();
      toast('تم تحديث المهام المغلقة حسب تاريخ التقرير الجديد', 'ok');
    }
    // THE NUMBERS MOVE WITH THE DATE (bug fix 2026-09-29, full AND scoped report). This
    // handler used to re-stamp the chips only, so every as-of number — late vs on-time
    // above all — stayed computed for the date chosen on the upload screen. modelFor()
    // now recomputes the engine for the new date (it is opts.asOf in the figures key);
    // the chips, the banner's window, the history anchor and the preview all follow in
    // the same rerender, so none of them can lag the others (the 2026-08-05
    // banner-vs-deck finding cannot recur). DEBOUNCED: typing a date by keyboard fires
    // 'change' per completed segment, and a rerender mid-typing would steal the field.
    // A generate click inside the debounce goes through modelFor() itself.
    clearTimeout(dateRefreshTimer);
    dateRefreshTimer = setTimeout(() => {
      dateRefreshTimer = 0;
      // Navigated away meanwhile → no rerender of someone else's screen; the next
      // render of this one rebuilds anyway (the figures key carries the date).
      if (!screenRoot.isConnected) return;
      pinShownModel();
      rerenderKeepingPlace({ focusDate: document.activeElement === dateInput });
    }, 450);
  });
  const dateHint = el('div', {
    class: 'hint',
    text: ranged ? `${SC.range}: ${formatRangeAr(model.scope.from, model.scope.to)}` : formatDateAr(state.reportDate),
  });

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
    const specMod = await tryImport('../slidespec/build-spec.js?v=v2026-09-29.1');
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
      // Generate carries THE MODEL ON SCREEN (see pinShownModel), never whatever an
      // automation run left in the shared state.reportModel meanwhile. modelFor then
      // rebuilds its figures only if they went stale — a report-date change still inside
      // its debounce, above all — and is a no-op otherwise, so generate can never receive
      // figures computed for the previous date. The scope fields (scope / scopedRows /
      // shipmentDetails) ride along on the model untouched: generate, pipeline.js and
      // build-spec read them from there, never from state.scope.
      clearTimeout(dateRefreshTimer);
      pinShownModel();
      const epoch = state.scopeEpoch;
      const m = modelFor(state, store, compute);
      // …but it must still be the REPORT on screen. A click-time rebuild can come back
      // with a different scope: the scoped build failed and modelFor fell back to the full
      // report (it has said so), or the data was reloaded under the screen and the scope,
      // bound to the old rows, was dropped. Navigating on would publish a report the
      // operator never saw — a full one, which IS recorded to the history and the task
      // log, where they were looking at a side report. Stop and show what it would be.
      if (scopeKey(m.scope) !== scopeKey(model.scope)) {
        if (state.scopeEpoch !== epoch) {
          toast(str('scope', 'dataChanged', `${STR.common.warning}: ${SC.title} — ${SC.reset}`), 'warn');
        }
        genButton.disabled = false;
        rerenderKeepingPlace(); // no pin: m, already in state.reportModel, is the one to show
        return;
      }
      m.reportDate = effectiveReportDate(state, m.scope); // beat the 260ms preview debounce
      // Settings edited after the model was drafted (scorecard, display names)
      // must reach the generated files.
      const s = store.settings || {};
      m.scorecard = s.scorecard || m.scorecard;
      m.displayNames = s.displayNames || m.displayNames;
      state.reportModel = m;
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
  // open/closed state is preserved across rebuilds (and across our own rerender, via
  // view.restore). Numbers come from engine/asof.js (guarded inside the panel →
  // published-history-only, chart hidden).
  // HIDDEN WHEN SCOPED, with one line saying why: the panel interleaves the rows' as-of
  // numbers with snapshotHistory — the PUBLISHED full reports — so under a scope it would
  // set one lab's (or one week's) figures beside the programme's as if they were one
  // series. The unscoped panel reads model.scopedRows (all rows) like everything else.
  const historyHost = el('div', { class: 'history-host' });
  let historyOpen = !!(restore && restore.historyOpen);
  function renderHistory() {
    historyHost.innerHTML = '';
    if (isScoped(model.scope)) {
      historyHost.appendChild(el('div', { class: 'card', style: 'padding:12px 16px' }, [
        el('p', { class: 'small muted', text: str('scope', 'historyHidden') }),
      ]));
      return;
    }
    const s = store.settings || {};
    const panel = buildHistoryPanel({
      rows: stampRows(),
      tatTests: s.tatLookup || {},
      history: s.snapshotHistory || {},
      endIso: effectiveReportDate(state, model.scope),
      deltaMode: normalizeDeltaMode(model.reportOptions.deltaMode),
    });
    panel.open = historyOpen;
    panel.addEventListener('toggle', () => { historyOpen = panel.open; });
    historyHost.appendChild(panel);
  }
  renderHistory();

  /* ---------- «نطاق التقرير» — the report SCOPE card (2026-09-29) ---------- */
  // Narrows the ORDER ROWS before any number exists (model/scope.js applyScope): every
  // order-based slide follows; the task / challenge slides are not row-based and do not.
  // The card never computes a number itself — each control writes state.scope through
  // setScope → rerender → modelFor, the one path that builds figures. CHOICES are made
  // against ALL rows (the lab list, the shipment lookup): only the numbers are scoped, so
  // picking one lab never makes another lab's chip vanish. Absent when there are no rows.
  // EVERY HANDLER BUILDS ITS NEXT SCOPE FROM THE LIVE state.scope (live(), read at event
  // time), never from `sc`, the snapshot this render painted from: the shipment-slide box
  // changes state.scope WITHOUT a rerender, so a handler spreading the snapshot turned the
  // box back on at the operator's next lab chip or range apply (review 2026-09-29).
  // «العودة للتقرير الكامل» alone does not: it is the reset to EMPTY_SCOPE, box included.
  const allRows = allRowsOf(state);
  const live = () => normalizeScope(state.scope);
  function buildScopeCard() {
    const sc = live();                        // PAINT only: the controls' state (incl. the slide box)
    const ms = model.scope || EMPTY_SCOPE;    // what the numbers were computed for
    const draft = view.draft;
    if (draft.epoch !== state.scopeEpoch) {   // typed-but-unapplied input dies with its data
      draft.epoch = state.scopeEpoch; draft.shipText = null; draft.from = null; draft.to = null;
    }

    // (d) What is in force + the way back to the full report — first, so it is never
    // scrolled past. A long shipment list is cut: the line is a reminder, not the list.
    let active = null;
    if (isScoped(ms)) {
      const parts = [];
      if (ms.labs.length) parts.push(`${SC.labs}: ${ms.labs.join('، ')}`);
      if (ms.shipments.length) {
        const more = ms.shipments.length - SCOPE_MAX_IDS;
        parts.push(`${SC.shipments}: ${ms.shipments.slice(0, SCOPE_MAX_IDS).join('، ')}${more > 0 ? ` (+${more})` : ''}`);
      }
      if (hasRange(ms)) parts.push(`${SC.range}: ${formatRangeAr(ms.from, ms.to)}`);
      active = el('div', { style: SCOPE_ACTIVE_STYLE }, [
        el('div', { style: 'min-width:0;flex:1 1 220px' }, [
          el('div', { style: 'font-weight:800;margin-bottom:2px', text: SC.active }),
          ...parts.map((p) => el('div', { class: 'small', style: 'overflow-wrap:anywhere', text: p })),
        ]),
        el('button', {
          type: 'button', class: 'btn btn--ghost btn--sm', text: SC.reset,
          onClick: () => { draft.shipText = null; draft.from = null; draft.to = null; setScope(EMPTY_SCOPE); },
        }),
      ]);
    }

    // (a) LABS — «كل المختبرات» is not a lab, it is the ABSENCE of a lab filter: it lights
    // up exactly when none is chosen, choosing any lab turns it off, and un-choosing the
    // last lab turns it back on (labs: [] ⇔ all). Counts are NON-cancelled lines over all
    // rows (labOptions), busiest first. A chosen lab the list does not carry keeps a chip
    // anyway — defensive only (the scope is bound to this very orders array, so the list
    // cannot have moved under it), but a filter must never be active and invisible.
    const opts = labOptions(allRows);
    for (const lab of sc.labs) if (!opts.some((o) => o.lab === lab)) opts.push({ lab, count: 0 });
    const chip = (label, count, on, onClick) => el('button', {
      type: 'button', 'aria-pressed': on ? 'true' : 'false', style: scopeChipStyle(on), onClick,
      // One spoken name for the two visual parts (the Latin lab name + its count pill).
      'aria-label': count == null ? label : `${label} (${count})`,
    }, [
      el('span', { dir: 'auto', text: label }),
      count == null ? null : el('span', { dir: 'ltr', style: SCOPE_COUNT_STYLE, text: String(count) }),
    ]);
    const labsSection = el('div', { class: 'field', style: 'margin:0 0 16px' }, [
      el('label', { text: SC.labs }),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, [
        chip(SC.allLabs, null, !sc.labs.length, () => setScope({ ...live(), labs: [] })),
        ...opts.map((o) => chip(o.lab, o.count, sc.labs.includes(o.lab), () => {
          const cur = live();
          setScope({
            ...cur,
            labs: cur.labs.includes(o.lab) ? cur.labs.filter((l) => l !== o.lab) : [...cur.labs, o.lab],
          });
        })),
      ]),
    ]);

    // (b) SHIPMENTS — checked against ALL rows (findShipments), because the question is
    // "did you type it right", not "is it inside the other filters". Any id not in the
    // data stops the apply and asks, IN PAGE (no window.confirm — it blocks the tab and
    // cannot be styled or read back by a screen reader the same way): proceed with the
    // ids that exist, or go back and fix the text, which is kept exactly as typed. An
    // empty box clears the shipment filter.
    // Inherits the page's RTL on purpose: dir=auto would lay the Arabic «مثال:» placeholder
    // out LTR, and a typed id list is one LTR run either way (the separators between two
    // Latin ids resolve LTR), so it reads correctly without it.
    const shipText = el('textarea', {
      rows: 3, placeholder: SC.shipmentsPlaceholder, 'aria-label': SC.shipments,
    });
    shipText.value = draft.shipText != null ? draft.shipText : sc.shipments.join('\n');
    const missingHost = el('div');
    // Editing the ids closes an open «missing ids» question: its «المتابعة بدونها» would
    // otherwise apply the list parsed at the FIRST apply, not the text now in the box.
    shipText.addEventListener('input', () => { draft.shipText = shipText.value; missingHost.innerHTML = ''; });
    const applyShipments = (ids) => {
      missingHost.innerHTML = '';
      shipText.value = ids.join('\n');
      draft.shipText = null;
      setScope({ ...live(), shipments: ids });
    };
    function missingDialog(found, missing) {
      const recheck = el('button', {
        type: 'button', class: 'btn btn--ghost btn--sm', text: SC.recheck,
        onClick: () => { missingHost.innerHTML = ''; shipText.focus(); },
      });
      const proceed = el('button', {
        type: 'button', class: 'btn btn--primary btn--sm', text: SC.proceed,
        disabled: !found.length, onClick: () => applyShipments(found),
      });
      const box = el('div', {
        class: 'panel-warn', role: 'alertdialog', 'aria-labelledby': 'scope-missing-title',
        style: 'margin:10px 0 0',
      }, [
        el('div', { class: 'panel-warn__title', id: 'scope-missing-title', text: SC.notFoundTitle }),
        el('p', { class: 'small', style: 'overflow-wrap:anywhere', text: SC.notFoundBody(missing) }),
        found.length ? null : el('p', { class: 'small', style: 'font-weight:700;margin-top:6px', text: SC.noneFound }),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, [proceed, recheck]),
      ]);
      box.addEventListener('keydown', (e) => { if (e.key === 'Escape') recheck.click(); });
      // Focus the NON-committing answer: Enter on a freshly shown question must not apply.
      requestAnimationFrame(() => recheck.focus());
      return box;
    }
    const onApplyShipments = () => {
      const ids = parseShipmentIds(shipText.value);
      if (!ids.length) { applyShipments([]); return; }
      const { found, missing } = findShipments(allRows, ids);
      if (!missing.length) { applyShipments(found); return; }
      missingHost.innerHTML = '';
      missingHost.appendChild(missingDialog(found, missing));
    };
    // The «تفاصيل الشحنات» slide switch. Presentation only (which slides, not which
    // rows), so no rebuild: state.scope and model.scope both take the flag and the preview
    // redraws. The flag is not part of scopeKey, so the figures key still matches and a
    // later generate click or render keeps this very model (and its overrides).
    // .checked is set imperatively — el() drops a false attribute (see autoDlCheck).
    const slideCheck = el('input', {
      type: 'checkbox', 'aria-label': SC.shipmentSlide,
      style: 'width:18px;height:18px;flex:0 0 auto;accent-color:var(--navy)',
    });
    slideCheck.checked = sc.shipmentSlide !== false;
    slideCheck.addEventListener('change', () => {
      state.scope = normalizeScope({ ...state.scope, shipmentSlide: slideCheck.checked });
      if (isScoped(model.scope)) {
        model.scope = normalizeScope({ ...model.scope, shipmentSlide: slideCheck.checked });
      }
      schedulePreview();
    });
    // Ids that exist in the data but have no row once the labs / range are applied: the
    // deck cannot show them, and the operator should hear it here, not from the deck.
    const outside = ms.shipments.filter((id) => !(model.shipmentDetails || []).some((d) => d && d.id === id));
    const shipSection = el('div', { class: 'field', style: 'margin:0 0 16px' }, [
      el('label', { text: SC.shipments }),
      shipText,
      el('div', { class: 'hint', text: SC.shipmentsHint }),
      el('div', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px' }, [
        el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: SC.shipmentsApply, onClick: onApplyShipments }),
        el('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;font-size:.85rem;color:var(--slate-600)' }, [
          slideCheck, el('span', { text: SC.shipmentSlide }),
        ]),
      ]),
      missingHost,
      outside.length ? el('p', { class: 'small', style: SCOPE_INFO_STYLE, text: SC.outsideScope(outside) }) : null,
    ]);

    // (c) DATE RANGE — both ends or neither (normalizeScope would silently drop a half
    // range, so the pair is validated HERE, where the operator can be told): from ≤ to,
    // and 'to' not after today — the report is evaluated as of 'to', and an as-of in the
    // future would count every open line late against a day that has not happened. Both
    // boxes empty clears the range.
    const today = todayISO();
    const fromInput = el('input', { type: 'date', max: today, 'aria-label': SC.from });
    const toInput = el('input', { type: 'date', max: today, 'aria-label': SC.to });
    fromInput.value = draft.from != null ? draft.from : (sc.from || '');
    toInput.value = draft.to != null ? draft.to : (sc.to || '');
    const rangeErr = el('p', { class: 'small', role: 'alert', style: 'display:none;margin:6px 0 0;color:var(--red);font-weight:700' });
    const onRangeInput = () => { draft.from = fromInput.value; draft.to = toInput.value; rangeErr.style.display = 'none'; };
    fromInput.addEventListener('input', onRangeInput);
    toInput.addEventListener('input', onRangeInput);
    const onApplyRange = () => {
      const from = fromInput.value;
      const to = toInput.value;
      const fail = (msg) => { rangeErr.textContent = msg; rangeErr.style.display = ''; };
      if (!from && !to) { draft.from = null; draft.to = null; setScope({ ...live(), from: null, to: null }); return; }
      if (!from || !to || from > to || !hasRange({ from, to })) { fail(SC.rangeInvalid); return; }
      if (to > todayISO()) { fail(SC.rangeFuture); return; }
      draft.from = null; draft.to = null;
      setScope({ ...live(), from, to });
    };
    const dateBox = (label, input) => el('div', { style: 'flex:1 1 140px;min-width:0' }, [
      el('div', { class: 'small', style: 'font-weight:600;color:var(--slate-600);margin-bottom:4px', text: label }),
      input,
    ]);
    const rangeSection = el('div', { class: 'field', style: 'margin:0' }, [
      el('label', { text: SC.range }),
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end' }, [
        dateBox(SC.from, fromInput),
        dateBox(SC.to, toInput),
        el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: SC.rangeApply, onClick: onApplyRange }),
      ]),
      rangeErr,
    ]);

    const card = el('details', { class: 'card scope-card' }, [
      el('summary', { class: 'card__title', style: 'cursor:pointer;margin:0;flex-wrap:wrap' }, [
        el('span', { text: SC.title }),
        el('span', { style: scopePillStyle(isScoped(ms)), text: isScoped(ms) ? SC.active : SC.allLabs }),
      ]),
      el('div', { style: 'margin-top:14px' }, [active, labsSection, shipSection, rangeSection]),
    ]);
    // Open while a scope is in force (the operator must see what narrows the deck);
    // otherwise collapsed — the daily run is the full report. Our own rerender keeps
    // whatever the operator last chose.
    card.open = restore ? !!restore.scopeOpen : isScoped(ms);
    return card;
  }
  if (allRows) scopeCard = buildScopeCard();
  // (e) SIDE REPORT banner — above everything else on the screen, so a scoped deck can
  // never be generated by someone who did not notice it was scoped. The same sentence is
  // repeated on the generate screen's success panel.
  const sideBanner = isScoped(model.scope) ? el('div', {
    class: 'card', role: 'status',
    style: 'border:1px solid var(--amber);background:var(--warn-bg,#FEF3C7);color:var(--warn-text,#92400E);padding:12px 16px;display:flex;gap:10px;align-items:flex-start',
  }, [
    el('span', { text: '⚠', 'aria-hidden': 'true', style: 'font-size:1.1rem;line-height:1.5' }),
    el('div', { style: 'min-width:0' }, [
      el('div', { style: 'font-weight:800', text: SC.active }),
      el('div', { class: 'small', text: SC.sideReport }),
    ]),
  ]) : null;

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
  // The side-report banner and the scope card come first, full width: they decide what
  // every number below describes. Unattributed send-out orders are surfaced next, above
  // the controls, because this is the last screen before the deck is generated; the
  // by-test-name disclosure follows them in its calmer, informational tone.
  const screenRoot = el('div', { class: 'screen' }, [
    head,
    sideBanner,
    scopeCard,
    sendoutGapsCard(model),
    sendoutByTestNameCard(model),
    el('div', { class: 'review-layout' }, [controls, preview]),
  ]);
  container.appendChild(screenRoot);
  // Back to where the operator was before our own rerender (scope / report-date change).
  if (restore) {
    try { window.scrollTo(0, restore.scrollY || 0); } catch { /* non-window host */ }
    if (restore.focusDate && !dateInput.disabled) dateInput.focus();
  }

  // Observe width changes to keep the scaled preview fitted.
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => applyScale());
    ro.observe(viewport);
  } else {
    window.addEventListener('resize', applyScale);
  }

  renderPreview();
}
