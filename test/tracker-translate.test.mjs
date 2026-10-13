// test/tracker-translate.test.mjs — `node --test test/tracker-translate.test.mjs`
//
// THE AUTOMATIC ARABIC for the project tracker (src/model/tracker-translate.js), 2026-10-13:
// the user uploads their NORMAL English tracker and the tasks come out in Arabic, filled
// from translation memories keyed by the English text, with the English one switch away.
//   • normEn: case / whitespace / invisible-mark tolerant key;
//   • precedence file > user > builtin > machine > '' with the source recorded per text;
//   • an UNAVAILABLE layer keeps what it filled before; an available layer that lacks the
//     key drops it (a cleared correction falls back);
//   • showOriginal from the user TM; nothing passed in is mutated;
//   • the editor helpers (setUserTranslation / setOriginal / addMachineTranslations), the
//     glossary post-pass (conservative), the bounds and the import merge;
//   • normalizeProjectTracker keeps the bookkeeping (and only meaningful values);
//   • the slides honour showOriginal; 'en' is byte-identical with or without any of it.
// SYNTHETIC text only (public repo) — never the user's workbook rows or their translations.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normEn, applyTrackerTranslations, AR_SOURCES, AR_SOURCE_FIELDS, TRANSLATED_KINDS,
  sanitizeTranslationMemory, emptyTranslationMemory, mergeTranslationMemory, translationMemorySize,
  setUserTranslation, setOriginal, addMachineTranslations, machineGlossary, KEEP_TERMS,
  trackerTranslationStats, collectUntranslated, sanitizeEntries,
  TM_ENTRY_LIMIT, TM_KEY_MAX, TM_VALUE_MAX,
} from '../src/model/tracker-translate.js';
import {
  normalizeProjectTracker, TASK_FIELDS, TASK_AR_SOURCES, TRACKER_FORMAT, newTask,
} from '../src/ingest/task-tracker.js';
import { buildTrackerSlides } from '../src/slidespec/build-tracker.js';

let seq = 0;
function task(o = {}) {
  seq += 1;
  const t = {};
  for (const f of TASK_FIELDS) t[f] = '';
  return {
    ...t, id: `s${seq}`, wbs: `9.${seq}`, track: 'Synthetic Track', milestone: 'Synthetic Stage',
    task: `Synthetic task ${seq}`, organization: 'LEAN', owner: 'Owner Z', priority: 'High',
    status: 'In Progress', due: '2026-09-01', ...o,
  };
}
const tracker = (tasks) => ({
  format: TRACKER_FORMAT, fileName: 'synthetic.xlsx', loadedAt: '2026-10-13T00:00:00.000Z',
  editedAt: null, warnings: [], tasks,
});
const deepFreeze = (o) => {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
};

// ---- normEn ---------------------------------------------------------------------------------

test('normEn: trims, collapses every whitespace run (doubled spaces, NBSP, line breaks), lower-cases', () => {
  assert.equal(normEn('  Prepare  the Synthetic Plan \n'), 'prepare the synthetic plan');
  assert.equal(normEn('Line one\r\n\tline  TWO'), 'line one line two');
  assert.equal(normEn('Zero​Width‎ mark﻿'), 'zerowidth mark', 'invisible marks removed, not spaced');
  assert.equal(normEn('ABC'), normEn(' abc '));
  for (const v of [null, undefined, {}, [], true]) assert.equal(normEn(v), '');
  assert.equal(normEn(12), '12');
});

// ---- precedence + sources -------------------------------------------------------------------

const USER = {
  tasks: { [normEn('Synthetic alpha')]: 'ألفا من المستخدم' },
  tracks: {}, milestones: {}, original: {},
};
const BUILTIN = {
  generatedAt: 'x',
  entries: {
    tasks: { [normEn('Synthetic alpha')]: 'ألفا معتمدة', [normEn('Synthetic beta')]: 'بيتا معتمدة' },
    tracks: { [normEn('Synthetic Track')]: 'مسار تجريبي' },
    milestones: { [normEn('Synthetic Stage')]: 'مرحلة تجريبية' },
  },
};
const MACHINE = {
  tasks: { [normEn('Synthetic beta')]: 'بيتا آلية', [normEn('Synthetic gamma')]: 'جاما آلية' },
  tracks: {}, milestones: {},
};

