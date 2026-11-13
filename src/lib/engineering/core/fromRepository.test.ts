import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData } from '../../db';
import { getRepoFile } from '../../db/repoFiles';
import type { RepoSource } from '../../repo/sources';
import { analyzeRepositorySource, normalizeAnalysisPrefix, selectAnalysisFiles } from './fromRepository';

beforeEach(async () => { await clearAllData(); });

function sampleSource() {
  const sources: Record<string, string> = {
    'src/core/math.ts': 'export function add(a: number, b: number) { return a + b; }\n',
    'src/core/run.ts': "import { add } from './math.js';\nexport function run() { return add(1, 2); }\n",
    'src/private/secrets.ts': 'export const token = "secret";',
    'README.md': 'README',
    'docs/notes.md': 'notes',
    'scripts/cli.ts': 'export const script = true;',
  };
  const readFile = vi.fn(async (_sha: string, path: string) => {
    const text = sources[path];
    if (!text) throw new Error('Not found');
    return { text, size: new TextEncoder().encode(text).length };
  });
  const source: RepoSource = {
    key: 'gh:Sample/Arbitrary',
    label: 'Sample/Arbitrary',
    listFiles: async () => ({
      files: Object.entries(sources).map(([path, content]) => ({ path, size: content.length })),
      truncated: false,
    }),
    readFile,
  };
  return { source, readFile };
}

describe('project source analyzer adapter', () => {
  it('uses the existing gated repository indexer and local cache, never a second reader', async () => {
    const { source, readFile } = sampleSource();
    const output = await analyzeRepositorySource(source, 'a'.repeat(40), { prefix: 'src/core/' });
    expect(output.graph.revision).toBe('a'.repeat(40));
    expect(output.coverage).toMatchObject({
      candidateCount: 2, eligibleCount: 2, selectedCount: 2,
      analyzedCount: 2, partial: false, deniedCount: 0,
    });
    expect(output.graph.entities.some((e) => e.kind === 'function' && e.name === 'run')).toBe(true);
    expect(output.graph.entities.some((e) => e.kind === 'function' && e.name === 'add')).toBe(true);
    const a = output.graph.entities.find((e) => e.name === 'run')!;
    const b = output.graph.entities.find((e) => e.name === 'add')!;
    expect(output.graph.relations).toContainEqual(
      expect.objectContaining({ kind: 'calls', fromId: a.id, toId: b.id }),
    );
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(await getRepoFile(source.key, 'a'.repeat(40), 'src/core/math.ts')).toBeDefined();
    const second = await analyzeRepositorySource(source, 'a'.repeat(40), { prefix: 'src/core/' });
    expect(second.graph).toEqual(output.graph);
    expect(readFile).toHaveBeenCalledTimes(2); // same SHA is already cached
  });

  it('shows excluded paths as incomplete coverage and only analyzes allowed files', async () => {
    const { source } = sampleSource();
    const output = await analyzeRepositorySource(source, 'b'.repeat(40), { prefix: 'src' });
    expect(output.coverage).toMatchObject({ candidateCount: 3, deniedCount: 1, analyzedCount: 2, partial: true });
    expect(output.sourceFiles.every((f) => !f.path.includes('secrets'))).toBe(true);
    expect(output.graph.entities.some((entity) => entity.name === 'secrets')).toBe(false);
  });

  it('explicitly reports file-cap omissions and truncated trees, and refuses out-of-root prefixes', async () => {
    const names = Array.from({ length: 45 }, (_, i) => ({ path: 'src/f' + String(i).padStart(2, '0') + '.ts', size: 18 }));
    const chosen = selectAnalysisFiles({ files: names, truncated: true }, 'src/');
    expect(chosen.files).toHaveLength(40);
    expect(chosen.eligibleCount).toBe(45);
    expect(chosen.excludedForLimit).toBe(5);
    expect(() => normalizeAnalysisPrefix('../private')).toThrow();
    expect(() => normalizeAnalysisPrefix('/etc/passwd')).toThrow();
    expect(() => normalizeAnalysisPrefix('src\\private')).toThrow();
  });

  it('reports unavailable source with no invented relations or files', async () => {
    const source: RepoSource = {
      key: 'fs:failed', label: 'Missing',
      listFiles: async () => ({ files: [{ path: 'src/x.ts', size: 12 }], truncated: false }),
      readFile: async () => { throw new Error('Read failed'); },
    };
    const result = await analyzeRepositorySource(source, 'c'.repeat(40));
    expect(result.coverage.partial).toBe(true);
    expect(result.coverage.analyzedCount).toBe(0);
    expect(result.graph.entities).toEqual([]);
    expect(result.coverage.skipped).toEqual([{ path: 'src/x.ts', reason: 'error' }]);
  });
});
