// src/slidespec/build-spec-both.js
// buildBothSpec(model, { variant }) -> SlideSpec for the KAMC + SGH ("BOTH") report.
//
// THE SPEC IS THE USER'S OWN REFERENCE DECK (Misbar_Weekly_Report_-_KAMC_SGH_-_2026-10-08),
// reproduced shape for shape: every box, colour, font size and WORD below was read off that
// deck's OOXML (EMU ÷ 914400 → inches). The user's rule is "make the same exact design" and
// "do not change words" — so no string on these slides is reworded, and the only text that
// varies is data. Where the reference shows no case (more countries than it had, SGH with no
// orders, a zero delta …) the rule used is written next to the code and is the least
// surprising reading of the reference's own design.
//
// SEVEN slides, in the reference's order:
//   cover · execFunnel · monthly · sendoutCountries · sendoutLabs · compliance · thanks
// Same slide ids as the single-hospital deck, so every consumer (PDF export, the preview)
// treats them alike. The variant changes NOTHING here: the BOTH deck has no action /
// challenges slides (CONTRACT §1.10), and those were the only variant-dependent ones.
// PROJECT TRACKER (2026-10-13): the «متابعة المهام» slides (build-tracker.js, shared with
// the single-hospital deck) follow compliance, before thanks, under the 'tracker' toggle —
// a project-wide addition to the reference shape, identical for both variants, and absent
// when no tracker is loaded; WEEKLY decks follow them with «المهام المكتملة خلال الأسبوع»
// ('trackerCompleted', 2026-10-18). Nothing else in this deck changes (a DAILY cadence also
// swaps the cover title, as in build-spec.js).
//
// SLIDE ORDER (2026-10-13): the sequence above is the DEFAULT. The operator's saved order
// (reportOptions.slideOrder) or one-report order (model.slideOrder) re-sequences the content
// units exactly as in build-spec.js (model/slide-order.js); cover first and thanks last
// never move.
//
// SLIDE TOGGLES. reportOptions.slides.monthly / .sendout / .compliance (and .tracker) switch
// those slides off exactly as in the single-hospital deck (CONTRACT §1.10); cover, exec and
// thanks always render. reportOptions.kpiCards.turnaround (explicit-true, like build-spec.js OPT_IN_CARDS)
// switches the monthly slide's turnaround block — line chart, navy card and both «KAMC فقط»
// chips — and the block also needs both overall averages to exist (build-spec.js guard).
// With the block off, the rest of the monthly slide moves down as one piece and sits
// centred in the freed band (MT_OFF_DY), so no empty lower half is left.
// The exec card toggles are NOT honoured: the reference row is a fixed six-card design with
// no repacked layout, and a BOTH deck with a hole in it would not be the reference's design.
// Page numbers renumber 1..n over the included content slides (build-spec.js pageFooter).
//
// NOT OFFERED IN BOTH MODE (CONTRACT §1.7/§1.8): manual number overrides and the report
// scope. This file never reads m.overrides or m.scope.
//
// LABELS. Every string whose built-in default (build-spec.js DEFAULT_LABELS) is character-
// identical to the reference's text is read through the labels registry, so an operator's
// own label override reaches this deck the same way it reaches the KAMC deck. Strings that
// exist only in the BOTH reference (chips, notes, legends, «المستشفيات», the per-hospital
// captions) are literals here: they have no registry key and adding one is not this file's
// call.
//
// THE NUMBERS ARE NEVER COMPUTED HERE. model.combined (src/model/hospital-report.js,
// map/model-both.md) carries every summed figure; this file only formats and lays out.
// `null` in the model means "unknown — this hospital has no Test Menu" and prints «–»
// (U+2013); a real 0 prints «0».
//
// HOSPITAL NAMES. The old "no hospital name on any slide" rule applies to the KAMC report
// only (CONTRACT §1.13): this deck prints the names the reference prints.
import { COLORS as C } from '../theme.js?v=v2026-10-18.2';
import { AR_COUNTRY } from '../model/sendout.js?v=v2026-10-18.2';
import { HOSPITALS } from '../model/hospital.js?v=v2026-10-18.2';
// The project-tracker slides — a leaf module (imports nothing from either spec file), so it
// is safe to import at top level despite the cycle described below.
import { buildTrackerSlides, buildTrackerCompletedSlides } from './build-tracker.js?v=v2026-10-18.2';
// Slide ORDER — also a leaf module (no imports at all), equally safe at top level.
import { orderUnits, slideOrderOf, cadenceOf, unitInCadence } from '../model/slide-order.js?v=v2026-10-18.2';
// DEFAULT_LABELS (the registry) and SGH_TEXT (the reference's SGH sentences, shared with the
// single-SGH deck so both print one source) come from build-spec.js.
// CIRCULAR IMPORT, SAFE ONLY AT CALL TIME: build-spec.js imports this file to dispatch
// model.hospital === 'both', so when it is loaded first this module is evaluated BEFORE
// build-spec.js's own top-level constants exist. Every import from it is therefore read
// inside a function, never at this module's top level (that would be a TDZ ReferenceError)
// — which is also why the palette below keeps its own literal hexes (the same values as
// build-spec.js SGH_COLORS) instead of reading them at load time.
import { DEFAULT_LABELS, SGH_TEXT } from './build-spec.js?v=v2026-10-18.2';

// ---- palette added by the BOTH reference (not in theme.js) ---------------------------
const KAMC_C = '#00897B';      // KAMC teal — slices, segments, dots, counts, tags
const SGH_C = '#7C3AED';       // SGH violet (= SGH_COLORS.violet)
const KAMC_TINT = '#E0F2F1';   // KAMC merged hospital cells
const SGH_TINT = '#EDE9FE';    // SGH merged hospital cells
const NOTE_RED = '#B91C1C';    // the «Test Menu لم تصل بعد» notes (= SGH_COLORS.noteRed)
const NA_GREY = '#94A3B8';     // «–» (n/a) and a zero delta (= SGH_COLORS.na)
const PILL_GOOD = '#E3F2E5';   // card delta pill
const PILL_BAD = '#FDE2E2';    // late card delta pill
const COVER_KAMC_DOT = '#5EEAD4';
const COVER_SGH_DOT = '#C4B5FD'; // (= SGH_COLORS.coverDot)
const CHIP_TURQ = '#5EEAD4';   // «KAMC فقط» chip on the navy turnaround card
const RING_EMPTY = '#E2E8F0';  // a card whose KAMC + SGH = 0 (CONTRACT §1.12)
const GROUP_SEP = '#94A3B8';   // monthly table: 1.25pt line above each metric group
const SUBTOTAL_SEP = '#CBD5E1';// monthly table: 1.25pt line above each المجموع row
const COUNTRY_TRACK_ADJ = 0.10131; // reference roundRect adj of the bar track (r 0.031 on 0.306)
// Local copies of build-spec.js constants (not exported there, and a top-level read would
// hit the import cycle above anyway). Values verbatim: CARD_TITLE = the cover/card caption
// tint, CARD_DEEP_BLUE = the 'فحوصات تحت الإجراء' card colour (= C.taskNavy).
const CARD_TITLE = '#DCE6F1';
const CARD_DEEP_BLUE = '#2F5597';
// "TextBox" insets of the hand-made reference shapes: 12802 EMU ≈ 0.014in (≈1 pt). The
// generator-made "Text N" shapes keep the renderer default (1 pt) — margin absent.
const TB = 0.014;
const EN_DASH = '–';      // «–» U+2013, the reference's n/a mark
const RLM = '‏';          // U+200F, used by the reference inside the per-hospital splits
const SEAM = { color: '#FFFFFF', pt: 1.25 };

const H = { kamc: HOSPITALS.kamc, sgh: HOSPITALS.sgh };

