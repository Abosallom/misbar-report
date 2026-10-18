// test/tracker-rules-slides.test.mjs — `node --test test/tracker-rules-slides.test.mjs`
//
// THE 2026-10-18 USER RULES ON THE TASK SLIDES (src/slidespec/build-tracker.js over
// src/model/tracker-status.js) and the DAILY / WEEKLY cadence in the decks:
//   • rule 1 — not Completed + past due → «متأخر» (no status too); Stopped stays «متوقف»; the
//     overdue Late / Stopped date is red;
//   • rule 2 — inside each stage: Late, Stopped, In Progress, Not Started, Completed, by
//     priority then date; undated after dated; stage / track order = first appearance;
//   • rule 3 — the fixed pill set, «لم يبدأ» (not «غير محدد»), counts = the table cells;
//   • rule 4 — status / priority Arabic in every language; owner / entity Arabic outside 'en';
//   • rule 6 — owners centred, « / » joined, RTL; titles «متابعة المهام» / «… —تتمة»;
//   • cadence — daily: no Completed task at all (rows + pill), «تقرير مسبار اليومي» on every
//     cover, no completed-this-week slide; weekly: «المهام المكتملة خلال الأسبوع» after the
//     task slides (own toggle / unit), from the status log, week = Friday → report date.
// SYNTHETIC data only (public repo) — never the user's workbook rows, names or translations.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTrackerSlides, buildTrackerCompletedSlides, completedWeek, joinNames, TR, DONE_COLW, TRACKER_LABELS, fitCell,
} from '../src/slidespec/build-tracker.js';
import { buildSpec, DEFAULT_LABELS, LABEL_NAMES } from '../src/slidespec/build-spec.js';
import { buildBothSpec } from '../src/slidespec/build-spec-both.js';
import { buildBothModel } from '../src/model/hospital-report.js';
import { recordStatusLog, effectiveStatus, STATUS_AR } from '../src/model/tracker-status.js';
import { reportCadence, unitInCadence, cadenceOf, DEFAULT_REPORT_CADENCE, REPORT_CADENCES } from '../src/model/slide-order.js';
import { REPORT_OPTIONS_SEED } from '../src/seeds/defaults.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';
import { loadPptxGen, installDom, unzipPptx } from './render-helpers.mjs';

const RD = '2026-10-18';          // a Sunday → its week opens Friday 2026-10-16
const EPS = 1e-9;
const RLE = '‫';
const PDF = '‬';
const bare = (s) => String(s).replace(/[‪-‮]/g, '');
const sum = (a) => a.reduce((s, v) => s + v, 0);
const tableOf = (s) => s.elements.find((e) => e.t === 'table');
const titleOf = (s) => s.elements[1].text;
const chipTexts = (s) => s.elements.filter((e) => e.t === 'text' && Math.abs(e.y - TR.stripY) < EPS).map((e) => e.text);

let seq = 0;
const task = (o = {}) => {
  seq += 1;
  return {
    id: `r${seq}`, wbs: `7.${seq}`, track: 'Track A', milestone: 'Stage 1', workstream: '', workPackage: '',
    task: `Synthetic task ${seq}`, taskType: '', organization: 'LEAN', owner: 'Owner A', priority: 'High',
    status: 'In Progress', due: '', predecessor: '', nextAction: '', definitionOfDone: '', notes: '', ...o,
  };
};
const tracker = (tasks) => ({ format: 'misbar-task-tracker-v1', fileName: 'synthetic.xlsx', loadedAt: '2026-10-13T00:00:00.000Z', editedAt: null, warnings: [], tasks });

/** Body rows of a table in LOGICAL order, covered cells as null (HTML table algorithm). */
function grid(t) {
  const n = t.colW.length;
  const body = t.rows.slice(1);
  const out = body.map(() => Array(n).fill(undefined));
  body.forEach((vis, r) => {
    let c = 0;
    for (const cell of vis) {
      while (c < n && out[r][c] !== undefined) c++;
      const span = (cell && cell.rowSpan) || 1;
      for (let k = 0; k < span; k++) out[r + k][c] = k ? null : cell;
      c++;
    }
  });
  return out.map((row) => row.slice().reverse());
}
const rowsOf = (slides) => slides.flatMap((s) => grid(tableOf(s)));
const taskTexts = (slides) => rowsOf(slides).map((r) => r[2] && bare(r[2].text)).filter(Boolean);

