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
// ROUND 5 (2026-08-11) MOVED THE FUNNEL CHIP TWICE OVER, and both moves are pinned below.
//   • COVERAGE — all FIVE stages chip now. Stages 1 and 5 (إنشاء طلب / إصدار نتيجة) used
//     to stay blank because they map to the 'total' and 'completed' KPI cards, which chip
//     already; the user asked for those two bars specifically, so the de-duplication set
//     (build-spec's former KPI_DELTA_KEYS) is gone. The cards KEEP their chips, so a
//     total/completed rise now prints the same '+N' TWICE on one slide — an accepted cost,
//     not a regression, and several counts below exist only to say so out loud.
//   • POSITION — the chip left the stack under the count and moved INLINE beside it
//     (x 9.42, y rowY+0.015, 9pt), a small raised '+N' at the count's side. That is a
//     geometry change a screenshot would catch and a text-only assertion would not, hence
//     the explicit position case.
// The sign rule is UNCHANGED by either: fmtDelta is still the single gate, and an
// overridden stage/card value still suppresses its chip.
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

// The funnel chip's geometry (round 5), literals for the same reason DELTA_GREEN is one: a
// position pin that imported the position it pins would pin nothing. COUNT_* describe the
// count column, which round 5 did NOT touch — they are the fixed thing the chip is measured
// against, and the pair is what tells "inline beside" apart from the old "stacked beneath".
const FUNNEL_CHIP_X = 9.42;   // just outside the count column, on the count's own line
const FUNNEL_CHIP_SIZE = 9;   // 64.3% of the 14pt count it annotates
const COUNT_X = 8.629, COUNT_SIZE = 14;

/** The exec funnel slide (KPI cards + journey), where every chip on the deck lives. */
function execFunnel(model, variant = 'internal') {
  const slide = buildSpec(model, { variant }).find((s) => s.id === 'execFunnel');
  assert.ok(slide, 'the exec funnel slide is missing from the spec');
  return slide;
}

/** Every text run on a slide, chips and chrome alike. */
const textsOf = (slide) => slide.elements.filter((e) => e.t === 'text').map((e) => String(e.text ?? ''));

/**
 * The green delta chip ELEMENTS on a slide, in emission order — boxes and all, because the
 * position cases need more than the strings. The ▲ legend is drawn in the same colour and is
 * excluded by its marker — it is a caption ABOUT the chips, not a chip.
 */
const chipElsOf = (slide) => slide.elements
  .filter((e) => e.t === 'text' && e.color === DELTA_GREEN && !String(e.text ?? '').startsWith(LEGEND_MARK));

/** Their texts, same order: cards first (they are emitted first), then the funnel rows. */
const chipsOf = (slide) => chipElsOf(slide).map((e) => String(e.text));

/**
 * The FUNNEL chips only, told apart from the cards' by x. Not circular: the KPI chip sits
 * 0.06in inside its own card's left edge (build-spec KPI_REF_X 0.000…11.179 ⇒ 0.06…11.239),
 * so 9.42 belongs to no card at any card count, and the value itself is pinned against the
 * count column — not against itself — by the single-chip position case below.
 */
const funnelChipsOf = (slide) => chipElsOf(slide).filter((e) => e.x === FUNNEL_CHIP_X);

/** The five stage COUNT elements in stage order — the only 14pt text in the count column. */
function countElsOf(slide) {
  const els = slide.elements.filter((e) => e.t === 'text' && e.size === COUNT_SIZE && e.x === COUNT_X);
  assert.equal(els.length, 5, 'the funnel must emit exactly five stage counts');
  return els;
}

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

// WHAT THE FIXTURE'S ONE NON-ZERO DELTA (completed: +47) NOW DRAWS. Every "the negative
// produced nothing" claim below is read as "the chip list is exactly this and nothing
// else", so the fixture's own contribution has to be pinned here, once, or those cases stop
// meaning what they say. It is TWO entries since round 5, not one: 'completed' owns both a
// KPI card (فحوصات مكتملة) and funnel stage 5 (إصدار نتيجة), and the stage no longer defers
// to the card. Card chips are emitted before the funnel rows, so the order is card-then-bar.
const FIXTURE_CHIPS = ['+47', '+47'];

