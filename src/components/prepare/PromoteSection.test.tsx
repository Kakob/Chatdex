// SPEC-change-workspace §16 CW-5 (UI): learned → promote → question → close.
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { clearAllData, db, putUnderstandingProject } from '../../lib/db';
import { getPreparedChange } from '../../lib/db/preparedChanges';
import { createPreparedChange, updatePreparedChangeDraft } from '../../lib/prepare/changes';
import { addEvidenceItems, attachImplementation, markVerified, updateVerificationRow } from '../../lib/prepare/lifecycle';
import { LearnedSection } from './LearnedSection';
import { PromoteSection } from './PromoteSection';
import { QuestionsSection } from './QuestionsSection';
import type { PreparedChange } from '../../types/preparedChange';

const now = new Date('2026-08-28T00:00:00Z');

async function seed(): Promise<PreparedChange> {
  await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
  let change = await createPreparedChange({ projectId: 'p1', title: 'Scroll', understandingPointIds: [], intent: { currentBehavior: '', desiredBehavior: 'scrolls', whyItMatters: '' } });
  change = await updatePreparedChangeDraft(change.id, { criteria: [{ id: 'c1', text: 'scrolls', createdAt: '' }] });
  change = await addEvidenceItems(change.id, [
    { id: 'code', kind: 'code', createdAt: now.toISOString(), origin: 'user', addedVia: 'search', repoKey: 'gh:Kakob/Chatdex', sha: 'a'.repeat(40), path: 'src/pages/ConversationsPage.tsx', startLine: 5, endLine: 6, quote: 'scrollTo', quoteHash: 'h' },
  ]);
  change = await attachImplementation(change.id, { source: 'pasted_diff', provenance: 'human', files: [{ path: 'a', additions: 1, deletions: 0 }] });
  change = await updateVerificationRow(change.id, { criterionId: 'c1', evidenceIds: ['code'], status: 'partial' });
  return markVerified(change.id);
}

function Stateful({ initial }: { initial: PreparedChange }) {
  const [change, setChange] = useState(initial);
  const onChanged = async (c: PreparedChange) => setChange(c);
  return (
    <MemoryRouter>
      <LearnedSection change={change} onChanged={onChanged} />
      <PromoteSection change={change} onChanged={onChanged} />
      <QuestionsSection change={change} onChanged={onChanged} />
    </MemoryRouter>
  );
}

beforeEach(async () => {
  await clearAllData();
});

describe('Learned / Promote / Questions', () => {
  it('walks the tail of the loop and closes the workspace', async () => {
    const user = userEvent.setup();
    const change = await seed();
    render(<Stateful initial={change} />);

    // Learned (human text), Close disabled until saved.
    expect(screen.getByRole('button', { name: /Close workspace/ })).toBeDisabled();
    await user.type(screen.getByLabelText('What I learned'), 'Scrolling belongs to ConversationsPage.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Close workspace/ })).toBeEnabled());

    // Promote: pick the verified code item, write the belief.
    await user.click(screen.getByLabelText(/Promote src\/pages\/ConversationsPage\.tsx:5–6/));
    await user.type(screen.getByLabelText('Promoted understanding title'), 'ConversationsPage owns scrolling');
    await user.click(screen.getByRole('button', { name: /^Promote/ }));
    await waitFor(() => expect(within(screen.getByTestId('promoted-list')).getByText('ConversationsPage owns scrolling')).toBeTruthy());
    const objects = await db.understandingObjects.where('projectId').equals('p1').toArray();
    const promoted = objects.find((o) => o.title === 'ConversationsPage owns scrolling');
    expect(promoted).toMatchObject({ type: 'belief', origin: 'user', reviewState: 'accepted' });
    const events = await db.understandingEvents.where('objectId').equals(promoted!.id).toArray();
    expect(events[0].codeEvidence?.map((e) => e.id)).toEqual(['code']);

    // Question becomes a first-class object linked to the workspace.
    await user.type(screen.getByLabelText('New question'), 'What if the message was deleted?{Enter}');
    await waitFor(() => expect(within(screen.getByTestId('question-list')).getByText('What if the message was deleted?')).toBeTruthy());
    expect(screen.getByText('start a workspace from this')).toBeTruthy();
    const stored = await getPreparedChange(change.id);
    expect(stored?.questionIds).toHaveLength(1);
    expect((await db.understandingObjects.get(stored!.questionIds![0]))?.type).toBe('question');

    // Close.
    await user.click(screen.getByRole('button', { name: /Close workspace/ }));
    await waitFor(async () => expect((await getPreparedChange(change.id))?.state).toBe('closed'));
    await waitFor(() => expect(screen.queryByLabelText('New question')).toBeNull());
    expect(screen.getByRole('button', { name: /^Promote/ })).toBeTruthy(); // promotions stay appendable after close
  });
});
