import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

  it('wraps source and test lines by default on mobile while preserving an opt-in unwrapped view', async () => {
    const user = userEvent.setup();
    renderExplorer();

    const diagram = screen.getByRole('group', { name: 'Event queue system diagram' });
    const inspector = screen.getByRole('region', { name: 'Inspector' });
    await user.click(within(diagram).getByRole('button', { name: 'Worker' }));
    await user.click(within(inspector).getByRole('tab', { name: 'Code' }));

    const codeViewport = within(inspector).getByTestId('source-viewport');
    expect(codeViewport).toHaveAttribute('data-wrap', 'on');
    expect(codeViewport).toHaveClass('overflow-x-hidden');
    expect(within(inspector).getByRole('button', { name: /Wrap lines/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(codeViewport).getByText(/export async function workOnce/)).toHaveClass('whitespace-pre-wrap');

    await user.click(within(inspector).getByRole('button', { name: /Wrap lines/ }));
    expect(codeViewport).toHaveAttribute('data-wrap', 'off');
    expect(codeViewport).toHaveClass('overflow-x-auto');
    expect(within(codeViewport).getByText(/export async function workOnce/)).toHaveClass('whitespace-pre');

    await user.click(within(inspector).getByRole('button', { name: /Wrap lines/ }));
    expect(codeViewport).toHaveAttribute('data-wrap', 'on');
    await user.click(within(inspector).getByRole('tab', { name: 'Tests' }));
    const testViewport = within(inspector).getByTestId('source-viewport');
    expect(testViewport).toHaveAttribute('data-wrap', 'on');
    expect(testViewport).toHaveClass('overflow-x-hidden');
  });

  it('steps through a worker failure and visually highlights the relevant components and transitions', async () => {
    const user = userEvent.setup();
    renderExplorer();

    const diagram = screen.getByRole('group', { name: 'Event queue system diagram' });
    const inspector = screen.getByRole('region', { name: 'Inspector' });
    await user.click(screen.getByRole('button', { name: 'Guided explanation' }));
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
    expect(diagram.parentElement?.parentElement).toHaveClass('hidden');
    expect(within(inspector).getByRole('button', { name: 'Show diagram' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(inspector).getByRole('button', { name: 'Show diagram' }));
    expect(diagram.parentElement?.parentElement).not.toHaveClass('hidden');

    await user.click(within(inspector).getByRole('button', { name: /Inspect implementation/ }));
    expect(within(inspector).getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true');
    expect(diagram.parentElement?.parentElement).toHaveClass('hidden');
  });

  it('shows live queue scheduling facts inside the selected Retry engineering entity', async () => {
    const user = userEvent.setup();
    renderExplorer();
    const diagram = screen.getByRole('group', { name: 'Event queue system diagram' });
    const inspector = screen.getByRole('region', { name: 'Inspector' });
    await user.click(within(diagram).getByRole('button', { name: 'Retry' }));
    const observed = within(inspector).getByRole('region', { name: 'Observed retry implementation' });
    expect(observed).toHaveTextContent('Initial retry backoff: 1000ms');
    expect(observed).toHaveTextContent('maximum attempts: 3');
    expect(observed).toHaveTextContent('ready: 0');
    expect(observed).toHaveTextContent('waiting: 0');
  });

  it('executes the real queue and highlights worker failure → lease expiry → retry → ack', async () => {
    const user = userEvent.setup();
    renderExplorer();
    const live = screen.getByRole('region', { name: 'Live queue controls' });
    const diagram = screen.getByRole('group', { name: 'Event queue system diagram' });
    expect(within(live).getByText(/Running actual EventQueue/)).toBeInTheDocument();
    await user.click(within(live).getByRole('button', { name: '+ Job' }));
    await waitFor(() => expect(live).toHaveTextContent('Pending: 1'));
    expect(diagram.querySelector('[data-edge="enqueue"]')).toHaveAttribute('data-highlighted', 'true');

    await user.click(within(live).getByRole('button', { name: 'Claim' }));
    await waitFor(() => expect(live).toHaveTextContent('Leased: 1'));
    await user.click(within(live).getByRole('button', { name: 'Fail worker' }));
    await waitFor(() => expect(live).toHaveTextContent('remains leased'));
    expect(live).toHaveTextContent('Leased: 1');

    await user.click(within(live).getByRole('button', { name: 'Advance clock' }));
    await waitFor(() => expect(live).toHaveTextContent('Waiting: 1'));
    expect(live).toHaveTextContent('Pending: 1');
    expect(within(live).getByRole('button', { name: 'Claim' })).toBeDisabled();
    expect(diagram.querySelector('[data-edge="requeue"]')).toHaveAttribute('data-highlighted', 'true');
    await user.click(within(live).getByRole('button', { name: 'Advance clock' }));
    await waitFor(() => expect(live).toHaveTextContent('Ready: 1'));

    await user.click(within(live).getByRole('button', { name: 'Claim' }));
    await waitFor(() => expect(live).toHaveTextContent('Leased: 1'));
    await user.click(within(live).getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(live).toHaveTextContent('Done: 1'));
    expect(diagram.querySelector('[data-edge="ack"]')).toHaveAttribute('data-highlighted', 'true');
  });

  it('supports switching scenarios, previous/next navigation, and explicit non-execution labeling', async () => {
    const user = userEvent.setup();
    renderExplorer();
    await user.click(screen.getByRole('button', { name: 'Guided explanation' }));
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
