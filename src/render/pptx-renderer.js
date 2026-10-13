// src/render/pptx-renderer.js
// renderPptx(spec, {variant, PptxGenJS, JSZip?}) -> Blob (.pptx). Maps SlideSpec elements 1:1 to
// PptxGenJS on a 13.333 x 7.5 in wide layout. internalOnly slides are dropped for 'nupco'.
// Element schema extensions for the BOTH-hospitals deck (ellipse, alpha, line.pt, text runs
// + margin, table spans/per-row heights/per-cell margin+valign+border, and the native chart
// kinds doughnut / barStacked100 / colStackedTotal) extend the SlideSpec of src/contracts.js,
// whose typedef still lists only the legacy fields: the field-level notes (names, units,
// defaults) sit next to the code that reads them, here and in html-renderer / charts-svg. Every new
// field is optional: a spec that uses none of them goes through EXACTLY the old code path and
// gets pptxgenjs' own blob back untouched (the KAMC deck must stay byte-identical).
import { COLORS as C } from '../theme.js?v=v2026-10-13.3';
import { fmtCode, stackTotals, DEFAULT_LAYOUT } from './charts-svg.js?v=v2026-10-13.3';

const hex = (c) => (c ? String(c).replace('#', '') : c);
// Arabic + Arabic Supplement/Extended + presentation forms (same range html-renderer uses),
// so a string that only carries shaped/presentation-form Arabic is still detected as RTL.
const isArabic = (s) => /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(String(s));
const VALIGN = { top: 'top', middle: 'middle', bottom: 'bottom' };

function addRect(slide, P, e) {
  const ellipse = e.shape === 'ellipse';
  const shape = ellipse ? P.ShapeType.ellipse : e.radius ? P.ShapeType.roundRect : P.ShapeType.rect;
  const opts = { x: e.x, y: e.y, w: e.w, h: e.h, fill: e.fill ? { color: hex(e.fill) } : { type: 'none' }, line: { type: 'none' } };
  // alpha = fill OPACITY (schema); pptxgenjs takes the complement as `transparency` %
  // and writes <a:alpha val="(100-t)*1000"/> — 0.13 → 13000, the reference cover pills.
  if (e.fill && e.alpha != null && e.alpha < 1) opts.fill.transparency = (1 - Math.max(0, e.alpha)) * 100;
  if (e.radius && !ellipse) opts.rectRadius = e.radius;
  // line.pt (schema) is points in BOTH renderers; legacy line.w stays points here.
  // pt <= 0 = no outline: pptxgenjs reads width 0 as "use the 1 pt default".
  if (e.line && e.line.pt != null && !(e.line.pt > 0)) opts.line = { type: 'none' };
  else if (e.line) opts.line = { color: hex(e.line.color), width: e.line.pt != null ? e.line.pt : (e.line.w || 1) };
  slide.addShape(shape, opts);
}

// Text-box insets. Schema unit = inches, number or [t, r, b, l]. pptxgenjs wants POINTS
// and, for an array, the order [l, r, b, t] (its genXmlBodyProperties maps margin[0]→lIns,
// [1]→rIns, [2]→bIns, [3]→tIns). Absent → today's hard-coded 1 pt.
function textMargin(m) {
  if (m == null) return 1;
  if (!Array.isArray(m)) return m * 72;
  const [t = 0, r = 0, b = 0, l = 0] = m;
  return [l * 72, r * 72, b * 72, t * 72];
}

// Mixed-style text (schema `runs`). Run style falls back to the element's size/bold/
// italic/color; paragraph props (align, valign, rtl, lineSpacing) come from the element.
// Every run option is set EXPLICITLY because pptxgenjs copies any FALSY run option from
// the box options (a run's bold:false would otherwise inherit a box-level bold:true) —
// so the box-level options below deliberately carry no fontSize/bold/italic/color.
function addRuns(slide, e) {
  const runs = e.runs.filter((r) => r && r.text != null);
  const joined = runs.map((r) => String(r.text)).join('');
  const rtl = e.rtl != null ? !!e.rtl : isArabic(joined);
  // A '\n' INSIDE a run is a line break that the next run continues (html-renderer's
  // pre-wrap span does exactly that). pptxgenjs would split the text itself but also end
  // the paragraph after the run's LAST piece, so split here: every piece but the last
  // breaks; the last piece breaks only when the run says `br`.
  const items = runs.flatMap((r) => String(r.text).split(/\r?\n/).map((piece, k, all) => ({
    text: piece,
    options: {
      fontFace: 'Cairo',
      fontSize: r.size || e.size || 12,
      bold: !!(r.bold != null ? r.bold : e.bold),
      italic: !!(r.italic != null ? r.italic : e.italic),
      color: hex(r.color || e.color || '#000000'),
      // rtlMode per run: pptxgenjs builds each paragraph's <a:pPr> from the run options
      // BEFORE it copies the box options into the run, so a box-level rtlMode alone
      // never reaches the rtl="1" attribute.
      rtlMode: rtl,
      breakLine: k < all.length - 1 || !!r.br,
    },
  })));
  slide.addText(items, {
    x: e.x, y: e.y, w: e.w, h: e.h,
    fontFace: 'Cairo',
    align: e.align || (rtl ? 'right' : 'left'),
    valign: VALIGN[e.valign] || 'top',
    rtlMode: rtl,
    lineSpacingMultiple: e.lineSpacing || undefined,
    margin: textMargin(e.margin),
    wrap: true,
  });
}

