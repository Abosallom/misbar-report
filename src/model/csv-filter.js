// model/csv-filter.js — the OPTIONAL filtered-CSV download on the upload screen
// (ui/csv-export-section.js, strings in STR.upload.csvExport): pick labs and order
// stages, get back THE FILE THE USER UPLOADED, cut down to the matching orders.
//
// WHY THE ORIGINAL ROWS, NOT OrderRow. The user wants their own export back — every
// column, patient name, national id and MRN included — so they can work a list ("what
// has Lab B not received yet?") outside the app. OrderRow deliberately carries none of
// those columns (contracts.js), so this module never rebuilds a row from OrderRow: it
// SELECTS orders by their OrderRow fields and then copies the matching ORIGINAL
// records out of raw (ingest/csv.js `raw`, held in state.parsed.raw) by lineNo — the
// index ingest/csv.js gave each order into Papa's res.data. Values, column order and
// header text are the file's own; nothing is re-formatted, re-dated or re-labelled.
//
// PRIVACY. raw holds patient data, so the posture is the app's usual one, enforced
// here by construction: PURE (no DOM, no clock, no I/O, no storage), NOTHING IS
// LOGGED, and every Error message is a fixed sentence that carries no row value —
// the UI may surface or log it, and an error must never become the leak. The only way
// a record leaves the browser is the string buildFilteredCsv returns, which the UI
// hands to the user as the file they explicitly asked to download. The Grafana pull
// and the encrypted snapshot have no raw at all (no patient columns exist there), so
// this tool is CSV-upload-only and buildFilteredCsv refuses a missing raw.
//
// STAGES — every order line sits in EXACTLY ONE of seven, so the counts partition the
// lines and the user can never tick two boxes that export the same row twice:
//   • STATUS-DECIDED, outside the ladder, checked first: 'Order Cancelled' →
//     cancelled, 'Result Rejected' → rejected. A cancelled or rejected line is
//     finished whatever dates it carries; filing it by its dates would put a dead
//     order in «لم تصدر النتيجة بعد» and send the user chasing a lab for it.
//   • THE LADDER, by the LAST milestone the line reached: resulted → resulted;
//     received → notResulted; dispatched (shipped) → notReceived; collected →
//     notShipped; none → notCollected. The procedure is sequential, so a later date
//     WINS even in an anomalous row: a line with a result but no receipt date WAS
//     received (the lab could not result a sample it never had — the receipt scan is
//     what is missing), so it is resulted, not "not received". Reading the FIRST gap
//     instead would list finished orders as outstanding.
// A milestone counts when its field parses with engine/workday.js parseDateTime — the
// engine's own presence test, so an unparseable date is absent here exactly as it is
// absent from every number in the report.
//
// THESE ARE NOT THE REPORT'S BUCKETS, on purpose. The report folds a rejection into
// «مكتملة» (engine.js, 2026-07-28) and leaves cancelled lines out of every count; this
// tool keeps both as their own ticks, because a file of "what was rejected" or "what
// was cancelled" is precisely what a user pulls a list for. So `resulted` here is the
// report's completed MINUS its rejected, and the totals include cancelled lines —
// never compare the two one-for-one.
//
// THE CONTIGUITY RULE (the user's): ticked LADDER stages must be NEIGHBOURS. «لم تُشحن
// بعد» + «لم تصدر النتيجة بعد» without «لم تُستلم بعد» describes no real slice of the
// pipeline — every order between the two had to pass through the middle step — so a
// gap is refused twice over: canToggle makes it impossible to build in the UI, and
// filterOrders throws on one, so no caller can export a gapped selection silently.
// rejected / cancelled are independent ticks and never affect contiguity.
//
// LABS — compared by normFacility, with blank facilities inferred over the FULL order
// set first (engine/infer-facility.js), exactly as model/scope.js does and for the
// same reason: inference reads the other orders of the same test, and running it on a
// subset both LOSES attributions and INVENTS them (see scope.js's header). Selection
// runs on the inferred view, but filterOrders returns the ORIGINAL row objects, so the
// exported record is the file's own — a blank facility stays blank in the CSV, it is
// only COUNTED under the lab the report credits it to.
//
// NO "SMART" CSV ESCAPING. The output is Papa.unparse's standard quoting (comma, quote,
// newline, edge-space values get quoted) — values come back byte-for-byte. Formula
// escaping (a ' before = + - @) is deliberately OFF: it would alter values, and the
// cells are the user's own export returning to them. One Papa 5.4 quirk is inherited,
// not introduced: a DUPLICATED header name is renamed on parse ('X' → 'X_1'), so such
// a column would come back renamed. The KAMC export has no duplicated headers.

