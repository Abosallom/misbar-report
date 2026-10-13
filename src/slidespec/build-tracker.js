// src/slidespec/build-tracker.js
// buildTrackerSlides(tracker, { reportDate, variant, labels }) -> SlideSpec[] — «متابعة المشروع».
//
// THE PROJECT TASK TRACKER (the MISBAR Task Tracker workbook, src/ingest/task-tracker.js →
// ProjectTracker, possibly edited on the review screen) laid out as the workbook's own
// PORTFOLIO view: rows grouped Track → Milestone with merged (rowSpan) group cells, eight
// columns right → left: المسار · المرحلة · المهمة / المخرج · الجهة · المسؤول · الأولوية ·
// الحالة · الاستحقاق. WBS, work package, task type and the Hierarchical-only fields stay off
// the slide (all of them are still editable on the website).
//
// ONE builder for all three decks. build-spec.js (KAMC / SGH) puts these slides where the old
// «المهام» action slide was; build-spec-both.js (the main KAMC + SGH deck) puts them after
// compliance, before thanks. Both gate them on reportOptions.slides.tracker (absent ⇒ ON).
// THE VARIANT CHANGES NOTHING: the tracker is the NUPCO ↔ Lean project plan, so the internal
// and the NUPCO decks print the same rows (user rule) — `variant` is accepted for call-site
// parity and ignored, and no slide here is internalOnly.
// No tracker, or a tracker with no task to show → [] (no slide, no gap in the numbering).
//
// IMPORTS NOTHING FROM build-spec.js: build-spec.js ↔ build-spec-both.js already form an ESM
// cycle, and both import this file, so it must be a leaf. chrome() is therefore a local copy
// (same geometry as build-spec.js chrome). Page numbers (and the scoped-report pill) are NOT
// emitted here — the deck's post-pass appends them after slide filtering, like every slide.
//
// GEOMETRY (inches, 13.333 × 7.5 deck) and every colour below are the approved design
// (tracker map/slide-design.md). The numbers that matter:
//   · rows are authored at 0.37 per one-line row + 0.24 per extra wrapped line. That is what
//     QuickLook actually draws at 9 pt (it ignores per-cell margins and grows any thinner
//     row) and it is no smaller than PowerPoint's minimum, so the AUTHORED table height is
//     the DRAWN height in every renderer — which is what makes the 6.95 content floor and
//     the «يتبع…» marker under the table safe;
//   · line counts come from a deterministic width estimate (Cairo's ASCII advances at wght
//     400/700, 600/1000 em for anything else, ×1.03) — no font access needed, and it can
//     only over-count, which costs space, never an overflow;
//   · a cell longer than MAX_BODY_LINES (a group label longer than MAX_LABEL_LINES) is cut
//     at a word and ends in «…». That bound is what keeps ANY row inside a page, however
//     long the text typed on the website; the full text stays in the tracker.
import { COLORS as C } from '../theme.js?v=v2026-10-13.2';

// ---- labels (registry keys; build-spec.js DEFAULT_LABELS spreads this object so the
// labels editor reaches them and an override reaches all three decks) ------------------
export const TRACKER_LABELS = Object.freeze({
  titleTracker: 'متابعة المشروع',
  titleTrackerCont: 'متابعة المشروع — تتمة',
  trkTrack: 'المسار',
  trkMilestone: 'المرحلة',
  trkTask: 'المهمة / المخرج',
  trkOrg: 'الجهة',
  trkOwner: 'المسؤول',
  trkPriority: 'الأولوية',
  trkStatus: 'الحالة',
  // «الاستحقاق», not «تاريخ الاستحقاق»: the long form is ≈1.18in at 9pt bold and the date
  // column has 0.80in of text width.
  trkDue: 'الاستحقاق',
  trkTotal: 'إجمالي المهام',
  trkOverdue: 'متجاوزة الموعد',
});
// The deck's continuation idiom (build-spec.js uses the same literal under its tables).
const MORE = 'يتبع…';
const DASH = '–';            // U+2013, the deck's n/a mark
const NA = '#94A3B8';        // n/a ink (= build-spec-both NA_GREY)

