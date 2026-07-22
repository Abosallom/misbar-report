// ui/screen-generate.js — build both variants, produce 4 files, trigger downloads (Track E).
import { STR, todayISO, buildFileName, formatDateAr } from '../i18n/ar.js?v=v2026-07-22.7';
import { el, progressBar, toast } from './components.js?v=v2026-07-22.7';
import { VARIANTS } from '../contracts.js?v=v2026-07-22.7';
import { getGenLibs, getXLSX } from '../vendor-loader.js?v=v2026-07-22.7';
import { resetRunData } from '../state.js?v=v2026-07-22.7';
import { buildMockEngineOutput, buildMockTracker } from './screen-upload.js?v=v2026-07-22.7';
import { autoDraft } from '../model/drafts.js?v=v2026-07-22.7';
import { buildLateLabWorkbooks } from '../export/late-labs.js?v=v2026-07-22.7';
import { parseDateTime } from '../engine/workday.js?v=v2026-07-22.7';

async function tryImport(path) { try { return await import(path); } catch { return null; } }
function pickFn(mod, names) {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function') return mod[n];
  if (typeof mod.default === 'function') return mod.default;
  return null;
}
const isMobile = () => /iP(hone|ad|od)|Android/i.test(navigator.userAgent);

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

function fallbackModel(state, store) {
  const kpi = state.engineOutput || buildMockEngineOutput(store.settings);
  const tracker = state.parsed.tracker || buildMockTracker();
  const reportDate = state.reportDate || todayISO();
  // CANONICAL task split via model/drafts.js (internal = فئة التقرير 'لين') —
  // a local regex here once diverged and emptied the internal task table.
  let d;
  try { d = autoDraft(tracker, reportDate); } catch { d = null; }
  const visible = (tracker.tasks || []).filter((t) => !t.hidden && t.status !== 'مغلق');
  // Canonical internal fallback: the complete لين log (hidden + مغلق included),
  // same مفتوح→قيد التنفيذ display mapping autoDraft applies.
  const linAll = (tracker.tasks || [])
    .filter((t) => t.category === 'لين')
    .map((t) => (t.status === 'مفتوح' ? { ...t, status: 'قيد التنفيذ' } : t));
  return {
    reportDate,
    kpi,
    panels: {
      supportRequired: (d && d.supportRequired) || [],
      completedTasks: (d && d.completedTasks) || [],
      plannedTasks: (d && d.plannedTasks) || [],
    },
    tasksCurrent: (d && d.tasksCurrent) || visible,
    tasksInternal: (d && d.tasksInternal) || linAll,
    challenges: tracker.challenges || [],
    risks: tracker.risks || [],
    scorecard: (store.settings && store.settings.scorecard) || [],
    displayNames: (store.settings && store.settings.displayNames) || {},
    reportOptions: (store.settings && store.settings.reportOptions) || undefined,
    overrides: {},
  };
}

