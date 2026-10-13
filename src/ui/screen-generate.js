// ui/screen-generate.js — build both variants, produce 4 files, trigger downloads (Track E).
// The file-producing core now lives in automation/pipeline.js (produceReportFiles) so
// an unattended run makes byte-identical files; this screen drives it and paints the
// very same progress bar, file rows and live slide thumbnails it always has.
import { STR, todayISO, formatDateAr, formatRangeAr } from '../i18n/ar.js?v=v2026-10-13.5';
import { el, progressBar, toast } from './components.js?v=v2026-10-13.5';
import { resetRunData, overlayTempSlideOrder } from '../state.js?v=v2026-10-13.5';
import { buildMockEngineOutput } from './screen-upload.js?v=v2026-10-13.5';
import { resolveProjectTracker } from '../model/report-model.js?v=v2026-10-13.5';
import { buildLateLabsSection, triggerDownload } from './late-labs-section.js?v=v2026-10-13.5';
import {
  applyWindowDeltas, buildFileDefs, produceReportFiles, recordRunSnapshot,
  shouldAutoDownloadFiles,
} from '../automation/pipeline.js?v=v2026-10-13.5';
import { isScoped, hasRange, normalizeScope } from '../model/scope.js?v=v2026-10-13.5';

/** The report type a model is (model.hospital; absent ⇒ 'kamc': a legacy KAMC-only model —
 *  every model that predates the report types, and the fallback below, whose numbers are
 *  the KAMC engine output). Passed EXPLICITLY to buildFileDefs, so the painted rows and
 *  the produced files name the same report: the main KAMC + SGH report untagged, a
 *  single-hospital one tagged. */
const hospitalOf = (model) => (model && model.hospital != null ? model.hospital : 'kamc');
/** Its label as the review screen's pills print it (STR.review.hospital.modes). */
const hospitalLabel = (h) => (STR.review.hospital.modes[h] || String(h));

async function tryImport(path) { try { return await import(path); } catch { return null; } }
const isMobile = () => /iP(hone|ad|od)|Android/i.test(navigator.userAgent);

// Only reached when there is no review model (a direct jump to this screen). The project
// tracker is the REAL one or nothing: this run's parsed tracker, else the cached document
// (resolveProjectTracker — tagged ProjectTrackers only), else null ⇒ no tracker slides.
// Never buildMockTracker: a mock here once printed fake tasks into a real deck.
// Challenges / risks / support lines are manual review content — none without a review.
// Exported for test/tracker-model.test.mjs (pure: reads state + store.settings only).
export function fallbackModel(state, store) {
  const kpi = state.engineOutput || buildMockEngineOutput(store.settings);
  const reportDate = state.reportDate || todayISO();
  return {
    reportDate,
    kpi,
    panels: { supportRequired: [] },
    projectTracker: resolveProjectTracker(state.parsed && state.parsed.tracker, store.settings),
    challenges: [],
    risks: [],
    scorecard: (store.settings && store.settings.scorecard) || [],
    displayNames: (store.settings && store.settings.displayNames) || {},
    reportOptions: (store.settings && store.settings.reportOptions) || undefined,
    overrides: {},
  };
}

