// Deterministic, explicitly labeled SYNTHETIC landscape fixtures for scale
// checks (ACCEPTANCE.md: 25 / 100 / 300 records). In-memory only — never
// written to the user's database. Used by tests and the dev-only lab route.
//
// The target records (TARGETS) are identical at every size so navigation
// tasks are comparable: a known decision, an unresolved question with a
// contradiction, and a decision cited by a message-anchored source.

import type {
  ProjectAssociation,
  UnderstandingEvent,
  UnderstandingObject,
  UnderstandingProject,
} from '../../types/understanding';
import type { LandscapeRegion } from '../../types/landscape';
import { assembleLandscape, type LandscapeInput } from './projection';
import type { LoadedLandscape } from './load';

export const SYNTHETIC_SIZES = [25, 100, 300] as const;

export const TARGETS = {
  decision: 'syn-target-decision',
  question: 'syn-target-question',
  cited: 'syn-target-cited',
  citedConversation: 'syn-conv-target',
} as const;

const PROJECTS = ['Synthetic Atlas', 'Synthetic Ledger', 'Synthetic Garden', 'Synthetic Relay', 'Synthetic Harbor'];
const TOPICS = ['Sync', 'Import', 'Review', 'Search', 'Layout', 'Sources', 'Export', 'Onboarding'];
const TYPES = ['decision', 'idea', 'direction', 'question', 'goal'];

function at(day: number): Date {
  return new Date(Date.UTC(2026, 8, 1 + (day % 50), 12, day % 60));
}

