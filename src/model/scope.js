// model/scope.js — narrow the ORDER ROWS a report is computed from (a "scoped" or
// side report), before a single number exists.
//
// WHY THE ROWS, NOT THE NUMBERS. Every order-based slide — KPI cards, journey,
// monthly table, compliance, late-by-test, send-out, the delta chips — is a function
// of one row set. Filtering the rows ONCE, up front, is the only way all of them
// agree about what "this report" covers; filtering per slide would let two slides
// of one deck describe two different populations. The project-task slides
// (actions, challenges) are not built from rows and are unaffected by design.
//
// THREE FILTERS, combined with AND:
//   • LABS       — the performing facility, compared by normFacility. [] = «كل
//                  المختبرات», i.e. NO lab filter (not "no labs").
//   • SHIPMENTS  — the Shipment ID, compared by normShipmentId (trim + upper-case,
//                  so a typed 'elab626016' finds 'ELAB626016').
//   • DATE RANGE — [from, to], both ends or neither. Keeps the orders PLACED in the
//                  range and then reads every kept order AS OF 'to' (below).
//
// THE AS-OF TIME-SHIFT — why a range is more than an order-date filter. A report
// dated 'to' must not know what happened after 'to'. An order received on 22 Sep and
// resulted on 24 Sep was, on 23 Sep, RECEIVED AND AWAITING A RESULT — so for to=23 Sep
// its `resulted` must read as empty. applyScope therefore nulls every milestone
// (collected / dispatched / received / resulted) dated after 'to' and hands the engine
// ordinary-looking rows: the engine keeps its `!= null` tests, and they now mean "had
// happened by 'to'". This is the SAME rule engine/asof.js computeNumbersAsOf applies
// key by key — here it is applied to the rows instead, so every slide inherits it,
// not only the 10 headline numbers. test/scope.test.mjs PROVES the two agree on the
// golden fixture: engine(applyScope(rows, range), asOf=to) === computeNumbersAsOf(
// cohort, to), all 10 keys, several ranges. Change one rule without the other and it
// fails.
//
// THE TWO EVENTS WITH NO TIMESTAMP (the same principled approximations asof.js makes):
//   • REJECTION — dated by the row's ORIGINAL resulted day when present, else by the
//     LAST milestone it is known to have reached (received → dispatched → order day);
//     a rejection cannot precede receipt (see asof.js "WHY THE LAST MILESTONE"). A
//     rejection dated after 'to' had not happened yet, so the row's rawStatus becomes
//     'In Progress' — the engine checks only the literals 'Order Cancelled' and
//     'Result Rejected', so ANY other status reads as a live, unrejected line. The
//     dating must use the ORIGINAL fields, read BEFORE the shift nulls them: a
//     rejected row received on 25 Sep with to=23 Sep has no `received` after the
//     shift, and dating it off what is left (its dispatch day) would wrongly keep it
//     rejected — and completed — on a day the sample had not even arrived.
//   • CANCELLATION — no timestamp at all, so a cancelled row stays cancelled: its
//     CURRENT status stands in for its status on 'to', exactly as asof.js does.
//
// BLANK FACILITIES ARE INFERRED ON THE FULL ROW SET, BEFORE ANY FILTER. The shared
// rule (engine/infer-facility.js) reads the OTHER orders of the same test, so its
// answer depends on WHICH rows it is shown — and on a subset it goes wrong both ways:
//   • it LOSES an attribution: a blank row in shipment X whose lab is only evident
//     from shipment Y would fall out of a lab-filtered report the full report credits
//     it to;
//   • it INVENTS one: a blank row whose test runs at two labs is, rightly, left
//     unattributed by the full report (the rule never takes a coin flip), but a subset
//     holding only ONE of those labs' rows for that test makes it look unambiguous and
//     credits the order to that lab — a count the full report never gives it.
// Inferring once, on the full set, closes both in applyScope's OUTPUT: every row
// carries the facility the full report gives it, and a blank that survives is one the
// full report also leaves blank, on purpose. SCOPED ROWS ARE THEREFORE FINAL. A
// consumer that re-runs the inference on them re-opens the second hole, and both
// consumers infer by default — compute() (fillBlankFacilities) and analyseSendout()
// (inferBlankFacilities) run it on whatever they are handed. A scoped build must have
// them skip that step, and ONLY a scoped one: unscoped, applyScope returns the rows
// uninferred and the consumers' own pass IS the full-set inference (byte-identical
// path). test/scope.test.mjs checks this end to end (ambiguous blank + shipment scope,
// through the review screen's buildOrderFigures). labOptions() lists labs off the same
// full-set inference, so the lab picker offers exactly the labs the filter can match.
//
// NORMALISATION IS THE SINGLE SOURCE OF TRUTH FOR "IS THIS SCOPED". isScoped,
// hasRange and applyScope all normalise their argument first, so they can never
// disagree about a half-typed or garbage scope: a scope that would filter nothing
// never labels a report «مخصص», and — the dangerous direction — a scope that DOES
// filter rows is never reported unscoped, which would let a side report write the
// published history (automation/pipeline.js recordRunSnapshot keys off isScoped).
// Only one date, or from > to, normalises to NO range: the review screen validates
// the pair and tells the user before it ever gets here.
//
// PURE: no DOM, no clock, no I/O, no logging. Never mutates its input — rows are
// shared with every other surface, and they are patient-adjacent, so nothing here
// writes them anywhere either.

