// ui/screen-upload.js — file upload + parse + engine kickoff (Track E).
import { STR, todayISO, formatDateAr } from '../i18n/ar.js';
import { el, dropZone, fileSummaryCard, toast } from './components.js';
import { normTest } from '../contracts.js';
import { getPapa, getXLSX } from '../vendor-loader.js';

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

export function buildMockTracker() {
  return {
    tasks: [
      { num: 1, task: 'تفعيل ربط النتائج آليًا مع نظام المستشفى', responsible: 'لين', owner: 'م. أحمد', dueDate: 'يومي', status: 'مستمر', category: 'تشغيلي', hidden: false },
      { num: 2, task: 'إغلاق فجوة الطلبات المعلقة لدى المختبر المرجعي', responsible: 'نوبكو', owner: 'أ. سارة', dueDate: '2026-07-25', status: 'مفتوح', category: 'تشغيلي', hidden: false },
      { num: 3, task: 'مراجعة عقود المختبرات المتأخرة في الرفع', responsible: 'لين', owner: 'م. خالد', dueDate: '2026-07-15', status: 'متأخر', category: 'تعاقدي', hidden: false },
      { num: 4, task: 'اعتماد نموذج التقرير اليومي الموحد', responsible: 'لين', owner: 'أ. منى', dueDate: '2026-07-10', status: 'مغلق', category: 'تشغيلي', hidden: false },
      { num: 5, task: 'تحديث جدول المدد المعيارية للفحوصات الجديدة', responsible: 'لين', owner: 'م. أحمد', dueDate: '2026-07-30', status: 'مفتوح', category: 'داخلي', hidden: false },
      { num: 6, task: 'تدريب الفريق على لوحة المتابعة', responsible: 'لين', owner: 'أ. سارة', dueDate: '2026-08-01', status: 'مستمر', category: 'داخلي', hidden: false },
    ],
    challenges: [
      { id: 'c1', title: 'تأخر رفع النتائج', desc: 'بعض المختبرات ترفع النتائج يدويًا مما يؤخر الظهور في النظام', impact: 'عالٍ', owner: 'أ. سارة', status: 'مفتوح', solution: 'تفعيل الربط الآلي' },
      { id: 'c2', title: 'نقص بيانات العينات', desc: 'حقول تواريخ الاستلام غير مكتملة لبعض الطلبات', impact: 'متوسط', owner: 'م. خالد', status: 'مستمر', solution: 'إلزام إدخال التواريخ عند الاستلام' },
    ],
    risks: [
      { id: 'r1', title: 'انقطاع خدمة مختبر مرجعي', desc: 'اعتماد كبير على مزود واحد لبعض الفحوصات', probability: 'متوسط', impact: 'عالٍ', owner: 'أ. منى', status: 'مفتوح' },
      { id: 'r2', title: 'تأخر التعاقد', desc: 'قد يؤثر على استمرارية بعض الفحوصات', probability: 'منخفض', impact: 'عالٍ', owner: 'م. خالد', status: 'مفتوح' },
    ],
  };
}

