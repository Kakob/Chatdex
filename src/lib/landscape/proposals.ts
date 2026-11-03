// Concept discussion → proposed landscape updates (docs/changes/editable-landscape).
//
// After discussing a concept in native chat, the user can ask Chatdex to
// propose updates to that concept from the discussion. One provider call,
// user-initiated and disclosed (invariant 6). Output is written through the
// existing review gate, never applied directly:
//   - "add"    → a new AI-origin UnderstandingObject (pending) placed in the concept;
//   - "revise" → an AI-origin 'refined' event (pending) carrying new wording
//                for one of the concept's accepted statements; accepting it
//                rewrites the object and keeps the old text in history.
// Evidence for every proposal is the chat itself (message-anchored when the
// model cites indexes), so AI-origin rows stay explainable (PRD §9).

import { complete, type ChatMessage, type LLMProviderId } from '../providers';
import { db } from '../db/schema';
import { getMessagesForConversation } from '../db/messages';
import { createUnderstandingObject, recordUnderstandingEvent } from '../db/understanding';
import { setMembership } from '../db/landscape';
import type { EvidenceRef } from '../../types/understanding';
import { buildConceptContext, type ConceptChatContext } from './concept';
import { loadLandscape } from './load';

export const PROPOSABLE_TYPES = ['behavior', 'belief', 'question', 'decision'] as const;

export interface ProposalConfig {
  provider: LLMProviderId;
  model?: string;
  /** Most proposals kept from one response. Default 8. */
  maxChanges?: number;
  /** Transcript budget in characters (newest kept). Default 24 000. */
  maxTranscriptChars?: number;
}

const DEFAULT_MAX_CHANGES = 8;
const DEFAULT_TRANSCRIPT_CHARS = 24_000;

export interface TranscriptLine {
  i: number;
  role: 'user' | 'assistant';
  text: string;
}

export function buildProposalMessages(
  context: ConceptChatContext,
  editable: { id: string; type: string; title: string; body?: string }[],
  transcript: TranscriptLine[],
  maxChanges = DEFAULT_MAX_CHANGES
): ChatMessage[] {
  const system = [
    `You turn a discussion about the concept "${context.conceptTitle}" (${context.path.join(' › ')}) into proposed updates to the user's recorded understanding.`,
    'The user reviews every proposal; nothing you return is applied automatically.',
    'Respond with a single JSON object, no prose:',
    '{ "changes": [',
    `  { "op": "add", "type": ${PROPOSABLE_TYPES.map((t) => `"${t}"`).join(' | ')}, "title": string, "body": string, "messageIndexes": number[] },`,
    '  { "op": "revise", "objectId": string, "title": string, "body": string, "detail": string, "messageIndexes": number[] }',
    '] }',
    'Rules:',
    '- behavior = intended behavior the user wants; belief = something the user currently thinks is true; question = still uncertain; decision = a choice the user made. Do not record the assistant\'s suggestions as decisions unless the user agreed.',
    '- Prefer revising an existing statement over adding a near-duplicate. revise only these objectIds: ' + (editable.length ? editable.map((e) => e.id).join(', ') : '(none)') + '.',
    '- title is one concise sentence; body is optional detail (may be "").',
    '- detail (revise only) says in one sentence what changed and why.',
    '- messageIndexes lists the "i" of the messages that support the change.',
    `- At most ${maxChanges} changes; only what the discussion actually settled or surfaced. Return {"changes": []} if nothing should change.`,
    '',
    'Recorded understanding of the concept:',
    context.document,
    '',
    'Statements you may revise:',
    JSON.stringify(editable),
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ discussion: transcript }) },
  ];
}

export type ParsedProposal =
  | { op: 'add'; type: string; title: string; body?: string; messageIndexes: number[] }
  | { op: 'revise'; objectId: string; title: string; body?: string; detail?: string; messageIndexes: number[] };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function parseProposalResponse(
  text: string,
  editableIds: Set<string>,
  messageIndexes: Set<number>,
  maxChanges = DEFAULT_MAX_CHANGES
): { changes: ParsedProposal[]; warnings: string[] } {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    try {
      raw = start >= 0 && end > start ? JSON.parse(stripped.slice(start, end + 1)) : null;
    } catch {
      raw = null;
    }
    if (!raw) throw new Error('The provider did not return valid JSON proposals');
  }
  const list = Array.isArray((raw as { changes?: unknown }).changes) ? ((raw as { changes: unknown[] }).changes) : [];
  const warnings: string[] = [];
  if (list.length > maxChanges) warnings.push(`Kept the first ${maxChanges} of ${list.length} proposals`);
  const changes: ParsedProposal[] = [];
  for (const item of list.slice(0, maxChanges)) {
    const rec = (item ?? {}) as Record<string, unknown>;
    const indexes = Array.isArray(rec.messageIndexes)
      ? [...new Set(rec.messageIndexes.filter((n): n is number => typeof n === 'number' && messageIndexes.has(n)))]
      : [];
    const title = str(rec.title);
    const body = str(rec.body) || undefined;
    if (!title) {
      warnings.push('Dropped a proposal without a title');
      continue;
    }
    if (rec.op === 'add') {
      const type = str(rec.type).toLowerCase();
      if (!(PROPOSABLE_TYPES as readonly string[]).includes(type)) {
        warnings.push(`Dropped "${title}": unsupported type "${type}"`);
        continue;
      }
      changes.push({ op: 'add', type, title, body, messageIndexes: indexes });
    } else if (rec.op === 'revise') {
      const objectId = str(rec.objectId);
      if (!editableIds.has(objectId)) {
        warnings.push(`Dropped a revision of unknown or non-editable record "${objectId}"`);
        continue;
      }
      changes.push({ op: 'revise', objectId, title, body, detail: str(rec.detail) || undefined, messageIndexes: indexes });
    } else {
      warnings.push(`Dropped a proposal with unknown op "${String(rec.op)}"`);
    }
  }
  return { changes, warnings };
}

