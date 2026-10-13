// test/tracker-ar-data.test.mjs — the Arabic translation fields of the ProjectTracker
// (taskAr / trackAr / milestoneAr, 2026-10-13) in ingest/task-tracker.js: optional Arabic
// columns read from EITHER sheet by tolerant header match, the English never overwritten,
// a workbook without them parsing exactly as before, and the document helpers keeping
// the new fields. Plus the trackerLang enum the store and the slides share.
// SYNTHETIC workbooks and invented Arabic text only — the user's tracker never enters the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as XLSX from '../vendor/xlsx.mjs';
import {
  parseTaskTracker, normalizeProjectTracker, newTask, backfillTaskFields,
  TRACKER_FORMAT, TASK_FIELDS, TRACKER_LANGS, DEFAULT_TRACKER_LANG, normalizeTrackerLang,
} from '../src/ingest/task-tracker.js';
import { REPORT_OPTIONS_SEED } from '../src/seeds/defaults.js';
import {
  standardTrackerBytes, workbookBytes, hierarchicalSheet, portfolioSheet,
  H_ROWS, P_ROWS, H_HEADERS, P_HEADERS,
} from './fixtures/task-tracker-workbooks.js';

const NOW = '2026-10-13T08:00:00.000Z';
const AR = ['taskAr', 'trackAr', 'milestoneAr'];
const parse = (bytes, opts = {}) => parseTaskTracker(bytes, XLSX, { now: NOW, ...opts });
const byWbs = (tr) => Object.fromEntries(tr.tasks.map((t) => [t.wbs, t]));

// Invented Arabic per WBS (the standard fixture's WBS ids).
const H_TASK_AR = {
  '1.1.1': 'تشكيل لجنة تجريبية', '1.2.1': 'عقد اجتماع تجريبي', '2.1.1': 'إعداد إطار تجريبي',
  '2.1.2': 'إطلاق تجريبي', '2.2.1': 'تكامل نظام تجريبي', '3.1.1': 'مهمة في الورقة الهرمية فقط',
};
const P_TASK_AR = {
  '2.1.1': 'إعداد إطار تجريبي', '1.2.1': 'عقد اجتماع تجريبي', '1.1.1': 'تشكيل لجنة تجريبية',
  '2.1.2': 'اعتماد الإطلاق التجريبي', '9.9.9': 'مهمة في ورقة المحفظة فقط', '2.2.1': 'تكامل نظام تجريبي',
  '4.4.4': 'مهمة محفظة بحالة محفوظة',
};
// Group translations, written on each group's FIRST row only (like the English).
const P_GROUP_AR = [
  ['المسار أ', 'المرحلة الأولى'], [null, null], [null, 'المرحلة الثانية'],
  ['المسار ب', 'المرحلة الثالثة'], [null, null], [null, null], ['المسار ج', null],
];

/** Hierarchical rows with an extra trailing column taken from `col(wbs)`. */
const hWith = (col) => H_ROWS.map((r) => [...r, col(r[0])]);
/** Portfolio rows with extra trailing columns `cols(i, wbs)` (an array). */
const pWith = (cols) => P_ROWS.map((r, i) => [...r, ...cols(i, r[2])]);

function twoSheets({ hHeaders = H_HEADERS, hRows = H_ROWS, pHeaders = P_HEADERS, pRows = P_ROWS } = {}) {
  return workbookBytes(XLSX, [
    ['Hierarchical Tracker', hierarchicalSheet(XLSX, hRows, { headers: hHeaders })],
    ['Portfolio Tracker', portfolioSheet(XLSX, pRows, { headers: pHeaders })],
  ]);
}

// ---- the shape -------------------------------------------------------------------------

test('TASK_FIELDS carries the three translation fields, each right after its English field', () => {
  for (const f of AR) assert.ok(TASK_FIELDS.includes(f), f);
  for (const [en, ar] of [['task', 'taskAr'], ['track', 'trackAr'], ['milestone', 'milestoneAr']]) {
    assert.equal(TASK_FIELDS.indexOf(ar), TASK_FIELDS.indexOf(en) + 1, `${ar} follows ${en}`);
  }
  assert.equal(TASK_FIELDS.length, 20);
  assert.equal(new Set(TASK_FIELDS).size, TASK_FIELDS.length);
});

