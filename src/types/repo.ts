// LOCAL-ONLY Change Workspace caches (SPEC-change-workspace §7.2).
// Neither table is ever synced (law §2.5, D3, D9).

/** Repository source key: 'gh:owner/repo' (GitHub) or 'fs:<handleName>' (local directory, CW-8). */
export type RepoKey = string;

/** One whole file cached for client-side search. Never leaves the device. */
export interface RepoFileRow {
  repoKey: RepoKey;
  /** Commit sha for GitHub sources; 'local' for a directory source. */
  sha: string;
  path: string;
  size: number;
  content: string;
  fetchedAt: Date;
}

export type InspectionKind = 'file' | 'evidence' | 'node' | 'diff' | 'history';

/** One logged human view of a workspace target (PRD §17 counts). */
export interface InspectionRow {
  id: string;
  workspaceId?: string;
  projectId: string;
  kind: InspectionKind;
  /** Stable identity of what was viewed, e.g. a repo path, evidence id, node id. */
  targetKey: string;
  at: Date;
}
