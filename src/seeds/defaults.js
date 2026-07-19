// seeds/defaults.js — first-run settings seeds (no PHI).
// cancelledByMonth: sticky month-keyed memory; engine merges max(stored, computed-from-CSV).
// Seeded so the sample deck's "* 53 طلب ملغي" note reproduces (8+1+30+4+6+4 = 53).
export const HISTORICAL_CONSTANTS_SEED = {
  cancelledByMonth: {
    '2026-01': 8, '2026-02': 1, '2026-03': 30,
    '2026-04': 4, '2026-05': 6, '2026-06': 4,
  },
};

// Snapshot as of the 09-07-2026 sample report, so the first real run yields a correct "+N".
export const SNAPSHOT_SEED = { prevCompleted: 437, asOf: '2026-07-09' };
