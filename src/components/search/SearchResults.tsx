import { MessageSquare, Calendar } from 'lucide-react';
import { HighlightedText } from './HighlightedText';
import { SourceIcon } from '../common/sourceMeta';
import type { SearchResult } from '../../lib/search';

interface SearchResultsProps {
  results: SearchResult[];
  query: string;
  onResultClick: (conversationId: string) => void;
  isLoading?: boolean;
}

export function SearchResults({
  results,
  query,
  onResultClick,
  isLoading,
}: SearchResultsProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl animate-pulse"
          >
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-3" />
            <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-full mb-2" />
            <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {results.map((result) => (
        <SearchResultItem
          key={result.conversation.id}
          result={result}
          query={query}
          onClick={() => onResultClick(result.conversation.id)}
        />
      ))}
    </div>
  );
}

function SearchResultItem({
  result,
  query,
  onClick,
}: {
  result: SearchResult;
  query: string;
  onClick: () => void;
}) {
  const { conversation, snippet, matches } = result;

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Get indices for name highlighting
  const nameMatch = matches.find((m) => m.key === 'name');

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <SourceIcon source={conversation.source} size={16} className="flex-shrink-0" />
          <h3 className="font-medium text-gray-900 dark:text-white truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
            <HighlightedText
              text={conversation.name}
              indices={nameMatch?.indices}
              query={query}
            />
          </h3>
        </div>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
        <HighlightedText text={snippet} query={query} />
      </p>

      <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-500">
        <div className="flex items-center gap-1">
          <Calendar size={12} />
          {formatDate(conversation.createdAt)}
        </div>
        <div className="flex items-center gap-1">
          <MessageSquare size={12} />
          {conversation.messageCount} messages
        </div>
        {conversation.source === 'claude-code' && conversation.projectPath && (
          <div className="truncate max-w-[200px]" title={conversation.projectPath}>
            {conversation.projectPath.split('/').slice(-2).join('/')}
          </div>
        )}
      </div>
    </button>
  );
}
