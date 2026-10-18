// src/model/slide-order.js
// SLIDE ORDER — the one vocabulary every deck, the store and the UI share for "which content
// slide comes where" (user request 2026-10-13: move e.g. the tracker slide first; save a
// FIXED order, or use a changed order for ONE report only).
//
// UNITS, not slide ids. A unit is what moves as one block: the shipments slide with its
// continuation pages, the send-out pair (countries + labs), the tracker with all its pages.
// Cover and thanks are NOT units — the cover is always first and thanks always last.
// SLIDE_ORDER_KEYS is today's order (build-spec.js middleDefs, whose literal order IS the
// default). The BOTH deck (build-spec-both.js) emits a subset in the same relative order,
// so one list serves every deck type; a unit a deck does not have is simply skipped.
//
// WHERE AN ORDER COMES FROM (slideOrderOf):
//   model.slideOrder                 the TEMPORARY order of this one report (review screen,
//                                    memory only — never written to settings)
//   model.reportOptions.slideOrder   the SAVED, fixed order (settings.reportOptions; ABSENT
//                                    means default, so a unit added later lands in its
//                                    default place instead of being frozen out)
//   neither                          SLIDE_ORDER_KEYS
// The automation builds its model from settings only, so it always uses the saved order.
//
// A LEAF MODULE ON PURPOSE (no imports): store.js stays free of any slidespec import, and
// both spec files can import it at top level without touching their ESM cycle.

// The default order. The retired 'action' (المهام) key is deliberately NOT a unit — its slot
// belongs to 'tracker' now, and normalizeSlideOrder drops it from old data.
// 'trackerCompleted' («المهام المكتملة خلال الأسبوع», 2026-10-18) sits right after the task
// slides. A saved order from before it existed lacks it, so weave() places it behind its
// default predecessor — right after 'tracker', wherever the user moved that.
export const SLIDE_ORDER_KEYS = Object.freeze([
  'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'tracker', 'trackerCompleted', 'challenges', 'definitions',
]);
export const DEFAULT_SLIDE_ORDER = SLIDE_ORDER_KEYS;

// Import guard (store.validateImport): a stored order is a short list; anything longer is not
// one of ours. Generous so a backup from a future version with more units still imports.
export const SLIDE_ORDER_MAX = 64;

const KNOWN = new Set(SLIDE_ORDER_KEYS);

// ---- report cadence (2026-10-18 user request: a «Daily» report beside the «Weekly» one) ----
// settings.reportOptions.cadence. It lives HERE because this leaf is already what the store,
// the UI and both deck builders share for "which slides does a deck have": a daily deck is
// the weekly deck minus the weekly-only units (and minus its Completed tasks — the tracker
// builder's job), with «اليومي» in the cover title. Independent of deltaMode (the activity
// window) on purpose — the user did not couple the two.
export const REPORT_CADENCES = Object.freeze(['weekly', 'daily']);
/** MUST equal REPORT_OPTIONS_SEED.cadence (seeds/defaults.js keeps the first-run copy). */
export const DEFAULT_REPORT_CADENCE = 'weekly';
/**
 * A stored / passed cadence → 'weekly' | 'daily'; absent / unknown → 'weekly' (the report
 * every install produced before the option existed). Case and spaces forgiven.
 * @param {unknown} v
 * @returns {'weekly'|'daily'}
 */
export function reportCadence(v) {
  return typeof v === 'string' && v.trim().toLowerCase() === 'daily' ? 'daily' : DEFAULT_REPORT_CADENCE;
}
/** The cadence a model asks for (model.reportOptions.cadence). */
export const cadenceOf = (model) => reportCadence(model?.reportOptions?.cadence);
/** Units only a WEEKLY deck has (the toggle shows «أسبوعي فقط» in daily). */
export const WEEKLY_ONLY_UNITS = Object.freeze(['trackerCompleted']);
/** False for a weekly-only unit in a daily deck; true otherwise. */
export const unitInCadence = (key, cadence) => !(reportCadence(cadence) === 'daily' && WEEKLY_ONLY_UNITS.includes(key));

