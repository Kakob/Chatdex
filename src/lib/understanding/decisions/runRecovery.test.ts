import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearAllData } from '../../db';
import { db } from '../../db/schema';
import { bulkPutMessages } from '../../db/messages';
import { putRepoFiles } from '../../db/repoFiles';
import {
  putUnderstandingProject,
  putProjectAssociation,
  getUnderstandingProject,
  getObjectsForProject,
  getEventsForObject,
} from '../../db/understanding';
import { listDecisionTracesForProject } from '../../db/decisionTraces';
import { deriveAnchorsForConversation } from '../../investigation/anchors';
import { deriveAgentInspectionsForConversation } from '../../investigation/agentInspections';
import { planRecovery, runRecovery } from './runRecovery';
import { readDecisionMeta } from './meta';
import type { ContentBlock, StoredConversation, StoredMessage } from '../../../types';

vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return { ...actual, complete: vi.fn() };
});
import { complete } from '../../providers';
const completeMock = vi.mocked(complete);

const PROJECT = 'proj-1';
const CONV = 'sess-1';
const SHA = 'a'.repeat(40);
const REPO_KEY = 'gh:Kakob/Chatdex';
const ROOT = '/Users/dev/chatdex';

const SHA_B = 'b'.repeat(40);
const ghCalls: string[] = [];

