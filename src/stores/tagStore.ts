import { create } from 'zustand';
import { tagApi, type ApiTag } from '../lib/api';

interface TagState {
  tags: ApiTag[];
  isLoading: boolean;
  error: string | null;

  fetchTags: (query?: string, category?: string) => Promise<void>;
  createTag: (name: string, color?: string, category?: string) => Promise<ApiTag>;
  deleteTag: (id: string) => Promise<void>;
  tagEntity: (tagId: string, entityId: string, entityType: string) => Promise<void>;
  untagEntity: (tagId: string, entityId: string, entityType: string) => Promise<void>;
  getEntityTags: (entityType: string, entityId: string) => Promise<ApiTag[]>;
}

export const useTagStore = create<TagState>((set, get) => ({
  tags: [],
  isLoading: false,
  error: null,

  fetchTags: async (query?: string, category?: string) => {
    set({ isLoading: true, error: null });
    try {
      const tags = await tagApi.getTags(query, category);
      set({ tags, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  createTag: async (name: string, color?: string, category?: string) => {
    const tag = await tagApi.createTag({ name, color, category });
    // Refresh tags list
    const { tags } = get();
    if (!tags.find((t) => t.id === tag.id)) {
      set({ tags: [...tags, tag] });
    }
    return tag;
  },

  deleteTag: async (id: string) => {
    await tagApi.deleteTag(id);
    set({ tags: get().tags.filter((t) => t.id !== id) });
  },

  tagEntity: async (tagId: string, entityId: string, entityType: string) => {
    await tagApi.tagEntity(tagId, entityId, entityType);
  },

  untagEntity: async (tagId: string, entityId: string, entityType: string) => {
    await tagApi.untagEntity(tagId, entityId, entityType);
  },

  getEntityTags: async (entityType: string, entityId: string) => {
    return tagApi.getEntityTags(entityType, entityId);
  },
}));
