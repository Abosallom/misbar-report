// src/slidespec/build-spec.js
// buildSpec(reportModel, { variant }) -> SlideSpec (see src/contracts.js).
// One builder per slide. ALL geometry is in inches, derived by converting EMU->inches
// (÷914400) from the original deck OOXML (تقرير مسبار 09072026.pptx).
// SIX-slide deck (both variants): cover · execFunnel · monthly · compliance · action · thanks.
// The definitions slide (منهجية الأرقام) is built on demand only — it is OPT-IN via
// reportOptions.slides.definitions === true (user decision 2026-07-26: the default deck is
// back to the simple 20-07 reference shape). The internal variant may still exceed six
// slides through task-pagination continuation slides ('المهام — تتمة').
// The variant no longer changes slide PRESENCE — it changes slide-5 (action) task ROWS:
// nupco shows tasksCurrent (non-لين actions); internal shows tasksInternal ONLY (لين-category
// actions — user decision 2026-07-19). No slide is internalOnly.
//
// PRESENTATION OPTIONS (all read from the model, safe defaults when absent):
//   m.reportOptions.labels[key]   overrides DEFAULT_LABELS static text (byte-stable when absent)
//   m.reportOptions.slides[key]   toggles the 5 middle slides (cover/thanks always render)
//   m.reportOptions.kpiCards[key] toggles the 7 exec KPI cards (row geometry repacks)
//                                 + the OPT-IN 'turnaround' block on the monthly slide
//   m.overrides[key]              per-run manual NUMBER overrides (suppresses that delta chip)
import { COLORS as C, GEOM } from '../theme.js?v=v2026-07-23.5';