// ---- labels + formatting (local copies of build-spec.js helpers it does not export) ----
const labelOf = (m) => (key) => (m.reportOptions?.labels?.[key] ?? DEFAULT_LABELS[key]);
const MONTH_NAMES_AR = {
  '01': 'يناير', '02': 'فبراير', '03': 'مارس', '04': 'أبريل', '05': 'مايو', '06': 'يونيو',
  '07': 'يوليو', '08': 'أغسطس', '09': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر',
};
const arMonthLabel = (key) => MONTH_NAMES_AR[String(key).split('-')[1]] || String(key);
const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const fmtDate = (iso) => { const [y, mo, d] = String(iso).split('-'); return `${d} / ${mo} / ${y}`; };
const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (mm, k) => (vars[k] != null ? vars[k] : mm));
const pctLab = (n) => (n === 0 ? '0%' : Number(n).toFixed(1) + '%');
// build-spec.js pctMonthly. A joined month with no orders has no percentage: '-' (hyphen),
// the current deck's placeholder — deliberately NOT «–», which this slide's note defines
// as "before the hospital joined".
const pctMonthly = (n) => (n == null ? '-' : n === 100 ? '100%' : Number(n).toFixed(1) + '%');
// build-spec.js deltaLegendText (week / day / undated forms), verbatim.
const deltaLegendText = (L, dw) => {
  if (!dw || !isIsoDate(dw.end)) return L('execDeltaLegend');
  const end = fmtDate(dw.end);
  if (dw.mode === 'daily') return L('execDeltaLegendDayWindow').replace('{end}', end);
  if (!isIsoDate(dw.start)) return L('execDeltaLegend');
  return L('execDeltaLegendWeekWindow').replace('{start}', fmtDate(dw.start)).replace('{end}', end);
};
const num = (v) => (Number.isFinite(Number(v)) && v != null ? Number(v) : 0);
// 5-dp rounding of derived coordinates, so X + 0.39 is 11.35 and not 11.350000000000001.
const r5 = (v) => Math.round(v * 1e5) / 1e5;
// …and rounded DOWN where a squeezed row pitch must not push a table past its floor.
const floor5 = (v) => Math.floor(v * 1e5) / 1e5;

// ---- element factories -----------------------------------------------------------------
const rect = (x, y, w, h, fillC, extra = {}) => ({ t: 'rect', x: r5(x), y: r5(y), w: r5(w), h: r5(h), fill: fillC, ...extra });
const ellipse = (x, y, w, h, fillC) => ({ t: 'rect', shape: 'ellipse', x: r5(x), y: r5(y), w: r5(w), h: r5(h), fill: fillC });
const text = (x, y, w, h, t, size, o = {}) => ({ t: 'text', x: r5(x), y: r5(y), w: r5(w), h: r5(h), text: t, size, ...o });
const runsText = (x, y, w, h, runs, size, o = {}) => ({ t: 'text', x: r5(x), y: r5(y), w: r5(w), h: r5(h), size, runs, ...o });
const rev = (a) => a.slice().reverse();

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
const pageFooter = (n) => text(0.5, 7.15, 0.8, 0.3, String(n), 9, { color: C.slate500, align: 'left', valign: 'middle' });

/** ● SGH ● KAMC colour key, top-left of slides 2 and 3 (reference shapes 93–96). */
function hospitalLegend(dy = 0) {
  const lab = { bold: true, color: C.slate900, align: 'left', valign: 'middle', rtl: false, margin: 0 };
  return [
    ellipse(0.5, r5(0.745 + dy), 0.11, 0.11, SGH_C),
    text(0.66, r5(0.68 + dy), 0.41, 0.24, 'SGH', 9.5, lab),
    ellipse(1.26, r5(0.745 + dy), 0.11, 0.11, KAMC_C),
    text(1.42, r5(0.68 + dy), 0.49, 0.24, 'KAMC', 9.5, lab),
  ];
}

/** «KAMC فقط» chip: a pill + a two-run label on top (reference: same box twice). */
function kamcOnlyChip(x, y, w, h, pillColor, textColor, size) {
  return [
    rect(x, y, w, h, pillColor, { radius: h / 2 }),
    runsText(x, y, w, h, [{ text: 'KAMC' }, { text: ' فقط' }], size,
      { bold: true, color: textColor, align: 'center', valign: 'middle', rtl: true, margin: 0 }),
  ];
}

// ============================================================================
// Slide 1 — Cover: the current cover + the «يشمل التقرير:» chip row.
// ============================================================================
function buildCover(m) {
  const L = labelOf(m);
  // Pill anatomy (reference): 1.30 × 0.44 full-round pill of 13 % white; a Ø0.16 dot on its
  // RIGHT (RTL-leading) side; the name centred left of the dot. KAMC first (rightmost).
  const pill = (px, code, dot) => [
    rect(px, 4.8, 1.3, 0.44, C.white, { alpha: 0.13, radius: 0.22 }),
    ellipse(px + 0.97, 4.94, 0.16, 0.16, dot),
    text(px + 0.08, 4.8, 0.85, 0.44, code, 14, { bold: true, color: C.white, align: 'center', valign: 'middle', rtl: false, margin: TB }),
  ];
  return {
    id: 'cover', bg: C.navy, elements: [
      rect(0, 0, 0.15, 7.5, C.purple),
      rect(13.15, 0, 0.15, 7.5, C.orange),
      text(8.7, 0.5, 4.0, 0.5, 'NUPCO  |  Lean', 18, { bold: true, color: C.white, align: 'right', valign: 'middle' }),
      // Cadence (build-spec.js DEFAULT_LABELS.coverTitle): «…اليومي» for a daily report.
      text(0.6, 2.6, 11.9, 1.3, L(cadenceOf(m) === 'daily' ? 'coverTitleDaily' : 'coverTitle'), 60, { bold: true, color: C.white, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 4.0, 11.9, 0.6, L('coverSubtitle'), 22, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 6.15, 11.9, 0.4, 'تاريخ التقرير: ' + fmtDate(m.reportDate), 12, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 6.55, 11.9, 0.4, L('coverPreparedBy'), 12, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true }),
      text(11.35, 4.8, 1.15, 0.44, SGH_TEXT.coverIncludes, 13, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true, margin: TB }),
      ...pill(10.0, H.kamc.code, COVER_KAMC_DOT),
      ...pill(8.54, H.sgh.code, COVER_SGH_DOT),
    ],
  };
}

// ============================================================================
// Slide 2 — Executive summary: six doughnut cards + the two-hospital journey funnel.
// ============================================================================
const CARD_X = [10.96, 8.98, 7.0, 5.02, 3.04, 0.5]; // rightmost first; late card detached left
const CARD_Y = 0.98, CARD_W = 1.86, CARD_H = 2.24;

/**
 * One by-hospital delta number. The reference prints '+N' (green; the late card red) for a
 * rise, a grey «0» for no movement and a grey «–» for "not applicable" (SGH lateness —
 * no Test Menu). Positive-only like every chip in this app (build-spec.js fmtDelta): a
 * zero, a negative or a missing delta is the grey «0» — the line itself is always shown
 * (CONTRACT §1.12), only the PILL hides.
 */
function deltaRun(d, risingColor) {
  if (d === null) return { text: EN_DASH, size: 8, bold: true, color: NA_GREY };
  if (Number.isFinite(d) && d > 0) return { text: '+' + d, size: 8, bold: true, color: risingColor };
  return { text: '0', size: 8, bold: true, color: NA_GREY };
}

