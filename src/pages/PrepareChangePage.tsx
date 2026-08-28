// Prepare Change — the Change Workspace page (SPEC-change-workspace §14; CW-6).
// One persistent workspace per change: left rail + sections in loop order
// (intent → evidence → trace → hypothesis → implementation → verification →
// learned → promote → questions). `?view=timeline` shows the read-only
// reconstruction used by Investigate History (PRD §18).

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { FileCheck2, History, Loader2, Plus } from 'lucide-react';
import { getObjectsForProject } from '../lib/db/understanding';
import { db } from '../lib/db/schema';
import { listPreparedChangesForProject } from '../lib/db/preparedChanges';
import { createPreparedChange } from '../lib/prepare/changes';
import { linkQuestion } from '../lib/prepare/lifecycle';
import { sectionAnchor } from '../lib/prepare/rail';
import { WorkspaceRail } from '../components/prepare/WorkspaceRail';
import { IntentSection } from '../components/prepare/IntentSection';
import { EvidenceSection } from '../components/prepare/EvidenceSection';
import { TraceSection } from '../components/prepare/TraceSection';
import { HypothesisSection } from '../components/prepare/HypothesisSection';
import { ImplementationSection } from '../components/prepare/ImplementationSection';
import { VerificationSection } from '../components/prepare/VerificationSection';
import { LearnedSection } from '../components/prepare/LearnedSection';
import { PromoteSection } from '../components/prepare/PromoteSection';
import { QuestionsSection } from '../components/prepare/QuestionsSection';
import { WorkspaceTimeline } from '../components/prepare/WorkspaceTimeline';
import { useToastStore } from '../stores/toastStore';
import type { PreparedChange } from '../types/preparedChange';
import type { UnderstandingObject, UnderstandingProject } from '../types/understanding';

interface PageData {
  changes: PreparedChange[];
  understanding: UnderstandingObject[];
  questions: UnderstandingObject[];
  project: UnderstandingProject | null;
}

const accepted = (point: UnderstandingObject) =>
  point.status === 'current' && (point.reviewState === 'accepted' || point.reviewState === 'edited');

