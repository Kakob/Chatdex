import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Compass,
  FileText,
  GitMerge,
  HelpCircle,
  History,
  LayoutList,
  Lightbulb,
  Loader2,
  MessageCircle,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import {
  loadProjectUnderstanding,
  type ProjectUnderstanding,
  type UnderstandingItem,
  type RecentChange,
  type PendingChange,
} from '../lib/understanding/currentUnderstanding';
import {
  getReconcilableConversations,
  reconcileProject,
} from '../lib/understanding/reconcile';
import {
  renderLivingDocument,
  livingDocumentFilenamePrefix,
  OP_LABEL,
} from '../lib/understanding/livingDocument';
import { LivingDocumentView } from '../components/understanding/LivingDocumentView';
import { ProjectMapView } from '../components/understanding/ProjectMapView';
import { loadProjectMap, type ProjectMap } from '../lib/understanding/map';
import { buildDisclosure, type DisclosureSummary } from '../lib/understanding/runDiscovery';
import { setObjectReviewState, setEventReviewState } from '../lib/db/understanding';
import { listReadyProviders, getProviderInfo, getProviderAuthMode } from '../lib/providers';
import type { AuthMode, LLMProviderId } from '../lib/providers';
import { DisclosureModal } from '../components/understanding/DisclosureModal';
import { EvidenceLinks } from '../components/understanding/EvidenceLinks';
import { HistoryDrawer } from '../components/understanding/HistoryDrawer';
import { ReviewButtons } from '../components/understanding/ReviewButtons';
import { useToastStore } from '../stores/toastStore';
import type { StoredConversation } from '../types';
import type { ReviewState } from '../types/understanding';

/** Route id for the bucket of objects with no project (projectId null). */
export const UNASSIGNED_ROUTE_ID = 'unassigned';

function ObjectCard({
  item,
  showType,
  onReview,
  onOpenHistory,
}: {
  item: UnderstandingItem;
  showType?: boolean;
  onReview: (objectId: string, state: ReviewState) => void;
  onOpenHistory: (objectId: string) => void;
}) {
  const { object } = item;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenHistory(object.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpenHistory(object.id);
      }}
      title="View history"
      className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 cursor-pointer hover:border-violet-300 dark:hover:border-violet-800 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {showType && (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                {object.type}
              </span>
            )}
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">{object.title}</h3>
            {object.origin === 'ai' && object.reviewState === 'pending' && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300"
                title="AI-proposed, not yet reviewed"
              >
                <Sparkles size={10} /> pending
              </span>
            )}
          </div>
          {object.body && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{object.body}</p>
          )}
          <EvidenceLinks evidence={item.evidence} />
        </div>
        {object.reviewState === 'pending' && (
          <span onClick={(e) => e.stopPropagation()}>
            <ReviewButtons small onReview={(state) => onReview(object.id, state)} />
          </span>
        )}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  items,
  showType,
  onReview,
  onOpenHistory,
}: {
  icon: React.ReactNode;
  title: string;
  items: UnderstandingItem[];
  showType?: boolean;
  onReview: (objectId: string, state: ReviewState) => void;
  onOpenHistory: (objectId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
        {icon}
        {title}
      </h2>
      <div className="space-y-3">
        {items.map((item) => (
          <ObjectCard
            key={item.object.id}
            item={item}
            showType={showType}
            onReview={onReview}
            onOpenHistory={onOpenHistory}
          />
        ))}
      </div>
    </section>
  );
}

function PendingChangeCard({
  change,
  onReview,
}: {
  change: PendingChange;
  onReview: (eventId: string, state: 'accepted' | 'rejected') => void;
}) {
  const { event } = change;
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-amber-200 dark:border-amber-900/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="px-1.5 py-0.5 text-xs rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300">
              {OP_LABEL[event.op] ?? event.op}
            </span>
            <span className="font-medium text-gray-900 dark:text-white">
              {change.objectTitle}
            </span>
            <span className="text-xs text-gray-400">{change.objectType}</span>
          </div>
          {event.detail && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{event.detail}</p>
          )}
          {change.supersededByTitle && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              → Replaced by: <span className="font-medium">{change.supersededByTitle}</span>
            </p>
          )}
          <EvidenceLinks evidence={change.evidence} />
        </div>
        <ReviewButtons small onReview={(state) => onReview(event.id, state === 'accepted' ? 'accepted' : 'rejected')} />
      </div>
    </div>
  );
}

