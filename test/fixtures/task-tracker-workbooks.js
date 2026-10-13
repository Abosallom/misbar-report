// test/fixtures/task-tracker-workbooks.js — SYNTHETIC MISBAR Task Tracker workbooks for
// the ingest tests, built in memory with the vendored SheetJS. Every task, owner and
// date here is invented: the user's real workbook is project data and is NEVER copied
// into the repo. The builders reproduce the real file's STRUCTURE and quirks instead:
//   • 'Hierarchical Tracker' — title row (merged), instruction row, a blank row, the
//     header on row 4, data from row 5; dates as serials with a date number format, as
//     day-first text ('17/9/2026'), as other text ('daily') or blank; rows hidden by a
//     table filter (ws['!rows'][r].hidden).
//   • 'Portfolio Tracker' — header on row 1; Portfolio Track / Milestone written on the
//     FIRST row of each group only; Status is an IFERROR(INDEX/MATCH) formula whose cached
//     value is the Hierarchical status or 'Not Found'.

export const H_HEADERS = [
  'WBS ID', 'Workstream', 'Work Package', 'Task / Deliverable', 'Task Type', 'Organization',
  'Owner', 'Priority', 'Status', 'Due Date', 'Predecessor', 'Next Action', 'Definition of Done', 'Notes',
];
export const P_HEADERS = [
  'Portfolio Track', 'Milestone', 'WBS ID', 'Work Package', 'Task / Deliverable', 'Task Type',
  'Organization', 'Owner', 'Priority', 'Status', 'Due Date',
];

