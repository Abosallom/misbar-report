// test/delta-mode-registry.test.mjs — run with:  node --test
//
// ONE enum, FOUR consumers. DELTA_MODES (src/model/delta-baseline.js) is the single
// source of truth for reportOptions.deltaMode, and three surfaces have to agree with
// it or the app lies to the operator:
//   • the review screen's pill row      (DELTA_MODE_PILLS,   src/ui/screen-review.js)
//   • the settings radio group          (DELTA_MODE_OPTIONS, src/ui/screen-settings.js)
//   • the deck's exec delta legend      (build-spec's deltaLegendText → DEFAULT_LABELS)
// A mode with no pill is unreachable; a pill with no mode writes a value the store
// rejects; a mode with no legend wording silently prints generic wording on a deck
// whose chips mean something else entirely. Each is a one-line omission during a mode
// change, so each gets a mechanical check here.
//
// REWRITTEN 2026-08-05 (Talal's rule 1+2 round). deltaMode keeps the SAME storage key
// and the SAME two values ['daily','week'] with 'week' still the default — only the
// SEMANTICS moved: the value used to choose a stored BASELINE to diff against, and now
// chooses a WINDOW SIZE over which the rows' own dated events are counted. So:
//   • the legend is driven by model.deltaWindow {start, end, mode}, NOT by
//     model.deltaBaseline — the retired stamp is gone from every surface;
//   • the legend keys are execDeltaLegendWeekWindow / execDeltaLegendDayWindow, which
//     carry {start}/{end} placeholders instead of a single {date} baseline;
//   • DELTA_LEGEND_KEY and the anchored:false downgrade are DELETED — there is no
//     baseline left to be un-anchored, so there is nothing to downgrade to;
//   • the retired legend keys (execDeltaLegendDaily/Week/Weekly/WeeklySun/WeeklyThu)
//     stay in both registries as PARITY ORPHANS. They are unreachable from
//     deltaLegendText, but a user may already have OVERRIDDEN one in their saved
//     labels, and DEFAULT_LABELS/LABEL_NAMES key parity is itself a shipped
//     invariant (the labels editor iterates one and reads the other). Deleting them
//     would break parity and silently drop a saved override; they are pinned as
//     orphans below so nobody "cleans them up" without reading this.
//
// The 2026-08-04 change that made this file necessary: 'weekly-sun'/'weekly-thu' were
// replaced by ONE mode, 'week', which became the DEFAULT. screen-review's old
// isWeeklyMode tested startsWith('weekly') — 'week' FAILS that. isWeekDeltaMode
// replaces it and is pinned at the bottom of this file.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DELTA_MODES, DEFAULT_DELTA_MODE, isWeekDeltaMode,
} from '../src/model/delta-baseline.js';
import { windowFor } from '../src/model/delta-window.js';
import { DELTA_MODE_PILLS } from '../src/ui/screen-review.js';
import { DELTA_MODE_OPTIONS } from '../src/ui/screen-settings.js';
import { buildSpec, DEFAULT_LABELS, LABEL_NAMES } from '../src/slidespec/build-spec.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';

// The label key each mode's legend must use. This table is the TEST's own statement of
// the contract — build-spec's deltaLegendText is what it is checked against, so the two
// cannot be edited in one place and forgotten in the other.
const LEGEND_KEY_FOR = {
  daily: 'execDeltaLegendDayWindow',
  week: 'execDeltaLegendWeekWindow',
};

// Legend keys that no longer have a code path but MUST stay in both registries.
const RETIRED_LEGEND_KEYS = [
  'execDeltaLegendDaily', 'execDeltaLegendWeek', 'execDeltaLegendWeekly',
  'execDeltaLegendWeeklySun', 'execDeltaLegendWeeklyThu',
];

// build-spec's fmtDate: 'yyyy-mm-dd' → 'dd / mm / yyyy'.
const WEEK_START_ISO = '2026-07-05'; // Sunday
const WEEK_END_ISO = '2026-07-09';   // Thursday
const START_TXT = '05 / 07 / 2026';
const END_TXT = '09 / 07 / 2026';

// The exec-summary delta legend is the only '▲'-prefixed text on the funnel slide, and
// it is emitted ONLY when at least one green chip is visible this run — which is why the
// fixture's completed delta (47) is load-bearing for every case below.
function legendTextOf(deltaWindow) {
  const spec = buildSpec({ ...MOCK_REPORT_MODEL, deltaWindow }, { variant: 'internal' });
  const slide = spec.find((s) => s.id === 'execFunnel');
  assert.ok(slide, 'the exec funnel slide is missing from the spec');
  const legends = slide.elements.filter(
    (e) => e.t === 'text' && typeof e.text === 'string' && e.text.startsWith('▲'),
  );
  assert.equal(legends.length, 1, 'exactly one delta legend line is expected on the slide');
  return legends[0].text;
}

const win = (mode) => ({ ...windowFor(WEEK_END_ISO, mode) });

