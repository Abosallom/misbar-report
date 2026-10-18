// test/tracker-ui.test.mjs — run with:  node --test
// The «متابعة المشروع» UI layer (tracker CONTRACT §1.3, §1.6, §1.7):
//   • the editor's pure model functions (ui/components.js): every one of the 19 task fields
//     editable, add / delete / move, suggestion lists (known vocabulary + the data's own
//     values, free text allowed), the due field's text + date rule ('daily' kept);
//   • persistence: the debounced saver (latest wins, flush, cancel) and the round trip
//     through the REAL store — an edit survives a reload and is what the next run resolves;
//   • the review screen: the session document is ONE object (state.parsed.tracker ===
//     model.projectTracker), an old untagged tracker is no tracker, never a mock, no
//     drafted task lists; the slide toggles (review chips + Settings checkboxes);
//   • the upload screen's synthetic mock is tagged and recognisable (never persisted).
// SYNTHETIC data only: made-up WBS ids, tasks and owners.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRACKER_EDIT_FIELDS, TRACKER_VOCAB, trackerStatusKey, trackerStatusLabel, trackerStatusCounts,
  trackerSuggestions, setTrackerField, addTrackerTask, removeTrackerTask, moveTrackerTask,
  normalizeTrackerDue, duePickerValue, dueDisplay, createTrackerSaver, saveTrackerToStore,
  createProjectTracker, trackerGroupLabel, trackerMetaLine, touchTracker, trackerPriorityKey,
} from '../src/ui/components.js';
import { modelFor, sessionProjectTracker, slideTogglesFor } from '../src/ui/screen-review.js';
import { buildMockTracker, isMockTracker } from '../src/ui/screen-upload.js';
import { slideFieldOn } from '../src/ui/screen-settings.js';
import { STR } from '../src/i18n/ar.js';
import { TASK_FIELDS, TRACKER_FORMAT } from '../src/ingest/task-tracker.js';
import { resolveProjectTracker } from '../src/model/report-model.js';
import * as store from '../src/store.js';
import { compute } from '../src/engine/engine.js';
import { takeOrders } from '../src/model/hospital.js';
import { baseStatus, effectiveStatus, trackerSummary, STATUS_AR, STATUS_KEYS } from '../src/model/tracker-status.js';

const NOW = '2026-10-13T09:00:00.000Z';
const LATER = '2026-10-13T10:30:00.000Z';

/** A synthetic tagged ProjectTracker (the parser's output shape). */
function tracker(over = {}) {
  const t = (wbs, track, milestone, task, status, due, extra = {}) => {
    const o = {};
    for (const f of TASK_FIELDS) o[f] = '';
    return {
      ...o, id: wbs, wbs, track, milestone, task, status, due,
      workstream: 'Stream One', workPackage: `Package ${wbs}`, taskType: 'Deliverable',
      organization: 'NUPCO / LEAN', owner: 'Person A', priority: 'High', ...extra,
    };
  };
  return {
    format: TRACKER_FORMAT,
    fileName: 'synthetic-tracker.xlsx',
    loadedAt: NOW,
    editedAt: null,
    warnings: [],
    tasks: [
      t('9.1.1', 'Track One', 'Stage A', 'Synthetic task one', 'In Progress', '2026-09-01'),
      t('9.1.2', 'Track One', 'Stage A', 'Synthetic task two', 'Deleyed', '2026-09-17', { owner: 'Person B', predecessor: '9.1.1' }),
      t('9.2.1', 'Track One', 'Stage B', 'Synthetic task three', 'Completed', 'daily', { organization: 'LEAN', priority: 'Critical' }),
      t('9.3.1', 'Track Two', 'Stage C', 'Synthetic task four', 'Not Found', '', { owner: 'person b' }),
      t('9.3.2', 'Track Two', 'Stage C', 'Synthetic task five', 'Waiting on vendor', '2026-10-30', { taskType: 'Custom Type' }),
    ],
    ...over,
  };
}

/* ------------------------------------------------------------------ *
 * Fields + labels
 * ------------------------------------------------------------------ */

