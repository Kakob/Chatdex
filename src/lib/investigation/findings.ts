import { db } from '../db/schema';
import {
  getFindingsForCase,
  getInvestigationCase,
  getInvestigationFinding,
  putInvestigationFinding,
} from '../db/investigationCases';
import { createUnderstandingObject, getUnderstandingObject } from '../db/understanding';
import { generateId } from '../utils/ids';
import type {
  InvestigationFinding,
  InvestigationFindingType,
  VerdictConfidence,
} from '../../types/investigation';
import type { EvidenceRef, UnderstandingObject } from '../../types/understanding';

export interface CreateInvestigationFindingInput {
  caseId: string;
  type: InvestigationFindingType;
  title: string;
  body?: string;
  confidence: VerdictConfidence;
  exhibitIds: string[];
  reviewScopeIds: string[];
}

async function validateEvidenceSelection(
  caseId: string,
  exhibitIds: string[],
  reviewScopeIds: string[]
): Promise<void> {
  if (exhibitIds.length === 0 && reviewScopeIds.length === 0) {
    throw new Error('A finding requires pinned evidence or an explicitly reviewed range');
  }
  const [exhibits, scopes] = await Promise.all([
    db.caseExhibits.bulkGet(exhibitIds),
    db.reviewScopes.bulkGet(reviewScopeIds),
  ]);
  if (exhibits.some((row) => !row || row.caseId !== caseId)) {
    throw new Error('Every selected exhibit must belong to this investigation');
  }
  if (scopes.some((row) => !row || row.caseId !== caseId)) {
    throw new Error('Every selected review scope must belong to this investigation');
  }
}

export async function createInvestigationFinding(
  input: CreateInvestigationFindingInput
): Promise<InvestigationFinding> {
  const caseRow = await getInvestigationCase(input.caseId);
  if (!caseRow) throw new Error(`Investigation not found: ${input.caseId}`);
  if (!caseRow.projectId) throw new Error('Only project-scoped investigations support findings');
  if (caseRow.state === 'completed' || caseRow.state === 'adjudicated') {
    throw new Error('Reopen the investigation before adding a finding');
  }
  const title = input.title.trim();
  if (!title) throw new Error('Finding title cannot be empty');
  await validateEvidenceSelection(input.caseId, input.exhibitIds, input.reviewScopeIds);

  const now = new Date();
  const finding: InvestigationFinding = {
    id: generateId(),
    caseId: input.caseId,
    projectId: caseRow.projectId,
    type: input.type,
    title,
    body: input.body?.trim() || undefined,
    confidence: input.confidence,
    exhibitIds: [...new Set(input.exhibitIds)],
    reviewScopeIds: [...new Set(input.reviewScopeIds)],
    state: 'draft',
    createdAt: now,
    updatedAt: now,
  };
  await putInvestigationFinding(finding);
  return finding;
}

export async function finalizeInvestigationFinding(
  id: string
): Promise<InvestigationFinding> {
  const finding = await getInvestigationFinding(id);
  if (!finding) throw new Error(`Finding not found: ${id}`);
  if (finding.state === 'finalized') return finding;
  await validateEvidenceSelection(
    finding.caseId,
    finding.exhibitIds,
    finding.reviewScopeIds
  );
  const now = new Date();
  const finalized: InvestigationFinding = {
    ...finding,
    state: 'finalized',
    finalizedAt: now,
    updatedAt: now,
  };
  await putInvestigationFinding(finalized);
  return finalized;
}

function mergeEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  const byConversation = new Map<string, EvidenceRef>();
  for (const ref of refs) {
    const current = byConversation.get(ref.conversationId);
    if (!current) {
      byConversation.set(ref.conversationId, {
        ...ref,
        messageIds: ref.messageIds ? [...new Set(ref.messageIds)] : undefined,
      });
      continue;
    }
    current.messageIds = [
      ...new Set([...(current.messageIds ?? []), ...(ref.messageIds ?? [])]),
    ];
  }
  return [...byConversation.values()];
}

async function evidenceForFinding(finding: InvestigationFinding): Promise<EvidenceRef[]> {
  const [exhibits, scopes] = await Promise.all([
    db.caseExhibits.bulkGet(finding.exhibitIds),
    db.reviewScopes.bulkGet(finding.reviewScopeIds),
  ]);
  const refs: EvidenceRef[] = [];
  for (const exhibit of exhibits) {
    if (!exhibit) continue;
    refs.push({
      conversationId: exhibit.conversationId,
      messageIds: [exhibit.messageId],
      note: exhibit.humanNote,
    });
  }
  for (const scope of scopes) {
    if (!scope) continue;
    refs.push({
      conversationId: scope.conversationId,
      messageIds: [scope.startMessageId, scope.endMessageId],
      note: `Explicitly reviewed range of ${scope.eventCount} source events`,
    });
  }
  return mergeEvidence(refs);
}

export async function promoteFindingToCurrentUnderstanding(
  id: string
): Promise<UnderstandingObject> {
  const finding = await getInvestigationFinding(id);
  if (!finding) throw new Error(`Finding not found: ${id}`);
  if (finding.state !== 'finalized' || !finding.finalizedAt) {
    throw new Error('Finalize the finding before promoting it');
  }
  if (finding.promotedUnderstandingObjectId) {
    const existing = await getUnderstandingObject(finding.promotedUnderstandingObjectId);
    if (existing) return existing;
  }
  const evidence = await evidenceForFinding(finding);
  const object = await createUnderstandingObject({
    projectId: finding.projectId,
    type: finding.type,
    title: finding.title,
    body: finding.body,
    origin: 'user',
    evidence,
    occurredAt: finding.finalizedAt,
  });
  await putInvestigationFinding({
    ...finding,
    promotedUnderstandingObjectId: object.id,
    updatedAt: new Date(),
  });
  return object;
}

export { getFindingsForCase };
