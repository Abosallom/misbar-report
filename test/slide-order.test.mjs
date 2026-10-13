// test/slide-order.test.mjs — `node --test test/slide-order.test.mjs`
//
// SLIDE ORDER (model/slide-order.js + the two spec builders). The operator can move a
// content-slide UNIT (e.g. the tracker first), save the order as the fixed one
// (settings.reportOptions.slideOrder) or use it for ONE report (model.slideOrder). This
// suite pins:
//   • the pure module — normalisation (unknown / duplicate / missing / retired 'action'),
//     the stable defs sort, the model's precedence (one-report > saved > default), the
//     slide-id → unit map and mergeVisibleOrder (a reorder made on a deck that lacks some
//     units must not move them);
//   • the decks — a multi-page unit moves as ONE block, page numbers run 1..n in the new
//     order, cover first / thanks last, a toggled-off unit keeps its place in the order,
//     definitions stays opt-in wherever it sits, both variants alike — for every deck type
//     (KAMC, SGH, KAMC+SGH);
//   • the invariant: the default order spelled out is the same deck as no order at all.
// (The byte-identity against the pre-feature tree is proven outside the suite, against a
// fresh `git archive HEAD`; build-spec-both / scope / store / pipeline cases live in their
// own suites.)
// SYNTHETIC rows only: order ids, labs and tests are made up; the hospital name/id pairs are
// the source's own spellings (organisations, not patients).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SLIDE_ORDER_KEYS, DEFAULT_SLIDE_ORDER, SLIDE_ORDER_MAX, normalizeSlideOrder, orderUnits, slideOrderOf,
  unitOfSlideId, mergeVisibleOrder, sameSlideOrder, isDefaultSlideOrder,
} from '../src/model/slide-order.js';
import { buildSpec } from '../src/slidespec/build-spec.js';
import { buildHospitalModel, stampHospitalDeltas, buildBothModel } from '../src/model/hospital-report.js';
import { normalizeScope } from '../src/model/scope.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';

const VARIANTS = ['internal', 'nupco'];
const ids = (spec) => spec.map((s) => s.id);
const pageOf = (s) => s.elements.at(-1).text;
/** Unit sequence of a deck: content slides collapsed onto their unit (one entry per block). */
const unitsOf = (spec) => {
  const out = [];
  for (const s of spec.slice(1, -1)) { const u = unitOfSlideId(s.id); if (out.at(-1) !== u) out.push(u); }
  return out;
};
/** cover first, thanks last, page numbers 1..n over the content slides, every block contiguous. */
function assertDeckShape(spec, label) {
  assert.equal(spec[0].id, 'cover', `${label}: cover first`);
  assert.equal(spec.at(-1).id, 'thanks', `${label}: thanks last`);
  const content = spec.slice(1, -1);
  assert.deepEqual(content.map(pageOf), content.map((_, i) => String(i + 1)), `${label}: pages 1..n`);
  const u = unitsOf(spec);
  assert.equal(new Set(u).size, u.length, `${label}: each unit is one contiguous block (${ids(spec).join(',')})`);
  for (const s of [spec[0], spec.at(-1)]) {
    assert.ok(!s.elements.some((e) => e.t === 'text' && e.y === 7.15), `${label}: ${s.id} carries no page number`);
  }
}

