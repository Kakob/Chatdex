// Literal in-source search controls (SPEC-decision-investigation §8.6).
// The query is exact text — never rewritten, never expanded to synonyms.

import { forwardRef } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';

interface WorkbenchSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  currentIndex: number; // 0-based; -1 when no matches
  onNavigate: (direction: 1 | -1) => void;
}

export const WorkbenchSearch = forwardRef<HTMLInputElement, WorkbenchSearchProps>(
  function WorkbenchSearch(
    { query, onQueryChange, matchCount, currentIndex, onNavigate },
    ref
  ) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            ref={ref}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onNavigate(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Search this source (literal)…"
            aria-label="Literal search within this source"
            className="pl-7 pr-2 py-1.5 w-64 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
        {query.trim() && (
          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
            {matchCount === 0 ? 'No matches' : `${currentIndex + 1}/${matchCount}`}
          </span>
        )}
        <button
          type="button"
          onClick={() => onNavigate(-1)}
          disabled={matchCount === 0}
          title="Previous match ([)"
          aria-label="Previous match"
          className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          onClick={() => onNavigate(1)}
          disabled={matchCount === 0}
          title="Next match (])"
          aria-label="Next match"
          className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <ChevronDown size={14} />
        </button>
      </div>
    );
  }
);