function doughnutCard(x, def, card) {
  const late = def.key === 'lateNoResult';
  const k = num(card.kamc);
  const sghNa = card.sgh === null; // no Test Menu → unknown, printed «–», charted as 0
  const s = sghNa ? 0 : num(card.sgh);
  const sum = k + s;
  // firstSliceAng = round(180 × SGH share): the SGH slice is always centred at 12 o'clock
  // (its value printed just above the ring) and KAMC's at 6 o'clock (its value printed in
  // white ON the ring's bottom) — verified on all six reference charts.
  const ang = sum > 0 ? Math.round((180 * s) / sum) : 0;
  const dk = card.delta?.kamc, ds = card.delta?.sgh, dc = card.delta?.combined;
  const rising = late ? C.red : C.deltaGreen;
  const els = [
    rect(x, CARD_Y, CARD_W, CARD_H, C.white, {
      radius: 0.058125, // adj 3125 on the 1.86in card
      line: late ? { color: C.redPure, pt: 2.5 } : { color: C.border, pt: 0.75 },
    }),
    rect(x + 1.8, CARD_Y, 0.06, CARD_H, def.accent),
    {
      t: 'chart', kind: 'doughnut', x: r5(x + 0.39), y: 1.2, w: 1.02, h: 1.02,
      categories: [H.kamc.code, H.sgh.code],
      series: [{ name: 'الطلبات', values: [k, s], colors: [KAMC_C, SGH_C], line: SEAM }],
      // emptyColor: KAMC + SGH = 0 draws a full grey ring instead of nothing (§1.12).
      opts: { hole: 50, firstSliceAng: ang, emptyColor: RING_EMPTY },
    },
    // KAMC value, white on the ring's bottom. On an EMPTY (grey) ring white would vanish,
    // so it falls back to the slate caption colour there — not in the reference (which has
    // no empty card), the least-surprising legible choice.
    text(x + 0.39, 1.9825, 1.02, 0.22, String(k), 9,
      { bold: true, color: sum > 0 ? C.white : C.slate500, align: 'center', valign: 'middle', rtl: false, margin: 0 }),
    text(x + 0.19, 1.01, 1.42, 0.18, sghNa ? EN_DASH : String(s), 9,
      { bold: true, color: sghNa ? NA_GREY : SGH_C, align: 'center', valign: 'bottom', rtl: false, margin: 0 }),
    text(x + 0.645, 1.455, 0.51, 0.51, String(num(card.combined)), 14,
      { bold: true, color: def.accent, align: 'center', valign: 'middle', rtl: false, margin: 0 }),
  ];
  // «▲ N» pill = the combined delta; hidden when it is not a rise (§1.12, the app's
  // positive-only chip rule).
  if (Number.isFinite(dc) && dc > 0) {
    els.push(
      rect(x + 1.22, 2.29, 0.52, 0.22, late ? PILL_BAD : PILL_GOOD, { radius: 0.11 }),
      text(x + 1.22, 2.29, 0.52, 0.22, '▲ ' + dc, 9,
        { bold: true, color: late ? C.red : C.deltaGreen, align: 'center', valign: 'middle', rtl: false, margin: 0 }),
    );
  }
  // By-hospital line: an LTR paragraph, right-aligned, so it reads "+13 SGH    +90 KAMC".
  els.push(runsText(x + 0.08, 2.29, 1.09, 0.22, [
    deltaRun(ds === undefined ? 0 : ds, rising),
    { text: ' ' + H.sgh.code, bold: true, color: SGH_C },
    { text: '    ', bold: false, color: C.slate500 },
    deltaRun(dk === undefined ? 0 : dk, rising),
    { text: ' ' + H.kamc.code, bold: true, color: KAMC_C },
  ], 7, { align: 'right', valign: 'middle', rtl: false, margin: 0 }));
  els.push(text(x + 0.08, 2.55, 1.66, 0.26, def.title, 10,
    { bold: true, color: C.slate500, align: 'right', valign: 'middle', rtl: true, margin: TB }));
  if (def.sub) {
    els.push(text(x + 0.08, 2.81, 1.66, 0.4, def.sub, 9.5,
      { color: C.slate500, align: 'right', valign: 'top', rtl: true, margin: TB }));
  }
  return els;
}

/** A funnel count box: optional '+N' (only when N > 0, §1.12), two spaces, the count. */
function countRuns(value, delta, dSize, nSize, nColor) {
  const runs = [];
  if (Number.isFinite(delta) && delta > 0) {
    runs.push({ text: '+' + delta, size: dSize, bold: true, color: C.deltaGreen },
      { text: '  ', size: dSize, bold: false, color: C.slate500 });
  }
  runs.push({ text: String(num(value)), size: nSize, bold: true, color: nColor });
  return runs;
}

const FUNNEL_STAGES = [
  { stage: '1. إنشاء طلب', desc: 'الطلب أُنشئ في مسبار', color: C.navy },
  { stage: '2. سحب العينة', desc: 'العينة مُجمَّعة', color: C.blue },
  { stage: '3. شحن العينة', desc: 'العينة شُحنت من قبل المستشفى', color: C.amber },
  { stage: '4. إستلام العينة', desc: 'حالة إستلام العينة بقبولها او رفضها', color: C.greenSoft },
  { stage: '5. إصدار نتيجة', desc: 'نتيجة تحليل العينة أو رفضها', color: C.greenBright },
];

