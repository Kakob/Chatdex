import { useState, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { MessageSquare, Globe, Terminal, Filter, CheckSquare } from 'lucide-react';
import { ConversationList, ConversationView } from '../components/conversations';
import { BatchTagBar } from '../components/conversations/BatchTagBar';
import { TagBadge } from '../components/common/TagBadge';
import { useConversations, useConversation, useConversationTags } from '../hooks';
import { useFindingSummaries } from '../hooks/useFindingSummaries';
import { useTagStore } from '../stores/tagStore';
import type { StoredConversation, DataSource } from '../types';

export function ConversationsPage() {
  const { id: urlId } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [sourceFilter, setSourceFilter] = useState<DataSource | undefined>(undefined);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectedId = urlId || null;
  const highlightQuery = searchParams.get('highlight') || undefined;

  const { tags: allTags, fetchTags } = useTagStore();

  // Fetch all tags on mount
  useState(() => {
    fetchTags();
  });

  const {
    conversations,
    isLoading,
    hasMore,
    loadMore,
  } = useConversations({ source: sourceFilter });

  const {
    conversation: selectedConversation,
    messages,
    isLoading: messagesLoading,
  } = useConversation(selectedId);

  // Fetch tags for visible conversations
  const conversationIds = useMemo(
    () => conversations.map((c) => c.id),
    [conversations]
  );
  const { tagsMap, refresh: refreshTags } = useConversationTags(conversationIds);
  const findingSummaries = useFindingSummaries(conversationIds);

  // Filter conversations by selected tags
  const filteredConversations = useMemo(() => {
    if (selectedTagIds.size === 0) return conversations;
    return conversations.filter((c) => {
      const tags = tagsMap.get(c.id);
      if (!tags) return false;
      return tags.some((t) => selectedTagIds.has(t.id));
    });
  }, [conversations, selectedTagIds, tagsMap]);

  const handleSelect = (conversation: StoredConversation) => {
    navigate(`/conversations/${conversation.id}`, { replace: true });
  };

  const handleBack = () => {
    navigate('/conversations', { replace: true });
  };

  const toggleTagFilter = (tagId: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Show conversation detail view
  if (selectedId && selectedConversation && !messagesLoading) {
    return (
      <ConversationView
        conversation={selectedConversation}
        messages={messages}
        onBack={handleBack}
        highlightQuery={highlightQuery}
      />
    );
  }

  // Empty state
  if (!isLoading && conversations.length === 0) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
            Conversations
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Browse all your Claude conversations
          </p>
        </div>

        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <MessageSquare size={48} className="mx-auto mb-4 opacity-50" />
          <p>No conversations yet</p>
          <p className="text-sm mt-2">
            Import your Claude data to browse conversations
          </p>
        </div>
      </div>
    );
  }

  // Collect tags that are actually used on visible conversations
  const usedTags = allTags.filter((tag) => {
    for (const [, tags] of tagsMap) {
      if (tags.some((t) => t.id === tag.id)) return true;
    }
    return false;
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
            Conversations
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {filteredConversations.length} conversation{filteredConversations.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Batch select toggle */}
          <button
            onClick={() => {
              setSelectionMode(!selectionMode);
              setSelectedIds(new Set());
            }}
            className={`p-2 rounded-lg transition-colors ${
              selectionMode
                ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600'
                : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            title="Select conversations"
          >
            <CheckSquare size={18} />
          </button>

          {/* Source Filter */}
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <div className="flex gap-1">
              <button
                onClick={() => setSourceFilter(undefined)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  sourceFilter === undefined
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setSourceFilter('claude.ai')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${
                  sourceFilter === 'claude.ai'
                    ? 'bg-violet-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <Globe size={14} />
                Claude.ai
              </button>
              <button
                onClick={() => setSourceFilter('claude-code')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${
                  sourceFilter === 'claude-code'
                    ? 'bg-emerald-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <Terminal size={14} />
                Claude Code
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tag filter pills */}
      {usedTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {selectedTagIds.size > 0 && (
            <button
              onClick={() => setSelectedTagIds(new Set())}
              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline"
            >
              Clear filters
            </button>
          )}
          {usedTags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => toggleTagFilter(tag.id)}
              className={`transition-opacity ${
                selectedTagIds.size > 0 && !selectedTagIds.has(tag.id) ? 'opacity-40' : ''
              }`}
            >
              <TagBadge name={tag.name} color={tag.color} />
            </button>
          ))}
        </div>
      )}

      <ConversationList
        conversations={filteredConversations}
        selectedId={selectedId}
        onSelect={handleSelect}
        isLoading={isLoading}
        hasMore={hasMore}
        onLoadMore={loadMore}
        conversationTags={tagsMap}
        findingSummaries={findingSummaries}
        onTagClick={toggleTagFilter}
        selectable={selectionMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
      />

      {/* Batch tag bar */}
      {selectionMode && selectedIds.size > 0 && (
        <BatchTagBar
          selectedCount={selectedIds.size}
          selectedIds={Array.from(selectedIds)}
          onClear={() => {
            setSelectedIds(new Set());
            setSelectionMode(false);
          }}
          onTagsApplied={refreshTags}
        />
      )}
    </div>
  );
}
