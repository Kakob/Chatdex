import type { DataSource } from '../../types';
import { ALL_SOURCES, SOURCE_META } from '../common/sourceMeta';

interface SearchFiltersProps {
  source: DataSource | null;
  onSourceChange: (source: DataSource | null) => void;
  resultCount: number;
  isLoading?: boolean;
}

type FilterOption = {
  value: DataSource | null;
  label: string;
  icon?: React.ReactNode;
};

const FILTER_OPTIONS: FilterOption[] = [
  { value: null, label: 'All' },
  ...ALL_SOURCES.map((source) => {
    const { label, Icon } = SOURCE_META[source];
    return { value: source, label, icon: <Icon size={14} /> };
  }),
];

export function SearchFilters({
  source,
  onSourceChange,
  resultCount,
  isLoading,
}: SearchFiltersProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value ?? 'all'}
            onClick={() => onSourceChange(option.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              source === option.value
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>

      <div className="text-sm text-gray-500 dark:text-gray-400">
        {isLoading ? (
          'Searching...'
        ) : (
          <>
            {resultCount} {resultCount === 1 ? 'result' : 'results'}
          </>
        )}
      </div>
    </div>
  );
}
