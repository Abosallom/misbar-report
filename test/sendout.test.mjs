// test/sendout.test.mjs — run with:  node --test
// Send-out attribution: where KAMC's tests are actually PERFORMED.
//
// The load-bearing assertions here are the ones that protect against a WRONG
// answer rather than a missing one: that a Saudi vendor shipping abroad counts
// as International, that a multi-country vendor is split on TEST NAME and never
// on LOINC, that an unrecognised lab is reported rather than guessed — attributed
// by test name only when the WHOLE catalogue gives that test one answer, and
// never when the facility is a vendor we already know (by its alias, or by its
// own name, which then IS that vendor) — that a blank facility is never guessed,
// that all three tables reconcile to the same total, and that none of this moves
// an order the full report already decided.
//
// Fixture countries and reference labs are placeholders. This repo is public:
// no real catalogue country or reference lab may be written into it, test or not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  analyseSendout, hasMaster, norm, share, reflabShort, LOCAL_COUNTRY, CANCELLED_STATUS,
  FACILITY_TO_VENDOR, FACILITY_DISPLAY, AR_COUNTRY,
} from '../src/model/sendout.js';
import { inferBlankFacilities } from '../src/engine/infer-facility.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '../src/model/sendout.js'), 'utf8');
// Source with comments stripped — several assertions below are about what the
// CODE does, and the comments deliberately discuss the things it must not do.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// A tiny master exercising every shape: single-country, and a two-country vendor
// whose split is decided per test.
const MASTER = [
  { vendor: 'Agent Co -Orig-', country: 'Germany', reflab: 'RefLab North', item: 'TEST A' },
  { vendor: 'Local Lab -Orig-', country: 'Saudi Arabia', reflab: 'CRL', item: 'TEST B' },
  { vendor: 'Split Vendor -Orig-', country: 'Saudi Arabia', reflab: 'RefLab Home', item: 'TEST HOME' },
  { vendor: 'Split Vendor -Orig-', country: 'USA', reflab: 'RefLab West', item: 'TEST AWAY' },
];
const ALIAS = {
  'agent co': 'agent co',
  'local lab': 'local lab',
  'split vendor': 'split vendor',
  // An alias whose vendor NO catalogue row spells that way — the shape a vendor
  // re-spelled in next year's workbook leaves behind.
  'ghost alias': 'a vendor spelling the catalogue dropped',
  // A lab contracted under ANOTHER vendor's name (the real table's 'genomics …'
  // entry is this shape). Its alias must win even where a catalogue ALSO lists a
  // vendor spelled like the lab itself.
  'renamed lab': 'agent co',
};
// Point the module's lookup tables at the fixture vendors for these unit tests.
for (const [k, v] of Object.entries(ALIAS)) {
  FACILITY_TO_VENDOR[k] = v;
  FACILITY_DISPLAY[k] = k.replace(/\b\w/g, (c) => c.toUpperCase());
}

const order = (facility, testName, rawStatus = 'Result Approved', orderId = 'x') =>
  ({ facility, testName, rawStatus, orderId });

test('norm strips the master file\'s -Orig- suffix and collapses spacing', () => {
  assert.equal(norm('Saudi Diagnostic Limited Co. -Orig-'), 'saudi diagnostic limited co.');
  assert.equal(norm('Anwa  Medical   Company'), 'anwa medical company');
  assert.equal(norm('  EUROFINS Clinical '), 'eurofins clinical');
  assert.equal(norm(null), '');
});

test('cancelled orders are excluded from EVERY count and percentage', () => {
  const r = analyseSendout([
    order('Agent Co', 'TEST A'),
    order('Agent Co', 'TEST A', CANCELLED_STATUS),
    order('Agent Co', 'TEST A', CANCELLED_STATUS),
  ], MASTER);
  assert.equal(r.total, 1);
  assert.equal(r.international, 1);
  assert.equal(r.byCountry.reduce((a, c) => a + c.orders, 0), 1);
});

test("'Result Rejected' is NOT cancelled — those orders still count", () => {
  const r = analyseSendout([order('Agent Co', 'TEST A', 'Result Rejected')], MASTER);
  assert.equal(r.total, 1);
  assert.equal(r.international, 1);
});

test('LOCAL means PERFORMED in Saudi Arabia, not ordered from a Saudi company', () => {
  // 'Agent Co' is the shape that matters: a local agent whose reference lab is
  // in Germany. Counting it as Local because the vendor is Saudi would be the
  // single most damaging error these slides can make.
  const r = analyseSendout([order('Agent Co', 'TEST A'), order('Local Lab', 'TEST B')], MASTER);
  assert.equal(r.local, 1, 'only the lab that actually runs it in-Kingdom is Local');
  assert.equal(r.international, 1);
  assert.equal(r.byCountry.find((c) => c.country === 'Germany').orders, 1);
});

test('a multi-country vendor splits by TEST NAME, giving one row per country', () => {
  const r = analyseSendout([
    order('Split Vendor', 'TEST HOME'),
    order('Split Vendor', 'TEST AWAY'),
    order('Split Vendor', 'TEST AWAY'),
  ], MASTER);
  assert.equal(r.local, 1);
  assert.equal(r.international, 2);
  const rows = r.byLab.filter((x) => x.lab === 'Split Vendor');
  assert.equal(rows.length, 2, 'a lab in two countries produces TWO rows');
  assert.deepEqual(rows.map((x) => x.country), ['Saudi Arabia', 'USA']);
  assert.deepEqual(rows.map((x) => x.reflab), ['RefLab Home', 'RefLab West']);
});

test('test-name matching ignores case and whitespace, and never uses LOINC', () => {
  const r = analyseSendout([
    order('Split Vendor', '  test   home  '),
    { facility: 'Split Vendor', testName: 'TEST AWAY', loinc: '94818-2', rawStatus: 'ok' },
  ], MASTER);
  assert.equal(r.local, 1);
  assert.equal(r.international, 1);
  assert.equal(r.unresolved.length, 0);
  // The module must not consult a LOINC field at all: the two files disagree on
  // codes, and one code exists in the master against a different test abroad.
  // Comments MENTION loinc (explaining why it is avoided), so strip them first
  // and assert on executable code only.
  assert.ok(!/\.loinc\b|\['loinc'\]|\bloinc\s*:/i.test(CODE),
    'sendout must never read a LOINC field');
});

