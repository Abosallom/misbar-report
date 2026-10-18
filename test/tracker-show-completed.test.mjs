// test/tracker-show-completed.test.mjs — `node --test test/tracker-show-completed.test.mjs`
//
// «إظهار المهام المكتملة في شريحة متابعة المهام» — reportOptions.trackerShowCompleted
// (2026-10-18 user request: «Make an OPTION to choose whether I want you to show all the
// completed tasks in the Task Tracker or not (Same rules in terms of their Orders should be
// applied)… I want it to be an OPTIONAL»). Pinned here:
//   • OFF (default / absent / any non-true value) — the task slides are byte-identical to the
//     decks before the option (no Completed row, no «مكتمل» pill), every cadence × language;
//   • ON — EVERY task in both cadences × every language: the Completed group LAST inside each
//     stage, by priority (sortStageTasks); every other row in the very order of the OFF deck;
//     stages / tracks of only Completed tasks back in their Portfolio place; the «مكتمل» pill
//     right after «إجمالي المهام», every count = the table cells, the total includes them,
//     «متجاوزة الموعد» unchanged; the weekly «المهام المكتملة خلال الأسبوع» slide unchanged;
//   • the decks (KAMC / SGH / KAMC + SGH, both variants) read the saved option;
//   • the store seeds / backfills / persists / imports it; the review screen's helpers carry
//     and persist it; the switch's options and wording.
// SYNTHETIC data only (public repo) — never the user's workbook rows, names or translations.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTrackerSlides, buildTrackerCompletedSlides, TR } from '../src/slidespec/build-tracker.js';
import { buildSpec } from '../src/slidespec/build-spec.js';
import { buildBothModel } from '../src/model/hospital-report.js';
import { recordStatusLog, effectiveStatus, STATUS_AR } from '../src/model/tracker-status.js';
import { REPORT_OPTIONS_SEED } from '../src/seeds/defaults.js';
import { SETTINGS_KEY } from '../src/contracts.js';
import * as store from '../src/store.js';
import { reportOptionsFromSettings, mergeReportOptions } from '../src/ui/screen-review.js';
import { normalizeTrackerShowCompleted, TRACKER_SHOW_COMPLETED_OPTIONS, trackerShowCompletedControl } from '../src/ui/components.js';
import { STR } from '../src/i18n/ar.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';
import { loadPptxGen, installDom, unzipPptx } from './render-helpers.mjs';

const RD = '2026-10-18';
const EPS = 1e-9;
const LANGS = ['ar', 'en', 'both'];
const CADENCES = ['weekly', 'daily', undefined];
const bare = (s) => String(s).replace(/[‪-‮]/g, '');
const sum = (a) => a.reduce((s, v) => s + v, 0);
const tableOf = (s) => s.elements.find((e) => e.t === 'table');
const chipTexts = (s) => s.elements.filter((e) => e.t === 'text' && Math.abs(e.y - TR.stripY) < EPS).map((e) => e.text);
const chipN = (chips, label) => {
  const c = chips.find((x) => x.startsWith(`${label} `));
  return c == null ? undefined : Number(c.split(' ').at(-1));
};

let seq = 0;
const task = (o = {}) => {
  seq += 1;
  return {
    id: `r${seq}`, wbs: `9.${seq}`, track: 'Track A', milestone: 'Stage 1', workstream: '', workPackage: '',
    task: `Synthetic task ${seq}`, taskType: '', organization: 'LEAN', owner: 'Owner A', priority: 'High',
    status: 'In Progress', due: '', predecessor: '', nextAction: '', definitionOfDone: '', notes: '', ...o,
  };
};
const tracker = (tasks) => ({ format: 'misbar-task-tracker-v1', fileName: 'synthetic.xlsx', loadedAt: '2026-10-13T00:00:00.000Z', editedAt: null, warnings: [], tasks });

