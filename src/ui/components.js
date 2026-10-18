// ui/components.js — shared DOM helpers used by Track E screens.
import { STR, formatDateAr } from '../i18n/ar.js?v=v2026-10-18.3';
// The project tracker document's OWNER (shape, tag, due-date rule, new-row factory). STATIC,
// like scope.js / hospital.js elsewhere: the module is pure (SheetJS is injected, never
// imported), and the editor below must apply the parser's own rules — a website-typed
// '17/9/2026' has to become the same ISO date a file cell does, or the slide's overdue
// test would treat the two differently.
// It also owns the slide-language enum (reportOptions.trackerLang) the store validates.
import {
  isProjectTracker, newTask as blankTrackerTask, normalizeDueText, TRACKER_FORMAT,
  TRACKER_LANGS, DEFAULT_TRACKER_LANG, normalizeTrackerLang as parseTrackerLang,
} from '../ingest/task-tracker.js?v=v2026-10-18.3';
// ONE status rule for the editor pill, the upload card's counts and the deck (2026-10-18):
// model/tracker-status.js owns the alias table (English as the workbook writes it,
// 'Deleyed' included, plus the Arabic words) AND the overdue rule (not Completed + due before
// the report date → «متأخر»; «متوقف» stays «متوقف»). The deck's task slides read it, so the
// app must too — otherwise the website would show «معلّق» or a raw «قيد التنفيذ» for a task
// the deck prints as «متوقف» / «متأخر». Pure; no imports.
import {
  baseStatus, effectiveStatus, STATUS_KEYS, STATUS_AR,
} from '../model/tracker-status.js?v=v2026-10-18.3';
// AUTOMATIC ARABIC (2026-10-13, CONTRACT-AUTO §1): the translation memory's ONE set of rules
// — the lookup key, the layer precedence (file > user > built-in > machine), the user-TM
// edits, the machine cache + glossary, the counts. Pure (no DOM, no storage, no imports), so
// the screens, the automation and the node tests apply the very same rules.
import {
  applyTrackerTranslations, setUserTranslation, setOriginal, addMachineTranslations,
  trackerTranslationStats, collectUntranslated, normEn, TM_MAX_CHARS,
  // «ترجمة الأسماء» (2026-10-18): every distinct owner / entity name part with its Arabic.
  trackerNameEntries,
} from '../model/tracker-translate.js?v=v2026-10-18.3';

/** Tiny hyperscript helper. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && k !== 'list' && typeof v !== 'boolean') {
      try { node[k] = v; } catch { node.setAttribute(k, v); }
    } else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/**
 * File drop zone with drag-drop AND tap-to-pick.
 * @param {{title:string, hint:string, accept:string, onFile:(f:File)=>void}} o
 */
export function dropZone({ title, hint, accept, onFile }) {
  const input = el('input', { type: 'file', accept });
  const iconEl = el('div', { class: 'dropzone__icon', text: '📄' });
  const titleEl = el('div', { class: 'dropzone__title', text: title });
  const hintEl = el('div', { class: 'dropzone__hint', text: hint });
  const fileEl = el('div', { class: 'dropzone__file', dir: 'ltr' }); // filenames mix AR+digits+'.ext' — isolate LTR
  // A rejection's own message, inside the zone (the errors card further down repeats it).
  const errorEl = el('div', { class: 'dropzone__error', hidden: true });

  const zone = el('label', { class: 'dropzone' }, [iconEl, titleEl, hintEl, fileEl, errorEl, input]);
  const clearError = () => { errorEl.textContent = ''; errorEl.hidden = true; };

  const pick = (f) => { if (f) { fileEl.textContent = f.name; onFile(f); } };

  input.addEventListener('change', () => pick(input.files && input.files[0]));

  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-drag'); }));
  ['dragleave', 'dragend'].forEach((ev) =>
    zone.addEventListener(ev, () => zone.classList.remove('is-drag')));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-drag');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    pick(f);
  });

  return {
    el: zone,
    setLoaded(name) { clearError(); fileEl.dir = 'ltr'; zone.classList.remove('is-error'); zone.classList.add('is-loaded'); iconEl.textContent = '✓'; iconEl.style.color = 'var(--green)'; iconEl.style.fontWeight = '800'; if (name) fileEl.textContent = name; },
    /** `message` shows inside the zone; `fileLine` (when given) replaces the picked file's
     *  name — a rejected file must not read as the loaded one (e.g. «still using: …»). */
    setError(message, fileLine) {
      zone.classList.remove('is-loaded'); zone.classList.add('is-error'); iconEl.textContent = '⚠️';
      if (message) { errorEl.textContent = message; errorEl.hidden = false; } else clearError();
      if (fileLine !== undefined) { fileEl.textContent = fileLine || ''; fileEl.dir = 'auto'; } // an Arabic note, not a bare name
    },
    setBusy(busy) { hintEl.textContent = busy ? STR.upload.parsing : hint; },
    reset() { clearError(); fileEl.dir = 'ltr'; zone.classList.remove('is-loaded', 'is-error'); iconEl.textContent = '📄'; fileEl.textContent = ''; input.value = ''; },
  };
}

/**
 * Summary card with a title and a grid of {label,value} stats.
 * @param {{title:string, stats:{label:string, value:string|number, small?:boolean}[]}} o
 */
export function fileSummaryCard({ title, stats }) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: title }),
    el('div', { class: 'summary' },
      stats.map((s) => el('div', { class: 'stat' }, [
        el('div', { class: 'stat__label', text: s.label }),
        el('div', { class: 'stat__value' + (s.small ? ' small' : ''), text: String(s.value) }),
      ]))),
  ]);
}

let toastHost = null;
/** Transient toast message. type: 'ok' | 'err' | 'warn' | ''. */
export function toast(message, type = '', ms = 2600) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.body.appendChild(toastHost);
  }
  const t = el('div', { class: 'toast' + (type ? ' ' + type : ''), text: message });
  toastHost.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 250);
  }, ms);
}

/** Determinate progress bar. */
export function progressBar() {
  const bar = el('div', { class: 'progress__bar' });
  const label = el('div', { class: 'progress__label' });
  const wrap = el('div', {}, [el('div', { class: 'progress' }, [bar]), label]);
  return {
    el: wrap,
    set(pct, text) {
      bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
      if (text != null) label.textContent = text;
    },
  };
}

/**
 * Editable table backed by an array of row objects.
 * @param {{
 *   columns:{key:string, label:string, type?:'text'|'textarea'|'select'|'date', options?:string[], width?:string}[],
 *   rows:Object[],
 *   onChange:(rows:Object[])=>void,
 *   addLabel?:string,
 *   newRow?:()=>Object,
 *   minWidth?:string
 * }} o
 */
export function editableTable({ columns, rows, onChange, addLabel = STR.review.addRow, newRow, minWidth }) {
  const data = rows.map((r) => ({ ...r }));

  const emit = () => onChange(data.map((r) => ({ ...r })));

  const table = el('table', { class: 'etable' });
  if (minWidth) table.style.minWidth = minWidth;
  const thead = el('thead', {}, [
    el('tr', {}, [
      ...columns.map((c) => el('th', { text: c.label, style: c.width ? `width:${c.width}` : '' })),
      el('th', { style: 'width:34px' }),
    ]),
  ]);
  const tbody = el('tbody');
  table.append(thead, tbody);

  function cellControl(col, row) {
    const common = { value: row[col.key] == null ? '' : String(row[col.key]) };
    let ctrl;
    if (col.type === 'select') {
      ctrl = el('select', {}, (col.options || []).map((opt) =>
        el('option', { value: opt, text: opt, selected: String(row[col.key]) === opt })));
    } else if (col.type === 'textarea') {
      ctrl = el('textarea', { rows: 2, ...common });
    } else if (col.type === 'date') {
      // Real date picker for ISO (or empty) values; text fallback keeps non-ISO
      // values ('يومي', '25-06-2026', ranges) visible and editable. A native
      // type=date input already writes YYYY-MM-DD on change, so no extra convert.
      const isISO = /^\d{4}-\d{2}-\d{2}$/.test(common.value);
      if (common.value === '' || isISO) {
        ctrl = el('input', { type: 'date', value: isISO ? common.value : '' });
      } else {
        ctrl = el('input', { type: 'text', placeholder: 'YYYY-MM-DD', ...common });
      }
    } else {
      ctrl = el('input', { type: 'text', ...common });
    }
    ctrl.addEventListener('input', () => { row[col.key] = ctrl.value; emit(); });
    ctrl.addEventListener('change', () => { row[col.key] = ctrl.value; emit(); });
    return ctrl;
  }

  function renderRows() {
    tbody.innerHTML = '';
    data.forEach((row, i) => {
      const tr = el('tr', {}, [
        ...columns.map((c) => el('td', { class: c.type === 'select' ? 'status-cell' : '' }, [cellControl(c, row)])),
        el('td', {}, [el('button', {
          class: 'rm', title: STR.common.remove, text: '✕',
          onClick: () => { data.splice(i, 1); renderRows(); emit(); },
        })]),
      ]);
      tbody.appendChild(tr);
    });
  }
  renderRows();

  const wrap = el('div', {}, [el('div', { class: 'etable-wrap' }, [table])]);
  if (newRow) {
    wrap.appendChild(el('div', { class: 'table-actions' }, [
      el('button', {
        class: 'btn btn--ghost btn--sm', text: '＋ ' + addLabel,
        onClick: () => { data.push(newRow()); renderRows(); emit(); },
      }),
    ]));
  }
  return wrap;
}

/** Simple labelled textarea field. */
export function textareaField({ label, value, hint, onInput, rows = 4 }) {
  const ta = el('textarea', { rows, value: value || '' });
  ta.addEventListener('input', () => onInput(ta.value));
  return el('div', { class: 'field' }, [
    el('label', { text: label }),
    ta,
    hint ? el('div', { class: 'hint', text: hint }) : null,
  ]);
}

/* ================================================================== *
 * «متابعة المشروع» — the project tracker editor (tracker CONTRACT §1.6).
 *
 * The tracker is a PERSISTED DOCUMENT (settings.cachedTracker): the review screen edits
 * the very object state.parsed.tracker / model.projectTracker hold, the preview follows
 * every keystroke, and a debounced save writes it back through store.updateCachedTracker
 * — so an edit survives a reload, starts the next report, and is what the unattended
 * main report publishes. A new upload replaces the whole document.
 *
 * The pure helpers below carry every rule (exported for node tests); trackerEditor is
 * only their DOM. Field VALUES are the workbook's own words, stored verbatim ('Deleyed'
 * stays 'Deleyed'); only the display labels are Arabic.
 *
 * ARABIC TRANSLATION (2026-10-13, Arabic CONTRACT §1/§4): each task also carries taskAr /
 * trackAr / milestoneAr — SEPARATE fields beside the English originals, which are never
 * overwritten, so a bad translation can always be checked against (and fall back to) the
 * file's own words. Which text the slide shows is reportOptions.trackerLang.
 * ================================================================== */

