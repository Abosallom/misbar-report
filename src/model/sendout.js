// model/sendout.js — where KAMC's send-out tests are actually PERFORMED.
//
// Answers two questions for the deck: how many tests ran inside Saudi Arabia vs
// abroad, and which lab in which country ran them.
//
// ⚠ 'Local' means the test was physically PERFORMED in Saudi Arabia. It does NOT
// mean KAMC ordered it from a Saudi company — many Saudi vendors are local
// agents who ship the specimen abroad, and those orders are INTERNATIONAL. Only
// the catalogue (the ops workbook, ingest/sendout-master.js) can make that call.
//
// HOW AN ORDER IS ATTRIBUTED — every non-cancelled order lands in EXACTLY ONE of
// four buckets, so resolved + byTestName + unmapped + unresolved === total:
//   resolved    its facility is a KNOWN catalogue vendor — through its alias
//               (FACILITY_TO_VENDOR), or because its own normalised name IS a
//               vendor's (an identity alias, not needed) — and that vendor's
//               country is settled: it works in one country, or the order's TEST
//               NAME matches one of its tests.
//   byTestName  its facility is NO catalogue vendor, by alias or by name, but its
//               test name belongs to exactly one vendor+country+reference lab in
//               the WHOLE catalogue. On the slides under its OWN lab name, and
//               listed on review so the missing alias still gets added —
//               attributed, not a gap.
//   unresolved  a known multi-country vendor, test name not among its tests.
//               Never re-routed to another vendor: that would contradict a
//               facility we KNOW (by its alias or by its own name).
//   unmapped    everything else: a blank facility, or an unknown one whose test
//               name the catalogue lists under no vendor or under several.
// local/international/byCountry/byLab count resolved AND byTestName.
//
// UNSCOPED INVARIANT. Every facility whose alias reaches a catalogue vendor is
// decided EXACTLY as before byTestName existed (same whitespace/case-folded
// test-name key, same first-row-wins per-vendor index). The only orders that move
// are former UNMAPPED ones: to byTestName, or — a facility spelled like a vendor —
// to resolved/unresolved exactly as its identity alias would have put them. With
// neither kind in the data, every field below is what it always was. Test names
// are deliberately NOT folded any further (a missing 'SEND OUT TEST ' prefix, dash
// variants, invisible characters): a looser key re-decides aliased orders too and
// moves the full report, so it needs its own sign-off.
//
import { inferBlankFacilities } from '../engine/infer-facility.js?v=v2026-10-05.1';

// PURE module: no DOM, no clock, no network, no vendor imports — the browser and
// `node --test` share one deterministic path. The catalogue is INJECTED, never
// imported: it is commercial tender data that ships encrypted (see
// ingest/sendout-master.js), so it cannot live in the bundle.

/** Orders in this status are excluded from every count and percentage. */
export const CANCELLED_STATUS = 'Order Cancelled';

/** The country that counts as "local". */
export const LOCAL_COUNTRY = 'Saudi Arabia';

/** Country names as they appear on the slides. */
export const AR_COUNTRY = {
  'Saudi Arabia': 'المملكة العربية السعودية',
  Germany: 'ألمانيا',
  Bahrain: 'البحرين',
  USA: 'الولايات المتحدة',
  Jordan: 'الأردن',
  Finland: 'فنلندا',
  Romania: 'رومانيا',
  'South Korea': 'كوريا الجنوبية',
};

/** Short forms used only in the footnote under the lab table. */
export const AR_COUNTRY_SHORT = { 'Saudi Arabia': 'السعودية' };
/**
 * Abbreviate a long, SHOUTED reference-lab name to its initials for the footnote
 * (a four-word all-caps hospital name becomes a four-letter acronym), leaving
 * ordinary mixed-case names untouched.
 *
 * DERIVED, not looked up: a hardcoded map of real reference labs would put
 * catalogue content into this public repo, which is the very thing shipping the
 * catalogue encrypted exists to prevent. The names arrive at runtime from the
 * decrypted file, so none of them needs to be written down here.
 */
