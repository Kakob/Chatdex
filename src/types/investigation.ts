// Decision Investigation entities (docs/SPEC-decision-investigation.md).
//
// RawSource is the immutable primary-source record behind every investigation
// artifact (§7.1): the verbatim payload a parser consumed, content-addressed
// by SHA-256. It is LOCAL-ONLY — the rawSources table is deliberately not
// hooked into the sync engine (§21 decision 3); only hash/provenance metadata
// may ever sync. Never mutate rawText after import; a materially changed
// re-import stores a new RawSource row (new hash), not an update.

import type { DataSource } from './unified';

export interface RawSource {
  id: string;
  kind: DataSource;
  /** Original filename as supplied at import (for ZIPs: the archive name). */
  filename: string;
  /** SHA-256 hex digest of rawText — the source's content identity. */
  contentHash: string;
  /** Version of the parser that consumed this payload at import time. */
  parserVersion: string;
  importedAt: Date;
  /** Conversations produced from this payload (claude-code: exactly one). */
  conversationIds: string[];
  /** rawText length in UTF-16 code units (String.length, not bytes). */
  textLength: number;
  /**
   * The verbatim payload the parser consumed: JSONL text for claude-code,
   * the extracted conversations.json for ZIP exports, file text otherwise.
   */
  rawText: string;
}

// --- Investigation anchors (spec §7.3, DI-1b) ---
//
// An anchor is a neutral, mechanically derived entry point: one per
// structured code-changing tool call. It is NOT a detected decision and
// carries no semantic labels. Anchors are DERIVED data (spec §21 decision 3):
// local-only, never synced, rebuilt deterministically from stored messages —
// the anchor's stableKey (= its id) is the identity that future cases
// reference, and it survives re-derivation.

export type CodeChangeKind = 'edit' | 'write' | 'multi_edit' | 'notebook_edit';

export interface DerivedFileChange {
  /** Normalized file path (detection-layer normalizePath). */
  path: string;
  /** Position within the parent tool call (0 except for multi-edit). */
  changeIndex: number;
  /** Absent for whole-file writes. */
  oldString?: string;
  newString: string;
  /** SHA-256 over path + oldString + newString (exhibit integrity, §2.3). */
  contentHash: string;
}

// --- Cases, exhibits, review scopes (spec §8.3–§8.7, §11; DI-2c) ---
//
// These are the feature's first SYNCED entities: human-authored records that
// encrypt and replicate like findings do. They reference anchors by
// stableKey (which survives re-derivation), never by table row identity.

export type CaseState = 'draft' | 'open' | 'completed' | 'adjudicated' | 'reopened';
export type InvestigationKind = 'anchor' | 'question';

/** Embedded in the case row (spec §21 decision 4) — append-only process
 *  evidence about what the human searched, never about what exists. */
export interface CaseSearchRecord {
  id: string;
  query: string;
  mode: 'literal';
  resultCount: number;
  createdAt: Date;
}

export interface InvestigationCase {
  id: string;
  /** Present for project-scoped question-first investigations. */
  projectId?: string;
  conversationId: string;
  /** Missing for question-first investigations that begin from a source. */
  primaryAnchorStableKey?: string;
  linkedAnchorStableKeys: string[];
  /** Optional for backwards compatibility; missing rows are anchor cases. */
  kind?: InvestigationKind;
  /** Human-editable; initialized from a deterministic literal template only. */
  title: string;
  /** Human-authored notes — always labeled as the user's writing in UI. */
  notes: string;
  state: CaseState;
  searchRecords: CaseSearchRecord[];
  /** Working verdict (spec §8.8) — human selections only, never preselected. */
  verdictDraft?: VerdictDraft;
  createdAt: Date;
  updatedAt: Date;
}

export type InvestigationFindingType =
  | 'belief'
  | 'decision'
  | 'constraint'
  | 'consequence'
  | 'question';

export type InvestigationFindingState = 'draft' | 'finalized';

export interface InvestigationFinding {
  id: string;
  caseId: string;
  projectId: string;
  type: InvestigationFindingType;
  title: string;
  body?: string;
  confidence: VerdictConfidence;
  exhibitIds: string[];
  reviewScopeIds: string[];
  state: InvestigationFindingState;
  promotedUnderstandingObjectId?: string;
  createdAt: Date;
  updatedAt: Date;
  finalizedAt?: Date;
}

