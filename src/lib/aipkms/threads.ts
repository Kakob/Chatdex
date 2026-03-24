// Thread management utilities
import type { Thread } from './types';

export function createThread(name: string, description?: string): Thread {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    name,
    description: description || null,
    workspaceId: null,
    itemIds: [],
    isLiving: false,
    livingCriteria: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function createLivingThread(
  name: string,
  criteria: Record<string, unknown>,
  description?: string
): Thread {
  return {
    ...createThread(name, description),
    isLiving: true,
    livingCriteria: criteria,
  };
}

export function addItemToThread(thread: Thread, itemId: string): Thread {
  if (thread.itemIds.includes(itemId)) return thread;
  return {
    ...thread,
    itemIds: [...thread.itemIds, itemId],
    updatedAt: new Date(),
  };
}

export function removeItemFromThread(thread: Thread, itemId: string): Thread {
  return {
    ...thread,
    itemIds: thread.itemIds.filter((id) => id !== itemId),
    updatedAt: new Date(),
  };
}

export function reorderThreadItems(thread: Thread, newOrder: string[]): Thread {
  const currentSet = new Set(thread.itemIds);
  const newSet = new Set(newOrder);

  // Validate same items
  if (currentSet.size !== newSet.size) {
    throw new Error('New order must contain the same items');
  }
  for (const id of newOrder) {
    if (!currentSet.has(id)) {
      throw new Error(`Item ${id} is not in the thread`);
    }
  }

  return {
    ...thread,
    itemIds: newOrder,
    updatedAt: new Date(),
  };
}
