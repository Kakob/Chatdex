// Temporal reconciliation engine (PRD §8/§10, stage U3.2).
//
// Unlike discovery — which summarizes conversations independently — a
// reconcile run presents the model with the project's CURRENT understanding
// and a chronological batch of newer conversations, and asks for changes
// AGAINST that state: introduce / support / refine / supersede / contradict /
// resolve / reopen. Batches run sequentially and reload state between calls,
// so an object introduced by batch 1 is visible to batch 2.
//
// Everything lands behind the U3.1 review gate: introduced objects are
// pending, all other ops become pending events that change nothing until
// accepted. Hallucination guards mirror discovery's and extend to object
// ids: only presented object ids are valid op targets, only batch
// conversation ids / digest message indexes are valid evidence.

import { complete } from '../providers';
import type { LLMProviderId, ChatMessage } from '../providers';
import { db } from '../db/schema';
import { getMessagesForConversation } from '../db/messages';
import {
  getUnderstandingProject,
  putUnderstandingProject,
  getAssociationsForProject,
  getObjectsForProject,
  createUnderstandingObject,
  recordUnderstandingEvent,
} from '../db/understanding';
import { buildDigest } from './discovery';
import type { ConversationDigest } from './discovery';
import type { StoredConversation, StoredMessage } from '../../types';
import type {
  UnderstandingObject,
  UnderstandingOp,
  EvidenceRef,
} from '../../types/understanding';

export interface ReconcileConfig {
  provider: LLMProviderId;
  model?: string;
  /** Conversations per LLM call. Reconciliation digests are dense, so smaller than discovery's 25. */
  batchSize?: number;
  /** Cap on proposed changes per batch (PRD §6 spirit: deliberately small). */
  maxChanges?: number;
  /** Digest knobs, passed through to buildDigest. */
  excerptLength?: number;
  maxDigestMessages?: number;
  messageExcerptLength?: number;
}

export interface ReconcileResult {
  conversationsProcessed: number;
  batches: number;
  objectsIntroduced: number;
  eventsProposed: number;
  warnings: string[];
}

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_CHANGES = 10;

/** Wire-format ops (imperative) → stored event ops (past tense). */
const EVENT_OP = {
  support: 'supported',
  refine: 'refined',
  supersede: 'superseded',
  contradict: 'contradicted',
  resolve: 'resolved',
  reopen: 'reopened',
} as const satisfies Record<string, Exclude<UnderstandingOp, 'introduced'>>;

// --- prompt construction (exported for tests) ---

export function buildReconcileMessages(
  project: { name: string; description?: string },
  objects: UnderstandingObject[],
  digests: ConversationDigest[],
  maxChanges = DEFAULT_MAX_CHANGES
): ChatMessage[] {
  const presented = objects.map((o) => ({
    id: o.id,
    type: o.type,
    title: o.title,
    ...(o.body ? { body: o.body } : {}),
    status: o.status,
  }));

  const system = [
    `You maintain the evolving understanding of the project "${project.name}"${
      project.description ? ` (${project.description})` : ''
    } reconstructed from the user's AI conversation history.`,
    'You are given the CURRENT understanding objects and NEWER conversations (chronological). Propose changes to the understanding based on what the conversations show.',
    'Respond with a single JSON object, no prose, matching exactly:',
    '{',
    '  "changes": [',
    '    { "op": "introduce", "ref": string, "type": string, "title": string, "body": string, "evidence": [{ "conversationId": string, "messageIndexes": number[] }] },',
    '    { "op": "support" | "refine" | "supersede" | "contradict" | "resolve" | "reopen", "objectId": string, "detail": string, "supersededBy": string, "evidence": [{ "conversationId": string, "messageIndexes": number[] }] }',
    '  ]',
    '}',
    'Rules:',
    '- Compare against the existing objects first. Prefer support/refine/supersede on an existing object over introducing a near-duplicate.',
    '- introduce: only for genuinely new understanding. ref is a response-local id ("n1", "n2", ...) so later changes can reference it. type is a short lowercase noun (direction, decision, idea, question, goal, ...).',
    '- supersede: use when newer conversations replace an object\'s content with a different direction/decision. Set supersededBy to the replacing object\'s id or the ref of an object you introduce in this response, when there is one.',
    '- resolve: an open question that the conversations answer. reopen: a resolved/superseded item that is active again. contradict: evidence conflicts with the object but does not clearly replace it (uncertainty is allowed — do not force a winner).',
    '- detail: one sentence describing the change itself.',
    `- At most ${maxChanges} changes; only the highest-signal ones.`,
    '- Every change must cite evidence. messageIndexes lists the "i" values of the specific supporting messages (empty array if the whole conversation applies).',
    '- Only reference objectId values, conversationId values, and message "i" values given in this input.',
    'Current understanding objects:',
    JSON.stringify(presented),
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ conversations: digests }) },
  ];
}

// --- response parsing (exported for tests) ---

