// Derived investigation anchors (SPEC-decision-investigation §7.3, DI-1b).
// LOCAL-ONLY, never synced: rows are rebuilt deterministically from stored
// messages, and their ids (= stableKeys) survive re-derivation, so future
// cases can reference them safely. Never add semantic labels here.

import { db } from './schema';
import type { InvestigationAnchor } from '../../types/investigation';

/**
 * Replace a conversation's derived anchors with a freshly derived set.
 * Deterministic ids make this idempotent; a transaction keeps the swap atomic
 * so readers never observe a partially derived conversation.
 */
export async function replaceInvestigationAnchors(
  conversationId: string,
  anchors: InvestigationAnchor[]
): Promise<void> {
  await db.transaction('rw', db.investigationAnchors, async () => {
    await db.investigationAnchors.where('conversationId').equals(conversationId).delete();
    if (anchors.length > 0) {
      await db.investigationAnchors.bulkAdd(anchors);
    }
  });
}

export async function getInvestigationAnchor(
  id: string
): Promise<InvestigationAnchor | undefined> {
  return db.investigationAnchors.get(id);
}

export interface ListInvestigationAnchorOptions {
  conversationId?: string;
  conversationIds?: string[];
  order?: 'asc' | 'desc';
}

/** Chronological anchor listing (spec §8.1 — no relevance ordering exists). */
export async function listInvestigationAnchors(
  options: ListInvestigationAnchorOptions = {}
): Promise<InvestigationAnchor[]> {
  const { conversationId, conversationIds, order = 'asc' } = options;
  let rows: InvestigationAnchor[];
  if (conversationId) {
    rows = await db.investigationAnchors
      .where('conversationId')
      .equals(conversationId)
      .sortBy('occurredAt');
  } else if (conversationIds) {
    rows =
      conversationIds.length === 0
        ? []
        : await db.investigationAnchors
            .where('conversationId')
            .anyOf(conversationIds)
            .sortBy('occurredAt');
  } else {
    rows = await db.investigationAnchors.orderBy('occurredAt').toArray();
  }
  return order === 'desc' ? rows.reverse() : rows;
}

export async function getInvestigationAnchorsForFile(
  filePath: string
): Promise<InvestigationAnchor[]> {
  return db.investigationAnchors.where('filePaths').equals(filePath).sortBy('occurredAt');
}

export async function getInvestigationAnchorCount(): Promise<number> {
  return db.investigationAnchors.count();
}
