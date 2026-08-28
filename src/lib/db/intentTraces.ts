// Intent traces (docs/SPEC-intent-trace.md §11.3): append-only per
// (intent, commit). There is deliberately no update or delete helper — a
// re-trace at a new commit adds a row; deletion happens only by cascade when
// the intent object itself is removed (sync engine).

import { db } from './schema';
import type { IntentTrace } from '../../types/intentTrace';

export async function putIntentTrace(trace: IntentTrace): Promise<void> {
  await db.intentTraces.put(trace);
}

export async function getIntentTrace(id: string): Promise<IntentTrace | undefined> {
  return db.intentTraces.get(id);
}

/** All traces for a project, newest first. */
export async function listTracesForProject(projectId: string): Promise<IntentTrace[]> {
  const rows = await db.intentTraces
    .where('[projectId+createdAt]')
    .between([projectId, new Date(0)], [projectId, new Date(8.64e15)])
    .toArray();
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Trace history for one intent, newest first. */
export async function listTracesForIntent(intentObjectId: string): Promise<IntentTrace[]> {
  const rows = await db.intentTraces
    .where('[intentObjectId+createdAt]')
    .between([intentObjectId, new Date(0)], [intentObjectId, new Date(8.64e15)])
    .toArray();
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Newest trace per intent for a project — what the matrix renders and what
 * "already traced at this commit" checks against.
 */
export async function getLatestTraceByIntent(
  projectId: string
): Promise<Map<string, IntentTrace>> {
  const latest = new Map<string, IntentTrace>();
  for (const trace of await listTracesForProject(projectId)) {
    // listTracesForProject is newest-first, so the first hit per intent wins.
    if (!latest.has(trace.intentObjectId)) latest.set(trace.intentObjectId, trace);
  }
  return latest;
}
