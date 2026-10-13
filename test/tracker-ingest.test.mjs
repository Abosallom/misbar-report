// test/tracker-ingest.test.mjs — ingest/task-tracker.js parseTaskTracker and the
// ProjectTracker document helpers. Run: node --test
// SYNTHETIC workbooks only (test/fixtures/task-tracker-workbooks.js), written and read
// back through the vendored SheetJS exactly as the browser reads an upload — the user's
// real tracker is project data and never enters the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as XLSX from '../vendor/xlsx.mjs';
import {
  parseTaskTracker, normalizeProjectTracker, isProjectTracker, newTask, normalizeDueText,
  TRACKER_FORMAT, TASK_FIELDS,
} from '../src/ingest/task-tracker.js';
import {
  standardTrackerBytes, oldFormatBytes, unrelatedBytes, workbookBytes, hierarchicalSheet,
  portfolioSheet, sheetFrom, H_ROWS, P_ROWS, H_HEADERS, P_HEADERS, D, F, serial1904,
} from './fixtures/task-tracker-workbooks.js';

const NOW = '2026-10-13T08:00:00.000Z';
const parse = (bytes, opts = {}) => parseTaskTracker(bytes, XLSX, { now: NOW, ...opts });
const byWbs = (tr) => Object.fromEntries(tr.tasks.map((t) => [t.wbs, t]));

test('two-sheet tracker: Portfolio order, then Hierarchical-only rows appended', () => {
  const tr = parse(standardTrackerBytes(XLSX), { fileName: 'tracker.xlsx' });
  assert.deepEqual(
    tr.tasks.map((t) => t.wbs),
    ['2.1.1', '1.2.1', '1.1.1', '2.1.2', '9.9.9', '2.2.1', '4.4.4', '3.1.1'],
    'Portfolio order (the slide order), the Hierarchical-only 3.1.1 last',
  );
  // The document envelope.
  assert.equal(tr.format, TRACKER_FORMAT);
  assert.equal(tr.fileName, 'tracker.xlsx');
  assert.equal(tr.loadedAt, NOW);
  assert.equal(tr.editedAt, null, 'a fresh parse carries no web edits');
  assert.ok(isProjectTracker(tr));
});

test('every task has exactly the documented fields, all strings, and unique ids', () => {
  const tr = parse(standardTrackerBytes(XLSX));
  for (const t of tr.tasks) {
    assert.deepEqual(Object.keys(t).sort(), [...TASK_FIELDS].sort(), `fields of ${t.wbs}`);
    for (const f of TASK_FIELDS) assert.equal(typeof t[f], 'string', `${t.wbs}.${f} is a string`);
  }
  assert.deepEqual(tr.tasks.map((t) => t.id), tr.tasks.map((t) => t.wbs), 'unique WBS → id = WBS');
  // JSON-safe: survives a serialize round-trip unchanged (it is cached in localStorage).
  assert.deepEqual(JSON.parse(JSON.stringify(tr)), tr);
  // The envelope has exactly the documented keys too.
  assert.deepEqual(Object.keys(tr).sort(), ['editedAt', 'fileName', 'format', 'loadedAt', 'tasks', 'warnings']);
});

test('Portfolio track / milestone are filled DOWN from each group\'s first row', () => {
  const t = byWbs(parse(standardTrackerBytes(XLSX)));
  assert.deepEqual([t['2.1.1'].track, t['2.1.1'].milestone], ['Track A', 'Milestone One']);
  assert.deepEqual([t['1.2.1'].track, t['1.2.1'].milestone], ['Track A', 'Milestone One'], 'both blank → filled');
  assert.deepEqual([t['1.1.1'].track, t['1.1.1'].milestone], ['Track A', 'Milestone Two'], 'new milestone, same track');
  assert.deepEqual([t['2.1.2'].track, t['2.1.2'].milestone], ['Track B', 'Milestone Three']);
  assert.deepEqual([t['9.9.9'].track, t['9.9.9'].milestone], ['Track B', 'Milestone Three']);
  assert.deepEqual([t['2.2.1'].track, t['2.2.1'].milestone], ['Track B', 'Milestone Three']);
  // A NEW track with no milestone of its own must not inherit the previous track's.
  assert.deepEqual([t['4.4.4'].track, t['4.4.4'].milestone], ['Track C', '']);
  // Hierarchical-only rows have no grouping.
  assert.deepEqual([t['3.1.1'].track, t['3.1.1'].milestone], ['', '']);
});

