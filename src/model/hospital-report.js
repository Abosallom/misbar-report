// model/hospital-report.js — the PER-HOSPITAL report models: the KAMC report (exactly the
// report the app always made), the SGH report (the same design over SGH's own rows) and
// the KAMC+SGH ("BOTH") report (the user's reference deck, 2026-10-08).
// Pure: no DOM, no I/O, no Date.now(). Never logs or persists a row.
//
// THE ONE RULE (model/hospital.js header, user decisions 2026-10-07 / 2026-10-11):
// every hospital is COMPUTED ON ITS OWN ROWS, with ITS OWN engine policy, and a BOTH
// number is the per-hospital results SUMMED — never one compute() over the union. Three
// things go wrong over the union, all observed on the live feed: the KAMC-only
// cancelled-by-month constants (43 manual Jan–Apr cancellations) get credited to SGH;
// the blank-facility inference reads the other hospital's rows; and a lab both
// hospitals use (Saudi Diagnostics Limited Company) merges into one row the reference
// deck prints as two.
//
// THE TWO POLICIES (hospitalPolicy below):
//   • KAMC — exactly the historic report's inputs (automation/pipeline.js engineOpts,
//     ui/screen-review.js engineInputs): settings.tatLookup with the CSV «TAT - Days»
//     fallback, the cancelled-by-month constants, the published snapshot, the
//     excludeNoTat option; send-out attribution against the catalogue.
//   • SGH — NO Test Menu yet (HOSPITALS.sgh.hasTestMenu === false): an EMPTY TAT lookup,
//     the CSV fallback OFF, cancelledByMonth {} (the constants are KAMC history), no
//     snapshot (the stored one is KAMC's published numbers), excludeNoTat off (a row
//     without a TAT is SGH's normal state, not a gap to drop). No catalogue either: its
//     send-out block only counts orders per lab (sghSendout). The engine then computes
//     lateness 0 and turnaround null for SGH — those are NOT facts, they are "unknown":
//     model.noTestMenu tells every consumer to print «–» instead (never the 0).
// engine/tat.js, engine/engine.js, engine/asof.js and model/sendout.js carry their own
// hasTestMenu() fail-safes as well, so a caller that mixes the hospitals by mistake
// still cannot give an SGH row a TAT or a country.
//
// ── buildHospitalModel({hospital, rows, settings, reportDate, tracker, sendoutMaster,
//                        scope?, engineOpts?, edits?}) → ReportModel ─────────────────────
//   The SAME shape model/report-model.js buildReportModel returns, plus `hospital`.
//   'kamc' (no scope): compute(rows, settings.tatLookup, <pipeline engineOpts>) →
//     buildReportModel — deep-equal to the automation's model for the same inputs, with
//     the one extra key `hospital: 'kamc'`.
//   'sgh': the SGH policy, plus `noTestMenu: true` and
//     sendout = { noTestMenu: true, total, byLab: [{lab, orders}], local: null,
//                 international: null, byCountry: [] }.
//   scope (optional; KAMC and SGH reports only — decision 7): applied to THIS hospital's
//     rows exactly as ui/screen-review.js buildOrderFigures applies it (applyScope, a
//     scoped engine policy, a range moves the date to its end), and the model then also
//     carries `scope`, `scopedRows` and `shipmentDetails` like a review model does.
//   NOT stamped: chips come from stampHospitalDeltas (the hospital's own TAT policy).
//
// ── buildBothModel({kamcRows, sghRows, settings, reportDate, tracker, sendoutMaster,
//                    engineOpts?, edits?, mode?}) → BothModel ─────────────────────────────
//   { hospital: 'both', reportDate, reportOptions, projectTracker, deltaWindow,
//     kamc: <buildHospitalModel kamc, week deltas stamped from KAMC rows, + scopedRows>,
//     sgh:  <buildHospitalModel sgh,  week deltas stamped from SGH rows,  + scopedRows>,
//     combined: <combineHospitals(kamc, sgh)> }
//   projectTracker sits at the TOP level (the BOTH deck reads only top-level + combined;
//   tracker CONTRACT §1.4): the same object each sub-model carries — one project document,
//   not a per-hospital one.
//   No scope (decision 7: scope is disabled in BOTH mode), no top-level kpi (so the
//   single-hospital stampers — pipeline.js applyWindowDeltas — leave it alone; re-stamp
//   with stampBothDeltas, which also rebuilds `combined`).
//
// ── combined — EVERY number the reference BOTH deck prints, so the spec only lays out.
//   The exact shape, field by field, is documented on combineHospitals below and in
//   the build map (map/model-both.md). In short: cards (per hospital + combined + week
//   deltas; late = the Test-Menu hospitals only, i.e. KAMC, with its % over KAMC's own
//   awaiting results), cancelled split, funnel stages (+ the remaining track), monthly
//   per hospital + combined + completion % (months before a hospital's first order are
//   marked beforeJoin, printed «–»), turnaround (KAMC only), countries (KAMC only + the
//   SGH order count), labs (rows per hospital with the share of the combined total and
//   the «<0.1%» input), multi-country labs, compliance rows (continuous numbering) and
//   totals (late KAMC only).