/** The 19 editable task fields, in editor order. `wide` = full-width multi-line field;
 *  `pair` = the English task and its Arabic translation, side by side on one row (stacked
 *  when the column is too narrow); `rtl` = an Arabic translation field (typed RTL). */
export const TRACKER_EDIT_FIELDS = Object.freeze([
  { key: 'task', wide: true, pair: true },
  { key: 'taskAr', wide: true, pair: true, rtl: true },
  { key: 'status', suggest: true },
  { key: 'due', due: true },
  { key: 'owner', suggest: true },
  { key: 'priority', suggest: true },
  { key: 'organization', suggest: true },
  { key: 'wbs' },
  { key: 'track', suggest: true },
  { key: 'trackAr', suggest: true, rtl: true },
  { key: 'milestone', suggest: true },
  { key: 'milestoneAr', suggest: true, rtl: true },
  { key: 'workstream', suggest: true },
  { key: 'workPackage', suggest: true },
  { key: 'taskType', suggest: true },
  { key: 'predecessor', suggest: true },
  { key: 'nextAction', wide: true },
  { key: 'definitionOfDone', wide: true },
  { key: 'notes', wide: true },
]);
const EDIT_KEYS = new Set(TRACKER_EDIT_FIELDS.map((f) => f.key));

/* The controlled vocabularies the workbook's instruction row names. The file stores no
 * dropdown lists (no data validation), so these are its known values — the status list
 * is the conditional-format rules' set — and every value found in the data is offered
 * beside them. Suggestions only: free text is always accepted. Owners, tracks,
 * milestones, workstreams and work packages come from the data alone (people's names
 * and project structure are the file's content, not the app's). */
export const TRACKER_VOCAB = Object.freeze({
  status: Object.freeze(['Not Started', 'In Progress', 'Completed', 'Delayed', 'Blocked', 'On Hold']),
  priority: Object.freeze(['Critical', 'High', 'Medium', 'Low']),
  organization: Object.freeze(['NUPCO', 'LEAN', 'NUPCO / LEAN']),
  taskType: Object.freeze(['Deliverable', 'Milestone', 'Decision / Approval', 'Recurring Activity', 'Onboarding', 'Integration']),
});

const vocabKey = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');

/** Status text → the status module's key (tracker-status.js baseStatus): 'completed',
 *  'inProgress', 'late', 'stopped', 'notStarted' or 'other' — BEFORE the overdue rule (that
 *  needs a report date; see trackerStatusCounts / trackerStatusPill). The file's misspelt
 *  'Deleyed' is late; Blocked / On Hold are «متوقف» (one box for the user); blank and
 *  'Not Found' are «لم يبدأ»; any other word is 'other' (shown verbatim, neutral). */
export function trackerStatusKey(status) {
  return baseStatus(status);
}

/** Priority text → display key (critical / high / medium / low) or null. */
const PRIORITY_AR = { 'حرجة': 'critical', 'عالية': 'high', 'متوسطة': 'medium', 'منخفضة': 'low' };
export function trackerPriorityKey(priority) {
  const k = vocabKey(priority);
  if (PRIORITY_AR[k]) return PRIORITY_AR[k]; // the slide's Arabic priority words too
  return ['critical', 'high', 'medium', 'low'].includes(k) ? k : null;
}

/* The slide's status pill colours (the workbook's conditional formats; Late takes the
 * orange pair, Stopped the red one — map/slide-design.md §6), reused for the editor's
 * pills so the surfaces read alike. */
const STATUS_PILL = {
  completed: ['#C6EFCE', '#006100'],
  inProgress: ['#DDEBF7', '#1F4E78'],
  late: ['#FCE4D6', '#C55A11'],
  stopped: ['#FFC7CE', '#9C0006'],
  notStarted: ['#E7E6E6', '#404040'],
  other: ['#F1F5F9', '#475569'],
};

/** Arabic label of a status value as the FILE states it (verbatim for an unrecognised word). */
export function trackerStatusLabel(status) {
  const key = baseStatus(status);
  if (key === 'other') return String(status).trim();
  return STATUS_AR[key];
}

/**
 * Task count per status AS THE DECK SHOWS IT on `reportDate` (tracker-status.js
 * effectiveStatus: an overdue non-completed task is «متأخر», an overdue «متوقف» stays
 * «متوقف»), in the deck's order (STATUS_KEYS: متأخر, متوقف, قيد التنفيذ, لم يبدأ, مكتمل),
 * then each unrecognised word under its own name (first-seen order), then «متجاوزة الموعد»
 * (every non-completed task past its date — overdue Stopped included). Zero counts are
 * omitted. Pure; the upload card's stats. Without a valid reportDate nothing is overdue,
 * so the counts are the file's own statuses.
 * The deck's task slides drop the Completed tasks in EVERY cadence by default (2026-10-18 —
 * they print on the weekly «المهام المكتملة خلال الأسبوع» slide, and on the task slides too
 * only when reportOptions.trackerShowCompleted is on); the upload card describes the whole
 * FILE, so its «مكتمل» line stays either way.
 * @param {object} tracker
 * @param {string} [reportDate] - 'yyyy-mm-dd' — the report's date (the overdue reference)
 * @returns {{key:string, label:string, count:number}[]}
 */
export function trackerStatusCounts(tracker, reportDate) {
  const tasks = (tracker && Array.isArray(tracker.tasks)) ? tracker.tasks : [];
  const known = new Map(STATUS_KEYS.map((k) => [k, 0]));
  const other = new Map();
  let pastDue = 0;
  for (const t of tasks) {
    const e = effectiveStatus(t, reportDate);
    if (e.pastDue) pastDue++;
    if (e.key === 'other') {
      const word = String(t.status).trim();
      other.set(word, (other.get(word) || 0) + 1);
    } else known.set(e.key, known.get(e.key) + 1);
  }
  const out = [];
  for (const [key, count] of known) if (count) out.push({ key, label: STATUS_AR[key], count });
  for (const [word, count] of other) out.push({ key: `other:${word}`, label: word, count });
  if (pastDue) out.push({ key: 'pastDue', label: STR.tracker.pastDue, count: pastDue });
  return out;
}

/**
 * Suggestion list for a field: the known vocabulary (status / priority / organization /
 * task type) followed by every distinct value in the data (first-seen order; a value
 * equal to a vocabulary word up to case/spacing is not repeated). Predecessor offers the
 * tasks' own WBS ids. Pure.
 * @returns {string[]}
 */
export function trackerSuggestions(tracker, key) {
  const tasks = (tracker && Array.isArray(tracker.tasks)) ? tracker.tasks : [];
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const k = vocabKey(s) || s;
    if (!s || seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  for (const v of TRACKER_VOCAB[key] || []) push(v);
  if (key === 'predecessor') for (const t of tasks) push(t && t.wbs);
  for (const t of tasks) push(t && t[key]);
  return out;
}

/** The due value a native date picker can show: the ISO date itself, else ''. */
export function duePickerValue(due) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(due || '')) ? String(due) : '';
}

/** A due value as the deck prints it: dd/mm/yyyy for a date, the text otherwise. */
export function dueDisplay(due) {
  const s = String(due || '');
  return duePickerValue(s) ? formatDateAr(s) : s;
}

/** A due value typed on the website → stored form: the parser's own rule (day-first
 *  D/M/YYYY and other real dates → ISO; 'daily' and any other text kept as typed). */
export function normalizeTrackerDue(text) {
  return normalizeDueText(text);
}

const isoNow = (now) => (now instanceof Date ? now : new Date(now == null ? Date.now() : now)).toISOString();

/** Stamp a website edit on the document (editedAt — the upload card's «edits replaced»
 *  note and the Settings line read it). */
export function touchTracker(tracker, now) {
  if (tracker) tracker.editedAt = isoNow(now);
  return tracker;
}

/** A new, empty tracker for a report with no file — «add task» with nothing loaded. */
export function createProjectTracker(now) {
  const at = isoNow(now);
  return { format: TRACKER_FORMAT, fileName: null, loadedAt: at, editedAt: at, warnings: [], tasks: [] };
}

const indexOfTask = (tracker, id) => (tracker && Array.isArray(tracker.tasks)
  ? tracker.tasks.findIndex((t) => t && t.id === id) : -1);

/**
 * Set one field of one task (by id). Only the 16 editable fields (never `id`); the value
 * is stored as a string, verbatim. Returns true when the value changed (and stamps
 * editedAt), false for an unknown task / field or an unchanged value.
 */
export function setTrackerField(tracker, id, key, value, now) {
  if (!EDIT_KEYS.has(key)) return false;
  const i = indexOfTask(tracker, id);
  if (i < 0) return false;
  const v = value == null ? '' : String(value);
  if (tracker.tasks[i][key] === v) return false;
  tracker.tasks[i][key] = v;
  touchTracker(tracker, now);
  return true;
}

/**
 * Add a blank task (unique id from the parser's own factory). With `afterId` it goes right
 * after that task and joins its group (track, milestone — and their Arabic names —
 * workstream, work package);
 * otherwise it is appended. Status starts as 'Not Started'. Returns the new task.
 */
export function addTrackerTask(tracker, { afterId = null, now } = {}) {
  if (!tracker || !Array.isArray(tracker.tasks)) return null;
  const task = blankTrackerTask(tracker.tasks);
  task.status = 'Not Started';
  const i = afterId == null ? -1 : indexOfTask(tracker, afterId);
  if (i >= 0) {
    const ref = tracker.tasks[i];
    for (const k of ['track', 'trackAr', 'milestone', 'milestoneAr', 'workstream', 'workPackage']) task[k] = ref[k] || '';
    tracker.tasks.splice(i + 1, 0, task);
  } else {
    tracker.tasks.push(task);
  }
  touchTracker(tracker, now);
  return task;
}

/** Remove a task by id. Returns true when one was removed. */
export function removeTrackerTask(tracker, id, now) {
  const i = indexOfTask(tracker, id);
  if (i < 0) return false;
  tracker.tasks.splice(i, 1);
  touchTracker(tracker, now);
  return true;
}

/** Move a task one place (delta -1 = up / earlier, +1 = down). Task order IS slide order.
 *  Returns false at either end or for an unknown id. */