import { normFacility } from '../contracts.js?v=v2026-10-05.2';
import { fillBlankFacilities } from '../engine/infer-facility.js?v=v2026-10-05.2';
import { parseDateTime, toEpochDay } from '../engine/workday.js?v=v2026-10-05.2';

// engine.js keys its cascade off these exact rawStatus literals (not exported), and
// asof.js mirrors them the same way; the three files must compare the same strings.
const RAW_CANCELLED = 'Order Cancelled';
const RAW_REJECTED = 'Result Rejected';
/** rawStatus given to a row whose rejection post-dates 'to'. Any non-cancelled,
 *  non-rejected literal reads identically to the engine; this one also reads
 *  honestly in the late-labs Excel, which prints Order Status verbatim. */
const RAW_NOT_YET_REJECTED = 'In Progress';

/** The milestone columns the as-of shift may blank. orderDate is not one: a kept
 *  row's order day is inside [from, to] by construction. */
const SHIFT_FIELDS = Object.freeze(['collected', 'dispatched', 'received', 'resulted']);

/** The mutually exclusive per-line buckets a shipment's status is read from.
 *  `rejected` is deliberately absent: it is a SUBSET of completed (below). */
const STATUS_BUCKETS = Object.freeze(['notShipped', 'inTransit', 'awaitingResult', 'completed', 'cancelled']);

/**
 * @typedef {Object} Scope
 * @property {string[]}    labs          normFacility names; [] = all labs (no filter)
 * @property {string[]}    shipments     normShipmentId ids; [] = no shipment filter
 * @property {string|null} from          'YYYY-MM-DD' — set iff `to` is set
 * @property {string|null} to            'YYYY-MM-DD' — also the scoped report's date
 * @property {boolean}     shipmentSlide show the «تفاصيل الشحنات» slide when shipments are chosen
 */

/**
 * The unscoped scope. Frozen ALL the way down — the inner arrays too — because it is
 * shared by reference: a caller that pushed a lab into EMPTY_SCOPE.labs would make
 * every later "reset to all labs" silently produce a lab-filtered report. Mutating it
 * throws (modules are strict) instead of corrupting it; build edits with
 * normalizeScope({ ...scope, labs: [...] }).
 * @type {Readonly<Scope>}
 */
export const EMPTY_SCOPE = Object.freeze({
  labs: Object.freeze([]), shipments: Object.freeze([]), from: null, to: null, shipmentSlide: true,
});

/** Excel INT() of a datetime string → midnight epoch-ms of that UTC day, or null.
 *  The engine's own parse (workday.js), so "is present" means what it means there. */
const dayOf = (s) => toEpochDay(parseDateTime(s));

