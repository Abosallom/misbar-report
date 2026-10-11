// test/sgh-spec.test.mjs — run with:  node --test
// The SGH single report's slides (slidespec/build-spec.js, CONTRACT §1.11): the CURRENT
// design over SGH's own rows, with the reference deck's own SGH wording wherever the
// missing Test Menu makes a figure unknown —
//   cover       «يشمل التقرير:» + the SGH chip (identity);
//   exec        late card «–» (no % line, no chip) + the slide-2 SGH no-TAT footnote;
//   countries   both cards «–», ONE red SGH bar row, the SGH note + legend key, no KAMC
//               colour footnote;
//   labs        the country + reference-lab cells merged into the slide-5 note;
//   compliance  the late + late-% cells merged into the slide-6 note, totals «–».
// And the dispatch: 'both' → build-spec-both.js; KAMC / hospital-less models untouched.
// SYNTHETIC rows only: every order id, lab, test and catalogue line is made up; the
// hospital name/id pairs are the source's own spellings (organisations, not patients).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSpec, SGH_TEXT, SGH_COLORS, DEFAULT_LABELS } from '../src/slidespec/build-spec.js';
import * as bothSpec from '../src/slidespec/build-spec-both.js';
import { buildHospitalModel, stampHospitalDeltas, buildBothModel } from '../src/model/hospital-report.js';
import { loadPptxGen, installDom, serialise, unzipPptx } from './render-helpers.mjs';

const KAMC = { orderingFacilityId: '31763', hospital: 'King Abdul ah Medical City' };
const SGH = { orderingFacilityId: '1037', hospital: 'Saudi German Hospital Alzahraa Branch' };

let seq = 0;
const row = (h, facility, testName, od, over = {}) => {
  seq += 1;
  const d = (x) => (x ? `${x} 00:00:00` : null);
  return {
    orderDate: d(od), facility, orderId: `8${String(seq).padStart(5, '0')}`, lineNo: seq,
    loinc: null, testName, collected: d(over.col), dispatched: d(over.dis), received: d(over.rec),
    resulted: d(over.res), rawStatus: over.status || 'Order Created', tatDaysCsv: over.tatCsv ?? null,
    specimenNo: null, shipmentId: over.ship ?? null, performingFacilityId: null, ...h,
  };
};

// Report day Thu 2026-10-08 → week window Fri 10-02 … Thu 10-08.
const DATE = '2026-10-08';
// 'Assay K' IS in the TAT table and s1 even carries a CSV «TAT - Days»: under KAMC's
// policy s1 (received 09-01) would be LATE. SGH's policy uses neither — late is unknown.
const SETTINGS = {
  tatLookup: { 'Assay K': 2 },
  historicalConstants: { cancelledByMonth: { '2026-01': 2 } },
  reportOptions: { excludeNoTat: false, deltaMode: 'week' },
};
const MASTER = [{ vendor: 'Lab Alpha', country: 'Germany', reflab: 'Ref A', item: 'Assay K' }];

// SGH — 6 lines, 5 non-cancelled, two performing labs.
//   TEMKIN (CSV spelling with a doubled space) 3: s2 completed, s3 awaiting dispatch, s4 shipped
//   Saudi Diagnostics 2: s1 awaiting result (would be late with a TAT), s6 awaiting result
const sghRows = () => [
  row(SGH, 'Saudi Diagnostics Limited Company', 'Assay K', '2026-08-30', { col: '2026-08-30', dis: '2026-08-31', rec: '2026-09-01', tatCsv: 1, status: 'Specimen Courier Received' }),
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-05', { col: '2026-10-05', dis: '2026-10-05', rec: '2026-10-06', res: '2026-10-07', status: 'Result Approved' }),
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-06', { col: '2026-10-06', status: 'Specimen Collected' }),
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-07', { col: '2026-10-07', dis: '2026-10-07', status: 'Shipment Dispatched' }),
  row(SGH, 'Company  TEMKIN SAHA Medical', 'Assay S', '2026-10-03', { status: 'Order Cancelled' }),
  row(SGH, 'Saudi Diagnostics Limited Company', 'Assay K', '2026-10-04', { col: '2026-10-04', dis: '2026-10-04', rec: '2026-10-05', status: 'Specimen Courier Received' }),
];
const kamcRows = () => [
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-09-01', { col: '2026-09-01', dis: '2026-09-01', rec: '2026-09-02', status: 'Specimen Courier Received' }),
  row(KAMC, 'Lab Alpha', 'Assay K', '2026-10-04', { col: '2026-10-04', dis: '2026-10-04', rec: '2026-10-05', res: '2026-10-07', status: 'Result Approved' }),
];

