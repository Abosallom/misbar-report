// test/tracker-translate-names.test.mjs — `node --test test/tracker-translate-names.test.mjs`
//
// NAME TRANSLATIONS for the tracker's owner («المسؤول») and entity («الجهة») columns
// (src/model/tracker-translate.js NAME_KINDS, the user's rule 5, 2026-10-18):
//   • the user and built-in TM layers carry owners / entities maps (sanitize / merge / size /
//     caps), the machine layer never does — a name is never machine-translated;
//   • applyTrackerTranslations fills ownerAr / organizationAr (+ sources) PER '/'-separated
//     part, case / space-insensitive, an unmapped part kept as written, joined ' / ';
//   • an unavailable layer keeps the parts it filled before; nothing passed in is mutated;
//   • normalizeProjectTracker keeps the new fields (with a valid source only);
//   • the loader and the build script carry owners / entities.
// SYNTHETIC names only (public repo) — never the user's staff names or their Arabic.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyTrackerTranslations, NAME_KINDS, NAME_SEPARATOR, splitNameParts, formatNameParts,
  trackerNameEntries, setUserTranslation, addMachineTranslations, emptyTranslationMemory,
  sanitizeTranslationMemory, mergeTranslationMemory, translationMemorySize, sanitizeEntries,
  collectUntranslated, trackerTranslationStats, TM_ENTRY_LIMIT, TM_VALUE_MAX, NAME_BASIS_FIELDS,
} from '../src/model/tracker-translate.js';
import { normalizeProjectTracker, TASK_FIELDS, TRACKER_FORMAT } from '../src/ingest/task-tracker.js';
import { fetchTrackerTranslations } from '../src/ingest/tracker-translations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'build-tracker-translations.mjs');
const KEY = 'e'.repeat(64);

let seq = 0;
function task(o = {}) {
  seq += 1;
  const t = {};
  for (const f of TASK_FIELDS) t[f] = '';
  return { ...t, id: `n${seq}`, wbs: `7.${seq}`, task: `Synthetic named task ${seq}`, ...o };
}
const tracker = (tasks) => ({
  format: TRACKER_FORMAT, fileName: 'synthetic.xlsx', loadedAt: '2026-10-18T00:00:00.000Z',
  editedAt: null, warnings: [], tasks,
});
const deepFreeze = (o) => {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
};
const names = (t) => [t.ownerAr, t.ownerArSource, t.organizationAr, t.organizationArSource];

const BUILTIN = {
  generatedAt: 'g',
  entries: {
    tasks: {}, tracks: {}, milestones: {},
    owners: { 'alpha one': 'ألفا الأول', alpha: 'ألفا', beta: 'بيتا', 'gamma zed': 'جاما زد' },
    entities: { orgx: 'أورج إكس', orgy: 'أورج واي' },
  },
};

// ---- splitting / formatting ---------------------------------------------------------------

test('splitNameParts: split on "/", whitespace + invisible marks cleaned, empty parts dropped, case kept', () => {
  assert.deepEqual(splitNameParts('Alpha/Beta'), ['Alpha', 'Beta']);
  assert.deepEqual(splitNameParts('  Alpha   One /  beta//  '), ['Alpha One', 'beta']);
  assert.deepEqual(splitNameParts('Al​pha One'), ['Alpha One']);
  assert.deepEqual(splitNameParts(''), []);
  for (const v of [null, undefined, {}, [], true]) assert.deepEqual(splitNameParts(v), []);
  assert.equal(NAME_SEPARATOR, ' / ');
  assert.equal(formatNameParts('Alpha/Beta /Gamma'), 'Alpha / Beta / Gamma');
  assert.equal(formatNameParts('Solo'), 'Solo');
  assert.equal(formatNameParts(null), '');
});

// ---- applying -----------------------------------------------------------------------------

