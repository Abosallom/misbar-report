// render-html.test.mjs — HTML/PDF side of the BOTH-hospitals element schema
// (html-renderer.js): ellipse, alpha, line.pt centring, text runs + margin, table
// spans / per-row heights / cell margin, valign, border. Also pins that legacy elements
// render to exactly the pre-schema HTML (no extra inline style ever appears).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom, serialise } from './render-helpers.mjs';

installDom();
const { renderSlides } = await import('../src/render/html-renderer.js');
const html = (elements, bg = '#FFFFFF') => serialise(renderSlides([{ id: 's', bg, elements }]));
const one = (el) => html([el]).replace(/^<div class="sl-slide"[^>]*>/, '').replace(/<\/div>$/, '');

test('legacy elements render exactly as before the schema extensions', () => {
  assert.equal(one({ t: 'rect', x: 1, y: 1, w: 2, h: 1, fill: '#2563EB', radius: 0.1, line: { color: '#E2E8F0', w: 0.75 } }),
    '<div class="sl-rect" style="position: absolute; left: 96px; top: 96px; width: 192px; height: 96px; background: #2563EB; border-radius: 9.600000000000001px; border: 0.75px solid #E2E8F0;"></div>');
  assert.equal(one({ t: 'text', x: 1, y: 2, w: 3, h: 0.5, text: 'عربي', size: 12, valign: 'middle' }),
    '<div class="sl-text" style="position: absolute; left: 96px; top: 192px; width: 288px; height: 48px; font-size: 16px; font-weight: 400; color: #000; justify-content: center;"><span class="sl-text-inner" style="direction: rtl; text-align: right;">عربي</span></div>');
  const tbl = one({ t: 'table', x: 1, y: 1, w: 2, colW: [1, 1], rowH: 0.3, rows: [['a', { text: 'ب', fill: '#F1F5F9', bold: true }]] });
  assert.equal(tbl, '<div class="sl-tablewrap" style="position: absolute; left: 96px; top: 96px; width: 192px;"><table class="sl-table" style="width: 192px; table-layout: fixed; border-collapse: collapse;"><colgroup><col style="width: 96px;"></col><col style="width: 96px;"></col></colgroup><tr style="height: 28.799999999999997px;"><td style="color: #1E293B; font-weight: 400; font-size: 13.333333333333332px; text-align: center; direction: ltr;">a</td><td style="background: #F1F5F9; color: #1E293B; font-weight: 700; font-size: 13.333333333333332px; text-align: center; direction: rtl;">ب</td></tr></table></div>');
});

