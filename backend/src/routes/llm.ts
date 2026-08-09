// Transit-only LLM relay (CLAUDE.md invariant 6).
//
// Forwards completion requests to the user's own provider account and
// normalizes the response. INVARIANT: nothing in this file may persist or log
// request/response content — no DB writes, no console/fastify logging of
// messages, keys, or completions. Error paths return only status codes and
// provider error *types*, never bodies.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  completeViaAnthropicSubscription,
  completeViaOpenAISubscription,
  getSubscriptionStatus,
  SubscriptionError,
} from '../llm/subscription.js';

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const CompleteSchema = z
  .object({
    provider: z.enum(['anthropic', 'openai']),
    authMode: z.enum(['api-key', 'subscription']).default('api-key'),
    apiKey: z.string().min(1).optional(),
    // Optional in subscription mode: the local CLI's default model applies.
    model: z.string().min(1).optional(),
    messages: z.array(ChatMessageSchema).min(1).max(500),
    maxTokens: z.number().int().positive().max(64_000).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.authMode === 'api-key') {
      if (!val.apiKey) {
        ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'Required for api-key mode' });
      }
      if (!val.model) {
        ctx.addIssue({ code: 'custom', path: ['model'], message: 'Required for api-key mode' });
      }
    }
  });

type CompleteInput = z.infer<typeof CompleteSchema>;
type KeyedInput = CompleteInput & { apiKey: string; model: string };

interface NormalizedCompletion {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

async function callAnthropic(input: KeyedInput): Promise<Response> {
  const system = input.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const messages = input.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: input.maxTokens ?? 4096,
      ...(system ? { system } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      messages,
    }),
  });
}

function normalizeAnthropic(body: unknown): NormalizedCompletion {
  const b = body as {
    model: string;
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = b.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
  return {
    text,
    model: b.model,
    usage: b.usage
      ? { inputTokens: b.usage.input_tokens, outputTokens: b.usage.output_tokens }
      : undefined,
  };
}

async function callOpenAI(input: KeyedInput): Promise<Response> {
  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      ...(input.maxTokens !== undefined ? { max_completion_tokens: input.maxTokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    }),
  });
}

function normalizeOpenAI(body: unknown): NormalizedCompletion {
  const b = body as {
    model: string;
    choices: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: b.choices?.[0]?.message?.content ?? '',
    model: b.model,
    usage: b.usage
      ? { inputTokens: b.usage.prompt_tokens, outputTokens: b.usage.completion_tokens }
      : undefined,
  };
}

/** Extract a content-free error label from a provider error body. */
function safeErrorType(body: unknown): string | undefined {
  const b = body as { error?: { type?: string; code?: string } };
  return b?.error?.type ?? b?.error?.code ?? undefined;
}

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  app.post('/complete', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = CompleteSchema.safeParse(req.body);
    if (!parsed.success) {
      // Zod issues describe shape problems only; message *content* never
      // appears in issue paths, so this is safe to return.
      return reply.code(400).send({ error: 'Invalid relay request' });
    }
    const input = parsed.data;

    if (input.authMode === 'subscription') {
      const system = input.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const prompt = input.messages
        .filter((m) => m.role !== 'system')
        .map((m) => m.content)
        .join('\n\n');
      try {
        const completion =
          input.provider === 'anthropic'
            ? await completeViaAnthropicSubscription({ model: input.model, system, prompt })
            : await completeViaOpenAISubscription({ model: input.model, system, prompt });
        return reply.send(completion);
      } catch (err) {
        // Only SubscriptionError messages are guaranteed content-free; any
        // other error stays generic so nothing from the SDK stream leaks.
        const message =
          err instanceof SubscriptionError ? err.message : 'Subscription completion failed';
        return reply.code(502).send({ error: message });
      }
    }

    const { apiKey, model } = input;
    if (!apiKey || !model) {
      // Unreachable (schema superRefine) — narrows the type.
      return reply.code(400).send({ error: 'Invalid relay request' });
    }
    const keyed: KeyedInput = { ...input, apiKey, model };

    let providerRes: Response;
    try {
      providerRes =
        input.provider === 'anthropic' ? await callAnthropic(keyed) : await callOpenAI(keyed);
    } catch {
      return reply.code(502).send({ error: 'Provider unreachable' });
    }

    if (!providerRes.ok) {
      let errorType: string | undefined;
      try {
        errorType = safeErrorType(await providerRes.json());
      } catch {
        // Ignore unparseable provider error bodies.
      }
      return reply.code(502).send({
        error: errorType ? `Provider error: ${errorType}` : 'Provider request failed',
        providerStatus: providerRes.status,
      });
    }

    let normalized: NormalizedCompletion;
    try {
      const body = await providerRes.json();
      normalized =
        input.provider === 'anthropic' ? normalizeAnthropic(body) : normalizeOpenAI(body);
    } catch {
      return reply.code(502).send({ error: 'Unexpected provider response shape' });
    }

    return reply.send(normalized);
  });

  app.get('/subscription/status', { preHandler: app.authenticate }, async (_req, reply) => {
    return reply.send(await getSubscriptionStatus());
  });
}
