// Repository indexer (SPEC-change-workspace §9, audit S1). Fills the
// LOCAL-ONLY `repoFiles` cache for one (source, sha) snapshot so search runs
// client-side and offline. Gates: fetchPolicy denylist + excluded dirs (never
// cached), per-file size cap, per-snapshot file and byte caps. Resumable: a
// second run skips paths already cached; a rate-limit error stops the run
// after saving what was fetched and reports when to retry.

import { GitHubRateLimitError, MAX_FILE_BYTES } from '../github/client';
import { isFetchAllowed } from '../understanding/trace/fetchPolicy';
import { listRepoFiles, putRepoFiles } from '../db/repoFiles';
import type { RepoFileRow } from '../../types/repo';
import type { RepoSource, SourceFile } from './sources';

/** Files per snapshot (audit S1). */
export const MAX_INDEX_FILES = 2000;
/** Bytes per snapshot (audit S1). */
export const MAX_INDEX_BYTES = 50 * 1024 * 1024;
/** Concurrent file reads per batch. */
export const INDEX_BATCH_SIZE = 20;

export type SkipReason = 'sensitive' | 'excluded' | 'size' | 'file_cap' | 'byte_cap' | 'error';

export interface SkippedFile {
  path: string;
  reason: SkipReason;
}

export interface IndexProgress {
  done: number;
  total: number;
}

export interface IndexOptions {
  maxFiles?: number;
  maxBytes?: number;
  batchSize?: number;
  onProgress?: (progress: IndexProgress) => void;
  /** Cooperative cancellation: checked between batches. */
  shouldStop?: () => boolean;
}

export interface IndexReport {
  repoKey: string;
  sha: string;
  /** Files fetched in this run. */
  fetched: number;
  /** Files already cached before this run (resume). */
  alreadyCached: number;
  /** Total files now in the cache for this snapshot. */
  indexed: number;
  skipped: SkippedFile[];
  /** The source could not list the whole tree. */
  truncated: boolean;
  /** Set when GitHub rate-limited the run; the cache holds what was fetched so far. */
  rateLimitedUntil?: Date;
  /** Set when `shouldStop` interrupted the run. */
  stopped: boolean;
}

/** Decide which listed files may be cached, in listing order. Pure. */
export function planIndex(
  files: SourceFile[],
  alreadyCached: ReadonlySet<string>,
  opts: { maxFiles?: number; maxBytes?: number } = {}
): { toFetch: SourceFile[]; kept: string[]; skipped: SkippedFile[] } {
  const maxFiles = opts.maxFiles ?? MAX_INDEX_FILES;
  const maxBytes = opts.maxBytes ?? MAX_INDEX_BYTES;
  const toFetch: SourceFile[] = [];
  const kept: string[] = [];
  const skipped: SkippedFile[] = [];
  let count = 0;
  let bytes = 0;
  for (const file of files) {
    const decision = isFetchAllowed(file.path);
    if (!decision.allowed) {
      skipped.push({ path: file.path, reason: decision.reason });
      continue;
    }
    if (file.size !== undefined && file.size > MAX_FILE_BYTES) {
      skipped.push({ path: file.path, reason: 'size' });
      continue;
    }
    if (count >= maxFiles) {
      skipped.push({ path: file.path, reason: 'file_cap' });
      continue;
    }
    const size = file.size ?? 0;
    if (bytes + size > maxBytes) {
      skipped.push({ path: file.path, reason: 'byte_cap' });
      continue;
    }
    count += 1;
    bytes += size;
    if (alreadyCached.has(file.path)) kept.push(file.path);
    else toFetch.push(file);
  }
  return { toFetch, kept, skipped };
}

export async function ensureIndexed(
  source: RepoSource,
  sha: string,
  opts: IndexOptions = {}
): Promise<IndexReport> {
  const listing = await source.listFiles(sha);
  const cached = new Set((await listRepoFiles(source.key, sha)).map((row) => row.path));
  const plan = planIndex(listing.files, cached, opts);
  const skipped = [...plan.skipped];
  const batchSize = opts.batchSize ?? INDEX_BATCH_SIZE;
  const total = plan.toFetch.length;
  let fetched = 0;
  let rateLimitedUntil: Date | undefined;
  let stopped = false;

  opts.onProgress?.({ done: 0, total });
  for (let i = 0; i < plan.toFetch.length; i += batchSize) {
    if (opts.shouldStop?.()) {
      stopped = true;
      break;
    }
    const batch = plan.toFetch.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (file): Promise<RepoFileRow | SkippedFile | GitHubRateLimitError> => {
        try {
          const { text, size } = await source.readFile(sha, file.path);
          if (size > MAX_FILE_BYTES) return { path: file.path, reason: 'size' };
          return { repoKey: source.key, sha, path: file.path, size, content: text, fetchedAt: new Date() };
        } catch (err) {
          if (err instanceof GitHubRateLimitError) return err;
          if (err instanceof Error && /too large/i.test(err.message)) {
            return { path: file.path, reason: 'size' };
          }
          return { path: file.path, reason: 'error' };
        }
      })
    );
    const rows: RepoFileRow[] = [];
    for (const result of results) {
      if (result instanceof GitHubRateLimitError) {
        rateLimitedUntil = result.resetAt ?? new Date(Date.now() + 60_000);
      } else if ('content' in result) {
        rows.push(result);
      } else {
        skipped.push(result);
      }
    }
    await putRepoFiles(rows);
    fetched += rows.length;
    opts.onProgress?.({ done: Math.min(i + batch.length, total), total });
    if (rateLimitedUntil) break;
  }

  return {
    repoKey: source.key,
    sha,
    fetched,
    alreadyCached: plan.kept.length,
    indexed: plan.kept.length + fetched,
    skipped,
    truncated: listing.truncated,
    ...(rateLimitedUntil ? { rateLimitedUntil } : {}),
    stopped,
  };
}

/** Summary line for the index banner (§14). */
export function describeSkips(skipped: SkippedFile[]): string {
  if (skipped.length === 0) return '';
  const counts = new Map<SkipReason, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const labels: Record<SkipReason, string> = {
    sensitive: 'sensitive',
    excluded: 'excluded',
    size: 'too large',
    file_cap: 'over file cap',
    byte_cap: 'over size cap',
    error: 'unreadable',
  };
  return [...counts.entries()].map(([reason, n]) => `${n} ${labels[reason]}`).join(', ');
}