function addText(slide, e) {
  if (Array.isArray(e.runs) && e.runs.length) return addRuns(slide, e);
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
    margin: e.margin != null ? textMargin(e.margin) : 1,
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
  // Default border of every cell side: the table's `border` (schema) or today's 0.75 pt slate-200.
  // pt <= 0 = no line (pptxgenjs would otherwise write a w="0" solid line = hairline).
  const tb = e.border
    ? (e.border.pt != null && !(e.border.pt > 0)
      ? { type: 'none' }
      : { type: 'solid', color: hex(e.border.color || C.border), pt: e.border.pt != null ? e.border.pt : 0.75 })
    : { type: 'solid', color: hex(C.border), pt: 0.75 };
  const rows = e.rows.map((row, ri) => {
    const isHead = e.header && ri === 0;
    return row.map((raw) => {
      const c = (raw && typeof raw === 'object') ? raw : { text: raw == null ? '' : String(raw) };
      const t = c.text != null ? String(c.text) : '';
      const fill = c.fill || (isHead ? e.header.fill : null);
      const color = c.color || (isHead ? e.header.color : '#1E293B');
      const bold = c.bold != null ? c.bold : (isHead ? e.header.bold : false);
      const options = {
        fill: fill ? { color: hex(fill) } : undefined,
        color: hex(color),
        bold: !!bold,
        align: c.align || 'center',
        valign: VALIGN[c.valign] || 'middle',
        fontFace: 'Cairo',
        // c.size lets ONE column sit at a different size (the send-out table
        // sets the reference-lab column smaller) without a second table.
        fontSize: c.size || (isHead ? (e.headerSize || 10) : (e.bodySize || 10)),
        rtlMode: c.rtl != null ? !!c.rtl : isArabic(t),
      };
      // Schema extensions — only ever ADDED when present, so a legacy table hands
      // pptxgenjs the very same cell options as before.
      if (c.italic) options.italic = true;
      // Spans: the spec OMITS covered cells (HTML semantics), which is exactly what
      // pptxgenjs expects — it inserts the vMerge/hMerge placeholders itself.
      if (c.rowSpan > 1) options.rowspan = c.rowSpan;
      if (c.colSpan > 1) options.colspan = c.colSpan;
      const m = c.margin != null ? c.margin : e.margin;
      if (m != null) options.margin = cellMargin(m);
      if (c.border) options.border = cellBorder(c.border, tb);
      return { text: t, options };
    });
  });
  slide.addTable(rows, {
    x: e.x, y: e.y, w: e.w,
    colW: e.colW,
    rowH: tableRowH(e),
    border: tb,
    autoPage: false,
    valign: 'middle',
  });
}

// rowH: a number (legacy, every row) or an array of per-row heights (schema). Array
// entries that are missing / null / 0 mean AUTO height — html-renderer leaves those rows
// unsized. pptxgenjs needs the array padded: for a 1-entry array it reads Number([0.3])
// = 0.3 as a height for EVERY row, and h="0" is what it writes for an auto row.
function tableRowH(e) {
  if (!Array.isArray(e.rowH)) return e.rowH || undefined;
  return e.rows.map((_, i) => Number(e.rowH[i]) || 0);
}

// Cell padding. Schema: inches, number or [t, r, b, l]. pptxgenjs' table writer reads a
// [t, r, b, l] array and decides the UNIT from the first entry: < 1 → inches, >= 1 →
// points. Inches are passed straight through; a (silly) top margin of >= 1 in is sent
// as points so the heuristic still lands on the right unit.
function cellMargin(m) {
  const a = Array.isArray(m) ? m.slice(0, 4) : [m, m, m, m];
  while (a.length < 4) a.push(0);
  const v = a.map((x) => Number(x) || 0);
  return v[0] < 1 ? v : v.map((x) => x * 72);
}

