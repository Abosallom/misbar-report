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
//
// LANGUAGE (reportOptions.trackerLang, 2026-10-13 user request: the tasks in Arabic with the
// English original kept). The task, track and milestone cells print, per `lang`:
//   · 'ar' (the default; anything unknown reads as 'ar') — the row's Arabic translation
//     (taskAr / trackAr / milestoneAr), falling back to the English PER CELL where it is '';
//   · 'en' — the English only: today's slides, byte for byte (nothing below reads an *Ar
//     field or the Arabic metrics in this mode);
//   · 'both' — the Arabic, and under it the English original smaller, grey and LTR. Table
//     cells take ONE style each in both renderers (a cell has no styled runs), so the two
//     lines are two cells: a translated task is TWO table rows — the Arabic task cell on the
//     first, the English one on the second, joined by suppressing the border between them —
//     with every other cell of the task spanning both; a translated group label is split the
//     same way inside its merged block (Arabic part bottom-aligned above the boundary nearest
//     the block's middle, English part top-aligned below it). A cell without a translation
//     (or whose translation equals the English) prints its text once, as in 'en'.
// Owner, organization, priority, status and dates never change with the language.
// An untranslated tracker therefore renders identically in all three modes.
// Arabic TRANSLATIONS are measured with real Cairo metrics (contextual forms, lam-alef, the
// font's one positive Arabic kern — shapedTextWidth below); every other cell keeps the
// legacy estimate, so the English / fallback layout never moves.
import { COLORS as C } from '../theme.js?v=v2026-10-13.6';

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
  // 'both': the English original under the Arabic — 8pt, grey (a light tint on the blue
  // track fill, where slate grey would not read), LTR. A table row holding only 8pt text
  // draws ≈0.316in in QuickLook (measured 2026-10-13: a 9pt + 8pt row pair drew 0.683, the
  // 9pt row alone 0.367) and 0.308 in PowerPoint (1.874em × 8pt + 0.1 insets); each extra
  // line is 1.874em = 0.208in → authored 0.33 + 0.215/line, never below what is drawn.
  enSize: 8, enRowH: 0.33, enLineH: 0.215,
  enInk: C.slate500, enTrackInk: '#DCE6F5', enMsInk: C.slate500,
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
const enRowHFor = (lines) => r5(TR.enRowH + (lines - 1) * TR.enLineH);   // 1 → 0.33, 2 → 0.545 …