test("a multi-country vendor's unknown test is Unresolved — never split arbitrarily", () => {
  const r = analyseSendout([order('Split Vendor', 'TEST NOBODY HAS')], MASTER);
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.local + r.international, 0, 'an unresolved order is attributed to no country');
  assert.equal(r.total, 1, 'but it still counts toward the basis');
});

test('an UNRECOGNISED lab name is reported, never guessed and never merged', () => {
  // A test name the catalogue does not list gives the fallback nothing to go on.
  // (A test the catalogue lists under ONE vendor is attributed by test name —
  // see the byTestName cases below.)
  const r = analyseSendout([
    order('Some Lab Nobody Mapped', 'TEST NOBODY HAS'),
    order('Agent Co', 'TEST A'),
  ], MASTER);
  assert.equal(r.unmapped.length, 1);
  assert.equal(r.byTestName.length, 0);
  assert.equal(r.unmapped[0].facility, 'Some Lab Nobody Mapped');
  assert.equal(r.byLab.length, 1, 'the unmapped lab gets no row of its own');
  assert.ok(!r.byLab.some((x) => /Nobody/.test(x.lab)));
  assert.equal(r.byCountry.reduce((a, c) => a + c.orders, 0), 1, 'and no country');
});

test('a BLANK facility is inferred from the same test — but only if unambiguous', () => {
  // Unambiguous: every other order of TEST A goes to one lab.
  const ok = analyseSendout([
    order('Agent Co', 'TEST A'), order('Agent Co', 'TEST A'),
    order(null, 'TEST A'),
  ], MASTER);
  assert.equal(ok.inferred.length, 1);
  assert.equal(ok.unmapped.length, 0);
  assert.equal(ok.inferred[0].lab, 'Agent Co');
  assert.equal(ok.inferred[0].country, 'Germany');
  assert.equal(ok.inferred[0].support, 2, 'reports how many orders back the inference');
  assert.equal(ok.byLab.find((x) => x.lab === 'Agent Co').orders, 3);

  // Ambiguous: that test runs at two different labs, so inferring would be a coin
  // flip. It must stay unmapped rather than be credited to either.
  const split = analyseSendout([
    order('Split Vendor', 'TEST HOME'),
    { facility: 'Local Lab', testName: 'TEST HOME', rawStatus: 'ok' },
    order(null, 'TEST HOME'),
  ], [...MASTER, { vendor: 'Local Lab -Orig-', country: 'Saudi Arabia', reflab: 'CRL', item: 'TEST HOME' }]);
  assert.equal(split.inferred.length, 0);
  assert.equal(split.unmapped.length, 1, 'ambiguous inference must not be made');
});

test('an unrecognised NAME is never inferred, even when the test is unambiguous', () => {
  // This is the distinction that keeps master-file holes visible: a blank field
  // is a gap in the order, but a name we do not know is a gap in the ALIASES. The
  // blank-facility rule must never overwrite it with the lab its test usually
  // runs at. The test-name fallback may place it in a country, but under its OWN
  // name and on the byTestName list the review screen discloses, so the missing
  // alias stays in front of Aziz until it is added.
  const r = analyseSendout([
    order('Agent Co', 'TEST A'), order('Agent Co', 'TEST A'),
    order('Totally Unknown Lab', 'TEST A'),
  ], MASTER);
  assert.equal(r.inferred.length, 0, 'the name is not treated as a blank');
  assert.equal(r.byTestName.length, 1);
  assert.equal(r.byTestName[0].lab, 'Totally Unknown Lab', 'never credited to Agent Co');
  assert.equal(r.byLab.find((x) => x.lab === 'Agent Co').orders, 2);

  // With a test the catalogue does not list, it stays plainly unmapped.
  const gap = analyseSendout([
    order('Agent Co', 'TEST A'), order('Totally Unknown Lab', 'TEST NOBODY HAS'),
  ], MASTER);
  assert.equal(gap.inferred.length, 0);
  assert.equal(gap.unmapped.length, 1);
});

test('percentages are one decimal and shares reconcile', () => {
  assert.equal(share(39, 1287), 3);
  assert.equal(share(574, 1287), 44.6);
  assert.equal(share(0, 0), 0);
});

test('byLab keeps a lab\'s country rows ADJACENT and labs alphabetical', () => {
  const r = analyseSendout([
    order('Split Vendor', 'TEST AWAY'),
    order('Agent Co', 'TEST A'),
    order('Split Vendor', 'TEST HOME'),
    order('Local Lab', 'TEST B'),
  ], MASTER);
  const labs = r.byLab.map((x) => x.lab);
  assert.deepEqual(labs, ['Agent Co', 'Local Lab', 'Split Vendor', 'Split Vendor']);
  // adjacency: a lab's rows form one contiguous run
  for (const lab of new Set(labs)) {
    const idx = labs.map((l, i) => (l === lab ? i : -1)).filter((i) => i >= 0);
    assert.equal(idx[idx.length - 1] - idx[0], idx.length - 1, `${lab} rows must be adjacent`);
  }
});

test('RECONCILIATION: local + international + unresolved + unmapped == total', () => {
  const r = analyseSendout([
    order('Agent Co', 'TEST A'),
    order('Local Lab', 'TEST B'),
    order('Split Vendor', 'TEST NOBODY HAS'),        // unresolved
    order('Who Knows', 'TEST A'),                    // byTestName (unique test)
    order('Who Knows', 'TEST NOBODY HAS'),           // unmapped
    order(null, 'TEST NOBODY HAS'),                  // unmapped (blank, uninferable)
    order('Who Knows', 'TEST A', CANCELLED_STATUS),  // off every count
    order('Agent Co', 'TEST A', CANCELLED_STATUS),
  ], MASTER);
  assert.equal(r.total, 6);
  assert.deepEqual(
    [r.byTestName.length, r.unresolved.length, r.unmapped.length], [1, 1, 2],
    'every bucket is exercised, so the identity below is not vacuous');
  assert.equal(r.local + r.international + r.unresolved.length + r.unmapped.length, r.total);
  const byCountry = r.byCountry.reduce((a, c) => a + c.orders, 0);
  const byLab = r.byLab.reduce((a, l) => a + l.orders, 0);
  assert.equal(byCountry, byLab, 'table B and table C must agree');
  assert.equal(byCountry + r.unresolved.length + r.unmapped.length, r.total);
  // The four buckets partition the kept orders: resolved + byTestName + unmapped
  // + unresolved === total, with byTestName INSIDE local/international.
  const resolved = r.local + r.international - r.byTestName.length;
  assert.equal(resolved, 2);
  assert.equal(resolved + r.byTestName.length + r.unmapped.length + r.unresolved.length, r.total);
  // and per country
  for (const c of r.byCountry) {
    const s = r.byLab.filter((l) => l.country === c.country).reduce((a, l) => a + l.orders, 0);
    assert.equal(s, c.orders, `country ${c.country}: C must equal B`);
  }
});