function buildExec(m) {
  const L = labelOf(m);
  const c = m.combined || {};
  const cards = c.cards || {};
  const blankCard = { kamc: 0, sgh: 0, combined: 0, delta: { kamc: 0, sgh: 0, combined: 0 } };
  const dw = c.dataWindow;
  const window = dw ? `${arMonthLabel(dw.first)} – ${arMonthLabel(dw.last)}` : '';
  const late = cards.lateNoResult || { ...blankCard, sgh: null };
  const defs = [
    { key: 'total', title: L('kpiTotal'), sub: window, accent: C.blue },
    { key: 'awaitingDispatch', title: L('kpiAwaitingDispatch'), sub: 'قبل الـ Dispatch', accent: C.greenSoft },
    { key: 'shippedNotReceived', title: L('kpiShipped'), sub: '', accent: C.redSoft },
    { key: 'awaitingResults', title: L('kpiAwaitingResults'), sub: 'بعد الـ Dispatch', accent: CARD_DEEP_BLUE },
    { key: 'completed', title: L('kpiCompleted'), sub: 'تشمل المرفوضة', accent: C.green },
    // The late % is KAMC's own (late ÷ KAMC awaiting): the model's menu-hospital basis.
    { key: 'lateNoResult', title: L('kpiLate'), sub: `تمثل ${num(late.pct)}% من فحوصات KAMC تحت الإجراء`, accent: C.redPure },
  ];

  const els = [
    ...chrome(L('titleExec')),
    // The chip legend is ALWAYS shown: the by-hospital delta line under every card is
    // always shown too (§1.12), so the window it counts over must always be named.
    text(6.3, 0.7, 6.52, 0.22, deltaLegendText(L, m.deltaWindow || c.window), 8.5,
      { color: C.deltaGreen, align: 'right', valign: 'middle', rtl: true, margin: TB }),
    ...hospitalLegend(),
  ];
  defs.forEach((def, i) => {
    const card = cards[def.key] || (def.key === 'lateNoResult' ? late : blankCard);
    els.push(...doughnutCard(CARD_X[i], def, card));
  });

  // Cancelled note — the total, then the per-hospital split (SGH's 0 is a real 0: violet).
  const can = c.cancelled || { kamc: 0, sgh: 0, combined: 0 };
  els.push(runsText(5.0, 3.3, 7.82, 0.26, [
    { text: `* ${num(can.combined)} ${L('execCancelledLabel')}  —  `, size: 11, bold: true, color: C.slate600 },
    { text: H.kamc.code + ' ' },
    { text: String(num(can.kamc)), bold: true, color: KAMC_C },
    { text: `${RLM}  ·  ${RLM}` },
    { text: H.sgh.code + ' ' },
    { text: String(num(can.sgh)), bold: true, color: SGH_C },
  ], 10, { color: C.slate500, align: 'right', valign: 'middle', rtl: true, margin: TB }));

  // Funnel header row (y 3.58): stage · count · KAMC / SGH column keys · description.
  const head = { bold: true, color: C.slate500, valign: 'middle', rtl: true, margin: TB };
  const key = { bold: true, color: C.slate900, align: 'left', valign: 'middle', rtl: false, margin: 0 };
  els.push(
    text(9.95, 3.58, 1.95, 0.24, L('funnelStage'), 10, { ...head, align: 'right' }),
    text(8.86, 3.58, 0.9, 0.24, L('funnelCount'), 10, { ...head, align: 'center' }),
    ellipse(8.23816, 3.65, 0.1, 0.1, KAMC_C),
    text(8.38816, 3.58, 0.43368, 0.24, H.kamc.code, 8.5, key),
    ellipse(7.57395, 3.65, 0.1, 0.1, SGH_C),
    text(7.72395, 3.58, 0.36211, 0.24, H.sgh.code, 8.5, key),
    text(0.5, 3.58, 2.48, 0.24, L('funnelDesc'), 10, { ...head, align: 'right' }),
  );

  // Five rows on a 0.56 pitch: accent · stage · total · KAMC · SGH · description.
  const funnel = c.funnel || [];
  const cnt = { align: 'center', valign: 'middle', rtl: false, margin: 0 };
  FUNNEL_STAGES.forEach((st, i) => {
    const f = funnel[i] || { kamc: 0, sgh: 0, combined: 0, delta: {} };
    const dy = 0.56 * i;
    els.push(
      rect(11.97, 3.92 + dy, 0.06, 0.42, st.color),
      text(9.95, 3.88 + dy, 1.95, 0.5, st.stage, 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true, margin: TB }),
      runsText(8.86, 3.91 + dy, 0.9, 0.44, countRuns(f.combined, f.delta?.combined, 7.5, 14, C.slate900), 14, cnt),
      runsText(8.16, 3.93 + dy, 0.7, 0.4, countRuns(f.kamc, f.delta?.kamc, 7, 10, KAMC_C), 10, cnt),
      runsText(7.46, 3.93 + dy, 0.7, 0.4, countRuns(f.sgh, f.delta?.sgh, 7, 10, SGH_C), 10, cnt),
      text(0.5, 3.86 + dy, 2.48, 0.54, st.desc, 9.5, { color: C.slate500, align: 'right', valign: 'middle', rtl: true, margin: TB }),
    );
  });

  // 100 %-stacked bars, one band per row: KAMC, SGH, then the grey track = row-0 total −
  // this stage, so every bar is drawn against the created total. A row whose three values
  // are all 0 (nothing created at all) gets a track of 1, i.e. an empty grey bar instead
  // of nothing — the same "empty is grey" rule as the doughnuts.
  const remaining = FUNNEL_STAGES.map((_, i) => {
    const f = funnel[i] || {};
    const r = num(f.remaining);
    return (num(f.kamc) + num(f.sgh) + r) > 0 ? r : 1;
  });
  els.push({
    t: 'chart', kind: 'barStacked100', x: 3.1, y: 3.85, w: 4.24, h: 2.8,
    categories: FUNNEL_STAGES.map((s) => s.stage),
    series: [
      { name: H.kamc.code, values: FUNNEL_STAGES.map((_, i) => num(funnel[i]?.kamc)), color: KAMC_C, line: SEAM },
      { name: H.sgh.code, values: FUNNEL_STAGES.map((_, i) => num(funnel[i]?.sgh)), color: SGH_C, line: SEAM },
      { name: 'المتبقي (مسار الشريط)', values: remaining, color: C.bgLighter },
    ],
    opts: {
      gap: 100, layout: { x: 0, y: 0, w: 1, h: 1 }, valueFormat: '0',
      catAxis: { hidden: true, reverse: true }, valAxis: { hidden: true, reverse: true },
    },
  });

  // Ownership brackets: hospitals = rows 1–3 (centres 4.13 → 5.25), labs = rows 4–5.
  const bracket = { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true, margin: TB };
  els.push(
    rect(12.28, 4.13, 0.02, 1.12, C.slate600),
    rect(12.03, 4.12, 0.25, 0.02, C.slate600),
    rect(12.03, 5.24, 0.25, 0.02, C.slate600),
    text(12.31, 4.44, 0.98, 0.5, 'المستشفيات', 11, bracket),
    rect(12.28, 5.81, 0.02, 0.56, C.slate600),
    rect(12.03, 5.8, 0.25, 0.02, C.slate600),
    rect(12.03, 6.36, 0.25, 0.02, C.slate600),
    text(12.31, 5.84, 0.98, 0.5, L('funnelGroupLabs'), 11, bracket),
  );

  // SGH «no TAT» footnote — stays while SGH has no Test Menu (the user's Note 2).
  if (c.testMenu?.sgh === false || (c.testMenu == null && !H.sgh.hasTestMenu)) {
    els.push(
      rect(12.2, 6.755, 0.62, 0.24, SGH_C, { radius: 0.12 }),
      text(12.2, 6.755, 0.62, 0.24, H.sgh.code, 9, { bold: true, color: C.white, align: 'center', valign: 'middle', rtl: false, margin: 0 }),
      text(0.5, 6.74, 11.58, 0.27, SGH_TEXT.noTatNote, 9.5,
        { color: C.slate600, align: 'right', valign: 'middle', rtl: true, margin: TB }),
    );
  }
  return { id: 'execFunnel', bg: C.white, elements: els };
}

// ============================================================================
// Slide 3 — Monthly: stacked KAMC/SGH columns + the 13-row per-hospital table, and the
// KAMC-only turnaround block (line chart + navy card) underneath.
// ============================================================================
// Table columns, visual L→R: total 0.74 · N months (newest at the LEFT) · hospital 0.76 ·
// metric 1.14; the months share 3.92in evenly (7 × 0.56 on the reference) so the table
// keeps its 6.56 width for any month count.
const MT = { x: 6.27, y: 1.0, w: 6.56, totalW: 0.74, monthsW: 3.92, hospW: 0.76, metricW: 1.14 };
const MT_HEAD_H = 0.3, MT_FIRST_H = 0.255, MT_ROW_H = 0.245;
// MORE MONTHS THAN THE REFERENCE (CONTRACT §1.12 "shrink, never overlap"). The data window
// only grows (first → last month with orders), so past 7 months each month column — and
// each chart category, which shares the same 7/N factor — is narrower than the reference's
// 0.56in. Every month-dependent type size (month header cells, month body cells, the
// chart's in-bar / total / SGH-second labels and its category-axis labels) is scaled by
// monthFactor = min(1, monthW / 0.56), so a 13-month table is a smaller copy of the
// 7-month one instead of clipped «1,88» / «68.5'» cells. ≤ 7 months: factor 1, the
// reference's sizes exactly. The total / hospital / metric columns keep their widths and
// sizes (they do not narrow).
const MT_REF_MONTH_W = 0.56;
// TURNAROUND OFF: the reference only shows the block ON. With it off (toggle, or KAMC has
// no measured TAT — e.g. no KAMC rows) the upper band (legend, chart, table, partition
// note: y 0.68 → 4.55) moves down as one piece so it sits centred in the band the block
// would have shared it with (1.0 → 6.972), instead of leaving y 4.58–6.97 empty — the same
// choice build-spec.js makes for the single-hospital deck (its 20-07 placement).
const MT_BAND_BOTTOM = 6.972, MT_NOTE_BOTTOM = 4.33 + 0.22;
const MT_OFF_DY = r5((MT_BAND_BOTTOM - MT_NOTE_BOTTOM) / 2); // 1.211 (band top = MT.y = 1.0)

