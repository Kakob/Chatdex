import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  associateConversationWithProject,
  bulkPutConversations,
  bulkPutMessages,
  clearAllData,
  createHumanProject,
  db,
} from '../lib/db';
import { startQuestionInvestigation } from '../lib/investigation/cases';
import { QuestionInvestigationPage } from './QuestionInvestigationPage';

const now = new Date('2026-08-23T12:00:00Z');

beforeEach(async () => {
  await clearAllData();
});

describe('QuestionInvestigationPage', () => {
  it('connects literal source search, exact evidence, a human finding, and Current Understanding', async () => {
    const user = userEvent.setup();
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
        fullText: 'Contestants should judge. One universal judge creates one taste target.',
      },
    ]);
    await bulkPutMessages([
      {
        id: 'message-user',
        conversationId: 'conv-slop',
        sender: 'user',
        text: 'Contestants should judge instead of one universal judge.',
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
    const investigation = await startQuestionInvestigation({
      projectId: project.id,
      conversationId: 'conv-slop',
      question: 'Should judging be contestant-specific?',
    });

    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={[
          `/projects/${project.id}/investigate/questions/${investigation.id}`,
        ]}
      >
        <Routes>
          <Route
            path="/projects/:id/investigate/questions/:caseId"
            element={<QuestionInvestigationPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Should judging be contestant-specific?')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Literal source search'), 'contestant');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/1 exact match/)).toBeInTheDocument();
    expect(
      await screen.findByText('Literal search record · 1', {}, { timeout: 5000 })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pin exact event' }));
    await waitFor(
      () => expect(screen.getByText('Pinned evidence · 1')).toBeInTheDocument(),
      { timeout: 5000 }
    );
    await user.click(screen.getByRole('checkbox'));
    await user.type(
      screen.getByLabelText('Finding statement'),
      'Contestant-specific judging preserves plural taste'
    );
    await user.click(screen.getByRole('button', { name: 'Save finding draft' }));
    expect(
      await screen.findByText('Contestant-specific judging preserves plural taste')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Finalize finding' }));
    await user.click(
      await screen.findByRole('button', { name: 'Promote to Current Understanding' })
    );
    expect(await screen.findByText('In Current Understanding')).toBeInTheDocument();

    const [understanding] = await db.understandingObjects.toArray();
    expect(understanding).toMatchObject({
      projectId: project.id,
      reviewState: 'accepted',
      title: 'Contestant-specific judging preserves plural taste',
    });
  }, 20_000);
});
