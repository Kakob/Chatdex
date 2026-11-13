/**
 * Device-only restoration for the last source-derived engineering view.
 *
 * Store one bounded analysis per project in the existing local-only
 * engineering Dexie database. Never sync source text or derived graphs.
 * The persisted graph is a historical snapshot, not an automatically fresh
 * view of a moving branch or the laptop working tree.
 */
import type { UnderstandingProject } from '../../../types/understanding';
import { engineeringExampleKind } from '../demoProjects';
import { bundledEngineeringSources, bundledExampleSourcePaths } from '../bundledSources';
import { engineeringModelDb } from '../modelStore';
import { snapshotFingerprint } from './contracts';
import type { BoundSourceAnalysisResult } from './fromRepository';
import type { BundledSourceAnalysisResult } from './fromBundled';

export type SavedAnalysisResult = BoundSourceAnalysisResult | BundledSourceAnalysisResult;

export interface PersistedSourceAnalysis {
  projectId: string;
  scope: string;
  data: SavedAnalysisResult;
  selectedId: string | null;
  savedAt: number;
}

function matchesProjectBinding(project: UnderstandingProject, data: SavedAnalysisResult): boolean {
  if (project.repository) {
    if (!('repository' in data)) return false;
    const { owner, repo, pinnedRef, defaultBranch } = project.repository;
    if (data.repository.owner !== owner || data.repository.repo !== repo) return false;
    const boundRef = pinnedRef || defaultBranch;
    return !boundRef || data.repository.ref === boundRef;
  }
  const kind = engineeringExampleKind(project.id);
  return Boolean(kind && 'bundled' in data && data.bundled.kind === kind);
}

function bundledSourceChanged(project: UnderstandingProject, data: SavedAnalysisResult): boolean {
  if (!('bundled' in data)) return false;
  const kind = engineeringExampleKind(project.id);
  if (!kind) return true;
  const files = bundledExampleSourcePaths[kind].map((path) => ({
    path, text: bundledEngineeringSources[path],
  }));
  if (files.some((file) => typeof file.text !== 'string')) return true;
  return snapshotFingerprint(files) !== data.graph.snapshotFingerprint;
}

export interface RestoredSourceAnalysis extends PersistedSourceAnalysis {
  /** Historical analysis is still viewable after a development build changes. */
  sourceChanged: boolean;
}

/** Persist a complete read-only result after a successful, explicit analysis. */
export async function saveSourceAnalysis(input: PersistedSourceAnalysis): Promise<void> {
  if (!input.projectId || !input.data.graph.snapshotFingerprint) {
    throw new Error('A source analysis must identify its project and snapshot');
  }
  if (input.data.sourceFiles.length > 40 ||
      input.data.sourceFiles.reduce((size, file) => size + file.text.length, 0) > 3 * 1024 * 1024) {
    throw new Error('Source analysis exceeds the local model cache limit');
  }
  await engineeringModelDb.sourceAnalyses.put(input);
}

/**
 * No fetch, LLM, or analyzer call on restore. Bound GitHub analyses remain
 * at their recorded SHA; moving branches are NOT verified current.
 */
export async function restoreSourceAnalysis(
  project: UnderstandingProject,
): Promise<RestoredSourceAnalysis | null> {
  const saved = await engineeringModelDb.sourceAnalyses.get(project.id);
  if (!saved || !matchesProjectBinding(project, saved.data)) return null;
  return { ...saved, sourceChanged: bundledSourceChanged(project, saved.data) };
}

/** A symbol selection is lightweight and persists independently of reanalysis. */
export async function saveSourceSelection(projectId: string, selectedId: string): Promise<void> {
  const stored = await engineeringModelDb.sourceAnalyses.get(projectId);
  if (!stored || !stored.data.graph.entities.some((item) => item.id === selectedId)) return;
  await engineeringModelDb.sourceAnalyses.update(projectId, { selectedId });
}

export async function forgetSourceAnalysis(projectId: string): Promise<void> {
  await engineeringModelDb.sourceAnalyses.delete(projectId);
}