test('statuses: Hierarchical is authoritative, words kept verbatim, cached formula values', () => {
  const t = byWbs(parse(standardTrackerBytes(XLSX)));
  assert.equal(t['2.1.1'].status, 'Deleyed', 'the file\'s misspelling is data — kept verbatim');
  assert.equal(t['1.2.1'].status, 'Completed');
  assert.equal(t['1.1.1'].status, 'In Progress');
  assert.equal(t['2.1.2'].status, 'Blocked');
  assert.equal(t['3.1.1'].status, 'Not Started');
  // Portfolio-only rows: the formula's cached value, except the 'Not Found' sentinel.
  assert.equal(t['9.9.9'].status, '', "'Not Found' means no Hierarchical row — never a status");
  assert.equal(t['4.4.4'].status, 'In Progress', 'a real cached status is kept');
});

test('due dates: serials → ISO, day-first text → ISO, other text verbatim, blank → empty', () => {
  const t = byWbs(parse(standardTrackerBytes(XLSX)));
  assert.equal(t['1.1.1'].due, '2026-09-01', 'serial with a date format (and the other sheet\'s datetime format agrees)');
  assert.equal(t['1.2.1'].due, '2026-09-17', "'17/9/2026' is DAY-first");
  assert.equal(t['2.1.1'].due, 'daily', 'non-date text kept as typed');
  assert.equal(t['2.1.2'].due, '', 'blank in both sheets');
  assert.equal(t['2.2.1'].due, '2026-09-14', 'Hierarchical text date wins over the Portfolio serial');
  assert.equal(t['9.9.9'].due, '2026-09-06', 'Portfolio-only row: its own serial');
  assert.equal(t['3.1.1'].due, '2026-10-30');
});

