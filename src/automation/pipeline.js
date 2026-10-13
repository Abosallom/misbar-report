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
//
// REPORT SCOPE (2026-09-29): the review screen can narrow a MANUAL report to some labs /
// shipments / an order-date range. Such a model carries model.scope + model.scopedRows,
// and this file honours it in exactly three places — recordRunSnapshot (writes nothing),
// applyWindowDeltas (chips from the scoped rows) and buildFileDefs (scoped file names).
// runAutomation never PUBLISHES a model it did not build itself: stepEngine drafts from
// the full row set with no scope and hands its model to the later steps through a
// run-local variable, NOT through state.reportModel — that field is the live app state
// the review screen writes, so reading it back would publish whatever (possibly scoped)
// model the operator left there whenever the engine step skipped or failed. So the
// unattended run is the FULL report, or no report.
//
// REPORT TYPES (2026-10-11; user rule revised the same day). Three report types
// (model.hospital): 'both' — KAMC + SGH, the MAIN weekly report; 'kamc' / 'sgh' — the
// special single-hospital reports (absent ⇒ 'kamc': a legacy KAMC-only model). This file
// honours model.hospital in three places — recordRunSnapshot (the main report records
// KAMC's numbers from its KAMC sub-model and never the task log; KAMC records as it always
// did; SGH writes nothing), applyWindowDeltas (each hospital's chips with its own policy)
// and buildFileDefs (the main report keeps the historic names; a single-hospital report
// is tagged with its hospital code).
// The UNATTENDED run makes the MAIN report: stepEngine builds the combined deck with
// model/hospital-report.js buildBothModel over the load's KAMC rows (parsed.orders) and
// SGH rows (parsed.ordersByHospital.sgh — read there and nowhere else), and stepGenerate
// refuses any model that is not the main report. EVERYTHING ELSE stays KAMC's: the
// engine hero output, the TAT auto-accept (an SGH test name must never reach the global
// TAT table), the per-lab Late & Due workbooks and their drafts all read parsed.orders —
// the KAMC rows only (model/hospital.js takeOrders). The operator's state.reportHospital
// is never read.
import { STR, todayISO, buildFileName } from '../i18n/ar.js?v=v2026-10-13.6';
import { VARIANTS, normTest } from '../contracts.js?v=v2026-10-13.6';
import { getGenLibs } from '../vendor-loader.js?v=v2026-10-13.6';
// STATIC on purpose, unlike the injected model modules below: isScoped gates the
// published-history write, and neither guarded fallback is safe — "absent ⇒ unscoped"
// would let a side report overwrite the history, "absent ⇒ scoped" would silently stop
// recording full reports. scope.js is pure (no DOM, no vendor bundle), and ar.js above
// already depends on it for the «(مخصص)» file-name suffix, so this adds no new failure mode.
import { isScoped } from '../model/scope.js?v=v2026-10-13.6';
// THE HOSPITAL DOOR (2026-10-07, report types 2026-10-11): the feed carries KAMC's and
// SGH's orders (and possibly a third hospital's). takeOrders puts the KAMC rows in
// parsed.orders — they feed every KAMC-side step of this unattended run (TAT suggestions,
// per-lab files, email drafts, the history numbers) — SGH's beside them in
// parsed.ordersByHospital, read here ONLY by stepEngine's buildBothModel call (the main
// KAMC + SGH deck) and stepPull's count line; any third hospital is dropped. STATIC for
// isScoped's reason: there is no safe degraded answer — "absent ⇒ keep every row" would
// put another hospital's orders into an UNATTENDED morning report nobody reviews. A load failure abandons the run (main.js
// catches the import) — no report, never a wrong one. hospital.js is pure (no DOM, no
// vendor bundle).
import { takeOrders } from '../model/hospital.js?v=v2026-10-13.6';
// THE TRACKER SHAPE CHECK (2026-10-13): resolveTracker below hands the unattended deck
// only a TAGGED ProjectTracker. STATIC for isScoped's reason — "absent ⇒ accept anything"
// would publish an old-format cache under the new slide design. task-tracker.js is a
// leaf (no imports, no DOM; SheetJS is injected into its parser, never imported).
import { isProjectTracker } from '../ingest/task-tracker.js?v=v2026-10-13.6';

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
//
// WHICH ROWS: model.scopedRows when the model carries it (the review screen sets it on
// every model it builds — the scoped rows, or all rows when unscoped), else the parsed
// orders as before (runAutomation's model and screen-generate's fallback have none). The
// chips must count the SAME rows as the big numbers beside them: a scoped deck stamped
// from all rows would print lab X's cards with the whole programme's weekly activity.
// An EMPTY scopedRows array is honoured, never widened to all rows — a scope that
// matched nothing keeps the engine's deltas (the stamper's no-rows path), not everyone's.
//
// REPORT TYPES (2026-10-11). A KAMC model (model.hospital 'kamc' or absent) takes the
// path above, unchanged. An SGH or KAMC + SGH model must NEVER be stamped with KAMC's TAT
// table or fall back to state.parsed.orders (the KAMC rows): its chips come from
// model/hospital-report.js — stampHospitalDeltas (SGH: its own rows, the no-Test-Menu
// policy) or stampBothDeltas (each hospital from its own rows, then `combined`) — the
// very functions the review screen stamps with, so the preview and the deck agree.
// `hospitalReport` is that module, handed in by the caller (screen-generate's guarded
// import) like the stamper itself; absent, the model keeps the chips it was built with
// (buildBothModel stamps at build time; the review screen stamped the SGH model).
export function applyWindowDeltas(model, state, store, stampWindowDeltas, hospitalReport) {
  const hospital = model && model.hospital != null ? model.hospital : 'kamc';
  if (hospital !== 'kamc') {
    applyHospitalDeltas(model, store, hospital, hospitalReport);
    return;
  }
  if (typeof stampWindowDeltas !== 'function' || !model || !model.kpi) return;
  const settings = (store && store.settings) || {};
  try {
    stampWindowDeltas(model, {
      rows: Array.isArray(model.scopedRows)
        ? model.scopedRows
        : ((state && state.parsed && state.parsed.orders) || null),
      tatTests: settings.tatLookup || {},
      mode: settings.reportOptions && settings.reportOptions.deltaMode,
    });
  } catch (e) {
    console.warn('[generate] stampWindowDeltas failed; keeping engine deltas', e);
  }
}

