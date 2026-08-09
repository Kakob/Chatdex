// Current Understanding panel model (PRD §21 stage U2, phase U2.1).
//
// Assembles a read-only per-project view from the understanding store:
// current direction, ideas/decisions, open questions, and recent changes —
// each carrying provenance (PRD §9: object → evidence → conversation).
//
// Grouping over the open type ontology (PRD §7): 'direction' and 'question'
// get dedicated sections; every other type ('decision', 'idea', 'goal', and
// whatever else discovery emits) lands in the ideas-and-decisions section with
// its type shown as a chip. Sections show status-'current' objects only;
// superseded/resolved lifecycle surfaces through the recent-changes stream.

import { db } from '../db/schema';
import { getUnderstandingProject, getObjectsForProject } from '../db/understanding';
import type {
  UnderstandingProject,
  UnderstandingObject,
  UnderstandingEvent,
  EvidenceRef,
} from '../../types/understanding';

/** An evidence reference resolved to a displayable conversation link. */
export interface EvidenceLink extends EvidenceRef {
  /** null when the cited conversation was deleted after analysis. */
  conversationName: string | null;
}

/** One object plus the provenance union of its event stream. */
export interface UnderstandingItem {
  object: UnderstandingObject;
  evidence: EvidenceLink[];
  /** Source-timeline moment of the latest event, for ordering and display. */
  lastActivityAt: Date;
}

/** One entry in the recent-changes stream. */
export interface RecentChange {
  event: UnderstandingEvent;
  objectTitle: string;
  objectType: string;
}

export interface CurrentUnderstanding {
  direction: UnderstandingItem[];
  ideasAndDecisions: UnderstandingItem[];
  openQuestions: UnderstandingItem[];
  recentChanges: RecentChange[];
}

export interface AssembleOptions {
  /** Cap on the recent-changes stream. */
  recentLimit?: number;
}

const DEFAULT_RECENT_LIMIT = 15;

/**
 * Dedupe evidence by conversation, merging messageIds and keeping the first
 * note seen — one link per conversation is what the panel renders.
 */
export function mergeEvidence(
  events: UnderstandingEvent[],
  conversationNames: Map<string, string>
): EvidenceLink[] {
  const byConversation = new Map<string, EvidenceLink>();
  for (const event of events) {
    for (const ref of event.evidence) {
      const existing = byConversation.get(ref.conversationId);
      if (!existing) {
        byConversation.set(ref.conversationId, {
          ...ref,
          conversationName: conversationNames.get(ref.conversationId) ?? null,
        });
        continue;
      }
      if (ref.messageIds?.length) {
        existing.messageIds = [...new Set([...(existing.messageIds ?? []), ...ref.messageIds])];
      }
      if (!existing.note && ref.note) existing.note = ref.note;
    }
  }
  return [...byConversation.values()];
}

/**
 * Pure assembly over already-loaded rows (exported for tests; the Dexie
 * loader below feeds it). Rejected objects are excluded entirely; pending and
 * accepted both render (pending is flagged in the UI, not hidden — hiding
 * everything until review would make the panel empty for most users).
 */
export function assembleCurrentUnderstanding(
  objects: UnderstandingObject[],
  events: UnderstandingEvent[],
  conversationNames: Map<string, string>,
  options: AssembleOptions = {}
): CurrentUnderstanding {
  const recentLimit = options.recentLimit ?? DEFAULT_RECENT_LIMIT;

  const included = objects.filter((o) => o.reviewState !== 'rejected');
  const includedIds = new Set(included.map((o) => o.id));
  const eventsByObject = new Map<string, UnderstandingEvent[]>();
  for (const event of events) {
    if (!includedIds.has(event.objectId)) continue;
    const list = eventsByObject.get(event.objectId) ?? [];
    list.push(event);
    eventsByObject.set(event.objectId, list);
  }

  const toItem = (object: UnderstandingObject): UnderstandingItem => {
    const own = eventsByObject.get(object.id) ?? [];
    const lastActivityAt = own.reduce(
      (latest, e) => (e.occurredAt > latest ? e.occurredAt : latest),
      object.createdAt
    );
    return { object, evidence: mergeEvidence(own, conversationNames), lastActivityAt };
  };

  const byRecency = (a: UnderstandingItem, b: UnderstandingItem) =>
    b.lastActivityAt.getTime() - a.lastActivityAt.getTime();

  const current = included.filter((o) => o.status === 'current').map(toItem).sort(byRecency);

  const objectById = new Map(included.map((o) => [o.id, o]));
  const recentChanges: RecentChange[] = events
    .filter((e) => includedIds.has(e.objectId))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, recentLimit)
    .map((event) => {
      const object = objectById.get(event.objectId)!;
      return { event, objectTitle: object.title, objectType: object.type };
    });

  return {
    direction: current.filter((i) => i.object.type === 'direction'),
    openQuestions: current.filter((i) => i.object.type === 'question'),
    ideasAndDecisions: current.filter(
      (i) => i.object.type !== 'direction' && i.object.type !== 'question'
    ),
    recentChanges,
  };
}

export interface ProjectUnderstanding {
  /** null for the "unassigned" bucket (objects with no project, PRD §6). */
  project: UnderstandingProject | null;
  understanding: CurrentUnderstanding;
}

/**
 * Load everything the panel needs for one project, or — with projectId null —
 * for the unassigned bucket. Returns null only for an unknown project id.
 */
export async function loadProjectUnderstanding(
  projectId: string | null,
  options: AssembleOptions = {}
): Promise<ProjectUnderstanding | null> {
  const project = projectId === null ? null : await getUnderstandingProject(projectId);
  if (projectId !== null && !project) return null;

  const objects = await getObjectsForProject(projectId);
  const events = await db.understandingEvents
    .where('objectId')
    .anyOf(objects.map((o) => o.id))
    .toArray();

  const conversationIds = [
    ...new Set(events.flatMap((e) => e.evidence.map((ref) => ref.conversationId))),
  ];
  const conversations = await db.conversations.where('id').anyOf(conversationIds).toArray();
  const conversationNames = new Map(conversations.map((c) => [c.id, c.name]));

  return {
    project: project ?? null,
    understanding: assembleCurrentUnderstanding(objects, events, conversationNames, options),
  };
}