test('editor fields: exactly the 19 task fields (every column + the 3 Arabic translations; never the id), each with an Arabic label', () => {
  const keys = TRACKER_EDIT_FIELDS.map((f) => f.key);
  assert.equal(keys.length, 19);
  assert.deepEqual([...keys].sort(), TASK_FIELDS.filter((f) => f !== 'id').sort());
  for (const k of keys) assert.ok(STR.tracker.fields[k], `label for ${k}`);
  // The controlled fields are text inputs WITH suggestion lists (free text allowed).
  const suggest = TRACKER_EDIT_FIELDS.filter((f) => f.suggest).map((f) => f.key).sort();
  assert.deepEqual(suggest, ['milestone', 'milestoneAr', 'organization', 'owner', 'predecessor', 'priority', 'status', 'taskType', 'track', 'trackAr', 'workPackage', 'workstream']);
  assert.equal(TRACKER_EDIT_FIELDS.filter((f) => f.due).map((f) => f.key).join(), 'due');
});

// UPDATED 2026-10-18 (review): the app reads statuses through model/tracker-status.js, the
// module the deck's task slides use — one alias table AND one overdue rule — so the upload
// card and the editor pill can never disagree with the deck (On Hold was a separate
// «معلّق» here while the deck printed «متوقف»; an overdue task kept its raw status).
test('status keys: the status module\'s reading — «Deleyed» late, On Hold stopped, blank «لم يبدأ», other verbatim', () => {
  assert.equal(trackerStatusKey('Completed'), 'completed');
  assert.equal(trackerStatusKey(' in  progress '), 'inProgress');
  assert.equal(trackerStatusKey('Deleyed'), 'late');
  assert.equal(trackerStatusKey('Delayed'), 'late');
  assert.equal(trackerStatusKey('BLOCKED'), 'stopped');
  assert.equal(trackerStatusKey('On Hold'), 'stopped');
  assert.equal(trackerStatusKey('Not Started'), 'notStarted');
  assert.equal(trackerStatusKey('Not Found'), 'notStarted');
  assert.equal(trackerStatusKey(''), 'notStarted');
  assert.equal(trackerStatusKey(undefined), 'notStarted');
  assert.equal(trackerStatusKey('Waiting on vendor'), 'other');
  assert.equal(trackerStatusLabel('Deleyed'), 'متأخر');
  assert.equal(trackerStatusLabel('On Hold'), 'متوقف');
  assert.equal(trackerStatusLabel('Completed'), 'مكتمل');
  assert.equal(trackerStatusLabel('Waiting on vendor'), 'Waiting on vendor');
  assert.equal(trackerPriorityKey('Critical'), 'critical');
  assert.equal(trackerPriorityKey('urgent'), null);
});

test('ONE status rule: the editor / upload card read every status exactly as tracker-status.js (the deck) does', () => {
  const words = [
    'Completed', 'complete', 'Done', 'Closed', 'In Progress', 'in_progress', 'InProgress', 'Ongoing',
    'Delayed', 'Deleyed', 'Late', 'Overdue', 'Blocked', 'On Hold', 'on-hold', 'Not Started', 'Not Found',
    '', '  ', null, undefined, 'Waiting on vendor',
    'مكتمل', 'مكتملة', 'قيد التنفيذ', 'متأخر', 'متأخرة', 'متوقف', 'متوقفة', 'معلّق', 'معلق', 'لم يبدأ', 'لم تبدأ', 'غير محدد',
  ];
  for (const w of words) {
    assert.equal(trackerStatusKey(w), baseStatus(w), `status ${JSON.stringify(w)}`);
    if (baseStatus(w) !== 'other') assert.equal(trackerStatusLabel(w), STATUS_AR[baseStatus(w)], `label ${JSON.stringify(w)}`);
  }
  // The labels are exactly the deck's five words — no «معلّق», no «غير محدد».
  for (const w of words) assert.ok(!['معلّق', 'غير محدد'].includes(trackerStatusLabel(w)), `label ${JSON.stringify(w)}`);
  // 'Closed' is a completion word for the status module: never turned Late when overdue.
  assert.equal(trackerStatusLabel('Closed'), 'مكتمل');
  assert.equal(effectiveStatus({ status: 'Closed', due: '2026-01-01' }, '2026-10-13').key, 'completed');
  const c = trackerStatusCounts({ tasks: [{ status: 'مكتمل' }, { status: 'Completed' }, { status: 'Closed' }] }, '2026-10-13');
  assert.deepEqual(c.map((x) => [x.label, x.count]), [['مكتمل', 3]]);
  assert.equal(trackerPriorityKey('حرجة'), 'critical');
  assert.equal(trackerPriorityKey('منخفضة'), 'low');
});