test('built-in owners / entities: per part, case/space-insensitive, unmapped part kept, joined " / "', () => {
  const tr = deepFreeze(tracker([
    task({ owner: 'Alpha One', organization: 'ORGX' }),
    task({ owner: 'alpha/BETA/  Unknown  Person', organization: 'orgx /OrgY' }),
    task({ owner: '  ALPHA   one ', organization: 'Unlisted Org' }),
    task({ owner: 'Nobody / Nemo', organization: '' }),
    task({ owner: '', organization: '/' }),
  ]));
  const before = JSON.stringify(tr);
  const out = applyTrackerTranslations(tr, { user: emptyTranslationMemory(), builtin: BUILTIN });
  assert.equal(JSON.stringify(tr), before, 'the input is not mutated');
  assert.deepEqual(out.tasks.map(names), [
    ['ألفا الأول', 'builtin', 'أورج إكس', 'builtin'],
    ['ألفا / بيتا / Unknown Person', 'builtin', 'أورج إكس / أورج واي', 'builtin'],
    ['ألفا الأول', 'builtin', '', ''],
    ['', '', '', ''],
    ['', '', '', ''],
  ]);
  // The English is never touched.
  assert.deepEqual(out.tasks.map((t) => t.owner), tr.tasks.map((t) => t.owner));
  assert.deepEqual(out.tasks.map((t) => t.organization), tr.tasks.map((t) => t.organization));
});

test('a multi-name full name maps as ONE part; a single first name maps on its own', () => {
  const out = applyTrackerTranslations(tracker([
    task({ owner: 'Gamma Zed / Alpha' }), task({ owner: 'Gamma' }),
  ]), { builtin: BUILTIN });
  assert.deepEqual(out.tasks.map((t) => t.ownerAr), ['جاما زد / ألفا', '']);
});

test('the user list wins per part over the built-in; any user part makes the cell "user"', () => {
  let tm = setUserTranslation(emptyTranslationMemory(), 'owners', 'Beta', 'بيتا المستخدم');
  tm = setUserTranslation(tm, 'owner', ' Delta ', 'دلتا');
  tm = setUserTranslation(tm, 'entity', 'ORGX', 'منظمة إكس');
  const out = applyTrackerTranslations(tracker([
    task({ owner: 'Alpha / beta', organization: 'OrgX/OrgY' }),
    task({ owner: 'Alpha', organization: 'OrgY' }),
    task({ owner: 'DELTA', organization: 'Org Z' }),
  ]), { user: tm, builtin: BUILTIN });
  assert.deepEqual(out.tasks.map(names), [
    ['ألفا / بيتا المستخدم', 'user', 'منظمة إكس / أورج واي', 'user'],
    ['ألفا', 'builtin', 'أورج واي', 'builtin'],
    ['دلتا', 'user', '', ''],
  ]);
  // Clearing the user's entry falls back to the built-in on the next apply.
  const cleared = setUserTranslation(tm, 'owners', 'beta', '');
  assert.equal(applyTrackerTranslations(out, { user: cleared, builtin: BUILTIN }).tasks[0].ownerAr, 'ألفا / بيتا');
  // 'organization' / 'organizationAr' / 'ownerAr' are accepted kind spellings too.
  assert.deepEqual(setUserTranslation(null, 'organization', 'Q', 'ق').entities, { q: 'ق' });
  assert.deepEqual(setUserTranslation(null, 'organizationAr', 'Q', 'ق').entities, { q: 'ق' });
  assert.deepEqual(setUserTranslation(null, 'ownerAr', 'Q', 'ق').owners, { q: 'ق' });
});

test('names are NEVER machine-translated: the machine layer / pass ignores them', () => {
  const machine = { tasks: {}, tracks: {}, milestones: {}, owners: { alpha: 'آلي' }, entities: { orgx: 'آلي' } };
  const out = applyTrackerTranslations(tracker([task({ owner: 'Alpha', organization: 'OrgX' })]), { machine });
  assert.deepEqual(names(out.tasks[0]), ['', '', '', '']);
  const tm = addMachineTranslations(emptyTranslationMemory(), { owners: { Alpha: 'آلي' }, entities: { OrgX: 'آلي' }, owner: { Alpha: 'آلي' } });
  assert.deepEqual([tm.owners, tm.entities, Object.keys(tm.machine).sort()], [{}, {}, ['milestones', 'tasks', 'tracks']]);
  assert.deepEqual(sanitizeTranslationMemory({ machine: { owners: { a: 'ب' } } }).machine, { tasks: {}, tracks: {}, milestones: {} });
  // …and the machine pass is never asked for them.
  const untranslated = collectUntranslated(tracker([task({ task: 'T', owner: 'Alpha', organization: 'OrgX' })]));
  assert.deepEqual(Object.keys(untranslated).sort(), ['milestones', 'tasks', 'tracks']);
  assert.ok(!JSON.stringify(untranslated).includes('Alpha'));
  // The status line still counts TASKS only.
  assert.equal(trackerTranslationStats(applyTrackerTranslations(tracker([task({ owner: 'Alpha' })]), { builtin: BUILTIN })).translated, 0);
});

