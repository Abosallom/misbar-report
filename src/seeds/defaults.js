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

// Report presentation options (Settings.reportOptions): whether to drop no-TAT
// rows, which middle slides render, which exec-slide KPI cards show, any per-report
// label overrides (edited from the review screen), and the delta-chip comparison
// window (deltaMode: 'daily' vs the last report, or the weekday-anchored
// 'weekly-sun' / 'weekly-thu' vs the most recent report issued on that weekday —
// the weekly report goes out on Sunday and Thursday). See contracts.js.
//
// slides.definitions defaults to FALSE: the delivered deck is the simple SIX-slide
// shape (cover · exec+journey · monthly · compliance · action · thanks) the user
// asked to return to. The 'منهجية الأرقام' slide stays available as an opt-in
// toggle in Settings → خيارات التقرير.
//
// EXISTING INSTALLS ARE NOT FIXED BY THIS SEED. The key shipped default-TRUE
// (2026-07-22) and every saveSettings persisted it, so an install that ran the app
// since then holds slides.definitions:true — store.backfillReportOptions fills only a
// MISSING key and never flips a stored boolean, and a stored true is indistinguishable
// from a deliberate opt-in. Returning such an install to six slides therefore needs the
// one-time schema migration in store.js (v4 → v5 resets slides.definitions to false);
// flipping this seed value cannot do it.
export const REPORT_OPTIONS_SEED = {
  excludeNoTat: false,
  // 'challenges' is the «التحديات والمخاطر» slide split out of the old
  // tasks-and-challenges slide (2026-08-04); it ships ON like the other content
  // slides, and build-spec also renders it when the key is absent entirely.
  slides: {
    execFunnel: true, monthly: true, compliance: true, action: true, challenges: true, definitions: false,
  },
  kpiCards: {
    total: true,
    awaitingDispatch: true,
    awaitingResults: true,
    completed: true,
    rejected: true,
    lateNoResult: true,
    shippedNotReceived: true,
    // OPT-IN (build-spec OPT_IN_CARDS): the monthly slide's turnaround LINE CHART +
    // navy overall-average card. FALSE by default so the delivered monthly slide is the
    // simple 20-07 reference shape (table + one bar chart). Unlike the seven exec-card
    // keys above, this one renders only when explicitly true, so a missing key is OFF —
    // existing installs that never held it therefore need no migration.
    turnaround: false,
  },
  labels: {},
  deltaMode: 'daily',
};

// Automation pipeline options (Settings.automation, v4): the unattended daily run.
// EVERY switch is OFF on a fresh install — automation never starts, pulls, writes
// files or drafts mail unless the user turns it on explicitly. dailyTime is local
// 24-hour 'HH:MM'. labRecipients maps a lab name -> a comma-separated recipient
// list for the per-lab email drafts; a missing/empty entry means the draft carries
// no To: line. Shape mirrors AUTOMATION_DEFAULTS in automation/pipeline.js.
export const AUTOMATION_SEED = {
  enabled: false,
  autoPull: false,
  autoGenerate: false,
  autoDownload: false,
  autoLabFiles: false,
  autoEmailDrafts: false,
  autoAcceptTat: false,
  dailyTime: '08:00',
  labRecipients: {},
};

// Rolling per-date history of published report numbers (Settings.snapshotHistory):
// key 'YYYY-MM-DD' → the same number set snapshot.numbers holds. Empty on a fresh
// install; the delta picker falls back to the legacy snapshot until it fills in.
// recordSnapshot (model/delta-baseline.js) trims it to the most recent 45 dates.
export const SNAPSHOT_HISTORY_SEED = {};

// Closed-task lifecycle log (Settings.taskLog, v6): stable task key
// ('ext'|'int' + '|' + normalized task text) → { openOn, closedOn|null }.
// See model/task-lifecycle.js for the shape and the transitions.
//
// EMPTY IS THE MECHANISM, not just an initial value. A closed task is shown one
// last time only if the log remembers it was shown non-closed earlier; a fresh
// install (and every doc migrated to v6) therefore remembers nothing, so the
// hundreds of already-مغلق rows sitting in the tracker never flood the first
// report. The log fills itself from the FIRST generated report onward.
export const TASK_LOG_SEED = {};

// Snapshot of the 09-07-2026 published deck (E6 prompt): the previous report's
// full number set, so the first real run's "+N" chips are correct. Keys mirror
// EngineOutput.deltas (see contracts.js).
//
// completed RE-BASELINED 422 → 437 (2026-07-28, "rejected counts as completed").
// This seed is a DELTA BASELINE, not a transcript: its only job is to make the
// first run's chips read as real movement, which requires it to be stated in the
// SAME definition as today's numbers. The 09-07 golden dataset holds 422 resulted
// rows and 15 rejected ones (every rejected row with a blank result date, so the
// two sets are disjoint) → the same deck re-counted under the new rule is
// 422 + 15 = 437, with rejected still 15 as a SUBSET of it. Leaving 422 would have
// made the very first chip read "+15 مكتمل" for work that was already finished on
// 09-07. Precedent: the same re-baseline was done on 2026-07-19 when the rule last
// changed. defVersion below stamps WHICH definition these numbers speak.
export const SNAPSHOT_SEED = {
  asOf: '2026-07-09',
  // Definition version of `numbers` (model/delta-baseline.js COMPLETED_DEF_VERSION):
  // 2 = completed includes rejected. The delta picker reads it and therefore does NOT
  // flag this seed as a pre-change baseline.
  //
  // It is a SIBLING of `numbers`, never a key inside it (contracts.js Settings.snapshot),
  // and must NOT be moved inside. (1) `numbers` IS the published number set: it is spread
  // into snapshots, deltas and the history, and test/asof.test.mjs deep-equals it against
  // the engine's own ten numbers — an eleventh key would leak and fail that identity.
  // (2) A stamp inside `numbers` is STICKY: store.updateSnapshot merges partial numbers
  // over the stored ones, so this seed's `2` would ride along on top of every later run's
  // figures and outlive the definition it actually describes.
  // The sibling survives only because the round-trips carry it deliberately — store.js
  // updateSnapshot (keepStamp), pickImportKeys (whitelist) and importSettings (replace,
  // never merge). Drop it in any of those and this seed, already stated in the new
  // definition, is read as pre-change and raises a false definitionShift on 437.
  defVersion: 2,
  numbers: {
    total: 618,
    collected: 612,
    dispatched: 608,
    received: 596,
    completed: 437, // 2026-07-28 rule: resulted (422) + rejected (15) — rejected INCLUDED
    rejected: 15, // still reported on its own; now a SUBSET of completed, not an addition
    awaitingDispatch: 10,
    shippedNotReceived: 12,
    awaitingResults: 159,
    lateNoResult: 67,
  },
};
