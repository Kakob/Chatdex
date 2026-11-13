import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectsPage } from './ProjectsPage';
import { db } from '../lib/db';
import type { UnderstandingProject } from '../types/understanding';

vi.mock('../lib/providers', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/providers')>(),
  // A stalled provider request must not hold up the project list.
  listReadyProviders: () => new Promise(() => {}),
}));

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
});
afterEach(cleanup);

it('shows projects, renames and deletions arriving after mount without reloading', async () => {
  render(<MemoryRouter><ProjectsPage /></MemoryRouter>);
  await screen.findByText('0 projects');
  const project: UnderstandingProject = {
    id: 'remote-project', name: 'Desktop project', origin: 'user', reviewState: 'accepted',
    createdAt: new Date(), updatedAt: new Date(),
  };
  // Sync applies decrypted rows directly to these tables.
  await db.understandingProjects.put(project);
  expect(await screen.findByRole('link', { name: 'Desktop project' })).toBeInTheDocument();

  await db.understandingProjects.update(project.id, { name: 'Renamed on desktop' });
  expect(await screen.findByRole('link', { name: 'Renamed on desktop' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Desktop project' })).not.toBeInTheDocument();

  await db.understandingProjects.delete(project.id);
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Renamed on desktop' })).not.toBeInTheDocument());
  expect(screen.getByText('0 projects')).toBeInTheDocument();
});
