// test/tracker-ar-slides.test.mjs — `node --test test/tracker-ar-slides.test.mjs`
//
// THE TRACKER SLIDES' LANGUAGE (reportOptions.trackerLang, src/slidespec/build-tracker.js):
//   • 'en' ignores the translations entirely (today's slides, byte for byte), and a tracker
//     without translations prints the same in every mode (default 'ar' included);
//   • 'ar': task / track / milestone print the Arabic, falling back to the English PER CELL;
//     owner, organization, priority, status and dates never change;
//   • 'both': a translated task is two table rows (Arabic, then the English 8pt grey LTR, the
//     border between them dropped; every other cell spans both); a translated group label is
//     split into an Arabic part and an English part inside its merged block;
//   • no content box below 6.95 for 0..60 tasks with long Arabic, in 'ar' and 'both', and
//     every cell's own estimate (Arabic translations: the shaped Cairo estimate) fits the
//     rows it spans;
//   • the shaped estimate matches Cairo as CoreText sets it;
//   • a translation holding Latin / digits / brackets is wrapped in RLE … PDF (QuickLook
//     ignores rtl="1" on table cells); English and fallback cells never are;
//   • translated decks paginate without a one-task tail slide or a lone block-opening row
//     at a page bottom, never with more slides than the plain fill.
// SYNTHETIC text only (public repo) — never the user's workbook rows or their translations.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTrackerSlides, TR, fitCell, shapedTextWidth, textWidth, trackerSlideLang, TRACKER_SLIDE_LANGS,
} from '../src/slidespec/build-tracker.js';
import { buildSpec } from '../src/slidespec/build-spec.js';
import { buildBothSpec } from '../src/slidespec/build-spec-both.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';
import { loadPptxGen, installDom, unzipPptx } from './render-helpers.mjs';

const FLOOR = 6.95;
const EPS = 1e-9;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const tableOf = (s) => s.elements.find((e) => e.t === 'table');
const ARABIC = /[؀-ۿ]/;
const DATE = '2026-10-13';
const RLE = '\u202B';
const PDF = '\u202C';
const bare = (s) => String(s).replace(/[\u202A-\u202E]/g, '');

let seq = 0;
const task = (o = {}) => {
  seq += 1;
  return {
    id: `a${seq}`, wbs: `8.${seq}`, track: 'Track A', milestone: 'Stage 1', workstream: '', workPackage: '',
    task: `Synthetic task number ${seq}`, taskType: '', organization: 'LEAN', owner: 'Owner A',
    priority: 'High', status: 'In Progress', due: '2026-09-01', predecessor: '', nextAction: '',
    definitionOfDone: '', notes: '', taskAr: '', trackAr: '', milestoneAr: '', ...o,
  };
};
const tracker = (tasks) => ({ format: 'misbar-task-tracker-v1', fileName: 'synthetic.xlsx', loadedAt: '2026-10-13T00:00:00.000Z', editedAt: null, warnings: [], tasks });
const slidesOf = (tasks, lang) => buildTrackerSlides(tracker(tasks), { reportDate: DATE, lang });

// Synthetic Arabic: generic project-management words, recombined.
const WORDS = 'ترتيب صناديق العينات التجريبية في المستودع الافتراضي مع مراجعة قائمة الألوان وتحديث جدول الزيارات الوهمية واختبار نموذج البطاقات المؤقتة للفريق التجريبي'.split(' '); // invented filler words only
const arText = (i, n) => Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length]).join(' ');

/**
 * Body rows of a table in LOGICAL (RTL reading) order, every covered cell as null — the HTML
 * table algorithm (a cell takes the first column not covered by a rowSpan from above), which
 * is what both renderers do. Asserts every row resolves to exactly 8 columns.
 */