// ---- design constants ---------------------------------------------------------------
export const TR = Object.freeze({
  x: 0.433, w: 12.467,                 // symmetric: 13.333 − 2×0.433; right edge 12.90
  // LOGICAL order (RTL, right → left): track, milestone, task, org, owner, priority, status, due
  colW: Object.freeze([0.92, 0.92, 4.607, 1.05, 1.98, 0.82, 1.17, 1.0]),   // Σ 12.467
  body: 9, head: 9,
  headH: 0.37, rowH: 0.37, lineH: 0.24,
  firstY: 1.16, contY: 1.0, floor: 6.95, markerH: 0.24,
  stripY: 0.80, stripH: 0.28, chipW: 1.25, chipGap: 0.10, overdueGap: 0.30,
  groupSep: Object.freeze({ color: '#94A3B8', pt: 1.25 }),   // = build-spec-both GROUP_SEP
  trackFill: '#4472C4', trackInk: '#FFFFFF',                 // workbook Portfolio A cells
  msFill: '#D9E1F2', msInk: '#1F4E78',                       // workbook Portfolio B cells
});
const COL = { track: 0, milestone: 1, task: 2, org: 3, owner: 4, priority: 5, status: 6, due: 7 };
// pptxgenjs' default cell insets are 0.1in left + right, and QuickLook always insets ≈0.1in
// whatever the XML says — so a column's usable text width is colW − 0.20 everywhere.
const CELL_PAD = 0.2;
const MAX_BODY_LINES = 4;    // a body cell is cut to 4 lines (row 1.09in)
const MAX_LABEL_LINES = 4;   // a track / milestone label too
const MAX_HEAD_LINES = 2;    // an overridden header label

const r5 = (v) => Math.round(v * 1e5) / 1e5;
const rect = (x, y, w, h, fill, extra = {}) => ({ t: 'rect', x: r5(x), y: r5(y), w: r5(w), h: r5(h), fill, ...extra });
const text = (x, y, w, h, t, size, o = {}) => ({ t: 'text', x: r5(x), y: r5(y), w: r5(w), h: r5(h), text: t, size, ...o });
const rev = (a) => a.slice().reverse();
const sum = (a) => a.reduce((s, v) => s + v, 0);
const rowHFor = (lines) => r5(TR.rowH + (lines - 1) * TR.lineH);   // 1 → 0.37, 2 → 0.61 …

/** build-spec.js chrome(), verbatim: top bar, title, corner tags, footer rule. */
function chrome(title) {
  return [
    rect(0, 0, 13.333, 0.08, C.navy),
    text(0.5, 0.25, 12.3, 0.55, title, 22, { bold: true, color: C.navy, align: 'center', valign: 'middle', rtl: true }),
    text(10.9, 0.3, 2.0, 0.4, 'NUPCO  |  Lean', 10, { color: C.slate500, align: 'right', valign: 'middle' }),
    text(0.4, 0.3, 3.5, 0.4, 'مسبار', 10, { color: C.slate500, align: 'left', valign: 'middle', rtl: true }),
    rect(0.5, 7.1, 12.3, 0.012, C.border),
  ];
}