/** applyWindowDeltas' SGH / KAMC + SGH half (see there). Same mode source as the KAMC
 *  half (the raw stored value — the stampers normalise it); same "degrade, never throw". */
function applyHospitalDeltas(model, store, hospital, hr) {
  if (!hr) return;
  const settings = (store && store.settings) || {};
  const mode = settings.reportOptions && settings.reportOptions.deltaMode;
  try {
    if (hospital === 'both') {
      if (typeof hr.stampBothDeltas === 'function') hr.stampBothDeltas(model, { settings, mode });
    } else if (typeof hr.stampHospitalDeltas === 'function') {
      // An array (even empty) only — never undefined, which the stamper would not widen
      // either, but the intent is pinned here: an SGH deck's chips count SGH rows or none.
      hr.stampHospitalDeltas(model, {
        rows: Array.isArray(model.scopedRows) ? model.scopedRows : [], settings, mode,
      });
    }
  } catch (e) {
    console.warn('[generate] hospital delta stamp failed; keeping the built chips', e);
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

/** Is this model the single-hospital KAMC report? model.hospital 'kamc', or absent (a
 *  legacy KAMC-only model: every model built before the report types existed). Anything
 *  else — 'sgh', 'both', a typo — is not. A null model has no hospital to disagree with
 *  (recordRunSnapshot's own guards handle it). */
export function isKamcReport(model) {
  return !model || model.hospital == null || model.hospital === 'kamc';
}

/** Is this model the MAIN weekly report — KAMC + SGH ('both'), the one report the
 *  unattended run may publish? Exactly 'both': absent is a legacy KAMC model, and a typo
 *  is nothing (fail closed). */
export function isMainReport(model) {
  return !!model && model.hospital === 'both';
}

/**
 * Persist the FULL number snapshot + append it to snapshotHistory — the exact
 * store path (and warning strings) screen-generate has always used, shared so an
 * automated run feeds the delta/history features identically.
 *
 * NO TASK LOG (2026-10-13, tracker CONTRACT §1.4 / §1.8): this used to ALSO record what
 * the report showed into settings.taskLog (model/task-lifecycle.js, the old tracker's
 * "a closed task is shown exactly once" rule, keyed on its Arabic categories / statuses).
 * The new project tracker is a persisted document whose slides show it as it is — a
 * stable WBS id and an explicit 'Completed' status — so nothing writes the log any more,
 * from any report type, manual or automated. `recordShownTasks` / `shippedVariants`
 * are still ACCEPTED (an older caller passing them keeps working) and IGNORED; the
 * stored taskLog (and its import/export) stays as it is, inert.
 *
 * A SCOPED model (model.scope, set by the review screen) writes NOTHING. See the guard below.
 * @param {{model:Object, store:Object, state?:Object, date:string, recordSnapshot?:Function}} args
 */
export function recordRunSnapshot({
  model, store, state, date, recordSnapshot,
} = {}) {
  // SIDE REPORT ⇒ NO WRITE. A scoped deck's numbers describe a
  // subset (some labs / shipments / an order-date window evaluated as of its end), so:
  // snapshot / snapshotHistory are the PUBLISHED series the history panel lists and the
  // next report's comparisons read. One lab's totals stored under a report date would
  // stand in for the programme's on that day.
  // FAIL CLOSED: a scope that cannot even be read is not provably the full report, and a
  // missed write heals on the next full run while a polluted history does not.
  //
  // REPORT TYPES (2026-10-11, user rule revised the same day). snapshot / snapshotHistory
  // are KAMC's published series (the engine's delta baseline and the history panel read
  // them as KAMC's), so only a report that HOLDS KAMC's full numbers may write them:
  //   • 'both' — KAMC + SGH, the MAIN weekly report. It writes the numbers of its KAMC
  //     sub-model (model.kamc — buildHospitalModel('kamc') over the same KAMC rows with
  //     the same policy and date as the KAMC report's own build), so the series keeps
  //     getting one entry per weekly report, and an entry for date D is the same numbers
  //     a KAMC report for D writes. Only when that sub-model was built from KAMC rows: a
  //     main report over a load with NO KAMC lines holds no KAMC report (one could not
  //     even be generated — the review blocks it), and its zeros must not become the
  //     published KAMC numbers for D.
  //   • 'kamc' — or ABSENT, a legacy KAMC-only model — records its own numbers.
  //   • anything else — 'sgh', unknown values — writes nothing (fail closed, as above).
  let scoped;
  try { scoped = isScoped(model && model.scope); } catch { scoped = true; }
  if (scoped) return;
  let numbersOf; // the model whose kpi is published
  if (isKamcReport(model)) {
    numbersOf = model;
  } else if (isMainReport(model)) {
    const sub = model.kamc;
    if (!sub || !Array.isArray(sub.scopedRows) || !sub.scopedRows.length) return;
    // Belt and braces: the main report takes no scope (decision 7), so neither may the
    // sub-model whose numbers are published — fail closed like the guard above.
    let subScoped;
    try { subScoped = isScoped(sub.scope); } catch { subScoped = true; }
    if (subScoped) return;
    numbersOf = sub;
  } else {
    return;
  }

  try {
    const k = (numbersOf && numbersOf.kpi) || {};
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
  const mod = await tryImport('../slidespec/build-spec.js?v=v2026-10-13.6');
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
  const mod = await tryImport('../render/pptx-renderer.js?v=v2026-10-13.6');
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
  const rMod = await tryImport('../render/html-renderer.js?v=v2026-10-13.6');
  const renderSlides = pickFn(rMod, ['renderSlides', 'renderSpec', 'renderHtml', 'render']);
  const pMod = await tryImport('../render/pdf-export.js?v=v2026-10-13.6');
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
 * @param {Object} [scope] - the model's scope (model.scope). Absent/unscoped = the
 *   historic names, byte for byte; scoped = the range and/or «(مخصص)» suffix
 *   (i18n/ar.js buildFileName). Both callers pass model.scope, so the rows painted
 *   before generation and the files produced can never disagree on a name.
 * @param {('kamc'|'sgh'|'both')} [hospital] - the model's report type (model.hospital).
 *   'both' (the MAIN report) = no tag, the historic names; 'kamc' / 'sgh' = the
 *   single-hospital tag ' - KAMC -' / ' - SGH -'; absent = 'kamc' (a legacy KAMC-only
 *   model) — ar.js hospitalFileTag. Same set of four files in every report type.
 */
export function buildFileDefs(dateStr, scope, hospital) {
  const date = dateStr || todayISO();
  const name = (prefix, ext) => buildFileName(prefix, date, ext, scope, hospital);
  return [
    { id: 'internal-pptx', variant: 'internal', kind: 'pptx', label: STR.generate.fileInternalPptx, icon: '📊', name: name(VARIANTS.internal.filePrefix, 'pptx') },
    { id: 'nupco-pptx', variant: 'nupco', kind: 'pptx', label: STR.generate.fileNupcoPptx, icon: '📊', name: name(VARIANTS.nupco.filePrefix, 'pptx') },
    { id: 'internal-pdf', variant: 'internal', kind: 'pdf', label: STR.generate.fileInternalPdf, icon: '📄', name: name(VARIANTS.internal.filePrefix, 'pdf') },
    { id: 'nupco-pdf', variant: 'nupco', kind: 'pdf', label: STR.generate.fileNupcoPdf, icon: '📄', name: name(VARIANTS.nupco.filePrefix, 'pdf') },
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
  // runAutomation's model is the main report (hospital 'both', no scope) → the historic
  // file names; a model with no hospital is a legacy KAMC model → tagged (ar.js).
  const fileDefs = buildFileDefs(date, model && model.scope, model && model.hospital);

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
  scopedModel: 'نموذج التقرير مخصص — التشغيل الآلي ينشئ التقرير الكامل فقط',
  notMainModel: 'نموذج التقرير ليس التقرير الرئيسي (KAMC + SGH) — التشغيل الآلي ينشئ التقرير الرئيسي فقط',
  noMainModel: 'وحدة التقرير الرئيسي (KAMC + SGH) غير متوفرة',
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
  loadGrafana: () => import('../ingest/grafana.js?v=v2026-10-13.6'),
  loadEngine: () => tryImport('../engine/engine.js?v=v2026-10-13.6'),
  loadReportModel: () => import('../model/report-model.js?v=v2026-10-13.6'),
  // The main report's builder (buildBothModel). NOT guarded, like the report model above:
  // without it there is no main report to publish, and the engine step fails loudly
  // (generate then skips) rather than publishing some other report as the weekly one.
  loadHospitalReport: () => import('../model/hospital-report.js?v=v2026-10-13.6'),
  loadDeltaBaseline: () => tryImport('../model/delta-baseline.js?v=v2026-10-13.6'),
  // The delta-chip stamper. Guarded like the rest: a build without it degrades to the
  // engine's own clamped deltas instead of failing this module at load time.
  loadDeltaWindow: () => tryImport('../model/delta-window.js?v=v2026-10-13.6'),
  loadLateLabs: () => import('../export/late-labs.js?v=v2026-10-13.6'),
  loadTatSuggest: () => tryImport('../ingest/tat-suggest.js?v=v2026-10-13.6'),
  loadTatLoinc: () => tryImport('../seeds/tat-lookup.js?v=v2026-10-13.6'),
  // Track 5's module; absent until it ships → the emails step reports 'skip'.
  loadEmlDraft: () => tryImport('../export/eml-draft.js?v=v2026-10-13.6'),
  // The encrypted send-out catalogue. Guarded: absent module or a failed decrypt
  // means the deck simply omits the two send-out slides.
  loadSendoutMaster: () => tryImport('../ingest/sendout-master.js?v=v2026-10-13.6'),
  // The vendor contact book (To: per lab + the standard CC block). Guarded: a
  // build without it just means drafts fall back to the Settings map alone.
  loadLabContacts: () => tryImport('../seeds/lab-contacts.js?v=v2026-10-13.6'),
  loadDownload: () => tryImport('../ui/late-labs-section.js?v=v2026-10-13.6'),
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

/** The run's ProjectTracker: the PERSISTED document only (settings.cachedTracker — the
 *  user's latest uploaded or WEB-EDITED tracker, tracker CONTRACT §1.8), else null.
 *  state.parsed.tracker is deliberately NOT read: in a real session it is the same document
 *  (upload and every edit write both), but in a ?mock=1 / ?dev=1 tab it is the synthetic
 *  buildMockTracker document — tagged, and never persisted — which must never reach a real
 *  deck (§1.7). An UNTAGGED value (the old {tasks, challenges, risks} format from an
 *  install or backup older than the new file) is "no tracker": the deck simply has no
 *  tracker slides — never the old rows, never a mock. */
function resolveTracker(settings) {
  const ct = settings.cachedTracker;
  if (ct && isProjectTracker(ct.model)) return ct.model;
  return isProjectTracker(ct) ? ct : null;
}

/**
 * Email recipients for a lab, read from the canonical settings block
 * `settings.automation.labRecipients` — the same map the Settings tab writes and
 * late-labs-section reads. The store only ever persists comma-separated strings
 * there, but an array is tolerated too. A missing lab key yields [] (the caller
 * then falls back to the vendor contact book).
 */
function resolveRecipients(settings, lab) {
  const map = ((settings && settings.automation) || {}).labRecipients || {};
  const raw = map[lab];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') return raw.split(/[,;\s]+/).filter(Boolean);
  return [];
}

/**
 * To:/Cc: for one lab, resolved exactly as the manual button in late-labs-section
 * does it — a Settings entry overrides the book's To:, the book supplies the CC
 * block, and a lab it cannot confidently match contributes neither header.
 * `lookup` is lab-contacts' lookupLabContacts, or null when the module is absent.
 */
function resolveHeaders(settings, lab, lookup) {
  const override = resolveRecipients(settings, lab);
  const hit = typeof lookup === 'function' ? lookup(lab) : null;
  return {
    recipients: override.length ? override : ((hit && hit.to) || []),
    cc: (hit && hit.cc) || [],
  };
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
  // KAMC ROWS ONLY, and it must stay so: settings.tatLookup is ONE global table keyed by
  // test NAME. An SGH test name here could gain a HIGH-confidence LOINC suggestion from a
  // KAMC test and be written into it unattended — SGH would then silently have a TAT.
  // parsed.orders is the KAMC rows (model/hospital.js takeOrders); never ordersByHospital.
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
 * generate (and the drafts' date) use ONLY the model this run's engine step built: when
 * engine skips or fails, generate skips with MSG.noModel — whatever state.reportModel
 * holds from the review screen is never published (see runModel below).
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
  if (!theState.parsed) theState.parsed = { orders: null, tracker: null, summary: null, excludedHospitals: [] };
  if (!theState.files) theState.files = { csv: null, tracker: null };

  const steps = [];
  const errors = [];
  const files = [];
  const labFiles = [];
  const drafts = [];
  // The model THIS run built — set by stepEngine on success and nowhere else; generate
  // and emails read only this. theState.reportModel is still written (the screens read
  // it after a run, as they always have) but never read back: it is shared with the
  // review screen, so when stepEngine skips (no orders, no engine) or throws, it still
  // holds the operator's model — possibly a SCOPED side report — and publishing that
  // unattended would ship «(مخصص)» files as the morning report. Not cleared on failure
  // either: a failed run must not wipe the operator's review edits.
  let runModel = null;

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
  // Both land through takeOrders(), so every KAMC-side step (engine hero, lab workbooks,
  // drafts, the TAT auto-accept) reads parsed.orders — the KAMC rows only. SGH's rows sit
  // beside them in parsed.ordersByHospital, read by ONE consumer: stepEngine's main-report
  // build (buildBothModel), which computes them on their own with SGH's policy.
  async function stepPull() {
    const settings = theStore.settings || {};
    const gcfg = settings.grafana || {};
    const dataKey = (gcfg.dataKey || '').trim();
    const ready = !!(gcfg.enabled && ((gcfg.baseUrl && gcfg.accessToken) || dataKey));
    if (!ready) return { status: 'skip', message: MSG.noGrafana };

    // Rows that landed seconds ago (the screen's own fetch, or a previous run)
    // are reused rather than re-fetched — heroDataAt carries the DATA's age, so a
    // stale snapshot still triggers a real pull. Already split: every writer of the
    // orders (here and the upload screen) goes through takeOrders.
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
      const kept = takeOrders(theState.parsed, res.rows);
      theState.heroDataAt = new Date(D.now()).toISOString(); // freshness for 'لمحة اليوم'
      theState.files.csv = { name: `${STR.upload.grafanaSourceName} ${new Date(D.now()).toLocaleString('en-GB')}` };
      message = STR.upload.grafanaOk.replace('{n}', String(kept.length)); // the KEPT count
    } catch (direct) {
      // A CORS/network failure surfaces as TypeError. If a data key is set, fall
      // back to the encrypted snapshot the GitHub Action publishes server-side.
      if (direct instanceof TypeError && dataKey) {
        const snap = await mod.fetchKamcSnapshot(dataKey);
        // The snapshot keeps EVERY hospital's rows (scripts/fetch-kamc.mjs does not
        // filter, so they are there when the user decides) — the split happens here.
        const kept = takeOrders(theState.parsed, snap.rows);
        theState.heroDataAt = snap.fetchedAt; // snapshot's real age, not load time
        const t = fmtHHMM(snap.fetchedAt);
        theState.files.csv = { name: `${STR.upload.grafanaSnapshotName} ${t}`.trim() };
        message = STR.upload.grafanaSnapshotOk.replace('{n}', String(kept.length)).replace('{t}', t);
      } else {
        throw direct;
      }
    }
    // Say what was left out in the step's own line — an unattended run has no upload
    // screen notice in front of anyone. Aggregates only (count + hospital name).
    // Third hospitals only (takeOrders). SGH's lines are not excluded: they are IN this
    // run's main report (KAMC + SGH) — said, with the one thing that stays KAMC's (the
    // per-lab files), since the KAMC count above is all the line otherwise reports. Said
    // ONLY when it can be true: generate is switched on AND there are KAMC rows (with
    // none, stepEngine skips with noOrders and no deck exists). Otherwise a neutral count.
    const excluded = theState.parsed.excludedHospitals || [];
    if (excluded.length) {
      message = `${message} — ${excluded.map((h) => STR.upload.hospitalExcludedShort(h.count, h.name || h.id)).join('، ')}`;
    }
    const obh = theState.parsed.ordersByHospital;
    const sghCount = (obh && Array.isArray(obh.sgh)) ? obh.sgh.length : 0;
    if (sghCount) {
      const kamcOrders = theState.parsed.orders;
      const deckComing = !!opts.autoGenerate && Array.isArray(kamcOrders) && kamcOrders.length > 0;
      message = `${message} — ${deckComing ? STR.upload.sghInAutomated(sghCount) : STR.upload.sghPulledOnly(sghCount)}`;
    }

    if (opts.autoAcceptTat) {
      try {
        const n = await acceptSuggestedTats(D, theStore, theState);
        if (n) message = `${message} — اعتُمدت ${n} مدة مقترحة`;
      } catch (e) { console.warn('[automation] autoAcceptTat failed', e); }
    }
    return { message };
  }

  // Engine + ReportModel + delta chips — the same modules review/generate use — and then
  // the MAIN report (KAMC + SGH) the run publishes. The KAMC engine output stays the
  // run's hero numbers (theState.engineOutput, as before); buildReportModel still builds
  // the run's non-order content (projectTracker, panels, challenges…) exactly as the
  // review screen does, so the model handed on has the same shape as the review's own
  // KAMC + SGH model (its order figures replaced by buildBothModel's kamc / sgh / combined).
  // The tracker is the CACHED document (resolveTracker) — the user's latest web edits —
  // so the unattended deck publishes what the review screen last showed.
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
    // Decrypt the send-out catalogue with the same data key the snapshot uses.
    // Never fatal: null just drops the two slides from this run's deck.
    let sendoutMaster = null;
    try {
      const soMod = typeof D.loadSendoutMaster === 'function' ? await D.loadSendoutMaster() : null;
      const load = pickFn(soMod, ['loadSendoutMaster', 'fetchSendoutMaster']);
      if (typeof load === 'function') {
        sendoutMaster = await load(((settings.grafana || {}).dataKey) || '');
      }
    } catch (e) {
      errors.push(`sendout: ${(e && e.message) || String(e)}`);
    }

    const tracker = resolveTracker(settings);
    const base = buildReportModel({
      engineOutput: out,
      tracker,
      settings,
      reportDate,
      orders,
      sendoutMaster,
      edits: theState.edits || {},
    });

    // THE MAIN REPORT — KAMC + SGH. Each hospital on its own rows with its own policy
    // (buildBothModel: KAMC's sub-model is the KAMC report's own build, argument for
    // argument — same rows, settings, date, catalogue — so its numbers are the ones a KAMC
    // report would record). SGH's rows: this load's, or none — a load without SGH lines is
    // STILL the main report (SGH prints 0), never silently the KAMC one.
    const hr = await D.loadHospitalReport();
    if (!hr || typeof hr.buildBothModel !== 'function') throw new Error(MSG.noMainModel);
    const obh = theState.parsed.ordersByHospital;
    const both = hr.buildBothModel({
      kamcRows: orders,
      sghRows: (obh && Array.isArray(obh.sgh)) ? obh.sgh : [],
      settings,
      reportDate,
      tracker,
      sendoutMaster,
      edits: theState.edits || {},
      // The raw stored mode, as applyWindowDeltas passes it (the stampers normalise it).
      mode: settings.reportOptions && settings.reportOptions.deltaMode,
    });
    // The drafted content + the main report's figures, the way the review screen's
    // refreshedModel swaps figures: the single-hospital figure fields (kpi, sendout) go —
    // a KAMC kpi beside kamc / sgh / combined would be the previous type's leftover. A
    // scope on `base` is KEPT on purpose so stepGenerate's guard still sees it.
    const model = { ...base };
    delete model.kpi;
    delete model.sendout;
    Object.assign(model, {
      // The builder's own word for what it built ('both') — not re-typed here, so
      // stepGenerate's isMainReport guard checks the builder, not this assignment.
      hospital: both.hospital,
      reportDate: both.reportDate,
      kamc: both.kamc,
      sgh: both.sgh,
      combined: both.combined,
      deltaWindow: both.deltaWindow,
      // The project tracker the deck's tracker slides read (top level, like the review's
      // main model). buildReportModel's own answer when it gave one (it honours edits);
      // else this run's resolved tracker — never undefined, never an untagged value.
      projectTracker: base.projectTracker !== undefined ? base.projectTracker : tracker,
    });
    // Presentation options + per-run manual overrides, exactly as the screens stamp them.
    // reportOptions carries the SAVED slide order (slideOrder, model/slide-order.js); the
    // review's one-report order (state.slideOrder → model.slideOrder) is never read here, so
    // an unattended deck always follows the fixed order (test/pipeline.test.mjs pins it).
    if (settings.reportOptions) model.reportOptions = settings.reportOptions;
    if (!model.overrides) model.overrides = {};

    // Routed by model.hospital to stampBothDeltas (each hospital's chips from its own
    // rows; idempotent — buildBothModel already stamped), never the KAMC stamper.
    const dw = typeof D.loadDeltaWindow === 'function' ? await D.loadDeltaWindow() : null;
    applyWindowDeltas(model, theState, theStore, dw && dw.stampWindowDeltas, hr);
    theState.reportModel = model;
    runModel = model; // the ONLY hand-off to generate/emails — see runModel above

    const total = (out.totals && out.totals.total) != null ? out.totals.total : 0;
    return { message: `${total} طلب` };
  }

  // The 4 report files + the snapshot/history write a successful run owes the
  // delta features (KAMC's numbers from the main report's KAMC sub-model; no task log —
  // recordRunSnapshot). The deck carries the tracker slides when the model holds a
  // ProjectTracker and reportOptions.slides.tracker is not false (build-spec-both.js). autoDownload additionally pushes them to the browser.
  // Renders ONLY this run's own model (runModel): no engine success → nothing to publish.
  async function stepGenerate() {
    const model = runModel;
    if (!model) return { status: 'skip', message: MSG.noModel };
    // Belt and braces: stepEngine sets no scope, so this can only trip if buildReportModel
    // one day starts carrying one. Refuse rather than publish a side report unattended —
    // recordRunSnapshot would skip the history, but the files (and autoDownload) would
    // still go out. FAIL CLOSED like recordRunSnapshot: an unreadable scope is not
    // provably the full report.
    let scoped;
    try { scoped = isScoped(model.scope); } catch { scoped = true; }
    if (scoped) return { status: 'error', message: MSG.scopedModel };
    // Same belt and braces for the report type: stepEngine builds the MAIN report
    // (hospital 'both'), so anything else here is a bug — refuse it rather than publish a
    // single-hospital deck (or a legacy untyped one) as the weekly report.
    if (!isMainReport(model)) return { status: 'error', message: MSG.notMainModel };
    const produced = await D.produceReportFiles({
      model, ctx: ctx || { state: theState, store: theStore }, onProgress: null, host: null, signal,
    });
    // A file whose render failed is skipped by produceReportFiles (logged, never thrown).
    for (const p of (produced || [])) {
      if (!p || !p.blob) continue;
      files.push({ name: (p.def && p.def.name) || '', blob: p.blob });
    }
    // A stop pressed mid-generation is a cancellation, not a failure.
    if (!files.length) {
      return (signal && signal.aborted)
        ? { status: 'skip', message: MSG.aborted }
        : { status: 'error', message: MSG.noFiles };
    }

    const db = await D.loadDeltaBaseline();
    // Numbers only — no task log (recordRunSnapshot: nothing writes settings.taskLog).
    recordRunSnapshot({
      model,
      store: theStore,
      state: theState,
      date: model.reportDate || todayISO(),
      recordSnapshot: db && db.recordSnapshot,
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
    const lookup = pickFn(await D.loadLabContacts(), ['lookupLabContacts']);
    // This run's model's date, else the chosen report date — never the leftover review
    // model's, whose reportDate is a scoped range's END ('to'), not the day of this run.
    const reportDate = (runModel && runModel.reportDate)
      || theState.reportDate || todayISO();
    let failed = 0;
    for (const lf of labFiles) {
      try {
        const { recipients, cc } = resolveHeaders(settings, lf.lab, lookup);
        let d = build({
          lab: lf.lab,
          fileName: lf.fileName,
          xlsxBytes: lf.bytes,
          recipients,
          cc,
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
