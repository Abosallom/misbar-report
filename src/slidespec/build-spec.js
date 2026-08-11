// src/slidespec/build-spec.js
// buildSpec(reportModel, { variant }) -> SlideSpec (see src/contracts.js).
// One builder per slide. ALL geometry is in inches, derived by converting EMU->inches
// (÷914400) from the original deck OOXML (تقرير مسبار 09072026.pptx).
// SEVEN-slide deck (both variants, since 2026-08-04):
//   cover · execFunnel · monthly · compliance · action (المهام) · challenges (التحديات
//   والمخاطر) · thanks.
// The action slide used to carry the tasks table AND the support band AND the challenges +
// risks tables; the user's 2026-08-04 review split the last three onto their own slide so
// every block has room (tasks 15 → 18 rows, challenges/risks 3 → 10 rows each).
// The definitions slide (منهجية الأرقام) is built on demand only — it is OPT-IN via
// reportOptions.slides.definitions === true (user decision 2026-07-26: the default deck is
// back to the simple 20-07 reference shape). The internal variant may still exceed six
// slides through task-pagination continuation slides ('المهام — تتمة').
// The variant no longer changes slide PRESENCE — it changes slide-5 (action) task ROWS:
// nupco shows tasksCurrent (non-لين actions); internal shows tasksInternal ONLY (لين-category
// actions — user decision 2026-07-19). No slide is internalOnly.
//
// PRESENTATION OPTIONS (all read from the model, safe defaults when absent):
//   m.reportOptions.labels[key]   overrides DEFAULT_LABELS static text (byte-stable when absent)
//   m.reportOptions.slides[key]   toggles the 5 middle slides (cover/thanks always render)
//   m.reportOptions.kpiCards[key] toggles the 7 exec KPI cards (row geometry repacks)
//                                 + the OPT-IN 'turnaround' block on the monthly slide
//   m.overrides[key]              per-run manual NUMBER overrides (suppresses that delta chip)
import { COLORS as C, GEOM } from '../theme.js?v=v2026-08-10.1';

// OPT-IN kpiCards KEYS. reportOptions.kpiCards normally reads "on unless === false"
// (see buildExec's cardDefs filter). The keys in this set INVERT that: they render only
// when the flag is explicitly true, so a missing/undefined flag reads as OFF — exactly
// the mechanism OPT_IN_SLIDES gives the definitions slide (see buildSpec below).
// 'turnaround' gates the monthly slide's turnaround LINE CHART *and* its navy
// overall-average card (user decision 2026-07-26: the default monthly slide matches the
// 20-07 reference deck — chrome + the monthly table + ONE bar chart, nothing else).
const OPT_IN_CARDS = new Set(['turnaround']);
const cardOn = (m) => (key) => (OPT_IN_CARDS.has(key)
  ? m.reportOptions?.kpiCards?.[key] === true
  : m.reportOptions?.kpiCards?.[key] !== false);

// ============================================================================
// LABELS REGISTRY — user-facing STATIC strings. DEFAULT_LABELS holds the built-in
// Arabic text (identical to the historic hardcodes, so the default render is
// byte-stable); LABEL_NAMES holds a short Arabic description per key for the
// labels-editor UI. Runtime lookup: L(key) = m.reportOptions.labels[key] ?? default.
// ============================================================================
export const DEFAULT_LABELS = {
  // Slide titles (top-bar section headers)
  titleExec: 'الملخص التنفيذي  •  رحلة الطلب',
  titleMonthly: 'الطلبات والنتائج الشهرية',
  titleCompliance: 'مقياس الالتزام',
  // SPLIT 2026-08-04 (user review): the old single slide crammed the tasks table, the
  // الدعم المطلوب band and the challenges + risks tables onto one page, which capped the
  // tasks at 15 rows in a 3.35in strip and the other two tables at THREE rows each. It is
  // now two slides — 'action' (tasks only, full band) and 'challenges' — so titleAction
  // drops the والتحديات والمخاطر half of its name and the new titleChallenges carries it.
  titleAction: 'المهام',
  titleChallenges: 'التحديات والمخاطر',
  titleActionCont: 'المهام — تتمة',
  // Block subheads. These were hard-coded strings inside buildAction until the 2026-08-04
  // split; they are registry keys now, like every other user-facing static string.
  subheadTasks: 'المهام الحالية',
  subheadChallenges: 'تحديات',
  subheadRisks: 'المخاطر',
  // Cover + thanks
  // ALWAYS 'الأسبوعي' — for BOTH variants (user decision 2026-08-10). The deck's chips
  // now report a WEEK's activity window (see execDeltaLegendWeekWindow), so a cover that
  // said 'اليومي' contradicted the legend two slides later. The daily/weekly distinction
  // survives only in the chip window itself, never in the cover's name.
  coverTitle: 'تقرير مسبار الأسبوعي',
  coverSubtitle: 'متابعة تقدم الطلبات وقياس جاهزية المختبرات',
  coverPreparedBy: 'إعداد: لين لخدمات الأعمال',
  thanks: 'شكرا لكم',
  // Exec KPI card labels (keys mirror the deltas/overrides keys).
  // WORDING IS THE 20-07 REFERENCE DECK's, verbatim (user decision 2026-07-26): the user
  // hand-retyped these cards in PowerPoint from 'طلبات' to 'فحوصات' ("all numbers are for
  // tests"), so his own hand-typed strings are the spec. Extracted run-by-run from
  // ppt/slides/slide2.xml — the reference splits several of them across runs
  // ('إجمالي' + ' ' + 'الفحوصات', 'فحوصات' + ' مكتملة', 'فحوصات ' + 'شُحنت' + ' ولم تُستلم');
  // the concatenated string is what is stored here.
  kpiTotal: 'إجمالي الفحوصات',
  // The reference's awaitingDispatch card carries 'في انتظار شحن العينة من المستشفى' in the
  // LABEL (its box was hand-widened to 1.75in to fit) and the fragment 'قبل الـ' in the
  // sublabel — the user typed 'من المستشفى' up into the label and deleted ' Dispatch' off
  // the sublabel in the same pass. We keep the generator's 1.479in label box, so the split
  // is restored to label + sublabel with every reference word preserved.
  kpiAwaitingDispatch: 'في انتظار شحن العينة',
  kpiAwaitingResults: 'فحوصات تحت الإجراء',
  kpiCompleted: 'فحوصات مكتملة',
  // NOT RENDERED in the exec KPI row any more — the reference row is SIX cards and drops
  // المرفوضة (user decision 2026-07-26). The metric still ships in the per-lab compliance
  // table (compRejected). This key stays in both registries for parity, like execPartition.
  kpiRejected: 'النتائج المرفوضة',
  kpiLate: 'الطلبات المتأخرة',
  kpiShipped: 'فحوصات شُحنت ولم تُستلم',
  // Exec slide — overall completion-rate line. NOT RENDERED (user decision 2026-07-26:
  // the 20-07 reference deck has no such line); kept for registry parity like execPartition.
  execCompletionRate: 'نسبة الاكتمال الإجمالية',
  // Exec slide — delta-chip legend. ALL chips are green (user decision 2026-07-23): the
  // old red/green colour key was removed. Rendered only when a chip is visible this run.
  //
  // 2026-08-05 — THE LEGEND NOW NAMES A WINDOW, NOT A BASELINE. THE INVARIANT: the big
  // numbers on this slide (and on the monthly/compliance slides) REMAIN CUMULATIVE
  // TOTALS; only the chips changed meaning — they are the WEEK'S ACTIVITY, the events
  // dated Sunday..report-day, counted from the CSV's own date columns
  // (model/delta-window.js). So the legend states the window's own dates:
  //   week  → '▲ نشاط الأسبوع من الأحد {start} حتى {end}'
  //   daily → '▲ نشاط يوم {end}'
  // The FIVE baseline-era keys below are RETIRED but KEPT as registry orphans: a labels
  // override saved against one of them must not vanish out from under the operator, and
  // DEFAULT_LABELS/LABEL_NAMES key parity is test-pinned. Nothing reads them — they are
  // marked (غير مستخدم حالياً) in LABEL_NAMES so the labels editor says so.
  // execDeltaLegend is NOT retired: it is the undated generic fallback used whenever a
  // model carries no deltaWindow (rows unavailable → the engine's own deltas).
  execDeltaLegend: '▲ التغيّر منذ التقرير السابق',
  execDeltaLegendWeekWindow: '▲ نشاط الأسبوع من الأحد {start} حتى {end}',
  execDeltaLegendDayWindow: '▲ نشاط يوم {end}',
  execDeltaLegendDaily: '▲ التغيّر منذ آخر تقرير ({date})',
  execDeltaLegendWeek: '▲ التغيّر منذ بداية الأسبوع — مقارنة بتقرير ({date})',
  execDeltaLegendWeekly: '▲ التغيّر الأسبوعي — منذ تقرير ({date})',
  execDeltaLegendWeeklySun: '▲ التغيّر الأسبوعي — منذ تقرير الأحد ({date})',
  execDeltaLegendWeeklyThu: '▲ التغيّر الأسبوعي — منذ تقرير الخميس ({date})',
  // Monthly table row labels (also reused as the monthly bar-chart series names).
  // monthlyRowIncomplete surfaces the engine's `pending` partition value
  // (orders = results + rejected + pending). Its WORDING is the 20-07 reference deck's
  // 'النتائج غير المكتملة' (user decision 2026-07-26) — the longer 'قيد المعالجة (بدون نتيجة)'
  // measured 137.1px = 1.428in in Cairo 10pt against a 1.312in label column (1.112in of
  // text width once pptxgenjs' default 0.1in cell margins are taken off), so it wrapped to
  // two lines in BOTH outputs and grew the 0.456in row in PowerPoint. The reference wording
  // measures 102.4px = 1.067in and fits on one line; it is also the series name the
  // reference deck's monthly bar chart used.
  // TABLE wording is the reference's own 'فحوصات' family (user decision 2026-07-26 — same
  // hand-retype as the KPI cards); the bar chart keeps the 'طلبات' family, see
  // chartMonthly* below.
  // monthlyRowResults RENAMED 2026-07-28 ('نتائج الفحوصات المستلمة' → 'فحوصات مكتملة'):
  // the engine's per-month `results` now follows the COMPLETED rule (result date OR
  // rejected — user decision "consider rejected as completed test"), so 'النتائج
  // المستلمة' ("results received") would have been factually wrong for the rejected lines
  // it now counts. The new wording is CHARACTER-IDENTICAL to the exec KPI card
  // (kpiCompleted) and the compliance column (compCompleted) — one metric, one name on
  // three slides, which is what makes the cross-slide agreement legible.
  // It also FIXES A WRAP: measured in the deck's self-hosted Cairo at 10pt against this
  // table's 1.312in label column (1.112in of text width after pptxgenjs' 0.1in cell
  // margins), 'نتائج الفحوصات المستلمة' is 1.462in and wrapped to two lines, and even
  // 'الفحوصات المكتملة' is 1.142in — still 0.029in over. 'فحوصات مكتملة' measures 0.982in
  // in this row's 10pt REGULAR body weight (1.052in at the compliance header's 10pt bold)
  // and fits on ONE line (+0.131in), like the reference's 'النتائج غير المكتملة' (1.067in).
  monthlyRowOrders: 'الفحوصات',
  monthlyRowResults: 'فحوصات مكتملة',
  monthlyRowRejected: 'النتائج المرفوضة',
  // monthlyRowIncomplete surfaces the engine's `incomplete` = orders − results. Since
  // 2026-07-28 that is orders − completed (rejected moved INSIDE completed), so the row
  // finally means exactly what it says and no longer double-counts the rejected lines.
  monthlyRowIncomplete: 'النتائج غير المكتملة',
  monthlyRowCompletion: 'نسبة الاكتمال',
  // Monthly BAR-CHART series names. These are SPLIT from the monthlyRow* keys (each pair
  // independently overridable) because the 20-07 reference deck's table and chart did not
  // agree: the user had retyped the TABLE rows to the 'فحوصات' family in PowerPoint while
  // the chart part (ppt/charts/chart1.xml c:ser c:tx = 'الطلبات' / 'النتائج المستلمة' /
  // 'النتائج غير المكتملة') was pristine app output PowerPoint never rewrote, so the
  // legend kept the original 'طلبات' family. That mismatch was PRESERVED here on purpose
  // — it was the reference deck's own state.
  // OVERRIDDEN 2026-08-04 (user reviewed the generated deck: "the chart legend must match
  // the table"): the reference-preservation argument loses to the reader, who sees a
  // legend and a table side by side on ONE slide naming the same three metrics
  // differently. So chartMonthlyOrders 'الطلبات' → 'الفحوصات' (= monthlyRowOrders) and
  // chartMonthlyResults 'النتائج المكتملة' → 'فحوصات مكتملة' (= monthlyRowResults, and
  // character-identical to kpiCompleted / compCompleted / defMCompleted — one metric, one
  // name, now on four slides). chartMonthlyIncomplete already matched the table row.
  // The keys STAY split: an override of the table row must not silently retitle the
  // chart series, and vice versa. Legend width impact is negligible — charts-svg.js
  // (:256-275) estimates legend width per character and 'الفحوصات' is SHORTER than
  // 'الطلبات' is wide by only ~1 glyph, while 'فحوصات مكتملة' is shorter than
  // 'النتائج المكتملة' outright.
  chartMonthlyOrders: 'الفحوصات',
  chartMonthlyResults: 'فحوصات مكتملة',
  chartMonthlyIncomplete: 'النتائج غير المكتملة',
  // Monthly partition footnote (under the table) — the orders add-up identity. Since
  // 2026-07-28 rejected is INSIDE completed, so it is no longer a partition term: the
  // months split in TWO, and the footnote says so rather than listing المرفوضة as a
  // third addend (which would double-count it).
  // RENDERED AGAIN since 2026-07-28 (it had been a dead key). The 'تشمل المرفوضة' clause is
  // the monthly slide's ONLY disclosure that the metric changed meaning: نسبة الاكتمال is
  // results/orders and `results` now follows the completed rule, which moves May 2026
  // from 72.4% to 85.7% and the overall figure from 68.3% to 70.7% on golden data — a
  // 13.3-point jump on one row that the slide otherwise explains nowhere (the exec slide
  // discloses it on the KPI card sublabel; this slide had no equivalent).
  // REWORDED 2026-08-04 (user: this line "reads messed up"). It was
  // 'الفحوصات = المكتملة (تشمل المرفوضة) + غير المكتملة' — a parenthetical dropped BETWEEN
  // the two addends of an RTL equation. Bidi mirrors '(' and ')' and the neutral '=' / '+'
  // take the paragraph direction, so the reader met a bracket in the middle of the sum and
  // had to work out whether 'غير المكتملة' was still an addend or part of the aside.
  // The equation is now COMPLETE AND UNBROKEN first, the aside follows after an em-dash
  // separator, and both addends carry the same names as the table rows they point at
  // (monthlyRowResults / monthlyRowIncomplete). Verified in the browser at 1280×720 in the
  // deck's self-hosted Cairo: reading each operator's client rect left→right gives
  // '— + =', i.e. right→left the reader meets '=' then '+' then the em-dash — the bidi
  // ordering is correct and no bracket interrupts the sum. Measured 4.170in at 9pt against
  // the 6.661in note box: ONE line, 2.49in of slack.
  monthlyPartition: 'الفحوصات = فحوصات مكتملة + النتائج غير المكتملة — المكتملة تشمل المرفوضة',
  // Compliance (byLab) table headers — the 20-07 NUPCO reference deck's wording (user
  // decision 2026-07-26), plus the فحوصات مكتملة column added 2026-07-27. EIGHT columns.
  // Logical RTL order (right→left) as buildCompliance authors them:
  //   # | المختبر | مجموع الطلبات | فحوصات مكتملة | طلبات مستلمة بانتظار نتيجة |
  //   ↳ منها مرفوضة | ↳ منها متأخرة | نسبة الطلبات المتأخرة
  // compPipeline / compOnTime / compResultedLate are NOT RENDERED as columns (they were
  // removed with the add-up equation footnote); the keys stay in both registries for
  // parity — harmless orphans, like catalogNote. compPipeline's TEXT is still used, in
  // the compPartition footnote, which names the term the table has no column for.
  compHash: '#',
  compLab: 'المختبر',
  compTotal: 'مجموع الطلبات',
  compCompleted: 'فحوصات مكتملة',
  compPipeline: 'قبل الاستلام',
  compAwaiting: 'طلبات مستلمة بانتظار نتيجة',
  // SECOND SUBSET HEADER (2026-07-28). الطلبات المتأخرة is a strict SUBSET of
  // 'طلبات مستلمة بانتظار نتيجة': engine.js counts late as `status === LATE &&
  // resultedMs == null`, which implies received-and-not-rejected, hence ⊆ awaitingResult
  // (test/compliance-completed.test.mjs asserts `r.late <= r.awaitingResult`). It was the
  // LARGER of the two double-count traps in this table — on golden data a reader adding
  // the printed columns gets 437+159+15+67 = 678 against a printed total of 618, and the
  // 67 late lines are 4.5× the 15 the مرفوضة marker protects; per row, Advanced Laboratory
  // Services .Co prints 301 total but 201+89+60 = 350. Once the deck teaches '↳ منها =
  // subset', leaving this one bare is a positive claim that it is NOT one, so it now
  // carries the same idiom — and the same wording as the definitions slide's defMLate,
  // which has always named this exact metric '↳ منها متأخرة'.
  // It is also NARROWER than the bare label (0.895in vs 0.996in, self-hosted Cairo 10pt
  // bold), which is what pays for the COL_W re-budget below.
  compLate: '↳ منها متأخرة',
  compOnTime: 'ملتزمة',
  compResultedLate: 'صدرت متأخرة',
  // SUBSET HEADER (user decision 2026-07-28: a rejected test IS a completed test).
  // مرفوضة is still its own column but is now counted INSIDE فحوصات مكتملة, so a reader
  // summing the columns would double-count it. The deck's existing idiom for exactly
  // this — see defMLate '↳ منها متأخرة', which is a subset of بانتظار النتائج — is the
  // '↳ منها' prefix; buildCompliance additionally paints this one header cell in the
  // lighter navy (C.taskNavy) so the subset column is visually subordinate to the
  // فحوصات مكتملة column it belongs to.
  // KNOWN LIMITATION — this column is NOT adjacent to the parent it belongs to. In the
  // authored (RTL) order the reader meets مكتملة, then بانتظار نتيجة, and only then this
  // '↳ منها مرفوضة', so pure adjacency (the idiom DEF_ROWS uses, where every '↳ منها' row
  // sits directly under its parent) points it at the wrong column — and the misreading
  // never self-contradicts, since rejected ≤ awaitingResult for every lab. The fix is to
  // swap the compRejected and compAwaiting columns so مرفوضة sits beside مكتملة, but the
  // three lockstep sites (header/labRows/totalRow) are pinned by the hard-coded index map
  // in test/compliance-completed.test.mjs (`const COL = {... awaiting: 4, rejected: 5}`),
  // which this file may not edit — cross-file, deferred. Until then compPartition (below,
  // rendered under the table) names BOTH subsets and their parents explicitly, so the
  // reader is not left to infer the parent from position.
  compRejected: '↳ منها مرفوضة',
  compLatePct: 'نسبة الطلبات المتأخرة',
  // Compliance partition footnote (under the by-lab table). The table prints only two of
  // the three partition terms — قبل الاستلام has no column (compPipeline is an orphan) —
  // so on golden data the printed columns give 437 + 159 = 596 against a printed total of
  // 618, a silent 22-line shortfall a reader cannot reconcile. It also states, in words,
  // which columns are subsets of which, because the ↳ markers alone cannot say that while
  // مرفوضة sits away from its parent (see compRejected). Measured 7.071in at 9pt in the
  // deck's self-hosted Cairo against the table's 11.667in width → one line, +4.6in slack.
  compPartition: 'مجموع الطلبات = قبل الاستلام + بانتظار نتيجة + فحوصات مكتملة · المرفوضة ضمن المكتملة، والمتأخرة ضمن بانتظار نتيجة — لا تُجمع معهما',
  // Tasks table headers
  taskStatus: 'الحالة',
  taskDue: 'تاريخ الإكتمال',
  taskOwner: 'المالك',
  taskResponsible: 'المسؤول',
  taskAction: 'الإجراء',
  taskHash: '#',
  // Support-required panel title
  supportTitle: 'الدعم المطلوب:',
  // Funnel column headers
  funnelStage: 'المرحلة',
  funnelCount: 'العدد',
  funnelDesc: 'الوصف',
  // Funnel OWNERSHIP-BRACKET labels — who owns which half of the journey. Stages 1-3
  // (إنشاء · سحب · شحن) happen at the hospital, stages 4-5 (إستلام · إصدار نتيجة) at the
  // lab. Rendered next to the ⊐ brackets on the right of the funnel; see buildExecFunnel.
  funnelGroupHospital: 'المستشفى',
  funnelGroupLabs: 'المختبرات',
  // Chart series / titles that are static text
  chartActual: 'الفعلي',            // turnaround line — actual series
  chartExpected: 'المتوقع',         // turnaround line — expected series
  chartDaysAxis: 'الأيام',          // turnaround line — value-axis title
  chartLateSeries: 'المتأخرة',       // late-by-test bar series (late count)
  chartOnTimeSeries: 'الملتزمة',      // late-by-test bar series (on-time / success count)
  overallAvgTitle: 'المتوسط العام لزمن الإنجاز', // overall-average card title
  // Exec KPI-row partition footnote (mirrors the compliance equation footnote).
  // Since 2026-07-28 مرفوضة is a SUBSET of مكتملة, not a sibling term, so it is dropped
  // from the addends (listing it would double-count) and named as an inclusion instead.
  execPartition: 'الإجمالي = بانتظار الشحن + شُحنت ولم تُستلم + بانتظار النتائج + مكتملة (تشمل المرفوضة)',
  // Cancelled note — split into parts so the historical-before-April breakdown is
  // registry-driven: '* {N} {execCancelledLabel} ({execCancelledHistPre} {hist} {execCancelledHistPost})'.
  execCancelledLabel: 'طلب ملغي',
  execCancelledHistPre: 'منها',
  execCancelledHistPost: 'قبل أبريل',
  // Compliance by-test catalog footnote (under the late/on-time chart).
  catalogNote: '* وفق قائمة الفحوصات المعتمدة',
  // Definitions slide ('منهجية الأرقام') — title, column headers, and per-row
  // metric + one-line definition. Definitions mirror the engine's documented rules.
  defsTitle: 'منهجية الأرقام',
  defsColMetric: 'المؤشر',
  defsColDef: 'التعريف',
  defMTotal: 'الإجمالي',                         defDTotal: 'سطور الطلبات غير الملغاة',
  defMAwaitDispatch: 'بانتظار الشحن',            defDAwaitDispatch: 'أُنشئ الطلب ولم تُشحن العينة بعد',
  defMShipped: 'شُحنت ولم تُستلم',               defDShipped: 'شُحنت العينة ولم يستلمها المختبر',
  defMAwaitResults: 'بانتظار النتائج',           defDAwaitResults: 'استلمها المختبر وبانتظار النتيجة',
  defMLate: '↳ منها متأخرة',                     defDLate: 'تجاوزت الاستحقاق بلا نتيجة',
  // COMPLETED and its three subsets. User decision 2026-07-28 — "consider rejected as
  // completed test": rejection is the lab's FINAL outcome, so a rejected line is finished
  // work, not work in progress. المرفوضة / ملتزمة / صدرت متأخرة are all counted INSIDE
  // الفحوصات المكتملة and therefore all carry the deck's '↳ منها' subset prefix (same
  // idiom as defMLate), so this slide can never be read as an add-up list.
  // The metric string is CHARACTER-IDENTICAL to compCompleted / kpiCompleted /
  // monthlyRowResults (2026-07-28). It used to read 'الفحوصات المكتملة' here, a near-miss
  // of the 'فحوصات مكتملة' the three printing slides carry — and the glossary is the one
  // place where an exact match is the whole point: a reader who turns this opt-in slide on
  // to look the term up must find the same string, not a paraphrase. It also still fits
  // with room to spare (1.049in at 8.5pt bold vs the 2.8in usable metric column).
  defMCompleted: 'فحوصات مكتملة',                defDCompleted: 'لها تاريخ نتيجة أو رُفضت — الرفض نتيجة نهائية',
  defMRejected: '↳ منها مرفوضة',                 defDRejected: 'رفض المختبر نتيجتها؛ جزء من المكتملة لا يُجمع معها',
  defMOnTime: '↳ منها ملتزمة',                   defDOnTime: 'صدرت ضمن المدة المعيارية',
  defMResultedLate: '↳ منها صدرت متأخرة',        defDResultedLate: 'صدرت النتيجة بعد الاستحقاق',
  defMPipeline: 'قبل الاستلام',                  defDPipeline: 'لم تصل المختبر بعد',
  defMPending: 'قيد المعالجة',                   defDPending: 'بلا نتيجة ولا رفض بعد',
  defMLatePct: 'نسبة التأخر',                    defDLatePct: 'المتأخرة ÷ بانتظار النتيجة',
  defMTurnaround: 'معدل الدوران الفعلي/المتوقع',  defDTurnaround: 'متوسط أيام؛ ن = عدد الطلبات المقاسة',
  defMCancelled: 'الملغاة',                      defDCancelled: 'من الملف + سجل تاريخي قبل أبريل',
};

