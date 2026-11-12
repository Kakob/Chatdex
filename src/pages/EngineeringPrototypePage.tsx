// EXPERIMENTAL engineering workbench (docs/changes/engineering-abstraction-prototype/PLAN.md).
// Synthetic Event Queue project in a local-only database; no AI, no sync, no
// command execution. The user edits a guarantee, inspects derived
// obligations, hands off, and reconciles imported test evidence.

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { ChangePanel } from '../components/engineering/ChangePanel';
import { ConceptTree, ConceptView } from '../components/engineering/ConceptView';
import { EvidencePanel } from '../components/engineering/EvidencePanel';
import { Badge, button, muted } from '../components/engineering/ui';
import { referenceRun } from '../lib/engineering/bindings';
import {
  acceptProposal,
  approveProposal,
  confirmBinding,
  ensureSeeded,
  importEvidence,
  loadSnapshot,
  resetPrototype,
  saveDraft,
  withdrawProposal,
  type EngineeringSnapshot,
} from '../lib/engineering/storage';

const DEFAULT_CONCEPT = 'eq-delivery';

export function EngineeringPrototypePage() {
  const [snapshot, setSnapshot] = useState<EngineeringSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const conceptId = params.get('concept') ?? DEFAULT_CONCEPT;

  const refresh = useCallback(async () => {
    setSnapshot(await loadSnapshot());
  }, []);

  useEffect(() => {
    ensureSeeded()
      .then(refresh)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setError(null);
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      await refresh();
    },
    [refresh]
  );

  const select = (id: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('concept', id);
      return next;
    });
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  };

  if (!snapshot) {
    return <div className={`p-6 text-sm ${muted}`}>{error ?? 'Loading engineering prototype…'}</div>;
  }
  const reference = referenceRun(snapshot.evidenceRuns);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <FlaskConical size={20} className="text-violet-600" />
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Engineering — {snapshot.project.name}</h1>
            <Badge tone="amber">Experimental</Badge>
          </div>
          <p className={`mt-1 max-w-3xl text-sm ${muted}`}>
            Change what the system guarantees, see what follows, hand the work off, and reconcile real test evidence. Synthetic project stored only
            in this browser, never synced. Relationships and rules are authored; nothing here is AI-inferred.
          </p>
        </div>
        <button
          type="button"
          className={button}
          onClick={() => {
            if (window.confirm?.('Reset the prototype? This deletes drafts, imported evidence and accepted versions in this browser.') ?? true) {
              void run(resetPrototype);
            }
          }}
        >
          <RotateCcw size={14} /> Reset prototype
        </button>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <ConceptTree snapshot={snapshot} selectedId={conceptId} onSelect={select} />
        </aside>
        <main className="min-w-0 space-y-4">
          <ConceptView
            snapshot={snapshot}
            conceptId={conceptId}
            reference={reference}
            onSelect={select}
            onConfirmBinding={(bindingId, runId) => void run(() => confirmBinding(bindingId, runId))}
          />
          <ChangePanel
            snapshot={snapshot}
            onSelect={select}
            actions={{
              saveDraft: (to, rationale) => run(() => saveDraft(to, rationale)),
              approve: (id, baseSha) => run(() => approveProposal(id, baseSha)),
              withdraw: (id) => run(() => withdrawProposal(id)),
            }}
          />
          <EvidencePanel
            snapshot={snapshot}
            actions={{
              importFile: async (text, fileName, proposalId) => {
                const result = await importEvidence(text, fileName, { proposalId });
                await refresh();
                return result.ok ? null : result.errors;
              },
              accept: (id, runId) => run(() => acceptProposal(id, runId)),
            }}
          />
        </main>
      </div>
    </div>
  );
}
