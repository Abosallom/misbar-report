// test/tracker-ar-ui.test.mjs — run with:  node --test
// The Arabic translation of the «متابعة المشروع» tasks, UI layer (Arabic CONTRACT §3–4):
//   • the editor carries taskAr (RTL, paired with the English task) and trackAr /
//     milestoneAr (in the details) as their OWN fields — an edit never touches the English;
//   • the slide-language option reportOptions.trackerLang ('ar' | 'en' | 'both', default
//     'ar'): one option list + normaliser for the review pills and the Settings radio, read
//     back by the review model, round-tripped through the REAL store;
//   • the pure display rules the editor list and the upload card use (task text per
//     language with the per-row English fallback, the group heading, «N من M مهمة مترجمة»);
//   • the dev mock carries made-up Arabic so ?mock=1 shows every mode.
// SYNTHETIC data only: made-up tasks, owners and Arabic text — never the user's file.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRACKER_EDIT_FIELDS, TRACKER_LANGS, DEFAULT_TRACKER_LANG, TRACKER_LANG_OPTIONS,
  normalizeTrackerLang, trackerTaskText, trackerTranslationCount, trackerGroupLabel,
  trackerGroupKey, trackerHasAnyArabic,
  trackerMetaLine, setTrackerField, addTrackerTask, trackerSuggestions,
} from '../src/ui/components.js';
import { reportOptionsFromSettings } from '../src/ui/screen-review.js';
import { buildMockTracker } from '../src/ui/screen-upload.js';
import { STR } from '../src/i18n/ar.js';
import { TASK_FIELDS, TRACKER_FORMAT } from '../src/ingest/task-tracker.js';
import { REPORT_OPTIONS_SEED } from '../src/seeds/defaults.js';
import * as store from '../src/store.js';

const NOW = '2026-10-13T09:00:00.000Z';

/** A synthetic tagged ProjectTracker; `ar` adds made-up Arabic per task. */
function tracker() {
  const t = (wbs, track, milestone, task, ar = {}) => {
    const o = {};
    for (const f of TASK_FIELDS) o[f] = '';
    return {
      ...o, id: wbs, wbs, track, milestone, task, status: 'In Progress', owner: 'Person A',
      taskAr: ar.task || '', trackAr: ar.track || '', milestoneAr: ar.milestone || '',
    };
  };
  return {
    format: TRACKER_FORMAT,
    fileName: 'synthetic-tracker.xlsx',
    loadedAt: NOW,
    editedAt: null,
    warnings: [],
    tasks: [
      t('8.1.1', 'Track One', 'Stage A', 'Synthetic task one', { task: 'مهمة تجريبية أولى', track: 'المسار الأول', milestone: 'المرحلة أ' }),
      t('8.1.2', 'Track One', 'Stage A', 'Synthetic task two', { track: 'المسار الأول', milestone: 'المرحلة أ' }),
      t('8.2.1', 'Track One', 'Stage B', 'Synthetic task three', { task: 'مهمة تجريبية ثالثة', track: 'المسار الأول' }),
      t('8.3.1', 'Track Two', 'Stage C', 'Synthetic task four', { task: '   ' }),
    ],
  };
}

/* ------------------------------------------------------------------ *
 * The language option
 * ------------------------------------------------------------------ */

test('trackerLang: three options in selector order, the exact Arabic labels, default «عربي»', () => {
  assert.deepEqual(TRACKER_LANGS, ['ar', 'en', 'both']);
  assert.deepEqual(TRACKER_LANG_OPTIONS.map((o) => o.value), ['ar', 'en', 'both']);
  assert.deepEqual(TRACKER_LANG_OPTIONS.map((o) => o.label), ['عربي', 'إنجليزي', 'عربي + إنجليزي']);
  for (const o of TRACKER_LANG_OPTIONS) assert.ok(o.hint, `hint for ${o.value}`);
  assert.equal(STR.tracker.langTitle, 'لغة نص المهام في الشريحة');
  assert.equal(DEFAULT_TRACKER_LANG, 'ar');
  // The seed owns the first-run value; the screens' default must be the same.
  assert.equal(REPORT_OPTIONS_SEED.trackerLang, DEFAULT_TRACKER_LANG);
});

test('normalizeTrackerLang: a screen always gets a valid choice (bad / absent → «عربي»)', () => {
  assert.equal(normalizeTrackerLang('en'), 'en');
  assert.equal(normalizeTrackerLang('both'), 'both');
  assert.equal(normalizeTrackerLang(' Both '), 'both', 'case / spaces forgiven');
  for (const bad of [undefined, null, '', 'arabic', 'fr', 42, {}, true]) {
    assert.equal(normalizeTrackerLang(bad), 'ar', String(bad));
  }
});

