import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GITHUB_API_BASE,
  MAX_FILE_BYTES,
  GitHubError,
  GitHubRateLimitError,
  parseRepoInput,
  assertRepoName,
  encodeRepoPath,
  getRepo,
  resolveRef,
  getTree,
  getFileContent,
  listCommits,
  getTokenInfo,
  blobUrl,
  isGitHubWebUrl,
  clearGitHubCaches,
  getLastRateLimit,
} from './client';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fetchWith(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
}

const SHA = 'a'.repeat(40);

beforeEach(() => {
  calls.length = 0;
  clearGitHubCaches();
});

describe('parseRepoInput', () => {
  it('accepts owner/repo, github.com URLs, and git remotes', () => {
    expect(parseRepoInput('Kakob/Chatdex')).toEqual({ owner: 'Kakob', repo: 'Chatdex' });
    expect(parseRepoInput('https://github.com/Kakob/Chatdex')).toEqual({ owner: 'Kakob', repo: 'Chatdex' });
    expect(parseRepoInput('https://github.com/Kakob/Chatdex.git')).toEqual({ owner: 'Kakob', repo: 'Chatdex' });
    expect(parseRepoInput('https://github.com/Kakob/Chatdex/tree/main/src')).toEqual({ owner: 'Kakob', repo: 'Chatdex' });
    expect(parseRepoInput('git@github.com:Kakob/Chatdex.git')).toEqual({ owner: 'Kakob', repo: 'Chatdex' });
    expect(parseRepoInput('  Kakob/Chatdex/  ')).toEqual({ owner: 'Kakob', repo: 'Chatdex' });
  });
  it('rejects junk and traversal', () => {
    expect(parseRepoInput('Chatdex')).toBeNull();
    expect(parseRepoInput('../evil/repo')).toBeNull();
    expect(parseRepoInput('https://evil.example/Kakob/Chatdex')).toBeNull();
    expect(parseRepoInput('Kakob/Chat dex')).toBeNull();
  });
});

describe('validation helpers', () => {
  it('assertRepoName rejects unsafe names', () => {
    expect(() => assertRepoName('a b', 'c')).toThrow(/Invalid repository/);
    expect(() => assertRepoName('..', 'c')).toThrow(/Invalid repository/);
    expect(() => assertRepoName('ok-name', 'ok.repo_1')).not.toThrow();
  });
  it('encodeRepoPath encodes segments and rejects traversal/empties', () => {
    expect(encodeRepoPath('src/a b/#x.ts')).toBe('src/a%20b/%23x.ts');
    expect(() => encodeRepoPath('src/../.env')).toThrow(/Invalid repository path/);
    expect(() => encodeRepoPath('src//a.ts')).toThrow(/Invalid repository path/);
    expect(() => encodeRepoPath('./a.ts')).toThrow(/Invalid repository path/);
  });
});

