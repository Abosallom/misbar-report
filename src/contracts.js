// contracts.js — frozen shared shapes (Phase 0). All tracks code against these.
// Pure JSDoc typedefs; no runtime code except tiny helpers/constants.

/**
 * Normalized order line (grain = one test on one order). Produced by ingest/csv.js
 * from the 30-col KAMC export, and mirrored by test/fixtures/golden-orders.js.
 * All dates are 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS' strings or null.
 * @typedef {Object} OrderRow
 * @property {string}      orderDate   - Order date (date-only)
 * @property {string|null} facility    - Performing facility name, whitespace-normalized
 * @property {string}      orderId     - Keep as string (leading zeros)
 * @property {number|null} lineNo
 * @property {string|null} loinc       - Test code
 * @property {string}      testName
 * @property {string|null} collected
 * @property {string|null} dispatched
 * @property {string|null} received
 * @property {string|null} resulted    - Result report datetime
 * @property {string}      rawStatus   - Order Status column verbatim
 * @property {number|null} tatDaysCsv  - CSV "TAT - Days" (fallback only)
 */

/**
 * @typedef {Object} TrackerTask
 * @property {number|string|null} num
 * @property {string} task          - وصف المهمة
 * @property {string} responsible   - المسؤول (لين/نوبكو/…)
 * @property {string} owner         - المالك (person)
 * @property {string} dueDate       - تاريخ الإكتمال verbatim (may be 'يومي' or a range)
 * @property {string} status        - مفتوح | مستمر | متأخر | مغلق
 * @property {string} category      - فئة التقرير
 * @property {boolean} hidden       - row hidden in the tracker sheet
 */
/**
 * @typedef {Object} TrackerModel
 * @property {TrackerTask[]} tasks
 * @property {{id:string, title:string, desc:string, impact:string, owner:string, status:string, solution:string}[]} challenges
 * @property {{id:string, title:string, desc:string, probability:string, impact:string, owner:string, status:string}[]} risks
 */

/**
 * Output of engine/engine.js compute(rows, tatLookup, opts). Pure data.
 * @typedef {Object} EngineOutput
 * @property {{lines:number, cancelledInData:number, total:number}} totals - total = lines - cancelledInData
 * @property {{created:number, collected:number, dispatched:number, received:number, resulted:number}} funnel - all excl. cancelled
 * @property {{awaitingDispatch:number, shippedNotReceived:number, awaitingResults:number, completed:number, lateNoResult:number, latePct:number}} buckets
 * @property {{month:string, orders:number, results:number, incomplete:number, completionPct:number|null, cancelled:number}[]} monthly - month='YYYY-MM'; includes historical months merged from settings
 * @property {number} cancelledNote - sum of merged cancelledByMonth (the "* N طلب ملغي" note)
 * @property {{overallActual:number, overallExpected:number, perMonth:{month:string, actual:number|null, expected:number|null}[]}} turnaround - days, 1-decimal semantics per report
 * @property {{lab:string, total:number, awaitingResult:number, late:number, latePct:number}[]} byLab
 * @property {{testName:string, late:number}[]} byTest - late-no-result count per test, ascending like the chart
 * @property {string[]} unmatchedTests - test names absent from TAT lookup
 * @property {{completed:number}} deltas - vs settings.snapshot.prevCompleted
 */

/**
 * ReportModel = EngineOutput + editable content; the single input to build-spec.
 * @typedef {Object} ReportModel
 * @property {string} reportDate - 'YYYY-MM-DD'
 * @property {EngineOutput} kpi
 * @property {{supportRequired:string[], completedTasks:string[], plannedTasks:string[]}} panels - slide-2 bullets (auto-drafted, user-edited)
 * @property {TrackerTask[]} tasksCurrent  - slide 7 rows (status != مغلق, external)
 * @property {TrackerTask[]} tasksInternal - slide 8 rows (internal category)
 * @property {TrackerModel['challenges']} challenges
 * @property {TrackerModel['risks']} risks
 * @property {Settings['scorecard']} scorecard
 * @property {Object<string,string>} displayNames - full test name -> short chart label
 */

/**
 * SlideSpec: array of slides; units are INCHES on a 13.333 x 7.5 canvas.
 * Renderers must implement exactly these element kinds:
 *  rect  {t:'rect', x,y,w,h, fill, radius?, line?:{color,w}}
 *  text  {t:'text', x,y,w,h, text, size, bold?, italic?, color, align?, valign?, rtl?, font?, lineSpacing?}
 *  table {t:'table', x,y,w, colW:number[], rowH?:number, header?:{fill,color,bold},
 *         headerSize?:number, bodySize?:number,      // font pt (defaults 10)
 *         rows:Cell[][], rtl?:boolean}   Cell = string | {text, fill?, color?, bold?, align?}
 *         NOTE: rows/colW are in VISUAL left-to-right order (renderers never flip);
 *         when header is present, rows[0] is the header row.
 *  chart {t:'chart', kind:'colClustered'|'line'|'barH', x,y,w,h, categories:string[],
 *         series:{name:string, values:(number|null)[], color:string, dash?:boolean,
 *                 marker?:'circle'|'diamond'}[],
 *         opts?:{dataLabels?:boolean, legend?:'bottom'|'none', valMax?:number,
 *                valMin?:number, title?:string}}
 *  group {t:'group', children:Element[]}  (children coords are ABSOLUTE)
 * @typedef {{id:string, bg:string, internalOnly?:boolean, elements:Object[]}} SlideDef
 * @typedef {SlideDef[]} SlideSpec
 */

/**
 * Persisted settings — localStorage key 'misbar.settings.v1'. NO PHI EVER.
 * @typedef {Object} Settings
 * @property {number} schemaVersion
 * @property {string} updatedAt
 * @property {Object<string,number>} tatLookup - test name -> business days
 * @property {Object<string,string>} displayNames
 * @property {{lab:string, pct:string, target:number, uploaded:number, notUploaded:number, needFix:number, canOrder:boolean, available:number}[]} scorecard
 * @property {{cancelledByMonth:Object<string,number>}} historicalConstants - key 'YYYY-MM'; engine merges via max(stored, computed)
 * @property {{prevCompleted:number, asOf:string}} snapshot
 */

/** Screen module contract: each ui/screen-*.js exports render(containerEl, ctx)
 * where ctx = {state, store, navigate(screenId), rerender()}. */

export const SETTINGS_KEY = 'misbar.settings.v1';
export const VARIANTS = /** @type {const} */ ({
  internal: { id: 'internal', label: 'تقرير لين الداخلي', filePrefix: 'تقرير مسبار الداخلي' },
  nupco:    { id: 'nupco',    label: 'تقرير نوبكو',        filePrefix: 'تقرير مسبار' },
});

/** Facility-name normalizer — collapse internal whitespace, trim. Used by ingest AND engine. */
export const normFacility = (s) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim());
/** Test-name normalizer for TAT lookup matching. */
export const normTest = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());
