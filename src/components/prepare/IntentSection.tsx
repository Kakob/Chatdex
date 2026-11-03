// Change Workspace — Intent & criteria section (SPEC-change-workspace §7.1,
// PRD §5; CW-6). The former Prepared Change draft form: current / desired /
// why (mirrored into the handoff's desiredOutcome / rationale), structured
// acceptance criteria (ids survive edits by text), constraints, non-goals,
// open choices, repository ref, readiness, and the deterministic handoff.

import { useEffect, useMemo, useState } from 'react';
import { Check, Clipboard, Download, Loader2, Save, Target } from 'lucide-react';
import { getPreparedChange } from '../../lib/db/preparedChanges';
import { markPreparedChangeReady, updatePreparedChangeDraft, validatePreparedChange } from '../../lib/prepare/changes';
import { loadPreparedChangeExportContext, renderPreparedChangeJson, renderPreparedChangeMarkdown } from '../../lib/prepare/export';
import { downloadExport } from '../../lib/exporters';
import { useToastStore } from '../../stores/toastStore';
import { criteriaFromLines } from '../../lib/prepare/criteria';
import type { PreparedChange } from '../../types/preparedChange';
import type { UnderstandingObject } from '../../types/understanding';

interface Props {
  change: PreparedChange;
  understanding: UnderstandingObject[];
  onChanged: (change: PreparedChange) => Promise<void>;
}

interface Draft {
  title: string;
  currentBehavior: string;
  desiredBehavior: string;
  whyItMatters: string;
  constraints: string;
  nonGoals: string;
  acceptanceCriteria: string;
  openImplementationChoices: string;
  remoteUrl: string;
  baseCommit: string;
  implicatedPaths: string;
}

const lines = (value: string) => value.split('\n').map((l) => l.trim()).filter(Boolean);

function draftFrom(change: PreparedChange): Draft {
  return {
    title: change.title,
    currentBehavior: change.intent?.currentBehavior ?? '',
    desiredBehavior: change.intent?.desiredBehavior ?? change.desiredOutcome,
    whyItMatters: change.intent?.whyItMatters ?? change.rationale,
    constraints: change.constraints.join('\n'),
    nonGoals: change.nonGoals.join('\n'),
    acceptanceCriteria: (change.criteria?.map((c) => c.text) ?? change.acceptanceCriteria).join('\n'),
    openImplementationChoices: change.openImplementationChoices.join('\n'),
    remoteUrl: change.repositoryRef?.remoteUrl ?? '',
    baseCommit: change.repositoryRef?.baseCommit ?? '',
    implicatedPaths: (change.repositoryRef?.implicatedPaths ?? []).join('\n'),
  };
}

