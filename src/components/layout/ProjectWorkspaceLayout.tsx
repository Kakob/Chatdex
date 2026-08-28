import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { FolderKanban, GitCompare, History, Lightbulb, PencilRuler } from 'lucide-react';
import { getUnderstandingProject, getAssociationsForProject } from '../../lib/db/understanding';
import { countPendingForProject } from '../../lib/understanding/pendingReviews';
import type { UnderstandingProject } from '../../types/understanding';

const WORKFLOW_TABS = [
  { segment: 'investigate', label: 'Investigate History', icon: History },
  { segment: 'understanding', label: 'Current Understanding', icon: Lightbulb },
  { segment: 'intents', label: 'Intent Trace', icon: GitCompare },
  { segment: 'prepare', label: 'Prepare Change', icon: PencilRuler },
] as const;

export function ProjectWorkspaceLayout() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [project, setProject] = useState<UnderstandingProject | null | undefined>(undefined);
  const [sourceCount, setSourceCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    void Promise.all([
      getUnderstandingProject(id),
      getAssociationsForProject(id),
      countPendingForProject(id),
    ]).then(([loadedProject, associations, pending]) => {
      if (cancelled) return;
      setProject(loadedProject ?? null);
      setSourceCount(
        associations.filter((association) => association.reviewState !== 'rejected').length
      );
      setPendingCount(pending);
    });
    return () => {
      cancelled = true;
    };
  }, [id, location.pathname]);

  useEffect(() => {
    if (!id || !project) return;
    const section =
      WORKFLOW_TABS.find(({ segment }) => location.pathname.includes(`/${segment}`))
        ?.segment ?? 'overview';
    localStorage.setItem('chatdex.lastProjectId', id);
    localStorage.setItem('chatdex.lastProjectSection', section);
  }, [id, location.pathname, project]);

  if (project === undefined) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading project…</p>;
  }

  if (!project || !id) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center">
        <p className="text-gray-900 dark:text-white font-medium">Project not found</p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          It may have been rejected or removed from this browser.
        </p>
        <Link
          to="/projects"
          className="inline-block mt-4 text-sm text-violet-600 dark:text-violet-400 hover:underline"
        >
          Choose another project
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[96rem] mx-auto">
      <header className="mb-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <Link
            to={`/projects/${id}`}
            className="flex min-w-0 items-center gap-2 text-gray-900 dark:text-white hover:text-violet-600 dark:hover:text-violet-400"
          >
            <FolderKanban size={18} className="text-violet-500 shrink-0" />
            <span className="font-semibold truncate">{project.name}</span>
          </Link>
          <span className="text-xs text-gray-400">
            {sourceCount} source{sourceCount === 1 ? '' : 's'}
          </span>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
              {pendingCount} proposal{pendingCount === 1 ? '' : 's'} to review
            </span>
          )}
          <Link
            to="/projects"
            className="ml-auto text-xs text-gray-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-400"
          >
            Switch project
          </Link>
        </div>

        <nav className="flex overflow-x-auto px-2" aria-label="Project workflow">
          {WORKFLOW_TABS.map(({ segment, label, icon: Icon }) => (
            <NavLink
              key={segment}
              to={`/projects/${id}/${segment}`}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-violet-500 text-violet-700 dark:text-violet-300'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <Outlet />
    </div>
  );
}
