// test/tracker-auto-ui.test.mjs — run with:  node --test
// AUTOMATIC ARABIC for the project tracker, UI layer (CONTRACT-AUTO §4–§6):
//   • the translation layers applied to the SESSION document in place (identity kept, no
//     edit stamp, nothing added when nothing translates) — upload, review, generate;
//   • the editor's writes to the user translation memory: an Arabic edit (keyed by the
//     ENGLISH text, surviving a re-upload), a cleared edit falling back to the built-in
//     text, a changed English text carrying the user's Arabic, «النص الأصلي»;
//   • the built-in memory loaded ONCE per session with the data key;
//   • the on-device Translator API — mocked via globalThis.Translator: feature detection,
//     availability, the click-only download, the cache (+ glossary) and source 'machine';
//     nothing is ever fetched.
// SYNTHETIC data only: made-up tasks and made-up Arabic — never the user's file.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  translateTrackerInPlace, translatedTracker, translationsDiffer, userTrackerTM,
  recordUserTranslation, carryUserTranslation, recordOriginalChoice,
  writePendingTrackerTranslations, pendingTrackerTranslations, __resetPendingTrackerTranslations,
  saveMachineTranslations, saveTrackerToStore, loadBuiltinTrackerTM,
  translatorApi, translatorAvailability, machineTranslateTexts, trackerUntranslatedTexts,
  trackerTranslationStatus, trackerTaskText, setTrackerField, TRACKER_TRANSLATION_FIELDS,
  detachTrackerFromTM, isTrackerTMDetached, trackerMetaLine,
} from '../src/ui/components.js';
import { buildMockTracker, isMockTracker } from '../src/ui/screen-upload.js';
import { sessionProjectTracker } from '../src/ui/screen-review.js';
import { fallbackModel } from '../src/ui/screen-generate.js';
import { STR } from '../src/i18n/ar.js';
import { TASK_FIELDS, TRACKER_FORMAT } from '../src/ingest/task-tracker.js';
import { normEn } from '../src/model/tracker-translate.js';
import * as store from '../src/store.js';

const NOW = '2026-10-13T09:00:00.000Z';

/** A synthetic tagged ProjectTracker in ENGLISH only (the user's normal workbook shape). */
function englishTracker() {
  const t = (wbs, track, milestone, task) => {
    const o = {};
    for (const f of TASK_FIELDS) o[f] = '';
    return { ...o, id: wbs, wbs, track, milestone, task, status: 'In Progress', owner: 'Person A' };
  };
  return {
    format: TRACKER_FORMAT,
    fileName: 'synthetic-tracker.xlsx',
    loadedAt: NOW,
    editedAt: null,
    warnings: [],
    tasks: [
      t('7.1.1', 'Track Alpha', 'Stage One', 'Prepare the synthetic plan'),
      t('7.1.2', 'Track Alpha', 'Stage One', 'Review  the synthetic   plan '),
      t('7.2.1', 'Track Beta', 'Stage Two', 'A brand new synthetic task'),
    ],
  };
}