// ---- neither sheet ---------------------------------------------------------------------

test('a workbook WITHOUT Arabic columns parses as before: every *Ar field is \'\'', () => {
  const tr = parse(standardTrackerBytes(XLSX));
  assert.equal(tr.tasks.length, 8);
  for (const t of tr.tasks) {
    assert.deepEqual(Object.keys(t).sort(), [...TASK_FIELDS].sort(), t.wbs);
    for (const f of AR) assert.equal(t[f], '', `${t.wbs}.${f}`);
  }
  // The English is unchanged by the new code paths (spot checks against the fixture).
  const t = byWbs(tr);
  assert.equal(t['2.1.2'].task, 'Synthetic go-live', 'Hierarchical task, whitespace collapsed');
  assert.deepEqual([t['1.1.1'].track, t['1.1.1'].milestone], ['Track A', 'Milestone Two']);
  assert.ok(!tr.warnings.some((w) => /عربي/.test(w)), 'no translation warnings');
});

// ---- Hierarchical only ------------------------------------------------------------------

test('Arabic task column in the HIERARCHICAL sheet only → taskAr; groups have no Arabic', () => {
  const tr = parse(twoSheets({
    hHeaders: [...H_HEADERS, 'Task / Deliverable (Arabic)'],
    hRows: hWith((wbs) => H_TASK_AR[wbs]),
  }));
  const t = byWbs(tr);
  for (const [wbs, ar] of Object.entries(H_TASK_AR)) assert.equal(t[wbs].taskAr, ar, wbs);
  assert.equal(t['9.9.9'].taskAr, '', 'Portfolio-only row: the Hierarchical column cannot reach it');
  assert.equal(t['2.1.2'].task, 'Synthetic go-live', 'the English task is never overwritten');
  for (const x of tr.tasks) assert.deepEqual([x.trackAr, x.milestoneAr], ['', ''], x.wbs);
  assert.deepEqual(tr.tasks.map((x) => x.wbs), ['2.1.1', '1.2.1', '1.1.1', '2.1.2', '9.9.9', '2.2.1', '4.4.4', '3.1.1'], 'order unchanged');
});

// ---- Portfolio only ---------------------------------------------------------------------

test('Arabic columns in the PORTFOLIO sheet only → taskAr + group Arabic filled DOWN within the English group', () => {
  const tr = parse(twoSheets({
    pHeaders: [...P_HEADERS, 'Portfolio Track (Arabic)', 'Milestone (Arabic)', 'Task / Deliverable (AR)'],
    pRows: pWith((i, wbs) => [...P_GROUP_AR[i], P_TASK_AR[wbs]]),
  }));
  const t = byWbs(tr);
  assert.deepEqual([t['2.1.1'].trackAr, t['2.1.1'].milestoneAr], ['المسار أ', 'المرحلة الأولى']);
  assert.deepEqual([t['1.2.1'].trackAr, t['1.2.1'].milestoneAr], ['المسار أ', 'المرحلة الأولى'], 'both filled down');
  assert.deepEqual([t['1.1.1'].trackAr, t['1.1.1'].milestoneAr], ['المسار أ', 'المرحلة الثانية'], 'new milestone, same track');
  assert.deepEqual([t['2.1.2'].trackAr, t['2.1.2'].milestoneAr], ['المسار ب', 'المرحلة الثالثة']);
  assert.deepEqual([t['9.9.9'].trackAr, t['9.9.9'].milestoneAr], ['المسار ب', 'المرحلة الثالثة']);
  assert.deepEqual([t['2.2.1'].trackAr, t['2.2.1'].milestoneAr], ['المسار ب', 'المرحلة الثالثة']);
  assert.deepEqual([t['4.4.4'].trackAr, t['4.4.4'].milestoneAr], ['المسار ج', ''], 'a new track never inherits the previous milestone\'s Arabic');
  assert.deepEqual([t['3.1.1'].trackAr, t['3.1.1'].milestoneAr], ['', ''], 'Hierarchical-only row: no group');
  // taskAr from Portfolio (no Hierarchical column to win over it).
  for (const [wbs, ar] of Object.entries(P_TASK_AR)) assert.equal(t[wbs].taskAr, ar, wbs);
  assert.equal(t['3.1.1'].taskAr, '');
  // The English grouping is untouched.
  assert.deepEqual([t['4.4.4'].track, t['4.4.4'].milestone], ['Track C', '']);
  assert.deepEqual([t['1.1.1'].track, t['1.1.1'].milestone], ['Track A', 'Milestone Two']);
});

