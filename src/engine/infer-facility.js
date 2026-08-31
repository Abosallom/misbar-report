// engine/infer-facility.js — fill in a MISSING performing facility from the rest
// of the data, so one order record with a hole does not become a phantom lab.
//
// THE PROBLEM. A handful of order lines reach the export with no 'Performing
// facility name' at all — not an unrecognised lab, just an empty field, usually
// because the order was confirmed before a lab was assigned and never progressed.
// Every surface then invented its own answer for it: the compliance table grouped
// it under 'غير محدد' as though it were a real lab, while the send-out slides
// carried it as an unattributed order. One order, two different fictions, and a
// lab's own row short by one on the slide people read.
//
// THE RULE. A blank facility takes the facility of the OTHER orders of the SAME
// TEST — and only when every one of them names a single lab. If that test runs at
// two or more labs the inference would be a coin flip, so the row keeps its blank
// and stays visible as unattributed. One unattributed order is a far smaller
// problem than one silently credited to the wrong lab.
//
// AN UNRECOGNISED NAME IS NEVER TOUCHED. Only a genuinely EMPTY field is filled.
// A facility that is spelled in a way nothing recognises is a different failure —
// a gap in the reference data — and must stay visible so it gets fixed at source.
//
// PURE: no DOM, no clock, no I/O. Deterministic in the row order it is given.

/** Whitespace-collapsed, case-folded test name — the join key. */
const normTestName = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();

/** A facility is "present" only if it has non-whitespace content. */
const hasFacility = (row) => String((row && row.facility) || '').trim() !== '';

/**
 * Decide a facility for every row whose own facility is blank.
 *
 * @param {Array<{facility?:string|null, testName?:string}>} rows
 * @returns {Map<number, string>} row INDEX -> inferred facility. Empty when there
 *   is nothing to infer, so callers can skip the copy entirely.
 */
export function inferBlankFacilities(rows) {
  const out = new Map();
  const list = Array.isArray(rows) ? rows : [];

  // Which labs does each test name appear under, among rows that DO name one?
  const labsByTest = new Map();
  for (const r of list) {
    if (!hasFacility(r)) continue;
    const t = normTestName(r && r.testName);
    if (!t) continue;
    let set = labsByTest.get(t);
    if (!set) { set = new Set(); labsByTest.set(t, set); }
    set.add(String(r.facility).trim());
  }

  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (hasFacility(r)) continue;
    const t = normTestName(r && r.testName);
    if (!t) continue;                       // no test name either: nothing to go on
    const labs = labsByTest.get(t);
    if (labs && labs.size === 1) out.set(i, [...labs][0]);
  }
  return out;
}

/**
 * `rows` with every confidently-inferable blank facility filled in.
 *
 * Returns the SAME array reference when nothing needed filling, so the common case
 * costs nothing; otherwise a shallow copy with only the affected rows replaced —
 * the input is never mutated, because callers share these row objects.
 *
 * @param {Array} rows
 * @returns {Array}
 */
export function fillBlankFacilities(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const inferred = inferBlankFacilities(list);
  if (!inferred.size) return rows;
  return list.map((r, i) => (inferred.has(i) ? { ...r, facility: inferred.get(i) } : r));
}

export default fillBlankFacilities;
