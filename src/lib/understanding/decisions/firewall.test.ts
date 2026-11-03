import { describe, it, expect } from 'vitest';
import {
  parseRecoveryResponse,
  verifyTranscriptSpan,
  deriveMadeBy,
  constrainBasis,
  type FirewallContext,
} from './firewall';
import type { TranscriptSpan } from '../../../types/decision';

const USER_TEXT = 'Add project deletion. Deleting a project must not delete its conversations.';
const AGENT_TEXT = 'I will mirror the existing deleteConversation cascade and make deletion permanent, without an audit record.';
const HUNK_TEXT = 'Write src/lib/db/projects.ts\n+++ new\nexport async function deleteProject(id: string) {\n  await db.understandingProjects.delete(id);\n}\n';
const CONV_FILE = 'export async function deleteConversation(id: string): Promise<void> {\n  await db.transaction();\n}\n';

function ctx(overrides: Partial<FirewallContext> = {}): FirewallContext {
  return {
    conversationId: 'c1',
    steps: new Map([
      [0, { messageId: 'm0', role: 'user_msg', text: USER_TEXT }],
      [3, { messageId: 'm3', role: 'agent_text', text: AGENT_TEXT }],
      [4, { messageId: 'm4', role: 'tool_call', text: HUNK_TEXT }],
    ]),
    anchorsByStep: new Map([[4, { stableKey: 'raw#s4', paths: ['src/lib/db/projects.ts'] }]]),
    fetched: new Map([['src/lib/db/conversations.ts', CONV_FILE]]),
    preExistingPaths: new Set(['src/lib/db/conversations.ts']),
    inspectedPaths: new Set(['src/lib/db/conversations.ts']),
    dependencies: new Set(['dexie']),
    existingDecisionIds: new Set(['uo-existing']),
    ...overrides,
  };
}

const span = (role: TranscriptSpan['role'], stepIndex: number): TranscriptSpan => ({
  conversationId: 'c1',
  messageId: `m${stepIndex}`,
  stepIndex,
  role,
  quote: 'q',
  startOffset: 0,
  endOffset: 1,
});

describe('verifyTranscriptSpan (laws 2.1, 2.4)', () => {
  it('locates a whitespace-tolerant quote and recomputes offsets', () => {
    const s = verifyTranscriptSpan({ stepIndex: 0, quote: 'must   not delete its conversations' }, ctx());
    expect(s).toMatchObject({ conversationId: 'c1', messageId: 'm0', stepIndex: 0, role: 'user_msg' });
    expect(USER_TEXT.slice(s!.startOffset, s!.endOffset)).toBe('must not delete its conversations');
    expect(s!.quote).toBe('must not delete its conversations');
  });

  it('rejects unknown steps and unlocatable quotes', () => {
    expect(verifyTranscriptSpan({ stepIndex: 99, quote: 'Add project' }, ctx())).toBeNull();
    expect(verifyTranscriptSpan({ stepIndex: 0, quote: 'soft delete with undo' }, ctx())).toBeNull();
  });
});

describe('deriveMadeBy (§7.3)', () => {
  it('derives from span roles and ordering only', () => {
    expect(deriveMadeBy([])).toBe('unknown');
    expect(deriveMadeBy([span('user_msg', 0)])).toBe('user');
    expect(deriveMadeBy([span('agent_text', 3), span('tool_call', 4)])).toBe('agent');
    expect(deriveMadeBy([span('agent_text', 3), span('user_msg', 5)])).toBe('agent_user_adopted');
    expect(deriveMadeBy([span('user_msg', 0), span('agent_text', 3)])).toBe('user');
  });
});