test('a group with no Arabic label never inherits the previous group\'s (per-cell fallback stays possible)', () => {
  // Track A translated, Track B / its milestone NOT: B's rows must read '' — the slide
  // then shows the English «Track B», not Track A's Arabic.
  const groups = [['المسار أ', 'المرحلة الأولى'], [null, null], [null, null], [null, null], [null, null], [null, null], [null, null]];
  const t = byWbs(parse(twoSheets({
    pHeaders: [...P_HEADERS, 'Portfolio Track (Arabic)', 'Milestone (Arabic)'],
    pRows: pWith((i) => groups[i]),
  })));
  assert.deepEqual([t['1.2.1'].trackAr, t['1.2.1'].milestoneAr], ['المسار أ', 'المرحلة الأولى']);
  assert.deepEqual([t['1.1.1'].trackAr, t['1.1.1'].milestoneAr], ['المسار أ', ''], 'new English milestone → its Arabic is unknown');
  for (const w of ['2.1.2', '9.9.9', '2.2.1', '4.4.4']) {
    assert.deepEqual([t[w].trackAr, t[w].milestoneAr], ['', ''], w);
  }
});

test('a Portfolio row holding only group labels (English + Arabic) moves the fill-down and is skipped', () => {
  const pHeaders = [...P_HEADERS, 'Portfolio Track (Arabic)', 'Milestone (Arabic)'];
  const blank = (n) => Array(n).fill(null);
  const pRows = [
    ['Track G', 'Stage G', ...blank(9), 'مسار ز', 'مرحلة ز'], // group-header row: labels only
    [null, null, '2.1.1', 'Framework Package', 'Finalize the synthetic framework', 'Deliverable', 'ORG-B', 'Owner Three', 'Critical', 'Deleyed', 'daily', null, null],
    [null, null, null, ...blank(8), 'مسار لا يُقرأ', null], // an Arabic label alone is no task
  ];
  const tr = parse(twoSheets({ pHeaders, pRows }));
  const p = tr.tasks.filter((x) => x.track);
  assert.equal(p.length, 1, 'only the real task, no phantom rows');
  assert.deepEqual([p[0].track, p[0].trackAr, p[0].milestone, p[0].milestoneAr], ['Track G', 'مسار ز', 'Stage G', 'مرحلة ز']);
});

// ---- both sheets ------------------------------------------------------------------------

test('Arabic task in BOTH sheets: Hierarchical wins, Portfolio fills a blank, a real difference warns', () => {
  const hAr = { ...H_TASK_AR, '1.2.1': '' }; // blank here → Portfolio's
  const tr = parse(twoSheets({
    hHeaders: [...H_HEADERS, 'المهمة / المخرج'],
    hRows: hWith((wbs) => hAr[wbs]),
    pHeaders: [...P_HEADERS, 'المسار', 'المرحلة', 'المهمة'],
    pRows: pWith((i, wbs) => [...P_GROUP_AR[i], P_TASK_AR[wbs]]),
  }));
  const t = byWbs(tr);
  assert.equal(t['2.1.2'].taskAr, 'إطلاق تجريبي', 'Hierarchical wins (Portfolio says اعتماد الإطلاق التجريبي)');
  assert.equal(t['1.2.1'].taskAr, 'عقد اجتماع تجريبي', 'blank Hierarchical → Portfolio');
  assert.equal(t['9.9.9'].taskAr, 'مهمة في ورقة المحفظة فقط', 'Portfolio-only row');
  assert.equal(t['3.1.1'].taskAr, 'مهمة في الورقة الهرمية فقط', 'Hierarchical-only row');
  assert.deepEqual([t['2.2.1'].trackAr, t['2.2.1'].milestoneAr], ['المسار ب', 'المرحلة الثالثة'], 'Arabic-script headers read');
  const w = tr.warnings.filter((x) => x.includes('المهمة (عربي)'));
  assert.equal(w.length, 1, 'exactly the one real disagreement');
  assert.match(w[0], /2\.1\.2/);
  assert.match(w[0], /Hierarchical/);
});

