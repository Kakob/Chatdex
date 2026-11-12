import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngineeringExampleProjects, EVENT_QUEUE_PROJECT_ID, TODO_LIST_PROJECT_ID } from '../../lib/engineering/demoProjects';
import { clearAllData } from '../../lib/db';
import { engineeringModelDb, installExampleTransitions } from '../../lib/engineering/modelStore';
import { ModelInspector } from './ModelInspector';
import { useExampleEngineeringModel } from '../../lib/engineering/useEngineeringModel';

function Editor({ projectId, kind, nodeId }: {
  projectId: string;
  kind: 'event-queue' | 'todo-list';
  nodeId: string;
}) {
  const { model, refresh } = useExampleEngineeringModel(projectId);
  return <ModelInspector kind={kind} projectId={projectId} nodeId={nodeId} model={model} onRefresh={refresh} />;
}

beforeEach(async () => {
  await clearAllData();
  await engineeringModelDb.proposals.clear();
  await engineeringModelDb.transitions.clear();
  await createEngineeringExampleProjects();
  await installExampleTransitions(EVENT_QUEUE_PROJECT_ID);
  await installExampleTransitions(TODO_LIST_PROJECT_ID);
});
afterEach(cleanup);

describe('shared model inspector', () => {
  it('supports proposals, reload, immutable current wording, revision history, and withdrawal on Todo List', async () => {
    const user = userEvent.setup();
    const ui = render(<Editor projectId={TODO_LIST_PROJECT_ID} kind="todo-list" nodeId="active" />);
    const model = await screen.findByRole('region', { name: 'Persistent engineering model' });
    expect(await within(model).findByText('Active tasks')).toBeInTheDocument();

    await user.click(within(model).getByRole('button', { name: 'Propose model edit' }));
    await user.clear(within(model).getByRole('textbox', { name: 'Proposed name' }));
    await user.type(within(model).getByRole('textbox', { name: 'Proposed name' }), 'Ready for work');
    await user.click(within(model).getByRole('button', { name: 'Save model proposal' }));
    expect(await within(model).findByText('Ready for work')).toBeInTheDocument();
    expect(within(model).getByText('Active tasks')).toBeInTheDocument();
    expect(within(model).getByText(/not implemented or verified/)).toBeInTheDocument();

    ui.unmount();
    render(<Editor projectId={TODO_LIST_PROJECT_ID} kind="todo-list" nodeId="active" />);
    const loaded = await screen.findByRole('region', { name: 'Persistent engineering model' });
    expect(await within(loaded).findByText('Ready for work')).toBeInTheDocument();
    await user.click(within(loaded).getByText('Model revision history (1)'));
    expect(within(loaded).getByText(/#1 · Proposed/)).toBeInTheDocument();

    await user.click(within(loaded).getByRole('button', { name: 'Withdraw draft' }));
    await waitFor(() => expect(within(loaded).queryByText('Ready for work')).not.toBeInTheDocument());
    await user.click(await within(loaded).findByText('Model revision history (2)'));
    expect(within(loaded).getByText(/#2 · Withdrawn/)).toBeInTheDocument();
  });

  it('allows editing a connected transition without changing its actual implementation', async () => {
    const user = userEvent.setup();
    render(<Editor projectId={EVENT_QUEUE_PROJECT_ID} kind="event-queue" nodeId="leased" />);
    const section = await screen.findByRole('region', { name: 'Persistent engineering model' });
    await user.click(await within(section).findByText(/Connected transitions/));
    await user.click(within(section).getByRole('button', { name: /Pending → leased/ }));
    expect(within(section).getByText('Pending → leased')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Propose model edit' }));
    await user.clear(within(section).getByRole('textbox', { name: 'Proposed name' }));
    await user.type(within(section).getByRole('textbox', { name: 'Proposed name' }), 'Pending → leased under validation');
    await user.click(within(section).getByRole('button', { name: 'Save model proposal' }));
    expect(await within(section).findByText('Pending → leased under validation')).toBeInTheDocument();
    expect(within(section).getByText(/not implemented or verified/)).toBeInTheDocument();
  });
});