function RecentChangeRow({ change }: { change: RecentChange }) {
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
          <span className="text-gray-500 dark:text-gray-400">
            {' '}
            → {change.supersededByTitle}
          </span>
        )}
        {event.detail && (
          <span className="text-gray-500 dark:text-gray-400"> — {event.detail}</span>
        )}
        {event.reviewState === 'pending' && (
          <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(pending)</span>
        )}
      </div>
    </li>
  );
}

export function ProjectUnderstandingPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = id === UNASSIGNED_ROUTE_ID ? null : id;
  const addToast = useToastStore((s) => s.addToast);

  const [data, setData] = useState<ProjectUnderstanding | null | undefined>(undefined);
  const [view, setView] = useState<'panel' | 'document' | 'map'>('panel');
  const [map, setMap] = useState<ProjectMap | null>(null);
  const [providers, setProviders] = useState<LLMProviderId[]>([]);
  const [provider, setProvider] = useState<LLMProviderId | null>(null);
  const [pendingRun, setPendingRun] = useState<{
    disclosure: DisclosureSummary;
    conversations: StoredConversation[];
    authMode: AuthMode;
    ignoreCursor: boolean;
  } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [historyObjectId, setHistoryObjectId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (projectId === undefined) return Promise.resolve();
    return Promise.all([loadProjectUnderstanding(projectId), listReadyProviders()]).then(
      ([loaded, configured]) => {
        setData(loaded);
        setProviders(configured);
        setProvider((prev) => prev ?? configured[0] ?? null);
      }
    );
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Map data loads lazily on first Map view; `data` in the deps refreshes it
  // after reviews (accept/reject changes chains and statuses).
  useEffect(() => {
    if (view !== 'map' || projectId === undefined) return;
    let cancelled = false;
    void loadProjectMap(projectId).then((loaded) => {
      if (!cancelled) setMap(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [view, projectId, data]);

  const handleObjectReview = async (objectId: string, state: ReviewState) => {
    await setObjectReviewState(objectId, state);
    await load();
  };
  const onObjectReview = (objectId: string, state: ReviewState) =>
    void handleObjectReview(objectId, state);

  const handleEventReview = async (eventId: string, state: 'accepted' | 'rejected') => {
    await setEventReviewState(eventId, state);
    await load();
  };
  const onEventReview = (eventId: string, state: 'accepted' | 'rejected') =>
    void handleEventReview(eventId, state);

  const handleReconcileClick = async () => {
    if (!provider || !projectId) return;
    // Incremental by default; automatic full re-run when the cursor leaves
    // nothing new — the disclosure modal shows exactly what will be sent.
    let ignoreCursor = false;
    let conversations = await getReconcilableConversations(projectId);
    if (conversations.length === 0) {
      conversations = await getReconcilableConversations(projectId, true);
      ignoreCursor = true;
    }
    if (conversations.length === 0) {
      addToast('No conversations associated with this project yet');
      return;
    }
    setPendingRun({
      disclosure: buildDisclosure(conversations, provider),
      conversations,
      authMode: await getProviderAuthMode(provider),
      ignoreCursor,
    });
  };

  const handleConfirmReconcile = async () => {
    if (!pendingRun || !provider || !projectId) return;
    const { ignoreCursor } = pendingRun;
    setPendingRun(null);
    setProgress({ done: 0, total: 1 });
    try {
      const outcome = await reconcileProject(
        projectId,
        { provider, ignoreCursor },
        { onProgress: (done, total) => setProgress({ done, total }) }
      );
      addToast(
        `Reconciliation: ${outcome.objectsIntroduced} new object${
          outcome.objectsIntroduced !== 1 ? 's' : ''
        }, ${outcome.eventsProposed} proposed change${outcome.eventsProposed !== 1 ? 's' : ''}` +
          (outcome.warnings.length > 0 ? ` (${outcome.warnings.length} warnings)` : '')
      );
      if (outcome.warnings.length > 0) {
        console.warn('Reconciliation warnings:', outcome.warnings);
      }
    } catch (err) {
      addToast(`Reconciliation failed: ${(err as Error).message}`, 'error');
    } finally {
      setProgress(null);
      await load();
    }
  };

  // Regenerated on every load — the document is a projection, never stored.
  const documentMarkdown = useMemo(
    () =>
      data
        ? renderLivingDocument(data.project, data.understanding, { generatedAt: new Date() })
        : '',
    [data]
  );

  if (data === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="text-center py-16 text-gray-500 dark:text-gray-400">
        <p>Project not found</p>
        <Link to="/projects" className="text-sm text-violet-600 dark:text-violet-400 hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const { project, understanding } = data;
  const subtitle = project
    ? project.description
    : 'Understanding that discovery could not attribute to a specific project';
  const isEmpty =
    understanding.direction.length === 0 &&
    understanding.ideasAndDecisions.length === 0 &&
    understanding.openQuestions.length === 0 &&
    understanding.recentChanges.length === 0;

  return (
    <div>
      <Link
        to="/projects"
        className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-400 mb-4"
      >
        <ArrowLeft size={14} /> Projects
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            {project ? project.name : 'Not tied to a project'}
          </h1>
          {subtitle && <p className="mt-1 text-gray-600 dark:text-gray-400">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
            {(
              [
                ['panel', 'Panel', <LayoutList key="p" size={14} />],
                ['document', 'Document', <FileText key="d" size={14} />],
                ['map', 'Map', <Waypoints key="m" size={14} />],
              ] as const
            ).map(([value, label, icon]) => (
              <button
                key={value}
                onClick={() => setView(value)}
                className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${
                  view === value
                    ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                    : 'bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          {project && (
            <>
            <Link
              to={`/chat?project=${project.id}`}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-violet-300 dark:hover:border-violet-800 transition-colors"
              title="Start a chat linked to this project"
            >
              <MessageCircle size={14} />
              Chat
            </Link>
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
            {providers.length === 0 ? (
              <Link
                to="/settings"
                className="text-sm text-violet-600 dark:text-violet-400 hover:underline"
              >
                Set up an LLM provider in Settings to enable updates
              </Link>
            ) : (
              <button
                onClick={() => void handleReconcileClick()}
                disabled={progress !== null}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {progress ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Batch {Math.min(progress.done + 1, progress.total)} of {progress.total}...
                  </>
                ) : (
                  <>
                    <GitMerge size={14} />
                    Update understanding
                  </>
                )}
              </button>
            )}
            </>
          )}
        </div>
      </div>

      {view === 'document' ? (
        <LivingDocumentView
          markdown={documentMarkdown}
          filenamePrefix={livingDocumentFilenamePrefix(project)}
        />
      ) : view === 'map' ? (
        map === null ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-gray-400" size={24} />
          </div>
        ) : (
          <ProjectMapView map={map} onOpenHistory={setHistoryObjectId} />
        )
      ) : (
        <>
      {understanding.pendingChanges.length > 0 && (
        <section className="mb-8">
          <h2 className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400 mb-3">
            <Sparkles size={14} />
            Proposed changes ({understanding.pendingChanges.length})
          </h2>
          <div className="space-y-3">
            {understanding.pendingChanges.map((change) => (
              <PendingChangeCard key={change.event.id} change={change} onReview={onEventReview} />
            ))}
          </div>
        </section>
      )}

      {isEmpty ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Compass size={48} className="mx-auto mb-4 opacity-50" />
          <p>No understanding synthesized {project ? 'for this project' : 'here'} yet</p>
          {project && (
            <p className="text-sm mt-2">
              Run discovery from the Projects page to extract direction, decisions, and questions
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          <Section
            icon={<Compass size={14} />}
            title="Current direction"
            items={understanding.direction}
            onReview={onObjectReview}
            onOpenHistory={setHistoryObjectId}
          />
          <Section
            icon={<Lightbulb size={14} />}
            title="Ideas & decisions"
            items={understanding.ideasAndDecisions}
            showType
            onReview={onObjectReview}
            onOpenHistory={setHistoryObjectId}
          />
          <Section
            icon={<HelpCircle size={14} />}
            title="Open questions"
            items={understanding.openQuestions}
            onReview={onObjectReview}
            onOpenHistory={setHistoryObjectId}
          />
          {understanding.recentChanges.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                <History size={14} />
                Recent changes
              </h2>
              <ul className="space-y-2">
                {understanding.recentChanges.map((change) => (
                  <RecentChangeRow key={change.event.id} change={change} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
        </>
      )}

      {historyObjectId && (
        <HistoryDrawer
          key={historyObjectId}
          objectId={historyObjectId}
          onClose={() => setHistoryObjectId(null)}
        />
      )}

      {pendingRun && (
        <DisclosureModal
          disclosure={pendingRun.disclosure}
          authMode={pendingRun.authMode}
          actionLabel={
            pendingRun.ignoreCursor
              ? 'Understanding reconciliation (full re-run)'
              : 'Understanding reconciliation'
          }
          onConfirm={() => void handleConfirmReconcile()}
          onCancel={() => setPendingRun(null)}
        />
      )}
    </div>
  );
}
