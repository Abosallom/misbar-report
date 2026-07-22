// src/slidespec/build-spec.js
// buildSpec(reportModel, { variant }) -> SlideSpec (see src/contracts.js).
// One builder per slide. ALL geometry is in inches, derived by converting EMU->inches
// (÷914400) from the original deck OOXML (تقرير مسبار 09072026.pptx).
// SEVEN-slide deck (both variants): cover · execFunnel · monthly · compliance · action · definitions · thanks.
// The variant no longer changes slide PRESENCE — it changes slide-5 (action) task ROWS:
// nupco shows tasksCurrent (non-لين actions); internal shows tasksInternal ONLY (لين-category
// actions — user decision 2026-07-19). No slide is internalOnly.
//
// PRESENTATION OPTIONS (all read from the model, safe defaults when absent):
//   m.reportOptions.labels[key]   overrides DEFAULT_LABELS static text (byte-stable when absent)
//   m.reportOptions.slides[key]   toggles the 5 middle slides (cover/thanks always render)
//   m.reportOptions.kpiCards[key] toggles the 7 exec KPI cards (row geometry repacks)
//   m.overrides[key]              per-run manual NUMBER overrides (suppresses that delta chip)
import { COLORS as C, GEOM } from '../theme.js';

// ============================================================================
// LABELS REGISTRY — user-facing STATIC strings. DEFAULT_LABELS holds the built-in
// Arabic text (identical to the historic hardcodes, so the default render is
// byte-stable); LABEL_NAMES holds a short Arabic description per key for the
// labels-editor UI. Runtime lookup: L(key) = m.reportOptions.labels[key] ?? default.
// ============================================================================
export const DEFAULT_LABELS = {
  // Slide titles (top-bar section headers)
  titleExec: 'الملخص التنفيذي  •  رحلة الطلب',
  titleMonthly: 'الطلبات والنتائج الشهرية',
  titleCompliance: 'مقياس الالتزام',
  titleAction: 'المهام والتحديات والمخاطر',
  // Cover + thanks
  coverTitle: 'تقرير مسبار اليومي',
  coverSubtitle: 'متابعة تقدم الطلبات وقياس جاهزية المختبرات',
  coverPreparedBy: 'إعداد: لين لخدمات الأعمال',
  thanks: 'شكرا لكم',
  // Exec KPI card labels (keys mirror the deltas/overrides keys)
  kpiTotal: 'إجمالي الطلبات',
  kpiAwaitingDispatch: 'بانتظار الشحن (المستشفى)',
  kpiAwaitingResults: 'بانتظار النتائج (المختبر)',
  kpiCompleted: 'نتائج مكتملة',
  kpiRejected: 'النتائج المرفوضة',
  kpiLate: 'الطلبات المتأخرة',
  kpiShipped: 'شُحنت ولم تُستلم',
  // Exec slide — overall completion-rate line (label part; value appended as ': N%')
  execCompletionRate: 'نسبة الاكتمال الإجمالية',
  // Exec slide — delta-chip legend (rendered only when a green "+N" chip is visible)
  execDeltaLegend: '▲ التغيّر منذ التقرير السابق — أخضر: إيجابي، أحمر: يستدعي الانتباه',
  // Monthly table row labels (also reused as the monthly bar-chart series names).
  // monthlyRowIncomplete now surfaces the engine's `pending` partition value
  // (orders = results + rejected + pending), renamed accordingly.
  monthlyRowOrders: 'الطلبات',
  monthlyRowResults: 'النتائج المستلمة',
  monthlyRowRejected: 'النتائج المرفوضة',
  monthlyRowIncomplete: 'قيد المعالجة (بدون نتيجة)',
  monthlyRowCompletion: 'نسبة الاكتمال',
  // Monthly partition footnote (under the table) — the orders add-up identity.
  monthlyPartition: 'الطلبات = النتائج المستلمة + المرفوضة + قيد المعالجة',
  // Compliance (byLab) table headers. The count columns ADD UP to الإجمالي:
  //   total = pipeline + awaitingResult + onTime + resultedLate + rejected.
  // compLate (منها متأخرة) is a SUBSET of بانتظار النتيجة (overdue, still awaiting a
  // result) — shown for context, NOT part of the add-up. compHash is retained in the
  // registry (labels-editor key) but the '#' column was dropped from the table.
  compHash: '#',
  compLab: 'المختبر',
  compTotal: 'الإجمالي',
  compPipeline: 'قبل الاستلام',
  compAwaiting: 'بانتظار النتيجة',
  compLate: 'منها متأخرة',
  compOnTime: 'ملتزمة',
  compResultedLate: 'صدرت متأخرة',
  compRejected: 'مرفوضة',
  compLatePct: 'نسبة التأخر',
  // Tasks table headers
  taskStatus: 'الحالة',
  taskDue: 'تاريخ الإكتمال',
  taskOwner: 'المالك',
  taskResponsible: 'المسؤول',
  taskAction: 'الإجراء',
  taskHash: '#',
  // Support-required panel title
  supportTitle: 'الدعم المطلوب:',
  // Funnel column headers
  funnelStage: 'المرحلة',
  funnelCount: 'العدد',
  funnelDesc: 'الوصف',
  // Chart series / titles that are static text
  chartActual: 'الفعلي',            // turnaround line — actual series
  chartExpected: 'المتوقع',         // turnaround line — expected series
  chartDaysAxis: 'الأيام',          // turnaround line — value-axis title
  chartLateSeries: 'المتأخرة',       // late-by-test bar series (late count)
  chartOnTimeSeries: 'الملتزمة',      // late-by-test bar series (on-time / success count)
  overallAvgTitle: 'المتوسط العام لزمن الإنجاز', // overall-average card title
  // Exec KPI-row partition footnote (mirrors the compliance equation footnote).
  execPartition: 'الإجمالي = بانتظار الشحن + شُحنت ولم تُستلم + بانتظار النتائج + مكتملة + مرفوضة',
  // Cancelled note — split into parts so the historical-before-April breakdown is
  // registry-driven: '* {N} {execCancelledLabel} ({execCancelledHistPre} {hist} {execCancelledHistPost})'.
  execCancelledLabel: 'طلب ملغي',
  execCancelledHistPre: 'منها',
  execCancelledHistPost: 'قبل أبريل',
  // Compliance by-test catalog footnote (under the late/on-time chart).
  catalogNote: '* وفق قائمة الفحوصات المعتمدة',
  // Definitions slide ('منهجية الأرقام') — title, column headers, and per-row
  // metric + one-line definition. Definitions mirror the engine's documented rules.
  defsTitle: 'منهجية الأرقام',
  defsColMetric: 'المؤشر',
  defsColDef: 'التعريف',
  defMTotal: 'الإجمالي',                         defDTotal: 'سطور الطلبات غير الملغاة',
  defMAwaitDispatch: 'بانتظار الشحن',            defDAwaitDispatch: 'أُنشئ الطلب ولم تُشحن العينة بعد',
  defMShipped: 'شُحنت ولم تُستلم',               defDShipped: 'شُحنت العينة ولم يستلمها المختبر',
  defMAwaitResults: 'بانتظار النتائج',           defDAwaitResults: 'استلمها المختبر وبانتظار النتيجة',
  defMLate: '↳ منها متأخرة',                     defDLate: 'تجاوزت الاستحقاق بلا نتيجة',
  defMCompleted: 'نتائج مكتملة',                 defDCompleted: 'لها تاريخ نتيجة',
  defMRejected: 'المرفوضة',                      defDRejected: 'رفض المختبر نتيجتها',
  defMOnTime: 'ملتزمة',                          defDOnTime: 'صدرت ضمن المدة المعيارية',
  defMResultedLate: 'صدرت متأخرة',               defDResultedLate: 'صدرت النتيجة بعد الاستحقاق',
  defMPipeline: 'قبل الاستلام',                  defDPipeline: 'لم تصل المختبر بعد',
  defMPending: 'قيد المعالجة',                   defDPending: 'بلا نتيجة ولا رفض بعد',
  defMLatePct: 'نسبة التأخر',                    defDLatePct: 'المتأخرة ÷ بانتظار النتيجة',
  defMTurnaround: 'معدل الدوران الفعلي/المتوقع',  defDTurnaround: 'متوسط أيام؛ ن = عدد الطلبات المقاسة',
  defMCancelled: 'الملغاة',                      defDCancelled: 'من الملف + سجل تاريخي قبل أبريل',
};

