// render-svg.test.mjs — PDF/preview side of the native chart kinds (charts-svg.js):
// number formats shared with the PPTX labels, PowerPoint-like auto scale, and the
// geometry of doughnut / barStacked100 / colStackedTotal. Legacy kinds stay untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderChartSVG, fmtCode, autoScale, stackTotals } from '../src/render/charts-svg.js';

const KAMC = '#00897B', SGH = '#7C3AED';
const texts = (svg) => [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*font-size="([\d.]+)" font-weight="(\d+)" fill="([^"]+)"[^>]*>([^<]*)<\/text>/g)]
  .map((m) => ({ x: +m[1], y: +m[2], size: +m[3], weight: +m[4], fill: m[5], t: m[6] }));
const rects = (svg) => [...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" fill="([^"]+)"([^/]*)\/>/g)]
  .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], fill: m[5], rest: m[6] }));

test('fmtCode: the Excel formats the deck uses', () => {
  assert.equal(fmtCode(2187, '#,##0'), '2,187');
  assert.equal(fmtCode(2187, '0'), '2187');
  assert.equal(fmtCode(12.25, '0.0'), '12.3');
  assert.equal(fmtCode(0, '#,##0;;;'), '', 'zero section empty → hidden');
  assert.equal(fmtCode(-4, '#,##0;;;'), '', 'negative section empty → hidden');
  assert.equal(fmtCode(1234, '#,##0;;;'), '1,234');
  assert.equal(fmtCode(-1234, '#,##0'), '-1,234');
  assert.equal(fmtCode(0.392, '0%'), '39%');
  assert.equal(fmtCode(7, 'General'), '7');
  assert.equal(fmtCode(2.5, 'General'), '2.5');
  assert.equal(fmtCode(null, '#,##0'), '');
  assert.equal(fmtCode('', '#,##0'), '');
  assert.equal(fmtCode(5, '"+"0'), '+5');
});

test('autoScale: PowerPoint-like head-room and 1/2/5 major units', () => {
  assert.deepEqual(autoScale(515), { min: 0, max: 600, major: 100 });
  assert.deepEqual(autoScale(35), { min: 0, max: 40, major: 5 });
  assert.equal(autoScale(0).max > 0, true);
  assert.deepEqual(autoScale(515, { max: 1000, major: 250 }), { min: 0, max: 1000, major: 250 });
});

test('doughnut: ring of slices clockwise from 12 o\'clock + firstSliceAng, seams, hole', () => {
  const el = { kind: 'doughnut', x: 0, y: 0, w: 1.02, h: 1.02, categories: ['KAMC', 'SGH'],
    series: [{ name: 'الطلبات', values: [2152, 35], colors: [KAMC, SGH], line: { color: '#FFFFFF', pt: 1.25 } }],
    opts: { hole: 50, firstSliceAng: 3 } };
  const svg = renderChartSVG(el);
  assert.doesNotMatch(svg, /data-cairo-bold/, 'no bold-font marker: the embedded variable font serves 700');
  const paths = [...svg.matchAll(/<path d="([^"]+)" fill="([^"]+)" stroke="#FFFFFF" stroke-width="1.667"\/>/g)];
  assert.deepEqual(paths.map((p) => p[2]), [KAMC, SGH]);
  // SGH slice runs from 357.12° to 363° → its middle sits at 12 o'clock (x = centre)
  const nums = paths[1][1].match(/-?[\d.]+/g).map(Number);
  const [sx, , ex] = [nums[0], nums[1], nums[7]];
  const cx = 1.02 * 96 / 2;
  assert.ok(sx < cx && ex > cx, 'SGH slice straddles the top centre');
  // centred up to the reference's own rounding (round(180×35/2187) = 3 vs 2.88 exact → 0.12°)
  assert.ok(Math.abs((cx - sx) - (ex - cx)) < 0.3, 'and is centred on it');
  // outer radius = half the frame, inner = hole 50 %
  assert.match(paths[0][1], new RegExp(`A ${+(cx).toFixed(3)} ${+(cx).toFixed(3)} 0 1 1`));
  assert.match(paths[0][1], new RegExp(`A ${+(cx / 2).toFixed(3)} ${+(cx / 2).toFixed(3)} 0 1 0`));
});

test('doughnut: a single non-zero point is a full ring; all-zero uses emptyColor or draws nothing', () => {
  const base = { kind: 'doughnut', x: 0, y: 0, w: 1, h: 1, categories: ['KAMC', 'SGH'] };
  const full = renderChartSVG({ ...base, series: [{ values: [80, 0], colors: [KAMC, SGH], line: { color: '#FFFFFF', pt: 1.25 } }] });
  assert.equal((full.match(/<path /g) || []).length, 1);
  assert.match(full, /fill="#00897B" fill-rule="evenodd"/);
  const empty = renderChartSVG({ ...base, series: [{ values: [0, 0], colors: [KAMC, SGH] }], opts: { emptyColor: '#E2E8F0' } });
  assert.match(empty, /fill="#E2E8F0" fill-rule="evenodd"/);
  assert.doesNotMatch(empty, /stroke=/);
  assert.doesNotMatch(renderChartSVG({ ...base, series: [{ values: [0, 0] }] }), /<path /);
});