test('an UNAVAILABLE built-in keeps the parts it filled before; an available one that lacks them drops them', () => {
  const filled = applyTrackerTranslations(tracker([
    task({ owner: 'Alpha / Unknown', organization: 'OrgX' }),
  ]), { user: emptyTranslationMemory(), builtin: BUILTIN });
  assert.deepEqual(names(filled.tasks[0]), ['ألفا / Unknown', 'builtin', 'أورج إكس', 'builtin']);
  // Still loading (builtin null): kept, and a user part added meanwhile applies on top.
  const tm = setUserTranslation(emptyTranslationMemory(), 'owners', 'Unknown', 'مجهول');
  const loading = applyTrackerTranslations(filled, { user: tm, builtin: null });
  assert.deepEqual(names(loading.tasks[0]), ['ألفا / مجهول', 'user', 'أورج إكس', 'builtin']);
  // And again while still loading: the user cell keeps its built-in part too.
  const again = applyTrackerTranslations(loading, { user: tm, builtin: null });
  assert.deepEqual(names(again.tasks[0]), ['ألفا / مجهول', 'user', 'أورج إكس', 'builtin']);
  // An available built-in without those keys: the built-in parts go, the user's stays.
  const empty = { entries: { owners: {}, entities: {} } };
  assert.deepEqual(names(applyTrackerTranslations(again, { user: tm, builtin: empty }).tasks[0]),
    ['Alpha / مجهول', 'user', '', '']);
  // The user layer unavailable too: everything previously filled is kept.
  assert.deepEqual(names(applyTrackerTranslations(again, {}).tasks[0]), names(again.tasks[0]));
  // A name added: the kept parts follow their OWN English (matched by key, not position);
  // the user part whose entry is now gone from an available user layer is not kept.
  const edited = { ...again, tasks: [{ ...again.tasks[0], owner: 'Alpha / Unknown / Third' }] };
  assert.deepEqual(names(applyTrackerTranslations(edited, { user: emptyTranslationMemory(), builtin: null }).tasks[0]),
    ['ألفا / Unknown / Third', 'builtin', 'أورج إكس', 'builtin']);
});

// The review round (2026-10-18): a layer that is unavailable keeps ONLY what it filled for
// the SAME English part. Probes from the review, each with the built-in null (loading, or
// never — no data key / a failed fetch / the automation's load failing).
const basisOf = (t) => [t.ownerArBasis, t.organizationArBasis];

test('builtin unavailable: a CLEARED user name falls back to the English, never kept as "builtin"', () => {
  const tm = setUserTranslation(emptyTranslationMemory(), 'owners', 'Alpha', 'ألفا المستخدم');
  const filled = applyTrackerTranslations(tracker([task({ owner: 'Alpha' })]), { user: tm, builtin: null });
  assert.deepEqual(names(filled.tasks[0]), ['ألفا المستخدم', 'user', '', '']);
  assert.deepEqual(basisOf(filled.tasks[0]), ['u:alpha', '']);
  const cleared = setUserTranslation(tm, 'owners', 'Alpha', '');
  const after = applyTrackerTranslations(filled, { user: cleared, builtin: null });
  assert.deepEqual(names(after.tasks[0]), ['', '', '', '']);
  // …and through the store's normalizer too: nothing stale is persisted.
  const cached = normalizeProjectTracker(applyTrackerTranslations(normalizeProjectTracker(filled),
    { user: cleared, builtin: null }));
  assert.ok(!('ownerAr' in cached.tasks[0]) && !('ownerArBasis' in cached.tasks[0]));
  // Once the built-in arrives it answers for itself.
  assert.deepEqual(names(applyTrackerTranslations(after, { user: cleared, builtin: BUILTIN }).tasks[0]),
    ['ألفا', 'builtin', '', '']);
});

