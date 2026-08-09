// Transit-only LLM relay (CLAUDE.md invariant 6).
//
// Forwards completion requests to the user's own provider account and
// normalizes the response. INVARIANT: nothing in this file may persist or log
// request/response content — no DB writes, no console/fastify logging of
// messages, keys, or completions. Error paths return only status codes and
// provider error *types*, never bodies.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const CompleteSchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1).max(500),
  maxTokens: z.number().int().positive().max(64_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

type CompleteInput = z.infer<typeof CompleteSchema>;

interface NormalizedCompletion {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

async function callAnthropic(input: CompleteInput): Promise<Response> {
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

async function callOpenAI(input: CompleteInput): Promise<Response> {
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

    let providerRes: Response;
    try {
      providerRes =
        input.provider === 'anthropic' ? await callAnthropic(input) : await callOpenAI(input);
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
}
