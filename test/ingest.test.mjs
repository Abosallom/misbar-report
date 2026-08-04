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
import { taskKey } from '../src/model/task-lifecycle.js';
import { buildReportModel } from '../src/model/report-model.js';

const require = createRequire(import.meta.url);
const Papa = require('../vendor/papaparse.min.js');

// Read-only real sample inputs. Preferred: the repo-local (gitignored) copies in
// test/samples/. Fallback: the original home-directory files. When neither exists
// (e.g. a fresh clone of the public repo), these suites skip instead of failing.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const firstExisting = (...paths) => paths.find((p) => existsSync(p)) || null;

const CSV_PATH = firstExisting(
  join(HERE, 'samples/orders.csv'),
  '/Users/aziz/KAMC Order details-data-2026-07-19 10_23_40.csv',
);
const TRK_PATH = firstExisting(
  join(HERE, 'samples/tracker.xlsx'),
  '/Users/aziz/Misbar Project Tracker.xlsx',
);
const TAT_PATH = firstExisting(
  '/Users/aziz/TAT Lookup.xlsx',
  '/Users/aziz/Downloads/TAT Lookup.xlsx',
);

const REPORT_DATE = '2026-07-09';

// Load once, share across tests. Pass Uint8Array to mimic the browser ArrayBuffer path.
// A file can exist yet be unreadable — macOS gates Desktop/Documents/Downloads per
// process, so a home-directory fallback may raise EPERM. That is an environment
// condition, not a product defect: treat it exactly like a missing file and skip.
const readOrNull = (path, enc) => {
  if (!path) return null;
  try { return readFileSync(path, enc); } catch { return null; }
};
const csvRaw = readOrNull(CSV_PATH, 'utf8');
const trkRaw = readOrNull(TRK_PATH);
const tatRaw = readOrNull(TAT_PATH);

const SKIP = { csv: csvRaw == null, trk: trkRaw == null, tat: tatRaw == null };

const csvText = csvRaw || '';
const trkBuf = trkRaw ? new Uint8Array(trkRaw) : new Uint8Array();
const tatBuf = tatRaw ? new Uint8Array(tatRaw) : new Uint8Array();

test('parseKamcCsv — counts match the real daily export', { skip: SKIP.csv }, () => {
  const { rows, summary, errors } = parseKamcCsv(csvText, Papa);
  assert.equal(errors.length, 0, `unexpected errors: ${errors.join(' | ')}`);
  assert.equal(summary.rowCount, 629, 'rowCount');
  assert.equal(rows.length, 629, 'rows.length');
  assert.equal(summary.distinctOrders, 533, 'distinctOrders');
  assert.equal(summary.resultedCount, 500, 'resultedCount');
  assert.equal(summary.dateRange.min, '2026-04-23');
  assert.equal(summary.dateRange.max, '2026-07-08');
});