test('a country with no orders this period is OMITTED, not shown as zero', () => {
  const r = analyseSendout([order('Agent Co', 'TEST A')], MASTER);
  assert.deepEqual(r.byCountry.map((c) => c.country), ['Germany']);
  assert.ok(!r.byCountry.some((c) => c.orders === 0));
});

test('empty / junk input degrades quietly rather than throwing', () => {
  for (const bad of [null, undefined, [], 'nonsense', 42]) {
    const r = analyseSendout(bad, MASTER);
    assert.equal(r.total, 0);
    assert.deepEqual(r.byCountry, []);
    assert.deepEqual(r.byLab, []);
  }
  assert.equal(analyseSendout([order('Agent Co', 'TEST A')], []).unmapped.length, 1);
});

test('a missing or empty catalogue is refused by hasMaster, not silently analysed', () => {
  // With no catalogue EVERY order comes back unmapped. Callers must gate on this
  // and omit the slides; a deck that reported every lab as unmapped would be
  // worse than no deck, and one that guessed would be worse still.
  for (const bad of [null, undefined, [], 'nope', 42]) assert.equal(hasMaster(bad), false);
  assert.equal(hasMaster(MASTER), true);
  const r = analyseSendout([order('Agent Co', 'TEST A')], []);
  assert.equal(r.unmapped.length, 1, 'no catalogue => nothing can be attributed');
  assert.equal(r.byLab.length, 0);
});

test('every country the catalogue can contain has an Arabic name for the slides', () => {
  // The real workbook's countries, as of the 2026 master file. A country with no
  // Arabic label would render its raw English name mid-sentence on an RTL slide.
  for (const c of ['Saudi Arabia', 'Germany', 'Bahrain', 'USA', 'Jordan', 'Finland', 'Romania', 'South Korea']) {
    assert.ok(AR_COUNTRY[c], `no Arabic label for country '${c}'`);
  }
});

test('POLICY: the module is pure — no DOM, no clock, no network', () => {
  for (const bad of ['document.', 'window.', 'fetch(', 'Date.now', 'new Date', 'localStorage']) {
    assert.ok(!CODE.includes(bad), `sendout must not reference ${bad}`);
  }
});

test('reflabShort abbreviates a long SHOUTED name and leaves others alone', () => {
  assert.equal(reflabShort('BIG NATIONAL SPECIALIST HOSPITAL'), 'BNSH');
  assert.equal(reflabShort('RefLab North'), 'RefLab North', 'mixed case is left as written');
  assert.equal(reflabShort('SHORT LAB'), 'SHORT LAB', 'a short name is not abbreviated');
  assert.equal(reflabShort(''), '');
  assert.equal(reflabShort(null), '');
});

// ---------------------------------------------------------------------------
// THE UNSCOPED INVARIANT. Every facility whose alias reaches a catalogue vendor is
// decided exactly as before; the only orders that move are former UNMAPPED ones —
// to byTestName, or (a facility spelled like a catalogue vendor) to resolved/
// unresolved exactly as its identity alias would have put them. A report with
// neither is the report it always was. That is what the scoped-report feature
// promises for the full, unscoped deck (sendout.js header).

// The analysis as it stood BEFORE the byTestName fallback, kept as the oracle the
// invariant is measured against. Its job is to be what the full report used to
// compute — do not "fix" it, and do not route it through sendout.js internals.
// `aliasOf` is the alias table's lookup, injectable so the SAME logic can say what
// it would compute with more aliases in the table (see withIdentityAliases).
function legacyAnalyse(orders, master, aliasOf = (key) => FACILITY_TO_VENDOR[key]) {
  const ntn = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  const byVendor = new Map();
  for (const row of master) {
    const v = norm(row && row.vendor);
    if (!v || !row.country) continue;
    let e = byVendor.get(v);
    if (!e) { e = { countries: new Map(), tests: new Map() }; byVendor.set(v, e); }
    if (!e.countries.has(row.country)) e.countries.set(row.country, row.reflab || '');
    const t = ntn(row.item);
    if (t && !e.tests.has(t)) e.tests.set(t, { country: row.country, reflab: row.reflab || '' });
  }
  const filled = inferBlankFacilities(orders);
  const rows = orders.map((r, i) => (filled.has(i) ? { ...r, facility: filled.get(i) } : r));
  const kept = rows.filter((o) => String((o && o.rawStatus) || '').trim() !== CANCELLED_STATUS);
  const resolved = [];
  const unmapped = [];
  const unresolved = [];
  for (const o of kept) {
    const key = norm(o && o.facility);
    const vkey = key ? aliasOf(key) : null;
    const entry = vkey ? byVendor.get(vkey) : null;
    if (!entry) { unmapped.push(o); continue; }
    const lab = FACILITY_DISPLAY[key] || String(o.facility);
    if (entry.countries.size === 1) {
      const [country, reflab] = [...entry.countries.entries()][0];
      resolved.push({ order: o, lab, country, reflab });
    } else {
      const hit = entry.tests.get(ntn(o.testName));
      if (hit) resolved.push({ order: o, lab, country: hit.country, reflab: hit.reflab });
      else unresolved.push(o);
    }
  }
  const inferred = [];
  for (const [i] of filled) {
    const hit = resolved.find((r) => r.order === rows[i]);
    if (!hit) continue;
    inferred.push({
      orderId: orders[i].orderId, lab: hit.lab, country: hit.country, reflab: hit.reflab,
      support: orders.filter((r, j) => j !== i && ntn(r.testName) === ntn(rows[i].testName)
        && String(r.facility || '').trim() !== '').length,
    });
  }
  const local = resolved.filter((r) => r.country === LOCAL_COUNTRY).length;
  return { total: kept.length, local, international: resolved.length - local, resolved, unmapped, unresolved, inferred };
}

/** The normalised vendor names a catalogue can resolve a facility to. */
const catalogueVendors = (master) => new Set(master.filter((m) => norm(m.vendor) && m.country).map((m) => norm(m.vendor)));

