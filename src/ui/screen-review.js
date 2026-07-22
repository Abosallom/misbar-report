// ui/screen-review.js — review/edit report content with a live slide preview (Track E).
import { STR, todayISO, formatDateAr } from '../i18n/ar.js?v=v2026-07-22.7';
import { el, editableTable, textareaField, toast } from './components.js?v=v2026-07-22.7';
import { buildMockEngineOutput, buildMockTracker } from './screen-upload.js?v=v2026-07-22.7';
import { autoDraft } from '../model/drafts.js?v=v2026-07-22.7';

/* small local module helpers (kept local to avoid cross-screen coupling) */
async function tryImport(path) { try { return await import(path); } catch { return null; } }
function pickFn(mod, names) {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function') return mod[n];
  if (typeof mod.default === 'function') return mod.default;
  return null;
}
// Canonical internal rule mirrors model/drafts.js: فئة التقرير 'لين' routes a task to
// the internal (داخلي) deck; مفتوح displays as قيد التنفيذ. (An old /داخل|internal/i
// regex here matched no real 'لين' rows and once rendered the internal table empty.)
const CAT_INTERNAL = 'لين';
const displayStatus = (s) => (s === 'مفتوح' ? 'قيد التنفيذ' : s);
const isClosed = (t) => /مغلق|closed|منجز|مكتمل/i.test((t && (t.status || '')) || '');
const linesToArr = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

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
];

const OV_INPUT_STYLE = 'flex:1;min-width:0;border:1px solid var(--border-dark);border-radius:6px;padding:6px 8px;min-height:36px;background:var(--white);color:var(--slate-900);font-weight:700;text-align:right';
const OV_BADGE_STYLE = 'align-items:center;background:#FEF3C7;color:#92400E;border:1px solid var(--amber);font-size:.68rem;font-weight:700;padding:1px 8px;border-radius:999px;white-space:nowrap';
const OV_RESET_STYLE = 'align-items:center;justify-content:center;flex:0 0 auto;width:32px;height:32px;border:1px solid var(--border-dark);background:var(--white);color:var(--slate-600);border-radius:6px;cursor:pointer;font-size:1rem;line-height:1';
const chipStyle = (on) => 'border-radius:999px;padding:6px 14px;font-weight:700;font-size:.85rem;cursor:pointer;min-height:36px;'
  + (on
    ? 'background:var(--navy);color:#fff;border:1px solid var(--navy);'
    : 'background:var(--white);color:var(--slate-500);border:1px solid var(--border-dark);text-decoration:line-through;opacity:.75;');

