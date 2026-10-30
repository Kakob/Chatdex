// Understanding Landscape projection (docs/changes/understanding-landscape).
//
// Pure assembly over rows the store already holds: projects, understanding
// objects/events, associations, conversation names, and landscape regions →
// a landscape of places (projects → regions → subregions → findings) with
// distinct-record counts and inspectable shared-source connections. No SVG,
// no Dexie, no provider calls; loadLandscape() at the bottom feeds it.
//
// Eligible-record policy (shared by landscape scenes, counts, and search):
//   - rejected objects are excluded; pending and accepted/edited are included
//     and their review state is carried, never collapsed into lifecycle;
//   - every lifecycle status is included (current, superseded, resolved) so
//     history stays reachable; status is shown separately from review;
//   - intent objects are excluded — they belong to Intent Trace, which is
//     linked rather than re-projected here;
//   - objects under a rejected or missing project are excluded with it;
//     objects with no project land in the virtual "No project" place.
//
// Counts follow the Projects page (understanding/overview.ts) so the two
// surfaces agree: `current` counts current findings, pending included;
// `toReview` is pending findings plus pending changes to findings; `open`
// is current questions. Superseded/resolved findings stay on the map and
// are counted separately as `historical`.
//
// Evidence: rejected events contribute nothing. A conversation is 'reviewed'
// support only when an accepted/edited event cites it AND the object itself
// has been accepted/edited — a pending object's auto-applied 'introduced'
// event must not read as reviewed. Everything else is 'proposed' support.
// Neither is proof of the claim.

import type {
  ProjectAssociation,
  UnderstandingEvent,
  UnderstandingObject,
  UnderstandingProject,
} from '../../types/understanding';
import type { LandscapeRegion } from '../../types/landscape';
import { compareRegions, MAX_PINNED_STATEMENTS } from './organize';

/** Key of the virtual place holding objects with no project. */
export const UNASSIGNED_KEY = 'unassigned';
/** Id of the virtual region holding a project's findings no region claims. */
export const UNCATEGORIZED_ID = 'uncategorized';

/** Muted project colors from the reference atlas, assigned in stable project order. */
export const PROJECT_COLORS = [
  '#326c56',
  '#837045',
  '#6b658b',
  '#a57565',
  '#4d7891',
  '#667b91',
  '#7a7f4a',
  '#8a6a7f',
] as const;
export const UNASSIGNED_COLOR = '#7b8a78';

export type MarkerTone = 'pending' | 'reviewed' | 'open' | 'historical';

export interface LandscapeEvidence {
  conversationId: string;
  /** null when the conversation is not on this device (other device, or deleted). */
  conversationName: string | null;
  messageIds: string[];
  /** First note attached to the citation (AI rationale or user note). */
  note?: string;
  support: 'reviewed' | 'proposed';
}

export interface LandscapeFinding {
  object: UnderstandingObject;
  /** Landscape place key: the project id, or UNASSIGNED_KEY. */
  projectKey: string;
  tone: MarkerTone;
  evidence: LandscapeEvidence[];
  /** Non-rejected events, oldest first (source timeline). */
  events: UnderstandingEvent[];
  pendingEventCount: number;
  contradictionCount: number;
  /** Source clock: latest event occurredAt (conversation time). null without events. */
  sourceAt: Date | null;
  /** Recorded clock: when Chatdex stored the object (analysis/import time). */
  recordedAt: Date;
  /** Regions (in its own project) holding this finding; empty → Uncategorized. */
  regionIds: string[];
}

export interface LandscapeCounts {
  /** Distinct current findings, pending included (Projects page "understanding objects"). */
  current: number;
  /** Pending findings plus pending changes to findings (Projects page "to review"). */
  toReview: number;
  /** Current questions. */
  open: number;
  /** Superseded or resolved findings. */
  historical: number;
}

export interface LandscapePreview {
  objectId: string;
  title: string;
  /** true when the user pinned it; false for the deterministic fallback. */
  pinned: boolean;
}

export interface LandscapeRegionNode {
  /** Region id, or UNCATEGORIZED_ID for the virtual region. */
  id: string;
  region: LandscapeRegion | null;
  projectKey: string;
  title: string;
  summary?: string;
  parentId: string | null;
  depth: number;
  children: LandscapeRegionNode[];
  /** Eligible findings placed directly here, in stable display order. */
  directIds: string[];
  /** Distinct findings here and in every descendant. */
  allIds: string[];
  previews: LandscapePreview[];
  counts: LandscapeCounts;
}