// ---- rule 1 ---------------------------------------------------------------------------------

test('rule 1: overdue → «متأخر» (blank / unknown status included), Stopped stays «متوقف»; overdue dates red', () => {
  const tasks = [
    task({ task: 'ip-late', status: 'In Progress', due: '2026-10-01' }),
    task({ task: 'blank-late', status: '', due: '2026-10-01' }),
    task({ task: 'odd-late', status: 'Waiting on a vendor', due: '2026-10-01' }),
    task({ task: 'stopped-late', status: 'Blocked', due: '2026-10-01' }),
    task({ task: 'onhold-late', status: 'On Hold', due: '2026-10-02' }),
    task({ task: 'done-old', status: 'Completed', due: '2026-10-01' }),
    task({ task: 'ip-future', status: 'In Progress', due: '2026-11-01' }),
    task({ task: 'ip-today', status: 'In Progress', due: RD }),
    task({ task: 'odd-future', status: 'Waiting on a vendor', due: '2026-11-01' }),
  ];
  const rows = rowsOf(buildTrackerSlides(tracker(tasks), { reportDate: RD }));
  const by = Object.fromEntries(rows.map((r) => [r[2].text, r]));
  for (const k of ['ip-late', 'blank-late', 'odd-late']) {
    assert.equal(by[k][6].text, 'متأخر', k);
    assert.deepEqual([by[k][7].color, by[k][7].bold], ['#DC2626', true], `${k}: red date`);
  }
  for (const k of ['stopped-late', 'onhold-late']) {
    assert.equal(by[k][6].text, 'متوقف', `${k}: Stopped stays Stopped`);
    assert.equal(by[k][7].color, '#DC2626', `${k}: its overdue date is red too`);
  }
  assert.equal(by['done-old'][6].text, 'مكتمل');
  assert.notEqual(by['done-old'][7].color, '#DC2626', 'a completed task is never overdue');
  assert.equal(by['ip-future'][6].text, 'قيد التنفيذ');
  assert.equal(by['ip-today'][6].text, 'قيد التنفيذ', 'due ON the report date is still on time');
  assert.equal(by['odd-future'][6].text, 'Waiting on a vendor', 'an unmappable word not overdue prints verbatim');
});

// ---- rule 2 ---------------------------------------------------------------------------------

test('rule 2: inside a stage — Late, Stopped, In Progress, Not Started, Completed; priority first, then dated before undated, then date', () => {
  const T = (name, status, priority, due) => task({ task: name, status, priority, due });
  const tasks = [
    T('done-low', 'Completed', 'Low', '2026-09-01'),
    T('ns-high', 'Not Started', 'High', '2026-12-01'),
    T('ip-high-late-ish', 'In Progress', 'High', '2026-10-20'),
    T('ip-high-far', 'In Progress', 'High', '2026-12-20'),
    T('ip-crit-undated', 'In Progress', 'Critical', 'TBD'),
    T('ip-crit', 'In Progress', 'Critical', '2026-11-30'),
    T('late-med-old', 'Delayed', 'Medium', '2026-09-01'),
    T('late-crit-new', 'In Progress', 'Critical', '2026-10-10'),
    T('late-crit-old', 'Delayed', 'Critical', '2026-09-15'),
    T('late-high-undated', 'Delayed', 'High', 'daily'),
    T('stop-high', 'Blocked', 'High', '2026-10-01'),
    T('stop-crit', 'On Hold', 'Critical', '2026-11-01'),
    T('done-crit', 'Completed', 'Critical', '2026-09-01'),
  ];
  assert.deepEqual(taskTexts(buildTrackerSlides(tracker(tasks), { reportDate: RD })), [
    'late-crit-old', 'late-crit-new', 'late-high-undated', 'late-med-old',
    'stop-crit', 'stop-high',
    'ip-crit', 'ip-crit-undated', 'ip-high-late-ish', 'ip-high-far',
    'ns-high',
    'done-crit', 'done-low',
  ]);
});

