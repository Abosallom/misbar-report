// src/render/charts-svg.js
// Inline-SVG renderers for the three chart kinds used by the deck (see contracts.js):
//   colClustered — grouped vertical bars + data labels + bottom legend (chart1)
//   line         — two series (circle/diamond markers, dashed option), y-axis 'الأيام',
//                  gaps for null values (chart2)
//   barH         — horizontal bars, category labels on the RTL (right) side, value labels (chart3)
// All output is self-contained SVG markup with real Cairo text. Colors/sizes mirror the
// original ppt/charts/chart{1,2,3}.xml. Coordinates are px (inches * 96).
import { COLORS as C } from '../theme.js';

const PXIN = 96;
const GRID = '#D9D9D9';
const AXIS = '#BFBFBF';
const LABEL = C.slate600;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TIERS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceMax(v) {
  if (!(v > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const tier = TIERS.find((t) => n <= t + 1e-9) || 10;
  return tier * pow;
}
const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

function txt(x, y, s, size, opts = {}) {
  const anchor = opts.anchor || 'middle';
  const fill = opts.fill || LABEL;
  const weight = opts.bold ? 700 : 400;
  const rot = opts.rot ? ` transform="rotate(${opts.rot} ${x} ${y})"` : '';
  // Always pin direction — the host page is dir=rtl and SVG <text> would otherwise
  // inherit it, flipping anchoring of Latin labels.
  const dir = ` direction="${opts.rtl ? 'rtl' : 'ltr'}" unicode-bidi="plaintext"`;
  return `<text x="${x}" y="${y}" font-family="Cairo, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${dir}${rot}>${esc(s)}</text>`;
}

// ---------------------------------------------------------------------------
function colClustered(el) {
  const W = el.w * PXIN, H = el.h * PXIN;
  const legendH = el.opts?.legend === 'bottom' ? 26 : 6;
  const m = { top: 14, right: 12, bottom: 20 + legendH, left: 34 };
  const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
  const cats = el.categories, ns = el.series.length;
  const allVals = el.series.flatMap((s) => s.values).filter((v) => v != null);
  const vmax = niceMax(Math.max(1, ...allVals));
  const ticks = 5, step = vmax / ticks;
  const yOf = (v) => m.top + ph - (v / vmax) * ph;
  let s = '';
  // gridlines + y labels
  for (let i = 0; i <= ticks; i++) {
    const v = step * i, y = yOf(v);
    s += `<line x1="${m.left}" y1="${y}" x2="${m.left + pw}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
    s += txt(m.left - 6, y + 3, fmtNum(v), 8, { anchor: 'end' });
  }
  // bars
  const slot = pw / cats.length;
  const groupW = slot * 0.68, barW = groupW / ns, gx = (slot - groupW) / 2;
  cats.forEach((cat, ci) => {
    const cx = m.left + ci * slot;
    el.series.forEach((ser, si) => {
      const v = ser.values[ci] ?? 0;
      const bh = (v / vmax) * ph;
      const bx = cx + gx + si * barW;
      const by = m.top + ph - bh;
      if (v > 0) s += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${(barW * 0.92).toFixed(1)}" height="${bh.toFixed(1)}" fill="${ser.color}"/>`;
      if (el.opts?.dataLabels && v > 0) s += txt(bx + barW * 0.46, by - 3, fmtNum(v), 7.5, { fill: C.slate900 });
    });
    s += txt(cx + slot / 2, m.top + ph + 13, cat, 8.5, { rtl: true });
  });
  // axis baseline
  s += `<line x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" stroke="${AXIS}" stroke-width="1"/>`;
  // legend (RTL order)
  if (el.opts?.legend === 'bottom') s += legend(el.series, W, H - legendH + 12);
  return svg(W, H, s);
}

