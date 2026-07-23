// ui/history-table.js — 'أرقام التقارير والتقدم' panel for the review screen.
// A self-contained, collapsed-by-default RTL card that shows report progress SINCE
// THE BEGINNING. A range selector (أسبوع | شهر | منذ البداية) drives BOTH a per-sample
// table AND an inline trend chart of الإجمالي / مكتملة / متأخرة بلا نتيجة:
//   • أسبوع      → table = 7 daily rows, chart = 7 daily points
//   • شهر        → table = ~5 weekly rows, chart = ~30 daily points
//   • منذ البداية → table = month-end rows + the report date, chart = weekly points
// Numbers come from engine/asof.js (published snapshots preferred, else computed
// as-of the sampled date from raw order timestamps). Both engine imports are GUARDED —
// with the module absent the panel degrades to published-history rows only, the chart
// is hidden, and it never crashes. Pure presentation; it mutates nothing it is handed.
import { el } from './components.js?v=v2026-07-23.1';
import { formatDateAr } from '../i18n/ar.js?v=v2026-07-23.1';

/* Relative imports carry ?v=… — the orchestrator re-stamps this token. */
const V = '?v=v2026-07-22.13';

async function tryImport(path) { try { return await import(path); } catch { return null; } }

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (s) => typeof s === 'string' && ISO_RE.test(s);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// ISO ⇄ whole-UTC-day, matching model/delta-baseline.js — deterministic, no Date.now().
const isoToDays = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
function daysToIso(n) {
  const dt = new Date(n * 86400000);
  const p2 = (x) => String(x).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
}

// The five headline count columns (in RTL header order) that also get a delta.
const NUM_COLS = [
  { key: 'total', label: 'الإجمالي' },
  { key: 'completed', label: 'مكتملة' },
  { key: 'awaitingResults', label: 'بانتظار النتائج' },
  { key: 'lateNoResult', label: 'متأخرة بلا نتيجة' },
  { key: 'rejected', label: 'مرفوضة' },
];
const HEAD = ['التاريخ', 'المصدر', ...NUM_COLS.map((c) => c.label), 'نسبة الاكتمال'];

// Trend-chart series. Colours are themed tokens with light literal fallbacks (same
// var(--x,<literal>) pattern the file uses elsewhere): --brand-ink is navy in light
// and lightens to a legible blue in dark; --green / --red flip per theme too.
const CHART_SERIES = [
  { key: 'total', label: 'الإجمالي', color: 'var(--brand-ink,#1E3A8A)' },
  { key: 'completed', label: 'مكتملة', color: 'var(--green,#16A34A)' },
  { key: 'lateNoResult', label: 'متأخرة بلا نتيجة', color: 'var(--red,#DC2626)' },
];

// Range selector → { table + chart granularity, footnote }.
const RANGES = [
  { key: 'week', label: 'أسبوع' },
  { key: 'month', label: 'شهر' },
  { key: 'all', label: 'منذ البداية' },
];
const RANGE_NOTE = {
  week: 'التقدم اليومي خلال آخر ٧ أيام (الأحدث أولاً).',
  month: 'عيّنات أسبوعية خلال آخر شهر تقريباً؛ الرسم بنقاط يومية.',
  all: 'من بداية المشروع حتى تاريخ التقرير: عيّنات شهرية في الجدول، وأسبوعية في الرسم.',
};
const CHART_CAP = 40; // hard cap on chart samples (computeNumbersAsOf is O(rows) each)

/* ---- styles (inline so the module stays drop-in; all colours are themed tokens
 * that flip under html[data-theme='dark'] / prefers-color-scheme, see app.css) ---- */
const TABLE_STYLE = 'width:100%;border-collapse:collapse;font-size:.82rem';
const TH_STYLE = 'text-align:center;font-weight:700;color:var(--slate-600);padding:6px 7px;border-bottom:1px solid var(--border-dark);white-space:nowrap;font-size:.7rem';
const TD_STYLE = 'text-align:center;padding:6px 7px;border-bottom:1px solid var(--border);vertical-align:top';
const NUM_V_STYLE = 'font-weight:700;color:var(--text);line-height:1.1';
// Tiny sample-over-sample delta — same green language as the deck chips (themed token).
const DELTA_STYLE = 'font-size:.62rem;font-weight:800;color:var(--green);line-height:1.15;margin-top:1px';
const BADGE_BASE = 'display:inline-block;font-size:.66rem;font-weight:700;padding:1px 8px;border-radius:999px;white-space:nowrap;border:1px solid';
const BADGE_PUBLISHED = BADGE_BASE + ';background:var(--good-bg,#DCFCE7);color:var(--good-text,#166534);border-color:rgba(22,163,74,.35)';
const BADGE_COMPUTED = BADGE_BASE + ';background:var(--bg-light);color:var(--slate-600);border-color:var(--border-dark)';
// Range pills — style-matched to the review screen's يومي/أسبوعي delta-mode pills.
const pillStyle = (on) => 'border-radius:999px;padding:6px 16px;font-weight:700;font-size:.8rem;cursor:pointer;min-height:32px;line-height:1;transition:background .12s;'
  + (on
    ? 'background:var(--navy);color:#fff;border:1px solid var(--navy);'
    : 'background:var(--white);color:var(--slate-600);border:1px solid var(--border-dark);');

