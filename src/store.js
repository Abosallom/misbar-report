// store.js — Track C persistence layer.
// A single versioned config document persisted at SETTINGS_KEY in localStorage.
// NO PATIENT DATA EVER: patient/order rows stay memory-only — there is no
// rows/orders API here by design, so PHI can never structurally land in storage.
// What IS stored is configuration plus two integration fields:
//   • grafana — live-source config. grafana.accessToken is a Grafana PUBLIC-
//     dashboard token: view-only, server-side-masked data, never a login/PHI key.
//   • cachedTracker — the last parsed Project Tracker (PROJECT-management content:
//     tasks/challenges/risks). This is explicitly allowed; it is NOT patient data.
//   • taskLog (v6) — the closed-task grace bookkeeping (model/task-lifecycle.js):
//     normalized TASK TEXT → {openOn, closedOn}. NO NEW DATA CLASS: it is the same
//     project-management content cachedTracker already stores, kept in plaintext so
//     an exported backup is auditable by the user who owns it.
// All localStorage access is wrapped in try/catch because Safari private mode
// throws on write; on failure we fall back to an in-memory doc and expose
// isEphemeral() so the UI can warn the user their edits will not persist.

import { SETTINGS_KEY } from './contracts.js?v=v2026-08-06.1';
import { TAT_LOOKUP } from './seeds/tat-lookup.js?v=v2026-08-06.1';
import { SCORECARD_SEED } from './seeds/scorecard.js?v=v2026-08-06.1';
import {
  HISTORICAL_CONSTANTS_SEED, SNAPSHOT_SEED, GRAFANA_SEED, REPORT_OPTIONS_SEED,
  SNAPSHOT_HISTORY_SEED, AUTOMATION_SEED, TASK_LOG_SEED,
} from './seeds/defaults.js?v=v2026-08-06.1';
import { DELTA_MODES, canonicalDeltaMode } from './model/delta-baseline.js?v=v2026-08-06.1';
import {
  sanitizeTaskLog, recordShownTasks, TASK_LOG_LIMIT, TASK_KEY_MAX,
} from './model/task-lifecycle.js?v=v2026-08-06.1';

export const SCHEMA_VERSION = 7;

// taskLog key = 'ext'|'int' (3) + '|' (1) + up to TASK_KEY_MAX chars of task text.
// A little headroom above that so a key is rejected only when it is genuinely
// not one of ours, never because of an off-by-a-few.
const TASK_KEY_MAX_LEN = TASK_KEY_MAX + 8;

// Well-formed 'YYYY-MM-DD' — the key shape for snapshotHistory entries.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Local 24-hour 'HH:MM' — the shape of automation.dailyTime.
const DAILY_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// canonicalDeltaMode is IMPORTED from model/delta-baseline.js (above), which owns the
// enum, the retired-value aliases and the null-for-anything-else rule. This file used
// to keep its own copy of that logic, which meant every mode change had to be made
// twice, in lockstep, or the store would reject a value the picker accepts.
// Contract used here: 'daily' | 'week' back, null when the value is not a mode at all
// (the backfill then resets it to the seed and an import rejects it).

// The automation boolean switches (v4). Every one defaults to false; dailyTime and
// labRecipients are the only non-boolean members of the block.
const AUTOMATION_FLAG_KEYS = [
  'enabled', 'autoPull', 'autoGenerate', 'autoDownload', 'autoLabFiles',
  'autoEmailDrafts', 'autoAcceptTat',
];

// ---- module state -----------------------------------------------------------
// _ephemeral: true once any localStorage op has thrown; drives isEphemeral().
// _memDoc: the working document when we cannot touch localStorage.
let _ephemeral = false;
let _memDoc = null;

/** For tests only: clear the in-memory fallback state between cases. */
export function __resetForTests() {
  _ephemeral = false;
  _memDoc = null;
}

/** True when storage is unavailable and edits live only in memory this session. */
export function isEphemeral() {
  return _ephemeral;
}

// ---- helpers ----------------------------------------------------------------
function nowIso() {
  return new Date().toISOString();
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * In-place backfill of doc.reportOptions from REPORT_OPTIONS_SEED. A missing
 * reportOptions is deep-copied from the seed; a partial one gets any missing
 * subkeys (including slide/card keys added in future versions) filled with their
 * seed default. Present user values (any boolean, any labels map) are preserved.
 */
function backfillReportOptions(doc) {
  const seed = REPORT_OPTIONS_SEED;
  if (!isPlainObject(doc.reportOptions)) {
    doc.reportOptions = clone(seed);
    return;
  }
  const ro = doc.reportOptions;
  if (typeof ro.excludeNoTat !== 'boolean') ro.excludeNoTat = seed.excludeNoTat;
  if (!isPlainObject(ro.slides)) ro.slides = { ...seed.slides };
  else for (const k of Object.keys(seed.slides)) {
    if (typeof ro.slides[k] !== 'boolean') ro.slides[k] = seed.slides[k];
  }
  if (!isPlainObject(ro.kpiCards)) ro.kpiCards = { ...seed.kpiCards };
  else for (const k of Object.keys(seed.kpiCards)) {
    if (typeof ro.kpiCards[k] !== 'boolean') ro.kpiCards[k] = seed.kpiCards[k];
  }
  if (!isPlainObject(ro.labels)) ro.labels = {};
  // Manual-generate auto-download (v7). Fills only a MISSING key, like every flag
  // above, so a user who switched it OFF keeps it off across loads. Absent → the seed
  // (true = the behaviour shipped to date). Unrelated to automation.autoDownload,
  // which lives in the automation block and governs the unattended run.
  if (typeof ro.autoDownloadFiles !== 'boolean') ro.autoDownloadFiles = seed.autoDownloadFiles;
  // deltaMode gained in v3; the retired weekly values ('weekly', 'weekly-sun',
  // 'weekly-thu') migrate to 'week' through canonicalDeltaMode, anything
  // unrecognized resets to the seed. NOTE this backfill cannot change the DEFAULT for
  // an install that already stored 'daily' — that is migrateV6toV7's job.
  ro.deltaMode = canonicalDeltaMode(ro.deltaMode) || seed.deltaMode;
}

/**
 * In-place backfill of doc.automation from AUTOMATION_SEED (v4). A missing block
 * is deep-copied from the seed; a partial one gets every missing switch filled
 * with its seed default (false — automation is opt-in, never inferred). A
 * dailyTime that is not 'HH:MM' resets to the seed; labRecipients is kept as a
 * plain lab -> recipient-string map, non-string values dropped.
 */
function backfillAutomation(doc) {
  const seed = AUTOMATION_SEED;
  if (!isPlainObject(doc.automation)) {
    doc.automation = clone(seed);
    return;
  }
  const a = doc.automation;
  for (const k of AUTOMATION_FLAG_KEYS) {
    if (typeof a[k] !== 'boolean') a[k] = seed[k];
  }
  if (typeof a.dailyTime !== 'string' || !DAILY_TIME_RE.test(a.dailyTime)) {
    a.dailyTime = seed.dailyTime;
  }
  if (!isPlainObject(a.labRecipients)) a.labRecipients = {};
  else for (const [k, v] of Object.entries(a.labRecipients)) {
    if (typeof v !== 'string') delete a.labRecipients[k];
  }
}

/** Build the first-run document straight from the frozen seeds. */
function buildSeedDoc() {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: nowIso(),
    tatLookup: { ...TAT_LOOKUP },
    displayNames: {},
    scorecard: SCORECARD_SEED.map((r) => ({ ...r })),
    historicalConstants: {
      cancelledByMonth: { ...HISTORICAL_CONSTANTS_SEED.cancelledByMonth },
    },
    snapshot: clone(SNAPSHOT_SEED), // deep clone: SNAPSHOT_SEED.numbers is nested
    snapshotHistory: clone(SNAPSHOT_HISTORY_SEED), // rolling per-date numbers (v3); empty on first run
    taskLog: clone(TASK_LOG_SEED), // closed-task grace log (v6); empty = nothing remembered yet
    grafana: { ...GRAFANA_SEED },
    reportOptions: clone(REPORT_OPTIONS_SEED), // deep clone: nested slides/kpiCards/labels
    automation: clone(AUTOMATION_SEED), // deep clone: nested labRecipients (v4); all switches off
    cachedTracker: null,
  };
}

