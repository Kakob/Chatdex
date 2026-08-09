// Living understanding document (PRD §14, phase U4.2).
//
// Deterministic markdown projection of a project's current understanding.
// No LLM call: the objects were already synthesized; this only renders them.
// The same projection doubles as the agent-context seed for U5.2, which is
// why provenance is plain markdown footnotes — readable in-app, in an
// exported file, and as injected model context.
//
// Determinism contract: identical input produces an identical string. Dates
// render as UTC ISO days (never locale), and the generation timestamp is
// caller-supplied via options — the renderer itself never reads the clock.

import type { UnderstandingProject } from '../../types/understanding';
import type {
  CurrentUnderstanding,
  UnderstandingItem,
  RecentChange,
  EvidenceLink,
} from './currentUnderstanding';

export const OP_LABEL: Record<string, string> = {
  introduced: 'Introduced',
  supported: 'Supported',
  refined: 'Refined',
  superseded: 'Superseded',
  contradicted: 'Contradicted',
  reopened: 'Reopened',
  resolved: 'Resolved',
};

export interface LivingDocumentOptions {
  /** Include pending (unreviewed) objects, annotated as such. Default true. */
  includePending?: boolean;
  /** Rendered as a generation stamp when provided; omit for a stable doc. */
  generatedAt?: Date;
}

/** `understanding-<project-slug>` — prefix for downloadExport. */
export function livingDocumentFilenamePrefix(project: UnderstandingProject | null): string {
  const slug = (project?.name ?? 'unassigned')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `understanding-${slug || 'project'}`;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** 'decision' → 'Decisions', 'query' → 'Queries', 'process' → 'Processes'. */
function typeHeading(type: string): string {
  const cap = type.charAt(0).toUpperCase() + type.slice(1);
  if (/(s|x|ch|sh)$/.test(type)) return `${cap}es`;
  if (/[^aeiou]y$/.test(type)) return `${cap.slice(0, -1)}ies`;
  return `${cap}s`;
}

/**
 * Footnote registry: one footnote per cited conversation across the whole
 * document, numbered in first-citation order so repeat citations reuse the
 * same number.
 */
interface Footnotes {
  numbers: Map<string, number>;
  labels: string[];
}

function cite(evidence: EvidenceLink[], footnotes: Footnotes): string {
  return evidence
    .map((ref) => {
      let n = footnotes.numbers.get(ref.conversationId);
      if (n === undefined) {
        n = footnotes.numbers.size + 1;
        footnotes.numbers.set(ref.conversationId, n);
        const name = ref.conversationName ?? '(deleted conversation)';
        footnotes.labels.push(ref.note ? `${name} — “${ref.note}”` : name);
      }
      return `[^${n}]`;
    })
    .join('');
}

function renderItem(item: UnderstandingItem, footnotes: Footnotes): string[] {
  const { object } = item;
  const marker = object.reviewState === 'pending' ? ' *(pending review)*' : '';
  const lines = [`- **${object.title}**${marker}${cite(item.evidence, footnotes)}`];
  if (object.body) {
    lines.push(...object.body.split('\n').map((l) => `  ${l}`));
  }
  return lines;
}

function renderSection(
  heading: string,
  items: UnderstandingItem[],
  footnotes: Footnotes
): string[] {
  if (items.length === 0) return [];
  return [`## ${heading}`, '', ...items.flatMap((i) => renderItem(i, footnotes)), ''];
}

function renderChange(change: RecentChange): string {
  const { event } = change;
  const parts = [
    `- ${isoDay(event.occurredAt)} — ${OP_LABEL[event.op] ?? event.op}: ${change.objectTitle}`,
  ];
  if (change.supersededByTitle) parts.push(` → ${change.supersededByTitle}`);
  if (event.detail) parts.push(` — ${event.detail}`);
  if (event.reviewState === 'pending') parts.push(' *(pending)*');
  return parts.join('');
}

/**
 * Render the living understanding document for one project (or the
 * unassigned bucket, project null). Pure projection over an assembled
 * `CurrentUnderstanding` — see the determinism contract above.
 */
export function renderLivingDocument(
  project: UnderstandingProject | null,
  understanding: CurrentUnderstanding,
  options: LivingDocumentOptions = {}
): string {
  const includePending = options.includePending ?? true;
  const keep = (items: UnderstandingItem[]) =>
    includePending ? items : items.filter((i) => i.object.reviewState !== 'pending');

  const direction = keep(understanding.direction);
  const ideasAndDecisions = keep(understanding.ideasAndDecisions);
  const openQuestions = keep(understanding.openQuestions);

  // Without pending: drop pending events AND changes that target a pending
  // object — its 'introduced' event is always accepted (U3.1: the object's
  // reviewState gates existence), so filtering by event state alone would
  // still name the excluded object in Recent Changes.
  const pendingObjectIds = new Set(
    [...understanding.direction, ...understanding.ideasAndDecisions, ...understanding.openQuestions]
      .filter((i) => i.object.reviewState === 'pending')
      .map((i) => i.object.id)
  );
  const recentChanges = includePending
    ? understanding.recentChanges
    : understanding.recentChanges.filter(
        (c) => c.event.reviewState !== 'pending' && !pendingObjectIds.has(c.event.objectId)
      );

  const footnotes: Footnotes = { numbers: new Map(), labels: [] };
  const lines: string[] = [];

  lines.push(`# ${project?.name ?? 'Unassigned'} — Current Understanding`, '');
  if (project?.description) lines.push(project.description, '');
  lines.push(
    `*${
      options.generatedAt ? `Generated ${isoDay(options.generatedAt)}. ` : ''
    }This document is a projection of the underlying understanding — regenerate it rather than editing it.*`,
    ''
  );

  lines.push(...renderSection('Current Direction', direction, footnotes));

  // Open ontology (PRD §7): group the ideas-and-decisions bucket by type, in
  // recency order of each type's first (most recent) item.
  const byType = new Map<string, UnderstandingItem[]>();
  for (const item of ideasAndDecisions) {
    const list = byType.get(item.object.type) ?? [];
    list.push(item);
    byType.set(item.object.type, list);
  }
  for (const [type, items] of byType) {
    lines.push(...renderSection(typeHeading(type), items, footnotes));
  }

  lines.push(...renderSection('Open Questions', openQuestions, footnotes));

  if (recentChanges.length > 0) {
    lines.push('## Recent Changes', '');
    lines.push(...recentChanges.map(renderChange), '');
  }

  const empty =
    direction.length === 0 &&
    ideasAndDecisions.length === 0 &&
    openQuestions.length === 0 &&
    recentChanges.length === 0;
  if (empty) lines.push('*No understanding synthesized for this project yet.*', '');

  if (footnotes.labels.length > 0) {
    lines.push('---', '');
    lines.push(...footnotes.labels.map((label, i) => `[^${i + 1}]: ${label}`), '');
  }

  // Single trailing newline.
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}
