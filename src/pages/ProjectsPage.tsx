import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FlaskConical,
  FolderKanban,
  HelpCircle,
  History,
  Loader2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { db, getConversations } from '../lib/db';
import {
  createHumanProject,
  setProjectReviewState,
  setAssociationReviewState,
} from '../lib/db/understanding';
import { listReadyProviders, getProviderInfo, getProviderAuthMode } from '../lib/providers';
import type { AuthMode, LLMProviderId } from '../lib/providers';
import {
  buildDisclosure,
  runDiscoveryInBatches,
  type DisclosureSummary,
} from '../lib/understanding/runDiscovery';
import {
  loadUnderstandingOverview,
  type UnderstandingOverview,
  type OverviewChange,
  type OverviewQuestion,
} from '../lib/understanding/overview';
import { OP_LABEL } from '../lib/understanding/livingDocument';
import { DisclosureModal } from '../components/understanding/DisclosureModal';
import { ProjectReviewCard, type AssociationRow } from '../components/understanding/ProjectReviewCard';
import { useToastStore } from '../stores/toastStore';
import {
  isSampleWorkspaceLoaded,
  SAMPLE_PROJECT_ID,
  seedSampleWorkspace,
} from '../lib/demo/seedWorkspace';
import type { StoredConversation } from '../types';
import type { ReviewState } from '../types/understanding';

/** Route target for a change/question: its project panel or the unassigned bucket. */
const projectRoute = (projectId: string | null) =>
  projectId === null ? '/projects/unassigned' : `/projects/${projectId}/understanding`;

function OpenQuestionRow({ question }: { question: OverviewQuestion }) {
  return (
    <li className="flex items-baseline gap-2 text-sm">
      <Link
        to={projectRoute(question.projectId)}
        className="text-gray-800 dark:text-gray-200 hover:text-violet-600 dark:hover:text-violet-400 min-w-0 truncate"
      >
        {question.object.title}
      </Link>
      <span className="shrink-0 text-xs text-gray-400">
        {question.projectName ?? 'unassigned'}
      </span>
      {question.object.reviewState === 'pending' && (
        <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">(pending)</span>
      )}
    </li>
  );
}

function GlobalChangeRow({ change }: { change: OverviewChange }) {
  const { event } = change;
  return (
    <li className="flex items-baseline gap-2 text-sm">
      <span className="shrink-0 text-xs text-gray-400 w-24 tabular-nums">
        {event.occurredAt.toLocaleDateString()}
      </span>
      <div className="min-w-0">
        <span className="text-gray-500 dark:text-gray-400">
          {OP_LABEL[event.op] ?? event.op}:
        </span>{' '}
        <span className="text-gray-800 dark:text-gray-200">{change.objectTitle}</span>
        {change.supersededByTitle && (
          <span className="text-gray-500 dark:text-gray-400"> → {change.supersededByTitle}</span>
        )}
        <Link
          to={projectRoute(change.projectId)}
          className="ml-2 text-xs text-violet-600 dark:text-violet-400 hover:underline"
        >
          {change.projectName ?? 'unassigned'}
        </Link>
        {event.reviewState === 'pending' && (
          <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(pending)</span>
        )}
      </div>
    </li>
  );
}

