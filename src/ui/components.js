// ui/components.js — shared DOM helpers used by Track E screens.
import { STR, formatDateAr } from '../i18n/ar.js?v=v2026-10-13.1';
// The project tracker document's OWNER (shape, tag, due-date rule, new-row factory). STATIC,
// like scope.js / hospital.js elsewhere: the module is pure (SheetJS is injected, never
// imported), and the editor below must apply the parser's own rules — a website-typed
// '17/9/2026' has to become the same ISO date a file cell does, or the slide's overdue
// test would treat the two differently.
import {
  isProjectTracker, newTask as blankTrackerTask, normalizeDueText, TRACKER_FORMAT,
} from '../ingest/task-tracker.js?v=v2026-10-13.1';
// ONE status rule for the editor pill, the upload card's counts and the slide (its pill and
// its overdue test): the slide builder's statusKey owns the alias table (English as the
// workbook writes it, 'Deleyed' included, plus the Arabic words). Pure; imports theme only.
import { statusKey as slideStatusKey } from '../slidespec/build-tracker.js?v=v2026-10-13.1';

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
 * ================================================================== */

/** The 16 editable task fields, in editor order. `wide` = full-width multi-line field. */
export const TRACKER_EDIT_FIELDS = Object.freeze([
  { key: 'task', wide: true },
  { key: 'status', suggest: true },
  { key: 'due', due: true },
  { key: 'owner', suggest: true },
  { key: 'priority', suggest: true },
  { key: 'organization', suggest: true },
  { key: 'wbs' },
  { key: 'track', suggest: true },
  { key: 'milestone', suggest: true },
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

/** Status text → display key — the SLIDE's reading (slidespec/build-tracker.js statusKey),
 *  so the editor, the upload card and the deck always agree: the file's misspelt 'Deleyed'
 *  is a delay; the Arabic words map to their status; 'Not Found' (the Portfolio formula's
 *  miss) and blank are 'unknown' (the slide's 'unset'); any other word is 'other' (shown
 *  verbatim, neutral — and, like on the slide, not completed for the overdue test). */
export function trackerStatusKey(status) {
  const k = slideStatusKey(status);
  return k === 'unset' ? 'unknown' : k;
}

/** Priority text → display key (critical / high / medium / low) or null. */
const PRIORITY_AR = { 'حرجة': 'critical', 'عالية': 'high', 'متوسطة': 'medium', 'منخفضة': 'low' };
export function trackerPriorityKey(priority) {
  const k = vocabKey(priority);
  if (PRIORITY_AR[k]) return PRIORITY_AR[k]; // the slide's Arabic priority words too
  return ['critical', 'high', 'medium', 'low'].includes(k) ? k : null;
}

/* The slide's status pill colours (the workbook's conditional formats; Delayed has no
 * rule there and takes the orange pair — map/slide-design.md §6), reused for the editor's
 * pills and the upload card so the three surfaces read alike. */
const STATUS_PILL = {
  completed: ['#C6EFCE', '#006100'],
  inProgress: ['#DDEBF7', '#1F4E78'],
  delayed: ['#FCE4D6', '#C55A11'],
  blocked: ['#FFC7CE', '#9C0006'],
  onHold: ['#FFF2CC', '#7F6000'],
  notStarted: ['#E7E6E6', '#404040'],
  unknown: ['#F1F5F9', '#64748B'],
  other: ['#F1F5F9', '#475569'],
};
const STATUS_ORDER = ['completed', 'inProgress', 'delayed', 'blocked', 'onHold', 'notStarted'];

/** Arabic label of a status value (verbatim for an unrecognised word). */
export function trackerStatusLabel(status) {
  const key = trackerStatusKey(status);
  if (key === 'other') return String(status).trim();
  return STR.tracker.status[key];
}

/**
 * Task count per status, in the slide's status order: the known statuses first, then
 * each unrecognised word under its own name (first-seen order), then «غير محدد» (blank /
 * 'Not Found'). Zero counts are omitted. Pure; the upload card's stats.
 * @returns {{key:string, label:string, count:number}[]}
 */
export function trackerStatusCounts(tracker) {
  const tasks = (tracker && Array.isArray(tracker.tasks)) ? tracker.tasks : [];
  const known = new Map(STATUS_ORDER.map((k) => [k, 0]));
  const other = new Map();
  let unknown = 0;
  for (const t of tasks) {
    const key = trackerStatusKey(t && t.status);
    if (key === 'unknown') unknown += 1;
    else if (key === 'other') {
      const word = String(t.status).trim();
      other.set(word, (other.get(word) || 0) + 1);
    } else known.set(key, known.get(key) + 1);
  }
  const out = [];
  for (const [key, count] of known) if (count) out.push({ key, label: STR.tracker.status[key], count });
  for (const [word, count] of other) out.push({ key: `other:${word}`, label: word, count });
  if (unknown) out.push({ key: 'unknown', label: STR.tracker.status.unknown, count: unknown });
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
 * after that task and joins its group (track, milestone, workstream, work package);
 * otherwise it is appended. Status starts as 'Not Started'. Returns the new task.
 */
export function addTrackerTask(tracker, { afterId = null, now } = {}) {
  if (!tracker || !Array.isArray(tracker.tasks)) return null;
  const task = blankTrackerTask(tracker.tasks);
  task.status = 'Not Started';
  const i = afterId == null ? -1 : indexOfTask(tracker, afterId);
  if (i >= 0) {
    const ref = tracker.tasks[i];
    for (const k of ['track', 'milestone', 'workstream', 'workPackage']) task[k] = ref[k] || '';
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

/** The «المسار › المرحلة» heading a task sits under in the editor (the slide's grouping). */
export function trackerGroupLabel(task) {
  const t = task || {};
  return `${String(t.track || '').trim() || STR.tracker.noTrack} › ${String(t.milestone || '').trim() || STR.tracker.noMilestone}`;
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
  if (store && typeof store.updateCachedTracker === 'function') store.updateCachedTracker(tracker);
}

/** Local 'YYYY-MM-DD HH:MM' for the editor / settings lines ('' for a bad stamp). */
export function trackerStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** One-line description of the document: file · N tasks · loaded · last web edit. */
export function trackerMetaLine(tracker) {
  if (!isProjectTracker(tracker)) return '';
  const T = STR.tracker;
  return [
    tracker.fileName || T.manualName,
    T.count(tracker.tasks.length),
    tracker.loadedAt && trackerStamp(tracker.loadedAt) ? T.loaded(trackerStamp(tracker.loadedAt)) : null,
    tracker.editedAt && trackerStamp(tracker.editedAt) ? T.edited(trackerStamp(tracker.editedAt)) : T.notEdited,
  ].filter(Boolean).join(' · ');
}

/** A status pill (the deck's colours) — the editor rows and the upload card. */
export function trackerStatusPill(status) {
  const key = trackerStatusKey(status);
  const [bg, ink] = STATUS_PILL[key] || STATUS_PILL.other;
  const pill = el('span', { class: 'trk-pill', text: trackerStatusLabel(status) || STR.tracker.status.unknown });
  pill.style.background = bg;
  pill.style.color = ink;
  return pill;
}

let trackerEditorSeq = 0;

/**
 * The tracker editor (DOM). Every task is a row: a one-line summary (WBS · task · status
 * pill · due) that opens a form with ALL 16 fields, plus move up / move down / delete.
 * Rows sit under their «المسار › المرحلة» heading, in document (= slide) order. Narrow by
 * design: it lives in the review screen's ~400px controls column and on phones.
 *
 * @param {{
 *   tracker: Object|null,
 *   onChange: (tracker:Object, info:{structural:boolean}) => void,
 *   onCreate?: () => Object|null,
 * }} o  onChange after EVERY mutation (the caller previews + schedules the save);
 *        onCreate makes the document when there is none (returns the new tracker).
 * @returns {{el:HTMLElement, setTracker:(t:Object|null)=>void}}
 */
export function trackerEditor({ tracker: initial, onChange, onCreate }) {
  const T = STR.tracker;
  const F = T.fields;
  const uid = `trk${++trackerEditorSeq}`;
  let tracker = isProjectTracker(initial) ? initial : null;
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

  function paintMeta() {
    meta.textContent = tracker ? trackerMetaLine(tracker) : '';
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
      const g = trackerGroupLabel(task);
      if (g !== group) {
        group = g;
        listEl.appendChild(el('div', { class: 'trk-group', dir: 'auto', text: g }));
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
    const pillHost = el('span', { class: 'trk-row__pill' });
    const dueEl = el('span', { class: 'trk-row__due', dir: 'auto' });
    const paintHead = () => {
      wbsEl.textContent = task.wbs || '—';
      taskEl.textContent = String(task.task || '').trim() || T.untitled;
      pillHost.innerHTML = '';
      pillHost.appendChild(trackerStatusPill(task.status));
      dueEl.textContent = dueDisplay(task.due);
    };
    paintHead();
    const toggle = el('button', {
      type: 'button', class: 'trk-row__toggle', 'aria-expanded': isOpen ? 'true' : 'false', 'aria-controls': bodyId,
      dataset: { trkId: task.id, trkField: '_toggle' },
    }, [wbsEl, taskEl, pillHost, dueEl]);
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
      body.appendChild(el('div', { class: 'trk-grid' }, TRACKER_EDIT_FIELDS.map((f) => fieldControl(task, f, paintHead))));
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
    const set = (v) => {
      if (!setTrackerField(tracker, task.id, f.key, v)) return false;
      paintHead();
      return true;
    };
    let ctrl;
    if (f.wide) {
      ctrl = el('textarea', { id, rows: f.key === 'task' ? 3 : 2, value: task[f.key] || '', dir: 'auto' });
    } else {
      ctrl = el('input', {
        id, type: 'text', value: task[f.key] || '', dir: 'auto', autocomplete: 'off',
        list: f.suggest ? `${uid}-dl-${f.key}` : null,
        placeholder: f.due ? T.dueHint : (f.suggest ? T.suggestHint : null),
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
      // A new value joins the suggestions; a new track / milestone moves the row under
      // another heading (the list re-renders, keeping focus).
      paintDatalists();
      if (f.key === 'track' || f.key === 'milestone') renderList();
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
    return el('div', { class: 'trk-field' + (f.wide ? ' trk-field--wide' : '') }, [label, control]);
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
  };
}