export const LABEL_NAMES = {
  titleExec: 'عنوان شريحة الملخص التنفيذي',
  titleMonthly: 'عنوان شريحة الطلبات الشهرية',
  titleCompliance: 'عنوان شريحة مقياس الالتزام',
  titleAction: 'عنوان شريحة المهام',
  titleChallenges: 'عنوان شريحة التحديات والمخاطر',
  titleActionCont: 'عنوان شريحة تتمة المهام',
  subheadTasks: 'عنوان فرعي: المهام الحالية',
  subheadChallenges: 'عنوان فرعي: تحديات',
  subheadRisks: 'عنوان فرعي: المخاطر',
  coverTitle: 'عنوان الغلاف',
  coverSubtitle: 'العنوان الفرعي للغلاف',
  coverPreparedBy: 'سطر جهة الإعداد في الغلاف',
  thanks: 'نص شريحة الشكر',
  kpiTotal: 'بطاقة: إجمالي الفحوصات',
  kpiAwaitingDispatch: 'بطاقة: في انتظار شحن العينة',
  kpiAwaitingResults: 'بطاقة: فحوصات تحت الإجراء',
  kpiCompleted: 'بطاقة: فحوصات مكتملة',
  kpiRejected: 'بطاقة: النتائج المرفوضة (غير مستخدم حالياً)',
  kpiLate: 'بطاقة: الطلبات المتأخرة',
  kpiShipped: 'بطاقة: فحوصات شُحنت ولم تُستلم',
  execCompletionRate: 'سطر نسبة الاكتمال الإجمالية (غير مستخدم حالياً)',
  execDeltaLegend: 'مفتاح النشاط — الصيغة الافتراضية (بدون نافذة)',
  execDeltaLegendWeekWindow: 'مفتاح نشاط الأسبوع — من الأحد ({start}) حتى ({end})',
  execDeltaLegendDayWindow: 'مفتاح نشاط اليوم — ({end})',
  execDeltaLegendDaily: 'مفتاح التغيّر اليومي — منذ آخر تقرير ({date}) (غير مستخدم حالياً)',
  execDeltaLegendWeek: 'مفتاح التغيّر الأسبوعي — منذ بداية الأسبوع ({date}) (غير مستخدم حالياً)',
  execDeltaLegendWeekly: 'مفتاح التغيّر الأسبوعي — منذ تقرير قبل أسبوع ({date}) (غير مستخدم حالياً)',
  execDeltaLegendWeeklySun: 'مفتاح التغيّر الأسبوعي — منذ تقرير الأحد ({date}) (غير مستخدم حالياً)',
  execDeltaLegendWeeklyThu: 'مفتاح التغيّر الأسبوعي — منذ تقرير الخميس ({date}) (غير مستخدم حالياً)',
  monthlyRowOrders: 'صف الجدول الشهري: الفحوصات',
  monthlyRowResults: 'صف الجدول الشهري: فحوصات مكتملة (تشمل المرفوضة)',
  monthlyRowRejected: 'صف الجدول الشهري: النتائج المرفوضة (غير مستخدم حالياً)',
  monthlyRowIncomplete: 'صف الجدول الشهري: النتائج غير المكتملة',
  monthlyRowCompletion: 'صف الجدول الشهري: نسبة الاكتمال',
  chartMonthlyOrders: 'سلسلة الرسم الشهري: الفحوصات',
  chartMonthlyResults: 'سلسلة الرسم الشهري: فحوصات مكتملة (تشمل المرفوضة)',
  chartMonthlyIncomplete: 'سلسلة الرسم الشهري: النتائج غير المكتملة',
  compHash: 'عمود الالتزام: الرقم',
  compLab: 'عمود الالتزام: المختبر',
  compTotal: 'عمود الالتزام: مجموع الطلبات',
  compCompleted: 'عمود الالتزام: فحوصات مكتملة (تشمل المرفوضة)',
  compPipeline: 'عمود الالتزام: قبل الاستلام (غير مستخدم حالياً)',
  compAwaiting: 'عمود الالتزام: طلبات مستلمة بانتظار نتيجة',
  compLate: 'عمود الالتزام: ↳ منها متأخرة (جزء من بانتظار نتيجة)',
  compOnTime: 'عمود الالتزام: الطلبات الملتزمة (غير مستخدم حالياً)',
  compResultedLate: 'عمود الالتزام: صدرت متأخرة (غير مستخدم حالياً)',
  compRejected: 'عمود الالتزام: ↳ منها مرفوضة (جزء من المكتملة)',
  compLatePct: 'عمود الالتزام: نسبة الطلبات المتأخرة',
  compPartition: 'حاشية معادلة مجموع الطلبات (مقياس الالتزام)',
  taskStatus: 'عمود المهام: الحالة',
  taskDue: 'عمود المهام: تاريخ الإكتمال',
  taskOwner: 'عمود المهام: المالك',
  taskResponsible: 'عمود المهام: المسؤول',
  taskAction: 'عمود المهام: الإجراء',
  taskHash: 'عمود المهام: الرقم',
  supportTitle: 'عنوان لوحة الدعم المطلوب',
  funnelStage: 'ترويسة القمع: المرحلة',
  funnelCount: 'ترويسة القمع: العدد',
  funnelDesc: 'ترويسة القمع: الوصف',
  funnelGroupHospital: 'قوس القمع: مراحل المستشفى (١–٣)',
  funnelGroupLabs: 'قوس القمع: مراحل المختبرات (٤–٥)',
  chartActual: 'سلسلة زمن الإنجاز: الفعلي',
  chartExpected: 'سلسلة زمن الإنجاز: المتوقع',
  chartDaysAxis: 'عنوان محور الأيام',
  chartLateSeries: 'سلسلة الطلبات المتأخرة',
  chartOnTimeSeries: 'سلسلة الطلبات الملتزمة',
  overallAvgTitle: 'عنوان بطاقة متوسط زمن الإنجاز',
  execPartition: 'حاشية معادلة الإجمالي (الملخص التنفيذي) (غير مستخدم حالياً)',
  monthlyPartition: 'حاشية معادلة الفحوصات الشهرية',
  execCancelledLabel: 'نص ملاحظة الطلبات الملغاة',
  execCancelledHistPre: 'ملاحظة الملغاة: بادئة الجزء التاريخي',
  execCancelledHistPost: 'ملاحظة الملغاة: لاحقة الجزء التاريخي',
  catalogNote: 'حاشية قائمة الفحوصات (مقياس الالتزام)',
  defsTitle: 'عنوان شريحة منهجية الأرقام',
  defsColMetric: 'منهجية الأرقام: ترويسة عمود المؤشر',
  defsColDef: 'منهجية الأرقام: ترويسة عمود التعريف',
  defMTotal: 'منهجية: مؤشر الإجمالي',            defDTotal: 'منهجية: تعريف الإجمالي',
  defMAwaitDispatch: 'منهجية: مؤشر بانتظار الشحن', defDAwaitDispatch: 'منهجية: تعريف بانتظار الشحن',
  defMShipped: 'منهجية: مؤشر شُحنت ولم تُستلم',   defDShipped: 'منهجية: تعريف شُحنت ولم تُستلم',
  defMAwaitResults: 'منهجية: مؤشر بانتظار النتائج', defDAwaitResults: 'منهجية: تعريف بانتظار النتائج',
  defMLate: 'منهجية: مؤشر منها متأخرة',          defDLate: 'منهجية: تعريف منها متأخرة',
  defMCompleted: 'منهجية: مؤشر فحوصات مكتملة',    defDCompleted: 'منهجية: تعريف الفحوصات المكتملة',
  defMRejected: 'منهجية: مؤشر ↳ منها مرفوضة',     defDRejected: 'منهجية: تعريف المرفوضة',
  defMOnTime: 'منهجية: مؤشر ↳ منها ملتزمة',       defDOnTime: 'منهجية: تعريف ملتزمة',
  defMResultedLate: 'منهجية: مؤشر ↳ منها صدرت متأخرة', defDResultedLate: 'منهجية: تعريف صدرت متأخرة',
  defMPipeline: 'منهجية: مؤشر قبل الاستلام',      defDPipeline: 'منهجية: تعريف قبل الاستلام',
  defMPending: 'منهجية: مؤشر قيد المعالجة',       defDPending: 'منهجية: تعريف قيد المعالجة',
  defMLatePct: 'منهجية: مؤشر نسبة التأخر',        defDLatePct: 'منهجية: تعريف نسبة التأخر',
  defMTurnaround: 'منهجية: مؤشر معدل الدوران',     defDTurnaround: 'منهجية: تعريف معدل الدوران',
  defMCancelled: 'منهجية: مؤشر الملغاة',          defDCancelled: 'منهجية: تعريف الملغاة',
};