export function ProjectsPage() {
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();

  const [overview, setOverview] = useState<UnderstandingOverview | null>(null);
  const [associationsByProject, setAssociationsByProject] = useState<
    Map<string, AssociationRow[]>
  >(new Map());
  const [providers, setProviders] = useState<LLMProviderId[]>([]);
  const [provider, setProvider] = useState<LLMProviderId | null>(null);

  const [pendingRun, setPendingRun] = useState<{
    disclosure: DisclosureSummary;
    conversations: StoredConversation[];
    authMode: AuthMode;
  } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

  const load = useCallback(async () => {
    const [loadedOverview, associations, configured, hasSample] = await Promise.all([
      loadUnderstandingOverview(),
      db.projectAssociations.toArray(),
      listReadyProviders(),
      isSampleWorkspaceLoaded(),
    ]);
    const convIds = [...new Set(associations.map((a) => a.conversationId))];
    const convs = await db.conversations.where('id').anyOf(convIds).toArray();
    const nameById = new Map(convs.map((c) => [c.id, c.name]));

    const grouped = new Map<string, AssociationRow[]>();
    for (const association of associations) {
      if (association.reviewState === 'rejected') continue;
      const rows = grouped.get(association.projectId) ?? [];
      rows.push({
        association,
        conversationName: nameById.get(association.conversationId) ?? '(deleted conversation)',
      });
      grouped.set(association.projectId, rows);
    }

    setOverview(loadedOverview);
    setAssociationsByProject(grouped);
    setProviders(configured);
    setProvider((prev) => prev ?? configured[0] ?? null);
    setSampleLoaded(hasSample);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDiscoverClick = async () => {
    if (!provider) return;
    const conversations = await getConversations();
    if (conversations.length === 0) {
      addToast('No conversations to analyze — import some first');
      return;
    }
    setPendingRun({
      disclosure: buildDisclosure(conversations, provider),
      conversations,
      authMode: await getProviderAuthMode(provider),
    });
  };

  const handleConfirmRun = async () => {
    if (!pendingRun || !provider) return;
    const { conversations } = pendingRun;
    setPendingRun(null);
    setProgress({ done: 0, total: Math.ceil(conversations.length / 25) });
    try {
      const outcome = await runDiscoveryInBatches(conversations, { provider }, {
        onProgress: (done, total) => setProgress({ done, total }),
      });
      addToast(
        `Discovery: ${outcome.projectsCreated} new project${
          outcome.projectsCreated !== 1 ? 's' : ''
        }, ${outcome.associationsCreated} associations, ${outcome.objectsCreated} objects` +
          (outcome.warnings.length > 0 ? ` (${outcome.warnings.length} warnings)` : '')
      );
      if (outcome.warnings.length > 0) {
        console.warn('Discovery warnings:', outcome.warnings);
      }
    } finally {
      setProgress(null);
      await load();
    }
  };

  const handleProjectReview = async (projectId: string, state: ReviewState) => {
    await setProjectReviewState(projectId, state);
    await load();
  };

  const handleAssociationReview = async (associationId: string, state: ReviewState) => {
    await setAssociationReviewState(associationId, state);
    await load();
  };

  const handleCreateProject = async () => {
    try {
      const project = await createHumanProject({
        name: projectName,
        description: projectDescription,
      });
      setProjectName('');
      setProjectDescription('');
      setShowCreate(false);
      addToast('Project created');
      navigate(`/projects/${project.id}`);
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const handleSampleWorkspace = async () => {
    if (sampleLoaded) {
      navigate(`/projects/${SAMPLE_PROJECT_ID}`);
      return;
    }
    setLoadingSample(true);
    try {
      const result = await seedSampleWorkspace();
      addToast('Privacy-safe sample workspace loaded');
      await load();
      navigate(`/projects/${result.projectId}`);
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setLoadingSample(false);
    }
  };

  const projects = overview?.projects ?? [];
  const pending = projects.filter((s) => s.project.reviewState === 'pending');
  const reviewed = projects.filter((s) => s.project.reviewState !== 'pending');
  const hasAnything =
    overview !== null &&
    (projects.length > 0 || overview.unassignedCount > 0 || overview.recentChanges.length > 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">Projects</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {projects.length} project{projects.length !== 1 ? 's' : ''}
            {pending.length > 0 && <> · {pending.length} awaiting review</>}
            {overview !== null && overview.openQuestions.length > 0 && (
              <> · {overview.openQuestions.length} open question{overview.openQuestions.length !== 1 ? 's' : ''}</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSampleWorkspace()}
            disabled={loadingSample}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-violet-200 dark:border-violet-900/60 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30 disabled:opacity-50"
            title="Synthetic data only; does not use your conversations"
          >
            {loadingSample ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FlaskConical size={14} />
            )}
            {sampleLoaded ? 'Open sample' : 'Load sample workspace'}
          </button>
          <button
            type="button"
            onClick={() => setShowCreate((visible) => !visible)}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-violet-300 dark:hover:border-violet-800 transition-colors"
          >
            {showCreate ? <X size={14} /> : <Plus size={14} />}
            {showCreate ? 'Cancel' : 'New project'}
          </button>
          {providers.length > 1 && (
            <select
              value={provider ?? ''}
              onChange={(e) => setProvider(e.target.value as LLMProviderId)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            >
              {providers.map((p) => (
                <option key={p} value={p}>
                  {getProviderInfo(p).label}
                </option>
              ))}
            </select>
          )}
          {providers.length > 0 && (
            <button
              onClick={() => void handleDiscoverClick()}
              disabled={progress !== null}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {progress ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Analyzing batch {Math.min(progress.done + 1, progress.total)} of {progress.total}
                  ...
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  Discover projects
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form
          className="mb-6 rounded-xl border border-violet-200 dark:border-violet-900/60 bg-white dark:bg-gray-900 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateProject();
          }}
        >
          <div className="grid gap-3 md:grid-cols-[minmax(12rem,0.7fr)_minmax(18rem,1.3fr)_auto] md:items-end">
            <label className="text-sm text-gray-700 dark:text-gray-300">
              <span className="block mb-1 font-medium">Project name</span>
              <input
                autoFocus
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Slop Connoisseur"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
              />
            </label>
            <label className="text-sm text-gray-700 dark:text-gray-300">
              <span className="block mb-1 font-medium">Description (optional)</span>
              <input
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
                placeholder="What this project is trying to become"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
              />
            </label>
            <button
              type="submit"
              disabled={!projectName.trim()}
              className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
            >
              Create project
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Human-created projects are accepted immediately. AI discovery remains an optional proposal inbox.
          </p>
        </form>
      )}

      {overview === null ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-gray-400" size={24} />
        </div>
      ) : !hasAnything ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <FolderKanban size={48} className="mx-auto mb-4 opacity-50" />
          <p>No projects yet</p>
          <p className="text-sm mt-2">
            Create one directly, or run discovery to propose projects from your conversation history
          </p>
          <p className="mx-auto mt-3 max-w-lg text-xs text-gray-400">
            “Load sample workspace” adds clearly labeled synthetic data so you can inspect the full
            Investigate History → Current Understanding → Prepare Change workflow without importing
            anything private.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                Awaiting review
              </h2>
              <div className="space-y-3">
                {pending.map((stats) => (
                  <ProjectReviewCard
                    key={stats.project.id}
                    project={stats.project}
                    associations={associationsByProject.get(stats.project.id) ?? []}
                    stats={stats}
                    onProjectReview={(state) => void handleProjectReview(stats.project.id, state)}
                    onAssociationReview={(id, state) => void handleAssociationReview(id, state)}
                  />
                ))}
              </div>
            </section>
          )}
          {reviewed.length > 0 && (
            <section>
              {pending.length > 0 && (
                <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                  Reviewed
                </h2>
              )}
              <div className="space-y-3">
                {reviewed.map((stats) => (
                  <ProjectReviewCard
                    key={stats.project.id}
                    project={stats.project}
                    associations={associationsByProject.get(stats.project.id) ?? []}
                    stats={stats}
                    onProjectReview={(state) => void handleProjectReview(stats.project.id, state)}
                    onAssociationReview={(id, state) => void handleAssociationReview(id, state)}
                  />
                ))}
              </div>
            </section>
          )}
          {overview.unassignedCount > 0 && (
            <Link
              to="/projects/unassigned"
              className="block text-sm text-gray-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-400"
            >
              {overview.unassignedCount} understanding object
              {overview.unassignedCount !== 1 ? 's' : ''} not tied to a project →
            </Link>
          )}

          {overview.openQuestions.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                <HelpCircle size={14} />
                Open questions
              </h2>
              <ul className="space-y-2">
                {overview.openQuestions.map((question) => (
                  <OpenQuestionRow key={question.object.id} question={question} />
                ))}
              </ul>
            </section>
          )}

          {overview.recentChanges.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                <History size={14} />
                Recent changes
              </h2>
              <ul className="space-y-2">
                {overview.recentChanges.map((change) => (
                  <GlobalChangeRow key={change.event.id} change={change} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {pendingRun && (
        <DisclosureModal
          disclosure={pendingRun.disclosure}
          authMode={pendingRun.authMode}
          onConfirm={() => void handleConfirmRun()}
          onCancel={() => setPendingRun(null)}
        />
      )}
    </div>
  );
}