export function moveTrackerTask(tracker, id, delta, now) {
  const i = indexOfTask(tracker, id);
  const j = i + (delta < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= tracker.tasks.length) return false;
  const [t] = tracker.tasks.splice(i, 1);
  tracker.tasks.splice(j, 0, t);
  touchTracker(tracker, now);
  return true;
}

/** The «المسار › المرحلة» heading text a task sits under in the editor. Without `lang`
 *  it is the English pair. With ANY slide language — 'en' included since 2026-10-18 (the
 *  user's correction: the stage / track translations apply to the English slide too; only
 *  the task text stays English there) — each part is its Arabic name, falling back to the
 *  English one per part (the slide's per-cell rule). Display only — where a heading starts
 *  is trackerGroupKey's job. */
export function trackerGroupLabel(task, lang) {
  const t = task || {};
  const ar = lang != null;
  const part = (en, arKey, none) => (ar && String(t[arKey] || '').trim()) || String(t[en] || '').trim() || none;
  return `${part('track', 'trackAr', STR.tracker.noTrack)} › ${part('milestone', 'milestoneAr', STR.tracker.noMilestone)}`;
}

/** The editor's GROUPING key: consecutive tasks with the same key share one heading. It is
 *  the slide's merge rule (slidespec/build-tracker.js trackKey / msKey) — the English pair
 *  plus the Arabic pair, in every language ('en' too since 2026-10-18: its group labels
 *  print the Arabic) — so the list splits exactly where the deck does. `lang` is accepted
 *  for call-site parity.
 *  trackAr / milestoneAr are stored PER TASK: a group whose Arabic name differs on one task
 *  prints as separate blocks on the slide, and the editor must show that same split rather
 *  than one heading named from the group's first task. Whitespace runs collapse as on the
 *  slide. Pure. */
export function trackerGroupKey(task, lang) {
  const t = task || {};
  const c = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  return `${c(t.track)}\u0001${c(t.milestone)}\u0001${c(t.trackAr)}\u0001${c(t.milestoneAr)}`;
}

/* ---------- The slide's task language (reportOptions.trackerLang) ---------- */

/* 'ar' (Arabic, English fallback per cell) | 'en' (the TASK text in the file's English,
 * unchanged; stage / track / owner / entity still Arabic — 2026-10-18) |
 * 'both' (Arabic + the English original under it) — the enum and its default are the
 * tracker module's (ingest/task-tracker.js), re-exported so the screens import one place.
 * Order = the selector's order. */
export { TRACKER_LANGS, DEFAULT_TRACKER_LANG };
/** A stored / typed value → one of TRACKER_LANGS. Unlike the store's validator (null for
 *  a bad value — it must REJECT an import), a screen always needs a choice: anything
 *  invalid or absent reads as the default ('ar'). Pure. */
export function normalizeTrackerLang(v) {
  return parseTrackerLang(v) || DEFAULT_TRACKER_LANG;
}
/** The selector's options (review tracker card + Settings radio): ONE list, one wording. */
export const TRACKER_LANG_OPTIONS = Object.freeze(TRACKER_LANGS.map((value) => Object.freeze({
  value, label: STR.tracker.lang[value], hint: STR.tracker.langHint[value],
})));

const hasArabic = (task) => !!(task && String(task.taskAr || '').trim());

/**
 * The task text as the slide shows it in `lang`: { primary, secondary } — 'en' the English
 * task; 'ar' the Arabic, else the English (per row); 'both' the Arabic with the English
 * original as `secondary` (a row without Arabic shows the English once). Pure; the editor's
 * row summary reads it so the list matches the deck.
 */
export function trackerTaskText(task, lang) {
  const en = String((task && task.task) || '').trim();
  const ar = String((task && task.taskAr) || '').trim();
  const l = normalizeTrackerLang(lang);
  // «النص الأصلي» (CONTRACT-AUTO §6/§7): the user chose the English original for THIS task —
  // the slide prints it as if the task had no Arabic, so the list does too.
  const original = !!(task && task.showOriginal === true) && !!en;
  if (l === 'en' || !ar || original) return { primary: en, secondary: '' };
  return { primary: ar, secondary: l === 'both' && en && en !== ar ? en : '' };
}

/** How many tasks carry an Arabic text: { translated, total } (the upload card's
 *  «N من M مهمة مترجمة» and the editor's meta). Pure. */
export function trackerTranslationCount(tracker) {
  const tasks = (tracker && Array.isArray(tracker.tasks)) ? tracker.tasks.filter((t) => t && typeof t === 'object') : [];
  return { translated: tasks.filter(hasArabic).length, total: tasks.length };
}

/** True when ANY task carries ANY Arabic text — taskAr, trackAr or milestoneAr (a workbook
 *  with only the Arabic track / milestone columns still prints Arabic group cells in 'ar'
 *  mode, which the task count alone misses). No screen keys on it since the upload card's
 *  «no Arabic columns» note was removed (CONTRACT-AUTO §6); kept as a pure helper. Pure. */
export function trackerHasAnyArabic(tracker) {
  const tasks = (tracker && Array.isArray(tracker.tasks)) ? tracker.tasks : [];
  return tasks.some((t) => t && typeof t === 'object'
    && ['taskAr', 'trackAr', 'milestoneAr'].some((k) => String(t[k] || '').trim()));
}

/* ================================================================== *
 * AUTOMATIC ARABIC (2026-10-13, CONTRACT-AUTO §4–§6).
 *
 * The user uploads their NORMAL English tracker and the tasks come out in Arabic — nothing
 * to prepare. The tracker-translate module fills taskAr / trackAr / milestoneAr from a
 * translation memory keyed by the ENGLISH text (file column > the user's corrections >
 * the built-in reviewed memory > the on-device machine cache). This block is the UI glue:
 *   • translateTrackerInPlace — apply the layers to the SESSION document without breaking
 *     its identity (the editor, the model and state.parsed.tracker are one object);
 *   • the user-TM writes the editor makes (an Arabic edit, «النص الأصلي»), queued and
 *     written with the tracker's own debounced save;
 *   • the on-device Translator API (Chrome's `Translator`), feature-detected, results
 *     cached in settings.trackerTranslations.machine — nothing ever leaves the device;
 *   • the card's status line «N من M مهمة مترجمة تلقائيًا».
 * The old «upload an Arabic Excel» warning is GONE: the user never has to make one.
 * ================================================================== */

