// test/both-spec.test.mjs — run with:  node --test
// buildBothSpec (src/slidespec/build-spec-both.js): the KAMC + SGH deck laid out exactly as
// the user's reference deck, fed by buildBothModel (src/model/hospital-report.js).
//   • structure — seven slides, the reference's boxes, page numbers, slide toggles;
//   • numbers — every printed figure is the model's, formatted the reference's way;
//   • edge cases the reference does not show (CONTRACT §1.12) — SGH with no orders, zero
//     deltas, an all-zero card, more countries / labs / lab rows than the reference had;
//   • both renderers accept every spec built here.
// SYNTHETIC rows only: order ids, labs, tests and catalogue lines are made up; the hospital
// name/id pairs are the source's own spellings (organisations, not patients).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildBothSpec } from '../src/slidespec/build-spec-both.js';
// Loaded SECOND on purpose: build-spec.js imports build-spec-both.js back (dispatch), so this
// order is the one where a top-level read of a build-spec.js export would hit its TDZ.
import { buildSpec } from '../src/slidespec/build-spec.js';
import { buildBothModel } from '../src/model/hospital-report.js';
import { loadPptxGen, installDom, unzipPptx } from './render-helpers.mjs';

const KAMC = { orderingFacilityId: '31763', hospital: 'King Abdul ah Medical City' };
const SGH = { orderingFacilityId: '1037', hospital: 'Saudi German Hospital Alzahraa Branch' };
const NA = '#94A3B8';

let seq = 0;
const row = (h, facility, testName, od, over = {}) => {
  seq += 1;
  const d = (x) => (x ? `${x} 00:00:00` : null);
  return {
    orderDate: d(od), facility, orderId: `8${String(seq).padStart(5, '0')}`, lineNo: seq,
    loinc: null, testName, collected: d(over.col), dispatched: d(over.dis), received: d(over.rec),
    resulted: d(over.res), rawStatus: over.status || 'Order Created', tatDaysCsv: over.tatCsv ?? null,
    specimenNo: null, shipmentId: null, performingFacilityId: null, ...h,
  };
};

// Report day Thu 2026-10-08 → chip window Fri 10-02 … Thu 10-08.
const DATE = '2026-10-08';
const SETTINGS = {
  tatLookup: { 'Assay K': 2, 'Assay U': 10 },
  historicalConstants: { cancelledByMonth: { '2026-01': 2 } },
  reportOptions: { excludeNoTat: false, deltaMode: 'week', kpiCards: { turnaround: true } },
};
const MASTER = [
  { vendor: 'Lab Alpha', country: 'Germany', reflab: 'Ref A', item: 'Assay K' },
  { vendor: 'Lab Beta', country: 'Saudi Arabia', reflab: 'Ref B1', item: 'Assay K' },
  { vendor: 'Lab Beta', country: 'USA', reflab: 'Ref B2', item: 'Assay U' },
];
// KAMC: 9 lines, 8 not cancelled (Lab Alpha 5 = Germany, Lab Beta 2 SA + 1 USA).
const kamcRows = () => [
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-08-03', { col: '2026-08-03', dis: '2026-08-03', rec: '2026-08-04', res: '2026-08-05', status: 'Result Approved' }),
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-09-01', { col: '2026-09-01', dis: '2026-09-01', rec: '2026-09-02', status: 'Specimen Courier Received' }),
  row(KAMC, 'Lab Beta', 'Assay U', '2026-10-05', { col: '2026-10-05', dis: '2026-10-05', rec: '2026-10-06', status: 'Specimen Courier Received' }),
  row(KAMC, 'Lab Beta', 'Assay K', '2026-10-06', { col: '2026-10-06', dis: '2026-10-06', status: 'Shipment Dispatched' }),
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-07', { col: '2026-10-07', status: 'Specimen Collected' }),
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-09-10', { status: 'Order Cancelled' }),
  row(KAMC, 'Lab Beta', 'Assay K', '2026-09-15', { col: '2026-09-15', dis: '2026-09-15', rec: '2026-09-16', status: 'Result Rejected' }),
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-04', { col: '2026-10-04', dis: '2026-10-04', rec: '2026-10-05', res: '2026-10-07', status: 'Result Approved' }),
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-01', { col: '2026-10-01', dis: '2026-10-01', rec: '2026-10-01', status: 'Specimen Courier Received' }),
];
// SGH: 5 lines, 4 not cancelled (TEMKIN 3, Saudi Diagnostics 1). No Test Menu.
const sghRows = () => [
  row(SGH, 'Saudi Diagnostics Limited Company', 'Assay K', '2026-09-28', { col: '2026-09-28', dis: '2026-09-29', rec: '2026-09-30', tatCsv: 1, status: 'Specimen Courier Received' }),
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-05', { col: '2026-10-05', dis: '2026-10-05', rec: '2026-10-06', res: '2026-10-07', status: 'Result Approved' }),
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-06', { col: '2026-10-06', status: 'Specimen Collected' }),
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-07', { col: '2026-10-07', dis: '2026-10-07', status: 'Shipment Dispatched' }),
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-03', { status: 'Order Cancelled' }),
];
const model = ({ kamc = kamcRows(), sgh = sghRows(), date = DATE, settings = SETTINGS } = {}) => buildBothModel({
  kamcRows: kamc, sghRows: sgh, settings, reportDate: date, tracker: null, sendoutMaster: MASTER,
});

