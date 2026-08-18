// Deterministic anchor derivation (SPEC-decision-investigation §7.3, DI-1b).
//
// One anchor per structured code-changing tool call, derived from the
// detection layer's normalized step stream (spec §21 decision 1 — shared
// substrate, no parallel normalizer). Purely mechanical: no classification,
// no semantic labels, no model involvement. Derivation is idempotent — the
// anchor id IS its stable key, computed from source identity + step ordinal —
// so re-running never duplicates and cases can reference anchors durably.

import { normalizeSession, type Step } from '../detection/normalize';
import { db } from '../db/schema';
import { getMessagesForConversation } from '../db/messages';
import { getRawSourcesForConversation } from '../db/rawSources';
import { replaceInvestigationAnchors } from '../db/investigationAnchors';
import { sha256Hex } from '../utils/hash';
import type {
  CodeChangeKind,
  DerivedFileChange,
  InvestigationAnchor,
} from '../../types/investigation';
import type { StoredMessage } from '../../types/unified';

// Bump whenever derivation output changes for identical input (keys, hashes,
// which tool calls anchor). Stored on every anchor row.
export const ANCHOR_DERIVER_VERSION = '1.0.0';

const KIND_BY_TOOL: Record<string, CodeChangeKind> = {
  Edit: 'edit',
  Write: 'write',
  MultiEdit: 'multi_edit',
  NotebookEdit: 'notebook_edit',
};

/**
 * Derive and persist anchors for one conversation. Returns the derived set.
 * Anchors come only from steps with structured edit hunks — an arbitrary
 * shell command never anchors (spec §7.3).
 */
export async function deriveAnchorsForConversation(
  conversationId: string
): Promise<InvestigationAnchor[]> {
  const messages = await getMessagesForConversation(conversationId);
  const anchors = await buildAnchors(
    conversationId,
    messages,
    await getConversationSourceRef(conversationId)
  );
  await replaceInvestigationAnchors(conversationId, anchors);
  return anchors;
}

export interface ConversationSourceRef {
  ref: string;
  contentHash?: string;
  provenance: 'raw' | 'legacy';
}

/**
 * Source identity for stable keys: the content hash of the earliest retained
 * raw source (the payload that actually produced the stored messages —
 * conversations are frozen at import, so later raw versions were skipped).
 * Pre-DI-1a imports have no retained raw; they key off the conversation id
 * and are marked 'legacy' until re-imported. Also used by exhibits/scopes
 * to stamp provenance at pin time.
 */
export async function getConversationSourceRef(
  conversationId: string
): Promise<ConversationSourceRef> {
  const sources = await getRawSourcesForConversation(conversationId);
  if (sources.length === 0) {
    return { ref: `conv:${conversationId}`, provenance: 'legacy' };
  }
  const earliest = sources.reduce((a, b) =>
    a.importedAt.getTime() <= b.importedAt.getTime() ? a : b
  );
  return { ref: earliest.contentHash, contentHash: earliest.contentHash, provenance: 'raw' };
}

async function buildAnchors(
  conversationId: string,
  messages: StoredMessage[],
  source: ConversationSourceRef
): Promise<InvestigationAnchor[]> {
  const { steps } = normalizeSession(conversationId, messages);
  const messageById = new Map(messages.map((m) => [m.id, m]));
  const now = new Date();

  const anchors: InvestigationAnchor[] = [];
  for (const step of steps) {
    if (!step.editHunks || step.editHunks.length === 0 || !step.toolName) continue;
    const kind = KIND_BY_TOOL[step.toolName];
    if (!kind) continue; // unknown edit-shaped tool: not anchorable in MVP

    const fileChanges: DerivedFileChange[] = [];
    for (let i = 0; i < step.editHunks.length; i++) {
      const hunk = step.editHunks[i];
      fileChanges.push({
        path: hunk.filePath,
        changeIndex: i,
        oldString: hunk.oldString,
        newString: hunk.newString,
        contentHash: await hashChange(hunk.filePath, hunk.oldString, hunk.newString),
      });
    }

    const stableKey = `${source.ref}#s${step.index}`;
    anchors.push({
      id: stableKey,
      stableKey,
      conversationId,
      messageId: step.messageId,
      stepIndex: step.index,
      toolName: step.toolName,
      toolUseId: step.toolUseId,
      kind,
      fileChanges,
      filePaths: dedupe(fileChanges.map((c) => c.path)),
      occurredAt: messageById.get(step.messageId)?.createdAt ?? now,
      sourceContentHash: source.contentHash,
      sourceProvenance: source.provenance,
      deriverVersion: ANCHOR_DERIVER_VERSION,
      createdAt: now,
    });
  }
  return anchors;
}

export interface BackfillProgress {
  current: number;
  total: number;
}

export interface BackfillResult {
  conversationsProcessed: number;
  anchorsDerived: number;
  failures: number;
}

/**
 * Derive anchors for every stored agent session (claude-code is the MVP's
 * only code-bearing source, spec §5.1). Idempotent — safe to re-run; used by
 * the Investigate page to cover conversations imported before DI-1b.
 * Per-conversation failures are counted, never thrown.
 */
export async function deriveAnchorsForAllAgentSessions(
  onProgress?: (progress: BackfillProgress) => void
): Promise<BackfillResult> {
  const ids = (await db.conversations
    .where('source')
    .equals('claude-code')
    .primaryKeys()) as string[];

  let anchorsDerived = 0;
  let failures = 0;
  for (let i = 0; i < ids.length; i++) {
    onProgress?.({ current: i + 1, total: ids.length });
    try {
      anchorsDerived += (await deriveAnchorsForConversation(ids[i])).length;
    } catch (err) {
      failures++;
      console.error('[investigation] backfill derivation failed for', ids[i], err);
    }
  }
  return { conversationsProcessed: ids.length, anchorsDerived, failures };
}

/** Exposed for tests: which steps would anchor, without persistence. */
export function anchorableSteps(steps: Step[]): Step[] {
  return steps.filter(
    (s) => Boolean(s.editHunks?.length) && Boolean(s.toolName && KIND_BY_TOOL[s.toolName])
  );
}

// NUL separators make the hash unambiguous across field boundaries; the
// undefined-vs-empty oldString distinction (edit vs whole-file write) is
// preserved via a marker.
async function hashChange(
  path: string,
  oldString: string | undefined,
  newString: string
): Promise<string> {
  return sha256Hex(`${path}\u0000${oldString === undefined ? '\u0001' : oldString}\u0000${newString}`);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
