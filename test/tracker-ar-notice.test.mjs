// test/tracker-ar-notice.test.mjs — the review card's «no Arabic to show» warning
// (components.js trackerArabicNotice). SYNTHETIC tasks only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackerArabicNotice } from '../src/ui/components.js';

const T = (...ar) => ({ tasks: ar.map((a, i) => ({ id: `t${i}`, task: `Task ${i}`, taskAr: a })) });

test('Arabic chosen, no task translated → kind none', () => {
  assert.deepEqual(trackerArabicNotice(T('', ''), 'ar'), { kind: 'none', translated: 0, total: 2 });
  assert.equal(trackerArabicNotice(T('', ''), 'both').kind, 'none');
});
test('some translated → partial; all translated or English → nothing', () => {
  assert.deepEqual(trackerArabicNotice(T('مهمة', ''), 'ar'), { kind: 'partial', translated: 1, total: 2 });
  assert.equal(trackerArabicNotice(T('مهمة', 'أخرى'), 'ar'), null);
  assert.equal(trackerArabicNotice(T('', ''), 'en'), null);
});
test('no tracker / no tasks → nothing', () => {
  assert.equal(trackerArabicNotice(null, 'ar'), null);
  assert.equal(trackerArabicNotice({ tasks: [] }, 'ar'), null);
});
