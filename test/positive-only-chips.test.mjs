// test/positive-only-chips.test.mjs — `node --test test/positive-only-chips.test.mjs`
//
// POSITIVE-ONLY CHIPS, and the cover title that goes with them (Talal, round 4,
// 2026-08-06). Two surfaces, ONE rule, pinned together in one file because the bug this
// guards against is the two of them disagreeing in the same run:
//   • the deck        — build-spec's fmtDelta, on the exec KPI cards and the funnel stages
//   • the review page — screen-review's bannerChipVisible, on the 'نشاط الأسبوع' banner
// A chip renders IFF its number is > 0. Zero renders nothing (it always did); a NEGATIVE
// now renders nothing either, where it used to render '−N' with U+2212.
//
// WHY THE NEGATIVE WENT AWAY, since deleting a rendering branch looks like lost
// information. It is not a display decision — it is the arithmetic underneath changing
// meaning. The four QUEUE keys (engine/asof.js QUEUE_KEYS) stopped being a signed net
// change and became SURVIVING ENTRANTS: a COUNT of the rows that entered the state inside
// the window and are still in it at the end (model/delta-window.js, and the cases in
// test/delta-window.test.mjs). A count has no negative to render. The six EVENT keys count
// dated milestones and were never negative in the first place. So a '−N' on a delivered
// slide could now only come from a bug, and printing one would state the opposite of the
// truth beside a big cumulative number that may itself have fallen.
//
// THE INVARIANT this file must never disturb: the big numbers — the KPI card VALUES, the
// funnel stage counts, the monthly and compliance tables — are CUMULATIVE TOTALS and are
// untouched by any of this. Only the small green chips, the ▲ legend line and the cover
// title moved. Nothing below asserts a card value; test/render-preview and the golden
// suites own those.
//
// IMPORT NOTE — screen-review.js is a UI module, and this file imports it STATICALLY.
// That is safe by construction here, not by luck: it touches document/window only inside
// render(), test/module-smoke.test.mjs imports every module under src/ (screen-review
// included — only src/main.js is on its SKIP list) and test/delta-mode-registry.test.mjs
// already static-imports DELTA_MODE_PILLS from this very file. A dynamic import with a
// guard, as module-smoke uses for its parse-only path, would buy nothing and would hide a
// genuine regression: if screen-review ever grows a module-scope DOM dependency, THIS
// import failing loudly is the correct outcome.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSpec, DEFAULT_LABELS } from '../src/slidespec/build-spec.js';
import { bannerChipVisible } from '../src/ui/screen-review.js';
import { QUEUE_KEYS } from '../src/engine/asof.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';

// theme.js's deltaGreen, the ONE colour every chip and the legend are drawn in (user
// decision 2026-07-23 — the old red/green split is gone). Duplicated as a literal on
// purpose: this file's job is partly to notice if the deck's chip colour ever changes, and
// importing the constant it is checking would make that unnoticeable.
const DELTA_GREEN = '#2E7D32';
const MINUS = '−'; // U+2212 MINUS SIGN — what fmtDelta used to emit for a drop
const LEGEND_MARK = '▲';

/** The exec funnel slide (KPI cards + journey), where every chip on the deck lives. */
function execFunnel(model, variant = 'internal') {
  const slide = buildSpec(model, { variant }).find((s) => s.id === 'execFunnel');
  assert.ok(slide, 'the exec funnel slide is missing from the spec');
  return slide;
}

/** Every text run on a slide, chips and chrome alike. */
const textsOf = (slide) => slide.elements.filter((e) => e.t === 'text').map((e) => String(e.text ?? ''));

/**
 * The green delta chips on a slide, in emission order. The ▲ legend is drawn in the same
 * colour and is excluded by its marker — it is a caption ABOUT the chips, not a chip.
 */
const chipsOf = (slide) => slide.elements
  .filter((e) => e.t === 'text' && e.color === DELTA_GREEN && !String(e.text ?? '').startsWith(LEGEND_MARK))
  .map((e) => String(e.text));

