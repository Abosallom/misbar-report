// test/fixtures/mock-report-model.js
// A complete ReportModel whose numbers/texts EXACTLY match the published
// 09-07-2026 deck (تقرير مسبار 09072026.pptx). Every value here was read from the
// original slide/chart OOXML so the render preview is directly comparable to the deck.
// See src/contracts.js for the ReportModel / EngineOutput typedefs.
import { SCORECARD_SEED } from '../../src/seeds/scorecard.js';

// Late-by-test chart series (verbatim from test/fixtures/late-by-test-chart.json / chart3.xml).
const BY_TEST = [
  { testName: 'Glucagon Plasma', late: 1 },
  { testName: 'HLA PRA Screening', late: 1 },
  { testName: 'HLA PRA II Single Antigen', late: 1 },
  { testName: 'HLA PRA I SA Single Antigen', late: 1 },
  { testName: 'Oligoclonal Banding CSF/Serum', late: 2 },
  { testName: 'GAD65 Ab Assay Serum (RIA)', late: 2 },
  { testName: 'Treponema Pallidum (VDRL)', late: 2 },
  { testName: 'Kidney Stone Analysis (IR)', late: 2 },
  { testName: 'Immunofixation 24h Urine', late: 3 },
  { testName: 'Copper Blood DRC-ICP-MS', late: 4 },
  { testName: 'Urine Protein Electrophoresis 24h', late: 7 },
  { testName: 'Ig Free Light Chain 24h Urine', late: 15 },
  { testName: 'Kappa/Lambda Free Light Chains [Serum]', late: 15 },
];

// Monthly table (slide 4 / chart1). orders − results = incomplete; completionPct = results/orders.
const MONTHLY = [
  { month: '2026-01', orders: 0,   results: 0,   incomplete: 0,  completionPct: null,  cancelled: 8 },
  { month: '2026-02', orders: 0,   results: 0,   incomplete: 0,  completionPct: null,  cancelled: 1 },
  { month: '2026-03', orders: 0,   results: 0,   incomplete: 0,  completionPct: null,  cancelled: 30 },
  { month: '2026-04', orders: 3,   results: 3,   incomplete: 0,  completionPct: 100,   cancelled: 4 },
  { month: '2026-05', orders: 105, results: 90,  incomplete: 15, completionPct: 85.7,  cancelled: 6 },
  { month: '2026-06', orders: 410, results: 341, incomplete: 69, completionPct: 83.2,  cancelled: 4 },
  { month: '2026-07', orders: 100, results: 3,   incomplete: 97, completionPct: 3.0,   cancelled: 0 },
];

// Turnaround (slide 4 / chart2). Only Apr–Jul carry data; Jan–Mar are null gaps.
const TURNAROUND = {
  overallActual: 12.0,
  overallExpected: 7.0,
  perMonth: [
    { month: '2026-01', actual: null, expected: null },
    { month: '2026-02', actual: null, expected: null },
    { month: '2026-03', actual: null, expected: null },
    { month: '2026-04', actual: 20.3, expected: 4.4 },
    { month: '2026-05', actual: 23.3, expected: 7.6 },
    { month: '2026-06', actual: 9.4,  expected: 7.0 },
    { month: '2026-07', actual: 2.0,  expected: 2.5 },
  ],
};

// Late-by-lab table (slide 5).
const BY_LAB = [
  { lab: 'Advanced Laboratory Services .Co',      total: 301, awaitingResult: 89, late: 60, latePct: 67.4 },
  { lab: 'Eurofins clinical',                     total: 27,  awaitingResult: 0,  late: 0,  latePct: 0 },
  { lab: 'king Abdullaziz Medical city in Riyadh',total: 113, awaitingResult: 35, late: 3,  latePct: 8.6 },
  { lab: 'Fal Specialized Medical Lab',           total: 151, awaitingResult: 21, late: 2,  latePct: 9.5 },
  { lab: 'Saudi Diagnostics Limited Company',     total: 19,  awaitingResult: 7,  late: 2,  latePct: 28.6 },
  { lab: 'Anwa  Medical Company',                 total: 7,   awaitingResult: 7,  late: 0,  latePct: 0 },
];

// slide 7 — current (external) tasks.
const TASKS_CURRENT = [
  { num: 1, status: 'مستمر',      dueDate: 'يومي',       owner: 'طلال الدوسري',             responsible: 'لين',        task: 'ارسال تنبيه لعدد من الفحوصات المتأخرة والتي قاربت من نطاق التأخر للمختبرات', category: '', hidden: false },
  { num: 2, status: 'مستمر',      dueDate: 'يومي',       owner: 'أمجد العمري',             responsible: 'نوبكو',      task: 'التواصل مع المختبرات لتوفير الدعم المطلوب لرفع النتائج على المنصة',           category: '', hidden: false },
  { num: 3, status: 'متأخر',      dueDate: '02-07-2026', owner: 'ماهر الشهري / جميل الحربي', responsible: 'لين/نوبكو',  task: 'إعداد خطة Roll-out  إطلاق مسبار خلال 2026',                                  category: '', hidden: false },
  { num: 4, status: 'قيد التنفيذ', dueDate: '20-07-2026', owner: 'أحمد الشنقيطي',            responsible: 'لين',        task: 'مشاركة جاهزية تطبيق الهوية البصرية',                                        category: '', hidden: false },
  { num: 5, status: 'قيد التنفيذ', dueDate: '31-08-2026', owner: 'جميل الحربي / يوسف العنزي', responsible: 'نوبكو/ لين', task: 'تطبيق الهوية البصرية على المنصة',                                           category: '', hidden: false },
  { num: 6, status: 'قيد التنفيذ', dueDate: '12-07-2026', owner: 'جميل الحربي / يوسف العنزي', responsible: 'نوبكو/ لين', task: 'مراجعة الاتفاقية مع فريق القانونية',                                        category: '', hidden: false },
  { num: 7, status: 'قيد التنفيذ', dueDate: '14-07-2026', owner: 'أحمد الشنقيطي',            responsible: 'لين',        task: 'اعداد دليل مستخدم للمختبرات والمستخدمين',                                     category: '', hidden: false },
  { num: 8, status: 'قيد التنفيذ', dueDate: '16-07-2026', owner: 'نوف بن طياش / فهد الحمود',  responsible: 'نوبكو/ لين', task: 'اعتماد شعار المنصة',                                                        category: '', hidden: false },
];

