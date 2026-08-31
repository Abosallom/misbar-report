// model/sendout.js — where KAMC's send-out tests are actually PERFORMED.
//
// Answers two questions for the deck: how many tests ran inside Saudi Arabia vs
// abroad, and which lab in which country ran them.
//
// ⚠ 'Local' means the test was physically PERFORMED in Saudi Arabia. It does NOT
// mean KAMC ordered it from a Saudi company — many Saudi vendors are local
// agents who ship the specimen abroad, and those orders are INTERNATIONAL. Only
// seeds/sendout-master.js (the ops workbook) can make that call.
//
import { inferBlankFacilities } from '../engine/infer-facility.js?v=v2026-08-31.5';

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
};

/** How each lab is captioned. Proper names stay in their original Latin form. */
export const FACILITY_DISPLAY = {
  'advanced laboratory services .co': 'Advanced Laboratory Services',
  'fal specialized medical lab': 'Fal Specialized Medical Lab',
  'king abdullaziz medical city in riyadh': 'King Abdulaziz Medical City - MNGHA',
  'noor diagnostics and innovation': 'Noor Diagnostics',
  'eurofins clinical': 'Eurofins Clinical',
  'anwa medical company': 'Anwa Medical Company',
  'anwaa medical company': 'Anwa Medical Company',
  'genomics innovations limited company': 'Genomics Innovations Limited Company',
  'saudi diagnostics limited company': 'Saudi Diagnostics Limited Company',
  'saudi diagnostic limited co.': 'Saudi Diagnostics Limited Company',
};

const normTestName = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();

/** orders / total as a one-decimal percentage. */
export const share = (n, total) => (total ? Math.round((1000 * n) / total) / 10 : 0);

// Lab+country+reflab triples are grouped by a composite key. The separator is a
// unit separator, NOT a space: lab and reference-lab names contain spaces, so a
// space-joined key cannot be split back apart.
const SEP = '\u001F';
const keyOf = (lab, country, reflab) => [lab, country, reflab].join(SEP);

/** Index the master by vendor: its distinct countries, and its per-test rows. */
function indexMaster(master) {
  const byVendor = new Map();
  for (const row of master || []) {
    const v = norm(row && row.vendor);
    if (!v || !row.country) continue;
    let e = byVendor.get(v);
    if (!e) { e = { countries: new Map(), tests: new Map() }; byVendor.set(v, e); }
    if (!e.countries.has(row.country)) e.countries.set(row.country, row.reflab || '');
    const t = normTestName(row.item);
    if (t && !e.tests.has(t)) e.tests.set(t, { country: row.country, reflab: row.reflab || '' });
  }
  return byVendor;
}

/**
 * Attribute every non-cancelled order to a lab and a country.
 *
 * @param {Array<{facility?:string, testName?:string, rawStatus?:string, orderId?:string}>} orders
 * @param {Array} master the decrypted catalogue (ingest/sendout-master.js).
 *   Supplying an empty/missing catalogue leaves every order unmapped, so callers
 *   must skip the analysis entirely rather than pass nothing — see hasMaster().
 */
export function analyseSendout(orders, master) {
  const byVendor = indexMaster(master);
  const given = Array.isArray(orders) ? orders : [];

  // A blank performing facility is filled from the other orders of the SAME TEST,
  // using the SAME shared rule the engine applies (engine/infer-facility.js). One
  // implementation, so the compliance table and these slides can never disagree
  // about which lab an order belongs to. Ambiguous blanks are left blank and fall
  // through to `unmapped` below.
  const filled = inferBlankFacilities(given);
  const rows = filled.size
    ? given.map((r, i) => (filled.has(i) ? { ...r, facility: filled.get(i) } : r))
    : given;

  // STEP 1 - cancelled orders are out of every count and every percentage.
  const kept = rows.filter((o) => String((o && o.rawStatus) || '').trim() !== CANCELLED_STATUS);

  const resolved = [];
  const unmapped = [];
  const unresolved = [];

  for (const o of kept) {
    const key = norm(o && o.facility);
    // Still blank here means the inference above could NOT settle it (the test runs
    // at more than one lab, or the row carries no test name). Genuinely
    // unattributable, so it is reported, never guessed.
    if (!key) { unmapped.push(o); continue; }
    const vkey = FACILITY_TO_VENDOR[key];
    const entry = vkey ? byVendor.get(vkey) : null;
    if (!entry) { unmapped.push(o); continue; }

    const lab = FACILITY_DISPLAY[key] || String(o.facility);
    if (entry.countries.size === 1) {
      const [country, reflab] = [...entry.countries.entries()][0];
      resolved.push({ order: o, lab, country, reflab });
    } else {
      // The country depends on the individual TEST, not the lab. Match on test
      // NAME, never on LOINC: the two files assign different codes to the same
      // test, some master cells hold several codes at once, and at least one
      // code exists in the master against a different test in another country -
      // a code match would send orders to the wrong country.
      const hit = entry.tests.get(normTestName(o.testName));
      if (hit) resolved.push({ order: o, lab, country: hit.country, reflab: hit.reflab });
      else unresolved.push(o);
    }
  }

  // Report what the shared rule filled in, so a hole in the order data is visible
  // rather than silently papered over. These orders ARE on the slides — attributed
  // to the lab every other order of their test names — but the reader is told.
  const inferred = [];
  for (const [i, facility] of filled) {
    const o = rows[i];
    if (!kept.includes(o)) continue;                 // cancelled: off every count
    const hit = resolved.find((r) => r.order === o);
    if (!hit) continue;                              // filled, but still unmapped
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
  const local = resolved.filter((r) => r.country === LOCAL_COUNTRY).length;

  const countryCounts = new Map();
  for (const r of resolved) countryCounts.set(r.country, (countryCounts.get(r.country) || 0) + 1);
  const byCountry = [...countryCounts.entries()]
    .map(([country, n]) => ({ country, orders: n }))
    .sort((a, b) => b.orders - a.orders || a.country.localeCompare(b.country));

  const labCounts = new Map();
  for (const r of resolved) {
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
    international: resolved.length - local,
    byCountry,
    byLab,
    inferred,
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