// Build the SlideSpec per VARIANT — the variant changes slide-5 content
// (task rows), so one shared spec would leak internal tasks into NUPCO files.
async function buildVariantSpec(model, variant) {
  const mod = await tryImport('../slidespec/build-spec.js?v=v2026-07-22.7');
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
  const mod = await tryImport('../render/pptx-renderer.js?v=v2026-07-22.7');
  const fn = pickFn(mod, ['renderPptx', 'buildPptx', 'toPptx', 'makePptx', 'render']);
  if (!fn) return null;
  const r = await fn(spec, { variant, PptxGenJS: libs.PptxGenJS });
  return toBlob(r, 'pptx');
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

// renderSlides(spec, {variant}) -> fragment of .sl-slide; exportPdf(slideEls, {jsPDF, html2canvas, onProgress})
async function makePdf(spec, variant, libs, host, onProgress, thumbs) {
  if (!spec) return null;
  const rMod = await tryImport('../render/html-renderer.js?v=v2026-07-22.7');
  const renderSlides = pickFn(rMod, ['renderSlides', 'renderSpec', 'renderHtml', 'render']);
  const pMod = await tryImport('../render/pdf-export.js?v=v2026-07-22.7');
  const exportPdf = pickFn(pMod, ['exportPdf', 'renderPdf', 'toPdf', 'buildPdf', 'render']);
  if (!renderSlides || !exportPdf) return null;
  host.innerHTML = '';
  const frag = renderSlides(spec, { variant });
  if (frag instanceof Node) host.appendChild(frag);
  const slideEls = Array.from(host.querySelectorAll('.sl-slide'));
  if (thumbs) thumbs.load(slideEls); // clone once per variant, before capture starts
  const onTick = thumbs
    ? (done, tot) => { thumbs.highlight(done, tot); if (onProgress) onProgress(done, tot); }
    : onProgress;
  const r = await exportPdf(slideEls, { jsPDF: libs.jsPDF, html2canvas: libs.html2canvas, onProgress: onTick });
  host.innerHTML = '';
  return toBlob(r, 'pdf');
}

// Share-ready summary card shown after success. Numbers mirror build-spec's
// valueOf: override wins when finite, else the computed KPI value.
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
    `تقرير مسبار اليومي — ${formatDateAr(date) || date}\n` +
    `• إجمالي الطلبات: ${total}\n` +
    `• نتائج مكتملة: ${completed} (${pct}%)\n` +
    `• بانتظار النتائج: ${awaiting}\n` +
    `• متأخرة: ${late}\n` +
    `• مرفوضة: ${rejected}\n` +
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

// English email template the team pastes when notifying a lab — verbatim wording.
function labEmailText(lab) {
  const subject = `${lab} | Late Test Results — Action Required`;
  const body = [
    'Dear all,',
    'This is a reminder regarding laboratory orders that require your attention.',
    'Some orders in the attached report are approaching their SLA deadline and will breach within the next 24 hours. These are flagged for priority and should be actioned urgently to avoid an SLA breach.',
    'Please confirm once the listed orders have been addressed. If you have any questions or are facing issues preventing fulfillment, let us know so we can support you.',
    'Please find the attachment for more info about the orders.',
    'Thank you for your cooperation.',
  ].join('\n\n');
  return `Subject: ${subject}\n\n${body}`;
}

// Copy text to the clipboard with an execCommand fallback (keeps user activation
// on browsers where navigator.clipboard is unavailable). Mirrors buildShareCard.
async function copyText(text) {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  return fallback();
}

// Per-lab "Late & Due" Excel export section. Built from the SAME dataset the
// generate run used (state.parsed.orders + settings.tatLookup + report date), so
// it works in live-snapshot mode too. Returns a DOM node, or the empty-state card.
async function buildLateLabsSection(model, state, store) {
  const title = 'ملفات المختبرات — المتأخر والمستحق (Excel)';
  const rows = (state.parsed && state.parsed.orders) || null;
  const tatTests = (store.settings && store.settings.tatLookup) || {};
  const asOfMs = parseDateTime(model.reportDate || todayISO());

  const emptyCard = (msg) => el('div', { class: 'card', style: 'margin-top:16px;text-align:right' }, [
    el('div', { class: 'card__title', text: title }),
    el('p', { class: 'small muted', style: 'margin:0', text: msg }),
  ]);

  if (!rows || !rows.length || asOfMs == null) return emptyCard('لا توجد فحوصات متأخرة أو مستحقة خلال 24 ساعة ✅');

  let XLSX;
  let wbs = [];
  try {
    XLSX = await getXLSX();
    wbs = buildLateLabWorkbooks({ rows, tatTests, asOfMs, XLSX });
  } catch (e) {
    console.warn('[generate] late-labs build failed', e);
    return emptyCard('تعذّر إنشاء ملفات المختبرات.');
  }
  if (!wbs.length) return emptyCard('لا توجد فحوصات متأخرة أو مستحقة خلال 24 ساعة ✅');

  const SHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const downloadOne = (w) => {
    const buf = XLSX.write(w.wb, { type: 'array', bookType: 'xlsx' });
    triggerDownload(new Blob([buf], { type: SHEET_MIME }), w.fileName);
  };

  const labRows = wbs.map((w) => el('div', { class: 'dl-link', style: 'flex-wrap:wrap;gap:8px' }, [
    el('div', { style: 'display:flex;flex-direction:column;gap:2px;min-width:0;flex:1' }, [
      el('span', { dir: 'ltr', style: 'font-weight:600;overflow-wrap:anywhere', text: w.lab }),
      el('span', { class: 'small muted' }, [
        'فحص متأخر: ', el('span', { dir: 'ltr', text: String(w.late) }),
        ' • مستحق خلال ٢٤ ساعة: ', el('span', { dir: 'ltr', text: String(w.dueSoon) }),
      ]),
    ]),
    el('div', { style: 'display:flex;gap:6px;flex-shrink:0' }, [
      el('button', {
        class: 'btn btn--ghost', text: '⬇ تنزيل',
        onClick: () => downloadOne(w),
      }),
      el('button', {
        class: 'btn btn--ghost', text: '✉ نسخ نص البريد',
        onClick: async () => { if (await copyText(labEmailText(w.lab))) toast('تم نسخ نص البريد', 'ok'); },
      }),
    ]),
  ]));

  const children = [
    el('div', { class: 'card__title', text: title }),
    el('p', { class: 'small muted', style: 'margin:0 0 4px', text: 'الأعداد بعدد الفحوصات (سطور الطلبات) وليس بعدد الطلبات.' }),
    ...labRows,
  ];
  if (wbs.length > 1) {
    children.push(el('button', {
      class: 'btn btn--primary btn--block', style: 'margin-top:10px', text: 'تنزيل الكل',
      // Sequential downloads ~300ms apart so browsers don't drop stacked clicks.
      onClick: async () => {
        for (let i = 0; i < wbs.length; i++) {
          downloadOne(wbs[i]);
          if (i < wbs.length - 1) await new Promise((r) => setTimeout(r, 300));
        }
      },
    }));
  }
  return el('div', { class: 'card', style: 'margin-top:16px;text-align:right' }, children);
}

function triggerDownload(blob, name) {
  // Lab names come from CSV data — strip path separators and other
  // filesystem-illegal characters before using them as a download name.
  const safe = String(name).replace(/[/\\<>:"|?*\u0000-\u001f]/g, '-');
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: safe });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); }, 4000);
  return url;
}

