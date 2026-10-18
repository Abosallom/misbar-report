// test/tracker-ar-notice.test.mjs — the review card's tracker translation STATUS
// (components.js trackerTranslationStatus, CONTRACT-AUTO §6). The old «upload the Arabic
// Excel» warning (trackerArabicNotice / STR.tracker.noArabic*) is GONE: the tasks are
// translated automatically, so the card says «N من M مهمة مترجمة تلقائيًا» and only while
// some remain, how they get Arabic. SYNTHETIC tasks only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as components from '../src/ui/components.js';
import { STR } from '../src/i18n/ar.js';

const { trackerTranslationStatus } = components;
const T = (...ar) => ({ tasks: ar.map((a, i) => ({ id: `t${i}`, task: `Task ${i}`, taskAr: a })) });

test('status: «N من M» with what remains; machine translations counted for review', () => {
  assert.deepEqual(trackerTranslationStatus(T('', ''), 'ar'), { translated: 0, total: 2, remaining: 2, machine: 0 });
  assert.deepEqual(trackerTranslationStatus(T('مهمة', ''), 'both'), { translated: 1, total: 2, remaining: 1, machine: 0 });
  assert.deepEqual(trackerTranslationStatus(T('مهمة', 'أخرى'), 'ar'), { translated: 2, total: 2, remaining: 0, machine: 0 });
  const m = T('مهمة', 'أخرى');
  m.tasks[1].taskArSource = 'machine';
  assert.equal(trackerTranslationStatus(m, 'ar').machine, 1);
});
test('nothing to say: English slides, no tracker, no tasks', () => {
  assert.equal(trackerTranslationStatus(T('', ''), 'en'), null);
  assert.equal(trackerTranslationStatus(null, 'ar'), null);
  assert.equal(trackerTranslationStatus({ tasks: [] }, 'ar'), null);
});
// 2026-10-18 user correction: in 'en' only the TASK text stays English — track and stage
// names still print their Arabic. So 'en' is no longer silent: untranslated track / stage
// names (never tasks) are reported, and the on-device pass covers them (screen-review.js).
test("'en': only untranslated track / stage names are reported (the task text stays English)", () => {
  const t = { tasks: [
    { id: 'a', task: 'Task A', taskAr: '', track: 'Infra', trackAr: '', milestone: 'Go-live', milestoneAr: 'الإطلاق' },
    { id: 'b', task: 'Task B', taskAr: '', track: 'Infra', trackAr: '', milestone: 'UAT', milestoneAr: '' },
  ] };
  assert.deepEqual(trackerTranslationStatus(t, 'en'), { scope: 'groups', remaining: 2 }); // Infra (once) + UAT
  t.tasks.forEach((x) => { x.trackAr = 'البنية'; });
  t.tasks[1].milestoneAr = 'الاختبار';
  assert.equal(trackerTranslationStatus(t, 'en'), null); // every name has Arabic; tasks never counted
  assert.equal(STR.tracker.untranslatedGroupsHint(2),
    '2 من أسماء المسارات والمراحل بدون ترجمة — تظهر بالإنجليزية؛ يمكنك كتابة الترجمة في المحرر');
  assert.equal(STR.tracker.translateGroupsBtn, 'ترجمة المسارات والمراحل');
  assert.equal(typeof STR.tracker.translatingGroups, 'string');
});
test('the «upload an Arabic Excel» guidance is gone — from the code and from every string', () => {
  assert.equal(components.trackerArabicNotice, undefined);
  for (const k of ['noArabicTitle', 'noArabicBody', 'partialArabic']) assert.equal(STR.tracker[k], undefined, k);
  assert.equal(STR.upload.trackerNoArabic, undefined);
  // No user-facing string anywhere tells the user to prepare / upload an Arabic file.
  const all = JSON.stringify(STR, (_k, v) => (typeof v === 'function' ? v(1, 2) : v));
  assert.doesNotMatch(all, /ارفع النسخة العربية|أعمدة Arabic|أعمدة ترجمة عربية/);
  assert.equal(STR.tracker.autoTranslated(30, 34), '30 من 34 مهمة مترجمة تلقائيًا');
  assert.match(STR.tracker.untranslatedHint(4), /^4 مهمة بدون ترجمة — تظهر بالإنجليزية؛ يمكنك كتابة الترجمة في المحرر$/);
  assert.equal(STR.tracker.translateBtn, 'ترجمة المهام غير المترجمة');
});
