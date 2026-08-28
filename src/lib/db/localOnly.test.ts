// SPEC-change-workspace §7.2 / audit S1, S12: `repoFiles` and `inspections`
// are Dexie v12 LOCAL-ONLY tables — present, cleared by clearAllData, and
// never wired into the sync engine.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from './schema';
import { clearAllData } from './index';
import {
  clearRepoFileCache,
  countRepoFiles,
  evictRepo,
  evictRepoSnapshot,
  getRepoFile,
  listRepoFiles,
  putRepoFiles,
} from './repoFiles';
import {
  clearInspectionsForProject,
  listInspectionsForTarget,
  listInspectionsForWorkspace,
  recordInspection,
  summarizeInspections,
} from './inspections';

beforeEach(async () => {
  await clearAllData();
});

const sha = 'a'.repeat(40);

describe('Dexie v12 local-only tables', () => {
  it('is at schema version 12', () => {
    expect(db.verno).toBe(12);
    expect(db.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['repoFiles', 'inspections'])
    );
  });

  it('caches, lists, and evicts repository files per (repoKey, sha)', async () => {
    const fetchedAt = new Date('2026-08-28T10:00:00Z');
    await putRepoFiles([
      { repoKey: 'gh:Kakob/Chatdex', sha, path: 'src/a.ts', size: 5, content: 'a=1;\n', fetchedAt },
      { repoKey: 'gh:Kakob/Chatdex', sha, path: 'src/b.ts', size: 5, content: 'b=2;\n', fetchedAt },
      { repoKey: 'gh:Kakob/Chatdex', sha: 'b'.repeat(40), path: 'src/a.ts', size: 5, content: 'a=2;\n', fetchedAt },
      { repoKey: 'gh:other/repo', sha, path: 'x.ts', size: 1, content: 'x', fetchedAt },
    ]);
    expect((await getRepoFile('gh:Kakob/Chatdex', sha, 'src/a.ts'))?.content).toBe('a=1;\n');
    expect((await listRepoFiles('gh:Kakob/Chatdex', sha)).map((r) => r.path).sort()).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
    expect(await countRepoFiles('gh:Kakob/Chatdex', sha)).toBe(2);

    expect(await evictRepoSnapshot('gh:Kakob/Chatdex', sha)).toBe(2);
    expect(await countRepoFiles('gh:Kakob/Chatdex', sha)).toBe(0);
    expect(await countRepoFiles('gh:Kakob/Chatdex', 'b'.repeat(40))).toBe(1);

    expect(await evictRepo('gh:Kakob/Chatdex')).toBe(1);
    expect(await db.repoFiles.count()).toBe(1);
    await clearRepoFileCache();
    expect(await db.repoFiles.count()).toBe(0);
  });

  it('records inspections and summarizes them per target', async () => {
    await recordInspection({ projectId: 'p1', workspaceId: 'w1', kind: 'file', targetKey: 'src/a.ts', at: new Date('2026-08-28T10:00:00Z') });
    await recordInspection({ projectId: 'p1', workspaceId: 'w1', kind: 'file', targetKey: 'src/a.ts', at: new Date('2026-08-28T11:00:00Z') });
    await recordInspection({ projectId: 'p1', workspaceId: 'w2', kind: 'node', targetKey: 'n1', at: new Date('2026-08-28T09:00:00Z') });
    await recordInspection({ projectId: 'p2', kind: 'file', targetKey: 'src/a.ts' });

    expect((await listInspectionsForWorkspace('w1')).map((r) => r.at.toISOString())).toEqual([
      '2026-08-28T10:00:00.000Z',
      '2026-08-28T11:00:00.000Z',
    ]);
    expect(await listInspectionsForTarget('p1', 'src/a.ts')).toHaveLength(2);
    const summary = await summarizeInspections('p1');
    expect(summary).toEqual([
      { targetKey: 'src/a.ts', kind: 'file', count: 2, lastAt: new Date('2026-08-28T11:00:00Z') },
      { targetKey: 'n1', kind: 'node', count: 1, lastAt: new Date('2026-08-28T09:00:00Z') },
    ]);
    expect(await clearInspectionsForProject('p1')).toBe(3);
    expect(await db.inspections.count()).toBe(1);
  });

  it('clearAllData empties both tables', async () => {
    await putRepoFiles([{ repoKey: 'gh:x/y', sha, path: 'a', size: 1, content: 'a', fetchedAt: new Date() }]);
    await recordInspection({ projectId: 'p1', kind: 'file', targetKey: 'a' });
    await clearAllData();
    expect(await db.repoFiles.count()).toBe(0);
    expect(await db.inspections.count()).toBe(0);
  });

  it('is never referenced by the sync engine or serializer (audit S1 / S12)', () => {
    for (const file of ['engine.ts', 'serializer.ts', 'syncApi.ts']) {
      const text = readFileSync(resolve(__dirname, '../sync', file), 'utf8');
      expect(text, `${file} must not touch local-only tables`).not.toMatch(/repoFiles|inspections/);
    }
  });
});