/** 'YYYY-MM-DD' for a midnight epoch-ms (UTC). */
function isoOf(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Code-unit order: deterministic in node and every browser (localeCompare is not). */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** First occurrence wins, order kept. */
const dedupe = (arr) => [...new Set(arr)];

/**
 * A strict calendar date 'YYYY-MM-DD' (what <input type=date> yields), or null.
 * Round-tripped through Date.UTC so '2026-02-30' is rejected rather than rolled
 * into March — a silently moved range end is worse than a refused one.
 */
function isoDateOrNull(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return isoOf(Date.UTC(+m[1], +m[2] - 1, +m[3])) === iso ? iso : null;
}

/**
 * The canonical Shipment ID: trimmed, upper-cased. Used on BOTH sides of every
 * comparison (typed ids and row ids), so case and stray spaces can never make a
 * shipment look missing.
 * @param {*} v
 * @returns {string}
 */
export function normShipmentId(v) {
  return String(v ?? '').trim().toUpperCase();
}

/**
 * Split pasted/typed Shipment IDs. Separators: commas (Latin ',' and Arabic '،'),
 * semicolons (Latin ';' and Arabic '؛'), any whitespace incl. newlines. Each id is
 * normalised, blanks dropped, duplicates removed keeping first-seen order.
 * @param {*} text
 * @returns {string[]}
 */
export function parseShipmentIds(text) {
  return dedupe(
    String(text ?? '')
      .split(/[,،;؛\s]+/)
      .map(normShipmentId)
      .filter(Boolean),
  );
}

/** Ids from an array (or pasted text) → normalised, non-blank, deduped, order kept. */
function normIds(ids) {
  if (typeof ids === 'string') return parseShipmentIds(ids);
  if (!Array.isArray(ids)) return [];
  return dedupe(
    ids
      .filter((v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))
      .map(normShipmentId)
      .filter(Boolean),
  );
}

/**
 * Canonicalise any scope-ish value into a NEW Scope. Tolerates undefined and garbage.
 *   labs      → normFacility strings, blanks dropped, deduped (a lone string is one lab)
 *   shipments → normShipmentId, blanks dropped, deduped (a string is parsed as pasted text)
 *   from/to   → strict 'YYYY-MM-DD' or null. BOTH OR NEITHER: if either end is missing
 *               or invalid, or from > to, BOTH become null. The pair is never swapped or
 *               half-kept — the review screen validates and explains before calling this,
 *               and a guessed range would publish numbers for dates nobody chose.
 *   shipmentSlide → false only when explicitly false; default true.
 * @param {*} s
 * @returns {Scope}
 */
export function normalizeScope(s) {
  const src = isPlainObject(s) ? s : {};
  const rawLabs = typeof src.labs === 'string' ? [src.labs] : (Array.isArray(src.labs) ? src.labs : []);
  const labs = dedupe(rawLabs.filter((v) => typeof v === 'string').map(normFacility).filter(Boolean));
  const shipments = normIds(src.shipments);
  let from = isoDateOrNull(src.from);
  let to = isoDateOrNull(src.to);
  // ISO dates compare chronologically as strings.
  if (!from || !to || from > to) { from = null; to = null; }
  return { labs, shipments, from, to, shipmentSlide: src.shipmentSlide !== false };
}

/**
 * Does the (normalised) scope carry a date range? Normalises first — see the header's
 * single-source-of-truth note: for an already-normalised scope this is exactly
 * !!(s && s.from && s.to).
 * @param {*} s
 * @returns {boolean}
 */
export function hasRange(s) {
  const n = normalizeScope(s);
  return !!(n.from && n.to);
}

/**
 * Is this a SIDE report? True iff, after normalisation, any filter is active:
 * labs.length || shipments.length || (from && to). isScoped(undefined) === false,
 * which is what keeps the automation's model (it has no `scope`) a FULL report.
 * @param {*} s
 * @returns {boolean}
 */
export function isScoped(s) {
  const n = normalizeScope(s);
  return n.labs.length > 0 || n.shipments.length > 0 || !!(n.from && n.to);
}

/**
 * The lab picker's options: every performing lab with its NON-cancelled line count,
 * busiest first (then name, code-unit order). Blank facilities are inferred over the
 * FULL row set first — the engine's own rule — so a lab's count here is the count the
 * compliance table shows for it. Rows still blank after inference are omitted: they
 * belong to no lab, so no lab filter can ever select them.
 * @param {import('../contracts.js').OrderRow[]} rows
 * @returns {{lab:string, count:number}[]}
 */
export function labOptions(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const counts = new Map();
  for (const r of fillBlankFacilities(list)) {
    if (!r || r.rawStatus === RAW_CANCELLED) continue;
    const lab = normFacility(r.facility);
    if (!lab) continue;
    counts.set(lab, (counts.get(lab) || 0) + 1);
  }
  return [...counts]
    .map(([lab, count]) => ({ lab, count }))
    .sort((a, b) => b.count - a.count || byCodeUnit(a.lab, b.lab));
}

/**
 * Which requested Shipment IDs exist in the data at all? Checked against ALL rows —
 * unscoped, cancelled included — because the question is "did you type it right",
 * not "is it inside the other filters". Order of `ids` is kept (deduped).
 * @param {import('../contracts.js').OrderRow[]} rows
 * @param {string[]|string} ids
 * @returns {{found:string[], missing:string[]}}
 */
export function findShipments(rows, ids) {
  const present = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = normShipmentId(r && r.shipmentId);
    if (id) present.add(id);
  }
  const found = [];
  const missing = [];
  for (const id of normIds(ids)) (present.has(id) ? found : missing).push(id);
  return { found, missing };
}

