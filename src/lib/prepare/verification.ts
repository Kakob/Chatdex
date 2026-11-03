// Verification (SPEC-change-workspace §12, PRD §14; CW-4). Criteria × evidence
// with HUMAN-set statuses. `deriveVerificationHint` only suggests (law §2.2);
// a row backed solely by AI inference can never be `supported` (enforced in
// lifecycle.updateVerificationRow). Test/runtime evidence comes from a
// recorded manual observation or from a tool event inside an ingested
// Claude Code session — Chatdex runs nothing itself (PRD §25).

import { getMessagesForConversation } from '../db/messages';
import { normalizeSession, type Step } from '../detection/normalize';
import { scrubSecrets } from '../understanding/trace/fetchPolicy';
import { sha256Hex } from '../utils/hash';
import { MAX_QUOTE_CHARS, type EvidenceItem, type TestRuntimeEvidence } from '../../types/evidence';
import type { PreparedChange, VerificationRow, VerificationStatus } from '../../types/preparedChange';

export const VERIFICATION_STATUS_LABEL: Record<VerificationStatus, string> = {
  supported: 'Supported',
  partial: 'Partially supported',
  contradicted: 'Contradicted',
  unverified: 'Unverified',
};

/** Rows for every criterion, defaulting to unverified (display before attach). */
export function verificationRows(change: PreparedChange): VerificationRow[] {
  const existing = new Map((change.verification ?? []).map((r) => [r.criterionId, r]));
  return (change.criteria ?? []).map(
    (c) => existing.get(c.id) ?? { criterionId: c.id, evidenceIds: [], status: 'unverified', updatedAt: '' }
  );
}

export interface VerificationHint {
  suggested: VerificationStatus;
  reason: string;
  /** True when the only attached evidence is AI inference. */
  aiOnly: boolean;
}

/** Suggests, never sets (§12). */
export function deriveVerificationHint(row: VerificationRow, evidence: EvidenceItem[]): VerificationHint {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const attached = row.evidenceIds.map((id) => byId.get(id)).filter((e): e is EvidenceItem => Boolean(e));
  if (attached.length === 0) return { suggested: 'unverified', reason: 'No evidence attached.', aiOnly: false };
  const nonAi = attached.filter((e) => e.kind !== 'ai_inference');
  if (nonAi.length === 0) {
    return { suggested: 'unverified', reason: 'AI-claimed — add test, runtime, code, or history evidence.', aiOnly: true };
  }
  const runs = nonAi.filter((e): e is TestRuntimeEvidence => e.kind === 'test_runtime');
  const fails = runs.filter((r) => r.outcome === 'fail').length;
  const passes = runs.filter((r) => r.outcome === 'pass' || r.outcome === 'observed').length;
  if (fails > 0 && passes > 0) return { suggested: 'partial', reason: `${passes} passing and ${fails} failing run(s).`, aiOnly: false };
  if (fails > 0) return { suggested: 'contradicted', reason: `${fails} failing run(s) attached.`, aiOnly: false };
  if (runs.length > 0) return { suggested: 'supported', reason: `${runs.length} passing/observed run(s).`, aiOnly: false };
  return { suggested: 'partial', reason: 'Code or history evidence only — no test or runtime observation yet.', aiOnly: false };
}

export interface VerificationSummary {
  total: number;
  byStatus: Record<VerificationStatus, number>;
  /** Criteria still unverified without an explicit acceptance note. */
  blocking: string[];
}

export function verificationSummary(change: PreparedChange): VerificationSummary {
  const rows = verificationRows(change);
  const byStatus: Record<VerificationStatus, number> = { supported: 0, partial: 0, contradicted: 0, unverified: 0 };
  for (const row of rows) byStatus[row.status] += 1;
  return {
    total: rows.length,
    byStatus,
    blocking: rows.filter((r) => r.status === 'unverified' && !r.note?.trim()).map((r) => r.criterionId),
  };
}

// --- test / runtime evidence ---

export const TEST_COMMAND_RE =
  /\b(?:vitest|jest|mocha|pytest|cargo test|go test|npx tsc|tsc\b|npm (?:run )?(?:test|typecheck|lint|build|check)|pnpm (?:run )?(?:test|typecheck|lint|build)|yarn (?:test|typecheck|lint|build)|make (?:test|check))/i;

