// Audit S2 guard (SPEC-intent-trace §13): the GitHub token must never reach
// the relay. Mocks global fetch, stores a token, runs a completion, and
// inspects the exact body that would be POSTed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearAllData } from '../db';
import { setGitHubToken } from '../github/credentials';
import { setProviderKey, setProviderAuthMode } from './credentials';
import { complete } from './relayClient';

const realFetch = globalThis.fetch;

beforeEach(async () => {
  await clearAllData();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('relay request body', () => {
  it('carries only provider fields — no github key, no token string', async () => {
    await setGitHubToken('github_pat_SUPER_SECRET');
    await setProviderAuthMode('anthropic', 'api-key');
    await setProviderKey('anthropic', 'sk-ant-test');

    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({ text: '{}', model: 'm' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await complete('anthropic', { messages: [{ role: 'user', content: 'hi' }] });

    expect(seen).toHaveLength(1);
    const body = JSON.parse(seen[0]) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['apiKey', 'authMode', 'messages', 'model', 'provider'].sort());
    expect(seen[0]).not.toContain('github');
    expect(seen[0]).not.toContain('SUPER_SECRET');
  });
});
