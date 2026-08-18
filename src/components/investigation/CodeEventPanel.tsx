// Code-event region (SPEC-decision-investigation §8.2): the exact tool
// payload of the selected code-changing event — literal metadata, verbatim
// old/new text. Never generates prose about the code.

import type { WorkbenchStep } from '../../lib/investigation/context';
import type { InvestigationAnchor } from '../../types/investigation';
import { KIND_LABELS } from '../../lib/investigation/filter';

export interface CodePanelChange {
  path: string;
  changeIndex: number;
  oldString?: string;
  newString: string;
}

interface CodeEventPanelProps {
  anchor: InvestigationAnchor;
  /** The tool-call step whose changes are shown (may differ from the anchor). */
  selected: WorkbenchStep | null;
  changes: CodePanelChange[];
  isAnchorEvent: boolean;
  onJumpToTranscript: (stepIndex: number) => void;
  onBackToAnchorEvent: () => void;
}

export function CodeEventPanel({
  anchor,
  selected,
  changes,
  isAnchorEvent,
  onJumpToTranscript,
  onBackToAnchorEvent,
}: CodeEventPanelProps) {
  const step = selected?.step;
  return (
    <section
      aria-label="Code event"
      className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col min-h-0"
    >
      <header className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <h2 className="font-semibold text-gray-900 dark:text-white">Code event</h2>
          {step && (
            <>
              <span className="font-mono text-gray-600 dark:text-gray-400">
                {step.toolName}
              </span>
              <span className="text-gray-400 dark:text-gray-500 tabular-nums">
                step #{step.index}
              </span>
              {selected?.occurredAt && (
                <span className="text-gray-400 dark:text-gray-500 tabular-nums">
                  {selected.occurredAt.toLocaleString()}
                </span>
              )}
            </>
          )}
          {step && (
            <button
              type="button"
              onClick={() => onJumpToTranscript(step.index)}
              className="ml-auto text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline"
            >
              Show in transcript
            </button>
          )}
        </div>
        {!isAnchorEvent && (
          <button
            type="button"
            onClick={onBackToAnchorEvent}
            className="mt-1 text-xs text-gray-500 dark:text-gray-400 hover:underline"
          >
            ← Back to this investigation's anchor event ({KIND_LABELS[anchor.kind]},
            step #{anchor.stepIndex})
          </button>
        )}
      </header>

      <div className="p-4 space-y-4 overflow-y-auto min-h-0">
        {changes.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            The selected event carries no structured code change.
          </p>
        ) : (
          changes.map((change) => (
            <div key={`${change.path}-${change.changeIndex}`}>
              <p className="font-mono text-sm text-gray-900 dark:text-gray-100 mb-2 break-all">
                {change.path}
                {changes.length > 1 && (
                  <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                    change {change.changeIndex}
                  </span>
                )}
              </p>
              {change.oldString !== undefined ? (
                <div className="space-y-2">
                  <CodeBlock label="Old" text={change.oldString} tone="removed" />
                  <CodeBlock label="New" text={change.newString} tone="added" />
                </div>
              ) : (
                <CodeBlock label="Written content" text={change.newString} tone="added" />
              )}
            </div>
          ))
        )}

        <dl className="text-xs text-gray-500 dark:text-gray-400 space-y-1 pt-2 border-t border-gray-100 dark:border-gray-800">
          <MetaRow label="Anchor key" value={anchor.stableKey} />
          {anchor.toolUseId && <MetaRow label="Tool use id" value={anchor.toolUseId} />}
          <MetaRow
            label="Source"
            value={
              anchor.sourceProvenance === 'raw'
                ? `raw payload ${anchor.sourceContentHash?.slice(0, 12)}…`
                : 'legacy (imported before raw retention)'
            }
          />
        </dl>
      </div>
    </section>
  );
}

function CodeBlock({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone: 'added' | 'removed';
}) {
  return (
    <div>
      <p
        className={`text-xs font-medium mb-0.5 ${
          tone === 'removed'
            ? 'text-red-600 dark:text-red-400'
            : 'text-green-700 dark:text-green-400'
        }`}
      >
        {label}
      </p>
      <pre
        className={`whitespace-pre-wrap break-words font-mono text-xs rounded-lg p-2 max-h-64 overflow-y-auto border ${
          tone === 'removed'
            ? 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30'
            : 'bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30'
        } text-gray-800 dark:text-gray-200`}
      >
        {text || <span className="italic text-gray-400">(empty)</span>}
      </pre>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0">{label}:</dt>
      <dd className="font-mono break-all">{value}</dd>
    </div>
  );
}
