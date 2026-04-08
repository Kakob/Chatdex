import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Anchor, Search, X, Loader2, Folder, Plus, Tag } from 'lucide-react';
import { AnchorCard } from '../components/anchors';
import { TagBadge } from '../components/common/TagBadge';
import { useAnchorStore } from '../stores/anchorStore';
import { useToastStore } from '../stores/toastStore';
import { tagApi, anchorApi } from '../lib/api';
import type { ApiAnchor } from '../lib/api';

const PRIORITIES = [
  { value: '', label: 'All' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const TAG_COLORS = [
  '#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626',
  '#db2777', '#7c2d12', '#475569', '#0891b2', '#4f46e5',
];

export function KnowledgePage() {
  const navigate = useNavigate();
  const {
    anchors,
    isLoading,
    hasMore,
    error,
    filters,
    folders,
    tags,
    setFilter,
    fetchAnchors,
    fetchFolders,
    fetchTags,
    deleteAnchor,
  } = useAnchorStore();
  const addToast = useToastStore((s) => s.addToast);

  const [showTagComposer, setShowTagComposer] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
  const [showFolderComposer, setShowFolderComposer] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  useEffect(() => {
    fetchFolders();
    fetchTags();
  }, [fetchFolders, fetchTags]);

  useEffect(() => {
    fetchAnchors({ reset: true });
  }, [filters.tagId, filters.priority, filters.folder, filters.search, fetchAnchors]);

  const handleLoadMore = useCallback(() => {
    fetchAnchors();
  }, [fetchAnchors]);

  const handleNavigate = (anchor: ApiAnchor) => {
    if (anchor.messageId) {
      navigate(`/conversations/${anchor.conversationId}?scrollTo=${anchor.messageId}`);
    } else {
      navigate(`/conversations/${anchor.conversationId}`);
    }
  };

  const handleEdit = (_anchor: ApiAnchor) => {
    // TODO: open edit modal
  };

  const handleDelete = async (anchor: ApiAnchor) => {
    if (!confirm('Delete this anchored item?')) return;
    await deleteAnchor(anchor.id);
    addToast('Anchor deleted');
  };

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    await tagApi.createTag({ name, color: newTagColor, category: 'anchor' });
    setNewTagName('');
    fetchTags();
    addToast(`Tag "${name}" created`);
  };

  const handleDeleteTag = async (tagId: string) => {
    if (!confirm('Delete this tag? It will be removed from all anchors.')) return;
    await tagApi.deleteTag(tagId);
    if (filters.tagId === tagId) setFilter('tagId', null);
    fetchTags();
    addToast('Tag deleted');
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    await anchorApi.createFolder(name);
    setNewFolderName('');
    fetchFolders();
    addToast(`Folder "${name}" created`);
  };

  const handleDeleteFolder = async (name: string) => {
    if (!confirm(`Delete folder "${name}"? Anchors in this folder won't be deleted.`)) return;
    await anchorApi.deleteFolder(name);
    if (filters.folder === name) setFilter('folder', null);
    fetchFolders();
    addToast('Folder deleted');
  };

  const hasActiveFilters = filters.search || filters.priority || filters.tagId || filters.folder;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">Knowledge Base</h1>
        <p className="text-gray-600 dark:text-gray-400">
          {anchors.length} anchored item{anchors.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
          placeholder="Search anchored items..."
          className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
        {filters.search && (
          <button onClick={() => setFilter('search', '')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Tag filter */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Tag size={14} className="text-gray-400" />
        <button
          onClick={() => setFilter('tagId', null)}
          className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
            filters.tagId === null
              ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
              : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >All</button>
        {tags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => setFilter('tagId', tag.id === filters.tagId ? null : tag.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full transition-colors ${
              filters.tagId === tag.id
                ? 'ring-2 ring-violet-500 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {tag.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />}
            {tag.name}
          </button>
        ))}
        <button
          onClick={() => setShowTagComposer(!showTagComposer)}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-full transition-colors"
          title="Create tag"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Tag composer */}
      {showTagComposer && (
        <div className="flex items-center gap-2 mb-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <input
            type="text"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTag(); }}
            placeholder="Tag name..."
            autoFocus
            className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          <div className="flex gap-1">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewTagColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-all ${newTagColor === c ? 'border-gray-900 dark:border-white scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            onClick={handleCreateTag}
            disabled={!newTagName.trim()}
            className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >Add</button>
        </div>
      )}

      {/* Existing tags management (delete) */}
      {showTagComposer && tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {tags.map((tag) => (
            <TagBadge key={tag.id} name={tag.name} color={tag.color} onRemove={() => handleDeleteTag(tag.id)} />
          ))}
        </div>
      )}

      {/* Folder filter */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Folder size={14} className="text-gray-400" />
        <button
          onClick={() => setFilter('folder', null)}
          className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
            filters.folder === null
              ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
              : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >All</button>
        {folders.map((f) => (
          <button
            key={f}
            onClick={() => setFilter('folder', f === filters.folder ? null : f)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              filters.folder === f
                ? 'bg-violet-600 text-white'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >{f}</button>
        ))}
        <button
          onClick={() => setShowFolderComposer(!showFolderComposer)}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-full transition-colors"
          title="Create folder"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Folder composer */}
      {showFolderComposer && (
        <div className="flex items-center gap-2 mb-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); }}
            placeholder="Folder name..."
            autoFocus
            className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          <button
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim()}
            className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >Add</button>
        </div>
      )}

      {/* Existing folders management (delete) */}
      {showFolderComposer && folders.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {folders.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
              <Folder size={10} />{f}
              <button onClick={() => handleDeleteFolder(f)} className="ml-0.5 hover:text-red-500 transition-colors"><X size={10} /></button>
            </span>
          ))}
        </div>
      )}

      {/* Priority filter */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-gray-400 font-medium">Priority:</span>
        {PRIORITIES.map((p) => (
          <button
            key={p.value}
            onClick={() => setFilter('priority', p.value || null)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              (filters.priority || '') === p.value
                ? 'bg-violet-600 text-white'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* List or empty state */}
      {!isLoading && anchors.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Anchor size={48} className="mx-auto mb-4 opacity-50" />
          <p>{hasActiveFilters ? 'No items match your filters' : 'No anchored items yet'}</p>
          <p className="text-sm mt-2">
            {hasActiveFilters
              ? 'Try adjusting your filters'
              : 'Anchor messages in conversations to build your knowledge base'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {anchors.map((anchor) => (
            <AnchorCard
              key={anchor.id}
              anchor={anchor}
              onNavigate={handleNavigate}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}

          {isLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="animate-spin text-gray-400" size={24} />
            </div>
          )}

          {!isLoading && hasMore && (
            <button onClick={handleLoadMore} className="w-full py-3 text-sm text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-lg transition-colors">
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