/** The alias table as it reads once every catalogue vendor ALSO has its identity
 *  alias ('x' → 'x'), the way 'eurofins clinical' does — added only where the
 *  facility's own alias does not already reach a vendor, so a real alias always
 *  wins. The legacy logic run with THIS is what the new rule promises. */
const withIdentityAliases = (vendors) => (key) => {
  const alias = FACILITY_TO_VENDOR[key];
  if (alias && vendors.has(alias)) return alias;
  return vendors.has(key) ? key : alias;
};

// Deterministic PRNG (mulberry32): the fuzz below must fail the same way twice.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('INVARIANT: aliased orders are decided exactly as before; only former unmapped orders move', () => {
  const rand = rng(20260929);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  // Small pools, so collisions (one test under two vendors, countries or reflabs;
  // a whitespace/case variant of a name; a lab named like a vendor) are common
  // rather than rare. 'Ghost Alias' and 'Renamed Lab' are ALSO vendors here: a stale
  // alias whose own name is a vendor, and a live alias whose own name is another one.
  const VENDORS = ['Agent Co -Orig-', 'Local Lab -Orig-', 'Split Vendor -Orig-', 'Direct Vendor -Orig-', 'Other Co',
    'Ghost Alias -Orig-', 'Renamed Lab'];
  const COUNTRIES = ['Saudi Arabia', 'Germany', 'USA', 'Country X'];
  const REFLABS = ['RefLab North', 'RefLab South', ''];
  const ITEMS = ['TEST A', 'TEST B', 'TEST C', 'test  c', 'TEST D', 'SEND OUT TEST E', ''];
  const FACILITIES = ['Agent Co', 'local lab', 'Split Vendor', 'Direct Vendor', 'DIRECT  VENDOR ', 'Other Co',
    'Ghost Alias', 'Renamed Lab', 'Brand New Lab', 'brand new lab', null, '', '  '];
  const NAMES = [...ITEMS, 'TEST Z', 'E', 'test a', null];
  const STATUSES = ['Result Approved', 'Result Approved', 'Result Rejected', CANCELLED_STATUS];
  const ids = (list) => list.map((o) => o.orderId);
  const decided = (list) => list.map((r) => [r.order.orderId, r.lab, r.country, r.reflab]);
  // Keyed on norm(lab): a vendor known only by its name is captioned with its first
  // spelling where the oracle prints each raw one — the same lab either way.
  const labKey = (r) => [norm(r.lab), r.country, r.reflab].join('\u001F');
  const tally = (list) => {
    const m = new Map();
    for (const r of list) m.set(labKey(r), (m.get(labKey(r)) || 0) + 1);
    return m;
  };
  let clean = 0;
  let withFallback = 0;
  let namedAgainstOther = 0;
  let staleButNamed = 0;
  let aliasOverName = 0;

  for (let run = 0; run < 1500; run++) {
    const master = Array.from({ length: 1 + Math.floor(rand() * 10) }, () => ({
      vendor: pick(VENDORS), country: pick(COUNTRIES), reflab: pick(REFLABS), item: pick(ITEMS),
    }));
    const orders = Array.from({ length: Math.floor(rand() * 13) }, (_, i) => ({
      facility: pick(FACILITIES), testName: pick(NAMES), rawStatus: pick(STATUSES), orderId: `o${i}`,
    }));
    const vendors = catalogueVendors(master);
    const reaches = (key) => !!FACILITY_TO_VENDOR[key] && vendors.has(FACILITY_TO_VENDOR[key]);
    // A facility the new rule looks up by its OWN name (its alias reaches nothing).
    const named = (o) => { const k = norm(o.facility); return !!k && !reaches(k) && vendors.has(k); };
    const r = analyseSendout(orders, master);
    const L = legacyAnalyse(orders, master);                                  // the report as it was
    const D = legacyAnalyse(orders, master, withIdentityAliases(vendors));    // + identity aliases
    const label = `run ${run}`;

    // (1) The identity aliases move ONLY the orders of a facility named like a vendor,
    //     and only out of unmapped: everything the old report decided stays decided.
    assert.deepEqual(decided(D.resolved.filter((x) => !named(x.order))), decided(L.resolved), `${label}: resolved moved`);
    assert.deepEqual(ids(D.unresolved.filter((o) => !named(o))), ids(L.unresolved), `${label}: unresolved moved`);
    assert.deepEqual(ids(D.unmapped), ids(L.unmapped.filter((o) => !named(o))), `${label}: unmapped`);

    // (2) The new analysis IS that, plus byTestName taking some of what is left unmapped.
    assert.equal(r.total, D.total, label);
    assert.deepEqual(ids(r.unresolved), ids(D.unresolved), `${label}: unresolved`);
    const taken = new Set(ids(r.byTestName.map((b) => b.order)));
    assert.deepEqual(ids(r.unmapped), ids(D.unmapped).filter((id) => !taken.has(id)), `${label}: unmapped`);
    assert.equal(taken.size + r.unmapped.length, D.unmapped.length, `${label}: byTestName outside former unmapped`);
    const got = new Map(r.byLab.map((x) => [labKey(x), x.orders]));
    assert.equal(got.size, r.byLab.length, `${label}: one facility split across byLab rows`);
    assert.deepEqual(got, tally(D.resolved.concat(r.byTestName)), `${label}: byLab`);
    const btnLocal = r.byTestName.filter((b) => b.country === LOCAL_COUNTRY).length;
    assert.equal(r.local - btnLocal, D.local, `${label}: local`);
    assert.equal(r.international - (r.byTestName.length - btnLocal), D.international, `${label}: international`);

    if (!r.byTestName.length) {
      clean += 1;
      // No fallback orders: the whole disclosure is what it always was.
      assert.deepEqual(
        r.inferred.map((x) => ({ orderId: x.order.orderId, lab: norm(x.lab), country: x.country, reflab: x.reflab, support: x.support })),
        D.inferred.map((x) => ({ ...x, lab: norm(x.lab) })), `${label}: inferred`);
    } else {
      withFallback += 1;
    }

    // (3) Each byTestName answer is the catalogue's ONLY answer for that test name, for
    //     a facility that is no catalogue vendor at all — never a blank, never one
    //     spelled like a vendor, never one whose alias reaches one.
    for (const b of r.byTestName) {
      const t = String(b.order.testName).replace(/\s+/g, ' ').trim().toLowerCase();
      const answers = new Set(master
        .filter((m) => norm(m.vendor) && m.country
          && String(m.item == null ? '' : m.item).replace(/\s+/g, ' ').trim().toLowerCase() === t)
        .map((m) => [norm(m.vendor), m.country, m.reflab || ''].join('\u001F')));
      assert.equal(answers.size, 1, `${label}: '${t}' has ${answers.size} catalogue answers`);
      const [, country, reflab] = [...answers][0].split('\u001F');
      assert.deepEqual([b.country, b.reflab], [country, reflab], label);
      const fkey = norm(b.order.facility);
      assert.ok(fkey, `${label}: a blank facility has no lab to caption, so never reaches the fallback`);
      assert.ok(!vendors.has(fkey) && !reaches(fkey), `${label}: ${fkey} is a known vendor, yet fell back`);
    }

    // Tally the shapes the rule exists for, so the thresholds below can prove they ran.
    const answerOf = (name) => {
      const t = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().toLowerCase();
      const hits = new Set(master.filter((m) => norm(m.vendor) && m.country
        && String(m.item == null ? '' : m.item).replace(/\s+/g, ' ').trim().toLowerCase() === t)
        .map((m) => [norm(m.vendor), m.country, m.reflab || ''].join('\u001F')));
      return hits.size === 1 ? [...hits][0].split('\u001F')[0] : null;
    };
    for (const o of D.resolved.map((x) => x.order).concat(D.unresolved)) {
      const k = norm(o.facility);
      if (!named(o)) { if (vendors.has(k) && reaches(k) && FACILITY_TO_VENDOR[k] !== k) aliasOverName += 1; continue; }
      const v = answerOf(o.testName);
      if (v && v !== k) namedAgainstOther += 1;   // the old fallback's wrong-country bait
      if (FACILITY_TO_VENDOR[k]) staleButNamed += 1;
    }
  }
  // Not vacuous: both regimes and every vendor-by-name shape were exercised.
  assert.ok(clean > 100, `only ${clean} runs without fallback orders`);
  assert.ok(withFallback > 100, `only ${withFallback} runs with fallback orders`);
  assert.ok(namedAgainstOther > 100, `a vendor-named lab met another vendor's unique test only ${namedAgainstOther} times`);
  assert.ok(staleButNamed > 100, `a stale alias named like a vendor ran only ${staleButNamed} times`);
  assert.ok(aliasOverName > 50, `an alias beat a vendor-named facility only ${aliasOverName} times`);
});