test('status counts = the deck\'s summary boxes on the report date: overdue → «متأخر», Stopped stays, «متجاوزة الموعد»', () => {
  // Report date 2026-10-13: 9.1.1 In Progress due 09-01 → Late; 9.1.2 Deleyed → Late;
  // 9.2.1 Completed; 9.3.1 Not Found (undated) → Not Started; 9.3.2 other, not yet due.
  const c = trackerStatusCounts(tracker(), '2026-10-13');
  assert.deepEqual(c.map((x) => [x.key, x.label, x.count]), [
    ['late', 'متأخر', 2], ['completed', 'مكتمل', 1], ['notStarted', 'لم يبدأ', 1],
    ['other:Waiting on vendor', 'Waiting on vendor', 1], ['pastDue', 'متجاوزة الموعد', 2],
  ].sort((a, b) => order(a[0]) - order(b[0])));
  // …the same numbers as tracker-status.js trackerSummary (what the deck's boxes print).
  const s = trackerSummary(tracker().tasks, '2026-10-13');
  const byKey = Object.fromEntries(c.map((x) => [x.key, x.count]));
  for (const k of ['late', 'stopped', 'inProgress', 'notStarted', 'completed', 'pastDue']) {
    assert.equal(byKey[k] || 0, s[k], k);
  }
  // An overdue On Hold / Blocked task stays «متوقف» but is past due; one box, not two.
  const stopped = trackerStatusCounts({ tasks: [
    { status: 'On Hold', due: '2026-09-01' }, { status: 'Blocked', due: '2026-12-01' }, { status: '', due: '2026-09-01' },
  ] }, '2026-10-13');
  assert.deepEqual(stopped.map((x) => [x.key, x.count]), [['late', 1], ['stopped', 2], ['pastDue', 2]]);
  // Without a report date nothing is overdue: the file's own statuses.
  assert.deepEqual(trackerStatusCounts({ tasks: [{ status: '' }, { status: 'Not Started' }, { status: 'Not Found' }] }).map((x) => [x.key, x.count]),
    [['notStarted', 3]], 'one «لم يبدأ» line, never two');
  assert.deepEqual(trackerStatusCounts(null), []);
  assert.deepEqual(trackerStatusCounts({ tasks: [] }), []);
});
const order = (k) => (k === 'pastDue' ? 99 : k.startsWith('other:') ? 50 : STATUS_KEYS.indexOf(k));

/* ------------------------------------------------------------------ *
 * Suggestions
 * ------------------------------------------------------------------ */

test('suggestions: the known vocabulary first, then every value in the data; free values kept, no near-duplicates', () => {
  const t = tracker();
  const status = trackerSuggestions(t, 'status');
  assert.deepEqual(status.slice(0, TRACKER_VOCAB.status.length), [...TRACKER_VOCAB.status]);
  // The data's own words join the list (the misspelling and the free word included)…
  assert.ok(status.includes('Deleyed') && status.includes('Waiting on vendor') && status.includes('Not Found'));
  // …but a data value equal to a vocabulary word up to case/spacing is not repeated.
  assert.equal(status.filter((v) => v.toLowerCase().replace(/\s/g, '') === 'inprogress').length, 1);
  assert.deepEqual(trackerSuggestions(t, 'priority'), ['Critical', 'High', 'Medium', 'Low']);
  assert.ok(trackerSuggestions(t, 'taskType').includes('Custom Type'));
  // Owners / tracks come from the data ONLY (people's names are the file's content).
  assert.deepEqual(trackerSuggestions(t, 'owner'), ['Person A', 'Person B']);
  assert.deepEqual(trackerSuggestions(t, 'track'), ['Track One', 'Track Two']);
  assert.deepEqual(trackerSuggestions(t, 'milestone'), ['Stage A', 'Stage B', 'Stage C']);
  // Predecessor: the tasks' own WBS ids.
  assert.deepEqual(trackerSuggestions(t, 'predecessor'), ['9.1.1', '9.1.2', '9.2.1', '9.3.1', '9.3.2']);
  assert.deepEqual(trackerSuggestions(null, 'owner'), []);
});

