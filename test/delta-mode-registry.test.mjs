// test/delta-mode-registry.test.mjs — run with:  node --test
//
// ONE enum, FOUR consumers. DELTA_MODES (src/model/delta-baseline.js) is the single
// source of truth for reportOptions.deltaMode, and three surfaces have to agree with
// it or the app lies to the operator:
//   • the review screen's pill row      (DELTA_MODE_PILLS,   src/ui/screen-review.js)
//   • the settings radio group          (DELTA_MODE_OPTIONS, src/ui/screen-settings.js)
//   • the deck's exec delta legend      (DELTA_LEGEND_KEY → DEFAULT_LABELS, build-spec)
// A mode with no pill is unreachable; a pill with no mode writes a value the store
// rejects; a mode with no legend wording silently prints the generic '▲ التغيّر منذ
// التقرير السابق' on a deck whose chips mean something else entirely. Each of those
// is a one-line omission during a mode change, so each gets a mechanical check here.
//
// The 2026-08-04 change that made this file necessary: 'weekly-sun'/'weekly-thu' were
// replaced by ONE week-to-date mode, 'week', which became the DEFAULT. screen-review's
// old isWeeklyMode tested startsWith('weekly') — 'week' FAILS that test, so both
// baseline disclosures (anchorFallbackNote, and the banner path around it) would have
// gone silently missing on the default mode. isWeekDeltaMode replaces it and is pinned
// at the bottom of this file.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DELTA_MODES, DEFAULT_DELTA_MODE, isWeekDeltaMode,
} from '../src/model/delta-baseline.js';
import { DELTA_MODE_PILLS } from '../src/ui/screen-review.js';
import { DELTA_MODE_OPTIONS } from '../src/ui/screen-settings.js';
import { buildSpec, DEFAULT_LABELS, LABEL_NAMES } from '../src/slidespec/build-spec.js';
import { MOCK_REPORT_MODEL } from './fixtures/mock-report-model.js';

// The label key each mode's legend must use. This table is the TEST's own statement of
// the contract — build-spec's DELTA_LEGEND_KEY is what it is checked against, so the two
// cannot be edited in one place and forgotten in the other.
const LEGEND_KEY_FOR = {
  daily: 'execDeltaLegendDaily',
  week: 'execDeltaLegendWeek',
};

// build-spec's fmtDate: 'yyyy-mm-dd' → 'dd / mm / yyyy'.
const BASELINE_ISO = '2026-07-23';
const BASELINE_TXT = '23 / 07 / 2026';

// The exec-summary delta legend is the only '▲'-prefixed text on the funnel slide, and
// it is emitted ONLY when at least one green chip is visible this run — which is why the
// fixture's completed delta (47) is load-bearing for every case below.
function legendTextOf(deltaBaseline) {
  const spec = buildSpec({ ...MOCK_REPORT_MODEL, deltaBaseline }, { variant: 'internal' });
  const slide = spec.find((s) => s.id === 'execFunnel');
  assert.ok(slide, 'the exec funnel slide is missing from the spec');
  const legends = slide.elements.filter(
    (e) => e.t === 'text' && typeof e.text === 'string' && e.text.startsWith('▲'),
  );
  assert.equal(legends.length, 1, 'exactly one delta legend line is expected on the slide');
  return legends[0].text;
}

