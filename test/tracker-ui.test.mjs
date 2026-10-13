// test/tracker-ui.test.mjs — run with:  node --test
// The «متابعة المشروع» UI layer (tracker CONTRACT §1.3, §1.6, §1.7):
//   • the editor's pure model functions (ui/components.js): every one of the 16 task fields
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
import { statusKey as slideStatusKey, isOverdue } from '../src/slidespec/build-tracker.js';

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

test('editor fields: exactly the 16 task fields (every column; never the id), each with an Arabic label', () => {
  const keys = TRACKER_EDIT_FIELDS.map((f) => f.key);
  assert.equal(keys.length, 16);
  assert.deepEqual([...keys].sort(), TASK_FIELDS.filter((f) => f !== 'id').sort());
  for (const k of keys) assert.ok(STR.tracker.fields[k], `label for ${k}`);
  // The controlled fields are text inputs WITH suggestion lists (free text allowed).
  const suggest = TRACKER_EDIT_FIELDS.filter((f) => f.suggest).map((f) => f.key).sort();
  assert.deepEqual(suggest, ['milestone', 'organization', 'owner', 'predecessor', 'priority', 'status', 'taskType', 'track', 'workPackage', 'workstream']);
  assert.equal(TRACKER_EDIT_FIELDS.filter((f) => f.due).map((f) => f.key).join(), 'due');
});

test('status keys: the file\'s «Deleyed» is a delay, «Not Found» / blank unknown, any other word verbatim', () => {
  assert.equal(trackerStatusKey('Completed'), 'completed');
  assert.equal(trackerStatusKey(' in  progress '), 'inProgress');
  assert.equal(trackerStatusKey('Deleyed'), 'delayed');
  assert.equal(trackerStatusKey('Delayed'), 'delayed');
  assert.equal(trackerStatusKey('BLOCKED'), 'blocked');
  assert.equal(trackerStatusKey('On Hold'), 'onHold');
  assert.equal(trackerStatusKey('Not Started'), 'notStarted');
  assert.equal(trackerStatusKey('Not Found'), 'unknown');
  assert.equal(trackerStatusKey(''), 'unknown');
  assert.equal(trackerStatusKey(undefined), 'unknown');
  assert.equal(trackerStatusKey('Waiting on vendor'), 'other');
  assert.equal(trackerStatusLabel('Deleyed'), 'متأخر');
  assert.equal(trackerStatusLabel('Completed'), 'مكتمل');
  assert.equal(trackerStatusLabel('Waiting on vendor'), 'Waiting on vendor');
  assert.equal(trackerPriorityKey('Critical'), 'critical');
  assert.equal(trackerPriorityKey('urgent'), null);
});

test('ONE status rule: the editor pill / upload counts read every status exactly as the slide does', () => {
  // Every alias either side ever knew, the free words an operator may type, and the
  // file's own words (review R-1: 'Closed' was «مكتمل» in the editor but 'other' + overdue
  // on the slide; 'مكتمل' / 'متوقف' were grey in the editor but mapped on the slide).
  const words = [
    'Completed', 'complete', 'Done', 'Closed', 'In Progress', 'in_progress', 'InProgress', 'Ongoing',
    'Delayed', 'Deleyed', 'Late', 'Overdue', 'Blocked', 'On Hold', 'on-hold', 'Not Started', 'Not Found',
    '', '  ', null, undefined, 'Waiting on vendor',
    'مكتمل', 'مكتملة', 'قيد التنفيذ', 'متأخر', 'متأخرة', 'متوقف', 'متوقفة', 'معلّق', 'معلق', 'لم يبدأ', 'لم تبدأ',
  ];
  for (const w of words) {
    const slide = slideStatusKey(w);
    assert.equal(trackerStatusKey(w), slide === 'unset' ? 'unknown' : slide, `status ${JSON.stringify(w)}`);
  }
  // …so the overdue test and the pill agree: a word the slide does not call completed is
  // never shown as «مكتمل» in the editor.
  assert.equal(trackerStatusLabel('مكتمل'), 'مكتمل');
  assert.equal(trackerStatusLabel('متوقف'), STR.tracker.status.blocked);
  assert.equal(trackerStatusLabel('Closed'), 'Closed');
  assert.equal(isOverdue({ status: 'Closed', due: '2026-01-01' }, '2026-10-13'), true);
  const c = trackerStatusCounts({ tasks: [{ status: 'مكتمل' }, { status: 'Completed' }, { status: 'Closed' }] });
  assert.deepEqual(c.map((x) => [x.label, x.count]), [['مكتمل', 2], ['Closed', 1]]);
  // Priority: the slide's Arabic words are known too.
  assert.equal(trackerPriorityKey('حرجة'), 'critical');
  assert.equal(trackerPriorityKey('منخفضة'), 'low');
});

test('status counts: the slide\'s order and labels, unknown words verbatim, «غير محدد» last, zeros omitted', () => {
  const c = trackerStatusCounts(tracker());
  assert.deepEqual(c.map((x) => [x.label, x.count]), [
    ['مكتمل', 1], ['قيد التنفيذ', 1], ['متأخر', 1], ['Waiting on vendor', 1], ['غير محدد', 1],
  ]);
  assert.deepEqual(trackerStatusCounts(null), []);
  assert.deepEqual(trackerStatusCounts({ tasks: [] }), []);
});

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

test('setTrackerField: every one of the 16 fields is editable, verbatim, and stamps editedAt', () => {
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

test('slide toggles: «متابعة المشروع» offered in all three report types; the old «المهام» chip retired', () => {
  for (const h of ['kamc', 'sgh', 'both']) {
    const chips = slideTogglesFor(h);
    const tr = chips.find((c) => c.key === 'tracker');
    assert.ok(tr, h);
    assert.equal(tr.label, 'متابعة المشروع');
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