function grid(t) {
  const n = t.colW.length;
  const body = t.rows.slice(1);
  const out = body.map(() => Array(n).fill(undefined));
  body.forEach((vis, r) => {
    let c = 0;
    for (const cell of vis) {
      while (c < n && out[r][c] !== undefined) c++;
      assert.ok(c < n, `row ${r}: more cells than columns`);
      const span = (cell && cell.rowSpan) || 1;
      assert.ok(r + span <= body.length, `row ${r}: rowSpan ${span} runs past the table`);
      for (let k = 0; k < span; k++) out[r + k][c] = k ? null : cell;
      c++;
    }
  });
  out.forEach((row, r) => assert.ok(row.every((x) => x !== undefined), `row ${r} resolves to ${n} columns`));
  return out.map((row) => row.slice().reverse());
}

/** Deck-wide geometry + every cell's own estimate fits the height of the rows it spans. */
function assertGeometry(slides, label, lang) {
  slides.forEach((s, i) => {
    const t = tableOf(s);
    const last = i === slides.length - 1;
    assert.equal(t.rowH.length, t.rows.length, `${label}: one height per row`);
    assert.ok(t.rowH.slice(1).every((h) => h >= TR.enRowH - EPS), `${label}: no row below an 8pt line`);
    const bottom = t.y + sum(t.rowH);
    assert.ok(bottom <= FLOOR - (last ? 0 : TR.markerH) + EPS, `${label} slide ${i}: table ends at ${bottom}`);
    for (const e of s.elements) {
      if (e.t === 'table') continue;
      const chrome = e.t === 'rect' && Math.abs(e.y - 7.1) < EPS;
      if (!chrome) assert.ok(e.y + e.h <= FLOOR + EPS, `${label} slide ${i}: ${e.t} ends at ${e.y + e.h}`);
    }
    const marker = s.elements.find((e) => e.t === 'text' && e.text === 'يتبع…');
    assert.equal(!!marker, !last, `${label} slide ${i}: «يتبع…» on every slide but the last`);
    if (marker) assert.ok(Math.abs(marker.y - bottom) < 1e-6);
    const rows = grid(t);
    const bodyH = t.rowH.slice(1);
    rows.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell) return;
      const h = sum(bodyH.slice(r, r + (cell.rowSpan || 1)));
      // In these scenarios Arabic in the task / track / milestone columns is always a
      // translation → the shaped estimate; everything else the legacy one.
      const shaped = lang !== 'en' && c <= 2 && ARABIC.test(cell.text);
      const pt = cell.size || TR.body;
      const lines = fitCell(bare(cell.text), TR.colW[c], { bold: !!cell.bold, pt, maxLines: 99, shaped }).lines;
      const need = pt === TR.enSize ? TR.enRowH + (lines - 1) * TR.enLineH : 0.37 + (lines - 1) * 0.24;
      assert.ok(need <= h + 1e-6, `${label}: '${cell.text.slice(0, 30)}' needs ${need} in ${h}`);
    }));
  });
}

// ---- language option -------------------------------------------------------------------

test('trackerLang: ar | en | both; absent or unknown → ar (the default)', () => {
  assert.deepEqual([...TRACKER_SLIDE_LANGS], ['ar', 'en', 'both']);
  assert.equal(trackerSlideLang(undefined), 'ar');
  assert.equal(trackerSlideLang('xx'), 'ar');
  assert.equal(trackerSlideLang('AR'), 'ar');
  assert.equal(trackerSlideLang('en'), 'en');
  assert.equal(trackerSlideLang('both'), 'both');
});