// Live slide thumbnails — during PDF capture the full-size slides already exist in
// the offscreen .render-host. We clone each into a cheap ~160x90 scaled-down live
// preview (CSS transform, pointer-events none) so the user WATCHES the report being
// assembled. Cloned once per variant render (not per progress tick).
function makeThumbStrip() {
  const strip = el('div', { class: 'gen-thumbs', 'aria-hidden': 'true' }); // decorative live preview
  strip.style.cssText = 'display:none;gap:8px;overflow-x:auto;overflow-y:hidden;margin-top:14px;padding:4px 2px 8px;-webkit-overflow-scrolling:touch';
  let wraps = [];
  const SCALE = 160 / 1280; // 0.125 -> 160x90 from a 1280x720 (.sl-slide) preview
  const paint = (w, state) => {
    if (state === 'done') { w.style.opacity = '1'; w.style.borderColor = 'var(--green)'; w.style.boxShadow = 'none'; }
    else if (state === 'active') { w.style.opacity = '1'; w.style.borderColor = 'var(--blue)'; w.style.boxShadow = '0 0 0 3px rgba(37,99,235,.28)'; }
    else { w.style.opacity = '.5'; w.style.borderColor = 'var(--border)'; w.style.boxShadow = 'none'; }
  };
  const api = {
    el: strip,
    // Clear + redraw for the current variant's freshly-rendered slides.
    load(slideEls) {
      strip.innerHTML = '';
      wraps = [];
      slideEls.forEach((sl) => {
        const clone = sl.cloneNode(true);
        clone.style.transform = `scale(${SCALE})`;
        clone.style.transformOrigin = 'top left';
        clone.style.pointerEvents = 'none';
        clone.style.margin = '0';
        const wrap = el('div', { class: 'gen-thumb' });
        wrap.style.cssText = 'flex:0 0 auto;width:160px;height:90px;overflow:hidden;border-radius:6px;border:2px solid var(--border);background:#fff;pointer-events:none;transition:border-color .2s,box-shadow .2s,opacity .2s';
        wrap.appendChild(clone);
        strip.appendChild(wrap);
        wraps.push(wrap);
      });
      strip.style.display = wraps.length ? 'flex' : 'none';
      api.highlight(0, wraps.length); // slide 0 captures first — mark it active up front
    },
    // onProgress(done,total) fires AFTER capturing slide index done-1, so slides
    // 0..done-1 are captured and index `done` is the one currently being captured.
    highlight(done, total) {
      wraps.forEach((w, idx) => paint(w, idx < done ? 'done' : (idx === done && done < total ? 'active' : 'idle')));
    },
  };
  return api;
}

// Share-ready summary card shown after success. Numbers mirror build-spec's
// valueOf: override wins when finite, else the computed KPI value.
//
// SUBSETS, NOT ADDENDS (user decision 2026-07-28, "consider rejected as completed
// test"). This text is pasted into WhatsApp, where a reader adds the bullets up, so
// it uses the SAME disclosure the deck uses: a partition term is a '•' bullet, and a
// term that is counted INSIDE the bullet above it is an '↳ منها …' line.
//   • مرفوضة ⊂ مكتملة   — buckets.completed = resulted + rejected (engine.js isCompleted)
//   • متأخرة ⊂ بانتظار النتائج — lateNoResult = LATE ∧ no result date, and LATE already
//     requires received ∧ !rejected, which is exactly awaitingResults (hence latePct).
// 'فحوصات مكتملة' is the deck-wide name for this number (build-spec DEFAULT_LABELS
// .kpiCompleted / compCompleted / monthlyRowResults) — the shared summary must not
// call the printed metric something else.
//
// SCOPED RUN (model.scope): the pasted text travels without the deck, so it has to say
// what the deck's cover says — the heading date becomes the order-date RANGE when one is
// set (a single day would claim a report date the numbers were not cut at), and a second
// line names the scope so a reader never takes one lab's numbers for the programme's.
// Unscoped → the text is exactly what it always was.
const SHARE_MAX_IDS = 5; // a pasted message listing 40 shipment ids buries the numbers
// Labs fold the way the cover's lab list does (build-spec coverLabList, its scopeListMore
// wording): the first three, then 'و{n} أخرى'. The cover's extra WIDTH guard is not
// copied — it exists because a 0.4in cover box cannot wrap; a pasted message can.
const SHARE_MAX_LABS = 3;

/**
 * The share card's scope line. Normalises first (idempotent), so the arrays are always
 * there and a half-valid range can never print. Only meaningful for a scoped model —
 * the caller gates on isScoped. Exported for test/scope-pipeline.test.mjs.
 * @param {Object} scope model/scope.js scope
 * @returns {string} e.g. 'تقرير مخصص — المختبرات: A، B، C و2 أخرى · الشحنات: …'
 */
