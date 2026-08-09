// Transit-only LLM relay (CLAUDE.md invariant 6).
//
// Forwards completion requests to the user's own provider account and
// normalizes the response. INVARIANT: nothing in this file may persist or log
// request/response content — no DB writes, no console/fastify logging of
// messages, keys, or completions. Error paths return only status codes and
// provider error *types*, never bodies.

import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  completeViaAnthropicSubscription,
  completeViaOpenAISubscription,
  getSubscriptionStatus,
  SubscriptionError,
  type DeltaHandler,
} from '../llm/subscription.js';
import { splitSystem, sseDataPayloads } from '../llm/sse.js';

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

/** Error whose message is content-free and safe to send to the client. */
class RelayError extends Error {
  constructor(
    message: string,
    public providerStatus?: number,
  ) {
    super(message);
  }
}

async function throwRelayError(res: Response): Promise<never> {
  let errorType: string | undefined;
  try {
    errorType = safeErrorType(await res.json());
  } catch {
    // Ignore unparseable provider error bodies.
  }
  throw new RelayError(
    errorType ? `Provider error: ${errorType}` : 'Provider request failed',
    res.status,
  );
}

async function streamAnthropic(
  input: KeyedInput,
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<NormalizedCompletion> {
  const sys = input.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const messages = input.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: input.maxTokens ?? 4096,
      ...(sys ? { system: sys } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      messages,
      stream: true,
    }),
    signal,
  });
  if (!res.ok) await throwRelayError(res);
  if (!res.body) throw new RelayError('Provider request failed');

  let text = '';
  let model = input.model;
  let usage: NormalizedCompletion['usage'];
  for await (const payload of sseDataPayloads(res.body)) {
    let event: {
      type: string;
      message?: { model?: string; usage?: { input_tokens?: number } };
      delta?: { type?: string; text?: string };
      usage?: { output_tokens?: number };
      error?: { type?: string };
    };
    try {
      event = JSON.parse(payload) as typeof event;
    } catch {
      continue;
    }
    if (event.type === 'message_start' && event.message) {
      model = event.message.model ?? model;
      usage = { inputTokens: event.message.usage?.input_tokens };
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const chunk = event.delta.text ?? '';
      text += chunk;
      if (chunk) onDelta(chunk);
    } else if (event.type === 'message_delta' && event.usage) {
      usage = { ...usage, outputTokens: event.usage.output_tokens };
    } else if (event.type === 'error') {
      throw new RelayError(
        event.error?.type ? `Provider error: ${event.error.type}` : 'Provider request failed',
      );
    }
  }
  return { text, model, usage };
}

async function streamOpenAI(
  input: KeyedInput,
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<NormalizedCompletion> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
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
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal,
  });
  if (!res.ok) await throwRelayError(res);
  if (!res.body) throw new RelayError('Provider request failed');

  let text = '';
  let model = input.model;
  let usage: NormalizedCompletion['usage'];
  for await (const payload of sseDataPayloads(res.body)) {
    if (payload === '[DONE]') break;
    let chunk: {
      model?: string;
      choices?: Array<{ delta?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
    };
    try {
      chunk = JSON.parse(payload) as typeof chunk;
    } catch {
      continue;
    }
    if (chunk.model) model = chunk.model;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      onDelta(delta);
    }
    if (chunk.usage) {
      usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
    }
  }
  return { text, model, usage };
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
      const { system, prompt } = splitSystem(input.messages);
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

  // Streaming variant of /complete: an SSE response carrying
  //   data: {"type":"delta","text":"…"}   — display-only text fragments
  //   data: {"type":"done", …NormalizedCompletion}  — authoritative final text
  //   data: {"type":"error","error":"…"}  — content-free failure label
  // The same transit-only rules apply: nothing is persisted or logged.
  app.post('/stream', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = CompleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid relay request' });
    }
    const input = parsed.data;

    const sse = new PassThrough();
    // A client disconnect destroys the stream; swallow the resulting error
    // and stop writing instead of crashing on ERR_STREAM_DESTROYED.
    let closed = false;
    sse.on('close', () => {
      closed = true;
    });
    sse.on('error', () => {
      closed = true;
    });
    const emit = (payload: Record<string, unknown>): void => {
      if (!closed) sse.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());

    void reply
      .code(200)
      .header('content-type', 'text/event-stream')
      .header('cache-control', 'no-cache')
      .header('x-accel-buffering', 'no')
      .send(sse);

    const onDelta: DeltaHandler = (text) => emit({ type: 'delta', text });

    try {
      let completion: NormalizedCompletion;
      if (input.authMode === 'subscription') {
        const { system, prompt } = splitSystem(input.messages);
        const bridgeInput = { model: input.model, system, prompt };
        completion =
          input.provider === 'anthropic'
            ? await completeViaAnthropicSubscription(bridgeInput, onDelta)
            : await completeViaOpenAISubscription(bridgeInput, onDelta);
      } else {
        const { apiKey, model } = input;
        if (!apiKey || !model) {
          // Unreachable (schema superRefine) — narrows the type.
          throw new RelayError('Invalid relay request');
        }
        const keyed: KeyedInput = { ...input, apiKey, model };
        completion =
          input.provider === 'anthropic'
            ? await streamAnthropic(keyed, onDelta, abort.signal)
            : await streamOpenAI(keyed, onDelta, abort.signal);
      }
      emit({ type: 'done', ...completion });
    } catch (err) {
      // Only RelayError/SubscriptionError messages are guaranteed
      // content-free; anything else stays generic.
      const message =
        err instanceof RelayError || err instanceof SubscriptionError
          ? err.message
          : 'Stream failed';
      emit({
        type: 'error',
        error: message,
        ...(err instanceof RelayError && err.providerStatus !== undefined
          ? { providerStatus: err.providerStatus }
          : {}),
      });
    } finally {
      sse.end();
    }
    return reply;
  });

  app.get('/subscription/status', { preHandler: app.authenticate }, async (_req, reply) => {
    return reply.send(await getSubscriptionStatus());
  });
}
