// test/tracker-slides.test.mjs — `node --test test/tracker-slides.test.mjs`
//
// THE PROJECT-TRACKER SLIDES («متابعة المشروع», src/slidespec/build-tracker.js) and their
// place in the three decks:
//   • nothing to show → no slide (null tracker, 0 tasks, only blank rows);
//   • the internal and the NUPCO decks print the SAME slides (user rule: the tracker is the
//     NUPCO ↔ Lean plan) — single-hospital and main deck alike;
//   • no content box below the 6.95 floor for 0..60 tasks, with long texts, unbroken words,
//     Arabic text and one group per row; every cell's estimated lines fit its row;
//   • overdue = due strictly before the REPORT date and not Completed; unknown statuses
//     print verbatim; blank / «Not Found» print «–»;
//   • placement + toggle: KAMC/SGH in the retired action slot, main deck after compliance;
//     challenges only when on AND non-empty; every other slide unchanged.
// SYNTHETIC data only (public repo) — never the user's workbook rows.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTrackerSlides, TRACKER_LABELS, TR, formatDue, isOverdue, statusKey, fitCell, chipTextWidth, CHIP_PAD,
} from '../src/slidespec/build-tracker.js';
import { buildBothSpec } from '../src/slidespec/build-spec-both.js';
import { buildSpec, DEFAULT_LABELS, LABEL_NAMES } from '../src/slidespec/build-spec.js';
import { REPORT_OPTIONS_SEED } from '../src/seeds/defaults.js';
import { buildBothModel } from '../src/model/hospital-report.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';
import { loadPptxGen, installDom, unzipPptx } from './render-helpers.mjs';

const FLOOR = 6.95;
const EPS = 1e-9;
const clone = () => structuredClone(MOCK_REPORT_MODEL);
const sum = (a) => a.reduce((s, v) => s + v, 0);
const tableOf = (s) => s.elements.find((e) => e.t === 'table');
const tableBottom = (t) => t.y + sum(t.rowH);
const cellText = (c) => (c && typeof c === 'object' ? c.text : c);
const trackerSlides = (spec) => spec.filter((s) => s.id === 'tracker' || s.id.startsWith('tracker-cont-'));
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const withoutFooter = (s) => ({ ...s, elements: s.elements.slice(0, -1) });

let seq = 0;
/** One synthetic ProjectTracker task. */
const task = (o = {}) => {
  seq += 1;
  return {
    id: `x${seq}`, wbs: `9.${seq}`, track: 'Track A', milestone: 'Stage 1', workstream: '', workPackage: '',
    task: `Synthetic task number ${seq}`, taskType: '', organization: 'LEAN', owner: 'Owner A',
    priority: 'High', status: 'In Progress', due: '', predecessor: '', nextAction: '',
    definitionOfDone: '', notes: '', ...o,
  };
};
const tracker = (tasks) => ({ format: 'misbar-task-tracker-v1', fileName: 'synthetic.xlsx', loadedAt: '2026-10-13T00:00:00.000Z', editedAt: null, warnings: [], tasks });

/** Body rows of a table in LOGICAL (RTL reading) order, covered cells re-inserted as null. */
function grid(t) {
  const out = [];
  const pending = [0, 0]; // remaining covered rows for the track / milestone columns
  for (const vis of t.rows.slice(1)) {
    const cells = vis.slice().reverse();
    const row = [];
    for (let c = 0; c < 2; c++) {
      if (pending[c] > 0) { row.push(null); pending[c] -= 1; continue; }
      const cell = cells.shift();
      row.push(cell);
      pending[c] = (cell.rowSpan || 1) - 1;
    }
    row.push(...cells);
    assert.equal(row.length, 8, 'every body row resolves to 8 columns');
    out.push(row);
  }
  assert.deepEqual(pending, [0, 0], 'no rowSpan runs past the table');
  return out;
}

