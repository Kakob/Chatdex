import { beforeEach, describe, expect, it } from 'vitest';
import {
  associateConversationWithProject,
  bulkPutConversations,
  bulkPutMessages,
  clearAllData,
  createHumanProject,
  getEventsForObject,
  getInvestigationCase,
} from '../db';
import {
  completeQuestionInvestigation,
  pinTranscriptExhibit,
  reopenQuestionInvestigation,
  startQuestionInvestigation,
} from './cases';
import {
  createInvestigationFinding,
  finalizeInvestigationFinding,
  promoteFindingToCurrentUnderstanding,
} from './findings';

const now = new Date('2026-08-23T12:00:00Z');

beforeEach(async () => {
  await clearAllData();
});

async function fixture() {
  const project = await createHumanProject({ name: 'Slop Connoisseur' });
  await bulkPutConversations([
    {
      id: 'conv-slop',
      source: 'chatgpt',
      name: 'Judging design discussion',
      summary: null,
      createdAt: now,
      updatedAt: now,
      importedAt: now,
      messageCount: 2,
      userMessageCount: 1,
      assistantMessageCount: 1,
      estimatedTokens: 60,
      fullText: 'I think contestants should judge. One universal judge creates one taste target.',
    },
  ]);
  await bulkPutMessages([
    {
      id: 'message-user',
      conversationId: 'conv-slop',
      sender: 'user',
      text: 'I think contestants should judge instead of one universal judge.',
      createdAt: now,
    },
    {
      id: 'message-assistant',
      conversationId: 'conv-slop',
      sender: 'assistant',
      text: 'That makes taste plural, but aggregation and ties stay open.',
      createdAt: new Date(now.getTime() + 1000),
    },
  ]);
  await associateConversationWithProject(project.id, 'conv-slop');
  return project;
}

describe('question-first project investigation', () => {
  it('creates a source-scoped question and promotes a human finding with provenance', async () => {
    const project = await fixture();
    const investigation = await startQuestionInvestigation({
      projectId: project.id,
      conversationId: 'conv-slop',
      question: 'Should judging be contestant-specific?',
    });
    expect(investigation).toMatchObject({
      projectId: project.id,
      conversationId: 'conv-slop',
      kind: 'question',
      state: 'open',
    });
    expect(investigation.primaryAnchorStableKey).toBeUndefined();

    const exhibit = await pinTranscriptExhibit(investigation.id, {
      stepIndex: 0,
      startOffset: 0,
      endOffset: 61,
    });
    let finding = await createInvestigationFinding({
      caseId: investigation.id,
      type: 'belief',
      title: 'Contestant-specific judging makes taste plural',
      body: 'The game should not optimize every response for one evaluator.',
      confidence: 'high',
      exhibitIds: [exhibit.id],
      reviewScopeIds: [],
    });
    finding = await finalizeInvestigationFinding(finding.id);
    expect(finding.state).toBe('finalized');

    const understanding = await promoteFindingToCurrentUnderstanding(finding.id);
    expect(understanding).toMatchObject({
      projectId: project.id,
      type: 'belief',
      reviewState: 'accepted',
      title: finding.title,
    });
    const [event] = await getEventsForObject(understanding.id);
    expect(event.evidence).toEqual([
      { conversationId: 'conv-slop', messageIds: ['message-user'] },
    ]);

    const completed = await completeQuestionInvestigation(investigation.id);
    expect(completed.state).toBe('completed');
    expect((await reopenQuestionInvestigation(investigation.id)).state).toBe('reopened');
  });

  it('requires an accepted project source and evidence-backed findings', async () => {
    const project = await fixture();
    await bulkPutConversations([
      {
        id: 'conv-other',
        source: 'chatgpt',
        name: 'Other project',
        summary: null,
        createdAt: now,
        updatedAt: now,
        importedAt: now,
        messageCount: 0,
        userMessageCount: 0,
        assistantMessageCount: 0,
        estimatedTokens: 0,
        fullText: '',
      },
    ]);
    await expect(
      startQuestionInvestigation({
        projectId: project.id,
        conversationId: 'conv-other',
        question: 'Leak another project?',
      })
    ).rejects.toThrow(/not accepted/);

    const investigation = await startQuestionInvestigation({
      projectId: project.id,
      conversationId: 'conv-slop',
      question: 'Should judging be contestant-specific?',
    });
    await expect(
      createInvestigationFinding({
        caseId: investigation.id,
        type: 'decision',
        title: 'Use contestant judging',
        confidence: 'medium',
        exhibitIds: [],
        reviewScopeIds: [],
      })
    ).rejects.toThrow(/requires pinned evidence/);
    await expect(completeQuestionInvestigation(investigation.id)).rejects.toThrow(
      /Finalize at least one finding/
    );
    expect((await getInvestigationCase(investigation.id))?.state).toBe('open');
  });
});