// Defensive cap on the serialized cachedTracker model (chars). Keeps a single
// oversized parse from bloating localStorage and tripping the quota for everything
// else. The Project Tracker is small in practice; this only guards pathologies.
const CACHED_TRACKER_MAX = 300_000;

function tryGet(key) {
  try {
    return { ok: true, value: globalThis.localStorage.getItem(key) };
  } catch (_e) {
    return { ok: false, value: null };
  }
}

function trySet(key, value) {
  try {
    globalThis.localStorage.setItem(key, value);
    return true;
  } catch (_e) {
    return false;
  }
}

/** Persist a doc; on failure drop into ephemeral in-memory mode. */
function persist(doc) {
  const ok = trySet(SETTINGS_KEY, JSON.stringify(doc));
  if (!ok) {
    _ephemeral = true;
    _memDoc = doc;
  } else {
    _ephemeral = false;
  }
  return doc;
}

/**
 * In-place softening for a same-schema (v1) doc. Two backfills, no schemaVersion
 * bump:
 *  1. Legacy snapshot shaped {prevCompleted, asOf} widens to {asOf, numbers} —
 *     numbers seeded from SNAPSHOT_SEED with completed overridden by the old
 *     prevCompleted. Docs already carrying {numbers} are left untouched.
 *  2. Docs predating the live-source work get the missing `grafana`
 *     (from GRAFANA_SEED) and `cachedTracker` (null) keys added.
 */
function migrateSnapshotShape(doc) {
  const s = doc.snapshot;
  if (isPlainObject(s) && !isPlainObject(s.numbers)) {
    doc.snapshot = {
      asOf: s.asOf != null ? s.asOf : SNAPSHOT_SEED.asOf,
      numbers: {
        ...SNAPSHOT_SEED.numbers,
        ...(s.prevCompleted != null ? { completed: Number(s.prevCompleted) } : {}),
      },
    };
  }
  if (!isPlainObject(doc.grafana)) {
    doc.grafana = { ...GRAFANA_SEED };
  } else {
    // Backfill gaps in stored configs: an empty baseUrl is never useful (the
    // settings field's placeholder made it easy to leave blank), and older docs
    // predate panelId/dataKey.
    if (!doc.grafana.baseUrl) doc.grafana.baseUrl = GRAFANA_SEED.baseUrl;
    if (doc.grafana.panelId == null) doc.grafana.panelId = GRAFANA_SEED.panelId;
    if (typeof doc.grafana.dataKey !== 'string') doc.grafana.dataKey = '';
  }
  if (!('cachedTracker' in doc)) doc.cachedTracker = null;
  backfillReportOptions(doc); // add reportOptions + any new slide/card subkeys + deltaMode
  if (!isPlainObject(doc.snapshotHistory)) doc.snapshotHistory = {}; // v3 rolling history
  backfillAutomation(doc); // v4 automation block (all switches default false)
  // v6 closed-task grace log. Backfilled EMPTY on purpose (seeds TASK_LOG_SEED):
  // an empty log means "nothing was ever shown open", which is exactly what makes
  // the tracker's pre-existing مغلق rows stay off the deck.
  if (!isPlainObject(doc.taskLog)) doc.taskLog = clone(TASK_LOG_SEED);
  return doc;
}

/**
 * v1 → v2 forward migration. Under v1 the engine computed cancelled(m) with a
 * MAX, so cancelledByMonth was allowed to hold data-derived months (2026-05: 6,
 * 2026-06: 4) alongside the manual ones. v2's engine is ADDITIVE — it adds
 * cancelledByMonth to the count it derives from the CSV — so keeping those
 * data-derived values would double-count (note "63" instead of "53"). Reset
 * cancelledByMonth to the manual-only seed and preserve every other field
 * (tatLookup edits, scorecard, snapshot, grafana, cachedTracker). The existing
 * snapshot/grafana/cachedTracker shape softening runs too, then we stamp v2.
 */
function migrateV1toV2(doc) {
  doc.historicalConstants = {
    cancelledByMonth: { ...HISTORICAL_CONSTANTS_SEED.cancelledByMonth },
  };
  migrateSnapshotShape(doc); // widen legacy snapshot + backfill grafana/cachedTracker
  doc.schemaVersion = 2;
  return doc;
}

/**
 * v2 → v3 forward migration. v3 adds a rolling per-date `snapshotHistory` (feeding
 * the daily / weekly-sun / weekly-thu delta-baseline picker) and `reportOptions.deltaMode`. The
 * shape-softening (migrateSnapshotShape) backfills both containers; then, so the
 * new daily/weekly chips have something to compare against on day one, we SEED the
 * existing legacy snapshot into snapshotHistory under its asOf date (only when asOf
 * is a valid ISO date, numbers are present, and that date is not already recorded).
 */
