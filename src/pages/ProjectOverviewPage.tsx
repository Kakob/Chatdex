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
import { loadProjectSummary, type ProjectSummary } from '../lib/understanding/projectSummary';
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
  summary: ProjectSummary | null;
}

async function loadOverviewData(id: string): Promise<OverviewData | null> {
  const [project, associations, allConversations, objects, summary] = await Promise.all([
    getUnderstandingProject(id),
    getAssociationsForProject(id),
    db.conversations.orderBy('updatedAt').reverse().toArray(),
    getObjectsForProject(id, 'current'),
    loadProjectSummary(id),
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
    summary,
  };
}

interface StepStat {
  value: number;
  label: string;
  detail?: string;
}

interface StepStatus {
  stats: StepStat[];
  /** One plain sentence: what is (or isn't) there yet, or what to do next. */
  note: string;
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const day = (d: Date) => d.toLocaleDateString();

function investigateStatus(s: ProjectSummary['investigate']): StepStatus {
  const sourceDetail = [
    s.suggestedSources ? `+${s.suggestedSources} suggested` : '',
    s.researchSources ? `+${plural(s.researchSources, 'research source')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const stats: StepStat[] = [
    { value: s.sources, label: s.sources === 1 ? 'accepted source' : 'accepted sources', detail: sourceDetail || undefined },
    { value: s.investigations, label: s.investigations === 1 ? 'investigation' : 'investigations', detail: s.openInvestigations ? `${s.openInvestigations} open` : undefined },
    { value: s.findings, label: s.findings === 1 ? 'finding' : 'findings', detail: s.findings ? `${s.promotedFindings} promoted${s.draftFindings ? ` · ${s.draftFindings} draft` : ''}` : undefined },
    { value: s.pinnedEvidence, label: 'pinned evidence' },
  ];
  let note: string;
  if (s.investigations === 0 && s.sources === 0 && s.suggestedSources > 0) {
    note = `No investigations yet. Accept the ${plural(s.suggestedSources, 'suggested source')} on the Projects page to investigate ${s.suggestedSources === 1 ? 'it' : 'them'}.`;
  } else if (s.investigations === 0) {
    note = s.sources ? 'No investigations yet. Ask a question to start one.' : 'No sources or investigations yet.';
  } else {
    const lead = s.findings ? 'Findings are written by you.' : 'No findings written yet.';
    note = `${lead}${s.lastActivityAt ? ` Last worked on ${day(s.lastActivityAt)}.` : ''}`;
  }
  return { stats, note };
}

function understandingStatus(s: ProjectSummary['understanding']): StepStatus {
  const stats: StepStat[] = [
    { value: s.current, label: s.current === 1 ? 'current item' : 'current items', detail: s.current ? `${s.byYou} by you · ${s.byAi} by AI` : undefined },
    { value: s.awaitingReview, label: 'awaiting review', detail: s.proposedChanges ? `+${plural(s.proposedChanges, 'proposed change')}` : undefined },
    { value: s.openQuestions, label: s.openQuestions === 1 ? 'open question' : 'open questions' },
    {
      value: s.ideasAndDecisions,
      label: 'ideas & decisions',
      detail: [s.direction ? `+${s.direction} direction` : '', s.earlier ? `${s.earlier} superseded or resolved` : '']
        .filter(Boolean)
        .join(' · ') || undefined,
    },
  ];
  const updated = s.lastUpdatedAt
    ? `Last updated from conversations ${day(s.lastUpdatedAt)}.`
    : 'Update understanding has not been run on this project yet.';
  const note = s.current === 0 ? `Nothing in current understanding yet. ${updated}` : updated;
  return { stats, note };
}

function prepareStatus(s: ProjectSummary['prepare']): StepStatus {
  const stats: StepStat[] = [
    { value: s.changes, label: s.changes === 1 ? 'prepared change' : 'prepared changes', detail: s.changes ? `${s.inProgress} in progress · ${s.finished} done` : undefined },
    { value: s.readyPoints, label: 'accepted items to use' },
  ];
  let note: string;
  if (s.changes > 0) note = s.lastEditedAt ? `Last edited ${day(s.lastEditedAt)}.` : '';
  else if (s.readyPoints === 0) note = 'No changes prepared yet. Prepare Change uses accepted understanding, so accept some items first.';
  else note = 'No changes prepared yet.';
  return { stats, note };
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

      <section className="grid gap-4 lg:grid-cols-3" aria-label="Project workflow summary">
        {FLOW_CARDS.map(({ segment, title, description, icon: Icon }) => {
          const status = data.summary
            ? segment === 'investigate'
              ? investigateStatus(data.summary.investigate)
              : segment === 'understanding'
                ? understandingStatus(data.summary.understanding)
                : prepareStatus(data.summary.prepare)
            : null;
          return (
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
              {status && (
                <>
                  <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-100 dark:border-gray-800 pt-4">
                    {status.stats.map((stat) => (
                      <li key={stat.label} className="min-w-0">
                        <span className="text-xl font-semibold tabular-nums text-gray-900 dark:text-white">
                          {stat.value}
                        </span>{' '}
                        <span className="text-sm text-gray-600 dark:text-gray-300">{stat.label}</span>
                        {stat.detail && (
                          <span className="block text-xs text-gray-400">{stat.detail}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {status.note && (
                    <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{status.note}</p>
                  )}
                </>
              )}
            </Link>
          );
        })}
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