function buildMonthly(m) {
  const L = labelOf(m);
  const c = m.combined || {};
  const mo = c.monthly || { months: [], rows: [], totals: {}, chart: { kamc: [], sgh: [], total: [] } };
  const months = mo.months || [];
  const N = months.length;
  const labels = months.map(arMonthLabel);
  const monthW = N ? Math.round((MT.monthsW / N) * 1000) / 1000 : 0;
  const mf = N ? Math.min(1, monthW / MT_REF_MONTH_W) : 1; // see MT_REF_MONTH_W
  const msz = (sz) => Math.round(sz * mf * 100) / 100;

  // ---- stacked column chart (oldest month index 0, drawn rightmost by the reversed axis)
  const kamcVals = (mo.chart?.kamc || []).map(num);
  const sghVals = (mo.chart?.sgh || []).map(num);
  const totals = (mo.chart?.total || []).map(num);
  const maxTotal = Math.max(0, ...totals);
  // R1: a month with SGH > 0 moves the SGH count under the total, as a violet 2nd line,
  //     and deletes the in-bar SGH label (reference: Sep, Oct).
  // R2: a KAMC segment shorter than 5 % of the tallest stack cannot hold an 8pt label —
  //     its label is deleted (reference: April = 3 of 515); the total still prints it.
  const kamcHide = kamcVals.map((v, i) => (v > 0 && v < 0.05 * maxTotal ? i : -1)).filter((i) => i >= 0);
  const sghHide = sghVals.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  const segLabels = (hide) => ({ size: msz(8), bold: true, color: C.white, pos: 'ctr', format: '#,##0;;;', hide });
  const els = [...chrome(L('titleMonthly'))];
  const blockEls = [];

  // ---- turnaround block (KAMC only — SGH has no TAT): same boxes as the current slide
  const t = c.turnaround;
  const showTurnaround = m.reportOptions?.kpiCards?.turnaround === true
    && t && Number.isFinite(t.actual) && Number.isFinite(t.expected);
  const dy = showTurnaround ? 0 : MT_OFF_DY; // see MT_OFF_DY
  if (showTurnaround) {
    blockEls.push(
      {
        t: 'chart', kind: 'line', x: 4.139, y: 4.583, w: 9.139, h: 2.389,
        categories: (t.months || []).map(arMonthLabel),
        series: [
          { name: L('chartActual'), values: t.perMonth?.actual || [], color: C.navyChart, marker: 'circle' },
          { name: L('chartExpected'), values: t.perMonth?.expected || [], color: C.orangeSeries, dash: true, marker: 'diamond' },
        ],
        opts: { dataLabels: true, legend: 'bottom', title: L('chartDaysAxis'), valMin: 0 },
      },
      rect(0.5, 4.583, 3.417, 2.389, C.navyChart, { radius: 0.1 }),
      text(0.5, 4.66, 3.417, 0.3, L('overallAvgTitle'), 13, { bold: true, color: CARD_TITLE, align: 'center', valign: 'middle', rtl: true }),
      text(0.5, 5.152, 3.417, 0.68, `الفعلي: ${t.actual.toFixed(1)} يوم`, 24, { bold: true, color: C.white, align: 'center', valign: 'middle', rtl: true }),
      text(0.5, 6.024, 3.417, 0.68, `المتوقع: ${t.expected.toFixed(1)} يوم`, 24, { bold: true, color: C.peach, align: 'center', valign: 'middle', rtl: true }),
    );
  }
  els.push(...blockEls, ...hospitalLegend(dy));

  if (N > 0) {
    els.push({
      t: 'chart', kind: 'colStackedTotal', x: 0.45, y: r5(1.0 + dy), w: 5.7, h: 3.48,
      categories: labels,
      series: [
        { name: H.kamc.code, values: kamcVals, color: KAMC_C, line: SEAM, labels: segLabels(kamcHide) },
        { name: H.sgh.code, values: sghVals, color: SGH_C, line: SEAM, labels: segLabels(sghHide) },
      ],
      total: {
        name: 'الإجمالي',
        labels: { size: msz(9), bold: true, color: C.slate900, pos: 't', format: '#,##0' },
        second: { values: sghVals.map((v) => (v > 0 ? v : null)), size: msz(8), bold: true, color: SGH_C, format: '#,##0' },
      },
      opts: {
        gap: 70, overlap: 100, layout: { x: 0.02, y: 0.07, w: 0.86, h: 0.83 }, valueFormat: '#,##0',
        catAxis: { reverse: true, line: { color: '#BFC7D5', pt: 0.75 }, label: { size: msz(9), color: C.slate900 }, tick: 'out' },
        valAxis: { line: null, label: { size: 8, color: NA_GREY }, grid: { color: '#E5E9F0', pt: 0.75 }, tick: 'none' },
      },
    });
  }

  // ---- the table
  // N = 0 (no orders at all): no month columns; the remaining three keep their widths and
  // the right edge (12.83), so the table simply starts later.
  const tableX = N ? MT.x : MT.x + MT.monthsW;
  const tableW = N ? MT.w : MT.w - MT.monthsW;
  const colW = [MT.totalW, ...Array(N).fill(monthW), MT.hospW, MT.metricW];
  if (N) colW[1] = r5(MT.monthsW - monthW * (N - 1)); // rounding slack on the newest month
  const head = (t2, fillC, size) => ({ text: t2, fill: fillC, size, margin: 0.02, bold: true, color: C.white });
  const header = [
    head('الإجمالي', C.navyDark, 9.5),
    ...rev(labels).map((l) => head(l, C.navy, msz(9))),
    head('المستشفى', C.navy, 9.5),
    head('المؤشر', C.navy, 9.5),
  ];
  const pctColor = (p) => (p == null ? C.slate900 : p === 100 ? C.green : C.red);
  const fmtCell = (cell, f) => (f === 'completionPct' ? pctMonthly(cell[f]) : fmtInt(cell[f]));
  const colorOf = (cell, f) => (f === 'completionPct' ? pctColor(cell[f]) : C.slate900);
  const METRICS = [
    { f: 'orders', label: L('monthlyRowOrders') },
    { f: 'results', label: L('monthlyRowResults') },
    { f: 'incomplete', label: L('monthlyRowIncomplete') },
    { f: 'completionPct', label: L('monthlyRowCompletion') },
  ];
  const rowsNewestFirst = rev(mo.rows || []);
  const body = [];
  const rowH = [MT_HEAD_H];
  for (const met of METRICS) {
    for (const who of ['kamc', 'sgh', 'combined']) {
      const first = who === 'kamc';
      const sub = who === 'combined';
      const top = first ? { top: { color: GROUP_SEP, pt: 1.25 } } : sub ? { top: { color: SUBTOTAL_SEP, pt: 1.25 } } : null;
      const withTop = (cellObj) => (top ? { ...cellObj, border: top } : cellObj);
      const size = sub ? 9 : 8.5;
      const valueCell = (cell, bold, fillC, sz = size) => {
        if (!cell || (!sub && cell.beforeJoin)) {
          return withTop({ text: EN_DASH, size: sz, bold, color: NA_GREY, ...(fillC ? { fill: fillC } : {}) });
        }
        return withTop({ text: fmtCell(cell, met.f), size: sz, bold, color: colorOf(cell, met.f), ...(fillC ? { fill: fillC } : {}) });
      };
      const row = [
        valueCell(mo.totals?.[who], true, C.bgLight),
        ...rowsNewestFirst.map((r) => valueCell(r[who], sub, undefined, msz(size))),
        sub
          ? withTop({ text: 'المجموع', size: 9, bold: true, color: C.slate900, fill: C.bgLight })
          : withTop({ text: H[who].code, size: 8.5, bold: true, color: who === 'kamc' ? KAMC_C : SGH_C, fill: who === 'kamc' ? KAMC_TINT : SGH_TINT }),
      ];
      if (first) {
        row.push(withTop({
          text: met.label, rowSpan: 3, size: 9, bold: true, color: C.slate900, align: 'right', rtl: true,
          margin: [0.02, 0.05, 0.02, 0.04],
        }));
      }
      body.push(row);
      rowH.push(first ? MT_FIRST_H : MT_ROW_H);
    }
  }
  els.push({
    // h = Σ rowH (3.28): the reference graphicFrame's own cy (2999232 EMU).
    t: 'table', x: tableX, y: r5(MT.y + dy), w: tableW, h: r5(rowH.reduce((a, b) => a + b, 0)),
    colW: N ? colW : [MT.totalW, MT.hospW, MT.metricW],
    rowH, header: { fill: C.navy, color: C.white, bold: true }, headerSize: 9.5, bodySize: 8.5,
    margin: [0.01, 0.03, 0.01, 0.03],
    rows: [header, ...body],
  });
  els.push(text(6.27, r5(4.33 + dy), 6.56, 0.22, `${L('monthlyPartition')} · «${EN_DASH}» = قبل انضمام المستشفى`, 8.5,
    { color: C.slate500, align: 'right', valign: 'middle', rtl: true, margin: TB }));
  if (showTurnaround) {
    els.push(
      ...kamcOnlyChip(1.685, 6.64, 1.05, 0.26, CHIP_TURQ, C.navyDark, 9.5),
      ...kamcOnlyChip(11.6, 4.64, 1.05, 0.26, KAMC_C, C.white, 9.5),
    );
  }
  return { id: 'monthly', bg: C.white, elements: els };
}

