// test/scope-slides.test.mjs — `node --test test/scope-slides.test.mjs`
//
// THE DECK SIDE OF A SCOPED REPORT (build-spec, contract [F]). A scope narrows the ORDER
// ROWS before any number exists (model/scope.js), so nothing here checks a number — the
// engine already computed them from the narrowed rows. What build-spec adds is
// DISCLOSURE, so a side report can never pass for the full one:
//   • the cover's date line becomes 'الفترة: …' when a range is active, and one extra
//     'النطاق: …' line names the labs / the count of shipments that have rows in scope;
//   • a 'تقرير مخصص' pill on the cover (above the title) and in the footer strip of every
//     CONTENT slide — its box overlapping no other element's box, on any slide;
//   • an opt-out 'تفاصيل الشحنات' slide follows the exec slide when the scope names
//     shipments, paginated at 12 rows at most and fewer when rows wrap (a height budget),
//     so no page runs past the content floor.
// And the invariant everything else hangs on: with NO scope, the spec is byte-for-byte
// what it was before scope existed — the automation's model has no `scope` at all, and
// its published deck must not move by one element.
//
// Lab names in the fixtures below are INVENTED (the repo is public).
//
// The shared fixture is CLONED for every model (structuredClone) and never mutated; the
// last case proves it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSpec, DEFAULT_LABELS, LABEL_NAMES } from '../src/slidespec/build-spec.js';
import { EMPTY_SCOPE, normalizeScope, applyScope, shipmentDetails } from '../src/model/scope.js';
import { formatRangeAr } from '../src/i18n/ar.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';

const PRISTINE = structuredClone(MOCK_REPORT_MODEL);
const clone = () => structuredClone(MOCK_REPORT_MODEL);
const TAG = 'تقرير مخصص';
const VARIANTS = ['internal', 'nupco'];

/** A review-screen-shaped model: normalised scope + the details the slide reads. */
function scoped(scope, details = [], extra = {}) {
  const s = normalizeScope(scope);
  return { ...clone(), ...extra, scope: s, shipmentDetails: details, reportDate: s.to || '2026-09-23' };
}
const build = (m, variant = 'internal') => buildSpec(m, { variant });
const texts = (slide) => slide.elements.filter((e) => e.t === 'text').map((e) => e.text);
const slideById = (spec, id) => {
  const s = spec.find((x) => x.id === id);
  assert.ok(s, `slide '${id}' is missing (have: ${spec.map((x) => x.id).join(', ')})`);
  return s;
};
const tableOf = (slide) => slide.elements.find((e) => e.t === 'table');
const cellText = (c) => (c && typeof c === 'object' ? c.text : c);
/** Table rows back in LOGICAL (RTL reading) order: [id, lab, lines, dispatched, received, status]. */
const logical = (row) => row.slice().reverse();

/** One shipmentDetails() row. status = the single non-zero bucket, else 'mixed'. */
function detail(id, counts, extra = {}) {
  const c = { notShipped: 0, inTransit: 0, awaitingResult: 0, completed: 0, rejected: 0, cancelled: 0, ...counts };
  const live = ['notShipped', 'inTransit', 'awaitingResult', 'completed', 'cancelled'].filter((k) => c[k] > 0);
  const lines = live.reduce((s, k) => s + c[k], 0);
  return {
    id, labs: ['Lab A'], lines, orders: lines, dispatched: '2026-09-12', received: '2026-09-15',
    counts: c, status: live.length === 1 ? live[0] : 'mixed', ...extra,
  };
}
const ids = (n) => Array.from({ length: n }, (_, i) => `ELAB${String(626000 + i)}`);
/** A parsed order row (ingest shape) — for the end-to-end cases through applyScope. */
const orderRow = (o) => ({
  orderDate: '2026-09-12 00:00:00', facility: 'Lab A', orderId: o.id, lineNo: 1, loinc: null, testName: 'T',
  collected: '2026-09-12 08:00:00', dispatched: null, received: null, resulted: null,
  rawStatus: 'In Progress', tatDaysCsv: null, shipmentId: o.ship, ...o.f,
});
/** The 'تقرير مخصص' pill: its text element and the filled rect drawn right before it. */
function pillsOf(slide) {
  const out = [];
  slide.elements.forEach((e, i) => { if (e.t === 'text' && e.text === TAG) out.push({ text: e, bg: slide.elements[i - 1] }); });
  return out;
}

// ---- the invariant -------------------------------------------------------------------

test('UNSCOPED: an empty scope and no shipment details leave the spec deep-equal, both variants', () => {
  for (const variant of VARIANTS) {
    const plain = build(clone(), variant);
    const emptyScoped = build({ ...clone(), scope: { labs: [], shipments: [], from: null, to: null, shipmentSlide: true }, shipmentDetails: [], scopedRows: [] }, variant);
    const frozen = build({ ...clone(), scope: EMPTY_SCOPE }, variant);
    assert.deepEqual(emptyScoped, plain, `${variant}: EMPTY_SCOPE-equivalent must not change the spec`);
    assert.deepEqual(frozen, plain, `${variant}: the frozen EMPTY_SCOPE must not change the spec`);
    // Byte-level too: deepEqual ignores nothing that matters, but the published files are
    // serialised from exactly this, so pin the serialisation.
    assert.equal(JSON.stringify(emptyScoped), JSON.stringify(plain));
  }
});