test('test names match case- and whitespace-folded ONLY, in both lookups', () => {
  // A looser fold (a dropped 'SEND OUT TEST ' prefix, dash variants, invisible
  // characters) would re-decide ALIASED orders too and move the full report, so it
  // is out of this change until signed off as such. Pinned so it cannot slip in.
  const master = [
    ...MASTER,
    { vendor: 'Split Vendor -Orig-', country: 'Saudi Arabia', reflab: 'RefLab Home', item: 'SEND OUT TEST HOME-PANEL' },
  ];
  const r = analyseSendout([
    order('Split Vendor', 'send out  test home-panel'),      // case/space only: resolves
    order('Split Vendor', 'HOME - PANEL'),                   // prefix-less, spaced hyphen
    order('Split Vendor', 'SEND OUT TEST HOME\u2013PANEL'),  // en dash
    order('Split Vendor', 'SEND OUT TEST HOME-PANEL\u200B'), // zero-width space
    order('Brand New Lab', '  Test   A '),                   // fallback, case/space only
    order('Brand New Lab', 'SEND OUT TEST TEST A'),          // fallback, prefix added
  ], master);
  assert.equal(r.local, 1);
  assert.equal(r.unresolved.length, 3, 'a known vendor\'s re-spelled test stays unresolved, as it always was');
  assert.equal(r.byTestName.length, 1);
  assert.equal(r.byTestName[0].country, 'Germany');
  assert.equal(r.unmapped.length, 1);
});

// ---------------------------------------------------------------------------
// THE TEST-NAME FALLBACK (byTestName). An order whose facility is NO catalogue
// vendor — no alias reaching one, and not a vendor's own name — is attributed by its
// test name, only when the WHOLE catalogue gives that name one vendor, one country
// and one reference lab. A blank facility never gets there.
test('a facility with no alias is attributed by a UNIQUE test name, under its own name', () => {
  const r = analyseSendout([
    order('Brand New Lab', 'TEST B'),
    order(' BRAND  NEW LAB ', 'test b'),             // same lab, sloppier spelling
    order('Brand New Lab', '  Test  A'),             // case/space-folded 'TEST A'
  ], MASTER);
  assert.equal(r.unmapped.length, 0);
  assert.equal(r.byTestName.length, 3);
  for (const e of r.byTestName) {
    assert.equal(e.lab, 'Brand New Lab', 'the order\'s own lab is shown — never the vendor');
    assert.ok(e.order && e.order.testName, 'each entry carries its order for the review list');
  }
  assert.deepEqual(r.byTestName.map((e) => [e.country, e.reflab]),
    [['Saudi Arabia', 'CRL'], ['Saudi Arabia', 'CRL'], ['Germany', 'RefLab North']]);
  // Counted like any attributed order: in local/international, byCountry, byLab.
  assert.equal(r.local, 2);
  assert.equal(r.international, 1);
  assert.deepEqual(r.byCountry, [{ country: 'Saudi Arabia', orders: 2 }, { country: 'Germany', orders: 1 }]);
  assert.deepEqual(r.byLab, [
    { lab: 'Brand New Lab', country: 'Germany', reflab: 'RefLab North', orders: 1 },
    { lab: 'Brand New Lab', country: 'Saudi Arabia', reflab: 'CRL', orders: 2 },
  ], 'two spellings of one facility make ONE lab, split only by country');
});