/** The per-task fields a translation pass writes (the English fields are never touched). */
export const TRACKER_TRANSLATION_FIELDS = Object.freeze([
  'taskAr', 'trackAr', 'milestoneAr', 'taskArSource', 'trackArSource', 'milestoneArSource', 'showOriginal',
  // The owner / entity names (2026-10-18, rule 5): filled per name part from the user's and
  // the built-in lists. Copied in place like the texts — without them the session document
  // (the editor's = the preview's) would never get its Arabic names.
  'ownerAr', 'organizationAr', 'ownerArSource', 'organizationArSource',
]);
/** Arabic field → its English source field (the TM key) and its source field. */
const AR_FIELD = Object.freeze({
  taskAr: Object.freeze({ en: 'task', src: 'taskArSource' }),
  trackAr: Object.freeze({ en: 'track', src: 'trackArSource' }),
  milestoneAr: Object.freeze({ en: 'milestone', src: 'milestoneArSource' }),
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// A translation field's MEANING: absent ≡ '' (no Arabic / no source) and absent ≡ false (no
// «النص الأصلي»). Compared by meaning so a pass with nothing to add leaves a document
// byte-for-byte as it was — no '' / false keys sprinkled onto a tracker that has no Arabic.
const trField = (k, v) => (k === 'showOriginal' ? v === true : (typeof v === 'string' ? v : ''));

/* The user-TM edits not yet written. WHY a queue of OPERATIONS (not a TM snapshot): the write
 * replays them onto the settings doc as it is THEN (load → replay → save), so a machine-cache
 * write or a Settings import in between is never overwritten by a stale copy. Module-level —
 * one per page, like trackerSaver, which writes them (saveTrackerToStore). */
let pendingTmOps = [];
const replayTmOps = (tm, ops) => ops.reduce((acc, o) => (o.op === 'original'
  ? setOriginal(acc, o.en, o.on)
  : setUserTranslation(acc, o.kind, o.en, o.ar)), tm);

// Typing queues one op per keystroke: a newer op for the SAME text replaces the previous one
// (only the last value matters), so the queue stays one entry per edited text.
const sameTmTarget = (a, b) => a.op === b.op && normEn(a.en) === normEn(b.en)
  && (a.op === 'original' || a.kind === b.kind);
function queueTmOp(op) {
  const last = pendingTmOps[pendingTmOps.length - 1];
  if (last && sameTmTarget(last, op)) pendingTmOps[pendingTmOps.length - 1] = op;
  else pendingTmOps.push(op);
}

/** How many user-TM edits are waiting for the next save (tests, the harness line). */
export function pendingTrackerTranslations() { return pendingTmOps.length; }
/** Drop the queued edits (node tests; a fresh page starts empty anyway). */
export function __resetPendingTrackerTranslations() { pendingTmOps = []; }

/**
 * The user TM as the NEXT apply must see it: settings.trackerTranslations with the queued
 * edits replayed on top — a re-render inside the save debounce must not resurrect the
 * built-in text over an Arabic the user has just typed. null when the user has never had a
 * TM and nothing is queued: the tracker-translate module then KEEPS user-sourced fields and
 * showOriginal flags rather than wiping them (an absent layer never wipes).
 */
export function userTrackerTM(settings) {
  const base = settings && isObj(settings.trackerTranslations) ? settings.trackerTranslations : null;
  if (!pendingTmOps.length) return base;
  return replayTmOps(base, pendingTmOps);
}

/** The three layers for applyTrackerTranslations: the user TM (+ its machine cache) from
 *  settings, the built-in memory from the session (state.trackerBuiltinTM — null while it
 *  is not loaded, which KEEPS earlier built-in fills instead of wiping them). */
export function trackerTMLayers(settings, builtin) {
  return { user: userTrackerTM(settings), builtin: isObj(builtin) ? builtin : null };
}

/* Documents whose translations must stay OUT of the user's memory — the ?mock=1 demo
 * (screen-upload marks it; components cannot import screen-upload without a cycle). WHY:
 * the editor already never queues their edits, but an in-place pass with the user layer
 * PRESENT would then treat a demo edit as «a cleared correction» and wipe it (an available
 * layer that lacks the key drops the field). For these the pass runs with NO user layer —
 * an absent layer keeps what it filled — and reads the machine cache without writing it. */
// One registry per page, not per module instance: the same file loaded under two ?v= URLs
// (node tests import it bare, the screens with ?v=) would otherwise not share the mark.
const TM_DETACHED_KEY = Symbol.for('misbar.trackerTMDetached');
const TM_DETACHED = globalThis[TM_DETACHED_KEY] || (globalThis[TM_DETACHED_KEY] = new WeakSet());
/** Mark a tracker as detached from the user's translation memory (the demo document). */
export function detachTrackerFromTM(doc) { if (isObj(doc)) TM_DETACHED.add(doc); return doc; }
/** True for a document marked by detachTrackerFromTM. */
export function isTrackerTMDetached(doc) { return isObj(doc) && TM_DETACHED.has(doc); }
function layersFor(tracker, settings, builtin) {
  if (!isTrackerTMDetached(tracker)) return trackerTMLayers(settings, builtin);
  const user = settings && isObj(settings.trackerTranslations) ? settings.trackerTranslations : null;
  return { user: null, builtin: isObj(builtin) ? builtin : null, machine: user && isObj(user.machine) ? user.machine : null };
}

/**
 * A translated COPY of a tracker (the generate fallback, the automation): applyTrackerTranslations
 * over the layers. Anything not a tagged tracker comes back as given. Never throws — a broken
 * memory leaves the tracker as it is (English where it has no Arabic), never no deck.
 */
export function translatedTracker(tracker, settings, builtin) {
  if (!isProjectTracker(tracker)) return tracker;
  try {
    const out = applyTrackerTranslations(tracker, layersFor(tracker, settings, builtin));
    return isProjectTracker(out) && translationsDiffer(tracker, out) ? out : tracker;
  } catch (e) {
    console.warn('[tracker-ar] translation pass failed', e);
    return tracker;
  }
}

/** True when `next` (a pass's result) changes any task's translation fields BY MEANING. */
export function translationsDiffer(prev, next) {
  const a = (prev && Array.isArray(prev.tasks)) ? prev.tasks : [];
  const b = (next && Array.isArray(next.tasks)) ? next.tasks : [];
  if (a.length !== b.length) return true;
  return a.some((t, i) => TRACKER_TRANSLATION_FIELDS.some((k) => trField(k, t && t[k]) !== trField(k, b[i] && b[i][k])));
}

/**
 * Apply the layers to the SESSION document IN PLACE: the translation fields of each task are
 * copied from applyTrackerTranslations' result onto the very task objects. WHY in place: the
 * review editor, model.projectTracker and state.parsed.tracker must stay ONE object (tracker
 * CONTRACT §1.3) — a copy would leave the editor editing a document the preview no longer
 * shows. Never stamps editedAt (a translation pass is not a website edit). Returns the number
 * of tasks that changed (0 for anything not a tagged tracker, or a failed pass).
 */
export function translateTrackerInPlace(tracker, settings, builtin) {
  if (!isProjectTracker(tracker)) return 0;
  let next;
  try {
    next = applyTrackerTranslations(tracker, layersFor(tracker, settings, builtin));
  } catch (e) {
    console.warn('[tracker-ar] translation pass failed', e);
    return 0;
  }
  if (!next || !Array.isArray(next.tasks) || next.tasks.length !== tracker.tasks.length) return 0;
  let changed = 0;
  tracker.tasks.forEach((t, i) => {
    const n = next.tasks[i];
    if (!isObj(t) || !isObj(n)) return;
    let c = false;
    for (const k of TRACKER_TRANSLATION_FIELDS) {
      if (n[k] === undefined || trField(k, t[k]) === trField(k, n[k])) continue;
      t[k] = n[k];
      c = true;
    }
    if (c) changed += 1;
  });
  return changed;
}

/**
 * The editor's Arabic edit (CONTRACT-AUTO §3/§6): the task's field carries the text with
 * source 'user', and the user TM learns it under the ENGLISH text — so the correction
 * survives a re-upload of the same workbook. A cleared field drops the user entry (source
 * '': the next pass falls back to the built-in / machine text, else English). `remember`
 * false (the ?mock=1 demo document) changes the task only. Returns true when queued.
 */
export function recordUserTranslation(task, arKey, value, { remember = true } = {}) {
  const f = AR_FIELD[arKey];
  if (!f || !isObj(task)) return false;
  const v = String(value == null ? '' : value).trim();
  task[f.src] = v ? 'user' : '';
  if (!remember || !normEn(task[f.en])) return false;
  queueTmOp({ op: 'user', kind: arKey, en: task[f.en], ar: v });
  return true;
}

/** The English text of a task changed (on commit): a USER translation follows it to the new
 *  key — otherwise the next pass would look the new English up, miss, and drop the user's
 *  Arabic. A built-in / machine text is not carried over (it translated the OLD English). */
export function carryUserTranslation(task, enKey, { remember = true } = {}) {
  const arKey = Object.keys(AR_FIELD).find((k) => AR_FIELD[k].en === enKey);
  if (!arKey || !isObj(task) || task[AR_FIELD[arKey].src] !== 'user') return false;
  const ar = String(task[arKey] || '').trim();
  if (!ar || !remember || !normEn(task[enKey])) return false;
  queueTmOp({ op: 'user', kind: arKey, en: task[enKey], ar });
  return true;
}

/** «النص الأصلي» for one task: the slide shows its English even in Arabic mode (on), or the
 *  Arabic again (off). Remembered under the task's English text like a correction. */
export function recordOriginalChoice(task, on, { remember = true } = {}) {
  if (!isObj(task)) return false;
  task.showOriginal = !!on;
  if (!remember || !normEn(task.task)) return false;
  queueTmOp({ op: 'original', en: task.task, on: !!on });
  return true;
}

/* ---------- «ترجمة الأسماء» — the owner / entity names (2026-10-18, CONTRACT E) ----------
 * The slide's المسؤول / الجهة cells print each '/'-separated name part in Arabic from the
 * user's list, else the built-in one, else as written. The list below edits the USER'S list
 * (settings.trackerTranslations.owners / .entities, keyed by the English name part), queued
 * and written with the tracker's own debounced save like every other correction. */

/** The two name lists the section shows, in its order. */
export const TRACKER_NAME_KINDS = Object.freeze([
  Object.freeze({ kind: 'owners', field: 'owner' }),
  Object.freeze({ kind: 'entities', field: 'organization' }),
]);

/** Every distinct owner / entity name part of `tracker` with the Arabic the layers give it
 *  — the user's queued edits included (trackerTMLayers): {owners:[{en, key, ar, source,
 *  builtinAr}], entities:[…]}. Pure apart from reading the module-level queue. */
export function trackerNameList(tracker, settings, builtin) {
  const empty = { owners: [], entities: [] };
  if (!isProjectTracker(tracker) || typeof trackerNameEntries !== 'function') return empty;
  try {
    const out = trackerNameEntries(tracker, trackerTMLayers(settings, builtin));
    return { owners: Array.isArray(out && out.owners) ? out.owners : [],
      entities: Array.isArray(out && out.entities) ? out.entities : [] };
  } catch (e) {
    console.warn('[tracker-ar] name list unavailable', e);
    return empty;
  }
}

/** The user typed / cleared the Arabic of ONE name part ('owners' | 'entities'). Queued for
 *  the next tracker save; '' removes the user's entry (back to the built-in name, else the
 *  English). `remember` false (the ?mock=1 demo) queues nothing. Returns true when queued. */
export function recordNameTranslation(kind, en, ar, { remember = true } = {}) {
  if (!remember || (kind !== 'owners' && kind !== 'entities') || !normEn(en)) return false;
  queueTmOp({ op: 'user', kind, en: String(en), ar: String(ar == null ? '' : ar).trim() });
  return true;
}

/**
 * The «ترجمة الأسماء» section (DOM) — a collapsed <details> inside the tracker card: two
 * lists (المسؤولون / الجهات), each name part as the file writes it (LTR) beside its Arabic
 * (an RTL input; placeholder = the built-in name) and where that Arabic comes from.
 * `onChange()` after every edit (the caller re-applies the layers in place, previews and
 * schedules the save). `getTracker` / `getSettings` / `getBuiltin` are read at paint time.
 * @returns {{el:HTMLElement, refresh:()=>void}}
 */
export function trackerNamesEditor({ getTracker, getSettings, getBuiltin, onChange, remember }) {
  const N = STR.tracker.names;
  const body = el('div', { class: 'trk-names__body' });
  const root = el('details', { class: 'trk-names' }, [
    el('summary', { class: 'trk-names__title', text: N.title }),
    el('p', { class: 'small muted', style: 'margin:4px 0 8px', text: N.hint }),
    body,
  ]);
  let signature = null;
  const list = () => trackerNameList(getTracker(), getSettings(), getBuiltin());
  const sourceText = (src) => N.source[src] || N.source.none;
  function row(kind, entry) {
    const badge = el('span', { class: 'trk-src', dataset: { src: entry.source || 'none' }, text: sourceText(entry.source) });
    const input = el('input', {
      type: 'text', dir: 'rtl', lang: 'ar', autocomplete: 'off', class: 'trk-names__input',
      value: entry.source === 'user' ? entry.ar : '', placeholder: entry.builtinAr || N.placeholder,
      'aria-label': N.field(entry.en),
    });
    input.addEventListener('input', () => {
      const v = input.value.trim();
      const keep = typeof remember === 'function' ? remember(getTracker()) !== false : true;
      recordNameTranslation(kind, entry.en, v, { remember: keep });
      const src = v ? 'user' : (entry.builtinAr ? 'builtin' : '');
      badge.textContent = sourceText(src);
      badge.dataset.src = src || 'none';
      if (typeof onChange === 'function') onChange();
    });
    return el('div', { class: 'trk-names__row' }, [
      el('span', { class: 'trk-names__en', dir: 'ltr', lang: 'en', text: entry.en }),
      input, badge,
    ]);
  }
  function paint() {
    const l = list();
    // Rebuilt only when the SET of names changed (a new owner typed in the editor) — never
    // under the operator's caret while they type an Arabic name here.
    const sig = JSON.stringify([l.owners.map((e) => e.key), l.entities.map((e) => e.key)]);
    if (sig === signature) return;
    signature = sig;
    body.replaceChildren();
    if (!l.owners.length && !l.entities.length) {
      body.appendChild(el('p', { class: 'small muted', text: N.none }));
      return;
    }
    for (const { kind } of TRACKER_NAME_KINDS) {
      if (!l[kind].length) continue;
      body.appendChild(el('div', { class: 'trk-names__group', text: N[kind] }));
      for (const e of l[kind]) body.appendChild(row(kind, e));
    }
  }
  paint();
  return {
    el: root,
    /** The tracker or the layers changed (an owner edit, the built-in memory arrived). */
    refresh({ force = false } = {}) { if (force) signature = null; paint(); },
  };
}

/** Write the queued user-TM edits to settings.trackerTranslations (load → replay → save).
 *  Returns true when something was written. Throws what the store throws (the caller's
 *  saver reports it); the queue is kept on a failure so the next save retries. */
export function writePendingTrackerTranslations(store) {
  if (!pendingTmOps.length || !canStoreTM(store)) return false;
  const ops = pendingTmOps;
  updateStoredTM(store, (tm) => replayTmOps(tm, ops));
  pendingTmOps = pendingTmOps.slice(ops.length);
  return true;
}

/** Cache machine translations ({tasks?, tracks?, milestones?: {english: arabic}}) in
 *  settings.trackerTranslations.machine — through the module's glossary post-pass. The
 *  queued user edits are written first (one doc, one order). Returns true when saved. */
export function saveMachineTranslations(store, results) {
  if (!canStoreTM(store)) return false;
  writePendingTrackerTranslations(store);
  updateStoredTM(store, (tm) => addMachineTranslations(tm, results));
  return true;
}

const canStoreTM = (store) => !!store && typeof store.loadSettings === 'function'
  && (typeof store.updateTrackerTranslations === 'function' || typeof store.saveSettings === 'function');
/* ONE write path for settings.trackerTranslations: read the stored memory, change it, store
 * it. Through the store's own updateTrackerTranslations when the store has it (its size
 * guard + sanitizer); otherwise (main.js's adapter exposes only load / save) the same guard
 * here — a memory past TM_MAX_CHARS is refused rather than risk the localStorage quota. */
function updateStoredTM(store, change) {
  const doc = store.loadSettings();
  const next = change(doc && doc.trackerTranslations);
  if (typeof store.updateTrackerTranslations === 'function') {
    store.updateTrackerTranslations(next);
    return;
  }
  const size = JSON.stringify(next).length;
  if (size >= TM_MAX_CHARS) {
    throw new Error(`ذاكرة ترجمة المهام كبيرة جداً للتخزين (${size} حرفاً، الحد ${TM_MAX_CHARS}). لم تُحفظ.`);
  }
  doc.trackerTranslations = next;
  store.saveSettings(doc);
}

/* ---------- The built-in memory: loaded ONCE per session (like the send-out catalogue) ---------- */

/**
 * Load the encrypted built-in memory (data/tracker-ar.enc) with the data key the access
 * seal unsealed at sign-in, ONCE per session: the result is cached on `state`
 * (state.trackerBuiltinTM — the decrypted {generatedAt, entries} or null; undefined = not
 * tried yet) and concurrent callers share one load. Never throws, never blocks a screen:
 * the callers apply what they have and re-apply when this resolves. `importer` is the
 * screens' guarded import (tests inject a fake module).
 * @returns {Promise<Object|null>}
 */
export function loadBuiltinTrackerTM(state, store, importer) {
  if (!state) return Promise.resolve(null);
  if (state.trackerBuiltinTM !== undefined) return Promise.resolve(state.trackerBuiltinTM);
  if (state.trackerBuiltinTMLoading) return state.trackerBuiltinTMLoading;
  const imp = typeof importer === 'function'
    ? importer
    : (p) => import(p).catch(() => null);
  state.trackerBuiltinTMLoading = (async () => {
    let doc = null;
    try {
      const mod = await imp('../ingest/tracker-translations.js?v=v2026-10-18.3');
      const load = mod && (mod.loadTrackerTranslations || mod.fetchTrackerTranslations);
      const key = ((((store && store.settings) || {}).grafana) || {}).dataKey || '';
      doc = typeof load === 'function' ? await load(key) : null;
    } catch (e) {
      console.warn('[tracker-ar] built-in translations unavailable', e && e.message);
      doc = null;
    }
    state.trackerBuiltinTM = isObj(doc) ? doc : null;
    state.trackerBuiltinTMLoading = null;
    return state.trackerBuiltinTM;
  })();
  return state.trackerBuiltinTMLoading;
}

/* ---------- The on-device machine translator (Chrome's Translator API) ---------- */

/** The language pair, as the Translator API takes it. */
export const TRANSLATOR_PAIR = Object.freeze({ sourceLanguage: 'en', targetLanguage: 'ar' });

/** The browser's on-device Translator (Chrome 138+: `self.Translator`), or null. Feature
 *  detection only — `scope` is injectable so node tests mock it via globalThis.Translator. */
export function translatorApi(scope = globalThis) {
  const T = scope && scope.Translator;
  return T && typeof T.availability === 'function' && typeof T.create === 'function' ? T : null;
}

/** 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'none' (no API at all). */
export async function translatorAvailability(api = translatorApi()) {
  if (!api) return 'none';
  try {
    const a = await api.availability({ ...TRANSLATOR_PAIR });
    return ['available', 'downloadable', 'downloading', 'unavailable'].includes(a) ? a : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

const AR_LETTER_RE = /[؀-ۿ]/;

/**
 * Translate the untranslated English texts ON THE DEVICE. `texts` = collectUntranslated's
 * {tasks, tracks, milestones} (original English). Resolves to
 *   { status: 'done', results: {tasks:{english: arabic}, …}, count }   — something translated
 *   { status: 'nothing' }        — no text to translate
 *   { status: 'none' }           — this browser has no on-device translator
 *   { status: 'unavailable' }    — it cannot translate English → Arabic here
 *   { status: 'needs-gesture' }  — the language model must be downloaded first, which the
 *                                  browser only allows from a click (the card's button)
 *   { status: 'failed' }         — every text failed
 * `gesture` = called from a click (allows the download). Only an output that contains Arabic
 * letters is kept (an echo of the English is not a translation). Never throws; never calls
 * any server — the API runs on the device, and there is no other path here.
 */
export async function machineTranslateTexts(texts, { api = translatorApi(), gesture = false, onProgress } = {}) {
  const lists = isObj(texts) ? texts : {};
  const kinds = ['tasks', 'tracks', 'milestones'];
  const total = kinds.reduce((n, k) => n + (Array.isArray(lists[k]) ? lists[k].length : 0), 0);
  if (!total) return { status: 'nothing' };
  if (!api) return { status: 'none' };
  const avail = await translatorAvailability(api);
  if (avail === 'unavailable' || avail === 'none') return { status: avail };
  if (avail !== 'available' && !gesture) return { status: 'needs-gesture' };
  let translator;
  try {
    translator = await api.create({
      ...TRANSLATOR_PAIR,
      monitor(m) {
        if (m && typeof m.addEventListener === 'function' && typeof onProgress === 'function') {
          m.addEventListener('downloadprogress', (e) => onProgress({ phase: 'download', loaded: e && e.loaded }));
        }
      },
    });
  } catch (e) {
    // NotAllowedError = the model needs a download and this was not a click.
    return { status: e && e.name === 'NotAllowedError' ? 'needs-gesture' : 'unavailable' };
  }
  const results = { tasks: {}, tracks: {}, milestones: {} };
  let count = 0;
  let done = 0;
  try {
    for (const k of kinds) {
      for (const en of Array.isArray(lists[k]) ? lists[k] : []) {
        try {
          const out = await translator.translate(String(en));
          const ar = typeof out === 'string' ? out.trim() : '';
          if (ar && AR_LETTER_RE.test(ar)) { results[k][en] = ar; count += 1; }
        } catch { /* this one text failed — it stays untranslated (English) */ }
        done += 1;
        if (typeof onProgress === 'function') onProgress({ phase: 'translate', done, total });
      }
    }
  } finally {
    try { if (translator && typeof translator.destroy === 'function') translator.destroy(); } catch { /* ignore */ }
  }
  return count ? { status: 'done', results, count } : { status: 'failed' };
}

/** The texts still without Arabic (the machine pass's input) — the module's own rule. */
export function trackerUntranslatedTexts(tracker) {
  return collectUntranslated(tracker);
}

/**
 * The tracker card's status (CONTRACT-AUTO §6), pure: null when there is nothing to say
 * (no tasks); else { translated, total, remaining, machine } — «N من M مهمة مترجمة
 * تلقائيًا», and how many still show in English (`remaining` — the hint / button appear
 * only when it is > 0).
 * In 'en' (2026-10-18 user correction) only the TASK text prints in English: the track and
 * stage names still print their Arabic, so the card speaks only about those — null when
 * every track / stage name has Arabic, else { scope: 'groups', remaining } (how many
 * distinct track / stage names would still print in English).
 */
export function trackerTranslationStatus(tracker, lang) {
  if (normalizeTrackerLang(lang) === 'en') {
    const u = collectUntranslated(tracker);
    const remaining = u.tracks.length + u.milestones.length;
    return remaining ? { scope: 'groups', remaining } : null;
  }
  const s = trackerTranslationStats(tracker);
  if (!s.total) return null;
  return { translated: s.translated, total: s.total, remaining: s.untranslated, machine: s.bySource.machine };
}

/**
 * The «لغة نص المهام في الشريحة» selector (DOM): three pills (aria-pressed), the
 * selected option's hint under them. `onChange(lang)` only on a real change.
 * @returns {{el:HTMLElement, set:(lang:string)=>void}}
 */
let trackerLangSeq = 0;
export function trackerLangControl({ value, onChange }) {
  let cur = normalizeTrackerLang(value);
  const hint = el('p', { class: 'trk-lang__hint small muted' });
  const btns = TRACKER_LANG_OPTIONS.map((o) => el('button', {
    type: 'button', class: 'trk-lang__btn', text: o.label, dataset: { lang: o.value },
    onClick: () => {
      if (o.value === cur) return;
      cur = o.value;
      paint();
      if (typeof onChange === 'function') onChange(cur);
    },
  }));
  const titleId = `trk-lang-${++trackerLangSeq}`;
  const root = el('div', { class: 'trk-lang' }, [
    el('span', { class: 'trk-lang__title', id: titleId, text: `${STR.tracker.langTitle}:` }),
    el('div', { class: 'trk-lang__pills', role: 'group', 'aria-labelledby': titleId }, btns),
    hint,
  ]);
  function paint() {
    for (const b of btns) b.setAttribute('aria-pressed', b.dataset.lang === cur ? 'true' : 'false');
    hint.textContent = STR.tracker.langHint[cur];
  }
  paint();
  return { el: root, set(v) { cur = normalizeTrackerLang(v); paint(); } };
}

/* ---------- «إظهار المهام المكتملة في شريحة متابعة المهام» (reportOptions.trackerShowCompleted) ---------- */

/** A stored / typed value → the boolean the deck reads. ONLY `true` is «نعم»: the deck
 *  builders read `=== true`, so the switch must never show «نعم» for a value (a string
 *  'false', 1) that would still print no completed task. Pure. */
export const normalizeTrackerShowCompleted = (v) => v === true;
/** The switch's two options (review tracker card + Settings): ONE list, one wording.
 *  «لا» first — the default. */
export const TRACKER_SHOW_COMPLETED_OPTIONS = Object.freeze([false, true].map((value) => Object.freeze({
  value,
  label: STR.tracker.showCompleted[value ? 'yes' : 'no'],
  hint: STR.tracker.showCompletedHint[value ? 'yes' : 'no'],
})));

/**
 * The «إظهار المهام المكتملة في شريحة متابعة المهام» switch (DOM): two pills لا / نعم
 * (aria-pressed) in the same look as the language pills beside it, the selected option's
 * one-line hint under them. `onChange(bool)` only on a real change.
 * @returns {{el:HTMLElement, set:(v:boolean)=>void}}
 */
let trackerDoneSeq = 0;
export function trackerShowCompletedControl({ value, onChange }) {
  let cur = normalizeTrackerShowCompleted(value);
  const hint = el('p', { class: 'trk-lang__hint small muted' });
  const btns = TRACKER_SHOW_COMPLETED_OPTIONS.map((o) => el('button', {
    type: 'button', class: 'trk-lang__btn', text: o.label, dataset: { done: o.value ? 'yes' : 'no' },
    onClick: () => {
      if (o.value === cur) return;
      cur = o.value;
      paint();
      if (typeof onChange === 'function') onChange(cur);
    },
  }));
  const titleId = `trk-done-${++trackerDoneSeq}`;
  const root = el('div', { class: 'trk-lang trk-done' }, [
    el('span', { class: 'trk-lang__title', id: titleId, text: `${STR.tracker.showCompletedTitle}:` }),
    el('div', { class: 'trk-lang__pills', role: 'group', 'aria-labelledby': titleId }, btns),
    hint,
  ]);
  function paint() {
    for (const b of btns) b.setAttribute('aria-pressed', (b.dataset.done === 'yes') === cur ? 'true' : 'false');
    hint.textContent = STR.tracker.showCompletedHint[cur ? 'yes' : 'no'];
  }
  paint();
  return { el: root, set(v) { cur = normalizeTrackerShowCompleted(v); paint(); } };
}

/**
 * The debounced save of the tracker document. ONE pending save at a time — the latest
 * document wins. `flush()` writes it now (before anything else reads or writes the
 * settings doc: Settings loads a working copy on render and its own autosave would
 * otherwise write the stale cache back), `cancel()` drops it (a new upload REPLACES the
 * document: a late save of the old one must not land on top). Timers are injectable for
 * node tests.
 * @returns {{schedule:(save:Function, tracker:Object, onError?:Function)=>void, flush:()=>boolean, cancel:()=>void, readonly pending:boolean}}
 */
export function createTrackerSaver({ delay = 700, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null;
  let job = null;
  const run = () => {
    timer = null;
    const j = job;
    job = null;
    if (!j) return false;
    try { j.save(j.tracker); return true; } catch (e) {
      if (typeof j.onError === 'function') j.onError(e);
      return false;
    }
  };
  return {
    schedule(save, tracker, onError) {
      job = { save, tracker, onError };
      if (timer != null) clearTimer(timer);
      timer = setTimer(run, delay);
    },
    flush() {
      if (timer != null) { clearTimer(timer); timer = null; }
      return run();
    },
    cancel() {
      if (timer != null) clearTimer(timer);
      timer = null;
      job = null;
    },
    get pending() { return !!job; },
  };
}

/** The app's one tracker saver (review edits). A tab closed or backgrounded inside the
 *  debounce still saves (pagehide / hidden — mobile Safari never fires unload). */
export const trackerSaver = createTrackerSaver();
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => trackerSaver.flush());
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') trackerSaver.flush();
    });
  }
}