function migrateV2toV3(doc) {
  migrateSnapshotShape(doc); // ensures snapshotHistory:{} + reportOptions.deltaMode
  const s = doc.snapshot;
  if (isPlainObject(s) && ISO_DATE_RE.test(String(s.asOf)) && isPlainObject(s.numbers)) {
    if (!isPlainObject(doc.snapshotHistory)) doc.snapshotHistory = {};
    if (!(s.asOf in doc.snapshotHistory)) {
      const nums = {};
      for (const [k, v] of Object.entries(s.numbers)) {
        if (typeof v === 'number' && Number.isFinite(v)) nums[k] = v;
      }
      doc.snapshotHistory[s.asOf] = nums;
    }
  }
  doc.schemaVersion = 3;
  return doc;
}

/**
 * v3 → v4 forward migration. v4 adds the `automation` block (the unattended daily
 * pipeline). The shape-softening (migrateSnapshotShape) backfills it from
 * AUTOMATION_SEED, which leaves every switch OFF: upgrading an existing install
 * must never silently start pulling data, writing files or drafting mail.
 */
function migrateV3toV4(doc) {
  migrateSnapshotShape(doc); // ensures the automation block exists, all switches false
  doc.schemaVersion = 4;
  return doc;
}

/**
 * v4 → v5: retire the definitions slide from the default deck.
 *
 * 'منهجية الأرقام' shipped ON by default, so every install created before this
 * persisted `slides.definitions: true` — a DEFAULT nobody chose. The user asked
 * for the simple 6-slide deck back (2026-07-26), and the normal backfill only
 * fills absent keys: it never flips a stored boolean, by design. Without this
 * one-time reset the simplification would be a no-op on exactly the installs
 * that matter. It runs once; switching the slide back on in Settings afterwards
 * sticks, because no later load touches a stored value again.
 */
function migrateV4toV5(doc) {
  migrateSnapshotShape(doc); // same softening/backfill pass every other step runs
  const ro = isPlainObject(doc.reportOptions) ? doc.reportOptions : (doc.reportOptions = {});
  const slides = isPlainObject(ro.slides) ? ro.slides : (ro.slides = {});
  slides.definitions = false;
  doc.schemaVersion = 5;
  return doc;
}

/** v3 → v5: run the v3→v4 transform, then v4→v5. */
function migrateV3toV5(doc) {
  migrateV3toV4(doc);
  return migrateV4toV5(doc);
}

/** v2 → v5: run the v2→v3 transform, then v3→v4, then v4→v5. */
function migrateV2toV5(doc) {
  migrateV2toV3(doc);
  return migrateV3toV5(doc);
}

/** v1 → v5: chain every transform so old docs land on v5. */
function migrateV1toV5(doc) {
  migrateV1toV2(doc);
  return migrateV2toV5(doc);
}

/**
 * v5 → v6: add the closed-task grace log (`taskLog`).
 *
 * The shape-softening pass backfills it as `{}` — and empty is not a placeholder,
 * it IS the pre-ship exclusion mechanism: model/task-lifecycle.js shows a مغلق
 * task one last time only if the log remembers it was shown non-closed earlier, so
 * an upgraded install starts remembering nothing and the tracker's long tail of
 * already-closed rows never floods the first report after the upgrade. Nothing
 * else changes; the log fills itself from the next successful generation on.
 */
function migrateV5toV6(doc) {
  migrateSnapshotShape(doc); // backfills doc.taskLog = {} (plus every earlier key)
  doc.schemaVersion = 6;
  return doc;
}

/** v4 → v6: run the v4→v5 transform, then v5→v6. */
function migrateV4toV6(doc) {
  migrateV4toV5(doc);
  return migrateV5toV6(doc);
}

/** v3 → v6: run the v3→v5 chain, then v5→v6. */
function migrateV3toV6(doc) {
  migrateV3toV5(doc);
  return migrateV5toV6(doc);
}

/** v2 → v6: run the v2→v5 chain, then v5→v6. */
function migrateV2toV6(doc) {
  migrateV2toV5(doc);
  return migrateV5toV6(doc);
}

/** v1 → v6: chain every transform so old docs land on v6. */
function migrateV1toV6(doc) {
  migrateV1toV5(doc);
  return migrateV5toV6(doc);
}

/**
 * v6 → v7: make week-to-date the delta comparison window.
 *
 * deltaMode shipped defaulting to 'daily' and every saveSettings has persisted that
 * value since v3, so an install that has ever run the app holds a stored 'daily' —
 * a DEFAULT nobody chose. The user asked for week-to-date "instead of daily"
 * (2026-08-04), and backfillReportOptions only fills an ABSENT key: without this
 * one-time force the new default would reach nobody who already uses the app, i.e.
 * exactly the installs the request is about. Direct precedent: migrateV4toV5, which
 * reset slides.definitions the same way and for the same reason.
 *
 * It runs ONCE. Choosing 'daily' in Settings afterwards sticks, because no later load
 * ever touches a stored value again (the backfill only canonicalizes it).
 * The retired 'weekly-sun' / 'weekly-thu' values need no work here — canonicalDeltaMode
 * aliases them to 'week', which is where this migration puts everyone anyway.
 */
function migrateV6toV7(doc) {
  migrateSnapshotShape(doc); // same softening/backfill pass every other step runs
  const ro = isPlainObject(doc.reportOptions) ? doc.reportOptions : (doc.reportOptions = {});
  ro.deltaMode = 'week';
  doc.schemaVersion = 7;
  return doc;
}

/** v5 → v7: run the v5→v6 transform, then v6→v7. */
function migrateV5toV7(doc) {
  migrateV5toV6(doc);
  return migrateV6toV7(doc);
}

/** v4 → v7: run the v4→v6 chain, then v6→v7. */
function migrateV4toV7(doc) {
  migrateV4toV6(doc);
  return migrateV6toV7(doc);
}

/** v3 → v7: run the v3→v6 chain, then v6→v7. */
function migrateV3toV7(doc) {
  migrateV3toV6(doc);
  return migrateV6toV7(doc);
}

/** v2 → v7: run the v2→v6 chain, then v6→v7. */
function migrateV2toV7(doc) {
  migrateV2toV6(doc);
  return migrateV6toV7(doc);
}

/** v1 → v7: chain every transform so the oldest docs land on the current schema. */
function migrateV1toV7(doc) {
  migrateV1toV6(doc);
  return migrateV6toV7(doc);
}