interface ParsedEvidence {
  conversationId: string;
  messageIndexes: number[];
}

export interface ParsedIntroduce {
  op: 'introduce';
  ref: string | null;
  type: string;
  title: string;
  body?: string;
  evidence: ParsedEvidence[];
}

export interface ParsedEventChange {
  op: keyof typeof EVENT_OP;
  objectId: string;
  detail?: string;
  /** A ref from this response or an existing object id; resolved at persist time. */
  supersededBy?: string;
  evidence: ParsedEvidence[];
}

export type ParsedChange = ParsedIntroduce | ParsedEventChange;

export interface ParsedReconcile {
  changes: ParsedChange[];
  warnings: string[];
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function parseEvidence(
  raw: unknown,
  label: string,
  knownConversationIds: Set<string>,
  knownMessageIndexes: Map<string, Set<number>>,
  warnings: string[]
): ParsedEvidence[] {
  const cited: ParsedEvidence[] = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    const entry = e as Record<string, unknown>;
    const conversationId = asString(entry.conversationId);
    if (!conversationId || !knownConversationIds.has(conversationId)) continue;
    const valid = knownMessageIndexes.get(conversationId);
    const rawIndexes = Array.isArray(entry.messageIndexes) ? entry.messageIndexes : [];
    const messageIndexes = rawIndexes.filter(
      (i): i is number => Number.isInteger(i) && (valid?.has(i as number) ?? false)
    );
    if (messageIndexes.length < rawIndexes.length) {
      warnings.push(`Dropped invented message indexes on ${label}`);
    }
    cited.push({ conversationId, messageIndexes });
  }
  return cited;
}

export function parseReconcileResponse(
  text: string,
  knownConversationIds: Set<string>,
  knownMessageIndexes: Map<string, Set<number>>,
  knownObjectIds: Set<string>,
  maxChanges = DEFAULT_MAX_CHANGES
): ParsedReconcile {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    throw new Error('Reconcile response was not valid JSON');
  }
  const warnings: string[] = [];
  const changes: ParsedChange[] = [];
  const rawChanges = Array.isArray((raw as Record<string, unknown>).changes)
    ? ((raw as Record<string, unknown>).changes as unknown[])
    : [];

  if (rawChanges.length > maxChanges) {
    warnings.push(
      `Response proposed ${rawChanges.length} changes; keeping the first ${maxChanges}`
    );
  }

  for (const c of rawChanges.slice(0, maxChanges)) {
    const rec = c as Record<string, unknown>;
    const op = asString(rec.op);

    if (op === 'introduce') {
      const type = asString(rec.type);
      const title = asString(rec.title);
      if (!type || !title) {
        warnings.push('Dropped introduce missing type or title');
        continue;
      }
      const evidence = parseEvidence(
        rec.evidence,
        `introduce "${title}"`,
        knownConversationIds,
        knownMessageIndexes,
        warnings
      );
      if (evidence.length === 0) {
        warnings.push(`Dropped introduce "${title}" with no valid evidence`);
        continue;
      }
      changes.push({
        op: 'introduce',
        ref: asString(rec.ref),
        type: type.toLowerCase(),
        title,
        body: asString(rec.body) ?? undefined,
        evidence,
      });
      continue;
    }

    if (op && op in EVENT_OP) {
      const objectId = asString(rec.objectId);
      if (!objectId || !knownObjectIds.has(objectId)) {
        warnings.push(`Dropped ${op} targeting unknown object ${objectId ?? '(missing)'}`);
        continue;
      }
      const evidence = parseEvidence(
        rec.evidence,
        `${op} on ${objectId}`,
        knownConversationIds,
        knownMessageIndexes,
        warnings
      );
      if (evidence.length === 0) {
        warnings.push(`Dropped ${op} on ${objectId} with no valid evidence`);
        continue;
      }
      changes.push({
        op: op as keyof typeof EVENT_OP,
        objectId,
        detail: asString(rec.detail) ?? undefined,
        supersededBy: asString(rec.supersededBy) ?? undefined,
        evidence,
      });
      continue;
    }

    warnings.push(`Dropped change with unknown op "${op ?? '(missing)'}"`);
  }

  return { changes, warnings };
}

// --- orchestration ---

export interface ReconcileRunOptions {
  onProgress?: (done: number, total: number) => void;
}

/**
 * Reconcile one project: process its associated conversations newer than the
 * project's cursor, in chronological batches, against current understanding.
 * On success the cursor advances to the newest processed conversation.
 */
