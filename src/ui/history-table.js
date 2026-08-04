// ui/history-table.js — 'أرقام التقارير والتقدم' panel for the review screen.
// A self-contained, collapsed-by-default RTL card that shows report progress SINCE
// THE BEGINNING. A range selector (أسبوع | شهر | منذ البداية) drives BOTH a per-sample
// table AND an inline trend chart of الإجمالي / مكتملة / متأخرة بلا نتيجة:
//   • أسبوع      → table = 7 daily rows, chart = 7 daily points
//   • شهر        → table = ~5 weekly rows, chart = ~30 daily points
//   • منذ البداية → table = month-end rows + the report date, chart = weekly points
// The شهر rows are WEEKDAY-AWARE: with the active deltaMode set to 'week' (or one of its
// retired weekly aliases) they sample the last ~5 THURSDAYS instead of arbitrary weekly
// points, and the date column header names that weekday. When the dataset is too short to
// contain even ONE such weekday the rows revert to generic weekly points and the header /
// footnote drop the weekday, so a named weekday always describes the rows shown. أسبوع and
// منذ البداية are unaffected.
// Numbers come from engine/asof.js (published snapshots preferred, else computed
// as-of the sampled date from raw order timestamps). Both engine imports are GUARDED —
// with the module absent the panel degrades to published-history rows only, the chart
// is hidden, and it never crashes. Pure presentation; it mutates nothing it is handed.
//
// ONE COLUMN, ONE DEFINITION (2026-07-28). `completed` changed meaning on
// COMPLETED_DEF_SINCE: a REJECTED result is a lab's final outcome, so مكتملة now
// COUNTS rejected rows. Every entry already sitting in settings.snapshotHistory was
// published under the OLD rule, while computeNumbersAsOf speaks the NEW one — and the
// app is not run every day, so published and computed samples INTERLEAVE inside one
// range. Preferring the published entry for a PRE-CHANGE date therefore made the
// مكتملة column zigzag between two definitions: a cumulative count appeared to FALL
// (e.g. 374 → 365 → 411 across three consecutive days), and نسبة الاكتمال zigzagged
// with it. So for a sample date before COMPLETED_DEF_SINCE the COMPUTED row wins
// whenever the engine is present — the whole row, not just مكتملة, so the row stays
// internally consistent (a published total next to a computed completed could make
// نسبة الاكتمال nonsense). The published entry is still shown when nothing can be
// computed, marked `staleDef` so the footnote says the number is old-definition.
// Stored history itself is NEVER rewritten here — this module only reads it.
import { el } from './components.js?v=v2026-08-04.2';
import { formatDateAr } from '../i18n/ar.js?v=v2026-08-04.2';
import { COMPLETED_DEF_SINCE } from '../model/delta-baseline.js?v=v2026-08-04.2';

// Every relative specifier in this file — static AND the two guarded dynamic ones below —
// carries its ?v= INLINE so scripts/stamp-version.mjs owns the whole literal (its SPEC_RE
// matches a string whose entire content is a relative path + optional query, strips the old
// query and re-stamps). A local `const V = '?v=…'` concatenated onto an already-stamped
// specifier used to live here (2026-07-22): it produced '…/workday.js?v=<new>?v=<stale>',
// a URL the stamper cannot reach, so workday.js was fetched and evaluated TWICE — once
// under the stamped URL (static import in late-labs-section.js / export/late-labs.js) and
// once under the double-query one. Harmless only while these modules are stateless; never
// rebuild a specifier by concatenation here.
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
// `good` is the direction that is GOOD news for that column and is used ONLY to
// colour the tiny sample-over-sample delta: +1 = a rise is progress, −1 = a fall is
// progress, 0 = no claim either way. Painting every delta green (what this file used
// to do) asserted "progress" even for a FALL in a cumulative count — the exact way an
// impossible مكتملة drop read as an improvement — and for a RISE in the late backlog.
// NB مرفوضة is a SUBSET of مكتملة since 2026-07-28, so a rejection raises both; it is
// still bad news on its own column, hence good:-1 there and +1 on مكتملة.
const NUM_COLS = [
  { key: 'total', label: 'الإجمالي', good: 0 },
  { key: 'completed', label: 'مكتملة', good: 1 },
  { key: 'awaitingResults', label: 'بانتظار النتائج', good: -1 },
  { key: 'lateNoResult', label: 'متأخرة بلا نتيجة', good: -1 },
  { key: 'rejected', label: 'مرفوضة', good: -1 },
];
const HEAD_TAIL = ['المصدر', ...NUM_COLS.map((c) => c.label), 'نسبة الاكتمال'];
const headRow = (dateHead) => [dateHead || 'التاريخ', ...HEAD_TAIL];