export function scopeShareLine(scope) {
  const s = normalizeScope(scope);
  const S = STR.review.scope;
  const parts = [];
  if (s.labs.length) {
    const names = s.labs.slice(0, SHARE_MAX_LABS).join('، ');
    const more = s.labs.length - SHARE_MAX_LABS;
    parts.push(`${S.labs}: ${names}${more > 0 ? ` و${more} أخرى` : ''}`);
  }
  if (s.shipments.length) {
    const ids = s.shipments.slice(0, SHARE_MAX_IDS).join('، ');
    const more = s.shipments.length - SHARE_MAX_IDS;
    parts.push(`${S.shipments}: ${ids}${more > 0 ? ` (+${more})` : ''}`);
  }
  // The range's VALUE, not the bare label — a range-only run used to read
  // 'تقرير مخصص — الفترة (حسب تاريخ الطلب)', a dangling item. The heading carries the
  // same dates; this line is where the reader learns they are ORDER dates.
  if (hasRange(s)) parts.push(`${S.range}: ${formatRangeAr(s.from, s.to)}`);
  return `${S.active} — ${parts.join(' · ')}`;
}

/**
 * The share card's text — pure, so the pasted message is pinned by a test without a DOM.
 * @param {Object} model the ReportModel generated from
 * @param {string} date 'YYYY-MM-DD' the report date (the heading when there is no range)
 * @param {number} fileCount files actually produced
 * @returns {string}
 */
export function shareText(model, date, fileCount) {
  const V = (key, computed) => (Number.isFinite(model.overrides && model.overrides[key]) ? model.overrides[key] : computed);
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const hospital = hospitalOf(model);
  // REPORT TYPES (2026-10-11). KAMC + SGH, the MAIN report: the historic heading with no
  // type line. KAMC / SGH, the single-hospital reports: a line names the report type (the
  // pasted text travels without the deck). The numbers follow the deck's own rules — a KAMC + SGH number is the two hospitals'
  // results summed (model/hospital-report.js), and lateness exists only where a Test
  // Menu does (KAMC): an SGH report prints «–» for it, never the engine's 0.
  let total; let completed; let awaiting; let late; let rejected; let cancelled;
  if (hospital === 'both') {
    // No overrides in this report type (decision 8): the sub-models' own numbers.
    const subs = [model.kamc, model.sgh].map((m) => (m && m.kpi) || {});
    const sum = (f) => subs.reduce((s, k) => s + num(f(k)), 0);
    const c = model.combined || {};
    total = sum((k) => k.totals && k.totals.total);
    completed = sum((k) => k.buckets && k.buckets.completed);
    awaiting = sum((k) => k.buckets && k.buckets.awaitingResults);
    rejected = sum((k) => k.buckets && k.buckets.rejected);
    cancelled = sum((k) => k.cancelledNote);
    // Late = the Test-Menu hospitals only, exactly as the deck's late card counts it.
    late = `${num(c.cards && c.cards.lateNoResult && c.cards.lateNoResult.combined)} (${STR.review.hospital.modes.kamc})`;
  } else {
    const k = model.kpi || {};
    const b = k.buckets || {};
    total = num(V('total', k.totals && k.totals.total));
    completed = num(V('completed', b.completed));
    awaiting = num(V('awaitingResults', b.awaitingResults));
    // SGH (no Test Menu): «–» unless the operator typed a late figure — then the typed
    // number, exactly as the deck's late card does (build-spec.js: a finite manual
    // lateNoResult override wins over the SGH dash), so the pasted text and the deck agree.
    late = (hospital === 'kamc' || !model.noTestMenu || Number.isFinite(model.overrides && model.overrides.lateNoResult))
      ? num(V('lateNoResult', b.lateNoResult)) : '–';
    rejected = num(V('rejected', b.rejected));
    cancelled = num(V('cancelledNote', k.cancelledNote));
  }
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const scope = normalizeScope(model.scope); // same view isScoped/hasRange judge by
  const when = (hasRange(scope) && formatRangeAr(scope.from, scope.to)) || formatDateAr(date) || date;
  return `تقرير مسبار الأسبوعي — ${when}\n` +
    // The type line follows the file-name rule (ar.js buildFileName): the MAIN report
    // (KAMC + SGH) keeps the historic heading alone; a single-hospital report — KAMC-only
    // (a legacy model with no hospital field included) or SGH — names itself, so its
    // pasted numbers are never read as the main weekly report's.
    (hospital !== 'both' ? `${STR.generate.reportType(hospitalLabel(hospital))}\n` : '') +
    (isScoped(scope) ? `${scopeShareLine(scope)}\n` : '') +
    `• إجمالي الطلبات: ${total}\n` +
    `• فحوصات مكتملة (تشمل المرفوضة): ${completed} (${pct}%)\n` +
    `↳ منها مرفوضة: ${rejected}\n` +
    `• بانتظار النتائج: ${awaiting}\n` +
    `↳ منها متأخرة: ${late}\n` +
    `• ملغاة: ${cancelled}\n` +
    `الملفات: ${fileCount} (نسختا PPTX و PDF داخلية ونوبكو)`;
}