test('the fallback REFUSES a test name two vendors, countries or reference labs share', () => {
  const master = [
    ...MASTER,
    // exact collision: two vendors
    { vendor: 'Agent Co -Orig-', country: 'Germany', reflab: 'RefLab North', item: 'TEST SHARED' },
    { vendor: 'Local Lab -Orig-', country: 'Saudi Arabia', reflab: 'CRL', item: 'TEST SHARED' },
    // one vendor, two countries
    { vendor: 'Split Vendor -Orig-', country: 'Saudi Arabia', reflab: 'RefLab Home', item: 'TEST TWO LANDS' },
    { vendor: 'Split Vendor -Orig-', country: 'USA', reflab: 'RefLab West', item: 'TEST TWO LANDS' },
    // one vendor, one country, two reference labs — the slide names the reflab
    { vendor: 'Agent Co -Orig-', country: 'Germany', reflab: 'RefLab North', item: 'TEST TWO REFLABS' },
    { vendor: 'Agent Co -Orig-', country: 'Germany', reflab: 'RefLab South', item: 'TEST TWO REFLABS' },
    // a collision only case/spacing hides: still ONE name to the index
    { vendor: 'Agent Co -Orig-', country: 'Germany', reflab: 'RefLab North', item: 'TEST  SPACED' },
    { vendor: 'Local Lab -Orig-', country: 'Saudi Arabia', reflab: 'CRL', item: 'test spaced' },
    // Each of the next two differs in ONE field only, so dropping that field from
    // the comparison is caught on its own. Two vendors agreeing on country AND
    // reference lab: the answer would read the same, but the name no longer
    // identifies ONE contract (sendout.js AMBIGUOUS).
    { vendor: 'Agent Co -Orig-', country: 'Germany', reflab: 'RefLab North', item: 'TEST TWO VENDORS' },
    { vendor: 'Split Vendor -Orig-', country: 'Germany', reflab: 'RefLab North', item: 'TEST TWO VENDORS' },
    // one vendor, one reference lab, two countries
    { vendor: 'Split Vendor -Orig-', country: 'Saudi Arabia', reflab: 'RefLab Home', item: 'TEST SAME LAB' },
    { vendor: 'Split Vendor -Orig-', country: 'USA', reflab: 'RefLab Home', item: 'TEST SAME LAB' },
  ];
  const r = analyseSendout([
    order('Brand New Lab', 'TEST SHARED'),
    order('Brand New Lab', 'test shared'),
    order('Brand New Lab', 'TEST TWO LANDS'),
    order('Brand New Lab', 'TEST TWO REFLABS'),
    order('Brand New Lab', 'Test Spaced'),
    order('Brand New Lab', 'TEST TWO VENDORS'),
    order('Brand New Lab', 'TEST SAME LAB'),
  ], master);
  assert.equal(r.byTestName.length, 0, 'an ambiguous name is never used');
  assert.deepEqual(r.unmapped.map((o) => o.testName), ['TEST SHARED', 'test shared', 'TEST TWO LANDS',
    'TEST TWO REFLABS', 'Test Spaced', 'TEST TWO VENDORS', 'TEST SAME LAB']);
  assert.equal(r.local + r.international, 0);
  // The poison is the GLOBAL index's alone. A KNOWN multi-country vendor is split on
  // its OWN rows, first row winning, exactly as the full report always has — even for
  // 'TEST SAME LAB', which it lists in two countries (the known limitation sendout.js
  // indexMaster documents; pinned so changing it is a deliberate move of the report).
  const known = analyseSendout([order('Split Vendor', 'TEST TWO VENDORS'), order('Split Vendor', 'TEST SAME LAB')], master);
  assert.deepEqual(known.byLab.map((x) => [x.lab, x.country]), [['Split Vendor', 'Germany'], ['Split Vendor', 'Saudi Arabia']]);
  assert.equal(known.unresolved.length + known.unmapped.length + known.byTestName.length, 0);
  // Poisoned for good: a third, agreeing row does not un-poison the name.
  const again = analyseSendout([order('Brand New Lab', 'TEST SHARED')],
    [...master, { vendor: 'Agent Co -Orig-', country: 'Germany', reflab: 'RefLab North', item: 'TEST SHARED' }]);
  assert.equal(again.byTestName.length, 0);
});

test('a facility spelled like a catalogue vendor IS that vendor — never answered from another vendor\'s rows', () => {
  // Its alias is missing — the state every newly catalogued vendor is in until one
  // is added — but its NAME says who it is, exactly as an identity alias would. So it
  // is looked up as THAT vendor, like any aliased one: a single-country vendor's
  // orders land in its country whatever the test, and a test unique to Agent Co
  // (Germany) never sends this Saudi vendor's order abroad. Resolved, not disclosed.
  const master = [
    ...MASTER,
    { vendor: 'Direct Vendor -Orig-', country: 'Saudi Arabia', reflab: 'RefLab Home', item: 'TEST DIRECT' },
  ];
  assert.equal(FACILITY_TO_VENDOR['direct vendor'], undefined, 'the case needs NO alias');
  const r = analyseSendout([
    order('Direct Vendor', 'TEST A'),        // unique to Agent Co: the wrong-country bait
    order('DIRECT  VENDOR', 'TEST DIRECT'),  // its own row
  ], master);
  assert.equal(r.unmapped.length, 0);
  assert.equal(r.byTestName.length, 0, 'a known vendor is resolved, never sent to the fallback');
  assert.equal(r.international, 0, 'never counted abroad via another vendor\'s country');
  assert.equal(r.local, 2);
  assert.deepEqual(r.byLab, [{ lab: 'Direct Vendor', country: 'Saudi Arabia', reflab: 'RefLab Home', orders: 2 }],
    'two spellings of one facility make ONE row, captioned with the first');

  // A MULTI-country vendor known by its name splits on ITS OWN tests, and a test only
  // another vendor lists is unresolved — the rule every aliased vendor follows.
  const multi = analyseSendout([
    order('Two Lands Co', 'TEST NORTH'),
    order('Two Lands Co', 'TEST A'),          // unique to Agent Co: not re-routed
  ], [...MASTER,
    { vendor: 'Two Lands Co', country: 'Saudi Arabia', reflab: 'RefLab Home', item: 'TEST SOUTH' },
    { vendor: 'Two Lands Co', country: 'USA', reflab: 'RefLab West', item: 'TEST NORTH' },
  ]);
  assert.deepEqual(multi.byLab.map((x) => [x.lab, x.country, x.orders]), [['Two Lands Co', 'USA', 1]]);
  assert.deepEqual(multi.unresolved.map((o) => o.testName), ['TEST A']);
  assert.equal(multi.byTestName.length + multi.unmapped.length, 0);
});

test('an alias that reaches a vendor WINS over a facility name that spells another vendor', () => {
  // 'renamed lab' is aliased to Agent Co (Germany). A catalogue that ALSO lists a
  // vendor spelled 'Renamed Lab' (Saudi Arabia) must not move it: the alias is a
  // confirmed identity, and the full report has always decided it by that alias.
  const r = analyseSendout([order('Renamed Lab', 'TEST B')],
    [...MASTER, { vendor: 'Renamed Lab', country: 'Saudi Arabia', reflab: 'RefLab Home', item: 'TEST B' }]);
  assert.deepEqual(r.byLab.map((x) => [x.lab, x.country, x.reflab]),
    [[FACILITY_DISPLAY['renamed lab'], 'Germany', 'RefLab North']]);
  assert.equal(r.local, 0);
});