/** Version-check + migrate/reset. Unknown versions reset to seeds. */
function migrate(doc) {
  if (!isPlainObject(doc)) {
    console.warn('[misbar/store] settings root is not an object — resetting to seeds.');
    return persist(buildSeedDoc());
  }
  if (doc.schemaVersion === SCHEMA_VERSION) return migrateSnapshotShape(doc);
  if (doc.schemaVersion === 6) return persist(migrateV6toV7(doc));
  if (doc.schemaVersion === 5) return persist(migrateV5toV7(doc));
  if (doc.schemaVersion === 4) return persist(migrateV4toV7(doc));
  if (doc.schemaVersion === 3) return persist(migrateV3toV7(doc));
  if (doc.schemaVersion === 2) return persist(migrateV2toV7(doc));
  if (doc.schemaVersion === 1) return persist(migrateV1toV7(doc));
  // Future schema bumps add forward-migration cases above this line.
  console.warn(
    `[misbar/store] unsupported schemaVersion ${doc.schemaVersion} ` +
      `(expected ${SCHEMA_VERSION}) — resetting to seeds.`,
  );
  return persist(buildSeedDoc());
}

// ---- public API -------------------------------------------------------------

/**
 * Returns the Settings document. First run seeds + persists it. On a schema
 * mismatch or corruption, migrates forward or resets with a console warning.
 * @returns {import('./contracts.js').Settings}
 */
export function loadSettings() {
  const r = tryGet(SETTINGS_KEY);

  // Storage completely unreadable (e.g. private mode denies getItem too).
  if (!r.ok) {
    _ephemeral = true;
    if (!_memDoc) _memDoc = buildSeedDoc();
    return _memDoc;
  }

  // Nothing stored.
  if (r.value == null) {
    // If we already fell back to memory this session, keep those edits.
    if (_ephemeral && _memDoc) return _memDoc;
    return persist(buildSeedDoc());
  }

  // Parse what is stored.
  let doc;
  try {
    doc = JSON.parse(r.value);
  } catch (e) {
    console.warn('[misbar/store] settings JSON is corrupt — resetting to seeds.', e);
    return persist(buildSeedDoc());
  }
  _ephemeral = false;
  return migrate(doc);
}

/**
 * Stamps updatedAt (+ schemaVersion) and persists. Falls back to memory on
 * storage failure.
 * @param {import('./contracts.js').Settings} s
 * @returns {import('./contracts.js').Settings} the stamped, persisted doc
 */
export function saveSettings(s) {
  const doc = { ...s, schemaVersion: SCHEMA_VERSION, updatedAt: nowIso() };
  return persist(doc);
}

/**
 * Records the previous-report snapshot after a successful generation. The full
 * number set (E6). Partial `numbers` are merged over the existing snapshot's
 * numbers (only finite numeric values land); asOf is updated when provided.
 *
 * `defVersion` (the definition stamp — model/delta-baseline.js) lives NEXT TO
 * `numbers`, deliberately outside the number set so it never leaks into deltas or
 * history. This rebuild must therefore CARRY IT OVER explicitly: dropping it would
 * silently downgrade a stamped snapshot to date inference, and the shipped seed
 * (asOf 2026-07-09, already re-stated in the new definition) would then be read as
 * pre-change and raise a false definitionShift on numbers that are already 437.
 * A stamp supplied INSIDE `numbers` wins — it travels with the very numbers being
 * written, whereas the sibling describes the ones being replaced, so keeping the
 * old sibling alongside it would let a stale version outrank the fresh one (the
 * picker prefers the sibling).
 * @param {{asOf?:string, numbers?:Object<string,number>}} snap
 */
export function updateSnapshot({ asOf, numbers } = {}) {
  const doc = loadSettings();
  const cur = isPlainObject(doc.snapshot) ? doc.snapshot : {};
  const nextNumbers = { ...(isPlainObject(cur.numbers) ? cur.numbers : {}) };
  if (isPlainObject(numbers)) {
    for (const [k, v] of Object.entries(numbers)) {
      if (typeof v === 'number' && Number.isFinite(v)) nextNumbers[k] = v;
    }
  }
  const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const keepStamp = isFiniteNum(cur.defVersion) && !isFiniteNum(nextNumbers.defVersion);
  doc.snapshot = {
    asOf: asOf != null ? String(asOf) : cur.asOf,
    ...(keepStamp ? { defVersion: cur.defVersion } : {}),
    numbers: nextNumbers,
  };
  return saveSettings(doc);
}

/**
 * Stores (or clears) the last successfully parsed Project Tracker. Pass a
 * TrackerModel to cache it as {model, updatedAt}; pass null to clear it. This is
 * project-management content (tasks/challenges/risks), NOT patient data.
 * Guard: the serialized model must be under CACHED_TRACKER_MAX chars, else we
 * throw rather than risk exhausting the localStorage quota.
 * @param {import('./contracts.js').TrackerModel|null} model
 */
export function updateCachedTracker(model) {
  const doc = loadSettings();
  if (model == null) {
    doc.cachedTracker = null;
    return saveSettings(doc);
  }
  const serialized = JSON.stringify(model);
  if (serialized.length >= CACHED_TRACKER_MAX) {
    throw new Error(
      `نموذج المتتبع كبير جداً للتخزين (${serialized.length} حرفاً، الحد ${CACHED_TRACKER_MAX}). ` +
        'لن يُحفظ للحفاظ على سلامة التخزين المحلي.',
    );
  }
  doc.cachedTracker = { model: clone(model), updatedAt: nowIso() };
  return saveSettings(doc);
}

/**
 * Serialize the config doc for download — MINUS the two access secrets.
 * SECURITY: the backup file lives in cleartext on disk/email/USB, so the
 * secrets the sign-in gate injects (grafana.accessToken → live source,
 * grafana.dataKey → snapshot decryption) are REDACTED here; otherwise a
 * leaked "backup" would bypass the accounts gate entirely. The keys are
 * DELETED, not blanked: pickImportKeys() only picks string values, so a
 * re-import of a redacted backup leaves the device's existing secrets
 * untouched (deepMergeImportWins only overwrites keys present in the
 * import) — and signing in restores them on a fresh device.
 * Works on a clone: loadSettings() may return the live in-memory doc
 * (ephemeral mode), which must not lose its secrets.
 * @returns {{filename:string, blob:Blob}}
 */