// ---- fixtures ------------------------------------------------------------------------------
const KAMC = { orderingFacilityId: '31763', hospital: 'King Abdul ah Medical City' };
const SGH = { orderingFacilityId: '1037', hospital: 'Saudi German Hospital Alzahraa Branch' };
let seq = 0;
const row = (h, facility, testName, od, over = {}) => {
  seq += 1;
  const d = (x) => (x ? `${x} 00:00:00` : null);
  return {
    orderDate: d(od), facility, orderId: `8${String(seq).padStart(5, '0')}`, lineNo: seq, loinc: null, testName,
    collected: d(over.col), dispatched: d(over.dis), received: d(over.rec), resulted: d(over.res),
    rawStatus: over.status || 'Order Created', tatDaysCsv: over.tatCsv ?? null, specimenNo: null,
    shipmentId: over.ship ?? null, performingFacilityId: null, ...h,
  };
};
const DATE = '2026-10-08';
const SETTINGS = {
  tatLookup: { 'Assay K': 2 },
  historicalConstants: { cancelledByMonth: { '2026-01': 2 } },
  reportOptions: { excludeNoTat: false, deltaMode: 'week', kpiCards: { turnaround: true } },
};
const MASTER = [
  { vendor: 'Lab Alpha', country: 'Germany', reflab: 'Ref A', item: 'Assay K' },
  { vendor: 'Lab Beta', country: 'Saudi Arabia', reflab: 'Ref B', item: 'Assay K' },
];
const kamcRows = () => [
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-09-01', { col: '2026-09-01', dis: '2026-09-01', rec: '2026-09-02', status: 'Specimen Courier Received', ship: 'SH1' }),
  row(KAMC, 'Lab Beta', 'Assay K', '2026-10-06', { col: '2026-10-06', dis: '2026-10-06', status: 'Shipment Dispatched', ship: 'SH2' }),
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-04', { col: '2026-10-04', dis: '2026-10-04', rec: '2026-10-05', res: '2026-10-07', status: 'Result Approved' }),
];
const sghRows = () => [
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-05', { col: '2026-10-05', dis: '2026-10-05', rec: '2026-10-06', res: '2026-10-07', status: 'Result Approved' }),
  row(SGH, 'Saudi Diagnostics Limited Company', 'Assay K', '2026-10-04', { col: '2026-10-04', dis: '2026-10-04', rec: '2026-10-05', status: 'Specimen Courier Received' }),
];
const TRACKER = MOCK_REPORT_MODEL.projectTracker; // two «متابعة المشروع» pages
const detail = (id, n) => ({
  id, labs: ['Lab A'], lines: n, orders: n, dispatched: '2026-09-12', received: '2026-09-15',
  counts: { notShipped: 0, inTransit: 0, awaitingResult: 0, completed: n, rejected: 0, cancelled: 0 }, status: 'completed',
});
const DETAILS = Array.from({ length: 13 }, (_, i) => detail(`ELAB${626000 + i}`, 1)); // 12 + 1 → two pages

/** A single-hospital model that emits EVERY unit (scoped with shipments, send-out, tracker, challenges, definitions). */
function hospitalModel(hospital, rows, ro = {}, { scoped = true } = {}) {
  const m = buildHospitalModel({ hospital, rows, settings: SETTINGS, reportDate: DATE, tracker: TRACKER, sendoutMaster: MASTER });
  stampHospitalDeltas(m, { rows, settings: SETTINGS });
  m.reportOptions = { ...SETTINGS.reportOptions, slides: { definitions: true }, ...ro };
  m.overrides = {};
  m.challenges = MOCK_REPORT_MODEL.challenges;
  m.risks = MOCK_REPORT_MODEL.risks;
  if (scoped) {
    m.scope = normalizeScope({ labs: [], shipments: DETAILS.map((d) => d.id), from: null, to: null, shipmentSlide: true });
    m.shipmentDetails = DETAILS;
  }
  return m;
}
const bothModel = (ro = {}) => buildBothModel({
  kamcRows: kamcRows(), sghRows: sghRows(), reportDate: DATE, tracker: TRACKER, sendoutMaster: MASTER,
  settings: { ...SETTINGS, reportOptions: { ...SETTINGS.reportOptions, ...ro } },
});
/** Every deck type, as fresh models. */
const DECKS = {
  'KAMC (mock, unscoped)': () => structuredClone(MOCK_REPORT_MODEL),
  'KAMC (scoped, every unit)': () => hospitalModel('kamc', kamcRows()),
  'SGH (scoped, every unit)': () => hospitalModel('sgh', sghRows()),
  'SGH (unscoped)': () => hospitalModel('sgh', sghRows(), {}, { scoped: false }),
  'KAMC+SGH (main deck)': () => bothModel(),
};
const withSaved = (m, slideOrder) => ({ ...m, reportOptions: { ...(m.reportOptions || {}), slideOrder } });
const REVERSED = [...SLIDE_ORDER_KEYS].reverse();

// ---- the pure module -----------------------------------------------------------------------

