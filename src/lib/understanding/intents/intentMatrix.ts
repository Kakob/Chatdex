// Read model for the Intent Trace tab (SPEC-intent-trace §10.2): one row per
// intent object with its evidence links (union of its events), its newest
// trace, and how many traces it has accumulated. Pure assembly + a Dexie
// loader, mirroring currentUnderstanding.ts.

import { db } from '../../db/schema';
import { getUnderstandingProject, getObjectsForProject } from '../../db/understanding';
import { listTracesForProject } from '../../db/intentTraces';
import { mergeEvidence, type EvidenceLink } from '../currentUnderstanding';
import type { UnderstandingProject, UnderstandingObject, UnderstandingEvent } from '../../../types/understanding';
import type { IntentTrace, IntentPolarity, IntentOrigin, SpecStatus, ImplStatus } from '../../../types/intentTrace';

export interface IntentRow {
  object: UnderstandingObject;
  polarity: IntentPolarity;
  origin: IntentOrigin;
  statedAt?: Date;
  evidence: EvidenceLink[];
  latestTrace?: IntentTrace;
  traceCount: number;
}

export interface IntentMatrix {
  project: UnderstandingProject;
  rows: IntentRow[];
  /** The commit the newest trace in the project was made against, if any. */
  latestRepoRef?: IntentTrace['repoRef'];
  latestTracedAt?: Date;
}

export const POLARITY_LABEL: Record<IntentPolarity, string> = {
  want: 'wants',
  dont_want: "doesn't want",
  constraint: 'constraint',
  preference: 'preference',
};

export const ORIGIN_LABEL: Record<IntentOrigin, string> = {
  unprompted: 'Unprompted',
  response_to_ai: 'Reply to AI',
};

export const SPEC_STATUS_LABEL: Record<SpecStatus, string> = {
  no_spec: 'no spec',
  specified: 'specified',
  contradicted: 'contradicted',
  unspecified: 'unspecified',
};

export const IMPL_STATUS_LABEL: Record<ImplStatus, string> = {
  implemented: 'implemented',
  partial: 'partial',
  not_implemented: 'not implemented',
  diverged: 'diverged',
  unknown: 'unknown',
};

function polarityOf(o: UnderstandingObject): IntentPolarity {
  const p = o.meta?.polarity;
  return p === 'want' || p === 'dont_want' || p === 'constraint' || p === 'preference' ? p : 'preference';
}

function originOf(o: UnderstandingObject): IntentOrigin {
  return o.meta?.origin === 'response_to_ai' ? 'response_to_ai' : 'unprompted';
}

/** Pure assembly over loaded rows (exported for tests). Rejected intents are excluded. */
export function assembleIntentRows(
  objects: UnderstandingObject[],
  events: UnderstandingEvent[],
  traces: IntentTrace[],
  conversationNames: Map<string, string>
): IntentRow[] {
  const intents = objects.filter((o) => o.type === 'intent' && o.reviewState !== 'rejected');
  const eventsByObject = new Map<string, UnderstandingEvent[]>();
  for (const e of events) {
    if (e.reviewState === 'rejected') continue;
    const list = eventsByObject.get(e.objectId) ?? [];
    list.push(e);
    eventsByObject.set(e.objectId, list);
  }
  const tracesByIntent = new Map<string, IntentTrace[]>();
  for (const t of traces) {
    const list = tracesByIntent.get(t.intentObjectId) ?? [];
    list.push(t);
    tracesByIntent.set(t.intentObjectId, list);
  }
  return intents
    .map((object) => {
      const own = tracesByIntent.get(object.id) ?? [];
      own.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const statedAtRaw = object.meta?.statedAt;
      return {
        object,
        polarity: polarityOf(object),
        origin: originOf(object),
        ...(typeof statedAtRaw === 'string' ? { statedAt: new Date(statedAtRaw) } : {}),
        evidence: mergeEvidence(eventsByObject.get(object.id) ?? [], conversationNames),
        latestTrace: own[0],
        traceCount: own.length,
      };
    })
    .sort((a, b) => {
      const at = a.statedAt?.getTime() ?? a.object.createdAt.getTime();
      const bt = b.statedAt?.getTime() ?? b.object.createdAt.getTime();
      return bt - at;
    });
}

export async function loadIntentMatrix(projectId: string): Promise<IntentMatrix | null> {
  const project = await getUnderstandingProject(projectId);
  if (!project) return null;
  const objects = (await getObjectsForProject(projectId)).filter((o) => o.type === 'intent');
  const objectIds = objects.map((o) => o.id);
  const [events, traces] = await Promise.all([
    objectIds.length ? db.understandingEvents.where('objectId').anyOf(objectIds).toArray() : Promise.resolve([]),
    listTracesForProject(projectId),
  ]);
  const conversationIds = new Set<string>();
  for (const e of events) for (const ref of e.evidence) conversationIds.add(ref.conversationId);
  const conversations = conversationIds.size
    ? await db.conversations.where('id').anyOf([...conversationIds]).toArray()
    : [];
  const names = new Map(conversations.map((c) => [c.id, c.name]));
  const rows = assembleIntentRows(objects, events, traces, names);
  const newest = traces[0];
  return {
    project,
    rows,
    ...(newest ? { latestRepoRef: newest.repoRef, latestTracedAt: newest.createdAt } : {}),
  };
}
