import { Link } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import type { EvidenceLink } from '../../lib/understanding/currentUnderstanding';

/**
 * Conversation links for an evidence union (PRD §9 chain). Swallows click
 * propagation so it can sit inside clickable cards without triggering them.
 */
export function EvidenceLinks({ evidence }: { evidence: EvidenceLink[] }) {
  if (evidence.length === 0) return null;
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="inline-flex items-center gap-1">
        <MessageSquare size={12} /> From:
      </span>
      {evidence.map((ref) => {
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
