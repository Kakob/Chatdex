import { Loader2 } from 'lucide-react';
import { ConversationCard } from './ConversationCard';
import type { StoredConversation } from '../../types';
import type { ApiTag } from '../../lib/api';
import type { FindingChipSummary } from '../../lib/detection/stats';

interface ConversationListProps {
  conversations: StoredConversation[];
  selectedId?: string | null;
  onSelect: (conversation: StoredConversation) => void;
  isLoading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  conversationTags?: Map<string, ApiTag[]>;
  findingSummaries?: Map<string, FindingChipSummary[]>;
  onTagClick?: (tagId: string) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  isLoading = false,
  hasMore = false,
  onLoadMore,
  conversationTags,
  findingSummaries,
  onTagClick,
  selectable = false,
  selectedIds,
  onToggleSelect,
}: ConversationListProps) {
  return (
    <div className="space-y-3">
      {conversations.map((conversation) => (
        <ConversationCard
          key={conversation.id}
          conversation={conversation}
          isSelected={selectedId === conversation.id}
          onClick={() => onSelect(conversation)}
          tags={conversationTags?.get(conversation.id)}
          findingSummaries={findingSummaries?.get(conversation.id)}
          onTagClick={onTagClick}
          selectable={selectable}
          selected={selectedIds?.has(conversation.id)}
          onToggleSelect={() => onToggleSelect?.(conversation.id)}
        />
      ))}

      {isLoading && (
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin text-gray-400" size={24} />
        </div>
      )}

      {!isLoading && hasMore && onLoadMore && (
        <button
          onClick={onLoadMore}
          className="w-full py-3 text-sm text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-lg transition-colors"
        >
          Load more conversations
        </button>
      )}
    </div>
  );
}
