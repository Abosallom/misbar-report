// ingest/task-tracker.js — parse the MISBAR Task Tracker workbook («ملف متابعة المشروع»)
// into a ProjectTracker (contracts.js), and own that document's shape for every other
// layer (store.js validates / caches it through normalizeProjectTracker).
//
// The workbook has two views of ONE task list, joined by WBS ID:
//   • 'Hierarchical Tracker' — the master data-entry sheet (title + instruction rows, the
//     header row found by NAME, today row 4). AUTHORITATIVE for every field it has:
//     status, task text, due date, owner, … — the 'Portfolio' copy of those fields goes
//     stale (its Status column is literally an INDEX/MATCH mirror of this sheet, and the
//     task texts / one due date there predate later edits here).
//   • 'Portfolio Tracker' — header row 1. Supplies ONLY what exists nowhere else: the
//     Portfolio Track + Milestone grouping (written on each group's FIRST row only, so it
//     is filled down) and the ORDER, which is the slide order.
// Rows in one sheet only are kept (a Portfolio-only row takes its cached status unless
// that is the formula's 'Not Found'; a Hierarchical-only row is appended after the
// Portfolio rows with no track / milestone) and every disagreement becomes a warning,
// shown on the upload card — the operator can correct any value on the website.
//
// Rows hidden in Excel are INCLUDED: the hiding comes from an Organization filter on the
// sheet's table, a view setting at save time, not data (the Portfolio sheet shows them).
//
// The OLD tracker (Arabic sheets سجل المهام / سجل التحديات / سجل المخاطر) and any
// unrelated workbook are REJECTED with a specific Arabic message — the old parser never
// threw, so a wrong file used to "load" as an empty tracker and overwrite the cache.
//
// SheetJS (XLSX) is injected; never imported here (the browser loads vendor/xlsx.mjs
// lazily). Cells are read DIRECTLY, never through sheet_to_json: with raw:true it turns a
// date serial into a local-midnight Date (one day early once handled as UTC in +03:00)
// and a text cell carrying a date number format ('17/9/2026', 'daily') into Invalid Date.
//
// No patient data: the workbook is project-management content (tasks, staff owners).

/** The tag that marks a ProjectTracker. An untagged cached tracker is the OLD shape. */
export const TRACKER_FORMAT = 'misbar-task-tracker-v1';

/** Every task field, in editor / documentation order. All are strings ('' when empty). */
export const TASK_FIELDS = Object.freeze([
  'id', 'wbs', 'track', 'milestone', 'workstream', 'workPackage', 'task', 'taskType',
  'organization', 'owner', 'priority', 'status', 'due', 'predecessor', 'nextAction',
  'definitionOfDone', 'notes',
]);

// The OLD tracker's sheet names (src/ingest/xlsx.js parseTracker, retired 2026-10-13).
const OLD_SHEETS = ['سجل المهام', 'سجل التحديات', 'سجل المخاطر'];

const OLD_FORMAT_MSG = 'هذا ملف المتابعة القديم (سجل المهام / سجل التحديات / سجل المخاطر) ولم يعد مستخدماً. '
  + 'الرجاء رفع ملف MISBAR Task Tracker الجديد (ورقتا «Hierarchical Tracker» و«Portfolio Tracker»).';
const UNKNOWN_FORMAT_MSG = 'الملف لا يطابق صيغة ملف متابعة المشروع (MISBAR Task Tracker): لم يُعثر على ورقة '
  + '«Hierarchical Tracker» أو «Portfolio Tracker» بعناوين الأعمدة المتوقعة (WBS ID، Task / Deliverable، Status…).';
const UNREADABLE_MSG = 'تعذّرت قراءة الملف كملف Excel. الرجاء رفع ملف MISBAR Task Tracker بصيغة ‎.xlsx‎.';

