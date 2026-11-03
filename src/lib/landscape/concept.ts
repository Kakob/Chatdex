// Concepts on the editable landscape (docs/changes/editable-landscape).
//
// A concept is a LandscapeRegion: the subject being modeled. What the user
// intends, believes, decided, or still asks about it are UnderstandingObjects
// placed in it. This module holds the pure pieces shared by the concept
// panel and "Discuss with AI": statement sections, an honest support label
// per statement, and the bounded context packet sent to a provider.
//
// The packet is agent-context mode, like project chat (lib/chat/context.ts):
// accepted/edited, current statements only — pending AI proposals, rejected
// and historical records, other projects, and conversation *content* never
// enter it. Linked evidence is named (conversation titles), not quoted.

import { estimateTokens } from '../utils/tokens';
import { regionPath, type Landscape, type LandscapeFinding, type LandscapeRegionNode } from './projection';

export interface StatementSection {
  /** Object type written for statements added in this section; null = everything else. */
  type: string | null;
  label: string;
  hint: string;
  /** Placeholder for the inline add field. */
  placeholder: string;
}

export const STATEMENT_SECTIONS: StatementSection[] = [
  { type: 'behavior', label: 'Intended behavior', hint: 'What you want it to do. Writing it down does not mean it is built.', placeholder: 'It should…' },
  { type: 'belief', label: 'Current beliefs & observations', hint: 'What you currently think is true. Unverified until evidence backs it.', placeholder: 'I think / I noticed…' },
  { type: 'question', label: 'Open questions', hint: 'What is still uncertain.', placeholder: 'How should…?' },
  { type: 'decision', label: 'Decisions', hint: 'Choices you have made about it.', placeholder: 'We decided…' },
  { type: null, label: 'Other linked understanding', hint: 'Existing records you placed here, of any other type.', placeholder: '' },
];

const SECTION_TYPES = new Set(STATEMENT_SECTIONS.map((s) => s.type).filter((t): t is string => t !== null));

export function sectionFor(type: string): StatementSection {
  return STATEMENT_SECTIONS.find((s) => s.type === type) ?? STATEMENT_SECTIONS[STATEMENT_SECTIONS.length - 1];
}

/** Group a concept's direct findings by section, keeping the given order. */
export function groupStatements(findings: LandscapeFinding[]): Map<StatementSection, LandscapeFinding[]> {
  const out = new Map<StatementSection, LandscapeFinding[]>(STATEMENT_SECTIONS.map((s) => [s, []]));
  for (const f of findings) {
    const section = SECTION_TYPES.has(f.object.type) ? sectionFor(f.object.type) : STATEMENT_SECTIONS[STATEMENT_SECTIONS.length - 1];
    out.get(section)!.push(f);
  }
  return out;
}

export type SupportLevel = 'proposed' | 'historical' | 'reviewed-evidence' | 'code-evidence' | 'unverified';

/**
 * How well a statement is backed, without overclaiming. "Reviewed evidence"
 * means an accepted record cites a source — not that the claim is true.
 */
export function supportOf(f: LandscapeFinding): { level: SupportLevel; label: string } {
  if (f.object.reviewState === 'pending') return { level: 'proposed', label: 'AI proposal · awaiting your review' };
  if (f.object.status !== 'current') return { level: 'historical', label: f.object.status === 'superseded' ? 'Superseded' : 'Resolved' };
  if (f.events.some((e) => (e.codeEvidence?.length ?? 0) > 0)) return { level: 'code-evidence', label: 'Code or test evidence attached' };
  if (f.evidence.some((e) => e.support === 'reviewed')) return { level: 'reviewed-evidence', label: 'Backed by reviewed sources' };
  return {
    level: 'unverified',
    label: f.object.origin === 'user' ? 'Your statement · unverified' : 'Accepted · no reviewed source',
  };
}

const accepted = (f: LandscapeFinding | undefined): f is LandscapeFinding =>
  Boolean(f && f.object.status === 'current' && (f.object.reviewState === 'accepted' || f.object.reviewState === 'edited'));

// --- context packet -----------------------------------------------------------

export interface ConceptContextConfig {
  /** Budget for the injected system prompt, in estimated tokens. Default 3000. */
  maxContextTokens?: number;
  /** Accepted statements taken from each ancestor concept. Default 4. */
  ancestorStatements?: number;
}

const DEFAULT_MAX_TOKENS = 3000;
const DEFAULT_ANCESTOR_STATEMENTS = 4;

export interface ConceptChatContext {
  systemPrompt: string;
  /** The context document inside the prompt — what the chat UI shows. */
  document: string;
  truncated: boolean;
  estimatedTokens: number;
  projectName: string;
  conceptId: string;
  conceptTitle: string;
  /** Root-first titles, project first. */
  path: string[];
  /** Every understanding object id whose text is in the packet. */
  objectIds: string[];
}

function statementLine(f: LandscapeFinding): string {
  const body = f.object.body ? ` — ${f.object.body.replace(/\s+/g, ' ').slice(0, 400)}` : '';
  return `- [${f.object.type}] ${f.object.title}${body} (id: ${f.object.id}; ${supportOf(f).label.toLowerCase()})`;
}

/**
 * Pure builder. Returns null when the region is not a real concept in the
 * given project (virtual Uncategorized, unknown, or foreign id).
 */
