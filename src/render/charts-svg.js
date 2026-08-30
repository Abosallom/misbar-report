// src/render/charts-svg.js
// Inline-SVG renderers for the three chart kinds used by the deck (see contracts.js):
//   colClustered — grouped vertical bars + data labels + bottom legend (chart1)
//   line         — two series (circle/diamond markers, dashed option), value-axis title 'الأيام',
//                  gaps for null values (chart2)
//   barH         — horizontal bars, category labels on the RTL (right) side, value labels (chart3)
// All output is self-contained SVG markup with real Cairo text. Colors/sizes mirror the
// original ppt/charts/chart{1,2,3}.xml. Coordinates are px (inches * 96).
//
// ===========================================================================
// DIRECTION CONTRACT — the deck is Arabic, so the charts are RTL *natively*
// ===========================================================================
// The plot coordinate system, not the data, carries the direction:
//   · CATEGORY AXIS progresses RIGHT → LEFT: category index 0 is drawn in the
//     RIGHTMOST slot, index n-1 in the leftmost. (see catAxis() below)
//   · The VALUE AXIS line, its tick marks and its tick labels sit on the RIGHT
//     edge of the plot; tick labels are right-aligned (numbers stay LTR).
//   · Inside a clustered group the series mirror too — series[0] is the
//     RIGHTMOST bar — because a reversed category axis mirrors the whole plot
//     (this is what PowerPoint does with <c:orientation val="maxMin"/>).
//   · The LEGEND runs right → left: series[0] is the rightmost entry.
//
// THIS MODULE NEVER RE-ORDERS DATA. `categories` / `series[].values` are
// consumed at their natural index; only the index→x mapping is mirrored.
// Therefore callers MUST hand over arrays in NATURAL order (chronological,
// oldest at index 0) and the RTL mapping alone puts the oldest month at the
// right. A caller that has ALREADY pre-reversed its arrays would cancel this
// mapping out (double reverse ⇒ the chart reads LTR again) and must opt out
// explicitly with `opts.catDir = 'ltr'` on that chart element. There is
// exactly one knob (CAT_DIR / opts.catDir) so the two layers cannot fight
// silently.
import { COLORS as C } from '../theme.js?v=v2026-08-30.2';

const PXIN = 96;
/** Default category progression for this (Arabic) deck: index 0 on the right. */
export const CAT_DIR = 'rtl';
/** Per-element escape hatch for specs that already pre-reversed their arrays. */
const catDirOf = (el) => (el?.opts?.catDir === 'ltr' ? 'ltr' : CAT_DIR);
/**
 * Category-axis geometry. Returns the slot width plus bandX(i) = LEFT edge of
 * the band that category index i occupies. In 'rtl' (default) bandX is
 * mirrored, so bandX(0) > bandX(n-1): the first category is the rightmost.
 */
function catAxis(el, x0, plotW, n) {
  const rtl = catDirOf(el) === 'rtl';
  const slot = plotW / Math.max(1, n);
  return { rtl, slot, bandX: (i) => x0 + (rtl ? (n - 1 - i) : i) * slot, mid: (i) => x0 + (rtl ? (n - 1 - i) : i) * slot + slot / 2 };
}
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

// Arabic (incl. supplement/extended + presentation forms) — same test html-renderer uses.
const isArabic = (s) => /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(String(s));

