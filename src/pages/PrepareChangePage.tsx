import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Check,
  Clipboard,
  Download,
  FileCheck2,
  Loader2,
  Plus,
  Save,
} from 'lucide-react';
import { getObjectsForProject } from '../lib/db/understanding';
import { db } from '../lib/db/schema';
import { EvidenceSection } from '../components/prepare/EvidenceSection';
import { TraceSection } from '../components/prepare/TraceSection';
import { HypothesisSection } from '../components/prepare/HypothesisSection';
import { ImplementationSection } from '../components/prepare/ImplementationSection';
import {
  getPreparedChange,
  listPreparedChangesForProject,
} from '../lib/db/preparedChanges';
import {
  createPreparedChange,
  markPreparedChangeReady,
  updatePreparedChangeDraft,
  validatePreparedChange,
} from '../lib/prepare/changes';
import {
  loadPreparedChangeExportContext,
  renderPreparedChangeJson,
  renderPreparedChangeMarkdown,
} from '../lib/prepare/export';
import { downloadExport } from '../lib/exporters';
import { useToastStore } from '../stores/toastStore';
import type { PreparedChange } from '../types/preparedChange';
import type { UnderstandingObject, UnderstandingProject } from '../types/understanding';

interface PageData {
  changes: PreparedChange[];
  understanding: UnderstandingObject[];
  project: UnderstandingProject | null;
}

const accepted = (point: UnderstandingObject) =>
  point.status === 'current' &&
  (point.reviewState === 'accepted' || point.reviewState === 'edited');

