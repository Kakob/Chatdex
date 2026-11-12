import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { clearAllData, db } from '../lib/db';
import { createEngineeringExampleProjects, EVENT_QUEUE_PROJECT_ID, TODO_LIST_PROJECT_ID } from '../lib/engineering/demoProjects';
import { engineeringModelDb, installExampleTransitions } from '../lib/engineering/modelStore';
import { EngineeringExplorerPage } from './EngineeringExplorerPage';
import { TodoExplorerPage } from './TodoExplorerPage';

beforeEach(async () => {
  await clearAllData();
  await engineeringModelDb.transitions.clear();
  await engineeringModelDb.proposals.clear();
  await createEngineeringExampleProjects();
  await installExampleTransitions(EVENT_QUEUE_PROJECT_ID);
  await installExampleTransitions(TODO_LIST_PROJECT_ID);
});
afterEach(cleanup);

describe('model projections on running examples', () => {
  it('shows a design-only queue label in the diagram without changing real execution', async () => {
    const user = userEvent.setup();
    const concepts = await db.landscapeRegions.where('projectId').equals(EVENT_QUEUE_PROJECT_ID).toArray();
    render(
      <MemoryRouter>
        <EngineeringExplorerPage projectId={EVENT_QUEUE_PROJECT_ID} projectName="Event Queue example" concepts={concepts} />
      </MemoryRouter>,
    );
    const inspector = screen.getByRole('region', { name: 'Inspector' });
    const model = await within(inspector).findByRole('region', { name: 'Persistent engineering model' });
    await user.click(await within(model).findByRole('button', { name: 'Propose model edit' }));
    await user.clear(within(model).getByRole('textbox', { name: 'Proposed name' }));
    await user.type(within(model).getByRole('textbox', { name: 'Proposed name' }), 'Reliable queue proposal');
    await user.click(within(model).getByRole('button', { name: 'Save model proposal' }));

    const diagram = screen.getByRole('group', { name: 'Event queue system diagram' });
    expect(await within(diagram).findByRole('button', { name: 'Reliable queue proposal' })).toHaveAttribute('data-proposed', 'true');
    expect(within(inspector).getByText(/Proposed only · running program unchanged/)).toBeInTheDocument();

    const live = screen.getByRole('region', { name: 'Live queue controls' });
    await user.click(within(live).getByRole('button', { name: '+ Job' }));
    expect(await within(live).findByText(/Job accepted/)).toBeInTheDocument();
    expect(live).toHaveTextContent('Pending: 1');
    expect(within(model).getByText('Queue')).toBeInTheDocument(); // current canonical title retained
  });

  it('shows a todo design proposal while the actual reducer still creates and completes tasks', async () => {
    const user = userEvent.setup();
    const concepts = await db.landscapeRegions.where('projectId').equals(TODO_LIST_PROJECT_ID).toArray();
    render(
      <MemoryRouter>
        <TodoExplorerPage projectId={TODO_LIST_PROJECT_ID} projectName="Todo List example" concepts={concepts} />
      </MemoryRouter>,
    );
    const inspector = screen.getByRole('region', { name: 'Todo inspector' });
    const model = await within(inspector).findByRole('region', { name: 'Persistent engineering model' });
    await user.click(await within(model).findByRole('button', { name: 'Propose model edit' }));
    await user.clear(within(model).getByRole('textbox', { name: 'Proposed name' }));
    await user.type(within(model).getByRole('textbox', { name: 'Proposed name' }), 'Prioritized task list');
    await user.click(within(model).getByRole('button', { name: 'Save model proposal' }));

    const diagram = screen.getByRole('region', { name: 'Todo system diagram' });
    expect(await within(diagram).findByRole('button', { name: /Prioritized task list/ })).toHaveAttribute('data-proposed', 'true');
    const live = screen.getByRole('region', { name: 'Live todo controls' });
    await user.type(within(live).getByRole('textbox', { name: 'New task' }), 'Test real code');
    await user.click(within(live).getByRole('button', { name: 'Add' }));
    expect(live).toHaveTextContent('1 active · 0 completed');
  });
});
