// Resolves findings (anchored to step indices) onto the messages the session
// browser renders. Steps carry messageId back-references from normalization,
// so anchoring is a lookup, not a heuristic.

import type { StoredFinding } from '../../types/detection';
import type { NormalizedSession } from './normalize';

/** Map of messageId → findings anchored at that message (via stepRange.start). */
export function mapFindingsToMessages(
  session: NormalizedSession,
  findings: StoredFinding[]
): Map<string, StoredFinding[]> {
  const byMessage = new Map<string, StoredFinding[]>();
  for (const finding of findings) {
    const anchorStep = session.steps[finding.stepRange.start];
    if (!anchorStep) continue; // stale finding from an older trace shape
    const list = byMessage.get(anchorStep.messageId) ?? [];
    list.push(finding);
    byMessage.set(anchorStep.messageId, list);
  }
  return byMessage;
}

/**
 * Human-readable step label per message ("#5", or "#5–6" when a message
 * expands to multiple normalized steps). Shown in bubble headers so the step
 * numbers in findings are meaningful in the feed.
 */
export function mapMessagesToStepLabels(
  session: NormalizedSession
): Map<string, string> {
  const indicesByMessage = new Map<string, number[]>();
  for (const step of session.steps) {
    const list = indicesByMessage.get(step.messageId) ?? [];
    list.push(step.index);
    indicesByMessage.set(step.messageId, list);
  }
  const labels = new Map<string, string>();
  for (const [messageId, indices] of indicesByMessage) {
    labels.set(
      messageId,
      indices.length === 1
        ? `#${indices[0]}`
        : `#${indices[0]}–${indices[indices.length - 1]}`
    );
  }
  return labels;
}

/** The messageId a finding anchors to, for scroll-to-finding. */
export function anchorMessageId(
  session: NormalizedSession,
  finding: StoredFinding
): string | undefined {
  return session.steps[finding.stepRange.start]?.messageId;
}

/** Scroll the session browser to the message a finding anchors at. */
export function scrollToFinding(
  session: NormalizedSession,
  finding: StoredFinding
): void {
  const messageId = anchorMessageId(session, finding);
  if (!messageId) return;
  document
    .getElementById(`message-${messageId}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
