// Database abstraction layer - now uses API calls instead of IndexedDB
// Maintains the same function signatures for backward compatibility

import { api, type ApiConversation, type ApiMessage, type ApiActivity } from './api';
import type {
  StoredConversation,
  StoredMessage,
  StoredActivity,
  DailyStats,
  ActivityFilters,
} from '../types';

// Helper to convert API response dates to Date objects
function toStoredConversation(conv: ApiConversation): StoredConversation {
  return {
    ...conv,
    createdAt: new Date(conv.createdAt),
    updatedAt: new Date(conv.updatedAt),
    importedAt: new Date(conv.importedAt),
  };
}

function toStoredMessage(msg: ApiMessage): StoredMessage {
  return {
    ...msg,
    createdAt: new Date(msg.createdAt),
  };
}

function toStoredActivity(activity: ApiActivity): StoredActivity {
  return {
    ...activity,
    timestamp: new Date(activity.timestamp),
  };
}

// Conversation functions
export async function getConversation(id: string): Promise<StoredConversation | undefined> {
  try {
    const conv = await api.getConversation(id);
    return toStoredConversation(conv);
  } catch {
    return undefined;
  }
}

export async function getConversations(options?: {
  source?: 'claude.ai' | 'claude-code';
  limit?: number;
  offset?: number;
}): Promise<StoredConversation[]> {
  const response = await api.getConversations(options);
  return response.data.map(toStoredConversation);
}

export async function getMessagesForConversation(
  conversationId: string
): Promise<StoredMessage[]> {
  const messages = await api.getMessagesForConversation(conversationId);
  return messages.map(toStoredMessage);
}

export async function getConversationCount(): Promise<number> {
  const counts = await api.getCounts();
  return counts.conversations;
}

export async function getMessageCount(): Promise<number> {
  const counts = await api.getCounts();
  return counts.messages;
}

// Metadata functions
export async function getMetadata<T>(key: string): Promise<T | undefined> {
  return api.getMetadata<T>(key);
}

export async function setMetadata(key: string, value: unknown): Promise<void> {
  return api.setMetadata(key, value);
}

// Data management functions
export async function clearAllData(): Promise<void> {
  return api.clearAllData();
}

export async function clearDataBySource(source: 'claude.ai' | 'claude-code'): Promise<void> {
  return api.clearDataBySource(source);
}

// Activity tracking functions
export async function addActivity(activity: StoredActivity): Promise<string> {
  const apiActivity = {
    ...activity,
    timestamp: activity.timestamp.toISOString(),
  };
  const result = await api.addActivity(apiActivity);
  return result.id;
}

export async function getActivities(filters?: ActivityFilters): Promise<StoredActivity[]> {
  const apiFilters: Parameters<typeof api.getActivities>[0] = {};

  if (filters?.source) {
    apiFilters.source = filters.source;
  }

  if (filters?.types && filters.types.length > 0) {
    apiFilters.types = filters.types.join(',');
  }

  if (filters?.dateRange) {
    apiFilters.startDate = filters.dateRange.start.toISOString();
    apiFilters.endDate = filters.dateRange.end.toISOString();
  }

  if (filters?.conversationId) {
    apiFilters.conversationId = filters.conversationId;
  }

  if (filters?.search) {
    apiFilters.search = filters.search;
  }

  const activities = await api.getActivities(apiFilters);
  return activities.map(toStoredActivity);
}

export async function getActivityCount(): Promise<number> {
  const counts = await api.getCounts();
  return counts.activities;
}

// Daily stats functions
export async function getDailyStats(startDate: string, endDate: string): Promise<DailyStats[]> {
  return api.getDailyStats(startDate, endDate);
}

export async function updateDailyStats(
  date: string,
  updates: Partial<Omit<DailyStats, 'date'>>
): Promise<void> {
  return api.updateDailyStats(date, updates);
}

export async function clearActivities(): Promise<void> {
  return api.clearActivities();
}

// Export a dummy db object for any code that might reference it directly
// This is a transitional measure - all direct db access should be removed
export const db = {
  conversations: {
    count: getConversationCount,
    get: getConversation,
    toArray: () => getConversations(),
  },
  messages: {
    count: getMessageCount,
  },
  activities: {
    count: getActivityCount,
  },
};
