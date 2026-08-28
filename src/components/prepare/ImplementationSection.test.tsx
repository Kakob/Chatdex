// SPEC-change-workspace §16 CW-3 (UI): pasted-diff attach through the section
// freezes the open hypothesis, records provenance, and renders the attachment.
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { clearAllData, putUnderstandingProject } from '../../lib/db';
import { getPreparedChange } from '../../lib/db/preparedChanges';
import { createPreparedChange, updatePreparedChangeDraft } from '../../lib/prepare/changes';
import { addHypothesis } from '../../lib/prepare/lifecycle';
import { HypothesisSection } from './HypothesisSection';
import { ImplementationSection } from './ImplementationSection';
import type { PreparedChange } from '../../types/preparedChange';
import type { UnderstandingProject } from '../../types/understanding';

const now = new Date('2026-08-28T00:00:00Z');
const project: UnderstandingProject = { id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now };

const DIFF = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n a\n+b\n`;

async function seed(): Promise<PreparedChange> {
  await putUnderstandingProject(project);
  let change = await createPreparedChange({
    projectId: 'p1', title: 'Scroll', understandingPointIds: [],
    intent: { currentBehavior: '', desiredBehavior: 'scrolls', whyItMatters: '' },
  });
  change = await updatePreparedChangeDraft(change.id, { criteria: [{ id: 'c1', text: 'scrolls', createdAt: '' }] });
  return addHypothesis(change.id, 'Only the conversation id survives.');
}

beforeEach(async () => {
  await clearAllData();
});

describe('ImplementationSection + HypothesisSection', () => {
  it('attaches a pasted diff with provenance and freezes the hypothesis', async () => {
    const user = userEvent.setup();
    const seeded = await seed();
    let latest = seeded;
    const onChanged = async (c: PreparedChange) => {
      latest = c;
    };
    const { rerender } = render(
      <MemoryRouter>
        <HypothesisSection change={seeded} onChanged={onChanged} />
        <ImplementationSection change={seeded} project={project} onChanged={onChanged} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('frozen-hypothesis')).toBeNull();
    expect((screen.getByLabelText('Hypothesis text') as HTMLTextAreaElement).value).toBe('Only the conversation id survives.');

    await user.click(screen.getByRole('button', { name: 'Pasted diff' }));
    await user.click(screen.getByLabelText('Pasted diff'));
    await user.paste(DIFF);
    await user.selectOptions(screen.getByLabelText('Implementation provenance'), 'human_ai');
    await user.type(screen.getByLabelText('Provenance note'), 'Claude drafted, I edited');
    await user.click(screen.getByRole('button', { name: /Attach/ }));

    await waitFor(() => expect(latest.state).toBe('implementing'));
    const stored = (await getPreparedChange(seeded.id))!;
    expect(stored.implementation).toMatchObject({ source: 'pasted_diff', provenance: 'human_ai', provenanceNote: 'Claude drafted, I edited' });
    expect(stored.implementation?.files).toEqual([{ path: 'src/a.ts', additions: 1, deletions: 0, patch: expect.stringContaining('@@ -1 +1,2 @@') }]);
    expect(stored.hypotheses?.[0].frozenAt).toBeDefined();
    expect(stored.readyAt).toBeInstanceOf(Date);

    rerender(
      <MemoryRouter>
        <HypothesisSection change={stored} onChanged={onChanged} />
        <ImplementationSection change={stored} project={project} onChanged={onChanged} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('frozen-hypothesis').textContent).toContain('Only the conversation id survives.');
    expect(screen.getByTestId('attached-implementation').textContent).toContain('Human + AI');
    expect(screen.getByText('Replace implementation from')).toBeTruthy();
  });
});
