/**
 * Project-scoped engineering entry. Reads normal Chatdex project and concept
 * records; it does not create models, sync fixtures or infer code on opening.
 * Only the explicitly installed, authored examples have usable adapters yet.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getUnderstandingProject } from '../lib/db/understanding';
import { db } from '../lib/db/schema';
import { engineeringExampleKind } from '../lib/engineering/demoProjects';
import { EngineeringExplorerPage } from './EngineeringExplorerPage';
import { TodoExplorerPage } from './TodoExplorerPage';
import { GenericEngineeringExplorerPage } from './GenericEngineeringExplorerPage';
import type { LandscapeRegion } from '../types/landscape';
import type { UnderstandingProject } from '../types/understanding';

interface LoadedProject {
  project: UnderstandingProject;
  concepts: LandscapeRegion[];
}

export function EngineeringProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [loaded, setLoaded] = useState<LoadedProject | null>(null);
  const [error, setError] = useState<{ projectId: string; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    void Promise.all([
      getUnderstandingProject(id),
      db.landscapeRegions.where('projectId').equals(id).toArray(),
    ]).then(([project, concepts]) => {
      if (cancelled) return;
      if (!project || project.reviewState === 'rejected') {
        setError({ projectId: id, text: 'Project not found or rejected.' });
        return;
      }
      setLoaded({ project, concepts });
    }).catch((reason: unknown) => {
      if (!cancelled) setError({ projectId: id, text: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => { cancelled = true; };
  }, [id]);

  const currentError = !id ? 'Project ID missing.' : error?.projectId === id ? error.text : null;
  if (currentError) {
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-xl border border-gray-300 bg-white p-6 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
        {currentError} <Link to="/projects" className="text-violet-600 underline">Back to Projects</Link>
      </div>
    );
  }
  if (!loaded || loaded.project.id !== id) return <p className="text-sm text-gray-500">Loading engineering model…</p>;
  const kind = engineeringExampleKind(loaded.project.id);

  const editor = kind === 'event-queue'
    ? <EngineeringExplorerPage projectId={loaded.project.id} projectName={loaded.project.name} concepts={loaded.concepts} />
    : kind === 'todo-list'
      ? <TodoExplorerPage projectId={loaded.project.id} projectName={loaded.project.name} concepts={loaded.concepts} />
      : <GenericEngineeringExplorerPage projectId={loaded.project.id} projectName={loaded.project.name} />;

  return (
    <div className="space-y-2">
      <nav aria-label="Engineering view choice" className="mx-auto flex max-w-7xl justify-end">
        <Link to={'/projects/' + loaded.project.id + '/engineering/source'}
          className="rounded-lg border border-violet-300 px-3 py-2 text-xs font-semibold text-violet-700 dark:border-violet-800 dark:text-violet-300">
          Analyze real repository source
        </Link>
      </nav>
      {editor}
    </div>
  );

}
