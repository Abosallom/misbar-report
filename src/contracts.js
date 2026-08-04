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
 * @property {string|null} [specimenNo]           - Specimen identifier ('Specimen Id' col; export header 'Specimen no'). Operational id, not PHI.
 * @property {string|null} [shipmentId]           - Shipment identifier ('Shipment ID'). Operational id, not PHI.
 * @property {string|null} [orderingFacilityId]   - Ordering facility id ('Ordering facility ID'). Operational id, not PHI.
 * @property {string|null} [performingFacilityId] - Performing facility id ('Performing facility id'); absent from the CSV export → null.
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
 * @property {{created:number, collected:number, dispatched:number, received:number, resulted:number, completed:number}} funnel - all excl. cancelled. FINAL STAGE = COMPLETED (user decision 2026-07-28: a result date OR a rejection, both terminal lab outcomes). `completed` is the canonical field; `resulted` is a LEGACY ALIAS carrying the SAME number (the long-lived override key 'funnel.resulted' reads it), NOT the dated-only count — never add the two
 * @property {{awaitingDispatch:number, shippedNotReceived:number, awaitingResults:number, completed:number, rejected:number, lateNoResult:number, latePct:number}} buckets - PARTITION: totals.total = awaitingDispatch + shippedNotReceived + awaitingResults + completed; completed follows the COMPLETED rule (result date OR rejected); `rejected` is still published as its own value but is a SUBSET of completed — never added alongside it; lateNoResult is a subset of awaitingResults
 * @property {{month:string, orders:number, results:number, rejected:number, pending:number, incomplete:number, completionPct:number|null, cancelled:number}[]} monthly - month='YYYY-MM'; includes historical months merged from settings. PARTITION: orders = results + pending; `results` follows the COMPLETED rule (result date OR rejected) since 2026-07-28, so `rejected` is a SUBSET of results and NOT a partition term; pending === incomplete (both = orders − results) — `incomplete` is kept only as the legacy key name
 * @property {number} cancelledNote - sum of merged cancelledByMonth (the "* N طلب ملغي" note)
 * @property {{overallActual:number, overallExpected:number, perMonth:{month:string, actual:number|null, expected:number|null}[]}} turnaround - days, 1-decimal semantics per report
 * @property {{lab:string, total:number, pipeline:number, awaitingResult:number, completed:number, onTime:number, resulted:number, resultedLate:number, rejected:number, late:number, latePct:number}[]} byLab - HEADLINE PARTITION: total = pipeline + awaitingResult + completed, with completed = onTime + resultedLate + rejected = resulted + rejected as the finer split beneath it (those four are all SUBSETS of completed — never added alongside it); pipeline = no received date (and not rejected); awaitingResult = received, no result yet, not rejected; onTime = resulted within due (day-granular); resultedLate = resulted−onTime (incl. No-Match resulted); resulted = onTime+resultedLate subtotal (non-rejected rows WITH a result date); late (late-no-result) is a subset of awaitingResult
 * @property {{testName:string, late:number, onTime:number}[]} byTest - catalog tests with late>0 OR onTime>0; late = late-no-result, onTime = resulted within due (day-granular); sorted late asc, catalog-idx desc
 * @property {string[]} unmatchedTests - test names absent from TAT lookup
 * @property {number} excludedNoTat - rows dropped by opts.excludeNoTat (0 when option off)
 * @property {{total:number, collected:number, dispatched:number, received:number,
 *             completed:number, rejected:number, awaitingDispatch:number, shippedNotReceived:number,
 *             awaitingResults:number, lateNoResult:number}} deltas
 *   - INCREASE vs the previous report's snapshot numbers (0 when equal/lower or no
 *     snapshot). Per the workbook's E6 prompt: a green "+N" chip renders ONLY for
 *     deltas > 0, recomputed each run, never accumulated. This IS the whole key
 *     set (engine.js currentNumbers); `completed` speaks the COMPLETED rule above
 *     (result date OR rejected) and `rejected` rides along as its own value —
 *     a SUBSET of completed, so the two chips must never be summed.
 */

