// model/hospital.js — WHICH HOSPITAL an order line was ordered by, and the KAMC-only cut.
// Pure: no imports, no DOM, no I/O. Never logs or persists a row.
//
// WHY THIS EXISTS. Until 2026-09-28 the order feed carried ONE ordering hospital (KAMC),
// with its send-out labs beneath it, so "every row" and "every KAMC row" were the same
// set and nothing had to say which hospital a row came from. From 2026-09-28 the feed
// (Grafana, and the user's own CSV export) also carries a SECOND hospital — Saudi German
// Hospital, Alzahraa Branch — whose orders have their own labs beneath it, and ingest
// now reads the new hospital columns into OrderRow.hospital / orderingFacilityId
// (ingest/csv.js findHospitalColumns). Those orders were silently counted in every
// report.
//
// THE USER INSTRUCTION (2026-10-07): "work like normally you do but ignore SGH" — until
// the user says how to treat it, ONLY KAMC orders count, everywhere the app consumes
// orders (engine numbers, slides, per-lab files, drafts, automation). SGH — and any
// other hospital that appears — is IGNORED, not deleted: scripts/fetch-kamc.mjs still
// encrypts EVERY row into data/kamc-live.enc, so the other hospital's history is there
// the day the user decides. Every place rows enter the app goes through takeKamcOrders()
// (below), which keeps the KAMC rows; `excluded` is for an APP-SCREEN notice only. A
// hospital NAME must never reach a slide (standing user rule — the deck is shared beyond
// the project).
//
// THE SINGLE SWITCH. KAMC_FACILITY_ID is the one place the decision lives. When the user
// says how to treat SGH, change the rule HERE (e.g. widen it to a set of ids, or split
// per hospital) rather than adding a second filter somewhere downstream.

/** KAMC's ordering-facility id in the source system ('Ordering facility ID' / facility_id).
 *  The ONLY hospital whose orders count (user instruction 2026-10-07, see header). */
export const KAMC_FACILITY_ID = '31763';

// Name fallback, used ONLY when a row carries no facility id. The source spells KAMC
// 'King Abdul ah Medical City' (sic — a dropped "l"); a corrected 'King Abdullah …' must
// still match, hence the loose `king\s*abdul`. The negative lookahead keeps out King
// ABDULAZIZ Medical City (NGHA): a DIFFERENT hospital that already appears in this app
// as a send-out lab (seeds/lab-contacts.js), so it is a plausible future ordering
// hospital that a bare /king\s*abdul/ would wrongly count as KAMC.
const KAMC_NAME_RE = /king\s*abdul(?!\s*-?\s*aziz)/i;

/** '' for null/undefined/blank, else the trimmed string (ids may arrive as numbers). */
const text = (v) => (v == null ? '' : String(v).trim());

/**
 * Is this order line a KAMC order (i.e. one that counts)?
 *   1. a facility id is present → it is KAMC iff it equals KAMC_FACILITY_ID. The id is
 *      authoritative: a name can be re-spelled by the source (it already is misspelled),
 *      an id cannot.
 *   2. no id, but a hospital name → KAMC iff the name matches KAMC_NAME_RE.
 *   3. neither → KAMC. Files and snapshots that PREDATE the hospital columns were
 *      single-hospital, i.e. all KAMC, and they — the golden fixture included — must
 *      keep producing exactly the numbers they always did.
 * @param {import('../contracts.js').OrderRow} row
 * @returns {boolean}
 */
export function isKamcRow(row) {
  if (!row) return false;
  const id = text(row.orderingFacilityId);
  if (id !== '') return id === KAMC_FACILITY_ID;
  const name = text(row.hospital);
  if (name !== '') return KAMC_NAME_RE.test(name);
  return true;
}

/**
 * Split order lines into the KAMC rows that count and a per-hospital tally of the rest.
 * `kept` holds the ORIGINAL row objects in their ORIGINAL order — no copy, no re-sort —
 * so lineNo (the CSV path's key back into raw.records) and every identity-based lookup
 * downstream keep working unchanged. Nothing is mutated.
 * `excluded` is one entry per ignored hospital, keyed by its id (else its name), with
 * `count` = order LINES (the engine's grain: one test on one order), sorted by count
 * descending (ties by label, so the order never depends on row order). `name` is the
 * whitespace-collapsed hospital name (first one seen for that id), `id` its facility id;
 * either may be null. An empty `excluded` means nothing was ignored.
 * @param {import('../contracts.js').OrderRow[]} rows
 * @returns {{kept: import('../contracts.js').OrderRow[], excluded: {id:(string|null), name:(string|null), count:number}[]}}
 */
export function splitByHospital(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const kept = [];
  const dropped = [];
  for (const row of list) {
    if (isKamcRow(row)) kept.push(row);
    else if (row) dropped.push(row); // a hole in the array is neither a KAMC order nor a hospital
  }
  // ONE notice line per hospital, however its rows are labelled. A hospital's rows can
  // carry its id on some lines and only its name on others (a blank cell); keyed by id
  // OR name, that became two lines naming the same hospital. So: learn every id → name
  // pairing first, then key each dropped row by its NAME (its own, or the one its id is
  // known by), falling back to the id only when no name is known at all.
  const nameOfId = new Map();
  for (const row of dropped) {
    const id = text(row.orderingFacilityId);
    const name = text(row.hospital).replace(/\s+/g, ' ');
    if (id && name && !nameOfId.has(id)) nameOfId.set(id, name);
  }
  const groups = new Map();
  for (const row of dropped) {
    const id = text(row.orderingFacilityId) || null;
    const name = text(row.hospital).replace(/\s+/g, ' ') || (id != null ? nameOfId.get(id) : null) || null;
    // Prefixed keys: a name and a bare id can never collide into one group.
    const key = name != null ? `name:${name.toLowerCase()}` : `id:${id}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (g.id == null && id != null) g.id = id;
    } else {
      groups.set(key, { id, name, count: 1 });
    }
  }
  const label = (g) => g.name ?? g.id ?? '';
  const excluded = [...groups.values()].sort(
    (a, b) => b.count - a.count || label(a).localeCompare(label(b)),
  );
  return { kept, excluded };
}

/**
 * Put a source's order rows into `parsed` — the ONE place the app takes orders in, so
 * every screen and the unattended pipeline count the same hospital's rows. It used to
 * exist twice, verbatim (screen-upload.js and automation/pipeline.js); a change to one
 * copy would have made the deck and the automatic run count different populations.
 * Writes `orders` (the KAMC rows) and `excludedHospitals` together, so the on-screen
 * notice always describes the orders in state. When no row was dropped the source's own
 * array is assigned untouched (kept is an in-order subsequence, so equal length means
 * equal content), so a single-hospital source behaves exactly as before.
 * Never throws: a non-array `rows` assigns an empty array and no notice.
 * ORDER on the CSV path: state.js's accessor drops parsed.raw whenever orders are
 * reassigned, so the caller assigns raw AFTER this. Filtering rows out does not misalign
 * the filtered-CSV download — raw.records stay indexed by each kept row's own lineNo.
 * @param {{orders:any, excludedHospitals:any}} parsed  the state.parsed object to write
 * @param {Array} rows
 * @returns {Array} what was assigned to parsed.orders
 */
export function takeKamcOrders(parsed, rows) {
  const { kept, excluded } = splitByHospital(rows);
  const orders = Array.isArray(rows) && kept.length === rows.length ? rows : kept;
  parsed.orders = orders;
  parsed.excludedHospitals = excluded;
  return orders;
}
