// test/reconciliation.test.mjs — `node --test test/reconciliation.test.mjs`
//
// INDEPENDENT cross-surface auditor. A genuine SECOND OPINION on the engine:
// every cross-slide number is recomputed here from the RAW golden rows with its
// own inline logic — no engine internals are imported except the pure date
// helpers in workday.js (parsing/month-key/INT/workday), and — for everything the
// 2026-08-05 rule changes do NOT touch — the workbook's own cached formula fields.
// SCOPED 2026-08-05: `_cachedDue` and `_cachedStatus` are the source workbook's
// EXCEL SAT/SUN-WEEKEND, strictly-past-due outputs. They remain a valid oracle for
// non-due-derived facts, but they can no longer supply a DUE DATE or a LATE label:
// Talal's rules 1 (weekend = Fri+Sat) and 2 (late = due today or overdue) were a
// DELIBERATE divergence from that workbook, so a due-derived comparison against it
// would now assert the OLD product. The due-derived checks below therefore
// recompute the due date with the shared `workday()` primitive (itself pinned by
// its own unit test in engine.test.mjs) and apply the new late rule inline. This
// file stays a genuine second opinion about the AGGREGATION — which rows land in
// which bucket, and whether the slides agree — it just no longer re-litigates the
// weekend convention. golden-orders.js rows are NEVER edited.
// Then it asserts (a) the engine's published
// output equals this independent recompute AND (b) every cross-surface identity
// that ties the slides together holds. Each failure message names the identity in
// Arabic + English so a red run is self-explanatory.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compute } from '../src/engine/engine.js';
import { goldenOpts } from './assertions.js';
import { GOLDEN_ORDERS } from './fixtures/golden-orders.js';
import { TAT_LOOKUP } from '../src/seeds/tat-lookup.js';
import { parseDateTime, toEpochDay, monthKey, workday } from '../src/engine/workday.js';

// --- our OWN tiny helpers (do not reuse engine internals) --------------------
/** report-style 1-decimal rounding (half-up, EPSILON-guarded) — re-implemented. */
const round1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;
/** whitespace-collapse + trim, matching how test names are keyed (independent copy). */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// One engine run with the standard published golden options (see engine.test.mjs).
const OPTS = goldenOpts();
const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, OPTS);

// asOf of the published golden run, as a whole-UTC-day (the late rule compares days).
const ASOF_DAY = toEpochDay(parseDateTime(OPTS.asOf));
/** TAT resolution, re-implemented: curated lookup first, else the CSV column. */
const TAT_IDX = new Map(Object.entries(TAT_LOOKUP));
function tatOf(r) {
  if (TAT_IDX.has(r.testName)) return TAT_IDX.get(r.testName);
  return (r.tatDaysCsv != null && r.tatDaysCsv !== '') ? Number(r.tatDaysCsv) : null;
}
/** Due day = workday(received, StdTAT) under the Fri+Sat weekend. null when either
 *  input is missing — a row with no receipt or no TAT has no due date at all. */
function dueOf(r) {
  const recv = parseDateTime(r.received);
  const tat = tatOf(r);
  return (recv != null && tat != null) ? workday(recv, tat) : null;
}

// Independent projection of every raw row to just the fields the identities need.
// Nothing here calls the engine; dates come straight from the pure parser and the
// workbook's cached formula outputs.
const R = GOLDEN_ORDERS.map((r) => ({
  testName: r.testName,
  orderMs: parseDateTime(r.orderDate),
  collectedMs: parseDateTime(r.collected),
  dispatchedMs: parseDateTime(r.dispatched),
  receivedMs: parseDateTime(r.received),
  resultedMs: parseDateTime(r.resulted),
  // DUE DATE, recomputed here from received + StdTAT with the shared workday()
  // primitive. NOT `_cachedDue`: that field is the workbook's Sat/Sun-weekend
  // answer and 189 of the 628 rows now legitimately differ from it.
  dueMs: dueOf(r),
  cancelled: r.rawStatus === 'Order Cancelled',
  rejected: r.rawStatus === 'Result Rejected',
}));
const NC = R.filter((e) => !e.cancelled); // non-cancelled universe
const created = (e) => e.orderMs != null; // sheet's "order exists"
const count = (arr, f) => arr.filter(f).length;

// Independent success ("on-time"): non-rejected resulted row whose resulted day is
// on or before the due day, INCLUSIVE — resulting ON the due day meets the TAT.
// That inclusiveness is unchanged by the 2026-08-05 rules; only the due day moved.
const isOnTime = (e) => !e.rejected && e.resultedMs != null && e.dueMs != null
  && toEpochDay(e.resultedMs) <= toEpochDay(e.dueMs);