// ---- helpers ------------------------------------------------------------------------
const strOf = (e) => (Array.isArray(e.runs) ? e.runs.map((r) => r.text).join('') : String(e.text ?? ''));
const texts = (s) => s.elements.filter((e) => e.t === 'text');
const textAt = (s, x, y) => texts(s).find((e) => Math.abs(e.x - x) < 1e-6 && Math.abs(e.y - y) < 1e-6);
const findText = (s, str) => texts(s).find((e) => strOf(e) === str);
const slide = (spec, id) => spec.find((s) => s.id === id);
const charts = (s, kind) => s.elements.filter((e) => e.t === 'chart' && (!kind || e.kind === kind));
const tableOf = (s) => s.elements.find((e) => e.t === 'table');
const cellText = (c) => (c && typeof c === 'object' ? String(c.text) : String(c));
const runsOf = (e) => e.runs.map((r) => [r.text, r.color ?? null]);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const tableBottom = (t) => t.y + (Array.isArray(t.rowH) ? t.rowH.reduce((a, b) => a + b, 0) : t.rowH * t.rows.length);

// Every content box ends on or above the 7.05 floor; only the footer rule (7.1) and the
// page number (7.15) live below it — the deck-wide rule build-spec.js keeps too.
function assertInsideFloor(spec) {
  for (const s of spec) {
    if (s.id === 'cover' || s.id === 'thanks') continue;
    for (const e of s.elements) {
      const bottom = e.t === 'table' ? tableBottom(e) : e.y + e.h;
      const chrome = (e.t === 'rect' && near(e.y, 7.1)) || (e.t === 'text' && near(e.y, 7.15));
      if (!chrome) assert.ok(bottom <= 7.05 + 1e-9, `${s.id}: ${e.t} ${strOf(e).slice(0, 30)} ends at ${bottom}`);
    }
  }
}

// ---- structure ------------------------------------------------------------------------

test('seven slides in the reference order, page numbers 1..5, same ids as the single-hospital deck', () => {
  const spec = buildBothSpec(model(), { variant: 'internal' });
  assert.deepEqual(spec.map((s) => s.id), ['cover', 'execFunnel', 'monthly', 'sendoutCountries', 'sendoutLabs', 'compliance', 'thanks']);
  spec.slice(1, 6).forEach((s, i) => {
    const pn = s.elements[s.elements.length - 1];
    assert.equal(pn.text, String(i + 1));
    assert.deepEqual([pn.x, pn.y, pn.w, pn.h, pn.size], [0.5, 7.15, 0.8, 0.3, 9]);
  });
  assert.equal(spec[0].bg, '#1E3A8A');
  assert.deepEqual(buildBothSpec(model(), { variant: 'nupco' }), spec, 'the variant changes nothing');
  assertInsideFloor(spec);
});

test('buildSpec dispatches a BOTH model here (either module may load first)', () => {
  const m = model();
  assert.deepEqual(buildSpec(m, { variant: 'nupco' }), buildBothSpec(m, { variant: 'nupco' }));
});

test('the builder never mutates the model and ignores manual overrides (not offered in BOTH)', () => {
  const m = model();
  m.overrides = { total: 999, lateNoResult: 999 };
  const before = JSON.stringify(m);
  const spec = buildBothSpec(m);
  assert.equal(JSON.stringify(m), before);
  delete m.overrides;
  assert.deepEqual(buildBothSpec(m), spec);
});

test('cover — the current cover plus the «يشمل التقرير:» chip row (KAMC first, rightmost)', () => {
  const s = buildBothSpec(model())[0];
  assert.equal(findText(s, 'تاريخ التقرير: 08 / 10 / 2026').y, 6.15);
  const lab = findText(s, 'يشمل التقرير:');
  assert.deepEqual([lab.x, lab.y, lab.w, lab.h, lab.size, lab.color], [11.35, 4.8, 1.15, 0.44, 13, '#DCE6F1']);
  const pills = s.elements.filter((e) => e.t === 'rect' && e.alpha === 0.13);
  assert.deepEqual(pills.map((p) => [p.x, p.w, p.h, p.radius, p.fill]), [[10, 1.3, 0.44, 0.22, '#FFFFFF'], [8.54, 1.3, 0.44, 0.22, '#FFFFFF']]);
  const dots = s.elements.filter((e) => e.shape === 'ellipse');
  assert.deepEqual(dots.map((d) => [d.x, d.fill]), [[10.97, '#5EEAD4'], [9.51, '#C4B5FD']]);
  assert.deepEqual(['KAMC', 'SGH'].map((t) => findText(s, t).x), [10.08, 8.62]);
});

// ---- slide 2 ----------------------------------------------------------------------------

test('exec cards — doughnut per card, centre total, per-hospital labels, pill and by-hospital line', () => {
  const s = slide(buildBothSpec(model()), 'execFunnel');
  const rings = charts(s, 'doughnut');
  assert.equal(rings.length, 6);
  // total 8 + 4 = 12; SGH share 4/12 → firstSliceAng round(60) = 60 (SGH centred on top)
  assert.deepEqual(rings[0].series[0].values, [8, 4]);
  assert.equal(rings[0].opts.firstSliceAng, 60);
  assert.equal(rings[0].opts.emptyColor, '#E2E8F0');
  assert.deepEqual([rings[0].x, rings[0].y, rings[0].w, rings[0].h], [11.35, 1.2, 1.02, 1.02]);
  assert.deepEqual(rings.map((r) => r.x), [11.35, 9.37, 7.39, 5.41, 3.43, 0.89]);
  const centre = textAt(s, 11.605, 1.455);
  assert.deepEqual([centre.text, centre.color, centre.size], ['12', '#2563EB', 14]);
  assert.equal(textAt(s, 11.35, 1.9825).text, '8');
  assert.deepEqual([textAt(s, 11.15, 1.01).text, textAt(s, 11.15, 1.01).color], ['4', '#7C3AED']);
  const pill = textAt(s, 12.18, 2.29);
  assert.equal(pill.text, '▲ 7');
  assert.deepEqual(runsOf(textAt(s, 11.04, 2.29)),
    [['+3', '#2E7D32'], [' SGH', '#7C3AED'], ['    ', '#64748B'], ['+4', '#2E7D32'], [' KAMC', '#00897B']]);
  assert.equal(textAt(s, 11.04, 2.81).text, 'أغسطس – أكتوبر');
  // under (x 5.02): SGH's delta is 0 → the line prints a grey «0»; the pill (+1) shows
  assert.deepEqual(runsOf(textAt(s, 5.1, 2.29)).map((r) => r[0]), ['0', ' SGH', '    ', '+1', ' KAMC']);
  assert.equal(textAt(s, 5.1, 2.29).runs[0].color, NA);
  assert.equal(textAt(s, 6.24, 2.29).text, '▲ 1');
  // shipped card has no sub line (reference)
  assert.equal(textAt(s, 7.08, 2.81), undefined);
});