// Per-side cell border (schema {top,right,bottom,left}: {color, pt} | null). pptxgenjs
// takes [top, right, bottom, left] and treats a missing entry as NO line, so every side
// the spec leaves out is filled from the table default.
function cellBorder(b, tb) {
  return ['top', 'right', 'bottom', 'left'].map((side) => {
    if (!(side in b)) return tb;   // (tb may itself be { type: 'none' })
    const v = b[side];
    if (!v || (v.pt != null && !(v.pt > 0))) return { type: 'none' };
    return { type: 'solid', color: hex(v.color || tb.color || C.border), pt: v.pt != null ? v.pt : (tb.pt || 0.75) };
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
  if (NATIVE_KINDS.has(e.kind)) return addNativeChart(slide, P, e);
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
          // Data labels live on the GROUP in the combo form — common's copy does not
          // reach the per-series groups. Position mirrors charts-svg line(): series 0
          // above ('t'), later series below ('b'), the reference image's arrangement.
          // '0.0' keeps the report's 1-decimal style ('2.0', never '2'); a null cell
          // is a blank in the sheet (displayBlanksAs gap), so gap months label nothing.
          showValue: !!e.opts?.dataLabels,
          dataLabelFormatCode: '0.0',
          dataLabelFontFace: 'Cairo', dataLabelFontSize: 7,
          dataLabelColor: colors[i],
          dataLabelPosition: i === 0 ? 't' : 'b',
        },
      }));
      slide.addChart(groups, common);
    } else {
      slide.addChart(P.ChartType.line, data, {
        ...common,
        chartColors: colors,
        lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 6,
        showValue: !!e.opts?.dataLabels,
        dataLabelFormatCode: '0.0',
        dataLabelFontFace: 'Cairo', dataLabelFontSize: 7,
        dataLabelPosition: 't',
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
  // true = a chart part was written (renderPptx maps slide charts to spec elements by order)
  return e.kind === 'colClustered' || e.kind === 'line' || e.kind === 'barH';
}

// NATIVE CHART KINDS (BOTH-hospitals deck) ------------------------------------
// doughnut / barStacked100 / colStackedTotal reproduce the reference deck's native
// PowerPoint charts (ref ppt/charts/chart1-7,9.xml). pptxgenjs 3.12 cannot express
// several of their details — per-point label deletion, two-paragraph rich labels on
// the invisible total series, '#,##0;;;' per series, a line-less total series, per-series
// seams — so the renderer works in two steps:
//   1. addNativeChart() asks pptxgenjs for a chart of the closest type WITH THE EXACT
//      DATA. That gives a valid chart part, its rels and the embedded workbook
//      (A1 blank, B1.. series names, A2.. categories, values below) — and a reasonable
//      native fallback should the post-process be unavailable.
//   2. patchPptx() then REPLACES that chart part's XML with buildChartXml(), which emits
//      the reference structure element by element and points at the same workbook cells
//      (keeping pptxgenjs' <c:externalData r:id>). Chart parts are matched to spec
//      elements through each slide's <c:chart r:id> order + the slide rels, never by
//      guessing file names.
const NATIVE_KINDS = new Set(['doughnut', 'barStacked100', 'colStackedTotal']);
const CAT_AX_ID = '-2068027336';   // the reference's own axis ids (any pair works)
const VAL_AX_ID = '-2113994440';

const numOrNull = (v) => { const x = Number(v); return v != null && v !== '' && Number.isFinite(x) ? x : null; };
const catsOf = (e) => (e.categories || []).map((c) => (c == null ? '' : String(c)));
const isEmptyDoughnut = (e) => !!e.opts?.emptyColor
  && !(((e.series && e.series[0] && e.series[0].values) || []).some((v) => numOrNull(v)));

// The data handed to pptxgenjs = the data the replacement XML references.
function nativeData(e) {
  const cats = catsOf(e);
  if (e.kind === 'doughnut') {
    const ser = (e.series && e.series[0]) || { name: '', values: [] };
    // An all-zero doughnut with emptyColor is drawn as ONE full point (value 1).
    if (isEmptyDoughnut(e)) return [{ name: ser.name ?? '', labels: [''], values: [1] }];
    return [{ name: ser.name ?? '', labels: cats, values: cats.map((_, i) => numOrNull(ser.values?.[i])) }];
  }
  const out = (e.series || []).map((s) => ({ name: s.name ?? '', labels: cats, values: cats.map((_, i) => numOrNull(s.values?.[i])) }));
  if (e.kind === 'colStackedTotal' && e.total) out.push({ name: e.total.name ?? 'الإجمالي', labels: cats, values: stackTotals(e) });
  return out;
}

const layoutOf = (e) => e.opts?.layout || (e.kind === 'barStacked100' && e.opts?.catAxis?.hidden === false
  ? DEFAULT_LAYOUT.barStacked100Axes : DEFAULT_LAYOUT[e.kind]);
const catReversed = (e) => (e.opts?.catAxis?.reverse != null ? !!e.opts.catAxis.reverse
  : (e.kind === 'colStackedTotal' ? e.opts?.catDir !== 'ltr' : true));
const valReversed = (e) => (e.kind === 'barStacked100' ? e.opts?.valAxis?.reverse !== false : !!e.opts?.valAxis?.reverse);

function addNativeChart(slide, P, e) {
  const data = nativeData(e);
  const box = { x: e.x, y: e.y, w: e.w, h: e.h };
  const L = layoutOf(e);
  const seam = (e.series || []).map((s) => s.line).find((l) => l && l.color);
  const common = {
    ...box,
    layout: L ? { x: L.x, y: L.y, w: L.w, h: L.h } : undefined,
    showLegend: e.opts?.legend === 'bottom', legendPos: 'b', legendFontFace: 'Cairo', legendFontSize: 8,
    showTitle: false,
    dataBorder: seam ? { pt: seam.pt != null ? seam.pt : 0.75, color: hex(seam.color) } : undefined,
  };
  if (e.kind === 'doughnut') {
    const ser = (e.series && e.series[0]) || {};
    const colors = isEmptyDoughnut(e) ? [hex(e.opts.emptyColor)]
      : catsOf(e).map((_, i) => hex((ser.colors && ser.colors[i]) || ser.color || C.navy));
    slide.addChart(P.ChartType.doughnut, data, {
      ...common,
      holeSize: e.opts?.hole != null ? e.opts.hole : 50,
      firstSliceAng: Math.round(Number(e.opts?.firstSliceAng) || 0),
      chartColors: colors,
      showValue: false, showPercent: false, showLabel: false,
    });
  } else if (e.kind === 'barStacked100') {
    const ax = e.opts || {};
    slide.addChart(P.ChartType.bar, data, {
      ...common,
      barDir: 'bar', barGrouping: 'percentStacked', barGapWidthPct: ax.gap != null ? ax.gap : 100,
      catAxisOrientation: catReversed(e) ? 'maxMin' : 'minMax',
      valAxisOrientation: valReversed(e) ? 'maxMin' : 'minMax',
      catAxisHidden: ax.catAxis?.hidden !== false, valAxisHidden: ax.valAxis?.hidden !== false,
      valGridLine: { style: 'none' },
      chartColors: (e.series || []).map((s) => hex(s.color)),
    });
  } else {
    const ax = e.opts || {};
    const bar = {
      type: P.ChartType.bar,
      data: data.slice(0, (e.series || []).length),
      options: { barDir: 'col', barGrouping: 'stacked', barGapWidthPct: ax.gap != null ? ax.gap : 150, chartColors: (e.series || []).map((s) => hex(s.color)) },
    };
    const groups = [bar];
    if (e.total) {
      groups.push({
        type: P.ChartType.line,
        data: [data[data.length - 1]],
        options: { chartColors: [hex(C.slate900)], lineSize: 0, lineDataSymbol: 'none', showValue: true, dataLabelPosition: 't', dataLabelFormatCode: '#,##0' },
      });
    }
    slide.addChart(groups, { ...common, catAxisOrientation: catReversed(e) ? 'maxMin' : 'minMax' });
  }
  return { el: e };
}

// --- chart XML builders (DrawingML chart schema order is significant) ------------
const xEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xHex = (c) => hex(c || '#000000').toUpperCase();
const xSolid = (c) => `<a:solidFill><a:srgbClr val="${xHex(c)}"/></a:solidFill>`;
const xEmu = (pt) => Math.round(pt * 12700);
const xLn = (line) => (line && line.color
  ? `<a:ln w="${xEmu(line.pt != null ? line.pt : 0.75)}">${xSolid(line.color)}</a:ln>`
  : '<a:ln><a:noFill/></a:ln>');
const X_NOFILL_SP = '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>';
const X_FONT = '<a:latin typeface="Cairo"/><a:cs typeface="Cairo"/>';
const xSz = (pt) => Math.round(pt * 100);
function xTxPr({ size = 8, bold, color, bareEnd } = {}) {
  const b = bold != null ? ` b="${bold ? 1 : 0}"` : '';
  return `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${xSz(size)}"${b}>${color ? xSolid(color) : ''}${X_FONT}</a:defRPr></a:pPr>${bareEnd ? '<a:endParaRPr/>' : '<a:endParaRPr lang="en-US"/>'}</a:p></c:txPr>`;
}
// workbook column of series j (A = categories): 0 → B
function xCol(j) {
  let n = j + 2, out = '';
  while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
const xStrRef = (f, arr) => `<c:strRef><c:f>${f}</c:f><c:strCache><c:ptCount val="${arr.length}"/>${arr.map((v, i) => `<c:pt idx="${i}"><c:v>${xEsc(v)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`;
const xNumRef = (f, arr, fmt) => `<c:numRef><c:f>${f}</c:f><c:numCache><c:formatCode>${xEsc(fmt)}</c:formatCode><c:ptCount val="${arr.length}"/>${arr.map((v, i) => (v == null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache></c:numRef>`;
const xSerHead = (j, name) => `<c:idx val="${j}"/><c:order val="${j}"/><c:tx>${xStrRef(`Sheet1!$${xCol(j)}$1`, [name == null ? '' : String(name)])}</c:tx>`;
function xCatVal(j, cats, vals, fmt) {
  const last = cats.length + 1;
  const c = xCol(j);
  return `<c:cat>${xStrRef(`Sheet1!$A$2:$A$${last}`, cats)}</c:cat><c:val>${xNumRef(`Sheet1!$${c}$2:$${c}$${last}`, vals, fmt)}</c:val>`;
}
const xShow = (val) => `<c:showLegendKey val="0"/><c:showVal val="${val}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>`;
const xManual = (L) => (L
  ? `<c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="${L.x}"/><c:y val="${L.y}"/><c:w val="${L.w}"/><c:h val="${L.h}"/></c:manualLayout></c:layout>`
  : '<c:layout/>');
const LABEL_DEFAULTS = { size: 8, bold: false, color: C.slate900, pos: 'ctr', format: 'General' };

// Series data labels: per-point deletes (labels.hide) + optional per-point rich labels,
// then the series-wide style. No `labels` (or show:false) → no <c:dLbls> at all.
function xDLbls(labels, defaults, rich = {}) {
  if (!labels || labels.show === false) return '';
  const o = { ...LABEL_DEFAULTS, ...defaults, ...labels };
  const hide = new Set((o.hide || []).map(Number));
  const idx = [...new Set([...hide, ...Object.keys(rich).map(Number)])].sort((a, b) => a - b);
  const per = idx.map((i) => (hide.has(i) ? `<c:dLbl><c:idx val="${i}"/><c:delete val="1"/></c:dLbl>` : rich[i])).join('');
  return `<c:dLbls>${per}<c:numFmt formatCode="${xEsc(o.format)}" sourceLinked="0"/>${X_NOFILL_SP}${xTxPr({ size: o.size, bold: !!o.bold, color: o.color })}<c:dLblPos val="${o.pos}"/>${xShow(1)}</c:dLbls>`;
}
function xRichLabel(i, lines, pos) {
  const ps = lines.map((l) => `<a:p><a:pPr algn="ctr" rtl="0"/><a:r><a:rPr lang="en-US" sz="${xSz(l.size)}" b="${l.bold ? 1 : 0}">${xSolid(l.color)}${X_FONT}</a:rPr><a:t>${xEsc(l.text)}</a:t></a:r></a:p>`).join('');
  return `<c:dLbl><c:idx val="${i}"/><c:tx><c:rich><a:bodyPr/><a:lstStyle/>${ps}</c:rich></c:tx>${X_NOFILL_SP}<c:dLblPos val="${pos}"/>${xShow(1)}</c:dLbl>`;
}
function xCatAx(ax = {}, { pos, reverse, hidden, tick }) {
  const lab = ax.label || {};
  let x = `<c:catAx><c:axId val="${CAT_AX_ID}"/><c:scaling><c:orientation val="${reverse ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="${hidden ? 1 : 0}"/><c:axPos val="${pos}"/>`;
  x += `<c:majorTickMark val="${ax.tick || tick}"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>`;
  if (!hidden) {
    const line = ax.line === undefined ? { color: '#BFBFBF', pt: 0.75 } : ax.line;
    x += `<c:spPr>${xLn(line)}</c:spPr>${xTxPr({ size: lab.size || 9, bold: !!lab.bold, color: lab.color || C.slate900 })}`;
  }
  return x + `<c:crossAx val="${VAL_AX_ID}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
}
function xValAx(ax = {}, { pos, reverse, hidden, tick, min, max, grid }) {
  const lab = ax.label || {};
  let sc = reverse ? '<c:orientation val="maxMin"/>' : '';
  if (max != null) sc += `<c:max val="${max}"/>`;
  if (min != null) sc += `<c:min val="${min}"/>`;
  let x = `<c:valAx><c:axId val="${VAL_AX_ID}"/>${sc ? `<c:scaling>${sc}</c:scaling>` : '<c:scaling/>'}<c:delete val="${hidden ? 1 : 0}"/><c:axPos val="${pos}"/>`;
  const g = ax.grid === undefined ? grid : ax.grid;
  if (g) x += `<c:majorGridlines><c:spPr>${xLn(g)}</c:spPr></c:majorGridlines>`;
  if (ax.format) x += `<c:numFmt formatCode="${xEsc(ax.format)}" sourceLinked="0"/>`;
  x += `<c:majorTickMark val="${ax.tick || tick}"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>`;
  if (!hidden) x += `<c:spPr>${xLn(ax.line || null)}</c:spPr>${xTxPr({ size: lab.size || 8, bold: !!lab.bold, color: lab.color || '#595959' })}`;
  x += `<c:crossAx val="${CAT_AX_ID}"/><c:crosses val="autoZero"/>`;
  if (ax.major > 0) x += `<c:majorUnit val="${ax.major}"/>`;
  return x + '</c:valAx>';
}
const xLegend = () => `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${xTxPr({ size: 8 })}</c:legend>`;
function xChartSpace(e, plot, { rid, doughnut }) {
  const legend = e.opts?.legend === 'bottom' ? xLegend() : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<c:date1904 val="0"/><c:roundedCorners val="0"/>'
    + `<c:chart><c:autoTitleDeleted val="1"/><c:plotArea>${xManual(layoutOf(e))}${plot}${X_NOFILL_SP}</c:plotArea>${legend}`
    + (doughnut ? '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/>' : '<c:dispBlanksAs val="gap"/>')
    + `</c:chart>${X_NOFILL_SP}${xTxPr({ size: 8, bareEnd: doughnut })}`
    + (rid ? `<c:externalData r:id="${xEsc(rid)}"><c:autoUpdate val="0"/></c:externalData>` : '')
    + '</c:chartSpace>';
}

/**
 * Reference-faithful chart XML for a native-kind chart element (schema §5-§7).
 * @param {{el:Object}|Object} job  the job addNativeChart returned, or the element itself
 * @param {{rid?:string}} [o]       r:id of the embedded workbook (from the pptxgenjs part)
 */
export function buildChartXml(job, { rid } = {}) {
  const e = job.el || job;
  const cats = catsOf(e);
  const data = nativeData(e);
  const o = e.opts || {};
  if (e.kind === 'doughnut') {
    const ser = (e.series && e.series[0]) || {};
    const empty = isEmptyDoughnut(e);
    const pts = empty ? [{ color: o.emptyColor, line: null }]
      : cats.map((_, i) => ({ color: (ser.colors && ser.colors[i]) || ser.color || C.navy, line: ser.line }));
    const dPt = pts.map((p, i) => `<c:dPt><c:idx val="${i}"/><c:spPr>${xSolid(p.color)}${xLn(p.line)}</c:spPr></c:dPt>`).join('');
    const ang = ((Math.round(Number(o.firstSliceAng) || 0) % 360) + 360) % 360;
    const hole = Math.max(10, Math.min(90, Math.round(o.hole != null ? o.hole : 50)));
    const plot = `<c:doughnutChart><c:varyColors val="1"/><c:ser>${xSerHead(0, data[0].name)}${dPt}${xCatVal(0, data[0].labels, data[0].values, o.valueFormat || '#,##0')}</c:ser>`
      + `<c:dLbls>${xShow(0)}<c:showLeaderLines val="1"/></c:dLbls><c:firstSliceAng val="${ang}"/><c:holeSize val="${hole}"/></c:doughnutChart>`;
    return xChartSpace(e, plot, { rid, doughnut: true });
  }
  const fmt = o.valueFormat || 'General';
  const sers = (e.series || []).map((s, j) => `<c:ser>${xSerHead(j, data[j].name)}<c:spPr>${xSolid(s.color)}${xLn(s.line)}</c:spPr><c:invertIfNegative val="0"/>`
    + `${xDLbls(s.labels, {})}${xCatVal(j, cats, data[j].values, fmt)}</c:ser>`).join('');
  const gap = Math.round(o.gap != null ? o.gap : (e.kind === 'barStacked100' ? 100 : 150));
  const overlap = Math.round(o.overlap != null ? o.overlap : 100);
  const axIds = `<c:axId val="${CAT_AX_ID}"/><c:axId val="${VAL_AX_ID}"/>`;
  if (e.kind === 'barStacked100') {
    const plot = `<c:barChart><c:barDir val="bar"/><c:grouping val="percentStacked"/>${sers}<c:gapWidth val="${gap}"/><c:overlap val="${overlap}"/>${axIds}</c:barChart>`
      + xCatAx(o.catAxis, { pos: 'l', reverse: catReversed(e), hidden: o.catAxis?.hidden !== false, tick: 'out' })
      + xValAx(o.valAxis, { pos: 'b', reverse: valReversed(e), hidden: o.valAxis?.hidden !== false, tick: 'out', min: 0, max: 1, grid: null });
    return xChartSpace(e, plot, { rid });
  }
  // colStackedTotal
  let line = '';
  if (e.total) {
    const k = (e.series || []).length;
    const totals = data[k].values;
    const tl = { size: 9, bold: true, color: C.slate900, pos: 't', format: '#,##0', ...(e.total.labels || {}) };
    const sec = e.total.second || null;
    const rich = {};
    if (sec && Array.isArray(sec.values)) {
      totals.forEach((t, i) => {
        const t1 = fmtCode(t, tl.format);
        const t2 = fmtCode(sec.values[i], sec.format || tl.format);
        if (!t1 || !t2) return;
        rich[i] = xRichLabel(i, [
          { text: t1, size: tl.size, bold: !!tl.bold, color: tl.color },
          { text: t2, size: sec.size || 8, bold: sec.bold !== false, color: sec.color || tl.color },
        ], tl.pos);
      });
    }
    line = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/><c:ser>${xSerHead(k, data[k].name)}<c:spPr><a:ln w="12700"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>`
      + `${xDLbls(tl, {}, rich)}${xCatVal(k, cats, totals, fmt)}<c:smooth val="0"/></c:ser><c:marker val="1"/>${axIds}</c:lineChart>`;
  }
  const va = o.valAxis || {};
  const plot = `<c:barChart><c:barDir val="col"/><c:grouping val="stacked"/>${sers}<c:gapWidth val="${gap}"/><c:overlap val="${overlap}"/>${axIds}</c:barChart>${line}`
    + xCatAx(o.catAxis, { pos: 'b', reverse: catReversed(e), hidden: !!o.catAxis?.hidden, tick: 'out' })
    + xValAx(va, { pos: 'l', reverse: valReversed(e), hidden: !!va.hidden, tick: 'none', min: numOrNull(va.min), max: numOrNull(va.max), grid: { color: '#D9D9D9', pt: 0.75 } });
  return xChartSpace(e, plot, { rid });
}

// --- post-process ----------------------------------------------------------------
const needsPatch = (plan) => plan.some((c) => c.runs || c.spans || c.charts.some(Boolean));

/**
 * pptxgenjs writes every COVERED cell of a merged region as a bare
 * <a:tc vMerge|hMerge="1"><a:tcPr/></a:tc>. PowerPoint (and the reference deck) keeps the
 * ORIGIN cell's <a:tcPr> on each covered cell — borders, fill, margins, anchor — and the
 * outer edges of a merged region (e.g. a note cell on the table's right or bottom edge)
 * are drawn from those covered cells. Copy the origin's tcPr onto each bare covered cell.
 * pptxgenjs writes the full grid (one <a:tc> per grid column per row), so a covered cell's
 * origin is found by walking left over hMerge cells and up over vMerge cells.
 */
export function fillCoveredCells(xml) {
  return xml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, (tbl) => {
    const rows = [...tbl.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map((m) =>
      [...m[1].matchAll(/<a:tc\b([^>]*)>([\s\S]*?)<\/a:tc>/g)].map((c) => ({
        h: /\bhMerge="1"/.test(c[1]),
        v: /\bvMerge="1"/.test(c[1]),
        tcPr: (/<a:tcPr\b[^>]*\/>|<a:tcPr\b[^>]*>[\s\S]*?<\/a:tcPr>/.exec(c[2]) || [''])[0],
      })));
    const origin = (r, c) => {
      for (let guard = 0; guard < 10000; guard++) {
        const cell = rows[r] && rows[r][c];
        if (!cell) return null;
        if (cell.h && c > 0) c -= 1;
        else if (cell.v && r > 0) r -= 1;
        else return cell;
      }
      return null;
    };
    let ri = -1;
    return tbl.replace(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g, (tr) => {
      ri += 1;
      let ci = -1;
      return tr.replace(/<a:tc\b([^>]*)>([\s\S]*?)<\/a:tc>/g, (tc, attrs, body) => {
        ci += 1;
        const cell = rows[ri][ci];
        if (!cell || !(cell.h || cell.v) || !/^\s*<a:tcPr\/>\s*$/.test(body)) return tc;
        const o = origin(ri, ci);
        if (!o || o === cell || !o.tcPr || o.tcPr === '<a:tcPr/>') return tc;
        return `<a:tc${attrs}>${body.replace('<a:tcPr/>', o.tcPr)}</a:tc>`;
      });
    });
  });
}

/**
 * pptxgenjs 3.12 writes one <a:pPr> PER RUN, so a multi-run paragraph carries several
 * (schema-invalid: pPr may only open a paragraph). Keep the first, drop the rest — the
 * per-run copies are identical (every run inherits the box's align/rtl).
 */
export function dedupeParagraphProps(xml) {
  return xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (m, inner) => {
    let seen = false;
    const out = inner.replace(/<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/g, (pp) => {
      if (seen) return '';
      seen = true;
      return pp;
    });
    return `<a:p>${out}</a:p>`;
  });
}

function parseRels(xml) {
  const map = {};
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0]);
    const target = /\bTarget="([^"]+)"/.exec(m[0]);
    if (id && target) map[id[1]] = target[1];
  }
  return map;
}
// Resolve a relationship Target against the part that owns the rels file.
function resolvePart(fromPart, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = fromPart.split('/').slice(0, -1);
  target.split('/').forEach((seg) => {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  });
  return parts.join('/');
}

