// Virtualized primary-source reader (SPEC-decision-investigation §8.2, §13).
// Renders the complete normalized step stream — prose is always shown
// verbatim and in full; only tool payloads may collapse, clearly labeled,
// and always expand to the exact original content. Bounded rendering via
// @tanstack/react-virtual (spec §16.4) without changing order or text.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { WorkbenchStep } from '../../lib/investigation/context';
import type { StepSearchMatch } from '../../lib/investigation/search';
import type { StepKind } from '../../lib/detection/normalize';

const KIND_META: Record<StepKind, { label: string; tone: string }> = {
  user_msg: {
    label: 'User',
    tone: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  },
  agent_text: {
    label: 'Assistant',
    tone: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  tool_call: {
    label: 'Tool call',
    tone: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  tool_result: {
    label: 'Tool result',
    tone: 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  },
};

export interface ScrollRequest {
  stepIndex: number;
  /** Monotonic sequence so repeated jumps to the same step still fire. */
  seq: number;
}

interface TranscriptReaderProps {
  steps: WorkbenchStep[];
  displayTexts: string[];
  /** Step indexes that are code-change anchors in this conversation. */
  anchorStepIndexes: Set<number>;
  /** The primary anchor's step (opens expanded, visually marked). */
  primaryStepIndex: number;
  /** Tool-call step currently shown in the code panel. */
  selectedCodeStepIndex: number | null;
  matchesByStep: Map<number, StepSearchMatch[]>;
  currentMatch: StepSearchMatch | null;
  scrollRequest: ScrollRequest | null;
  onToolCallClick: (stepIndex: number) => void;
  /** Steps inside a confirmed review scope (visual display, spec §8.7). */
  reviewedStepIndexes?: Set<number>;
}

export function TranscriptReader({
  steps,
  displayTexts,
  anchorStepIndexes,
  primaryStepIndex,
  selectedCodeStepIndex,
  matchesByStep,
  currentMatch,
  scrollRequest,
  onToolCallClick,
  reviewedStepIndexes,
}: TranscriptReaderProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set([primaryStepIndex])
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual is outside the react compiler's scope; this component opts out of compilation
  const virtualizer = useVirtualizer({
    count: steps.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 8,
  });

  useEffect(() => {
    if (!scrollRequest) return;
    virtualizer.scrollToIndex(scrollRequest.stepIndex, { align: 'center' });
  }, [scrollRequest, virtualizer]);

  // A match inside a collapsed payload must become visible (spec §8.2:
  // collapsed material expands to the exact original content).
  useEffect(() => {
    if (!currentMatch) return;
    setExpanded((prev) => {
      if (prev.has(currentMatch.stepIndex)) return prev;
      const next = new Set(prev);
      next.add(currentMatch.stepIndex);
      return next;
    });
  }, [currentMatch]);

  const toggle = (index: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div
      ref={parentRef}
      className="h-full overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
      aria-label="Source transcript"
    >
      <div
        style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const ws = steps[item.index];
          const isToolPayload =
            ws.step.kind === 'tool_call' || ws.step.kind === 'tool_result';
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
            >
              <StepRow
                ws={ws}
                text={displayTexts[item.index]}
                isAnchor={anchorStepIndexes.has(item.index)}
                isPrimary={item.index === primaryStepIndex}
                isSelectedCode={item.index === selectedCodeStepIndex}
                isReviewed={reviewedStepIndexes?.has(item.index) ?? false}
                isExpanded={!isToolPayload || expanded.has(item.index)}
                matches={matchesByStep.get(item.index) ?? []}
                currentMatch={
                  currentMatch?.stepIndex === item.index ? currentMatch : null
                }
                onToggle={() => toggle(item.index)}
                onToolCallClick={
                  ws.step.kind === 'tool_call' && ws.step.editHunks
                    ? () => onToolCallClick(item.index)
                    : undefined
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepRow({
  ws,
  text,
  isAnchor,
  isPrimary,
  isSelectedCode,
  isReviewed,
  isExpanded,
  matches,
  currentMatch,
  onToggle,
  onToolCallClick,
}: {
  ws: WorkbenchStep;
  text: string;
  isAnchor: boolean;
  isPrimary: boolean;
  isSelectedCode: boolean;
  isReviewed: boolean;
  isExpanded: boolean;
  matches: StepSearchMatch[];
  currentMatch: StepSearchMatch | null;
  onToggle: () => void;
  onToolCallClick?: () => void;
}) {
  const { step, occurredAt } = ws;
  const meta = KIND_META[step.kind];
  const isToolPayload = step.kind === 'tool_call' || step.kind === 'tool_result';

  return (
    <div
      className={`px-4 py-3 border-b border-gray-100 dark:border-gray-800 border-l-2 ${
        isReviewed ? 'border-l-emerald-400/80' : 'border-l-transparent'
      } ${
        isPrimary
          ? 'bg-violet-50/60 dark:bg-violet-900/10'
          : isSelectedCode
            ? 'bg-blue-50/50 dark:bg-blue-900/10'
            : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-xs">
        <span className={`px-1.5 py-0.5 rounded-full font-medium ${meta.tone}`}>
          {meta.label}
        </span>
        {step.toolName && (
          <span className="font-mono text-gray-600 dark:text-gray-400">
            {step.toolName}
          </span>
        )}
        <span className="text-gray-400 dark:text-gray-500 tabular-nums">
          #{step.index}
        </span>
        {occurredAt && (
          <span className="text-gray-400 dark:text-gray-500 tabular-nums">
            {occurredAt.toLocaleString()}
          </span>
        )}
        {isAnchor && (
          <span className="px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
            code change
          </span>
        )}
        {matches.length > 0 && (
          <span className="text-violet-500 dark:text-violet-400 tabular-nums">
            {matches.length} match{matches.length === 1 ? '' : 'es'}
          </span>
        )}
        {isToolPayload && (
          <button
            type="button"
            onClick={onToggle}
            className="ml-auto flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            aria-expanded={isExpanded}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {isExpanded ? 'Collapse payload' : 'Expand payload'}
          </button>
        )}
        {onToolCallClick && (
          <button
            type="button"
            onClick={onToolCallClick}
            className={`${isToolPayload ? '' : 'ml-auto '}text-violet-600 dark:text-violet-400 hover:underline`}
          >
            Show in code panel
          </button>
        )}
      </div>

      {isExpanded ? (
        text ? (
          <pre
            data-step-body={step.index}
            className="whitespace-pre-wrap break-words font-mono text-sm text-gray-800 dark:text-gray-200 max-h-96 overflow-y-auto"
          >
            <HighlightedBody text={text} matches={matches} currentMatch={currentMatch} />
          </pre>
        ) : (
          <p className="text-sm italic text-gray-400 dark:text-gray-500">(empty)</p>
        )
      ) : (
        <p className="text-sm text-gray-400 dark:text-gray-500">
          Payload collapsed — {text.length.toLocaleString()} characters. Expand to
          read the exact original content.
        </p>
      )}
    </div>
  );
}

// Literal character-exact highlighting (spec §8.6): mark precisely the
// matched ranges, nothing else.
function HighlightedBody({
  text,
  matches,
  currentMatch,
}: {
  text: string;
  matches: StepSearchMatch[];
  currentMatch: StepSearchMatch | null;
}) {
  const segments = useMemo(() => {
    if (matches.length === 0) return [{ text, kind: 'plain' as const }];
    const out: { text: string; kind: 'plain' | 'match' | 'current' }[] = [];
    let cursor = 0;
    for (const m of matches) {
      if (m.start > cursor) out.push({ text: text.slice(cursor, m.start), kind: 'plain' });
      out.push({
        text: text.slice(m.start, m.end),
        kind:
          currentMatch && m.start === currentMatch.start && m.end === currentMatch.end
            ? 'current'
            : 'match',
      });
      cursor = m.end;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor), kind: 'plain' });
    return out;
  }, [text, matches, currentMatch]);

  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'plain' ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <mark
            key={i}
            className={
              seg.kind === 'current'
                ? 'bg-orange-300 dark:bg-orange-600/70 text-inherit rounded-sm'
                : 'bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded-sm'
            }
          >
            {seg.text}
          </mark>
        )
      )}
    </>
  );
}
