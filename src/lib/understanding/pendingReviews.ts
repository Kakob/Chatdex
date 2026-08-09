// Pending-review counts (U6.2 loop ergonomics).
//
// One number answering "how much is waiting for me to review?", surfaced as
// badges (sidebar, chat project chip). Inclusion mirrors the overview
// (overview.ts): rejected projects take everything under them out of the
// count — those rows are unreachable from the review surfaces, so counting
// them would produce a badge that can never be cleared.

import { db } from '../db/schema';
import type {
  UnderstandingProject,
  ProjectAssociation,
  UnderstandingObject,
  UnderstandingEvent,
} from '../../types/understanding';

export interface PendingReviewCounts {
  projects: number;
  associations: number;
  objects: number;
  events: number;
  total: number;
}

/** Pure assembly (exported for tests). */
export function assemblePendingCounts(
  projects: UnderstandingProject[],
  associations: ProjectAssociation[],
  objects: UnderstandingObject[],
  events: UnderstandingEvent[]
): PendingReviewCounts {
  const liveProjectIds = new Set(
    projects.filter((p) => p.reviewState !== 'rejected').map((p) => p.id)
  );

  const pendingProjects = projects.filter((p) => p.reviewState === 'pending').length;

  const pendingAssociations = associations.filter(
    (a) => a.reviewState === 'pending' && liveProjectIds.has(a.projectId)
  ).length;

  const includedObjects = objects.filter(
    (o) =>
      o.reviewState !== 'rejected' && (o.projectId === null || liveProjectIds.has(o.projectId))
  );
  const includedObjectIds = new Set(includedObjects.map((o) => o.id));
  const pendingObjects = includedObjects.filter((o) => o.reviewState === 'pending').length;

  const pendingEvents = events.filter(
    (e) => e.reviewState === 'pending' && includedObjectIds.has(e.objectId)
  ).length;

  return {
    projects: pendingProjects,
    associations: pendingAssociations,
    objects: pendingObjects,
    events: pendingEvents,
    total: pendingProjects + pendingAssociations + pendingObjects + pendingEvents,
  };
}

/** Everything awaiting review across the workspace. */
export async function loadPendingReviewCounts(): Promise<PendingReviewCounts> {
  const [projects, associations, objects, events] = await Promise.all([
    db.understandingProjects.toArray(),
    db.projectAssociations.toArray(),
    db.understandingObjects.toArray(),
    db.understandingEvents.toArray(),
  ]);
  return assemblePendingCounts(projects, associations, objects, events);
}

/**
 * Pending objects + events for one project — what its review strip shows
 * (matches the overview's per-project pendingReviewCount).
 */
export async function countPendingForProject(projectId: string): Promise<number> {
  const objects = (
    await db.understandingObjects.where('projectId').equals(projectId).toArray()
  ).filter((o) => o.reviewState !== 'rejected');
  const objectIds = objects.map((o) => o.id);
  const pendingEvents =
    objectIds.length === 0
      ? []
      : (await db.understandingEvents.where('objectId').anyOf(objectIds).toArray()).filter(
          (e) => e.reviewState === 'pending'
        );
  return objects.filter((o) => o.reviewState === 'pending').length + pendingEvents.length;
}
