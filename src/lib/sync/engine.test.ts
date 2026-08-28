// Sync engine coordination tests. Crypto and the network layer are mocked;
// Dexie runs on fake-indexeddb. The engine is a singleton and Dexie hooks
// have no unsubscribe, so start() is called once and tests run sequentially
// against the same instance.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../crypto', () => ({
  isUnlocked: () => true,
  getMasterKey: () => ({}) as CryptoKey,
  encryptJSON: async (_key: unknown, obj: unknown) => ({
    iv: new Uint8Array([1]),
    ciphertext: new TextEncoder().encode(JSON.stringify(obj)),
  }),
  decryptJSON: async (_key: unknown, sealed: { ciphertext: Uint8Array }) =>
    JSON.parse(new TextDecoder().decode(sealed.ciphertext)),
}));

const { pushRecords, pullRecords, wipeServerData } = vi.hoisted(() => ({
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
  wipeServerData: vi.fn(async (): Promise<void> => {}),
}));

vi.mock('./syncApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./syncApi')>();
  return { ...actual, pushRecords, pullRecords, wipeServerData };
});

import type { PushRecord, PullRecord } from './syncApi';
import { syncEngine } from './engine';
import { db, setMetadata, getMetadata, bulkPutConversations, bulkPutMessages } from '../db';
import type { StoredConversation, StoredMessage } from '../../types';

function makeConv(overrides: Partial<StoredConversation> = {}): StoredConversation {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: crypto.randomUUID(),
    source: 'claude-code',
    name: 'conv',
    summary: null,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    estimatedTokens: 0,
    fullText: '',
    ...overrides,
  };
}

function makeMsg(conversationId: string): StoredMessage {
  return {
    id: crypto.randomUUID(),
    conversationId,
    sender: 'user',
    text: 'hi',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  } as StoredMessage;
}

function pushedRecords(): PushRecord[] {
  return pushRecords.mock.calls.flatMap((call) => call[0] as PushRecord[]);
}

function pushedIds(): string[] {
  return pushedRecords().map((r) => r.id);
}

beforeAll(async () => {
  // Huge interval: ticks only happen when tests invoke them.
  await syncEngine.start(2 ** 31 - 1);
});

afterAll(() => {
  syncEngine.stop();
});

beforeEach(async () => {
  // Drain any pending state from the previous test, then reset mocks.
  await syncEngine.tick();
  await syncEngine.wipeLocalCursor();
  pushRecords.mockClear();
  pullRecords.mockClear();
});

describe('device-local sync state exclusion', () => {
  it('never pushes sync.* metadata, while other metadata still syncs', async () => {
    await setMetadata('sync.pullCursor', 'cursor-value');
    await setMetadata('detection.configOverrides', { loop: { n: 2 } });

    await syncEngine.tick();

    const ids = pushedIds();
    expect(ids).toContain('detection.configOverrides');
    expect(ids.filter((id) => id.startsWith('sync.'))).toEqual([]);
  });

  it('never pushes github.* metadata (device-local GitHub token — SPEC-intent-trace §8.1)', async () => {
    await setMetadata('github.token', 'github_pat_secret');
    await setMetadata('llm.apiKey.anthropic', 'sk-ant-synced');

    await syncEngine.tick();

    const ids = pushedIds();
    expect(ids).toContain('llm.apiKey.anthropic');
    expect(ids.filter((id) => id.startsWith('github.'))).toEqual([]);
    expect(JSON.stringify(pushedRecords())).not.toContain('github_pat_secret');
  });

  it('ignores incoming github.* metadata records from the server', async () => {
    await syncEngine.tick();
    pullRecords.mockResolvedValueOnce({
      records: [
        {
          id: 'github.token',
          kind: 'metadata',
          parentId: null,
          iv: btoa('\x01'),
          ciphertext: btoa(JSON.stringify({ key: 'github.token', value: 'INJECTED' })),
          updatedAt: new Date().toISOString(),
          deleted: false,
        } as PullRecord,
      ],
      cursor: null,
      hasMore: false,
    });
    await syncEngine.tick();
    expect(await getMetadata('github.token')).not.toBe('INJECTED');
  });

  it('does not loop when persisting the dirty queue (regression: metadata hook recursion)', async () => {
    // Any tracked write persists the dirty queue into metadata (sync.dirty),
    // which fires the metadata hook again. Before the fix this re-dirtied the
    // queue forever; every tick re-pushed sync.dirty.
    await setMetadata('some.synced.key', 1);
    await syncEngine.tick();
    pushRecords.mockClear();

    // Queue must now be genuinely empty: a further tick pushes nothing.
    await syncEngine.tick();
    expect(pushRecords).not.toHaveBeenCalled();
  });

  it('ignores incoming sync.* metadata records from the server', async () => {
    await setMetadata('sync.pullCursor', 'local-cursor');
    await syncEngine.tick();
    pullRecords.mockResolvedValueOnce({
      records: [
        {
          id: 'sync.pullCursor',
          kind: 'metadata',
          parentId: null,
          iv: btoa('\x01'),
          ciphertext: btoa(JSON.stringify({ key: 'sync.pullCursor', value: 'HACKED' })),
          updatedAt: new Date().toISOString(),
          deleted: false,
        } as PullRecord,
      ],
      cursor: null,
      hasMore: false,
    });

    await syncEngine.tick();

    expect(await getMetadata('sync.pullCursor')).not.toBe('HACKED');
  });
});