// ---------------------------------------------------------------------------
function line(el) {
  const W = el.w * PXIN, H = el.h * PXIN;
  const legendH = el.opts?.legend === 'bottom' ? 24 : 6;
  const m = { top: 12, right: 14, bottom: 20 + legendH, left: 40 };
  const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
  const cats = el.categories;
  const allVals = el.series.flatMap((s) => s.values).filter((v) => v != null);
  const vmax = niceMax(Math.max(1, ...allVals));
  const ticks = 5, step = vmax / ticks;
  const yOf = (v) => m.top + ph - (v / vmax) * ph;
  const xOf = (i) => m.left + (i + 0.5) * (pw / cats.length);
  let s = '';
  for (let i = 0; i <= ticks; i++) {
    const v = step * i, y = yOf(v);
    s += `<line x1="${m.left}" y1="${y}" x2="${m.left + pw}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
    s += txt(m.left - 6, y + 3, fmtNum(v), 8, { anchor: 'end' });
  }
  // y-axis title 'الأيام' (rotated, on the left)
  if (el.opts?.title) s += txt(12, m.top + ph / 2, el.opts.title, 9, { rot: -90, rtl: true, fill: LABEL });
  // category labels
  cats.forEach((cat, i) => { s += txt(xOf(i), m.top + ph + 13, cat, 8.5, { rtl: true }); });
  s += `<line x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" stroke="${AXIS}" stroke-width="1"/>`;
  // series
  el.series.forEach((ser) => {
    // split into contiguous non-null segments (gaps for null)
    let seg = [];
    const flush = () => {
      if (seg.length >= 2) s += `<polyline points="${seg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${ser.color}" stroke-width="2.25"${ser.dash ? ' stroke-dasharray="7 5"' : ''}/>`;
      seg = [];
    };
    ser.values.forEach((v, i) => { if (v == null) flush(); else seg.push({ x: xOf(i), y: yOf(v) }); });
    flush();
    // markers
    ser.values.forEach((v, i) => {
      if (v == null) return;
      const x = xOf(i), y = yOf(v);
      const fill = ser.dash ? C.white : ser.color;
      if (ser.marker === 'diamond') s += `<path d="M ${x} ${y - 4.5} L ${x + 4.5} ${y} L ${x} ${y + 4.5} L ${x - 4.5} ${y} Z" fill="${fill}" stroke="${ser.color}" stroke-width="1.5"/>`;
      else s += `<circle cx="${x}" cy="${y}" r="3.6" fill="${fill}" stroke="${ser.color}" stroke-width="1.5"/>`;
    });
  });
  if (el.opts?.legend === 'bottom') s += legend(el.series, W, H - legendH + 12);
  return svg(W, H, s);
}

// ---------------------------------------------------------------------------
function barH(el) {
  const W = el.w * PXIN, H = el.h * PXIN;
  const m = { top: 6, right: 8, bottom: 6, left: 30 };
  const labelW = Math.min(300, W * 0.28);              // category-name column on the RIGHT
  const baseX = W - m.right - labelW;                   // value=0 baseline (bars grow left)
  const plotW = baseX - m.left;
  const cats = el.categories, ser = el.series[0];
  const vmax = niceMax(Math.max(1, ...ser.values.filter((v) => v != null)));
  const rowH = (H - m.top - m.bottom) / cats.length;
  const bh = Math.min(rowH * 0.62, 16);
  let s = '';
  // vertical gridlines
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = (vmax / ticks) * i;
    const x = baseX - (v / vmax) * plotW;
    s += `<line x1="${x.toFixed(1)}" y1="${m.top}" x2="${x.toFixed(1)}" y2="${H - m.bottom}" stroke="${GRID}" stroke-width="1"/>`;
  }
  cats.forEach((cat, i) => {
    // index 0 at the BOTTOM (ascending upward) — matches PptxGenJS and the source deck
    const cy = m.top + (cats.length - 1 - i) * rowH + rowH / 2;
    const v = ser.values[i] ?? 0;
    const len = (v / vmax) * plotW;
    s += `<rect x="${(baseX - len).toFixed(1)}" y="${(cy - bh / 2).toFixed(1)}" width="${len.toFixed(1)}" height="${bh.toFixed(1)}" fill="${ser.color}"/>`;
    if (el.opts?.dataLabels) s += txt(baseX - len - 4, cy + 3, fmtNum(v), 8, { anchor: 'end', fill: C.slate900, bold: true });
    // category label in the right column, right-aligned against the edge
    s += txt(W - m.right, cy + 3, cat, 8, { anchor: 'end', fill: LABEL });
  });
  s += `<line x1="${baseX}" y1="${m.top}" x2="${baseX}" y2="${H - m.bottom}" stroke="${AXIS}" stroke-width="1"/>`;
  return svg(W, H, s);
}

// ---------------------------------------------------------------------------
function legend(series, W, y) {
  // Item ORDER matches PptxGenJS/the source deck: series[0] leftmost. Each item
  // itself is still drawn swatch-right-of-label per RTL habit.
  const items = series.map((s) => ({ name: s.name, color: s.color })).reverse();
  const gap = 18, sw = 11, textGap = 5;
  const widths = items.map((it) => sw + textGap + it.name.length * 6.2 + gap);
  const total = widths.reduce((a, b) => a + b, 0) - gap;
  let x = (W + total) / 2; // start at right edge of the centered block
  let s = '';
  items.forEach((it, i) => {
    const w = widths[i] - gap;
    const bx = x - sw;
    s += `<rect x="${bx.toFixed(1)}" y="${y - sw + 2}" width="${sw}" height="${sw}" rx="1.5" fill="${it.color}"/>`;
    s += txt(bx - textGap, y + 1, it.name, 8.5, { anchor: 'end', rtl: true });
    x -= (w + gap);
  });
  return s;
}

function svg(W, H, body) {
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="Cairo, sans-serif" style="display:block">${body}</svg>`;
}

/** Render a chart element (contracts.js chart kind) to an SVG markup string. */
export function renderChartSVG(el) {
  switch (el.kind) {
    case 'colClustered': return colClustered(el);
    case 'line': return line(el);
    case 'barH': return barH(el);
    default: return svg(el.w * PXIN, el.h * PXIN, txt(el.w * PXIN / 2, el.h * PXIN / 2, 'chart:' + el.kind, 10));
  }
}

export default renderChartSVG;