/**
 * ReportModel = EngineOutput + editable content; the single input to build-spec.
 * @typedef {Object} ReportModel
 * @property {string} reportDate - 'YYYY-MM-DD'
 * @property {EngineOutput} kpi
 * @property {{supportRequired:string[], completedTasks:string[], plannedTasks:string[]}} panels - slide-2 bullets (auto-drafted, user-edited)
 * @property {TrackerTask[]} tasksCurrent  - slide 7 rows (status != مغلق, external)
 * @property {TrackerTask[]} tasksInternal - internal-variant task rows (category 'لين').
 *     Both task lists follow the SAME membership rule (model/drafts.js
 *     splitTaskLists, user decision 2026-08-04): non-closed rows, plus a مغلق row
 *     for exactly ONE report after it closes. Superseded: "the complete لين log".
 * @property {TrackerModel['challenges']} challenges
 * @property {TrackerModel['risks']} risks
 * @property {Settings['scorecard']} scorecard
 * @property {Object<string,string>} displayNames - full test name -> short chart label
 * @property {Object<string,number>} [overrides] - PER-RUN manual number overrides from
 *   the review screen (never persisted). Keys: 'total','awaitingDispatch','awaitingResults',
 *   'completed','rejected','lateNoResult','shippedNotReceived','funnel.created',
 *   'funnel.collected','funnel.dispatched','funnel.received','funnel.resulted',
 *   'cancelledNote','turnaround.actual','turnaround.expected'. build-spec renders
 *   override ?? computed; an overridden key suppresses its delta chip.
 *   NOTE: 'funnel.resulted' is the (unrenamed) key of the funnel's COMPLETED final
 *   stage, so it and 'completed' address the same figure on two slides.
 * @property {Settings['reportOptions']} [reportOptions] - presentation options (see Settings)
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
 * @property {{cancelledByMonth:Object<string,number>}} historicalConstants
 *   - key 'YYYY-MM'; MANUAL additions per the workbook C6 prompt:
 *     cancelled(m) = countedFromCsv(m) + cancelledByMonth[m] (additive, not max).
 * @property {{asOf:string, numbers:Object<string,number>, defVersion?:number}} snapshot
 *   - the previous report's published numbers (keys = deltas keys above);
 *     written after each successful generation. Legacy {prevCompleted} docs are
 *     migrated on load (numbers.completed = prevCompleted). Acts as the fallback
 *     baseline when snapshotHistory has no entry before the report date.
 *     Optional `defVersion` (SIBLING of numbers, never inside it — see
 *     seeds/defaults.js SNAPSHOT_SEED) stamps WHICH definition `numbers` speaks:
 *     2 = completed includes rejected (2026-07-28 rule). Unstamped baselines are
 *     dated by model/delta-baseline.js instead.
 * @property {Object<string,Object<string,number>>} snapshotHistory
 *   - rolling per-date history of published report numbers, key 'YYYY-MM-DD' →
 *     the same number set snapshot.numbers holds. Trimmed to the most recent 45
 *     dates (model/delta-baseline.js recordSnapshot). Feeds pickDeltaBaseline,
 *     which selects the comparison baseline per reportOptions.deltaMode. An entry
 *     may carry an optional numeric `defVersion` LEAF alongside its numbers (same
 *     meaning as snapshot.defVersion); with no stamp the entry's own date decides.
 * @property {Object<string,{openOn:string, closedOn:(string|null)}>} taskLog
 *   - v6 closed-task grace log (model/task-lifecycle.js). Key = the list a row was
 *     shown in ('ext' = tasksCurrent / نوبكو, 'int' = tasksInternal / لين) + '|' +
 *     the whitespace-normalized task text, capped at 160 chars — tracker rows have
 *     no stable id, so the text IS the identity. openOn = the report date the task
 *     was last shown NON-closed (a reopen resets it); closedOn = the single report
 *     date on which it was shown مغلق, or null while that grace is unspent.
 *     Written from the FINAL model after a successful generation (automation
 *     included), pruned to at most 300 entries. EMPTY MEANS "nothing remembered",
 *     which is exactly what keeps pre-existing مغلق tracker rows off the deck.
 * @property {{baseUrl:string, accessToken:string, panelId:number, enabled:boolean}} grafana
 *   - live data source (Grafana PUBLIC-dashboard query API). baseUrl like
 *     'https://elab.seha.sa/hpapm'. Empty/disabled → CSV drop only. The access
 *     token is the public-dashboard token (view-only, server-side-masked data);
 *     it is NEVER seeded in the repo — the user enters it once in Settings.
 * @property {{excludeNoTat:boolean, slides:Object<string,boolean>, kpiCards:Object<string,boolean>, labels:Object<string,string>, deltaMode:('daily'|'week'), autoDownloadFiles:boolean}} reportOptions
 *   - presentation defaults: excludeNoTat drops rows with no TAT from ANY source
 *     (lookup + CSV fallback = null → 'No Match') before aggregation; slides keys
 *     'execFunnel'|'monthly'|'compliance'|'action'|'challenges'|'definitions' toggle the middle
 *     slides (cover/thanks always render; page numbers renumber) — 'definitions'
 *     ('منهجية الأرقام') defaults OFF, so the delivered deck is the simple six-slide
 *     shape; kpiCards keys mirror the deltas
 *     keys and hide exec-slide cards (row geometry repacks); labels overrides the
 *     DEFAULT_LABELS registry in slidespec/build-spec.js (empty = built-in text);
 *     deltaMode picks the exec delta-chip comparison window — 'daily' vs the last
 *     report before the report date, or 'week' (the DEFAULT since 2026-08-04) =
 *     WEEK-TO-DATE: every report of one Sun–Thu week compares against the same
 *     baseline, the most recent report stored strictly BEFORE that week's Sunday, so
 *     the chips accumulate and Thursday's deck carries the whole week. With no
 *     pre-week entry the picker falls back to the most recent prior report and says
 *     so via anchored:false. The retired 'weekly' / 'weekly-sun' / 'weekly-thu'
 *     values are ALIASES of 'week'; schema v7 forces stored 'daily' to 'week' once
 *     (see model/delta-baseline.js pickDeltaBaseline / normalizeDeltaMode and
 *     store.js migrateV6toV7).
 *     autoDownloadFiles (default TRUE; an ABSENT key means ON — it post-dates the
 *     feature) governs ONLY the manual generate flow: whether the 4 produced files
 *     are pushed to the browser automatically, or the operator picks them from the
 *     success panel's per-file buttons. Mobile never auto-downloads either way. It is
 *     strictly INDEPENDENT of automation.autoDownload below, which arms the
 *     UNATTENDED run's downloads — the single predicate is
 *     automation/pipeline.js shouldAutoDownloadFiles.
 * @property {{enabled:boolean, autoPull:boolean, autoGenerate:boolean, autoDownload:boolean,
 *             autoLabFiles:boolean, autoEmailDrafts:boolean, autoAcceptTat:boolean,
 *             dailyTime:string, labRecipients:Object<string,string>}} automation
 *   - unattended daily pipeline (v4; see automation/pipeline.js AUTOMATION_DEFAULTS
 *     and seeds/defaults.js AUTOMATION_SEED). EVERY switch defaults to false — a
 *     fresh install or an upgraded doc never runs a step the user did not arm.
 *     `enabled` is the master switch; the auto* flags gate the individual steps
 *     (pull → engine → generate/download → lab files → email drafts) and
 *     autoAcceptTat auto-applies suggested TAT durations. dailyTime is local
 *     24-hour 'HH:MM'. labRecipients maps a lab name -> a comma-separated
 *     recipient list for the per-lab email drafts; a missing/empty entry means
 *     the draft carries no To: line.
 * @property {{model:TrackerModel, updatedAt:string}|null} cachedTracker
 *   - last successfully parsed Project Tracker, reused when no fresh file is
 *     dropped. NOTE on the no-PHI invariant: this is PROJECT-management content
 *     (tasks/challenges/risks), not patient data — patient rows remain memory-only.
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