/** EngineOutput mock seeded from test/fixtures numbers; deltas computed vs settings. */
export function buildMockEngineOutput(settings) {
  const snap = (settings && settings.snapshot) || {};
  const prev = (snap.numbers && snap.numbers.completed) != null
    ? snap.numbers.completed
    : (snap.prevCompleted != null ? snap.prevCompleted : 422); // legacy shape tolerance
  return {
    totals: { lines: 628, cancelledInData: 10, total: 618 },
    funnel: { created: 618, collected: 612, dispatched: 608, received: 596, resulted: 422 },
    buckets: { awaitingDispatch: 10, shippedNotReceived: 12, awaitingResults: 159, completed: 422, rejected: 15, lateNoResult: 67, latePct: 42.1 },
    monthly: [
      { month: '2026-01', orders: 0, results: 0, rejected: 0, incomplete: 0, completionPct: null, cancelled: 8 },
      { month: '2026-02', orders: 0, results: 0, rejected: 0, incomplete: 0, completionPct: null, cancelled: 1 },
      { month: '2026-03', orders: 0, results: 0, rejected: 0, incomplete: 0, completionPct: null, cancelled: 30 },
      { month: '2026-04', orders: 3, results: 3, rejected: 0, incomplete: 0, completionPct: 100, cancelled: 4 },
      { month: '2026-05', orders: 105, results: 76, rejected: 14, incomplete: 29, completionPct: 72.4, cancelled: 6 },
      { month: '2026-06', orders: 410, results: 340, rejected: 1, incomplete: 70, completionPct: 82.9, cancelled: 4 },
      { month: '2026-07', orders: 100, results: 3, rejected: 0, incomplete: 97, completionPct: 3, cancelled: 0 },
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
    byLab: [
      { lab: 'Advanced Laboratory Services .Co', total: 301, awaitingResult: 89, rejected: 14, onTime: 29, late: 60, latePct: 67.4 },
      { lab: 'Fal Specialized Medical Lab', total: 151, awaitingResult: 21, rejected: 1, onTime: 75, late: 2, latePct: 9.5 },
      { lab: 'king Abdullaziz Medical city in Riyadh', total: 113, awaitingResult: 35, rejected: 0, onTime: 42, late: 3, latePct: 8.6 },
      { lab: 'Eurofins clinical', total: 27, awaitingResult: 0, rejected: 0, onTime: 20, late: 0, latePct: 0 },
      { lab: 'Saudi Diagnostics Limited Company', total: 19, awaitingResult: 7, rejected: 0, onTime: 4, late: 2, latePct: 28.6 },
      { lab: 'Anwa  Medical Company', total: 7, awaitingResult: 7, rejected: 0, onTime: 0, late: 0, latePct: 0 },
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
      completed: Math.max(0, 422 - prev),
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
  return { orders, errors: errors.map(String) };
}

function normalizeTracker(res) {
  if (!res) return null;
  const t = res.tracker || res;
  const tasks = Array.isArray(t) ? t : (t.tasks || []);
  return {
    orders: null,
    tracker: {
      tasks,
      challenges: t.challenges || [],
      risks: t.risks || [],
    },
    errors: (res.errors || t.errors || []).map(String),
  };
}

async function ingestCsv(file) {
  const Papa = await getPapa();
  const mod = await tryImport('../ingest/csv.js');
  const fn = pickFn(mod, ['parseKamcCsv', 'parseCsv', 'ingestCsv', 'parseOrders', 'parse']);
  if (fn) {
    const text = await file.text();
    const out = await callFlexible(fn, [[text, Papa], [file, Papa], [Papa, text], [Papa, file], [{ file, text, Papa }]]);
    const norm = normalizeOrders(out);
    if (norm) return norm;
  }
  return { orders: null, errors: [], _missing: true };
}

async function ingestTracker(file) {
  const XLSX = await getXLSX();
  const mod = await tryImport('../ingest/xlsx.js');
  const fn = pickFn(mod, ['parseTracker', 'ingestXlsx', 'parseXlsx', 'parse']);
  if (fn) {
    const buf = await file.arrayBuffer();
    const out = await callFlexible(fn, [[buf, XLSX], [file, XLSX], [XLSX, buf], [XLSX, file], [{ file, buf, XLSX }]]);
    const norm = normalizeTracker(out);
    if (norm && norm.tracker) return norm;
  }
  return { tracker: null, errors: [], _missing: true };
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
    if (/cancel/i.test(o.rawStatus || '')) cancelled++;
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
  const errorsByKind = { csv: [], tracker: [] };

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
        freshnessEl.style.color = '#B45309';
        freshnessEl.style.fontWeight = '600';
      } else {
        freshnessEl.textContent = STR.upload.snapshotFreshness.replace('{t}', when);
        freshnessEl.style.color = '';
        freshnessEl.style.fontWeight = '';
      }
    } catch { /* offline or file absent — leave the line empty */ }
  }
  paintFreshness();
  // Daily flow: kick off the live fetch on load so data is already streaming in.
  // fetchLive() is hoisted; the guards below (and its own button-disable) prevent
  // a double-invoke if the user also clicks الجلب المباشر.
  if (grafanaReady && !state.parsed.orders && !fetchInFlight) fetchLive();

  const summaryHost = el('div');
  const unmatchedHost = el('div');
  const actionsHost = el('div', { class: 'sticky-actions' });

  const devBar = isDev ? el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: 'أدوات المطور' }),
    el('button', { class: 'btn btn--ghost btn--sm', text: STR.upload.loadSamples, onClick: loadSamples }),
    isMock ? el('span', { class: 'small muted', style: 'margin-inline-start:8px', text: '(mock)' }) : null,
  ]) : null;

  container.appendChild(el('div', { class: 'screen' }, [
    head, grafanaBar, dropgrid, devBar, summaryHost, unmatchedHost, actionsHost,
  ]));

  // Reuse the last-parsed Project Tracker when no fresh file was dropped —
  // it changes rarely, so with the live Grafana source generate needs no files.
  if (!state.parsed.tracker) {
    const ct = store.settings && store.settings.cachedTracker;
    if (ct && ct.model) {
      state.parsed.tracker = ct.model;
      state.files.tracker = state.files.tracker || { name: STR.upload.cachedTrackerName };
      trackerZone.setLoaded(`${STR.upload.cachedTrackerName} (${String(ct.updatedAt || '').slice(0, 10)})`);
    }
  }

  // Restore visual state if returning to this screen with data already parsed.
  if (state.files.csv) csvZone.setLoaded(state.files.csv.name);
  if (state.files.tracker) trackerZone.setLoaded(state.files.tracker.name);

  async function fetchLive() {
    if (fetchInFlight) return; // a fetch is already running (auto-load or a prior click)
    fetchInFlight = true;
    grafanaBtn.disabled = true;
    grafanaBtn.textContent = STR.upload.grafanaFetching;
    errorsByKind.csv = [];
    const gcfg = (store.settings && store.settings.grafana) || {};
    const dataKey = (gcfg.dataKey || '').trim();
    try {
      const mod = await import('../ingest/grafana.js');
      const asOf = state.reportDate || todayISO();
      const directConfigured = !!(gcfg.baseUrl && gcfg.accessToken);
      try {
        // Preferred path: direct browser → Grafana query (when configured).
        if (!directConfigured) throw new TypeError('direct source not configured');
        const res = await mod.fetchKamcOrders(gcfg, {
          fromMs: mod.yearStartMs(asOf), toMs: Date.now(),
        });
        state.parsed.orders = res.rows;
        errorsByKind.csv = res.errors || [];
        state.files.csv = { name: `${STR.upload.grafanaSourceName} ${new Date().toLocaleString('en-GB')}` };
        csvZone.setLoaded(state.files.csv.name);
        toast(STR.upload.grafanaOk.replace('{n}', String(res.rows.length)), 'ok');
      } catch (direct) {
        // A CORS/network failure surfaces as TypeError. If a data key is set, fall
        // back to the encrypted snapshot the GitHub Action publishes server-side.
        if (direct instanceof TypeError && dataKey) {
          const snap = await mod.fetchKamcSnapshot(dataKey);
          state.parsed.orders = snap.rows;
          errorsByKind.csv = snap.errors || [];
          const t = fmtHHMM(snap.fetchedAt);
          state.files.csv = { name: `${STR.upload.grafanaSnapshotName} ${t}`.trim() };
          csvZone.setLoaded(state.files.csv.name);
          toast(
            STR.upload.grafanaSnapshotOk
              .replace('{n}', String(snap.rows.length))
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
      grafanaBtn.disabled = false;
      grafanaBtn.textContent = STR.upload.grafanaFetch;
      paint();
    }
  }

  async function handleFile(kind, file) {
    state.files[kind] = file;
    (kind === 'csv' ? csvZone : trackerZone).setBusy(true);
    errorsByKind[kind] = [];
    try {
      if (kind === 'csv') {
        const res = await ingestCsv(file);
        if (res._missing || !res.orders) {
          usedMock = true;
          state.parsed.orders = buildMockOrders();
          toast(STR.upload.ingestMissing, 'warn');
        } else {
          state.parsed.orders = res.orders;
          errorsByKind.csv = res.errors || [];
        }
      } else {
        const res = await ingestTracker(file);
        if (res._missing || !res.tracker) {
          usedMock = true;
          state.parsed.tracker = buildMockTracker();
          toast(STR.upload.ingestMissing, 'warn');
        } else {
          state.parsed.tracker = res.tracker;
          errorsByKind.tracker = res.errors || [];
          // Persist for file-less runs (project content only — never patient data).
          try {
            if (typeof store.updateCachedTracker === 'function') store.updateCachedTracker(res.tracker);
          } catch (err) { console.warn('[upload] tracker cache failed', err); }
        }
      }
      (kind === 'csv' ? csvZone : trackerZone).setLoaded(file.name);
    } catch (e) {
      console.error('[upload] parse failed', kind, e);
      errorsByKind[kind] = [(e && e.message) || String(e)];
      (kind === 'csv' ? csvZone : trackerZone).setError();
    } finally {
      (kind === 'csv' ? csvZone : trackerZone).setBusy(false);
      paint();
    }
  }

  async function loadSamples() {
    try {
      const [csvResp, xlsxResp] = await Promise.all([
        fetch('test/samples/orders.csv'),
        fetch('test/samples/tracker.xlsx'),
      ]);
      if (csvResp.ok) {
        const blob = await csvResp.blob();
        const f = new File([blob], 'KAMC Order details (sample).csv', { type: 'text/csv' });
        csvZone.setLoaded(f.name);
        await handleFile('csv', f);
      }
      if (xlsxResp.ok) {
        const blob = await xlsxResp.blob();
        const f = new File([blob], 'Misbar Project Tracker (sample).xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        trackerZone.setLoaded(f.name);
        await handleFile('tracker', f);
      }
      if (!csvResp.ok && !xlsxResp.ok) {
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
    state.parsed.orders = buildMockOrders();
    state.parsed.tracker = buildMockTracker();
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
    }
    if (state.parsed.tracker) {
      const t = state.parsed.tracker;
      summaryHost.appendChild(fileSummaryCard({
        title: STR.upload.trackerSummaryTitle,
        stats: [
          { label: STR.upload.tasks, value: (t.tasks || []).length },
          { label: STR.upload.challenges, value: (t.challenges || []).length },
          { label: STR.upload.risks, value: (t.risks || []).length },
        ],
      }));
    }

    // Errors
    const allErrors = [...errorsByKind.csv, ...errorsByKind.tracker];
    if (allErrors.length) {
      summaryHost.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'card__title', text: STR.upload.errorsTitle }),
        el('ul', { class: 'notelist' }, allErrors.slice(0, 30).map((e) => el('li', { class: 'err', text: e }))),
      ]));
    }

    // Unmatched-tests panel with inline TAT inputs
    if (state.parsed.orders) {
      const unmatched = computeUnmatched(state.parsed.orders, store.settings.tatLookup);
      if (unmatched.length) {
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
          return rowEl;
        });
        unmatchedHost.appendChild(el('div', { class: 'panel-warn' }, [
          el('div', { class: 'panel-warn__title', text: `⚠️ ${STR.upload.unmatchedTitle} (${unmatched.length})` }),
          el('p', { class: 'small', text: STR.upload.unmatchedHint }),
          ...rows,
        ]));
      }
    }

    // Continue action
    const both = !!state.parsed.orders && !!state.parsed.tracker;
    const btn = el('button', {
      class: 'btn btn--primary btn--block', text: STR.upload.proceed, disabled: !both,
      onClick: runEngineAndGo,
    });
    proceedBtn = btn;
    actionsHost.appendChild(btn);
    if (!both) actionsHost.appendChild(el('p', { class: 'small muted', style: 'text-align:center;margin-top:6px', text: STR.upload.proceedNeedBoth }));
  }

  async function runEngineAndGo() {
    if (proceedBtn) proceedBtn.disabled = true; // guard: a second click must not launch a second run
    try {
      if (!state.reportDate) state.reportDate = todayISO();
      let out = null;
      try {
        const mod = await tryImport('../engine/engine.js');
        const compute = pickFn(mod, ['compute', 'runEngine', 'run']);
        if (compute) {
          const s = store.settings || {};
          out = compute(state.parsed.orders, s.tatLookup, {
            asOf: state.reportDate,
            cancelledByMonth: (s.historicalConstants || {}).cancelledByMonth || {},
            snapshot: s.snapshot,
            excludeNoTat: !!(s.reportOptions && s.reportOptions.excludeNoTat),
          });
          if (out && typeof out.then === 'function') out = await out;
        }
      } catch (e) { console.warn('[upload] engine failed', e); }

      if (!out || !out.totals) {
        out = buildMockEngineOutput(store.settings);
        toast(usedMock ? STR.upload.mockLoaded : STR.upload.engineMissing, usedMock ? 'ok' : 'warn');
      }
      state.engineOutput = out;
      state.reportModel = null; // review will (re)assemble
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
