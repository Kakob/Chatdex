import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { clearAllData } from '../lib/db';
import { db } from '../lib/db/schema';
import { createHumanProject } from '../lib/db/understanding';
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
    expect(within(controls).getByText('Sample/Arbitrary')).toBeInTheDocument();
    await user.type(within(controls).getByRole('textbox', { name: /Folder or file to analyze/ }), 'src/');
    await user.click(within(controls).getByRole('button', { name: 'Analyze repository source' }));
    expect(analyzeMock).toHaveBeenCalledWith(expect.objectContaining({ id: project.id }),
      expect.objectContaining({ prefix: 'src/' }));
    const modeled = await screen.findByLabelText('Generated source model');
    expect(within(modeled).getByText(/Source-derived · read-only/)).toBeInTheDocument();
    expect(within(modeled).getByText(/Analyzed 1 of 1 TypeScript files/)).toBeInTheDocument();
    const structure = within(modeled).getByRole('region', { name: 'Derived source structure' });
    await user.click(within(structure).getByRole('button', { name: /function add/ }));
    const inspector = within(modeled).getByRole('region', { name: 'Derived source inspector' });
    expect(within(inspector).getByRole('heading', { name: 'add' })).toBeInTheDocument();
    expect(within(inspector).getByText(/return a \+ b/)).toBeInTheDocument();
    expect(within(inspector).getByText(/src\/math.ts:1/)).toBeInTheDocument();
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