/**
 * The day a REJECTED row's rejection is dated, from its ORIGINAL fields — the
 * engine/asof.js rule verbatim: the resulted day when present, else the last
 * milestone reached (received → dispatched → order day). null when none parses.
 */
function rejectionDay(row) {
  const resultedD = dayOf(row.resulted);
  if (resultedD != null) return resultedD;
  const receivedD = dayOf(row.received);
  if (receivedD != null) return receivedD;
  const dispatchedD = dayOf(row.dispatched);
  return dispatchedD != null ? dispatchedD : dayOf(row.orderDate);
}

/**
 * Narrow the order rows to a scope, returning a NEW array of NEW row objects (the
 * input array and its rows are never touched). Steps, in this order:
 *   1. infer blank facilities over the FULL input (see header). The facilities that
 *      come out are FINAL: a blank one is deliberately unattributed, and a consumer
 *      must not infer again on the scoped rows or a subset will "resolve" it
 *   2. labs     — keep rows whose normFacility is chosen (when any are)
 *   3. shipments — keep rows whose normShipmentId is chosen (when any are)
 *   4. range     — keep rows whose ORDER DAY is in [from, to] (no order date ⇒ dropped),
 *                  then time-shift each to 'to': a milestone dated after 'to' → null; a
 *                  rejection dated after 'to' → rawStatus 'In Progress'; cancelled stays.
 * UNSCOPED ⇒ a shallow copy of the array holding the SAME row objects, with no
 * inference and no copying — the engine then sees exactly what it sees today and runs
 * the full-set inference itself, which is what keeps every unscoped slide byte-identical.
 * @param {import('../contracts.js').OrderRow[]} rows
 * @param {*} scope  normalised here; see normalizeScope
 * @returns {import('../contracts.js').OrderRow[]}
 */
export function applyScope(rows, scope) {
  const list = Array.isArray(rows) ? rows : [];
  const sc = normalizeScope(scope);
  if (!isScoped(sc)) return list.slice();

  const labSet = sc.labs.length ? new Set(sc.labs) : null;
  const shipSet = sc.shipments.length ? new Set(sc.shipments) : null;
  const fromDay = sc.from ? dayOf(sc.from) : null;
  const toDay = sc.to ? dayOf(sc.to) : null;
  const ranged = fromDay != null && toDay != null;

  const out = [];
  for (const r of fillBlankFacilities(list)) {
    if (!r) continue;
    if (labSet && !labSet.has(normFacility(r.facility))) continue;
    if (shipSet && !shipSet.has(normShipmentId(r.shipmentId))) continue;
    if (!ranged) { out.push({ ...r }); continue; }

    const orderD = dayOf(r.orderDate);
    if (orderD == null || orderD < fromDay || orderD > toDay) continue;

    const next = { ...r };
    // Date the rejection BEFORE the shift below blanks the fields it is dated from.
    // Mirrors asof.js `rejectedByAsOf`: rejected only if its dated day exists and is ≤ to.
    if (r.rawStatus === RAW_REJECTED) {
      const d = rejectionDay(r);
      if (d == null || d > toDay) next.rawStatus = RAW_NOT_YET_REJECTED;
    }
    for (const f of SHIFT_FIELDS) {
      const d = dayOf(r[f]);
      // Day-granular, like every as-of test: a milestone ON 'to' (any hour) happened.
      // An unparseable value is left verbatim — the engine already reads it as absent.
      if (d != null && d > toDay) next[f] = null;
    }
    out.push(next);
  }
  return out;
}

