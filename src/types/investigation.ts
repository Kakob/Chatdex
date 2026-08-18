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