// Independent late-no-result, re-implemented under the NEW rule (Talal 2026-08-05):
// still unresulted, not rejected/cancelled, and the due day is TODAY or PAST
// (`asOf >= due`, where it used to be a strict `>`). Note this points the OPPOSITE
// way to isOnTime at the boundary and that is the intended asymmetry: due today
// with a result = on time, due today with NO result = late ("<24h left, nothing to
// show"). Was `_cachedStatus === 'Late'`, the workbook's strictly-past-due label.
const isLateNoResult = (e) => e.resultedMs == null && !e.rejected && e.dueMs != null
  && ASOF_DAY >= toEpochDay(e.dueMs);

// ---------------------------------------------------------------------------
// 1. STAGE PARTITION — تقسيم المراحل يساوي الإجمالي
//    total = awaitingDispatch + shippedNotReceived + awaitingResults + completed
//
// DEFINITION CHANGE 2026-07-28 ("consider rejected as completed test"): `completed`
// is now non-cancelled AND (a Result report date OR rejected), because rejection is
// a lab's FINAL outcome. `rejected` is still published as its own value but is a
// SUBSET of completed, so it is NO LONGER a partition term — the old five-way sum
// (…+ completed + rejected) would double-count the 15 rejected rows.
// ---------------------------------------------------------------------------
test('STAGE PARTITION — الإجمالي = بانتظار الإرسال + مُرسل غير مُستلم + بانتظار النتائج + مكتمل / total splits exactly into the four disjoint buckets (rejected is inside completed)', () => {
  const ind = {
    awaitingDispatch: count(NC, (e) => e.dispatchedMs == null && created(e)),
    shippedNotReceived: count(NC, (e) => e.dispatchedMs != null && e.receivedMs == null),
    awaitingResults: count(NC, (e) => e.receivedMs != null && e.resultedMs == null && !e.rejected),
    completed: count(NC, (e) => e.resultedMs != null || e.rejected),
    rejected: count(NC, (e) => e.rejected),
  };
  const total = NC.length;

  for (const k of Object.keys(ind)) {
    assert.equal(out.buckets[k], ind[k],
      `المرحلة "${k}" لا تطابق الحساب المستقل / stage bucket "${k}" disagrees with independent recount`);
  }
  assert.equal(out.totals.total, total,
    'إجمالي غير الملغاة لا يطابق / non-cancelled total disagrees with independent recount');
  const sum = ind.awaitingDispatch + ind.shippedNotReceived + ind.awaitingResults + ind.completed;
  assert.equal(sum, total,
    'تقسيم المراحل لا يجمع إلى الإجمالي (مراحل متداخلة) / STAGE PARTITION broken: buckets do not sum to total (overlap/gap)');

  // rejected ⊂ completed, and completed = dated ∪ rejected counted ONCE.
  const indDated = count(NC, (e) => e.resultedMs != null);
  const indBoth = count(NC, (e) => e.resultedMs != null && e.rejected);
  assert.ok(ind.rejected <= ind.completed,
    '"مرفوض" يجب أن يكون ضمن "مكتمل" / rejected must be a SUBSET of completed');
  assert.equal(out.buckets.completed, indDated + ind.rejected - indBoth,
    '"مكتمل" لا يساوي (له تاريخ نتيجة ∪ مرفوض) بدون ازدواج / completed !== |dated ∪ rejected| (double count)');
  // Golden data property the +15 delta rests on: no rejected row carries a result date.
  assert.equal(indBoth, 0, 'صف مرفوض يحمل تاريخ نتيجة / a rejected row carries a result date');
  assert.equal(out.buckets.completed - indDated, 15,
    'فرق التعريف الجديد ليس 15 صفاً مرفوضاً / the definition change must add exactly the 15 rejected rows');
});

