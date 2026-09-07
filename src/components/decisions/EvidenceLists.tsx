// Transcript-span and code-evidence renderers (SPEC-decision-recovery §10.5).
// Every quote is a text node; every link opens the primary source — the
// conversation message for spans, the cached file or a validated GitHub blob
// URL for code.

import { Link } from 'react-router-dom';
import { ExternalLink, FileCode2, MessageSquare } from 'lucide-react';
import { safeBlobUrl } from '../../lib/understanding/decisions/links';
import type { TranscriptSpan } from '../../types/decision';
import type { CodeEvidence } from '../../types/intentTrace';

const ROLE_LABEL: Record<TranscriptSpan['role'], string> = {
  user_msg: 'user',
  agent_text: 'agent',
  tool_call: 'tool call',
  tool_result: 'tool result',
};

export function Quote({ text }: { text: string }) {
  return (
    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 dark:bg-gray-950 p-2 text-xs text-gray-700 dark:text-gray-300">
      {text}
    </pre>
  );
}

export function SpanLinks({
  spans,
  conversationNames,
  compact,
  delegatedConversationIds,
}: {
  spans: TranscriptSpan[];
  conversationNames: Map<string, string>;
  compact?: boolean;
  /** Conversations that are subagent transcripts (SPEC-decision-recovery §8.3) — spans are labelled "delegated". */
  delegatedConversationIds?: Set<string>;
}) {
  if (spans.length === 0) return null;
  return (
    <ul className={`mt-1 space-y-${compact ? '1' : '2'}`} onClick={(e) => e.stopPropagation()}>
      {spans.map((s, i) => (
        <li key={`${s.messageId}-${s.stepIndex}-${i}`} className="text-xs">
          <Link
            to={`/conversations/${s.conversationId}?scrollTo=${encodeURIComponent(s.messageId)}`}
            className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400 hover:underline"
            title={`Step ${s.stepIndex} · ${ROLE_LABEL[s.role]}`}
          >
            <MessageSquare size={11} />
            {conversationNames.get(s.conversationId) ?? 'conversation'} · step {s.stepIndex} · {ROLE_LABEL[s.role]}
          </Link>
          {delegatedConversationIds?.has(s.conversationId) && (
            <span className="ml-2 inline-flex items-center rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" title="This step ran inside a delegated subagent">
              delegated
            </span>
          )}
          {!compact && <Quote text={s.quote} />}
        </li>
      ))}
    </ul>
  );
}

export function CodeEvidenceList({
  items,
  repoKey,
  sha,
  onOpen,
}: {
  items: CodeEvidence[];
  repoKey?: string;
  sha?: string;
  /** Open the cached file in-app (blast radius / detail); optional. */
  onOpen?: (ev: CodeEvidence) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 space-y-2">
      {items.map((ev, i) => {
        const href = safeBlobUrl(repoKey, sha, ev);
        const label = `${ev.path} L${ev.startLine}${ev.endLine !== ev.startLine ? `–L${ev.endLine}` : ''}`;
        return (
          <li key={`${ev.path}-${ev.startLine}-${i}`} className="text-xs">
            <span className="inline-flex items-center gap-2">
              <FileCode2 size={11} className="text-gray-400" />
              {onOpen ? (
                <button type="button" onClick={() => onOpen(ev)} className="font-mono text-violet-600 dark:text-violet-400 hover:underline">
                  {label}
                </button>
              ) : (
                <span className="font-mono text-gray-700 dark:text-gray-300">{label}</span>
              )}
              {href && (
                <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-violet-500 hover:underline" title="Open on GitHub at the pinned commit">
                  <ExternalLink size={11} />
                </a>
              )}
            </span>
            <Quote text={ev.quote} />
          </li>
        );
      })}
    </ul>
  );
}