// ---- language ---------------------------------------------------------------------------
export const TRACKER_SLIDE_LANGS = Object.freeze(['ar', 'en', 'both']);
/** reportOptions.trackerLang → 'ar' | 'en' | 'both'; absent / unknown → 'ar' (the default). */
export const trackerSlideLang = (v) => (v === 'en' || v === 'both' ? v : 'ar');

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
// SHAPED ARABIC WIDTHS for the Arabic translations (taskAr / trackAr / milestoneAr). The
// legacy 600-per-letter rule above is far off for Arabic either way — connected letters
// run 267..945 (medial ب 294, medial س 860), isolated س is 1211 — so a translation is
// measured the way a shaper sets it: each letter in its contextual form (isolated /
// initial / medial / final, from the letter's joining behaviour), lam + alef as the
// ligature, marks zero-width. Advances (1/1000 em) were read with fontTools from the Cairo
// variable font the decks use (~/Library/Fonts/Cairo-VariableFont_slnt,wght.ttf, instanced
// at wght 400 / 700, slnt 0 — like ADV400 / ADV700), from its init / medi / fina GSUB
// lookups and the rlig lam-alef ligatures. Rows: codepoint, isolated, initial, medial,
// final (0 = the letter has no such form). Checked against CoreText shaping the same font
// (2026-10-13; 1,390 phrases / words / random letter strings, both weights): estimate /
// real ≥ 0.9993 everywhere, median 1.000 — then ×1.03 like every estimate here.
const AR400 = [
  0x60C, 223, 0, 0, 0, 0x60D, 225, 0, 0, 0, 0x615, 0, 0, 0, 0, 0x61B, 250, 0, 0, 0, 0x61F, 446, 0, 0, 0, 0x621, 544, 0, 0, 0,
  0x622, 269, 0, 0, 295, 0x623, 269, 0, 0, 295, 0x624, 545, 0, 0, 578, 0x625, 269, 0, 0, 295, 0x626, 896, 267, 294, 884, 0x627, 269, 0, 0, 295,
  0x628, 790, 267, 294, 817, 0x629, 584, 0, 0, 578, 0x62A, 790, 267, 294, 817, 0x62B, 790, 267, 294, 817, 0x62C, 580, 555, 603, 628, 0x62D, 580, 555, 603, 628,
  0x62E, 580, 555, 603, 628, 0x62F, 483, 0, 0, 535, 0x630, 483, 0, 0, 535, 0x631, 263, 0, 0, 300, 0x632, 263, 0, 0, 300, 0x633, 1211, 827, 860, 1247,
  0x634, 1211, 827, 860, 1247, 0x635, 1191, 820, 853, 1224, 0x636, 1191, 820, 853, 1224, 0x637, 764, 743, 749, 797, 0x638, 764, 743, 749, 797, 0x639, 552, 592, 636, 631,
  0x63A, 552, 592, 636, 631, 0x640, 250, 0, 0, 0, 0x641, 1033, 607, 639, 1055, 0x642, 863, 607, 639, 895, 0x643, 784, 625, 658, 817, 0x644, 666, 275, 307, 699,
  0x645, 626, 642, 675, 659, 0x646, 666, 267, 294, 699, 0x647, 584, 796, 660, 578, 0x648, 545, 0, 0, 578, 0x649, 896, 267, 294, 884, 0x64A, 896, 267, 294, 884,
  0x64B, 0, 0, 0, 0, 0x64C, 0, 0, 0, 0, 0x64D, 0, 0, 0, 0, 0x64E, 0, 0, 0, 0, 0x64F, 0, 0, 0, 0, 0x650, 0, 0, 0, 0,
  0x651, 0, 0, 0, 0, 0x652, 0, 0, 0, 0, 0x653, 0, 0, 0, 0, 0x654, 0, 0, 0, 0, 0x655, 0, 0, 0, 0, 0x656, 0, 0, 0, 0,
  0x658, 0, 0, 0, 0, 0x660, 250, 0, 0, 0, 0x661, 309, 0, 0, 0, 0x662, 527, 0, 0, 0, 0x663, 676, 0, 0, 0, 0x664, 468, 0, 0, 0,
  0x665, 678, 0, 0, 0, 0x666, 482, 0, 0, 0, 0x667, 624, 0, 0, 0, 0x668, 624, 0, 0, 0, 0x669, 519, 0, 0, 0, 0x66A, 560, 0, 0, 0,
  0x66B, 225, 0, 0, 0, 0x66C, 193, 0, 0, 0, 0x66D, 420, 0, 0, 0, 0x66E, 790, 267, 294, 817, 0x66F, 863, 0, 0, 895, 0x670, 0, 0, 0, 0,
  0x671, 269, 0, 0, 295, 0x679, 790, 267, 294, 817, 0x67E, 790, 267, 294, 817, 0x686, 580, 555, 603, 628, 0x688, 483, 0, 0, 535, 0x691, 263, 0, 0, 300,
  0x698, 263, 0, 0, 300, 0x6A1, 1033, 607, 639, 1055, 0x6A4, 1033, 607, 639, 1055, 0x6A9, 784, 625, 658, 817, 0x6AF, 784, 675, 708, 817, 0x6BA, 666, 267, 294, 699,
  0x6BE, 787, 796, 819, 819, 0x6C1, 584, 267, 578, 578, 0x6C2, 584, 267, 578, 578, 0x6C3, 584, 0, 0, 578, 0x6CC, 896, 267, 294, 884, 0x6D2, 727, 0, 0, 706,
  0x6D3, 727, 0, 0, 706, 0x6D4, 369, 0, 0, 0, 0x6F0, 250, 0, 0, 0, 0x6F1, 309, 0, 0, 0, 0x6F2, 527, 0, 0, 0, 0x6F3, 676, 0, 0, 0,
  0x6F4, 664, 0, 0, 0, 0x6F5, 546, 0, 0, 0, 0x6F6, 478, 0, 0, 0, 0x6F7, 624, 0, 0, 0, 0x6F8, 624, 0, 0, 0, 0x6F9, 519, 0, 0, 0,
];
const AR700 = [
  0x60C, 248, 0, 0, 0, 0x60D, 249, 0, 0, 0, 0x615, 0, 0, 0, 0, 0x61B, 267, 0, 0, 0, 0x61F, 456, 0, 0, 0, 0x621, 578, 0, 0, 0,
  0x622, 313, 0, 0, 337, 0x623, 313, 0, 0, 337, 0x624, 583, 0, 0, 619, 0x625, 313, 0, 0, 337, 0x626, 950, 312, 344, 934, 0x627, 313, 0, 0, 337,
  0x628, 838, 312, 344, 882, 0x629, 627, 0, 0, 619, 0x62A, 838, 365, 417, 882, 0x62B, 838, 369, 417, 882, 0x62C, 611, 578, 624, 656, 0x62D, 611, 578, 624, 656,
  0x62E, 611, 578, 624, 656, 0x62F, 496, 0, 0, 551, 0x630, 496, 0, 0, 551, 0x631, 323, 0, 0, 361, 0x632, 323, 0, 0, 361, 0x633, 1283, 909, 945, 1324,
  0x634, 1283, 909, 945, 1324, 0x635, 1216, 846, 882, 1252, 0x636, 1216, 846, 882, 1252, 0x637, 808, 788, 802, 844, 0x638, 808, 788, 802, 844, 0x639, 571, 578, 668, 662,
  0x63A, 571, 578, 668, 662, 0x640, 250, 0, 0, 0, 0x641, 1051, 630, 665, 1076, 0x642, 912, 630, 665, 948, 0x643, 846, 661, 697, 882, 0x644, 699, 317, 352, 735,
  0x645, 665, 661, 697, 701, 0x646, 699, 312, 344, 735, 0x647, 627, 804, 686, 619, 0x648, 583, 0, 0, 619, 0x649, 950, 312, 344, 934, 0x64A, 950, 365, 417, 934,
  0x64B, 0, 0, 0, 0, 0x64C, 0, 0, 0, 0, 0x64D, 0, 0, 0, 0, 0x64E, 0, 0, 0, 0, 0x64F, 0, 0, 0, 0, 0x650, 0, 0, 0, 0,
  0x651, 0, 0, 0, 0, 0x652, 0, 0, 0, 0, 0x653, 0, 0, 0, 0, 0x654, 0, 0, 0, 0, 0x655, 0, 0, 0, 0, 0x656, 0, 0, 0, 0,
  0x658, 0, 0, 0, 0, 0x660, 301, 0, 0, 0, 0x661, 353, 0, 0, 0, 0x662, 548, 0, 0, 0, 0x663, 750, 0, 0, 0, 0x664, 460, 0, 0, 0,
  0x665, 705, 0, 0, 0, 0x666, 524, 0, 0, 0, 0x667, 653, 0, 0, 0, 0x668, 653, 0, 0, 0, 0x669, 561, 0, 0, 0, 0x66A, 600, 0, 0, 0,
  0x66B, 249, 0, 0, 0, 0x66C, 204, 0, 0, 0, 0x66D, 418, 0, 0, 0, 0x66E, 838, 312, 344, 882, 0x66F, 912, 0, 0, 948, 0x670, 0, 0, 0, 0,
  0x671, 313, 0, 0, 337, 0x679, 838, 362, 344, 882, 0x67E, 838, 365, 383, 882, 0x686, 611, 578, 624, 656, 0x688, 496, 0, 0, 551, 0x691, 323, 0, 0, 369,
  0x698, 323, 0, 0, 361, 0x6A1, 1051, 630, 665, 1076, 0x6A4, 1051, 630, 665, 1076, 0x6A9, 866, 661, 697, 902, 0x6AF, 866, 727, 762, 902, 0x6BA, 699, 312, 417, 735,
  0x6BE, 810, 804, 842, 845, 0x6C1, 627, 350, 665, 612, 0x6C2, 627, 350, 665, 612, 0x6C3, 627, 0, 0, 612, 0x6CC, 950, 365, 417, 934, 0x6D2, 758, 0, 0, 735,
  0x6D3, 758, 0, 0, 735, 0x6D4, 412, 0, 0, 0, 0x6F0, 301, 0, 0, 0, 0x6F1, 353, 0, 0, 0, 0x6F2, 548, 0, 0, 0, 0x6F3, 750, 0, 0, 0,
  0x6F4, 733, 0, 0, 0, 0x6F5, 624, 0, 0, 0, 0x6F6, 489, 0, 0, 0, 0x6F7, 653, 0, 0, 0, 0x6F8, 653, 0, 0, 0, 0x6F9, 561, 0, 0, 0,
];
const formTable = (flat) => {
  const m = new Map();
  for (let i = 0; i < flat.length; i += 5) m.set(flat[i], flat.slice(i + 1, i + 5));
  return m;
};
const AR_FORMS = { 400: formTable(AR400), 700: formTable(AR700) };
// lam + alef (آ أ إ ا ٱ) is one ligature glyph, wider than its two letters: [isolated, final].
const LAM_ALEF = { 400: [644, 671], 700: [691, 723] };
const ALEFS = new Set([0x622, 0x623, 0x625, 0x627, 0x671]);
// Cairo's only positive Arabic kern: reh / zain (ر ز ڑ ژ) before an INITIAL yeh / beh-like
// letter (ي ى ئ ی پ) — +80 at 400, +65 at 700 (ﺮﻴ in «فريق», «جاهزية»).
const REHS = new Set([0x631, 0x632, 0x691, 0x698]);
const YEHS = new Set([0x64A, 0x649, 0x626, 0x6CC, 0x67E]);
const REH_YEH_KERN = { 400: 80, 700: 65 };
// Punctuation an Arabic cell carries (– — … « » nbsp), measured in the same font.
const AR_MISC = { 400: { 0x2013: 630, 0x2014: 1130, 0x2026: 727, 0xAB: 542, 0xBB: 543, 0xA0: 220 },
  700: { 0x2013: 603, 0x2014: 1103, 0x2026: 784, 0xAB: 573, 0xBB: 574, 0xA0: 218 } };