test('date serials convert identically in every timezone (no Date / local-midnight shift)', () => {
  const bytes = standardTrackerBytes(XLSX);
  const before = process.env.TZ;
  const dues = [];
  try {
    for (const tz of ['Asia/Riyadh', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
      process.env.TZ = tz;
      dues.push(JSON.stringify(parse(bytes).tasks.map((t) => t.due)));
    }
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
  assert.equal(new Set(dues).size, 1, `same dates in every TZ: ${dues[0]}`);
});

test('rows hidden by the sheet filter are INCLUDED (a view setting, not data)', () => {
  const tr = parse(standardTrackerBytes(XLSX));
  // Fixture sanity: the flags really are in the file.
  const wb = XLSX.read(standardTrackerBytes(XLSX), { cellStyles: true });
  const rows = wb.Sheets['Hierarchical Tracker']['!rows'];
  assert.ok(rows && rows[4] && rows[4].hidden && rows[8] && rows[8].hidden, 'two hidden rows in the fixture');
  const t = byWbs(tr);
  assert.ok(t['1.1.1'] && t['2.2.1'], 'both hidden Hierarchical rows are tasks');
  assert.equal(t['1.1.1'].workstream, 'Executive Stream', 'with their Hierarchical fields');
  assert.equal(tr.tasks.length, 8);
});

test('text is trimmed / whitespace-collapsed; multi-line free text keeps its line breaks', () => {
  const t = byWbs(parse(standardTrackerBytes(XLSX)));
  assert.equal(t['2.1.2'].task, 'Synthetic go-live');
  assert.equal(t['1.2.1'].notes, 'Line one\nLine two');
  assert.equal(t['1.2.1'].nextAction, 'Send minutes');
  assert.equal(t['1.2.1'].definitionOfDone, 'Minutes approved');
  assert.equal(t['1.2.1'].predecessor, '1.1.1');
});

test('sheet disagreements: Hierarchical wins and each one is a warning', () => {
  const tr = parse(standardTrackerBytes(XLSX));
  const t = byWbs(tr);
  assert.equal(t['2.1.2'].task, 'Synthetic go-live', 'task text from Hierarchical');
  const w = tr.warnings.join('\n');
  assert.match(w, /2\.1\.2[^\n]*Synthetic go-live[^\n]*Approve the synthetic go-live/, 'task disagreement reported');
  assert.match(w, /2\.2\.1[^\n]*2026-09-14[^\n]*2026-09-06/, 'due disagreement reported');
  assert.match(w, /9\.9\.9[^\n]*Portfolio Tracker/, 'Portfolio-only row reported');
  assert.match(w, /4\.4\.4[^\n]*Portfolio Tracker/, 'Portfolio-only row reported');
  assert.match(w, /3\.1\.1[^\n]*Hierarchical Tracker/, 'Hierarchical-only row reported');
  assert.equal(tr.warnings.length, 5, `exactly the 5 notes:\n${w}`);
  // Agreeing values (incl. the same date in two cell types) raise nothing.
  assert.ok(!/1\.1\.1|1\.2\.1|2\.1\.1/.test(w), 'no warning for agreeing rows');
});

test('a stale cached Portfolio status loses to Hierarchical (with a warning); no cache at all is fine', () => {
  const pRows = P_ROWS.map((r) => r.slice());
  pRows[0][9] = F('Completed'); // 2.1.1 — Hierarchical says Deleyed
  pRows[1][9] = F(undefined); // 1.2.1 — a file saved without cached formula values
  const tr = parse(standardTrackerBytes(XLSX, { pRows }));
  const t = byWbs(tr);
  assert.equal(t['2.1.1'].status, 'Deleyed');
  assert.equal(t['1.2.1'].status, 'Completed', 'joined from Hierarchical, not from the (missing) cache');
  assert.match(tr.warnings.join('\n'), /2\.1\.1[^\n]*Deleyed[^\n]*Completed/);
  assert.equal(tr.warnings.length, 6);
});

test('a blank Hierarchical value falls back to the Portfolio one', () => {
  const hRows = H_ROWS.map((r) => r.slice());
  hRows[0][6] = ''; // 1.1.1 owner blank in Hierarchical
  const t = byWbs(parse(standardTrackerBytes(XLSX, { hRows })));
  assert.equal(t['1.1.1'].owner, 'Owner One');
});

test('Status formula copied below the last task (cached \'Not Found\' only) adds no phantom tasks', () => {
  // Excel users drag the IFERROR(INDEX/MATCH) Status formula down past the data: a blank
  // WBS fails the MATCH, so each such row caches 'Not Found' and holds nothing else.
  const blankFormulaRow = [null, null, null, null, null, null, null, null, null, F('Not Found'), null];
  const pRows = [...P_ROWS, blankFormulaRow, blankFormulaRow, blankFormulaRow];
  const base = parse(standardTrackerBytes(XLSX));
  const tr = parse(standardTrackerBytes(XLSX, { pRows }));
  assert.deepEqual(tr.tasks.map((t) => t.id), base.tasks.map((t) => t.id), 'same 8 tasks, no row-N phantoms');
  assert.deepEqual(tr.warnings, base.warnings, 'and no «Portfolio only» warnings for them');
});

test('a matched task with a blank Hierarchical status stays blank (Portfolio cache 0 ignored)', () => {
  // INDEX() of an empty Hierarchical Status cell caches the number 0 in Portfolio.
  const hRows = H_ROWS.map((r) => r.slice());
  hRows[0][8] = ''; // 1.1.1 status not set yet in Hierarchical
  const pRows = P_ROWS.map((r) => r.slice());
  pRows[2][9] = F(0); // 1.1.1's Portfolio mirror
  const base = parse(standardTrackerBytes(XLSX));
  const tr = parse(standardTrackerBytes(XLSX, { hRows, pRows }));
  assert.equal(byWbs(tr)['1.1.1'].status, '', 'never the formula artefact «0»');
  assert.deepEqual(tr.warnings, base.warnings, 'no disagreement warning for an empty source');
  // A Portfolio-only row still takes its real cached status.
  assert.equal(byWbs(tr)['4.4.4'].status, 'In Progress');
});

test('a workbook saved in the 1904 date system converts serials with that system', () => {
  const hRows = H_ROWS.map((r) => r.slice());
  hRows[0][9] = serial1904('2026-09-01'); // 1.1.1
  const pRows = P_ROWS.map((r) => r.slice());
  pRows[2][10] = serial1904('2026-09-01'); // 1.1.1
  pRows[5][10] = serial1904('2026-09-06'); // 2.2.1
  const bytes = workbookBytes(XLSX, [
    ['Hierarchical Tracker', hierarchicalSheet(XLSX, hRows)],
    ['Portfolio Tracker', portfolioSheet(XLSX, pRows)],
  ], { date1904: true });
  const t = byWbs(parse(bytes));
  assert.equal(t['1.1.1'].due, '2026-09-01', 'not 4 years and a day early');
  assert.equal(t['1.2.1'].due, '2026-09-17', 'typed text dates are unaffected');
});

test('Portfolio-only workbook: tasks with grouping, cached statuses, a warning', () => {
  const bytes = workbookBytes(XLSX, [['Portfolio Tracker', portfolioSheet(XLSX, P_ROWS)]]);
  const tr = parse(bytes);
  assert.deepEqual(tr.tasks.map((t) => t.wbs), ['2.1.1', '1.2.1', '1.1.1', '2.1.2', '9.9.9', '2.2.1', '4.4.4']);
  const t = byWbs(tr);
  assert.equal(t['2.1.1'].status, 'Deleyed', 'cached formula value');
  assert.equal(t['9.9.9'].status, '', "'Not Found' → ''");
  assert.equal(t['1.1.1'].due, '2026-09-01');
  assert.equal(t['2.1.2'].task, 'Approve the synthetic go-live and cut over', 'only sheet → its text');
  assert.equal(t['2.1.1'].workstream, '', 'Hierarchical-only fields are empty');
  assert.equal(t['2.1.1'].predecessor, '');
  assert.equal(tr.warnings.length, 1, 'one note: the missing sheet — not one per row');
  assert.match(tr.warnings[0], /Hierarchical Tracker/);
});

test('Hierarchical-only workbook: Hierarchical order, no grouping, a warning', () => {
  const bytes = workbookBytes(XLSX, [['Hierarchical Tracker', hierarchicalSheet(XLSX, H_ROWS, { hidden: [0] })]]);
  const tr = parse(bytes);
  assert.deepEqual(tr.tasks.map((t) => t.wbs), ['1.1.1', '1.2.1', '2.1.1', '2.1.2', '2.2.1', '3.1.1']);
  assert.ok(tr.tasks.every((t) => t.track === '' && t.milestone === ''));
  assert.equal(byWbs(tr)['2.2.1'].due, '2026-09-14');
  assert.equal(tr.warnings.length, 1);
  assert.match(tr.warnings[0], /Portfolio Tracker/);
});

test('tolerant detection: renamed sheets, header variants, header on another row', () => {
  const hHeaders = ['wbs', 'WORKSTREAM', 'work-package', 'TASK / DELIVERABLE', 'Task type', 'Organisation',
    'Owner ', 'Priority', ' Status', 'Due', 'Predecessor', 'Next action', 'Definition of done', 'Note'];
  const pHeaders = ['Track', 'Milestone', 'WBS', 'Work Package', 'Task', 'Type', 'Org', 'Owner', 'Priority', 'STATUS', 'due date'];
  const bytes = workbookBytes(XLSX, [
    ['Cover', sheetFrom(XLSX, [['Synthetic cover sheet']])],
    ['Sheet 7', hierarchicalSheet(XLSX, H_ROWS, { headers: hHeaders, titleRows: 6 })], // header on row 7
    ['portfolio  tracker (2)', portfolioSheet(XLSX, P_ROWS, { headers: pHeaders })],
  ]);
  const tr = parse(bytes);
  assert.equal(tr.tasks.length, 8);
  const t = byWbs(tr);
  assert.equal(t['2.1.1'].workstream, 'Delivery Stream', 'Hierarchical found by its header signature');
  assert.equal(t['2.1.1'].track, 'Track A', 'Portfolio found by a tolerant name');
  assert.equal(t['1.2.1'].notes, 'Line one\nLine two');
  assert.equal(t['3.1.1'].organization, 'ORG-B');
});

test('a repeated WBS gets a suffixed id, pairs in order, and is reported', () => {
  const hRows = [...H_ROWS, ['1.1.1', 'Executive Stream', 'Steering Package', 'A second 1.1.1 row', 'Milestone', 'ORG-A', 'Owner One', 'High', 'Completed', null, '', '', '', '']];
  const tr = parse(standardTrackerBytes(XLSX, { hRows }));
  const ids = tr.tasks.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.ok(ids.includes('1.1.1') && ids.includes('1.1.1#2'));
  const second = tr.tasks.find((t) => t.id === '1.1.1#2');
  assert.equal(second.task, 'A second 1.1.1 row', 'the unmatched repeat is appended as Hierarchical-only');
  assert.match(tr.warnings.join('\n'), /مكرر[^\n]*1\.1\.1/);
});

test('blank rows and group-label-only rows are skipped; the label still fills down', () => {
  const pRows = [
    ['Track X', 'Milestone X', null, null, null, null, null, null, null, null, null], // group header row
    [null, null, '1.1.1', 'Steering Package', 'Set up the synthetic steering group', 'Decision / Approval', 'ORG-A', 'Owner One', 'Critical', F('In Progress'), D('2026-09-01')],
    [],
    [null, null, null, null, null, null, null, null, null, null, null],
  ];
  const bytes = workbookBytes(XLSX, [
    ['Hierarchical Tracker', hierarchicalSheet(XLSX, [H_ROWS[0], [], H_ROWS[1]])],
    ['Portfolio Tracker', portfolioSheet(XLSX, pRows)],
  ]);
  const tr = parse(bytes);
  assert.deepEqual(tr.tasks.map((t) => t.wbs), ['1.1.1', '1.2.1']);
  assert.deepEqual([tr.tasks[0].track, tr.tasks[0].milestone], ['Track X', 'Milestone X']);
});

test('accepts an ArrayBuffer (the browser File.arrayBuffer path)', () => {
  const bytes = standardTrackerBytes(XLSX);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal(parseTaskTracker(ab, XLSX).tasks.length, 8);
});

test('the OLD tracker format is rejected with a specific Arabic message', () => {
  assert.throws(() => parse(oldFormatBytes(XLSX)), (e) => {
    assert.equal(e.code, 'TRACKER_OLD_FORMAT');
    assert.match(e.message, /القديم/);
    assert.match(e.message, /سجل المهام/);
    assert.match(e.message, /Hierarchical Tracker/, 'tells the user which file to upload instead');
    return true;
  });
});

test('an unrelated workbook is rejected with a different Arabic message', () => {
  assert.throws(() => parse(unrelatedBytes(XLSX)), (e) => {
    assert.equal(e.code, 'TRACKER_UNKNOWN_FORMAT');
    assert.match(e.message, /لا يطابق/);
    assert.doesNotMatch(e.message, /القديم/);
    return true;
  });
  // Right sheet NAMES but none of the expected headers is still not a tracker.
  const named = workbookBytes(XLSX, [['Hierarchical Tracker', sheetFrom(XLSX, [['Some', 'Other', 'Columns'], ['a', 'b', 'c']])]]);
  assert.throws(() => parse(named), { code: 'TRACKER_UNKNOWN_FORMAT' });
});

test('a non-spreadsheet file is rejected, never parsed into an empty tracker', () => {
  const junk = new TextEncoder().encode('this is not a workbook at all');
  assert.throws(() => parse(junk), (e) => e.code === 'TRACKER_UNREADABLE' && /تعذّرت قراءة الملف/.test(e.message));
  // Too short / binary junk / an empty file: the same "not an Excel file" message.
  for (const bytes of [new Uint8Array([1, 2, 3]), new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), new Uint8Array(0)]) {
    assert.throws(() => parse(bytes), { code: 'TRACKER_UNREADABLE' });
  }
});

test('a tracker with headers but no rows parses to 0 tasks with a note', () => {
  const bytes = workbookBytes(XLSX, [
    ['Hierarchical Tracker', hierarchicalSheet(XLSX, [])],
    ['Portfolio Tracker', portfolioSheet(XLSX, [])],
  ]);
  const tr = parse(bytes);
  assert.equal(tr.tasks.length, 0);
  assert.ok(tr.warnings.some((w) => /لا توجد مهام/.test(w)));
});

// ---- the document helpers ---------------------------------------------------------------

test('normalizeDueText: day-first, ISO and dd-mmm-yyyy dates; everything else verbatim', () => {
  assert.equal(normalizeDueText('17/9/2026'), '2026-09-17');
  assert.equal(normalizeDueText('5.10.2026'), '2026-10-05');
  assert.equal(normalizeDueText('2026-9-1'), '2026-09-01');
  assert.equal(normalizeDueText('01-Sep-2026'), '2026-09-01');
  assert.equal(normalizeDueText('  daily '), 'daily');
  assert.equal(normalizeDueText('31/2/2026'), '31/2/2026', 'an impossible date is not a date');
  assert.equal(normalizeDueText('Q4 2026'), 'Q4 2026');
  assert.equal(normalizeDueText(''), '');
  assert.equal(normalizeDueText(null), '');
});

test('normalizeProjectTracker: known keys only, string fields, repaired ids; untagged → null', () => {
  const doc = {
    format: TRACKER_FORMAT, fileName: 'x.xlsx', loadedAt: NOW, editedAt: '2026-10-13T09:00:00.000Z',
    warnings: ['w', 5], extra: 'dropped',
    tasks: [
      { id: 'a', wbs: '1', task: 'T', status: 'Completed', _open: true, priority: 3 },
      { id: 'a', wbs: '2' },
      { wbs: '' },
      'not a task',
    ],
  };
  const n = normalizeProjectTracker(doc);
  assert.deepEqual(Object.keys(n).sort(), ['editedAt', 'fileName', 'format', 'loadedAt', 'tasks', 'warnings']);
  assert.equal(n.editedAt, '2026-10-13T09:00:00.000Z', 'editedAt survives');
  assert.deepEqual(n.warnings, ['w']);
  assert.equal(n.tasks.length, 3, 'non-object task dropped');
  assert.deepEqual(Object.keys(n.tasks[0]).sort(), [...TASK_FIELDS].sort(), 'UI keys like _open dropped');
  assert.equal(n.tasks[0].priority, '3', 'numbers become strings');
  assert.equal(n.tasks[0].nextAction, '', 'missing fields become empty strings');
  assert.deepEqual(n.tasks.map((t) => t.id), ['a', 'a#2', 'row-3'], 'ids repaired to be unique and non-empty');
  assert.equal(doc.tasks[0]._open, true, 'the input is not mutated');
  // Not the tagged document → null.
  assert.equal(normalizeProjectTracker({ tasks: [], challenges: [], risks: [] }), null, 'the OLD shape');
  assert.equal(normalizeProjectTracker({ format: 'other', tasks: [] }), null);
  assert.equal(normalizeProjectTracker({ format: TRACKER_FORMAT }), null, 'no tasks array');
  assert.equal(normalizeProjectTracker(null), null);
  // A parsed tracker is already normal (idempotent).
  const tr = parse(standardTrackerBytes(XLSX));
  assert.deepEqual(normalizeProjectTracker(tr), tr);
});

test('newTask: a blank row with an id no existing task uses', () => {
  const t = newTask([{ id: 'new-1' }, { id: '1.1.1' }]);
  assert.equal(t.id, 'new-2');
  for (const f of TASK_FIELDS) assert.equal(typeof t[f], 'string');
  assert.equal(t.task, '');
  assert.equal(newTask().id, 'new-1');
});

test('fixture headers mirror the real workbook\'s exact header text', () => {
  // Guards the synthetic builders against drifting from the format they stand in for.
  assert.equal(H_HEADERS.length, 14);
  assert.equal(P_HEADERS.length, 11);
  assert.equal(H_HEADERS[3], 'Task / Deliverable');
  assert.equal(P_HEADERS[0], 'Portfolio Track');
});