test('rule 2: tracks and stages keep their first-appearance order; a scattered stage is gathered into one block', () => {
  const tasks = [
    task({ track: 'T2', milestone: 'M1', task: 'a', status: 'Completed' }),
    task({ track: 'T1', milestone: 'M9', task: 'b' }),
    task({ track: 'T2', milestone: 'M0', task: 'c' }),
    task({ track: 'T2', milestone: 'M1', task: 'd', status: 'Delayed' }),
  ];
  const rows = rowsOf(buildTrackerSlides(tracker(tasks), { reportDate: RD }));
  assert.deepEqual(rows.map((r) => r[2].text), ['d', 'a', 'c', 'b']);
  assert.deepEqual([rows[0][0].text, rows[0][0].rowSpan, rows[0][1].text, rows[0][1].rowSpan], ['T2', 3, 'M1', 2]);
});

// ---- rule 3 ---------------------------------------------------------------------------------

const MIX = () => Array.from({ length: 41 }, (_, i) => task({
  track: `Track ${i % 4}`, milestone: `Stage ${i % 7}`,
  status: ['Completed', 'In Progress', 'Deleyed', 'Blocked', 'On Hold', 'Not Started', '', 'Not Found', 'Odd word'][i % 9],
  priority: ['Critical', 'High', 'Medium', 'Low', ''][i % 5],
  due: ['2026-09-01', '2026-11-01', 'daily', '', 'TBD', '17/10/2026', '2026-10-18'][i % 7],
}));
/** Count the status cells the tables print (grid column 6) and the red dates. */
function countCells(slides) {
  const out = {};
  let red = 0;
  for (const r of rowsOf(slides)) {
    if (!r[6]) continue;
    out[r[6].text] = (out[r[6].text] || 0) + 1;
    if (r[7].color === '#DC2626') red += 1;
  }
  return { out, red };
}

test('rule 3: the fixed pill set, «لم يبدأ» not «غير محدد», every count = the table cells (weekly and daily)', () => {
  for (const cadence of ['weekly', 'daily']) {
    const slides = buildTrackerSlides(tracker(MIX()), { reportDate: RD, cadence });
    const chips = chipTexts(slides[0]);
    const { out, red } = countCells(slides);
    const n = (label) => Number(chips.find((c) => c.startsWith(`${label} `)).split(' ').at(-1));
    assert.equal(n('إجمالي المهام'), sum(Object.values(out)), `${cadence}: total`);
    for (const k of ['inProgress', 'late', 'stopped', 'notStarted']) assert.equal(n(STATUS_AR[k]), out[STATUS_AR[k]] || 0, `${cadence}: ${k}`);
    assert.equal(n('أخرى'), out['Odd word'], `${cadence}: unmappable words`);
    assert.equal(n('متجاوزة الموعد'), red, `${cadence}: past due = the red dates (Late + overdue Stopped)`);
    assert.ok(!chips.some((c) => c.startsWith('غير محدد')), 'the old box name is gone');
    if (cadence === 'weekly') assert.equal(n('مكتمل'), out['مكتمل'], 'weekly: completed');
    else assert.ok(!chips.some((c) => c.startsWith('مكتمل')), 'daily: no completed pill at all');
    // The order of the strip: total, (completed), in progress, late, stopped, not started, …
    const order = chips.map((c) => c.replace(/ \d+$/, ''));
    const want = ['إجمالي المهام', ...(cadence === 'weekly' ? ['مكتمل'] : []), 'قيد التنفيذ', 'متأخر', 'متوقف', 'لم يبدأ', 'أخرى', 'متجاوزة الموعد'];
    assert.deepEqual(order, want);
  }
  // A zero bucket still shows (the boxes do not come and go between reports).
  assert.deepEqual(chipTexts(buildTrackerSlides(tracker([task({ status: 'In Progress' })]), { reportDate: RD })[0]),
    ['إجمالي المهام 1', 'مكتمل 0', 'قيد التنفيذ 1', 'متأخر 0', 'متوقف 0', 'لم يبدأ 0', 'متجاوزة الموعد 0']);
});

// ---- daily ----------------------------------------------------------------------------------

