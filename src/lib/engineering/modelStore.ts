/**
 * Local-only, append-only engineering-model proposals.
 *
 * Existing Chatdex LandscapeRegion rows are canonical project concepts.
 * Relationship rows in this DB are explicitly authored example edges.
 * Proposal events are NOT code, accepted understanding, or runtime facts.
 * No sync hook is wired to this Dexie database.
 */
import Dexie, { type Table } from 'dexie';
import { db as projectDb } from '../db/schema';
import { generateId } from '../utils/ids';
import { engineeringExampleKind, exampleConceptId, type EngineeringExampleKind } from './demoProjects';
import { fixtureTransitions, type EngineeringTransition } from './modelCatalog';
import type { LandscapeRegion } from '../../types/landscape';

export const ENGINEERING_MODEL_DB_NAME = 'chatdex-engineering-model-v1';

export type ModelTargetKind = 'concept' | 'transition';
export type ModelProposalAction = 'propose' | 'withdraw';

export interface ModelWording {
  title: string;
  description: string;
}

export interface ModelProposalEvent {
  id: string;
  projectId: string;
  targetId: string;
  targetKind: ModelTargetKind;
  action: ModelProposalAction;
  sequence: number;
  /** Original project/model content at the first proposal, not last preview. */
  baseline: ModelWording;
  proposed: ModelWording;
  at: Date;
}

class EngineeringModelDB extends Dexie {
  transitions!: Table<EngineeringTransition, string>;
  proposals!: Table<ModelProposalEvent, string>;

  constructor(name = ENGINEERING_MODEL_DB_NAME) {
    super(name);
    this.version(1).stores({
      transitions: '&id, projectId, fromConceptId, toConceptId',
      proposals: '&id, projectId, targetId, [projectId+targetId], at',
    });
  }
}

export const engineeringModelDb = new EngineeringModelDB();

export interface ModelElement {
  id: string;
  kind: ModelTargetKind;
  current: ModelWording;
  proposed?: ModelWording;
  stale: boolean;
  revisions: ModelProposalEvent[];
}

export interface ProjectEngineeringModel {
  projectId: string;
  kind: EngineeringExampleKind;
  concepts: LandscapeRegion[];
  transitions: EngineeringTransition[];
  elements: Record<string, ModelElement>;
}

function conceptWording(concept: LandscapeRegion): ModelWording {
  return { title: concept.title, description: concept.summary ?? '' };
}

function transitionWording(transition: EngineeringTransition): ModelWording {
  return { title: transition.title, description: transition.description };
}

function same(a: ModelWording, b: ModelWording): boolean {
  return a.title === b.title && a.description === b.description;
}

function summarize(
  id: string, kind: ModelTargetKind, current: ModelWording, events: ModelProposalEvent[],
): ModelElement {
  const revisions = [...events].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
  const latest = revisions.at(-1);
  const active = latest?.action === 'propose' ? latest : null;
  return {
    id,
    kind,
    current,
    ...(active ? { proposed: active.proposed } : {}),
    stale: Boolean(active && !same(active.baseline, current)),
    revisions,
  };
}

/** Installation is explicit via the examples action; this repairs missing edges without editing existing ones. */
export async function installExampleTransitions(projectId: string): Promise<number> {
  const kind = engineeringExampleKind(projectId);
  if (!kind) throw new Error('No engineering example adapter for this project');
  if (!(await projectDb.understandingProjects.get(projectId))) {
    throw new Error('Project not installed');
  }
  let created = 0;
  await engineeringModelDb.transaction('rw', engineeringModelDb.transitions, async () => {
    for (const transition of fixtureTransitions(kind, projectId)) {
      if (await engineeringModelDb.transitions.get(transition.id)) continue;
      await engineeringModelDb.transitions.add(transition);
      created += 1;
    }
  });
  return created;
}