// ============================================================================
// Slide 4 — Countries: KAMC's local / international split and country bars, plus the
// SGH row (count only — no Test Menu, so no country).
// ============================================================================
const SO = {
  cardY: 1.028, cardW: 5.971, cardH: 1.861, cardR: 0.058, localX: 6.833, intlX: 0.5, accentW: 0.069,
  barX: 2.778, barW: 6.804, barH: 0.306, barR: 0.031, row0: 3.42, rowStep: 0.43, rowH: 0.389, barDY: 0.04,
};
const SO_BAR_RIGHT = SO.barX + SO.barW;
// The ladder must end above the SGH note at 6.40: the reference's seven rows (6 countries +
// SGH) end at 6.389. More rows split the same band evenly and every row shrinks with them
// (bar height, offset and both type sizes ×f), so a squeezed row is a smaller copy.
const SO_LAST_BOTTOM = 6.389, SO_ROW_GAP = 0.041;
function countryRowGeom(n) {
  const N = Math.max(n, 1);
  if (N <= 7) return { step: SO.rowStep, rowH: SO.rowH, f: 1 };
  const step = (SO_LAST_BOTTOM + SO_ROW_GAP - SO.row0) / N;
  const rowH = Math.min(SO.rowH, step - SO_ROW_GAP);
  return { step, rowH, f: rowH / SO.rowH };
}

