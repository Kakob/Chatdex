import { describe, expect, it } from 'vitest';
import type { ContractChangeProposal, EngineeringBinding, EngineeringEvidenceRun } from '../../../types/engineering';
import { bindingStatus, referenceRun } from '../bindings';
import { buildEventQueueFixture } from '../fixture';
import { BASE_SHA, IMPL_SHA, manifest, manifestText, symbol, test } from '../testManifest';
import { checkImport, parseManifest } from './manifest';
import { compareRuns, verificationStatus } from './verification';

const project = buildEventQueueFixture().project;

function run(m = manifest(), extra: Partial<EngineeringEvidenceRun> = {}): EngineeringEvidenceRun {
  return {
    id: 'run',
    projectId: project.id,
    digest: 'd',
    fileName: 'f.json',
    manifest: m,
    pinned: !m.revision.dirty,
    role: 'observation',
    importedAt: new Date('2026-11-12T10:00:00Z'),
    ...extra,
  };
}

const approved: ContractChangeProposal = {
  id: 'p1',
  projectId: project.id,
  statementId: 's',
  contractKey: 'delivery',
  from: {},
  to: {},
  rationale: '',
  state: 'approved',
  baseSha: BASE_SHA,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('parseManifest', () => {
  it('round-trips a well-formed manifest', () => {
    const m = manifest();
    const parsed = parseManifest(manifestText(m));
    expect(parsed).toEqual({ ok: true, manifest: m });
  });

  it('refuses invalid JSON, unknown schemas, short shas and malformed tests', () => {
    expect(parseManifest('{')).toEqual({ ok: false, errors: ['Not valid JSON'] });
    const bad = { ...manifest(), schema: 'other/v9', revision: { sha: 'abc123', dirty: false }, tests: [{ id: 'EQ-C1' }] };
    const parsed = parseManifest(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Unknown schema'),
          'revision.sha must be a full 40-character commit sha',
          'tests[0] is malformed',
        ])
      );
    }
  });
});

describe('checkImport', () => {
  const ctx = { project, existingRuns: [] as EngineeringEvidenceRun[], digest: 'new' };

  it('accepts a matching observation', () => {
    expect(checkImport(manifest(), ctx)).toEqual([]);
  });

  it('refuses evidence from another repository or root, and duplicates', () => {
    expect(checkImport(manifest({ repository: { remote: 'https://github.com/x/y', root: 'examples/event-queue' } }), ctx)[0]).toMatch(/not this project's repository/);
    expect(checkImport(manifest({ repository: { remote: 'https://github.com/Kakob/Chatdex.git', root: 'other' } }), ctx)).toEqual([
      'Evidence covers other, not examples/event-queue',
    ]);
    expect(checkImport(manifest(), { ...ctx, existingRuns: [run(manifest(), { digest: 'new' })] })).toEqual([
      'This exact evidence file was already imported',
    ]);
  });

  it('refuses implementation evidence without the approved base, at the base itself, or for a draft', () => {
    const impl = (revision: Partial<ReturnType<typeof manifest>['revision']>) => manifest({ revision: { sha: IMPL_SHA, ...revision } });
    expect(checkImport(impl({}), { ...ctx, proposal: approved })[0]).toMatch(/does not say which base/);
    expect(checkImport(impl({ baseSha: 'c'.repeat(40) }), { ...ctx, proposal: approved })[0]).toMatch(/approved change starts from aaaaaaaaaaaa/);
    expect(checkImport(manifest({ revision: { baseSha: BASE_SHA } }), { ...ctx, proposal: approved })[0]).toMatch(/contains no implementation/);
    expect(checkImport(impl({ baseSha: BASE_SHA }), { ...ctx, proposal: { ...approved, state: 'draft' } })[0]).toMatch(/approved proposal/);
    expect(checkImport(impl({ baseSha: BASE_SHA }), { ...ctx, proposal: approved })).toEqual([]);
  });
});

describe('verification', () => {
  it('maps tests to criteria and never counts unpinned runs', () => {
    const pinned = run();
    expect(verificationStatus(pinned, 'EQ-C0')).toBe('supported');
    expect(verificationStatus(pinned, 'EQ-C5')).toBe('contradicted');
    expect(verificationStatus(pinned, 'EQ-C6')).toBe('unverified');
    const dirty = run(manifest({ revision: { dirty: true } }));
    expect(dirty.pinned).toBe(false);
    expect(verificationStatus(dirty, 'EQ-C0')).toBe('unverified');
  });

  it('compares before and after per criterion', () => {
    const before = run();
    const after = run(manifest({ revision: { sha: IMPL_SHA, baseSha: BASE_SHA }, tests: [test('EQ-C5'), test('EQ-C2', 'failed')] }));
    const rows = compareRuns(['EQ-C5', 'EQ-C2', 'EQ-C6'], new Set(['EQ-C5', 'EQ-C2']), before, after);
    expect(rows.map((r) => [r.criterionId, r.before, r.after, r.status])).toEqual([
      ['EQ-C5', 'failed', 'passed', 'supported'],
      ['EQ-C2', 'not_run', 'failed', 'contradicted'],
      ['EQ-C6', 'not_run', 'not_run', 'unverified'],
    ]);
  });
});

describe('bindingStatus', () => {
  const binding: EngineeringBinding = {
    id: 'b',
    projectId: project.id,
    targetId: 'eq-delivery',
    path: 'src/queue.ts',
    symbol: 'EventQueue.dequeue',
    role: 'implementation',
    author: 'fixture',
    createdAt: new Date(),
  };

  it('is unknown before any evidence, observed before confirmation, current once confirmed at the revision', () => {
    expect(bindingStatus(binding, undefined).state).toBe('unobserved');
    expect(bindingStatus(binding, run()).state).toBe('observed');
    const confirmed = { ...binding, confirmed: { sha: BASE_SHA, startLine: 10, endLine: 14, sha256: 'hash-EventQueue.dequeue', confirmedAt: new Date() } };
    expect(bindingStatus(confirmed, run()).state).toBe('current');
  });

  it('stays stale at a newer revision until re-confirmed, even when the text is unchanged', () => {
    const confirmed = { ...binding, confirmed: { sha: BASE_SHA, startLine: 10, endLine: 14, sha256: 'hash-EventQueue.dequeue', confirmedAt: new Date() } };
    const newer = run(manifest({ revision: { sha: IMPL_SHA }, symbols: [symbol('src/queue.ts', 'EventQueue.dequeue')] }));
    expect(bindingStatus(confirmed, newer)).toMatchObject({ state: 'stale', contentChanged: false });
    const changed = run(manifest({ revision: { sha: IMPL_SHA }, symbols: [symbol('src/queue.ts', 'EventQueue.dequeue', 'other')] }));
    expect(bindingStatus(confirmed, changed)).toMatchObject({ state: 'stale', contentChanged: true });
  });

  it('reports a symbol absent at the revision as missing', () => {
    const gone = run(manifest({ revision: { sha: IMPL_SHA }, symbols: [] }));
    expect(bindingStatus(binding, gone)).toEqual({ state: 'missing', sha: IMPL_SHA });
  });

  it('picks the latest pinned run as the reference', () => {
    const old = run(manifest(), { id: 'old' });
    const newer = run(manifest({ capturedAt: '2026-11-13T00:00:00.000Z', revision: { sha: IMPL_SHA } }), { id: 'new' });
    const dirtyNewest = run(manifest({ capturedAt: '2026-11-14T00:00:00.000Z', revision: { dirty: true } }), { id: 'dirty' });
    expect(referenceRun([old, newer, dirtyNewest])?.id).toBe('new');
  });
});