test('UNSCOPED: slide ids are the historic deck, with no tag and no shipments slide', () => {
  for (const variant of VARIANTS) {
    const spec = build({ ...clone(), scope: EMPTY_SCOPE, shipmentDetails: [detail('ELAB1', { completed: 2 })] }, variant);
    // The mock has no send-out figures and definitions is opt-in, so this is the default
    // seven-slide deck. Stale shipmentDetails without a scope must not summon the slide.
    assert.deepEqual(spec.map((s) => s.id), ['cover', 'execFunnel', 'monthly', 'compliance', 'action', 'challenges', 'thanks']);
    for (const s of spec) assert.ok(!texts(s).includes(TAG), `${s.id}: no scoped pill on an unscoped deck`);
    assert.ok(texts(spec[0]).some((t) => t.startsWith('تاريخ التقرير: ')), 'the cover keeps the report-date line');
    assert.ok(!texts(spec[0]).some((t) => t.startsWith('النطاق: ') || t.startsWith('الفترة: ')));
  }
});

test('UNSCOPED: a scope with only blank ids (not normalised) is still unscoped', () => {
  const m = { ...clone(), scope: { labs: ['  '], shipments: [' '], from: '2026-09-01', to: null, shipmentSlide: true } };
  assert.deepEqual(build(m), build(clone()));
});

// ---- cover -----------------------------------------------------------------------------

const coverLines = (m) => texts(build(m)[0]);

test('COVER: a range replaces the report-date line with the period — the three formats', () => {
  const cases = [
    ['2026-09-11', '2026-09-23', 'الفترة: 11 – 23 سبتمبر 2026'],
    ['2026-08-28', '2026-09-23', 'الفترة: 28 أغسطس – 23 سبتمبر 2026'],
    ['2025-12-28', '2026-01-05', 'الفترة: 28 ديسمبر 2025 – 5 يناير 2026'],
    // One day: said once, never '23 – 23 سبتمبر 2026'.
    ['2026-09-23', '2026-09-23', 'الفترة: 23 سبتمبر 2026'],
  ];
  for (const [from, to, want] of cases) {
    const lines = coverLines(scoped({ from, to }));
    assert.ok(lines.includes(want), `expected '${want}', got ${JSON.stringify(lines)}`);
    assert.ok(!lines.some((t) => t.startsWith('تاريخ التقرير')), 'the report-date line is replaced, not duplicated');
    // Range-only: no labs/shipments, so no extra line — but the cover is still MARKED:
    // the period line alone reads like an ordinary periodic report.
    assert.ok(!lines.some((t) => t.startsWith('النطاق: ')));
    assert.equal(lines.filter((t) => t === TAG).length, 1, 'a range-only cover carries the pill');
    // The review screen formats the same range with i18n/ar.js — the operator's screen and
    // the audience's cover must print the same words.
    assert.equal(want, 'الفترة: ' + formatRangeAr(from, to));
  }
});

test('COVER: the period line keeps the report-date line\'s own box and style', () => {
  const find = (m, prefix) => build(m)[0].elements.find((e) => e.t === 'text' && e.text.startsWith(prefix));
  const plain = find(clone(), 'تاريخ التقرير: ');
  const period = find(scoped({ from: '2026-09-11', to: '2026-09-23' }), 'الفترة: ');
  const { text: _a, ...plainRest } = plain;
  const { text: _b, ...periodRest } = period;
  assert.deepEqual(periodRest, plainRest);
});

test('COVER: the scope line names labs and the shipment count', () => {
  const line = (scope, details = []) => coverLines(scoped(scope, details)).filter((t) => t.startsWith('النطاق: '));
  const det = (...xs) => xs.map((id) => detail(id, { completed: 1 }));
  assert.deepEqual(line({ labs: ['Lab A', 'Lab B'] }), ['النطاق: المختبرات: Lab A، Lab B']);
  // A bare count: 'n شحنة' was wrong Arabic for every n from 2 to 10.
  assert.deepEqual(line({ shipments: ['ELAB1', 'ELAB2', 'ELAB3'] }, det('ELAB1', 'ELAB2', 'ELAB3')), ['النطاق: الشحنات: 3']);
  assert.deepEqual(line({ labs: ['Lab A'], shipments: ['ELAB1'] }, det('ELAB1')), ['النطاق: المختبرات: Lab A · الشحنات: 1']);
  // More than three labs: the first three + 'و{n} أخرى'.
  assert.deepEqual(line({ labs: ['Lab A', 'Lab B', 'Lab C', 'Lab D', 'Lab E'] }),
    ['النطاق: المختبرات: Lab A، Lab B، Lab C و2 أخرى']);
  // Exactly three: all named, no fold.
  assert.deepEqual(line({ labs: ['Lab A', 'Lab B', 'Lab C'] }), ['النطاق: المختبرات: Lab A، Lab B، Lab C']);
});