export interface LandscapeProjectNode {
  key: string;
  project: UnderstandingProject | null;
  name: string;
  description?: string;
  color: string;
  /** Distinct eligible findings, stable order. */
  findingIds: string[];
  /** Top-level regions in user order, then Uncategorized when non-empty. */
  regions: LandscapeRegionNode[];
  /** Number of user-created regions (all depths). */
  regionCount: number;
  /** Non-rejected conversation associations. */
  sourceCount: number;
  pendingSourceCount: number;
  counts: LandscapeCounts;
  previews: LandscapePreview[];
  latestSourceAt: Date | null;
  sample: boolean;
}

export interface LandscapeConnection {
  /** `${a}~${b}` with a < b. */
  id: string;
  a: string;
  b: string;
  conversationIds: string[];
  conversationNames: (string | null)[];
  /** True when any association behind the edge is still pending review. */
  weak: boolean;
}

export interface Landscape {
  projects: LandscapeProjectNode[];
  findings: Map<string, LandscapeFinding>;
  regions: Map<string, LandscapeRegionNode>;
  connections: LandscapeConnection[];
  totals: LandscapeCounts;
}

export interface LandscapeInput {
  projects: UnderstandingProject[];
  objects: UnderstandingObject[];
  events: UnderstandingEvent[];
  associations: ProjectAssociation[];
  conversationNames: Map<string, string>;
  regions: LandscapeRegion[];
}

/** The shared eligible-record predicate (see header). */
export function isEligibleObject(
  object: UnderstandingObject,
  liveProjectIds: Set<string>
): boolean {
  if (object.reviewState === 'rejected' || object.type === 'intent') return false;
  return object.projectId === null || liveProjectIds.has(object.projectId);
}

export function toneFor(object: UnderstandingObject): MarkerTone {
  if (object.status !== 'current') return 'historical';
  if (object.type === 'question') return 'open';
  return object.reviewState === 'pending' ? 'pending' : 'reviewed';
}

const reviewed = (e: UnderstandingEvent) => e.reviewState === 'accepted' || e.reviewState === 'edited';

function buildEvidence(
  object: UnderstandingObject,
  events: UnderstandingEvent[],
  conversationNames: Map<string, string>
): LandscapeEvidence[] {
  const objectReviewed = object.reviewState === 'accepted' || object.reviewState === 'edited';
  const byConversation = new Map<string, LandscapeEvidence>();
  for (const event of events) {
    for (const ref of event.evidence) {
      let entry = byConversation.get(ref.conversationId);
      if (!entry) {
        entry = {
          conversationId: ref.conversationId,
          conversationName: conversationNames.get(ref.conversationId) ?? null,
          messageIds: [],
          support: 'proposed',
        };
        byConversation.set(ref.conversationId, entry);
      }
      for (const id of ref.messageIds ?? []) {
        if (!entry.messageIds.includes(id)) entry.messageIds.push(id);
      }
      if (!entry.note && ref.note) entry.note = ref.note;
      if (objectReviewed && reviewed(event)) entry.support = 'reviewed';
    }
  }
  // Reviewed support first; otherwise citation order.
  return [...byConversation.values()].sort(
    (a, b) => Number(b.support === 'reviewed') - Number(a.support === 'reviewed')
  );
}

function countOf(ids: string[], findings: Map<string, LandscapeFinding>): LandscapeCounts {
  const counts: LandscapeCounts = { current: 0, toReview: 0, open: 0, historical: 0 };
  for (const id of ids) {
    const f = findings.get(id);
    if (!f) continue;
    counts.toReview += f.pendingEventCount + Number(f.object.reviewState === 'pending');
    if (f.object.status !== 'current') {
      counts.historical += 1;
      continue;
    }
    counts.current += 1;
    if (f.object.type === 'question') counts.open += 1;
  }
  return counts;
}

/** Stable finding order: current before historical, then recorded time, then id. */
function compareFindings(a: LandscapeFinding, b: LandscapeFinding): number {
  const historical = Number(a.tone === 'historical') - Number(b.tone === 'historical');
  return (
    historical ||
    a.recordedAt.getTime() - b.recordedAt.getTime() ||
    a.object.id.localeCompare(b.object.id)
  );
}

/**
 * Representative statements: the user's pins first, then a deterministic,
 * factual fallback — current reviewed findings, then current pending ones,
 * in stable order. Never generated text.
 */
function previewsFor(
  ids: string[],
  pinned: string[],
  findings: Map<string, LandscapeFinding>
): LandscapePreview[] {
  const out: LandscapePreview[] = [];
  const idSet = new Set(ids);
  for (const id of pinned) {
    const f = findings.get(id);
    if (f && idSet.has(id) && out.length < MAX_PINNED_STATEMENTS) {
      out.push({ objectId: id, title: f.object.title, pinned: true });
    }
  }
  const rank = (f: LandscapeFinding) => (f.tone === 'reviewed' ? 0 : f.tone === 'historical' ? 2 : 1);
  const rest = ids
    .map((id) => findings.get(id)!)
    .filter((f) => f && !out.some((p) => p.objectId === f.object.id) && f.tone !== 'historical')
    .sort((a, b) => rank(a) - rank(b));
  for (const f of rest) {
    if (out.length >= MAX_PINNED_STATEMENTS) break;
    out.push({ objectId: f.object.id, title: f.object.title, pinned: false });
  }
  return out;
}

