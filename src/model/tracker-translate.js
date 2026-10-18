// model/tracker-translate.js — AUTOMATIC Arabic for the project tracker («متابعة المشروع»).
//
// The user's request (2026-10-13): upload the NORMAL English tracker and get the tasks in
// Arabic on the slides automatically — with the English original one switch away for the
// day a translation is wrong. Nothing for the user to prepare: no Arabic workbook columns,
// no second file. So this module fills each task's taskAr / trackAr / milestoneAr from a
// TRANSLATION MEMORY (TM) keyed by the task's own ENGLISH text, layer by layer:
//
//   file     — an Arabic column the workbook happens to carry (already on the task; the
//              parser puts it there). Still supported, never asked for. Wins over all.
//   user     — the user's own corrections, typed in the review editor
//              (settings.trackerTranslations.tasks / tracks / milestones).
//   builtin  — reviewed translations shipped with the app, ENCRYPTED (data/tracker-ar.enc,
//              ingest/tracker-translations.js): the repo is public, the project's texts are not.
//   machine  — the browser's ON-DEVICE translator's output, cached
//              (settings.trackerTranslations.machine) and marked «ترجمة آلية — راجعها».
//   ''       — nothing covers it: the slide prints the English (build-tracker's per-cell
//              fallback), exactly as before.
//
// WHY KEYED BY ENGLISH TEXT, NOT BY WBS / id: a re-upload of the same workbook must get the
// same Arabic, and the user's correction must survive that re-upload — the English text is
// the only identity that survives (ids are repaired, WBS can repeat, rows get re-ordered).
// normEn() makes that key tolerant of the workbook's stray / doubled spaces and of case.
//
// NAMES (2026-10-18, the user's rule 5): the owner («المسؤول») and entity («الجهة») columns
// get Arabic too, from two more TM maps — owners / entities — in the user and built-in
// layers ONLY. A name is never machine-translated (an on-device translator would
// transliterate a first name into anything); an unmapped name stays exactly as written. A
// cell with several names ('Alpha/Beta') is split on '/' and each part looked up on its own, so
// the user's list of single people covers every combination the workbook makes of them.
//
// PURE: no DOM, no storage, no imports — the store, the screens, the automation and the
// build script (node) all share it. Every function returns NEW objects; nothing passed in
// is mutated.

/** Where a translated field came from. '' = no Arabic (English shown). */
export const AR_SOURCES = Object.freeze(['file', 'user', 'builtin', 'machine']);

/** The three translated texts: TM map name, English field, Arabic field, source field. */
export const TRANSLATED_KINDS = Object.freeze([
  Object.freeze({ kind: 'tasks', en: 'task', ar: 'taskAr', src: 'taskArSource' }),
  Object.freeze({ kind: 'tracks', en: 'track', ar: 'trackAr', src: 'trackArSource' }),
  Object.freeze({ kind: 'milestones', en: 'milestone', ar: 'milestoneAr', src: 'milestoneArSource' }),
]);

/**
 * The two NAME fields (owner / entity): TM map name, English field, Arabic field, source
 * field. Looked up per '/'-separated part (applyTrackerTranslations), user + builtin only —
 * never machine-translated, never collected for the machine pass.
 */
export const NAME_KINDS = Object.freeze([
  Object.freeze({ kind: 'owners', en: 'owner', ar: 'ownerAr', src: 'ownerArSource', basis: 'ownerArBasis' }),
  Object.freeze({ kind: 'entities', en: 'organization', ar: 'organizationAr', src: 'organizationArSource',
    basis: 'organizationArBasis' }),
]);

/**
 * The per-task "basis" fields beside ownerAr / organizationAr: WHAT each Arabic part was
 * computed from — one `<layer>:<normEn(part)>` per name part ('u' user, 'b' built-in, '-'
 * unmapped), joined with '/' (a key never holds '/': the parts are split on it), e.g.
 * 'b:alpha/u:beta/-:gamma'. WHY: while a layer is unavailable (the built-in still loading,
 * or never — no data key, a failed fetch) a name it filled earlier is kept only when it
 * provably belongs to the CURRENT English part and came from THAT layer. Without it an
 * edited / re-ordered owner cell would print the previous person's Arabic, and a name the
 * user cleared would survive relabelled as built-in. '' when the cell has no Arabic.
 */
