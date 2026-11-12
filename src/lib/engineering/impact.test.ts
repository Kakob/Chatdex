import { describe, expect, it } from 'vitest';
import type { ContractChange } from '../../types/engineering';
import { buildEventQueueFixture, DELIVERY_STATEMENT_ID } from './fixture';
import { deriveImpact, describeStep, ImpactError, propagate } from './impact';
import { deliveryContract, queueDeliveryRules } from './rules';

const BEFORE = { semantics: 'remove_on_dispatch', failureScope: 'none' };
const WORKER = { semantics: 'ack_after_processing', failureScope: 'worker_failure' };
const RESTART = { semantics: 'ack_after_processing', failureScope: 'process_restart' };

function change(from: Record<string, string>, to: Record<string, string>): ContractChange {
  return { statementId: DELIVERY_STATEMENT_ID, contractKey: 'delivery', from, to };
}

function derive(from = BEFORE, to: Record<string, string> = WORKER, model = buildEventQueueFixture()) {
  return deriveImpact(model, change(from, to), deliveryContract, queueDeliveryRules);
}

describe('deriveImpact: remove on dispatch → ack after processing', () => {
  it('derives lifecycle, protocol, retry, documentation and verification obligations', () => {
    const impact = derive();
    expect(impact.obligations.map((o) => o.id)).toEqual([
      'lifecycle.leased-state',
      'lifecycle.remove-on-ack',
      'worker.claim-ack-protocol',
      'worker.no-ack-on-failure',
      'retry.lease-expiry',
      'retry.lease-fencing',
      'retry.bounded-attempts',
      'delivery.duplicates-documented',
      'storage.memory-limitation',
      'verify.EQ-C0',
      'verify.EQ-C1',
      'verify.EQ-C2',
      'verify.EQ-C3',
      'verify.EQ-C4',
      'verify.EQ-C5',
      'verify.EQ-C7',
    ]);
    expect(impact.criterionIds).toEqual(['EQ-C0', 'EQ-C1', 'EQ-C2', 'EQ-C3', 'EQ-C4', 'EQ-C5', 'EQ-C7']);
    expect(impact.modelGaps).toEqual([]);
  });

  it('explains every obligation with its trigger and the relationship path that carried it', () => {
    const impact = derive();
    const model = buildEventQueueFixture();
    const title = (id: string) => model.concepts.find((c) => c.id === id)!.title;
    const worker = impact.obligations.find((o) => o.id === 'worker.claim-ack-protocol')!;
    expect(worker.trigger).toEqual(['semantics: remove_on_dispatch → ack_after_processing']);
    expect(worker.path!.map((s) => describeStep(s, title))).toEqual([
      'Worker / claim / process / ack implements Delivery guarantee',
    ]);
    const retry = impact.obligations.find((o) => o.id === 'retry.lease-expiry')!;
    expect(retry.path!.map((s) => s.relationshipId)).toEqual(['rel-retry-enables-delivery']);
    expect(retry.path![0].direction).toBe('reverse');
    const own = impact.obligations.find((o) => o.id === 'delivery.duplicates-documented')!;
    expect(own.path).toEqual([]);
  });

  it('reports the producer as reached but impact unknown under worker-failure scope — never "no impact"', () => {
    const impact = derive();
    const producer = impact.affectedConcepts.find((c) => c.conceptId === 'eq-producer')!;
    expect(producer.status).toBe('unknown');
    expect(producer.path.map((s) => s.relationshipId)).toEqual([
      'rel-storage-supports-delivery',
      'rel-producer-depends-storage',
    ]);
    // Storage is covered (the in-memory limitation is an obligation), not unknown.
    expect(impact.affectedConcepts.find((c) => c.conceptId === 'eq-storage')!.status).toBe('covered');
  });

  it('keeps failure scopes apart: process restart adds durable storage, durable enqueue and EQ-C6', () => {
    const worker = derive(BEFORE, WORKER);
    const restart = derive(BEFORE, RESTART);
    const ids = (i: typeof worker) => i.obligations.map((o) => o.id);
    expect(ids(worker)).not.toContain('storage.durable-transitions');
    expect(ids(worker)).not.toContain('verify.EQ-C6');
    expect(ids(restart)).toEqual(expect.arrayContaining(['storage.durable-transitions', 'producer.durable-enqueue', 'verify.EQ-C6']));
    expect(ids(restart)).not.toContain('storage.memory-limitation');
    expect(restart.affectedConcepts.find((c) => c.conceptId === 'eq-producer')!.status).toBe('covered');
  });

  it('derives only the newly required obligations for an incremental change', () => {
    const impact = derive(WORKER, RESTART);
    expect(impact.obligations.map((o) => o.id)).toEqual([
      'storage.durable-transitions',
      'producer.durable-enqueue',
      'verify.EQ-C6',
    ]);
    expect(impact.obligations[0].trigger).toEqual(['failureScope: worker_failure → process_restart']);
  });

  it('derives no obligations for a no-op change, but still lists every reached concept as unknown', () => {
    const impact = derive(BEFORE, BEFORE);
    expect(impact.obligations).toEqual([]);
    expect(impact.affectedConcepts.every((c) => c.status === 'unknown')).toBe(true);
  });

  it('flags a model gap when no relationship reaches an obligation’s concept', () => {
    const model = buildEventQueueFixture();
    model.relationships = model.relationships.filter((r) => r.id !== 'rel-retry-enables-delivery' && r.id !== 'rel-retry-constrains-lifecycle');
    const impact = derive(BEFORE, WORKER, model);
    expect(impact.modelGaps).toEqual(['retry.lease-expiry', 'retry.lease-fencing', 'retry.bounded-attempts']);
    expect(impact.obligations.find((o) => o.id === 'retry.lease-expiry')!.path).toBeNull();
  });

  it('ignores rejected and pending relationships', () => {
    const model = buildEventQueueFixture();
    model.relationships = model.relationships.map((r) =>
      r.id === 'rel-producer-depends-storage' ? { ...r, reviewState: 'pending' as const } : r
    );
    expect(propagate(model.relationships, 'eq-delivery').has('eq-producer')).toBe(false);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(derive())).toBe(JSON.stringify(derive()));
  });

  it('refuses incoherent contracts', () => {
    expect(() => derive(BEFORE, { semantics: 'remove_on_dispatch', failureScope: 'worker_failure' })).toThrow(ImpactError);
    expect(() => derive(BEFORE, { semantics: 'ack_after_processing', failureScope: 'none' })).toThrow(ImpactError);
  });
});
