// Project discovery (PRD §6, stage U1.2). Sends conversation digests to a
// user-authenticated LLM provider (via the transit-only relay) and persists
// the proposals as pending-review rows: projects, associations
// (confidence + reason), and a deliberately small set of understanding
// objects with evidence.
//
// Everything AI-proposed lands as origin 'ai' / reviewState 'pending' — the
// user's review (U1.3) decides what becomes canonical (PRD §11).
//
// Hallucination guard: only conversation IDs that were actually in the
// analyzed batch are accepted as association targets or evidence, and only
// message indexes that appeared in a digest are accepted as message-level
// evidence. Anything else the model invents is dropped and reported as a
// warning.
//
// Message-level provenance (PRD §9, U2.2): digests carry individual messages
// identified by their position `i` in the conversation — indexes, not ids,
// so citations are cheap to transmit and trivially validated. Cited indexes
// are translated back to real StoredMessage ids before persisting, giving
// EvidenceRef.messageIds the panel can deep-link to.

import { complete } from '../providers';
import type { LLMProviderId, ChatMessage } from '../providers';
import { db } from '../db/schema';
import { getMessagesForConversation } from '../db/messages';
import {
  putUnderstandingProject,
  putProjectAssociation,
  createUnderstandingObject,
} from '../db/understanding';
import { generateId } from '../utils/ids';
import type { StoredConversation, StoredMessage } from '../../types';
import type { UnderstandingProject, EvidenceRef } from '../../types/understanding';

export interface DiscoveryConfig {
  provider: LLMProviderId;
  model?: string;
  /** Max characters of conversation text included per digest (fallback when no messages are stored). */
  excerptLength?: number;
  /** Cap on understanding objects the model is asked for per batch (PRD §6: "deliberately small"). */
  maxObjects?: number;
  /** Max messages included per conversation digest. */
  maxDigestMessages?: number;
  /** Max characters of text included per digest message. */
  messageExcerptLength?: number;
}

export interface DiscoveryResult {
  projectsCreated: number;
  projectsMatched: number;
  associationsCreated: number;
  associationsSkipped: number;
  objectsCreated: number;
  warnings: string[];
}

const DEFAULT_EXCERPT_LENGTH = 600;
const DEFAULT_MAX_OBJECTS = 5;
const DEFAULT_MAX_DIGEST_MESSAGES = 8;
const DEFAULT_MESSAGE_EXCERPT_LENGTH = 200;

// --- digest + prompt construction (exported for tests) ---

/** One message in a digest. `i` is the position in the full stored message list. */
export interface DigestMessage {
  i: number;
  role: string;
  text: string;
}

export interface ConversationDigest {
  id: string;
  source: string;
  name: string;
  updatedAt: string;
  /** Whole-conversation excerpt; only present when no messages are stored. */
  excerpt?: string;
  /** Sampled messages; preferred over excerpt when available. */
  messages?: DigestMessage[];
}

/**
 * Pick which messages represent a conversation in its digest: the opening
 * messages establish the topic, the closing ones carry the latest state, so
 * when over budget take the first 3 and fill the rest from the tail.
 * Returned entries keep their original position as `i`.
 */
export function sampleDigestMessages(
  messages: StoredMessage[],
  max = DEFAULT_MAX_DIGEST_MESSAGES
): Array<{ i: number; message: StoredMessage }> {
  const indexed = messages.map((message, i) => ({ i, message }));
  if (indexed.length <= max) return indexed;
  const headCount = Math.min(3, max);
  return [...indexed.slice(0, headCount), ...indexed.slice(indexed.length - (max - headCount))];
}

export function buildDigest(
  conv: StoredConversation,
  excerptLength = DEFAULT_EXCERPT_LENGTH,
  messages?: StoredMessage[],
  config: { maxDigestMessages?: number; messageExcerptLength?: number } = {}
): ConversationDigest {
  const digest: ConversationDigest = {
    id: conv.id,
    source: conv.source,
    name: conv.name,
    updatedAt: conv.updatedAt.toISOString(),
  };
  if (messages && messages.length > 0) {
    const perMessage = config.messageExcerptLength ?? DEFAULT_MESSAGE_EXCERPT_LENGTH;
    digest.messages = sampleDigestMessages(
      messages,
      config.maxDigestMessages ?? DEFAULT_MAX_DIGEST_MESSAGES
    ).map(({ i, message }) => ({
      i,
      role: message.sender,
      text: message.text.replace(/\s+/g, ' ').slice(0, perMessage),
    }));
  } else {
    digest.excerpt = conv.fullText.replace(/\s+/g, ' ').slice(0, excerptLength);
  }
  return digest;
}