import { normFacility } from '../contracts.js?v=v2026-10-05.2';
import { fillBlankFacilities } from '../engine/infer-facility.js?v=v2026-10-05.2';
import { parseDateTime } from '../engine/workday.js?v=v2026-10-05.2';

/** The sequential stages, in pipeline order. A selection must be one unbroken run. */
export const LADDER = Object.freeze(['notCollected', 'notShipped', 'notReceived', 'notResulted', 'resulted']);

/** Stages decided by Order Status alone — independent ticks, outside the ladder. */
export const STATUS_STAGES = Object.freeze(['rejected', 'cancelled']);

/** Every stage key, in the order stageCounts reports them. */
const ALL_STAGES = Object.freeze([...LADDER, ...STATUS_STAGES]);
const KNOWN_STAGES = new Set(ALL_STAGES);

// engine.js keys its cascade off these exact rawStatus literals (scope.js and asof.js
// mirror them the same way): a status the engine reads as live must read as live here.
const RAW_CANCELLED = 'Order Cancelled';
const RAW_REJECTED = 'Result Rejected';

/** The column ingest/csv.js reads OrderRow.orderId from — the staleness check's key. */
const ORDER_ID_COL = 'Order ID';

/** The name filteredFileName falls back to: the KAMC export's own file-name stem. */
const DEFAULT_BASE_NAME = 'KAMC Order details';

/** The filtered file's marker. Matched on re-filter so suffixes never stack. */
const FILTERED_MARK = 'مُصفّى';
const FILTERED_SUFFIX_RE = new RegExp(`\\s+-\\s+${FILTERED_MARK}(?:\\s+\\d{8})?$`, 'u');

/** Has the line reached this milestone? The engine's own presence test. */
const reached = (v) => parseDateTime(v) != null;

const isRow = (r) => r !== null && typeof r === 'object';

/** Code-unit order: deterministic in node and every browser (localeCompare is not). */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A key list from an array, a Set or one lone string; anything else is "none". */
function toKeys(v) {
  if (Array.isArray(v)) return v;
  if (v instanceof Set) return [...v];
  if (typeof v === 'string') return [v];
  return [];
}

/** Sorted, distinct LADDER indices of the ladder members of `keys` (others ignored). */
function ladderIndices(keys) {
  const idx = new Set();
  for (const k of toKeys(keys)) {
    const i = LADDER.indexOf(k);
    if (i >= 0) idx.add(i);
  }
  return [...idx].sort((a, b) => a - b);
}

/** One unbroken run? `idx` sorted and distinct; empty counts as a run. */
const isRun = (idx) => idx.length === 0 || idx[idx.length - 1] - idx[0] + 1 === idx.length;

/**
 * The single stage a line sits in. Status first (cancelled, rejected), then the LAST
 * milestone reached — see the header for why a later date wins over an earlier gap.
 * Never throws: a non-object reads as a line with nothing reached.
 * @param {import('../contracts.js').OrderRow} row
 * @returns {'notCollected'|'notShipped'|'notReceived'|'notResulted'|'resulted'|'rejected'|'cancelled'}
 */
export function stageOf(row) {
  const r = isRow(row) ? row : {};
  if (r.rawStatus === RAW_CANCELLED) return 'cancelled';
  if (r.rawStatus === RAW_REJECTED) return 'rejected';
  if (reached(r.resulted)) return 'resulted';
  if (reached(r.received)) return 'notResulted';
  if (reached(r.dispatched)) return 'notReceived';
  if (reached(r.collected)) return 'notShipped';
  return 'notCollected';
}

/**
 * Do the LADDER members of `stageKeys` form one unbroken run in LADDER order?
 * Order of the input, duplicates, status stages and unknown keys are all irrelevant;
 * no ladder member at all → true («كل المراحل» / status-only is never a gap).
 * @param {string[]|Set<string>} stageKeys
 * @returns {boolean}
 */
export function isContiguous(stageKeys) {
  return isRun(ladderIndices(stageKeys));
}

/**
 * May the UI flip `key` given the current `selected`? STATUS_STAGES → always.
 * LADDER → only when the selection AFTER the flip is still one run. For a contiguous
 * selection — the only kind this rule lets the UI build — that is exactly: ADD when
 * nothing on the ladder is ticked or `key` sits right next to either end of the run;
 * REMOVE only an end of the run (or its sole member). Unticking a middle stage would
 * split the run, so it is refused, not "repaired" by guessing which half to keep.
 *
 * A GAPPED `selected` can only come from outside this rule (a bug, a hand-built
 * state). There every REMOVAL is allowed too — otherwise a selection like
 * {notCollected, notReceived, resulted} would have no legal move at all and the user
 * would be stuck — while an ADDITION still has to close the gap. Unknown key → false:
 * there is no such box to tick.
 * @param {string[]|Set<string>} selected
 * @param {string} key
 * @returns {boolean}
 */