import { compute, round1 } from '../engine/engine.js?v=v2026-10-18.2';
import { buildReportModel, projectTrackerFor, trackerStatusLogOf } from './report-model.js?v=v2026-10-18.2';
import { stampWindowDeltas, windowFor } from './delta-window.js?v=v2026-10-18.2';
import {
  FACILITY_DISPLAY, norm, share, analyseSendout, hasMaster,
} from './sendout.js?v=v2026-10-18.2';
import {
  EMPTY_SCOPE, normalizeScope, isScoped, hasRange, applyScope, shipmentDetails,
} from './scope.js?v=v2026-10-18.2';
import { HOSPITALS } from './hospital.js?v=v2026-10-18.2';
import { normFacility } from '../contracts.js?v=v2026-10-18.2';

/** The hospitals a BOTH report combines, in the registry's (display) order. */
const BOTH_KEYS = Object.freeze(Object.keys(HOSPITALS));

/** Does the app hold a Test Menu for this hospital? The ONE switch (HOSPITALS). */
const hasMenu = (h) => !!(HOSPITALS[h] && HOSPITALS[h].hasTestMenu === true);

/** A hospital key or a thrown error — a typo must never build KAMC under another name. */
function checkHospital(hospital) {
  if (!Object.prototype.hasOwnProperty.call(HOSPITALS, hospital)) {
    throw new Error(`hospital-report: unknown hospital ${JSON.stringify(hospital)}`);
  }
  return hospital;
}

/**
 * compute()'s inputs AND the delta stamper's inputs for one hospital, in ONE place.
 *   kamc unscoped ⇒ automation/pipeline.js engineOpts() verbatim (the upload screen's
 *                   and the review screen's unscoped list are the same one);
 *   kamc scoped   ⇒ ui/screen-review.js engineInputs' scoped list (constants and snapshot
 *                   dropped, inferBlanks:false — model/scope.js "SCOPED ROWS ARE FINAL");
 *   no Test Menu  ⇒ the header's SGH policy, scoped or not (+ inferBlanks:false scoped).
 * `deltaTat` / `deltaOpts` are what stampWindowDeltas must be handed for the chips to
 * count the SAME rows the cards count: KAMC's are undefined opts (the stamper derives
 * excludeNoTat from the settings, as it always has); a no-menu hospital's pin the empty
 * lookup and the fallback OFF so the as-of passes cannot give its rows a TAT either.
 * @param {('kamc'|'sgh')} hospital
 * @param {Object} settings  the store settings bag
 * @param {{asOf:string, scoped?:boolean}} args
 * @returns {{tat:Object, opts:Object, deltaTat:Object, deltaOpts:(Object|undefined)}}
 */
export function hospitalPolicy(hospital, settings, { asOf, scoped = false } = {}) {
  checkHospital(hospital);
  const s = settings || {};
  const excludeNoTat = !!(s.reportOptions && s.reportOptions.excludeNoTat);
  if (hasMenu(hospital)) {
    const opts = scoped
      ? { asOf, cancelledByMonth: {}, snapshot: undefined, excludeNoTat, inferBlanks: false }
      : {
        asOf,
        cancelledByMonth: (s.historicalConstants || {}).cancelledByMonth || {},
        snapshot: s.snapshot,
        excludeNoTat,
      };
    return { tat: s.tatLookup, opts, deltaTat: s.tatLookup || {}, deltaOpts: undefined };
  }
  const opts = {
    asOf, cancelledByMonth: {}, snapshot: undefined, excludeNoTat: false, tatFallbackFromCsv: false,
  };
  if (scoped) opts.inferBlanks = false;
  return { tat: {}, opts, deltaTat: {}, deltaOpts: { excludeNoTat: false, tatFallbackFromCsv: false } };
}

/** The keys a no-menu hospital's policy must keep whatever a caller merges over it. */
const NO_MENU_PINNED = ['cancelledByMonth', 'snapshot', 'excludeNoTat', 'tatFallbackFromCsv'];