/** The ▲ legend line, or null when no chip was visible this run. */
function legendOf(slide) {
  const found = textsOf(slide).filter((t) => t.startsWith(LEGEND_MARK));
  assert.ok(found.length <= 1, 'at most one delta legend line may ever be emitted');
  return found[0] ?? null;
}

// A fresh model per case, built by SHALLOW SPREAD rather than mutation: MOCK_REPORT_MODEL
// is shared with delta-mode-registry, module-smoke and the render preview, and a case that
// wrote through to its kpi.deltas would corrupt every one of them in file order.
const ALL_DELTA_KEYS = Object.keys(MOCK_REPORT_MODEL.kpi.deltas);
const ZERO_DELTAS = Object.fromEntries(ALL_DELTA_KEYS.map((k) => [k, 0]));
const withDeltas = (over, base = MOCK_REPORT_MODEL.kpi.deltas) => ({
  ...MOCK_REPORT_MODEL,
  kpi: { ...MOCK_REPORT_MODEL.kpi, deltas: { ...base, ...over } },
});

// The fixture's ONE non-zero delta. Every "the negative produced nothing" claim below is
// read as "the chip list is exactly this and nothing else", so if it ever changes the
// cases stop meaning what they say — pinned here, once.
const FIXTURE_CHIP = '+47';

test('the fixture still has exactly one positive chip, so the cases below can subtract it', () => {
  assert.equal(MOCK_REPORT_MODEL.kpi.deltas.completed, 47);
  assert.deepEqual(chipsOf(execFunnel(MOCK_REPORT_MODEL)), [FIXTURE_CHIP]);
  // completed is a KPI card key, so its chip is drawn once on the card and NOT repeated on
  // the funnel's last stage (KPI_DELTA_KEYS de-duplication) — hence one entry, not two.
});

// ---- the three signs -------------------------------------------------------------

test('a NEGATIVE queue delta renders NOTHING — no chip, and no U+2212 anywhere on the slide', () => {
  // awaitingResults is a KPI card (فحوصات تحت الإجراء) and a queue key, i.e. exactly the
  // metric that used to go negative when the pile drained. Under surviving-entrants
  // semantics −5 is unreachable from the engine at all; the point of forcing it here is
  // that even a corrupt or stale model cannot put a minus sign on a delivered slide.
  const slide = execFunnel(withDeltas({ awaitingResults: -5 }));
  assert.deepEqual(chipsOf(slide), [FIXTURE_CHIP], 'the −5 produced no chip of its own');
  for (const t of textsOf(slide)) {
    assert.ok(!t.includes(MINUS), `U+2212 reached a delivered slide: ${JSON.stringify(t)}`);
    assert.ok(!t.includes('-5') && !t.includes('−5'), `a negative leaked as text: ${JSON.stringify(t)}`);
  }
});

test('a ZERO delta renders nothing either — unchanged behaviour, restated', () => {
  assert.deepEqual(chipsOf(execFunnel(withDeltas({ awaitingResults: 0 }))), [FIXTURE_CHIP]);
  // Zero and negative are INDISTINGUISHABLE on the deck now, which is the whole rule:
  // both mean "nothing arrived here worth a chip this window".
  assert.deepEqual(
    chipsOf(execFunnel(withDeltas({ awaitingResults: 0 }))),
    chipsOf(execFunnel(withDeltas({ awaitingResults: -5 }))),
  );
});

test('a POSITIVE delta renders \'+N\' — the rule is positive-ONLY, not chips-off', () => {
  const slide = execFunnel(withDeltas({ awaitingResults: 5 }));
  const chips = chipsOf(slide);
  assert.ok(chips.includes('+5'), `expected a '+5' chip, got ${JSON.stringify(chips)}`);
  assert.ok(chips.includes(FIXTURE_CHIP), 'and the fixture\'s own chip is still there');
  // The '+' is always present — never a bare '5' — so a chip can never be misread as the
  // cumulative value it sits beside.
  for (const c of chips) assert.match(c, /^\+\d+$/, `chip ${JSON.stringify(c)} must be '+N'`);
});