// ---- vocabularies ---------------------------------------------------------------------
// Status fills/inks are the workbook's own conditional formats (Hierarchical!I). Delayed has
// no rule there (the file even spells it «Deleyed»), so it gets Excel's orange tint pair,
// between On Hold (amber) and Blocked (red). Arabic words are masculine, like the old deck.
// The status is a CELL FILL (not an overlaid shape), so it cannot drift from its row.
const STATUS = {
  completed: { ar: 'مكتمل', fill: '#C6EFCE', color: '#006100' },
  inProgress: { ar: 'قيد التنفيذ', fill: '#DDEBF7', color: '#1F4E78' },
  delayed: { ar: 'متأخر', fill: '#FCE4D6', color: '#C55A11' },
  blocked: { ar: 'متوقف', fill: '#FFC7CE', color: '#9C0006' },
  onHold: { ar: 'معلّق', fill: '#FFF2CC', color: '#7F6000' },
  notStarted: { ar: 'لم يبدأ', fill: '#E7E6E6', color: '#404040' },
};
const NEUTRAL_CHIP = { fill: '#F1F5F9', color: '#64748B' };
// Summary-strip order. 'other' = a status outside the vocabulary (printed VERBATIM in its
// cell — the file's words are never guessed at); 'unset' = blank or the Portfolio sheet's
// «Not Found» (printed «–»).
const STATUS_ORDER = ['completed', 'inProgress', 'delayed', 'blocked', 'onHold', 'notStarted', 'other', 'unset'];
const CHIP_WORD = { other: 'أخرى', unset: 'غير محدد' };
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
// English as the workbook writes it (incl. its 'Deleyed'), plus the Arabic words themselves,
// so a status typed in Arabic on the website lands in the same bucket.
const STATUS_ALIASES = {
  completed: 'completed', complete: 'completed', done: 'completed', 'مكتمل': 'completed', 'مكتملة': 'completed',
  'in progress': 'inProgress', 'قيد التنفيذ': 'inProgress',
  delayed: 'delayed', deleyed: 'delayed', 'متأخر': 'delayed', 'متأخرة': 'delayed',
  blocked: 'blocked', 'متوقف': 'blocked', 'متوقفة': 'blocked',
  'on hold': 'onHold', 'معلّق': 'onHold', 'معلق': 'onHold',
  'not started': 'notStarted', 'لم يبدأ': 'notStarted', 'لم تبدأ': 'notStarted',
};
export function statusKey(s) {
  const k = norm(s);
  if (!k || k === 'not found') return 'unset';
  return STATUS_ALIASES[k] || 'other';
}
// Priority is text only (no fill) so the status column stays the only filled one.
const PRIORITY = {
  critical: { ar: 'حرجة', color: '#C00000', bold: true },
  high: { ar: 'عالية', color: C.slate900, bold: false },
  medium: { ar: 'متوسطة', color: C.slate600, bold: false },
  low: { ar: 'منخفضة', color: C.slate500, bold: false },
};
const PRIORITY_ALIASES = {
  critical: 'critical', 'حرجة': 'critical', high: 'high', 'عالية': 'high',
  medium: 'medium', 'متوسطة': 'medium', low: 'low', 'منخفضة': 'low',
};

// ---- dates -------------------------------------------------------------------------------
const isRealDate = (y, mo, d) => {
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};
/**
 * Due-date cell. ISO 'yyyy-mm-dd' (the parser's form for a real date, and the date picker's)
 * and day-first 'd/m/yyyy' text (also '.' / '-') → 'dd/mm/yyyy' plus its ISO for the overdue
 * test; any other text ('daily') → verbatim, never overdue; blank → «–».
 * Compact dd/mm/yyyy (not the deck's spaced form): the spaced one does not fit the column.
 */
export function formatDue(v) {
  const s = String(v ?? '').trim();
  if (!s) return { text: DASH, iso: null, kind: 'blank' };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ][\d:.]+Z?)?$/);
  if (m && isRealDate(+m[1], +m[2], +m[3])) {
    const mo = m[2].padStart(2, '0'), d = m[3].padStart(2, '0');
    return { text: `${d}/${mo}/${m[1]}`, iso: `${m[1]}-${mo}-${d}`, kind: 'date' };
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m && isRealDate(+m[3], +m[2], +m[1])) {
    const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0');
    return { text: `${d}/${mo}/${m[3]}`, iso: `${m[3]}-${mo}-${d}`, kind: 'date' };
  }
  return { text: s.replace(/\s+/g, ' '), iso: null, kind: 'free' };
}
const isIso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/**
 * OVERDUE = a due date strictly before the REPORT date (not today's date: a re-run of an old
 * report must print what that report said; a scoped range's reportDate is already its 'to')
 * on a task that is not Completed. An unset / unknown status counts as not completed.
 */
export function isOverdue(task, reportDate) {
  if (!isIso(reportDate)) return false;
  const due = formatDue(task?.due);
  return !!due.iso && due.iso < reportDate && statusKey(task?.status) !== 'completed';
}