/** The caption a lab is printed under on the send-out slides (model/sendout.js
 *  FACILITY_DISPLAY when it has an OWN entry for the name, else the whitespace-collapsed
 *  name itself — `Company TEMKIN SAHA Medical` prints verbatim, as on the reference). */
function labCaption(raw) {
  const key = norm(raw);
  if (Object.prototype.hasOwnProperty.call(FACILITY_DISPLAY, key)) return FACILITY_DISPLAY[key];
  return normFacility(raw) || String(raw == null ? '' : raw);
}

/**
 * The send-out block of a hospital WITHOUT a Test Menu: orders per lab, nothing else.
 * Built from that hospital's own engine byLab (non-cancelled lines, blank facilities
 * filled from its OWN rows only), regrouped under the send-out caption so two spellings
 * of one lab become one row; labs A→Z like model/sendout.js byLab. `local`,
 * `international` and the countries are null / empty BY RULE, not by a failed lookup:
 * the catalogue is KAMC's contract list (header). `total` = Σ byLab = kpi.totals.total.
 * @param {Object} kpi  the hospital's EngineOutput
 */
export function sghSendout(kpi) {
  const counts = new Map();
  for (const L of (kpi && kpi.byLab) || []) {
    const lab = labCaption(L.lab);
    counts.set(lab, (counts.get(lab) || 0) + (L.total || 0));
  }
  const byLab = [...counts.entries()]
    .map(([lab, orders]) => ({ lab, orders }))
    .sort((a, b) => a.lab.localeCompare(b.lab));
  const total = byLab.reduce((s, r) => s + r.orders, 0);
  return { noTestMenu: true, total, byLab, local: null, international: null, byCountry: [] };
}

/**
 * ONE hospital's report model — see the header for the contract.
 * Throws on an unknown hospital and when compute() cannot run (no usable reportDate):
 * a caller must never fall back to another hospital's numbers under this name.
 * @returns {import('../contracts.js').ReportModel & {hospital:string}}
 */
export function buildHospitalModel({
  hospital, rows, settings, reportDate, tracker, sendoutMaster, scope, engineOpts, edits = {},
} = {}) {
  checkHospital(hospital);
  const list = Array.isArray(rows) ? rows : [];
  // Scope only when the caller passes one (KAMC / SGH reports, decision 7). Absent ⇒ the
  // automation's model exactly: the rows as given, no scope fields on the model.
  const sc = scope === undefined ? null : normalizeScope(scope);
  const scoped = !!sc && isScoped(sc);
  const asOf = scoped && hasRange(sc) ? sc.to : reportDate;
  const used = sc ? applyScope(list, sc) : list;

  const policy = hospitalPolicy(hospital, settings, { asOf, scoped });
  const opts = { ...policy.opts, ...(engineOpts || {}) };
  if (!hasMenu(hospital)) {
    // A no-menu hospital's policy is not negotiable: an extra opt may add (dedupe, a
    // chart catalogue), never re-introduce KAMC's TAT, constants or snapshot.
    for (const k of NO_MENU_PINNED) opts[k] = policy.opts[k];
    opts.asOf = asOf;
  }
  const engineOutput = compute(used, policy.tat, opts);

  let model;
  if (hasMenu(hospital) && !scoped) {
    // THE historic call, argument for argument (automation/pipeline.js stepEngine).
    model = buildReportModel({
      engineOutput, tracker, settings, reportDate: asOf, orders: used, sendoutMaster, edits,
    });
  } else if (hasMenu(hospital)) {
    // A scoped build's rows are FINAL (model/scope.js): the send-out pass must not infer
    // blanks again on a subset, so it gets `inferBlanks:false` — the one argument
    // buildReportModel's two-argument call cannot pass (ui/screen-review.js sendoutFor).
    model = buildReportModel({
      engineOutput, tracker, settings, reportDate: asOf, orders: [], sendoutMaster: null, edits,
    });
    model.sendout = null;
    if (used.length && hasMaster(sendoutMaster)) {
      try {
        model.sendout = analyseSendout(used, sendoutMaster, { inferBlanks: false });
      } catch (e) {
        // As the review's sendoutFor: no slides rather than a dead screen.
        console.warn('[hospital-report] send-out analysis failed; slides omitted', e && e.message);
      }
    }
  } else {
    // No catalogue for this hospital: buildReportModel is handed no orders so it never
    // calls analyseSendout, and the counts-only block replaces its null.
    model = buildReportModel({
      engineOutput, tracker, settings, reportDate: asOf, orders: [], sendoutMaster: null, edits,
    });
    model.sendout = sghSendout(engineOutput);
    model.noTestMenu = true;
  }
  model.hospital = hospital;
  if (sc) {
    model.scope = scoped ? sc : EMPTY_SCOPE;
    model.scopedRows = used;
    model.shipmentDetails = sc.shipments.length ? shipmentDetails(used, sc.shipments) : [];
  }
  return model;
}