const fmtNum = (v) => (typeof v === 'number' && Number.isFinite(v)) ? String(v) : '—';
function completionRate(nums) {
  const total = nums && nums.total;
  const done = nums && nums.completed;
  if (!(typeof total === 'number' && total > 0 && typeof done === 'number' && Number.isFinite(done))) return null;
  return Math.round((done / total) * 1000) / 10; // 1-decimal
}
function deltaOf(cur, prev, key) {
  const a = cur && cur[key];
  const b = prev && prev[key];
  if (typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b)) return a - b;
  return null;
}

function sourceBadge(source) {
  const published = source === 'published';
  return el('span', {
    style: published ? BADGE_PUBLISHED : BADGE_COMPUTED,
    title: published ? 'من تقرير منشور' : 'محسوب من بيانات الطلبات كما كانت في ذلك اليوم',
    text: published ? 'منشور' : 'محسوب',
  });
}
function numCell(value, delta) {
  const kids = [el('div', { style: NUM_V_STYLE, text: fmtNum(value) })];
  if (delta != null && delta !== 0) {
    kids.push(el('div', { dir: 'ltr', style: DELTA_STYLE, text: (delta > 0 ? '+' : '−') + Math.abs(delta) }));
  }
  return el('td', { dir: 'ltr', style: TD_STYLE }, kids);
}

/* ===================== date-sample generators (oldest → newest ISO) ===================== */
const dedupeDays = (arr) => Array.from(new Set(arr)).sort((a, b) => a - b);
function dailyDates(endDay, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(daysToIso(endDay - i));
  return out;
}
// ~`count` weekly samples ending at endDay, clamped so none precedes firstDay.
function weeklyRowDates(endDay, firstDay, count = 5) {
  const days = [];
  for (let i = count - 1; i >= 0; i--) {
    let d = endDay - i * 7;
    if (firstDay != null && d < firstDay) d = firstDay;
    days.push(d);
  }
  return dedupeDays(days).map(daysToIso);
}
// A run of daily samples of length ≤ span ending at endDay, clamped to firstDay.
function dailyClamped(endDay, span, firstDay) {
  let start = endDay - (span - 1);
  if (firstDay != null && firstDay > start) start = firstDay;
  const out = [];
  for (let d = start; d <= endDay; d++) out.push(daysToIso(d));
  return out;
}
// Last day of each month from firstDay's month up to (not incl) endDay's month, then endDay.
function monthEndDates(firstDay, endDay) {
  const s = new Date(firstDay * 86400000);
  const e = new Date(endDay * 86400000);
  let y = s.getUTCFullYear(), m = s.getUTCMonth();
  const ey = e.getUTCFullYear(), em = e.getUTCMonth();
  const days = [];
  while (y < ey || (y === ey && m < em)) {
    days.push(Date.UTC(y, m + 1, 0) / 86400000); // day 0 of next month = this month's last day
    if (++m > 11) { m = 0; y++; }
  }
  days.push(endDay); // final sample = the report date itself
  return dedupeDays(days.filter((d) => d >= firstDay && d <= endDay)).map(daysToIso);
}
// Weekly points firstDay → endDay, thinned (7→14→…) so the total stays under CHART_CAP.
function weeklyChartDates(firstDay, endDay) {
  const span = Math.max(0, endDay - firstDay);
  let step = 7;
  while (Math.floor(span / step) + 1 > CHART_CAP) step += 7;
  const days = [];
  for (let d = firstDay; d < endDay; d += step) days.push(d);
  days.push(endDay); // always pin the newest point
  return dedupeDays(days).map(daysToIso);
}