test('precedence: file column > user > builtin > machine > \'\' — and the source is recorded', () => {
  const tr = deepFreeze(tracker([
    task({ task: 'Synthetic alpha', taskAr: 'ألفا من الملف' }), // file wins over everything
    task({ task: 'Synthetic  ALPHA ' }), // user (whitespace / case tolerant key)
    task({ task: 'Synthetic beta' }), // builtin beats machine
    task({ task: 'Synthetic gamma' }), // machine only
    task({ task: 'Synthetic delta' }), // nothing → English
  ]));
  const out = applyTrackerTranslations(tr, { user: USER, builtin: BUILTIN, machine: MACHINE });
  assert.notEqual(out, tr);
  const got = out.tasks.map((t) => [t.taskAr, t.taskArSource]);
  assert.deepEqual(got, [
    ['ألفا من الملف', 'file'], ['ألفا من المستخدم', 'user'], ['بيتا معتمدة', 'builtin'],
    ['جاما آلية', 'machine'], ['', ''],
  ]);
  for (const t of out.tasks) {
    assert.equal(t.trackAr, 'مسار تجريبي');
    assert.equal(t.trackArSource, 'builtin');
    assert.equal(t.milestoneAr, 'مرحلة تجريبية');
    assert.equal(t.milestoneArSource, 'builtin');
    assert.equal(t.showOriginal, false);
  }
  // The English is never touched.
  assert.deepEqual(out.tasks.map((t) => t.task), tr.tasks.map((t) => t.task));
  assert.equal(tr.tasks[1].taskAr, '', 'the input is not mutated (frozen — a write would throw)');
});

test('builtin accepts the loader\'s {generatedAt, entries} or the bare maps; machine defaults to user.machine', () => {
  const tr = tracker([task({ task: 'Synthetic beta' }), task({ task: 'Synthetic gamma' })]);
  const a = applyTrackerTranslations(tr, { builtin: BUILTIN.entries });
  assert.equal(a.tasks[0].taskAr, 'بيتا معتمدة');
  const b = applyTrackerTranslations(tr, { user: { ...emptyTranslationMemory(), machine: MACHINE } });
  assert.deepEqual(b.tasks.map((t) => t.taskArSource), ['machine', 'machine']);
  const c = applyTrackerTranslations(tr, { user: { ...emptyTranslationMemory(), machine: MACHINE }, machine: null });
  assert.deepEqual(c.tasks.map((t) => t.taskArSource), ['', ''], 'an explicit machine:null wins');
});

test('re-apply is stable, and a TM fill is replaced when a better layer arrives (never treated as file)', () => {
  const tr = tracker([task({ task: 'Synthetic beta' })]);
  const once = applyTrackerTranslations(tr, { machine: MACHINE });
  assert.equal(once.tasks[0].taskArSource, 'machine');
  const twice = applyTrackerTranslations(once, { machine: MACHINE });
  assert.deepEqual(twice, once, 'idempotent');
  const better = applyTrackerTranslations(once, { builtin: BUILTIN, machine: MACHINE });
  assert.deepEqual([better.tasks[0].taskAr, better.tasks[0].taskArSource], ['بيتا معتمدة', 'builtin']);
});

test('an UNAVAILABLE layer keeps its earlier fill; an available layer without the key drops it', () => {
  const tr = tracker([task({ task: 'Synthetic beta' })]);
  const filled = applyTrackerTranslations(tr, { builtin: BUILTIN });
  // Built-in TM not loaded yet this session (null): the cached Arabic must not flash to English.
  const loading = applyTrackerTranslations(filled, { builtin: null, user: emptyTranslationMemory() });
  assert.deepEqual([loading.tasks[0].taskAr, loading.tasks[0].taskArSource], ['بيتا معتمدة', 'builtin']);
  // Loaded, and it no longer has the entry → falls through to machine, then ''.
  const gone = applyTrackerTranslations(filled, { builtin: { entries: { tasks: {} } } });
  assert.deepEqual([gone.tasks[0].taskAr, gone.tasks[0].taskArSource], ['', '']);
  const toMachine = applyTrackerTranslations(filled, { builtin: { tasks: {} }, machine: MACHINE });
  assert.equal(toMachine.tasks[0].taskArSource, 'machine');
});