export function buildDiscoveryMessages(
  digests: ConversationDigest[],
  existingProjects: UnderstandingProject[],
  maxObjects = DEFAULT_MAX_OBJECTS
): ChatMessage[] {
  const projectList =
    existingProjects.length > 0
      ? existingProjects.map((p) => `- ${p.name}`).join('\n')
      : '(none yet)';

  const system = [
    'You reconstruct likely projects from a user\'s AI conversation history.',
    'Respond with a single JSON object, no prose, matching exactly:',
    '{',
    '  "projects": [{ "name": string, "description": string }],',
    '  "associations": [{ "conversationId": string, "projectName": string, "confidence": number, "reason": string }],',
    '  "objects": [{ "projectName": string | null, "type": string, "title": string, "body": string, "evidence": [{ "conversationId": string, "messageIndexes": number[] }] }]',
    '}',
    'Rules:',
    '- Reuse an existing project name when a conversation clearly belongs to it; only invent new projects when necessary.',
    '- A conversation may associate with multiple projects, one, or none. confidence is 0..1.',
    '- reason: one sentence explaining the association from the conversation content.',
    `- objects: at most ${maxObjects}, only the highest-signal items (direction, decision, idea, question, goal). type is a short lowercase noun. evidence must cite the conversations the object is derived from; messageIndexes lists the "i" values of the specific messages that support it (empty array if the whole conversation does).`,
    '- Only reference conversationId and message "i" values given in the input.',
    'Existing projects:',
    projectList,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ conversations: digests }) },
  ];
}

// --- response parsing (exported for tests) ---

export interface ParsedDiscovery {
  projects: Array<{ name: string; description: string }>;
  associations: Array<{
    conversationId: string;
    projectName: string;
    confidence: number;
    reason: string;
  }>;
  objects: Array<{
    projectName: string | null;
    type: string;
    title: string;
    body?: string;
    evidence: Array<{ conversationId: string; messageIndexes: number[] }>;
  }>;
  warnings: string[];
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function parseDiscoveryResponse(
  text: string,
  knownConversationIds: Set<string>,
  /** Per-conversation message indexes that were actually in the digests. */
  knownMessageIndexes: Map<string, Set<number>> = new Map()
): ParsedDiscovery {
  // Models sometimes wrap JSON in markdown fences despite instructions.
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    throw new Error('Discovery response was not valid JSON');
  }
  const obj = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const result: ParsedDiscovery = { projects: [], associations: [], objects: [], warnings };

  for (const p of Array.isArray(obj.projects) ? obj.projects : []) {
    const rec = p as Record<string, unknown>;
    const name = asString(rec.name);
    if (!name) {
      warnings.push('Dropped project without a name');
      continue;
    }
    result.projects.push({ name, description: asString(rec.description) ?? '' });
  }

  for (const a of Array.isArray(obj.associations) ? obj.associations : []) {
    const rec = a as Record<string, unknown>;
    const conversationId = asString(rec.conversationId);
    const projectName = asString(rec.projectName);
    if (!conversationId || !projectName) {
      warnings.push('Dropped association missing conversationId or projectName');
      continue;
    }
    if (!knownConversationIds.has(conversationId)) {
      warnings.push(`Dropped association citing unknown conversation ${conversationId}`);
      continue;
    }
    const confidence =
      typeof rec.confidence === 'number' && Number.isFinite(rec.confidence)
        ? Math.min(1, Math.max(0, rec.confidence))
        : 0.5;
    result.associations.push({
      conversationId,
      projectName,
      confidence,
      reason: asString(rec.reason) ?? '',
    });
  }

  for (const o of Array.isArray(obj.objects) ? obj.objects : []) {
    const rec = o as Record<string, unknown>;
    const type = asString(rec.type);
    const title = asString(rec.title);
    if (!type || !title) {
      warnings.push('Dropped object missing type or title');
      continue;
    }

    // Preferred shape: evidence entries with optional message indexes.
    // Legacy shape (models occasionally regress to it): bare conversationIds.
    const rawEvidence = Array.isArray(rec.evidence)
      ? rec.evidence
      : Array.isArray(rec.conversationIds)
        ? rec.conversationIds.map((conversationId) => ({ conversationId, messageIndexes: [] }))
        : [];

    const cited: Array<{ conversationId: string; messageIndexes: number[] }> = [];
    for (const e of rawEvidence) {
      const entry = e as Record<string, unknown>;
      const conversationId = asString(entry.conversationId);
      if (!conversationId || !knownConversationIds.has(conversationId)) continue;
      const validIndexes = knownMessageIndexes.get(conversationId);
      const rawIndexes = Array.isArray(entry.messageIndexes) ? entry.messageIndexes : [];
      const messageIndexes = rawIndexes.filter(
        (i): i is number => Number.isInteger(i) && (validIndexes?.has(i as number) ?? false)
      );
      if (messageIndexes.length < rawIndexes.length) {
        warnings.push(`Dropped invented message indexes on object "${title}"`);
      }
      cited.push({ conversationId, messageIndexes });
    }
    if (cited.length === 0) {
      // PRD §9: an AI proposal without real evidence is unusable.
      warnings.push(`Dropped object "${title}" with no valid evidence conversations`);
      continue;
    }
    result.objects.push({
      projectName: asString(rec.projectName),
      type: type.toLowerCase(),
      title,
      body: asString(rec.body) ?? undefined,
      evidence: cited,
    });
  }

