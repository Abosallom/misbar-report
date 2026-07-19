// src/slidespec/build-spec.js
// buildSpec(reportModel) -> SlideSpec (see src/contracts.js).
// One builder per slide. ALL geometry is in inches, derived by converting EMU->inches
// (÷914400) from the original deck OOXML (تقرير مسبار 09072026.pptx, slides 1-9 + 12).
// Deck order kept: cover, summary, journey, monthly, compliance, scorecard, tasks,
// tasksInternal(internalOnly), challenges, thanks. Slides 10 & 11 are hidden -> skipped.
import { COLORS as C, GEOM } from '../theme.js';

// Colors present in the deck charts/cards but not in theme.js:
const CHART_BLUE = '#4472C4';   // chart1 series "الطلبات" (accent1)
const CHART_GRAY = '#A5A5A5';   // chart1 series "النتائج غير المكتملة" (accent3)
const CARD_TITLE = '#DCE6F1';   // overall-average card sub-title

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو'];

// ---- tiny element factories -------------------------------------------------
const rect = (x, y, w, h, fill, extra = {}) => ({ t: 'rect', x, y, w, h, fill, ...extra });
const text = (x, y, w, h, t, size, o = {}) => ({ t: 'text', x, y, w, h, text: t, size, ...o });
const rev = (a) => a.slice().reverse();

