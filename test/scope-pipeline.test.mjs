// test/scope-pipeline.test.mjs — the report-SCOPE contract on the pipeline + i18n side.
// Run with:  node --test
//
// A scoped report (labs / shipments / order-date range, chosen on the review screen) is
// a SIDE REPORT. What this suite pins:
//   • recordRunSnapshot writes NOTHING for it — not settings.snapshot, not
//     snapshotHistory, not the taskLog — and writes exactly as before when unscoped;
//   • its file names say so ('(مخصص)', and 'from-to' for a range) while an unscoped
//     name stays byte-identical;
//   • formatRangeAr's three shapes;
//   • the delta chips are stamped from model.scopedRows, never widened to all rows;
//   • runAutomation always builds and records the FULL report, and when its engine step
//     skips or fails it publishes NOTHING — never the scoped model the review screen
//     left in state.reportModel;
//   • the generate screen's share text: byte-identical unscoped; scoped, a lab list
//     folded like the cover's and the range printed as its dates, never a bare label;
//   • the review strings: every key the screen reads lives in ar.js, with hints that
//     say what sendout.js actually puts in each bucket.
//
// Plain node, synthetic rows only (no patient data, no real lab or shipment names).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTOMATION_DEFAULTS, applyWindowDeltas, buildFileDefs, recordRunSnapshot, runAutomation,
} from '../src/automation/pipeline.js';
import { STR, buildFileName, formatRangeAr } from '../src/i18n/ar.js';
// DOM-free exports of a UI screen (module-smoke proves the module evaluates in node).
import { scopeShareLine, shareText } from '../src/ui/screen-generate.js';
import { EMPTY_SCOPE, isScoped, normalizeScope } from '../src/model/scope.js';
import * as deltaBaseline from '../src/model/delta-baseline.js';
import * as taskLifecycle from '../src/model/task-lifecycle.js';
import * as store from '../src/store.js';
import { SETTINGS_KEY } from '../src/contracts.js';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const DATE = '2026-09-23';

// Every scope shape the review screen can produce — each one alone must block writes.
const SCOPED = Object.freeze({
  labs: { labs: ['Lab A'] },
  shipments: { shipments: ['ELAB000001'] },
  range: { from: '2026-09-11', to: DATE },
  everything: {
    labs: ['Lab A', 'Lab B'], shipments: ['ELAB000001'], from: '2026-09-11', to: DATE, shipmentSlide: false,
  },
});

// Shapes that must read as the FULL report (and so record exactly as before).
const UNSCOPED = Object.freeze({
  absent: undefined,
  empty: EMPTY_SCOPE,
  normalizedEmpty: normalizeScope({}),
  halfRange: { from: '2026-09-11' }, // one end only normalises to NO range
  blankShipments: { shipments: ['  ', ''] },
});

function makeModel(scope) {
  const m = {
    reportDate: DATE,
    kpi: {
      totals: { total: 10 },
      funnel: { collected: 9, dispatched: 8, received: 7 },
      buckets: {
        completed: 5, rejected: 1, awaitingDispatch: 1, shippedNotReceived: 1,
        awaitingResults: 2, lateNoResult: 1,
      },
    },
    tasksCurrent: [{ task: 'External task', status: 'مغلق' }],
    tasksInternal: [{ task: 'Internal task', status: 'مفتوح' }],
  };
  if (scope !== undefined) m.scope = scope;
  return m;
}

/** The pipeline tests' minimal store stub, plus a load counter. */
function spyStore() {
  return {
    settings: { tatLookup: {} },
    snapshots: [],
    docs: [],
    loads: 0,
    updateSnapshot(s) { this.snapshots.push(s); },
    loadSettings() { this.loads += 1; return { snapshotHistory: {} }; },
    saveSettings(doc) { this.docs.push(doc); },
  };
}

/** The REAL writers, wrapped so a case can prove they were never even called. */
function writers() {
  const calls = { snapshot: 0, tasks: 0 };
  return {
    calls,
    recordSnapshot: (...a) => { calls.snapshot += 1; return deltaBaseline.recordSnapshot(...a); },
    recordShownTasks: (...a) => { calls.tasks += 1; return taskLifecycle.recordShownTasks(...a); },
  };
}