test('barStacked100: rows top-down, segments right-anchored in series order, normalised per row', () => {
  const el = { kind: 'barStacked100', x: 0, y: 0, w: 4.24, h: 2.8, categories: ['a', 'b'],
    series: [{ name: 'K', values: [60, 30], color: KAMC, line: { color: '#FFFFFF', pt: 1.25 } },
      { name: 'S', values: [40, 10], color: SGH, line: { color: '#FFFFFF', pt: 1.25 } },
      { name: 'rest', values: [0, 60], color: '#F1F5F9' }],
    opts: { gap: 100, catAxis: { hidden: true, reverse: true }, valAxis: { hidden: true, reverse: true } } };
  const W = 4.24 * 96, band = 2.8 * 96 / 2, thick = band / 2;
  const r = rects(renderChartSVG(el));
  assert.equal(r.length, 5, 'zero segment not drawn');
  const [k0, s0, k1, s1, t1] = r;
  assert.ok(Math.abs(k0.x + k0.w - W) < 0.02, 'KAMC starts at the right edge');
  assert.ok(Math.abs(k0.w - W * 0.6) < 0.02 && Math.abs(s0.w - W * 0.4) < 0.02);
  assert.ok(Math.abs(s0.x + s0.w - k0.x) < 0.02, 'SGH continues leftward');
  assert.ok(Math.abs(k0.h - thick) < 0.02 && Math.abs(k0.y - band / 4) < 0.02, 'gap 100 → bar = half the band, centred');
  assert.ok(k1.y > k0.y, 'row 0 on top');
  assert.ok(Math.abs(t1.x) < 0.02 && Math.abs(t1.w - W * 0.6) < 0.02);
  assert.match(k0.rest, /stroke="#FFFFFF"/);
  assert.doesNotMatch(t1.rest, /stroke=/, 'track series has no seam');
  assert.equal(s1.fill, SGH);
});

test('colStackedTotal: RTL columns, ;;; and hidden labels, total + second line above the stack', () => {
  const el = { kind: 'colStackedTotal', x: 0, y: 0, w: 5.7, h: 3.48, categories: ['أبريل', 'مايو', 'سبتمبر'],
    series: [
      { name: 'KAMC', values: [3, 129, 441], color: KAMC, line: { color: '#FFFFFF', pt: 1.25 }, labels: { size: 8, bold: true, color: '#FFFFFF', format: '#,##0;;;', hide: [0] } },
      { name: 'SGH', values: [0, 0, 22], color: SGH, line: { color: '#FFFFFF', pt: 1.25 }, labels: { size: 8, bold: true, color: '#FFFFFF', format: '#,##0;;;', hide: [2] } }],
    total: { name: 'الإجمالي', second: { values: [null, null, 22], color: SGH, size: 8 } },
    opts: { gap: 70, layout: { x: 0.02, y: 0.07, w: 0.86, h: 0.83 },
      catAxis: { line: { color: '#BFC7D5', pt: 0.75 }, label: { size: 9, color: '#1E293B' } },
      valAxis: { line: null, label: { size: 8, color: '#94A3B8' }, grid: { color: '#E5E9F0', pt: 0.75 } } } };
  assert.deepEqual(stackTotals(el), [3, 129, 463]);
  const svg = renderChartSVG(el);
  const t = texts(svg);
  const white = t.filter((x) => x.fill === '#FFFFFF').map((x) => x.t);
  assert.deepEqual(white, ['129', '441'], 'KAMC idx0 deleted, SGH zeros hidden by ;;; and idx2 deleted');
  const totals = t.filter((x) => x.fill === '#1E293B' && x.weight === 700).map((x) => x.t);
  assert.deepEqual(totals, ['3', '129', '463']);
  const two = t.find((x) => x.t === '22' && x.fill === SGH);
  const top = t.find((x) => x.t === '463');
  assert.ok(two && two.y > top.y && Math.abs(two.x - top.x) < 0.01, 'SGH count sits under the total');
  assert.ok(Math.abs(top.size - 12) < 0.01 && Math.abs(two.size - 10.667) < 0.01, '9 pt / 8 pt');
  // RTL: category 0 (أبريل) is the rightmost label; value-axis labels sit on the right
  const cats = t.filter((x) => ['أبريل', 'مايو', 'سبتمبر'].includes(x.t));
  assert.ok(cats[0].x > cats[1].x && cats[1].x > cats[2].x);
  const ticks = t.filter((x) => x.fill === '#94A3B8');
  // auto scale for a 463 max: 0..500 in steps of 50 (5 % head-room, 1/2/5 unit)
  assert.deepEqual(ticks.map((x) => x.t), ['0', '50', '100', '150', '200', '250', '300', '350', '400', '450', '500']);
  assert.ok(ticks.every((x) => x.x > 0.88 * 5.7 * 96));
  assert.match(svg, /stroke="#E5E9F0"/);
  assert.match(svg, /stroke="#BFC7D5"/);
  // column width = slot / (1 + gap)
  const slot = 0.86 * 5.7 * 96 / 3;
  const col = rects(svg).find((r) => r.fill === KAMC);
  assert.ok(Math.abs(col.w - slot / 1.7) < 0.02);
});

test('legacy kinds are unchanged: no marker attribute, same placeholder for unknown kinds', () => {
  const svg = renderChartSVG({ kind: 'colClustered', x: 0, y: 0, w: 6, h: 3.4, categories: ['أ'], series: [{ name: 'x', values: [1], color: '#4472C4' }], opts: {} });
  assert.doesNotMatch(svg, /data-cairo-bold/);
  assert.match(renderChartSVG({ kind: 'nope', x: 0, y: 0, w: 1, h: 1 }), /chart:nope/);
});
