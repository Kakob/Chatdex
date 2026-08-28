// Guided-mode helpers (SPEC-change-workspace §13, PRD §9–10; CW-6). Every
// action here is deterministic: repository history via the read-only GitHub
// client, related conversations by literal text search over the project's
// own associated conversations. No provider call exists in this module —
// the Guided constraint test asserts it end-to-end.

import { listCommits, type CommitSummary, type GitHubClientOptions } from '../github/client';
import { getMessagesForConversation } from '../db/messages';
import { getAssociatedConversations } from '../understanding/reconcile';
import type { ProjectRepository } from '../../types/understanding';

/** Conversations scanned per lookup (bounded work; the rest are reported as skipped). */
export const MAX_RELATED_SCAN = 200;

export interface RelatedConversation {
  conversationId: string;
  name: string;
  source: string;
  hits: number;
  /** First message containing the term, for a `?scrollTo=` deep link. */
  firstMessageId?: string;
}

export function basename(path: string): string {
  const last = path.split('/').pop() ?? path;
  return last.replace(/\.[^.]+$/, '');
}

const IDENT_RE = /[A-Za-z_$][\w$]*/g;

/** The identifier a trace-node label most likely names (last identifier, e.g. `router.push` → `push`). */
export function symbolFromLabel(label: string): string | null {
  const idents = label.match(IDENT_RE) ?? [];
  const candidates = idents.filter((i) => i.length > 1 && !/^(?:the|a|an|to|of|in|on|and|or)$/i.test(i));
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/** Literal, case-insensitive search for `term` across the project's associated conversations. */
export async function findRelatedConversations(
  projectId: string,
  term: string,
  options: { limit?: number } = {}
): Promise<{ related: RelatedConversation[]; scanned: number; skipped: number }> {
  const needle = term.trim().toLowerCase();
  if (!needle) return { related: [], scanned: 0, skipped: 0 };
  const conversations = await getAssociatedConversations(projectId);
  const toScan = conversations.slice(0, MAX_RELATED_SCAN);
  const related: RelatedConversation[] = [];
  for (const conversation of toScan) {
    if (!conversation.fullText?.toLowerCase().includes(needle)) continue;
    const messages = await getMessagesForConversation(conversation.id);
    let hits = 0;
    let firstMessageId: string | undefined;
    for (const message of messages) {
      const text = message.text?.toLowerCase() ?? '';
      let idx = text.indexOf(needle);
      while (idx !== -1) {
        hits += 1;
        if (!firstMessageId) firstMessageId = message.id;
        idx = text.indexOf(needle, idx + needle.length);
      }
    }
    if (hits > 0) {
      related.push({ conversationId: conversation.id, name: conversation.name ?? conversation.id, source: conversation.source, hits, ...(firstMessageId ? { firstMessageId } : {}) });
    }
  }
  related.sort((a, b) => b.hits - a.hits);
  return { related: related.slice(0, options.limit ?? 20), scanned: toScan.length, skipped: Math.max(0, conversations.length - toScan.length) };
}

/** Commits touching a path — history evidence candidates (PRD §7 "Supported by history"). */
export async function commitsTouchingPath(
  repository: ProjectRepository,
  path: string,
  opts: GitHubClientOptions = {},
  perPage = 10
): Promise<CommitSummary[]> {
  return listCommits(repository.owner, repository.repo, { path, perPage, ...(repository.pinnedRef ? {} : {}) }, opts);
}
