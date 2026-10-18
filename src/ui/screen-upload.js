// ui/screen-upload.js — file upload + parse + engine kickoff (Track E).
import { STR, todayISO, formatDateAr } from '../i18n/ar.js?v=v2026-10-18.1';
import {
  el, dropZone, fileSummaryCard, toast, trackerSaver, trackerStatusCounts, trackerStamp,
  // AUTOMATIC ARABIC (2026-10-13, CONTRACT-AUTO §5): the uploaded / restored tracker gets the
  // translation layers the moment it enters (in place), and again when the built-in memory
  // — loaded once per session — arrives.
  translateTrackerInPlace, loadBuiltinTrackerTM, trackerTranslationStatus, writePendingTrackerTranslations,
  detachTrackerFromTM,
} from './components.js?v=v2026-10-18.1';
// The project tracker («ملف متابعة المشروع», tracker CONTRACT §1.7). resolveProjectTracker
// is the model layer's ONE rule for "which tracker does this run have" (tagged only —
// an install's OLD-shape cache is no tracker); static, report-model.js is pure.
import { resolveProjectTracker } from '../model/report-model.js?v=v2026-10-18.1';
import { normTest } from '../contracts.js?v=v2026-10-18.1';
import { getPapa, getXLSX } from '../vendor-loader.js?v=v2026-10-18.1';
import { TAT_LOINC } from '../seeds/tat-lookup.js?v=v2026-10-18.1';
import { buildLateLabsSection } from './late-labs-section.js?v=v2026-10-18.1';
import { buildAutomationPanel } from './automation-panel.js?v=v2026-10-18.1';
// Optional filtered-CSV download (labs × order stages → the uploaded file's own rows).
// It reads state.parsed.raw — PATIENT DATA, memory-only; see state.js for the pairing
// rule this screen upholds at every site that writes state.parsed.orders.
import { buildCsvExportSection } from './csv-export-section.js?v=v2026-10-18.1';
// THE HOSPITAL DOOR (2026-10-07; report types 2026-10-11): the feed carries KAMC's and
// SGH's orders. Every site below that writes state.parsed.orders goes through
// takeOrders(): parsed.orders = the KAMC rows — what EVERY surface of this screen reads
// (hero, unmatched-TAT panel + suggestions, late-lab files, filtered CSV) — SGH's rows
// kept beside them in parsed.ordersByHospital for the review screen's SGH and KAMC + SGH
// report types, and any third hospital dropped (only mentioned). STATIC, not a guarded
// tryImport like the ingest modules: there is no safe degraded answer — a build that
// silently skipped the split would put another hospital's orders into every number (and
// SGH test names into the global TAT table). hospital.js is pure (no DOM, no vendor
// bundle), so this adds no failure mode.
import { takeOrders } from '../model/hospital.js?v=v2026-10-18.1';
// «متابعة» assembles the report afresh, so a temporary slide order (the review's «ترتيب
// الشرائح» card) goes with the old model — state.js owns that rule.
import { clearTempSlideOrder } from '../state.js?v=v2026-10-18.1';

/** The SAME specifier main.js and ui/automation-panel.js import — resolving to
 *  the identical URL means the probe below hits the already-cached module. */
const AUTOMATION_PIPELINE_URL = '../automation/pipeline.js?v=v2026-10-18.1';