export function syntheticInput(size: number): LandscapeInput {
  const projects: UnderstandingProject[] = PROJECTS.map((name, i) => ({
    id: `syn-p${i}`,
    name,
    description: `Synthetic fixture project ${i + 1} for landscape scale checks.`,
    origin: 'user',
    reviewState: 'accepted',
    createdAt: at(i),
    updatedAt: at(i),
  }));
  const objects: UnderstandingObject[] = [];
  const events: UnderstandingEvent[] = [];
  const conversationNames = new Map<string, string>();
  const associations: ProjectAssociation[] = [];

  for (let c = 0; c < 40; c++) {
    // Every 7th conversation is "missing on this device" (no name).
    if (c % 7 !== 3) conversationNames.set(`syn-conv-${c}`, `Synthetic conversation ${c + 1}`);
  }
  conversationNames.set(TARGETS.citedConversation, 'Synthetic: embargo explanation');

  const add = (o: Omit<UnderstandingObject, 'createdAt' | 'updatedAt' | 'origin'> & { day: number }, evidence: string[], extra: Partial<UnderstandingEvent>[] = []) => {
    const { day, ...rest } = o;
    objects.push({ ...rest, origin: 'ai', createdAt: at(day), updatedAt: at(day) });
    events.push({
      id: `${o.id}-e0`,
      objectId: o.id,
      op: 'introduced',
      evidence: evidence.map((conversationId, k) => ({ conversationId, messageIds: [`${conversationId}-m${k}`], note: 'Synthetic citation' })),
      origin: 'ai',
      reviewState: o.reviewState === 'pending' ? 'pending' : 'accepted',
      occurredAt: at(day),
      createdAt: at(day + 1),
    });
    extra.forEach((e, k) =>
      events.push({
        id: `${o.id}-e${k + 1}`,
        objectId: o.id,
        op: 'supported',
        evidence: [],
        origin: 'ai',
        reviewState: 'accepted',
        occurredAt: at(day + k + 2),
        createdAt: at(day + k + 3),
        ...e,
      })
    );
  };

  // Targets: identical at every size, in project 0.
  add({ id: TARGETS.decision, projectId: 'syn-p0', type: 'decision', title: 'Synthetic target: sync carries ciphertext only', body: 'Known decision used by the locate-a-decision task.', status: 'current', reviewState: 'accepted', day: 1 }, ['syn-conv-0', 'syn-conv-1']);
  add({ id: TARGETS.question, projectId: 'syn-p0', type: 'question', title: 'Synthetic target: how should ballots aggregate?', body: 'Unresolved issue with a recorded contradiction.', status: 'current', reviewState: 'pending', day: 2 }, ['syn-conv-2'], [
    { op: 'contradicted', detail: 'Median vs pairwise ranking disagree on ties', evidence: [{ conversationId: 'syn-conv-4' }], reviewState: 'pending' },
  ]);
  add({ id: TARGETS.cited, projectId: 'syn-p0', type: 'direction', title: 'Synthetic target: embargo blocks computation, not viewing', status: 'current', reviewState: 'accepted', day: 3 }, [TARGETS.citedConversation, 'syn-conv-3']);

  for (let i = objects.length; i < size; i++) {
    const p = i % PROJECTS.length;
    const type = TYPES[i % TYPES.length];
    const historical = i % 11 === 0;
    const id = `syn-o${i}`;
    add(
      {
        id,
        projectId: `syn-p${p}`,
        type,
        title: `Synthetic ${type} ${i}: ${TOPICS[i % TOPICS.length].toLowerCase()} behaviour ${i % 13}`,
        body: `Synthetic fixture record ${i}.`,
        status: historical ? (type === 'question' ? 'resolved' : 'superseded') : 'current',
        reviewState: i % 3 === 0 ? 'pending' : i % 17 === 0 ? 'edited' : 'accepted',
        day: i,
      },
      i % 5 === 0 ? [] : [`syn-conv-${i % 40}`, ...(i % 4 === 0 ? [`syn-conv-${(i + 9) % 40}`] : [])],
      historical ? [{ op: type === 'question' ? 'resolved' : 'superseded', supersededByObjectId: type === 'question' ? undefined : `syn-o${i + 1}` }] : i % 19 === 0 ? [{ op: 'contradicted', detail: 'Synthetic contradiction', evidence: [{ conversationId: `syn-conv-${(i + 1) % 40}` }] }] : []
    );
  }
  // One rejected object: must never appear.
  objects.push({ id: 'syn-rejected', projectId: 'syn-p0', type: 'idea', title: 'Synthetic rejected idea', status: 'current', origin: 'ai', reviewState: 'rejected', createdAt: at(0), updatedAt: at(0) });

  for (let c = 0; c < 40; c++) {
    const projectsFor = [c % PROJECTS.length, ...(c % 9 === 0 ? [(c + 1) % PROJECTS.length] : [])];
    for (const p of projectsFor) {
      associations.push({ id: `syn-a${c}-${p}`, projectId: `syn-p${p}`, conversationId: `syn-conv-${c}`, confidence: 0.8, origin: 'ai', reviewState: c % 2 ? 'accepted' : 'pending', createdAt: at(c), updatedAt: at(c) });
    }
  }
  associations.push({ id: 'syn-a-target', projectId: 'syn-p0', conversationId: TARGETS.citedConversation, confidence: 1, origin: 'user', reviewState: 'accepted', createdAt: at(1), updatedAt: at(1) });

  // Regions: topic regions per project (with a nested subregion), leaving
  // a remainder uncategorized; every 6th record is in two regions.
  const regions: LandscapeRegion[] = [];
  projects.forEach((project, p) => {
    const own = objects.filter((o) => o.projectId === project.id && o.reviewState !== 'rejected');
    const topics = TOPICS.slice(0, 3 + (p % 3));
    topics.forEach((topic, t) => {
      regions.push({
        id: `syn-r${p}-${t}`,
        projectId: project.id,
        parentRegionId: t === topics.length - 1 && t > 0 ? `syn-r${p}-0` : null,
        title: `${topic}`,
        summary: t === 0 ? `Synthetic region for ${topic.toLowerCase()} records.` : undefined,
        order: t,
        memberObjectIds: own.filter((_, k) => k % (topics.length + 1) === t || (k % 6 === 0 && t === 1)).map((o) => o.id),
        pinnedObjectIds: [],
        createdAt: at(t),
        updatedAt: at(t),
      });
    });
  });
  const sync = regions.find((r) => r.id === 'syn-r0-0')!;
  for (const id of [TARGETS.decision, TARGETS.cited]) if (!sync.memberObjectIds.includes(id)) sync.memberObjectIds.push(id);
  sync.pinnedObjectIds = [TARGETS.decision];

  return { projects, objects, events, associations, conversationNames, regions };
}

export function syntheticLoaded(size: number): LoadedLandscape {
  const started = performance.now();
  const landscape = assembleLandscape(syntheticInput(size));
  return { landscape, resume: new Map(), projectionMs: performance.now() - started };
}
