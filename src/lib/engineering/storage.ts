// LOCAL-ONLY persistence for the engineering prototype (PLAN.md Decision 1).
//
// A separate Dexie database, never hooked into the sync engine and never
// touching the main `chatdex` database, so the synthetic project cannot leak
// into a user's real (synced) projects. Same precedent as Research Atlas.

import Dexie, { type Table } from 'dexie';
import type {
  ContractChangeProposal,
  ContractValues,
  EngineeringBinding,
  EngineeringConcept,
  EngineeringEvidenceRun,
  EngineeringProjectRecord,
  EngineeringRelationship,
  EngineeringStatement,
  EngineeringStatementEvent,
} from '../../types/engineering';
import { sha256Hex } from '../utils/hash';
import { findSymbol } from './bindings';
import { buildEventQueueFixture, ENGINEERING_PROJECT_ID } from './fixture';
import { contractValuesOf, deriveImpact } from './impact';
import { checkImport, parseManifest, SHA_PATTERN } from './io/manifest';
import { verificationStatus } from './io/verification';
import { criterionText, deliveryContract, queueDeliveryRules } from './rules';

export const ENGINEERING_DB_NAME = 'chatdex-engineering-prototype';

class EngineeringPrototypeDB extends Dexie {
  projects!: Table<EngineeringProjectRecord, string>;
  concepts!: Table<EngineeringConcept, string>;
  statements!: Table<EngineeringStatement, string>;
  events!: Table<EngineeringStatementEvent, string>;
  relationships!: Table<EngineeringRelationship, string>;
  bindings!: Table<EngineeringBinding, string>;
  proposals!: Table<ContractChangeProposal, string>;
  evidenceRuns!: Table<EngineeringEvidenceRun, string>;

  constructor() {
    super(ENGINEERING_DB_NAME);
    this.version(1).stores({
      projects: '&id',
      concepts: '&id, projectId, parentRegionId',
      statements: '&id, projectId, type, status',
      events: '&id, objectId, createdAt',
      relationships: '&id, projectId, from, to',
      bindings: '&id, projectId, targetId',
      proposals: '&id, projectId, statementId, state',
      evidenceRuns: '&id, projectId, digest, importedAt',
    });
  }
}

export const engineeringDb = new EngineeringPrototypeDB();

const ALL_TABLES = () => [
  engineeringDb.projects,
  engineeringDb.concepts,
  engineeringDb.statements,
  engineeringDb.events,
  engineeringDb.relationships,
  engineeringDb.bindings,
  engineeringDb.proposals,
  engineeringDb.evidenceRuns,
];

export class EngineeringActionError extends Error {}

export interface EngineeringSnapshot {
  project: EngineeringProjectRecord;
  concepts: EngineeringConcept[];
  statements: EngineeringStatement[];
  events: EngineeringStatementEvent[];
  relationships: EngineeringRelationship[];
  bindings: EngineeringBinding[];
  proposals: ContractChangeProposal[];
  evidenceRuns: EngineeringEvidenceRun[];
}

/** Seeds the synthetic project once. Never overwrites existing rows. */
export async function ensureSeeded(): Promise<void> {
  await engineeringDb.transaction('rw', ALL_TABLES(), async () => {
    if (await engineeringDb.projects.get(ENGINEERING_PROJECT_ID)) return;
    const fixture = buildEventQueueFixture();
    await engineeringDb.projects.add(fixture.project);
    await engineeringDb.concepts.bulkAdd(fixture.concepts);
    await engineeringDb.statements.bulkAdd(fixture.statements);
    await engineeringDb.events.bulkAdd(fixture.events);
    await engineeringDb.relationships.bulkAdd(fixture.relationships);
    await engineeringDb.bindings.bulkAdd(fixture.bindings);
  });
}

/** Deletes everything in the prototype database and reseeds the fixture. */
export async function resetPrototype(): Promise<void> {
  await engineeringDb.transaction('rw', ALL_TABLES(), async () => {
    await Promise.all(ALL_TABLES().map((t) => t.clear()));
  });
  await ensureSeeded();
}

