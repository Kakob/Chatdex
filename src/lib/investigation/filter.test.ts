import { describe, it, expect } from 'vitest';
import {
  anchorCaseState,
  anchorFileLabel,
  filterAnchors,
  type AnchorBrowserFilters,
  type AnchorConversationMeta,
} from './filter';
import type { CaseState, InvestigationAnchor } from '../../types/investigation';

function anchor(overrides: Partial<InvestigationAnchor>): InvestigationAnchor {
  return {
    id: 'k#s0',
    stableKey: 'k#s0',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    stepIndex: 0,
    toolName: 'Edit',
    kind: 'edit',
    fileChanges: [],
    filePaths: ['/proj/src/a.ts'],
    occurredAt: new Date('2026-03-10T12:00:00'),
    sourceProvenance: 'raw',
    deriverVersion: '1.0.0',
    createdAt: new Date('2026-03-10T12:00:00'),
    ...overrides,
  };
}

const meta = new Map<string, AnchorConversationMeta>([
  ['conv-1', { projectPath: '/proj' }],
  ['conv-2', { projectPath: '/other' }],
]);

function run(anchors: InvestigationAnchor[], filters: AnchorBrowserFilters) {
  return filterAnchors(anchors, filters, meta);
}

describe('filterAnchors — literal metadata filters only (SPEC §8.1)', () => {
  const rows = [
    anchor({ id: 'a', stableKey: 'a' }),
    anchor({
      id: 'b',
      stableKey: 'b',
      conversationId: 'conv-2',
      kind: 'write',
      toolName: 'Write',
      filePaths: ['/other/README.md'],
      occurredAt: new Date('2026-03-15T09:00:00'),
    }),
  ];

  it('passes everything with no filters', () => {
    expect(run(rows, {})).toHaveLength(2);
  });

  it('filters by session', () => {
    expect(run(rows, { conversationId: 'conv-2' }).map((a) => a.id)).toEqual(['b']);
  });

  it('filters by project path via conversation metadata', () => {
    expect(run(rows, { projectPath: '/proj' }).map((a) => a.id)).toEqual(['a']);
  });

  it('filters by change kind', () => {
    expect(run(rows, { kind: 'write' }).map((a) => a.id)).toEqual(['b']);
  });

  it('matches file-path substrings case-insensitively and literally', () => {
    expect(run(rows, { filePathSubstring: 'readme' }).map((a) => a.id)).toEqual(['b']);
    // Regex metacharacters are literal text, not patterns.
    expect(run(rows, { filePathSubstring: '.*' })).toHaveLength(0);
  });

  it('applies inclusive local-day date bounds', () => {
    expect(
      run(rows, { dateFrom: new Date('2026-03-10T23:00:00') }).map((a) => a.id)
    ).toEqual(['a', 'b']); // from-day is inclusive from midnight
    expect(
      run(rows, { dateTo: new Date('2026-03-10T00:30:00') }).map((a) => a.id)
    ).toEqual(['a']); // to-day is inclusive to end of day
  });

  it('filters by case state derived from linked cases', () => {
    // No cases: everything is uninvestigated.
    expect(run(rows, { caseState: 'uninvestigated' })).toHaveLength(2);
    expect(run(rows, { caseState: 'adjudicated' })).toHaveLength(0);

    const caseStates = new Map<string, CaseState>([
      ['a', 'draft'],
      ['b', 'adjudicated'],
    ]);
    expect(
      filterAnchors(rows, { caseState: 'open' }, meta, caseStates).map((a) => a.id)
    ).toEqual(['a']);
    expect(
      filterAnchors(rows, { caseState: 'adjudicated' }, meta, caseStates).map((a) => a.id)
    ).toEqual(['b']);
    expect(filterAnchors(rows, { caseState: 'uninvestigated' }, meta, caseStates)).toHaveLength(0);
  });
});

describe('anchorCaseState — derived, never stored (SPEC §11)', () => {
  const a = anchor({});
  it('maps draft/open/reopened case states to "open"', () => {
    for (const s of ['draft', 'open', 'reopened'] as CaseState[]) {
      expect(anchorCaseState(a, new Map([[a.stableKey, s]]))).toBe('open');
    }
  });
  it('maps adjudicated to adjudicated, absence to uninvestigated', () => {
    expect(anchorCaseState(a, new Map([[a.stableKey, 'adjudicated']]))).toBe('adjudicated');
    expect(anchorCaseState(a, new Map())).toBe('uninvestigated');
  });
});

describe('anchorFileLabel — literal labels (SPEC §7.4)', () => {
  it('shows the single path verbatim', () => {
    expect(anchorFileLabel(anchor({}))).toBe('/proj/src/a.ts');
  });

  it('shows a literal count for multi-file anchors', () => {
    expect(
      anchorFileLabel(anchor({ filePaths: ['/a.ts', '/b.ts', '/c.ts'] }))
    ).toBe('3 files');
  });
});
