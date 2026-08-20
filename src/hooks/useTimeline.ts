import { useState, useEffect, useCallback } from 'react';
import { getActivities } from '../lib/db';
import type { StoredActivity, ActivityFilters, ConversationGroup, TokenUsage } from '../types';

interface UseTimelineOptions {
  filters?: ActivityFilters;
  groupByConversation?: boolean;
}

interface UseTimelineResult {
  activities: StoredActivity[];
  groups: ConversationGroup[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useTimeline(options: UseTimelineOptions = {}): UseTimelineResult {
  const { filters, groupByConversation = false } = options;
  const [activities, setActivities] = useState<StoredActivity[]>([]);
  const [groups, setGroups] = useState<ConversationGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchActivities = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await getActivities(filters);
      setActivities(data);

      if (groupByConversation) {
        setGroups(groupActivitiesByConversation(data));
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch activities'));
    } finally {
      setIsLoading(false);
    }
  }, [filters, groupByConversation]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // Listen for new activities from the extension
  useEffect(() => {
    const handleNewActivity = () => {
      console.log('[Timeline] New activity detected, refreshing...');
      fetchActivities();
    };

    window.addEventListener('chatdex-activity', handleNewActivity);
    return () => {
      window.removeEventListener('chatdex-activity', handleNewActivity);
    };
  }, [fetchActivities]);

  return {
    activities,
    groups,
    isLoading,
    error,
    refresh: fetchActivities,
  };
}

function groupActivitiesByConversation(activities: StoredActivity[]): ConversationGroup[] {
  const groupMap = new Map<string, ConversationGroup>();

  for (const activity of activities) {
    const key = activity.conversationId ?? 'no-conversation';

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        conversationId: activity.conversationId ?? '',
        conversationTitle: activity.conversationTitle ?? 'Unknown Conversation',
        activities: [],
        totalTokens: { inputTokens: 0, outputTokens: 0 },
        activityCount: 0,
        firstActivity: activity.timestamp,
        lastActivity: activity.timestamp,
      });
    }

    const group = groupMap.get(key)!;
    group.activities.push(activity);
    group.activityCount += 1;

    if (activity.tokens) {
      group.totalTokens.inputTokens += activity.tokens.inputTokens;
      group.totalTokens.outputTokens += activity.tokens.outputTokens;
    }

    if (activity.timestamp < group.firstActivity) {
      group.firstActivity = activity.timestamp;
    }
    if (activity.timestamp > group.lastActivity) {
      group.lastActivity = activity.timestamp;
    }
  }

  return Array.from(groupMap.values()).sort(
    (a, b) => b.lastActivity.getTime() - a.lastActivity.getTime()
  );
}

export function formatTokenCount(tokens: TokenUsage | null): string {
  if (!tokens) return '-';
  const total = tokens.inputTokens + tokens.outputTokens;
  if (total >= 1000000) {
    return `${(total / 1000000).toFixed(1)}M`;
  }
  if (total >= 1000) {
    return `${(total / 1000).toFixed(1)}K`;
  }
  return total.toString();
}
