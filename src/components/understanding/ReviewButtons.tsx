import { Check, X } from 'lucide-react';
import type { ReviewState } from '../../types/understanding';

/** Accept / reject pair used across the understanding review surfaces. */
export function ReviewButtons({
  onReview,
  small,
}: {
  onReview: (state: ReviewState) => void;
  small?: boolean;
}) {
  const pad = small ? 'p-1' : 'px-2.5 py-1.5';
  return (
    <span className="flex items-center gap-1">
      <button
        onClick={() => onReview('accepted')}
        title="Accept"
        className={`${pad} text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors`}
      >
        <Check size={small ? 14 : 16} />
      </button>
      <button
        onClick={() => onReview('rejected')}
        title="Reject"
        className={`${pad} text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors`}
      >
        <X size={small ? 14 : 16} />
      </button>
    </span>
  );
}