/** The decrypted built-in memory's shape ({generatedAt, entries}) — made-up Arabic. */
const BUILTIN = Object.freeze({
  generatedAt: NOW,
  entries: {
    tasks: { [normEn('Prepare the synthetic plan')]: 'إعداد الخطة التجريبية', [normEn('Review the synthetic plan')]: 'مراجعة الخطة التجريبية' },
    tracks: { [normEn('Track Alpha')]: 'المسار ألف' },
    milestones: { [normEn('Stage One')]: 'المرحلة الأولى' },
  },
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
// main.js's adapter shape: `settings` = a fresh loadSettings() copy, load/save pass-through,
// NO updateTrackerTranslations (the UI's own size-guarded load/save path is exercised).
const adapterOf = (st) => ({
  get settings() { return st.loadSettings(); },
  loadSettings: () => st.loadSettings(),
  saveSettings: (d) => st.saveSettings(d),
  updateCachedTracker: (m) => st.updateCachedTracker(m),
});

const savedTranslator = globalThis.Translator;
const savedFetch = globalThis.fetch;
beforeEach(() => { __resetPendingTrackerTranslations(); });
afterEach(() => {
  __resetPendingTrackerTranslations();
  if (savedTranslator === undefined) delete globalThis.Translator; else globalThis.Translator = savedTranslator;
  globalThis.fetch = savedFetch;
});

/* ------------------------------------------------------------------ *
 * Applying the layers (upload / review / generate)
 * ------------------------------------------------------------------ */

test('in place: the English workbook gets the built-in Arabic, same object, no edit stamp, English untouched', () => {
  const t = englishTracker();
  const tasks = [...t.tasks];
  const n = translateTrackerInPlace(t, {}, BUILTIN);
  assert.equal(n, 2, 'the two covered tasks changed; the third (Track Beta) has nothing to add');
  assert.deepEqual(t.tasks, tasks, 'the very task objects');
  assert.equal(t.tasks[0], tasks[0]);
  assert.equal(t.editedAt, null, 'a translation pass is not a website edit');
  assert.equal(t.tasks[0].taskAr, 'إعداد الخطة التجريبية');
  assert.equal(t.tasks[0].taskArSource, 'builtin');
  assert.equal(t.tasks[1].taskAr, 'مراجعة الخطة التجريبية', 'the workbook\'s doubled / trailing spaces still match');
  assert.equal(t.tasks[0].trackAr, 'المسار ألف');
  assert.equal(t.tasks[0].milestoneAr, 'المرحلة الأولى');
  assert.equal(t.tasks[2].taskAr, '', 'not covered → English on the slide');
  assert.equal(t.tasks[2].taskArSource || '', '', 'no source (and no key added when nothing changed)');
  assert.deepEqual(t.tasks.map((x) => x.task), ['Prepare the synthetic plan', 'Review  the synthetic   plan ', 'A brand new synthetic task']);
  assert.equal(translateTrackerInPlace(t, {}, BUILTIN), 0, 'idempotent');
  assert.deepEqual(trackerTranslationStatus(t, 'ar'), { translated: 2, total: 3, remaining: 1, machine: 0 });
});

test('nothing to translate → the document is left byte-for-byte as it was (no empty bookkeeping keys)', () => {
  const t = englishTracker();
  const before = JSON.stringify(t);
  assert.equal(translateTrackerInPlace(t, {}, null), 0);
  assert.equal(JSON.stringify(t), before);
  const copy = translatedTracker(t, {}, null);
  assert.equal(copy, t, 'the copy path returns the very document when nothing changes');
  assert.equal(translationsDiffer(t, translatedTracker(englishTracker(), {}, BUILTIN)), true);
  // Not a tagged tracker → untouched.
  const old = { tasks: [{ task: 'x' }] };
  assert.equal(translateTrackerInPlace(old, {}, BUILTIN), 0);
  assert.equal(translatedTracker(old, {}, BUILTIN), old);
  assert.equal(translateTrackerInPlace(null, {}, BUILTIN), 0);
});

test('an Arabic column the workbook carries still wins (silently supported)', () => {
  const t = englishTracker();
  t.tasks[0].taskAr = 'من عمود الملف';
  translateTrackerInPlace(t, {}, BUILTIN);
  assert.equal(t.tasks[0].taskAr, 'من عمود الملف');
  assert.equal(t.tasks[0].taskArSource, 'file');
});

test('built-in not loaded yet: earlier built-in fills are KEPT; it arrives → re-applied', () => {
  const t = englishTracker();
  translateTrackerInPlace(t, {}, BUILTIN);
  assert.equal(translateTrackerInPlace(t, {}, null), 0, 'an absent layer never wipes');
  assert.equal(t.tasks[0].taskAr, 'إعداد الخطة التجريبية');
  const fresh = englishTracker();
  translateTrackerInPlace(fresh, {}, undefined);
  assert.equal(fresh.tasks[0].taskAr || '', '');
  assert.ok(translateTrackerInPlace(fresh, {}, BUILTIN) > 0, 'the memory arrived');
  assert.equal(fresh.tasks[0].taskArSource, 'builtin');
});

test('review: sessionProjectTracker applies the layers to the session document IN PLACE (one object)', () => {
  const t = englishTracker();
  const state = { parsed: { tracker: t }, files: {}, trackerBuiltinTM: BUILTIN };
  assert.equal(sessionProjectTracker(state, { settings: {} }), t, 'the very object');
  assert.equal(t.tasks[0].taskAr, 'إعداد الخطة التجريبية');
  // The cached document (no parsed tracker) gets its Arabic too.
  const st = freshStore();
  st.updateCachedTracker(englishTracker());
  const s2 = { parsed: { tracker: null }, files: {}, trackerBuiltinTM: BUILTIN };
  const doc = sessionProjectTracker(s2, adapterOf(st));
  assert.equal(s2.parsed.tracker, doc);
  assert.equal(doc.tasks[1].taskAr, 'مراجعة الخطة التجريبية');
});

test('generate fallback: the tracker carries its Arabic (same object as the session\'s)', () => {
  const t = englishTracker();
  const state = { parsed: { tracker: t }, engineOutput: { totals: { total: 0 } }, reportDate: '2026-10-13', trackerBuiltinTM: BUILTIN };
  const m = fallbackModel(state, { settings: {} });
  assert.equal(m.projectTracker, t);
  assert.equal(t.tasks[0].taskAr, 'إعداد الخطة التجريبية');
});

/* ------------------------------------------------------------------ *
 * The user's corrections (the editor → settings.trackerTranslations)
 * ------------------------------------------------------------------ */

test('an Arabic edit is the user\'s correction: wins over the built-in, persisted with the tracker save, survives a re-upload', () => {
  const st = freshStore();
  const ad = adapterOf(st);
  const t = englishTracker();
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  // The editor's input handler: setTrackerField + recordUserTranslation.
  assert.equal(setTrackerField(t, '7.1.1', 'taskAr', 'إعداد الخطة (تصحيحي)', NOW), true);
  assert.equal(recordUserTranslation(t.tasks[0], 'taskAr', 'إعداد الخطة (تصحيحي)'), true);
  assert.equal(t.tasks[0].taskArSource, 'user');
  assert.equal(pendingTrackerTranslations(), 1);
  // Typing more coalesces into ONE queued edit.
  recordUserTranslation(t.tasks[0], 'taskAr', 'إعداد الخطة (تصحيحي) ');
  assert.equal(pendingTrackerTranslations(), 1);
  // A re-render INSIDE the save debounce must not bring the built-in text back.
  assert.equal(translateTrackerInPlace(t, ad.settings, BUILTIN), 0);
  assert.equal(t.tasks[0].taskAr, 'إعداد الخطة (تصحيحي)');
  assert.equal(userTrackerTM(ad.settings).tasks[normEn('Prepare the synthetic plan')], 'إعداد الخطة (تصحيحي)');
  // The tracker's debounced save writes the queued correction too.
  saveTrackerToStore(ad, t);
  assert.equal(pendingTrackerTranslations(), 0);
  store.__resetForTests(); // a page reload
  const tm = st.loadSettings().trackerTranslations;
  assert.equal(tm.tasks[normEn('Prepare the synthetic plan')], 'إعداد الخطة (تصحيحي)');
  // A RE-UPLOAD of the same English workbook (new objects, spacing / case differs) gets it.
  const again = englishTracker();
  again.tasks[0].task = '  prepare THE synthetic  plan';
  translateTrackerInPlace(again, ad.settings, BUILTIN);
  assert.equal(again.tasks[0].taskAr, 'إعداد الخطة (تصحيحي)');
  assert.equal(again.tasks[0].taskArSource, 'user');
  assert.equal(again.tasks[1].taskArSource, 'builtin', 'other tasks keep the built-in');
});

test('clearing the Arabic drops the user entry: the built-in text comes back on commit', () => {
  const st = freshStore();
  const ad = adapterOf(st);
  const t = englishTracker();
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  setTrackerField(t, '7.1.1', 'taskAr', 'نص المستخدم', NOW);
  recordUserTranslation(t.tasks[0], 'taskAr', 'نص المستخدم');
  writePendingTrackerTranslations(ad);
  setTrackerField(t, '7.1.1', 'taskAr', '', NOW);
  recordUserTranslation(t.tasks[0], 'taskAr', '');
  assert.equal(t.tasks[0].taskArSource, '');
  // The editor's commit ('change') re-applies:
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  assert.equal(t.tasks[0].taskAr, 'إعداد الخطة التجريبية');
  assert.equal(t.tasks[0].taskArSource, 'builtin');
  writePendingTrackerTranslations(ad);
  assert.equal(st.loadSettings().trackerTranslations.tasks[normEn('Prepare the synthetic plan')], undefined);
});

test('track / milestone corrections are keyed by the English group name — the whole group follows', () => {
  const ad = adapterOf(freshStore());
  const t = englishTracker();
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  setTrackerField(t, '7.1.2', 'trackAr', 'مسار ألف المصحح', NOW);
  recordUserTranslation(t.tasks[1], 'trackAr', 'مسار ألف المصحح');
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  assert.equal(t.tasks[0].trackAr, 'مسار ألف المصحح', 'the other task of the same English track');
  assert.equal(t.tasks[0].trackArSource, 'user');
  assert.equal(t.tasks[2].trackAr, '', 'another track is untouched');
});

test('a changed English text carries the USER\'s Arabic to its new key (not a built-in one)', () => {
  const ad = adapterOf(freshStore());
  const t = englishTracker();
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  setTrackerField(t, '7.1.1', 'taskAr', 'ترجمتي', NOW);
  recordUserTranslation(t.tasks[0], 'taskAr', 'ترجمتي');
  setTrackerField(t, '7.1.1', 'task', 'Prepare the synthetic plan v2', NOW);
  assert.equal(carryUserTranslation(t.tasks[0], 'task'), true);
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  assert.equal(t.tasks[0].taskAr, 'ترجمتي');
  assert.equal(t.tasks[0].taskArSource, 'user');
  // A built-in text translated the OLD English: it is not carried, the new text is untranslated.
  setTrackerField(t, '7.1.2', 'task', 'Something else entirely', NOW);
  assert.equal(carryUserTranslation(t.tasks[1], 'task'), false);
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  assert.equal(t.tasks[1].taskAr, '');
});

test('«النص الأصلي»: the task shows its English (editor + slide rule), remembered, reversible', () => {
  const st = freshStore();
  const ad = adapterOf(st);
  const t = englishTracker();
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  assert.equal(trackerTaskText(t.tasks[0], 'ar').primary, 'إعداد الخطة التجريبية');
  recordOriginalChoice(t.tasks[0], true);
  assert.equal(t.tasks[0].showOriginal, true);
  assert.deepEqual(trackerTaskText(t.tasks[0], 'ar'), { primary: 'Prepare the synthetic plan', secondary: '' });
  assert.deepEqual(trackerTaskText(t.tasks[0], 'both'), { primary: 'Prepare the synthetic plan', secondary: '' });
  assert.equal(t.tasks[0].taskAr, 'إعداد الخطة التجريبية', 'the translation is kept, only not shown');
  // A re-render keeps the choice (the queued edit is replayed); the save persists it.
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  assert.equal(t.tasks[0].showOriginal, true);
  saveTrackerToStore(ad, t);
  store.__resetForTests();
  assert.equal(st.loadSettings().trackerTranslations.original[normEn('Prepare the synthetic plan')], true);
  const again = englishTracker();
  translateTrackerInPlace(again, ad.settings, BUILTIN);
  assert.equal(again.tasks[0].showOriginal, true, 'a re-upload keeps the choice');
  // Off again → Arabic.
  recordOriginalChoice(again.tasks[0], false);
  translateTrackerInPlace(again, ad.settings, BUILTIN);
  assert.equal(again.tasks[0].showOriginal, false);
  assert.equal(trackerTaskText(again.tasks[0], 'ar').primary, 'إعداد الخطة التجريبية');
});

test('the demo document (remember: false) never reaches the user translation memory', () => {
  const t = englishTracker();
  assert.equal(recordUserTranslation(t.tasks[0], 'taskAr', 'نص', { remember: false }), false);
  assert.equal(t.tasks[0].taskArSource, 'user');
  assert.equal(recordOriginalChoice(t.tasks[0], true, { remember: false }), false);
  assert.equal(pendingTrackerTranslations(), 0);
});

test('the demo document is detached from the memory: a saved user TM does not wipe its edits on the next pass', () => {
  // A user who HAS a translation memory (one that knows nothing about the demo's texts).
  const settings = { trackerTranslations: { tasks: { [normEn('Something else')]: 'شيء آخر' }, tracks: {}, milestones: {},
    original: {}, machine: { tasks: { [normEn('A brand new synthetic task')]: 'مهمة آلية' }, tracks: {}, milestones: {} } } };
  // Undetached (the bug): the edit is read as «a cleared correction» and dropped.
  const a = englishTracker();
  a.tasks[0].taskAr = 'نص تجريبي';
  recordUserTranslation(a.tasks[0], 'taskAr', 'نص تجريبي', { remember: false });
  translateTrackerInPlace(a, settings, BUILTIN);
  assert.equal(a.tasks[0].taskArSource, 'builtin');
  // Detached: the demo edit and its «النص الأصلي» survive; the machine cache is still READ.
  const t = detachTrackerFromTM(englishTracker());
  assert.equal(isTrackerTMDetached(t), true);
  assert.equal(isTrackerTMDetached(englishTracker()), false);
  t.tasks[0].taskAr = 'نص تجريبي';
  recordUserTranslation(t.tasks[0], 'taskAr', 'نص تجريبي', { remember: false });
  recordOriginalChoice(t.tasks[1], true, { remember: false });
  const before = JSON.stringify(settings);
  translateTrackerInPlace(t, settings, BUILTIN);
  translateTrackerInPlace(t, settings, BUILTIN);
  assert.equal(t.tasks[0].taskAr, 'نص تجريبي');
  assert.equal(t.tasks[0].taskArSource, 'user');
  assert.equal(t.tasks[1].showOriginal, true);
  assert.equal(t.tasks[2].taskAr, 'مهمة آلية');
  assert.equal(t.tasks[2].taskArSource, 'machine');
  assert.equal(JSON.stringify(settings), before, 'the user\'s memory is untouched');
  assert.equal(pendingTrackerTranslations(), 0);
  // The ?mock=1 document is marked at birth.
  const mock = buildMockTracker();
  assert.equal(isMockTracker(mock), true);
  assert.equal(isTrackerTMDetached(mock), true);
});

test('the editor meta line can drop the coverage the status line already states (Settings keeps it)', () => {
  const t = englishTracker();
  translateTrackerInPlace(t, null, BUILTIN);
  assert.ok(trackerMetaLine(t).includes(STR.tracker.translated(2, 3)), trackerMetaLine(t));
  const short = trackerMetaLine(t, { coverage: false });
  assert.ok(!short.includes(STR.tracker.translated(2, 3)), short);
  assert.ok(short.startsWith('synthetic-tracker.xlsx'), short);
});

test('a translation memory past the size cap is refused, not written (main.js adapter path)', () => {
  const st = freshStore();
  const ad = adapterOf(st);
  const t = englishTracker();
  const huge = 'ع'.repeat(3900);
  for (let i = 0; i < 120; i++) {
    const task = { ...t.tasks[0], task: `Synthetic task ${i}` };
    recordUserTranslation(task, 'taskAr', huge);
  }
  assert.throws(() => writePendingTrackerTranslations(ad), /كبيرة جداً/);
  assert.equal(st.loadSettings().trackerTranslations, undefined, 'nothing stored');
  assert.ok(pendingTrackerTranslations() > 0, 'kept for a retry');
});

/* ------------------------------------------------------------------ *
 * The built-in memory — once per session, with the data key
 * ------------------------------------------------------------------ */

test('loadBuiltinTrackerTM: once per session, concurrent callers share one load, the data key is passed', async () => {
  const calls = [];
  const importer = async (p) => {
    calls.push(p);
    return { loadTrackerTranslations: async (key) => { calls.push(`key:${key}`); return BUILTIN; } };
  };
  const state = {};
  const st = { settings: { grafana: { dataKey: 'k'.repeat(64) } } };
  const [a, b] = await Promise.all([loadBuiltinTrackerTM(state, st, importer), loadBuiltinTrackerTM(state, st, importer)]);
  assert.equal(a, BUILTIN);
  assert.equal(b, BUILTIN);
  assert.equal(state.trackerBuiltinTM, BUILTIN);
  assert.deepEqual(calls, ['../ingest/tracker-translations.js?v=v2026-10-13.6', `key:${'k'.repeat(64)}`]);
  assert.equal(await loadBuiltinTrackerTM(state, st, importer), BUILTIN);
  assert.equal(calls.length, 2, 'not loaded again');
});

test('loadBuiltinTrackerTM: a failure is null (never thrown), and not retried this session', async () => {
  const state = {};
  let n = 0;
  const failing = async () => { n += 1; return { loadTrackerTranslations: async () => { throw new Error('boom'); } }; };
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await loadBuiltinTrackerTM(state, { settings: {} }, failing), null);
  } finally { console.warn = origWarn; }
  assert.equal(state.trackerBuiltinTM, null);
  assert.equal(await loadBuiltinTrackerTM(state, { settings: {} }, failing), null);
  assert.equal(n, 1);
  assert.equal(await loadBuiltinTrackerTM(null, {}, failing), null);
  // Module absent (guarded import → null) → null.
  const s2 = {};
  assert.equal(await loadBuiltinTrackerTM(s2, { settings: {} }, async () => null), null);
});

