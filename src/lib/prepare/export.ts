import { db } from '../db/schema';
import type { PreparedChange } from '../../types/preparedChange';
import type { UnderstandingObject, UnderstandingProject } from '../../types/understanding';

export interface PreparedChangeExportContext {
  change: PreparedChange;
  project: UnderstandingProject;
  understanding: UnderstandingObject[];
}

export async function loadPreparedChangeExportContext(
  change: PreparedChange
): Promise<PreparedChangeExportContext> {
  const project = await db.understandingProjects.get(change.projectId);
  if (!project) throw new Error(`Project not found: ${change.projectId}`);
  const rows = await db.understandingObjects.bulkGet(change.understandingPointIds);
  const understanding = rows.filter((row): row is UnderstandingObject => Boolean(row));
  if (understanding.length !== change.understandingPointIds.length) {
    throw new Error('One or more selected understanding points no longer resolve');
  }
  return { change, project, understanding };
}

function section(title: string, lines: string[]): string[] {
  return lines.length > 0 ? [`## ${title}`, '', ...lines, ''] : [];
}

function bullets(lines: string[]): string[] {
  return lines.map((line) => `- ${line}`);
}

export function renderPreparedChangeMarkdown({
  change,
  project,
  understanding,
}: PreparedChangeExportContext): string {
  const byId = new Map(understanding.map((point) => [point.id, point]));
  const orderedUnderstanding = change.understandingPointIds
    .map((id) => byId.get(id))
    .filter((point): point is UnderstandingObject => Boolean(point));
  const repository = change.repositoryRef;
  const lines: string[] = [
    `# ${change.title}`,
    '',
    `**Project:** ${project.name}`,
    `**State:** ${change.state}`,
  ];
  if (repository?.remoteUrl) lines.push(`**Repository:** ${repository.remoteUrl}`);
  if (repository?.baseCommit) lines.push(`**Base commit:** ${repository.baseCommit}`);
  lines.push('');

  lines.push(...section('Desired outcome', [change.desiredOutcome]));
  lines.push(...section('Rationale', change.rationale ? [change.rationale] : []));
  lines.push(
    ...section(
      'Current understanding',
      orderedUnderstanding.flatMap((point) => [
        `- **${point.type}: ${point.title}**${point.body ? ` — ${point.body}` : ''}`,
        ...change.evidenceRefs
          .filter((ref) => ref.understandingPointId === point.id)
          .map(
            (ref) =>
              `  - Evidence: conversation \`${ref.conversationId}\`${
                ref.messageIds?.length ? `, messages ${ref.messageIds.map((id) => `\`${id}\``).join(', ')}` : ''
              }${ref.note ? ` — ${ref.note}` : ''}`
          ),
      ])
    )
  );
  lines.push(...section('Constraints', bullets(change.constraints)));
  lines.push(...section('Non-goals', bullets(change.nonGoals)));
  lines.push(...section('Acceptance criteria', bullets(change.acceptanceCriteria)));
  lines.push(
    ...section('Open implementation choices', bullets(change.openImplementationChoices))
  );
  if (repository?.implicatedPaths?.length) {
    lines.push(...section('Implicated paths', bullets(repository.implicatedPaths)));
  }
  lines.push(
    ...section('Implementation instructions', [
      'Inspect the current repository and verify these assumptions before editing. Do not silently resolve the open implementation choices.',
      '',
      'Report the files changed, tests run, material decisions made, and any deviation from this handoff.',
    ])
  );

  return `${lines.join('\n').trim()}\n`;
}

export function renderPreparedChangeJson(context: PreparedChangeExportContext): string {
  const { change, project, understanding } = context;
  return `${JSON.stringify(
    {
      ...change,
      createdAt: change.createdAt.toISOString(),
      updatedAt: change.updatedAt.toISOString(),
      readyAt: change.readyAt?.toISOString(),
      project: { id: project.id, name: project.name, description: project.description },
      understanding: change.understandingPointIds.map((id) => {
        const point = understanding.find((candidate) => candidate.id === id)!;
        return {
          id: point.id,
          type: point.type,
          title: point.title,
          body: point.body,
          status: point.status,
          reviewState: point.reviewState,
        };
      }),
    },
    null,
    2
  )}\n`;
}
