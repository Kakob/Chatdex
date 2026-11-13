/**
 * Read-only bridge from a project's existing repository binding to the
 * portable TypeScript analyzer. Uses the SAME RepoSource + indexer as Change
 * Workspace, never a second GitHub client or persistent model fixture.
 *
 * Snapshot source is revision-pinned; analysis is deliberately bounded and
 * explicitly reports partial coverage. No LLM, source write, or verification.
 */
import type { UnderstandingProject } from '../../../types/understanding';
import type { RepoSource, SourceFile as ListedFile } from '../../repo/sources';
import { createGitHubSource } from '../../repo/githubSource';
import { ensureIndexed, type IndexProgress, type SkippedFile } from '../../repo';
import { listRepoFiles } from '../../db/repoFiles';
import { getGitHubToken } from '../../github/credentials';
import { getRepo, resolveRef } from '../../github/client';
import { isFetchAllowed } from '../../understanding/trace/fetchPolicy';
import type { DerivedGraph, SourceFile } from './contracts';
import { validateSourcePath } from './contracts';

export const MAX_ANALYSIS_FILES = 40;
export const MAX_ANALYSIS_BYTES = 3 * 1024 * 1024;

export interface SourceAnalysisCoverage {
  /** Number of supported TS paths in the chosen scope, even if excluded by policy. */
  candidateCount: number;
  eligibleCount: number;
  selectedCount: number;
  analyzedCount: number;
  deniedCount: number;
  excludedForLimit: number;
  skipped: SkippedFile[];
  treeTruncated: boolean;
  partial: boolean;
}

export interface SourceAnalysisResult {
  graph: DerivedGraph;
  /** Source text is device-local/in memory, never a behavioral claim. */
  sourceFiles: SourceFile[];
  coverage: SourceAnalysisCoverage;
}

export interface BoundSourceAnalysisResult extends SourceAnalysisResult {
  repository: { owner: string; repo: string; ref: string; sha: string };
}

export type SourceAnalysisProgress =
  | { phase: 'listing' }
  | { phase: 'indexing'; progress: IndexProgress }
  | { phase: 'analyzing' };

export interface SourceAnalysisOptions {
  prefix?: string;
  onProgress?: (event: SourceAnalysisProgress) => void;
}

export function normalizeAnalysisPrefix(prefix: string): string {
  const clean = prefix.trim().replace(/\/+$/, '');
  if (clean) validateSourcePath(clean);
  return clean;
}

function isSupported(path: string): boolean {
  return /\.(ts|tsx|mts|cts)$/.test(path);
}

function inScope(path: string, prefix: string): boolean {
  return !prefix || path === prefix || path.startsWith(prefix + '/');
}

/** Select only source paths allowed by the existing repository fetch policy. */
export function selectAnalysisFiles(
  listing: { files: ListedFile[]; truncated: boolean },
  prefix = '',
): { files: ListedFile[]; candidateCount: number; eligibleCount: number; deniedCount: number; excludedForLimit: number } {
  const root = normalizeAnalysisPrefix(prefix);
  const candidates = listing.files.filter((file) => isSupported(file.path) && inScope(file.path, root));
  const valid: ListedFile[] = [];
  let deniedCount = 0;
  for (const file of candidates) {
    try {
      validateSourcePath(file.path);
      if (!isFetchAllowed(file.path).allowed) {
        deniedCount++;
        continue;
      }
      valid.push(file);
    } catch {
      deniedCount++;
    }
  }
  valid.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {
    files: valid.slice(0, MAX_ANALYSIS_FILES),
    candidateCount: candidates.length, eligibleCount: valid.length,
    deniedCount, excludedForLimit: Math.max(0, valid.length - MAX_ANALYSIS_FILES),
  };
}

/** Analyze a real RepoSource. Suitable for an injected local repo in tests or a GitHub adapter. */
export async function analyzeRepositorySource(
  source: RepoSource,
  sha: string,
  options: SourceAnalysisOptions = {},
): Promise<SourceAnalysisResult> {
  const prefix = normalizeAnalysisPrefix(options.prefix ?? '');
  options.onProgress?.({ phase: 'listing' });
  const listing = await source.listFiles(sha);
  const selected = selectAnalysisFiles(listing, prefix);
  const selectedPaths = new Set(selected.files.map((file) => file.path));
  const selectedSource: RepoSource = {
    key: source.key, label: source.label,
    listFiles: async () => ({ files: selected.files, truncated: listing.truncated }),
    readFile: (revision, path) => {
      if (!selectedPaths.has(path)) throw new Error('File is not in the selected analysis scope');
      return source.readFile(revision, path);
    },
  };
  const indexed = await ensureIndexed(selectedSource, sha, {
    maxFiles: MAX_ANALYSIS_FILES, maxBytes: MAX_ANALYSIS_BYTES,
    onProgress: (progress) => options.onProgress?.({ phase: 'indexing', progress }),
  });
  const cached = await listRepoFiles(source.key, sha);
  const byPath = new Map(cached.map((file) => [file.path, file]));
  let totalBytes = 0;
  const sourceFiles: SourceFile[] = [];
  const skipped = [...indexed.skipped];
  for (const file of selected.files) {
    const row = byPath.get(file.path);
    if (!row) continue;
    const bytes = new TextEncoder().encode(row.content).length;
    if (totalBytes + bytes > MAX_ANALYSIS_BYTES) {
      skipped.push({ path: file.path, reason: 'byte_cap' });
      continue;
    }
    totalBytes += bytes;
    sourceFiles.push({ path: file.path, text: row.content });
  }
  options.onProgress?.({ phase: 'analyzing' });
  // Load TypeScript only when the user actually asks for source analysis.
  const { analyzeTypeScript } = await import('./analyzeTypeScript');
  const graph = analyzeTypeScript({ revision: sha, files: sourceFiles });
  const coverage: SourceAnalysisCoverage = {
    candidateCount: selected.candidateCount,
    eligibleCount: selected.eligibleCount,
    selectedCount: selected.files.length,
    analyzedCount: sourceFiles.length,
    deniedCount: selected.deniedCount,
    excludedForLimit: selected.excludedForLimit,
    skipped, treeTruncated: listing.truncated,
    partial: listing.truncated || selected.excludedForLimit > 0 ||
      selected.deniedCount > 0 || skipped.length > 0 ||
      sourceFiles.length < selected.files.length,
  };
  return { graph, sourceFiles, coverage };
}

/** Resolve a bound project to an immutable Git commit before analyzing it. */
export async function analyzeBoundProject(
  project: UnderstandingProject,
  options: SourceAnalysisOptions = {},
): Promise<BoundSourceAnalysisResult> {
  const repo = project.repository;
  if (!repo) throw new Error('This project has no repository binding. Bind one from its project overview first.');
  const token = await getGitHubToken();
  const ref = repo.pinnedRef || repo.defaultBranch ||
    (await getRepo(repo.owner, repo.repo, { token })).defaultBranch;
  const { sha } = await resolveRef(repo.owner, repo.repo, ref, { token });
  const source = createGitHubSource(repo.owner, repo.repo, { token });
  const result = await analyzeRepositorySource(source, sha, options);
  return {
    ...result,
    repository: { owner: repo.owner, repo: repo.repo, ref, sha },
  };
}
