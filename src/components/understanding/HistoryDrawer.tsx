import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, History, Loader2, Sparkles, X } from 'lucide-react';
import {
  loadObjectHistory,
  type ObjectHistory,
  type ChainEntry,
  type HistoryEvent,
} from '../../lib/understanding/history';
import { OP_LABEL } from '../../lib/understanding/livingDocument';
import { EvidenceLinks } from './EvidenceLinks';
import type { UnderstandingStatus } from '../../types/understanding';

const STATUS_STYLE: Record<UnderstandingStatus, string> = {
  current: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300',
  superseded: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  resolved: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300',
};

function StatusBadge({ status }: { status: UnderstandingStatus }) {
  return (
    <span className={`px-1.5 py-0.5 text-xs rounded-full ${STATUS_STYLE[status]}`}>{status}</span>
  );
}

/** One direction of the supersession chain, as navigation buttons. */
function ChainRow({
  label,
  icon,
  entries,
  onNavigate,
}: {
  label: string;
  icon: React.ReactNode;
  entries: ChainEntry[];
  onNavigate: (objectId: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400">
        {icon}
        {label}
      </span>
      {entries.map((entry) => (
        <button
          key={entry.objectId}
          onClick={() => onNavigate(entry.objectId)}
          title={`View history of "${entry.title}"`}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
        >
          <span className="truncate max-w-60">{entry.title}</span>
          <StatusBadge status={entry.status} />
        </button>
      ))}
    </div>
  );
}

function EventRow({ row }: { row: HistoryEvent }) {
  const { event } = row;
  const rejected = event.reviewState === 'rejected';
  return (
    <li
      className={`relative pl-4 pb-5 border-l-2 last:pb-0 ${
        rejected
          ? 'border-gray-200 dark:border-gray-800 opacity-60'
          : 'border-violet-200 dark:border-violet-900/50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-gray-400 tabular-nums">
          {event.occurredAt.toLocaleDateString()}
        </span>
        <span className="px-1.5 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
          {OP_LABEL[event.op] ?? event.op}
        </span>
        {event.origin === 'ai' && (
          <span title="AI-proposed" className="text-gray-400">
            <Sparkles size={10} />
          </span>
        )}
        {event.reviewState === 'pending' && (
          <span className="text-xs text-amber-600 dark:text-amber-400">pending review</span>
        )}
        {rejected && <span className="text-xs text-red-500">rejected — not applied</span>}
        {row.statusAfter && (
          <span className={`px-1.5 py-0.5 text-xs rounded-full ${STATUS_STYLE[row.statusAfter]}`}>
            → {row.statusAfter}
          </span>
        )}
      </div>
      {event.detail && (
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{event.detail}</p>
      )}
      {row.supersededByTitle && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          → Replaced by: <span className="font-medium">{row.supersededByTitle}</span>
        </p>
      )}
      <EvidenceLinks evidence={row.evidence} />
    </li>
  );
}

/**
 * Slide-over showing one object's full history (PRD §23 HISTORY, U4.3):
 * audit-trail event stream, status transitions, and supersession-chain
 * navigation — clicking a chain entry re-targets the drawer in place.
 */
export function HistoryDrawer({
  objectId,
  onClose,
}: {
  objectId: string;
  onClose: () => void;
}) {
  const [currentId, setCurrentId] = useState(objectId);
  const [loaded, setLoaded] = useState<{ id: string; history: ObjectHistory | null } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    void loadObjectHistory(currentId).then((history) => {
      if (!cancelled) setLoaded({ id: currentId, history });
    });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  // Loading whenever the loaded snapshot doesn't match the target object yet.
  const history = loaded?.id === currentId ? loaded.history : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-full max-w-lg bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-xl overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400">
            <History size={14} />
            History
          </span>
          <button
            onClick={onClose}
            title="Close"
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4">
          {history === undefined ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin text-gray-400" size={20} />
            </div>
          ) : history === null ? (
            <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
              Object not found
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-1.5 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  {history.object.type}
                </span>
                <h2 className="text-base font-medium text-gray-900 dark:text-white">
                  {history.object.title}
                </h2>
                <StatusBadge status={history.object.status} />
                {history.object.origin === 'ai' && history.object.reviewState === 'pending' && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300"
                    title="AI-proposed, not yet reviewed"
                  >
                    <Sparkles size={10} /> pending
                  </span>
                )}
              </div>
              {history.object.body && (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {history.object.body}
                </p>
              )}

              {(history.replaces.length > 0 || history.replacedBy.length > 0) && (
                <div className="mt-4 space-y-2">
                  <ChainRow
                    label="Replaces:"
                    icon={<ArrowLeft size={12} />}
                    entries={history.replaces}
                    onNavigate={setCurrentId}
                  />
                  <ChainRow
                    label="Replaced by:"
                    icon={<ArrowRight size={12} />}
                    entries={history.replacedBy}
                    onNavigate={setCurrentId}
                  />
                </div>
              )}

              <h3 className="mt-6 mb-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                Timeline
              </h3>
              {history.events.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No events recorded</p>
              ) : (
                <ul>
                  {history.events.map((row) => (
                    <EventRow key={row.event.id} row={row} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
