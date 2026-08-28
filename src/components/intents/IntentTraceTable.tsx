import { IntentTraceRow } from './IntentTraceRow';
import type { IntentRow } from '../../lib/understanding/intents/intentMatrix';
import type { ReviewState } from '../../types/understanding';
import type { DataSource } from '../../types';

export function IntentTraceTable({
  rows,
  sourcesByConversation,
  onReview,
  onOpenHistory,
  onTrace,
  traceDisabledReason,
}: {
  rows: IntentRow[];
  sourcesByConversation: Map<string, DataSource>;
  onReview: (objectId: string, state: ReviewState) => void;
  onOpenHistory: (objectId: string) => void;
  onTrace?: (objectId: string, extraPath?: string) => void;
  traceDisabledReason?: string | null;
}) {
  return (
    <div className="space-y-3" data-testid="intent-matrix">
      <div className="hidden md:grid md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1.4fr)] gap-3 px-4 text-xs uppercase tracking-wide text-gray-400">
        <div>Stated</div>
        <div>Spec</div>
        <div>Implementation</div>
      </div>
      {rows.map((row) => (
        <IntentTraceRow
          key={row.object.id}
          row={row}
          sources={[
            ...new Set(
              row.evidence
                .map((e) => sourcesByConversation.get(e.conversationId))
                .filter((s): s is DataSource => s !== undefined)
            ),
          ]}
          onReview={onReview}
          onOpenHistory={onOpenHistory}
          onTrace={onTrace}
          traceDisabledReason={traceDisabledReason}
        />
      ))}
    </div>
  );
}