test("'en' ignores every translation; an untranslated tracker prints the same in every mode", () => {
  const plain = Array.from({ length: 23 }, (_, i) => task({ track: `Track ${Math.floor(i / 6)}`, milestone: `Stage ${Math.floor(i / 3)}`, task: i % 5 ? `Task ${i}` : 'Prepare and sign off the synthetic evidence pack with the partner and the operations team' }));
  const translated = plain.map((t, i) => ({ ...t, taskAr: arText(i, 5 + (i % 9)), trackAr: `المسار ${t.track.length}`, milestoneAr: 'مرحلة' }));
  const en = JSON.stringify(slidesOf(plain, 'en'));
  assert.equal(JSON.stringify(slidesOf(translated, 'en')), en, "'en' never reads taskAr / trackAr / milestoneAr");
  for (const lang of [undefined, 'ar', 'both', 'nope']) assert.equal(JSON.stringify(slidesOf(plain, lang)), en, `untranslated, ${lang}`);
  // A row whose only content is a translation: nothing to print in 'en', a row elsewhere.
  const onlyAr = task({ track: '', milestone: '', task: '', organization: '', owner: '', priority: '', status: '', due: '', taskAr: 'مهمة' });
  assert.deepEqual(slidesOf([onlyAr], 'en'), []);
  assert.equal(slidesOf([onlyAr], 'ar').length, 1);
});

// ---- 'ar' ----------------------------------------------------------------------------------

test("'ar': the Arabic in task / track / milestone, English per cell where none; the rest unchanged", () => {
  const tasks = [
    task({ track: 'Track A', trackAr: 'المسار أ', milestone: 'Stage 1', milestoneAr: 'المرحلة الأولى', task: 'English one', taskAr: 'مهمة تجريبية أولى', owner: 'Owner A', status: 'Completed', due: '2026-09-01' }),
    task({ track: 'Track A', trackAr: 'المسار أ', milestone: 'Stage 1', milestoneAr: 'المرحلة الأولى', task: 'English two', taskAr: '', status: 'Deleyed' }),
    task({ track: 'Track B', trackAr: '', milestone: 'Stage 2', milestoneAr: '', task: 'English three', taskAr: 'مهمة ثالثة' }),
  ];
  const [s] = slidesOf(tasks, 'ar');
  const rows = grid(tableOf(s));
  assert.equal(rows.length, 3, 'one table row per task in ar');
  assert.deepEqual([rows[0][0].text, rows[0][0].rowSpan, rows[0][1].text], ['المسار أ', 2, 'المرحلة الأولى']);
  assert.deepEqual([rows[0][2].text, rows[0][2].align, rows[0][2].rtl], ['مهمة تجريبية أولى', 'right', true]);
  assert.deepEqual([rows[1][2].text, rows[1][2].align, rows[1][2].rtl], ['English two', 'left', false], 'per-cell fallback');
  assert.deepEqual([rows[2][0].text, rows[2][1].text, rows[2][2].text], ['Track B', 'Stage 2', 'مهمة ثالثة']);
  // Owner, org, priority, status, due: the very cells 'en' prints.
  const en = grid(tableOf(slidesOf(tasks, 'en')[0]));
  rows.forEach((row, r) => assert.deepEqual(row.slice(3), en[r].slice(3), `row ${r} columns 3..7`));
  // Rows merge only when they print the same label: same English track, different Arabic.
  const split = grid(tableOf(slidesOf([task({ trackAr: 'س' }), task({ trackAr: 'ص' })], 'ar')[0]));
  assert.deepEqual(split.map((r) => r[0] && r[0].text), ['س', 'ص']);
});

// ---- 'both' --------------------------------------------------------------------------------

