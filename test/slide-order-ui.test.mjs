// test/slide-order-ui.test.mjs — run with:  node --test
// «ترتيب الشرائح», the APP side (slide-order CONTRACT decisions 5–8). The order vocabulary
// itself (model/slide-order.js) and the decks' sorting are pinned in slide-order.test.mjs;
// this file pins WHICH order a report uses and WHEN:
//   • the TEMPORARY order (state.slideOrder, state.js helpers) is bound to the load: it
//     survives a report-type switch, a scope change, a date change, a Settings visit and
//     «رجوع» from generate; it is gone after a new data load, «تقرير جديد» (resetRunData)
//     and the upload screen's «متابعة» (clearTempSlideOrder);
//   • it reaches the deck as model.slideOrder (overlayTempSlideOrder), never through
//     model.reportOptions, which the review re-sources from settings on every render;
//   • persistReportOptions' merge (mergeReportOptions) can NEVER write it into settings;
//   • the card's pure planning: units per report type, «مخفية» rows keep their place, the
//     status / buttons, the save merge (units the deck lacks keep their SAVED slots), the
//     default stored as ABSENT;
//   • the Settings twin edits the SAVED order; a direct jump to generate uses the saved order.
// SYNTHETIC rows only (made-up ids, labs and tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  modelFor, reportOptionsFromSettings, mergeReportOptions, slideOrderUnitsFor, slideUnitHidden,
  slideOrderRows, slideOrderStatus, slideOrderToSave, withSavedSlideOrder, slideTogglesFor,
} from '../src/ui/screen-review.js';
import { savedSlideOrderRows, setSavedSlideOrder } from '../src/ui/screen-settings.js';
import { fallbackModel } from '../src/ui/screen-generate.js';
import { moveSlideUnit, slideUnitToTop, slideOrderLabel } from '../src/ui/components.js';
import {
  state as appState, resetRunData, tempSlideOrder, setTempSlideOrder, clearTempSlideOrder,
  overlayTempSlideOrder, tempSlideOrderUnits,
} from '../src/state.js';
import { SLIDE_ORDER_KEYS, slideOrderOf, unitOfSlideId, mergeVisibleOrder } from '../src/model/slide-order.js';
import { buildSpec } from '../src/slidespec/build-spec.js';
import { takeOrders } from '../src/model/hospital.js';
import * as hospitalReport from '../src/model/hospital-report.js';
import { compute } from '../src/engine/engine.js';
import { STR } from '../src/i18n/ar.js';
import * as store from '../src/store.js';
import { EMPTY_SCOPE } from '../src/model/scope.js';

const KAMC = { orderingFacilityId: '31763', hospital: 'King Abdul ah Medical City' };
const SGH = { orderingFacilityId: '1037', hospital: 'Saudi German Hospital  Alzahraa Branch' };
const DATE = '2026-10-08';
let seq = 0;
const row = (h, facility, testName, od, over = {}) => {
  seq += 1;
  const d = (x) => (x ? `${x} 00:00:00` : null);
  return {
    orderDate: d(od), facility, orderId: `7${String(seq).padStart(5, '0')}`, lineNo: seq,
    loinc: null, testName, collected: d(over.col), dispatched: d(over.dis), received: d(over.rec),
    resulted: d(over.res), rawStatus: over.status || 'Order Created', tatDaysCsv: null,
    specimenNo: null, shipmentId: over.ship ?? null, performingFacilityId: null, ...h,
  };
};
const rows = () => [
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-04', { col: '2026-10-04', dis: '2026-10-04', rec: '2026-10-05', res: '2026-10-07', status: 'Result Approved', ship: 'ELAB800001' }),
  row(KAMC, 'Lab Beta', 'Assay K', '2026-10-06', { col: '2026-10-06', dis: '2026-10-06', status: 'Shipment Dispatched', ship: 'ELAB800002' }),
  row(SGH, 'Synthetic SGH Lab', 'Assay S', '2026-10-05', { col: '2026-10-05', status: 'Specimen Collected' }),
];
const SETTINGS = { tatLookup: { 'Assay K': 2 }, historicalConstants: { cancelledByMonth: {} }, reportOptions: { deltaMode: 'week' } };
const OPTS = { hospitalReport, notify: () => {} };