export function reflabShort(name) {
  const t = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  if (t.length <= 20 || t !== t.toUpperCase()) return t;
  const initials = t.split(' ').filter(Boolean).map((w) => w[0]).join('');
  return initials.length >= 3 ? initials : t;
}

/**
 * Lower-case, collapse whitespace, drop the master file's trailing ' -Orig-'.
 * The two files are typed by different people and never agree exactly.
 */
export function norm(s) {
  return String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*-\s*Orig\s*-\s*$/i, '')
    .trim()
    .toLowerCase();
}

/**
 * Confirmed equivalences: an order's 'Performing facility name' -> the master's
 * 'Vendor Name'. Every one of these is a name the two files spell differently;
 * they are confirmed by KAMC, not guessed.
 */
export const FACILITY_TO_VENDOR = {
  'advanced laboratory services .co': 'advanced laboratory services compan',
  // NOT the same company as the line above, however alike the two names read —
  // a DIFFERENT vendor, contracted in a different country. Keep them apart.
  // The master spells this one without the 'o' of 'laboratory' and without the
  // branch suffix the order carries. Confirmed by KAMC 2026-09-08, on top of a
  // character-for-character match between the order's test name and one of this
  // vendor's two contracted tests. That test is what decides the country: the
  // vendor works in more than one, so the multi-country branch below resolves it
  // per test — which country, and at which reference lab, stays in the ENCRYPTED
  // catalogue and is deliberately not written down in this public repo.
  'advanced cell laboratory sulaimanih br': 'advanced cell labratory',
  'fal specialized medical lab': 'fal specialized medical est.',
  'king abdullaziz medical city in riyadh': 'business center ngha',
  'noor diagnostics and innovation': 'noor diagnostics and discovery',
  'eurofins clinical': 'eurofins clinical',
  'anwa medical company': 'anwaa medical company',
  'anwaa medical company': 'anwaa medical company',
  // Confirmed by KAMC: this lab is contracted under a different vendor name in
  // the master file. That vendor name is used ONLY to look up the country and
  // reference lab and is never displayed — the slide keeps the name below.
  // (Which reference lab, and where, comes from the ENCRYPTED catalogue: naming
  //  it here would put catalogue content into a public repo.)
  'genomics innovations limited company': 'pharmaceutical investments company',
  'saudi diagnostics limited company': 'saudi diagnostic limited co.',
  'saudi diagnostic limited co.': 'saudi diagnostic limited co.',
  // The orders carry the lab's trading name, the catalogue its company name.
  // Identity confirmed by the user 2026-09-29, after every one of its live orders
  // was found UNMAPPED with a test name matching exactly one of this vendor's
  // catalogue rows. The vendor is contracted in more than one country, so the
  // multi-country branch settles each order per test — and which countries those
  // are stays in the ENCRYPTED catalogue, never written into this public file.
  'genalive laboratories': 'genalive medical company',
};

/** How each lab is captioned. Proper names stay in their original Latin form. */
export const FACILITY_DISPLAY = {
  'advanced laboratory services .co': 'Advanced Laboratory Services',
  // The branch suffix is an address, not an identity — the slide names the lab.
  'advanced cell laboratory sulaimanih br': 'Advanced Cell Laboratory',
  'fal specialized medical lab': 'Fal Specialized Medical Lab',
  'king abdullaziz medical city in riyadh': 'King Abdulaziz Medical City - MNGHA',
  'noor diagnostics and innovation': 'Noor Diagnostics',
  'eurofins clinical': 'Eurofins Clinical',
  'anwa medical company': 'Anwa Medical Company',
  'anwaa medical company': 'Anwa Medical Company',
  'genomics innovations limited company': 'Genomics Innovations Limited Company',
  'saudi diagnostics limited company': 'Saudi Diagnostics Limited Company',
  'saudi diagnostic limited co.': 'Saudi Diagnostics Limited Company',
  'genalive laboratories': 'Genalive Laboratories',
};

/** Whitespace-collapsed, case-folded test name — THE test-name key: the catalogue
 *  match (per vendor and global alike) and engine/infer-facility.js's join key, so
 *  `support` below counts exactly the rows the inference counted. See UNSCOPED
 *  INVARIANT above for why it folds nothing more. */