test("'both': a translated task is two rows — Arabic, then the English 8pt grey LTR — joined", () => {
  const tasks = [
    task({ track: 'Track A', trackAr: 'المسار أ', milestone: 'Stage 1', milestoneAr: 'المرحلة الأولى', task: 'English one', taskAr: 'مهمة تجريبية أولى' }),
    task({ track: 'Track A', trackAr: 'المسار أ', milestone: 'Stage 1', milestoneAr: 'المرحلة الأولى', task: 'English two', taskAr: '' }),
    task({ track: 'Track A', trackAr: 'المسار أ', milestone: 'Stage 1', milestoneAr: 'المرحلة الأولى', task: 'Same', taskAr: 'Same' }),
  ];
  const [s] = slidesOf(tasks, 'both');
  const t = tableOf(s);
  const rows = grid(t);
  assert.equal(rows.length, 4, 'translated task: 2 rows; untranslated / identical: 1 row each');
  const [ar, en, two, same] = rows;
  assert.deepEqual([ar[2].text, ar[2].rtl, ar[2].valign, ar[2].border], ['مهمة تجريبية أولى', true, 'bottom', { bottom: null }]);
  assert.deepEqual([en[2].text, en[2].size, en[2].color, en[2].rtl, en[2].align, en[2].valign, en[2].border],
    ['English one', TR.enSize, TR.enInk, false, 'left', 'top', { top: null }]);
  for (let c = 3; c < 8; c++) { assert.equal(ar[c].rowSpan, 2, `column ${c} spans the task's two rows`); assert.equal(en[c], null); }
  assert.deepEqual([two[2].text, two[2].size], ['English two', undefined]);
  assert.equal(same[2].text, 'Same', 'a translation equal to the English prints once');
  // Heights: Arabic row 0.37, English row 0.33.
  assert.deepEqual(t.rowH.slice(1, 3), [0.37, 0.33]);
  // Group labels: Arabic part (bottom-aligned, no bottom border) + English part (8pt, LTR,
  // top-aligned, no top border); the two parts cover the block exactly.
  assert.deepEqual([ar[0].text, ar[0].valign, ar[0].border, ar[0].bold], ['المسار أ', 'bottom', { bottom: null }, true]);
  const enTrack = rows.map((r) => r[0]).find((c) => c && c.text === 'Track A');
  assert.deepEqual([enTrack.size, enTrack.rtl, enTrack.valign, enTrack.border, enTrack.color], [TR.enSize, false, 'top', { top: null }, TR.enTrackInk]);
  assert.equal(ar[0].rowSpan + enTrack.rowSpan, 4);
  const enMs = rows.map((r) => r[1]).find((c) => c && c.text === 'Stage 1');
  assert.equal(enMs.color, TR.enMsInk);
});

test("'both': a one-task block with a translated label gets two rows, every task cell spanning", () => {
  const tasks = [
    task({ track: 'Solo', trackAr: 'مسار منفرد', milestone: 'Only', milestoneAr: 'وحيدة', task: 'English only' }),
    task({ track: 'Next', trackAr: '', milestone: 'M', task: 'Plain' }),
  ];
  const t = tableOf(slidesOf(tasks, 'both')[0]);
  const rows = grid(t);
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0][0].text, rows[0][0].rowSpan, rows[1][0].text, rows[1][0].rowSpan], ['مسار منفرد', 1, 'Solo', 1]);
  assert.deepEqual([rows[0][1].text, rows[1][1].text], ['وحيدة', 'Only']);
  for (let c = 2; c < 8; c++) assert.equal(rows[0][c].rowSpan, 2, `column ${c} spans both rows`);
  assert.equal(rows[0][2].text, 'English only');
  assert.deepEqual(rows[2].map((c) => c && c.text).slice(0, 3), ['Next', 'M', 'Plain']);
  // The separator above the new track runs across every cell starting on that row.
  assert.ok(rows[2].every((c) => c.border && c.border.top && c.border.top.pt === 1.25));
});

test("'both': the bilingual label's boundary sits near the block's middle", () => {
  const tasks = Array.from({ length: 6 }, (_, i) => task({ track: 'T', trackAr: 'مسار', milestone: `M${i}`, task: `Task ${i}` }));
  const t = tableOf(slidesOf(tasks, 'both')[0]);
  const rows = grid(t);
  const j = rows.findIndex((r) => r[0] && r[0].text === 'T');
  assert.equal(rows[0][0].rowSpan, j);
  assert.equal(j, 3, '6 equal rows: 3 above the boundary, 3 below');
});

