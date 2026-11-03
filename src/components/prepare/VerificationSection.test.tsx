// SPEC-change-workspace §16 CW-4 (UI): human-set statuses, AI-only rows
// cannot become supported, manual observation attaches, gate on notes.
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { clearAllData, putUnderstandingProject } from '../../lib/db';
import { getPreparedChange } from '../../lib/db/preparedChanges';
import { createPreparedChange, updatePreparedChangeDraft } from '../../lib/prepare/changes';
import { addEvidenceItems, attachImplementation } from '../../lib/prepare/lifecycle';
import { VerificationSection } from './VerificationSection';
import type { PreparedChange } from '../../types/preparedChange';

const now = new Date('2026-08-28T00:00:00Z');

async function seed(): Promise<PreparedChange> {
  await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
  let change = await createPreparedChange({ projectId: 'p1', title: 'Scroll', understandingPointIds: [], intent: { currentBehavior: '', desiredBehavior: 'scrolls', whyItMatters: '' } });
  change = await updatePreparedChangeDraft(change.id, {
    criteria: [
      { id: 'c1', text: 'The match enters the viewport.', createdAt: '' },
      { id: 'c2', text: 'Works after a cold load.', createdAt: '' },
    ],
  });
  change = await addEvidenceItems(change.id, [
    { id: 'ai', kind: 'ai_inference', createdAt: now.toISOString(), origin: 'ai', addedVia: 'assisted', runId: 'r', provider: 'anthropic', promptDigest: 'd', text: 'It scrolls, probably.' },
  ]);
  return attachImplementation(change.id, { source: 'pasted_diff', provenance: 'human', files: [{ path: 'a', additions: 1, deletions: 0 }] });
}

function Harness({ initial }: { initial: PreparedChange }) {
  // Re-render with the latest change like the page does.
  return <Stateful initial={initial} />;
}

function Stateful({ initial }: { initial: PreparedChange }) {
  const [change, setChange] = useState(initial);
  return (
    <MemoryRouter>
      <VerificationSection change={change} projectId="p1" onChanged={async (c) => setChange(c)} />
    </MemoryRouter>
  );
}

beforeEach(async () => {
  await clearAllData();
});

describe('VerificationSection', () => {
  it('blocks AI-only support, accepts a manual observation, and gates Mark verified on notes', async () => {
    const user = userEvent.setup();
    const change = await seed();
    render(<Harness initial={change} />);

    const c1 = () => screen.getByTestId('criterion-c1');
    expect(within(c1()).getByTestId('row-status').textContent).toBe('Unverified');
    expect(screen.getByRole('button', { name: /Mark verified/ })).toBeDisabled();

    // Attach the AI item, then try to mark supported: refused (law §2.2).
    await user.selectOptions(within(c1()).getByLabelText('Attach evidence to c1'), 'ai');
    await waitFor(() => expect(within(c1()).getByText(/AI-claimed/)).toBeTruthy());
    await user.selectOptions(within(c1()).getByLabelText(/Status for The match/), 'supported');
    await waitFor(async () => expect((await getPreparedChange(change.id))?.verification?.find((r) => r.criterionId === 'c1')?.status).toBe('unverified'));

    // Record a manual observation → supported becomes possible.
    await user.click(within(c1()).getByLabelText(/Record observation for The match/));
    await user.selectOptions(screen.getByLabelText('Observation outcome'), 'pass');
    await user.type(screen.getByLabelText('Observation note'), 'Saw the message scroll into view in Chrome');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(within(c1()).getByText(/manual · pass/)).toBeTruthy());
    await user.selectOptions(within(c1()).getByLabelText(/Status for The match/), 'supported');
    await waitFor(() => expect(within(c1()).getByTestId('row-status').textContent).toBe('Supported'));

    // c2 stays unverified: still blocked until a note accepts that.
    expect(screen.getByRole('button', { name: /Mark verified/ })).toBeDisabled();
    const note = screen.getByLabelText(/Note for Works after a cold load/);
    await user.type(note, 'Cold load not tested yet');
    await user.tab();
    await waitFor(() => expect(screen.getByRole('button', { name: /Mark verified/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Mark verified/ }));
    await waitFor(async () => expect((await getPreparedChange(change.id))?.state).toBe('verified'));
  });
});