test('a user correction wins over builtin; clearing it (TM entry removed) falls back to builtin', () => {
  const tr = tracker([task({ task: 'Synthetic beta' })]);
  let tm = setUserTranslation(emptyTranslationMemory(), 'task', 'Synthetic beta', 'تصحيحي');
  const edited = applyTrackerTranslations(tr, { user: tm, builtin: BUILTIN });
  assert.deepEqual([edited.tasks[0].taskAr, edited.tasks[0].taskArSource], ['تصحيحي', 'user']);
  // The correction survives a RE-UPLOAD: a freshly parsed tracker (no Arabic) gets it again.
  const reupload = applyTrackerTranslations(tracker([task({ task: '  synthetic   Beta' })]), { user: tm, builtin: BUILTIN });
  assert.equal(reupload.tasks[0].taskAr, 'تصحيحي');
  tm = setUserTranslation(tm, 'taskAr', 'Synthetic beta', '   ');
  assert.deepEqual(tm.tasks, {}, 'empty Arabic removes the user entry');
  const cleared = applyTrackerTranslations(edited, { user: tm, builtin: BUILTIN });
  assert.deepEqual([cleared.tasks[0].taskAr, cleared.tasks[0].taskArSource], ['بيتا معتمدة', 'builtin']);
});

test('a cleared FILE Arabic falls back to the memories; a row with no English keeps its typed Arabic', () => {
  const tr = tracker([
    task({ task: 'Synthetic beta', taskAr: '', taskArSource: 'file' }),
    task({ task: '', taskAr: 'عربي فقط', taskArSource: 'user' }),
  ]);
  const out = applyTrackerTranslations(tr, { user: emptyTranslationMemory(), builtin: BUILTIN });
  assert.deepEqual([out.tasks[0].taskAr, out.tasks[0].taskArSource], ['بيتا معتمدة', 'builtin']);
  assert.deepEqual([out.tasks[1].taskAr, out.tasks[1].taskArSource], ['عربي فقط', 'user']);
});

test('track / milestone follow the same layers, each with its own source', () => {
  const tm = setUserTranslation(emptyTranslationMemory(), 'tracks', 'Synthetic Track', 'مساري');
  const out = applyTrackerTranslations(tracker([task({ milestoneAr: 'مرحلة الملف' })]), { user: tm, builtin: BUILTIN });
  const t = out.tasks[0];
  assert.deepEqual([t.trackAr, t.trackArSource, t.milestoneAr, t.milestoneArSource], ['مساري', 'user', 'مرحلة الملف', 'file']);
});

test('showOriginal: the user TM decides when given; without it the task keeps its flag', () => {
  const tr = tracker([task({ task: 'Synthetic alpha' }), task({ task: 'Synthetic beta', showOriginal: true })]);
  const tm = setOriginal(emptyTranslationMemory(), ' synthetic ALPHA', true);
  const out = applyTrackerTranslations(tr, { user: tm, builtin: BUILTIN });
  assert.deepEqual(out.tasks.map((t) => t.showOriginal), [true, false]);
  assert.equal(out.tasks[0].taskAr, 'ألفا معتمدة', 'the Arabic stays — only the slide shows the English');
  const noTm = applyTrackerTranslations(tr, { builtin: BUILTIN });
  assert.deepEqual(noTm.tasks.map((t) => t.showOriginal), [false, true]);
  const off = setOriginal(tm, 'Synthetic alpha', false);
  assert.deepEqual(off.original, {});
});

test('not a tracker / junk tasks pass through untouched', () => {
  assert.equal(applyTrackerTranslations(null), null);
  const odd = { format: TRACKER_FORMAT };
  assert.equal(applyTrackerTranslations(odd), odd);
  const out = applyTrackerTranslations(tracker([null, task({ task: 'Synthetic beta' })]), { builtin: BUILTIN });
  assert.equal(out.tasks[0], null);
  assert.equal(out.tasks[1].taskAr, 'بيتا معتمدة');
});

// ---- stats + the machine pass's input -------------------------------------------------------