/** The deck-wide geometry rules for a list of tracker slides. */
function assertGeometry(slides, label) {
  slides.forEach((s, i) => {
    const t = tableOf(s);
    const last = i === slides.length - 1;
    assert.ok(Math.abs(sum(t.colW) - 12.467) < 1e-9, `${label}: colW sum`);
    assert.equal(t.rowH.length, t.rows.length, `${label}: one height per row`);
    assert.ok(t.rowH.every((h) => h >= 0.37 - EPS), `${label}: every row ≥ 0.37`);
    const bottom = tableBottom(t);
    assert.ok(bottom <= FLOOR - (last ? 0 : TR.markerH) + EPS, `${label} slide ${i}: table ends at ${bottom}`);
    for (const e of s.elements) {
      if (e.t === 'table') continue;
      // Below the floor live only the footer rule and (appended by the deck) the page number.
      const chrome = (e.t === 'rect' && Math.abs(e.y - 7.1) < EPS) || (e.t === 'text' && Math.abs(e.y - 7.15) < EPS);
      if (!chrome) assert.ok(e.y + e.h <= FLOOR + EPS, `${label} slide ${i}: ${e.t} '${e.text ?? ''}' ends at ${e.y + e.h}`);
      assert.ok(e.x >= 0 - EPS && e.x + e.w <= 13.333 + EPS, `${label}: ${e.t} inside the slide`);
    }
    const marker = s.elements.find((e) => e.t === 'text' && e.text === 'يتبع…');
    assert.equal(!!marker, !last, `${label} slide ${i}: «يتبع…» on every slide but the last`);
    if (marker) assert.ok(Math.abs(marker.y - bottom) < 1e-6, 'the marker sits right under the table');
    // Every cell's own estimated line count fits the height it is given (a merged cell: the
    // sum of the rows it spans). This is what the 0.37 + 0.24/line model guarantees.
    const rows = grid(t);
    const bodyH = t.rowH.slice(1);
    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!cell) return;
        const span = cell.rowSpan || 1;
        const h = sum(bodyH.slice(r, r + span));
        const need = 0.37 + (fitCell(cell.text, TR.colW[c], { bold: !!cell.bold, maxLines: 99 }).lines - 1) * 0.24;
        assert.ok(need <= h + 1e-6, `${label}: '${cell.text.slice(0, 30)}' needs ${need} in ${h}`);
      });
    });
    // Track / milestone rowSpans cover exactly the page's rows.
    const spans = (c) => sum(rows.map((row) => (row[c] ? (row[c].rowSpan || 1) : 0)));
    assert.equal(spans(0), rows.length, `${label}: track spans`);
    assert.equal(spans(1), rows.length, `${label}: milestone spans`);
  });
}

// ---- empty ------------------------------------------------------------------------------

test('nothing to show → no slide: null, no tasks, blank rows only', () => {
  assert.deepEqual(buildTrackerSlides(null), []);
  assert.deepEqual(buildTrackerSlides(undefined, { reportDate: '2026-10-13' }), []);
  assert.deepEqual(buildTrackerSlides(tracker([])), []);
  assert.deepEqual(buildTrackerSlides({ tasks: 'nope' }), []);
  const blank = task({ track: '', milestone: '', task: '', organization: ' ', owner: '', priority: '', status: '', due: '', wbs: '7.7', notes: 'off-slide only' });
  assert.deepEqual(buildTrackerSlides(tracker([blank, null])), [], 'a row with no on-slide field prints nothing');
  // …and the decks simply have no tracker slide, without a gap in the page numbers.
  const m = { ...clone(), projectTracker: null };
  const spec = buildSpec(m);
  assert.deepEqual(spec.map((s) => s.id), ['cover', 'execFunnel', 'monthly', 'compliance', 'challenges', 'thanks']);
  assert.deepEqual(spec.slice(1, -1).map((s) => s.elements.at(-1).text), ['1', '2', '3', '4']);
  const both = buildBothSpec({ ...bothModel(), projectTracker: tracker([]) });
  assert.ok(!both.some((s) => s.id.startsWith('tracker')));
});

// ---- variants ---------------------------------------------------------------------------

test('internal and NUPCO get identical tracker slides — and the variant changes no slide here', () => {
  const t = tracker(Array.from({ length: 30 }, (_, i) => task({ track: `Track ${i % 3}`, due: '2026-09-01' })));
  assert.deepEqual(buildTrackerSlides(t, { reportDate: '2026-10-13', variant: 'nupco' }),
    buildTrackerSlides(t, { reportDate: '2026-10-13', variant: 'internal' }));
  const kamcI = buildSpec(clone(), { variant: 'internal' });
  const kamcN = buildSpec(clone(), { variant: 'nupco' });
  assert.deepEqual(kamcN, kamcI, 'the single-hospital deck is the same for both variants');
  assert.equal(trackerSlides(kamcI).length, 2);
  const sghI = buildSpec({ ...clone(), hospital: 'sgh' }, { variant: 'internal' });
  assert.deepEqual(trackerSlides(buildSpec({ ...clone(), hospital: 'sgh' }, { variant: 'nupco' })), trackerSlides(sghI));
  const bm = { ...bothModel(), projectTracker: MOCK_REPORT_MODEL.projectTracker };
  const bothI = buildSpec(bm, { variant: 'internal' });
  assert.deepEqual(buildSpec(bm, { variant: 'nupco' }), bothI);
  assert.equal(trackerSlides(bothI).length, 2);
  for (const s of [...kamcI, ...bothI]) assert.notEqual(s.internalOnly, true, `${s.id} is never internal-only`);
});

