import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearAllData } from '../../db';
import { db } from '../../db/schema';
import { createUnderstandingObject, putUnderstandingProject, getEventsForObject, getUnderstandingObject } from '../../db/understanding';
import { putDecisionTrace } from '../../db/decisionTraces';
import { putRepoFiles } from '../../db/repoFiles';
import { planChallenge, runChallenge, parseChallengeResponse } from './challenge';
import { toMetaRecord } from './meta';

vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return { ...actual, complete: vi.fn() };
});
import { complete } from '../../providers';
const completeMock = vi.mocked(complete);

const now = new Date('2026-09-07T10:00:00Z');
const SHA = 'c'.repeat(40);
const SECRET = 'ghp_thisIsASecretTokenValue1234567890';

beforeEach(async () => {
  await clearAllData();
  completeMock.mockReset();
  await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
  await db.conversations.put({ id: 'sess-1', source: 'claude-code', name: 's', summary: null, createdAt: now, updatedAt: now, importedAt: now, messageCount: 0, userMessageCount: 0, assistantMessageCount: 0, estimatedTokens: 0, fullText: '' });
  await putRepoFiles([{ repoKey: 'gh:Kakob/Chatdex', sha: SHA, path: 'src/lib/db/projects.ts', size: 1, content: 'export async function deleteProject(id: string) {\n  await db.understandingProjects.delete(id);\n}\n', fetchedAt: now }]);
});

async function seed() {
  const object = await createUnderstandingObject({
    projectId: 'p1', type: 'decision', title: 'Deletion is permanent', body: 'Nobody asked.',
    origin: 'ai', evidence: [{ conversationId: 'sess-1', messageIds: ['m1'] }], occurredAt: now,
    meta: toMetaRecord({ madeBy: 'agent', basis: 'invented', unsupportedAutonomous: true, conflictsWithUserDirection: false, primaryPath: '', source: 'recovery' }),
  });
  await putDecisionTrace({
    id: 'dt-1', projectId: 'p1', decisionObjectId: object.id, runId: 'run-1', repoKey: 'gh:Kakob/Chatdex', sha: SHA,
    why: 'No recovery was requested.',
    alternatives: [], assumptions: [{ id: 'a1', statement: 'No tombstone needed', basis: 'inferred', transcriptEvidence: [], codeEvidence: [] }],
    transcriptEvidence: [{ conversationId: 'sess-1', messageId: 'm1', stepIndex: 1, role: 'agent_text', quote: 'permanent with no audit record', startOffset: 0, endOffset: 30 }],
    anchorStableKeys: [], implEvidence: [{ path: 'src/lib/db/projects.ts', startLine: 2, endLine: 2, quote: 'await db.understandingProjects.delete(id);' }],
    symbols: [], testPaths: [], invalidates: [], fetchedPaths: [], provider: 'anthropic', model: 'm', warnings: [], createdAt: now,
  });
  return object;
}

describe('planChallenge / runChallenge (§11.4)', () => {
  it('plans without calling the provider, includes quotes and code windows, and records a pending event per verdict', async () => {
    const object = await seed();
    const plan = await planChallenge(object.id, 'anthropic');
    expect(completeMock).not.toHaveBeenCalled();
    expect(plan.excerptPaths).toEqual(['src/lib/db/projects.ts']);
    expect(plan.conversationIds).toEqual(['sess-1']);
    const user = plan.messages[1].content;
    expect(user).toContain('<decision basis="invented" madeBy="agent">');
    expect(user).toContain('<assumption id="A1" basis="inferred">');
    expect(user).toContain('permanent with no audit record');
    expect(user).toContain('<file path="src/lib/db/projects.ts:1-4">');

    completeMock.mockResolvedValueOnce({ text: JSON.stringify({ verdict: 'challenged', challenge: 'Nothing in the quotes rules out a tombstone; step 1 asserts permanence without justification.', citedPaths: ['src/lib/db/projects.ts', 'not/sent.ts'] }), model: 'test-model' });
    const result = await runChallenge(plan, { token: SECRET });
    expect(result.verdict).toBe('challenged');
    expect(result.citedPaths).toEqual(['src/lib/db/projects.ts']);
    expect(result.event).toMatchObject({ op: 'contradicted', origin: 'ai', reviewState: 'pending' });
    expect(result.event.detail).toMatch(/^Challenge: contradicted · test-model/);
    // Pending: the object's status is untouched until a human accepts.
    expect((await getUnderstandingObject(object.id))?.status).toBe('current');
    const events = await getEventsForObject(object.id);
    expect(events.map((e) => e.op)).toEqual(['introduced', 'contradicted']);

    completeMock.mockResolvedValueOnce({ text: '{"verdict":"holds","challenge":"The quote supports it.","citedPaths":[]}', model: 'test-model' });
    expect((await runChallenge(plan, { token: SECRET })).event.op).toBe('supported');
    completeMock.mockResolvedValueOnce({ text: 'Sure! {"verdict":"maybe","challenge":"Unclear."}', model: 'test-model' });
    const inconclusive = await runChallenge(plan, { token: SECRET });
    expect(inconclusive.verdict).toBe('cannot_tell');
    expect(inconclusive.event.op).toBe('refined');
    expect(inconclusive.event.detail).toMatch(/^Challenge inconclusive/);
  });

  it('refuses to send a prompt containing the GitHub token', async () => {
    const object = await seed();
    const plan = await planChallenge(object.id, 'anthropic');
    plan.messages[1].content += `\n${SECRET}`;
    await expect(runChallenge(plan, { token: SECRET })).rejects.toThrow();
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('parseChallengeResponse rejects empty challenges and non-JSON', () => {
    expect(() => parseChallengeResponse('nope', new Set())).toThrow(/not JSON/);
    expect(() => parseChallengeResponse('{"verdict":"holds","challenge":""}', new Set())).toThrow(/No challenge/);
  });
});
