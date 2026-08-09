// Understanding overview (PRD §12, phase U4.1).
//
// The home surface for understanding across projects: per-project stats,
// an open-questions rollup, and a global recent-changes stream. Pure
// assembly over rows the store already holds — no LLM calls.
//
// Inclusion rules mirror the per-project panel (currentUnderstanding.ts):
// rejected projects/objects/events are excluded everywhere; pending ones are
// included and counted as awaiting review. Objects under a rejected project
// are excluded with it — they're unreachable from the page.

import { db } from '../db/schema';
import type {
  UnderstandingProject,
  UnderstandingObject,
  UnderstandingEvent,
} from '../../types/understanding';

export interface ProjectOverviewStats {
  project: UnderstandingProject;
  /** Current (non-superseded, non-resolved) objects, pending included. */
  objectCount: number;
  openQuestionCount: number;
  /** Pending objects + pending events — everything awaiting review. */
  pendingReviewCount: number;
  /** Newest live event on the project's objects (source timeline). */
  lastActivityAt: Date | null;
}

export interface OverviewQuestion {
  object: UnderstandingObject;
  /** null for the unassigned bucket. */
  projectId: string | null;
  projectName: string | null;
  lastActivityAt: Date;
}

export interface OverviewChange {
  event: UnderstandingEvent;
  objectTitle: string;
  objectType: string;
  projectId: string | null;
  projectName: string | null;
  supersededByTitle?: string;
}

export interface UnderstandingOverview {
  /** Non-rejected projects, most recently active first. */
  projects: ProjectOverviewStats[];
  /** Non-rejected objects with no project (any status — matches the link count). */
  unassignedCount: number;
  /** Current questions across all projects and the unassigned bucket. */
  openQuestions: OverviewQuestion[];
  /** Global stream, newest first, capped. */
  recentChanges: OverviewChange[];
}

export interface OverviewOptions {
  /** Cap on the global recent-changes stream. */
  recentLimit?: number;
}

const DEFAULT_RECENT_LIMIT = 15;

export function assembleOverview(
  projects: UnderstandingProject[],
  objects: UnderstandingObject[],
  events: UnderstandingEvent[],
  options: OverviewOptions = {}
): UnderstandingOverview {
  const recentLimit = options.recentLimit ?? DEFAULT_RECENT_LIMIT;

  const includedProjects = projects.filter((p) => p.reviewState !== 'rejected');
  const projectById = new Map(includedProjects.map((p) => [p.id, p]));

  const includedObjects = objects.filter(
    (o) =>
      o.reviewState !== 'rejected' && (o.projectId === null || projectById.has(o.projectId))
  );
  const objectById = new Map(includedObjects.map((o) => [o.id, o]));

  const liveEvents = events.filter(
    (e) => e.reviewState !== 'rejected' && objectById.has(e.objectId)
  );

  const lastActivityByObject = new Map<string, Date>();
  for (const event of liveEvents) {
    const prev = lastActivityByObject.get(event.objectId);
    if (!prev || event.occurredAt > prev) {
      lastActivityByObject.set(event.objectId, event.occurredAt);
    }
  }
  const objectActivity = (o: UnderstandingObject): Date =>
    lastActivityByObject.get(o.id) ?? o.createdAt;

  const pendingEventCountByProject = new Map<string | null, number>();
  for (const event of liveEvents) {
    if (event.reviewState !== 'pending') continue;
    const projectId = objectById.get(event.objectId)!.projectId;
    pendingEventCountByProject.set(
      projectId,
      (pendingEventCountByProject.get(projectId) ?? 0) + 1
    );
  }

  const stats: ProjectOverviewStats[] = includedProjects.map((project) => {
    const own = includedObjects.filter((o) => o.projectId === project.id);
    const current = own.filter((o) => o.status === 'current');
    let lastActivityAt: Date | null = null;
    for (const o of own) {
      const at = lastActivityByObject.get(o.id);
      if (at && (!lastActivityAt || at > lastActivityAt)) lastActivityAt = at;
    }
    return {
      project,
      objectCount: current.length,
      openQuestionCount: current.filter((o) => o.type === 'question').length,
      pendingReviewCount:
        own.filter((o) => o.reviewState === 'pending').length +
        (pendingEventCountByProject.get(project.id) ?? 0),
      lastActivityAt,
    };
  });
  stats.sort((a, b) => {
    const at = a.lastActivityAt?.getTime() ?? 0;
    const bt = b.lastActivityAt?.getTime() ?? 0;
    return bt - at || b.project.updatedAt.getTime() - a.project.updatedAt.getTime();
  });

  const projectName = (projectId: string | null): string | null =>
    projectId === null ? null : projectById.get(projectId)?.name ?? null;

  const openQuestions: OverviewQuestion[] = includedObjects
    .filter((o) => o.type === 'question' && o.status === 'current')
    .map((object) => ({
      object,
      projectId: object.projectId,
      projectName: projectName(object.projectId),
      lastActivityAt: objectActivity(object),
    }))
    .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());

  const recentChanges: OverviewChange[] = liveEvents
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, recentLimit)
    .map((event) => {
      const object = objectById.get(event.objectId)!;
      const replacement = event.supersededByObjectId
        ? objectById.get(event.supersededByObjectId)
        : undefined;
      return {
        event,
        objectTitle: object.title,
        objectType: object.type,
        projectId: object.projectId,
        projectName: projectName(object.projectId),
        ...(replacement ? { supersededByTitle: replacement.title } : {}),
      };
    });

  return {
    projects: stats,
    unassignedCount: includedObjects.filter((o) => o.projectId === null).length,
    openQuestions,
    recentChanges,
  };
}

/** Load everything the overview needs and assemble it. */
export async function loadUnderstandingOverview(
  options: OverviewOptions = {}
): Promise<UnderstandingOverview> {
  const [projects, objects, events] = await Promise.all([
    db.understandingProjects.toArray(),
    db.understandingObjects.toArray(),
    db.understandingEvents.toArray(),
  ]);
  return assembleOverview(projects, objects, events, options);
}
