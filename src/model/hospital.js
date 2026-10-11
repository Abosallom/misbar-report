// model/hospital.js — WHICH HOSPITAL an order line was ordered by: the hospital registry,
// the row classifier and the ONE door every source's rows come in through.
// Pure: no imports, no DOM, no I/O. Never logs or persists a row.
//
// WHY THIS EXISTS. Until 2026-09-28 the order feed carried ONE ordering hospital (KAMC),
// with its send-out labs beneath it, so "every row" and "every KAMC row" were the same
// set and nothing had to say which hospital a row came from. From 2026-09-28 the feed
// (Grafana, and the user's own CSV export) also carries a SECOND hospital — Saudi German
// Hospital, Alzahraa Branch (SGH) — whose orders have their own labs beneath it, and
// ingest reads the hospital columns into OrderRow.hospital (facility_name) /
// orderingFacilityId (ingest/csv.js findHospitalColumns).
//
// THE RULES (user decisions 2026-10-07 and 2026-10-11, the three report types):
//   • KAMC and SGH are both REPORTED hospitals, each always computed on its OWN rows —
//     never one engine call over the union (the KAMC TAT table, CSV TAT fallback,
//     cancelled-by-month constants, snapshot and send-out catalogue are KAMC's alone).
//     The KAMC report is exactly the report the app always made; an SGH report and a
//     KAMC+SGH ("BOTH") report sit beside it (model/hospital-report.js).
//   • SGH has NO Test Menu yet: no TAT, so no lateness, no turnaround, no country and no
//     reference lab for its orders — only counts and stages. HOSPITALS.sgh.hasTestMenu
//     is the switch; engine/tat.js, engine/engine.js, engine/asof.js and
//     model/sendout.js all consult hasTestMenu() so a stray SGH row can never borrow
//     KAMC's numbers even if a caller mixes the hospitals by mistake.
//   • ANY OTHER hospital is never counted anywhere — only mentioned (an app-screen
//     notice from parsed.excludedHospitals). A row with a facility id that is not one
//     of ours is such a hospital whatever its name says (hospitalOf step 1). It is IGNORED, not deleted:
//     scripts/fetch-kamc.mjs still encrypts EVERY row into data/kamc-live.enc.
//   • state.parsed.orders STAYS the KAMC rows: every existing consumer (hero tiles,
//     unmatched-TAT panel + suggestions + auto-accept, late-lab files and drafts, the
//     filtered CSV, the settings lab list, the unattended automation) keeps reading the
//     one hospital whose Test Menu the app holds. The other hospital's rows live beside
//     them in parsed.ordersByHospital (takeOrders below).
//   • Hospital NAMES on slides: the KAMC report keeps the standing rule — no hospital
//     name on any of its slides. The SGH and BOTH decks print the names the user's
//     reference deck prints (KAMC, SGH, «مستشفى الألماني السعودي»), at the user's
//     explicit request; the registry's `code` / `arName` are those names.
//
// THE SINGLE SWITCH. HOSPITALS (below) is the one place the hospital decision lives.
// When a hospital gains a Test Menu or a new one is admitted, change it HERE rather than
// adding a filter somewhere downstream.

/** KAMC's ordering-facility id in the source system ('Ordering facility ID' / facility_id). */
export const KAMC_FACILITY_ID = '31763';
/** SGH's ordering-facility id in the source system. */
export const SGH_FACILITY_ID = '1037';

/**
 * The reported hospitals, in display order. `id` = the source's ordering-facility id;
 * `code` = the short name the BOTH / SGH decks print; `hasTestMenu` = whether the app
 * holds a TAT / country catalogue for this hospital's tests (false ⇒ no TAT, lateness,
 * turnaround, country or reference lab is ever derived for its rows); `arName` = the
 * Arabic name the reference deck prints for a hospital WITHOUT a Test Menu note.
 */
export const HOSPITALS = Object.freeze({
  kamc: Object.freeze({ key: 'kamc', code: 'KAMC', id: KAMC_FACILITY_ID, hasTestMenu: true }),
  sgh: Object.freeze({
    key: 'sgh', code: 'SGH', id: SGH_FACILITY_ID, hasTestMenu: false, arName: 'مستشفى الألماني السعودي',
  }),
});

/** The three report types the review screen offers ('both' = KAMC + SGH, the main weekly
 *  report and the default; 'kamc' / 'sgh' = single-hospital reports, tagged in file names). */
export const HOSPITAL_MODES = Object.freeze(['kamc', 'sgh', 'both']);

// KAMC's NAME. The source spells KAMC 'King Abdul ah Medical City' (sic — a dropped "l");
// a corrected 'King Abdullah …' must still match, hence the loose `king\s*abdul`. The
// negative lookahead keeps out King ABDULAZIZ Medical City (NGHA): a DIFFERENT hospital
// that already appears in this app as a send-out lab (seeds/lab-contacts.js), so it is a
// plausible future ordering hospital that a bare /king\s*abdul/ would wrongly count as KAMC.
const KAMC_NAME_RE = /king\s*abdul(?!\s*-?\s*aziz)/i;
// SGH's NAME: 'Saudi German Hospital  Alzahraa Branch' (the source writes a double space;
// ingest collapses it). Matched loosely on «Saudi German» — the user's instruction names
// the hospital, not the branch.
const SGH_NAME_RE = /saudi\s*german/i;