export function IntentSection({ change, understanding, onChanged }: Props) {
  const addToast = useToastStore((s) => s.addToast);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(change));
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [markdown, setMarkdown] = useState('');
  const editable = change.state === 'draft';
  const selectedPoints = useMemo(() => {
    const byId = new Map(understanding.map((p) => [p.id, p]));
    return change.understandingPointIds.map((id) => byId.get(id)).filter((p): p is UnderstandingObject => Boolean(p));
  }, [change.understandingPointIds, understanding]);

  useEffect(() => {
    setDraft(draftFrom(change));
  }, [change]);

  useEffect(() => {
    let cancelled = false;
    void validatePreparedChange(change).then((r) => !cancelled && setMissing(r));
    if (change.state !== 'draft') {
      void loadPreparedChangeExportContext(change).then((ctx) => !cancelled && setMarkdown(renderPreparedChangeMarkdown(ctx)));
    }
    return () => {
      cancelled = true;
    };
  }, [change]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const save = async (): Promise<PreparedChange> => {
    if (!editable) return change;
    setSaving(true);
    try {
      const updated = await updatePreparedChangeDraft(change.id, {
        title: draft.title,
        intent: { currentBehavior: draft.currentBehavior, desiredBehavior: draft.desiredBehavior, whyItMatters: draft.whyItMatters },
        constraints: lines(draft.constraints),
        nonGoals: lines(draft.nonGoals),
        criteria: criteriaFromLines(draft.acceptanceCriteria, change.criteria),
        openImplementationChoices: lines(draft.openImplementationChoices),
        repositoryRef: { remoteUrl: draft.remoteUrl, baseCommit: draft.baseCommit, implicatedPaths: lines(draft.implicatedPaths) },
      });
      await onChanged(updated);
      addToast('Workspace saved');
      return updated;
    } finally {
      setSaving(false);
    }
  };

  const markReady = async () => {
    try {
      const saved = await save();
      const ready = await markPreparedChangeReady(saved.id);
      await onChanged(ready);
      addToast('Intent and criteria are now frozen — the workspace is ready');
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const exportReady = async (format: 'markdown' | 'json' | 'copy') => {
    try {
      const fresh = await getPreparedChange(change.id);
      if (!fresh || fresh.state === 'draft') throw new Error('Mark the workspace ready before export');
      const context = await loadPreparedChangeExportContext(fresh);
      const rendered = renderPreparedChangeMarkdown(context);
      if (format === 'copy') {
        await navigator.clipboard.writeText(rendered);
        addToast('Claude Code handoff copied');
      } else if (format === 'markdown') {
        downloadExport(rendered, 'prepared-change', 'markdown');
      } else {
        downloadExport(renderPreparedChangeJson(context), 'prepared-change', 'json');
      }
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <Target size={16} className="text-violet-600 dark:text-violet-400" />
        <h2 className="font-semibold text-gray-900 dark:text-white">Intent &amp; criteria</h2>
        <span className="text-xs text-gray-400">
          {editable ? 'editable until ready' : 'frozen at ready'} · {change.understandingPointIds.length} understanding point{change.understandingPointIds.length === 1 ? '' : 's'}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {editable ? (
            <>
              <button type="button" onClick={() => void save().catch((e) => addToast(e instanceof Error ? e.message : String(e), 'error'))} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
              <button type="button" onClick={() => void markReady()} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
                <Check size={14} /> Mark ready
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => void exportReady('copy')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700">
                <Clipboard size={14} /> Copy Claude Code handoff
              </button>
              <button type="button" onClick={() => void exportReady('markdown')} className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500" title="Download Markdown">
                <Download size={14} />
              </button>
              <button type="button" onClick={() => void exportReady('json')} className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-500">
                JSON
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 p-5 2xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]">
        <div className="space-y-4">
          <Field label="Title" value={draft.title} onChange={(title) => patch({ title })} disabled={!editable} />
          <Area label="Current behavior — what happens now?" value={draft.currentBehavior} onChange={(currentBehavior) => patch({ currentBehavior })} disabled={!editable} rows={2} />
          <Area label="Desired behavior — what should happen?" value={draft.desiredBehavior} onChange={(desiredBehavior) => patch({ desiredBehavior })} disabled={!editable} rows={2} />
          <Area label="Why it matters" value={draft.whyItMatters} onChange={(whyItMatters) => patch({ whyItMatters })} disabled={!editable} rows={2} />
          <Area label="Acceptance criteria — observable conditions, one per line" value={draft.acceptanceCriteria} onChange={(acceptanceCriteria) => patch({ acceptanceCriteria })} disabled={!editable} rows={4} />
          <p className="-mt-2 text-xs text-gray-400">Criteria state what must be observable — not how it is implemented. Implementation ideas belong in the hypothesis.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Area label="Constraints (one per line)" value={draft.constraints} onChange={(constraints) => patch({ constraints })} disabled={!editable} rows={3} />
            <Area label="Non-goals (one per line)" value={draft.nonGoals} onChange={(nonGoals) => patch({ nonGoals })} disabled={!editable} rows={3} />
          </div>
          <Area label="Open implementation choices (one per line)" value={draft.openImplementationChoices} onChange={(openImplementationChoices) => patch({ openImplementationChoices })} disabled={!editable} rows={3} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Repository URL (optional)" value={draft.remoteUrl} onChange={(remoteUrl) => patch({ remoteUrl })} disabled={!editable} />
            <Field label="Base commit (optional)" value={draft.baseCommit} onChange={(baseCommit) => patch({ baseCommit })} disabled={!editable} />
          </div>
          <Area label="Implicated paths (one per line)" value={draft.implicatedPaths} onChange={(implicatedPaths) => patch({ implicatedPaths })} disabled={!editable} rows={2} />
        </div>

        <aside className="space-y-4">
          {selectedPoints.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Selected understanding</h3>
              <ul className="mt-2 space-y-2">
                {selectedPoints.map((point) => (
                  <li key={point.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
                    <span className="text-xs text-gray-400">{point.type}</span>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{point.title}</p>
                    {point.body && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{point.body}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {editable && (
            <div className="rounded-lg bg-gray-50 dark:bg-gray-950 p-3">
              <h3 className="text-xs font-medium text-gray-700 dark:text-gray-300">Readiness</h3>
              {missing.length === 0 ? (
                <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">Required fields are satisfied. Save, then mark ready.</p>
              ) : (
                <ul className="mt-1 text-xs text-amber-700 dark:text-amber-300 list-disc pl-4">
                  {missing.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
          )}
          {!editable && markdown && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Deterministic handoff preview</h3>
              <pre className="mt-2 max-h-[24rem] overflow-auto whitespace-pre-wrap rounded-lg bg-gray-950 p-4 text-xs text-gray-200">{markdown}</pre>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function Field({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label className="block text-sm text-gray-700 dark:text-gray-300">
      <span className="block mb-1 font-medium">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 disabled:opacity-75" />
    </label>
  );
}

function Area({ label, value, onChange, disabled, rows }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean; rows: number }) {
  return (
    <label className="block text-sm text-gray-700 dark:text-gray-300">
      <span className="block mb-1 font-medium">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} rows={rows} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 disabled:opacity-75" />
    </label>
  );
}
