// src/render/html-renderer.js
// renderSlides(spec, {variant}) -> DocumentFragment of absolutely-positioned .sl-slide divs
// (1280x720 px = inches * 96). Skips internalOnly slides when variant === 'nupco'.
// html2canvas-safe: absolute positioning, solid fills, borders, border-radius only.
// No box-shadow, no CSS gap, no transforms. Charts are delegated to charts-svg.js (inline SVG).
import { GEOM } from '../theme.js?v=v2026-07-22.8';
import { renderChartSVG } from './charts-svg.js?v=v2026-07-22.8';

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

function renderRect(e) {
  const d = document.createElement('div');
  d.className = 'sl-rect';
  setBox(d, e);
  d.style.background = e.fill || 'transparent';
  if (e.radius) d.style.borderRadius = px(e.radius);
  if (e.line) d.style.border = `${e.line.w || 1}px solid ${e.line.color}`;
  return d;
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
  const inner = document.createElement('span');
  inner.className = 'sl-text-inner';
  inner.style.textAlign = e.align || (e.rtl ? 'right' : 'left');
  inner.style.direction = e.rtl ? 'rtl' : 'ltr';
  if (e.lineSpacing) inner.style.lineHeight = String(e.lineSpacing);
  inner.textContent = e.text != null ? String(e.text) : '';
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

function renderTable(e) {
  const wrap = document.createElement('div');
  wrap.className = 'sl-tablewrap';
  wrap.style.position = 'absolute';
  wrap.style.left = px(e.x); wrap.style.top = px(e.y);
  wrap.style.width = px(e.w);

  const table = document.createElement('table');
  table.className = 'sl-table';
  table.style.width = px(e.w);
  table.style.tableLayout = 'fixed';
  table.style.borderCollapse = 'collapse';

  const colgroup = document.createElement('colgroup');
  const colWpx = (e.colW || []).map((w) => w * PX);
  colWpx.forEach((w) => { const col = document.createElement('col'); col.style.width = `${w}px`; colgroup.appendChild(col); });
  table.appendChild(colgroup);

  const headerSize = (e.headerSize || 10) * PT2PX;
  const bodySize = (e.bodySize || 10) * PT2PX;
  const rowHpx = e.rowH ? e.rowH * PX : null;

  e.rows.forEach((row, ri) => {
    const isHead = e.header && ri === 0;
    const tr = document.createElement('tr');
    if (rowHpx) tr.style.height = `${rowHpx}px`;
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
      cell.style.fontSize = `${isHead ? headerSize : bodySize}px`;
      cell.style.textAlign = c.align || 'center';
      cell.style.direction = isArabic(t) ? 'rtl' : 'ltr';
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
