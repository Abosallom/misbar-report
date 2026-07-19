// test/fixtures/golden-expected.js — the PUBLISHED 09-07-2026 KAMC report numbers.
// This is the independent oracle: values transcribed from the source workbook's
// Summary Tables (test/fixtures/summary-tables.json cached results) and the
// published chart (test/fixtures/late-by-test-chart.json). The engine must
// reproduce every field below EXACTLY. Do not "fix" these to match the engine —
// they are ground truth.
//
// Report configuration for the golden run (matches the workbook + first-run seeds):
//   asOf = 2026-07-09  (the sheet's TODAY(); reproduces all 596 cached Delays)
//   cancelledByMonth   = MANUAL additive constants only (Jan–Apr); May/June come
//                        from the CSV data (6 + 4). Additive per C6:
//                        cancelled(m) = countedFromCsv(m) + manual[m].
//   tatFallbackFromCsv = true ; prevCompleted = 375 (legacy baseline; the engine
//                        folds it into deltas.completed when no snapshot.numbers).

export const GOLDEN_ASOF = '2026-07-09';

// Manual additive map ONLY (May/June removed — the 10 in-data cancels supply
// them). Aggregate monthly cancelled stays 8/1/30/4/6/4, note 53.
export const GOLDEN_CANCELLED_BY_MONTH = {
  '2026-01': 8, '2026-02': 1, '2026-03': 30, '2026-04': 4,
};

export const GOLDEN_PREV_COMPLETED = 422; // == current completed (dated-only rule) → main golden run expects zero deltas

export const GOLDEN_EXPECTED = {
  totals: { lines: 628, cancelledInData: 10, total: 618 },

  funnel: { created: 618, collected: 612, dispatched: 608, received: 596, resulted: 422 }, // dated-only rule (2026-07-19): rejected no longer counted

  buckets: {
    awaitingDispatch: 10,
    shippedNotReceived: 12,
    awaitingResults: 159,
    completed: 422,
    lateNoResult: 67,
    latePct: 42.1,
  },

  // order-month, excl. cancelled; cancelled = merged max(stored, computed-in-data)
  monthly: [
    { month: '2026-01', orders: 0, results: 0, incomplete: 0, completionPct: null, cancelled: 8 },
    { month: '2026-02', orders: 0, results: 0, incomplete: 0, completionPct: null, cancelled: 1 },
    { month: '2026-03', orders: 0, results: 0, incomplete: 0, completionPct: null, cancelled: 30 },
    { month: '2026-04', orders: 3, results: 3, incomplete: 0, completionPct: 100, cancelled: 4 },
    { month: '2026-05', orders: 105, results: 76, incomplete: 29, completionPct: 72.4, cancelled: 6 },
    { month: '2026-06', orders: 410, results: 340, incomplete: 70, completionPct: 82.9, cancelled: 4 },
    { month: '2026-07', orders: 100, results: 3, incomplete: 97, completionPct: 3.0, cancelled: 0 },
  ],
  monthlyTotals: { orders: 618, results: 422, incomplete: 196, completionPct: 68.3 },
  cancelledNote: 53,

  // resulted rows excl. Rejected (n = 422); 1-decimal report rounding
  turnaround: {
    overallActual: 12.0,
    overallExpected: 7.0,
    measuredCount: 422,
    perMonth: [
      { month: '2026-04', actual: 20.3, expected: 4.4 },
      { month: '2026-05', actual: 23.3, expected: 7.6 },
      { month: '2026-06', actual: 9.4, expected: 7.0 },
      { month: '2026-07', actual: 2.0, expected: 2.5 },
    ],
  },

  // facility-normalized, excl. cancelled; sorted total-desc (workbook table order).
  // latePct = late / awaitingResult (0 when awaitingResult = 0).
  byLab: [
    { lab: 'Advanced Laboratory Services .Co', total: 301, awaitingResult: 89, late: 60, latePct: 67.4 },
    { lab: 'Fal Specialized Medical Lab', total: 151, awaitingResult: 21, late: 2, latePct: 9.5 },
    { lab: 'king Abdullaziz Medical city in Riyadh', total: 113, awaitingResult: 35, late: 3, latePct: 8.6 },
    { lab: 'Eurofins clinical', total: 27, awaitingResult: 0, late: 0, latePct: 0 },
    { lab: 'Saudi Diagnostics Limited Company', total: 19, awaitingResult: 7, late: 2, latePct: 28.6 },
    { lab: 'Anwa Medical Company', total: 7, awaitingResult: 7, late: 0, latePct: 0 },
  ],
  byLabTotals: { total: 618, awaitingResult: 159, late: 67, latePct: 42.1 },

  // curated catalog restricted, late>0, ascending (ties: reverse catalog order).
  // Sums to 56 across 13 tests (11 late lines on 9 non-catalog tests are omitted
  // by the workbook's design — see engine.js buildByTest / tat.js catalog).
  byTest: [
    { testName: 'SEND OUT TEST GLUCAGON PLASMA EIA', late: 1 },
    { testName: 'SEND OUT TEST HLA PRA SCREENING SERUM ELISA', late: 1 },
    { testName: 'SEND OUT TEST HLA PRA II SINGLE ANTIGEN SERUM ELISA', late: 1 },
    { testName: 'SEND OUT TEST HLA PRA I SA SINGLE ANTIGEN SERUM ELISA', late: 1 },
    { testName: 'SEND OUT TEST OLIGOCLONAL BANDING CSF AND SERUM TEST IMMUNOBLOT (IB)', late: 2 },
    { testName: 'SEND OUT TEST GAD65 AB ASSAY SERUM RADIOIMMUNOASSAY (RIA)', late: 2 },
    { testName: 'SEND OUT TEST TREPONEMA PALLIDUM (VDRL) ABS IGG IGM BLOOD EIA', late: 2 },
    { testName: 'SEND OUT TEST KIDNEY STONE ANALYSIS INFRARED SPECTRUM ANALYSIS', late: 2 },
    { testName: 'SEND OUT TEST IMMUNOFIXATION 24 HOUR URINE TURBIDIMETRIC IMMUNOASSAY', late: 3 },
    { testName: 'SEND OUT TEST COPPER BLOOD DRC-ICP-MS', late: 4 },
    { testName: 'SEND OUT TEST URINE ELECTROPHORESIS PROTEIN ELECTROPHORESIS 24 HOUR URINE', late: 7 },
    { testName: 'SEND OUT TEST IMMUNOGLOBULIN FREE LIGHT CHAIN 24 HOURS URINE NEPHELOMETRY', late: 15 },
    { testName: 'Kappa light chains.free/Lambda light chains.free [Mass Ratio] in Serum', late: 15 },
  ],
  byTestSum: 56,

  unmatchedTests: [], // every test in the data resolves in the TAT lookup

  // Full deltas set (E6). The golden run's baseline is the legacy prevCompleted
  // (422 == current completed) folded into numbers.completed; every key resolves
  // to a non-increase, so all nine deltas are 0.
  deltas: {
    total: 0,
    collected: 0,
    dispatched: 0,
    received: 0,
    completed: 0,
    awaitingDispatch: 0,
    shippedNotReceived: 0,
    awaitingResults: 0,
    lateNoResult: 0,
  },
};

export default GOLDEN_EXPECTED;