// ---- geometry ----------------------------------------------------------------------------

const LONG_EN = 'Prepare, review and sign off the integration evidence pack together with the partner, including the rollback plan and every open question';
const SCENARIOS = {
  realistic: (i) => task({ track: `Track ${Math.floor(i / 8)}`, trackAr: `المسار ${Math.floor(i / 8)}`, milestone: `Stage ${Math.floor(i / 3)}`, milestoneAr: `المرحلة ${Math.floor(i / 3)}`, task: `Coordinate synthetic deliverable ${i}`, taskAr: arText(i, 6 + (i % 7)) }),
  longAr: (i) => task({ track: `Track ${Math.floor(i / 5)}`, trackAr: 'مسار تجريبي طويل للاختبار والتحقق من الالتفاف', milestone: `M${i}`, milestoneAr: 'مرحلة الجاهزية التشغيلية والانتقال', task: LONG_EN, taskAr: arText(i, 25 + (i % 40)), owner: i % 3 ? 'Owner A / Owner B / Owner C / Owner D' : 'Owner A' }),
  hugeAr: () => task({ track: 'T', trackAr: arText(3, 30), milestone: 'M', milestoneAr: arText(5, 30), task: `${LONG_EN} ${LONG_EN} ${LONG_EN}`, taskAr: arText(1, 120) }),
  unbroken: (i) => task({ taskAr: 'س'.repeat(30 + i * 5), trackAr: 'ش'.repeat(20), task: 'X'.repeat(40 + i) }),
  groups: (i) => task({ track: `Rollout Onboarding Programme ${i}`, trackAr: `برنامج تجريبي رقم ${i}`, milestone: `Readiness Phase ${i}`, milestoneAr: `مرحلة الجاهزية ${i}`, task: i % 2 ? 'Short' : 'Coordinate requirements', taskAr: i % 3 ? arText(i, 4) : '' }),
  partial: (i) => task({ track: `Track ${Math.floor(i / 4)}`, trackAr: i % 9 === 0 ? '' : `مسار ${Math.floor(i / 4)}`, milestone: i % 4 ? 'M' : '', milestoneAr: i % 2 ? 'مرحلة' : '', task: i % 6 === 0 ? LONG_EN : `Task ${i}`, taskAr: i % 3 ? arText(i, 3 + (i % 11)) : '' }),
};

test('no content below 6.95 for 0..60 tasks — ar and both, every scenario, every cell fits', () => {
  let checked = 0;
  for (const lang of ['ar', 'both']) {
    for (const [name, make] of Object.entries(SCENARIOS)) {
      for (let n = 0; n <= 60; n++) {
        const tasks = Array.from({ length: n }, (_, i) => make(i));
        const slides = slidesOf(tasks, lang);
        if (!n) { assert.deepEqual(slides, []); continue; }
        assertGeometry(slides, `${lang}/${name}/${n}`, lang);
        // Every task printed exactly once, in order (its due cell is the task's anchor).
        const dues = slides.flatMap((s) => grid(tableOf(s)).filter((r) => r[7]).map((r) => r[7].text));
        assert.equal(dues.length, n, `${lang}/${name}/${n}: one task per tracker row`);
        checked += slides.length;
      }
    }
  }
  assert.ok(checked > 800, `too few slides checked (${checked})`);
});

// ---- shaped Arabic estimate --------------------------------------------------------------