export interface ProposalResult {
  added: number;
  revised: number;
  warnings: string[];
}

/**
 * Run one proposal pass for a concept chat. Caller has already shown the
 * disclosure (the chat transcript and the concept context go to `provider`).
 */
export async function proposeConceptUpdates(
  chatId: string,
  projectId: string,
  conceptId: string,
  config: ProposalConfig
): Promise<ProposalResult> {
  const maxChanges = config.maxChanges ?? DEFAULT_MAX_CHANGES;
  const { landscape } = await loadLandscape();
  const context = buildConceptContext(landscape, projectId, conceptId);
  if (!context) throw new Error('That concept no longer exists in this project');
  const node = landscape.regions.get(conceptId)!;
  const editable = node.directIds
    .map((id) => landscape.findings.get(id)!)
    .filter((f) => f.object.status === 'current' && (f.object.reviewState === 'accepted' || f.object.reviewState === 'edited'))
    .map((f) => ({ id: f.object.id, type: f.object.type, title: f.object.title, ...(f.object.body ? { body: f.object.body } : {}) }));

  const chat = await db.conversations.get(chatId);
  if (!chat) throw new Error('Chat not found');
  const stored = (await getMessagesForConversation(chatId)).filter((m) => m.sender === 'user' || m.sender === 'assistant');
  const lines: TranscriptLine[] = stored.map((m, i) => ({ i, role: m.sender as 'user' | 'assistant', text: m.text }));
  // Newest messages first into the budget, then restore order.
  const budget = config.maxTranscriptChars ?? DEFAULT_TRANSCRIPT_CHARS;
  const kept: TranscriptLine[] = [];
  let used = 0;
  for (const line of [...lines].reverse()) {
    if (used + line.text.length > budget && kept.length) break;
    kept.unshift(line);
    used += line.text.length;
  }
  if (!kept.length) throw new Error('This chat has no messages to learn from yet');

  const messages = buildProposalMessages(context, editable, kept, maxChanges);
  const response = await complete(config.provider, { messages, ...(config.model ? { model: config.model } : {}) });
  const parsed = parseProposalResponse(
    response.text,
    new Set(editable.map((e) => e.id)),
    new Set(kept.map((l) => l.i)),
    maxChanges
  );

  const evidenceFor = (indexes: number[]): EvidenceRef[] => {
    const messageIds = indexes.map((i) => stored[i]?.id).filter((id): id is string => Boolean(id));
    return [{ conversationId: chatId, ...(messageIds.length ? { messageIds } : {}), note: `Discussed in chat about “${context.conceptTitle}”` }];
  };
  const result: ProposalResult = { added: 0, revised: 0, warnings: parsed.warnings };
  for (const change of parsed.changes) {
    if (change.op === 'add') {
      const object = await createUnderstandingObject({
        projectId,
        type: change.type,
        title: change.title,
        body: change.body,
        origin: 'ai',
        evidence: evidenceFor(change.messageIndexes),
        occurredAt: chat.updatedAt,
      });
      // Placement is organization only; the object stays pending until reviewed.
      await setMembership(conceptId, object.id, true);
      result.added += 1;
    } else {
      const object = await db.understandingObjects.get(change.objectId);
      if (!object) continue;
      const body = change.body ?? object.body;
      if (object.title === change.title && (object.body || undefined) === (body || undefined)) continue;
      await recordUnderstandingEvent({
        objectId: change.objectId,
        op: 'refined',
        detail: change.detail ?? 'Proposed rewording from a concept discussion',
        evidence: evidenceFor(change.messageIndexes),
        origin: 'ai',
        occurredAt: chat.updatedAt,
        revision: { title: change.title, body: body || undefined, previousTitle: object.title, previousBody: object.body || undefined },
      });
      result.revised += 1;
    }
  }
  return result;
}