// Per-model label lookup: user override wins, else the built-in default.
const labelOf = (m) => (key) => (m.reportOptions?.labels?.[key] ?? DEFAULT_LABELS[key]);
// Per-model value lookup: a finite manual override wins, else the computed number.
const valueOf = (m) => (key, computed) => (Number.isFinite(m.overrides?.[key]) ? m.overrides[key] : computed);

// Colors present in the deck charts/cards but not in theme.js:
const CHART_BLUE = '#4472C4';   // chart1 series "الطلبات" (accent1)
const CHART_GRAY = '#A5A5A5';   // chart1 series "النتائج غير المكتملة" (accent3)
// 'فحوصات تحت الإجراء' card — the user RECOLOURED it in PowerPoint from the app's amber
// (#F59E0B) to a theme colour: slide2.xml carries <a:schemeClr val="accent1"><a:lumMod
// val="75000"/> on both that card's value run and its accent bar. theme1.xml's accent1 is
// srgbClr 4472C4; lumMod 75% (HSL L×0.75) resolves to #2F5597 — Office's "Blue, Accent 1,
// Darker 25%". Baked as a literal hex because the deck we emit carries no theme part.
const CARD_DEEP_BLUE = '#2F5597';
const CARD_TITLE = '#DCE6F1';   // overall-average card sub-title

// Gregorian month-name lookup ('01'..'12' -> Arabic). Drives the monthly table
// headers and BOTH slide-3 chart category lists off m.kpi.monthly, so labels track
// the data instead of being pinned to Jan–Jul.
const MONTH_NAMES_AR = {
  '01': 'يناير', '02': 'فبراير', '03': 'مارس',   '04': 'أبريل',  '05': 'مايو',   '06': 'يونيو',
  '07': 'يوليو', '08': 'أغسطس',  '09': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر',
};
const arMonthLabel = (key) => MONTH_NAMES_AR[String(key).split('-')[1]] || String(key);

// ---- tiny element factories -------------------------------------------------
const rect = (x, y, w, h, fill, extra = {}) => ({ t: 'rect', x, y, w, h, fill, ...extra });
const text = (x, y, w, h, t, size, o = {}) => ({ t: 'text', x, y, w, h, text: t, size, ...o });
const rev = (a) => a.slice().reverse();