test('parseKamcCsv — OrderRow mapping is faithful (no PII, IDs as strings)', { skip: SKIP.csv }, () => {
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

test('parseTracker — task / challenge / risk counts', { skip: SKIP.trk }, () => {
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

test('parseTatLookupXlsx — 59 tests from the TAT Lookup workbook', { skip: SKIP.tat }, () => {
  const { tests, count } = parseTatLookupXlsx(tatBuf, XLSX);
  assert.equal(count, 59, 'count');
  assert.equal(Object.keys(tests).length, 59, 'distinct test names');
  assert.equal(
    tests['Kappa light chains.free/Lambda light chains.free [Mass Ratio] in Serum'],
    3,
  );
});

// SUPERSESSION (2026-08-04): this case used to assert internal === 31 — "the COMPLETE
// لين log, مغلق and hidden rows included" (user decision 2026-07-22). The user replaced
// that with the stateful lifecycle rule ("show a newly-closed task exactly one more
// report, then drop it") and stated it applies to BOTH lists. With an EMPTY taskLog (no
// task ever recorded as shown-open, i.e. the pre-ship state) every مغلق row is excluded,
// so internal drops 31 → 8 = the non-closed لين rows. The closed-presence assertion is
// INVERTED for the same reason. Grace behaviour is covered by the two cases below and
// exhaustively by test/task-lifecycle.test.mjs.
test('autoDraft — current stays filtered (8); internal is now non-closed لين only (8)', { skip: SKIP.trk }, () => {
  const trk = parseTracker(trkBuf, XLSX);
  const d = autoDraft(trk, REPORT_DATE);
  // tasksCurrent (NUPCO/external): non-closed + scheduled, non-لين. UNCHANGED.
  assert.equal(d.tasksCurrent.length, 8, 'current (external) tasks');
  // tasksInternal (داخلي): every non-closed لين row, unscheduled + hidden included.
  const linTotal = trk.tasks.filter((t) => t.category === 'لين').length;
  assert.equal(linTotal, 31, 'sanity: full لين count in the sample tracker');
  const linOpen = trk.tasks.filter((t) => t.category === 'لين' && t.status !== 'مغلق').length;
  assert.equal(linOpen, 8, 'sanity: non-closed لين rows in the sample tracker');
  assert.equal(d.tasksInternal.length, linOpen, 'internal tasks = non-closed لين rows');
  // Guard: the external isScheduled filter must NOT leak onto the internal list. Only 5
  // of those 8 non-closed لين rows carry a concrete date / مستمر / متأخر, so a 5 here
  // would mean the scheduled filter was applied to internal rows too.
  assert.notEqual(d.tasksInternal.length, 5, 'isScheduled must not be applied to internal rows');
  // Every internal row is لين; current has no لين.
  assert.ok(d.tasksInternal.every((t) => t.category === 'لين'));
  assert.ok(d.tasksCurrent.every((t) => t.category !== 'لين'));
  // INVERTED (was: "at least one مغلق internal row"). With an empty taskLog no closed
  // row has an unconsumed grace, so none may appear.
  assert.ok(!d.tasksInternal.some((t) => t.status === 'مغلق'), 'no مغلق internal row without a grace');
  // Display mapping still applies to internal rows (مفتوح -> قيد التنفيذ; no raw مفتوح).
  assert.ok(!d.tasksInternal.some((t) => t.status === 'مفتوح'));
  // Current stays none-لين / none-closed.
  assert.ok(!d.tasksCurrent.some((t) => t.status === 'مغلق'), 'current has no closed rows');
  // Display mapping: مفتوح -> قيد التنفيذ; ongoing/late statuses stay verbatim.
  assert.ok(!d.tasksCurrent.some((t) => t.status === 'مفتوح'));
  assert.ok(d.tasksCurrent.some((t) => t.status === 'قيد التنفيذ'));
  assert.ok(d.tasksCurrent.some((t) => t.status === 'مستمر'));
  assert.ok(d.tasksCurrent.some((t) => t.status === 'متأخر'));
  // supportRequired = solutions of OPEN challenges (4 of the 5 sample challenges are مفتوح).
  assert.ok(d.supportRequired.length >= 1);
  assert.ok(d.supportRequired.every((s) => typeof s === 'string' && !s.includes('\n')));
});

test('autoDraft — a recorded closed نوبكو row takes its ONE grace, bypassing isScheduled', { skip: SKIP.trk }, () => {
  const trk = parseTracker(trkBuf, XLSX);
  // The tracker literally contains this shape: a مغلق نوبكو row whose due date is prose
  // ('يومان بعد تسليم قائمة الفحوصات'), i.e. NOT scheduled. If the isScheduled filter
  // applied to grace rows the grace could never be consumed and the row would pop up
  // months later — so grace rows bypass it.
  const row = trk.tasks.find((t) => t.task.includes('رفع قائمة الفحوصات إلى قاعدة البيانات'));
  assert.ok(row, 'fixture row present in the sample tracker');
  assert.equal(row.status, 'مغلق');
  assert.equal(row.category, 'نوبكو');
  assert.ok(!/\d{1,2}-\d{1,2}-\d{4}/.test(row.dueDate), 'fixture row is unscheduled (prose due date)');

  const taskLog = { [taskKey('ext', row)]: { openOn: '2026-07-01', closedOn: null } };
  const d = autoDraft(trk, REPORT_DATE, { taskLog });
  assert.equal(d.tasksCurrent.length, 9, '8 filtered rows + the one grace row');
  const shown = d.tasksCurrent.filter((t) => t.status === 'مغلق');
  assert.equal(shown.length, 1, 'exactly one closed row is shown');
  assert.equal(shown[0].task, row.task);
  // The grace is per key: consuming it (closedOn === an earlier date) removes the row.
  const consumed = { [taskKey('ext', row)]: { openOn: '2026-07-01', closedOn: '2026-07-08' } };
  assert.equal(autoDraft(trk, REPORT_DATE, { taskLog: consumed }).tasksCurrent.length, 8);
});

test('autoDraft — a recorded closed لين row takes its ONE grace on the internal list', { skip: SKIP.trk }, () => {
  const trk = parseTracker(trkBuf, XLSX);
  const row = trk.tasks.find((t) => t.category === 'لين' && t.status === 'مغلق');
  assert.ok(row, 'the sample tracker has closed لين rows');
  const taskLog = { [taskKey('int', row)]: { openOn: '2026-07-01', closedOn: null } };
  const d = autoDraft(trk, REPORT_DATE, { taskLog });
  assert.equal(d.tasksInternal.length, 9, '8 non-closed لين rows + the one grace row');
  const shown = d.tasksInternal.filter((t) => t.status === 'مغلق');
  assert.equal(shown.length, 1, 'only the recorded closed row appears, not the other 22');
  assert.equal(shown[0].task, row.task);
  // Tracker order is preserved — the grace row is not appended at the end.
  const linOrder = trk.tasks.filter((t) => t.category === 'لين'
    && (t.status !== 'مغلق' || t.task === row.task)).map((t) => t.task);
  assert.deepEqual(d.tasksInternal.map((t) => t.task), linOrder);
  // An external-keyed entry must NOT grant grace on the internal list (prefix parity).
  const wrongList = { [taskKey('ext', row)]: { openOn: '2026-07-01', closedOn: null } };
  assert.equal(autoDraft(trk, REPORT_DATE, { taskLog: wrongList }).tasksInternal.length, 8);
});

test('buildReportModel — wires drafts and applies edits (shallow merge)', { skip: SKIP.trk }, () => {
  const trk = parseTracker(trkBuf, XLSX);
  const engineOutput = { totals: { lines: 629 } }; // opaque to this module
  const settings = { scorecard: [{ lab: 'X' }], displayNames: { A: 'a' } };

  const m0 = buildReportModel({ engineOutput, tracker: trk, settings, reportDate: REPORT_DATE });
  assert.equal(m0.reportDate, REPORT_DATE);
  assert.equal(m0.kpi, engineOutput);
  assert.equal(m0.tasksCurrent.length, 8);
  assert.equal(m0.tasksInternal.length, 8); // SUPERSEDED 31 → 8: non-closed لين only (see above)
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
  assert.equal(m1.tasksInternal.length, 8); // untouched -> still auto-drafted (non-closed لين)
  assert.deepEqual(m1.panels.completedTasks, m0.panels.completedTasks); // other panel keys survive
});

test('buildReportModel — threads settings.taskLog into the lifecycle split', { skip: SKIP.trk }, () => {
  const trk = parseTracker(trkBuf, XLSX);
  const engineOutput = { totals: { lines: 629 } };
  const closedLin = trk.tasks.find((t) => t.category === 'لين' && t.status === 'مغلق');
  const settings = {
    scorecard: [], displayNames: {},
    taskLog: { [taskKey('int', closedLin)]: { openOn: '2026-07-01', closedOn: null } },
  };
  // The wiring is what makes the automation path (pipeline → report-model) honour the
  // lifecycle at all: without it every closed row would silently vanish forever.
  const m = buildReportModel({ engineOutput, tracker: trk, settings, reportDate: REPORT_DATE });
  assert.equal(m.tasksInternal.length, 9, 'the recorded closed row gets its grace row');
  assert.ok(m.tasksInternal.some((t) => t.status === 'مغلق' && t.task === closedLin.task));
  // No taskLog in settings → pre-ship behaviour, no closed rows.
  const bare = buildReportModel({
    engineOutput, tracker: trk, settings: { scorecard: [] }, reportDate: REPORT_DATE,
  });
  assert.equal(bare.tasksInternal.length, 8);
});
