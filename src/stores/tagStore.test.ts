import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTagStore } from './tagStore';

// Mock the API module
vi.mock('../lib/api', () => ({
  tagApi: {
    getTags: vi.fn(),
    createTag: vi.fn(),
    deleteTag: vi.fn(),
    tagEntity: vi.fn(),
    untagEntity: vi.fn(),
    getEntityTags: vi.fn(),
  },
}));

import { tagApi } from '../lib/api';

const mockTag = {
  id: 'tag-1',
  name: 'react',
  color: '#7c3aed',
  category: null,
  usageCount: 3,
  createdAt: '2026-01-15T10:00:00Z',
};

describe('tagStore', () => {
  beforeEach(() => {
    useTagStore.setState({ tags: [], isLoading: false, error: null });
    vi.clearAllMocks();
  });

  it('starts with empty state', () => {
    const state = useTagStore.getState();
    expect(state.tags).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('fetchTags populates tags on success', async () => {
    vi.mocked(tagApi.getTags).mockResolvedValue([mockTag]);
    await useTagStore.getState().fetchTags();
    expect(useTagStore.getState().tags).toEqual([mockTag]);
    expect(useTagStore.getState().isLoading).toBe(false);
  });

  it('fetchTags sets error on failure', async () => {
    vi.mocked(tagApi.getTags).mockRejectedValue(new Error('Network error'));
    await useTagStore.getState().fetchTags();
    expect(useTagStore.getState().error).toBe('Network error');
    expect(useTagStore.getState().isLoading).toBe(false);
  });

  it('fetchTags passes query and category to API', async () => {
    vi.mocked(tagApi.getTags).mockResolvedValue([]);
    await useTagStore.getState().fetchTags('react', 'prompt');
    expect(tagApi.getTags).toHaveBeenCalledWith('react', 'prompt');
  });

  it('createTag appends result to tags', async () => {
    vi.mocked(tagApi.createTag).mockResolvedValue(mockTag);
    const result = await useTagStore.getState().createTag('react');
    expect(result).toEqual(mockTag);
    expect(useTagStore.getState().tags).toContainEqual(mockTag);
  });

  it('createTag does not duplicate if tag already exists', async () => {
    useTagStore.setState({ tags: [mockTag] });
    vi.mocked(tagApi.createTag).mockResolvedValue(mockTag);
    await useTagStore.getState().createTag('react');
    expect(useTagStore.getState().tags.filter((t) => t.id === 'tag-1')).toHaveLength(1);
  });

  it('deleteTag removes tag from array', async () => {
    useTagStore.setState({ tags: [mockTag] });
    vi.mocked(tagApi.deleteTag).mockResolvedValue(undefined);
    await useTagStore.getState().deleteTag('tag-1');
    expect(useTagStore.getState().tags).toHaveLength(0);
  });

  it('tagEntity delegates to API', async () => {
    vi.mocked(tagApi.tagEntity).mockResolvedValue(undefined);
    await useTagStore.getState().tagEntity('tag-1', 'conv-1', 'conversation');
    expect(tagApi.tagEntity).toHaveBeenCalledWith('tag-1', 'conv-1', 'conversation');
  });

  it('untagEntity delegates to API', async () => {
    vi.mocked(tagApi.untagEntity).mockResolvedValue(undefined);
    await useTagStore.getState().untagEntity('tag-1', 'conv-1', 'conversation');
    expect(tagApi.untagEntity).toHaveBeenCalledWith('tag-1', 'conv-1', 'conversation');
  });
});
