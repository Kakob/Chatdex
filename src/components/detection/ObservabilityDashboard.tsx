import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radar, HelpCircle } from 'lucide-react';
import {
  computeObservabilityStats,
  type ObservabilityStats,
} from '../../lib/detection/stats';
import { FindingsOverTimeChart } from './FindingsOverTimeChart';
import { DetectorHealthCards } from './DetectorHealthCards';
import { ProjectBreakdownTable } from './ProjectBreakdownTable';
import { StaleAnalysisBanner } from './StaleAnalysisBanner';

export function ObservabilityDashboard() {
  const [stats, setStats] = useState<ObservabilityStats | null>(null);

  const reload = useCallback(() => {
    void computeObservabilityStats().then(setStats);
  }, []);

  useEffect(reload, [reload]);

  if (!stats) return null;

  const unknownToolTotal = Object.values(stats.unknownTools).reduce((a, b) => a + b, 0);

  return (
    <section className="mt-8 space-y-4" data-testid="observability-dashboard">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radar size={18} className="text-violet-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Agent observability
          </h2>
          <span className="text-xs text-gray-400">
            {stats.totalFindings} findings across {stats.analyzedSessionCount} analyzed sessions
            {unknownToolTotal > 0 && (
              <span
                title={Object.entries(stats.unknownTools)
                  .map(([tool, n]) => `${tool}: ${n}`)
                  .join(', ')}
              >
                {' '}· {unknownToolTotal} call(s) to unmapped tools
              </span>
            )}
          </span>
        </div>
        <Link
          to="/how-detection-works"
          className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
        >
          <HelpCircle size={12} />
          How detection works
        </Link>
      </div>

      <StaleAnalysisBanner onReanalyzed={reload} />

      <FindingsOverTimeChart buckets={stats.findingsOverTime} />
      <DetectorHealthCards health={stats.detectorHealth} />
      <ProjectBreakdownTable projects={stats.perProject} />
    </section>
  );
}
