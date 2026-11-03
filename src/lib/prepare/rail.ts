// Change Workspace rail model (SPEC-change-workspace §14; CW-6): section
// labels, order, anchors, and per-section progress derived from the record.

import { WORKSPACE_SECTIONS, type WorkspaceSection } from './editability';
import { verificationSummary } from './verification';
import type { PreparedChange } from '../../types/preparedChange';

export const SECTION_LABEL: Record<WorkspaceSection, string> = {
  intent: 'Intent & criteria',
  criteria: 'Criteria',
  evidence: 'Evidence',
  trace: 'My trace',
  hypotheses: 'My hypothesis',
  implementation: 'Implementation',
  verification: 'Verification',
  learned: 'What I learned',
  promotions: 'Promote',
  questions: 'Questions',
};

/** Rail order: criteria folds into the intent section on the page. */
export const RAIL_SECTIONS: WorkspaceSection[] = WORKSPACE_SECTIONS.filter((s) => s !== 'criteria');

export type SectionProgress = 'empty' | 'started' | 'done';

export function sectionProgress(change: PreparedChange): Record<WorkspaceSection, SectionProgress> {
  const intentDone = Boolean(change.intent?.desiredBehavior?.trim() || change.desiredOutcome.trim());
  const criteriaDone = (change.criteria?.length ?? change.acceptanceCriteria.length) > 0;
  const summary = verificationSummary(change);
  const verificationDone = summary.total > 0 && summary.blocking.length === 0 && summary.byStatus.unverified < summary.total;
  return {
    intent: intentDone && criteriaDone ? 'done' : intentDone || criteriaDone ? 'started' : 'empty',
    criteria: criteriaDone ? 'done' : 'empty',
    evidence: (change.evidence?.length ?? 0) > 0 ? 'done' : 'empty',
    trace: (change.trace?.edges.length ?? 0) > 0 ? 'done' : (change.trace?.nodes.length ?? 0) > 0 ? 'started' : 'empty',
    hypotheses: (change.hypotheses?.length ?? 0) > 0 ? 'done' : 'empty',
    implementation: change.implementation ? 'done' : 'empty',
    verification: verificationDone ? 'done' : change.verification?.some((r) => r.status !== 'unverified' || r.note) ? 'started' : 'empty',
    learned: change.learned?.text.trim() ? 'done' : 'empty',
    promotions: (change.promotions?.length ?? 0) > 0 ? 'done' : 'empty',
    questions: (change.questionIds?.length ?? 0) > 0 ? 'done' : 'empty',
  };
}

export function sectionAnchor(section: WorkspaceSection): string {
  return `ws-${section}`;
}