export function exportSettings() {
  const doc = clone(loadSettings());
  if (isPlainObject(doc.grafana)) {
    delete doc.grafana.accessToken;
    delete doc.grafana.dataKey;
  }
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const filename = `misbar-settings-${yyyy}${mm}${dd}.json`;
  const json = JSON.stringify(doc, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  return { filename, blob };
}

// ---- import -----------------------------------------------------------------

// Schema versions an import accepts: every version migrate() can transform, plus
// the current one. Extend this WITH the migration dispatcher — a version that can
// be loaded from storage but not imported orphans that generation's backups.
const IMPORTABLE_VERSIONS = new Set([1, 2, 3, 4, 5, 6, SCHEMA_VERSION]);

function validateImport(doc) {
  if (!isPlainObject(doc)) {
    throw new Error('ملف الإعدادات غير صالح: الجذر ليس كائناً.');
  }
  // Accept every schema this store can migrate forward, plus the current one.
  //
  // BUG FIX (2026-08-04): this gate was a hand-written list that stopped at 3 and
  // was never extended when v4 (automation) and v5 (definitions reset) shipped —
  // so backups exported by v4/v5 installs were ALREADY being rejected as
  // "unsupported", even though loadSettings() migrates those very docs happily.
  // The set is now derived from the migration chain: anything the dispatcher in
  // migrate() can transform is importable, and the merged doc is saved stamped
  // with SCHEMA_VERSION.
  if (!IMPORTABLE_VERSIONS.has(doc.schemaVersion)) {
    throw new Error(
      `إصدار المخطط غير مدعوم: ${doc.schemaVersion == null ? 'مفقود' : doc.schemaVersion}` +
        ` (المتوقع ${SCHEMA_VERSION}).`,
    );
  }
  if ('tatLookup' in doc && !isPlainObject(doc.tatLookup)) {
    throw new Error('حقل tatLookup غير صالح: يجب أن يكون كائناً.');
  }
  if ('displayNames' in doc && !isPlainObject(doc.displayNames)) {
    throw new Error('حقل displayNames غير صالح: يجب أن يكون كائناً.');
  }
  if ('scorecard' in doc && !Array.isArray(doc.scorecard)) {
    throw new Error('حقل scorecard غير صالح: يجب أن يكون مصفوفة.');
  }
  if ('historicalConstants' in doc) {
    const hc = doc.historicalConstants;
    if (!isPlainObject(hc)) {
      throw new Error('حقل historicalConstants غير صالح.');
    }
    if ('cancelledByMonth' in hc && !isPlainObject(hc.cancelledByMonth)) {
      throw new Error('حقل cancelledByMonth غير صالح: يجب أن يكون كائناً.');
    }
  }
  if ('snapshot' in doc) {
    if (!isPlainObject(doc.snapshot)) {
      throw new Error('حقل snapshot غير صالح: يجب أن يكون كائناً.');
    }
    if ('numbers' in doc.snapshot && !isPlainObject(doc.snapshot.numbers)) {
      throw new Error('حقل snapshot.numbers غير صالح: يجب أن يكون كائناً.');
    }
  }
  if ('snapshotHistory' in doc) {
    // Plain object keyed by ISO date; each value a plain object of finite numbers —
    // mirrors how snapshot.numbers is validated, per stored date.
    const sh = doc.snapshotHistory;
    if (!isPlainObject(sh)) {
      throw new Error('حقل snapshotHistory غير صالح: يجب أن يكون كائناً.');
    }
    for (const [date, nums] of Object.entries(sh)) {
      if (!ISO_DATE_RE.test(date)) {
        throw new Error(`مفتاح تاريخ غير صالح في snapshotHistory: "${date}".`);
      }
      if (!isPlainObject(nums)) {
        throw new Error(`حقل snapshotHistory["${date}"] غير صالح: يجب أن يكون كائناً.`);
      }
      for (const [k, v] of Object.entries(nums)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new Error(`قيمة غير رقمية في snapshotHistory["${date}"]: "${k}".`);
        }
      }
    }
  }
  if ('taskLog' in doc) {
    // v6 closed-task grace log. It needs its OWN block: snapshotHistory's validator
    // above accepts only finite-NUMBER leaves, and every leaf here is a date string
    // or null. Bounds are enforced (entry count, key length) so a hand-edited or
    // hostile backup cannot bloat localStorage through this key.
    const tl = doc.taskLog;
    if (!isPlainObject(tl)) {
      throw new Error('حقل taskLog غير صالح: يجب أن يكون كائناً.');
    }
    const entries = Object.entries(tl);
    if (entries.length > TASK_LOG_LIMIT) {
      throw new Error(`حقل taskLog كبير جداً: ${entries.length} عنصراً (الحد ${TASK_LOG_LIMIT}).`);
    }
    for (const [key, entry] of entries) {
      if (key.length > TASK_KEY_MAX_LEN) {
        throw new Error(`مفتاح طويل جداً في taskLog (الحد ${TASK_KEY_MAX_LEN} حرفاً).`);
      }
      if (!isPlainObject(entry)) {
        throw new Error(`حقل taskLog["${key}"] غير صالح: يجب أن يكون كائناً.`);
      }
      if (!ISO_DATE_RE.test(String(entry.openOn))) {
        throw new Error(`قيمة openOn غير صالحة في taskLog["${key}"]: يجب أن تكون تاريخاً بصيغة YYYY-MM-DD.`);
      }
      if (entry.closedOn != null && !ISO_DATE_RE.test(String(entry.closedOn))) {
        throw new Error(`قيمة closedOn غير صالحة في taskLog["${key}"]: يجب أن تكون تاريخاً أو null.`);
      }
      // Extra fields are NOT an error — pickImportKeys runs the entry through
      // sanitizeTaskLog, which keeps exactly {openOn, closedOn} and drops the rest
      // (same tolerance the grafana/automation blocks give unknown subkeys).
    }
  }
  if ('grafana' in doc) {
    const g = doc.grafana;
    if (!isPlainObject(g)) {
      throw new Error('حقل grafana غير صالح: يجب أن يكون كائناً.');
    }
    if ('baseUrl' in g && typeof g.baseUrl !== 'string') {
      throw new Error('حقل grafana.baseUrl غير صالح: يجب أن يكون نصاً.');
    }
    if ('accessToken' in g && typeof g.accessToken !== 'string') {
      throw new Error('حقل grafana.accessToken غير صالح: يجب أن يكون نصاً.');
    }
    if ('panelId' in g && (typeof g.panelId !== 'number' || !Number.isFinite(g.panelId))) {
      throw new Error('حقل grafana.panelId غير صالح: يجب أن يكون رقماً.');
    }
    if ('dataKey' in g && typeof g.dataKey !== 'string') {
      throw new Error('حقل grafana.dataKey غير صالح: يجب أن يكون نصاً.');
    }
    // enabled is coerce-tolerant: any truthy/falsy value is accepted and
    // normalized to a boolean in pickImportKeys — no validation error here.
  }
  if ('cachedTracker' in doc) {
    const ct = doc.cachedTracker;
    if (ct !== null) {
      if (!isPlainObject(ct)) {
        throw new Error('حقل cachedTracker غير صالح: يجب أن يكون null أو كائناً.');
      }
      if (!isPlainObject(ct.model)) {
        throw new Error('حقل cachedTracker.model غير صالح: يجب أن يكون كائناً.');
      }
      if (typeof ct.updatedAt !== 'string') {
        throw new Error('حقل cachedTracker.updatedAt غير صالح: يجب أن يكون نصاً.');
      }
    }
  }
  if ('reportOptions' in doc) {
    const ro = doc.reportOptions;
    if (!isPlainObject(ro)) {
      throw new Error('حقل reportOptions غير صالح: يجب أن يكون كائناً.');
    }
    // excludeNoTat, autoDownloadFiles (v7) and the slide/card flags are all
    // coerce-tolerant (normalized to booleans in pickImportKeys); only the container
    // shapes and deltaMode's enum are enforced here. The line between the two: these
    // are PRESENTATION preferences, so a truthy value from a hand-edited backup is
    // normalized; the automation switches, which can start an unattended run on their
    // own, are validated strictly and rejected (see the automation block below).
    if ('deltaMode' in ro && canonicalDeltaMode(ro.deltaMode) == null) {
      // The accepted list is BUILT FROM THE ENUM, never re-typed: this message named
      // 'weekly-sun'/'weekly-thu' long enough that it could have outlived them and told
      // the user to supply a value the store no longer accepts. Retired aliases are
      // deliberately left out — they still import (canonicalDeltaMode maps them), they
      // are just not what we ask a human to type.
      throw new Error(
        `حقل reportOptions.deltaMode غير صالح: يجب أن يكون ${DELTA_MODES.map((m) => `'${m}'`).join(' أو ')}.`,
      );
    }
    if ('slides' in ro && !isPlainObject(ro.slides)) {
      throw new Error('حقل reportOptions.slides غير صالح: يجب أن يكون كائناً.');
    }
    if ('kpiCards' in ro && !isPlainObject(ro.kpiCards)) {
      throw new Error('حقل reportOptions.kpiCards غير صالح: يجب أن يكون كائناً.');
    }
    if ('labels' in ro) {
      if (!isPlainObject(ro.labels)) {
        throw new Error('حقل reportOptions.labels غير صالح: يجب أن يكون كائناً.');
      }
      for (const [k, v] of Object.entries(ro.labels)) {
        if (typeof v !== 'string') {
          throw new Error(`قيمة غير نصية في reportOptions.labels: "${k}".`);
        }
      }
    }
  }
  if ('automation' in doc) {
    // Unlike reportOptions the automation switches are NOT coerce-tolerant: a
    // sloppy truthy value must not be able to arm an unattended run, so anything
    // that is not a real boolean is rejected outright.
    const a = doc.automation;
    if (!isPlainObject(a)) {
      throw new Error('حقل automation غير صالح: يجب أن يكون كائناً.');
    }
    for (const k of AUTOMATION_FLAG_KEYS) {
      if (k in a && typeof a[k] !== 'boolean') {
        throw new Error(`حقل automation.${k} غير صالح: يجب أن يكون قيمة منطقية.`);
      }
    }
    if ('dailyTime' in a && (typeof a.dailyTime !== 'string' || !DAILY_TIME_RE.test(a.dailyTime))) {
      throw new Error("حقل automation.dailyTime غير صالح: يجب أن يكون وقتاً بصيغة 'HH:MM'.");
    }
    if ('labRecipients' in a) {
      if (!isPlainObject(a.labRecipients)) {
        throw new Error('حقل automation.labRecipients غير صالح: يجب أن يكون كائناً.');
      }
      for (const [k, v] of Object.entries(a.labRecipients)) {
        if (typeof v !== 'string') {
          throw new Error(`قيمة غير نصية في automation.labRecipients: "${k}".`);
        }
      }
    }
  }
  // Element-level checks: a malformed backup must fail here, not crash the
  // settings screen or report generation later.
  const finiteMap = (m, label) => {
    for (const [k, v] of Object.entries(m || {})) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`قيمة غير رقمية في ${label}: "${k}".`);
      }
    }
  };
  if (doc.tatLookup) finiteMap(doc.tatLookup, 'tatLookup');
  if (doc.historicalConstants?.cancelledByMonth) finiteMap(doc.historicalConstants.cancelledByMonth, 'cancelledByMonth');
  if (doc.snapshot?.numbers) finiteMap(doc.snapshot.numbers, 'snapshot.numbers');
  if (doc.displayNames) {
    for (const [k, v] of Object.entries(doc.displayNames)) {
      if (typeof v !== 'string') throw new Error(`قيمة غير نصية في displayNames: "${k}".`);
    }
  }
  if (doc.scorecard) {
    doc.scorecard.forEach((r, i) => {
      if (!isPlainObject(r) || typeof r.lab !== 'string') {
        throw new Error(`صف غير صالح في scorecard (رقم ${i + 1}).`);
      }
      for (const f of ['target', 'uploaded', 'notUploaded', 'needFix', 'available']) {
        if (f in r && (typeof r[f] !== 'number' || !Number.isFinite(r[f]))) {
          throw new Error(`قيمة "${f}" غير رقمية في scorecard (صف ${i + 1}).`);
        }
      }
    });
  }
}