export async function loadSnapshot(projectId = ENGINEERING_PROJECT_ID): Promise<EngineeringSnapshot> {
  const project = await engineeringDb.projects.get(projectId);
  if (!project) throw new EngineeringActionError('Prototype project is not seeded');
  const [concepts, statements, relationships, bindings, proposals, evidenceRuns] = await Promise.all([
    engineeringDb.concepts.where('projectId').equals(projectId).sortBy('order'),
    engineeringDb.statements.where('projectId').equals(projectId).toArray(),
    engineeringDb.relationships.where('projectId').equals(projectId).sortBy('id'),
    engineeringDb.bindings.where('projectId').equals(projectId).sortBy('id'),
    engineeringDb.proposals.where('projectId').equals(projectId).sortBy('createdAt'),
    engineeringDb.evidenceRuns.where('projectId').equals(projectId).sortBy('importedAt'),
  ]);
  const events = await engineeringDb.events
    .where('objectId')
    .anyOf(statements.map((s) => s.id))
    .sortBy('createdAt');
  return { project, concepts, statements, events, relationships, bindings, proposals, evidenceRuns };
}

/** The contract statement currently in force for a contract key. */
export function currentContract(snapshot: Pick<EngineeringSnapshot, 'statements'>, contractKey = deliveryContract.key) {
  return snapshot.statements.find((s) => s.meta?.contract === contractKey && s.status === 'current');
}

// ---------------------------------------------------------------------------
// Proposals

/** Creates or updates the open draft for the current contract. Never touches the contract itself. */
export async function saveDraft(to: ContractValues, rationale: string, now = new Date()): Promise<ContractChangeProposal> {
  const snapshot = await loadSnapshot();
  const statement = currentContract(snapshot);
  if (!statement) throw new EngineeringActionError('No current delivery contract');
  const invalid = deliveryContract.validate(to);
  if (invalid) throw new EngineeringActionError(invalid);
  const from = contractValuesOf(statement);
  const existing = snapshot.proposals.find((p) => p.statementId === statement.id && p.state === 'draft');
  const proposal: ContractChangeProposal = existing
    ? { ...existing, to: { ...to }, rationale, updatedAt: now }
    : {
        id: crypto.randomUUID(),
        projectId: snapshot.project.id,
        statementId: statement.id,
        contractKey: deliveryContract.key,
        from,
        to: { ...to },
        rationale,
        state: 'draft',
        createdAt: now,
        updatedAt: now,
      };
  await engineeringDb.proposals.put(proposal);
  return proposal;
}

export async function withdrawProposal(id: string, now = new Date()): Promise<void> {
  const proposal = await engineeringDb.proposals.get(id);
  if (!proposal) throw new EngineeringActionError('Proposal not found');
  if (proposal.state === 'accepted') throw new EngineeringActionError('An accepted change cannot be withdrawn');
  await engineeringDb.proposals.put({ ...proposal, state: 'withdrawn', updatedAt: now });
}

/**
 * Human approval. Requires pinned evidence at the base revision so the handoff
 * carries a real "before". Freezes the derived impact.
 */
export async function approveProposal(id: string, baseSha: string, now = new Date()): Promise<ContractChangeProposal> {
  const snapshot = await loadSnapshot();
  const proposal = snapshot.proposals.find((p) => p.id === id);
  if (!proposal) throw new EngineeringActionError('Proposal not found');
  if (proposal.state !== 'draft') throw new EngineeringActionError(`Only a draft can be approved (this one is ${proposal.state})`);
  if (!SHA_PATTERN.test(baseSha)) throw new EngineeringActionError('Base revision must be a full 40-character sha');
  if (!snapshot.evidenceRuns.some((r) => r.pinned && r.manifest.revision.sha === baseSha)) {
    throw new EngineeringActionError('Import pinned evidence captured at the base revision before approving');
  }
  const statement = snapshot.statements.find((s) => s.id === proposal.statementId);
  if (!statement || statement.status !== 'current') {
    throw new EngineeringActionError('The contract changed since this draft was written; start a new draft');
  }
  const approvedImpact = deriveImpact(
    snapshot,
    { statementId: proposal.statementId, contractKey: proposal.contractKey, from: proposal.from, to: proposal.to },
    deliveryContract,
    queueDeliveryRules
  );
  if (approvedImpact.obligations.length === 0) {
    throw new EngineeringActionError('This change derives no obligations; nothing to hand off');
  }
  const approved: ContractChangeProposal = { ...proposal, state: 'approved', baseSha, approvedImpact, approvedAt: now, updatedAt: now };
  await engineeringDb.proposals.put(approved);
  return approved;
}