export const LABEL_NAMES = {
  titleExec: 'عنوان شريحة الملخص التنفيذي',
  titleMonthly: 'عنوان شريحة الطلبات الشهرية',
  titleCompliance: 'عنوان شريحة مقياس الالتزام',
  titleAction: 'عنوان شريحة المهام والتحديات',
  coverTitle: 'عنوان الغلاف',
  coverSubtitle: 'العنوان الفرعي للغلاف',
  coverPreparedBy: 'سطر جهة الإعداد في الغلاف',
  thanks: 'نص شريحة الشكر',
  kpiTotal: 'بطاقة: إجمالي الطلبات',
  kpiAwaitingDispatch: 'بطاقة: في انتظار شحن العينة',
  kpiAwaitingResults: 'بطاقة: في انتظار النتائج',
  kpiCompleted: 'بطاقة: نتائج مكتملة',
  kpiRejected: 'بطاقة: النتائج المرفوضة',
  kpiLate: 'بطاقة: الطلبات المتأخرة',
  kpiShipped: 'بطاقة: شُحنت ولم تُستلم',
  execCompletionRate: 'سطر نسبة الاكتمال الإجمالية (الملخص التنفيذي)',
  execDeltaLegend: 'مفتاح رمز التغيّر الأخضر (الملخص التنفيذي)',
  monthlyRowOrders: 'صف الجدول الشهري: الطلبات',
  monthlyRowResults: 'صف الجدول الشهري: النتائج المستلمة',
  monthlyRowRejected: 'صف الجدول الشهري: النتائج المرفوضة',
  monthlyRowIncomplete: 'صف الجدول الشهري: النتائج غير المكتملة',
  monthlyRowCompletion: 'صف الجدول الشهري: نسبة الاكتمال',
  compHash: 'عمود الالتزام: الرقم',
  compLab: 'عمود الالتزام: المختبر',
  compTotal: 'عمود الالتزام: الإجمالي',
  compPipeline: 'عمود الالتزام: قبل الاستلام',
  compAwaiting: 'عمود الالتزام: بانتظار النتيجة',
  compLate: 'عمود الالتزام: منها متأخرة (جزء من بانتظار النتيجة)',
  compOnTime: 'عمود الالتزام: الطلبات الملتزمة',
  compResultedLate: 'عمود الالتزام: صدرت متأخرة',
  compRejected: 'عمود الالتزام: مرفوضة',
  compLatePct: 'عمود الالتزام: نسبة التأخر',
  taskStatus: 'عمود المهام: الحالة',
  taskDue: 'عمود المهام: تاريخ الإكتمال',
  taskOwner: 'عمود المهام: المالك',
  taskResponsible: 'عمود المهام: المسؤول',
  taskAction: 'عمود المهام: الإجراء',
  taskHash: 'عمود المهام: الرقم',
  supportTitle: 'عنوان لوحة الدعم المطلوب',
  funnelStage: 'ترويسة القمع: المرحلة',
  funnelCount: 'ترويسة القمع: العدد',
  funnelDesc: 'ترويسة القمع: الوصف',
  chartActual: 'سلسلة زمن الإنجاز: الفعلي',
  chartExpected: 'سلسلة زمن الإنجاز: المتوقع',
  chartDaysAxis: 'عنوان محور الأيام',
  chartLateSeries: 'سلسلة الطلبات المتأخرة',
  chartOnTimeSeries: 'سلسلة الطلبات الملتزمة',
  overallAvgTitle: 'عنوان بطاقة متوسط زمن الإنجاز',
  execPartition: 'حاشية معادلة الإجمالي (الملخص التنفيذي)',
  execCancelledLabel: 'نص ملاحظة الطلبات الملغاة',
  execCancelledHistPre: 'ملاحظة الملغاة: بادئة الجزء التاريخي',
  execCancelledHistPost: 'ملاحظة الملغاة: لاحقة الجزء التاريخي',
  catalogNote: 'حاشية قائمة الفحوصات (مقياس الالتزام)',
  defsTitle: 'عنوان شريحة منهجية الأرقام',
  defsColMetric: 'منهجية الأرقام: ترويسة عمود المؤشر',
  defsColDef: 'منهجية الأرقام: ترويسة عمود التعريف',
  defMTotal: 'منهجية: مؤشر الإجمالي',            defDTotal: 'منهجية: تعريف الإجمالي',
  defMAwaitDispatch: 'منهجية: مؤشر بانتظار الشحن', defDAwaitDispatch: 'منهجية: تعريف بانتظار الشحن',
  defMShipped: 'منهجية: مؤشر شُحنت ولم تُستلم',   defDShipped: 'منهجية: تعريف شُحنت ولم تُستلم',
  defMAwaitResults: 'منهجية: مؤشر بانتظار النتائج', defDAwaitResults: 'منهجية: تعريف بانتظار النتائج',
  defMLate: 'منهجية: مؤشر منها متأخرة',          defDLate: 'منهجية: تعريف منها متأخرة',
  defMCompleted: 'منهجية: مؤشر نتائج مكتملة',     defDCompleted: 'منهجية: تعريف نتائج مكتملة',
  defMRejected: 'منهجية: مؤشر المرفوضة',          defDRejected: 'منهجية: تعريف المرفوضة',
  defMOnTime: 'منهجية: مؤشر ملتزمة',             defDOnTime: 'منهجية: تعريف ملتزمة',
  defMResultedLate: 'منهجية: مؤشر صدرت متأخرة',   defDResultedLate: 'منهجية: تعريف صدرت متأخرة',
  defMPipeline: 'منهجية: مؤشر قبل الاستلام',      defDPipeline: 'منهجية: تعريف قبل الاستلام',
  defMPending: 'منهجية: مؤشر قيد المعالجة',       defDPending: 'منهجية: تعريف قيد المعالجة',
  defMLatePct: 'منهجية: مؤشر نسبة التأخر',        defDLatePct: 'منهجية: تعريف نسبة التأخر',
  defMTurnaround: 'منهجية: مؤشر معدل الدوران',     defDTurnaround: 'منهجية: تعريف معدل الدوران',
  defMCancelled: 'منهجية: مؤشر الملغاة',          defDCancelled: 'منهجية: تعريف الملغاة',
};

