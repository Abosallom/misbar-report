// engine/workday.js — pure date arithmetic for the KAMC report engine.
// No DOM, no locale, no timezone drift: everything is computed in UTC epoch-ms.
// Semantics:
//   INT(datetime)  -> midnight of that calendar day  (Excel INT, unchanged)
//   workday(start, n) -> add n business days, EXCLUDING the start day, skipping
//                        the SAUDI WEEKEND (Friday+Saturday), no holiday calendar.
//
// WEEKEND — DELIBERATE DIVERGENCE FROM EXCEL (stakeholder rule, Talal 2026-08-05).
// This function used to skip Sat+Sun because it was ported 1:1 from the source
// workbook's WORKDAY(), which runs on Excel's default US weekend. That was an
// Excel legacy artifact, not the business rule: KAMC's business days are
// Sunday–Thursday, so the weekend is FRIDAY+SATURDAY. The convention was
// replaced on 2026-08-05 on purpose. Do NOT "fix" it back.
//   CONSEQUENCE: the golden workbook oracle (test/fixtures/golden-orders.js
//   _cachedDue/_cachedDelay/_cachedStatus, test/fixtures/summary-tables.json)
//   still speaks the OLD Sat/Sun convention. It is an EXTERNAL oracle that
//   cannot be regenerated, so due-derived golden expectations are re-derived
//   engine-side; only non-due-derived fields are still checked against it.
//   Measured on the 628-row golden fixture: 189 due dates move.

export const MS_PER_DAY = 86400000;

/**
 * Parse a 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS' (or ISO 'T') string to UTC epoch-ms.
 * Returns null for null/''/unparseable. Accepts Date and finite numbers as pass-through.
 * @param {string|number|Date|null|undefined} s
 * @returns {number|null}
 */
export function parseDateTime(s) {
  if (s == null || s === '') return null;
  if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : s.getTime();
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const m = String(s).match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/**
 * Excel INT() on a datetime: floor to midnight of the same UTC calendar day.
 * @param {number|null} ms
 * @returns {number|null}
 */
export function toEpochDay(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * workday(start, days): count `days` business days forward from the start DAY
 * (start's time-of-day is dropped), excluding the start day itself and skipping
 * the SAUDI WEEKEND — Friday and Saturday. Business days are Sunday–Thursday.
 * Returns the resulting midnight epoch-ms. Supports negative `days`
 * symmetrically. `days === 0` returns the start day.
 *
 * This is Excel's WORKDAY() shape but NOT Excel's weekend: the workbook's
 * Sat/Sun convention was deliberately replaced by the real Saudi weekend on
 * 2026-08-05 (stakeholder rule) — see the file header. Reference table for
 * TAT = 2 business days under this rule:
 *   received Wed → due Sun (+4 cal. days, Fri/Sat skipped)
 *   received Thu → due Mon (+4 cal. days, Fri/Sat skipped)
 *   received Sat → due Mon (+2 cal. days; Sat is itself a weekend day, the
 *                           count simply starts from the next day forward)
 * @param {number} startMs  any epoch-ms (INT is applied internally)
 * @param {number} days     business-day offset
 * @returns {number}        midnight epoch-ms
 */
export function workday(startMs, days) {
  let d = toEpochDay(startMs);
  const step = days >= 0 ? MS_PER_DAY : -MS_PER_DAY;
  let remaining = Math.abs(Math.trunc(days));
  while (remaining > 0) {
    d += step;
    const dow = new Date(d).getUTCDay(); // 0=Sun … 6=Sat
    if (dow !== 5 && dow !== 6) remaining--; // skip Fri(5)+Sat(6) — Saudi weekend
  }
  return d;
}

/**
 * Whole-day difference between two midnight instants: (aMs - bMs) / DAY, rounded
 * to the nearest integer (defensive against any sub-ms noise). Used for Delay.
 * @param {number} aMs @param {number} bMs @returns {number}
 */
export function dayDiff(aMs, bMs) {
  return Math.round((aMs - bMs) / MS_PER_DAY);
}

/**
 * Signed fractional calendar-day span (aMs - bMs)/DAY, keeping time-of-day.
 * Used for turnaround (received → result) and expected (received → due) means.
 * @param {number} aMs @param {number} bMs @returns {number}
 */
export function calDaysBetween(aMs, bMs) {
  return (aMs - bMs) / MS_PER_DAY;
}

/**
 * 'YYYY-MM' month key for an epoch-ms instant (UTC).
 * @param {number|null} ms @returns {string|null}
 */
export function monthKey(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