/* ------------------------------------------------------------------ *
 * Mutations — every column, add / delete / move
 * ------------------------------------------------------------------ */

test('setTrackerField: every one of the 19 fields is editable, verbatim, and stamps editedAt', () => {
  const t = tracker();
  for (const f of TRACKER_EDIT_FIELDS) {
    const v = `edited ${f.key}`;
    assert.equal(setTrackerField(t, '9.1.2', f.key, v, NOW), true, f.key);
    assert.equal(t.tasks[1][f.key], v);
  }
  assert.equal(t.editedAt, NOW);
  // The id is the row's identity, not a column; unknown task / field and no-op edits refuse.
  assert.equal(setTrackerField(t, '9.1.2', 'id', 'x', LATER), false);
  assert.equal(setTrackerField(t, 'nope', 'task', 'x', LATER), false);
  assert.equal(setTrackerField(t, '9.1.2', 'colour', 'x', LATER), false);
  assert.equal(setTrackerField(t, '9.1.2', 'task', 'edited task', LATER), false, 'unchanged');
  assert.equal(t.editedAt, NOW, 'a refused edit does not stamp');
  // Stored as strings, never translated: a status stays the file's word.
  setTrackerField(t, '9.1.1', 'status', 'Deleyed', LATER);
  assert.equal(t.tasks[0].status, 'Deleyed');
  setTrackerField(t, '9.1.1', 'notes', null, LATER);
  assert.equal(t.tasks[0].notes, '');
});

test('addTrackerTask: unique ids, Not Started; «after» joins that task\'s group at that position', () => {
  const t = tracker();
  const a = addTrackerTask(t, { now: NOW });
  assert.equal(t.tasks.at(-1), a);
  assert.equal(a.status, 'Not Started');
  assert.equal(a.track, '');
  for (const f of TASK_FIELDS) assert.equal(typeof a[f], 'string', f);
  const b = addTrackerTask(t, { afterId: '9.1.1', now: LATER });
  assert.equal(t.tasks[1], b);
  assert.deepEqual([b.track, b.milestone, b.workstream, b.workPackage], ['Track One', 'Stage A', 'Stream One', 'Package 9.1.1']);
  assert.equal(b.task, '');
  const ids = t.tasks.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'ids unique');
  assert.notEqual(a.id, b.id);
  assert.equal(t.editedAt, LATER);
  assert.equal(addTrackerTask(null), null);
});

test('removeTrackerTask / moveTrackerTask: by id, order = slide order, ends refuse', () => {
  const t = tracker();
  assert.equal(moveTrackerTask(t, '9.1.1', -1, NOW), false, 'first row cannot go up');
  assert.equal(moveTrackerTask(t, '9.3.2', +1, NOW), false, 'last row cannot go down');
  assert.equal(t.editedAt, null);
  assert.equal(moveTrackerTask(t, '9.2.1', -1, NOW), true);
  assert.deepEqual(t.tasks.map((x) => x.id), ['9.1.1', '9.2.1', '9.1.2', '9.3.1', '9.3.2']);
  assert.equal(moveTrackerTask(t, '9.1.1', +1, NOW), true);
  assert.deepEqual(t.tasks.map((x) => x.id), ['9.2.1', '9.1.1', '9.1.2', '9.3.1', '9.3.2']);
  assert.equal(removeTrackerTask(t, '9.3.1', LATER), true);
  assert.equal(removeTrackerTask(t, '9.3.1', LATER), false);
  assert.deepEqual(t.tasks.map((x) => x.id), ['9.2.1', '9.1.1', '9.1.2', '9.3.2']);
  assert.equal(t.editedAt, LATER);
});

test('createProjectTracker: a tagged, empty, edited document (a report with no file)', () => {
  const t = createProjectTracker(NOW);
  assert.deepEqual(t, { format: TRACKER_FORMAT, fileName: null, loadedAt: NOW, editedAt: NOW, warnings: [], tasks: [] });
  assert.equal(resolveProjectTracker(t, null), t);
  addTrackerTask(t, { now: NOW });
  assert.equal(t.tasks.length, 1);
});

/* ------------------------------------------------------------------ *
 * Due date: text + picker, 'daily' kept
 * ------------------------------------------------------------------ */

