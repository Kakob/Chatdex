// LOCAL-ONLY inspection log (SPEC-change-workspace §7.2, audit S12).
// Records human views of files / evidence / nodes / diffs so PRD §17 can
// answer "previously inspected" without guessing. Never synced (D9), never
// sent to a provider.

import { db } from './schema';
import { generateId } from '../utils/ids';
import type { InspectionKind, InspectionRow } from '../../types/repo';

export interface RecordInspectionInput {
  projectId: string;
  workspaceId?: string;
  kind: InspectionKind;
  targetKey: string;
  at?: Date;
}

export async function recordInspection(input: RecordInspectionInput): Promise<InspectionRow> {
  const row: InspectionRow = {
    id: generateId(),
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    kind: input.kind,
    targetKey: input.targetKey,
    at: input.at ?? new Date(),
  };
  await db.inspections.put(row);
  return row;
}

export async function listInspectionsForWorkspace(workspaceId: string): Promise<InspectionRow[]> {
  const rows = await db.inspections.where('workspaceId').equals(workspaceId).toArray();
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export async function listInspectionsForTarget(
  projectId: string,
  targetKey: string
): Promise<InspectionRow[]> {
  const rows = await db.inspections
    .where('[projectId+targetKey]')
    .equals([projectId, targetKey])
    .toArray();
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Distinct targets inspected in a project, with counts and last-seen — PRD §17. */
export async function summarizeInspections(
  projectId: string
): Promise<{ targetKey: string; kind: InspectionKind; count: number; lastAt: Date }[]> {
  const rows = await db.inspections.where('projectId').equals(projectId).toArray();
  const byTarget = new Map<string, { targetKey: string; kind: InspectionKind; count: number; lastAt: Date }>();
  for (const row of rows) {
    const key = `${row.kind}:${row.targetKey}`;
    const entry = byTarget.get(key);
    if (!entry) {
      byTarget.set(key, { targetKey: row.targetKey, kind: row.kind, count: 1, lastAt: row.at });
    } else {
      entry.count += 1;
      if (row.at > entry.lastAt) entry.lastAt = row.at;
    }
  }
  return [...byTarget.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

export async function clearInspectionsForProject(projectId: string): Promise<number> {
  return db.inspections.where('projectId').equals(projectId).delete();
}
