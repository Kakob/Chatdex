// Promote + Questions (SPEC-change-workspace §12, §2.8; PRD §16, §21; CW-5).
// Promotion is a deliberate per-item act: the developer picks verified
// evidence and trace edges, writes the belief in their own words, and a
// user-origin, accepted UnderstandingObject is created with an `introduced`
// event that carries conversation EvidenceRefs plus the code/test items as
// `codeEvidence`. Questions are first-class UnderstandingObjects
// (type 'question') linked back to the workspace.

import { createUnderstandingObject, getUnderstandingObject } from '../db/understanding';
import { getPreparedChange, putPreparedChange } from '../db/preparedChanges';
import { assertEditability } from './editability';
import { deriveEdgeVerification } from './trace';
import { isMechanicalEvidence, type EvidenceItem } from '../../types/evidence';
import type { EvidenceRef, UnderstandingObject } from '../../types/understanding';
import type { PreparedChange, TraceEdge } from '../../types/preparedChange';

export const PROMOTABLE_TYPES = ['belief', 'decision', 'constraint'] as const;
export type PromotableType = (typeof PROMOTABLE_TYPES)[number];

export interface PromotionCandidates {
  /** Mechanical evidence items (code, test/runtime, commit history). */
  evidence: EvidenceItem[];
  /** Edges whose derived state is `verified`, with their endpoint labels. */
  edges: { edge: TraceEdge; fromLabel: string; toLabel: string }[];
}

export function promotionCandidates(change: PreparedChange): PromotionCandidates {
  const evidence = (change.evidence ?? []).filter(isMechanicalEvidence);
  const trace = change.trace;
  const labels = new Map((trace?.nodes ?? []).map((n) => [n.id, n.label]));
  const edges = (trace?.edges ?? [])
    .filter((edge) => deriveEdgeVerification(edge, change.evidence ?? []) === 'verified')
    .map((edge) => ({ edge, fromLabel: labels.get(edge.from) ?? edge.from, toLabel: labels.get(edge.to) ?? edge.to }));
  return { evidence, edges };
}

/** Conversation-anchored refs for the understanding event (PRD §9 navigation chain). */
export function evidenceRefsFrom(items: EvidenceItem[]): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    let ref: EvidenceRef | null = null;
    if (item.kind === 'intent_history' && item.conversationId) {
      ref = { conversationId: item.conversationId, ...(item.messageIds?.length ? { messageIds: item.messageIds } : {}), ...(item.note ? { note: item.note } : {}) };
    } else if (item.kind === 'test_runtime' && item.source === 'transcript' && item.conversationId) {
      ref = { conversationId: item.conversationId, ...(item.messageId ? { messageIds: [item.messageId] } : {}), note: item.command ? `${item.command} → ${item.outcome}` : item.outcome };
    }
    if (!ref) continue;
    const key = JSON.stringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

export interface PromoteInput {
  title: string;
  body?: string;
  type: PromotableType;
  evidenceIds: string[];
  edgeIds?: string[];
}

