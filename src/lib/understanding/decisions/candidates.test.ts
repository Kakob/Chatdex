import { describe, it, expect } from 'vitest';
import { buildTranscriptExcerpts, selectRecoveryFiles, dependencyNames, renderHunk } from './candidates';
import type { Step } from '../../detection/normalize';
import type { InvestigationAnchor } from '../../../types/investigation';

function step(kind: Step['kind'], index: number, text?: string, extra: Partial<Step> = {}): Step {
  return { index, kind, messageId: `m${index}`, text, ...extra };
}

function anchor(stepIndex: number, path: string, kind: InvestigationAnchor['kind'] = 'edit'): InvestigationAnchor {
  return {
    id: `raw#s${stepIndex}`,
    stableKey: `raw#s${stepIndex}`,
    conversationId: 'c1',
    messageId: `m${stepIndex}`,
    stepIndex,
    toolName: kind === 'write' ? 'Write' : 'Edit',
    kind,
    fileChanges: [{ path, changeIndex: 0, oldString: kind === 'write' ? undefined : 'old', newString: 'new code', contentHash: 'h' }],
    filePaths: [path],
    occurredAt: new Date(),
    sourceProvenance: 'raw',
    deriverVersion: '1.0.0',
    createdAt: new Date(),
  };
}

describe('buildTranscriptExcerpts (§9.1)', () => {
  const steps: Step[] = [
    step('user_msg', 0, 'Add project deletion'),
    step('agent_text', 1, 'Let me look around'),
    step('tool_call', 2, undefined, { toolName: 'Read' }),
    step('tool_result', 3, undefined, { toolResult: 'file body' }),
    step('agent_text', 4, 'I will mirror deleteConversation'),
    step('tool_call', 5, undefined, { toolName: 'Edit' }),
    step('tool_result', 6, undefined, { toolResult: 'ok' }),
    step('agent_text', 7, 'Done. Token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'),
    step('user_msg', 8, 'thanks'),
  ];

  it('keeps every user message, the agent text before each edit, and the rendered hunk, tagged by step', () => {
    const set = buildTranscriptExcerpts('c1', steps, [anchor(5, 'src/a.ts')]);
    expect(set.excerpts.map((e) => [e.stepIndex, e.role])).toEqual([
      [0, 'user_msg'],
      [1, 'agent_text'],
      [4, 'agent_text'],
      [5, 'tool_call'],
      [8, 'user_msg'],
    ]);
    const hunk = set.excerpts.find((e) => e.stepIndex === 5)!;
    expect(hunk.anchorStableKey).toBe('raw#s5');
    expect(hunk.hunkPaths).toEqual(['src/a.ts']);
    expect(hunk.text).toBe('Edit src/a.ts\n--- old\nold\n+++ new\nnew code');
    expect(set.droppedAnchors).toBe(0);
    expect(set.totalChars).toBe(set.excerpts.reduce((n, e) => n + e.text.length, 0));
  });

  it('scrubs secrets from agent text and drops the oldest edits first when over the cap', () => {
    const set = buildTranscriptExcerpts('c1', steps, [anchor(5, 'src/a.ts'), anchor(7, 'src/b.ts')], {
      maxTotalChars: 80,
      window: 1,
    });
    // Both anchors' groups exceed 80 chars with the user text; the oldest (step 5) goes first.
    expect(set.droppedAnchors).toBeGreaterThanOrEqual(1);
    expect(set.excerpts.some((e) => e.stepIndex === 5)).toBe(false);
    expect(set.warnings[0]).toMatch(/oldest edit/);
    const full = buildTranscriptExcerpts('c1', steps, [anchor(8, 'x')], { window: 2 });
    const scrubbed = full.excerpts.find((e) => e.stepIndex === 7);
    expect(scrubbed?.text).toContain('[REDACTED]');
    expect(scrubbed?.text).not.toContain('sk-ant-api03');
  });

  it('renders whole-file writes without an old side', () => {
    expect(renderHunk('Write', [{ path: 'p', newString: 'body' }], 100)).toBe('Write p\n+++ new\nbody');
  });
});

describe('selectRecoveryFiles', () => {
  const tree = ['src/lib/db/conversations.ts', 'src/lib/db/projects.ts', 'src/pages/ProjectsPage.tsx', '.env', 'package.json'];

  it('marks pre-existing vs created paths, resolves suffixes, and refuses sensitive paths', () => {
    const sel = selectRecoveryFiles({
      anchorPaths: ['src/lib/db/projects.ts', 'ProjectsPage.tsx'],
      inspectedPaths: ['src/lib/db/conversations.ts', '.env'],
      mentionedTexts: ['see package.json'],
      treePaths: tree,
      createdPaths: new Set(['src/lib/db/projects.ts']),
    });
    expect(sel.candidates).toEqual([
      { path: 'src/lib/db/projects.ts', reason: 'anchor', preExisting: false },
      { path: 'src/pages/ProjectsPage.tsx', reason: 'anchor', preExisting: true },
      { path: 'src/lib/db/conversations.ts', reason: 'inspected', preExisting: true },
      { path: 'package.json', reason: 'mentioned', preExisting: true },
    ]);
    expect(sel.skipped).toEqual([{ path: '.env', reason: 'sensitive' }]);
  });

  it('caps the number of files', () => {
    const sel = selectRecoveryFiles({ anchorPaths: tree.slice(0, 3), inspectedPaths: [], mentionedTexts: [], treePaths: tree, createdPaths: new Set(), maxFiles: 2 });
    expect(sel.candidates).toHaveLength(2);
  });
});

describe('dependencyNames', () => {
  it('reads all dependency blocks and tolerates junk', () => {
    expect([...dependencyNames('{"dependencies":{"dexie":"4"},"devDependencies":{"vitest":"3"}}')]).toEqual(['dexie', 'vitest']);
    expect(dependencyNames('not json').size).toBe(0);
    expect(dependencyNames(undefined).size).toBe(0);
  });
});
