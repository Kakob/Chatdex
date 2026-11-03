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
import { db } from '../lib/db/schema';
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
    await user.click(await screen.findByText('Repository connection and session commits'));
    expect(await screen.findByLabelText('Change repository binding')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Change repository binding'));

    await user.click(await screen.findByRole('button', { name: '9987455 · demo/project-deletion' }));
    expect((screen.getByLabelText('Branch or ref') as HTMLInputElement).value).toBe('demo/project-deletion');
  });
});

describe('DecisionsPage', () => {
  it('browses saved evidence, searches and groups without writes or provider calls, then reviews explicitly', async () => {
    const user = userEvent.setup();
    const { project, specified, invented } = await seed();
    const beforeObjects = await db.understandingObjects.toArray();
    const beforeTraces = await db.decisionTraces.toArray();
    const beforeEvents = await db.understandingEvents.toArray();
    renderAt(`/projects/${project.id}/decisions`);
    await screen.findByText('Deleting a project keeps its conversations');
    const rows = screen.getAllByTestId('decision-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-decision-id', specified.id);
    expect(within(rows[1]).getByText('Agent quote · Code evidence')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    await user.click(rows[0]);
    const panel = within(screen.getByRole('complementary', { name: 'Decision evidence' }));
    expect(panel.getByText('No trace quotes available for this record.')).toBeInTheDocument();
    expect(panel.getByRole('link', { name: /Open source/ })).toHaveAttribute('href', '/conversations/sess-1?scrollTo=m0');
    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    expect(panel.getByText('Nobody asked for recovery.')).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole('complementary')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(rows[1]).toHaveFocus();
    expect(panel.getAllByRole('link', { name: /step 1 · agent/ })[0]).toHaveAttribute('target', '_blank');
    await user.click(panel.getByText('Original classification and attribution'));
    expect(panel.getByText(/Basis: Invented/)).toBeInTheDocument();
    expect(panel.getByText(/Code edits alone do not establish rationale/)).toBeInTheDocument();
    await user.click(panel.getByText(/Recovery provenance and warnings/));
    await user.click(panel.getByText(/Code evidence ·/));
    expect(await panel.findByRole('link', { name: /Write · step/ })).toHaveAttribute('target', '_blank');
    expect(panel.getByText(/Recorded snapshot: gh:Kakob/)).toHaveTextContent('a'.repeat(40));
    await user.type(screen.getByRole('searchbox'), 'permanent with no audit');
    expect(screen.getAllByTestId('decision-row')).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText('Group by'), 'path');
    expect(screen.getByRole('heading', { name: 'src/lib/db/projects.ts' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByTestId('decision-row')).toHaveLength(2);
    expect(completeMock).not.toHaveBeenCalled();
    expect(await db.understandingObjects.toArray()).toEqual(beforeObjects);
    expect(await db.decisionTraces.toArray()).toEqual(beforeTraces);
    expect(await db.understandingEvents.toArray()).toEqual(beforeEvents);
    await user.click(panel.getByTitle('Accept'));
    await waitFor(async () => expect((await getUnderstandingObject(invented.id))?.reviewState).toBe('accepted'));
    expect(await db.decisionTraces.toArray()).toEqual(beforeTraces);
    expect(await db.understandingEvents.toArray()).toEqual(beforeEvents);
  });

  it('restores URL selection and filters, handles empty results, and bounds large lists', async () => {
    const user = userEvent.setup();
    const { project, invented } = await seed();
    for (let i = 0; i < 45; i++) {
      await createUnderstandingObject({ projectId: project.id, type: 'decision', title: `Extra candidate ${i}`, body: 'Historical choice', origin: 'user', evidence: [], occurredAt: now });
    }
    renderAt(`/projects/${project.id}/decisions?selected=${invented.id}&q=permanent&group=path`);
    await screen.findByText('Nobody asked for recovery.');
    expect(screen.getByRole('searchbox')).toHaveValue('permanent');
    expect(screen.getByLabelText('Group by')).toHaveValue('path');
    expect(screen.getAllByTestId('decision-row')).toHaveLength(1);
    await user.clear(screen.getByRole('searchbox'));
    expect(screen.getAllByTestId('decision-row')).toHaveLength(40);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getAllByTestId('decision-row')).toHaveLength(7);
    await user.type(screen.getByRole('searchbox'), 'not-in-any-record');
    expect(screen.queryAllByTestId('decision-row')).toHaveLength(0);
    expect(screen.getByText(/No candidates match/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByTestId('decision-row')).toHaveLength(40);
    expect(completeMock).not.toHaveBeenCalled();
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
