import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock import.meta.env
vi.stubGlobal('import', { meta: { env: { VITE_API_URL: 'http://localhost:3003/api' } } });

// Import after mocks are set up
const { api, tagApi, anchorApi } = await import('./api');

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  };
}

describe('api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getConversations calls correct endpoint', async () => {
    mockFetch.mockResolvedValue(mockResponse({ data: [], pagination: { total: 0 } }));
    await api.getConversations({ source: 'claude.ai', limit: 10 });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/conversations'),
      expect.any(Object)
    );
  });

  it('getConversations includes query params', async () => {
    mockFetch.mockResolvedValue(mockResponse({ data: [], pagination: { total: 0 } }));
    await api.getConversations({ source: 'claude.ai', limit: 10, offset: 5 });
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain('source=claude.ai');
    expect(url).toContain('limit=10');
    expect(url).toContain('offset=5');
  });

  it('throws ApiError on non-ok response', async () => {
    mockFetch.mockResolvedValue(mockResponse({ error: 'Not found' }, 404));
    await expect(api.getConversation('bad-id')).rejects.toThrow();
  });

  it('getMetadata returns undefined for 404', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });
    const result = await api.getMetadata('nonexistent');
    expect(result).toBeUndefined();
  });

  it('deleteConversations sends DELETE', async () => {
    mockFetch.mockResolvedValue(mockResponse({}));
    await api.deleteConversations('claude.ai');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/conversations'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('importData sends POST with body', async () => {
    mockFetch.mockResolvedValue(mockResponse({ conversationsAdded: 1 }));
    await api.importData({ conversations: [], messages: [], source: 'claude.ai' });
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeDefined();
  });

  it('recomputeStats calls POST /stats/recompute', async () => {
    mockFetch.mockResolvedValue(mockResponse({ success: true, daysUpdated: 5 }));
    await api.recomputeStats();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/stats/recompute'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('tagApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getTags calls correct endpoint', async () => {
    mockFetch.mockResolvedValue(mockResponse([]));
    await tagApi.getTags('react', 'prompt');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/tags'),
      expect.any(Object)
    );
  });

  it('createTag sends POST', async () => {
    mockFetch.mockResolvedValue(mockResponse({ id: '1', name: 'test' }));
    await tagApi.createTag({ name: 'test' });
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('POST');
  });
});

describe('anchorApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createAnchor sends POST with body', async () => {
    mockFetch.mockResolvedValue(mockResponse({ id: 'a1' }));
    await anchorApi.createAnchor({ contentType: 'full_response', conversationId: 'c1' });
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toMatchObject({ contentType: 'full_response' });
  });

  it('deleteAnchor sends DELETE', async () => {
    mockFetch.mockResolvedValue(mockResponse({ success: true }));
    await anchorApi.deleteAnchor('a1');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('DELETE');
  });
});