/* 'ما الجديد' banner — delta keys → Arabic '+N' chip label + colour intent. Keys
 * mirror EngineOutput.deltas; labels are tuned for the '+N {label}' phrasing.
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
  good: 'background:#DCFCE7;color:#166534;border:1px solid rgba(22,163,74,.35)',
  bad: 'background:#FEE2E2;color:#991B1B;border:1px solid rgba(220,38,38,.35)',
  wait: 'background:#FEF3C7;color:#92400E;border:1px solid rgba(245,158,11,.45)',
  info: 'background:#E0E7FF;color:#1E3A8A;border:1px solid rgba(30,58,138,.30)',
};
const DELTA_CHIP_BASE = 'display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:6px 13px;font-weight:800;font-size:.82rem;line-height:1.3;white-space:nowrap';

/* Slide-pager (preview) chrome. */
const PAGER_BAR_STYLE = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap';
const PAGER_ARROW_STYLE = 'min-width:40px;height:40px;flex:0 0 auto;border:1px solid var(--border-dark);background:var(--white);color:var(--navy);border-radius:8px;font-size:1.1rem;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center';
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
    d = autoDraft(tracker, reportDate);
  } catch (e) {
    console.warn('[review] autoDraft failed; falling back to local split', e);
    // Mirror the canonical split (model/drafts.js): tasksInternal = EVERY task whose
    // category === 'لين' — hidden rows and مغلق included — with the مفتوح→قيد التنفيذ
    // display mapping. The other lists stay on visible (non-hidden) rows.
    const allTasks = tracker.tasks || [];
    const toDisplay = (t) => ({ ...t, status: displayStatus(t.status) });
    const visible = allTasks.filter((t) => !t.hidden);
    d = {
      tasksInternal: allTasks.filter((t) => t.category === CAT_INTERNAL).map(toDisplay),
      tasksCurrent: visible.filter((t) => t.category !== CAT_INTERNAL && !isClosed(t)).map(toDisplay),
      completedTasks: visible.filter(isClosed).map((t) => t.task),
      plannedTasks: visible.filter((t) => !isClosed(t) && t.category !== CAT_INTERNAL).map((t) => t.task),
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
  // Backfill for a model drafted by older code (before reportOptions/overrides).
  if (!model.reportOptions) model.reportOptions = reportOptionsFromSettings(store.settings);
  if (!model.reportOptions.labels) model.reportOptions.labels = {};
  if (!model.overrides) model.overrides = {};
  const kpi = model.kpi;

  // Persist reportOptions (slides + labels) to settings as the new defaults.
  // store.settings is a fresh clone each read → load, mutate, save. Overrides are
  // per-run and are NEVER written here.
  const persistReportOptions = () => {
    try {
      const doc = store.loadSettings();
      doc.reportOptions = JSON.parse(JSON.stringify(model.reportOptions));
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
    const specMod = await tryImport('../slidespec/build-spec.js?v=v2026-07-22.7');
    const buildSpec = pickFn(specMod, ['buildSpec', 'build', 'makeSpec', 'toSpec']);
    const rendMod = await tryImport('../render/html-renderer.js?v=v2026-07-22.7');
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
    state.reportDate = dateInput.value || todayISO();
    model.reportDate = state.reportDate; // sync immediately — generate must never see a stale date
    dateHint.textContent = formatDateAr(state.reportDate);
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

  const tasksCurrentCard = el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: STR.review.tasksCurrentTitle }),
    editableTable({
      columns: taskCols, rows: model.tasksCurrent, minWidth: '520px', newRow: newTask,
      onChange: (rows) => { model.tasksCurrent = rows; schedulePreview(); },
    }),
  ]);
  // Internal (لين) task table = the COMPLETE log — all statuses + hidden (collapsed
  // done-work) rows — so it can run long. Collapse to the first COLLAPSE_ROWS rows
  // behind a toggle, dim hidden rows (with a 'مخفي في الجدول' chip) and give مغلق rows
  // a subtle done tint. editableTable rebuilds its <tbody> on add/remove, so the
  // decoration is re-applied from onChange (and once up-front). Editability, the
  // add/remove wiring and the hidden flag (preserved by editableTable's {...r} spread)
  // are all untouched — decoration only styles rows, it never mutates the data.
  const COLLAPSE_ROWS = 8;
  let internalExpanded = false;
  const internalTable = editableTable({
    columns: taskCols, rows: model.tasksInternal, minWidth: '520px', newRow: newTask,
    onChange: (rows) => { model.tasksInternal = rows; decorateInternalTable(); schedulePreview(); },
  });
  const internalToggle = el('button', {
    type: 'button', class: 'btn btn--ghost btn--sm', style: 'margin-top:8px;display:none',
    onClick: () => { internalExpanded = !internalExpanded; decorateInternalTable(); },
  });
  function decorateInternalTable() {
    const tbody = internalTable.querySelector('tbody');
    if (!tbody) return;
    const rows = model.tasksInternal || [];
    const trs = Array.from(tbody.children);
    // Idempotent: strip decoration from any prior pass before re-applying.
    tbody.querySelectorAll('.rev-hidden-chip').forEach((n) => n.remove());
    trs.forEach((tr, i) => {
      const r = rows[i] || {};
      // Collapse everything past the threshold unless expanded.
      tr.style.display = (!internalExpanded && i >= COLLAPSE_ROWS) ? 'none' : '';
      // مغلق → subtle green 'done' tint; hidden (collapsed done-work) → dimmed + chip.
      tr.style.background = isClosed(r) ? 'rgba(22,163,74,.08)' : '';
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
    internalTable,
    internalToggle,
  ]);
  decorateInternalTable(); // decorate the initial (already-rendered) rows

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
    const specMod = await tryImport('../slidespec/build-spec.js?v=v2026-07-22.7');
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
  const generateBtn = el('div', { class: 'sticky-actions' }, [genButton]);

  // 'ما الجديد منذ التقرير السابق' banner — the first thing the operator sees.
  // Reads the engine's deltas vs the previous-report snapshot: a coloured chip per
  // delta>0, else a calm single line. Deltas are fixed for the run, so build once.
  function buildDeltaBanner() {
    const deltas = (kpi && kpi.deltas) || {};
    const asOf = store.settings && store.settings.snapshot && store.settings.snapshot.asOf;
    const asOfAr = formatDateAr(asOf) || (asOf ? String(asOf) : '');
    const active = DELTA_META.filter((m) => Number(deltas[m.key]) > 0);
    if (!active.length) {
      const txt = asOfAr ? `لا تغييرات منذ التقرير السابق (${asOfAr})` : 'لا تغييرات منذ التقرير السابق';
      return el('div', { class: 'card', style: 'padding:14px 16px;display:flex;align-items:center;gap:8px' }, [
        el('span', { text: '✓', style: 'color:var(--green);font-weight:800;font-size:1.1rem' }),
        el('span', { text: txt, style: 'color:var(--slate-600);font-weight:600;font-size:.92rem' }),
      ]);
    }
    const chips = active.map((m) => el('span', {
      style: DELTA_CHIP_BASE + ';' + (DELTA_CHIP_TONE[m.intent] || DELTA_CHIP_TONE.info),
      text: `+${deltas[m.key]} ${m.label}`,
    }));
    return el('div', { class: 'card', style: 'padding:16px 18px;border-inline-start:4px solid var(--navy)' }, [
      el('div', { style: 'font-weight:800;font-size:1.05rem;color:var(--navy);margin-bottom:3px', text: 'ما الجديد منذ التقرير السابق' }),
      el('div', { class: 'small muted', style: 'margin-bottom:12px', text: asOfAr ? `مقارنة بتقرير ${asOfAr}` : 'مقارنة بالتقرير السابق' }),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' }, chips),
    ]);
  }

  // Banner FIRST, then daily-edited items (date → support → tasks → challenges/risks),
  // then the advanced KPI-override and label-customisation cards, then generate.
  const controls = el('div', { class: 'review-controls' }, [
    buildDeltaBanner(), dateField, panelsCard, tasksCurrentCard, tasksInternalCard, challengesCard, risksCard, kpiCard, labelsHost, generateBtn,
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
