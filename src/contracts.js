// contracts.js — frozen shared shapes (Phase 0). All tracks code against these.
// Pure JSDoc typedefs; no runtime code except tiny helpers/constants.

/**
 * Normalized order line (grain = one test on one order). Produced by ingest/csv.js
 * from the 30-col KAMC export (plus the optional ordering-hospital columns since
 * 2026-09-28) and by ingest/grafana.js, and mirrored by test/fixtures/golden-orders.js.
 * Ingest returns rows of EVERY ordering hospital; model/hospital.js takeOrders sorts them
 * where the app takes rows in, keyed on `hospital` first, then `orderingFacilityId` (below;
 * a foreign id always makes a third hospital):
 * KAMC rows → state.parsed.orders, SGH rows → state.parsed.ordersByHospital.sgh, any
 * third hospital → never counted (only listed in state.parsed.excludedHospitals).
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
 * @property {string|null} [orderingFacilityId]   - Ordering facility id ('Ordering facility ID'; when that column
 *   is absent or blank, the hospital id column 'facility_id' / 'Facility ID', which carries the same id).
 *   Operational id, not PHI. It is the ORDERING HOSPITAL's id — model/hospital.js hospitalOf falls
 *   back to it when `hospital` names neither reported hospital (KAMC '31763', SGH '1037'). Any OTHER
 *   non-blank id = a third hospital WHATEVER `hospital` says (a different «King Abdullah …» or
 *   «Saudi German …» hospital is told apart by its own id).
 * @property {string|null} [performingFacilityId] - Performing facility id ('Performing facility id'); absent from the CSV export → null.
 * @property {string|null} [hospital] - Ordering HOSPITAL name ('facility_name' on Grafana, 'Facility Name'
 *   in the CSV; header matched ignoring case, spaces and underscores — ingest/csv.js
 *   findHospitalColumns), whitespace-collapsed. NOT the lab: that is `facility` ('Performing
 *   facility name'). An organisation name, not patient data. null/absent on files and snapshots
 *   that predate the column — a row with neither this nor an id is KAMC. Decides the row's
 *   hospital FIRST between the two reported hospitals (model/hospital.js hospitalOf:
 *   /king\s*abdul…/ → KAMC, /saudi\s*german/ → SGH; King ABDULAZIZ Medical City → third) unless the
 *   id is a foreign one (above), and feeds the app-screen third-hospital notice. The row's own spelling never goes on a
 *   slide: the KAMC report prints no hospital name at all, and the SGH / KAMC+SGH decks print
 *   the registry's names (HOSPITALS code / arName), as the user's reference deck does.
 * @property {string|null} [dob] - Patient date of birth ('DOB', 'YYYY-MM-DD HH:MM:SS').
 *   THE ONE PATIENT FIELD THIS SHAPE CARRIES, and only on ONE path: ingest/csv.js
 *   (the manual «ملف الطلبات (CSV)» upload) sets it so the per-lab late-tests Excel
 *   can print it — a lab matches a specimen to its patient by specimen no + DOB.
 *   It is deliberately ABSENT on the automated path (ingest/grafana.js), because
 *   that path's rows are encrypted into data/kamc-live.enc and committed to a
 *   PUBLIC repo; test/grafana.test.mjs holds that line. Rows are memory-only
 *   (store.js has no rows API), so DOB never reaches browser storage either.
 *   Every other patient field — name, national id, MRN, gender — stays out.
 */

