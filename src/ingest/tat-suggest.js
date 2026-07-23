// ingest/tat-suggest.js — analytical TAT suggestions for tests missing from the
// TAT lookup. Pure module: no DOM, no side effects. Given the set of unmatched
// test names plus the observed order rows, it proposes a standard TAT for each,
// mirroring the workbook's C6 "auto-add" heuristics and falling back to evidence
// mined from the data itself.
//
// suggestTats({ unmatched, rows, tatLookup, tatLoinc }) -> Array<Suggestion>
//   one entry per unmatched test, SAME ORDER as `unmatched`.
//   Suggestion = { testName, suggested:number|null,
//                  source:'loinc'|'csv'|'similar'|'observed'|null,
//                  confidence:'high'|'medium'|'low'|null, evidence:string }
//
// Rule precedence (first hit wins):
//   1. LOINC    (high)   — a row of this test carries a LOINC code that exactly
//                          matches a lookup entry's code -> that entry's TAT.
//   2. CSV      (high)   — mode of this test's non-null "TAT - Days" CSV values.
//   3. SIMILAR  (medium) — token-set (Jaccard) match to a lookup name, score>=0.5.
//   4. OBSERVED (low)    — median actual (resulted-received) calendar days, ceil>=1.
//   5. none              — insufficient data.

import { normTest } from '../contracts.js?v=v2026-07-22.12';

const MS_PER_DAY = 86400000;
const SIMILARITY_THRESHOLD = 0.5;

/** Parse 'YYYY-MM-DD' / 'YYYY-MM-DD HH:MM:SS' / ISO to UTC epoch-ms; null if unparseable. */
function parseDate(s) {
  if (s == null || s === '') return null;
  if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : s.getTime();
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/** Normalize a test name into a token Set: uppercase, drop leading 'SEND OUT TEST',
 *  split on non-alphanumerics, drop tokens shorter than 3 chars. */
function tokenize(name) {
  const up = String(name == null ? '' : name).toUpperCase().replace(/^\s*SEND OUT TEST\s*/, '');
  const set = new Set();
  for (const tok of up.split(/[^A-Z0-9]+/)) if (tok.length >= 3) set.add(tok);
  return set;
}

/** Jaccard similarity of two token Sets; 0 when either is empty. */
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Most frequent value; ties broken by first appearance. Returns {value, count} or null. */
function mode(values) {
  const counts = new Map();
  const order = [];
  for (const v of values) {
    if (!counts.has(v)) { counts.set(v, 0); order.push(v); }
    counts.set(v, counts.get(v) + 1);
  }
  let best = null;
  for (const v of order) if (best === null || counts.get(v) > counts.get(best)) best = v;
  return best === null ? null : { value: best, count: counts.get(best) };
}

/** Median of a numeric array (assumes non-empty). */
function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param {{ unmatched:string[], rows:import('../contracts.js').OrderRow[],
 *           tatLookup:Object<string,number>, tatLoinc:Object<string,string> }} args
 * @returns {{testName:string, suggested:number|null,
 *            source:'loinc'|'csv'|'similar'|'observed'|null,
 *            confidence:'high'|'medium'|'low'|null, evidence:string}[]}
 */
export function suggestTats({ unmatched, rows, tatLookup, tatLoinc } = {}) {
  const unm = Array.isArray(unmatched) ? unmatched : [];
  const allRows = Array.isArray(rows) ? rows : [];
  const lookup = tatLookup || {};
  const loincMap = tatLoinc || {};

  // Invert tatLoinc once: LOINC code -> lookup name (that also has a TAT).
  const codeToName = new Map();
  for (const [lookupName, code] of Object.entries(loincMap)) {
    if (code != null && code !== '' && lookup[lookupName] != null) {
      if (!codeToName.has(code)) codeToName.set(code, lookupName);
    }
  }

  // Group order rows by normalized test name once.
  const rowsByTest = new Map();
  for (const r of allRows) {
    const key = normTest(r && r.testName);
    if (!rowsByTest.has(key)) rowsByTest.set(key, []);
    rowsByTest.get(key).push(r);
  }

  // Pre-tokenize lookup names for the similarity pass.
  const lookupTokens = Object.keys(lookup).map((name) => ({ name, tokens: tokenize(name), tat: lookup[name] }));

  const NONE = { suggested: null, source: null, confidence: null, evidence: 'لا توجد بيانات كافية للاقتراح' };

  return unm.map((testName) => {
    const testRows = rowsByTest.get(normTest(testName)) || [];

    // --- Rule 1: LOINC ---
    for (const r of testRows) {
      const code = r && r.loinc;
      if (code != null && code !== '' && codeToName.has(code)) {
        const matchedName = codeToName.get(code);
        const n = lookup[matchedName];
        return {
          testName, suggested: n, source: 'loinc', confidence: 'high',
          evidence: `يطابق برمز LOINC ${code} فحص «${matchedName}» (TAT ${n})`,
        };
      }
    }

    // --- Rule 2: CSV (mode of TAT - Days) ---
    const csvVals = testRows.map((r) => r && r.tatDaysCsv).filter((v) => v != null && Number.isFinite(v));
    if (csvVals.length) {
      const m = mode(csvVals);
      return {
        testName, suggested: m.value, source: 'csv', confidence: 'high',
        evidence: `القيمة الواردة في عمود TAT بملف البيانات (${csvVals.length} سطراً)`,
      };
    }

    // --- Rule 3: SIMILAR (token-set Jaccard) ---
    const myTokens = tokenize(testName);
    let bestSim = null;
    for (const cand of lookupTokens) {
      const score = jaccard(myTokens, cand.tokens);
      if (bestSim === null || score > bestSim.score) bestSim = { score, name: cand.name, tat: cand.tat };
    }
    if (bestSim && bestSim.score >= SIMILARITY_THRESHOLD) {
      const pct = Math.round(bestSim.score * 100);
      return {
        testName, suggested: bestSim.tat, source: 'similar', confidence: 'medium',
        evidence: `مشابه لفحص «${bestSim.name}» (TAT ${bestSim.tat}، تشابه ${pct}%)`,
      };
    }

    // --- Rule 4: OBSERVED (median actual calendar days) ---
    const spans = [];
    for (const r of testRows) {
      const rec = parseDate(r && r.received);
      const res = parseDate(r && r.resulted);
      if (rec != null && res != null) spans.push((res - rec) / MS_PER_DAY);
    }
    if (spans.length) {
      const d = Math.max(1, Math.ceil(median(spans)));
      return {
        testName, suggested: d, source: 'observed', confidence: 'low',
        evidence: `متوسط زمن الإنجاز الفعلي المرصود ≈ ${d} أيام (${spans.length} نتيجة)`,
      };
    }

    // --- Rule 5: none ---
    return { testName, ...NONE };
  });
}