test('exec late card — KAMC-only: SGH «–» grey, red outline/pill/delta, KAMC late-% sub', () => {
  const s = slide(buildBothSpec(model()), 'execFunnel');
  const ring = charts(s, 'doughnut')[5];
  assert.deepEqual(ring.series[0].values, [2, 0], 'SGH unknown → charted as 0');
  assert.equal(ring.opts.firstSliceAng, 0);
  const sgh = textAt(s, 0.69, 1.01);
  assert.deepEqual([sgh.text, sgh.color], ['–', NA]);
  assert.deepEqual([textAt(s, 1.145, 1.455).text, textAt(s, 1.145, 1.455).color], ['2', '#FF0000']);
  const card = s.elements.find((e) => e.t === 'rect' && e.x === 0.5 && e.y === 0.98);
  assert.deepEqual(card.line, { color: '#FF0000', pt: 2.5 });
  assert.equal(s.elements.find((e) => e.t === 'rect' && near(e.x, 1.72) && e.y === 2.29).fill, '#FDE2E2');
  assert.deepEqual([textAt(s, 1.72, 2.29).text, textAt(s, 1.72, 2.29).color], ['▲ 1', '#DC2626']);
  assert.deepEqual(runsOf(textAt(s, 0.58, 2.29)),
    [['–', NA], [' SGH', '#7C3AED'], ['    ', '#64748B'], ['+1', '#DC2626'], [' KAMC', '#00897B']]);
  // 2 late of KAMC's 3 awaiting → 66.7 (not of the combined 4)
  assert.equal(textAt(s, 0.58, 2.81).text, 'تمثل 66.7% من فحوصات KAMC تحت الإجراء');
});

test('exec cancelled note, legend, funnel rows and the 100%-stacked funnel chart', () => {
  const s = slide(buildBothSpec(model()), 'execFunnel');
  assert.deepEqual(runsOf(textAt(s, 5.0, 3.3)).map((r) => r[0]), ['* 4 طلب ملغي  —  ', 'KAMC ', '3', '‏  ·  ‏', 'SGH ', '1']);
  assert.equal(strOf(textAt(s, 6.3, 0.7)), '▲ نشاط الأسبوع من الجمعة 02 / 10 / 2026 حتى 08 / 10 / 2026');
  assert.deepEqual(runsOf(textAt(s, 8.86, 3.91)).map((r) => r[0]), ['+7', '  ', '12']);
  assert.deepEqual(runsOf(textAt(s, 8.16, 3.93)).map((r) => r[0]), ['+4', '  ', '8']);
  assert.deepEqual(runsOf(textAt(s, 7.46, 3.93)).map((r) => r[0]), ['+3', '  ', '4']);
  assert.deepEqual(runsOf(textAt(s, 8.86, 3.91 + 0.56 * 4)).map((r) => r[0]), ['+2', '  ', '4']);
  const f = charts(s, 'barStacked100')[0];
  assert.deepEqual([f.x, f.y, f.w, f.h], [3.1, 3.85, 4.24, 2.8]);
  assert.deepEqual(f.series.map((x) => x.values), [[8, 8, 7, 6, 3], [4, 4, 3, 2, 1], [0, 0, 2, 4, 8]]);
  assert.deepEqual(f.series.map((x) => x.color), ['#00897B', '#7C3AED', '#F1F5F9']);
  assert.ok(findText(s, 'المستشفيات') && findText(s, 'المختبرات'));
  assert.ok(findText(s, 'لا توجد مدة إنجاز محددة (TAT) لفحوصاته بعد، لذلك لا يمكن احتساب طلباته المتأخرة وتظهر بالعلامة (–)'));
});

// ---- slide 3 ----------------------------------------------------------------------------

test('monthly — stacked chart labels rules, 13-row table, note, KAMC-only turnaround block', () => {
  const s = slide(buildBothSpec(model()), 'monthly');
  const ch = charts(s, 'colStackedTotal')[0];
  assert.deepEqual(ch.categories, ['أغسطس', 'سبتمبر', 'أكتوبر']);
  assert.deepEqual(ch.series.map((x) => x.values), [[1, 2, 5], [0, 1, 3]]);
  assert.deepEqual(ch.series[1].labels.hide, [1, 2], 'SGH in-bar labels move under the total');
  assert.deepEqual(ch.total.second.values, [null, 1, 3]);
  assert.deepEqual(ch.series[0].labels.hide, [], 'no KAMC segment under 5% of the tallest stack');
  const t = tableOf(s);
  assert.equal(t.rows.length, 13);
  assert.deepEqual(t.colW, [0.74, 1.306, 1.307, 1.307, 0.76, 1.14]);
  assert.ok(near(t.colW.reduce((a, b) => a + b, 0), 6.56));
  assert.deepEqual(t.rowH, [0.3, ...Array(4).fill([0.255, 0.245, 0.245]).flat()]);
  assert.deepEqual(t.rows[0].map(cellText), ['الإجمالي', 'أكتوبر', 'سبتمبر', 'أغسطس', 'المستشفى', 'المؤشر']);
  assert.deepEqual(t.rows[1].map(cellText), ['8', '5', '2', '1', 'KAMC', 'الفحوصات']);
  assert.equal(t.rows[1][5].rowSpan, 3);
  assert.deepEqual(t.rows[2].map(cellText), ['4', '3', '1', '–', 'SGH'], 'SGH before it joined: «–»');
  assert.equal(t.rows[2][3].color, NA);
  assert.deepEqual(t.rows[3].map(cellText), ['12', '8', '3', '1', 'المجموع']);
  assert.deepEqual(t.rows[10].map(cellText), ['37.5%', '20.0%', '50.0%', '100%', 'KAMC', 'نسبة الاكتمال']);
  assert.deepEqual(t.rows[10].slice(0, 4).map((c) => c.color), ['#DC2626', '#DC2626', '#DC2626', '#16A34A']);
  assert.deepEqual(t.rows[12].map(cellText), ['33.3%', '25.0%', '33.3%', '100%', 'المجموع']);
  assert.deepEqual(t.rows[1][0].border, { top: { color: '#94A3B8', pt: 1.25 } });
  assert.deepEqual(t.rows[3][0].border, { top: { color: '#CBD5E1', pt: 1.25 } });
  assert.equal(strOf(textAt(s, 6.27, 4.33)), 'الفحوصات = فحوصات مكتملة + النتائج غير المكتملة — المكتملة تشمل المرفوضة · «–» = قبل انضمام المستشفى');
  const line = charts(s, 'line')[0];
  assert.deepEqual(line.categories, ['يناير', 'أغسطس', 'سبتمبر', 'أكتوبر'], 'KAMC engine months, constants included');
  assert.deepEqual(line.series.map((x) => x.values), [[null, 1, null, 2], [null, 2, null, 2]]);
  assert.ok(findText(s, 'الفعلي: 1.5 يوم') && findText(s, 'المتوقع: 2.0 يوم'));
  assert.equal(texts(s).filter((e) => strOf(e) === 'KAMC فقط').length, 2);
});