/** The real store module behind a Map-backed localStorage (store.test.mjs's pattern). */
function realStore() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
  store.__resetForTests();
  store.loadSettings(); // seed
  return {
    raw: () => map.get(SETTINGS_KEY),
    // The ctx.store surface recordRunSnapshot uses.
    api: {
      get settings() { return store.loadSettings(); },
      updateSnapshot: store.updateSnapshot,
      loadSettings: store.loadSettings,
      saveSettings: store.saveSettings,
    },
  };
}

/* ------------------------------------------------------------------ *
 * recordRunSnapshot — a side report writes nothing
 * ------------------------------------------------------------------ */

test('recordRunSnapshot: a scoped model writes NOTHING (snapshot, history, taskLog)', () => {
  for (const [name, raw] of Object.entries(SCOPED)) {
    // Both the normalised scope the review screen stores AND a raw one: isScoped
    // normalises, so a caller that skipped normalizeScope is still caught.
    for (const scope of [normalizeScope(raw), raw]) {
      const st = spyStore();
      const w = writers();
      const state = { settings: 'untouched' };
      recordRunSnapshot({
        model: makeModel(scope), store: st, state, date: DATE,
        recordSnapshot: w.recordSnapshot, recordShownTasks: w.recordShownTasks,
      });
      assert.equal(st.snapshots.length, 0, `${name}: no updateSnapshot`);
      assert.equal(st.docs.length, 0, `${name}: no saveSettings`);
      assert.equal(st.loads, 0, `${name}: the settings doc is not even read`);
      assert.deepEqual(w.calls, { snapshot: 0, tasks: 0 }, `${name}: neither writer called`);
      assert.equal(state.settings, 'untouched', `${name}: state.settings not refreshed`);
    }
  }
});

test('recordRunSnapshot: an unscoped model writes exactly as before', () => {
  for (const [name, scope] of Object.entries(UNSCOPED)) {
    assert.equal(isScoped(scope), false, `precondition: ${name} is unscoped`);
    const st = spyStore();
    const w = writers();
    recordRunSnapshot({
      model: makeModel(scope), store: st, state: {}, date: DATE,
      recordSnapshot: w.recordSnapshot, recordShownTasks: w.recordShownTasks,
    });
    assert.equal(st.snapshots.length, 1, `${name}: snapshot written`);
    assert.equal(st.snapshots[0].asOf, DATE);
    assert.equal(st.snapshots[0].numbers.completed, 5);
    assert.deepEqual(w.calls, { snapshot: 1, tasks: 1 }, `${name}: both writers ran`);
    assert.equal(st.docs.length, 2, `${name}: history doc + taskLog doc saved`);
    assert.equal(st.docs[0].snapshotHistory[DATE].completed, 5);
    assert.ok(Object.keys(st.docs[1].taskLog).length > 0, `${name}: shown tasks recorded`);
  }
});

test('recordRunSnapshot against the real store: scoped leaves settings byte-identical, full writes', () => {
  // Scoped: the persisted doc must not change by a single byte.
  let s = realStore();
  const before = s.raw();
  recordRunSnapshot({
    model: makeModel(normalizeScope(SCOPED.everything)), store: s.api, state: {}, date: DATE,
    recordSnapshot: deltaBaseline.recordSnapshot, recordShownTasks: taskLifecycle.recordShownTasks,
  });
  assert.equal(s.raw(), before, 'scoped run: settings untouched');

  // Unscoped: the same call records the snapshot, the history row and the task log.
  s = realStore();
  const seeded = store.loadSettings();
  assert.equal(seeded.snapshotHistory && seeded.snapshotHistory[DATE], undefined, 'precondition');
  recordRunSnapshot({
    model: makeModel(EMPTY_SCOPE), store: s.api, state: {}, date: DATE,
    recordSnapshot: deltaBaseline.recordSnapshot, recordShownTasks: taskLifecycle.recordShownTasks,
  });
  const after = store.loadSettings();
  assert.equal(after.snapshot.asOf, DATE);
  assert.equal(after.snapshot.numbers.completed, 5);
  assert.equal(after.snapshotHistory[DATE].completed, 5);
  assert.ok(Object.keys(after.taskLog || {}).length > 0, 'taskLog written');
  // No scope ever reaches settings, on either path.
  assert.equal(after.scope, undefined);
});

