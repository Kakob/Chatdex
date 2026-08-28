// LOCAL-ONLY repository file cache (SPEC-change-workspace §7.2, audit S1).
// Whole files live here for client-side search only; the synced workspace
// stores capped quotes. This table must never be added to the sync engine.

import { db } from './schema';
import type { RepoFileRow, RepoKey } from '../../types/repo';

export async function putRepoFiles(rows: RepoFileRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.repoFiles.bulkPut(rows);
}

export async function getRepoFile(
  repoKey: RepoKey,
  sha: string,
  path: string
): Promise<RepoFileRow | undefined> {
  return db.repoFiles.get([repoKey, sha, path]);
}

export async function listRepoFiles(repoKey: RepoKey, sha: string): Promise<RepoFileRow[]> {
  return db.repoFiles.where('[repoKey+sha]').equals([repoKey, sha]).toArray();
}

export async function countRepoFiles(repoKey: RepoKey, sha: string): Promise<number> {
  return db.repoFiles.where('[repoKey+sha]').equals([repoKey, sha]).count();
}

/** Evict one indexed snapshot (repoKey, sha). */
export async function evictRepoSnapshot(repoKey: RepoKey, sha: string): Promise<number> {
  return db.repoFiles.where('[repoKey+sha]').equals([repoKey, sha]).delete();
}

/** Evict every cached snapshot for a repository (unbind / Settings). */
export async function evictRepo(repoKey: RepoKey): Promise<number> {
  return db.repoFiles.where('repoKey').equals(repoKey).delete();
}

/** Settings → "Clear repository cache". */
export async function clearRepoFileCache(): Promise<void> {
  await db.repoFiles.clear();
}

/** The most recently fetched sha cached for a repository, if any. */
export async function latestCachedSnapshot(repoKey: RepoKey): Promise<string | null> {
  const rows = await db.repoFiles.where('repoKey').equals(repoKey).toArray();
  if (rows.length === 0) return null;
  let best = rows[0];
  for (const row of rows) if (row.fetchedAt > best.fetchedAt) best = row;
  return best.sha;
}
