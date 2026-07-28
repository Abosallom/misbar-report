// test/fixtures/mock-report-model.js
// A complete ReportModel whose numbers/texts match the published 09-07-2026 deck
// (تقرير مسبار 09072026.pptx). Every value here was read from the original
// slide/chart OOXML so the render preview is directly comparable to the deck.
// See src/contracts.js for the ReportModel / EngineOutput typedefs.
//
// RE-BASELINED 2026-07-28 — "consider rejected as completed test" (user decision):
// completed = non-cancelled AND (has a result date OR is rejected), so the 15
// rejected lines are now INSIDE completed and the deck's 422 publishes as 437.
// Touched here: buckets.completed, funnel.resulted/completed, MONTHLY
// results/pending/incomplete/completionPct, BY_LAB completed/resulted (+ the
// pipeline/resultedLate split those pin). Deliberately UNCHANGED: totals,
// buckets.rejected (15, now a SUBSET of completed), byLab onTime/rejected/late,
// TURNAROUND (a rejected row has no result timestamp to measure), byTest,
// cancelledNote. The figures match test/fixtures/golden-expected.js for the same
// data, so the preview and the golden oracle cannot drift apart.
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

// Monthly table (slide 4 / chart1). PARTITION: orders = results + pending, with
// pending === incomplete === orders − results and completionPct = results/orders.
// RE-BASELINED 2026-07-28 with the rest of this fixture ("consider rejected as
// completed test"): `results` is now the COMPLETED count (a result date OR a
// rejection), so the 15 rejected lines ({05:14, 06:1}) moved INTO results —
// May 76→90, Jun 340→341, total 422→437 — and out of incomplete, which no longer
// double-counts them (May 29→15, Jun 70→69, total 196→181). completionPct follows
// (May 72.4→85.7, Jun 82.9→83.2; the rendered total 68.3%→70.7%). `rejected` stays
// as its own per-month value but is now a SUBSET of results, never an addend.
// These are GOLDEN_EXPECTED.monthly's numbers, so the preview's monthly row total
// (437) equals the exec 'فحوصات مكتملة' card, the funnel's last stage and the
// compliance completed column.
const MONTHLY = [
  { month: '2026-01', orders: 0,   results: 0,   rejected: 0,  pending: 0,  incomplete: 0,  completionPct: null,  cancelled: 8 },
  { month: '2026-02', orders: 0,   results: 0,   rejected: 0,  pending: 0,  incomplete: 0,  completionPct: null,  cancelled: 1 },
  { month: '2026-03', orders: 0,   results: 0,   rejected: 0,  pending: 0,  incomplete: 0,  completionPct: null,  cancelled: 30 },
  { month: '2026-04', orders: 3,   results: 3,   rejected: 0,  pending: 0,  incomplete: 0,  completionPct: 100,   cancelled: 4 },
  { month: '2026-05', orders: 105, results: 90,  rejected: 14, pending: 15, incomplete: 15, completionPct: 85.7,  cancelled: 6 },
  { month: '2026-06', orders: 410, results: 341, rejected: 1,  pending: 69, incomplete: 69, completionPct: 83.2,  cancelled: 4 },
  { month: '2026-07', orders: 100, results: 3,   rejected: 0,  pending: 97, incomplete: 97, completionPct: 3.0,   cancelled: 0 },
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

// Late-by-lab table (slide 4 compliance). HEADLINE PARTITION, per contracts.js byLab:
//   total = pipeline + awaitingResult + completed
// where pipeline = قبل الاستلام (not yet received by the lab) and completed = فحوصات
// مكتملة (a result date OR a rejection — the terminal lab outcomes, user decision
// 2026-07-28). Beneath it, all SUBSETS of completed and never added alongside it:
//   completed = resulted + rejected ;  resulted = onTime + resultedLate
// so the old 5-way identity (pipeline + awaitingResult + onTime + resultedLate +
// rejected = total) still holds exactly — completed just groups its last three.
// 'late' (منها متأخرة) is a SUBSET of awaitingResult (overdue, still awaiting) and is
// NOT part of any sum; latePct = late / awaitingResult.
// FIXED 2026-07-28: these rows previously carried neither `completed` nor `resulted`,
// so build-spec's completedOf() fell back to onTime + resultedLate + rejected and the
// compliance totals row printed 266 while the exec card, the funnel's last stage and
// the monthly row all printed the deck's 422 — a 156 disagreement on the very page
// (test/render-preview.html) the compliance column widths are measured against. The
// per-row pipeline/resultedLate split was the cause: it was DERIVED here as an
// arbitrary split of each row's residual and summed to pipeline 193 / resultedLate 81,
// i.e. resulted 251, which contradicted the deck's own 422. The rows below are
// GOLDEN_EXPECTED.byLab's (the engine's real split for this data), which keeps every
// deck column sum — total 618, awaitingResult 159, onTime 170, rejected 15, late 67
// (latePct 42.1) — and pins the rest: pipeline 22, resultedLate 252, resulted 422 and
// completed 437, so all four "completed" surfaces now print the same 437.
// Row ORDER and lab-name spelling stay the deck's (incl. 'Anwa  Medical Company').
const BY_LAB = [
  { lab: 'Advanced Laboratory Services .Co',      total: 301, pipeline: 11, awaitingResult: 89, completed: 201, onTime: 29, resulted: 187, resultedLate: 158, rejected: 14, late: 60, latePct: 67.4 },
  { lab: 'Eurofins clinical',                     total: 27,  pipeline: 3,  awaitingResult: 0,  completed: 24,  onTime: 20, resulted: 24,  resultedLate: 4,   rejected: 0,  late: 0,  latePct: 0 },
  { lab: 'king Abdullaziz Medical city in Riyadh',total: 113, pipeline: 1,  awaitingResult: 35, completed: 77,  onTime: 42, resulted: 77,  resultedLate: 35,  rejected: 0,  late: 3,  latePct: 8.6 },
  { lab: 'Fal Specialized Medical Lab',           total: 151, pipeline: 6,  awaitingResult: 21, completed: 124, onTime: 75, resulted: 123, resultedLate: 48,  rejected: 1,  late: 2,  latePct: 9.5 },
  { lab: 'Saudi Diagnostics Limited Company',     total: 19,  pipeline: 1,  awaitingResult: 7,  completed: 11,  onTime: 4,  resulted: 11,  resultedLate: 7,   rejected: 0,  late: 2,  latePct: 28.6 },
  { lab: 'Anwa  Medical Company',                 total: 7,   pipeline: 0,  awaitingResult: 7,  completed: 0,   onTime: 0,  resulted: 0,   resultedLate: 0,   rejected: 0,  late: 0,  latePct: 0 },
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
    // Matches golden-expected: 618 live + 10 cancelled rows counted from the CSV =
    // 628 lines. cancelledNote (53) − cancelledInData (10) = 43 historical (pre-April)
    // cancellations from the manual constants, surfaced in the exec cancelled note.
    totals: { lines: 628, cancelledInData: 10, total: 618 },
    // Final stage = COMPLETED (result date OR rejected), 2026-07-28: 422 → 437.
    // `resulted` is the LEGACY ALIAS of `completed` and carries the SAME number (the
    // 'funnel.resulted' override key reads it), so the funnel's last stage can never
    // disagree with the exec KPI card. Never add the two.
    funnel: { created: 618, collected: 612, dispatched: 608, received: 596, resulted: 437, completed: 437 },
    buckets: {
      awaitingDispatch: 10,        // 10 — في انتظار شحن العينة (المستشفى)
      shippedNotReceived: 12,      // 12 — شُحنت ولم تُستلم
      awaitingResults: 159,        // 159 — في انتظار نتائج العينة (المختبر)
      // 422 (dated) + 15 (rejected) = 437 — rejection is a terminal lab outcome
      // (2026-07-28). PARTITION: 10 + 12 + 159 + 437 = 618 = totals.total.
      completed: 437,              // 437 — فحوصات مكتملة (تشمل المرفوضة)
      rejected: 15,                // 15 — النتائج المرفوضة، الآن مجموعة جزئية من المكتملة
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
    // Left at +47 through the 2026-07-28 re-baseline ON PURPOSE — it is presentation
    // data, not a partition term, and it is the only non-zero delta in this fixture,
    // so it is what keeps the preview exercising the KPI delta-chip render path. The
    // card simply reads '437 · +47 · تشمل المرفوضة' instead of '422 · +47 · …'.
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
