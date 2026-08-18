import { db } from './schema';
import type { StoredConversation, DataSource } from '../../types';

export async function putConversation(conv: StoredConversation): Promise<void> {
  await db.conversations.put(conv);
}

export async function bulkPutConversations(convs: StoredConversation[]): Promise<void> {
  if (convs.length === 0) return;
  await db.conversations.bulkPut(convs);
}

export async function getConversation(id: string): Promise<StoredConversation | undefined> {
  return db.conversations.get(id);
}

export async function getConversations(options?: {
  source?: DataSource;
  limit?: number;
  offset?: number;
}): Promise<StoredConversation[]> {
  const { source, limit, offset = 0 } = options || {};

  const collection = source
    ? db.conversations.where('source').equals(source)
    : db.conversations.toCollection();

  const sorted = await collection.sortBy('updatedAt');
  sorted.reverse();
  return limit !== undefined ? sorted.slice(offset, offset + limit) : sorted.slice(offset);
}

export async function getConversationCount(source?: DataSource): Promise<number> {
  if (source) {
    return db.conversations.where('source').equals(source).count();
  }
  return db.conversations.count();
}

export async function deleteConversation(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.conversations, db.messages, db.anchors, db.findings, db.detectorRuns, db.investigationAnchors],
    async () => {
      await db.conversations.delete(id);
      await db.messages.where('conversationId').equals(id).delete();
      await db.anchors.where('conversationId').equals(id).delete();
      await db.findings.where('conversationId').equals(id).delete();
      await db.detectorRuns.where('conversationId').equals(id).delete();
      // Derived rows go with the conversation; rawSources stay — a raw payload
      // can back multiple conversations, and deletion policy for primary
      // sources is a separate decision (spec §14).
      await db.investigationAnchors.where('conversationId').equals(id).delete();
    }
  );
}

/**
 * Conversations imported by the pre-2026-05-14 Claude Code parser (fixed in
 * 101e063): it never found cwd in real session files, so projectPath is
 * unset, names fell back to filenames ("agent <hash>"), and tool-only turns
 * are blank. Unrepairable — the tool content was dropped at parse time.
 */
export async function findLegacyClaudeCodeImports(): Promise<StoredConversation[]> {
  const rows = await db.conversations.where('source').equals('claude-code').toArray();
  return rows.filter((c) => !c.projectPath);
}

/**
 * Delete legacy imports one conversation at a time (not bulk) so per-row
 * Dexie hooks fire and the sync engine tombstones each record on the server.
 */
export async function deleteLegacyClaudeCodeImports(): Promise<number> {
  const legacy = await findLegacyClaudeCodeImports();
  for (const conv of legacy) {
    await deleteConversation(conv.id);
  }
  return legacy.length;
}

export async function deleteConversationsBySource(source: DataSource): Promise<void> {
  const ids = await db.conversations
    .where('source')
    .equals(source)
    .primaryKeys();
  await db.transaction(
    'rw',
    [db.conversations, db.messages, db.anchors, db.findings, db.detectorRuns],
    async () => {
      await db.conversations.bulkDelete(ids);
      await db.messages.where('conversationId').anyOf(ids).delete();
      await db.anchors.where('conversationId').anyOf(ids).delete();
      await db.findings.where('conversationId').anyOf(ids).delete();
      await db.detectorRuns.where('conversationId').anyOf(ids).delete();
    }
  );
}

export async function clearConversations(): Promise<void> {
  await db.transaction(
    'rw',
    [db.conversations, db.messages, db.anchors, db.findings, db.detectorRuns],
    async () => {
      await db.conversations.clear();
      await db.messages.clear();
      await db.anchors.clear();
      await db.findings.clear();
      await db.detectorRuns.clear();
    }
  );
}