/* ===================== number resolution ===================== */
// Excel-agnostic first-order day: prefer engine parse; else an ISO prefix; else null.
function orderDateToDay(s, parseFn, toDayFn) {
  if (parseFn && toDayFn && s != null) {
    const ms = toDayFn(parseFn(s));
    if (typeof ms === 'number' && Number.isFinite(ms)) return Math.round(ms / 86400000);
  }
  if (typeof s === 'string') {
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return isoToDays(m[1]);
  }
  return null;
}
function computeFirstDay(rows, history, endDay, parseFn, toDayFn) {
  let min = null;
  if (Array.isArray(rows)) {
    for (const r of rows) {
      const d = orderDateToDay(r && r.orderDate, parseFn, toDayFn);
      if (d != null && (min == null || d < min)) min = d;
    }
  }
  if (min == null && isObj(history)) {
    for (const k of Object.keys(history)) if (isIso(k)) { const d = isoToDays(k); if (min == null || d < min) min = d; }
  }
  if (min == null) min = endDay - 30; // no signal at all → a month back
  return Math.min(min, endDay);
}
// One sample: published snapshot preferred, else computed as-of (when the engine is
// present). Returns null when neither is available (degraded → row is dropped).
function numbersForDate(date, ctx) {
  const published = ctx.history && ctx.history[date];
  if (isObj(published)) return { date, numbers: published, source: 'published' };
  if (ctx.computeAsOf) {
    try {
      const { numbers, approx } = ctx.computeAsOf({ rows: ctx.rows, tatTests: ctx.tatTests, asOfIso: date, opts: {} });
      const e = { date, numbers, source: 'computed' };
      if (approx && Object.keys(approx).length > 0) e.approx = approx;
      return e;
    } catch (err) { console.warn('[history] computeNumbersAsOf failed for', date, err); }
  }
  return null;
}
const resolveSamples = (dates, ctx) => dates.map((d) => numbersForDate(d, ctx)).filter(Boolean);