test('shaped Arabic widths match Cairo as CoreText sets it (×1.03 safety on top)', () => {
  // CoreText on the Cairo variable font (2026-10-13), 1/1000 em at the given weight.
  const MEASURED = [
    ['مكتمل', true, 3206.88], ['متوقف', true, 3402.67], ['لا', false, 644], ['سسس', false, 2934],
    ['فريق', false, 2149], ['abc', false, 1465], ['الجاهزية', true, 3805],
  ];
  for (const [s, bold, real] of MEASURED) {
    const est = (shapedTextWidth(s, 72, bold) / 1.03) * 1000;
    assert.ok(est >= real * 0.999, `${s}: ${est} under the measured ${real}`);
    assert.ok(est <= real * 1.02, `${s}: ${est} far over the measured ${real}`);
  }
  // Presentation forms fold to their letters; marks are zero-width.
  assert.equal(shapedTextWidth('ﻻ'), shapedTextWidth('لا'));
  assert.equal(shapedTextWidth('مُسْتَشْفَى'), shapedTextWidth('مستشفى'));
  // ASCII is the legacy table exactly, so Latin inside a translation measures the same.
  assert.equal(shapedTextWidth('MISBAR 360'), textWidth('MISBAR 360'));
  // fitCell's shaped mode wraps by it: a medial seen is 860/1000 em, not the legacy 600, so
  // 100 of them need 3 lines of the task column, not 2.
  assert.equal(fitCell('س'.repeat(100), TR.colW[2]).lines, 2);
  assert.equal(fitCell('س'.repeat(100), TR.colW[2], { shaped: true }).lines, 3);
});

// ---- QuickLook bidi embedding ------------------------------------------------------------

test('a translation with Latin / digits / brackets is wrapped in RLE … PDF; pure Arabic and English are not', () => {
  const tasks = [
    task({ track: 'Track A', trackAr: 'مسار (QA)', milestone: 'Stage 1', milestoneAr: 'المرحلة ٢', task: 'Hold the ABC meeting', taskAr: 'عقد اجتماع مع ABC وXYZ' }),
    task({ track: 'Track A', trackAr: 'مسار (QA)', milestone: 'Stage 1', milestoneAr: 'المرحلة ٢', task: 'Plain English', taskAr: 'مهمة عربية خالصة' }),
    task({ track: 'Track A', trackAr: 'مسار (QA)', milestone: 'Stage 1', milestoneAr: 'المرحلة ٢', task: 'Latin only', taskAr: 'MVP' }),
    task({ track: 'Track A', trackAr: 'مسار (QA)', milestone: 'Stage 1', milestoneAr: 'المرحلة ٢', task: 'Fallback (no translation)', taskAr: '' }),
  ];
  for (const lang of ['ar', 'both']) {
    const rows = grid(tableOf(slidesOf(tasks, lang)[0]));
    const taskCells = rows.map((r) => r[2]).filter(Boolean);
    const byText = (t) => taskCells.find((c) => bare(c.text) === t);
    assert.equal(byText('عقد اجتماع مع ABC وXYZ').text, `${RLE}عقد اجتماع مع ABC وXYZ${PDF}`, `${lang}: mixed task wrapped`);
    assert.equal(byText('عقد اجتماع مع ABC وXYZ').rtl, true);
    assert.equal(byText('مهمة عربية خالصة').text, 'مهمة عربية خالصة', `${lang}: pure Arabic untouched`);
    assert.equal(byText('MVP').text, 'MVP', `${lang}: a Latin-only "translation" is not embedded`);
    assert.equal(byText('Fallback (no translation)').text, 'Fallback (no translation)', `${lang}: fallback untouched`);
    if (lang === 'both') assert.equal(byText('Hold the ABC meeting').text, 'Hold the ABC meeting', 'English original untouched');
    assert.equal(rows[0][0].text, `${RLE}مسار (QA)${PDF}`, `${lang}: track label wrapped`);
    assert.equal(rows[0][1].text, 'المرحلة ٢', `${lang}: Arabic-Indic digits are Arabic script`);
  }
  // A cut translation ends in «…» (not Arabic script) → wrapped; the controls cost no width,
  // so the line count is that of the bare text.
  const [s] = slidesOf([task({ taskAr: arText(2, 200) })], 'ar');
  const cut = grid(tableOf(s))[0][2].text;
  assert.ok(cut.startsWith(RLE) && cut.endsWith(`…${PDF}`), 'cut translation wrapped');
  assert.equal(shapedTextWidth(`${RLE}مهمة${PDF}`), shapedTextWidth('مهمة'));
  assert.equal(tableOf(s).rowH[1], 1.09, 'a 4-line row');
  assert.equal(fitCell(bare(cut), TR.colW[2], { shaped: true, maxLines: 99 }).lines, 4, 'cut to MAX_BODY_LINES');
  // 'en' prints the English only — no control character anywhere in its spec.
  const en = JSON.stringify(slidesOf(tasks, 'en'));
  assert.ok(!/[\u202A-\u202E]/.test(en));
});