/** Name matchers per registry key, tried in HOSPITALS order. Private: the rule, not data. */
const NAME_RES = [['kamc', KAMC_NAME_RE], ['sgh', SGH_NAME_RE]];

/** '' for null/undefined/blank, else the trimmed string (ids may arrive as numbers). */
const text = (v) => (v == null ? '' : String(v).trim());

// Names of hospitals KNOWN not to be ours. King ABDULAZIZ Medical City (NGHA) shares the
// "King Abdul…" stem with KAMC's name (see KAMC_NAME_RE); a row that names it is a third
// hospital even when it carries one of OUR ids — the id must not quietly re-admit a
// hospital the name rule exists to keep out. Matched on the name only.
const FOREIGN_NAME_RES = [/king\s*abdul\s*-?\s*aziz/i];

/** Registry key for a facility id, or undefined when the id is not one of ours. */
const keyOfId = (id) => Object.keys(HOSPITALS).find((key) => HOSPITALS[key].id === id);

/**
 * Which reported hospital ordered this line?
 *   1. a FOREIGN id — non-empty and not a registry id ('31763' / '1037') — is a third
 *      hospital WHATEVER its name says. The name patterns are deliberately loose (the
 *      source misspells KAMC), so a different hospital whose name merely contains
 *      «King Abdullah …» or «Saudi German …» (another SGH branch) would match them; its
 *      own facility id is what tells it apart, and it must never enter the KAMC report
 *      (which must stay identical to the historic one) or the SGH / BOTH reports;
 *   2. a KNOWN-FOREIGN name (FOREIGN_NAME_RES: NGHA) → a third hospital, whatever id;
 *   3. the hospital NAME (facility_name → OrderRow.hospital) when it names one of ours —
 *      the user identifies the hospitals by facility_name (decision 2026-10-11: name
 *      first, then id), so between OUR two hospitals the name wins over the id;
 *   4. otherwise the id: '31763' → kamc, '1037' → sgh. A name that names NEITHER
 *      hospital does not by itself make a row foreign while the id still says whose it
 *      is: the source already misspells KAMC, and a re-spelled name must not push a
 *      hospital's own orders out of its report;
 *   5. a name that names neither hospital and no id → null (a third hospital);
 *   6. neither name nor id → kamc. Files and snapshots that PREDATE the hospital
 *      columns were single-hospital, i.e. all KAMC, and they — the golden fixture
 *      included — must keep producing exactly the numbers they always did.
 * null = a THIRD hospital: never counted, only listed in the on-screen notice.
 * Every live row (name and id agreeing) classifies the same under all six steps.
 * @param {import('../contracts.js').OrderRow} row
 * @returns {('kamc'|'sgh'|null)}
 */
export function hospitalOf(row) {
  if (!row || typeof row !== 'object') return null; // a hole is no hospital's order
  const name = text(row.hospital);
  const id = text(row.orderingFacilityId);
  const idKey = id !== '' ? keyOfId(id) : undefined;
  if (id !== '' && idKey === undefined) return null; // 1. its own (foreign) id
  if (name !== '') {
    if (FOREIGN_NAME_RES.some((re) => re.test(name))) return null; // 2.
    for (const [key, re] of NAME_RES) if (re.test(name)) return key; // 3.
  }
  if (idKey !== undefined) return idKey; // 4.
  return name !== '' ? null : 'kamc'; // 5. / 6.
}

/**
 * Does the app hold a Test Menu (TAT / country catalogue) for this row's hospital?
 * false for SGH rows (no Test Menu yet) and for third-hospital rows (never reported).
 * The fail-safe engine/tat.js, engine/engine.js, engine/asof.js and model/sendout.js
 * consult, so a row without a menu can never be given a TAT or a country.
 * @param {import('../contracts.js').OrderRow} row
 * @returns {boolean}
 */
export function hasTestMenu(row) {
  const h = hospitalOf(row);
  return h != null && HOSPITALS[h].hasTestMenu === true;
}

/**
 * The legacy KAMC test, kept exactly as it was before the hospital registry (tests pin
 * it; it predates the name-first rule): the facility id is authoritative when present,
 * else the name, else (no columns) KAMC. It agrees with hospitalOf(row) === 'kamc' on
 * every row whose name and id do not CONTRADICT each other — i.e. every live row. The
 * app's own door is takeOrders/hospitalOf; nothing in src/ classifies with this.
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
 * One notice line per hospital among `dropped`, however its rows are labelled. A
 * hospital's rows can carry its id on some lines and only its name on others (a blank
 * cell); keyed by id OR name, that became two lines naming the same hospital. So: learn
 * every id → name pairing first, then key each row by its NAME (its own, or the one its
 * id is known by), falling back to the id only when no name is known at all.
 * `count` = order LINES (the engine's grain), sorted by count descending, ties by label
 * (so the order never depends on row order). `name` is whitespace-collapsed (first seen).
 * @param {Array} dropped
 * @returns {{id:(string|null), name:(string|null), count:number}[]}
 */
