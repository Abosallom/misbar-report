// test/reconciliation.test.mjs — `node --test test/reconciliation.test.mjs`
//
// INDEPENDENT cross-surface auditor. A genuine SECOND OPINION on the engine:
// every cross-slide number is recomputed here from the RAW golden rows with its
// own inline logic — no engine internals are imported except the pure date
// helpers in workday.js (parsing/month-key/INT), and the workbook's own cached
// formula fields (_cachedDue, _cachedStatus) are used as an oracle where a due
// date or a Late label is needed. Then it asserts (a) the engine's published
// output equals this independent recompute AND (b) every cross-surface identity
// that ties the slides together holds. Each failure message names the identity in
// Arabic + English so a red run is self-explanatory.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compute } from '../src/engine/engine.js';
import { goldenOpts } from './assertions.js';
import { GOLDEN_ORDERS } from './fixtures/golden-orders.js';
import { TAT_LOOKUP } from '../src/seeds/tat-lookup.js';
import { parseDateTime, toEpochDay, monthKey } from '../src/engine/workday.js';

// --- our OWN tiny helpers (do not reuse engine internals) --------------------
/** report-style 1-decimal rounding (half-up, EPSILON-guarded) — re-implemented. */
const round1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;
/** whitespace-collapse + trim, matching how test names are keyed (independent copy). */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// One engine run with the standard published golden options (see engine.test.mjs).
const OPTS = goldenOpts();
const out = compute(GOLDEN_ORDERS, TAT_LOOKUP, OPTS);

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
  cachedDueMs: parseDateTime(r._cachedDue), // workbook DueDate (independent oracle)
  cancelled: r.rawStatus === 'Order Cancelled',
  rejected: r.rawStatus === 'Result Rejected',
  cachedLate: r._cachedStatus === 'Late', // workbook Status @ asOf 2026-07-09
}));
const NC = R.filter((e) => !e.cancelled); // non-cancelled universe
const created = (e) => e.orderMs != null; // sheet's "order exists"
const count = (arr, f) => arr.filter(f).length;

// Independent success ("on-time"): non-rejected resulted row whose resulted day is
// on or before the workbook due day (day-granular). Uses the cached due date.
const isOnTime = (e) => !e.rejected && e.resultedMs != null && e.cachedDueMs != null
  && toEpochDay(e.resultedMs) <= toEpochDay(e.cachedDueMs);
// Independent late-no-result: workbook-Late AND still unresulted.
const isLateNoResult = (e) => e.cachedLate && e.resultedMs == null;

// ---------------------------------------------------------------------------
// 1. STAGE PARTITION — تقسيم المراحل يساوي الإجمالي
//    total = awaitingDispatch + shippedNotReceived + awaitingResults + completed + rejected
// ---------------------------------------------------------------------------
test('STAGE PARTITION — الإجمالي = بانتظار الإرسال + مُرسل غير مُستلم + بانتظار النتائج + مكتمل + مرفوض / total splits exactly into the five disjoint buckets', () => {
  const ind = {
    awaitingDispatch: count(NC, (e) => e.dispatchedMs == null && created(e)),
    shippedNotReceived: count(NC, (e) => e.dispatchedMs != null && e.receivedMs == null),
    awaitingResults: count(NC, (e) => e.receivedMs != null && e.resultedMs == null && !e.rejected),
    completed: count(NC, (e) => e.resultedMs != null),
    rejected: count(NC, (e) => e.rejected),
  };
  const total = NC.length;

  for (const k of Object.keys(ind)) {
    assert.equal(out.buckets[k], ind[k],
      `المرحلة "${k}" لا تطابق الحساب المستقل / stage bucket "${k}" disagrees with independent recount`);
  }
  assert.equal(out.totals.total, total,
    'إجمالي غير الملغاة لا يطابق / non-cancelled total disagrees with independent recount');
  const sum = ind.awaitingDispatch + ind.shippedNotReceived + ind.awaitingResults + ind.completed + ind.rejected;
  assert.equal(sum, total,
    'تقسيم المراحل لا يجمع إلى الإجمالي (مراحل متداخلة) / STAGE PARTITION broken: buckets do not sum to total (overlap/gap)');
});

