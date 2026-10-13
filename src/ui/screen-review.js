// ui/screen-review.js — review/edit report content with a live slide preview (Track E).
import { STR, todayISO, formatDateAr, formatRangeAr } from '../i18n/ar.js?v=v2026-10-13.5';
import {
  el, editableTable, toast, trackerEditor, trackerSaver, saveTrackerToStore, createProjectTracker,
  trackerLangControl, normalizeTrackerLang, DEFAULT_TRACKER_LANG,
  slideOrderList, slideOrderLabel,
} from './components.js?v=v2026-10-13.5';
// SLIDE ORDER (2026-10-13, slide-order CONTRACT). The unit vocabulary and its rules are the
// shared leaf module's (the deck builders sort by the very same functions, so this card and
// the deck can never disagree about what moves where); WHEN a temporary order is in force is
// state.js's (bound to the load, like the scope). Both are pure and import nothing heavy.
import {
  SLIDE_ORDER_KEYS, normalizeSlideOrder, slideOrderOf, unitOfSlideId, mergeVisibleOrder,
} from '../model/slide-order.js?v=v2026-10-13.5';
import {
  tempSlideOrder, setTempSlideOrder, clearTempSlideOrder, overlayTempSlideOrder, tempSlideOrderUnits,
} from '../state.js?v=v2026-10-13.5';
import { buildMockEngineOutput, isMockTracker } from './screen-upload.js?v=v2026-10-13.5';
// THE PROJECT TRACKER (2026-10-13, tracker CONTRACT §1.3/§1.6): the report carries the
// «ملف متابعة المشروع» document as model.projectTracker, resolved by the model layer's
// ONE rule (the run's tagged tracker, else the tagged cache, else null — never the old
// untagged shape, never a mock). Static: report-model.js is pure, and sendout.js — its
// only import — is already imported below.
import { resolveProjectTracker } from '../model/report-model.js?v=v2026-10-13.5';
import { analyseSendout, hasMaster, AR_COUNTRY } from '../model/sendout.js?v=v2026-10-13.5';
import { buildHistoryPanel } from './history-table.js?v=v2026-10-13.5';
// REPORT SCOPE (2026-09-29). STATIC, not guarded like delta-window below: scope decides
// WHICH ROWS every number is computed from, and there is no safe degraded answer — a
// build that silently ignored a chosen scope would publish the full programme's numbers
// under a «مخصص» label. scope.js is pure (no DOM, no vendor), and ar.js / pipeline.js
// already import it statically, so this adds no new failure mode.
import {
  EMPTY_SCOPE, normalizeScope, isScoped, hasRange, parseShipmentIds, labOptions,
  findShipments, applyScope, shipmentDetails,
} from '../model/scope.js?v=v2026-10-13.5';
import {
  normalizeDeltaMode, isWeekDeltaMode, DEFAULT_DELTA_MODE,
} from '../model/delta-baseline.js?v=v2026-10-13.5';
// REPORT TYPES (2026-10-11): KAMC + SGH (the main weekly report, default) / KAMC / SGH.
// STATIC for scope.js's reason: WHICH hospital's rows a report reads has no safe degraded
// answer, and hospital.js is pure (no imports at all). The per-hospital MODEL builders
// (model/hospital-report.js) are a guarded import inside render(), like the engine they
// depend on — absent, an SGH / KAMC + SGH build throws and modelFor says so.
import { HOSPITALS, HOSPITAL_MODES, rowsForMode } from '../model/hospital.js?v=v2026-10-13.5';

/* small local module helpers (kept local to avoid cross-screen coupling) */
async function tryImport(path) { try { return await import(path); } catch { return null; } }
function pickFn(mod, names) {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function') return mod[n];
  if (typeof mod.default === 'function') return mod.default;
  return null;
}
// The old task split (model/drafts.js) and closed-task grace re-check (task-lifecycle.js)
// were retired with the old tracker (2026-10-13): the new document is shown as it is —
// see buildDraftReportModel and the «متابعة المشروع» editor card.

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

// Challenges / risks — MANUAL content of the single-hospital decks — keep their Arabic
// status words (the project tracker's statuses are the workbook's own, edited as text).
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
    // 'tracker' («متابعة المشروع») replaced 'action' (2026-10-13); absent ⇒ ON anyway.
    slides: { execFunnel: true, monthly: true, compliance: true, tracker: true },
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
    // The tracker slide's task language (Arabic CONTRACT §3): 'ar' | 'en' | 'both'. The
    // seed owns the default ('ar'); an absent / unknown stored value reads as it.
    trackerLang: DEFAULT_TRACKER_LANG,
  };
}

/* Deep-copy settings.reportOptions over the all-on defaults so every key exists.
 * Pure; exported for node tests. */
export function reportOptionsFromSettings(settings) {
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
    trackerLang: normalizeTrackerLang(ro.trackerLang),
    // The SAVED (fixed) slide order — carried only when one is stored: ABSENT means the
    // default (model/slide-order.js), so a unit added in a later version lands in its default
    // place instead of being frozen out by a copy written here. The TEMPORARY order never
    // lives in reportOptions (this object is rebuilt from settings on every render): it is
    // overlaid as model.slideOrder (state.js overlayTempSlideOrder).
    ...(Array.isArray(ro.slideOrder) ? { slideOrder: normalizeSlideOrder(ro.slideOrder) } : {}),
  };
}

/* The persisted reportOptions after a review-screen edit (chips, labels, delta pills, the
 * auto-download box, the tracker language): the STORED doc's keys first (`cur` — this screen
 * only knows the keys it renders, so a straight overwrite would drop the rest), then the
 * screen's own. NEVER slideOrder from `ro`: the saved order is written only by the
 * «ترتيب الشرائح» card's «حفظ كترتيب ثابت» and by Settings, and a temporary order must never
 * ride into settings on a chip click — so the stored order (cur.slideOrder, or its absence)
 * passes through untouched. Pure; exported for node tests (the guard is pinned there). */
export function mergeReportOptions(cur, ro) {
  const base = (cur && typeof cur === 'object') ? cur : {};
  const r = (ro && typeof ro === 'object') ? ro : {};
  return {
    ...base,
    excludeNoTat: !!r.excludeNoTat,
    slides: { ...(base.slides || {}), ...(r.slides || {}) },
    kpiCards: { ...(base.kpiCards || {}), ...(r.kpiCards || {}) },
    // labels is a full replace — deleting a label override must actually delete it.
    labels: { ...(r.labels || {}) },
    deltaMode: normalizeDeltaMode(r.deltaMode),
    // R2 — written as a real boolean so the settings mirror, the store validator and
    // pipeline.js shouldAutoDownloadFiles all read one shape.
    autoDownloadFiles: r.autoDownloadFiles !== false,
    // The tracker card's language pills — the same key Settings' radio writes.
    trackerLang: normalizeTrackerLang(r.trackerLang),
  };
}

/* ---------- «ترتيب الشرائح» — pure planning for the review card (exported for node tests) ---------- */

const sameSlideOrderAs = (a, b) => {
  const x = normalizeSlideOrder(a);
  const y = normalizeSlideOrder(b);
  return x.every((k, i) => k === y[i]);
};

/** The UNITS a report type's deck can show, in no particular order (the card sorts them by
 *  the order in force). KAMC + SGH: the exec slide (always on there) + its four toggles —
 *  build-spec-both.js emits nothing else. KAMC / SGH: every unit, the shipments unit only
 *  when the scope picked shipments (build-spec.js showShipmentSlide's data gate; its own
 *  on/off box is the «مخفية» badge below). */
export function slideOrderUnitsFor(hospital, scope) {
  if (hospital === 'both') return SLIDE_ORDER_KEYS.filter((k) => k === 'execFunnel' || BOTH_SLIDE_TOGGLES.has(k));
  let ships = false;
  try { ships = isScoped(scope) && normalizeScope(scope).shipments.length > 0; } catch { ships = false; }
  return SLIDE_ORDER_KEYS.filter((k) => k !== 'shipments' || ships);
}

/** Is a unit switched OFF for this deck — the «الشرائح» chip (or the shipment-slide box, or
 *  the opt-in definitions slide not turned on)? Mirrors build-spec.js / build-spec-both.js
 *  on(): the KAMC + SGH deck ignores the exec toggle and has no opt-in set. */