test('due: typed day-first dates become ISO (the parser\'s rule); «daily» and free text stay as typed', () => {
  assert.equal(normalizeTrackerDue('17/9/2026'), '2026-09-17');
  assert.equal(normalizeTrackerDue(' 2026-9-3 '), '2026-09-03');
  assert.equal(normalizeTrackerDue('daily'), 'daily');
  assert.equal(normalizeTrackerDue('end of Q4'), 'end of Q4');
  assert.equal(normalizeTrackerDue('31/2/2026'), '31/2/2026', 'not a real date → kept as typed');
  assert.equal(normalizeTrackerDue(''), '');
  // The picker shows only a real ISO date; the text field keeps everything else.
  assert.equal(duePickerValue('2026-09-17'), '2026-09-17');
  assert.equal(duePickerValue('daily'), '');
  assert.equal(duePickerValue(''), '');
  // As the deck prints it.
  assert.equal(dueDisplay('2026-09-17'), '17/09/2026');
  assert.equal(dueDisplay('daily'), 'daily');
  assert.equal(dueDisplay(''), '');
});

test('group heading + meta line', () => {
  assert.equal(trackerGroupLabel({ track: 'Track One', milestone: 'Stage A' }), 'Track One › Stage A');
  assert.equal(trackerGroupLabel({}), `${STR.tracker.noTrack} › ${STR.tracker.noMilestone}`);
  const t = tracker();
  const line = trackerMetaLine(t);
  assert.ok(line.startsWith('synthetic-tracker.xlsx · 5 مهمة'), line);
  assert.ok(line.includes(STR.tracker.notEdited));
  touchTracker(t, LATER);
  assert.ok(!trackerMetaLine(t).includes(STR.tracker.notEdited));
  assert.equal(trackerMetaLine({ tasks: [] }), '', 'untagged → nothing');
  assert.ok(trackerMetaLine(createProjectTracker(NOW)).startsWith(STR.tracker.manualName));
});

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/** Manual timers: run() fires the pending callback. */
function fakeTimers() {
  let seq = 0;
  const pending = new Map();
  return {
    setTimer: (fn) => { seq += 1; pending.set(seq, fn); return seq; },
    clearTimer: (id) => { pending.delete(id); },
    run: () => { const fns = [...pending.values()]; pending.clear(); fns.forEach((f) => f()); },
    get size() { return pending.size; },
  };
}