test('all four QUEUE keys obey the rule on their own KPI cards', () => {
  // Each of the four is its own card def in build-spec's cardDefs, so a per-card
  // regression (a stray fmtDelta call, an override branch) would not be caught by testing
  // just one of them. Driven off the IMPORTED QUEUE_KEYS so the loop cannot fall out of
  // step with asof.js's own membership list.
  for (const key of QUEUE_KEYS) {
    const neg = chipsOf(execFunnel(withDeltas({ [key]: -5 }, ZERO_DELTAS)));
    assert.deepEqual(neg, [], `${key}: a negative must render no chip at all`);
    const pos = chipsOf(execFunnel(withDeltas({ [key]: 5 }, ZERO_DELTAS)));
    assert.deepEqual(pos, ['+5'], `${key}: a positive must render exactly one '+5'`);
  }
});

test('the FUNNEL STAGE chips obey the same rule — a second, separate render path', () => {
  // Stages 2/3/4 (collected/dispatched/received) draw their own chip beneath the stage
  // count; stages 1 and 5 are suppressed because total/completed already have KPI cards.
  // It is a different call site from the card chip, so it needs its own case.
  for (const key of ['collected', 'dispatched', 'received']) {
    assert.deepEqual(chipsOf(execFunnel(withDeltas({ [key]: -3 }, ZERO_DELTAS))), [],
      `funnel stage ${key}: a negative must render no chip`);
    assert.deepEqual(chipsOf(execFunnel(withDeltas({ [key]: 3 }, ZERO_DELTAS))), ['+3'],
      `funnel stage ${key}: a positive must render '+3'`);
  }
});

// ---- the legend gate -------------------------------------------------------------

test('the ▲ legend renders IFF at least one POSITIVE chip is on the slide', () => {
  // The legend names the activity window the chips were counted over. With no chip it
  // describes nothing, so build-spec gates it on the same fmtDelta the chips route
  // through — which is what keeps "positive-only" from leaving an orphan caption behind.
  const none = execFunnel(withDeltas({}, ZERO_DELTAS));
  assert.deepEqual(chipsOf(none), []);
  assert.equal(legendOf(none), null, 'no chip ⇒ no legend line');

  // A negative is not a chip, so it must not resurrect the legend either.
  const negOnly = execFunnel(withDeltas({ awaitingResults: -5 }, ZERO_DELTAS));
  assert.deepEqual(chipsOf(negOnly), []);
  assert.equal(legendOf(negOnly), null, 'a negative must not bring the legend back');

  // One positive is enough, and the legend reads the stamped window (here the week form,
  // whose dates come from model.deltaWindow — same object the review banner reads).
  const win = { start: '2026-07-05', end: '2026-07-09', mode: 'week' };
  const pos = execFunnel({ ...withDeltas({ awaitingResults: 5 }, ZERO_DELTAS), deltaWindow: win });
  assert.deepEqual(chipsOf(pos), ['+5']);
  assert.equal(
    legendOf(pos),
    DEFAULT_LABELS.execDeltaLegendWeekWindow.replace('{start}', '05 / 07 / 2026').replace('{end}', '09 / 07 / 2026'),
  );
});

// ---- the two surfaces agree ------------------------------------------------------

test('bannerChipVisible: the review banner is positive-only too', () => {
  assert.equal(bannerChipVisible(1), true);
  assert.equal(bannerChipVisible(47), true);
  assert.equal(bannerChipVisible(0), false);
  assert.equal(bannerChipVisible(-1), false);
  assert.equal(bannerChipVisible(-5), false);
  assert.equal(bannerChipVisible(NaN), false);
  // Number.isFinite is the guard, so the non-numeric shapes a half-populated model can
  // carry are all rejected rather than coerced into a chip.
  for (const bad of [Infinity, -Infinity, undefined, null, '', '5', {}, []]) {
    assert.equal(bannerChipVisible(bad), false, `bannerChipVisible(${JSON.stringify(bad)}) must be false`);
  }
});

