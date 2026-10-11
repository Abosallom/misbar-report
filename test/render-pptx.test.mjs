// render-pptx.test.mjs — PPTX side of the BOTH-hospitals SlideSpec element schema:
// rect ellipse/alpha/line.pt, text runs + margin, table spans/per-row heights/cell
// margin+valign+border, and the native chart kinds written by the JSZip post-process.
// Also pins the legacy guarantee: a spec without new fields never reaches the post-process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPptxGen, unzipPptx } from './render-helpers.mjs';
import { renderPptx, buildChartXml, dedupeParagraphProps, patchPptx, fillCoveredCells } from '../src/render/pptx-renderer.js';

const { PptxGenJS, JSZip } = loadPptxGen();
const KAMC = '#00897B', SGH = '#7C3AED';
const WHITE_SEAM = { color: '#FFFFFF', pt: 1.25 };

const doughnut = (x, k, s, ang, extra = {}) => ({
  t: 'chart', kind: 'doughnut', x, y: 1.2, w: 1.02, h: 1.02, categories: ['KAMC', 'SGH'],
  series: [{ name: 'الطلبات', values: [k, s], colors: [KAMC, SGH], line: WHITE_SEAM }],
  opts: { hole: 50, firstSliceAng: ang, ...extra },
});
const funnel = () => ({
  t: 'chart', kind: 'barStacked100', x: 3.1, y: 3.85, w: 4.24, h: 2.8,
  categories: ['1. إنشاء طلب', '2. سحب العينة', '3. شحن العينة', '4. إستلام العينة', '5. إصدار نتيجة'],
  series: [
    { name: 'KAMC', values: [2152, 2144, 2134, 2063, 1860], color: KAMC, line: WHITE_SEAM },
    { name: 'SGH', values: [35, 35, 34, 32, 3], color: SGH, line: WHITE_SEAM },
    { name: 'المتبقي (مسار الشريط)', values: [0, 8, 19, 92, 324], color: '#F1F5F9' },
  ],
  opts: { gap: 100, layout: { x: 0, y: 0, w: 1, h: 1 }, valueFormat: '0', catAxis: { hidden: true, reverse: true }, valAxis: { hidden: true, reverse: true } },
});
const monthly = () => ({
  t: 'chart', kind: 'colStackedTotal', x: 0.45, y: 1.0, w: 5.7, h: 3.48,
  categories: ['أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر'],
  series: [
    { name: 'KAMC', values: [3, 129, 515, 482, 492, 441, 90], color: KAMC, line: WHITE_SEAM, labels: { size: 8, bold: true, color: '#FFFFFF', pos: 'ctr', format: '#,##0;;;', hide: [0] } },
    { name: 'SGH', values: [0, 0, 0, 0, 0, 22, 13], color: SGH, line: WHITE_SEAM, labels: { size: 8, bold: true, color: '#FFFFFF', pos: 'ctr', format: '#,##0;;;', hide: [5, 6] } },
  ],
  total: { name: 'الإجمالي', labels: { size: 9, bold: true, color: '#1E293B', pos: 't', format: '#,##0' },
    second: { values: [null, null, null, null, null, 22, 13], size: 8, bold: true, color: SGH } },
  opts: { gap: 70, overlap: 100, layout: { x: 0.02, y: 0.07, w: 0.86, h: 0.83 }, valueFormat: '#,##0',
    catAxis: { reverse: true, line: { color: '#BFC7D5', pt: 0.75 }, label: { size: 9, color: '#1E293B' }, tick: 'out' },
    valAxis: { line: null, label: { size: 8, color: '#94A3B8' }, grid: { color: '#E5E9F0', pt: 0.75 }, tick: 'none' } },
});
const legacyLine = { t: 'chart', kind: 'line', x: 4, y: 4.5, w: 9, h: 2.4, categories: ['يناير', 'فبراير'], series: [{ name: 'الفعلي', values: [1, 2], color: '#1F4E78' }], opts: { dataLabels: true } };

// tiny well-formedness check: every open tag closed in order
function assertWellFormed(xml, label) {
  const stack = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z][\w:.-]*)\b[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m;
    if (self) continue;
    if (close) assert.equal(stack.pop(), name, `${label}: </${name}> closes the wrong element`);
    else stack.push(name);
  }
  assert.equal(stack.length, 0, `${label}: unclosed ${stack.join(',')}`);
}