test('saver: debounced, ONE pending save, the latest document wins; flush now; cancel drops it', () => {
  const clock = fakeTimers();
  const saver = createTrackerSaver({ setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const saved = [];
  const save = (doc) => saved.push(doc);
  saver.schedule(save, { v: 1 });
  saver.schedule(save, { v: 2 });
  assert.equal(clock.size, 1, 'a reschedule replaces the timer');
  assert.equal(saver.pending, true);
  clock.run();
  assert.deepEqual(saved, [{ v: 2 }]);
  assert.equal(saver.pending, false);
  // flush: written immediately, the timer gone; a second flush writes nothing.
  saver.schedule(save, { v: 3 });
  assert.equal(saver.flush(), true);
  assert.equal(saver.flush(), false);
  assert.equal(clock.size, 0);
  assert.deepEqual(saved.at(-1), { v: 3 });
  // cancel: a new upload REPLACES the document — the old save must never land.
  saver.schedule(save, { v: 4 });
  saver.cancel();
  clock.run();
  assert.equal(saver.flush(), false);
  assert.equal(saved.length, 2);
  // A failing save reports through onError and does not throw out of the timer.
  const errors = [];
  saver.schedule(() => { throw new Error('quota'); }, { v: 5 }, (e) => errors.push(e.message));
  clock.run();
  assert.deepEqual(errors, ['quota']);
});

function freshStore() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
  store.__resetForTests();
  return store;
}

test('persistence: an edit saved through the REAL store survives a reload and is what the next run resolves', () => {
  const st = freshStore();
  const t = tracker();
  saveTrackerToStore(st, t); // the upload's cache write
  setTrackerField(t, '9.1.2', 'status', 'Completed', LATER);
  setTrackerField(t, '9.1.2', 'due', normalizeTrackerDue('3/10/2026'), LATER);
  addTrackerTask(t, { afterId: '9.3.2', now: LATER }).task = 'Added on the website';
  saveTrackerToStore(st, t); // the debounced editor save

  store.__resetForTests(); // a page reload: memory gone, localStorage kept
  const doc = resolveProjectTracker(null, store.loadSettings());
  assert.ok(doc, 'the cached document is a tagged tracker');
  assert.equal(doc.editedAt, LATER);
  assert.equal(doc.tasks.length, 6);
  const row = doc.tasks.find((x) => x.id === '9.1.2');
  assert.equal(row.status, 'Completed');
  assert.equal(row.due, '2026-10-03');
  assert.equal(doc.tasks.at(-1).task, 'Added on the website');
  // A fresh session (no parsed tracker) adopts it as THE document.
  const state = { parsed: { tracker: null }, files: { tracker: null } };
  // (the screens get main.js's adapter: `settings` = a fresh loadSettings() copy)
  const adapter = { get settings() { return st.loadSettings(); } };
  const s = sessionProjectTracker(state, adapter);
  assert.equal(s.tasks.length, 6);
  assert.equal(state.parsed.tracker, s, 'adopted into state (same object)');
  assert.equal(state.files.tracker.name, 'synthetic-tracker.xlsx');
  // Cleared (Settings «مسح») → no tracker at all.
  st.updateCachedTracker(null);
  assert.equal(sessionProjectTracker({ parsed: { tracker: null }, files: {} }, adapter), null);
});

test('sessionProjectTracker: the parsed tagged document as-is; an OLD untagged one is no tracker; never a mock', () => {
  const t = tracker();
  const state = { parsed: { tracker: t }, files: {} };
  assert.equal(sessionProjectTracker(state, { settings: {} }), t, 'the very object');
  const old = { tasks: [{ num: 1, task: 'old row', category: 'لين' }], challenges: [], risks: [] };
  const s2 = { parsed: { tracker: old }, files: {} };
  assert.equal(sessionProjectTracker(s2, { settings: { cachedTracker: null } }), null);
  assert.equal(s2.parsed.tracker, null, 'the old shape is dropped from state');
  // An old-shape CACHE is no tracker either (an install from before the new file).
  const s3 = { parsed: { tracker: null }, files: {} };
  assert.equal(sessionProjectTracker(s3, { settings: { cachedTracker: { model: old, updatedAt: NOW } } }), null);
});

/* ------------------------------------------------------------------ *
 * Review screen: the model carries the document, nothing drafted
 * ------------------------------------------------------------------ */

const KAMC = { orderingFacilityId: '31763', hospital: 'King Abdul ah Medical City' };
let seq = 0;
const row = (testName, od, over = {}) => {
  seq += 1;
  return {
    orderDate: `${od} 00:00:00`, facility: 'Lab Alpha', orderId: `7${String(seq).padStart(5, '0')}`, lineNo: seq,
    loinc: null, testName, collected: `${od} 00:00:00`, dispatched: null, received: null, resulted: null,
    rawStatus: 'Specimen Collected', tatDaysCsv: null, specimenNo: null, shipmentId: null,
    performingFacilityId: null, ...KAMC, ...over,
  };
};
const SETTINGS = { tatLookup: { 'Assay K': 2 }, historicalConstants: { cancelledByMonth: {} }, reportOptions: { deltaMode: 'week' } };

function reviewState(tracker, reportHospital) {
  const parsed = { orders: null, tracker, summary: null, excludedHospitals: [] };
  takeOrders(parsed, [row('Assay K', '2026-10-01'), row('Assay K', '2026-10-05')]);
  return { parsed, files: { tracker: null }, reportDate: '2026-10-08', reportModel: null, engineOutput: null, edits: {}, reportHospital };
}

for (const hospital of ['kamc', 'both']) {
  test(`review model (${hospital}): projectTracker IS the session document; no drafted task lists; manual lists empty`, () => {
    const t = tracker();
    const state = reviewState(t, hospital);
    const m = modelFor(state, { settings: SETTINGS }, compute, { notify: () => {} });
    assert.equal(m.projectTracker, t, 'the same object the editor edits');
    assert.equal(state.parsed.tracker, t);
    for (const k of ['tasksCurrent', 'tasksInternal']) assert.equal(k in m, false, `${k} is retired`);
    assert.deepEqual(m.challenges, []);
    assert.deepEqual(m.risks, []);
    assert.deepEqual(m.panels.supportRequired, []);
    // An edit to the document is on the model at once (the live preview reads it).
    setTrackerField(t, '9.1.1', 'task', 'Renamed', NOW);
    assert.equal(m.projectTracker.tasks[0].task, 'Renamed');
  });
}

test('review model: an OLD-shape tracker in state → projectTracker null (no slides), never the mock', () => {
  const old = { tasks: [{ num: 1, task: 'old row', status: 'مفتوح', category: 'لين' }], challenges: [], risks: [] };
  const state = reviewState(old, 'kamc');
  const m = modelFor(state, { settings: SETTINGS }, compute, { notify: () => {} });
  assert.equal(m.projectTracker, null);
  const none = modelFor(reviewState(null, 'kamc'), { settings: SETTINGS }, compute, { notify: () => {} });
  assert.equal(none.projectTracker, null);
});

/* ------------------------------------------------------------------ *
 * Slide toggles
 * ------------------------------------------------------------------ */

// UPDATED 2026-10-18: the chip carries the slides' new name «متابعة المهام» (user rule 6), and
// the weekly «المهام المكتملة خلال الأسبوع» chip sits beside it in every report type.
test('slide toggles: «متابعة المهام» offered in all three report types; the old «المهام» chip retired', () => {
  for (const h of ['kamc', 'sgh', 'both']) {
    const chips = slideTogglesFor(h);
    const tr = chips.find((c) => c.key === 'tracker');
    assert.ok(tr, h);
    assert.equal(tr.label, 'متابعة المهام');
    const done = chips.find((c) => c.key === 'trackerCompleted');
    assert.ok(done, `${h}: the completed-this-week chip`);
    assert.equal(done.label, 'المهام المكتملة خلال الأسبوع');
    assert.equal(done.weeklyOnly, true);
    assert.equal(chips.indexOf(done), chips.indexOf(tr) + 1, 'right after the task slides');
    assert.ok(!chips.some((c) => c.key === 'action'), h);
  }
  // Challenges stays a single-hospital chip (the main deck has no such slide).
  assert.ok(slideTogglesFor('kamc').some((c) => c.key === 'challenges'));
  assert.ok(!slideTogglesFor('both').some((c) => c.key === 'challenges'));
});

test('Settings slide checkboxes: an absent key reads as the deck reads it (ON; OFF only for an opt-in slide)', () => {
  const tracker = { key: 'tracker' };
  const definitions = { key: 'definitions', optIn: true };
  assert.equal(slideFieldOn({}, tracker), true, 'absent tracker key ⇒ ON');
  assert.equal(slideFieldOn(undefined, tracker), true);
  assert.equal(slideFieldOn({ tracker: false }, tracker), false, 'a stored false wins');
  assert.equal(slideFieldOn({ tracker: true }, tracker), true);
  assert.equal(slideFieldOn({}, definitions), false, 'opt-in slide stays off');
  assert.equal(slideFieldOn({ definitions: true }, definitions), true);
});

/* ------------------------------------------------------------------ *
 * Upload screen mock
 * ------------------------------------------------------------------ */

test('buildMockTracker: a tagged SYNTHETIC document, recognisable (never persisted) — a copy is not', () => {
  const m = buildMockTracker();
  assert.ok(resolveProjectTracker(m, null), 'tagged ProjectTracker');
  assert.equal(isMockTracker(m), true);
  assert.equal(isMockTracker(JSON.parse(JSON.stringify(m))), false);
  assert.equal(isMockTracker(tracker()), false);
  assert.notEqual(buildMockTracker(), m, 'a fresh document per call');
  for (const t of m.tasks) {
    for (const f of TASK_FIELDS) assert.equal(typeof t[f], 'string', f);
    assert.match(t.owner, /^Owner [A-Z]$/, 'made-up owners only');
    assert.match(t.task, /\(mock\)$/);
  }
  const ids = m.tasks.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  // Every display branch: a delay in the file's spelling, a 'daily' due, a blank status.
  assert.ok(m.tasks.some((t) => t.status === 'Deleyed'));
  assert.ok(m.tasks.some((t) => t.due === 'daily'));
  assert.ok(m.tasks.some((t) => t.status === ''));
});
