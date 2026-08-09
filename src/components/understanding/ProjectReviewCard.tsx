import { Link } from 'react-router-dom';
import { FolderKanban, Sparkles } from 'lucide-react';
import { ReviewButtons } from './ReviewButtons';
import type { ProjectOverviewStats } from '../../lib/understanding/overview';
import type {
  UnderstandingProject,
  ProjectAssociation,
  ReviewState,
} from '../../types/understanding';

export interface AssociationRow {
  association: ProjectAssociation;
  conversationName: string;
}

export function ProjectReviewCard({
  project,
  associations,
  stats,
  onProjectReview,
  onAssociationReview,
}: {
  project: UnderstandingProject;
  associations: AssociationRow[];
  /** Understanding overview counts (U4.1); omitted → line not rendered. */
  stats?: ProjectOverviewStats;
  onProjectReview: (state: ReviewState) => void;
  onAssociationReview: (associationId: string, state: ReviewState) => void;
}) {
  const pendingAssociations = associations.filter(
    (a) => a.association.reviewState === 'pending'
  );
  const acceptedCount = associations.length - pendingAssociations.length;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FolderKanban size={16} className="text-violet-500 shrink-0" />
            <h3 className="text-sm font-semibold truncate">
              <Link
                to={`/projects/${project.id}`}
                className="text-gray-900 dark:text-white hover:text-violet-600 dark:hover:text-violet-400"
              >
                {project.name}
              </Link>
            </h3>
            {project.origin === 'ai' && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300"
                title="Proposed by AI analysis"
              >
                <Sparkles size={10} /> AI
              </span>
            )}
            {project.reviewState === 'pending' && (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300">
                pending review
              </span>
            )}
          </div>
          {project.description && (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{project.description}</p>
          )}
          <p className="mt-1 text-xs text-gray-400">
            {associations.length} conversation{associations.length !== 1 ? 's' : ''}
            {acceptedCount > 0 && pendingAssociations.length > 0 && (
              <> · {pendingAssociations.length} awaiting review</>
            )}
          </p>
          {stats && stats.objectCount > 0 && (
            <p className="mt-1 text-xs text-gray-400">
              {stats.objectCount} understanding object{stats.objectCount !== 1 ? 's' : ''}
              {stats.openQuestionCount > 0 && (
                <> · {stats.openQuestionCount} open question{stats.openQuestionCount !== 1 ? 's' : ''}</>
              )}
              {stats.pendingReviewCount > 0 && (
                <>
                  {' · '}
                  <span className="text-amber-600 dark:text-amber-400">
                    {stats.pendingReviewCount} proposal{stats.pendingReviewCount !== 1 ? 's' : ''} to review
                  </span>
                </>
              )}
              {stats.lastActivityAt && (
                <> · active {stats.lastActivityAt.toLocaleDateString()}</>
              )}
            </p>
          )}
        </div>
        {project.reviewState === 'pending' && <ReviewButtons onReview={onProjectReview} />}
      </div>

      {pendingAssociations.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
          {pendingAssociations.map(({ association, conversationName }) => (
            <li key={association.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <Link
                  to={`/conversations/${association.conversationId}`}
                  className="text-gray-800 dark:text-gray-200 hover:text-violet-600 dark:hover:text-violet-400 truncate block"
                >
                  {conversationName}
                </Link>
                <div className="text-xs text-gray-400">
                  {Math.round(association.confidence * 100)}% confidence
                  {association.reason && <> — {association.reason}</>}
                </div>
              </div>
              <ReviewButtons
                small
                onReview={(state) => onAssociationReview(association.id, state)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