/**
 * The project task tracker («ملف متابعة المشروع») — the MISBAR Task Tracker workbook as
 * a PERSISTED, editable document (2026-10-13). Produced by ingest/task-tracker.js
 * parseTaskTracker, cached in Settings.cachedTracker.model, edited on the review
 * screen, rendered by slidespec/build-tracker.js. JSON-safe; project-management
 * content, no patient data. One task:
 * @typedef {Object} ProjectTask
 * @property {string} id           - stable unique key: the WBS when unique, 'WBS#2'… for a
 *                                   repeated WBS, 'row-N' without one, 'new-N' for a row added
 *                                   on the website
 * @property {string} wbs          - WBS ID ('2.1.1')
 * @property {string} track        - Portfolio Track (Portfolio sheet; filled down)
 * @property {string} trackAr      - the track's Arabic translation ('' = none; optional
 *                                   'Portfolio Track (Arabic)' / 'المسار' column, filled down
 *                                   within its English group like track)
 * @property {string} milestone    - Milestone (Portfolio sheet; filled down within its track)
 * @property {string} milestoneAr  - the milestone's Arabic translation ('' = none; optional
 *                                   'Milestone (Arabic)' / 'المرحلة' column, filled down)
 * @property {string} workstream
 * @property {string} workPackage
 * @property {string} task         - Task / Deliverable (the English original, never
 *                                   overwritten by a translation)
 * @property {string} taskAr       - the task's Arabic translation ('' = none; optional
 *                                   'Task / Deliverable (Arabic)' / 'المهمة / المخرج' column
 *                                   in either sheet, Hierarchical winning like task). A cache
 *                                   from before translations lacks the three *Ar keys and
 *                                   normalizes to ''
 * @property {string} taskType
 * @property {string} organization - 'NUPCO' | 'LEAN' | 'NUPCO / LEAN' | free text
 * @property {string} owner
 * @property {string} priority     - Critical | High | Medium | Low | free text
 * @property {string} status       - the file's word VERBATIM ('Deleyed' stays 'Deleyed';
 *                                   a Portfolio-only row's 'Not Found' becomes '')
 * @property {string} due          - 'YYYY-MM-DD' for a real date (serial or a day-first
 *                                   '17/9/2026'), other text verbatim ('daily'), '' blank
 * @property {string} predecessor
 * @property {string} nextAction
 * @property {string} definitionOfDone
 * @property {string} notes
 * Every field is a string ('' when empty); task order = slide order (Portfolio order,
 * then Hierarchical-only rows).
 */
/**
 * @typedef {Object} ProjectTracker
 * @property {'misbar-task-tracker-v1'} format - the tag; an untagged cached tracker is
 *   the retired format and is treated as "no tracker"
 * @property {string|null} fileName  - the uploaded workbook's name
 * @property {string} loadedAt       - ISO timestamp of the upload / parse
 * @property {string|null} editedAt  - ISO timestamp of the last website edit; null = the
 *   file exactly as uploaded (a new upload replaces any edits)
 * @property {string[]} warnings     - parser notes for the upload card (sheet
 *   disagreements, one-sheet rows, a missing sheet, repeated WBS)
 * @property {ProjectTask[]} tasks
 */