// ---- formatting -------------------------------------------------------------
const fmtDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d} / ${m} / ${y}`; };
const pctLab = (n) => (n === 0 ? '0%' : n.toFixed(1) + '%');           // slide 5 late-%
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
// Slide 2 — Executive summary / KPIs
// ============================================================================
function kpiCard({ x, v, vc, lab, sub, ac, delta }) {
  const y = 0.93, w = 1.903, h = 1.6;
  const els = [
    rect(x, y, w, h, C.white, { radius: 0.05, line: { color: C.border, w: 0.75 } }),
    rect(x + w - 0.063, y, 0.063, h, ac),
    text(x + 0.08, y + 0.13, w - 0.24, 0.72, v, 40, { bold: true, color: vc, align: 'right', valign: 'middle' }),
    text(x + 0.08, y + 0.9, w - 0.16, 0.42, lab, 11.5, { bold: true, color: C.slate900, align: 'right', valign: 'top', rtl: true }),
  ];
  if (sub) els.push(text(x + 0.08, y + 1.28, w - 0.16, 0.28, sub, 9.5, { color: C.slate500, align: 'right', valign: 'top', rtl: true }));
  if (delta) els.push(text(x + 0.1, y + 0.3, 0.9, 0.42, delta, 20, { bold: true, color: C.deltaGreen, align: 'left', valign: 'middle' }));
  return els;
}

function buildSummary(m) {
  const b = m.kpi.buckets;
  const cards = [
    { x: 10.917, v: String(m.kpi.totals.total), vc: C.blue, lab: 'إجمالي الطلبات', sub: 'يناير – يوليو', ac: C.blue },
    { x: 8.833, v: String(b.awaitingDispatch), vc: C.greenSoft, lab: 'في انتظار شحن العينة (المستشفى)', sub: 'قبل الـ Dispatch', ac: C.greenSoft },
    { x: 6.75, v: String(b.shippedNotReceived), vc: C.redSoft, lab: 'شُحنت ولم تُستلم', sub: '', ac: C.redSoft },
    { x: 4.667, v: String(b.awaitingResults), vc: C.amber, lab: 'في انتظار نتائج العينة (المختبر)', sub: 'بعد الـ Dispatch', ac: C.amber },
    { x: 2.583, v: String(b.completed), vc: C.green, lab: 'نتائج مكتملة', sub: '', ac: C.green, delta: '+' + m.kpi.deltas.completed },
    { x: 0.5, v: String(b.lateNoResult), vc: C.redPure, lab: 'الطلبات المتأخرة', sub: `تمثل ${b.latePct}% من الطلبات`, ac: C.redPure },
  ];
  const els = [
    ...chrome('الملخص التنفيذي  •  المؤشرات الرئيسية', 1),
    ...cards.flatMap(kpiCard),
    text(10.542, 2.687, 2.271, 0.361, `* ${m.kpi.cancelledNote} طلب ملغي`, 12, { bold: true, color: C.slate600, align: 'right', valign: 'middle', rtl: true }),
    // Completed-tasks panel (right)
    rect(6.667, 3.243, 6.133, 2.156, C.bgLight, { radius: 0.06 }),
    text(6.961, 3.343, 5.639, 0.45, 'المهام المنجزة', 14, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
    text(7.095, 3.85, 5.505, 1.45, bullets(m.panels.completedTasks), 12, { color: C.slate900, align: 'right', valign: 'top', rtl: true, lineSpacing: 1.25 }),
    // Planned-tasks panel (left)
    rect(0.4, 3.243, 6.133, 2.156, C.bgLight, { radius: 0.06 }),
    text(1.085, 3.349, 5.265, 0.526, 'المهام المخطط له:', 14, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
    text(0.828, 3.85, 5.505, 1.45, bullets(m.panels.plannedTasks), 12, { color: C.slate900, align: 'right', valign: 'top', rtl: true, lineSpacing: 1.25 }),
    // Support-required panel (red)
    rect(0.5, 5.662, 12.3, 1.5, C.bgRed, { radius: 0.06 }),
    text(0.7, 5.762, 11.9, 0.4, 'الدعم المطلوب:', 14, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
    text(0.9, 6.16, 11.7, 0.9, bullets(m.panels.supportRequired), 13, { color: C.slate900, align: 'right', valign: 'top', rtl: true, lineSpacing: 1.2 }),
  ];
  return { id: 'summary', bg: C.white, elements: els };
}

// ============================================================================
// Slide 3 — Order journey (funnel)
// ============================================================================
function buildJourney(m) {
  const f = m.kpi.funnel;
  const maxV = f.created;
  const rows = [
    { stage: '1. إنشاء طلب', val: f.created, desc: 'الطلب أُنشئ في مسبار', color: C.navy },
    { stage: '2. سحب العينة', val: f.collected, desc: 'العينة مُجمَّعة في KAMC', color: C.blue },
    { stage: '3. شحن العينة', val: f.dispatched, desc: 'العينة شُحنت من قبل المستشفى', color: C.amber },
    { stage: '4. إستلام العينة', val: f.received, desc: 'حالة إستلام العينة بقبولها او رفضها', color: C.greenSoft },
    { stage: '5. إصدار نتيجة', val: f.resulted, desc: 'نتيجة تحليل العينة', color: C.greenBright, delta: '+' + m.kpi.deltas.completed },
  ];
  const rowY = [2.826, 3.476, 4.126, 4.776, 5.462];
  const accentY = [2.876, 3.526, 4.176, 4.826, 5.512];
  const barY = [2.897, 3.547, 4.197, 4.847, 5.532];
  const trackX = 3.92, trackW = 5.0, barH = 0.3;

  const els = [
    ...chrome('رحلة طلب مسبار', 2),
    text(9.7, 1.186, 3.0, 0.35, 'دورة الطلب تمر بـ 5 مراحل الموضحة أدناه:', 11, { color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
    // Cancelled card (top-left)
    rect(0.0, 0.784, 2.242, 1.08, C.white, { radius: 0.04, line: { color: C.border, w: 0.75 } }),
    rect(2.179, 0.784, 0.063, 1.06, C.black),
    text(0.065, 0.95, 1.927, 0.7, String(m.kpi.cancelledNote), 40, { bold: true, color: C.black, align: 'right', valign: 'middle' }),
    text(0.065, 1.5, 1.927, 0.35, 'الطلبات الملغية', 13, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
    // Column labels
    text(9.05, 2.506, 3.0, 0.3, 'المرحلة', 10, { bold: true, color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
    text(8.629, 2.499, 1.0, 0.3, 'العدد', 10, { bold: true, color: C.slate500, align: 'center', valign: 'middle', rtl: true }),
    text(-0.25, 2.506, 3.2, 0.3, 'الوصف', 10, { bold: true, color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
    // Brackets
    rect(12.03, 3.101, 0.02, 1.3, C.slate600),
    text(12.35, 3.424, 0.9, 0.55, 'المستشفى', 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
    rect(12.03, 5.051, 0.02, 0.685, C.slate600),
    text(12.25, 5.096, 0.95, 0.55, 'المختبرات', 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
  ];
  rows.forEach((r, i) => {
    const fillW = Math.round((r.val / maxV) * trackW * 1000) / 1000;
    els.push(
      rect(11.97, accentY[i], 0.06, 0.45, r.color),
      text(9.05, rowY[i], 2.85, 0.55, r.stage, 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
      text(8.629, rowY[i], 1.0, 0.55, String(r.val), 14, { bold: true, color: r.color, align: 'center', valign: 'middle' }),
      text(-0.25, rowY[i], 3.2, 0.55, r.desc, 10, { color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
      rect(trackX, barY[i], trackW, barH, C.bgLighter, { radius: 0.03 }),
      rect(trackX + trackW - fillW, barY[i], fillW, barH, r.color, { radius: 0.03 }),
    );
    if (r.delta) els.push(text(7.75, rowY[i], 0.75, 0.55, r.delta, 10, { bold: true, color: C.deltaGreen, align: 'center', valign: 'middle' }));
  });
  return { id: 'journey', bg: C.white, elements: els };
}

// ============================================================================
// Slide 4 — Monthly orders & results
// ============================================================================
function buildMonthly(m) {
  const mo = m.kpi.monthly;
  const oTot = 618, rTot = 437, iTot = 181, cTot = '70.7%';
  const bg = C.bgLight;
  // logical (deck) order: [label, jan..jul, total]; reverse -> visual L->R
  const header = rev(['المؤشر', ...AR_MONTHS, { text: 'الإجمالي', fill: C.navyDark }]);
  const rowOrders = rev([{ text: 'الطلبات', align: 'right' }, ...mo.map((x) => String(x.orders)), { text: String(oTot), fill: bg, bold: true }]);
  const rowResults = rev([{ text: 'النتائج المستلمة', align: 'right' }, ...mo.map((x) => String(x.results)), { text: String(rTot), fill: bg, bold: true }]);
  const rowIncomplete = rev([{ text: 'النتائج غير المكتملة', align: 'right' }, ...mo.map((x) => String(x.incomplete)), { text: String(iTot), fill: bg, bold: true }]);
  const rowCompletion = rev([{ text: 'نسبة الاكتمال', align: 'right' }, ...mo.map((x) => pctMonthly(x.completionPct)), { text: cTot, fill: bg, bold: true }]);

  const table = {
    t: 'table', x: 6.604, y: 1.069, w: 6.661, rtl: true, rowH: 0.456,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev([1.312, 0.623, 0.623, 0.623, 0.561, 0.686, 0.679, 0.679, 0.874]),
    rows: [header, rowOrders, rowResults, rowIncomplete, rowCompletion],
  };

  const monthlyChart = {
    t: 'chart', kind: 'colClustered', x: 0.5, y: 1.07, w: 6.0, h: 3.4,
    categories: AR_MONTHS,
    series: [
      { name: 'الطلبات', values: mo.map((x) => x.orders), color: CHART_BLUE },
      { name: 'النتائج المستلمة', values: mo.map((x) => x.results), color: C.greenBright },
      { name: 'النتائج غير المكتملة', values: mo.map((x) => x.incomplete), color: CHART_GRAY },
    ],
    opts: { dataLabels: true, legend: 'bottom' },
  };

  const t = m.kpi.turnaround;
  const turnaroundChart = {
    t: 'chart', kind: 'line', x: 4.139, y: 4.583, w: 9.139, h: 2.389,
    categories: AR_MONTHS,
    series: [
      { name: 'الفعلي', values: t.perMonth.map((p) => p.actual), color: C.navyChart, marker: 'circle' },
      { name: 'المتوقع', values: t.perMonth.map((p) => p.expected), color: C.orangeSeries, dash: true, marker: 'diamond' },
    ],
    opts: { legend: 'bottom', title: 'الأيام', valMin: 0 },
  };

  const els = [
    ...chrome('الطلبات والنتائج الشهرية', 3),
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
// Slide 5 — Compliance measure / late orders
// ============================================================================
function buildCompliance(m) {
  const lab = m.kpi.byLab;
  // logical (deck rtl) order per row: [#, lab, total, awaitingResult, late, late%]; reverse -> visual
  const header = rev(['#', 'المختبر', 'مجموع الطلبات', 'طلبات مستلمة بانتظار نتيجة', 'الطلبات المتأخرة', 'نسبة الطلبات المتأخرة']);
  const labRows = lab.map((r, i) => rev([
    String(i + 1),
    { text: r.lab, align: 'right' },
    String(r.total),
    String(r.awaitingResult),
    String(r.late),
    pctLab(r.latePct),
  ]));
  const totalRow = rev([
    { text: '', fill: C.bgLighter },
    { text: 'المجموع', bold: true, fill: C.bgLighter, align: 'right' },
    { text: '618', bold: true, fill: C.bgLighter },
    { text: '159', bold: true, fill: C.bgLighter },
    { text: '67', bold: true, fill: C.bgLighter },
    { text: '42.1%', bold: true, fill: C.bgLighter },
  ]);

  const labTable = {
    t: 'table', x: 0.833, y: 1.194, w: 11.667, rtl: true, rowH: 0.275,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev([0.556, 3.264, 1.667, 2.083, 1.944, 2.153]),
    rows: [header, ...labRows, totalRow],
  };

  const lateChart = {
    t: 'chart', kind: 'barH', x: 0.806, y: 4.5, w: 11.694, h: 2.64,
    categories: m.kpi.byTest.map((x) => m.displayNames[x.testName] || x.testName),
    series: [{ name: 'الطلبات المتأخرة', values: m.kpi.byTest.map((x) => x.late), color: C.navyBar }],
    opts: { dataLabels: true, legend: 'none' },
  };

  const els = [
    ...chrome('مقياس الالتزام', 4),
    labTable,
    rect(0.6, 4.12, 12.3, 0.012, C.border),
    text(0.6, 4.16, 12.3, 0.4, 'تفاصيل الطلبات المتأخرة', 14, { bold: true, color: C.navy, align: 'center', valign: 'middle', rtl: true }),
    lateChart,
  ];
  return { id: 'compliance', bg: C.white, elements: els };
}

// ============================================================================
// Slide 6 — Lab readiness scorecard
// ============================================================================
function buildScorecard(m) {
  const sc = m.scorecard;
  const header = rev([
    '#', 'اسم المختبر', 'نسبة رفع قائمة الفحوصات', 'قائمة الفحوصات المستهدفة',
    'الفحوصات التي تم رفعها', 'الفحوصات التي لم يتم رفعها', 'فحوصات تتطلب التصحيح',
    'إمكانية الطلب من قبل المستشفى', 'الفحوصات المتوفرة للطلب من قبل المستشفى',
  ]);
  const rows = sc.map((r, i) => {
    const nameFill = r.canOrder ? C.greenBright : C.redPure;
    return rev([
      String(i + 1),
      { text: r.lab, fill: nameFill, color: C.white, align: 'right' },
      { text: r.pct, fill: nameFill, color: C.white },
      String(r.target),
      String(r.uploaded),
      String(r.notUploaded),
      String(r.needFix),
      { text: r.canOrder ? '✔' : 'Χ', color: r.canOrder ? C.greenBright : C.redPure, bold: true },
      String(r.available),
    ]);
  });
  const targetTot = sc.reduce((a, r) => a + r.target, 0);
  const uploadedTot = sc.reduce((a, r) => a + r.uploaded, 0);
  const availTot = sc.reduce((a, r) => a + r.available, 0);
  const canCount = sc.filter((r) => r.canOrder).length;
  const nH = { fill: C.navy, color: C.white, bold: true };
  const totalRow = rev([
    { text: '', ...nH },
    { text: 'اجمالي', ...nH, align: 'right' },
    { text: '', ...nH },
    { text: String(targetTot), bold: true },
    { text: String(uploadedTot), bold: true },
    { text: '0', bold: true },
    { text: '0', bold: true },
    { text: `${canCount} من ${sc.length}`, bold: true },
    { text: String(availTot), bold: true },
  ]);

  const table = {
    t: 'table', x: 0.41, y: 1.109, w: 12.577, rtl: true, rowH: 0.382, headerSize: 9, bodySize: 9.5,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev([0.367, 2.189, 1.312, 1.312, 1.312, 1.312, 1.312, 1.483, 1.977]),
    rows: [header, ...rows, totalRow],
  };
  return { id: 'scorecard', bg: C.white, elements: [...chrome('بطاقة جاهزية المختبرات', 5), table] };
}

// ============================================================================
// Slides 7 & 8 — Task tables (external / internal)
// ============================================================================
const STATUS_FILL = { 'مستمر': { fill: C.taskNavy, color: C.white }, 'متأخر': { fill: C.redDark, color: C.white }, 'قيد التنفيذ': { fill: C.amberStatus, color: C.black }, 'مغلق': { fill: C.green, color: C.white }, 'مفتوح': { fill: C.slate500, color: C.white } };

function taskTable(tasks, y, rowH) {
  // rtl=0 in deck: visual == authored order [الحالة, تاريخ, المالك, المسؤول, الإجراء, #]
  const header = ['الحالة', 'تاريخ الإكتمال', 'المالك', 'المسؤول', 'الإجراء', '#'];
  const rows = tasks.map((tk) => {
    const st = STATUS_FILL[tk.status] || { fill: C.slate500, color: C.white };
    return [
      { text: tk.status, fill: st.fill, color: st.color, bold: true },
      String(tk.dueDate),
      { text: tk.owner, align: 'right' },
      tk.responsible,
      { text: tk.task, align: 'right' },
      String(tk.num),
    ];
  });
  return {
    t: 'table', x: 0.641, y, w: 12.259, rtl: true, rowH,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: [1.138, 1.471, 1.95, 1.47, 5.893, 0.337],
    rows: [header, ...rows],
  };
}

function tasksSubhead(title) {
  return [
    rect(12.45, 1.237, 0.3, 0.3, C.navy, { radius: 0.15 }),
    text(12.45, 1.237, 0.3, 0.3, '⚡', 14, { bold: true, color: C.white, align: 'center', valign: 'middle' }),
    text(0.6, 1.217, 11.8, 0.4, title, 14, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
  ];
}

function buildTasks(m) {
  return { id: 'tasks', bg: C.white, elements: [...chrome('المهام', 6), ...tasksSubhead('المهام الحالية'), taskTable(m.tasksCurrent, 1.667, 0.589)] };
}
function buildTasksInternal(m) {
  return { id: 'tasksInternal', bg: C.white, internalOnly: true, elements: [...chrome('المهام (داخلي)', 6), ...tasksSubhead('المهام الحالية'), taskTable(m.tasksInternal, 1.667, 0.55)] };
}

// ============================================================================
// Slide 9 — Challenges & risks
// ============================================================================
function buildChallenges(m) {
  // rtl=0 tables: authored visual order.
  const chHeader = ['الإجراء الوقائي/الحل', 'التأثير', 'المسؤول', 'المشكلة', '#'];
  const chRows = m.challenges.map((c, i) => [
    { text: c.solution, align: 'right' },
    c.impact,
    { text: c.owner, align: 'center' },
    { text: c.desc, align: 'right' },
    String(i + 1),
  ]);
  const chTable = {
    t: 'table', x: 0.5, y: 1.46, w: 12.3, rtl: true, rowH: 0.5,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: [3.756, 0.833, 2.553, 4.676, 0.482],
    rows: [chHeader, ...chRows],
  };
  const rkHeader = ['التأثير', 'إحتمالية', 'المسؤول', 'الخطر', '#'];
  const rkRows = m.risks.map((r, i) => [
    r.impact,
    r.probability,
    { text: r.owner, align: 'center' },
    { text: r.desc, align: 'right' },
    String(i + 1),
  ]);
  const rkTable = {
    t: 'table', x: 0.5, y: 4.5, w: 12.3, rtl: true, rowH: 0.4,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: [1.4, 1.189, 2.311, 7.0, 0.4],
    rows: [rkHeader, ...rkRows],
  };
  const els = [
    ...chrome('التحديات والمخاطر', 7),
    rect(12.35, 0.97, 0.3, 0.3, C.red, { radius: 0.15 }),
    text(12.35, 0.97, 0.3, 0.3, '!', 16, { bold: true, color: C.white, align: 'center', valign: 'middle' }),
    text(0.5, 0.95, 11.8, 0.4, 'تحديات', 14, { bold: true, color: C.red, align: 'right', valign: 'middle', rtl: true }),
    chTable,
    rect(12.35, 4.07, 0.3, 0.3, C.navy, { radius: 0.15 }),
    text(12.35, 4.07, 0.3, 0.3, '⚡', 14, { bold: true, color: C.white, align: 'center', valign: 'middle' }),
    text(0.5, 4.07, 11.8, 0.4, 'المخاطر', 14, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
    rkTable,
  ];
  return { id: 'challenges', bg: C.white, elements: els };
}

// ============================================================================
// Slide 12 — Thanks
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
 * @returns {import('../contracts.js').SlideSpec}
 */
export function buildSpec(reportModel) {
  return [
    buildCover(reportModel),
    buildSummary(reportModel),
    buildJourney(reportModel),
    buildMonthly(reportModel),
    buildCompliance(reportModel),
    buildScorecard(reportModel),
    buildTasks(reportModel),
    buildTasksInternal(reportModel),
    buildChallenges(reportModel),
    buildThanks(),
  ];
}

export default buildSpec;
