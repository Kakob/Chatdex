import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { bulkPutConversations, bulkPutMessages, clearAllData, createHumanProject } from '../lib/db';
import { createUnderstandingObject, getUnderstandingObject, putProjectAssociation, putUnderstandingProject } from '../lib/db/understanding';
import { putDecisionTrace } from '../lib/db/decisionTraces';
import { deriveAnchorsForConversation } from '../lib/investigation/anchors';
import { toMetaRecord } from '../lib/understanding/decisions/meta';
import { DecisionsPage } from './DecisionsPage';
import { DecisionDetailPage } from './DecisionDetailPage';
import type { ContentBlock } from '../types';

vi.mock('../lib/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/providers')>();
  return { ...actual, listReadyProviders: vi.fn(async () => ['anthropic']), complete: vi.fn() };
});
import { complete } from '../lib/providers';
const completeMock = vi.mocked(complete);

const now = new Date('2026-09-05T12:00:00Z');
const ROOT = '/Users/dev/chatdex';

async function seed() {
  const project = await createHumanProject({ name: 'Chatdex' });
  await bulkPutConversations([
    {
      id: 'sess-1', source: 'claude-code', name: 'project deletion session', summary: null,
      createdAt: now, updatedAt: now, importedAt: now,
      messageCount: 2, userMessageCount: 1, assistantMessageCount: 1, estimatedTokens: 10, fullText: '', projectPath: ROOT,
    },
  ]);
  const write: ContentBlock = {
    type: 'tool_use', toolName: 'Write', toolUseId: 't1',
    toolInput: { file_path: `${ROOT}/src/lib/db/projects.ts`, content: 'export async function deleteProject() {}\n' },
  };
  await bulkPutMessages([
    { id: 'm0', conversationId: 'sess-1', sender: 'user', text: 'Add project deletion. Deleting a project must not delete its conversations.', createdAt: now },
    { id: 'm1', conversationId: 'sess-1', sender: 'assistant', text: 'Deletion will be permanent with no audit record.', contentBlocks: [{ type: 'text', text: 'Deletion will be permanent with no audit record.' }, write], createdAt: new Date(now.getTime() + 1000) },
  ]);
  await putProjectAssociation({ id: 'a1', projectId: project.id, conversationId: 'sess-1', confidence: 1, origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
  const anchors = await deriveAnchorsForConversation('sess-1');

  const specified = await createUnderstandingObject({
    projectId: project.id, type: 'decision', title: 'Deleting a project keeps its conversations', body: 'Required by the user.',
    origin: 'ai', evidence: [{ conversationId: 'sess-1', messageIds: ['m0'] }], occurredAt: now,
    meta: toMetaRecord({ madeBy: 'user', basis: 'specified', unsupportedAutonomous: false, conflictsWithUserDirection: false, decidedAt: now.toISOString(), firstStepIndex: 0, primaryPath: 'src/lib/db/projects.ts', conversationId: 'sess-1', source: 'recovery', latestTraceId: 'dt-1', confidence: 0.9 }),
  });
  const invented = await createUnderstandingObject({
    projectId: project.id, type: 'decision', title: 'Deletion is permanent with no audit record <script>alert(1)</script>', body: 'Nobody asked.',
    origin: 'ai', evidence: [{ conversationId: 'sess-1', messageIds: ['m1'] }], occurredAt: now,
    meta: toMetaRecord({ madeBy: 'agent', basis: 'invented', unsupportedAutonomous: true, conflictsWithUserDirection: false, decidedAt: now.toISOString(), firstStepIndex: 1, primaryPath: 'src/lib/db/projects.ts', conversationId: 'sess-1', source: 'recovery', latestTraceId: 'dt-2', confidence: 0.7 }),
  });
  await putDecisionTrace({
    id: 'dt-2', projectId: project.id, decisionObjectId: invented.id, runId: 'run-1', repoKey: 'gh:Kakob/Chatdex', sha: 'a'.repeat(40),
    why: 'Nobody asked for recovery.',
    alternatives: [{ statement: 'Soft delete with undo', transcriptEvidence: [], rejectedBecause: 'unrequested' }],
    assumptions: [{ id: 'as-1', statement: 'No tombstone is needed', basis: 'inferred', transcriptEvidence: [{ conversationId: 'sess-1', messageId: 'm1', stepIndex: 1, role: 'agent_text', quote: 'permanent with no audit record', startOffset: 17, endOffset: 47 }], codeEvidence: [] }],
    transcriptEvidence: [{ conversationId: 'sess-1', messageId: 'm1', stepIndex: 1, role: 'agent_text', quote: 'permanent with no audit record', startOffset: 17, endOffset: 47 }],
    anchorStableKeys: anchors.map((a) => a.stableKey),
    implEvidence: [{ path: 'src/lib/db/projects.ts', startLine: 1, endLine: 1, quote: 'export async function deleteProject' }],
    symbols: ['deleteProject'], testPaths: [], invalidates: [], fetchedPaths: ['src/lib/db/projects.ts'],
    provider: 'anthropic', model: 'claude-opus-5', warnings: [], createdAt: now,
  });
  return { project, specified, invented };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:id/decisions" element={<DecisionsPage />} />
        <Route path="/projects/:id/decisions/:objectId" element={<DecisionDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(async () => {
  await clearAllData();
  completeMock.mockReset();
});

describe('DecisionsPage branch binding', () => {
  it('keeps the binding card reachable when bound and fills the ref from a session-commit chip', async () => {
    const user = userEvent.setup();
    const { project } = await seed();
    await putUnderstandingProject({
      ...project,
      repository: { owner: 'Kakob', repo: 'Chatdex', defaultBranch: 'main' },
    });
    // A session that committed on a branch — the case the chips serve.
    const bash: ContentBlock = { type: 'tool_use', toolName: 'Bash', toolUseId: 't2', toolInput: { command: 'git commit -m "feat: delete"' } };
    const result: ContentBlock = { type: 'tool_result', toolName: 'Bash', toolUseId: 't2', toolResult: '[demo/project-deletion 9987455] feat: delete' };
    await bulkPutMessages([
      { id: 'm2', conversationId: 'sess-1', sender: 'assistant', text: '', contentBlocks: [bash, result], createdAt: new Date(now.getTime() + 2000) },
    ]);
    renderAt(`/projects/${project.id}/decisions`);

    // The card used to vanish once a repo was bound.
    expect(await screen.findByLabelText('Change repository binding')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Change repository binding'));

    await user.click(await screen.findByRole('button', { name: '9987455 · demo/project-deletion' }));
    expect((screen.getByLabelText('Branch or ref') as HTMLInputElement).value).toBe('demo/project-deletion');
  });
});

describe('DecisionsPage', () => {
  it('renders decisions chronologically with basis badges, highlights only unsupported autonomous rows, escapes text, filters, and reviews', async () => {
    const user = userEvent.setup();
    const { project, invented } = await seed();
    renderAt(`/projects/${project.id}/decisions`);

    expect(await screen.findByText('Deleting a project keeps its conversations')).toBeInTheDocument();
    const list = within(screen.getByTestId('decision-list'));
    const rows = list.getAllByTestId('decision-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Specified')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Invented')).toBeInTheDocument();
    expect(list.getAllByTestId('unsupported-badge')).toHaveLength(1);
    expect(within(rows[1]).getByTestId('unsupported-badge')).toBeInTheDocument();
    expect(list.getByText(/no audit record <script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(within(rows[1]).getByText('1 assumption')).toBeInTheDocument();
    expect(within(rows[1]).getByText('1 edit')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: /project deletion session · 2/ })).toBeInTheDocument();
    // No `git commit` in this session, so no suggested sha line.
    expect(screen.queryByTestId('session-commits')).not.toBeInTheDocument();

    // Counts row doubles as basis filter.
    expect(within(screen.getByTestId('basis-counts')).getByText('1 invented')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1 unsupported autonomous' }));
    expect(screen.queryByText('Deleting a project keeps its conversations')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1 unsupported autonomous' }));

    // Group by file.
    await user.selectOptions(screen.getByLabelText('Group by'), 'path');
    expect(await screen.findByRole('heading', { level: 2, name: /src\/lib\/db\/projects\.ts · 2/ })).toBeInTheDocument();

    // Review flips state; nothing was preselected.
    const inventedRow = screen.getAllByTestId('decision-row').find((r) => r.getAttribute('data-decision-id') === invented.id)!;
    expect(within(inventedRow).getByText('pending')).toBeInTheDocument();
    await user.click(within(inventedRow).getByTitle('Accept'));
    await vi.waitFor(async () => {
      expect((await getUnderstandingObject(invented.id))?.reviewState).toBe('accepted');
    });
    await waitFor(() => expect(within(inventedRow).queryByText('pending')).not.toBeInTheDocument());
  });

  it('plans and discloses before any provider call, then runs recovery on confirm', async () => {
    const user = userEvent.setup();
    const { project } = await seed();
    renderAt(`/projects/${project.id}/decisions`);
    await screen.findByText('Deleting a project keeps its conversations');

    completeMock.mockResolvedValue({ text: JSON.stringify({ decisions: [], invalidates: [] }), model: 'test-model' });
    await user.click(screen.getByRole('button', { name: /Recover decisions/ }));

    const confirm = await screen.findByRole('button', { name: 'Send and recover' });
    expect(completeMock).not.toHaveBeenCalled();
    expect(screen.getByText(/1 edit hunk from 1 session/)).toBeInTheDocument();
    expect(screen.getByText(/Decision recovery/)).toBeInTheDocument();

    await user.click(confirm);
    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    const sent = completeMock.mock.calls[0][1].messages.map((m) => m.content).join('\n');
    expect(sent).toContain('<step index=0 role=user_msg>');
    expect(sent).toContain('EXISTING DECISIONS');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send and recover' })).not.toBeInTheDocument());
  });
});

describe('DecisionDetailPage', () => {
  it('shows why, alternatives, assumptions with bases, implemented-by edits, and evidence links', async () => {
    const { project, invented } = await seed();
    renderAt(`/projects/${project.id}/decisions/${invented.id}`);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Deletion is permanent with no audit record');
    const detail = within(screen.getByTestId('decision-detail'));
    expect(detail.getByTestId('unsupported-badge')).toBeInTheDocument();
    expect(detail.getByText('Nobody asked for recovery.')).toBeInTheDocument();
    expect(detail.getByText('Soft delete with undo')).toBeInTheDocument();
    const assumptions = within(detail.getByTestId('assumption-list'));
    expect(assumptions.getByText('No tombstone is needed')).toBeInTheDocument();
    expect(assumptions.getByText('Inferred')).toBeInTheDocument();
    const anchorsList = within(detail.getByTestId('implemented-by-anchors'));
    const anchorLink = anchorsList.getByRole('link', { name: /Write · step \d+ · .*projects\.ts/ });
    expect(anchorLink.getAttribute('href')).toMatch(new RegExp(`^/projects/${project.id}/investigate/`));
    expect(detail.getByText('src/lib/db/projects.ts L1')).toBeInTheDocument();
    expect(detail.getByRole('link', { name: /Open on GitHub/ })).toHaveAttribute('href', `https://github.com/Kakob/Chatdex/blob/${'a'.repeat(40)}/src/lib/db/projects.ts#L1`);
    const spanLinks = detail.getAllByRole('link', { name: /step 1 · agent/ });
    expect(spanLinks[0]).toHaveAttribute('href', '/conversations/sess-1?scrollTo=m1');
    expect(detail.getByText('deleteProject')).toBeInTheDocument();
  });
});