// Per-model label lookup: user override wins, else the built-in default.
const labelOf = (m) => (key) => (m.reportOptions?.labels?.[key] ?? DEFAULT_LABELS[key]);
// Per-model value lookup: a finite manual override wins, else the computed number.
const valueOf = (m) => (key, computed) => (Number.isFinite(m.overrides?.[key]) ? m.overrides[key] : computed);

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

// ---- repeated chrome (top bar, section title, corner tags, footer border) ---
// Page numbers are NOT emitted here — buildSpec assigns them AFTER slide filtering
// so they renumber 1..n over the INCLUDED content slides (see pageFooter).
function chrome(title) {
  return [
    rect(0, 0, GEOM.slideW, 0.08, C.navy),
    text(0.5, 0.25, 12.3, 0.55, title, 22, { bold: true, color: C.navy, align: 'center', valign: 'middle', rtl: true }),
    text(10.9, 0.3, 2.0, 0.4, 'NUPCO  |  Lean', 10, { color: C.slate500, align: 'right', valign: 'middle' }),
    text(0.4, 0.3, 3.5, 0.4, 'مسبار  •  مدينة الملك عبدالله الطبية', 10, { color: C.slate500, align: 'left', valign: 'middle', rtl: true }),
    rect(0.5, 7.1, 12.3, 0.012, C.border),
  ];
}

// Sequential page-number footer, appended post-filter (y/size are the historic
// footer coordinates the checkspec locates by).
const pageFooter = (pageNo) => text(0.5, 7.15, 0.8, 0.3, String(pageNo), 9, { color: C.slate500, align: 'left', valign: 'middle' });