/**
 * Apply the plan to the pptxgenjs package: dedupe run paragraphs on slides with runs,
 * give covered table cells their origin's tcPr on slides with merged cells, and replace each native-kind chart part with buildChartXml(). A slide whose chart
 * count does not match the plan is left untouched (warned) rather than mis-patched.
 * @returns {Promise<Blob>}
 */
export async function patchPptx(data, plan, Zip) {
  const zip = await Zip.loadAsync(data);
  for (let i = 0; i < plan.length; i++) {
    const ctx = plan[i];
    const hasCharts = ctx.charts.some(Boolean);
    if (!ctx.runs && !ctx.spans && !hasCharts) continue;
    const slidePath = `ppt/slides/slide${i + 1}.xml`;
    const sf = zip.file(slidePath);
    if (!sf) { console.warn('[pptx] missing', slidePath); continue; }
    let sx = await sf.async('string');
    if (ctx.runs || ctx.spans) {
      let fixed = ctx.runs ? dedupeParagraphProps(sx) : sx;
      if (ctx.spans) fixed = fillCoveredCells(fixed);
      if (fixed !== sx) { sx = fixed; zip.file(slidePath, sx); }
    }
    if (!hasCharts) continue;
    const rf = zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`);
    if (!rf) { console.warn('[pptx] missing rels for', slidePath); continue; }
    const rels = parseRels(await rf.async('string'));
    const rids = [...sx.matchAll(/<c:chart\b[^>]*?\br:id="([^"]+)"/g)].map((m) => m[1]);
    if (rids.length !== ctx.charts.length) {
      console.warn(`[pptx] ${slidePath}: ${rids.length} chart parts for ${ctx.charts.length} chart elements — left native`);
      continue;
    }
    for (let k = 0; k < rids.length; k++) {
      const job = ctx.charts[k];
      if (!job || !rels[rids[k]]) continue;
      const partPath = resolvePart(slidePath, rels[rids[k]]);
      const cf = zip.file(partPath);
      if (!cf) { console.warn('[pptx] missing chart part', partPath); continue; }
      const old = await cf.async('string');
      const rid = (/<c:externalData\b[^>]*\br:id="([^"]+)"/.exec(old) || [])[1] || null;
      zip.file(partPath, buildChartXml(job, { rid }));
    }
  }
  return zip.generateAsync({ type: 'blob' });
}

// ctx (per slide) records what the post-process must fix: one entry per chart part
// pptxgenjs writes, in order (null = leave as is, else the native-kind job), and whether
// any multi-run text box / merged table cell was added.
function addElement(slide, P, e, ctx) {
  switch (e.t) {
    case 'rect': return addRect(slide, P, e);
    case 'text':
      if (Array.isArray(e.runs) && e.runs.length) ctx.runs = true;
      return addText(slide, e);
    case 'table':
      if ((e.rows || []).some((row) => (row || []).some((c) => c && typeof c === 'object' && (c.rowSpan > 1 || c.colSpan > 1)))) ctx.spans = true;
      return addTable(slide, e);
    case 'chart': {
      const job = addChart(slide, P, e);
      if (job) ctx.charts.push(job === true ? null : job);
      return undefined;
    }
    case 'group': return (e.children || []).forEach((c) => addElement(slide, P, c, ctx));
  }
}

/**
 * @param {import('../contracts.js').SlideSpec} spec
 * @param {{variant?:('internal'|'nupco'), PptxGenJS:any, JSZip?:any}} opts  JSZip for the
 *   post-process (defaults to PptxGenJS.JSZip / globalThis.JSZip, both set by the bundle)
 * @returns {Promise<Blob>}
 */
export async function renderPptx(spec, { variant = 'internal', PptxGenJS, JSZip } = {}) {
  const P = new PptxGenJS();
  P.rtlMode = true; // deck-level rtl="1" like the original (numeric runs stay LTR)
  P.defineLayout({ name: 'LAYOUT_WIDE', width: 13.333, height: 7.5 });
  P.layout = 'LAYOUT_WIDE';
  const plan = [];   // one entry per WRITTEN slide (pptxgenjs names them slide1..N in this order)
  spec.forEach((sd) => {
    if (variant === 'nupco' && sd.internalOnly) return;
    const slide = P.addSlide();
    slide.background = { color: hex(sd.bg || '#FFFFFF') };
    const ctx = { charts: [], runs: false, spans: false };
    sd.elements.forEach((e) => addElement(slide, P, e, ctx));
    plan.push(ctx);
  });
  if (!needsPatch(plan)) {
    // Legacy decks (no schema extension used): pptxgenjs' own blob, untouched.
    const blob = await P.write({ outputType: 'blob' });
    return blob;
  }
  const Zip = JSZip || PptxGenJS.JSZip || globalThis.JSZip;
  if (!Zip || typeof Zip.loadAsync !== 'function') {
    console.warn('[pptx] JSZip unavailable — native chart/label post-process skipped');
    return P.write({ outputType: 'blob' });
  }
  const buf = await P.write({ outputType: 'arraybuffer' });
  return patchPptx(buf, plan, Zip);
}

export default renderPptx;