test('trackerTranslationStats counts tasks with text, translated by source, showOriginal', () => {
  const out = applyTrackerTranslations(tracker([
    task({ task: 'Synthetic alpha', taskAr: 'ملف' }), task({ task: 'Synthetic beta' }),
    task({ task: 'Synthetic gamma' }), task({ task: 'Synthetic delta' }),
    task({ task: '', taskAr: '', track: '' }), // a blank added row: not counted
  ]), { user: setOriginal(emptyTranslationMemory(), 'Synthetic beta', true), builtin: BUILTIN, machine: MACHINE });
  assert.deepEqual(trackerTranslationStats(out), {
    total: 4, translated: 3, untranslated: 1, showOriginal: 1,
    bySource: { file: 1, user: 0, builtin: 1, machine: 1 },
  });
  assert.deepEqual(trackerTranslationStats(null).total, 0);
});

test('collectUntranslated lists each untranslated English text once, original spelling, in order', () => {
  const tr = tracker([
    task({ task: 'Synthetic delta', track: 'Track Q', milestone: '' }),
    task({ task: '  synthetic   DELTA ', track: 'Track Q', milestone: 'Stage Q' }),
    task({ task: 'Synthetic epsilon', taskAr: 'موجود', track: 'Track Q', trackAr: 'مسار', milestone: 'Stage Q' }),
  ]);
  assert.deepEqual(collectUntranslated(tr), {
    tasks: ['Synthetic delta'], tracks: ['Track Q'], milestones: ['Stage Q'],
  });
  assert.deepEqual(collectUntranslated(null), { tasks: [], tracks: [], milestones: [] });
});

// ---- machine cache + glossary ---------------------------------------------------------------

test('addMachineTranslations: keys normalised, glossary applied with the English source, empties skipped', () => {
  const tm = addMachineTranslations(emptyTranslationMemory(), {
    tasks: { 'Deploy MISBAR for NUPCO': 'نشر MISBAR لصالح نوبكو', 'Synthetic  empty': '  ' },
    track: { 'Track Q': 'المسار ق' }, // field-name kinds are accepted too
    bogus: { x: 'y' },
  });
  assert.deepEqual(tm.machine.tasks, { 'deploy misbar for nupco': 'نشر مسبار لصالح NUPCO' });
  assert.deepEqual(tm.machine.tracks, { 'track q': 'المسار ق' });
  assert.deepEqual(tm.tasks, {}, 'machine output never lands in the user layer');
  const out = applyTrackerTranslations(tracker([task({ task: 'deploy misbar for NUPCO' })]), { user: tm });
  assert.deepEqual([out.tasks[0].taskAr, out.tasks[0].taskArSource], ['نشر مسبار لصالح NUPCO', 'machine']);
});

test('machineGlossary: MISBAR → مسبار; kept acronyms restored only when the English has them', () => {
  assert.equal(machineGlossary('تقرير Misbar اليومي'), 'تقرير مسبار اليومي');
  assert.equal(machineGlossary('منصة ميسبار وميزبار'), 'منصة مسبار ومسبار');
  assert.equal(machineGlossary('مراجعة Moh و zatca', 'Review MOH and ZATCA'), 'مراجعة MOH و ZATCA');
  assert.equal(machineGlossary('تقرير لنوبكو', 'Report for NUPCO'), 'تقرير لNUPCO');
  assert.equal(machineGlossary('تسليم زاتكا', 'ZATCA handover'), 'تسليم ZATCA');
  // Conservative: no term in the source → nothing rewritten.
  assert.equal(machineGlossary('تقرير نوبكو', 'Weekly report'), 'تقرير نوبكو');
  assert.equal(machineGlossary('Moh tat', 'unrelated'), 'Moh tat');
  // A term inside a longer word is not a term.
  assert.equal(machineGlossary('catalog lean-ish', 'CAB LEAN'), 'catalog LEAN-ish');
  // An ordinary lower-case English word that spells an acronym is not a kept term.
  assert.equal(machineGlossary('سيارة cab', 'Book a cab'), 'سيارة cab');
  assert.equal(machineGlossary('Nupco و moh', 'nupco moh'), 'Nupco و moh');
  assert.equal(machineGlossary('تقرير نوبكو', 'nupco report'), 'تقرير نوبكو');
  assert.equal(machineGlossary('مستنوبكوات', 'NUPCO'), 'مستنوبكوات');
  // An expansion is a correct translation and is left alone.
  assert.equal(machineGlossary('وزارة الصحة', 'MOH'), 'وزارة الصحة');
  assert.equal(machineGlossary(''), '');
  assert.equal(machineGlossary(null), '');
  assert.ok(KEEP_TERMS.includes('NUPCO') && KEEP_TERMS.includes('SGH') && KEEP_TERMS.length === 11);
});