export function assembleLandscape(input: LandscapeInput): Landscape {
  const liveProjects = input.projects
    .filter((p) => p.reviewState !== 'rejected')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const liveProjectIds = new Set(liveProjects.map((p) => p.id));

  const eligible = input.objects.filter((o) => isEligibleObject(o, liveProjectIds));
  const eligibleIds = new Set(eligible.map((o) => o.id));

  const eventsByObject = new Map<string, UnderstandingEvent[]>();
  for (const event of input.events) {
    if (event.reviewState === 'rejected' || !eligibleIds.has(event.objectId)) continue;
    const list = eventsByObject.get(event.objectId) ?? [];
    list.push(event);
    eventsByObject.set(event.objectId, list);
  }

  const findings = new Map<string, LandscapeFinding>();
  for (const object of eligible) {
    const events = (eventsByObject.get(object.id) ?? []).sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
    );
    findings.set(object.id, {
      object,
      projectKey: object.projectId ?? UNASSIGNED_KEY,
      tone: toneFor(object),
      evidence: buildEvidence(object, events, input.conversationNames),
      events,
      pendingEventCount: events.filter((e) => e.reviewState === 'pending').length,
      contradictionCount: events.filter((e) => e.op === 'contradicted').length,
      sourceAt: events.length ? events[events.length - 1].occurredAt : null,
      recordedAt: object.createdAt,
      regionIds: [],
    });
  }

  const regionNodes = new Map<string, LandscapeRegionNode>();
  const projects: LandscapeProjectNode[] = [];

  const sourceCounts = new Map<string, { total: number; pending: number }>();
  for (const a of input.associations) {
    if (a.reviewState === 'rejected' || !liveProjectIds.has(a.projectId)) continue;
    const entry = sourceCounts.get(a.projectId) ?? { total: 0, pending: 0 };
    entry.total += 1;
    if (a.reviewState === 'pending') entry.pending += 1;
    sourceCounts.set(a.projectId, entry);
  }

  const placeKeys: Array<{ key: string; project: UnderstandingProject | null }> = liveProjects.map(
    (project) => ({ key: project.id, project })
  );
  if (eligible.some((o) => o.projectId === null)) placeKeys.push({ key: UNASSIGNED_KEY, project: null });

  placeKeys.forEach(({ key, project }, index) => {
    const own = [...findings.values()]
      .filter((f) => f.projectKey === key)
      .sort(compareFindings);
    const ownIds = own.map((f) => f.object.id);
    const ownSet = new Set(ownIds);

    // Region tree. Regions whose parent is missing or cyclic become
    // top-level, so no organization is ever unreachable.
    const rows = project ? input.regions.filter((r) => r.projectId === key).sort(compareRegions) : [];
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const effectiveParent = (r: LandscapeRegion): string | null => {
      if (!r.parentRegionId || !rowById.has(r.parentRegionId)) return null;
      const seen = new Set<string>([r.id]);
      let cursor = rowById.get(r.parentRegionId);
      while (cursor) {
        if (seen.has(cursor.id)) return null;
        seen.add(cursor.id);
        cursor = cursor.parentRegionId ? rowById.get(cursor.parentRegionId) : undefined;
      }
      return r.parentRegionId;
    };

    const nodes = rows.map((r): LandscapeRegionNode => {
      const directIds = [...new Set(r.memberObjectIds)].filter((id) => ownSet.has(id));
      const pinned = r.pinnedObjectIds.filter((id) => directIds.includes(id));
      const ordered = [
        ...pinned,
        ...ownIds.filter((id) => directIds.includes(id) && !pinned.includes(id)),
      ];
      for (const id of ordered) findings.get(id)!.regionIds.push(r.id);
      return {
        id: r.id,
        region: r,
        projectKey: key,
        title: r.title,
        summary: r.summary,
        parentId: effectiveParent(r),
        depth: 0,
        children: [],
        directIds: ordered,
        allIds: [],
        previews: [],
        counts: { current: 0, toReview: 0, open: 0, historical: 0 },
      };
    });
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const roots: LandscapeRegionNode[] = [];
    for (const node of nodes) {
      const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    const finish = (node: LandscapeRegionNode, depth: number): string[] => {
      node.depth = depth;
      const all = new Set(node.directIds);
      for (const child of node.children) for (const id of finish(child, depth + 1)) all.add(id);
      node.allIds = ownIds.filter((id) => all.has(id));
      node.counts = countOf(node.allIds, findings);
      node.previews = previewsFor(node.allIds, node.region?.pinnedObjectIds ?? [], findings);
      regionNodes.set(node.id, node);
      return node.allIds;
    };
    roots.forEach((root) => finish(root, 0));

    const placed = new Set(nodes.flatMap((n) => n.directIds));
    const uncategorizedIds = ownIds.filter((id) => !placed.has(id));
    if (uncategorizedIds.length > 0) {
      const node: LandscapeRegionNode = {
        id: UNCATEGORIZED_ID,
        region: null,
        projectKey: key,
        title: 'Uncategorized',
        summary:
          nodes.length === 0
            ? 'Every finding in this project. Create a region to start organizing.'
            : 'Findings not yet placed in a region.',
        parentId: null,
        depth: 0,
        children: [],
        directIds: uncategorizedIds,
        allIds: uncategorizedIds,
        previews: previewsFor(uncategorizedIds, [], findings),
        counts: countOf(uncategorizedIds, findings),
      };
      roots.push(node);
      // Virtual region ids repeat across projects; key them per project.
      regionNodes.set(`${key}/${UNCATEGORIZED_ID}`, node);
    }

    const sources = project ? sourceCounts.get(project.id) : undefined;
    const latestSourceAt = own.reduce<Date | null>(
      (latest, f) => (f.sourceAt && (!latest || f.sourceAt > latest) ? f.sourceAt : latest),
      null
    );
    projects.push({
      key,
      project,
      name: project?.name ?? 'No project',
      description: project?.description,
      color: project ? PROJECT_COLORS[index % PROJECT_COLORS.length] : UNASSIGNED_COLOR,
      findingIds: ownIds,
      regions: roots,
      regionCount: nodes.length,
      sourceCount: sources?.total ?? 0,
      pendingSourceCount: sources?.pending ?? 0,
      counts: countOf(ownIds, findings),
      previews: previewsFor(ownIds, [], findings),
      latestSourceAt,
      // Built-in samples use 'sample-' ids (demo/seedWorkspace SAMPLE_PROJECT_ID).
      sample: Boolean(project?.id.startsWith('sample-')),
    });
  });

  // Shared-source connections: two projects associated with the same
  // conversation. Observed co-citation, not a dependency.
  const projectsByConversation = new Map<string, ProjectAssociation[]>();
  for (const a of input.associations) {
    if (a.reviewState === 'rejected' || !liveProjectIds.has(a.projectId)) continue;
    const list = projectsByConversation.get(a.conversationId) ?? [];
    list.push(a);
    projectsByConversation.set(a.conversationId, list);
  }
  const edges = new Map<string, LandscapeConnection>();
  for (const [conversationId, list] of projectsByConversation) {
    const unique = [...new Map(list.map((a) => [a.projectId, a])).values()];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const [x, y] = [unique[i], unique[j]].sort((p, q) => p.projectId.localeCompare(q.projectId));
        const id = `${x.projectId}~${y.projectId}`;
        const edge = edges.get(id) ?? {
          id,
          a: x.projectId,
          b: y.projectId,
          conversationIds: [],
          conversationNames: [],
          weak: false,
        };
        edge.conversationIds.push(conversationId);
        edge.conversationNames.push(input.conversationNames.get(conversationId) ?? null);
        if (x.reviewState === 'pending' || y.reviewState === 'pending') edge.weak = true;
        edges.set(id, edge);
      }
    }
  }

  return {
    projects,
    findings,
    regions: regionNodes,
    connections: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    totals: countOf([...findings.keys()], findings),
  };
}

/** Look up a region node, resolving the per-project virtual Uncategorized id. */
export function regionNode(
  landscape: Landscape,
  projectKey: string,
  regionId: string
): LandscapeRegionNode | undefined {
  const node =
    regionId === UNCATEGORIZED_ID
      ? landscape.regions.get(`${projectKey}/${UNCATEGORIZED_ID}`)
      : landscape.regions.get(regionId);
  return node && node.projectKey === projectKey ? node : undefined;
}

/** Ancestor chain of a region, root first, including the region itself. */
export function regionPath(landscape: Landscape, node: LandscapeRegionNode): LandscapeRegionNode[] {
  const path: LandscapeRegionNode[] = [node];
  let cursor = node.parentId ? landscape.regions.get(node.parentId) : undefined;
  while (cursor && path.length < 32) {
    path.unshift(cursor);
    cursor = cursor.parentId ? landscape.regions.get(cursor.parentId) : undefined;
  }
  return path;
}

/** The region a finding is revealed in: its first region, else Uncategorized. */
export function homeRegionId(finding: LandscapeFinding): string {
  return finding.regionIds[0] ?? UNCATEGORIZED_ID;
}
