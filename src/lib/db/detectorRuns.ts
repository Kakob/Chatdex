import { db } from './schema';
import type { StoredDetectorRun } from '../../types/detection';

export async function putDetectorRun(run: StoredDetectorRun): Promise<void> {
  await db.detectorRuns.put(run);
}

export async function getDetectorRun(
  id: string
): Promise<StoredDetectorRun | undefined> {
  return db.detectorRuns.get(id);
}

export async function getDetectorRunByKey(
  runKey: string
): Promise<StoredDetectorRun | undefined> {
  return db.detectorRuns.where('runKey').equals(runKey).first();
}

export async function getDetectorRunsForConversation(
  conversationId: string
): Promise<StoredDetectorRun[]> {
  return db.detectorRuns.where('conversationId').equals(conversationId).toArray();
}

export async function getDetectorRunCount(): Promise<number> {
  return db.detectorRuns.count();
}

export async function deleteDetectorRunsForConversation(
  conversationId: string
): Promise<void> {
  await db.detectorRuns.where('conversationId').equals(conversationId).delete();
}
