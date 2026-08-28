// SPEC-change-workspace §12 + §16 CW-4: hints never set, AI-only blocked, run discovery, markVerified gate.
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, putUnderstandingProject } from '../db';
import { createPreparedChange, updatePreparedChangeDraft } from './changes';
import { addEvidenceItems, attachImplementation, markVerified, updateVerificationRow } from './lifecycle';
import {
  classifyRunOutcome,
  deriveVerificationHint,
  findTestRunSteps,
  manualObservationEvidence,
  testRuntimeEvidenceFromEvent,
  verificationRows,
  verificationSummary,
} from './verification';
import type { Step } from '../detection/normalize';
import type { EvidenceItem } from '../../types/evidence';
import type { VerificationRow } from '../../types/preparedChange';

const iso = '2026-08-28T10:00:00.000Z';
const now = new Date(iso);
const evidence: EvidenceItem[] = [
  { id: 'code', kind: 'code', createdAt: iso, origin: 'user', addedVia: 'search', repoKey: 'gh:a/b', sha: 'a'.repeat(40), path: 'x.ts', startLine: 1, endLine: 1, quote: 'x', quoteHash: 'h' },
  { id: 'pass', kind: 'test_runtime', createdAt: iso, origin: 'user', addedVia: 'manual', source: 'manual', outcome: 'pass' },
  { id: 'fail', kind: 'test_runtime', createdAt: iso, origin: 'user', addedVia: 'attach', source: 'transcript', outcome: 'fail' },
  { id: 'ai', kind: 'ai_inference', createdAt: iso, origin: 'ai', addedVia: 'assisted', runId: 'r', provider: 'anthropic', promptDigest: 'd', text: 't' },
];
const row = (evidenceIds: string[]): VerificationRow => ({ criterionId: 'c1', evidenceIds, status: 'unverified', updatedAt: iso });

beforeEach(async () => {
  await clearAllData();
});

describe('deriveVerificationHint', () => {
  it.each([
    [[], 'unverified', false],
    [['ai'], 'unverified', true],
    [['code'], 'partial', false],
    [['code', 'ai'], 'partial', false],
    [['pass'], 'supported', false],
    [['fail'], 'contradicted', false],
    [['pass', 'fail'], 'partial', false],
  ] as const)('%j ⇒ %s (aiOnly %s)', (ids, suggested, aiOnly) => {
    expect(deriveVerificationHint(row([...ids]), evidence)).toMatchObject({ suggested, aiOnly });
  });
});

describe('test-run discovery', () => {
  const steps: Step[] = [
    { index: 0, kind: 'user_msg', messageId: 'm0', text: 'fix it' },
    { index: 1, kind: 'tool_call', messageId: 'm1', toolName: 'Bash', toolInput: { command: 'npm test' }, toolUseId: 't1' },
    { index: 2, kind: 'tool_result', messageId: 'm2', toolResult: 'Tests 12 passed (12)', toolUseId: 't1' },
    { index: 3, kind: 'tool_call', messageId: 'm3', toolName: 'Bash', toolInput: { command: 'ls -la' } },
    { index: 4, kind: 'tool_result', messageId: 'm4', toolResult: 'a b c' },
    { index: 5, kind: 'tool_call', messageId: 'm5', toolName: 'Bash', toolInput: { command: 'npx vitest run src/x' } },
    { index: 6, kind: 'tool_result', messageId: 'm6', toolResult: 'FAIL src/x.test.ts > boom\nAssertionError: expected 1 to be 2' },
    { index: 7, kind: 'tool_call', messageId: 'm7', toolName: 'Bash', toolInput: { command: 'npm run typecheck' } },
  ];

  it('finds test-like commands, pairs results by tool_use id or proximity, classifies outcome', () => {
    const events = findTestRunSteps('conv', steps);
    expect(events.map((e) => [e.stepIndex, e.command, e.outcome])).toEqual([
      [1, 'npm test', 'pass'],
      [5, 'npx vitest run src/x', 'fail'],
      [7, 'npm run typecheck', 'observed'],
    ]);
    expect(classifyRunOutcome('error TS2322: nope')).toBe('fail');
    expect(classifyRunOutcome('✓ built in 3.2s')).toBe('pass');
    expect(classifyRunOutcome(undefined)).toBe('observed');
  });

  it('turns an event into scrubbed, hashed transcript evidence', async () => {
    const [event] = findTestRunSteps('conv', [
      { index: 1, kind: 'tool_call', messageId: 'm1', toolName: 'Bash', toolInput: { command: 'npm test' }, toolUseId: 't1' },
      { index: 2, kind: 'tool_result', messageId: 'm2', toolResult: `12 passed — token ghp_${'A'.repeat(30)}`, toolUseId: 't1' },
    ]);
    const { item, redactions } = await testRuntimeEvidenceFromEvent(event, { id: 'e1', note: 'from the session' });
    expect(redactions).toBe(1);
    expect(item).toMatchObject({ kind: 'test_runtime', source: 'transcript', conversationId: 'conv', messageId: 'm1', stepIndex: 1, command: 'npm test', outcome: 'pass', addedVia: 'attach' });
    expect(item.quote).toContain('[REDACTED]');
    expect(item.quoteHash).toMatch(/^[0-9a-f]{64}$/);
    const manual = await manualObservationEvidence({ id: 'e2', outcome: 'observed', note: 'Saw the message scroll into view in Chrome', command: ' npm run dev ' });
    expect(manual).toMatchObject({ source: 'manual', addedVia: 'manual', command: 'npm run dev', outcome: 'observed' });
    await expect(manualObservationEvidence({ id: 'e3', outcome: 'pass', note: '  ' })).rejects.toThrow(/observed/);
  });
});

describe('rows, summary, and the markVerified gate', () => {
  it('tracks criteria, blocks AI-only support, and lists blocking criteria until noted', async () => {
    await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
    let change = await createPreparedChange({ projectId: 'p1', title: 'Scroll', understandingPointIds: [], intent: { currentBehavior: '', desiredBehavior: 'scrolls', whyItMatters: '' } });
    change = await updatePreparedChangeDraft(change.id, {
      criteria: [
        { id: 'c1', text: 'The match enters the viewport.', createdAt: '' },
        { id: 'c2', text: 'Works after a cold load.', createdAt: '' },
      ],
    });
    expect(verificationRows(change).map((r) => [r.criterionId, r.status])).toEqual([['c1', 'unverified'], ['c2', 'unverified']]);
    expect(verificationSummary(change).blocking).toEqual(['c1', 'c2']);

    change = await addEvidenceItems(change.id, evidence);
    change = await attachImplementation(change.id, { source: 'pasted_diff', provenance: 'human', files: [{ path: 'a', additions: 1, deletions: 0 }] });
    await expect(updateVerificationRow(change.id, { criterionId: 'c1', evidenceIds: ['ai'], status: 'supported' })).rejects.toThrow(/non-AI/);
    change = await updateVerificationRow(change.id, { criterionId: 'c1', evidenceIds: ['pass'], status: 'supported' });
    expect(verificationSummary(change)).toMatchObject({ total: 2, byStatus: { supported: 1, unverified: 1, partial: 0, contradicted: 0 }, blocking: ['c2'] });
    await expect(markVerified(change.id)).rejects.toThrow(/unverified/);
    change = await updateVerificationRow(change.id, { criterionId: 'c2', evidenceIds: [], status: 'unverified', note: 'not testable yet' });
    expect(verificationSummary(change).blocking).toEqual([]);
    change = await markVerified(change.id);
    expect(change.state).toBe('verified');
  });
});