/** Excel serial of a calendar date (1900 system), computed without any timezone. */
export function serial(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Excel serial of a calendar date in the 1904 date system (1462 days fewer). */
export function serial1904(isoDate) {
  return serial(isoDate) - 1462;
}

// Cell value helpers for the row arrays below.
/** A real Excel date: a serial number with the sheet's dd-mmm-yyyy format. */
export const D = (isoDate, z = 'dd\\-mmm\\-yyyy') => ({ date: isoDate, z });
/** A formula cell with a cached value (`cached` undefined = a file saved without one). */
export const F = (cached, formula = 'IFERROR(INDEX(\'Hierarchical Tracker\'!$I:$I,MATCH($C2,\'Hierarchical Tracker\'!$A:$A,0)),"Not Found")') => ({ formula, cached });

function toCell(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return { t: 's', v };
  if (typeof v === 'number') return { t: 'n', v };
  if (v.date) return { t: 'n', v: serial(v.date), z: v.z };
  if (v.formula) {
    if (v.cached === undefined) return { t: 's', f: v.formula };
    // A numeric cache is what Excel stores for INDEX() of an EMPTY cell (0).
    return { t: typeof v.cached === 'number' ? 'n' : 's', v: v.cached, f: v.formula };
  }
  throw new Error(`unknown fixture cell ${JSON.stringify(v)}`);
}

/** A worksheet from a row matrix of fixture values (null = no cell). */
export function sheetFrom(XLSX, rows, { hiddenRows = [], merges } = {}) {
  const ws = {};
  let maxC = 0;
  rows.forEach((row, r) => {
    (row || []).forEach((v, c) => {
      const cell = toCell(v);
      if (cell) ws[XLSX.utils.encode_cell({ r, c })] = cell;
      maxC = Math.max(maxC, c);
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: maxC } });
  if (hiddenRows.length) {
    ws['!rows'] = [];
    for (const r of hiddenRows) ws['!rows'][r] = { hidden: true };
  }
  if (merges) ws['!merges'] = merges;
  return ws;
}

/**
 * The Hierarchical sheet: 3 decoration rows, the header on row 4, then `data` (14-column
 * rows in H_HEADERS order). `hidden` = indexes INTO `data` of rows hidden by the filter.
 */
export function hierarchicalSheet(XLSX, data, { hidden = [], headers = H_HEADERS, titleRows = 3 } = {}) {
  const deco = [
    ['Synthetic Hierarchical Project Task Tracker'],
    ['Use dropdown selections for controlled fields. (synthetic instruction row)'],
    [],
  ].slice(0, titleRows);
  while (deco.length < titleRows) deco.push([]);
  const rows = [...deco, headers, ...data];
  return sheetFrom(XLSX, rows, {
    hiddenRows: hidden.map((i) => i + titleRows + 1),
    merges: titleRows >= 2 ? [{ s: { r: 0, c: 0 }, e: { r: 0, c: 13 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 13 } }] : undefined,
  });
}

/** The Portfolio sheet: header on row 1, then `data` (11-column rows in P_HEADERS order). */
export function portfolioSheet(XLSX, data, { headers = P_HEADERS } = {}) {
  return sheetFrom(XLSX, [headers, ...data]);
}

/**
 * Write a workbook of [name, worksheet] pairs to xlsx bytes (Uint8Array).
 * `date1904` saves it in the 1904 date system (an old Mac Excel option); date cells must
 * then hold 1904 serials (serial1904 below).
 */
export function workbookBytes(XLSX, sheets, { date1904 = false } = {}) {
  const wb = XLSX.utils.book_new();
  if (date1904) wb.Workbook = { WBProps: { date1904: true } };
  for (const [name, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, name);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

// ---- the standard synthetic tracker ----------------------------------------------------
// Hierarchical rows (H_HEADERS order). Index 0 and 4 are hidden by the "filter".
export const H_ROWS = [
  ['1.1.1', 'Executive Stream', 'Steering Package', 'Set up the synthetic steering group', 'Decision / Approval', 'ORG-A', 'Owner One', 'Critical', 'In Progress', D('2026-09-01'), '', '', '', ''],
  ['1.2.1', 'Executive Stream', 'Alignment Package', 'Hold the synthetic alignment meeting', 'Milestone', 'ORG-A / ORG-B', 'Owner Two', 'High', 'Completed', '17/9/2026', '1.1.1', 'Send minutes', 'Minutes approved', 'Line one\nLine two'],
  ['2.1.1', 'Delivery Stream', 'Framework Package', 'Finalize the synthetic framework', 'Deliverable', 'ORG-B', 'Owner Three', 'Critical', 'Deleyed', 'daily', '1.2.1', '', '', ''],
  ['2.1.2', 'Delivery Stream', 'Cutover Package', '  Synthetic   go-live  ', 'Milestone', 'ORG-A / ORG-B', 'Owner One / Owner Two', 'Critical', 'Blocked', null, '2.1.1', '', '', ''],
  ['2.2.1', 'Delivery Stream', 'Integration Package', 'Integrate the synthetic system', 'Integration', 'ORG-A', 'Owner Four', 'Medium', 'Completed', '14/9/2026', '', '', '', ''],
  ['3.1.1', 'Operations Stream', 'Readiness Package', 'Only in the hierarchical sheet', 'Recurring Activity', 'ORG-B', 'Owner Five', 'Low', 'Not Started', D('2026-10-30'), '', '', '', ''],
];
export const H_HIDDEN = [0, 4];

// Portfolio rows (P_HEADERS order). Track / milestone on group starts only; Status is a
// formula with a cached value. 9.9.9 and 4.4.4 exist ONLY here.
export const P_ROWS = [
  ['Track A', 'Milestone One', '2.1.1', 'Framework Package', 'Finalize the synthetic framework', 'Deliverable', 'ORG-B', 'Owner Three', 'Critical', F('Deleyed'), 'daily'],
  [null, null, '1.2.1', 'Alignment Package', 'Hold the synthetic alignment meeting', 'Milestone', 'ORG-A / ORG-B', 'Owner Two', 'High', F('Completed'), '17/9/2026'],
  [null, 'Milestone Two', '1.1.1', 'Steering Package', 'Set up the synthetic steering group', 'Decision / Approval', 'ORG-A', 'Owner One', 'Critical', F('In Progress'), D('2026-09-01', 'yyyy\\-mm\\-dd\\ h:mm:ss')],
  ['Track B', 'Milestone Three', '2.1.2', 'Cutover Package', 'Approve the synthetic go-live and cut over', 'Milestone', 'ORG-A / ORG-B', 'Owner One / Owner Two', 'Critical', F('Blocked'), null],
  [null, null, '9.9.9', 'Portfolio Package', 'Only in the portfolio sheet', 'Deliverable', 'ORG-B', 'Owner Six', 'High', F('Not Found'), D('2026-09-06')],
  [null, null, '2.2.1', 'Integration Package', 'Integrate the synthetic system', 'Integration', 'ORG-A', 'Owner Four', 'Medium', F('Completed'), D('2026-09-06')],
  ['Track C', null, '4.4.4', 'Other Package', 'Portfolio-only with a cached status', 'Deliverable', 'ORG-A', 'Owner Seven', 'Medium', F('In Progress'), null],
];

/** The standard two-sheet synthetic tracker (Hierarchical first, as in the real file). */
export function standardTrackerBytes(XLSX, { hRows = H_ROWS, pRows = P_ROWS, hidden = H_HIDDEN } = {}) {
  return workbookBytes(XLSX, [
    ['Hierarchical Tracker', hierarchicalSheet(XLSX, hRows, { hidden })],
    ['Portfolio Tracker', portfolioSheet(XLSX, pRows)],
  ]);
}

/** The RETIRED tracker's shape: Arabic sheet names, Arabic headers. */
export function oldFormatBytes(XLSX) {
  return workbookBytes(XLSX, [
    ['سجل المهام', sheetFrom(XLSX, [['سجل المهام'], [], ['#', 'المهمة', 'المسؤول', 'المالك', 'تاريخ الإكتمال', 'الحالة', 'الفئة'], [1, 'مهمة تجريبية', 'لين', 'مالك', '01-09-2026', 'مفتوح', 'لين']])],
    ['سجل التحديات', sheetFrom(XLSX, [['x']])],
    ['سجل المخاطر', sheetFrom(XLSX, [['x']])],
  ]);
}

/** A workbook that is neither tracker (e.g. the TAT Lookup file dropped in the wrong zone). */
export function unrelatedBytes(XLSX) {
  return workbookBytes(XLSX, [
    ['TAT Lookup', sheetFrom(XLSX, [['Test', 'Days'], ['Synthetic Test A', 3], ['Synthetic Test B', 5]])],
  ]);
}