/* ------------------------------------------------------------------ *
 * The on-device machine translator (mocked globalThis.Translator)
 * ------------------------------------------------------------------ */

/** A fake Chrome Translator API. `avail` = availability's answer; `out(text)` = translate. */
function fakeTranslator({ avail = 'available', out = (s) => `ترجمة: ${s}`, createError = null } = {}) {
  const log = { availability: [], create: [], translate: [], destroyed: 0 };
  globalThis.Translator = {
    async availability(o) { log.availability.push(o); return avail; },
    async create(o) {
      log.create.push(o);
      if (createError) throw createError;
      if (o && typeof o.monitor === 'function') o.monitor({ addEventListener() {} });
      return {
        async translate(text) { log.translate.push(text); return out(text); },
        destroy() { log.destroyed += 1; },
      };
    },
  };
  return log;
}
const noFetch = () => { globalThis.fetch = () => { throw new Error('fetch must never be called'); }; };

test('translatorApi: feature detection only (absent / incomplete → null)', () => {
  delete globalThis.Translator;
  assert.equal(translatorApi(), null);
  globalThis.Translator = { availability() {} };
  assert.equal(translatorApi(), null);
  fakeTranslator();
  assert.ok(translatorApi());
  assert.equal(translatorApi({}), null);
});

test('machine pass, translator ready: every untranslated text translated on the device, en → ar, nothing fetched', async () => {
  noFetch();
  const log = fakeTranslator();
  const t = englishTracker();
  translateTrackerInPlace(t, {}, BUILTIN);
  const texts = trackerUntranslatedTexts(t);
  assert.deepEqual(texts, { tasks: ['A brand new synthetic task'], tracks: ['Track Beta'], milestones: ['Stage Two'] });
  const progress = [];
  const res = await machineTranslateTexts(texts, { onProgress: (p) => progress.push(p) });
  assert.equal(res.status, 'done');
  assert.equal(res.count, 3);
  assert.deepEqual(res.results.tasks, { 'A brand new synthetic task': 'ترجمة: A brand new synthetic task' });
  assert.deepEqual(log.availability[0], { sourceLanguage: 'en', targetLanguage: 'ar' });
  assert.equal(log.create[0].sourceLanguage, 'en');
  assert.equal(log.create[0].targetLanguage, 'ar');
  assert.equal(log.destroyed, 1);
  assert.deepEqual(progress.at(-1), { phase: 'translate', done: 3, total: 3 });
});

