// store.js — Track C persistence layer.
// A single versioned config document persisted at SETTINGS_KEY in localStorage.
// NO PATIENT DATA EVER: patient/order rows stay memory-only — there is no
// rows/orders API here by design, so PHI can never structurally land in storage.
// What IS stored is configuration plus two integration fields:
//   • grafana — live-source config. grafana.accessToken is a Grafana PUBLIC-
//     dashboard token: view-only, server-side-masked data, never a login/PHI key.
//   • cachedTracker — the last parsed Project Tracker (PROJECT-management content:
//     tasks/challenges/risks). This is explicitly allowed; it is NOT patient data.
// All localStorage access is wrapped in try/catch because Safari private mode
// throws on write; on failure we fall back to an in-memory doc and expose
// isEphemeral() so the UI can warn the user their edits will not persist.

import { SETTINGS_KEY } from './contracts.js?v=v2026-07-22.7';
import { TAT_LOOKUP } from './seeds/tat-lookup.js?v=v2026-07-22.7';
import { SCORECARD_SEED } from './seeds/scorecard.js?v=v2026-07-22.7';
import {
  HISTORICAL_CONSTANTS_SEED, SNAPSHOT_SEED, GRAFANA_SEED, REPORT_OPTIONS_SEED,
} from './seeds/defaults.js?v=v2026-07-22.7';

export const SCHEMA_VERSION = 2;

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
    grafana: { ...GRAFANA_SEED },
    reportOptions: clone(REPORT_OPTIONS_SEED), // deep clone: nested slides/kpiCards/labels
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
  backfillReportOptions(doc); // add reportOptions + any new slide/card subkeys
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

/** Version-check + migrate/reset. Unknown versions reset to seeds. */
function migrate(doc) {
  if (!isPlainObject(doc)) {
    console.warn('[misbar/store] settings root is not an object — resetting to seeds.');
    return persist(buildSeedDoc());
  }
  if (doc.schemaVersion === SCHEMA_VERSION) return migrateSnapshotShape(doc);
  if (doc.schemaVersion === 1) return persist(migrateV1toV2(doc));
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
  doc.snapshot = {
    asOf: asOf != null ? String(asOf) : cur.asOf,
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
 * Serialize the whole config doc for download.
 * @returns {{filename:string, blob:Blob}}
 */
export function exportSettings() {
  const doc = loadSettings();
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

function validateImport(doc) {
  if (!isPlainObject(doc)) {
    throw new Error('ملف الإعدادات غير صالح: الجذر ليس كائناً.');
  }
  // Accept v1 (transformed on import) or the current v2. Anything else is rejected.
  if (doc.schemaVersion !== 1 && doc.schemaVersion !== SCHEMA_VERSION) {
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
    // excludeNoTat and the slide/card flags are coerce-tolerant (normalized to
    // booleans in pickImportKeys); only the container shapes are enforced here.
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
const IMPORT_KEYS = ['schemaVersion', 'tatLookup', 'displayNames', 'scorecard', 'historicalConstants', 'snapshot', 'grafana', 'reportOptions', 'cachedTracker'];

// The exact reportOptions subkeys that may be imported. Unknown slide/card keys
// are dropped; label values must be strings. Keys mirror REPORT_OPTIONS_SEED.
const REPORT_OPTION_SLIDE_KEYS = ['execFunnel', 'monthly', 'compliance', 'action', 'definitions'];
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
    // Whitelist exactly {excludeNoTat, slides(4 keys), kpiCards(7 keys), labels}.
    // Flags coerce to booleans; only string label values survive; unknown
    // slide/card subkeys are discarded.
    const ro = out.reportOptions;
    const picked = {};
    if ('excludeNoTat' in ro) picked.excludeNoTat = !!ro.excludeNoTat;
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
 *   scorecard:{before:number,after:number,replaced:boolean}, snapshotChanged:boolean}} summary
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
  incoming = pickImportKeys(incoming); // discard unknown keys — nothing but config may persist
  if (wasV1) {
    // A v1 backup's cancelledByMonth carries max-era (data-derived) months that
    // would double-count under v2's additive engine. Replace it with the
    // manual-only seed — the same transform the v1→v2 stored-doc migration runs.
    incoming.historicalConstants = {
      cancelledByMonth: { ...HISTORICAL_CONSTANTS_SEED.cancelledByMonth },
    };
  }

  const current = clone(loadSettings());
  const merged = deepMergeImportWins(current, incoming);

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
  };

  saveSettings(merged);
  return summary;
}