/* ------------------------------------------------------------------ *
 * File names
 * ------------------------------------------------------------------ */

const P = 'تقرير مسبار';
const PI = 'تقرير مسبار الداخلي';

test('buildFileName: unscoped is byte-identical to the historic name', () => {
  assert.equal(buildFileName(P, DATE, 'pptx'), 'تقرير مسبار 23092026.pptx');
  for (const [name, scope] of Object.entries(UNSCOPED)) {
    assert.equal(buildFileName(P, DATE, 'pptx', scope), 'تقرير مسبار 23092026.pptx', name);
    assert.equal(buildFileName(PI, DATE, 'pdf', scope), 'تقرير مسبار الداخلي 23092026.pdf', name);
  }
});

test('buildFileName: a range names from-to, and any scope adds (مخصص) once', () => {
  const range = normalizeScope(SCOPED.range);
  assert.equal(buildFileName(P, DATE, 'pptx', range), 'تقرير مسبار 11092026-23092026 (مخصص).pptx');
  // The range comes from the SCOPE, not from dateStr.
  assert.equal(buildFileName(PI, '2026-09-29', 'pdf', range), 'تقرير مسبار الداخلي 11092026-23092026 (مخصص).pdf');
  // Labs- or shipments-only: the report date stays, the suffix marks it.
  assert.equal(buildFileName(P, DATE, 'pdf', normalizeScope(SCOPED.labs)), 'تقرير مسبار 23092026 (مخصص).pdf');
  assert.equal(buildFileName(P, DATE, 'pptx', normalizeScope(SCOPED.shipments)), 'تقرير مسبار 23092026 (مخصص).pptx');
  // Everything at once: still one suffix, range date part.
  const all = buildFileName(P, DATE, 'pptx', normalizeScope(SCOPED.everything));
  assert.equal(all, 'تقرير مسبار 11092026-23092026 (مخصص).pptx');
  assert.equal(all.split('مخصص').length - 1, 1);
});

test('buildFileDefs threads the scope into all four names; no scope = historic names', () => {
  const historic = buildFileDefs(DATE).map((d) => d.name);
  assert.deepEqual(historic, [
    'تقرير مسبار الداخلي 23092026.pptx',
    'تقرير مسبار 23092026.pptx',
    'تقرير مسبار الداخلي 23092026.pdf',
    'تقرير مسبار 23092026.pdf',
  ]);
  assert.deepEqual(buildFileDefs(DATE, EMPTY_SCOPE).map((d) => d.name), historic);
  const scoped = buildFileDefs(DATE, normalizeScope(SCOPED.range));
  assert.deepEqual(scoped.map((d) => d.id), ['internal-pptx', 'nupco-pptx', 'internal-pdf', 'nupco-pdf']);
  for (const d of scoped) {
    assert.match(d.name, / 11092026-23092026 \(مخصص\)\.(pptx|pdf)$/, d.id);
  }
});

/* ------------------------------------------------------------------ *
 * formatRangeAr
 * ------------------------------------------------------------------ */

test('formatRangeAr: same month, same year, across years (en dash, Western digits)', () => {
  assert.equal(formatRangeAr('2026-09-11', '2026-09-23'), '11 – 23 سبتمبر 2026');
  assert.equal(formatRangeAr('2026-08-28', '2026-09-23'), '28 أغسطس – 23 سبتمبر 2026');
  assert.equal(formatRangeAr('2025-12-28', '2026-01-05'), '28 ديسمبر 2025 – 5 يناير 2026');
  assert.ok(formatRangeAr('2026-09-11', '2026-09-23').includes(' – '), 'an EN dash with spaces');
});

test('formatRangeAr: a one-day range is that day; an unusable end yields empty', () => {
  assert.equal(formatRangeAr(DATE, DATE), '23 سبتمبر 2026');
  assert.equal(formatRangeAr(null, DATE), '');
  assert.equal(formatRangeAr('2026-09-11', 'garbage'), '');
});

/* ------------------------------------------------------------------ *
 * applyWindowDeltas — the chips count the scoped rows
 * ------------------------------------------------------------------ */

function captureStamper() {
  const seen = [];
  return { seen, fn: (model, args) => { seen.push(args); } };
}

