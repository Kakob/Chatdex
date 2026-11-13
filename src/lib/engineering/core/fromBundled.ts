/**
 * Built-in engineering examples use the same portable source analyzer as
 * repositories, but their source text is bundled with this app. They do not
 * require (or imply) a GitHub repository or immutable commit revision.
 *
 * Example-specific knowledge is limited to choosing shipped source files;
 * no authored concept graph, declaration list, or relationships are supplied.
 */
import type { EngineeringExampleKind } from '../demoProjects';
import { bundledEngineeringSources, bundledExampleSourcePaths } from '../bundledSources';
import type { SourceAnalysisCoverage, SourceAnalysisResult } from './fromRepository';
import type { SourceFile } from './contracts';

export interface BundledSourceAnalysisResult extends SourceAnalysisResult {
  bundled: { kind: EngineeringExampleKind; label: string };
}

export async function analyzeBundledExample(
  kind: EngineeringExampleKind,
): Promise<BundledSourceAnalysisResult> {
  const paths = bundledExampleSourcePaths[kind];
  const sourceFiles: SourceFile[] = [];
  const skipped: SourceAnalysisCoverage['skipped'] = [];
  for (const path of paths) {
    const text = bundledEngineeringSources[path];
    if (typeof text !== 'string') {
      skipped.push({ path, reason: 'error' });
      continue;
    }
    sourceFiles.push({ path, text });
  }
  const { analyzeTypeScript } = await import('./analyzeTypeScript');
  // Intentionally omit revision: a Vite ?raw import is a build-time snapshot,
  // not the local working tree or a known Git SHA.
  const graph = analyzeTypeScript({ files: sourceFiles });
  return {
    graph, sourceFiles,
    coverage: {
      candidateCount: paths.length,
      eligibleCount: paths.length,
      selectedCount: paths.length,
      analyzedCount: sourceFiles.length,
      deniedCount: 0,
      excludedForLimit: 0,
      skipped,
      treeTruncated: false,
      partial: skipped.length > 0,
    },
    bundled: {
      kind,
      label: kind === 'todo-list' ? 'Todo List · bundled with Chatdex' : 'Event Queue · bundled with Chatdex',
    },
  };
}