/** Persist a tracker document through the store (the ONE write path). */
export function saveTrackerToStore(store, tracker) {
  // The user-TM edits ride the SAME save (CONTRACT-AUTO §3): every flush point (Settings,
  // a new upload, generate, pagehide) writes them with the document they were typed in.
  // First, so an oversized tracker (updateCachedTracker throws) still keeps the corrections.
  let tmError = null;
  try { writePendingTrackerTranslations(store); } catch (e) { tmError = e; }
  if (store && typeof store.updateCachedTracker === 'function') store.updateCachedTracker(tracker);
  if (tmError) throw tmError;
}

/** Local 'YYYY-MM-DD HH:MM' for the editor / settings lines ('' for a bad stamp). */
export function trackerStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** One-line description of the document: file · N tasks · loaded · last web edit.
 *  `coverage` false drops the «N من M مهمة مترجمة» part — the review card's status line
 *  above the editor already says «N من M مهمة مترجمة تلقائيًا», so the editor's meta line
 *  would repeat it; Settings (no status line) keeps it. */
export function trackerMetaLine(tracker, { coverage = true } = {}) {
  if (!isProjectTracker(tracker)) return '';
  const T = STR.tracker;
  const { translated, total } = trackerTranslationCount(tracker);
  return [
    tracker.fileName || T.manualName,
    T.count(tracker.tasks.length),
    // Arabic translation coverage — only once any task has one (a file without the Arabic
    // columns keeps its line as before).
    coverage && translated ? T.translated(translated, total) : null,
    tracker.loadedAt && trackerStamp(tracker.loadedAt) ? T.loaded(trackerStamp(tracker.loadedAt)) : null,
    tracker.editedAt && trackerStamp(tracker.editedAt) ? T.edited(trackerStamp(tracker.editedAt)) : T.notEdited,
  ].filter(Boolean).join(' · ');
}