// ---- slides 4–6 -------------------------------------------------------------------------

test('countries — KAMC cards and bars on the KAMC basis, SGH row last, notes and legend', () => {
  const s = slide(buildBothSpec(model()), 'sendoutCountries');
  assert.equal(textAt(s, 7.0, 1.222).text, '2');
  assert.equal(textAt(s, 0.667, 1.222).text, '6');
  assert.equal(textAt(s, 7.0, 2.444).text, 'تمثل 25.0% من إجمالي طلبات KAMC');
  assert.equal(textAt(s, 0.667, 2.444).text, 'تمثل 75.0% من إجمالي طلبات KAMC');
  assert.deepEqual([0, 1, 2].map((i) => textAt(s, 0.5, 3.42 + 0.43 * i).text), ['62.5%  |  5', '25.0%  |  2', '12.5%  |  1']);
  assert.deepEqual([0, 1, 2].map((i) => textAt(s, 9.722, 3.42 + 0.43 * i).text), ['ألمانيا', 'المملكة العربية السعودية', 'الولايات المتحدة']);
  const sghY = 3.42 + 0.43 * 3;
  assert.deepEqual([textAt(s, 9.722, sghY).text, textAt(s, 9.722, sghY).color], ['مستشفى الألماني السعودي', '#DC2626']);
  assert.deepEqual([textAt(s, 0.5, sghY).text, textAt(s, 0.5, sghY).color], ['4', '#DC2626'], 'count only');
  const bar = s.elements.find((e) => e.t === 'rect' && e.fill === '#DC2626' && near(e.y, sghY + 0.04));
  assert.ok(near(bar.w, 6.804 * 4 / 8, 1e-4) && near(bar.x + bar.w, 9.582, 1e-4), 'SGH bar = 4 / KAMC total 8');
  assert.equal(texts(s).filter((e) => strOf(e) === 'KAMC فقط').length, 2);
  assert.ok(findText(s, '* مستشفى الألماني السعودي: تفاصيل الـ Test Menu لم تصل بعد، لذلك لم تُحدَّد دولة المختبر لطلباته'));
  assert.ok(findText(s, 'مستشفى الألماني السعودي — الدولة غير محددة'));
  assert.ok(findText(s, '·  النسب وطول الشريط من إجمالي طلبات KAMC البالغة 8‏  ·  بطاقتا المحلي والدولي تخصان KAMC فقط'));
});

test('labs — hospital column with merged cells, SGH note cell, share of the combined total, notes', () => {
  const s = slide(buildBothSpec(model()), 'sendoutLabs');
  const t = tableOf(s);
  assert.deepEqual(t.colW, [1.111, 0.972, 3.472, 1.806, 3.306, 1.0]);
  assert.deepEqual(t.rows.map((r) => r.length), [6, 6, 5, 5, 5, 3, 5], 'covered cells omitted');
  assert.deepEqual(t.rows[0], ['النسبة من الإجمالي', 'الطلبات', 'المختبر المرجعي', 'الدولة', 'المختبر', 'المستشفى']);
  assert.deepEqual(t.rows[1].map(cellText), ['41.7%', '5', 'Ref A', 'ألمانيا', 'Lab Alpha', 'KAMC']);
  assert.deepEqual([t.rows[1][5].rowSpan, t.rows[1][5].fill, t.rows[1][5].color], [3, '#E0F2F1', '#00897B']);
  assert.deepEqual(t.rows[2].map((c) => c.fill), Array(5).fill('#F1F5F9'), 'Lab Beta spans two countries → shaded');
  const note = t.rows[4][2];
  assert.deepEqual([note.colSpan, note.rowSpan, note.color, note.fill], [2, 2, '#B91C1C', '#FEF2F2']);
  assert.equal(note.text, 'تفاصيل الـ Test Menu لمستشفى الألماني السعودي لم تصل بعد،\nلذلك لم تُحدَّد الدولة والمختبر المرجعي');
  assert.deepEqual(t.rows[4].map(cellText).filter((x, i) => i !== 2), ['25.0%', '3', 'Company TEMKIN SAHA Medical', 'SGH']);
  assert.deepEqual(t.rows[6].map(cellText), ['100.0%', '12', '', '', 'إجمالي الطلبات']);
  assert.equal(t.rows[6][4].colSpan, 2);
  assert.deepEqual(t.rowH, [0.361, 0.28, 0.28, 0.28, 0.28, 0.28, 0.28]);
  assert.equal(textAt(s, 0.833, 6.3).text, 'صفوف مظللة: مختبر يعمل في أكثر من دولة — Lab Beta في دولتين');
  assert.deepEqual(runsOf(textAt(s, 0.833, 6.61)).map((r) => r[0]),
    ['الأرقام كما وردت من التحليل · أساس الحساب: جميع الطلبات غير الملغاة 12  —  ', 'KAMC ', '8', '‏  ·  ‏', 'SGH ', '4']);
});

