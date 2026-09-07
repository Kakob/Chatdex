// "Prepare a replacement change" (SPEC-decision-recovery §11.3). Seeds a
// Change Workspace draft from a decision: the decision becomes the current
// behavior, specified/inherited assumptions become constraints, the rest of
// the assumptions and the rejected alternatives become open implementation
// choices, and the trace's verified evidence is attached. Nothing here is a
// verdict — the human edits the draft like any other workspace.

import { db } from '../../db/schema';
import { getUnderstandingObject } from '../../db/understanding';
import { listDecisionTracesForDecision } from '../../db/decisionTraces';
import { listPreparedChangesForProject } from '../../db/preparedChanges';
import { createPreparedChange, updatePreparedChangeDraft } from '../../prepare/changes';
import { addEvidenceItems } from '../../prepare/lifecycle';
import { sha256Hex } from '../../utils/hash';
import { generateId } from '../../utils/ids';
import { readDecisionMeta } from './meta';
import { BASIS_LABEL, MADE_BY_LABEL } from './decisionMatrix';
import type { PreparedChange } from '../../../types/preparedChange';
import type { EvidenceItem } from '../../../types/evidence';
import type { DecisionTrace, TranscriptSpan } from '../../../types/decision';

/** The workspace already seeded from this decision, if any (idempotence). */
export async function findReplacementWorkspace(projectId: string, decisionObjectId: string): Promise<PreparedChange | undefined> {
  const changes = await listPreparedChangesForProject(projectId);
  return changes.find((c) => c.originRef?.kind === 'decision' && c.originRef.id === decisionObjectId);
}

function groupSpans(spans: TranscriptSpan[]): Map<string, TranscriptSpan[]> {
  const out = new Map<string, TranscriptSpan[]>();
  for (const s of spans) {
    const list = out.get(s.conversationId) ?? [];
    list.push(s);
    out.set(s.conversationId, list);
  }
  return out;
}

async function evidenceFromTrace(trace: DecisionTrace, decisionObjectId: string, statement: string): Promise<EvidenceItem[]> {
  const createdAt = new Date().toISOString();
  const items: EvidenceItem[] = [];
  if (trace.repoKey && trace.sha) {
    for (const ev of trace.implEvidence) {
      items.push({
        id: generateId(),
        kind: 'code',
        createdAt,
        origin: 'ai',
        addedVia: 'attach',
        note: `Implemented decision: ${statement}`,
        repoKey: trace.repoKey,
        sha: trace.sha,
        path: ev.path,
        startLine: ev.startLine,
        endLine: ev.endLine,
        quote: ev.quote,
        quoteHash: await sha256Hex(ev.quote),
      });
    }
  }
  for (const [conversationId, spans] of groupSpans(trace.transcriptEvidence)) {
    const quote = spans[0].quote;
    items.push({
      id: generateId(),
      kind: 'intent_history',
      createdAt,
      origin: 'ai',
      addedVia: 'attach',
      note: `Decision evidence: ${statement}`,
      source: 'understanding',
      understandingObjectId: decisionObjectId,
      conversationId,
      messageIds: [...new Set(spans.map((s) => s.messageId))],
      quote,
      quoteHash: await sha256Hex(quote),
    });
  }
  return items;
}

/**
 * Create (or return) the replacement workspace for a decision. The decision
 * joins `understandingPointIds` only when it is accepted current
 * understanding — a pending recovery may not masquerade as established.
 */
export async function createReplacementWorkspace(projectId: string, decisionObjectId: string): Promise<PreparedChange> {
  const existing = await findReplacementWorkspace(projectId, decisionObjectId);
  if (existing) return existing;
  const object = await getUnderstandingObject(decisionObjectId);
  if (!object || object.type !== 'decision') throw new Error(`Decision not found: ${decisionObjectId}`);
  const project = await db.understandingProjects.get(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const meta = readDecisionMeta(object);
  const trace = (await listDecisionTracesForDecision(decisionObjectId))[0];
  const accepted = object.status === 'current' && (object.reviewState === 'accepted' || object.reviewState === 'edited');

  const why = trace?.why ?? object.body;
  const change = await createPreparedChange({
    projectId,
    title: `Replace: ${object.title}`,
    understandingPointIds: accepted ? [decisionObjectId] : [],
    intent: {
      currentBehavior: why ? `${object.title} — ${why}` : object.title,
      desiredBehavior: '',
      whyItMatters: `${BASIS_LABEL[meta.basis]} decision made by ${MADE_BY_LABEL[meta.madeBy].toLowerCase()}${
        meta.unsupportedAutonomous ? '; unsupported autonomous — nothing in the record directed it' : ''
      }.`,
    },
    originRef: { kind: 'decision', id: decisionObjectId },
  });

  const constraints = (trace?.assumptions ?? [])
    .filter((a) => a.basis === 'specified' || a.basis === 'inherited')
    .map((a) => `${a.statement} (${BASIS_LABEL[a.basis].toLowerCase()})`);
  const openChoices = [
    ...(trace?.assumptions ?? []).filter((a) => a.basis !== 'specified' && a.basis !== 'inherited').map((a) => `${a.statement} (${BASIS_LABEL[a.basis].toLowerCase()} — revisit)`),
    ...(trace?.alternatives ?? []).map((a) => `Alternative: ${a.statement}${a.rejectedBecause ? ` (rejected: ${a.rejectedBecause})` : ''}`),
  ];
  const implicatedPaths = trace ? [...new Set(trace.implEvidence.map((e) => e.path))] : [];
  let updated = await updatePreparedChangeDraft(change.id, {
    constraints,
    openImplementationChoices: openChoices,
    ...(trace && (implicatedPaths.length || trace.sha)
      ? {
          repositoryRef: {
            ...(trace.sha && trace.sha !== 'local' ? { baseCommit: trace.sha } : {}),
            ...(implicatedPaths.length ? { implicatedPaths } : {}),
          },
        }
      : {}),
  });
  if (trace) {
    const items = await evidenceFromTrace(trace, decisionObjectId, object.title);
    if (items.length > 0) updated = await addEvidenceItems(change.id, items);
  }
  return updated;
}
