import { api } from './api';
import { parseFiles, type ParsedData } from './parsers';
import type { DataSource } from '../types';

export interface ImportResult {
  conversationsAdded: number;
  conversationsSkipped: number;
  messagesAdded: number;
  source: DataSource;
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
  // Phase 1: Parse files
  const parsed = await parseFiles(files, (current, total, filename) => {
    onProgress?.({
      phase: 'parsing',
      current,
      total,
      filename,
    });
  });

  // Phase 2: Store via API
  onProgress?.({
    phase: 'storing',
    current: 0,
    total: parsed.conversations.length,
  });

  const result = await storeData(parsed, (current, total) => {
    onProgress?.({
      phase: 'storing',
      current,
      total,
    });
  });

  onProgress?.({
    phase: 'complete',
    current: result.conversationsAdded,
    total: result.conversationsAdded,
  });

  return result;
}

async function storeData(
  data: ParsedData,
  onProgress?: (current: number, total: number) => void
): Promise<ImportResult> {
  // Convert conversations to API format
  const conversations = data.conversations.map((conv) => ({
    id: conv.id,
    source: conv.source,
    name: conv.name,
    summary: conv.summary,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    importedAt: conv.importedAt.toISOString(),
    messageCount: conv.messageCount,
    userMessageCount: conv.userMessageCount,
    assistantMessageCount: conv.assistantMessageCount,
    estimatedTokens: conv.estimatedTokens,
    fullText: conv.fullText,
    projectPath: conv.projectPath,
    gitBranch: conv.gitBranch,
    workingDirectory: conv.workingDirectory,
  }));

  // Convert messages to API format
  const messages = data.messages.map((msg) => ({
    id: msg.id,
    conversationId: msg.conversationId,
    sender: msg.sender,
    text: msg.text,
    contentBlocks: msg.contentBlocks,
    conversationName: msg.conversationName,
    createdAt: msg.createdAt.toISOString(),
    toolName: msg.toolName,
    toolInput: msg.toolInput,
    toolResult: msg.toolResult,
  }));

  // Send to API in chunks for large imports
  const CHUNK_SIZE = 500;
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalMessages = 0;

  for (let i = 0; i < conversations.length; i += CHUNK_SIZE) {
    const convChunk = conversations.slice(i, i + CHUNK_SIZE);
    const convIds = new Set(convChunk.map((c) => c.id));
    const msgChunk = messages.filter((m) => convIds.has(m.conversationId));

    const result = await api.importData({
      conversations: convChunk,
      messages: msgChunk,
      source: data.source,
    });

    totalAdded += result.conversationsAdded;
    totalSkipped += result.conversationsSkipped;
    totalMessages += result.messagesAdded;

    onProgress?.(Math.min(i + CHUNK_SIZE, conversations.length), conversations.length);
  }

  return {
    conversationsAdded: totalAdded,
    conversationsSkipped: totalSkipped,
    messagesAdded: totalMessages,
    source: data.source,
  };
}