test('compliance — continuous #, SGH late note, KAMC-only starred totals, two-line footnote', () => {
  const s = slide(buildBothSpec(model()), 'compliance');
  const t = tableOf(s);
  assert.deepEqual([t.x, t.y, t.w], [0.833, 1.12, 11.667]);
  assert.deepEqual(t.colW, [1.601, 0.715, 0.81, 2.0, 1.319, 1.19, 2.612, 0.42, 1.0]);
  assert.deepEqual(t.rows[0].map(cellText), ['نسبة الطلبات المتأخرة', 'متأخرة', 'مرفوضة', 'طلبات مستلمة بانتظار نتيجة', 'فحوصات مكتملة', 'مجموع الطلبات', 'المختبر', '#', 'المستشفى']);
  assert.deepEqual(t.rows[1].map(cellText), ['100.0%', '2', '0', '2', '2', '5', 'Lab Alpha', '1', 'KAMC']);
  assert.deepEqual(t.rows[2].map(cellText), ['0%', '0', '1', '1', '1', '3', 'Lab Beta', '2']);
  assert.deepEqual(t.rows[3].map(cellText), ['تفاصيل الـ Test Menu لم تصل بعد،\nلذلك لم يُحتسب التأخير', '0', '0', '1', '3', 'Company TEMKIN SAHA Medical', '3', 'SGH']);
  assert.deepEqual([t.rows[3][0].colSpan, t.rows[3][0].rowSpan], [2, 2]);
  assert.deepEqual(t.rows[4].map(cellText), ['0', '1', '0', '1', 'Saudi Diagnostics Limited Company', '4']);
  assert.equal(t.rows[4][2].color, '#1E293B', 'a 0 completed is plain');
  assert.deepEqual(t.rows[5].map(cellText), ['66.7%*', '2*', '1', '4', '4', '12', 'المجموع']);
  assert.equal(t.rows[5][6].colSpan, 3);
  assert.equal(t.rowH.length, 6);
  assert.deepEqual(runsOf(textAt(s, 0.833, 6.24)).map((r) => r[0]),
    ['مجموع الطلبات = قبل الاستلام + بانتظار نتيجة + فحوصات مكتملة · المرفوضة ضمن المكتملة، والمتأخرة ضمن بانتظار نتيجة — لا تُجمع معهما',
      '* المتأخرة ونسبتها في صف المجموع تخص KAMC فقط']);
});

// ---- toggles + labels ---------------------------------------------------------------------

test('slide toggles: monthly / send-out / compliance switch off and the pages renumber', () => {
  const m = model();
  m.reportOptions = { ...m.reportOptions, slides: { monthly: false, sendout: false, compliance: true, execFunnel: false, action: false } };
  const spec = buildBothSpec(m);
  assert.deepEqual(spec.map((s) => s.id), ['cover', 'execFunnel', 'compliance', 'thanks'], 'exec always renders (CONTRACT §1.10)');
  assert.equal(slide(spec, 'compliance').elements.at(-1).text, '2');
  m.reportOptions = { ...m.reportOptions, slides: { compliance: false } };
  assert.deepEqual(buildBothSpec(m).map((s) => s.id), ['cover', 'execFunnel', 'monthly', 'sendoutCountries', 'sendoutLabs', 'thanks']);
});

// SLIDE ORDER (model/slide-order.js): the main deck re-sequences its content units by the
// same list as the single-hospital deck — the saved reportOptions.slideOrder, or the review's
// one-report model.slideOrder over it. A unit moves as one block, the pages renumber 1..n in
// the new order, exec stays always-on, and units this deck has no slide for are skipped.
test('slide order: the send-out pair moves as one block and the pages renumber in the new order', () => {
  const m = model();
  m.reportOptions = { ...m.reportOptions, slideOrder: ['sendout', 'compliance', 'execFunnel', 'monthly', 'tracker'] };
  const spec = buildBothSpec(m, { variant: 'internal' });
  assert.deepEqual(spec.map((s) => s.id), ['cover', 'sendoutCountries', 'sendoutLabs', 'compliance', 'execFunnel', 'monthly', 'thanks']);
  assert.deepEqual(spec.slice(1, -1).map((s) => s.elements.at(-1).text), ['1', '2', '3', '4', '5']);
  assert.deepEqual(buildBothSpec(m, { variant: 'nupco' }), spec, 'the variant still changes nothing');
  // Through the buildSpec dispatch too (the path every caller takes).
  assert.deepEqual(buildSpec(m, { variant: 'internal' }), spec);
  // Each slide is the default deck's slide but for its page number.
  const plain = buildBothSpec(model());
  for (const s of spec.slice(1, -1)) assert.deepEqual(s.elements.slice(0, -1), slide(plain, s.id).elements.slice(0, -1), s.id);
  assertInsideFloor(spec);
});

test('slide order: the one-report order beats the saved one; shipments / challenges / definitions are skipped silently', () => {
  const m = model();
  m.reportOptions = { ...m.reportOptions, slideOrder: ['compliance', 'monthly', 'sendout', 'execFunnel', 'tracker'] };
  m.slideOrder = ['challenges', 'definitions', 'shipments', 'monthly', 'execFunnel', 'sendout', 'compliance', 'tracker'];
  assert.deepEqual(buildBothSpec(m).map((s) => s.id), ['cover', 'monthly', 'execFunnel', 'sendoutCountries', 'sendoutLabs', 'compliance', 'thanks']);
  delete m.slideOrder;
  assert.deepEqual(buildBothSpec(m).map((s) => s.id), ['cover', 'compliance', 'monthly', 'sendoutCountries', 'sendoutLabs', 'execFunnel', 'thanks']);
});