function sendoutCard(x, accentX, accentColor, count, label, caption) {
  const tx = x + 0.167;
  return [
    rect(x, SO.cardY, SO.cardW, SO.cardH, C.white, { radius: SO.cardR, line: { color: C.border, w: 0.75 } }),
    rect(accentX, SO.cardY, SO.accentW, SO.cardH, accentColor, { radius: 0.0115 }),
    text(tx, 1.222, 5.611, 0.722, fmtInt(count), 34, { bold: true, color: accentColor, align: 'right', valign: 'middle' }),
    text(tx, 2.0, 5.611, 0.417, label, 11.5, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
    text(tx, 2.444, 5.611, 0.306, caption, 9.5, { color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
  ];
}

function buildCountries(m) {
  const L = labelOf(m);
  const c = m.combined || {};
  const co = c.countries || { total: 0, local: 0, international: 0, localPct: 0, internationalPct: 0, byCountry: [], sgh: { orders: 0 } };
  const T = num(co.total);
  const caption = (p) => `تمثل ${num(p).toFixed(1)}% من إجمالي طلبات KAMC`;
  const sghNoMenu = c.testMenu ? c.testMenu.sgh === false : !H.sgh.hasTestMenu;

  const countries = co.byCountry || [];
  const g = countryRowGeom(countries.length + 1);
  const barH = SO.barH * g.f, barDY = SO.barDY * g.f;
  const rows = [];
  countries.forEach((cn, i) => {
    const y = SO.row0 + i * g.step;
    const colour = cn.country === 'Saudi Arabia' ? C.navy : C.amber;
    const w = T ? (SO.barW * num(cn.orders)) / T : 0;
    // build-spec.js visibility floor: never narrower than 2 × the corner radius.
    const drawnW = Math.max(w, SO.barR * 2);
    rows.push(
      text(9.722, y, 3.083, g.rowH, AR_COUNTRY[cn.country] || cn.country, 12 * g.f,
        { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
      rect(SO.barX, y + barDY, SO.barW, barH, C.bgLighter, { radius: SO.barR }),
      rect(SO_BAR_RIGHT - drawnW, y + barDY, drawnW, barH, colour, { radius: SO.barR }),
      text(0.5, y, 2.139, g.rowH, `${num(cn.pct).toFixed(1)}%  |  ${fmtInt(cn.orders)}`, 14 * g.f,
        { bold: true, color: colour, align: 'left', valign: 'middle' }),
    );
  });
  // SGH row, always last on the same ladder. Its bar is measured against the KAMC total —
  // the basis note says so — and is red on the grey track; its value is the count only.
  // With no SGH orders the row keeps its label, track and «0» but draws no bar.
  {
    const y = SO.row0 + countries.length * g.step;
    const n = num(co.sgh?.orders);
    const w = T ? Math.min(SO.barW, (SO.barW * n) / T) : 0;
    const drawnW = n > 0 && w > 0 ? Math.max(w, SO.barR * 2) : 0;
    rows.push(
      text(9.722, y, 3.083, g.rowH, SGH_TEXT.arName, 12 * g.f, { bold: true, color: C.red, align: 'right', valign: 'middle', rtl: true }),
      rect(SO.barX, y + barDY, SO.barW, barH, C.bgLighter, { radius: SO.barR }),
    );
    // The reference's SGH bar carries the TRACK's adj (10131), i.e. radius 0.10131 × its
    // shorter side, not the country bars' constant 0.031.
    if (drawnW > 0) rows.push(rect(SO_BAR_RIGHT - drawnW, y + barDY, drawnW, barH, C.red, { radius: COUNTRY_TRACK_ADJ * Math.min(drawnW, barH) }));
    rows.push(text(0.5, y, 2.139, g.rowH, fmtInt(n), 14 * g.f, { bold: true, color: C.red, align: 'left', valign: 'middle' }));
  }

  const keyLab = { color: C.slate500, align: 'right', valign: 'middle', rtl: true, margin: 0 };
  const els = [
    ...chrome(L('sendoutTitle')),
    text(6.054, 0.722, 6.75, 0.181, L('sendoutSubtitle'), 9, { color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
    ...sendoutCard(SO.localX, 12.733, C.navy, co.local, L('sendoutLocal'), caption(co.localPct)),
    ...sendoutCard(SO.intlX, 6.403, C.amber, co.international, L('sendoutIntl'), caption(co.internationalPct)),
    rect(0.5, 3.05, 12.297, 0.012, C.border),
    text(0.5, 3.12, 12.297, 0.278, L('sendoutByCountry'), 12, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
    ...rows,
    ...kamcOnlyChip(7.0, 1.2, 0.95, 0.24, KAMC_C, C.white, 8.5),
    ...kamcOnlyChip(0.67, 1.2, 0.95, 0.24, KAMC_C, C.white, 8.5),
  ];
  if (sghNoMenu) {
    els.push(text(0.5, 6.4, 12.3, 0.26, SGH_TEXT.countryNote, 9.5,
      { bold: true, color: NOTE_RED, align: 'right', valign: 'middle', rtl: true, margin: TB }));
  }
  els.push(
    rect(12.68, 6.76, 0.12, 0.12, C.navy, { radius: 0.024 }),
    text(12.22, 6.7, 0.4, 0.24, 'محلي', 9, keyLab),
    rect(11.86, 6.76, 0.12, 0.12, C.amber, { radius: 0.024 }),
    text(11.4, 6.7, 0.4, 0.24, 'دولي', 9, keyLab),
  );
  if (sghNoMenu) {
    els.push(
      rect(11.04, 6.76, 0.12, 0.12, C.red, { radius: 0.024 }),
      text(8.13, 6.7, 2.85, 0.24, SGH_TEXT.countryLegend, 9, keyLab),
    );
  }
  els.push(text(0.5, 6.7, 7.49, 0.24,
    `·  النسب وطول الشريط من إجمالي طلبات KAMC البالغة ${fmtInt(T)}${RLM}  ·  بطاقتا المحلي والدولي تخصان KAMC فقط`, 9,
    { color: C.slate500, align: 'right', valign: 'middle', rtl: true, margin: TB }));
  return { id: 'sendoutCountries', bg: C.white, elements: els };
}

// ============================================================================
// Slide 5 — Labs: one row per (hospital, lab, country, reference lab), KAMC then SGH.
// ============================================================================
const LAB_COL_W = [1.111, 0.972, 3.472, 1.806, 3.306, 1.0]; // visual L→R: share … hospital
const LAB_Y = 1.05, LAB_HEAD_H = 0.361, LAB_ROW_H = 0.28, LAB_FLOOR = 6.2; // separator at 6.24
// Overflow squeeze (CONTRACT §1.12): type shrinks in proportion to the row pitch, so a
// squeezed table is a smaller copy of the reference's — 1 at the reference pitch.
const fontFactor = (rowH, refRowH) => Math.min(1, rowH / refRowH);

/** «{lab} في دولتين / في {n} دول / في {n} دولة» — Arabic counted-noun agreement. */
const inCountries = (n) => (n === 2 ? 'دولتين' : n <= 10 ? `${n} دول` : `${n} دولة`);

function buildLabs(m) {
  const L = labelOf(m);
  const c = m.combined || {};
  const lb = c.labs || { total: 0, basis: { kamc: 0, sgh: 0, combined: 0 }, rows: [], multiCountry: [] };
  const multi = new Set((lb.multiCountry || []).map((x) => x.lab));
  const byH = { kamc: [], sgh: [] };
  for (const r of lb.rows || []) (byH[r.hospital] || (byH[r.hospital] = [])).push(r);
  // A hospital with no lab rows still shows (§1.12): one placeholder row «–» / 0.
  for (const h of ['kamc', 'sgh']) {
    if (!byH[h].length) byH[h].push({ hospital: h, lab: EN_DASH, country: null, reflab: null, orders: 0, share: 0, underTenth: false, placeholder: true });
  }
  const noMenu = (h) => (c.testMenu ? c.testMenu[h] === false : !H[h].hasTestMenu);

  // Heights: header 0.361, body/total 0.28. A no-menu block of ONE row is two rows tall,
  // because its merged note is two lines. Past the separator (6.24) every body row shrinks
  // evenly and the type with it.
  const bodyUnits = byH.kamc.length + byH.sgh.length + 1
    + (noMenu('kamc') && byH.kamc.length === 1 ? 1 : 0) + (noMenu('sgh') && byH.sgh.length === 1 ? 1 : 0);
  const bodyH = Math.min(LAB_ROW_H, floor5((LAB_FLOOR - LAB_Y - LAB_HEAD_H) / bodyUnits));
  const ff = fontFactor(bodyH, LAB_ROW_H);
  const sz = (s) => Math.round(s * ff * 100) / 100;
  const share = (r) => (r.underTenth ? '<0.1%' : `${num(r.share).toFixed(1)}%`);
  const bodyMargin = [0.01, 0.1, 0.01, 0.1];

  const header = [L('sendoutColShare'), L('sendoutColOrders'), L('sendoutColRefLab'), L('sendoutColCountry'), L('sendoutColLab'), 'المستشفى'];
  const rows = [header];
  const rowH = [LAB_HEAD_H];
  for (const h of ['kamc', 'sgh']) {
    const list = byH[h];
    const nm = noMenu(h);
    const tint = h === 'kamc' ? KAMC_TINT : SGH_TINT;
    const ink = h === 'kamc' ? KAMC_C : SGH_C;
    list.forEach((r, i) => {
      const shade = nm ? C.bgRed : (multi.has(r.lab) && !r.placeholder ? C.bgLighter : undefined);
      const cell = (t2, o = {}) => ({ text: t2, size: sz(10), color: C.slate900, margin: bodyMargin, ...(shade ? { fill: shade } : {}), ...o });
      const row = [
        cell(share(r)),
        cell(fmtInt(r.orders), { bold: true, color: C.navy }),
      ];
      if (nm) {
        if (i === 0) {
          row.push(cell(SGH_TEXT.labsNote,
            { colSpan: 2, rowSpan: list.length, size: sz(9.5), bold: true, color: NOTE_RED, rtl: true }));
        }
      } else {
        row.push(
          cell(r.reflab == null ? EN_DASH : r.reflab, { size: sz(9), color: C.slate500 }),
          cell(r.country == null ? EN_DASH : (AR_COUNTRY[r.country] || r.country)),
        );
      }
      row.push(cell(r.lab));
      if (i === 0) {
        row.push({ text: H[h].code, rowSpan: list.length, size: sz(11), bold: true, color: ink, fill: tint, margin: bodyMargin });
      }
      rows.push(row);
      rowH.push(nm && list.length === 1 ? r5(bodyH * 2) : r5(bodyH));
    });
  }
  const tot = (t2, o = {}) => ({ text: t2, size: sz(10), bold: true, color: C.white, fill: C.taskNavy, margin: bodyMargin, ...o });
  rows.push([
    tot('100.0%'), tot(fmtInt(lb.total)), tot(''), tot(''), tot(L('sendoutTotalRow'), { colSpan: 2, rtl: true }),
  ]);
  rowH.push(r5(bodyH));

  // Shaded-rows note: every multi-country KAMC lab, in table order.
  const parts = (lb.multiCountry || []).map((x) => `${x.lab} في ${inCountries(x.countries)}`);
  const note = parts.length ? `صفوف مظللة: مختبر يعمل في أكثر من دولة — ${parts.join('، و ')}` : L('sendoutOneCountry');
  const basis = lb.basis || { kamc: 0, sgh: 0, combined: 0 };

  return {
    id: 'sendoutLabs', bg: C.white, elements: [
      ...chrome(L('sendoutLabsTitle')),
      text(6.054, 0.722, 6.75, 0.181, 'صف لكل مستشفى ومختبر ودولة · المختبر العامل في أكثر من دولة له صف لكل دولة وتُعرض صفوفه متجاورة', 9,
        { color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
      {
        t: 'table', x: 0.833, y: LAB_Y, w: 11.667, rtl: true, rowH,
        headerSize: 10, bodySize: 10,
        header: { fill: C.navy, color: C.white, bold: true },
        colW: LAB_COL_W,
        rows,
      },
      rect(0.833, 6.24, 11.667, 0.012, C.border),
      text(0.833, 6.3, 11.667, 0.25, note, 10, { color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
      runsText(0.833, 6.61, 11.667, 0.222, [
        { text: `${fill(L('sendoutBasis'), { total: fmtInt(lb.total) })}  —  ` },
        { text: H.kamc.code + ' ' },
        { text: fmtInt(basis.kamc), bold: true, color: KAMC_C },
        { text: `${RLM}  ·  ${RLM}` },
        { text: H.sgh.code + ' ' },
        { text: fmtInt(basis.sgh), bold: true, color: SGH_C },
      ], 9, { color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
    ],
  };
}

// ============================================================================
// Slide 6 — Compliance: one row per (hospital, CSV lab), # continuous, KAMC-only late.
// ============================================================================
const COMP_COL_W = [1.601, 0.715, 0.81, 2.0, 1.319, 1.19, 2.612, 0.42, 1.0]; // late% … hospital
const COMP_Y = 1.12, COMP_ROW_H = 0.275, COMP_FLOOR = 6.2; // footnote at 6.24

function buildCompliance(m) {
  const L = labelOf(m);
  const c = m.combined || {};
  const cp = c.compliance || { rows: [], totals: {} };
  const noMenu = (h) => (c.testMenu ? c.testMenu[h] === false : !H[h].hasTestMenu);
  const byH = { kamc: [], sgh: [] };
  for (const r of cp.rows || []) (byH[r.hospital] || (byH[r.hospital] = [])).push(r);
  for (const h of ['kamc', 'sgh']) {
    if (!byH[h].length) {
      byH[h].push({ no: null, hospital: h, lab: EN_DASH, total: 0, completed: 0, awaitingResult: 0, rejected: 0,
        late: noMenu(h) ? null : 0, latePct: noMenu(h) ? null : 0 });
    }
  }
  // Every row 0.275 (header included); a ONE-row no-menu block is two rows tall (its note
  // is two lines). Past the footnote (6.24) all rows shrink evenly, type with them.
  const units = 2 + byH.kamc.length + byH.sgh.length
    + (noMenu('kamc') && byH.kamc.length === 1 ? 1 : 0) + (noMenu('sgh') && byH.sgh.length === 1 ? 1 : 0);
  const rowHt = Math.min(COMP_ROW_H, floor5((COMP_FLOOR - COMP_Y) / units));
  const ff = fontFactor(rowHt, COMP_ROW_H);
  const sz = (s) => Math.round(s * ff * 100) / 100;

  const header = [
    { text: L('compLatePct'), size: sz(10) }, { text: 'متأخرة', size: sz(10) },
    { text: 'مرفوضة', fill: C.taskNavy, size: sz(10) }, { text: L('compAwaiting'), size: sz(10) },
    { text: L('compCompleted'), size: sz(10) }, { text: L('compTotal'), size: sz(10) },
    { text: L('compLab'), size: sz(10) }, { text: L('compHash'), size: sz(10) },
    // rtl:false — the reference's own paragraph attribute on this one header cell.
    { text: 'المستشفى', size: sz(10), rtl: false },
  ];
  const rows = [header];
  const rowH = [r5(rowHt)];
  const anyNoMenu = ['kamc', 'sgh'].some(noMenu);
  for (const h of ['kamc', 'sgh']) {
    const list = byH[h];
    const nm = noMenu(h);
    list.forEach((r, i) => {
      const shade = nm ? C.bgRed : undefined;
      const cell = (t2, o = {}) => ({ text: t2, size: sz(10), color: C.slate900, ...(shade ? { fill: shade } : {}), ...o });
      const late = (t2) => cell(t2, { bold: true, color: C.redSoft });
      const row = [];
      if (nm) {
        if (i === 0) {
          row.push(cell(SGH_TEXT.complianceNote,
            { colSpan: 2, rowSpan: list.length, size: sz(9.5), bold: true, color: NOTE_RED, rtl: true }));
        }
      } else {
        row.push(late(pctLab(num(r.latePct))), late(String(num(r.late))));
      }
      const done = num(r.completed);
      row.push(
        cell(String(num(r.rejected))),
        cell(String(num(r.awaitingResult))),
        done > 0 ? cell(String(done), { bold: true, color: C.green }) : cell(String(done)),
        cell(String(num(r.total))),
        cell(r.lab, { align: 'right' }),
        cell(r.no == null ? EN_DASH : String(r.no)),
      );
      if (i === 0) {
        row.push({ text: H[h].code, rowSpan: list.length, size: sz(11), bold: true,
          color: h === 'kamc' ? KAMC_C : SGH_C, fill: h === 'kamc' ? KAMC_TINT : SGH_TINT });
      }
      rows.push(row);
      rowH.push(nm && list.length === 1 ? r5(rowHt * 2) : r5(rowHt));
    });
  }
  const t = cp.totals || {};
  // Late and late % in the total row cover the Test-Menu hospitals only; the «*» points at
  // the footnote that says so (shown while a hospital has no Test Menu).
  const star = anyNoMenu ? '*' : '';
  const tc = (t2, o = {}) => ({ text: t2, size: sz(10), bold: true, color: C.slate900, fill: C.bgLighter, ...o });
  const doneTot = num(t.completed);
  rows.push([
    tc(pctLab(num(t.latePct)) + star, { color: C.redSoft }),
    tc(String(num(t.late)) + star, { color: C.redSoft }),
    tc(String(num(t.rejected))),
    tc(String(num(t.awaitingResult))),
    tc(String(doneTot), doneTot > 0 ? { color: C.green } : {}),
    tc(String(num(t.total))),
    tc('المجموع', { colSpan: 3, align: 'right', rtl: true }),
  ]);
  rowH.push(r5(rowHt));

  const foot = [{ text: L('compPartition'), br: anyNoMenu }];
  if (anyNoMenu) foot.push({ text: '* المتأخرة ونسبتها في صف المجموع تخص KAMC فقط' });
  return {
    id: 'compliance', bg: C.white, elements: [
      ...chrome(L('titleCompliance')),
      {
        t: 'table', x: 0.833, y: COMP_Y, w: 11.667, rtl: true, rowH,
        header: { fill: C.navy, color: C.white, bold: true },
        colW: COMP_COL_W,
        rows,
      },
      runsText(0.833, 6.24, 11.667, 0.5, foot, 9, { color: C.slate500, align: 'right', valign: 'top', rtl: true }),
    ],
  };
}

// ============================================================================
// Slide 7 — Thanks (identical to the single-hospital deck)
// ============================================================================
function buildThanks(m) {
  const L = labelOf(m);
  return {
    id: 'thanks', bg: C.navy, elements: [
      rect(0, 0, 0.15, 7.5, C.purple),
      rect(13.15, 0, 0.15, 7.5, C.orange),
      text(8.7, 0.5, 4.0, 0.5, 'NUPCO  |  Lean', 18, { bold: true, color: C.white, align: 'right', valign: 'middle' }),
      text(0.895, 3.1, 11.9, 1.3, L('thanks'), 60, { bold: true, color: C.white, align: 'center', valign: 'middle', rtl: true }),
    ],
  };
}

/**
 * @param {Object} model  a buildBothModel result ({ hospital:'both', reportDate, reportOptions,
 *                        deltaWindow, kamc, sgh, combined } — map/model-both.md)
 * @param {{variant?:('internal'|'nupco')}} [opts]  accepted for buildSpec parity; the BOTH
 *                        deck is the same for both variants
 * @returns {import('../contracts.js').SlideSpec}
 */
export function buildBothSpec(model, { variant = 'internal' } = {}) {
  const m = model || {};
  const slides = m.reportOptions?.slides;
  const on = (key) => !slides || slides[key] !== false;
  const c = m.combined || {};
  // Send-out pair: only when the KAMC catalogue produced a send-out block AND there is at
  // least one order to show (the single-hospital deck's `sendout.total` gate).
  const sendoutData = !!(c.countries && c.labs && num(c.labs.total) > 0);
  // The content units, in the reference's (= the default) order. SLIDE ORDER: they go
  // through the same orderUnits sort as build-spec.js's middleDefs (model/slide-order.js),
  // so the operator's saved / one-report order applies here too and each unit (the send-out
  // pair, the tracker pages) moves as one block; units this deck does not have (shipments,
  // challenges, definitions) are simply absent. Sorting BEFORE the page-number pass keeps
  // the numbers 1..n in the new order; with no order set the sequence — and the deck — is
  // exactly the pre-order one.
  const defs = [
    // exec is ALWAYS on in this deck (its toggle is not honoured — see the header).
    { key: 'execFunnel', always: true, build: () => [buildExec(m)] },
    { key: 'monthly', build: () => [buildMonthly(m)] },
    { key: 'sendout', build: () => (sendoutData ? [buildCountries(m), buildLabs(m)] : []) },
    { key: 'compliance', build: () => [buildCompliance(m)] },
    // Project tracker: [] without a tracker (or with no task left that is not Completed —
    // no cadence prints a Completed task there, 2026-10-18). Text language =
    // reportOptions.trackerLang, as in build-spec.js.
    { key: 'tracker', build: () => buildTrackerSlides(m.projectTracker, { reportDate: m.reportDate, variant, labels: labelOf(m), lang: m.reportOptions?.trackerLang, cadence: cadenceOf(m) }) },
    // The weekly completed-this-week slide, as in build-spec.js (weekly only, own toggle).
    { key: 'trackerCompleted', build: () => (unitInCadence('trackerCompleted', cadenceOf(m))
      ? buildTrackerCompletedSlides(m.projectTracker, m.trackerStatusLog, { reportDate: m.reportDate, labels: labelOf(m), lang: m.reportOptions?.trackerLang })
      : []) },
  ];
  const middle = orderUnits(defs, slideOrderOf(m)).filter((d) => d.always || on(d.key)).flatMap((d) => d.build());
  middle.forEach((s, i) => s.elements.push(pageFooter(i + 1)));
  return [buildCover(m), ...middle, buildThanks(m)];
}

export default buildBothSpec;