/** Body rows of a table in LOGICAL order, covered cells as null (HTML table algorithm). */
function grid(t) {
  const n = t.colW.length;
  const body = t.rows.slice(1);
  const out = body.map(() => Array(n).fill(undefined));
  body.forEach((vis, r) => {
    let c = 0;
    for (const cell of vis) {
      while (c < n && out[r][c] !== undefined) c++;
      const span = (cell && cell.rowSpan) || 1;
      for (let k = 0; k < span; k++) out[r + k][c] = k ? null : cell;
      c++;
    }
  });
  return out.map((row) => row.slice().reverse());
}
const rowsOf = (slides) => slides.flatMap((s) => grid(tableOf(s)));
/** One entry per TASK (its status cell — a 'both' English sub-row has none). */
const taskRows = (slides) => rowsOf(slides).filter((r) => r[6]);
const taskTexts = (slides) => taskRows(slides).map((r) => bare(r[2].text));
function countCells(slides) {
  const out = {};
  let red = 0;
  for (const r of taskRows(slides)) {
    out[r[6].text] = (out[r[6].text] || 0) + 1;
    if (r[7].color === '#DC2626') red += 1;
  }
  return { out, red };
}

/** A mixed tracker — every status, priority and due kind, across tracks / stages — with
 *  synthetic Arabic on half the rows so the three languages really differ. */
const MIX = () => Array.from({ length: 41 }, (_, i) => task({
  track: `Track ${i % 4}`, milestone: `Stage ${i % 7}`,
  status: ['Completed', 'In Progress', 'Deleyed', 'Blocked', 'On Hold', 'Not Started', '', 'Not Found', 'Odd word'][i % 9],
  priority: ['Critical', 'High', 'Medium', 'Low', ''][i % 5],
  due: ['2026-09-01', '2026-11-01', 'daily', '', 'TBD', '17/10/2026', '2026-10-18'][i % 7],
  ...(i % 2 ? { taskAr: `مهمة تجريبية رقم ${i}`, trackAr: `مسار ${i % 4}`, milestoneAr: `مرحلة ${i % 7}` } : {}),
}));

// ---- OFF: byte-identical ----------------------------------------------------------------------

test('OFF (default, false, absent, junk): the task slides are byte-identical to the decks before the option', () => {
  const t = tracker(MIX());
  for (const cadence of CADENCES) {
    for (const lang of LANGS) {
      const base = buildTrackerSlides(t, { reportDate: RD, cadence, lang });
      assert.ok(base.length, `${cadence}/${lang}: slides`);
      for (const v of [false, undefined, null, 'true', 1, 'yes', {}]) {
        assert.deepEqual(buildTrackerSlides(t, { reportDate: RD, cadence, lang, showCompleted: v }), base,
          `${cadence}/${lang}: showCompleted=${JSON.stringify(v)} changes nothing`);
      }
      assert.ok(!taskRows(base).some((r) => r[6].text === STATUS_AR.completed), `${cadence}/${lang}: no completed row`);
      assert.ok(!chipTexts(base[0]).some((c) => c.startsWith(STATUS_AR.completed)), `${cadence}/${lang}: no completed pill`);
    }
  }
  // All completed + OFF → still no slide at all.
  const allDone = tracker([task({ status: 'Completed' }), task({ status: 'Done' })]);
  assert.deepEqual(buildTrackerSlides(allDone, { reportDate: RD }), []);
});

// ---- ON: every task, rules applied --------------------------------------------------------------

