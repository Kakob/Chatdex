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
import { fixtureTransitions, type EngineeringTransition, type EngineeringRelationKind } from './modelCatalog';
import { fixtureSourceBindings, validateSourceBinding, type EngineeringSourceBinding } from './sourceCatalog';
import type { LandscapeRegion } from '../../types/landscape';
import type { SourceEditProposal, SourceWriteReceipt } from './codingProtocol';

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
  sourceBindings!: Table<EngineeringSourceBinding, string>;
  /** Explicit, local-only full-file change proposals, including agent results. */
  codeRevisions!: Table<SourceEditProposal, string>;
  codeWrites!: Table<SourceWriteReceipt, string>;

  constructor(name = ENGINEERING_MODEL_DB_NAME) {
    super(name);
    this.version(1).stores({
      transitions: '&id, projectId, fromConceptId, toConceptId',
      proposals: '&id, projectId, targetId, [projectId+targetId], at',
    });
    // Additive: pre-existing proposals/transitions survive the upgrade.
    // Source text still belongs exclusively to the existing repoFiles cache.
    this.version(2).stores({
      sourceBindings: '&id, projectId, targetId, [projectId+targetId], repoKey',
    });
    this.version(3).stores({
      codeRevisions: '&id, projectId, targetId, [projectId+targetId], createdAt',
      codeWrites: '&id, projectId, revisionId, [projectId+revisionId], at',
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
  /** Null means a normal project with no example-specific runtime adapter. */
  kind: EngineeringExampleKind | null;
  concepts: LandscapeRegion[];
  transitions: EngineeringTransition[];
  sourceBindings: EngineeringSourceBinding[];
  /** Staged human and agent changes; NOT part of the repository snapshot. */
  codeRevisions: SourceEditProposal[];
  codeWrites: SourceWriteReceipt[];
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
  await engineeringModelDb.transaction('rw', engineeringModelDb.transitions, engineeringModelDb.sourceBindings, async () => {
    for (const transition of fixtureTransitions(kind, projectId)) {
      if (await engineeringModelDb.transitions.get(transition.id)) continue;
      await engineeringModelDb.transitions.add(transition);
      created += 1;
    }
    for (const binding of fixtureSourceBindings(kind, projectId)) {
      validateSourceBinding(binding);
      if (!(await engineeringModelDb.sourceBindings.get(binding.id))) {
        await engineeringModelDb.sourceBindings.add(binding);
      }
    }
  });
  return created;
}

/** Read only: opening an example does not silently install or overwrite models. */
export async function loadEngineeringModel(projectId: string): Promise<ProjectEngineeringModel> {
  const kind = engineeringExampleKind(projectId);
  if (!(await projectDb.understandingProjects.get(projectId))) throw new Error('Project not found');
  const [concepts, transitions, proposals, sourceBindings, codeRevisions, codeWrites] = await Promise.all([
    projectDb.landscapeRegions.where('projectId').equals(projectId).toArray(),
    engineeringModelDb.transitions.where('projectId').equals(projectId).toArray(),
    engineeringModelDb.proposals.where('projectId').equals(projectId).toArray(),
    engineeringModelDb.sourceBindings.where('projectId').equals(projectId).toArray(),
    engineeringModelDb.codeRevisions.where('projectId').equals(projectId).toArray(),
    engineeringModelDb.codeWrites.where('projectId').equals(projectId).toArray(),
  ]);
  const elements: Record<string, ModelElement> = {};
  for (const concept of concepts) {
    elements[concept.id] = summarize(concept.id, 'concept', conceptWording(concept), proposals.filter((p) => p.targetId === concept.id));
  }
  for (const transition of transitions) {
    elements[transition.id] = summarize(transition.id, 'transition', transitionWording(transition), proposals.filter((p) => p.targetId === transition.id));
  }
  return { projectId, kind, concepts, transitions, sourceBindings, codeRevisions, codeWrites, elements };
}

export function relationForNode(model: ProjectEngineeringModel, nodeId: string): EngineeringTransition[] {
  const conceptId = model.elements[nodeId] ? nodeId : model.kind ? exampleConceptId(model.kind, nodeId) : nodeId;
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
  if (!(await projectDb.understandingProjects.get(projectId))) throw new Error('Project not found');
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


/** Generic relationship creation (no event-queue or todo-list assumptions). */
export async function createModelRelationship(input: {
  projectId: string;
  fromConceptId: string;
  toConceptId: string;
  kind: EngineeringRelationKind;
  title: string;
  description: string;
}): Promise<EngineeringTransition> {
  const project = await projectDb.understandingProjects.get(input.projectId);
  if (!project || project.reviewState === 'rejected') throw new Error('Project not found or rejected');
  const [from, to] = await Promise.all([
    projectDb.landscapeRegions.get(input.fromConceptId),
    projectDb.landscapeRegions.get(input.toConceptId),
  ]);
  if (!from || !to || from.projectId !== input.projectId || to.projectId !== input.projectId) {
    throw new Error('Both endpoints must belong to the same project');
  }
  if (!(['flow', 'state_transition', 'depends_on', 'verified_by'] as string[]).includes(input.kind)) {
    throw new Error('Unsupported relationship kind');
  }
  const wording = validatedWording(input);
  const relation: EngineeringTransition = {
    id: generateId(), projectId: input.projectId,
    fromConceptId: input.fromConceptId, toConceptId: input.toConceptId,
    kind: input.kind, title: wording.title, description: wording.description,
    origin: 'manual', createdAt: new Date(),
  };
  await engineeringModelDb.transitions.add(relation);
  return relation;
}

/** Generic source binding registration; never fetches or writes repository code. */
export async function createModelSourceBinding(input: Omit<EngineeringSourceBinding, 'id'>): Promise<EngineeringSourceBinding> {
  const project = await projectDb.understandingProjects.get(input.projectId);
  if (!project || project.reviewState === 'rejected') throw new Error('Project not found or rejected');
  const target = await requireTarget(input.projectId, input.targetId);
  if (!target) throw new Error('Model target missing');
  const binding: EngineeringSourceBinding = { ...input, id: generateId() };
  validateSourceBinding(binding);
  await engineeringModelDb.sourceBindings.add(binding);
  return binding;
}