const FAIL_RE = /\b(?:FAIL|failed|failing|error TS\d+|AssertionError|✗|✘|Error:)\b|\b\d+ failed\b/;
const PASS_RE = /\b(?:passed|PASS|✓|✔|ok)\b|\b\d+ passed\b|built in \d/i;

export interface TestRunEvent {
  conversationId: string;
  stepIndex: number;
  messageId: string;
  toolName: string;
  command: string;
  outcome: TestRuntimeEvidence['outcome'];
  /** Tail of the tool result, capped for display. */
  resultExcerpt: string;
}

function commandOf(step: Step): string | null {
  const input = step.toolInput;
  if (!input) return null;
  const cmd = input.command ?? input.cmd ?? input.script;
  return typeof cmd === 'string' ? cmd : null;
}

export function classifyRunOutcome(result: string | undefined): TestRuntimeEvidence['outcome'] {
  if (!result) return 'observed';
  if (FAIL_RE.test(result)) return 'fail';
  if (PASS_RE.test(result)) return 'pass';
  return 'observed';
}

/** Tool calls that look like a test / typecheck / build run, paired with their result. Pure. */
export function findTestRunSteps(conversationId: string, steps: Step[]): TestRunEvent[] {
  const events: TestRunEvent[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.kind !== 'tool_call') continue;
    const command = commandOf(step);
    if (!command || !TEST_COMMAND_RE.test(command)) continue;
    let result: Step | undefined;
    if (step.toolUseId) result = steps.find((s) => s.kind === 'tool_result' && s.toolUseId === step.toolUseId);
    if (!result) result = steps.slice(i + 1, i + 4).find((s) => s.kind === 'tool_result');
    const text = result?.toolResult ?? '';
    events.push({
      conversationId,
      stepIndex: step.index,
      messageId: step.messageId,
      toolName: step.toolName ?? 'tool',
      command: command.slice(0, 200),
      outcome: classifyRunOutcome(text),
      resultExcerpt: text.slice(-600),
    });
  }
  return events;
}

export async function findTestRunEvents(conversationId: string): Promise<TestRunEvent[]> {
  const messages = await getMessagesForConversation(conversationId);
  const { steps } = normalizeSession(conversationId, messages);
  return findTestRunSteps(conversationId, steps);
}

async function quoteAndHash(text: string): Promise<{ quote: string; quoteHash: string; redactions: number }> {
  const scrubbed = scrubSecrets(text);
  const quote = scrubbed.text.length > MAX_QUOTE_CHARS ? scrubbed.text.slice(-MAX_QUOTE_CHARS) : scrubbed.text;
  return { quote, quoteHash: await sha256Hex(quote), redactions: scrubbed.redactions };
}

export async function testRuntimeEvidenceFromEvent(
  event: TestRunEvent,
  options: { id: string; outcome?: TestRuntimeEvidence['outcome']; note?: string; createdAt?: string }
): Promise<{ item: TestRuntimeEvidence; redactions: number }> {
  const { quote, quoteHash, redactions } = await quoteAndHash(event.resultExcerpt);
  const item: TestRuntimeEvidence = {
    id: options.id,
    kind: 'test_runtime',
    createdAt: options.createdAt ?? new Date().toISOString(),
    origin: 'user',
    addedVia: 'attach',
    ...(options.note ? { note: options.note } : {}),
    source: 'transcript',
    conversationId: event.conversationId,
    messageId: event.messageId,
    stepIndex: event.stepIndex,
    command: event.command,
    outcome: options.outcome ?? event.outcome,
    ...(quote ? { quote, quoteHash } : {}),
  };
  return { item, redactions };
}

/** A human-recorded observation ("saw it scroll in Chrome", "ran npm test locally: green"). */
export async function manualObservationEvidence(options: {
  id: string;
  outcome: TestRuntimeEvidence['outcome'];
  command?: string;
  note: string;
  createdAt?: string;
}): Promise<TestRuntimeEvidence> {
  const note = options.note.trim();
  if (!note) throw new Error('Describe what you observed');
  const { quote, quoteHash } = await quoteAndHash(note);
  return {
    id: options.id,
    kind: 'test_runtime',
    createdAt: options.createdAt ?? new Date().toISOString(),
    origin: 'user',
    addedVia: 'manual',
    note,
    source: 'manual',
    ...(options.command?.trim() ? { command: options.command.trim().slice(0, 200) } : {}),
    outcome: options.outcome,
    quote,
    quoteHash,
  };
}