const normTestName = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();

/** The table's OWN entry for a facility key, never an inherited one. The keys are
 *  lower-cased order data, so a lab typed 'Constructor' would otherwise read
 *  Object.prototype.constructor — a truthy non-string that ends up as a byLab caption
 *  and throws in the sort. */
const ownValue = (table, key) => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

/** orders / total as a one-decimal percentage. */
export const share = (n, total) => (total ? Math.round((1000 * n) / total) / 10 : 0);

// Lab+country+reflab triples are grouped by a composite key. The separator is a
// unit separator, NOT a space: lab and reference-lab names contain spaces, so a
// space-joined key cannot be split back apart.
const SEP = '\u001F';
const keyOf = (lab, country, reflab) => [lab, country, reflab].join(SEP);

// The GLOBAL index answers a test name only when the whole catalogue gives it ONE
// vendor, country and reference lab (the slide names the reference lab too). A
// name two rows answer differently is poisoned rather than first-wins: first-wins
// would let the workbook's row order pick a country, and a wrong country is worse
// than a missing row. The VENDOR counts even when two vendors agree on country and
// reference lab: the fallback's evidence is that the test name identifies the ONE
// contract the order ran under (and so the vendor its missing alias should name),
// and a name two vendors list identifies neither. Poisoned for good — a third row
// agreeing with one answer does not un-poison it.
const AMBIGUOUS = Symbol('ambiguous');

/**
 * Index the master two ways: per VENDOR (its distinct countries, and its per-test
 * rows for the multi-country split), and ONE GLOBAL test-name index over the whole
 * catalogue for the byTestName fallback.
 *
 * The per-vendor index stays FIRST-ROW-WINS, exactly as it was before the fallback
 * existed: it decides every order of a KNOWN vendor (aliased, or named like one) in
 * the full report, so changing it here would break the UNSCOPED INVARIANT. (One
 * vendor listing one test in two countries therefore lets row order pick — a known
 * limitation, for a change of its own that can be signed off as a move in the full
 * report; test/sendout.test.mjs pins it.)
 */
function indexMaster(master) {
  const byVendor = new Map();
  const global = new Map();
  for (const row of Array.isArray(master) ? master : []) {
    const v = norm(row && row.vendor);
    if (!v || !row.country) continue;
    let e = byVendor.get(v);
    if (!e) { e = { countries: new Map(), tests: new Map() }; byVendor.set(v, e); }
    const reflab = row.reflab || '';
    if (!e.countries.has(row.country)) e.countries.set(row.country, reflab);
    const t = normTestName(row.item);
    if (!t) continue;
    if (!e.tests.has(t)) e.tests.set(t, { country: row.country, reflab });
    const prev = global.get(t);
    if (prev === undefined) global.set(t, { vendor: v, country: row.country, reflab });
    else if (prev !== AMBIGUOUS
      && (prev.vendor !== v || prev.country !== row.country || prev.reflab !== reflab)) {
      global.set(t, AMBIGUOUS);
    }
  }
  return { byVendor, global };
}

/**
 * Attribute every non-cancelled order to a lab and a country.
 *
 * @param {Array<{facility?:string, testName?:string, rawStatus?:string, orderId?:string}>} orders
 * @param {Array} master the decrypted catalogue (ingest/sendout-master.js).
 *   Supplying an empty/missing catalogue leaves every order unmapped, so callers
 *   must skip the analysis entirely rather than pass nothing — see hasMaster().
 * @param {{inferBlanks?:boolean}} [opts] `inferBlanks: false` skips the blank-
 *   facility inference below — for rows whose facilities are ALREADY FINAL, i.e. a
 *   scoped report's (model/scope.js "SCOPED ROWS ARE FINAL"). Omitted = infer, as
 *   always, so the full report is analysed exactly as before.
 * @returns {{total, local, international, byCountry, byLab, inferred, byTestName,
 *   unmapped, unresolved}} the four buckets of the header comment; `inferred` is a
 *   disclosure list over the attributed ones, not a bucket of its own.
 */