/** A review state after one load through THE door (takeOrders), as the app's. */
function loadedState(over = {}) {
  const parsed = { orders: null, tracker: null, summary: null, excludedHospitals: [] };
  takeOrders(parsed, rows());
  return { parsed, files: {}, reportDate: DATE, reportModel: null, engineOutput: null, edits: {}, reportHospital: 'kamc', ...over };
}
/** What the review's render() does each time: modelFor, re-source reportOptions, overlay. */
function reviewRender(state, settings = SETTINGS) {
  const m = modelFor(state, { settings }, compute, OPTS);
  m.reportOptions = reportOptionsFromSettings(settings);
  overlayTempSlideOrder(m, state);
  return m;
}
const TRACKER_FIRST = ['tracker', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'challenges', 'definitions'];
const COMPLIANCE_FIRST = ['compliance', 'execFunnel', 'shipments', 'monthly', 'sendout', 'tracker', 'challenges', 'definitions'];

/* ------------------------------------------------------------------ *
 * state.js — the temporary order's own rules
 * ------------------------------------------------------------------ */

test('state: set / read / clear; a copy is stored; bound to the load epoch', () => {
  const st = { scopeEpoch: 4 };
  const order = [...TRACKER_FIRST];
  setTempSlideOrder(st, order);
  order[0] = 'mutated';
  assert.deepEqual(tempSlideOrder(st), TRACKER_FIRST, 'stored as a copy');
  assert.equal(st.slideOrder.epoch, 4);
  st.scopeEpoch = 5; // a new load moved the epoch
  assert.equal(tempSlideOrder(st), null, 'an order made on another load is not in force');
  assert.equal(st.slideOrder, null, '…and is dropped');
  setTempSlideOrder(st, TRACKER_FIRST);
  clearTempSlideOrder(st);
  assert.equal(tempSlideOrder(st), null);
  setTempSlideOrder(st, 'junk');
  assert.equal(st.slideOrder, null, 'a non-array clears');
  // Nothing loaded (no epoch yet) is epoch 0 — the mock preview can still hold one.
  const empty = {};
  setTempSlideOrder(empty, TRACKER_FIRST);
  assert.deepEqual(tempSlideOrder(empty), TRACKER_FIRST);
});

test('state: overlay puts the temporary order on model.slideOrder (never reportOptions) and removes a stale one', () => {
  const st = { scopeEpoch: 1 };
  const m = { reportOptions: { slideOrder: COMPLIANCE_FIRST } };
  assert.equal(overlayTempSlideOrder(m, st), null);
  assert.equal('slideOrder' in m, false);
  assert.deepEqual(slideOrderOf(m), COMPLIANCE_FIRST, 'no temporary ⇒ the saved order');
  setTempSlideOrder(st, TRACKER_FIRST);
  assert.deepEqual(overlayTempSlideOrder(m, st), TRACKER_FIRST);
  assert.deepEqual(m.slideOrder, TRACKER_FIRST);
  assert.deepEqual(m.reportOptions.slideOrder, COMPLIANCE_FIRST, 'reportOptions untouched');
  assert.deepEqual(slideOrderOf(m), TRACKER_FIRST, 'the temporary order wins');
  clearTempSlideOrder(st);
  overlayTempSlideOrder(m, st);
  assert.equal('slideOrder' in m, false, 'a carried-forward model loses the dropped order');
});

test('state: «تقرير جديد» (resetRunData) drops the temporary order; the field starts null', () => {
  resetRunData();
  assert.equal(appState.slideOrder, null);
  setTempSlideOrder(appState, TRACKER_FIRST);
  assert.ok(tempSlideOrder(appState));
  resetRunData();
  assert.equal(appState.slideOrder, null);
});

