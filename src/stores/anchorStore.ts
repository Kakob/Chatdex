import { create } from 'zustand';
import { anchorApi, tagApi, type ApiAnchor, type ApiTag } from '../lib/api';

interface AnchorFilters {
  tagId: string | null;
  priority: string | null;
  folder: string | null;
  search: string;
}

interface AnchorState {
  anchors: ApiAnchor[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  offset: number;
  anchoredMessages: Map<string, string[]>;
  filters: AnchorFilters;
  folders: string[];
  tags: ApiTag[];

  setFilter: (key: keyof AnchorFilters, value: string | null) => void;
  fetchAnchors: (options?: { reset?: boolean }) => Promise<void>;
  fetchFolders: () => Promise<void>;
  fetchTags: () => Promise<void>;
  createAnchor: (data: Parameters<typeof anchorApi.createAnchor>[0]) => Promise<ApiAnchor>;
  updateAnchor: (id: string, data: Parameters<typeof anchorApi.updateAnchor>[1]) => Promise<void>;
  deleteAnchor: (id: string) => Promise<void>;
  loadConversationAnchors: (conversationId: string) => Promise<void>;
  isMessageAnchored: (messageId: string) => boolean;
  getAnchorIdsForMessage: (messageId: string) => string[];
  toggleAnchor: (data: { conversationId: string; messageId: string; claudeResponse: string; userPrompt: string; messageIndex: number }) => Promise<void>;
}

const LIMIT = 50;

export const useAnchorStore = create<AnchorState>((set, get) => ({
  anchors: [],
  isLoading: false,
  error: null,
  hasMore: false,
  offset: 0,
  anchoredMessages: new Map(),
  filters: { tagId: null, priority: null, folder: null, search: '' },
  folders: [],
  tags: [],

  setFilter: (key, value) => {
    set({ filters: { ...get().filters, [key]: value } });
  },

  fetchAnchors: async (options) => {
    const reset = options?.reset ?? false;
    const offset = reset ? 0 : get().offset;
    const { tagId, priority, folder, search } = get().filters;

    set({ isLoading: true, error: null });
    try {
      const result = await anchorApi.getAnchors({
        tagId: tagId || undefined,
        priority: priority || undefined,
        folder: folder || undefined,
        search: search || undefined,
        limit: LIMIT,
        offset,
      });
      set({
        anchors: reset ? result.data : [...get().anchors, ...result.data],
        hasMore: result.pagination.hasMore,
        offset: offset + result.data.length,
        isLoading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  fetchFolders: async () => {
    try {
      const folders = await anchorApi.getFolders();
      set({ folders });
    } catch { /* ignore */ }
  },

  fetchTags: async () => {
    try {
      const tags = await tagApi.getTags(undefined, 'anchor');
      set({ tags });
    } catch { /* ignore */ }
  },

  createAnchor: async (data) => {
    const anchor = await anchorApi.createAnchor(data);
    set({ anchors: [anchor, ...get().anchors] });
    if (anchor.messageId) {
      const map = new Map(get().anchoredMessages);
      const ids = map.get(anchor.messageId) || [];
      map.set(anchor.messageId, [...ids, anchor.id]);
      set({ anchoredMessages: map });
    }
    return anchor;
  },

  updateAnchor: async (id, data) => {
    const updated = await anchorApi.updateAnchor(id, data);
    set({ anchors: get().anchors.map((a) => (a.id === id ? updated : a)) });
  },

  deleteAnchor: async (id) => {
    const anchor = get().anchors.find((a) => a.id === id);
    await anchorApi.deleteAnchor(id);
    set({ anchors: get().anchors.filter((a) => a.id !== id) });
    if (anchor?.messageId) {
      const map = new Map(get().anchoredMessages);
      const ids = (map.get(anchor.messageId) || []).filter((i) => i !== id);
      if (ids.length === 0) map.delete(anchor.messageId);
      else map.set(anchor.messageId, ids);
      set({ anchoredMessages: map });
    }
  },

  loadConversationAnchors: async (conversationId) => {
    const items = await anchorApi.getConversationAnchors(conversationId);
    const map = new Map(get().anchoredMessages);
    for (const item of items) {
      if (item.messageId) {
        const ids = map.get(item.messageId) || [];
        if (!ids.includes(item.id)) map.set(item.messageId, [...ids, item.id]);
      }
    }
    set({ anchoredMessages: map });
  },

  isMessageAnchored: (messageId) => {
    const ids = get().anchoredMessages.get(messageId);
    return !!ids && ids.length > 0;
  },

  getAnchorIdsForMessage: (messageId) => {
    return get().anchoredMessages.get(messageId) || [];
  },

  toggleAnchor: async (data) => {
    const check = await anchorApi.checkAnchor(data.messageId);
    if (check.anchored && check.anchorIds.length > 0) {
      const anchorId = check.anchorIds[0];
      await anchorApi.deleteAnchor(anchorId);
      set({ anchors: get().anchors.filter((a) => a.id !== anchorId) });
      const map = new Map(get().anchoredMessages);
      map.delete(data.messageId);
      set({ anchoredMessages: map });
    } else {
      await get().createAnchor({
        contentType: 'full_response',
        claudeResponse: data.claudeResponse,
        userPrompt: data.userPrompt,
        conversationId: data.conversationId,
        messageId: data.messageId,
        messageIndex: data.messageIndex,
      });
    }
  },
}));