// ---------------------------------------------------------------------------
// Evidence

export type ImportResult = { ok: true; run: EngineeringEvidenceRun } | { ok: false; errors: string[] };

export async function importEvidence(
  text: string,
  fileName: string,
  options: { proposalId?: string } = {},
  now = new Date()
): Promise<ImportResult> {
  const parsed = parseManifest(text);
  if (!parsed.ok) return parsed;
  const snapshot = await loadSnapshot();
  const digest = await sha256Hex(text);
  const proposal = options.proposalId ? snapshot.proposals.find((p) => p.id === options.proposalId) : undefined;
  if (options.proposalId && !proposal) return { ok: false, errors: ['Proposal not found'] };
  const refusals = checkImport(parsed.manifest, { project: snapshot.project, existingRuns: snapshot.evidenceRuns, digest, proposal });
  if (refusals.length > 0) return { ok: false, errors: refusals };
  const run: EngineeringEvidenceRun = {
    id: crypto.randomUUID(),
    projectId: snapshot.project.id,
    digest,
    fileName,
    manifest: parsed.manifest,
    pinned: !parsed.manifest.revision.dirty,
    role: proposal ? 'implementation' : 'observation',
    ...(proposal ? { proposalId: proposal.id } : {}),
    importedAt: now,
  };
  await engineeringDb.evidenceRuns.add(run);
  return { ok: true, run };
}