test('ON, every cadence × language: every task printed, the «مكتمل» pill after the total, every count = the table cells', () => {
  const tasks = MIX();
  const t = tracker(tasks);
  const done = tasks.filter((x) => effectiveStatus(x, RD).key === 'completed').length;
  assert.ok(done > 0);
  for (const cadence of CADENCES) {
    for (const lang of LANGS) {
      const tag = `${cadence}/${lang}`;
      const off = buildTrackerSlides(t, { reportDate: RD, cadence, lang });
      const on = buildTrackerSlides(t, { reportDate: RD, cadence, lang, showCompleted: true });
      assert.equal(taskRows(on).length, tasks.length, `${tag}: every task once`);
      const { out, red } = countCells(on);
      assert.equal(out[STATUS_AR.completed], done, `${tag}: every completed task is a row`);
      const chips = chipTexts(on[0]);
      assert.deepEqual(chips.map((c) => c.replace(/ \d+$/, '')),
        ['إجمالي المهام', 'مكتمل', 'قيد التنفيذ', 'متأخر', 'متوقف', 'لم يبدأ', 'أخرى', 'متجاوزة الموعد'], `${tag}: the pill set`);
      assert.equal(chipN(chips, 'إجمالي المهام'), tasks.length, `${tag}: the total includes the completed`);
      assert.equal(chipN(chips, 'إجمالي المهام'), sum(Object.values(out)), `${tag}: total = rows`);
      for (const k of ['completed', 'inProgress', 'late', 'stopped', 'notStarted']) {
        assert.equal(chipN(chips, STATUS_AR[k]), out[STATUS_AR[k]] || 0, `${tag}: ${k} pill = cells`);
      }
      assert.equal(chipN(chips, 'أخرى'), out['Odd word'], `${tag}: unmappable`);
      assert.equal(chipN(chips, 'متجاوزة الموعد'), red, `${tag}: past due = the red dates`);
      assert.equal(chipN(chips, 'متجاوزة الموعد'), chipN(chipTexts(off[0]), 'متجاوزة الموعد'),
        `${tag}: past due unchanged — a completed task is never past due`);
      // A completed row: «مكتمل» in its green pill, its date never red (whatever its due).
      for (const r of taskRows(on).filter((x) => x[6].text === STATUS_AR.completed)) {
        assert.equal(r[6].fill, '#C6EFCE');
        assert.notEqual(r[7].color, '#DC2626', `${tag}: a completed task's date is not red`);
      }
      // Pagination: the strip is on the first page only; titles as before.
      assert.equal(on[0].elements[1].text, 'متابعة المهام');
      on.slice(1).forEach((s, i) => {
        assert.equal(s.id, `tracker-cont-${i + 1}`);
        assert.equal(s.elements[1].text, 'متابعة المهام —تتمة');
        assert.equal(chipTexts(s).length, 0, `${tag}: no strip on a continuation`);
      });
    }
  }
  // The cadence still changes nothing on these slides when ON.
  assert.deepEqual(buildTrackerSlides(t, { reportDate: RD, cadence: 'daily', showCompleted: true }),
    buildTrackerSlides(t, { reportDate: RD, cadence: 'weekly', showCompleted: true }));
});

test('ON: inside each stage the Completed group is LAST, by priority; every other row keeps the OFF order', () => {
  const T = (name, status, priority, due, extra = {}) => task({ task: name, status, priority, due, ...extra });
  const tasks = [
    T('done-low', 'Completed', 'Low', '2026-09-01'),
    T('ns-high', 'Not Started', 'High', '2026-12-01'),
    T('done-none', 'Done', '', '2026-08-01'),
    T('ip-high', 'In Progress', 'High', '2026-12-20'),
    T('done-crit', 'Completed', 'Critical', '2026-11-01'),
    T('late-crit', 'Delayed', 'Critical', '2026-09-15'),
    T('stop-high', 'Blocked', 'High', '2026-10-01'),
    T('done-high-a', 'Completed', 'High', 'TBD'),
    T('done-high-b', 'مكتمل', 'High', '2026-01-01'),
    T('done-med', 'Completed', 'Medium', ''),
  ];
  const off = taskTexts(buildTrackerSlides(tracker(tasks), { reportDate: RD }));
  const on = taskTexts(buildTrackerSlides(tracker(tasks), { reportDate: RD, showCompleted: true }));
  assert.deepEqual(off, ['late-crit', 'stop-high', 'ip-high', 'ns-high']);
  // Completed: by priority (critical → high → medium → low → none); within one priority the
  // undated task after the dated one (rule 2's "no date after the dated tasks", every group),
  // otherwise the file order — exactly sortStageTasks, the rule the user asked to keep.
  assert.deepEqual(on, [...off, 'done-crit', 'done-high-b', 'done-high-a', 'done-med', 'done-low', 'done-none']);
  // Every cadence × language: the same order (status cells are Arabic in every mode).
  for (const cadence of CADENCES) {
    for (const lang of LANGS) {
      const rows = taskRows(buildTrackerSlides(tracker(tasks), { reportDate: RD, cadence, lang, showCompleted: true }));
      const statuses = rows.map((r) => r[6].text);
      const firstDone = statuses.indexOf(STATUS_AR.completed);
      assert.ok(firstDone > 0 && statuses.slice(firstDone).every((s) => s === STATUS_AR.completed), `${cadence}/${lang}: completed last`);
      assert.deepEqual(rows.slice(firstDone).map((r) => r[5].text), ['حرجة', 'عالية', 'عالية', 'متوسطة', 'منخفضة', '–'], `${cadence}/${lang}: by priority`);
    }
  }
});