/**
 * Stamp ONE hospital model's week chips (model.kpi.deltas + model.deltaWindow) with that
 * hospital's own policy — the delta-side twin of hospitalPolicy. For 'kamc' (or a model
 * with no `hospital`, i.e. every model that predates this file) it is the very call
 * automation/pipeline.js applyWindowDeltas makes: settings.tatLookup, the stored delta
 * mode, excludeNoTat from the settings. For a hospital without a Test Menu it passes the
 * empty lookup and the fallback OFF, so the late chip can never be computed off a TAT
 * that hospital does not have. `rows` defaults to model.scopedRows (the rows the numbers
 * came from). Degrades exactly like stampWindowDeltas (no rows → engine deltas kept,
 * returns null); never throws.
 * @param {Object} model  a buildHospitalModel result (mutated)
 * @param {{rows?:Array, settings?:Object, mode?:*}} [args]
 * @returns {{start:string,end:string,mode:string,approx?:Object}|null}
 */
export function stampHospitalDeltas(model, { rows, settings, mode } = {}) {
  if (!model || !model.kpi) return null;
  const h = model.hospital || 'kamc';
  if (!Object.prototype.hasOwnProperty.call(HOSPITALS, h)) return null;
  const s = settings || {};
  const p = hospitalPolicy(h, s, { asOf: model.reportDate });
  const wantMode = mode !== undefined && mode !== null && mode !== ''
    ? mode
    : (s.reportOptions && s.reportOptions.deltaMode);
  return stampWindowDeltas(model, {
    rows: Array.isArray(rows) ? rows : model.scopedRows,
    tatTests: p.deltaTat,
    settings: s,
    mode: wantMode,
    opts: p.deltaOpts,
  });
}

/** A finite number, else 0 (an engine field that is absent counts as nothing). */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Σ over the non-null values of an object keyed by hospital. */
const sumOf = (byH) => Object.values(byH).reduce((s, v) => (v == null ? s : s + v), 0);

// The six exec cards, in the reference's logical (right-to-left) order, and where each
// reads its number. `delta` is the NUMBER_KEYS chip key (model/delta-window.js).
const CARD_DEFS = Object.freeze([
  { key: 'total', get: (k) => k.totals && k.totals.total },
  { key: 'awaitingDispatch', get: (k) => k.buckets && k.buckets.awaitingDispatch },
  { key: 'shippedNotReceived', get: (k) => k.buckets && k.buckets.shippedNotReceived },
  { key: 'awaitingResults', get: (k) => k.buckets && k.buckets.awaitingResults },
  { key: 'completed', get: (k) => k.buckets && k.buckets.completed },
  // Lateness needs a TAT: a hospital without a Test Menu has NONE (null → «–»), and the
  // engine's computed 0 for it is never read (map/numbers.md §0.1: "do not rely on it").
  { key: 'lateNoResult', get: (k) => k.buckets && k.buckets.lateNoResult, needsMenu: true },
]);

// The five journey stages: funnel field → the chip key that counts the same event.
const STAGE_DEFS = Object.freeze([
  { key: 'created', delta: 'total' },
  { key: 'collected', delta: 'collected' },
  { key: 'dispatched', delta: 'dispatched' },
  { key: 'received', delta: 'received' },
  { key: 'completed', delta: 'completed' },
]);

/** One monthly cell from an engine monthly entry (absent ⇒ a month with no orders). */
function monthCell(entry, beforeJoin) {
  if (beforeJoin) return { orders: 0, results: 0, incomplete: 0, completionPct: null, beforeJoin: true };
  const orders = num(entry && entry.orders);
  const results = num(entry && entry.results);
  return {
    orders,
    results,
    // orders − results, as engine.js buildMonthly defines `incomplete`.
    incomplete: entry ? num(entry.incomplete) : 0,
    completionPct: entry && entry.completionPct != null ? entry.completionPct : null,
    beforeJoin: false,
  };
}

/** A cell summed from counts: its % is RECOMPUTED from the summed counts, never averaged
 *  (engine.js buildMonthly's own rule: round1(results / orders × 100), null for 0 orders). */
function sumCell(cells) {
  const orders = cells.reduce((s, c) => s + c.orders, 0);
  const results = cells.reduce((s, c) => s + c.results, 0);
  const incomplete = cells.reduce((s, c) => s + c.incomplete, 0);
  return {
    orders, results, incomplete,
    completionPct: orders > 0 ? round1((results / orders) * 100) : null,
    beforeJoin: false,
  };
}