// ---- width estimate + wrap ------------------------------------------------------------------
// Cairo advances (1/1000 em) for ASCII 32..126 at wght 400 and 700, instanced from the
// variable font the renderers embed. Anything else (Arabic, accents, symbols) counts 600 —
// an upper bound for Arabic, whose connected forms are narrower than the isolated ones.
const ADV400 = [220, 249, 375, 560, 560, 560, 689, 209, 266, 266, 420, 560, 225, 436, 218, 415, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560, 219, 250, 560, 560, 560, 446, 976, 596, 615, 544, 644, 553, 526, 616, 675, 248, 289, 570, 478, 841, 677, 660, 592, 660, 616, 542, 526, 645, 583, 888, 559, 539, 536, 330, 439, 330, 560, 631, 238, 502, 527, 436, 530, 505, 332, 515, 538, 221, 221, 481, 233, 836, 538, 529, 528, 527, 347, 466, 351, 532, 482, 763, 453, 484, 455, 352, 232, 352, 560];
const ADV700 = [218, 265, 439, 556, 556, 600, 694, 231, 289, 289, 418, 556, 249, 405, 242, 467, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 245, 267, 556, 556, 556, 456, 995, 612, 612, 540, 648, 551, 524, 617, 667, 265, 301, 585, 482, 846, 681, 664, 600, 663, 616, 556, 523, 643, 589, 898, 568, 558, 549, 334, 481, 333, 588, 619, 309, 523, 543, 447, 545, 523, 342, 533, 553, 244, 244, 508, 251, 846, 553, 542, 544, 543, 355, 475, 359, 549, 507, 774, 485, 508, 472, 355, 253, 355, 556];
const SAFETY = 1.03;
/** Estimated ink width (inches) of a string at `pt`. */
export function textWidth(t, pt = TR.body, bold = false) {
  const a = bold ? ADV700 : ADV400;
  let u = 0;
  for (const ch of String(t)) { const c = ch.codePointAt(0); u += (c >= 32 && c <= 126) ? a[c - 32] : 600; }
  return (u / 1000) * (pt / 72) * SAFETY;
}
/** Trim + collapse every whitespace run (incl. newlines) to one space. */
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
/**
 * Greedy word wrap against `usable` inches. Returns the line strings; a word wider than a
 * whole line is broken by characters (a renderer breaks it too). Never empty: '' → [''].
 */
function wrapLines(s, usable, pt, bold) {
  if (!s) return [''];
  const lines = [];
  let cur = '';
  for (const word of s.split(' ')) {
    if (cur && textWidth(`${cur} ${word}`, pt, bold) <= usable) { cur += ` ${word}`; continue; }
    if (cur) lines.push(cur);
    let chars = Array.from(word);
    while (chars.length > 1 && textWidth(chars.join(''), pt, bold) > usable) {
      let k = 1;
      while (k < chars.length - 1 && textWidth(chars.slice(0, k + 1).join(''), pt, bold) <= usable) k++;
      lines.push(chars.slice(0, k).join(''));
      chars = chars.slice(k);
    }
    cur = chars.join('');
  }
  lines.push(cur);
  return lines;
}
/**
 * A cell's text and its estimated line count, cut to `maxLines` lines ending in «…» when it
 * runs longer. The cut text is a PREFIX of the original (spaces where the wrap broke at a
 * word, none where it broke inside one), so a renderer re-wrapping it — and fitting at least
 * as much per line as the conservative estimate — never needs more than `maxLines` lines.
 */
