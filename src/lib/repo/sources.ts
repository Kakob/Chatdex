// Repository sources for Change Workspace evidence search
// (SPEC-change-workspace §9). A source lists files at a snapshot and reads
// one file; the indexer (./index.ts) decides what to cache and search.ts
// runs over the LOCAL-ONLY cache. Sources are read-only by law (§2.5).

export interface SourceFile {
  path: string;
  /** Bytes, when the source knows it up front (GitHub tree entries do). */
  size?: number;
}

export interface SourceListing {
  files: SourceFile[];
  /** The source could not enumerate everything (GitHub truncates huge trees). */
  truncated: boolean;
}

export interface RepoSource {
  /** 'gh:owner/repo' or 'fs:<handleName>' — the `repoKey` stored on cached rows and evidence. */
  key: string;
  /** Human label, e.g. "Kakob/Chatdex". */
  label: string;
  listFiles(sha: string): Promise<SourceListing>;
  readFile(sha: string, path: string): Promise<{ text: string; size: number }>;
}

export function githubRepoKey(owner: string, repo: string): string {
  return `gh:${owner}/${repo}`;
}

export function parseRepoKey(key: string): { kind: 'gh'; owner: string; repo: string } | { kind: 'fs'; name: string } | null {
  if (key.startsWith('gh:')) {
    const [owner, repo] = key.slice(3).split('/');
    if (!owner || !repo) return null;
    return { kind: 'gh', owner, repo };
  }
  if (key.startsWith('fs:')) {
    const name = key.slice(3);
    return name ? { kind: 'fs', name } : null;
  }
  return null;
}
