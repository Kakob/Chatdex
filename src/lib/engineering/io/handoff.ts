// Deterministic agent / engineer handoff for an approved contract change
// (handoff §5 step 6). Same inputs → byte-identical Markdown and JSON: no
// clock reads, stable ordering, timestamps taken from the proposal itself.
// Exporting never starts implementation.

import type {
  ContractChangeProposal,
  EngineeringBinding,
  EngineeringConcept,
  EngineeringEvidenceRun,
  EngineeringProjectRecord,
  Obligation,
} from '../../../types/engineering';
import { bindingStatus } from '../bindings';
import { describeStep } from '../impact';
import { criterionText, deliveryContract } from '../rules';
import { criterionOutcome } from './verification';

export interface HandoffInput {
  project: EngineeringProjectRecord;
  proposal: ContractChangeProposal;
  concepts: EngineeringConcept[];
  bindings: EngineeringBinding[];
  /** Pinned run at the proposal's base sha, if imported. */
  baselineRun?: EngineeringEvidenceRun;
}

export class HandoffError extends Error {}

function optionLabel(key: string, value: string | undefined): string {
  const param = deliveryContract.parameters.find((p) => p.key === key);
  return param?.options.find((o) => o.value === value)?.label ?? value ?? '∅';
}

function requireApproved(proposal: ContractChangeProposal) {
  if (proposal.state !== 'approved' && proposal.state !== 'accepted') {
    throw new HandoffError(`Only an approved change can be handed off (this one is ${proposal.state})`);
  }
  if (!proposal.baseSha || !proposal.approvedImpact || !proposal.approvedAt) {
    throw new HandoffError('Approved change is missing its base revision or frozen impact');
  }
  return { baseSha: proposal.baseSha, impact: proposal.approvedImpact, approvedAt: proposal.approvedAt };
}

function bindingRows(input: HandoffInput, conceptIds: Set<string>) {
  return input.bindings
    .filter((b) => conceptIds.has(b.targetId))
    .slice()
    .sort((a, b) => a.targetId.localeCompare(b.targetId) || a.path.localeCompare(b.path) || a.symbol.localeCompare(b.symbol))
    .map((b) => {
      const status = bindingStatus(b, input.baselineRun);
      return {
        bindingId: b.id,
        conceptId: b.targetId,
        path: `${input.project.repository.root}/${b.path}`,
        symbol: b.symbol,
        role: b.role,
        atBase: status.state === 'unobserved' ? 'unobserved' : status.observation ? 'present' : 'missing',
        lines: status.observation ? `${status.observation.startLine}-${status.observation.endLine}` : null,
      };
    });
}

export function buildHandoffJson(input: HandoffInput) {
  const { proposal, project, concepts } = input;
  const { baseSha, impact, approvedAt } = requireApproved(proposal);
  const conceptIds = new Set(impact.affectedConcepts.map((c) => c.conceptId));
  impact.obligations.forEach((o) => conceptIds.add(o.conceptId));
  const titleOf = (id: string) => concepts.find((c) => c.id === id)?.title ?? id;

  return {
    schema: 'chatdex.engineering.handoff/v1',
    experimental: true,
    project: { id: project.id, name: project.name },
    repository: { remote: project.repository.remote, root: project.repository.root, baseSha },
    proposal: {
      id: proposal.id,
      statementId: proposal.statementId,
      contract: proposal.contractKey,
      from: proposal.from,
      to: proposal.to,
      fromStatement: deliveryContract.describe(proposal.from),
      toStatement: deliveryContract.describe(proposal.to),
      rationale: proposal.rationale,
      approvedAt: approvedAt.toISOString(),
    },
    rulePack: impact.rulePack,
    obligations: impact.obligations.map((o) => ({
      id: o.id,
      kind: o.kind,
      conceptId: o.conceptId,
      concept: titleOf(o.conceptId),
      title: o.title,
      because: o.because,
      trigger: o.trigger,
      path: o.path?.map((s) => s.relationshipId) ?? null,
      ...(o.criterionId ? { criterionId: o.criterionId } : {}),
    })),
    unknownImpact: impact.affectedConcepts
      .filter((c) => c.status === 'unknown')
      .map((c) => ({ conceptId: c.conceptId, concept: titleOf(c.conceptId), path: c.path.map((s) => s.relationshipId) })),
    modelGaps: impact.modelGaps,
    acceptanceCriteria: impact.criterionIds.map((id) => ({
      id,
      text: criterionText(id),
      atBase: criterionOutcome(input.baselineRun, id),
    })),
    priorEvidence: input.baselineRun
      ? {
          sha: input.baselineRun.manifest.revision.sha,
          command: input.baselineRun.manifest.command,
          capturedAt: input.baselineRun.manifest.capturedAt,
        }
      : null,
    bindings: bindingRows(input, conceptIds),
    returnResults: {
      command: `npm run queue:evidence -- --base ${baseSha}`,
      requirements: [
        'Work on a branch or worktree created from the base sha.',
        'Commit before capturing; uncommitted evidence is imported as unpinned and never counts.',
        'Keep the [EQ-Cn] prefix on every criterion test name.',
        'Report remaining unknowns with --note; notes are shown as agent-reported, not as verification.',
      ],
    },
  };
}

