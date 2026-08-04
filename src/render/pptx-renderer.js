// src/render/pptx-renderer.js
// renderPptx(spec, {variant, PptxGenJS}) -> Blob (.pptx). Maps SlideSpec elements 1:1 to
// PptxGenJS on a 13.333 x 7.5 in wide layout. internalOnly slides are dropped for 'nupco'.
import { COLORS as C } from '../theme.js?v=v2026-08-04.2';

const hex = (c) => (c ? String(c).replace('#', '') : c);
// Arabic + Arabic Supplement/Extended + presentation forms (same range html-renderer uses),
// so a string that only carries shaped/presentation-form Arabic is still detected as RTL.
const isArabic = (s) => /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(String(s));
const VALIGN = { top: 'top', middle: 'middle', bottom: 'bottom' };

function addRect(slide, P, e) {
  const shape = e.radius ? P.ShapeType.roundRect : P.ShapeType.rect;
  const opts = { x: e.x, y: e.y, w: e.w, h: e.h, fill: e.fill ? { color: hex(e.fill) } : { type: 'none' }, line: { type: 'none' } };
  if (e.radius) opts.rectRadius = e.radius;
  if (e.line) opts.line = { color: hex(e.line.color), width: e.line.w || 1 };
  slide.addShape(shape, opts);
}

function addText(slide, e) {
  const t = e.text != null ? String(e.text) : '';
  // BIDI: rtlMode → <a:pPr rtl="1">, i.e. the paragraph's BASE direction. An explicit
  // e.rtl always wins; when the spec omits it, Arabic content still gets an RTL base
  // (an Arabic run in an LTR paragraph pushes its trailing Latin/number to the wrong
  // side). Inside an RTL paragraph PowerPoint keeps Latin words and numbers LTR by
  // itself (UAX#9), so "بعد الـ Dispatch" and "1,240" stay intact.
  const rtl = e.rtl != null ? !!e.rtl : isArabic(t);
  slide.addText(t, {
    x: e.x, y: e.y, w: e.w, h: e.h,
    fontFace: 'Cairo',
    fontSize: e.size || 12,
    bold: !!e.bold,
    italic: !!e.italic,
    color: hex(e.color || '#000000'),
    align: e.align || (rtl ? 'right' : 'left'),
    valign: VALIGN[e.valign] || 'top',
    rtlMode: rtl,
    lineSpacingMultiple: e.lineSpacing || undefined,
    margin: 1,
    wrap: true,
  });
}

// TABLE RTL: pptxgenjs 3.12 emits a bare <a:tbl><a:tblPr/> and exposes NO option for the
// table-level rtl="1" attribute (which is what mirrors column order in PowerPoint). The
// mechanism for column order therefore stays the spec's own right-to-left column layout
// (build-spec reverses colW + cells together); what we CAN and do set per cell is the
// paragraph base direction, derived from the cell text: Arabic cells get rtl="1" so that
// trailing Latin/numbers land on the correct side, while pure-Latin cells ("NUPCO | Lean")
// and numeric cells stay LTR and are never mirrored.
function addTable(slide, e) {
  const rows = e.rows.map((row, ri) => {
    const isHead = e.header && ri === 0;
    return row.map((raw) => {
      const c = (raw && typeof raw === 'object') ? raw : { text: raw == null ? '' : String(raw) };
      const t = c.text != null ? String(c.text) : '';
      const fill = c.fill || (isHead ? e.header.fill : null);
      const color = c.color || (isHead ? e.header.color : '#1E293B');
      const bold = c.bold != null ? c.bold : (isHead ? e.header.bold : false);
      return {
        text: t,
        options: {
          fill: fill ? { color: hex(fill) } : undefined,
          color: hex(color),
          bold: !!bold,
          align: c.align || 'center',
          valign: 'middle',
          fontFace: 'Cairo',
          fontSize: (isHead ? (e.headerSize || 10) : (e.bodySize || 10)),
          rtlMode: isArabic(t),
        },
      };
    });
  });
  slide.addTable(rows, {
    x: e.x, y: e.y, w: e.w,
    colW: e.colW,
    rowH: e.rowH || undefined,
    border: { type: 'solid', color: hex(C.border), pt: 0.75 },
    autoPage: false,
    valign: 'middle',
  });
}

// RTL CHART AXES (native PowerPoint, not array-reversal) ---------------------
// pptxgenjs 3.12 exposes `catAxisOrientation` → <c:scaling><c:orientation val="maxMin"/>
// on <c:catAx>, i.e. PowerPoint's "Categories in reverse order". That single flag makes
// the chart genuinely RTL: the category axis progresses right→left AND the value axis
// (which crosses at the first category, <c:crosses val="autoZero"/>) moves to the RIGHT,
// with its tick labels next to it — the same geometry charts-svg.js draws.
// Consequence: the category array is consumed in NATURAL order (index 0 = oldest, drawn
// rightmost). A spec that ALSO pre-reverses its arrays double-reverses and reads LTR
// again; such an element must carry opts.catDir === 'ltr' (same knob as charts-svg.js).
// NOT AVAILABLE in pptxgenjs 3.12: there is no option to set rtl="1" on the <a:pPr> of
// chart text (category labels, value labels, legend, axis titles) — the library's chart
// txPr emitter hard-codes <a:pPr> with no rtl attribute, and presentation-level rtlMode
// does not reach chart parts. Mixed Arabic+Latin chart strings therefore rely on
// PowerPoint's own bidi resolution of the run (correct for first-strong-Arabic strings).
const CAT_RTL = 'maxMin';   // <c:orientation val="maxMin"/> — index 0 on the right
const CAT_LTR = 'minMax';
const catOrient = (e) => (e.opts?.catDir === 'ltr' ? CAT_LTR : CAT_RTL);