test('CROSS-SURFACE: the banner shows a chip for exactly the values the deck does', () => {
  // THE bug this file exists to prevent: the operator approves a review screen reading
  // '−12 بانتظار النتائج' and hands over a deck that says nothing there, or the reverse.
  // One predicate per surface, checked against each other across the sign boundary rather
  // than each against its own hardcoded table.
  for (const n of [-47, -5, -1, 0, 1, 5, 47]) {
    const onDeck = chipsOf(execFunnel(withDeltas({ awaitingResults: n }, ZERO_DELTAS))).length > 0;
    assert.equal(onDeck, bannerChipVisible(n),
      `delta ${n}: deck ${onDeck ? 'shows' : 'hides'} but banner ${bannerChipVisible(n) ? 'shows' : 'hides'}`);
  }
  // …and across the TYPE boundary too. Both surfaces receive the RAW stored value
  // (the banner call site deliberately does not Number()-coerce), so a corrupt
  // string '5' must be rejected by Number.isFinite on BOTH — a chip on one surface
  // only is exactly the disagreement this test exists to prevent.
  for (const bad of ['5', '+5', ' 5 ']) {
    const onDeck = chipsOf(execFunnel(withDeltas({ awaitingResults: bad }, ZERO_DELTAS))).length > 0;
    assert.equal(onDeck, false, `string delta ${JSON.stringify(bad)} must not chip the deck`);
    assert.equal(bannerChipVisible(bad), false, `string delta ${JSON.stringify(bad)} must not chip the banner`);
  }
});

// ---- the cover title -------------------------------------------------------------

test('the cover title is the WEEKLY one, on BOTH variants', () => {
  // The deck has always been generated weekly; the title said 'اليومي' (daily) because the
  // first build shipped a daily report and nobody revisited the string. It is one label
  // key, so both variants read the same default — pinned on each anyway, since the variant
  // is what branches the tasks slide and a future cover branch would be silent otherwise.
  assert.equal(DEFAULT_LABELS.coverTitle, 'تقرير مسبار الأسبوعي');
  for (const variant of ['nupco', 'internal']) {
    const cover = buildSpec(MOCK_REPORT_MODEL, { variant }).find((s) => s.id === 'cover');
    assert.ok(cover, `${variant}: the cover slide is missing`);
    const texts = textsOf(cover);
    assert.ok(texts.includes('تقرير مسبار الأسبوعي'), `${variant}: the weekly title must be on the cover`);
    assert.ok(!texts.includes('تقرير مسبار اليومي'), `${variant}: the retired daily title must be gone`);
  }
});

test('a labels.coverTitle OVERRIDE still wins — the default moved, the override did not die', () => {
  // coverTitle is a registry key, so an operator who has already saved a title of their own
  // must keep it. labelOf's precedence (reportOptions.labels[key] ?? DEFAULT_LABELS[key])
  // is what guarantees that, and changing a default is exactly the change that tends to
  // get made by hardcoding the new string at the call site instead.
  const CUSTOM = 'تقرير مسبار — نسخة خاصة';
  const overridden = { ...MOCK_REPORT_MODEL, reportOptions: { labels: { coverTitle: CUSTOM } } };
  for (const variant of ['nupco', 'internal']) {
    const texts = textsOf(buildSpec(overridden, { variant }).find((s) => s.id === 'cover'));
    assert.ok(texts.includes(CUSTOM), `${variant}: the override must reach the slide`);
    assert.ok(!texts.includes(DEFAULT_LABELS.coverTitle), `${variant}: the default must not also appear`);
  }
  // …and the override is scoped to the model that carries it: the shared fixture, rendered
  // straight after, is unaffected.
  assert.ok(textsOf(buildSpec(MOCK_REPORT_MODEL, { variant: 'internal' }).find((s) => s.id === 'cover'))
    .includes(DEFAULT_LABELS.coverTitle));
});