export function fitCell(value, colW, { bold = false, pt = TR.body, maxLines = MAX_BODY_LINES } = {}) {
  const s = clean(value);
  const usable = colW - CELL_PAD;
  const lines = wrapLines(s, usable, pt, bold);
  if (lines.length <= maxLines) return { text: s, lines: lines.length };
  let pos = 0;
  for (let i = 0; i < maxLines - 1; i++) {
    pos += lines[i].length;
    if (s[pos] === ' ') pos += 1;
  }
  let last = Array.from(lines[maxLines - 1]);
  while (last.length && textWidth(`${last.join('').trimEnd()}…`, pt, bold) > usable) last.pop();
  const cut = (s.slice(0, pos) + last.join('')).trimEnd();
  return { text: `${cut}…`, lines: maxLines };
}
// Arabic text sets right-aligned RTL; Latin prose reads better left-aligned ragged-right.
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const dirOf = (s) => (ARABIC.test(s) ? { align: 'right', rtl: true } : { align: 'left', rtl: false });

// ---- rows ---------------------------------------------------------------------------------
// The eight on-slide fields. A row whose on-slide fields are ALL empty (a row just added on
// the website and not filled in yet) prints nothing and is skipped; every other row prints,
// in the tracker's order.
const SLIDE_FIELDS = ['track', 'milestone', 'task', 'organization', 'owner', 'priority', 'status', 'due'];
const isBlankRow = (t) => SLIDE_FIELDS.every((k) => !clean(t?.[k]));

/** Per-row layout facts that do not depend on the page: texts, styles, line counts. */
function prepareRow(t, reportDate) {
  const W = TR.colW;
  const track = fitCell(t.track || DASH, W[COL.track], { bold: true, maxLines: MAX_LABEL_LINES });
  const milestone = fitCell(t.milestone || DASH, W[COL.milestone], { bold: true, maxLines: MAX_LABEL_LINES });
  const task = fitCell(t.task || DASH, W[COL.task]);
  const org = fitCell(t.organization || DASH, W[COL.org]);
  const owner = fitCell(t.owner || DASH, W[COL.owner]);

  const sk = statusKey(t.status);
  const st = STATUS[sk];
  const status = fitCell(st ? st.ar : sk === 'other' ? t.status : DASH, W[COL.status], { bold: true });
  const pk = PRIORITY_ALIASES[norm(t.priority)];
  const pr = pk ? PRIORITY[pk] : null;
  const priority = fitCell(pr ? pr.ar : (t.priority || DASH), W[COL.priority], { bold: !!pr?.bold });
  const due = formatDue(t.due);
  const overdue = isOverdue(t, reportDate);
  const dueCell = fitCell(due.text, W[COL.due], { bold: overdue });

  const cells = {
    task: { text: task.text, ...(clean(t.task) ? dirOf(task.text) : { color: NA }) },
    org: { text: org.text, color: clean(t.organization) ? C.slate600 : NA },
    owner: { text: owner.text, ...(clean(t.owner) ? dirOf(owner.text) : { color: NA }) },
    priority: pr ? { text: priority.text, color: pr.color, bold: pr.bold }
      : { text: priority.text, color: NA },
    status: st ? { text: status.text, fill: st.fill, color: st.color, bold: true }
      // Unknown words print VERBATIM in a neutral (unfilled) style; blank / «Not Found» → «–».
      : { text: status.text, color: sk === 'other' ? C.slate500 : NA, bold: true },
    due: overdue ? { text: dueCell.text, color: C.red, bold: true }
      : due.kind === 'blank' ? { text: dueCell.text, color: NA }
        : due.kind === 'free' ? { text: dueCell.text, color: C.slate500, italic: true }
          : { text: dueCell.text },
  };
  return {
    trackKey: clean(t.track),
    msKey: clean(t.milestone),
    trackLabel: track,
    msLabel: milestone,
    lines: Math.max(task.lines, org.lines, owner.lines, status.lines, priority.lines, dueCell.lines),
    cells,
    statusKey: sk,
    overdue,
  };
}

// Run length of equal keys from row i.
function runFrom(rows, i, sameMs) {
  let n = 1;
  while (i + n < rows.length && rows[i + n].trackKey === rows[i].trackKey
    && (!sameMs || rows[i + n].msKey === rows[i].msKey)) n++;
  return n;
}

/**
 * Body row heights for ONE page: each row's own line count, then — milestone blocks first,
 * track blocks second — the shortfall of a merged block too short for its own (bold,
 * wrapped) label is added to the block's LAST row, so the label never overflows its cell.
 */
