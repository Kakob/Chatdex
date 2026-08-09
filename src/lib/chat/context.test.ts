import { describe, it, expect } from 'vitest';
import { buildProjectContext } from './context';
import type {
  CurrentUnderstanding,
  UnderstandingItem,
} from '../understanding/currentUnderstanding';
import type { UnderstandingProject, UnderstandingObject } from '../../types/understanding';

const now = new Date('2026-08-01T00:00:00Z');

const project: UnderstandingProject = {
  id: 'proj-1',
  name: 'Chatdex',
  origin: 'user',
  reviewState: 'accepted',
  createdAt: now,
  updatedAt: now,
};

function item(overrides: Partial<UnderstandingObject> = {}): UnderstandingItem {
  return {
    object: {
      id: crypto.randomUUID(),
      projectId: 'proj-1',
      type: 'idea',
      title: 'An idea',
      status: 'current',
      origin: 'ai',
      reviewState: 'accepted',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    },
    evidence: [],
    lastActivityAt: now,
  };
}

function understanding(partial: Partial<CurrentUnderstanding> = {}): CurrentUnderstanding {
  return {
    direction: [],
    ideasAndDecisions: [],
    openQuestions: [],
    recentChanges: [],
    pendingChanges: [],
    ...partial,
  };
}

describe('buildProjectContext', () => {
  it('returns null when there is nothing accepted to inject', () => {
    expect(buildProjectContext(project, understanding())).toBeNull();
    // Only-pending understanding is empty in agent-context mode too.
    expect(
      buildProjectContext(
        project,
        understanding({ direction: [item({ reviewState: 'pending', type: 'direction' })] })
      )
    ).toBeNull();
  });

  it('injects accepted objects and excludes pending ones', () => {
    const ctx = buildProjectContext(
      project,
      understanding({
        direction: [item({ type: 'direction', title: 'Ship the workspace' })],
        ideasAndDecisions: [
          item({ type: 'decision', title: 'Accepted decision' }),
          item({ type: 'decision', title: 'Pending decision', reviewState: 'pending' }),
        ],
      })
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.document).toContain('Ship the workspace');
    expect(ctx!.document).toContain('Accepted decision');
    expect(ctx!.document).not.toContain('Pending decision');
    expect(ctx!.systemPrompt).toContain('project "Chatdex"');
    expect(ctx!.systemPrompt).toContain(ctx!.document);
    expect(ctx!.truncated).toBe(false);
    expect(ctx!.estimatedTokens).toBeGreaterThan(0);
  });

  it('is deterministic for identical input', () => {
    const u = understanding({ direction: [item({ type: 'direction', title: 'Same' })] });
    expect(buildProjectContext(project, u)).toEqual(buildProjectContext(project, u));
  });

  it('shrinks to fit the token budget and marks truncation', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      item({ type: 'idea', title: `Idea number ${i}`, body: 'Some body text. '.repeat(20) })
    );
    const u = understanding({
      direction: [item({ type: 'direction', title: 'Direction' })],
      ideasAndDecisions: many,
      openQuestions: Array.from({ length: 30 }, (_, i) =>
        item({ type: 'question', title: `Question ${i}` })
      ),
    });
    const full = buildProjectContext(project, u, { maxContextTokens: 100_000 })!;
    expect(full.truncated).toBe(false);

    const small = buildProjectContext(project, u, { maxContextTokens: 1000 })!;
    expect(small.truncated).toBe(true);
    expect(small.estimatedTokens).toBeLessThanOrEqual(1000);
    expect(small.document).toContain('Direction');
  });

  it('hard-cuts when even the minimal stage exceeds the budget', () => {
    const u = understanding({
      direction: [item({ type: 'direction', title: 'D', body: 'x'.repeat(20_000) })],
    });
    const ctx = buildProjectContext(project, u, { maxContextTokens: 500 })!;
    expect(ctx.truncated).toBe(true);
    expect(ctx.document).toContain('truncated to fit');
    // Wrapper overhead pushes slightly over chars/4 alone; allow small slack.
    expect(ctx.estimatedTokens).toBeLessThanOrEqual(600);
  });
});
