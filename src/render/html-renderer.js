// src/render/html-renderer.js
// renderSlides(spec, {variant}) -> DocumentFragment of absolutely-positioned .sl-slide divs
// (1280x720 px = inches * 96). Skips internalOnly slides when variant === 'nupco'.
// html2canvas-safe: absolute positioning, solid fills, borders, border-radius only.
// No box-shadow, no CSS gap, no transforms. Charts are delegated to charts-svg.js (inline SVG).
// SlideSpec extensions for the BOTH-hospitals deck (see contracts.js) — ellipse, alpha, line.pt,
// text runs + margin, table spans / per-row heights / per-cell margin, valign, border —
// only ever ADD inline styles when their field is present, so a legacy spec renders to the
// very same HTML string as before.
import { GEOM } from '../theme.js?v=v2026-10-13.1';
import { renderChartSVG } from './charts-svg.js?v=v2026-10-13.1';

const PX = GEOM.pxPerIn;          // 96
const PT2PX = 96 / 72;            // points -> px
const isArabic = (s) => /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(String(s));

function px(v) { return `${v * PX}px`; }
function setBox(node, e) {
  const st = node.style;
  st.position = 'absolute';
  st.left = px(e.x); st.top = px(e.y);
  st.width = px(e.w); st.height = px(e.h);
}