export function slideUnitHidden(key, { hospital, slides, scope } = {}) {
  if (key === 'shipments') return !!(scope && scope.shipmentSlide === false);
  if (hospital === 'both') return key !== 'execFunnel' && !!(slides && slides[key] === false);
  if (key === 'definitions') return !(slides && slides.definitions === true);
  return !!(slides && slides[key] === false);
}

/** The card's rows: this deck's units in the order in force. A switched-off unit KEEPS its
 *  row and place (badge «مخفية»); a unit that is on but rendered nothing in the last preview
 *  (`present`, the unit keys of that spec — no tracker document, no challenge content, no
 *  send-out data) is marked `empty`. `present` null = not built yet = nothing marked. */
export function slideOrderRows({ hospital, scope, slides, order, present = null } = {}) {
  const units = slideOrderUnitsFor(hospital, scope);
  return normalizeSlideOrder(order).filter((k) => units.includes(k)).map((key) => {
    const hidden = slideUnitHidden(key, { hospital, slides, scope });
    return {
      key, label: slideOrderLabel(key), hidden,
      empty: !hidden && present instanceof Set ? !present.has(key) : false,
    };
  });
}

/** What the card says and which buttons work. `temp` = the temporary order (or null),
 *  `saved` = the saved one (absent ⇒ default). */
export function slideOrderStatus({ temp = null, saved } = {}) {
  const temporary = Array.isArray(temp);
  const current = normalizeSlideOrder(temporary ? temp : saved);
  const isDefault = sameSlideOrderAs(current, SLIDE_ORDER_KEYS);
  return { temporary, current, isDefault, canSave: temporary, canRestore: temporary, canReset: !isDefault };
}

/** The order «حفظ كترتيب ثابت» writes: the CURRENT (temporary) order of the units the
 *  operator DECIDED on — `units`, every unit shown on a deck where a move was made
 *  (state.js tempSlideOrderUnits; null = every unit) — put into the slots those units hold
 *  in the SAVED order. NOT the deck on screen at save time: a move made on KAMC and saved
 *  from KAMC + SGH (no challenges / definitions / shipments) must keep the moved units'
 *  places. A unit no move ever showed keeps its saved place, even when Settings moved it
 *  while this temporary order existed (model/slide-order.js mergeVisibleOrder). The one
 *  exception is the default order itself (below). */
export function slideOrderToSave(saved, current, units) {
  // «الترتيب الافتراضي» then «حفظ»: the operator chose THE default — every unit's place,
  // the ones this deck does not show included — so it is saved whole (stored ABSENT).
  if (sameSlideOrderAs(current, SLIDE_ORDER_KEYS)) return [...SLIDE_ORDER_KEYS];
  const decided = new Set(Array.isArray(units) ? units : SLIDE_ORDER_KEYS);
  return mergeVisibleOrder(saved, normalizeSlideOrder(current).filter((k) => decided.has(k)));
}

/** reportOptions with `order` as the saved order. The default order is stored as ABSENT (the
 *  contract's "absent = default"), so a unit added in a later version lands in its default
 *  place for an operator who never chose otherwise. A new object; `ro` is not mutated. */
export function withSavedSlideOrder(ro, order) {
  const next = { ...((ro && typeof ro === 'object') ? ro : {}) };
  const o = normalizeSlideOrder(order);
  if (sameSlideOrderAs(o, SLIDE_ORDER_KEYS)) delete next.slideOrder;
  else next.slideOrder = o;
  return next;
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
  // «متابعة المشروع» (2026-10-13) — the tracker slides, in every report type; it replaced
  // the old «المهام» chip (key 'action', retired: the tracker took that slide's place).
  { key: 'tracker', label: STR.review.slideToggles.tracker },
  { key: 'challenges', label: STR.review.slideToggles.challenges },
];

/* The KAMC + SGH deck honours exactly these toggles (CONTRACT decision 10:
 * build-spec-both.js reads only monthly / sendout / compliance — the exec slide always
 * renders, and the deck has no challenges slide — plus, since 2026-10-13, 'tracker': the
 * project tracker slides sit between compliance and thanks in EVERY deck, the main one
 * included). A chip the deck ignores must not be offered: clicking it would change
 * nothing in that preview yet still save a new default the KAMC deck DOES honour. */
const BOTH_SLIDE_TOGGLES = new Set(['monthly', 'sendout', 'compliance', 'tracker']);

/** The slide chips a report type offers (pure; exported for node tests). */
export function slideTogglesFor(hospital) {
  return hospital === 'both' ? SLIDE_TOGGLES.filter((t) => BOTH_SLIDE_TOGGLES.has(t.key)) : SLIDE_TOGGLES;
}

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

/** The session's parsed order rows, or null (mock / tracker-only session). KAMC's rows:
 *  parsed.orders is the KAMC report's population (model/hospital.js takeOrders). */
function allRowsOf(state) {
  const o = state && state.parsed && state.parsed.orders;
  return Array.isArray(o) && o.length ? o : null;
}

/* ---------- Report type (2026-10-11): which hospital(s) the report is about ----------
 * state.reportHospital ∈ HOSPITAL_MODES ('both' default | 'kamc' | 'sgh') — memory only,
 * a choice about ONE run exactly like the scope (state.js; reset by «تقرير جديد»), never
 * read by the unattended automation. Picked on the «نطاق التقرير» card below.
 *   • BOTH — KAMC + SGH, the MAIN weekly report (user rule, 2026-10-11): the reference
 *            deck's design, each hospital computed on its own rows, then summed
 *            (buildBothModel). No scope filters (decision 7), no number overrides
 *            (decision 8). Historic file names (no tag). If the loaded data has no SGH
 *            rows it is STILL this report (SGH prints 0, the `missing` notice says so) —
 *            never silently switched to KAMC.
 *   • KAMC — the single-hospital KAMC report (the historic design and numbers, byte for
 *            byte): parsed.orders, today's figures path. File names tagged « - KAMC - ».
 *   • SGH  — the same design over SGH's own rows with SGH's engine policy (no Test
 *            Menu: no TAT, lateness, turnaround or country) — model/hospital-report.js
 *            buildHospitalModel. Scope filters apply to SGH's rows. Tagged « - SGH - ».
 * Recording (pipeline.js recordRunSnapshot): an unscoped BOTH report writes KAMC's
 * published numbers from its KAMC sub-model (never the task log — no task slides); an
 * unscoped KAMC report writes them + the task log, as it always did; SGH (and any scoped
 * deck) is a SIDE report and writes nothing. The history panel always charts KAMC's
 * series: shown for KAMC and for the main KAMC + SGH report (with a note that the figures
 * are KAMC's alone), hidden for SGH and any scope — see historyPanelPlan. */

/** The report type in force: state.reportHospital, 'both' — the main report — when unset
 *  or unknown (HOSPITAL_MODES is the only vocabulary this screen writes). */
export function reportHospitalOf(state) {
  const h = state && state.reportHospital;
  return HOSPITAL_MODES.includes(h) ? h : 'both';
}

/** The report type a MODEL was built as (absent ⇒ 'kamc': a model with no report type is
 *  a legacy KAMC-only model — every model that predates the report types). Compared
 *  against reportHospitalOf to decide whether the figures are stale and whether a
 *  generate click may proceed. */
const modelHospitalOf = (model) => (model && model.hospital != null ? model.hospital : 'kamc');

/**
 * The «أرقام التقارير والتقدم» panel's plan for one review model — pure (no DOM), so the
 * per-report-type rule is pinned by a test. snapshotHistory is the published KAMC series,
 * so the panel only ever charts KAMC's as-of numbers beside it — SGH's (or the summed)
 * would read as one series, the same lie a scope would tell.
 *   • SGH: hidden, one line in its place (HS.historyHidden).
 *   • any scope: hidden, the scope's own line (a scope narrows the rows, the published
 *     series is the full report's).
 *   • KAMC + SGH — the MAIN report, unscoped by design: SHOWN on its KAMC sub-model's rows
 *     (= parsed.orders), the series this very report writes into snapshotHistory
 *     (pipeline.js recordRunSnapshot records model.kamc); a note above says the figures
 *     are KAMC's alone. Before 2026-10-11 it was hidden, and the default screen then told
 *     the operator the published numbers had nothing to do with the report it publishes.
 *   • KAMC: as always — model.scopedRows, else parsed.orders.
 * @returns {{hidden:(string|null), note:(string|null), rows:(Array|null)}}
 */