// ---- geometry ---------------------------------------------------------------------------

const LONG = 'Prepare, review and sign off the integration evidence pack together with the partner, including the cut-over rehearsal notes, the rollback plan and every open question raised by the operations team during the last three steering meetings';
const SCENARIOS = {
  short: (i) => task({ track: `Track ${Math.floor(i / 7)}`, milestone: `Stage ${Math.floor(i / 3)}` }),
  long: (i) => task({ track: `Track ${Math.floor(i / 9)}`, task: i % 2 ? LONG : `Short ${i}`, owner: i % 3 ? 'Owner A / Owner B / Owner C / Owner D' : 'Owner A' }),
  huge: (i) => task({ task: `${LONG} ${LONG} ${LONG}`, organization: 'NUPCO / LEAN / PARTNER / VENDOR', status: 'Awaiting the vendor confirmation of scope', priority: 'Undecided for now', due: 'end of quarter subject to approval' }),
  words: (i) => task({ task: 'X'.repeat(40 + i * 7), owner: 'Y'.repeat(60), track: 'Z'.repeat(30 + i) }),
  // One group per row: every row its own track AND milestone with long (wrapping) labels,
  // so the label-growth rule drives the row heights.
  groups: (i) => task({ track: `Rollout Onboarding Programme ${i}`, milestone: `Hospital Readiness Phase ${i}` }),
  arabic: (i) => task({ track: 'مسار التكامل', milestone: `مرحلة ${Math.floor(i / 4)}`, task: 'مهمة تجريبية باللغة العربية لاختبار الالتفاف والمحاذاة في عمود المهمة ' + 'مع نص إضافي '.repeat(i % 5), owner: 'مسؤول أ / مسؤول ب' }),
  mixed: (i) => task({ track: i % 11 === 0 ? '' : `Track ${Math.floor(i / 5)}`, milestone: i % 4 ? 'M' : '', task: i % 6 === 0 ? LONG : `Task ${i}`, status: ['Completed', 'Deleyed', '', 'Not Found', 'Odd'][i % 5], due: ['2026-09-01', '17/9/2026', 'daily', ''][i % 4] }),
};

test('no content below 6.95 for 0..60 tasks — every scenario, every row fits its height', () => {
  let checked = 0;
  for (const [name, make] of Object.entries(SCENARIOS)) {
    for (let n = 0; n <= 60; n++) {
      const tasks = Array.from({ length: n }, (_, i) => make(i));
      const slides = buildTrackerSlides(tracker(tasks), { reportDate: '2026-10-13' });
      if (!n) { assert.deepEqual(slides, []); continue; }
      assertGeometry(slides, `${name}/${n}`);
      // Every task printed exactly once, in tracker order.
      const printed = slides.flatMap((s) => grid(tableOf(s)).map((row) => row[2].text));
      assert.equal(printed.length, n, `${name}/${n}: one row per task`);
      slides.forEach((s, i) => assert.equal(s.id, i ? `tracker-cont-${i}` : 'tracker'));
      checked += slides.length;
    }
  }
  assert.ok(checked > 300, `too few slides checked (${checked})`);
});

test('pagination: the design\'s 10 / 2 / 7 / 15 groups → 3 slides 12 / 7 / 15, no track split', () => {
  const sizes = [['Track A', 10], ['Track B', 2], ['Track C', 7], ['Track D', 15]];
  const tasks = sizes.flatMap(([track, n]) => Array.from({ length: n }, (_, i) => task({ track, milestone: `S${Math.floor(i / 3)}` })));
  const slides = buildTrackerSlides(tracker(tasks), { reportDate: '2026-10-13' });
  assert.deepEqual(slides.map((s) => tableOf(s).rows.length - 1), [12, 7, 15]);
  assert.deepEqual(slides.map((s) => Math.round(tableBottom(tableOf(s)) * 100) / 100), [5.97, 3.96, 6.92]);
  assert.deepEqual(slides.map((s) => tableOf(s).y), [1.16, 1.0, 1.0]);
  // A track continuing onto the next page repeats its merged cell there.
  const many = Array.from({ length: 40 }, () => task({ track: 'One long track' }));
  const pages = buildTrackerSlides(tracker(many));
  assert.ok(pages.length >= 3);
  for (const p of pages) assert.equal(grid(tableOf(p))[0][0].text, 'One long track');
});

