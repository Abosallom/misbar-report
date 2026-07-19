// engine/dedupe.js — collapse duplicate order-lines that can appear when a KAMC
// export is re-run and concatenated. Pure; safe to run before compute().
//
// Grain = one test on one order line. The natural identity key is orderId+lineNo
// (lineNo already embeds the order id, e.g. "00990000000463:1"), falling back to
// orderId+testName when lineNo is absent. When two rows share a key, we keep the
// MOST-PROGRESSED one (latest through the received→resulted funnel) so a stale
// earlier export never masks a newer result.

/**
 * Default identity key for an order line.
 * @param {import('../contracts.js').OrderRow} r @returns {string}
 */
export function defaultKey(r) {
  // Workbook line ids are stable strings that embed the order id ("…463:1").
  // The daily CSV has no line id — ingest fills a positional row index (a plain
  // number), which would make every row globally unique and defeat dedupe across
  // concatenated re-exports. Positional (purely numeric) lineNos are ignored.
  const raw = r.lineNo;
  const stable = raw != null && raw !== '' && !/^\d+$/.test(String(raw));
  const line = stable ? String(raw) : '';
  return `${r.orderId ?? ''}||${line || `t:${r.testName ?? ''}`}`;
}

// How "far" a row has progressed — higher wins when deduping a collision.
function progress(r) {
  let p = 0;
  if (r.orderDate) p++;
  if (r.collected) p++;
  if (r.dispatched) p++;
  if (r.received) p++;
  if (r.resulted) p++;
  // A terminal status (resulted / rejected / cancelled) outranks an in-flight one.
  if (r.rawStatus && /Approved|Rejected|Cancelled/i.test(r.rawStatus)) p += 0.5;
  return p;
}

/**
 * Remove duplicate order-lines, keeping the most-progressed row per key and
 * preserving first-seen order. Returns a new array; input is not mutated.
 * @param {import('../contracts.js').OrderRow[]} rows
 * @param {(r:import('../contracts.js').OrderRow)=>string} [keyFn]
 * @returns {import('../contracts.js').OrderRow[]}
 */
export function dedupeRows(rows, keyFn = defaultKey) {
  const bestAt = new Map(); // key -> index into `out`
  const out = [];
  for (const r of rows) {
    const k = keyFn(r);
    if (!bestAt.has(k)) {
      bestAt.set(k, out.length);
      out.push(r);
    } else {
      const i = bestAt.get(k);
      if (progress(r) > progress(out[i])) out[i] = r; // keep slot, upgrade content
    }
  }
  return out;
}
