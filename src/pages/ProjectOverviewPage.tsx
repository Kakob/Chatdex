import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, History, Lightbulb, Link2, PencilRuler, Plus } from 'lucide-react';
import { db } from '../lib/db/schema';
import {
  associateConversationWithProject,
  getAssociationsForProject,
  getUnderstandingProject,
} from '../lib/db/understanding';
import { getObjectsForProject } from '../lib/db/understanding';
import { useToastStore } from '../stores/toastStore';
import { RepoBindingCard } from '../components/intents/RepoBindingCard';
import type { StoredConversation } from '../types';
import type { ProjectAssociation, UnderstandingProject } from '../types/understanding';

interface OverviewData {
  project: UnderstandingProject;
  associations: ProjectAssociation[];
  conversations: StoredConversation[];
  allConversations: StoredConversation[];
  acceptedUnderstandingCount: number;
}

async function loadOverviewData(id: string): Promise<OverviewData | null> {
  const [project, associations, allConversations, objects] = await Promise.all([
    getUnderstandingProject(id),
    getAssociationsForProject(id),
    db.conversations.orderBy('updatedAt').reverse().toArray(),
    getObjectsForProject(id, 'current'),
  ]);
  if (!project) return null;
  const visibleAssociations = associations.filter(
    (association) => association.reviewState !== 'rejected'
  );
  const conversationIds = new Set(
    visibleAssociations.map((association) => association.conversationId)
  );
  return {
    project,
    associations: visibleAssociations,
    conversations: allConversations.filter((conversation) =>
      conversationIds.has(conversation.id)
    ),
    allConversations,
    acceptedUnderstandingCount: objects.filter(
      (object) => object.reviewState === 'accepted' || object.reviewState === 'edited'
    ).length,
  };
}

const FLOW_CARDS = [
  {
    segment: 'investigate',
    title: 'Investigate History',
    description: 'Ask a real project question, read primary sources, and preserve exact evidence.',
    icon: History,
  },
  {
    segment: 'understanding',
    title: 'Current Understanding',
    description: 'Review the source-linked beliefs, decisions, constraints, and open questions you accept.',
    icon: Lightbulb,
  },
  {
    segment: 'prepare',
    title: 'Prepare Change',
    description: 'Turn selected understanding into bounded, implementation-ready intent.',
    icon: PencilRuler,
  },
] as const;

export function ProjectOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const addToast = useToastStore((state) => state.addToast);
  const [data, setData] = useState<OverviewData | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    void loadOverviewData(id).then((next) => {
      if (!cancelled) setData(next);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const availableConversations = useMemo(() => {
    if (!data) return [];
    const associated = new Set(data.associations.map((association) => association.conversationId));
    return data.allConversations.filter((conversation) => !associated.has(conversation.id));
  }, [data]);

  const handleAddSource = async () => {
    if (!id || !selectedConversationId) return;
    try {
      await associateConversationWithProject(id, selectedConversationId);
      setSelectedConversationId('');
      addToast('Source added to project');
      setData(await loadOverviewData(id));
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  if (!data || !id) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading overview…</p>;
  }

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm font-medium text-violet-600 dark:text-violet-400">Project overview</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
          {data.project.name}
        </h1>
        {data.project.description && (
          <p className="mt-2 max-w-3xl text-gray-600 dark:text-gray-400">
            {data.project.description}
          </p>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {FLOW_CARDS.map(({ segment, title, description, icon: Icon }) => (
          <Link
            key={segment}
            to={`/projects/${id}/${segment}`}
            className="group rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:border-violet-300 dark:hover:border-violet-800 transition-colors"
          >
            <div className="flex items-center gap-2 text-gray-900 dark:text-white font-semibold">
              <Icon size={18} className="text-violet-500" />
              {title}
              <ArrowRight size={15} className="ml-auto text-gray-300 group-hover:text-violet-500" />
            </div>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{description}</p>
          </Link>
        ))}
      </section>

      <RepoBindingCard
        project={data.project}
        onSaved={(project) => setData((prev) => (prev ? { ...prev, project } : prev))}
      />

      <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
              <Link2 size={17} className="text-violet-500" />
              Project sources
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {data.conversations.length} associated conversation{data.conversations.length === 1 ? '' : 's'} ·{' '}
              {data.acceptedUnderstandingCount} accepted understanding point{data.acceptedUnderstandingCount === 1 ? '' : 's'}
            </p>
          </div>
          {availableConversations.length > 0 && (
            <div className="flex max-w-xl items-center gap-2">
              <select
                value={selectedConversationId}
                onChange={(event) => setSelectedConversationId(event.target.value)}
                aria-label="Conversation to add"
                className="min-w-0 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
              >
                <option value="">Choose an imported conversation…</option>
                {availableConversations.map((conversation) => (
                  <option key={conversation.id} value={conversation.id}>
                    {conversation.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleAddSource()}
                disabled={!selectedConversationId}
                className="flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
              >
                <Plus size={14} /> Add source
              </button>
            </div>
          )}
        </div>

        {data.conversations.length === 0 ? (
          <div className="mt-5 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-5 text-sm text-gray-500 dark:text-gray-400">
            Import a conversation, then attach it here so Investigate History has primary material to read.
            <Link to="/import" className="ml-1 text-violet-600 dark:text-violet-400 hover:underline">
              Import conversations
            </Link>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
            {data.conversations.map((conversation) => (
              <li key={conversation.id} className="flex items-center gap-3 py-3 text-sm">
                <Link
                  to={`/conversations/${conversation.id}`}
                  className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200 hover:text-violet-600 dark:hover:text-violet-400"
                >
                  {conversation.name}
                </Link>
                <span className="text-xs text-gray-400">{conversation.source}</span>
                <span className="text-xs text-gray-400 tabular-nums">
                  {conversation.messageCount} messages
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
