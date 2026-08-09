import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Compass,
  HelpCircle,
  History,
  Lightbulb,
  Loader2,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import {
  loadProjectUnderstanding,
  type ProjectUnderstanding,
  type UnderstandingItem,
  type RecentChange,
} from '../lib/understanding/currentUnderstanding';
import { setObjectReviewState } from '../lib/db/understanding';
import { ReviewButtons } from '../components/understanding/ReviewButtons';
import type { ReviewState } from '../types/understanding';

/** Route id for the bucket of objects with no project (projectId null). */
export const UNASSIGNED_ROUTE_ID = 'unassigned';

function EvidenceLinks({ item }: { item: UnderstandingItem }) {
  if (item.evidence.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
      <span className="inline-flex items-center gap-1">
        <MessageSquare size={12} /> From:
      </span>
      {item.evidence.map((ref) => {
        if (ref.conversationName === null) {
          return (
            <span key={ref.conversationId} className="italic">
              (deleted conversation)
            </span>
          );
        }
        // PRD §9 chain: link straight to the first cited message when the
        // evidence is message-anchored; extra citations get numbered links.
        const messageIds = ref.messageIds ?? [];
        const target = (messageId?: string) =>
          messageId
            ? `/conversations/${ref.conversationId}?scrollTo=${messageId}`
            : `/conversations/${ref.conversationId}`;
        return (
          <span key={ref.conversationId} className="inline-flex items-center gap-1 min-w-0">
            <Link
              to={target(messageIds[0])}
              title={ref.note}
              className="text-violet-600 dark:text-violet-400 hover:underline truncate max-w-60"
            >
              {ref.conversationName}
            </Link>
            {messageIds.length > 1 &&
              messageIds.slice(1).map((messageId, idx) => (
                <Link
                  key={messageId}
                  to={target(messageId)}
                  title={`Cited message ${idx + 2} of ${messageIds.length}`}
                  className="text-violet-400 dark:text-violet-500 hover:underline"
                >
                  #{idx + 2}
                </Link>
              ))}
          </span>
        );
      })}
    </div>
  );
}

function ObjectCard({
  item,
  showType,
  onReview,
}: {
  item: UnderstandingItem;
  showType?: boolean;
  onReview: (objectId: string, state: ReviewState) => void;
}) {
  const { object } = item;
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
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
          <EvidenceLinks item={item} />
        </div>
        {object.reviewState === 'pending' && (
          <ReviewButtons small onReview={(state) => onReview(object.id, state)} />
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
}: {
  icon: React.ReactNode;
  title: string;
  items: UnderstandingItem[];
  showType?: boolean;
  onReview: (objectId: string, state: ReviewState) => void;
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
          <ObjectCard key={item.object.id} item={item} showType={showType} onReview={onReview} />
        ))}
      </div>
    </section>
  );
}

const OP_LABEL: Record<string, string> = {
  introduced: 'Introduced',
  supported: 'Supported',
  refined: 'Refined',
  superseded: 'Superseded',
  contradicted: 'Contradicted',
  reopened: 'Reopened',
  resolved: 'Resolved',
};

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
        {event.detail && (
          <span className="text-gray-500 dark:text-gray-400"> — {event.detail}</span>
        )}
      </div>
    </li>
  );
}

export function ProjectUnderstandingPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = id === UNASSIGNED_ROUTE_ID ? null : id;
  const [data, setData] = useState<ProjectUnderstanding | null | undefined>(undefined);

  const load = useCallback(() => {
    if (projectId === undefined) return Promise.resolve();
    return loadProjectUnderstanding(projectId).then(setData);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReview = async (objectId: string, state: ReviewState) => {
    await setObjectReviewState(objectId, state);
    await load();
  };
  const onReview = (objectId: string, state: ReviewState) =>
    void handleReview(objectId, state);

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

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {project ? project.name : 'Not tied to a project'}
        </h1>
        {subtitle && <p className="mt-1 text-gray-600 dark:text-gray-400">{subtitle}</p>}
      </div>

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
            onReview={onReview}
          />
          <Section
            icon={<Lightbulb size={14} />}
            title="Ideas & decisions"
            items={understanding.ideasAndDecisions}
            showType
            onReview={onReview}
          />
          <Section
            icon={<HelpCircle size={14} />}
            title="Open questions"
            items={understanding.openQuestions}
            onReview={onReview}
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
    </div>
  );
}