// ---------------------------------------------------------------------------
// 2. FUNNEL MONOTONIC + final stage === buckets.completed
//    The final stage is COMPLETED (result date OR rejected) since 2026-07-28;
//    `funnel.resulted` is kept as an alias carrying the identical number.
// ---------------------------------------------------------------------------
test('FUNNEL — القمع متناقص ومرحلته الأخيرة تساوي "مكتمل" / funnel is monotonic non-increasing and its final stage === completed', () => {
  const f = {
    created: count(NC, created),
    collected: count(NC, (e) => e.collectedMs != null),
    dispatched: count(NC, (e) => e.dispatchedMs != null),
    received: count(NC, (e) => e.receivedMs != null),
    resulted: count(NC, (e) => e.resultedMs != null || e.rejected),
    completed: count(NC, (e) => e.resultedMs != null || e.rejected),
  };
  for (const k of Object.keys(f)) {
    assert.equal(out.funnel[k], f[k],
      `مرحلة القمع "${k}" لا تطابق الحساب المستقل / funnel stage "${k}" disagrees with independent recount`);
  }
  const seq = [out.funnel.created, out.funnel.collected, out.funnel.dispatched, out.funnel.received, out.funnel.completed];
  for (let i = 1; i < seq.length; i++) {
    assert.ok(seq[i] <= seq[i - 1],
      `القمع غير متناقص عند الخطوة ${i} (${seq[i - 1]} ثم ${seq[i]}) / funnel not monotonic at step ${i} (${seq[i - 1]} then ${seq[i]})`);
  }
  assert.equal(out.funnel.completed, out.buckets.completed,
    '"مُنجز" في القمع لا يساوي "مكتمل" في المراحل / funnel.completed !== buckets.completed');
  assert.equal(out.funnel.resulted, out.funnel.completed,
    'الاسم القديم funnel.resulted لا يطابق funnel.completed / legacy funnel.resulted alias diverged');
});

// ---------------------------------------------------------------------------
// 3. MONTHLY — orders = results + pending ; Σorders = total ; Σresults = completed
//    `results` follows the COMPLETED rule (result date OR rejected) since
//    2026-07-28, so `rejected` is a SUBSET of it and pending = orders − results.
// ---------------------------------------------------------------------------
test('MONTHLY — الطلبات = النتائج + المعلّقة لكل الأشهر / per-month orders = results + pending, and the column sums tie back', () => {
  const byMonth = new Map();
  for (const e of NC) {
    if (!created(e)) continue;
    const m = monthKey(e.orderMs);
    if (!byMonth.has(m)) byMonth.set(m, { orders: 0, results: 0, rejected: 0 });
    const g = byMonth.get(m);
    g.orders++;
    if (e.resultedMs != null || e.rejected) g.results++; // completed rule
    if (e.rejected) g.rejected++;
  }

  let sumOrders = 0;
  let sumResults = 0;
  for (const em of out.monthly) {
    const ind = byMonth.get(em.month) || { orders: 0, results: 0, rejected: 0 };
    assert.equal(em.orders, ind.orders,
      `طلبات الشهر ${em.month} لا تطابق الحساب المستقل / monthly orders for ${em.month} disagree with independent recount`);
    assert.equal(em.results, ind.results,
      `نتائج الشهر ${em.month} لا تطابق الحساب المستقل / monthly results for ${em.month} disagree with independent recount`);
    assert.equal(em.rejected, ind.rejected,
      `مرفوضات الشهر ${em.month} لا تطابق الحساب المستقل / monthly rejected for ${em.month} disagree with independent recount`);

    // rejected is INSIDE results now — subtracting it again would be a double count.
    assert.ok(em.rejected <= em.results,
      `مرفوضات الشهر ${em.month} يجب أن تكون ضمن نتائجه / monthly rejected for ${em.month} must be a SUBSET of results`);
    const derivedPending = em.orders - em.results;
    assert.equal(em.pending, derivedPending,
      `معلّق الشهر ${em.month} لا يساوي (طلبات − نتائج) / monthly pending for ${em.month} !== orders − results`);
    assert.equal(em.incomplete, derivedPending,
      `غير المكتمل للشهر ${em.month} لا يساوي (طلبات − نتائج) / monthly incomplete for ${em.month} !== orders − results`);
    assert.equal(em.orders, em.results + em.pending,
      `هوية الشهر ${em.month}: الطلبات ≠ النتائج + المعلّقة / MONTHLY identity ${em.month}: orders !== results + pending`);

    sumOrders += em.orders;
    sumResults += em.results;
  }

  assert.equal(sumOrders, out.totals.total,
    'مجموع طلبات الأشهر لا يساوي الإجمالي / Σ monthly orders !== totals.total');
  assert.equal(sumResults, out.buckets.completed,
    'مجموع نتائج الأشهر لا يساوي "مكتمل" / Σ monthly results !== buckets.completed');
});