// deltaMode → the weekday the شهر rows anchor to. 0 = Sunday … 4 = Thursday (matching
// Date#getUTCDay). Anything else (daily, absent, unknown) → null = the old weekly points.
//
// 'week' (the week-to-date default) anchors to THURSDAY, not Sunday. The week's baseline
// is the report before its Sunday, so the report that carries a FULL week of accumulated
// chips is Thursday's — the week-closing one, and the last one actually sent. Sampling
// Thursdays therefore makes the row-to-row gap equal exactly one week's worth of chips,
// so a شهر row's deltas line up with what the deck showed that day. Anchoring on Sunday
// would sample the report whose chips are only one day old.
// The two retired mode values keep their own mappings so a stale stored/cached value
// still produces weekday-anchored rows instead of silently reverting to weekly points.
const WEEKDAY_ANCHORS = {
  week: { dow: 4, label: 'الخميس' },
  'weekly-sun': { dow: 0, label: 'الأحد' },  // retired mode value
  'weekly-thu': { dow: 4, label: 'الخميس' }, // retired mode value
};
const anchorOf = (deltaMode) => WEEKDAY_ANCHORS[deltaMode] || null;
// Weekday of a whole-UTC-day count. Epoch day 0 (1970-01-01) was a Thursday (4); the
// +11 keeps the modulo non-negative for pre-epoch days.
const dowOf = (day) => (((day % 7) + 11) % 7);

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
// شهر note when the rows are weekday-anchored to the active weekly comparison.
const monthNote = (anchor) => (anchor
  ? `عيّنات أسبوعية بحسب يوم ${anchor.label} (آخر ٥ مرات)؛ الرسم بنقاط يومية.`
  : RANGE_NOTE.month);
// Definition footnote, shown only when a rendered sample predates COMPLETED_DEF_SINCE.
// `restated` = those rows were recomputed under the new rule (the normal case, engine
// present); `stale` = a published pre-change row is still on screen under the OLD rule
// because nothing could be computed for it.
const DEF_NOTE_RESTATED = (d) => `أرقام «مكتملة» للتواريخ السابقة لـ ${d} معروضة وفق التعريف الجديد (تشمل النتائج المرفوضة) لتكون السلسلة قابلة للمقارنة، وقد تختلف عن الرقم المنشور حينها.`;
const DEF_NOTE_STALE = (d) => `تغيّر تعريف «مكتملة» في ${d} ليشمل النتائج المرفوضة؛ الصفوف المنشورة قبل هذا التاريخ ما زالت بالتعريف القديم، فلا تُقارن مباشرة بما بعدها.`;
// مرفوضة sits next to مكتملة and is a SUBSET of it — say so under every table so the
// two columns can never be read as two separate quantities to be added together.
const SUBSET_NOTE = 'الرفض نتيجة نهائية للمختبر، لذلك عمود «مرفوضة» محتسب ضمن «مكتملة» ومعروض للتفصيل فقط — لا يُضاف فوقها.';
const CHART_CAP = 40; // hard cap on chart samples (computeNumbersAsOf is O(rows) each)

/* ---- styles (inline so the module stays drop-in; all colours are themed tokens
 * that flip under html[data-theme='dark'] / prefers-color-scheme, see app.css) ---- */
