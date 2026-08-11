// ui/automation-panel.js — the VISIBLE '⚡ التشغيل التلقائي' card (Track 2).
//
// Lives in the main upload flow (directly under the data-source cards), never
// buried in Settings. Renders a master switch + one labelled toggle per
// automation option, a '▶ تشغيل الآن' run button with live per-step progress,
// and download links for whatever the run produced.
//
// The pipeline module (../automation/pipeline.js) is imported DYNAMICALLY and
// guarded: if it is absent the card still renders and the toggles still
// persist — only the run button is disabled with a muted note. Nothing here
// ever throws into the caller.
//
// The card also ATTACHES to the ?auto= run bus main.js publishes
// (window.__misbarAutoRun / misbar:autorun / misbar:autodone — AUTOMATION.md §4)
// so an unattended run paints its progress here and its produced files get
// download rows. It never starts a second run on top of one it can see.
import { el, toast, progressBar } from './components.js?v=v2026-08-11.1';
import { triggerDownload } from './late-labs-section.js?v=v2026-08-11.1';

const PIPELINE_URL = '../automation/pipeline.js?v=v2026-08-11.1';
const SHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ---- the ?auto= run bus published by main.js (AUTOMATION.md §4) ---------- */
const BUS_KEY = '__misbarAutoRun';
const BUS_ANNOUNCE = 'misbar:autorun';  // detail = the bus (fires once at start)
const BUS_DONE = 'misbar:autodone';     // detail = { ok, result, error }

/** True once the on-mount auto-pull has fired. MODULE scope on purpose: the
 *  host screen rebuilds this panel on every render (navigate/rerender), so a
 *  per-instance flag would re-run the whole pipeline on every visit. */
let AUTO_STARTED = false;

/** Only the most recently built panel consumes the announce event. The window
 *  listener is bound ONCE and dispatches to this, so the per-render rebuilds of
 *  the card never stack one dead listener per mount. */
let ACTIVE_ATTACH = null;
let ANNOUNCE_BOUND = false;

function liveBus() {
  try { return (typeof window !== 'undefined') ? window[BUS_KEY] : null; } catch { return null; }
}

