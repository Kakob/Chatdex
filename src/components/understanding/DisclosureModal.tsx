import { AlertTriangle, Send, X } from 'lucide-react';
import { SOURCE_META, SourceIcon } from '../common/sourceMeta';
import type { AuthMode } from '../../lib/providers';
import type { DisclosureSummary } from '../../lib/understanding/runDiscovery';

// Invariant 6 consent surface: states which provider receives which sources
// before any conversation content leaves the client, with cross-provider
// transfers called out explicitly.
export function DisclosureModal({
  disclosure,
  authMode,
  onConfirm,
  onCancel,
  actionLabel = 'Project discovery',
}: {
  disclosure: DisclosureSummary;
  authMode: AuthMode;
  onConfirm: () => void;
  onCancel: () => void;
  /** What the run is called in the copy, e.g. "Understanding reconciliation". */
  actionLabel?: string;
}) {
  const crossProvider = disclosure.crossProviderSources;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Send conversation excerpts to {disclosure.providerLabel}?
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {actionLabel} sends excerpts from {disclosure.totalConversations} conversation
          {disclosure.totalConversations !== 1 ? 's' : ''} to {disclosure.providerLabel}
          {authMode === 'subscription'
            ? `, billed to your ${disclosure.providerLabel} subscription,`
            : ' using your own API key,'}{' '}
          via Chatdex&apos;s transit-only relay (nothing is stored or logged server-side).
        </p>

        <ul className="space-y-1.5 mb-4">
          {disclosure.bySource.map(({ source, count }) => (
            <li
              key={source}
              className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200"
            >
              <SourceIcon source={source} />
              {SOURCE_META[source].label}: {count} conversation{count !== 1 ? 's' : ''}
              {crossProvider.includes(source) && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  (from a different provider)
                </span>
              )}
            </li>
          ))}
        </ul>

        {crossProvider.length > 0 && (
          <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              This sends {crossProvider.map((s) => SOURCE_META[s].label).join(' and ')} history to{' '}
              {disclosure.providerLabel} — a provider it did not originate from.
            </span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
          >
            <Send size={14} />
            Send and analyze
          </button>
        </div>
      </div>
    </div>
  );
}