/** A status pill (the deck's colours) — the editor rows. With a task and a report date it
 *  shows the status the DECK prints (effectiveStatus: an overdue task reads «متأخر»), and
 *  says in its tooltip what the file itself states, so the operator sees why the pill and
 *  the status field differ. Without a date: the file's own status. */
export function trackerStatusPill(status, { task, reportDate } = {}) {
  const base = baseStatus(status);
  const eff = task ? effectiveStatus(task, reportDate) : { key: base };
  const key = eff.key;
  const [bg, ink] = STATUS_PILL[key] || STATUS_PILL.other;
  const text = key === 'other' ? String(status).trim() : STATUS_AR[key];
  const pill = el('span', {
    class: 'trk-pill', text,
    title: key !== base ? STR.tracker.statusInFile(trackerStatusLabel(status)) : null,
  });
  pill.style.background = bg;
  pill.style.color = ink;
  return pill;
}

let trackerEditorSeq = 0;
// Fields whose edit can move a group boundary or rename a heading (trackerGroupKey /
// trackerGroupLabel) — the list re-renders on them.
const GROUP_KEYS = new Set(['track', 'trackAr', 'milestone', 'milestoneAr']);

/**
 * The tracker editor (DOM). Every task is a row: a one-line summary (WBS · task · status
 * pill · due) that opens a form with ALL 19 fields, plus move up / move down / delete.
 * Rows sit under their «المسار › المرحلة» heading, in document (= slide) order. Narrow by
 * design: it lives in the review screen's ~400px controls column and on phones.
 * The summaries and headings speak the slide's language (`lang` — reportOptions
 * .trackerLang), so the list reads like the deck; an untranslated task is tagged.
 *
 * @param {{
 *   tracker: Object|null,
 *   lang?: string,
 *   onChange: (tracker:Object, info:{structural:boolean}) => void,
 *   onCreate?: () => Object|null,
 *   translate?: (tracker:Object) => void,
 *   remember?: (tracker:Object) => boolean,
 *   reportDate?: () => string,
 * }} o  onChange after EVERY mutation (the caller previews + schedules the save);
 *        onCreate makes the document when there is none (returns the new tracker);
 *        translate re-applies the translation layers to the document IN PLACE (after an
 *        Arabic field is cleared or an English text changes — CONTRACT-AUTO §3);
 *        remember says whether this document's Arabic edits go to the user TM (false for
 *        the ?mock=1 demo document; default true);
 *        reportDate returns the report's date — each row's pill then shows the status the
 *        deck prints that day (an overdue task «متأخر»), not only the file's word.
 *
 * AUTOMATIC ARABIC (CONTRACT-AUTO §6): each Arabic field shows WHERE its text came from
 * («من الترجمة المعتمدة» / «ترجمة آلية — راجعها» / «تعديلك» / «من الملف»), an edit is the
 * user's correction (remembered under the English text), and «النص الأصلي» shows THIS
 * task's English original on the slide. The English stays visible in the row summary.
 * @returns {{el:HTMLElement, setTracker:(t:Object|null)=>void, setLang:(lang:string)=>void, refresh:()=>void}}
 */
