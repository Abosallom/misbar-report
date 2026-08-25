// automation/pipeline.js — the headless automation core (Track 1).
//
// Two exports carry the weight:
//   • produceReportFiles() — the file-producing engine lifted VERBATIM out of
//     ui/screen-generate.js (spec build → PPTX/PDF over both VARIANTS, the
//     offscreen render host, the fast-timer install/restore, the per-file
//     timeout). screen-generate now drives it through `onProgress` events and
//     paints exactly the same UX it always did; nothing about the produced
//     files or their order changed.
//   • runAutomation() — runs the same daily flow with NO screen navigation:
//     pull → engine → generate → labs → emails. Every step is optional, every
//     step is isolated, and every heavy dependency is injectable so the logic
//     is testable in plain node (see test/pipeline.test.mjs).
//
// PHI rule unchanged: order rows live in `state` only. Nothing here logs a row
// or writes one to storage — only aggregate numbers reach store.updateSnapshot.
import { STR, todayISO, buildFileName } from '../i18n/ar.js?v=v2026-08-25.1';
import { VARIANTS, normTest } from '../contracts.js?v=v2026-08-25.1';
import { getGenLibs } from '../vendor-loader.js?v=v2026-08-25.1';

/* ------------------------------------------------------------------ *
 * Shared micro-helpers (same idioms the screens use)
 * ------------------------------------------------------------------ */

async function tryImport(path) { try { return await import(path); } catch { return null; } }
function pickFn(mod, names) {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function') return mod[n];
  if (typeof mod.default === 'function') return mod.default;
  return null;
}