export async function reconcileProject(
  projectId: string,
  config: ReconcileConfig,
  options: ReconcileRunOptions = {}
): Promise<ReconcileResult> {
  const project = await getUnderstandingProject(projectId);
  if (!project) {
    throw new Error(`Cannot reconcile: project ${projectId} not found`);
  }

  const associations = (await getAssociationsForProject(projectId)).filter(
    (a) => a.reviewState !== 'rejected'
  );
  const convIds = [...new Set(associations.map((a) => a.conversationId))];
  const conversations = (await db.conversations.where('id').anyOf(convIds).toArray())
    .filter((c) => !project.lastReconciledAt || c.updatedAt > project.lastReconciledAt)
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());

  const result: ReconcileResult = {
    conversationsProcessed: 0,
    batches: 0,
    objectsIntroduced: 0,
    eventsProposed: 0,
    warnings: [],
  };
  if (conversations.length === 0) return result;

  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const batches: StoredConversation[][] = [];
  for (let i = 0; i < conversations.length; i += batchSize) {
    batches.push(conversations.slice(i, i + batchSize));
  }
  options.onProgress?.(0, batches.length);

  for (const batch of batches) {
    // Reload each batch so objects introduced by earlier batches are
    // presented (and can be supported/superseded) by later ones.
    const objects = (await getObjectsForProject(projectId)).filter(
      (o) => o.reviewState !== 'rejected'
    );
    await reconcileBatch(projectId, project, objects, batch, config, result);
    result.batches++;
    result.conversationsProcessed += batch.length;
    options.onProgress?.(result.batches, batches.length);
  }

  // Advance the cursor only after every batch succeeded, to the newest
  // conversation actually processed (deterministic; see the field's caveat).
  await putUnderstandingProject({
    ...project,
    lastReconciledAt: conversations[conversations.length - 1].updatedAt,
    updatedAt: new Date(),
  });

  return result;
}

async function reconcileBatch(
  projectId: string,
  project: { name: string; description?: string },
  objects: UnderstandingObject[],
  batch: StoredConversation[],
  config: ReconcileConfig,
  result: ReconcileResult
): Promise<void> {
  const messagesByConv = new Map<string, StoredMessage[]>();
  for (const conv of batch) {
    messagesByConv.set(conv.id, await getMessagesForConversation(conv.id));
  }
  const digests = batch.map((c) =>
    buildDigest(c, config.excerptLength, messagesByConv.get(c.id), config)
  );

  const messages = buildReconcileMessages(project, objects, digests, config.maxChanges);
  const response = await complete(config.provider, { model: config.model, messages });

  const knownIds = new Set(batch.map((c) => c.id));
  const knownMessageIndexes = new Map(
    digests.map((d) => [d.id, new Set((d.messages ?? []).map((m) => m.i))])
  );
  const knownObjectIds = new Set(objects.map((o) => o.id));
  const parsed = parseReconcileResponse(
    response.text,
    knownIds,
    knownMessageIndexes,
    knownObjectIds,
    config.maxChanges
  );
  result.warnings.push(...parsed.warnings);

  const byId = new Map(batch.map((c) => [c.id, c]));
  const toEvidenceRefs = (evidence: ParsedEvidence[]): EvidenceRef[] =>
    evidence.map((e) => {
      const convMessages = messagesByConv.get(e.conversationId) ?? [];
      const messageIds = e.messageIndexes
        .map((i) => convMessages[i]?.id)
        .filter((id): id is string => id !== undefined);
      return { conversationId: e.conversationId, ...(messageIds.length ? { messageIds } : {}) };
    });
  const occurredAtOf = (evidence: ParsedEvidence[]): Date =>
    evidence.reduce<Date>((latest, e) => {
      const conv = byId.get(e.conversationId);
      return conv && conv.updatedAt > latest ? conv.updatedAt : latest;
    }, new Date(0));

  // Introduces first, building the ref → created-id map that supersededBy
  // resolution needs; then events.
  const refToId = new Map<string, string>();
  for (const change of parsed.changes) {
    if (change.op !== 'introduce') continue;
    const created = await createUnderstandingObject({
      projectId,
      type: change.type,
      title: change.title,
      body: change.body,
      origin: 'ai',
      evidence: toEvidenceRefs(change.evidence),
      occurredAt: occurredAtOf(change.evidence),
    });
    if (change.ref) refToId.set(change.ref, created.id);
    result.objectsIntroduced++;
  }

  const knownForSupersede = new Set([...knownObjectIds, ...refToId.values()]);
  for (const change of parsed.changes) {
    if (change.op === 'introduce') continue;
    let supersededByObjectId: string | undefined;
    if (change.supersededBy) {
      supersededByObjectId = refToId.get(change.supersededBy) ?? change.supersededBy;
      if (!knownForSupersede.has(supersededByObjectId)) {
        result.warnings.push(
          `Dropped unresolvable supersededBy "${change.supersededBy}" on ${change.objectId}`
        );
        supersededByObjectId = undefined;
      }
    }
    await recordUnderstandingEvent({
      objectId: change.objectId,
      op: EVENT_OP[change.op],
      detail: change.detail,
      supersededByObjectId,
      evidence: toEvidenceRefs(change.evidence),
      origin: 'ai',
      occurredAt: occurredAtOf(change.evidence),
    });
    result.eventsProposed++;
  }
}
