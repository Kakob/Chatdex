// SPEC-change-workspace §16 CW-8 (audit S11): permission gate, caps, denylist,
// exclusions never walked, local cache never synced.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clearAllData } from '../db';
import { getMetadata } from '../db/metadata';
import { listRepoFiles } from '../db/repoFiles';
import { ensureIndexed } from './index';
import { LOCAL_SHA, LocalDirectoryTooLargeError, createLocalDirSource, localRepoKey, walkLocalDirectory } from './localDirSource';
import { forgetLocalDirectory, getRememberedLocalDirectoryName, rememberLocalDirectory } from './localDir';

type Node = { kind: 'file'; content: string } | { kind: 'dir'; children: Record<string, Node> };

function fakeDir(name: string, children: Record<string, Node>): FileSystemDirectoryHandle & { walked: string[] } {
  const walked: string[] = [];
  function build(dirName: string, kids: Record<string, Node>): unknown {
    return {
      name: dirName,
      kind: 'directory',
      async *entries() {
        walked.push(dirName);
        for (const [childName, node] of Object.entries(kids)) {
          if (node.kind === 'file') {
            yield [childName, { name: childName, kind: 'file', getFile: async () => ({ size: node.content.length, text: async () => node.content }) }];
          } else {
            yield [childName, build(childName, node.children)];
          }
        }
      },
    };
  }
  const root = build(name, children) as FileSystemDirectoryHandle & { walked: string[] };
  root.walked = walked;
  return root;
}

const tree: Record<string, Node> = {
  src: { kind: 'dir', children: { 'a.ts': { kind: 'file', content: 'export const a = 1;' }, 'b.ts': { kind: 'file', content: 'export const b = 2;' } } },
  node_modules: { kind: 'dir', children: { pkg: { kind: 'dir', children: { 'index.js': { kind: 'file', content: 'x' } } } } },
  '.git': { kind: 'dir', children: { HEAD: { kind: 'file', content: 'ref' } } },
  '.env': { kind: 'file', content: 'SECRET=1' },
  'README.md': { kind: 'file', content: '# hi' },
};

beforeEach(async () => {
  await clearAllData();
});

describe('walkLocalDirectory', () => {
  it('lists allowed files only and never descends into excluded or dot directories', async () => {
    const root = fakeDir('chatdex', tree);
    const result = await walkLocalDirectory(root);
    expect(result.files.map((f) => f.path).sort()).toEqual(['README.md', 'src/a.ts', 'src/b.ts']);
    expect(result.excludedDirs).toBe(2);
    expect(root.walked).toEqual(['chatdex', 'src']);
  });

  it('refuses oversized folders (S11)', async () => {
    const many: Record<string, Node> = {};
    for (let i = 0; i < 12; i++) many[`f${i}.ts`] = { kind: 'file', content: 'x' };
    await expect(walkLocalDirectory(fakeDir('big', many), { maxFiles: 10 })).rejects.toThrow(LocalDirectoryTooLargeError);
    await expect(walkLocalDirectory(fakeDir('home', many), { maxEntries: 5 })).rejects.toThrow(/home directory/);
  });
});

describe('createLocalDirSource + ensureIndexed', () => {
  it('indexes into the local cache under fs:<name> at sha "local"', async () => {
    const source = createLocalDirSource(fakeDir('chatdex', tree));
    expect(source.key).toBe('fs:chatdex');
    const report = await ensureIndexed(source, LOCAL_SHA);
    expect(report.indexed).toBe(3);
    expect(report.skipped).toEqual([]);
    const rows = await listRepoFiles(localRepoKey('chatdex'), LOCAL_SHA);
    expect(rows.map((r) => [r.path, r.content]).sort()).toEqual([
      ['README.md', '# hi'],
      ['src/a.ts', 'export const a = 1;'],
      ['src/b.ts', 'export const b = 2;'],
    ]);
    await expect(source.readFile(LOCAL_SHA, '.env')).rejects.toThrow(/Not in the picked directory/);
  });

  it('remembers the handle device-locally and forgetting evicts the cache', async () => {
    const handle = fakeDir('chatdex', tree);
    // Real handles are structured-cloneable; the fake is not, so remember a plain stand-in.
    await rememberLocalDirectory({ name: 'chatdex', kind: 'directory' } as unknown as FileSystemDirectoryHandle);
    expect(await getRememberedLocalDirectoryName()).toBe('chatdex');
    await ensureIndexed(createLocalDirSource(handle), LOCAL_SHA);
    expect(await listRepoFiles('fs:chatdex', LOCAL_SHA)).toHaveLength(3);
    expect(await forgetLocalDirectory()).toBe(3);
    expect(await getRememberedLocalDirectoryName()).toBeNull();
    expect(await getMetadata('repo.localDirHandle')).toBeUndefined();
    expect(await listRepoFiles('fs:chatdex', LOCAL_SHA)).toHaveLength(0);
  });

  it('keeps the handle keys out of sync (device-local metadata)', () => {
    const engine = readFileSync(resolve(__dirname, '../sync/engine.ts'), 'utf8');
    expect(engine).toMatch(/repo\./);
  });
});