async function render(spec) {
  const blob = await renderPptx(spec, { PptxGenJS, JSZip });
  assert.ok(blob instanceof Blob);
  return unzipPptx(blob);
}
// chart part of the k-th <c:chart> on slide n, resolved through the slide rels
async function chartPart(pkg, n, k) {
  const sx = await pkg.read(`ppt/slides/slide${n}.xml`);
  const rels = await pkg.read(`ppt/slides/_rels/slide${n}.xml.rels`);
  const rid = [...sx.matchAll(/<c:chart\b[^>]*r:id="([^"]+)"/g)][k][1];
  const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)[1].replace(/^\//, '');
  return { path: target, xml: await pkg.read(target) };
}

test('legacy spec: no schema field used → post-process never runs (pptxgenjs blob returned as is)', async () => {
  const spy = { loadAsync() { throw new Error('post-process must not run'); } };
  const spec = [{ id: 'a', bg: '#FFFFFF', elements: [
    { t: 'rect', x: 1, y: 1, w: 2, h: 1, fill: '#2563EB', radius: 0.1, line: { color: '#E2E8F0', w: 0.75 } },
    { t: 'text', x: 1, y: 2, w: 3, h: 0.5, text: 'عربي KAMC', size: 11 },
    { t: 'table', x: 1, y: 4, w: 4, colW: [1, 3], rowH: 0.3, rows: [['a', 'b'], ['1', '2']] },
    legacyLine,
  ] }];
  const blob = await renderPptx(spec, { PptxGenJS, JSZip: spy });
  const pkg = await unzipPptx(blob);
  const sx = await pkg.read('ppt/slides/slide1.xml');
  assert.match(sx, /lIns="12700"/, 'legacy text keeps the 1 pt inset');
  assert.match(sx, /<a:ln w="9525">/, 'legacy line.w stays points');
  const { xml } = await chartPart(pkg, 1, 0);
  assert.match(xml, /<c:roundedCorners val="1"\/>/, 'legacy chart is pptxgenjs\' own XML');
});

