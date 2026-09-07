// Read model for the Decisions tab (SPEC-decision-recovery §10.2): one row per
// decision object with its typed meta, evidence links, newest trace, and trace
// count. Pure assembly + a Dexie loader, mirroring intentMatrix.ts. Ordering
// is chronological by first citing step within a session (law 2.7).

import { db } from '../../db/schema';
import { getUnderstandingProject, getObjectsForProject } from '../../db/understanding';
import { listDecisionTracesForProject, listRecoveryRuns, type RecoveryRunSummary } from '../../db/decisionTraces';
import { mergeEvidence, type EvidenceLink } from '../currentUnderstanding';
import { isDecision, readDecisionMeta, type DecisionMeta } from './meta';
import type { UnderstandingProject, UnderstandingObject, UnderstandingEvent } from '../../../types/understanding';
import type { DecisionTrace, DecisionBasis, DecisionMadeBy } from '../../../types/decision';

export interface DecisionRow {
  object: UnderstandingObject;
  meta: DecisionMeta;
  evidence: EvidenceLink[];
  latestTrace?: DecisionTrace;
  traceCount: number;
  /** Name of the conversation the decision was recovered from, when known. */
  conversationName?: string | null;
}

export interface DecisionMatrix {
  project: UnderstandingProject;
  rows: DecisionRow[];
  runs: RecoveryRunSummary[];
  latestRepoKey?: string;
  latestSha?: string;
  latestRecoveredAt?: Date;
}

export const BASIS_LABEL: Record<DecisionBasis, string> = {
  specified: 'Specified',
  inherited: 'Inherited',
  inferred: 'Inferred',
  invented: 'Invented',
  unknown: 'Unknown',
};

export const BASIS_HELP: Record<DecisionBasis, string> = {
  specified: 'The user asked for it — a user message states it.',
  inherited: 'Copied from an existing pattern, default, or file the agent read.',
  inferred: 'The agent reasoned to it from context and said so.',
  invented: 'The agent chose it with no user direction and no existing pattern.',
  unknown: 'Cannot be determined from the recorded session.',
};

export const MADE_BY_LABEL: Record<DecisionMadeBy, string> = {
  user: 'User',
  agent: 'Agent',
  agent_user_adopted: 'Agent, adopted by user',
  unknown: 'Unknown',
};

/** Pure assembly over loaded rows (exported for tests). Rejected decisions are excluded. */
export function assembleDecisionRows(
  objects: UnderstandingObject[],
  events: UnderstandingEvent[],
  traces: DecisionTrace[],
  conversationNames: Map<string, string>
): DecisionRow[] {
  const decisions = objects.filter((o) => isDecision(o) && o.reviewState !== 'rejected');
  const eventsByObject = new Map<string, UnderstandingEvent[]>();
  for (const e of events) {
    if (e.reviewState === 'rejected') continue;
    const list = eventsByObject.get(e.objectId) ?? [];
    list.push(e);
    eventsByObject.set(e.objectId, list);
  }
  const tracesByDecision = new Map<string, DecisionTrace[]>();
  for (const t of traces) {
    const list = tracesByDecision.get(t.decisionObjectId) ?? [];
    list.push(t);
    tracesByDecision.set(t.decisionObjectId, list);
  }
  return decisions
    .map((object) => {
      const own = tracesByDecision.get(object.id) ?? [];
      own.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const meta = readDecisionMeta(object);
      return {
        object,
        meta,
        evidence: mergeEvidence(eventsByObject.get(object.id) ?? [], conversationNames),
        latestTrace: own[0],
        traceCount: own.length,
        conversationName: meta.conversationId ? conversationNames.get(meta.conversationId) ?? null : undefined,
      };
    })
    .sort((a, b) => {
      // Sessions in time order, then first citing step within a session.
      const ac = a.meta.conversationId ?? '';
      const bc = b.meta.conversationId ?? '';
      if (ac !== bc) {
        const at = a.meta.decidedAt ?? a.object.createdAt.toISOString();
        const bt = b.meta.decidedAt ?? b.object.createdAt.toISOString();
        return at < bt ? -1 : at > bt ? 1 : ac.localeCompare(bc);
      }
      return (a.meta.firstStepIndex ?? 0) - (b.meta.firstStepIndex ?? 0);
    });
}

export async function loadDecisionMatrix(projectId: string): Promise<DecisionMatrix | null> {
  const project = await getUnderstandingProject(projectId);
  if (!project) return null;
  const objects = (await getObjectsForProject(projectId)).filter(isDecision);
  const objectIds = objects.map((o) => o.id);
  const [events, traces, runs] = await Promise.all([
    objectIds.length ? db.understandingEvents.where('objectId').anyOf(objectIds).toArray() : Promise.resolve([]),
    listDecisionTracesForProject(projectId),
    listRecoveryRuns(projectId),
  ]);
  const conversationIds = new Set<string>();
  for (const e of events) for (const ref of e.evidence) conversationIds.add(ref.conversationId);
  for (const o of objects) {
    const cid = readDecisionMeta(o).conversationId;
    if (cid) conversationIds.add(cid);
  }
  const conversations = conversationIds.size
    ? await db.conversations.where('id').anyOf([...conversationIds]).toArray()
    : [];
  const names = new Map(conversations.map((c) => [c.id, c.name]));
  const rows = assembleDecisionRows(objects, events, traces, names);
  const newest = traces[0];
  return {
    project,
    rows,
    runs,
    ...(newest ? { latestRepoKey: newest.repoKey, latestSha: newest.sha, latestRecoveredAt: newest.createdAt } : {}),
  };
}