/**
 * LEGACY (retired 2026-10-13): the OLD tracker's task / model shapes (Arabic sheets
 * سجل المهام / سجل التحديات / سجل المخاطر). Nothing parses that file any more; the
 * typedefs remain for model/drafts.js and the manual challenges / risks content.
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
 * @property {{awaitingDispatch:number, shippedNotReceived:number, awaitingResults:number, completed:number, rejected:number, lateNoResult:number, latePct:number}} buckets - PARTITION: totals.total = awaitingDispatch + shippedNotReceived + awaitingResults + completed — each line is counted in exactly ONE bucket, the furthest milestone it reached (engine.js ladderStage), so the identity holds even for a skipped-step line (a result with no dispatch / receipt scan; the 2026-10-07 "cards sum to total + 2" fix); completed follows the COMPLETED rule (result date OR rejected); `rejected` is still published as its own value but is a SUBSET of completed — never added alongside it; lateNoResult is a subset of awaitingResults
 * @property {{month:string, orders:number, results:number, rejected:number, pending:number, incomplete:number, completionPct:number|null, cancelled:number}[]} monthly - month='YYYY-MM'; includes historical months merged from settings. PARTITION: orders = results + pending; `results` follows the COMPLETED rule (result date OR rejected) since 2026-07-28, so `rejected` is a SUBSET of results and NOT a partition term; pending === incomplete (both = orders − results) — `incomplete` is kept only as the legacy key name
 * @property {number} cancelledNote - sum of merged cancelledByMonth (the "* N طلب ملغي" note)
 * @property {{overallActual:number, overallExpected:number, perMonth:{month:string, actual:number|null, expected:number|null}[]}} turnaround - days, 1-decimal semantics per report
 * @property {{lab:string, total:number, pipeline:number, awaitingResult:number, completed:number, onTime:number, resulted:number, resultedLate:number, rejected:number, late:number, latePct:number}[]} byLab - HEADLINE PARTITION: total = pipeline + awaitingResult + completed, with completed = onTime + resultedLate + rejected = resulted + rejected as the finer split beneath it (those four are all SUBSETS of completed — never added alongside it); pipeline = the two pre-receipt ladder rungs (engine.js ladderStage awaitingDispatch + shippedNotReceived): no received date AND not completed (no result date, not rejected) — Σ over labs = buckets.awaitingDispatch + buckets.shippedNotReceived (until 2026-10-07 it was "no received date, not rejected" alone, so a line resulted with no receipt date sat in pipeline AND completed); awaitingResult = received, no result yet, not rejected; onTime = resulted within due (day-granular); resultedLate = resulted−onTime (incl. No-Match resulted); resulted = onTime+resultedLate subtotal (non-rejected rows WITH a result date); late (late-no-result) is a subset of awaitingResult
 * @property {{testName:string, late:number, onTime:number}[]} byTest - catalog tests with late>0 OR onTime>0; late = late-no-result, onTime = resulted within due (day-granular); sorted late asc, catalog-idx desc
 * @property {string[]} unmatchedTests - test names absent from TAT lookup
 * @property {number} excludedNoTat - rows dropped by opts.excludeNoTat (0 when option off)
 * @property {{total:number, collected:number, dispatched:number, received:number,
 *             completed:number, rejected:number, awaitingDispatch:number, shippedNotReceived:number,
 *             awaitingResults:number, lateNoResult:number}} deltas
 *   - THE ACTIVITY OF THE REPORT'S WINDOW (2026-08-05 rule, Talal; two-class refinement
 *     2026-08-06). THE INVARIANT these values live under: every OTHER number in
 *     EngineOutput — and every big number on slides 2/3/4 — is a CUMULATIVE TOTAL and
 *     did not change. Only these small green chips did: they describe what HAPPENED
 *     inside the window [Sunday, reportDate] ('week', the default) or
 *     [reportDate, reportDate] ('daily'), from the rows' OWN date columns
 *     (model/delta-window.js computeWindowDeltas). TWO KEY CLASSES, TWO MEANINGS:
 *       • CUMULATIVE keys — total, collected, dispatched, received, completed,
 *         rejected — are IN-WINDOW EVENT COUNTS: asof(end) − asof(the day before the
 *         start) over monotone milestone counters. "3 orders dated this week" ⇒ 3.
 *       • QUEUE keys — awaitingDispatch, shippedNotReceived, awaitingResults,
 *         lateNoResult (engine/asof.js QUEUE_KEYS) — are SURVIVING ENTRANTS: rows that
 *         ENTERED that state inside the window AND are STILL in it at the window's end,
 *         counted by ONE gated as-of pass (computeNumbersAsOf's `sinceIso`), never by a
 *         subtraction. Entry day = orderDate / dispatched / received / the DUE day
 *         respectively. Being a subset of the end depth, a queue value is ALWAYS ≥ 0.
 *         EXPECTED AND NOT A BUG: a queue's own big cumulative number can FALL over the
 *         same window in which its chip is positive (many exits, some new intake). The
 *         card is a depth, the chip is the week's intake still waiting — do NOT try to
 *         reconcile the two, and do not "fix" one to match the other.
 *     Values are stored UNCLAMPED; suppressing non-positive ones is each surface's
 *     rendering choice. SUPERSEDED TWICE: "INCREASE vs the previous report's snapshot"
 *     (the engine still produces that clamped legacy value, surviving ONLY as the
 *     degraded fallback when the stamper or the parsed rows are unavailable), and the
 *     2026-08-05 reading of the four queue keys as a SIGNED NET CHANGE (routinely
 *     negative) — that arithmetic is gone.
 *     This IS the whole key set (engine/asof.js NUMBER_KEYS); `completed` speaks the
 *     COMPLETED rule above (result date OR rejected) and `rejected` rides along as
 *     its own value — a SUBSET of completed, so the two chips must never be summed.
 */