test('daily: every Completed task is left out entirely; nothing else changes; all completed → no slide', () => {
  const tasks = MIX();
  const weekly = buildTrackerSlides(tracker(tasks), { reportDate: RD });
  const daily = buildTrackerSlides(tracker(tasks), { reportDate: RD, cadence: 'daily' });
  assert.ok(rowsOf(weekly).some((r) => r[6] && r[6].text === 'مكتمل'));
  assert.ok(!rowsOf(daily).some((r) => r[6] && r[6].text === 'مكتمل'), 'no completed row');
  const notDone = tasks.filter((t) => effectiveStatus(t, RD).key !== 'completed').length;
  assert.equal(rowsOf(daily).filter((r) => r[7]).length, notDone, 'every other task is there');
  assert.deepEqual(taskTexts(daily), taskTexts(weekly).filter((t) => !rowsOf(weekly).some((r) => r[2] && bare(r[2].text) === t && r[6].text === 'مكتمل')));
  assert.equal(titleOf(daily[0]), 'متابعة المهام');
  assert.deepEqual(buildTrackerSlides(tracker([task({ status: 'Completed' })]), { reportDate: RD, cadence: 'daily' }), []);
  // Unknown / absent cadence = weekly.
  assert.deepEqual(buildTrackerSlides(tracker(tasks), { reportDate: RD, cadence: 'nope' }), weekly);
});

test('cadence helpers: weekly default, daily only by name; trackerCompleted is weekly-only; the seed matches', () => {
  assert.deepEqual([...REPORT_CADENCES], ['weekly', 'daily']);
  assert.equal(DEFAULT_REPORT_CADENCE, 'weekly');
  assert.equal(REPORT_OPTIONS_SEED.cadence, DEFAULT_REPORT_CADENCE);
  assert.equal(REPORT_OPTIONS_SEED.slides.trackerCompleted, true, 'the completed slide ships ON');
  for (const v of [undefined, null, '', 'Weekly', 'monthly', 3]) assert.equal(reportCadence(v), 'weekly', String(v));
  for (const v of ['daily', ' Daily ', 'DAILY']) assert.equal(reportCadence(v), 'daily', v);
  assert.equal(cadenceOf({ reportOptions: { cadence: 'daily' } }), 'daily');
  assert.equal(cadenceOf({}), 'weekly');
  assert.equal(unitInCadence('trackerCompleted', 'daily'), false);
  assert.equal(unitInCadence('trackerCompleted', 'weekly'), true);
  assert.equal(unitInCadence('tracker', 'daily'), true);
});

// ---- rules 4–6 --------------------------------------------------------------------------------

test('rule 6: titles «متابعة المهام» and «متابعة المهام —تتمة» exactly as the user wrote them', () => {
  assert.equal(TRACKER_LABELS.titleTracker, 'متابعة المهام');
  assert.equal(TRACKER_LABELS.titleTrackerCont, 'متابعة المهام —تتمة');
  const slides = buildTrackerSlides(tracker(Array.from({ length: 30 }, () => task())), { reportDate: RD });
  assert.ok(slides.length >= 2);
  assert.deepEqual(slides.map(titleOf), ['متابعة المهام', ...slides.slice(1).map(() => 'متابعة المهام —تتمة')]);
});