function buildShareCard(model, date, fileCount) {
  const text = shareText(model, date, fileCount);
  // One more line each for a scope and a single-hospital report type (KAMC / SGH — the
  // main KAMC + SGH report has no type line) → one more textarea row.
  const extra = (isScoped(model.scope) ? 1 : 0) + (hospitalOf(model) !== 'both' ? 1 : 0);

  const ta = el('textarea', {
    dir: 'rtl', readOnly: true, rows: 6 + extra, value: text,
    style: 'width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;font-size:.9rem;line-height:1.8;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-light);color:var(--slate-500)',
  });

  const copyBtn = el('button', {
    class: 'btn btn--ghost btn--block', style: 'margin-top:8px', text: 'نسخ الملخص',
    // Runs synchronously inside the tap so the fallback path keeps user activation.
    onClick: async () => {
      const fallback = () => {
        try {
          ta.focus(); ta.select();
          const ok = document.execCommand('copy');
          ta.setSelectionRange(0, 0); ta.blur();
          return ok;
        } catch { return false; }
      };
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; }
        else ok = fallback();
      } catch { ok = fallback(); }
      if (ok) toast('تم النسخ', 'ok');
    },
  });

  return el('div', { style: 'margin-top:16px;text-align:right;width:100%' }, [
    el('div', { style: 'font-weight:700;font-size:.95rem;margin-bottom:8px;color:var(--navy)', text: 'ملخص جاهز للمشاركة' }),
    ta,
    copyBtn,
  ]);
}

