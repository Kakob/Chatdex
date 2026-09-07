// Decision Recovery regression fixture (SPEC-decision-recovery §16, DR-6).
//
// `project-deletion.jsonl` is a sanitized Claude Code subagent transcript of
// a real, unsteered run of the killer-demo prompt against this repository.
// `project-deletion.response.json` is a canned provider answer whose quotes
// are copied from that transcript. The test exercises only the deterministic
// halves of the pipeline — parse → normalize → anchors + inspections →
// transcript excerpts → firewall — and pins the basis split that the firewall
// (not the model) produces. No provider call is made.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseClaudeCodeContent } from '../../src/lib/parsers/claude-code';
import { normalizeSession } from '../../src/lib/detection/normalize';
import { clearAllData, bulkPutConversations, bulkPutMessages } from '../../src/lib/db';
import { deriveAnchorsForConversation } from '../../src/lib/investigation/anchors';
import { buildAgentInspections, rootsFor } from '../../src/lib/investigation/agentInspections';
import { buildTranscriptExcerpts } from '../../src/lib/understanding/decisions/candidates';
import { parseRecoveryResponse, type FirewallContext } from '../../src/lib/understanding/decisions/firewall';
import { extractSessionCommits } from '../../src/lib/understanding/decisions/sessionCommits';
import type { DecisionBasis, DecisionMadeBy } from '../../src/types/decision';

const DIR = resolve(__dirname);
const jsonl = readFileSync(resolve(DIR, 'project-deletion.jsonl'), 'utf8');
const response = readFileSync(resolve(DIR, 'project-deletion.response.json'), 'utf8');
const expected = JSON.parse(readFileSync(resolve(DIR, 'project-deletion.expected.json'), 'utf8')) as {
  decisions: Array<{ statement: string; basis: DecisionBasis; madeBy: DecisionMadeBy; unsupportedAutonomous: boolean; assumptions: Array<{ statement: string; basis: DecisionBasis }> }>;
  counts: Record<DecisionBasis, number> & { unsupportedAutonomous: number };
  minAnchors: number;
  minInspections: number;
  commits: number;
};

beforeEach(async () => {
  await clearAllData();
});

describe('project-deletion fixture (DR-6)', () => {
  it('parses as a subagent transcript with edits, reads, and a commit', async () => {
    const parsed = parseClaudeCodeContent(jsonl, 'agent-demoprojectdeletion.jsonl');
    const conv = parsed.conversations[0];
    expect(conv.providerMeta).toMatchObject({ isSidechain: true, agentId: 'demoprojectdeletion' });
    expect(conv.projectPath).toBe('/home/user/chatdex');
    const { steps } = normalizeSession(conv.id, parsed.messages);
    expect(steps[0].kind).toBe('user_msg');
    expect(steps[0].text).toContain('Add project deletion to Chatdex');
    expect(steps[0].text).toContain('must not delete the conversations');

    await bulkPutConversations(parsed.conversations);
    await bulkPutMessages(parsed.messages);
    const anchors = await deriveAnchorsForConversation(conv.id);
    expect(anchors.length).toBeGreaterThanOrEqual(expected.minAnchors);
    const inspections = buildAgentInspections(conv.id, parsed.messages, { ref: 'fixture', provenance: 'legacy' }, rootsFor(conv));
    expect(inspections.length).toBeGreaterThanOrEqual(expected.minInspections);
    expect(inspections.some((i) => i.path === 'src/lib/db/conversations.ts')).toBe(true);
    expect(extractSessionCommits(steps)).toHaveLength(expected.commits);
  });

  it('the firewall reproduces the pinned basis split from the canned response', async () => {
    const parsed = parseClaudeCodeContent(jsonl, 'agent-demoprojectdeletion.jsonl');
    const conv = parsed.conversations[0];
    await bulkPutConversations(parsed.conversations);
    await bulkPutMessages(parsed.messages);
    const anchors = await deriveAnchorsForConversation(conv.id);
    const { steps } = normalizeSession(conv.id, parsed.messages);
    const excerpts = buildTranscriptExcerpts(conv.id, steps, anchors);
    const inspections = buildAgentInspections(conv.id, parsed.messages, { ref: 'fixture', provenance: 'legacy' }, rootsFor(conv));

    const ctx: FirewallContext = {
      conversationId: conv.id,
      steps: new Map(excerpts.excerpts.map((e) => [e.stepIndex, { messageId: e.messageId, role: e.role, text: e.text }])),
      anchorsByStep: new Map(excerpts.excerpts.filter((e) => e.anchorStableKey).map((e) => [e.stepIndex, { stableKey: e.anchorStableKey!, paths: e.hunkPaths ?? [] }])),
      fetched: new Map(),
      preExistingPaths: new Set<string>(),
      inspectedPaths: new Set(inspections.map((i) => i.path).filter((p): p is string => Boolean(p))),
      dependencies: new Set(['dexie', 'react-router-dom']),
      existingDecisionIds: new Set(),
    };
    const result = parseRecoveryResponse(response, ctx);
    const got = result.decisions.map((d) => ({
      statement: d.statement,
      basis: d.basis,
      madeBy: d.madeBy,
      unsupportedAutonomous: d.unsupportedAutonomous,
      assumptions: d.assumptions.map((a) => ({ statement: a.statement, basis: a.basis })),
    }));
    expect(got).toEqual(expected.decisions);

    const counts: Record<string, number> = { specified: 0, inherited: 0, inferred: 0, invented: 0, unknown: 0, unsupportedAutonomous: 0 };
    for (const d of result.decisions) {
      counts[d.basis]++;
      if (d.unsupportedAutonomous) counts.unsupportedAutonomous++;
    }
    expect(counts).toEqual(expected.counts);
    // Every decision cites at least one verified span and at least one links to an edit.
    expect(result.decisions.every((d) => d.transcriptEvidence.length > 0)).toBe(true);
    expect(result.decisions.some((d) => d.anchorStableKeys.length > 0)).toBe(true);
  });
});