// Joining: T (marks: transparent, zero-width), D (joins both sides), R (joins the letter
// before it only), C (tatweel / ZWJ: join-causing), U (none). Read off the form table: a
// letter with initial + medial forms is D, with a final form only R.
function joining(cp, f) {
  if (cp === 0x640 || cp === 0x200D) return 'C';
  if (!f) return 'U';
  if (!f[0] && !f[1] && !f[2] && !f[3]) return 'T';
  if (f[1] && f[2]) return 'D';
  return f[3] ? 'R' : 'U';
}
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
/** Shaped Cairo advance of a string, in 1/1000 em (no safety factor). */
function shapedUnits(t, bold) {
  const w = bold ? 700 : 400;
  const ascii = bold ? ADV700 : ADV400;
  const forms = AR_FORMS[w];
  // Presentation forms (ﻻ, ﺑ …) are typed rarely; NFKC folds them back to their letters.
  // Bidi controls (the embedding embedRtl() adds, or typed ones) have no width.
  const cps = Array.from(String(t).replace(BIDI_CONTROLS, '').replace(/[\uFB50-\uFDFF\uFE70-\uFEFF]/g, (ch) => ch.normalize('NFKC')), (ch) => ch.codePointAt(0));
  const jt = cps.map((c) => joining(c, forms.get(c)));
  const prev = (i) => { for (let k = i - 1; k >= 0; k--) if (jt[k] !== 'T') return k; return -1; };
  const next = (i) => { for (let k = i + 1; k < cps.length; k++) if (jt[k] !== 'T') return k; return -1; };
  let u = 0;
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (c >= 32 && c <= 126) { u += ascii[c - 32]; continue; }
    const t0 = jt[i];
    if (t0 === 'T') continue;
    if (c === 0x640) { u += 250; continue; }
    const f = forms.get(c);
    if (!f) { u += AR_MISC[w][c] ?? 600; continue; }
    const p = prev(i);
    const n = next(i);
    const pj = p < 0 ? 'U' : jt[p];
    const nj = n < 0 ? 'U' : jt[n];
    const joinsPrev = (t0 === 'D' || t0 === 'R' || t0 === 'C') && (pj === 'D' || pj === 'C');
    const joinsNext = (t0 === 'D' || t0 === 'C') && (nj === 'D' || nj === 'R' || nj === 'C');
    if (c === 0x644 && n >= 0 && ALEFS.has(cps[n])) {      // lam-alef: one glyph for both
      u += LAM_ALEF[w][joinsPrev ? 1 : 0];
      i = n;
      continue;
    }
    const form = joinsPrev && joinsNext ? 2 : joinsPrev ? 3 : joinsNext ? 1 : 0;
    u += f[form] || f[0];
    if (form === 1 && YEHS.has(c) && p >= 0 && REHS.has(cps[p])) u += REH_YEH_KERN[w];
  }
  return u;
}
/** Estimated ink width (inches) of an Arabic translation at `pt` — shaped, ×1.03. */
export function shapedTextWidth(t, pt = TR.body, bold = false) {
  return (shapedUnits(t, bold) / 1000) * (pt / 72) * SAFETY;
}
/** Trim + collapse every whitespace run (incl. newlines) to one space. */
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
/**
 * Greedy word wrap against `usable` inches. Returns the line strings; a word wider than a
 * whole line is broken by characters (a renderer breaks it too). Never empty: '' → [''].
 */