test('slide order + toggles: exec stays on when switched off and moved; an OFF unit leaves no gap', () => {
  const m = model();
  m.reportOptions = {
    ...m.reportOptions,
    slides: { execFunnel: false, monthly: false },
    slideOrder: ['compliance', 'monthly', 'sendout', 'execFunnel', 'tracker'],
  };
  const spec = buildBothSpec(m);
  assert.deepEqual(spec.map((s) => s.id), ['cover', 'compliance', 'sendoutCountries', 'sendoutLabs', 'execFunnel', 'thanks']);
  assert.deepEqual(spec.slice(1, -1).map((s) => s.elements.at(-1).text), ['1', '2', '3', '4']);
});

test('turnaround block follows kpiCards.turnaround (explicit-true) and needs both averages', () => {
  const m = model();
  m.reportOptions = { ...m.reportOptions, kpiCards: { turnaround: false } };
  const s = slide(buildBothSpec(m), 'monthly');
  assert.equal(charts(s, 'line').length, 0);
  assert.equal(texts(s).filter((e) => strOf(e) === 'KAMC فقط').length, 0);
  assert.ok(tableOf(s) && charts(s, 'colStackedTotal').length === 1, 'the rest of the slide stays');
  const m2 = model();
  m2.combined.turnaround.actual = null;
  assert.equal(charts(slide(buildBothSpec(m2), 'monthly'), 'line').length, 0);
});

test('monthly geometry: reference band with turnaround ON, the band centred (no empty lower half) with it OFF', () => {
  const on = slide(buildBothSpec(model()), 'monthly');
  const tOn = tableOf(on);
  assert.ok(near(tOn.y, 1.0) && near(tOn.h, 3.28), 'reference frame: y 1.0, cy 3.28 (= Σ rowH)');
  assert.ok(near(tOn.h, tableBottom(tOn) - tOn.y));
  assert.ok(near(charts(on, 'colStackedTotal')[0].y, 1.0));
  assert.ok(findText(on, 'KAMC') && near(findText(on, 'KAMC').y, 0.68));
  assert.ok(textAt(on, 6.27, 4.33), 'partition note at the reference y');

  for (const mk of [
    () => { const m = model(); m.reportOptions = { ...m.reportOptions, kpiCards: { turnaround: false } }; return m; },
    () => model({ kamc: [] }), // no KAMC rows → no measured TAT
  ]) {
    const s = slide(buildBothSpec(mk()), 'monthly');
    assert.equal(charts(s, 'line').length, 0);
    const dy = 1.211;
    const t = tableOf(s);
    assert.ok(near(t.y, 1.0 + dy) && near(t.h, 3.28));
    assert.ok(near(charts(s, 'colStackedTotal')[0].y, 1.0 + dy), 'chart and table keep one top edge');
    assert.ok(near(findText(s, 'KAMC').y, 0.68 + dy), 'legend moves with the chart');
    const note = texts(s).find((e) => strOf(e).endsWith('قبل انضمام المستشفى'));
    assert.ok(near(note.y, 4.33 + dy));
    // centred in the 1.0 → 6.972 band the turnaround block shared
    assert.ok(near(t.y - 1.0, 6.972 - (note.y + note.h), 1e-3));
  }
});

test('monthly overflow: more months than the reference shrink every month-dependent type size (never clip)', () => {
  const withMonths = (n) => {
    const m = model();
    const months = Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(2026, 3 + i, 1)); return d.toISOString().slice(0, 7); });
    const cell = { orders: 1888, results: 1860, incomplete: 28, completionPct: 68.5, beforeJoin: false };
    m.combined.monthly = {
      ...m.combined.monthly, months,
      rows: months.map((month) => ({ month, kamc: cell, sgh: cell, combined: cell })),
      chart: { kamc: months.map(() => 1888), sgh: months.map(() => 22), total: months.map(() => 1910) },
    };
    return slide(buildBothSpec(m), 'monthly');
  };
  // 7 months = the reference: every size exactly the reference's
  const s7 = withMonths(7);
  const t7 = tableOf(s7);
  assert.ok(t7.colW.slice(1, 8).every((w) => near(w, 0.56)));
  assert.deepEqual(t7.rows[0].slice(1, 8).map((c) => c.size), Array(7).fill(9));
  assert.deepEqual(t7.rows[1].slice(1, 8).map((c) => c.size), Array(7).fill(8.5));
  assert.deepEqual(t7.rows[3].slice(1, 8).map((c) => c.size), Array(7).fill(9));
  const c7 = charts(s7, 'colStackedTotal')[0];
  assert.deepEqual([c7.series[0].labels.size, c7.series[1].labels.size, c7.total.labels.size, c7.total.second.size, c7.opts.catAxis.label.size], [8, 8, 9, 8, 9]);

  for (const n of [10, 13]) {
    const s = withMonths(n);
    const t = tableOf(s);
    const monthW = Math.round((3.92 / n) * 1000) / 1000;
    const f = monthW / 0.56;
    const sz = (v) => Math.round(v * f * 100) / 100;
    assert.equal(t.colW.length, n + 3);
    assert.ok(near(t.colW.reduce((a, b) => a + b, 0), 6.56));
    const months = (r) => r.slice(1, 1 + n).map((c) => c.size);
    assert.deepEqual(months(t.rows[0]), Array(n).fill(sz(9)), `${n}: month headers shrink`);
    assert.ok(sz(9) < 9);
    assert.deepEqual(months(t.rows[1]), Array(n).fill(sz(8.5)), `${n}: hospital rows shrink`);
    assert.deepEqual(months(t.rows[3]), Array(n).fill(sz(9)), `${n}: المجموع rows shrink`);
    // columns that do not narrow keep the reference's sizes
    assert.equal(t.rows[0][0].size, 9.5);
    assert.equal(t.rows[0].at(-1).size, 9.5);
    assert.equal(t.rows[1][0].size, 8.5);
    assert.equal(t.rows[3][0].size, 9);
    assert.equal(t.rows[1].at(-1).size, 9, 'metric label');
    const ch = charts(s, 'colStackedTotal')[0];
    assert.deepEqual([ch.series[0].labels.size, ch.series[1].labels.size, ch.total.labels.size, ch.total.second.size, ch.opts.catAxis.label.size],
      [sz(8), sz(8), sz(9), sz(8), sz(9)], `${n}: chart labels shrink with the category width`);
  }
});