// slide 8 — internal tasks (internalOnly; dropped in the NUPCO variant).
// Deck showed revised due dates struck over originals; we keep the current (revised) date.
const TASKS_INTERNAL = [
  { num: 1, status: 'قيد التنفيذ', dueDate: '16-07-2026', owner: 'عبدالعزيز السلوم', responsible: 'لين', task: 'فصل البنية التحتية التابعة لمسبار عن عيناتي - BE',                        category: 'داخلي', hidden: false },
  { num: 2, status: 'قيد التنفيذ', dueDate: '10-07-2026', owner: 'عبدالعزيز السلوم', responsible: 'لين', task: 'اغلاق الثغرات لنظام عينتي',                                              category: 'داخلي', hidden: false },
  { num: 3, status: 'قيد التنفيذ', dueDate: '09-07-2026', owner: 'عهد القحطاني',     responsible: 'لين', task: 'تحديث أدوار عينتي ومسبار للمختبرات على صحة',                             category: 'داخلي', hidden: false },
  { num: 4, status: 'قيد التنفيذ', dueDate: '09-07-2026', owner: 'عهد القحطاني',     responsible: 'لين', task: 'اعداد قائمة المتطلبات لمنشأة جديدة',                                     category: 'داخلي', hidden: false },
  { num: 5, status: 'قيد التنفيذ', dueDate: '16-07-2026', owner: 'عبدالعزيز السلوم', responsible: 'لين', task: 'اكمال تجهيز API لربط مع المختبرات الخارجية (International Lab)',           category: 'داخلي', hidden: false },
];

// slide 9 — challenges & risks.
const CHALLENGES = [
  { id: 'c1', title: '', desc: 'تأخر في اصدار نتائج من قبل مختبر ALSC', impact: 'متوسط', owner: 'ALSC',                status: '', solution: 'تسريع عملية اصدار النتائج' },
  { id: 'c2', title: '', desc: 'إصدار عدة نتائج خارج نظام مسبار (تم إدخالها في بوابة المختبر المرجعية)', impact: 'حرج', owner: 'المختبرات المرجعية', status: '', solution: 'إلزام المختبرات المرجعية على إدخال النتائج على نظام مسبار' },
  { id: 'c3', title: '', desc: 'عدم التزام GENALIVE و SMC بإنشاء العقود', impact: 'عالي', owner: 'GENALIVE / SMC',      status: '', solution: 'إلزام المختبرات بإنشاء العقود' },
];

const RISKS = [
  { id: 'r1', title: '', desc: 'تأخر في اكتمال دورة كاملة في مسبار', probability: 'عالي', impact: 'عالي', owner: 'نوبكو/لين', status: '' },
];

/** @type {import('../../src/contracts.js').ReportModel} */
export const MOCK_REPORT_MODEL = {
  reportDate: '2026-07-09',
  kpi: {
    totals: { lines: 671, cancelledInData: 53, total: 618 },
    funnel: { created: 618, collected: 612, dispatched: 608, received: 596, resulted: 437 },
    buckets: {
      awaitingDispatch: 10,        // 10 — في انتظار شحن العينة (المستشفى)
      shippedNotReceived: 12,      // 12 — شُحنت ولم تُستلم
      awaitingResults: 159,        // 159 — في انتظار نتائج العينة (المختبر)
      completed: 437,              // 437 — نتائج مكتملة
      lateNoResult: 67,            // 67 — الطلبات المتأخرة
      latePct: 42.1,
    },
    monthly: MONTHLY,
    cancelledNote: 53,             // * 53 طلب ملغي  (8+1+30+4+6+4)
    turnaround: TURNAROUND,
    byLab: BY_LAB,
    byTest: BY_TEST,
    unmatchedTests: [],
    deltas: { completed: 47 },     // +47 vs previous snapshot
  },
  panels: {
    completedTasks: [
      'إنهاء شعار مسبار على المنصة',
      'ضمان إشراك ZATCA و PHA كأصحاب مصلحة رئيسيين من خلال EA-MOH',
      'تم إشعار المختبرات بالفحوصات المتأخرة',
    ],
    plannedTasks: [
      'المتابعة إكمال رحلة طلب مسبار لبقية الطلبات مع مختبر مدينة الملك عبدالله والمختبرات المرجعية',
    ],
    supportRequired: [
      'الزام GENALIVE و SMC برفع العقود وذلك لتمكين KAMC للقيام بطلب الفحوصات',
      'الزام المختبرات المرجعية بتسجيل العينات في نظام مسبار فور استلامها من KAMC',
      'الزام المختبرات المرجعية بإدخال النتائج المكتملة في نظام مسبار',
    ],
  },
  tasksCurrent: TASKS_CURRENT,
  tasksInternal: TASKS_INTERNAL,
  challenges: CHALLENGES,
  risks: RISKS,
  scorecard: SCORECARD_SEED,
  displayNames: {}, // BY_TEST already carries short chart labels
};

export default MOCK_REPORT_MODEL;
