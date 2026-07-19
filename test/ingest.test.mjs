// test/ingest.test.mjs — run with:  node --test
// Parses the REAL sample files. Vendor XLSX is imported directly; PapaParse (UMD)
// is loaded via createRequire. Modules under test receive the library as a param.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import * as XLSX from '../vendor/xlsx.mjs';
import { parseKamcCsv } from '../src/ingest/csv.js';
import { parseTracker, parseTatLookupXlsx } from '../src/ingest/xlsx.js';
import { autoDraft } from '../src/model/drafts.js';
import { buildReportModel } from '../src/model/report-model.js';

const require = createRequire(import.meta.url);
const Papa = require('../vendor/papaparse.min.js');

// Read-only real sample inputs (absolute paths — dev fixtures, not shipped).
const CSV_PATH = '/Users/aziz/KAMC Order details-data-2026-07-19 10_23_40.csv';
const TRK_PATH = '/Users/aziz/Misbar Project Tracker.xlsx';
const TAT_PATH = '/Users/aziz/TAT Lookup.xlsx';

const REPORT_DATE = '2026-07-09';

// Load once, share across tests. Pass Uint8Array to mimic the browser ArrayBuffer path.
const csvText = readFileSync(CSV_PATH, 'utf8');
const trkBuf = new Uint8Array(readFileSync(TRK_PATH));
const tatBuf = new Uint8Array(readFileSync(TAT_PATH));

test('parseKamcCsv — counts match the real daily export', () => {
  const { rows, summary, errors } = parseKamcCsv(csvText, Papa);
  assert.equal(errors.length, 0, `unexpected errors: ${errors.join(' | ')}`);
  assert.equal(summary.rowCount, 629, 'rowCount');
  assert.equal(rows.length, 629, 'rows.length');
  assert.equal(summary.distinctOrders, 533, 'distinctOrders');
  assert.equal(summary.resultedCount, 500, 'resultedCount');
  assert.equal(summary.dateRange.min, '2026-04-23');
  assert.equal(summary.dateRange.max, '2026-07-08');
});

test('parseKamcCsv — OrderRow mapping is faithful (no PII, IDs as strings)', () => {
  const { rows } = parseKamcCsv(csvText, Papa);
  const r0 = rows[0];
  // Leading-zero order id preserved as a string.
  assert.equal(typeof r0.orderId, 'string');
  assert.match(r0.orderId, /^00990/);
  // Order date is date-only.
  assert.equal(r0.orderDate, '2026-04-23');
  assert.equal(r0.loinc, '48378-4');
  assert.equal(r0.rawStatus, 'Result Approved');
  assert.equal(r0.tatDaysCsv, 3);
  assert.equal(typeof r0.lineNo, 'number');
  // No patient/staff fields leaked onto the row.
  for (const k of Object.keys(r0)) {
    assert.ok(
      !/patient|national|mrn|dob|gender|by$/i.test(k),
      `unexpected PII-ish key: ${k}`,
    );
  }
});

test('parseTracker — task / challenge / risk counts', () => {
  const trk = parseTracker(trkBuf, XLSX);
  assert.equal(trk.tasks.length, 51, 'tasks');
  assert.equal(trk.challenges.length, 5, 'challenges');
  assert.equal(trk.risks.length, 1, 'risks');
  // Hidden-row support is available with cellStyles:true on this workbook.
  assert.equal(trk._meta.hiddenSupported, true);
  assert.ok(
    trk.tasks.some((t) => t.hidden === true),
    'some closed rows should be flagged hidden',
  );
  // A verbatim range due-date survives intact.
  const range = trk.tasks.find((t) => /\n/.test(t.dueDate) || t.dueDate.includes('16-07-2026'));
  assert.ok(range, 'expected at least one dated task');
});

test('parseTatLookupXlsx — 59 tests from the TAT Lookup workbook', () => {
  const { tests, count } = parseTatLookupXlsx(tatBuf, XLSX);
  assert.equal(count, 59, 'count');
  assert.equal(Object.keys(tests).length, 59, 'distinct test names');
  assert.equal(
    tests['Kappa light chains.free/Lambda light chains.free [Mass Ratio] in Serum'],
    3,
  );
});

test('autoDraft — reproduces the 8 current / 5 internal split', () => {
  const trk = parseTracker(trkBuf, XLSX);
  const d = autoDraft(trk, REPORT_DATE);
  assert.equal(d.tasksCurrent.length, 8, 'current (external) tasks');
  assert.equal(d.tasksInternal.length, 5, 'internal tasks');
  // Internal slide is the لين-category subset.
  assert.ok(d.tasksInternal.every((t) => t.category === 'لين'));
  assert.ok(d.tasksCurrent.every((t) => t.category !== 'لين'));
  // Display mapping: مفتوح -> قيد التنفيذ; ongoing/late statuses stay verbatim.
  assert.ok(!d.tasksCurrent.some((t) => t.status === 'مفتوح'));
  assert.ok(d.tasksCurrent.some((t) => t.status === 'قيد التنفيذ'));
  assert.ok(d.tasksCurrent.some((t) => t.status === 'مستمر'));
  assert.ok(d.tasksCurrent.some((t) => t.status === 'متأخر'));
  // supportRequired = solutions of OPEN challenges (4 of the 5 sample challenges are مفتوح).
  assert.ok(d.supportRequired.length >= 1);
  assert.ok(d.supportRequired.every((s) => typeof s === 'string' && !s.includes('\n')));
});

test('buildReportModel — wires drafts and applies edits (shallow merge)', () => {
  const trk = parseTracker(trkBuf, XLSX);
  const engineOutput = { totals: { lines: 629 } }; // opaque to this module
  const settings = { scorecard: [{ lab: 'X' }], displayNames: { A: 'a' } };

  const m0 = buildReportModel({ engineOutput, tracker: trk, settings, reportDate: REPORT_DATE });
  assert.equal(m0.reportDate, REPORT_DATE);
  assert.equal(m0.kpi, engineOutput);
  assert.equal(m0.tasksCurrent.length, 8);
  assert.equal(m0.tasksInternal.length, 5);
  assert.equal(m0.challenges.length, 5);
  assert.equal(m0.risks.length, 1);
  assert.equal(m0.scorecard, settings.scorecard);
  assert.equal(m0.displayNames, settings.displayNames);
  assert.ok(Array.isArray(m0.panels.supportRequired));

  // edits override: panels shallow-merge, task list replaced wholesale.
  const edits = {
    panels: { supportRequired: ['custom bullet'] },
    tasksCurrent: [{ task: 'only one', category: 'نوبكو', status: 'قيد التنفيذ' }],
  };
  const m1 = buildReportModel({ engineOutput, tracker: trk, settings, reportDate: REPORT_DATE, edits });
  assert.deepEqual(m1.panels.supportRequired, ['custom bullet']);
  assert.equal(m1.tasksCurrent.length, 1); // replaced
  assert.equal(m1.tasksInternal.length, 5); // untouched -> still auto-drafted
  assert.deepEqual(m1.panels.completedTasks, m0.panels.completedTasks); // other panel keys survive
});
