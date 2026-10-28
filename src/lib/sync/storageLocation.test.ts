import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('../crypto', () => ({
  isUnlocked: () => false,
  getMasterKey: () => ({}) as CryptoKey,
  encryptJSON: async () => ({ iv: new Uint8Array(), ciphertext: new Uint8Array() }),
  decryptJSON: async () => ({}),
}));

import { db } from '../db';
import { syncEngine } from './engine';
import {
  effectiveLocation,
  getConversationStorage,
  getMessageLocations,
  getStorageSummary,
} from './storageLocation';
import type { StoredConversation, StoredMessage } from '../../types';

function conv(id: string): StoredConversation {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id,
    source: 'claude-code',
    name: id,
    summary: null,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    estimatedTokens: 0,
    fullText: '',
  };
}

function msg(id: string, conversationId: string): StoredMessage {
  return { id, conversationId, sender: 'user', text: 'secret body', createdAt: new Date() } as StoredMessage;
}

const ledger = (kind: string, id: string) => ({ kind, id, syncedAt: new Date() });

beforeAll(async () => {
  // Written before hooks attach: neither queued nor on the server.
  await db.conversations.bulkPut([conv('backed'), conv('partial'), conv('device')]);
  await db.messages.bulkPut([
    msg('b1', 'backed'),
    msg('b2', 'backed'),
    msg('p1', 'partial'),
    msg('p2', 'partial'),
    msg('d1', 'device'),
  ]);
  await db.syncLedger.bulkPut([
    ledger('conversation', 'backed'),
    ledger('message', 'b1'),
    ledger('message', 'b2'),
    ledger('conversation', 'partial'),
    ledger('message', 'p1'),
  ]);
  // Hooks on: the next write is queued (pending).
  await syncEngine.attach();
  await db.messages.put(msg('p3', 'partial'));
});

describe('storage locations', () => {
  it('classifies each conversation by its worst part, with message counts', async () => {
    const storage = await getConversationStorage(['backed', 'partial', 'device']);
    expect(storage.get('backed')).toEqual({
      location: 'cloud',
      messages: { total: 2, cloud: 2, pending: 0, device: 0 },
    });
    // p2 was never queued or synced; p3 is waiting.
    expect(storage.get('partial')).toEqual({
      location: 'device',
      messages: { total: 3, cloud: 1, pending: 1, device: 1 },
    });
    expect(storage.get('device')?.location).toBe('device');
  });

  it('labels individual messages', async () => {
    const locations = await getMessageLocations('partial');
    expect(Object.fromEntries(locations)).toEqual({ p1: 'cloud', p2: 'device', p3: 'pending' });
  });

  it('summarizes the whole database', async () => {
    const summary = await getStorageSummary();
    expect(summary.conversations).toMatchObject({ total: 3, cloud: 2, device: 1 });
    expect(summary.messages).toMatchObject({ total: 6, cloud: 3, pending: 1, device: 2 });
  });

  it('a queued change to a synced record is "waiting", not "backed up"', async () => {
    await db.messages.update('b1', { text: 'edited' });
    expect((await getMessageLocations('backed')).get('b1')).toBe('pending');
  });

  it('signed out, anything not on the server is shown as this device only', () => {
    expect(effectiveLocation('pending', 'logged-out')).toBe('device');
    expect(effectiveLocation('pending', 'locked')).toBe('pending');
    expect(effectiveLocation('cloud', 'logged-out')).toBe('cloud');
  });
});