/**
 * One summary per requested shipment for the «تفاصيل الشحنات» slide, read off the
 * SCOPED rows (so under a date range it describes the shipment as of 'to'). Ids with no
 * scoped row are omitted — findShipments already warned about ids missing from the data,
 * and an id filtered out by the other scope filters has nothing to show. Input order.
 *
 * Per line, first match wins:
 *   'Order Cancelled'                       → cancelled
 *   resulted date OR 'Result Rejected'      → completed   (rejected ALSO → counts.rejected)
 *   received date                           → awaitingResult
 *   dispatched date                         → inTransit
 *   otherwise                               → notShipped
 * counts.rejected is a SUBSET of counts.completed — the app's rule since 2026-07-28
 * (engine.js isCompleted: a rejection is a lab's final outcome) — never add the two.
 * status = the single non-zero bucket among notShipped / inTransit / awaitingResult /
 * completed / cancelled, else 'mixed'.
 * dispatched = the EARLIEST dispatch day (when the shipment left); received = the LATEST
 * receipt day (when its last line arrived). Both 'YYYY-MM-DD' or null.
 * @param {import('../contracts.js').OrderRow[]} scopedRows
 * @param {string[]|string} ids
 * @returns {{id:string, labs:string[], lines:number, orders:number, dispatched:(string|null),
 *   received:(string|null), counts:{notShipped:number, inTransit:number, awaitingResult:number,
 *   completed:number, rejected:number, cancelled:number}, status:string}[]}
 */
export function shipmentDetails(scopedRows, ids) {
  const wanted = normIds(ids);
  if (!wanted.length) return [];
  const wantedSet = new Set(wanted);
  const byId = new Map();
  for (const r of Array.isArray(scopedRows) ? scopedRows : []) {
    const id = normShipmentId(r && r.shipmentId);
    if (!wantedSet.has(id)) continue;
    let g = byId.get(id);
    if (!g) { g = []; byId.set(id, g); }
    g.push(r);
  }
  return wanted.filter((id) => byId.has(id)).map((id) => summariseShipment(id, byId.get(id)));
}

function summariseShipment(id, rows) {
  const labs = new Set();
  const orders = new Set();
  let firstDispatched = null;
  let lastReceived = null;
  const counts = { notShipped: 0, inTransit: 0, awaitingResult: 0, completed: 0, rejected: 0, cancelled: 0 };
  for (const r of rows) {
    const lab = normFacility(r.facility);
    if (lab) labs.add(lab);
    const orderId = r.orderId == null ? '' : String(r.orderId).trim();
    if (orderId) orders.add(orderId);
    const dispatchedD = dayOf(r.dispatched);
    const receivedD = dayOf(r.received);
    if (dispatchedD != null && (firstDispatched == null || dispatchedD < firstDispatched)) firstDispatched = dispatchedD;
    if (receivedD != null && (lastReceived == null || receivedD > lastReceived)) lastReceived = receivedD;

    if (r.rawStatus === RAW_CANCELLED) counts.cancelled++;
    else if (dayOf(r.resulted) != null || r.rawStatus === RAW_REJECTED) {
      counts.completed++;
      if (r.rawStatus === RAW_REJECTED) counts.rejected++;
    } else if (receivedD != null) counts.awaitingResult++;
    else if (dispatchedD != null) counts.inTransit++;
    else counts.notShipped++;
  }
  const live = STATUS_BUCKETS.filter((k) => counts[k] > 0);
  return {
    id,
    labs: [...labs].sort(byCodeUnit),
    lines: rows.length,
    orders: orders.size,
    dispatched: firstDispatched == null ? null : isoOf(firstDispatched),
    received: lastReceived == null ? null : isoOf(lastReceived),
    counts,
    status: live.length === 1 ? live[0] : 'mixed',
  };
}
