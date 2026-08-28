import { db } from '../db/schema';
import { getPreparedChange, putPreparedChange } from '../db/preparedChanges';
import { generateId } from '../utils/ids';
import type {
  Criterion,
  PreparedChange,
  PreparedChangeEvidenceRef,
  PreparedChangeRepositoryRef,
  WorkspaceIntent,
  WorkspaceOriginRef,
} from '../../types/preparedChange';
import type { ReviewState, UnderstandingObject } from '../../types/understanding';

const ACCEPTED_REVIEW_STATES: ReadonlySet<ReviewState> = new Set(['accepted', 'edited']);

export interface CreatePreparedChangeInput {
  projectId: string;
  title: string;
  /**
   * May be empty (SPEC-change-workspace D7): a workspace can start from a
   * bug, question, or manual intent with no accepted understanding yet.
   */
  understandingPointIds: string[];
  intent?: WorkspaceIntent;
  originRef?: WorkspaceOriginRef;
}

export type PreparedChangeDraftPatch = Partial<
  Pick<
    PreparedChange,
    | 'title'
    | 'desiredOutcome'
    | 'rationale'
    | 'nonGoals'
    | 'constraints'
    | 'acceptanceCriteria'
    | 'openImplementationChoices'
    | 'understandingPointIds'
    | 'repositoryRef'
    | 'intent'
    | 'criteria'
    | 'originRef'
  >
>;

function cleanLines(lines: string[]): string[] {
  return [...new Set(lines.map((line) => line.trim()).filter(Boolean))];
}

function cleanRepositoryRef(
  repositoryRef: PreparedChangeRepositoryRef | undefined
): PreparedChangeRepositoryRef | undefined {
  if (!repositoryRef) return undefined;
  const cleaned: PreparedChangeRepositoryRef = {
    remoteUrl: repositoryRef.remoteUrl?.trim() || undefined,
    baseCommit: repositoryRef.baseCommit?.trim() || undefined,
    implicatedPaths: cleanLines(repositoryRef.implicatedPaths ?? []),
  };
  return cleaned.remoteUrl || cleaned.baseCommit || cleaned.implicatedPaths?.length
    ? cleaned
    : undefined;
}

function cleanIntent(intent: WorkspaceIntent | undefined): WorkspaceIntent | undefined {
  if (!intent) return undefined;
  const cleaned: WorkspaceIntent = {
    currentBehavior: intent.currentBehavior.trim(),
    desiredBehavior: intent.desiredBehavior.trim(),
    whyItMatters: intent.whyItMatters.trim(),
  };
  return cleaned.currentBehavior || cleaned.desiredBehavior || cleaned.whyItMatters
    ? cleaned
    : undefined;
}

function cleanCriteria(criteria: Criterion[]): Criterion[] {
  const seenText = new Set<string>();
  const out: Criterion[] = [];
  for (const criterion of criteria) {
    const text = criterion.text.trim();
    if (!text || seenText.has(text)) continue;
    seenText.add(text);
    out.push({
      id: criterion.id || generateId(),
      text,
      createdAt: criterion.createdAt || new Date().toISOString(),
    });
  }
  return out;
}

/** Structured criteria are the source of truth; the export reads the mirrored strings. */
function mirrorCriteria(criteria: Criterion[]): string[] {
  return criteria.map((c) => c.text);
}

async function requireAcceptedUnderstanding(
  projectId: string,
  ids: string[]
): Promise<UnderstandingObject[]> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];
  const rows = await db.understandingObjects.bulkGet(uniqueIds);
  return rows.map((row, index) => {
    if (!row) throw new Error(`Understanding point not found: ${uniqueIds[index]}`);
    if (row.projectId !== projectId) {
      throw new Error('Understanding points must belong to the Prepared Change project');
    }
    if (row.status !== 'current' || !ACCEPTED_REVIEW_STATES.has(row.reviewState)) {
      throw new Error('Prepared Changes can only use accepted, current understanding');
    }
    return row;
  });
}

export async function createPreparedChange(
  input: CreatePreparedChangeInput
): Promise<PreparedChange> {
  const title = input.title.trim();
  if (!title) throw new Error('Prepared Change title cannot be empty');
  const project = await db.understandingProjects.get(input.projectId);
  if (!project || project.reviewState === 'rejected') {
    throw new Error(`Project not found: ${input.projectId}`);
  }
  await requireAcceptedUnderstanding(input.projectId, input.understandingPointIds);
  const selectedPointIds = new Set(input.understandingPointIds);
  const promotedFindings = await db.investigationFindings
    .where('projectId')
    .equals(input.projectId)
    .filter(
      (finding) =>
        finding.state === 'finalized' &&
        Boolean(
          finding.promotedUnderstandingObjectId &&
            selectedPointIds.has(finding.promotedUnderstandingObjectId)
        )
    )
    .toArray();

  const now = new Date();
  const change: PreparedChange = {
    id: generateId(),
    projectId: input.projectId,
    title,
    state: 'draft',
    desiredOutcome: '',
    rationale: '',
    nonGoals: [],
    constraints: [],
    acceptanceCriteria: [],
    openImplementationChoices: [],
    understandingPointIds: [...new Set(input.understandingPointIds)],
    investigationFindingIds: promotedFindings.map((finding) => finding.id),
    evidenceRefs: [],
    createdAt: now,
    updatedAt: now,
  };
  const intent = cleanIntent(input.intent);
  if (intent) {
    change.intent = intent;
    change.desiredOutcome = intent.desiredBehavior;
    change.rationale = intent.whyItMatters;
  }
  if (input.originRef) change.originRef = input.originRef;
  await putPreparedChange(change);
  return change;
}