describe('clearLocalData', () => {
  it('clears all tables without hanging and without emitting tombstones', async () => {
    const conv = makeConv();
    await bulkPutConversations([conv]);
    await bulkPutMessages([makeMsg(conv.id), makeMsg(conv.id)]);
    await syncEngine.tick(); // flush the creation upserts
    pushRecords.mockClear();

    await syncEngine.clearLocalData();

    expect(await db.conversations.count()).toBe(0);
    expect(await db.messages.count()).toBe(0);

    await syncEngine.tick();
    expect(pushedRecords().filter((r) => r.deleted)).toEqual([]);
  });

  it('resets the pull cursor so the next pull starts from scratch', async () => {
    await setMetadata('sync.pullCursor', 'deep-cursor');
    await syncEngine.clearLocalData();
    expect(await getMetadata('sync.pullCursor')).toBeNull();
  });
});

describe('wipeServer', () => {
  it('waits out an in-flight push and drops queued entries so nothing lands post-wipe', async () => {
    // Get a flush in flight, hanging on the network.
    let releasePush!: () => void;
    pushRecords.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releasePush = resolve))
    );
    await setMetadata('some.synced.key', 'v');
    const inflightTick = syncEngine.tick();
    await new Promise((r) => setTimeout(r, 10)); // let the tick reach pushRecords

    // A deletion arrives while the push hangs: tombstone joins the queue.
    const conv = makeConv();
    await db.conversations.put(conv);
    await db.conversations.delete(conv.id);

    const wipe = syncEngine.wipeServer();
    await new Promise((r) => setTimeout(r, 30));
    // Wipe must not have run while the push was still in flight.
    expect(wipeServerData).not.toHaveBeenCalled();

    releasePush();
    await inflightTick;
    await wipe;
    expect(wipeServerData).toHaveBeenCalledTimes(1);

    // The queued tombstone was dropped: nothing pushes after the wipe.
    pushRecords.mockClear();
    await syncEngine.tick();
    expect(pushedRecords().filter((r) => r.deleted)).toEqual([]);
  });
});

describe('resyncAll', () => {
  it('re-pushes every local row, including rows the hooks never saw', async () => {
    const conv = makeConv();
    const msgs = [makeMsg(conv.id), makeMsg(conv.id)];
    await bulkPutConversations([conv]);
    await bulkPutMessages(msgs);
    // Simulate rows created while the engine was stopped: drop the queue.
    await syncEngine.wipeLocalCursor();
    pushRecords.mockClear();

    await syncEngine.resyncAll();

    const ids = pushedIds();
    expect(ids).toContain(conv.id);
    for (const m of msgs) expect(ids).toContain(m.id);
    expect(ids.filter((id) => id.startsWith('sync.'))).toEqual([]);
  });
});

describe('intent traces (SPEC-intent-trace §11.4)', () => {
  it('pushes local traces as intent_trace records and pulls them back', async () => {
    const traceId = crypto.randomUUID();
    await db.intentTraces.put({
      id: traceId,
      projectId: 'up-1',
      intentObjectId: 'uo-1',
      repoRef: { owner: 'Kakob', repo: 'Chatdex', commitSha: 'e'.repeat(40) },
      specStatus: 'no_spec',
      specEvidence: [],
      implStatus: 'unknown',
      implEvidence: [],
      fetchedPaths: [],
      provider: 'anthropic',
      model: 'claude-opus-5',
      warnings: [],
      createdAt: new Date('2026-08-28T10:00:00Z'),
    });
    await syncEngine.tick();
    const pushed = pushedRecords().find((r) => r.id === traceId);
    expect(pushed?.kind).toBe('intent_trace');
    expect(pushed?.parentId).toBe('uo-1');
  });

  it('deleting an understanding object from the server cascades to its traces', async () => {
    const objectId = crypto.randomUUID();
    const traceId = crypto.randomUUID();
    await db.understandingObjects.put({
      id: objectId,
      projectId: 'up-1',
      type: 'intent',
      title: 'x',
      status: 'current',
      origin: 'ai',
      reviewState: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.intentTraces.put({
      id: traceId,
      projectId: 'up-1',
      intentObjectId: objectId,
      repoRef: { owner: 'Kakob', repo: 'Chatdex', commitSha: 'f'.repeat(40) },
      specStatus: 'no_spec',
      specEvidence: [],
      implStatus: 'unknown',
      implEvidence: [],
      fetchedPaths: [],
      provider: 'anthropic',
      model: 'claude-opus-5',
      warnings: [],
      createdAt: new Date(),
    });
    await syncEngine.tick();
    pullRecords.mockResolvedValueOnce({
      records: [
        {
          id: objectId,
          kind: 'understanding_object',
          parentId: 'up-1',
          iv: btoa('\x01'),
          ciphertext: btoa('{}'),
          updatedAt: new Date(Date.now() + 60_000).toISOString(),
          deleted: true,
        } as PullRecord,
      ],
      cursor: null,
      hasMore: false,
    });
    await syncEngine.tick();
    expect(await db.understandingObjects.get(objectId)).toBeUndefined();
    expect(await db.intentTraces.get(traceId)).toBeUndefined();
  });
});