// ---------------------------------------------------------------------------
// 4. BYLAB — per-lab partition + column sums equal the stage buckets
//    HEADLINE: total = pipeline + awaitingResult + completed   (2026-07-28)
//    FINER   : total = pipeline + awaitingResult + onTime + resultedLate + rejected
// ---------------------------------------------------------------------------
test('BYLAB — تقسيم كل مختبر ومجاميع الأعمدة تساوي المراحل / per-lab partition holds and byLab column sums equal the stage buckets', () => {
  // Per-lab partition (engine rows must each sum to their own total).
  const S = {
    total: 0, pipeline: 0, awaitingResult: 0, completed: 0,
    onTime: 0, resultedLate: 0, rejected: 0, late: 0,
  };
  for (const l of out.byLab) {
    assert.equal(l.pipeline + l.awaitingResult + l.completed, l.total,
      `تقسيم المختبر "${l.lab}" لا يجمع إلى إجماليه / by-lab HEADLINE partition for "${l.lab}" does not sum to its total`);
    assert.equal(l.pipeline + l.awaitingResult + l.onTime + l.resultedLate + l.rejected, l.total,
      `تقسيم المختبر "${l.lab}" التفصيلي لا يجمع إلى إجماليه / by-lab finer partition for "${l.lab}" does not sum to its total`);
    assert.equal(l.completed, l.onTime + l.resultedLate + l.rejected,
      `"مكتمل" للمختبر "${l.lab}" ≠ (في الوقت + متأخر مُنجز + مرفوض) / completed for "${l.lab}" !== onTime + resultedLate + rejected`);
    for (const k of Object.keys(S)) S[k] += l[k];
  }

  // Independent recompute of the aggregates the byLab columns must reconcile to.
  const indAwaitingResult = count(NC, (e) => e.receivedMs != null && e.resultedMs == null && !e.rejected);
  const indRejected = count(NC, (e) => e.rejected);
  const indOnTime = count(NC, isOnTime);
  const indLate = count(NC, isLateNoResult);
  const indPipeline = count(NC, (e) => !e.rejected && e.receivedMs == null);

  assert.equal(S.awaitingResult, indAwaitingResult,
    'مجموع "بانتظار النتيجة" في المختبرات لا يطابق الحساب المستقل / Σ byLab awaitingResult disagrees with independent recount');
  assert.equal(S.rejected, indRejected,
    'مجموع "مرفوض" في المختبرات لا يطابق الحساب المستقل / Σ byLab rejected disagrees with independent recount');
  assert.equal(S.onTime, indOnTime,
    'مجموع "في الوقت" في المختبرات لا يطابق الحساب المستقل / Σ byLab onTime disagrees with independent recount');
  assert.equal(S.late, indLate,
    'مجموع "متأخر بلا نتيجة" في المختبرات لا يطابق الحساب المستقل / Σ byLab late disagrees with independent recount');
  assert.equal(S.pipeline, indPipeline,
    'مجموع "قيد الإرسال/النقل" في المختبرات لا يطابق الحساب المستقل / Σ byLab pipeline disagrees with independent recount');

  // Cross-surface: byLab column sums === the stage buckets / totals.
  assert.equal(S.total, out.totals.total,
    'مجموع إجماليات المختبرات ≠ الإجمالي / Σ byLab total !== totals.total');
  assert.equal(S.awaitingResult, out.buckets.awaitingResults,
    'مجموع "بانتظار النتيجة" ≠ "بانتظار النتائج" في المراحل / Σ byLab awaitingResult !== buckets.awaitingResults');
  assert.equal(S.rejected, out.buckets.rejected,
    'مجموع "مرفوض" في المختبرات ≠ "مرفوض" في المراحل / Σ byLab rejected !== buckets.rejected');
  assert.equal(S.completed, out.buckets.completed,
    'مجموع "مكتمل" في المختبرات ≠ "مكتمل" في المراحل / Σ byLab completed !== buckets.completed');
  assert.equal(S.onTime + S.resultedLate + S.rejected, out.buckets.completed,
    'مجموع (في الوقت + متأخر مُنجز + مرفوض) ≠ "مكتمل" / Σ byLab (onTime + resultedLate + rejected) !== buckets.completed');
  // Cross-surface: the compliance column, the monthly results row and the funnel's
  // final stage must all print the SAME "مكتمل" number as the exec KPI card.
  assert.equal(S.completed, out.funnel.completed,
    'عمود "مكتمل" ≠ المرحلة الأخيرة في القمع / Σ byLab completed !== funnel.completed');
  assert.equal(S.completed, out.monthly.reduce((s, m) => s + m.results, 0),
    'عمود "مكتمل" ≠ مجموع صف النتائج الشهري / Σ byLab completed !== Σ monthly results');
  assert.equal(S.late, out.buckets.lateNoResult,
    'مجموع "متأخر بلا نتيجة" في المختبرات ≠ "متأخر بلا نتيجة" في المراحل / Σ byLab late !== buckets.lateNoResult');
});