test('the fixture draws its one positive delta TWICE — card and bar — so the cases below can subtract both', () => {
  assert.equal(MOCK_REPORT_MODEL.kpi.deltas.completed, 47);
  const slide = execFunnel(MOCK_REPORT_MODEL);
  assert.deepEqual(chipsOf(slide), FIXTURE_CHIPS);
  // …and they are one of each, not two of a kind: exactly one comes from the funnel column.
  assert.equal(funnelChipsOf(slide).length, 1, 'stage 5 draws the funnel half of the pair');
  // THE NUMBERS ARE UNTOUCHED by the duplication — the fixture's 437 still prints once on
  // the card and once as the stage count, which is what the '+47' pair annotates.
  assert.equal(countElsOf(slide).at(-1).text, String(MOCK_REPORT_MODEL.kpi.funnel.completed));
});

// ---- the three signs -------------------------------------------------------------

test('a NEGATIVE queue delta renders NOTHING — no chip, and no U+2212 anywhere on the slide', () => {
  // awaitingResults is a KPI card (فحوصات تحت الإجراء) and a queue key, i.e. exactly the
  // metric that used to go negative when the pile drained. Under surviving-entrants
  // semantics −5 is unreachable from the engine at all; the point of forcing it here is
  // that even a corrupt or stale model cannot put a minus sign on a delivered slide.
  const slide = execFunnel(withDeltas({ awaitingResults: -5 }));
  assert.deepEqual(chipsOf(slide), FIXTURE_CHIPS, 'the −5 produced no chip of its own');
  for (const t of textsOf(slide)) {
    assert.ok(!t.includes(MINUS), `U+2212 reached a delivered slide: ${JSON.stringify(t)}`);
    assert.ok(!t.includes('-5') && !t.includes('−5'), `a negative leaked as text: ${JSON.stringify(t)}`);
  }
});

test('a ZERO delta renders nothing either — unchanged behaviour, restated', () => {
  assert.deepEqual(chipsOf(execFunnel(withDeltas({ awaitingResults: 0 }))), FIXTURE_CHIPS);
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
  // …exactly ONCE: awaitingResults is a card-only key (فحوصات تحت الإجراء maps to no funnel
  // stage), so it cannot pick up a second chip the way completed does. The order is the
  // emission order — the card row left-to-right by index (awaitingResults is card 3,
  // completed card 4), then the funnel rows.
  assert.deepEqual(chips, ['+5', ...FIXTURE_CHIPS], 'one card chip, then the fixture pair');
  assert.equal(funnelChipsOf(slide).length, 1, 'the +5 added no bar chip, only a card one');
  // The '+' is always present — never a bare '5' — so a chip can never be misread as the
  // cumulative value it sits beside.
  for (const c of chips) assert.match(c, /^\+\d+$/, `chip ${JSON.stringify(c)} must be '+N'`);
});

test('all four QUEUE keys obey the rule on their own KPI cards', () => {
  // Each of the four is its own card def in build-spec's cardDefs, so a per-card
  // regression (a stray fmtDelta call, an override branch) would not be caught by testing
  // just one of them. Driven off the IMPORTED QUEUE_KEYS so the loop cannot fall out of
  // step with asof.js's own membership list.
  // THE COUNTS SURVIVED ROUND 5 UNCHANGED, and that is a fact about the two key sets rather
  // than luck: the funnel's five stage keys are total/collected/dispatched/received/
  // completed, and NONE of the four queue keys is among them (a queue key is a DEPTH — how
  // many rows sit in a state — and the journey bars count flow through stages). So widening
  // the funnel to all five bars gave these four nowhere new to draw: one card chip each,
  // exactly as before. The singleton list is the assertion — a stray second '+5' here would
  // mean a queue key had somehow acquired a bar.
  for (const key of QUEUE_KEYS) {
    const neg = chipsOf(execFunnel(withDeltas({ [key]: -5 }, ZERO_DELTAS)));
    assert.deepEqual(neg, [], `${key}: a negative must render no chip at all`);
    const posSlide = execFunnel(withDeltas({ [key]: 5 }, ZERO_DELTAS));
    assert.deepEqual(chipsOf(posSlide), ['+5'], `${key}: a positive must render exactly one '+5'`);
    assert.deepEqual(funnelChipsOf(posSlide), [], `${key}: a queue key has no funnel stage to chip`);
  }
});

test('the FUNNEL STAGE chips obey the same rule — a second, separate render path', () => {
  // Stages 2/3/4 (collected/dispatched/received) map to no KPI card, so the whole slide's
  // chip list IS the funnel's answer for them. It is a different call site from the card
  // chip, so it needs its own case.
  for (const key of ['collected', 'dispatched', 'received']) {
    assert.deepEqual(chipsOf(execFunnel(withDeltas({ [key]: -3 }, ZERO_DELTAS))), [],
      `funnel stage ${key}: a negative must render no chip`);
    assert.deepEqual(chipsOf(execFunnel(withDeltas({ [key]: 3 }, ZERO_DELTAS))), ['+3'],
      `funnel stage ${key}: a positive must render '+3'`);
  }
});