// ---- memory shape, bounds, merge ------------------------------------------------------------

test('sanitizeTranslationMemory: full shape, keys re-normalised, junk dropped', () => {
  assert.deepEqual(sanitizeTranslationMemory(null), emptyTranslationMemory());
  const tm = sanitizeTranslationMemory({
    tasks: { '  Raw  KEY ': ' عربي ', empty: '', num: 5, '': 'x' },
    tracks: [], original: { 'Some Task': true, other: 'yes' },
    machine: { tasks: { A: 'أ' }, junk: { b: 'ب' } }, extra: { x: 1 },
  });
  assert.deepEqual(tm, {
    tasks: { 'raw key': 'عربي' }, tracks: {}, milestones: {}, original: { 'some task': true },
    machine: { tasks: { a: 'أ' }, tracks: {}, milestones: {} },
  });
  assert.equal(translationMemorySize(tm), 3);
  assert.deepEqual(sanitizeEntries({ entries: { tasks: { A: 'أ' } } }), { tasks: { a: 'أ' }, tracks: {}, milestones: {} });
});

test('bounds: oversized keys / values dropped, entry cap enforced on every write path', () => {
  const longKey = 'k'.repeat(TM_KEY_MAX + 1);
  const longVal = 'ع'.repeat(TM_VALUE_MAX + 1);
  assert.deepEqual(sanitizeTranslationMemory({ tasks: { [longKey]: 'ع', ok: longVal } }).tasks, {});
  assert.deepEqual(setUserTranslation(null, 'tasks', longKey, 'ع').tasks, {});
  const big = {};
  for (let i = 0; i < TM_ENTRY_LIMIT + 5; i++) big[`synthetic ${i}`] = 'ع';
  const capped = sanitizeTranslationMemory({ tasks: big });
  assert.equal(Object.keys(capped.tasks).length, TM_ENTRY_LIMIT);
  assert.equal(Object.keys(setUserTranslation(capped, 'tasks', 'one more', 'ع').tasks).length, TM_ENTRY_LIMIT);
  assert.equal(setUserTranslation(capped, 'tasks', 'synthetic 3', 'جديد').tasks['synthetic 3'], 'جديد', 'an existing key still updates at the cap');
  assert.deepEqual(setUserTranslation(null, 'nope', 'a', 'ب'), emptyTranslationMemory(), 'unknown kind → unchanged');
});

test('mergeTranslationMemory: union, the incoming side wins per key, base trimmed first at the cap', () => {
  const base = { tasks: { a: 'قديم', b: 'ب' }, original: { a: true }, machine: { tasks: { m: 'م' } } };
  const over = { tasks: { a: 'جديد', c: 'ج' }, machine: { tasks: { n: 'ن' } } };
  const m = mergeTranslationMemory(base, over);
  assert.deepEqual(m.tasks, { a: 'جديد', c: 'ج', b: 'ب' });
  assert.deepEqual(m.original, { a: true });
  assert.deepEqual(m.machine.tasks, { n: 'ن', m: 'م' });
  const full = {};
  for (let i = 0; i < TM_ENTRY_LIMIT; i++) full[`o${i}`] = 'ع';
  const capped = mergeTranslationMemory({ tasks: { basekey: 'ب' } }, { tasks: full });
  assert.equal(Object.keys(capped.tasks).length, TM_ENTRY_LIMIT);
  assert.ok(!('basekey' in capped.tasks), 'the base\'s extra key is the one trimmed');
});

// ---- the document shape (ingest/task-tracker.js) --------------------------------------------

test('TASK_AR_SOURCES (task-tracker.js) equals AR_SOURCES; source fields follow TRANSLATED_KINDS', () => {
  assert.deepEqual([...TASK_AR_SOURCES], [...AR_SOURCES]);
  assert.deepEqual([...AR_SOURCE_FIELDS], ['taskArSource', 'trackArSource', 'milestoneArSource']);
  for (const k of TRANSLATED_KINDS) assert.ok(TASK_FIELDS.includes(k.en) && TASK_FIELDS.includes(k.ar));
});