// Normalized header text -> task field. Header text is lower-cased with everything but
// latin letters / digits stripped, so 'Task / Deliverable', 'task-deliverable' and
// 'TASK DELIVERABLE' all land on 'taskdeliverable'. First matching column wins.
const HEADER_ALIASES = {
  wbsid: 'wbs', wbs: 'wbs', wbsno: 'wbs', wbsnumber: 'wbs', wbscode: 'wbs',
  portfoliotrack: 'track', track: 'track',
  milestone: 'milestone',
  workstream: 'workstream',
  workpackage: 'workPackage',
  taskdeliverable: 'task', task: 'task', deliverable: 'task', taskdescription: 'task',
  tasktype: 'taskType', type: 'taskType',
  organization: 'organization', organisation: 'organization', org: 'organization',
  owner: 'owner',
  priority: 'priority',
  status: 'status',
  duedate: 'due', due: 'due',
  predecessor: 'predecessor', predecessors: 'predecessor',
  nextaction: 'nextAction',
  definitionofdone: 'definitionOfDone', dod: 'definitionOfDone',
  notes: 'notes', note: 'notes',
};

// Free-text fields keep their line breaks (a multi-line note is the author's layout);
// every other field is a one-line value and has all whitespace collapsed.
const MULTILINE_FIELDS = new Set(['task', 'nextAction', 'definitionOfDone', 'notes']);

// Fields where the two sheets overlap: Hierarchical wins, Portfolio fills a blank, and a
// real difference is reported. Arabic names for the warning text.
const SHARED_FIELDS = [
  ['workPackage', 'Work Package'], ['task', 'المهمة'], ['taskType', 'Task Type'],
  ['organization', 'الجهة'], ['owner', 'المسؤول'], ['priority', 'الأولوية'],
  ['status', 'الحالة'], ['due', 'تاريخ الاستحقاق'],
];

// The Portfolio Status column is IFERROR(INDEX(H!Status, MATCH(WBS…)), "Not Found"):
// this literal means "no Hierarchical row", never a status.
const isNotFound = (v) => norm(v) === 'notfound';

const HEADER_SCAN_ROWS = 20;

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// ---- small helpers ------------------------------------------------------------------

/** One-line text: every whitespace run (incl. NBSP / line breaks) → one space, trimmed. */
const oneLine = (v) => (v == null ? '' : String(v).replace(/[\s ]+/g, ' ').trim());