/* ------------------------------------------------------------------ *
 * The lifecycle through the review screen's real model path
 * ------------------------------------------------------------------ */

test('lifecycle: SURVIVES report-type switches, a scope change, a date change, a Settings visit and «رجوع»', () => {
  const state = loadedState();
  let m = reviewRender(state);
  setTempSlideOrder(state, TRACKER_FIRST); // a move on the card
  m = reviewRender(state);
  assert.deepEqual(m.slideOrder, TRACKER_FIRST);
  // Report type KAMC → SGH → KAMC + SGH → KAMC (setHospital: choice + scope reset + rerender).
  for (const h of ['sgh', 'both', 'kamc']) {
    state.reportHospital = h;
    state.scope = EMPTY_SCOPE; // setHospital: the scope goes with the old type
    m = reviewRender(state);
    assert.deepEqual(m.slideOrder, TRACKER_FIRST, `after switching to ${h}`);
  }
  // A scope (one shipment) and back to the full report.
  state.scope = { labs: [], shipments: ['ELAB800001'], from: null, to: null, shipmentSlide: true };
  m = reviewRender(state);
  assert.deepEqual(m.slideOrder, TRACKER_FIRST, 'after a scope change');
  // A report-date change (the debounced rerender rebuilds the figures).
  state.reportDate = '2026-10-07';
  m = reviewRender(state);
  assert.deepEqual(m.slideOrder, TRACKER_FIRST, 'after a date change');
  // A Settings visit that edits the SAVED order, then back to the review.
  const edited = { ...SETTINGS, reportOptions: { ...SETTINGS.reportOptions, slideOrder: COMPLIANCE_FIRST } };
  m = reviewRender(state, edited);
  assert.deepEqual(m.slideOrder, TRACKER_FIRST, 'the report keeps its own order');
  assert.deepEqual(m.reportOptions.slideOrder, COMPLIANCE_FIRST, 'the new saved order is what «استعادة» returns to');
  // «توليد» hands the model over (overlay again), «رجوع» renders the review again.
  overlayTempSlideOrder(m, state);
  state.reportModel = m;
  m = reviewRender(state, edited);
  assert.deepEqual(slideOrderOf(m), TRACKER_FIRST, 'after «رجوع» from generate');
});

test('lifecycle: RESETS on a new data load, «تقرير جديد» and the upload «متابعة» — back to the SAVED order', () => {
  const saved = { ...SETTINGS, reportOptions: { ...SETTINGS.reportOptions, slideOrder: COMPLIANCE_FIRST } };
  // A new load (live pull / CSV / snapshot / automation pull): the model is KEPT (the app-bar
  // home path) yet the order made on the old rows is gone.
  const state = loadedState();
  reviewRender(state, saved);
  setTempSlideOrder(state, TRACKER_FIRST);
  assert.deepEqual(reviewRender(state, saved).slideOrder, TRACKER_FIRST);
  takeOrders(state.parsed, rows());
  const after = reviewRender(state, saved);
  assert.equal('slideOrder' in after, false, 'no temporary order after a new load');
  assert.equal(state.slideOrder, null);
  assert.deepEqual(slideOrderOf(after), COMPLIANCE_FIRST, 'the latest SAVED order');
  // «متابعة» on the upload screen: the model is dropped and so is the order.
  setTempSlideOrder(state, TRACKER_FIRST);
  state.reportModel = null; clearTempSlideOrder(state); // screen-upload.js runEngineAndGo
  assert.deepEqual(slideOrderOf(reviewRender(state, saved)), COMPLIANCE_FIRST);
  // «تقرير جديد» is resetRunData (pinned on the app state above) — then a fresh load.
  resetRunData();
  setTempSlideOrder(appState, TRACKER_FIRST);
  resetRunData();
  takeOrders(appState.parsed, rows());
  appState.reportDate = DATE;
  appState.reportHospital = 'kamc';
  assert.deepEqual(slideOrderOf(reviewRender(appState, saved)), COMPLIANCE_FIRST);
  resetRunData();
});