test('a cell longer than four lines is cut at a word with «…», a prefix of the original', () => {
  const r = fitCell(`${LONG} ${LONG}`, TR.colW[2]);
  assert.equal(r.lines, 4);
  assert.ok(r.text.endsWith('…'));
  assert.ok(`${LONG} ${LONG}`.startsWith(r.text.slice(0, -1)));
  assert.equal(fitCell(r.text, TR.colW[2], { maxLines: 99 }).lines, 4, 'the cut text re-wraps to four lines');
  const w = fitCell('W'.repeat(400), TR.colW[4]);
  assert.equal(w.lines, 4);
  assert.ok(w.text.endsWith('…'));
  assert.deepEqual(fitCell('  short\n text ', 2), { text: 'short text', lines: 1 });
});

// ---- cells --------------------------------------------------------------------------------

test('overdue: due strictly before the REPORT date and not Completed → red bold + chip', () => {
  const rd = '2026-10-13';
  assert.equal(isOverdue({ due: '2026-10-12', status: 'In Progress' }, rd), true);
  assert.equal(isOverdue({ due: '2026-10-13', status: 'In Progress' }, rd), false, 'due ON the report date is not overdue');
  assert.equal(isOverdue({ due: '2026-10-01', status: 'Completed' }, rd), false);
  assert.equal(isOverdue({ due: '2026-10-01', status: ' completed ' }, rd), false);
  assert.equal(isOverdue({ due: '2026-10-01', status: 'Not Found' }, rd), true, 'an unset status counts as not completed');
  assert.equal(isOverdue({ due: '2026-10-01', status: 'Odd word' }, rd), true);
  assert.equal(isOverdue({ due: '17/9/2026', status: 'Deleyed' }, rd), true, 'a day-first text date is a date');
  assert.equal(isOverdue({ due: 'daily', status: 'In Progress' }, rd), false);
  assert.equal(isOverdue({ due: '', status: 'In Progress' }, rd), false);
  assert.equal(isOverdue({ due: '2026-10-01', status: 'In Progress' }, undefined), false, 'no report date → nothing is overdue');
  // The SAME task is overdue on one report date and not on an earlier one.
  const t = tracker([task({ due: '2026-09-30' }), task({ due: '2026-09-30', status: 'Completed' }), task({ due: '2026-11-30' })]);
  const dueCells = (rdate) => grid(tableOf(buildTrackerSlides(t, { reportDate: rdate })[0])).map((r) => r[7]);
  const late = dueCells('2026-10-13');
  assert.deepEqual(late.map((c) => [c.text, c.color ?? null, c.bold ?? false]),
    [['30/09/2026', '#DC2626', true], ['30/09/2026', '#1E293B', false], ['30/11/2026', '#1E293B', false]]);
  assert.deepEqual(dueCells('2026-09-30').map((c) => c.color ?? null), ['#1E293B', '#1E293B', '#1E293B']);
  const chips = (rdate) => buildTrackerSlides(t, { reportDate: rdate })[0].elements.filter((e) => e.t === 'text' && e.y === TR.stripY).map((e) => e.text);
  assert.ok(chips('2026-10-13').includes('متجاوزة الموعد 1'));
  assert.ok(!chips('2026-09-30').some((x) => x.startsWith('متجاوزة الموعد')));
});

test('due shapes: ISO and d/m/yyyy → dd/mm/yyyy; free text verbatim (italic); blank «–»', () => {
  assert.deepEqual(formatDue('2026-09-06'), { text: '06/09/2026', iso: '2026-09-06', kind: 'date' });
  assert.deepEqual(formatDue('17/9/2026'), { text: '17/09/2026', iso: '2026-09-17', kind: 'date' });
  assert.deepEqual(formatDue('1.2.2026'), { text: '01/02/2026', iso: '2026-02-01', kind: 'date' });
  assert.deepEqual(formatDue('daily'), { text: 'daily', iso: null, kind: 'free' });
  assert.deepEqual(formatDue('31/2/2026'), { text: '31/2/2026', iso: null, kind: 'free' }, 'not a calendar date');
  assert.deepEqual(formatDue(''), { text: '–', iso: null, kind: 'blank' });
  const row = grid(tableOf(buildTrackerSlides(tracker([task({ due: 'daily' }), task({ due: '' })]), { reportDate: '2026-10-13' })[0]));
  assert.deepEqual([row[0][7].text, row[0][7].italic, row[1][7].text, row[1][7].color], ['daily', true, '–', '#94A3B8']);
});

