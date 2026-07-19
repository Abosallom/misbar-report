// src/slidespec/build-spec.js
// buildSpec(reportModel, { variant }) -> SlideSpec (see src/contracts.js).
// One builder per slide. ALL geometry is in inches, derived by converting EMU->inches
// (÷914400) from the original deck OOXML (تقرير مسبار 09072026.pptx).
// SIX-slide deck (both variants): cover · execFunnel · monthly · compliance · action · thanks.
// The variant no longer changes slide PRESENCE — it changes slide-5 (action) task ROWS:
// nupco shows tasksCurrent (non-لين actions); internal shows tasksInternal ONLY (لين-category
// actions — user decision 2026-07-19). No slide is internalOnly.
import { COLORS as C, GEOM } from '../theme.js';

// Colors present in the deck charts/cards but not in theme.js:
const CHART_BLUE = '#4472C4';   // chart1 series "الطلبات" (accent1)
const CHART_GRAY = '#A5A5A5';   // chart1 series "النتائج غير المكتملة" (accent3)
const CARD_TITLE = '#DCE6F1';   // overall-average card sub-title

// Gregorian month-name lookup ('01'..'12' -> Arabic). Drives the monthly table
// headers and BOTH slide-3 chart category lists off m.kpi.monthly, so labels track
// the data instead of being pinned to Jan–Jul.
const MONTH_NAMES_AR = {
  '01': 'يناير', '02': 'فبراير', '03': 'مارس',   '04': 'أبريل',  '05': 'مايو',   '06': 'يونيو',
  '07': 'يوليو', '08': 'أغسطس',  '09': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر',
};
const arMonthLabel = (key) => MONTH_NAMES_AR[String(key).split('-')[1]] || String(key);

// ---- tiny element factories -------------------------------------------------
const rect = (x, y, w, h, fill, extra = {}) => ({ t: 'rect', x, y, w, h, fill, ...extra });
const text = (x, y, w, h, t, size, o = {}) => ({ t: 'text', x, y, w, h, text: t, size, ...o });
const rev = (a) => a.slice().reverse();