test('STAGE 1 AND STAGE 5 CHIP TOO — the round-5 ask, duplicating their cards on purpose', () => {
  // THE USER ASKED FOR THESE TWO BARS BY NAME (إنشاء طلب and إصدار نتيجة). They are the
  // journey's endpoints and they are also the 'total' and 'completed' KPI cards, which is
  // why they were the two suppressed rows before; a funnel whose first and last bars are
  // the only bare ones reads as broken rather than as de-duplicated. So the same '+N' is
  // now printed twice on this slide BY DESIGN, and this case is what stops a future
  // "obvious" tidy-up from deleting one of the pair again.
  const f = MOCK_REPORT_MODEL.kpi.funnel;
  const ENDPOINTS = [
    ['total', 0, '1. إنشاء طلب', f.created],
    ['completed', 4, '5. إصدار نتيجة', f.completed],
  ];
  for (const [key, stageIdx, stage, count] of ENDPOINTS) {
    const slide = execFunnel(withDeltas({ [key]: 7 }, ZERO_DELTAS));
    assert.deepEqual(chipsOf(slide), ['+7', '+7'], `${key}: card chip AND bar chip, in that order`);
    const funnel = funnelChipsOf(slide);
    assert.equal(funnel.length, 1, `${key}: exactly one of the pair belongs to the funnel`);
    // …and it is on the RIGHT bar. The chip's box top is 0.015in below its own count's while
    // the next row's is a whole 0.650in pitch away, so a 0.10 band names the row with no
    // ambiguity at all — see the position case below for why the band and not the offset.
    const counts = countElsOf(slide);
    assert.ok(Math.abs(funnel[0].y - counts[stageIdx].y) <= 0.10,
      `${key}: the chip must sit on stage ${stageIdx + 1}'s line (${stage}), not another row's`);
    // The stage's own COUNT is untouched by gaining a chip — THE INVARIANT, restated at the
    // one row where this round actually changed anything.
    assert.equal(counts[stageIdx].text, String(count), `${key}: the stage count must not move`);
    assert.equal(textsOf(slide).filter((t) => t === stage).length, 1, `${key}: one ${stage} label`);
  }
  // The negative rule reaches the two new rows as well — a suppressed stage that starts
  // chipping is exactly where a resurrected '−N' branch would hide.
  for (const key of ['total', 'completed']) {
    assert.deepEqual(chipsOf(execFunnel(withDeltas({ [key]: -7 }, ZERO_DELTAS))), [],
      `${key}: a negative must render neither the card chip nor the new bar chip`);
  }
});

test('the funnel chip sits INLINE BESIDE its count, not stacked beneath it', () => {
  // THE GEOMETRY IS THE FEATURE this round, and it is invisible to every other case in this
  // file: moving the chip back under the count would leave all the text assertions green.
  // 'collected' is used because it is the one stage key with no KPI card, so the slide
  // carries exactly ONE chip and it is unambiguously the funnel's — the x is established
  // here against the count column, and only then reused by funnelChipsOf elsewhere.
  const slide = execFunnel(withDeltas({ collected: 3 }, ZERO_DELTAS));
  const chips = chipElsOf(slide);
  assert.equal(chips.length, 1, 'a card-less stage key must produce exactly one chip');
  const [chip] = chips;
  assert.equal(chip.x, FUNNEL_CHIP_X, 'the funnel chip moved out of the count column');
  assert.equal(chip.size, FUNNEL_CHIP_SIZE, 'and stayed small against the 14pt count');

  const count = countElsOf(slide)[1]; // stage 2 — سحب العينة
  assert.equal(count.text, String(MOCK_REPORT_MODEL.kpi.funnel.collected));
  // BESIDE: to the count's outward side, clear of the column it used to share.
  assert.ok(chip.x >= count.x + count.w * 0.5,
    `chip x ${chip.x} must clear the centre of the count box (${count.x}..${count.x + count.w})`);
  // AND ON THE SAME LINE: the old position was rowY+0.40, a full line below, so any band
  // tighter than the 0.65in row pitch separates the two layouts. 0.10 is deliberately loose
  // — the pin is "same line", not a re-litigation of the measured 0.015in raise.
  assert.ok(Math.abs(chip.y - count.y) <= 0.10,
    `chip y ${chip.y} must share the count's line (${count.y}), not stack under it`);
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