function txt(x, y, s, size, opts = {}) {
  const str = String(s);
  // opts.anchor is a VISUAL intent: 'end' = right edge at x, 'start' = left edge at x.
  // SVG text-anchor is LOGICAL ('end' = end of the inline flow), so for an RTL base
  // direction it must be MIRRORED — otherwise an Arabic label asked to sit flush right
  // gets its LEFT edge pinned at x and overruns to the right (it used to collide with the
  // legend swatch next to it). Base direction here matches what unicode-bidi:plaintext
  // resolves below: explicit opts.rtl, else first-strong detection.
  const rtlBase = !!opts.rtl || isArabic(str);
  const want = opts.anchor || 'middle';
  const anchor = want === 'middle' ? 'middle' : (rtlBase ? (want === 'end' ? 'start' : 'end') : want);
  const fill = opts.fill || LABEL;
  const weight = opts.bold ? 700 : 400;
  const rot = opts.rot ? ` transform="rotate(${opts.rot} ${x} ${y})"` : '';
  // BIDI: never inherit the host page's dir=rtl. `unicode-bidi:plaintext` gives every
  // label its OWN base direction from its first strong character (UAX#9 P2/P3), which is
  // exactly what mixed strings need:
  //   "بعد الـ Dispatch"  → RTL base, the Latin word stays LTR inside it (no mangling)
  //   "NUPCO | Lean"       → LTR base, kept verbatim
  //   "1,240" / "3.4"      → no strong char ⇒ LTR base, so numbers never mirror.
  // `direction` is still emitted as the declared fallback for renderers that ignore
  // plaintext (it only matters when a string has no strong character either way).
  const dir = ` direction="${opts.rtl ? 'rtl' : 'ltr'}" unicode-bidi="plaintext"`;
  return `<text x="${x}" y="${y}" font-family="Cairo, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${dir}${rot}>${esc(s)}</text>`;
}

// ---------------------------------------------------------------------------
function colClustered(el) {
  const W = el.w * PXIN, H = el.h * PXIN;
  const legendH = el.opts?.legend === 'bottom' ? 26 : 6;
  // RTL: the value axis and its tick-label column are on the RIGHT, so the wide
  // margin is m.right; m.left is only plot padding.
  const m = { top: 14, right: 34, bottom: 20 + legendH, left: 12 };
  const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
  const cats = el.categories, ns = el.series.length;
  const allVals = el.series.flatMap((s) => s.values).filter((v) => v != null);
  const vmax = niceMax(Math.max(1, ...allVals));
  const ticks = 5, step = vmax / ticks;
  const yOf = (v) => m.top + ph - (v / vmax) * ph;
  const ax = catAxis(el, m.left, pw, cats.length);
  const valAxisX = m.left + pw;            // value axis: RIGHT edge of the plot
  let s = '';
  // gridlines + value-axis tick labels (right-aligned column outside the axis)
  for (let i = 0; i <= ticks; i++) {
    const v = step * i, y = yOf(v);
    s += `<line x1="${m.left}" y1="${y}" x2="${valAxisX}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
    s += `<line x1="${valAxisX}" y1="${y}" x2="${valAxisX + 3}" y2="${y}" stroke="${AXIS}" stroke-width="1"/>`;
    s += txt(W - 2, y + 3, fmtNum(v), 8, { anchor: 'end' });
  }
  // bars — within a cluster series[0] is the RIGHTMOST bar when RTL (the whole
  // plot mirrors, exactly like PowerPoint's reversed category axis).
  const slot = ax.slot;
  const groupW = slot * 0.68, barW = groupW / ns, gx = (slot - groupW) / 2;
  cats.forEach((cat, ci) => {
    const cx = ax.bandX(ci);
    el.series.forEach((ser, si) => {
      const v = ser.values[ci] ?? 0;
      const bh = (v / vmax) * ph;
      const slotIdx = ax.rtl ? (ns - 1 - si) : si;
      const bx = cx + gx + slotIdx * barW;
      const by = m.top + ph - bh;
      if (v > 0) s += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${(barW * 0.92).toFixed(1)}" height="${bh.toFixed(1)}" fill="${ser.color}"/>`;
      if (el.opts?.dataLabels && v > 0) s += txt(bx + barW * 0.46, by - 3, fmtNum(v), 7.5, { fill: C.slate900 });
    });
    s += txt(cx + slot / 2, m.top + ph + 13, cat, 8.5, { rtl: true });
  });
  // category (baseline) axis + the value axis on the right
  s += `<line x1="${m.left}" y1="${m.top + ph}" x2="${valAxisX}" y2="${m.top + ph}" stroke="${AXIS}" stroke-width="1"/>`;
  s += `<line x1="${valAxisX}" y1="${m.top}" x2="${valAxisX}" y2="${m.top + ph}" stroke="${AXIS}" stroke-width="1"/>`;
  // legend (RTL order)
  if (el.opts?.legend === 'bottom') s += legend(el.series, W, H - legendH + 12);
  return svg(W, H, s);
}