// ============================================================================
// Slide 1 — Cover
// ============================================================================
function buildCover(m) {
  const L = labelOf(m);
  return {
    id: 'cover', bg: C.navy, elements: [
      rect(0, 0, 0.15, 7.5, C.purple),
      rect(13.15, 0, 0.15, 7.5, C.orange),
      text(8.7, 0.5, 4.0, 0.5, 'NUPCO  |  Lean', 18, { bold: true, color: C.white, align: 'right', valign: 'middle' }),
      text(0.6, 2.6, 11.9, 1.3, L('coverTitle'), 60, { bold: true, color: C.white, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 4.0, 11.9, 0.6, L('coverSubtitle'), 22, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 5.6, 11.9, 0.5, 'مدينة الملك عبدالله الطبية', 20, { color: C.white, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 6.15, 11.9, 0.4, 'تاريخ التقرير: ' + fmtDate(m.reportDate), 12, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 6.55, 11.9, 0.4, L('coverPreparedBy'), 12, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true }),
    ],
  };
}

// ============================================================================
// Slide 2 — Executive summary + order-journey funnel (merged)
// ============================================================================
// KPI card factory. Width AND number-font are params (the row repacks for N cards).
// Interior REDESIGNED for narrow (7-card) widths where 3-digit live values + long
// labels collided: the number sits in an upper right-aligned band (28pt narrow /
// 40pt wide), the green "+N" delta chip is pinned to the TOP-LEFT corner (13pt, left-
// aligned) so it can never touch the right-aligned number, the label gets a tight
// 3-line band below the number, and the sublabel sits in a bottom band clear of both.
function kpiCard({ x, w, nf = 28, v, vc, lab, sub, ac, delta, deltaColor }) {
  const y = 0.93, h = 1.6;
  // The Cairo Range ink-line is ~1.88x the font px (much taller than the CSS box), so
  // the number's tall glyph line must be reckoned with directly: inkHalf is half that
  // line, in inches. The number is centred just low enough that its ink top clears the
  // delta-legend above the row, and the label/sublabel bands are derived from the ink
  // line so 3-digit live numbers never touch the label below.
  const numH = 0.48;
  const inkHalf = nf * 1.253 / 96;                       // half the number's ink-line (in)
  const numY = inkHalf + 0.016 - numH / 2;              // ink top ≈ 0.016in below the card top
  const labY = Math.min(2 * inkHalf + 0.13, 0.90);      // label clears the number ink-line
  const subY = Math.min(labY + 0.50, 1.29);            // sublabel below the (≤2-line) label
  const els = [
    rect(x, y, w, h, C.white, { radius: 0.05, line: { color: C.border, w: 0.75 } }),
    rect(x + w - 0.063, y, 0.063, h, ac),
    // number — right-aligned (28pt narrow / 30pt wide)
    text(x + 0.08, y + numY, w - 0.22, numH, v, nf, { bold: true, color: vc, align: 'right', valign: 'middle' }),
    // label — up to 2 tight lines below the number ink-line
    text(x + 0.08, y + labY, w - 0.16, subY - labY - 0.02, lab, 10, { bold: true, color: C.slate900, align: 'right', valign: 'top', rtl: true, lineSpacing: 0.95 }),
  ];
  // delta chip — TOP-LEFT corner, left-aligned; horizontally clear of the number
  if (delta) els.push(text(x + 0.06, y + 0.06, 0.55, 0.24, delta, 13, { bold: true, color: deltaColor || C.deltaGreen, align: 'left', valign: 'middle' }));
  // sublabel — bottom band
  if (sub) els.push(text(x + 0.08, y + subY, w - 0.16, h - subY - 0.03, sub, 8, { color: C.slate500, align: 'right', valign: 'top', rtl: true }));
  return els;
}

// The KPI cards own these metrics' delta chips; the funnel must not duplicate them.
const KPI_DELTA_KEYS = new Set(['total', 'awaitingDispatch', 'awaitingResults', 'completed', 'rejected', 'lateNoResult', 'shippedNotReceived']);

// KPI row geometry (canonical 7-card layout): cards between x 0.500 and 12.818
// (span 12.318in), gap 0.140. cardW = (12.318 − (N−1)×0.140)/N, capped at the
// original 1.903in and TRUNCATED to 3 decimals so N=7 reproduces 1.639 exactly.
// The row is right-aligned: the rightmost card's right edge stays at 12.818 and
// cards fill leftward (RTL-natural), so dropping a card never shifts the right edge.
const KPI_SPAN = 12.318, KPI_GAP = 0.140, KPI_CAP_W = 1.903, KPI_RIGHT = 12.818;
function kpiRowGeom(n) {
  const N = Math.max(n, 1);
  let cardW = Math.min((KPI_SPAN - (N - 1) * KPI_GAP) / N, KPI_CAP_W);
  cardW = Math.floor(cardW * 1000) / 1000;          // N=7 => 1.639 (byte-stable)
  const step = cardW + KPI_GAP;
  const xOf = (i) => Math.round((KPI_RIGHT - cardW - i * step) * 1000) / 1000; // i=0 rightmost
  const numFont = cardW >= 1.9 ? 30 : 28;           // N=7 => 28; wider cards a touch larger (30)
  return { cardW, xOf, numFont };
}

function buildExecFunnel(m) {
  const L = labelOf(m);
  const V = valueOf(m);
  const b = m.kpi.buckets;
  const f = m.kpi.funnel;
  const d = m.kpi.deltas || {};
  const isOv = (k) => Number.isFinite(m.overrides?.[k]);

  // Displayed late/awaiting values (overrides win). The late-% sublabel is recomputed
  // from the DISPLAYED numbers when either input was overridden (guard div-by-zero),
  // else the engine's precomputed b.latePct is used verbatim (byte-stable default).
  const vLate = V('lateNoResult', b.lateNoResult);
  const vAwait = V('awaitingResults', b.awaitingResults);
  const latePctShown = (isOv('lateNoResult') || isOv('awaitingResults'))
    ? (vAwait > 0 ? Math.round((vLate / vAwait) * 1000) / 10 : 0)
    : b.latePct;

  // Total-card window: first→last month WITH orders (Arabic names), tracking the data
  // instead of a pinned 'يناير – يوليو'. Empty when no month has orders.
  const monthsWithOrders = (m.kpi.monthly || []).filter((x) => x.orders > 0);
  const dataWindow = monthsWithOrders.length
    ? `${arMonthLabel(monthsWithOrders[0].month)} – ${arMonthLabel(monthsWithOrders[monthsWithOrders.length - 1].month)}`
    : '';

  // Overall completion rate — SAME override-aware total/completed the cards use (guard /0).
  const vTotalCard = V('total', m.kpi.totals.total);
  const vCompletedCard = V('completed', b.completed);
  const completionRate = vTotalCard > 0 ? Math.round((vCompletedCard / vTotalCard) * 1000) / 10 : 0; // 1-decimal — consistent with نسبة الاكتمال elsewhere

  // -- ZONE A: KPI cards in one row, right-to-left (total rightmost). المرفوضة sits
  // between المكتملة and المتأخرة. Card defs in RTL logical order (index 0 = rightmost).
  // dk = the delta/override/kpiCards key. A card renders unless kpiCards[dk] === false;
  // its value is the manual override (if finite) else the computed metric, and its green
  // "+N" chip is suppressed when that value was overridden.
  const cardDefs = [
    { v: V('total', m.kpi.totals.total),                vc: C.blue,      lab: L('kpiTotal'),            sub: dataWindow,                 ac: C.blue,      dk: 'total' },
    { v: V('awaitingDispatch', b.awaitingDispatch),     vc: C.greenSoft, lab: L('kpiAwaitingDispatch'),  sub: 'قبل الـ Dispatch',         ac: C.greenSoft, dk: 'awaitingDispatch' },
    { v: vAwait,                                        vc: C.amber,     lab: L('kpiAwaitingResults'),   sub: 'بعد الـ Dispatch',         ac: C.amber,     dk: 'awaitingResults' },
    { v: V('completed', b.completed),                   vc: C.green,     lab: L('kpiCompleted'),         sub: '',                         ac: C.green,     dk: 'completed' },
    { v: V('rejected', b.rejected),                     vc: C.redSoft,   lab: L('kpiRejected'),          sub: 'نتائج مرفوضة من المختبر',   ac: C.redSoft,   dk: 'rejected' },
    { v: vLate,                                         vc: C.redPure,   lab: L('kpiLate'),              sub: `تمثل ${latePctShown}% من الطلبات بانتظار النتيجة`, ac: C.redPure, dk: 'lateNoResult' },
    { v: V('shippedNotReceived', b.shippedNotReceived), vc: C.redSoft,   lab: L('kpiShipped'),           sub: '',                         ac: C.redSoft,   dk: 'shippedNotReceived' },
  ];
  const visible = cardDefs.filter((c) => m.reportOptions?.kpiCards?.[c.dk] !== false);
  const { cardW, xOf, numFont } = kpiRowGeom(visible.length);
  // Rising is BAD for these metrics — their chips render red so '+38 متأخرة'
  // never reads as good news (analyst sign-off finding).
  const BAD_DELTA = new Set(['rejected', 'lateNoResult', 'shippedNotReceived']);
  const kpiEls = visible.flatMap((c, i) => kpiCard({
    x: xOf(i), w: cardW, nf: numFont, v: String(c.v), vc: c.vc, lab: c.lab, sub: c.sub, ac: c.ac,
    delta: (d[c.dk] > 0 && !isOv(c.dk)) ? '+' + d[c.dk] : undefined,
    deltaColor: BAD_DELTA.has(c.dk) ? C.redPure : C.deltaGreen,
  }));

  // -- ZONE B: order-journey funnel (from old buildJourney; X unchanged, Y +0.40).
  // Each stage value is the manual override (if finite) else the funnel count; the
  // "+N" flow chip is suppressed when that stage value was overridden.
  const created = V('funnel.created', f.created);
  const maxV = created;
  const rows = [
    { stage: '1. إنشاء طلب', val: created,                          desc: 'الطلب أُنشئ في مسبار',              color: C.navy,        key: 'total',     ov: 'funnel.created' },
    { stage: '2. سحب العينة', val: V('funnel.collected', f.collected),  desc: 'العينة مُجمَّعة في KAMC',          color: C.blue,        key: 'collected', ov: 'funnel.collected' },
    { stage: '3. شحن العينة', val: V('funnel.dispatched', f.dispatched), desc: 'العينة شُحنت من قبل المستشفى',      color: C.amber,       key: 'dispatched', ov: 'funnel.dispatched' },
    { stage: '4. إستلام العينة', val: V('funnel.received', f.received),  desc: 'حالة إستلام العينة بقبولها او رفضها', color: C.greenSoft,  key: 'received',  ov: 'funnel.received' },
    { stage: '5. إصدار نتيجة', val: V('funnel.resulted', f.resulted),   desc: 'نتيجة تحليل العينة',               color: C.greenBright, key: 'completed', ov: 'funnel.resulted' },
  ];
  const rowY = [3.226, 3.876, 4.526, 5.176, 5.862];
  const accentY = [3.276, 3.926, 4.576, 5.226, 5.912];
  const barY = [3.297, 3.947, 4.597, 5.247, 5.932];
  const trackX = 3.92, trackW = 5.0, barH = 0.3;

  // A green "+N" chip is shown this run when a visible KPI card OR an intermediate
  // funnel stage has a positive, non-overridden delta. Drives the legend (Fix 3).
  const anyChip = visible.some((c) => d[c.dk] > 0 && !isOv(c.dk))
    || rows.some((r) => d[r.key] > 0 && !KPI_DELTA_KEYS.has(r.key) && !isOv(r.ov));

  // Cancelled note — displayed count is override-aware; the historical (pre-April)
  // breakdown is hist = raw cancelledNote − cancelledInData (rows counted from the
  // CSV), appended only when positive. Text parts are registry-driven.
  const vCancelled = V('cancelledNote', m.kpi.cancelledNote);
  const cancelledHist = m.kpi.cancelledNote - (m.kpi.totals?.cancelledInData ?? 0);
  const cancelledText = `* ${vCancelled} ${L('execCancelledLabel')}`
    + (cancelledHist > 0 ? ` (${L('execCancelledHistPre')} ${cancelledHist} ${L('execCancelledHistPost')})` : '');

  const els = [
    ...chrome(L('titleExec')),
    ...kpiEls,
    text(9.0, 2.55, 3.813, 0.32, cancelledText, 10, { bold: true, color: C.slate600, align: 'right', valign: 'middle', rtl: true }),
    // KPI-row partition footnote (mirrors the compliance equation footnote) —
    // spells out that the seven buckets add up to the total, centered between the
    // completion-rate (left) and cancelled (right) notes.
    text(3.0, 2.55, 7.3, 0.32, L('execPartition'), 9, { color: C.slate600, align: 'center', valign: 'middle', rtl: true }),
    // Overall completion-rate line — mirrors the cancelled note on the left side.
    text(0.5, 2.55, 2.271, 0.32, `${L('execCompletionRate')}: ${completionRate}%`, 11, { bold: true, color: C.navy, align: 'left', valign: 'middle', rtl: true }),
    // Funnel column labels
    text(9.05, 2.906, 3.0, 0.3, L('funnelStage'), 10, { bold: true, color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
    text(8.629, 2.906, 1.0, 0.3, L('funnelCount'), 10, { bold: true, color: C.slate500, align: 'center', valign: 'middle', rtl: true }),
    text(0.05, 2.906, 2.9, 0.3, L('funnelDesc'), 10, { bold: true, color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
    // Brackets
    rect(12.03, 3.501, 0.02, 1.3, C.slate600),
    text(12.35, 3.824, 0.9, 0.55, 'المستشفى', 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
    rect(12.03, 5.451, 0.02, 0.685, C.slate600),
    text(12.25, 5.496, 0.95, 0.55, 'المختبرات', 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
  ];
  rows.forEach((r, i) => {
    const fillW = Math.round((r.val / (maxV || 1)) * trackW * 1000) / 1000;
    els.push(
      rect(11.97, accentY[i], 0.06, 0.45, r.color),
      text(9.05, rowY[i], 2.85, 0.55, r.stage, 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
      text(8.629, rowY[i], 1.0, 0.55, String(r.val), 14, { bold: true, color: r.color, align: 'center', valign: 'middle' }),
      text(0.05, rowY[i], 2.9, 0.55, r.desc, 10, { color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
      rect(trackX, barY[i], trackW, barH, C.bgLighter, { radius: 0.03 }),
      rect(trackX + trackW - fillW, barY[i], fillW, barH, r.color, { radius: 0.03 }),
    );
    // Stage delta chip — de-duplicated: endpoint metrics (total/completed) are shown
    // on their KPI cards, so the funnel only surfaces intermediate flow deltas; and an
    // overridden stage value suppresses its chip.
    if (d[r.key] > 0 && !KPI_DELTA_KEYS.has(r.key) && !isOv(r.ov)) {
      els.push(text(7.75, rowY[i], 0.75, 0.55, '+' + d[r.key], 10, { bold: true, color: C.deltaGreen, align: 'center', valign: 'middle' }));
    }
  });
  // Delta-chip legend — only when at least one green "+N" chip is visible this run.
  if (anyChip) {
    els.push(text(0.5, 0.72, 6.0, 0.18, L('execDeltaLegend'), 8.5, { color: C.deltaGreen, align: 'left', valign: 'middle', rtl: true }));
  }
  return { id: 'execFunnel', bg: C.white, elements: els };
}

// ============================================================================
// Slide 3 — Monthly orders & results
// ============================================================================
function buildMonthly(m) {
  const L = labelOf(m);
  const V = valueOf(m);
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
  // Partition field: orders = results + rejected + pending. Use the engine's
  // `pending` when present, else derive it (older models carried only `incomplete`,
  // which double-counts rejected and must NOT be used for the partition).
  const pendingOf = (x) => (Number.isFinite(x.pending) ? x.pending : x.orders - x.results - (x.rejected || 0));
  const pTot = mo.reduce((s, x) => s + pendingOf(x), 0);
  const cPct = oTot > 0 ? Math.round((rTot / oTot) * 1000) / 10 : null; // round1(results/orders*100)
  const cTot = pctMonthly(cPct);
  // logical (deck) order: [label, months…, total]; reverse -> visual L->R
  const header = rev(['المؤشر', ...monthLabels, { text: 'الإجمالي', fill: C.navyDark }]);
  const rowOrders = rev([{ text: L('monthlyRowOrders'), align: 'right' }, ...mo.map((x) => String(x.orders)), { text: String(oTot), fill: bg, bold: true }]);
  const rowResults = rev([{ text: L('monthlyRowResults'), align: 'right' }, ...mo.map((x) => String(x.results)), { text: String(rTot), fill: bg, bold: true }]);
  const rowRejected = rev([{ text: L('monthlyRowRejected'), align: 'right' }, ...mo.map((x) => String(x.rejected || 0)), { text: String(rejTot), fill: bg, bold: true }]);
  const rowIncomplete = rev([{ text: L('monthlyRowIncomplete'), align: 'right' }, ...mo.map((x) => String(pendingOf(x))), { text: String(pTot), fill: bg, bold: true }]);
  const rowCompletion = rev([{ text: L('monthlyRowCompletion'), align: 'right' }, ...mo.map((x) => pctMonthly(x.completionPct)), { text: cTot, fill: bg, bold: true }]);

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

  // Bar-chart series names reuse the monthly row labels (same metrics, same slide).
  const monthlyChart = {
    t: 'chart', kind: 'colClustered', x: 0.5, y: 1.07, w: 6.0, h: 3.4,
    categories: monthLabels,
    series: [
      { name: L('monthlyRowOrders'), values: mo.map((x) => x.orders), color: CHART_BLUE },
      { name: L('monthlyRowResults'), values: mo.map((x) => x.results), color: C.greenBright },
      { name: L('monthlyRowIncomplete'), values: mo.map((x) => pendingOf(x)), color: CHART_GRAY },
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
      { name: L('chartActual'), values: monthKeys.map((k) => t.perMonth.find((p) => p.month === k)?.actual ?? null), color: C.navyChart, marker: 'circle' },
      { name: L('chartExpected'), values: monthKeys.map((k) => t.perMonth.find((p) => p.month === k)?.expected ?? null), color: C.orangeSeries, dash: true, marker: 'diamond' },
    ],
    opts: { legend: 'bottom', title: L('chartDaysAxis'), valMin: 0 },
  };

  // Overall-average card values honor the turnaround.actual/expected overrides.
  const ovActual = V('turnaround.actual', t.overallActual);
  const ovExpected = V('turnaround.expected', t.overallExpected);

  const els = [
    ...chrome(L('titleMonthly')),
    table,
    // Partition footnote directly under the monthly table (table bottom ≈ 3.81).
    text(6.604, 3.82, 6.661, 0.24, L('monthlyPartition'), 9, { color: C.slate600, align: 'right', valign: 'middle', rtl: true }),
    monthlyChart,
    turnaroundChart,
    // Overall-average card — RESTACKED so 3-digit live values never touch: title,
    // actual, expected, variance and sample size each get their own band inside the
    // card (4.583 → 6.972). Actual/expected dropped to 20pt to keep the stack clear.
    rect(0.5, 4.583, 3.417, 2.389, C.navyChart, { radius: 0.1 }),
    text(0.5, 4.66, 3.417, 0.3, L('overallAvgTitle'), 13, { bold: true, color: CARD_TITLE, align: 'center', valign: 'middle', rtl: true }),
    text(0.5, 5.0, 3.417, 0.5, `الفعلي: ${ovActual.toFixed(1)} يوم`, 20, { bold: true, color: C.white, align: 'center', valign: 'middle', rtl: true }),
    text(0.5, 5.55, 3.417, 0.5, `المتوقع: ${ovExpected.toFixed(1)} يوم`, 20, { bold: true, color: C.peach, align: 'center', valign: 'middle', rtl: true }),
  ];
  // Variance vs target — actual − expected, sign always shown; only when both present.
  if (Number.isFinite(ovActual) && Number.isFinite(ovExpected)) {
    const diff = ovActual - ovExpected;
    const diffStr = (diff >= 0 ? '+' : '-') + Math.abs(diff).toFixed(1);
    els.push(text(0.5, 6.15, 3.417, 0.3, `الفارق: ${diffStr} يوم عن المستهدف`, 11, { bold: true, color: C.amber, align: 'center', valign: 'middle', rtl: true }));
  }
  // Sample size behind the averages — only when the engine reports measuredCount.
  if (Number.isFinite(t.measuredCount)) {
    els.push(text(0.5, 6.5, 3.417, 0.26, `(ن = ${t.measuredCount} طلب)`, 9, { color: CARD_TITLE, align: 'center', valign: 'middle', rtl: true }));
  }
  return { id: 'monthly', bg: C.white, elements: els };
}

// ============================================================================
// Slide 4 — Compliance measure / late orders
// ============================================================================
// Category cap for the late/on-time chart: keep at most this many test bars. Beyond
// it, we surface the TOP N by combined (late+onTime) volume, re-sorted back into the
// engine's byTest order, and spend one line on a '+ N فحوصات أخرى' note.
const CAT_CAP = 13;

function buildCompliance(m) {
  const L = labelOf(m);
  const lab = m.kpi.byLab;
  // Logical (deck RTL, right→left reading) order per row — the '#' column is DROPPED:
  //   [lab, total, pipeline, awaitingResult, late, onTime, resultedLate, rejected, latePct]
  // rev() -> visual L→R. The count columns ADD UP: total = pipeline + awaitingResult +
  // onTime + resultedLate + rejected. 'late' (منها متأخرة) is a SUBSET of بانتظار النتيجة
  // (overdue, still awaiting) — marked as a subcolumn (↳ prefix + lighter header, light
  // body fill) and NOT part of the add-up. Every column total is computed from the rows
  // (no hardcoded literals); latePct = lateTot/awaitTot (round1, guard div-by-zero).
  const totalTot = lab.reduce((s, r) => s + (r.total || 0), 0);
  const pipelineTot = lab.reduce((s, r) => s + (r.pipeline || 0), 0);
  const awaitTot = lab.reduce((s, r) => s + (r.awaitingResult || 0), 0);
  const lateTot = lab.reduce((s, r) => s + (r.late || 0), 0);
  const onTimeTot = lab.reduce((s, r) => s + (r.onTime || 0), 0);
  const resultedLateTot = lab.reduce((s, r) => s + (r.resultedLate || 0), 0);
  const rejTot = lab.reduce((s, r) => s + (r.rejected || 0), 0);
  const latePctTot = awaitTot > 0 ? Math.round((lateTot / awaitTot) * 1000) / 10 : 0;

  // Per-column body-cell styles.
  const pipelineCell = (n) => ({ text: String(n || 0), color: C.slate500 });            // قبل الاستلام: muted
  const lateCell = (n) => (n > 0                                                          // منها متأخرة: subset of await
    ? { text: String(n), color: C.redPure, bold: true, fill: C.bgLighter }               //   red when >0
    : { text: String(n || 0), color: C.slate500, fill: C.bgLighter });                    //   muted when 0
  const onTimeCell = (n) => (n > 0 ? { text: String(n), color: C.green, bold: true } : String(n || 0));       // ملتزمة: green+bold
  const resultedLateCell = (n) => (n > 0 ? { text: String(n), color: C.amber, bold: true } : String(n || 0)); // صدرت متأخرة: amber when >0
  const latePctCell = (n) => (n >= 50 ? { text: pctLab(n), bold: true, color: C.redPure } : pctLab(n));       // worst-lab highlight

  // Header — the 'منها متأخرة' subcolumn gets a '↳' prefix + a lighter-navy fill so its
  // subset-of-بانتظار-النتيجة relationship reads at a glance.
  const header = rev([
    L('compLab'), L('compTotal'), L('compPipeline'), L('compAwaiting'),
    { text: '↳ ' + L('compLate'), fill: C.taskNavy },
    L('compOnTime'), L('compResultedLate'), L('compRejected'), L('compLatePct'),
  ]);
  const labRows = lab.map((r) => rev([
    { text: r.lab, align: 'right' },
    String(r.total),
    pipelineCell(r.pipeline || 0),
    String(r.awaitingResult),
    lateCell(r.late || 0),
    onTimeCell(r.onTime || 0),
    resultedLateCell(r.resultedLate || 0),
    String(r.rejected || 0),
    latePctCell(r.latePct),
  ]));
  const totalRow = rev([
    { text: 'المجموع', bold: true, fill: C.bgLighter, align: 'right' },
    { text: String(totalTot), bold: true, fill: C.bgLighter },
    { text: String(pipelineTot), bold: true, fill: C.bgLighter, color: C.slate500 },
    { text: String(awaitTot), bold: true, fill: C.bgLighter },
    { text: String(lateTot), bold: true, fill: C.bgLighter, ...(lateTot > 0 ? { color: C.redPure } : {}) },
    { text: String(onTimeTot), bold: true, fill: C.bgLighter, ...(onTimeTot > 0 ? { color: C.green } : {}) },
    { text: String(resultedLateTot), bold: true, fill: C.bgLighter, ...(resultedLateTot > 0 ? { color: C.amber } : {}) },
    { text: String(rejTot), bold: true, fill: C.bgLighter },
    { text: pctLab(latePctTot), bold: true, fill: C.bgLighter },
  ]);

  // colW: '#' dropped. 8 count columns at 1.0in each; the lab-name column takes the
  // remainder (3.667in — un-truncated for the 6 known labs at the body font). Total
  // table width UNCHANGED = 11.667 (3.667 + 8×1.0).
  const LAB_W = 3.667, NUM_W = 1.0;
  // Footnote Y is DYNAMIC: live data renders MORE lab rows than the mock, so a static
  // footnote y crashed into the totals row. rowH stays 0.275 for the known labs; when
  // labRows > 7 the rows shrink so the table + footnote still clear the chart band
  // (divider at y 4.12). The footnote sits one gap below the totals row, clamped so it
  // never drops past the chart top − 0.05.
  const TABLE_Y = 1.194, BASE_ROW_H = 0.275, FOOT_H = 0.24, BAND_TOP = 4.12;
  const nTableRows = labRows.length + 2;            // header + labRows + totals
  let rowH = BASE_ROW_H;
  if (labRows.length > 7) {
    const maxRowH = (BAND_TOP - 0.05 - FOOT_H - 0.08 - TABLE_Y) / nTableRows;
    rowH = Math.min(BASE_ROW_H, Math.floor(maxRowH * 1000) / 1000);
  }
  const footnoteY = Math.min(TABLE_Y + nTableRows * rowH + 0.08, BAND_TOP - 0.05 - FOOT_H);
  const labTable = {
    t: 'table', x: 0.833, y: TABLE_Y, w: 11.667, rtl: true, rowH, headerSize: 9, bodySize: 9.5,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev([LAB_W, NUM_W, NUM_W, NUM_W, NUM_W, NUM_W, NUM_W, NUM_W, NUM_W]),
    rows: [header, ...labRows, totalRow],
  };
  // Equation footnote directly under the table (small, slate, rtl) — spells out the
  // add-up so the columns visibly reconcile. Built from the labels so it tracks overrides.
  const eqFootnote = text(0.833, footnoteY, 11.667, FOOT_H,
    `${L('compTotal')} = ${L('compPipeline')} + ${L('compAwaiting')} + ${L('compOnTime')} + ${L('compResultedLate')} + ${L('compRejected')}`,
    9, { color: C.slate600, align: 'right', valign: 'middle', rtl: true });

  // Grouped late + on-time bars in one chart. Cap the category count to CAT_CAP:
  // pick the top by (late+onTime), then restore byTest order so bars read naturally.
  const byTest = m.kpi.byTest;
  let cats = byTest, extraCats = 0;
  if (byTest.length > CAT_CAP) {
    const keep = new Set(byTest.slice()
      .sort((a, b) => (b.late + b.onTime) - (a.late + a.onTime))
      .slice(0, CAT_CAP));
    cats = byTest.filter((x) => keep.has(x));
    extraCats = byTest.length - CAT_CAP;
  }
  // Bar geometry: y bottom is pinned at 7.05 so grouped pairs never cross the footer
  // border (7.10). Category labels shrink to 7pt past 10 categories to stay readable.
  const CHART_Y = 4.5, CHART_BOTTOM = 7.05;
  const lateChart = {
    t: 'chart', kind: 'barH', x: 0.806, y: CHART_Y, w: 11.694, h: CHART_BOTTOM - CHART_Y,
    categories: cats.map((x) => m.displayNames[x.testName] || x.testName),
    series: [
      { name: L('chartLateSeries'), values: cats.map((x) => x.late), color: C.navyBar },
      { name: L('chartOnTimeSeries'), values: cats.map((x) => x.onTime), color: C.greenBright },
    ],
    opts: { dataLabels: true, legend: 'bottom', catFont: cats.length > 10 ? 7 : 8 },
  };

  const els = [
    ...chrome(L('titleCompliance')),
    labTable,
    eqFootnote,
    rect(0.6, 4.12, 12.3, 0.012, C.border),
    text(0.6, 4.16, 12.3, 0.4, 'تفاصيل الطلبات المتأخرة والملتزمة', 14, { bold: true, color: C.navy, align: 'center', valign: 'middle', rtl: true }),
    lateChart,
    // Catalog footnote for the by-test chart (top-right of the band, opposite the
    // overflow note) — the bars reflect only the approved test catalog.
    text(8.9, 4.18, 3.6, 0.30, L('catalogNote'), 9, { italic: true, color: C.slate600, align: 'right', valign: 'middle', rtl: true }),
  ];
  // Overflow note (top-left of the chart band, clear of the centered subtitle).
  if (extraCats > 0) {
    els.push(text(0.806, 4.18, 3.6, 0.30, `+ ${extraCats} فحوصات أخرى`, 9,
      { italic: true, color: C.slate600, align: 'left', valign: 'middle', rtl: true }));
  }
  return { id: 'compliance', bg: C.white, elements: els };
}

// ============================================================================
// Slide 5 — Tasks + challenges + risks (variant changes the task ROWS)
// ============================================================================
const STATUS_FILL = { 'مستمر': { fill: C.taskNavy, color: C.white }, 'متأخر': { fill: C.redDark, color: C.white }, 'قيد التنفيذ': { fill: C.amberStatus, color: C.black }, 'مغلق': { fill: C.green, color: C.white }, 'مفتوح': { fill: C.slate500, color: C.white } };

// Full-width tasks table. '#' is renumbered by row index (i+1) — internal rows do
// NOT keep their own tk.num (which restarts at 1). rowH/fonts are parametrized.
function taskTable(tasks, { y, rowH, bodySize, headerSize, L }) {
  // rtl=0 in deck: visual == authored order [الحالة, تاريخ, المالك, المسؤول, الإجراء, #]
  const header = [L('taskStatus'), L('taskDue'), L('taskOwner'), L('taskResponsible'), L('taskAction'), L('taskHash')];
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
  const L = labelOf(m);
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
  // Two-line cells (date RANGES like '25-06-2026\n16-07-2026') need ~0.42in of
  // Cairo ink — with the default 0.30 cap adjacent rows' dates collide. Raise
  // the cap only when multi-line content exists AND the row count leaves room.
  const hasTwoLine = taskRows.slice(0, shown).some((t) =>
    Object.values(t || {}).some((v) => typeof v === 'string' && v.includes('\n')));
  const rowCap = hasTwoLine ? 0.44 : 0.30;
  const rowH = Math.max(0.18, Math.min(rowCap, AREA / (shown + 1)));
  const bodySize = rowH >= 0.26 ? 9.5 : rowH >= 0.21 ? 9 : 8;
  const headerSize = bodySize;
  const table = taskTable(taskRows.slice(0, shown), { y: 1.15, rowH, bodySize, headerSize, L });

  const els = [
    ...chrome(L('titleAction')),
    ...tasksSubhead('المهام الحالية', 0.84),
    table,
  ];
  if (hasNote) {
    const noteY = 1.15 + (shown + 1) * rowH;
    els.push(text(0.641, noteY, 12.259, 0.24, `+ ${n - CAP} مهمة أخرى`, bodySize, { italic: true, color: C.slate600, align: 'center', valign: 'middle', rtl: true }));
  }

  // Block 2 — support required (full width red band, bottom 5.54, clear of the subhead
  // dots below). The band must CONTAIN its ink: title + up to 3 right-aligned bullets
  // fit the band height; a 4th+ item is folded into an inline '+ N أخرى' line so live
  // data with many long bullets never overflows into the challenges/risks subheads.
  const SUP_CAP = 3;
  const support = m.panels.supportRequired || [];
  const supText = bullets(support.slice(0, SUP_CAP))
    + (support.length > SUP_CAP ? `\n+ ${support.length - SUP_CAP} أخرى` : '');
  els.push(
    rect(0.5, 4.62, 12.3, 0.92, C.bgRed, { radius: 0.06 }),
    text(0.7, 4.62, 11.9, 0.26, L('supportTitle'), 11.5, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
    text(0.9, 5.02, 11.7, 0.52, supText, 9, { color: C.slate900, align: 'right', valign: 'top', rtl: true, lineSpacing: 0.9 }),
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
    colW: [1.738, 0.50, 1.245, 2.281, 0.236], // التأثير widened: 'متوسط' clipped at 0.406 (analyst finding)
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
// Slide — Definitions ('منهجية الأرقام'), inserted before the closing thanks slide
// ============================================================================
// Each row is [metric-label key, definition key]; every report metric gets one
// line, and the definitions mirror the engine's documented rules (see the JSDoc
// in src/engine/engine.js). Registry-driven so both columns are editable.
const DEF_ROWS = [
  ['defMTotal', 'defDTotal'],
  ['defMAwaitDispatch', 'defDAwaitDispatch'],
  ['defMShipped', 'defDShipped'],
  ['defMAwaitResults', 'defDAwaitResults'],
  ['defMLate', 'defDLate'],
  ['defMCompleted', 'defDCompleted'],
  ['defMRejected', 'defDRejected'],
  ['defMOnTime', 'defDOnTime'],
  ['defMResultedLate', 'defDResultedLate'],
  ['defMPipeline', 'defDPipeline'],
  ['defMPending', 'defDPending'],
  ['defMLatePct', 'defDLatePct'],
  ['defMTurnaround', 'defDTurnaround'],
  ['defMCancelled', 'defDCancelled'],
];

function buildDefinitions(m) {
  const L = labelOf(m);
  // 2-column table (المؤشر | التعريف). rtl → visual columns are [التعريف, المؤشر],
  // so the metric reads first (rightmost). 14 rows + header at rowH 0.4 span
  // y 0.95 → 6.95, inside the 7.05 content band; fonts 8.5/9pt.
  const METRIC_W = 3.0, DEF_W = 8.667;
  const header = rev([L('defsColMetric'), L('defsColDef')]);
  const rows = DEF_ROWS.map(([mk, dk]) =>
    rev([{ text: L(mk), align: 'right', bold: true }, { text: L(dk), align: 'right' }]));
  const table = {
    t: 'table', x: 0.833, y: 0.95, w: 11.667, rtl: true, rowH: 0.4, headerSize: 9, bodySize: 8.5,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev([METRIC_W, DEF_W]),
    rows: [header, ...rows],
  };
  return { id: 'definitions', bg: C.white, elements: [...chrome(L('defsTitle')), table] };
}

// ============================================================================
// Slide 6 — Thanks
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
 * @param {import('../contracts.js').ReportModel} reportModel
 * @param {{variant?:('internal'|'nupco')}} [opts]
 * @returns {import('../contracts.js').SlideSpec}
 */
export function buildSpec(reportModel, { variant = 'internal' } = {}) {
  const m = reportModel;
  // SLIDE TOGGLES — the 5 middle slides are filtered by m.reportOptions.slides
  // (absent → all on). Cover + thanks ALWAYS render. Page numbers are assigned AFTER
  // filtering so they renumber sequentially (1..n) over the INCLUDED content slides.
  const slides = m.reportOptions?.slides;
  const on = (key) => !slides || slides[key] !== false;
  const middleDefs = [
    { key: 'execFunnel', build: () => buildExecFunnel(m) },
    { key: 'monthly', build: () => buildMonthly(m) },
    { key: 'compliance', build: () => buildCompliance(m) },
    { key: 'action', build: () => buildAction(m, variant) },
    // Definitions ('منهجية الأرقام') — default ON; rendered just before thanks and
    // participates in the sequential footer numbering like the other middle slides.
    { key: 'definitions', build: () => buildDefinitions(m) },
  ];
  const middle = middleDefs.filter((x) => on(x.key)).map((x) => x.build());
  middle.forEach((s, i) => s.elements.push(pageFooter(i + 1)));
  return [buildCover(m), ...middle, buildThanks(m)];
}

export default buildSpec;