test('rules 4 + 6: owner / entity — Arabic outside en, « / » joined, centred, RTL (embedded); en = the English', () => {
  assert.equal(joinNames('Owner A/Owner B /  Owner C'), 'Owner A / Owner B / Owner C');
  assert.equal(joinNames(' Single '), 'Single');
  assert.equal(joinNames(''), '');
  const t = task({
    owner: 'Owner A/Owner B', ownerAr: 'مسؤول أ / مسؤول ب', organization: 'ORG X / ORG Y', organizationAr: 'جهة س / جهة ص',
    priority: 'Critical', status: 'Not Started',
  });
  const plain = task({ owner: 'Owner C', organization: 'ORG Z', ownerAr: '', organizationAr: '' });
  const partial = task({ owner: 'Owner D / Someone New', ownerAr: 'مسؤول د / Someone New' });
  for (const lang of ['ar', 'both']) {
    const rows = rowsOf(buildTrackerSlides(tracker([t, plain, partial]), { reportDate: RD, lang }));
    const r = rows.find((x) => x[4] && bare(x[4].text) === 'مسؤول أ / مسؤول ب');
    assert.ok(r, `${lang}: the owner's Arabic`);
    assert.deepEqual([r[4].text, r[4].align, r[4].rtl], [`${RLE}مسؤول أ / مسؤول ب${PDF}`, 'center', true], `${lang}: owner centred RTL`);
    assert.deepEqual([bare(r[3].text), r[3].align, r[3].rtl], ['جهة س / جهة ص', 'center', true], `${lang}: entity`);
    assert.equal(r[5].text, 'حرجة', `${lang}: priority Arabic`);
    assert.equal(r[6].text, 'لم يبدأ', `${lang}: status Arabic`);
    const p = rows.find((x) => x[4] && x[4].text === 'Owner C');
    assert.deepEqual([p[4].align, p[4].rtl, p[3].text], ['center', false, 'ORG Z'], `${lang}: no Arabic → the English, centred`);
    const q = rows.find((x) => x[4] && bare(x[4].text).startsWith('مسؤول د'));
    assert.equal(bare(q[4].text), 'مسؤول د / Someone New', `${lang}: an unmapped name stays Latin inside the Arabic cell`);
    assert.equal(q[4].text.startsWith(RLE), true);
  }
  // 'both': owners / entities print ONE line (Arabic) — the English line is for task / groups.
  const both = rowsOf(buildTrackerSlides(tracker([t]), { reportDate: RD, lang: 'both' }));
  assert.ok(!both.flat().some((c) => c && /Owner A|ORG X/.test(c.text)));
  // 'en': the original English everywhere names are, joined; status / priority still Arabic.
  const en = rowsOf(buildTrackerSlides(tracker([t]), { reportDate: RD, lang: 'en' }))[0];
  assert.deepEqual([en[4].text, en[4].align, en[4].rtl, en[3].text], ['Owner A / Owner B', 'center', false, 'ORG X / ORG Y']);
  assert.deepEqual([en[5].text, en[6].text], ['حرجة', 'لم يبدأ']);
});

// ---- the weekly completed-this-week slide ---------------------------------------------------

/** Last week's statuses → this week's: the log the app would hold after both uploads. */
function weekFixture() {
  const before = [
    task({ wbs: '1.1', task: 'was-late', status: 'In Progress', due: '2026-10-05', priority: 'High' }),
    task({ wbs: '1.2', task: 'was-stopped', status: 'Blocked', due: '2026-11-05', priority: 'Critical' }),
    task({ wbs: '1.3', task: 'was-ip', status: 'In Progress', due: '2026-11-05', priority: 'Low', owner: 'Owner A/Owner B', ownerAr: 'مسؤول أ / مسؤول ب' }),
    task({ wbs: '1.4', task: 'still-open', status: 'In Progress', due: '2026-11-05' }),
    task({ wbs: '1.5', task: 'always-done', status: 'Completed', due: '2026-09-01' }),
    task({ wbs: '2.1', track: 'Track B', milestone: 'Stage 9', task: 'done-last-week', status: 'Not Started', due: '2026-11-05' }),
  ];
  const doneNow = new Set(['was-late', 'was-stopped', 'was-ip', 'done-last-week']);
  const now = before.map((t) => (doneNow.has(t.task) ? { ...t, status: 'Completed' } : t));
  const upTo = (names) => tracker(now.map((t) => (names.includes(t.task) ? t : before.find((b) => b.wbs === t.wbs))));
  let log = recordStatusLog(null, tracker(before), '2026-10-08');
  // 'done-last-week' completed BEFORE the last seven days (Sun 2026-10-11; the window of the
  // Sun 2026-10-18 report opens Mon 2026-10-12).
  log = recordStatusLog(log, upTo(['done-last-week']), '2026-10-11');
  // 'was-ip' completed on Wed 2026-10-14 — before the calendar week's Friday but inside the
  // last seven days (review 2026-10-18: it must not fall between two weekly reports).
  log = recordStatusLog(log, upTo(['done-last-week', 'was-ip']), '2026-10-14');
  log = recordStatusLog(log, tracker(now), '2026-10-17');
  return { now: tracker(now), log };
}