/**
 * EVERY number the BOTH deck prints, from the per-hospital models (each already
 * stamped with its own week chips). PURE: same models ⇒ deep-equal output.
 * Hospitals are keyed by registry key (kamc, sgh). "Menu hospitals" = HOSPITALS[h]
 * .hasTestMenu — KAMC only today, which is why the reference labels these "KAMC فقط".
 *
 * {
 *   testMenu: { kamc: true, sgh: false },
 *   window:   { start, end, mode, approx? } | null      — the chips' week (subtitle)
 *   dataWindow: { first:'YYYY-MM', last:'YYYY-MM' } | null — first→last month with
 *             combined orders > 0 (total-card sub «أبريل – أكتوبر», monthly columns)
 *   cards: { total, awaitingDispatch, shippedNotReceived, awaitingResults, completed,
 *            lateNoResult } each
 *     { kamc, sgh, combined, delta: { kamc, sgh, combined } }
 *     lateNoResult: sgh = null and delta.sgh = null (no Test Menu → «–»); combined and
 *     delta.combined = the menu hospitals only; plus pct (= round1(late / awaiting × 100)
 *     over the menu hospitals — KAMC's own buckets.latePct, 39 on the reference, NOT
 *     over the combined awaiting) and pctBasis (that awaiting count, 205).
 *   cancelled: { kamc, sgh, combined }        — each hospital's cancelledNote (67 = KAMC's
 *             43 constants + 24 in data; SGH has no constants)
 *   funnel: [ { key, kamc, sgh, combined, delta: {kamc, sgh, combined}, remaining } ×5 ]
 *             key ∈ created/collected/dispatched/received/completed; remaining = the
 *             grey track = combined created − combined stage, floored at 0 (the funnel
 *             is cumulative dates, not guaranteed monotone — engine.js buildFunnel).
 *   monthly: {
 *     months: ['YYYY-MM', …]                  — the dataWindow's months (engine keys)
 *     joined: { kamc:'YYYY-MM'|null, sgh }    — each hospital's first month with orders
 *     rows: [ { month, kamc: cell, sgh: cell, combined: cell } ]
 *       cell = { orders, results, incomplete, completionPct|null, beforeJoin }
 *       beforeJoin = the month precedes that hospital's first order (or it has none):
 *       printed «–» (U+2013) in every metric, counted as 0 in the combined cell.
 *     totals: { kamc: cell, sgh: cell, combined: cell } — Σ over `months`, % recomputed;
 *       a hospital that never ordered has beforeJoin true here too.
 *     chart: { kamc: [orders…], sgh: [orders…], total: [orders…] } — aligned to months;
 *       a pre-join month is 0 (the reference's chart data), not null.
 *   }
 *   turnaround: { hospital:'kamc', actual, expected, measuredCount,
 *                 months:[…KAMC engine month keys, constants months included…],
 *                 perMonth: { actual:[…], expected:[…] } aligned to months (null gaps) }
 *               | null when KAMC has no model.
 *   countries: null when KAMC has orders but no send-out block (no catalogue), or when
 *     no hospital has a send-out order at all; a KAMC with NO orders counts as an all-0
 *     block when another hospital has send-out orders (so the SGH count and SGH lab rows
 *     still print, KAMC at 0); else
 *     { hospital:'kamc', total, local, international, localPct, internationalPct,
 *       byCountry: [{ country, orders, pct }], sgh: { orders } }
 *     every pct = share(n, KAMC total) (model/sendout.js share, one decimal; this slide
 *     prints 0.0 for a tiny share — no «<0.1%» here, as on the reference).
 *   labs: null when countries is null, else
 *     { total, basis: { kamc, sgh, combined },
 *       rows: [ { hospital, lab, country|null, reflab|null, orders, share, underTenth } ],
 *       multiCountry: [ { lab, countries } ] }
 *     rows: KAMC's send-out byLab (its order) then the no-menu hospital's counts-only
 *     byLab (country/reflab null — the merged «Test Menu» note); share = share(orders,
 *     combined total); underTenth = orders > 0 && share rounds to 0.0 → print «<0.1%».
 *     multiCountry: KAMC labs attributed to ≥ 2 countries, A→Z (the shaded-rows note).
 *   compliance: {
 *     rows: [ { no, hospital, lab, total, completed, awaitingResult, rejected, pipeline,
 *               late|null, latePct|null } ] — each hospital's own engine byLab (raw lab
 *               names, A→Z), KAMC first, `no` continuous (1…n); late/latePct null for a
 *               hospital without a Test Menu (the merged note).
 *     totals: { total, completed, awaitingResult, rejected, pipeline, late, latePct,
 *               lateBasis } — late and latePct over the MENU hospitals only (80 / 205 →
 *               39.0 on the reference, not 80 / 234), latePct with build-spec's own
 *               compliance rounding.
 *   }
 * }
 * @param {{kamc:Object, sgh:Object}} models  per-hospital models (kpi, sendout, deltaWindow)
 */