test('label overrides reach the strings the registry owns; BOTH-only strings stay the reference\'s', () => {
  const m = model();
  m.reportOptions = { ...m.reportOptions, labels: { titleExec: 'عنوان', kpiTotal: 'الكل' } };
  const s = slide(buildBothSpec(m), 'execFunnel');
  assert.ok(findText(s, 'عنوان') && findText(s, 'الكل'));
  assert.ok(findText(s, 'المستشفيات'));
});

// ---- edge cases (CONTRACT §1.12) -----------------------------------------------------------

test('SGH with no orders: its labels, rows and notes stay — 0 / «–», no bar, placeholder rows', () => {
  const spec = buildBothSpec(model({ sgh: [] }));
  const ex = slide(spec, 'execFunnel');
  assert.deepEqual([textAt(ex, 11.15, 1.01).text, textAt(ex, 11.15, 1.01).color], ['0', '#7C3AED']);
  assert.equal(charts(ex, 'doughnut')[0].opts.firstSliceAng, 0);
  assert.deepEqual(runsOf(textAt(ex, 11.04, 2.29)).map((r) => r[0]), ['0', ' SGH', '    ', '+4', ' KAMC']);
  assert.equal(textAt(ex, 0.69, 1.01).text, '–', 'late stays unknown for SGH');
  assert.deepEqual(runsOf(textAt(ex, 7.46, 3.93)).map((r) => r[0]), ['0'], 'no «+N» without a rise');
  const mo = tableOf(slide(spec, 'monthly'));
  assert.deepEqual(mo.rows[2].map(cellText), ['–', '–', '–', '–', 'SGH']);
  assert.deepEqual(mo.rows[3].map(cellText), ['8', '5', '2', '1', 'المجموع']);
  const co = slide(spec, 'sendoutCountries');
  const sghY = 3.42 + 0.43 * 3;
  assert.equal(textAt(co, 0.5, sghY).text, '0');
  assert.equal(co.elements.filter((e) => e.t === 'rect' && e.fill === '#DC2626' && e.w > 0.2).length, 0, 'no SGH bar');
  const lb = tableOf(slide(spec, 'sendoutLabs'));
  const sghRow = lb.rows[4];
  assert.deepEqual(sghRow.map(cellText).filter((x, i) => i !== 2), ['0.0%', '0', '–', 'SGH']);
  assert.deepEqual([sghRow[2].rowSpan, sghRow[2].colSpan], [1, 2]);
  assert.equal(lb.rowH[4], 0.56, 'a one-row note block is two rows tall');
  const cp = tableOf(slide(spec, 'compliance'));
  assert.deepEqual(cp.rows[3].map(cellText).slice(1), ['0', '0', '0', '0', '–', '–', 'SGH']);
  assertInsideFloor(spec);
});

test('zero deltas: no pill, grey «0» by-hospital, bare funnel counts; still names the window', () => {
  const m = model({ date: '2026-11-05' }); // nothing happened in Fri 10-30 … Thu 11-05
  for (const k of Object.keys(m.combined.cards)) assert.equal(m.combined.cards[k].delta.combined || 0, 0, k);
  const s = slide(buildBothSpec(m), 'execFunnel');
  assert.equal(texts(s).filter((e) => strOf(e).startsWith('▲ ') && e.w === 0.52).length, 0, 'no pill');
  assert.equal(s.elements.filter((e) => e.t === 'rect' && (e.fill === '#E3F2E5' || e.fill === '#FDE2E2')).length, 0);
  const line = textAt(s, 11.04, 2.29);
  assert.deepEqual(runsOf(line), [['0', NA], [' SGH', '#7C3AED'], ['    ', '#64748B'], ['0', NA], [' KAMC', '#00897B']]);
  assert.deepEqual(runsOf(textAt(s, 8.86, 3.91)).map((r) => r[0]), ['12']);
  assert.equal(strOf(textAt(s, 6.3, 0.7)), '▲ نشاط الأسبوع من الجمعة 30 / 10 / 2026 حتى 05 / 11 / 2026');
});

test('no orders at all: grey rings, slate KAMC label, empty funnel tracks, no send-out pair', () => {
  const spec = buildBothSpec(model({ kamc: [], sgh: [] }));
  assert.deepEqual(spec.map((s) => s.id), ['cover', 'execFunnel', 'monthly', 'compliance', 'thanks']);
  const s = slide(spec, 'execFunnel');
  const ring = charts(s, 'doughnut')[0];
  assert.deepEqual([ring.series[0].values, ring.opts.emptyColor], [[0, 0], '#E2E8F0']);
  assert.equal(textAt(s, 11.35, 1.9825).color, '#64748B', 'white would vanish on the grey ring');
  assert.deepEqual(charts(s, 'barStacked100')[0].series[2].values, [1, 1, 1, 1, 1]);
  assert.equal(textAt(s, 11.04, 2.81), undefined, 'no data window → no sub');
  const mo = slide(spec, 'monthly');
  assert.equal(charts(mo, 'colStackedTotal').length, 0);
  assert.deepEqual(tableOf(mo).colW, [0.74, 0.76, 1.14]);
  assert.ok(near(tableOf(mo).x + 0.74 + 0.76 + 1.14, 12.83));
  assertInsideFloor(spec);
});