test('the fallback NEVER re-routes an order whose facility maps to a known vendor', () => {
  // 'TEST A' is unique to Agent Co and 'TEST B' to Local Lab, so a global lookup
  // WOULD answer — and would contradict a vendor the aliases say we know.
  const r = analyseSendout([
    order('Split Vendor', 'TEST A'),   // multi-country: not among ITS tests
    order('Agent Co', 'TEST B'),       // single-country: its own country stands
  ], MASTER);
  assert.equal(r.byTestName.length, 0);
  assert.equal(r.unresolved.length, 1, 'unresolved, never sent to Germany via Agent Co');
  assert.equal(r.unresolved[0].facility, 'Split Vendor');
  assert.deepEqual(r.byLab.map((x) => [x.lab, x.country]), [['Agent Co', 'Germany']],
    'Agent Co stays in its own country whatever the test name says');
  assert.equal(r.local, 0);
});

test('an alias whose vendor the catalogue no longer lists falls back by test name', () => {
  // A stale alias names a catalogue spelling that is gone, so it cannot say which
  // of today's rows is the lab; the unique test name can (a renamed vendor's rows
  // are exactly what it finds) — provided its own name is no vendor either. The lab
  // keeps the alias's caption.
  const r = analyseSendout([order('Ghost Alias', 'TEST A'), order('Ghost Alias', 'TEST NOBODY HAS')], MASTER);
  assert.equal(r.byTestName.length, 1);
  assert.equal(r.byTestName[0].lab, FACILITY_DISPLAY['ghost alias']);
  assert.equal(r.byTestName[0].country, 'Germany');
  assert.equal(r.unmapped.length, 1);

  // Unless its OWN name is a catalogue vendor: then it IS that vendor, like any
  // facility spelled like one, and TEST A (Agent Co's) cannot take it to Germany.
  const named = analyseSendout([order('Ghost Alias', 'TEST A')],
    [...MASTER, { vendor: 'Ghost Alias -Orig-', country: 'Saudi Arabia', reflab: 'RefLab Home', item: 'TEST GHOST' }]);
  assert.equal(named.byTestName.length, 0);
  assert.deepEqual(named.byLab.map((x) => [x.lab, x.country]), [[FACILITY_DISPLAY['ghost alias'], 'Saudi Arabia']]);
});

test('a BLANK facility inferred to an unaliased lab is attributed AND disclosed as inferred', () => {
  const r = analyseSendout([
    order('Brand New Lab', 'TEST B'), order('Brand New Lab', 'TEST B'),
    order(null, 'TEST B'),
    order(null, 'TEST NOBODY HAS'),   // no other order names a lab: stays unmapped
  ], MASTER);
  assert.equal(r.byTestName.length, 3);
  assert.equal(r.unmapped.length, 1);
  assert.equal(r.inferred.length, 1, 'on the slides, so the reader is told');
  assert.equal(r.inferred[0].lab, 'Brand New Lab');
  assert.equal(r.inferred[0].country, 'Saudi Arabia');
  assert.equal(r.inferred[0].support, 2);
  assert.equal(r.inferred[0].order.facility, null, 'reports the ORIGINAL row, blank and all');
});

test('a BLANK facility the inference refuses NEVER reaches the test-name fallback', () => {
  // TEST B runs at two labs in the data, so the inference leaves both blanks blank —
  // yet the catalogue lists TEST B under exactly ONE vendor+country, so a fallback
  // lookup WOULD answer. It must not: the name identifies a contract, not which of
  // the two labs this order went to, and the order has no lab to caption it with
  // (without the guard it lands in a country under a lab called '' or 'null').
  const orders = [
    order('Agent Co', 'TEST B'),
    order('Local Lab', 'TEST B'),
    order(null, 'TEST B', 'Result Approved', 'blank'),
    order('   ', 'TEST B', 'Result Approved', 'spaces'),
  ];
  for (const opts of [undefined, { inferBlanks: false }]) {
    const r = analyseSendout(orders, MASTER, opts);
    const label = JSON.stringify(opts);
    assert.deepEqual(r.unmapped.map((o) => o.orderId), ['blank', 'spaces'], label);
    assert.equal(r.byTestName.length, 0, label);
    assert.equal(r.inferred.length, 0, label);
    for (const x of r.byLab) {
      assert.ok(typeof x.lab === 'string' && x.lab.trim() !== '' && x.lab !== 'null', `${label}: lab '${x.lab}'`);
    }
    assert.deepEqual(r.byLab.map((x) => [x.lab, x.country]), [['Agent Co', 'Germany'], ['Local Lab', 'Saudi Arabia']], label);
    assert.equal(r.total, 4, label);
  }
});

test('a lab whose name is an Object.prototype key is just an unknown lab', () => {
  // Facility keys are lower-cased ORDER DATA looked up in plain-object tables; an
  // inherited property ('constructor', '__proto__') must not read as an alias or a
  // caption — a function caption would reach byLab and throw in its sort.
  const r = analyseSendout([order('Constructor', 'TEST A'), order('__proto__', 'TEST B')], MASTER);
  assert.deepEqual(r.byTestName.map((b) => [b.lab, b.country]), [['Constructor', 'Germany'], ['__proto__', 'Saudi Arabia']]);
  assert.ok(r.byLab.every((x) => typeof x.lab === 'string'));
});