// Per-(endIso, range) bundle cache — toggling ranges never recomputes (computeNumbersAsOf
// is O(rows) per sample). Keyed only by endIso|range: within a review session rows +
// history are constant per report date, and a date change mints fresh keys.
const CACHE = new Map();
function computeBundle(range, ctx) {
  const key = `${ctx.endIso}|${range}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const { endDay, firstDay } = ctx;
  let tableDates, chartDates;
  if (range === 'month') {
    tableDates = weeklyRowDates(endDay, firstDay, 5);
    chartDates = dailyClamped(endDay, 30, firstDay);
  } else if (range === 'all') {
    tableDates = monthEndDates(firstDay, endDay);
    chartDates = weeklyChartDates(firstDay, endDay);
  } else { // week
    tableDates = dailyDates(endDay, 7);
    chartDates = tableDates;
  }
  const table = resolveSamples(tableDates, ctx);
  const chart = ctx.degraded ? [] : resolveSamples(chartDates, ctx);
  const bundle = { table, chart, degraded: ctx.degraded };
  CACHE.set(key, bundle);
  return bundle;
}

/* ===================== rendering ===================== */
function renderTable(samples) {
  // samples are oldest→newest. Deltas compare each sample to the previous (older)
  // entry; display is reversed so the newest sample sits at the top.
  const thead = el('thead', {}, [el('tr', {}, HEAD.map((h) => el('th', { style: TH_STYLE, text: h })))]);
  const tbody = el('tbody');
  for (let i = samples.length - 1; i >= 0; i--) {
    const cur = samples[i];
    const prev = i > 0 ? samples[i - 1] : null;
    const nums = cur.numbers || {};
    const pn = prev && prev.numbers;
    const rate = completionRate(nums);
    const tr = el('tr', { style: i % 2 ? '' : 'background:var(--bg-light)' }, [
      el('td', { style: TD_STYLE + ';font-weight:700;white-space:nowrap' }, [
        el('span', { dir: 'ltr', text: formatDateAr(cur.date) || String(cur.date || '') }),
      ]),
      el('td', { style: TD_STYLE }, [sourceBadge(cur.source)]),
      ...NUM_COLS.map((c) => numCell(nums[c.key], deltaOf(nums, pn, c.key))),
      el('td', { dir: 'ltr', style: TD_STYLE }, [
        el('div', { style: NUM_V_STYLE, text: rate == null ? '—' : rate.toFixed(1) + '%' }),
      ]),
    ]);
    tbody.appendChild(tr);
  }
  return el('div', { style: 'overflow-x:auto;-webkit-overflow-scrolling:touch' }, [
    el('table', { style: TABLE_STYLE }, [thead, tbody]),
  ]);
}

/* ---- tiny local SVG helper (no slide-render import; precedent: render/charts-svg.js) ---- */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TIERS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceMax(v) {
  if (!(v > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (TIERS.find((t) => n <= t + 1e-9) || 10) * pow;
}
const shortDate = (iso) => (isIso(iso) ? `${+iso.slice(8, 10)}/${+iso.slice(5, 7)}` : String(iso || ''));
function svgText(x, y, s, size, o = {}) {
  const fill = o.fill || 'var(--slate-600,#475569)';
  // Numeric/Latin ticks: pin LTR so the rtl host page doesn't flip anchoring.
  return `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" font-size="${size}" font-weight="${o.bold ? 700 : 400}" text-anchor="${o.anchor || 'middle'}" direction="ltr" unicode-bidi="plaintext" style="fill:${fill}">${esc(s)}</text>`;
}
// Which x-indices get a date label (avoid crowding): endpoints always, ~6 total.
function labelIdxs(n) {
  if (n <= 1) return [0];
  if (n <= 8) return Array.from({ length: n }, (_, i) => i);
  const want = 6, step = (n - 1) / (want - 1), set = new Set([0, n - 1]);
  for (let k = 0; k < want; k++) set.add(Math.round(k * step));
  return Array.from(set).sort((a, b) => a - b);
}
// Three-line trend chart. RTL TIME: oldest at the RIGHT, newest at the LEFT (i=0
// maps to the right edge). Dots on points; value label on the newest point of each
// line; y auto-scales; width:100% via viewBox. Returns an SVG markup string or null.
function buildTrendChart(samples) {
  const n = samples.length;
  if (!n) return null;
  const W = 600, H = 210, m = { top: 16, right: 36, bottom: 30, left: 38 };
  const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
  const vals = [];
  for (const s of samples) for (const ser of CHART_SERIES) {
    const v = s.numbers && s.numbers[ser.key];
    if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
  }
  const vmax = niceMax(Math.max(1, ...(vals.length ? vals : [1])));
  const yOf = (v) => m.top + ph - (v / vmax) * ph;
  const xOf = (i) => (n === 1 ? m.left + pw / 2 : m.left + pw * (1 - i / (n - 1))); // i=0 oldest → right
  let body = '';
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = (vmax * t) / ticks, y = yOf(v);
    body += `<line x1="${m.left}" y1="${y.toFixed(1)}" x2="${m.left + pw}" y2="${y.toFixed(1)}" style="stroke:var(--border,#E2E8F0)" stroke-width="1"/>`;
    body += svgText(m.left - 6, y + 3, String(Math.round(v)), 9, { anchor: 'end' });
  }
  body += `<line x1="${m.left}" y1="${(m.top + ph).toFixed(1)}" x2="${m.left + pw}" y2="${(m.top + ph).toFixed(1)}" style="stroke:var(--border-dark,#CBD5E1)" stroke-width="1"/>`;
  for (const i of labelIdxs(n)) body += svgText(xOf(i), m.top + ph + 16, shortDate(samples[i].date), 8.5, {});
  for (const ser of CHART_SERIES) {
    const pts = [];
    samples.forEach((s, i) => {
      const v = s.numbers && s.numbers[ser.key];
      if (typeof v === 'number' && Number.isFinite(v)) pts.push({ x: xOf(i), y: yOf(v), v, i });
    });
    if (pts.length >= 2) body += `<polyline points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" style="stroke:${ser.color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`;
    for (const p of pts) body += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2" style="fill:${ser.color}"/>`;
    const last = pts.length ? pts.reduce((a, b) => (b.i > a.i ? b : a), pts[0]) : null; // newest = largest i (leftmost)
    if (last) body += svgText(last.x + 6, Math.max(last.y - 6, m.top + 8), String(last.v), 10, { anchor: 'start', fill: ser.color, bold: true });
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" font-family="Cairo, sans-serif" style="display:block;max-width:100%;height:auto">${body}</svg>`;
}
function buildLegend() {
  const row = el('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin-top:8px' });
  for (const ser of CHART_SERIES) {
    row.appendChild(el('span', { style: 'display:inline-flex;align-items:center;gap:6px;font-size:.72rem;font-weight:700;color:var(--slate-600)' }, [
      el('span', { style: `display:inline-block;width:11px;height:11px;border-radius:3px;background:${ser.color}` }),
      el('span', { text: ser.label }),
    ]));
  }
  return row;
}