/** Pins a binding to the symbol as observed in one pinned run. Explicit user action only. */
export async function confirmBinding(bindingId: string, runId: string, now = new Date()): Promise<EngineeringBinding> {
  const [binding, run] = await Promise.all([engineeringDb.bindings.get(bindingId), engineeringDb.evidenceRuns.get(runId)]);
  if (!binding || !run) throw new EngineeringActionError('Binding or evidence run not found');
  if (!run.pinned) throw new EngineeringActionError('Cannot confirm against unpinned (dirty) evidence');
  const observation = findSymbol(run, binding.path, binding.symbol);
  if (!observation) throw new EngineeringActionError(`${binding.symbol} is not present at ${run.manifest.revision.sha.slice(0, 12)}`);
  const updated: EngineeringBinding = {
    ...binding,
    confirmed: {
      sha: run.manifest.revision.sha,
      startLine: observation.startLine,
      endLine: observation.endLine,
      sha256: observation.sha256,
      confirmedAt: now,
    },
  };
  await engineeringDb.bindings.put(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Acceptance

export interface AcceptResult {
  statement: EngineeringStatement;
  openQuestionIds: string[];
  resolvedLimitationIds: string[];
}

/**
 * Explicitly accepts the new understanding after reviewing implementation
 * evidence. Creates a new contract version and supersedes the old (history is
 * append-only). Criteria without supporting pinned evidence become open
 * questions; nothing unverified is presented as verified.
 */
export async function acceptProposal(id: string, implementationRunId: string, now = new Date()): Promise<AcceptResult> {
  const snapshot = await loadSnapshot();
  const proposal = snapshot.proposals.find((p) => p.id === id);
  if (!proposal) throw new EngineeringActionError('Proposal not found');
  if (proposal.state !== 'approved' || !proposal.approvedImpact) {
    throw new EngineeringActionError(`Only an approved change can be accepted (this one is ${proposal.state})`);
  }
  const run = snapshot.evidenceRuns.find((r) => r.id === implementationRunId);
  if (!run || run.role !== 'implementation' || run.proposalId !== proposal.id) {
    throw new EngineeringActionError('Choose implementation evidence imported for this change');
  }
  if (!run.pinned) throw new EngineeringActionError('Unpinned (dirty) evidence cannot back accepted understanding');
  const old = snapshot.statements.find((s) => s.id === proposal.statementId);
  if (!old || old.status !== 'current') throw new EngineeringActionError('The contract changed since approval');
  const concept = snapshot.concepts.find((c) => c.memberObjectIds.includes(old.id));
  const verificationConcept = snapshot.concepts.find((c) => c.id === 'eq-verification');
  if (!concept || !verificationConcept) throw new EngineeringActionError('Model is missing the contract or verification concept');

  const sha = run.manifest.revision.sha;
  const short = sha.slice(0, 12);
  const unverified = proposal.approvedImpact.criterionIds.filter((c) => verificationStatus(run, c) !== 'supported');
  const contractVersion = Number(old.meta?.version ?? 1) + 1;

  const statement: EngineeringStatement = {
    id: `${old.id.replace(/-v\d+$/, '')}-v${contractVersion}`,
    projectId: old.projectId,
    type: 'guarantee',
    title: deliveryContract.describe(proposal.to),
    body: proposal.rationale.trim() || undefined,
    status: 'current',
    origin: 'user',
    reviewState: 'accepted',
    meta: {
      contract: proposal.contractKey,
      version: contractVersion,
      proposalId: proposal.id,
      implementedAt: sha,
      unverifiedCriteria: unverified.join(','),
      ...Object.fromEntries(Object.entries(proposal.to).map(([k, v]) => [`p.${k}`, v])),
    },
    createdAt: now,
    updatedAt: now,
  };

  const questions: EngineeringStatement[] = unverified.map((criterionId) => ({
    id: `${statement.id}-open-${criterionId}`,
    projectId: old.projectId,
    type: 'question',
    title: `Not verified at ${short}: ${criterionId} — ${criterionText(criterionId)}`,
    status: 'current',
    origin: 'user',
    reviewState: 'accepted',
    meta: { criterionId, sha, proposalId: proposal.id },
    createdAt: now,
    updatedAt: now,
  }));

  // Limitations that name the criterion that refutes them are resolved only
  // when that criterion is supported by this pinned run.
  const resolvable = snapshot.statements.filter(
    (s) =>
      s.type === 'limitation' &&
      s.status === 'current' &&
      typeof s.meta?.refutedBy === 'string' &&
      verificationStatus(run, s.meta.refutedBy) === 'supported'
  );

  const event = (objectId: string, op: EngineeringStatementEvent['op'], detail: string, extra: Partial<EngineeringStatementEvent> = {}) => ({
    id: crypto.randomUUID(),
    objectId,
    op,
    detail,
    evidence: [],
    origin: 'user' as const,
    reviewState: 'accepted' as const,
    occurredAt: now,
    createdAt: now,
    ...extra,
  });

  await engineeringDb.transaction('rw', [engineeringDb.statements, engineeringDb.events, engineeringDb.concepts, engineeringDb.proposals], async () => {
    await engineeringDb.statements.put({ ...old, status: 'superseded', updatedAt: now });
    await engineeringDb.statements.add(statement);
    await engineeringDb.statements.bulkAdd(questions);
    for (const s of resolvable) await engineeringDb.statements.put({ ...s, status: 'resolved', updatedAt: now });
    await engineeringDb.events.bulkAdd([
      event(old.id, 'superseded', `Replaced by accepted change ${proposal.id}`, { supersededByObjectId: statement.id }),
      event(statement.id, 'introduced', `Accepted after reviewing evidence at ${short}`),
      ...questions.map((q) => event(q.id, 'introduced', 'Left open on acceptance: no supporting pinned evidence')),
      ...resolvable.map((s) => event(s.id, 'resolved', `${s.meta?.refutedBy} supported at ${short}`)),
    ]);
    await engineeringDb.concepts.put({ ...concept, memberObjectIds: [...concept.memberObjectIds, statement.id], updatedAt: now });
    const verification = await engineeringDb.concepts.get(verificationConcept.id);
    await engineeringDb.concepts.put({
      ...verification!,
      memberObjectIds: [...verification!.memberObjectIds, ...questions.map((q) => q.id)],
      updatedAt: now,
    });
    await engineeringDb.proposals.put({ ...proposal, state: 'accepted', acceptedStatementId: statement.id, acceptedAt: now, updatedAt: now });
  });

  return { statement, openQuestionIds: questions.map((q) => q.id), resolvedLimitationIds: resolvable.map((s) => s.id) };
}
