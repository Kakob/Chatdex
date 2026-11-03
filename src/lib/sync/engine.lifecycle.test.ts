// Reliable-sync lifecycle (docs/changes/reliable-sync): changes made while the
// vault is locked are queued and uploaded on unlock, rows the server never saw
// are caught up from the ledger, and the ledger tracks what the server holds.
// Separate file from engine.test.ts because these tests need to control the
// lock state before start() is ever called on the singleton.

import { describe, it, expect, beforeAll, vi } from 'vitest';

const lockState = vi.hoisted(() => ({ unlocked: false }));

vi.mock('../crypto', () => ({
  isUnlocked: () => lockState.unlocked,
  getMasterKey: () => ({}) as CryptoKey,
  encryptJSON: async (_key: unknown, obj: unknown) => ({
    iv: new Uint8Array([1]),
    ciphertext: new TextEncoder().encode(JSON.stringify(obj)),
  }),
  decryptJSON: async (_key: unknown, sealed: { ciphertext: Uint8Array }) =>
    JSON.parse(new TextDecoder().decode(sealed.ciphertext)),
}));

const { pushRecords, pullRecords } = vi.hoisted(() => ({
  pushRecords: vi.fn(async (records: unknown[]): Promise<void> => {
    void records;
  }),
  pullRecords: vi.fn(
    async (): Promise<{ records: unknown[]; cursor: string | null; hasMore: boolean }> => ({
      records: [],
      cursor: null,
      hasMore: false,
    })
  ),
}));

vi.mock('./syncApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./syncApi')>();
  return { ...actual, pushRecords, pullRecords };
});

import type { PushRecord, PullRecord } from './syncApi';
import { syncEngine, type SyncStatus } from './engine';
import { db, bulkPutConversations } from '../db';
import type { StoredConversation } from '../../types';
import type { InvestigationCase } from '../../types/investigation';
import { envelopeInvestigationCase } from './serializer';

