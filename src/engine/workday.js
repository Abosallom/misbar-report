// engine/workday.js — pure date arithmetic for the KAMC report engine.
// No DOM, no locale, no timezone drift: everything is computed in UTC epoch-ms.
// Mirrors the exact Excel semantics used by the source workbook:
//   INT(datetime)  -> midnight of that calendar day
//   WORKDAY(start, n) -> add n business days, EXCLUDING the start day, skipping
//                        Sat/Sun, no holiday calendar.

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
 * Excel WORKDAY(start, days): count `days` business days forward from the start
 * DAY (start's time-of-day is dropped), excluding the start day itself and
 * skipping Saturdays/Sundays. Returns the resulting midnight epoch-ms.
 * Supports negative `days` symmetrically. `days === 0` returns the start day.
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
    if (dow !== 0 && dow !== 6) remaining--;
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