test('SLIDE_ORDER_KEYS: the eight units, frozen, no retired \'action\' — and it IS today\'s deck order', () => {
  assert.deepEqual([...SLIDE_ORDER_KEYS], ['execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'tracker', 'challenges', 'definitions']);
  assert.ok(Object.isFrozen(SLIDE_ORDER_KEYS));
  assert.equal(DEFAULT_SLIDE_ORDER, SLIDE_ORDER_KEYS);
  assert.ok(!SLIDE_ORDER_KEYS.includes('action'));
  assert.ok(SLIDE_ORDER_MAX >= SLIDE_ORDER_KEYS.length);
  // A deck that emits every unit, built with NO order, walks the units in exactly this order.
  for (const variant of VARIANTS) {
    assert.deepEqual(unitsOf(buildSpec(hospitalModel('kamc', kamcRows()), { variant })), [...SLIDE_ORDER_KEYS], variant);
  }
});

test('normalizeSlideOrder: a non-list is the default (a fresh copy)', () => {
  for (const v of [undefined, null, 'tracker', 42, { 0: 'tracker' }, true]) {
    const o = normalizeSlideOrder(v);
    assert.deepEqual(o, [...SLIDE_ORDER_KEYS], JSON.stringify(v));
    assert.notEqual(o, SLIDE_ORDER_KEYS, 'a copy, never the frozen constant');
  }
});

test('normalizeSlideOrder: unknown, duplicate, non-string and the retired \'action\' are dropped', () => {
  assert.deepEqual(
    normalizeSlideOrder(['tracker', 'action', 'tracker', 'Tracker', 'bogus', 3, null, { k: 1 },
      'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'challenges', 'definitions', 'execFunnel']),
    ['tracker', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'challenges', 'definitions'],
  );
  // A legacy list that only knew 'action' (the old «المهام» slide) reads as the default.
  assert.deepEqual(normalizeSlideOrder(['action']), [...SLIDE_ORDER_KEYS]);
  assert.deepEqual(normalizeSlideOrder([]), [...SLIDE_ORDER_KEYS]);
});

test('normalizeSlideOrder: a missing unit goes back to its DEFAULT neighbourhood (lead stays first, trail stays last)', () => {
  // The spec's own example: the units after 'tracker' in the default (challenges,
  // definitions) TRAIL it — they stay at the end, they do not follow the tracker to the front.
  assert.deepEqual(normalizeSlideOrder(['tracker', 'execFunnel']),
    ['tracker', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'challenges', 'definitions']);
  // A saved order from before a unit existed (here: no 'challenges'): it is not a trailing
  // unit, so it lands behind 'tracker', its default predecessor, wherever the tracker went.
  const noChallenges = ['tracker', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'definitions'];
  assert.deepEqual(normalizeSlideOrder(noChallenges),
    ['tracker', 'challenges', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'definitions']);
  // Units that LEAD the default before the first listed one stay first; a list in default
  // relative order is the default.
  assert.deepEqual(normalizeSlideOrder(['monthly', 'tracker']), [...SLIDE_ORDER_KEYS]);
  assert.deepEqual(normalizeSlideOrder(['compliance', 'monthly']),
    ['execFunnel', 'shipments', 'compliance', 'monthly', 'sendout', 'tracker', 'challenges', 'definitions']);
  assert.deepEqual(normalizeSlideOrder(['definitions', 'execFunnel']),
    ['definitions', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'tracker', 'challenges']);
});

test('normalizeSlideOrder: always a permutation that keeps the listed units\' relative order; idempotent', () => {
  const pool = [...SLIDE_ORDER_KEYS, 'action', 'bogus', '', 7];
  let s = 12345;
  const rnd = (n) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
  for (let t = 0; t < 400; t++) {
    const input = Array.from({ length: rnd(14) }, () => pool[rnd(pool.length)]);
    const o = normalizeSlideOrder(input);
    assert.deepEqual([...o].sort(), [...SLIDE_ORDER_KEYS].sort(), `permutation of ${JSON.stringify(input)}`);
    const listed = [];
    for (const k of input) if (SLIDE_ORDER_KEYS.includes(k) && !listed.includes(k)) listed.push(k);
    assert.deepEqual(o.filter((k) => listed.includes(k)), listed, 'listed units keep their order');
    assert.deepEqual(normalizeSlideOrder(o), o, 'idempotent');
  }
});

test('sameSlideOrder / isDefaultSlideOrder compare after normalisation (absent = default)', () => {
  assert.ok(isDefaultSlideOrder(undefined));
  assert.ok(isDefaultSlideOrder([...SLIDE_ORDER_KEYS, 'action']));
  assert.ok(!isDefaultSlideOrder(REVERSED));
  assert.ok(sameSlideOrder(['tracker', 'execFunnel'], ['tracker', 'execFunnel', 'bogus']));
  assert.ok(!sameSlideOrder(['tracker', 'execFunnel'], undefined));
});

test('orderUnits: a stable sort of defs; the default order is the identity; unknown keys trail; input untouched', () => {
  const defs = SLIDE_ORDER_KEYS.map((key) => ({ key }));
  const same = orderUnits(defs, undefined);
  assert.notEqual(same, defs, 'a new array');
  same.forEach((d, i) => assert.equal(d, defs[i], 'same objects, same sequence'));
  assert.deepEqual(orderUnits(defs, REVERSED).map((d) => d.key), REVERSED);
  assert.deepEqual(defs.map((d) => d.key), [...SLIDE_ORDER_KEYS], 'the input array is not reordered');
  // A deck with a subset (the main deck) and a def no order knows about.
  const sub = [{ key: 'execFunnel' }, { key: 'extra', n: 1 }, { key: 'monthly' }, { key: 'tracker' }, { key: 'extra', n: 2 }];
  assert.deepEqual(orderUnits(sub, ['tracker', 'monthly', 'execFunnel']).map((d) => d.n ?? d.key), ['tracker', 'monthly', 'execFunnel', 1, 2]);
});

test('slideOrderOf: the one-report order beats the saved one, which beats the default', () => {
  const saved = ['compliance', 'execFunnel'];
  const temp = ['tracker', 'execFunnel'];
  assert.deepEqual(slideOrderOf(undefined), [...SLIDE_ORDER_KEYS]);
  assert.deepEqual(slideOrderOf({}), [...SLIDE_ORDER_KEYS]);
  assert.deepEqual(slideOrderOf({ reportOptions: { slideOrder: saved } }), normalizeSlideOrder(saved));
  assert.deepEqual(slideOrderOf({ slideOrder: temp, reportOptions: { slideOrder: saved } }), normalizeSlideOrder(temp));
  assert.deepEqual(slideOrderOf({ slideOrder: null, reportOptions: { slideOrder: saved } }), normalizeSlideOrder(saved), 'a non-list temp is no temp');
});

test('unitOfSlideId: multi-page units collapse onto one key; cover / thanks / unknown → null', () => {
  const cases = {
    execFunnel: 'execFunnel', shipments: 'shipments', 'shipments-cont-1': 'shipments', 'shipments-cont-12': 'shipments',
    monthly: 'monthly', sendoutCountries: 'sendout', sendoutLabs: 'sendout', compliance: 'compliance',
    tracker: 'tracker', 'tracker-cont-1': 'tracker', 'tracker-cont-3': 'tracker', challenges: 'challenges',
    definitions: 'definitions', cover: null, thanks: null, action: null, 'tracker-cont-': null, sendout: 'sendout', '': null,
  };
  for (const [id, want] of Object.entries(cases)) assert.equal(unitOfSlideId(id), want, id);
  assert.equal(unitOfSlideId(undefined), null);
});

test('mergeVisibleOrder: the visible units take their new sequence; hidden units keep their NEIGHBOURHOOD', () => {
  // The KAMC + SGH deck shows 5 units; the operator puts the tracker first there. shipments
  // stays right behind the executive summary; challenges / definitions trail, so stay last.
  const bothVisible = ['tracker', 'execFunnel', 'monthly', 'sendout', 'compliance'];
  assert.deepEqual(mergeVisibleOrder(undefined, bothVisible),
    ['tracker', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'challenges', 'definitions']);
  // The review case: an unscoped main deck (no shipments) with monthly moved to the top, saved,
  // then a shipment-scoped deck: the shipments details still follow the executive summary —
  // never ahead of it (a slot rule left shipments at index 1, i.e. before execFunnel).
  const monthlyTop = mergeVisibleOrder(undefined,
    ['monthly', 'execFunnel', 'sendout', 'compliance', 'tracker', 'challenges', 'definitions']);
  assert.deepEqual(monthlyTop, ['monthly', 'execFunnel', 'shipments', 'sendout', 'compliance', 'tracker', 'challenges', 'definitions']);
  assert.equal(monthlyTop.indexOf('shipments'), monthlyTop.indexOf('execFunnel') + 1);
  // From a custom saved order: a hidden unit that LEADS stays first, the others follow the unit
  // they followed in the saved order, wherever it moved.
  const saved = ['definitions', 'execFunnel', 'challenges', 'monthly', 'shipments', 'sendout', 'compliance', 'tracker'];
  const merged = mergeVisibleOrder(saved, ['compliance', 'monthly', 'execFunnel', 'tracker', 'sendout']);
  assert.deepEqual(merged, ['definitions', 'compliance', 'monthly', 'shipments', 'execFunnel', 'challenges', 'tracker', 'sendout']);
  // A hidden run after the LAST visible unit of the saved order stays at the end.
  assert.deepEqual(mergeVisibleOrder(['execFunnel', 'tracker', 'challenges', 'definitions'], ['tracker', 'execFunnel']),
    ['tracker', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'challenges', 'definitions']);
  // Unchanged visible sequence → unchanged order; every unit visible → exactly the new order.
  assert.deepEqual(mergeVisibleOrder(saved, ['execFunnel', 'monthly', 'sendout', 'compliance', 'tracker']), saved);
  assert.deepEqual(mergeVisibleOrder(saved, REVERSED), REVERSED);
  // Unknown / duplicate / retired names in the visible list are ignored; nothing visible → as is.
  assert.deepEqual(mergeVisibleOrder(undefined, ['tracker', 'action', 'tracker', 'bogus', 'execFunnel']),
    ['tracker', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'challenges', 'definitions']);
  assert.deepEqual(mergeVisibleOrder(undefined, 'junk'), [...SLIDE_ORDER_KEYS]);
  assert.deepEqual(mergeVisibleOrder(saved, []), saved);
  // Always a permutation that puts the visible units exactly in their new sequence.
  // A hidden unit whose base predecessor is visible (and not the last visible one) sits right
  // behind it; one with no visible unit before it stays in the leading block.
  let s = 777;
  const rnd = (n) => { s = (s * 1103515245 + 12345) % 2147483648; return (s >>> 8) % n; };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (let t = 0; t < 300; t++) {
    const base = shuffle([...SLIDE_ORDER_KEYS]);
    const vis = shuffle(SLIDE_ORDER_KEYS.filter(() => rnd(2)));
    const out = mergeVisibleOrder(base, vis);
    assert.deepEqual([...out].sort(), [...SLIDE_ORDER_KEYS].sort());
    assert.deepEqual(out.filter((k) => vis.includes(k)), vis);
    const lastVis = [...base].reverse().find((k) => vis.includes(k));
    base.forEach((k, i) => {
      if (vis.includes(k) || i === 0) return;
      const prev = base[i - 1];
      if (prev !== lastVis) assert.equal(out.indexOf(k), out.indexOf(prev) + 1, `${k} stays behind ${prev}`);
    });
  }
});

// ---- the decks -----------------------------------------------------------------------------

test('KAMC: the tracker first — its pages move as one block, numbered 1..n in the new order', () => {
  for (const variant of VARIANTS) {
    const spec = buildSpec(withSaved(structuredClone(MOCK_REPORT_MODEL), ['tracker', 'execFunnel']), { variant });
    assert.deepEqual(ids(spec), ['cover', 'tracker', 'tracker-cont-1', 'execFunnel', 'monthly', 'compliance', 'challenges', 'thanks']);
    assert.deepEqual(spec.slice(1, -1).map(pageOf), ['1', '2', '3', '4', '5', '6']);
    assertDeckShape(spec, variant);
  }
  // The full list written out (what the UI saves) is the same deck; challenges put right
  // behind the tracker stays there.
  const full = ['tracker', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'challenges', 'definitions'];
  assert.deepEqual(ids(buildSpec(withSaved(structuredClone(MOCK_REPORT_MODEL), full))),
    ['cover', 'tracker', 'tracker-cont-1', 'execFunnel', 'monthly', 'compliance', 'challenges', 'thanks']);
  const glued = ['tracker', 'challenges', 'execFunnel', 'shipments', 'monthly', 'sendout', 'compliance', 'definitions'];
  assert.deepEqual(ids(buildSpec(withSaved(structuredClone(MOCK_REPORT_MODEL), glued))),
    ['cover', 'tracker', 'tracker-cont-1', 'challenges', 'execFunnel', 'monthly', 'compliance', 'thanks']);
});

test('EVERY deck type follows a reversed order: blocks intact, cover first, thanks last, pages 1..n, variants alike', () => {
  for (const [name, make] of Object.entries(DECKS)) {
    const plain = unitsOf(buildSpec(make()));
    const specs = VARIANTS.map((variant) => buildSpec(withSaved(make(), REVERSED), { variant }));
    for (const [i, spec] of specs.entries()) {
      assertDeckShape(spec, `${name} ${VARIANTS[i]}`);
      assert.deepEqual(unitsOf(spec), [...plain].reverse(), `${name}: the deck's own units, reversed`);
    }
    assert.deepEqual(ids(specs[1]), ids(specs[0]), `${name}: internal and NUPCO in the same order`);
    // Each slide's CONTENT is unchanged by the move — only the page number differs.
    const before = buildSpec(make());
    for (const s of specs[0].slice(1, -1)) {
      const old = before.find((x) => x.id === s.id);
      assert.deepEqual(s.elements.slice(0, -1), old.elements.slice(0, -1), `${name}: ${s.id} content`);
    }
  }
});

test('the default order written out is the SAME deck as no order (every deck type, both variants)', () => {
  for (const [name, make] of Object.entries(DECKS)) {
    for (const variant of VARIANTS) {
      const plain = JSON.stringify(buildSpec(make(), { variant }));
      assert.equal(JSON.stringify(buildSpec(withSaved(make(), [...SLIDE_ORDER_KEYS]), { variant })), plain, `${name} ${variant}: saved default`);
      assert.equal(JSON.stringify(buildSpec({ ...make(), slideOrder: [...SLIDE_ORDER_KEYS] }, { variant })), plain, `${name} ${variant}: one-report default`);
      assert.equal(JSON.stringify(buildSpec(withSaved(make(), ['action', 'bogus']), { variant })), plain, `${name} ${variant}: junk-only order`);
    }
  }
});

test('the one-report order (model.slideOrder) wins over the saved one; without it the saved one applies', () => {
  for (const [name, make] of Object.entries(DECKS)) {
    const saved = withSaved(make(), REVERSED);
    const temp = { ...saved, slideOrder: ['tracker', 'compliance'] };
    const want = normalizeSlideOrder(['tracker', 'compliance']);
    const got = unitsOf(buildSpec(temp));
    assert.deepEqual(got, want.filter((k) => got.includes(k)), `${name}: the temporary order`);
    assert.deepEqual(unitsOf(buildSpec(saved)), [...unitsOf(buildSpec(make()))].reverse(), `${name}: the saved order`);
  }
});

test('a toggled-off unit keeps its place: switching it off and on again never moves anything', () => {
  const order = ['compliance', 'tracker', 'execFunnel', 'shipments', 'monthly', 'sendout', 'challenges', 'definitions'];
  for (const [name, make] of Object.entries(DECKS)) {
    const on = buildSpec(withSaved(make(), order));
    const offModel = withSaved(make(), order);
    offModel.reportOptions = { ...offModel.reportOptions, slides: { ...(offModel.reportOptions.slides || {}), tracker: false } };
    const off = buildSpec(offModel);
    assertDeckShape(off, name);
    assert.deepEqual(ids(off), ids(on).filter((id) => unitOfSlideId(id) !== 'tracker'), `${name}: the rest keeps its order, no gap`);
    assert.deepEqual(slideOrderOf(offModel), order, `${name}: the order itself still lists the tracker`);
  }
});

test('definitions stays OPT-IN wherever it sits; switched on, it renders in its slot', () => {
  const order = ['definitions', 'execFunnel'];
  const off = buildSpec(withSaved(structuredClone(MOCK_REPORT_MODEL), order));
  assert.ok(!ids(off).includes('definitions'), 'absent flag → no definitions slide, even when ordered first');
  const m = withSaved(structuredClone(MOCK_REPORT_MODEL), order);
  m.reportOptions.slides = { ...(m.reportOptions.slides || {}), definitions: true };
  const spec = buildSpec(m);
  assert.equal(spec[1].id, 'definitions');
  assertDeckShape(spec, 'definitions first');
});

test('the main deck: exec is always on, even switched off and moved; units it lacks are skipped silently', () => {
  for (const variant of VARIANTS) {
    const spec = buildSpec(withSaved(bothModel({ slides: { execFunnel: false } }), ['challenges', 'tracker', 'shipments', 'definitions', 'compliance', 'execFunnel', 'monthly', 'sendout']), { variant });
    assert.deepEqual(ids(spec), ['cover', 'tracker', 'tracker-cont-1', 'compliance', 'execFunnel', 'monthly', 'sendoutCountries', 'sendoutLabs', 'thanks']);
    assertDeckShape(spec, variant);
  }
});

test('a reorder never mutates the model it was handed', () => {
  const m = withSaved(hospitalModel('kamc', kamcRows()), REVERSED);
  const before = structuredClone(m);
  buildSpec(m);
  buildSpec({ ...m, slideOrder: ['tracker'] });
  assert.deepEqual(m, before);
});
