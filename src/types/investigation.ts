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