export async function render(container, ctx) {
  const { state, store, navigate } = ctx;
  const model = state.reportModel || fallbackModel(state, store);
  // SLIDE ORDER (slide-order CONTRACT decision 6): the model handed over by the review carries
  // the order on screen — the temporary one as model.slideOrder, else the saved one in
  // model.reportOptions — and all four files are built from it (pipeline.js → buildSpec reads
  // model/slide-order.js slideOrderOf). Re-applied here so a review model can never ship a
  // temporary order that was dropped since (a new load, «استعادة»); a DIRECT jump with no
  // review model (fallbackModel) gets none, so its settings.reportOptions — the saved order.
  const tempOrder = state.reportModel ? overlayTempSlideOrder(model, state) : null;
  const date = model.reportDate || todayISO();
  model.reportDate = model.reportDate || date;
  // Delta chips = THE WEEK'S ACTIVITY (2026-08-05). Recompute kpi.deltas from the rows'
  // own dates over the window and stamp model.deltaWindow, so the generated files' exec
  // legend/chips match the review preview exactly. This re-runs the stamper on the very
  // model object screen-review already stamped — SAFE by construction now: it is a pure
  // function of (rows, reportDate, mode), so the second stamp is deep-equal to the first.
  // (Under the retired baseline stamper the two copies could pick different baselines and
  // the deck silently won.) THE INVARIANT: only the chips changed meaning — the big
  // cumulative numbers on slides 2/3/4 are untouched.
  // The rows are model.scopedRows when the model carries them (applyWindowDeltas picks),
  // so a SCOPED deck's chips count the same subset as its cards — and the review preview
  // stays deep-equal only while screen-review stamps from that same field.
  // recordSnapshot (below) still appends this run's published numbers to snapshotHistory
  // for the history panel — for a FULL report only; a scoped one writes nothing.
  // Both modules are guarded → engine deltas if either is absent.
  // An SGH / KAMC + SGH model is re-stamped by model/hospital-report.js (each hospital
  // with its own policy — applyWindowDeltas routes it); guarded like the other two.
  const dwMod = await tryImport('../model/delta-window.js?v=v2026-10-13.5');
  const dbMod = await tryImport('../model/delta-baseline.js?v=v2026-10-13.5');
  const hrMod = hospitalOf(model) !== 'kamc'
    ? await tryImport('../model/hospital-report.js?v=v2026-10-13.5')
    : null;
  const recordSnapshot = dbMod && dbMod.recordSnapshot;
  applyWindowDeltas(model, state, store, dwMod && dwMod.stampWindowDeltas, hrMod);

  // Same four definitions produceReportFiles will walk — one shared source, and the SAME
  // scope + report type it resolves (absent ⇒ 'kamc' on both sides), so a painted row
  // name is always the downloaded file's name.
  const fileDefs = buildFileDefs(date, model.scope, hospitalOf(model));

  const rowEls = {};
  const fileList = el('div', { class: 'gen-files' }, fileDefs.map((f) => {
    const status = el('span', { class: 'gen-file__status', text: '…' });
    const row = el('div', { class: 'gen-file', id: 'genrow-' + f.id }, [
      el('span', { class: 'gen-file__icon', text: f.icon }),
      // dir=ltr: keeps '….pptx' after the digits in RTL context. text-align:right keeps
      // the LTR-ordered name at the row's RTL START edge (it is a flex:1 stretched box,
      // so ltr alone left-aligned it away from its icon and onto the status text).
      el('span', { class: 'gen-file__name', dir: 'ltr', style: 'text-align:right', text: f.name }),
      status,
    ]);
    rowEls[f.id] = { row, status };
    return row;
  }));

  const bar = progressBar();
  const thumbs = makeThumbStrip(); // live scaled-down previews of slides during PDF capture
  const resultHost = el('div');
  const host = el('div', { class: 'render-host' }); // full-size, offscreen, for html2canvas capture

  const subtitleEl = el('p', { text: STR.generate.subtitle });
  const keepOpenEl = el('p', { class: 'small muted', text: '⏳ ' + STR.generate.keepOpen });
  // WHICH report is being produced — KAMC, SGH or KAMC + SGH — said in the head, before
  // the first file lands (the file names carry the tag too, but are easy to skim past).
  // Inline style: `.screen__head p` outranks .small/.muted (same as the review head note).
  const reportTypeEl = el('p', {
    role: 'note', style: 'margin-top:4px;font-weight:700;color:var(--navy)',
    text: STR.generate.reportType(hospitalLabel(hospitalOf(model))),
  });
  // An unsaved (temporary) slide order is said once more where the files are made.
  const tempOrderEl = tempOrder ? el('p', {
    role: 'note', style: 'margin-top:4px;font-size:.85rem;font-weight:700;color:var(--warn-text,#92400E)',
    text: STR.generate.tempSlideOrder,
  }) : null;
  const head = el('div', { class: 'screen__head' }, [
    el('h1', { text: STR.generate.title }),
    reportTypeEl,
    tempOrderEl,
    subtitleEl,
    keepOpenEl,
  ]);

  container.appendChild(el('div', { class: 'screen' }, [
    head,
    el('div', { class: 'card' }, [bar.el, fileList, thumbs.el]),
    resultHost,
    host,
  ]));

  bar.set(4, STR.generate.preparing);

  let hadError = false;
  // Every UI moment the inline loop used to paint, now driven by the pipeline's
  // progress events — same texts, same order, same thumbnail choreography.
  const produced = await produceReportFiles({ // {def, blob} (+url added on download)
    model,
    ctx,
    host,
    onProgress: (evt) => {
      const f = evt.def;
      switch (evt.phase) {
        case 'spec':
          bar.set(6, STR.generate.buildingSpec);
          break;
        case 'file-start':
          rowEls[f.id].status.textContent = f.kind === 'pptx' ? STR.generate.buildingPptx : STR.generate.renderingSlides;
          bar.set(evt.base + 4, `${f.label} — ${f.kind === 'pptx' ? STR.generate.buildingPptx : STR.generate.buildingPdf}`);
          break;
        case 'slides':
          thumbs.load(evt.slideEls);
          break;
        case 'capture': {
          thumbs.highlight(evt.done, evt.tot);
          const frac = evt.tot ? evt.done / evt.tot : 0;
          bar.set(evt.base + frac * (100 / evt.total), `${f.label} — ${STR.generate.capturing} ${evt.done}/${evt.tot || '?'}`);
          break;
        }
        case 'file-done':
          rowEls[f.id].row.classList.add('is-done');
          rowEls[f.id].status.textContent = '✓';
          break;
        case 'file-error':
          hadError = true;
          rowEls[f.id].status.textContent = '—';
          break;
        case 'file-end':
          bar.set(((evt.index + 1) / evt.total) * 100);
          break;
        case 'error': // gen libs failed — no file row to mark
          hadError = true;
          break;
        default:
          break;
      }
    },
  });

  if (!produced.length) {
    bar.set(100, STR.generate.failed);
    resultHost.appendChild(el('div', { class: 'panel-warn' }, [
      el('div', { class: 'panel-warn__title', text: '⚠️ ' + STR.generate.genMissing }),
    ]));
  } else {
    bar.set(100, STR.generate.done);
    // Done-state: flip the in-progress head so at a glance it reads finished.
    subtitleEl.textContent = STR.generate.done;
    keepOpenEl.style.display = 'none';
    // Persist the FULL number snapshot — next run's "+N" chips (E6 rule) compare
    // every exec/journey number against these. Shared with automated runs so an
    // unattended generation feeds the same delta/history features.
    // Numbers only: nothing writes the closed-task log any more (recordRunSnapshot).
    // A SCOPED model is a side report: recordRunSnapshot returns before writing
    // (see its guard), so it is still called unconditionally here — one owner of the rule.
    recordRunSnapshot({ model, store, state, date, recordSnapshot });

    // Auto-download works on desktop; iOS/Safari may drop programmatic clicks
    // that fire without recent user activation, so it's attempted on desktop only
    // and the panel below always offers gesture-driven buttons. Since 2026-08-04 the
    // operator can also turn it off (reportOptions.autoDownloadFiles — the checkbox on
    // the review screen / settings' report tab): the decision lives in ONE pure
    // predicate (pipeline.js shouldAutoDownloadFiles) so this screen, the settings
    // mirror and the tests can never disagree, and it is read here — not cached at
    // render time — so a toggle flipped just before توليد التقارير is honoured.
    // Strictly unrelated to automation.autoDownload, which only governs unattended runs.
    const autoDownload = shouldAutoDownloadFiles({ settings: store.settings, mobile: isMobile() });
    if (autoDownload) {
      for (let i = 0; i < produced.length; i++) {
        const p = produced[i];
        p.url = triggerDownload(p.blob, p.def.name);
        if (i < produced.length - 1) await new Promise((r) => setTimeout(r, 250));
      }
    }

    resultHost.appendChild(el('div', { class: 'success-panel' }, [
      el('div', { class: 'success-panel__icon', text: '✓' }),
      el('h3', { text: STR.generate.done }),
      el('button', {
        class: 'btn btn--primary btn--block', text: STR.generate.downloadAll,
        // Runs synchronously inside the tap so each click carries user activation.
        onClick: () => { produced.forEach((p) => { p.url = triggerDownload(p.blob, p.def.name); }); },
      }),
      hadError ? el('p', { class: 'small muted', text: STR.generate.genMissing }) : null,
      // Scoped run: say, at the moment of success, that nothing was recorded — an
      // operator who expects this deck in the history panel must not go looking for it.
      isScoped(model.scope) ? el('p', { class: 'small muted', text: STR.review.scope.sideReport }) : null,
      // The same for an SGH deck: a side report, recorded nowhere. Not the main KAMC + SGH
      // report — it IS recorded (KAMC's numbers, pipeline.js recordRunSnapshot).
      hospitalOf(model) === 'sgh' ? el('p', { class: 'small muted', text: STR.review.hospital.sideReport }) : null,
      el('p', {
        class: 'small muted',
        style: 'margin-top:6px',
        // Auto-download off → the buttons are not a fallback, they ARE the download.
        text: autoDownload ? STR.generate.downloadHint : STR.generate.downloadPickHint,
      }),
      el('div', { class: 'dl-links' }, produced.map((p) =>
        el('a', {
          class: 'dl-link', href: p.url || URL.createObjectURL(p.blob), download: p.def.name,
        }, [
          el('span', { dir: 'ltr', text: p.def.icon + ' ' + p.def.name }),
          el('span', { class: 'small', text: '⬇ ' + STR.generate.downloadAgain }),
        ]))),
    ]));
    // Share-ready summary — a copy/paste-friendly Arabic message built from the
    // FINAL (override-aware) numbers, read exactly the way build-spec does: the
    // manual override wins when finite, else the computed KPI value.
    const panel = resultHost.querySelector('.success-panel');
    if (panel) panel.appendChild(buildShareCard(model, date, produced.length));

    // Bring the success panel above the sticky action bar — the moment of success
    // must not render half-hidden behind it.
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    toast(STR.generate.done, 'ok');
  }

  // Per-lab "Late & Due" Excel export — built from the run's parsed order rows (works
  // whether or not the four report files were produced, incl. live-snapshot).
  // labRecipients only pre-fills the To: line of a downloaded .eml draft — nothing
  // is sent from here; without it the settings tab's per-lab addresses do nothing.
  //
  // NEVER SCOPED — always every parsed order, as of the CHOSEN report date. These are
  // OPERATIONAL follow-up lists: each workbook goes to its lab as a draft pre-addressed
  // to that lab, named labFileName(lab) exactly like the full run's. Scoped, it would be
  // an incomplete chase list nothing marks as partial — a range drops every order placed
  // before 'from' and judges "late / due in 24h" as of 'to' (possibly weeks ago); a
  // shipment scope drops the lab's other late orders. So: state.parsed.orders (never
  // model.scopedRows), and a scoped model's date is NOT model.reportDate (= 'to' under a
  // range) but state.reportDate, the date the operator picked. Unscoped, model.reportDate
  // is passed exactly as before. A one-line note says so above the section.
  const scopedRun = isScoped(model.scope);
  const labsAsOf = scopedRun ? (state.reportDate || todayISO()) : model.reportDate;
  if (scopedRun) {
    resultHost.appendChild(el('p', {
      class: 'small muted', style: 'margin:16px 0 0;text-align:right',
      text: STR.generate.lateLabsUnscoped.replace('{date}', formatDateAr(labsAsOf) || labsAsOf),
    }));
  }
  // REPORT TYPES: the chase lists stay KAMC's whatever report was generated — SGH has no
  // Test Menu, so no line of it can be late or due, and handing SGH rows to the workbook
  // builder would merge a lab both hospitals use into one workbook. Said, so an SGH /
  // KAMC + SGH run does not read them as its own.
  if (hospitalOf(model) !== 'kamc') {
    resultHost.appendChild(el('p', {
      class: 'small muted', style: 'margin:16px 0 0;text-align:right',
      text: STR.generate.lateLabsKamcOnly,
    }));
  }
  try {
    resultHost.appendChild(await buildLateLabsSection({
      rows: (state.parsed && state.parsed.orders) || null,
      tatTests: (store.settings && store.settings.tatLookup) || {},
      reportDate: labsAsOf,
      labRecipients: (store.settings && store.settings.automation
        && store.settings.automation.labRecipients) || null,
    }));
  } catch (e) {
    console.warn('[generate] late-labs section failed', e);
  }

  // Reset control
  resultHost.appendChild(el('div', { class: 'sticky-actions', style: 'display:flex;gap:10px' }, [
    el('button', {
      class: 'btn btn--ghost', text: STR.common.back, style: 'flex:1',
      onClick: () => navigate('review'),
    }),
    el('button', {
      class: 'btn btn--primary', text: STR.generate.newReport, style: 'flex:1',
      onClick: () => { produced.forEach((p) => p.url && URL.revokeObjectURL(p.url)); resetRunData(); navigate('upload'); },
    }),
  ]));
}