test('group Arabic in both sheets: Portfolio (filled down) wins, a Hierarchical column fills a blank per row', () => {
  const hTrack = { '3.1.1': 'مسار هرمي', '2.1.1': 'مسار يخسر', '4.4.4': 'غير موجود' };
  const groups = [['المسار أ', null], [null, null], [null, null], [null, null], [null, null], [null, null], [null, null]];
  const t = byWbs(parse(twoSheets({
    hHeaders: [...H_HEADERS, 'Track (Arabic)'],
    hRows: hWith((wbs) => hTrack[wbs]),
    pHeaders: [...P_HEADERS, 'Portfolio Track (Arabic)'],
    pRows: pWith((i) => [groups[i][0]]),
  })));
  assert.equal(t['2.1.1'].trackAr, 'المسار أ', 'Portfolio wins');
  assert.equal(t['1.2.1'].trackAr, 'المسار أ', 'filled down');
  assert.equal(t['3.1.1'].trackAr, 'مسار هرمي', 'Hierarchical fills a blank');
  assert.equal(t['2.1.2'].trackAr, '', 'new English track, no Arabic anywhere');
});

// ---- header tolerance -------------------------------------------------------------------

test('tolerant headers: latin suffix / prefix, Arabic marker words, diacritics and spelling variants', () => {
  const cases = [
    ['Task / Deliverable (Arabic)', 'taskAr'], ['TASK-DELIVERABLE AR', 'taskAr'], ['Arabic Task', 'taskAr'],
    ['Task (عربي)', 'taskAr'], ['Task / Deliverable - Arabic translation', 'taskAr'],
    ['المهمّة', 'taskAr'], ['المهمه', 'taskAr'], ['المهمة (بالعربية)', 'taskAr'], ['المهمة / المخرج', 'taskAr'],
    ['Portfolio Track (Arabic)', 'trackAr'], ['Track AR', 'trackAr'], ['المسار', 'trackAr'], ['مسار المحفظة', 'trackAr'],
    ['Milestone (Arabic)', 'milestoneAr'], ['milestone_ar', 'milestoneAr'], ['المرحلة', 'milestoneAr'], ['المرحلة الرئيسية', 'milestoneAr'],
  ];
  for (const [header, field] of cases) {
    const t = byWbs(parse(twoSheets({ hHeaders: [...H_HEADERS, header], hRows: hWith(() => 'نص تجريبي') })));
    // trackAr / milestoneAr from the Hierarchical sheet fill a blank (Portfolio has none here).
    assert.equal(t['1.1.1'][field], 'نص تجريبي', `${header} → ${field}`);
    for (const f of AR.filter((x) => x !== field)) assert.equal(t['1.1.1'][f], '', `${header} → not ${f}`);
    assert.equal(t['1.1.1'].task, 'Set up the synthetic steering group', `${header}: English task kept`);
  }
});

test('non-translation headers stay unmapped; a bilingual header of the ENGLISH column stays English', () => {
  for (const header of ['Owner (Arabic)', 'Calendar', 'Arabic', 'عربي', 'المسؤول', 'Notes AR']) {
    const tr = parse(twoSheets({ hHeaders: [...H_HEADERS, header], hRows: hWith(() => 'نص تجريبي') }));
    for (const x of tr.tasks) for (const f of AR) assert.equal(x[f], '', `${header}: ${x.wbs}.${f}`);
    assert.equal(byWbs(tr)['1.1.1'].owner, 'Owner One', `${header}: owner untouched`);
  }
  // 'المهمة / Task' as the ENGLISH column's header (bilingual header): still the task.
  const hHeaders = H_HEADERS.map((h) => (h === 'Task / Deliverable' ? 'Task / المهمة' : h));
  const t = byWbs(parse(twoSheets({ hHeaders })));
  assert.equal(t['3.1.1'].task, 'Only in the hierarchical sheet');
  assert.equal(t['3.1.1'].taskAr, '');
});