/** The SGH model exactly as the app stamps it (hospital-report.js + the pipeline's stamps). */
function sghModel(rows = sghRows(), extra = {}) {
  const m = buildHospitalModel({ hospital: 'sgh', rows, settings: SETTINGS, reportDate: DATE, tracker: null, sendoutMaster: MASTER });
  stampHospitalDeltas(m, { rows, settings: SETTINGS });
  m.reportOptions = { ...SETTINGS.reportOptions, ...(extra.reportOptions || {}) };
  m.overrides = extra.overrides || {};
  return m;
}
const kamcModel = () => {
  const rows = kamcRows();
  const m = buildHospitalModel({ hospital: 'kamc', rows, settings: SETTINGS, reportDate: DATE, tracker: null, sendoutMaster: MASTER });
  stampHospitalDeltas(m, { rows, settings: SETTINGS });
  m.reportOptions = SETTINGS.reportOptions; m.overrides = {};
  return m;
};

const slide = (spec, id) => spec.find((s) => s.id === id);
const texts = (s) => s.elements.filter((e) => e.t === 'text');
const textOf = (s, str) => texts(s).find((e) => e.text === str);
const cellText = (c) => (c != null && typeof c === 'object' ? c.text : c);
const table = (s) => s.elements.find((e) => e.t === 'table');
/** Every string a slide prints: text boxes (+ runs), table cells, chart categories/series. */
function allStrings(spec) {
  const out = [];
  for (const s of spec) {
    for (const e of s.elements) {
      if (e.t === 'text') { out.push(e.text); (e.runs || []).forEach((r) => out.push(r.text)); }
      if (e.t === 'table') e.rows.forEach((r) => r.forEach((c) => out.push(cellText(c))));
      if (e.t === 'chart') { (e.categories || []).forEach((c) => out.push(c)); (e.series || []).forEach((x) => out.push(x.name)); }
    }
  }
  return out;
}

// ---- the model under test really is the no-Test-Menu SGH model ----------------------------

test('fixture: the SGH model is a no-Test-Menu model whose engine late is a meaningless 0', () => {
  const m = sghModel();
  assert.equal(m.hospital, 'sgh');
  assert.equal(m.noTestMenu, true);
  assert.equal(m.kpi.totals.total, 5);
  assert.equal(m.kpi.buckets.lateNoResult, 0, 'the engine says 0 — the slide must say «–»');
  assert.equal(m.sendout.total, 5);
});

// ---- cover ----------------------------------------------------------------------------------

test('cover: the reference chip row with ONLY the SGH chip, appended after the historic elements', () => {
  const spec = buildSpec(sghModel(), { variant: 'nupco' });
  const cover = slide(spec, 'cover');
  const kamcCover = slide(buildSpec(kamcModel(), { variant: 'nupco' }), 'cover');
  assert.deepEqual(cover.elements.slice(0, kamcCover.elements.length), kamcCover.elements, 'the current cover, untouched');
  const chips = cover.elements.slice(kamcCover.elements.length);
  assert.equal(chips.length, 4);
  const [label, pill, dot, name] = chips;
  assert.equal(label.text, 'يشمل التقرير:');
  assert.equal(label.size, 13);
  assert.deepEqual([pill.x, pill.y, pill.w, pill.h, pill.fill, pill.alpha, pill.radius], [10.0, 4.8, 1.3, 0.44, '#FFFFFF', 0.13, 0.22]);
  assert.deepEqual([dot.shape, dot.fill, dot.w, dot.h], ['ellipse', SGH_COLORS.coverDot, 0.16, 0.16]);
  assert.equal(name.text, 'SGH');
  assert.equal(name.bold, true);
  assert.equal(allStrings(spec).filter((t) => t === 'KAMC').length, 0, 'no KAMC chip');
});

// ---- exec -----------------------------------------------------------------------------------