export async function updatePreparedChangeDraft(
  id: string,
  patch: PreparedChangeDraftPatch
): Promise<PreparedChange> {
  const current = await getPreparedChange(id);
  if (!current) throw new Error(`Prepared Change not found: ${id}`);
  if (current.state !== 'draft') {
    throw new Error('Only draft Prepared Changes can be edited');
  }
  if (patch.title !== undefined && !patch.title.trim()) {
    throw new Error('Prepared Change title cannot be empty');
  }
  const understandingPointIds =
    patch.understandingPointIds === undefined
      ? current.understandingPointIds
      : [...new Set(patch.understandingPointIds)];
  await requireAcceptedUnderstanding(current.projectId, understandingPointIds);

  // Intent mirrors into the handoff fields unless those are patched explicitly.
  const intent = patch.intent !== undefined ? cleanIntent(patch.intent) : current.intent;
  const desiredOutcome =
    patch.desiredOutcome?.trim() ??
    (patch.intent !== undefined && intent ? intent.desiredBehavior : current.desiredOutcome);
  const rationale =
    patch.rationale?.trim() ??
    (patch.intent !== undefined && intent ? intent.whyItMatters : current.rationale);
  const criteria = patch.criteria ? cleanCriteria(patch.criteria) : current.criteria;
  const acceptanceCriteria = patch.criteria
    ? mirrorCriteria(criteria ?? [])
    : patch.acceptanceCriteria
      ? cleanLines(patch.acceptanceCriteria)
      : current.acceptanceCriteria;

  const updated: PreparedChange = {
    ...current,
    ...patch,
    title: patch.title?.trim() ?? current.title,
    desiredOutcome,
    rationale,
    ...(intent ? { intent } : {}),
    ...(criteria ? { criteria } : {}),
    nonGoals: patch.nonGoals ? cleanLines(patch.nonGoals) : current.nonGoals,
    constraints: patch.constraints ? cleanLines(patch.constraints) : current.constraints,
    acceptanceCriteria,
    openImplementationChoices: patch.openImplementationChoices
      ? cleanLines(patch.openImplementationChoices)
      : current.openImplementationChoices,
    understandingPointIds,
    repositoryRef:
      patch.repositoryRef !== undefined
        ? cleanRepositoryRef(patch.repositoryRef)
        : current.repositoryRef,
    updatedAt: new Date(),
  };
  if (!intent) delete updated.intent;
  if (!criteria) delete updated.criteria;
  await putPreparedChange(updated);
  return updated;
}

export async function validatePreparedChange(
  change: PreparedChange
): Promise<string[]> {
  const missing: string[] = [];
  if (!change.desiredOutcome.trim()) missing.push('Desired outcome');
  // D7: a workspace is grounded by accepted understanding OR a stated intent.
  const hasIntent = Boolean(change.intent?.desiredBehavior.trim());
  if (change.understandingPointIds.length === 0 && !hasIntent) {
    missing.push('Accepted understanding or a stated desired behavior');
  }
  if (change.acceptanceCriteria.length === 0) missing.push('At least one acceptance criterion');

  if (change.understandingPointIds.length > 0) {
    try {
      await requireAcceptedUnderstanding(change.projectId, change.understandingPointIds);
    } catch {
      missing.push('Accepted understanding that still resolves');
    }
  }

  const conversationIds = [...new Set(change.evidenceRefs.map((ref) => ref.conversationId))];
  if (conversationIds.length > 0) {
    const conversations = await db.conversations.bulkGet(conversationIds);
    if (conversations.some((conversation) => !conversation)) {
      missing.push('Evidence whose source conversations still resolve');
    }
  }
  return missing;
}

async function collectEvidenceRefs(
  understandingPointIds: string[]
): Promise<PreparedChangeEvidenceRef[]> {
  const events =
    understandingPointIds.length === 0
      ? []
      : await db.understandingEvents.where('objectId').anyOf(understandingPointIds).toArray();
  const refs: PreparedChangeEvidenceRef[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (!ACCEPTED_REVIEW_STATES.has(event.reviewState)) continue;
    for (const evidence of event.evidence) {
      const key = JSON.stringify([
        event.objectId,
        evidence.conversationId,
        evidence.messageIds ?? [],
        evidence.note ?? '',
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ ...evidence, understandingPointId: event.objectId });
    }
  }
  return refs;
}

export async function markPreparedChangeReady(id: string): Promise<PreparedChange> {
  const current = await getPreparedChange(id);
  if (!current) throw new Error(`Prepared Change not found: ${id}`);
  if (current.state !== 'draft') throw new Error('Prepared Change is already finalized');
  const evidenceRefs = await collectEvidenceRefs(current.understandingPointIds);
  const candidate: PreparedChange = { ...current, evidenceRefs };
  const missing = await validatePreparedChange(candidate);
  if (missing.length > 0) {
    throw new Error(`Prepared Change is not ready: ${missing.join('; ')}`);
  }
  const now = new Date();
  const ready: PreparedChange = {
    ...candidate,
    state: 'ready',
    readyAt: now,
    updatedAt: now,
  };
  await putPreparedChange(ready);
  return ready;
}
