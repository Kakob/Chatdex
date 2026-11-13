import { afterAll, expect, it, vi } from 'vitest';
import type { PullRecord, PushRecord } from './syncApi';

const server = vi.hoisted(() => new Map<string, PullRecord>());
vi.mock('./syncApi', () => ({
  pushRecords: vi.fn(async (records: PushRecord[]) => {
    for (const record of records) {
      server.set(`${record.kind}:${record.id}`, { ...record, deleted: record.deleted ?? false });
    }
    return { accepted: records.length, serverTime: new Date().toISOString() };
  }),
  pullRecords: vi.fn(async () => ({ records: [...server.values()], cursor: null, hasMore: false })),
}));

import { syncEngine } from './engine';
import { db } from '../db';
import { createHumanProject } from '../db/understanding';
import { generateMasterKey, lock, setUnlocked } from '../crypto';

afterAll(() => {
  syncEngine.stop();
  lock();
});

it('uploads a desktop project as ciphertext and restores it into an empty device with the same account key', async () => {
  const masterKey = await generateMasterKey();
  setUnlocked('shared-account', masterKey);
  // Also covers a local project created before sync was enabled.
  const project = await createHumanProject({ name: 'Private desktop project', description: 'Shared on my phone' });
  await syncEngine.start(2 ** 31 - 1);
  await syncEngine.tick();
  expect(syncEngine.getStatus().lastError).toBeNull();
  const encrypted = server.get(`understanding_project:${project.id}`);
  expect(encrypted).toBeDefined();
  expect(JSON.stringify([...server.values()])).not.toContain(project.name);
  expect(atob(encrypted!.ciphertext)).not.toContain(project.name);

  // A fresh device has no local project, cursor, dirty queue or sync ledger.
  syncEngine.stop();
  await syncEngine.clearLocalData();
  lock();
  expect(await db.understandingProjects.count()).toBe(0);

  // Login unwraps the same account key on the second device.
  setUnlocked('shared-account', masterKey);
  await syncEngine.start(2 ** 31 - 1);
  await syncEngine.tick();
  expect(syncEngine.getStatus().lastError).toBeNull();
  expect(await db.understandingProjects.toArray()).toEqual([project]);
  expect(await db.syncLedger.get(['understanding_project', project.id])).toBeDefined();
});
