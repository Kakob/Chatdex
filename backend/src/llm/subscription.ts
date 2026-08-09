// Subscription bridge (CLAUDE.md invariant 6 — transit-only).
//
// Completes prompts against the user's own consumer subscriptions via local
// CLI login state: Anthropic through the Claude Agent SDK (Claude Code login),
// OpenAI through the Codex SDK (`codex login`). Both SDKs spawn a local CLI
// subprocess, which is why this lives in the backend and not the browser.
//
// INVARIANT: nothing here may persist or log request/response content. Errors
// thrown to callers must be fixed strings or SDK status codes, never bodies.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Codex } from '@openai/codex-sdk';

export interface SubscriptionCompletionInput {
  /** Omitted ⇒ the CLI's own default model. */
  model?: string;
  system?: string;
  prompt: string;
}

export interface SubscriptionCompletion {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Error whose message is guaranteed content-free and safe to relay. */
export class SubscriptionError extends Error {}

export async function completeViaAnthropicSubscription(
  input: SubscriptionCompletionInput,
): Promise<SubscriptionCompletion> {
  // An API key in the env would take priority over the subscription login and
  // silently switch billing to pay-per-token — strip it.
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const stream = query({
    prompt: input.prompt,
    options: {
      ...(input.model ? { model: input.model } : {}),
      ...(input.system ? { systemPrompt: input.system } : {}),
      tools: [],
      maxTurns: 1,
      permissionMode: 'dontAsk',
      persistSession: false,
      settingSources: [],
      cwd: os.tmpdir(),
      env,
    },
  });

  for await (const message of stream) {
    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        throw new SubscriptionError(`Claude subscription completion failed: ${message.subtype}`);
      }
      return {
        text: message.result,
        model: input.model ?? 'subscription-default',
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      };
    }
  }
  throw new SubscriptionError('Claude subscription completion produced no result');
}

export async function completeViaOpenAISubscription(
  input: SubscriptionCompletionInput,
): Promise<SubscriptionCompletion> {
  // Codex `env` replaces the subprocess env entirely; pass everything through
  // except API keys, which would override the ChatGPT-subscription login.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'OPENAI_API_KEY' && key !== 'CODEX_API_KEY') {
      env[key] = value;
    }
  }

  const codex = new Codex({
    env,
    config: { history: { persistence: 'none' } },
  });
  const thread = codex.startThread({
    ...(input.model ? { model: input.model } : {}),
    workingDirectory: os.tmpdir(),
    skipGitRepoCheck: true,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
  });

  // The Codex SDK has no dedicated system-prompt option.
  const promptText = input.system ? `${input.system}\n\n${input.prompt}` : input.prompt;
  const turn = await thread.run(promptText);
  return {
    text: turn.finalResponse,
    model: input.model ?? 'subscription-default',
    usage: turn.usage
      ? { inputTokens: turn.usage.input_tokens, outputTokens: turn.usage.output_tokens }
      : undefined,
  };
}

export interface SubscriptionStatus {
  anthropic: boolean;
  openai: boolean;
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const [anthropic, openai] = await Promise.all([
    anthropicLoginPresent(),
    Promise.resolve(fs.existsSync(path.join(os.homedir(), '.codex', 'auth.json'))),
  ]);
  return { anthropic, openai };
}

function anthropicLoginPresent(): Promise<boolean> {
  if (process.platform === 'darwin') {
    return new Promise((resolve) => {
      execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials'], (err) =>
        resolve(!err),
      );
    });
  }
  return Promise.resolve(
    fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json')),
  );
}