// ---------------------------------------------------------------------------
function line(el) {
  const W = el.w * PXIN, H = el.h * PXIN;
  const legendH = el.opts?.legend === 'bottom' ? 24 : 6;
  // RTL: value axis + tick labels + rotated axis title all on the RIGHT.
  const m = { top: 12, right: 40, bottom: 20 + legendH, left: 14 };
  const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
  const cats = el.categories;
  const allVals = el.series.flatMap((s) => s.values).filter((v) => v != null);
  const vmax = niceMax(Math.max(1, ...allVals));
  const ticks = 5, step = vmax / ticks;
  const yOf = (v) => m.top + ph - (v / vmax) * ph;
  const ax = catAxis(el, m.left, pw, cats.length);
  const xOf = (i) => ax.mid(i);            // category index → point x (mirrored when RTL)
  const valAxisX = m.left + pw;            // value axis: RIGHT edge of the plot
  const titleW = el.opts?.title ? 12 : 0;  // rotated axis-title gutter (right)
  let s = '';
  for (let i = 0; i <= ticks; i++) {
    const v = step * i, y = yOf(v);
    s += `<line x1="${m.left}" y1="${y}" x2="${valAxisX}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
    s += `<line x1="${valAxisX}" y1="${y}" x2="${valAxisX + 3}" y2="${y}" stroke="${AXIS}" stroke-width="1"/>`;
    s += txt(W - titleW - 2, y + 3, fmtNum(v), 8, { anchor: 'end' });
  }
  // value-axis title 'الأيام' — rotated, mirrored to the RIGHT edge for RTL
  if (el.opts?.title) s += txt(W - 4, m.top + ph / 2, el.opts.title, 9, { rot: 90, rtl: true, fill: LABEL });
  // category labels
  cats.forEach((cat, i) => { s += txt(xOf(i), m.top + ph + 13, cat, 8.5, { rtl: true }); });
  s += `<line x1="${m.left}" y1="${m.top + ph}" x2="${valAxisX}" y2="${m.top + ph}" stroke="${AXIS}" stroke-width="1"/>`;
  s += `<line x1="${valAxisX}" y1="${m.top}" x2="${valAxisX}" y2="${m.top + ph}" stroke="${AXIS}" stroke-width="1"/>`;
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
  // data labels (round-6 user rule: 'a line chart with markers and data labels').
  // Series 0 labels ABOVE its points, later series BELOW — the reference image's own
  // arrangement (solid actual above, dashed expected below), and a deterministic rule
  // that keeps the two series' labels apart even where the lines cross. The guard is
  // `v == null` — NEVER a truthiness/`> 0` test and never `?? 0`: a gap month must have
  // no label at all (0 would read 'same-day turnaround'), while a legitimate 0.0 value
  // keeps its label. One decimal by design: the deck's only line chart is the turnaround
  // one, whose values are report-style 1-decimal days — 2 must print '2.0', which the
  // axis's fmtNum would strip. Painted in the series colour, matching the image.
  if (el.opts?.dataLabels) {
    el.series.forEach((ser, si) => {
      ser.values.forEach((v, i) => {
        if (v == null) return;
        s += txt(xOf(i), yOf(v) + (si === 0 ? -8 : 14), Number(v).toFixed(1), 7.5, { fill: ser.color });
      });
    });
  }
  if (el.opts?.legend === 'bottom') s += legend(el.series, W, H - legendH + 12);
  return svg(W, H, s);
}

// ---------------------------------------------------------------------------
function barH(el) {
  // Already RTL by construction: the value axis (zero baseline) is the vertical
  // line on the RIGHT and bars grow LEFTwards; the category-name column is on
  // the far right. The category axis here is VERTICAL, so the RTL category
  // mapping in catAxis() does not apply — index 0 stays at the bottom, which is
  // what PptxGenJS/PowerPoint does for barDir:'bar'.
  const W = el.w * PXIN, H = el.h * PXIN;
  const legendH = el.opts?.legend === 'bottom' ? 20 : 0;
  const m = { top: 6, right: 8, bottom: 6 + legendH, left: 30 };
  const labelW = Math.min(300, W * 0.28);              // category-name column on the RIGHT
  const baseX = W - m.right - labelW;                   // value=0 baseline (bars grow left)
  const plotW = baseX - m.left;
  const cats = el.categories, ser = el.series, ns = ser.length;
  const catFont = el.opts?.catFont || 8;
  const allVals = ser.flatMap((se) => se.values.filter((v) => v != null));
  const vmax = niceMax(Math.max(1, ...allVals));
  const rowH = (H - m.top - m.bottom) / cats.length;
  const groupH = Math.min(rowH * 0.72, 20);            // total height of the clustered pair
  const bh = groupH / ns;                              // one bar per series
  let s = '';
  // vertical gridlines
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = (vmax / ticks) * i;
    const x = baseX - (v / vmax) * plotW;
    s += `<line x1="${x.toFixed(1)}" y1="${m.top}" x2="${x.toFixed(1)}" y2="${H - m.bottom}" stroke="${GRID}" stroke-width="1"/>`;
  }
  const placedLabels = []; // value-label collision avoidance across bars/rows
  cats.forEach((cat, i) => {
    // index 0 at the BOTTOM (ascending upward) — matches PptxGenJS and the source deck
    const cy = m.top + (cats.length - 1 - i) * rowH + rowH / 2;
    const y0 = cy - groupH / 2;
    ser.forEach((se, si) => {
      const v = se.values[i] ?? 0;
      const len = (v / vmax) * plotW;
      const by = y0 + si * bh;
      s += `<rect x="${(baseX - len).toFixed(1)}" y="${by.toFixed(1)}" width="${len.toFixed(1)}" height="${bh.toFixed(1)}" fill="${se.color}"/>`;
      if (el.opts?.dataLabels && v > 0) {
        // Cairo ink (~13px at 7pt) is taller than one thin bar, so labels of
        // adjacent bars/rows can graze. Deterministic collision-avoidance: nudge
        // left until clear of every previously placed label.
        const labelFont = ns > 1 ? 6.5 : 7;
        let lx = baseX - len - 3;
        const ly = by + bh / 2 + 2.5;
        for (let guard = 0; guard < 4; guard++) {
          const hit = placedLabels.some((p) => Math.abs(p.y - ly) < 11 && Math.abs(p.x - lx) < 20);
          if (!hit) break;
          lx -= 18;
        }
        placedLabels.push({ x: lx, y: ly });
        s += txt(lx, ly, fmtNum(v), labelFont, { anchor: 'end', fill: C.slate900, bold: true });
      }
    });
    // category label in the right column, right-aligned against the edge
    s += txt(W - m.right, cy + catFont * 0.36, cat, catFont, { anchor: 'end', fill: LABEL });
  });
  s += `<line x1="${baseX}" y1="${m.top}" x2="${baseX}" y2="${H - m.bottom}" stroke="${AXIS}" stroke-width="1"/>`;
  if (el.opts?.legend === 'bottom') s += legend(ser, W, H - legendH + 12);
  return svg(W, H, s);
}

// ---------------------------------------------------------------------------
function legend(series, W, y) {
  // RTL legend: entries run right → left, so series[0] is the RIGHTMOST entry
  // (matching the mirrored plot). Inside an entry the swatch is on the right and
  // the label to its left. No array reversal — items are laid out from the right
  // edge of the centered block leftwards, in natural series order.
  const items = series.map((s) => ({ name: s.name, color: s.color }));
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