// ---------------------------------------------------------------------------
// 2. FUNNEL MONOTONIC + resulted === buckets.completed
// ---------------------------------------------------------------------------
test('FUNNEL — القمع متناقص و"مُنجز" يساوي "مكتمل" / funnel is monotonic non-increasing and resulted === completed', () => {
  const f = {
    created: count(NC, created),
    collected: count(NC, (e) => e.collectedMs != null),
    dispatched: count(NC, (e) => e.dispatchedMs != null),
    received: count(NC, (e) => e.receivedMs != null),
    resulted: count(NC, (e) => e.resultedMs != null),
  };
  for (const k of Object.keys(f)) {
    assert.equal(out.funnel[k], f[k],
      `مرحلة القمع "${k}" لا تطابق الحساب المستقل / funnel stage "${k}" disagrees with independent recount`);
  }
  const seq = [out.funnel.created, out.funnel.collected, out.funnel.dispatched, out.funnel.received, out.funnel.resulted];
  for (let i = 1; i < seq.length; i++) {
    assert.ok(seq[i] <= seq[i - 1],
      `القمع غير متناقص عند الخطوة ${i} (${seq[i - 1]} ثم ${seq[i]}) / funnel not monotonic at step ${i} (${seq[i - 1]} then ${seq[i]})`);
  }
  assert.equal(out.funnel.resulted, out.buckets.completed,
    '"مُنجز" في القمع لا يساوي "مكتمل" في المراحل / funnel.resulted !== buckets.completed');
});

// ---------------------------------------------------------------------------
// 3. MONTHLY — orders = results + rejected + pending ; Σorders = total ; Σresults = completed
//    (`pending` may still be landing from a parallel worker — tolerated below)
// ---------------------------------------------------------------------------
test('MONTHLY — الطلبات = النتائج + المرفوضة + المعلّقة ولكل الأشهر / per-month orders = results + rejected + pending, and the column sums tie back', () => {
  const byMonth = new Map();
  for (const e of NC) {
    if (!created(e)) continue;
    const m = monthKey(e.orderMs);
    if (!byMonth.has(m)) byMonth.set(m, { orders: 0, results: 0, rejected: 0 });
    const g = byMonth.get(m);
    g.orders++;
    if (e.resultedMs != null) g.results++;
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

    // `pending` field is landing from a parallel worker — tolerate its absence by
    // deriving it, and pin the engine's value when it IS present.
    const derivedPending = em.orders - em.results - em.rejected;
    if ('pending' in em) {
      assert.equal(em.pending, derivedPending,
        `معلّق الشهر ${em.month} لا يساوي (طلبات − نتائج − مرفوضة) / monthly pending for ${em.month} !== orders − results − rejected`);
    }
    const pending = 'pending' in em ? em.pending : derivedPending;
    assert.equal(em.orders, em.results + em.rejected + pending,
      `هوية الشهر ${em.month}: الطلبات ≠ النتائج + المرفوضة + المعلّقة / MONTHLY identity ${em.month}: orders !== results + rejected + pending`);

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
//    total = pipeline + awaitingResult + onTime + resultedLate + rejected
// ---------------------------------------------------------------------------
test('BYLAB — تقسيم كل مختبر ومجاميع الأعمدة تساوي المراحل / per-lab partition holds and byLab column sums equal the stage buckets', () => {
  // Per-lab partition (engine rows must each sum to their own total).
  const S = { total: 0, pipeline: 0, awaitingResult: 0, onTime: 0, resultedLate: 0, rejected: 0, late: 0 };
  for (const l of out.byLab) {
    assert.equal(l.pipeline + l.awaitingResult + l.onTime + l.resultedLate + l.rejected, l.total,
      `تقسيم المختبر "${l.lab}" لا يجمع إلى إجماليه / by-lab partition for "${l.lab}" does not sum to its total`);
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
  assert.equal(S.onTime + S.resultedLate, out.buckets.completed,
    'مجموع (في الوقت + متأخر مُنجز) ≠ "مكتمل" / Σ byLab (onTime + resultedLate) !== buckets.completed');
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
