// Transit-only relay (CLAUDE.md invariant 6). A unique marker travels in
// the request; the assertions are that it reaches the provider and NOTHING
// else: not the logs, not an error body, not the database.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../test/harness.js';

const MARKER = 'ZQX-CONVERSATION-MARKER-7f3a9c';
const KEY = 'sk-ant-SECRET-KEY-MARKER-42';
const USER = 'user-llm-1';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(encoder.encode(`data: ${l}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

let t: TestApp;
let auth: string;
const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  t = await createTestApp();
  auth = `Bearer ${t.app.jwt.sign({ sub: USER, email: 'u@example.com' })}`;
  vi.stubGlobal('fetch', fetchMock);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await t.close();
});
afterEach(() => {
  fetchMock.mockReset();
});

async function complete(body: Record<string, unknown>, url = '/api/llm/complete') {
  return await t.app.inject({ method: 'POST', url, headers: { authorization: auth }, payload: body });
}

const request: Record<string, unknown> = {
  provider: 'anthropic',
  authMode: 'api-key',
  apiKey: KEY,
  model: 'claude-test',
  messages: [
    { role: 'system', content: `system ${MARKER}` },
    { role: 'user', content: `user says ${MARKER}` },
  ],
};

function expectNothingLeaked(): void {
  const logs = t.logs.text();
  expect(logs.length).toBeGreaterThan(0); // the capture is live…
  expect(logs).toContain('incoming request'); // …and sees requests at trace level
  expect(logs).not.toContain(MARKER);
  expect(logs).not.toContain(KEY);
}

describe('POST /api/llm/complete', () => {
  it('forwards the content to the provider and returns the normalized completion', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        model: 'claude-test',
        content: [{ type: 'text', text: 'hello back' }],
        usage: { input_tokens: 7, output_tokens: 2 },
      }),
    );
    const res = await complete(request);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      text: 'hello back',
      model: 'claude-test',
      usage: { inputTokens: 7, outputTokens: 2 },
    });
    // Transit happened: the provider saw the marker and the key.
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect(String(init?.body)).toContain(MARKER);
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expectNothingLeaked();
  });

  it('returns only the provider error TYPE on a provider 4xx, never its message', async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, { error: { type: 'authentication_error', message: `bad key ${MARKER} ${KEY}` } }),
    );
    const res = await complete(request);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'Provider error: authentication_error', providerStatus: 401 });
    expect(res.body).not.toContain(MARKER);
    expectNothingLeaked();
  });

  it('collapses an unparseable provider error to a fixed string', async () => {
    fetchMock.mockResolvedValueOnce(new Response(`<html>${MARKER}</html>`, { status: 503 }));
    const res = await complete(request);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'Provider request failed', providerStatus: 503 });
    expectNothingLeaked();
  });

  it('reports an unreachable provider without echoing the thrown error', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`ECONNRESET while sending ${MARKER}`));
    const res = await complete(request);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'Provider unreachable' });
    expectNothingLeaked();
  });

  it('reports an unexpected provider body shape without echoing it', async () => {
    fetchMock.mockResolvedValueOnce(new Response(`not json ${MARKER}`, { status: 200 }));
    const res = await complete(request);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'Unexpected provider response shape' });
    expectNothingLeaked();
  });

  it('enforces the request caps with a content-free 400', async () => {
    const cases = [
      { ...request, messages: [] },
      { ...request, messages: Array.from({ length: 501 }, () => ({ role: 'user', content: MARKER })) },
      { ...request, maxTokens: 64_001 },
      { ...request, temperature: 2.1 },
      { ...request, apiKey: undefined },
      { ...request, provider: 'someone-else' },
    ];
    for (const body of cases) {
      const res = await complete(body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Invalid relay request' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expectNothingLeaked();
  });

  it('accepts exactly the documented limits', async () => {
    fetchMock.mockResolvedValue(json(200, { model: 'm', content: [], usage: undefined }));
    const res = await complete({
      ...request,
      messages: Array.from({ length: 500 }, () => ({ role: 'user', content: 'x' })),
      maxTokens: 64_000,
      temperature: 2,
    });
    expect(res.statusCode).toBe(200);
  });

  it('requires a JWT', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/llm/complete', payload: request });
    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/llm/stream', () => {
  it('streams deltas and a done event, leaking nothing', async () => {
    fetchMock.mockResolvedValueOnce(
      sse([
        JSON.stringify({ type: 'message_start', message: { model: 'claude-test', usage: { input_tokens: 4 } } }),
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'echo: ' } }),
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: MARKER } }),
        JSON.stringify({ type: 'message_delta', usage: { output_tokens: 9 } }),
      ]),
    );
    const res = await complete(request, '/api/llm/stream');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = res.body
      .split('\n\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
    expect(events.map((e) => e.type)).toEqual(['delta', 'delta', 'done']);
    expect(events[2]).toMatchObject({ text: `echo: ${MARKER}`, model: 'claude-test', usage: { inputTokens: 4, outputTokens: 9 } });
    // The completion went back to the caller (transit) — and nowhere else.
    expectNothingLeaked();
  });

  it('turns a provider failure into a content-free error event', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error: { type: 'rate_limit_error', message: MARKER } }));
    const res = await complete(request, '/api/llm/stream');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"type":"error"');
    expect(res.body).toContain('"error":"Provider error: rate_limit_error"');
    expect(res.body).toContain('"providerStatus":429');
    expect(res.body).not.toContain(MARKER);
    expectNothingLeaked();
  });
});

describe('relay source hygiene (the invariant stated at the top of llm.ts)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const files = {
    'routes/llm.ts': fs.readFileSync(path.join(here, 'llm.ts'), 'utf8'),
    'llm/subscription.ts': fs.readFileSync(path.join(here, '../llm/subscription.ts'), 'utf8'),
    'llm/sse.ts': fs.readFileSync(path.join(here, '../llm/sse.ts'), 'utf8'),
  };

  it.each(Object.keys(files))('%s imports nothing from the database layer', (name) => {
    expect(files[name as keyof typeof files]).not.toMatch(/from ['"][^'"]*\/db\//);
    expect(files[name as keyof typeof files]).not.toMatch(/drizzle-orm/);
  });

  it.each(Object.keys(files))('%s never logs', (name) => {
    const src = files[name as keyof typeof files];
    expect(src).not.toMatch(/console\.(log|info|warn|error|debug)\(/);
    expect(src).not.toMatch(/\b(req|request|app|fastify|reply)\.log\b/);
  });
});