test('the fixture keeps a visible chip, so the legend is actually rendered', () => {
  // If this ever drops to 0 every legend case below would silently assert nothing.
  assert.equal(MOCK_REPORT_MODEL.kpi.deltas.completed, 47);
  assert.ok(legendTextOf({ mode: DEFAULT_DELTA_MODE, baselineDate: BASELINE_ISO }).startsWith('▲'));
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

// ---- legend coverage ---------------------------------------------------------
test('every mode has its own legend wording, with the baseline date substituted', () => {
  for (const mode of DELTA_MODES) {
    const key = LEGEND_KEY_FOR[mode];
    assert.ok(key, `mode '${mode}' has no legend key in this test's table — add one WITH the wording`);
    const template = DEFAULT_LABELS[key];
    assert.ok(typeof template === 'string' && template.length > 0, `DEFAULT_LABELS.${key} exists`);
    assert.ok(template.includes('{date}'), `${key} must carry the {date} placeholder`);
    const expected = template.replace('{date}', BASELINE_TXT);
    assert.equal(
      legendTextOf({ mode, baselineDate: BASELINE_ISO, anchored: true }),
      expected,
      `mode '${mode}' must render ${key}`,
    );
    assert.ok(expected.includes(BASELINE_TXT), 'the date is really in the rendered line');
  }
});

test('the two modes do not share one legend line', () => {
  // A copy-paste that pointed 'week' at the daily key would pass the loop above only if
  // the strings matched; pin that they are genuinely different wordings.
  assert.notEqual(DEFAULT_LABELS.execDeltaLegendDaily, DEFAULT_LABELS.execDeltaLegendWeek);
  assert.notEqual(
    legendTextOf({ mode: 'daily', baselineDate: BASELINE_ISO }),
    legendTextOf({ mode: 'week', baselineDate: BASELINE_ISO, anchored: true }),
  );
});

test('anchored:false falls back to the DAILY wording even in week mode', () => {
  // pickDeltaBaseline found no report before the week's Sunday and degraded to the most
  // recent prior report. Calling that 'منذ بداية الأسبوع' would state a comparison basis
  // the baseline does not have — the deck would assert a week's movement it never
  // measured. The daily wording is exactly what that baseline IS.
  const daily = DEFAULT_LABELS.execDeltaLegendDaily.replace('{date}', BASELINE_TXT);
  assert.equal(legendTextOf({ mode: 'week', baselineDate: BASELINE_ISO, anchored: false }), daily);
  // anchored:true and an absent `anchored` both keep the week wording (the legacy/daily
  // paths return no anchored key at all).
  const week = DEFAULT_LABELS.execDeltaLegendWeek.replace('{date}', BASELINE_TXT);
  assert.equal(legendTextOf({ mode: 'week', baselineDate: BASELINE_ISO, anchored: true }), week);
  assert.equal(legendTextOf({ mode: 'week', baselineDate: BASELINE_ISO }), week);
});

test('the retired mode values still resolve to a dated legend (stale-cache skew)', () => {
  // A browser holding an old bundle can hand a freshly-loaded build a 'weekly-sun' from
  // its own storage for one render. Those keys stay mapped so the deck names its baseline
  // instead of dropping to the undated generic line.
  for (const legacy of ['weekly', 'weekly-sun', 'weekly-thu']) {
    const text = legendTextOf({ mode: legacy, baselineDate: BASELINE_ISO, anchored: true });
    assert.ok(text.includes(BASELINE_TXT), `${legacy} still names its baseline date`);
    assert.notEqual(text, DEFAULT_LABELS.execDeltaLegend, `${legacy} must not fall to the undated line`);
  }
});

test('a baseline with no date, and no baseline at all, use the undated generic line', () => {
  assert.equal(legendTextOf({ mode: 'week', baselineDate: null }), DEFAULT_LABELS.execDeltaLegend);
  assert.equal(legendTextOf(undefined), DEFAULT_LABELS.execDeltaLegend);
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

// ---- the isWeeklyMode trap ---------------------------------------------------
test("isWeekDeltaMode recognises 'week' — the predicate startsWith('weekly') missed", () => {
  assert.equal(isWeekDeltaMode('week'), true);
  assert.equal(isWeekDeltaMode('weekly-sun'), true);
  assert.equal(isWeekDeltaMode('daily'), false);
  // The literal regression: the retired predicate would have answered false for the
  // DEFAULT mode, deleting the anchored:false / legacy disclosures on the review screen.
  assert.equal('week'.startsWith('weekly'), false, 'why the old predicate had to go');
  assert.equal(isWeekDeltaMode(DEFAULT_DELTA_MODE), true, 'the default mode must be disclosed');
});
