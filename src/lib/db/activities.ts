import { db } from './schema';
import type { StoredActivity, ActivityFilters, ActivityType } from '../../types';

export async function addActivity(activity: StoredActivity): Promise<string> {
  await db.activities.put(activity);
  return activity.id;
}

export async function bulkPutActivities(activities: StoredActivity[]): Promise<void> {
  if (activities.length === 0) return;
  await db.activities.bulkPut(activities);
}

export async function getActivities(filters?: ActivityFilters): Promise<StoredActivity[]> {
  let collection = db.activities.orderBy('timestamp').reverse();

  if (filters?.source) {
    const source = filters.source;
    collection = collection.filter((a) => a.source === source);
  }
  if (filters?.types && filters.types.length > 0) {
    const types = new Set<ActivityType>(filters.types);
    collection = collection.filter((a) => types.has(a.type));
  }
  if (filters?.dateRange) {
    const { start, end } = filters.dateRange;
    collection = collection.filter((a) => a.timestamp >= start && a.timestamp <= end);
  }
  if (filters?.conversationId) {
    const cid = filters.conversationId;
    collection = collection.filter((a) => a.conversationId === cid);
  }
  if (filters?.search) {
    const needle = filters.search.toLowerCase();
    collection = collection.filter((a) => {
      const m = a.metadata;
      return (
        a.conversationTitle?.toLowerCase().includes(needle) ||
        m.messagePreview?.toLowerCase().includes(needle) ||
        m.fullContent?.toLowerCase().includes(needle) ||
        m.userMessage?.toLowerCase().includes(needle) ||
        m.codeContent?.toLowerCase().includes(needle) ||
        false
      );
    });
  }

  return collection.toArray();
}

export async function getActivityCount(): Promise<number> {
  return db.activities.count();
}

export async function clearActivities(): Promise<void> {
  await db.activities.clear();
}
