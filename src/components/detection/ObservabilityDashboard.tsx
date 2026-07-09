import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radar, HelpCircle } from 'lucide-react';
import {
  computeObservabilityStats,
  type ObservabilityStats,
} from '../../lib/detection/stats';
import { FindingsOverTimeChart } from './FindingsOverTimeChart';
import { DetectorHealthCards } from './DetectorHealthCards';
import { ProjectBreakdownTable } from './ProjectBreakdownTable';

export function ObservabilityDashboard() {
  const [stats, setStats] = useState<ObservabilityStats | null>(null);

  useEffect(() => {
    void computeObservabilityStats().then(setStats);
  }, []);

  if (!stats) return null;

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

      <FindingsOverTimeChart buckets={stats.findingsOverTime} />
      <DetectorHealthCards health={stats.detectorHealth} />
      <ProjectBreakdownTable projects={stats.perProject} />
    </section>
  );
}
