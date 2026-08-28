import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearAllData } from '../../db';
import { db } from '../../db/schema';
import { bulkPutMessages } from '../../db/messages';
import { putUnderstandingProject, createUnderstandingObject } from '../../db/understanding';
import { listTracesForProject, listTracesForIntent, putIntentTrace } from '../../db/intentTraces';
import { clearGitHubCaches } from '../../github/client';
import { planTrace, runTrace } from './runTrace';
import type { StoredConversation } from '../../../types';

vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return { ...actual, complete: vi.fn() };
});
import { complete } from '../../providers';
const completeMock = vi.mocked(complete);

const SHA = 'f'.repeat(40);
const SIDEBAR = ['export function Sidebar() {', '  const pending = usePending();', '  return <Badge count={pending} />;', '}'].join('\n');
const SPEC = '# Sidebar\n\nThe badge shows the pending count.\n';

type Route = (url: URL) => { status?: number; body: unknown; headers?: Record<string, string> };

function makeFetch(routes: Route[]): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    urls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    for (const route of routes) {
      const r = route(url);
      if (r) {
        return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4999', ...(r.headers ?? {}) } });
      }
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

function b64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function repoRoutes(files: Record<string, string>, extra: Route[] = []): Route[] {
  const tree = Object.keys(files).map((path) => ({ path, type: 'blob', sha: 'b', size: files[path].length }));
  return [
    ...extra,
    (u) => (u.pathname === '/repos/Kakob/Chatdex' ? { body: { default_branch: 'main', private: false, html_url: 'https://github.com/Kakob/Chatdex' } } : (undefined as never)),
    (u) => (u.pathname === '/repos/Kakob/Chatdex/commits/main' ? { body: { sha: SHA } } : (undefined as never)),
    (u) => (u.pathname === `/repos/Kakob/Chatdex/git/trees/${SHA}` ? { body: { truncated: false, tree } } : (undefined as never)),
    (u) => {
      const m = /^\/repos\/Kakob\/Chatdex\/contents\/(.+)$/.exec(u.pathname);
      if (!m) return undefined as never;
      const path = decodeURIComponent(m[1]);
      const text = files[path];
      return text === undefined ? { status: 404, body: {} } : { body: { type: 'file', size: text.length, sha: 'b', encoding: 'base64', content: b64(text) } };
    },
    (u) => (u.pathname === '/repos/Kakob/Chatdex/commits' ? { body: [{ sha: 'c'.repeat(40), html_url: 'https://github.com/Kakob/Chatdex/commit/c', commit: { message: 'feat: badge\n\nbody', author: { date: '2026-08-25T00:00:00Z' } } }] } : (undefined as never)),
  ];
}

async function seed(opts: { withRepo?: boolean } = {}) {
  await putUnderstandingProject({
    id: 'proj-1',
    name: 'Chatdex',
    origin: 'user',
    reviewState: 'accepted',
    ...(opts.withRepo === false ? {} : { repository: { owner: 'Kakob', repo: 'Chatdex', defaultBranch: 'main' } }),
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
  });
  const conv: StoredConversation = {
    id: 'conv-1', source: 'claude-code', name: 'Badge work', summary: null,
    createdAt: new Date('2026-08-20T00:00:00Z'), updatedAt: new Date('2026-08-20T00:00:00Z'), importedAt: new Date(),
    messageCount: 2, userMessageCount: 1, assistantMessageCount: 1, estimatedTokens: 0, fullText: '',
    projectPath: '/Users/x/chatdex',
  };
  await db.conversations.put(conv);
  await bulkPutMessages([
    { id: 'm-0', conversationId: 'conv-1', sender: 'assistant', text: 'Where should the badge go?', createdAt: new Date('2026-08-20T00:00:00Z') },
    { id: 'm-1', conversationId: 'conv-1', sender: 'user', text: 'I want the badge in src/components/Sidebar.tsx', createdAt: new Date('2026-08-20T00:00:01Z') },
  ]);
  const intent = await createUnderstandingObject({
    projectId: 'proj-1',
    type: 'intent',
    title: 'Badge in the sidebar',
    body: 'I want the badge in src/components/Sidebar.tsx',
    origin: 'ai',
    evidence: [{ conversationId: 'conv-1', messageIds: ['m-0', 'm-1'] }],
    occurredAt: new Date('2026-08-20T00:00:01Z'),
    meta: { polarity: 'want', origin: 'response_to_ai', statedAt: '2026-08-20T00:00:01.000Z' },
  });
  return intent;
}

beforeEach(async () => {
  await clearAllData();
  completeMock.mockReset();
  clearGitHubCaches();
});

describe('planTrace', () => {
  it('resolves the sha, finds spec docs, selects candidates through the gate, and reports disclosure counts', async () => {
    const intent = await seed();
    const { fetchImpl } = makeFetch(repoRoutes({ 'src/components/Sidebar.tsx': SIDEBAR, 'docs/SPEC.md': SPEC, 'backend/.env': 'X=1', 'package-lock.json': '{}' }));
    const plan = await planTrace('proj-1', { provider: 'anthropic', fetchImpl, token: 'github_pat_TESTTOKEN_1234567890' });
    expect(plan.repoRef).toEqual({ owner: 'Kakob', repo: 'Chatdex', commitSha: SHA, ref: 'main' });
    expect(plan.specPaths).toEqual(['docs/SPEC.md']);
    expect(plan.intents).toHaveLength(1);
    expect(plan.intents[0].intent.id).toBe(intent.id);
    expect(plan.intents[0].candidates.map((c) => `${c.reason}:${c.path}`)).toEqual(['mentioned:src/components/Sidebar.tsx']);
    expect(plan.filePaths).toEqual(['src/components/Sidebar.tsx']);
    expect(plan.conversationIds).toEqual(['conv-1']);
    expect(plan.intents[0].statedAt).toEqual(new Date('2026-08-20T00:00:01.000Z'));
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('refuses without a repository binding and skips intents already traced at this sha', async () => {
    await seed({ withRepo: false });
    await expect(planTrace('proj-1', { provider: 'anthropic' })).rejects.toThrow(/Bind a GitHub repository/);

    await clearAllData();
    const intent = await seed();
    await putIntentTrace({
      id: 't-old', projectId: 'proj-1', intentObjectId: intent.id,
      repoRef: { owner: 'Kakob', repo: 'Chatdex', commitSha: SHA },
      specStatus: 'no_spec', specEvidence: [], implStatus: 'unknown', implEvidence: [],
      fetchedPaths: [], provider: 'anthropic', model: 'm', warnings: [], createdAt: new Date(),
    });
    const { fetchImpl } = makeFetch(repoRoutes({ 'src/a.ts': 'x' }));
    const plan = await planTrace('proj-1', { provider: 'anthropic', fetchImpl });
    expect(plan.intents).toEqual([]);
    const forced = await planTrace('proj-1', { provider: 'anthropic', fetchImpl, intentObjectIds: [intent.id] });
    expect(forced.intents).toHaveLength(1);
  });
});

describe('runTrace', () => {
  it('fetches through the gate, judges, verifies quotes with recomputed lines, adds commit evidence, persists', async () => {
    const intent = await seed();
    const { fetchImpl, urls } = makeFetch(repoRoutes({ 'src/components/Sidebar.tsx': SIDEBAR, 'docs/SPEC.md': SPEC }));
    completeMock.mockResolvedValue({
      text: JSON.stringify({
        spec: { status: 'specified', rationale: 'named', evidence: [{ path: 'docs/SPEC.md', quote: 'The badge shows the pending count.' }] },
        implementation: { status: 'implemented', rationale: 'rendered', evidence: [{ path: 'src/components/Sidebar.tsx', quote: '3:   return <Badge count={pending} />;' }], suggestedPaths: [] },
      }),
      model: 'claude-opus-5',
    });
    const config = { provider: 'anthropic' as const, fetchImpl, token: 'github_pat_TESTTOKEN_1234567890' };
    const plan = await planTrace('proj-1', config);
    const progress: Array<[number, number]> = [];
    const outcome = await runTrace('proj-1', plan, config, { onProgress: (d, t) => progress.push([d, t]) });

    expect(outcome).toMatchObject({ traced: 1, errored: 0, aborted: false });
    expect(outcome.rateLimit.remaining).toBe(4999);
    expect(progress).toEqual([[0, 1], [1, 1]]);

    const [trace] = await listTracesForIntent(intent.id);
    expect(trace.repoRef.commitSha).toBe(SHA);
    expect(trace.specStatus).toBe('specified');
    expect(trace.specEvidence[0]).toMatchObject({ path: 'docs/SPEC.md', startLine: 3 });
    expect(trace.implStatus).toBe('implemented');
    expect(trace.implEvidence[0]).toMatchObject({ path: 'src/components/Sidebar.tsx', startLine: 3, endLine: 3, quote: 'return <Badge count={pending} />;' });
    expect(trace.fetchedPaths).toEqual(['src/components/Sidebar.tsx', 'docs/SPEC.md']);
    expect(trace.model).toBe('claude-opus-5');
    expect(trace.commitEvidence).toEqual([
      { sha: 'c'.repeat(40), path: 'src/components/Sidebar.tsx', message: 'feat: badge', authoredAt: new Date('2026-08-25T00:00:00Z'), url: 'https://github.com/Kakob/Chatdex/commit/c' },
    ]);

    // The prompt carried the file as delimited data, and never the token.
    const sent = completeMock.mock.calls[0][1].messages;
    expect(sent[1].content).toContain('<file path="src/components/Sidebar.tsx">');
    expect(sent[1].content).toContain('<spec path="docs/SPEC.md">');
    expect(JSON.stringify(sent)).not.toContain('TESTTOKEN');
    // Only GETs, only api.github.com paths.
    expect(urls.every((u) => u.startsWith('GET /repos/'))).toBe(true);
  });

  it('records no_spec without a spec section when the tree has no spec docs', async () => {
    await seed();
    const { fetchImpl } = makeFetch(repoRoutes({ 'src/components/Sidebar.tsx': SIDEBAR }));
    completeMock.mockResolvedValue({ text: JSON.stringify({ implementation: { status: 'not_implemented', rationale: 'no badge' } }), model: 'm' });
    const config = { provider: 'anthropic' as const, fetchImpl, includeCommits: false };
    const plan = await planTrace('proj-1', config);
    await runTrace('proj-1', plan, config);
    const [trace] = await listTracesForProject('proj-1');
    expect(trace.specStatus).toBe('no_spec');
    expect(trace.implStatus).toBe('not_implemented');
    expect(trace.commitEvidence).toBeUndefined();
    expect(completeMock.mock.calls[0][1].messages[0].content).not.toContain('"spec":');
  });

  it('never fetches a sensitive path even when it is suggested or typed, and scrubs secrets from excerpts', async () => {
    await seed();
    const leaky = 'const token = "ghp_abcdefghijklmnopqrstuvwxyz0123";\nexport function Sidebar() {}';
    const { fetchImpl, urls } = makeFetch(repoRoutes({ 'src/components/Sidebar.tsx': leaky, 'backend/.env': 'GITHUB=ghp_zzzzzzzzzzzzzzzzzzzzzzzzzz' }));
    completeMock.mockResolvedValue({ text: JSON.stringify({ implementation: { status: 'unknown' } }), model: 'm' });
    const config = { provider: 'anthropic' as const, fetchImpl, includeCommits: false };
    const plan = await planTrace('proj-1', config);
    plan.intents[0].candidates.push({ path: 'backend/.env', reason: 'manual' });
    await runTrace('proj-1', plan, config);
    expect(urls.some((u) => u.includes('.env'))).toBe(false);
    const sent = JSON.stringify(completeMock.mock.calls[0][1].messages);
    expect(sent).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123');
    expect(sent).toContain('[REDACTED]');
    const [trace] = await listTracesForProject('proj-1');
    expect(trace.warnings.join(' ')).toMatch(/Skipped backend\/\.env \(sensitive\)/);
    expect(trace.warnings.join(' ')).toMatch(/Redacted 1 secret-shaped/);
  });

  it('isolates a failing intent as an unknown trace and aborts only on rate limit', async () => {
    const intent = await seed();
    const { fetchImpl } = makeFetch(repoRoutes({ 'src/components/Sidebar.tsx': SIDEBAR }));
    completeMock.mockRejectedValueOnce(new Error('relay down'));
    const config = { provider: 'anthropic' as const, fetchImpl, includeCommits: false };
    const plan = await planTrace('proj-1', config);
    const outcome = await runTrace('proj-1', plan, config);
    expect(outcome).toMatchObject({ traced: 0, errored: 1, aborted: false });
    const [trace] = await listTracesForIntent(intent.id);
    expect(trace.implStatus).toBe('unknown');
    expect(trace.warnings.join(' ')).toMatch(/Trace failed: relay down/);

    // Rate limit on a file fetch aborts without persisting a trace for that intent.
    await clearAllData();
    clearGitHubCaches();
    await seed();
    const limited = makeFetch(
      repoRoutes({ 'src/components/Sidebar.tsx': SIDEBAR }, [
        (u) => (u.pathname.startsWith('/repos/Kakob/Chatdex/contents/') ? { status: 403, body: {}, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } } : (undefined as never)),
      ])
    );
    const cfg2 = { provider: 'anthropic' as const, fetchImpl: limited.fetchImpl, includeCommits: false };
    const plan2 = await planTrace('proj-1', cfg2);
    const out2 = await runTrace('proj-1', plan2, cfg2);
    expect(out2.aborted).toBe(true);
    expect(out2.warnings.join(' ')).toMatch(/rate limit reached/);
    expect(await listTracesForProject('proj-1')).toEqual([]);
  });
});
