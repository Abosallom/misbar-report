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
//
// ─────────────────────────────────────────────────────────────────────────────
// DEFINITION CHANGE 2026-07-28 — "consider rejected as completed test"
//   OLD: completed = 422  (non-cancelled rows WITH a Result report date only)
//   NEW: completed = 437  (non-cancelled AND (has a result date OR rejected))
//   DELTA: exactly +15 — the 15 rejected rows in this fixture ({05:14, 06:1}),
//          every one of which has a BLANK result date, so there is no overlap and
//          no double count. 422 + 15 = 437.
//   REASON: the user's decision — rejection is a lab's FINAL outcome for a test,
//          so a rejected line is finished work, not work in progress.
//   THIS IS A DELIBERATE RE-BASELINE OF THE PUBLISHED 09-07 DECK, NOT A
//   REGRESSION. The published deck printed 422 under the old (2026-07-19)
//   dated-only rule; the same rows now publish 437.
//   Fields re-baselined below: funnel.resulted/funnel.completed, buckets.completed,
//   monthly.results/incomplete/completionPct (+ monthlyTotals), byLab.completed
//   (new column) + byLabTotals.completed, GOLDEN_PREV_COMPLETED.
//   Fields deliberately UNCHANGED: byLab.resulted / onTime / resultedLate (still
//   the dated-only split, now subsets of completed), buckets.rejected (15, now a
//   SUBSET of completed), turnaround.measuredCount (422 — a rejected row has no
//   result timestamp to measure), byTest, totals, cancelledNote.
// ─────────────────────────────────────────────────────────────────────────────

export const GOLDEN_ASOF = '2026-07-09';

// Manual additive map ONLY (May/June removed — the 10 in-data cancels supply
// them). Aggregate monthly cancelled stays 8/1/30/4/6/4, note 53.
export const GOLDEN_CANCELLED_BY_MONTH = {
  '2026-01': 8, '2026-02': 1, '2026-03': 30, '2026-04': 4,
};

// == current completed (rejected-as-completed rule, 2026-07-28) → the main golden
// run still expects zero deltas. Was 422 under the dated-only rule.
export const GOLDEN_PREV_COMPLETED = 437;

