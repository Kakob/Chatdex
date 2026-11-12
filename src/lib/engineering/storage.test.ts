import { beforeEach, describe, expect, it } from 'vitest';
import { db as mainDb } from '../db/schema';
import { DELIVERY_STATEMENT_ID } from './fixture';
import { renderHandoffJson, renderHandoffMarkdown } from './io/handoff';
import {
  acceptProposal,
  approveProposal,
  confirmBinding,
  currentContract,
  engineeringDb,
  ENGINEERING_DB_NAME,
  importEvidence,
  loadSnapshot,
  resetPrototype,
  saveDraft,
} from './storage';
import { BASE_SHA, IMPL_SHA, manifest, manifestText, symbol, test } from './testManifest';

const ACK = { semantics: 'ack_after_processing', failureScope: 'worker_failure' };
const T = (minute: number) => new Date(Date.UTC(2026, 10, 12, 9, minute));

const IMPLEMENTATION = manifest({
  capturedAt: '2026-11-12T11:00:00.000Z',
  revision: { sha: IMPL_SHA, baseSha: BASE_SHA },
  changedPaths: ['examples/event-queue/src/queue.ts'],
  tests: ['EQ-C0', 'EQ-C1', 'EQ-C2', 'EQ-C3', 'EQ-C4', 'EQ-C5', 'EQ-C7'].map((id) => test(id)),
  symbols: [
    symbol('src/queue.ts', 'EventQueue', 'changed'),
    symbol('src/queue.ts', 'EventQueue.claim'),
    symbol('src/queue.ts', 'EventQueue.ack'),
    symbol('src/queue.ts', 'EventQueue.enqueue'),
    symbol('src/queue.ts', 'EventQueue.reapExpired'),
  ],
  notes: [{ text: 'durability not attempted', source: 'agent-reported' }],
});

async function approvedChange() {
  await importEvidence(manifestText(manifest()), 'base.json', {}, T(1));
  const draft = await saveDraft(ACK, 'Workers crash; jobs must not be lost.', T(2));
  return approveProposal(draft.id, BASE_SHA, T(3));
}

beforeEach(async () => {
  await resetPrototype();
});

