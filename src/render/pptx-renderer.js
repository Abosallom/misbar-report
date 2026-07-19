// src/render/pptx-renderer.js
// renderPptx(spec, {variant, PptxGenJS}) -> Blob (.pptx). Maps SlideSpec elements 1:1 to
// PptxGenJS on a 13.333 x 7.5 in wide layout. internalOnly slides are dropped for 'nupco'.
import { COLORS as C } from '../theme.js';

const hex = (c) => (c ? String(c).replace('#', '') : c);
const isArabic = (s) => /[؀-ۿ]/.test(String(s));
const VALIGN = { top: 'top', middle: 'middle', bottom: 'bottom' };

function addRect(slide, P, e) {
  const shape = e.radius ? P.ShapeType.roundRect : P.ShapeType.rect;
  const opts = { x: e.x, y: e.y, w: e.w, h: e.h, fill: e.fill ? { color: hex(e.fill) } : { type: 'none' }, line: { type: 'none' } };
  if (e.radius) opts.rectRadius = e.radius;
  if (e.line) opts.line = { color: hex(e.line.color), width: e.line.w || 1 };
  slide.addShape(shape, opts);
}

function addText(slide, e) {
  slide.addText(e.text != null ? String(e.text) : '', {
    x: e.x, y: e.y, w: e.w, h: e.h,
    fontFace: 'Cairo',
    fontSize: e.size || 12,
    bold: !!e.bold,
    italic: !!e.italic,
    color: hex(e.color || '#000000'),
    align: e.align || (e.rtl ? 'right' : 'left'),
    valign: VALIGN[e.valign] || 'top',
    rtlMode: !!e.rtl,
    lineSpacingMultiple: e.lineSpacing || undefined,
    margin: 1,
    wrap: true,
  });
}

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

function addChart(slide, P, e) {
  const cats = e.categories;
  const data = e.series.map((s) => ({ name: s.name, labels: cats, values: s.values.map((v) => (v == null ? null : v)) }));
  const colors = e.series.map((s) => hex(s.color));
  const legendOn = e.opts?.legend === 'bottom';
  if (e.kind === 'colClustered') {
    slide.addChart(P.ChartType.bar, data, {
      x: e.x, y: e.y, w: e.w, h: e.h,
      barDir: 'col', barGrouping: 'clustered', barGapWidthPct: 100,
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
      valAxisOrientation: 'maxMin', // RTL: zero baseline on the right, bars grow left
      chartColors: colors,
      showLegend: false,
      showValue: !!e.opts?.dataLabels, dataLabelFontFace: 'Cairo', dataLabelFontSize: 8, dataLabelColor: hex(C.slate900), dataLabelPosition: 'outEnd',
      catAxisLabelFontFace: 'Cairo', catAxisLabelFontSize: 8,
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