export function buildConceptContext(
  landscape: Landscape,
  projectId: string,
  conceptId: string,
  config: ConceptContextConfig = {}
): ConceptChatContext | null {
  const project = landscape.projects.find((p) => p.key === projectId && p.project);
  const node = landscape.regions.get(conceptId);
  if (!project || !node?.region || node.projectKey !== projectId) return null;
  const maxTokens = config.maxContextTokens ?? DEFAULT_MAX_TOKENS;
  const perAncestor = config.ancestorStatements ?? DEFAULT_ANCESTOR_STATEMENTS;

  const trail = regionPath(landscape, node);
  const ancestors = trail.slice(0, -1);
  const own = node.directIds.map((id) => landscape.findings.get(id)).filter(accepted);
  const grouped = groupStatements(own);
  const evidenceNames = new Set<string>();
  for (const f of own) for (const e of f.evidence) if (e.conversationName) evidenceNames.add(e.conversationName);

  const render = (opts: { ancestors: boolean; children: boolean; evidence: boolean; cap?: number }) => {
    const ids: string[] = [];
    const lines: string[] = [];
    const take = (list: LandscapeFinding[]) => {
      const shown = opts.cap ? list.slice(0, opts.cap) : list;
      for (const f of shown) {
        ids.push(f.object.id);
        lines.push(statementLine(f));
      }
      if (shown.length < list.length) lines.push(`- …${list.length - shown.length} more not included`);
    };
    lines.push(`# Concept: ${node.title}`);
    lines.push(`Path: ${[project.name, ...trail.map((n) => n.title)].join(' › ')}`);
    if (node.region!.kind) lines.push(`Kind: ${node.region!.kind}`);
    if (node.summary) lines.push(`Summary: ${node.summary}`);
    if (node.region!.body) lines.push('', 'Description (written by the user):', node.region!.body);
    for (const [section, list] of grouped) {
      if (!list.length) continue;
      lines.push('', `## ${section.label}`);
      take(list);
    }
    if (!own.length) lines.push('', '_No accepted statements about this concept yet._');
    if (opts.children && node.children.length) {
      lines.push('', '## Sub-concepts');
      for (const child of node.children) {
        lines.push(`- ${child.title}${child.summary ? ` — ${child.summary}` : ''}`);
      }
    }
    // Only ancestors with something to say; the path line already names them all.
    const enclosing = opts.ancestors
      ? ancestors
          .map((a) => ({ a, list: a.directIds.map((id) => landscape.findings.get(id)).filter(accepted).slice(0, perAncestor) }))
          .filter(({ a, list }) => list.length || a.summary)
      : [];
    if (enclosing.length) {
      lines.push('', '## Context from enclosing concepts');
      for (const { a, list } of enclosing) {
        lines.push(`### ${a.title}${a.summary ? ` — ${a.summary}` : ''}`);
        for (const f of list) {
          ids.push(f.object.id);
          lines.push(statementLine(f));
        }
      }
    }
    if (opts.evidence && evidenceNames.size) {
      lines.push('', '## Linked evidence (titles only; contents not included)');
      for (const name of evidenceNames) lines.push(`- ${name}`);
    }
    return { document: lines.join('\n'), ids };
  };

  const wrap = (document: string) =>
    [
      `You are helping the user develop their understanding of one concept in their project "${project.name}" inside Chatdex.`,
      'Below is exactly what the user has recorded about it: their own statements and accepted understanding. A concept is a subject being modeled — naming it, or stating intended behavior, does not mean it is implemented. Keep intended behavior, beliefs, verified facts, and open questions distinct, and say when something is uncertain.',
      'Help brainstorm, compare alternatives, sharpen specifications, and surface open questions. The user can later ask Chatdex to turn this discussion into proposed updates they review.',
      'The user can see exactly this context in their chat UI.',
      '',
      '---',
      '',
      document,
    ].join('\n');

  const stages = [
    { ancestors: true, children: true, evidence: true },
    { ancestors: true, children: true, evidence: false },
    { ancestors: false, children: true, evidence: false, cap: 12 },
    { ancestors: false, children: false, evidence: false, cap: 6 },
  ];
  let chosen = render(stages[stages.length - 1]);
  let truncated = true;
  for (const [i, stage] of stages.entries()) {
    const candidate = render(stage);
    if (estimateTokens(wrap(candidate.document)) <= maxTokens) {
      chosen = candidate;
      truncated = i > 0;
      break;
    }
  }
  let document = chosen.document;
  if (estimateTokens(wrap(document)) > maxTokens) {
    const budget = Math.max(200, maxTokens * 4 - wrap('').length - 40);
    document = `${document.slice(0, budget)}\n…truncated to fit the context budget.`;
    truncated = true;
  }
  const systemPrompt = wrap(document);
  return {
    systemPrompt,
    document,
    truncated,
    estimatedTokens: estimateTokens(systemPrompt),
    projectName: project.name,
    conceptId,
    conceptTitle: node.title,
    path: [project.name, ...trail.map((n) => n.title)],
    objectIds: [...new Set(chosen.ids)].filter((id) => document.includes(id)),
  };
}

/** Accepted, current findings of a concept and its sub-concepts (Prepare Change preselect). */
export function acceptedConceptIds(landscape: Landscape, node: LandscapeRegionNode): string[] {
  return node.allIds.filter((id) => accepted(landscape.findings.get(id)));
}