test('exec: late card «–» in n/a grey, no percentage line, no chip; the slide-2 no-TAT footnote', () => {
  const spec = buildSpec(sghModel(), { variant: 'internal' });
  const ex = slide(spec, 'execFunnel');
  const lab = textOf(ex, DEFAULT_LABELS.kpiLate);
  assert.ok(lab, 'late card label');
  // The late card is the leftmost (x 0.000) card; its value box is (x+0.08, y+0.13).
  const value = texts(ex).find((e) => e.x === 0.08 && e.y === 1.06);
  assert.equal(value.text, '–');
  assert.equal(value.text.codePointAt(0), 0x2013, 'U+2013, the reference dash');
  assert.equal(value.color, SGH_COLORS.na);
  assert.ok(!texts(ex).some((e) => /^تمثل/.test(e.text)), 'no «تمثل X% من الطلبات» sub-line');
  // No chip anywhere inside the late card's box (x 0 → 1.639).
  assert.ok(!texts(ex).some((e) => e.x < 1.639 && e.y < 2.53 && /^\+/.test(e.text)), 'no late chip');
  // The footnote, exactly as reference slide 2 §2.11.
  const note = textOf(ex, SGH_TEXT.noTatNote);
  assert.ok(note, 'no-TAT note');
  assert.deepEqual([note.x, note.y, note.w, note.h, note.size, note.color, note.align], [0.5, 6.74, 11.58, 0.27, 9.5, '#475569', 'right']);
  assert.equal(SGH_TEXT.noTatNote, 'لا توجد مدة إنجاز محددة (TAT) لفحوصاته بعد، لذلك لا يمكن احتساب طلباته المتأخرة وتظهر بالعلامة (–)');
  const pillIdx = ex.elements.findIndex((e) => e.t === 'rect' && e.fill === SGH_COLORS.violet);
  assert.ok(pillIdx >= 0, 'violet SGH pill');
  const pill = ex.elements[pillIdx];
  assert.deepEqual([pill.x, pill.y, pill.w, pill.h, pill.radius], [12.2, 6.755, 0.62, 0.24, 0.12]);
  assert.equal(ex.elements[pillIdx + 1].text, 'SGH');
  // Other cards keep their figures and chips (window activity is real for SGH).
  assert.ok(textOf(ex, '5'), 'total card 5');
  assert.ok(texts(ex).some((e) => /^\+\d+$/.test(e.text)), 'other chips still print');
});

test('exec: a manual late override still wins on an SGH deck — figure + % line, no footnote', () => {
  const spec = buildSpec(sghModel(undefined, { overrides: { lateNoResult: 2 } }));
  const ex = slide(spec, 'execFunnel');
  assert.equal(texts(ex).find((e) => e.x === 0.08 && e.y === 1.06).text, '2');
  assert.ok(texts(ex).some((e) => /^تمثل .*% من الطلبات$/.test(e.text)));
  assert.ok(!textOf(ex, SGH_TEXT.noTatNote), 'the «(–)» footnote would now be false');
});

test('exec: the late card switched off takes the «(–)» footnote and its pill with it', () => {
  const spec = buildSpec(sghModel(undefined, { reportOptions: { kpiCards: { lateNoResult: false } } }));
  const ex = slide(spec, 'execFunnel');
  assert.ok(!textOf(ex, DEFAULT_LABELS.kpiLate), 'late card is off');
  assert.ok(!texts(ex).some((e) => e.text === '–'), 'no «–» on the slide');
  assert.ok(!textOf(ex, SGH_TEXT.noTatNote), 'no footnote explaining a «–» that is not there');
  assert.ok(!ex.elements.some((e) => e.t === 'rect' && e.fill === SGH_COLORS.violet), 'no SGH pill');
  // Switching ANOTHER card off leaves the late card — and so the footnote — in place.
  const other = slide(buildSpec(sghModel(undefined, { reportOptions: { kpiCards: { total: false } } })), 'execFunnel');
  assert.ok(textOf(other, SGH_TEXT.noTatNote), 'footnote stays while the late card shows');
});

// ---- countries --------------------------------------------------------------------------------

