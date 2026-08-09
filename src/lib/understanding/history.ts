// Per-object history model (PRD §23 HISTORY, phase U4.3).
//
// HEAD (the panel) shows what is currently believed; this module reconstructs
// how a single object got there: its full event stream — rejected events
// included, since they stay in Dexie as audit trail even though they assert
// nothing — with the status each applied event set, plus the supersession
// chain in both directions so old ↔ new direction navigation works.

import { db } from '../db/schema';
import { OP_STATUS } from '../db/understanding';
import { mergeEvidence, type EvidenceLink } from './currentUnderstanding';
import type {
  UnderstandingObject,
  UnderstandingEvent,
  UnderstandingStatus,
} from '../../types/understanding';

/** One row of the audit trail, with resolved display data. */
export interface HistoryEvent {
  event: UnderstandingEvent;
  evidence: EvidenceLink[];
  /** Status this event set when it applied; absent for pending/rejected events and status-neutral ops. */
  statusAfter?: UnderstandingStatus;
  /** Title of the replacing object, when the event names one. */
  supersededByTitle?: string;
}

/** A neighbouring object in the supersession chain. */
export interface ChainEntry {
  objectId: string;
  title: string;
  type: string;
  status: UnderstandingStatus;
}

export interface ObjectHistory {
  object: UnderstandingObject;
  /** Full stream, oldest first (source timeline, analysis time as tiebreak). */
  events: HistoryEvent[];
  /** What replaced this object, one hop at a time — the last entry is the newest end of the chain. */
  replacedBy: ChainEntry[];
  /** Objects this one directly replaced. */
  replaces: ChainEntry[];
}

/** Only accepted/edited events changed the object (U3.1 review gate). */
const applied = (e: UnderstandingEvent): boolean =>
  e.reviewState === 'accepted' || e.reviewState === 'edited';

const byTimeline = (a: UnderstandingEvent, b: UnderstandingEvent): number =>
  a.occurredAt.getTime() - b.occurredAt.getTime() ||
  a.createdAt.getTime() - b.createdAt.getTime();

/**
 * Pure assembly over already-loaded rows (exported for tests; the Dexie
 * loader below feeds it). `objects`/`events` are the whole store — the
 * supersession chain may cross project boundaries. Returns null for an
 * unknown object id.
 */
export function assembleObjectHistory(
  objectId: string,
  objects: UnderstandingObject[],
  events: UnderstandingEvent[],
  conversationNames: Map<string, string>
): ObjectHistory | null {
  const objectById = new Map(objects.map((o) => [o.id, o]));
  const object = objectById.get(objectId);
  if (!object) return null;

  const historyEvents: HistoryEvent[] = events
    .filter((e) => e.objectId === objectId)
    .sort(byTimeline)
    .map((event) => {
      const statusAfter = applied(event) ? OP_STATUS[event.op] : undefined;
      const replacement = event.supersededByObjectId
        ? objectById.get(event.supersededByObjectId)
        : undefined;
      return {
        event,
        evidence: mergeEvidence([event], conversationNames),
        ...(statusAfter ? { statusAfter } : {}),
        ...(replacement ? { supersededByTitle: replacement.title } : {}),
      };
    });

  const toChainEntry = (o: UnderstandingObject): ChainEntry => ({
    objectId: o.id,
    title: o.title,
    type: o.type,
    status: o.status,
  });

  // Forward: follow applied supersessions hop by hop to whatever holds the
  // belief now. Pending proposals don't extend the chain — they show in the
  // event stream instead. Cycle-guarded (bad AI output could link a loop).
  const replacedBy: ChainEntry[] = [];
  const visited = new Set([objectId]);
  let cursor = objectId;
  for (;;) {
    const hop = events
      .filter(
        (e) =>
          e.objectId === cursor &&
          e.op === 'superseded' &&
          applied(e) &&
          e.supersededByObjectId !== undefined
      )
      .sort(byTimeline)
      .pop();
    const next = hop?.supersededByObjectId
      ? objectById.get(hop.supersededByObjectId)
      : undefined;
    if (!next || visited.has(next.id)) break;
    visited.add(next.id);
    replacedBy.push(toChainEntry(next));
    cursor = next.id;
  }

  const replaces = [
    ...new Set(
      events
        .filter(
          (e) => e.op === 'superseded' && e.supersededByObjectId === objectId && applied(e)
        )
        .map((e) => e.objectId)
    ),
  ]
    .map((id) => objectById.get(id))
    .filter((o): o is UnderstandingObject => o !== undefined)
    .map(toChainEntry);

  return { object, events: historyEvents, replacedBy, replaces };
}

/**
 * Load one object's history. Reads the whole understanding store (objects +
 * events are synthesized rows, small by construction — nothing like message
 * volume) so the chain can be resolved across projects.
 */
export async function loadObjectHistory(objectId: string): Promise<ObjectHistory | null> {
  const [objects, events] = await Promise.all([
    db.understandingObjects.toArray(),
    db.understandingEvents.toArray(),
  ]);
  const conversationIds = [
    ...new Set(
      events
        .filter((e) => e.objectId === objectId)
        .flatMap((e) => e.evidence.map((ref) => ref.conversationId))
    ),
  ];
  const conversations = await db.conversations.where('id').anyOf(conversationIds).toArray();
  const conversationNames = new Map(conversations.map((c) => [c.id, c.name]));
  return assembleObjectHistory(objectId, objects, events, conversationNames);
}