export async function render(container, ctx) {
  const { state, store, navigate } = ctx;
  const model = state.reportModel || fallbackModel(state, store);
  const date = model.reportDate || todayISO();

  const fileDefs = [
    { id: 'internal-pptx', variant: 'internal', kind: 'pptx', label: STR.generate.fileInternalPptx, icon: '📊', name: buildFileName(VARIANTS.internal.filePrefix, date, 'pptx') },
    { id: 'nupco-pptx', variant: 'nupco', kind: 'pptx', label: STR.generate.fileNupcoPptx, icon: '📊', name: buildFileName(VARIANTS.nupco.filePrefix, date, 'pptx') },
    { id: 'internal-pdf', variant: 'internal', kind: 'pdf', label: STR.generate.fileInternalPdf, icon: '📄', name: buildFileName(VARIANTS.internal.filePrefix, date, 'pdf') },
    { id: 'nupco-pdf', variant: 'nupco', kind: 'pdf', label: STR.generate.fileNupcoPdf, icon: '📄', name: buildFileName(VARIANTS.nupco.filePrefix, date, 'pdf') },
  ];

  const rowEls = {};
  const fileList = el('div', { class: 'gen-files' }, fileDefs.map((f) => {
    const status = el('span', { class: 'gen-file__status', text: '…' });
    const row = el('div', { class: 'gen-file', id: 'genrow-' + f.id }, [
      el('span', { class: 'gen-file__icon', text: f.icon }),
      el('span', { class: 'gen-file__name', dir: 'ltr', text: f.name }), // dir=ltr: keeps '….pptx' after the digits in RTL context
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

  const produced = []; // {def, blob, url}
  let hadError = false;
  const restoreTimers = installFastTimers();

  try {
    const libs = await getGenLibs();
    bar.set(6, STR.generate.buildingSpec);
    const specs = {
      internal: await buildVariantSpec(model, 'internal'),
      nupco: await buildVariantSpec(model, 'nupco'),
    };
    const total = fileDefs.length;

    for (let i = 0; i < fileDefs.length; i++) {
      const f = fileDefs[i];
      const spec = specs[f.variant];
      const base = (i / total) * 100;
      rowEls[f.id].status.textContent = f.kind === 'pptx' ? STR.generate.buildingPptx : STR.generate.renderingSlides;
      bar.set(base + 4, `${f.label} — ${f.kind === 'pptx' ? STR.generate.buildingPptx : STR.generate.buildingPdf}`);

      let blob = null;
      try {
        // Guard each file with a timeout so a hanging renderer degrades gracefully
        // instead of freezing the whole screen (e.g. PptxGenJS.write stalls in some envs).
        const job = f.kind === 'pptx'
          ? makePptx(spec, f.variant, libs)
          : makePdf(spec, f.variant, libs, host, (done, tot) => {
            const frac = tot ? done / tot : 0;
            bar.set(base + frac * (100 / total), `${f.label} — ${STR.generate.capturing} ${done}/${tot || '?'}`);
          }, thumbs);
        // Generous ceilings: background-tab setTimeout throttling can stretch
        // JSZip/canvas work from seconds to minutes; only a true hang should trip this.
        blob = await withTimeout(job, 300000, f.id);
      } catch (e) {
        console.error('[generate] file failed', f.id, e);
      }

      if (blob) {
        produced.push({ def: f, blob });
        rowEls[f.id].row.classList.add('is-done');
        rowEls[f.id].status.textContent = '✓';
      } else {
        hadError = true;
        rowEls[f.id].status.textContent = '—';
      }
      bar.set(((i + 1) / total) * 100);
    }
  } catch (e) {
    console.error('[generate] gen libs failed', e);
    hadError = true;
  } finally {
    restoreTimers();
  }

  host.innerHTML = '';

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
    // every exec/journey number against these.
    try {
      const k = model.kpi || {};
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
      if (numbers.completed != null && typeof store.updateSnapshot === 'function') {
        store.updateSnapshot({ asOf: date, numbers });
        state.settings = store.settings;
      }
    } catch (e) { console.warn('[generate] snapshot update failed', e); }

    // Auto-download works on desktop; iOS/Safari may drop programmatic clicks
    // that fire without recent user activation, so it's attempted on desktop only
    // and the panel below always offers gesture-driven buttons.
    if (!isMobile()) {
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
      el('p', { class: 'small muted', style: 'margin-top:6px', text: STR.generate.downloadHint }),
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
  try {
    resultHost.appendChild(await buildLateLabsSection(model, state, store));
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