// ---------------------------------------------------------------------------
// 5. LATE% — latePct === round1(lateNoResult / awaitingResults * 100)
// ---------------------------------------------------------------------------
test('LATE% — نسبة التأخير = تقريب1(المتأخر بلا نتيجة ÷ بانتظار النتائج × 100) / latePct === round1(lateNoResult / awaitingResults * 100)', () => {
  const indLate = count(NC, isLateNoResult);
  const indAwaiting = count(NC, (e) => e.receivedMs != null && e.resultedMs == null && !e.rejected);
  const expected = indAwaiting > 0 ? round1((indLate / indAwaiting) * 100) : 0;
  assert.equal(out.buckets.latePct, expected,
    `نسبة التأخير المنشورة ${out.buckets.latePct} ≠ المحسوبة مستقلاً ${expected} / published latePct !== independent round1(lateNoResult/awaitingResults*100)`);
});

// ---------------------------------------------------------------------------
// 6. BYTEST — each catalog late ≤ that test's independent late-no-result count,
//    and Σ byTest.late ≤ lateNoResult (the chart is a catalog SUBSET).
// ---------------------------------------------------------------------------
test('BYTEST — كل تأخير فحص ≤ تأخيره المستقل ومجموعها ≤ إجمالي المتأخر / each byTest.late ≤ its independent late-no-result and the sum ≤ lateNoResult', () => {
  const lateByTest = new Map();
  for (const e of NC) {
    if (isLateNoResult(e)) {
      const k = norm(e.testName);
      lateByTest.set(k, (lateByTest.get(k) || 0) + 1);
    }
  }
  let sumLate = 0;
  for (const t of out.byTest) {
    const ind = lateByTest.get(norm(t.testName)) || 0;
    assert.ok(t.late <= ind,
      `تأخير الفحص "${t.testName}" (${t.late}) يتجاوز حسابه المستقل (${ind}) / byTest.late for "${t.testName}" exceeds its independent late-no-result count`);
    sumLate += t.late;
  }
  assert.ok(sumLate <= out.buckets.lateNoResult,
    `مجموع تأخير الفحوصات (${sumLate}) يتجاوز إجمالي المتأخر بلا نتيجة (${out.buckets.lateNoResult}) / Σ byTest.late exceeds buckets.lateNoResult (catalog is not a subset)`);
});

// ---------------------------------------------------------------------------
// 7. CANCELLED — cancelledNote === Σ(manual map) + in-data cancelled rows (with a month)
// ---------------------------------------------------------------------------
test('CANCELLED — ملاحظة الملغاة = مجموع اليدوي + الملغاة في البيانات / cancelledNote === Σ(manual map) + independent in-data cancelled count', () => {
  const manualSum = Object.values(OPTS.cancelledByMonth || {}).reduce((a, b) => a + Number(b || 0), 0);
  const inDataWithMonth = count(R, (e) => e.cancelled && monthKey(e.orderMs) != null);
  const allCancelled = count(R, (e) => e.cancelled);

  assert.equal(out.totals.cancelledInData, allCancelled,
    'عدد الملغاة في البيانات لا يطابق الحساب المستقل / totals.cancelledInData disagrees with independent count');
  assert.equal(out.cancelledNote, manualSum + inDataWithMonth,
    `ملاحظة الملغاة ${out.cancelledNote} ≠ اليدوي ${manualSum} + الملغاة بشهر ${inDataWithMonth} / cancelledNote !== Σ(manual) + in-data cancelled-with-month`);
});

// ---------------------------------------------------------------------------
// 8. COMPLETION% — per-month completionPct === round1(results/orders*100) (null when orders 0)
// ---------------------------------------------------------------------------
test('COMPLETION% — نسبة الإنجاز الشهرية = تقريب1(النتائج ÷ الطلبات × 100) / per-month completionPct === round1(results/orders*100), null when orders 0', () => {
  for (const em of out.monthly) {
    const expected = em.orders > 0 ? round1((em.results / em.orders) * 100) : null;
    assert.equal(em.completionPct, expected,
      `نسبة إنجاز الشهر ${em.month} المنشورة ${em.completionPct} ≠ المحسوبة ${expected} / completionPct for ${em.month} !== round1(results/orders*100)`);
  }
});