test('machine pass: cached in settings (glossary applied), applied with source «machine», counted for review', async () => {
  noFetch();
  fakeTranslator({ out: (s) => (s.startsWith('A brand') ? 'مهمة جديدة لـ MISBAR مع nupco' : `ترجمة ${s}`) });
  const st = freshStore();
  const ad = adapterOf(st);
  const t = englishTracker();
  t.tasks[2].task = 'A brand new MISBAR task with NUPCO';
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  const res = await machineTranslateTexts(trackerUntranslatedTexts(t));
  assert.equal(saveMachineTranslations(ad, res.results), true);
  const machine = st.loadSettings().trackerTranslations.machine;
  assert.equal(machine.tasks[normEn('A brand new MISBAR task with NUPCO')], 'مهمة جديدة لـ مسبار مع NUPCO', 'MISBAR → مسبار, NUPCO kept as written');
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  assert.equal(t.tasks[2].taskArSource, 'machine');
  assert.equal(t.tasks[2].trackArSource, 'machine');
  assert.equal(t.tasks[0].taskArSource, 'builtin', 'the reviewed memory still wins over the machine');
  assert.deepEqual(trackerTranslationStatus(t, 'ar'), { translated: 3, total: 3, remaining: 0, machine: 1 });
  assert.deepEqual(trackerUntranslatedTexts(t), { tasks: [], tracks: [], milestones: [] });
  // The user's correction beats the machine.
  recordUserTranslation(t.tasks[2], 'taskAr', 'تصحيح المستخدم');
  t.tasks[2].taskAr = 'تصحيح المستخدم';
  translateTrackerInPlace(t, ad.settings, BUILTIN);
  assert.equal(t.tasks[2].taskArSource, 'user');
});

