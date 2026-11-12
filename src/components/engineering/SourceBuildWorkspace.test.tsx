import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearAllData } from '../../lib/db';
import { bundledEngineeringSources } from '../../lib/engineering/bundledSources';
import { createEngineeringExampleProjects, EVENT_QUEUE_PROJECT_ID, exampleConceptId } from '../../lib/engineering/demoProjects';
import { engineeringModelDb, installExampleTransitions, loadEngineeringModel } from '../../lib/engineering/modelStore';
import { SourceBuildWorkspace } from './SourceBuildWorkspace';

beforeEach(async () => {
  await clearAllData();
  await engineeringModelDb.proposals.clear();
  await engineeringModelDb.transitions.clear();
  await engineeringModelDb.sourceBindings.clear();
  await engineeringModelDb.codeRevisions.clear();
  await engineeringModelDb.codeWrites.clear();
  await createEngineeringExampleProjects();
  await installExampleTransitions(EVENT_QUEUE_PROJECT_ID);
});
afterEach(cleanup);

describe('shared coding workspace', () => {
  it('lets a human paste a full file, stage a revision, and see an honest model-linked status', async () => {
    const user = userEvent.setup();
    const model = await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID);
    const binding = model.sourceBindings.find((b) => b.targetId === exampleConceptId('event-queue', 'retry') && b.role === 'implementation')!;
    const originalText = bundledEngineeringSources[binding.path];
    render(<SourceBuildWorkspace model={model} binding={binding} originalText={originalText} targetName="Retry" />);
    const section = screen.getByRole('region', { name: 'Shared coding workspace' });
    expect(section).toHaveTextContent('Build through this model');
    await user.click(screen.getByRole('button', { name: 'Open editor' }));
    await user.type(screen.getByRole('textbox', { name: 'Engineering goal' }), 'Change retry behavior');
    fireEvent.change(screen.getByRole('textbox', { name: 'Editable source file' }), {
      target: { value: originalText + '\n// hand-written change\n' },
    });
    expect(screen.getByLabelText('Code change summary')).toHaveTextContent('Proposed source difference');
    await user.click(screen.getByRole('button', { name: 'Stage revision' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Revision staged locally');
    expect(section).toHaveTextContent('human revision: staged');
    expect((await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID)).codeRevisions).toHaveLength(1);
    expect((await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID)).codeWrites).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Apply staged file/ })).toBeDisabled();
  });

  it('generates a transparent ChatGPT agent handoff and stages its pasted code through the same protocol', async () => {
    const user = userEvent.setup();
    const model = await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID);
    const binding = model.sourceBindings.find((b) => b.targetId === exampleConceptId('event-queue', 'retry') && b.role === 'implementation')!;
    const originalText = bundledEngineeringSources[binding.path];
    render(<SourceBuildWorkspace model={model} binding={binding} originalText={originalText} targetName="Retry" />);
    await user.click(screen.getByRole('button', { name: 'Open editor' }));
    await user.click(screen.getByRole('button', { name: 'Agent result' }));
    await user.type(screen.getByRole('textbox', { name: 'Engineering goal' }), 'Implement bounded backoff');
    const handoff = screen.getByRole('textbox', { name: 'Agent handoff instructions' }) as HTMLTextAreaElement;
    expect(handoff.value).toContain('Goal: Implement bounded backoff');
    expect(handoff.value).toContain(binding.path);
    fireEvent.change(screen.getByRole('textbox', { name: 'Editable source file' }), {
      target: { value: originalText + '\n// agent-supplied change\n' },
    });
    await user.click(screen.getByRole('button', { name: 'Stage revision' }));
    await waitFor(async () => {
      const revisions = (await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID)).codeRevisions;
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({ actor: 'agent', providerId: 'chatgpt-handoff' });
    });
  });
});