test('the fixture keeps a visible chip, so the legend is actually rendered', () => {
  // If this ever drops to 0 every legend case below would silently assert nothing.
  assert.equal(MOCK_REPORT_MODEL.kpi.deltas.completed, 47);
  assert.ok(legendTextOf(win(DEFAULT_DELTA_MODE)).startsWith('▲'));
});

// ---- pills / radio coverage --------------------------------------------------
test('the review pills cover exactly DELTA_MODES, in the same order', () => {
  assert.deepEqual(DELTA_MODE_PILLS.map((p) => p.mode), DELTA_MODES);
  // Every pill needs visible text, or the operator gets a blank button.
  for (const p of DELTA_MODE_PILLS) {
    assert.ok(typeof p.label === 'string' && p.label.length > 0, `pill ${p.mode} has a label`);
  }
});

test('the settings radio covers exactly DELTA_MODES, in the same order', () => {
  const valueOf = (o) => (o && typeof o === 'object' ? (o.value !== undefined ? o.value : o.mode) : o);
  assert.deepEqual(DELTA_MODE_OPTIONS.map(valueOf), DELTA_MODES);
  for (const o of DELTA_MODE_OPTIONS) {
    assert.ok(typeof o.label === 'string' && o.label.length > 0, `option ${valueOf(o)} has a label`);
  }
});

test('pills and radio describe ACTIVITY, not a comparison against a previous report', () => {
  // The wording is the only thing telling the operator what the chips now mean. A
  // label left saying 'التغيّر منذ التقرير السابق' would describe the retired product.
  for (const label of [...DELTA_MODE_PILLS.map((p) => p.label), ...DELTA_MODE_OPTIONS.map((o) => o.label)]) {
    assert.ok(label.includes('نشاط'), `label must say نشاط (activity): ${label}`);
    assert.ok(!label.includes('التقرير السابق'), `label must not promise a previous-report diff: ${label}`);
  }
});

// ---- legend coverage: the WINDOW wording -------------------------------------
test('every mode has its own window legend, with the window dates substituted', () => {
  for (const mode of DELTA_MODES) {
    const key = LEGEND_KEY_FOR[mode];
    assert.ok(key, `mode '${mode}' has no legend key in this test's table — add one WITH the wording`);
    const template = DEFAULT_LABELS[key];
    assert.ok(typeof template === 'string' && template.length > 0, `DEFAULT_LABELS.${key} exists`);
    assert.ok(template.includes('{end}'), `${key} must carry the {end} placeholder`);
    const w = win(mode);
    let expected = template.replace('{end}', END_TXT);
    if (mode === 'week') {
      assert.ok(template.includes('{start}'), 'the week legend must name where the window opens');
      expected = expected.replace('{start}', START_TXT);
      assert.equal(w.start, WEEK_START_ISO, 'the week opens on Sunday');
    }
    assert.equal(legendTextOf(w), expected, `mode '${mode}' must render ${key}`);
    // No placeholder may survive into a delivered slide.
    assert.ok(!legendTextOf(w).includes('{'), `${key} left an unsubstituted placeholder`);
  }
});

test('the two modes do not share one legend line', () => {
  // A copy-paste that pointed 'week' at the day key would pass the loop above only if
  // the strings matched; pin that they are genuinely different wordings.
  assert.notEqual(DEFAULT_LABELS.execDeltaLegendWeekWindow, DEFAULT_LABELS.execDeltaLegendDayWindow);
  assert.notEqual(legendTextOf(win('daily')), legendTextOf(win('week')));
  // The week line names BOTH ends; the day line names only the day.
  assert.ok(legendTextOf(win('week')).includes(START_TXT) && legendTextOf(win('week')).includes(END_TXT));
  assert.ok(!legendTextOf(win('daily')).includes(START_TXT));
  assert.ok(legendTextOf(win('daily')).includes(END_TXT));
});

test('the legend says ACTIVITY, never "change since the previous report"', () => {
  // THE INVARIANT: the big numbers on the slide are CUMULATIVE TOTALS; only the ▲
  // chips are the window's activity. A legend that says 'التغيّر منذ التقرير السابق'
  // over activity chips misstates both halves at once.
  for (const mode of DELTA_MODES) {
    const text = legendTextOf(win(mode));
    assert.ok(text.includes('نشاط'), `${mode} legend must say نشاط: ${text}`);
    assert.notEqual(text, DEFAULT_LABELS.execDeltaLegend, `${mode} must not fall to the undated line`);
  }
  // The week wording anchors on Sunday explicitly — the operator has to be able to
  // read the window off the slide without knowing the app's calendar rules.
  assert.ok(DEFAULT_LABELS.execDeltaLegendWeekWindow.includes('الأحد'));
});