test('status: Arabic pill for the known words (incl. Deleyed), unknown VERBATIM, blank / Not Found «–»', () => {
  const statuses = ['Completed', 'In Progress', 'Deleyed', 'Delayed', 'Blocked', 'On Hold', 'Not Started', 'Awaiting vendor', 'Not Found', '', 'in   progress'];
  const t = tracker(statuses.map((status) => task({ status })));
  const cells = grid(tableOf(buildTrackerSlides(t, { reportDate: '2026-10-13' })[0])).map((r) => r[6]);
  assert.deepEqual(cells.map((c) => c.text),
    ['مكتمل', 'قيد التنفيذ', 'متأخر', 'متأخر', 'متوقف', 'معلّق', 'لم يبدأ', 'Awaiting vendor', '–', '–', 'قيد التنفيذ']);
  assert.deepEqual(cells.map((c) => c.fill ?? null),
    ['#C6EFCE', '#DDEBF7', '#FCE4D6', '#FCE4D6', '#FFC7CE', '#FFF2CC', '#E7E6E6', null, null, null, '#DDEBF7']);
  assert.equal(cells[7].color, '#64748B', 'an unknown word is neutral, not one of the status colours');
  assert.equal(statusKey('Not Found'), 'unset');
  assert.equal(statusKey('مكتمل'), 'completed', 'an Arabic word typed on the website lands in its bucket');
  // Priority: Arabic words, unknown verbatim in grey, blank «–».
  const pri = grid(tableOf(buildTrackerSlides(tracker(['Critical', 'High', 'Medium', 'Low', 'Someday', ''].map((priority) => task({ priority }))))[0])).map((r) => r[5]);
  assert.deepEqual(pri.map((c) => [c.text, c.color, !!c.bold]), [
    ['حرجة', '#C00000', true], ['عالية', '#1E293B', false], ['متوسطة', '#475569', false],
    ['منخفضة', '#64748B', false], ['Someday', '#94A3B8', false], ['–', '#94A3B8', false]]);
});

test('summary strip: first slide only, counts over ALL rows, every chip inside the table width', () => {
  const statuses = ['Completed', 'In Progress', 'Deleyed', 'Blocked', 'On Hold', 'Not Started', 'Odd', ''];
  const tasks = Array.from({ length: 48 }, (_, i) => task({ track: `T${Math.floor(i / 6)}`, status: statuses[i % 8], due: '2026-01-01' }));
  const slides = buildTrackerSlides(tracker(tasks), { reportDate: '2026-10-13' });
  assert.ok(slides.length >= 3);
  const chipTexts = (s) => s.elements.filter((e) => e.t === 'text' && Math.abs(e.y - TR.stripY) < EPS).map((e) => e.text);
  assert.deepEqual(chipTexts(slides[0]), ['إجمالي المهام 48', 'مكتمل 6', 'قيد التنفيذ 6', 'متأخر 6', 'متوقف 6', 'معلّق 6', 'لم يبدأ 6', 'أخرى 6', 'غير محدد 6', 'متجاوزة الموعد 42']);
  for (const s of slides.slice(1)) assert.deepEqual(chipTexts(s), [], 'no strip on continuation slides');
  const pills = slides[0].elements.filter((e) => e.t === 'rect' && Math.abs(e.y - TR.stripY) < EPS);
  assert.equal(pills.length, 10);
  for (const p of pills) assert.ok(p.x >= TR.x - EPS && p.x + p.w <= TR.x + TR.w + EPS, 'chip inside the table width');
  for (let i = 1; i < pills.length; i++) assert.ok(pills[i].x + pills[i].w <= pills[i - 1].x + EPS, 'chips do not overlap');
  // The design's 7-chip case keeps the full 1.25in chips, right-anchored at 12.90.
  const few = buildTrackerSlides(tracker([task({ status: 'Completed' }), task({ status: '' })]), { reportDate: '2026-10-13' })[0];
  const fewPills = few.elements.filter((e) => e.t === 'rect' && Math.abs(e.y - TR.stripY) < EPS);
  assert.deepEqual(fewPills.map((p) => [p.x, p.w]), [[11.65, 1.25], [10.3, 1.25], [8.95, 1.25]]);
});