// Render the content for one range (chart on top, then the per-sample table + notes).
function renderRangeContent(bundle, range) {
  const frag = el('div', {});
  frag.appendChild(el('p', { class: 'small muted', style: 'margin:2px 0 12px', text: RANGE_NOTE[range] || '' }));
  const { table, chart, degraded } = bundle;
  if (!Array.isArray(table) || table.length === 0) {
    frag.appendChild(el('p', { class: 'small muted', style: 'margin:0', text: 'لا توجد بيانات ضمن هذا النطاق.' }));
    return frag;
  }
  if (!degraded) {
    const svg = buildTrendChart(chart.length ? chart : table);
    if (svg) {
      frag.appendChild(el('div', { style: 'margin:0 0 14px' }, [
        el('div', { class: 'history-chart', html: svg }),
        buildLegend(),
      ]));
    }
  } else {
    frag.appendChild(el('p', { class: 'small muted', style: 'margin:0 0 12px', text: 'الرسم البياني غير متاح (تعذّر حساب الأيام غير المنشورة).' }));
  }
  frag.appendChild(renderTable(table));
  if (degraded) {
    frag.appendChild(el('p', { class: 'small muted', style: 'margin:10px 0 0', text: 'يتم عرض التقارير المنشورة فقط (تعذّر حساب الأيام غير المنشورة).' }));
  }
  if (table.some((d) => d && d.approx)) {
    frag.appendChild(el('p', { class: 'small muted', style: 'margin:6px 0 0', text: 'بعض القيم محسوبة تقديرياً من الطوابع الزمنية.' }));
  }
  return frag;
}

/**
 * buildHistoryPanel — a collapsed-by-default RTL card showing report progress since
 * the beginning, with a range selector (أسبوع | شهر | منذ البداية) driving a per-sample
 * table + a three-line trend chart. Returns synchronously; the body fills once the
 * guarded engine imports resolve. Never throws.
 * @param {{rows:?Object[], tatTests:?Object, history:?Object, endIso:?string}} o
 * @returns {HTMLElement} a <details class="card"> element
 */
export function buildHistoryPanel({ rows, tatTests, history, endIso } = {}) {
  const details = el('details', { class: 'card history-card', dir: 'rtl' });
  const summary = el('summary', { class: 'card__title', style: 'cursor:pointer', text: 'أرقام التقارير والتقدم' });
  const body = el('div', { class: 'history-body' });
  body.appendChild(el('p', { class: 'small muted', style: 'margin:2px 0 0', text: 'جارٍ التحميل…' }));
  details.append(summary, body);

  let range = 'week';

  (async () => {
    const [asofMod, wdMod] = await Promise.all([
      tryImport('../engine/asof.js?v=v2026-07-23.1' + V),
      tryImport('../engine/workday.js?v=v2026-07-23.1' + V),
    ]);
    const computeAsOf = asofMod && typeof asofMod.computeNumbersAsOf === 'function' ? asofMod.computeNumbersAsOf : null;
    const degraded = !computeAsOf;
    const parseFn = wdMod && typeof wdMod.parseDateTime === 'function' ? wdMod.parseDateTime : null;
    const toDayFn = wdMod && typeof wdMod.toEpochDay === 'function' ? wdMod.toEpochDay : null;

    body.innerHTML = '';
    if (!isIso(endIso)) {
      // No valid anchor date → published-only listing, no pills/chart.
      const hist = isObj(history) ? history : {};
      const table = Object.keys(hist).filter((d) => isIso(d) && isObj(hist[d])).sort()
        .map((d) => ({ date: d, numbers: hist[d], source: 'published' }));
      body.appendChild(renderRangeContent({ table, chart: [], degraded: true }, 'all'));
      return;
    }

    const endDay = isoToDays(endIso);
    const firstDay = computeFirstDay(rows, history, endDay, parseFn, toDayFn);
    const ctx = { rows, tatTests, history, endIso, endDay, firstDay, computeAsOf, degraded };

    // Range pills (default أسبوع) + a content host the pills swap in place.
    const pillEls = {};
    const pillRow = el('div', { style: 'display:inline-flex;gap:6px;flex-wrap:wrap;margin-bottom:12px' });
    const contentHost = el('div', {});
    const paintPills = () => { for (const r of RANGES) pillEls[r.key].style.cssText = pillStyle(r.key === range); };
    const renderRange = () => { contentHost.innerHTML = ''; contentHost.appendChild(renderRangeContent(computeBundle(range, ctx), range)); };
    for (const r of RANGES) {
      const btn = el('button', {
        type: 'button', text: r.label, 'aria-pressed': 'false',
        onClick: () => { if (range === r.key) return; range = r.key; paintPills(); renderRange(); },
      });
      pillEls[r.key] = btn;
      pillRow.appendChild(btn);
    }
    paintPills();
    body.append(pillRow, contentHost);
    renderRange();
  })().catch((e) => {
    console.warn('[history] panel build failed', e);
    body.innerHTML = '';
    body.appendChild(el('p', { class: 'small muted', style: 'margin:0', text: 'تعذّر عرض التقدم.' }));
  });

  return details;
}
