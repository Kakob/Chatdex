/**
 * Single staging/review pipeline for a human editor and externally returned
 * agent code. The existing repository cache is READ-ONLY here. No code is
 * executed, evaluated, committed or described as verified when staged.
 */
import { db as projectDb } from '../db/schema';
import { MAX_FILE_BYTES } from '../github/client';
import { sha256Hex } from '../utils/hash';
import { generateId } from '../utils/ids';
import { engineeringModelDb } from './modelStore';
import { bundledEngineeringSources } from './bundledSources';
import { resolveSourceBinding, validateSourceBinding, type EngineeringSourceBinding } from './sourceCatalog';
import type { CodingActor, SourceEditProposal, SourceWriteReceipt } from './codingProtocol';

export interface StageCodeInput {
  projectId: string;
  targetId: string;
  bindingId: string;
  baselineText: string;
  proposedText: string;
  intent: string;
  actor: CodingActor;
  providerId: string;
}

/** Stage a complete file. Exact baseline match prevents accidental stale edits. */
export async function stageCodeRevision(input: StageCodeInput): Promise<SourceEditProposal> {
  const project = await projectDb.understandingProjects.get(input.projectId);
  if (!project || project.reviewState === 'rejected') throw new Error('Project not found or rejected');
  const binding: EngineeringSourceBinding | undefined = await engineeringModelDb.sourceBindings.get(input.bindingId);
  if (!binding || binding.projectId !== input.projectId || binding.targetId !== input.targetId) {
    throw new Error('The source binding is missing or belongs to another model entity');
  }
  validateSourceBinding(binding);
  const source = await resolveSourceBinding(binding, bundledEngineeringSources);
  if (!('text' in source) || source.text === undefined) throw new Error('Bound source is unavailable; index it before editing');
  if (source.text !== input.baselineText) {
    throw new Error('The source differs from this editing baseline. Reload it before staging a change.');
  }
  if (source.status === 'anchor-missing') throw new Error('Source anchor missing. Repair the binding before proposing an edit.');
  if (input.proposedText === input.baselineText) throw new Error('No source change to stage');
  if (!input.proposedText.trim()) throw new Error('A staged file cannot be empty');
  if (new TextEncoder().encode(input.proposedText).length > MAX_FILE_BYTES) {
    throw new Error('Proposed file exceeds the source size limit');
  }
  if (input.actor !== 'human' && input.actor !== 'agent') throw new Error('Unknown coding actor');
  if (!input.providerId.trim() || input.providerId.length > 120) throw new Error('Provider identifier required');
  if (!input.intent.trim() || input.intent.length > 2000) throw new Error('Describe the engineering goal');
  const [baselineHash, proposedHash] = await Promise.all([
    sha256Hex(input.baselineText), sha256Hex(input.proposedText),
  ]);
  const edit: SourceEditProposal = {
    id: generateId(), projectId: input.projectId, targetId: input.targetId, bindingId: binding.id,
    repoKey: binding.repoKey, path: binding.path, sourceSha: binding.sha, sourceKind: binding.sourceKind,
    baselineHash, proposedHash, baselineText: input.baselineText, proposedText: input.proposedText,
    intent: input.intent.trim(), actor: input.actor, providerId: input.providerId.trim(), createdAt: new Date(),
  };
  await engineeringModelDb.codeRevisions.add(edit);
  return edit;
}

export async function recordSuccessfulWrite(revisionId: string, writerId: string): Promise<SourceWriteReceipt> {
  const edit = await engineeringModelDb.codeRevisions.get(revisionId);
  if (!edit) throw new Error('Unknown source revision');
  if (writerId !== 'local-folder-confirmed') throw new Error('Unsupported writer receipt');
  const receipt: SourceWriteReceipt = {
    id: generateId(), projectId: edit.projectId, revisionId, writerId,
    path: edit.path, baselineHash: edit.baselineHash, writtenHash: edit.proposedHash, at: new Date(),
  };
  await engineeringModelDb.codeWrites.add(receipt);
  return receipt;
}

/** Distinguish queued intent, an external write, and source-byte reconciliation. */
export function sourceRevisionLabel(
  edit: SourceEditProposal,
  writes: readonly SourceWriteReceipt[],
  observedText?: string,
): 'staged' | 'written-unverified' | 'observed-source-match' | 'source-diverged' {
  if (observedText !== undefined) {
    if (observedText === edit.proposedText) return 'observed-source-match';
    if (observedText !== edit.baselineText) return 'source-diverged';
  }
  return writes.some((write) => write.revisionId === edit.id) ? 'written-unverified' : 'staged';
}
