import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { clearAllData } from '../../db';
import { db } from '../../db/schema';
import { putRepoFiles } from '../../db/repoFiles';
import { putDecisionTrace } from '../../db/decisionTraces';
import { computeBlastRadius, matchTreePath } from './blastRadius';
import type { DecisionTrace } from '../../../types/decision';
import type { InvestigationAnchor } from '../../../types/investigation';

const SHA = 'a'.repeat(40);
const REPO = 'gh:Kakob/Chatdex';
const now = new Date('2026-09-07T10:00:00Z');

function trace(overrides: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    id: 'dt-1',
    projectId: 'p1',
    decisionObjectId: 'uo-1',
    runId: 'run-1',
    repoKey: REPO,
    sha: SHA,
    alternatives: [],
    assumptions: [],
    transcriptEvidence: [{ conversationId: 'sess-1', messageId: 'm1', stepIndex: 1, role: 'agent_text', quote: 'x', startOffset: 0, endOffset: 1 }],
    anchorStableKeys: ['raw#s4'],
    implEvidence: [{ path: 'src/lib/db/projects.ts', startLine: 1, endLine: 1, quote: 'export async function deleteProject' }],
    symbols: ['deleteProject'],
    testPaths: [],
    invalidates: [],
    fetchedPaths: [],
    provider: 'anthropic',
    model: 'm',
    warnings: [],
    createdAt: now,
    ...overrides,
  };
}

function anchor(id: string, conversationId: string, stepIndex: number, paths: string[]): InvestigationAnchor {
  return {
    id, stableKey: id, conversationId, messageId: `m${stepIndex}`, stepIndex, toolName: 'Edit', kind: 'edit',
    fileChanges: paths.map((p, i) => ({ path: p, changeIndex: i, newString: 'x', contentHash: 'h' })),
    filePaths: paths, occurredAt: now, sourceProvenance: 'raw', deriverVersion: '1.0.0', createdAt: now,
  };
}

const fetchSpy = vi.fn();

beforeEach(async () => {
  await clearAllData();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockReset();
  await putRepoFiles([
    { repoKey: REPO, sha: SHA, path: 'src/lib/db/projects.ts', size: 1, content: 'export async function deleteProject(id: string) {}\n', fetchedAt: now },
    { repoKey: REPO, sha: SHA, path: 'src/pages/ProjectsPage.tsx', size: 1, content: 'import { deleteProject } from "../lib/db/projects";\nawait deleteProject(id);\n', fetchedAt: now },
    { repoKey: REPO, sha: SHA, path: 'src/lib/db/projects.test.ts', size: 1, content: 'describe("deleteProject", () => {});\n', fetchedAt: now },
    { repoKey: REPO, sha: SHA, path: 'src/lib/db/other.test.ts', size: 1, content: 'deleteProject();\n', fetchedAt: now },
    { repoKey: REPO, sha: SHA, path: 'README.md', size: 1, content: 'nothing here\n', fetchedAt: now },
  ]);
  await db.investigationAnchors.bulkAdd([
    anchor('raw#s4', 'sess-1', 4, ['/Users/dev/chatdex/src/lib/db/projects.ts']),
    anchor('other#s2', 'sess-2', 2, ['/Users/dev/chatdex/src/lib/db/projects.ts', '/Users/dev/chatdex/src/x.ts']),
    anchor('other#s9', 'sess-3', 9, ['/Users/dev/chatdex/src/unrelated.ts']),
  ]);
  await db.conversations.bulkPut([
    { id: 'sess-2', source: 'claude-code', name: 'earlier session', summary: null, createdAt: now, updatedAt: now, importedAt: now, messageCount: 0, userMessageCount: 0, assistantMessageCount: 0, estimatedTokens: 0, fullText: '' },
  ]);
  await db.understandingObjects.put({ id: 'uo-2', projectId: 'p1', type: 'decision', title: 'Projects page lists projects', status: 'current', origin: 'ai', reviewState: 'pending', createdAt: now, updatedAt: now });
  await putDecisionTrace(trace({ id: 'dt-2', decisionObjectId: 'uo-2', implEvidence: [{ path: 'src/pages/ProjectsPage.tsx', startLine: 1, endLine: 1, quote: 'import' }], anchorStableKeys: ['other#s2'], symbols: [] }));
  await putDecisionTrace(trace());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('computeBlastRadius (§11.2, S8)', () => {
  it('finds references outside own files, related sessions, related decisions, and tests — heuristic, zero network', async () => {
    const radius = await computeBlastRadius(trace(), 'p1');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(radius.verification).toBe('heuristic');
    expect(radius.snapshotMissing).toBe(false);
    expect(radius.paths).toEqual(['src/lib/db/projects.ts']);

    expect(radius.symbols).toHaveLength(1);
    const sym = radius.symbols[0];
    expect(sym.name).toBe('deleteProject');
    expect(sym.declaredIn).toEqual(['src/lib/db/projects.ts']);
    // Own file excluded; test files count as references too (they are foreign rows).
    expect(sym.references.map((h) => h.path).sort()).toEqual(['src/lib/db/other.test.ts', 'src/lib/db/projects.test.ts', 'src/pages/ProjectsPage.tsx', 'src/pages/ProjectsPage.tsx'].sort());
    expect(radius.referencingFiles).toEqual(['src/lib/db/other.test.ts', 'src/lib/db/projects.test.ts', 'src/pages/ProjectsPage.tsx']);

    expect(radius.relatedSessions).toEqual([
      { conversationId: 'sess-2', name: 'earlier session', paths: ['/Users/dev/chatdex/src/lib/db/projects.ts'], anchorCount: 1 },
    ]);
    expect(radius.relatedDecisions).toEqual([
      { objectId: 'uo-2', title: 'Projects page lists projects', sharedPaths: expect.arrayContaining(['src/lib/db/projects.ts']) },
    ]);
    expect(radius.tests).toEqual(['src/lib/db/other.test.ts', 'src/lib/db/projects.test.ts']);
    expect(radius.truncated).toBe(false);
  });

  it('degrades gracefully without a cached snapshot', async () => {
    await db.repoFiles.clear();
    const radius = await computeBlastRadius(trace(), 'p1');
    expect(radius.snapshotMissing).toBe(true);
    expect(radius.symbols[0].references).toEqual([]);
    expect(radius.relatedSessions).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('caps and flags truncation', async () => {
    const radius = await computeBlastRadius(trace(), 'p1', { maxHitsPerSymbol: 1 });
    expect(radius.symbols[0].capped).toBe(true);
    expect(radius.truncated).toBe(true);
  });
});

describe('matchTreePath', () => {
  const tree = ['src/a.ts', 'src/lib/a.ts', 'src/b.ts'];
  it('matches exact, ./-prefixed, or unique suffixes only', () => {
    const set = new Set(tree);
    expect(matchTreePath('src/b.ts', tree, set)).toBe('src/b.ts');
    expect(matchTreePath('./src/b.ts', tree, set)).toBe('src/b.ts');
    expect(matchTreePath('/root/src/b.ts', tree, set)).toBe('src/b.ts');
    expect(matchTreePath('/root/a.ts', tree, set)).toBeNull();
    expect(matchTreePath('/root/src/lib/a.ts', tree, set)).toBe('src/lib/a.ts');
  });
});