test('applyWindowDeltas prefers model.scopedRows and never widens it to all rows', () => {
  const ALL = [{ orderId: '1' }, { orderId: '2' }];
  const SUBSET = [ALL[0]];
  const state = { parsed: { orders: ALL } };
  const st = { settings: { tatLookup: { T: 3 }, reportOptions: { deltaMode: 'week' } } };

  let cap = captureStamper();
  applyWindowDeltas({ kpi: {}, scopedRows: SUBSET }, state, st, cap.fn);
  assert.equal(cap.seen[0].rows, SUBSET, 'scopedRows wins');
  assert.deepEqual(cap.seen[0].tatTests, { T: 3 });
  assert.equal(cap.seen[0].mode, 'week');

  // A scope that matched nothing stays empty — the stamper's no-rows path keeps the
  // engine deltas; falling back to ALL would print everyone's activity on the subset.
  cap = captureStamper();
  const none = [];
  applyWindowDeltas({ kpi: {}, scopedRows: none }, state, st, cap.fn);
  assert.equal(cap.seen[0].rows, none);

  // No scopedRows (runAutomation's model, the fallback model) → the parsed orders.
  for (const model of [{ kpi: {} }, { kpi: {}, scopedRows: null }]) {
    cap = captureStamper();
    applyWindowDeltas(model, state, st, cap.fn);
    assert.equal(cap.seen[0].rows, ALL);
  }
});

/* ------------------------------------------------------------------ *
 * runAutomation — always the FULL report
 * ------------------------------------------------------------------ */

test('runAutomation rebuilds a full model and records it, even over a scoped review model', async () => {
  const st = spyStore();
  const ROWS = [{ orderId: '1', testName: 'TEST A', facility: 'Lab A' }];
  const leftover = makeModel(normalizeScope(SCOPED.everything));
  leftover.scopedRows = [];
  const state = {
    files: { csv: null, tracker: null },
    parsed: { orders: ROWS, tracker: null, summary: null },
    reportModel: leftover, // what the review screen left behind
    edits: {},
    reportDate: DATE,
  };
  let seen = null;
  const res = await runAutomation({
    store: st,
    state,
    options: { ...AUTOMATION_DEFAULTS, enabled: true, autoGenerate: true },
    deps: {
      loadEngine: async () => ({
        compute: () => ({ totals: { total: 1 }, funnel: {}, buckets: { completed: 1 } }),
      }),
      loadReportModel: async () => ({
        buildReportModel: ({ engineOutput, reportDate }) => ({ reportDate, kpi: engineOutput }),
      }),
      loadSendoutMaster: async () => null,
      loadDeltaWindow: async () => null,
      loadDeltaBaseline: async () => null,
      loadTaskLifecycle: async () => null,
      loadDownload: async () => null,
      produceReportFiles: async ({ model }) => {
        seen = model;
        return buildFileDefs(model.reportDate, model.scope).map((def) => ({ def, blob: { size: 1 } }));
      },
    },
  });
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.notEqual(seen, leftover, 'the scoped review model is never published');
  assert.equal(isScoped(seen.scope), false);
  assert.equal(seen.scopedRows, undefined);
  assert.deepEqual(res.files.map((f) => f.name), buildFileDefs(DATE).map((d) => d.name), 'historic names');
  assert.equal(st.snapshots.length, 1, 'the full report is recorded');
});

// The leftover lives in state.reportModel, which stepEngine only REPLACES on success.
// Every way the engine step can end without building a model must leave generate with
// nothing to publish — never the review screen's scoped side report — and must not
// clear the operator's model either (a failed run would wipe their review edits).
const ENGINE_OK = async () => ({
  compute: () => ({ totals: { total: 1 }, funnel: {}, buckets: { completed: 1 } }),
});
const MODEL_OK = async () => ({
  buildReportModel: ({ engineOutput, reportDate }) => ({ reportDate, kpi: engineOutput }),
});
const ENGINE_FAILURES = Object.freeze({
  'no orders': { orders: [], deps: {}, engine: 'skip' },
  'no compute export': { deps: { loadEngine: async () => ({}) }, engine: 'skip' },
  'compute throws': {
    deps: { loadEngine: async () => ({ compute: () => { throw new Error('boom'); } }) }, engine: 'error',
  },
  'compute returns no totals': {
    deps: { loadEngine: async () => ({ compute: () => ({}) }) }, engine: 'error',
  },
  'report-model module missing': {
    deps: { loadReportModel: async () => { throw new Error('missing module'); } }, engine: 'error',
  },
  'buildReportModel throws': {
    deps: { loadReportModel: async () => ({ buildReportModel: () => { throw new Error('bad model'); } }) },
    engine: 'error',
  },
});

