// Change Workspace evidence model (SPEC-change-workspace §8; PRD §24).
//
// Every evidence item carries exactly one kind and enough locator data to
// re-open its primary source (law §2.1). Items live embedded in a
// PreparedChange (synced as ciphertext) and, after promotion, on
// UnderstandingEvent.codeEvidence. Nested timestamps are ISO strings (D11):
// the sync serializer revives only top-level Dates.

export type EvidenceKind =
  | 'code'
  | 'test_runtime'
  | 'intent_history'
  | 'human_hypothesis'
  | 'ai_inference';

export type EvidenceOrigin = 'user' | 'ai';

export type EvidenceAddedVia = 'search' | 'manual' | 'attach' | 'assisted';

/** Quotes stored in a synced workspace are capped (audit S7); never whole files. */
export const MAX_QUOTE_CHARS = 500;
/** AI inference text cap (audit S7). */
export const MAX_AI_TEXT_CHARS = 2000;
/** Evidence items per workspace (audit S7). */
export const MAX_EVIDENCE_ITEMS = 200;

interface EvidenceBase {
  id: string;
  kind: EvidenceKind;
  /** ISO timestamp (D11). */
  createdAt: string;
  note?: string;
  origin: EvidenceOrigin;
  addedVia: EvidenceAddedVia;
}

/** Observed in repository contents at a pinned commit. */
export interface CodeEvidence extends EvidenceBase {
  kind: 'code';
  /** 'gh:owner/repo' or 'fs:<handleName>' (§7.2). */
  repoKey: string;
  sha: string;
  path: string;
  /** 1-based inclusive. */
  startLine: number;
  endLine: number;
  /** ≤ MAX_QUOTE_CHARS, secret-scrubbed. */
  quote: string;
  /** SHA-256 hex of `quote`; mismatch on re-fetch ⇒ "Source changed". */
  quoteHash: string;
}

/** Established by a recorded test run or runtime observation. */
export interface TestRuntimeEvidence extends EvidenceBase {
  kind: 'test_runtime';
  source: 'transcript' | 'manual';
  conversationId?: string;
  messageId?: string;
  /** Ordinal in the normalized step stream (transcript source). */
  stepIndex?: number;
  command?: string;
  outcome: 'pass' | 'fail' | 'observed';
  quote?: string;
  quoteHash?: string;
}

/** Supported by a conversation, understanding object, finding, commit, or spec document. */
export interface IntentHistoryEvidence extends EvidenceBase {
  kind: 'intent_history';
  source: 'conversation' | 'understanding' | 'finding' | 'commit' | 'spec';
  conversationId?: string;
  messageIds?: string[];
  understandingObjectId?: string;
  findingId?: string;
  commitSha?: string;
  path?: string;
  quote?: string;
  quoteHash?: string;
}

/** The developer's own interpretation, pointing at a workspace hypothesis. */
export interface HumanHypothesisEvidence extends EvidenceBase {
  kind: 'human_hypothesis';
  hypothesisId: string;
}

/** AI-generated interpretation not yet independently established (law §2.2). */
export interface AiInferenceEvidence extends EvidenceBase {
  kind: 'ai_inference';
  runId: string;
  provider: string;
  /** Digest of the prompt that produced this, for reproducibility. */
  promptDigest: string;
  /** ≤ MAX_AI_TEXT_CHARS. */
  text: string;
  /** Evidence ids the model cited, if any. */
  checkedAgainst?: string[];
}

export type EvidenceItem =
  | CodeEvidence
  | TestRuntimeEvidence
  | IntentHistoryEvidence
  | HumanHypothesisEvidence
  | AiInferenceEvidence;

/**
 * Kinds that count as mechanically established for verification purposes
 * (law §2.2). `intent_history` counts only when it cites a commit.
 */
export function isMechanicalEvidence(item: EvidenceItem): boolean {
  switch (item.kind) {
    case 'code':
    case 'test_runtime':
      return true;
    case 'intent_history':
      return item.source === 'commit';
    default:
      return false;
  }
}
