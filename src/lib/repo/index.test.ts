// SPEC-change-workspace §9 indexer + GitHub source (§16 CW-1; audit S1, S4).
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '../db';
import { listRepoFiles } from '../db/repoFiles';
import { GitHubRateLimitError, MAX_FILE_BYTES, clearGitHubCaches } from '../github/client';
import { createGitHubSource } from './githubSource';
import { describeSkips, ensureIndexed, planIndex } from './index';
import type { RepoSource, SourceFile } from './sources';

const sha = 'a'.repeat(40);

function fakeSource(
  files: Record<string, string>,
  behaviour: { rateLimitOn?: string; errorOn?: string; truncated?: boolean } = {}
): RepoSource & { reads: string[] } {
  const reads: string[] = [];
  return {
    key: 'gh:Kakob/Chatdex',
    label: 'Kakob/Chatdex',
    reads,
    async listFiles() {
      return {
        truncated: Boolean(behaviour.truncated),
        files: Object.entries(files).map(([path, content]): SourceFile => ({ path, size: content.length })),
      };
    },
    async readFile(_sha, path) {
      reads.push(path);
      if (path === behaviour.rateLimitOn) throw new GitHubRateLimitError(403, new Date('2026-08-28T12:00:00Z'));
      if (path === behaviour.errorOn) throw new Error('boom');
      return { text: files[path], size: files[path].length };
    },
  };
}

beforeEach(async () => {
  await clearAllData();
  clearGitHubCaches();
});

describe('planIndex', () => {
  it('drops sensitive and excluded paths before anything is fetched, then applies caps', () => {
    const files: SourceFile[] = [
      { path: '.env', size: 10 },
      { path: 'node_modules/x/index.js', size: 10 },
      { path: 'src/a.ts', size: 10 },
      { path: 'src/big.ts', size: MAX_FILE_BYTES + 1 },
      { path: 'src/b.ts', size: 10 },
      { path: 'src/c.ts', size: 10 },
    ];
    const plan = planIndex(files, new Set(['src/b.ts']), { maxFiles: 2 });
    expect(plan.toFetch.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(plan.kept).toEqual(['src/b.ts']);
    expect(plan.skipped).toEqual([
      { path: '.env', reason: 'sensitive' },
      { path: 'node_modules/x/index.js', reason: 'excluded' },
      { path: 'src/big.ts', reason: 'size' },
      { path: 'src/c.ts', reason: 'file_cap' },
    ]);
    expect(planIndex([{ path: 'a', size: 30 }, { path: 'b', size: 30 }], new Set(), { maxBytes: 40 }).skipped).toEqual([
      { path: 'b', reason: 'byte_cap' },
    ]);
    expect(describeSkips(plan.skipped)).toBe('1 sensitive, 1 excluded, 1 too large, 1 over file cap');
  });
});

describe('ensureIndexed', () => {
  it('caches allowed files, never touches denied paths, and resumes without refetching', async () => {
    const source = fakeSource({
      'src/a.ts': 'export const a = 1;',
      'src/b.ts': 'export const b = 2;',
      '.env': 'SECRET=1',
      'dist/bundle.js': 'x',
    });
    const progress: number[] = [];
    const report = await ensureIndexed(source, sha, { onProgress: (p) => progress.push(p.done) });
    expect(report).toMatchObject({ fetched: 2, alreadyCached: 0, indexed: 2, truncated: false, stopped: false });
    expect(report.skipped.map((s) => s.path).sort()).toEqual(['.env', 'dist/bundle.js']);
    expect(source.reads.sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(progress).toEqual([0, 2]);
    expect((await listRepoFiles('gh:Kakob/Chatdex', sha)).map((r) => r.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);

    source.reads.length = 0;
    const again = await ensureIndexed(source, sha);
    expect(again).toMatchObject({ fetched: 0, alreadyCached: 2, indexed: 2 });
    expect(source.reads).toEqual([]);
  });

  it('stops on a rate limit after saving the batch, reporting when to retry', async () => {
    const source = fakeSource(
      { 'src/a.ts': 'a', 'src/b.ts': 'b', 'src/c.ts': 'c' },
      { rateLimitOn: 'src/b.ts' }
    );
    const report = await ensureIndexed(source, sha, { batchSize: 2 });
    expect(report.rateLimitedUntil).toEqual(new Date('2026-08-28T12:00:00Z'));
    expect(report.fetched).toBe(1);
    expect(source.reads).toEqual(['src/a.ts', 'src/b.ts']);
    expect((await listRepoFiles('gh:Kakob/Chatdex', sha)).map((r) => r.path)).toEqual(['src/a.ts']);
  });

  it('records unreadable files as skipped and honours shouldStop between batches', async () => {
    const source = fakeSource({ 'src/a.ts': 'a', 'src/b.ts': 'b', 'src/c.ts': 'c' }, { errorOn: 'src/a.ts' });
    let batches = 0;
    const report = await ensureIndexed(source, sha, { batchSize: 1, shouldStop: () => batches++ >= 2 });
    expect(report.stopped).toBe(true);
    expect(report.skipped).toEqual([{ path: 'src/a.ts', reason: 'error' }]);
    expect(report.fetched).toBe(1);
  });
});

describe('createGitHubSource', () => {
  it('lists blobs from the tree and decodes file contents through the read-only client', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/git/trees/')) {
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              { path: 'src', type: 'tree', sha: 't' },
              { path: 'src/a.ts', type: 'blob', size: 11, sha: 'b1' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('/contents/')) {
        return new Response(
          JSON.stringify({ type: 'file', size: 11, sha: 'b1', encoding: 'base64', content: btoa('const a=1;\n') }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const source = createGitHubSource('Kakob', 'Chatdex', { token: 'ghp_test', fetchImpl });
    expect(source.key).toBe('gh:Kakob/Chatdex');
    const listing = await source.listFiles(sha);
    expect(listing).toEqual({ truncated: false, files: [{ path: 'src/a.ts', size: 11 }] });
    expect(await source.readFile(sha, 'src/a.ts')).toEqual({ text: 'const a=1;\n', size: 11 });
    expect(calls.every((u) => u.startsWith('https://api.github.com/'))).toBe(true);
  });
});