test('rect: ellipse, alpha → <a:alpha>, line.pt in points', async () => {
  const pkg = await render([{ id: 'c', bg: '#1E3A8A', elements: [
    { t: 'rect', x: 10, y: 4.8, w: 1.3, h: 0.44, fill: '#FFFFFF', alpha: 0.13, radius: 0.22 },
    { t: 'rect', shape: 'ellipse', x: 10.97, y: 4.94, w: 0.16, h: 0.16, fill: '#5EEAD4', radius: 0.5 },
    { t: 'rect', x: 0.5, y: 0.98, w: 1.86, h: 2.24, fill: '#FFFFFF', radius: 0.058125, line: { color: '#FF0000', pt: 2.5 } },
  ] }]);
  const sx = await pkg.read('ppt/slides/slide1.xml');
  assert.match(sx, /<a:srgbClr val="FFFFFF"><a:alpha val="13000"\/><\/a:srgbClr>/);
  assert.match(sx, /prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 50000"\/>/);
  assert.match(sx, /<a:prstGeom prst="ellipse"><a:avLst><\/a:avLst>/, 'ellipse ignores radius');
  assert.match(sx, /fmla="val 3125"/, 'card radius 0.058125 → adj 3125 (reference)');
  assert.match(sx, /<a:ln w="31750"><a:solidFill><a:srgbClr val="FF0000"\/>/, '2.5 pt = 31750 EMU');
});

test('text runs: one <a:pPr> per paragraph, rtl on every paragraph, run styles, br, margins', async () => {
  const pkg = await render([{ id: 't', bg: '#FFFFFF', elements: [
    { t: 'text', x: 11.04, y: 2.29, w: 1.09, h: 0.22, size: 7, align: 'right', valign: 'middle', rtl: false, margin: 0,
      runs: [{ text: '+13', size: 8, bold: true, color: '#2E7D32' }, { text: ' SGH', bold: true, color: SGH }, { text: '    ', color: '#64748B' },
        { text: '+90', size: 8, bold: true, color: '#2E7D32' }, { text: ' KAMC', bold: true, color: KAMC }] },
    { t: 'text', x: 0.8, y: 6.2, w: 11, h: 0.5, size: 9, bold: true, color: '#64748B', rtl: true, margin: [0.01, 0.02, 0.03, 0.04],
      runs: [{ text: 'الفقرة الأولى', br: true }, { text: 'الثانية', bold: false }] },
    { t: 'text', x: 1, y: 1, w: 2, h: 0.3, text: 'يشمل التقرير:', size: 13, margin: 0.014 },
  ] }]);
  const sx = await pkg.read('ppt/slides/slide1.xml');
  const bodies = [...sx.matchAll(/<p:txBody>([\s\S]*?)<\/p:txBody>/g)].map((m) => m[1]);
  // box 1: one paragraph, ONE pPr (pptxgenjs writes one per run — deduped), LTR, 5 runs
  const p1 = [...bodies[0].matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((m) => m[1]);
  assert.equal(p1.length, 1);
  assert.equal((p1[0].match(/<a:pPr\b/g) || []).length, 1);
  assert.doesNotMatch(p1[0], /rtl="1"/);
  assert.match(p1[0], /algn="r"/);
  assert.deepEqual([...p1[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]), ['+13', ' SGH', '    ', '+90', ' KAMC']);
  assert.deepEqual([...p1[0].matchAll(/<a:rPr lang="en-US" sz="(\d+)"( b="1")?/g)].map((m) => m[1] + (m[2] ? 'b' : '')), ['800b', '700b', '700', '800b', '700b']);
  assert.match(p1[0], /<a:latin typeface="Cairo"/);
  assert.match(bodies[0], /lIns="0" tIns="0" rIns="0" bIns="0"/);
  // box 2: br → two paragraphs, each RTL; a run's bold:false beats the box's bold:true
  const p2 = [...bodies[1].matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((m) => m[1]);
  assert.equal(p2.length, 2);
  p2.forEach((p) => { assert.equal((p.match(/<a:pPr\b/g) || []).length, 1); assert.match(p, /rtl="1"/); });
  assert.match(p2[0], /sz="900" b="1"/);
  assert.doesNotMatch(p2[1], /b="1"/);
  // margin [t, r, b, l] inches → l/t/r/bIns EMU
  assert.match(bodies[1], /lIns="36576" tIns="9144" rIns="18288" bIns="27432"/);
  // single-text margin 0.014 in ≈ the reference TextBox inset 12802 EMU
  assert.match(bodies[2], /lIns="12802" tIns="12802" rIns="12802" bIns="12802"/);
});

test('table: rowH array, rowSpan/colSpan with covered cells omitted, cell margin/valign/border, \\n', async () => {
  const pkg = await render([{ id: 'tb', bg: '#FFFFFF', elements: [
    { t: 'table', x: 6.27, y: 1, w: 3.2, colW: [0.74, 0.56, 0.76, 1.14], rowH: [0.3, 0.255, 0.245],
      header: { fill: '#1E3A8A', color: '#FFFFFF', bold: true }, margin: [0.01, 0.03, 0.01, 0.03],
      rows: [
        ['الإجمالي', 'أكتوبر', 'المستشفى', 'المؤشر'],
        [{ text: '2,152', border: { top: { color: '#94A3B8', pt: 1.25 }, left: null } }, '90', 'KAMC',
          { text: 'الفحوصات', rowSpan: 2, align: 'right', margin: [0.02, 0.05, 0.02, 0.04] }],
        [{ text: 'تفاصيل\nسطر', colSpan: 2, valign: 'top' }, { text: 'SGH', italic: true, rtl: true }],
      ] },
  ] }]);
  const sx = await pkg.read('ppt/slides/slide1.xml');
  assert.deepEqual([...sx.matchAll(/<a:tr h="(\d+)">/g)].map((m) => +m[1]), [274320, 233172, 224028]);
  const rows = [...sx.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map((m) => m[1]);
  const cells = (r) => [...r.matchAll(/<a:tc\b([^>]*)>/g)].map((m) => m[1].trim());
  assert.deepEqual(cells(rows[1]), ['', '', '', 'rowSpan="2"']);
  assert.deepEqual(cells(rows[2]), ['gridSpan="2"', 'hMerge="1"', '', 'vMerge="1"'], 'grid: span, its hMerge, SGH, then the rowSpan placeholder');
  // margins: table default (body) and the cell override; inches → EMU
  assert.match(rows[1], /marL="27432" marR="27432" marT="9144" marB="9144"/);
  assert.match(rows[1], /marL="36576" marR="45720" marT="18288" marB="18288"/);
  // per-side border: top 1.25 pt #94A3B8, left none, other sides the 0.75 pt default
  const c0 = /<a:tcPr[\s\S]*?<\/a:tcPr>/.exec(rows[1])[0];
  assert.match(c0, /<a:lnL w="0"[^>]*><a:noFill\/>/);
  assert.match(c0, /<a:lnT w="15875"[^>]*><a:solidFill><a:srgbClr val="94A3B8"/);
  assert.match(c0, /<a:lnB w="9525"[^>]*><a:solidFill><a:srgbClr val="E2E8F0"/);
  // valign top, '\n' = two paragraphs, italic, explicit cell rtl
  const span = /<a:tc gridSpan="2">([\s\S]*?)<\/a:tc>/.exec(rows[2])[1];
  assert.match(span, /anchor="t"/);
  assert.equal((span.match(/<a:p>/g) || []).length, 2);
  assert.match(rows[2], /<a:pPr rtl="1"[^>]*>[\s\S]*?i="1"[\s\S]*?<a:t>SGH<\/a:t>/);
});

test('text runs: a \\n inside a run breaks the line and the NEXT run continues it (as in HTML)', async () => {
  const pkg = await render([{ id: 't', bg: '#FFFFFF', elements: [
    { t: 'text', x: 1, y: 1, w: 3, h: 1, runs: [{ text: 'a\nb', bold: true }, { text: 'c', br: true }, { text: 'd' }] },
    { t: 'text', x: 1, y: 3, w: 3, h: 1, runs: [{ text: 'a\r\nb' }, { text: 'c' }] },
  ] }]);
  const sx = await pkg.read('ppt/slides/slide1.xml');
  const bodies = [...sx.matchAll(/<p:txBody>([\s\S]*?)<\/p:txBody>/g)].map((m) => m[1]);
  const paras = (b) => [...b.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((m) => [...m[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join('|'));
  assert.deepEqual(paras(bodies[0]), ['a', 'b|c', 'd']);
  assert.deepEqual(paras(bodies[1]), ['a', 'b|c']);
  assert.match(bodies[0], /sz="1200" b="1"[\s\S]*?<a:t>b<\/a:t>/, 'both pieces keep the run style');
});

test('table rowH array shorter than the rows: the rest stay auto (h="0"), as in html-renderer', async () => {
  const pkg = await render([{ id: 'tb', bg: '#FFFFFF', elements: [
    { t: 'table', x: 1, y: 1, w: 2, colW: [1, 1], rowH: [0.3], rows: [['a', 'b'], ['c', 'd'], ['e', 'f']] },
    { t: 'table', x: 1, y: 3, w: 2, colW: [1, 1], rowH: [0.3, null, 0.25], rows: [['a', 'b'], ['c', 'd'], ['e', 'f']] },
  ] }]);
  const sx = await pkg.read('ppt/slides/slide1.xml');
  assert.deepEqual([...sx.matchAll(/<a:tr h="(\d+)">/g)].map((m) => +m[1]), [274320, 0, 0, 274320, 0, 228600]);
});

test('pt <= 0 means no line: rect outline, table default and per-side cell borders', async () => {
  const pkg = await render([{ id: 'z', bg: '#FFFFFF', elements: [
    { t: 'rect', x: 1, y: 1, w: 1, h: 1, fill: '#000000', line: { color: '#000000', pt: 0 } },
    { t: 'table', x: 1, y: 3, w: 1, colW: [1], border: { color: '#E2E8F0', pt: 0 },
      rows: [[{ text: 'a', border: { top: { color: '#000000', pt: 0 }, bottom: { color: '#000000', pt: 1 } } }]] },
  ] }]);
  const sx = await pkg.read('ppt/slides/slide1.xml');
  assert.doesNotMatch(sx, /<a:ln w="12700">/, 'no 1 pt default outline');
  const tcPr = /<a:tcPr[\s\S]*?<\/a:tcPr>/.exec(sx)[0];
  for (const side of ['L', 'R', 'T']) assert.match(tcPr, new RegExp(`<a:ln${side} w="0"[^>]*><a:noFill/>`), `ln${side} none`);
  assert.match(tcPr, /<a:lnB w="12700"[^>]*><a:solidFill><a:srgbClr val="000000"/);
});

test('merged cells: every covered cell carries its origin cell\'s tcPr (borders, fill, margins, anchor)', async () => {
  const pkg = await render([{ id: 'm', bg: '#FFFFFF', elements: [
    { t: 'table', x: 1, y: 1, w: 4, colW: [1, 1, 1, 1], rowH: [0.3, 0.3, 0.3],
      rows: [
        ['a', 'b', 'c', { text: 'D', rowSpan: 3, fill: '#FF0000', valign: 'top' }],
        [{ text: 'E', rowSpan: 2, colSpan: 2, fill: '#00FF00', border: { left: { color: '#123456', pt: 2 } } }, 'f'],
        ['g'],
      ] },
  ] }]);
  const sx = await pkg.read('ppt/slides/slide1.xml');
  assert.doesNotMatch(sx, /<a:tcPr\/>/, 'no bare covered cell left');
  const grid = [...sx.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map((r) =>
    [...r[1].matchAll(/<a:tc\b([^>]*)>([\s\S]*?)<\/a:tc>/g)].map((c) => ({ attrs: c[1].trim(), tcPr: /<a:tcPr[\s\S]*?<\/a:tcPr>/.exec(c[2])[0] })));
  const D = grid[0][3].tcPr, E = grid[1][0].tcPr;
  assert.match(D, /anchor="t"[\s\S]*FF0000/);
  assert.match(E, /<a:lnL w="25400"[\s\S]*00FF00/);
  // covered cells of D (col 3, rows 1-2) and of E (r1c1, r2c0, r2c1) copy their origin
  assert.equal(grid[1][3].tcPr, D);
  assert.equal(grid[2][3].tcPr, D);
  assert.equal(grid[1][1].tcPr, E);
  assert.equal(grid[2][0].tcPr, E);
  assert.equal(grid[2][1].tcPr, E);
  assert.deepEqual(grid.map((r) => r.map((c) => c.attrs)), [
    ['', '', '', 'rowSpan="3"'],
    ['rowSpan="2" gridSpan="2"', 'rowSpan="2" hMerge="1"', '', 'vMerge="1"'],
    ['gridSpan="2" vMerge="1"', 'vMerge="1" hMerge="1"', '', 'vMerge="1"'],
  ], 'merge attributes untouched');
  // the visible cells are untouched by the post-process
  assert.equal(grid[1][2].tcPr, grid[0][0].tcPr);
});

test('fillCoveredCells leaves tables without merges, and non-bare covered cells, alone', () => {
  const plain = '<a:tbl><a:tr h="1"><a:tc><a:txBody/><a:tcPr anchor="ctr"/></a:tc></a:tr></a:tbl>';
  assert.equal(fillCoveredCells(plain), plain);
  const own = '<a:tbl><a:tr h="1"><a:tc gridSpan="2"><a:txBody/><a:tcPr anchor="t"/></a:tc><a:tc hMerge="1"><a:txBody/><a:tcPr anchor="b"/></a:tc></a:tr></a:tbl>';
  assert.equal(fillCoveredCells(own), own, 'a covered cell that already has its own tcPr is kept');
  const bare = '<a:tbl><a:tr h="1"><a:tc gridSpan="2"><a:txBody/><a:tcPr anchor="t"/></a:tc><a:tc hMerge="1"><a:tcPr/></a:tc></a:tr></a:tbl>';
  assert.equal(fillCoveredCells(bare), bare.replace('<a:tc hMerge="1"><a:tcPr/>', '<a:tc hMerge="1"><a:tcPr anchor="t"/>'));
});

test('doughnut: reference chart structure, seams, firstSliceAng, workbook link kept', async () => {
  const pkg = await render([{ id: 'd', bg: '#FFFFFF', elements: [doughnut(11.35, 2152, 35, 3)] }]);
  const { path, xml } = await chartPart(pkg, 1, 0);
  assertWellFormed(xml, path);
  assert.match(xml, /<c:doughnutChart><c:varyColors val="1"\/><c:ser><c:idx val="0"\/><c:order val="0"\/><c:tx><c:strRef><c:f>Sheet1!\$B\$1<\/c:f>/);
  assert.match(xml, /<c:dPt><c:idx val="0"\/><c:spPr><a:solidFill><a:srgbClr val="00897B"\/><\/a:solidFill><a:ln w="15875"><a:solidFill><a:srgbClr val="FFFFFF"\/>/);
  assert.match(xml, /<c:dPt><c:idx val="1"\/><c:spPr><a:solidFill><a:srgbClr val="7C3AED"\/>/);
  assert.match(xml, /<c:f>Sheet1!\$A\$2:\$A\$3<\/c:f>[\s\S]*<c:v>KAMC<\/c:v>[\s\S]*<c:v>SGH<\/c:v>/);
  assert.match(xml, /<c:formatCode>#,##0<\/c:formatCode><c:ptCount val="2"\/><c:pt idx="0"><c:v>2152<\/c:v><\/c:pt><c:pt idx="1"><c:v>35<\/c:v>/);
  assert.match(xml, /<c:firstSliceAng val="3"\/><c:holeSize val="50"\/>/);
  assert.match(xml, /<c:showVal val="0"\/>[\s\S]*<c:showLeaderLines val="1"\/>/);
  assert.doesNotMatch(xml, /<c:legend>|<c:title>/);
  assert.match(xml, /<c:x val="0"\/><c:y val="0"\/><c:w val="1"\/><c:h val="1"\/>/);
  // the workbook relationship pptxgenjs wrote is still the one referenced
  const rid = /<c:externalData r:id="([^"]+)"/.exec(xml)[1];
  const rels = await pkg.read(path.replace('charts/', 'charts/_rels/') + '.rels');
  assert.match(rels, new RegExp(`Id="${rid}"[^>]*embeddings/Microsoft_Excel_Worksheet\\d+\\.xlsx`));
});

test('doughnut with every value 0 and emptyColor → one full neutral point, no seam', () => {
  const xml = buildChartXml(doughnut(0.89, 0, 0, 0, { emptyColor: '#E2E8F0' }), { rid: 'rId1' });
  assert.match(xml, /<c:dPt><c:idx val="0"\/><c:spPr><a:solidFill><a:srgbClr val="E2E8F0"\/><\/a:solidFill><a:ln><a:noFill\/><\/a:ln>/);
  assert.equal((xml.match(/<c:dPt>/g) || []).length, 1);
  assert.match(xml, /<c:pt idx="0"><c:v>1<\/c:v><\/c:pt>/);
  // without emptyColor the zero values are kept (PowerPoint draws nothing)
  assert.match(buildChartXml(doughnut(0.89, 0, 0, 0)), /<c:pt idx="0"><c:v>0<\/c:v>/);
});

test('barStacked100: percent-stacked bar, gap/overlap, hidden reversed axes, track series without seam', async () => {
  const pkg = await render([{ id: 'f', bg: '#FFFFFF', elements: [funnel()] }]);
  const { path, xml } = await chartPart(pkg, 1, 0);
  assertWellFormed(xml, path);
  assert.match(xml, /<c:barChart><c:barDir val="bar"\/><c:grouping val="percentStacked"\/><c:ser>/);
  assert.match(xml, /<c:gapWidth val="100"\/><c:overlap val="100"\/>/);
  const sers = [...xml.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)].map((m) => m[1]);
  assert.equal(sers.length, 3);
  assert.match(sers[0], /<c:f>Sheet1!\$B\$1<\/c:f>[\s\S]*<a:srgbClr val="00897B"\/><\/a:solidFill><a:ln w="15875">/);
  assert.match(sers[2], /<c:f>Sheet1!\$D\$1<\/c:f>[\s\S]*<a:srgbClr val="F1F5F9"\/><\/a:solidFill><a:ln><a:noFill\/><\/a:ln>/);
  assert.match(sers[2], /<c:formatCode>0<\/c:formatCode>/);
  assert.doesNotMatch(xml, /<c:dLbls>/);
  assert.match(xml, /<c:catAx><c:axId val="[^"]+"\/><c:scaling><c:orientation val="maxMin"\/><\/c:scaling><c:delete val="1"\/><c:axPos val="l"\/>/);
  assert.match(xml, /<c:valAx><c:axId val="[^"]+"\/><c:scaling><c:orientation val="maxMin"\/><c:max val="1"\/><c:min val="0"\/><\/c:scaling><c:delete val="1"\/><c:axPos val="b"\/>/);
  assert.doesNotMatch(xml, /<c:majorGridlines>|<c:legend>/);
});

test('colStackedTotal: per-point label deletes, ;;; format, invisible total line, two-line rich labels', async () => {
  const pkg = await render([{ id: 'm', bg: '#FFFFFF', elements: [monthly()] }]);
  const { path, xml } = await chartPart(pkg, 1, 0);
  assertWellFormed(xml, path);
  assert.match(xml, /<c:barChart><c:barDir val="col"\/><c:grouping val="stacked"\/>/);
  assert.match(xml, /<c:gapWidth val="70"\/><c:overlap val="100"\/>/);
  const bar = /<c:barChart>[\s\S]*<\/c:barChart>/.exec(xml)[0];
  const [kamc, sgh] = [...bar.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)].map((m) => m[1]);
  assert.match(kamc, /<c:dLbls><c:dLbl><c:idx val="0"\/><c:delete val="1"\/><\/c:dLbl><c:numFmt formatCode="#,##0;;;" sourceLinked="0"\/>/);
  assert.match(kamc, /<a:defRPr sz="800" b="1"><a:solidFill><a:srgbClr val="FFFFFF"\/>[\s\S]*<c:dLblPos val="ctr"\/>/);
  assert.match(sgh, /<c:dLbl><c:idx val="5"\/><c:delete val="1"\/><\/c:dLbl><c:dLbl><c:idx val="6"\/><c:delete val="1"\/><\/c:dLbl>/);
  const line = /<c:lineChart>([\s\S]*)<\/c:lineChart>/.exec(xml)[1];
  assert.match(line, /<c:f>Sheet1!\$D\$1<\/c:f>[\s\S]*<c:v>الإجمالي<\/c:v>/);
  assert.match(line, /<c:spPr><a:ln w="12700"><a:noFill\/><\/a:ln><\/c:spPr><c:marker><c:symbol val="none"\/><\/c:marker>/);
  const rich = [...line.matchAll(/<c:dLbl><c:idx val="(\d)"\/><c:tx><c:rich>([\s\S]*?)<\/c:rich>/g)];
  assert.deepEqual(rich.map((m) => +m[1]), [5, 6]);
  assert.deepEqual([...rich[0][2].matchAll(/sz="(\d+)" b="1"><a:solidFill><a:srgbClr val="(\w+)"\/>[\s\S]*?<a:t>([^<]+)</g)].map((m) => m.slice(1).join('|')),
    ['900|1E293B|463', '800|7C3AED|22']);
  assert.match(rich[1][2], /<a:t>103<\/a:t>[\s\S]*<a:t>13<\/a:t>/);
  assert.match(line, /<c:numFmt formatCode="#,##0" sourceLinked="0"\/>[\s\S]*<a:defRPr sz="900" b="1">[\s\S]*<c:dLblPos val="t"\/>/);
  assert.match(line, /<c:pt idx="5"><c:v>463<\/c:v><\/c:pt><c:pt idx="6"><c:v>103<\/c:v>/, 'totals = Σ series');
  assert.match(xml, /<c:catAx>[\s\S]*<c:orientation val="maxMin"\/>[\s\S]*<c:delete val="0"\/><c:axPos val="b"\/><c:majorTickMark val="out"\/>[\s\S]*<a:ln w="9525"><a:solidFill><a:srgbClr val="BFC7D5"\/>[\s\S]*<a:defRPr sz="900" b="0"><a:solidFill><a:srgbClr val="1E293B"\/>/);
  assert.match(xml, /<c:valAx><c:axId val="[^"]+"\/><c:scaling\/><c:delete val="0"\/><c:axPos val="l"\/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E5E9F0"\/>[\s\S]*<c:majorTickMark val="none"\/>[\s\S]*<a:ln><a:noFill\/><\/a:ln><\/c:spPr><c:txPr>[\s\S]*<a:defRPr sz="800" b="0"><a:solidFill><a:srgbClr val="94A3B8"\/>/);
  assert.match(xml, /<c:x val="0.02"\/><c:y val="0.07"\/><c:w val="0.86"\/><c:h val="0.83"\/>/);
});

test('chart parts are matched by slide order + rels: legacy and unknown kinds around native ones', async () => {
  const pkg = await render([
    { id: 's1', bg: '#FFFFFF', elements: [legacyLine] },
    { id: 's2', bg: '#FFFFFF', elements: [
      legacyLine,
      { t: 'chart', kind: 'mystery', x: 1, y: 1, w: 1, h: 1, categories: [], series: [] },   // dropped, writes no part
      doughnut(1, 10, 5, 60),
      { t: 'group', children: [funnel()] },
    ] },
  ]);
  assert.match((await chartPart(pkg, 1, 0)).xml, /<c:roundedCorners val="1"\/>/);
  assert.match((await chartPart(pkg, 2, 0)).xml, /<c:lineChart>/);
  assert.match((await chartPart(pkg, 2, 0)).xml, /<c:roundedCorners val="1"\/>/, 'legacy part untouched');
  assert.match((await chartPart(pkg, 2, 1)).xml, /<c:firstSliceAng val="60"\/>/);
  assert.match((await chartPart(pkg, 2, 2)).xml, /percentStacked/);
});

test('patchPptx leaves a slide alone when its chart count does not match the plan', async () => {
  const P = new PptxGenJS();
  P.addSlide().addChart(P.ChartType.doughnut, [{ name: 'x', labels: ['a', 'b'], values: [1, 2] }], { x: 1, y: 1, w: 1, h: 1 });
  const buf = await P.write({ outputType: 'arraybuffer' });
  const warn = console.warn; let warned = '';
  console.warn = (m) => { warned += m; };
  try {
    const blob = await patchPptx(buf, [{ runs: false, charts: [{ el: doughnut(1, 1, 2, 0) }, { el: doughnut(1, 1, 2, 0) }] }], JSZip);
    const pkg = await unzipPptx(blob);
    const sx = await pkg.read('ppt/slides/slide1.xml');
    const rid = /<c:chart\b[^>]*r:id="([^"]+)"/.exec(sx)[1];
    assert.ok(rid);
    const only = pkg.names.find((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    assert.match(await pkg.read(only), /<c:roundedCorners val="1"\/>/, 'native pptxgenjs part kept');
    assert.match(warned, /left native/);
  } finally { console.warn = warn; }
});

test('dedupeParagraphProps keeps the first <a:pPr> of each paragraph only', () => {
  const x = '<a:p><a:pPr rtl="1" algn="r"><a:buNone/></a:pPr><a:r><a:t>a</a:t></a:r><a:pPr rtl="1" algn="r"><a:buNone/></a:pPr><a:r><a:t>b</a:t></a:r></a:p><a:p><a:pPr algn="l"/><a:r><a:t>c</a:t></a:r></a:p>';
  assert.equal(dedupeParagraphProps(x), '<a:p><a:pPr rtl="1" algn="r"><a:buNone/></a:pPr><a:r><a:t>a</a:t></a:r><a:r><a:t>b</a:t></a:r></a:p><a:p><a:pPr algn="l"/><a:r><a:t>c</a:t></a:r></a:p>');
});

test('without JSZip the native kinds still render (pptxgenjs approximation), with a warning', async () => {
  const saved = globalThis.JSZip;
  const warn = console.warn; let warned = '';
  console.warn = (m) => { warned += m; };
  try {
    globalThis.JSZip = undefined;
    const blob = await renderPptx([{ id: 'x', bg: '#FFFFFF', elements: [funnel()] }], { PptxGenJS });
    assert.ok(blob instanceof Blob);
    assert.match(warned, /JSZip unavailable/);
  } finally { globalThis.JSZip = saved; console.warn = warn; }
});
