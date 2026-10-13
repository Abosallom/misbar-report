// ingest/xlsx.js — parse the TAT Lookup workbook.
// SheetJS (XLSX) is injected; never imported here (browser loads vendor/xlsx.mjs separately).
// The OLD Project Tracker parser (parseTracker: Arabic sheets سجل المهام / سجل التحديات /
// سجل المخاطر) lived here until 2026-10-13. That format is retired; the «ملف متابعة
// المشروع» zone now takes the MISBAR Task Tracker, parsed by ingest/task-tracker.js
// parseTaskTracker, which REJECTS the old file with an Arabic message.

const S = (v) => (v == null ? '' : String(v).trim());

// Accept a browser ArrayBuffer, a Node Buffer, or a Uint8Array.
function toData(input) {
  if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  return input;
}

/**
 * parseTatLookupXlsx(arrayBuffer, XLSX) -> {tests: {name: days}, count}
 * Accepts either a workbook that contains a sheet named 'TAT Lookup', or a
 * single-sheet file with the same positional layout (A=name, B=days, data rows 2+,
 * blank/decorative header row 1). All other sheets are ignored.
 */
export function parseTatLookupXlsx(arrayBuffer, XLSX) {
  const wb = XLSX.read(toData(arrayBuffer), { cellStyles: false });
  const sheetName = wb.SheetNames.includes('TAT Lookup') ? 'TAT Lookup' : wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : null;

  const tests = {};
  let count = 0;
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    for (let i = 1; i < rows.length; i++) {
      // data rows 2+ (skip the essentially-blank header row at index 0)
      const name = S(rows[i][0]);
      if (!name) continue;
      const days = parseInt(S(rows[i][1]), 10);
      tests[name] = Number.isNaN(days) ? null : days;
      count++;
    }
  }
  return { tests, count };
}