export function trackerEditor({ tracker: initial, lang: initialLang, onChange, onCreate, translate, remember, reportDate }) {
  const T = STR.tracker;
  const F = T.fields;
  const uid = `trk${++trackerEditorSeq}`;
  let tracker = isProjectTracker(initial) ? initial : null;
  let lang = normalizeTrackerLang(initialLang);
  const expanded = new Set();

  const meta = el('p', { class: 'trk-meta small muted' });
  const listEl = el('div', { class: 'trk-list' });
  const datalists = el('div', { hidden: true });
  const expandBtn = el('button', { type: 'button', class: 'btn btn--ghost btn--sm' });
  const addBtn = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: `＋ ${T.addTask}` });
  const toolbar = el('div', { class: 'trk-toolbar' }, [addBtn, expandBtn]);
  const root = el('div', { class: 'trk' }, [
    el('p', { class: 'small muted', style: 'margin:0 0 6px', text: T.hint }),
    meta, toolbar, listEl, datalists,
  ]);

  const changed = (structural) => {
    paintMeta();
    if (typeof onChange === 'function') onChange(tracker, { structural: !!structural });
  };
  const rememberOpt = () => ({ remember: typeof remember === 'function' ? remember(tracker) !== false : true });
  // Re-apply the translation layers (the caller's in-place pass) — after a cleared Arabic
  // field or a changed English text, either of which can change what the TM gives.
  const retranslate = () => { if (typeof translate === 'function' && tracker) translate(tracker); };

  function paintMeta() {
    meta.textContent = tracker ? trackerMetaLine(tracker, { coverage: false }) : '';
    meta.hidden = !tracker;
    const n = tracker ? tracker.tasks.length : 0;
    expandBtn.hidden = n === 0;
    expandBtn.textContent = (n && expanded.size >= n) ? T.collapseAll : T.expandAll;
  }

  function paintDatalists() {
    datalists.innerHTML = '';
    if (!tracker) return;
    for (const f of TRACKER_EDIT_FIELDS) {
      if (!f.suggest) continue;
      datalists.appendChild(el('datalist', { id: `${uid}-dl-${f.key}` }, trackerSuggestions(tracker, f.key).map((v) => {
        const label = f.key === 'status' ? trackerStatusLabel(v)
          : f.key === 'priority' && trackerPriorityKey(v) ? T.priority[trackerPriorityKey(v)] : '';
        return el('option', { value: v, label: label && label !== v ? label : null });
      })));
    }
  }

  // Re-render keeping the focused control (and caret) — a structural change or a group
  // heading change rebuilds the list, which must not throw the operator out of a field.
  function renderList() {
    const a = document.activeElement;
    const keep = a && a.dataset && a.dataset.trkId
      ? { id: a.dataset.trkId, field: a.dataset.trkField, start: a.selectionStart, end: a.selectionEnd }
      : null;
    listEl.innerHTML = '';
    paintMeta();
    if (!tracker) {
      listEl.appendChild(el('p', { class: 'trk-empty small', text: T.none }));
      return;
    }
    if (!tracker.tasks.length) {
      listEl.appendChild(el('p', { class: 'trk-empty small', text: T.empty }));
      return;
    }
    let group = null;
    tracker.tasks.forEach((task, i) => {
      // Grouped by the slide's own merge key (trackerGroupKey: the English pair plus the
      // Arabic pair, every language), so a task whose Arabic group name differs from its
      // neighbours' gets its own heading here exactly as it gets its own block in the deck.
      // Shown in the slide's language; 'both' adds the English original under it.
      const k = trackerGroupKey(task, lang);
      if (k !== group) {
        group = k;
        const g = trackerGroupLabel(task);
        const shown = trackerGroupLabel(task, lang);
        listEl.appendChild(el('div', { class: 'trk-group' }, [
          el('div', { dir: 'auto', text: shown }),
          lang === 'both' && shown !== g ? el('div', { class: 'trk-group__en', dir: 'ltr', text: g }) : null,
        ]));
      }
      listEl.appendChild(taskRow(task, i));
    });
    if (keep) {
      const at = (field) => listEl.querySelector(`[data-trk-id="${CSS.escape(keep.id)}"][data-trk-field="${CSS.escape(field || '')}"]`);
      let target = at(keep.field);
      // A move to the top / bottom rebuilds the pressed ▲ / ▼ DISABLED, and a disabled button
      // cannot take focus (it would fall back to the page body): use the opposite move
      // button, else the row's toggle.
      if (target && target.disabled) {
        const other = at(keep.field === '_up' ? '_down' : keep.field === '_down' ? '_up' : null);
        target = other && !other.disabled ? other : at('_toggle');
      }
      if (target) {
        target.focus();
        try { if (keep.start != null) target.setSelectionRange(keep.start, keep.end); } catch { /* not a text control */ }
      }
    }
  }

  function taskRow(task, i) {
    const n = tracker.tasks.length;
    const bodyId = `${uid}-row-${i}`;
    const isOpen = expanded.has(task.id);
    const wbsEl = el('span', { class: 'trk-row__wbs', dir: 'ltr' });
    const taskEl = el('span', { class: 'trk-row__task', dir: 'auto' });
    // The English original, ALWAYS visible under an Arabic summary (CONTRACT-AUTO §6): a
    // wrong translation is spotted in the list without opening the task.
    const enEl = el('span', { class: 'trk-row__en', dir: 'ltr', lang: 'en' });
    const textEl = el('span', { class: 'trk-row__text' }, [taskEl, enEl]);
    const untrEl = el('span', { class: 'trk-row__untr' });
    const pillHost = el('span', { class: 'trk-row__pill' });
    const dueEl = el('span', { class: 'trk-row__due', dir: 'auto' });
    const paintHead = () => {
      wbsEl.textContent = task.wbs || '—';
      const shown = trackerTaskText(task, lang).primary;
      taskEl.textContent = shown || T.untitled;
      const en = String(task.task || '').trim();
      enEl.textContent = en && shown !== en ? en : '';
      enEl.hidden = !enEl.textContent;
      // The row's tag, outside 'en': «النص الأصلي» (the user chose the English for this
      // task), «بلا ترجمة» (no layer had Arabic — the slide prints the English), «آلية» (an
      // on-device machine translation nobody has reviewed yet).
      const ar = !!String(task.taskAr || '').trim();
      const tag = lang === 'en' || !en ? ''
        : task.showOriginal === true ? T.originalTag
          : !ar ? T.untranslated
            : task.taskArSource === 'machine' ? T.machineTag : '';
      untrEl.textContent = tag;
      untrEl.hidden = !tag;
      untrEl.classList.toggle('is-machine', tag === T.machineTag);
      pillHost.innerHTML = '';
      pillHost.appendChild(trackerStatusPill(task.status, {
        task, reportDate: typeof reportDate === 'function' ? reportDate() : undefined,
      }));
      dueEl.textContent = dueDisplay(task.due);
    };
    paintHead();
    const toggle = el('button', {
      type: 'button', class: 'trk-row__toggle', 'aria-expanded': isOpen ? 'true' : 'false', 'aria-controls': bodyId,
      dataset: { trkId: task.id, trkField: '_toggle' },
    }, [wbsEl, textEl, untrEl, pillHost, dueEl]);
    const iconBtn = (text, label, field, disabled, onClick) => el('button', {
      type: 'button', class: 'trk-iconbtn', text, title: label, 'aria-label': label, disabled,
      dataset: { trkId: task.id, trkField: field }, onClick,
    });
    const actions = el('div', { class: 'trk-row__actions' }, [
      iconBtn('▲', T.moveUp, '_up', i === 0, () => {
        if (moveTrackerTask(tracker, task.id, -1)) { renderList(); changed(true); }
      }),
      iconBtn('▼', T.moveDown, '_down', i === n - 1, () => {
        if (moveTrackerTask(tracker, task.id, +1)) { renderList(); changed(true); }
      }),
      iconBtn('✕', T.remove, '_rm', false, () => {
        const label = [task.wbs, String(task.task || '').trim()].filter(Boolean).join(' — ') || T.untitled;
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(T.removeConfirm(label))) return;
        expanded.delete(task.id);
        if (removeTrackerTask(tracker, task.id)) { renderList(); paintDatalists(); changed(true); }
      }),
    ]);
    const body = el('div', { class: 'trk-row__body', id: bodyId, hidden: !isOpen });
    const row = el('div', { class: 'trk-row' + (isOpen ? ' is-open' : '') }, [
      el('div', { class: 'trk-row__head' }, [toggle, actions]), body,
    ]);
    const fillBody = () => {
      if (body.firstChild) return;
      // The English task and its Arabic translation share one row (.trk-pair).
      const grid = el('div', { class: 'trk-grid' });
      let pair = null;
      for (const f of TRACKER_EDIT_FIELDS) {
        const ctl = fieldControl(task, f, paintHead);
        if (!f.pair) { pair = null; grid.appendChild(ctl); continue; }
        if (!pair) { pair = el('div', { class: 'trk-pair' }); grid.appendChild(pair); }
        pair.appendChild(ctl);
      }
      body.appendChild(grid);
      body.appendChild(el('div', { class: 'table-actions' }, [el('button', {
        type: 'button', class: 'btn btn--ghost btn--sm', text: `＋ ${T.addAfter}`,
        onClick: () => {
          const t = addTrackerTask(tracker, { afterId: task.id });
          if (!t) return;
          expanded.add(t.id);
          renderList();
          paintDatalists();
          changed(true);
          const first = listEl.querySelector(`[data-trk-id="${CSS.escape(t.id)}"][data-trk-field="task"]`);
          if (first) first.focus();
        },
      })]));
    };
    if (isOpen) fillBody();
    toggle.addEventListener('click', () => {
      const open = body.hidden;
      if (open) { fillBody(); expanded.add(task.id); } else expanded.delete(task.id);
      body.hidden = !open;
      row.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      paintMeta();
    });
    return row;
  }

  function fieldControl(task, f, paintHead) {
    const id = `${uid}-${task.id}-${f.key}`.replace(/[^A-Za-z0-9_-]/g, '_');
    const label = el('label', { for: id, text: F[f.key] });
    // An Arabic field's source badge (CONTRACT-AUTO §6) — repainted as the user types.
    const srcKey = f.rtl ? `${f.key}Source` : null;
    const badge = srcKey ? el('span', { class: 'trk-src' }) : null;
    const paintBadge = () => {
      if (!badge) return;
      const has = !!String(task[f.key] || '').trim();
      const src = has ? (task[srcKey] || 'file') : '';
      badge.textContent = src ? (T.source[src] || '') : T.source.none;
      badge.dataset.src = src || 'none';
    };
    paintBadge();
    const set = (v) => {
      if (!setTrackerField(tracker, task.id, f.key, v)) return false;
      // The user's own Arabic: source 'user', remembered under the English (cleared → the
      // entry is dropped and, on commit, the built-in / machine text comes back).
      if (f.rtl) recordUserTranslation(task, f.key, v, rememberOpt());
      paintBadge();
      paintHead();
      return true;
    };
    let ctrl;
    // An Arabic translation field is typed right-to-left whatever it starts with (a
    // leading 'NUPCO' must not flip it LTR); every other field follows its own text.
    const dir = f.rtl ? 'rtl' : 'auto';
    const lng = f.rtl ? 'ar' : null;
    if (f.wide) {
      ctrl = el('textarea', {
        id, rows: f.pair ? 3 : 2, value: task[f.key] || '', dir, lang: lng,
        placeholder: f.rtl ? T.arHint : null,
      });
    } else {
      ctrl = el('input', {
        id, type: 'text', value: task[f.key] || '', dir, lang: lng, autocomplete: 'off',
        list: f.suggest ? `${uid}-dl-${f.key}` : null,
        placeholder: f.due ? T.dueHint : f.rtl ? T.arHint : (f.suggest ? T.suggestHint : null),
      });
    }
    ctrl.dataset.trkId = task.id;
    ctrl.dataset.trkField = f.key;
    ctrl.addEventListener('input', () => { if (set(ctrl.value)) changed(false); });
    ctrl.addEventListener('change', () => {
      if (f.due) {
        // The stored form follows the parser: '17/9/2026' → '2026-09-17'; 'daily' stays.
        const norm = normalizeTrackerDue(ctrl.value);
        if (norm !== ctrl.value) ctrl.value = norm;
        if (set(norm)) changed(false);
        if (picker) picker.value = duePickerValue(norm);
        return;
      }
      // A changed ENGLISH text carries the user's Arabic to its new key; then the layers are
      // re-applied (a cleared Arabic field falls back to the built-in / machine text, a new
      // English text may have one) and the list repaints with what the slide will show.
      // Every Arabic commit re-applies too: a correction to one task's track / milestone
      // name (keyed by the English name) renames every task of that group whose name came
      // from the built-in / machine layer, as the slide will.
      const translating = !!f.rtl || f.key === 'task' || f.key === 'track' || f.key === 'milestone';
      if (translating) {
        if (!f.rtl) carryUserTranslation(task, f.key, rememberOpt());
        retranslate();
      }
      // A new value joins the suggestions; a new track / milestone moves the row under
      // another heading (the list re-renders, keeping focus).
      paintDatalists();
      if (translating || GROUP_KEYS.has(f.key)) {
        renderList();
        if (translating) changed(false);
      }
    });
    let picker = null;
    let control = ctrl;
    if (f.due) {
      // Text + calendar: the text keeps non-dates ('daily'); the picker writes an ISO date.
      picker = el('input', {
        type: 'date', class: 'trk-due__pick', tabindex: '-1', 'aria-hidden': 'true',
        value: duePickerValue(task.due),
      });
      picker.addEventListener('change', () => {
        if (!picker.value) return;
        ctrl.value = picker.value;
        if (set(picker.value)) changed(false);
      });
      const pickBtn = el('button', {
        type: 'button', class: 'trk-iconbtn trk-due__btn', text: '📅', title: T.pickDate, 'aria-label': `${T.pickDate} — ${F.due}`,
        onClick: () => {
          picker.value = duePickerValue(ctrl.value);
          try {
            if (typeof picker.showPicker === 'function') { picker.showPicker(); return; }
          } catch { /* not allowed here — fall through to the visible input */ }
          picker.classList.add('is-visible');
          picker.removeAttribute('aria-hidden');
          picker.focus();
        },
      });
      control = el('div', { class: 'trk-due' }, [ctrl, pickBtn, picker]);
    }
    // «النص الأصلي» (CONTRACT-AUTO §6): show THIS task's English on the slide even in Arabic
    // mode — the per-task way out of a bad translation; pressed again, the Arabic returns.
    let originalBtn = null;
    if (f.key === 'taskAr') {
      originalBtn = el('button', {
        type: 'button', class: 'trk-orig', text: T.original, title: T.originalHint,
        'aria-pressed': task.showOriginal === true ? 'true' : 'false',
        dataset: { trkId: task.id, trkField: '_original' },
        onClick: () => {
          const on = task.showOriginal !== true;
          recordOriginalChoice(task, on, rememberOpt());
          touchTracker(tracker);
          originalBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
          paintHead();
          changed(false);
        },
      });
    }
    const head = badge ? el('div', { class: 'trk-field__head' }, [label, badge]) : label;
    return el('div', { class: 'trk-field' + (f.wide ? ' trk-field--wide' : '') }, [head, control, originalBtn]);
  }

  expandBtn.addEventListener('click', () => {
    if (!tracker) return;
    const all = expanded.size >= tracker.tasks.length;
    expanded.clear();
    if (!all) for (const t of tracker.tasks) expanded.add(t.id);
    renderList();
  });
  addBtn.addEventListener('click', () => {
    if (!tracker) {
      const made = typeof onCreate === 'function' ? onCreate() : null;
      if (!isProjectTracker(made)) return;
      tracker = made;
    }
    const t = addTrackerTask(tracker);
    if (!t) return;
    expanded.add(t.id);
    renderList();
    paintDatalists();
    changed(true);
    const first = listEl.querySelector(`[data-trk-id="${CSS.escape(t.id)}"][data-trk-field="task"]`);
    if (first) first.focus();
  });

  paintDatalists();
  renderList();
  return {
    el: root,
    setTracker(next) {
      tracker = isProjectTracker(next) ? next : null;
      expanded.clear();
      paintDatalists();
      renderList();
    },
    /** The document's translations changed outside the editor (the built-in memory or a
     *  machine pass arrived and was applied in place): repaint, keeping focus. */
    refresh() {
      paintDatalists();
      renderList();
    },
    /** The slide language changed (the card's selector): repaint summaries + headings. */
    setLang(next) {
      const l = normalizeTrackerLang(next);
      if (l === lang) return;
      lang = l;
      renderList();
    },
  };
}