test('the deck follows the order on screen: temporary when set, else saved; the temporary one never leaks into settings', () => {
  const state = loadedState();
  const saved = { ...SETTINGS, reportOptions: { ...SETTINGS.reportOptions, slideOrder: COMPLIANCE_FIRST } };
  const ids = (m) => buildSpec(m, { variant: 'internal' }).map((s) => s.id);
  let m = reviewRender(state, saved);
  assert.equal(ids(m)[1], 'compliance', 'the saved order: compliance first after the cover');
  setTempSlideOrder(state, ['monthly', ...SLIDE_ORDER_KEYS.filter((k) => k !== 'monthly')]);
  m = reviewRender(state, saved);
  const shown = ids(m);
  assert.equal(shown[0], 'cover');
  assert.equal(shown[1], 'monthly', 'the temporary order');
  assert.equal(shown[shown.length - 1], 'thanks');
  // Both variants (all four files) are built from this one model.
  assert.deepEqual(buildSpec(m, { variant: 'nupco' }).map((s) => s.id), shown);
  // A chip click while the temporary order is active: the merge keeps the STORED order.
  const doc = mergeReportOptions(saved.reportOptions, { ...m.reportOptions, slideOrder: m.slideOrder });
  assert.deepEqual(doc.slideOrder, COMPLIANCE_FIRST);
});

test('a direct jump to generate (no review model) uses the SAVED order', () => {
  const st = { reportDate: DATE, parsed: { tracker: null }, engineOutput: null };
  setTempSlideOrder(st, TRACKER_FIRST); // even if one were somehow set, the fallback has no overlay
  const fm = fallbackModel(st, { settings: { reportOptions: { slideOrder: COMPLIANCE_FIRST } } });
  assert.equal('slideOrder' in fm, false);
  assert.deepEqual(slideOrderOf(fm), COMPLIANCE_FIRST);
  assert.deepEqual(slideOrderOf(fallbackModel(st, { settings: {} })), SLIDE_ORDER_KEYS, 'nothing saved ⇒ default');
});

/* ------------------------------------------------------------------ *
 * persistReportOptions — the guard
 * ------------------------------------------------------------------ */

test('mergeReportOptions: slideOrder comes ONLY from the stored doc (present, absent, or differing)', () => {
  const ro = reportOptionsFromSettings({ reportOptions: { slideOrder: TRACKER_FIRST } });
  ro.slides.monthly = false;
  // Stored order kept, whatever the model carries.
  const kept = mergeReportOptions({ slideOrder: COMPLIANCE_FIRST, extra: 1 }, { ...ro, slideOrder: TRACKER_FIRST });
  assert.deepEqual(kept.slideOrder, COMPLIANCE_FIRST);
  assert.equal(kept.extra, 1, 'unknown stored keys survive');
  assert.equal(kept.slides.monthly, false, 'the chip itself is written');
  // Nothing stored ⇒ nothing written (absent = default), even when the model has an order.
  const none = mergeReportOptions({}, { ...ro, slideOrder: TRACKER_FIRST });
  assert.equal('slideOrder' in none, false);
  assert.equal('slideOrder' in mergeReportOptions(null, null), false);
  // The rest of the merge is the one persistReportOptions always made.
  const m = mergeReportOptions({ slides: { definitions: true }, kpiCards: { total: false }, labels: { a: 'x' } },
    { slides: { monthly: false }, kpiCards: {}, labels: { b: 'y' }, deltaMode: 'daily', autoDownloadFiles: false, trackerLang: 'en' });
  assert.deepEqual(m.slides, { definitions: true, monthly: false });
  assert.deepEqual(m.kpiCards, { total: false });
  assert.deepEqual(m.labels, { b: 'y' }, 'labels replace');
  assert.equal(m.deltaMode, 'daily');
  assert.equal(m.autoDownloadFiles, false);
  assert.equal(m.trackerLang, 'en');
});

