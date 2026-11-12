// Engineering prototype walkthrough (handoff §5 steps 1–6 and reload) driven
// through the UI, using the REAL baseline evidence manifest captured from
// examples/event-queue at commit f354cf7 — not a synthetic one.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetPrototype } from '../lib/engineering/storage';
import { EngineeringPrototypePage } from './EngineeringPrototypePage';

const BASELINE_FILE = 'f354cf78ffad.json';
const BASELINE_SHA = 'f354cf78ffad2603f0860833fc724bf0199b104c';
const baselineText = readFileSync(resolve(__dirname, '../../examples/event-queue/evidence', BASELINE_FILE), 'utf8');

function renderPage(url = '/engineering') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/engineering" element={<EngineeringPrototypePage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(async () => {
  await resetPrototype();
});
afterEach(cleanup);

describe('EngineeringPrototypePage', () => {
  it('changes the delivery guarantee, shows derived obligations, approves against real baseline evidence, and survives reload', async () => {
    const user = userEvent.setup();
    renderPage();

    // Step 1: the delivery guarantee concept with its current contract and bound source.
    expect(await screen.findByRole('heading', { name: 'Delivery guarantee', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText('Jobs are removed when dispatched; no failure after dispatch is survived').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('binding-bind-delivery-dequeue')).getByText('Location unknown — no evidence imported')).toBeInTheDocument();

    // Step 2: import the real baseline evidence; EQ-C5 is recorded as failing at f354cf7.
    const input = screen.getByLabelText('Evidence manifest file');
    await user.upload(input, new File([baselineText], BASELINE_FILE, { type: 'application/json' }));
    const run = await screen.findByTestId(`run-${BASELINE_SHA.slice(0, 12)}`);
    expect(within(run).getByText('pinned')).toBeInTheDocument();
    expect(within(run).getByText(/6 passed · 1 failed/)).toBeInTheDocument();
    const dequeue = screen.getByTestId('binding-bind-delivery-dequeue');
    expect(within(dequeue).getByText('Observed, not yet confirmed')).toBeInTheDocument();

    // Step 3: edit the contract, not a file.
    await user.click(screen.getByRole('radio', { name: /Ack after processing/ }));
    await user.click(screen.getByRole('radio', { name: /Worker failure/ }));

    // Step 4: obligations derived live, with unknown impact called out.
    expect(await screen.findByTestId('obligation-worker.claim-ack-protocol')).toBeInTheDocument();
    expect(screen.getByTestId('obligation-retry.lease-fencing')).toBeInTheDocument();
    expect(screen.getByTestId('obligation-verify.EQ-C5')).toBeInTheDocument();
    expect(screen.queryByTestId('obligation-storage.durable-transitions')).not.toBeInTheDocument();
    expect(screen.getByText('Impact unknown')).toBeInTheDocument();

    // Scope matters: restart scope adds durability obligations.
    await user.click(screen.getByRole('radio', { name: /Queue process restart/ }));
    expect(await screen.findByTestId('obligation-storage.durable-transitions')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Worker failure/ }));

    await user.type(screen.getByLabelText('Rationale'), 'Workers crash in production; jobs must not vanish.');
    await user.click(screen.getByRole('button', { name: 'Save as draft change' }));

    // The model itself is unchanged by a draft.
    expect(screen.getAllByText('Jobs are removed when dispatched; no failure after dispatch is survived').length).toBeGreaterThan(0);

    // Step 5: approve against the pinned baseline revision.
    await user.click(await screen.findByRole('button', { name: 'Approve change' }));
    expect(await screen.findByText('approved')).toBeInTheDocument();

    // Step 6: deterministic handoff carries the real base sha and the real "before".
    const preview = screen.getByTestId('handoff-preview');
    expect(preview.textContent).toContain(`**Base revision:** \`${BASELINE_SHA}\``);
    expect(preview.textContent).toContain('| `EQ-C5` | An accepted job survives a worker failure before completion (queue process alive) | failed |');
    expect(preview.textContent).toContain(`npm run queue:evidence -- --base ${BASELINE_SHA}`);

    // Before → proposed → implemented → verified, before any implementation exists.
    const c5 = screen.getByTestId('criterion-EQ-C5');
    expect(within(c5).getByText('failed')).toBeInTheDocument();
    expect(within(c5).getByText('required')).toBeInTheDocument();
    expect(within(c5).getByText('unverified')).toBeInTheDocument();

    // Reload reconstructs the same state from IndexedDB.
    cleanup();
    renderPage('/engineering?concept=eq-retry');
    expect(await screen.findByRole('heading', { name: 'Retry + lease expiration', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(within(screen.getByTestId('binding-bind-retry-reap')).getByText('Not present at this revision')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-preview').textContent).toContain(BASELINE_SHA);
  });

  it('refuses re-importing the same evidence file and shows why', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText('Evidence manifest file');
    await user.upload(input, new File([baselineText], BASELINE_FILE));
    await screen.findByTestId(`run-${BASELINE_SHA.slice(0, 12)}`);
    await user.upload(screen.getByLabelText('Evidence manifest file'), new File([baselineText], BASELINE_FILE));
    expect(await screen.findByRole('alert')).toHaveTextContent('This exact evidence file was already imported');
  });
});