test('a malformed or absent window degrades to the undated generic line', () => {
  // The shape a model carries when the rows were unavailable and the engine's own
  // deltas survived: no window was stamped, so none may be claimed.
  assert.equal(legendTextOf(undefined), DEFAULT_LABELS.execDeltaLegend);
  assert.equal(legendTextOf(null), DEFAULT_LABELS.execDeltaLegend);
  assert.equal(legendTextOf({ mode: 'week' }), DEFAULT_LABELS.execDeltaLegend, 'no dates at all');
  // fmtDate splits on '-' and would print 'undefined / undefined / …' — an ISO-shape
  // gate, not just a truthiness one, is what keeps garbage off a delivered slide.
  assert.equal(legendTextOf({ mode: 'week', start: WEEK_START_ISO, end: 'soon' }), DEFAULT_LABELS.execDeltaLegend);
  assert.equal(legendTextOf({ mode: 'week', start: 'whenever', end: WEEK_END_ISO }), DEFAULT_LABELS.execDeltaLegend);
  // A daily window needs only `end`, so a missing start must NOT drop it to generic.
  assert.equal(
    legendTextOf({ mode: 'daily', end: WEEK_END_ISO }),
    DEFAULT_LABELS.execDeltaLegendDayWindow.replace('{end}', END_TXT),
  );
});

test('an unexpected stamped mode renders the WEEK form, whose dates are still true', () => {
  // normalizeDeltaMode's canonical output is only ever 'daily' or 'week', so this is
  // defence in depth against a stale cached module — and the fallback is safe because
  // the dates come from the same stamp either way.
  const text = legendTextOf({ mode: 'weekly-thu', start: WEEK_START_ISO, end: WEEK_END_ISO });
  assert.equal(text, DEFAULT_LABELS.execDeltaLegendWeekWindow.replace('{start}', START_TXT).replace('{end}', END_TXT));
});

// ---- registry parity ---------------------------------------------------------
test('DEFAULT_LABELS and LABEL_NAMES have identical key sets', () => {
  // The labels editor iterates LABEL_NAMES and reads DEFAULT_LABELS[key] as the
  // placeholder: a key in one and not the other is either an uneditable string or an
  // editor row with an empty placeholder that silently blanks the deck text.
  const defs = Object.keys(DEFAULT_LABELS).sort();
  const names = Object.keys(LABEL_NAMES).sort();
  assert.deepEqual(
    defs.filter((k) => !LABEL_NAMES[k]), [],
    'these DEFAULT_LABELS keys are missing from LABEL_NAMES',
  );
  assert.deepEqual(
    names.filter((k) => !(k in DEFAULT_LABELS)), [],
    'these LABEL_NAMES keys are missing from DEFAULT_LABELS',
  );
  assert.deepEqual(defs, names);
  assert.equal(defs.length, names.length);
  // Every legend key the modes need is in BOTH registries (so it is user-overridable).
  for (const mode of DELTA_MODES) {
    const key = LEGEND_KEY_FOR[mode];
    assert.ok(key in DEFAULT_LABELS, `${key} in DEFAULT_LABELS`);
    assert.ok(key in LABEL_NAMES, `${key} in LABEL_NAMES`);
  }
});

test('the RETIRED legend keys stay in both registries as parity orphans', () => {
  // They are unreachable from deltaLegendText — that is the point of the rewrite —
  // but a user may already have overridden one in their saved labels, and key parity
  // is itself a shipped invariant. Removing them breaks the editor and drops the
  // override silently. Read this test before "cleaning up" any of these keys.
  for (const key of RETIRED_LEGEND_KEYS) {
    assert.ok(key in DEFAULT_LABELS, `retired key ${key} must survive in DEFAULT_LABELS`);
    assert.ok(key in LABEL_NAMES, `retired key ${key} must survive in LABEL_NAMES`);
  }
  // …and none of them is reachable as a rendered legend any more.
  const live = new Set(DELTA_MODES.map((m) => legendTextOf(win(m))));
  for (const key of RETIRED_LEGEND_KEYS) {
    assert.ok(!live.has(DEFAULT_LABELS[key]), `${key} must not be rendered by any live mode`);
  }
  // The undated generic fallback is NOT retired — it is a live code path.
  assert.ok('execDeltaLegend' in DEFAULT_LABELS && 'execDeltaLegend' in LABEL_NAMES);
});

// ---- the isWeeklyMode trap ---------------------------------------------------
test("isWeekDeltaMode recognises 'week' — the predicate startsWith('weekly') missed", () => {
  assert.equal(isWeekDeltaMode('week'), true);
  assert.equal(isWeekDeltaMode('weekly-sun'), true);
  assert.equal(isWeekDeltaMode('daily'), false);
  // The literal regression: the retired predicate would have answered false for the
  // DEFAULT mode, deleting the week disclosures on the review screen.
  assert.equal('week'.startsWith('weekly'), false, 'why the old predicate had to go');
  assert.equal(isWeekDeltaMode(DEFAULT_DELTA_MODE), true, 'the default mode must be disclosed');
});
