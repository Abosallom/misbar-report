// model/report-model.js — assemble the single ReportModel consumed by build-spec.
// Auto-drafts from the tracker are shallow-merged with the reviewer's edits.
import { autoDraft } from './drafts.js?v=v2026-07-22.9';

/**
 * buildReportModel({engineOutput, tracker, settings, reportDate, edits}) -> ReportModel
 *
 * edits is a partial override bundle from the review screen:
 *   { panels?, tasksCurrent?, tasksInternal?, challenges?, risks? }
 *   - panels is shallow-merged per key over the auto-drafted panels.
 *   - task/challenge/risk lists, when present, replace the auto-drafted list wholesale.
 *
 * @returns {import('../contracts.js').ReportModel}
 */
export function buildReportModel({ engineOutput, tracker, settings, reportDate, edits = {} }) {
  const draft = autoDraft(tracker, reportDate);

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

  return {
    reportDate,
    kpi: engineOutput,
    panels,
    tasksCurrent,
    tasksInternal,
    challenges,
    risks,
    scorecard: (settings && settings.scorecard) || [],
    displayNames: (settings && settings.displayNames) || {},
  };
}
