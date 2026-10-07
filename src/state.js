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
// parsed.excludedHospitals — [{ id, name, count }], one entry per OTHER hospital whose
// orders were dropped on the way in (model/hospital.js splitByHospital; 2026-10-07 user
// rule: only the current hospital's orders count, a second hospital's are ignored
// everywhere until further notice). parsed.orders holds the KEPT rows only, so every
// surface — engine, slides, late-labs, .eml drafts, the filtered CSV — sees the one
// hospital without knowing a second exists; this list is what the upload and review
// screens print so the operator can see what was left out. Aggregates only (an id, a
// name, a count) — no row. Every writer of parsed.orders sets it in the same breath:
// ui/screen-upload.js (CSV, live pull, snapshot, mock) and automation/pipeline.js's pull.
// raw (above) still holds the WHOLE uploaded file, other hospitals' lines included: the
// kept orders index it by their own lineNo, so the pairing holds, and the filtered-CSV
// download walks the orders — an excluded line is never handed back.

/** A fresh `parsed` bucket. `orders` is an ACCESSOR, not a plain field: replacing the
 *  order rows with a different array drops `raw`. The upload screen nulls raw explicitly
 *  at every site it writes orders from another source, but not every writer knows raw
 *  exists — automation/pipeline.js's pull step assigns theState.parsed.orders directly
 *  (Grafana / snapshot rows) and would otherwise leave an earlier upload's patient rows
 *  paired with the new orders, where raw.records[order.lineNo] names the WRONG patient.
 *  The failure mode is the safe one: a writer that forgets raw only loses the export.
 *  Consequence for the one legitimate writer: a CSV upload assigns orders FIRST, then raw.
 *  Re-assigning the SAME array is a no-op for raw. */
function freshParsed() {
  let orders = null;
  return Object.defineProperties({ tracker: null, summary: null, raw: null, excludedHospitals: [] }, {
    orders: {
      enumerable: true,
      configurable: true,
      get() { return orders; },
      set(v) {
        if (v !== orders) this.raw = null;
        orders = v;
      },
    },
  });
}

/** @type {{
 *   files:{csv:File|null, tracker:File|null},
 *   parsed:{orders:import('./contracts.js').OrderRow[]|null, tracker:import('./contracts.js').TrackerModel|null, summary:Object|null,
 *           raw:{fields:string[], records:Object[], fileName?:string}|null,
 *           excludedHospitals:{id:string|null, name:string|null, count:number}[]},
 *   engineOutput:import('./contracts.js').EngineOutput|null,
 *   reportModel:import('./contracts.js').ReportModel|null,
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
  edits: {},
  reportDate: null,
  settings: null,
  screen: 'upload',
};

/** Clear everything derived from an upload run, keeping settings + screen routing. */
export function resetRunData() {
  state.files = { csv: null, tracker: null };
  state.parsed = freshParsed(); // raw: null — the uploaded file's patient rows go with the run; excludedHospitals: []
  state.engineOutput = null;
  state.reportModel = null;
  state.edits = {};
  state.reportDate = null;
}
