// SPEC-change-workspace §11 + §16 CW-3: attach sources, caps, scrubbing (S4/S7), provenance, freeze law.
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, putUnderstandingProject } from '../db';
import { replaceInvestigationAnchors } from '../db/investigationAnchors';
import { createPreparedChange, updatePreparedChangeDraft } from './changes';
import { addHypothesis, attachImplementation } from './lifecycle';
import {
  MAX_PATCH_BYTES,
  MAX_TOTAL_PATCH_BYTES,
  capPatches,
  implementationFromClaudeCodeSession,
  implementationFromCompare,
  implementationFromPastedDiff,
  implementationFromPull,
  implementationStats,
  parseUnifiedDiff,
} from './implementation';

const now = new Date('2026-08-28T00:00:00Z');

function jsonFetch(handler: (url: string) => unknown): typeof fetch {
  return (async (input: RequestInfo | URL) =>
    new Response(JSON.stringify(handler(String(input))), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

const GIT_DIFF = `diff --git a/src/pages/ConversationsPage.tsx b/src/pages/ConversationsPage.tsx
index 1111111..2222222 100644
--- a/src/pages/ConversationsPage.tsx
+++ b/src/pages/ConversationsPage.tsx
@@ -10,3 +10,5 @@ export function ConversationsPage() {
   const params = useSearchParams();
-  const id = params.get('id');
+  const id = params.get('id');
+  const scrollTo = params.get('scrollTo');
+  useEffect(() => scrollToMessage(scrollTo), [scrollTo]);
diff --git a/src/pages/SearchPage.tsx b/src/pages/SearchPage.tsx
--- a/src/pages/SearchPage.tsx
+++ b/src/pages/SearchPage.tsx
@@ -5 +5 @@
-navigate(\`/conversations/\${id}\`);
+navigate(\`/conversations/\${id}?scrollTo=\${messageId}\`); // token ghp_${'A'.repeat(30)}
`;

beforeEach(async () => {
  await clearAllData();
});

describe('parseUnifiedDiff', () => {
  it('splits git diffs into per-file stats and patches', () => {
    const files = parseUnifiedDiff(GIT_DIFF);
    expect(files.map((f) => [f.path, f.additions, f.deletions])).toEqual([
      ['src/pages/ConversationsPage.tsx', 3, 1],
      ['src/pages/SearchPage.tsx', 1, 1],
    ]);
    expect(files[0].patch).toContain('@@ -10,3 +10,5 @@');
    expect(files[0].patch).not.toContain('diff --git a/src/pages/SearchPage.tsx');
  });

  it('handles plain diff -u output and /dev/null deletions', () => {
    const plain = `--- a/old.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+x\n`;
    expect(parseUnifiedDiff(plain).map((f) => [f.path, f.additions, f.deletions])).toEqual([
      ['old.ts', 0, 2],
      ['new.ts', 1, 0],
    ]);
    expect(parseUnifiedDiff('not a diff')).toEqual([]);
  });
});

describe('capPatches (S4, S7)', () => {
  it('scrubs secrets, drops oversize patches, and enforces the total cap', () => {
    const big = 'x'.repeat(MAX_PATCH_BYTES + 1);
    const nearCap = 'y'.repeat(MAX_PATCH_BYTES - 100);
    const fitting = Math.floor(MAX_TOTAL_PATCH_BYTES / nearCap.length);
    const many = Array.from({ length: fitting + 1 }, (_, i) => ({ path: `f${i}`, additions: 1, deletions: 0, patch: nearCap }));
    const { files, report } = capPatches([
      { path: 'a', additions: 1, deletions: 0, patch: `+ ghp_${'A'.repeat(30)}` },
      { path: 'b', additions: 1, deletions: 0, patch: big },
      ...many,
      { path: 'e', additions: 1, deletions: 0 },
    ]);
    expect(files[0].patch).toBe('+ [REDACTED]');
    expect(files[1].patch).toBeUndefined();
    expect(files.slice(2, 2 + fitting).every((f) => f.patch === nearCap)).toBe(true);
    expect(files[2 + fitting].patch).toBeUndefined();
    expect(report).toEqual({ patchesDropped: ['b', `f${fitting}`], redactions: 1 });
    expect(capPatches(files, { keepPatches: false }).files.every((f) => f.patch === undefined)).toBe(true);
  });
});

describe('sources', () => {
  it('builds a pasted-diff attachment with scrubbed patches and the chosen provenance', () => {
    const { input, report } = implementationFromPastedDiff(GIT_DIFF, { provenance: 'human' });
    expect(input.source).toBe('pasted_diff');
    expect(input.provenance).toBe('human');
    expect(JSON.stringify(input)).not.toContain('ghp_');
    expect(report.redactions).toBe(1);
    expect(implementationStats(input.files)).toEqual({ files: 2, additions: 4, deletions: 2 });
    expect(() => implementationFromPastedDiff('nope', { provenance: 'human' })).toThrow(/No files/);
  });

  it('derives per-file stats from a Claude Code session and defaults provenance to ai', async () => {
    await replaceInvestigationAnchors('conv-cc', [
      {
        id: 'k1', stableKey: 'k1', conversationId: 'conv-cc', messageId: 'm1', stepIndex: 3, toolName: 'Edit', kind: 'edit',
        fileChanges: [{ path: 'src/b.ts', changeIndex: 0, oldString: 'a\nb', newString: 'a\nb\nc', contentHash: 'h1' }],
        filePaths: ['src/b.ts'], occurredAt: now, sourceProvenance: 'legacy', deriverVersion: '1', createdAt: now,
      },
      {
        id: 'k2', stableKey: 'k2', conversationId: 'conv-cc', messageId: 'm2', stepIndex: 5, toolName: 'Write', kind: 'write',
        fileChanges: [
          { path: 'src/a.ts', changeIndex: 0, newString: 'x\ny', contentHash: 'h2' },
          { path: 'src/b.ts', changeIndex: 0, oldString: 'c', newString: 'd', contentHash: 'h3' },
        ],
        filePaths: ['src/a.ts', 'src/b.ts'], occurredAt: now, sourceProvenance: 'legacy', deriverVersion: '1', createdAt: now,
      },
    ]);
    const { input, anchorCount } = await implementationFromClaudeCodeSession('conv-cc');
    expect(anchorCount).toBe(2);
    expect(input).toEqual({
      source: 'claude_code_session',
      provenance: 'ai',
      conversationId: 'conv-cc',
      files: [
        { path: 'src/a.ts', additions: 2, deletions: 0 },
        { path: 'src/b.ts', additions: 4, deletions: 3 },
      ],
    });
    expect((await implementationFromClaudeCodeSession('conv-cc', { provenance: 'human_ai' })).input.provenance).toBe('human_ai');
    await expect(implementationFromClaudeCodeSession('conv-empty')).rejects.toThrow(/no derived file changes/);
  });

  it('wraps compare and PR reads, keeping shas and dropping patches on request', async () => {
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('/compare/')) {
        return { base_commit: { sha: 'b'.repeat(40) }, commits: [{ sha: 'h'.repeat(40) }], files: [{ filename: 'a.ts', additions: 1, deletions: 0, patch: '+x' }] };
      }
      if (url.endsWith('/files?per_page=100')) return [{ filename: 'p.ts', additions: 2, deletions: 2, patch: '+y' }];
      return { number: 7, title: 'PR', html_url: 'https://github.com/Kakob/Chatdex/pull/7', base: { sha: 'b'.repeat(40) }, head: { sha: 'h'.repeat(40) } };
    });
    const compare = await implementationFromCompare('Kakob', 'Chatdex', 'main', 'feat', { provenance: 'human_ai', client: { fetchImpl } });
    expect(compare.input).toEqual({ source: 'github_compare', provenance: 'human_ai', baseSha: 'b'.repeat(40), headSha: 'h'.repeat(40), files: [{ path: 'a.ts', additions: 1, deletions: 0, patch: '+x' }] });
    const pull = await implementationFromPull('Kakob', 'Chatdex', 7, { provenance: 'ai', keepPatches: false, client: { fetchImpl } });
    expect(pull.title).toBe('PR');
    expect(pull.input).toEqual({ source: 'github_pr', provenance: 'ai', baseSha: 'b'.repeat(40), headSha: 'h'.repeat(40), prNumber: 7, files: [{ path: 'p.ts', additions: 2, deletions: 2 }] });
  });
});

describe('attach end-to-end (freeze law §2.4)', () => {
  it('attaching a pasted diff freezes the open hypothesis and stores the implementation', async () => {
    await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
    let change = await createPreparedChange({
      projectId: 'p1', title: 'Scroll', understandingPointIds: [],
      intent: { currentBehavior: '', desiredBehavior: 'scrolls', whyItMatters: '' },
    });
    change = await updatePreparedChangeDraft(change.id, { criteria: [{ id: 'c1', text: 'scrolls', createdAt: '' }] });
    change = await addHypothesis(change.id, 'Only the conversation id survives the route.');
    const { input } = implementationFromPastedDiff(GIT_DIFF, { provenance: 'ai', provenanceNote: 'Claude Code session, pasted' });
    change = await attachImplementation(change.id, input);
    expect(change.state).toBe('implementing');
    expect(change.hypotheses?.[0].frozenAt).toBeDefined();
    expect(change.implementation?.provenanceNote).toBe('Claude Code session, pasted');
    expect(JSON.stringify(change)).not.toContain('ghp_');
  });
});