test('countries: cards «–» without a share line; ONE red SGH row over the full track; note + legend key', () => {
  const spec = buildSpec(sghModel());
  const so = slide(spec, 'sendoutCountries');
  const dashes = texts(so).filter((e) => e.text === '–');
  assert.equal(dashes.length, 2, 'local and international cards');
  dashes.forEach((e) => { assert.equal(e.size, 34); assert.equal(e.color, SGH_COLORS.na); });
  assert.ok(!texts(so).some((e) => /^تمثل/.test(e.text)), 'no share captions');
  assert.ok(textOf(so, DEFAULT_LABELS.sendoutLocal) && textOf(so, DEFAULT_LABELS.sendoutIntl), 'card labels kept');
  // The SGH row: red label, grey track, red full-width bar, count-only value.
  const label = textOf(so, 'مستشفى الألماني السعودي');
  assert.deepEqual([label.x, label.y, label.size, label.bold, label.color], [9.722, 3.861, 12, true, '#DC2626']);
  const redBars = so.elements.filter((e) => e.t === 'rect' && e.fill === '#DC2626' && e.h > 0.2);
  assert.equal(redBars.length, 1);
  assert.equal(redBars[0].w, 6.804, 'basis = SGH\'s own total → the full track');
  assert.equal(Math.round((redBars[0].x + redBars[0].w) * 1000) / 1000, 9.582, 'right-anchored on the track');
  const value = texts(so).find((e) => e.x === 0.5 && e.y === 3.861);
  assert.equal(value.text, '5', 'count only — no «%  |»');
  assert.equal(value.color, '#DC2626');
  // Exactly one bar row (no country rows).
  assert.equal(texts(so).filter((e) => e.x === 9.722).length, 1);
  // Reference note + legend key; the KAMC colour footnote is gone.
  const note = textOf(so, SGH_TEXT.countryNote);
  assert.deepEqual([note.x, note.y, note.w, note.h, note.size, note.bold, note.color], [0.5, 6.4, 12.3, 0.26, 9.5, true, '#B91C1C']);
  assert.equal(SGH_TEXT.countryNote, '* مستشفى الألماني السعودي: تفاصيل الـ Test Menu لم تصل بعد، لذلك لم تُحدَّد دولة المختبر لطلباته');
  const key = textOf(so, 'مستشفى الألماني السعودي — الدولة غير محددة');
  assert.ok(key && key.size === 9 && key.color === '#64748B');
  const sq = so.elements.find((e) => e.t === 'rect' && e.fill === '#DC2626' && e.w === 0.12);
  assert.ok(sq, 'legend square');
  assert.ok(Math.abs((key.x + key.w) - (sq.x - 0.06)) < 1e-9, 'label ends 0.06 before its square');
  const colourHead = DEFAULT_LABELS.sendoutColourNote.split('{')[0];
  assert.ok(!texts(so).some((e) => e.text.startsWith(colourHead)), 'KAMC colour footnote dropped');
});

// ---- labs -------------------------------------------------------------------------------------

test('labs: country + reference-lab cells merged into the slide-5 note over every SGH row; no shading sentence', () => {
  const spec = buildSpec(sghModel());
  const s = slide(spec, 'sendoutLabs');
  const t = table(s);
  const [header, r1, r2, total] = t.rows;
  assert.equal(t.rows.length, 4, 'header + 2 labs + total');
  assert.equal(header.length, 5);
  // Visual L→R: share, orders, NOTE (reflab slot, spans country), lab.
  assert.equal(r1.length, 4);
  assert.equal(r2.length, 3, 'covered cells are omitted');
  const note = r1[2];
  assert.equal(note.text, 'تفاصيل الـ Test Menu لمستشفى الألماني السعودي لم تصل بعد،\nلذلك لم تُحدَّد الدولة والمختبر المرجعي');
  assert.deepEqual([note.colSpan, note.rowSpan, note.fill, note.color, note.bold, note.size, note.align], [2, 2, '#FEF2F2', '#B91C1C', true, 9.5, 'center']);
  // Labs A→Z, CSV spelling whitespace-collapsed; orders + share of SGH's own total.
  assert.deepEqual([r1[3].text, r1[1].text, r1[0].text], ['Company TEMKIN SAHA Medical', '3', '60.0%']);
  assert.deepEqual([r2[2].text, r2[1].text, r2[0].text], ['Saudi Diagnostics Limited Company', '2', '40.0%']);
  assert.equal(cellText(total[1]), '5');
  assert.equal(t.rowH, 0.361, 'two rows already hold the note');
  assert.ok(!texts(s).some((e) => e.text === DEFAULT_LABELS.sendoutOneCountry || /صفّين متجاورين/.test(e.text)), 'no shaded-rows sentence');
  assert.ok(texts(s).some((e) => e.text === DEFAULT_LABELS.sendoutBasis.replace('{total}', '5')), 'basis line kept');
});