// --- Verdicts (spec §8.8–§8.9, §11; DI-3) ---
//
// The verdict is the human's adjudication. No field is ever preselected,
// no rationale is ever generated, and finalized revisions are append-only
// snapshots that later edits can never mutate.

export type VerdictOrigin =
  | 'user_directed'
  | 'agent_proposed_user_adopted'
  | 'agent_implemented_without_recorded_discussion'
  | 'inherited_default'
  | 'emergent_across_exchanges'
  | 'conflicts_with_user_direction'
  | 'indeterminate';

export type VerdictStatus = 'active' | 'experimental' | 'superseded' | 'reversed' | 'unknown';

export type VerdictConfidence = 'low' | 'medium' | 'high';

export interface VerdictDraft {
  origin?: VerdictOrigin;
  status?: VerdictStatus;
  confidence?: VerdictConfidence;
  /** Human-authored only. */
  rationale?: string;
}

export interface VerdictRevision {
  id: string;
  caseId: string;
  /** Denormalized for delete cascades. */
  conversationId: string;
  /** 1-based, strictly increasing per case. */
  revisionNumber: number;
  origin: VerdictOrigin;
  status: VerdictStatus;
  confidence: VerdictConfidence;
  rationale: string;
  /** Evidence included in this revision — rows referenced here are
   *  protected from removal even after the case reopens (spec §8.7/§8.9). */
  exhibitIds: string[];
  reviewScopeIds: string[];
  searchRecordIds: string[];
  finalizedAt: Date;
}

export type ExhibitKind = 'transcript_span' | 'tool_event' | 'code_span';

export interface CaseExhibit {
  id: string;
  caseId: string;
  conversationId: string;
  kind: ExhibitKind;
  /** Ordinal of the source event in the normalized step stream. */
  stepIndex: number;
  messageId: string;
  anchorStableKey?: string;
  /** Raw-source hash at pin time (absent for legacy-provenance sources). */
  sourceContentHash?: string;
  // transcript_span: offsets into stepDisplayText(step), UTF-16 code units.
  startOffset?: number;
  endOffset?: number;
  offsetEncoding?: 'utf16';
  // code_span: locator into an anchor's file change.
  filePath?: string;
  changeIndex?: number;
  codeSide?: 'before' | 'after';
  /** 1-based inclusive line bounds within the chosen side. */
  startLine?: number;
  endLine?: number;
  /** Cached preview — the source + locator is the authority (spec §8.4). */
  selectedText: string;
  /** SHA-256 of the exact selected text; mismatch ⇒ 'Source mismatch'. */
  selectedContentHash: string;
  humanNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewScope {
  id: string;
  caseId: string;
  conversationId: string;
  /** Contiguous inclusive step range the human attests to having reviewed. */
  startStepIndex: number;
  endStepIndex: number;
  eventCount: number;
  startMessageId: string;
  endMessageId: string;
  sourceContentHash?: string;
  /** Case search records that existed when the human confirmed. */
  includedSearchRecordIds: string[];
  /** Explicit confirmation moment — never inferred from scrolling. */
  humanConfirmedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvestigationAnchor {
  /** Equals stableKey — deterministic, so re-derivation is idempotent. */
  id: string;
  /** `${sourceRef}#s${stepIndex}`; sourceRef is the raw-source content hash,
   *  or `conv:${conversationId}` for pre-DI-1a imports with no retained raw. */
  stableKey: string;
  conversationId: string;
  /** Backing message, for opening the exact source event in the UI. */
  messageId: string;
  /** Ordinal in the detection-layer normalized step stream. */
  stepIndex: number;
  toolName: string;
  /** Source-provided tool_use id when the parser preserved one. */
  toolUseId?: string;
  kind: CodeChangeKind;
  fileChanges: DerivedFileChange[];
  /** Denormalized for the multiEntry index (coverage view, spec §10). */
  filePaths: string[];
  /** Timestamp of the backing message. */
  occurredAt: Date;
  sourceContentHash?: string;
  /** 'raw' = keyed to a retained raw source; 'legacy' = conversation-keyed. */
  sourceProvenance: 'raw' | 'legacy';
  deriverVersion: string;
  createdAt: Date;
}