test('ON: stages / tracks of only Completed tasks come back in their Portfolio place; an all-completed tracker has slides', () => {
  const tasks = [
    task({ track: 'T2', milestone: 'M1', task: 'a', status: 'Completed' }),
    task({ track: 'T1', milestone: 'M9', task: 'b' }),
    task({ track: 'T3', milestone: 'M5', task: 'only-done', status: 'Completed' }),
    task({ track: 'T2', milestone: 'M0', task: 'c', status: 'Completed' }),
    task({ track: 'T2', milestone: 'M1', task: 'd', status: 'Delayed' }),
  ];
  // OFF: the M0 stage and the T3 track are gone (only Completed tasks).
  const off = rowsOf(buildTrackerSlides(tracker(tasks), { reportDate: RD }));
  assert.deepEqual(off.map((r) => r[2].text), ['d', 'b']);
  // ON: every stage and track back, in first-appearance order; M1's Completed 'a' after 'd'.
  const on = rowsOf(buildTrackerSlides(tracker(tasks), { reportDate: RD, showCompleted: true }));
  assert.deepEqual(on.map((r) => r[2].text), ['d', 'a', 'c', 'b', 'only-done']);
  assert.deepEqual([on[0][0].text, on[0][0].rowSpan, on[0][1].text, on[0][1].rowSpan], ['T2', 3, 'M1', 2]);
  assert.deepEqual([on[2][1].text, on[2][1].rowSpan], ['M0', 1]);
  assert.deepEqual([on[4][0].text, on[4][1].text], ['T3', 'M5']);
  // Every task Completed: OFF → no slide; ON → one slide, «مكتمل N», nothing past due.
  const allDone = tracker([task({ status: 'Completed', due: '2026-01-01' }), task({ status: 'Done', priority: 'Critical' })]);
  const slides = buildTrackerSlides(allDone, { reportDate: RD, showCompleted: true });
  assert.equal(slides.length, 1);
  assert.deepEqual(chipTexts(slides[0]), ['إجمالي المهام 2', 'مكتمل 2', 'قيد التنفيذ 0', 'متأخر 0', 'متوقف 0', 'لم يبدأ 0', 'متجاوزة الموعد 0']);
  assert.deepEqual(taskTexts(slides), [allDone.tasks[1].task, allDone.tasks[0].task], 'critical first');
});

test('ON: a zero «مكتمل» still shows (the fixed box set does not come and go)', () => {
  assert.deepEqual(chipTexts(buildTrackerSlides(tracker([task({ status: 'In Progress' })]), { reportDate: RD, showCompleted: true })[0]),
    ['إجمالي المهام 1', 'مكتمل 0', 'قيد التنفيذ 1', 'متأخر 0', 'متوقف 0', 'لم يبدأ 0', 'متجاوزة الموعد 0']);
});

test('the weekly «المهام المكتملة خلال الأسبوع» slide is the same whatever the option', () => {
  const before = [task({ wbs: '5.1', task: 'became-done', status: 'Delayed', due: '2026-10-01' }), task({ wbs: '5.2', task: 'open' })];
  const now = tracker([{ ...before[0], status: 'Completed' }, before[1]]);
  let log = recordStatusLog(null, tracker(before), '2026-10-10');
  log = recordStatusLog(log, now, '2026-10-16');
  const direct = buildTrackerCompletedSlides(now, log, { reportDate: RD });
  assert.deepEqual(taskTexts(direct), ['became-done']);
  for (const [name, make] of Object.entries(DECKS)) {
    const deck = (v) => buildSpec({ ...make(), reportDate: RD, projectTracker: now, trackerStatusLog: log, reportOptions: { trackerShowCompleted: v } });
    const pick = (spec) => spec.filter((s) => s.id.startsWith('trackerCompleted'));
    assert.ok(pick(deck(false)).length, `${name}: present`);
    assert.deepEqual(pick(deck(true)), pick(deck(false)), `${name}: unchanged by the option`);
  }
});

