// SPEC-change-workspace §16 CW-2: list editor — add / move / attach evidence,
// derived edge state, labels render as text (audit S6).
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearAllData, putUnderstandingProject } from '../../lib/db';
import { getPreparedChange } from '../../lib/db/preparedChanges';
import { createPreparedChange } from '../../lib/prepare/changes';
import { addEvidenceItems } from '../../lib/prepare/lifecycle';
import { TraceSection } from './TraceSection';
import type { PreparedChange } from '../../types/preparedChange';

const now = new Date('2026-08-28T00:00:00Z');

async function seed(): Promise<PreparedChange> {
  await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
  const change = await createPreparedChange({
    projectId: 'p1',
    title: 'Scroll to match',
    understandingPointIds: [],
    intent: { currentBehavior: '', desiredBehavior: 'scrolls', whyItMatters: '' },
  });
  return addEvidenceItems(change.id, [
    {
      id: 'code-1', kind: 'code', createdAt: now.toISOString(), origin: 'user', addedVia: 'search',
      repoKey: 'gh:Kakob/Chatdex', sha: 'a'.repeat(40), path: 'src/pages/SearchPage.tsx', startLine: 6, endLine: 6,
      quote: 'navigate(...)', quoteHash: 'h',
    },
  ]);
}

function renderSection(change: PreparedChange) {
  let latest = change;
  const utils = render(
    <TraceSection
      change={change}
      onChanged={async (c) => {
        latest = c;
      }}
    />
  );
  return { ...utils, latest: () => latest };
}

beforeEach(async () => {
  await clearAllData();
});

describe('TraceSection', () => {
  it('adds nodes, derives the edge state from attached evidence, and persists on save', async () => {
    const user = userEvent.setup();
    const change = await seed();
    const { latest } = renderSection(change);

    await user.type(screen.getByLabelText('New node label'), 'SearchPage{Enter}');
    await user.type(screen.getByLabelText('New node label'), '<script>alert(1)</script>{Enter}');

    const labels = screen.getAllByLabelText('Node label') as HTMLInputElement[];
    expect(labels.map((l) => l.value)).toEqual(['SearchPage', '<script>alert(1)</script>']);
    expect(document.querySelector('script')).toBeNull();

    // One edge between the two nodes, unknown until evidence is attached.
    expect(screen.getByTestId('verification-chip').textContent).toBe('Unknown');
    await user.click(screen.getByLabelText('Evidence for this relationship'));
    const edgeRow = screen.getByTestId('verification-chip').closest('[data-testid^="edge-"]:not([data-testid="verification-chip"])')!;
    await user.click(within(edgeRow as HTMLElement).getByRole('checkbox', { name: /SearchPage\.tsx:6/ }));
    expect(screen.getByTestId('verification-chip').textContent).toBe('Verified');

    await user.click(screen.getByRole('button', { name: /Save trace/ }));
    await waitFor(() => expect(latest().trace?.nodes).toHaveLength(2));
    const stored = await getPreparedChange(change.id);
    expect(stored?.trace?.nodes.map((n) => n.label)).toEqual(['SearchPage', '<script>alert(1)</script>']);
    expect(stored?.trace?.edges).toHaveLength(1);
    expect(stored?.trace?.edges[0].evidenceIds).toEqual(['code-1']);
  });

  it('moves nodes, inserts unknown steps, and marks contradiction only with a note', async () => {
    const user = userEvent.setup();
    const change = await seed();
    renderSection(change);

    await user.type(screen.getByLabelText('New node label'), 'A{Enter}');
    await user.type(screen.getByLabelText('New node label'), 'B{Enter}');
    await user.click(screen.getByRole('button', { name: 'Add ???' }));
    let labels = () => (screen.getAllByLabelText('Node label') as HTMLInputElement[]).map((l) => l.value);
    expect(labels()).toEqual(['A', 'B', '???']);

    const moveUp = screen.getAllByLabelText('Move up');
    await user.click(moveUp[1]);
    expect(labels()).toEqual(['B', 'A', '???']);

    await user.click(screen.getAllByLabelText('Add branch')[0]);
    labels = () => (screen.getAllByLabelText('Node label') as HTMLInputElement[]).map((l) => l.value);
    expect(labels()).toEqual(['B', '???', 'A', '???']);
    expect(screen.getByText('branches to')).toBeTruthy();

    const contradict = screen.getAllByRole('checkbox', { name: 'contradicted' })[0];
    await user.click(contradict);
    const note = screen.getByLabelText('Contradiction note');
    await user.type(note, 'runtime shows otherwise');
    await user.tab();
    expect(screen.getAllByTestId('verification-chip')[0].textContent).toBe('Contradicted');

    await user.click(screen.getAllByLabelText('Remove node')[0]);
    expect(labels()).toEqual(['A', '???']);
  });

  it('is read-only once the workspace is closed', async () => {
    const change = await seed();
    renderSection({ ...change, state: 'closed', trace: { nodes: [{ id: 'n', label: 'X', kind: 'other', evidenceIds: [], order: 0 }], edges: [] } });
    expect(screen.queryByRole('button', { name: /Save trace/ })).toBeNull();
    expect((screen.getByLabelText('Node label') as HTMLInputElement).disabled).toBe(true);
  });
});