/** Injected for the ref → sha resolve; anything not in `refs` 404s. */
function ghFetch(refs: Record<string, string> = { HEAD: SHA }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    ghCalls.push(url);
    const m = /\/commits\/(.+)$/.exec(url);
    const sha = m ? refs[decodeURIComponent(m[1])] : undefined;
    return new Response(JSON.stringify(sha ? { sha } : { message: 'Not Found' }), {
      status: sha ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

/** Every plan resolves the bound ref, so every call injects a fetch. */
function cfg(extra: Partial<Parameters<typeof planRecovery>[1]> = {}) {
  return { provider: 'anthropic' as const, fetchImpl: ghFetch(), ...extra };
}

const USER_TEXT = 'Add project deletion to Chatdex. Deleting a project must not delete the conversations associated with it.';
const AGENT_TEXT = 'I read deleteConversation and will mirror its cascade. Deletion will be permanent with no audit record.';
const CONV_FILE = 'export async function deleteConversation(id: string): Promise<void> {\n  // cascade\n}\n';

const tool = (toolName: string, toolInput: Record<string, unknown>, id: string): ContentBlock => ({ type: 'tool_use', toolName, toolInput, toolUseId: id });

async function seed(updatedAt = new Date('2026-09-05T10:00:00Z')) {
  await putUnderstandingProject({
    id: PROJECT,
    name: 'Chatdex',
    origin: 'user',
    reviewState: 'accepted',
    repository: { owner: 'Kakob', repo: 'Chatdex' },
    createdAt: updatedAt,
    updatedAt,
  });
  const conv: StoredConversation = {
    id: CONV,
    source: 'claude-code',
    name: 'project deletion session',
    summary: null,
    createdAt: updatedAt,
    updatedAt,
    importedAt: updatedAt,
    messageCount: 3,
    userMessageCount: 1,
    assistantMessageCount: 2,
    estimatedTokens: 0,
    fullText: '',
    projectPath: ROOT,
  };
  await db.conversations.put(conv);
  const messages: StoredMessage[] = [
    { id: 'm0', conversationId: CONV, sender: 'user', text: USER_TEXT, createdAt: new Date(updatedAt.getTime() - 3000) },
    {
      id: 'm1',
      conversationId: CONV,
      sender: 'assistant',
      text: AGENT_TEXT,
      contentBlocks: [
        { type: 'text', text: AGENT_TEXT },
        tool('Read', { file_path: `${ROOT}/src/lib/db/conversations.ts` }, 't1'),
        tool('Write', { file_path: `${ROOT}/src/lib/db/projects.ts`, content: 'export async function deleteProject(id: string) {\n  await db.understandingProjects.delete(id);\n}\n' }, 't2'),
      ],
      createdAt: new Date(updatedAt.getTime() - 2000),
    },
  ];
  await bulkPutMessages(messages);
  await putProjectAssociation({ id: 'assoc-1', projectId: PROJECT, conversationId: CONV, confidence: 1, origin: 'user', reviewState: 'accepted', createdAt: updatedAt, updatedAt });
  await deriveAnchorsForConversation(CONV);
  await deriveAgentInspectionsForConversation(CONV);
  await putRepoFiles([
    { repoKey: REPO_KEY, sha: SHA, path: 'src/lib/db/conversations.ts', size: CONV_FILE.length, content: CONV_FILE, fetchedAt: updatedAt },
    { repoKey: REPO_KEY, sha: SHA, path: 'src/lib/db/projects.ts', size: 10, content: 'export async function deleteProject() {}\n', fetchedAt: updatedAt },
    { repoKey: REPO_KEY, sha: SHA, path: 'src/lib/db/projects.test.ts', size: 1, content: 'x', fetchedAt: updatedAt },
    { repoKey: REPO_KEY, sha: SHA, path: 'package.json', size: 30, content: '{"dependencies":{"dexie":"4"}}', fetchedAt: updatedAt },
  ]);
}

function modelResponse(stepOfUser: number, stepOfAgent: number, stepOfWrite: number, existingObjectId: string | null = null) {
  return {
    text: JSON.stringify({
      decisions: [
        {
          existingObjectId,
          statement: 'Deleting a project keeps its conversations',
          why: 'Required by the user.',
          confidence: 0.95,
          basis: 'specified',
          evidence: [{ stepIndex: stepOfUser, quote: 'must not delete the conversations' }],
          implementedBy: { anchorStepIndexes: [stepOfWrite], code: [] },
          alternatives: [],
          assumptions: [
            {
              statement: 'The cascade mirrors deleteConversation',
              basis: 'inherited',
              evidence: [{ stepIndex: stepOfAgent, quote: 'mirror its cascade' }],
              code: [{ path: 'src/lib/db/conversations.ts', quote: 'export async function deleteConversation' }],
              inheritedFrom: null,
              rationale: 'Copied.',
            },
          ],
        },
        {
          existingObjectId: null,
          statement: 'Deletion is permanent with no audit record',
          why: 'Nobody asked.',
          confidence: 0.8,
          basis: 'invented',
          evidence: [{ stepIndex: stepOfAgent, quote: 'permanent with no audit record' }],
          implementedBy: { anchorStepIndexes: [stepOfWrite], code: [{ path: 'src/lib/db/projects.ts', quote: 'export async function deleteProject' }] },
          alternatives: [{ statement: 'Soft delete', evidence: [], rejectedBecause: 'unrequested' }],
          assumptions: [],
        },
      ],
      invalidates: [],
    }),
    model: 'test-model',
  };
}

beforeEach(async () => {
  await clearAllData();
  completeMock.mockReset();
  ghCalls.length = 0;
  await seed();
});

describe('planRecovery (§9.2, law 2.6)', () => {
  it('assembles the disclosure inputs without calling the provider', async () => {
    const plan = await planRecovery(PROJECT, cfg());
    expect(completeMock).not.toHaveBeenCalled();
    expect(plan.repoKey).toBe(REPO_KEY);
    expect(plan.sha).toBe(SHA);
    expect(plan.conversations).toHaveLength(1);
    const c = plan.conversations[0];
    expect(c.anchorCount).toBe(1);
    expect(c.inspectionCount).toBe(1);
    expect(c.excerpts.map((e) => e.role)).toEqual(['user_msg', 'agent_text', 'tool_call']);
    expect(plan.hunkCount).toBe(1);
    expect(plan.filePaths).toEqual(['src/lib/db/conversations.ts', 'src/lib/db/projects.ts']);
    // projects.ts was created by a Write in this session; conversations.ts pre-existed.
    expect(plan.preExistingPaths).toEqual(['src/lib/db/conversations.ts']);
    expect(plan.advancesCursor).toBe(true);
  });

  it('honours the cursor and scoped runs', async () => {
    const project = (await getUnderstandingProject(PROJECT))!;
    await putUnderstandingProject({ ...project, lastDecisionRecoveredAt: new Date('2026-09-06T00:00:00Z') });
    expect((await planRecovery(PROJECT, cfg())).conversations).toHaveLength(0);
    expect((await planRecovery(PROJECT, cfg({ ignoreCursor: true }))).conversations).toHaveLength(1);
    const scoped = await planRecovery(PROJECT, cfg({ conversationIds: [CONV] }));
    expect(scoped.conversations).toHaveLength(1);
    expect(scoped.advancesCursor).toBe(false);
  });

  it('warns instead of failing when the resolved snapshot is not indexed', async () => {
    await db.repoFiles.clear();
    const plan = await planRecovery(PROJECT, cfg());
    // The ref still decides the sha — another branch's cache is never substituted.
    expect(plan.sha).toBe(SHA);
    expect(plan.warnings[0]).toMatch(/no snapshot is indexed/);
    expect(plan.filePaths).toEqual([]);
  });

  // The bug: recovery used to take whichever branch was indexed last, so the
  // `inherited` basis label (§2.2) was computed against the wrong code.
  it('resolves the bound ref rather than reusing the most recently indexed branch', async () => {
    const project = (await getUnderstandingProject(PROJECT))!;
    await putUnderstandingProject({
      ...project,
      repository: { owner: 'Kakob', repo: 'Chatdex', defaultBranch: 'main', pinnedRef: 'feature/x' },
    });
    const plan = await planRecovery(PROJECT, {
      provider: 'anthropic',
      fetchImpl: ghFetch({ 'feature/x': SHA_B }),
    });
    expect(ghCalls[0]).toContain('/commits/feature%2Fx');
    expect(plan.sha).toBe(SHA_B);
    expect(plan.ref).toBe('feature/x');
    expect(plan.warnings[0]).toMatch(/no snapshot is indexed/);
    expect(plan.filePaths).toEqual([]);
  });

  it('falls back to the last indexed snapshot with a different-branch warning when the ref cannot be resolved', async () => {
    const plan = await planRecovery(PROJECT, { provider: 'anthropic', fetchImpl: ghFetch({}) });
    expect(plan.sha).toBe(SHA);
    expect(plan.warnings[0]).toMatch(/may be from a different branch/);
  });

  it('makes no GitHub call when the sha is given, or when the snapshot is a local directory', async () => {
    const pinned = await planRecovery(PROJECT, cfg({ sha: SHA }));
    expect(pinned.sha).toBe(SHA);
    expect(ghCalls).toHaveLength(0);

    const local = await planRecovery(PROJECT, cfg({ repoKey: 'fs:chatdex' }));
    expect(local.repoKey).toBe('fs:chatdex');
    expect(ghCalls).toHaveLength(0);
  });
});

describe('runRecovery (§9.5, law 2.3)', () => {
  it('sends exactly the planned excerpts, persists pending decisions + traces, and advances the cursor', async () => {
    const plan = await planRecovery(PROJECT, cfg());
    const steps = plan.conversations[0].excerpts.map((e) => e.stepIndex);
    completeMock.mockResolvedValue(modelResponse(steps[0], steps[1], steps[2]));

    const outcome = await runRecovery(PROJECT, plan, { provider: 'anthropic', token: 'ghp_secret_token_value_123456' });
    expect(completeMock).toHaveBeenCalledTimes(1);
    const sent = completeMock.mock.calls[0][1].messages.map((m) => m.content).join('\n');
    expect(sent).toContain(`<step index=${steps[0]} role=user_msg>`);
    expect(sent).toContain('(pre-existing at this snapshot)');
    expect(sent).not.toContain('ghp_secret_token_value_123456');
    expect(outcome).toMatchObject({ decisionsCreated: 2, decisionsSupported: 0, tracesWritten: 2, errored: 0, conversationsProcessed: 1 });

    const objects = (await getObjectsForProject(PROJECT)).filter((o) => o.type === 'decision');
    expect(objects).toHaveLength(2);
    expect(objects.every((o) => o.origin === 'ai' && o.reviewState === 'pending' && o.status === 'current')).toBe(true);
    const permanent = objects.find((o) => o.title.startsWith('Deletion is permanent'))!;
    const meta = readDecisionMeta(permanent);
    expect(meta).toMatchObject({ basis: 'invented', madeBy: 'agent', unsupportedAutonomous: true, source: 'recovery', conversationId: CONV, primaryPath: 'src/lib/db/projects.ts' });
    const specified = readDecisionMeta(objects.find((o) => o.title.startsWith('Deleting a project keeps'))!);
    expect(specified).toMatchObject({ basis: 'specified', madeBy: 'user', unsupportedAutonomous: false });

    const traces = await listDecisionTracesForProject(PROJECT);
    expect(traces).toHaveLength(2);
    const permanentTrace = traces.find((t) => t.decisionObjectId === permanent.id)!;
    expect(permanentTrace).toMatchObject({ runId: plan.runId, repoKey: REPO_KEY, sha: SHA, provider: 'anthropic', model: 'test-model' });
    expect(permanentTrace.anchorStableKeys).toHaveLength(1);
    expect(permanentTrace.implEvidence[0]).toMatchObject({ path: 'src/lib/db/projects.ts', startLine: 1 });
    expect(permanentTrace.symbols).toEqual(['deleteProject']);
    expect(permanentTrace.testPaths).toEqual(['src/lib/db/projects.test.ts']);
    expect(permanentTrace.fetchedPaths).toEqual(['src/lib/db/projects.ts', 'src/lib/db/conversations.ts']);
    expect(meta.latestTraceId).toBe(permanentTrace.id);

    const events = await Promise.all(objects.map((o) => getEventsForObject(o.id)));
    expect(events.flat().map((e) => e.op)).toEqual(['introduced', 'introduced']);

    expect((await getUnderstandingProject(PROJECT))!.lastDecisionRecoveredAt).toEqual(new Date('2026-09-05T10:00:00Z'));
  });

  it('re-recognizes an existing decision as a pending supported event and never supersedes', async () => {
    let plan = await planRecovery(PROJECT, cfg());
    let steps = plan.conversations[0].excerpts.map((e) => e.stepIndex);
    completeMock.mockResolvedValue(modelResponse(steps[0], steps[1], steps[2]));
    await runRecovery(PROJECT, plan, { provider: 'anthropic', token: undefined });
    const first = (await getObjectsForProject(PROJECT)).find((o) => o.title.startsWith('Deleting a project keeps'))!;

    plan = await planRecovery(PROJECT, cfg({ ignoreCursor: true }));
    steps = plan.conversations[0].excerpts.map((e) => e.stepIndex);
    expect(plan.existingDecisions.map((d) => d.id)).toContain(first.id);
    completeMock.mockResolvedValue(modelResponse(steps[0], steps[1], steps[2], first.id));
    const outcome = await runRecovery(PROJECT, plan, { provider: 'anthropic', token: undefined });
    expect(outcome).toMatchObject({ decisionsCreated: 1, decisionsSupported: 1 });

    const events = await getEventsForObject(first.id);
    expect(events.map((e) => [e.op, e.reviewState, e.origin])).toEqual([
      ['introduced', 'accepted', 'ai'],
      ['supported', 'pending', 'ai'],
    ]);
    expect(events.every((e) => e.op !== 'superseded' && e.op !== 'contradicted')).toBe(true);
    const traces = await listDecisionTracesForProject(PROJECT);
    expect(traces.filter((t) => t.decisionObjectId === first.id)).toHaveLength(2);
  });

  it('isolates provider failures per conversation and does not advance the cursor', async () => {
    const plan = await planRecovery(PROJECT, cfg());
    completeMock.mockRejectedValue(new Error('relay down'));
    const outcome = await runRecovery(PROJECT, plan, { provider: 'anthropic', token: undefined });
    expect(outcome).toMatchObject({ errored: 1, decisionsCreated: 0, tracesWritten: 0 });
    expect(outcome.warnings.join('\n')).toMatch(/relay down/);
    expect((await getUnderstandingProject(PROJECT))!.lastDecisionRecoveredAt).toBeUndefined();
    expect(await getObjectsForProject(PROJECT)).toHaveLength(0);
  });
});