describe('constrainBasis (law 2.2)', () => {
  const c = ctx();
  const code = (path: string) => ({ path, startLine: 1, endLine: 1, quote: 'x' });

  it('specified needs a user span', () => {
    expect(constrainBasis({ claimed: 'specified', spans: [span('user_msg', 0)], code: [] }, c)).toEqual({ basis: 'specified' });
    expect(constrainBasis({ claimed: 'specified', spans: [span('agent_text', 3)], code: [] }, c).basis).toBe('inferred');
    expect(constrainBasis({ claimed: 'specified', spans: [span('tool_result', 5)], code: [] }, c).basis).toBe('inferred');
  });

  it('inherited needs pre-existing code, an inspected path, or a dependency', () => {
    const agent = [span('agent_text', 3)];
    expect(constrainBasis({ claimed: 'inherited', spans: agent, code: [code('src/lib/db/conversations.ts')] }, c).basis).toBe('inherited');
    expect(constrainBasis({ claimed: 'inherited', spans: agent, code: [], inheritedFrom: 'src/lib/db/conversations.ts' }, c).basis).toBe('inherited');
    expect(constrainBasis({ claimed: 'inherited', spans: agent, code: [], inheritedFrom: 'dexie' }, c).basis).toBe('inherited');
    const downgraded = constrainBasis({ claimed: 'inherited', spans: agent, code: [code('src/lib/db/projects.ts')], inheritedFrom: 'react' }, c);
    expect(downgraded.basis).toBe('inferred');
    expect(downgraded.warning).toMatch(/downgraded to inferred/);
  });

  it('invented cannot cite a user span; inferred needs an agent span; junk is unknown', () => {
    expect(constrainBasis({ claimed: 'invented', spans: [span('agent_text', 3)], code: [] }, c).basis).toBe('invented');
    expect(constrainBasis({ claimed: 'invented', spans: [span('user_msg', 0)], code: [] }, c).basis).toBe('inferred');
    expect(constrainBasis({ claimed: 'inferred', spans: [span('agent_text', 3)], code: [] }, c).basis).toBe('inferred');
    expect(constrainBasis({ claimed: 'inferred', spans: [span('user_msg', 0)], code: [] }, c).basis).toBe('unknown');
    expect(constrainBasis({ claimed: 'REQUIRED', spans: [span('user_msg', 0)], code: [] }, c)).toMatchObject({ basis: 'unknown' });
    expect(constrainBasis({ claimed: 'unknown', spans: [], code: [] }, c)).toEqual({ basis: 'unknown' });
  });
});

