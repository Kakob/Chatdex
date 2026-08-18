// DOM selection → step-scoped span locator (SPEC-decision-investigation §8.4).
// Selections must lie within ONE source event's body; the returned offsets
// index into stepDisplayText for that step (the body <pre> renders exactly
// that string, so DOM text offsets and display-text offsets coincide —
// highlight <mark>s do not alter text content). Offsets are UTF-16 code
// units, matching the exhibit's documented offset encoding.

export interface TranscriptSelection {
  stepIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

export function captureTranscriptSelection(): TranscriptSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  const startEl = closestStepBody(range.startContainer);
  const endEl = closestStepBody(range.endContainer);
  // Cross-event selections are not pinnable in the MVP (spec §8.4) — the
  // user creates multiple exhibits instead.
  if (!startEl || startEl !== endEl) return null;

  const stepIndex = Number(startEl.dataset.stepBody);
  if (!Number.isInteger(stepIndex)) return null;

  const prefix = document.createRange();
  prefix.selectNodeContents(startEl);
  prefix.setEnd(range.startContainer, range.startOffset);
  const startOffset = prefix.toString().length;
  const text = range.toString();
  if (text.length === 0) return null;

  return { stepIndex, startOffset, endOffset: startOffset + text.length, text };
}

function closestStepBody(node: Node): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node.parentElement;
  return el?.closest<HTMLElement>('[data-step-body]') ?? null;
}
