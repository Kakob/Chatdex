import { parseFiles, type ParsedData } from './parsers';
import { bulkPutConversations, bulkPutMessages, db } from './db/index';
import { autoAnalyzeConversations } from './detection/autoAnalyze';
import type { DataSource, StoredConversation, StoredMessage } from '../types';

export interface ImportResult {
  conversationsAdded: number;
  conversationsSkipped: number;
  messagesAdded: number;
  source: DataSource;
  addedConversationIds: string[];
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
  await autoAnalyzeConversations(
    selectAutoAnalyzeIds(parsed.conversations, result.addedConversationIds)
  );

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
  };
}
