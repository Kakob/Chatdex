// Change Workspace — Promote to Current Understanding (SPEC-change-workspace
// §12, law §2.8; PRD §16; CW-5). Deliberate and per item: pick verified
// evidence and verified relationships, write the belief yourself, promote.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Loader2, Sparkles } from 'lucide-react';
import { editabilityOf } from '../../lib/prepare/editability';
import { evidenceLabel } from '../../lib/prepare/evidenceLabel';
import { PROMOTABLE_TYPES, promoteFromWorkspace, promotedObjectsForWorkspace, promotionCandidates, type PromotableType } from '../../lib/prepare/promote';
import { useToastStore } from '../../stores/toastStore';
import type { PreparedChange } from '../../types/preparedChange';
import type { UnderstandingObject } from '../../types/understanding';

interface Props {
  change: PreparedChange;
  onChanged: (change: PreparedChange) => Promise<void>;
}

export function PromoteSection({ change, onChanged }: Props) {
  const addToast = useToastStore((s) => s.addToast);
  const editability = editabilityOf(change, 'promotions');
  const canPromote = editability === 'appendable' || editability === 'editable';
  const candidates = useMemo(() => promotionCandidates(change), [change]);
  const [promoted, setPromoted] = useState<UnderstandingObject[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<PromotableType>('belief');
  const [evidenceIds, setEvidenceIds] = useState<Set<string>>(new Set());
  const [edgeIds, setEdgeIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void promotedObjectsForWorkspace(change).then((rows) => !cancelled && setPromoted(rows));
    return () => {
      cancelled = true;
    };
  }, [change]);

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const promote = async () => {
    setBusy(true);
    try {
      const { change: updated, object } = await promoteFromWorkspace(change.id, {
        title,
        body,
        type,
        evidenceIds: [...evidenceIds],
        edgeIds: [...edgeIds],
      });
      setTitle('');
      setBody('');
      setEvidenceIds(new Set());
      setEdgeIds(new Set());
      await onChanged(updated);
      addToast(`Promoted "${object.title}" to Current Understanding`);
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = evidenceIds.size + edgeIds.size;

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <Sparkles size={16} className="text-violet-600 dark:text-violet-400" />
        <h2 className="font-semibold text-gray-900 dark:text-white">Promote to Current Understanding</h2>
        <span className="text-xs text-gray-400">explicit, per item · nothing promotes on its own</span>
      </div>

      <div className="p-5 space-y-4">
        {promoted.length > 0 && (
          <ul className="space-y-1 text-sm" data-testid="promoted-list">
            {promoted.map((object) => (
              <li key={object.id} className="flex flex-wrap items-center gap-2">
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{object.type}</span>
                <span className="text-gray-900 dark:text-white">{object.title}</span>
                {object.projectId && (
                  <Link to={`/projects/${object.projectId}/understanding`} className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400">
                    <ArrowUpRight size={12} /> Current Understanding
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}

        {!canPromote && (
          <p className="text-xs text-gray-400">Promotion opens once the workspace is verified.</p>
        )}

        {canPromote && (
          <div className="space-y-3">
            {candidates.evidence.length === 0 && candidates.edges.length === 0 ? (
              <p className="text-xs text-gray-400">Nothing verified yet — attach code, test, or commit evidence to a claim first.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 text-xs">
                <div>
                  <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Verified evidence</p>
                  <ul className="space-y-1">
                    {candidates.evidence.map((item) => (
                      <li key={item.id}>
                        <label className="inline-flex items-center gap-2 text-gray-700 dark:text-gray-300">
                          <input type="checkbox" checked={evidenceIds.has(item.id)} onChange={() => toggle(evidenceIds, item.id, setEvidenceIds)} aria-label={`Promote ${evidenceLabel(item)}`} />
                          <span className="px-1 rounded bg-gray-100 dark:bg-gray-800 text-[10px]">{item.kind}</span>
                          <span className="font-mono">{evidenceLabel(item)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Verified relationships</p>
                  {candidates.edges.length === 0 && <p className="text-gray-400">No trace edge is verified yet.</p>}
                  <ul className="space-y-1">
                    {candidates.edges.map(({ edge, fromLabel, toLabel }) => (
                      <li key={edge.id}>
                        <label className="inline-flex items-center gap-2 text-gray-700 dark:text-gray-300">
                          <input type="checkbox" checked={edgeIds.has(edge.id)} onChange={() => toggle(edgeIds, edge.id, setEdgeIds)} aria-label={`Promote ${fromLabel} → ${toLabel}`} />
                          <span className="font-mono">{fromLabel} → {toLabel}</span>
                          {edge.claim && <span className="text-gray-500">({edge.claim})</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <select value={type} onChange={(e) => setType(e.target.value as PromotableType)} aria-label="Understanding type" className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
                {PROMOTABLE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="the understanding, in your words"
                aria-label="Promoted understanding title"
                className="flex-1 min-w-64 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
              />
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="optional detail"
              aria-label="Promoted understanding body"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 text-sm"
            />
            <button
              type="button"
              onClick={() => void promote()}
              disabled={busy || !title.trim() || selectedCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Promote {selectedCount > 0 ? `(${selectedCount} selected)` : ''}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