export function canToggle(selected, key) {
  if (STATUS_STAGES.includes(key)) return true;
  const i = LADDER.indexOf(key);
  if (i < 0) return false;
  const cur = ladderIndices(selected);
  const removing = cur.includes(i);
  const next = removing ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b);
  if (isRun(next)) return true;
  return removing && !isRun(cur);
}

/** Lab names → a Set of normFacility names, blanks dropped; empty → null (no filter). */
function labSetOf(labs) {
  const set = new Set();
  for (const l of toKeys(labs)) {
    if (typeof l !== 'string') continue;
    const n = normFacility(l);
    if (n) set.add(n);
  }
  return set.size ? set : null;
}

/**
 * The ORIGINAL row objects of `orders` in the chosen labs, input order. Labs are
 * matched on the FULL-SET inferred facility (header): fillBlankFacilities maps 1:1 by
 * index, so position i of its output is row i's inferred view, and row i itself is
 * what is kept. No labs → every row (an uninferable blank included: «كل المختبرات» is
 * no filter, not "every named lab").
 */
function rowsInLabs(orders, labs) {
  const list = Array.isArray(orders) ? orders : [];
  const labSet = labSetOf(labs);
  if (!labSet) return list.filter(isRow);
  const inferred = fillBlankFacilities(list);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (!isRow(list[i])) continue;
    if (labSet.has(normFacility(inferred[i].facility))) out.push(list[i]);
  }
  return out;
}

/**
 * Lines per stage over the orders in the chosen labs (labs empty = all). All seven
 * keys are always present, LADDER order then STATUS_STAGES; they PARTITION the lines,
 * so they sum to the number of lines in those labs (cancelled included).
 * @param {import('../contracts.js').OrderRow[]} orders
 * @param {string[]} [labs]
 * @returns {{notCollected:number, notShipped:number, notReceived:number, notResulted:number,
 *   resulted:number, rejected:number, cancelled:number}}
 */
export function stageCounts(orders, labs) {
  const counts = {};
  for (const k of ALL_STAGES) counts[k] = 0;
  for (const r of rowsInLabs(orders, labs)) counts[stageOf(r)]++;
  return counts;
}

/**
 * The lab picker's options: every performing lab with its line count, busiest first
 * (then name, code-unit order). model/scope.js labOptions semantics — the same
 * full-set inference, the same omission of rows still blank after it (no lab filter
 * can select them; they export only under «كل المختبرات») — with ONE deliberate
 * difference: CANCELLED LINES COUNT. labOptions sizes a REPORT, which never counts a
 * cancelled line; this sizes a FILE, which holds them and can export them («ملغاة»).
 * So a lab's number here can exceed the review screen's by its cancelled lines.
 * @param {import('../contracts.js').OrderRow[]} orders
 * @returns {{lab:string, count:number}[]}
 */
export function labCounts(orders) {
  const list = Array.isArray(orders) ? orders : [];
  const counts = new Map();
  for (const r of fillBlankFacilities(list)) {
    if (!isRow(r)) continue;
    const lab = normFacility(r.facility);
    if (!lab) continue;
    counts.set(lab, (counts.get(lab) || 0) + 1);
  }
  return [...counts]
    .map(([lab, count]) => ({ lab, count }))
    .sort((a, b) => b.count - a.count || byCodeUnit(a.lab, b.lab));
}

/** lineNo as a sort key: a finite number, else last (the stable sort keeps input order). */
const lineKey = (r) => (typeof r.lineNo === 'number' && Number.isFinite(r.lineNo) ? r.lineNo : Infinity);

/**
 * The orders to export: the ORIGINAL OrderRow objects (never copies — the caller maps
 * them back to raw by lineNo), sorted by lineNo so the file keeps the upload's row
 * order. labs → see rowsInLabs (empty = all). stages → empty = all, else
 * stageOf(row) ∈ stages.
 * THROWS on a ladder gap (the user's rule; the UI cannot build one, so a gap here is
 * a bug that must not quietly export a wrong slice) and on an unknown stage key (a
 * typo would otherwise match nothing and hand the user an empty file that looks like
 * a real answer).
 * @param {import('../contracts.js').OrderRow[]} orders
 * @param {{labs?:string[], stages?:string[]}} [opts]
 * @returns {import('../contracts.js').OrderRow[]}
 */