export function historyPanelPlan(model, state, hospital) {
  const HSs = STR.review.hospital;
  if (hospital === 'sgh') return { hidden: HSs.historyHidden, note: null, rows: null };
  if (isScoped(model && model.scope)) return { hidden: str('scope', 'historyHidden'), note: null, rows: null };
  const parsedOrders = (state && state.parsed && state.parsed.orders) || null;
  if (hospital === 'both') {
    const k = model && model.kamc;
    return { hidden: null, note: HSs.historyKamcSeries, rows: (k && Array.isArray(k.scopedRows)) ? k.scopedRows : allRowsOf(state) };
  }
  return { hidden: null, note: null, rows: Array.isArray(model && model.scopedRows) ? model.scopedRows : parsedOrders };
}

/** One reported hospital's rows ('kamc' | 'sgh'), or null when it has none. Through
 *  model/hospital.js rowsForMode — the one place that says where each hospital's rows
 *  live in `parsed` — so this screen can never read SGH out of parsed.orders. */
function rowsFor(state, h) {
  let r;
  try { r = rowsForMode(state && state.parsed, h); } catch { return null; }
  return Array.isArray(r) && r.length ? r : null;
}

/** Any reported hospital's rows — "is there order data to report?" (an SGH-only file
 *  leaves parsed.orders EMPTY, yet the operator can still make its SGH report). */
function loadedRows(state) {
  return rowsFor(state, 'kamc') || rowsFor(state, 'sgh');
}

/** Did an order load happen at all — takeOrders ran (parsed.orders is an ARRAY, possibly
 *  empty) — as opposed to nothing loaded (state.js's fresh bucket: null)? Distinct from
 *  loadedRows: a file whose lines all belong to a THIRD hospital (or a CSV with no data
 *  rows) is a load with no KAMC and no SGH rows, and must block every report type with
 *  the empty notice — not fall through to the nothing-loaded preview path, where an SGH
 *  or KAMC + SGH choice still in force would generate a deck of zeros. */
function ordersLoaded(state) {
  const p = state && state.parsed;
  if (!p) return false;
  const obh = p.ordersByHospital;
  return Array.isArray(p.orders) || !!(obh && (Array.isArray(obh.kamc) || Array.isArray(obh.sgh)));
}

/** The pill label of a report type (STR.review.hospital.modes; registry codes). */
const hospitalLabel = (h) => (STR.review.hospital.modes[h] || String(h));

/**
 * Can the chosen report type be generated from the loaded data?
 *   • nothing loaded (mock / tracker-only session) → not blocked: today's preview path,
 *     the KAMC fallback figures, exactly as before;
 *   • data loaded but NONE of the report's hospitals has rows (an SGH report on a file
 *     without SGH lines, a KAMC report on an SGH-only file, ANY report on a file whose
 *     lines all belong to a third hospital — ordersLoaded) → BLOCKED: the screen says
 *     so and the generate button is disabled. Never the KAMC report under another
 *     report's name, never a deck of zeros pretending to be a count;
 *   • KAMC + SGH with ONE hospital absent → allowed (its order cells print 0 — CONTRACT
 *     decision 12) but `missing` names it so the screen says so.
 * Pure; exported for node tests.
 * @returns {{loaded:boolean, blocked:boolean, missing:string[]}}
 */
export function hospitalAvailability(state, hospital = reportHospitalOf(state)) {
  if (!ordersLoaded(state)) return { loaded: false, blocked: false, missing: [] };
  const has = { kamc: !!rowsFor(state, 'kamc'), sgh: !!rowsFor(state, 'sgh') };
  const need = hospital === 'both' ? Object.keys(HOSPITALS) : [hospital];
  const missing = need.filter((h) => !has[h]);
  return { loaded: true, blocked: missing.length === need.length, missing };
}

/** WHICH LOAD the scope was chosen against: the object takeOrders writes per load
 *  (parsed.ordersByHospital — new on every takeOrders call, and reset by state.js's
 *  orders accessor whenever the orders change), else the orders array itself (a parsed
 *  bucket that predates ordersByHospital). null when no hospital has rows. */
function loadKeyOf(state) {
  if (!loadedRows(state)) return null;
  const p = state.parsed;
  return (p.ordersByHospital && typeof p.ordersByHospital === 'object') ? p.ordersByHospital : p.orders;
}

/* WHICH DATA a scope was chosen against. The scope lives on `state` (memory only —
 * never settings: it is a choice about ONE run, and runAutomation never reads it) and
 * must not outlive the rows it was chosen for: shipment ids typed against this
 * morning's export mean nothing for tomorrow's, and a lab picked yesterday would
 * silently narrow a fresh upload into a side report nobody asked for.
 *
 * THE DATA IS THE LOAD ITSELF, BY IDENTITY. Every reload path goes through
 * model/hospital.js takeOrders — the upload screen's live pull and CSV parse, the mock
 * loader, the automation's pull — which writes a NEW parsed.ordersByHospital object (and
 * a new orders array) per load, and a reused pull keeps the same ones, so identity is
 * exactly "is this still the data the scope was chosen against". A content fingerprint
 * (row count + first/last order id) was tried and is WRONG for the commonest reload: a
 * re-pull minutes later where only statuses moved has the same shape, so the old scope
 * survived onto new data, and on the app-bar home path (which keeps state.reportModel)
 * the figures were never rebuilt at all. «تقرير جديد» (state.js resetRunData) needs no
 * clean-up here either: it drops the orders, and whatever is loaded next is a new array
 * the old scope was never bound to.
 *
 * The binding is a WeakMap keyed by that load object (loadKeyOf → the epoch it was bound under),
 * with only the epoch number on state: a strong reference to the array would keep a
 * dropped pull's patient-adjacent rows alive after «تقرير جديد» for no reason. The epoch
 * also keys the figures cache and the typed-but-unapplied scope input below, so all
 * three reset together. Nothing about the rows is logged or stored beyond memory. */
const scopeBinding = new WeakMap();
let dataEpoch = 0;

/** The scope in force for this render: state.scope, reset to EMPTY_SCOPE when the
 *  loaded data is not the load it was chosen against, or when there are no rows to
 *  scope (epoch 0). REPORT TYPES: the binding key is the LOAD (loadKeyOf), not the KAMC
 *  array alone — an SGH-only file has no KAMC rows yet is still a load whose SGH rows
 *  can be scoped; the KAMC array changes identity on exactly the same reloads. A
 *  KAMC + SGH report takes no scope at all (decision 7), so none survives in that mode. */
