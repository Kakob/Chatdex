import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData } from '../db';
import { bundledEngineeringSources } from './bundledSources';
import { createEngineeringExampleProjects, EVENT_QUEUE_PROJECT_ID, exampleConceptId } from './demoProjects';
import { engineeringModelDb, installExampleTransitions, loadEngineeringModel } from './modelStore';
import { stageCodeRevision } from './codingStore';
import { writeRevisionToPickedFolder, type DirectoryPicker, type WritableDirectoryLike } from './localWorkspaceWriter';

beforeEach(async () => {
  await clearAllData();
  await engineeringModelDb.proposals.clear();
  await engineeringModelDb.transitions.clear();
  await engineeringModelDb.sourceBindings.clear();
  await engineeringModelDb.codeRevisions.clear();
  await engineeringModelDb.codeWrites.clear();
});

async function sample() {
  await createEngineeringExampleProjects();
  await installExampleTransitions(EVENT_QUEUE_PROJECT_ID);
  const model = await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID);
  const targetId = exampleConceptId('event-queue', 'retry');
  const binding = model.sourceBindings.find((b) => b.targetId === targetId && b.role === 'implementation')!;
  const baselineText = bundledEngineeringSources[binding.path];
  const proposedText = baselineText + '\n// changed deliberately\n';
  const edit = await stageCodeRevision({
    projectId: EVENT_QUEUE_PROJECT_ID, targetId, bindingId: binding.id,
    baselineText, proposedText, actor: 'human', providerId: 'manual-editor', intent: 'Change retry code',
  });
  return { edit, baselineText, proposedText };
}

function fakeDirectoryFor(path: string, readOriginal: () => string, writes: string[]) {
  const parts = path.split('/');
  let current = readOriginal();
  const file = {
    getFile: vi.fn(async () => ({ text: async () => readOriginal() })),
    createWritable: vi.fn(async () => ({
      write: async (text: string) => { writes.push(text); current = text; },
      close: async () => {},
      abort: async () => {},
    })),
    current: () => current,
  };
  const makeDir = (index: number): WritableDirectoryLike => ({
    async getDirectoryHandle(name: string) {
      if (name !== parts[index]) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
      return makeDir(index + 1);
    },
    async getFileHandle(name: string) {
      if (name !== parts[parts.length - 1] || index !== parts.length - 1) {
        throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
      }
      return file;
    },
  });
  return { file, pick: vi.fn(async () => makeDir(0)) as DirectoryPicker };
}

describe('isolated user-granted local write adapter', () => {
  it('writes only an exactly matched staged file and records a receipt after success', async () => {
    const { edit, baselineText, proposedText } = await sample();
    const writes: string[] = [];
    const fake = fakeDirectoryFor(edit.path, () => baselineText, writes);
    const result = await writeRevisionToPickedFolder(edit, fake.pick);
    expect(result.path).toBe(edit.path);
    expect(result.bytesWritten).toBe(new TextEncoder().encode(proposedText).length);
    expect(fake.pick).toHaveBeenCalledWith({ mode: 'readwrite', id: 'chatdex-code-write' });
    expect(writes).toEqual([proposedText]);
    expect((await loadEngineeringModel(edit.projectId)).codeWrites).toHaveLength(1);
  });

  it('does not write or report success if the file changed outside Chatdex', async () => {
    const { edit } = await sample();
    const writes: string[] = [];
    const fake = fakeDirectoryFor(edit.path, () => 'externally modified', writes);
    await expect(writeRevisionToPickedFolder(edit, fake.pick)).rejects.toThrow(/different from the staged baseline/);
    expect(writes).toEqual([]);
    expect(fake.file.createWritable).not.toHaveBeenCalled();
    expect((await loadEngineeringModel(edit.projectId)).codeWrites).toHaveLength(0);
  });

  it('refuses unsaved revisions before opening the write picker', async () => {
    const { edit } = await sample();
    const fake = fakeDirectoryFor(edit.path, () => edit.baselineText, []);
    await expect(writeRevisionToPickedFolder({ ...edit, id: 'never-staged' }, fake.pick))
      .rejects.toThrow(/not an unchanged, staged code edit/);
    expect(fake.pick).not.toHaveBeenCalled();
  });

  it('refuses a selected folder missing the requested relative path', async () => {
    const { edit } = await sample();
    const writes: string[] = [];
    const fake = fakeDirectoryFor('totally/other.ts', () => edit.baselineText, writes);
    await expect(writeRevisionToPickedFolder(edit, fake.pick)).rejects.toThrow(/does not contain the exact bound path/);
    expect(writes).toHaveLength(0);
    expect((await loadEngineeringModel(edit.projectId)).codeWrites).toHaveLength(0);
  });
});