// OPT-IN kpiCards KEYS. reportOptions.kpiCards normally reads "on unless === false"
// (see buildExec's cardDefs filter). The keys in this set INVERT that: they render only
// when the flag is explicitly true, so a missing/undefined flag reads as OFF — exactly
// the mechanism OPT_IN_SLIDES gives the definitions slide (see buildSpec below).
// 'turnaround' gates the monthly slide's turnaround LINE CHART *and* its navy
// overall-average card (user decision 2026-07-26: the default monthly slide matches the
// 20-07 reference deck — chrome + the monthly table + ONE bar chart, nothing else).
const OPT_IN_CARDS = new Set(['turnaround']);
const cardOn = (m) => (key) => (OPT_IN_CARDS.has(key)
  ? m.reportOptions?.kpiCards?.[key] === true
  : m.reportOptions?.kpiCards?.[key] !== false);

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
  titleActionCont: 'المهام — تتمة',
  // Cover + thanks
  coverTitle: 'تقرير مسبار اليومي',
  coverSubtitle: 'متابعة تقدم الطلبات وقياس جاهزية المختبرات',
  coverPreparedBy: 'إعداد: لين لخدمات الأعمال',
  thanks: 'شكرا لكم',
  // Exec KPI card labels (keys mirror the deltas/overrides keys).
  // WORDING IS THE 20-07 REFERENCE DECK's, verbatim (user decision 2026-07-26): the user
  // hand-retyped these cards in PowerPoint from 'طلبات' to 'فحوصات' ("all numbers are for
  // tests"), so his own hand-typed strings are the spec. Extracted run-by-run from
  // ppt/slides/slide2.xml — the reference splits several of them across runs
  // ('إجمالي' + ' ' + 'الفحوصات', 'فحوصات' + ' مكتملة', 'فحوصات ' + 'شُحنت' + ' ولم تُستلم');
  // the concatenated string is what is stored here.
  kpiTotal: 'إجمالي الفحوصات',
  // The reference's awaitingDispatch card carries 'في انتظار شحن العينة من المستشفى' in the
  // LABEL (its box was hand-widened to 1.75in to fit) and the fragment 'قبل الـ' in the
  // sublabel — the user typed 'من المستشفى' up into the label and deleted ' Dispatch' off
  // the sublabel in the same pass. We keep the generator's 1.479in label box, so the split
  // is restored to label + sublabel with every reference word preserved.
  kpiAwaitingDispatch: 'في انتظار شحن العينة',
  kpiAwaitingResults: 'فحوصات تحت الإجراء',
  kpiCompleted: 'فحوصات مكتملة',
  // NOT RENDERED in the exec KPI row any more — the reference row is SIX cards and drops
  // المرفوضة (user decision 2026-07-26). The metric still ships in the per-lab compliance
  // table (compRejected). This key stays in both registries for parity, like execPartition.
  kpiRejected: 'النتائج المرفوضة',
  kpiLate: 'الطلبات المتأخرة',
  kpiShipped: 'فحوصات شُحنت ولم تُستلم',
  // Exec slide — overall completion-rate line. NOT RENDERED (user decision 2026-07-26:
  // the 20-07 reference deck has no such line); kept for registry parity like execPartition.
  execCompletionRate: 'نسبة الاكتمال الإجمالية',
  // Exec slide — delta-chip legend. ALL chips are green now (user decision 2026-07-23):
  // the old red/green colour key was removed. The legend is MODE-AWARE — the daily/weekly
  // variants substitute the baseline date into '{date}'; the plain key is the legacy
  // (no-baseline) previous-report wording. Rendered only when a chip is visible this run.
  // WEEKLY is weekday-anchored (user decision 2026-07-26): the Saudi work week is Sun–Thu
  // and the weekly report is issued on Sunday AND on Thursday, so there are exactly two
  // weekly baselines — 'weekly-sun' and 'weekly-thu' — each with its own legend wording.
  // execDeltaLegendWeekly stays for the legacy pre-split 'weekly' mode value.
  execDeltaLegend: '▲ التغيّر منذ التقرير السابق',
  execDeltaLegendDaily: '▲ التغيّر منذ آخر تقرير ({date})',
  execDeltaLegendWeekly: '▲ التغيّر الأسبوعي — منذ تقرير ({date})',
  execDeltaLegendWeeklySun: '▲ التغيّر الأسبوعي — منذ تقرير الأحد ({date})',
  execDeltaLegendWeeklyThu: '▲ التغيّر الأسبوعي — منذ تقرير الخميس ({date})',
  // Monthly table row labels (also reused as the monthly bar-chart series names).
  // monthlyRowIncomplete surfaces the engine's `pending` partition value
  // (orders = results + rejected + pending). Its WORDING is the 20-07 reference deck's
  // 'النتائج غير المكتملة' (user decision 2026-07-26) — the longer 'قيد المعالجة (بدون نتيجة)'
  // measured 137.1px = 1.428in in Cairo 10pt against a 1.312in label column (1.112in of
  // text width once pptxgenjs' default 0.1in cell margins are taken off), so it wrapped to
  // two lines in BOTH outputs and grew the 0.456in row in PowerPoint. The reference wording
  // measures 102.4px = 1.067in and fits on one line; it is also the series name the
  // reference deck's monthly bar chart used.
  // TABLE wording is the reference's own 'فحوصات' family (user decision 2026-07-26 — same
  // hand-retype as the KPI cards); the bar chart keeps the 'طلبات' family, see
  // chartMonthly* below.
  monthlyRowOrders: 'الفحوصات',
  monthlyRowResults: 'نتائج الفحوصات المستلمة',
  monthlyRowRejected: 'النتائج المرفوضة',
  monthlyRowIncomplete: 'النتائج غير المكتملة',
  monthlyRowCompletion: 'نسبة الاكتمال',
  // Monthly BAR-CHART series names. These used to reuse the monthlyRow* keys, but the
  // reference deck's table and chart no longer agree: the user retyped the TABLE rows to
  // the 'فحوصات' family and left the chart's legend on the original 'طلبات' family
  // (ppt/charts/chart1.xml c:ser c:tx = 'الطلبات' / 'النتائج المستلمة' /
  // 'النتائج غير المكتملة' — a pristine chart part PowerPoint never rewrote). So the two
  // are SPLIT into their own keys, each independently overridable.
  chartMonthlyOrders: 'الطلبات',
  chartMonthlyResults: 'النتائج المستلمة',
  chartMonthlyIncomplete: 'النتائج غير المكتملة',
  // Monthly partition footnote (under the table) — the orders add-up identity.
  monthlyPartition: 'الطلبات = النتائج المستلمة + المرفوضة + قيد المعالجة',
  // Compliance (byLab) table headers — back to the SEVEN reference columns (user
  // decision 2026-07-26: the 20-07 NUPCO deck shape). Logical RTL order (right→left):
  //   # | المختبر | مجموع الطلبات | طلبات مستلمة بانتظار نتيجة | مرفوضة | الطلبات المتأخرة | نسبة الطلبات المتأخرة
  // The wording matches that deck verbatim. compPipeline / compOnTime / compResultedLate
  // are NO LONGER RENDERED (their columns were removed with the add-up equation footnote);
  // the keys stay in both registries for parity — harmless orphans, like catalogNote.
  compHash: '#',
  compLab: 'المختبر',
  compTotal: 'مجموع الطلبات',
  compPipeline: 'قبل الاستلام',
  compAwaiting: 'طلبات مستلمة بانتظار نتيجة',
  compLate: 'الطلبات المتأخرة',
  compOnTime: 'ملتزمة',
  compResultedLate: 'صدرت متأخرة',
  compRejected: 'مرفوضة',
  compLatePct: 'نسبة الطلبات المتأخرة',
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
  titleActionCont: 'عنوان شريحة تتمة المهام',
  coverTitle: 'عنوان الغلاف',
  coverSubtitle: 'العنوان الفرعي للغلاف',
  coverPreparedBy: 'سطر جهة الإعداد في الغلاف',
  thanks: 'نص شريحة الشكر',
  kpiTotal: 'بطاقة: إجمالي الفحوصات',
  kpiAwaitingDispatch: 'بطاقة: في انتظار شحن العينة',
  kpiAwaitingResults: 'بطاقة: فحوصات تحت الإجراء',
  kpiCompleted: 'بطاقة: فحوصات مكتملة',
  kpiRejected: 'بطاقة: النتائج المرفوضة (غير مستخدم حالياً)',
  kpiLate: 'بطاقة: الطلبات المتأخرة',
  kpiShipped: 'بطاقة: فحوصات شُحنت ولم تُستلم',
  execCompletionRate: 'سطر نسبة الاكتمال الإجمالية (غير مستخدم حالياً)',
  execDeltaLegend: 'مفتاح التغيّر — الصيغة الافتراضية (منذ التقرير السابق)',
  execDeltaLegendDaily: 'مفتاح التغيّر اليومي — منذ آخر تقرير ({date})',
  execDeltaLegendWeekly: 'مفتاح التغيّر الأسبوعي — منذ تقرير قبل أسبوع ({date})',
  execDeltaLegendWeeklySun: 'مفتاح التغيّر الأسبوعي — منذ تقرير الأحد ({date})',
  execDeltaLegendWeeklyThu: 'مفتاح التغيّر الأسبوعي — منذ تقرير الخميس ({date})',
  monthlyRowOrders: 'صف الجدول الشهري: الفحوصات',
  monthlyRowResults: 'صف الجدول الشهري: نتائج الفحوصات المستلمة',
  monthlyRowRejected: 'صف الجدول الشهري: النتائج المرفوضة (غير مستخدم حالياً)',
  monthlyRowIncomplete: 'صف الجدول الشهري: النتائج غير المكتملة',
  monthlyRowCompletion: 'صف الجدول الشهري: نسبة الاكتمال',
  chartMonthlyOrders: 'سلسلة الرسم الشهري: الطلبات',
  chartMonthlyResults: 'سلسلة الرسم الشهري: النتائج المستلمة',
  chartMonthlyIncomplete: 'سلسلة الرسم الشهري: النتائج غير المكتملة',
  compHash: 'عمود الالتزام: الرقم',
  compLab: 'عمود الالتزام: المختبر',
  compTotal: 'عمود الالتزام: مجموع الطلبات',
  compPipeline: 'عمود الالتزام: قبل الاستلام (غير مستخدم حالياً)',
  compAwaiting: 'عمود الالتزام: طلبات مستلمة بانتظار نتيجة',
  compLate: 'عمود الالتزام: الطلبات المتأخرة',
  compOnTime: 'عمود الالتزام: الطلبات الملتزمة (غير مستخدم حالياً)',
  compResultedLate: 'عمود الالتزام: صدرت متأخرة (غير مستخدم حالياً)',
  compRejected: 'عمود الالتزام: مرفوضة',
  compLatePct: 'عمود الالتزام: نسبة الطلبات المتأخرة',
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
  execPartition: 'حاشية معادلة الإجمالي (الملخص التنفيذي) (غير مستخدم حالياً)',
  monthlyPartition: 'حاشية معادلة الطلبات الشهرية (غير مستخدم حالياً)',
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
// 'فحوصات تحت الإجراء' card — the user RECOLOURED it in PowerPoint from the app's amber
// (#F59E0B) to a theme colour: slide2.xml carries <a:schemeClr val="accent1"><a:lumMod
// val="75000"/> on both that card's value run and its accent bar. theme1.xml's accent1 is
// srgbClr 4472C4; lumMod 75% (HSL L×0.75) resolves to #2F5597 — Office's "Blue, Accent 1,
// Darker 25%". Baked as a literal hex because the deck we emit carries no theme part.
const CARD_DEEP_BLUE = '#2F5597';
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
// Exec delta-chip text: '+N' for a rise, '−N' for a drop (− is U+2212, not a hyphen);
// 0 / non-finite → undefined so the chip is hidden (keep current behaviour). ALL chips
// are green now (user decision 2026-07-23) — the old BAD_DELTA red-chip logic is gone.
const fmtDelta = (n) => (Number.isFinite(n) && n !== 0 ? (n > 0 ? '+' + n : '−' + Math.abs(n)) : undefined);
// Mode-aware delta legend: every dated mode substitutes the baseline date into '{date}';
// legacy (no baseline, or mode 'legacy') uses the plain previous-report wording. The
// weekly comparison is weekday-anchored (user decision 2026-07-26) — pickDeltaBaseline
// returns 'weekly-sun' / 'weekly-thu' and each gets its own wording; the bare 'weekly'
// mapping is kept for the legacy pre-split mode value. All strings stay overridable
// through the labels registry.
const DELTA_LEGEND_KEY = {
  daily: 'execDeltaLegendDaily',
  weekly: 'execDeltaLegendWeekly',           // legacy pre-split mode value
  'weekly-sun': 'execDeltaLegendWeeklySun',
  'weekly-thu': 'execDeltaLegendWeeklyThu',
};
// db.anchored === false means pickDeltaBaseline found NO report on the requested weekday
// yet (history still filling up) and degraded to the most recent prior report. Naming that
// date 'تقرير الأحد' / 'تقرير الخميس' would assert a weekday the baseline does not have —
// the deck would state a false comparison basis while the review screen discloses the
// fallback (screen-review.js anchorFallbackNote). So the unanchored case falls back to the
// daily wording ('منذ آخر تقرير ({date})'), which is exactly what that baseline IS.
// NOTE: `anchored` only reaches here on the UI path (screen-review.js forwards it);
// automation/pipeline.js still drops it when stamping model.deltaBaseline — cross-file.
const deltaLegendText = (L, db) => {
  if (!db || !db.baselineDate) return L('execDeltaLegend');
  const key = db.anchored === false ? 'execDeltaLegendDaily' : DELTA_LEGEND_KEY[db.mode];
  if (key) return L(key).replace('{date}', fmtDate(db.baselineDate));
  return L('execDeltaLegend');
};

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
// KPI card factory. Width is a param (the row repacks for N cards).
// INTERIOR GEOMETRY IS THE 20-07 REFERENCE DECK's, verbatim (user decision 2026-07-26 —
// the reference deck is the spec). Fixed offsets from the card origin, NOT derived from
// an ink-line formula: value 34pt at (x+0.08, y+0.13, w−0.24, 0.72), label 11.5pt at
// (x+0.08, y+0.90, w−0.16, 0.42) with NO line-spacing override (the reference slide
// carries zero <a:lnSpc>), sublabel 9.5pt at (x+0.08, y+1.28, w−0.16, 0.28).
// The one deliberate departure is the delta chip: the reference's chip box sits at
// (x+0.10, y+0.30, 0.9, 0.42) at 20pt, i.e. straight over the restored 34pt value band
// (y+0.13 → y+0.85). It only looked clean in the reference because the '+N' runs were
// hand-deleted there. The chips are a KEPT feature, so they stay pinned to the TOP-LEFT
// corner at 13pt where they are left-aligned and the value is right-aligned — the two
// can never touch. See the delta-legend note in buildExecFunnel.
// EMPHASIS (emph: true) is the treatment the user hand-built for الطلبات المتأخرة on the
// reference slide: he duplicated the 0.063in accent bar twice, stretched each to the full
// card width and dropped one on the card's top edge and one on its bottom edge, so the
// white card reads as a red-outlined box. Reference shapes (slide2.xml, the last two in the
// spTree, i.e. drawn on top): #FF0000, w 1.639 = card width, h 0.0793, top bar y 0.9296
// (= card y) and bottom bar y 2.4643 (= card y + h − 0.0657, straddling the bottom edge).
// Their x values are −0.0088 / −0.0315, i.e. the card x minus hand-drag noise; the
// generator emits them at the card x. The right accent bar STAYS — the reference kept it.
function kpiCard({ x, w, v, vc, lab, sub, ac, delta, emph }) {
  const y = 0.93, h = 1.6;
  const els = [
    rect(x, y, w, h, C.white, { radius: 0.05, line: { color: C.border, w: 0.75 } }),
    rect(x + w - 0.063, y, 0.063, h, ac),
    // value — 34pt, right-aligned (reference: sz=3400 on every card)
    text(x + 0.08, y + 0.13, w - 0.24, 0.72, v, 34, { bold: true, color: vc, align: 'right', valign: 'middle' }),
    // label — 11.5pt (reference: sz=1150, no lnSpc)
    text(x + 0.08, y + 0.9, w - 0.16, 0.42, lab, 11.5, { bold: true, color: C.slate900, align: 'right', valign: 'top', rtl: true }),
  ];
  // delta chip — TOP-LEFT corner, left-aligned; horizontally clear of the value.
  // ALWAYS green now (user decision 2026-07-23) — no per-metric colour branching.
  if (delta) els.push(text(x + 0.06, y + 0.06, 0.55, 0.24, delta, 13, { bold: true, color: C.deltaGreen, align: 'left', valign: 'middle' }));
  // sublabel — 9.5pt (reference: sz=950)
  if (sub) els.push(text(x + 0.08, y + 1.28, w - 0.16, 0.28, sub, 9.5, { color: C.slate500, align: 'right', valign: 'top', rtl: true }));
  // emphasis bars LAST so they paint over the card body, as they do in the reference.
  if (emph) {
    els.push(rect(x, y, w, 0.0793, ac), rect(x, y + h - 0.0657, w, 0.0793, ac));
  }
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
  return { cardW, xOf };
}