// ---- formatting -------------------------------------------------------------
const fmtDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d} / ${m} / ${y}`; };
const pctLab = (n) => (n === 0 ? '0%' : n.toFixed(1) + '%');           // late-%
const pctMonthly = (n) => (n == null ? '-' : n === 100 ? '100%' : n.toFixed(1) + '%');
const bullets = (items) => items.map((s) => '•  ' + s).join('\n');
// Exec delta-chip text: POSITIVE-ONLY (user decision 2026-08-10). '+N' for a rise;
// 0, negative and non-finite ALL collapse to undefined, i.e. NO CHIP AT ALL. The old
// '−N' drop form (− was U+2212, not a hyphen) is GONE — a chip is now strictly an
// "this much happened during the window" badge, never a net-movement one.
//
// WHY a drop can no longer be printed: the chips read a WINDOW, not a baseline diff.
// The four QUEUE metrics (awaitingDispatch / shippedNotReceived / awaitingResults /
// lateNoResult) are counted as SURVIVING ENTRANTS — rows that entered the state inside
// [window.start .. window.end] and are still in it at window.end — so they are ≥ 0 by
// construction and can be positive while the card's cumulative total is falling. The
// CUMULATIVE metrics (total/collected/dispatched/received/completed/rejected) stay
// in-window EVENT counts, also ≥ 0 on well-formed rows. A negative therefore means the
// number is not the window activity this chip claims to show (a legacy engine delta, or
// backdated/corrected rows re-shaping the asof() pair) — printing '−N' beside a
// CUMULATIVE big number would read as "the total fell", which is not what it measures.
// Hiding is the honest degradation: the big number is unaffected, the reader just loses
// one badge. ALL chips are green (user decision 2026-07-23) — the BAD_DELTA red-chip
// logic is long gone, so a drop had no colour of its own to be read by anyway.
//
// anyChip (the legend gate) and the funnel's stageDelta both route through here, so the
// legend and every chip surface follow this rule automatically — nothing else to gate.
const fmtDelta = (n) => (Number.isFinite(n) && n > 0 ? '+' + n : undefined);
// Delta-chip legend text — it names the ACTIVITY WINDOW the chips were counted over,
// read straight off model.deltaWindow {start, end, mode} (model/delta-window.js). One
// source, two surfaces: the review banner's deltaWording (ui/screen-review.js) reads the
// SAME object with the same precedence, so the operator's banner and the audience's
// slide can never claim different windows.
//
// THE INVARIANT this legend must not misstate: the big numbers on the slide are
// CUMULATIVE TOTALS; only the ▲ chips are the window's activity. The wording says
// نشاط (activity) for exactly that reason — never 'التغيّر منذ …', which described the
// retired stored-baseline diff.
//
// The stamped `mode` decides the wording; 'daily' is the single-day form, anything else
// (i.e. 'week') the Sunday-anchored form. With no deltaWindow, or one missing its dates,
// the undated generic wording is used — that is the shape a model carries when the rows
// were unavailable and the engine's own deltas survived.
//
// DELTA_LEGEND_KEY and the anchored-downgrade branch it fed are DELETED: there is no
// baseline to be un-anchored, and no retired mode value can arrive here (the stamped
// mode is normalizeDeltaMode's canonical output, always 'daily' or 'week'). A stale
// cached model/delta-window.js cannot emit a third value, so the old stale-cache mapping
// has nothing left to protect against; an unexpected mode falls into the week form,
// whose dates are still read from the same stamp and are therefore still true.
// ISO-shape gate, not just a truthiness one: fmtDate splits on '-' and would emit
// 'undefined / undefined / …' for anything else. A malformed stamp must degrade to the
// undated wording, never print garbage onto a delivered slide.
const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const deltaLegendText = (L, dw) => {
  if (!dw || !isIsoDate(dw.end)) return L('execDeltaLegend');
  const end = fmtDate(dw.end);
  if (dw.mode === 'daily') return L('execDeltaLegendDayWindow').replace('{end}', end);
  if (!isIsoDate(dw.start)) return L('execDeltaLegend');
  return L('execDeltaLegendWeekWindow')
    .replace('{start}', fmtDate(dw.start))
    .replace('{end}', end);
};

// ---- repeated chrome (top bar, section title, corner tags, footer border) ---
// Page numbers are NOT emitted here — buildSpec assigns them AFTER slide filtering
// so they renumber 1..n over the INCLUDED content slides (see pageFooter).
function chrome(title) {
  return [
    rect(0, 0, GEOM.slideW, 0.08, C.navy),
    text(0.5, 0.25, 12.3, 0.55, title, 22, { bold: true, color: C.navy, align: 'center', valign: 'middle', rtl: true }),
    text(10.9, 0.3, 2.0, 0.4, 'NUPCO  |  Lean', 10, { color: C.slate500, align: 'right', valign: 'middle' }),
    text(0.4, 0.3, 3.5, 0.4, 'مسبار', 10, { color: C.slate500, align: 'left', valign: 'middle', rtl: true }),
    rect(0.5, 7.1, 12.3, 0.012, C.border),
  ];
}

// Sequential page-number footer, appended post-filter (y/size are the historic
// footer coordinates the checkspec locates by).
const pageFooter = (pageNo) => text(0.5, 7.15, 0.8, 0.3, String(pageNo), 9, { color: C.slate500, align: 'left', valign: 'middle' });

// ============================================================================
// Slide 1 — Cover
// ============================================================================
function buildCover(m) {
  const L = labelOf(m);
  return {
    id: 'cover', bg: C.navy, elements: [
      rect(0, 0, 0.15, 7.5, C.purple),
      rect(13.15, 0, 0.15, 7.5, C.orange),
      text(8.7, 0.5, 4.0, 0.5, 'NUPCO  |  Lean', 18, { bold: true, color: C.white, align: 'right', valign: 'middle' }),
      text(0.6, 2.6, 11.9, 1.3, L('coverTitle'), 60, { bold: true, color: C.white, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 4.0, 11.9, 0.6, L('coverSubtitle'), 22, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 6.15, 11.9, 0.4, 'تاريخ التقرير: ' + fmtDate(m.reportDate), 12, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true }),
      text(0.6, 6.55, 11.9, 0.4, L('coverPreparedBy'), 12, { color: CARD_TITLE, align: 'right', valign: 'middle', rtl: true }),
    ],
  };
}

// ============================================================================
// Slide 2 — Executive summary + order-journey funnel (merged)
// ============================================================================
// KPI card factory. Width is a param (the row repacks for N cards).
// INTERIOR GEOMETRY IS THE 20-07 REFERENCE DECK's, verbatim (user decision 2026-07-26 —
// the reference deck is the spec). Fixed offsets from the card origin, NOT derived from
// an ink-line formula: value 34pt at (x+0.08, y+0.13, w−0.24, 0.72), label 11.5pt at
// (x+0.08, y+0.90, w−0.16, 0.42) with NO line-spacing override (the reference slide
// carries zero <a:lnSpc>), sublabel 9.5pt at (x+0.08, y+1.28, w−0.16, 0.28).
// The one deliberate departure is the delta chip's POSITION — no longer its SIZE.
// The reference's chip box sits at (x+0.10, y+0.30, 0.9, 0.42) at 20pt, i.e. straight
// over the restored 34pt value band (y+0.13 → y+0.85); it only looked clean there
// because the '+N' runs had been hand-deleted. So the chip keeps the TOP-LEFT corner
// this generator moved it to — left-aligned against a right-aligned value — but as of
// 2026-08-10 it is drawn at the REFERENCE'S OWN 20pt, not the 13pt this comment used to
// justify. 13pt was chosen when the only worry was clearance; the user's round-4 review
// called the chip illegible at that size and set the ratio bar at 55-65% of the number
// it annotates. 20/34 = 58.8%, mid-band, and it is the size the deck was designed with.
// The box grows with the type: (x+0.06, y+0.04, 0.90, 0.30) — 0.90in wide so a 20pt
// '+123' has room to set on ONE line (0.55in at 13pt would have wrapped it), and pushed
// up to y+0.04 to spend the extra height upward, away from the value's optical centre.
// The box h 0.30 is SMALLER than the 20pt line box (≈0.52in by the 0.0258in/pt Cairo
// constant measured for the funnel chips); with the renderers' default valign 'top' the
// overflow spills DOWNWARD off an unfilled, unbordered text box, which is invisible. Do
// NOT "fix" it by adding valign:'middle' — that would re-centre the ink INTO the 34pt
// value band, which is the one thing the top-left placement exists to avoid.
// CLEARANCE IS HORIZONTAL, and it is TIGHTER than at 13pt: the chip's ink grows
// rightward from x+0.11 (box + pptxgenjs' 0.05in inset) while the value's grows leftward
// from x+1.429, over 1.319in of shared span on a 1.639in card. MEASURED against the
// deck's own Cairo-700 metrics (digits ≈0.56em tabular): a 1-2-digit chip beside the
// 3-digit values this deck prints today clears by 0.155–0.31in — real but not the ≈0.5in
// an eyeball guess suggests. A 4-DIGIT value is a genuine collision at 20pt (≈0.11in of
// horizontal ink overlap, ≈0.07in vertical on the PPTX path) and NO size inside the
// user's 55–65% band resolves it — which is why the emitter below falls back to the
// pre-round-4 13pt box once the value string reaches 4 characters: that geometry's
// clearance against 4-digit values is proven by every deck shipped before 2026-08-10.
// See the delta-legend note in buildExecFunnel.
// EMPHASIS (emph: true) is the treatment the user hand-built for الطلبات المتأخرة on the
// reference slide: he duplicated the 0.063in accent bar twice, stretched each to the full
// card width and dropped one on the card's top edge and one on its bottom edge, so the
// white card reads as a red-outlined box. Reference shapes (slide2.xml, the last two in the
// spTree, i.e. drawn on top): #FF0000, w 1.639 = card width, h 0.0793, top bar y 0.9296
// (= card y) and bottom bar y 2.4643 (= card y + h − 0.0657, straddling the bottom edge).
// Their x values are −0.0088 / −0.0315, i.e. the card x minus hand-drag noise; the
// generator emits them at the card x. The right accent bar STAYS — the reference kept it.
function kpiCard({ x, w, v, vc, lab, sub, ac, delta, emph }) {
  const y = 0.93, h = 1.6;
  const els = [
    rect(x, y, w, h, C.white, { radius: 0.05, line: { color: C.border, w: 0.75 } }),
    rect(x + w - 0.063, y, 0.063, h, ac),
    // value — 34pt, right-aligned (reference: sz=3400 on every card)
    text(x + 0.08, y + 0.13, w - 0.24, 0.72, v, 34, { bold: true, color: vc, align: 'right', valign: 'middle' }),
    // label — 11.5pt (reference: sz=1150, no lnSpc)
    text(x + 0.08, y + 0.9, w - 0.16, 0.42, lab, 11.5, { bold: true, color: C.slate900, align: 'right', valign: 'top', rtl: true }),
  ];
  // delta chip — TOP-LEFT corner, left-aligned; horizontally clear of the value.
  // ALWAYS green now (user decision 2026-07-23) — no per-metric colour branching.
  // 20pt = 58.8% of the 34pt value (user decision 2026-08-10); see the size note above,
  // including why a 4-character value drops the chip back to the proven 13pt box.
  if (delta) {
    els.push(String(v).length >= 4
      ? text(x + 0.06, y + 0.06, 0.55, 0.24, delta, 13, { bold: true, color: C.deltaGreen, align: 'left' })
      : text(x + 0.06, y + 0.04, 0.90, 0.30, delta, 20, { bold: true, color: C.deltaGreen, align: 'left' }));
  }
  // sublabel — 9.5pt (reference: sz=950)
  if (sub) els.push(text(x + 0.08, y + 1.28, w - 0.16, 0.28, sub, 9.5, { color: C.slate500, align: 'right', valign: 'top', rtl: true }));
  // emphasis bars LAST so they paint over the card body, as they do in the reference.
  if (emph) {
    els.push(rect(x, y, w, 0.0793, ac), rect(x, y + h - 0.0657, w, 0.0793, ac));
  }
  return els;
}

// The KPI cards own these metrics' delta chips; the funnel must not duplicate them.
const KPI_DELTA_KEYS = new Set(['total', 'awaitingDispatch', 'awaitingResults', 'completed', 'rejected', 'lateNoResult', 'shippedNotReceived']);

// KPI row geometry (canonical 7-card layout): cards between x 0.500 and 12.818
// (span 12.318in), gap 0.140. cardW = (12.318 − (N−1)×0.140)/N, capped at the
// original 1.903in and TRUNCATED to 3 decimals so N=7 reproduces 1.639 exactly.
// The row is right-aligned: the rightmost card's right edge stays at 12.818 and
// cards fill leftward (RTL-natural), so dropping a card never shifts the right edge.
const KPI_SPAN = 12.318, KPI_GAP = 0.140, KPI_CAP_W = 1.903, KPI_RIGHT = 12.818;
function kpiRowGeom(n) {
  const N = Math.max(n, 1);
  let cardW = Math.min((KPI_SPAN - (N - 1) * KPI_GAP) / N, KPI_CAP_W);
  cardW = Math.floor(cardW * 1000) / 1000;          // N=7 => 1.639 (byte-stable)
  const step = cardW + KPI_GAP;
  const xOf = (i) => Math.round((KPI_RIGHT - cardW - i * step) * 1000) / 1000; // i=0 rightmost
  return { cardW, xOf };
}

// CANONICAL SIX-CARD ROW — pinned to the reference deck's own boxes (user decision
// 2026-07-26). kpiRowGeom(6) would NOT reproduce them: at N=6 the computed width
// (11.618/6 = 1.936) clamps to the KPI_CAP_W 1.903 cap, giving six 1.903in cards on a
// 2.043 pitch. The reference instead keeps the 7-card 1.639in card and simply deletes
// المرفوضة, leaving the remaining five in their old slots and dragging الطلبات المتأخرة
// flush to the left edge. Card x, EMU→in from slide2.xml (index 0 = rightmost):
//   11.179 · 9.400 · 7.587 · 5.774 · 3.995 · 0.000   (w 1.639, y 0.93, h 1.6)
// Two hand-drag artefacts are normalised: the شُحنت card sits at y 0.9500 in the reference
// (0.02in below its five neighbours) and the الطلبات المتأخرة emphasis bars at x −0.0088 /
// −0.0315; we emit y 0.93 for every card and x 0.000 for that card's bars.
// A NON-canonical row (any card switched off in reportOptions.kpiCards) falls back to
// kpiRowGeom, which repacks and re-centres as before.
const KPI_REF_W = 1.639;
const KPI_REF_X = [11.179, 9.400, 7.587, 5.774, 3.995, 0.000];

function buildExecFunnel(m) {
  const L = labelOf(m);
  const V = valueOf(m);
  const b = m.kpi.buckets;
  const f = m.kpi.funnel;
  const d = m.kpi.deltas || {};
  const isOv = (k) => Number.isFinite(m.overrides?.[k]);

  // Displayed late/awaiting values (overrides win). The late-% sublabel is recomputed
  // from the DISPLAYED numbers when either input was overridden (guard div-by-zero),
  // else the engine's precomputed b.latePct is used verbatim (byte-stable default).
  const vLate = V('lateNoResult', b.lateNoResult);
  const vAwait = V('awaitingResults', b.awaitingResults);
  const latePctShown = (isOv('lateNoResult') || isOv('awaitingResults'))
    ? (vAwait > 0 ? Math.round((vLate / vAwait) * 1000) / 10 : 0)
    : b.latePct;

  // Total-card window: first→last month WITH orders (Arabic names), tracking the data
  // instead of a pinned 'يناير – يوليو'. Empty when no month has orders.
  const monthsWithOrders = (m.kpi.monthly || []).filter((x) => x.orders > 0);
  const dataWindow = monthsWithOrders.length
    ? `${arMonthLabel(monthsWithOrders[0].month)} – ${arMonthLabel(monthsWithOrders[monthsWithOrders.length - 1].month)}`
    : '';

  // -- ZONE A: KPI cards in one row, right-to-left (total rightmost). Card defs in RTL
  // logical order (index 0 = rightmost). ORDER AND MEMBERSHIP ARE THE 20-07 REFERENCE
  // DECK's (user decision 2026-07-26): إجمالي · في انتظار شحن العينة · فحوصات شُحنت ولم
  // تُستلم · فحوصات تحت الإجراء · فحوصات مكتملة · الطلبات المتأخرة — SIX cards. النتائج
  // المرفوضة was dropped from this row by the user (it stays in the per-lab compliance
  // table's مرفوضة column, which is untouched); kpiRejected stays in the label registries.
  // الطلبات المتأخرة is last and, in the reference, dragged flush to the left edge with a
  // red bar on its top and bottom edge — see KPI_REF_X and kpiCard's `emph`.
  // dk = the delta/override/kpiCards key. A card renders unless kpiCards[dk] === false;
  // its value is the manual override (if finite) else the computed metric, and its green
  // "+N" chip is suppressed when that value was overridden.
  const cardDefs = [
    { v: V('total', m.kpi.totals.total),                vc: C.blue,           lab: L('kpiTotal'),            sub: dataWindow,                 ac: C.blue,           dk: 'total' },
    // sub is ONE line on purpose: 'من المستشفى قبل الـ Dispatch' wrapped to two and its
    // ink crossed the (already two-line) label inside this 1.479in card.
    { v: V('awaitingDispatch', b.awaitingDispatch),     vc: C.greenSoft,      lab: L('kpiAwaitingDispatch'),  sub: 'قبل الـ Dispatch',         ac: C.greenSoft,      dk: 'awaitingDispatch' },
    { v: V('shippedNotReceived', b.shippedNotReceived), vc: C.redSoft,        lab: L('kpiShipped'),           sub: '',                         ac: C.redSoft,        dk: 'shippedNotReceived' },
    // CARD_DEEP_BLUE, not C.amber: the user recoloured this card in the reference deck.
    { v: vAwait,                                        vc: CARD_DEEP_BLUE,   lab: L('kpiAwaitingResults'),   sub: 'بعد الـ Dispatch',         ac: CARD_DEEP_BLUE,   dk: 'awaitingResults' },
    // sub 'تشمل المرفوضة' (added 2026-07-28): buckets.completed now counts a rejected
    // line as completed (rejection is the lab's terminal outcome), and this row has no
    // النتائج المرفوضة card any more, so the sublabel is the only place that can say so.
    // Measured 0.900in at 9.5pt Cairo in the card's 1.479in sublabel box (1.279in usable
    // after pptxgenjs' margins) — one line, +0.379in of slack.
    { v: V('completed', b.completed),                   vc: C.green,          lab: L('kpiCompleted'),         sub: 'تشمل المرفوضة',            ac: C.green,          dk: 'completed' },
    { v: vLate,                                         vc: C.redPure,        lab: L('kpiLate'),              sub: `تمثل ${latePctShown}% من الطلبات`, ac: C.redPure, dk: 'lateNoResult', emph: true },
  ];
  const visible = cardDefs.filter((c) => m.reportOptions?.kpiCards?.[c.dk] !== false);
  // Canonical row (nothing switched off) => the reference's own pinned boxes; otherwise
  // fall back to the computed repacking layout. See KPI_REF_X.
  const refRow = visible.length === KPI_REF_X.length;
  const { cardW, xOf } = refRow
    ? { cardW: KPI_REF_W, xOf: (i) => KPI_REF_X[i] }
    : kpiRowGeom(visible.length);
  // ALL delta chips are green now (user decision 2026-07-23) — the old BAD_DELTA
  // red-chip branch was removed. fmtDelta yields '+N' on a rise and NOTHING for a
  // 0/negative/missing delta (positive-only since 2026-08-10 — see fmtDelta). An
  // overridden card value suppresses its chip: a hand-typed number is not the result of
  // the window's activity, so no count of that activity belongs beside it.
  const kpiEls = visible.flatMap((c, i) => kpiCard({
    x: xOf(i), w: cardW, v: String(c.v), vc: c.vc, lab: c.lab, sub: c.sub, ac: c.ac,
    delta: isOv(c.dk) ? undefined : fmtDelta(d[c.dk]), emph: c.emph,
  }));

  // -- ZONE B: order-journey funnel (from old buildJourney; X unchanged, Y +0.40).
  // Each stage value is the manual override (if finite) else the funnel count; the
  // "+N" flow chip is suppressed when that stage value was overridden.
  const created = V('funnel.created', f.created);
  const maxV = created;
  const rows = [
    { stage: '1. إنشاء طلب', val: created,                          desc: 'الطلب أُنشئ في مسبار',              color: C.navy,        key: 'total',     ov: 'funnel.created' },
    { stage: '2. سحب العينة', val: V('funnel.collected', f.collected),  desc: 'العينة مُجمَّعة',                  color: C.blue,        key: 'collected', ov: 'funnel.collected' },
    { stage: '3. شحن العينة', val: V('funnel.dispatched', f.dispatched), desc: 'العينة شُحنت من قبل المستشفى',      color: C.amber,       key: 'dispatched', ov: 'funnel.dispatched' },
    { stage: '4. إستلام العينة', val: V('funnel.received', f.received),  desc: 'حالة إستلام العينة بقبولها او رفضها', color: C.greenSoft,  key: 'received',  ov: 'funnel.received' },
    // FINAL STAGE = COMPLETED. engine.js buildFunnel publishes `completed` and keeps
    // `resulted` as an ALIAS carrying the same number, so the long-lived 'funnel.resulted'
    // override key still works and this stage can never print a figure different from the
    // exec 'فحوصات مكتملة' card. f.completed is preferred and f.resulted is the fallback
    // for an older engine build. The desc says 'أو رفضها' because a rejection is a
    // terminal outcome and is counted here (user decision 2026-07-28).
    { stage: '5. إصدار نتيجة', val: V('funnel.resulted', f.completed ?? f.resulted), desc: 'نتيجة تحليل العينة أو رفضها', color: C.greenBright, key: 'completed', ov: 'funnel.resulted' },
  ];
  const rowY = [3.226, 3.876, 4.526, 5.176, 5.862];
  const accentY = [3.276, 3.926, 4.576, 5.226, 5.912];
  const barY = [3.297, 3.947, 4.597, 5.247, 5.932];
  const trackX = 3.92, trackW = 5.0, barH = 0.3;

  // A green "+N" chip is shown this run when a visible KPI card OR an intermediate
  // funnel stage has a positive, non-overridden delta. Drives the legend (Fix 3).
  // "Positive" needs no test of its own here: fmtDelta is positive-only, so `!== undefined`
  // IS the positivity test, and the legend can never announce a window whose chips all
  // turned out to be hidden zeros/drops.
  const anyChip = visible.some((c) => !isOv(c.dk) && fmtDelta(d[c.dk]) !== undefined)
    || rows.some((r) => !KPI_DELTA_KEYS.has(r.key) && !isOv(r.ov) && fmtDelta(d[r.key]) !== undefined);

  // Cancelled note — displayed count is override-aware. Geometry/size are the 20-07
  // reference deck's: (10.542, 2.55, 2.271, 0.32) at 11pt (its shape survives there with
  // endParaRPr sz="1100" even though the visible run was hand-deleted). The
  // '(منها N قبل أبريل)' historical breakdown is NOT appended any more — the reference
  // note is just '* N طلب ملغي'. execCancelledHistPre/Post stay in both registries as
  // harmless orphans, exactly like execPartition.
  const vCancelled = V('cancelledNote', m.kpi.cancelledNote);
  const cancelledText = `* ${vCancelled} ${L('execCancelledLabel')}`;

  const els = [
    ...chrome(L('titleExec')),
    ...kpiEls,
    text(10.542, 2.55, 2.271, 0.32, cancelledText, 11, { bold: true, color: C.slate600, align: 'right', valign: 'middle', rtl: true }),
    // NOTE: neither the KPI-row partition footnote (execPartition) nor the overall
    // completion-rate line (execCompletionRate) is rendered — user decision 2026-07-26
    // restored the 20-07 reference deck, which has no shape at (0.5, 2.55) and carries no
    // add-up equation notes. Both label keys stay in the registries for parity.
    // Funnel column labels
    text(9.05, 2.906, 3.0, 0.3, L('funnelStage'), 10, { bold: true, color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
    text(8.629, 2.906, 1.0, 0.3, L('funnelCount'), 10, { bold: true, color: C.slate500, align: 'center', valign: 'middle', rtl: true }),
    text(0.05, 2.906, 2.9, 0.3, L('funnelDesc'), 10, { bold: true, color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
    // The ownership brackets used to be built HERE, as two bare spines at x 12.03 with
    // hard-coded Arabic labels. They are now a proper ⊐ built AFTER the rows loop —
    // see the block below it for why the order matters.
  ];
  // THE BARS CARRY NO TEXT (user decision 2026-08-04). The stage count has always sat
  // outside the track in its own column (x 8.629, w 1.0); the DELTA chip used to be drawn
  // INSIDE the bar at x 7.75, i.e. on top of the right-anchored coloured fill — deltaGreen
  // (#2E7D32) on navy/blue/amber is unreadable, and only stages 2/3/4 ever render a chip
  // (KPI_DELTA_KEYS suppresses 1 and 5), so the offence was intermittent as well.
  // Both numbers now STACK in the count column: the count occupies the upper 0.30in of the
  // row (valign bottom, so it keeps sitting on the bar's optical centre) and the chip goes
  // directly beneath it at rowY+0.40, 9pt.
  // THE 0.40 IS MEASURED, NOT CHOSEN, and it SURVIVES the 2026-08-10 resize UNCHANGED.
  // A row's pitch is 0.65in (0.686 on the last step) and the two LINE BOXES nearly fill it:
  // self-hosted Cairo gives the 14pt count a 0.365in line box, and the chip's scales with
  // its size at ≈0.0258in/pt (the measured 9.5pt box was 0.245in), so the 9pt chip's is
  // ≈0.235in. That is 0.600in of the 0.650in pitch — 0.050in of total slack to divide
  // between the two gaps, up from the 0.040in the 9.5pt chip left.
  // With valign bottom the count's line box ends 0.068in below its box (flex-end +
  // half-leading), so it runs rowY+0.003 → rowY+0.368. The chip is valign middle in a
  // 0.22in box at rowY+0.40, so its 0.235in line box centres on rowY+0.51 and runs
  // rowY+0.393 → rowY+0.628 (it now starts ≈0.008in above its box, where the taller
  // 9.5pt box started 0.015in above). The NEXT row's count starts at rowY+0.653.
  // BOTH GAPS GREW AND BOTH STAY POSITIVE: count→chip 0.0195 → 0.025in, chip→next-count
  // 0.0225 → 0.025in; the last step's 0.686 pitch makes its lower gap wider still. The
  // 0.40 offset is therefore kept as-is — shrinking the chip buys clearance, it does not
  // need to be spent on repositioning. A browser Range probe over the whole slide reported
  // zero overlapping pairs at 9.5pt (the old 0.33 offset reported three, one per chip), and
  // every gap here is strictly larger than the ones it passed with. Glyph ink is a good deal
  // smaller than these line boxes, so the visual gap is wider than the numbers suggest.
  // WHY 9 AND NOT 9.5: the user's round-4 rule is that a chip reads at 55-65% of the number
  // it annotates. 9/14 = 64.3% (9.5 was 67.9%, over the bar); the KPI chip sits at 58.8%.
  // The column's x-range (8.629→9.629) formally overlaps the track's right edge (…→8.92),
  // but both strings are CENTRE-aligned in the 1.0in box, so their ink starts at ≈8.97 —
  // clear of the fill, as the count already was before this change (probe: zero text ink
  // anywhere inside the track rectangle).
  rows.forEach((r, i) => {
    const fillW = Math.round((r.val / (maxV || 1)) * trackW * 1000) / 1000;
    els.push(
      rect(11.97, accentY[i], 0.06, 0.45, r.color),
      text(9.05, rowY[i], 2.85, 0.55, r.stage, 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
      text(8.629, rowY[i], 1.0, 0.30, String(r.val), 14, { bold: true, color: r.color, align: 'center', valign: 'bottom' }),
      text(0.05, rowY[i], 2.9, 0.55, r.desc, 10, { color: C.slate500, align: 'right', valign: 'middle', rtl: true }),
      rect(trackX, barY[i], trackW, barH, C.bgLighter, { radius: 0.03 }),
      rect(trackX + trackW - fillW, barY[i], fillW, barH, r.color, { radius: 0.03 }),
    );
    // Stage delta chip — de-duplicated: endpoint metrics (total/completed) are shown
    // on their KPI cards, so the funnel only surfaces intermediate flow deltas; and an
    // overridden stage value suppresses its chip. Positive-only, like every other chip
    // (fmtDelta): stages 2/3/4 count in-window flow EVENTS, so the only ways to reach
    // here with a non-positive number are a quiet window or backdated rows — neither is
    // something to print '−N' about under a cumulative stage count.
    const stageDelta = (KPI_DELTA_KEYS.has(r.key) || isOv(r.ov)) ? undefined : fmtDelta(d[r.key]);
    if (stageDelta) {
      els.push(text(8.629, rowY[i] + 0.40, 1.0, 0.22, stageDelta, 9, { bold: true, color: C.deltaGreen, align: 'center', valign: 'middle' }));
    }
  });
  // -- OWNERSHIP BRACKETS — who owns which half of the journey (user picture, round 4).
  // Stages 1-3 (إنشاء · سحب · شحن) are the HOSPITAL's, stages 4-5 (إستلام · إصدار نتيجة)
  // the LABS'. The shape is a ⊐ per the user's reference picture, drawn OUTSIDE the stage
  // accent bars (x 11.97, w 0.06 → right edge 12.03) on the right margin:
  //   • two horizontal STUBS leaving the accent bars at 12.03 and running 0.25in right,
  //   • a vertical SPINE at 12.28 joining their far ends,
  //   • the group LABEL right of the spine at 12.32, centred on the group's own span.
  // Every y here is derived from the accent bars, not chosen: a bar is accentY[i] high
  // 0.45, so its vertical CENTRE is accentY[i]+0.225 = [3.501, 4.151, 4.801, 5.451, 6.137].
  // The stubs sit on the first and last centre of their group and the spine spans centre
  // to centre; the ±0.010 in every y/h is half the 0.02in thickness, so the drawn edges —
  // not the drawn centres — line up with the bar centres. The hospital label's box
  // (12.32, 3.876, h 0.55) centres on 4.151, the MIDDLE stage's bar; the labs label's
  // (12.32, 5.519, h 0.55) centres on 5.794, the midpoint of 5.451 and 6.137.
  //
  // AFTER THE LOOP, DELIBERATELY — two independent reasons, do not fold this back into
  // the `els` literal above:
  //   1. Z-ORDER. Both renderers paint in array order, so the block that comes later wins.
  //      The old brackets were built BEFORE the loop, which put the accent bars on top of
  //      them, and the old spine's left edge (12.03) sat exactly ON the bars' right edge —
  //      a seam that a later, over-painting bar can eat once the coordinates are rounded
  //      to EMU or to device pixels. These stubs START at that very edge on purpose (the
  //      join IS the picture), so they must be the ones drawn last.
  //   2. TEXT ADJACENCY. test/compliance-completed.test.mjs walks the slide's text elements
  //      in order and asserts execTexts[iStage + 1] is stage 5's count — the stage label and
  //      its value must stay neighbours. Anything text-bearing inserted INSIDE the loop
  //      breaks that; appended after it, these two labels are harmless.
  // FILLED RECTS ONLY — no `line:` and no `radius:`. A hairline stroke is specified in
  // POINTS by pptxgenjs and in PIXELS by the HTML/PDF path, so a 0.02in rule drawn as a
  // border lands at two different widths in the two renderers, and a radius on a 0.02in
  // rect would round it away to nothing. A filled rect is inches in both paths — the only
  // shape here whose drawn size is the same in the PPTX and in the HTML/PDF preview.
  els.push(
    // Hospital — stages 1-3, spanning bar centres 3.501 → 4.801.
    rect(12.28, 3.491, 0.02, 1.32, C.slate600),
    rect(12.03, 3.491, 0.25, 0.02, C.slate600),
    rect(12.03, 4.791, 0.25, 0.02, C.slate600),
    text(12.32, 3.876, 1.0, 0.55, L('funnelGroupHospital'), 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
    // Labs — stages 4-5, spanning bar centres 5.451 → 6.137 (the last pitch is 0.686,
    // not 0.650, so this spine is 0.706 tall against the hospital's 1.320).
    rect(12.28, 5.441, 0.02, 0.706, C.slate600),
    rect(12.03, 5.441, 0.25, 0.02, C.slate600),
    rect(12.03, 6.127, 0.25, 0.02, C.slate600),
    text(12.32, 5.519, 1.0, 0.55, L('funnelGroupLabs'), 12, { bold: true, color: C.slate900, align: 'right', valign: 'middle', rtl: true }),
  );
  // Delta-chip legend — only when at least one green "+N" chip is visible this run.
  if (anyChip) {
    els.push(text(0.5, 0.72, 6.0, 0.18, deltaLegendText(L, m.deltaWindow), 8.5, { color: C.deltaGreen, align: 'left', valign: 'middle', rtl: true }));
  }
  return { id: 'execFunnel', bg: C.white, elements: els };
}

// ============================================================================
// Slide 3 — Monthly orders & results
// ============================================================================
function buildMonthly(m) {
  const L = labelOf(m);
  const V = valueOf(m);
  const mo = m.kpi.monthly;
  const bg = C.bgLight;
  // Month list derived from the data — drives the table headers AND both chart
  // category lists so labels/series follow m.kpi.monthly, not a fixed Jan–Jul.
  const monthKeys = mo.map((x) => x.month);
  const monthLabels = monthKeys.map(arMonthLabel);
  // Totals column computed from the rows (guard divide-by-zero on completion).
  const oTot = mo.reduce((s, x) => s + x.orders, 0);
  const rTot = mo.reduce((s, x) => s + x.results, 0);
  // Third metric = `incomplete` (orders − results), which is what the 20-07 reference
  // deck shows in BOTH the table and the bar chart (chart1.xml, pristine app output:
  // 295−59=236, 410−383=27, 106−77=29). The النتائج المرفوضة row was removed with it
  // (user decision 2026-07-26 — the reference table is header + 4 rows), so the visible
  // partition is once again orders = results + incomplete, which adds up on the page.
  // SINCE 2026-07-28 that partition is also the engine's ONLY one: `results` is the
  // COMPLETED count (result date OR rejected) and `pending` === `incomplete` === orders −
  // results, because rejected moved inside results. So this row now carries the same
  // number as the exec 'فحوصات مكتملة' card and the compliance completed column when
  // summed over the months, and `incomplete` no longer double-counts the rejected lines.
  // The per-month rejected value is still published by the engine as a SUBSET of results;
  // this slide deliberately does not render it (adding it to a row would double-count).
  // monthlyRowRejected stays in both registries.
  const iTot = mo.reduce((s, x) => s + x.incomplete, 0);
  const cPct = oTot > 0 ? Math.round((rTot / oTot) * 1000) / 10 : null; // round1(results/orders*100)
  const cTot = pctMonthly(cPct);
  // logical (deck) order: [label, months…, total]; reverse -> visual L->R
  const header = rev(['المؤشر', ...monthLabels, { text: 'الإجمالي', fill: C.navyDark }]);
  const rowOrders = rev([{ text: L('monthlyRowOrders'), align: 'right' }, ...mo.map((x) => String(x.orders)), { text: String(oTot), fill: bg, bold: true }]);
  const rowResults = rev([{ text: L('monthlyRowResults'), align: 'right' }, ...mo.map((x) => String(x.results)), { text: String(rTot), fill: bg, bold: true }]);
  const rowIncomplete = rev([{ text: L('monthlyRowIncomplete'), align: 'right' }, ...mo.map((x) => String(x.incomplete)), { text: String(iTot), fill: bg, bold: true }]);
  const rowCompletion = rev([{ text: L('monthlyRowCompletion'), align: 'right' }, ...mo.map((x) => pctMonthly(x.completionPct)), { text: cTot, fill: bg, bold: true }]);

  // Column widths: label + N month cols + total over the fixed table width. The
  // canonical 7-month deck keeps its original per-column widths verbatim
  // (pixel-identical); any other count spreads the middle span evenly.
  const MONTH_COLW = [0.623, 0.623, 0.623, 0.561, 0.686, 0.679, 0.679]; // deck OOXML, 7 months
  const LABEL_COLW = 1.312, TOTAL_COLW = 0.874, TABLE_W = 6.661;
  const monthColW = mo.length === MONTH_COLW.length
    ? MONTH_COLW
    : Array(mo.length).fill(Math.round(((TABLE_W - LABEL_COLW - TOTAL_COLW) / mo.length) * 1000) / 1000);

  // TURNAROUND BLOCK — OPT-IN (see OPT_IN_CARDS): the line chart + the navy
  // overall-average card render only when reportOptions.kpiCards.turnaround === true.
  // Default OFF, so the delivered monthly slide is the 20-07 reference shape.
  const showTurnaround = cardOn(m)('turnaround');
  // GEOMETRY, two layouts:
  //  · turnaround ON  — the historic split band: table+bar chart in the upper band
  //    (y≈1.07), line chart + card in the lower band (y 4.583 → 6.972). Byte-identical
  //    to what shipped before the toggle existed, so opting in changes nothing else.
  //  · turnaround OFF — the 20-07 REFERENCE DECK's own placement: table and chart share
  //    ONE top edge at y≈2.194/2.195 (reference graphicFrame offsets, EMU→in). They are
  //    NOT centred independently — centring each on its own height staggered their tops
  //    by 0.33in (table 2.642, chart 2.310), which is the visible mismatch the reference
  //    does not have. Chart 6.0×3.4 → bottom 5.595; table 5×0.456 → bottom 4.474.
  //    The two reference offsets differ by 0.001in (2.194 vs 2.195) — that is the
  //    reference's own rounding, kept verbatim rather than averaged.
  const CHART_H = 3.4;
  const tableY = showTurnaround ? 1.069 : 2.194;     // reference table frame y
  const chartY = showTurnaround ? 1.07 : 2.195;      // reference chart frame y

  const ROW_H = 0.456;
  const table = {
    t: 'table', x: 6.604, y: tableY, w: TABLE_W, rtl: true, rowH: ROW_H,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev([LABEL_COLW, ...monthColW, TOTAL_COLW]),
    rows: [header, rowOrders, rowResults, rowIncomplete, rowCompletion],
  };
  // Partition footnote, anchored 0.08in under the table's COMPUTED bottom so it follows
  // both layouts instead of a constant: turnaround OFF → 2.194 + 5×0.456 = 4.474 (the
  // chart beside it ends at 5.595, and it owns x 0.5–6.5, so the band is free); ON →
  // 1.069 + 2.28 = 3.349, well clear of the line chart's y 4.583. Same x/width as the
  // table, right-aligned, so it reads as that table's note.
  const partitionNote = text(6.604, tableY + 5 * ROW_H + 0.08, TABLE_W, 0.22,
    L('monthlyPartition'), 9, { color: C.slate500, align: 'right', valign: 'top', rtl: true });

  // CATEGORY DIRECTION IS RIGHT-TO-LEFT — oldest month at the RIGHT, newest at the LEFT,
  // so the time axis reads in Arabic order alongside the RTL table beside it. This is the
  // ONE attribute where the 20-07 reference deck is deliberately NOT followed: its chart
  // part (chart1.xml c:cat strCache idx 0..6 = يناير…يوليو) reads LEFT-to-right, but the
  // reference predates the user's later, explicit instruction ("bar chart to be from right
  // to left"), so that instruction overrides the reference here. Categories AND every
  // series' values are reversed in lockstep — reversing only one would relabel the bars.
  // Same treatment on the opt-in turnaround line chart below.
  //
  // HOW THE RTL IS PRODUCED — read this before touching the arrays. The RENDERERS are
  // now RTL-native: charts-svg.js maps category index 0 to the RIGHTMOST band (CAT_DIR)
  // and pptx-renderer.js emits catAxisOrientation 'maxMin', PowerPoint's own reversed
  // category axis. So the spec must hand over categories in NATURAL chronological order
  // (يناير…يوليو) and let the renderer place index 0 on the right. Reversing here as well
  // double-reversed it: the chart came out newest-at-right while the table beside it reads
  // oldest-at-right. Direction is the renderers' single knob (opts.catDir escapes it).
  const monthLabelsRtl = monthLabels;
  const monthlyChart = {
    t: 'chart', kind: 'colClustered', x: 0.5, y: chartY, w: 6.0, h: CHART_H,
    categories: monthLabelsRtl,
    series: [
      { name: L('chartMonthlyOrders'), values: mo.map((x) => x.orders), color: CHART_BLUE },
      { name: L('chartMonthlyResults'), values: mo.map((x) => x.results), color: C.greenBright },
      { name: L('chartMonthlyIncomplete'), values: mo.map((x) => x.incomplete), color: CHART_GRAY },
    ],
    opts: { dataLabels: true, legend: 'bottom' },
  };

  const t = m.kpi.turnaround;
  // Key both series by month over the SAME derived month list as the categories,
  // so a month absent from perMonth becomes a null gap in place (rather than
  // shifting the later months' points left and misaligning the line).
  // RIGHT-TO-LEFT, same as monthlyChart (see its note) — oldest month at the RIGHT.
  const turnaroundChart = {
    t: 'chart', kind: 'line', x: 4.139, y: 4.583, w: 9.139, h: 2.389,
    categories: monthLabelsRtl,
    series: [
      { name: L('chartActual'), values: monthKeys.map((k) => t.perMonth.find((p) => p.month === k)?.actual ?? null), color: C.navyChart, marker: 'circle' },
      { name: L('chartExpected'), values: monthKeys.map((k) => t.perMonth.find((p) => p.month === k)?.expected ?? null), color: C.orangeSeries, dash: true, marker: 'diamond' },
    ],
    opts: { legend: 'bottom', title: L('chartDaysAxis'), valMin: 0 },
  };

  // Overall-average card values honor the turnaround.actual/expected overrides.
  const ovActual = V('turnaround.actual', t.overallActual);
  const ovExpected = V('turnaround.expected', t.overallExpected);

  const els = [
    ...chrome(L('titleMonthly')),
    table,
    // The partition footnote is rendered again (2026-07-28). It was dropped on 2026-07-26
    // with the other add-up equation notes (simpler 20-07 deck shape) — but that was while
    // every row on this slide still meant what its last-week counterpart meant. The
    // completed rule (result date OR rejected) silently moved نسبة الاكتمال by up to 13.3
    // points per month, and this is the only element on the slide that can say so. It is
    // ONE 9pt slate line under the table, not a restored equation band.
    partitionNote,
    monthlyChart,
  ];
  if (showTurnaround) {
    els.push(
      turnaroundChart,
      // Overall-average card — RESTACKED so 3-digit live values never touch: title,
      // actual, expected, variance and sample size each get their own band inside the
      // card (4.583 → 6.972). Actual/expected dropped to 20pt to keep the stack clear.
      rect(0.5, 4.583, 3.417, 2.389, C.navyChart, { radius: 0.1 }),
      text(0.5, 4.66, 3.417, 0.3, L('overallAvgTitle'), 13, { bold: true, color: CARD_TITLE, align: 'center', valign: 'middle', rtl: true }),
      text(0.5, 5.0, 3.417, 0.5, `الفعلي: ${ovActual.toFixed(1)} يوم`, 20, { bold: true, color: C.white, align: 'center', valign: 'middle', rtl: true }),
      text(0.5, 5.55, 3.417, 0.5, `المتوقع: ${ovExpected.toFixed(1)} يوم`, 20, { bold: true, color: C.peach, align: 'center', valign: 'middle', rtl: true }),
    );
    // Variance vs target — actual − expected, sign always shown; only when both present.
    if (Number.isFinite(ovActual) && Number.isFinite(ovExpected)) {
      const diff = ovActual - ovExpected;
      const diffStr = (diff >= 0 ? '+' : '-') + Math.abs(diff).toFixed(1);
      els.push(text(0.5, 6.15, 3.417, 0.3, `الفارق: ${diffStr} يوم عن المستهدف`, 11, { bold: true, color: C.amber, align: 'center', valign: 'middle', rtl: true }));
    }
    // Sample size behind the averages — only when the engine reports measuredCount.
    if (Number.isFinite(t.measuredCount)) {
      els.push(text(0.5, 6.5, 3.417, 0.26, `(ن = ${t.measuredCount} طلب)`, 9, { color: CARD_TITLE, align: 'center', valign: 'middle', rtl: true }));
    }
  }
  return { id: 'monthly', bg: C.white, elements: els };
}

// ============================================================================
// Slide 4 — Compliance measure / late orders
// ============================================================================
// TABLE-ONLY slide (user decision 2026-07-23): the late/on-time detail chart, its band
// divider + heading, and the catalog/overflow notes were removed; the by-lab table now
// grows into the freed space. (The chartLateSeries/chartOnTimeSeries/catalogNote labels
// stay in the registries for parity — harmless orphans.)
// SIMPLIFIED back to the 20-07 reference deck (user decision 2026-07-26): the '#' index
// column restored, and the قبل الاستلام / ملتزمة / صدرت متأخرة columns removed (their
// label keys survive in the registries). فحوصات مكتملة was added back on 2026-07-27, so
// the table is EIGHT columns; the partition footnote is rendered again (see els below).
function buildCompliance(m) {
  const L = labelOf(m);
  const lab = m.kpi.byLab;
  // Logical (deck RTL, right→left reading) order per row:
  //   [#, lab, total, completed, awaitingResult, rejected, late, latePct]
  // rev() -> visual L→R. Every column total is computed from the rows (no hardcoded
  // literals); latePct total = lateTot/awaitTot (round1, guard div-by-zero).
  const totalTot = lab.reduce((s, r) => s + (r.total || 0), 0);
  const awaitTot = lab.reduce((s, r) => s + (r.awaitingResult || 0), 0);
  const lateTot = lab.reduce((s, r) => s + (r.late || 0), 0);
  const rejTot = lab.reduce((s, r) => s + (r.rejected || 0), 0);
  const latePctTot = awaitTot > 0 ? Math.round((lateTot / awaitTot) * 1000) / 10 : 0;

  // NO conditional body-cell emphasis. The 20-07 reference deck prints EVERY body cell
  // in #1E293B, non-bold — including late=80, 100.0% and 55.6%, i.e. values the
  // red/bold rules would have flagged. Restored to that (user decision 2026-07-26).
  // TWO SUBSET COLUMNS, both carrying the deck's '↳ منها' prefix (see compRejected /
  // compLate / defMLate) so neither reads as another addend:
  //   مرفوضة  ⊂ فحوصات مكتملة        (counted inside it since 2026-07-28)
  //   متأخرة  ⊂ طلبات مستلمة بانتظار نتيجة (late = LATE && no result ⇒ received, not rejected)
  // compRejected ALSO gets a lighter header fill (C.taskNavy #2F5597 against the row's
  // C.navy #1E3A8A). compLate does NOT, and that asymmetry is not a statement about the
  // two metrics: the fill assertion in test/compliance-completed.test.mjs pins every
  // other header cell to no per-cell fill, and this file may not edit that test —
  // cross-file, deferred. Both columns are named as subsets in the compPartition
  // footnote, which is what actually carries the meaning; the fill is decoration.
  const header = rev([
    L('compHash'), L('compLab'), L('compTotal'), L('compCompleted'), L('compAwaiting'),
    { text: L('compRejected'), fill: C.taskNavy }, L('compLate'), L('compLatePct'),
  ]);
  // Completed per lab = engine byLab `completed` — the headline partition term
  // (total = pipeline + awaitingResult + completed) and, since the user decision
  // 2026-07-28 "consider rejected as completed test", the count of lines that reached a
  // TERMINAL lab outcome: a result date OR a rejection (engine.js isCompleted()). It is
  // the same field the exec 'فحوصات مكتملة' card, the funnel's last stage and the monthly
  // completed row all resolve to, so the four surfaces cannot disagree.
  // FALLBACK (resulted + rejected) covers an older engine build that predates the
  // explicit `completed` field; it is the same number by definition.
  const completedOf = (r) => (r.completed != null
    ? r.completed
    : (r.resulted != null ? r.resulted : (r.onTime || 0) + (r.resultedLate || 0)) + (r.rejected || 0));
  const completedTot = lab.reduce((s, r) => s + completedOf(r), 0);
  const completedCell = (n) => (n > 0 ? { text: String(n), color: C.green, bold: true } : String(n || 0));
  // LATE COLUMNS IN LIGHT RED (user request 2026-08-04: "the late numbers in light red").
  // Applies to BOTH late columns — '↳ منها متأخرة' and 'نسبة الطلبات المتأخرة' — and to
  // their totals-row cells, so the reader's eye lands on the same metric in both places.
  // C.redSoft (#F87171) is the light tone the user asked for; on the white/bgLighter rows
  // it measures ≈2.6:1 against #FFFFFF, under the 4.5:1 body-text bar, so every one of
  // these cells is BOLD — the extra stroke weight is what keeps them legible at 10pt
  // (and it is the same pairing the completed column already uses with C.green).
  // These are BODY cells only. The HEADER row is untouched on purpose:
  // test/compliance-completed.test.mjs:95-97 asserts that every header cell except
  // compRejected carries NO per-cell fill, and this file may not edit that test. Styled
  // body cells are safe — the test's cellText() unwraps { text, … } objects.
  const lateCell = (s) => ({ text: s, color: C.redSoft, bold: true });
  const labRows = lab.map((r, i) => rev([
    String(i + 1),
    { text: r.lab, align: 'right' },
    String(r.total),
    completedCell(completedOf(r)),
    String(r.awaitingResult),
    String(r.rejected || 0),
    lateCell(String(r.late)),
    lateCell(pctLab(r.latePct)),
  ]));
  // Totals row — '#' cell left blank (as in the reference deck), 'المجموع' in the lab column.
  const totalRow = rev([
    { text: '', bold: true, fill: C.bgLighter },
    { text: 'المجموع', bold: true, fill: C.bgLighter, align: 'right' },
    { text: String(totalTot), bold: true, fill: C.bgLighter },
    { text: String(completedTot), bold: true, fill: C.bgLighter, ...(completedTot > 0 ? { color: C.green } : {}) },
    { text: String(awaitTot), bold: true, fill: C.bgLighter },
    { text: String(rejTot), bold: true, fill: C.bgLighter },
    // Totals row keeps the light-red treatment of the two late columns (see lateCell).
    { text: String(lateTot), bold: true, fill: C.bgLighter, color: C.redSoft },
    { text: pctLab(latePctTot), bold: true, fill: C.bgLighter, color: C.redSoft },
  ]);

  // colW: the 20-07 REFERENCE DECK's own gridCol widths, EMU→inches (÷914400), in logical
  // (RTL right→left) order. Equal numeric columns are NOT usable here: pptxgenjs applies its
  // default cell margin [.05,.1,.05,.1] in INCHES (vendor/pptxgen.bundle.js Z) and
  // render/pptx-renderer.js addTable passes no `margin`, so a column offers colW−0.2in of
  // text width. 'طلبات مستلمة بانتظار نتيجة' measures 146.8px = 1.529in in Cairo 9pt bold
  // (163.1px = 1.699in at 10pt) — an equal 1.633in column leaves only 1.433in, so PowerPoint
  // wrapped the header to two lines while the HTML/PDF preview (styles/slide.css padding
  // 2px 4px → 1.55in usable) still showed one, i.e. the operator approved a one-line header
  // and the client received a two-line one. The reference widths give that column 2.083in
  // (1.883in usable), so it fits on ONE line at the reference's 10pt in both renderers, and
  // every other header fits too (measured, Cairo 10pt bold, usable = w−0.2):
  //   # 0.556 · المختبر 2.714 (0.427; longest live lab name 2.449in at 10.5pt body)
  //   مجموع الطلبات 1.667 (0.938) · بانتظار نتيجة 2.083 (1.699) · مرفوضة 0.898 (0.519)
  //   الطلبات المتأخرة 1.596 (1.004) · نسبة الطلبات المتأخرة 2.153 (1.351)
  // Sum = 11.667 = the table width, unchanged.
  // EIGHT columns since 'فحوصات مكتملة' was added (user request 2026-07-27). The
  // reference's seven widths are re-budgeted rather than squeezed evenly: every
  // header must still fit on ONE line at 10pt bold, and a column offers only
  // colW−0.2in of text width in PPTX (pptxgenjs cell margins). Widths are taken
  // from the longest header/content each column must hold, and still total 11.667.
  //
  // RE-BUDGETED AGAIN 2026-07-28 (second pass), for two reasons:
  //  1. The 2026-07-27 eight-column budget paid for the widened '↳ منها مرفوضة' header
  //     mostly out of column [4] (بانتظار نتيجة), cutting it 2.050 → 1.950, i.e. from
  //     +0.151in of margin to +0.051in. That is the ONE column with a recorded PowerPoint
  //     wrap history (see the reference-widths note above), and the HTML/PDF preview
  //     cannot catch a regression there: html-renderer pads 2px 4px (0.083in) against
  //     pptxgenjs' 0.2in, so every column looks 0.117in roomier on screen than in the
  //     PPTX. It is restored to 2.050 exactly.
  //  2. compLate became '↳ منها متأخرة' (0.895in) instead of 'الطلبات المتأخرة' (0.996in),
  //     which frees 0.101in — that is what pays for [4] without starving anything else.
  // Every width below is measured BY RANGE in the deck's own self-hosted Cairo (the
  // assets/fonts woff2 files, headers at 10pt bold / body at 10pt regular), not estimated.
  // colW (usable = colW−0.2) — binding string → margin:
  //   #                        0.420 (0.220) — body '15'                 0.156 → +0.064
  //   المختبر                   2.612 (2.412) — lab name (see below)      2.332 → +0.080
  //   مجموع الطلبات             1.190 (0.990) — header                    0.930 → +0.060
  //   فحوصات مكتملة             1.319 (1.119) — header                    1.049 → +0.070
  //   طلبات مستلمة بانتظار نتيجة 2.050 (1.850) — header                    1.699 → +0.151
  //   ↳ منها مرفوضة             1.290 (1.090) — header                    1.000 → +0.090
  //   ↳ منها متأخرة             1.185 (0.985) — header                    0.895 → +0.090
  //   نسبة الطلبات المتأخرة      1.601 (1.401) — header                    1.334 → +0.067
  // Sum = 11.667 exactly = the table width (asserted in compliance-completed.test.mjs).
  // Tightest margin is +0.060in, up from +0.051in, and no column loses more than 0.010in
  // of margin. Both '↳' headers keep ≥ +0.090in on purpose: that glyph (U+21B3) may fall
  // back to a non-Cairo font in PowerPoint, so the subset columns carry the extra slack.
  // THE LAB-NAME BOUND: the longest name in TODAY's live data is 'king Abdullaziz Medical
  // city in Riyadh' at 2.158in (the golden fixture's longest too) — the earlier notes here
  // and above cite 'Genomics innovations Limited Company' / 'Advanced Laboratory Services
  // Company', which are NUPCO names from src/seeds/scorecard.js and have never appeared in
  // this table's data (byLab is keyed off the CSV's `facility`). They are kept as the
  // DESIGN bound anyway — they are real lab names that a future file may carry, they are
  // the widest strings in the repo for this column (2.332in and 2.331in respectively, i.e.
  // the pair is a 0.001in tie, not the clear winner the old note implied), and budgeting
  // to them costs nothing: it just means live data runs with +0.254in of real headroom.
  const COL_W = [0.420, 2.612, 1.190, 1.319, 2.050, 1.290, 1.185, 1.601];
  // POSITION AND ROW HEIGHT ARE THE 20-07 REFERENCE DECK's (user decision 2026-07-26):
  // frame y = 1959540 EMU = 2.143in, every a:tr h = 251460 EMU = 0.275in, so 9 rows span
  // 2.143 → 4.618. An earlier change pinned the table at y 1.194 and GREW rowH to 0.40 to
  // fill the band freed by deleting the late-by-test chart; the reference does neither —
  // its author moved the surviving table DOWN and left the band below it empty.
  // NO headerSize/bodySize keys: every run in the reference table is 10pt, which is
  // exactly what the renderer's `e.headerSize || 10` / `e.bodySize || 10` defaults give
  // (src/render/pptx-renderer.js). The old stepped font ladder keyed off rowH and would
  // silently drop the header to 8pt and the body to 9pt at rowH 0.275.
  // x stays 0.833 — the principled centre ((13.333 − 11.667)/2); the reference's 0.8165
  // is a 0.017in manual drag, not an authored value.
  const TABLE_Y = 2.143, ROW_H = 0.275;
  const labTable = {
    t: 'table', x: 0.833, y: TABLE_Y, w: 11.667, rtl: true, rowH: ROW_H,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev(COL_W),
    rows: [header, ...labRows, totalRow],
  };

  // Chrome + the by-lab table + ONE partition footnote. Still no chart, no band divider,
  // no catalog/overflow notes (the 20-07 reference shape). The equation note is back
  // because this table can no longer be reconciled by reading it: two of its six numeric
  // columns are SUBSETS (مرفوضة ⊂ مكتملة, متأخرة ⊂ بانتظار نتيجة) and one partition term
  // (قبل الاستلام) has no column at all, so on golden data the printed columns give
  // 437 + 159 = 596 against a printed total of 618. The footnote states the identity and
  // names each subset's parent — the ↳ markers stop the reader ADDING those columns, this
  // line is what tells them which column each one belongs to.
  // ANCHORED to the computed table bottom, not a constant: TABLE_Y + rows×ROW_H + 0.08.
  // At the usual 6–8 labs that lands at y≈4.4–4.9; it is SUPPRESSED when the table has
  // grown so tall that the note would cross the 7.05 content floor (≥15 labs), since the
  // 7.1 footer rule and the page number live just below it.
  const tableBottom = TABLE_Y + labTable.rows.length * ROW_H;
  const NOTE_H = 0.22;
  const els = [
    ...chrome(L('titleCompliance')),
    labTable,
  ];
  if (tableBottom + 0.08 + NOTE_H <= 7.05) {
    els.push(text(0.833, tableBottom + 0.08, 11.667, NOTE_H, L('compPartition'), 9,
      { color: C.slate500, align: 'right', valign: 'top', rtl: true }));
  }
  return { id: 'compliance', bg: C.white, elements: els };
}

// ============================================================================
// Slide 5 — Tasks ('المهام') — variant changes the task ROWS
// ============================================================================
// Status chip fills as the 20-07 reference build had them — 'مغلق' is C.green (#16A34A);
// the later switch to C.greenBright (#00B050) was a post-reference cosmetic change.
const STATUS_FILL = { 'مستمر': { fill: C.taskNavy, color: C.white }, 'متأخر': { fill: C.redDark, color: C.white }, 'قيد التنفيذ': { fill: C.amberStatus, color: C.black }, 'مغلق': { fill: C.green, color: C.white }, 'مفتوح': { fill: C.slate500, color: C.white } };

// Full-width tasks table. '#' is renumbered by row index (startIndex + i + 1) —
// internal rows do NOT keep their own tk.num (which restarts at 1). startIndex lets a
// continuation slide's '#' CONTINUE (e.g. 16..) instead of restarting at 1. rowH/fonts
// are parametrized.
function taskTable(tasks, { y, rowH, bodySize, headerSize, L, startIndex = 0 }) {
  // rtl=0 in deck: visual == authored order [الحالة, تاريخ, المالك, المسؤول, الإجراء, #]
  const header = [L('taskStatus'), L('taskDue'), L('taskOwner'), L('taskResponsible'), L('taskAction'), L('taskHash')];
  const rows = tasks.map((tk, i) => {
    const st = STATUS_FILL[tk.status] || { fill: C.slate500, color: C.white };
    return [
      { text: tk.status, fill: st.fill, color: st.color, bold: true },
      String(tk.dueDate),
      { text: tk.owner, align: 'right' },
      tk.responsible,
      { text: tk.task, align: 'right' },
      String(startIndex + i + 1),
    ];
  });
  return {
    t: 'table', x: 0.641, y, w: 12.259, rtl: true, rowH, bodySize, headerSize,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: [1.138, 1.471, 1.95, 1.47, 5.893, 0.337],
    rows: [header, ...rows],
  };
}

function tasksSubhead(title, y = 1.217) {
  return [
    rect(12.45, y + 0.02, 0.3, 0.3, C.navy, { radius: 0.15 }),
    text(12.45, y + 0.02, 0.3, 0.3, '⚡', 14, { bold: true, color: C.white, align: 'center', valign: 'middle' }),
    text(0.6, y, 11.8, 0.4, title, 14, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
  ];
}

// Challenges/risks geometry. Until the 2026-08-04 split these two tables shared the
// BOTTOM STRIP of the action slide — header + at most THREE body rows at rowH 0.28 from
// y 5.88 → 7.00 — because the tasks table and the support band owned everything above.
// They now have their own slide (buildChallenges), which is what pays for the raise:
// the support band ends at 2.35, the subheads sit at 3.05 and the tables run
// y 3.42 → 6.72 at rowH 0.30, i.e. header + up to TEN body rows each (3.3in of band vs
// the old 1.12in). Beyond CR_CAP rows we keep CR_CAP−1 data rows and spend the last slot
// on a '+ N أخرى' note (a separate italic text element — grammar cells can't be
// italic/spanned): a full table is header+10 rows = 6.72, a capped one is header+9 = 6.42
// plus the note's own 0.30 slot = 6.72. Either way the block bottom is 6.72, well inside
// the 7.05 content floor and clear of the footer border at 7.10.
const CR_CAP = 10;
const CR_TABLE_Y = 3.42, CR_ROW_H = 0.30;
const capCrRows = (rows) => (rows.length <= CR_CAP
  ? { rows, hidden: 0 }
  : { rows: rows.slice(0, CR_CAP - 1), hidden: rows.length - (CR_CAP - 1) });
const crNote = (x, hidden) => text(
  x, CR_TABLE_Y + CR_CAP * CR_ROW_H, 6.0, CR_ROW_H, `+ ${hidden} أخرى`, 8.5,
  { italic: true, color: C.slate600, align: 'center', valign: 'middle', rtl: true },
);

// ---- task-table pagination ---------------------------------------------------
// The internal report's task list can be long (every non-closed لين action plus the
// one-report grace row of anything newly closed), so rows past the first slide's block
// flow onto full-band continuation slides ('المهام — تتمة'); the first slide gets a small
// 'يتبع…' continuation marker instead of the old '+ N مهمة أخرى' drop note.
// CAP RAISED 15 → 18 (2026-08-04): the action slide is TASKS ONLY now, so the table owns
// the whole content band (TASKS_Y_TOP 1.15 → CONT_Y_BOT 6.95 = 5.80in) instead of the
// 3.35in strip left over above the support band. 18 body rows + the header = 19 slots at
// the 0.30 row cap = 5.70in, which fits with 0.10in to spare — a 19th row would force
// rowH below the cap. Pagination stays as the overflow safety net it always was.
const TASK_CAP = 18;                       // first-slide task rows
const CONT_CAP = 30;                       // task rows per continuation slide (~30 at min rowH 0.18)
// Two-line date RANGES (e.g. '25-06-2026\n16-07-2026') render ~38px of ink, which needs
// rowH ≈ 0.44 to clear the next row. That cap only engages at ≤12 rows/slide
// (band/13 → 0.44); a 16-row page falls to rowH 0.35 and the stacked dates collide
// (browser Range probe: 15 offenders). So two-line continuation pages carry ≤12 rows
// and spill onto further continuation slides — no truncation, no ink collision.
const CONT_CAP_TWOLINE = 12;               // task rows per continuation slide when dates wrap
const CONT_Y_TOP = 1.0, CONT_Y_BOT = 6.95; // full-band table window
const CONT_BAND = CONT_Y_BOT - CONT_Y_TOP; // 5.95in
// The FIRST tasks slide uses the same window, pushed 0.15in down to clear the
// 'المهام الحالية' subhead (a continuation slide has no subhead, hence the two constants).
const TASKS_Y_TOP = 1.15;
const TASKS_BAND = CONT_Y_BOT - TASKS_Y_TOP; // 5.80in

// One continuation slide: a full-band task table, same columns/colW as the first
// slide. rowH = clamp(0.18, band/(rows+1), cap) — cap 0.34, raised to 0.44 when any
// row carries a two-line date range (reuses the first-slide adaptive-cap logic so
// stacked date ranges don't collide). The table height = (rows+1)*rowH ≤ band, so it
// never crosses CONT_Y_BOT (6.95). '#' continues from startIndex (16, 46, …).
function buildActionCont(tasks, startIndex, contNo, L) {
  const rowCount = tasks.length;
  const hasTwoLine = tasks.some((t) =>
    Object.values(t || {}).some((v) => typeof v === 'string' && v.includes('\n')));
  const rowCap = hasTwoLine ? 0.44 : 0.34;
  const rowH = Math.max(0.18, Math.min(rowCap, CONT_BAND / (rowCount + 1)));
  const bodySize = rowH >= 0.26 ? 9.5 : rowH >= 0.21 ? 9 : 8;
  const table = taskTable(tasks, { y: CONT_Y_TOP, rowH, bodySize, headerSize: bodySize, L, startIndex });
  return { id: `action-cont-${contNo}`, bg: C.white, elements: [...chrome(L('titleActionCont')), table] };
}

// Returns an ARRAY of slides: [action, action-cont-1, …]. buildSpec flattens it so the
// continuation slides land right after the action slide and pick up sequential footers.
//
// TASKS ONLY since 2026-08-04 (user review). This builder used to stack FOUR blocks on
// one page — tasks table (y 1.15, a 3.35in strip), the الدعم المطلوب red band (y 4.62),
// and the challenges + risks tables (y 5.88, three rows each) — which is why the tasks
// were capped at 15 rows in a strip and the other two tables at three rows. The support
// band, challenges and risks moved to their own slide (buildChallenges below); the tasks
// table now owns the full content band, exactly like a continuation slide does.
function buildAction(m, variant) {
  const L = labelOf(m);
  // Tasks table. Internal report = لين-category actions; NUPCO = the remaining actions.
  const taskRows = variant === 'nupco' ? m.tasksCurrent : m.tasksInternal;
  const n = taskRows.length;
  const CAP = TASK_CAP;
  const shown = Math.min(n, CAP);
  const hasNote = n > CAP;
  // Reserve the 'يتبع…' marker slot (0.26in) out of the band up front, so the rows shrink
  // to fit and the marker still lands inside the content floor: markerY + 0.24 ≤ 6.95.
  // The band is untouched when there is no overflow, so the n ≤ CAP layout is unaffected.
  const AREA = hasNote ? TASKS_BAND - 0.26 : TASKS_BAND;
  // Two-line cells (date RANGES like '25-06-2026\n16-07-2026') need ~0.42in of
  // Cairo ink — with the default 0.30 cap adjacent rows' dates collide. Raise
  // the cap only when multi-line content exists AND the row count leaves room.
  const hasTwoLine = taskRows.slice(0, shown).some((t) =>
    Object.values(t || {}).some((v) => typeof v === 'string' && v.includes('\n')));
  const rowCap = hasTwoLine ? 0.44 : 0.30;
  const rowH = Math.max(0.18, Math.min(rowCap, AREA / (shown + 1)));
  const bodySize = rowH >= 0.26 ? 9.5 : rowH >= 0.21 ? 9 : 8;
  const headerSize = bodySize;
  const table = taskTable(taskRows.slice(0, shown), { y: TASKS_Y_TOP, rowH, bodySize, headerSize, L });

  const els = [
    ...chrome(L('titleAction')),
    ...tasksSubhead(L('subheadTasks'), 0.84),
    table,
  ];
  if (hasNote) {
    // Truncation is not acceptable for the internal report: rows CAP+1.. move to
    // continuation slides, so the first slide gets a small 'يتبع…' (continued…) marker
    // instead of the old '+ N مهمة أخرى' drop note.
    const markerY = TASKS_Y_TOP + (shown + 1) * rowH;
    els.push(text(0.641, markerY, 12.259, 0.24, 'يتبع…', bodySize, { italic: true, color: C.slate600, align: 'center', valign: 'middle', rtl: true }));
  }

  const slides = [{ id: 'action', bg: C.white, elements: els }];
  // Continuation slides for rows CAP+1..n. Page size shrinks to CONT_CAP_TWOLINE when ANY
  // continuation row carries a wrapping date range, so those taller rows never collide;
  // otherwise ~30 single-line rows per slide. '#' continues from the row's absolute
  // position (start), so it never restarts at 1.
  const rest = taskRows.slice(CAP);
  const restTwoLine = rest.some((t) =>
    Object.values(t || {}).some((v) => typeof v === 'string' && v.includes('\n')));
  const pageSize = restTwoLine ? CONT_CAP_TWOLINE : CONT_CAP;
  for (let start = CAP, contNo = 1; start < n; start += pageSize, contNo++) {
    slides.push(buildActionCont(taskRows.slice(start, start + pageSize), start, contNo, L));
  }
  return slides;
}

// ============================================================================
// Slide 6 — Challenges & risks ('التحديات والمخاطر') — NEW 2026-08-04
// ============================================================================
// The three blocks that used to share the bottom of the action slide, each given the room
// it needs: the الدعم المطلوب red band as a TOP block (y 1.0 → 2.35, up to SUP_CAP items
// instead of 3), then the challenges and risks tables side by side (right/left as before)
// from y 3.42 with CR_CAP rows each instead of three.
// NOTE ON THE SLIDE TOGGLE: the key 'challenges' is deliberately NOT in this file's
// OPT_IN_SLIDES, so buildSpec's on() helper reads an ABSENT reportOptions.slides.challenges
// flag as ON (`slides[key] !== false`). Settings/store/seed registration of the new key is
// owned elsewhere; until it lands, existing saved reportOptions (which have no such key)
// render the slide, which is the intended default.
function buildChallenges(m) {
  const L = labelOf(m);
  // Block 1 — support required, now a TOP block (was a 0.92in band squeezed at y 4.62).
  // The band must CONTAIN its ink: title + up to SUP_CAP right-aligned bullets; a further
  // item is folded into an inline '+ N أخرى' line so live data with many long bullets can
  // never overflow onto the tables below. CAP RAISED 3 → 5 with the extra height.
  // EVERY NUMBER BELOW IS MEASURED, not estimated (Range probe, 1280×720, self-hosted
  // Cairo — .sl-text CLIPS at the box, so an under-tall box silently eats a descender):
  //   · a 10.5pt line at lineSpacing 1.0 has a 0.146in pitch and 0.271in of ink, which
  //     starts 0.063in ABOVE the text box's top edge.
  //   · the 14pt title's ink runs 1.048 → 1.412 inside its (0.7, 1.06, ·, 0.34) box.
  // So the bullets start at 1.52 (ink top 1.457 — the first attempt at 1.44 put ink at
  // 1.377 and collided with the title by 0.034in, caught by the probe), and the worst
  // case — SUP_CAP bullets PLUS the '+ N أخرى' line = 6 lines — ends at 2.458, inside
  // both its text box (bottom 2.496) and the band (bottom 2.471). The subhead row below
  // starts its ink at 2.99, so even the tallest band clears it by 0.52in.
  // The band HEIGHT follows the line count instead of being pinned at the worst case: a
  // 1.50in pane holding three short bullets reads as an unfinished empty block. Line count
  // = the shown bullets + the '+ N أخرى' line when it exists (at least one, so an empty
  // supportRequired still yields a sane band rather than a sliver).
  const SUP_CAP = 5;
  const support = m.panels.supportRequired || [];
  const supShown = Math.min(support.length, SUP_CAP);
  const supLines = Math.max(1, supShown + (support.length > SUP_CAP ? 1 : 0));
  const supText = bullets(support.slice(0, SUP_CAP))
    + (support.length > SUP_CAP ? `\n+ ${support.length - SUP_CAP} أخرى` : '');
  const SUP_Y = 1.52, SUP_LINE = 0.146;
  // Band bottom = the last line's ink bottom (SUP_Y − 0.063 + 0.271 + LINE×(n−1)) plus a
  // 0.013in cushion; the text box gets 0.10in over the line stack so nothing is clipped.
  const supBandH = (SUP_Y - 1.0) + supLines * SUP_LINE + 0.075;
  const els = [
    ...chrome(L('titleChallenges')),
    rect(0.5, 1.0, 12.3, supBandH, C.bgRed, { radius: 0.06 }),
    // Title + bullet typography are the 20-07 reference deck's: title 14pt, bullets 10.5pt
    // at lineSpacing 1.0. Only the Y offsets and the box heights move with the band.
    text(0.7, 1.06, 11.9, 0.34, L('supportTitle'), 14, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
    text(0.9, SUP_Y, 11.7, supLines * SUP_LINE + 0.10, supText, 10.5, { color: C.slate900, align: 'right', valign: 'top', rtl: true, lineSpacing: 1.0 }),
  ];

  // Blocks 2 & 3 — challenges (right) + risks (left), side-by-side, subheads at y 3.05.
  const chHeader = ['الإجراء الوقائي/الحل', 'التأثير', 'المسؤول', 'المشكلة', '#'];
  const chRows = m.challenges.map((c, i) => [
    { text: c.solution, align: 'right' },
    c.impact,
    { text: c.owner, align: 'center' },
    { text: c.desc, align: 'right' },
    String(i + 1),
  ]);
  const chCap = capCrRows(chRows);
  const chTable = {
    t: 'table', x: 6.80, y: CR_TABLE_Y, w: 6.0, rtl: true, rowH: CR_ROW_H, bodySize: 8.5, headerSize: 9,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: [1.832, 0.406, 1.245, 2.281, 0.235], // 20-07 reference deck's own gridCol widths
    rows: [chHeader, ...chCap.rows],
  };

  const rkHeader = ['التأثير', 'إحتمالية', 'المسؤول', 'الخطر', '#'];
  const rkRows = m.risks.map((r, i) => [
    r.impact,
    r.probability,
    { text: r.owner, align: 'center' },
    { text: r.desc, align: 'right' },
    String(i + 1),
  ]);
  const rkCap = capCrRows(rkRows);
  const rkTable = {
    t: 'table', x: 0.5, y: CR_TABLE_Y, w: 6.0, rtl: true, rowH: CR_ROW_H, bodySize: 8.5, headerSize: 9,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: [0.683, 0.580, 1.127, 3.415, 0.195],
    rows: [rkHeader, ...rkCap.rows],
  };

  const SUB_Y = CR_TABLE_Y - 0.37;   // 3.05 — subhead row, 0.37in above the table tops
  els.push(
    // challenges subhead (right half): red dot + '!' + 'تحديات'
    rect(12.35, SUB_Y - 0.02, 0.3, 0.3, C.red, { radius: 0.15 }),
    text(12.35, SUB_Y - 0.02, 0.3, 0.3, '!', 16, { bold: true, color: C.white, align: 'center', valign: 'middle' }),
    text(6.80, SUB_Y, 5.50, 0.24, L('subheadChallenges'), 14, { bold: true, color: C.red, align: 'right', valign: 'middle', rtl: true }),
    chTable,
    // risks subhead (left half): navy dot + '⚡' + 'المخاطر'
    rect(6.15, SUB_Y - 0.02, 0.3, 0.3, C.navy, { radius: 0.15 }),
    text(6.15, SUB_Y - 0.02, 0.3, 0.3, '⚡', 14, { bold: true, color: C.white, align: 'center', valign: 'middle' }),
    text(0.5, SUB_Y, 5.60, 0.24, L('subheadRisks'), 14, { bold: true, color: C.navy, align: 'right', valign: 'middle', rtl: true }),
    rkTable,
  );
  // Overflow notes occupy the last body-row slot (bottom 6.72, well inside 7.05).
  if (chCap.hidden > 0) els.push(crNote(6.80, chCap.hidden));
  if (rkCap.hidden > 0) els.push(crNote(0.5, rkCap.hidden));

  return { id: 'challenges', bg: C.white, elements: els };
}

// ============================================================================
// Slide — Definitions ('منهجية الأرقام'), inserted before the closing thanks slide
// ============================================================================
// Each row is [metric-label key, definition key]; every report metric gets one
// line, and the definitions mirror the engine's documented rules (see the JSDoc
// in src/engine/engine.js). Registry-driven so both columns are editable.
const DEF_ROWS = [
  ['defMTotal', 'defDTotal'],
  ['defMAwaitDispatch', 'defDAwaitDispatch'],
  ['defMShipped', 'defDShipped'],
  ['defMAwaitResults', 'defDAwaitResults'],
  ['defMLate', 'defDLate'],
  ['defMCompleted', 'defDCompleted'],
  ['defMRejected', 'defDRejected'],
  ['defMOnTime', 'defDOnTime'],
  ['defMResultedLate', 'defDResultedLate'],
  ['defMPipeline', 'defDPipeline'],
  ['defMPending', 'defDPending'],
  ['defMLatePct', 'defDLatePct'],
  ['defMTurnaround', 'defDTurnaround'],
  ['defMCancelled', 'defDCancelled'],
];

function buildDefinitions(m) {
  const L = labelOf(m);
  // 2-column table (المؤشر | التعريف). rtl → visual columns are [التعريف, المؤشر],
  // so the metric reads first (rightmost). 14 rows + header at rowH 0.4 span
  // y 0.95 → 6.95, inside the 7.05 content band; fonts 8.5/9pt.
  const METRIC_W = 3.0, DEF_W = 8.667;
  const header = rev([L('defsColMetric'), L('defsColDef')]);
  const rows = DEF_ROWS.map(([mk, dk]) =>
    rev([{ text: L(mk), align: 'right', bold: true }, { text: L(dk), align: 'right' }]));
  const table = {
    t: 'table', x: 0.833, y: 0.95, w: 11.667, rtl: true, rowH: 0.4, headerSize: 9, bodySize: 8.5,
    header: { fill: C.navy, color: C.white, bold: true },
    colW: rev([METRIC_W, DEF_W]),
    rows: [header, ...rows],
  };
  return { id: 'definitions', bg: C.white, elements: [...chrome(L('defsTitle')), table] };
}

// ============================================================================
// Slide 7 — Thanks
// ============================================================================
function buildThanks(m) {
  const L = labelOf(m);
  return {
    id: 'thanks', bg: C.navy, elements: [
      rect(0, 0, 0.15, 7.5, C.purple),
      rect(13.15, 0, 0.15, 7.5, C.orange),
      text(8.7, 0.5, 4.0, 0.5, 'NUPCO  |  Lean', 18, { bold: true, color: C.white, align: 'right', valign: 'middle' }),
      text(0.895, 3.1, 11.9, 1.3, L('thanks'), 60, { bold: true, color: C.white, align: 'center', valign: 'middle', rtl: true }),
    ],
  };
}

/**
 * @param {import('../contracts.js').ReportModel} reportModel
 * @param {{variant?:('internal'|'nupco')}} [opts]
 * @returns {import('../contracts.js').SlideSpec}
 */
export function buildSpec(reportModel, { variant = 'internal' } = {}) {
  const m = reportModel;
  // SLIDE TOGGLES — the 5 middle slides are filtered by m.reportOptions.slides
  // (absent → all on). Cover + thanks ALWAYS render. Page numbers are assigned AFTER
  // filtering so they renumber sequentially (1..n) over the INCLUDED content slides.
  // EXCEPTION — 'definitions' (منهجية الأرقام) is OPT-IN (user decision 2026-07-26: the
  // deck is back to the simple 6-slide reference shape). It renders ONLY when the flag is
  // explicitly true, so a missing/undefined flag reads as OFF instead of ON.
  const slides = m.reportOptions?.slides;
  const OPT_IN_SLIDES = new Set(['definitions']);
  const on = (key) => (OPT_IN_SLIDES.has(key) ? slides?.[key] === true : (!slides || slides[key] !== false));
  // Each builder returns an ARRAY of slides. Most yield exactly one; buildAction yields
  // the action slide plus zero-or-more continuation slides (task pagination). flatMap
  // splices those inline so continuation slides sit right after the action slide and
  // pick up the sequential post-filter footer numbering automatically.
  const middleDefs = [
    { key: 'execFunnel', build: () => [buildExecFunnel(m)] },
    { key: 'monthly', build: () => [buildMonthly(m)] },
    { key: 'compliance', build: () => [buildCompliance(m)] },
    { key: 'action', build: () => buildAction(m, variant) },
    // Challenges & risks — SPLIT OFF the action slide 2026-08-04. It is a NORMAL (default
    // ON) middle slide: 'challenges' is not in OPT_IN_SLIDES, so on() reads an absent
    // reportOptions.slides.challenges as ON. That matters for saved report options written
    // before this key existed — they carry no flag and must keep rendering the content the
    // action slide used to hold, not silently drop it.
    { key: 'challenges', build: () => [buildChallenges(m)] },
    // Definitions ('منهجية الأرقام') — default OFF (opt-in, see OPT_IN_SLIDES); when the
    // user switches it on in Settings it renders just before thanks and participates in
    // the sequential footer numbering like the other middle slides.
    { key: 'definitions', build: () => [buildDefinitions(m)] },
  ];
  const middle = middleDefs.filter((x) => on(x.key)).flatMap((x) => x.build());
  middle.forEach((s, i) => s.elements.push(pageFooter(i + 1)));
  return [buildCover(m), ...middle, buildThanks(m)];
}

export default buildSpec;