test('runAutomation never publishes the leftover scoped model when the engine step skips or fails', async () => {
  for (const [name, c] of Object.entries(ENGINE_FAILURES)) {
    const st = spyStore();
    const leftover = makeModel(normalizeScope(SCOPED.everything));
    leftover.scopedRows = [];
    const state = {
      files: { csv: null, tracker: null },
      parsed: { orders: c.orders || [{ orderId: '1', testName: 'TEST A', facility: 'Lab A' }], tracker: null, summary: null },
      reportModel: leftover,
      edits: {},
      reportDate: '2026-09-29', // the CHOSEN date; the leftover's reportDate is the range end
    };
    let generated = 0;
    const draftDates = [];
    const downloads = [];
    const res = await runAutomation({
      store: st,
      state,
      options: {
        ...AUTOMATION_DEFAULTS, enabled: true, autoGenerate: true, autoDownload: true,
        autoLabFiles: true, autoEmailDrafts: true,
      },
      deps: {
        loadEngine: ENGINE_OK,
        loadReportModel: MODEL_OK,
        loadSendoutMaster: async () => null,
        loadDeltaWindow: async () => null,
        loadDeltaBaseline: async () => null,
        loadTaskLifecycle: async () => null,
        loadLabContacts: async () => null,
        loadLateLabs: async () => ({
          buildLateLabWorkbooks: () => [{ lab: 'Lab A', fileName: 'Lab A.xlsx', xlsxBytes: new Uint8Array([1]) }],
        }),
        loadEmlDraft: async () => ({
          buildLabEmailDraft: ({ lab, reportDate }) => {
            draftDates.push(reportDate);
            return { fileName: `${lab}.eml`, blob: { size: 1 } };
          },
        }),
        loadDownload: async () => ({ triggerDownload: (blob, fileName) => { downloads.push(fileName); } }),
        produceReportFiles: async ({ model }) => {
          generated += 1;
          return buildFileDefs(model.reportDate, model.scope).map((def) => ({ def, blob: { size: 1 } }));
        },
        ...c.deps,
      },
    });
    const status = (id) => (res.steps.find((s) => s.id === id) || {}).status;
    assert.equal(status('engine'), c.engine, `${name}: engine step status`);
    assert.equal(status('generate'), 'skip', `${name}: generate has no model of its own`);
    assert.equal(generated, 0, `${name}: produceReportFiles never called`);
    assert.deepEqual(res.files, [], `${name}: no deck files`);
    assert.ok(!downloads.some((n) => n.includes('مخصص')), `${name}: no scoped file downloaded`);
    assert.equal(st.snapshots.length, 0, `${name}: nothing recorded`);
    assert.equal(state.reportModel, leftover, `${name}: the operator's model is left in place`);
    // Drafts are dated by the chosen report date, not the leftover's range end.
    if (status('labs') === 'done') {
      assert.deepEqual(draftDates, ['2026-09-29'], `${name}: draft date`);
    }
  }
});

test('runAutomation refuses to publish a model that carries a scope (belt and braces)', async () => {
  // stepEngine sets no scope today; if buildReportModel ever returns one, the unattended
  // run must fail loudly rather than ship «(مخصص)» files as the morning report.
  const st = spyStore();
  let generated = 0;
  const res = await runAutomation({
    store: st,
    state: {
      files: { csv: null, tracker: null },
      parsed: { orders: [{ orderId: '1', testName: 'TEST A', facility: 'Lab A' }], tracker: null, summary: null },
      reportModel: null,
      edits: {},
      reportDate: DATE,
    },
    options: { ...AUTOMATION_DEFAULTS, enabled: true, autoGenerate: true },
    deps: {
      loadEngine: ENGINE_OK,
      loadReportModel: async () => ({
        buildReportModel: ({ engineOutput, reportDate }) => ({
          reportDate, kpi: engineOutput, scope: normalizeScope(SCOPED.labs),
        }),
      }),
      loadSendoutMaster: async () => null,
      loadDeltaWindow: async () => null,
      loadDeltaBaseline: async () => null,
      loadTaskLifecycle: async () => null,
      loadDownload: async () => null,
      produceReportFiles: async () => { generated += 1; return []; },
    },
  });
  assert.equal((res.steps.find((s) => s.id === 'generate') || {}).status, 'error');
  assert.equal(generated, 0, 'no files produced');
  assert.equal(st.snapshots.length, 0, 'nothing recorded');
  assert.equal(res.ok, false);
});