// Only these top-level keys may ever be persisted — the "no PHI in storage"
// invariant depends on unknown keys being discarded before the merge.
const IMPORT_KEYS = ['schemaVersion', 'tatLookup', 'displayNames', 'scorecard', 'historicalConstants', 'snapshot', 'snapshotHistory', 'grafana', 'reportOptions', 'automation', 'cachedTracker', 'taskLog'];

// The exact reportOptions subkeys that may be imported. Unknown slide/card keys
// are dropped; label values must be strings. Keys mirror REPORT_OPTIONS_SEED.
// 'challenges' (v6) is the «التحديات والمخاطر» slide split out of the old
// tasks-and-challenges slide; an ABSENT flag renders it (build-spec treats a
// missing key as ON), so an install that never stored it keeps the full deck.
const REPORT_OPTION_SLIDE_KEYS = ['execFunnel', 'monthly', 'compliance', 'action', 'challenges', 'definitions'];
const REPORT_OPTION_CARD_KEYS = [
  'total', 'awaitingDispatch', 'awaitingResults', 'completed', 'rejected', 'lateNoResult', 'shippedNotReceived',
];

function pickImportKeys(doc) {
  const out = {};
  for (const k of IMPORT_KEYS) if (k in doc) out[k] = doc[k];
  if (isPlainObject(out.historicalConstants)) {
    out.historicalConstants = 'cancelledByMonth' in out.historicalConstants
      ? { cancelledByMonth: out.historicalConstants.cancelledByMonth }
      : {};
  }
  if (isPlainObject(out.snapshot)) {
    const snap = out.snapshot;
    const picked = {};
    if (snap.asOf != null) picked.asOf = snap.asOf;
    // The definition stamp (model/delta-baseline.js) is a sibling of `numbers`, so
    // it has to be whitelisted here or an exported-then-reimported backup would come
    // back unstamped and fall through to date inference — reading a snapshot that is
    // already stated in the new definition as pre-change. Finite numbers only;
    // anything else is dropped, which degrades to inference (disclose, never hide).
    if (typeof snap.defVersion === 'number' && Number.isFinite(snap.defVersion)) {
      picked.defVersion = snap.defVersion;
    }
    if (isPlainObject(snap.numbers)) {
      const nums = {};
      for (const [k, v] of Object.entries(snap.numbers)) {
        if (typeof v === 'number' && Number.isFinite(v)) nums[k] = v;
      }
      picked.numbers = nums;
    } else if (snap.prevCompleted != null && Number.isFinite(Number(snap.prevCompleted))) {
      // legacy import shape → fold into the new numbers.completed baseline
      // (only when it parses to a finite number; otherwise drop the key)
      picked.numbers = { completed: Number(snap.prevCompleted) };
    }
    out.snapshot = picked;
  }
  if (isPlainObject(out.snapshotHistory)) {
    // Keep only ISO-date keys whose value is a plain object; within each, keep only
    // finite numeric leaves (mirrors snapshot.numbers sanitization).
    const picked = {};
    for (const [date, nums] of Object.entries(out.snapshotHistory)) {
      if (!ISO_DATE_RE.test(date) || !isPlainObject(nums)) continue;
      const clean = {};
      for (const [k, v] of Object.entries(nums)) {
        if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
      }
      picked[date] = clean;
    }
    out.snapshotHistory = picked;
  }
  if (isPlainObject(out.taskLog)) {
    // sanitizeTaskLog (model/task-lifecycle.js) is the single owner of the entry
    // shape — reuse it here rather than re-deriving the rules: entries without a
    // valid openOn are dropped, closedOn is normalized to a date or null, and any
    // extra field is discarded.
    out.taskLog = sanitizeTaskLog(out.taskLog);
  } else if ('taskLog' in out) {
    delete out.taskLog; // not an object → keep this device's own log
  }
  if (isPlainObject(out.grafana)) {
    // Only the five known fields ever persist — unknown subkeys are discarded.
    const g = out.grafana;
    const picked = {};
    if (typeof g.baseUrl === 'string') picked.baseUrl = g.baseUrl;
    if (typeof g.accessToken === 'string') picked.accessToken = g.accessToken;
    if (typeof g.panelId === 'number' && Number.isFinite(g.panelId)) picked.panelId = g.panelId;
    if ('enabled' in g) picked.enabled = !!g.enabled; // coerce truthy/falsy → boolean
    if (typeof g.dataKey === 'string') picked.dataKey = g.dataKey; // snapshot decrypt key
    out.grafana = picked;
  }
  if (isPlainObject(out.reportOptions)) {
    // Whitelist exactly {excludeNoTat, autoDownloadFiles, deltaMode, slides(6 keys),
    // kpiCards(7 keys), labels}. Flags coerce to booleans; only string label values
    // survive; unknown slide/card subkeys are discarded.
    const ro = out.reportOptions;
    const picked = {};
    if ('excludeNoTat' in ro) picked.excludeNoTat = !!ro.excludeNoTat;
    // v7 manual-generate auto-download. Coerce-tolerant exactly like excludeNoTat and
    // the slide/card flags — a presentation preference, not a safety switch, so a
    // sloppy truthy value from a hand-edited backup is normalized rather than rejected.
    // (automation.autoDownload, the unattended one, stays strict: see its block above.)
    if ('autoDownloadFiles' in ro) picked.autoDownloadFiles = !!ro.autoDownloadFiles;
    // Retired weekly values land as 'week'; an unrecognized value is dropped so
    // the stored default survives the merge (validateImport already rejected it).
    const dm = canonicalDeltaMode(ro.deltaMode);
    if (dm != null) picked.deltaMode = dm;
    if (isPlainObject(ro.slides)) {
      const s = {};
      for (const k of REPORT_OPTION_SLIDE_KEYS) if (k in ro.slides) s[k] = !!ro.slides[k];
      picked.slides = s;
    }
    if (isPlainObject(ro.kpiCards)) {
      const c = {};
      for (const k of REPORT_OPTION_CARD_KEYS) if (k in ro.kpiCards) c[k] = !!ro.kpiCards[k];
      picked.kpiCards = c;
    }
    if (isPlainObject(ro.labels)) {
      const l = {};
      for (const [k, v] of Object.entries(ro.labels)) if (typeof v === 'string') l[k] = v;
      picked.labels = l;
    }
    out.reportOptions = picked;
  }
  if (isPlainObject(out.automation)) {
    // Whitelist exactly {7 boolean switches, dailyTime 'HH:MM', labRecipients map
    // of strings}. Unknown subkeys are discarded; a non-boolean switch or a
    // malformed dailyTime is dropped (validateImport already rejected those, this
    // is the belt-and-braces pass) so the stored default survives the merge.
    const a = out.automation;
    const picked = {};
    for (const k of AUTOMATION_FLAG_KEYS) if (typeof a[k] === 'boolean') picked[k] = a[k];
    if (typeof a.dailyTime === 'string' && DAILY_TIME_RE.test(a.dailyTime)) {
      picked.dailyTime = a.dailyTime;
    }
    if (isPlainObject(a.labRecipients)) {
      const r = {};
      for (const [k, v] of Object.entries(a.labRecipients)) if (typeof v === 'string') r[k] = v;
      picked.labRecipients = r;
    }
    out.automation = picked;
  }
  if ('cachedTracker' in out) {
    const ct = out.cachedTracker;
    if (ct === null) {
      out.cachedTracker = null;
    } else if (isPlainObject(ct) && isPlainObject(ct.model) && typeof ct.updatedAt === 'string') {
      out.cachedTracker = { model: ct.model, updatedAt: ct.updatedAt };
    } else {
      // Anything else is not a valid cache — drop it rather than persist junk.
      delete out.cachedTracker;
    }
  }
  return out;
}

