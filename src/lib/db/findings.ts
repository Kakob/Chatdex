import { db } from './schema';
import type { StoredFinding, UserLabel } from '../../types/detection';

export async function bulkPutFindings(findings: StoredFinding[]): Promise<void> {
  if (findings.length === 0) return;
  await db.findings.bulkPut(findings);
}

export async function getFinding(id: string): Promise<StoredFinding | undefined> {
  return db.findings.get(id);
}

export async function getFindingsForConversation(
  conversationId: string
): Promise<StoredFinding[]> {
  return db.findings
    .where('[conversationId+createdAt]')
    .between([conversationId, new Date(0)], [conversationId, new Date(8.64e15)])
    .toArray();
}

export async function getFindingsForRun(runId: string): Promise<StoredFinding[]> {
  return db.findings.where('runId').equals(runId).toArray();
}

export async function getFindingCount(): Promise<number> {
  return db.findings.count();
}

/**
 * Labels are the only mutable part of a finding (ground truth for the future
 * ML tier). Bumps updatedAt so last-write-wins sync propagates the label.
 */
export async function setFindingLabel(id: string, label: UserLabel): Promise<void> {
  await db.findings.update(id, { userLabel: label, updatedAt: new Date() });
}

export async function deleteFindingsForConversation(
  conversationId: string
): Promise<void> {
  await db.findings.where('conversationId').equals(conversationId).delete();
}