export function filterOrders(orders, opts = {}) {
  const { labs = [], stages = [] } = isRow(opts) ? opts : {};
  const stageList = toKeys(stages);
  for (const k of stageList) {
    if (!KNOWN_STAGES.has(k)) throw new Error('csv-filter: unknown stage key in the selection');
  }
  if (!isContiguous(stageList)) {
    throw new Error('csv-filter: the selected stages skip a step — tick neighbouring stages only');
  }
  const stageSet = stageList.length ? new Set(stageList) : null;
  const kept = rowsInLabs(orders, labs).filter((r) => !stageSet || stageSet.has(stageOf(r)));
  // Equal keys (two non-finite lineNos) compare as 0 explicitly — Infinity − Infinity
  // is NaN — so the stable sort keeps their input order.
  return kept.sort((a, b) => {
    const x = lineKey(a);
    const y = lineKey(b);
    return x === y ? 0 : x - y;
  });
}

/**
 * The original record behind one order — guarded, because a raw that does not belong
 * to these orders would export SOMEONE ELSE'S patient row under this order's slot.
 * state.js resets raw whenever the orders change source, and this is the backstop:
 * lineNo must index a record, and that record's Order ID must be this order's
 * (ingest/csv.js derives orderId from that very cell, trimmed — they cannot differ
 * when raw and orders come from one parse). The messages name no value.
 */
function recordOf(raw, order) {
  const n = isRow(order) ? order.lineNo : null;
  const rec = Number.isInteger(n) && n >= 0 && n < raw.records.length ? raw.records[n] : null;
  if (!isRow(rec)) {
    throw new Error('csv-filter: an order has no original row in the uploaded file — re-upload the CSV');
  }
  if (raw.fields.includes(ORDER_ID_COL)
      && String(rec[ORDER_ID_COL] ?? '').trim() !== String(order.orderId ?? '').trim()) {
    throw new Error('csv-filter: the original rows do not match the loaded orders — re-upload the CSV');
  }
  return rec;
}

/**
 * The filtered file's text: a UTF-8 BOM (Excel otherwise opens Arabic as mojibake),
 * then Papa.unparse of the header raw.fields in the file's own order and, per order,
 * its original record's value for each field ('' for a field the record lacks — a
 * short row in the source), CRLF line endings like the KAMC export. Papa.parse strips
 * the BOM, so the file also re-uploads into this app cleanly.
 * Throws when raw is missing (the data did not come from a CSV upload) or does not
 * belong to `orders` (recordOf). Never mutates raw or the orders.
 * @param {{fields:string[], records:Object[]}|null} raw  state.parsed.raw
 * @param {import('../contracts.js').OrderRow[]} orders  usually filterOrders' output
 * @param {*} Papa  the PapaParse library (injected, as everywhere in this app)
 * @returns {string}
 */
export function buildFilteredCsv(raw, orders, Papa) {
  if (!isRow(raw) || !Array.isArray(raw.fields) || !Array.isArray(raw.records)) {
    throw new Error('csv-filter: no uploaded CSV rows in memory — this works with an uploaded CSV file only');
  }
  const fields = raw.fields.slice();
  const data = (Array.isArray(orders) ? orders : []).map((o) => {
    const rec = recordOf(raw, o);
    return fields.map((f) => rec[f] ?? '');
  });
  return '\uFEFF' + Papa.unparse({ fields, data }, { newline: '\r\n' });
}

/**
 * The download's name: '<upload name minus a trailing .csv> - مُصفّى <DDMMYYYY>.csv'.
 * Keeping the upload's own name says which export the slice came from; the mark says
 * it is NOT that export. A name that is already a filtered file's loses its old mark
 * first, so a re-upload filtered again does not grow '- مُصفّى … - مُصفّى …'. Blank
 * name → the KAMC export's stem. A date that is not 'YYYY-MM-DD…' drops the date part
 * rather than printing garbage (the same prefix rule as i18n compactDate).
 * @param {string} baseName  state.files.csv?.name
 * @param {string} isoDate  'YYYY-MM-DD' — the day of the download
 * @returns {string}
 */
export function filteredFileName(baseName, isoDate) {
  const stem = String(baseName ?? '').trim().replace(/\.csv$/i, '').trim()
    .replace(FILTERED_SUFFIX_RE, '').trim();
  const base = stem || DEFAULT_BASE_NAME;
  const m = String(isoDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const datePart = m ? ` ${m[3]}${m[2]}${m[1]}` : '';
  return `${base} - ${FILTERED_MARK}${datePart}.csv`;
}
