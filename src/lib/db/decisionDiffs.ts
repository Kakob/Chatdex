// Semantic Decision Diffs (SPEC-decision-recovery §12). LOCAL-ONLY, derived:
// a diff is a pure function of two runs' traces, so any device can rebuild
// it. Ids are `${fromRunId}..${toRunId}`, making persistence idempotent.

import { db } from './schema';
import type { DecisionDiff } from '../../types/decision';

export function decisionDiffId(fromRunId: string, toRunId: string): string {
  return `${fromRunId}..${toRunId}`;
}

export async function putDecisionDiff(diff: DecisionDiff): Promise<void> {
  await db.decisionDiffs.put(diff);
}

export async function getDecisionDiff(
  fromRunId: string,
  toRunId: string
): Promise<DecisionDiff | undefined> {
  return db.decisionDiffs.get(decisionDiffId(fromRunId, toRunId));
}

/** All persisted diffs for a project, newest first. */
export async function listDecisionDiffsForProject(projectId: string): Promise<DecisionDiff[]> {
  const rows = await db.decisionDiffs.where('projectId').equals(projectId).toArray();
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function clearDecisionDiffsForProject(projectId: string): Promise<number> {
  return db.decisionDiffs.where('projectId').equals(projectId).delete();
}