function currentScope(state) {
  const key = loadKeyOf(state);
  if (!key || !state.scope || !state.scopeEpoch || scopeBinding.get(key) !== state.scopeEpoch) {
    state.scope = EMPTY_SCOPE;
    state.scopeEpoch = key ? ++dataEpoch : 0;
    if (key) scopeBinding.set(key, state.scopeEpoch);
  }
  if (reportHospitalOf(state) === 'both' && isScoped(state.scope)) state.scope = EMPTY_SCOPE;
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
 *
 * REPORT TYPES (2026-10-11). `hospital` (default: the state's report type):
 *   'kamc' → the path above, untouched, plus `hospital: 'kamc'`;
 *   'sgh' / 'both' → hospitalOrderFigures below, from model/hospital-report.js (handed in
 *   as `hospitalReport`). Those THROW on failure, like a scoped build: state.engineOutput
 *   is the KAMC hero's output, and publishing it under an SGH report is the worst outcome.
 * @returns {{reportDate:string, kpi:Object, sendout:(Object|null), scope:Object,
 *   scopedRows:(Array|null), shipmentDetails:Array, hospital:string}} contract [C]'s
 *   model fields (+ noTestMenu for SGH; kamc / sgh / combined / deltaWindow for BOTH) */
export function buildOrderFigures(state, store, scope, compute, { hospital, hospitalReport } = {}) {
  const h = hospital == null ? reportHospitalOf(state) : hospital;
  if (h === 'kamc') return { ...kamcOrderFigures(state, store, scope, compute), hospital: 'kamc' };
  if (!HOSPITAL_MODES.includes(h)) throw new Error(`unknown report type ${JSON.stringify(h)}`);
  return hospitalOrderFigures(state, store, scope, h, hospitalReport);
}

/** The KAMC report's figures — the historic builder, verbatim (see buildOrderFigures). */
function kamcOrderFigures(state, store, scope, compute) {
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

/* The SGH and KAMC + SGH figures (2026-10-11) — model/hospital-report.js does every
 * number; this only picks the rows and lifts the ORDER-BASED fields onto the review's
 * model (the tasks / challenges / support lines stay the review's own drafts).
 *   SGH  — buildHospitalModel('sgh') over SGH's rows ONLY (rowsFor 'sgh': never
 *          parsed.orders), with the scope applied to them; its model carries
 *          `noTestMenu: true` and the counts-only send-out block.
 *   BOTH — buildBothModel over each hospital's own rows (never the union), already
 *          stamped; no scope (EMPTY_SCOPE), no top-level kpi: the spec reads
 *          kamc / sgh / combined, and scopedRows is null so no single-hospital stamper
 *          can ever stamp it with one policy.
 * The send-out catalogue goes to KAMC only (BOTH's countries slide); SGH has none.
 * A hospital with no rows builds over [] (its numbers are 0); hospitalAvailability
 * decides whether that may be generated. THROWS when the module is absent or a build
 * fails — modelFor then shows the KAMC report and says so. */
function hospitalOrderFigures(state, store, scope, hospital, hr) {
  if (!hr || typeof hr.buildHospitalModel !== 'function' || typeof hr.buildBothModel !== 'function') {
    throw new Error(`${hospital} figures unavailable (model/hospital-report.js did not load)`);
  }
  const settings = (store && store.settings) || {};
  const reportDate = state.reportDate || todayISO();
  const tracker = (state.parsed && state.parsed.tracker) || null;
  const rows = (h) => rowsFor(state, h) || [];
  if (hospital === 'sgh') {
    const m = hr.buildHospitalModel({
      hospital: 'sgh', rows: rows('sgh'), settings, reportDate, tracker, sendoutMaster: null,
      scope: normalizeScope(scope),
    });
    return {
      reportDate: m.reportDate,
      kpi: m.kpi,
      sendout: m.sendout,
      noTestMenu: m.noTestMenu === true,
      scope: m.scope,
      scopedRows: m.scopedRows,
      shipmentDetails: m.shipmentDetails || [],
      hospital: 'sgh',
    };
  }
  const b = hr.buildBothModel({
    kamcRows: rows('kamc'),
    sghRows: rows('sgh'),
    settings,
    reportDate,
    tracker,
    sendoutMaster: state.sendoutMaster || null,
    mode: settings.reportOptions && settings.reportOptions.deltaMode,
  });
  return {
    reportDate: b.reportDate,
    kamc: b.kamc,
    sgh: b.sgh,
    combined: b.combined,
    deltaWindow: b.deltaWindow,
    scope: EMPTY_SCOPE,
    scopedRows: null,
    shipmentDetails: [],
    hospital: 'both',
  };
}

/* Every model field a figures build may set. A rebuild for ANOTHER report type must not
 * inherit the previous type's leftovers — a KAMC model still carrying an SGH build's
 * `noTestMenu`, or BOTH's `kamc`/`sgh`/`combined` beside a KAMC kpi — so refreshedModel
 * drops each of these the new figures do not set. */
const FIGURE_KEYS = Object.freeze([
  'reportDate', 'kpi', 'sendout', 'scope', 'scopedRows', 'shipmentDetails', 'hospital',
  'noTestMenu', 'kamc', 'sgh', 'combined', 'deltaWindow',
]);

/* The «ما الجديد» banner's chip values. KAMC / SGH: the model's own kpi.deltas, as
 * always. KAMC + SGH has no top-level kpi: each key is the hospitals' stamped chips
 * SUMMED — lateness over the Test-Menu hospitals only (KAMC), as the deck's late card
 * counts it (model/hospital-report.js combineHospitals). Exported for node tests. */
export function bannerDeltasOf(model) {
  if (modelHospitalOf(model) !== 'both') return (model && model.kpi && model.kpi.deltas) || {};
  const out = {};
  for (const { key } of DELTA_META) {
    let sum = 0;
    let any = false;
    for (const h of Object.keys(HOSPITALS)) {
      if (key === 'lateNoResult' && HOSPITALS[h].hasTestMenu !== true) continue;
      const d = model[h] && model[h].kpi && model[h].kpi.deltas;
      const v = d ? d[key] : undefined;
      if (Number.isFinite(v)) { sum += v; any = true; }
    }
    if (any) out[key] = sum;
  }
  return out;
}

/* The SIDE REPORT banner's content for a model, or null when the model is a recorded
 * report (see the banner in render()): a scoped deck (any type) or the SGH report gets
 * one; the main KAMC + SGH report and the unscoped KAMC report do not. The title names
 * the report type for SGH and «تقرير مخصص» for a scope; the line is the SGH sentence
 * for SGH, the scope sentence otherwise. Pure; exported for node tests. */
export function sideReportNotice(model) {
  const hospital = modelHospitalOf(model);
  let scoped;
  try { scoped = isScoped(model && model.scope); } catch { scoped = true; } // fail closed, as recordRunSnapshot
  const sgh = hospital === 'sgh';
  if (!scoped && !sgh) return null;
  const SC = STR.review.scope;
  return {
    title: [sgh ? STR.generate.reportType(hospitalLabel(hospital)) : null, scoped ? SC.active : null]
      .filter(Boolean).join(' · '),
    text: sgh ? STR.review.hospital.sideReport : SC.sideReport,
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
 * another, so a scope change — or a report-type change — clears them (a date change, a
 * reload or a Settings edit that keeps both keeps them, as the model always has).
 * A figure field the NEW figures do not set is dropped (FIGURE_KEYS), so switching the
 * report type never leaves the previous type's fields on the model. */
function refreshedModel(prev, state, store, compute, { dropOverrides = false, hospitalReport = null } = {}) {
  const figures = buildOrderFigures(state, store, state.scope, compute, { hospitalReport });
  const next = { ...prev, ...figures };
  for (const k of FIGURE_KEYS) if (!(k in figures)) delete next[k];
  delete next.deltaWindow;
  if (dropOverrides) next.overrides = {};
  return next;
}

/* THE SESSION'S PROJECT TRACKER — the one document the review edits. The run's parsed
 * tracker when it is a tagged ProjectTracker, else the persisted one (settings
 * .cachedTracker, through the model layer's resolveProjectTracker), else null. Adopted
 * into state.parsed.tracker (the SAME object, never a copy — CONTRACT §1.3), so the
 * editor, the model and the generate step all hold one document; an untagged leftover
 * there (the old {tasks, challenges, risks} shape) is dropped. Never a mock: no tracker
 * ⇒ null ⇒ no tracker slides. Pure apart from that state write; exported for node tests. */
export function sessionProjectTracker(state, store) {
  const parsed = state && state.parsed;
  const t = resolveProjectTracker(parsed && parsed.tracker, store && store.settings);
  if (parsed && parsed.tracker !== t) {
    parsed.tracker = t;
    if (state.files && t && !state.files.tracker) {
      state.files.tracker = { name: t.fileName || STR.upload.cachedTrackerName };
    }
  }
  return t;
}

/* Assemble an editable ReportModel: the order figures above + the project tracker +
 * settings. Nothing is DRAFTED from the tracker any more (the old autoDraft task split
 * and support lines keyed on the retired file's Arabic categories / statuses): the model
 * carries the document itself as `projectTracker`. Challenges / risks / support lines are
 * MANUAL single-hospital content and start empty (the new file has no such sheets);
 * build-spec renders the challenges slide only when they have content. */
function buildDraftReportModel(state, store, compute, hospitalReport = null) {
  const figures = buildOrderFigures(state, store, currentScope(state), compute, { hospitalReport });
  return {
    // reportDate, kpi, sendout, scope, scopedRows, shipmentDetails, hospital (+ the SGH /
    // KAMC + SGH fields) — see buildOrderFigures.
    ...figures,
    panels: { supportRequired: [] },
    projectTracker: sessionProjectTracker(state, store),
    challenges: [],
    risks: [],
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
// The report type (reportHospitalOf) leads the key: switching KAMC / SGH / KAMC + SGH is
// a different number set over different rows, so it rebuilds (and drops the overrides —
// modelFor). The engine inputs fingerprinted are KAMC's settings-side ones; the SGH
// policy has no settings-side input but the date, which they include (opts.asOf).
const figuresFor = new WeakMap();
const figuresKeyOf = (state, store) => {
  const { tat, opts } = engineInputs(state, store && store.settings, state.scope);
  return `${reportHospitalOf(state)}|${scopeKey(state.scope)}|${state.scopeEpoch || 0}|${JSON.stringify([tat, opts])}`;
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
 * screen, so a click can never publish that swap unseen either.
 * REPORT TYPES: an SGH / KAMC + SGH build that fails (the model module did not load, a
 * compute error) is handled the same way — back to the KAMC report, loudly (a toast that
 * names the report type), the choice reset to KAMC — and the generate button compares
 * the report type too, so the swap can never be published unseen.
 * EXPORTED for node tests; `notify` is the toast seam (default: the real toast). */
export function modelFor(state, store, compute, { hospitalReport = null, notify = toast } = {}) {
  currentScope(state);
  const prev = state.reportModel || null;
  const want = figuresKeyOf(state, store);
  if (prev && figuresFor.get(prev) === want) return prev;
  // Asked per attempt, not once: the fallback below resets the scope, and a scope that
  // falls back to the one prev already had is no scope change — its overrides stay and
  // no «overrides cleared» toast claims otherwise. The same for the report type.
  const scopeChanged = () => !!prev && scopeKey(prev.scope) !== scopeKey(state.scope);
  const hospitalChanged = () => !!prev && modelHospitalOf(prev) !== reportHospitalOf(state);
  const build = () => (prev
    ? refreshedModel(prev, state, store, compute, {
      dropOverrides: scopeChanged() || hospitalChanged(), hospitalReport,
    })
    : buildDraftReportModel(state, store, compute, hospitalReport));
  let next;
  try {
    next = build();
  } catch (e) {
    const failed = reportHospitalOf(state);
    state.scope = EMPTY_SCOPE;
    if (failed !== 'kamc') {
      console.warn(`[review] ${failed} figures unavailable; showing the KAMC report`, e && e.message);
      state.reportHospital = 'kamc';
      notify(STR.review.hospital.failed(hospitalLabel(failed)), 'err');
    } else {
      console.warn('[review] scoped figures unavailable; showing the full report', e && e.message);
      // Specific, not the bare «خطأ»: the operator must learn that the SCOPE was dropped
      // and the full report is what they are now looking at.
      const SC = STR.review.scope;
      notify(str('scope', 'failed', `${STR.common.error}: ${SC.title} — ${SC.reset}`), 'err');
    }
    // Falling back to the very figures prev already carries (the usual case: a scope
    // tried on the full report) keeps prev itself — no second compute, no new object.
    // Otherwise rebuild unscoped, which never throws: a compute, else the cached engine
    // output, else the mock.
    next = (prev && figuresFor.get(prev) === figuresKeyOf(state, store)) ? prev : build();
  }
  if ((scopeChanged() || hospitalChanged()) && prev.overrides && Object.keys(prev.overrides).length) {
    notify(hospitalChanged() ? STR.review.hospital.overridesCleared : str('scope', 'overridesCleared'), 'warn');
  }
  figuresFor.set(next, figuresKeyOf(state, store));
  state.reportModel = next;
  return next;
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
    const mod = await tryImport('../ingest/sendout-master.js?v=v2026-10-13.5');
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
    : pickFn(await tryImport('../engine/engine.js?v=v2026-10-13.5'), ['compute', 'runEngine', 'run']);
  // The SGH / KAMC + SGH model builders — guarded like the engine they depend on. Loaded
  // even in KAMC mode: the generate click and a report-type switch go through modelFor
  // with it, and a missing module must surface as modelFor's loud fallback, not a crash.
  const hrMod = await tryImport('../model/hospital-report.js?v=v2026-10-13.5');
  const model = modelFor(state, store, compute, { hospitalReport: hrMod });
  // The report type ON SCREEN — the model's, which is the state's choice unless that
  // build failed and modelFor fell back to KAMC (it said so).
  const hospital = modelHospitalOf(model);
  const avail = hospitalAvailability(state, hospital);
  const HS = STR.review.hospital;
  { // settings may have been edited since the model was drafted — re-source them
    const s = store.settings || {};
    if (s.scorecard) model.scorecard = s.scorecard;
    if (s.displayNames) model.displayNames = s.displayNames;
  }
  // The project tracker is a persisted DOCUMENT, not a draft: re-sourced on every render
  // like the settings above. The model is drafted once and copied forward, so without this
  // it would keep the document it was drafted with — after a new upload (the app-bar home
  // button returns here with the old model), a Settings «مسح», or an automation run that
  // left its own model in state.reportModel — and generate would ship the stale one.
  model.projectTracker = sessionProjectTracker(state, store);
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
  // …and the TEMPORARY slide order on top, as model.slideOrder (the deck builders read it
  // before the saved one — model/slide-order.js slideOrderOf). It lives on state, bound to
  // this load (after modelFor above, which moves the load epoch on new data), so a re-sourced
  // reportOptions can never wipe it and a new load can never inherit it; a stale copy left
  // on a carried-forward model is removed here.
  overlayTempSlideOrder(model, state);
  if (!model.overrides) model.overrides = {};
  // THE WEEK'S ACTIVITY chips (2026-08-05). model/delta-window.js recomputes
  // model.kpi.deltas from the ROWS' OWN DATES over the window [Sunday, reportDate]
  // ('week', default) or [reportDate, reportDate] ('daily') and stamps
  // model.deltaWindow for the banner + the deck legend. THE INVARIANT: only these
  // chips changed meaning — the big cumulative numbers on slides 2/3/4 are untouched.
  // Guarded import, exactly as the retired picker was: a build without the module
  // degrades to the engine's own deltas instead of throwing. Re-run below on a
  // report-date change and on a mode switch; being PURE, every re-run agrees.
  const dwMod = await tryImport('../model/delta-window.js?v=v2026-10-13.5');
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
    // SGH / KAMC + SGH: their own stampers (model/hospital-report.js) — each hospital's
    // chips from its OWN rows with its OWN policy, never KAMC's TAT table and never
    // parsed.orders. The SAME calls pipeline.js applyWindowDeltas makes on generate, so
    // the preview's chips and the deck's agree (both pure → deep-equal).
    if (hospital !== 'kamc') {
      const mode = normalizeDeltaMode(model.reportOptions && model.reportOptions.deltaMode);
      const settings = store.settings || {};
      try {
        if (hospital === 'both') {
          if (hrMod && typeof hrMod.stampBothDeltas === 'function') hrMod.stampBothDeltas(model, { settings, mode });
        } else if (hrMod && typeof hrMod.stampHospitalDeltas === 'function') {
          hrMod.stampHospitalDeltas(model, {
            rows: Array.isArray(model.scopedRows) ? model.scopedRows : [], settings, mode,
          });
        }
      } catch (e) { console.warn('[review] hospital delta stamp failed; keeping the built chips', e); }
      return;
    }
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
  // The merge itself is mergeReportOptions (pure, tested): it never writes the slide order.
  const persistReportOptions = () => {
    try {
      const doc = store.loadSettings();
      doc.reportOptions = mergeReportOptions(doc.reportOptions, model.reportOptions);
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
    const specMod = await tryImport('../slidespec/build-spec.js?v=v2026-10-13.5');
    const buildSpec = pickFn(specMod, ['buildSpec', 'build', 'makeSpec', 'toSpec']);
    const rendMod = await tryImport('../render/html-renderer.js?v=v2026-10-13.5');
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
    // «ترتيب الشرائح»: which units this very deck rendered (a unit that is on but empty —
    // no tracker document, no challenge content — is marked on the card), and, after a move,
    // the moved unit's first slide is the one to show (pendingSlide, applied below).
    previewUnits = new Set(spec.map((x) => unitOfSlideId(x && x.id)).filter(Boolean));
    if (pendingUnit) {
      const at = spec.findIndex((x) => unitOfSlideId(x && x.id) === pendingUnit);
      if (at >= 0) pendingSlide = at;
      pendingUnit = null;
    }
    paintOrderCard();
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
  let pendingUnit = null;     // a unit just moved on the order card → show its first slide
  let previewUnits = null;    // the unit keys the last preview rendered (null = none yet)

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
  let orderCard = null; // the «ترتيب الشرائح» <details> (built below, beside the slide chips)
  function rerenderKeepingPlace(extra = {}) {
    clearTimeout(debTimer);
    clearTimeout(dateRefreshTimer);
    view.restore = {
      scrollY: window.scrollY || 0,
      scopeOpen: !!(scopeCard && scopeCard.open),
      historyOpen,
      orderOpen: !!(orderCard && orderCard.open),
      orderTemp: !!tempSlideOrder(state),
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

  // «متابعة المشروع» — the project tracker editor (every report type). It edits the
  // document IN PLACE (model.projectTracker === state.parsed.tracker), so the preview
  // follows every keystroke and generate ships exactly what is on screen; each change
  // also schedules the debounced save to settings.cachedTracker (trackerSaver), which is
  // what makes an edit survive a reload and reach the unattended main report.
  const persistTracker = (t) => {
    if (isMockTracker(t)) return; // the ?mock=1 demo document is never persisted
    trackerSaver.schedule((doc) => saveTrackerToStore(store, doc), t, (e) => {
      console.warn('[review] tracker save failed', e);
      toast(STR.tracker.saveFailed, 'err');
    });
  };
  const trackerEd = trackerEditor({
    tracker: model.projectTracker,
    lang: model.reportOptions.trackerLang,
    onChange: (t) => {
      // The same object everywhere (see sessionProjectTracker) — re-pinned in case the
      // editor just CREATED the document (no file loaded).
      model.projectTracker = t;
      if (state.parsed) state.parsed.tracker = t;
      persistTracker(t);
      schedulePreview();
    },
    onCreate: () => {
      const t = createProjectTracker();
      if (state.files && !state.files.tracker) state.files.tracker = { name: STR.tracker.manualName };
      return t;
    },
  });
  // «لغة نص المهام في الشريحة» (Arabic CONTRACT §4): which text the tracker slides show —
  // the Arabic translation (English per row when a task has none), the English original,
  // or both. A REPORT OPTION, not tracker data: persisted with the slide chips through
  // persistReportOptions (Settings mirrors it), the preview re-renders, and the editor's
  // summaries switch language so the list reads like the deck.
  const trackerLang = trackerLangControl({
    value: model.reportOptions.trackerLang,
    onChange: (lang) => {
      model.reportOptions.trackerLang = normalizeTrackerLang(lang);
      persistReportOptions();
      trackerEd.setLang(model.reportOptions.trackerLang);
      schedulePreview();
    },
  });
  const trackerCard = el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: STR.tracker.title }),
    trackerLang.el,
    trackerEd.el,
  ]);

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
  // standard TAT — only when the engine actually excluded some. KAMC + SGH: KAMC's
  // (SGH's policy never excludes — a missing TAT is its normal state).
  const noteKpi = hospital === 'both' ? (model.kamc && model.kamc.kpi) : kpi;
  const excludedNote = (noteKpi && noteKpi.excludedNoTat > 0)
    ? el('p', { class: 'small muted', style: 'margin:0 0 10px', text: `استُبعد ${noteKpi.excludedNoTat} سطراً بدون مدة معيارية (TAT)` })
    : null;
  // Collapsed by default (daily flow rarely overrides numbers); styled like the
  // labels card so it reads as an advanced/optional section.
  // KAMC + SGH: no overrides (decision 8) — which number would one replace, the KAMC,
  // the SGH or the summed one? The card is replaced by one line saying so.
  const kpiCard = hospital === 'both'
    ? el('div', { class: 'card', style: 'padding:12px 16px' }, [
      el('div', { class: 'card__title', style: 'margin-bottom:4px', text: STR.review.kpiEditTitle }),
      excludedNote,
      el('p', { class: 'small muted', style: 'margin:0', text: HS.noOverrides }),
    ])
    : el('details', { class: 'card' }, [
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
      paintOrderCard(); // the unit's «مخفية» badge follows at once (it keeps its place)
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
    ...slideTogglesFor(hospital).map(slideChip),
  ]);

  /* ---------- «ترتيب الشرائح» — the slide-order card (2026-10-13, slide-order CONTRACT §5–7) ----------
   * Between «الشرائح» and the live preview: WHICH slides, then in WHAT ORDER, then the result.
   * TWO orders, never confused:
   *   • the SAVED (fixed) one — settings.reportOptions.slideOrder, written only by «حفظ كترتيب
   *     ثابت» here and by the Settings tab; every new report and the automation use it;
   *   • the TEMPORARY one — state.slideOrder (state.js), made by any move here and used by
   *     THIS report's preview and its four files only; it dies with the load, «تقرير جديد»
   *     and the upload's «متابعة», and survives a type / scope / date switch, Settings, «رجوع».
   * A move made on a deck that lacks some units (KAMC + SGH has no challenges…) leaves those
   * units' places alone (mergeVisibleOrder). Every change redraws the preview at once. */
  const SO = STR.review.slideOrder;
  const savedSlideOrder = () => normalizeSlideOrder(model.reportOptions && model.reportOptions.slideOrder);
  const orderUnits = () => slideOrderUnitsFor(hospital, model.scope);
  const orderStatus = () => slideOrderStatus({ temp: tempSlideOrder(state), saved: savedSlideOrder() });
  /** Adopt `full` (a whole order) for this report: temporary unless it IS the saved order.
   *  `decided` = the units this change decided on (state.js setTempSlideOrder — what a later
   *  «حفظ» stores, whichever deck is on screen then). */
  function adoptSlideOrder(full, movedKey = null, decided = null) {
    if (sameSlideOrderAs(full, savedSlideOrder())) clearTempSlideOrder(state);
    else setTempSlideOrder(state, normalizeSlideOrder(full), decided);
    overlayTempSlideOrder(model, state);
    pendingUnit = movedKey;
    paintOrderCard();
    clearTimeout(debTimer);
    renderPreview();
  }
  const orderList = slideOrderList({
    getRows: () => slideOrderRows({
      hospital, scope: model.scope, slides: model.reportOptions.slides,
      order: slideOrderOf(model), present: previewUnits,
    }),
    onMove: (nextShown, key) => adoptSlideOrder(mergeVisibleOrder(slideOrderOf(model), nextShown), key, orderUnits()),
  });
  const orderPill = el('span', { class: 'sord-pill' });
  const orderStatusEl = el('div', { class: 'sord-status', role: 'status' });
  const orderSaveBtn = el('button', {
    type: 'button', class: 'btn btn--primary btn--sm', text: SO.save,
    onClick: () => {
      const st = orderStatus();
      if (!st.canSave) return;
      const order = slideOrderToSave(savedSlideOrder(), st.current, tempSlideOrderUnits(state));
      try {
        const doc = store.loadSettings();
        doc.reportOptions = withSavedSlideOrder(doc.reportOptions, order);
        store.saveSettings(doc);
      } catch (e) {
        console.warn('[review] saving the slide order failed', e);
        toast(SO.saveFailed, 'err');
        return;
      }
      // The model's reportOptions object is shared with the chips and the labels editor —
      // only its slideOrder is brought in line with what was just stored.
      const stored = reportOptionsFromSettings(store.settings).slideOrder;
      if (stored) model.reportOptions.slideOrder = stored;
      else delete model.reportOptions.slideOrder;
      clearTempSlideOrder(state);
      overlayTempSlideOrder(model, state);
      paintOrderCard();
      clearTimeout(debTimer);
      renderPreview();
      toast(SO.savedToast, 'ok');
    },
  });
  const orderRestoreBtn = el('button', {
    type: 'button', class: 'btn btn--ghost btn--sm', text: SO.restoreSaved,
    onClick: () => {
      if (!orderStatus().canRestore) return;
      adoptSlideOrder(savedSlideOrder());
      toast(SO.restoredToast, 'ok');
    },
  });
  const orderDefaultBtn = el('button', {
    type: 'button', class: 'btn btn--ghost btn--sm', text: SO.resetDefault,
    onClick: () => {
      if (!orderStatus().canReset) return;
      // TEMPORARY unless the saved order is the default; it decides EVERY unit's place.
      adoptSlideOrder([...SLIDE_ORDER_KEYS], null, [...SLIDE_ORDER_KEYS]);
      if (orderStatus().temporary) toast(SO.defaultToast, 'ok');
    },
  });
  orderCard = el('details', { class: 'card sord-card' }, [
    el('summary', { class: 'card__title sord-card__summary' }, [el('span', { text: SO.title }), orderPill]),
    el('p', { class: 'small muted', style: 'margin:-4px 0 10px', text: SO.hint }),
    orderStatusEl,
    orderList.el,
    el('div', { class: 'sord-actions' }, [orderSaveBtn, orderRestoreBtn, orderDefaultBtn]),
  ]);
  if (restore && restore.orderOpen) orderCard.open = true;
  // Was a temporary order already in force at the last paint? A keep-place rerender hands
  // it over (restore.orderTemp) so the operator's collapse survives it; a fresh entry into
  // the screen starts false, so a temporary order opens the card once on arrival.
  let orderWasTemp = !!(restore && restore.orderTemp);
  function paintOrderCard() {
    const st = orderStatus();
    // Auto-open when a temporary order COMES INTO force (first move, or arriving with one):
    // the operator must SEE that this report is not using the fixed order before generating
    // it. Only on that change — paintOrderCard runs on every preview repaint (each chip,
    // date, label edit), and re-opening there would undo the operator's collapse each time.
    if (st.temporary && !orderWasTemp) orderCard.open = true;
    orderWasTemp = st.temporary;
    orderPill.textContent = st.temporary ? SO.pillTemp : SO.pillSaved;
    orderPill.className = 'sord-pill' + (st.temporary ? ' is-temp' : '');
    orderStatusEl.className = 'sord-status' + (st.temporary ? ' is-temp' : '');
    orderStatusEl.textContent = '';
    orderStatusEl.append(
      el('strong', { text: `${st.temporary ? '⚠' : '✓'} ${st.temporary ? SO.statusTemp : SO.statusSaved}`
        + (!st.temporary && st.isDefault ? ` ${SO.defaultTag}` : '') }),
      el('span', { class: 'sord-status__hint', text: st.temporary ? SO.statusTempHint : SO.statusSavedHint }),
    );
    orderSaveBtn.disabled = !st.canSave;
    orderRestoreBtn.disabled = !st.canRestore;
    orderDefaultBtn.disabled = !st.canReset;
    orderList.paint();
  }
  paintOrderCard();

  // Labels editor (collapsible, collapsed by default). One field per LABEL_NAMES key,
  // placeholder = DEFAULT_LABELS[key], value = reportOptions.labels[key] (empty =
  // default). Registry lives in build-spec.js — graceful if not exported yet.
  const labelsHost = el('details', { class: 'card' }, [
    el('summary', { class: 'card__title', style: 'cursor:pointer', text: STR.review.labelsCardTitle }),
  ]);
  (async () => {
    const specMod = await tryImport('../slidespec/build-spec.js?v=v2026-10-13.5');
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
      // A tracker edit still inside its save debounce is written now: the deck carries it
      // either way (same object), but the persisted document must match what ships.
      trackerSaver.flush();
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
      // Read BEFORE modelFor: a reload under the screen moves the load epoch there, and the
      // temporary slide order dies with it (state.js tempSlideOrder) — checked below.
      const hadTempOrder = !!tempSlideOrder(state);
      const m = modelFor(state, store, compute, { hospitalReport: hrMod });
      // …but it must still be the REPORT on screen. A click-time rebuild can come back
      // with a different scope: the scoped build failed and modelFor fell back to the full
      // report (it has said so), or the data was reloaded under the screen and the scope,
      // bound to the old rows, was dropped. Navigating on would publish a report the
      // operator never saw — a full one, which IS recorded to the history and the task
      // log, where they were looking at a side report. Stop and show what it would be.
      // The REPORT TYPE is part of "the report on screen" too: a click-time rebuild that
      // came back as another type (an SGH / KAMC + SGH build failed and modelFor fell
      // back to KAMC — which IS recorded) must not navigate on.
      const typeChanged = modelHospitalOf(m) !== modelHospitalOf(model);
      if (typeChanged || scopeKey(m.scope) !== scopeKey(model.scope)) {
        if (typeChanged) toast(HS.changed, 'warn');
        else if (state.scopeEpoch !== epoch) {
          toast(str('scope', 'dataChanged', `${STR.common.warning}: ${SC.title} — ${SC.reset}`), 'warn');
        }
        genButton.disabled = false;
        rerenderKeepingPlace(); // no pin: m, already in state.reportModel, is the one to show
        return;
      }
      // The SLIDE ORDER is part of it too: a temporary order shown on the card but dropped
      // by that reload would publish the saved order the operator is not looking at. Stop,
      // say so, and show the report with the saved order first.
      if (hadTempOrder && !tempSlideOrder(state)) {
        toast(`${STR.common.warning}: ${STR.review.slideOrder.dataChanged}`, 'warn');
        genButton.disabled = false;
        rerenderKeepingPlace();
        return;
      }
      // A report type whose hospital has no rows in the loaded data is never generated
      // (hospitalAvailability) — re-checked at click time: the data may have been
      // reloaded under the screen since the button was painted.
      if (hospitalAvailability(state, modelHospitalOf(m)).blocked) {
        toast(HS.empty(hospitalLabel(modelHospitalOf(m))), 'err');
        rerenderKeepingPlace();
        return;
      }
      m.reportDate = effectiveReportDate(state, m.scope); // beat the 260ms preview debounce
      // Settings edited after the model was drafted (scorecard, display names)
      // must reach the generated files.
      const s = store.settings || {};
      m.scorecard = s.scorecard || m.scorecard;
      m.displayNames = s.displayNames || m.displayNames;
      // The slide order on screen goes with it: the temporary one when set (all four files
      // follow it), else the saved one model.reportOptions already carries.
      overlayTempSlideOrder(m, state);
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
  // Disabled while the chosen report type has nothing to report (see hospitalAvailability;
  // the reason is printed at the top of the screen). Imperative: el() drops a false attr.
  genButton.disabled = avail.blocked;
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
    // KAMC + SGH has no top-level kpi: the hospitals' chips summed (bannerDeltasOf).
    const deltas = bannerDeltasOf(model);
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
    // What the panel shows per report type: historyPanelPlan (pure, pinned by a test).
    const plan = historyPanelPlan(model, state, hospital);
    if (plan.hidden) {
      historyHost.appendChild(el('div', { class: 'card', style: 'padding:12px 16px' }, [
        el('p', { class: 'small muted', text: plan.hidden }),
      ]));
      return;
    }
    const s = store.settings || {};
    if (plan.note) {
      historyHost.appendChild(el('p', { class: 'small muted', style: 'margin:0 4px 6px', text: plan.note }));
    }
    const panel = buildHistoryPanel({
      rows: plan.rows,
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
  //
  // REPORT TYPE (2026-10-11) — the card's FIRST section: the KAMC / SGH / KAMC + SGH
  // pills (setHospital). The scope sections below then work on the CHOSEN hospital's
  // rows: KAMC's (parsed.orders, as always) or SGH's (its own labs, its own shipment
  // ids). KAMC + SGH takes no scope (decision 7): one short line replaces the sections.
  // A report type whose hospital has no rows shows no scope sections either (nothing to
  // narrow — the empty notice at the top of the screen says why).
  // The card exists whenever an order load happened (ordersLoaded) — an SGH-only file,
  // or one with only third-hospital lines, included.
  const allRows = hospital === 'kamc' ? allRowsOf(state) : (hospital === 'sgh' ? rowsFor(state, 'sgh') : null);
  const live = () => normalizeScope(state.scope);
  /** Adopt a new report type. The scope goes with the old one — it was chosen against
   *  that hospital's rows (its labs, its shipment ids) and means nothing for another;
   *  KAMC + SGH takes none at all. modelFor (next render) sees the report type in the
   *  figures key, rebuilds, and drops the overrides (toasting when there were some). */
  function setHospital(next) {
    if (!HOSPITAL_MODES.includes(next) || next === reportHospitalOf(state)) return;
    const hadScope = isScoped(state.scope);
    state.reportHospital = next;
    state.scope = EMPTY_SCOPE;
    view.draft.shipText = null; view.draft.from = null; view.draft.to = null;
    if (hadScope) toast(HS.scopeCleared, 'warn');
    pinShownModel();
    rerenderKeepingPlace({ scopeOpen: true });
  }
  function buildScopeCard() {
    const sc = live();                        // PAINT only: the controls' state (incl. the slide box)
    const ms = model.scope || EMPTY_SCOPE;    // what the numbers were computed for
    const draft = view.draft;
    if (draft.epoch !== state.scopeEpoch) {   // typed-but-unapplied input dies with its data
      draft.epoch = state.scopeEpoch; draft.shipText = null; draft.from = null; draft.to = null;
    }
    const chip = (label, count, on, onClick) => el('button', {
      type: 'button', 'aria-pressed': on ? 'true' : 'false', style: scopeChipStyle(on), onClick,
      // One spoken name for the two visual parts (the Latin lab name + its count pill).
      'aria-label': count == null ? label : `${label} (${count})`,
    }, [
      el('span', { dir: 'auto', text: label }),
      count == null ? null : el('span', { dir: 'ltr', style: SCOPE_COUNT_STYLE, text: String(count) }),
    ]);

    // (0) REPORT TYPE — the hospital selector. Every pill is always selectable: a type
    // whose hospital has no rows is shown as such (and cannot be generated), never
    // silently swapped for KAMC.
    const hospitalSection = el('div', { class: 'field', style: 'margin:0 0 16px' }, [
      el('label', { text: HS.title }),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' },
        HOSPITAL_MODES.map((h) => chip(hospitalLabel(h), null, h === hospital, () => setHospital(h)))),
      el('div', { class: 'hint', text: HS.hint }),
    ]);
    const header = (pillText, pillOn) => el('summary', { class: 'card__title', style: 'cursor:pointer;margin:0;flex-wrap:wrap' }, [
      el('span', { text: SC.title }),
      // The report type is named in the SUMMARY so it reads with the card collapsed.
      // Highlighted for the special single-hospital reports; calm for the main one.
      el('span', { style: scopePillStyle(hospital !== 'both'), text: hospitalLabel(hospital) }),
      pillText ? el('span', { style: scopePillStyle(pillOn), text: pillText }) : null,
    ]);
    if (hospital === 'both' || !allRows) {
      const card = el('details', { class: 'card scope-card' }, [
        header(null, false),
        el('div', { style: 'margin-top:14px' }, [
          hospitalSection,
          hospital === 'both' ? el('p', { class: 'small muted', style: 'margin:0', text: HS.bothNoScope }) : null,
        ]),
      ]);
      // The main report (KAMC + SGH) opens collapsed, as the daily report always has; a
      // single-hospital type with nothing to scope opens (its empty notice is up top).
      card.open = restore ? !!restore.scopeOpen : hospital !== 'both';
      return card;
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
      header(isScoped(ms) ? SC.active : SC.allLabs, isScoped(ms)),
      el('div', { style: 'margin-top:14px' }, [active, hospitalSection, labsSection, shipSection, rangeSection]),
    ]);
    // Only KAMC-only / SGH-only reach this branch (the main KAMC + SGH report takes no
    // scope — above), and both are special single-hospital reports: open, so the
    // operator sees what shapes the deck. Our own rerender keeps whatever the operator
    // last chose.
    card.open = restore ? !!restore.scopeOpen : true;
    return card;
  }
  // Built whenever an order load happened (ordersLoaded), even one with no KAMC or SGH
  // rows: the report-type pills are how the operator leaves a blocked type.
  if (ordersLoaded(state)) scopeCard = buildScopeCard();
  // (e) SIDE REPORT banner — above everything else on the screen, so a scoped deck can
  // never be generated by someone who did not notice it was scoped. The same sentence is
  // repeated on the generate screen's success panel. An SGH report is a side report too:
  // the banner names the report type and says it is recorded nowhere. NOT the main
  // KAMC + SGH report (it IS recorded — KAMC's numbers, pipeline.js recordRunSnapshot)
  // and not the unscoped KAMC report (recorded as it always was): no banner for either.
  const side = sideReportNotice(model);
  const sideBanner = side ? el('div', {
    class: 'card', role: 'status',
    style: 'border:1px solid var(--amber);background:var(--warn-bg,#FEF3C7);color:var(--warn-text,#92400E);padding:12px 16px;display:flex;gap:10px;align-items:flex-start',
  }, [
    el('span', { text: '⚠', 'aria-hidden': 'true', style: 'font-size:1.1rem;line-height:1.5' }),
    el('div', { style: 'min-width:0' }, [
      el('div', { style: 'font-weight:800', text: side.title }),
      el('div', { class: 'small', text: side.text }),
    ]),
  ]) : null;
  // (f) NOTHING TO REPORT — the chosen report type's hospital has no rows in the loaded
  // data (hospitalAvailability): said at the very top, in the error colour, and the
  // generate button is disabled. KAMC + SGH with ONE hospital absent is allowed (its
  // cells print 0) and gets a calmer line naming it.
  let availNote = null;
  if (avail.blocked) {
    availNote = el('div', {
      class: 'card', role: 'alert',
      style: 'border:1px solid var(--red);background:var(--bad-bg,#FEE2E2);color:var(--bad-text,#991B1B);padding:12px 16px;font-weight:700',
      text: HS.empty(hospitalLabel(hospital)),
    });
  } else if (avail.missing.length) {
    availNote = el('div', {
      class: 'card', role: 'status',
      style: 'padding:10px 16px;background:var(--info-bg,#E0E7FF);color:var(--info-text,#1E3A8A)',
      text: avail.missing.map((h) => HS.bothMissing(hospitalLabel(h))).join(' '),
    });
  }

  // Banner FIRST, then the week-history panel, then daily-edited items (date →
  // project tracker → challenges/risks), then the advanced KPI-override and
  // label-customisation cards, then generate. Challenges / risks only where a deck
  // renders them: the single-hospital KAMC / SGH decks (the main KAMC + SGH deck has no
  // challenges slide, so their editors would change nothing there).
  const manualCards = hospital === 'both' ? [] : [challengesCard, risksCard];
  const controls = el('div', { class: 'review-controls' }, [
    deltaArea, historyHost, dateField, trackerCard, ...manualCards, kpiCard, labelsHost, generateBtn,
  ]);
  const preview = el('div', { class: 'review-preview' }, [slideToggleRow, orderCard, previewFrame]);

  // THIRD hospitals' orders the upload left out (state.parsed.excludedHospitals — neither
  // KAMC nor SGH; set beside every write of the orders, see state.js): one muted line
  // under the subtitle, so the reviewer reads it before generating. Only after an order
  // load (ordersLoaded) — including one whose lines were ALL a third hospital's, where
  // this line is the reason the report is blocked; with no load, nothing was left out. App screen only (the KAMC deck still names no hospital;
  // the SGH / KAMC + SGH decks print only the reference's KAMC / SGH names).
  const excludedHospitals = (ordersLoaded(state) && state.parsed.excludedHospitals) || [];
  const head = el('div', { class: 'screen__head' }, [
    el('h1', { text: STR.review.title }),
    el('p', { text: STR.review.subtitle }),
    // Inline size/colour: `.screen__head p` outranks .small/.muted and would print this
    // in the subtitle's own voice.
    excludedHospitals.length ? el('p', {
      role: 'note', style: 'margin-top:4px;font-size:.85rem;color:var(--slate-500)',
      text: excludedHospitals.map((h) => STR.review.hospitalExcluded(h.count, h.name || h.id)).join(' · '),
    }) : null,
  ]);

  // Source order: controls first (RTL => right), preview second (left/main).
  // The side-report banner and the scope card come first, full width: they decide what
  // every number below describes. Unattributed send-out orders are surfaced next, above
  // the controls, because this is the last screen before the deck is generated; the
  // by-test-name disclosure follows them in its calmer, informational tone.
  // KAMC + SGH: the send-out cards describe KAMC's attribution (the countries slide's
  // source); SGH has no catalogue, so it has no gaps to report.
  const sendoutModel = hospital === 'both' ? model.kamc : model;
  const screenRoot = el('div', { class: 'screen' }, [
    head,
    availNote,
    sideBanner,
    scopeCard,
    sendoutGapsCard(sendoutModel),
    sendoutByTestNameCard(sendoutModel),
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