/** Multi-line text: CRLF → LF, spaces collapsed per line, blank-line runs collapsed. */
function multiLine(v) {
  if (v == null) return '';
  return String(v)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Header / sheet-name key: lower-case latin letters and digits only. */
const norm = (v) => oneLine(v).toLowerCase().replace(/[^a-z0-9]/g, '');

const pad2 = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

function validYmd(y, m, d) {
  if (!(y >= 1900 && y <= 9999 && m >= 1 && m <= 12 && d >= 1)) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Accept a browser ArrayBuffer, a Node Buffer, or a Uint8Array.
function toData(input) {
  if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
  return input;
}

// A workbook file is a ZIP container (.xlsx / .xlsm / .xlsb: 'PK\x03\x04') or a legacy
// OLE compound file (.xls: D0 CF 11 E0). SheetJS reads ANY bytes as a one-sheet text /
// CSV workbook, so without this check a PDF or an image would be reported as "the wrong
// tracker format" instead of "not an Excel file".
function isWorkbookBytes(data) {
  if (!data || typeof data.length !== 'number' || data.length < 4) return false;
  const b = (i) => data[i];
  return (b(0) === 0x50 && b(1) === 0x4b && b(2) === 0x03 && b(3) === 0x04)
    || (b(0) === 0xd0 && b(1) === 0xcf && b(2) === 0x11 && b(3) === 0xe0);
}

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// ---- cell readers ---------------------------------------------------------------------

/** A cell's text: '' for missing / stub / error cells, the formatted text otherwise. */
function cellText(cell, multiline) {
  if (!cell || cell.t === 'z' || cell.t === 'e') return '';
  if (cell.v == null && cell.w == null) return '';
  const raw = cell.w != null ? cell.w : cell.v;
  return multiline ? multiLine(raw) : oneLine(raw);
}

/**
 * Due-date cell → 'YYYY-MM-DD' for a real date, the verbatim text otherwise, '' blank.
 * A number is an Excel date serial (that is how Excel stores a date); converted with
 * SSF.parse_date_code, which works on the serial itself — no Date object, no timezone.
 * Text is parsed only when it IS a date: day-first D/M/YYYY (the Saudi convention; the
 * file has '17/9/2026', where 17 > 12 settles it), ISO, or the sheet's own dd-mmm-yyyy
 * display format typed as text. Anything else ('daily', 'TBD', a range) is kept as typed.
 * `date1904` = the workbook uses the 1904 date system (an old Mac Excel option): the same
 * serial is then 1462 days later, so it must come from the workbook, never be assumed.
 */
export function normalizeDue(cell, XLSX, date1904 = false) {
  if (!cell || cell.t === 'z' || cell.t === 'e' || cell.v == null || cell.v === '') return '';
  if (cell.v instanceof Date) { // only when a caller read with cellDates:true
    const d = cell.v;
    return Number.isNaN(d.getTime()) ? oneLine(cell.w) : iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  if (cell.t === 'n' && typeof cell.v === 'number') {
    const p = XLSX && XLSX.SSF && XLSX.SSF.parse_date_code(cell.v, { date1904: !!date1904 }); // NOT the 3rd arg: that one selects the Hijri calendar
    if (p && validYmd(p.y, p.m, p.d)) return iso(p.y, p.m, p.d);
    return oneLine(cell.w != null ? cell.w : cell.v);
  }
  return normalizeDueText(cellText(cell, false));
}

/** Text form of normalizeDue — also used for a value typed on the website. */
export function normalizeDueText(text) {
  const s = oneLine(text);
  if (!s) return '';
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // D/M/YYYY, day first
  if (m && validYmd(+m[3], +m[2], +m[1])) return iso(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); // YYYY-M-D
  if (m && validYmd(+m[1], +m[2], +m[3])) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{4})$/); // 17-Sep-2026
  const mon = m && MONTHS[m[2].toLowerCase()];
  if (mon && validYmd(+m[3], mon, +m[1])) return iso(+m[3], mon, +m[1]);
  return s;
}

// ---- sheet location -------------------------------------------------------------------

/** First row (within the scan window) whose headers contain every `must` field. */
function findHeader(ws, XLSX, mustAll, mustOne = []) {
  if (!ws || !ws['!ref']) return null;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const last = Math.min(range.e.r, range.s.r + HEADER_SCAN_ROWS - 1);
  for (let R = range.s.r; R <= last; R++) {
    const map = {};
    for (let C = range.s.c; C <= range.e.c; C++) {
      const c = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      const f = c && HEADER_ALIASES[norm(c.v)];
      if (f && !(f in map)) map[f] = C;
    }
    if (mustAll.every((k) => k in map) && (!mustOne.length || mustOne.some((k) => k in map))) {
      return { row: R, map, range };
    }
  }
  return null;
}

// Signatures. Portfolio = the only sheet with a track column; Hierarchical = WBS + task
// + workstream or status (checked on the remaining sheets, so the Portfolio sheet — which
// also has WBS / task / status — is never mistaken for it).
const P_SIG = [['wbs', 'task', 'track'], []];
const H_SIG = [['wbs', 'task'], ['workstream', 'status']];

/**
 * Locate both sheets: by NAME first ('Hierarchical Tracker' / 'Portfolio Tracker',
 * tolerant of case / spacing / punctuation / a suffix like ' (2)'), then by header
 * signature, so a renamed sheet still parses. Never by position or a fixed row.
 */
function locateSheets(wb, XLSX) {
  const names = wb.SheetNames || [];
  const byName = (needle) => names.find((n) => norm(n) === needle)
    || names.find((n) => norm(n).startsWith(needle))
    || names.find((n) => norm(n).includes(needle.replace('tracker', '')));
  const pick = (name, [all, one]) => {
    const hdr = name ? findHeader(wb.Sheets[name], XLSX, all, one) : null;
    return hdr ? { name, hdr } : null;
  };
  let P = pick(byName('portfoliotracker'), P_SIG);
  if (!P) {
    for (const n of names) if ((P = pick(n, P_SIG))) break;
  }
  let H = null;
  const hName = byName('hierarchicaltracker');
  if (hName && (!P || hName !== P.name)) H = pick(hName, H_SIG);
  if (!H) {
    for (const n of names) {
      if (P && n === P.name) continue;
      if ((H = pick(n, H_SIG))) break;
    }
  }
  return { H, P };
}

// ---- row reading ----------------------------------------------------------------------

/**
 * Read one sheet's data rows below its header. Portfolio group columns (track /
 * milestone) are filled DOWN here: they are written only on each group's first row. A
 * row that carries nothing but a group label still moves the fill-down (a group-header
 * row layout) and is then skipped, as is any row with no value at all.
 */
function readRows(ws, XLSX, hdr, date1904 = false) {
  const out = [];
  const fields = Object.keys(hdr.map);
  let track = '';
  let milestone = '';
  for (let R = hdr.row + 1; R <= hdr.range.e.r; R++) {
    const cellOf = (f) => ws[XLSX.utils.encode_cell({ r: R, c: hdr.map[f] })];
    const row = { _row: R + 1 };
    for (const f of fields) {
      row[f] = f === 'due' ? normalizeDue(cellOf(f), XLSX, date1904) : cellText(cellOf(f), MULTILINE_FIELDS.has(f));
    }
    if ('track' in hdr.map) {
      // A NEW track value starts a new group: its milestone does not inherit the previous
      // group's (fill-down never crosses a track boundary).
      if (row.track && row.track !== track) { track = row.track; milestone = ''; }
      if (row.milestone) milestone = row.milestone;
      row.track = track;
      row.milestone = milestone;
    }
    // The Portfolio Status formula is routinely copied BELOW the last task: with a blank
    // WBS its MATCH fails and the row caches 'Not Found'. That sentinel is not data, so a
    // row holding nothing else is skipped, never turned into a phantom empty task.
    const hasData = fields.some((f) => f !== 'track' && f !== 'milestone' && row[f] !== ''
      && !(f === 'status' && isNotFound(row[f])));
    if (hasData) out.push(row);
  }
  return out;
}

// ---- join -----------------------------------------------------------------------------

function emptyTaskFields() {
  const t = {};
  for (const f of TASK_FIELDS) t[f] = '';
  return t;
}

/** One output task from a Portfolio row and/or a Hierarchical row (either may be null). */
function joinRow(p, h, warnings) {
  const t = emptyTaskFields();
  t.wbs = (h && h.wbs) || (p && p.wbs) || '';
  t.track = p ? p.track || '' : '';
  t.milestone = p ? p.milestone || '' : '';
  for (const f of ['workstream', 'predecessor', 'nextAction', 'definitionOfDone', 'notes']) {
    t[f] = h ? h[f] || '' : '';
  }
  const label = t.wbs || `صف ${(h || p)._row}`;
  for (const [f, name] of SHARED_FIELDS) {
    const hv = h ? h[f] || '' : '';
    let pv = p ? p[f] || '' : '';
    if (f === 'status' && isNotFound(pv)) pv = '';
    // Status: Hierarchical is authoritative. The Portfolio Status only MIRRORS it
    // (INDEX/MATCH), and Excel's INDEX of an empty cell caches 0 — so a matched row's
    // blank Hierarchical status stays blank; the Portfolio copy serves Portfolio-only rows.
    t[f] = f === 'status' && h ? hv : hv || pv;
    if (hv && pv && hv !== pv) {
      warnings.push(`اختلاف «${name}» للمهمة ${label} بين الورقتين: Hierarchical «${hv}» ≠ Portfolio «${pv}» — اعتُمدت قيمة Hierarchical.`);
    }
  }
  return t;
}

/** Stable unique ids: the WBS when unique, WBS#2, WBS#3… for repeats, row-N without a WBS. */
function assignIds(tasks) {
  const used = new Set();
  tasks.forEach((t, i) => {
    const base = t.wbs || `row-${i + 1}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}#${n}`;
    used.add(id);
    t.id = id;
  });
  return tasks;
}

/**
 * parseTaskTracker(arrayBuffer, XLSX, opts?) -> ProjectTracker
 * Throws an Error with an Arabic message and a `code` ('TRACKER_OLD_FORMAT',
 * 'TRACKER_UNKNOWN_FORMAT', 'TRACKER_UNREADABLE') when the file is not the new tracker.
 * @param {ArrayBuffer|Uint8Array} arrayBuffer
 * @param {Object} XLSX - SheetJS namespace (needs read, utils, SSF)
 * @param {{fileName?:string|null, now?:Date|string}} [opts] - the uploaded file's name
 *   (kept on the document for the upload / settings cards) and a clock for tests
 * @returns {import('../contracts.js').ProjectTracker}
 */
export function parseTaskTracker(arrayBuffer, XLSX, opts = {}) {
  const data = toData(arrayBuffer);
  if (!isWorkbookBytes(data)) throw fail('TRACKER_UNREADABLE', UNREADABLE_MSG);
  let wb;
  try {
    wb = XLSX.read(data, { cellStyles: false });
  } catch (_e) {
    throw fail('TRACKER_UNREADABLE', UNREADABLE_MSG);
  }
  if (!wb || !Array.isArray(wb.SheetNames)) throw fail('TRACKER_UNREADABLE', UNREADABLE_MSG);

  const { H, P } = locateSheets(wb, XLSX);
  if (!H && !P) {
    // Old-format check AFTER the new-format search: a new workbook that happens to keep
    // an old sheet around still parses; only a workbook with nothing new is "old".
    if (wb.SheetNames.some((n) => OLD_SHEETS.includes(oneLine(n)))) {
      throw fail('TRACKER_OLD_FORMAT', OLD_FORMAT_MSG);
    }
    throw fail('TRACKER_UNKNOWN_FORMAT', UNKNOWN_FORMAT_MSG);
  }

  const warnings = [];
  const date1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
  const hRows = H ? readRows(wb.Sheets[H.name], XLSX, H.hdr, date1904) : [];
  const pRows = P ? readRows(wb.Sheets[P.name], XLSX, P.hdr, date1904) : [];
  if (!H) warnings.push('ورقة «Hierarchical Tracker» غير موجودة في الملف — أُخذت المهام من «Portfolio Tracker» وحدها، والحقول التفصيلية (Workstream، Predecessor، Next Action…) فارغة.');
  if (!P) warnings.push('ورقة «Portfolio Tracker» غير موجودة في الملف — المهام بلا مسار ولا مرحلة، وبترتيب «Hierarchical Tracker».');

  const dupes = (rows, sheet) => {
    const seen = new Set();
    const rep = new Set();
    for (const r of rows) if (r.wbs) (seen.has(r.wbs) ? rep : seen).add(r.wbs);
    for (const w of rep) warnings.push(`رقم WBS مكرر في ورقة «${sheet}»: ${w} — رُبطت الصفوف بالترتيب.`);
  };
  dupes(hRows, 'Hierarchical Tracker');
  dupes(pRows, 'Portfolio Tracker');

  // WBS -> queue of Hierarchical rows; a repeated WBS pairs with Portfolio rows in order.
  const hByWbs = new Map();
  for (const h of hRows) {
    if (!h.wbs) continue;
    if (!hByWbs.has(h.wbs)) hByWbs.set(h.wbs, []);
    hByWbs.get(h.wbs).push(h);
  }
  const used = new Set();
  const tasks = [];
  for (const p of pRows) {
    const queue = p.wbs ? hByWbs.get(p.wbs) : null;
    const h = queue && queue.length ? queue.shift() : null;
    if (h) used.add(h);
    else if (H) {
      const label = p.wbs || `صف ${p._row}`;
      warnings.push(`المهمة ${label} موجودة في «Portfolio Tracker» فقط (لا تقابلها مهمة في «Hierarchical Tracker») — أُخذت بياناتها من Portfolio${isNotFound(p.status) || !p.status ? ' وحالتها فارغة' : ''}.`);
    }
    tasks.push(joinRow(p, h, warnings));
  }
  for (const h of hRows) {
    if (used.has(h)) continue;
    if (P) warnings.push(`المهمة ${h.wbs || `صف ${h._row}`} موجودة في «Hierarchical Tracker» فقط — أُضيفت في آخر القائمة بلا مسار ولا مرحلة.`);
    tasks.push(joinRow(null, h, warnings));
  }
  if (!tasks.length) warnings.push('لا توجد مهام في الملف.');

  const now = opts.now != null ? new Date(opts.now) : new Date();
  return {
    format: TRACKER_FORMAT,
    fileName: typeof opts.fileName === 'string' && opts.fileName ? opts.fileName : null,
    loadedAt: now.toISOString(),
    editedAt: null,
    warnings,
    tasks: assignIds(tasks),
  };
}

// ---- document shape (shared with store.js and the editor) ------------------------------

/** True for a tagged ProjectTracker (the shape check every cache read site applies). */
export function isProjectTracker(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    && v.format === TRACKER_FORMAT && Array.isArray(v.tasks);
}

const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/**
 * A clean, JSON-safe copy of a ProjectTracker: exactly the documented keys, every task
 * field a string, ids non-empty and unique (repaired in place of a blank / repeated id).
 * Unknown keys — at the top level and on tasks — are DROPPED: the store's "only known
 * config persists" invariant applies to this document too, so nothing a page or a
 * hand-edited backup attaches rides into localStorage. Returns null for anything that
 * is not a tagged ProjectTracker (the old untagged shape included).
 * @param {*} v
 * @returns {import('../contracts.js').ProjectTracker|null}
 */
export function normalizeProjectTracker(v) {
  if (!isProjectTracker(v)) return null;
  const tasks = v.tasks
    .filter((t) => t !== null && typeof t === 'object' && !Array.isArray(t))
    .map((t) => {
      const o = {};
      for (const f of TASK_FIELDS) o[f] = str(t[f]);
      return o;
    });
  const used = new Set();
  tasks.forEach((t, i) => {
    let id = t.id || t.wbs || `row-${i + 1}`;
    const base = id;
    for (let n = 2; used.has(id); n++) id = `${base}#${n}`;
    used.add(id);
    t.id = id;
  });
  return {
    format: TRACKER_FORMAT,
    fileName: typeof v.fileName === 'string' && v.fileName ? v.fileName : null,
    loadedAt: typeof v.loadedAt === 'string' ? v.loadedAt : '',
    editedAt: typeof v.editedAt === 'string' && v.editedAt ? v.editedAt : null,
    warnings: Array.isArray(v.warnings) ? v.warnings.filter((w) => typeof w === 'string') : [],
    tasks,
  };
}

/**
 * A blank task for the editor's «add row», with an id no existing task uses. Ids of
 * added rows are 'new-1', 'new-2', … — never a WBS, so typing a WBS later cannot collide.
 * @param {{id:string}[]} [existing]
 */
export function newTask(existing = []) {
  const used = new Set((existing || []).map((t) => t && t.id));
  let n = 1;
  while (used.has(`new-${n}`)) n++;
  const t = emptyTaskFields();
  t.id = `new-${n}`;
  return t;
}
