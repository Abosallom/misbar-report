// state.js — single mutable app state object (Track E).
// PHI (patient rows) lives ONLY here, in memory. Never persisted, never in settings.

/** @type {{
 *   files:{csv:File|null, tracker:File|null},
 *   parsed:{orders:import('./contracts.js').OrderRow[]|null, tracker:import('./contracts.js').TrackerModel|null, summary:Object|null},
 *   engineOutput:import('./contracts.js').EngineOutput|null,
 *   reportModel:import('./contracts.js').ReportModel|null,
 *   edits:Object,
 *   reportDate:string|null,
 *   settings:import('./contracts.js').Settings|null,
 *   screen:string
 * }} */
export const state = {
  files: { csv: null, tracker: null },
  parsed: { orders: null, tracker: null, summary: null },
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
  state.parsed = { orders: null, tracker: null, summary: null };
  state.engineOutput = null;
  state.reportModel = null;
  state.edits = {};
  state.reportDate = null;
}
