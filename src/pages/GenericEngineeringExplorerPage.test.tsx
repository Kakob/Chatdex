import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { clearAllData, db } from '../lib/db';
import { createHumanProject } from '../lib/db/understanding';
import { putRepoFiles } from '../lib/db/repoFiles';
import { engineeringModelDb, createModelRelationship, createModelSourceBinding } from '../lib/engineering/modelStore';
import { EngineeringProjectPage } from './EngineeringProjectPage';

beforeEach(async () => {
  await clearAllData();
  await engineeringModelDb.transitions.clear();
  await engineeringModelDb.proposals.clear();
  await engineeringModelDb.sourceBindings.clear();
});
afterEach(cleanup);

describe('generic engineering project Explorer', () => {
  it('shows a third project with hierarchy, shared model edits, and a repository-indexed code inspector', async () => {
    const project = await createHumanProject({ name: 'Chatdex internals' });
    const now = new Date();
    for (const [index, node] of [
      { id: 'project', parent: null, title: 'Project root' },
      { id: 'explorer', parent: 'project', title: 'Explorer renderer' },
      { id: 'model', parent: 'project', title: 'Model store' },
    ].entries()) {
      await db.landscapeRegions.add({
        id: node.id, projectId: project.id, parentRegionId: node.parent,
        title: node.title, summary: 'Authored ' + node.title,
        kind: 'component', order: index, memberObjectIds: [], pinnedObjectIds: [],
        createdAt: now, updatedAt: now,
      });
    }
    await createModelRelationship({
      projectId: project.id, fromConceptId: 'explorer', toConceptId: 'model',
      kind: 'depends_on', title: 'Loads model', description: 'Read-only projection dependency',
    });
    const sha = 'a'.repeat(40);
    await createModelSourceBinding({
      projectId: project.id, targetId: 'explorer', role: 'implementation',
      repoKey: 'gh:Kakob/Chatdex', sourceKind: 'indexed',
      sha, path: 'src/components/engineering/ModelInspector.tsx',
      needle: 'export function ModelInspector', label: 'Inspector source', origin: 'manual',
    });
    await putRepoFiles([{
      repoKey: 'gh:Kakob/Chatdex', sha, path: 'src/components/engineering/ModelInspector.tsx',
      content: 'export function ModelInspector() { return null; }',
      size: 50, fetchedAt: now,
    }]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/projects/' + project.id + '/engineering']}>
        <Routes>
          <Route path="/projects/:id/engineering" element={<EngineeringProjectPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const structure = await screen.findByRole('region', { name: 'Generic engineering structure' });
    const inspector = screen.getByRole('region', { name: 'Generic engineering inspector' });
    expect(within(structure).getByRole('button', { name: /Project root/ })).toBeInTheDocument();
    await user.click(within(structure).getByRole('button', { name: /Explorer renderer/ }));
    expect(within(inspector).getByRole('heading', { name: 'Explorer renderer' })).toBeInTheDocument();
    const modelPanel = await within(inspector).findByRole('region', { name: 'Persistent engineering model' });
    await user.click(within(modelPanel).getByText(/Connected transitions/));
    expect(within(modelPanel).getByRole('button', { name: /Loads model/ })).toBeInTheDocument();
    await user.click(within(modelPanel).getByRole('button', { name: 'Propose model edit' }));
    await user.clear(within(modelPanel).getByRole('textbox', { name: 'Proposed name' }));
    await user.type(within(modelPanel).getByRole('textbox', { name: 'Proposed name' }), 'Living Explorer');
    await user.click(within(modelPanel).getByRole('button', { name: 'Save model proposal' }));
    expect(await within(structure).findByRole('button', { name: /Living Explorer/ })).toHaveAttribute('data-model-id', 'explorer');
    expect(within(inspector).getByText(/Proposed only/)).toBeInTheDocument();

    await user.click(within(inspector).getByRole('tab', { name: 'Code' }));
    expect(await within(inspector).findByText(/export function ModelInspector/)).toBeInTheDocument();
    expect(within(inspector).getByText(/Indexed at/)).toBeInTheDocument();
    expect(within(inspector).getByRole('link', { name: /Open pinned code/ })).toHaveAttribute('href',
      'https://github.com/Kakob/Chatdex/blob/' + sha + '/src/components/engineering/ModelInspector.tsx#L1');
  });

  it('shows an honest empty-state for a project without inferred code', async () => {
    const project = await createHumanProject({ name: 'Undiscovered project' });
    render(
      <MemoryRouter initialEntries={['/projects/' + project.id + '/engineering']}>
        <Routes><Route path="/projects/:id/engineering" element={<EngineeringProjectPage />} /></Routes>
      </MemoryRouter>,
    );
    const structure = await screen.findByRole('region', { name: 'Generic engineering structure' });
    expect(within(structure).getByText(/No modeled components yet/)).toBeInTheDocument();
    expect(screen.getByText(/does not have an executable engineering adapter/)).toBeInTheDocument();
  });
});
