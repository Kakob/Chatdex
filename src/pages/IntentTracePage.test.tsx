import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { bulkPutConversations, bulkPutMessages, clearAllData, createHumanProject, db } from '../lib/db';
import { createUnderstandingObject, getUnderstandingObject, putUnderstandingProject } from '../lib/db/understanding';
import { putIntentTrace } from '../lib/db/intentTraces';
import { IntentTracePage } from './IntentTracePage';

vi.mock('../lib/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/providers')>();
  return { ...actual, listReadyProviders: vi.fn(async () => ['anthropic']), complete: vi.fn() };
});

const now = new Date('2026-08-20T12:00:00Z');
const SHA = 'a'.repeat(40);

async function seedProject() {
  const project = await createHumanProject({ name: 'Chatdex' });
  await bulkPutConversations([
    {
      id: 'conv-1', source: 'claude.ai', name: 'Badge chat', summary: null,
      createdAt: now, updatedAt: now, importedAt: now,
      messageCount: 2, userMessageCount: 1, assistantMessageCount: 1, estimatedTokens: 10, fullText: '',
    },
  ]);
  await bulkPutMessages([
    { id: 'm-0', conversationId: 'conv-1', sender: 'assistant', text: 'Amber or violet?', createdAt: now },
    { id: 'm-1', conversationId: 'conv-1', sender: 'user', text: 'Amber, and only over zero.', createdAt: new Date(now.getTime() + 1000) },
  ]);
  const reply = await createUnderstandingObject({
    projectId: project.id, type: 'intent', title: 'Amber badge over zero', body: 'Amber, and only over zero.',
    origin: 'ai', evidence: [{ conversationId: 'conv-1', messageIds: ['m-0', 'm-1'] }], occurredAt: now,
    meta: { polarity: 'want', origin: 'response_to_ai', statedAt: now.toISOString() },
  });
  const unprompted = await createUnderstandingObject({
    projectId: project.id, type: 'intent', title: 'Never auto-accept', body: 'never auto-accept anything <script>alert(1)</script>',
    origin: 'ai', evidence: [{ conversationId: 'conv-1', messageIds: ['m-1'] }], occurredAt: now,
    meta: { polarity: 'constraint', origin: 'unprompted', statedAt: new Date(now.getTime() - 60_000).toISOString() },
  });
  await putIntentTrace({
    id: 't-1', projectId: project.id, intentObjectId: reply.id,
    repoRef: { owner: 'Kakob', repo: 'Chatdex', commitSha: SHA, ref: 'main' },
    specStatus: 'no_spec', specEvidence: [],
    implStatus: 'implemented', implEvidence: [{ path: 'src/Sidebar.tsx', startLine: 4, endLine: 5, quote: '<Badge count={pending} />' }],
    implRationale: 'Badge rendered.', suggestedPaths: ['src/pendingReviews.ts'],
    fetchedPaths: ['src/Sidebar.tsx'], provider: 'anthropic', model: 'claude-opus-5', warnings: [], createdAt: now,
  });
  return { project, reply, unprompted };
}