export const GOLDEN_EXPECTED = {
  totals: { lines: 628, cancelledInData: 10, total: 618 },

  // Final stage = COMPLETED (result date OR rejected), 2026-07-28: 422 → 437.
  // `resulted` is the legacy alias of `completed` and carries the SAME number, so
  // the funnel's last stage can never disagree with the exec KPI card.
  funnel: { created: 618, collected: 612, dispatched: 608, received: 596, resulted: 437, completed: 437 },

  buckets: {
    awaitingDispatch: 10,
    shippedNotReceived: 12,
    awaitingResults: 159,
    // 422 (dated) + 15 (rejected) = 437 — rejected is a terminal outcome (2026-07-28).
    // PARTITION: 10 + 12 + 159 + 437 = 618 = totals.total.
    completed: 437,
    rejected: 15, // own value; now a SUBSET of completed. {05:14, 06:1}
    // RE-BASELINED 2026-08-05 (rule 2, late = due today or overdue): 67 → 73.
    // The 6 added rows are due exactly ON asOf 2026-07-09 with no result. The
    // weekend flip (rule 1) alone left this at 67 on this fixture — every golden
    // due date it moved is far in the past relative to asOf.
    lateNoResult: 73,
    latePct: 45.9, // 73/159; was 42.1 (67/159). Denominator awaitingResults unchanged.
  },

  // order-month, excl. cancelled; cancelled = additive (in-data + manual constant).
  // `results` = the COMPLETED rule (result date OR rejected), 2026-07-28 — May
  // 76→90, Jun 340→341, total 422→437. PARTITION: orders = results + pending.
  // `rejected` stays as its own per-month value but is a SUBSET of results, so it
  // is no longer a partition term. `pending` and `incomplete` are now identical
  // (both orders − results); incomplete no longer double-counts rejected, hence
  // May 29→15, Jun 70→69, total 196→181. completionPct = results/orders → May
  // 72.4→85.7, Jun 82.9→83.2, total 68.3→70.7.
  monthly: [
    { month: '2026-01', orders: 0, results: 0, rejected: 0, pending: 0, incomplete: 0, completionPct: null, cancelled: 8 },
    { month: '2026-02', orders: 0, results: 0, rejected: 0, pending: 0, incomplete: 0, completionPct: null, cancelled: 1 },
    { month: '2026-03', orders: 0, results: 0, rejected: 0, pending: 0, incomplete: 0, completionPct: null, cancelled: 30 },
    { month: '2026-04', orders: 3, results: 3, rejected: 0, pending: 0, incomplete: 0, completionPct: 100, cancelled: 4 },
    { month: '2026-05', orders: 105, results: 90, rejected: 14, pending: 15, incomplete: 15, completionPct: 85.7, cancelled: 6 },
    { month: '2026-06', orders: 410, results: 341, rejected: 1, pending: 69, incomplete: 69, completionPct: 83.2, cancelled: 4 },
    { month: '2026-07', orders: 100, results: 3, rejected: 0, pending: 97, incomplete: 97, completionPct: 3.0, cancelled: 0 },
  ],
  monthlyTotals: { orders: 618, results: 437, rejected: 15, pending: 181, incomplete: 181, completionPct: 70.7 },
  cancelledNote: 53,

  // resulted rows excl. Rejected (n = 422 — NOT completed 437: a rejected row has
  // no result timestamp, so it cannot contribute a duration); 1-decimal rounding
  turnaround: {
    overallActual: 12.0,   // ACTUAL durations are measured between two timestamps — no due date involved, unchanged.
    // RE-BASELINED 2026-08-05 (rule 1, Fri+Sat weekend): 7.0 → 7.4. `expected` is
    // the CALENDAR span of the received→due window, and a window that straddles
    // Fri+Sat is longer in calendar days than the same window over Sat+Sun.
    overallExpected: 7.4,
    measuredCount: 422,    // unchanged — the measured set is "has a result timestamp".
    perMonth: [
      { month: '2026-04', actual: 20.3, expected: 4.4 },  // unchanged
      { month: '2026-05', actual: 23.3, expected: 7.7 },  // expected was 7.6 (rule 1)
      { month: '2026-06', actual: 9.4, expected: 7.4 },   // expected was 7.0 (rule 1)
      { month: '2026-07', actual: 2.0, expected: 2.5 },   // unchanged
    ],
  },

  // facility-normalized, excl. cancelled; sorted total-desc (workbook table order).
  // HEADLINE PARTITION (2026-07-28): total = pipeline + awaitingResult + completed.
  //   pipeline     = no received date yet (pre-receipt); sums to 22 (= total 618 − received 596).
  //   completed    = resulted + rejected (result date OR rejected); sums to 437 — the
  //                  NEW column, and the same number as buckets.completed / funnel.
  // FINER SPLIT of completed (all SUBSETS — never add these next to completed):
  //   resulted     = onTime + resultedLate (non-rejected rows with a result); sums to 422.
  //   resultedLate = resulted − onTime (issued after due + No-Match resulted); sums to 252.
  //   rejected per lab: Advanced 14, Fal 1, others 0 (sums to 15). onTime sums to 195
  //   (was 170) and resultedLate to 227 (was 252) — RE-BASELINED 2026-08-05, rule 1.
  //   The old 5-way identity (pipeline + awaitingResult + onTime + resultedLate +
  //   rejected = total) is still exactly true — completed just groups its last three.
  // latePct = late / awaitingResult (0 when awaitingResult = 0); late is a subset of awaitingResult.
  byLab: [
  // RE-BASELINED 2026-08-05. `total`/`pipeline`/`awaitingResult`/`completed`/
  // `resulted`/`rejected` are byte-identical to the previous baseline (THE
  // INVARIANT). Only onTime/resultedLate (rule 1) and late/latePct (rule 2) move;
  // onTime + resultedLate === resulted still holds for every lab.
  //   onTime:       Advanced 29→31, Fal 75→98, KAMC 42, Eurofins 20, Saudi 4, Anwa 0
  //   resultedLate: Advanced 158→156, Fal 48→25, KAMC 35, Eurofins 4, Saudi 7, Anwa 0
  //   late:         Advanced 60→64, Fal 2, KAMC 3→4, Eurofins 0, Saudi 2→3, Anwa 0
    // ORDER RE-BASELINED 2026-08-31: byLab is now sorted ALPHABETICALLY by lab, to
    // match the send-out slides in the same deck (was total-DESC). Every per-lab
    // figure below is byte-identical to the previous baseline — only the sequence
    // of the rows changed, which is what this array pins.
    { lab: 'Advanced Laboratory Services .Co', total: 301, pipeline: 11, awaitingResult: 89, completed: 201, onTime: 31, resulted: 187, resultedLate: 156, rejected: 14, late: 64, latePct: 71.9 },
    { lab: 'Anwa Medical Company', total: 7, pipeline: 0, awaitingResult: 7, completed: 0, onTime: 0, resulted: 0, resultedLate: 0, rejected: 0, late: 0, latePct: 0 },
    { lab: 'Eurofins clinical', total: 27, pipeline: 3, awaitingResult: 0, completed: 24, onTime: 20, resulted: 24, resultedLate: 4, rejected: 0, late: 0, latePct: 0 },
    { lab: 'Fal Specialized Medical Lab', total: 151, pipeline: 6, awaitingResult: 21, completed: 124, onTime: 98, resulted: 123, resultedLate: 25, rejected: 1, late: 2, latePct: 9.5 },
    { lab: 'king Abdullaziz Medical city in Riyadh', total: 113, pipeline: 1, awaitingResult: 35, completed: 77, onTime: 42, resulted: 77, resultedLate: 35, rejected: 0, late: 4, latePct: 11.4 },
    { lab: 'Saudi Diagnostics Limited Company', total: 19, pipeline: 1, awaitingResult: 7, completed: 11, onTime: 4, resulted: 11, resultedLate: 7, rejected: 0, late: 3, latePct: 42.9 },
  ],
  // onTime 170→195, resultedLate 252→227 (rule 1); late 67→73, latePct 42.1→45.9
  // (rule 2). Everything else identical.
  byLabTotals: { total: 618, pipeline: 22, awaitingResult: 159, completed: 437, onTime: 195, resulted: 422, resultedLate: 227, rejected: 15, late: 73, latePct: 45.9 },

  // curated catalog restricted; a row appears when late>0 OR onTime>0. Sorted
  // late-ascending (ties: reverse catalog order); onTime rides that order.
  // RE-BASELINED 2026-08-05 (rules 1+2), re-derived by running the engine:
  //   • late sums 56 → 58; catalog onTime ("success") sums 58 → 60.
  //   • ONE NEW ROW: 17-HYDROXYPROGESTERONE (late 1, onTime 0) — a row that was
  //     on time under the Sat/Sun weekend is late under Fri+Sat, so the test
  //     crosses the "late>0 OR onTime>0" threshold and enters the table.
  //   • TREPONEMA PALLIDUM late 2 → 3 ; OLIGOCLONAL onTime 0 → 1 ;
  //     Kappa light chains onTime 1 → 2.
  //   • The row ORDER shifts with the new late values (late-ascending):
  //     TREPONEMA moves down past KIDNEY STONE and IMMUNOFIXATION's neighbours.
  byTest: [
    { testName: 'SEND OUT TEST BK VIRUS MOLECULAR DETECTION QUANTITATIVE PCR PLASMA', late: 0, onTime: 20 },
    { testName: 'SEND OUT TEST MYELIN OLIGODENDROCYTE GLYCOPROTEIN (MOG) ABS IGG IFT BLOOD', late: 0, onTime: 1 },
    { testName: 'SEND OUT TEST MYOGLOBIN IN URINE TURBIDIMETRIC IMMUNOASSAY', late: 0, onTime: 1 },
    { testName: 'SEND OUT TEST HLA CLASS I GENOTYPING HIGH RESOLUTION DONOR / RECIPIENT VARIOUS SAMPLE NGS', late: 0, onTime: 9 },
    { testName: 'SEND OUT TEST GLUCAGON PLASMA EIA', late: 1, onTime: 0 },
    { testName: 'SEND OUT TEST HLA PRA SCREENING SERUM ELISA', late: 1, onTime: 2 },
    { testName: 'SEND OUT TEST HLA PRA II SINGLE ANTIGEN SERUM ELISA', late: 1, onTime: 3 },
    { testName: 'SEND OUT TEST HLA PRA I SA SINGLE ANTIGEN SERUM ELISA', late: 1, onTime: 3 },
    // NEW row (2026-08-05 re-baseline) — was absent when its only row was on time.
    { testName: 'SEND OUT TEST 17-HYDROXYPROGESTERONE BLOOD LC-MS/MS', late: 1, onTime: 0 },
    { testName: 'SEND OUT TEST OLIGOCLONAL BANDING CSF AND SERUM TEST IMMUNOBLOT (IB)', late: 2, onTime: 1 },
    { testName: 'SEND OUT TEST GAD65 AB ASSAY SERUM RADIOIMMUNOASSAY (RIA)', late: 2, onTime: 0 },
    { testName: 'SEND OUT TEST KIDNEY STONE ANALYSIS INFRARED SPECTRUM ANALYSIS', late: 2, onTime: 0 },
    { testName: 'SEND OUT TEST TREPONEMA PALLIDUM (VDRL) ABS IGG IGM BLOOD EIA', late: 3, onTime: 0 },
    { testName: 'SEND OUT TEST IMMUNOFIXATION 24 HOUR URINE TURBIDIMETRIC IMMUNOASSAY', late: 3, onTime: 4 },
    { testName: 'SEND OUT TEST COPPER BLOOD DRC-ICP-MS', late: 4, onTime: 1 },
    { testName: 'SEND OUT TEST URINE ELECTROPHORESIS PROTEIN ELECTROPHORESIS 24 HOUR URINE', late: 7, onTime: 9 },
    { testName: 'SEND OUT TEST IMMUNOGLOBULIN FREE LIGHT CHAIN 24 HOURS URINE NEPHELOMETRY', late: 15, onTime: 4 },
    { testName: 'Kappa light chains.free/Lambda light chains.free [Mass Ratio] in Serum', late: 15, onTime: 2 },
  ],
  byTestSum: 58,        // was 56 (rules 1+2)
  byTestOnTimeSum: 60,  // was 58 (rule 1)

  unmatchedTests: [], // every test in the data resolves in the TAT lookup

  // Full deltas set (E6). The golden run's baseline is the legacy prevCompleted
  // (437 == current completed under the 2026-07-28 rule; was 422) folded into
  // numbers.completed; every key resolves to a non-increase, so all deltas are 0.
  deltas: {
    total: 0,
    collected: 0,
    dispatched: 0,
    received: 0,
    completed: 0,
    rejected: 0,
    awaitingDispatch: 0,
    shippedNotReceived: 0,
    awaitingResults: 0,
    lateNoResult: 0,
  },
};

export default GOLDEN_EXPECTED;