// ---------------------------------------------------------------------------
// inferBlanks:false — A SCOPED REPORT'S FACILITIES ARE FINAL. applyScope (model/
// scope.js) infers blanks over the FULL rows before filtering; a blank that survives
// is one the full report leaves unattributed on purpose. Re-inferred on a scope's
// SUBSET, where only one of the labs running its test may remain, it would be credited
// to that lab and COUNTRY. The review screen passes the flag for scoped builds only.
test('inferBlanks:false leaves a blank facility blank — unmapped, never re-inferred from a subset', () => {
  // The FULL data runs TEST SHARED at two unaliased labs, so the blank 'z' is
  // ambiguous: unmapped in the full report.
  const master = [{ vendor: 'Vendor Q -Orig-', country: 'Country Q', reflab: 'RefLab Q', item: 'TEST SHARED' }];
  const full = [
    order('Lab A', 'TEST SHARED', 'Result Approved', 'a1'),
    order('Lab A', 'TEST SHARED', 'Result Approved', 'a2'),
    order('Lab B', 'TEST SHARED', 'Result Approved', 'b1'),
    order(null, 'TEST SHARED', 'Result Approved', 'z'),
  ];
  assert.deepEqual(analyseSendout(full, master).unmapped.map((o) => o.orderId), ['z']);
  // A shipment scope hands over [a1, z]. Inferring there sees ONE lab for the test —
  // the hole the flag closes.
  const subset = [full[0], full[3]];
  const guessed = analyseSendout(subset, master);
  assert.equal(guessed.unmapped.length, 0, 'the default infers from whatever rows it is given');
  assert.deepEqual(guessed.byLab.map((x) => [x.lab, x.orders]), [['Lab A', 2]]);

  const r = analyseSendout(subset, master, { inferBlanks: false });
  assert.deepEqual(r.unmapped.map((o) => o.orderId), ['z'], 'z stays unmapped, as in the full report');
  assert.deepEqual(r.byLab.map((x) => [x.lab, x.country, x.orders]), [['Lab A', 'Country Q', 1]]);
  assert.equal(r.inferred.length, 0, 'nothing was filled by this pass, so nothing is disclosed as inferred');
  assert.equal(r.total, 2, 'still counted in the basis');
  assert.equal(subset[1].facility, null, 'the caller\'s row is never written to');
});

test('inferBlanks: only `false` skips the inference — every other value is today\'s default', () => {
  // The full report passes nothing; it must come out exactly as it always did.
  const orders = [
    order('Agent Co', 'TEST A'), order('Agent Co', 'TEST A'), order(null, 'TEST A', 'Result Approved', 'z'),
    order('Brand New Lab', 'TEST B'), order('', 'TEST B', 'Result Approved', 'y'),
  ];
  const base = analyseSendout(orders, MASTER);
  assert.equal(base.inferred.length, 2, 'both blanks are inferred by default');
  for (const opts of [null, {}, { inferBlanks: true }, { inferBlanks: undefined }, { inferBlanks: 0 }, { inferBlanks: 'false' }]) {
    assert.deepEqual(analyseSendout(orders, MASTER, opts), base, JSON.stringify(opts));
  }
  const off = analyseSendout(orders, MASTER, { inferBlanks: false });
  assert.deepEqual(off.unmapped.map((o) => o.orderId), ['z', 'y']);
  assert.equal(off.inferred.length, 0);
  // Nothing else moves: the named orders are decided exactly as by default.
  assert.deepEqual(off.byLab.map((x) => [x.lab, x.orders]), [['Agent Co', 2], ['Brand New Lab', 1]]);
});

test('Genalive Laboratories resolves through its confirmed alias, not the fallback', () => {
  // Confirmed 2026-09-29: every live order from this lab was unmapped for want of
  // this alias. Countries/reflabs below are PLACEHOLDERS — the real ones stay in
  // the encrypted catalogue.
  const vendor = 'GENALIVE MEDICAL COMPANY -Orig-';
  assert.equal(FACILITY_TO_VENDOR['genalive laboratories'], norm(vendor));
  assert.equal(FACILITY_DISPLAY['genalive laboratories'], 'Genalive Laboratories');
  const master = [
    { vendor, country: 'Country X', reflab: 'RefLab X', item: 'SEND OUT TEST GX ONE' },
    { vendor, country: 'Country Y', reflab: 'RefLab Y', item: 'SEND OUT TEST GX TWO' },
    // Another vendor lists GX ONE too, so the GLOBAL index cannot answer it: only
    // the alias path can resolve the order below.
    { vendor: 'Agent Co -Orig-', country: 'Germany', reflab: 'RefLab North', item: 'SEND OUT TEST GX ONE' },
  ];
  const r = analyseSendout([
    order('Genalive Laboratories', 'SEND OUT TEST GX ONE'),
    order('GENALIVE  LABORATORIES', 'send out test  gx two'),
  ], master);
  assert.equal(r.unmapped.length, 0);
  assert.equal(r.unresolved.length, 0);
  assert.equal(r.byTestName.length, 0, 'an aliased lab is resolved, not a disclosure');
  assert.deepEqual(r.byLab.map((x) => [x.lab, x.country, x.orders]),
    [['Genalive Laboratories', 'Country X', 1], ['Genalive Laboratories', 'Country Y', 1]]);
});

// ---------------------------------------------------------------------------
// ALIAS-TABLE HYGIENE. Both tables are hand-maintained: an order's performing
// facility is matched to a catalogue vendor through FACILITY_TO_VENDOR, and
// captioned through FACILITY_DISPLAY. A key present in one and missing from the
// other is silent — the slide just prints the raw CSV spelling — so the pairing
// is pinned here rather than left to review.
//
// NB these cases run AFTER the fixture aliases above were injected into both
// tables, which is fine: the injection adds a display name for every key it adds,
// so it can never be the thing that fails the parity check.
test('every mapped facility also has a display name', () => {
  for (const key of Object.keys(FACILITY_TO_VENDOR)) {
    assert.ok(FACILITY_DISPLAY[key], `no display caption for mapped facility '${key}'`);
    assert.notEqual(FACILITY_DISPLAY[key].trim(), '', `empty display caption for '${key}'`);
  }
});

test('the two "advanced …" labs stay DISTINCT vendors', () => {
  // A live near-miss, and the reason this case exists: two unrelated companies
  // whose names read alike, contracted in different countries, both appearing in
  // the same upload. Collapsing them would move real orders to the wrong country
  // and nothing downstream would notice. (2026-09-08: the branch-suffixed one was
  // added after a week's report came up one order short of its own total — it had
  // no mapping at all, so it counted in the total and in neither country.)
  const services = FACILITY_TO_VENDOR['advanced laboratory services .co'];
  const cell = FACILITY_TO_VENDOR['advanced cell laboratory sulaimanih br'];
  assert.ok(services, 'the services lab must stay mapped');
  assert.ok(cell, 'the cell lab must stay mapped — an unmapped lab silently leaves the country split');
  assert.notEqual(cell, services, 'these are different companies and must resolve to different vendors');
  assert.notEqual(FACILITY_DISPLAY['advanced cell laboratory sulaimanih br'],
    FACILITY_DISPLAY['advanced laboratory services .co']);
});
