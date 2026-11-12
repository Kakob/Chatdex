import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { clearAllData } from '../lib/db';
import { createHumanProject } from '../lib/db/understanding';
import { createEngineeringExampleProjects, EVENT_QUEUE_PROJECT_ID, TODO_LIST_PROJECT_ID } from '../lib/engineering/demoProjects';
import { EngineeringProjectPage } from './EngineeringProjectPage';

beforeEach(async () => { await clearAllData(); });
afterEach(cleanup);

function openProject(id: string) {
  return render(
    <MemoryRouter initialEntries={['/projects/' + id + '/engineering']}>
      <Routes>
        <Route path="/projects/:id/engineering" element={<EngineeringProjectPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('project-scoped engineering routes', () => {
  it('uses the native project and concept records for the live event queue', async () => {
    await createEngineeringExampleProjects();
    openProject(EVENT_QUEUE_PROJECT_ID);
    expect(await screen.findByRole('heading', { name: /Event Queue · engineering example/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Live queue controls' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Event queue system diagram' })).toBeInTheDocument();
  });

  it('opens the second Todo List project with its own executable reducer', async () => {
    await createEngineeringExampleProjects();
    openProject(TODO_LIST_PROJECT_ID);
    expect(await screen.findByRole('heading', { name: /Todo List · engineering example/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Live todo controls' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Todo inspector' })).toBeInTheDocument();
  });

  it('does not pretend an unrelated project has a generated executable model', async () => {
    const project = await createHumanProject({ name: 'My personal project' });
    openProject(project.id);
    expect(await screen.findByText(/does not have an executable engineering adapter/)).toBeInTheDocument();
  });
});