export const NAME_BASIS_FIELDS = Object.freeze(NAME_KINDS.map((k) => k.basis));
/** A well-formed basis value (normalizeProjectTracker validates against the same shape). */
export const NAME_BASIS_RE = /^[ub-]:[^/]*(?:\/[ub-]:[^/]*)*$/;

/** The per-task source fields applyTrackerTranslations writes (persisted when non-empty). */
export const AR_SOURCE_FIELDS = Object.freeze([...TRANSLATED_KINDS, ...NAME_KINDS].map((k) => k.src));

const KIND_NAMES = TRANSLATED_KINDS.map((k) => k.kind);
const NAME_KIND_NAMES = NAME_KINDS.map((k) => k.kind);
// The maps a reviewed layer (user / builtin) carries; the machine layer has only KIND_NAMES.
const LAYER_KIND_NAMES = [...KIND_NAMES, ...NAME_KIND_NAMES];

// ---- bounds (settings.trackerTranslations lives in localStorage) ---------------------------
// The user's tracker is ~34 tasks; these caps leave room for years of re-uploads and only
// guard pathologies (a hand-edited backup, a runaway loop). The store validates imports
// against the SAME numbers, so export → import is closed under them.
/** Max entries per map (tasks / tracks / milestones / original, and each machine map). */
export const TM_ENTRY_LIMIT = 2000;
/** Max chars of a normalised English key (a long multi-line deliverable still fits). */
export const TM_KEY_MAX = 2000;
/** Max chars of one Arabic value. */
export const TM_VALUE_MAX = 4000;
/** Max chars of the whole serialised settings.trackerTranslations. */
export const TM_MAX_CHARS = 400_000;

// Invisible characters a copy-paste or Excel can leave INSIDE a word (zero-width space /
// joiners, LRM / RLM, BOM). Removed, not turned into a space, so they never split a word.
const INVISIBLE = /[\u200b-\u200f\u2060\ufeff]/g;

/**
 * The lookup key for an English text: NFC, invisible marks removed, every run of
 * whitespace (spaces, NBSP, line breaks, the workbook's doubled spaces) collapsed to one
 * space, trimmed, lower-cased. '' for null / non-text.
 * @param {*} text
 * @returns {string}
 */