test('summary strip: overridden total / overdue labels stay on one line inside their pill', () => {
  // trkTotal / trkOverdue are editable in the labels editor; a long override must neither
  // wrap out of the 0.28in pill (into the title above or the table below) nor push chips
  // past the table width. Wider chips grow into spare room; with none, the label is cut «…».
  const statuses = ['Completed', 'In Progress', 'Deleyed', 'Blocked', 'On Hold', 'Not Started', 'Odd', ''];
  const long = { trkTotal: 'إجمالي جميع المهام في المشروع الحالي', trkOverdue: 'مهام متجاوزة الموعد المحدد في الخطة' };
  const cases = [
    { n: 3, sts: ['In Progress'], labels: long },               // 3 chips: room to grow
    { n: 60, sts: statuses, labels: long },                     // 10 chips: no room → cut
    { n: 60, sts: statuses, labels: { trkTotal: 'x'.repeat(200), trkOverdue: 'كلمة'.repeat(60) } },
    { n: 3, sts: ['In Progress'], labels: { trkTotal: '  إجمالي\nالمهام  ' } },   // whitespace collapses
  ];
  for (const c of cases) {
    const tasks = Array.from({ length: c.n }, (_, i) => task({ status: c.sts[i % c.sts.length], due: '2026-01-01' }));
    const s = buildTrackerSlides(tracker(tasks), { reportDate: '2026-10-13', labels: c.labels })[0];
    const pills = s.elements.filter((e) => e.t === 'rect' && Math.abs(e.y - TR.stripY) < EPS);
    const texts = s.elements.filter((e) => e.t === 'text' && Math.abs(e.y - TR.stripY) < EPS);
    assert.equal(pills.length, texts.length);
    for (let i = 0; i < pills.length; i++) {
      const p = pills[i]; const t = texts[i];
      assert.deepEqual([t.x, t.w, t.h], [p.x, p.w, p.h], 'text box = its pill');
      assert.ok(p.x >= TR.x - EPS && p.x + p.w <= TR.x + TR.w + EPS, 'chip inside the table width');
      if (i) assert.ok(p.x + p.w <= pills[i - 1].x + EPS, 'chips do not overlap');
      assert.ok(chipTextWidth(t.text) + CHIP_PAD <= p.w + 1e-5, `one line: «${t.text}» in ${p.w}`);
      assert.ok(!/\n/.test(t.text));
    }
    const n = c.n;
    assert.match(texts[0].text, new RegExp(` ${n}$`), 'the total count is never cut');
    assert.match(texts.at(-1).text, / \d+$/, 'the overdue count is never cut');
    assert.ok(texts.at(-1).text.startsWith(c.labels.trkOverdue ? clean(c.labels.trkOverdue).slice(0, 1) : 'متجاوزة'));
  }
  // 3 chips + room: the long total grows to its full text, nothing is cut, statuses keep 1.25.
  const roomy = buildTrackerSlides(tracker([task({ status: 'In Progress', due: '2026-01-01' })]), { reportDate: '2026-10-13', labels: long })[0];
  const rt = roomy.elements.filter((e) => e.t === 'text' && Math.abs(e.y - TR.stripY) < EPS);
  assert.deepEqual(rt.map((e) => e.text), [`${long.trkTotal} 1`, 'قيد التنفيذ 1', `${long.trkOverdue} 1`]);
  assert.equal(rt[1].w, 1.25);
  assert.ok(rt[0].w > 1.25 && rt[2].w > 1.25);
  // Whitespace in an override collapses (a newline would otherwise wrap the pill).
  const ws = buildTrackerSlides(tracker([task()]), { labels: { trkTotal: '  إجمالي\nالمهام  ' } })[0];
  assert.equal(ws.elements.find((e) => e.t === 'text' && Math.abs(e.y - TR.stripY) < EPS).text, 'إجمالي المهام 1');
  // DEFAULT labels are never cut. Up to nine chips they keep the design's even width; in the
  // 10-chip worst case (every bucket + a 3-digit overdue) the overdue chip takes what it needs
  // from the short status chips' slack — every chip still holds its full text on one line.
  const many = Array.from({ length: 160 }, (_, i) => task({ track: `T${i % 9}`, status: statuses[i % 8], due: '2026-01-01' }));
  const d = buildTrackerSlides(tracker(many), { reportDate: '2026-10-13' })[0];
  const dp = d.elements.filter((e) => e.t === 'rect' && Math.abs(e.y - TR.stripY) < EPS);
  const dt = d.elements.filter((e) => e.t === 'text' && Math.abs(e.y - TR.stripY) < EPS);
  assert.equal(dt[0].text, 'إجمالي المهام 160');
  assert.match(dt.at(-1).text, /^متجاوزة الموعد \d{3}$/);
  assert.ok(!dt.some((x) => x.text.includes('…')));
  dt.forEach((t, i) => assert.ok(chipTextWidth(t.text) + CHIP_PAD <= dp[i].w + 1e-5, t.text));
  assert.ok(Math.abs(dp.at(-1).x - TR.x) < 1e-4, 'the strip spans exactly the table width');
  const nine = buildTrackerSlides(tracker(many.filter((t) => t.status !== 'Odd').slice(0, 99)), { reportDate: '2026-10-13' })[0];   // 2-digit counts
  const np = nine.elements.filter((e) => e.t === 'rect' && Math.abs(e.y - TR.stripY) < EPS);
  assert.equal(np.length, 9);
  for (const p of np) assert.equal(p.w, 1.25);
});