/** Format an ISO timestamp as local 'HH:MM' for snapshot-freshness labels. */
function fmtHHMM(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ *
 * DEV / MOCK fixtures — conform to contracts.js so the app runs
 * standalone (?mock=1) and other screens can borrow them.
 * ------------------------------------------------------------------ */

export function buildMockOrders() {
  const mk = (o) => ({
    orderDate: null, facility: null, orderId: null, lineNo: 1, loinc: null,
    testName: '', collected: null, dispatched: null, received: null, resulted: null,
    rawStatus: 'Order Completed', tatDaysCsv: null, ...o,
  });
  return [
    mk({ orderDate: '2026-05-04', facility: 'Advanced Laboratory Services .Co', orderId: '1001', testName: 'Kappa light chains.free/Lambda light chains.free [Mass Ratio] in Serum', resulted: '2026-05-14', rawStatus: 'Order Completed' }),
    mk({ orderDate: '2026-05-19', facility: 'Fal Specialized Medical Lab', orderId: '1002', testName: 'SEND OUT TEST COPPER BLOOD DRC-ICP-MS', received: '2026-05-20', rawStatus: 'Received' }),
    mk({ orderDate: '2026-06-02', facility: 'Advanced Laboratory Services .Co', orderId: '1003', testName: 'SEND OUT TEST IMMUNOFIXATION 24 HOUR URINE TURBIDIMETRIC IMMUNOASSAY', rawStatus: 'Dispatched', dispatched: '2026-06-03' }),
    mk({ orderDate: '2026-06-08', facility: 'king Abdullaziz Medical city in Riyadh', orderId: '1004', testName: 'SEND OUT TEST GLUCAGON PLASMA EIA', resulted: '2026-06-18', rawStatus: 'Order Completed' }),
    mk({ orderDate: '2026-06-21', facility: 'Saudi Diagnostics Limited Company', orderId: '1005', testName: 'SEND OUT TEST OXALATE 24 HOUR URINE ENZYMATIC ASSAY (EZA)', rawStatus: 'Received', received: '2026-06-22' }),
    mk({ orderDate: '2026-06-25', facility: 'Anwa  Medical Company', orderId: '1006', testName: 'SEND OUT TEST VITAMIN E BLOOD LC-MS/MS', rawStatus: 'Order Cancelled' }),
    mk({ orderDate: '2026-07-01', facility: 'Advanced Laboratory Services .Co', orderId: '1007', testName: 'SEND OUT TEST SEROTONIN WHOLE BLOOD LC-MS/MS', rawStatus: 'Order Completed', resulted: '2026-07-06' }),
    mk({ orderDate: '2026-07-05', facility: 'Fal Specialized Medical Lab', orderId: '1008', testName: 'مسحة فحص غير معروف (تجريبي)', rawStatus: 'Received', received: '2026-07-06' }),
    mk({ orderDate: '2026-07-09', facility: 'king Abdullaziz Medical city in Riyadh', orderId: '1009', testName: 'SEND OUT TEST PARVOVIRUS B19-DNA PCR BLOOD', rawStatus: 'Order Cancelled' }),
    mk({ orderDate: '2026-07-12', facility: 'Advanced Laboratory Services .Co', orderId: '1010', testName: 'SEND OUT TEST COPPER URINE 24 HOURS ICP-MS', rawStatus: 'Dispatched', dispatched: '2026-07-13' }),
  ];
}

/** A SYNTHETIC ProjectTracker (the new «ملف متابعة المشروع» shape, ingest/task-tracker.js)
 *  for the explicit dev mock mode (?mock=1) and the harnesses ONLY — never a fallback in a
 *  real flow (a mock once printed fake tasks into a real deck). Made-up tasks and owners;
 *  the field values use the workbook's own vocabulary (statuses incl. its 'Deleyed'
 *  spelling, a 'daily' due, a blank status) so every display branch is exercised — and
 *  made-up Arabic translations (every group named, every task but the last translated —
 *  the parser fills trackAr / milestoneAr down a group too), so the slide's Arabic,
 *  English and «both» modes and the per-row English fallback all show in ?mock=1. */
// Identity set of the mock documents handed out, so the review editor can tell one apart
// WITHOUT a marker key on the document (its shape is the parser's, nothing extra rides
// into storage): edits to a mock are previewed but never saved to settings.cachedTracker,
// which the automation publishes from.
const MOCK_TRACKERS = new WeakSet();
/** True for a document buildMockTracker made (pure; exported for the review screen). */
export function isMockTracker(t) {
  return !!t && typeof t === 'object' && MOCK_TRACKERS.has(t);
}

export function buildMockTracker() {
  const at = '2026-10-01T08:00:00.000Z';
  const task = (wbs, track, milestone, workstream, workPackage, text, taskType, organization, owner, priority, status, due, predecessor = '', ar = {}) => ({
    id: wbs, wbs, track, milestone, workstream, workPackage, task: text, taskType, organization,
    owner, priority, status, due, predecessor, nextAction: '', definitionOfDone: '', notes: '',
    taskAr: ar.task || '', trackAr: ar.track || '', milestoneAr: ar.milestone || '',
  });
  // Made-up Arabic names for the mock's made-up groups.
  const AR = (taskText, track, milestone) => ({ task: taskText, track, milestone });
  const doc = {
    format: 'misbar-task-tracker-v1',
    fileName: 'mock-task-tracker.xlsx',
    loadedAt: at,
    editedAt: null,
    warnings: [],
    tasks: [
      task('1.1.1', 'Integration', 'Partner A', 'Product & Integration', 'Partner A Integration', 'Confirm Partner A integration scope (mock)', 'Integration', 'NUPCO / LEAN', 'Owner A', 'High', 'Completed', '2026-09-06', '', AR('تأكيد نطاق التكامل مع الشريك أ (تجريبي)', 'التكامل', 'الشريك أ')),
      task('1.1.2', 'Integration', 'Partner A', 'Product & Integration', 'Partner A Integration', 'Complete Partner A integration testing (mock)', 'Integration', 'LEAN', 'Owner B', 'Critical', 'In Progress', '2026-09-14', '1.1.1', AR('إكمال اختبارات التكامل مع الشريك أ (تجريبي)', 'التكامل', 'الشريك أ')),
      task('1.2.1', 'Integration', 'Labs', 'Operations', 'Laboratory Operations', 'Monitor overdue tests daily (mock)', 'Recurring Activity', 'LEAN', 'Owner B', 'High', 'In Progress', 'daily', '', AR('متابعة الفحوصات المتأخرة يوميًا (تجريبي)', 'التكامل', 'المختبرات')),
      task('2.1.1', 'Rollout', 'Site X', 'Onboarding', 'Site X Onboarding', 'Close Site X readiness gaps (mock)', 'Onboarding', 'NUPCO / LEAN', 'Owner C', 'Critical', 'Deleyed', '2026-09-13', '', AR('سد فجوات جاهزية الموقع س (تجريبي)', 'الإطلاق', 'الموقع س')),
      task('2.1.2', 'Rollout', 'Site X', 'Onboarding', 'Site X Onboarding', 'Site X go-live (mock)', 'Milestone', 'NUPCO / LEAN', 'Owner C', 'Critical', 'Blocked', '2026-08-13', '2.1.1', AR('إطلاق الموقع س (تجريبي)', 'الإطلاق', 'الموقع س')),
      task('3.1.1', 'Governance', 'Governance', 'Governance', 'Governance Framework', 'Finalize the governance framework (mock)', 'Deliverable', 'NUPCO', 'Owner D', 'Medium', 'In Progress', '', '', AR('اعتماد إطار الحوكمة (تجريبي)', 'الحوكمة', 'الحوكمة')),
      task('3.1.2', 'Governance', 'Governance', 'Governance', 'Product Roadmap', 'Draft the product roadmap (mock)', 'Deliverable', 'LEAN', 'Owner D', 'High', '', '2026-10-30', '', AR('', 'الحوكمة', 'الحوكمة')),
    ],
  };
  MOCK_TRACKERS.add(doc);
  // Its translation passes never read or write the user's memory (components.js — see there).
  detachTrackerFromTM(doc);
  return doc;
}

/** EngineOutput mock seeded from test/fixtures numbers; deltas computed vs settings.
 *  Re-baselined 2026-07-28 alongside test/fixtures/golden-expected.js for the user
 *  decision "consider rejected as completed test": completed = non-cancelled AND
 *  (has a result date OR rejected) = 422 + 15 = 437. Every surface that prints
 *  'فحوصات مكتملة' (exec KPI card, funnel stage 5, monthly row, compliance column)
 *  resolves to 437 here, so the ?mock=1 deck cannot contradict itself. */
export function buildMockEngineOutput(settings) {
  const snap = (settings && settings.snapshot) || {};
  const prev = (snap.numbers && snap.numbers.completed) != null
    ? snap.numbers.completed
    : (snap.prevCompleted != null ? snap.prevCompleted : 437); // legacy shape tolerance
  return {
    totals: { lines: 628, cancelledInData: 10, total: 618 },
    // FINAL STAGE = COMPLETED. `resulted` is the LEGACY ALIAS carrying the SAME
    // number as `completed` (never the dated-only 422) — never add the two.
    funnel: { created: 618, collected: 612, dispatched: 608, received: 596, resulted: 437, completed: 437 },
    // PARTITION: total = awaitingDispatch + shippedNotReceived + awaitingResults +
    // completed (10 + 12 + 159 + 437 = 618). `rejected` keeps its own value but is a
    // SUBSET of completed — reported, never added alongside it.
    buckets: { awaitingDispatch: 10, shippedNotReceived: 12, awaitingResults: 159, completed: 437, rejected: 15, lateNoResult: 67, latePct: 42.1 },
    // PARTITION: orders = results + pending, where `results` follows the COMPLETED
    // rule (result date OR rejected), so `rejected` is a SUBSET of results and
    // incomplete (= orders − results) equals pending — no double count.
    monthly: [
      { month: '2026-01', orders: 0, results: 0, rejected: 0, pending: 0, incomplete: 0, completionPct: null, cancelled: 8 },
      { month: '2026-02', orders: 0, results: 0, rejected: 0, pending: 0, incomplete: 0, completionPct: null, cancelled: 1 },
      { month: '2026-03', orders: 0, results: 0, rejected: 0, pending: 0, incomplete: 0, completionPct: null, cancelled: 30 },
      { month: '2026-04', orders: 3, results: 3, rejected: 0, pending: 0, incomplete: 0, completionPct: 100, cancelled: 4 },
      { month: '2026-05', orders: 105, results: 90, rejected: 14, pending: 15, incomplete: 15, completionPct: 85.7, cancelled: 6 },
      { month: '2026-06', orders: 410, results: 341, rejected: 1, pending: 69, incomplete: 69, completionPct: 83.2, cancelled: 4 },
      { month: '2026-07', orders: 100, results: 3, rejected: 0, pending: 97, incomplete: 97, completionPct: 3, cancelled: 0 },
    ],
    cancelledNote: 53,
    turnaround: {
      overallActual: 12.0, overallExpected: 7.0,
      perMonth: [
        { month: '2026-01', actual: null, expected: null },
        { month: '2026-02', actual: null, expected: null },
        { month: '2026-03', actual: null, expected: null },
        { month: '2026-04', actual: 20.3, expected: 4.4 },
        { month: '2026-05', actual: 23.3, expected: 7.6 },
        { month: '2026-06', actual: 9.4, expected: 7.0 },
        { month: '2026-07', actual: 2.0, expected: 2.5 },
      ],
    },
    // HEADLINE PARTITION: total = pipeline + awaitingResult + completed, where
    // completed = resulted + rejected (sums to 437 — the same number as
    // buckets.completed / funnel / the monthly results row). resulted, onTime,
    // resultedLate and rejected are all SUBSETS of completed — never added
    // alongside it; the old 5-way identity (pipeline + awaitingResult + onTime +
    // resultedLate + rejected = total) still holds exactly.
    byLab: [
      { lab: 'Advanced Laboratory Services .Co', total: 301, pipeline: 11, awaitingResult: 89, completed: 201, onTime: 29, resulted: 187, resultedLate: 158, rejected: 14, late: 60, latePct: 67.4 },
      { lab: 'Fal Specialized Medical Lab', total: 151, pipeline: 6, awaitingResult: 21, completed: 124, onTime: 75, resulted: 123, resultedLate: 48, rejected: 1, late: 2, latePct: 9.5 },
      { lab: 'king Abdullaziz Medical city in Riyadh', total: 113, pipeline: 1, awaitingResult: 35, completed: 77, onTime: 42, resulted: 77, resultedLate: 35, rejected: 0, late: 3, latePct: 8.6 },
      { lab: 'Eurofins clinical', total: 27, pipeline: 3, awaitingResult: 0, completed: 24, onTime: 20, resulted: 24, resultedLate: 4, rejected: 0, late: 0, latePct: 0 },
      { lab: 'Saudi Diagnostics Limited Company', total: 19, pipeline: 1, awaitingResult: 7, completed: 11, onTime: 4, resulted: 11, resultedLate: 7, rejected: 0, late: 2, latePct: 28.6 },
      { lab: 'Anwa  Medical Company', total: 7, pipeline: 0, awaitingResult: 7, completed: 0, onTime: 0, resulted: 0, resultedLate: 0, rejected: 0, late: 0, latePct: 0 },
    ],
    byTest: [
      { testName: 'BK Virus Quantitative PCR', late: 0, onTime: 20 },
      { testName: 'MOG Ab IgG IFT Blood', late: 0, onTime: 1 },
      { testName: 'Myoglobin Urine', late: 0, onTime: 1 },
      { testName: 'HLA Class I Genotyping (NGS)', late: 0, onTime: 9 },
      { testName: 'Glucagon Plasma', late: 1, onTime: 0 },
      { testName: 'HLA PRA Screening', late: 1, onTime: 2 },
      { testName: 'HLA PRA II Single Antigen', late: 1, onTime: 3 },
      { testName: 'HLA PRA I SA Single Antigen', late: 1, onTime: 3 },
      { testName: 'Oligoclonal Banding CSF/Serum', late: 2, onTime: 0 },
      { testName: 'GAD65 Ab Assay Serum (RIA)', late: 2, onTime: 0 },
      { testName: 'Treponema Pallidum (VDRL)', late: 2, onTime: 0 },
      { testName: 'Kidney Stone Analysis (IR)', late: 2, onTime: 0 },
      { testName: 'Immunofixation 24h Urine', late: 3, onTime: 4 },
      { testName: 'Copper Blood DRC-ICP-MS', late: 4, onTime: 1 },
      { testName: 'Urine Protein Electrophoresis 24h', late: 7, onTime: 9 },
      { testName: 'Ig Free Light Chain 24h Urine', late: 15, onTime: 4 },
      { testName: 'Kappa/Lambda Free Light Chains [Serum]', late: 15, onTime: 1 },
    ],
    unmatchedTests: [],
    deltas: {
      total: 0, collected: 0, dispatched: 0, received: 0,
      completed: Math.max(0, 437 - prev),
      rejected: 0,
      awaitingDispatch: 0, shippedNotReceived: 0, awaitingResults: 0, lateNoResult: 0,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Ingest adapters — call Track B modules if present, tolerate several
 * export names / call signatures, normalize to contract shapes.
 * ------------------------------------------------------------------ */

async function tryImport(path) {
  try { return await import(path); } catch { return null; }
}

function pickFn(mod, names) {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function') return mod[n];
  if (typeof mod.default === 'function') return mod.default;
  return null;
}

async function callFlexible(fn, argSets) {
  let lastErr = null;
  for (const args of argSets) {
    try {
      let r = fn(...args);
      if (r && typeof r.then === 'function') r = await r;
      if (r != null) return r;
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return null;
}

function normalizeOrders(res) {
  if (!res) return null;
  const orders = Array.isArray(res) ? res
    : res.orders || res.rows || res.data || null;
  if (!Array.isArray(orders)) return null;
  const errors = res.errors || res.warnings || [];
  // parseKamcCsv's untouched parsed rows (every column, patient ones included) for the
  // filtered-CSV download. Passed through by SHAPE only — a bare-array result or a
  // parser whose `raw` is something else yields null, i.e. «no export», never a guess.
  const r = Array.isArray(res) ? null : res.raw;
  const raw = (r && Array.isArray(r.fields) && Array.isArray(r.records)) ? r : null;
  return { orders, errors: errors.map(String), raw };
}

async function ingestCsv(file) {
  const Papa = await getPapa();
  const mod = await tryImport('../ingest/csv.js?v=v2026-10-18.1');
  const fn = pickFn(mod, ['parseKamcCsv', 'parseCsv', 'ingestCsv', 'parseOrders', 'parse']);
  if (fn) {
    const text = await file.text();
    const out = await callFlexible(fn, [[text, Papa], [file, Papa], [Papa, text], [Papa, file], [{ file, text, Papa }]]);
    const norm = normalizeOrders(out);
    if (norm) return norm;
  }
  return { orders: null, errors: [], _missing: true };
}

/* The «ملف متابعة المشروع» upload: the NEW MISBAR Task Tracker parser, called DIRECTLY —
 * never through callFlexible, which retries other argument shapes and rethrows the LAST
 * error, so the parser's specific Arabic rejection («هذا ملف المتابعة القديم…», «الملف لا
 * يطابق صيغة…») would surface as an unrelated TypeError. Throws: handleFile shows the
 * message in the zone's error list and leaves the previous tracker and the cache alone.
 * The ingest module is loaded on demand like the other ingest modules; absent, the upload
 * FAILS with a message (it used to fall back to mock tasks — never again). */
async function ingestTracker(file) {
  const XLSX = await getXLSX();
  const mod = await tryImport('../ingest/task-tracker.js?v=v2026-10-18.1');
  if (!mod || typeof mod.parseTaskTracker !== 'function') throw new Error(STR.upload.trackerModuleMissing);
  const buf = await file.arrayBuffer();
  let tracker = mod.parseTaskTracker(buf, XLSX, { fileName: file.name });
  if (tracker && typeof tracker.then === 'function') tracker = await tracker;
  if (!resolveProjectTracker(tracker, null)) throw new Error(STR.upload.trackerModuleMissing);
  if (!tracker.fileName) tracker.fileName = file.name;
  return tracker;
}

/* ------------------------------------------------------------------ *
 * Summaries + unmatched
 * ------------------------------------------------------------------ */

function dateRange(dates) {
  const valid = dates.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10)).sort();
  if (!valid.length) return null;
  return { min: valid[0], max: valid[valid.length - 1] };
}

function csvStats(orders) {
  const ids = new Set();
  let cancelled = 0;
  for (const o of orders) {
    if (o.orderId != null) ids.add(String(o.orderId));
    // EXACT literal, matching engine.js's cancelled test (was a /cancel/i regex,
    // which also swallowed e.g. 'Cancellation Requested' and let the upload
    // preview disagree with the deck). Statuses are matched exactly, never fuzzily.
    if (o.rawStatus === 'Order Cancelled') cancelled++;
  }
  const r = dateRange(orders.map((o) => o.orderDate));
  return {
    lines: orders.length,
    distinct: ids.size,
    cancelled,
    range: r ? `${formatDateAr(r.min)} – ${formatDateAr(r.max)}` : '—',
  };
}

function computeUnmatched(orders, tatLookup) {
  const keys = new Set(Object.keys(tatLookup || {}).map(normTest));
  const seen = new Map();
  for (const o of orders) {
    const name = o.testName;
    if (!name) continue;
    const n = normTest(name);
    if (!keys.has(n) && !seen.has(n)) seen.set(n, name);
  }
  return [...seen.values()];
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export async function render(container, ctx) {
  const { state, store, navigate } = ctx;
  const params = new URLSearchParams(location.search);
  const isMock = params.get('mock') === '1';
  const isDev = params.get('dev') === '1' || isMock;

  let usedMock = false;
  let fetchInFlight = false; // guards the auto-fetch + manual button against overlap
  let proceedBtn = null; // the sticky proceed button (rebuilt each paint)
  let heroSeq = 0; // guards overlapping async hero runs — only the latest paints
  let unmatchedSeq = 0; // guards overlapping async suggestion runs on the unmatched panel
  let lateLabsSeq = 0; // guards overlapping async late-labs Excel-card runs
  // { orders, raw, name } the mounted filtered-CSV card was built from (paintCsvExport).
  // Declared up here with the other per-render paint guards, not beside its helper: a
  // `let` lower in render() is in its TDZ for any paint() that runs before that line.
  let csvExportBuiltFor = null;
  const errorsByKind = { csv: [], tracker: [] };
  // Set when THIS render's upload replaced a tracker document that had website edits
  // (its editedAt) — the summary card says so: the upload overwrote them (CONTRACT §1.3).
  let trackerEditsReplacedAt = null;
  // A review edit still inside its save debounce lands NOW, before this screen reads the
  // cache (restore below) or an upload replaces the document.
  trackerSaver.flush();

  const head = el('div', { class: 'screen__head' }, [
    el('h1', { text: STR.upload.title }),
    el('p', { text: STR.upload.subtitle }),
  ]);

  const csvZone = dropZone({
    title: STR.upload.csvZoneTitle, hint: STR.upload.csvZoneHint, accept: '.csv,text/csv',
    onFile: (f) => handleFile('csv', f),
  });
  const trackerZone = dropZone({
    title: STR.upload.trackerZoneTitle, hint: STR.upload.trackerZoneHint,
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    onFile: (f) => handleFile('tracker', f),
  });
  const dropgrid = el('div', { class: 'dropgrid' }, [csvZone.el, trackerZone.el]);

  // Live Grafana source (enabled + configured in Settings → الاتصال المباشر)
  const gcfg = (store.settings && store.settings.grafana) || {};
  // Live-fetch is usable with EITHER the direct connection (baseUrl+token) or
  // just the snapshot decrypt key — don't gate the button on the direct fields.
  const grafanaReady = !!(gcfg.enabled && ((gcfg.baseUrl && gcfg.accessToken) || (gcfg.dataKey || '').trim()));
  const grafanaBtn = grafanaReady ? el('button', {
    class: 'btn btn--primary', text: STR.upload.grafanaFetch, onClick: fetchLive,
  }) : null;
  const freshnessEl = grafanaReady ? el('p', { class: 'small muted', style: 'margin:8px 0 0' }) : null;
  const grafanaBar = grafanaReady ? el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: STR.upload.grafanaTitle }),
    grafanaBtn,
    el('span', { class: 'small muted', style: 'margin-inline-start:10px', text: STR.upload.grafanaHint }),
    freshnessEl,
  ]) : null;

  // Surface the available snapshot's age BEFORE the user fetches: the exporter
  // publishes a tiny plaintext meta file next to the encrypted snapshot.
  async function paintFreshness() {
    if (!freshnessEl) return;
    try {
      const r = await fetch('data/kamc-live.meta.json', { cache: 'no-store' });
      if (!r.ok) return;
      const meta = await r.json();
      const at = new Date(meta.fetchedAt);
      if (Number.isNaN(at.getTime())) return;
      const now = new Date();
      const sameDay = at.toDateString() === now.toDateString();
      const when = (sameDay ? '' : `${String(at.getDate()).padStart(2, '0')}/${String(at.getMonth() + 1).padStart(2, '0')} `) + fmtHHMM(meta.fetchedAt);
      const ageH = (now - at) / 3600000;
      if (ageH > 2) {
        freshnessEl.textContent = STR.upload.snapshotStale.replace('{t}', when);
        freshnessEl.style.color = 'var(--warn-text,#B45309)';
        freshnessEl.style.fontWeight = '600';
      } else {
        freshnessEl.textContent = STR.upload.snapshotFreshness.replace('{t}', when);
        freshnessEl.style.color = '';
        freshnessEl.style.fontWeight = '';
      }
    } catch { /* offline or file absent — leave the line empty */ }
  }
  paintFreshness();

  const heroHost = el('div'); // 'لمحة اليوم' hero strip (filled by paintHero once data lands)
  // '⚡ التشغيل التلقائي' card — ALWAYS visible, directly under the data-source
  // cards and above the late-labs card, usable before any data lands. Built
  // defensively: a failure here must never take the upload screen down.
  let automationPanel = null;
  try {
    automationPanel = buildAutomationPanel({ store, state, ctx });
  } catch (e) {
    console.warn('[upload] automation panel unavailable', e);
    automationPanel = null;
  }

  /** Mirrors main.js readAutoMode(): absent/'0'/'false'/'off'/'no' is inert. */
  function urlAutoMode() {
    const raw = String(params.get('auto') || '').trim().toLowerCase();
    if (!raw || raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return null;
    return (raw === 'full' || raw === 'all') ? 'full' : 'auto';
  }

  /** True when an automation run owns the live pull — either the ?auto= URL
   *  trigger (main.js) or the automation card's own on-render auto-pull. Both
   *  reach the pipeline's pull step, which writes exactly what fetchLive()
   *  writes (state.parsed.orders + excludedHospitals / heroDataAt / files.csv). */
  function automationWillPull() {
    const mode = urlAutoMode();
    if (mode === 'full') return true; // ?auto=full forces every boolean on for that run
    const a = (store.settings && store.settings.automation) || {};
    if (!a.enabled || !a.autoPull) return false; // a stored off vetoes both paths
    return mode === 'auto' || !!automationPanel;
  }

  // Daily flow: kick off the live fetch on load so data is already streaming in.
  // fetchLive() is hoisted; the guards here (and its own button-disable) prevent
  // a double-invoke if the user also clicks الجلب المباشر. When automation is
  // going to pull, stand down entirely: two concurrent pulls both write the
  // order rows and the LAST to land wins, so a snapshot fallback can overwrite
  // fresher direct rows and flip the hero strip back to a stale timestamp. If
  // the pipeline module turns out to be absent nobody else pulls — take it back.
  if (grafanaReady && !state.parsed.orders && !fetchInFlight) {
    if (!automationWillPull()) fetchLive();
    else {
      tryImport(AUTOMATION_PIPELINE_URL).then((mod) => {
        if (mod && typeof mod.runAutomation === 'function') return; // automation owns the pull
        if (!state.parsed.orders && !fetchInFlight) fetchLive();
      });
    }
  }

  const summaryHost = el('div');
  const lateLabsHost = el('div'); // per-lab 'Late & Due' Excel card (filled by paintLateLabs once data lands)
  const csvExportHost = el('div'); // optional filtered-CSV download card (filled by paintCsvExport once data lands)
  const unmatchedHost = el('div');
  const actionsHost = el('div', { class: 'sticky-actions' });

  const devBar = isDev ? el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: 'أدوات المطور' }),
    el('button', { class: 'btn btn--ghost btn--sm', text: STR.upload.loadSamples, onClick: loadSamples }),
    isMock ? el('span', { class: 'small muted', style: 'margin-inline-start:8px', text: '(mock)' }) : null,
  ]) : null;

  container.appendChild(el('div', { class: 'screen' }, [
    head, heroHost, grafanaBar, dropgrid, devBar, automationPanel, summaryHost, lateLabsHost, csvExportHost, unmatchedHost, actionsHost,
  ]));

  // Reuse the persisted project tracker (settings.cachedTracker — the last upload plus
  // its website edits) when no fresh file was dropped: it changes rarely, so with the
  // live Grafana source generate needs no files. TAGGED documents only: an install still
  // holding the OLD tracker's untagged cache restores nothing (no tracker, no slides).
  if (!resolveProjectTracker(state.parsed.tracker, null)) {
    const settingsNow = store.settings;
    const cached = resolveProjectTracker(null, settingsNow);
    state.parsed.tracker = cached;
    // The restored document gets its Arabic too (a cache from before translations, or one
    // the user's corrections / the built-in memory have grown since) — CONTRACT-AUTO §5.
    if (cached) translateTrackerInPlace(cached, settingsNow, state.trackerBuiltinTM);
    if (cached) {
      const when = trackerStamp(cached.editedAt || cached.loadedAt).slice(0, 10);
      state.files.tracker = { name: `${STR.upload.cachedTrackerName}${cached.fileName ? ` — ${cached.fileName}` : ''}${when ? ` (${when})` : ''}` };
    } else {
      state.files.tracker = null; // no document (an old-shape cache restores nothing)
    }
  }

  // The built-in translation memory (encrypted, decrypted with the data key) — loaded ONCE
  // per session and never awaited: the tracker shows what it has now, and when the memory
  // arrives the document (restored or just uploaded) is re-applied in place and the card
  // repainted with the new «N من M» (CONTRACT-AUTO §5).
  if (state.trackerBuiltinTM === undefined) {
    loadBuiltinTrackerTM(state, store, tryImport).then(() => {
      const t = resolveProjectTracker(state.parsed.tracker, null);
      if (!t || !summaryHost.isConnected) return;
      if (translateTrackerInPlace(t, store.settings, state.trackerBuiltinTM)) paint();
    });
  }

  // Restore visual state if returning to this screen with data already parsed.
  if (state.files.csv) csvZone.setLoaded(state.files.csv.name);
  if (state.files.tracker) trackerZone.setLoaded(state.files.tracker.name);

  async function fetchLive() {
    if (fetchInFlight) return; // a fetch is already running (auto-load or a prior click)
    fetchInFlight = true;
    state.liveFetchInFlight = true; // shared signal — the automation pull step can skip on it
    grafanaBtn.disabled = true;
    grafanaBtn.textContent = STR.upload.grafanaFetching;
    errorsByKind.csv = [];
    const gcfg = (store.settings && store.settings.grafana) || {};
    const dataKey = (gcfg.dataKey || '').trim();
    try {
      const mod = await import('../ingest/grafana.js?v=v2026-10-18.1');
      const asOf = state.reportDate || todayISO();
      const directConfigured = !!(gcfg.baseUrl && gcfg.accessToken);
      try {
        // Preferred path: direct browser → Grafana query (when configured).
        if (!directConfigured) throw new TypeError('direct source not configured');
        const res = await mod.fetchKamcOrders(gcfg, {
          fromMs: mod.yearStartMs(asOf), toMs: Date.now(),
        });
        // The toast counts the KAMC rows — the same number the summary card shows; SGH's
        // lines and any third hospital's are announced under it by paint().
        const kept = takeOrders(state.parsed, res.rows);
        // Live rows carry no patient columns, and an earlier upload's raw must never
        // pair with them (state.js) — the accessor already drops it; stated for intent.
        state.parsed.raw = null;
        state.heroDataAt = new Date().toISOString(); // freshness for 'لمحة اليوم'
        errorsByKind.csv = res.errors || [];
        state.files.csv = { name: `${STR.upload.grafanaSourceName} ${new Date().toLocaleString('en-GB')}` };
        csvZone.setLoaded(state.files.csv.name);
        toast(STR.upload.grafanaOk.replace('{n}', String(kept.length)), 'ok');
      } catch (direct) {
        // A CORS/network failure surfaces as TypeError. If a data key is set, fall
        // back to the encrypted snapshot the GitHub Action publishes server-side.
        if (direct instanceof TypeError && dataKey) {
          const snap = await mod.fetchKamcSnapshot(dataKey);
          // The snapshot keeps EVERY hospital's rows (scripts/fetch-kamc.mjs does not
          // filter, so they are there when the user decides) — the split happens here.
          const kept = takeOrders(state.parsed, snap.rows);
          state.parsed.raw = null; // the encrypted snapshot has no patient columns either
          state.heroDataAt = snap.fetchedAt; // snapshot's real age, not load time
          errorsByKind.csv = snap.errors || [];
          const t = fmtHHMM(snap.fetchedAt);
          state.files.csv = { name: `${STR.upload.grafanaSnapshotName} ${t}`.trim() };
          csvZone.setLoaded(state.files.csv.name);
          toast(
            STR.upload.grafanaSnapshotOk
              .replace('{n}', String(kept.length))
              .replace('{t}', t),
            'ok', 9000,
          );
        } else {
          throw direct;
        }
      }
    } catch (e) {
      console.error('[upload] grafana fetch failed', e);
      const isCors = e instanceof TypeError; // fetch network/CORS failures surface as TypeError
      toast(isCors ? STR.upload.grafanaCors : `${STR.upload.grafanaFail}: ${(e && e.message) || e}`, 'warn', 9000);
    } finally {
      fetchInFlight = false;
      state.liveFetchInFlight = false;
      grafanaBtn.disabled = false;
      grafanaBtn.textContent = STR.upload.grafanaFetch;
      paint();
    }
  }

  /** `dev: true` = the ?dev=1 «load samples» fixture, not the user's own upload: its
   *  orders load normally but raw stays null — the filtered-CSV download (patient
   *  columns) exists only for a file the user dropped themselves (state.js). */
  async function handleFile(kind, file, { dev = false } = {}) {
    // The tracker's file is recorded only once it PARSED: a rejected file (the old
    // tracker, an unrelated workbook) leaves the previous document in place, and its
    // name must not be shown as the loaded one when this screen is painted again.
    if (kind === 'csv') state.files.csv = file;
    (kind === 'csv' ? csvZone : trackerZone).setBusy(true);
    errorsByKind[kind] = [];
    try {
      if (kind === 'csv') {
        const res = await ingestCsv(file);
        if (res._missing || !res.orders) {
          usedMock = true;
          takeOrders(state.parsed, buildMockOrders()); // same door as real rows
          state.parsed.raw = null; // mock rows have no original file behind them
          toast(STR.upload.ingestMissing, 'warn');
        } else {
          // ORDER MATTERS: orders first, then raw — assigning orders drops any raw
          // (state.js accessor), so the reverse would silently lose this upload's.
          // The ONLY place in the app raw is set to a value.
          // Orders are the KAMC rows (takeOrders); raw stays the WHOLE file, every
          // hospital's lines included, and still pairs correctly: raw
          // .records is indexed by each row's own lineNo (its index in the parse, set by
          // ingest/csv.js), not by its position in orders, so dropping rows never shifts
          // a kept row's record — and the filtered-CSV download walks orders, so an
          // excluded line is never handed back.
          takeOrders(state.parsed, res.orders);
          // The file NAME travels inside raw, captured from THIS upload. state.files.csv
          // is reassigned before a new parse resolves, so a download that read it at
          // click time could carry the NEW file's name over the OLD file's rows.
          state.parsed.raw = dev || !res.raw ? null : { ...res.raw, fileName: file.name };
          errorsByKind.csv = res.errors || [];
        }
        state.heroDataAt = new Date().toISOString(); // orders (re)landed — refresh hero freshness
      } else {
        // Throws on a wrong file (old tracker / unrelated workbook) with the parser's
        // Arabic message → the catch below lists it and marks the zone; the previous
        // tracker and the cache stay untouched.
        const tracker = await ingestTracker(file);
        // The user's Arabic corrections still waiting in the editor's save debounce are
        // written NOW (the document's own pending save is dropped below): they are keyed
        // by the English text, so they belong to the new upload just as much.
        try { writePendingTrackerTranslations(store); } catch (err) { console.warn('[upload] translation memory save failed', err); }
        // AUTOMATIC ARABIC (CONTRACT-AUTO §5): the user's normal English workbook gets its
        // Arabic HERE, before anything reads or caches it — the built-in reviewed memory (if
        // loaded; else re-applied when it arrives), the user's earlier corrections (keyed by
        // the English text, so they survive this re-upload) and the on-device machine cache.
        // An Arabic column the workbook happens to carry still wins.
        translateTrackerInPlace(tracker, store.settings, state.trackerBuiltinTM);
        // The document this upload REPLACES: had it been edited on the website, say so.
        // A save still pending for it is dropped, not flushed — it would land on top of
        // the new file in the cache.
        trackerSaver.cancel();
        const prev = resolveProjectTracker(state.parsed.tracker, store.settings);
        trackerEditsReplacedAt = prev && prev.editedAt ? prev.editedAt : null;
        state.parsed.tracker = tracker;
        state.files.tracker = file;
        // A review model drafted earlier carries the OLD document; the review re-sources
        // it on render anyway (sessionProjectTracker) — this keeps the two in step now.
        if (state.reportModel) state.reportModel.projectTracker = tracker;
        // Persist for file-less runs and the automation (project content only — never
        // patient data). The upload REPLACES the cached document and its web edits.
        try {
          if (typeof store.updateCachedTracker === 'function') store.updateCachedTracker(tracker);
        } catch (err) {
          console.warn('[upload] tracker cache failed', err);
          errorsByKind.tracker = [(err && err.message) || String(err)];
        }
      }
      (kind === 'csv' ? csvZone : trackerZone).setLoaded(file.name);
    } catch (e) {
      console.error('[upload] parse failed', kind, e);
      errorsByKind[kind] = [(e && e.message) || String(e)];
      // The orders still on screen came from an EARLIER file, but state.files.csv now
      // names the one that just failed — a download would carry that name over another
      // file's patient rows. Withhold the export until a file parses cleanly.
      if (kind === 'csv') state.parsed.raw = null;
      if (kind === 'csv') csvZone.setError();
      else {
        // The rejected file is NOT in use: say why inside the zone, and name the document
        // that still is (state.files.tracker is only ever set by a successful parse).
        trackerZone.setError(errorsByKind.tracker[0],
          state.files.tracker ? STR.upload.trackerStillUsing(state.files.tracker.name) : '');
      }
    } finally {
      (kind === 'csv' ? csvZone : trackerZone).setBusy(false);
      paint();
    }
  }

  async function loadSamples() {
    // Orders only: the dev sample tracker on disk is the OLD file, which the new parser
    // rejects — drop a MISBAR Task Tracker into the zone to try the tracker.
    try {
      const csvResp = await fetch('test/samples/orders.csv');
      if (csvResp.ok) {
        const blob = await csvResp.blob();
        const f = new File([blob], 'KAMC Order details (sample).csv', { type: 'text/csv' });
        csvZone.setLoaded(f.name);
        await handleFile('csv', f, { dev: true });
      }
      if (!csvResp.ok) {
        // No samples on disk — fall back to in-memory mock so the flow still works.
        loadMock();
      }
    } catch (e) {
      console.warn('[upload] sample fetch failed; using mock', e);
      loadMock();
    }
  }

  function loadMock() {
    usedMock = true;
    takeOrders(state.parsed, buildMockOrders());
    state.parsed.raw = null; // mock rows: no original file, no export
    // The explicit mock mode's SYNTHETIC tracker — memory only, never written to the cache
    // (a real session's persisted document must not be replaced by mock tasks).
    state.parsed.tracker = buildMockTracker();
    state.heroDataAt = new Date().toISOString();
    state.files.csv = state.files.csv || { name: 'mock-orders.csv' };
    state.files.tracker = state.files.tracker || { name: 'mock-tracker.xlsx' };
    csvZone.setLoaded(state.files.csv.name);
    trackerZone.setLoaded(state.files.tracker.name);
    toast(STR.upload.mockLoaded, 'ok');
    paint();
  }

  function paint() {
    summaryHost.innerHTML = '';
    unmatchedHost.innerHTML = '';
    actionsHost.innerHTML = '';

    // Data may have just landed (or gone) — let the automation card re-evaluate
    // whether '▶ تشغيل الآن' is runnable. Optional method; guarded.
    if (automationPanel && typeof automationPanel.refresh === 'function') {
      try { automationPanel.refresh(); } catch (e) { console.warn('[upload] automation refresh failed', e); }
    }

    // Summary cards
    if (state.parsed.orders) {
      const s = csvStats(state.parsed.orders);
      summaryHost.appendChild(fileSummaryCard({
        title: STR.upload.csvSummaryTitle,
        stats: [
          { label: STR.upload.rowsTotal, value: s.lines },
          { label: STR.upload.ordersDistinct, value: s.distinct },
          { label: STR.upload.cancelled, value: s.cancelled },
          { label: STR.upload.dateRange, value: s.range, small: true },
        ],
      }));
      // The summary above counts the KAMC rows; the rest of the file is accounted for
      // directly under it, so a total that looks short of the source file is explained
      // where it is read — two different facts, two different notices:
      //   • SGH's lines are KEPT (parsed.ordersByHospital.sgh): an informational line
      //     with their count, pointing at the review screen, where the report type
      //     (KAMC / SGH / KAMC + SGH) is chosen;
      //   • a THIRD hospital's lines are DROPPED (excludedHospitals — third hospitals
      //     only): a warning, one line per hospital, naming it.
      const obh = state.parsed.ordersByHospital;
      const sghCount = (obh && Array.isArray(obh.sgh)) ? obh.sgh.length : 0;
      if (sghCount) {
        summaryHost.appendChild(el('div', {
          class: 'card', role: 'status',
          style: 'padding:10px 14px;background:var(--info-bg,#E0E7FF);color:var(--info-text,#1E3A8A);border:1px solid rgba(30,58,138,.30)',
        }, [
          el('div', { class: 'small', style: 'font-weight:600', text: `ℹ︎ ${STR.upload.sghRows(sghCount)}` }),
        ]));
      }
      const excluded = state.parsed.excludedHospitals || [];
      if (excluded.length) {
        summaryHost.appendChild(el('div', { class: 'panel-warn', role: 'status' }, excluded.map((h) => el('div', {
          class: 'small', style: 'color:var(--warn-text,#92400E);font-weight:600',
          text: `⚠ ${STR.upload.hospitalExcluded(h.count, h.name || h.id)}`,
        }))));
      }
    }
    const tracker = resolveProjectTracker(state.parsed.tracker, null);
    if (tracker) {
      // Task count, then one stat per status (the slide's Arabic labels and order), then
      // the parser's notes and — when this upload replaced website edits — that fact.
      const card = fileSummaryCard({
        title: STR.upload.trackerSummaryTitle,
        stats: [
          { label: STR.upload.tasks, value: tracker.tasks.length },
          // As the deck reads them on the report date (overdue → «متأخر», + «متجاوزة الموعد»).
          ...trackerStatusCounts(tracker, state.reportDate || todayISO()).map((c) => ({ label: c.label, value: c.count })),
        ],
      });
      // «N من M مهمة مترجمة تلقائيًا» — the AUTOMATIC translation's coverage (CONTRACT-AUTO
      // §6). No «upload an Arabic file» note any more: the user never prepares one. Tasks
      // still without Arabic are dealt with on the review card (on-device translation, or
      // the editor), which says so itself.
      const tc = trackerTranslationStatus(tracker, 'ar');
      if (tc) {
        card.appendChild(el('p', { class: 'small', style: 'font-weight:700;margin:10px 0 0', text: STR.tracker.autoTranslated(tc.translated, tc.total) }));
      }
      const notes = [];
      if (trackerEditsReplacedAt) {
        notes.push(STR.upload.trackerEditsReplaced(trackerStamp(trackerEditsReplacedAt)));
      }
      const warnings = Array.isArray(tracker.warnings) ? tracker.warnings : [];
      if (notes.length || warnings.length) {
        card.appendChild(el('div', { class: 'small', style: 'font-weight:700;margin:10px 0 4px', text: STR.upload.trackerWarningsTitle }));
        card.appendChild(el('ul', { class: 'notelist' }, [
          ...notes.map((n) => el('li', { class: 'warn', text: n })),
          ...warnings.slice(0, 30).map((w) => el('li', { class: 'warn', text: w })),
        ]));
      }
      summaryHost.appendChild(card);
    }

    // Errors
    const allErrors = [...errorsByKind.csv, ...errorsByKind.tracker];
    if (allErrors.length) {
      summaryHost.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'card__title', text: STR.upload.errorsTitle }),
        el('ul', { class: 'notelist' }, allErrors.slice(0, 30).map((e) => el('li', { class: 'err', text: e }))),
      ]));
    }

    // Unmatched-tests panel with inline TAT inputs + computed suggestions.
    if (state.parsed.orders) {
      const unmatched = computeUnmatched(state.parsed.orders, store.settings.tatLookup);
      if (unmatched.length) {
        const rowRefs = [];
        const rows = unmatched.map((name) => {
          const input = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', placeholder: STR.upload.unmatchedDays });
          const saved = el('span', { class: 'small', style: 'color:var(--green);font-weight:700' });
          const rowEl = el('div', { class: 'unmatched-row' }, [
            el('div', { class: 'unmatched-row__name', text: name }),
            input,
            el('button', {
              class: 'btn btn--ghost btn--sm', text: STR.common.add,
              onClick: () => {
                const days = parseInt(input.value, 10);
                if (!Number.isFinite(days) || days < 0) { toast(STR.common.error, 'err'); return; }
                store.setTat(name, days);
                state.settings = store.settings;
                rowEl.classList.add('is-saved');
                saved.textContent = ' ✓ ' + STR.upload.unmatchedSaved;
                paint(); // recompute — this name drops off the list
              },
            }),
          ]);
          rowEl.appendChild(saved);
          rowRefs.push({ name, input, rowEl });
          return rowEl;
        });
        // Header: title + (async) subtitle on the start side, apply-all button on the end.
        const subtitleEl = el('p', { class: 'small', style: 'display:none;color:var(--warn-text,#92400E);margin:2px 0 0' });
        const actionsBar = el('div', { style: 'flex:0 0 auto' });
        const header = el('div', {
          style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap',
        }, [
          el('div', { style: 'min-width:0' }, [
            el('div', { class: 'panel-warn__title', text: `⚠️ ${STR.upload.unmatchedTitle} (${unmatched.length})` }),
            subtitleEl,
          ]),
          actionsBar,
        ]);
        unmatchedHost.appendChild(el('div', { class: 'panel-warn' }, [
          header,
          el('p', { class: 'small', style: 'margin:6px 0 8px', text: STR.upload.unmatchedHint }),
          ...rows,
        ]));
        // Layer computed suggestions on top of the plain panel. Graceful: if the
        // suggestion module is absent, the panel above is a complete, working UI.
        enhanceUnmatched(unmatched, rowRefs, subtitleEl, actionsBar);
      }
    }

    // Continue action — gated on the ORDERS only: the project tracker is optional content
    // (no tracker ⇒ no tracker slides; the main report never needed one to be built).
    const ready = !!state.parsed.orders;
    const btn = el('button', {
      class: 'btn btn--primary btn--block', text: STR.upload.proceed, disabled: !ready,
      onClick: runEngineAndGo,
    });
    proceedBtn = btn;
    actionsHost.appendChild(btn);
    const gateNote = !ready ? STR.upload.proceedNeedOrders : (!tracker ? STR.upload.trackerOptional : null);
    if (gateNote) actionsHost.appendChild(el('p', { class: 'small muted', style: 'text-align:center;margin-top:6px', text: gateNote }));

    // The moment orders exist, transform the top of the screen into a mini-dashboard.
    paintHero();
    // …and surface the ready-to-email per-lab 'Late & Due' Excel files right here,
    // so the exec never has to run a full report to reach them.
    paintLateLabs();
    // …and the optional filtered-CSV download, right under it.
    paintCsvExport();
  }

  /* ---------------------------------------------------------------- *
   * Per-lab 'Late & Due' Excel card — the SAME shared section the
   * generate results screen shows, hoisted to the upload screen so the
   * files are reachable the instant order data lands (live pull or CSV).
   * asOf = now (only the calendar day matters to classification). Purely
   * additive with a seq guard: if anything fails it renders nothing.
   * ---------------------------------------------------------------- */
  async function paintLateLabs() {
    if (!lateLabsHost) return;
    const seq = ++lateLabsSeq;
    const orders = state.parsed.orders;
    if (!orders || !orders.length) { lateLabsHost.innerHTML = ''; return; } // no data yet → card absent
    let section;
    try {
      section = await buildLateLabsSection({
        rows: orders,
        tatTests: (store.settings || {}).tatLookup || {},
        // Pre-fills ONLY the To: line of a downloaded .eml draft — nothing is sent
        // from here; without it the Settings tab's per-lab addresses do nothing.
        labRecipients: ((store.settings || {}).automation || {}).labRecipients || null,
        asOfMs: Date.now(),
      });
      if (seq !== lateLabsSeq) return; // a newer paint superseded this run
    } catch (e) {
      // Graceful by design: the card is a bonus, never a failure surface.
      if (seq === lateLabsSeq) lateLabsHost.innerHTML = '';
      return;
    }
    // Unwrap the shared section's own card chrome + drop its internal title so it
    // reads as the body of this one prominent upload card (no nested double-card,
    // no duplicate heading). Its counting-basis line, lab rows, per-lab تنزيل /
    // نسخ نص البريد, and تنزيل الكل button are preserved verbatim.
    section.classList.remove('card');
    section.style.cssText = 'margin-top:4px;text-align:right';
    if (section.firstChild) section.removeChild(section.firstChild);
    lateLabsHost.innerHTML = '';
    lateLabsHost.appendChild(el('div', { class: 'card', style: 'border-top:3px solid var(--red)' }, [
      el('div', { class: 'card__title', text: '📥 ملفات المختبرات المتأخرة (Excel)' }),
      el('p', {
        class: 'small muted', style: 'margin:0 0 10px',
        text: 'صدّر ملف Excel لكل مختبر لديه فحوصات متأخرة أو مستحقة خلال ٢٤ ساعة — جاهز للإرسال بالبريد.',
      }),
      section,
    ]));
  }

  /* ---------------------------------------------------------------- *
   * Optional filtered-CSV download card — mounted beside the late-labs
   * card and refreshed from the same paint(), so it appears the moment
   * orders land and follows every new data load. Two deliberate
   * departures from paintLateLabs:
   *  • NOT rebuilt on every paint. paint() also runs for unrelated
   *    reasons (a TAT saved in the unmatched panel, a bulk accept), and
   *    rebuilding would wipe the labs / stages the user is mid-way
   *    through ticking and re-collapse the card. It is rebuilt only when
   *    its inputs change: the orders array, raw, or the file name.
   *  • A failure is swallowed WITHOUT logging the error: this card is
   *    the one place patient columns are in play, and the error object
   *    is not worth the risk of a row value reaching the console.
   * The section owns its own card chrome, title and collapsed default;
   * it returns null when there are no orders (→ card absent). When the
   * orders did not come from a CSV upload (raw null) it shows its own
   * «needs an uploaded CSV» note instead of the controls.
   * ---------------------------------------------------------------- */
  function paintCsvExport() {
    const orders = state.parsed.orders;
    const raw = state.parsed.raw || null;
    const name = (state.files.csv && state.files.csv.name) || '';
    if (!orders || !orders.length) {
      csvExportHost.innerHTML = '';
      csvExportBuiltFor = null;
      return;
    }
    const b = csvExportBuiltFor;
    if (b && b.orders === orders && b.raw === raw && b.name === name && csvExportHost.firstChild) return;
    let section = null;
    try {
      section = buildCsvExportSection(state);
    } catch {
      console.warn('[upload] filtered-CSV card unavailable'); // deliberately no error object
      section = null;
    }
    csvExportHost.innerHTML = '';
    csvExportBuiltFor = null;
    if (section && section.nodeType === 1) {
      csvExportHost.appendChild(section);
      csvExportBuiltFor = { orders, raw, name };
    }
  }

  /* ---------------------------------------------------------------- *
   * Intelligent suggestions for the unmatched-TAT panel. Dynamically
   * imports ../ingest/tat-suggest.js; when present it pre-fills each
   * row's days input with a computed value, drops a muted evidence line
   * (with a confidence dot) under the row, and offers a one-click
   * 'اعتماد جميع المقترحات'. When absent, the plain panel is untouched.
   * ---------------------------------------------------------------- */
  const DOT = { high: 'var(--green)', medium: 'var(--amber)', low: '#94A3B8' };
  function evidenceLine(color, text) {
    return el('div', {
      style: 'font-size:.78rem;color:var(--slate-500);margin:1px 0 6px;display:flex;align-items:flex-start;gap:6px;line-height:1.35',
    }, [
      el('span', { style: `width:8px;height:8px;border-radius:999px;background:${color};flex:0 0 auto;margin-top:5px`, 'aria-hidden': 'true' }),
      el('span', { text }),
    ]);
  }

  async function enhanceUnmatched(unmatched, rowRefs, subtitleEl, actionsBar) {
    const seq = ++unmatchedSeq;
    let mod;
    try {
      mod = await import('../ingest/tat-suggest.js?v=v2026-10-18.1');
    } catch { return; } // module not present yet — keep the plain panel behavior
    if (seq !== unmatchedSeq) return; // a newer paint superseded this run
    const fn = pickFn(mod, ['suggestTats']);
    if (typeof fn !== 'function') return;

    let results;
    try {
      results = fn({
        unmatched,
        rows: state.parsed.orders,
        tatLookup: (store.settings || {}).tatLookup,
        tatLoinc: TAT_LOINC,
      });
      if (results && typeof results.then === 'function') results = await results;
    } catch (e) {
      console.warn('[upload] suggestTats failed', e);
      return;
    }
    if (seq !== unmatchedSeq) return;
    if (!Array.isArray(results)) return;

    const byName = new Map(results.map((r) => [r && r.testName, r]));
    const applicable = []; // { name, suggested } for every non-null suggestion

    for (const ref of rowRefs) {
      const s = byName.get(ref.name);
      let line;
      if (s && s.suggested != null) {
        ref.input.value = String(s.suggested);
        applicable.push({ name: ref.name, suggested: s.suggested });
        const color = DOT[s.confidence] || '#94A3B8';
        line = evidenceLine(color, s.evidence || '');
      } else {
        line = evidenceLine('#94A3B8', (s && s.evidence) || 'لا توجد بيانات كافية للاقتراح');
      }
      ref.rowEl.after(line); // sits directly under its row, above the next divider
    }

    subtitleEl.textContent = 'اقتراحات محسوبة من التحليل — راجعها ثم اعتمد';
    subtitleEl.style.display = '';

    actionsBar.innerHTML = '';
    if (applicable.length) {
      actionsBar.appendChild(el('button', {
        class: 'btn btn--primary btn--sm',
        text: `اعتماد جميع المقترحات (${applicable.length})`,
        onClick: () => {
          for (const a of applicable) store.setTat(a.name, a.suggested);
          state.settings = store.settings;
          for (const ref of rowRefs) ref.rowEl.classList.add('is-saved'); // brief, before repaint
          toast(`تم اعتماد ${applicable.length} مدة مقترحة`, 'ok');
          paint(); // same recompute/paint the individual add triggers — applied names drop off
        },
      }));
    }
  }

  /* ---------------------------------------------------------------- *
   * 'لمحة اليوم' hero strip — a quick engine pass rendered as big stat
   * tiles at the very top the instant order data lands (auto-fetch or
   * CSV). Purely additive: if anything fails it renders nothing.
   * ---------------------------------------------------------------- */

  /** compute() opts shared by the hero run and متابعة — keep them identical so
   *  runEngineAndGo can safely reuse the hero's cached engineOutput. */
  function engineOpts() {
    const s = store.settings || {};
    return {
      asOf: state.reportDate || todayISO(),
      cancelledByMonth: (s.historicalConstants || {}).cancelledByMonth || {},
      snapshot: s.snapshot,
      excludeNoTat: !!(s.reportOptions && s.reportOptions.excludeNoTat),
    };
  }

  /** Local 'آخر تحديث HH:MM' (prefix DD/MM when the snapshot is from another day). */
  function fmtFresh(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const datePart = sameDay ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} `;
    return `آخر تحديث ${datePart}${fmtHHMM(iso)}`;
  }

  function heroTile({ label, value, accent, num, delta }) {
    const valueRow = el('div', {
      style: `font-size:28px;line-height:1.1;font-weight:800;color:${num};display:flex;align-items:baseline;gap:6px;flex-wrap:wrap`,
    }, [
      el('span', { text: String(value) }),
      (typeof delta === 'number' && delta > 0) ? el('span', {
        style: 'font-size:13px;font-weight:700;color:var(--good-text,var(--delta-green));background:var(--good-bg,#E7F6EC);border-radius:999px;padding:1px 8px;white-space:nowrap;direction:ltr;unicode-bidi:isolate',
        text: `+${delta}`,
      }) : null,
    ]);
    return el('div', {
      // border-inline-start (= right in this dir=rtl app): the accent stripe belongs on
      // the leading edge. Was a physical border-right, which only happened to be correct.
      style: `background:var(--white);border:1px solid var(--border);border-inline-start:4px solid ${accent};border-radius:10px;padding:12px 14px;box-shadow:var(--shadow);min-width:0`,
    }, [
      valueRow,
      el('div', { style: 'font-size:.8rem;color:var(--slate-500);margin-top:5px;line-height:1.3', text: label }),
    ]);
  }

  function renderHero(out) {
    const b = out.buckets || {};
    const totals = out.totals || {};
    const deltas = out.deltas || {};
    const total = totals.total || 0;
    const completed = b.completed || 0;
    const pct = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

    const tiles = [
      { label: 'إجمالي الطلبات', value: total, accent: 'var(--navy)', num: 'var(--brand-ink)' },
      { label: 'نتائج مكتملة', value: completed, accent: 'var(--green)', num: 'var(--good-text,#15803D)', delta: deltas.completed },
      { label: 'بانتظار النتائج', value: b.awaitingResults || 0, accent: 'var(--amber)', num: 'var(--warn-text,#B45309)' },
      { label: 'المتأخرة', value: b.lateNoResult || 0, accent: 'var(--red)', num: 'var(--red)' },
      { label: 'المرفوضة', value: b.rejected || 0, accent: '#F87171', num: 'var(--bad-text,#B91C1C)' },
      { label: 'نسبة الاكتمال', value: `${pct}%`, accent: 'var(--blue)', num: 'var(--blue)' },
    ];

    const header = el('div', {
      style: 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap',
    }, [
      el('div', { style: 'font-size:1.05rem;font-weight:800;color:var(--brand-ink);display:flex;align-items:center;gap:8px' }, [
        el('span', { text: '📊' }),
        el('span', { text: 'لمحة اليوم' }),
      ]),
      state.heroDataAt ? el('span', { style: 'font-size:.8rem;color:var(--slate-500);font-weight:600', text: fmtFresh(state.heroDataAt) }) : null,
    ]);

    const grid = el('div', {
      style: 'display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(130px,1fr))',
    }, tiles.map(heroTile));

    heroHost.innerHTML = '';
    heroHost.appendChild(el('div', { class: 'card', style: 'border-top:3px solid var(--navy)' }, [header, grid]));
  }

  async function paintHero() {
    if (!heroHost) return;
    const seq = ++heroSeq;
    const orders = state.parsed.orders;
    if (!orders || !orders.length) { heroHost.innerHTML = ''; return; }
    let out;
    try {
      const mod = await import('../engine/engine.js?v=v2026-10-18.1');
      if (seq !== heroSeq) return; // a newer run superseded this one
      const compute = pickFn(mod, ['compute', 'runEngine', 'run']);
      if (typeof compute !== 'function') { heroHost.innerHTML = ''; return; }
      out = compute(orders, (store.settings || {}).tatLookup, engineOpts());
      if (out && typeof out.then === 'function') out = await out;
      if (seq !== heroSeq) return;
    } catch (e) {
      // Graceful by design: the hero is a bonus, never a failure surface.
      if (seq === heroSeq) heroHost.innerHTML = '';
      return;
    }
    if (!out || !out.totals || !out.buckets) { heroHost.innerHTML = ''; return; }
    state.engineOutput = out; // cache so متابعة/المراجعة reuse the very same numbers
    renderHero(out);
  }

  async function runEngineAndGo() {
    if (proceedBtn) proceedBtn.disabled = true; // guard: a second click must not launch a second run
    try {
      if (!state.reportDate) state.reportDate = todayISO();
      // Reuse the hero's fresh computation (identical opts) instead of a second pass.
      let out = (state.engineOutput && state.engineOutput.totals) ? state.engineOutput : null;
      if (!out) {
        try {
          const mod = await tryImport('../engine/engine.js?v=v2026-10-18.1');
          const compute = pickFn(mod, ['compute', 'runEngine', 'run']);
          if (compute) {
            out = compute(state.parsed.orders, (store.settings || {}).tatLookup, engineOpts());
            if (out && typeof out.then === 'function') out = await out;
          }
        } catch (e) { console.warn('[upload] engine failed', e); }
      }

      if (!out || !out.totals) {
        out = buildMockEngineOutput(store.settings);
        toast(usedMock ? STR.upload.mockLoaded : STR.upload.engineMissing, usedMock ? 'ok' : 'warn');
      }
      state.engineOutput = out;
      state.reportModel = null; // review will (re)assemble
      // …starting from the SAVED slide order: the temporary one belonged to the report just
      // dropped (slide-order CONTRACT decision 5), exactly like the overrides above.
      clearTempSlideOrder(state);
      navigate('review');
    } catch (e) {
      // Failure path: stay on the page and re-enable so the user can retry.
      console.error('[upload] proceed failed', e);
      if (proceedBtn) proceedBtn.disabled = false;
      toast(STR.common.error, 'err');
    }
  }

  // Auto-load mock data on ?mock=1 for standalone verification.
  if (isMock && !state.parsed.orders && !state.parsed.tracker) {
    loadMock();
  } else {
    paint();
  }
}