test('more countries, labs and lab rows than the reference: rows shrink, never overlap, stay above the notes', () => {
  const m = model();
  const names = ['Germany', 'Bahrain', 'Saudi Arabia', 'USA', 'Jordan', 'South Korea', 'Finland', 'Romania', 'Narnia', 'Atlantis'];
  m.combined.countries.byCountry = names.map((country, i) => ({ country, orders: 10 - i, pct: 10 - i }));
  m.combined.labs.rows = [
    ...Array.from({ length: 22 }, (_, i) => ({ hospital: 'kamc', lab: `Lab ${i}`, country: 'Germany', reflab: 'R', orders: 1, share: 1, underTenth: false })),
    ...Array.from({ length: 4 }, (_, i) => ({ hospital: 'sgh', lab: `S ${i}`, country: null, reflab: null, orders: 1, share: 1, underTenth: false })),
  ];
  m.combined.compliance.rows = Array.from({ length: 21 }, (_, i) => ({
    no: i + 1, hospital: i < 17 ? 'kamc' : 'sgh', lab: `L${i}`, total: 1, completed: 1, awaitingResult: 0, rejected: 0, pipeline: 0,
    late: i < 17 ? 0 : null, latePct: i < 17 ? 0 : null,
  }));
  m.combined.monthly.months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
  m.combined.monthly.rows = m.combined.monthly.months.map((month) => {
    const cell = { orders: 1, results: 1, incomplete: 0, completionPct: 100, beforeJoin: false };
    return { month, kamc: cell, sgh: cell, combined: cell };
  });
  const spec = buildBothSpec(m);
  // countries: 10 + SGH = 11 rows between 3.42 and the SGH note (6.40)
  const co = slide(spec, 'sendoutCountries');
  const labels = texts(co).filter((e) => near(e.x, 9.722)).sort((a, b) => a.y - b.y);
  assert.equal(labels.length, 11);
  for (let i = 1; i < labels.length; i++) assert.ok(labels[i - 1].y + labels[i - 1].h <= labels[i].y + 1e-9, 'rows never overlap');
  assert.ok(labels.at(-1).y + labels.at(-1).h <= 6.4 + 1e-9);
  assert.ok(labels[0].size < 12 && near(labels[0].size / 12, labels[0].h / 0.389, 1e-4), 'type shrinks with the row');
  // labs: the table ends above the separator at 6.24
  const lb = tableOf(slide(spec, 'sendoutLabs'));
  assert.ok(tableBottom(lb) <= 6.2 + 1e-6, `labs bottom ${tableBottom(lb)}`);
  assert.ok(lb.rows[1][0].size < 10);
  // compliance: the table ends above the footnote at 6.24
  const cp = tableOf(slide(spec, 'compliance'));
  assert.ok(tableBottom(cp) <= 6.2 + 1e-6, `compliance bottom ${tableBottom(cp)}`);
  assert.ok(cp.rows[0][0].size < 10);
  // monthly: 12 months share the 3.92in, the table keeps its 6.56 width
  const mt = tableOf(slide(spec, 'monthly'));
  assert.equal(mt.colW.length, 15);
  assert.ok(near(mt.colW.reduce((a, b) => a + b, 0), 6.56));
  assertInsideFloor(spec);
});

test('shaded-rows note: Arabic counted-noun forms and the no-shade sentence', () => {
  const m = model();
  m.combined.labs.multiCountry = [{ lab: 'A', countries: 2 }, { lab: 'B', countries: 3 }, { lab: 'C', countries: 11 }];
  assert.equal(textAt(slide(buildBothSpec(m), 'sendoutLabs'), 0.833, 6.3).text,
    'صفوف مظللة: مختبر يعمل في أكثر من دولة — A في دولتين، و B في 3 دول، و C في 11 دولة');
  m.combined.labs.multiCountry = [];
  assert.equal(textAt(slide(buildBothSpec(m), 'sendoutLabs'), 0.833, 6.3).text,
    'كل مختبر يعمل في دولة واحدة في هذه الفترة، فلا توجد صفوف مُظللة.');
});

test('a tiny share prints «<0.1%» on the labs slide only; the countries slide keeps 0.0%', () => {
  const m = model();
  m.combined.labs.rows[0] = { ...m.combined.labs.rows[0], share: 0, underTenth: true };
  m.combined.countries.byCountry[2] = { ...m.combined.countries.byCountry[2], pct: 0 };
  const spec = buildBothSpec(m);
  assert.equal(cellText(tableOf(slide(spec, 'sendoutLabs')).rows[1][0]), '<0.1%');
  assert.equal(textAt(slide(spec, 'sendoutCountries'), 0.5, 3.42 + 0.86).text, '0.0%  |  1');
});

// ---- both renderers accept the specs ------------------------------------------------------

test('renderPptx + renderSlides render the BOTH deck (normal and edge-case specs)', async () => {
  const { PptxGenJS, JSZip } = loadPptxGen();
  installDom();
  const { renderPptx } = await import('../src/render/pptx-renderer.js');
  const { renderSlides } = await import('../src/render/html-renderer.js');
  for (const spec of [buildBothSpec(model()), buildBothSpec(model({ sgh: [] })), buildBothSpec(model({ kamc: [], sgh: [] }))]) {
    const blob = await renderPptx(spec, { PptxGenJS, JSZip });
    const { names, read } = await unzipPptx(blob);
    assert.equal(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, spec.length);
    const charts2 = spec.flatMap((s) => s.elements.filter((e) => e.t === 'chart')).length;
    assert.equal(names.filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)).length, charts2);
    assert.match(await read('ppt/slides/slide2.xml'), /<a:t>KAMC<\/a:t>/);
    const html = renderSlides(spec, { variant: 'internal' });
    assert.ok(html, 'html renderer returns a tree');
  }
});