function renderPage(projectId: string) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[`/projects/${projectId}/intents`]}>
      <Routes>
        <Route path="/projects/:id/intents" element={<IntentTracePage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(async () => {
  await clearAllData();
});

describe('IntentTracePage', () => {
  it('renders intents with origin/polarity chips and statuses, escapes quotes, and links verified evidence', async () => {
    const user = userEvent.setup();
    const { project } = await seedProject();
    renderPage(project.id);

    expect(await screen.findByText('Amber badge over zero')).toBeInTheDocument();
    const matrix = within(screen.getByTestId('intent-matrix'));
    expect(matrix.getByText('Never auto-accept')).toBeInTheDocument();
    expect(matrix.getByText('Reply to AI')).toBeInTheDocument();
    expect(matrix.getByText('Unprompted')).toBeInTheDocument();
    expect(matrix.getByText('constraint')).toBeInTheDocument();
    expect(matrix.getByText('implemented')).toBeInTheDocument();
    expect(matrix.getAllByText('not traced')).toHaveLength(2);
    // The <script> in the body is text, not markup.
    expect(matrix.getByText(/never auto-accept anything <script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();

    // Trace is disabled without a repository binding; the binding card shows.
    expect(screen.getByRole('button', { name: /Trace against repo/ })).toBeDisabled();
    expect(screen.getByLabelText('Repository')).toBeInTheDocument();

    // Expand evidence: blob link built from the validated builder.
    await user.click(matrix.getByRole('button', { name: /evidence/ }));
    const link = await matrix.findByRole('link', { name: /src\/Sidebar\.tsx L4–L5/ });
    expect(link).toHaveAttribute('href', `https://github.com/Kakob/Chatdex/blob/${SHA}/src/Sidebar.tsx#L4-L5`);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(matrix.getByText('<Badge count={pending} />')).toBeInTheDocument();
    expect(matrix.getByText(/Not checked: src\/pendingReviews\.ts/)).toBeInTheDocument();
  });

  it('filters by origin and flips review state', async () => {
    const user = userEvent.setup();
    const { project, unprompted } = await seedProject();
    renderPage(project.id);
    await screen.findByText('Amber badge over zero');

    await user.selectOptions(screen.getByLabelText('Origin filter'), 'unprompted');
    expect(screen.queryByText('Amber badge over zero')).not.toBeInTheDocument();
    expect(screen.getByText('Never auto-accept')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();

    const row = screen.getByText('Never auto-accept').closest('div.rounded-xl') as HTMLElement;
    await user.click(within(row).getByTitle('Accept'));
    await vi.waitFor(async () => {
      expect((await getUnderstandingObject(unprompted.id))?.reviewState).toBe('accepted');
    });
    await waitFor(() => expect(within(row).queryByText('pending')).not.toBeInTheDocument());
  });

  it('renders no link for a malformed repository owner in a stored trace', async () => {
    const user = userEvent.setup();
    const { project, reply } = await seedProject();
    await putIntentTrace({
      id: 't-bad', projectId: project.id, intentObjectId: reply.id,
      repoRef: { owner: 'evil host', repo: 'x', commitSha: SHA },
      specStatus: 'no_spec', specEvidence: [],
      implStatus: 'partial', implEvidence: [{ path: 'src/a.ts', startLine: 1, endLine: 1, quote: 'x' }],
      fetchedPaths: ['src/a.ts'], provider: 'anthropic', model: 'm', warnings: [], createdAt: new Date(now.getTime() + 5000),
    });
    renderPage(project.id);
    await screen.findByText('Amber badge over zero');
    const matrix = within(screen.getByTestId('intent-matrix'));
    expect(matrix.getByText('partial')).toBeInTheDocument();
    await user.click(matrix.getByRole('button', { name: /evidence/ }));
    expect(matrix.queryByRole('link', { name: /src\/a\.ts/ })).not.toBeInTheDocument();
    expect(matrix.getByText(/src\/a\.ts L1/)).toBeInTheDocument();
  });

  it('enables Trace when a repository is bound and shows the last traced commit', async () => {
    const { project } = await seedProject();
    await putUnderstandingProject({ ...(await db.understandingProjects.get(project.id))!, repository: { owner: 'Kakob', repo: 'Chatdex', defaultBranch: 'main', pinnedRef: 'v1' } });
    renderPage(project.id);
    await screen.findByText('Amber badge over zero');
    expect(screen.getByRole('button', { name: /Trace against repo/ })).toBeEnabled();
    expect(screen.getByText(/Last traced against/)).toBeInTheDocument();
    expect(screen.getByText(`Kakob/Chatdex@${SHA.slice(0, 7)}`)).toBeInTheDocument();
  });
});