function makeConv(name: string): StoredConversation {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: crypto.randomUUID(),
    source: 'claude-code',
    name,
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

function pushed(): PushRecord[] {
  return pushRecords.mock.calls.flatMap((call) => call[0] as PushRecord[]);
}

// Written before the engine attaches at all: stands in for rows from an older
// build or a signed-out period that no hook ever saw.
const preexisting = makeConv('written before attach');
const alreadySynced = makeConv('already on the server');
const madeWhileLocked = makeConv('made while locked');
const deletedWhileLocked = makeConv('deleted while locked');

beforeAll(async () => {
  await bulkPutConversations([preexisting, alreadySynced, deletedWhileLocked]);
  await db.syncLedger.bulkPut([
    { kind: 'conversation', id: alreadySynced.id, syncedAt: new Date() },
    { kind: 'conversation', id: deletedWhileLocked.id, syncedAt: new Date() },
  ]);
});

describe('sync lifecycle across lock and unlock', () => {
  it('queues changes made while locked without pushing anything', async () => {
    await syncEngine.attach();

    await bulkPutConversations([madeWhileLocked]);
    await db.conversations.delete(deletedWhileLocked.id);

    await syncEngine.tick(); // refused: vault locked
    expect(pushRecords).not.toHaveBeenCalled();
    expect(syncEngine.getStatus()).toMatchObject({ running: false });
    expect(syncEngine.getStatus().pending).toBeGreaterThanOrEqual(2);
  });

  it('on unlock uploads the locked-period changes, a tombstone, and unledgered rows', async () => {
    const seen: SyncStatus[] = [];
    const off = syncEngine.subscribe((s) => seen.push(s));

    lockState.unlocked = true;
    await syncEngine.start(2 ** 31 - 1);
    await syncEngine.tick();
    off();

    const byId = new Map(pushed().map((r) => [r.id, r]));
    expect(byId.get(madeWhileLocked.id)?.deleted).toBe(false);
    expect(byId.get(deletedWhileLocked.id)?.deleted).toBe(true);
    // Reconcile caught the row no hook ever saw...
    expect(byId.get(preexisting.id)?.deleted).toBe(false);
    // ...and skipped the one the ledger says the server already holds.
    expect(byId.has(alreadySynced.id)).toBe(false);

    const last = seen[seen.length - 1];
    expect(last).toMatchObject({ running: true, syncing: false, pending: 0, lastError: null });
    expect(last.lastSyncAt).toBeInstanceOf(Date);
  });

  it('records pushes in the ledger and forgets tombstones', async () => {
    expect(await db.syncLedger.get(['conversation', madeWhileLocked.id])).toBeDefined();
    expect(await db.syncLedger.get(['conversation', preexisting.id])).toBeDefined();
    expect(await db.syncLedger.get(['conversation', deletedWhileLocked.id])).toBeUndefined();
  });

  it('records pulled records in the ledger', async () => {
    const remote = makeConv('from another device');
    pullRecords.mockResolvedValueOnce({
      records: [
        {
          id: remote.id,
          kind: 'conversation',
          parentId: null,
          iv: btoa('\x01'),
          ciphertext: btoa(JSON.stringify({ ...remote })),
          updatedAt: new Date().toISOString(),
          deleted: false,
        } as PullRecord,
      ],
      cursor: null,
      hasMore: false,
    });
    await syncEngine.tick();
    expect(await db.syncLedger.get(['conversation', remote.id])).toBeDefined();
  });

  it('a second reconcile finds nothing new', async () => {
    expect(await syncEngine.reconcile()).toBe(0);
  });

  it('surfaces a failed push in the status and keeps the change queued', async () => {
    pushRecords.mockRejectedValueOnce(new Error('Sync push failed: 401'));
    await bulkPutConversations([makeConv('will fail once')]);
    await syncEngine.tick();
    expect(syncEngine.getStatus()).toMatchObject({ lastError: 'Sync push failed: 401', pending: 1 });

    await syncEngine.tick();
    expect(syncEngine.getStatus()).toMatchObject({ lastError: null, pending: 0 });
  });

  it('stop() keeps recording changes for the next start', async () => {
    syncEngine.stop();
    lockState.unlocked = false;
    pushRecords.mockClear();
    const later = makeConv('after lock');
    await bulkPutConversations([later]);
    expect(syncEngine.getStatus()).toMatchObject({ running: false, pending: 1 });

    lockState.unlocked = true;
    await syncEngine.start(2 ** 31 - 1);
    await syncEngine.tick();
    expect(pushed().map((r) => r.id)).toContain(later.id);
    syncEngine.stop();
  });

  it('sends a question case with no conversation as parentId null, not "" (server 400s the batch)', async () => {
    const now = new Date('2026-10-18T10:30:16Z');
    const questionCase = {
      id: crypto.randomUUID(),
      projectId: 'p1',
      conversationId: '',
      research: true,
      researchSourceIds: [],
      linkedAnchorStableKeys: [],
      kind: 'question',
      title: 'How did organizing it create relationships?',
      notes: '',
      state: 'open',
      searchRecords: [],
      createdAt: now,
      updatedAt: now,
    } as unknown as InvestigationCase;
    expect(envelopeInvestigationCase(questionCase).parentId).toBeNull();

    lockState.unlocked = true;
    await syncEngine.start(2 ** 31 - 1);
    await syncEngine.tick(); // let start()'s own tick finish first
    pushRecords.mockClear();
    await db.investigationCases.put(questionCase);
    await syncEngine.tick();
    const rec = pushed().find((r) => r.id === questionCase.id);
    expect(rec?.parentId).toBeNull();
    syncEngine.stop();
  });
});

// Timing (docs/changes/reliable-sync "Sync timing"): uploads follow local
// writes, polling is slow and pauses in a hidden tab.
describe('sync timing', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('uploads a local write shortly after it, without polling', async () => {
    lockState.unlocked = true;
    await syncEngine.start(2 ** 31 - 1, 20);
    await syncEngine.tick();
    pushRecords.mockClear();
    pullRecords.mockClear();

    const conv = makeConv('debounced');
    await bulkPutConversations([conv]);
    expect(pushRecords).not.toHaveBeenCalled(); // debounced, not synchronous
    await wait(150);
    expect(pushed().map((r) => r.id)).toContain(conv.id);
    expect(pullRecords).not.toHaveBeenCalled();
    expect(syncEngine.getStatus().pending).toBe(0);
    syncEngine.stop();
  });

  it('does not upload after stop()', async () => {
    lockState.unlocked = true;
    await syncEngine.start(2 ** 31 - 1, 20);
    await syncEngine.tick();
    syncEngine.stop();
    pushRecords.mockClear();
    await bulkPutConversations([makeConv('while stopped')]);
    await wait(100);
    expect(pushRecords).not.toHaveBeenCalled();
    expect(syncEngine.getStatus().pending).toBe(1);
  });

  it('skips polls while the tab is hidden, uploads on hide, and catches up on return', async () => {
    lockState.unlocked = true;
    await syncEngine.start(30, 2 ** 31 - 1);
    await syncEngine.tick(); // also uploads the change queued while stopped
    pushRecords.mockClear();
    pullRecords.mockClear();

    await bulkPutConversations([makeConv('queued before hide')]);
    setHidden(true); // leaving the tab flushes immediately
    await wait(120); // several poll intervals pass
    expect(pushRecords).toHaveBeenCalledTimes(1);
    expect(pullRecords).not.toHaveBeenCalled();

    setHidden(false); // back on the tab: pull right away
    await wait(10);
    expect(pullRecords).toHaveBeenCalled();
    syncEngine.stop();
  });
});
