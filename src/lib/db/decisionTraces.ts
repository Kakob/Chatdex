// Decision traces (SPEC-decision-recovery §7.5): append-only per
// (decision, run). No update or delete helper — a new run adds rows; deletion
// happens only by cascade when the decision object is removed (sync engine).

import { db } from './schema';
import type { DecisionTrace } from '../../types/decision';

export async function putDecisionTrace(trace: DecisionTrace): Promise<void> {
  await db.decisionTraces.put(trace);
}

export async function getDecisionTrace(id: string): Promise<DecisionTrace | undefined> {
  return db.decisionTraces.get(id);
}

/** All traces for a project, newest first. */
export async function listDecisionTracesForProject(projectId: string): Promise<DecisionTrace[]> {
  const rows = await db.decisionTraces
    .where('[projectId+createdAt]')
    .between([projectId, new Date(0)], [projectId, new Date(8.64e15)])
    .toArray();
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Trace history for one decision, newest first. */
export async function listDecisionTracesForDecision(
  decisionObjectId: string
): Promise<DecisionTrace[]> {
  const rows = await db.decisionTraces
    .where('[decisionObjectId+createdAt]')
    .between([decisionObjectId, new Date(0)], [decisionObjectId, new Date(8.64e15)])
    .toArray();
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Every trace one run produced, in creation order. */
export async function listDecisionTracesForRun(
  projectId: string,
  runId: string
): Promise<DecisionTrace[]> {
  const rows = await db.decisionTraces.where('[projectId+runId]').equals([projectId, runId]).toArray();
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Newest trace per decision for a project — what the list renders. */
export async function getLatestTraceByDecision(
  projectId: string
): Promise<Map<string, DecisionTrace>> {
  const latest = new Map<string, DecisionTrace>();
  for (const trace of await listDecisionTracesForProject(projectId)) {
    if (!latest.has(trace.decisionObjectId)) latest.set(trace.decisionObjectId, trace);
  }
  return latest;
}

export interface RecoveryRunSummary {
  runId: string;
  createdAt: Date;
  repoKey?: string;
  sha?: string;
  traceCount: number;
}

/** Distinct runs for a project, newest first (for the run picker and the diff). */
export async function listRecoveryRuns(projectId: string): Promise<RecoveryRunSummary[]> {
  const byRun = new Map<string, RecoveryRunSummary>();
  for (const trace of await listDecisionTracesForProject(projectId)) {
    const existing = byRun.get(trace.runId);
    if (existing) {
      existing.traceCount++;
      if (trace.createdAt < existing.createdAt) existing.createdAt = trace.createdAt;
    } else {
      byRun.set(trace.runId, {
        runId: trace.runId,
        createdAt: trace.createdAt,
        repoKey: trace.repoKey,
        sha: trace.sha,
        traceCount: 1,
      });
    }
  }
  return [...byRun.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
