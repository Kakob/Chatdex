import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { TagBadge } from './TagBadge';
import { useTagStore } from '../../stores/tagStore';
import type { ApiTag } from '../../lib/api';

interface TagInputProps {
  selectedTags: ApiTag[];
  onTagAdd: (tag: ApiTag) => void;
  onTagRemove: (tagId: string) => void;
  entityType?: string;
  placeholder?: string;
}

export function TagInput({
  selectedTags,
  onTagAdd,
  onTagRemove,
  entityType,
  placeholder = 'Add tag...',
}: TagInputProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { tags: allTags, fetchTags, createTag } = useTagStore();

  // Fetch tags on mount and when query changes
  useEffect(() => {
    fetchTags(query || undefined, entityType);
  }, [query, entityType, fetchTags]);

  // Filter out already-selected tags
  const suggestions = allTags.filter(
    (tag) => !selectedTags.find((st) => st.id === tag.id)
  );

  const showCreateOption = query.trim() && !allTags.find(
    (t) => t.name === query.trim().toLowerCase()
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleCreateAndAdd = useCallback(async () => {
    if (!query.trim()) return;
    try {
      const tag = await createTag(query.trim(), undefined, entityType);
      onTagAdd(tag);
      setQuery('');
      setIsOpen(false);
    } catch {
      // Tag creation failed silently
    }
  }, [query, entityType, createTag, onTagAdd]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = suggestions.length + (showCreateOption ? 1 : 0);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex < suggestions.length) {
        onTagAdd(suggestions[highlightIndex]);
        setQuery('');
        setIsOpen(false);
      } else if (showCreateOption) {
        handleCreateAndAdd();
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      {/* Selected tags */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedTags.map((tag) => (
            <TagBadge
              key={tag.id}
              name={tag.name}
              color={tag.color}
              onRemove={() => onTagRemove(tag.id)}
            />
          ))}
        </div>
      )}

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          setHighlightIndex(0);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500"
      />

      {/* Dropdown */}
      {isOpen && (suggestions.length > 0 || showCreateOption) && (
        <div
          ref={dropdownRef}
          className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg"
        >
          {suggestions.map((tag, i) => (
            <button
              key={tag.id}
              onClick={() => {
                onTagAdd(tag);
                setQuery('');
                setIsOpen(false);
              }}
              className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                i === highlightIndex
                  ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {tag.color && (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
              )}
              {tag.name}
              <span className="ml-auto text-xs text-gray-400">{tag.usageCount}</span>
            </button>
          ))}
          {showCreateOption && (
            <button
              onClick={handleCreateAndAdd}
              className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                highlightIndex === suggestions.length
                  ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Plus size={14} />
              Create &ldquo;{query.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