test('completed slide: the tasks that BECAME Completed this week, previous status (red when Late / Stopped)', () => {
  // The last SEVEN days, report date included — whatever the weekday (review 2026-10-18).
  assert.deepEqual(completedWeek(RD), { from: '2026-10-12', to: RD });
  assert.deepEqual(completedWeek('2026-10-16'), { from: '2026-10-10', to: '2026-10-16' });
  assert.deepEqual(completedWeek('2026-11-02'), { from: '2026-10-27', to: '2026-11-02' }, 'across a month end');
  assert.equal(completedWeek('18/10/2026'), null);
  const { now, log } = weekFixture();
  const slides = buildTrackerCompletedSlides(now, log, { reportDate: RD });
  assert.equal(slides.length, 1);
  const [s] = slides;
  assert.equal(s.id, 'trackerCompleted');
  assert.equal(titleOf(s), 'المهام المكتملة خلال الأسبوع');
  assert.ok(s.elements.some((e) => e.t === 'text' && e.text === 'آخر سبعة أيام: من 12/10/2026 إلى 18/10/2026'), 'the week subtitle');
  const t = tableOf(s);
  assert.deepEqual(t.rows[0], ['الاستحقاق', 'الحالة', 'الحالة السابقة', 'الأولوية', 'المسؤول', 'الجهة', 'المهمة / المخرج', 'المرحلة', 'المسار']);
  assert.ok(Math.abs(sum(t.colW) - 12.467) < 1e-9);
  assert.deepEqual(t.colW, [...DONE_COLW].reverse());
  const rows = grid(t);
  // Priority order inside the stage (all Completed): Critical, High, Low.
  assert.deepEqual(rows.map((r) => r[2].text), ['was-stopped', 'was-late', 'was-ip']);
  assert.deepEqual(rows.map((r) => [r[6].text, r[6].fill ?? null]),
    // The task slides' own pills (Stopped pink, Late peach) — one word, one colour (review 2026-10-18).
    [['متوقف', '#FFC7CE'], ['متأخر', '#FCE4D6'], ['قيد التنفيذ', null]], 'previous status, tinted when Late / Stopped');
  assert.deepEqual(rows.slice(0, 2).map((r) => r[6].color), ['#9C0006', '#C55A11']);
  assert.ok(rows.every((r) => r[7].text === 'مكتمل' && r[7].fill === '#C6EFCE'), 'the status it became');
  assert.ok(rows.every((r) => r[8].color !== '#DC2626'), 'a completed task\'s date is never red');
  assert.equal(bare(rows[2][4].text), 'مسؤول أ / مسؤول ب', 'same owner rule as the task slides');
  assert.ok(!rows.some((r) => ['still-open', 'always-done', 'done-last-week'].includes(r[2].text)),
    'not completed / first seen completed / completed before the last seven days → not here');
});

test('completed slide: none this week → ONE slide saying so; no log / no tracker / no date → no slide', () => {
  const { now } = weekFixture();
  const log = recordStatusLog(null, now, '2026-10-17');   // first-ever reading: nothing BECAME completed
  const empty = buildTrackerCompletedSlides(now, log, { reportDate: RD });
  assert.equal(empty.length, 1);
  assert.equal(empty[0].id, 'trackerCompleted');
  assert.ok(!empty[0].elements.some((e) => e.t === 'table'));
  assert.ok(empty[0].elements.some((e) => e.t === 'text' && e.text === 'لم تُسجَّل مهام اكتملت خلال هذا الأسبوع'));
  assert.ok(empty[0].elements.some((e) => e.t === 'text' && e.text === 'آخر سبعة أيام: من 12/10/2026 إلى 18/10/2026'));
  for (const e of empty[0].elements) assert.ok(e.y + e.h <= 6.95 + EPS || Math.abs(e.y - 7.1) < EPS);
  assert.deepEqual(buildTrackerCompletedSlides(now, undefined, { reportDate: RD }), []);
  assert.deepEqual(buildTrackerCompletedSlides(null, log, { reportDate: RD }), []);
  assert.deepEqual(buildTrackerCompletedSlides(tracker([]), log, { reportDate: RD }), []);
  assert.deepEqual(buildTrackerCompletedSlides(now, log, {}), []);
  // Labels are overridable like every tracker label.
  const custom = buildTrackerCompletedSlides(now, log, { reportDate: RD, labels: { trkCompletedNone: 'لا شيء', trkWeekRange: '{from} → {to}' } });
  assert.ok(custom[0].elements.some((e) => e.text === 'لا شيء'));
  assert.ok(custom[0].elements.some((e) => e.text === '12/10/2026 → 18/10/2026'));
});