// '#RGB' / '#RRGGBB' + alpha → rgba(); anything unparsable falls back to the colour.
function fillCss(color, alpha) {
  if (alpha == null) return color;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return color;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const a = Math.max(0, Math.min(1, Number(alpha)));
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${a})`;
}

function renderRect(e) {
  const d = document.createElement('div');
  d.className = 'sl-rect';
  // line.pt (schema): PowerPoint centres an outline ON the shape edge, half outside. The
  // div is border-box, so grow it by half the stroke on every side — the border's outer
  // edge then lands where PowerPoint's does and the inner edge where the fill starts.
  // line.pt <= 0 = NO outline in both renderers (pptxgenjs would turn width 0 into its
  // 1 pt default, so pptx-renderer writes no line instead).
  const noLine = e.line && e.line.pt != null && !(e.line.pt > 0);
  const lw = e.line && !noLine && e.line.pt != null ? (e.line.pt * PT2PX) / PX : 0;   // inches
  setBox(d, lw ? { x: e.x - lw / 2, y: e.y - lw / 2, w: e.w + lw, h: e.h + lw } : e);
  d.style.background = e.fill ? fillCss(e.fill, e.alpha) : 'transparent';
  if (e.shape === 'ellipse') d.style.borderRadius = '50%';
  else if (e.radius) d.style.borderRadius = px(e.radius + lw / 2);
  if (e.line && !noLine) d.style.border = e.line.pt != null ? `${e.line.pt * PT2PX}px solid ${e.line.color}` : `${e.line.w || 1}px solid ${e.line.color}`;
  return d;
}

// Schema margins: inches, number or [t, r, b, l] → CSS padding shorthand.
function paddingCss(m) {
  const a = Array.isArray(m) ? m : [m, m, m, m];
  return [0, 1, 2, 3].map((i) => `${(Number(a[i]) || 0) * PX}px`).join(' ');
}

function renderText(e) {
  const d = document.createElement('div');
  d.className = 'sl-text';
  setBox(d, e);
  const st = d.style;
  st.fontSize = `${(e.size || 12) * PT2PX}px`;
  st.fontWeight = e.bold ? '700' : '400';
  if (e.italic) st.fontStyle = 'italic';
  st.color = e.color || '#000';
  st.justifyContent = e.valign === 'middle' ? 'center' : e.valign === 'bottom' ? 'flex-end' : 'flex-start';
  if (e.margin != null) st.padding = paddingCss(e.margin);   // insets (PPTX bodyPr l/t/r/bIns)
  const inner = document.createElement('span');
  inner.className = 'sl-text-inner';
  const runs = Array.isArray(e.runs) && e.runs.length ? e.runs.filter((r) => r && r.text != null) : null;
  const t = runs ? runs.map((r) => String(r.text)).join('') : (e.text != null ? String(e.text) : '');
  // PARAGRAPH DIRECTION. The spec's `rtl` flag wins when present (it is what
  // pptx-renderer feeds PowerPoint's rtlMode, so both renderers agree); when it is
  // ABSENT the direction is derived from the content, because the slide root is pinned
  // `direction: ltr` (see styles/slide.css) and an unflagged Arabic string would
  // otherwise be laid out in an LTR paragraph — which pushes leading/trailing
  // punctuation, bullets and '↳'-style prefixes to the wrong end of the line. Matches
  // renderTable's per-cell rule below, and is a no-op on the current spec (every
  // Arabic text element build-spec emits already carries rtl:true).
  const rtl = e.rtl != null ? !!e.rtl : isArabic(t);
  // The direction MUST live on the element that directly parents the text node:
  // html2canvas (PDF path) reads the computed `direction` of the text container to set
  // the canvas ctx.direction it draws each run with.
  inner.style.direction = rtl ? 'rtl' : 'ltr';
  inner.style.textAlign = e.align || (rtl ? 'right' : 'left');
  if (e.lineSpacing) inner.style.lineHeight = String(e.lineSpacing);
  if (runs) {
    // One <span> per run; unset run props inherit the box's (set on the container above).
    // `br` ends the paragraph: a '\n' text node, which the pre-wrap inner span renders as
    // a line break and treats as a new bidi paragraph (same as PPTX's new <a:p>).
    runs.forEach((r) => {
      const sp = document.createElement('span');
      if (r.size != null) sp.style.fontSize = `${r.size * PT2PX}px`;
      if (r.bold != null) sp.style.fontWeight = r.bold ? '700' : '400';
      if (r.italic != null) sp.style.fontStyle = r.italic ? 'italic' : 'normal';
      if (r.color) sp.style.color = r.color;
      sp.textContent = String(r.text);
      inner.appendChild(sp);
      if (r.br) inner.appendChild(document.createTextNode('\n'));
    });
  } else {
    inner.textContent = t;
  }
  d.appendChild(inner);
  return d;
}

function renderChart(e) {
  const d = document.createElement('div');
  d.className = 'sl-chart';
  setBox(d, e);
  d.innerHTML = renderChartSVG(e);
  return d;
}

function cellObj(c) { return (c && typeof c === 'object') ? c : { text: c == null ? '' : c }; }

// A table uses the schema when it sets any field a legacy spec never carries.
function tableUsesSchema(e) {
  if (Array.isArray(e.rowH) || e.margin != null || e.border) return true;
  return (e.rows || []).some((row) => (row || []).some((c) => c && typeof c === 'object'
    && (c.rowSpan > 1 || c.colSpan > 1 || c.margin != null || c.valign || c.border || c.italic)));
}
function usesLineBreaks(e) {
  return e.lineBreaks != null ? !!e.lineBreaks : tableUsesSchema(e);
}

function renderTable(e) {
  const wrap = document.createElement('div');
  wrap.className = 'sl-tablewrap';
  wrap.style.position = 'absolute';
  wrap.style.left = px(e.x); wrap.style.top = px(e.y);
  wrap.style.width = px(e.w);

  const table = document.createElement('table');
  // '\n' = line break (styles/slide.css .sl-table--lines) ONLY for a table that opts in:
  // `lineBreaks: true`, or any schema extension (the BOTH / SGH decks). A legacy table
  // keeps today's class, so the KAMC deck's '\n' cells (two-line due-date ranges, Alt-Enter
  // task text) still collapse to a space in the PDF exactly as before. `lineBreaks: false`
  // forces the legacy behaviour on an extended table.
  table.className = usesLineBreaks(e) ? 'sl-table sl-table--lines' : 'sl-table';
  table.style.width = px(e.w);
  table.style.tableLayout = 'fixed';
  table.style.borderCollapse = 'collapse';

  const colgroup = document.createElement('colgroup');
  const colWpx = (e.colW || []).map((w) => w * PX);
  colWpx.forEach((w) => { const col = document.createElement('col'); col.style.width = `${w}px`; colgroup.appendChild(col); });
  table.appendChild(colgroup);

  const headerSize = (e.headerSize || 10) * PT2PX;
  const bodySize = (e.bodySize || 10) * PT2PX;
  // rowH: one number for every row (legacy) or an array of per-row heights (schema).
  const rowHs = Array.isArray(e.rowH) ? e.rowH : null;
  const rowHpx = !rowHs && e.rowH ? e.rowH * PX : null;
  // pt <= 0 = no line (as pptx-renderer's { type: 'none' }).
  const borderCss = (b) => {
    const pt = b ? (b.pt != null ? b.pt : 0.75) : 0;
    return pt > 0 ? `${pt * PT2PX}px solid ${b.color || '#E2E8F0'}` : 'none';
  };

  e.rows.forEach((row, ri) => {
    const isHead = e.header && ri === 0;
    const tr = document.createElement('tr');
    // Array entries that are missing / null / 0 leave the row auto-height (pptx-renderer
    // pads the array with 0, which pptxgenjs writes as h="0" = auto).
    if (rowHs) { if (rowHs[ri]) tr.style.height = `${rowHs[ri] * PX}px`; } else if (rowHpx) tr.style.height = `${rowHpx}px`;
    row.forEach((raw) => {
      const c = cellObj(raw);
      const cell = document.createElement(isHead ? 'th' : 'td');
      const fill = c.fill || (isHead ? e.header.fill : null);
      const color = c.color || (isHead ? e.header.color : '#1E293B');
      const bold = c.bold != null ? c.bold : (isHead ? e.header.bold : false);
      const t = c.text != null ? String(c.text) : '';
      if (fill) cell.style.background = fill;
      cell.style.color = color;
      cell.style.fontWeight = bold ? '700' : '400';
      // c.size mirrors pptx-renderer: a single column may set its own size.
      cell.style.fontSize = `${c.size ? c.size * PT2PX : (isHead ? headerSize : bodySize)}px`;
      cell.style.textAlign = c.align || 'center';
      // PER-CELL text direction only. The table's own `direction` stays LTR (pinned in
      // styles/slide.css) because e.rtl on a table means "cells were already reversed
      // into visual order by build-spec's rev()" — flipping the table would re-mirror
      // the columns. Each cell is its own bidi paragraph, so pinning direction here
      // (rtl for Arabic/mixed, ltr for numbers, dates and Latin lab names) is what
      // decides where punctuation and Latin tokens land inside the cell. Mirrors
      // pptx-renderer's `rtlMode: isArabic(t)`; an explicit c.rtl can override.
      cell.style.direction = (c.rtl != null ? !!c.rtl : isArabic(t)) ? 'rtl' : 'ltr';
      // Schema extensions. Spans: the spec OMITS covered cells, which is exactly the
      // HTML table model, so rowSpan/colSpan map 1:1 (and match pptxgenjs' placement).
      if (c.rowSpan > 1) cell.rowSpan = c.rowSpan;
      if (c.colSpan > 1) cell.colSpan = c.colSpan;
      if (c.italic) cell.style.fontStyle = 'italic';
      const m = c.margin != null ? c.margin : e.margin;
      if (m != null) cell.style.padding = paddingCss(m);
      if (c.valign) cell.style.verticalAlign = c.valign === 'middle' ? 'middle' : c.valign;
      // Borders in POINTS (×4/3 px). Table default first, then per-side overrides
      // (null = no line). The collapsed-border model draws the wider of two touching
      // sides, which is what PowerPoint's overlapping cell lines look like.
      if (e.border) cell.style.border = borderCss(e.border);
      if (c.border) {
        ['top', 'right', 'bottom', 'left'].forEach((side) => {
          if (side in c.border) cell.style[`border${side[0].toUpperCase()}${side.slice(1)}`] = borderCss(c.border[side]);
        });
      }
      cell.textContent = t;
      tr.appendChild(cell);
    });
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  return wrap;
}

function renderElement(e) {
  switch (e.t) {
    case 'rect': return renderRect(e);
    case 'text': return renderText(e);
    case 'table': return renderTable(e);
    case 'chart': return renderChart(e);
    case 'group': { const f = document.createDocumentFragment(); (e.children || []).forEach((c) => f.appendChild(renderElement(c))); return f; }
    default: return document.createComment('unknown element ' + e.t);
  }
}

/**
 * @param {import('../contracts.js').SlideSpec} spec
 * @param {{variant?:('internal'|'nupco')}} [opts]
 * @returns {DocumentFragment}
 */
export function renderSlides(spec, opts = {}) {
  const variant = opts.variant || 'internal';
  const frag = document.createDocumentFragment();
  spec.forEach((slide) => {
    if (variant === 'nupco' && slide.internalOnly) return;
    const div = document.createElement('div');
    div.className = 'sl-slide';
    div.dataset.slideId = slide.id;
    div.style.width = px(GEOM.slideW);
    div.style.height = px(GEOM.slideH);
    div.style.background = slide.bg || '#FFFFFF';
    slide.elements.forEach((e) => div.appendChild(renderElement(e)));
    frag.appendChild(div);
  });
  return frag;
}

export default renderSlides;
