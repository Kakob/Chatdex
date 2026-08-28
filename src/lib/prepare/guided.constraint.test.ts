// Guided constraint test (SPEC-change-workspace §16 CW-6, law §2.7 / D5).
// A full Guided walkthrough — index → search → evidence → trace → hypothesis
// → implementation → verification → learned → promote → question → close →
// history lookups — with network allowed ONLY to https://api.github.com.
// Any request to the LLM relay (or anywhere else) fails the test.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bulkPutConversations, bulkPutMessages, clearAllData, db, putUnderstandingProject } from '../db';
import { putProjectAssociation } from '../db/understanding';
import { createGitHubSource } from '../repo/githubSource';
import { ensureIndexed } from '../repo/index';
import { buildCodeEvidence, findReferences, grep } from '../repo/search';
import { listRepoFiles } from '../db/repoFiles';
import { createPreparedChange, markPreparedChangeReady, updatePreparedChangeDraft } from './changes';
import { addEvidenceItems, addHypothesis, attachImplementation, closeWorkspace, markVerified, updateLearned, updateTrace, updateVerificationRow } from './lifecycle';
import { implementationFromPastedDiff } from './implementation';
import { manualObservationEvidence } from './verification';
import { createWorkspaceQuestion, promoteFromWorkspace } from './promote';
import { commitsTouchingPath, findRelatedConversations } from './guided';
import { deriveEdgeVerification } from './trace';

const requests: string[] = [];
let realFetch: typeof fetch;
const SHA = 'a'.repeat(40);
const now = new Date('2026-08-28T00:00:00Z');

function githubOnlyFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (!url.startsWith('https://api.github.com/')) {
      throw new Error(`network to ${url} is forbidden in Guided mode`);
    }
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/git/trees/')) {
      return json({ truncated: false, tree: [{ path: 'src/pages/SearchPage.tsx', type: 'blob', size: 60, sha: 'b1' }, { path: '.env', type: 'blob', size: 5, sha: 'b2' }] });
    }
    if (url.includes('/contents/')) {
      return json({ type: 'file', size: 60, sha: 'b1', encoding: 'base64', content: btoa('export function handleResultClick() {\n  navigate(id);\n}\n') });
    }
    if (url.includes('/commits')) {
      return json([{ sha: 'c'.repeat(40), html_url: 'https://github.com/Kakob/Chatdex/commit/c', commit: { message: 'feat: search nav', author: { date: '2026-08-27T09:00:00Z' } } }]);
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

beforeEach(async () => {
  await clearAllData();
  requests.length = 0;
  realFetch = globalThis.fetch;
  globalThis.fetch = githubOnlyFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Guided mode makes no provider call (law §2.7)', () => {
  it('walks the whole loop touching only api.github.com', async () => {
    await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', repository: { owner: 'Kakob', repo: 'Chatdex' }, createdAt: now, updatedAt: now });
    await bulkPutConversations([{ id: 'conv-1', source: 'claude-code', name: 'nav fix', summary: null, createdAt: now, updatedAt: now, importedAt: now, messageCount: 1, userMessageCount: 1, assistantMessageCount: 0, estimatedTokens: 5, fullText: 'we touched handleResultClick here' }]);
    await bulkPutMessages([{ id: 'm1', conversationId: 'conv-1', sender: 'user', text: 'we touched handleResultClick here', createdAt: now }]);
    await putProjectAssociation({ id: 'assoc-1', projectId: 'p1', conversationId: 'conv-1', confidence: 1, origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });

    // Index + search through the read-only client (global fetch = our github-only stub).
    const source = createGitHubSource('Kakob', 'Chatdex', { token: 'ghp_test' });
    const report = await ensureIndexed(source, SHA);
    expect(report.indexed).toBe(1);
    expect(report.skipped).toEqual([{ path: '.env', reason: 'sensitive' }]);
    const rows = await listRepoFiles('gh:Kakob/Chatdex', SHA);
    expect(grep(rows, 'navigate').hits).toHaveLength(1);
    expect(findReferences(rows, 'handleResultClick').hits).toHaveLength(0); // only the declaration exists

    // Workspace loop.
    let change = await createPreparedChange({ projectId: 'p1', title: 'Scroll to match', understandingPointIds: [], intent: { currentBehavior: 'no scroll', desiredBehavior: 'scrolls', whyItMatters: 'navigation' } });
    change = await updatePreparedChangeDraft(change.id, { criteria: [{ id: 'c1', text: 'scrolls', createdAt: '' }] });
    change = await markPreparedChangeReady(change.id);
    const { item: code } = await buildCodeEvidence(rows[0], 1, 2, { id: 'code', addedVia: 'search' });
    change = await addEvidenceItems(change.id, [code]);
    change = await updateTrace(change.id, {
      nodes: [{ id: 'n1', label: 'SearchPage', kind: 'component', evidenceIds: ['code'], order: 0 }, { id: 'n2', label: '???', kind: 'unknown', evidenceIds: [], order: 1 }],
      edges: [{ id: 'e1', from: 'n1', to: 'n2', evidenceIds: ['code'], origin: 'user' }],
    });
    expect(deriveEdgeVerification(change.trace!.edges[0], change.evidence!)).toBe('verified');
    change = await addHypothesis(change.id, 'Only the conversation id survives the route.');
    const { input } = implementationFromPastedDiff('diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n', { provenance: 'human' });
    change = await attachImplementation(change.id, input);
    const observation = await manualObservationEvidence({ id: 'obs', outcome: 'pass', note: 'saw it scroll' });
    change = await addEvidenceItems(change.id, [observation]);
    change = await updateVerificationRow(change.id, { criterionId: 'c1', evidenceIds: ['obs'], status: 'supported' });
    change = await markVerified(change.id);
    change = await updateLearned(change.id, 'ConversationsPage owns the scroll.');
    ({ change } = await promoteFromWorkspace(change.id, { title: 'ConversationsPage owns scrolling', type: 'belief', evidenceIds: ['code'], edgeIds: ['e1'] }));
    ({ change } = await createWorkspaceQuestion(change.id, { title: 'Deleted targets?' }));
    change = await closeWorkspace(change.id);
    expect(change.state).toBe('closed');

    // Guided lookups: history (GitHub) and related conversations (local).
    const commits = await commitsTouchingPath({ owner: 'Kakob', repo: 'Chatdex' }, 'src/pages/SearchPage.tsx', { token: 'ghp_test' });
    expect(commits).toHaveLength(1);
    const related = await findRelatedConversations('p1', 'handleResultClick');
    expect(related.related.map((r) => [r.conversationId, r.hits, r.firstMessageId])).toEqual([['conv-1', 1, 'm1']]);

    // The constraint: every request went to api.github.com, none to a relay.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((u) => u.startsWith('https://api.github.com/'))).toBe(true);
    expect(requests.some((u) => /\/api\/llm/.test(u))).toBe(false);
    // Nothing AI-authored exists anywhere in the workspace or its promoted object.
    expect(JSON.stringify(await db.preparedChanges.get(change.id))).not.toContain('"origin":"ai"');
    expect(JSON.stringify(await db.understandingObjects.where('projectId').equals('p1').toArray())).not.toContain('"origin":"ai"');
  });
});