const TABLE_STYLE = 'width:100%;border-collapse:collapse;font-size:.82rem';
const TH_STYLE = 'text-align:center;font-weight:700;color:var(--slate-600);padding:6px 7px;border-bottom:1px solid var(--border-dark);white-space:nowrap;font-size:.7rem';
const TD_STYLE = 'text-align:center;padding:6px 7px;border-bottom:1px solid var(--border);vertical-align:top';
const NUM_V_STYLE = 'font-weight:700;color:var(--text);line-height:1.1';
// Tiny sample-over-sample delta — same chip language as the deck (themed tokens), but
// the COLOUR follows the column's own polarity (NUM_COLS.good) instead of being green
// for everything: green only when the move is good news, red when it is bad news, and
// a neutral slate when the column makes no such claim (الإجمالي).
const DELTA_BASE = 'font-size:.62rem;font-weight:800;line-height:1.15;margin-top:1px;color:';
const deltaStyle = (delta, good) => DELTA_BASE
  + (!good ? 'var(--slate-600)' : (delta * good > 0 ? 'var(--green)' : 'var(--red)'));
const BADGE_BASE = 'display:inline-block;font-size:.66rem;font-weight:700;padding:1px 8px;border-radius:999px;white-space:nowrap;border:1px solid';
const BADGE_PUBLISHED = BADGE_BASE + ';background:var(--good-bg,#DCFCE7);color:var(--good-text,#166534);border-color:rgba(22,163,74,.35)';
const BADGE_COMPUTED = BADGE_BASE + ';background:var(--bg-light);color:var(--slate-600);border-color:var(--border-dark)';
// Range pills — style-matched to the review screen's delta-mode pills (يومي / أسبوعي).
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