test('reportOptionsFromSettings: the saved order only when stored (normalised); absent stays absent', () => {
  assert.equal('slideOrder' in reportOptionsFromSettings({}), false);
  assert.equal('slideOrder' in reportOptionsFromSettings({ reportOptions: { deltaMode: 'week' } }), false);
  assert.equal('slideOrder' in reportOptionsFromSettings({ reportOptions: { slideOrder: 'tracker' } }), false);
  assert.deepEqual(reportOptionsFromSettings({ reportOptions: { slideOrder: ['tracker', 'action', ...SLIDE_ORDER_KEYS] } }).slideOrder, TRACKER_FIRST);
});

test('the saved order round-trips the REAL store; a chip persist after it keeps it', () => {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k), clear: () => map.clear(),
  };
  store.__resetForTests();
  const doc = store.loadSettings();
  doc.reportOptions = withSavedSlideOrder(doc.reportOptions, TRACKER_FIRST); // «حفظ كترتيب ثابت»
  store.saveSettings(doc);
  store.__resetForTests(); // a reload
  assert.deepEqual(store.loadSettings().reportOptions.slideOrder, TRACKER_FIRST);
  // A chip click carrying a different (temporary) order on its model.
  const d2 = store.loadSettings();
  d2.reportOptions = mergeReportOptions(d2.reportOptions, { ...reportOptionsFromSettings(d2), slideOrder: COMPLIANCE_FIRST });
  store.saveSettings(d2);
  store.__resetForTests();
  assert.deepEqual(store.loadSettings().reportOptions.slideOrder, TRACKER_FIRST);
  // «الترتيب الافتراضي» saved ⇒ stored ABSENT.
  const d3 = store.loadSettings();
  d3.reportOptions = withSavedSlideOrder(d3.reportOptions, SLIDE_ORDER_KEYS);
  store.saveSettings(d3);
  store.__resetForTests();
  assert.equal('slideOrder' in store.loadSettings().reportOptions, false);
  store.__resetForTests();
  delete globalThis.localStorage;
});

/* ------------------------------------------------------------------ *
 * The card's pure planning
 * ------------------------------------------------------------------ */

test('units per report type: KAMC + SGH = exec + its toggles; KAMC / SGH all, shipments only when scoped to shipments', () => {
  assert.deepEqual(slideOrderUnitsFor('both'), ['execFunnel', 'monthly', 'sendout', 'compliance', 'tracker']);
  // Every unit of the main deck is the exec slide or a chip that deck offers.
  const bothChips = slideTogglesFor('both').map((t) => t.key);
  assert.ok(slideOrderUnitsFor('both').every((k) => k === 'execFunnel' || bothChips.includes(k)));
  for (const h of ['kamc', 'sgh']) {
    assert.deepEqual(slideOrderUnitsFor(h, undefined), SLIDE_ORDER_KEYS.filter((k) => k !== 'shipments'));
    assert.deepEqual(slideOrderUnitsFor(h, { labs: ['Lab Alpha'] }), SLIDE_ORDER_KEYS.filter((k) => k !== 'shipments'), 'a lab scope has no shipments slide');
    assert.deepEqual(slideOrderUnitsFor(h, { shipments: ['ELAB800001'] }), SLIDE_ORDER_KEYS);
  }
});

test('hidden units: chip off, shipment box off, definitions opt-in; the main deck never hides exec', () => {
  assert.equal(slideUnitHidden('monthly', { hospital: 'kamc', slides: { monthly: false } }), true);
  assert.equal(slideUnitHidden('monthly', { hospital: 'kamc', slides: {} }), false);
  assert.equal(slideUnitHidden('definitions', { hospital: 'kamc', slides: {} }), true, 'opt-in: absent = off');
  assert.equal(slideUnitHidden('definitions', { hospital: 'kamc', slides: { definitions: true } }), false);
  assert.equal(slideUnitHidden('execFunnel', { hospital: 'both', slides: { execFunnel: false } }), false);
  assert.equal(slideUnitHidden('execFunnel', { hospital: 'kamc', slides: { execFunnel: false } }), true);
  assert.equal(slideUnitHidden('shipments', { hospital: 'kamc', scope: { shipments: ['X'], shipmentSlide: false } }), true);
  assert.equal(slideUnitHidden('shipments', { hospital: 'kamc', scope: { shipments: ['X'] } }), false);
});

