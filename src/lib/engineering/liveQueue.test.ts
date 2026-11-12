import { describe, expect, it } from 'vitest';
import { LiveQueueSession } from './liveQueue';

describe('LiveQueueSession — real queue observability', () => {
  it('uses real queue methods: enqueue → claim → worker loss → lease expiry → retry → ack', async () => {
    const session = new LiveQueueSession();
    let state = await session.enqueue();
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0].state).toBe('pending');
    const id = state.jobs[0].id;

    state = await session.claim();
    expect(state.jobs[0]).toMatchObject({ id, state: 'leased', attempts: 1 });
    expect(state.currentClaimId).toBe(id);

    state = session.failWorker();
    expect(state.jobs[0].state).toBe('leased'); // abandoning the lease does not remove the job
    expect(state.currentClaimId).toBeNull();

    state = await session.expireLeases();
    expect(state.jobs[0]).toMatchObject({ id, state: 'pending', attempts: 1 });
    expect(state.events.at(-1)?.edge).toBe('requeue');

    state = await session.claim();
    expect(state.jobs[0]).toMatchObject({ id, state: 'leased', attempts: 2 });
    state = await session.complete();
    expect(state.jobs).toEqual([]);
    expect(state.completedIds).toEqual([id]);
    expect(state.events.at(-1)?.states).toContainEqual({ id, state: 'acknowledged' });
    expect(state.events.at(-1)?.edge).toBe('ack');
  });

  it('observes dead letters after three actual expired claims', async () => {
    const session = new LiveQueueSession();
    await session.enqueue();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await session.claim();
      session.failWorker();
      const state = await session.expireLeases();
      expect(state.jobs[0].state).toBe(attempt === 3 ? 'dead_lettered' : 'pending');
    }
    const state = session.snapshot();
    expect(state.deadLetterCount).toBe(1);
    expect(state.pendingCount).toBe(0);
    expect(state.events.at(-1)?.edge).toBe('dead-letter');
  });

  it('refuses impossible UI operations without mutating the queue', async () => {
    const session = new LiveQueueSession();
    await expect(session.claim()).rejects.toThrow('No pending job');
    expect(() => session.failWorker()).toThrow('Claim a job');
    await expect(session.complete()).rejects.toThrow('Claim a job');
    await session.enqueue();
    await session.claim();
    await expect(session.claim()).rejects.toThrow('Finish or fail');
    await expect(session.expireLeases()).rejects.toThrow('Finish or fail');
    expect(session.snapshot().jobs[0].state).toBe('leased');
  });
});
