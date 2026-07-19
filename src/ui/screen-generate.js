// ui/screen-generate.js — build both variants, produce 4 files, trigger downloads (Track E).
import { STR, todayISO, buildFileName } from '../i18n/ar.js';
import { el, progressBar, toast } from './components.js';
import { VARIANTS } from '../contracts.js';
import { getGenLibs } from '../vendor-loader.js';
import { resetRunData } from '../state.js';
import { buildMockEngineOutput, buildMockTracker } from './screen-upload.js';

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
  // Mirror the drafts/review split so NUPCO files never leak internal or closed
  // tasks: drop مغلق (closed) rows, then partition by فئة (internal = داخلي).
  const isInternal = (t) => /داخل/.test((t && t.category) || '');
  const visible = (tracker.tasks || []).filter((t) => !t.hidden && t.status !== 'مغلق');
  return {
    reportDate: state.reportDate || todayISO(),
    kpi,
    panels: { supportRequired: [], completedTasks: [], plannedTasks: [] },
    tasksCurrent: visible.filter((t) => !isInternal(t)),
    tasksInternal: visible.filter((t) => isInternal(t)),
    challenges: tracker.challenges || [],
    risks: tracker.risks || [],
    scorecard: (store.settings && store.settings.scorecard) || [],
    displayNames: (store.settings && store.settings.displayNames) || {},
  };
}

// Build the SlideSpec per VARIANT — the variant changes slide-5 content
// (task rows), so one shared spec would leak internal tasks into NUPCO files.
async function buildVariantSpec(model, variant) {
  const mod = await tryImport('../slidespec/build-spec.js');
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
  const mod = await tryImport('../render/pptx-renderer.js');
  const fn = pickFn(mod, ['renderPptx', 'buildPptx', 'toPptx', 'makePptx', 'render']);
  if (!fn) return null;
  const r = await fn(spec, { variant, PptxGenJS: libs.PptxGenJS });
  return toBlob(r, 'pptx');
}

// renderSlides(spec, {variant}) -> fragment of .sl-slide; exportPdf(slideEls, {jsPDF, html2canvas, onProgress})
async function makePdf(spec, variant, libs, host, onProgress) {
  if (!spec) return null;
  const rMod = await tryImport('../render/html-renderer.js');
  const renderSlides = pickFn(rMod, ['renderSlides', 'renderSpec', 'renderHtml', 'render']);
  const pMod = await tryImport('../render/pdf-export.js');
  const exportPdf = pickFn(pMod, ['exportPdf', 'renderPdf', 'toPdf', 'buildPdf', 'render']);
  if (!renderSlides || !exportPdf) return null;
  host.innerHTML = '';
  const frag = renderSlides(spec, { variant });
  if (frag instanceof Node) host.appendChild(frag);
  const slideEls = Array.from(host.querySelectorAll('.sl-slide'));
  const r = await exportPdf(slideEls, { jsPDF: libs.jsPDF, html2canvas: libs.html2canvas, onProgress });
  host.innerHTML = '';
  return toBlob(r, 'pdf');
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
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
  const resultHost = el('div');
  const host = el('div', { class: 'render-host' }); // full-size, offscreen, for html2canvas capture

  const head = el('div', { class: 'screen__head' }, [
    el('h1', { text: STR.generate.title }),
    el('p', { text: STR.generate.subtitle }),
    el('p', { class: 'small muted', text: '⏳ ' + STR.generate.keepOpen }),
  ]);

  container.appendChild(el('div', { class: 'screen' }, [
    head,
    el('div', { class: 'card' }, [bar.el, fileList]),
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
          });
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
      el('div', { class: 'success-panel__icon', text: '✅' }),
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
    toast(STR.generate.done, 'ok');
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