// ---- the decks read the saved option ------------------------------------------------------------

function bothModel() {
  return buildBothModel({
    kamcRows: [], sghRows: [], tracker: null, sendoutMaster: [],
    settings: { tatLookup: {}, historicalConstants: { cancelledByMonth: {} }, reportOptions: { excludeNoTat: false } },
    reportDate: RD,
  });
}
const DECKS = {
  KAMC: () => structuredClone(MOCK_REPORT_MODEL),
  SGH: () => ({ ...structuredClone(MOCK_REPORT_MODEL), hospital: 'sgh' }),
  'KAMC+SGH': () => bothModel(),
};

test('decks (KAMC / SGH / KAMC + SGH × internal / NUPCO × weekly / daily): reportOptions.trackerShowCompleted drives the task slides', () => {
  const t = tracker([
    task({ task: 'open-one', status: 'In Progress', due: '2026-12-01' }),
    task({ task: 'done-one', status: 'Completed', priority: 'Critical' }),
    task({ track: 'Track Z', milestone: 'Stage Z', task: 'done-alone', status: 'Completed' }),
  ]);
  const taskSlides = (spec) => spec.filter((s) => /^tracker(-cont-\d+)?$/.test(s.id));
  for (const [name, make] of Object.entries(DECKS)) {
    for (const variant of ['internal', 'nupco']) {
      for (const cadence of ['weekly', 'daily']) {
        const tag = `${name} ${variant} ${cadence}`;
        const deck = (ro) => buildSpec({ ...make(), reportDate: RD, projectTracker: t, reportOptions: { cadence, ...ro } }, { variant });
        const absent = deck({});
        assert.deepEqual(deck({ trackerShowCompleted: false }), absent, `${tag}: false = absent`);
        assert.deepEqual(deck({ trackerShowCompleted: 'true' }), absent, `${tag}: only a real true turns it on`);
        assert.deepEqual(taskTexts(taskSlides(absent)), ['open-one'], `${tag}: OFF — the open task only`);
        const on = deck({ trackerShowCompleted: true });
        assert.deepEqual(taskTexts(taskSlides(on)), ['open-one', 'done-one', 'done-alone'], `${tag}: ON — every task, completed last`);
        assert.equal(chipN(chipTexts(taskSlides(on)[0]), 'مكتمل'), 2, `${tag}: the «مكتمل» pill`);
        // Nothing else in the deck moves (page numbers count the same slides).
        const others = (spec) => spec.filter((s) => !/^tracker(-cont-\d+)?$/.test(s.id));
        assert.deepEqual(others(on), others(absent), `${tag}: only the task slides change`);
      }
    }
  }
});

test('ON: both renderers draw the slides with the completed rows and pill', async () => {
  const { PptxGenJS, JSZip } = loadPptxGen();
  installDom();
  const { renderPptx } = await import('../src/render/pptx-renderer.js');
  const { renderSlides } = await import('../src/render/html-renderer.js');
  const spec = buildTrackerSlides(tracker(MIX()), { reportDate: RD, lang: 'both', showCompleted: true });
  const blob = await renderPptx(spec, { PptxGenJS, JSZip });
  const { names, read } = await unzipPptx(blob);
  assert.equal(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, spec.length);
  assert.match(await read('ppt/slides/slide1.xml'), /مكتمل/);
  assert.ok(renderSlides(spec, { variant: 'nupco' }));
});

// ---- the store ------------------------------------------------------------------------------------

function makeMock() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k), clear: () => map.clear() };
}
function fresh() {
  globalThis.localStorage = makeMock();
  store.__resetForTests();
  return globalThis.localStorage;
}