// ---- compliance -------------------------------------------------------------------------------

test('compliance: late + late-% merged into the slide-6 note; totals «–»; every count still printed', () => {
  const spec = buildSpec(sghModel());
  const t = table(slide(spec, 'compliance'));
  const [, r1, r2, total] = t.rows;
  assert.equal(t.rows.length, 4);
  assert.equal(r1.length, 7, 'NOTE replaces two cells');
  assert.equal(r2.length, 6, 'covered cells are omitted');
  const note = r1[0];
  assert.equal(note.text, 'تفاصيل الـ Test Menu لم تصل بعد،\nلذلك لم يُحتسب التأخير');
  assert.deepEqual([note.colSpan, note.rowSpan, note.fill, note.color, note.bold, note.size], [2, 2, '#FEF2F2', '#B91C1C', true, 9.5]);
  // r1 visual: NOTE, rejected, awaiting, completed, total, lab, #
  assert.deepEqual(r1.slice(1).map(cellText), ['0', '0', '1', '3', 'Company TEMKIN SAHA Medical', '1']);
  assert.deepEqual(r2.map(cellText), ['0', '2', '0', '2', 'Saudi Diagnostics Limited Company', '2']);
  assert.equal(total.length, 8);
  assert.deepEqual([total[0].text, total[1].text], ['–', '–']);
  assert.equal(total[0].color, SGH_COLORS.na);
  assert.deepEqual(total.slice(2).map(cellText), ['0', '2', '1', '5', 'المجموع', '']);
  assert.ok(allStrings([slide(spec, 'compliance')]).every((x) => x !== '0%'), 'the engine\'s 0% never prints');
});

test('compliance: the partition footnote clears the table as DRAWN (rows grow to ≈0.39in in PowerPoint)', () => {
  const comp = slide(buildSpec(sghModel()), 'compliance');
  const t = table(comp);
  const foot = textOf(comp, DEFAULT_LABELS.compPartition);
  // header + 2 labs + total, each counted at ≥ 0.40in: 2.143 + 4 × 0.40 + 0.08.
  assert.ok(Math.abs(foot.y - (2.143 + 4 * 0.4 + 0.08)) < 1e-9, `footnote y ${foot.y}`);
  assert.ok(foot.y > t.y + t.rows.length * 0.39, 'below the QuickLook/PowerPoint-drawn total row');
});

test('one SGH lab: the single note row is grown to the reference\'s two-row span; footnote stays below it', () => {
  const rows = sghRows().filter((r) => r.facility === 'Saudi Diagnostics Limited Company');
  const spec = buildSpec(sghModel(rows));
  const comp = slide(spec, 'compliance');
  const t = table(comp);
  assert.deepEqual(t.rowH, [0.275, 0.55, 0.275]);
  assert.equal(t.rows[1][0].rowSpan, 1);
  const foot = textOf(comp, DEFAULT_LABELS.compPartition);
  // Drawn height: the two 0.275 rows count at 0.40 (Cairo 10pt + cell margins), the
  // grown note row at its own 0.55.
  assert.ok(Math.abs(foot.y - (2.143 + 0.4 + 0.55 + 0.4 + 0.08)) < 1e-9, 'footnote under the grown table');
  assert.deepEqual(table(slide(spec, 'sendoutLabs')).rowH, [0.361, 0.55, 0.361]);
});

// ---- whole deck -------------------------------------------------------------------------------