/** Read only: opening an example does not silently install or overwrite models. */
export async function loadEngineeringModel(projectId: string): Promise<ProjectEngineeringModel> {
  const kind = engineeringExampleKind(projectId);
  if (!kind) throw new Error('No engineering example adapter for this project');
  const [concepts, transitions, proposals] = await Promise.all([
    projectDb.landscapeRegions.where('projectId').equals(projectId).toArray(),
    engineeringModelDb.transitions.where('projectId').equals(projectId).toArray(),
    engineeringModelDb.proposals.where('projectId').equals(projectId).toArray(),
  ]);
  const elements: Record<string, ModelElement> = {};
  for (const concept of concepts) {
    elements[concept.id] = summarize(concept.id, 'concept', conceptWording(concept), proposals.filter((p) => p.targetId === concept.id));
  }
  for (const transition of transitions) {
    elements[transition.id] = summarize(transition.id, 'transition', transitionWording(transition), proposals.filter((p) => p.targetId === transition.id));
  }
  return { projectId, kind, concepts, transitions, elements };
}

export function relationForNode(model: ProjectEngineeringModel, nodeId: string): EngineeringTransition[] {
  const conceptId = exampleConceptId(model.kind, nodeId);
  return model.transitions.filter((edge) => edge.fromConceptId === conceptId || edge.toConceptId === conceptId);
}

function validatedWording(next: ModelWording): ModelWording {
  const title = next.title.trim();
  const description = next.description.trim();
  if (!title) throw new Error('Title is required');
  if (title.length > 100) throw new Error('Title is too long (maximum 100 characters)');
  if (description.length > 1200) throw new Error('Description is too long (maximum 1200 characters)');
  return { title, description };
}

async function requireTarget(projectId: string, targetId: string): Promise<{ kind: ModelTargetKind; wording: ModelWording }> {
  const concept = await projectDb.landscapeRegions.get(targetId);
  if (concept && concept.projectId === projectId) return { kind: 'concept', wording: conceptWording(concept) };
  const transition = await engineeringModelDb.transitions.get(targetId);
  if (transition && transition.projectId === projectId) return { kind: 'transition', wording: transitionWording(transition) };
  throw new Error('Model target does not exist in this project');
}

/**
 * Never mutate canonical objects. Each save/withdraw is another event.
 * Preserve the original baseline when updating a still-active draft.
 * A stale draft must be withdrawn and reauthored against current project data.
 */
export async function proposeModelEdit(projectId: string, targetId: string, next: ModelWording): Promise<ModelProposalEvent> {
  const kind = engineeringExampleKind(projectId);
  if (!kind) throw new Error('Only installed examples support proposals in iteration 3');
  const proposed = validatedWording(next);
  const target = await requireTarget(projectId, targetId);
  const history = await engineeringModelDb.proposals.where('[projectId+targetId]').equals([projectId, targetId]).toArray();
  const current = summarize(targetId, target.kind, target.wording, history);
  if (current.stale) throw new Error('The project changed since this proposal began. Withdraw it and create a new proposal.');
  if (same(current.proposed ?? target.wording, proposed)) throw new Error('No model change to propose');
  const active = current.revisions.at(-1);
  const baseline = active?.action === 'propose' ? active.baseline : target.wording;
  const event: ModelProposalEvent = {
    id: generateId(), projectId, targetId, targetKind: target.kind,
    action: 'propose', sequence: history.length + 1, baseline, proposed, at: new Date(),
  };
  await engineeringModelDb.proposals.add(event);
  return event;
}

export async function withdrawModelEdit(projectId: string, targetId: string): Promise<ModelProposalEvent> {
  const target = await requireTarget(projectId, targetId);
  const history = await engineeringModelDb.proposals.where('[projectId+targetId]').equals([projectId, targetId]).toArray();
  const current = summarize(targetId, target.kind, target.wording, history);
  if (!current.proposed) throw new Error('No active proposal to withdraw');
  const active = current.revisions.at(-1)!;
  const event: ModelProposalEvent = {
    id: generateId(), projectId, targetId, targetKind: target.kind, action: 'withdraw',
    sequence: history.length + 1, baseline: active.baseline, proposed: active.proposed, at: new Date(),
  };
  await engineeringModelDb.proposals.add(event);
  return event;
}