export function combineHospitals(models) {
  const M = models || {};
  const kpiOf = (h) => (M[h] && M[h].kpi) || {};
  const byH = (f) => Object.fromEntries(BOTH_KEYS.map((h) => [h, f(h)]));
  const menuKeys = BOTH_KEYS.filter(hasMenu);

  // ── cards ──
  const cards = {};
  for (const def of CARD_DEFS) {
    const value = byH((h) => (def.needsMenu && !hasMenu(h) ? null : num(def.get(kpiOf(h)))));
    const delta = byH((h) => (def.needsMenu && !hasMenu(h) ? null : num((kpiOf(h).deltas || {})[def.key])));
    cards[def.key] = { ...value, combined: sumOf(value), delta: { ...delta, combined: sumOf(delta) } };
  }
  const lateBasis = menuKeys.reduce((s, h) => s + num((kpiOf(h).buckets || {}).awaitingResults), 0);
  // engine.js buildBuckets' latePct formula, so with one menu hospital this IS its
  // buckets.latePct — the number today's late card prints.
  cards.lateNoResult.pct = lateBasis > 0 ? round1((cards.lateNoResult.combined / lateBasis) * 100) : 0;
  cards.lateNoResult.pctBasis = lateBasis;

  // ── cancelled note ──
  const cancelledBy = byH((h) => num(kpiOf(h).cancelledNote));
  const cancelled = { ...cancelledBy, combined: sumOf(cancelledBy) };

  // ── journey funnel ──
  const createdAll = sumOf(byH((h) => num((kpiOf(h).funnel || {}).created)));
  const funnel = STAGE_DEFS.map((st) => {
    const value = byH((h) => num((kpiOf(h).funnel || {})[st.key]));
    const delta = byH((h) => num((kpiOf(h).deltas || {})[st.delta]));
    const combined = sumOf(value);
    return {
      key: st.key, ...value, combined,
      delta: { ...delta, combined: sumOf(delta) },
      remaining: Math.max(0, createdAll - combined),
    };
  });

  // ── monthly ──
  const monthOf = byH((h) => new Map((kpiOf(h).monthly || []).map((e) => [e.month, e])));
  const joined = byH((h) => {
    const first = (kpiOf(h).monthly || []).filter((e) => num(e.orders) > 0).map((e) => e.month).sort()[0];
    return first || null;
  });
  const allMonths = [...new Set(BOTH_KEYS.flatMap((h) => [...monthOf[h].keys()]))].sort();
  const withOrders = allMonths.filter((m) => BOTH_KEYS.some((h) => num((monthOf[h].get(m) || {}).orders) > 0));
  const dataWindow = withOrders.length
    ? { first: withOrders[0], last: withOrders[withOrders.length - 1] }
    : null;
  const months = dataWindow ? allMonths.filter((m) => m >= dataWindow.first && m <= dataWindow.last) : [];
  const rows = months.map((month) => {
    const cells = byH((h) => monthCell(monthOf[h].get(month), joined[h] == null || month < joined[h]));
    return { month, ...cells, combined: sumCell(Object.values(cells)) };
  });
  const hospitalTotals = byH((h) => {
    const t = sumCell(rows.map((r) => r[h]));
    t.beforeJoin = joined[h] == null;
    return t;
  });
  const monthly = {
    months,
    joined,
    rows,
    totals: { ...hospitalTotals, combined: sumCell(rows.map((r) => r.combined)) },
    chart: {
      ...byH((h) => rows.map((r) => r[h].orders)),
      total: rows.map((r) => r.combined.orders),
    },
  };

  // ── turnaround (KAMC only: a turnaround needs due dates, i.e. a Test Menu) ──
  let turnaround = null;
  if (M.kamc && M.kamc.kpi && M.kamc.kpi.turnaround) {
    const t = M.kamc.kpi.turnaround;
    // The line chart's categories are KAMC's ENGINE month list (constants months too),
    // exactly what today's monthly slide draws — map/numbers.md §3.3: 10 months on the
    // line chart while the table shows the dataWindow's 7. Not unified on purpose.
    const tMonths = (M.kamc.kpi.monthly || []).map((e) => e.month);
    const at = (k, f) => {
      const p = (t.perMonth || []).find((x) => x.month === k);
      return p && p[f] != null ? p[f] : null;
    };
    turnaround = {
      hospital: 'kamc',
      actual: t.overallActual ?? null,
      expected: t.overallExpected ?? null,
      measuredCount: num(t.measuredCount),
      months: tMonths,
      perMonth: { actual: tMonths.map((k) => at(k, 'actual')), expected: tMonths.map((k) => at(k, 'expected')) },
    };
  }

  // ── countries + labs (KAMC's catalogue attribution; SGH counts only) ──
  // KAMC without a send-out block: with orders that means no catalogue (nothing can be
  // attributed → no slides, as the KAMC report); with NO orders its send-out is all zero
  // by fact, so a no-menu hospital's counts still get their country / lab rows (decision
  // 12 mirrored: the empty hospital keeps its 0 cells, the other its numbers).
  const kamcEmpty = num((kpiOf('kamc').totals || {}).total) === 0;
  const otherHasSo = BOTH_KEYS.some((h) => h !== 'kamc' && M[h] && M[h].sendout && num(M[h].sendout.total) > 0);
  const kso = (M.kamc && M.kamc.sendout)
    || (kamcEmpty && otherHasSo ? { total: 0, local: 0, international: 0, byCountry: [], byLab: [] } : null);
  const otherSo = byH((h) => (h === 'kamc' ? null : ((M[h] && M[h].sendout) || { total: 0, byLab: [] })));
  let countries = null;
  let labs = null;
  if (kso) {
    const T = num(kso.total);
    countries = {
      hospital: 'kamc',
      total: T,
      local: num(kso.local),
      international: num(kso.international),
      localPct: share(num(kso.local), T),
      internationalPct: share(num(kso.international), T),
      byCountry: (kso.byCountry || []).map((c) => ({ country: c.country, orders: c.orders, pct: share(c.orders, T) })),
      sgh: { orders: num(otherSo.sgh && otherSo.sgh.total) },
    };
    const basis = byH((h) => (h === 'kamc' ? T : num(otherSo[h] && otherSo[h].total)));
    const total = sumOf(basis);
    const row = (hospital, lab, country, reflab, orders) => {
      const sh = share(orders, total);
      return { hospital, lab, country, reflab, orders, share: sh, underTenth: orders > 0 && sh === 0 };
    };
    const labRows = (kso.byLab || []).map((r) => row('kamc', r.lab, r.country, r.reflab, r.orders));
    for (const h of BOTH_KEYS) {
      if (h === 'kamc') continue;
      for (const r of (otherSo[h] && otherSo[h].byLab) || []) labRows.push(row(h, r.lab, null, null, r.orders));
    }
    const countriesOf = new Map();
    for (const r of kso.byLab || []) {
      if (!countriesOf.has(r.lab)) countriesOf.set(r.lab, new Set());
      countriesOf.get(r.lab).add(r.country);
    }
    const multiCountry = [...countriesOf.entries()]
      .filter(([, set]) => set.size >= 2)
      .map(([lab, set]) => ({ lab, countries: set.size }))
      .sort((a, b) => a.lab.localeCompare(b.lab));
    labs = { total, basis: { ...basis, combined: total }, rows: labRows, multiCountry };
  }

  // ── compliance ──
  const compRows = [];
  for (const h of BOTH_KEYS) {
    for (const r of kpiOf(h).byLab || []) {
      compRows.push({
        no: compRows.length + 1,
        hospital: h,
        lab: r.lab,
        total: num(r.total),
        completed: num(r.completed),
        awaitingResult: num(r.awaitingResult),
        rejected: num(r.rejected),
        pipeline: num(r.pipeline),
        late: hasMenu(h) ? num(r.late) : null,
        latePct: hasMenu(h) ? num(r.latePct) : null,
      });
    }
  }
  const colSum = (f, rs = compRows) => rs.reduce((s, r) => s + num(r[f]), 0);
  const menuRows = compRows.filter((r) => hasMenu(r.hospital));
  const lateTot = colSum('late', menuRows);
  const awaitMenu = colSum('awaitingResult', menuRows);
  const compliance = {
    rows: compRows,
    totals: {
      total: colSum('total'),
      completed: colSum('completed'),
      awaitingResult: colSum('awaitingResult'),
      rejected: colSum('rejected'),
      pipeline: colSum('pipeline'),
      late: lateTot,
      // build-spec.js buildCompliance's latePctTot rounding, restricted to the menu
      // hospitals («* المتأخرة ونسبتها في صف المجموع تخص KAMC فقط»).
      latePct: awaitMenu > 0 ? Math.round((lateTot / awaitMenu) * 1000) / 10 : 0,
      lateBasis: awaitMenu,
    },
  };

  // ── the chips' window (both hospitals are stamped for the same date and mode) ──
  const stamped = BOTH_KEYS.map((h) => M[h] && M[h].deltaWindow).filter(Boolean);
  let window = null;
  if (stamped.length) {
    const approx = Object.assign({}, ...stamped.map((w) => w.approx || {}));
    window = { start: stamped[0].start, end: stamped[0].end, mode: stamped[0].mode };
    if (Object.keys(approx).length) window.approx = approx;
  }

  return {
    testMenu: byH(hasMenu),
    window,
    dataWindow,
    cards,
    cancelled,
    funnel,
    monthly,
    turnaround,
    countries,
    labs,
    compliance,
  };
}