test('normalizeProjectTracker keeps sources beside Arabic text and showOriginal:true — nothing else', () => {
  const applied = applyTrackerTranslations(tracker([
    task({ task: 'Synthetic beta' }), task({ task: 'Synthetic delta' }),
  ]), { user: setOriginal(emptyTranslationMemory(), 'Synthetic beta', true), builtin: BUILTIN });
  const n = normalizeProjectTracker(applied);
  assert.equal(n.tasks[0].taskArSource, 'builtin');
  assert.equal(n.tasks[0].showOriginal, true);
  assert.equal(n.tasks[0].trackArSource, 'builtin');
  // Untranslated task: '' source and false flag are NOT persisted (keys stay exactly as before)…
  assert.ok(!('taskArSource' in n.tasks[1]));
  assert.ok(!('showOriginal' in n.tasks[1]));
  // …and its group sources are (it has the Arabic group labels).
  assert.equal(n.tasks[1].milestoneArSource, 'builtin');
  // A source without Arabic text, an unknown source, a truthy-but-not-true flag: dropped.
  const odd = normalizeProjectTracker(tracker([task({ taskArSource: 'builtin', trackAr: 'م', trackArSource: 'robot', showOriginal: 'yes' })]));
  assert.deepEqual(Object.keys(odd.tasks[0]).sort(), [...TASK_FIELDS].sort());
  // A tracker without any bookkeeping normalizes to exactly TASK_FIELDS (unchanged behaviour).
  assert.deepEqual(Object.keys(normalizeProjectTracker(tracker([task()])).tasks[0]).sort(), [...TASK_FIELDS].sort());
  assert.deepEqual(Object.keys(newTask([])).sort(), [...TASK_FIELDS].sort());
  // Round trip: normalize → apply again → the same Arabic and sources.
  const again = applyTrackerTranslations(n, { user: setOriginal(emptyTranslationMemory(), 'Synthetic beta', true), builtin: BUILTIN });
  assert.deepEqual(normalizeProjectTracker(again), n);
});

// ---- slides: showOriginal -------------------------------------------------------------------

const cellTexts = (slides) => JSON.stringify(slides.map((s) => s.elements));

test('slides: showOriginal prints that task in English in \'ar\' and \'both\'; groups stay Arabic', () => {
  const base = applyTrackerTranslations(tracker([
    task({ task: 'Synthetic alpha' }), task({ task: 'Synthetic beta' }),
  ]), { builtin: BUILTIN });
  const flagged = { ...base, tasks: [{ ...base.tasks[0], showOriginal: true }, base.tasks[1]] };
  for (const lang of ['ar', 'both']) {
    const plain = cellTexts(buildTrackerSlides(base, { reportDate: '2026-10-13', lang }));
    const flip = cellTexts(buildTrackerSlides(flagged, { reportDate: '2026-10-13', lang }));
    assert.ok(plain.includes('ألفا معتمدة'), `${lang}: Arabic by default`);
    assert.ok(!flip.includes('ألفا معتمدة'), `${lang}: the flagged task's Arabic is not printed`);
    assert.ok(flip.includes('Synthetic alpha'), `${lang}: its English is`);
    assert.ok(flip.includes('بيتا معتمدة'), `${lang}: the other task stays Arabic`);
    assert.ok(flip.includes('مسار تجريبي'), `${lang}: group labels stay Arabic`);
  }
  // Same as a row that simply has no translation.
  const untranslated = { ...base, tasks: [{ ...base.tasks[0], taskAr: '', taskArSource: '' }, base.tasks[1]] };
  assert.equal(
    cellTexts(buildTrackerSlides(flagged, { reportDate: '2026-10-13', lang: 'ar' })),
    cellTexts(buildTrackerSlides(untranslated, { reportDate: '2026-10-13', lang: 'ar' })),
  );
});

test('slides: \'en\' is byte-identical with or without translations, sources and showOriginal', () => {
  const raw = tracker([task({ task: 'Synthetic alpha' }), task({ task: 'Synthetic beta' })]);
  const applied = applyTrackerTranslations(raw, { user: setOriginal(emptyTranslationMemory(), 'Synthetic alpha', true), builtin: BUILTIN });
  const a = buildTrackerSlides(raw, { reportDate: '2026-10-13', lang: 'en' });
  const b = buildTrackerSlides(applied, { reportDate: '2026-10-13', lang: 'en' });
  assert.equal(JSON.stringify(b), JSON.stringify(a));
});
