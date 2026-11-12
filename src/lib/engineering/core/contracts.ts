/**
 * Portable, serializable contracts for a source-derived engineering model.
 *
 * These are descriptive facts about a particular source snapshot, NOT
 * persistent software concepts, behavioral verification, or approved changes.
 * The same types can cross web, CLI, and desktop boundaries.
 */

export interface SourceFile {
  /** Repository-relative POSIX path; each file contains complete source text. */
  path: string;
  text: string;
}

export interface SourceSnapshot {
  files: readonly SourceFile[];
  /** Optional external provenance, e.g. a Git SHA; never inferred or invented. */
  revision?: string;
}

export type SourceEntityKind =
  | 'module'
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'namespace'
  | 'method'
  | 'constructor'
  | 'property'
  | 'variable';

export type SourceRelationKind = 'contains' | 'imports' | 'exports' | 'calls' | 'references';

export interface SourceLocation {
  path: string;
  /** Inclusive start, exclusive end as UTF-16 offsets in the original file. */
  startOffset: number;
  endOffset: number;
  /** 1-based source coordinates. */
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface SourceEntity {
  /** Deterministic within a source snapshot; not yet a permanent rename/move identity. */
  id: string;
  kind: SourceEntityKind;
  name: string;
  path: string;
  parentId: string | null;
  exported: boolean;
  location: SourceLocation;
  /** Syntactic declaration header, not a compiler-proven type contract. */
  signature: string;
  /** Noncryptographic fingerprints for future conservative identity matching. */
  signatureFingerprint: string;
  bodyFingerprint: string;
}

export interface SourceRelation {
  id: string;
  kind: SourceRelationKind;
  fromId: string;
  toId: string;
}

export interface AnalyzerDiagnostic {
  path: string;
  kind: 'syntax' | 'unresolved-import' | 'unsupported';
  message: string;
  line?: number;
  column?: number;
}

export interface AnalyzedSourceFile {
  path: string;
  /** Noncryptographic content fingerprint; not an integrity signature. */
  fingerprint: string;
  length: number;
}

export interface DerivedGraph {
  schemaVersion: 'chatdex.derived-source-graph/v1';
  analyzerVersion: string;
  /** Fingerprint of the sorted, complete *supported* input, including skipped paths. */
  snapshotFingerprint: string;
  /** Optional external source revision supplied by the caller. */
  revision?: string;
  files: AnalyzedSourceFile[];
  entities: SourceEntity[];
  relations: SourceRelation[];
  /** Diagnostic-only, not compiler/typecheck or runtime verification. */
  diagnostics: AnalyzerDiagnostic[];
  skippedPaths: string[];
}

/** Stable noncryptographic FNV-1a over UTF-16 code units, not security evidence. */
export function fingerprintText(input: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

export const ANALYZER_VERSION = 'typescript-structure/v1';

/** Path validation is deliberately filesystem-neutral and permits no traversal. */
export function validateSourcePath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new Error('Source paths must be relative POSIX paths without NUL or backslashes');
  }
  if (path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Source path traversal or empty segment is not allowed');
  }
}

/**
 * Normalize snapshot order and reject duplicate paths, without reading any
 * external files or querying application/project state.
 */
export function normalizeSnapshot(snapshot: SourceSnapshot): SourceFile[] {
  if (snapshot.files.length > 2000) throw new Error('Source snapshot exceeds 2000 files');
  const byPath = new Map<string, SourceFile>();
  let length = 0;
  for (const file of snapshot.files) {
    validateSourcePath(file.path);
    if (typeof file.text !== 'string') throw new Error('Source file contents must be text');
    if (byPath.has(file.path)) throw new Error('Duplicate source path: ' + file.path);
    length += file.text.length;
    if (file.text.length > 1_000_000 || length > 20_000_000) {
      throw new Error('Source snapshot exceeds the current analysis size limit');
    }
    byPath.set(file.path, { path: file.path, text: file.text });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function snapshotFingerprint(files: readonly SourceFile[]): string {
  const canonical = [...files].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return fingerprintText(canonical.map((f) => f.path.length + ':' + f.path + f.text.length + ':' + f.text).join(''));
}
