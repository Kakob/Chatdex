import { db } from './schema';

export async function getMetadata<T = unknown>(key: string): Promise<T | undefined> {
  const row = await db.metadata.get(key);
  return row ? (row.value as T) : undefined;
}

export async function setMetadata(key: string, value: unknown): Promise<void> {
  await db.metadata.put({ key, value });
}

export async function deleteMetadata(key: string): Promise<void> {
  await db.metadata.delete(key);
}

export async function clearMetadata(): Promise<void> {
  await db.metadata.clear();
}