test('rect: ellipse, alpha → rgba, line.pt centred on the edge like PowerPoint', () => {
  assert.match(one({ t: 'rect', shape: 'ellipse', x: 0.5, y: 0.745, w: 0.11, h: 0.11, fill: '#7C3AED', radius: 0.02 }), /background: #7C3AED; border-radius: 50%;/);
  assert.match(one({ t: 'rect', x: 10, y: 4.8, w: 1.3, h: 0.44, fill: '#FFFFFF', alpha: 0.13, radius: 0.22 }), /background: rgba\(255, 255, 255, 0.13\); border-radius: 21.12px;/);
  const card = one({ t: 'rect', x: 0.5, y: 0.98, w: 1.86, h: 2.24, fill: '#FFFFFF', radius: 0.058125, line: { color: '#FF0000', pt: 2.5 } });
  // 2.5 pt = 3.333 px: the box grows by half the stroke each side and the border is in px
  const m = /left: ([\d.]+)px; top: ([\d.]+)px; width: ([\d.]+)px; height: ([\d.]+)px;[\s\S]*border: ([\d.]+)px solid #FF0000/.exec(card);
  assert.ok(m);
  assert.ok(Math.abs(+m[1] - (48 - 3.3333 / 2)) < 0.01 && Math.abs(+m[3] - (1.86 * 96 + 3.3333)) < 0.01);
  assert.ok(Math.abs(+m[5] - 3.3333) < 0.01);
});

test('text runs: one span per run with its own style, br = line break, margin = padding', () => {
  const out = one({ t: 'text', x: 5, y: 3.3, w: 7.82, h: 0.26, size: 10, color: '#64748B', align: 'right', valign: 'middle', rtl: true, margin: [0.01, 0.02, 0.03, 0.04],
    runs: [{ text: '* 67 طلب ملغي  —  ', size: 11, bold: true, color: '#475569' }, { text: 'KAMC ' }, { text: '67', bold: true, color: '#00897B', br: true }, { text: 'سطر', italic: true }] });
  assert.match(out, /padding: 0.96px 1.92px 2.88px 3.84px;/);
  assert.match(out, /<span class="sl-text-inner" style="direction: rtl; text-align: right;"><span style="font-size: 14.666666666666666px; font-weight: 700; color: #475569;">\* 67 طلب ملغي {2}— {2}<\/span><span>KAMC <\/span><span style="font-weight: 700; color: #00897B;">67<\/span>\n<span style="font-style: italic;">سطر<\/span><\/span>/);
  // direction from the joined runs when rtl is absent; margin 0 allowed
  const ltr = one({ t: 'text', x: 0, y: 0, w: 1, h: 0.2, size: 7, margin: 0, runs: [{ text: '+13' }, { text: ' SGH' }] });
  assert.match(ltr, /padding: 0px 0px 0px 0px;/);
  assert.match(ltr, /direction: ltr; text-align: left;/);
});

test('table: rowH array, rowSpan/colSpan, cell margin, valign, borders in points', () => {
  const out = one({ t: 'table', x: 6.27, y: 1, w: 3, colW: [0.74, 0.56, 0.76, 1.14], rowH: [0.3, 0.255, 0.245],
    header: { fill: '#1E3A8A', color: '#FFFFFF', bold: true }, margin: [0.01, 0.03, 0.01, 0.03], border: { color: '#E2E8F0', pt: 0.75 },
    rows: [
      ['الإجمالي', 'أكتوبر', 'المستشفى', 'المؤشر'],
      [{ text: '2,152', border: { top: { color: '#94A3B8', pt: 1.25 }, left: null } }, '90', 'KAMC', { text: 'الفحوصات', rowSpan: 2, margin: 0.02 }],
      [{ text: 'تفاصيل\nسطر', colSpan: 2, valign: 'top' }, 'SGH'],
    ] });
  const trs = [...out.matchAll(/<tr style="height: ([\d.]+)px;">([\s\S]*?)<\/tr>/g)];
  assert.deepEqual(trs.map((m) => Math.round(+m[1] * 1000) / 1000), [28.8, 24.48, 23.52]);
  assert.equal((trs[2][2].match(/<td/g) || []).length, 2, 'covered cells omitted');
  assert.match(trs[1][2], /<td rowspan="2" style="[^"]*padding: 1.92px 1.92px 1.92px 1.92px;/);
  assert.match(trs[2][2], /<td colspan="2" style="[^"]*vertical-align: top;/);
  assert.match(trs[2][2], />تفاصيل\nسطر</, 'newline kept (rendered by .sl-table--lines white-space: pre-line)');
  assert.match(trs[1][2], /padding: 0.96px 2.88px 0.96px 2.88px; border: 1px solid #E2E8F0; border-top: 1.6666666666666665px solid #94A3B8; border-left: none;/);
  assert.match(trs[0][2], /<th style="background: #1E3A8A;/);
});

test('\\n line breaks are OPT-IN: a legacy table keeps collapsing them (KAMC PDF unchanged)', () => {
  const css = fs.readFileSync(new URL('../styles/slide.css', import.meta.url), 'utf8');
  // the global cell rule carries no white-space; only the opt-in class does
  const base = /\.sl-table th,\s*\.sl-table td\s*\{([^}]*)\}/.exec(css)[1];
  assert.doesNotMatch(base, /white-space/);
  assert.match(css, /\.sl-table--lines th,\s*\.sl-table--lines td\s*\{[^}]*white-space:\s*pre-line;/);
  // legacy table (KAMC action slide: two-line due-date range) → plain class, as at HEAD
  const legacy = one({ t: 'table', x: 0, y: 0, w: 2, colW: [1, 1], rowH: 0.3, rows: [['25-06-2026\n16-07-2026', 'مهمة']] });
  assert.match(legacy, /<table class="sl-table" style=/);
  // any schema extension (or lineBreaks: true) → line breaks on; lineBreaks: false forces them off
  const ext = (extra, cell = 'x') => one({ t: 'table', x: 0, y: 0, w: 2, colW: [1, 1], rows: [[cell, 'y']], ...extra });
  assert.match(ext({ rowH: [0.3] }), /class="sl-table sl-table--lines"/);
  assert.match(ext({ border: { color: '#E2E8F0', pt: 0.75 } }), /sl-table--lines/);
  assert.match(ext({ margin: 0 }), /sl-table--lines/);
  assert.match(ext({}, { text: 'a\nb', colSpan: 2 }), /sl-table--lines/);
  assert.match(ext({}, { text: 'a', valign: 'top' }), /sl-table--lines/);
  assert.match(ext({ lineBreaks: true }), /sl-table--lines/);
  assert.match(ext({ rowH: [0.3], lineBreaks: false }), /<table class="sl-table" style=/);
});

test('rowH array: missing / null / 0 entries leave the row auto-height (as pptx-renderer)', () => {
  const out = one({ t: 'table', x: 0, y: 0, w: 2, colW: [1, 1], rowH: [0.3, 0], rows: [['a', 'b'], ['c', 'd'], ['e', 'f']] });
  const trs = [...out.matchAll(/<tr( style="[^"]*")?>/g)].map((m) => m[1] || '');
  assert.deepEqual(trs, [' style="height: 28.799999999999997px;"', '', '']);
});

test('pt <= 0 means no line: rect outline and table borders', () => {
  const r = one({ t: 'rect', x: 1, y: 1, w: 1, h: 1, fill: '#000000', line: { color: '#000000', pt: 0 } });
  assert.doesNotMatch(r, /border/);
  assert.match(r, /left: 96px; top: 96px; width: 96px; height: 96px;/, 'no half-stroke growth');
  const t = one({ t: 'table', x: 0, y: 0, w: 1, colW: [1], border: { color: '#E2E8F0', pt: 0 },
    rows: [[{ text: 'a', border: { top: { color: '#000000', pt: 0 }, bottom: { color: '#000000', pt: 1 } } }]] });
  assert.match(t, /border: none; border-top: none; border-bottom: 1.3333333333333333px solid #000000;/);
});