test('labels: the registry keys reach the slide (overrides object or labelOf function)', () => {
  for (const k of Object.keys(TRACKER_LABELS)) {
    assert.equal(DEFAULT_LABELS[k], TRACKER_LABELS[k], `${k} in DEFAULT_LABELS`);
    assert.ok(LABEL_NAMES[k], `${k} in LABEL_NAMES`);
  }
  const t = tracker(Array.from({ length: 30 }, () => task()));
  const s = buildTrackerSlides(t, { labels: { titleTracker: 'خطة العمل', trkTask: 'البند', titleTrackerCont: 'خطة العمل (تابع)' } });
  assert.equal(s[0].elements[1].text, 'خطة العمل');
  assert.equal(s[1].elements[1].text, 'خطة العمل (تابع)');
  assert.ok(tableOf(s[0]).rows[0].includes('البند'));
  const m = { ...clone(), reportOptions: { labels: { titleTracker: 'خطة العمل' } } };
  assert.equal(buildSpec(m).find((x) => x.id === 'tracker').elements[1].text, 'خطة العمل');
  const bm = { ...bothModel(), projectTracker: t };
  bm.reportOptions = { ...bm.reportOptions, labels: { titleTracker: 'خطة العمل' } };
  assert.equal(buildSpec(bm).find((x) => x.id === 'tracker').elements[1].text, 'خطة العمل');
  // A long header override wraps inside a taller header row, still above the floor.
  const wide = buildTrackerSlides(t, { labels: { trkDue: 'تاريخ الاستحقاق المتفق عليه' } });
  assert.ok(tableOf(wide[0]).rowH[0] > 0.37);
  assertGeometry(wide, 'wide header');
});

// ---- decks ------------------------------------------------------------------------------

function bothModel() {
  return buildBothModel({
    kamcRows: [], sghRows: [], tracker: null, sendoutMaster: [],
    settings: { tatLookup: {}, historicalConstants: { cancelledByMonth: {} }, reportOptions: { excludeNoTat: false } },
    reportDate: '2026-10-08',
  });
}

test('KAMC / SGH decks: tracker in the retired action slot; toggle off → gone; pages renumber', () => {
  for (const hospital of [undefined, 'sgh']) {
    const m = { ...clone(), hospital };
    const ids = buildSpec(m).map((s) => s.id);
    assert.deepEqual(ids, ['cover', 'execFunnel', 'monthly', 'compliance', 'tracker', 'tracker-cont-1', 'challenges', 'thanks']);
    m.reportOptions = { slides: { tracker: false } };
    assert.deepEqual(buildSpec(m).map((s) => s.id), ['cover', 'execFunnel', 'monthly', 'compliance', 'challenges', 'thanks']);
    m.reportOptions = { slides: { tracker: true, action: false, definitions: true } };
    const spec = buildSpec(m);
    assert.deepEqual(spec.map((s) => s.id), ['cover', 'execFunnel', 'monthly', 'compliance', 'tracker', 'tracker-cont-1', 'challenges', 'definitions', 'thanks'],
      'the retired action key is inert');
    assert.deepEqual(spec.slice(1, -1).map((s) => s.elements.at(-1).text), ['1', '2', '3', '4', '5', '6', '7']);
  }
  assert.equal(REPORT_OPTIONS_SEED.slides.tracker, true, 'the toggle ships ON');
  assert.deepEqual(buildSpec({ ...clone(), reportOptions: REPORT_OPTIONS_SEED }).map((s) => s.id),
    buildSpec(clone()).map((s) => s.id), 'the seed renders the default deck');
});

test('challenges: rendered only when its toggle is on AND it has a challenge or a risk', () => {
  const ids = (o) => buildSpec({ ...clone(), ...o }).map((s) => s.id);
  assert.ok(ids({}).includes('challenges'));
  assert.ok(!ids({ challenges: [], risks: [] }).includes('challenges'), 'empty → no empty tables shipped');
  assert.ok(!ids({ challenges: undefined, risks: undefined }).includes('challenges'));
  assert.ok(ids({ challenges: [], risks: MOCK_REPORT_MODEL.risks }).includes('challenges'));
  assert.ok(ids({ challenges: MOCK_REPORT_MODEL.challenges, risks: undefined, panels: undefined }).includes('challenges'));
  assert.ok(!ids({ reportOptions: { slides: { challenges: false } } }).includes('challenges'));
});

