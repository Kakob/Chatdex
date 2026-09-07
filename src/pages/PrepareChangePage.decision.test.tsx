// SPEC-decision-recovery §11.3: `?decision=<id>` seeds the replacement
// workspace once and then opens it; a second visit reuses it.
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { clearAllData, db, putUnderstandingProject } from '../lib/db';
import { createUnderstandingObject } from '../lib/db/understanding';
import { toMetaRecord } from '../lib/understanding/decisions/meta';
import { PrepareChangePage } from './PrepareChangePage';

const now = new Date('2026-09-07T00:00:00Z');

function renderPage(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/p1/prepare${search}`]}>
      <Routes>
        <Route path="/projects/:id/prepare" element={<PrepareChangePage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(async () => {
  await clearAllData();
  await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
  await db.conversations.put({ id: 'sess-1', source: 'claude-code', name: 's', summary: null, createdAt: now, updatedAt: now, importedAt: now, messageCount: 0, userMessageCount: 0, assistantMessageCount: 0, estimatedTokens: 0, fullText: '' });
});

describe('PrepareChangePage ?decision=', () => {
  it('seeds a replacement workspace from the decision and opens it; a second visit reuses it', async () => {
    const decision = await createUnderstandingObject({
      projectId: 'p1', type: 'decision', title: 'Deletion is permanent', body: 'Nobody asked.',
      origin: 'ai', evidence: [{ conversationId: 'sess-1', messageIds: ['m1'] }], occurredAt: now,
      meta: toMetaRecord({ madeBy: 'agent', basis: 'invented', unsupportedAutonomous: true, conflictsWithUserDirection: false, primaryPath: '', source: 'recovery' }),
    });
    const { unmount } = renderPage(`?decision=${decision.id}`);
    await waitFor(() => expect(screen.getByTestId('rail-intent')).toBeTruthy());
    expect(await screen.findByText('Replace: Deletion is permanent')).toBeInTheDocument();
    await waitFor(async () => expect(await db.preparedChanges.count()).toBe(1));
    const stored = (await db.preparedChanges.toArray())[0];
    expect(stored.originRef).toEqual({ kind: 'decision', id: decision.id });
    expect(stored.understandingPointIds).toEqual([]);
    unmount();

    renderPage(`?decision=${decision.id}`);
    await waitFor(() => expect(screen.getByTestId('rail-intent')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.preparedChanges.count()).toBe(1);
  });
});
