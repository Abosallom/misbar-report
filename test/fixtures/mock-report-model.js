// test/fixtures/mock-report-model.js
// A complete ReportModel whose numbers/texts EXACTLY match the published
// 09-07-2026 deck (تقرير مسبار 09072026.pptx). Every value here was read from the
// original slide/chart OOXML so the render preview is directly comparable to the deck.
// See src/contracts.js for the ReportModel / EngineOutput typedefs.
import { SCORECARD_SEED } from '../../src/seeds/scorecard.js';

// Late-by-test chart series (late values verbatim from chart3.xml). Each entry now
// also carries onTime (results delivered within due) per contracts.js byTest shape.
// The 13 historic late tests had no on-time volume (onTime 0); the on-time-only
// catalog tests below are PREPENDED so the array stays sorted late-ascending
// (late 0 first), matching the engine's "late asc, catalog-idx desc" contract.
const BY_TEST_LATE = [
  { testName: 'Glucagon Plasma', late: 1, onTime: 0 },
  { testName: 'HLA PRA Screening', late: 1, onTime: 0 },
  { testName: 'HLA PRA II Single Antigen', late: 1, onTime: 0 },
  { testName: 'HLA PRA I SA Single Antigen', late: 1, onTime: 0 },
  { testName: 'Oligoclonal Banding CSF/Serum', late: 2, onTime: 0 },
  { testName: 'GAD65 Ab Assay Serum (RIA)', late: 2, onTime: 0 },
  { testName: 'Treponema Pallidum (VDRL)', late: 2, onTime: 0 },
  { testName: 'Kidney Stone Analysis (IR)', late: 2, onTime: 0 },
  { testName: 'Immunofixation 24h Urine', late: 3, onTime: 0 },
  { testName: 'Copper Blood DRC-ICP-MS', late: 4, onTime: 0 },
  { testName: 'Urine Protein Electrophoresis 24h', late: 7, onTime: 0 },
  { testName: 'Ig Free Light Chain 24h Urine', late: 15, onTime: 0 },
  { testName: 'Kappa/Lambda Free Light Chains [Serum]', late: 15, onTime: 0 },
];
// On-time-only catalog tests (late 0, onTime > 0) — the "success" stories surfaced
// alongside the late data on the compliance slide.
const BY_TEST_ONTIME = [
  { testName: 'Calprotectin', late: 0, onTime: 75 },
  { testName: 'BK Virus', late: 0, onTime: 20 },
  { testName: 'HLA Class II NGS', late: 0, onTime: 10 },
  { testName: 'HLA Class I NGS', late: 0, onTime: 9 },
  { testName: 'Renal Pathology', late: 0, onTime: 6 },
  { testName: 'HLA Flow Cross Match', late: 0, onTime: 5 },
  { testName: 'Epilepsy Panel Serum', late: 0, onTime: 3 },
];
const BY_TEST = [...BY_TEST_ONTIME, ...BY_TEST_LATE];

