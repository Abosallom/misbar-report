// model/report-model.js — assemble the single ReportModel consumed by build-spec.
// Auto-drafts from the tracker are shallow-merged with the reviewer's edits.
import { autoDraft } from './drafts.js?v=v2026-08-31.4';
import { analyseSendout, hasMaster } from './sendout.js?v=v2026-08-31.4';

/**
 * buildReportModel({engineOutput, tracker, settings, reportDate, orders, sendoutMaster, edits}) -> ReportModel
 *
 * edits is a partial override bundle from the review screen:
 *   { panels?, tasksCurrent?, tasksInternal?, challenges?, risks? }
 *   - panels is shallow-merged per key over the auto-drafted panels.
 *   - task/challenge/risk lists, when present, replace the auto-drafted list wholesale.
 *
 * @returns {import('../contracts.js').ReportModel}
 */
export function buildReportModel({
  engineOutput, tracker, settings, reportDate, orders, sendoutMaster, edits = {},
}) {
  // settings.taskLog drives the closed-task grace rule (model/task-lifecycle.js).
  // Threading it here covers the automation path for free — the unattended run
  // builds its model through this very function.
  const draft = autoDraft(tracker, reportDate, { taskLog: settings && settings.taskLog });

  const draftPanels = {
    supportRequired: draft.supportRequired,
    completedTasks: draft.completedTasks,
    plannedTasks: draft.plannedTasks,
  };
  const panels = { ...draftPanels, ...(edits.panels || {}) };

  const tasksCurrent = edits.tasksCurrent ?? draft.tasksCurrent;
  const tasksInternal = edits.tasksInternal ?? draft.tasksInternal;
  const challenges = edits.challenges ?? ((tracker && tracker.challenges) || []);
  const risks = edits.risks ?? ((tracker && tracker.risks) || []);

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
    tasksCurrent,
    tasksInternal,
    challenges,
    risks,
    scorecard: (settings && settings.scorecard) || [],
    displayNames: (settings && settings.displayNames) || {},
  };
}