test('builtin unavailable: a RENAMED owner never borrows the previous person\'s Arabic', () => {
  const tm = setUserTranslation(emptyTranslationMemory(), 'owners', 'Alpha', 'ألفا المستخدم');
  const byUser = applyTrackerTranslations(tracker([task({ owner: 'Alpha' })]), { user: tm, builtin: null });
  const renamed = { ...byUser, tasks: [{ ...byUser.tasks[0], owner: 'Gamma' }] };
  assert.deepEqual(names(applyTrackerTranslations(renamed, { user: tm, builtin: null }).tasks[0]), ['', '', '', '']);
  // The same with a built-in-filled cell (user layer available, built-in now gone).
  const byBuiltin = applyTrackerTranslations(tracker([task({ owner: 'Alpha', organization: 'OrgX' })]),
    { user: emptyTranslationMemory(), builtin: BUILTIN });
  const moved = { ...byBuiltin, tasks: [{ ...byBuiltin.tasks[0], owner: 'Gamma', organization: 'OrgY' }] };
  assert.deepEqual(names(applyTrackerTranslations(moved, { user: emptyTranslationMemory(), builtin: null }).tasks[0]),
    ['', '', '', '']);
  // And with NO layer at all.
  assert.deepEqual(names(applyTrackerTranslations(moved, {}).tasks[0]), ['', '', '', '']);
});

test('builtin unavailable: RE-ORDERED names keep each Arabic with its own English', () => {
  const filled = applyTrackerTranslations(tracker([task({ owner: 'Alpha / Beta' })]),
    { user: emptyTranslationMemory(), builtin: BUILTIN });
  assert.deepEqual(names(filled.tasks[0]), ['ألفا / بيتا', 'builtin', '', '']);
  assert.deepEqual(basisOf(filled.tasks[0]), ['b:alpha/b:beta', '']);
  const swapped = { ...filled, tasks: [{ ...filled.tasks[0], owner: 'beta/ ALPHA' }] };
  const out = applyTrackerTranslations(swapped, { user: emptyTranslationMemory(), builtin: null }).tasks[0];
  assert.deepEqual(names(out), ['بيتا / ألفا', 'builtin', '', '']);
  assert.equal(out.ownerArBasis, 'b:beta/b:alpha');
  // One of them replaced by an unmapped person: only the remaining one keeps its Arabic.
  const replaced = { ...filled, tasks: [{ ...filled.tasks[0], owner: 'Beta / Delta' }] };
  assert.deepEqual(names(applyTrackerTranslations(replaced, { user: emptyTranslationMemory(), builtin: null }).tasks[0]),
    ['بيتا / Delta', 'builtin', '', '']);
});

test('the basis: no basis / a malformed or mis-aligned one keeps nothing; normalizeProjectTracker keeps a valid one', () => {
  const base = { owner: 'Alpha', ownerAr: 'ألفا', ownerArSource: 'builtin' };
  for (const ownerArBasis of [undefined, '', 'alpha', 'x:alpha', 'b:alpha/b:beta', 7]) {
    const tr = tracker([task({ ...base, ownerArBasis })]);
    assert.deepEqual(names(applyTrackerTranslations(tr, { builtin: null }).tasks[0]), ['', '', '', ''], String(ownerArBasis));
  }
  assert.deepEqual(names(applyTrackerTranslations(tracker([task({ ...base, ownerArBasis: 'b:alpha' })]),
    { builtin: null }).tasks[0]), ['ألفا', 'builtin', '', '']);
  // Persisted beside its Arabic only, and only well-formed.
  const n = normalizeProjectTracker(tracker([
    task({ ...base, ownerArBasis: 'b:alpha', organizationAr: 'إكس', organizationArSource: 'user', organizationArBasis: 'bad' }),
    task({ ownerArBasis: 'b:alpha' }),
  ]));
  assert.equal(n.tasks[0].ownerArBasis, 'b:alpha');
  assert.ok(!('organizationArBasis' in n.tasks[0]));
  assert.ok(!('ownerArBasis' in n.tasks[1]), 'no Arabic → no basis');
  assert.deepEqual(NAME_BASIS_FIELDS, ['ownerArBasis', 'organizationArBasis']);
  assert.deepEqual(NAME_KINDS.map((k) => k.basis), [...NAME_BASIS_FIELDS]);
});