/**
 * THE placement rule, shared by normalizeSlideOrder and mergeVisibleOrder. `base` is a full
 * order; `seq` is the new sequence of SOME of its units (the "placed" ones). Every other unit
 * keeps its NEIGHBOURHOOD in `base` rather than its index:
 *   - a run of unplaced units BEFORE the first placed one in `base` stays at the very start;
 *   - a run AFTER the last placed one in `base` stays at the very end;
 *   - any other run travels right behind the placed unit it follows in `base`.
 * WHY neighbourhood, not slot: a slot is meaningless once the units around it move. Keeping
 * the slot put the shipments details (which belong right after the executive summary) in
 * FRONT of it whenever an order saved from a deck without shipments moved anything to the
 * top; keeping the predecessor only dragged the trailing units (challenges, definitions) to
 * the front with a tracker moved first. The end of the deck is a place of its own, so the
 * trailing run is anchored to it. `seq` must hold distinct units of `base`.
 * @param {string[]} base
 * @param {string[]} seq
 * @returns {string[]}
 */
function weave(base, seq) {
  const placed = new Set(seq);
  const lead = [];
  const runs = new Map(); // placed unit → the unplaced units right behind it in `base`
  let run = lead;
  let last = null;
  for (const k of base) {
    if (placed.has(k)) { run = []; runs.set(k, run); last = k; } else run.push(k);
  }
  const tail = last == null ? [] : runs.get(last);
  // GLUED (below): an unplaced unit sitting RIGHT behind its anchor, when that anchor is the
  // last placed unit, would otherwise ride the trailing run to the very end of the deck —
  // it stays behind its anchor instead. Anywhere else it follows the ordinary rule (so a
  // position the user chose for it survives a reorder saved where it was hidden).
  const glued = [];
  while (tail.length && GLUED[tail[0]] === last) glued.push(tail.shift());
  const out = [...lead];
  for (const k of seq) {
    out.push(k);
    out.push(...(k === last ? glued : runs.get(k)));
  }
  return last == null ? out : [...out, ...tail];
}

/**
 * A unit GLUED to another: when an order does not place it itself and it sits RIGHT behind
 * its anchor, it stays behind the anchor even when the anchor is the last placed unit (which
 * would otherwise send it to the deck's trailing run). 'trackerCompleted' belongs with the
 * task slides — without this, a list that predates it (or a reorder saved from a deck that
 * lacks both it and the units after the tracker) with the tracker moved first would put it
 * at the very end of every later weekly deck. Saved elsewhere by the user (e.g. after
 * 'challenges'), it keeps that neighbourhood like any other hidden unit — a reorder saved
 * from a DAILY deck (which never shows it) does not pull it back. A deck that shows it
 * places it explicitly (the user may move it anywhere).
 */
const GLUED = Object.freeze({ trackerCompleted: 'tracker' });

