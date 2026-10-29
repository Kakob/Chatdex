// "Where you left off" lens data (docs/changes/understanding-landscape).
//
// Three clocks, never mixed:
//   - reading: landscape visits the user made in this app, recorded in the
//     LOCAL-ONLY inspections log (db/inspections.ts) at the moment of viewing;
//   - editing: active Change Workspaces (Prepared Changes) for the project,
//     whose updatedAt is a user edit of that workspace;
//   - source: the latest event occurredAt in conversation history.
// Import/analysis time (object.createdAt) is never presented as user work,
// and no visit history is ever seeded.

import { db } from '../db/schema';
import { recordInspection } from '../db/inspections';
import type { InspectionRow } from '../../types/repo';
import type { PreparedChange } from '../../types/preparedChange';
import { UNASSIGNED_KEY, UNCATEGORIZED_ID, type Landscape } from './projection';

const PREFIX = 'landscape:';

export type VisitKind = 'region' | 'finding' | 'source';

export interface LandscapeVisit {
  kind: VisitKind;
  projectId: string;
  regionId?: string;
  objectId?: string;
  conversationId?: string;
  at: Date;
}

export function visitTargetKey(visit: Omit<LandscapeVisit, 'at' | 'projectId'>): string {
  switch (visit.kind) {
    case 'region':
      return `${PREFIX}region:${visit.regionId}`;
    case 'finding':
      return `${PREFIX}finding:${visit.regionId ?? UNCATEGORIZED_ID}:${visit.objectId}`;
    case 'source':
      return `${PREFIX}source:${visit.regionId ?? UNCATEGORIZED_ID}:${visit.objectId}:${visit.conversationId}`;
  }
}

export function parseVisit(row: InspectionRow): LandscapeVisit | null {
  if (!row.targetKey.startsWith(PREFIX)) return null;
  const [kind, ...parts] = row.targetKey.slice(PREFIX.length).split(':');
  const base = { projectId: row.projectId, at: row.at };
  if (kind === 'region' && parts.length === 1) return { ...base, kind, regionId: parts[0] };
  if (kind === 'finding' && parts.length === 2) {
    return { ...base, kind, regionId: parts[0], objectId: parts[1] };
  }
  if (kind === 'source' && parts.length === 3) {
    return { ...base, kind, regionId: parts[0], objectId: parts[1], conversationId: parts[2] };
  }
  return null;
}

/** Record one landscape visit on this device. No-op for the virtual "No project" place. */
export async function recordLandscapeVisit(
  visit: Omit<LandscapeVisit, 'at'>
): Promise<void> {
  if (visit.projectId === UNASSIGNED_KEY) return;
  await recordInspection({
    projectId: visit.projectId,
    kind: visit.kind === 'source' ? 'evidence' : 'node',
    targetKey: visitTargetKey(visit),
  });
}

export interface ActiveWorkspace {
  id: string;
  title: string;
  state: PreparedChange['state'];
  /** Last edit of the workspace — an editing signal. */
  updatedAt: Date;
  understandingPointIds: string[];
}

export interface ProjectResume {
  projectId: string;
  /** Most recent valid visit (target still exists), or null when none recorded. */
  last: LandscapeVisit | null;
  /** Distinct recent visits, newest first (≤ 5), all still valid. */
  recent: LandscapeVisit[];
  visitCount: number;
  workspaces: ActiveWorkspace[];
}

/**
 * Pure assembly. Visits whose finding/region no longer exists in the
 * landscape are dropped so a resume action never lands on a stale id.
 */
export function assembleResume(
  landscape: Landscape,
  inspections: InspectionRow[],
  changes: PreparedChange[]
): Map<string, ProjectResume> {
  const out = new Map<string, ProjectResume>();
  for (const project of landscape.projects) {
    if (!project.project) continue;
    out.set(project.key, { projectId: project.key, last: null, recent: [], visitCount: 0, workspaces: [] });
  }

  const valid = (v: LandscapeVisit): boolean => {
    const project = landscape.projects.find((p) => p.key === v.projectId);
    if (!project) return false;
    if (v.objectId) {
      const finding = landscape.findings.get(v.objectId);
      if (!finding || finding.projectKey !== v.projectId) return false;
    }
    if (v.kind === 'region' && v.regionId) {
      return v.regionId === UNCATEGORIZED_ID
        ? project.regions.some((r) => r.id === UNCATEGORIZED_ID)
        : landscape.regions.get(v.regionId)?.projectKey === v.projectId;
    }
    if (v.kind === 'source' && v.objectId && v.conversationId) {
      return landscape.findings
        .get(v.objectId)!
        .evidence.some((e) => e.conversationId === v.conversationId);
    }
    return true;
  };

  const visits = inspections
    .map(parseVisit)
    .filter((v): v is LandscapeVisit => v !== null && out.has(v.projectId) && valid(v))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  for (const visit of visits) {
    const entry = out.get(visit.projectId)!;
    entry.visitCount += 1;
    if (!entry.last) entry.last = visit;
    const key = visitTargetKey(visit);
    if (entry.recent.length < 5 && !entry.recent.some((r) => visitTargetKey(r) === key)) {
      entry.recent.push(visit);
    }
  }

  for (const change of changes) {
    const entry = out.get(change.projectId);
    if (!entry || change.state === 'closed') continue;
    entry.workspaces.push({
      id: change.id,
      title: change.title,
      state: change.state,
      updatedAt: change.updatedAt,
      understandingPointIds: change.understandingPointIds,
    });
  }
  for (const entry of out.values()) {
    entry.workspaces.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  return out;
}

export async function loadResumeInputs(): Promise<{
  inspections: InspectionRow[];
  changes: PreparedChange[];
}> {
  const [inspections, changes] = await Promise.all([
    db.inspections.filter((row) => row.targetKey.startsWith(PREFIX)).toArray(),
    db.preparedChanges.toArray(),
  ]);
  return { inspections, changes };
}
