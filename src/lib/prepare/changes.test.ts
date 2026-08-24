import { beforeEach, describe, expect, it } from 'vitest';
import {
  bulkPutConversations,
  clearAllData,
  createUnderstandingObject,
  putUnderstandingProject,
} from '../db';
import { getPreparedChange } from '../db/preparedChanges';
import {
  createPreparedChange,
  markPreparedChangeReady,
  updatePreparedChangeDraft,
  validatePreparedChange,
} from './changes';
import {
  loadPreparedChangeExportContext,
  renderPreparedChangeJson,
  renderPreparedChangeMarkdown,
} from './export';
import type { UnderstandingProject } from '../../types/understanding';

beforeEach(async () => {
  await clearAllData();
});

const now = new Date('2026-08-23T12:00:00Z');

async function fixture() {
  const project: UnderstandingProject = {
    id: 'project-slop',
    name: 'Slop Connoisseur',
    description: 'A game about human and AI taste.',
    origin: 'user',
    reviewState: 'accepted',
    createdAt: now,
    updatedAt: now,
  };
  await putUnderstandingProject(project);
  await bulkPutConversations([
    {
      id: 'conv-slop',
      source: 'chatgpt',
      name: 'Contestant judging discussion',
      summary: null,
      createdAt: now,
      updatedAt: now,
      importedAt: now,
      messageCount: 1,
      userMessageCount: 1,
      assistantMessageCount: 0,
      estimatedTokens: 20,
      fullText: 'Contestants should judge each other.',
    },
  ]);
  const point = await createUnderstandingObject({
    id: 'understanding-contestant-judging',
    projectId: project.id,
    type: 'belief',
    title: 'Contestant-specific judging makes taste plural',
    body: 'Each contestant evaluates responses from a distinct perspective.',
    origin: 'user',
    evidence: [{ conversationId: 'conv-slop', messageIds: ['message-judge'] }],
    occurredAt: now,
  });
  return { project, point };
}

describe('Prepared Change', () => {
  it('starts from accepted, current understanding in the same project', async () => {
    const { project, point } = await fixture();
    const change = await createPreparedChange({
      projectId: project.id,
      title: 'Contestant-judged solo round',
      understandingPointIds: [point.id],
    });
    expect(change).toMatchObject({
      projectId: project.id,
      state: 'draft',
      understandingPointIds: [point.id],
      desiredOutcome: '',
    });
    await expect(
      createPreparedChange({
        projectId: 'other-project',
        title: 'Leak another project',
        understandingPointIds: [point.id],
      })
    ).rejects.toThrow(/Project not found/);
  });

  it('requires outcome, accepted understanding, and acceptance criteria before ready', async () => {
    const { project, point } = await fixture();
    let change = await createPreparedChange({
      projectId: project.id,
      title: 'Contestant-judged solo round',
      understandingPointIds: [point.id],
    });
    expect(await validatePreparedChange(change)).toEqual([
      'Desired outcome',
      'At least one acceptance criterion',
    ]);
    change = await updatePreparedChangeDraft(change.id, {
      desiredOutcome: 'Replace the universal judge with identity-hidden contestant ballots.',
      rationale: 'Plural judging avoids optimizing every response for one evaluator.',
      constraints: ['Response identity stays hidden during judging.'],
      nonGoals: ['Matchmaking'],
      acceptanceCriteria: ['Every eligible contestant produces a ballot.'],
      openImplementationChoices: ['How should incomplete ballots aggregate?'],
    });
    expect(await validatePreparedChange(change)).toEqual([]);

    const ready = await markPreparedChangeReady(change.id);
    expect(ready.state).toBe('ready');
    expect(ready.evidenceRefs).toEqual([
      {
        understandingPointId: point.id,
        conversationId: 'conv-slop',
        messageIds: ['message-judge'],
      },
    ]);
    await expect(
      updatePreparedChangeDraft(ready.id, { desiredOutcome: 'Rewrite it' })
    ).rejects.toThrow(/Only draft/);
    expect((await getPreparedChange(ready.id))?.readyAt).toBeInstanceOf(Date);
  });

  it('exports deterministic Markdown and JSON without an LLM', async () => {
    const { project, point } = await fixture();
    let change = await createPreparedChange({
      projectId: project.id,
      title: 'Contestant-judged solo round',
      understandingPointIds: [point.id],
    });
    change = await updatePreparedChangeDraft(change.id, {
      desiredOutcome: 'Use contestant ballots.',
      acceptanceCriteria: ['Reveal only after judging completes.'],
      repositoryRef: { remoteUrl: 'https://example.test/slop', baseCommit: 'abc123' },
    });
    change = await markPreparedChangeReady(change.id);
    const context = await loadPreparedChangeExportContext(change);
    const markdown = renderPreparedChangeMarkdown(context);
    expect(markdown).toContain('# Contestant-judged solo round');
    expect(markdown).toContain('conversation `conv-slop`, messages `message-judge`');
    expect(markdown).toContain('Do not silently resolve the open implementation choices');
    expect(renderPreparedChangeMarkdown(context)).toBe(markdown);

    const json = JSON.parse(renderPreparedChangeJson(context));
    expect(json.project.name).toBe('Slop Connoisseur');
    expect(json.understanding[0].id).toBe(point.id);
    expect(json.state).toBe('ready');
  });
});