/** Distinct known unit names of a list, in order (non-strings, unknown, duplicates dropped). */
function knownUnits(list) {
  const out = [];
  for (const k of Array.isArray(list) ? list : []) {
    if (typeof k === 'string' && KNOWN.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Any input → a full permutation of SLIDE_ORDER_KEYS (a fresh array).
 * Non-strings, unknown keys (typos, the retired 'action', units of a newer version) and
 * duplicates are dropped. A known unit the list lacks goes back to its DEFAULT neighbourhood
 * (weave above, over the default order): units that lead the default stay first, units that
 * trail it stay last, any other one follows its default predecessor wherever that went —
 * ['tracker','execFunnel'] → tracker, trackerCompleted (glued), execFunnel, shipments …
 * compliance, challenges, definitions; a list from before a unit existed gets that unit beside its default neighbour.
 * A list in default relative order gives the default. A non-array gives the default.
 * Idempotent.
 * @param {unknown} order
 * @returns {string[]}
 */
export function normalizeSlideOrder(order) {
  if (!Array.isArray(order)) return [...SLIDE_ORDER_KEYS];
  return weave(SLIDE_ORDER_KEYS, knownUnits(order));
}

/** Same unit sequence after normalisation (so absent and the default compare equal). */
export function sameSlideOrder(a, b) {
  const x = normalizeSlideOrder(a);
  const y = normalizeSlideOrder(b);
  return x.every((k, i) => k === y[i]);
}

/** True when the order (after normalisation) is the default one. */
export const isDefaultSlideOrder = (order) => sameSlideOrder(order, SLIDE_ORDER_KEYS);

/**
 * Stable sort of a deck's unit definitions ({ key, ... }) by the order. A def whose key is not
 * a unit keeps its relative place after all the units (cannot happen in today's decks, but a
 * builder adding a def must never lose it). The defs are not copied — only re-sequenced — and
 * with the default order the result is the input sequence, which is what keeps every deck
 * byte-identical when no order is set.
 * @template {{key:string}} T
 * @param {T[]} defs
 * @param {unknown} order
 * @returns {T[]}
 */
export function orderUnits(defs, order) {
  const o = normalizeSlideOrder(order);
  const rank = (k) => { const i = o.indexOf(k); return i < 0 ? o.length : i; };
  return defs
    .map((d, i) => [d, i])
    .sort((a, b) => rank(a[0].key) - rank(b[0].key) || a[1] - b[1])
    .map(([d]) => d);
}

/**
 * The order a model asks for: its TEMPORARY order (model.slideOrder) when it carries one, else
 * the SAVED order (model.reportOptions.slideOrder), else the default — always normalised.
 * @param {{slideOrder?:unknown, reportOptions?:{slideOrder?:unknown}}|null|undefined} model
 * @returns {string[]}
 */
export function slideOrderOf(model) {
  if (Array.isArray(model?.slideOrder)) return normalizeSlideOrder(model.slideOrder);
  return normalizeSlideOrder(model?.reportOptions?.slideOrder);
}

/**
 * Slide id → the unit it belongs to (multi-page units collapse onto one key); null for the
 * cover, thanks and anything unknown.
 * @param {string} id
 * @returns {string|null}
 */
export function unitOfSlideId(id) {
  if (typeof id !== 'string') return null;
  if (id === 'sendoutCountries' || id === 'sendoutLabs') return 'sendout';
  if (/^shipments(-cont-\d+)?$/.test(id)) return 'shipments';
  if (/^tracker(-cont-\d+)?$/.test(id)) return 'tracker';
  if (/^trackerCompleted(-cont-\d+)?$/.test(id)) return 'trackerCompleted';
  return KNOWN.has(id) ? id : null;
}

/**
 * Saving a reorder made on a deck that shows only SOME units (the BOTH deck has no shipments /
 * challenges / definitions; an unscoped deck no shipments …) must not move the units it did
 * not show. The visible units take their new sequence; every unit the deck did not show keeps
 * its NEIGHBOURHOOD in the order being changed (weave above): it stays glued behind the unit
 * it followed there, or at the start / end when it led / trailed it. So the shipments details
 * stay right behind the executive summary on a later scoped deck, wherever that moved.
 *   mergeVisibleOrder(default, ['tracker','execFunnel','monthly','sendout','compliance'])
 *   → ['tracker','trackerCompleted','execFunnel','shipments','monthly','sendout','compliance','challenges','definitions']
 * (trackerCompleted is GLUED behind tracker — see GLUED).
 * @param {unknown} fullOrder  the order being changed (normalised first)
 * @param {unknown} visibleNew the visible units in their new order
 * @returns {string[]}
 */
export function mergeVisibleOrder(fullOrder, visibleNew) {
  return weave(normalizeSlideOrder(fullOrder), knownUnits(visibleNew));
}
