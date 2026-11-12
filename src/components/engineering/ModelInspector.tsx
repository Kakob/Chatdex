/**
 * Shared engineering proposal inspector used by both small applications.
 * The actual program stays untouched: a draft is a local model overlay only.
 */
import { useState } from 'react';
import { AlertTriangle, ArrowLeft, GitBranch, Pencil, RotateCcw } from 'lucide-react';
import type { EngineeringExampleKind } from '../../lib/engineering/demoProjects';
import { exampleConceptId } from '../../lib/engineering/demoProjects';
import { ModelImpactPreview } from './ModelImpactPreview';
import { sourceRevisionLabel } from '../../lib/engineering/codingStore';
import {
  proposeModelEdit,
  relationForNode,
  withdrawModelEdit,
  type ModelElement,
  type ProjectEngineeringModel,
} from '../../lib/engineering/modelStore';
import { button, muted, primaryButton } from './ui';


function EditTarget({
  element,
  projectId,
  onRefresh,
}: {
  element: ModelElement;
  projectId: string;
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(element.proposed?.title ?? element.current.title);
  const [description, setDescription] = useState(element.proposed?.description ?? element.current.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await proposeModelEdit(projectId, element.id, { title, description });
      await onRefresh();
      setEditing(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setError(null);
    try {
      await withdrawModelEdit(projectId, element.id);
      await onRefresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-violet-200 p-3 text-sm dark:border-violet-800" aria-label="Model definition">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">Engineering definition · {element.kind}</p>
        <span className={'text-[10px] ' + muted}>{element.proposed ? 'Draft exists' : 'No pending edits'}</span>
      </div>
      <div>
        <p className={'text-[10px] uppercase ' + muted}>Current project definition</p>
        <p className="font-semibold">{element.current.title}</p>
        <p className={'mt-1 text-xs leading-5 ' + muted}>{element.current.description || 'No description written'}</p>
      </div>

      {element.proposed && (
        <div className="rounded-md border border-dashed border-amber-500 bg-amber-50 p-2 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" data-testid="model-proposal-preview">
          <p className="text-xs font-semibold">Proposed only — not implemented or verified</p>
          <p className="font-semibold">{element.proposed.title}</p>
          <p className="text-xs leading-5">{element.proposed.description || 'No description'}</p>
          {element.stale && (
            <p className="mt-1 flex items-center gap-1 text-xs font-medium" role="alert">
              <AlertTriangle size={13} /> Source definition changed: withdraw and reauthor before updating.
            </p>
          )}
        </div>
      )}

      {editing ? (
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="block text-xs font-medium">
            Proposed name
            <input aria-label="Proposed name" maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-950 dark:text-white" />
          </label>
          <label className="block text-xs font-medium">
            Proposed description
            <textarea aria-label="Proposed description" rows={3} maxLength={1200} value={description} onChange={(event) => setDescription(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-950 dark:text-white" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primaryButton} disabled={busy || !title.trim() || element.stale}>Save model proposal</button>
            <button type="button" className={button} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => setEditing(true)} disabled={element.stale}>
            <Pencil size={14} /> {element.proposed ? 'Revise proposal' : 'Propose model edit'}
          </button>
          {element.proposed && (
            <button type="button" className={button} onClick={() => void withdraw()} disabled={busy}>
              <RotateCcw size={14} /> Withdraw draft
            </button>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
      <details>
        <summary className="cursor-pointer text-xs font-medium">Model revision history ({element.revisions.length})</summary>
        {element.revisions.length === 0 ? (
          <p className={'mt-2 text-xs ' + muted}>No proposed revisions for this model element.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {element.revisions.map((revision) => (
              <li key={revision.id} className="border-l-2 border-gray-300 pl-2 text-xs dark:border-gray-600">
                <p className="font-medium">#{revision.sequence} · {revision.action === 'propose' ? 'Proposed' : 'Withdrawn'} · {revision.at.toLocaleString()}</p>
                <p className={muted}>{revision.baseline.title} → {revision.proposed.title}</p>
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}

export function ModelInspector({
  projectId,
  kind,
  nodeId,
  model,
  onRefresh,
}: {
  projectId: string;
  /** Optional legacy slug adapter. Generic projects pass the full concept ID. */
  kind?: EngineeringExampleKind;
  nodeId: string;
  model: ProjectEngineeringModel | null;
  onRefresh: () => Promise<void>;
}) {
  const [transitionId, setTransitionId] = useState<string | null>(null);
  if (!model) return <p className={'text-xs ' + muted}>Loading persistent engineering model…</p>;

  const conceptId = model.elements[nodeId] ? nodeId : kind ? exampleConceptId(kind, nodeId) : nodeId;
  const targetId = transitionId ?? conceptId;
  const element = model.elements[targetId];
  const relations = relationForNode(model, conceptId);
  const linkedCode = model.codeRevisions.filter((revision) => revision.targetId === targetId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <section className="space-y-2" aria-label="Persistent engineering model">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-semibold"><GitBranch size={14} /> Shared model</span>
        {transitionId && <button type="button" onClick={() => setTransitionId(null)} className="inline-flex items-center gap-1 text-xs text-violet-700 underline dark:text-violet-300"><ArrowLeft size={12}/> Back to component</button>}
      </div>
      {!element ? (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
          No matching project model record. Open Projects and choose Add engineering examples to install missing example relationships.
        </p>
      ) : (
        <EditTarget
          key={targetId + ':' + element.revisions.length}
          projectId={projectId}
          element={element}
          onRefresh={onRefresh}
        />
      )}
      {!transitionId && (
        <details>
          <summary className="cursor-pointer text-xs font-medium">Connected transitions ({relations.length})</summary>
          {relations.length === 0 ? (
            <p className={'mt-2 text-xs ' + muted}>No authored relationships for this concept.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {relations.map((relation) => {
                const wording = model.elements[relation.id];
                return (
                  <li key={relation.id}>
                    <button type="button" className="w-full rounded-lg border border-gray-200 p-2 text-left text-xs hover:border-violet-400 dark:border-gray-700" onClick={() => setTransitionId(relation.id)}>
                      <span className="block font-medium">{wording?.proposed?.title ?? relation.title}</span>
                      <span className={'block ' + muted}>{relation.kind.replace('_', ' ')} · {wording?.proposed ? 'Proposed wording' : 'Authored relationship'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </details>
      )}
      {element && <ModelImpactPreview model={model} targetId={targetId} />}
      <details aria-label="Linked source work" className="rounded-lg border border-gray-200 p-2 text-xs dark:border-gray-700">
        <summary className="cursor-pointer font-semibold">Linked code revisions ({linkedCode.length})</summary>
        {linkedCode.length === 0 ? (
          <p className={'mt-2 ' + muted}>No staged code changes for this model entity. Use Code → Build through this model to create one.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {linkedCode.slice(0, 8).map((revision) => (
              <li key={revision.id} className="border-l-2 border-violet-300 pl-2 dark:border-violet-700">
                <p className="font-medium">{revision.actor === 'agent' ? 'Agent-supplied' : 'Human'} · {sourceRevisionLabel(revision, model.codeWrites).replaceAll('-', ' ')}</p>
                <p className={muted}>{revision.path} · {revision.intent}</p>
                <p className={muted}>Model source code change is not automatically verified by tests.</p>
              </li>
            ))}
          </ol>
        )}
      </details>
      <p className={'text-[11px] leading-4 ' + muted}>
        Only design proposals are stored here. Live code, tests and queue/task behavior remain unchanged. Proposals are local to this browser.
      </p>
    </section>
  );
}