/**
 * (Re-)stamp a BOTH model's chips — each hospital from ITS OWN rows (sub-model
 * scopedRows) with ITS OWN policy — then rebuild `combined` and `deltaWindow` from the
 * stamped sub-models. PURE + IDEMPOTENT like stampWindowDeltas: a second call on the same
 * model is deep-equal (the generate screen re-stamps what the review screen stamped).
 * When neither hospital has rows the window is still described (windowFor) so the deck
 * subtitle never goes blank; the chips are then the engine's own (0 — no snapshot delta
 * for SGH, and KAMC's against an empty row set).
 * @param {Object} model  a buildBothModel result (mutated)
 * @param {{settings?:Object, mode?:*}} [args]
 * @returns {Object|null} model.deltaWindow
 */
export function stampBothDeltas(model, { settings, mode } = {}) {
  if (!model || model.hospital !== 'both') return null;
  for (const h of BOTH_KEYS) {
    if (model[h]) stampHospitalDeltas(model[h], { rows: model[h].scopedRows, settings, mode });
  }
  const combined = combineHospitals(Object.fromEntries(BOTH_KEYS.map((h) => [h, model[h]])));
  if (!combined.window) {
    try {
      const s = settings || {};
      const w = windowFor(model.reportDate, mode ?? (s.reportOptions && s.reportOptions.deltaMode));
      combined.window = { start: w.start, end: w.end, mode: w.mode };
    } catch {
      combined.window = null; // no usable date: nothing to describe
    }
  }
  model.combined = combined;
  model.deltaWindow = combined.window;
  return model.deltaWindow;
}