function pageHeights(pr) {
  const h = pr.map((r) => rowHFor(r.lines));
  const grow = (sameMs, labelOf) => {
    for (let i = 0; i < pr.length;) {
      const n = runFrom(pr, i, sameMs);
      const need = rowHFor(labelOf(pr[i]).lines);
      const have = sum(h.slice(i, i + n));
      if (have < need) h[i + n - 1] = r5(h[i + n - 1] + (need - have));
      i += n;
    }
  };
  grow(true, (r) => r.msLabel);
  grow(false, (r) => r.trackLabel);
  return h;
}

/**
 * PAGINATION — the fewest slides first; among equal slide counts, every track kept whole.
 * A page's band is floor − table top − header − (the «يتبع…» marker when a page follows).
 * Real file (34 rows): 3 slides 12 / 7 / 15, no track split.
 */
function paginate(rows, headH) {
  const together = paginateGroups(rows, headH, true);
  const filled = paginateGroups(rows, headH, false);
  return filled.length < together.length ? filled : together;
}
function paginateGroups(rows, headH, keepTogether) {
  const groups = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.key === r.trackKey) g.rows.push(r); else groups.push({ key: r.trackKey, rows: [r] });
  }
  const cap = (first, last) => r5(TR.floor - (first ? TR.firstY : TR.contY) - headH - (last ? 0 : TR.markerH));
  const fits = (pageRows, first, last) => sum(pageHeights(pageRows)) <= cap(first, last) + 1e-9;
  const pages = [[]];
  groups.forEach((g, gi) => {
    const lastGroup = gi === groups.length - 1;
    const cur = pages[pages.length - 1];
    const first = pages.length === 1;
    // 1. the whole group fits on the current page
    if (fits([...cur, ...g.rows], first, lastGroup)) { cur.push(...g.rows); return; }
    // 2. the whole group fits on a fresh continuation page → start one
    if (keepTogether && cur.length && fits(g.rows, false, lastGroup)) { pages.push([...g.rows]); return; }
    // 3. split row by row: a row that does not fit opens a new page. Any single row fits an
    //    empty page (cells are cut at MAX_BODY_LINES / MAX_LABEL_LINES).
    g.rows.forEach((r, k) => {
      const p = pages[pages.length - 1];
      const isLast = lastGroup && k === g.rows.length - 1;
      if (p.length && !fits([...p, r], pages.length === 1, isLast)) pages.push([r]);
      else p.push(r);
    });
  });
  return pages.filter((p) => p.length);
}

function trackerTable(pr, y, header, headH) {
  const out = [rev(header.map((h) => h.text))];
  const rowH = [headH, ...pageHeights(pr)];
  pr.forEach((r, i) => {
    const newTrack = i === 0 || pr[i - 1].trackKey !== r.trackKey;
    const newMs = newTrack || pr[i - 1].msKey !== r.msKey;
    // A 1.25pt line above each new track (not above the page's first row: the header is there).
    const top = newTrack && i > 0 ? { border: { top: { ...TR.groupSep } } } : {};
    const cell = (o) => ({ color: C.slate900, ...top, ...o });
    const logical = [];
    // Merged group cells: only on the group's first row ON THIS PAGE, rowSpan = its rows on
    // this page; the covered cells are omitted (schema). A group continuing from the previous
    // slide repeats its label here — the title already says تتمة.
    if (newTrack) logical.push(cell({ text: r.trackLabel.text, rowSpan: runFrom(pr, i, false), fill: TR.trackFill, color: TR.trackInk, bold: true }));
    if (newMs) logical.push(cell({ text: r.msLabel.text, rowSpan: runFrom(pr, i, true), fill: TR.msFill, color: TR.msInk, bold: true }));
    const c = r.cells;
    logical.push(cell(c.task), cell(c.org), cell(c.owner), cell(c.priority), cell(c.status), cell(c.due));
    // Group cells are the two LAST cells in visual (L→R) order, so omitting a covered one
    // never shifts another cell of the row.
    out.push(rev(logical));
  });
  return {
    t: 'table', x: TR.x, y, w: TR.w, rtl: true, rowH, headerSize: TR.head, bodySize: TR.body,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev(TR.colW),
    rows: out,
  };
}

