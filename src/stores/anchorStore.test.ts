import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAnchorStore } from './anchorStore';

vi.mock('../lib/api', () => ({
  anchorApi: {
    getAnchors: vi.fn(),
    getAnchor: vi.fn(),
    getConversationAnchors: vi.fn(),
    checkAnchor: vi.fn().mockResolvedValue({ anchored: false, anchorIds: [] }),
    createAnchor: vi.fn(),
    updateAnchor: vi.fn(),
    deleteAnchor: vi.fn(),
    getFolders: vi.fn().mockResolvedValue([]),
  },
  tagApi: {
    getTags: vi.fn().mockResolvedValue([]),
  },
}));

import { anchorApi } from '../lib/api';

const mockAnchor = {
  id: 'anchor-1',
  contentType: 'full_response' as const,
  userPrompt: 'How do I use React?',
  claudeResponse: 'React is a UI library...',
  selectedText: null,
  conversationId: 'conv-1',
  conversationName: 'Test Conversation',
  messageId: 'msg-1',
  conversationUrl: null,
  messageIndex: 1,
  annotation: null,
  priority: 'medium' as const,
  workspaceId: null,
  folder: null,
  autoTags: [],
  relatedItemIds: [],
  tags: [],
  createdAt: '2026-01-15T10:00:00Z',
  updatedAt: '2026-01-15T10:00:00Z',
};

describe('anchorStore', () => {
  beforeEach(() => {
    useAnchorStore.setState({
      anchors: [],
      isLoading: false,
      error: null,
      hasMore: false,
      offset: 0,
      anchoredMessages: new Map(),
      filters: { tagId: null, priority: null, folder: null, search: '' },
    });
    vi.clearAllMocks();
  });

  it('starts with empty state', () => {
    const state = useAnchorStore.getState();
    expect(state.anchors).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.anchoredMessages.size).toBe(0);
  });

  it('fetchAnchors populates anchors on success', async () => {
    vi.mocked(anchorApi.getAnchors).mockResolvedValue({
      data: [mockAnchor],
      pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
    });
    await useAnchorStore.getState().fetchAnchors({ reset: true });
    expect(useAnchorStore.getState().anchors).toEqual([mockAnchor]);
    expect(useAnchorStore.getState().isLoading).toBe(false);
  });

  it('fetchAnchors sets error on failure', async () => {
    vi.mocked(anchorApi.getAnchors).mockRejectedValue(new Error('Network error'));
    await useAnchorStore.getState().fetchAnchors({ reset: true });
    expect(useAnchorStore.getState().error).toBe('Network error');
  });

  it('fetchAnchors passes filters as query params', async () => {
    vi.mocked(anchorApi.getAnchors).mockResolvedValue({
      data: [],
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
    });
    useAnchorStore.setState({ filters: { tagId: 'tag-1', priority: 'high', folder: null, search: 'react' } });
    await useAnchorStore.getState().fetchAnchors({ reset: true });
    expect(anchorApi.getAnchors).toHaveBeenCalledWith(
      expect.objectContaining({ tagId: 'tag-1', priority: 'high', search: 'react' })
    );
  });

  it('createAnchor adds to anchors and updates anchoredMessages map', async () => {
    vi.mocked(anchorApi.createAnchor).mockResolvedValue(mockAnchor);
    await useAnchorStore.getState().createAnchor({
      contentType: 'full_response',
      conversationId: 'conv-1',
      messageId: 'msg-1',
    });
    expect(useAnchorStore.getState().anchors).toHaveLength(1);
    expect(useAnchorStore.getState().anchoredMessages.get('msg-1')).toEqual(['anchor-1']);
  });

  it('deleteAnchor removes from anchors and anchoredMessages', async () => {
    useAnchorStore.setState({
      anchors: [mockAnchor],
      anchoredMessages: new Map([['msg-1', ['anchor-1']]]),
    });
    vi.mocked(anchorApi.deleteAnchor).mockResolvedValue(undefined);
    await useAnchorStore.getState().deleteAnchor('anchor-1');
    expect(useAnchorStore.getState().anchors).toHaveLength(0);
    expect(useAnchorStore.getState().anchoredMessages.has('msg-1')).toBe(false);
  });

  it('isMessageAnchored returns correct boolean', () => {
    useAnchorStore.setState({ anchoredMessages: new Map([['msg-1', ['anchor-1']]]) });
    expect(useAnchorStore.getState().isMessageAnchored('msg-1')).toBe(true);
    expect(useAnchorStore.getState().isMessageAnchored('msg-2')).toBe(false);
  });

  it('loadConversationAnchors populates anchoredMessages', async () => {
    vi.mocked(anchorApi.getConversationAnchors).mockResolvedValue([
      { id: 'a1', messageId: 'msg-1', contentType: 'full_response', createdAt: '2026-01-15T10:00:00Z' },
      { id: 'a2', messageId: 'msg-2', contentType: 'selection', createdAt: '2026-01-15T11:00:00Z' },
    ]);
    await useAnchorStore.getState().loadConversationAnchors('conv-1');
    expect(useAnchorStore.getState().anchoredMessages.get('msg-1')).toEqual(['a1']);
    expect(useAnchorStore.getState().anchoredMessages.get('msg-2')).toEqual(['a2']);
  });

  it('setFilter updates filter state', () => {
    useAnchorStore.getState().setFilter('tagId', 'tag-1');
    expect(useAnchorStore.getState().filters.tagId).toBe('tag-1');
  });

  it('toggleAnchor creates when not anchored', async () => {
    vi.mocked(anchorApi.checkAnchor).mockResolvedValue({ anchored: false, anchorIds: [] });
    vi.mocked(anchorApi.createAnchor).mockResolvedValue(mockAnchor);
    await useAnchorStore.getState().toggleAnchor({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      claudeResponse: 'response',
      userPrompt: 'prompt',
      messageIndex: 0,
    });
    expect(anchorApi.createAnchor).toHaveBeenCalled();
  });

  it('toggleAnchor deletes when already anchored', async () => {
    vi.mocked(anchorApi.checkAnchor).mockResolvedValue({ anchored: true, anchorIds: ['anchor-1'] });
    vi.mocked(anchorApi.deleteAnchor).mockResolvedValue(undefined);
    useAnchorStore.setState({
      anchors: [mockAnchor],
      anchoredMessages: new Map([['msg-1', ['anchor-1']]]),
    });
    await useAnchorStore.getState().toggleAnchor({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      claudeResponse: 'response',
      userPrompt: 'prompt',
      messageIndex: 0,
    });
    expect(anchorApi.deleteAnchor).toHaveBeenCalledWith('anchor-1');
  });
});