function wrapLines(s, usable, width) {
  if (!s) return [''];
  const lines = [];
  let cur = '';
  for (const word of s.split(' ')) {
    if (cur && width(`${cur} ${word}`) <= usable) { cur += ` ${word}`; continue; }
    if (cur) lines.push(cur);
    let chars = Array.from(word);
    while (chars.length > 1 && width(chars.join('')) > usable) {
      let k = 1;
      while (k < chars.length - 1 && width(chars.slice(0, k + 1).join('')) <= usable) k++;
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
export function fitCell(value, colW, { bold = false, pt = TR.body, maxLines = MAX_BODY_LINES, shaped = false } = {}) {
  const s = clean(value);
  const usable = colW - CELL_PAD;
  // `shaped` (an Arabic translation): the Cairo shaping estimate; else the legacy one.
  const width = shaped ? (x) => shapedTextWidth(x, pt, bold) : (x) => textWidth(x, pt, bold);
  const lines = wrapLines(s, usable, width);
  if (lines.length <= maxLines) return { text: s, lines: lines.length };
  let pos = 0;
  for (let i = 0; i < maxLines - 1; i++) {
    pos += lines[i].length;
    if (s[pos] === ' ') pos += 1;
  }
  let last = Array.from(lines[maxLines - 1]);
  while (last.length && width(`${last.join('').trimEnd()}…`) > usable) last.pop();
  const cut = (s.slice(0, pos) + last.join('')).trimEnd();
  return { text: `${cut}…`, lines: maxLines };
}
// Arabic text sets right-aligned RTL; Latin prose reads better left-aligned ragged-right.
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const dirOf = (s) => (ARABIC.test(s) ? { align: 'right', rtl: true } : { align: 'left', rtl: false });
// RTL EMBEDDING for a printed TRANSLATION. Both renderers get the cell's base direction
// (<a:pPr rtl="1">, CSS direction), but macOS QuickLook ignores rtl="1" on table-cell
// paragraphs and lays them out LTR — so a translation with Latin words, digits, brackets
// or a cut «…» comes out in scrambled order there («… NUPCO وLEAN» drawn with «NUPCO»
// first; checked 2026-10-13). Wrapping the text in U+202B RLE … U+202C PDF makes it RTL
// whatever the paragraph says (QuickLook then matches Chrome; RLM does not help), and is a
// no-op where rtl is honoured. Applied AFTER fitCell (line counts are measured on the bare
// text; shapedUnits ignores the controls anyway) and only to text with Arabic in it that
// holds something besides Arabic letters and spaces: pure Arabic reads the same in either
// direction, and the English / fallback cells — and so all of 'en' — never get it.
const NEEDS_EMBED = /[^\s\p{Script=Arabic}]/u;
const embedRtl = (s) => (ARABIC.test(s) && NEEDS_EMBED.test(s) ? `\u202B${s}\u202C` : s);

// ---- rows ---------------------------------------------------------------------------------
// The eight on-slide fields. A row whose on-slide fields are ALL empty (a row just added on
// the website and not filled in yet) prints nothing and is skipped; every other row prints,
// in the tracker's order. Outside 'en' a translation alone is something to print too.
const SLIDE_FIELDS = ['track', 'milestone', 'task', 'organization', 'owner', 'priority', 'status', 'due'];
const SLIDE_FIELDS_AR = [...SLIDE_FIELDS, 'trackAr', 'milestoneAr', 'taskAr'];
const isBlankRow = (t, lang) => (lang === 'en' ? SLIDE_FIELDS : SLIDE_FIELDS_AR).every((k) => !clean(t?.[k]));

/**
 * A group (track / milestone) label in `lang`: `main` is the line printed (bold), `sub` the
 * English original under it in 'both' (null when there is no translation, or it says the
 * same). Without a translation — or in 'en' — exactly the English label of before.
 */
function groupLabel(en, ar, colW, lang) {
  const a = lang === 'en' ? '' : clean(ar);
  if (!a) return { main: fitCell(en || DASH, colW, { bold: true, maxLines: MAX_LABEL_LINES }), sub: null, ar: false };
  const e = clean(en);
  const main = fitCell(a, colW, { bold: true, maxLines: MAX_LABEL_LINES, shaped: true });
  return {
    ar: true,
    main: { ...main, text: embedRtl(main.text) },
    sub: lang === 'both' && e && e !== a ? fitCell(e, colW, { pt: TR.enSize, maxLines: MAX_LABEL_LINES }) : null,
  };
}

/** Per-row layout facts that do not depend on the page: texts, styles, line counts. */
function prepareRow(t, reportDate, lang) {
  const W = TR.colW;
  const track = groupLabel(t.track, t.trackAr, W[COL.track], lang);
  const milestone = groupLabel(t.milestone, t.milestoneAr, W[COL.milestone], lang);
  const taskAr = lang === 'en' ? '' : clean(t.taskAr);
  const taskEn = clean(t.task);
  const task = taskAr ? fitCell(taskAr, W[COL.task], { shaped: true }) : fitCell(t.task || DASH, W[COL.task]);
  // 'both': the English original on a second table row under the Arabic (see the header).
  const taskSub = lang === 'both' && taskAr && taskEn && taskEn !== taskAr
    ? fitCell(taskEn, W[COL.task], { pt: TR.enSize }) : null;
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
    task: { text: taskAr ? embedRtl(task.text) : task.text, ...(taskAr || taskEn ? dirOf(task.text) : { color: NA }) },
    taskSub: taskSub ? { text: taskSub.text, size: TR.enSize, color: TR.enInk, ...dirOf(taskSub.text) } : null,
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
  const spanLines = Math.max(org.lines, owner.lines, status.lines, priority.lines, dueCell.lines);
  return {
    // Merge keys: the English identity, plus (outside 'en') the translation — a block merges
    // only rows that print the same label, so each row's label is exactly its own data.
    trackKey: lang === 'en' ? clean(t.track) : `${clean(t.track)}\u0001${clean(t.trackAr)}`,
    msKey: lang === 'en' ? clean(t.milestone) : `${clean(t.milestone)}\u0001${clean(t.milestoneAr)}`,
    trackLabel: track.main,
    trackSub: track.sub,
    msLabel: milestone.main,
    msSub: milestone.sub,
    lines: Math.max(task.lines, spanLines),
    taskLines: task.lines,
    taskSub,
    spanLines,
    cells,
    statusKey: sk,
    overdue,
    // Prints at least one translation (never in 'en') — turns on paginate()'s polish.
    translated: !!(taskAr || track.ar || milestone.ar),
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
 * The table layout of ONE page: the body rows' heights and which cell starts where.
 *  · A task is one table row — or two in 'both' when its task cell is bilingual (Arabic row,
 *    English row; every other cell of the task spans both), or when a bilingual group label
 *    needs a boundary inside a block that is this one task alone (then all of the task's
 *    cells span both rows).
 *  · Heights: each row its own line count (0.37 + 0.24/line at 9pt; an English row 0.33 +
 *    0.215/line at 8pt); a cell spanning a task's two rows that needs more gets the
 *    shortfall split over both (the Arabic sits bottom-aligned, the English top-aligned, so
 *    the pair stays together and centred).
 *  · Then — milestone blocks first, track blocks second — a merged block too short for its
 *    own (bold, wrapped) label gets the shortfall on its LAST row, so the label never
 *    overflows its cell. A bilingual label is split at the row boundary nearest the point
 *    that centres the pair in the block: Arabic part above (bottom-aligned), English part
 *    below (top-aligned), each grown the same way when short.
 * With no bilingual cell on the page this is exactly the one-row-per-task layout of 'en'.
 */
function layoutPage(pr) {
  const nSub = pr.map((r) => (r.taskSub ? 2 : 1));
  const forced = pr.map(() => false);
  for (const sameMs of [true, false]) {
    for (let i = 0; i < pr.length;) {
      const n = runFrom(pr, i, sameMs);
      if ((sameMs ? pr[i].msSub : pr[i].trackSub) && n === 1 && nSub[i] === 1) { nSub[i] = 2; forced[i] = true; }
      i += n;
    }
  }
  const start = [];
  let q = 0;
  for (const n of nSub) { start.push(q); q += n; }
  const h = [];
  pr.forEach((r, i) => {
    if (nSub[i] === 1) { h.push(rowHFor(r.lines)); return; }
    let a = forced[i] ? TR.rowH : rowHFor(r.taskLines);
    let b = forced[i] ? TR.enRowH : enRowHFor(r.taskSub.lines);
    const short = rowHFor(forced[i] ? r.lines : r.spanLines) - (a + b);
    if (short > 1e-9) { a = r5(a + short / 2); b = r5(b + short / 2); }
    h.push(a, b);
  });
  const groups = { track: new Map(), ms: new Map() };
  const grow = (sameMs) => {
    const at = sameMs ? groups.ms : groups.track;
    for (let i = 0; i < pr.length;) {
      const n = runFrom(pr, i, sameMs);
      const s = start[i];
      const e = start[i + n - 1] + nSub[i + n - 1];
      const label = sameMs ? pr[i].msLabel : pr[i].trackLabel;
      const sub = sameMs ? pr[i].msSub : pr[i].trackSub;
      if (!sub) {
        const need = rowHFor(label.lines);
        const have = sum(h.slice(s, e));
        if (have < need) h[e - 1] = r5(h[e - 1] + (need - have));
        at.set(s, { part: 'one', span: e - s });
      } else {
        const arNeed = rowHFor(label.lines);
        const enNeed = enRowHFor(sub.lines);
        // Boundary B centring the pair: Arabic ink ends at B, English starts there, so the
        // pair's middle is B + (en − ar)/2 → B = (total + ar − en)/2.
        const target = (sum(h.slice(s, e)) + arNeed - enNeed) / 2;
        let j = 1;
        let best = Infinity;
        for (let k = 1, acc = 0; k < e - s; k++) {
          acc += h[s + k - 1];
          if (Math.abs(acc - target) < best - 1e-9) { best = Math.abs(acc - target); j = k; }
        }
        const top = sum(h.slice(s, s + j));
        if (top < arNeed) h[s + j - 1] = r5(h[s + j - 1] + (arNeed - top));
        const bottom = sum(h.slice(s + j, e));
        if (bottom < enNeed) h[e - 1] = r5(h[e - 1] + (enNeed - bottom));
        at.set(s, { part: 'ar', span: j });
        at.set(s + j, { part: 'en', span: e - s - j });
      }
      i += n;
    }
  };
  grow(true);
  grow(false);
  return { h, nSub, start, forced, groups };
}

/**
 * PAGINATION — the fewest slides first; among equal slide counts, every track kept whole.
 * A page's band is floor − table top − header − (the «يتبع…» marker when a page follows).
 * Real file (34 rows): 3 slides 12 / 7 / 15, no track split. A task's two 'both' rows
 * always stay on one page (the unit paginated is the task).
 * TRANSLATED decks (a translation prints; never 'en', never an untranslated tracker, which
 * keep exactly the greedy pages above) are paginated by balancePages() instead: bilingual
 * rows are tall, and the greedy fill left e.g. a 'both' deck of 34 tasks with ONE task on
 * its last slide, and a block's first task alone at a page bottom in a row stretched to
 * its two-language label.
 */
function paginate(rows, headH) {
  const together = paginateGroups(rows, headH, true);
  const filled = paginateGroups(rows, headH, false);
  const plain = filled.length < together.length ? filled : together;
  if (!rows.some((r) => r.translated)) return plain;
  const even = balancePages(rows, headH);
  return even && even.length <= plain.length ? even : plain;
}
const pageCap = (headH, first, last) => r5(TR.floor - (first ? TR.firstY : TR.contY) - headH - (last ? 0 : TR.markerH));
const pageHeight = (pageRows) => sum(layoutPage(pageRows).h);
function paginateGroups(rows, headH, keepTogether) {
  const groups = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.key === r.trackKey) g.rows.push(r); else groups.push({ key: r.trackKey, rows: [r] });
  }
  const fits = (pageRows, first, last) => pageHeight(pageRows) <= pageCap(headH, first, last) + 1e-9;
  const pages = [[]];
  groups.forEach((g, gi) => {
    const lastGroup = gi === groups.length - 1;
    const cur = pages[pages.length - 1];
    const first = pages.length === 1;
    // 1. the whole group fits on the current page
    if (fits([...cur, ...g.rows], first, lastGroup)) { cur.push(...g.rows); return; }
    // 2. the whole group fits on a fresh continuation page → start one
    if (keepTogether && cur.length && fits(g.rows, false, lastGroup)) { pages.push([...g.rows]); return; }
    // 3. split row by row: a row that does not fit opens a new page. Any single task fits an
    //    empty page (cells are cut at MAX_BODY_LINES / MAX_LABEL_LINES: even a 'both' task
    //    with 4 + 4 lines and 4 + 4-line labels is ≈2.1in of a ≥4.9in band).
    g.rows.forEach((r, k) => {
      const p = pages[pages.length - 1];
      const isLast = lastGroup && k === g.rows.length - 1;
      if (p.length && !fits([...p, r], pages.length === 1, isLast)) pages.push([r]);
      else p.push(r);
    });
  });
  return pages.filter((p) => p.length);
}
const sameBlock = (a, b) => a.trackKey === b.trackKey && a.msKey === b.msKey;
const sameTrack = (a, b) => a.trackKey === b.trackKey;
// Lone rows (see balancePages 3.) of the page rows[i..k), at both block levels.
function loneRows(rows, i, k) {
  const n = rows.length;
  let c = 0;
  for (const same of [sameBlock, sameTrack]) {
    if (k < n && same(rows[k - 1], rows[k]) && (k - 1 === i || !same(rows[k - 2], rows[k - 1]))) c += 1;   // orphan
    if (i > 0 && same(rows[i - 1], rows[i]) && (k === i + 1 || !same(rows[i], rows[i + 1]))) c += 1;       // widow
  }
  return c;
}
/**
 * The page breaks of a translated deck, chosen EXACTLY (dynamic programming over the break
 * positions; every page is checked with the real layout, so nothing can overflow) by, in
 * order:
 *   1. the fewest slides (never more than the greedy fill — paginate() checks);
 *   2. the fewest breaks inside a track (the greedy rule: keep tracks whole);
 *   3. the fewest LONE ROWS at a break, per block level (track, milestone): a block opened
 *      by its only row at the bottom of a page while it goes on on the next one (orphan),
 *      or ended by its only row at the top of a page (widow) — such a row also carries the
 *      block's whole (bilingual) label, so it is drawn stretched;
 *   4. the most even pages: least Σ (free height)² — no near-empty last slide.
 * null when some single task does not fit a page (cannot happen; the greedy then decides).
 */
function balancePages(rows, headH) {
  const n = rows.length;
  // best[i]: the cheapest pagination of rows[i..]; cost [slides, track breaks, lone rows, Σslack²].
  const best = Array(n + 1).fill(null);
  best[n] = { cost: [0, 0, 0, 0], next: n };
  const better = (x, y) => {
    for (let k = 0; k < 3; k++) if (x[k] !== y[k]) return x[k] < y[k];
    return x[3] < y[3] - 1e-9;
  };
  for (let i = n - 1; i >= 0; i--) {
    const first = i === 0;
    for (let k = i + 1; k <= n; k++) {
      const page = rows.slice(i, k);
      const h = pageHeight(page);
      const last = k === n;
      const cap = pageCap(headH, first, last);
      if (h > cap + 1e-9) {
        // Longer pages from i do not fit either (more rows never make a table shorter; were
        // that ever not so, a break would only be missed, nothing could overflow) — except
        // the rest of the deck as the LAST page, which has no marker: try it on its own.
        if (k < n) {
          const tail = rows.slice(i);
          const capLast = pageCap(headH, first, true);
          const ht = pageHeight(tail);
          if (ht <= capLast + 1e-9) {
            const c = [1, 0, loneRows(rows, i, n), (capLast - ht) ** 2];
            if (!best[i] || better(c, best[i].cost)) best[i] = { cost: c, next: n };
          }
        }
        break;
      }
      if (!best[k]) continue;
      const brk = k < n;
      const trackBreak = brk && rows[k - 1].trackKey === rows[k].trackKey ? 1 : 0;
      const b = best[k].cost;
      const c = [1 + b[0], trackBreak + b[1], loneRows(rows, i, k) + b[2], (cap - h) ** 2 + b[3]];
      if (!best[i] || better(c, best[i].cost)) best[i] = { cost: c, next: k };
    }
  }
  if (!best[0]) return null;
  const pages = [];
  for (let i = 0; i < n; i = best[i].next) pages.push(rows.slice(i, best[i].next));
  return pages;
}

function trackerTable(pr, y, header, headH) {
  const out = [rev(header.map((h) => h.text))];
  const lay = layoutPage(pr);
  const rowH = [headH, ...lay.h];
  // A merged group cell (or one part of a bilingual one) starting on table row q.
  const groupCell = (g, label, sub, fill, ink, subInk, top) => {
    // `color` twice ON PURPOSE: the first only fixes the key order HEAD's cell() produced
    // (color, border, text, …) — JSON key order is what keeps 'en' byte-identical; the
    // second is the value. Do not "clean up" the first.
    if (g.part === 'one') return { color: C.slate900, ...top, text: label.text, rowSpan: g.span, fill, color: ink, bold: true };
    if (g.part === 'ar') {
      return { color: ink, text: label.text, rowSpan: g.span, fill, bold: true, valign: 'bottom',
        border: { ...(top.border || {}), bottom: null } };
    }
    return { color: subInk, text: sub.text, rowSpan: g.span, fill, size: TR.enSize, bold: false,
      valign: 'top', rtl: false, border: { top: null } };
  };
  pr.forEach((r, i) => {
    const newTrack = i === 0 || pr[i - 1].trackKey !== r.trackKey;
    // A 1.25pt line above each new track (not above the page's first row: the header is there).
    const top = newTrack && i > 0 ? { border: { top: { ...TR.groupSep } } } : {};
    const cell = (o) => ({ color: C.slate900, ...top, ...o });
    const c = r.cells;
    const n = lay.nSub[i];
    for (let k = 0; k < n; k++) {
      const q = lay.start[i] + k;
      const rowTop = k === 0 ? top : {};
      const logical = [];
      // Merged group cells: only on the group's first row ON THIS PAGE, rowSpan = its table
      // rows on this page; the covered cells are omitted (schema). A group continuing from
      // the previous slide repeats its label here — the title already says تتمة.
      const tg = lay.groups.track.get(q);
      if (tg) logical.push(groupCell(tg, r.trackLabel, r.trackSub, TR.trackFill, TR.trackInk, TR.enTrackInk, rowTop));
      const mg = lay.groups.ms.get(q);
      if (mg) logical.push(groupCell(mg, r.msLabel, r.msSub, TR.msFill, TR.msInk, TR.enMsInk, rowTop));
      if (n === 1) {
        logical.push(cell(c.task), cell(c.org), cell(c.owner), cell(c.priority), cell(c.status), cell(c.due));
      } else if (k === 0) {
        const span = { rowSpan: n };
        // Bilingual task: the Arabic on this row, its bottom border dropped so it reads as
        // one cell with the English row below; a forced two-row task spans both.
        const taskCell = c.taskSub
          ? cell({ ...c.task, valign: 'bottom', border: { ...(top.border || {}), bottom: null } })
          : cell({ ...c.task, ...span });
        logical.push(taskCell, cell({ ...c.org, ...span }), cell({ ...c.owner, ...span }),
          cell({ ...c.priority, ...span }), cell({ ...c.status, ...span }), cell({ ...c.due, ...span }));
      } else if (c.taskSub) {
        logical.push({ color: C.slate900, ...c.taskSub, valign: 'top', border: { top: null } });
      }
      // Group cells are the LAST cells in visual (L→R) order and a task's spanning cells
      // the FIRST, so omitting covered ones never shifts another cell of the row (HTML
      // table semantics, which pptxgenjs follows).
      out.push(rev(logical));
    }
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
 * @param {{reportDate?:string, variant?:string, labels?:Function|Object, lang?:string}} [opts]
 *        reportDate 'YYYY-MM-DD' — the overdue reference; labels — labelOf(m) or an
 *        overrides map; variant — ignored (the tracker is the same in both decks);
 *        lang — reportOptions.trackerLang: 'ar' (default) | 'en' | 'both' (see the header)
 * @returns {Array} slides ('tracker', 'tracker-cont-1', …) without page numbers; [] when
 *          there is nothing to show
 */
// eslint-disable-next-line no-unused-vars
export function buildTrackerSlides(tracker, { reportDate, variant, labels, lang } = {}) {
  const lg = trackerSlideLang(lang);
  const tasks = Array.isArray(tracker?.tasks) ? tracker.tasks.filter((t) => t && typeof t === 'object' && !isBlankRow(t, lg)) : [];
  if (!tasks.length) return [];
  const L = labelLookup(labels);
  const rows = tasks.map((t) => prepareRow(t, reportDate, lg));
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
