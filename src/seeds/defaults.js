// seeds/defaults.js — first-run settings seeds (no PHI).

// Live Grafana source: the base URL is prefilled (it already appears in this
// public repo's exporter script — no new exposure); the token and data key are
// entered once in Settings and never committed here.
export const GRAFANA_SEED = { baseUrl: 'https://elab.seha.sa/hpapm', accessToken: '', panelId: 49, enabled: false, dataKey: '' };
//
// cancelledByMonth: MANUAL additive constants only (workbook "Prompt for Next
// Report" C6). The engine now computes cancelled(m) = countedFromCsv(m) +
// cancelledByMonth[m] (ADDITIVE, not max). May/June are therefore NOT seeded
// here — they come from the CSV data (2026-05: 6, 2026-06: 4). The seeded manual
// months (Jan–Apr, sum 43) plus the 10 counted in data reproduce the sample
// deck's "* 53 طلب ملغي" note (43 + 6 + 4 = 53).
export const HISTORICAL_CONSTANTS_SEED = {
  cancelledByMonth: {
    '2026-01': 8, '2026-02': 1, '2026-03': 30, '2026-04': 4,
  },
};

// Snapshot of the 09-07-2026 published deck (E6 prompt): the previous report's
// full number set, so the first real run's "+N" chips are correct. Keys mirror
// EngineOutput.deltas (see contracts.js).
export const SNAPSHOT_SEED = {
  asOf: '2026-07-09',
  numbers: {
    total: 618,
    collected: 612,
    dispatched: 608,
    received: 596,
    completed: 437,
    awaitingDispatch: 10,
    shippedNotReceived: 12,
    awaitingResults: 159,
    lateNoResult: 67,
  },
};
