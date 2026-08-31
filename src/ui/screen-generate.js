// ui/screen-generate.js — build both variants, produce 4 files, trigger downloads (Track E).
// The file-producing core now lives in automation/pipeline.js (produceReportFiles) so
// an unattended run makes byte-identical files; this screen drives it and paints the
// very same progress bar, file rows and live slide thumbnails it always has.
import { STR, todayISO, formatDateAr } from '../i18n/ar.js?v=v2026-08-31.3';
import { el, progressBar, toast } from './components.js?v=v2026-08-31.3';
import { resetRunData } from '../state.js?v=v2026-08-31.3';
import { buildMockEngineOutput, buildMockTracker } from './screen-upload.js?v=v2026-08-31.3';
import { autoDraft, splitTaskLists } from '../model/drafts.js?v=v2026-08-31.3';
import { buildLateLabsSection, triggerDownload } from './late-labs-section.js?v=v2026-08-31.3';
import {
  applyWindowDeltas, buildFileDefs, produceReportFiles, recordRunSnapshot,
  shouldAutoDownloadFiles,
} from '../automation/pipeline.js?v=v2026-08-31.3';

async function tryImport(path) { try { return await import(path); } catch { return null; } }
const isMobile = () => /iP(hone|ad|od)|Android/i.test(navigator.userAgent);

function fallbackModel(state, store) {
  const kpi = state.engineOutput || buildMockEngineOutput(store.settings);
  const tracker = state.parsed.tracker || buildMockTracker();
  const reportDate = state.reportDate || todayISO();
  // CANONICAL task split via model/drafts.js (internal = فئة التقرير 'لين', plus the
  // one-report grace for مغلق rows) — a local regex here once diverged and emptied
  // the internal task table, so nothing is re-derived on this screen any more.
  let d;
  try {
    d = autoDraft(tracker, reportDate, { taskLog: store.settings && store.settings.taskLog });
  } catch { d = null; }
  // If autoDraft itself threw, splitTaskLists with an empty bag is the degradation:
  // non-closed rows only (a subset of the real answer), never every closed task.
  let split = { tasksCurrent: [], tasksInternal: [] };
  try { split = splitTaskLists(tracker.tasks || [], {}); } catch { /* keep the empties */ }
  return {
    reportDate,
    kpi,
    panels: {
      supportRequired: (d && d.supportRequired) || [],
      completedTasks: (d && d.completedTasks) || [],
      plannedTasks: (d && d.plannedTasks) || [],
    },
    tasksCurrent: (d && d.tasksCurrent) || split.tasksCurrent,
    tasksInternal: (d && d.tasksInternal) || split.tasksInternal,
    challenges: tracker.challenges || [],
    risks: tracker.risks || [],
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
function buildShareCard(model, date, fileCount) {
  const V = (key, computed) => (Number.isFinite(model.overrides && model.overrides[key]) ? model.overrides[key] : computed);
  const k = model.kpi || {};
  const b = k.buckets || {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const total = num(V('total', k.totals && k.totals.total));
  const completed = num(V('completed', b.completed));
  const awaiting = num(V('awaitingResults', b.awaitingResults));
  const late = num(V('lateNoResult', b.lateNoResult));
  const rejected = num(V('rejected', b.rejected));
  const cancelled = num(V('cancelledNote', k.cancelledNote));
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const text =
    `تقرير مسبار الأسبوعي — ${formatDateAr(date) || date}\n` +
    `• إجمالي الطلبات: ${total}\n` +
    `• فحوصات مكتملة (تشمل المرفوضة): ${completed} (${pct}%)\n` +
    `↳ منها مرفوضة: ${rejected}\n` +
    `• بانتظار النتائج: ${awaiting}\n` +
    `↳ منها متأخرة: ${late}\n` +
    `• ملغاة: ${cancelled}\n` +
    `الملفات: ${fileCount} (نسختا PPTX و PDF داخلية ونوبكو)`;

  const ta = el('textarea', {
    dir: 'rtl', readOnly: true, rows: 6, value: text,
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
  // recordSnapshot (below) still appends this run's published numbers to snapshotHistory
  // for the history panel. Both modules are guarded → engine deltas if either is absent.
  const dwMod = await tryImport('../model/delta-window.js?v=v2026-08-31.3');
  const dbMod = await tryImport('../model/delta-baseline.js?v=v2026-08-31.3');
  const recordSnapshot = dbMod && dbMod.recordSnapshot;
  applyWindowDeltas(model, state, store, dwMod && dwMod.stampWindowDeltas);

  // Same four definitions produceReportFiles will walk — one shared source.
  const fileDefs = buildFileDefs(date);

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
  const head = el('div', { class: 'screen__head' }, [
    el('h1', { text: STR.generate.title }),
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
    // recordShownTasks also writes the closed-task grace log (v6) from this very
    // model — guarded import, so an older/partial build just keeps the numbers path.
    const tlMod = await tryImport('../model/task-lifecycle.js?v=v2026-08-31.3');
    recordRunSnapshot({
      model, store, state, date, recordSnapshot,
      recordShownTasks: tlMod && tlMod.recordShownTasks,
      // Per-variant grace consumption: only a variant that actually produced a file
      // gets its task list recorded. Without this, an internal-only success would
      // consume the NUPCO closures' one-shot appearance on a deck NUPCO never saw
      // (produceReportFiles swallows per-file failures, so produced can be partial).
      shippedVariants: produced.map((p) => p.def && p.def.variant).filter(Boolean),
    });

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

  // Per-lab "Late & Due" Excel export — built from the SAME dataset this run used
  // (works whether or not the four report files were produced, incl. live-snapshot).
  // labRecipients only pre-fills the To: line of a downloaded .eml draft — nothing
  // is sent from here; without it the settings tab's per-lab addresses do nothing.
  try {
    resultHost.appendChild(await buildLateLabsSection({
      rows: (state.parsed && state.parsed.orders) || null,
      tatTests: (store.settings && store.settings.tatLookup) || {},
      reportDate: model.reportDate,
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