test('COVER: the shipment count is the IN-SCOPE count — the cover and the table agree', () => {
  // Three IDs chosen; the lab filter leaves ELAB000003 (Lab B) with no row in scope — the
  // review screen's 'outsideScope' case. The cover must count 2, like the table.
  const rows = [
    orderRow({ id: '1', ship: 'ELAB000001', f: { dispatched: '2026-09-13 09:00:00' } }),
    orderRow({ id: '2', ship: 'ELAB000002', f: { dispatched: '2026-09-13 09:00:00' } }),
    orderRow({ id: '3', ship: 'ELAB000003', f: { facility: 'Lab B', dispatched: '2026-09-13 09:00:00' } }),
  ];
  const scope = normalizeScope({ labs: ['Lab A'], shipments: ['ELAB000001', 'ELAB000002', 'ELAB000003'] });
  const scopedRows = applyScope(rows, scope);
  const m = { ...clone(), scope, scopedRows, shipmentDetails: shipmentDetails(scopedRows, scope.shipments), reportDate: '2026-09-23' };
  const spec = build(m);
  assert.ok(texts(spec[0]).includes('النطاق: المختبرات: Lab A · الشحنات: 2'), JSON.stringify(texts(spec[0])));
  const body = tableOf(slideById(spec, 'shipments')).rows.slice(1, -1);
  assert.equal(body.length, 2, 'the table lists the same two shipments the cover counts');
  // Nothing in scope at all: 'الشحنات: 0' over the shipments slide's 'none' page.
  const none = build(scoped({ shipments: ['ELAB9'] }, []));
  assert.ok(texts(none[0]).includes('النطاق: الشحنات: 0'));
  assert.ok(texts(slideById(none, 'shipments')).includes(DEFAULT_LABELS.shipNone));
});

test('COVER: every scoped cover carries ONE pill, a kicker right above the title', () => {
  for (const scope of [{ from: '2026-09-11', to: '2026-09-23' }, { labs: ['Lab A'] }, { shipments: ['ELAB1'] }]) {
    for (const variant of VARIANTS) {
      const cover = build(scoped(scope, [detail('ELAB1', { completed: 1 })]), variant)[0];
      const pills = pillsOf(cover);
      assert.equal(pills.length, 1, `${JSON.stringify(scope)} ${variant}: one cover pill`);
      const [{ text: pill, bg }] = pills;
      assert.equal(bg.t, 'rect', 'a filled pill sits behind the text');
      assert.deepEqual([bg.x, bg.y, bg.w, bg.h], [pill.x, pill.y, pill.w, pill.h]);
      assert.equal(bg.fill, '#F59E0B', 'amber — the colour of the content slides\' pill and the scope line');
      const title = cover.elements.find((e) => e.t === 'text' && e.text === DEFAULT_LABELS.coverTitle);
      assert.ok(pill.y + pill.h <= title.y, 'the pill ends above the title box');
      assert.equal(Math.round((pill.x + pill.w) * 1000), Math.round((title.x + title.w) * 1000),
        'right-aligned on the cover\'s text column');
      // At least the content slides' 9pt, and its box contains the Cairo line box.
      assert.ok(pill.size >= 9 && pill.h >= pill.size * 0.0258, 'the pill box contains its line');
    }
  }
});

test('COVER: the scope line never wraps — very long lab names fold earlier', () => {
  const long = (c) => `${c}${'x'.repeat(44)} Laboratory Company`; // ≈64 chars each
  const [l] = coverLines(scoped({ labs: [long('A'), long('B'), long('C')], shipments: ids(150) }))
    .filter((t) => t.startsWith('النطاق: '));
  assert.ok(l.includes(long('A')), 'the first lab is always named');
  assert.ok(!l.includes(long('C')), 'the third name is folded into the count');
  assert.match(l, /و\d+ أخرى/);
  // The width guard: shown names × 0.085in/char stay inside the 8.4in names budget.
  const names = l.slice('النطاق: المختبرات: '.length, l.indexOf(' و'));
  assert.ok(names.length * 0.085 <= 8.4, `${names.length} chars of names would overrun the cover line`);
});

test('COVER: the scope line sits one 0.40 pitch above the date line and moves nothing', () => {
  const plain = build(clone())[0].elements;
  const cover = build(scoped({ labs: ['Lab A'], from: '2026-09-11', to: '2026-09-23' }))[0].elements;
  const extra = cover.find((e) => e.t === 'text' && e.text.startsWith('النطاق: '));
  assert.deepEqual([extra.x, extra.y, extra.w, extra.h, extra.size, extra.valign], [0.6, 5.75, 11.9, 0.4, 12, 'middle']);
  const date = cover.find((e) => e.t === 'text' && e.text.startsWith('الفترة: '));
  assert.ok(extra.y + extra.h <= date.y, 'the scope line ends where the date line begins');
  // Every other cover element is exactly where it was — the pill (text + its rect) is
  // ADDED, at the end, and moves nothing either.
  const [pill] = pillsOf({ elements: cover });
  const rest = cover.filter((e) => e !== extra && e !== date && e !== pill.text && e !== pill.bg);
  assert.deepEqual(rest, plain.filter((e) => !(e.t === 'text' && e.text.startsWith('تاريخ التقرير'))));
  assert.deepEqual(cover.slice(-2), [pill.bg, pill.text], 'the pill is appended last');
});

// ---- header pill -------------------------------------------------------------------------

/** A send-out block with n countries (n > 4 drives the squeezed row ladder). */
const sendoutOf = (n) => ({
  total: 10 * n, local: 10, international: 10 * (n - 1),
  byCountry: Array.from({ length: n }, (_, i) => ({ country: `C${i}`, orders: 10 })),
  byLab: Array.from({ length: n }, (_, i) => ({ lab: `L${i}`, country: `C${i}`, reflab: 'R', orders: 10 })),
  inferred: [], unmapped: [], unresolved: [],
});
const withEverySlide = (scope, details = [], countries = 2) => scoped(scope, details, {
  reportOptions: { slides: { definitions: true } },
  tasksInternal: Array.from({ length: 40 }, (_, i) => ({ ...MOCK_REPORT_MODEL.tasksInternal[0], task: `t${i}` })),
  sendout: sendoutOf(countries),
});

