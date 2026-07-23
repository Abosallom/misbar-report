// engine/tat.js — standard-TAT resolution + the Slide-5 by-test chart catalog.
import { normTest } from '../contracts.js?v=v2026-07-22.13';

/**
 * Build a fast normalized index from a { testName: businessDays } lookup object.
 * Keys are normTest()-normalized so matching is whitespace-insensitive.
 * @param {Object<string, number>} tatLookup
 * @returns {Map<string, number>}
 */
export function buildTatIndex(tatLookup) {
  const idx = new Map();
  if (tatLookup) {
    for (const k of Object.keys(tatLookup)) {
      const v = Number(tatLookup[k]);
      if (Number.isFinite(v)) idx.set(normTest(k), v);
    }
  }
  return idx;
}

/**
 * Resolve the standard TAT (business days) for a row.
 * Mirrors Excel XLOOKUP(Test → lookup); on miss, optionally falls back to the
 * CSV "TAT - Days" column. Reports whether the test was matched in the lookup.
 * @param {import('../contracts.js').OrderRow} row
 * @param {Map<string, number>} tatIndex
 * @param {{tatFallbackFromCsv?: boolean}} [opts]
 * @returns {{tat: number|null, matched: boolean, fromCsv: boolean}}
 */
export function resolveTat(row, tatIndex, opts = {}) {
  const key = normTest(row.testName);
  if (tatIndex.has(key)) return { tat: tatIndex.get(key), matched: true, fromCsv: false };
  const fallback = opts.tatFallbackFromCsv !== false; // default ON
  if (fallback && row.tatDaysCsv != null && row.tatDaysCsv !== '') {
    const v = Number(row.tatDaysCsv);
    if (Number.isFinite(v)) return { tat: v, matched: false, fromCsv: true };
  }
  return { tat: null, matched: false, fromCsv: false };
}

/**
 * The Slide-5 "Late Orders by Test" chart is driven by a HAND-CURATED allow-list
 * of test names baked into the source workbook (cells H50:H70 of the Summary
 * Tables sheet). It is NOT derivable from the CSV: it deliberately omits late
 * lines that fall on tests outside this list. Only catalog tests with a nonzero
 * late-no-result count are plotted. See engine.js buildByTest().
 *
 * Order here is the workbook's H-column order; the chart tie-breaks equal counts
 * by DESCENDING catalog index (reverse H-order), which reproduces the published
 * bar order exactly.
 * @type {string[]}
 */
export const CHART_TEST_CATALOG = [
  'Kappa light chains.free/Lambda light chains.free [Mass Ratio] in Serum',
  'SEND OUT TEST IMMUNOFIXATION 24 HOUR URINE TURBIDIMETRIC IMMUNOASSAY',
  'SEND OUT TEST IMMUNOGLOBULIN FREE LIGHT CHAIN 24 HOURS URINE NEPHELOMETRY',
  'SEND OUT TEST URINE ELECTROPHORESIS PROTEIN ELECTROPHORESIS 24 HOUR URINE',
  'SEND OUT TEST 17-HYDROXYPROGESTERONE BLOOD LC-MS/MS',
  'SEND OUT TEST KIDNEY STONE ANALYSIS INFRARED SPECTRUM ANALYSIS',
  'SEND OUT TEST COPPER BLOOD DRC-ICP-MS',
  'SEND OUT TEST TREPONEMA PALLIDUM (VDRL) ABS IGG IGM BLOOD EIA',
  'SEND OUT TEST HLA PRA I SA SINGLE ANTIGEN SERUM ELISA',
  'SEND OUT TEST HLA PRA II SINGLE ANTIGEN SERUM ELISA',
  'SEND OUT TEST HLA PRA SCREENING SERUM ELISA',
  'SEND OUT TEST HLA CLASS I GENOTYPING HIGH RESOLUTION DONOR / RECIPIENT VARIOUS SAMPLE NGS',
  'Strongyloides sp IgG Ab [Measurement] in Serum',
  'SEND OUT TEST MYOGLOBIN IN URINE TURBIDIMETRIC IMMUNOASSAY',
  'SEND OUT TEST CANCER ANTIGEN 72-4 BLOOD IMMUNOASSAY',
  'SEND OUT TEST GAD65 AB ASSAY SERUM RADIOIMMUNOASSAY (RIA)',
  'SEND OUT TEST GLUCAGON PLASMA EIA',
  'SEND OUT TEST OLIGOCLONAL BANDING CSF AND SERUM TEST IMMUNOBLOT (IB)',
  'SEND OUT TEST COPPER URINE 24 HOURS ICP-MS',
  'SEND OUT TEST MYELIN OLIGODENDROCYTE GLYCOPROTEIN (MOG) ABS IGG IFT BLOOD',
  'SEND OUT TEST BK VIRUS MOLECULAR DETECTION QUANTITATIVE PCR PLASMA',
];