// ---- pagination polish (translated decks only) --------------------------------------------

/** Tasks per slide (a task's due cell is its anchor) and the per-slide task blocks. */
const perSlide = (slides) => slides.map((s) => grid(tableOf(s)).filter((r) => r[7]).length);

test("'both': a long single-track tail is shared by the last two slides (no one-task slide)", () => {
  for (let n = 20; n <= 60; n++) {
    const tasks = Array.from({ length: n }, (_, i) => task({ track: i < 12 ? `Track ${Math.floor(i / 4)}` : 'Long', trackAr: i < 12 ? `مسار ${Math.floor(i / 4)}` : 'مسار طويل',
      milestone: i < 12 ? `M${Math.floor(i / 2)}` : 'Shared', milestoneAr: 'مرحلة', task: `Coordinate synthetic deliverable ${i}`, taskAr: arText(i, 6 + (i % 5)) }));
    const slides = slidesOf(tasks, 'both');
    const counts = perSlide(slides);
    assert.equal(sum(counts), n);
    if (counts.length > 1) {
      const [a, b] = counts.slice(-2);
      assert.ok(Math.abs(a - b) <= 2, `${n} tasks: last two slides ${a} / ${b}`);
    }
    assertGeometry(slides, `tail/${n}`, 'both');
  }
});

// One track (every split of the same slide count breaks it equally often, so the orphan
// rule — ranked after «keep tracks whole» — is free to act), one-line rows of 0.37: the first
// slide holds 14, the last 15. Milestones: one row, then pairs (blocks open on odd rows), so
// the greedy fill ends slide 1 on row 13 — the first row of a pair whose second row opens
// slide 2. 13 + 15 is the orphan-free split of the same two slides.
test('translated: a block is not opened by its lone row at a page bottom when it continues', () => {
  const ms = (i) => (i === 0 ? 0 : Math.ceil(i / 2));
  const tasks = Array.from({ length: 28 }, (_, i) => task({ track: 'One', trackAr: 'مسار واحد',
    milestone: `M${ms(i)}`, milestoneAr: `مرحلة ${ms(i)}`, task: `Synthetic ${i}`, taskAr: `مهمة ${i}` }));
  const plain = tasks.map(({ taskAr, trackAr, milestoneAr, ...t }) => t);
  assert.deepEqual(perSlide(slidesOf(plain, 'en')), [14, 14], 'the greedy fill: row 13 alone at the bottom');
  const slides = slidesOf(tasks, 'ar');
  assert.deepEqual(perSlide(slides), [13, 15]);
  assertGeometry(slides, 'orphan', 'ar');
});

test('the polish never costs a slide and never touches an untranslated tracker', () => {
  for (let n = 1; n <= 60; n++) {
    const base = Array.from({ length: n }, (_, i) => task({ track: `Track ${Math.floor(i / 9)}`, milestone: `M${Math.floor(i / 3)}`, task: `Synthetic deliverable ${i} ${'with more words '.repeat(i % 4)}` }));
    // One-word translations (one line, like the English) — the polished deck has the plain
    // deck's page count exactly.
    const tr = base.map((t, i) => ({ ...t, taskAr: `مهمة ${i}` }));
    assert.ok(slidesOf(tr, 'ar').length <= slidesOf(base, 'ar').length, `${n}: polish added a slide`);
    assert.equal(JSON.stringify(slidesOf(base, 'both')), JSON.stringify(slidesOf(base, 'en')));
  }
});

