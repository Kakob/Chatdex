import { useState, useEffect, useCallback } from 'react';
import { db, getConversations, getMessagesForConversation } from '../lib/db';
import type { StoredConversation, StoredMessage, DataSource } from '../types';

interface UseConversationsOptions {
  source?: DataSource;
  limit?: number;
}

interface UseConversationsReturn {
  conversations: StoredConversation[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

export function useConversations(
  options: UseConversationsOptions = {}
): UseConversationsReturn {
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const limit = options.limit ?? 50;

  const loadConversations = useCallback(async (reset = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const currentOffset = reset ? 0 : offset;
      const results = await getConversations({
        source: options.source,
        limit: limit + 1, // Fetch one extra to check if there are more
        offset: currentOffset,
      });

      const hasMoreResults = results.length > limit;
      const items = hasMoreResults ? results.slice(0, limit) : results;

      if (reset) {
        setConversations(items);
        setOffset(items.length);
      } else {
        setConversations((prev) => [...prev, ...items]);
        setOffset((prev) => prev + items.length);
      }

      setHasMore(hasMoreResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setIsLoading(false);
    }
  }, [offset, limit, options.source]);

  useEffect(() => {
    loadConversations(true);
    // Offset is managed by loadConversations; adding the callback itself here
    // would re-fetch after every page append.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.source]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      loadConversations(false);
    }
  }, [isLoading, hasMore, loadConversations]);

  const refresh = useCallback(() => {
    setOffset(0);
    loadConversations(true);
  }, [loadConversations]);

  return {
    conversations,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
  };
}

interface UseConversationReturn {
  conversation: StoredConversation | null;
  messages: StoredMessage[];
  isLoading: boolean;
  error: string | null;
}

export function useConversation(id: string | null): UseConversationReturn {
  const [conversation, setConversation] = useState<StoredConversation | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setConversation(null);
      setMessages([]);
      setIsLoading(false);
      return;
    }

    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [conv, msgs] = await Promise.all([
          db.conversations.get(id),
          getMessagesForConversation(id),
        ]);

        if (!conv) {
          setError('Conversation not found');
          return;
        }

        setConversation(conv);
        setMessages(msgs);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load conversation');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [id]);

  return {
    conversation,
    messages,
    isLoading,
    error,
  };
}