/** Format an ISO timestamp as local 'HH:MM' (mirrors screen-upload's helper). */
function fmtHHMM(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ *
 * Delta chips — THE WEEK'S ACTIVITY (2026-08-05, Talal)
 * ------------------------------------------------------------------ */

// THE INVARIANT, first: the BIG numbers on slides 2/3/4 — exec KPI cards, journey stage
// counts, monthly table, compliance table — REMAIN CUMULATIVE TOTALS, untouched. ONLY
// the small green delta chips changed meaning: they are now the WEEK'S ACTIVITY, the
// events dated Sunday..report-day, counted from the CSV's own date columns.
//
// So the stored-baseline stamper is gone. applyDeltaBaseline (kpi numbers minus
// pickDeltaBaseline's chosen stored report) and its local currentNumbersOf twin are
// DELETED; model/delta-window.js stampWindowDeltas is the ONE stamper, shared verbatim
// with ui/screen-review.js. It writes model.kpi.deltas (signed — a drained queue must
// surface as '−N') and model.deltaWindow {start, end, mode, approx?}, which REPLACES
// model.deltaBaseline for build-spec's legend and the review banner.
//
// WHY THIS FILE'S IDIOM DOESN'T CHANGE: the module stays an INJECTED, guarded dependency
// (DEFAULT_DEPS.loadDeltaWindow → tryImport; the stamper arrives as an argument), exactly
// as the picker did, and for the identical reason. A static import would make
// model/delta-window.js a HARD dependency of pipeline.js, so a missing or export-skewed
// module would fail this file at LOAD time and main.js's headless trigger
// (`await import('./automation/pipeline.js')`, which catches and abandons the run) would
// produce NO REPORT AT ALL — instead of degrading to the engine's own clamped deltas the
// way this function promises.
//
// The mode is read from settings the same way, but note what it now selects: the SIZE OF
// THE WINDOW ('week' = Sunday..report-date, 'daily' = the report date alone), not which
// stored report to diff against. The RAW stored value is passed through deliberately —
// stampWindowDeltas normalizes it (normalizeDeltaMode, whose documented fallback is the
// DEFAULT 'week', never 'daily'), so a `|| 'daily'` here would silently re-daily-ify every
// falsy stored mode. That exact bug shipped once: seedSettings() writes no reportOptions
// key, so the local-store path always lands on the fallback, and screen-generate re-runs
// THIS copy over the model screen-review already stamped — the deck won every
// disagreement. It cannot recur now for a second reason too: the stamper is a PURE
// function of (rows, reportDate, mode), so two runs on one model are deep-equal.
//
// DEGRADES, never throws: no stamper, no rows, or an unusable report date → kpi.deltas is
// left exactly as the engine produced it.
export function applyWindowDeltas(model, state, store, stampWindowDeltas) {
  if (typeof stampWindowDeltas !== 'function' || !model || !model.kpi) return;
  const settings = (store && store.settings) || {};
  try {
    stampWindowDeltas(model, {
      rows: (state && state.parsed && state.parsed.orders) || null,
      tatTests: settings.tatLookup || {},
      mode: settings.reportOptions && settings.reportOptions.deltaMode,
    });
  } catch (e) {
    console.warn('[generate] stampWindowDeltas failed; keeping engine deltas', e);
  }
}

/**
 * R2 — does the MANUAL generate flow push the 4 produced files to the browser by itself?
 *
 * TWO SWITCHES, DELIBERATELY INDEPENDENT — do not merge them:
 *   • reportOptions.autoDownloadFiles (THIS predicate) is a PRESENTATION choice for the
 *     run the operator is watching: ON (the shipped behaviour, and what an absent key
 *     means) auto-saves the 4 files the moment they are ready; OFF leaves the success
 *     panel's per-file buttons as the only way to download, which is what an operator
 *     who only wants the PDF asks for.
 *   • automation.autoDownload gates the UNATTENDED run (runAutomation stepGenerate /
 *     autoDownloadAll) — deck files, lab workbooks AND email drafts, with nobody at the
 *     screen. A checkbox about how a hand-driven generation presents its output must
 *     never arm a background download, so neither flag is read as a fallback for the
 *     other and neither writes the other.
 *
 * Pure (no DOM, no storage) so plain node can pin the truth table. `mobile` is the
 * caller's platform answer (screen-generate passes isMobile()): iOS/Safari drops
 * programmatic download clicks that fire without recent user activation, so a mobile run
 * NEVER auto-downloads regardless of the setting — unchanged platform reality, not a
 * second preference.
 *
 * @param {{settings?:Object, mobile?:boolean}} args
 * @returns {boolean}
 */
export function shouldAutoDownloadFiles({ settings, mobile } = {}) {
  if (mobile) return false;
  const ro = settings && settings.reportOptions;
  if (!ro || typeof ro !== 'object') return true; // no options doc at all → shipped behaviour
  // Absent/null = ON (the key post-dates the feature, so every existing doc lacks it and
  // must keep auto-downloading); anything else is read for truthiness, so the store's
  // coerce-tolerant import path and a hand-edited backup both land on a real boolean.
  return ro.autoDownloadFiles == null ? true : !!ro.autoDownloadFiles;
}

/** Variant → the model task list THAT variant's deck publishes (build-spec.js:1213). */
const VARIANT_TASK_LIST = Object.freeze({ nupco: 'tasksCurrent', internal: 'tasksInternal' });

/**
 * Normalize the "which variants actually shipped a file" hint into a Set — or null
 * when the caller did not, or could not, say. null means "assume both shipped",
 * which is byte-for-byte the behaviour this function had before the hint existed:
 * a caller that omits it (screen-generate today) and a test double whose file defs
 * carry no `variant` both keep recording both lists. Only a POSITIVE statement that
 * a variant is missing withholds that variant's list.
 */
function shippedVariantSet(shippedVariants) {
  if (!shippedVariants || typeof shippedVariants[Symbol.iterator] !== 'function') return null;
  let raw;
  try { raw = [...shippedVariants]; } catch { return null; }
  const known = raw.filter((v) => Object.prototype.hasOwnProperty.call(VARIANT_TASK_LIST, v));
  return known.length ? new Set(known) : null;
}

/**
 * Persist the FULL number snapshot + append it to snapshotHistory — the exact
 * store path (and warning strings) screen-generate has always used, shared so an
 * automated run feeds the delta/history features identically.
 *
 * ALSO records what this report SHOWED (`recordShownTasks`, the closed-task grace
 * log) in a second, INDEPENDENT block below: the numbers write is unchanged and a
 * failure in either one cannot take the other down.
 * @param {{recordShownTasks?:Function, shippedVariants?:Iterable<string>}} args -
 *   `recordShownTasks` is the task-lifecycle writer; omitted = numbers-only
 *   behaviour, exactly as before. `shippedVariants` lists the deck variants that
 *   actually produced at least one file (see shippedVariantSet); omitted = both.
 */
export function recordRunSnapshot({
  model, store, state, date, recordSnapshot, recordShownTasks, shippedVariants,
} = {}) {
  try {
    const k = (model && model.kpi) || {};
    const numbers = {
      total: k.totals && k.totals.total,
      collected: k.funnel && k.funnel.collected,
      dispatched: k.funnel && k.funnel.dispatched,
      received: k.funnel && k.funnel.received,
      completed: k.buckets && k.buckets.completed,
      rejected: k.buckets && k.buckets.rejected,
      awaitingDispatch: k.buckets && k.buckets.awaitingDispatch,
      shippedNotReceived: k.buckets && k.buckets.shippedNotReceived,
      awaitingResults: k.buckets && k.buckets.awaitingResults,
      lateNoResult: k.buckets && k.buckets.lateNoResult,
    };
    if (numbers.completed != null && store && typeof store.updateSnapshot === 'function') {
      store.updateSnapshot({ asOf: date, numbers });
      // ALSO append this run to snapshotHistory (deltaMode baselines read from it).
      // Persist through loadSettings/saveSettings — the same path review uses for
      // reportOptions. Guarded so a missing module or a store that rejects the key
      // degrades gracefully without failing the (already-successful) generation.
      if (typeof recordSnapshot === 'function') {
        try {
          const doc = store.loadSettings();
          doc.snapshotHistory = recordSnapshot(doc.snapshotHistory, date, numbers);
          store.saveSettings(doc);
        } catch (e) { console.warn('[generate] snapshotHistory write failed', e); }
      }
      if (state) state.settings = store.settings;
    }
  } catch (e) { console.warn('[generate] snapshot update failed', e); }

  // ---- closed-task lifecycle (v6) — INDEPENDENT of the numbers block above ----
  // Written from the FINAL model, so manual review edits are recorded exactly as
  // published (a grace row the reviewer deleted keeps its grace for the next
  // report — it was never actually shown). This runs only after files were really
  // produced, and is NOT gated on numbers.completed: a report can legitimately
  // publish tasks without a fresh number set.
  // The length guard is what keeps the pipeline tests' minimal store/model stubs
  // working — a model with no task arrays simply has nothing to record.
  //
  // PER VARIANT, not per run (review fix 2026-08-04): produceReportFiles skips a
  // failed file instead of throwing, so a run can ship the internal pair while both
  // نوبكو files time out. Recording BOTH lists then would stamp closedOn on every
  // مغلق row of tasksCurrent — burning their single grace appearance on a deck the
  // NUPCO audience never receives, and the next report prunes them for good. A
  // variant that shipped nothing therefore contributes an EMPTY list: its entries
  // keep openOn/closedOn:null and earn their grace on the next successful run.
  try {
    if (typeof recordShownTasks !== 'function' || !model || !date) return;
    const shipped = shippedVariantSet(shippedVariants);
    const listOf = (variant) => {
      const rows = model[VARIANT_TASK_LIST[variant]];
      if (!Array.isArray(rows)) return [];
      return (shipped && !shipped.has(variant)) ? [] : rows;
    };
    const tasksCurrent = listOf('nupco');
    const tasksInternal = listOf('internal');
    if (!tasksCurrent.length && !tasksInternal.length) return; // nothing was shown
    if (!store || typeof store.loadSettings !== 'function'
        || typeof store.saveSettings !== 'function') return;
    const doc = store.loadSettings();
    doc.taskLog = recordShownTasks(doc.taskLog, { reportDate: date, tasksCurrent, tasksInternal });
    store.saveSettings(doc);
    if (state) state.settings = store.settings;
  } catch (e) { console.warn('[generate] task lifecycle write failed', e); }
}

/* ------------------------------------------------------------------ *
 * File production (lifted from screen-generate)
 * ------------------------------------------------------------------ */

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout:' + (label || ''))), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// Hidden/background tabs clamp setTimeout to >=1s, which stretches JSZip's and
// html2canvas's chunked loops from seconds to minutes. During generation we route
// short timeouts through a MessageChannel (not throttled), then restore.
function installFastTimers() {
  if (typeof window === 'undefined' || typeof MessageChannel !== 'function') return () => {};
  if (window.__misbarFastTimers) return () => {};
  const orig = window.setTimeout;
  const mc = new MessageChannel();
  const q = [];
  mc.port1.onmessage = () => {
    const fn = q.shift();
    if (fn) { try { fn(); } catch (e) { console.error('[fast-timer]', e); } }
  };
  window.setTimeout = function (fn, ms, ...args) {
    if (typeof fn === 'function' && (ms == null || ms <= 50)) {
      q.push(() => fn(...args));
      mc.port2.postMessage(0);
      return -1;
    }
    return orig.call(window, fn, ms, ...args);
  };
  window.__misbarFastTimers = true;
  return () => { window.setTimeout = orig; window.__misbarFastTimers = false; };
}

// Build the SlideSpec per VARIANT — the variant changes slide-5 content
// (task rows), so one shared spec would leak internal tasks into NUPCO files.
async function buildVariantSpec(model, variant) {
  const mod = await tryImport('../slidespec/build-spec.js?v=v2026-08-25.1');
  const fn = pickFn(mod, ['buildSpec', 'build', 'makeSpec', 'toSpec']);
  if (!fn) return null;
  let spec = fn(model, { variant });
  if (spec && spec.then) spec = await spec;
  if (spec && !Array.isArray(spec) && spec.slides) spec = spec.slides;
  return Array.isArray(spec) ? spec : null;
}

async function toBlob(result, kind) {
  if (!result) return null;
  if (result instanceof Blob) return result;
  if (kind === 'pptx' && typeof result.write === 'function') {
    const out = await result.write({ outputType: 'blob' });
    return out instanceof Blob ? out : new Blob([out]);
  }
  if (kind === 'pdf' && typeof result.output === 'function') {
    return result.output('blob');
  }
  if (result.blob instanceof Blob) return result.blob;
  return null;
}

// renderPptx(spec, {variant, PptxGenJS}) -> Promise<Blob>
async function makePptx(spec, variant, libs) {
  if (!spec) return null;
  const mod = await tryImport('../render/pptx-renderer.js?v=v2026-08-25.1');
  const fn = pickFn(mod, ['renderPptx', 'buildPptx', 'toPptx', 'makePptx', 'render']);
  if (!fn) return null;
  const r = await fn(spec, { variant, PptxGenJS: libs.PptxGenJS });
  return toBlob(r, 'pptx');
}

// renderSlides(spec, {variant}) -> fragment of .sl-slide; exportPdf(slideEls, {jsPDF, html2canvas, onProgress}).
// onSlides(slideEls) fires once per variant, right after the full-size slides land in
// the host and before capture starts — screen-generate clones them into live thumbnails.
async function makePdf(spec, variant, libs, host, onProgress, onSlides) {
  if (!spec) return null;
  const rMod = await tryImport('../render/html-renderer.js?v=v2026-08-25.1');
  const renderSlides = pickFn(rMod, ['renderSlides', 'renderSpec', 'renderHtml', 'render']);
  const pMod = await tryImport('../render/pdf-export.js?v=v2026-08-25.1');
  const exportPdf = pickFn(pMod, ['exportPdf', 'renderPdf', 'toPdf', 'buildPdf', 'render']);
  if (!renderSlides || !exportPdf) return null;
  host.innerHTML = '';
  const frag = renderSlides(spec, { variant });
  // Remember exactly the nodes THIS job put in the host. withTimeout only stops
  // waiting — a timed-out job keeps rendering into the same shared host — so on
  // the way out a job may remove only its own nodes and never the slides of the
  // job that replaced it. The DOM shape is unchanged: slides stay direct
  // children of .render-host, so capture/output is byte-identical.
  const mine = (frag instanceof Node)
    ? (frag.nodeType === 11 ? Array.from(frag.childNodes) : [frag])
    : [];
  if (frag instanceof Node) host.appendChild(frag);
  const slideEls = Array.from(host.querySelectorAll('.sl-slide'));
  if (onSlides) onSlides(slideEls); // clone once per variant, before capture starts
  const r = await exportPdf(slideEls, { jsPDF: libs.jsPDF, html2canvas: libs.html2canvas, onProgress });
  for (const n of mine) if (n.parentNode === host) host.removeChild(n);
  return toBlob(r, 'pdf');
}

/**
 * The four report files of a run, in produce order. Exported so screen-generate can
 * paint its file rows BEFORE generation starts and still share one definition.
 * @param {string} dateStr - report date ('yyyy-mm-dd')
 */
export function buildFileDefs(dateStr) {
  const date = dateStr || todayISO();
  return [
    { id: 'internal-pptx', variant: 'internal', kind: 'pptx', label: STR.generate.fileInternalPptx, icon: '📊', name: buildFileName(VARIANTS.internal.filePrefix, date, 'pptx') },
    { id: 'nupco-pptx', variant: 'nupco', kind: 'pptx', label: STR.generate.fileNupcoPptx, icon: '📊', name: buildFileName(VARIANTS.nupco.filePrefix, date, 'pptx') },
    { id: 'internal-pdf', variant: 'internal', kind: 'pdf', label: STR.generate.fileInternalPdf, icon: '📄', name: buildFileName(VARIANTS.internal.filePrefix, date, 'pdf') },
    { id: 'nupco-pdf', variant: 'nupco', kind: 'pdf', label: STR.generate.fileNupcoPdf, icon: '📄', name: buildFileName(VARIANTS.nupco.filePrefix, date, 'pdf') },
  ];
}

/**
 * produceReportFiles({model, ctx, onProgress, host, signal}) → [{def, blob}]
 *
 * The 4 report files (2 PPTX + 2 PDF). Behaviour is identical to the code that
 * used to live inline in screen-generate: fast timers installed for the whole
 * run, both specs built up front, each file guarded by a 300s timeout, a failed
 * file logged and skipped (never thrown).
 *
 * onProgress(evt) receives every UI-relevant moment; screen-generate maps them
 * back onto its progress bar / rows / thumbnails, headless callers ignore them:
 *   {phase:'spec'}                                     — libs ready, specs next
 *   {phase:'file-start',  def, index, total, base}
 *   {phase:'slides',      def, index, total, slideEls} — PDF slides rendered
 *   {phase:'capture',     def, index, total, base, done, tot}
 *   {phase:'file-done'|'file-error', def, index, total}
 *   {phase:'file-end',    def, index, total}
 *   {phase:'error',       error}                       — gen libs failed
 *
 * `host` is the offscreen full-size .render-host element html2canvas captures
 * from. When omitted (headless runs) a detached-from-view host is created on
 * document.body and removed again on the way out.
 *
 * `signal` (optional) is checked between files: an aborted run stops before the
 * next file starts and returns the ones already produced. Omitting it keeps the
 * exact behaviour screen-generate has always had.
 */
export async function produceReportFiles({ model, ctx, onProgress, host, signal } = {}) {
  // A broken listener must never break the run — the same rule runAutomation's emit follows.
  const emit = (evt) => {
    if (!onProgress) return;
    try { onProgress(evt); } catch (e) { console.warn('[generate] onProgress failed', e); }
  };
  const date = (model && model.reportDate) || todayISO();
  const fileDefs = buildFileDefs(date);

  let ownHost = null;
  let renderHost = host || null;
  if (!renderHost && typeof document !== 'undefined') {
    ownHost = document.createElement('div');
    ownHost.className = 'render-host';
    document.body.appendChild(ownHost);
    renderHost = ownHost;
  }

  const produced = []; // {def, blob}
  const restoreTimers = installFastTimers();

  try {
    const libs = await getGenLibs();
    emit({ phase: 'spec' });
    const specs = {
      internal: await buildVariantSpec(model, 'internal'),
      nupco: await buildVariantSpec(model, 'nupco'),
    };
    const total = fileDefs.length;

    for (let i = 0; i < fileDefs.length; i++) {
      // Honour an abort between files: the caller keeps whatever already landed.
      if (signal && signal.aborted) break;
      const f = fileDefs[i];
      const spec = specs[f.variant];
      const base = (i / total) * 100;
      emit({ phase: 'file-start', def: f, index: i, total, base });

      let blob = null;
      try {
        // Guard each file with a timeout so a hanging renderer degrades gracefully
        // instead of freezing the whole screen (e.g. PptxGenJS.write stalls in some envs).
        const job = f.kind === 'pptx'
          ? makePptx(spec, f.variant, libs)
          : makePdf(spec, f.variant, libs, renderHost, (done, tot) => {
            emit({ phase: 'capture', def: f, index: i, total, base, done, tot });
          }, (slideEls) => emit({ phase: 'slides', def: f, index: i, total, slideEls }));
        // Generous ceilings: background-tab setTimeout throttling can stretch
        // JSZip/canvas work from seconds to minutes; only a true hang should trip this.
        blob = await withTimeout(job, 300000, f.id);
      } catch (e) {
        console.error('[generate] file failed', f.id, e);
      }

      if (blob) {
        produced.push({ def: f, blob });
        emit({ phase: 'file-done', def: f, index: i, total });
      } else {
        emit({ phase: 'file-error', def: f, index: i, total });
      }
      emit({ phase: 'file-end', def: f, index: i, total });
    }
  } catch (e) {
    console.error('[generate] gen libs failed', e);
    // The last event of a failed run must never itself throw — the caller still
    // needs the (possibly partial) file list and its own failure UI. emit() is
    // already listener-guarded, so no second try is needed here.
    emit({ phase: 'error', error: e });
  } finally {
    restoreTimers();
  }

  if (renderHost) renderHost.innerHTML = '';
  if (ownHost && ownHost.parentNode) ownHost.parentNode.removeChild(ownHost);

  return produced;
}

/* ------------------------------------------------------------------ *
 * runAutomation — the headless daily flow
 * ------------------------------------------------------------------ */

export const AUTOMATION_DEFAULTS = Object.freeze({
  enabled: false, autoPull: false, autoGenerate: false, autoDownload: false,
  autoLabFiles: false, autoEmailDrafts: false, autoAcceptTat: false, dailyTime: '08:00',
});

export const AUTOMATION_STEPS = ['pull', 'engine', 'generate', 'labs', 'emails'];

// Step → the option that gates it. 'engine' has no switch: it is the shared
// prerequisite, and it skips by itself when there is no order data to compute.
const STEP_OPTION = Object.freeze({
  pull: 'autoPull', generate: 'autoGenerate', labs: 'autoLabFiles', emails: 'autoEmailDrafts',
});

const MSG = Object.freeze({
  disabled: 'الخطوة غير مفعّلة',
  masterOff: 'المفتاح الرئيسي مطفأ',
  reusedPull: 'بيانات محدَّثة للتو — أُعيد استخدامها ({n} طلب)',
  aborted: 'تم الإلغاء',
  noGrafana: 'الاتصال المباشر غير مهيأ',
  noOrders: 'لا توجد بيانات طلبات',
  noEngine: 'محرك الحساب غير متوفر',
  engineFailed: 'تعذّر حساب المؤشرات',
  noModel: 'لا يوجد نموذج تقرير',
  noFiles: 'تعذّر إنشاء ملفات التقرير',
  noLabFiles: 'لا توجد ملفات مختبرات',
  noLateLabs: 'لا توجد فحوصات متأخرة أو مستحقة',
  noEmlModule: 'وحدة مسودات البريد غير متوفرة',
  draftsFailed: 'تعذّر إنشاء مسودات البريد',
});

const ABORTED = 'aborted';
const SHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// A live pull that landed this recently is reused instead of re-issued: the upload
// screen fires its own fetchLive() as it renders, and an automation run kicked off
// right behind it would otherwise query the identical window a second time.
const PULL_REUSE_MS = 15000;

/** Default heavy dependencies — every one overridable through `deps` (tests inject fakes). */
const DEFAULT_DEPS = Object.freeze({
  loadGrafana: () => import('../ingest/grafana.js?v=v2026-08-25.1'),
  loadEngine: () => tryImport('../engine/engine.js?v=v2026-08-25.1'),
  loadReportModel: () => import('../model/report-model.js?v=v2026-08-25.1'),
  loadDeltaBaseline: () => tryImport('../model/delta-baseline.js?v=v2026-08-25.1'),
  // The delta-chip stamper. Guarded like the rest: a build without it degrades to the
  // engine's own clamped deltas instead of failing this module at load time.
  loadDeltaWindow: () => tryImport('../model/delta-window.js?v=v2026-08-25.1'),
  loadTaskLifecycle: () => tryImport('../model/task-lifecycle.js?v=v2026-08-25.1'),
  loadLateLabs: () => import('../export/late-labs.js?v=v2026-08-25.1'),
  loadTatSuggest: () => tryImport('../ingest/tat-suggest.js?v=v2026-08-25.1'),
  loadTatLoinc: () => tryImport('../seeds/tat-lookup.js?v=v2026-08-25.1'),
  // Track 5's module; absent until it ships → the emails step reports 'skip'.
  loadEmlDraft: () => tryImport('../export/eml-draft.js?v=v2026-08-25.1'),
  loadDownload: () => tryImport('../ui/late-labs-section.js?v=v2026-08-25.1'),
  produceReportFiles,
  now: () => Date.now(),
});

// Module-level guard: only one automation run at a time, per document.
let RUNNING = false;

/** compute() opts — identical to the upload screen's engineOpts(). */
function engineOpts(state, settings) {
  return {
    asOf: state.reportDate || todayISO(),
    cancelledByMonth: (settings.historicalConstants || {}).cancelledByMonth || {},
    snapshot: settings.snapshot,
    excludeNoTat: !!(settings.reportOptions && settings.reportOptions.excludeNoTat),
  };
}

/** The upload screen's file-less fallback: last-parsed tracker cached in settings. */
function resolveTracker(state, settings) {
  if (state.parsed && state.parsed.tracker) return state.parsed.tracker;
  const ct = settings.cachedTracker;
  return (ct && ct.model) || null;
}

/**
 * Email recipients for a lab, read from the canonical settings block
 * `settings.automation.labRecipients` — the same map the Settings tab writes and
 * late-labs-section reads. The store only ever persists comma-separated strings
 * there, but an array is tolerated too. A missing lab key yields [] (no To: line).
 */
function resolveRecipients(settings, lab) {
  const map = ((settings && settings.automation) || {}).labRecipients || {};
  const raw = map[lab];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') return raw.split(/[,;\s]+/).filter(Boolean);
  return [];
}

/** Test names in the data with no TAT entry (mirrors the upload screen's computeUnmatched). */
function computeUnmatched(orders, tatLookup) {
  const keys = new Set(Object.keys(tatLookup || {}).map(normTest));
  const seen = new Map();
  for (const o of orders) {
    const name = o.testName;
    if (!name) continue;
    const n = normTest(name);
    if (!keys.has(n) && !seen.has(n)) seen.set(n, name);
  }
  return [...seen.values()];
}

/**
 * autoAcceptTat: apply ingest/tat-suggest's computed durations for the unmatched
 * tests — the upload screen's 'اعتماد جميع المقترحات' call, but restricted to the
 * HIGH-confidence suggestions only (LOINC/CSV exact matches). That is exactly what
 * the switch advertises ('اعتماد مقترحات مدة الفحص عالية الثقة تلقائياً'): an
 * unattended run must never write a 'medium' token-similarity guess or a 'low'
 * observed-median guess into settings.tatLookup, where it would silently drive
 * late/on-time classification in every later report.
 * Fully guarded — a missing module or a failed suggestion changes nothing.
 * @returns {Promise<number>} how many TAT entries were written
 */
async function acceptSuggestedTats(D, store, state) {
  const settings = store.settings || {};
  const orders = (state.parsed && state.parsed.orders) || [];
  if (!orders.length || typeof store.setTat !== 'function') return 0;
  const unmatched = computeUnmatched(orders, settings.tatLookup);
  if (!unmatched.length) return 0;
  const mod = await D.loadTatSuggest();
  const fn = pickFn(mod, ['suggestTats']);
  if (typeof fn !== 'function') return 0;
  const seeds = await D.loadTatLoinc();
  let results = fn({
    unmatched,
    rows: orders,
    tatLookup: settings.tatLookup,
    tatLoinc: (seeds && seeds.TAT_LOINC) || undefined,
  });
  if (results && typeof results.then === 'function') results = await results;
  if (!Array.isArray(results)) return 0;
  let n = 0;
  for (const r of results) {
    if (!r || r.suggested == null || r.confidence !== 'high') continue;
    store.setTat(r.testName, r.suggested);
    n++;
  }
  if (n) state.settings = store.settings;
  return n;
}

/**
 * runAutomation({store, state, ctx, options, onEvent, signal, deps})
 *   → {ok, steps:[{id,status,message}], files:[{name,blob}],
 *      labFiles:[{lab,fileName,bytes}], drafts:[{lab,fileName,blob}], errors:[string]}
 *
 * Headless: no screen is rendered or navigated to. options.enabled is the master
 * switch: when it is false every action step reports 'skip' no matter what its own
 * option says. A step whose option is false never runs (status 'skip'); a step that
 * throws records an error and the run continues — labs/emails do not depend on
 * generate. A second concurrent call resolves immediately with
 * errors:['already-running']. `signal` is honoured between steps (and between the
 * generated files): everything after the abort reports 'skip'.
 */
export async function runAutomation({
  store, state, ctx, options, onEvent, signal, deps,
} = {}) {
  if (RUNNING) {
    return { ok: false, steps: [], files: [], labFiles: [], drafts: [], errors: ['already-running'] };
  }
  RUNNING = true;

  const D = { ...DEFAULT_DEPS, ...(deps || {}) };
  const opts = { ...AUTOMATION_DEFAULTS, ...(options || {}) };
  const theStore = store || (ctx && ctx.store) || {};
  const theState = state || (ctx && ctx.state) || {};
  if (!theState.parsed) theState.parsed = { orders: null, tracker: null, summary: null };
  if (!theState.files) theState.files = { csv: null, tracker: null };

  const steps = [];
  const errors = [];
  const files = [];
  const labFiles = [];
  const drafts = [];

  const N = AUTOMATION_STEPS.length;
  const emit = (step, status, message, pct) => {
    if (typeof onEvent !== 'function') return;
    // A broken listener must never break the run.
    try { onEvent({ step, status, message, pct }); } catch (e) { console.warn('[automation] onEvent failed', e); }
  };

  /* ---- the steps ------------------------------------------------- */

  // Live snapshot / Grafana pull — the SAME sequence the upload screen's
  // fetchLive() runs: direct public-dashboard query first, and on a CORS/network
  // TypeError fall back to the encrypted snapshot when a data key is configured.
  async function stepPull() {
    const settings = theStore.settings || {};
    const gcfg = settings.grafana || {};
    const dataKey = (gcfg.dataKey || '').trim();
    const ready = !!(gcfg.enabled && ((gcfg.baseUrl && gcfg.accessToken) || dataKey));
    if (!ready) return { status: 'skip', message: MSG.noGrafana };

    // Rows that landed seconds ago (the screen's own fetch, or a previous run)
    // are reused rather than re-fetched — heroDataAt carries the DATA's age, so a
    // stale snapshot still triggers a real pull.
    const have = theState.parsed.orders;
    if (have && have.length && theState.heroDataAt) {
      const age = D.now() - Date.parse(theState.heroDataAt);
      if (Number.isFinite(age) && age >= 0 && age < PULL_REUSE_MS) {
        return { message: MSG.reusedPull.replace('{n}', String(have.length)) };
      }
    }

    const mod = await D.loadGrafana();
    const asOf = theState.reportDate || todayISO();
    const directConfigured = !!(gcfg.baseUrl && gcfg.accessToken);
    let message;
    try {
      // Preferred path: direct browser → Grafana query (when configured).
      if (!directConfigured) throw new TypeError('direct source not configured');
      const res = await mod.fetchKamcOrders(gcfg, { fromMs: mod.yearStartMs(asOf), toMs: D.now() });
      theState.parsed.orders = res.rows;
      theState.heroDataAt = new Date(D.now()).toISOString(); // freshness for 'لمحة اليوم'
      theState.files.csv = { name: `${STR.upload.grafanaSourceName} ${new Date(D.now()).toLocaleString('en-GB')}` };
      message = STR.upload.grafanaOk.replace('{n}', String(res.rows.length));
    } catch (direct) {
      // A CORS/network failure surfaces as TypeError. If a data key is set, fall
      // back to the encrypted snapshot the GitHub Action publishes server-side.
      if (direct instanceof TypeError && dataKey) {
        const snap = await mod.fetchKamcSnapshot(dataKey);
        theState.parsed.orders = snap.rows;
        theState.heroDataAt = snap.fetchedAt; // snapshot's real age, not load time
        const t = fmtHHMM(snap.fetchedAt);
        theState.files.csv = { name: `${STR.upload.grafanaSnapshotName} ${t}`.trim() };
        message = STR.upload.grafanaSnapshotOk.replace('{n}', String(snap.rows.length)).replace('{t}', t);
      } else {
        throw direct;
      }
    }

    if (opts.autoAcceptTat) {
      try {
        const n = await acceptSuggestedTats(D, theStore, theState);
        if (n) message = `${message} — اعتُمدت ${n} مدة مقترحة`;
      } catch (e) { console.warn('[automation] autoAcceptTat failed', e); }
    }
    return { message };
  }

  // Engine + ReportModel + delta baseline — the same modules review/generate use.
  async function stepEngine() {
    const orders = theState.parsed.orders;
    if (!orders || !orders.length) return { status: 'skip', message: MSG.noOrders };
    const settings = theStore.settings || {};

    const engineMod = await D.loadEngine();
    const compute = pickFn(engineMod, ['compute', 'runEngine', 'run']);
    if (typeof compute !== 'function') return { status: 'skip', message: MSG.noEngine };
    let out = compute(orders, settings.tatLookup, engineOpts(theState, settings));
    if (out && typeof out.then === 'function') out = await out;
    if (!out || !out.totals) throw new Error(MSG.engineFailed);
    theState.engineOutput = out;

    const reportDate = theState.reportDate || todayISO();
    theState.reportDate = reportDate;
    const rmMod = await D.loadReportModel();
    const buildReportModel = pickFn(rmMod, ['buildReportModel']);
    if (typeof buildReportModel !== 'function') throw new Error(MSG.noModel);
    const model = buildReportModel({
      engineOutput: out,
      tracker: resolveTracker(theState, settings),
      settings,
      reportDate,
      edits: theState.edits || {},
    });
    // Presentation options + per-run manual overrides, exactly as the screens stamp them.
    if (settings.reportOptions) model.reportOptions = settings.reportOptions;
    if (!model.overrides) model.overrides = {};

    const dw = typeof D.loadDeltaWindow === 'function' ? await D.loadDeltaWindow() : null;
    applyWindowDeltas(model, theState, theStore, dw && dw.stampWindowDeltas);
    theState.reportModel = model;

    const total = (out.totals && out.totals.total) != null ? out.totals.total : 0;
    return { message: `${total} طلب` };
  }

  // The 4 report files + the snapshot/history write a successful run owes the
  // delta features. autoDownload additionally pushes them to the browser.
  async function stepGenerate() {
    const model = theState.reportModel;
    if (!model) return { status: 'skip', message: MSG.noModel };
    const produced = await D.produceReportFiles({
      model, ctx: ctx || { state: theState, store: theStore }, onProgress: null, host: null, signal,
    });
    // Which VARIANTS actually shipped: a file whose render failed is skipped by
    // produceReportFiles (logged, never thrown), so "some files landed" is not
    // "both decks landed". The lifecycle write below is gated on this set.
    const shippedVariants = new Set();
    for (const p of (produced || [])) {
      if (!p || !p.blob) continue;
      files.push({ name: (p.def && p.def.name) || '', blob: p.blob });
      if (p.def && p.def.variant) shippedVariants.add(p.def.variant);
    }
    // A stop pressed mid-generation is a cancellation, not a failure.
    if (!files.length) {
      return (signal && signal.aborted)
        ? { status: 'skip', message: MSG.aborted }
        : { status: 'error', message: MSG.noFiles };
    }

    const db = await D.loadDeltaBaseline();
    // Guarded import, like the delta module: a build without task-lifecycle.js
    // records the numbers and simply keeps the previous grace log.
    const tl = typeof D.loadTaskLifecycle === 'function' ? await D.loadTaskLifecycle() : null;
    recordRunSnapshot({
      model,
      store: theStore,
      state: theState,
      date: model.reportDate || todayISO(),
      recordSnapshot: db && db.recordSnapshot,
      recordShownTasks: tl && tl.recordShownTasks,
      shippedVariants,
    });

    if (opts.autoDownload) {
      try {
        const dlMod = await D.loadDownload();
        const triggerDownload = pickFn(dlMod, ['triggerDownload']);
        if (typeof triggerDownload === 'function') {
          for (const f of files) triggerDownload(f.blob, f.name);
        }
      } catch (e) { console.warn('[automation] auto-download failed', e); }
    }
    return { message: `${files.length} ملفات` };
  }

  // Per-lab 'Late & Due' workbooks — independent of the deck.
  async function stepLabs() {
    const orders = theState.parsed.orders;
    if (!orders || !orders.length) return { status: 'skip', message: MSG.noOrders };
    const mod = await D.loadLateLabs();
    const build = pickFn(mod, ['buildLateLabWorkbooks']);
    if (typeof build !== 'function') return { status: 'skip', message: MSG.noLabFiles };
    const wbs = build({
      rows: orders,
      tatTests: (theStore.settings || {}).tatLookup || {},
      asOfMs: D.now(),
    }) || [];
    for (const w of wbs) labFiles.push({ lab: w.lab, fileName: w.fileName, bytes: w.xlsxBytes });
    await autoDownloadAll(labFiles.map((f) => ({
      blob: new Blob([f.bytes], { type: SHEET_MIME }), name: f.fileName,
    })));
    return { message: labFiles.length ? `${labFiles.length} مختبر` : MSG.noLateLabs };
  }

  // Ready-to-send .eml drafts (Track 5). Absent module → a clean 'skip'.
  async function stepEmails() {
    if (!labFiles.length) return { status: 'skip', message: MSG.noLabFiles };
    const mod = await D.loadEmlDraft();
    const build = pickFn(mod, ['buildLabEmailDraft']);
    if (typeof build !== 'function') return { status: 'skip', message: MSG.noEmlModule };
    const settings = theStore.settings || {};
    const reportDate = (theState.reportModel && theState.reportModel.reportDate)
      || theState.reportDate || todayISO();
    let failed = 0;
    for (const lf of labFiles) {
      try {
        let d = build({
          lab: lf.lab,
          fileName: lf.fileName,
          xlsxBytes: lf.bytes,
          recipients: resolveRecipients(settings, lf.lab),
          reportDate,
        });
        if (d && typeof d.then === 'function') d = await d;
        if (d && d.blob) drafts.push({ lab: lf.lab, fileName: d.fileName || lf.fileName, blob: d.blob });
      } catch (e) {
        failed++;
        errors.push(`emails:${lf.lab}: ${(e && e.message) || String(e)}`);
      }
    }
    if (!drafts.length) return { status: 'error', message: MSG.draftsFailed };
    await autoDownloadAll(drafts.map((d) => ({ blob: d.blob, name: d.fileName })));
    return { message: failed ? `${drafts.length} مسودة (${failed} فشلت)` : `${drafts.length} مسودة` };
  }

  // autoDownload covers EVERY artefact a run produces, not just the deck: the lab
  // workbooks and the .eml drafts are the whole point of an unattended morning run.
  // Spaced like the manual 'download all' — browsers drop bursts of same-tick saves.
  async function autoDownloadAll(items) {
    if (!opts.autoDownload || !items.length) return;
    try {
      const dlMod = await D.loadDownload();
      const triggerDownload = pickFn(dlMod, ['triggerDownload']);
      if (typeof triggerDownload !== 'function') return;
      for (let i = 0; i < items.length; i++) {
        if (signal && signal.aborted) return;
        triggerDownload(items[i].blob, items[i].name);
        if (i < items.length - 1) await new Promise((r) => setTimeout(r, 300));
      }
    } catch (e) { console.warn('[automation] auto-download failed', e); }
  }

  const HANDLERS = {
    pull: stepPull, engine: stepEngine, generate: stepGenerate, labs: stepLabs, emails: stepEmails,
  };

  /* ---- the runner ------------------------------------------------ */

  try {
    let aborted = false;
    const masterOff = opts.enabled === false;
    for (let i = 0; i < N; i++) {
      const id = AUTOMATION_STEPS[i];
      const startPct = Math.round((i / N) * 100);
      const endPct = Math.round(((i + 1) / N) * 100);

      if (aborted || (signal && signal.aborted)) {
        aborted = true;
        if (!errors.includes(ABORTED)) errors.push(ABORTED);
        steps.push({ id, status: 'skip', message: MSG.aborted });
        emit(id, 'skip', MSG.aborted, endPct);
        continue;
      }

      // The master switch is enforced HERE, not only by the callers: opts.enabled
      // === false means the automation does NOTHING AT ALL — every step skips,
      // including the ungated 'engine' compute. Off has to mean off, or the
      // switch is a suggestion. With the master on, each action step still needs
      // its own option; 'engine' is the shared prerequisite and runs, skipping
      // itself when there is no order data to compute from.
      const gate = STEP_OPTION[id];
      if (masterOff || (gate && !opts[gate])) {
        const message = masterOff ? MSG.masterOff : MSG.disabled;
        steps.push({ id, status: 'skip', message });
        emit(id, 'skip', message, endPct);
        continue;
      }

      emit(id, 'start', '', startPct);
      try {
        const r = await HANDLERS[id]();
        const status = (r && r.status) || 'done';
        const message = (r && r.message) || '';
        steps.push({ id, status, message });
        if (status === 'error') errors.push(`${id}: ${message}`);
        emit(id, status, message, endPct);
      } catch (e) {
        const message = (e && e.message) || String(e);
        console.error('[automation] step failed', id, e);
        steps.push({ id, status: 'error', message });
        errors.push(`${id}: ${message}`);
        emit(id, 'error', message, endPct);
      }
    }
  } finally {
    RUNNING = false;
  }

  return { ok: errors.length === 0, steps, files, labFiles, drafts, errors };
}

export default runAutomation;