test('TAG: every slide but thanks carries exactly one pill when scoped — each kind of scope', () => {
  const scopes = [
    { labs: ['Lab A'] },
    { shipments: ['ELAB1'] },
    { from: '2026-09-11', to: '2026-09-23' },
  ];
  for (const scope of scopes) {
    for (const variant of VARIANTS) {
      const spec = build(withEverySlide(scope, [detail('ELAB1', { completed: 1 })]), variant);
      const content = spec.slice(1, -1);
      assert.ok(content.length >= 8, 'the probe deck spans send-out, continuation and definitions slides');
      for (const s of spec.slice(0, -1)) {
        assert.equal(pillsOf(s).length, 1, `${JSON.stringify(scope)} ${variant}: '${s.id}' must carry one pill`);
      }
      // Thanks carries no figure, so nothing to mark.
      assert.ok(!texts(spec[spec.length - 1]).includes(TAG));
    }
  }
});

test('TAG: on content slides the pill shares the footer strip with the page number', () => {
  const spec = build(withEverySlide({ labs: ['Lab A'] }));
  for (const s of spec.slice(1, -1)) {
    const [{ text: pill, bg }] = pillsOf(s);
    assert.equal(bg.t, 'rect', 'a filled pill sits behind the text');
    assert.deepEqual([bg.x, bg.y, bg.w, bg.h], [pill.x, pill.y, pill.w, pill.h]);
    const rule = s.elements.find((e) => e.t === 'rect' && e.y === 7.1);
    assert.ok(rule, `${s.id}: the footer rule is there`);
    // Under the rule, inside the slide, within the rule's span, centred on the page
    // number's line — and its box contains the 9pt Cairo line.
    assert.ok(pill.y >= rule.y + rule.h && pill.y + pill.h <= 7.5, `${s.id}: pill leaves the footer strip`);
    assert.ok(pill.x >= rule.x && pill.x + pill.w <= rule.x + rule.w + 1e-9, `${s.id}: pill runs past the rule`);
    // Pushed BEFORE the page number: the page number is still the last element, and in order.
    const last = s.elements[s.elements.length - 1];
    assert.equal(last.y, 7.15);
    assert.ok(Math.abs((pill.y + pill.h / 2) - (last.y + last.h / 2)) < 1e-9, 'one centre line with the page number');
    assert.ok(pill.h >= pill.size * 0.0258, 'the pill box contains its line');
  }
  const pages = spec.slice(1, -1).map((s) => s.elements[s.elements.length - 1].text);
  assert.deepEqual(pages, pages.map((_, i) => String(i + 1)));
});