// ---- decks + renderers -------------------------------------------------------------------

const translatedFixture = () => {
  const m = structuredClone(MOCK_REPORT_MODEL);
  m.projectTracker.tasks = m.projectTracker.tasks.map((t, i) => ({ ...t, taskAr: arText(i, 4 + (i % 5)), trackAr: `مسار ${i % 3}`, milestoneAr: '' }));
  return m;
};

test('decks read reportOptions.trackerLang (default ar); en = the English deck', () => {
  const m = translatedFixture();
  const taskTexts = (spec) => spec.filter((s) => s.id.startsWith('tracker')).flatMap((s) => grid(tableOf(s)).map((r) => r[2] && r[2].text)).filter(Boolean);
  const plain = { ...m, projectTracker: { ...m.projectTracker, tasks: m.projectTracker.tasks.map(({ taskAr, trackAr, milestoneAr, ...rest }) => rest) } };
  const enSpec = buildSpec({ ...m, reportOptions: { ...(m.reportOptions || {}), trackerLang: 'en' } });
  assert.deepEqual(enSpec, buildSpec(plain), "single-hospital 'en' = the untranslated deck");
  assert.ok(taskTexts(buildSpec(m)).every((t) => ARABIC.test(t)), 'default: Arabic tasks');
  const both = buildSpec({ ...m, reportOptions: { ...(m.reportOptions || {}), trackerLang: 'both' } });
  const bt = taskTexts(both);
  assert.ok(bt.some((t) => ARABIC.test(t)) && bt.some((t) => !ARABIC.test(t)), 'both: Arabic and English task cells');
  const bm = { hospital: 'both', reportDate: DATE, reportOptions: { trackerLang: 'ar' }, projectTracker: m.projectTracker };
  const mainAr = buildBothSpec({ ...structuredClone(MOCK_REPORT_MODEL), ...bm });
  assert.ok(taskTexts(mainAr).every((t) => ARABIC.test(t)), 'main deck: Arabic tasks');
});

test("both renderers accept 'ar' and 'both' slides; the English row lands in the task column", async () => {
  const { PptxGenJS, JSZip } = loadPptxGen();
  installDom();
  const { renderPptx } = await import('../src/render/pptx-renderer.js');
  const { renderSlides } = await import('../src/render/html-renderer.js');
  for (const lang of ['ar', 'both']) {
    const spec = slidesOf(Array.from({ length: 30 }, (_, i) => SCENARIOS.partial(i)), lang);
    const blob = await renderPptx(spec, { PptxGenJS, JSZip });
    const { names, read } = await unzipPptx(blob);
    assert.equal(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, spec.length);
    const xml = await read('ppt/slides/slide1.xml');
    const trs = [...xml.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map((m) => [...m[1].matchAll(/<a:tc\b([^>]*)>([\s\S]*?)<\/a:tc>/g)]);
    assert.equal(trs.length, tableOf(spec[0]).rows.length, 'one <a:tr> per spec row');
    assert.ok(trs.every((tr) => tr.length === 8), 'every row has its 8 grid cells (covered ones as merges)');
    if (lang === 'both') {
      // The row after a translated task: visual columns 0..4 are vertical merges, column 5
      // (المهمة) carries the English text.
      const k = trs.findIndex((tr) => /vMerge="1"/.test(tr[0][1]) && /<a:t>[A-Za-z]/.test(tr[5][2]));
      assert.ok(k > 0, 'an English task row with merged neighbours');
      assert.ok([0, 1, 2, 3, 4].every((c) => /vMerge="1"/.test(trs[k][c][1])));
    }
    assert.ok(renderSlides(spec, { variant: 'nupco' }), 'html renderer returns a tree');
  }
});