test('machine pass: the model needs a download → only from a click (needs-gesture, then gesture creates)', async () => {
  noFetch();
  const log = fakeTranslator({ avail: 'downloadable' });
  const texts = { tasks: ['Synthetic text'], tracks: [], milestones: [] };
  assert.deepEqual(await machineTranslateTexts(texts), { status: 'needs-gesture' });
  assert.equal(log.create.length, 0, 'no create without a click');
  const res = await machineTranslateTexts(texts, { gesture: true });
  assert.equal(res.status, 'done');
  assert.equal(log.create.length, 1);
  // The browser refuses create anyway (no user activation) → needs-gesture, never a throw.
  const e = new Error('no activation');
  e.name = 'NotAllowedError';
  fakeTranslator({ avail: 'downloading', createError: e });
  assert.deepEqual(await machineTranslateTexts(texts, { gesture: true }), { status: 'needs-gesture' });
});

test('machine pass: no API / unavailable / nothing to do / echo or failure → no translation, no throw', async () => {
  noFetch();
  const texts = { tasks: ['Synthetic text', 'Another one'], tracks: [], milestones: [] };
  delete globalThis.Translator;
  assert.deepEqual(await machineTranslateTexts(texts), { status: 'none' });
  assert.equal(await translatorAvailability(), 'none');
  fakeTranslator({ avail: 'unavailable' });
  assert.deepEqual(await machineTranslateTexts(texts), { status: 'unavailable' });
  fakeTranslator();
  assert.deepEqual(await machineTranslateTexts({ tasks: [], tracks: [], milestones: [] }), { status: 'nothing' });
  assert.deepEqual(await machineTranslateTexts(null), { status: 'nothing' });
  // An echo of the English (no Arabic letters) is not a translation.
  fakeTranslator({ out: (s) => s });
  assert.deepEqual(await machineTranslateTexts(texts), { status: 'failed' });
  // One text failing does not lose the others.
  fakeTranslator({ out: (s) => { if (s === 'Another one') throw new Error('x'); return 'نص'; } });
  const res = await machineTranslateTexts(texts);
  assert.equal(res.status, 'done');
  assert.deepEqual(Object.keys(res.results.tasks), ['Synthetic text']);
  // availability() throwing reads as unavailable.
  globalThis.Translator = { availability: async () => { throw new Error('x'); }, create: async () => ({}) };
  assert.equal(await translatorAvailability(), 'unavailable');
});

test('the source badges and the row tags have their Arabic wording', () => {
  assert.deepEqual(STR.tracker.source, {
    file: 'من الملف', user: 'تعديلك', builtin: 'من الترجمة المعتمدة', machine: 'ترجمة آلية — راجعها', none: 'بدون ترجمة',
  });
  assert.equal(STR.tracker.original, 'النص الأصلي');
  assert.deepEqual([...TRACKER_TRANSLATION_FIELDS].sort(), ['milestoneAr', 'milestoneArSource', 'showOriginal', 'taskAr', 'taskArSource', 'trackAr', 'trackArSource']);
});