test('rows: the deck\'s units in the order in force; a hidden unit keeps its row and place; empty from the last preview', () => {
  const r = slideOrderRows({ hospital: 'both', slides: { compliance: false }, order: TRACKER_FIRST, present: new Set(['execFunnel', 'monthly']) });
  assert.deepEqual(r.map((x) => x.key), ['tracker', 'execFunnel', 'monthly', 'sendout', 'compliance']);
  const by = Object.fromEntries(r.map((x) => [x.key, x]));
  assert.equal(by.compliance.hidden, true);
  assert.equal(by.compliance.empty, false, 'hidden wins over empty');
  assert.equal(by.tracker.empty, true, 'on, but nothing rendered (no tracker document)');
  assert.equal(by.execFunnel.empty, false);
  assert.equal(by.tracker.label, STR.review.slideToggles.tracker);
  const before = slideOrderRows({ hospital: 'kamc', slides: {}, order: undefined });
  assert.ok(before.every((x) => x.empty === false), 'no preview yet ⇒ nothing marked empty');
});

test('status: saved vs temporary, the default tag and which buttons work', () => {
  const saved = slideOrderStatus({ temp: null, saved: undefined });
  assert.deepEqual(saved, { temporary: false, current: [...SLIDE_ORDER_KEYS], isDefault: true, canSave: false, canRestore: false, canReset: false });
  const savedCustom = slideOrderStatus({ temp: null, saved: TRACKER_FIRST });
  assert.equal(savedCustom.canReset, true, '«الترتيب الافتراضي» available on a custom saved order');
  assert.equal(savedCustom.canSave, false);
  const temp = slideOrderStatus({ temp: COMPLIANCE_FIRST, saved: TRACKER_FIRST });
  assert.equal(temp.temporary, true);
  assert.deepEqual(temp.current, COMPLIANCE_FIRST);
  assert.equal(temp.canSave && temp.canRestore && temp.canReset, true);
  // «الترتيب الافتراضي» on a custom saved order is a TEMPORARY default order.
  const def = slideOrderStatus({ temp: [...SLIDE_ORDER_KEYS], saved: TRACKER_FIRST });
  assert.equal(def.temporary && def.isDefault && def.canSave && !def.canReset, true);
});

test('save merge: only the DECIDED units take the current order; the rest are placed by the saved order', () => {
  // Saved: challenges first. Moves made on the KAMC + SGH deck only; tracker put first.
  // How an undecided unit is placed is model/slide-order.js mergeVisibleOrder's rule (core's,
  // pinned in slide-order.test.mjs) — here: that rule is what the save applies, the decided
  // units come out in the current sequence, and a unit that led the saved order still leads.
  const saved = ['challenges', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'tracker', 'definitions'];
  const current = ['tracker', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'challenges', 'definitions'];
  const both = slideOrderUnitsFor('both');
  const out = slideOrderToSave(saved, current, both);
  assert.deepEqual(out, mergeVisibleOrder(saved, current.filter((k) => both.includes(k))));
  assert.deepEqual(out.filter((k) => both.includes(k)), current.filter((k) => both.includes(k)));
  assert.equal(out[0], 'challenges', 'a unit no move decided keeps its saved place');
  // On a deck that shows every unit the current order is saved as it is.
  assert.deepEqual(slideOrderToSave(saved, current, SLIDE_ORDER_KEYS), current);
  // «الترتيب الافتراضي» then «حفظ»: the default whole — the hidden units included.
  assert.deepEqual(slideOrderToSave(TRACKER_FIRST, SLIDE_ORDER_KEYS, slideOrderUnitsFor('kamc')), SLIDE_ORDER_KEYS);
  assert.deepEqual(slideOrderToSave(saved, SLIDE_ORDER_KEYS, slideOrderUnitsFor('both')), SLIDE_ORDER_KEYS);
});

