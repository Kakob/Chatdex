import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TodoExplorerPage } from './TodoExplorerPage';
import { TODO_LIST_PROJECT_ID } from '../lib/engineering/demoProjects';

afterEach(cleanup);

describe('TodoExplorerPage', () => {
  it('executes its real reducer from a visual project-scoped workspace', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TodoExplorerPage projectId={TODO_LIST_PROJECT_ID} projectName="Todo List · engineering example" />
      </MemoryRouter>,
    );
    const live = screen.getByRole('region', { name: 'Live todo controls' });
    const inspector = screen.getByRole('region', { name: 'Todo inspector' });
    const diagram = screen.getByRole('region', { name: 'Todo system diagram' });
    expect(within(inspector).getByRole('heading', { name: 'Task list' })).toBeInTheDocument();

    await user.type(within(live).getByRole('textbox', { name: 'New task' }), 'Write tests');
    await user.click(within(live).getByRole('button', { name: 'Add' }));
    expect(within(live).getByText('Write tests')).toBeInTheDocument();
    expect(live).toHaveTextContent('1 active · 0 completed');
    expect(within(inspector).getByRole('heading', { name: 'Task input' })).toBeInTheDocument();

    await user.click(within(live).getByRole('checkbox', { name: 'Complete Write tests' }));
    expect(live).toHaveTextContent('0 active · 1 completed');
    expect(within(inspector).getByRole('heading', { name: 'Completed' })).toBeInTheDocument();

    await user.click(within(diagram).getByRole('button', { name: /Active/ }));
    expect(within(inspector).getByRole('heading', { name: 'Active' })).toBeInTheDocument();
    await user.click(within(inspector).getByRole('tab', { name: 'Code' }));
    expect(within(inspector).getByText(/src\/lib\/engineering\/todoModel\.ts/)).toBeInTheDocument();
    expect(within(inspector).getByText(/export function toggleTask/)).toBeInTheDocument();
    expect(within(inspector).getByTestId('source-viewport')).toHaveAttribute('data-wrap', 'on');

    await user.click(within(inspector).getByRole('tab', { name: 'Tests' }));
    expect(within(inspector).getByText(/todoModel\.test\.ts/)).toBeInTheDocument();

    await user.click(within(live).getByRole('button', { name: 'Clear completed' }));
    expect(live).toHaveTextContent('0 active · 0 completed');
  });
});