test('an Arabic column placed BEFORE the English one never takes the English field', () => {
  // Hierarchical: Arabic task column inserted right before 'Task / Deliverable'.
  const at = H_HEADERS.indexOf('Task / Deliverable');
  const hHeaders = [...H_HEADERS.slice(0, at), 'Task / Deliverable (Arabic)', ...H_HEADERS.slice(at)];
  const hRows = H_ROWS.map((r) => [...r.slice(0, at), H_TASK_AR[r[0]], ...r.slice(at)]);
  // Portfolio: Arabic track / milestone FIRST.
  const pHeaders = ['المسار', 'المرحلة', ...P_HEADERS];
  const pRows = P_ROWS.map((r, i) => [...P_GROUP_AR[i], ...r]);
  const tr = parse(twoSheets({ hHeaders, hRows, pHeaders, pRows }));
  const t = byWbs(tr);
  assert.equal(t['1.1.1'].task, 'Set up the synthetic steering group');
  assert.equal(t['1.1.1'].taskAr, 'تشكيل لجنة تجريبية');
  assert.deepEqual([t['1.1.1'].track, t['1.1.1'].trackAr, t['1.1.1'].milestone, t['1.1.1'].milestoneAr],
    ['Track A', 'المسار أ', 'Milestone Two', 'المرحلة الثانية']);
  assert.equal(tr.tasks.length, 8);
});

test('taskAr keeps the author\'s line breaks (multi-line, like task); group Arabic is one line', () => {
  const t = byWbs(parse(twoSheets({
    hHeaders: [...H_HEADERS, 'Task (Arabic)'],
    hRows: hWith((wbs) => (wbs === '1.1.1' ? '  السطر   الأول \r\nالسطر الثاني  ' : '')),
    pHeaders: [...P_HEADERS, 'Track (Arabic)'],
    pRows: pWith((i) => [i === 0 ? ' مسار\nبسطرين ' : null]),
  })));
  assert.equal(t['1.1.1'].taskAr, 'السطر الأول\nالسطر الثاني');
  assert.equal(t['2.1.1'].trackAr, 'مسار بسطرين');
});

test('Arabic columns in a ONE-sheet workbook (Portfolio only / Hierarchical only)', () => {
  const pOnly = byWbs(parse(workbookBytes(XLSX, [['Portfolio Tracker', portfolioSheet(XLSX,
    pWith((i, wbs) => [...P_GROUP_AR[i], P_TASK_AR[wbs]]),
    { headers: [...P_HEADERS, 'Portfolio Track (Arabic)', 'Milestone (Arabic)', 'Task / Deliverable (Arabic)'] })]])));
  assert.deepEqual([pOnly['1.2.1'].taskAr, pOnly['1.2.1'].trackAr, pOnly['1.2.1'].milestoneAr],
    ['عقد اجتماع تجريبي', 'المسار أ', 'المرحلة الأولى']);
  const hOnly = byWbs(parse(workbookBytes(XLSX, [['Hierarchical Tracker', hierarchicalSheet(XLSX,
    hWith((wbs) => H_TASK_AR[wbs]), { headers: [...H_HEADERS, 'المهمة'] })]])));
  assert.equal(hOnly['2.2.1'].taskAr, 'تكامل نظام تجريبي');
});

// ---- document helpers ---------------------------------------------------------------------