/* ---------- «ترتيب الشرائح» — the slide-order list (2026-10-13, slide-order CONTRACT §7) ----------
 * ONE widget for the review screen's per-report card and the Settings tab's saved order, so the
 * two can never offer different gestures. It moves whole UNITS (model/slide-order.js keys —
 * the send-out pair, the tracker with all its pages); the cover and thanks are shown as locked
 * rows because they never move. BUTTONS ONLY (▲ / ▼ / «إلى الأعلى»), the tracker editor's
 * pattern: there is no drag-and-drop anywhere in the app, HTML5 drag does nothing on iOS
 * Safari, and a drag without buttons is not keyboard-accessible anyway. The widget owns no
 * order: the caller hands it the rows (getRows) and receives the new key sequence (onMove). */

/** A unit's Arabic name: its «الشرائح» chip label, else the slide-order card's own name for
 *  the two units without a chip (shipments, definitions), else the key itself. */
export function slideOrderLabel(key) {
  const R = STR.review || {};
  return (R.slideToggles && R.slideToggles[key])
    || (R.slideOrder && R.slideOrder.units && R.slideOrder.units[key])
    || String(key);
}

/** `keys` with `key` moved one place (delta < 0 = up / earlier). A NEW array, or null when the
 *  move is impossible (unknown key, already at that end) — so a caller never records a no-op. */
export function moveSlideUnit(keys, key, delta) {
  if (!Array.isArray(keys)) return null;
  const i = keys.indexOf(key);
  const j = i + (delta < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= keys.length) return null;
  const next = [...keys];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** `keys` with `key` first («إلى الأعلى»). A NEW array, or null when it already is / unknown. */
export function slideUnitToTop(keys, key) {
  if (!Array.isArray(keys)) return null;
  const i = keys.indexOf(key);
  if (i <= 0) return null;
  return [key, ...keys.filter((k) => k !== key)];
}

/**
 * The list. Rows are re-read from getRows() on every paint().
 * @param {{
 *   getRows: () => {key:string, label?:string, hidden?:boolean, empty?:boolean, hint?:string}[],
 *   onMove: (nextKeys:string[], movedKey:string) => void,
 * }} o  onMove gets the rows' keys in their new order (the caller merges them into the full
 *        order — model/slide-order.js mergeVisibleOrder — and stores it); the list repaints
 *        itself afterwards and announces the moved unit's new position.
 * @returns {{el:HTMLElement, paint:()=>void}}
 */
export function slideOrderList({ getRows, onMove }) {
  const T = STR.review.slideOrder;
  const listEl = el('ol', { class: 'sord' });
  // The polite announcement of a move («… الآن في الموضع 2 من 5»): a screen reader user
  // pressing ▲ hears where the unit landed instead of a silent list rebuild.
  const live = el('p', { class: 'sord-live', role: 'status', 'aria-live': 'polite' });
  const root = el('div', { class: 'sord-wrap' }, [listEl, live]);
  let rows = [];

  const lockedRow = (label) => el('li', { class: 'sord-row sord-row--locked', 'aria-label': T.lockedAria(label) }, [
    el('span', { class: 'sord-lock', 'aria-hidden': 'true', text: '🔒' }),
    el('span', { class: 'sord-row__label', text: label }),
    el('span', { class: 'sord-badge', 'aria-hidden': 'true', text: T.locked }),
  ]);

  function move(row, next) {
    if (!next) return;
    if (typeof onMove === 'function') onMove(next, row.key);
    paint();
    live.textContent = T.position(row.label || slideOrderLabel(row.key), next.indexOf(row.key) + 1, next.length);
  }

  function unitRow(row, i, n) {
    const label = row.label || slideOrderLabel(row.key);
    const keys = rows.map((r) => r.key);
    const btn = (act, text, aria, disabled, onClick, cls = 'trk-iconbtn') => el('button', {
      type: 'button', class: cls, text, title: aria, 'aria-label': aria, disabled,
      dataset: { sordKey: row.key, sordAct: act }, onClick,
    });
    return el('li', { class: 'sord-row' + (row.hidden || row.empty ? ' is-muted' : ''), dataset: { unit: row.key } }, [
      el('span', { class: 'sord-row__label' }, [
        el('span', { text: label }),
        row.hint ? el('span', { class: 'sord-row__hint', text: row.hint }) : null,
      ]),
      row.hidden ? el('span', {
        class: 'sord-badge', title: (T.hiddenTitles && T.hiddenTitles[row.key]) || T.hiddenTitle, text: T.hidden,
      }) : null,
      !row.hidden && row.empty ? el('span', { class: 'sord-badge', title: T.emptyTitle, text: T.empty }) : null,
      el('span', { class: 'sord-row__actions' }, [
        btn('up', '▲', T.upAria(label), i === 0, () => move({ ...row, label }, moveSlideUnit(keys, row.key, -1))),
        btn('down', '▼', T.downAria(label), i === n - 1, () => move({ ...row, label }, moveSlideUnit(keys, row.key, +1))),
        btn('top', T.toTop, T.toTopAria(label), i === 0, () => move({ ...row, label }, slideUnitToTop(keys, row.key)), 'sord-top'),
      ]),
    ]);
  }

  // Repaint keeping the focused control — the tracker editor's rule (trackerEditor renderList):
  // a move rebuilds the rows, which must not throw a keyboard user out of the list. A unit
  // moved to an end comes back with the pressed button DISABLED, which cannot take focus:
  // use the opposite move instead.
  function paint() {
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    const keep = a && a.dataset && a.dataset.sordKey && listEl.contains(a)
      ? { key: a.dataset.sordKey, act: a.dataset.sordAct } : null;
    rows = (typeof getRows === 'function' ? getRows() : null) || [];
    listEl.innerHTML = '';
    listEl.appendChild(lockedRow(T.cover));
    rows.forEach((r, i) => listEl.appendChild(unitRow(r, i, rows.length)));
    listEl.appendChild(lockedRow(T.thanks));
    if (!keep) return;
    const at = (act) => listEl.querySelector(`[data-sord-key="${CSS.escape(keep.key)}"][data-sord-act="${act}"]`);
    let target = at(keep.act);
    if (target && target.disabled) target = at(keep.act === 'down' ? 'up' : 'down');
    if (target && !target.disabled) target.focus();
  }

  paint();
  return { el: root, paint };
}