function tallyHospitals(dropped) {
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
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || label(a).localeCompare(label(b)),
  );
}

/**
 * The LEGACY two-way cut (isKamcRow): KAMC rows kept, EVERY other hospital — SGH
 * included — tallied in `excluded`. Kept as it was (tests pin it). The app's door is
 * partitionHospitals / takeOrders, which keeps SGH as a reported hospital.
 * `kept` holds the ORIGINAL row objects in their ORIGINAL order. Nothing is mutated.
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
  return { kept, excluded: tallyHospitals(dropped) };
}

/**
 * Split order lines by reported hospital (hospitalOf). `kamc` / `sgh` hold the ORIGINAL
 * row objects in their ORIGINAL order — no copy, no re-sort — so lineNo (the CSV path's
 * key back into raw.records) and every identity-based lookup downstream keep working.
 * `excluded` tallies the THIRD hospitals only (see tallyHospitals); empty = nothing
 * ignored. A hole in the array (null/undefined) is no hospital's order and is skipped.
 * Nothing is mutated. Never throws: a non-array gives empty lists.
 * @param {import('../contracts.js').OrderRow[]} rows
 * @returns {{kamc: import('../contracts.js').OrderRow[], sgh: import('../contracts.js').OrderRow[],
 *   excluded: {id:(string|null), name:(string|null), count:number}[]}}
 */
export function partitionHospitals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const kamc = [];
  const sgh = [];
  const dropped = [];
  for (const row of list) {
    if (!row) continue;
    const h = hospitalOf(row);
    if (h === 'kamc') kamc.push(row);
    else if (h === 'sgh') sgh.push(row);
    else dropped.push(row);
  }
  return { kamc, sgh, excluded: tallyHospitals(dropped) };
}

/**
 * Put a source's order rows into `parsed` — the ONE place the app takes orders in, so
 * every screen and the unattended pipeline see the same populations. Writes, together:
 *   parsed.orders            the KAMC rows. When EVERY row is KAMC the source's own array
 *                            is assigned untouched (kamc is an in-order subsequence, so
 *                            equal length means equal content), so a single-hospital
 *                            source behaves exactly as it always did;
 *   parsed.ordersByHospital  { kamc: <the very array in parsed.orders>, sgh: [...] } —
 *                            a NEW object per call (a load's identity);
 *   parsed.excludedHospitals the THIRD hospitals only (on-screen notice).
 * ORDER (load-bearing): orders FIRST. state.js's accessor drops parsed.raw AND resets
 * ordersByHospital whenever orders are reassigned, so ordersByHospital is written after
 * it, and on the CSV path the caller assigns raw after this call. Filtering rows out
 * does not misalign the filtered-CSV download — raw.records stay indexed by each row's
 * own lineNo, SGH rows included.
 * Never throws: a non-array `rows` assigns empty arrays and no notice.
 * @param {{orders:any, ordersByHospital?:any, excludedHospitals:any}} parsed  the state.parsed object to write
 * @param {Array} rows
 * @returns {Array} what was assigned to parsed.orders
 */
export function takeOrders(parsed, rows) {
  const { kamc, sgh, excluded } = partitionHospitals(rows);
  const orders = Array.isArray(rows) && kamc.length === rows.length ? rows : kamc;
  parsed.orders = orders;
  parsed.ordersByHospital = { kamc: orders, sgh };
  parsed.excludedHospitals = excluded;
  return orders;
}

/** The pre-registry name of takeOrders; every call site that still uses it gets the
 *  same door (parsed.orders stays the KAMC rows). */
export const takeKamcOrders = takeOrders;

/**
 * The rows a report type is built from.
 *   'kamc' → parsed.orders (the historic report's rows, exactly as every consumer reads them)
 *   'sgh'  → parsed.ordersByHospital.sgh (null when nothing is loaded — state.js's fresh
 *            bucket — or the bucket predates ordersByHospital)
 *   'both' → { kamc, sgh } — the two hospitals SEPARATELY: a BOTH report is two
 *            per-hospital computations summed, never one over the union.
 * An unknown mode THROWS: a typo must never quietly produce the KAMC report under
 * another report's name.
 * @param {{orders:any, ordersByHospital?:{kamc:any, sgh:any}}} parsed
 * @param {('kamc'|'sgh'|'both')} mode
 */
export function rowsForMode(parsed, mode) {
  const p = parsed || {};
  const kamcRows = () => (p.orders == null ? null : p.orders);
  const sghRows = () => {
    const obh = p.ordersByHospital;
    return obh && Array.isArray(obh.sgh) ? obh.sgh : null;
  };
  if (mode === 'kamc') return kamcRows();
  if (mode === 'sgh') return sghRows();
  if (mode === 'both') return { kamc: kamcRows(), sgh: sghRows() };
  throw new Error(`rowsForMode: unknown report type ${JSON.stringify(mode)}`);
}
