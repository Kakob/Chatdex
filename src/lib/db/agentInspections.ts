// Derived agent inspections (SPEC-decision-recovery §8.1). LOCAL-ONLY, never
// synced: rows are rebuilt deterministically from stored messages and their
// ids survive re-derivation. Stage 01 — what the agent saw.

import { db } from './schema';
import type { AgentInspection } from '../../types/decision';

/** Replace a conversation's derived inspections atomically. */
export async function replaceAgentInspections(
  conversationId: string,
  rows: AgentInspection[]
): Promise<void> {
  await db.transaction('rw', db.agentInspections, async () => {
    await db.agentInspections.where('conversationId').equals(conversationId).delete();
    if (rows.length > 0) await db.agentInspections.bulkAdd(rows);
  });
}

/** Chronological inspections for one conversation. */
export async function listAgentInspections(conversationId: string): Promise<AgentInspection[]> {
  return db.agentInspections.where('conversationId').equals(conversationId).sortBy('stepIndex');
}

/** Inspections for several conversations, grouped by conversation. */
export async function listAgentInspectionsForConversations(
  conversationIds: string[]
): Promise<Map<string, AgentInspection[]>> {
  const out = new Map<string, AgentInspection[]>();
  if (conversationIds.length === 0) return out;
  const rows = await db.agentInspections.where('conversationId').anyOf(conversationIds).toArray();
  rows.sort((a, b) => a.stepIndex - b.stepIndex);
  for (const row of rows) {
    const list = out.get(row.conversationId) ?? [];
    list.push(row);
    out.set(row.conversationId, list);
  }
  return out;
}

/** Distinct paths the agent inspected in one conversation (the `inherited` oracle). */
export async function inspectedPathsForConversation(conversationId: string): Promise<string[]> {
  const rows = await listAgentInspections(conversationId);
  return [...new Set(rows.map((r) => r.path).filter((p): p is string => Boolean(p)))];
}

/** Which conversations read a given path (reverse lookup). */
export async function conversationsThatInspected(path: string): Promise<string[]> {
  const rows = await db.agentInspections.where('path').equals(path).toArray();
  return [...new Set(rows.map((r) => r.conversationId))];
}