// BOX-LEVEL, not ink-level: in PowerPoint every element is a shape, so a pill box that
// sits inside the title's text box is a shape on top of the title (a click near the title
// grabs the pill) even when the glyphs never touch. Every element of every slide of every
// probe deck, both variants, pairwise against the pill.
test('TAG: the pill\'s box overlaps NO other element\'s box — every slide, both variants', () => {
  const flat = (els) => els.flatMap((e) => (e.t === 'group' ? flat(e.children || []) : [e]));
  const boxOf = (e) => ({
    x: e.x, y: e.y, w: e.w,
    // A table's box is its rows at the nominal rowH (renderers only ever GROW rows; the
    // shipments pages are held above 6.95 by their own height budget, tested below).
    h: e.t === 'table' ? (Array.isArray(e.rowH) ? e.rowH.reduce((a, b) => a + b, 0) : e.rowH * e.rows.length) : e.h,
  });
  const EPS = 1e-9;
  const overlap = (a, b) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
  const twoLab = ['Northfield Advanced Diagnostics Company', 'Westbrook Clinical Reference Laboratory'];
  const many = ids(25).map((id, i) => detail(id, i % 3 ? { completed: 2 } : { completed: 1, awaitingResult: 1, inTransit: 1 },
    i % 4 ? {} : { labs: twoLab }));
  const decks = [
    withEverySlide({ labs: ['Lab A'] }),
    withEverySlide({ from: '2026-09-11', to: '2026-09-23' }, [], 6),
    withEverySlide({ shipments: ids(25) }, many),
    withEverySlide({ labs: ['Lab A', 'Lab B', 'Lab C', 'Lab D'], shipments: ids(25), from: '2026-08-28', to: '2026-09-23' }, many, 6),
    withEverySlide({ shipments: ['ELAB1'] }, []), // the 'nothing in scope' shipments page
  ];
  let checked = 0;
  for (const m of decks) {
    for (const variant of VARIANTS) {
      const spec = build(m, variant);
      for (const s of spec.slice(0, -1)) {
        const [pill] = pillsOf(s);
        assert.ok(pill, `${s.id}: no pill`);
        const p = boxOf(pill.text);
        assert.deepEqual(boxOf(pill.bg), p, `${s.id}: the pill's rect and text share one box`);
        for (const e of flat(s.elements)) {
          if (e === pill.text || e === pill.bg) continue;
          const b = boxOf(e);
          assert.ok([b.x, b.y, b.w, b.h].every(Number.isFinite), `${s.id}: an element with no box (${e.t})`);
          assert.ok(!overlap(p, b),
            `${variant} ${s.id}: the pill (${p.x}, ${p.y}, ${p.w}, ${p.h}) overlaps ${e.t} '${String(e.text ?? '').slice(0, 30)}' (${b.x}, ${b.y}, ${b.w}, ${b.h})`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 500, `the probe decks were too thin (${checked} pairs)`);
});

test('TAG: the pill text is a label (overridable) and is in both registries', () => {
  const m = scoped({ labs: ['Lab A'] });
  m.reportOptions = { labels: { scopeTag: 'نطاق جزئي' } };
  const spec = build(m);
  assert.ok(spec.slice(1, -1).every((s) => texts(s).includes('نطاق جزئي')));
  for (const k of ['scopeTag', 'coverPeriod', 'coverScope', 'coverScopeLabs', 'coverScopeShipments', 'scopeListMore',
    'titleShipments', 'shipSubtitle', 'shipColId', 'shipColLab', 'shipColLines', 'shipColDispatched',
    'shipColReceived', 'shipColStatus', 'shipTotalRow', 'shipStNotShipped', 'shipStInTransit', 'shipStAwaiting',
    'shipStCompleted', 'shipStCancelled', 'shipMixAwaiting', 'shipNone']) {
    assert.equal(typeof DEFAULT_LABELS[k], 'string', `DEFAULT_LABELS.${k}`);
    assert.equal(typeof LABEL_NAMES[k], 'string', `LABEL_NAMES.${k}`);
  }
});

// ---- shipments slide --------------------------------------------------------------------

test('SHIPMENTS: present right after the exec slide, absent when toggled off or not chosen', () => {
  const det = [detail('ELAB1', { completed: 3 })];
  const on = build(scoped({ shipments: ['ELAB1'] }, det)).map((s) => s.id);
  assert.deepEqual(on.slice(0, 3), ['cover', 'execFunnel', 'shipments']);
  const off = build(scoped({ shipments: ['ELAB1'], shipmentSlide: false }, det)).map((s) => s.id);
  assert.ok(!off.includes('shipments'), 'shipmentSlide:false hides it');
  const labsOnly = build(scoped({ labs: ['Lab A'] }, det)).map((s) => s.id);
  assert.ok(!labsOnly.includes('shipments'), 'no shipments chosen → no slide');
  // Hidden or shown, the deck is otherwise the same list of slides.
  assert.deepEqual(on.filter((id) => id !== 'shipments'), off);
});

test('SHIPMENTS: the slide title and a single page carry the bare title and a totals row', () => {
  const det = ids(12).map((id) => detail(id, { completed: 2 }));
  const spec = build(scoped({ shipments: ids(12) }, det));
  const pages = spec.filter((s) => s.id.startsWith('shipments'));
  assert.equal(pages.length, 1, '12 shipments fit one page');
  assert.ok(texts(pages[0]).includes('تفاصيل الشحنات'));
  const rows = tableOf(pages[0]).rows;
  assert.equal(rows.length, 1 + 12 + 1, 'header + 12 + totals');
  assert.equal(cellText(logical(rows.at(-1))[0]), 'المجموع');
});

test('SHIPMENTS: 13 shipments paginate 12 + 1, titled (1/2) (2/2), totals only on the last page', () => {
  const det = ids(13).map((id, i) => detail(id, { completed: i + 1 }));
  const spec = build(scoped({ shipments: ids(13) }, det));
  const order = spec.map((s) => s.id);
  assert.deepEqual(order.slice(1, 4), ['execFunnel', 'shipments', 'shipments-cont-1']);
  const [p1, p2] = [slideById(spec, 'shipments'), slideById(spec, 'shipments-cont-1')];
  assert.ok(texts(p1).includes('تفاصيل الشحنات (1/2)'));
  assert.ok(texts(p2).includes('تفاصيل الشحنات (2/2)'));
  const r1 = tableOf(p1).rows;
  const r2 = tableOf(p2).rows;
  assert.equal(r1.length, 1 + 12, 'page 1: header + 12, no totals');
  assert.ok(!r1.some((r) => cellText(logical(r)[0]) === 'المجموع'));
  assert.equal(r2.length, 1 + 1 + 1, 'page 2: header + the 13th + totals');
  assert.equal(cellText(logical(r2[1])[0]), 'ELAB626012');
  // Totals over ALL 13 shipments, not just the last page: 1 + 2 + … + 13 = 91 lines.
  const tot = logical(r2[2]);
  assert.equal(cellText(tot[0]), 'المجموع');
  assert.equal(cellText(tot[2]), '91');
  assert.equal(cellText(tot[5]), 'مكتملة');
  // Page numbers run through the continuation page.
  const content = spec.slice(1, -1).map((s) => s.elements.at(-1).text);
  assert.deepEqual(content, content.map((_, i) => String(i + 1)));
});

test('SHIPMENTS: status wording and colours — single buckets and a mixed list', () => {
  const det = [
    detail('S1', { completed: 3, rejected: 1 }),
    detail('S2', { awaitingResult: 2 }),
    detail('S3', { inTransit: 4 }, { received: null }),
    detail('S4', { notShipped: 1 }, { dispatched: null, received: null }),
    detail('S5', { cancelled: 2 }),
    detail('S6', { completed: 5, awaitingResult: 2 }),
    // Order is FIXED (most advanced first), not by count.
    detail('S7', { inTransit: 9, completed: 1 }),
  ];
  const slide = slideById(build(scoped({ shipments: det.map((d) => d.id) }, det)), 'shipments');
  const body = tableOf(slide).rows.slice(1, -1).map(logical);
  const status = body.map((r) => r[5]);
  assert.deepEqual(status.map(cellText), [
    'مكتملة', 'استُلمت – بانتظار النتيجة', 'شُحنت ولم تُستلم', 'لم تُشحن', 'ملغاة',
    'مكتملة 5 · بانتظار النتيجة 2', 'مكتملة 1 · شُحنت ولم تُستلم 9',
  ]);
  assert.deepEqual(status.slice(0, 5).map((c) => c.color), ['#00B050', '#2F5597', '#F59E0B', '#64748B', '#64748B']);
  assert.ok(status.every((c) => c.bold), 'every status cell is bold');
  assert.equal(status[5].size, 9, 'a mixed list prints at 9pt');
  // Dates via fmtDate; a missing milestone is '-'.
  assert.deepEqual(body[0].slice(3, 5).map(cellText), ['12 / 09 / 2026', '15 / 09 / 2026']);
  assert.deepEqual(body[3].slice(3, 5).map(cellText), ['-', '-']);
  // Totals: lines summed; buckets summed through the same mixed rule (rejected is a
  // SUBSET of completed and never its own bucket).
  const tot = logical(tableOf(slide).rows.at(-1));
  assert.equal(cellText(tot[2]), String(det.reduce((s, d) => s + d.lines, 0)));
  assert.equal(cellText(tot[5]), 'مكتملة 9 · بانتظار النتيجة 4 · شُحنت ولم تُستلم 13 · لم تُشحن 1 · ملغاة 2');
  assert.ok(tableOf(slide).rows.at(-1).every((c) => c.fill === '#F1F5F9'), 'the totals row is shaded');
});

test('SHIPMENTS: table geometry — widths add up, header columns read RTL, a full page ends above the floor', () => {
  const det = ids(12).map((id) => detail(id, { completed: 1 }));
  const t = tableOf(slideById(build(scoped({ shipments: ids(12) }, det)), 'shipments'));
  assert.equal(Math.round(t.colW.reduce((a, b) => a + b, 0) * 1000) / 1000, t.w);
  assert.deepEqual(logical(t.rows[0]), ['رقم الشحنة', 'المختبر', 'عدد الفحوصات', 'تاريخ الشحن', 'تاريخ الاستلام', 'الحالة']);
  assert.ok(t.y + t.rows.length * t.rowH <= 6.95 - 0.5, 'header + 12 + totals leaves wrap slack above 6.95');
});

// ---- shipments pagination by HEIGHT -------------------------------------------------------
// build-spec's cost model, restated independently from its PAGINATION / LINE ESTIMATE notes:
// a row costs max(0.361, lines × 10pt × 0.0258in/pt + 0.10in of cell margin); a lab cell of
// TWO OR MORE names word-wraps at 0.085/12 × 10 in a character over 2.70 − 0.20in of text
// (35 characters), one name is one line — unless the text is mostly CAPITALS, which wraps
// at 0.077 (32), one name or several; a status cell wraps like a pair at its own size
// over 4.367 − 0.20; an id at 0.078 over 0.95 (12). Header + rows (+ totals on the last
// page) must fit between the table top 1.167 and the content floor 6.95.
const BAND = 6.95 - 1.167;
const rowCost = (lines) => Math.max(0.361, lines * 10 * 0.0258 + 0.1);
/** Greedy word wrap into lines of at most `per` characters (a longer word splits). */
function wrapCount(t, per) {
  const lines = [''];
  for (let w of String(t).split(/\s+/).filter(Boolean)) {
    const cur = lines[lines.length - 1];
    if (cur && cur.length + 1 + w.length <= per) { lines[lines.length - 1] = `${cur} ${w}`; continue; }
    if (cur) lines.push('');
    while (w.length > per) { lines[lines.length - 1] = w.slice(0, per); lines.push(''); w = w.slice(per); }
    lines[lines.length - 1] = w;
  }
  return lines.length;
}
const perLine = (colW, pt) => Math.floor((colW - 0.2) / ((0.085 / 12) * pt));
const caps = (t) => { const l = t.match(/[A-Za-z]/g) || []; return l.length > 0 && l.filter((c) => /[A-Z]/.test(c)).length * 2 >= l.length; };
/** A shipments page's cost, read back off the table it actually carries. */
function pageCost(slide) {
  const rows = tableOf(slide).rows.map(logical);
  return rows.reduce((sum, r, i) => {
    if (i === 0) return sum + 0.361; // the header
    const [id, lab, , , , status] = r;
    const labText = cellText(lab);
    const lines = Math.max(
      wrapCount(cellText(id), Math.floor(0.95 / 0.078)),
      caps(labText) ? wrapCount(labText, Math.floor(2.5 / 0.077))
        : labText.includes('، ') ? wrapCount(labText, perLine(2.7, 10)) : 1,
      wrapCount(cellText(status), perLine(4.367, status.size || 10)),
    );
    return sum + rowCost(lines);
  }, 0);
}
const shipPages = (spec) => spec.filter((s) => s.id.startsWith('shipments'));
const bodyIds = (slide) => tableOf(slide).rows.slice(1).map((r) => cellText(logical(r)[0])).filter((t) => t !== 'المجموع');
/** The invariants every paginated shipments deck must keep. */
function assertPaged(spec, want) {
  const pages = shipPages(spec);
  const n = pages.length;
  pages.forEach((p, i) => {
    const rows = tableOf(p).rows;
    const isLast = i === n - 1;
    const totals = rows.filter((r) => cellText(logical(r)[0]) === 'المجموع').length;
    assert.equal(totals, isLast ? 1 : 0, `page ${i + 1}: the totals row lives on the last page only`);
    assert.ok(rows.length - 1 - totals <= 12, `page ${i + 1}: more than 12 shipments`);
    assert.ok(pageCost(p) <= BAND + 1e-9, `page ${i + 1}/${n}: the table runs to ${(1.167 + pageCost(p)).toFixed(3)}in, past the 6.95 floor`);
    assert.ok(texts(p).includes(n > 1 ? `تفاصيل الشحنات (${i + 1}/${n})` : 'تفاصيل الشحنات'));
  });
  assert.deepEqual(pages.flatMap(bodyIds), want, 'every shipment once, in order');
  const content = spec.slice(1, -1).map((s) => s.elements.at(-1).text);
  assert.deepEqual(content, content.map((_, i) => String(i + 1)), 'page numbers run through');
  return pages;
}

test('SHIPMENTS: two long lab names wrap — pages are cut by height and none runs past the floor', () => {
  const pair = ['Northfield Advanced Diagnostics Company', 'Westbrook Clinical Reference Laboratory'];
  // By hand, 35 characters a line: 'Northfield Advanced Diagnostics' · 'Company، Westbrook
  // Clinical' · 'Reference Laboratory' — THREE lines, a 0.874in row.
  assert.equal(wrapCount(pair.join('، '), perLine(2.7, 10)), 3);
  const det = ids(24).map((id) => detail(id, { completed: 1 }, { labs: pair }));
  for (const variant of VARIANTS) {
    const spec = build(scoped({ shipments: ids(24) }, det), variant);
    // A fixed 12 a page would have run the table to 1.167 + 0.361 + 12 × 0.874 = 12.02in.
    const pages = assertPaged(spec, ids(24));
    assert.ok(pages.length > 2, `24 three-line rows need more than two pages (got ${pages.length})`);
    assert.ok(pages.every((p) => tableOf(p).rows.length - 1 < 12), 'no page holds 12 of them');
  }
});

test('SHIPMENTS: a few two-line rows among twelve push the overflow onto a second page', () => {
  const pair = ['Eastgate Medical Laboratory', 'Southport Diagnostics Centre'];
  assert.equal(wrapCount(pair.join('، '), perLine(2.7, 10)), 2); // 'Eastgate Medical Laboratory،' · 'Southport Diagnostics Centre'
  const det = ids(12).map((id, i) => detail(id, { completed: 1 }, i % 2 === 0 && i < 10 ? { labs: pair } : {}));
  // The old fixed 12: header + 12 + totals + five rows 0.255 taller = 6.329in > 5.783.
  assert.ok(14 * 0.361 + 5 * (rowCost(2) - 0.361) > BAND);
  const pages = assertPaged(build(scoped({ shipments: ids(12) }, det)), ids(12));
  assert.equal(pages.length, 2);
});

test('SHIPMENTS: ONE lab per row — even a long name — still pages at exactly 12', () => {
  // A single name is one line (the column is sized to the widest real name), so ordinary
  // one-lab shipments keep the user's 12 a page. The totals row lists all five buckets —
  // costed as two lines — and still fits under them.
  const name = 'Northfield Advanced Diagnostics Labs'; // 36 characters, the widest real names' length
  const det = ids(24).map((id, i) => detail(id, [{ awaitingResult: 1 }, { inTransit: 1 }, { notShipped: 1 }, { cancelled: 1 }][i] || { completed: 1 },
    { labs: [name] }));
  const spec = build(scoped({ shipments: ids(24) }, det));
  const pages = assertPaged(spec, ids(24));
  assert.deepEqual(pages.map((p) => tableOf(p).rows.length), [1 + 12, 1 + 12 + 1]);
  const tot = cellText(logical(tableOf(pages[1]).rows.at(-1))[5]);
  assert.equal(tot.split(' · ').length, 5, 'the totals row lists all five buckets');
});

test('SHIPMENTS: a long name in CAPITALS wraps on its own — its rows are costed two lines', () => {
  // Set in capitals, a 36-character name runs ≈2.7in against the lab column's 2.50 of text
  // (mixed case it is ≈2.3 and fits), so twelve such one-lab rows cannot share a page.
  const loud = 'NORTHFIELD ADVANCED DIAGNOSTICS LABS';
  assert.equal(wrapCount(loud, Math.floor(2.5 / 0.077)), 2);
  const det = ids(12).map((id) => detail(id, { completed: 1 }, { labs: [loud] }));
  const pages = assertPaged(build(scoped({ shipments: ids(12) }, det)), ids(12));
  assert.ok(pages.length > 1, 'twelve two-line rows do not fit one page');
  // The same name in mixed case keeps the user's 12 (the ONE-lab test above, and here).
  const quiet = ids(12).map((id) => detail(id, { completed: 1 }, { labs: ['Northfield Advanced Diagnostics Labs'] }));
  assert.equal(shipPages(build(scoped({ shipments: ids(12) }, quiet))).length, 1);
});

test('SHIPMENTS: when the last page cannot also hold the totals, its last row moves on with them', () => {
  const pair = ['Northfield Advanced Diagnostics Company', 'Westbrook Clinical Reference Laboratory'];
  // Six three-line rows fill a page (0.361 + 6 × 0.874 = 5.605); with the totals row
  // (5.966) they do not, so the sixth moves onto a page of its own with the totals.
  const det = ids(6).map((id) => detail(id, { completed: 1 }, { labs: pair }));
  const pages = assertPaged(build(scoped({ shipments: ids(6) }, det)), ids(6));
  assert.deepEqual(pages.map(bodyIds), [ids(6).slice(0, 5), ids(6).slice(5)]);
});

test('SHIPMENTS: a status list that wraps (five buckets, big counts) is costed two lines — totals and body rows', () => {
  // build-spec measured this shape wrapping: five buckets with 3–4-digit counts are 4.34in
  // at 9pt against the status column's 4.167. Five three-line rows + one two-line row
  // (0.361 + 5 × 0.874 + 0.616 = 5.347) leave room for a ONE-line totals row (5.708) but
  // not for this two-line one (5.963), so the last shipment moves on with the totals.
  const big = { completed: 300, awaitingResult: 40, inTransit: 30, notShipped: 20, cancelled: 20 };
  const three = ['Northfield Advanced Diagnostics Company', 'Westbrook Clinical Reference Laboratory'];
  const two = ['Eastgate Medical Laboratory', 'Southport Diagnostics Centre'];
  const det = ids(6).map((id, i) => detail(id, big, { labs: i < 5 ? three : two }));
  const spec = build(scoped({ shipments: ids(6) }, det));
  const pages = assertPaged(spec, ids(6));
  const tot = cellText(logical(tableOf(pages.at(-1)).rows.at(-1))[5]);
  assert.equal(wrapCount(tot, perLine(4.367, 9)), 2, `the totals list '${tot}' is two lines`);
  assert.deepEqual(pages.map(bodyIds), [ids(6).slice(0, 5), ids(6).slice(5)]);
  // A BODY row's status list wraps the same way ('مكتملة 300 · بانتظار النتيجة 40 · …'
  // is ≈0.28in wider than the 3.99in measured for 125/32/4/2/1), so twelve one-lab rows
  // of it cannot share a page either.
  const busy = ids(12).map((id) => detail(id, big));
  const busyPages = assertPaged(build(scoped({ shipments: ids(12) }, busy)), ids(12));
  assert.ok(busyPages.length > 1, 'twelve two-line status rows do not fit one page');
});

test('SHIPMENTS: lab cell — one lab, two joined, three or more folded', () => {
  const det = [
    detail('S1', { completed: 1 }, { labs: ['Lab A'] }),
    detail('S2', { completed: 1 }, { labs: ['Lab A', 'Lab B'] }),
    detail('S3', { completed: 1 }, { labs: ['Lab A', 'Lab B', 'Lab C', 'Lab D'] }),
    detail('S4', { completed: 1 }, { labs: [] }),
  ];
  const slide = slideById(build(scoped({ shipments: det.map((d) => d.id) }, det)), 'shipments');
  const labs = tableOf(slide).rows.slice(1, -1).map((r) => cellText(logical(r)[1]));
  assert.deepEqual(labs, ['Lab A', 'Lab A، Lab B', 'Lab A، Lab B و2 أخرى', '-']);
});

test('SHIPMENTS: nothing left in scope → the slide says so instead of drawing an empty table', () => {
  const slide = slideById(build(scoped({ shipments: ['ELAB1'] }, [])), 'shipments');
  assert.equal(tableOf(slide), undefined);
  assert.ok(texts(slide).includes(DEFAULT_LABELS.shipNone));
  assert.ok(texts(slide).includes(TAG));
});

test('SHIPMENTS: end to end from rows — applyScope + shipmentDetails feed the slide as-of the range end', () => {
  const row = orderRow;
  const rows = [
    // S1: one resulted in range, one received 22 Sep + resulted 24 Sep (after 'to').
    row({ id: '1', ship: 'elab000001', f: { dispatched: '2026-09-13 09:00:00', received: '2026-09-15 09:00:00', resulted: '2026-09-20 09:00:00', rawStatus: 'Result Approved' } }),
    row({ id: '2', ship: 'ELAB000001', f: { dispatched: '2026-09-13 09:00:00', received: '2026-09-22 09:00:00', resulted: '2026-09-24 09:00:00', rawStatus: 'Result Approved' } }),
    // S2: dispatched only.
    row({ id: '3', ship: 'ELAB000002', f: { dispatched: '2026-09-21 09:00:00' } }),
  ];
  const scope = normalizeScope({ shipments: ['ELAB000001', 'ELAB000002'], from: '2026-09-11', to: '2026-09-23' });
  const scopedRows = applyScope(rows, scope);
  const det = shipmentDetails(scopedRows, scope.shipments);
  const m = { ...clone(), scope, scopedRows, shipmentDetails: det, reportDate: scope.to };
  const slide = slideById(build(m), 'shipments');
  const body = tableOf(slide).rows.slice(1, -1).map(logical);
  assert.deepEqual(body.map((r) => cellText(r[0])), ['ELAB000001', 'ELAB000002']);
  // The 24 Sep result does not count as of 23 Sep: completed 1 · awaiting 1.
  assert.equal(cellText(body[0][5]), 'مكتملة 1 · بانتظار النتيجة 1');
  assert.equal(cellText(body[1][5]), 'شُحنت ولم تُستلم');
  assert.ok(texts(slide).some((t) => t.includes('23 / 09 / 2026')), 'the subtitle states the as-of date');
  assert.ok(texts(build(m)[0]).includes('الفترة: 11 – 23 سبتمبر 2026'));
});

test('the shared fixture was never mutated', () => {
  assert.deepEqual(MOCK_REPORT_MODEL, PRISTINE);
});
