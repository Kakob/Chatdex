import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '../db';
import { createHumanProject } from '../db/understanding';
import { putRepoFiles } from '../db/repoFiles';
import { db } from '../db/schema';
import { createEngineeringExampleProjects, EVENT_QUEUE_PROJECT_ID, TODO_LIST_PROJECT_ID, exampleConceptId } from './demoProjects';
import { engineeringModelDb, installExampleTransitions, createModelSourceBinding, loadEngineeringModel } from './modelStore';
import { bundledEngineeringSources } from './bundledSources';
import { chatGptHandoff, summarizeCodeDiff, compareSourceToProposal } from './codingProtocol';
import { recordSuccessfulWrite, sourceRevisionLabel, stageCodeRevision } from './codingStore';

beforeEach(async () => {
  await clearAllData();
  await engineeringModelDb.transitions.clear();
  await engineeringModelDb.proposals.clear();
  await engineeringModelDb.sourceBindings.clear();
  await engineeringModelDb.codeRevisions.clear();
  await engineeringModelDb.codeWrites.clear();
});

describe('shared coding protocol for human and agents', () => {
  it('stages a human edit and an agent result on the same model target without writing source', async () => {
    await createEngineeringExampleProjects();
    await installExampleTransitions(EVENT_QUEUE_PROJECT_ID);
    const targetId = exampleConceptId('event-queue', 'retry');
    const model = await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID);
    const binding = model.sourceBindings.find((item) => item.targetId === targetId && item.role === 'implementation')!;
    const baselineText = bundledEngineeringSources[binding.path];
    const after = baselineText.replace('async reapExpired(', 'async reapExpired(') + '\n// Example proposed improvement\n';
    const human = await stageCodeRevision({
      projectId: EVENT_QUEUE_PROJECT_ID, targetId, bindingId: binding.id,
      baselineText, proposedText: after, intent: 'Improve retry observability',
      actor: 'human', providerId: 'manual-editor',
    });
    expect(human.proposedHash).not.toBe(human.baselineHash);
    const snapshot = await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID);
    expect(snapshot.codeRevisions).toHaveLength(1);
    expect(snapshot.codeRevisions[0].targetId).toBe(targetId);
    expect(snapshot.codeWrites).toHaveLength(0);
    expect(sourceRevisionLabel(human, [], baselineText)).toBe('staged');
    expect(compareSourceToProposal(human, after)).toBe('matches-proposal');
    expect(compareSourceToProposal(human, 'unrelated')).toBe('diverged');

    const agent = await stageCodeRevision({
      projectId: EVENT_QUEUE_PROJECT_ID, targetId, bindingId: binding.id,
      baselineText, proposedText: after + '// agent result\n', intent: 'Implement retry change',
      actor: 'agent', providerId: chatGptHandoff.id,
    });
    expect((await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID)).codeRevisions).toHaveLength(2);
    expect(agent.providerId).toBe('chatgpt-handoff');
    expect(chatGptHandoff.makeInstructions({
      projectId: EVENT_QUEUE_PROJECT_ID, targetId, targetName: 'Retry',
      baselineText, binding, intent: 'Implement backoff',
    })).toContain('File: ' + binding.path);
    expect(summarizeCodeDiff(baselineText, after).added).toBeGreaterThan(0);
    expect(await db.repoFiles.count()).toBe(0);
  });

  it('requires a non-stale bound file and valid project, never stages an arbitrary path', async () => {
    await createEngineeringExampleProjects();
    await installExampleTransitions(EVENT_QUEUE_PROJECT_ID);
    const targetId = exampleConceptId('event-queue', 'retry');
    const model = await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID);
    const binding = model.sourceBindings.find((b) => b.targetId === targetId && b.role === 'implementation')!;
    const baselineText = bundledEngineeringSources[binding.path];
    const valid = {
      projectId: EVENT_QUEUE_PROJECT_ID, targetId, bindingId: binding.id,
      baselineText, proposedText: baselineText + '\n// change\n',
      intent: 'Revise retry', actor: 'human' as const, providerId: 'manual-editor',
    };
    await expect(stageCodeRevision({ ...valid, proposedText: baselineText })).rejects.toThrow(/No source change/);
    await expect(stageCodeRevision({ ...valid, baselineText: baselineText + '\n// stale' })).rejects.toThrow(/differs/);
    await expect(stageCodeRevision({ ...valid, projectId: TODO_LIST_PROJECT_ID })).rejects.toThrow(/another model entity/);
    await expect(stageCodeRevision({ ...valid, intent: ' ' })).rejects.toThrow(/engineering goal/);
    await expect(stageCodeRevision({ ...valid, proposedText: ' '.repeat(250_000) })).rejects.toThrow(/cannot be empty|size limit/);
    expect((await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID)).codeRevisions).toHaveLength(0);
  });

  it('supports code staging on an unrelated project through indexed source binding', async () => {
    const project = await createHumanProject({ name: 'Unfamiliar software' });
    const targetId = 'unfamiliar-component';
    await db.landscapeRegions.add({
      id: targetId, projectId: project.id, title: 'Subsystem', summary: 'Unrelated app component',
      parentRegionId: null, order: 0, kind: 'component', memberObjectIds: [], pinnedObjectIds: [],
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sha = 'a'.repeat(40), path = 'src/core/engine.ts';
    const binding = await createModelSourceBinding({
      projectId: project.id, targetId, role: 'implementation', repoKey: 'gh:Example/Other',
      path, sha, sourceKind: 'indexed', needle: 'export function run',
      label: 'Engine', origin: 'manual',
    });
    const baselineText = 'export function run() { return 1; }\n';
    await putRepoFiles([{ repoKey: binding.repoKey, sha, path, content: baselineText,
      size: baselineText.length, fetchedAt: new Date() }]);
    const edit = await stageCodeRevision({
      projectId: project.id, targetId, bindingId: binding.id,
      baselineText, proposedText: 'export function run() { return 2; }\n',
      intent: 'Change engine output', actor: 'agent', providerId: 'other-agent',
    });
    expect(edit.repoKey).toBe('gh:Example/Other');
    expect((await loadEngineeringModel(project.id)).kind).toBeNull();
    expect((await loadEngineeringModel(project.id)).codeRevisions).toHaveLength(1);
    await recordSuccessfulWrite(edit.id, 'local-folder-confirmed');
    expect(sourceRevisionLabel(edit, (await loadEngineeringModel(project.id)).codeWrites)).toBe('written-unverified');
    expect(sourceRevisionLabel(edit, [], edit.proposedText)).toBe('observed-source-match');
  });
});