// ---- the memory shape ---------------------------------------------------------------------

test('owners / entities in sanitize, size, merge and the caps', () => {
  const tm = sanitizeTranslationMemory({
    owners: { '  Alpha  ONE ': ' ألفا ', empty: '', n: 3 }, entities: { OrgX: 'إكس', long: 'ع'.repeat(TM_VALUE_MAX + 1) },
  });
  assert.deepEqual([tm.owners, tm.entities], [{ 'alpha one': 'ألفا' }, { orgx: 'إكس' }]);
  assert.equal(translationMemorySize(tm), 2);
  assert.deepEqual(sanitizeEntries({ entries: { owners: { A: 'أ' }, entities: { B: 'ب' } } }),
    { tasks: {}, tracks: {}, milestones: {}, owners: { a: 'أ' }, entities: { b: 'ب' } });
  const m = mergeTranslationMemory({ owners: { a: 'قديم', b: 'ب' }, entities: { x: 'س' } }, { owners: { a: 'جديد' } });
  assert.deepEqual([m.owners, m.entities], [{ a: 'جديد', b: 'ب' }, { x: 'س' }]);
  const big = {};
  for (let i = 0; i < TM_ENTRY_LIMIT + 3; i++) big[`person ${i}`] = 'ع';
  const capped = sanitizeTranslationMemory({ owners: big });
  assert.equal(Object.keys(capped.owners).length, TM_ENTRY_LIMIT);
  assert.equal(Object.keys(setUserTranslation(capped, 'owners', 'one more', 'ع').owners).length, TM_ENTRY_LIMIT);
  assert.equal(setUserTranslation(capped, 'owners', 'person 1', 'جديد').owners['person 1'], 'جديد');
  assert.deepEqual(NAME_KINDS.map((k) => [k.kind, k.en, k.ar, k.src]), [
    ['owners', 'owner', 'ownerAr', 'ownerArSource'],
    ['entities', 'organization', 'organizationAr', 'organizationArSource'],
  ]);
});

// ---- the editor's list --------------------------------------------------------------------

test('trackerNameEntries: distinct parts in tracker order, with user / built-in Arabic and source', () => {
  const tm = setUserTranslation(emptyTranslationMemory(), 'owners', 'beta', 'بيتا المستخدم');
  const tr = tracker([
    task({ owner: 'Alpha / Beta', organization: 'OrgX' }),
    task({ owner: 'BETA/Unknown', organization: 'orgx / Org Z' }),
  ]);
  assert.deepEqual(trackerNameEntries(tr, { user: tm, builtin: BUILTIN }), {
    owners: [
      { en: 'Alpha', key: 'alpha', ar: 'ألفا', source: 'builtin', builtinAr: 'ألفا' },
      { en: 'Beta', key: 'beta', ar: 'بيتا المستخدم', source: 'user', builtinAr: 'بيتا' },
      { en: 'Unknown', key: 'unknown', ar: '', source: '', builtinAr: '' },
    ],
    entities: [
      { en: 'OrgX', key: 'orgx', ar: 'أورج إكس', source: 'builtin', builtinAr: 'أورج إكس' },
      { en: 'Org Z', key: 'org z', ar: '', source: '', builtinAr: '' },
    ],
  });
  assert.deepEqual(trackerNameEntries(null), { owners: [], entities: [] });
  assert.equal(trackerNameEntries(tr).owners[0].ar, '', 'no layers → no Arabic');
});

// ---- the document (ingest/task-tracker.js) ------------------------------------------------