describe('transport', () => {
  it('hits the constant API host with the right headers and the token only in Authorization', async () => {
    const fetchImpl = fetchWith(() => jsonResponse({ default_branch: 'main', private: true, html_url: 'https://github.com/Kakob/Chatdex', permissions: { push: false } }));
    const info = await getRepo('Kakob', 'Chatdex', { token: 'ghp_secret', fetchImpl });
    expect(info).toEqual({ defaultBranch: 'main', isPrivate: true, htmlUrl: 'https://github.com/Kakob/Chatdex', canPush: false });
    expect(calls[0].url).toBe(`${GITHUB_API_BASE}/repos/Kakob/Chatdex`);
    expect(calls[0].url).not.toContain('ghp_secret');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghp_secret');
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(calls[0].init.method).toBe('GET');
  });

  it('omits Authorization without a token', async () => {
    const fetchImpl = fetchWith(() => jsonResponse({ default_branch: 'main', private: false, html_url: 'x' }));
    await getRepo('Kakob', 'Chatdex', { fetchImpl });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('raises content-free errors (no response body echoed)', async () => {
    const fetchImpl = fetchWith(() => jsonResponse({ message: 'Bad credentials SECRET-DETAIL' }, 401));
    await expect(getRepo('Kakob', 'Chatdex', { fetchImpl })).rejects.toSatisfy((e: unknown) => {
      return e instanceof GitHubError && e.status === 401 && !e.message.includes('SECRET-DETAIL');
    });
  });

  it('raises GitHubRateLimitError with resetAt on 403 remaining=0 and on 429', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const fetchImpl = fetchWith(() => jsonResponse({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }));
    await expect(getRepo('Kakob', 'Chatdex', { fetchImpl })).rejects.toSatisfy(
      (e: unknown) => e instanceof GitHubRateLimitError && e.resetAt?.getTime() === reset * 1000
    );
    expect(getLastRateLimit().remaining).toBe(0);
    const fetch429 = fetchWith(() => jsonResponse({}, 429));
    await expect(getRepo('Kakob', 'Chatdex', { fetchImpl: fetch429 })).rejects.toBeInstanceOf(GitHubRateLimitError);
  });

  it('a 403 with remaining budget is a plain GitHubError', async () => {
    const fetchImpl = fetchWith(() => jsonResponse({}, 403, { 'x-ratelimit-remaining': '42' }));
    await expect(getRepo('Kakob', 'Chatdex', { fetchImpl })).rejects.toSatisfy(
      (e: unknown) => e instanceof GitHubError && !(e instanceof GitHubRateLimitError)
    );
  });
});

describe('resolveRef / getTree / getFileContent', () => {
  it('resolves a ref to a validated sha', async () => {
    const fetchImpl = fetchWith(() => jsonResponse({ sha: SHA }));
    expect(await resolveRef('Kakob', 'Chatdex', 'main', { fetchImpl })).toEqual({ sha: SHA });
    expect(calls[0].url).toBe(`${GITHUB_API_BASE}/repos/Kakob/Chatdex/commits/main`);
    await expect(resolveRef('Kakob', 'Chatdex', '../x', { fetchImpl })).rejects.toThrow(/Invalid ref/);
  });

  it('fetches the recursive tree once per sha (cached) and drops non-blob/tree entries', async () => {
    const fetchImpl = fetchWith(() =>
      jsonResponse({
        truncated: false,
        tree: [
          { path: 'src', type: 'tree', sha: 't1' },
          { path: 'src/a.ts', type: 'blob', size: 10, sha: 'b1' },
          { path: 'sub', type: 'commit', sha: 'c1' },
        ],
      })
    );
    const first = await getTree('Kakob', 'Chatdex', SHA, { fetchImpl });
    const second = await getTree('Kakob', 'Chatdex', SHA, { fetchImpl });
    expect(first).toBe(second);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GITHUB_API_BASE}/repos/Kakob/Chatdex/git/trees/${SHA}?recursive=1`);
    expect(first.entries).toEqual([
      { path: 'src', type: 'tree', sha: 't1' },
      { path: 'src/a.ts', type: 'blob', size: 10, sha: 'b1' },
    ]);
    await expect(getTree('Kakob', 'Chatdex', 'not-a-sha', { fetchImpl })).rejects.toThrow(/Invalid commit sha/);
  });

  it('decodes base64 UTF-8 content at the pinned sha, caches, and enforces the size cap', async () => {
    const text = 'export const héllo = "wörld";\n';
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    const fetchImpl = fetchWith(() =>
      jsonResponse({ type: 'file', size: text.length, sha: 'b1', encoding: 'base64', content: b64.slice(0, 10) + '\n' + b64.slice(10) })
    );
    const file = await getFileContent('Kakob', 'Chatdex', 'src/a b.ts', SHA, { fetchImpl });
    expect(file.text).toBe(text);
    expect(calls[0].url).toBe(`${GITHUB_API_BASE}/repos/Kakob/Chatdex/contents/src/a%20b.ts?ref=${SHA}`);
    await getFileContent('Kakob', 'Chatdex', 'src/a b.ts', SHA, { fetchImpl });
    expect(calls).toHaveLength(1);

    const big = fetchWith(() => jsonResponse({ type: 'file', size: MAX_FILE_BYTES + 1, sha: 'b2', encoding: 'base64', content: '' }));
    await expect(getFileContent('Kakob', 'Chatdex', 'big.bin', SHA, { fetchImpl: big })).rejects.toThrow(/too large/);
    const dir = fetchWith(() => jsonResponse([{ type: 'dir' }]));
    await expect(getFileContent('Kakob', 'Chatdex', 'src', SHA, { fetchImpl: dir })).rejects.toThrow(/not a file/);
    await expect(getFileContent('Kakob', 'Chatdex', '../.env', SHA, { fetchImpl })).rejects.toThrow(/Invalid repository path/);
  });
});

describe('listCommits', () => {
  it('passes path/since/sha and maps the payload', async () => {
    const fetchImpl = fetchWith(() =>
      jsonResponse([
        { sha: 'c'.repeat(40), html_url: 'https://github.com/Kakob/Chatdex/commit/c', commit: { message: 'feat: badge', author: { date: '2026-08-27T09:00:00Z' } } },
      ])
    );
    const since = new Date('2026-08-20T00:00:00Z');
    const commits = await listCommits('Kakob', 'Chatdex', { path: 'src/Sidebar.tsx', since, sha: SHA, perPage: 5 }, { fetchImpl });
    expect(commits).toEqual([
      { sha: 'c'.repeat(40), message: 'feat: badge', authoredAt: new Date('2026-08-27T09:00:00Z'), htmlUrl: 'https://github.com/Kakob/Chatdex/commit/c' },
    ]);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('path')).toBe('src/Sidebar.tsx');
    expect(url.searchParams.get('since')).toBe(since.toISOString());
    expect(url.searchParams.get('sha')).toBe(SHA);
    expect(url.searchParams.get('per_page')).toBe('5');
  });
});

describe('getTokenInfo', () => {
  it('flags classic tokens with write scopes and accepts fine-grained tokens', async () => {
    const classic = fetchWith(() => jsonResponse({ login: 'Kakob' }, 200, { 'x-oauth-scopes': 'repo, read:org' }));
    expect(await getTokenInfo({ token: 't', fetchImpl: classic })).toEqual({ login: 'Kakob', scopes: ['repo', 'read:org'], overPrivileged: true });
    const fine = fetchWith(() => jsonResponse({ login: 'Kakob' }));
    expect(await getTokenInfo({ token: 't', fetchImpl: fine })).toEqual({ login: 'Kakob', scopes: [], overPrivileged: false });
    const readOnly = fetchWith(() => jsonResponse({ login: 'Kakob' }, 200, { 'x-oauth-scopes': 'read:user, public_repo' }));
    expect((await getTokenInfo({ token: 't', fetchImpl: readOnly })).overPrivileged).toBe(false);
    await expect(getTokenInfo({ fetchImpl: fine })).rejects.toThrow(/No token/);
  });
});

describe('links', () => {
  it('builds validated blob URLs with optional line anchors', () => {
    expect(blobUrl('Kakob', 'Chatdex', SHA, 'src/a b.ts')).toBe(`https://github.com/Kakob/Chatdex/blob/${SHA}/src/a%20b.ts`);
    expect(blobUrl('Kakob', 'Chatdex', SHA, 'src/a.ts', 10)).toMatch(/#L10$/);
    expect(blobUrl('Kakob', 'Chatdex', SHA, 'src/a.ts', 10, 20)).toMatch(/#L10-L20$/);
    expect(blobUrl('Kakob', 'Chatdex', SHA, 'src/a.ts', 10, 10)).toMatch(/#L10$/);
    expect(() => blobUrl('evil host', 'x', SHA, 'a')).toThrow();
    expect(() => blobUrl('Kakob', 'Chatdex', 'zzz', 'a')).toThrow();
    expect(() => blobUrl('Kakob', 'Chatdex', SHA, '../a')).toThrow();
  });
  it('isGitHubWebUrl allowlists github.com only', () => {
    expect(isGitHubWebUrl('https://github.com/Kakob/Chatdex/commit/abc')).toBe(true);
    expect(isGitHubWebUrl('https://github.com.evil.example/x')).toBe(false);
    expect(isGitHubWebUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('module surface (read-only law §2.4)', () => {
  it('never issues anything but GET', async () => {
    const fetchImpl = fetchWith(() => jsonResponse({ sha: SHA, default_branch: 'main', tree: [], login: 'x', type: 'file', size: 1, encoding: 'base64', content: 'YQ==' }));
    await getRepo('Kakob', 'Chatdex', { fetchImpl });
    await resolveRef('Kakob', 'Chatdex', 'main', { fetchImpl });
    await getTree('Kakob', 'Chatdex', SHA, { fetchImpl });
    await getFileContent('Kakob', 'Chatdex', 'a', SHA, { fetchImpl });
    await getTokenInfo({ token: 't', fetchImpl });
    expect(calls.every((c) => c.init.method === 'GET')).toBe(true);
    expect(vi.isMockFunction(fetch)).toBe(false); // sanity: global fetch untouched by this suite
  });
});