/* ------------------------------------------------------------------ *
 * Share card — the text pasted into a chat, without the deck
 * ------------------------------------------------------------------ */

// HEAD's template, spelled out: the unscoped message must never move.
const SHARE_FULL = [
  'تقرير مسبار الأسبوعي — 23/09/2026',
  '• إجمالي الطلبات: 10',
  '• فحوصات مكتملة (تشمل المرفوضة): 5 (50%)',
  '↳ منها مرفوضة: 1',
  '• بانتظار النتائج: 2',
  '↳ منها متأخرة: 1',
  '• ملغاة: 0',
  'الملفات: 4 (نسختا PPTX و PDF داخلية ونوبكو)',
].join('\n');

/** The scope line (line 2) of a scoped share text. */
const scopeLineOf = (scope) => shareText(makeModel(scope), DATE, 4).split('\n')[1];

test('shareText: every unscoped shape is byte-identical to the historic message', () => {
  for (const [name, scope] of Object.entries(UNSCOPED)) {
    assert.equal(shareText(makeModel(scope), DATE, 4), SHARE_FULL, name);
  }
});

test('shareText: the lab list folds after three names, like the cover', () => {
  const labs = ['Lab A', 'Lab B', 'Lab C', 'Lab D', 'Lab E', 'Lab F'];
  const S = STR.review.scope;
  // Three or fewer: every name, no tail.
  assert.equal(scopeLineOf({ labs: labs.slice(0, 2) }), `${S.active} — ${S.labs}: Lab A، Lab B`);
  assert.equal(scopeLineOf({ labs: labs.slice(0, 3) }), `${S.active} — ${S.labs}: Lab A، Lab B، Lab C`);
  // Four: the first three and 'و1 أخرى' — the fourth name is never printed.
  const four = scopeLineOf({ labs: labs.slice(0, 4) });
  assert.equal(four, `${S.active} — ${S.labs}: Lab A، Lab B، Lab C و1 أخرى`);
  assert.ok(!four.includes('Lab D'));
  assert.ok(scopeLineOf({ labs }).endsWith('Lab C و3 أخرى'));
});

test('shareText: a range prints its dates on the scope line, never the bare label', () => {
  const S = STR.review.scope;
  const range = formatRangeAr('2026-09-11', DATE);
  for (const scope of [SCOPED.range, normalizeScope(SCOPED.range)]) {
    const [heading, line] = shareText(makeModel(scope), DATE, 4).split('\n');
    assert.equal(heading, `تقرير مسبار الأسبوعي — ${range}`, 'the heading carries the range');
    assert.equal(line, `${S.active} — ${S.range}: ${range}`);
    assert.ok(!line.endsWith(S.range), 'no dangling «الفترة» item');
  }
  // All three at once: labs · shipments · range, the shipment cap unchanged.
  const ships = ['ELAB000001', 'ELAB000002', 'ELAB000003', 'ELAB000004', 'ELAB000005', 'ELAB000006', 'ELAB000007'];
  assert.equal(
    scopeShareLine({ labs: ['Lab A', 'Lab B', 'Lab C', 'Lab D'], shipments: ships, from: '2026-09-11', to: DATE }),
    `${S.active} — ${S.labs}: Lab A، Lab B، Lab C و1 أخرى`
      + ` · ${S.shipments}: ELAB000001، ELAB000002، ELAB000003، ELAB000004، ELAB000005 (+2)`
      + ` · ${S.range}: ${range}`,
  );
  // A half range normalises to NO range: no period item, and no stray label either.
  assert.equal(scopeShareLine({ labs: ['Lab A'], from: '2026-09-11' }), `${S.active} — ${S.labs}: Lab A`);
});

