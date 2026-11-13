import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { clearAllData } from '../lib/db';
import { db } from '../lib/db/schema';
import { createHumanProject } from '../lib/db/understanding';
import { createEngineeringExampleProjects, EVENT_QUEUE_PROJECT_ID, TODO_LIST_PROJECT_ID } from '../lib/engineering/demoProjects';
import { analyzeTypeScript } from '../lib/engineering/core/analyzeTypeScript';
import { analyzeBoundProject } from '../lib/engineering/core/fromRepository';
import { SourceDerivedProjectPage } from './SourceDerivedProjectPage';

vi.mock('../lib/engineering/core/fromRepository', () => ({ analyzeBoundProject: vi.fn() }));
const analyzeMock = vi.mocked(analyzeBoundProject);
const sha = 'a'.repeat(40);
const sourceFile = {
  path: 'src/math.ts',
  text: 'export function add(a: number, b: number) {\n  return a + b;\n}\n',
};
const graph = analyzeTypeScript({ revision: sha, files: [sourceFile] });

beforeEach(async () => {
  await clearAllData();
  analyzeMock.mockReset();
});
afterEach(cleanup);

function route(projectId: string) {
  return render(
    <MemoryRouter initialEntries={['/projects/' + projectId + '/engineering/source']}>
      <Routes>
        <Route path="/projects/:id/engineering/source" element={<SourceDerivedProjectPage/>} />
        <Route path="/projects/:id" element={<p>Project overview</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('project source-derived engineering screen', () => {
  it('asks for explicit analysis, navigates real generated entities, and displays exact pinned source', async () => {
    const project = await createHumanProject({ name: 'A project without authored models' });
    await db.understandingProjects.update(project.id, {
      repository: { owner: 'Sample', repo: 'Arbitrary', defaultBranch: 'main' },
    });
    analyzeMock.mockResolvedValue({
      graph, sourceFiles: [sourceFile],
      coverage: {
        candidateCount: 1, eligibleCount: 1, selectedCount: 1, analyzedCount: 1,
        deniedCount: 0, excludedForLimit: 0, skipped: [], treeTruncated: false, partial: false,
      },
      repository: { owner: 'Sample', repo: 'Arbitrary', ref: 'main', sha },
    });
    const user = userEvent.setup();
    route(project.id);
    const controls = await screen.findByRole('region', { name: 'Repository source analysis controls' });
    expect(analyzeMock).not.toHaveBeenCalled(); // never transmit code or fetch on mount
    expect(within(controls).getByText(/Sample\/Arbitrary/)).toBeInTheDocument();
    await user.type(within(controls).getByRole('textbox', { name: 'Source folder scope' }), 'src/');
    await user.click(within(controls).getByRole('button', { name: 'Analyze repository source' }));
    expect(analyzeMock).toHaveBeenCalledWith(expect.objectContaining({ id: project.id }),
      expect.objectContaining({ prefix: 'src/' }));
    const modeled = await screen.findByLabelText('Generated source model');
    expect(within(modeled).getByText(/Source-derived · read-only/)).toBeInTheDocument();
    expect(within(modeled).getByText(/Analyzed 1 of 1 TypeScript files/)).toBeInTheDocument();
    const graphView = within(modeled).getByRole('region', { name: 'Visual source relationship graph' });
    expect(within(graphView).getByRole('button', { name: 'System map' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(graphView).getByRole('img', { name: 'Directed source relationships' })).toBeInTheDocument();
    await user.click(within(graphView).getByRole('button', { name: /Graph entity function add in src\/math\.ts/ }));
    const structure = within(modeled).getByRole('region', { name: 'Derived source structure' });
    await user.click(within(structure).getByRole('button', { name: /function add/ }));
    const inspector = within(modeled).getByRole('region', { name: 'Derived source inspector' });
    expect(within(inspector).getByRole('heading', { name: 'add' })).toBeInTheDocument();
    expect(within(inspector).getByText(/return a \+ b/)).toBeInTheDocument();
    expect(within(inspector).getByText(/src\/math.ts:1/)).toBeInTheDocument();
  });

  it.each([
    [EVENT_QUEUE_PROJECT_ID, 'EventQueue', 'class'],
    [TODO_LIST_PROJECT_ID, 'todoTransition', 'function'],
  ] as const)('analyzes bundled example %s with no repository binding', async (projectId, symbol, kind) => {
    await createEngineeringExampleProjects();
    const project = await db.understandingProjects.get(projectId);
    expect(project?.repository).toBeUndefined();
    const user = userEvent.setup();
    route(projectId);
    const controls = await screen.findByRole('region', { name: 'Bundled source analysis controls' });
    expect(within(controls).getByText(/Bundled (Todo List|Event Queue) source/)).toBeInTheDocument();
    expect(screen.queryByText(/no GitHub repository binding/)).not.toBeInTheDocument();
    expect(analyzeMock).not.toHaveBeenCalled();
    await user.click(within(controls).getByRole('button', { name: 'Analyze bundled source' }));

    const modeled = await screen.findByLabelText('Generated source model');
    expect(within(modeled).getByText(/shipped source snapshot \(not Git-pinned\)/)).toBeInTheDocument();
    expect(within(modeled).getByText(/Source-derived · read-only/)).toBeInTheDocument();
    const structure = within(modeled).getByRole('region', { name: 'Derived source structure' });
    await user.type(within(structure).getByRole('textbox', { name: 'Filter source entities' }), symbol);
    await user.click(within(structure).getByRole('button', { name: new RegExp(kind + ' ' + symbol) }));
    const inspector = within(modeled).getByRole('region', { name: 'Derived source inspector' });
    expect(within(inspector).getByRole('heading', { name: symbol })).toBeInTheDocument();
    expect(within(inspector).getByText(/Signature:/)).toBeInTheDocument();
    expect(analyzeMock).not.toHaveBeenCalled(); // GitHub was never consulted
  });

  it('offers repository binding rather than fabricating source when none exists', async () => {
    const project = await createHumanProject({ name: 'No repo yet' });
    route(project.id);
    expect(await screen.findByText(/no GitHub repository binding/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open project overview and bind a repository/ })).toHaveAttribute('href', '/projects/' + project.id);
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it('shows incomplete coverage instead of presenting a partial graph as the entire repository', async () => {
    const project = await createHumanProject({ name: 'Large project' });
    await db.understandingProjects.update(project.id, {
      repository: { owner: 'Sample', repo: 'Large', defaultBranch: 'main' },
    });
    analyzeMock.mockResolvedValue({
      graph, sourceFiles: [sourceFile],
      coverage: {
        candidateCount: 53, eligibleCount: 52, selectedCount: 40, analyzedCount: 1,
        deniedCount: 1, excludedForLimit: 12,
        skipped: [{ path: 'src/skip.ts', reason: 'error' }],
        treeTruncated: true, partial: true,
      },
      repository: { owner: 'Sample', repo: 'Large', ref: 'main', sha },
    });
    route(project.id);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Analyze repository source' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Partial model/);
    expect(screen.getByRole('alert')).toHaveTextContent(/repository tree was truncated/);
  });
});
