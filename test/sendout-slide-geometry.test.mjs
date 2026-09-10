// test/sendout-slide-geometry.test.mjs — `node --test test/sendout-slide-geometry.test.mjs`
//
// THE COUNTRY-BAR LADDER on the 'أين تُجرى الفحوصات' slide, and the minimum width of
// a bar. Both are here because both failed in a DELIVERED report (2026-09-10) while
// every analysis test in test/sendout.test.mjs stayed green: the numbers were right
// and the drawing was wrong, and nothing looked at the drawing.
//
// What went wrong, so a future reader knows what these numbers protect:
//   • THE LADDER. Rows were laid out at a fixed pitch (row0 + i × 0.694) sized for the
//     reference deck's four countries. A FIFTH country ran 6.637 → 7.026 — straight
//     through the colour footnote parked at 6.75 — and a sixth would have dropped off
//     the 7.5in slide with no warning at all. The report gained its fifth country the
//     day a previously unmapped lab was bridged, so the rows must now fit any count.
//   • THE BAR. One order out of ~1,500 is 0.005in of a 6.804in track. The old floor of
//     0.01in was half a screen pixel, and the pill's own 0.031in corner radius rounded
//     even that away: the row drew a label, a share, a percentage — and an empty track.
//     The floor is now 2 × that radius, the narrowest a rounded bar can still read as
//     a bar. It is a VISIBILITY floor, not a value; the exact figures are printed in
//     the same row and are what the reader is meant to take the number from.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSpec } from '../src/slidespec/build-spec.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';

// Geometry the slide is built against. Literals on purpose: a test that imported the
// constants it is checking would move with them and pin nothing.
const FOOTNOTE_Y = 6.75;   // the colour note under the bars
const SLIDE_H = 7.5;
const ROW0 = 3.861;        // first row, reference deck
const REF_STEP = 0.694;    // reference pitch, must survive for ≤ 4 countries
const TRACK_W = 6.804;
const BAR_RADIUS = 0.031;
const NAME_X = 9.722;      // the country-name column — one text per row
const TRACK_X = 2.778;

/** A model carrying n countries, biggest first, with one deliberate 1-order tail. */
function modelWith(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  return {
    ...MOCK_REPORT_MODEL,
    sendout: {
      total,
      local: counts[0] || 0,
      international: total - (counts[0] || 0),
      byCountry: counts.map((orders, i) => ({ country: ['Germany', 'Saudi Arabia', 'Bahrain', 'USA', 'South Korea', 'Jordan', 'Romania', 'Finland'][i], orders })),
      byLab: counts.map((orders, i) => ({ lab: `Lab ${i}`, country: ['Germany', 'Saudi Arabia', 'Bahrain', 'USA', 'South Korea', 'Jordan', 'Romania', 'Finland'][i], reflab: 'Ref', orders })),
      inferred: [], unmapped: [], unresolved: [],
    },
  };
}

const countriesSlide = (model) => {
  const s = buildSpec(model, { variant: 'internal' }).find((x) => x.id === 'sendoutCountries');
  assert.ok(s, 'the by-country slide must be built when the model carries send-out totals');
  return s;
};
/** One text per row, in row order — the country-name column is the row's anchor. */
const rowsOf = (slide) => slide.elements
  .filter((e) => e.t === 'text' && e.x === NAME_X)
  .sort((a, b) => a.y - b.y);
/** The coloured fill of each bar: a rect on the track, narrower than the track. */
const barsOf = (slide) => slide.elements
  .filter((e) => e.t === 'rect' && e.y >= ROW0 && e.w < TRACK_W && e.x >= TRACK_X)
  .sort((a, b) => a.y - b.y);

test('≤ 4 countries keep the reference deck ladder, pixel for pixel', () => {
  // The canonical case must not move: this slide was signed off at this spacing, and
  // the adaptive path exists only for counts the reference never had.
  for (let n = 1; n <= 4; n++) {
    const rows = rowsOf(countriesSlide(modelWith(Array.from({ length: n }, (_, i) => 100 - i))));
    assert.equal(rows.length, n, `${n} countries must draw ${n} rows`);
    rows.forEach((r, i) => {
      assert.equal(Number((r.y - (ROW0 + i * REF_STEP)).toFixed(6)), 0, `row ${i} of ${n} moved off the reference ladder`);
      assert.equal(r.size, 12, 'reference rows keep 12pt names');
    });
  }
});

test('rows always finish ABOVE the footnote and never overlap — 1 to 8 countries', () => {
  // The delivered bug: the fifth row printed through the footnote. The eighth is the
  // most the supplier catalogue can currently produce, so the whole range is swept.
  for (let n = 1; n <= 8; n++) {
    const rows = rowsOf(countriesSlide(modelWith(Array.from({ length: n }, (_, i) => 100 - i))));
    assert.equal(rows.length, n);
    const last = rows[rows.length - 1];
    assert.ok(last.y + last.h <= FOOTNOTE_Y,
      `${n} countries: last row ends at ${(last.y + last.h).toFixed(3)}, into the footnote at ${FOOTNOTE_Y}`);
    assert.ok(last.y + last.h <= SLIDE_H, `${n} countries: last row falls off the slide`);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i].y >= rows[i - 1].y + rows[i - 1].h - 1e-9,
        `${n} countries: rows ${i - 1} and ${i} overlap`);
    }
    // Type must shrink WITH the row, never outgrow it: the preview clips text boxes.
    for (const r of rows) {
      assert.ok(r.size * 0.0258 <= r.h + 1e-9,
        `${n} countries: ${r.size}pt name cannot fit a ${r.h.toFixed(3)}in row`);
    }
  }
});

test('a single order out of thousands still draws a VISIBLE bar', () => {
  // 1 / 1469 — the live shape of the bug — computes 0.005in, which rendered as an
  // empty track. Anything at or below the corner radius is invisible once rounded.
  const slide = countriesSlide(modelWith([649, 399, 374, 46, 1]));
  const bars = barsOf(slide);
  assert.equal(bars.length, 5, 'every country must draw a bar, including the smallest');
  const smallest = bars[bars.length - 1];
  assert.ok(smallest.w >= BAR_RADIUS * 2,
    `the 1-order bar is ${smallest.w.toFixed(4)}in — at or under the ${BAR_RADIUS}in radius it renders as nothing`);
  // …and it is still anchored to the track's right edge like every other bar (RTL).
  const right = TRACK_X + TRACK_W;
  assert.ok(Math.abs((smallest.x + smallest.w) - right) < 1e-6,
    'bars grow leftwards from the track edge; the floor must not detach the smallest one');
  // The floor is a FLOOR: a bar with real width is never widened to it.
  assert.ok(bars[0].w > 1, 'the largest bar must still be drawn to scale');
});
