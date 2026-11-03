// Dexie loader for the landscape projection. Read-only: loading, viewing,
// navigating, and switching lenses never write understanding records and
// never call a provider.

import { db } from '../db/schema';
import { assembleLandscape, type Landscape } from './projection';
import { assembleResume, loadResumeInputs, type ProjectResume } from './resume';

export interface LoadedLandscape {
  landscape: Landscape;
  resume: Map<string, ProjectResume>;
  /** Projection wall time, for the render-budget instrumentation. */
  projectionMs: number;
}

export async function loadLandscape(): Promise<LoadedLandscape> {
  const [projects, objects, events, associations, regions, resumeInputs] = await Promise.all([
    db.understandingProjects.toArray(),
    db.understandingObjects.toArray(),
    db.understandingEvents.toArray(),
    db.projectAssociations.toArray(),
    db.landscapeRegions.toArray(),
    loadResumeInputs(),
  ]);
  const conversationIds = new Set<string>();
  for (const e of events) for (const ref of e.evidence) conversationIds.add(ref.conversationId);
  for (const a of associations) conversationIds.add(a.conversationId);
  const conversations = await db.conversations.where('id').anyOf([...conversationIds]).toArray();
  const conversationNames = new Map(conversations.map((c) => [c.id, c.name]));

  const started = performance.now();
  const landscape = assembleLandscape({
    projects,
    objects,
    events,
    associations,
    conversationNames,
    regions,
  });
  const resume = assembleResume(landscape, resumeInputs.inspections, resumeInputs.changes);
  return { landscape, resume, projectionMs: performance.now() - started };
}