test('completed slide: many tasks paginate inside the floor, «—تتمة» titles, nine columns fit their rows', () => {
  const before = Array.from({ length: 45 }, (_, i) => task({ wbs: `5.${i}`, track: `Track ${i % 3}`, milestone: `Stage ${i % 5}`,
    task: i % 4 ? `Done ${i}` : 'Prepare, review and sign off the synthetic evidence pack together with the partner and every open question', status: 'Delayed', due: '2026-10-01' }));
  const now = before.map((t) => ({ ...t, status: 'Completed' }));
  const log = recordStatusLog(recordStatusLog(null, tracker(before), '2026-10-12'), tracker(now), '2026-10-16');
  const slides = buildTrackerCompletedSlides(tracker(now), log, { reportDate: RD });
  assert.ok(slides.length >= 2);
  slides.forEach((s, i) => {
    assert.equal(s.id, i ? `trackerCompleted-cont-${i}` : 'trackerCompleted');
    assert.equal(titleOf(s), i ? 'المهام المكتملة خلال الأسبوع —تتمة' : 'المهام المكتملة خلال الأسبوع');
    const t = tableOf(s);
    const last = i === slides.length - 1;
    assert.ok(t.y + sum(t.rowH) <= 6.95 - (last ? 0 : TR.markerH) + 1e-6, `slide ${i} inside the floor`);
    const body = t.rowH.slice(1);
    grid(t).forEach((row, r) => row.forEach((cell, c) => {
      if (!cell) return;
      const h = sum(body.slice(r, r + (cell.rowSpan || 1)));
      const need = 0.37 + (fitCell(bare(cell.text), DONE_COLW[c], { bold: !!cell.bold, maxLines: 99 }).lines - 1) * 0.24;
      assert.ok(need <= h + 1e-6, `'${cell.text.slice(0, 20)}' needs ${need} in ${h}`);
    }));
  });
  assert.equal(rowsOf(slides).filter((r) => r[8]).length, 45, 'every completed task once');
});

// ---- decks ------------------------------------------------------------------------------------

const withLog = (m, log, ro = {}) => ({ ...m, reportDate: RD, trackerStatusLog: log, reportOptions: { ...(m.reportOptions || {}), ...ro } });
function bothModel() {
  return buildBothModel({
    kamcRows: [], sghRows: [], tracker: null, sendoutMaster: [],
    settings: { tatLookup: {}, historicalConstants: { cancelledByMonth: {} }, reportOptions: { excludeNoTat: false } },
    reportDate: RD,
  });
}
const DECKS = {
  KAMC: () => structuredClone(MOCK_REPORT_MODEL),
  SGH: () => ({ ...structuredClone(MOCK_REPORT_MODEL), hospital: 'sgh' }),
  'KAMC+SGH': () => bothModel(),
};

test('decks: weekly → the completed slide right after the task slides; its toggle and order are its own', () => {
  const { now, log } = weekFixture();
  for (const [name, make] of Object.entries(DECKS)) {
    for (const variant of ['internal', 'nupco']) {
      const m = withLog({ ...make(), projectTracker: now }, log);
      const ids = buildSpec(m, { variant }).map((s) => s.id);
      const k = ids.indexOf('trackerCompleted');
      assert.ok(k > 0, `${name} ${variant}: present`);
      assert.ok(ids[k - 1].startsWith('tracker') && !ids[k - 1].startsWith('trackerCompleted'), `${name}: right after the task slides`);
      // Its own toggle: off → gone, the task slides stay; the task toggle off → it stays.
      const off = buildSpec(withLog(m, log, { slides: { trackerCompleted: false } }), { variant }).map((s) => s.id);
      assert.ok(!off.includes('trackerCompleted') && off.includes('tracker'), `${name}: own toggle`);
      const noTasks = buildSpec(withLog(m, log, { slides: { tracker: false } }), { variant }).map((s) => s.id);
      assert.ok(noTasks.includes('trackerCompleted') && !noTasks.includes('tracker'), `${name}: separate from the task slides`);
      // Its own unit in the slide order.
      const moved = buildSpec(withLog(m, log, { slideOrder: ['trackerCompleted', 'execFunnel'] }), { variant }).map((s) => s.id);
      assert.equal(moved[1], 'trackerCompleted', `${name}: movable on its own`);
    }
  }
  // Without a status log (a model that never recorded one) the decks are what they were.
  const plain = buildSpec(structuredClone(MOCK_REPORT_MODEL)).map((s) => s.id);
  assert.ok(!plain.includes('trackerCompleted'));
});