  return result;
}

// --- orchestration ---

export async function discoverProjects(
  conversations: StoredConversation[],
  config: DiscoveryConfig
): Promise<DiscoveryResult> {
  if (conversations.length === 0) {
    throw new Error('No conversations to analyze');
  }

  // Message-level digests when messages are stored; fullText excerpt fallback.
  const messagesByConv = new Map<string, StoredMessage[]>();
  for (const conv of conversations) {
    messagesByConv.set(conv.id, await getMessagesForConversation(conv.id));
  }
  const digests = conversations.map((c) =>
    buildDigest(c, config.excerptLength, messagesByConv.get(c.id), config)
  );
  const existing = await db.understandingProjects.toArray();
  const messages = buildDiscoveryMessages(digests, existing, config.maxObjects);

  const response = await complete(config.provider, { model: config.model, messages });
  const knownIds = new Set(conversations.map((c) => c.id));
  const knownMessageIndexes = new Map(
    digests.map((d) => [d.id, new Set((d.messages ?? []).map((m) => m.i))])
  );
  const parsed = parseDiscoveryResponse(response.text, knownIds, knownMessageIndexes);

  const byId = new Map(conversations.map((c) => [c.id, c]));
  const result: DiscoveryResult = {
    projectsCreated: 0,
    projectsMatched: 0,
    associationsCreated: 0,
    associationsSkipped: 0,
    objectsCreated: 0,
    warnings: parsed.warnings,
  };

  // Resolve project names → rows, matching existing projects case-insensitively
  // so repeated runs converge on one row per project instead of duplicating.
  const projectByName = new Map<string, UnderstandingProject>(
    existing.map((p) => [p.name.toLowerCase(), p])
  );
  const ensureProject = async (name: string, description?: string) => {
    const found = projectByName.get(name.toLowerCase());
    if (found) {
      result.projectsMatched++;
      return found;
    }
    const now = new Date();
    const project: UnderstandingProject = {
      id: generateId(),
      name,
      description: description || undefined,
      origin: 'ai',
      reviewState: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await putUnderstandingProject(project);
    projectByName.set(name.toLowerCase(), project);
    result.projectsCreated++;
    return project;
  };

  for (const p of parsed.projects) {
    await ensureProject(p.name, p.description);
  }

  for (const a of parsed.associations) {
    const project = await ensureProject(a.projectName);
    const dupe = await db.projectAssociations
      .where('[projectId+conversationId]')
      .equals([project.id, a.conversationId])
      .first();
    if (dupe) {
      result.associationsSkipped++;
      continue;
    }
    const now = new Date();
    await putProjectAssociation({
      id: generateId(),
      projectId: project.id,
      conversationId: a.conversationId,
      confidence: a.confidence,
      reason: a.reason || undefined,
      origin: 'ai',
      reviewState: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    result.associationsCreated++;
  }

  for (const o of parsed.objects) {
    const project = o.projectName ? await ensureProject(o.projectName) : null;
    // Anchor the object in the source timeline: the latest activity among its
    // evidence conversations (PRD §8 — understanding is temporal).
    const occurredAt = o.evidence.reduce<Date>((latest, e) => {
      const conv = byId.get(e.conversationId);
      return conv && conv.updatedAt > latest ? conv.updatedAt : latest;
    }, new Date(0));
    // Cited message indexes → real StoredMessage ids (position in the same
    // ordered list the digest was built from).
    const evidence: EvidenceRef[] = o.evidence.map((e) => {
      const convMessages = messagesByConv.get(e.conversationId) ?? [];
      const messageIds = e.messageIndexes
        .map((i) => convMessages[i]?.id)
        .filter((id): id is string => id !== undefined);
      return { conversationId: e.conversationId, ...(messageIds.length ? { messageIds } : {}) };
    });
    await createUnderstandingObject({
      projectId: project?.id ?? null,
      type: o.type,
      title: o.title,
      body: o.body,
      origin: 'ai',
      evidence,
      occurredAt,
    });
    result.objectsCreated++;
  }

  return result;
}
