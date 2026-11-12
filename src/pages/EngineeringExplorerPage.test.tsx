import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EngineeringExplorerPage } from './EngineeringExplorerPage';

function renderExplorer() {
  return render(
    <MemoryRouter initialEntries={['/engineering/explore']}>
      <Routes>
        <Route path="/engineering/explore" element={<EngineeringExplorerPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('EngineeringExplorerPage', () => {
  it('shows distinct understanding and actual source for a selected component', async () => {
    const user = userEvent.setup();
    renderExplorer();

    const nav = screen.getByRole('navigation', { name: 'System components' });
    const explanation = screen.getByRole('region', { name: 'Component understanding' });
    const code = screen.getByRole('region', { name: 'Source code' });

    expect(within(explanation).getByRole('heading', { name: 'Event Queue' })).toBeInTheDocument();
    await user.click(within(nav).getByRole('button', { name: /Producer/ }));
    expect(within(explanation).getByRole('heading', { name: 'Producer' })).toBeInTheDocument();
    expect(within(explanation).getByText(/enqueue\(\) gives the job an ID/)).toBeInTheDocument();
    expect(within(code).getByText(/async enqueue\(payload/)).toBeInTheDocument();

    await user.click(within(nav).getByRole('button', { name: /Worker/ }));
    expect(within(explanation).getByRole('heading', { name: 'Worker' })).toBeInTheDocument();
    expect(within(explanation).getByText(/acknowledges only if processing succeeds/)).toBeInTheDocument();
    expect(within(code).getByText('src/worker.ts')).toBeInTheDocument();
    expect(within(code).getByText(/export async function workOnce/)).toBeInTheDocument();

    await user.click(within(code).getByRole('button', { name: 'View full file' }));
    expect(within(code).getByRole('button', { name: 'Show relevant excerpt' })).toBeInTheDocument();
  });

  it('connects the illustrated failure sequence with the relevant code and tests', async () => {
    const user = userEvent.setup();
    renderExplorer();

    const scenario = screen.getByRole('region', { name: 'Guided behavior' });
    const explanation = screen.getByRole('region', { name: 'Component understanding' });
    const code = screen.getByRole('region', { name: 'Source code' });

    await user.click(within(scenario).getByRole('button', { name: 'Worker crashes' }));
    await user.click(within(scenario).getByRole('button', { name: /3\. Worker fails/ }));
    expect(within(scenario).getByText(/queue has NOT forgotten the job/)).toBeInTheDocument();
    expect(within(explanation).getByRole('heading', { name: 'Worker' })).toBeInTheDocument();
    expect(within(code).getByText('src/worker.ts')).toBeInTheDocument();

    await user.click(within(explanation).getByRole('button', { name: /See supporting tests/ }));
    expect(within(explanation).getByRole('heading', { name: 'Tests' })).toBeInTheDocument();
    expect(within(code).getByText('test/delivery.test.ts')).toBeInTheDocument();
    expect(within(code).getByText(/it\('\[EQ-C5\]/)).toBeInTheDocument();

    await user.click(within(scenario).getByRole('button', { name: 'Successful job' }));
    expect(within(scenario).getByText(/A producer calls enqueue/)).toBeInTheDocument();
  });
});