test('store: seeded OFF; an absent / non-boolean stored value is backfilled OFF; a stored choice is kept', () => {
  assert.equal(REPORT_OPTIONS_SEED.trackerShowCompleted, false, 'the first-run copy: OFF');
  fresh();
  assert.equal(store.loadSettings().reportOptions.trackerShowCompleted, false, 'fresh install');
  const mock = fresh();
  mock.setItem(SETTINGS_KEY, JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: { deltaMode: 'week' } }));
  assert.equal(store.loadSettings().reportOptions.trackerShowCompleted, false, 'a doc from before the option');
  for (const junk of ['true', 1, null, {}]) {
    fresh().setItem(SETTINGS_KEY, JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: { trackerShowCompleted: junk } }));
    assert.equal(store.loadSettings().reportOptions.trackerShowCompleted, false, `junk ${JSON.stringify(junk)} → OFF`);
  }
  fresh().setItem(SETTINGS_KEY, JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: { trackerShowCompleted: true } }));
  assert.equal(store.loadSettings().reportOptions.trackerShowCompleted, true, 'a stored «نعم» survives the backfill');
});

test('store: the choice persists across a reload and an export → import round trip', async () => {
  fresh();
  const doc = store.loadSettings();
  doc.reportOptions.trackerShowCompleted = true;
  store.saveSettings(doc);
  store.__resetForTests();
  assert.equal(store.loadSettings().reportOptions.trackerShowCompleted, true);
  const backup = await store.exportSettings().blob.text();
  assert.equal(JSON.parse(backup).reportOptions.trackerShowCompleted, true);
  fresh();
  store.loadSettings();
  store.importSettings(backup);
  assert.equal(store.loadSettings().reportOptions.trackerShowCompleted, true);
});

test('store import: coerced to a boolean like the other presentation flags; absent keeps this device\'s', () => {
  fresh();
  store.loadSettings();
  const imp = (ro) => store.importSettings(JSON.stringify({ schemaVersion: store.SCHEMA_VERSION, reportOptions: ro }));
  imp({ trackerShowCompleted: 1 });
  assert.equal(store.loadSettings().reportOptions.trackerShowCompleted, true, '1 → true');
  imp({ deltaMode: 'week' }); // an old backup without the key
  assert.equal(store.loadSettings().reportOptions.trackerShowCompleted, true, 'this device\'s choice stays');
  imp({ trackerShowCompleted: 0 });
  assert.equal(store.loadSettings().reportOptions.trackerShowCompleted, false, '0 → false');
});

// ---- the review screen / Settings ----------------------------------------------------------------

test('review: reportOptionsFromSettings reads it (absent / junk → OFF); the persist merge writes a real boolean', () => {
  assert.equal(reportOptionsFromSettings({}).trackerShowCompleted, false);
  assert.equal(reportOptionsFromSettings({ reportOptions: {} }).trackerShowCompleted, false);
  assert.equal(reportOptionsFromSettings({ reportOptions: { trackerShowCompleted: true } }).trackerShowCompleted, true);
  assert.equal(reportOptionsFromSettings({ reportOptions: { trackerShowCompleted: 'true' } }).trackerShowCompleted, false,
    'the deck reads === true — the screen must agree');
  // A switch click → persistReportOptions' merge: the screen's value wins, the rest stays.
  const cur = { deltaMode: 'week', cadence: 'daily', trackerLang: 'en', trackerShowCompleted: false, slideOrder: ['tracker'], extra: 1 };
  const on = mergeReportOptions(cur, { ...reportOptionsFromSettings({ reportOptions: cur }), trackerShowCompleted: true });
  assert.equal(on.trackerShowCompleted, true);
  assert.equal(on.cadence, 'daily');
  assert.equal(on.trackerLang, 'en');
  assert.deepEqual(on.slideOrder, ['tracker'], 'the saved order untouched');
  assert.equal(on.extra, 1, 'unknown stored keys kept');
  const off = mergeReportOptions(on, { ...reportOptionsFromSettings({ reportOptions: on }), trackerShowCompleted: false });
  assert.equal(off.trackerShowCompleted, false);
  // A chip click that predates the option (its ro has no key) never turns it on.
  assert.equal(mergeReportOptions({ trackerShowCompleted: true }, {}).trackerShowCompleted, false);
});

