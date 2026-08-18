// Immutable raw-source retention (SPEC-decision-investigation §7.1, DI-1a).
// Rows are content-addressed by SHA-256 and never mutated after insert; a
// materially changed re-import of the same file stores a new row. This table
// is LOCAL-ONLY — never hook it into the sync engine.

import { db } from './schema';
import type { RawSource } from '../../types/investigation';
import type { RawSourceCapture } from '../parsers';
import { generateId } from '../utils/ids';
import { sha256Hex } from '../utils/hash';

export interface RawSourceStoreResult {
  added: number;
  skippedExisting: number;
}

/**
 * Persist parser captures as RawSource rows, deduplicating by content hash:
 * re-importing byte-identical files is a no-op, while a grown/changed file
 * becomes a new source version alongside the old one.
 */
export async function storeRawSources(
  captures: RawSourceCapture[]
): Promise<RawSourceStoreResult> {
  let added = 0;
  let skippedExisting = 0;

  for (const cap of captures) {
    const contentHash = await sha256Hex(cap.rawText);
    const existing = await db.rawSources.where('contentHash').equals(contentHash).first();
    if (existing) {
      skippedExisting++;
      continue;
    }
    const row: RawSource = {
      id: generateId(),
      kind: cap.kind,
      filename: cap.filename,
      contentHash,
      parserVersion: cap.parserVersion,
      importedAt: new Date(),
      conversationIds: cap.conversationIds,
      textLength: cap.rawText.length,
      rawText: cap.rawText,
    };
    await db.rawSources.add(row);
    added++;
  }

  return { added, skippedExisting };
}

export async function getRawSource(id: string): Promise<RawSource | undefined> {
  return db.rawSources.get(id);
}

export async function getRawSourceByHash(
  contentHash: string
): Promise<RawSource | undefined> {
  return db.rawSources.where('contentHash').equals(contentHash).first();
}

export async function getRawSourcesForConversation(
  conversationId: string
): Promise<RawSource[]> {
  return db.rawSources.where('conversationIds').equals(conversationId).toArray();
}

/** Re-verify a stored row against its recorded hash (integrity check, §2.3). */
export async function verifyRawSource(id: string): Promise<boolean> {
  const row = await db.rawSources.get(id);
  if (!row) return false;
  return (await sha256Hex(row.rawText)) === row.contentHash;
}