test('normalizeProjectTracker keeps the translations; an old document without them gets \'\'', () => {
  const task = { id: '1.1.1', wbs: '1.1.1', task: 'Synthetic task', taskAr: 'مهمة تجريبية', trackAr: 'مسار', milestoneAr: 'مرحلة', track: 'T', milestone: 'M' };
  const n = normalizeProjectTracker({ format: TRACKER_FORMAT, loadedAt: NOW, tasks: [task] });
  assert.deepEqual([n.tasks[0].taskAr, n.tasks[0].trackAr, n.tasks[0].milestoneAr], ['مهمة تجريبية', 'مسار', 'مرحلة']);
  assert.equal(n.tasks[0].task, 'Synthetic task');
  // A cache written before the fields existed (exactly the 17 pre-2026-10-13 keys).
  const old = {};
  for (const f of TASK_FIELDS.filter((x) => !AR.includes(x))) old[f] = '';
  Object.assign(old, { id: '2.1.1', wbs: '2.1.1', task: 'Old cached task' });
  const o = normalizeProjectTracker({ format: TRACKER_FORMAT, loadedAt: NOW, tasks: [old] });
  assert.deepEqual(Object.keys(o.tasks[0]).sort(), [...TASK_FIELDS].sort());
  for (const f of AR) assert.equal(o.tasks[0][f], '', f);
  // Non-strings are coerced like every other field.
  const c = normalizeProjectTracker({ format: TRACKER_FORMAT, tasks: [{ id: 'x', taskAr: 7, trackAr: null, milestoneAr: { a: 1 } }] });
  assert.deepEqual([c.tasks[0].taskAr, c.tasks[0].trackAr, c.tasks[0].milestoneAr], ['7', '', '']);
  // A parsed document is a fixed point.
  const tr = parse(twoSheets({ hHeaders: [...H_HEADERS, 'المهمة'], hRows: hWith((w) => H_TASK_AR[w]) }));
  assert.deepEqual(normalizeProjectTracker(tr), tr);
  assert.deepEqual(JSON.parse(JSON.stringify(tr)), tr, 'JSON-safe');
});

test('backfillTaskFields: adds only the missing keys, in place, and touches nothing else', () => {
  const doc = {
    format: TRACKER_FORMAT, loadedAt: NOW, extra: 1,
    tasks: [{ id: 'a', task: 'Synthetic', _ui: true }, { id: 'b', taskAr: 'موجود' }, null],
  };
  assert.equal(backfillTaskFields(doc), 2);
  assert.equal(doc.tasks[0].taskAr, '');
  assert.equal(doc.tasks[0].trackAr, '');
  assert.equal(doc.tasks[0]._ui, true, 'unknown keys kept (not a normalize)');
  assert.equal(doc.tasks[1].taskAr, 'موجود', 'a present value is never overwritten');
  assert.equal(doc.tasks[2], null);
  assert.equal(doc.extra, 1);
  assert.equal(backfillTaskFields(doc), 0, 'idempotent');
  assert.equal(backfillTaskFields({ tasks: [{}] }), 0, 'untagged → nothing');
  assert.equal(backfillTaskFields(null), 0);
});

test('newTask carries the translation fields as \'\'', () => {
  const t = newTask([]);
  for (const f of AR) assert.equal(t[f], '', f);
  assert.deepEqual(Object.keys(t).sort(), [...TASK_FIELDS].sort());
});

// ---- trackerLang -------------------------------------------------------------------------

test('trackerLang enum: ar | en | both, default ar = the seed, tolerant normalizer', () => {
  assert.deepEqual([...TRACKER_LANGS], ['ar', 'en', 'both']);
  assert.equal(DEFAULT_TRACKER_LANG, 'ar');
  assert.equal(REPORT_OPTIONS_SEED.trackerLang, DEFAULT_TRACKER_LANG, 'the seed is the enum owner\'s default');
  for (const v of TRACKER_LANGS) assert.equal(normalizeTrackerLang(v), v);
  assert.equal(normalizeTrackerLang(' Both '), 'both');
  assert.equal(normalizeTrackerLang('EN'), 'en');
  for (const bad of ['', 'arabic', 'fr', null, undefined, 1, true, ['ar'], { ar: 1 }]) {
    assert.equal(normalizeTrackerLang(bad), null, String(bad));
  }
});