export function PrepareChangePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const addToast = useToastStore((state) => state.addToast);
  const [data, setData] = useState<PageData | null>(null);
  const [title, setTitle] = useState('');
  const [selectedPointIds, setSelectedPointIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    const [changes, points, project] = await Promise.all([
      listPreparedChangesForProject(projectId),
      getObjectsForProject(projectId, 'current'),
      db.understandingProjects.get(projectId),
    ]);
    setData({ changes, understanding: points.filter(accepted), project: project ?? null });
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const requested = searchParams.get('understanding');
    if (!requested || !data) return;
    const allowed = new Set(data.understanding.map((point) => point.id));
    const ids = requested.split(',').filter((id) => allowed.has(id));
    if (ids.length > 0) {
      setSelectedPointIds(new Set(ids));
      setShowCreate(true);
    }
  }, [data, searchParams]);

  const selectedChangeId = searchParams.get('change') ?? data?.changes[0]?.id ?? null;
  const selectedChange = data?.changes.find((change) => change.id === selectedChangeId) ?? null;

  const openChange = (changeId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('change', changeId);
    next.delete('understanding');
    setSearchParams(next);
  };

  const handleCreate = async () => {
    if (!projectId) return;
    setCreating(true);
    try {
      const change = await createPreparedChange({
        projectId,
        title,
        understandingPointIds: [...selectedPointIds],
      });
      setTitle('');
      setSelectedPointIds(new Set());
      setShowCreate(false);
      await load();
      openChange(change.id);
      addToast('Prepared Change draft created');
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setCreating(false);
    }
  };

  if (!data || !projectId) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={15} className="animate-spin" /> Loading prepared changes…
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-violet-600 dark:text-violet-400">Project workflow</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
            Prepare Change
          </h1>
          <p className="mt-2 max-w-3xl text-gray-600 dark:text-gray-400">
            Compile selected, accepted understanding into implementation-ready intent. Chatdex stops before execution.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((visible) => !visible)}
          disabled={data.understanding.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
        >
          <Plus size={14} /> New prepared change
        </button>
      </div>

      {showCreate && (
        <section className="mb-6 rounded-xl border border-violet-200 dark:border-violet-900/60 bg-white dark:bg-gray-900 p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white">Start from accepted understanding</h2>
          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(20rem,1.2fr)]">
            <label className="text-sm text-gray-700 dark:text-gray-300">
              <span className="block mb-1 font-medium">Change title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Contestant-judged solo round"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
              />
            </label>
            <fieldset>
              <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Understanding to carry forward
              </legend>
              <div className="mt-1 max-h-44 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
                {data.understanding.map((point) => (
                  <label key={point.id} className="flex gap-2 p-2.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPointIds.has(point.id)}
                      onChange={(event) => {
                        setSelectedPointIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(point.id);
                          else next.delete(point.id);
                          return next;
                        });
                      }}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="text-xs text-gray-400">{point.type}</span>
                      <span className="block text-gray-800 dark:text-gray-200">{point.title}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || !title.trim() || selectedPointIds.size === 0}
            className="mt-4 flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create draft
          </button>
        </section>
      )}

      {data.understanding.length === 0 && (
        <div className="mb-6 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-sm text-gray-500 dark:text-gray-400">
          Prepare Change requires at least one accepted Current Understanding point.
          <Link
            to={`/projects/${projectId}/understanding`}
            className="ml-1 text-violet-600 dark:text-violet-400 hover:underline"
          >
            Review current understanding
          </Link>
        </div>
      )}

      {data.changes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-8 text-center">
          <FileCheck2 size={38} className="mx-auto text-violet-400" />
          <h2 className="mt-3 font-semibold text-gray-900 dark:text-white">No prepared changes yet</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Select accepted understanding, then write the desired outcome and acceptance criteria.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="space-y-2">
            {data.changes.map((change) => (
              <button
                key={change.id}
                type="button"
                onClick={() => openChange(change.id)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
                  change.id === selectedChange?.id
                    ? 'border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20'
                    : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700'
                }`}
              >
                <span className="block text-sm font-medium text-gray-900 dark:text-white">
                  {change.title}
                </span>
                <span className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                  <StateChip state={change.state} />
                  {change.updatedAt.toLocaleDateString()}
                </span>
              </button>
            ))}
          </aside>
          {selectedChange && (
            <div>
            <PreparedChangeBuilder
              key={`${selectedChange.id}:${selectedChange.updatedAt.toISOString()}`}
              change={selectedChange}
              understanding={data.understanding}
              onChanged={async (changed) => {
                await load();
                openChange(changed.id);
              }}
            />
            {data.project && (
              <div className="mt-6">
                <EvidenceSection
                  change={selectedChange}
                  project={data.project}
                  onChanged={async (changed) => {
                    await load();
                    openChange(changed.id);
                  }}
                />
              </div>
            )}
            <div className="mt-6">
              <TraceSection
                key={`trace:${selectedChange.id}`}
                change={selectedChange}
                onChanged={async (changed) => {
                  await load();
                  openChange(changed.id);
                }}
              />
            </div>
            <div className="mt-6">
              <HypothesisSection
                change={selectedChange}
                onChanged={async (changed) => {
                  await load();
                  openChange(changed.id);
                }}
              />
            </div>
            {data.project && (
              <div className="mt-6">
                <ImplementationSection
                  change={selectedChange}
                  project={data.project}
                  onChanged={async (changed) => {
                    await load();
                    openChange(changed.id);
                  }}
                />
              </div>
            )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface BuilderDraft {
  title: string;
  desiredOutcome: string;
  rationale: string;
  constraints: string;
  nonGoals: string;
  acceptanceCriteria: string;
  openImplementationChoices: string;
  remoteUrl: string;
  baseCommit: string;
  implicatedPaths: string;
}

function draftFrom(change: PreparedChange): BuilderDraft {
  return {
    title: change.title,
    desiredOutcome: change.desiredOutcome,
    rationale: change.rationale,
    constraints: change.constraints.join('\n'),
    nonGoals: change.nonGoals.join('\n'),
    acceptanceCriteria: change.acceptanceCriteria.join('\n'),
    openImplementationChoices: change.openImplementationChoices.join('\n'),
    remoteUrl: change.repositoryRef?.remoteUrl ?? '',
    baseCommit: change.repositoryRef?.baseCommit ?? '',
    implicatedPaths: change.repositoryRef?.implicatedPaths?.join('\n') ?? '',
  };
}

const lines = (value: string) => value.split('\n');

function PreparedChangeBuilder({
  change,
  understanding,
  onChanged,
}: {
  change: PreparedChange;
  understanding: UnderstandingObject[];
  onChanged: (change: PreparedChange) => Promise<void>;
}) {
  const addToast = useToastStore((state) => state.addToast);
  const [draft, setDraft] = useState<BuilderDraft>(() => draftFrom(change));
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [markdown, setMarkdown] = useState('');
  const editable = change.state === 'draft';
  const selectedPoints = useMemo(() => {
    const byId = new Map(understanding.map((point) => [point.id, point]));
    return change.understandingPointIds
      .map((id) => byId.get(id))
      .filter((point): point is UnderstandingObject => Boolean(point));
  }, [change.understandingPointIds, understanding]);

  useEffect(() => {
    let cancelled = false;
    void validatePreparedChange(change).then((result) => {
      if (!cancelled) setMissing(result);
    });
    if (change.state === 'ready') {
      void loadPreparedChangeExportContext(change).then((context) => {
        if (!cancelled) setMarkdown(renderPreparedChangeMarkdown(context));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [change]);

  const patchDraft = (patch: Partial<BuilderDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const save = async (): Promise<PreparedChange> => {
    if (!editable) return change;
    setSaving(true);
    try {
      const updated = await updatePreparedChangeDraft(change.id, {
        title: draft.title,
        desiredOutcome: draft.desiredOutcome,
        rationale: draft.rationale,
        constraints: lines(draft.constraints),
        nonGoals: lines(draft.nonGoals),
        acceptanceCriteria: lines(draft.acceptanceCriteria),
        openImplementationChoices: lines(draft.openImplementationChoices),
        repositoryRef: {
          remoteUrl: draft.remoteUrl,
          baseCommit: draft.baseCommit,
          implicatedPaths: lines(draft.implicatedPaths),
        },
      });
      await onChanged(updated);
      addToast('Prepared Change saved');
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
      addToast('Prepared Change is ready');
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const exportReady = async (format: 'markdown' | 'json' | 'copy') => {
    try {
      const fresh = await getPreparedChange(change.id);
      if (!fresh || fresh.state !== 'ready') throw new Error('Mark the change ready before export');
      const context = await loadPreparedChangeExportContext(fresh);
      const renderedMarkdown = renderPreparedChangeMarkdown(context);
      if (format === 'copy') {
        await navigator.clipboard.writeText(renderedMarkdown);
        addToast('Claude Code handoff copied');
      } else if (format === 'markdown') {
        downloadExport(renderedMarkdown, 'prepared-change', 'markdown');
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
        <StateChip state={change.state} />
        <span className="text-xs text-gray-400">
          {change.understandingPointIds.length} understanding point{change.understandingPointIds.length === 1 ? '' : 's'}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {editable ? (
            <>
              <button
                type="button"
                onClick={() =>
                  void save().catch((error) =>
                    addToast(error instanceof Error ? error.message : String(error), 'error')
                  )
                }
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
              <button
                type="button"
                onClick={() => void markReady()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Check size={14} /> Mark ready
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void exportReady('copy')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700"
              >
                <Clipboard size={14} /> Copy Claude Code handoff
              </button>
              <button
                type="button"
                onClick={() => void exportReady('markdown')}
                className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500"
                title="Download Markdown"
              >
                <Download size={14} />
              </button>
              <button
                type="button"
                onClick={() => void exportReady('json')}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-500"
              >
                JSON
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 p-5 2xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]">
        <div className="space-y-4">
          <TextField label="Title" value={draft.title} onChange={(title) => patchDraft({ title })} disabled={!editable} />
          <TextArea label="Desired outcome" value={draft.desiredOutcome} onChange={(desiredOutcome) => patchDraft({ desiredOutcome })} disabled={!editable} rows={3} />
          <TextArea label="Rationale" value={draft.rationale} onChange={(rationale) => patchDraft({ rationale })} disabled={!editable} rows={3} />
          <div className="grid gap-4 md:grid-cols-2">
            <TextArea label="Constraints (one per line)" value={draft.constraints} onChange={(constraints) => patchDraft({ constraints })} disabled={!editable} rows={5} />
            <TextArea label="Non-goals (one per line)" value={draft.nonGoals} onChange={(nonGoals) => patchDraft({ nonGoals })} disabled={!editable} rows={5} />
            <TextArea label="Acceptance criteria (one per line)" value={draft.acceptanceCriteria} onChange={(acceptanceCriteria) => patchDraft({ acceptanceCriteria })} disabled={!editable} rows={5} />
            <TextArea label="Open implementation choices (one per line)" value={draft.openImplementationChoices} onChange={(openImplementationChoices) => patchDraft({ openImplementationChoices })} disabled={!editable} rows={5} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="Repository URL (optional)" value={draft.remoteUrl} onChange={(remoteUrl) => patchDraft({ remoteUrl })} disabled={!editable} />
            <TextField label="Base commit (optional)" value={draft.baseCommit} onChange={(baseCommit) => patchDraft({ baseCommit })} disabled={!editable} />
          </div>
          <TextArea label="Implicated paths (one per line)" value={draft.implicatedPaths} onChange={(implicatedPaths) => patchDraft({ implicatedPaths })} disabled={!editable} rows={3} />
        </div>

        <aside className="space-y-4">
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

          {change.state === 'ready' && markdown && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Deterministic handoff preview</h3>
              <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-gray-950 p-4 text-xs text-gray-200">{markdown}</pre>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function StateChip({ state }: { state: PreparedChange['state'] }) {
  const tone =
    state === 'ready' || state === 'verified' || state === 'closed'
      ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
      : state === 'superseded'
        ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
        : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
  return <span className={`px-2 py-0.5 text-xs rounded-full ${tone}`}>{state}</span>;
}

function TextField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="block text-sm text-gray-700 dark:text-gray-300">
      <span className="block mb-1 font-medium">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 disabled:opacity-75"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  disabled,
  rows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  rows: number;
}) {
  return (
    <label className="block text-sm text-gray-700 dark:text-gray-300">
      <span className="block mb-1 font-medium">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={rows}
        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 disabled:opacity-75"
      />
    </label>
  );
}