test('decks: daily → «تقرير مسبار اليومي» on every cover, no completed task, no completed-this-week slide', () => {
  const { now, log } = weekFixture();
  for (const [name, make] of Object.entries(DECKS)) {
    for (const variant of ['internal', 'nupco']) {
      const weekly = buildSpec(withLog({ ...make(), projectTracker: now }, log), { variant });
      const daily = buildSpec(withLog({ ...make(), projectTracker: now }, log, { cadence: 'daily' }), { variant });
      const coverText = (spec) => spec[0].elements.filter((e) => e.t === 'text').map((e) => e.text);
      assert.ok(coverText(weekly).includes('تقرير مسبار الأسبوعي'), `${name} ${variant}: weekly cover`);
      assert.ok(coverText(daily).includes('تقرير مسبار اليومي'), `${name} ${variant}: daily cover`);
      assert.ok(!coverText(daily).includes('تقرير مسبار الأسبوعي'));
      assert.ok(!daily.some((s) => s.id.startsWith('trackerCompleted')), `${name}: weekly-only slide absent`);
      const dailyTracker = daily.filter((s) => /^tracker(-cont-\d+)?$/.test(s.id));
      assert.ok(dailyTracker.length, `${name}: task slides present`);
      assert.ok(!rowsOf(dailyTracker).some((r) => r[6] && r[6].text === 'مكتمل'), `${name}: no completed row`);
      assert.ok(!chipTexts(dailyTracker[0]).some((c) => c.startsWith('مكتمل')), `${name}: no completed pill`);
      // Every other slide is the weekly one (cover title aside).
      const others = (spec) => spec.filter((s) => !s.id.startsWith('tracker') && s.id !== 'cover').map((s) => ({ ...s, elements: s.elements.slice(0, -1) }));
      assert.deepEqual(others(daily), others(weekly), `${name}: nothing else changes`);
    }
  }
  // The daily title is its own label key (an override of the weekly one does not touch it).
  assert.equal(DEFAULT_LABELS.coverTitleDaily, 'تقرير مسبار اليومي');
  assert.ok(LABEL_NAMES.coverTitleDaily);
  const over = buildSpec({ ...structuredClone(MOCK_REPORT_MODEL), reportOptions: { cadence: 'daily', labels: { coverTitleDaily: 'تقرير يومي مخصص' } } });
  assert.ok(over[0].elements.some((e) => e.text === 'تقرير يومي مخصص'));
});

test('both renderers accept the completed slide (table and empty state)', async () => {
  const { PptxGenJS, JSZip } = loadPptxGen();
  installDom();
  const { renderPptx } = await import('../src/render/pptx-renderer.js');
  const { renderSlides } = await import('../src/render/html-renderer.js');
  const { now, log } = weekFixture();
  const spec = [
    ...buildTrackerCompletedSlides(now, log, { reportDate: RD }),
    ...buildTrackerCompletedSlides(now, recordStatusLog(null, now, '2026-10-17'), { reportDate: RD }),
  ];
  const blob = await renderPptx(spec, { PptxGenJS, JSZip });
  const { names, read } = await unzipPptx(blob);
  assert.equal(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, 2);
  assert.match(await read('ppt/slides/slide1.xml'), /الحالة السابقة/);
  assert.match(await read('ppt/slides/slide2.xml'), /لم تُسجَّل مهام اكتملت/);
  assert.ok(renderSlides(spec, { variant: 'nupco' }));
});