/** Deep-merge with the incoming (over) document winning on every leaf/array. */
function deepMergeImportWins(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return clone(over);
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (isPlainObject(out[k]) && isPlainObject(over[k])) {
      out[k] = deepMergeImportWins(out[k], over[k]);
    } else {
      out[k] = clone(over[k]);
    }
  }
  return out;
}

/**
 * Trim a POST-MERGE taskLog back to TASK_LOG_LIMIT.
 *
 * BUG FIX (2026-08-04): validateImport bounds the INCOMING log and pickImportKeys
 * normalizes its ENTRY SHAPE, but neither bounds the RESULT — deepMergeImportWins
 * unions the two maps per key. A device already at the cap (recordShownTasks caps
 * every write at TASK_LOG_LIMIT) importing a backup with that many DIFFERENT keys
 * stored 2× the cap, and its own next export was then rejected by validateImport
 * ("حقل taskLog كبير جداً: 600 عنصراً") — export → import → export was not closed
 * under the validator, and the key quietly doubled its localStorage footprint until
 * the next successful generation pruned it.
 *
 * The cap RULE stays owned by model/task-lifecycle.js: recordShownTasks with no
 * argument bag is its sanitize-and-prune-only entry point — an unusable reportDate
 * returns prune(log, null), which drops nothing by date and only trims to
 * TASK_LOG_LIMIT by most-recently-touched. Nothing is re-derived here.
 * @param {*} log
 * @returns {Object<string,{openOn:string, closedOn:string|null}>}
 */