// Chip text is ONE line in a 0.28in pill (margin 0, which PowerPoint and QuickLook honour on
// a plain text box), so a chip is measured on its own. Measured with CoreText on the
// installed Cairo variable font at wght 700 (2026-10-13): Arabic labels average 520–530/1000
// em per letter, short words up to ~680 (مكتمل 642, متوقف 680); «…» is 784. 600 per Arabic
// letter + CHIP_PAD keeps long labels ~14% on the safe side and a short word's shortfall
// (≤ 5 letters × 80) inside the pad. ASCII (digits, space, Latin) uses the exact advances.
const CHIP_ARABIC_ADV = 600;
const CHIP_ELLIPSIS_ADV = 800;
export const CHIP_PAD = 0.06;
export function chipTextWidth(t, pt = 9) {
  let u = 0;
  for (const ch of String(t)) {
    const c = ch.codePointAt(0);
    u += (c >= 32 && c <= 126) ? ADV700[c - 32] : ch === '…' ? CHIP_ELLIPSIS_ADV : CHIP_ARABIC_ADV;
  }
  return (u / 1000) * (pt / 72);
}
/**
 * Pill widths for the chips' text needs within `avail` inches:
 *  · every need fits the design width (1.25in, narrowed evenly only past nine chips) → all
 *    chips get it — the approved look, byte-for-byte;
 *  · otherwise a wider chip grows; the rest keep the even width while the strip has room,
 *    and give up their slack (never below their own need) when it has not;
 *  · when even the needs exceed the strip, the widest are capped first (water-filling) and
 *    fitChip() cuts their label.
 */
function chipWidths(needs, avail) {
  const base = Math.min(TR.chipW, avail / needs.length);
  if (needs.every((n) => n <= base)) return needs.map(() => base);
  const want = needs.map((n) => Math.max(base, n));
  if (sum(want) <= avail) return want;
  if (sum(needs) <= avail) {
    // Level L with Σ max(need, L) = avail: the widest needs keep their width, the rest share.
    const desc = needs.slice().sort((x, y) => y - x);
    let rest = avail;
    let k = desc.length;
    for (const n of desc) {
      if (n <= rest / k) break;
      rest -= n; k -= 1;
    }
    const level = rest / k;
    return needs.map((n) => Math.max(n, level));
  }
  const asc = needs.slice().sort((x, y) => x - y);
  let rest = avail;
  let cap = base;
  for (let i = 0; i < asc.length; i++) {
    const share = rest / (asc.length - i);
    if (asc[i] > share) { cap = share; break; }
    rest -= asc[i];
  }
  return needs.map((n) => Math.min(n, cap));
}
/** `label count` cut to `w` — the LABEL loses letters (ending «…»), the count never does. */
function fitChip(label, count, w) {
  const full = `${label} ${count}`;
  if (chipTextWidth(full) + CHIP_PAD <= w + 1e-9) return full;
  const chars = Array.from(String(label));
  while (chars.length && chipTextWidth(`${chars.join('').trimEnd()}… ${count}`) + CHIP_PAD > w) chars.pop();
  return chars.length ? `${chars.join('').trimEnd()}… ${count}` : String(count);
}

/**
 * First-slide summary strip: «إجمالي المهام N», one chip per status present (STATUS_ORDER),
 * then «متجاوزة الموعد N» after a wider gap (its red is the legend of the red dates).
 * Right-anchored at the table's right edge, running leftwards; counts are over ALL rows.
 * Chips are 1.25in and narrow evenly only when more than the design's nine are needed; the
 * total / overdue labels are user-overridable (labels editor), so a chip whose text is wider
 * grows into the strip's spare room and, when there is none, its label is cut with «…» —
 * the text always stays on one line inside its pill (never into the title or the table).
 */