// CANONICAL SIX-CARD ROW — pinned to the reference deck's own boxes (user decision
// 2026-07-26). kpiRowGeom(6) would NOT reproduce them: at N=6 the computed width
// (11.618/6 = 1.936) clamps to the KPI_CAP_W 1.903 cap, giving six 1.903in cards on a
// 2.043 pitch. The reference instead keeps the 7-card 1.639in card and simply deletes
// المرفوضة, leaving the remaining five in their old slots and dragging الطلبات المتأخرة
// flush to the left edge. Card x, EMU→in from slide2.xml (index 0 = rightmost):
//   11.179 · 9.400 · 7.587 · 5.774 · 3.995 · 0.000   (w 1.639, y 0.93, h 1.6)
// Two hand-drag artefacts are normalised: the شُحنت card sits at y 0.9500 in the reference
// (0.02in below its five neighbours) and the الطلبات المتأخرة emphasis bars at x −0.0088 /
// −0.0315; we emit y 0.93 for every card and x 0.000 for that card's bars.
// A NON-canonical row (any card switched off in reportOptions.kpiCards) falls back to
// kpiRowGeom, which repacks and re-centres as before.
const KPI_REF_W = 1.639;
const KPI_REF_X = [11.179, 9.400, 7.587, 5.774, 3.995, 0.000];

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

  // -- ZONE A: KPI cards in one row, right-to-left (total rightmost). Card defs in RTL
  // logical order (index 0 = rightmost). ORDER AND MEMBERSHIP ARE THE 20-07 REFERENCE
  // DECK's (user decision 2026-07-26): إجمالي · في انتظار شحن العينة · فحوصات شُحنت ولم
  // تُستلم · فحوصات تحت الإجراء · فحوصات مكتملة · الطلبات المتأخرة — SIX cards. النتائج
  // المرفوضة was dropped from this row by the user (it stays in the per-lab compliance
  // table's مرفوضة column, which is untouched); kpiRejected stays in the label registries.
  // الطلبات المتأخرة is last and, in the reference, dragged flush to the left edge with a
  // red bar on its top and bottom edge — see KPI_REF_X and kpiCard's `emph`.
  // dk = the delta/override/kpiCards key. A card renders unless kpiCards[dk] === false;
  // its value is the manual override (if finite) else the computed metric, and its green
  // "+N" chip is suppressed when that value was overridden.
  const cardDefs = [
    { v: V('total', m.kpi.totals.total),                vc: C.blue,           lab: L('kpiTotal'),            sub: dataWindow,                 ac: C.blue,           dk: 'total' },
    // sub is ONE line on purpose: 'من المستشفى قبل الـ Dispatch' wrapped to two and its
    // ink crossed the (already two-line) label inside this 1.479in card.
    { v: V('awaitingDispatch', b.awaitingDispatch),     vc: C.greenSoft,      lab: L('kpiAwaitingDispatch'),  sub: 'قبل الـ Dispatch',         ac: C.greenSoft,      dk: 'awaitingDispatch' },
    { v: V('shippedNotReceived', b.shippedNotReceived), vc: C.redSoft,        lab: L('kpiShipped'),           sub: '',                         ac: C.redSoft,        dk: 'shippedNotReceived' },
    // CARD_DEEP_BLUE, not C.amber: the user recoloured this card in the reference deck.
    { v: vAwait,                                        vc: CARD_DEEP_BLUE,   lab: L('kpiAwaitingResults'),   sub: 'بعد الـ Dispatch',         ac: CARD_DEEP_BLUE,   dk: 'awaitingResults' },
    { v: V('completed', b.completed),                   vc: C.green,          lab: L('kpiCompleted'),         sub: '',                         ac: C.green,          dk: 'completed' },
    { v: vLate,                                         vc: C.redPure,        lab: L('kpiLate'),              sub: `تمثل ${latePctShown}% من الطلبات`, ac: C.redPure, dk: 'lateNoResult', emph: true },
  ];
  const visible = cardDefs.filter((c) => m.reportOptions?.kpiCards?.[c.dk] !== false);
  // Canonical row (nothing switched off) => the reference's own pinned boxes; otherwise
  // fall back to the computed repacking layout. See KPI_REF_X.
  const refRow = visible.length === KPI_REF_X.length;
  const { cardW, xOf } = refRow
    ? { cardW: KPI_REF_W, xOf: (i) => KPI_REF_X[i] }
    : kpiRowGeom(visible.length);
  // ALL delta chips are green now (user decision 2026-07-23) — the old BAD_DELTA
  // red-chip branch was removed. fmtDelta yields '+N' on a rise, '−N' on a drop, and
  // nothing (chip hidden) for a 0/missing delta. An overridden card value suppresses
  // its chip (a manual number has no meaningful delta vs the baseline).
  const kpiEls = visible.flatMap((c, i) => kpiCard({
    x: xOf(i), w: cardW, v: String(c.v), vc: c.vc, lab: c.lab, sub: c.sub, ac: c.ac,
    delta: isOv(c.dk) ? undefined : fmtDelta(d[c.dk]), emph: c.emph,
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
  const anyChip = visible.some((c) => !isOv(c.dk) && fmtDelta(d[c.dk]) !== undefined)
    || rows.some((r) => !KPI_DELTA_KEYS.has(r.key) && !isOv(r.ov) && fmtDelta(d[r.key]) !== undefined);

  // Cancelled note — displayed count is override-aware. Geometry/size are the 20-07
  // reference deck's: (10.542, 2.55, 2.271, 0.32) at 11pt (its shape survives there with
  // endParaRPr sz="1100" even though the visible run was hand-deleted). The
  // '(منها N قبل أبريل)' historical breakdown is NOT appended any more — the reference
  // note is just '* N طلب ملغي'. execCancelledHistPre/Post stay in both registries as
  // harmless orphans, exactly like execPartition.
  const vCancelled = V('cancelledNote', m.kpi.cancelledNote);
  const cancelledText = `* ${vCancelled} ${L('execCancelledLabel')}`;

  const els = [
    ...chrome(L('titleExec')),
    ...kpiEls,
    text(10.542, 2.55, 2.271, 0.32, cancelledText, 11, { bold: true, color: C.slate600, align: 'right', valign: 'middle', rtl: true }),
    // NOTE: neither the KPI-row partition footnote (execPartition) nor the overall
    // completion-rate line (execCompletionRate) is rendered — user decision 2026-07-26
    // restored the 20-07 reference deck, which has no shape at (0.5, 2.55) and carries no
    // add-up equation notes. Both label keys stay in the registries for parity.
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
    const stageDelta = (KPI_DELTA_KEYS.has(r.key) || isOv(r.ov)) ? undefined : fmtDelta(d[r.key]);
    if (stageDelta) {
      els.push(text(7.75, rowY[i], 0.75, 0.55, stageDelta, 10, { bold: true, color: C.deltaGreen, align: 'center', valign: 'middle' }));
    }
  });
  // Delta-chip legend — only when at least one green "+N" chip is visible this run.
  if (anyChip) {
    els.push(text(0.5, 0.72, 6.0, 0.18, deltaLegendText(L, m.deltaBaseline), 8.5, { color: C.deltaGreen, align: 'left', valign: 'middle', rtl: true }));
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
  // Third metric = `incomplete` (orders − results), which is what the 20-07 reference
  // deck shows in BOTH the table and the bar chart (chart1.xml, pristine app output:
  // 295−59=236, 410−383=27, 106−77=29). The النتائج المرفوضة row was removed with it
  // (user decision 2026-07-26 — the reference table is header + 4 rows), so the visible
  // partition is once again orders = results + incomplete, which adds up on the page.
  // The engine still publishes the finer `pending` (orders − results − rejected); it is
  // simply not what this slide reports. monthlyRowRejected stays in both registries.
  const iTot = mo.reduce((s, x) => s + x.incomplete, 0);
  const cPct = oTot > 0 ? Math.round((rTot / oTot) * 1000) / 10 : null; // round1(results/orders*100)
  const cTot = pctMonthly(cPct);
  // logical (deck) order: [label, months…, total]; reverse -> visual L->R
  const header = rev(['المؤشر', ...monthLabels, { text: 'الإجمالي', fill: C.navyDark }]);
  const rowOrders = rev([{ text: L('monthlyRowOrders'), align: 'right' }, ...mo.map((x) => String(x.orders)), { text: String(oTot), fill: bg, bold: true }]);
  const rowResults = rev([{ text: L('monthlyRowResults'), align: 'right' }, ...mo.map((x) => String(x.results)), { text: String(rTot), fill: bg, bold: true }]);
  const rowIncomplete = rev([{ text: L('monthlyRowIncomplete'), align: 'right' }, ...mo.map((x) => String(x.incomplete)), { text: String(iTot), fill: bg, bold: true }]);
  const rowCompletion = rev([{ text: L('monthlyRowCompletion'), align: 'right' }, ...mo.map((x) => pctMonthly(x.completionPct)), { text: cTot, fill: bg, bold: true }]);

  // Column widths: label + N month cols + total over the fixed table width. The
  // canonical 7-month deck keeps its original per-column widths verbatim
  // (pixel-identical); any other count spreads the middle span evenly.
  const MONTH_COLW = [0.623, 0.623, 0.623, 0.561, 0.686, 0.679, 0.679]; // deck OOXML, 7 months
  const LABEL_COLW = 1.312, TOTAL_COLW = 0.874, TABLE_W = 6.661;
  const monthColW = mo.length === MONTH_COLW.length
    ? MONTH_COLW
    : Array(mo.length).fill(Math.round(((TABLE_W - LABEL_COLW - TOTAL_COLW) / mo.length) * 1000) / 1000);

  // TURNAROUND BLOCK — OPT-IN (see OPT_IN_CARDS): the line chart + the navy
  // overall-average card render only when reportOptions.kpiCards.turnaround === true.
  // Default OFF, so the delivered monthly slide is the 20-07 reference shape.
  const showTurnaround = cardOn(m)('turnaround');
  // GEOMETRY, two layouts:
  //  · turnaround ON  — the historic split band: table+bar chart in the upper band
  //    (y≈1.07), line chart + card in the lower band (y 4.583 → 6.972). Byte-identical
  //    to what shipped before the toggle existed, so opting in changes nothing else.
  //  · turnaround OFF — the 20-07 REFERENCE DECK's own placement: table and chart share
  //    ONE top edge at y≈2.194/2.195 (reference graphicFrame offsets, EMU→in). They are
  //    NOT centred independently — centring each on its own height staggered their tops
  //    by 0.33in (table 2.642, chart 2.310), which is the visible mismatch the reference
  //    does not have. Chart 6.0×3.4 → bottom 5.595; table 5×0.456 → bottom 4.474.
  //    The two reference offsets differ by 0.001in (2.194 vs 2.195) — that is the
  //    reference's own rounding, kept verbatim rather than averaged.
  const CHART_H = 3.4;
  const tableY = showTurnaround ? 1.069 : 2.194;     // reference table frame y
  const chartY = showTurnaround ? 1.07 : 2.195;      // reference chart frame y

  const table = {
    t: 'table', x: 6.604, y: tableY, w: TABLE_W, rtl: true, rowH: 0.456,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev([LABEL_COLW, ...monthColW, TOTAL_COLW]),
    rows: [header, rowOrders, rowResults, rowIncomplete, rowCompletion],
  };

  // CATEGORY DIRECTION IS RIGHT-TO-LEFT — oldest month at the RIGHT, newest at the LEFT,
  // so the time axis reads in Arabic order alongside the RTL table beside it. This is the
  // ONE attribute where the 20-07 reference deck is deliberately NOT followed: its chart
  // part (chart1.xml c:cat strCache idx 0..6 = يناير…يوليو) reads LEFT-to-right, but the
  // reference predates the user's later, explicit instruction ("bar chart to be from right
  // to left"), so that instruction overrides the reference here. Categories AND every
  // series' values are reversed in lockstep — reversing only one would relabel the bars.
  // Same treatment on the opt-in turnaround line chart below.
  //
  // HOW THE RTL IS PRODUCED — read this before touching the arrays. The RENDERERS are
  // now RTL-native: charts-svg.js maps category index 0 to the RIGHTMOST band (CAT_DIR)
  // and pptx-renderer.js emits catAxisOrientation 'maxMin', PowerPoint's own reversed
  // category axis. So the spec must hand over categories in NATURAL chronological order
  // (يناير…يوليو) and let the renderer place index 0 on the right. Reversing here as well
  // double-reversed it: the chart came out newest-at-right while the table beside it reads
  // oldest-at-right. Direction is the renderers' single knob (opts.catDir escapes it).
  const monthLabelsRtl = monthLabels;
  const monthlyChart = {
    t: 'chart', kind: 'colClustered', x: 0.5, y: chartY, w: 6.0, h: CHART_H,
    categories: monthLabelsRtl,
    series: [
      { name: L('chartMonthlyOrders'), values: mo.map((x) => x.orders), color: CHART_BLUE },
      { name: L('chartMonthlyResults'), values: mo.map((x) => x.results), color: C.greenBright },
      { name: L('chartMonthlyIncomplete'), values: mo.map((x) => x.incomplete), color: CHART_GRAY },
    ],
    opts: { dataLabels: true, legend: 'bottom' },
  };

  const t = m.kpi.turnaround;
  // Key both series by month over the SAME derived month list as the categories,
  // so a month absent from perMonth becomes a null gap in place (rather than
  // shifting the later months' points left and misaligning the line).
  // RIGHT-TO-LEFT, same as monthlyChart (see its note) — oldest month at the RIGHT.
  const turnaroundChart = {
    t: 'chart', kind: 'line', x: 4.139, y: 4.583, w: 9.139, h: 2.389,
    categories: monthLabelsRtl,
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
    // NOTE: the monthly partition footnote (monthlyPartition) is NOT rendered any more —
    // user decision 2026-07-26 (simpler 20-07 deck shape, no add-up equation notes). The
    // label key stays in both registries for parity.
    monthlyChart,
  ];
  if (showTurnaround) {
    els.push(
      turnaroundChart,
      // Overall-average card — RESTACKED so 3-digit live values never touch: title,
      // actual, expected, variance and sample size each get their own band inside the
      // card (4.583 → 6.972). Actual/expected dropped to 20pt to keep the stack clear.
      rect(0.5, 4.583, 3.417, 2.389, C.navyChart, { radius: 0.1 }),
      text(0.5, 4.66, 3.417, 0.3, L('overallAvgTitle'), 13, { bold: true, color: CARD_TITLE, align: 'center', valign: 'middle', rtl: true }),
      text(0.5, 5.0, 3.417, 0.5, `الفعلي: ${ovActual.toFixed(1)} يوم`, 20, { bold: true, color: C.white, align: 'center', valign: 'middle', rtl: true }),
      text(0.5, 5.55, 3.417, 0.5, `المتوقع: ${ovExpected.toFixed(1)} يوم`, 20, { bold: true, color: C.peach, align: 'center', valign: 'middle', rtl: true }),
    );
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
  }
  return { id: 'monthly', bg: C.white, elements: els };
}

// ============================================================================
// Slide 4 — Compliance measure / late orders
// ============================================================================
// TABLE-ONLY slide (user decision 2026-07-23): the late/on-time detail chart, its band
// divider + heading, and the catalog/overflow notes were removed; the by-lab table now
// grows into the freed space. (The chartLateSeries/chartOnTimeSeries/catalogNote labels
// stay in the registries for parity — harmless orphans.)
// SIMPLIFIED back to the 20-07 reference deck (user decision 2026-07-26): SEVEN columns,
// the '#' index column restored, and the قبل الاستلام / ملتزمة / صدرت متأخرة columns plus
// the add-up equation footnote all removed. Their label keys survive in the registries.
function buildCompliance(m) {
  const L = labelOf(m);
  const lab = m.kpi.byLab;
  // Logical (deck RTL, right→left reading) order per row — matches the reference deck:
  //   [#, lab, total, awaitingResult, rejected, late, latePct]
  // rev() -> visual L→R. Every column total is computed from the rows (no hardcoded
  // literals); latePct total = lateTot/awaitTot (round1, guard div-by-zero).
  const totalTot = lab.reduce((s, r) => s + (r.total || 0), 0);
  const awaitTot = lab.reduce((s, r) => s + (r.awaitingResult || 0), 0);
  const lateTot = lab.reduce((s, r) => s + (r.late || 0), 0);
  const rejTot = lab.reduce((s, r) => s + (r.rejected || 0), 0);
  const latePctTot = awaitTot > 0 ? Math.round((lateTot / awaitTot) * 1000) / 10 : 0;

  // NO conditional body-cell emphasis. The 20-07 reference deck prints EVERY body cell
  // in #1E293B, non-bold — including late=80, 100.0% and 55.6%, i.e. values the
  // red/bold rules would have flagged. Restored to that (user decision 2026-07-26).
  const header = rev([
    L('compHash'), L('compLab'), L('compTotal'), L('compAwaiting'),
    L('compRejected'), L('compLate'), L('compLatePct'),
  ]);
  const labRows = lab.map((r, i) => rev([
    String(i + 1),
    { text: r.lab, align: 'right' },
    String(r.total),
    String(r.awaitingResult),
    String(r.rejected || 0),
    String(r.late),
    pctLab(r.latePct),
  ]));
  // Totals row — '#' cell left blank (as in the reference deck), 'المجموع' in the lab column.
  const totalRow = rev([
    { text: '', bold: true, fill: C.bgLighter },
    { text: 'المجموع', bold: true, fill: C.bgLighter, align: 'right' },
    { text: String(totalTot), bold: true, fill: C.bgLighter },
    { text: String(awaitTot), bold: true, fill: C.bgLighter },
    { text: String(rejTot), bold: true, fill: C.bgLighter },
    { text: String(lateTot), bold: true, fill: C.bgLighter },
    { text: pctLab(latePctTot), bold: true, fill: C.bgLighter },
  ]);

  // colW: the 20-07 REFERENCE DECK's own gridCol widths, EMU→inches (÷914400), in logical
  // (RTL right→left) order. Equal numeric columns are NOT usable here: pptxgenjs applies its
  // default cell margin [.05,.1,.05,.1] in INCHES (vendor/pptxgen.bundle.js Z) and
  // render/pptx-renderer.js addTable passes no `margin`, so a column offers colW−0.2in of
  // text width. 'طلبات مستلمة بانتظار نتيجة' measures 146.8px = 1.529in in Cairo 9pt bold
  // (163.1px = 1.699in at 10pt) — an equal 1.633in column leaves only 1.433in, so PowerPoint
  // wrapped the header to two lines while the HTML/PDF preview (styles/slide.css padding
  // 2px 4px → 1.55in usable) still showed one, i.e. the operator approved a one-line header
  // and the client received a two-line one. The reference widths give that column 2.083in
  // (1.883in usable), so it fits on ONE line at the reference's 10pt in both renderers, and
  // every other header fits too (measured, Cairo 10pt bold, usable = w−0.2):
  //   # 0.556 · المختبر 2.714 (0.427; longest live lab name 2.449in at 10.5pt body)
  //   مجموع الطلبات 1.667 (0.938) · بانتظار نتيجة 2.083 (1.699) · مرفوضة 0.898 (0.519)
  //   الطلبات المتأخرة 1.596 (1.004) · نسبة الطلبات المتأخرة 2.153 (1.351)
  // Sum = 11.667 = the table width, unchanged.
  const COL_W = [0.556, 2.714, 1.667, 2.083, 0.898, 1.596, 2.153];
  // POSITION AND ROW HEIGHT ARE THE 20-07 REFERENCE DECK's (user decision 2026-07-26):
  // frame y = 1959540 EMU = 2.143in, every a:tr h = 251460 EMU = 0.275in, so 9 rows span
  // 2.143 → 4.618. An earlier change pinned the table at y 1.194 and GREW rowH to 0.40 to
  // fill the band freed by deleting the late-by-test chart; the reference does neither —
  // its author moved the surviving table DOWN and left the band below it empty.
  // NO headerSize/bodySize keys: every run in the reference table is 10pt, which is
  // exactly what the renderer's `e.headerSize || 10` / `e.bodySize || 10` defaults give
  // (src/render/pptx-renderer.js). The old stepped font ladder keyed off rowH and would
  // silently drop the header to 8pt and the body to 9pt at rowH 0.275.
  // x stays 0.833 — the principled centre ((13.333 − 11.667)/2); the reference's 0.8165
  // is a 0.017in manual drag, not an authored value.
  const TABLE_Y = 2.143, ROW_H = 0.275;
  const labTable = {
    t: 'table', x: 0.833, y: TABLE_Y, w: 11.667, rtl: true, rowH: ROW_H,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev(COL_W),
    rows: [header, ...labRows, totalRow],
  };

  // Slide is TABLE-ONLY: chrome + the by-lab table. Nothing else — no chart, no band
  // divider, no catalog/overflow/equation notes (matches the 20-07 reference deck).
  const els = [
    ...chrome(L('titleCompliance')),
    labTable,
  ];
  return { id: 'compliance', bg: C.white, elements: els };
}

// ============================================================================
// Slide 5 — Tasks + challenges + risks (variant changes the task ROWS)
// ============================================================================
// Status chip fills as the 20-07 reference build had them — 'مغلق' is C.green (#16A34A);
// the later switch to C.greenBright (#00B050) was a post-reference cosmetic change.
const STATUS_FILL = { 'مستمر': { fill: C.taskNavy, color: C.white }, 'متأخر': { fill: C.redDark, color: C.white }, 'قيد التنفيذ': { fill: C.amberStatus, color: C.black }, 'مغلق': { fill: C.green, color: C.white }, 'مفتوح': { fill: C.slate500, color: C.white } };

// Full-width tasks table. '#' is renumbered by row index (startIndex + i + 1) —
// internal rows do NOT keep their own tk.num (which restarts at 1). startIndex lets a
// continuation slide's '#' CONTINUE (e.g. 16..) instead of restarting at 1. rowH/fonts
// are parametrized.
function taskTable(tasks, { y, rowH, bodySize, headerSize, L, startIndex = 0 }) {
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
      String(startIndex + i + 1),
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

// ---- task-table pagination ---------------------------------------------------
// The internal report's task list is now ALL لين actions (every status incl. مغلق),
// which routinely exceeds the first slide's 15-row block. Rows 1..15 stay on the
// action slide (its '+ N مهمة أخرى' note becomes a small 'يتبع…' continuation marker);
// the remainder flows onto one or more full-band continuation slides.
const TASK_CAP = 15;                       // first-slide task rows
const CONT_CAP = 30;                       // task rows per continuation slide (~30 at min rowH 0.18)
// Two-line date RANGES (e.g. '25-06-2026\n16-07-2026') render ~38px of ink, which needs
// rowH ≈ 0.44 to clear the next row. That cap only engages at ≤12 rows/slide
// (band/13 → 0.44); a 16-row page falls to rowH 0.35 and the stacked dates collide
// (browser Range probe: 15 offenders). So two-line continuation pages carry ≤12 rows
// and spill onto further continuation slides — no truncation, no ink collision.
const CONT_CAP_TWOLINE = 12;               // task rows per continuation slide when dates wrap
const CONT_Y_TOP = 1.0, CONT_Y_BOT = 6.95; // full-band table window
const CONT_BAND = CONT_Y_BOT - CONT_Y_TOP; // 5.95in

// One continuation slide: a full-band task table, same columns/colW as the first
// slide. rowH = clamp(0.18, band/(rows+1), cap) — cap 0.34, raised to 0.44 when any
// row carries a two-line date range (reuses the first-slide adaptive-cap logic so
// stacked date ranges don't collide). The table height = (rows+1)*rowH ≤ band, so it
// never crosses CONT_Y_BOT (6.95). '#' continues from startIndex (16, 46, …).
function buildActionCont(tasks, startIndex, contNo, L) {
  const rowCount = tasks.length;
  const hasTwoLine = tasks.some((t) =>
    Object.values(t || {}).some((v) => typeof v === 'string' && v.includes('\n')));
  const rowCap = hasTwoLine ? 0.44 : 0.34;
  const rowH = Math.max(0.18, Math.min(rowCap, CONT_BAND / (rowCount + 1)));
  const bodySize = rowH >= 0.26 ? 9.5 : rowH >= 0.21 ? 9 : 8;
  const table = taskTable(tasks, { y: CONT_Y_TOP, rowH, bodySize, headerSize: bodySize, L, startIndex });
  return { id: `action-cont-${contNo}`, bg: C.white, elements: [...chrome(L('titleActionCont')), table] };
}

// Returns an ARRAY of slides: [action, action-cont-1, …]. buildSpec flattens it so the
// continuation slides land right after the action slide and pick up sequential footers.
function buildAction(m, variant) {
  const L = labelOf(m);
  // Block 1 — tasks table. nupco = current only; internal appends the internal rows.
  // Internal report = لين-category actions only; NUPCO = the remaining actions.
  const taskRows = variant === 'nupco' ? m.tasksCurrent : m.tasksInternal;
  const n = taskRows.length;
  const CAP = TASK_CAP;
  const shown = Math.min(n, CAP);
  const hasNote = n > CAP;
  // Reserve the marker slot (0.26") out of AREA up front, so the table rows shrink to
  // fit and the 'يتبع…' marker lands ABOVE the support band (starts 4.62). Without this
  // the fixed-height table pushed the marker to y=4.50 (bottom 4.74), overlapping the
  // band. With it, markerY + 0.24 ≤ 4.60. AREA is untouched when there is no overflow,
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
    // Truncation is no longer acceptable for the internal report: rows 16.. move to
    // continuation slides, so the first slide gets a small 'يتبع…' (continued…) marker
    // instead of the old '+ N مهمة أخرى' drop note.
    const markerY = 1.15 + (shown + 1) * rowH;
    els.push(text(0.641, markerY, 12.259, 0.24, 'يتبع…', bodySize, { italic: true, color: C.slate600, align: 'center', valign: 'middle', rtl: true }));
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
    // Title + bullet typography are the 20-07 reference deck's: title 14pt at
    // (0.7, 4.66, 11.9, 0.34), bullets 10.5pt at (0.9, 5.02, 11.7, 0.50) lineSpacing 1.0.
    // They had been shrunk to 11.5pt / 9pt with lineSpacing 0.9 to buy room for a 4th+
    // bullet; SUP_CAP above now handles that overflow instead, so the sizes revert.
    text(0.7, 4.66, 11.9, 0.34, L('supportTitle'), 14, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
    text(0.9, 5.02, 11.7, 0.50, supText, 10.5, { color: C.slate900, align: 'right', valign: 'top', rtl: true, lineSpacing: 1.0 }),
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
    colW: [1.832, 0.406, 1.245, 2.281, 0.235], // 20-07 reference deck's own gridCol widths
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

  const slides = [{ id: 'action', bg: C.white, elements: els }];
  // Continuation slides for rows 16..n. Page size shrinks to CONT_CAP_TWOLINE when ANY
  // continuation row carries a wrapping date range, so those taller rows never collide;
  // otherwise ~30 single-line rows per slide. '#' continues from the row's absolute
  // position (start), so it never restarts at 1.
  const rest = taskRows.slice(CAP);
  const restTwoLine = rest.some((t) =>
    Object.values(t || {}).some((v) => typeof v === 'string' && v.includes('\n')));
  const pageSize = restTwoLine ? CONT_CAP_TWOLINE : CONT_CAP;
  for (let start = CAP, contNo = 1; start < n; start += pageSize, contNo++) {
    slides.push(buildActionCont(taskRows.slice(start, start + pageSize), start, contNo, L));
  }
  return slides;
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
  // EXCEPTION — 'definitions' (منهجية الأرقام) is OPT-IN (user decision 2026-07-26: the
  // deck is back to the simple 6-slide reference shape). It renders ONLY when the flag is
  // explicitly true, so a missing/undefined flag reads as OFF instead of ON.
  const slides = m.reportOptions?.slides;
  const OPT_IN_SLIDES = new Set(['definitions']);
  const on = (key) => (OPT_IN_SLIDES.has(key) ? slides?.[key] === true : (!slides || slides[key] !== false));
  // Each builder returns an ARRAY of slides. Most yield exactly one; buildAction yields
  // the action slide plus zero-or-more continuation slides (task pagination). flatMap
  // splices those inline so continuation slides sit right after the action slide and
  // pick up the sequential post-filter footer numbering automatically.
  const middleDefs = [
    { key: 'execFunnel', build: () => [buildExecFunnel(m)] },
    { key: 'monthly', build: () => [buildMonthly(m)] },
    { key: 'compliance', build: () => [buildCompliance(m)] },
    { key: 'action', build: () => buildAction(m, variant) },
    // Definitions ('منهجية الأرقام') — default OFF (opt-in, see OPT_IN_SLIDES); when the
    // user switches it on in Settings it renders just before thanks and participates in
    // the sequential footer numbering like the other middle slides.
    { key: 'definitions', build: () => [buildDefinitions(m)] },
  ];
  const middle = middleDefs.filter((x) => on(x.key)).flatMap((x) => x.build());
  middle.forEach((s, i) => s.elements.push(pageFooter(i + 1)));
  return [buildCover(m), ...middle, buildThanks(m)];
}

export default buildSpec;