export function PrepareChangePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const addToast = useToastStore((state) => state.addToast);
  const [data, setData] = useState<PageData | null>(null);
  const [title, setTitle] = useState('');
  const [desired, setDesired] = useState('');
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
    setData({
      changes,
      understanding: points.filter(accepted),
      questions: points.filter((point) => point.type === 'question'),
      project: project ?? null,
    });
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ?understanding=a,b preselects points (from Current Understanding).
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

  // ?question=<id> seeds a workspace from a question (PRD §21).
  const questionId = searchParams.get('question');
  useEffect(() => {
    if (!questionId || !data) return;
    const question = data.questions.find((q) => q.id === questionId);
    if (question) {
      setTitle((current) => current || question.title);
      setShowCreate(true);
    }
  }, [questionId, data]);

  const selectedChangeId = searchParams.get('change') ?? data?.changes[0]?.id ?? null;
  const selectedChange = data?.changes.find((change) => change.id === selectedChangeId) ?? null;
  const view = searchParams.get('view') === 'timeline' ? 'timeline' : 'workspace';

  const openChange = (changeId: string, nextView?: 'timeline' | 'workspace') => {
    const next = new URLSearchParams(searchParams);
    next.set('change', changeId);
    next.delete('understanding');
    next.delete('question');
    if (nextView === 'timeline') next.set('view', 'timeline');
    else if (nextView === 'workspace') next.delete('view');
    setSearchParams(next);
  };

  const onChanged = async (changed: PreparedChange) => {
    await load();
    openChange(changed.id);
  };

  const handleCreate = async () => {
    if (!projectId) return;
    setCreating(true);
    try {
      const change = await createPreparedChange({
        projectId,
        title,
        understandingPointIds: [...selectedPointIds],
        ...(desired.trim() ? { intent: { currentBehavior: '', desiredBehavior: desired, whyItMatters: '' } } : {}),
        ...(questionId ? { originRef: { kind: 'question', id: questionId } } : {}),
      });
      if (questionId) await linkQuestion(change.id, questionId);
      setTitle('');
      setDesired('');
      setSelectedPointIds(new Set());
      setShowCreate(false);
      await load();
      openChange(change.id, 'workspace');
      addToast('Change Workspace created');
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setCreating(false);
    }
  };

  if (!data || !projectId) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={15} className="animate-spin" /> Loading change workspaces…
      </div>
    );
  }

  const canCreate = title.trim().length > 0 && (desired.trim().length > 0 || selectedPointIds.size > 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-violet-600 dark:text-violet-400">Project workflow</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">Prepare Change</h1>
          <p className="mt-2 max-w-3xl text-gray-600 dark:text-gray-400">
            One workspace per change: state the intent, gather evidence, trace the behavior, record a hypothesis, attach the implementation, verify, and keep what you learned. Chatdex never executes the change.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((visible) => !visible)}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700"
        >
          <Plus size={14} /> New workspace
        </button>
      </div>

      {showCreate && (
        <section className="mb-6 rounded-xl border border-violet-200 dark:border-violet-900/60 bg-white dark:bg-gray-900 p-5" data-testid="create-workspace">
          <h2 className="font-semibold text-gray-900 dark:text-white">Start a Change Workspace</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            From a bug, a question, or accepted understanding — give it a title and either the desired behavior or at least one understanding point.
          </p>
          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(20rem,1.2fr)]">
            <div className="space-y-3">
              <label className="block text-sm text-gray-700 dark:text-gray-300">
                <span className="block mb-1 font-medium">Change title</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Search result should scroll to the matching message"
                  aria-label="Change title"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
                />
              </label>
              <label className="block text-sm text-gray-700 dark:text-gray-300">
                <span className="block mb-1 font-medium">Desired behavior</span>
                <textarea
                  value={desired}
                  onChange={(event) => setDesired(event.target.value)}
                  rows={2}
                  placeholder="Clicking a result opens its conversation, scrolls the match into view, and highlights it."
                  aria-label="Desired behavior"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
                />
              </label>
            </div>
            <fieldset>
              <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">Understanding to carry forward (optional)</legend>
              {data.understanding.length === 0 ? (
                <p className="mt-1 text-xs text-gray-400">
                  No accepted understanding yet.{' '}
                  <Link to={`/projects/${projectId}/understanding`} className="underline">Review current understanding</Link>
                </p>
              ) : (
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
              )}
            </fieldset>
          </div>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || !canCreate}
            className="mt-4 flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create workspace
          </button>
        </section>
      )}

      {data.changes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-8 text-center">
          <FileCheck2 size={38} className="mx-auto text-violet-400" />
          <h2 className="mt-3 font-semibold text-gray-900 dark:text-white">No change workspaces yet</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Start one from a bug, a question, or accepted understanding.</p>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="space-y-2">
            {data.changes.map((change) => (
              <button
                key={change.id}
                type="button"
                onClick={() => openChange(change.id)}
                className={`w-full rounded-xl border p-3 text-left ${
                  change.id === selectedChangeId
                    ? 'border-violet-300 dark:border-violet-700 bg-violet-50/60 dark:bg-violet-900/20'
                    : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
                }`}
              >
                <span className="block text-sm font-medium text-gray-900 dark:text-white">{change.title}</span>
                <span className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                  <StateChip state={change.state} />
                  {change.updatedAt.toLocaleDateString()}
                </span>
              </button>
            ))}
          </aside>

          {selectedChange && (
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => openChange(selectedChange.id, 'workspace')}
                  className={`px-3 py-1.5 rounded-lg ${view === 'workspace' ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                  Workspace
                </button>
                <button
                  type="button"
                  onClick={() => openChange(selectedChange.id, 'timeline')}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg ${view === 'timeline' ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                  <History size={12} /> Timeline
                </button>
              </div>

              {view === 'timeline' ? (
                <WorkspaceTimeline change={selectedChange} projectId={projectId} />
              ) : (
                <div className="grid gap-5 xl:grid-cols-[11rem_minmax(0,1fr)]">
                  <div className="hidden xl:block">
                    <WorkspaceRail change={selectedChange} />
                  </div>
                  <div className="space-y-6 min-w-0">
                    <div id={sectionAnchor('intent')}>
                      <IntentSection key={`${selectedChange.id}:${selectedChange.updatedAt.toISOString()}`} change={selectedChange} understanding={data.understanding} onChanged={onChanged} />
                    </div>
                    {data.project && (
                      <div id={sectionAnchor('evidence')}>
                        <EvidenceSection change={selectedChange} project={data.project} onChanged={onChanged} />
                      </div>
                    )}
                    <div id={sectionAnchor('trace')}>
                      <TraceSection key={`trace:${selectedChange.id}`} change={selectedChange} onChanged={onChanged} />
                    </div>
                    <div id={sectionAnchor('hypotheses')}>
                      <HypothesisSection change={selectedChange} onChanged={onChanged} />
                    </div>
                    {data.project && (
                      <div id={sectionAnchor('implementation')}>
                        <ImplementationSection change={selectedChange} project={data.project} onChanged={onChanged} />
                      </div>
                    )}
                    <div id={sectionAnchor('verification')}>
                      <VerificationSection change={selectedChange} projectId={projectId} onChanged={onChanged} />
                    </div>
                    <div id={sectionAnchor('learned')}>
                      <LearnedSection change={selectedChange} onChanged={onChanged} />
                    </div>
                    <div id={sectionAnchor('promotions')}>
                      <PromoteSection change={selectedChange} onChanged={onChanged} />
                    </div>
                    <div id={sectionAnchor('questions')}>
                      <QuestionsSection key={`questions:${selectedChange.id}:${selectedChange.updatedAt.toISOString()}`} change={selectedChange} onChanged={onChanged} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
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
