// "Where is this saved?" (docs/changes/reliable-sync Phase 2). Derived from
// the sync ledger (what the server holds) and the engine's dirty queue (what
// is waiting to upload). Reads kinds and ids only — never record content.

import { db } from '../db';
import { syncEngine, storageKey } from './engine';
import type { AuthStatus } from '../../stores/authStore';

/** cloud: the server holds the current version. pending: queued to upload. device: neither. */
export type StorageLocation = 'cloud' | 'pending' | 'device';

export interface Tally {
  total: number;
  cloud: number;
  pending: number;
  device: number;
}

export interface ConversationStorage {
  /** Worst of the conversation row and all its messages. */
  location: StorageLocation;
  messages: Tally;
}

const RANK: Record<StorageLocation, number> = { cloud: 0, pending: 1, device: 2 };

function worst(a: StorageLocation, b: StorageLocation): StorageLocation {
  return RANK[a] >= RANK[b] ? a : b;
}

function emptyTally(): Tally {
  return { total: 0, cloud: 0, pending: 0, device: 0 };
}

function locate(key: string, ledger: Set<string>, pending: Set<string>): StorageLocation {
  if (pending.has(key)) return 'pending';
  return ledger.has(key) ? 'cloud' : 'device';
}

async function ledgerKeys(kind: string): Promise<Set<string>> {
  const ids = (await db.syncLedger.where('kind').equals(kind).primaryKeys()) as Array<
    [string, string]
  >;
  return new Set(ids.map(([k, id]) => storageKey(k, id)));
}

/**
 * What to show the user. Signed out, nothing uploads, so anything not already
 * on the server is on this device only, whatever the queue says.
 */
export function effectiveLocation(location: StorageLocation, auth: AuthStatus): StorageLocation {
  if (location === 'cloud') return 'cloud';
  return auth === 'logged-out' ? 'device' : location;
}

export async function getConversationStorage(
  conversationIds: string[]
): Promise<Map<string, ConversationStorage>> {
  const out = new Map<string, ConversationStorage>();
  if (conversationIds.length === 0) return out;
  const pending = syncEngine.getPendingKeys();
  const [convLedger, msgLedger] = await Promise.all([
    ledgerKeys('conversation'),
    ledgerKeys('message'),
  ]);

  for (const id of conversationIds) {
    out.set(id, {
      location: locate(storageKey('conversation', id), convLedger, pending),
      messages: emptyTally(),
    });
  }
  // Key-only cursor: no message bodies are read.
  await db.messages
    .where('conversationId')
    .anyOf(conversationIds)
    .eachKey((conversationId, cursor) => {
      const entry = out.get(String(conversationId));
      if (!entry) return;
      const where = locate(storageKey('message', String(cursor.primaryKey)), msgLedger, pending);
      entry.messages.total++;
      entry.messages[where]++;
      entry.location = worst(entry.location, where);
    });
  return out;
}

export async function getMessageLocations(
  conversationId: string
): Promise<Map<string, StorageLocation>> {
  const pending = syncEngine.getPendingKeys();
  const ledger = await ledgerKeys('message');
  const ids = (await db.messages
    .where('conversationId')
    .equals(conversationId)
    .primaryKeys()) as string[];
  return new Map(ids.map((id) => [id, locate(storageKey('message', id), ledger, pending)]));
}

export interface StorageSummary {
  conversations: Tally;
  messages: Tally;
  projects: Tally;
}

/** Whole-database counts for the header menu. */
export async function getStorageSummary(): Promise<StorageSummary> {
  const pending = syncEngine.getPendingKeys();
  const tally = async (kind: string, ids: Promise<unknown[]>): Promise<Tally> => {
    const [ledger, keys] = await Promise.all([ledgerKeys(kind), ids]);
    const t = emptyTally();
    for (const id of keys) {
      t.total++;
      t[locate(storageKey(kind, String(id)), ledger, pending)]++;
    }
    return t;
  };
  const [conversations, messages, projects] = await Promise.all([
    tally('conversation', db.conversations.toCollection().primaryKeys()),
    tally('message', db.messages.toCollection().primaryKeys()),
    tally('understanding_project', db.understandingProjects.toCollection().primaryKeys()),
  ]);
  return { conversations, messages, projects };
}
