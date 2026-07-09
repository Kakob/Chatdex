import { useEffect, useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { findStaleSessions } from '../../lib/detection/staleness';
import { analyzeConversation } from '../../lib/detection/autoAnalyze';

interface StaleAnalysisBannerProps {
  /** Called after a bulk re-analysis completes so the dashboard can reload. */
  onReanalyzed: () => void;
}

export function StaleAnalysisBanner({ onReanalyzed }: StaleAnalysisBannerProps) {
  const [stale, setStale] = useState<string[]>([]);
  const [outdatedCount, setOutdatedCount] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    void findStaleSessions().then((report) => {
      setStale([...report.outdated, ...report.neverAnalyzed]);
      setOutdatedCount(report.outdated.length);
    });
  }, []);

  if (stale.length === 0) return null;

  const handleReanalyze = async () => {
    setProgress({ done: 0, total: stale.length });
    for (let i = 0; i < stale.length; i++) {
      try {
        await analyzeConversation(stale[i]);
      } catch (err) {
        console.error('[detection] bulk re-analysis failed for', stale[i], err);
      }
      setProgress({ done: i + 1, total: stale.length });
    }
    setProgress(null);
    setStale([]);
    onReanalyzed();
  };

  const description =
    outdatedCount > 0
      ? `Detectors have been updated since ${outdatedCount} session(s) were last analyzed`
      : `${stale.length} session(s) have never been analyzed`;

  return (
    <div
      data-testid="stale-analysis-banner"
      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 text-xs text-violet-900 dark:text-violet-200"
    >
      <RefreshCw size={14} className="flex-shrink-0" />
      <span className="flex-1">
        {description}
        {outdatedCount > 0 && stale.length > outdatedCount
          ? ` (+${stale.length - outdatedCount} never analyzed)`
          : ''}
        .
      </span>
      <button
        onClick={handleReanalyze}
        disabled={!!progress}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 transition-colors"
      >
        {progress ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            {progress.done}/{progress.total}
          </>
        ) : (
          'Re-analyze'
        )}
      </button>
    </div>
  );
}
