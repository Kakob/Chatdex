// Provenance summary for an understanding object promoted from a Change
// Workspace (SPEC-change-workspace §14, PRD §17; CW-6). Computed from the
// workspace's trace, questions, and the LOCAL-ONLY inspection log.

import { getPreparedChange } from '../db/preparedChanges';
import { listInspectionsForWorkspace } from '../db/inspections';
import { questionsForWorkspace } from './promote';
import { traceSummary } from './trace';
import type { UnderstandingObject } from '../../types/understanding';

export interface FromWorkspaceSummary {
  workspaceId: string;
  projectId: string;
  title: string;
  verified: number;
  aiInferred: number;
  unknown: number;
  openQuestions: number;
  inspections: number;
}

export async function loadFromWorkspaceLine(object: UnderstandingObject): Promise<FromWorkspaceSummary | null> {
  const workspaceId = object.meta?.workspaceId;
  if (typeof workspaceId !== 'string') return null;
  const change = await getPreparedChange(workspaceId);
  if (!change) return null;
  const summary = traceSummary(change.trace, change.evidence ?? []);
  const [questions, inspections] = await Promise.all([questionsForWorkspace(change), listInspectionsForWorkspace(change.id)]);
  return {
    workspaceId,
    projectId: change.projectId,
    title: change.title,
    verified: summary.byVerification.verified,
    aiInferred: summary.byVerification.ai_inference,
    unknown: summary.byVerification.unknown,
    openQuestions: questions.filter((q) => q.status === 'current').length,
    inspections: inspections.length,
  };
}

