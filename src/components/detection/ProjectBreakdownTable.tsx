import type { ProjectBreakdown } from '../../lib/detection/stats';
import { detectorLabel } from './severity';

export function ProjectBreakdownTable({ projects }: { projects: ProjectBreakdown[] }) {
  if (projects.length === 0) return null;

  const detectorIds = [
    ...new Set(projects.flatMap((p) => Object.keys(p.byDetector))),
  ].sort();

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
        Findings by project
      </h3>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-800">
            <th className="py-1.5 pr-2 font-medium">Project</th>
            <th className="py-1.5 px-2 font-medium text-right">Sessions</th>
            {detectorIds.map((id) => (
              <th key={id} className="py-1.5 px-2 font-medium text-right">
                {detectorLabel(id)}
              </th>
            ))}
            <th className="py-1.5 pl-2 font-medium text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr
              key={p.project}
              className="border-b border-gray-50 dark:border-gray-800/50 text-gray-700 dark:text-gray-300"
            >
              <td className="py-1.5 pr-2 font-mono truncate max-w-[240px]" title={p.project}>
                {p.project.split('/').pop() || p.project}
              </td>
              <td className="py-1.5 px-2 text-right">{p.sessionCount}</td>
              {detectorIds.map((id) => (
                <td key={id} className="py-1.5 px-2 text-right">
                  {p.byDetector[id] ?? 0}
                </td>
              ))}
              <td className="py-1.5 pl-2 text-right font-semibold">{p.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