/**
 * ReportModel = EngineOutput + editable content; the single input to build-spec.
 * @typedef {Object} ReportModel
 * @property {string} reportDate - 'YYYY-MM-DD'
 * @property {('kamc'|'sgh'|'both')} [hospital] - which report type this model is
 *   (model/hospital.js HOSPITAL_MODES). ABSENT ⇒ 'kamc': the historic single-hospital
 *   report, built from state.parsed.orders — every model built before the hospital
 *   registry, and every model the unattended automation builds. 'sgh' = the same shape
 *   built from SGH's rows only (no Test Menu: no TAT/late/turnaround/country, flagged
 *   by `noTestMenu: true`). 'both' = a DIFFERENT shape { hospital, reportDate,
 *   reportOptions, kamc, sgh, combined } (model/hospital-report.js buildBothModel)
 *   that build-spec dispatches to the KAMC+SGH design. Only an unscoped 'kamc' model
 *   ever writes the published history (snapshot / snapshotHistory). Nothing writes
 *   Settings.taskLog any more (since 2026-10-13; see that typedef).
 * @property {boolean} [noTestMenu] - set on an SGH model: its hospital has no Test Menu,
 *   so late / turnaround / country are UNKNOWN (printed «–»), not zero.
 * @property {EngineOutput} kpi
 * @property {{supportRequired:string[]}} panels - slide-2 «الدعم المطلوب» bullets: MANUAL
 *     content, empty unless the user typed some on the review screen (nothing is drafted
 *     from the tracker any more). completedTasks / plannedTasks - RETIRED 2026-10-13 (were
 *     auto-drafted from the old tracker's task log; no longer produced or read).
 * @property {ProjectTracker|null} projectTracker - the project task tracker the
 *     «متابعة المشروع» slides render (slidespec/build-tracker.js), identical in the
 *     internal and the NUPCO deck; null = no tracker loaded → no tracker slides. Carried
 *     by EVERY report model (KAMC, SGH, KAMC+SGH, automation) since 2026-10-13.
 * @property {TrackerTask[]} [tasksCurrent]  - RETIRED 2026-10-13 (no longer produced from
 *     a tracker; the tracker slides replaced the task-list slide). Was: slide 7 rows.
 * @property {TrackerTask[]} [tasksInternal] - RETIRED 2026-10-13, as tasksCurrent. Was:
 *     internal-variant task rows (category 'لين', model/drafts.js splitTaskLists).
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
 * @property {string[]} [slideOrder] - the review screen's TEMPORARY slide order for THIS
 *   report only (unit keys, model/slide-order.js). Wins over reportOptions.slideOrder (the
 *   saved one) in every deck builder; memory only, never written to settings, never set on
 *   the automation's model. Absent ⇒ the saved order (else the default).
 * @property {{start:string, end:string, mode:('daily'|'week'), approx?:Object<string,boolean>}} [deltaWindow]
 *   - the ACTIVITY WINDOW kpi.deltas were counted over, stamped by
 *     model/delta-window.js stampWindowDeltas (ui/screen-review.js on render/preview/
 *     mode-switch, ui/screen-generate.js and automation/pipeline.js before file
 *     production). start/end are inclusive 'YYYY-MM-DD'; mode 'week' → start is the
 *     SUNDAY that opens reportDate's Sun–Thu work week (a Fri/Sat report date maps
 *     back into the week that just ended), mode 'daily' → start === end === reportDate.
 *     THE WINDOW MEANS TWO DIFFERENT THINGS PER KEY CLASS, and a surface that states it
 *     must state the one it is showing (see kpi.deltas above): for the six CUMULATIVE
 *     keys it is the span the EVENTS were dated in; for the four QUEUE keys it is the
 *     span the rows ENTERED their state in — those chips count SURVIVING ENTRANTS
 *     (entered in-window, still in the state at `end`), are always ≥ 0, and may be
 *     positive while the matching big cumulative number falls. That is expected; the
 *     chip and the card answer different questions and are not to be reconciled.
 *     `approx` bubbles engine/asof.js's own caveats for the two endpoints; only
 *     `rejected` (with its `completed` twin) is surfaced to the operator, because a
 *     rejection carries no timestamp and such a row is dated by its result date or,
 *     failing that, by the last milestone it reached.
 *     ABSENT means no window was stamped — the parsed rows were unavailable (a mock
 *     preview) or the module was missing — and kpi.deltas is then the engine's own
 *     clamped legacy delta; the banner and the deck legend fall back to undated wording.
 *     REPLACES the retired `deltaBaseline` {baselineDate, mode, anchored,
 *     definitionShift}: the chips no longer diff against a STORED report, so a baseline
 *     date, its anchored flag and its definition-version disclosure all ceased to exist.
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
 *     baseline when snapshotHistory has no entry before the report date. Since
 *     2026-08-05 the delta chips no longer read either, so this is a published
 *     record for the history panel and the store's own migrations.
 *     Optional `defVersion` (SIBLING of numbers, never inside it — see
 *     seeds/defaults.js SNAPSHOT_SEED) stamps WHICH definition `numbers` speaks:
 *     2 = completed includes rejected (2026-07-28 rule). Unstamped baselines are
 *     dated by model/delta-baseline.js instead.
 * @property {Object<string,Object<string,number>>} snapshotHistory
 *   - rolling per-date history of published report numbers, key 'YYYY-MM-DD' →
 *     the same number set snapshot.numbers holds. Trimmed to the most recent 45
 *     dates (model/delta-baseline.js recordSnapshot). Read by the review screen's
 *     progress panel (ui/history-table.js: published vs computed numbers) — as of
 *     2026-08-05 it no longer feeds the delta chips, which are computed from the
 *     rows' own dates instead (model/delta-window.js). An entry
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
 *     INERT since 2026-10-13: the old task-list slides it served are retired, so nothing
 *     writes it; the stored value is kept (and still imported / exported) unchanged.
 * @property {{baseUrl:string, accessToken:string, panelId:number, enabled:boolean}} grafana
 *   - live data source (Grafana PUBLIC-dashboard query API). baseUrl like
 *     'https://elab.seha.sa/hpapm'. Empty/disabled → CSV drop only. The access
 *     token is the public-dashboard token (view-only, server-side-masked data);
 *     it is NEVER seeded in the repo — the user enters it once in Settings.
 * @property {{excludeNoTat:boolean, slides:Object<string,boolean>, kpiCards:Object<string,boolean>, labels:Object<string,string>, deltaMode:('daily'|'week'), autoDownloadFiles:boolean, trackerLang:('ar'|'en'|'both'), slideOrder?:string[]}} reportOptions
 *   - presentation defaults: excludeNoTat drops rows with no TAT from ANY source
 *     (lookup + CSV fallback = null → 'No Match') before aggregation; slides keys
 *     'execFunnel'|'monthly'|'compliance'|'action'|'challenges'|'definitions'|'sendout'|'tracker' toggle the middle
 *     slides ('tracker' = «متابعة المشروع», default ON, every report type, since
 *     2026-10-13; 'action' is the retired task-list slide, kept inert for compatibility) (cover/thanks always render; page numbers renumber) — 'definitions'
 *     ('منهجية الأرقام') defaults OFF, so the delivered deck is the simple six-slide
 *     shape; kpiCards keys mirror the deltas
 *     keys and hide exec-slide cards (row geometry repacks); labels overrides the
 *     DEFAULT_LABELS registry in slidespec/build-spec.js (empty = built-in text);
 *     deltaMode sizes the exec delta-chip ACTIVITY WINDOW (2026-08-05 semantics —
 *     SAME two values, SAME storage key, no schema bump; what changed is what they
 *     select). 'week' (the DEFAULT since 2026-08-04) = [the SUNDAY that opens the
 *     report date's Sun–Thu work week, the report date], so Thursday's deck carries
 *     the whole week's activity and a Fri/Sat report date folds into the week that
 *     just ended; 'daily' = the report date alone. SUPERSEDED: the mode used to pick
 *     WHICH STORED REPORT to diff against (week-to-date vs the last report), with an
 *     anchored:false degrade when history was still filling up — the chips are now
 *     computed from the rows' own dates (ReportModel.deltaWindow), so no stored
 *     report is read and the degrade cannot happen. The retired 'weekly' /
 *     'weekly-sun' / 'weekly-thu' values are still ALIASES of 'week'; schema v7
 *     forces stored 'daily' to 'week' once (see model/delta-baseline.js
 *     normalizeDeltaMode, model/delta-window.js windowFor and store.js
 *     migrateV6toV7).
 *     autoDownloadFiles (default TRUE; an ABSENT key means ON — it post-dates the
 *     feature) governs ONLY the manual generate flow: whether the 4 produced files
 *     are pushed to the browser automatically, or the operator picks them from the
 *     success panel's per-file buttons. Mobile never auto-downloads either way. It is
 *     strictly INDEPENDENT of automation.autoDownload below, which arms the
 *     UNATTENDED run's downloads — the single predicate is
 *     automation/pipeline.js shouldAutoDownloadFiles.
 *     trackerLang (2026-10-13; default 'ar'; enum owned by ingest/task-tracker.js
 *     TRACKER_LANGS) is the «متابعة المشروع» slides' text language for the task /
 *     track / milestone cells: 'ar' = the Arabic translation (taskAr / trackAr /
 *     milestoneAr), the English per cell where it is ''; 'en' = English only (the
 *     pre-translation slides); 'both' = Arabic with the English original under it.
 *     slideOrder (2026-10-13; model/slide-order.js owns the vocabulary) is the SAVED,
 *     fixed order of the content-slide UNITS ('execFunnel'|'shipments'|'monthly'|
 *     'sendout'|'compliance'|'tracker'|'challenges'|'definitions' — a unit moves with
 *     all its pages; cover stays first, thanks last). OPTIONAL: ABSENT means the default
 *     order (the historic deck, byte-identical), and it is never seeded or backfilled,
 *     so a unit added later lands at its default place. A stored list is normalised to
 *     a full permutation (unknown / duplicate / retired 'action' names dropped). Every
 *     deck type reads the same list and skips the units it lacks. The automation uses
 *     only this saved order (a one-report order is ReportModel.slideOrder). An import
 *     REPLACES it, absence included: a backup whose reportOptions has no slideOrder is a
 *     default-order backup and resets the device to the default.
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
 * @property {{model:ProjectTracker, updatedAt:string}|null} cachedTracker
 *   - the project task tracker DOCUMENT: the last uploaded MISBAR Task Tracker plus
 *     every website edit (model.editedAt), reused when no fresh file is dropped and
 *     read by the automation. updatedAt = when the cache was last written. Only the
 *     TAGGED shape is kept: an untagged (old-format) cache becomes null on load, and an
 *     old backup's untagged cache is discarded on import (store.js). NOTE on the no-PHI
 *     invariant: this is PROJECT-management content (tasks, owners, dates), not
 *     patient data — patient rows remain memory-only.
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