describe('engineering prototype storage', () => {
  it('lives in its own local-only database and never writes to the main Chatdex database', async () => {
    expect(engineeringDb.name).toBe(ENGINEERING_DB_NAME);
    expect(engineeringDb.name).not.toBe(mainDb.name);
    await approvedChange();
    expect(await mainDb.understandingObjects.count()).toBe(0);
    expect(await mainDb.understandingProjects.count()).toBe(0);
  });

  it('a draft does not change the contract; approval needs pinned base evidence and freezes the impact', async () => {
    const draft = await saveDraft(ACK, 'why');
    const snapshot = await loadSnapshot();
    expect(currentContract(snapshot)?.meta?.['p.semantics']).toBe('remove_on_dispatch');
    await expect(approveProposal(draft.id, BASE_SHA)).rejects.toThrow(/pinned evidence captured at the base/);
    await importEvidence(manifestText(manifest({ revision: { dirty: true } })), 'dirty.json');
    await expect(approveProposal(draft.id, BASE_SHA)).rejects.toThrow(/pinned evidence/);
    await importEvidence(manifestText(manifest()), 'base.json');
    const approved = await approveProposal(draft.id, BASE_SHA);
    expect(approved.state).toBe('approved');
    expect(approved.approvedImpact?.criterionIds).toContain('EQ-C5');
  });

  it('exports a deterministic handoff carrying base sha, criteria, obligations, bindings and prior evidence', async () => {
    const approved = await approvedChange();
    const snapshot = await loadSnapshot();
    const baselineRun = snapshot.evidenceRuns.find((r) => r.manifest.revision.sha === BASE_SHA);
    const input = { project: snapshot.project, proposal: approved, concepts: snapshot.concepts, bindings: snapshot.bindings, baselineRun };
    const md = renderHandoffMarkdown(input);
    expect(md).toBe(renderHandoffMarkdown(input));
    expect(renderHandoffJson(input)).toBe(renderHandoffJson(input));
    expect(md).toContain(`**Base revision:** \`${BASE_SHA}\``);
    expect(md).toContain('| `EQ-C5` | An accepted job survives a worker failure before completion (queue process alive) | failed |');
    expect(md).toContain('Replace dequeue() with claim(workerId, leaseMs) and ack(jobId, leaseToken)');
    expect(md).toContain('Path: Worker / claim / process / ack implements Delivery guarantee');
    expect(md).toContain('**Producer / enqueue** is reached by the change');
    expect(md).toContain('Surviving a queue process restart');
    expect(md).toContain(`npm run queue:evidence -- --base ${BASE_SHA}`);
    expect(md).toContain('`examples/event-queue/src/queue.ts` `EventQueue.claim` | implementation | missing');
    const json = JSON.parse(renderHandoffJson(input));
    expect(json.acceptanceCriteria.map((c: { id: string }) => c.id)).toEqual(['EQ-C0', 'EQ-C1', 'EQ-C2', 'EQ-C3', 'EQ-C4', 'EQ-C5', 'EQ-C7']);
  });

  it('imports implementation evidence only against the approved base, and refuses duplicates', async () => {
    const approved = await approvedChange();
    const wrongBase = manifest({ revision: { sha: IMPL_SHA, baseSha: 'c'.repeat(40) } });
    const refused = await importEvidence(manifestText(wrongBase), 'x.json', { proposalId: approved.id });
    expect(refused.ok).toBe(false);
    const ok = await importEvidence(manifestText(IMPLEMENTATION), 'impl.json', { proposalId: approved.id });
    expect(ok.ok).toBe(true);
    const again = await importEvidence(manifestText(IMPLEMENTATION), 'impl.json', { proposalId: approved.id });
    expect(again).toEqual({ ok: false, errors: ['This exact evidence file was already imported'] });
  });

  it('confirms bindings only against pinned observations that contain the symbol', async () => {
    const base = await importEvidence(manifestText(manifest()), 'base.json');
    if (!base.ok) throw new Error('import failed');
    const confirmed = await confirmBinding('bind-delivery-dequeue', base.run.id);
    expect(confirmed.confirmed?.sha).toBe(BASE_SHA);
    await expect(confirmBinding('bind-worker-claim', base.run.id)).rejects.toThrow(/not present/);
  });

  it('accepting creates a new contract version, supersedes the old, resolves the refuted limitation, and leaves unverified criteria open', async () => {
    const approved = await approvedChange();
    const partial = manifest({
      ...IMPLEMENTATION,
      tests: ['EQ-C0', 'EQ-C1', 'EQ-C2', 'EQ-C3', 'EQ-C5'].map((id) => test(id)).concat(test('EQ-C4', 'failed')),
    });
    const imported = await importEvidence(manifestText(partial), 'impl.json', { proposalId: approved.id });
    if (!imported.ok) throw new Error(imported.errors.join());
    const result = await acceptProposal(approved.id, imported.run.id, T(30));
    expect(result.openQuestionIds).toEqual([`${result.statement.id}-open-EQ-C4`, `${result.statement.id}-open-EQ-C7`]);
    expect(result.resolvedLimitationIds).toEqual(['eq-st-loss']);

    // Reload from storage: same state, prior version still navigable.
    const snapshot = await loadSnapshot();
    const current = currentContract(snapshot)!;
    expect(current.id).toBe('eq-st-delivery-v2');
    expect(current.meta).toMatchObject({ 'p.semantics': 'ack_after_processing', implementedAt: IMPL_SHA, unverifiedCriteria: 'EQ-C4,EQ-C7' });
    const old = snapshot.statements.find((s) => s.id === DELIVERY_STATEMENT_ID)!;
    expect(old.status).toBe('superseded');
    expect(snapshot.events.find((e) => e.objectId === old.id && e.op === 'superseded')?.supersededByObjectId).toBe(current.id);
    expect(snapshot.proposals.find((p) => p.id === approved.id)?.state).toBe('accepted');
    expect(snapshot.statements.find((s) => s.id === 'eq-st-loss')?.status).toBe('resolved');
  });

  it('does not accept on unpinned evidence or on evidence for another proposal', async () => {
    const approved = await approvedChange();
    const dirty = await importEvidence(manifestText(manifest({ ...IMPLEMENTATION, revision: { ...IMPLEMENTATION.revision, dirty: true } })), 'd.json', { proposalId: approved.id });
    if (!dirty.ok) throw new Error(dirty.errors.join());
    await expect(acceptProposal(approved.id, dirty.run.id)).rejects.toThrow(/Unpinned/);
    const observation = await importEvidence(manifestText(manifest({ ...IMPLEMENTATION, capturedAt: '2026-11-12T12:00:00.000Z' })), 'o.json');
    if (!observation.ok) throw new Error(observation.errors.join());
    await expect(acceptProposal(approved.id, observation.run.id)).rejects.toThrow(/imported for this change/);
    expect(currentContract(await loadSnapshot())?.id).toBe(DELIVERY_STATEMENT_ID);
  });
});