test('normalizeProjectTracker keeps ownerAr / organizationAr with a user / builtin source — nothing else', () => {
  const applied = applyTrackerTranslations(tracker([
    task({ owner: 'Alpha/Beta', organization: 'OrgX' }), task({ owner: 'Unknown' }),
  ]), { builtin: BUILTIN });
  const n = normalizeProjectTracker(applied);
  assert.deepEqual(names(n.tasks[0]), ['ألفا / بيتا', 'builtin', 'أورج إكس', 'builtin']);
  for (const f of ['ownerAr', 'ownerArSource', 'organizationAr', 'organizationArSource']) {
    assert.ok(!(f in n.tasks[1]), `${f}: an empty name translation is not persisted`);
  }
  assert.deepEqual(normalizeProjectTracker(n), n, 'idempotent');
  // Without a valid source (or with one a name can never have) the Arabic is dropped.
  const odd = normalizeProjectTracker(tracker([
    task({ ownerAr: 'ألفا', organizationAr: 'إكس', organizationArSource: 'machine' }),
    task({ ownerAr: '  ', ownerArSource: 'user', organizationAr: 'إكس', organizationArSource: 'file' }),
    task({ ownerAr: { x: 1 }, ownerArSource: 'user' }),
  ]));
  for (const t of odd.tasks) {
    for (const f of ['ownerAr', 'ownerArSource', 'organizationAr', 'organizationArSource']) assert.ok(!(f in t), f);
  }
  // A document without any of it normalizes to exactly TASK_FIELDS, as before.
  assert.deepEqual(Object.keys(normalizeProjectTracker(tracker([task()])).tasks[0]), [...TASK_FIELDS]);
});

// ---- the built-in file: loader + build script ---------------------------------------------

function seal(payload, keyHex = KEY) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const body = Buffer.concat([c.update(Buffer.from(JSON.stringify(payload), 'utf8')), c.final(), c.getAuthTag()]);
  return Buffer.concat([iv, body]).toString('base64');
}
const resp = (text) => async () => ({ ok: true, status: 200, text: async () => text });

test('loader: owners / entities come back normalised; a names-only memory is a usable memory', async () => {
  const got = await fetchTrackerTranslations(KEY, {
    fetchImpl: resp(seal({ generatedAt: 'g', entries: { owners: { ' Alpha  ONE': 'ألفا الأول' }, entities: { OrgX: 'إكس' } } })),
  });
  assert.deepEqual(got.entries, { tasks: {}, tracks: {}, milestones: {}, owners: { 'alpha one': 'ألفا الأول' }, entities: { orgx: 'إكس' } });
  // An older file without names still loads, with empty name maps.
  const old = await fetchTrackerTranslations(KEY, { fetchImpl: resp(seal({ entries: { tasks: { a: 'ب' } } })) });
  assert.deepEqual([old.entries.owners, old.entries.entities], [{}, {}]);
});

test('build script: owners / entities are normalised, counted, encrypted — never echoed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'misbar-tr-names-'));
  const input = join(dir, 'in.json');
  writeFileSync(input, JSON.stringify({
    owners: { 'Alpha  One': 'ألفا الأول', alpha: 'ألفا', ALPHA: 'مختلف', Blank: ' ' },
    entities: { OrgX: 'أورج إكس' },
  }));
  const r = spawnSync(process.execPath, [SCRIPT, input], { cwd: dir, env: { ...process.env, DATA_KEY: KEY }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /0 tasks · 0 tracks · 0 milestones · 2 owners · 1 entities · 1 empty\/oversized skipped · 1 conflicting duplicates/);
  for (const s of ['Alpha', 'alpha', 'OrgX', 'ألفا', 'أورج']) assert.ok(!r.stdout.includes(s) && !r.stderr.includes(s), `console leaks "${s}"`);
  const cipher = readFileSync(join(dir, 'data', 'tracker-ar.enc'), 'utf8');
  const got = await fetchTrackerTranslations(KEY, { fetchImpl: resp(cipher) });
  assert.deepEqual([got.entries.owners, got.entries.entities], [{ 'alpha one': 'ألفا الأول', alpha: 'ألفا' }, { orgx: 'أورج إكس' }]);
  const out = applyTrackerTranslations(tracker([task({ owner: 'alpha one/Alpha', organization: 'ORGX' })]), { builtin: got });
  assert.deepEqual(names(out.tasks[0]), ['ألفا الأول / ألفا', 'builtin', 'أورج إكس', 'builtin']);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ owners: ['x'] }));
  assert.notEqual(spawnSync(process.execPath, [SCRIPT, bad, join(dir, 'o.enc')], { cwd: dir, env: { ...process.env, DATA_KEY: KEY } }).status, 0);
});
