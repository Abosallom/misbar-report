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
//
// parsed.tracker — the project task tracker («ملف متابعة المشروع»): the SAME
// ProjectTracker document (contracts.js, ingest/task-tracker.js) that store.js keeps in
// settings.cachedTracker.model, or null when none is loaded. A fresh upload replaces
// both; a website edit updates this object and writes it back to the cache, so the two
// never diverge. Project-management content, not PHI. The OLD tracker's untagged
// {tasks, challenges, risks} model is never put here (store.js drops it from the cache).

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
 *   parsed:{orders:import('./contracts.js').OrderRow[]|null, tracker:import('./contracts.js').ProjectTracker|null, summary:Object|null,
 *           raw:{fields:string[], records:Object[], fileName?:string}|null,
 *           ordersByHospital:{kamc:import('./contracts.js').OrderRow[]|null, sgh:import('./contracts.js').OrderRow[]|null},
 *           excludedHospitals:{id:string|null, name:string|null, count:number}[]},
 *   engineOutput:import('./contracts.js').EngineOutput|null,
 *   reportModel:import('./contracts.js').ReportModel|null,
 *   reportHospital:('kamc'|'sgh'|'both'),
 *   slideOrder:{order:string[], epoch:number, units:string[]|null}|null,
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
  // THE TEMPORARY SLIDE ORDER (2026-10-13, slide-order CONTRACT decision 5): a reorder made
  // on the review screen's «ترتيب الشرائح» card and NOT saved as the fixed order. A choice
  // about ONE report, exactly like the scope: memory only, never in settings (the SAVED order
  // is settings.reportOptions.slideOrder), never read by the unattended automation. Bound to
  // the load it was made on (`epoch` = state.scopeEpoch then — see tempSlideOrder below), so
  // ANY new data load drops it; also dropped by «تقرير جديد» (resetRunData) and by the upload
  // screen's «متابعة» (clearTempSlideOrder); a page reload drops it because state is memory.
  // It SURVIVES a report-type switch, a scope / date change, a Settings visit and «رجوع» from
  // generate — none of those is a new report.
  slideOrder: null,
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
  state.slideOrder = null; // a new report starts from the SAVED fixed order (see the field above)
  state.edits = {};
  state.reportDate = null;
}

/* ---- the temporary slide order (see state.slideOrder above) ----
 * Pure helpers over a state-SHAPED object passed in (never this module's singleton), so the
 * review screen, the generate screen, the upload screen, the dev harness and node tests all
 * apply one rule to whichever state they hold. No imports on purpose: the order's own
 * vocabulary (model/slide-order.js) is applied by the callers — this file only owns WHEN a
 * temporary order is in force. */

/** The load a temporary order belongs to: the review screen's scope epoch (screen-review.js
 *  currentScope — bumped on every new data load, 0 while nothing is loaded). */
const loadEpochOf = (st) => (st && Number.isInteger(st.scopeEpoch) ? st.scopeEpoch : 0);

/** The temporary order in force for THIS load, or null. A temporary order made against an
 *  earlier load is dropped here (st.slideOrder = null), the same way the scope dies with its
 *  data. Call it AFTER the review's modelFor (which moves the epoch on a new load). */
export function tempSlideOrder(st) {
  const t = st && st.slideOrder;
  if (!t) return null;
  if (!Array.isArray(t.order) || t.epoch !== loadEpochOf(st)) {
    st.slideOrder = null;
    return null;
  }
  return t.order;
}

/** Make `order` this load's temporary order (a copy); null / a non-array clears it.
 *  `units` = the units the operator DECIDED on with this change (the units of the deck the
 *  move was made on; every unit for «الترتيب الافتراضي»), accumulated over the temporary
 *  order's life in `.units` — «حفظ كترتيب ثابت» stores those units' places and keeps every
 *  other unit beside its saved neighbours (screen-review.js slideOrderToSave →
 *  slide-order.js mergeVisibleOrder), not at a fixed index. WHY not the deck on
 *  screen at save time: a move made on KAMC and saved from KAMC + SGH (which lacks
 *  challenges / definitions / shipments) would otherwise throw those moves away. Omitted
 *  `units` = unknown = every unit (`.units` null), the safe reading for a save. */
export function setTempSlideOrder(st, order, units = null) {
  if (!st) return;
  if (!Array.isArray(order)) { st.slideOrder = null; return; }
  const cur = tempSlideOrder(st) ? st.slideOrder : null; // a stale one (earlier load) starts afresh
  const prev = !cur ? [] : (Array.isArray(cur.units) ? cur.units : null);
  const touched = prev === null || !Array.isArray(units) ? null : [...new Set([...prev, ...units])];
  st.slideOrder = { order: [...order], epoch: loadEpochOf(st), units: touched };
}

/** The units the temporary order decided on (see setTempSlideOrder): an array, or null when
 *  that is every unit OR there is no temporary order (check tempSlideOrder first). */
export function tempSlideOrderUnits(st) {
  if (!tempSlideOrder(st)) return null;
  const u = st.slideOrder.units;
  return Array.isArray(u) ? [...u] : null;
}

/** Drop the temporary order («متابعة», «استعادة الترتيب الثابت», a save as fixed). */
export function clearTempSlideOrder(st) {
  if (st) st.slideOrder = null;
}

/** Overlay the temporary order onto a ReportModel as model.slideOrder (what the deck builders
 *  read first — model/slide-order.js slideOrderOf), or REMOVE a stale one so the saved order
 *  (model.reportOptions.slideOrder) applies. Never touches model.reportOptions: the review
 *  re-sources that from settings on every render. Returns the order in force, or null. */
export function overlayTempSlideOrder(model, st) {
  const order = tempSlideOrder(st);
  if (model && typeof model === 'object') {
    if (order) model.slideOrder = [...order];
    else delete model.slideOrder;
  }
  return order;
}
