import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderKanban, Loader2, Sparkles } from 'lucide-react';
import { db, getConversations } from '../lib/db';
import {
  getAllUnderstandingProjects,
  setProjectReviewState,
  setAssociationReviewState,
} from '../lib/db/understanding';
import { listConfiguredProviders, getProviderInfo } from '../lib/providers';
import type { LLMProviderId } from '../lib/providers';
import {
  buildDisclosure,
  runDiscoveryInBatches,
  type DisclosureSummary,
} from '../lib/understanding/runDiscovery';
import { DisclosureModal } from '../components/understanding/DisclosureModal';
import { ProjectReviewCard, type AssociationRow } from '../components/understanding/ProjectReviewCard';
import { useToastStore } from '../stores/toastStore';
import type { StoredConversation } from '../types';
import type { UnderstandingProject, ReviewState } from '../types/understanding';

export function ProjectsPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [projects, setProjects] = useState<UnderstandingProject[]>([]);
  const [associationsByProject, setAssociationsByProject] = useState<
    Map<string, AssociationRow[]>
  >(new Map());
  const [providers, setProviders] = useState<LLMProviderId[]>([]);
  const [provider, setProvider] = useState<LLMProviderId | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [pendingRun, setPendingRun] = useState<{
    disclosure: DisclosureSummary;
    conversations: StoredConversation[];
  } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    const [projectRows, associations, configured] = await Promise.all([
      getAllUnderstandingProjects(),
      db.projectAssociations.toArray(),
      listConfiguredProviders(),
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

    setProjects(projectRows.filter((p) => p.reviewState !== 'rejected'));
    setAssociationsByProject(grouped);
    setProviders(configured);
    setProvider((prev) => prev ?? configured[0] ?? null);
    setIsLoading(false);
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
    setPendingRun({ disclosure: buildDisclosure(conversations, provider), conversations });
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

  const pending = projects.filter((p) => p.reviewState === 'pending');
  const reviewed = projects.filter((p) => p.reviewState !== 'pending');

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">Projects</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {projects.length} project{projects.length !== 1 ? 's' : ''}
            {pending.length > 0 && <> · {pending.length} awaiting review</>}
          </p>
        </div>

        <div className="flex items-center gap-2">
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
              Add an LLM provider key in Settings to enable discovery
            </Link>
          ) : (
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

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-gray-400" size={24} />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <FolderKanban size={48} className="mx-auto mb-4 opacity-50" />
          <p>No projects yet</p>
          <p className="text-sm mt-2">
            Run discovery to reconstruct projects from your conversation history
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
                {pending.map((project) => (
                  <ProjectReviewCard
                    key={project.id}
                    project={project}
                    associations={associationsByProject.get(project.id) ?? []}
                    onProjectReview={(state) => void handleProjectReview(project.id, state)}
                    onAssociationReview={(id, state) =>
                      void handleAssociationReview(id, state)
                    }
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
                {reviewed.map((project) => (
                  <ProjectReviewCard
                    key={project.id}
                    project={project}
                    associations={associationsByProject.get(project.id) ?? []}
                    onProjectReview={(state) => void handleProjectReview(project.id, state)}
                    onAssociationReview={(id, state) =>
                      void handleAssociationReview(id, state)
                    }
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {pendingRun && (
        <DisclosureModal
          disclosure={pendingRun.disclosure}
          onConfirm={() => void handleConfirmRun()}
          onCancel={() => setPendingRun(null)}
        />
      )}
    </div>
  );
}