export function normEn(text) {
  if (text == null || (typeof text !== 'string' && typeof text !== 'number')) return '';
  return String(text).normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// An Arabic value keeps its ZWNJ / ZWJ / RLM (they can be meaningful in Arabic text); only
// the truly empty marks (zero-width space, word joiner, BOM) go.
const cleanAr = (v) => (typeof v === 'string' ? v.replace(/[\u200b\u2060\ufeff]/g, '').trim() : '');

/**
 * 'task' | 'taskAr' | 'tasks' (and the track / milestone / owner / organization
 * equivalents; 'entity' too) → the TM map name.
 */
function kindOf(k) {
  for (const d of [...TRANSLATED_KINDS, ...NAME_KINDS]) if (k === d.kind || k === d.en || k === d.ar) return d.kind;
  if (k === 'entity') return 'entities';
  return null;
}

/**
 * One {normEn: string} map, cleaned: keys re-normalised (a hand-edited backup's raw English
 * still finds its task), empty / non-string / oversized entries dropped, at most `limit`
 * entries (first come, first kept). `valueOk` decides what a value may be.
 */
function cleanMap(m, valueOk, limit = TM_ENTRY_LIMIT) {
  const out = {};
  if (!isPlainObject(m)) return out;
  let n = 0;
  for (const [rawKey, v] of Object.entries(m)) {
    if (n >= limit) break;
    const key = normEn(rawKey);
    if (!key || key.length > TM_KEY_MAX || key in out) continue;
    const val = valueOk(v);
    if (val === undefined) continue;
    out[key] = val;
    n++;
  }
  return out;
}
const arValue = (v) => {
  const s = cleanAr(v);
  return s && s.length <= TM_VALUE_MAX ? s : undefined;
};
const trueValue = (v) => (v === true ? true : undefined);

/**
 * The BUILT-IN layer's map set, cleaned: {tasks, tracks, milestones, owners, entities}.
 * (A file built before names existed simply has empty owners / entities.)
 */
export function sanitizeEntries(e) {
  const src = isPlainObject(e) && isPlainObject(e.entries) ? e.entries : e;
  const out = {};
  for (const k of LAYER_KIND_NAMES) out[k] = cleanMap(isPlainObject(src) ? src[k] : null, arValue);
  return out;
}

// The MACHINE layer's map set: texts only. WHY no owners / entities: names are never
// machine-translated, so a hand-edited backup cannot smuggle a «machine» name in either.
function sanitizeMachine(e) {
  const src = isPlainObject(e) && isPlainObject(e.entries) ? e.entries : e;
  const out = {};
  for (const k of KIND_NAMES) out[k] = cleanMap(isPlainObject(src) ? src[k] : null, arValue);
  return out;
}

/** An empty user TM (the shape settings.trackerTranslations always has once written). */
export function emptyTranslationMemory() {
  return { tasks: {}, tracks: {}, milestones: {}, owners: {}, entities: {}, original: {},
    machine: { tasks: {}, tracks: {}, milestones: {} } };
}

/**
 * settings.trackerTranslations → its clean shape:
 *   {tasks, tracks, milestones, owners, entities: {normEn: ar}, original: {normEn: true},
 *    machine: {tasks, tracks, milestones: {normEn: ar}}}
 * Unknown keys dropped, keys re-normalised, entry caps applied. Anything not an object →
 * the empty TM. (The store owns WHEN this runs; this module owns the shape, the way
 * task-lifecycle.js owns the taskLog entry.)
 * @param {*} tm
 */
export function sanitizeTranslationMemory(tm) {
  const t = isPlainObject(tm) ? tm : {};
  const out = emptyTranslationMemory();
  for (const k of LAYER_KIND_NAMES) out[k] = cleanMap(t[k], arValue);
  out.original = cleanMap(t.original, trueValue);
  out.machine = sanitizeMachine(t.machine);
  return out;
}

/** Total entries of a TM (every map, machine included). */
export function translationMemorySize(tm) {
  const t = sanitizeTranslationMemory(tm);
  let n = Object.keys(t.original).length;
  for (const k of KIND_NAMES) n += Object.keys(t[k]).length + Object.keys(t.machine[k]).length;
  for (const k of NAME_KIND_NAMES) n += Object.keys(t[k]).length;
  return n;
}

/**
 * Merge two TMs, `over` winning per key (an imported backup over this device's TM). When a
 * map would exceed TM_ENTRY_LIMIT, `over`'s entries are kept first and `base`'s extra keys
 * are the ones trimmed — the import is what the user just chose to restore.
 */
export function mergeTranslationMemory(base, over) {
  const b = sanitizeTranslationMemory(base);
  const o = sanitizeTranslationMemory(over);
  const mergeMap = (bm, om) => {
    const out = { ...om };
    let n = Object.keys(out).length;
    for (const [k, v] of Object.entries(bm)) {
      if (n >= TM_ENTRY_LIMIT) break;
      if (!(k in out)) { out[k] = v; n++; }
    }
    return out;
  };
  const out = emptyTranslationMemory();
  for (const k of KIND_NAMES) {
    out[k] = mergeMap(b[k], o[k]);
    out.machine[k] = mergeMap(b.machine[k], o.machine[k]);
  }
  for (const k of NAME_KIND_NAMES) out[k] = mergeMap(b[k], o[k]);
  out.original = mergeMap(b.original, o.original);
  return out;
}

// ---- edits (the review editor's writes) ----------------------------------------------------

/**
 * The user typed / cleared the Arabic of an English text. Returns the NEW TM: `ar` stored
 * under normEn(en) in the user layer; an empty `ar` REMOVES the user entry, so the task falls
 * back to the built-in / machine translation (or English) on the next apply.
 * @param {*} tm settings.trackerTranslations (any shape; sanitized)
 * For a NAME (kind 'owners' / 'owner' / 'entities' / 'organization' / 'entity') `en` is
 * ONE name part as splitNameParts returns it ('Alpha', not 'Alpha / Beta').
 * @param {'tasks'|'tracks'|'milestones'|'owners'|'entities'|'task'|'track'|'milestone'|'owner'|'organization'|'taskAr'|'trackAr'|'milestoneAr'|'ownerAr'|'organizationAr'} kind
 * @param {string} en the task's ENGLISH text (the key)
 * @param {string} ar the Arabic ('' clears)
 */
export function setUserTranslation(tm, kind, en, ar) {
  const out = sanitizeTranslationMemory(tm);
  const k = kindOf(kind);
  const key = normEn(en);
  if (!k || !key || key.length > TM_KEY_MAX) return out;
  const v = arValue(ar);
  if (v === undefined) delete out[k][key];
  else if (key in out[k] || Object.keys(out[k]).length < TM_ENTRY_LIMIT) out[k][key] = v;
  return out;
}

/**
 * «النص الأصلي»: show (on=true) / stop showing (on=false) the English original of this task
 * on the slide even in Arabic mode. Keyed by the task's English text, like everything else.
 */
export function setOriginal(tm, en, on) {
  const out = sanitizeTranslationMemory(tm);
  const key = normEn(en);
  if (!key || key.length > TM_KEY_MAX) return out;
  if (on) {
    if (key in out.original || Object.keys(out.original).length < TM_ENTRY_LIMIT) out.original[key] = true;
  } else delete out.original[key];
  return out;
}

/**
 * Cache machine translations. `results` = {tasks?: {english: arabic}, tracks?, milestones?}
 * keyed by the ORIGINAL English (as collectUntranslated returned it). Each value goes
 * through the glossary post-pass with its English source before it is stored; an empty
 * result is not stored (the text stays untranslated, not "translated to nothing").
 */
export function addMachineTranslations(tm, results) {
  const out = sanitizeTranslationMemory(tm);
  if (!isPlainObject(results)) return out;
  for (const [rawKind, map] of Object.entries(results)) {
    const k = kindOf(rawKind);
    // Names are never machine-translated (see the header): an owners / entities result is ignored.
    if (!k || !KIND_NAMES.includes(k) || !isPlainObject(map)) continue;
    const target = out.machine[k];
    for (const [en, ar] of Object.entries(map)) {
      const key = normEn(en);
      if (!key || key.length > TM_KEY_MAX) continue;
      const v = arValue(machineGlossary(typeof ar === 'string' ? ar : '', en));
      if (v === undefined) continue;
      if (key in target || Object.keys(target).length < TM_ENTRY_LIMIT) target[key] = v;
    }
  }
  return out;
}

// ---- machine-output glossary --------------------------------------------------------------
// The on-device translator does not know this project's names. A SMALL, CONSERVATIVE
// post-pass fixes only what is certain:
//   · MISBAR is the product, and its Arabic name is مسبار — a Latin MISBAR left in the
//     output, or a phonetic ميسبار / ميزبار, becomes مسبار;
//   · the fixed acronyms stay EXACTLY as written in English: a case-mangled Latin copy
//     ('Nupco', 'moh') is restored to upper case, and the two transliterations seen in
//     practice (نوبكو → NUPCO, زاتكا → ZATCA) are put back — but only when the English
//     source really writes that term in upper case, so an unrelated word is never rewritten.
// Anything subtler (an acronym translated into its Arabic expansion, e.g. «وزارة الصحة»
// for MOH) is left alone: it is a correct translation, and guessing would do more harm.
/** Acronyms kept as written in English. */
export const KEEP_TERMS = Object.freeze(['NUPCO', 'LEAN', 'ZATCA', 'MOH', 'MOI', 'CAB', 'MVP', 'TAT', 'CCO', 'SFH', 'SGH']);
const MISBAR_AR = 'مسبار';
// Arabic transliterations of a kept term → the term. Only spellings that are not ordinary
// Arabic words (لين is «soft», so LEAN has none).
const TRANSLITERATIONS = Object.freeze({ NUPCO: ['نوبكو', 'نيوبكو'], ZATCA: ['زاتكا', 'زاتكة'] });
const AR_LETTER = '\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF';
// An Arabic word with an optional one-letter proclitic (و / ف / ب / ل / ك), standing alone.
const arWord = (w) => new RegExp(`(^|[^${AR_LETTER}])([وفبلك]?)${w}(?![${AR_LETTER}])`, 'g');
const latinWord = (w, flags = 'gi') => new RegExp(`(^|[^A-Za-z0-9])${w}(?![A-Za-z0-9])`, flags);

/**
 * The glossary post-pass for ONE machine translation.
 * @param {string} ar the machine output
 * @param {string} [en] its English source (enables the kept-term repairs)
 * @returns {string}
 */
export function machineGlossary(ar, en = '') {
  if (typeof ar !== 'string' || !ar) return '';
  let s = ar;
  s = s.replace(latinWord('misbar'), (_m, pre) => `${pre}${MISBAR_AR}`);
  for (const v of ['ميسبار', 'ميزبار']) s = s.replace(arWord(v), (_m, pre, pro) => `${pre}${pro}${MISBAR_AR}`);
  const source = typeof en === 'string' ? en : '';
  for (const term of KEEP_TERMS) {
    // Only a term the English really writes (as a word, IN UPPER CASE) is repaired: an
    // ordinary lower-case word that happens to spell an acronym ('Book a cab') is left as is.
    if (!latinWord(term, '').test(source)) continue;
    s = s.replace(latinWord(term), (_m, pre) => `${pre}${term}`);
    for (const v of TRANSLITERATIONS[term] || []) {
      s = s.replace(arWord(v), (_m, pre, pro) => `${pre}${pro}${term}`);
    }
  }
  return s;
}

// ---- applying the layers to a tracker ------------------------------------------------------

/** A layer's map for `kind`, or null when the layer is not available at all. */
function layerMap(layer, kind) {
  if (!isPlainObject(layer)) return null;
  const src = isPlainObject(layer.entries) ? layer.entries : layer;
  return isPlainObject(src[kind]) ? src[kind] : {};
}
function lookup(map, key) {
  if (!map || !key) return '';
  const v = map[key];
  return typeof v === 'string' ? v.trim() : '';
}

// ---- names (owner / entity) ----------------------------------------------------------------

/** What joins several names in one cell: a space each side (the user's rule 6: «أ / ب / ج»). */
export const NAME_SEPARATOR = ' / ';

/**
 * The names in one owner / entity cell: split on '/', each part with its invisible marks
 * removed and its whitespace collapsed, empty parts ('A//B', a trailing '/') dropped.
 * Case is KEPT (this is display text; the lookup key is normEn(part)).
 * @param {*} text
 * @returns {string[]}
 */
export function splitNameParts(text) {
  if (text == null || (typeof text !== 'string' && typeof text !== 'number')) return [];
  return String(text).normalize('NFC').split('/')
    .map((p) => p.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * A cell's names in the slide's form: the parts joined with NAME_SEPARATOR
 * ('Alpha/Beta' → 'Alpha / Beta'). For the slide builder's English ('en') and fallback cells,
 * so every names cell follows the same join rule whatever its language.
 * @param {*} text
 * @returns {string}
 */
export function formatNameParts(text) {
  return splitNameParts(text).join(NAME_SEPARATOR);
}

/**
 * The Arabic a cell's earlier pass gave each English part, by that part's key:
 * Map<normEn(part), {ar, from:'user'|'builtin'}>, read from the cell's basis (see
 * NAME_BASIS_FIELDS) and its Arabic, which must line up part for part. Empty when there is
 * no / a malformed / a mis-aligned basis — nothing is then kept.
 */
function previousNameParts(t, { ar, basis }) {
  const out = new Map();
  const b = typeof t[basis] === 'string' ? t[basis] : '';
  if (!b || !NAME_BASIS_RE.test(b)) return out;
  const entries = b.split('/');
  const arParts = typeof t[ar] === 'string' ? splitNameParts(t[ar]) : [];
  if (arParts.length !== entries.length) return out;
  entries.forEach((e, i) => {
    const from = e[0] === 'u' ? 'user' : e[0] === 'b' ? 'builtin' : '';
    const key = e.slice(2);
    if (from && key && !out.has(key)) out.set(key, { ar: arParts[i], from });
  });
  return out;
}

/**
 * One names cell (owner or organization) through the user + built-in layers, PER PART:
 * a mapped part becomes its Arabic, an unmapped part stays as written (Latin), and the
 * parts are re-joined with NAME_SEPARATOR. → [text, source, basis]: ['', '', ''] when NO
 * part is mapped (the slide prints the English, formatted), else source 'user' when any
 * part came from the user's own list, otherwise 'builtin'; basis per NAME_BASIS_FIELDS.
 *
 * An UNAVAILABLE layer (null — the built-in loading, or failed for good) keeps only what
 * IT filled for the SAME English part: the earlier basis says, per part key, which layer
 * gave the Arabic, so the keep is matched by key (an edited or re-ordered cell can never
 * borrow another person's Arabic) and by layer (a user name the user has since cleared
 * from an AVAILABLE user layer is not resurrected as 'builtin' — it falls back to the
 * English until the built-in can answer for that part itself).
 */
function translateNames(t, d, userTm, builtinTm) {
  const parts = splitNameParts(t[d.en]);
  if (!parts.length) return ['', '', ''];
  const prev = previousNameParts(t, d);
  const userMap = userTm ? layerMap(userTm, d.kind) : null;
  const builtinMap = builtinTm ? layerMap(builtinTm, d.kind) : null;
  let anyUser = false;
  let anyHit = false;
  const basis = [];
  const out = parts.map((part) => {
    const key = normEn(part);
    const p = prev.get(key);
    let hit = '';
    let from = '';
    if (userMap) {
      hit = lookup(userMap, key);
      if (hit) from = 'user';
    } else if (p && p.from === 'user') { hit = p.ar; from = 'user'; }
    if (!hit) {
      if (builtinMap) {
        hit = lookup(builtinMap, key);
        if (hit) from = 'builtin';
      } else if (p && p.from === 'builtin') { hit = p.ar; from = 'builtin'; }
    }
    basis.push(`${from === 'user' ? 'u' : from === 'builtin' ? 'b' : '-'}:${key}`);
    if (!hit) return part;
    anyHit = true;
    if (from === 'user') anyUser = true;
    return hit;
  });
  if (!anyHit) return ['', '', ''];
  return [out.join(NAME_SEPARATOR), anyUser ? 'user' : 'builtin', basis.join('/')];
}

/**
 * Every DISTINCT name part of a tracker's owner and organization cells, in tracker order,
 * with the Arabic the layers give it — the review editor's «ترجمة الأسماء» list:
 *   {owners: [{en, key, ar, source, builtinAr}], entities: [...]}
 *   en = the part as first written; key = normEn(en) (what setUserTranslation stores under);
 *   ar = the user's Arabic, else the built-in's, else ''; source 'user' | 'builtin' | '';
 *   builtinAr = the built-in's Arabic ('' when none / not loaded) — what clearing the
 *   user's entry falls back to.
 * @param {import('../contracts.js').ProjectTracker} tracker
 * @param {{user?:Object|null, builtin?:Object|null}} [opts]
 */
export function trackerNameEntries(tracker, { user = null, builtin = null } = {}) {
  const out = { owners: [], entities: [] };
  const tasks = isPlainObject(tracker) && Array.isArray(tracker.tasks) ? tracker.tasks : [];
  for (const { kind, en } of NAME_KINDS) {
    const userMap = isPlainObject(user) ? layerMap(user, kind) : null;
    const builtinMap = isPlainObject(builtin) ? layerMap(builtin, kind) : null;
    const seen = new Set();
    for (const t of tasks) {
      if (!isPlainObject(t)) continue;
      for (const part of splitNameParts(t[en])) {
        const key = normEn(part);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const u = lookup(userMap, key);
        const b = lookup(builtinMap, key);
        out[kind].push({ en: part, key, ar: u || b, source: u ? 'user' : b ? 'builtin' : '', builtinAr: b });
      }
    }
  }
  return out;
}

/**
 * A NEW tracker whose tasks carry the Arabic of every text a layer covers.
 *
 * Per task and per text (task / track / milestone), first hit wins:
 *   1. file    — the task already carries Arabic and its recorded source is '' / absent /
 *                'file' (the workbook's own column, or text from before sources existed);
 *   2. user    — opts.user[kind][normEn(english)];
 *   3. builtin — opts.builtin (the decrypted data/tracker-ar.enc; its {entries} or the maps);
 *   4. machine — opts.machine, or opts.user.machine when not given;
 *   5. ''      — no Arabic: the slide prints the English.
 * A layer that is NOT AVAILABLE (null / undefined — e.g. the built-in TM still loading)
 * does not wipe what it filled earlier: a field whose recorded source is that layer keeps
 * its text until the layer arrives and can answer for itself. A layer that IS available
 * and lacks the key does drop it (a cleared user correction falls back to built-in).
 *
 * showOriginal: when the user TM is available it decides (original[normEn(task)]); without
 * it the task's own flag is kept.
 *
 * Names (owner → ownerAr, organization → organizationAr): user then builtin, PER
 * '/'-separated part, unmapped parts kept as written, joined with NAME_SEPARATOR; never
 * from the file or the machine layer (translateNames).
 *
 * Each output task carries taskArSource / trackArSource / milestoneArSource /
 * ownerArSource / organizationArSource ('' when no Arabic), ownerAr / organizationAr with
 * their ownerArBasis / organizationArBasis (NAME_BASIS_FIELDS), and showOriginal (boolean).
 * The English fields are never touched.
 * @param {import('../contracts.js').ProjectTracker} tracker
 * @param {{user?:Object|null, builtin?:Object|null, machine?:Object|null}} [opts]
 * @returns {import('../contracts.js').ProjectTracker} (the input itself when it has no tasks array)
 */
export function applyTrackerTranslations(tracker, { user = null, builtin = null, machine } = {}) {
  if (!isPlainObject(tracker) || !Array.isArray(tracker.tasks)) return tracker;
  const userTm = isPlainObject(user) ? user : null;
  const machineTm = machine !== undefined ? (isPlainObject(machine) ? machine : null)
    : (userTm && isPlainObject(userTm.machine) ? userTm.machine : null);
  const layers = [['user', userTm], ['builtin', isPlainObject(builtin) ? builtin : null], ['machine', machineTm]];
  const original = userTm ? (isPlainObject(userTm.original) ? userTm.original : {}) : null;

  const tasks = tracker.tasks.map((t) => {
    if (!isPlainObject(t)) return t;
    const o = { ...t };
    for (const { kind, en, ar, src } of TRANSLATED_KINDS) {
      const cur = typeof t[ar] === 'string' ? t[ar].trim() : '';
      const curSrc = AR_SOURCES.includes(t[src]) ? t[src] : '';
      if (cur && (curSrc === '' || curSrc === 'file')) { o[ar] = t[ar]; o[src] = 'file'; continue; }
      const key = normEn(t[en]);
      let text = '';
      let from = '';
      for (const [name, layer] of layers) {
        if (!layer) {
          if (cur && curSrc === name) { text = t[ar]; from = name; break; }
          continue;
        }
        const hit = lookup(layerMap(layer, kind), key);
        if (hit) { text = hit; from = name; break; }
      }
      // No English key to look up (a row with only Arabic typed in): keep what it has.
      if (!from && !key && cur) { text = t[ar]; from = curSrc; }
      o[ar] = text;
      o[src] = from;
    }
    for (const d of NAME_KINDS) {
      const [text, from, basis] = translateNames(t, d, userTm, isPlainObject(builtin) ? builtin : null);
      o[d.ar] = text;
      o[d.src] = from;
      o[d.basis] = basis;
    }
    const key = normEn(t.task);
    o.showOriginal = original && key ? original[key] === true : t.showOriginal === true;
    return o;
  });
  return { ...tracker, tasks };
}

// ---- reading the result (status line, machine pass) ----------------------------------------

const hasText = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Counts for the tracker card's status line «N من M مهمة مترجمة تلقائيًا»: `total` = tasks
 * with a task text (English or Arabic), `translated` = those with Arabic, by source;
 * `showOriginal` = tasks set to show their English.
 */
export function trackerTranslationStats(tracker) {
  const out = { total: 0, translated: 0, untranslated: 0, showOriginal: 0,
    bySource: { file: 0, user: 0, builtin: 0, machine: 0 } };
  const tasks = isPlainObject(tracker) && Array.isArray(tracker.tasks) ? tracker.tasks : [];
  for (const t of tasks) {
    if (!isPlainObject(t) || !(hasText(t.task) || hasText(t.taskAr))) continue;
    out.total++;
    if (hasText(t.taskAr)) {
      out.translated++;
      const s = AR_SOURCES.includes(t.taskArSource) ? t.taskArSource : 'file';
      out.bySource[s]++;
    }
    if (t.showOriginal === true) out.showOriginal++;
  }
  out.untranslated = out.total - out.translated;
  return out;
}

/**
 * The English texts still WITHOUT Arabic — what the on-device machine pass should
 * translate: {tasks: string[], tracks: string[], milestones: string[]}, each the original
 * English (trimmed, one per normEn key, in tracker order).
 */
export function collectUntranslated(tracker) {
  const out = { tasks: [], tracks: [], milestones: [] };
  const seen = { tasks: new Set(), tracks: new Set(), milestones: new Set() };
  const tasks = isPlainObject(tracker) && Array.isArray(tracker.tasks) ? tracker.tasks : [];
  for (const t of tasks) {
    if (!isPlainObject(t)) continue;
    for (const { kind, en, ar } of TRANSLATED_KINDS) {
      if (hasText(t[ar])) continue;
      const key = normEn(t[en]);
      if (!key || seen[kind].has(key)) continue;
      seen[kind].add(key);
      out[kind].push(String(t[en]).trim());
    }
  }
  return out;
}