describe('parseRecoveryResponse', () => {
  const good = {
    decisions: [
      {
        existingObjectId: null,
        statement: 'Deleting a project keeps its conversations',
        why: 'The user required it.',
        confidence: 0.9,
        basis: 'specified',
        evidence: [{ stepIndex: 0, quote: 'must not delete its conversations' }],
        implementedBy: { anchorStepIndexes: [4], code: [] },
        alternatives: [{ statement: 'Cascade conversations', evidence: [], rejectedBecause: 'forbidden' }],
        assumptions: [
          {
            statement: 'Associations cascade like conversation delete',
            basis: 'inherited',
            evidence: [{ stepIndex: 3, quote: 'mirror the existing deleteConversation cascade' }],
            code: [{ path: 'src/lib/db/conversations.ts', quote: 'export async function deleteConversation' }],
            inheritedFrom: null,
            rationale: 'Copied pattern.',
          },
        ],
      },
      {
        existingObjectId: null,
        statement: 'Deletion is permanent with no audit record',
        why: 'Nobody asked for recovery.',
        confidence: 0.7,
        basis: 'invented',
        evidence: [{ stepIndex: 3, quote: 'make deletion permanent, without an audit record' }],
        implementedBy: { anchorStepIndexes: [4, 42], code: [{ path: 'src/lib/db/projects.ts', quote: 'nope' }] },
        alternatives: [],
        assumptions: [],
      },
    ],
    invalidates: [
      { existingObjectId: 'uo-existing', assumptionStatement: 'Projects are never deleted', evidence: [{ stepIndex: 0, quote: 'Add project deletion' }], code: [] },
      { existingObjectId: 'uo-ghost', assumptionStatement: null, evidence: [{ stepIndex: 0, quote: 'Add project deletion' }], code: [] },
    ],
  };

  it('verifies quotes, constrains bases, derives madeBy, links anchors, and keeps invalidations on the side', () => {
    const parsed = parseRecoveryResponse('```json\n' + JSON.stringify(good) + '\n```', ctx());
    expect(parsed.decisions).toHaveLength(2);

    const [specified, invented] = parsed.decisions;
    expect(specified).toMatchObject({
      basis: 'specified',
      madeBy: 'user',
      unsupportedAutonomous: false,
      anchorStableKeys: ['raw#s4'],
      primaryPath: 'src/lib/db/projects.ts',
      firstStepIndex: 0,
    });
    expect(specified.assumptions[0]).toMatchObject({ basis: 'inherited', inheritedFrom: undefined });
    expect(specified.assumptions[0].codeEvidence[0]).toMatchObject({ path: 'src/lib/db/conversations.ts', startLine: 1, endLine: 1 });
    expect(specified.alternatives[0]).toMatchObject({ statement: 'Cascade conversations', transcriptEvidence: [] });

    expect(invented).toMatchObject({ basis: 'invented', madeBy: 'agent', unsupportedAutonomous: true, anchorStableKeys: ['raw#s4'] });
    expect(invented.implEvidence).toEqual([]);
    expect(parsed.warnings.join('\n')).toMatch(/anchor step 42/);
    expect(parsed.warnings.join('\n')).toMatch(/unverifiable code quote/);

    expect(parsed.invalidates).toEqual([
      expect.objectContaining({ decisionObjectId: 'uo-existing', assumptionId: 'statement:Projects are never deleted' }),
    ]);
    expect(parsed.warnings.join('\n')).toMatch(/unknown decision/);
  });

  it('drops decisions and assumptions with no verifiable transcript evidence (law 2.1)', () => {
    const parsed = parseRecoveryResponse(
      JSON.stringify({
        decisions: [
          { statement: 'Ghost', basis: 'inferred', evidence: [{ stepIndex: 3, quote: 'not in the text' }], implementedBy: {}, alternatives: [], assumptions: [] },
          {
            statement: 'Real',
            basis: 'inferred',
            evidence: [{ stepIndex: 3, quote: 'mirror the existing' }],
            implementedBy: {},
            alternatives: [],
            assumptions: [{ statement: 'Baseless', basis: 'inferred', evidence: [], code: [] }],
          },
        ],
      }),
      ctx()
    );
    expect(parsed.decisions.map((d) => d.statement)).toEqual(['Real']);
    expect(parsed.decisions[0].assumptions).toEqual([]);
    expect(parsed.warnings.join('\n')).toMatch(/Dropped "Ghost"/);
    expect(parsed.warnings.join('\n')).toMatch(/Dropped assumption "Baseless"/);
  });

  it('re-recognizes only known existing ids and enforces caps', () => {
    const parsed = parseRecoveryResponse(
      JSON.stringify({
        decisions: [
          { existingObjectId: 'uo-existing', statement: 'A', basis: 'inferred', evidence: [{ stepIndex: 3, quote: 'I will' }], implementedBy: {}, alternatives: [], assumptions: [] },
          { existingObjectId: 'uo-nope', statement: 'B', basis: 'inferred', evidence: [{ stepIndex: 3, quote: 'I will' }], implementedBy: {}, alternatives: [], assumptions: [] },
          { statement: 'C', basis: 'inferred', evidence: [{ stepIndex: 3, quote: 'I will' }], implementedBy: {}, alternatives: [], assumptions: [] },
        ],
      }),
      ctx({ maxDecisions: 2 })
    );
    expect(parsed.decisions.map((d) => [d.statement, d.existingObjectId])).toEqual([
      ['A', 'uo-existing'],
      ['B', null],
    ]);
    expect(parsed.warnings.join('\n')).toMatch(/unknown existingObjectId "uo-nope"/);
    expect(parsed.warnings.join('\n')).toMatch(/beyond the cap of 2/);
  });

  it('throws on non-JSON', () => {
    expect(() => parseRecoveryResponse('not json', ctx())).toThrow(/not valid JSON/);
  });
});