function capTaskLog(log) {
  return recordShownTasks(log, null);
}

/**
 * Names of the automation switches an import flips ON (absent/false -> true).
 * The import layer round-trips the automation block verbatim on purpose — that is
 * how a configured install is restored on another machine — so a backup CAN arm
 * the unattended pipeline. What the store can do is refuse to be quiet about it:
 * the caller gets the exact switch list and can tell the user automation was
 * turned on, instead of the next visit to رفع البيانات pulling and generating
 * with nothing on screen having said so.
 * @returns {string[]} subset of AUTOMATION_FLAG_KEYS, in declaration order
 */
function armedAutomationSwitches(base, incoming) {
  const b = isPlainObject(base) ? base : {};
  const inc = isPlainObject(incoming) ? incoming : {};
  const armed = [];
  for (const k of AUTOMATION_FLAG_KEYS) {
    if (inc[k] === true && b[k] !== true) armed.push(k);
  }
  return armed;
}

function countMapChanges(base, incoming) {
  const b = base || {};
  const inc = incoming || {};
  let added = 0;
  let updated = 0;
  for (const k of Object.keys(inc)) {
    if (!(k in b)) added += 1;
    else if (b[k] !== inc[k]) updated += 1;
  }
  return { added, updated };
}

/**
 * Validate + deep-merge (import wins) + persist. Rejects unknown/malformed docs
 * with a descriptive Error.
 * @param {string} jsonText
 * @returns {{tatLookup:{added:number,updated:number}, displayNames:{added:number,updated:number},
 *   cancelledByMonth:{added:number,updated:number},
 *   scorecard:{before:number,after:number,replaced:boolean}, snapshotChanged:boolean,
 *   automationArmed:string[]}} summary
 *   automationArmed lists the automation switches this import turned ON (empty on
 *   the common path). Callers MUST surface it — an imported backup can arm the
 *   unattended pipeline, and that must never happen silently.
 */
export function importSettings(jsonText) {
  let incoming;
  try {
    incoming = JSON.parse(jsonText);
  } catch (_e) {
    throw new Error('ملف غير صالح: تعذّر قراءة JSON.');
  }
  validateImport(incoming);
  const wasV1 = incoming.schemaVersion === 1;
  const preWeekBackup = typeof incoming.schemaVersion === 'number' && incoming.schemaVersion <= 6;
  incoming = pickImportKeys(incoming); // discard unknown keys — nothing but config may persist
  if (wasV1) {
    // A v1 backup's cancelledByMonth carries max-era (data-derived) months that
    // would double-count under v2's additive engine. Replace it with the
    // manual-only seed — the same transform the v1→v2 stored-doc migration runs.
    incoming.historicalConstants = {
      cancelledByMonth: { ...HISTORICAL_CONSTANTS_SEED.cancelledByMonth },
    };
  }
  if (preWeekBackup && incoming.reportOptions && 'deltaMode' in incoming.reportOptions) {
    // A pre-v7 backup's deltaMode is the OLD default ('daily' in v3-v6) — by
    // migrateV6toV7's own premise, "a DEFAULT nobody chose". Importing it verbatim
    // would permanently undo the one-time week-default migration (saveSettings stamps
    // the current schemaVersion, so migrate() never routes the doc through v6→v7
    // again). Drop it and let the device's migrated value stand — the same
    // backup-needs-the-migration idea as the wasV1 fixup above. A deltaMode chosen
    // AFTER v7 shipped travels in a v7 backup and imports untouched.
    delete incoming.reportOptions.deltaMode;
  }

  const current = clone(loadSettings());
  const merged = deepMergeImportWins(current, incoming);
  // The definition stamp REPLACES, it never merges: it describes the number set it
  // ships with. An imported snapshot that carries no stamp is an unstamped snapshot,
  // so it must not inherit this device's leftover one — that would hide a real
  // definition shift instead of disclosing it (model/delta-baseline.js). A valid
  // incoming stamp was kept by pickImportKeys and wins here as usual.
  if (isPlainObject(incoming.snapshot) && isPlainObject(merged.snapshot)
      && !('defVersion' in incoming.snapshot)) {
    delete merged.snapshot.defVersion;
  }
  // The taskLog merge is a per-key UNION, so two in-bounds logs can produce an
  // out-of-bounds one. Re-apply the cap the validator enforces (see capTaskLog),
  // and ONLY when the union actually overflowed — an in-bounds import must merge
  // exactly as before, keeping even entries this device stored by hand.
  if (isPlainObject(merged.taskLog) && Object.keys(merged.taskLog).length > TASK_LOG_LIMIT) {
    merged.taskLog = capTaskLog(merged.taskLog);
  }

  const summary = {
    tatLookup: countMapChanges(current.tatLookup, incoming.tatLookup),
    displayNames: countMapChanges(current.displayNames, incoming.displayNames),
    cancelledByMonth: countMapChanges(
      current.historicalConstants && current.historicalConstants.cancelledByMonth,
      incoming.historicalConstants && incoming.historicalConstants.cancelledByMonth,
    ),
    scorecard: {
      before: Array.isArray(current.scorecard) ? current.scorecard.length : 0,
      after: Array.isArray(merged.scorecard) ? merged.scorecard.length : 0,
      replaced: Array.isArray(incoming.scorecard),
    },
    snapshotChanged:
      !!incoming.snapshot &&
      JSON.stringify(current.snapshot) !== JSON.stringify(merged.snapshot),
    automationArmed: armedAutomationSwitches(current.automation, incoming.automation),
  };

  saveSettings(merged);
  return summary;
}