export function analyseSendout(orders, master, opts) {
  const { byVendor, global } = indexMaster(master);
  const given = Array.isArray(orders) ? orders : [];

  // A blank performing facility is filled from the other orders of the SAME TEST,
  // using the SAME shared rule the engine applies (engine/infer-facility.js). One
  // implementation, so the compliance table and these slides can never disagree
  // about which lab an order belongs to. Ambiguous blanks are left blank and fall
  // through to `unmapped` below.
  //
  // inferBlanks === false skips it, as engine compute() does for the same flag, and
  // for the same ONE caller: a scoped report. applyScope already ran this rule over
  // the FULL row set, so a blank that reaches us is one the full report leaves
  // unattributed on purpose (its test runs at two labs). Re-run on a shipment or
  // date-range SUBSET holding only one of those labs' rows, it would look settled
  // and put the order in that lab's row and COUNTRY — which the full report never
  // does. Nothing is filled here then, so `inferred` comes back empty: it lists what
  // THIS pass filled, and the caller that settled the facilities owns disclosing them.
  const infer = !(opts && opts.inferBlanks === false);
  const filled = infer ? inferBlankFacilities(given) : new Map();
  const rows = filled.size
    ? given.map((r, i) => (filled.has(i) ? { ...r, facility: filled.get(i) } : r))
    : given;

  // STEP 1 - cancelled orders are out of every count and every percentage.
  const kept = rows.filter((o) => String((o && o.rawStatus) || '').trim() !== CANCELLED_STATUS);

  const resolved = [];
  const byTestName = [];
  const unmapped = [];
  const unresolved = [];
  // A lab with no FACILITY_DISPLAY caption (every byTestName lab, and a vendor known
  // only by its own name) is captioned with its first-seen spelling: 'X Lab' and
  // 'X LAB ' are one facility (one norm key) and must make ONE byLab row, not two.
  // Every ALIASED facility has a caption (test/sendout.test.mjs pins the pairing),
  // so none of them ever reaches this.
  const spelling = new Map();
  const captionOf = (key, facility) => {
    const shown = ownValue(FACILITY_DISPLAY, key);
    if (shown) return shown;
    if (!spelling.has(key)) spelling.set(key, String(facility).replace(/\s+/g, ' ').trim());
    return spelling.get(key);
  };

  for (const o of kept) {
    const key = norm(o && o.facility);
    // Still blank here means the inference above could NOT settle it (the test runs
    // at more than one lab, or the row carries no test name) — or, with inferBlanks
    // false, that the caller's full-set pass could not. Genuinely unattributable, so
    // it is reported, never guessed — and never sent to the test-name fallback: a
    // test the catalogue lists once names a CONTRACT, not which of the labs that run
    // the test in the data this order went to, and the order has no lab of its own
    // to caption it with.
    if (!key) { unmapped.push(o); continue; }
    // WHICH VENDOR IS THIS FACILITY? Its alias, when that reaches a catalogue vendor
    // — first, so every aliased facility is decided exactly as it always was, even
    // one whose own name is also some vendor's. Otherwise its OWN name, when that is
    // a catalogue vendor's: the name is the identity alias it would get (as the
    // 'eurofins clinical' entry above is), so it is looked up as THAT vendor —
    // single-country, or split on its own tests, a miss unresolved like any known
    // vendor's. Never the global index, where a test unique to ANOTHER vendor would
    // hand this one that vendor's country. A STALE alias (its vendor gone from the
    // catalogue) whose own name is a vendor is looked up by that name the same way.
    const alias = ownValue(FACILITY_TO_VENDOR, key);
    const entry = (alias && byVendor.get(alias)) || byVendor.get(key) || null;
    if (!entry) {
      // No vendor at all — no alias reaching one, and not a vendor's own name. The
      // TEST NAME is then the evidence, and it counts only if the whole catalogue
      // gives it ONE vendor, country and reference lab: a hit that unique identifies
      // the contract the order ran under. The lab keeps its OWN name — the vendor
      // finds the country, and is never displayed. A facility with only a STALE
      // alias lands here too: the alias names a catalogue spelling that is gone, so
      // it cannot say which of today's rows is the lab; the unique test name can (a
      // renamed vendor's rows are exactly what it finds), the same evidence any
      // unaliased lab is attributed on.
      const hit = global.get(normTestName(o && o.testName));
      if (!hit || hit === AMBIGUOUS) { unmapped.push(o); continue; }
      byTestName.push({ order: o, lab: captionOf(key, o.facility), country: hit.country, reflab: hit.reflab });
      continue;
    }

    const lab = captionOf(key, o.facility);
    if (entry.countries.size === 1) {
      const [country, reflab] = [...entry.countries.entries()][0];
      resolved.push({ order: o, lab, country, reflab });
    } else {
      // The country depends on the individual TEST, not the lab. Match on test
      // NAME, never on LOINC: the two files assign different codes to the same
      // test, some master cells hold several codes at once, and at least one
      // code exists in the master against a different test in another country -
      // a code match would send orders to the wrong country. Looked up in THIS
      // vendor's tests only: a name found under another vendor is not evidence
      // for a facility we already know, so a miss is unresolved, not re-routed.
      const hit = entry.tests.get(normTestName(o.testName));
      if (hit) resolved.push({ order: o, lab, country: hit.country, reflab: hit.reflab });
      else unresolved.push(o);
    }
  }

  // resolved FIRST: byLab's sort is stable, so with no byTestName orders every
  // table comes out in the order it did before that bucket existed.
  const attributed = resolved.concat(byTestName);
  const attributionOf = new Map(attributed.map((r) => [r.order, r]));

  // Report what the shared rule filled in, so a hole in the order data is visible
  // rather than silently papered over. These orders ARE on the slides — attributed
  // to the lab every other order of their test names — but the reader is told.
  const inferred = [];
  for (const [i, facility] of filled) {
    const o = rows[i];
    // Absent when cancelled (off every count) or filled but still unattributed.
    // A filled row is a fresh object, so identity cannot confuse two orders.
    const hit = attributionOf.get(o);
    if (!hit) continue;
    inferred.push({
      order: given[i],
      lab: hit.lab,
      country: hit.country,
      reflab: hit.reflab,
      support: given.filter((r, j) => j !== i
        && normTestName(r && r.testName) === normTestName(o && o.testName)
        && String((r && r.facility) || '').trim() !== '').length,
    });
  }

  const total = kept.length;
  const local = attributed.filter((r) => r.country === LOCAL_COUNTRY).length;

  const countryCounts = new Map();
  for (const r of attributed) countryCounts.set(r.country, (countryCounts.get(r.country) || 0) + 1);
  const byCountry = [...countryCounts.entries()]
    .map(([country, n]) => ({ country, orders: n }))
    .sort((a, b) => b.orders - a.orders || a.country.localeCompare(b.country));

  const labCounts = new Map();
  for (const r of attributed) {
    const k = keyOf(r.lab, r.country, r.reflab);
    const e = labCounts.get(k);
    if (e) e.orders += 1;
    else labCounts.set(k, { lab: r.lab, country: r.country, reflab: r.reflab, orders: 1 });
  }
  // Labs A->Z, and a single lab's country rows kept ADJACENT so they read as one lab.
  const byLab = [...labCounts.values()]
    .sort((a, b) => a.lab.localeCompare(b.lab) || a.country.localeCompare(b.country));

  return {
    total,
    local,
    international: attributed.length - local,
    byCountry,
    byLab,
    inferred,
    // [{ order, lab, country, reflab }] — ALSO inside local/international/byCountry/
    // byLab. Disclosed on review so the missing alias gets added; not a gap.
    byTestName,
    unmapped,
    unresolved,
  };
}

/** True when a catalogue is usable. Callers gate on this: with no catalogue every
 *  order would come back unmapped, which must omit the slides, not fill the
 *  review screen with a gap list naming every lab in the data. */
export function hasMaster(master) {
  return Array.isArray(master) && master.length > 0;
}

export default analyseSendout;
