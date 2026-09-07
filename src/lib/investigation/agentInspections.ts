// Deterministic agent-inspection derivation (SPEC-decision-recovery §8.1).
//
// One row per Read / Grep / Glob / LS tool call in the detection layer's
// normalized step stream — what the agent *saw*, the counterpart of the
// anchors' what it *changed*. Purely mechanical: no classification, no model.
// Ids reuse the anchor key scheme (`${sourceRef}#s${stepIndex}`), so a step
// that is an inspection and a step that is an anchor can never collide (a
// tool call is one or the other) and re-derivation is idempotent.
//
// Lives beside anchors.ts because it shares its substrate and source-ref
// logic. It is read by the recovery pipeline; nothing in Decision
// Investigation reads it (SPEC-decision-recovery law 2.5).

import { normalizeSession, type Step } from '../detection/normalize';
import { normalizePath } from '../detection/signatures';
import { db } from '../db/schema';
import { getMessagesForConversation } from '../db/messages';
import { replaceAgentInspections } from '../db/agentInspections';
import { getConversationSourceRef, type ConversationSourceRef } from './anchors';
import type { AgentInspection, AgentInspectionKind } from '../../types/decision';
import type { StoredConversation, StoredMessage } from '../../types/unified';

/** Bump whenever derivation output changes for identical input. */
export const INSPECTION_DERIVER_VERSION = '1.0.0';

const KIND_BY_TOOL: Record<string, AgentInspectionKind> = {
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  LS: 'list',
};

export async function deriveAgentInspectionsForConversation(
  conversationId: string
): Promise<AgentInspection[]> {
  const conversation = await db.conversations.get(conversationId);
  const messages = await getMessagesForConversation(conversationId);
  const rows = buildAgentInspections(
    conversationId,
    messages,
    await getConversationSourceRef(conversationId),
    rootsFor(conversation)
  );
  await replaceAgentInspections(conversationId, rows);
  return rows;
}

/** Working-directory roots used to make absolute tool paths repo-relative. */
export function rootsFor(conversation: StoredConversation | undefined): string[] {
  if (!conversation) return [];
  return [conversation.projectPath, conversation.workingDirectory].filter(
    (r): r is string => Boolean(r)
  );
}

/** Pure derivation over stored messages (exposed for tests and the pipeline). */
export function buildAgentInspections(
  conversationId: string,
  messages: StoredMessage[],
  source: ConversationSourceRef,
  roots: string[]
): AgentInspection[] {
  const { steps } = normalizeSession(conversationId, messages);
  const messageById = new Map(messages.map((m) => [m.id, m]));
  const now = new Date();
  const out: AgentInspection[] = [];
  for (const step of inspectionSteps(steps)) {
    const kind = KIND_BY_TOOL[step.toolName!];
    const input = step.toolInput ?? {};
    const rawPath = str(input.file_path) ?? str(input.path);
    const id = `${source.ref}#s${step.index}`;
    out.push({
      id,
      conversationId,
      messageId: step.messageId,
      stepIndex: step.index,
      toolName: step.toolName!,
      kind,
      path: rawPath ? relativize(normalizePath(rawPath), roots) : undefined,
      pattern: str(input.pattern),
      occurredAt: messageById.get(step.messageId)?.createdAt ?? now,
      deriverVersion: INSPECTION_DERIVER_VERSION,
    });
  }
  return out;
}

/** Which steps derive an inspection, without persistence. */
export function inspectionSteps(steps: Step[]): Step[] {
  return steps.filter(
    (s) => s.kind === 'tool_call' && Boolean(s.toolName && KIND_BY_TOOL[s.toolName])
  );
}

/** Strip a known root prefix; keep already-relative paths; otherwise keep the absolute path. */
export function relativize(path: string, roots: string[]): string {
  if (!path.startsWith('/')) return path.replace(/^\.\//, '');
  for (const root of roots) {
    const r = normalizePath(root).replace(/\/+$/, '');
    if (r && path.startsWith(`${r}/`)) return path.slice(r.length + 1);
  }
  return path;
}

export interface InspectionBackfillResult {
  conversationsProcessed: number;
  inspectionsDerived: number;
  failures: number;
}

/** Idempotent backfill over every stored Claude Code session. */
export async function deriveAgentInspectionsForAllAgentSessions(
  onProgress?: (progress: { current: number; total: number }) => void
): Promise<InspectionBackfillResult> {
  const ids = (await db.conversations.where('source').equals('claude-code').primaryKeys()) as string[];
  let inspectionsDerived = 0;
  let failures = 0;
  for (let i = 0; i < ids.length; i++) {
    onProgress?.({ current: i + 1, total: ids.length });
    try {
      inspectionsDerived += (await deriveAgentInspectionsForConversation(ids[i])).length;
    } catch (err) {
      failures++;
      console.error('[decisions] inspection derivation failed for', ids[i], err);
    }
  }
  return { conversationsProcessed: ids.length, inspectionsDerived, failures };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