function bindAnnounce() {
  if (ANNOUNCE_BOUND || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  ANNOUNCE_BOUND = true;
  window.addEventListener(BUS_ANNOUNCE, (e) => {
    try { if (ACTIVE_ATTACH) ACTIVE_ATTACH(e && e.detail); } catch (err) { console.warn('[automation] bus attach failed', err); }
  });
}

/** Pipeline sentinel for "a run is already in flight" — never shown raw. */
const BUSY_SENTINEL = 'already-running';
/** Raw pipeline sentinels must never reach the all-Arabic UI. */
const ERROR_TEXT = { [BUSY_SENTINEL]: 'هناك تشغيل جارٍ بالفعل — تابع تقدّمه أدناه.' };
const humanError = (e) => {
  const s = String(e);
  // hasOwnProperty: an error string of 'toString'/'constructor' must not pick
  // up an inherited member.
  return Object.prototype.hasOwnProperty.call(ERROR_TEXT, s) ? ERROR_TEXT[s] : s;
};

/** True only for the pipeline's bare "a run is already in flight" refusal. */
function isBusyResult(res) {
  return !!res && res.ok === false
    && !((res.steps || []).length)
    && (res.errors || []).length === 1
    && String(res.errors[0]) === BUSY_SENTINEL;
}

/** Local mirror of pipeline.js AUTOMATION_DEFAULTS — used until (or instead of)
 *  the real module resolves, so the card is fully usable on its own. */
const FALLBACK_DEFAULTS = Object.freeze({
  enabled: false, autoPull: false, autoGenerate: false, autoDownload: false,
  autoLabFiles: false, autoEmailDrafts: false, autoAcceptTat: false, dailyTime: '08:00',
});

/** Local mirror of pipeline.js AUTOMATION_STEPS — the fallback step list. */
const FALLBACK_STEPS = ['pull', 'engine', 'generate', 'labs', 'emails'];

/** The six boolean action options, in display order. */
const OPTION_ROWS = [
  { key: 'autoPull', label: 'سحب البيانات', desc: 'سحب البيانات تلقائياً عند فتح الصفحة' },
  { key: 'autoGenerate', label: 'توليد التقارير', desc: 'توليد التقارير الأربعة تلقائياً بعد جاهزية البيانات' },
  { key: 'autoDownload', label: 'تنزيل الملفات', desc: 'تنزيل الملفات تلقائياً بعد التوليد' },
  { key: 'autoLabFiles', label: 'ملفات المختبرات', desc: 'تجهيز ملفات المختبرات المتأخرة (Excel) تلقائياً' },
  // '(.eml)' is wrapped in U+2066…U+2069 (LRI…PDI): the '.' is a neutral between an
  // Arabic run and the Latin 'eml', so at the RTL paragraph level it lands AFTER the
  // letters and the group renders '(eml.)'. The isolate pins it to '(.eml)'.
  { key: 'autoEmailDrafts', label: 'مسودات البريد', desc: 'إنشاء مسودات بريد ⁦(.eml)⁩ لكل مختبر — لا يتم الإرسال تلقائياً أبداً' },
  // NOTE: pipeline.js acceptSuggestedTats() applies EVERY suggestion with a
  // value — it does not read `confidence` — so the label must not promise a
  // high-confidence-only filter.
  { key: 'autoAcceptTat', label: 'اعتماد مدد الفحص', desc: 'اعتماد جميع مقترحات مدة الفحص المحسوبة تلقائياً — تُحفظ في الإعدادات دون مراجعة' },
];
const OPTION_KEYS = OPTION_ROWS.map((r) => r.key);

/** Arabic label per pipeline step id (unknown ids fall back to the raw id). */
const STEP_LABELS = {
  pull: 'سحب البيانات',
  engine: 'تشغيل المحرك',
  generate: 'توليد التقارير',
  labs: 'ملفات المختبرات',
  emails: 'مسودات البريد',
};

/** Per-status glyph + colour token (light literal fallback for dark-theme safety). */
const STATUS_VIEW = {
  idle: { glyph: '⏳', color: 'var(--slate-500,#64748B)' },
  start: { glyph: '⏳', color: 'var(--info-text,#1D4ED8)' },
  done: { glyph: '✓', color: 'var(--good-text,#15803D)' },
  skip: { glyph: '⤼', color: 'var(--slate-500,#64748B)' },
  error: { glyph: '✗', color: 'var(--bad-text,#B91C1C)' },
};
const STATUS_TEXT = { idle: '', start: 'جارٍ التنفيذ…', done: 'تم', skip: 'تخطّي', error: 'فشل' };

/* ---- weekly-report schedule: READ-ONLY note ------------------------------ */
// ONE weekly report, on THURSDAY (Talal, 2026-08-05 — was Sunday + Thursday).
// Thursday is the LAST business day of the Saudi work week (Sun–Thu; weekend =
// Friday + Saturday), so a Thursday run closes the whole just-ended week — the
// same Sunday..report-day window the green delta chips now count activity over.
// The REAL schedule is the launchd agent com.misbar.weekly-report
// (scripts/com.misbar.weekly-report.plist.template, AUTOMATION.md §3) — a web
// page cannot install a LaunchAgent, so this is a label plus the command to
// copy, never an in-page scheduler. No toggle, no persisted key: nothing here
// can drift out of sync with the installed agent.
const WEEKLY_DAYS_TEXT = 'التقرير الأسبوعي: كل خميس';
const WEEKLY_INSTALL_CMD = 'bash scripts/misbar-automation-install.sh weekly on 08:15';

function weeklyScheduleNote() {
  return el('div', {
    // --bg-light is the app's 'raised inner surface' token (light #F8FAFC,
    // dark #26324A), so the note reads as a panel inside the card in both themes.
    style: 'margin-top:10px;padding:9px 11px;border-radius:var(--radius-sm,8px);'
      + 'background:var(--bg-light,#F8FAFC);border:1px solid var(--border,#E2E8F0)',
  }, [
    el('div', {
      style: 'font-weight:700;font-size:.9rem;color:var(--text,#1E293B);line-height:1.4',
      text: `🗓 ${WEEKLY_DAYS_TEXT}`,
    }),
    el('div', {
      style: 'font-size:.78rem;color:var(--slate-500,#64748B);margin-top:3px;line-height:1.45',
      text: 'الجدولة الفعلية تتم عبر مهمة الماك، لا من هذه الصفحة. للتفعيل من الطرفية:',
    }),
    // dir=ltr: a shell command with digits inside RTL text (house rule).
    el('code', {
      dir: 'ltr',
      style: 'display:block;margin-top:5px;font-size:.72rem;overflow-wrap:anywhere;'
        + 'color:var(--brand-ink,#1E3A8A);font-weight:600',
      text: WEEKLY_INSTALL_CMD,
    }),
  ]);
}

/**
 * Build the automation card.
 * @param {{store:Object, state:Object, ctx:Object}} o
 * @returns {HTMLElement} the card node; carries a `.refresh()` method the host
 *   screen may call whenever data lands so the run button re-evaluates.
 */
export function buildAutomationPanel({ store, state, ctx } = {}) {
  let pipeline = null;      // resolved module (or null when absent)
  let defaults = FALLBACK_DEFAULTS;
  let steps = FALLBACK_STEPS.slice();
  let loading = true;       // dynamic import still in flight
  let running = false;      // concurrent-run guard (mirrors the pipeline's own)
  let aborter = null;       // AbortController for the in-flight run

  /* ---------------- persistence (canonical store path) ---------------- */

  // Read → merge over defaults so every key exists even when Track 3's
  // settings.automation (schema v4) is not present yet.
  function readOpts() {
    let saved = null;
    try {
      const s = (store && store.settings) || {};
      if (s.automation && typeof s.automation === 'object') saved = s.automation;
    } catch (e) { console.warn('[automation] settings read failed', e); }
    return { ...defaults, ...(saved || {}) };
  }

  // Write through loadSettings → mutate → saveSettings, the same path
  // screen-review uses to persist reportOptions.
  function writeOpts(patch) {
    try {
      const doc = (typeof store.loadSettings === 'function') ? store.loadSettings() : store.settings;
      if (!doc || typeof doc !== 'object') return;
      const cur = (doc.automation && typeof doc.automation === 'object') ? doc.automation : {};
      doc.automation = { ...defaults, ...cur, ...patch };
      if (typeof store.saveSettings === 'function') store.saveSettings(doc);
      if (state) state.settings = store.settings;
    } catch (e) {
      console.warn('[automation] settings save failed', e);
    }
  }

  /* ---------------- toggles ---------------- */

  const rowRefs = []; // { key, input, row }

  function toggleRow({ key, label, desc, master }) {
    const input = el('input', { type: 'checkbox' });
    input.style.cssText = 'width:20px;height:20px;flex:0 0 auto;margin-top:2px;accent-color:var(--navy,#1E3A8A);cursor:pointer';
    input.checked = !!readOpts()[key];
    input.addEventListener('change', () => {
      writeOpts({ [key]: input.checked });
      if (master) syncSubState();
      syncRun();
    });
    const row = el('label', {
      class: 'automation-opt',
      style: 'display:flex;align-items:flex-start;gap:10px;padding:9px 2px;cursor:pointer;'
        + (master ? '' : 'border-top:1px solid var(--border,#E2E8F0);'),
    }, [
      input,
      el('div', { style: 'min-width:0;flex:1' }, [
        el('div', {
          style: `font-weight:${master ? '800' : '700'};font-size:${master ? '1rem' : '.94rem'};color:var(--text,#1E293B);line-height:1.35`,
          text: label,
        }),
        el('div', {
          style: 'font-size:.8rem;color:var(--slate-500,#64748B);margin-top:2px;line-height:1.4',
          text: desc,
        }),
      ]),
    ]);
    rowRefs.push({ key, input, row, master: !!master });
    return row;
  }

  const masterRow = toggleRow({
    key: 'enabled', label: 'تفعيل التشغيل التلقائي', master: true,
    desc: 'المفتاح الرئيسي — عند إيقافه لا يعمل أي خيار أدناه تلقائياً.',
  });
  const subRows = OPTION_ROWS.map((o) => toggleRow(o));

  /** Dim + aria-disable the sub-toggles while the master switch is off. */
  function syncSubState() {
    const on = !!readOpts().enabled;
    for (const r of rowRefs) {
      if (r.master) continue;
      r.input.disabled = !on;
      r.row.setAttribute('aria-disabled', on ? 'false' : 'true');
      r.row.style.opacity = on ? '1' : '.5';
      r.row.style.cursor = on ? 'pointer' : 'not-allowed';
    }
  }

  /* ---------------- live progress ---------------- */

  const stepHost = el('div', { style: 'display:none;margin-top:10px' });
  const bar = progressBar();
  bar.el.style.display = 'none';
  // A run walks five steps over tens of seconds. Wrapping the bar + step list in
  // a polite live region is what makes each transition ('جارٍ التنفيذ…' → 'تم')
  // audible; the glyphs themselves are aria-hidden, the text beside them is not.
  const liveHost = el('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' }, [bar.el, stepHost]);
  const filesHost = el('div');
  const errorsHost = el('div');
  const stepNodes = new Map(); // id -> { icon, state }

  function buildStepList() {
    stepHost.innerHTML = '';
    stepNodes.clear();
    for (const id of steps) {
      const icon = el('span', {
        style: `flex:0 0 auto;width:18px;text-align:center;font-weight:800;color:${STATUS_VIEW.idle.color}`,
        text: STATUS_VIEW.idle.glyph, 'aria-hidden': 'true',
      });
      const stateEl = el('span', { style: 'font-size:.8rem;color:var(--slate-500,#64748B)' });
      const node = el('div', {
        style: 'display:flex;align-items:center;gap:8px;padding:5px 2px;font-size:.9rem;color:var(--text,#1E293B)',
      }, [
        icon,
        el('span', { style: 'flex:1;min-width:0', text: STEP_LABELS[id] || id }),
        stateEl,
      ]);
      stepNodes.set(id, { icon, stateEl });
      stepHost.appendChild(node);
    }
  }

  function setStep(id, status, message) {
    const n = stepNodes.get(id);
    if (!n) return;
    const v = STATUS_VIEW[status] || STATUS_VIEW.idle;
    n.icon.textContent = v.glyph;
    n.icon.style.color = v.color;
    n.stateEl.textContent = message || STATUS_TEXT[status] || '';
    n.stateEl.style.color = (status === 'error') ? 'var(--bad-text,#B91C1C)' : 'var(--slate-500,#64748B)';
  }

  function resetProgress() {
    buildStepList();
    stepHost.style.display = '';
    bar.el.style.display = '';
    bar.set(0, 'جارٍ البدء…');
    filesHost.innerHTML = '';
    errorsHost.innerHTML = '';
  }

  /* ---------------- produced files ---------------- */

  function fileRow(name, blob) {
    return el('div', { class: 'dl-link', style: 'flex-wrap:wrap;gap:8px' }, [
      // dir=ltr keeps '….xlsx' / '….eml' glued after the Arabic+digits stem; text-align
      // :right keeps that LTR-ordered name at the row's RTL start edge (flex:1 stretches
      // the box, and ltr alone left-aligned it against the buttons).
      el('span', { dir: 'ltr', style: 'font-weight:600;overflow-wrap:anywhere;flex:1;min-width:0;text-align:right', text: name }),
      el('button', {
        class: 'btn btn--ghost btn--sm', text: '⬇ تنزيل',
        onClick: () => triggerDownload(blob, name),
      }),
    ]);
  }

  function renderFiles(res) {
    filesHost.innerHTML = '';
    const items = [];
    for (const f of (res.files || [])) {
      if (f && f.blob) items.push({ name: f.name || 'report', blob: f.blob });
    }
    for (const f of (res.labFiles || [])) {
      if (f && f.bytes) items.push({ name: f.fileName || `${f.lab || 'lab'}.xlsx`, blob: new Blob([f.bytes], { type: SHEET_MIME }) });
    }
    for (const d of (res.drafts || [])) {
      if (d && d.blob) items.push({ name: d.fileName || `${d.lab || 'lab'}.eml`, blob: d.blob });
    }
    if (!items.length) return;
    filesHost.appendChild(el('div', {
      style: 'margin-top:12px;font-weight:800;font-size:.92rem;color:var(--brand-ink,#1E3A8A);display:flex;align-items:center;gap:6px',
    }, [
      el('span', { text: 'الملفات الناتجة' }),
      el('span', { dir: 'ltr', style: 'color:var(--slate-500,#64748B);font-weight:700', text: `(${items.length})` }),
    ]));
    const list = el('div', { class: 'dl-links' }, items.map((i) => fileRow(i.name, i.blob)));
    filesHost.appendChild(list);
    if (items.length > 1) {
      filesHost.appendChild(el('button', {
        class: 'btn btn--ghost btn--block', style: 'margin-top:8px', text: '⬇ تنزيل الكل',
        // Sequential ~300ms apart so browsers don't drop stacked clicks (same
        // pacing as the late-labs section's تنزيل الكل).
        onClick: async () => {
          for (let i = 0; i < items.length; i++) {
            triggerDownload(items[i].blob, items[i].name);
            if (i < items.length - 1) await new Promise((r) => setTimeout(r, 300));
          }
        },
      }));
    }
  }

  function renderErrors(list) {
    errorsHost.innerHTML = '';
    // humanError(): pipeline sentinels ('already-running') are machine strings —
    // never let one land raw in an otherwise all-Arabic list.
    const errs = (list || []).filter(Boolean).map(humanError);
    if (!errs.length) return;
    errorsHost.appendChild(el('ul', { class: 'notelist', style: 'margin-top:10px' },
      errs.slice(0, 12).map((e) => el('li', { class: 'err', text: e }))));
  }

  /* ---------------- run / stop ---------------- */

  const runBtn = el('button', { class: 'btn btn--primary', text: '▶ تشغيل الآن', disabled: true });
  const stopBtn = el('button', { class: 'btn btn--ghost', text: '⏹ إيقاف' });
  stopBtn.style.display = 'none';
  const runNote = el('p', { class: 'small muted', style: 'margin:8px 0 0' });

  function hasData() {
    try {
      const o = state && state.parsed && state.parsed.orders;
      return Array.isArray(o) && o.length > 0;
    } catch { return false; }
  }

  /** Enable/disable '▶ تشغيل الآن' and paint its hint. */
  function syncRun() {
    if (running) { runBtn.disabled = true; return; }
    const o = readOpts();
    if (loading) {
      runBtn.disabled = true;
      runNote.textContent = 'جارٍ تحميل وحدة التشغيل التلقائي…';
      return;
    }
    if (!pipeline) {
      runBtn.disabled = true;
      runNote.textContent = 'وحدة التشغيل التلقائي غير متوفرة — الخيارات أعلاه محفوظة وستعمل فور توفّرها.';
      return;
    }
    // The master switch is what the six sub-toggles are visibly gated on
    // (syncSubState disables them, dims the rows, sets aria-disabled). The run
    // button must obey the same gate — a click may never execute options the
    // user is looking at in their disabled state.
    if (!o.enabled) {
      runBtn.disabled = true;
      runNote.textContent = 'فعّل المفتاح الرئيسي أولاً، ثم اختر الخطوات المطلوبة.';
      return;
    }
    if (!OPTION_KEYS.some((k) => !!o[k])) {
      runBtn.disabled = true;
      runNote.textContent = 'اختر خطوة واحدة على الأقل من الخيارات أعلاه.';
      return;
    }
    if (!hasData() && !o.autoPull) {
      runBtn.disabled = true;
      runNote.textContent = 'لا توجد بيانات بعد — فعّل «سحب البيانات» أو أدرج ملف الطلبات أولاً.';
      return;
    }
    runBtn.disabled = false;
    runNote.textContent = 'التشغيل الآن ينفّذ الخطوات المفعّلة أعلاه فقط.';
  }

  /**
   * Options for a MANUAL '▶ تشغيل الآن': EXACTLY what is checked on screen.
   * Nothing is ever synthesized — syncRun() keeps the button disabled until the
   * master switch is on and at least one step is ticked, so a click can never
   * silently turn on تنزيل الملفات or اعتماد مدد الفحص (which writes to
   * settings.tatLookup) on the user's behalf.
   */
  function manualOptions() {
    return { ...readOpts(), enabled: true };
  }

  function setRunning(on) {
    // Hiding the focused button drops focus to <body>; a keyboard user would
    // have to tab through the whole app to reach '⏹ إيقاف'. Move focus with the
    // swap — but only when it was already inside this card, so a background run
    // never steals focus from elsewhere on the page.
    const hadFocus = !!(card && card.contains && card.contains(document.activeElement));
    running = on;
    runBtn.style.display = on ? 'none' : '';
    stopBtn.style.display = on ? '' : 'none';
    syncRun();
    if (hadFocus) {
      const next = on ? stopBtn : runBtn;
      try { if (!next.disabled) next.focus(); } catch { /* focus is best-effort */ }
    }
  }

  async function doRun(options) {
    if (running || !pipeline || typeof pipeline.runAutomation !== 'function') return;
    setRunning(true);
    resetProgress();
    aborter = (typeof AbortController === 'function') ? new AbortController() : null;
    let res = null;
    try {
      res = await pipeline.runAutomation({
        store, state, ctx, options,
        signal: aborter ? aborter.signal : undefined,
        onEvent: (ev) => {
          if (!ev || !ev.step) return;
          setStep(ev.step, ev.status, ev.message);
          if (typeof ev.pct === 'number') bar.set(ev.pct, ev.message || '');
          else if (ev.message) bar.set(0, ev.message);
        },
      });
    } catch (e) {
      console.error('[automation] run failed', e);
      renderErrors([(e && e.message) || String(e)]);
      bar.set(100, 'توقّف التشغيل');
      toast('تعذّر إكمال التشغيل التلقائي', 'err');
      setRunning(false);
      aborter = null;
      return;
    }
    aborter = null;
    setRunning(false);
    if (!res || typeof res !== 'object') { bar.set(100, 'انتهى'); return; }
    // The pipeline refused because something else already holds its RUNNING
    // guard (typically main.js's ?auto= run, which shares this module). That is
    // not a failure — mirror the real run instead of painting a fake one.
    if (isBusyResult(res)) {
      const live = liveBus();
      if (live && live.running) { attachBus(live); return; }
      bar.set(100, ERROR_TEXT[BUSY_SENTINEL]);
      toast(ERROR_TEXT[BUSY_SENTINEL], 'warn');
      return;
    }
    // Backfill any step the pipeline never reported so no row is left spinning.
    for (const s of (res.steps || [])) {
      if (s && s.id) setStep(s.id, s.status, s.message);
    }
    bar.set(100, res.ok ? 'اكتمل التشغيل التلقائي ✓' : 'انتهى مع تنبيهات');
    renderFiles(res);
    renderErrors(res.errors);
    toast(res.ok ? 'اكتمل التشغيل التلقائي' : 'انتهى التشغيل مع تنبيهات', res.ok ? 'ok' : 'warn');
  }

  runBtn.addEventListener('click', () => { doRun(manualOptions()); });
  stopBtn.addEventListener('click', () => {
    if (aborter) { try { aborter.abort(); } catch { /* already aborted */ } }
    bar.set(100, 'تم طلب الإيقاف…');
    stopBtn.disabled = true;
    setTimeout(() => { stopBtn.disabled = false; }, 1500);
  });

  /* ---------------- external run bus (?auto=… launched by main.js) ---------------- */

  // A URL-triggered run publishes a replay-capable bus on window and announces
  // it once. Without attaching, the card sits idle with an enabled '▶ تشغيل
  // الآن' during a live run — and the click would only be refused by the
  // pipeline's own concurrent-run guard. Attaching works in either order: the
  // bus may already exist when the card is built, or arrive with the announce.
  // (BUS_KEY / BUS_ANNOUNCE / BUS_DONE are module-level.)
  let busUnsub = null;   // non-null only while mirroring an external run

  /** Settle the mirrored run. Idempotent — done event and promise may both land. */
  function finishBusRun(detail) {
    if (!busUnsub) return;
    try { busUnsub(); } catch { /* already gone */ }
    busUnsub = null;
    try { window.removeEventListener(BUS_DONE, onBusDone); } catch { /* no window */ }
    aborter = null;
    setRunning(false);
    const d = (detail && typeof detail === 'object') ? detail : {};
    const res = (d.result && typeof d.result === 'object') ? d.result : null;
    // Backfill any step the pipeline never reported so no row is left spinning.
    for (const s of ((res && res.steps) || [])) {
      if (s && s.id) setStep(s.id, s.status, s.message);
    }
    bar.set(100, d.ok ? 'اكتمل التشغيل التلقائي ✓' : 'انتهى مع تنبيهات');
    if (res) renderFiles(res);
    const errs = ((res && res.errors) || []).slice();
    if (d.error) errs.push((d.error && d.error.message) || String(d.error));
    renderErrors(errs);
    // No toast here: main.js already toasts the outcome of its own run.
  }

  function onBusDone(e) { finishBusRun(e && e.detail); }

  /** Mirror an external run into the card's own progress UI. */
  function attachBus(bus) {
    if (busUnsub || running) return;
    if (!bus || typeof bus.subscribe !== 'function') return;
    // Already settled — the card was rebuilt after the run finished (a walk
    // back to رفع البيانات). Replay it so the produced workbooks and drafts,
    // which live only in the result, still get their download rows.
    if (!bus.running) {
      if (!bus.result && !bus.error) return;
      resetProgress();
      for (const ev of (Array.isArray(bus.events) ? bus.events : [])) {
        if (ev && ev.step) setStep(ev.step, ev.status, ev.message);
      }
      busUnsub = () => {};   // finishBusRun() is a no-op guard otherwise
      finishBusRun({ ok: !bus.error && !!(bus.result && bus.result.ok), result: bus.result, error: bus.error });
      return;
    }
    resetProgress();
    setRunning(true);
    // '⏹ إيقاف' must drive the run that is actually in flight.
    aborter = (typeof bus.abort === 'function') ? { abort: () => bus.abort() } : null;
    const un = bus.subscribe((ev) => {
      if (!ev || !ev.step) return;
      setStep(ev.step, ev.status, ev.message);
      if (typeof ev.pct === 'number') bar.set(ev.pct, ev.message || '');
      else if (ev.message) bar.set(0, ev.message);
    });
    busUnsub = (typeof un === 'function') ? un : () => {};
    try { window.addEventListener(BUS_DONE, onBusDone); } catch { /* no window */ }
    // Fallback for engines where CustomEvent is unavailable: settle off the
    // run promise when the bus already carries one (late attach, mid-run).
    if (bus.promise && typeof bus.promise.then === 'function') {
      const settle = () => finishBusRun({
        ok: !bus.error && !!(bus.result && bus.result.ok), result: bus.result, error: bus.error,
      });
      bus.promise.then(settle, settle);
    }
  }

  /* ---------------- assemble ---------------- */

  const card = el('div', { class: 'card', style: 'border-top:3px solid var(--blue,#2563EB)' }, [
    el('div', { class: 'card__title', text: '⚡ التشغيل التلقائي' }),
    el('p', {
      class: 'small muted', style: 'margin:0 0 8px',
      text: 'شغّل خطوات التقرير كاملةً بضغطة واحدة، أو فعّل الخطوات التي تريدها لتعمل تلقائياً. جميع الخيارات معطّلة افتراضياً، ولا يتم إرسال أي بريد تلقائياً.',
    }),
    masterRow,
    el('div', { style: 'margin-top:2px' }, subRows),
    weeklyScheduleNote(),
    el('div', {
      style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--border,#E2E8F0)',
    }, [runBtn, stopBtn]),
    runNote,
    liveHost,
    filesHost,
    errorsHost,
  ]);

  syncSubState();
  syncRun();

  // Let the host screen re-evaluate the run button when data lands.
  card.refresh = () => { syncRun(); };

  // Attach to a URL-triggered run: synchronously for a bus that is already up
  // (card rebuilt mid-run), and via the one-shot announce for the usual boot
  // order (the card is rendered before the trigger resolves its import).
  // Only THIS panel (the newest one) receives the announce: the window listener
  // is module-level and bound once, so the per-render rebuilds never stack.
  try {
    ACTIVE_ATTACH = attachBus;
    bindAnnounce();
    attachBus(liveBus());
  } catch (e) { console.warn('[automation] progress bus attach failed', e); }

  // Guarded dynamic import: a missing pipeline module degrades to a
  // toggles-only card, never an exception.
  (async () => {
    let mod = null;
    try { mod = await import(PIPELINE_URL); } catch { mod = null; }
    loading = false;
    if (mod && typeof mod.runAutomation === 'function') {
      pipeline = mod;
      if (mod.AUTOMATION_DEFAULTS && typeof mod.AUTOMATION_DEFAULTS === 'object') defaults = mod.AUTOMATION_DEFAULTS;
      if (Array.isArray(mod.AUTOMATION_STEPS) && mod.AUTOMATION_STEPS.length) steps = mod.AUTOMATION_STEPS.slice();
    }
    syncSubState();
    syncRun();
    // Honour 'سحب البيانات تلقائياً عند فتح الصفحة' — only ever when the user
    // has switched both the master and autoPull on (defaults are all off), and
    // only ONCE per page load:
    //   • AUTO_STARTED is module-level because the host screen rebuilds this
    //     card on every navigate()/rerender(), and a per-instance flag would
    //     re-pull, re-generate and re-download on every visit to رفع البيانات;
    //   • a live bus means main.js's ?auto= run already owns the pipeline's
    //     RUNNING guard — starting a second run just collides and paints a fake
    //     'already-running' failure over a run that is actually succeeding;
    //   • hasData() means there is nothing to pull, so a remount after the data
    //     landed never restarts the pipeline.
    const o = readOpts();
    const live = liveBus();
    if (AUTO_STARTED || running || busUnsub || (live && live.running) || hasData()) return;
    if (pipeline && o.enabled && o.autoPull) {
      AUTO_STARTED = true;
      doRun(o);
    }
  })();

  return card;
}

export default buildAutomationPanel;