function strip(rows, L) {
  const counts = {};
  for (const r of rows) counts[r.statusKey] = (counts[r.statusKey] || 0) + 1;
  const overdue = rows.filter((r) => r.overdue).length;
  const chips = [{ label: L('trkTotal'), n: rows.length, fill: C.navy, color: C.white, gap: 0 }];
  for (const k of STATUS_ORDER) {
    if (!counts[k]) continue;
    const s = STATUS[k] ? { ar: STATUS[k].ar, fill: STATUS[k].fill, color: STATUS[k].color } : { ar: CHIP_WORD[k], ...NEUTRAL_CHIP };
    chips.push({ label: s.ar, n: counts[k], fill: s.fill, color: s.color, gap: TR.chipGap });
  }
  if (overdue) chips.push({ label: L('trkOverdue'), n: overdue, fill: C.bgRed, color: C.red, gap: TR.overdueGap });
  for (const c of chips) c.label = clean(c.label);
  const avail = TR.w - sum(chips.map((c) => c.gap));
  const widths = chipWidths(chips.map((c) => chipTextWidth(`${c.label} ${c.n}`) + CHIP_PAD), avail);
  const els = [];
  let right = TR.x + TR.w;
  chips.forEach((c, i) => {
    right -= c.gap;
    const w = widths[i];
    const x = right - w;
    els.push(rect(x, TR.stripY, w, TR.stripH, c.fill, { radius: TR.stripH / 2 }));
    els.push(text(x, TR.stripY, w, TR.stripH, fitChip(c.label, c.n, w), 9, { bold: true, color: c.color, align: 'center', valign: 'middle', rtl: true, margin: 0 }));
    right = x;
  });
  return els;
}

/** A label lookup from a labelOf()-style function or an overrides object. */
function labelLookup(labels) {
  if (typeof labels === 'function') return (k) => labels(k) ?? TRACKER_LABELS[k];
  return (k) => labels?.[k] ?? TRACKER_LABELS[k];
}

/**
 * @param {Object|null} tracker   ProjectTracker ({ format, tasks:[{track, milestone, task,
 *                                organization, owner, priority, status, due, …}] }) or null
 * @param {{reportDate?:string, variant?:string, labels?:Function|Object}} [opts]
 *        reportDate 'YYYY-MM-DD' — the overdue reference; labels — labelOf(m) or an
 *        overrides map; variant — ignored (the tracker is the same in both decks)
 * @returns {Array} slides ('tracker', 'tracker-cont-1', …) without page numbers; [] when
 *          there is nothing to show
 */
// eslint-disable-next-line no-unused-vars
export function buildTrackerSlides(tracker, { reportDate, variant, labels } = {}) {
  const tasks = Array.isArray(tracker?.tasks) ? tracker.tasks.filter((t) => t && typeof t === 'object' && !isBlankRow(t)) : [];
  if (!tasks.length) return [];
  const L = labelLookup(labels);
  const rows = tasks.map((t) => prepareRow(t, reportDate));
  const headKeys = ['trkTrack', 'trkMilestone', 'trkTask', 'trkOrg', 'trkOwner', 'trkPriority', 'trkStatus', 'trkDue'];
  const header = headKeys.map((k, i) => fitCell(L(k), TR.colW[i], { bold: true, pt: TR.head, maxLines: MAX_HEAD_LINES }));
  const headH = rowHFor(Math.max(...header.map((h) => h.lines)));
  const pages = paginate(rows, headH);
  return pages.map((p, i) => {
    const first = i === 0;
    const last = i === pages.length - 1;
    const y = first ? TR.firstY : TR.contY;
    const table = trackerTable(p, y, header, headH);
    const els = [...chrome(first ? L('titleTracker') : L('titleTrackerCont'))];
    if (first) els.push(...strip(rows, L));
    els.push(table);
    if (!last) {
      els.push(text(TR.x, y + sum(table.rowH), TR.w, TR.markerH, MORE, 9,
        { italic: true, color: C.slate600, align: 'center', valign: 'middle', rtl: true }));
    }
    return { id: first ? 'tracker' : `tracker-cont-${i}`, bg: C.white, elements: els };
  });
}

export default buildTrackerSlides;