test('withSavedSlideOrder: a custom order is stored normalised; the default is stored ABSENT; input not mutated', () => {
  const ro = { deltaMode: 'week', slideOrder: TRACKER_FIRST };
  assert.deepEqual(withSavedSlideOrder(ro, ['compliance', 'nope', ...SLIDE_ORDER_KEYS]).slideOrder, COMPLIANCE_FIRST);
  const def = withSavedSlideOrder(ro, SLIDE_ORDER_KEYS);
  assert.equal('slideOrder' in def, false);
  assert.equal(def.deltaMode, 'week');
  assert.deepEqual(ro.slideOrder, TRACKER_FIRST, 'not mutated');
  assert.equal('slideOrder' in withSavedSlideOrder(undefined, undefined), false);
});

test('state: the DECIDED units accumulate over the temporary order\'s life; unknown = every unit; a new load starts afresh', () => {
  const st = { scopeEpoch: 2 };
  setTempSlideOrder(st, TRACKER_FIRST, ['tracker', 'execFunnel']);
  assert.deepEqual(tempSlideOrderUnits(st), ['tracker', 'execFunnel']);
  setTempSlideOrder(st, COMPLIANCE_FIRST, ['compliance', 'tracker']);
  assert.deepEqual(tempSlideOrderUnits(st), ['tracker', 'execFunnel', 'compliance'], 'a union, no duplicates');
  setTempSlideOrder(st, TRACKER_FIRST); // no units given ⇒ unknown ⇒ every unit from now on
  assert.equal(tempSlideOrderUnits(st), null);
  setTempSlideOrder(st, TRACKER_FIRST, ['tracker']);
  assert.equal(tempSlideOrderUnits(st), null, '…and it stays every unit');
  clearTempSlideOrder(st);
  assert.equal(tempSlideOrderUnits(st), null, 'no temporary order');
  setTempSlideOrder(st, TRACKER_FIRST, ['tracker']);
  st.scopeEpoch = 3; // a new load: the old order AND its units are gone
  setTempSlideOrder(st, COMPLIANCE_FIRST, ['compliance']);
  assert.deepEqual(tempSlideOrderUnits(st), ['compliance']);
});

test('save after a type switch: a move made on KAMC, saved from KAMC + SGH, keeps EVERY moved unit\'s place', () => {
  // The review's own steps: onMove = mergeVisibleOrder(slideOrderOf(model), nextShown) with
  // the deck's units as the decided ones; «حفظ» = slideOrderToSave(saved, current, decided).
  const saved = [...TRACKER_FIRST];
  const st = { scopeEpoch: 1 };
  const kamcUnits = slideOrderUnitsFor('kamc', EMPTY_SCOPE); // no shipments unit unscoped
  const m = { reportOptions: { slideOrder: saved } };
  const shown = slideOrderOf(m).filter((k) => kamcUnits.includes(k));
  setTempSlideOrder(st, mergeVisibleOrder(slideOrderOf(m), slideUnitToTop(shown, 'challenges')), kamcUnits);
  const current = tempSlideOrder(st);
  assert.deepEqual(current.filter((k) => k !== 'shipments').slice(0, 3), ['challenges', 'tracker', 'execFunnel']);
  // …switch to KAMC + SGH (the order survives), then «حفظ كترتيب ثابت» there.
  const out = slideOrderToSave(saved, current, tempSlideOrderUnits(st));
  assert.deepEqual(out, current, 'challenges stays first — not put back to its old saved place');
  // The bug this pins: the units of the deck on screen at SAVE time (KAMC + SGH) as the
  // decided ones — challenges / definitions would go back to their old saved places.
  assert.notEqual(slideOrderToSave(saved, current, slideOrderUnitsFor('both'))[0], 'challenges');
  // A unit no move ever showed, moved in Settings meanwhile, keeps its NEW saved slot.
  const settingsMoved = ['shipments', ...saved.filter((k) => k !== 'shipments')];
  const out2 = slideOrderToSave(settingsMoved, current, tempSlideOrderUnits(st));
  assert.equal(out2[0], 'shipments');
  assert.deepEqual(out2.filter((k) => k !== 'shipments'), current.filter((k) => k !== 'shipments'));
});