test('SGH deck: no KAMC-only text, no NaN/undefined/null anywhere, both variants', () => {
  for (const variant of ['internal', 'nupco']) {
    for (const rows of [sghRows(), sghRows().slice(1, 2)]) {
      const spec = buildSpec(sghModel(rows, { reportOptions: { slides: { definitions: true } } }), { variant });
      const strs = allStrings(spec);
      for (const s of strs) {
        assert.equal(typeof s, 'string', `non-string text: ${s}`);
        assert.ok(!/NaN|undefined|null|Infinity/.test(s), `bad token in «${s}»`);
      }
      assert.ok(!strs.some((s) => /KAMC/.test(s)), 'no KAMC text');
      const colourHead = DEFAULT_LABELS.sendoutColourNote.split('{')[0];
      assert.ok(!strs.some((s) => s.startsWith(colourHead)), 'no KAMC colour footnote');
      assert.ok(!strs.some((s) => /^تمثل/.test(s)), 'no share/late-% line of an unknown');
      assert.ok(!strs.includes(DEFAULT_LABELS.sendoutOneCountry), 'no shading sentence');
      assert.ok(strs.includes(SGH_TEXT.noTatNote) && strs.includes(SGH_TEXT.countryNote));
      // No element geometry is NaN either.
      for (const sl of spec) for (const e of sl.elements) {
        for (const k of ['x', 'y', 'w', 'h']) if (k in e) assert.ok(Number.isFinite(e[k]), `${sl.id} ${e.t}.${k}`);
      }
    }
  }
});

test('SGH deck renders in both renderers: merged cells reach the HTML and the PPTX', async () => {
  installDom();
  const spec = buildSpec(sghModel(), { variant: 'nupco' });
  const { renderSlides } = await import('../src/render/html-renderer.js');
  const html = serialise(renderSlides(spec, { variant: 'nupco' }));
  assert.equal((html.match(/colspan="2"/g) || []).length, 2);
  assert.ok(html.includes('لذلك لم يُحتسب التأخير'));
  const { renderPptx } = await import('../src/render/pptx-renderer.js');
  const { PptxGenJS, JSZip } = loadPptxGen();
  const z = await unzipPptx(await renderPptx(spec, { variant: 'nupco', PptxGenJS, JSZip }));
  const xml = (await Promise.all(z.names.filter((n) => /slides\/slide\d+\.xml$/.test(n)).map((n) => z.read(n)))).join('');
  // pptxgenjs also stamps rowSpan/gridSpan on the covered (hMerge/vMerge) cells, so the
  // merged notes are counted by their ANCHOR cell: one in labs, one in compliance.
  assert.equal((xml.match(/<a:tc rowSpan="2" gridSpan="2">/g) || []).length, 2);
  assert.ok(xml.includes('يشمل التقرير:'));
});

// ---- the gates --------------------------------------------------------------------------------

test('the Test-Menu branches key off noTestMenu: an SGH model WITH a menu prints its real late figure', () => {
  const m = sghModel();
  m.noTestMenu = false; // the day SGH's Test Menu arrives
  const spec = buildSpec(m);
  const ex = slide(spec, 'execFunnel');
  assert.equal(texts(ex).find((e) => e.x === 0.08 && e.y === 1.06).text, '0');
  assert.ok(!allStrings(spec).includes(SGH_TEXT.noTatNote));
  assert.ok(!allStrings(spec).includes(SGH_TEXT.countryNote));
  assert.ok(allStrings(spec).includes('يشمل التقرير:'), 'still identified as the SGH deck');
});

test('KAMC / hospital-less models: no SGH branch fires, even with a stray noTestMenu flag', () => {
  const m = kamcModel();
  const want = buildSpec(structuredClone(m), { variant: 'nupco' });
  const noKey = structuredClone(m); delete noKey.hospital;
  assert.deepEqual(buildSpec(noKey, { variant: 'nupco' }), want);
  const stray = structuredClone(m); stray.noTestMenu = true;
  assert.deepEqual(buildSpec(stray, { variant: 'nupco' }), want);
  const strs = allStrings(want);
  for (const s of Object.values(SGH_TEXT)) assert.ok(!strs.includes(s), `KAMC deck prints no «${s}»`);
});

test('dispatch: a BOTH model is built by build-spec-both.js, with the variant passed through', () => {
  const buildBothSpec = bothSpec.buildBothSpec || bothSpec.default;
  assert.equal(typeof buildBothSpec, 'function');
  const m = buildBothModel({ kamcRows: kamcRows(), sghRows: sghRows(), settings: SETTINGS, reportDate: DATE, tracker: null, sendoutMaster: MASTER });
  for (const variant of ['internal', 'nupco']) {
    assert.deepEqual(buildSpec(structuredClone(m), { variant }), buildBothSpec(structuredClone(m), { variant }));
  }
});