/** Law §2.8: explicit, per-item, user-origin, accepted. */
export async function promoteFromWorkspace(
  changeId: string,
  input: PromoteInput
): Promise<{ change: PreparedChange; object: UnderstandingObject }> {
  const change = await getPreparedChange(changeId);
  if (!change) throw new Error(`Change Workspace not found: ${changeId}`);
  assertEditability(change, 'promotions', ['appendable', 'editable']);
  const title = input.title.trim();
  if (!title) throw new Error('Write the understanding you are promoting');
  if (!PROMOTABLE_TYPES.includes(input.type)) throw new Error('Unsupported understanding type');
  if (!change.projectId) throw new Error('Workspace has no project');

  const candidates = promotionCandidates(change);
  const allowedEvidence = new Map(candidates.evidence.map((e) => [e.id, e]));
  const selected = [...new Set(input.evidenceIds)].map((id) => {
    const item = allowedEvidence.get(id);
    if (!item) throw new Error(`Evidence ${id} is not verified evidence in this workspace`);
    return item;
  });
  const allowedEdges = new Set(candidates.edges.map((c) => c.edge.id));
  const edgeIds = [...new Set(input.edgeIds ?? [])];
  for (const id of edgeIds) {
    if (!allowedEdges.has(id)) throw new Error(`Trace edge ${id} is not verified`);
  }
  // Edge evidence rides along so the promoted object explains itself.
  const edgeEvidence = edgeIds.flatMap((id) => {
    const edge = change.trace?.edges.find((e) => e.id === id);
    return (edge?.evidenceIds ?? []).map((eid) => allowedEvidence.get(eid)).filter((e): e is EvidenceItem => Boolean(e));
  });
  const codeEvidence = [...new Map([...selected, ...edgeEvidence].map((e) => [e.id, e])).values()];
  if (codeEvidence.length === 0) {
    throw new Error('Select at least one verified evidence item or verified relationship');
  }

  const edgeClaims = candidates.edges
    .filter((c) => edgeIds.includes(c.edge.id))
    .map((c) => `${c.fromLabel} → ${c.toLabel}${c.edge.claim ? ` (${c.edge.claim})` : ''}`);
  const body = [input.body?.trim(), edgeClaims.length ? `Verified relationships: ${edgeClaims.join('; ')}` : '']
    .filter(Boolean)
    .join('\n\n');

  const object = await createUnderstandingObject({
    projectId: change.projectId,
    type: input.type,
    title,
    ...(body ? { body } : {}),
    origin: 'user',
    evidence: evidenceRefsFrom(codeEvidence),
    codeEvidence,
    occurredAt: new Date(),
    meta: { workspaceId: change.id, workspaceTitle: change.title, promotedEdges: edgeIds.length, promotedEvidence: codeEvidence.length },
  });

  const updated: PreparedChange = {
    ...change,
    promotions: [
      ...(change.promotions ?? []),
      { evidenceIds: codeEvidence.map((e) => e.id), understandingObjectId: object.id, promotedAt: new Date().toISOString() },
    ],
    updatedAt: new Date(),
  };
  await putPreparedChange(updated);
  return { change: updated, object };
}

// --- questions (PRD §21) ---

export async function createWorkspaceQuestion(
  changeId: string,
  input: { title: string; body?: string }
): Promise<{ change: PreparedChange; question: UnderstandingObject }> {
  const change = await getPreparedChange(changeId);
  if (!change) throw new Error(`Change Workspace not found: ${changeId}`);
  assertEditability(change, 'questions', ['appendable', 'editable']);
  const title = input.title.trim();
  if (!title) throw new Error('Question cannot be empty');
  const question = await createUnderstandingObject({
    projectId: change.projectId,
    type: 'question',
    title,
    ...(input.body?.trim() ? { body: input.body.trim() } : {}),
    origin: 'user',
    evidence: [],
    occurredAt: new Date(),
    meta: { workspaceId: change.id, workspaceTitle: change.title },
  });
  const updated: PreparedChange = {
    ...change,
    questionIds: [...new Set([...(change.questionIds ?? []), question.id])],
    updatedAt: new Date(),
  };
  await putPreparedChange(updated);
  return { change: updated, question };
}

export async function questionsForWorkspace(change: PreparedChange): Promise<UnderstandingObject[]> {
  const ids = change.questionIds ?? [];
  const rows = await Promise.all(ids.map((id) => getUnderstandingObject(id)));
  return rows.filter((q): q is UnderstandingObject => Boolean(q));
}

export async function promotedObjectsForWorkspace(change: PreparedChange): Promise<UnderstandingObject[]> {
  const ids = (change.promotions ?? []).map((p) => p.understandingObjectId);
  const rows = await Promise.all(ids.map((id) => getUnderstandingObject(id)));
  return rows.filter((o): o is UnderstandingObject => Boolean(o));
}