function pathText(o: Obligation, titleOf: (id: string) => string): string {
  if (o.path === null) return 'model gap — no modeled relationship reaches this concept';
  if (o.path.length === 0) return 'on the contract’s own concept';
  return o.path.map((s) => describeStep(s, titleOf)).join(' → ');
}

export function renderHandoffMarkdown(input: HandoffInput): string {
  const json = buildHandoffJson(input);
  const { proposal } = input;
  const titleOf = (id: string) => input.concepts.find((c) => c.id === id)?.title ?? id;
  const obligations = proposal.approvedImpact!.obligations;
  const lines: string[] = [
    `# Change contract: ${deliveryContract.title}`,
    '',
    `> Experimental Chatdex engineering prototype. Obligations below come from authored rule pack`,
    `> \`${json.rulePack.id}@${json.rulePack.version}\` and modeled relationships — not from AI inference.`,
    '',
    `**Project:** ${json.project.name}`,
    `**Repository:** ${json.repository.remote} (\`${json.repository.root}\`)`,
    `**Base revision:** \`${json.repository.baseSha}\``,
    `**Approved:** ${json.proposal.approvedAt}`,
    `**Proposal:** \`${json.proposal.id}\` · contract statement \`${json.proposal.statementId}\``,
    '',
    '## Desired behavior',
    '',
    ...deliveryContract.parameters.map(
      (p) => `- **${p.label}:** ${optionLabel(p.key, proposal.from[p.key])} → **${optionLabel(p.key, proposal.to[p.key])}**`
    ),
    '',
    `Before: ${json.proposal.fromStatement}.`,
    '',
    `After: ${json.proposal.toStatement}.`,
    '',
    '## Rationale',
    '',
    proposal.rationale.trim() || '_None given._',
    '',
    '## Implementation plan (obligations)',
    '',
  ];
  const nonVerification = obligations.filter((o) => o.kind !== 'verification');
  for (const o of nonVerification) {
    lines.push(`- [ ] **${o.title}** \`${o.id}\` — _${o.kind}, ${titleOf(o.conceptId)}_`);
    lines.push(`  - Why: ${o.because}`);
    lines.push(`  - Trigger: ${o.trigger.join('; ')}`);
    lines.push(`  - Path: ${pathText(o, titleOf)}`);
  }
  lines.push('', '## Acceptance criteria', '', '| Criterion | Requirement | At base |', '|---|---|---|');
  for (const c of json.acceptanceCriteria) lines.push(`| \`${c.id}\` | ${c.text} | ${c.atBase.replace('_', ' ')} |`);
  lines.push('');
  if (json.unknownImpact.length > 0 || json.modelGaps.length > 0) {
    lines.push('## Unknown impact (decide, do not assume none)', '');
    for (const u of json.unknownImpact) {
      lines.push(`- **${u.concept}** is reached by the change (${u.path.join(' → ')}) but no rule covers it.`);
    }
    for (const g of json.modelGaps) lines.push(`- Obligation \`${g}\` has no modeled relationship path.`);
    lines.push('');
  }
  lines.push('## Out of scope', '', '- Exactly-once execution. Redelivery may duplicate processing.');
  if (proposal.to.failureScope !== 'process_restart') {
    lines.push('- Surviving a queue process restart. Jobs held in memory are lost when the process dies.');
  }
  lines.push('- Changes outside the repository root above.', '');
  lines.push('## Where the code is (at base)', '', '| Concept | Location | Role | At base |', '|---|---|---|---|');
  for (const b of json.bindings) {
    const where = b.lines ? `\`${b.path}\` \`${b.symbol}\` (L${b.lines})` : `\`${b.path}\` \`${b.symbol}\``;
    lines.push(`| ${titleOf(b.conceptId)} | ${where} | ${b.role} | ${b.atBase} |`);
  }
  lines.push('');
  if (json.priorEvidence) {
    lines.push(
      '## Prior evidence',
      '',
      `Captured at \`${json.priorEvidence.sha}\` on ${json.priorEvidence.capturedAt} with \`${json.priorEvidence.command}\`.`,
      ''
    );
  }
  lines.push('## Returning results', '', `Run from the repository root after committing:`, '', '```', json.returnResults.command, '```', '');
  for (const r of json.returnResults.requirements) lines.push(`- ${r}`);
  lines.push('', 'Import the written manifest in Chatdex → Engineering → Evidence. Implementing by hand works the same way.', '');
  return lines.join('\n');
}

export function renderHandoffJson(input: HandoffInput): string {
  return `${JSON.stringify(buildHandoffJson(input), null, 2)}\n`;
}