test('the switch: لا / نعم, «لا» first (the default), one-line hints; the reading is the decks\' `=== true`', () => {
  assert.deepEqual(TRACKER_SHOW_COMPLETED_OPTIONS.map((o) => o.value), [false, true]);
  assert.deepEqual(TRACKER_SHOW_COMPLETED_OPTIONS.map((o) => o.label), ['لا', 'نعم']);
  for (const o of TRACKER_SHOW_COMPLETED_OPTIONS) assert.ok(o.hint && !o.hint.includes('\n'), 'a one-line hint');
  assert.equal(STR.tracker.showCompletedTitle, 'إظهار المهام المكتملة في شريحة متابعة المهام');
  assert.equal(normalizeTrackerShowCompleted(true), true);
  for (const v of [false, undefined, null, 'true', 1]) assert.equal(normalizeTrackerShowCompleted(v), false, JSON.stringify(v));
  // The cadence hints no longer claim the task slides can never show a completed task.
  for (const k of ['weekly', 'daily']) assert.match(STR.review.cadence.hint[k], /ما لم تختر إظهار المكتملة/, k);
});

// A minimal event-capable DOM (render-helpers' shim has no events) — just what el() and the
// switch touch, so the switch's behaviour is pinned without a browser.
function eventDom() {
  class N {
    constructor(tag) { this.tagName = tag; this.childNodes = []; this.attrs = new Map(); this.dataset = {}; this.handlers = {}; this._text = ''; }
    appendChild(c) { this.childNodes.push(c); return c; }
    addEventListener(t, f) { (this.handlers[t] ||= []).push(f); }
    click() { for (const f of this.handlers.click || []) f({ target: this }); }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    set className(v) { this.attrs.set('class', v); }
    get className() { return this.attrs.get('class') || ''; }
    set textContent(v) { this._text = String(v); this.childNodes = []; }
    get textContent() { return this._text + this.childNodes.map((c) => c.textContent).join(''); }
    find(pred) {
      const out = [];
      const walk = (n) => n.childNodes.forEach((c) => { if (c instanceof N) { if (pred(c)) out.push(c); walk(c); } });
      walk(this);
      return out;
    }
  }
  return { createElement: (t) => new N(t), createTextNode: (t) => ({ textContent: String(t) }) };
}

test('the switch (DOM): لا pressed by default, a click on نعم reports true once and swaps the hint; set() repaints', () => {
  const prev = globalThis.document;
  globalThis.document = eventDom();
  try {
    const calls = [];
    const c = trackerShowCompletedControl({ value: undefined, onChange: (v) => calls.push(v) });
    const btns = c.el.find((n) => n.tagName === 'button');
    const hint = c.el.find((n) => n.tagName === 'p')[0];
    const pressed = () => btns.map((b) => b.getAttribute('aria-pressed'));
    assert.deepEqual(btns.map((b) => b.textContent), ['لا', 'نعم']);
    assert.deepEqual(pressed(), ['true', 'false'], 'OFF by default');
    assert.equal(hint.textContent, STR.tracker.showCompletedHint.no);
    assert.ok(c.el.textContent.includes(STR.tracker.showCompletedTitle), 'titled');
    btns[1].click();
    assert.deepEqual(calls, [true]);
    assert.deepEqual(pressed(), ['false', 'true']);
    assert.equal(hint.textContent, STR.tracker.showCompletedHint.yes);
    btns[1].click();
    assert.deepEqual(calls, [true], 'no change → no call (no needless save / re-render)');
    btns[0].click();
    assert.deepEqual(calls, [true, false]);
    c.set(true);
    assert.deepEqual(pressed(), ['false', 'true'], 'set() repaints without reporting');
    assert.deepEqual(calls, [true, false]);
    const on = trackerShowCompletedControl({ value: true });
    assert.deepEqual(on.el.find((n) => n.tagName === 'button').map((b) => b.getAttribute('aria-pressed')), ['false', 'true'], 'a saved «نعم» shows');
  } finally {
    globalThis.document = prev;
  }
});
