// The subscription bridge must strip provider API keys from the subprocess
// env (docs/territories/relay-llm-calls.md:53): a key in the env would take
// priority over the CLI login and silently switch billing to pay-per-token.

import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';

const captured = vi.hoisted(() => ({
  queryOptions: undefined as Record<string, unknown> | undefined,
  codexOptions: undefined as Record<string, unknown> | undefined,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn((args: { options: Record<string, unknown> }) => {
    captured.queryOptions = args.options;
    return (async function* () {
      yield {
        type: 'result',
        subtype: 'success',
        result: 'answer',
        modelUsage: { 'claude-test': { outputTokens: 5 } },
        usage: { input_tokens: 3, output_tokens: 5 },
      };
    })();
  }),
}));

vi.mock('@openai/codex-sdk', () => ({
  Codex: vi.fn(function (this: unknown, opts: Record<string, unknown>) {
    captured.codexOptions = opts;
    return {
      startThread: () => ({
        run: async () => ({ finalResponse: 'answer', usage: null }),
      }),
    };
  }),
}));

import { completeViaAnthropicSubscription, completeViaOpenAISubscription } from './subscription.js';

describe('subscription bridge env hygiene', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('strips ANTHROPIC_API_KEY from the Claude subprocess env and keeps everything else', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-must-not-pass');
    vi.stubEnv('KEEP_ME', 'yes');
    const out = await completeViaAnthropicSubscription({ prompt: 'hi' });
    expect(out.text).toBe('answer');
    const env = captured.queryOptions?.env as Record<string, string | undefined>;
    expect(env).toBeDefined();
    expect('ANTHROPIC_API_KEY' in env).toBe(false);
    expect(env.KEEP_ME).toBe('yes');
  });

  it('runs the Claude subprocess with no tools, one turn, no persisted session, in a temp dir', async () => {
    await completeViaAnthropicSubscription({ prompt: 'hi' });
    expect(captured.queryOptions).toMatchObject({
      tools: [],
      maxTurns: 1,
      persistSession: false,
      settingSources: [],
      cwd: os.tmpdir(),
    });
  });

  it('strips OPENAI_API_KEY and CODEX_API_KEY from the Codex env and keeps everything else', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-must-not-pass');
    vi.stubEnv('CODEX_API_KEY', 'codex-must-not-pass');
    vi.stubEnv('KEEP_ME', 'yes');
    const out = await completeViaOpenAISubscription({ prompt: 'hi' });
    expect(out.text).toBe('answer');
    const env = captured.codexOptions?.env as Record<string, string>;
    expect('OPENAI_API_KEY' in env).toBe(false);
    expect('CODEX_API_KEY' in env).toBe(false);
    expect(env.KEEP_ME).toBe('yes');
    expect(captured.codexOptions?.config).toEqual({ history: { persistence: 'none' } });
  });
});
