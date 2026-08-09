import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearAllData } from '../db';
import {
  setProviderKey,
  getProviderKey,
  clearProviderKey,
  listConfiguredProviders,
  getProviderAuthMode,
  setProviderAuthMode,
} from './credentials';
import { getProviderInfo, ALL_PROVIDERS, PROVIDERS } from './registry';
import { complete, listReadyProviders } from './relayClient';

beforeEach(async () => {
  await clearAllData();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider registry', () => {
  it('exposes info for every provider id', () => {
    for (const id of ALL_PROVIDERS) {
      const info = getProviderInfo(id);
      expect(info.id).toBe(id);
      expect(info.label).toBeTruthy();
      expect(info.defaultModel).toBeTruthy();
    }
    expect(Object.keys(PROVIDERS).sort()).toEqual([...ALL_PROVIDERS].sort());
  });
});

describe('provider credentials', () => {
  it('stores, reads, and clears keys per provider', async () => {
    await setProviderKey('anthropic', '  sk-ant-test  ');
    expect(await getProviderKey('anthropic')).toBe('sk-ant-test');
    expect(await getProviderKey('openai')).toBeUndefined();

    await clearProviderKey('anthropic');
    expect(await getProviderKey('anthropic')).toBeUndefined();
  });

  it('rejects empty keys', async () => {
    await expect(setProviderKey('openai', '   ')).rejects.toThrow(/empty/);
  });

  it('lists only configured providers', async () => {
    expect(await listConfiguredProviders()).toEqual([]);
    await setProviderKey('openai', 'sk-test');
    expect(await listConfiguredProviders()).toEqual(['openai']);
  });
});

describe('relay client', () => {
  it('refuses to call without a configured key', async () => {
    await expect(
      complete('anthropic', { messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(/No API key/);
  });

  it('posts the request with the stored key and default model', async () => {
    await setProviderKey('anthropic', 'sk-ant-test');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello', model: 'claude-sonnet-4-6' }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await complete('anthropic', {
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.text).toBe('hello');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/llm/complete');
    const body = JSON.parse(init.body as string);
    expect(body.provider).toBe('anthropic');
    expect(body.apiKey).toBe('sk-ant-test');
    expect(body.model).toBe(getProviderInfo('anthropic').defaultModel);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('surfaces relay errors without dropping provider status', async () => {
    await setProviderKey('openai', 'sk-test');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'Provider error: invalid_api_key', providerStatus: 401 }),
          { status: 502 }
        )
      )
    );

    await expect(
      complete('openai', { messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(/invalid_api_key.*401|502/);
  });
});

describe('auth mode', () => {
  it('defaults to api-key and round-trips per provider', async () => {
    expect(await getProviderAuthMode('anthropic')).toBe('api-key');
    await setProviderAuthMode('anthropic', 'subscription');
    expect(await getProviderAuthMode('anthropic')).toBe('subscription');
    expect(await getProviderAuthMode('openai')).toBe('api-key');
  });

  it('subscription-mode complete() posts without apiKey and without a stored key', async () => {
    await setProviderAuthMode('anthropic', 'subscription');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello', model: 'subscription-default' }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await complete('anthropic', {
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.text).toBe('hello');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.authMode).toBe('subscription');
    expect(body.apiKey).toBeUndefined();
    expect(body.model).toBeUndefined();
  });

  it('api-key complete() still sends the mode field', async () => {
    await setProviderKey('anthropic', 'sk-ant-test');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: 'ok', model: 'claude-sonnet-4-6' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await complete('anthropic', { messages: [{ role: 'user', content: 'hi' }] });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).authMode).toBe('api-key');
  });
});

describe('listReadyProviders', () => {
  it('includes api-key-mode providers only when a key is stored', async () => {
    expect(await listReadyProviders()).toEqual([]);
    await setProviderKey('openai', 'sk-test');
    expect(await listReadyProviders()).toEqual(['openai']);
  });

  it('includes subscription-mode providers only when the CLI login is detected', async () => {
    await setProviderAuthMode('anthropic', 'subscription');
    await setProviderAuthMode('openai', 'subscription');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ anthropic: true, openai: false }), { status: 200 })
      )
    );
    expect(await listReadyProviders()).toEqual(['anthropic']);
  });

  it('ignores a stored key for a provider switched to subscription mode', async () => {
    await setProviderKey('anthropic', 'sk-ant-test');
    await setProviderAuthMode('anthropic', 'subscription');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ anthropic: false, openai: false }), { status: 200 })
      )
    );
    expect(await listReadyProviders()).toEqual([]);
  });

  it('treats an unreachable backend as no subscription providers ready', async () => {
    await setProviderAuthMode('anthropic', 'subscription');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await listReadyProviders()).toEqual([]);
  });
});
