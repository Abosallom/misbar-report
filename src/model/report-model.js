// model/report-model.js — assemble the single ReportModel consumed by build-spec.
// ONE hospital's numbers per model (KAMC or SGH): unchanged by the per-hospital work.
// The per-hospital builders (KAMC / SGH / KAMC+SGH) live in model/hospital-report.js,
// which calls this for each hospital with that hospital's own engine output and rows.
//
// THE PROJECT TRACKER (2026-10-13, tracker CONTRACT §1.4): the model carries the NEW
// «ملف متابعة المشروع» as ONE field, `projectTracker` (the tagged ProjectTracker the
// upload screen parses / the settings cache holds, or null). Nothing is drafted from it
// any more: the old tasksCurrent / tasksInternal split (model/drafts.js) and the
// closed-task-once log (model/task-lifecycle.js, settings.taskLog) keyed on the OLD
// file's Arabic categories and statuses — the new file has neither, a stable WBS id and
// an explicit 'Completed' status, so the tracker slides show the document as it is.
// drafts.js / task-lifecycle.js stay importable (their own tests, old backups), inert.
import { analyseSendout, hasMaster } from './sendout.js?v=v2026-10-18.3';
// The ProjectTracker's shape is owned by the ingest module (a leaf: no imports, no DOM).
// isProjectTracker = the tag check: a value without TRACKER_FORMAT is the OLD format (an
// install or a backup from before 2026-10-13) and is never fed on.
import { isProjectTracker } from '../ingest/task-tracker.js?v=v2026-10-18.3';

// The tracker status history's recording rule (model/tracker-status.js, pure) — used here
// only to PROJECT the stored history onto a document that is not saved yet (below).
import { recordStatusLog } from './tracker-status.js?v=v2026-10-18.3';

export { isProjectTracker };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The tracker status history a model carries (`trackerStatusLog` — the weekly «المهام
 * المكتملة خلال الأسبوع» slide reads it): settings.trackerStatusLog as stored, else null.
 * The ONE rule every builder applies, like projectTrackerFor for the document itself.
 * @returns {import('../contracts.js').TrackerStatusLog|null}
 */
export function trackerStatusLogOf(settings) {
  const log = settings && settings.trackerStatusLog;
  return isObj(log) ? log : null;
}

/**
 * The stored history WITH `tracker`'s current statuses recorded as of `atISO` — what the
 * store will hold once the review's debounced save of this document lands (it records with
 * the very same rule, recordStatusLog). WHY: the review previews (and may generate) a task
 * marked «مكتمل» a moment ago; the weekly slide must show it now, not after the save
 * debounce and a re-render. Pure (a NEW log; settings untouched). Falls back to the stored
 * history when there is no tracker, no usable date, or the module fails.
 * @returns {import('../contracts.js').TrackerStatusLog|null}
 */
export function projectedStatusLog(settings, tracker, atISO) {
  const log = trackerStatusLogOf(settings);
  if (!isProjectTracker(tracker) || !/^\d{4}-\d{2}-\d{2}$/.test(String(atISO || ''))) return log;
  try {
    const next = recordStatusLog(log || { v: 1, tasks: {} }, tracker, atISO);
    return isObj(next) ? next : log;
  } catch {
    return log;
  }
}

/**
 * The ProjectTracker a report carries: the run's parsed one (state.parsed.tracker), else
 * the persisted document (settings.cachedTracker — `{model, updatedAt}` as store.js
 * writes it; a bare tagged tracker is tolerated), else null. Anything UNTAGGED — the old
 * {tasks, challenges, risks} shape, a half-written cache — counts as "no tracker": no
 * tracker slides, never the old rows under the new design and never a mock.
 * Returns the very object (no copy): the review editor edits the model's tracker and
 * persists it through store.updateCachedTracker, so the two must stay one document.
 * @returns {Object|null} the ProjectTracker or null
 */
export function resolveProjectTracker(tracker, settings) {
  if (isProjectTracker(tracker)) return tracker;
  const ct = settings && settings.cachedTracker;
  if (ct && isProjectTracker(ct.model)) return ct.model;
  if (isProjectTracker(ct)) return ct;
  return null;
}

/**
 * The `projectTracker` a model built from (tracker, settings, edits) carries — the ONE rule
 * every builder applies (buildReportModel here, hospital-report.js buildBothModel's top
 * level): a review edit (`edits.projectTracker`, even null) wins, else
 * resolveProjectTracker. An untagged edit counts as null, like an untagged cache.
 * @returns {Object|null}
 */
export function projectTrackerFor(tracker, settings, edits) {
  if (edits && edits.projectTracker !== undefined) {
    return isProjectTracker(edits.projectTracker) ? edits.projectTracker : null;
  }
  return resolveProjectTracker(tracker, settings);
}

/**
 * buildReportModel({engineOutput, tracker, settings, reportDate, orders, sendoutMaster, edits}) -> ReportModel
 *
 * `tracker` is the run's parsed ProjectTracker (state.parsed.tracker) or null; the model's
 * `projectTracker` falls back to settings.cachedTracker (resolveProjectTracker).
 *
 * edits is a partial override bundle from the review screen:
 *   { projectTracker?, panels?, challenges?, risks? }
 *   - projectTracker, when present (even null), replaces the resolved tracker.
 *   - panels is shallow-merged per key over the (empty) default panels.
 *   - challenges / risks, when present, replace the empty default list. They are MANUAL
 *     content now (the new tracker file has no challenge / risk sheets): the single-hospital
 *     deck renders its challenges slide only when they are non-empty.
 *
 * @returns {import('../contracts.js').ReportModel}
 */
export function buildReportModel({
  engineOutput, tracker, settings, reportDate, orders, sendoutMaster, edits = {},
}) {
  const ed = edits || {};
  const projectTracker = projectTrackerFor(tracker, settings, ed);

  // supportRequired stays (build-spec's challenges slide reads it) but nothing drafts it:
  // the old source — solutions of open challenges in the old file — no longer exists.
  const panels = { supportRequired: [], ...(ed.panels || {}) };
  const challenges = ed.challenges ?? [];
  const risks = ed.risks ?? [];

  // Send-out attribution needs the ORDER ROWS (which the engine output does not
  // carry) AND the decrypted catalogue (which ships encrypted, so it cannot be
  // imported). Both are optional: without either, the model carries no sendout
  // block and build-spec omits both slides rather than rendering empty ones —
  // never a deck that attributes orders to the wrong country.
  const sendout = (Array.isArray(orders) && orders.length && hasMaster(sendoutMaster))
    ? analyseSendout(orders, sendoutMaster)
    : null;

  return {
    reportDate,
    kpi: engineOutput,
    sendout,
    panels,
    projectTracker,
    // The tracker status history (the weekly completed-tasks slide), as stored.
    trackerStatusLog: ed.trackerStatusLog !== undefined ? ed.trackerStatusLog : trackerStatusLogOf(settings),
    challenges,
    risks,
    scorecard: (settings && settings.scorecard) || [],
    displayNames: (settings && settings.displayNames) || {},
  };
}