// The badge says where the row's numbers came from — and, for the two kinds of row the
// definition change touches, WHICH definition of مكتملة they speak, so the tooltip is
// never just provenance when provenance is not the whole story.
function sourceBadge(sample) {
  const published = sample && sample.source === 'published';
  let title = published ? 'من تقرير منشور' : 'محسوب من بيانات الطلبات كما كانت في ذلك اليوم';
  if (sample && sample.restated) {
    title = 'أُعيد احتساب هذا اليوم من بيانات الطلبات وفق التعريف الجديد لـ«مكتملة» (تشمل المرفوضة)، بدل الرقم المنشور حينها بالتعريف القديم';
  } else if (sample && sample.staleDef) {
    title = 'من تقرير منشور — رقم «مكتملة» فيه بالتعريف القديم (لا يشمل المرفوضة)';
  }
  return el('span', {
    style: published ? BADGE_PUBLISHED : BADGE_COMPUTED,
    title,
    text: published ? 'منشور' : 'محسوب',
  });
}
function numCell(value, delta, good) {
  const kids = [el('div', { style: NUM_V_STYLE, text: fmtNum(value) })];
  if (delta != null && delta !== 0) {
    kids.push(el('div', { dir: 'ltr', style: deltaStyle(delta, good), text: (delta > 0 ? '+' : '−') + Math.abs(delta) }));
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
// ~`count` samples that all fall on weekday `dow`, newest = the last occurrence on or
// before endDay, stepping back 7 days. Occurrences before firstDay are DROPPED (not
// clamped like weeklyRowDates — clamping would break the weekday invariant); when that
// leaves NOTHING (e.g. the dataset starts on the report date and the last `dow` fell
// before it) we return [] so the caller drops the anchor and falls back to the generic
// weekly points — never a row on some other weekday labelled as this one.
// EVERY returned date satisfies dowOf(isoToDays(d)) === dow.
function weekdayRowDates(endDay, firstDay, dow, count = 5) {
  const anchor = endDay - ((dowOf(endDay) - dow + 7) % 7);
  const days = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = anchor - i * 7;
    if (firstDay != null && d < firstDay) continue;
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
/** True for a sample date recorded before مكتملة changed meaning (see file header). */
const isPreDefChange = (date) => isIso(date) && date < COMPLETED_DEF_SINCE;

// One sample. A published snapshot is preferred — EXCEPT for a date before
// COMPLETED_DEF_SINCE, whose stored مكتملة speaks the old definition: preferring it
// would splice a second definition into the middle of the column (see the header),
// so the computed row wins there and is marked `restated`. The published entry is the
// fallback for such a date when nothing can be computed, marked `staleDef`. Returns
// null when neither source is available (degraded → row is dropped).
function numbersForDate(date, ctx) {
  const published = ctx.history && ctx.history[date];
  const hasPublished = isObj(published);
  const preDef = isPreDefChange(date);
  if (hasPublished && !preDef) return { date, numbers: published, source: 'published' };
  if (ctx.computeAsOf) {
    try {
      const { numbers, approx } = ctx.computeAsOf({ rows: ctx.rows, tatTests: ctx.tatTests, asOfIso: date, opts: {} });
      const e = { date, numbers, source: 'computed' };
      if (hasPublished) e.restated = true; // a published entry existed but spoke the old definition
      if (approx && Object.keys(approx).length > 0) e.approx = approx;
      return e;
    } catch (err) { console.warn('[history] computeNumbersAsOf failed for', date, err); }
  }
  // Nothing computable: show the published row rather than dropping it, but say that
  // its مكتملة is not comparable with the rows after the change.
  if (hasPublished) return { date, numbers: published, source: 'published', staleDef: true };
  return null;
}
const resolveSamples = (dates, ctx) => dates.map((d) => numbersForDate(d, ctx)).filter(Boolean);

// Per-(endIso, range, weekday-anchor) bundle cache — toggling ranges (or flipping the
// weekly comparison back and forth) never recomputes (computeNumbersAsOf is O(rows) per
// sample). Keyed by endIso|range|anchor, and the anchor only participates for شهر — the
// only range that reads it — so flipping the weekly comparison reuses the أسبوع and منذ
// البداية bundles instead of minting a new key (and a new resolveSamples pass) per mode.
// Within a review session rows + history are constant per report date, and a date change
// mints fresh keys.
const CACHE = new Map();
function computeBundle(range, ctx) {
  const anchor = ctx.anchor || null;
  const key = `${ctx.endIso}|${range}|${range === 'month' && anchor ? anchor.dow : '-'}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const { endDay, firstDay } = ctx;
  let tableDates, chartDates;
  let rowAnchor = null; // set only when the rows really do all fall on anchor.dow
  if (range === 'month') {
    // Weekday-anchored rows when a weekly comparison is active; else the old weekly points.
    if (anchor) {
      tableDates = weekdayRowDates(endDay, firstDay, anchor.dow, 5);
      if (tableDates.length) rowAnchor = anchor;
    }
    // No weekly comparison, or not one occurrence of that weekday inside the dataset →
    // generic weekly points with rowAnchor left null, so the header stays 'التاريخ' and
    // the footnote stays RANGE_NOTE.month.
    if (!tableDates || !tableDates.length) tableDates = weeklyRowDates(endDay, firstDay, 5);
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
  // rowAnchor rides along so the rendered header/footnote always describe THESE rows: it
  // is non-null only for شهر AND only when every table date really is on that weekday.
  const bundle = { table, chart, degraded: ctx.degraded, anchor: rowAnchor };
  CACHE.set(key, bundle);
  return bundle;
}

/* ===================== rendering ===================== */
function renderTable(samples, dateHead) {
  // samples are oldest→newest. Deltas compare each sample to the previous (older)
  // entry; display is reversed so the newest sample sits at the top.
  const thead = el('thead', {}, [el('tr', {}, headRow(dateHead).map((h) => el('th', { style: TH_STYLE, text: h })))]);
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
      el('td', { style: TD_STYLE }, [sourceBadge(cur)]),
      ...NUM_COLS.map((c) => numCell(nums[c.key], deltaOf(nums, pn, c.key), c.good)),
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
  // RTL chart: time runs right→left (xOf below), so the VALUE axis belongs on the
  // right (leading) edge too — the tick labels used to sit on the trailing left edge,
  // reading against the flow. `right` is now the label gutter, `left` the label-overflow
  // gutter for the newest point.
  const W = 600, H = 210, m = { top: 16, right: 38, bottom: 30, left: 36 };
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
    body += svgText(m.left + pw + 6, y + 3, String(Math.round(v)), 9, { anchor: 'start' });
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
  const anchor = bundle && bundle.anchor;
  const frag = el('div', {});
  const note = range === 'month' ? monthNote(anchor) : (RANGE_NOTE[range] || '');
  frag.appendChild(el('p', { class: 'small muted', style: 'margin:2px 0 12px', text: note }));
  const { table, chart, degraded } = bundle;
  if (!Array.isArray(table) || table.length === 0) {
    frag.appendChild(el('p', { class: 'small muted', style: 'margin:0', text: 'لا توجد بيانات ضمن هذا النطاق.' }));
    return frag;
  }
  // مكتملة changed meaning on COMPLETED_DEF_SINCE. Whenever a rendered sample predates
  // it, say which definition the column speaks — above the chart and the table, because
  // it governs how every مكتملة value and نسبة الاكتمال below is to be read.
  const preDef = table.filter((d) => d && isPreDefChange(d.date));
  if (preDef.length) {
    const since = formatDateAr(COMPLETED_DEF_SINCE) || COMPLETED_DEF_SINCE;
    const stale = preDef.some((d) => d.staleDef);
    frag.appendChild(el('p', {
      class: 'small muted', style: 'margin:-6px 0 12px',
      text: stale ? DEF_NOTE_STALE(since) : DEF_NOTE_RESTATED(since),
    }));
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
  frag.appendChild(renderTable(table, anchor ? `التاريخ (${anchor.label})` : null));
  frag.appendChild(el('p', { class: 'small muted', style: 'margin:8px 0 0', text: SUBSET_NOTE }));
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
 * deltaMode ('daily' | 'week', anything else = unanchored) only affects the شهر rows:
 * 'week' samples the last ~5 THURSDAYS — the week-closing report, so one row-to-row gap
 * is exactly one week's chips — and the date column header names that weekday.
 * `range` seeds the selected range pill (default أسبوع). The live selection is mirrored
 * on the returned element as `panel.dataset.range`, so a caller that rebuilds the panel
 * (e.g. on a delta-mode switch — the switch that drives the شهر rows) can read the old
 * panel's dataset.range and pass it back here instead of snapping the user to أسبوع.
 * @param {{rows:?Object[], tatTests:?Object, history:?Object, endIso:?string,
 *          deltaMode:?('daily'|'week'),
 *          range:?('week'|'month'|'all')}} o
 * @returns {HTMLElement} a <details class="card"> element with dataset.range
 */
export function buildHistoryPanel({ rows, tatTests, history, endIso, deltaMode, range: initialRange } = {}) {
  const details = el('details', { class: 'card history-card', dir: 'rtl' });
  const summary = el('summary', { class: 'card__title', style: 'cursor:pointer', text: 'أرقام التقارير والتقدم' });
  const body = el('div', { class: 'history-body' });
  body.appendChild(el('p', { class: 'small muted', style: 'margin:2px 0 0', text: 'جارٍ التحميل…' }));
  details.append(summary, body);

  let range = RANGES.some((r) => r.key === initialRange) ? initialRange : 'week';
  details.dataset.range = range;

  (async () => {
    const [asofMod, wdMod] = await Promise.all([
      tryImport('../engine/asof.js?v=v2026-08-04.2'),
      tryImport('../engine/workday.js?v=v2026-08-04.2'),
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
        .map((d) => {
          const e = { date: d, numbers: hist[d], source: 'published' };
          // No anchor date → nothing is computed here, so a pre-change entry stays on
          // the OLD definition of مكتملة; flag it so the footnote says exactly that.
          if (isPreDefChange(d)) e.staleDef = true;
          return e;
        });
      body.appendChild(renderRangeContent({ table, chart: [], degraded: true }, 'all'));
      return;
    }

    const endDay = isoToDays(endIso);
    const firstDay = computeFirstDay(rows, history, endDay, parseFn, toDayFn);
    const ctx = { rows, tatTests, history, endIso, endDay, firstDay, computeAsOf, degraded, anchor: anchorOf(deltaMode) };

    // Range pills (seeded from o.range, default أسبوع) + a content host the pills swap in place.
    const pillEls = {};
    const pillRow = el('div', { style: 'display:inline-flex;gap:6px;flex-wrap:wrap;margin-bottom:12px' });
    const contentHost = el('div', {});
    const paintPills = () => { for (const r of RANGES) pillEls[r.key].style.cssText = pillStyle(r.key === range); };
    const renderRange = () => { contentHost.innerHTML = ''; contentHost.appendChild(renderRangeContent(computeBundle(range, ctx), range)); };
    for (const r of RANGES) {
      const btn = el('button', {
        type: 'button', text: r.label, 'aria-pressed': 'false',
        onClick: () => {
          if (range === r.key) return;
          range = r.key;
          details.dataset.range = range; // readable by a caller that rebuilds the panel
          paintPills();
          renderRange();
        },
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
