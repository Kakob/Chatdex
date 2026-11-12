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
// Implemented outside Chatdex from the exported handoff (merge a59dbef).
const IMPLEMENTATION_FILE = '8f03376bb9d1.json';
const IMPLEMENTATION_SHA = '8f03376bb9d1fcdb6aa6ec30dffe403388977a8c';
const implementationText = readFileSync(resolve(__dirname, '../../examples/event-queue/evidence', IMPLEMENTATION_FILE), 'utf8');

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

  it('reconciles the real implementation evidence (8f03376): before/after, stale bindings, explicit acceptance, reload', async () => {
    const user = userEvent.setup();
    renderPage('/engineering?concept=eq-worker');
    await screen.findByRole('heading', { name: 'Worker / claim / process / ack', level: 1 });

    await user.upload(screen.getByLabelText('Evidence manifest file'), new File([baselineText], BASELINE_FILE));
    await screen.findByTestId(`run-${BASELINE_SHA.slice(0, 12)}`);
    // Pin workOnce to its baseline observation.
    await user.click(within(screen.getByTestId('binding-bind-worker-workonce')).getByRole('button', { name: /Confirm at f354cf78ffad/ }));
    expect(await within(screen.getByTestId('binding-bind-worker-workonce')).findByText('Confirmed at this revision')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Ack after processing/ }));
    await user.click(screen.getByRole('radio', { name: /Worker failure/ }));
    await user.click(screen.getByRole('button', { name: 'Save as draft change' }));
    await user.click(await screen.findByRole('button', { name: 'Approve change' }));
    await screen.findByText('approved');

    // A manifest built on another base is refused for the approved change.
    await user.selectOptions(screen.getByLabelText('Import as'), 'implementation');
    const wrongBase = JSON.stringify({ ...JSON.parse(implementationText), revision: { ...JSON.parse(implementationText).revision, baseSha: 'c'.repeat(40) } });
    await user.upload(screen.getByLabelText('Evidence manifest file'), new File([wrongBase], 'wrong.json'));
    expect(await screen.findByRole('alert')).toHaveTextContent('approved change starts from f354cf78ffad');

    await user.upload(screen.getByLabelText('Evidence manifest file'), new File([implementationText], IMPLEMENTATION_FILE));
    const run = await screen.findByTestId(`run-${IMPLEMENTATION_SHA.slice(0, 12)}`);
    expect(within(run).getByText(/24 passed · 0 failed/)).toBeInTheDocument();
    expect(within(run).getAllByText('agent-reported').length).toBeGreaterThan(0);

    // Before → proposed → implemented → verified, from two real manifests.
    const c5 = screen.getByTestId('criterion-EQ-C5');
    expect(within(c5).getByText('failed')).toBeInTheDocument();
    expect(within(c5).getByText('passed')).toBeInTheDocument();
    expect(within(c5).getByText('supported')).toBeInTheDocument();
    const c6 = screen.getByTestId('criterion-EQ-C6');
    expect(within(c6).getByText('not required')).toBeInTheDocument();
    expect(within(c6).getByText('unverified')).toBeInTheDocument();

    // Bindings move to the new revision without silently becoming current.
    expect(within(screen.getByTestId('binding-bind-worker-workonce')).getByText(/Stale — confirmed at an older revision · text changed/)).toBeInTheDocument();
    expect(within(screen.getByTestId('binding-bind-worker-claim')).getByText('Observed, not yet confirmed')).toBeInTheDocument();

    // Explicit acceptance creates contract v2 and resolves the refuted limitation.
    await user.click(screen.getByRole('button', { name: /Accept new understanding at 8f03376bb9d1/ }));
    cleanup();
    renderPage('/engineering?concept=eq-delivery');
    expect(await screen.findByRole('heading', { name: 'Delivery guarantee', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getAllByText(/survive worker failure while the queue process runs/).length).toBeGreaterThan(0);
    expect(screen.getByText(/all required criteria supported/)).toBeInTheDocument();
    expect(screen.getByText('Jobs are removed when dispatched; no failure after dispatch is survived')).toHaveClass('line-through');
    expect(screen.getByText('A job is lost if its worker fails after receiving it and before completing')).toHaveClass('line-through');
    expect(within(screen.getByTestId('binding-bind-delivery-dequeue')).getByText('Not present at this revision')).toBeInTheDocument();
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
