// Workbench context assembly (SPEC-decision-investigation §8.2/§12, DI-2b).
// Loads everything the investigation workbench needs for one anchor: the
// full normalized step stream (never truncated — the whole source must stay
// reachable), the anchor itself, and its siblings in the same conversation.
// Purely mechanical reads; no interpretation.

import { normalizeSession, type Step } from '../detection/normalize';
import { getConversation } from '../db/conversations';
import { getMessagesForConversation } from '../db/messages';
import {
  getInvestigationAnchor,
  listInvestigationAnchors,
} from '../db/investigationAnchors';
import type { StoredConversation } from '../../types/unified';
import type { InvestigationAnchor } from '../../types/investigation';

export interface WorkbenchStep {
  step: Step;
  /** Timestamp of the backing message (source metadata, spec §13). */
  occurredAt?: Date;
}

export interface InvestigationContext {
  anchor: InvestigationAnchor;
  conversation: StoredConversation;
  steps: WorkbenchStep[];
  /** All anchors in this conversation, chronological — for cross-navigation. */
  siblingAnchors: InvestigationAnchor[];
}

export async function getInvestigationContext(
  anchorId: string
): Promise<InvestigationContext | null> {
  const anchor = await getInvestigationAnchor(anchorId);
  if (!anchor) return null;

  const conversation = await getConversation(anchor.conversationId);
  if (!conversation) return null;

  const messages = await getMessagesForConversation(anchor.conversationId);
  const { steps } = normalizeSession(anchor.conversationId, messages);
  const timestampByMessage = new Map(messages.map((m) => [m.id, m.createdAt]));

  const siblingAnchors = await listInvestigationAnchors({
    conversationId: anchor.conversationId,
  });

  return {
    anchor,
    conversation,
    steps: steps.map((step) => ({
      step,
      occurredAt: timestampByMessage.get(step.messageId),
    })),
    siblingAnchors,
  };
}
