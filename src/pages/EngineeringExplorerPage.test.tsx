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

describe('EngineeringExplorerPage: visual system model', () => {
  it('keeps the system diagram and selected inspector together instead of stacking several page panels', async () => {
    const user = userEvent.setup();
    renderExplorer();

    const diagram = screen.getByRole('group', { name: 'Event queue system diagram' });
    const inspector = screen.getByRole('region', { name: 'Inspector' });
    const tablist = within(inspector).getByRole('tablist', { name: 'Inspect selected system part' });

    expect(within(diagram).getAllByRole('button')).toHaveLength(9);
    expect(within(inspector).getByRole('heading', { name: 'Queue' })).toBeInTheDocument();
    expect(within(tablist).getAllByRole('tab')).toHaveLength(3);

    await user.click(within(diagram).getByRole('button', { name: 'Producer' }));
    expect(within(inspector).getByRole('heading', { name: 'Producer' })).toBeInTheDocument();
    expect(within(inspector).getByText(/enqueue\(\) stores a new job as pending/)).toBeInTheDocument();
    expect(within(diagram).getByRole('button', { name: 'Producer' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(diagram).getByRole('button', { name: 'Worker' }));
    expect(within(inspector).getByRole('heading', { name: 'Worker' })).toBeInTheDocument();
    expect(within(inspector).getByText(/workOnce\(\) does not acknowledge/)).toBeInTheDocument();
    expect(within(diagram).getByRole('button', { name: 'Producer' })).toHaveAttribute('aria-pressed', 'false');

    // The obsolete large "System components" list should not reappear.
    expect(screen.queryByRole('navigation', { name: 'System components' })).not.toBeInTheDocument();
  });

  it('changes code and test source when inspecting different nodes', async () => {
    const user = userEvent.setup();
    renderExplorer();

    const diagram = screen.getByRole('group', { name: 'Event queue system diagram' });
    const inspector = screen.getByRole('region', { name: 'Inspector' });

    await user.click(within(diagram).getByRole('button', { name: 'Worker' }));
    await user.click(within(inspector).getByRole('tab', { name: 'Code' }));
    expect(within(inspector).getByText(/src\/worker\.ts/)).toBeInTheDocument();
    expect(within(inspector).getByText(/export async function workOnce/)).toBeInTheDocument();

    await user.click(within(inspector).getByRole('button', { name: 'View full file' }));
    expect(within(inspector).getByRole('button', { name: 'Show relevant excerpt' })).toBeInTheDocument();

    // Selecting another node changes source even while the Code tab stays active.
    await user.click(within(diagram).getByRole('button', { name: 'Leased' }));
    expect(within(inspector).getByRole('heading', { name: 'Leased' })).toBeInTheDocument();
    expect(within(inspector).getByText(/src\/queue\.ts/)).toBeInTheDocument();
    expect(within(inspector).getByText(/async claim\(workerId/)).toBeInTheDocument();

    await user.click(within(inspector).getByRole('tab', { name: 'Tests' }));
    expect(within(inspector).getByText('EQ-C3')).toBeInTheDocument();
    expect(within(inspector).getByText(/it\('\[EQ-C3\]/)).toBeInTheDocument();

    await user.click(within(diagram).getByRole('button', { name: 'Dead letter' }));
    expect(within(inspector).getByText('EQ-C7')).toBeInTheDocument();
    expect(within(inspector).getByText(/it\('\[EQ-C7\]/)).toBeInTheDocument();
  });

  it('steps through a worker failure and visually highlights the relevant components and transitions', async () => {
    const user = userEvent.setup();
    renderExplorer();

    const diagram = screen.getByRole('group', { name: 'Event queue system diagram' });
    const inspector = screen.getByRole('region', { name: 'Inspector' });
    const walkthrough = screen.getByRole('region', { name: 'Scenario walkthrough' });

    // Default is illustrative worker failure; the first step highlights enqueue.
    expect(within(walkthrough).getByText('Job submitted')).toBeInTheDocument();
    expect(diagram.querySelector('[data-edge="enqueue"]')).toHaveAttribute('data-highlighted', 'true');

    await user.click(within(walkthrough).getByRole('button', { name: 'Next step' }));
    expect(within(walkthrough).getByText('Claimed')).toBeInTheDocument();
    expect(diagram.querySelector('[data-edge="claim"]')).toHaveAttribute('data-highlighted', 'true');
    expect(within(inspector).getByRole('heading', { name: 'Leased' })).toBeInTheDocument();

    await user.click(within(walkthrough).getByRole('button', { name: 'Next step' }));
    expect(within(walkthrough).getByText('Worker fails')).toBeInTheDocument();
    expect(within(inspector).getByRole('heading', { name: 'Worker' })).toBeInTheDocument();

    await user.click(within(walkthrough).getByRole('button', { name: 'Next step' }));
    expect(within(walkthrough).getByText('Lease expires')).toBeInTheDocument();
    expect(diagram.querySelector('[data-edge="expire"]')).toHaveAttribute('data-highlighted', 'true');
    expect(within(diagram).getByRole('button', { name: 'Retry' })).toHaveAttribute('data-highlighted', 'true');

    await user.click(within(walkthrough).getByRole('button', { name: 'Next step' }));
    expect(within(walkthrough).getByText('Pending again')).toBeInTheDocument();
    expect(diagram.querySelector('[data-edge="requeue"]')).toHaveAttribute('data-highlighted', 'true');
    expect(within(inspector).getByRole('heading', { name: 'Pending' })).toBeInTheDocument();

    await user.click(within(diagram).getByRole('button', { name: 'Tests' }));
    expect(within(inspector).getByRole('heading', { name: 'Tests' })).toBeInTheDocument();
    expect(within(walkthrough).getByText('Pending again')).toBeInTheDocument();
  });

  it('lets a small-screen user focus the inspector and return to the full diagram', async () => {
    const user = userEvent.setup();
    renderExplorer();
    const diagram = screen.getByRole('group', { name: 'Event queue system diagram' });
    const inspector = screen.getByRole('region', { name: 'Inspector' });

    await user.click(within(inspector).getByRole('button', { name: 'Expand inspector' }));
    expect(diagram.parentElement).toHaveClass('hidden');
    expect(within(inspector).getByRole('button', { name: 'Show diagram' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(inspector).getByRole('button', { name: 'Show diagram' }));
    expect(diagram.parentElement).not.toHaveClass('hidden');

    await user.click(within(inspector).getByRole('button', { name: /Inspect implementation/ }));
    expect(within(inspector).getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true');
    expect(diagram.parentElement).toHaveClass('hidden');
  });

  it('supports switching scenarios, previous/next navigation, and explicit non-execution labeling', async () => {
    const user = userEvent.setup();
    renderExplorer();
    const walkthrough = screen.getByRole('region', { name: 'Scenario walkthrough' });
    const inspector = screen.getByRole('region', { name: 'Inspector' });

    await user.click(screen.getByRole('button', { name: 'Successful job' }));
    expect(within(walkthrough).getByText('Job submitted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Successful job' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(walkthrough).getByRole('button', { name: 'Next step' }));
    expect(within(walkthrough).getByText('Waiting in queue')).toBeInTheDocument();
    await user.click(within(walkthrough).getByRole('button', { name: 'Previous step' }));
    expect(within(walkthrough).getByText('Job submitted')).toBeInTheDocument();
    expect(within(walkthrough).getByRole('button', { name: 'Previous step' })).toBeDisabled();

    expect(within(inspector).getByText(/not observed execution/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Worker crashes' }));
    expect(screen.getByRole('button', { name: 'Worker crashes' })).toHaveAttribute('aria-pressed', 'true');
  });
});
