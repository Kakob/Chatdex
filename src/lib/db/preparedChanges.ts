import { db } from './schema';
import type { PreparedChange } from '../../types/preparedChange';

export async function putPreparedChange(change: PreparedChange): Promise<void> {
  await db.preparedChanges.put(change);
}

export async function getPreparedChange(id: string): Promise<PreparedChange | undefined> {
  return db.preparedChanges.get(id);
}

export async function listPreparedChangesForProject(
  projectId: string
): Promise<PreparedChange[]> {
  const rows = await db.preparedChanges
    .where('[projectId+updatedAt]')
    .between([projectId, new Date(0)], [projectId, new Date(8.64e15)])
    .toArray();
  return rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}