function addChart(slide, P, e) {
  const cats = e.categories;
  const data = e.series.map((s) => ({ name: s.name, labels: cats, values: s.values.map((v) => (v == null ? null : v)) }));
  const colors = e.series.map((s) => hex(s.color));
  const legendOn = e.opts?.legend === 'bottom';
  if (e.kind === 'colClustered') {
    slide.addChart(P.ChartType.bar, data, {
      x: e.x, y: e.y, w: e.w, h: e.h,
      barDir: 'col', barGrouping: 'clustered', barGapWidthPct: 100,
      catAxisOrientation: catOrient(e),   // RTL: categories right→left, value axis right
      valAxisLabelPos: 'nextTo',          // tick labels hug the (now right-hand) value axis
      catAxisLabelPos: 'low',             // category labels stay along the bottom
      chartColors: colors,
      showLegend: legendOn, legendPos: 'b', legendFontFace: 'Cairo', legendFontSize: 8,
      showValue: !!e.opts?.dataLabels, dataLabelFontFace: 'Cairo', dataLabelFontSize: 7, dataLabelColor: hex(C.slate900), dataLabelPosition: 'outEnd',
      catAxisLabelFontFace: 'Cairo', catAxisLabelFontSize: 8,
      valAxisLabelFontFace: 'Cairo', valAxisLabelFontSize: 8,
      valGridLine: { color: 'D9D9D9', size: 1 },
    });
  } else if (e.kind === 'line') {
    const common = {
      x: e.x, y: e.y, w: e.w, h: e.h,
      displayBlanksAs: 'gap',
      catAxisOrientation: catOrient(e),   // RTL: categories right→left, value axis right
      valAxisLabelPos: 'nextTo',
      catAxisLabelPos: 'low',
      showLegend: legendOn, legendPos: 'b', legendFontFace: 'Cairo', legendFontSize: 8,
      showValAxisTitle: !!e.opts?.title, valAxisTitle: e.opts?.title || '', valAxisTitleFontFace: 'Cairo', valAxisTitleFontSize: 9,
      valAxisMinVal: e.opts?.valMin != null ? e.opts.valMin : undefined,
      catAxisLabelFontFace: 'Cairo', catAxisLabelFontSize: 8,
      valAxisLabelFontFace: 'Cairo', valAxisLabelFontSize: 8,
      valGridLine: { color: 'D9D9D9', size: 1 },
    };
    const styled = e.series.some((s) => s.dash || (s.marker && s.marker !== 'circle'));
    if (styled) {
      // Per-series dash/marker needs one chart group per series (combo form) —
      // a single addChart applies lineDash/lineDataSymbol to every series.
      const groups = e.series.map((s, i) => ({
        type: P.ChartType.line,
        data: [data[i]],
        options: {
          chartColors: [colors[i]],
          lineSize: 2,
          lineDash: s.dash ? 'dash' : 'solid',
          lineDataSymbol: s.marker || 'circle',
          lineDataSymbolSize: 6,
        },
      }));
      slide.addChart(groups, common);
    } else {
      slide.addChart(P.ChartType.line, data, {
        ...common,
        chartColors: colors,
        lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 6,
      });
    }
  } else if (e.kind === 'barH') {
    slide.addChart(P.ChartType.bar, data, {
      x: e.x, y: e.y, w: e.w, h: e.h,
      barDir: 'bar', barGrouping: 'clustered', barGapWidthPct: 30,
      // RTL for a horizontal bar chart is the VALUE axis, not the category axis:
      // reversing it puts the zero baseline on the right (bars grow left) and moves the
      // category axis + its labels to the right. Categories run bottom→top (index 0 at
      // the bottom), so catAxisOrientation is deliberately left at its default.
      valAxisOrientation: 'maxMin',
      valAxisLabelPos: 'low',
      chartColors: colors,
      showLegend: e.opts?.legend === 'bottom', legendPos: 'b', legendFontFace: 'Cairo', legendFontSize: 8,
      showValue: !!e.opts?.dataLabels, dataLabelFontFace: 'Cairo', dataLabelFontSize: 8, dataLabelColor: hex(C.slate900), dataLabelPosition: 'outEnd',
      catAxisLabelFontFace: 'Cairo', catAxisLabelFontSize: e.opts?.catFont || 8,
      valAxisLabelFontFace: 'Cairo', valAxisLabelFontSize: 8,
      valGridLine: { color: 'D9D9D9', size: 1 },
    });
  }
}

function addElement(slide, P, e) {
  switch (e.t) {
    case 'rect': return addRect(slide, P, e);
    case 'text': return addText(slide, e);
    case 'table': return addTable(slide, e);
    case 'chart': return addChart(slide, P, e);
    case 'group': return (e.children || []).forEach((c) => addElement(slide, P, c));
  }
}

/**
 * @param {import('../contracts.js').SlideSpec} spec
 * @param {{variant?:('internal'|'nupco'), PptxGenJS:any}} opts
 * @returns {Promise<Blob>}
 */
export async function renderPptx(spec, { variant = 'internal', PptxGenJS }) {
  const P = new PptxGenJS();
  P.rtlMode = true; // deck-level rtl="1" like the original (numeric runs stay LTR)
  P.defineLayout({ name: 'LAYOUT_WIDE', width: 13.333, height: 7.5 });
  P.layout = 'LAYOUT_WIDE';
  spec.forEach((sd) => {
    if (variant === 'nupco' && sd.internalOnly) return;
    const slide = P.addSlide();
    slide.background = { color: hex(sd.bg || '#FFFFFF') };
    sd.elements.forEach((e) => addElement(slide, P, e));
  });
  const blob = await P.write({ outputType: 'blob' });
  return blob;
}

export default renderPptx;
