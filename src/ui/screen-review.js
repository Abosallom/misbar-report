// ui/screen-review.js — review/edit report content with a live slide preview (Track E).
import { STR, todayISO, formatDateAr } from '../i18n/ar.js';
import { el, editableTable, textareaField, toast } from './components.js';
import { buildMockEngineOutput, buildMockTracker } from './screen-upload.js';

/* small local module helpers (kept local to avoid cross-screen coupling) */
async function tryImport(path) { try { return await import(path); } catch { return null; } }
function pickFn(mod, names) {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function') return mod[n];
  if (typeof mod.default === 'function') return mod.default;
  return null;
}
const isInternalCat = (t) => /داخل|internal/i.test((t && (t.category || '')) || '');
const isClosed = (t) => /مغلق|closed|منجز|مكتمل/i.test((t && (t.status || '')) || '');
const linesToArr = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

const STATUS_OPTIONS = [
  STR.review.status.open, STR.review.status.ongoing,
  STR.review.status.late, STR.review.status.inProgress, STR.review.status.closed,
];

/* Assemble an editable ReportModel from engineOutput + tracker + settings. */
function buildDraftReportModel(state, store) {
  const kpi = state.engineOutput || buildMockEngineOutput(store.settings);
  const tracker = state.parsed.tracker || buildMockTracker();
  const tasks = (tracker.tasks || []).filter((t) => !t.hidden);

  const tasksInternal = tasks.filter(isInternalCat);
  const tasksCurrent = tasks.filter((t) => !isInternalCat(t) && !isClosed(t));

  const completedTasks = tasks.filter(isClosed).map((t) => t.task);
  const plannedTasks = tasks.filter((t) => !isClosed(t) && !isInternalCat(t)).map((t) => t.task);
  const supportRequired = (tracker.challenges || []).map((c) => c.title).filter(Boolean);

  return {
    reportDate: state.reportDate || todayISO(),
    kpi,
    panels: { supportRequired, completedTasks, plannedTasks },
    tasksCurrent: tasksCurrent.map((t) => ({ ...t })),
    tasksInternal: tasksInternal.map((t) => ({ ...t })),
    challenges: (tracker.challenges || []).map((c) => ({ ...c })),
    risks: (tracker.risks || []).map((r) => ({ ...r })),
    scorecard: (store.settings && store.settings.scorecard) || [],
    displayNames: (store.settings && store.settings.displayNames) || {},
  };
}

// engine emits percentages as 0-100 numbers (1 decimal), not fractions.
function fmtPct(x) { return x == null ? '—' : (Math.round(x * 10) / 10) + '%'; }

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
  const kpi = model.kpi;

  /* ---------- Preview machinery ---------- */
  const scaleEl = el('div', { class: 'preview-scale' });
  const viewport = el('div', { class: 'preview-viewport', style: 'position:relative;overflow:hidden' }, [scaleEl]);
  const previewHead = el('div', { class: 'preview-frame__head' }, [
    el('div', { class: 'card__title', style: 'margin:0', text: STR.review.previewTitle }),
    el('span', { class: 'small muted', text: STR.review.variantsNote }),
  ]);
  const previewFrame = el('div', { class: 'preview-frame' }, [previewHead, viewport]);

  let renderToken = 0;
  function applyScale() {
    const avail = viewport.clientWidth || 320;
    const scale = Math.min(1, avail / 1280);
    scaleEl.style.transform = `scale(${scale})`;
    scaleEl.style.transformOrigin = 'top right';
    requestAnimationFrame(() => {
      const h = scaleEl.scrollHeight * scale;
      // Guard: setting height retriggers the ResizeObserver — only write real changes
      // to break the resize feedback loop.
      if (h > 0 && Math.abs(h - (parseFloat(viewport.style.height) || 0)) > 1) {
        viewport.style.height = h + 'px';
      }
    });
  }

  async function renderPreview() {
    const token = ++renderToken;
    model.reportDate = state.reportDate;
    const specMod = await tryImport('../slidespec/build-spec.js');
    const buildSpec = pickFn(specMod, ['buildSpec', 'build', 'makeSpec', 'toSpec']);
    const rendMod = await tryImport('../render/html-renderer.js');
    const renderFn = pickFn(rendMod, ['renderSpec', 'renderSlides', 'renderHtml', 'render']);

    if (!buildSpec || !renderFn) {
      scaleEl.innerHTML = '';
      viewport.style.height = 'auto';
      viewport.appendChild(el('div', { class: 'preview-placeholder', text: STR.review.previewMissing }));
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
  }

  let debTimer = null;
  const schedulePreview = () => { clearTimeout(debTimer); debTimer = setTimeout(renderPreview, 260); };

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
    { key: 'dueDate', label: STR.review.colDate, type: 'text', width: '110px' },
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
  const tasksInternalCard = el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: STR.review.tasksInternalTitle }),
    editableTable({
      columns: taskCols, rows: model.tasksInternal, minWidth: '520px', newRow: newTask,
      onChange: (rows) => { model.tasksInternal = rows; schedulePreview(); },
    }),
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

  // KPI readout (read-only)
  const b = kpi.buckets || {};
  const ta = kpi.turnaround || {};
  const delta = (kpi.deltas && kpi.deltas.completed) || 0;
  const kpiItems = [
    { label: STR.review.kpi.total, value: (kpi.totals && kpi.totals.total) ?? '—' },
    { label: STR.review.kpi.completed, value: b.completed ?? '—', delta: delta > 0 ? '+' + delta : '' },
    { label: STR.review.kpi.awaitingResults, value: b.awaitingResults ?? '—' },
    { label: STR.review.kpi.rejected, value: b.rejected ?? '—' },
    { label: STR.review.kpi.late, value: b.lateNoResult ?? '—' },
    { label: STR.review.kpi.latePct, value: fmtPct(b.latePct) },
    { label: STR.review.kpi.turnaround, value: `${ta.overallActual ?? '—'} / ${ta.overallExpected ?? '—'} ${STR.review.kpi.days}` },
  ];
  const kpiCard = el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: STR.review.kpiTitle }),
    el('div', { class: 'kpi-list' }, kpiItems.map((k) => el('div', { class: 'kpi-item' }, [
      el('div', { class: 'kpi-item__label', text: k.label }),
      el('div', { class: 'kpi-item__value' }, [
        document.createTextNode(String(k.value)),
        k.delta ? el('span', { class: 'delta', text: k.delta }) : null,
      ]),
    ]))),
  ]);

  const generateBtn = el('div', { class: 'sticky-actions' }, [
    el('button', {
      class: 'btn btn--primary btn--block', text: STR.review.generate,
      onClick: () => {
        model.reportDate = state.reportDate; // beat the 260ms preview debounce
        // Settings edited after the model was drafted (scorecard, display names)
        // must reach the generated files.
        const s = store.settings || {};
        model.scorecard = s.scorecard || model.scorecard;
        model.displayNames = s.displayNames || model.displayNames;
        state.reportModel = model;
        navigate('generate');
      },
    }),
  ]);

  const controls = el('div', { class: 'review-controls' }, [
    dateField, kpiCard, panelsCard, tasksCurrentCard, tasksInternalCard, challengesCard, risksCard, generateBtn,
  ]);
  const preview = el('div', { class: 'review-preview' }, [previewFrame]);

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
