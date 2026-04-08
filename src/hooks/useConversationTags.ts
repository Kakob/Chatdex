import { useState, useEffect, useCallback, useRef } from 'react';
import { tagApi, type ApiTag } from '../lib/api';

interface UseConversationTagsReturn {
  tagsMap: Map<string, ApiTag[]>;
  isLoading: boolean;
  refresh: () => void;
}

export function useConversationTags(conversationIds: string[]): UseConversationTagsReturn {
  const [tagsMap, setTagsMap] = useState<Map<string, ApiTag[]>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const prevIdsRef = useRef<string>('');

  const fetchTags = useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      setTagsMap(new Map());
      return;
    }

    setIsLoading(true);
    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const tags = await tagApi.getEntityTags('conversation', id);
            return [id, tags] as const;
          } catch {
            return [id, [] as ApiTag[]] as const;
          }
        })
      );
      setTagsMap(new Map(results));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const key = conversationIds.slice().sort().join(',');
    if (key === prevIdsRef.current) return;
    prevIdsRef.current = key;
    fetchTags(conversationIds);
  }, [conversationIds, fetchTags]);

  const refresh = useCallback(() => {
    fetchTags(conversationIds);
  }, [conversationIds, fetchTags]);

  return { tagsMap, isLoading, refresh };
}
