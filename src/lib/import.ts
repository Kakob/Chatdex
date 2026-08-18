import { parseFiles, type ParsedData } from './parsers';
import { bulkPutConversations, bulkPutMessages, storeRawSources, db } from './db/index';
import { autoAnalyzeConversations } from './detection/autoAnalyze';
import { deriveAnchorsForConversation } from './investigation/anchors';
import type { DataSource, StoredConversation, StoredMessage } from '../types';

export interface ImportResult {
  conversationsAdded: number;
  conversationsSkipped: number;
  messagesAdded: number;
  source: DataSource;
  addedConversationIds: string[];
  /** Raw payloads retained this import (deduped by content hash). */
  rawSourcesAdded: number;
}

export interface ImportProgress {
  phase: 'parsing' | 'storing' | 'complete';
  current: number;
  total: number;
  filename?: string;
}

export async function importFiles(
  files: File[],
  onProgress?: (progress: ImportProgress) => void
): Promise<ImportResult> {
  const parsed = await parseFiles(files, (current, total, filename) => {
    onProgress?.({ phase: 'parsing', current, total, filename });
  });

  onProgress?.({
    phase: 'storing',
    current: 0,
    total: parsed.conversations.length,
  });

  const result = await storeData(parsed, (current, total) => {
    onProgress?.({ phase: 'storing', current, total });
  });

  // Auto-run failure detection over freshly ingested agent sessions (SPEC §4).
  const agentSessionIds = selectAutoAnalyzeIds(
    parsed.conversations,
    result.addedConversationIds
  );
  await autoAnalyzeConversations(agentSessionIds);

  // Derive investigation anchors for the same sessions (claude-code is the
  // MVP's only code-bearing source, SPEC-decision-investigation §5.1).
  // Like detection, a derivation failure never fails an import.
  for (const id of agentSessionIds) {
    try {
      await deriveAnchorsForConversation(id);
    } catch (err) {
      console.error('[investigation] anchor derivation failed for', id, err);
    }
  }

  onProgress?.({
    phase: 'complete',
    current: result.conversationsAdded,
    total: result.conversationsAdded,
  });

  return result;
}

// Detectors are tool-call oriented; only agent sessions get auto-analysis.
export function selectAutoAnalyzeIds(
  conversations: StoredConversation[],
  addedIds: string[]
): string[] {
  const agentSessionIds = new Set(
    conversations.filter((c) => c.source === 'claude-code').map((c) => c.id)
  );
  return addedIds.filter((id) => agentSessionIds.has(id));
}

async function storeData(
  data: ParsedData,
  onProgress?: (current: number, total: number) => void
): Promise<ImportResult> {
  // Retain raw payloads first (SPEC-decision-investigation §7.1): the primary
  // source must survive even if the normalized writes below fail partway.
  // Content-hash dedup makes this idempotent, and it runs regardless of
  // conversation dedup — a grown session file whose conversation id already
  // exists still gets its new raw version recorded.
  const rawResult = await storeRawSources(data.rawSources);

  const incomingIds = data.conversations.map((c) => c.id);
  const existingIds = new Set(
    (await db.conversations.bulkGet(incomingIds))
      .filter((c): c is StoredConversation => Boolean(c))
      .map((c) => c.id)
  );

  let added = 0;
  let skipped = 0;
  let totalMessages = 0;
  const addedConversationIds: string[] = [];

  const CHUNK_SIZE = 500;
  for (let i = 0; i < data.conversations.length; i += CHUNK_SIZE) {
    const convChunk = data.conversations.slice(i, i + CHUNK_SIZE);
    const newConvs = convChunk.filter((c) => !existingIds.has(c.id));
    skipped += convChunk.length - newConvs.length;
    added += newConvs.length;
    addedConversationIds.push(...newConvs.map((c) => c.id));

    if (newConvs.length > 0) {
      const newConvIds = new Set(newConvs.map((c) => c.id));
      const newMessages: StoredMessage[] = data.messages.filter((m) =>
        newConvIds.has(m.conversationId)
      );
      await bulkPutConversations(newConvs);
      await bulkPutMessages(newMessages);
      totalMessages += newMessages.length;
    }

    onProgress?.(
      Math.min(i + CHUNK_SIZE, data.conversations.length),
      data.conversations.length
    );
  }

  return {
    conversationsAdded: added,
    conversationsSkipped: skipped,
    messagesAdded: totalMessages,
    source: data.source,
    addedConversationIds,
    rawSourcesAdded: rawResult.added,
  };
}