test('main deck: tracker after compliance, before thanks; toggle off → the reference deck', () => {
  const m = { ...bothModel(), projectTracker: MOCK_REPORT_MODEL.projectTracker };
  const spec = buildBothSpec(m);
  assert.deepEqual(spec.map((s) => s.id), ['cover', 'execFunnel', 'monthly', 'compliance', 'tracker', 'tracker-cont-1', 'thanks']);
  assert.deepEqual(spec.slice(1, -1).map((s) => s.elements.at(-1).text), ['1', '2', '3', '4', '5']);
  assertGeometry(trackerSlides(spec), 'both');
  const off = buildBothSpec({ ...m, reportOptions: { ...m.reportOptions, slides: { tracker: false } } });
  assert.deepEqual(off, buildBothSpec({ ...m, projectTracker: null }));
  assert.deepEqual(off.map((s) => s.id), ['cover', 'execFunnel', 'monthly', 'compliance', 'thanks']);
  // Every OTHER slide is exactly what it is without a tracker (page numbers aside: the
  // tracker comes after them all, so not even those move).
  assert.deepEqual(spec.filter((s) => !s.id.startsWith('tracker')), off);
});

test('single-hospital deck: every non-tracker slide is unchanged by the tracker (page number aside)', () => {
  const withT = buildSpec(clone()).filter((s) => !s.id.startsWith('tracker'));
  const without = buildSpec({ ...clone(), projectTracker: null });
  assert.deepEqual(withT.map((s) => s.id), without.map((s) => s.id));
  withT.forEach((s, i) => {
    const content = s.id !== 'cover' && s.id !== 'thanks';
    assert.deepEqual(content ? withoutFooter(s) : s, content ? withoutFooter(without[i]) : without[i], s.id);
  });
});

test('the tracker slides on the fixture: real-file shapes print as designed', () => {
  const slides = trackerSlides(buildSpec(clone()));
  assertGeometry(slides, 'fixture');
  const rows = slides.flatMap((s) => grid(tableOf(s)));
  assert.equal(rows.length, MOCK_REPORT_MODEL.projectTracker.tasks.length);
  const first = slides[0];
  assert.equal(first.elements[1].text, 'متابعة المشروع');
  assert.equal(slides[1].elements[1].text, 'متابعة المشروع — تتمة');
  assert.deepEqual(tableOf(first).rows[0], ['الاستحقاق', 'الحالة', 'الأولوية', 'المسؤول', 'الجهة', 'المهمة / المخرج', 'المرحلة', 'المسار']);
  assert.deepEqual(tableOf(first).colW, [1.0, 1.17, 0.82, 1.98, 1.05, 4.607, 0.92, 0.92]);
  // Track cells: workbook blue, white bold; a 1.25pt rule above each new track.
  const [r0, , , , , , r6] = grid(tableOf(first));
  assert.deepEqual([r0[0].text, r0[0].fill, r0[0].color, r0[0].rowSpan], ['Track Alpha', '#4472C4', '#FFFFFF', 6]);
  assert.deepEqual([r0[1].text, r0[1].fill, r0[1].rowSpan], ['Alpha One', '#D9E1F2', 3]);
  assert.equal(r0[2].border, undefined);
  assert.deepEqual(r6[2].border, { top: { color: '#94A3B8', pt: 1.25 } });
  assert.deepEqual([r0[2].align, r0[2].rtl], ['left', false], 'Latin task text is left-aligned');
});

test('both renderers accept the tracker slides (PPTX + HTML)', async () => {
  const { PptxGenJS, JSZip } = loadPptxGen();
  installDom();
  const { renderPptx } = await import('../src/render/pptx-renderer.js');
  const { renderSlides } = await import('../src/render/html-renderer.js');
  const decks = [
    buildSpec(clone()),
    buildBothSpec({ ...bothModel(), projectTracker: tracker(Array.from({ length: 45 }, (_, i) => SCENARIOS.mixed(i))) }),
  ];
  for (const spec of decks) {
    const blob = await renderPptx(spec, { PptxGenJS, JSZip });
    const { names, read } = await unzipPptx(blob);
    assert.equal(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, spec.length);
    const idx = spec.findIndex((s) => s.id === 'tracker') + 1;
    const xml = await read(`ppt/slides/slide${idx}.xml`);
    assert.match(xml, /متابعة المشروع/);
    assert.match(xml, /rowSpan="\d+"/, 'merged group cells');
    assert.ok(renderSlides(spec, { variant: 'nupco' }), 'html renderer returns a tree');
  }
});
