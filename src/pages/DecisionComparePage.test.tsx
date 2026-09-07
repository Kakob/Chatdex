import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { clearAllData, db, putUnderstandingProject } from '../lib/db';
import { createUnderstandingObject, getEventsForObject } from '../lib/db/understanding';
import { putDecisionTrace } from '../lib/db/decisionTraces';
import { DecisionComparePage } from './DecisionComparePage';
import type { DecisionTrace, TranscriptSpan } from '../types/decision';

const now = new Date('2026-09-07T10:00:00Z');
const later = new Date('2026-09-07T11:00:00Z');
const span: TranscriptSpan = { conversationId: 'c1', messageId: 'm1', stepIndex: 1, role: 'agent_text', quote: 'permanent', startOffset: 0, endOffset: 9 };

function trace(objectId: string, runId: string, createdAt: Date, overrides: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    id: `${objectId}@${runId}`, projectId: 'p1', decisionObjectId: objectId, runId, sha: runId === 'run-1' ? 'a'.repeat(40) : 'b'.repeat(40),
    why: 'because', alternatives: [], assumptions: [], transcriptEvidence: [span], anchorStableKeys: [], implEvidence: [], symbols: [], testPaths: [],
    invalidates: [], fetchedPaths: [], provider: 'anthropic', model: 'm', warnings: [], createdAt, ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/p1/decisions/compare']}>
      <Routes>
        <Route path="/projects/:id/decisions/compare" element={<DecisionComparePage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(async () => {
  await clearAllData();
  await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
  await db.conversations.put({ id: 'c1', source: 'claude-code', name: 'session one', summary: null, createdAt: now, updatedAt: now, importedAt: now, messageCount: 0, userMessageCount: 0, assistantMessageCount: 0, estimatedTokens: 0, fullText: '' });
});

describe('DecisionComparePage', () => {
  it('asks for two runs when only one exists', async () => {
    const d = await createUnderstandingObject({ projectId: 'p1', type: 'decision', title: 'Only', origin: 'user', evidence: [], occurredAt: now });
    await putDecisionTrace(trace(d.id, 'run-1', now));
    renderPage();
    expect(await screen.findByText(/Two recovery runs are needed/)).toBeInTheDocument();
  });

  it('defaults to the two newest runs, groups entries by op, and records an invalidation as a user event', async () => {
    const user = userEvent.setup();
    const kept = await createUnderstandingObject({ projectId: 'p1', type: 'decision', title: 'Kept decision', origin: 'user', evidence: [], occurredAt: now });
    const killed = await createUnderstandingObject({ projectId: 'p1', type: 'decision', title: 'Deletion is permanent', origin: 'user', evidence: [], occurredAt: now });
    const fresh = await createUnderstandingObject({ projectId: 'p1', type: 'decision', title: 'Deletion is recoverable for 30 days', origin: 'user', evidence: [], occurredAt: now });
    await putDecisionTrace(trace(kept.id, 'run-1', now));
    await putDecisionTrace(trace(killed.id, 'run-1', now));
    await putDecisionTrace(trace(kept.id, 'run-2', later, { why: 'because, revised' }));
    await putDecisionTrace(trace(fresh.id, 'run-2', later, { invalidates: [{ decisionObjectId: killed.id, evidence: [span], codeEvidence: [] }] }));

    renderPage();
    const counts = await screen.findByTestId('diff-counts');
    expect(within(counts).getByText('1 new decision')).toBeInTheDocument();
    expect(within(counts).getByText('1 revised')).toBeInTheDocument();
    expect(within(counts).getByText('1 invalidated')).toBeInTheDocument();
    expect(within(counts).getByText('0 unresolved')).toBeInTheDocument();
    expect((screen.getByLabelText('From run') as HTMLSelectElement).value).toBe('run-1');
    expect((screen.getByLabelText('To run') as HTMLSelectElement).value).toBe('run-2');

    expect(within(screen.getByTestId('diff-group-new_decision')).getByText('Deletion is recoverable for 30 days')).toBeInTheDocument();
    expect(within(screen.getByTestId('diff-group-revised')).getByText('Changed: why')).toBeInTheDocument();
    const invalidated = within(screen.getByTestId('diff-group-invalidated'));
    expect(invalidated.getByText('Deletion is permanent')).toBeInTheDocument();
    expect(invalidated.getByRole('link', { name: /session one · step 1 · agent/ })).toHaveAttribute('href', '/conversations/c1?scrollTo=m1');

    await user.click(invalidated.getByRole('button', { name: 'Record as contradicted' }));
    await waitFor(async () => {
      const ops = (await getEventsForObject(killed.id)).map((e) => e.op);
      expect(ops).toEqual(['introduced', 'contradicted']);
    });
    expect(await db.decisionDiffs.count()).toBe(1);
  });
});
