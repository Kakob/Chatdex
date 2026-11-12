import { useMemo } from 'react';
import { Network, ShieldAlert } from 'lucide-react';
import { previewModelImpact, type ImpactPreview } from '../../lib/engineering/modelGraph';
import type { ProjectEngineeringModel } from '../../lib/engineering/modelStore';
import { muted } from './ui';

/** Bounded, read-only impact exploration: not a compiler, not a correctness proof. */
export function ModelImpactPreview({ model, targetId }: { model: ProjectEngineeringModel; targetId: string }) {
  const impact: ImpactPreview | null = useMemo(() => {
    try {
      return previewModelImpact(model, targetId, 2);
    } catch {
      return null;
    }
  }, [model, targetId]);

  if (!impact) return null;
  const nodesById = new Map(model.concepts.map((concept) => [concept.id, concept]));
  const edgesById = new Map(model.transitions.map((edge) => [edge.id, edge]));
  const paths = [...new Set(impact.sourceBindings.map((binding) => binding.path))];
  return (
    <details aria-label="Potential change impact" className="rounded-lg border border-gray-200 p-2 text-xs dark:border-gray-700">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold">
        <Network size={14} /> Potential impact preview
      </summary>
      <div className="mt-2 space-y-2">
        <p className={'flex items-start gap-1 leading-5 ' + muted}>
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          Candidates based on authored, directed relationships (up to 2 hops).
          Not a verified dependency closure or an implementation plan.
        </p>
        <div>
          <p className="font-medium">Connected concepts ({impact.candidateNodeIds.length})</p>
          {impact.candidateNodeIds.length ? (
            <ul className="mt-1 flex flex-wrap gap-1">
              {impact.candidateNodeIds.slice(0, 18).map((id) =>
                <li key={id} className="rounded bg-gray-100 px-2 py-1 dark:bg-gray-800">
                  {nodesById.get(id)?.title ?? id}
                </li>
              )}
            </ul>
          ) : <p className={muted}>No traversable dependencies in this model.</p>}
        </div>
        <div>
          <p className="font-medium">Related relationships ({impact.relevantRelationIds.length})</p>
          <p className={'mt-1 leading-5 ' + muted}>
            {impact.relevantRelationIds.slice(0, 12).map((id) => edgesById.get(id)?.title ?? id).join(' · ') || 'None'}
          </p>
        </div>
        <div>
          <p className="font-medium">Source paths to inspect ({paths.length})</p>
          {paths.length ? (
            <ul className="mt-1 space-y-1 font-mono text-[11px] break-all">
              {paths.slice(0, 12).map((path) => <li key={path}>{path}</li>)}
            </ul>
          ) : <p className={muted}>No bound source paths.</p>}
        </div>
      </div>
    </details>
  );
}