// Monthly table (slide 4 / chart1). orders − results = incomplete; completionPct = results/orders.
const MONTHLY = [
  { month: '2026-01', orders: 0,   results: 0,   rejected: 0,  incomplete: 0,  completionPct: null,  cancelled: 8 },
  { month: '2026-02', orders: 0,   results: 0,   rejected: 0,  incomplete: 0,  completionPct: null,  cancelled: 1 },
  { month: '2026-03', orders: 0,   results: 0,   rejected: 0,  incomplete: 0,  completionPct: null,  cancelled: 30 },
  { month: '2026-04', orders: 3,   results: 3,   rejected: 0,  incomplete: 0,  completionPct: 100,   cancelled: 4 },
  { month: '2026-05', orders: 105, results: 76,  rejected: 14, incomplete: 29, completionPct: 72.4,  cancelled: 6 },
  { month: '2026-06', orders: 410, results: 340, rejected: 1,  incomplete: 70, completionPct: 82.9,  cancelled: 4 },
  { month: '2026-07', orders: 100, results: 3,   rejected: 0,  incomplete: 97, completionPct: 3.0,   cancelled: 0 },
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

// Late-by-lab table (slide 5). onTime = results delivered within due (sum 170).
const BY_LAB = [
  { lab: 'Advanced Laboratory Services .Co',      total: 301, awaitingResult: 89, onTime: 29, rejected: 14, late: 60, latePct: 67.4 },
  { lab: 'Eurofins clinical',                     total: 27,  awaitingResult: 0,  onTime: 20, rejected: 0,  late: 0,  latePct: 0 },
  { lab: 'king Abdullaziz Medical city in Riyadh',total: 113, awaitingResult: 35, onTime: 42, rejected: 0,  late: 3,  latePct: 8.6 },
  { lab: 'Fal Specialized Medical Lab',           total: 151, awaitingResult: 21, onTime: 75, rejected: 1,  late: 2,  latePct: 9.5 },
  { lab: 'Saudi Diagnostics Limited Company',     total: 19,  awaitingResult: 7,  onTime: 4,  rejected: 0,  late: 2,  latePct: 28.6 },
  { lab: 'Anwa  Medical Company',                 total: 7,   awaitingResult: 7,  onTime: 0,  rejected: 0,  late: 0,  latePct: 0 },
];

// slide 7 — current (external) tasks. PLACEHOLDER content (public repo):
// same row counts, statuses, and date shapes as the reference deck, but names
// and task texts are generic — real content comes from the dropped Tracker.
const TASKS_CURRENT = [
  { num: 1, status: 'مستمر',      dueDate: 'يومي',       owner: 'مسؤول أ',        responsible: 'لين',        task: 'مهمة تشغيلية يومية تجريبية للمعاينة', category: '', hidden: false },
  { num: 2, status: 'مستمر',      dueDate: 'يومي',       owner: 'مسؤول ب',        responsible: 'نوبكو',      task: 'مهمة تشغيلية يومية تجريبية ثانية',    category: '', hidden: false },
  { num: 3, status: 'متأخر',      dueDate: '02-07-2026', owner: 'مسؤول ج / مسؤول د', responsible: 'لين/نوبكو',  task: 'مهمة تجريبية متأخرة عن موعدها',       category: '', hidden: false },
  { num: 4, status: 'قيد التنفيذ', dueDate: '20-07-2026', owner: 'مسؤول هـ',       responsible: 'لين',        task: 'مهمة تجريبية قيد التنفيذ ١',          category: '', hidden: false },
  { num: 5, status: 'قيد التنفيذ', dueDate: '31-08-2026', owner: 'مسؤول د / مسؤول و', responsible: 'نوبكو/ لين', task: 'مهمة تجريبية قيد التنفيذ ٢',          category: '', hidden: false },
  { num: 6, status: 'قيد التنفيذ', dueDate: '12-07-2026', owner: 'مسؤول د / مسؤول و', responsible: 'نوبكو/ لين', task: 'مهمة تجريبية قيد التنفيذ ٣',          category: '', hidden: false },
  { num: 7, status: 'قيد التنفيذ', dueDate: '14-07-2026', owner: 'مسؤول هـ',       responsible: 'لين',        task: 'مهمة تجريبية قيد التنفيذ ٤',          category: '', hidden: false },
  { num: 8, status: 'قيد التنفيذ', dueDate: '16-07-2026', owner: 'مسؤول ز / مسؤول ح', responsible: 'نوبكو/ لين', task: 'مهمة تجريبية قيد التنفيذ ٥',          category: '', hidden: false },
];

// slide 8 — internal tasks (internalOnly; dropped in the NUPCO variant). PLACEHOLDER.
const TASKS_INTERNAL = [
  { num: 1, status: 'قيد التنفيذ', dueDate: '16-07-2026', owner: 'مسؤول أ', responsible: 'لين', task: 'مهمة داخلية تجريبية ١', category: 'داخلي', hidden: false },
  { num: 2, status: 'قيد التنفيذ', dueDate: '10-07-2026', owner: 'مسؤول أ', responsible: 'لين', task: 'مهمة داخلية تجريبية ٢', category: 'داخلي', hidden: false },
  { num: 3, status: 'قيد التنفيذ', dueDate: '09-07-2026', owner: 'مسؤول ب', responsible: 'لين', task: 'مهمة داخلية تجريبية ٣', category: 'داخلي', hidden: false },
  { num: 4, status: 'قيد التنفيذ', dueDate: '09-07-2026', owner: 'مسؤول ب', responsible: 'لين', task: 'مهمة داخلية تجريبية ٤', category: 'داخلي', hidden: false },
  { num: 5, status: 'قيد التنفيذ', dueDate: '16-07-2026', owner: 'مسؤول أ', responsible: 'لين', task: 'مهمة داخلية تجريبية ٥', category: 'داخلي', hidden: false },
];

// slide 9 — challenges & risks. PLACEHOLDER.
const CHALLENGES = [
  { id: 'c1', title: '', desc: 'تحدٍ تجريبي أول للمعاينة',  impact: 'متوسط', owner: 'جهة أ', status: '', solution: 'إجراء وقائي تجريبي أول' },
  { id: 'c2', title: '', desc: 'تحدٍ تجريبي ثانٍ للمعاينة', impact: 'حرج',   owner: 'جهة ب', status: '', solution: 'إجراء وقائي تجريبي ثانٍ' },
  { id: 'c3', title: '', desc: 'تحدٍ تجريبي ثالث للمعاينة', impact: 'عالي',  owner: 'جهة ج', status: '', solution: 'إجراء وقائي تجريبي ثالث' },
];

const RISKS = [
  { id: 'r1', title: '', desc: 'خطر تجريبي للمعاينة', probability: 'عالي', impact: 'عالي', owner: 'نوبكو/لين', status: '' },
];

/** @type {import('../../src/contracts.js').ReportModel} */
export const MOCK_REPORT_MODEL = {
  reportDate: '2026-07-09',
  kpi: {
    totals: { lines: 671, cancelledInData: 53, total: 618 },
    funnel: { created: 618, collected: 612, dispatched: 608, received: 596, resulted: 422 },
    buckets: {
      awaitingDispatch: 10,        // 10 — في انتظار شحن العينة (المستشفى)
      shippedNotReceived: 12,      // 12 — شُحنت ولم تُستلم
      awaitingResults: 159,        // 159 — في انتظار نتائج العينة (المختبر)
      completed: 422,              // 422 — نتائج مكتملة (dated-only rule)
      rejected: 15,                // 15 — النتائج المرفوضة من المختبر
      lateNoResult: 67,            // 67 — الطلبات المتأخرة
      latePct: 42.1,
    },
    monthly: MONTHLY,
    cancelledNote: 53,             // * 53 طلب ملغي  (8+1+30+4+6+4)
    turnaround: TURNAROUND,
    byLab: BY_LAB,
    byTest: BY_TEST,
    unmatchedTests: [],
    // Full delta set (matches the published 09-07 deck): only completed moved +47.
    deltas: { total: 0, collected: 0, dispatched: 0, received: 0, completed: 47, rejected: 0, awaitingDispatch: 0, shippedNotReceived: 0, awaitingResults: 0, lateNoResult: 0 },
  },
  panels: { // PLACEHOLDER bullets (public repo) — real content is auto-drafted from the Tracker
    completedTasks: [
      'بند منجز تجريبي أول للمعاينة',
      'بند منجز تجريبي ثانٍ للمعاينة',
      'بند منجز تجريبي ثالث للمعاينة',
    ],
    plannedTasks: [
      'بند مخطط له تجريبي للمعاينة يمتد على سطرٍ كامل تقريباً',
    ],
    supportRequired: [
      'بند دعم مطلوب تجريبي أول للمعاينة',
      'بند دعم مطلوب تجريبي ثانٍ للمعاينة',
      'بند دعم مطلوب تجريبي ثالث للمعاينة',
    ],
  },
  tasksCurrent: TASKS_CURRENT,
  tasksInternal: TASKS_INTERNAL,
  challenges: CHALLENGES,
  risks: RISKS,
  scorecard: SCORECARD_SEED,
  displayNames: {}, // BY_TEST already carries short chart labels
  // Presentation options unset (undefined) → build-spec applies its defaults: all 6
  // slides on, all 7 KPI cards on, DEFAULT_LABELS text. No manual number overrides.
  // Both fields are the byte-stable "defaults" case, so the mock render is unchanged.
  reportOptions: undefined,
  overrides: {},
};

export default MOCK_REPORT_MODEL;