test('review model: reportOptions.trackerLang read from settings (absent / junk → ar), other options untouched', () => {
  assert.equal(reportOptionsFromSettings(null).trackerLang, 'ar');
  assert.equal(reportOptionsFromSettings({}).trackerLang, 'ar');
  assert.equal(reportOptionsFromSettings({ reportOptions: { deltaMode: 'daily' } }).trackerLang, 'ar', 'a doc from before the option');
  assert.equal(reportOptionsFromSettings({ reportOptions: { trackerLang: 'en' } }).trackerLang, 'en');
  assert.equal(reportOptionsFromSettings({ reportOptions: { trackerLang: 'BOTH' } }).trackerLang, 'both');
  assert.equal(reportOptionsFromSettings({ reportOptions: { trackerLang: 'xx' } }).trackerLang, 'ar');
  const ro = reportOptionsFromSettings({ reportOptions: { trackerLang: 'both', deltaMode: 'daily', autoDownloadFiles: false } });
  assert.equal(ro.deltaMode, 'daily');
  assert.equal(ro.autoDownloadFiles, false);
  assert.equal(ro.slides.tracker, true);
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

test('persistence: a chosen language survives a save + reload through the REAL store and is what the review reads', () => {
  const st = freshStore();
  assert.equal(reportOptionsFromSettings(st.loadSettings()).trackerLang, 'ar', 'a fresh install reads «عربي»');
  for (const lang of ['both', 'en', 'ar']) {
    // The review's persistReportOptions / Settings' autosave: load, set, save.
    const doc = st.loadSettings();
    doc.reportOptions = { ...(doc.reportOptions || {}), trackerLang: lang };
    st.saveSettings(doc);
    store.__resetForTests(); // a page reload: memory gone, localStorage kept
    assert.equal(st.loadSettings().reportOptions.trackerLang, lang, lang);
    assert.equal(reportOptionsFromSettings(st.loadSettings()).trackerLang, lang, lang);
  }
});

/* ------------------------------------------------------------------ *
 * Editor fields
 * ------------------------------------------------------------------ */

test('editor fields: taskAr is an RTL field paired with the English task; trackAr / milestoneAr follow theirs', () => {
  const keys = TRACKER_EDIT_FIELDS.map((f) => f.key);
  const at = (k) => keys.indexOf(k);
  assert.equal(at('taskAr'), at('task') + 1, 'beside the English task');
  assert.equal(at('trackAr'), at('track') + 1);
  assert.equal(at('milestoneAr'), at('milestone') + 1);
  const f = Object.fromEntries(TRACKER_EDIT_FIELDS.map((x) => [x.key, x]));
  assert.equal(f.task.pair && f.taskAr.pair, true, 'one row: original + translation');
  assert.deepEqual(TRACKER_EDIT_FIELDS.filter((x) => x.pair).map((x) => x.key), ['task', 'taskAr']);
  assert.deepEqual(TRACKER_EDIT_FIELDS.filter((x) => x.rtl).map((x) => x.key), ['taskAr', 'trackAr', 'milestoneAr']);
  assert.equal(f.taskAr.wide, true, 'multi-line like the task');
  for (const k of ['taskAr', 'trackAr', 'milestoneAr']) assert.match(STR.tracker.fields[k], /عربي|العربية/, k);
  // The English originals are labelled as the original.
  for (const k of ['task', 'track', 'milestone']) assert.match(STR.tracker.fields[k], /الأصل/, k);
});

test('setTrackerField: the Arabic fields are edited on their own — the English original is never touched', () => {
  const t = tracker();
  assert.equal(setTrackerField(t, '8.1.2', 'taskAr', 'ترجمة جديدة', NOW), true);
  assert.equal(t.tasks[1].taskAr, 'ترجمة جديدة');
  assert.equal(t.tasks[1].task, 'Synthetic task two');
  assert.equal(t.editedAt, NOW, 'stamped like any edit (persisted + the upload card note)');
  setTrackerField(t, '8.1.2', 'trackAr', 'مسار معدل', NOW);
  setTrackerField(t, '8.1.2', 'milestoneAr', 'مرحلة معدلة', NOW);
  assert.deepEqual([t.tasks[1].track, t.tasks[1].milestone], ['Track One', 'Stage A']);
  // Clearing a translation = '' (the slide falls back to the English).
  setTrackerField(t, '8.1.2', 'taskAr', null, NOW);
  assert.equal(t.tasks[1].taskAr, '');
  // A cache from before translations (no *Ar keys) is editable too.
  const old = tracker();
  delete old.tasks[0].taskAr;
  assert.equal(setTrackerField(old, '8.1.1', 'taskAr', 'نص', NOW), true);
  assert.equal(old.tasks[0].taskAr, 'نص');
});

test('addTrackerTask «after»: joins the group in both languages, with no task translation yet', () => {
  const t = tracker();
  const n = addTrackerTask(t, { afterId: '8.1.1', now: NOW });
  assert.deepEqual([n.track, n.trackAr, n.milestone, n.milestoneAr], ['Track One', 'المسار الأول', 'Stage A', 'المرحلة أ']);
  assert.equal(n.task, '');
  assert.equal(n.taskAr || '', '');
  for (const f of TASK_FIELDS) assert.equal(typeof (n[f] ?? ''), 'string', f);
});

test('suggestions: the Arabic track / milestone names offered from the data (no vocabulary)', () => {
  const t = tracker();
  assert.deepEqual(trackerSuggestions(t, 'trackAr'), ['المسار الأول']);
  assert.deepEqual(trackerSuggestions(t, 'milestoneAr'), ['المرحلة أ']);
});

/* ------------------------------------------------------------------ *
 * Display rules (the list reads like the slide)
 * ------------------------------------------------------------------ */

test('trackerTaskText: ar = Arabic else English per row; en = English; both = Arabic + the English original', () => {
  const [one, two, , four] = tracker().tasks;
  assert.deepEqual(trackerTaskText(one, 'ar'), { primary: 'مهمة تجريبية أولى', secondary: '' });
  assert.deepEqual(trackerTaskText(one, 'en'), { primary: 'Synthetic task one', secondary: '' });
  assert.deepEqual(trackerTaskText(one, 'both'), { primary: 'مهمة تجريبية أولى', secondary: 'Synthetic task one' });
  // No Arabic (or whitespace only) → the English once, in every language.
  for (const lang of TRACKER_LANGS) {
    assert.deepEqual(trackerTaskText(two, lang), { primary: 'Synthetic task two', secondary: '' }, lang);
    assert.deepEqual(trackerTaskText(four, lang), { primary: 'Synthetic task four', secondary: '' }, lang);
  }
  // Unknown language → the default (Arabic).
  assert.equal(trackerTaskText(one, 'zz').primary, 'مهمة تجريبية أولى');
  // An Arabic-only row (no English) still shows its text; an empty row shows nothing.
  assert.deepEqual(trackerTaskText({ task: '', taskAr: 'فقط عربي' }, 'both'), { primary: 'فقط عربي', secondary: '' });
  assert.deepEqual(trackerTaskText(null, 'ar'), { primary: '', secondary: '' });
});

// UPDATED 2026-10-18: 'en' headings are the Arabic too (they were the English pair) — the
// deck's 'en' group labels print the stage / track translations (user correction).
test('trackerGroupLabel: English without a language (display only — trackerGroupKey groups); Arabic per part with English fallback', () => {
  const [one, , three, four] = tracker().tasks;
  assert.equal(trackerGroupLabel(one), 'Track One › Stage A', 'unchanged default');
  assert.equal(trackerGroupLabel(one, 'en'), 'المسار الأول › المرحلة أ', "'en': the deck's Arabic group labels");
  assert.equal(trackerGroupLabel(three, 'en'), 'المسار الأول › Stage B');
  assert.equal(trackerGroupLabel(one, 'ar'), 'المسار الأول › المرحلة أ');
  assert.equal(trackerGroupLabel(one, 'both'), 'المسار الأول › المرحلة أ');
  assert.equal(trackerGroupLabel(three, 'ar'), 'المسار الأول › Stage B', 'milestone has no Arabic → English');
  assert.equal(trackerGroupLabel(four, 'ar'), 'Track Two › Stage C');
  assert.equal(trackerGroupLabel({}, 'ar'), `${STR.tracker.noTrack} › ${STR.tracker.noMilestone}`);
});

// UPDATED 2026-10-18: one rule for every language — 'en' used to ignore the Arabic pair; its
// group labels now print the Arabic, so a renamed Arabic name splits the block there too.
test('trackerGroupKey: the slide\'s merge rule — English + Arabic pair in every language', () => {
  const [one, two, three, four] = tracker().tasks;
  assert.equal(trackerGroupKey(one, 'en'), trackerGroupKey(two, 'en'));
  assert.notEqual(trackerGroupKey(two, 'en'), trackerGroupKey(three, 'en'), 'milestone differs');
  for (const l of ['ar', 'both']) assert.equal(trackerGroupKey(one, 'en'), trackerGroupKey(one, l), `'en' = ${l}`);
  // 'ar' / 'both': same English AND same Arabic → one group.
  for (const l of ['ar', 'both']) assert.equal(trackerGroupKey(one, l), trackerGroupKey(two, l), l);
  // The Arabic name renamed on ONE task splits the group, exactly as the slide's blocks split
  // (build-tracker trackKey / msKey) — not one heading named from the first task.
  const renamed = { ...two, trackAr: 'اسم آخر' };
  assert.notEqual(trackerGroupKey(one, 'ar'), trackerGroupKey(renamed, 'ar'));
  assert.notEqual(trackerGroupKey(one, 'en'), trackerGroupKey(renamed, 'en'), '\'en\' splits too');
  const halfMs = { ...two, milestoneAr: '' };
  assert.notEqual(trackerGroupKey(one, 'both'), trackerGroupKey(halfMs, 'both'));
  // Whitespace runs collapse as on the slide; a missing language reads as the default ('ar').
  assert.equal(trackerGroupKey({ ...one, track: ' Track   One ', trackAr: 'المسار  الأول' }, 'ar'), trackerGroupKey(one, 'ar'));
  assert.equal(trackerGroupKey(one), trackerGroupKey(one, 'ar'));
  assert.equal(trackerGroupKey(four, 'ar'), trackerGroupKey({ ...four }, 'ar'));
  assert.equal(trackerGroupKey(null, 'en'), trackerGroupKey({}, 'en'));
});

test('trackerHasAnyArabic: task, track or milestone Arabic counts; whitespace does not', () => {
  assert.equal(trackerHasAnyArabic(tracker()), true);
  const t = tracker();
  for (const x of t.tasks) { x.taskAr = ''; x.milestoneAr = ''; }
  assert.equal(trackerTranslationCount(t).translated, 0);
  assert.equal(trackerHasAnyArabic(t), true, 'Arabic track names only (Portfolio columns) — not «English only»');
  for (const x of t.tasks) x.trackAr = '  ';
  assert.equal(trackerHasAnyArabic(t), false);
  t.tasks[3].milestoneAr = 'المرحلة ج';
  assert.equal(trackerHasAnyArabic(t), true);
  assert.equal(trackerHasAnyArabic(null), false);
  assert.equal(trackerHasAnyArabic({ tasks: [null, 'x', { task: 'x' }] }), false);
});

test('editor labels: the three Arabic fields share one suffix «(عربي)»; the English say «(الأصل)»', () => {
  const F = STR.tracker.fields;
  for (const k of ['taskAr', 'trackAr', 'milestoneAr']) assert.match(F[k], / \(عربي\)$/, k);
  for (const k of ['task', 'track', 'milestone']) assert.match(F[k], / \(الأصل\)$/, k);
  for (const [en, ar] of [['task', 'taskAr'], ['track', 'trackAr'], ['milestone', 'milestoneAr']]) {
    assert.equal(F[ar].replace(' (عربي)', ''), F[en].replace(' (الأصل)', ''), `${ar} pairs ${en}`);
  }
});

test('translation count: «N من M مهمة مترجمة» (whitespace is not a translation)', () => {
  assert.deepEqual(trackerTranslationCount(tracker()), { translated: 2, total: 4 });
  assert.deepEqual(trackerTranslationCount(null), { translated: 0, total: 0 });
  assert.deepEqual(trackerTranslationCount({ tasks: [null, { task: 'x' }] }), { translated: 0, total: 1 });
  assert.equal(STR.tracker.translated(2, 4), '2 من 4 مهمة مترجمة');
  // The upload card's line is the AUTOMATIC one (CONTRACT-AUTO §6); its old «no Arabic
  // columns» note is gone — the user never prepares an Arabic workbook.
  assert.equal(STR.tracker.autoTranslated(2, 4), '2 من 4 مهمة مترجمة تلقائيًا');
  assert.equal(STR.upload.trackerNoArabic, undefined);
});

test('meta line: shows the translation coverage once any task has Arabic; a file without it reads as before', () => {
  const t = tracker();
  assert.ok(trackerMetaLine(t).includes('2 من 4 مهمة مترجمة'), trackerMetaLine(t));
  for (const x of t.tasks) x.taskAr = '';
  assert.ok(!trackerMetaLine(t).includes('مترجمة'));
  assert.ok(trackerMetaLine(t).startsWith('synthetic-tracker.xlsx · 4 مهمة'));
});

/* ------------------------------------------------------------------ *
 * Dev mock
 * ------------------------------------------------------------------ */

test('buildMockTracker: made-up Arabic on every group and on all tasks but one (the fallback row)', () => {
  const m = buildMockTracker();
  for (const t of m.tasks) {
    assert.ok(t.trackAr && t.milestoneAr, `${t.wbs} group named in Arabic`);
    assert.match(t.task, /\(mock\)$/, 'the English original stays');
    if (t.taskAr) assert.match(t.taskAr, /\(تجريبي\)$/, 'made-up Arabic only');
  }
  const c = trackerTranslationCount(m);
  assert.equal(c.total, m.tasks.length);
  assert.equal(c.translated, m.tasks.length - 1);
});