// ---- formatting -------------------------------------------------------------
const fmtDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d} / ${m} / ${y}`; };
const pctLab = (n) => (n === 0 ? '0%' : n.toFixed(1) + '%');           // late-%
const pctMonthly = (n) => (n == null ? '-' : n === 100 ? '100%' : n.toFixed(1) + '%');
const bullets = (items) => items.map((s) => '•  ' + s).join('\n');

// ---- repeated chrome (top bar, section title, corner tags, footer) ----------
function chrome(title, pageNo) {
  return [
    rect(0, 0, GEOM.slideW, 0.08, C.navy),
    text(0.5, 0.25, 12.3, 0.55, title, 22, { bold: true, color: C.navy, align: 'center', valign: 'middle', rtl: true }),
    text(10.9, 0.3, 2.0, 0.4, 'NUPCO  |  Lean', 10, { color: C.slate500, align: 'right', valign: 'middle' }),
    text(0.4, 0.3, 3.5, 0.4, 'مسبار  •  مدينة الملك عبدالله الطبية', 10, { color: C.slate500, align: 'left', valign: 'middle', rtl: true }),
    rect(0.5, 7.1, 12.3, 0.012, C.border),
    text(0.5, 7.15, 0.8, 0.3, String(pageNo), 9, { color: C.slate500, align: 'left', valign: 'middle' }),
  ];
}

// ============================================================================
// Slide 1 — Cover
// ============================================================================
function buildCover(m) {
  return {
    id: 'cover', bg: C.navy, elements: [
      rect(0, 0, 0.15, 7.5, C.purple),
      rect(13.15, 0, 0.15, 7.5, C.orange),
      text(8.7, 0.5, 4.0, 0.5, 'NUPCO  |  Lean', 18, { bold: true, color: C.white, align: 'right', valign: 'middle' }),
      text(0.6, 2.6, 11.9, 1.3, 'تقرير مسبار اليومي', 60, { bold: true, color: C.white, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 4.0, 11.9, 0.6, 'متابعة تقدم الطلبات وقياس جاهزية المختبرات', 22, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 5.6, 11.9, 0.5, 'مدينة الملك عبدالله الطبية', 20, { color: C.white, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 6.15, 11.9, 0.4, 'تاريخ التقرير: ' + fmtDate(m.reportDate), 12, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 6.55, 11.9, 0.4, 'إعداد: لين لخدمات الأعمال', 12, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true }),
    ],
  };
}

// ============================================================================
// Slide 2 — Executive summary + order-journey funnel (merged)
// ============================================================================
// KPI card factory. Width is a param (the row packs 7 cards now); height/y and the
// inner layout proportions are fixed. Number font 34pt — the narrower 1.639in card
// leaves ~1.40in of ink box, which still fits a 4-char worst case ('1234') at 34pt
// (was 40pt when cards were 1.903in wide).
function kpiCard({ x, w, v, vc, lab, sub, ac, delta }) {
  const y = 0.93, h = 1.6;
  const els = [
    rect(x, y, w, h, C.white, { radius: 0.05, line: { color: C.border, w: 0.75 } }),
    rect(x + w - 0.063, y, 0.063, h, ac),
    text(x + 0.08, y + 0.13, w - 0.24, 0.72, v, 34, { bold: true, color: vc, align: 'right', valign: 'middle' }),
    text(x + 0.08, y + 0.9, w - 0.16, 0.42, lab, 11.5, { bold: true, color: C.slate900, align: 'right', valign: 'top', rtl: true }),
  ];
  if (sub) els.push(text(x + 0.08, y + 1.28, w - 0.16, 0.28, sub, 9.5, { color: C.slate500, align: 'right', valign: 'top', rtl: true }));
  if (delta) els.push(text(x + 0.1, y + 0.3, 0.9, 0.42, delta, 20, { bold: true, color: C.deltaGreen, align: 'left', valign: 'middle' }));
  return els;
}

// The KPI cards own these metrics' delta chips; the funnel must not duplicate them.
const KPI_DELTA_KEYS = new Set(['total', 'awaitingDispatch', 'awaitingResults', 'completed', 'rejected', 'lateNoResult', 'shippedNotReceived']);

// KPI row geometry: 7 cards between x 0.500 and 12.818 (span 12.318in), gap 0.140.
// cardW = (12.318 − 6×0.140) / 7 = 1.639in; step = cardW + gap = 1.779in.
// Rightmost card (total) at x = 12.818 − 1.639 = 11.179; each card to its left is
// one step lower. Leftmost (shippedNotReceived) lands at 0.505 (≈ the 0.500 edge).
const KPI_CARD_W = 1.639;
const KPI_X = (i) => Math.round((11.179 - i * 1.779) * 1000) / 1000; // i=0 rightmost

function buildExecFunnel(m) {
  const b = m.kpi.buckets;
  const f = m.kpi.funnel;
  const d = m.kpi.deltas || {};

  // -- ZONE A: 7 KPI cards in one row, right-to-left (total rightmost). المرفوضة
  // sits between المكتملة and المتأخرة. Each card shows a green "+N" chip when its
  // own delta key > 0.
  const cards = [
    { x: KPI_X(0), v: String(m.kpi.totals.total), vc: C.blue, lab: 'إجمالي الطلبات', sub: 'يناير – يوليو', ac: C.blue, dk: 'total' },
    { x: KPI_X(1), v: String(b.awaitingDispatch), vc: C.greenSoft, lab: 'في انتظار شحن العينة (المستشفى)', sub: 'قبل الـ Dispatch', ac: C.greenSoft, dk: 'awaitingDispatch' },
    { x: KPI_X(2), v: String(b.awaitingResults), vc: C.amber, lab: 'في انتظار نتائج العينة (المختبر)', sub: 'بعد الـ Dispatch', ac: C.amber, dk: 'awaitingResults' },
    { x: KPI_X(3), v: String(b.completed), vc: C.green, lab: 'نتائج مكتملة', sub: '', ac: C.green, dk: 'completed' },
    { x: KPI_X(4), v: String(b.rejected), vc: C.redSoft, lab: 'النتائج المرفوضة', sub: 'نتائج مرفوضة من المختبر', ac: C.redSoft, dk: 'rejected' },
    { x: KPI_X(5), v: String(b.lateNoResult), vc: C.redPure, lab: 'الطلبات المتأخرة', sub: `تمثل ${b.latePct}% من الطلبات`, ac: C.redPure, dk: 'lateNoResult' },
    { x: KPI_X(6), v: String(b.shippedNotReceived), vc: C.redSoft, lab: 'شُحنت ولم تُستلم', sub: '', ac: C.redSoft, dk: 'shippedNotReceived' },
  ];
  const kpiEls = cards.flatMap((c) => kpiCard({ ...c, w: KPI_CARD_W, delta: d[c.dk] > 0 ? '+' + d[c.dk] : undefined }));

  // -- ZONE B: order-journey funnel (from old buildJourney; X unchanged, Y +0.40)
  const maxV = f.created;
  const rows = [
    { stage: '1. إنشاء طلب', val: f.created, desc: 'الطلب أُنشئ في مسبار', color: C.navy, key: 'total' },
    { stage: '2. سحب العينة', val: f.collected, desc: 'العينة مُجمَّعة في KAMC', color: C.blue, key: 'collected' },
    { stage: '3. شحن العينة', val: f.dispatched, desc: 'العينة شُحنت من قبل المستشفى', color: C.amber, key: 'dispatched' },
    { stage: '4. إستلام العينة', val: f.received, desc: 'حالة إستلام العينة بقبولها او رفضها', color: C.greenSoft, key: 'received' },
    { stage: '5. إصدار نتيجة', val: f.resulted, desc: 'نتيجة تحليل العينة', color: C.greenBright, key: 'completed' },
  ];
  const rowY = [3.226, 3.876, 4.526, 5.176, 5.862];
  const accentY = [3.276, 3.926, 4.576, 5.226, 5.912];
  const barY = [3.297, 3.947, 4.597, 5.247, 5.932];
  const trackX = 3.92, trackW = 5.0, barH = 0.3;

  const els = [
    ...chrome('الملخص التنفيذي  •  رحلة الطلب', 1),
    ...kpiEls,
    text(10.542, 2.55, 2.271, 0.32, `* ${m.kpi.cancelledNote} طلب ملغي`, 11, { bold: true, color: C.slate600, align: 'right', valign: 'middle', rtl: true }),
    // Funnel column labels
    text(9.05, 2.906, 3.0, 0.3, 'المرحلة', 10, { bold: true, color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
    text(8.629, 2.906, 1.0, 0.3, 'العدد', 10, { bold: true, color: C.slate500, align: 'center', valign: 'middle', rtl: true }),
    text(0.05, 2.906, 2.9, 0.3, 'الوصف', 10, { bold: true, color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
    // Brackets
    rect(12.03, 3.501, 0.02, 1.3, C.slate600),
    text(12.35, 3.824, 0.9, 0.55, 'المستشفى', 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
    rect(12.03, 5.451, 0.02, 0.685, C.slate600),
    text(12.25, 5.496, 0.95, 0.55, 'المختبرات', 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
  ];
  rows.forEach((r, i) => {
    const fillW = Math.round((r.val / maxV) * trackW * 1000) / 1000;
    els.push(
      rect(11.97, accentY[i], 0.06, 0.45, r.color),
      text(9.05, rowY[i], 2.85, 0.55, r.stage, 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
      text(8.629, rowY[i], 1.0, 0.55, String(r.val), 14, { bold: true, color: r.color, align: 'center', valign: 'middle' }),
      text(0.05, rowY[i], 2.9, 0.55, r.desc, 10, { color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
      rect(trackX, barY[i], trackW, barH, C.bgLighter, { radius: 0.03 }),
      rect(trackX + trackW - fillW, barY[i], fillW, barH, r.color, { radius: 0.03 }),
    );
    // Stage delta chip — de-duplicated: endpoint metrics (total/completed) are shown
    // on their KPI cards, so the funnel only surfaces intermediate flow deltas.
    if (d[r.key] > 0 && !KPI_DELTA_KEYS.has(r.key)) {
      els.push(text(7.75, rowY[i], 0.75, 0.55, '+' + d[r.key], 10, { bold: true, color: C.deltaGreen, align: 'center', valign: 'middle' }));
    }
  });
  return { id: 'execFunnel', bg: C.white, elements: els };
}

// ============================================================================
// Slide 3 — Monthly orders & results
// ============================================================================
function buildMonthly(m) {
  const mo = m.kpi.monthly;
  const bg = C.bgLight;
  // Month list derived from the data — drives the table headers AND both chart
  // category lists so labels/series follow m.kpi.monthly, not a fixed Jan–Jul.
  const monthKeys = mo.map((x) => x.month);
  const monthLabels = monthKeys.map(arMonthLabel);
  // Totals column computed from the rows (guard divide-by-zero on completion).
  const oTot = mo.reduce((s, x) => s + x.orders, 0);
  const rTot = mo.reduce((s, x) => s + x.results, 0);
  const rejTot = mo.reduce((s, x) => s + (x.rejected || 0), 0);
  const iTot = mo.reduce((s, x) => s + x.incomplete, 0);
  const cPct = oTot > 0 ? Math.round((rTot / oTot) * 1000) / 10 : null; // round1(results/orders*100)
  const cTot = pctMonthly(cPct);
  // logical (deck) order: [label, months…, total]; reverse -> visual L->R
  const header = rev(['المؤشر', ...monthLabels, { text: 'الإجمالي', fill: C.navyDark }]);
  const rowOrders = rev([{ text: 'الطلبات', align: 'right' }, ...mo.map((x) => String(x.orders)), { text: String(oTot), fill: bg, bold: true }]);
  const rowResults = rev([{ text: 'النتائج المستلمة', align: 'right' }, ...mo.map((x) => String(x.results)), { text: String(rTot), fill: bg, bold: true }]);
  const rowRejected = rev([{ text: 'النتائج المرفوضة', align: 'right' }, ...mo.map((x) => String(x.rejected || 0)), { text: String(rejTot), fill: bg, bold: true }]);
  const rowIncomplete = rev([{ text: 'النتائج غير المكتملة', align: 'right' }, ...mo.map((x) => String(x.incomplete)), { text: String(iTot), fill: bg, bold: true }]);
  const rowCompletion = rev([{ text: 'نسبة الاكتمال', align: 'right' }, ...mo.map((x) => pctMonthly(x.completionPct)), { text: cTot, fill: bg, bold: true }]);

  // Column widths: label + N month cols + total over the fixed table width. The
  // canonical 7-month deck keeps its original per-column widths verbatim
  // (pixel-identical); any other count spreads the middle span evenly.
  const MONTH_COLW = [0.623, 0.623, 0.623, 0.561, 0.686, 0.679, 0.679]; // deck OOXML, 7 months
  const LABEL_COLW = 1.312, TOTAL_COLW = 0.874, TABLE_W = 6.661;
  const monthColW = mo.length === MONTH_COLW.length
    ? MONTH_COLW
    : Array(mo.length).fill(Math.round(((TABLE_W - LABEL_COLW - TOTAL_COLW) / mo.length) * 1000) / 1000);

  const table = {
    t: 'table', x: 6.604, y: 1.069, w: TABLE_W, rtl: true, rowH: 0.456,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev([LABEL_COLW, ...monthColW, TOTAL_COLW]),
    rows: [header, rowOrders, rowResults, rowRejected, rowIncomplete, rowCompletion],
  };

  const monthlyChart = {
    t: 'chart', kind: 'colClustered', x: 0.5, y: 1.07, w: 6.0, h: 3.4,
    categories: monthLabels,
    series: [
      { name: 'الطلبات', values: mo.map((x) => x.orders), color: CHART_BLUE },
      { name: 'النتائج المستلمة', values: mo.map((x) => x.results), color: C.greenBright },
      { name: 'النتائج غير المكتملة', values: mo.map((x) => x.incomplete), color: CHART_GRAY },
    ],
    opts: { dataLabels: true, legend: 'bottom' },
  };

  const t = m.kpi.turnaround;
  // Key both series by month over the SAME derived month list as the categories,
  // so a month absent from perMonth becomes a null gap in place (rather than
  // shifting the later months' points left and misaligning the line).
  const turnaroundChart = {
    t: 'chart', kind: 'line', x: 4.139, y: 4.583, w: 9.139, h: 2.389,
    categories: monthLabels,
    series: [
      { name: 'الفعلي', values: monthKeys.map((k) => t.perMonth.find((p) => p.month === k)?.actual ?? null), color: C.navyChart, marker: 'circle' },
      { name: 'المتوقع', values: monthKeys.map((k) => t.perMonth.find((p) => p.month === k)?.expected ?? null), color: C.orangeSeries, dash: true, marker: 'diamond' },
    ],
    opts: { legend: 'bottom', title: 'الأيام', valMin: 0 },
  };

  const els = [
    ...chrome('الطلبات والنتائج الشهرية', 2),
    table,
    monthlyChart,
    turnaroundChart,
    rect(0.5, 4.583, 3.417, 2.389, C.navyChart, { radius: 0.1 }),
    text(0.5, 4.78, 3.417, 0.5, 'المتوسط العام لزمن الإنجاز', 13, { bold: true, color: CARD_TITLE, align: 'center', valign: 'middle', rtl: true }),
    text(0.5, 5.4, 3.417, 0.7, `الفعلي: ${t.overallActual.toFixed(1)} يوم`, 24, { bold: true, color: C.white, align: 'center', valign: 'middle', rtl: true }),
    text(0.5, 6.2, 3.417, 0.7, `المتوقع: ${t.overallExpected.toFixed(1)} يوم`, 24, { bold: true, color: C.peach, align: 'center', valign: 'middle', rtl: true }),
  ];
  return { id: 'monthly', bg: C.white, elements: els };
}

// ============================================================================
// Slide 4 — Compliance measure / late orders
// ============================================================================
function buildCompliance(m) {
  const lab = m.kpi.byLab;
  // logical (deck rtl) order per row: [#, lab, total, awaitingResult, rejected, late, late%];
  // reverse -> visual. 'مرفوضة' sits between 'مستلمة بانتظار نتيجة' and 'المتأخرة'.
  const rejTot = lab.reduce((s, r) => s + (r.rejected || 0), 0);
  const header = rev(['#', 'المختبر', 'مجموع الطلبات', 'طلبات مستلمة بانتظار نتيجة', 'مرفوضة', 'الطلبات المتأخرة', 'نسبة الطلبات المتأخرة']);
  const labRows = lab.map((r, i) => rev([
    String(i + 1),
    { text: r.lab, align: 'right' },
    String(r.total),
    String(r.awaitingResult),
    String(r.rejected || 0),
    String(r.late),
    pctLab(r.latePct),
  ]));
  const totalRow = rev([
    { text: '', fill: C.bgLighter },
    { text: 'المجموع', bold: true, fill: C.bgLighter, align: 'right' },
    { text: '618', bold: true, fill: C.bgLighter },
    { text: '159', bold: true, fill: C.bgLighter },
    { text: String(rejTot), bold: true, fill: C.bgLighter },
    { text: '67', bold: true, fill: C.bgLighter },
    { text: '42.1%', bold: true, fill: C.bgLighter },
  ]);

  // colW: shaved the wide lab-name column 3.264 -> 2.714 to fund a 0.55in 'مرفوضة'
  // column; total width stays 11.667 (0.556+2.714+1.667+2.083+0.55+1.944+2.153).
  const labTable = {
    t: 'table', x: 0.833, y: 1.194, w: 11.667, rtl: true, rowH: 0.275,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev([0.556, 2.714, 1.667, 2.083, 0.55, 1.944, 2.153]),
    rows: [header, ...labRows, totalRow],
  };

  const lateChart = {
    t: 'chart', kind: 'barH', x: 0.806, y: 4.5, w: 11.694, h: 2.64,
    categories: m.kpi.byTest.map((x) => m.displayNames[x.testName] || x.testName),
    series: [{ name: 'الطلبات المتأخرة', values: m.kpi.byTest.map((x) => x.late), color: C.navyBar }],
    opts: { dataLabels: true, legend: 'none' },
  };

  const els = [
    ...chrome('مقياس الالتزام', 3),
    labTable,
    rect(0.6, 4.12, 12.3, 0.012, C.border),
    text(0.6, 4.16, 12.3, 0.4, 'تفاصيل الطلبات المتأخرة', 14, { bold: true, color: C.navy, align: 'center', valign: 'middle', rtl: true }),
    lateChart,
  ];
  return { id: 'compliance', bg: C.white, elements: els };
}

// ============================================================================
// Slide 5 — Tasks + challenges + risks (variant changes the task ROWS)
// ============================================================================
const STATUS_FILL = { 'مستمر': { fill: C.taskNavy, color: C.white }, 'متأخر': { fill: C.redDark, color: C.white }, 'قيد التنفيذ': { fill: C.amberStatus, color: C.black }, 'مغلق': { fill: C.green, color: C.white }, 'مفتوح': { fill: C.slate500, color: C.white } };

// Full-width tasks table. '#' is renumbered by row index (i+1) — internal rows do
// NOT keep their own tk.num (which restarts at 1). rowH/fonts are parametrized.
function taskTable(tasks, { y, rowH, bodySize, headerSize }) {
  // rtl=0 in deck: visual == authored order [الحالة, تاريخ, المالك, المسؤول, الإجراء, #]
  const header = ['الحالة', 'تاريخ الإكتمال', 'المالك', 'المسؤول', 'الإجراء', '#'];
  const rows = tasks.map((tk, i) => {
    const st = STATUS_FILL[tk.status] || { fill: C.slate500, color: C.white };
    return [
      { text: tk.status, fill: st.fill, color: st.color, bold: true },
      String(tk.dueDate),
      { text: tk.owner, align: 'right' },
      tk.responsible,
      { text: tk.task, align: 'right' },
      String(i + 1),
    ];
  });
  return {
    t: 'table', x: 0.641, y, w: 12.259, rtl: true, rowH, bodySize, headerSize,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: [1.138, 1.471, 1.95, 1.47, 5.893, 0.337],
    rows: [header, ...rows],
  };
}

function tasksSubhead(title, y = 1.217) {
  return [
    rect(12.45, y + 0.02, 0.3, 0.3, C.navy, { radius: 0.15 }),
    text(12.45, y + 0.02, 0.3, 0.3, '⚡', 14, { bold: true, color: C.white, align: 'center', valign: 'middle' }),
    text(0.6, y, 11.8, 0.4, title, 14, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
  ];
}

// Challenges/risks share a fixed slot: header + up to 3 body rows at rowH 0.28 from
// y=5.88 -> bottom 7.00, clear of the footer border at 7.10. Beyond 3 rows we keep
// 2 data rows and spend the 3rd slot on a '+ N أخرى' note (a separate italic text
// element — grammar cells can't be italic/spanned), so the block bottom stays 7.00.
const CR_CAP = 3;
const CR_TABLE_Y = 5.88, CR_ROW_H = 0.28;
const capCrRows = (rows) => (rows.length <= CR_CAP
  ? { rows, hidden: 0 }
  : { rows: rows.slice(0, CR_CAP - 1), hidden: rows.length - (CR_CAP - 1) });
const crNote = (x, hidden) => text(
  x, CR_TABLE_Y + CR_CAP * CR_ROW_H, 6.0, CR_ROW_H, `+ ${hidden} أخرى`, 8.5,
  { italic: true, color: C.slate600, align: 'center', valign: 'middle', rtl: true },
);

function buildAction(m, variant) {
  // Block 1 — tasks table. nupco = current only; internal appends the internal rows.
  // Internal report = لين-category actions only; NUPCO = the remaining actions.
  const taskRows = variant === 'nupco' ? m.tasksCurrent : m.tasksInternal;
  const n = taskRows.length;
  const CAP = 15;
  const shown = Math.min(n, CAP);
  const hasNote = n > CAP;
  // Reserve the overflow note's slot (0.26") out of AREA up front, so the table rows
  // shrink to fit and the note lands ABOVE the support band (starts 4.62). Without
  // this the fixed-height table pushed the note to y=4.50 (bottom 4.74), overlapping
  // the band. With it, noteY + 0.24 ≤ 4.60. AREA is untouched when there is no note,
  // so the n≤15 layout is unchanged.
  const AREA = hasNote ? 3.35 - 0.26 : 3.35;
  const rowH = Math.max(0.18, Math.min(0.30, AREA / (shown + 1)));
  const bodySize = rowH >= 0.26 ? 9.5 : rowH >= 0.21 ? 9 : 8;
  const headerSize = bodySize;
  const table = taskTable(taskRows.slice(0, shown), { y: 1.15, rowH, bodySize, headerSize });

  const els = [
    ...chrome('المهام والتحديات والمخاطر', 4),
    ...tasksSubhead('المهام الحالية', 0.84),
    table,
  ];
  if (hasNote) {
    const noteY = 1.15 + (shown + 1) * rowH;
    els.push(text(0.641, noteY, 12.259, 0.24, `+ ${n - CAP} مهمة أخرى`, bodySize, { italic: true, color: C.slate600, align: 'center', valign: 'middle', rtl: true }));
  }

  // Block 2 — support required (full width red band). Band height holds up to 3
  // right-aligned single-line bullets (Arabic ink overflows a tight box), while its
  // bottom (5.54) stays clear of the subhead dots that end exactly at the table top.
  els.push(
    rect(0.5, 4.62, 12.3, 0.92, C.bgRed, { radius: 0.06 }),
    text(0.7, 4.66, 11.9, 0.34, 'الدعم المطلوب:', 14, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
    text(0.9, 5.02, 11.7, 0.50, bullets(m.panels.supportRequired), 10.5, { color: C.slate900, align: 'right', valign: 'top', rtl: true, lineSpacing: 1.0 }),
  );

  // Blocks 3 & 4 — challenges (right) + risks (left), side-by-side, subheads at y 5.60.
  const chHeader = ['الإجراء الوقائي/الحل', 'التأثير', 'المسؤول', 'المشكلة', '#'];
  const chRows = m.challenges.map((c, i) => [
    { text: c.solution, align: 'right' },
    c.impact,
    { text: c.owner, align: 'center' },
    { text: c.desc, align: 'right' },
    String(i + 1),
  ]);
  const chCap = capCrRows(chRows);
  const chTable = {
    t: 'table', x: 6.80, y: CR_TABLE_Y, w: 6.0, rtl: true, rowH: CR_ROW_H, bodySize: 8.5, headerSize: 9,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: [1.832, 0.406, 1.245, 2.281, 0.235],
    rows: [chHeader, ...chCap.rows],
  };

  const rkHeader = ['التأثير', 'إحتمالية', 'المسؤول', 'الخطر', '#'];
  const rkRows = m.risks.map((r, i) => [
    r.impact,
    r.probability,
    { text: r.owner, align: 'center' },
    { text: r.desc, align: 'right' },
    String(i + 1),
  ]);
  const rkCap = capCrRows(rkRows);
  const rkTable = {
    t: 'table', x: 0.5, y: CR_TABLE_Y, w: 6.0, rtl: true, rowH: CR_ROW_H, bodySize: 8.5, headerSize: 9,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: [0.683, 0.580, 1.127, 3.415, 0.195],
    rows: [rkHeader, ...rkCap.rows],
  };

  els.push(
    // challenges subhead (right half): red dot + '!' + 'تحديات'
    rect(12.35, 5.58, 0.3, 0.3, C.red, { radius: 0.15 }),
    text(12.35, 5.58, 0.3, 0.3, '!', 16, { bold: true, color: C.white, align: 'center', valign: 'middle' }),
    text(6.80, 5.60, 5.50, 0.24, 'تحديات', 14, { bold: true, color: C.red, align: 'right', valign: 'middle', rtl: true }),
    chTable,
    // risks subhead (left half): navy dot + '⚡' + 'المخاطر'
    rect(6.15, 5.58, 0.3, 0.3, C.navy, { radius: 0.15 }),
    text(6.15, 5.58, 0.3, 0.3, '⚡', 14, { bold: true, color: C.white, align: 'center', valign: 'middle' }),
    text(0.5, 5.60, 5.60, 0.24, 'المخاطر', 14, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
    rkTable,
  );
  // Overflow notes occupy the 3rd body-row slot (bottom 7.00, ≤ 7.05).
  if (chCap.hidden > 0) els.push(crNote(6.80, chCap.hidden));
  if (rkCap.hidden > 0) els.push(crNote(0.5, rkCap.hidden));

  return { id: 'action', bg: C.white, elements: els };
}

// ============================================================================
// Slide 6 — Thanks
// ============================================================================
function buildThanks() {
  return {
    id: 'thanks', bg: C.navy, elements: [
      rect(0, 0, 0.15, 7.5, C.purple),
      rect(13.15, 0, 0.15, 7.5, C.orange),
      text(8.7, 0.5, 4.0, 0.5, 'NUPCO  |  Lean', 18, { bold: true, color: C.white, align: 'right', valign: 'middle' }),
      text(0.895, 3.1, 11.9, 1.3, 'شكرا لكم', 60, { bold: true, color: C.white, align: 'center', valign: 'middle', rtl: true }),
    ],
  };
}

/**
 * @param {import('../contracts.js').ReportModel} reportModel
 * @param {{variant?:('internal'|'nupco')}} [opts]
 * @returns {import('../contracts.js').SlideSpec}
 */
export function buildSpec(reportModel, { variant = 'internal' } = {}) {
  return [
    buildCover(reportModel),
    buildExecFunnel(reportModel),
    buildMonthly(reportModel),
    buildCompliance(reportModel),
    buildAction(reportModel, variant),
    buildThanks(),
  ];
}

export default buildSpec;
