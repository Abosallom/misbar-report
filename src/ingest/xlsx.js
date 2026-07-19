// ingest/xlsx.js — parse the Misbar Project Tracker workbook and the TAT Lookup workbook.
// SheetJS (XLSX) is injected; never imported here (browser loads vendor/xlsx.mjs separately).

const S = (v) => (v == null ? '' : String(v).trim());

// Accept a browser ArrayBuffer, a Node Buffer, or a Uint8Array.
function toData(input) {
  if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  return input;
}

/**
 * Read a sheet as a 2-D string matrix plus its row metadata.
 * `startRow` is the absolute row offset of the used range (for '!rows' alignment).
 */
function readSheet(wb, XLSX, name) {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  return { rows, startRow: range.s.r, meta: ws['!rows'] || null };
}

const isEmptyRow = (row) => row.every((c) => S(c) === '');

/**
 * parseTracker(arrayBuffer, XLSX) -> TrackerModel
 * Sheets are selected by name (workbook sheet order varies).
 *   'سجل المهام'   header row 3 (idx 2), data idx 3+, cols A..G
 *   'سجل التحديات' header row 5 (idx 4), data idx 5+  -> challenges
 *   'سجل المخاطر'  header row 5 (idx 4), data idx 5+  -> risks
 * @returns {import('../contracts.js').TrackerModel & {_meta:{hiddenSupported:boolean, notes:string[]}}}
 */
export function parseTracker(arrayBuffer, XLSX) {
  const notes = [];
  const wb = XLSX.read(toData(arrayBuffer), { cellStyles: true });

  // ---- Tasks: 'سجل المهام' ----
  const tasks = [];
  let hiddenSupported = true;
  const t = readSheet(wb, XLSX, 'سجل المهام');
  if (!t) {
    notes.push("Sheet not found: 'سجل المهام'");
  } else {
    if (!t.meta) {
      hiddenSupported = false;
      notes.push("Hidden-row flags unavailable ('!rows' missing); hidden defaulted to false.");
    }
    for (let i = 3; i < t.rows.length; i++) {
      const row = t.rows[i].map(S);
      if (isEmptyRow(row)) continue; // skip fully-empty rows
      const metaRow = t.meta ? t.meta[t.startRow + i] : null;
      tasks.push({
        num: row[0] || null,
        task: row[1] || '',
        responsible: row[2] || '',
        owner: row[3] || '',
        dueDate: row[4] || '', // verbatim: may be 'يومي', 'غير محدد', a date, or a range
        status: row[5] || '',
        category: row[6] || '',
        hidden: metaRow ? !!metaRow.hidden : false,
      });
    }
  }

  // ---- Challenges: 'سجل التحديات' ----
  const challenges = [];
  const c = readSheet(wb, XLSX, 'سجل التحديات');
  if (!c) {
    notes.push("Sheet not found: 'سجل التحديات'");
  } else {
    for (let i = 5; i < c.rows.length; i++) {
      const row = c.rows[i].map(S);
      if (isEmptyRow(row)) continue;
      challenges.push({
        id: row[0] || '',
        title: row[1] || '',
        desc: row[2] || '',
        impact: row[3] || '',
        owner: row[4] || '',
        status: row[5] || '',
        solution: row[6] || '', // الاجراء الوقائي/الحل
      });
    }
  }

  // ---- Risks: 'سجل المخاطر' ----
  const risks = [];
  const rk = readSheet(wb, XLSX, 'سجل المخاطر');
  if (!rk) {
    notes.push("Sheet not found: 'سجل المخاطر'");
  } else {
    for (let i = 5; i < rk.rows.length; i++) {
      const row = rk.rows[i].map(S);
      if (isEmptyRow(row)) continue;
      risks.push({
        id: row[0] || '',
        title: row[1] || '',
        desc: row[2] || '',
        probability: row[3] || '',
        impact: row[4] || '',
        owner: row[5] || '',
        status: row[6] || '',
      });
    }
  }

  return { tasks, challenges, risks, _meta: { hiddenSupported, notes } };
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