/**
 * The KAMC+SGH ("BOTH") report model — see the header. Each hospital is built with
 * buildHospitalModel on its own rows (never the union), stamped with its own week chips,
 * then summed by combineHospitals. Missing rows for a hospital = an empty list (its
 * cells print 0 / «–», decision 12). Throws when compute() cannot run (no reportDate).
 * @returns {{hospital:'both', reportDate:string, reportOptions:Object, projectTracker:Object|null,
 *   deltaWindow:Object, kamc:Object, sgh:Object, combined:Object}}
 */
export function buildBothModel({
  kamcRows, sghRows, settings, reportDate, tracker, sendoutMaster, engineOpts, edits, mode,
} = {}) {
  const rowsOf = { kamc: kamcRows, sgh: sghRows };
  const model = {
    hospital: 'both',
    reportDate,
    // The presentation options as the automation stamps them (settings.reportOptions);
    // the slides toggles decide monthly / send-out / compliance in BOTH too (decision 10).
    reportOptions: (settings && settings.reportOptions) || {},
    // Resolved exactly as buildReportModel resolves it for each sub-model below.
    projectTracker: projectTrackerFor(tracker, settings, edits),
    // …and its status history beside it (the weekly «المهام المكتملة خلال الأسبوع» slide).
    trackerStatusLog: edits && edits.trackerStatusLog !== undefined
      ? edits.trackerStatusLog : trackerStatusLogOf(settings),
  };
  for (const h of BOTH_KEYS) {
    const rows = Array.isArray(rowsOf[h]) ? rowsOf[h] : [];
    const sub = buildHospitalModel({
      hospital: h, rows, settings, reportDate, tracker, sendoutMaster, engineOpts, edits,
    });
    // The rows this hospital's numbers came from — what stampBothDeltas re-stamps from.
    // Memory only, like a review model's scopedRows (never persisted, never logged).
    sub.scopedRows = rows;
    model[h] = sub;
  }
  stampBothDeltas(model, { settings, mode });
  return model;
}