/* ------------------------------------------------------------------ *
 * The shared list widget's pure moves + labels
 * ------------------------------------------------------------------ */

test('moves: ▲ / ▼ swap neighbours, «إلى الأعلى» puts first; a no-op returns null', () => {
  const keys = ['execFunnel', 'monthly', 'compliance', 'tracker'];
  assert.deepEqual(moveSlideUnit(keys, 'tracker', -1), ['execFunnel', 'monthly', 'tracker', 'compliance']);
  assert.deepEqual(moveSlideUnit(keys, 'execFunnel', +1), ['monthly', 'execFunnel', 'compliance', 'tracker']);
  assert.equal(moveSlideUnit(keys, 'execFunnel', -1), null);
  assert.equal(moveSlideUnit(keys, 'tracker', +1), null);
  assert.equal(moveSlideUnit(keys, 'nope', -1), null);
  assert.deepEqual(slideUnitToTop(keys, 'tracker'), ['tracker', 'execFunnel', 'monthly', 'compliance']);
  assert.equal(slideUnitToTop(keys, 'execFunnel'), null);
  assert.deepEqual(keys, ['execFunnel', 'monthly', 'compliance', 'tracker'], 'input untouched');
});

test('every unit has an Arabic name: the chip label, else the card\'s own two', () => {
  for (const k of SLIDE_ORDER_KEYS) {
    const label = slideOrderLabel(k);
    assert.ok(label && label !== k, k);
    if (STR.review.slideToggles[k]) assert.equal(label, STR.review.slideToggles[k]);
  }
  assert.equal(slideOrderLabel('shipments'), 'تفاصيل الشحنات');
  assert.equal(slideOrderLabel('definitions'), 'منهجية الأرقام');
  // Every slide id a deck emits maps onto a labelled unit (or is the cover / thanks).
  for (const id of ['execFunnel', 'shipments-cont-2', 'sendoutLabs', 'tracker-cont-1', 'definitions']) {
    assert.ok(SLIDE_ORDER_KEYS.includes(unitOfSlideId(id)), id);
  }
});

/* ------------------------------------------------------------------ *
 * Settings — the SAVED order editor
 * ------------------------------------------------------------------ */

test('Settings rows: every unit in the saved order, the switched-off ones marked, hints from ar.js', () => {
  const r = savedSlideOrderRows({ slideOrder: TRACKER_FIRST, slides: { monthly: false } });
  assert.deepEqual(r.map((x) => x.key), TRACKER_FIRST);
  const by = Object.fromEntries(r.map((x) => [x.key, x]));
  assert.equal(by.monthly.hidden, true);
  assert.equal(by.definitions.hidden, true, 'opt-in, not turned on');
  assert.equal(by.shipments.hidden, false, 'no switch in Settings — the scope decides');
  assert.equal(by.sendout.hint, STR.review.slideOrder.settingsHints.sendout);
  assert.deepEqual(savedSlideOrderRows(undefined).map((x) => x.key), SLIDE_ORDER_KEYS, 'absent ⇒ default');
});

test('Settings writes: a move stores the order; the default is stored ABSENT', () => {
  const ro = {};
  setSavedSlideOrder(ro, COMPLIANCE_FIRST);
  assert.deepEqual(ro.slideOrder, COMPLIANCE_FIRST);
  setSavedSlideOrder(ro, SLIDE_ORDER_KEYS);
  assert.equal('slideOrder' in ro, false);
});
