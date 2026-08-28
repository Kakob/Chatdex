// Intent extraction run orchestration (SPEC-intent-trace §7.4): selects a
// project's conversations by cursor, turns them into heuristic-filtered pairs,
// packs pairs into LLM calls, runs sequentially, and advances the cursor only
// when every batch succeeded on an unscoped run.

import { getUnderstandingProject, putUnderstandingProject } from '../../db/understanding';
import { getMessagesForConversation } from '../../db/messages';
import { getAssociatedConversations } from '../reconcile';
import { selectIntentPairs, type IntentPair } from './pairs';
import { filterPairs } from './heuristic';
import {
  extractIntentsForBatch,
  DEFAULT_MAX_PAIRS_PER_CALL,
  type IntentExtractionConfig,
} from './extraction';
import type { StoredConversation, StoredMessage } from '../../../types';

/**
 * The conversations an extraction run over this project would process:
 * non-rejected associations newer than `lastIntentExtractedAt` (unless the
 * cursor is ignored or the run is scoped), chronological. Exported so the UI
 * can disclose exactly this set.
 */
export async function getIntentExtractableConversations(
  projectId: string,
  ignoreCursor = false,
  conversationIds?: string[]
): Promise<StoredConversation[]> {
  const project = await getUnderstandingProject(projectId);
  if (!project) {
    throw new Error(`Cannot extract intents: project ${projectId} not found`);
  }
  return (await getAssociatedConversations(projectId, conversationIds))
    .filter(
      (c) =>
        ignoreCursor ||
        conversationIds !== undefined ||
        !project.lastIntentExtractedAt ||
        c.updatedAt > project.lastIntentExtractedAt
    )
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
}

export interface RunExtractionOptions {
  onProgress?: (done: number, total: number) => void;
}

export interface IntentExtractionOutcome {
  conversationsProcessed: number;
  batchesRun: number;
  batchesTotal: number;
  intentsCreated: number;
  intentsSupported: number;
  /** Pairs found before the heuristic. */
  pairsConsidered: number;
  /** Pairs actually sent to the provider. */
  pairsSent: number;
  warnings: string[];
}

interface ConversationPairs {
  conv: StoredConversation;
  pairs: IntentPair[];
}

/**
 * Pack pairs into batches of at most `maxPairsPerCall`. A conversation's
 * pairs may span batches (pairs are independent), which keeps a long
 * conversation from forcing an oversized call.
 */
export function packPairBatches(
  perConversation: ConversationPairs[],
  maxPairsPerCall: number
): ConversationPairs[][] {
  const batches: ConversationPairs[][] = [];
  let current: ConversationPairs[] = [];
  let count = 0;
  for (const { conv, pairs } of perConversation) {
    let offset = 0;
    while (offset < pairs.length) {
      const room = maxPairsPerCall - count;
      const slice = pairs.slice(offset, offset + room);
      current.push({ conv, pairs: slice });
      count += slice.length;
      offset += slice.length;
      if (count >= maxPairsPerCall) {
        batches.push(current);
        current = [];
        count = 0;
      }
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export async function runIntentExtraction(
  projectId: string,
  config: IntentExtractionConfig,
  options: RunExtractionOptions = {}
): Promise<IntentExtractionOutcome> {
  const project = await getUnderstandingProject(projectId);
  if (!project) {
    throw new Error(`Cannot extract intents: project ${projectId} not found`);
  }
  const conversations = await getIntentExtractableConversations(
    projectId,
    config.ignoreCursor,
    config.conversationIds
  );

  const outcome: IntentExtractionOutcome = {
    conversationsProcessed: 0,
    batchesRun: 0,
    batchesTotal: 0,
    intentsCreated: 0,
    intentsSupported: 0,
    pairsConsidered: 0,
    pairsSent: 0,
    warnings: [],
  };
  if (conversations.length === 0) return outcome;

  const messagesByConv = new Map<string, StoredMessage[]>();
  const perConversation: ConversationPairs[] = [];
  for (const conv of conversations) {
    const messages = await getMessagesForConversation(conv.id);
    messagesByConv.set(conv.id, messages);
    const all = selectIntentPairs(conv.id, messages, config.pairs);
    const kept = filterPairs(all, config.heuristic);
    outcome.pairsConsidered += all.length;
    outcome.pairsSent += kept.length;
    if (kept.length > 0) perConversation.push({ conv, pairs: kept });
  }

  const batches = packPairBatches(perConversation, config.maxPairsPerCall ?? DEFAULT_MAX_PAIRS_PER_CALL);
  outcome.batchesTotal = batches.length;
  options.onProgress?.(0, batches.length);

  let failed = false;
  for (const batch of batches) {
    try {
      const result = await extractIntentsForBatch(projectId, project, batch, messagesByConv, config);
      outcome.intentsCreated += result.intentsCreated;
      outcome.intentsSupported += result.intentsSupported;
      outcome.warnings.push(...result.warnings);
      outcome.batchesRun++;
      options.onProgress?.(outcome.batchesRun, batches.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome.warnings.push(`Stopped after batch ${outcome.batchesRun} of ${batches.length}: ${message}`);
      failed = true;
      break;
    }
  }
  outcome.conversationsProcessed = failed ? 0 : conversations.length;

  // Advance the cursor only after every batch succeeded and only on unscoped
  // runs — a scoped run may skip older unprocessed conversations that a moved
  // cursor would silently exclude forever (same rule as reconciliation).
  if (!failed && !config.conversationIds) {
    await putUnderstandingProject({
      ...project,
      lastIntentExtractedAt: conversations[conversations.length - 1].updatedAt,
      updatedAt: new Date(),
    });
  }

  return outcome;
}
