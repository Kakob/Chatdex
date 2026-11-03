import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { SOURCE_META } from '../common/sourceMeta';
import type { ImportProgress as ImportProgressType } from '../../lib/import';
import type { ImportResult } from '../../lib/import';

function groupWarningsByFile(warnings: ImportResult['parseWarnings']): Array<[string, number[]]> {
  const byFile = new Map<string, number[]>();
  for (const w of warnings) {
    const lines = byFile.get(w.filename) ?? [];
    lines.push(w.line);
    byFile.set(w.filename, lines);
  }
  return [...byFile.entries()];
}

interface ImportProgressProps {
  progress: ImportProgressType | null;
  error: string | null;
  result: ImportResult | null;
  onReset: () => void;
}

export function ImportProgress({
  progress,
  error,
  result,
  onReset,
}: ImportProgressProps) {
  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="text-red-500 mt-0.5" size={20} />
          <div className="flex-1">
            <h3 className="font-semibold text-red-700 dark:text-red-400">
              Import Failed
            </h3>
            <p className="text-sm text-red-600 dark:text-red-300 mt-1">
              {error}
            </p>
            <button
              onClick={onReset}
              className="mt-4 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <CheckCircle className="text-green-500 mt-0.5" size={20} />
          <div className="flex-1">
            <h3 className="font-semibold text-green-700 dark:text-green-400">
              Import Complete
            </h3>
            <div className="text-sm text-green-600 dark:text-green-300 mt-2 space-y-1">
              <p>{result.conversationsAdded} conversations imported</p>
              {result.conversationsSkipped > 0 && (
                <p>{result.conversationsSkipped} duplicates skipped</p>
              )}
              <p>{result.messagesAdded} messages imported</p>
              <p className="text-xs mt-2">
                Source: {SOURCE_META[result.source].label}
              </p>
            </div>
            {result.parseWarnings.length > 0 && (
              <div
                role="status"
                className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200"
              >
                <p className="font-medium">
                  {result.parseWarnings.length}{' '}
                  {result.parseWarnings.length === 1 ? 'line' : 'lines'} could not be parsed and
                  {result.parseWarnings.length === 1 ? ' was' : ' were'} skipped
                </p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {groupWarningsByFile(result.parseWarnings).map(([filename, lines]) => (
                    <li key={filename}>
                      {filename}: line{lines.length === 1 ? '' : 's'} {lines.join(', ')}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs">
                  The rest of each file was imported. The original file is retained unchanged.
                </p>
              </div>
            )}
            <button
              onClick={onReset}
              className="mt-4 px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
            >
              Import More
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (progress) {
    const phaseLabels = {
      parsing: 'Parsing files...',
      storing: 'Storing data...',
      complete: 'Complete!',
    };

    const percent = progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

    return (
      <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Loader2 className="text-violet-500 animate-spin" size={20} />
          <span className="font-medium text-violet-700 dark:text-violet-400">
            {phaseLabels[progress.phase]}
          </span>
        </div>

        {progress.filename && (
          <p className="text-sm text-violet-600 dark:text-violet-300 mb-2">
            {progress.filename}
          </p>
        )}

        <div className="w-full bg-violet-200 dark:bg-violet-800 rounded-full h-2">
          <div
            className="bg-violet-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>

        <p className="text-xs text-violet-500 mt-2">
          {progress.current} / {progress.total}
        </p>
      </div>
    );
  }

  return null;
}
