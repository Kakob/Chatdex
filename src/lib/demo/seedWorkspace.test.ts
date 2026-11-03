import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, db } from '../db';
import { loadPreparedChangeExportContext, renderPreparedChangeMarkdown } from '../prepare/export';
import { SAMPLE_PROJECT_ID, seedSampleWorkspace } from './seedWorkspace';

beforeEach(async () => {
  await clearAllData();
});

describe('sample workspace', () => {
  it('loads the real golden path with synthetic provenance and is idempotent', async () => {
    const first = await seedSampleWorkspace();
    expect(first).toEqual({ projectId: SAMPLE_PROJECT_ID, created: true });

    const project = await db.understandingProjects.get(SAMPLE_PROJECT_ID);
    expect(project?.name).toContain('sample');
    const [conversation] = await db.conversations.toArray();
    expect(conversation.providerMeta?.sampleWorkspace).toBe('slop-connoisseur-v1');
    const [rawSource] = await db.rawSources.toArray();
    expect(rawSource.rawText).toContain('Synthetic content');

    const [investigation] = await db.investigationCases
      .where('projectId')
      .equals(SAMPLE_PROJECT_ID)
      .toArray();
    expect(investigation).toMatchObject({ kind: 'question', state: 'completed' });
    expect(investigation.searchRecords).toHaveLength(1);
    expect(await db.caseExhibits.where('caseId').equals(investigation.id).count()).toBe(4);
    expect(await db.reviewScopes.where('caseId').equals(investigation.id).count()).toBe(1);

    const findings = await db.investigationFindings
      .where('caseId')
      .equals(investigation.id)
      .toArray();
    expect(findings).toHaveLength(4);
    expect(findings.every((finding) => finding.state === 'finalized')).toBe(true);
    expect(findings.every((finding) => finding.promotedUnderstandingObjectId)).toBe(true);

    const [change] = await db.preparedChanges
      .where('projectId')
      .equals(SAMPLE_PROJECT_ID)
      .toArray();
    expect(change).toMatchObject({ state: 'ready' });
    expect(change.investigationFindingIds).toHaveLength(4);
    expect(change.evidenceRefs).toHaveLength(4);
    const markdown = renderPreparedChangeMarkdown(
      await loadPreparedChangeExportContext(change)
    );
    expect(markdown).toContain('## Acceptance criteria');
    expect(markdown).toContain('Do not silently resolve the open implementation choices');

    expect(await seedSampleWorkspace()).toEqual({
      projectId: SAMPLE_PROJECT_ID,
      created: false,
    });
    expect(await db.understandingProjects.count()).toBe(1);
    expect(await db.investigationCases.count()).toBe(1);
    expect(await db.investigationFindings.count()).toBe(4);
    expect(await db.understandingObjects.count()).toBe(4);
    expect(await db.preparedChanges.count()).toBe(1);
  });
});
