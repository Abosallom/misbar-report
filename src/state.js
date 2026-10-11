// state.js — single mutable app state object (Track E).
// PHI (patient rows) lives ONLY here, in memory. Never persisted, never in settings.
//
// parsed.raw — the uploaded CSV's OWN rows, every column (patient name, national id,
// MRN included), exactly as ingest/csv.js parseKamcCsv returned them. It exists for one
// purpose: the optional filtered-CSV download on the upload screen (model/csv-filter.js),
// which hands the user back their own rows. raw.records[order.lineNo] is that order's
// original record, so raw is only meaningful PAIRED with the orders it was parsed with:
// it is set ONLY by a CSV upload and must be null whenever parsed.orders came from
// anywhere else (live Grafana pull, encrypted snapshot, mock/dev samples) or the run is
// reset — a stale raw next to different orders would export the wrong patients' rows.
// Never persisted, logged, or handed to reports / late-labs / .eml drafts / automation.
//
// parsed.orders / parsed.ordersByHospital / parsed.excludedHospitals — written together
// by model/hospital.js takeOrders(), the ONE door every source's rows come in through
// (ui/screen-upload.js: CSV, live pull, snapshot, mock; automation/pipeline.js's pull).
//   orders            the KAMC rows ONLY — every existing surface (engine hero, unmatched-
//                     TAT panel, late-labs, .eml drafts, the filtered CSV, automation)
//                     reads this and sees the one hospital whose Test Menu the app holds.
//   ordersByHospital  { kamc, sgh } — kamc is the VERY array in `orders`; sgh the second
//                     reported hospital's rows (no Test Menu yet: counts and stages only),
//                     read only by the SGH and KAMC+SGH report types.
//   excludedHospitals [{ id, name, count }], one entry per THIRD hospital whose orders
//                     were dropped on the way in (never counted anywhere; the upload and
//                     review screens print it). Aggregates only — no row.
// raw (above) still holds the WHOLE uploaded file, every hospital's lines included: the
// kept rows of both hospitals index it by their own lineNo, so the pairing holds, and
// the filtered-CSV download walks the orders it is given — an excluded line is never
// handed back.

/** A fresh `parsed` bucket. `orders` is an ACCESSOR, not a plain field: replacing the
 *  order rows with a different array drops `raw` AND resets `ordersByHospital` to
 *  { kamc: <the new orders>, sgh: [] } (or { kamc: null, sgh: null } when orders become
 *  null / a non-array: nothing loaded) — the other hospital's rows belong to the load
 *  they came with exactly as raw does, so a writer that assigns orders without knowing
 *  about ordersByHospital can never leave a previous load's SGH rows beside new KAMC
 *  rows (a KAMC+SGH report would then mix two loads). takeOrders writes orders FIRST,
 *  then ordersByHospital. ordersByHospital itself is a plain field: writing it never
 *  touches raw (SGH rows pair with raw by lineNo just as KAMC rows do). The upload screen nulls raw explicitly
 *  at every site it writes orders from another source, but not every writer knows raw
 *  exists — automation/pipeline.js's pull step assigns theState.parsed.orders directly
 *  (Grafana / snapshot rows) and would otherwise leave an earlier upload's patient rows
 *  paired with the new orders, where raw.records[order.lineNo] names the WRONG patient.
 *  The failure mode is the safe one: a writer that forgets raw only loses the export.
 *  Consequence for the one legitimate writer: a CSV upload assigns orders FIRST, then raw.
 *  Re-assigning the SAME array is a no-op for raw. */
function freshParsed() {
  let orders = null;
  return Object.defineProperties({
    tracker: null, summary: null, raw: null,
    // Nothing loaded yet: BOTH hospitals null, exactly like `orders` — never an empty
    // array, which would read as "loaded, zero rows" (rowsForMode('sgh') must say null
    // before any load, as rowsForMode('kamc') does) and would break the invariant that
    // ordersByHospital.kamc IS the value in `orders`.
    ordersByHospital: { kamc: null, sgh: null }, excludedHospitals: [],
  }, {
    orders: {
      enumerable: true,
      configurable: true,
      get() { return orders; },
      set(v) {
        if (v !== orders) {
          this.raw = null;
          this.ordersByHospital = Array.isArray(v) ? { kamc: v, sgh: [] } : { kamc: null, sgh: null };
        }
        orders = v;
      },
    },
  });
}

/** @type {{
 *   files:{csv:File|null, tracker:File|null},
 *   parsed:{orders:import('./contracts.js').OrderRow[]|null, tracker:import('./contracts.js').TrackerModel|null, summary:Object|null,
 *           raw:{fields:string[], records:Object[], fileName?:string}|null,
 *           ordersByHospital:{kamc:import('./contracts.js').OrderRow[]|null, sgh:import('./contracts.js').OrderRow[]|null},
 *           excludedHospitals:{id:string|null, name:string|null, count:number}[]},
 *   engineOutput:import('./contracts.js').EngineOutput|null,
 *   reportModel:import('./contracts.js').ReportModel|null,
 *   reportHospital:('kamc'|'sgh'|'both'),
 *   edits:Object,
 *   reportDate:string|null,
 *   settings:import('./contracts.js').Settings|null,
 *   screen:string
 * }} */
export const state = {
  files: { csv: null, tracker: null },
  parsed: freshParsed(),
  engineOutput: null,
  reportModel: null,
  // Which report type the operator picked on the review screen (model/hospital.js
  // HOSPITAL_MODES). A choice about ONE run, like a scope: memory only, never in
  // settings, never read by the unattended automation (which always makes the main
  // report itself), and back to 'both' — KAMC + SGH, the MAIN weekly report — on
  // «تقرير جديد». KAMC-only / SGH-only are the special single-hospital reports.
  reportHospital: 'both',
  edits: {},
  reportDate: null,
  settings: null,
  screen: 'upload',
};

/** Clear everything derived from an upload run, keeping settings + screen routing. */
export function resetRunData() {
  state.files = { csv: null, tracker: null };
  state.parsed = freshParsed(); // raw: null — the uploaded file's patient rows go with the run; ordersByHospital { kamc: null, sgh: null }; excludedHospitals: []
  state.engineOutput = null;
  state.reportModel = null;
  state.reportHospital = 'both'; // the main report (see the field above)
  state.edits = {};
  state.reportDate = null;
}