/* ------------------------------------------------------------------ *
 * Strings the review screen reads
 * ------------------------------------------------------------------ */

test('STR.review.scope / STR.review.sendout carry every contract key', () => {
  const S = STR.review.scope;
  for (const k of [
    'title', 'allLabs', 'labs', 'shipments', 'shipmentsHint', 'shipmentsPlaceholder', 'shipmentsApply',
    'shipmentSlide', 'range', 'from', 'to', 'rangeApply', 'rangeInvalid', 'rangeFuture', 'reset',
    'active', 'sideReport', 'notFoundTitle', 'proceed', 'recheck', 'noneFound',
    'historyHidden', 'overridesCleared',
  ]) {
    assert.equal(typeof S[k], 'string', k);
    assert.ok(S[k].trim(), `${k} is non-empty`);
  }
  for (const k of ['notFoundBody', 'outsideScope']) {
    assert.equal(typeof S[k], 'function', k);
    const out = S[k](['ELAB000001', 'ELAB000002']);
    assert.ok(out.includes('ELAB000001') && out.includes('ELAB000002'), `${k} lists the ids`);
    assert.equal(typeof S[k](undefined), 'string', `${k} tolerates a missing list`);
  }
  // The deck's word and the file name's word are the same one.
  assert.ok(S.active.includes('مخصص'));
  assert.ok(S.sideReport.includes('سجل التقارير'), 'says plainly it is not recorded in the history');

  // historyHidden/overridesCleared (and sendout.noLab/orders below) began life in the
  // review screen's PENDING_STR fallback map; its str() reads STR.review[group][key]
  // first, so ar.js carrying them with the same values is invisible on screen.
  assert.ok(S.historyHidden.includes('التقرير الكامل'), 'historyHidden names the full report');
  assert.ok(S.overridesCleared.includes('نطاق التقرير'), 'overridesCleared names the scope change');

  const O = STR.review.sendout;
  for (const k of ['gapsTitle', 'unmappedHint', 'unresolvedHint', 'byTestNameTitle', 'byTestNameHint', 'noLab']) {
    assert.equal(typeof O[k], 'string', k);
    assert.ok(O[k].trim(), `${k} is non-empty`);
  }
  assert.equal(O.noLab, 'بدون مختبر مُنفِّذ');
  assert.equal(typeof O.orders, 'function', 'orders is a count formatter');
  assert.equal(O.orders(12), '12 طلبًا');
  // The retired, wrong claim ("no matching performing lab in the master file") is gone
  // from every review string, and so are the legacy aliases that once carried it.
  const all = JSON.stringify(STR.review);
  assert.ok(!all.includes('لا يوجد لها مختبر مُنفِّذ مطابق'), 'old misleading hint removed');
  assert.equal(STR.review.sendoutGapsTitle, undefined, 'legacy alias removed');
  assert.equal(STR.review.sendoutGapsHint, undefined, 'legacy alias removed');
  // Each hint names what sendout.js puts in its bucket — and none sends the reviewer to
  // "check the spelling": a blank lab, or a test listed under two suppliers, is not a typo.
  assert.ok(O.unmappedHint.includes('فارغ'), 'unmapped: the blank-lab case');
  assert.ok(O.unmappedHint.includes('أكثر من مورد'), 'unmapped: a test listed with several suppliers');
  assert.ok(O.unmappedHint.includes('غير مُدرج'), 'unmapped: a test absent from the file');
  assert.ok(O.unresolvedHint.includes('أكثر من دولة'), 'unresolved: a known multi-country supplier');
  assert.ok(O.byTestNameHint.includes('مورد واحد فقط'), 'byTestName: exactly one supplier');
  assert.ok(O.byTestNameHint.startsWith('للاطلاع'), 'byTestName is informational');
  for (const k of ['unmappedHint', 'unresolvedHint', 'byTestNameHint']) {
    assert.ok(!/تحقّق من (كتابة|الكتابة)/.test(O[k]), `${k}: no spelling over-claim`);
  }

  // The generate screen's note over the (never-scoped) lab workbooks carries its date slot.
  assert.equal(typeof STR.generate.lateLabsUnscoped, 'string');
  assert.ok(STR.generate.lateLabsUnscoped.includes('{date}'), 'lateLabsUnscoped has a {date} slot');
});
