// SPEC-change-workspace §14 / §16 CW-6 (UI): a workspace starts from intent
// alone, the rail lists every section with progress, and the timeline view
// reconstructs the record read-only (and logs a history inspection).
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { clearAllData, db, putUnderstandingProject } from '../lib/db';
import { PrepareChangePage } from './PrepareChangePage';

const now = new Date('2026-08-28T00:00:00Z');

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/projects/p1/prepare${search}`]}>
      <Routes>
        <Route path="/projects/:id/prepare" element={<PrepareChangePage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(async () => {
  await clearAllData();
  await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
});

describe('PrepareChangePage (Change Workspace)', () => {
  it('creates a workspace from a title + desired behavior and shows the rail and sections', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No change workspaces yet');

    await user.click(screen.getByRole('button', { name: /New workspace/ }));
    const create = screen.getByTestId('create-workspace');
    expect(within(create).getByRole('button', { name: /Create workspace/ })).toBeDisabled();
    await user.type(within(create).getByLabelText('Change title'), 'Search result should scroll to the match');
    await user.type(within(create).getByLabelText('Desired behavior'), 'Clicking a result scrolls the match into view.');
    await user.click(within(create).getByRole('button', { name: /Create workspace/ }));

    await waitFor(() => expect(screen.getByTestId('rail-intent')).toBeTruthy());
    for (const section of ['evidence', 'trace', 'hypotheses', 'implementation', 'verification', 'learned', 'promotions', 'questions']) {
      expect(screen.getByTestId(`rail-${section}`)).toBeTruthy();
    }
    expect(screen.getByTestId('rail-intent').getAttribute('data-progress')).toBe('started');
    expect(screen.getByTestId('rail-evidence').getAttribute('data-progress')).toBe('empty');
    expect(screen.getByRole('heading', { name: 'Intent & criteria' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'My Trace' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Open questions' })).toBeTruthy();

    const stored = await db.preparedChanges.where('projectId').equals('p1').first();
    expect(stored).toMatchObject({ state: 'draft', understandingPointIds: [], desiredOutcome: 'Clicking a result scrolls the match into view.' });
  });

  it('shows the read-only timeline for ?view=timeline and records a history inspection', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /New workspace/ }));
    await user.type(screen.getByLabelText('Change title'), 'Scroll');
    await user.type(screen.getByLabelText('Desired behavior'), 'scrolls');
    await user.click(screen.getByRole('button', { name: /Create workspace/ }));
    await waitFor(() => expect(screen.getByTestId('rail-intent')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /Timeline/ }));
    const timeline = await screen.findByTestId('workspace-timeline');
    expect(within(timeline).getByText('Intent at the time')).toBeTruthy();
    expect(within(timeline).getByText('scrolls')).toBeTruthy();
    expect(screen.queryByTestId('rail-intent')).toBeNull();
    await waitFor(async () => expect((await db.inspections.toArray()).filter((r) => r.kind === 'history')).toHaveLength(1));
  });
});
