// API client for communicating with the backend

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3003/api';

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;

  let url = `${API_URL}${endpoint}`;

  // Add query parameters
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(response.status, errorData.error || response.statusText);
  }

  return response.json();
}

// Types matching the backend API
export interface ApiConversation {
  id: string;
  source: 'claude.ai' | 'claude-code';
  name: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  importedAt: string;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  estimatedTokens: number;
  fullText: string;
  projectPath?: string;
  gitBranch?: string;
  workingDirectory?: string;
}

export interface ApiMessage {
  id: string;
  conversationId: string;
  sender: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  contentBlocks?: Array<{
    type: 'text' | 'code' | 'thinking' | 'tool_use' | 'tool_result' | 'artifact' | 'unsupported';
    text?: string;
    language?: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    artifactTitle?: string;
    artifactType?: string;
  }>;
  conversationName?: string;
  createdAt: string;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
}

export interface ApiActivity {
  id: string;
  type: 'message_sent' | 'message_received' | 'artifact_created' | 'code_block' | 'tool_use' | 'tool_result';
  source: 'claude.ai' | 'extension';
  conversationId: string | null;
  conversationTitle: string | null;
  model: string | null;
  timestamp: string;
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  } | null;
  metadata: {
    messageRole?: 'user' | 'assistant';
    messagePreview?: string;
    fullContent?: string;
    userMessage?: string;
    artifactTitle?: string;
    artifactType?: string;
    codeLanguage?: string;
    codeContent?: string;
    toolName?: string;
  };
}

export interface ApiDailyStats {
  date: string;
  inputTokens: number;
  outputTokens: number;
  messageCount: number;
  artifactCount: number;
  toolUseCount: number;
  modelUsage: Record<string, number>;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface ImportResult {
  conversationsAdded: number;
  conversationsSkipped: number;
  messagesAdded: number;
  source: 'claude.ai' | 'claude-code';
}

// API Methods

// Conversations
export const api = {
  // Conversations
  async getConversations(options?: {
    source?: 'claude.ai' | 'claude-code';
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<ApiConversation>> {
    return fetchApi('/conversations', { params: options });
  },

  async getConversation(id: string): Promise<ApiConversation> {
    return fetchApi(`/conversations/${encodeURIComponent(id)}`);
  },

  async getMessagesForConversation(conversationId: string): Promise<ApiMessage[]> {
    return fetchApi(`/conversations/${encodeURIComponent(conversationId)}/messages`);
  },

  async deleteConversations(source?: 'claude.ai' | 'claude-code'): Promise<void> {
    await fetchApi('/conversations', {
      method: 'DELETE',
      params: source ? { source } : undefined,
    });
  },

  async deleteConversation(id: string): Promise<void> {
    await fetchApi(`/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // Messages
  async getMessages(conversationId: string): Promise<ApiMessage[]> {
    return fetchApi('/messages', { params: { conversationId } });
  },

  // Activities
  async getActivities(filters?: {
    source?: 'claude.ai' | 'extension';
    types?: string;
    startDate?: string;
    endDate?: string;
    conversationId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiActivity[]> {
    return fetchApi('/activities', { params: filters });
  },

  async addActivity(activity: Omit<ApiActivity, 'id'> & { id?: string }): Promise<{ id: string }> {
    const activityWithId = {
      ...activity,
      id: activity.id || crypto.randomUUID(),
    };
    return fetchApi('/activities', {
      method: 'POST',
      body: JSON.stringify(activityWithId),
    });
  },

  async clearActivities(): Promise<void> {
    await fetchApi('/activities', { method: 'DELETE' });
  },

  // Stats
  async getDailyStats(startDate: string, endDate: string): Promise<ApiDailyStats[]> {
    return fetchApi('/stats/daily', { params: { startDate, endDate } });
  },

  async updateDailyStats(date: string, updates: Partial<Omit<ApiDailyStats, 'date'>>): Promise<void> {
    await fetchApi(`/stats/daily/${encodeURIComponent(date)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  // Metadata
  async getMetadata<T>(key: string): Promise<T | undefined> {
    try {
      const result = await fetchApi<{ key: string; value: T }>(`/metadata/${encodeURIComponent(key)}`);
      return result.value;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  },

  async setMetadata(key: string, value: unknown): Promise<void> {
    await fetchApi(`/metadata/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  },

  async deleteMetadata(key: string): Promise<void> {
    await fetchApi(`/metadata/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  },

  // Import
  async importData(payload: {
    conversations: Array<{
      id: string;
      source: 'claude.ai' | 'claude-code';
      name: string;
      summary?: string | null;
      createdAt: string;
      updatedAt: string;
      importedAt?: string;
      messageCount?: number;
      userMessageCount?: number;
      assistantMessageCount?: number;
      estimatedTokens?: number;
      fullText?: string;
      projectPath?: string;
      gitBranch?: string;
      workingDirectory?: string;
    }>;
    messages: Array<{
      id: string;
      conversationId: string;
      sender: 'user' | 'assistant' | 'system' | 'tool';
      text: string;
      contentBlocks?: ApiMessage['contentBlocks'];
      conversationName?: string;
      createdAt: string;
      toolName?: string;
      toolInput?: string;
      toolResult?: string;
    }>;
    source: 'claude.ai' | 'claude-code';
  }): Promise<ImportResult> {
    return fetchApi('/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Counts
  async getCounts(): Promise<{
    conversations: number;
    messages: number;
    activities: number;
  }> {
    return fetchApi('/counts');
  },

  // Clear all data
  async clearAllData(): Promise<void> {
    await Promise.all([
      fetchApi('/conversations', { method: 'DELETE' }),
      fetchApi('/activities', { method: 'DELETE' }),
      fetchApi('/metadata', { method: 'DELETE' }),
    ]);
  },

  // Clear data by source
  async clearDataBySource(source: 'claude.ai' | 'claude-code'): Promise<void> {
    await fetchApi('/conversations', {
      method: 'DELETE',
      params: { source },
    });
  },
};

// Tags
export interface ApiTag {
  id: string;
  name: string;
  color: string | null;
  category: string | null;
  usageCount: number;
  createdAt: string;
}

export const tagApi = {
  async getTags(query?: string, category?: string): Promise<ApiTag[]> {
    return fetchApi('/tags', { params: { q: query, category } });
  },

  async createTag(tag: { name: string; color?: string; category?: string }): Promise<ApiTag> {
    return fetchApi('/tags', {
      method: 'POST',
      body: JSON.stringify(tag),
    });
  },

  async updateTag(id: string, updates: { name?: string; color?: string; category?: string }): Promise<ApiTag> {
    return fetchApi(`/tags/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async deleteTag(id: string): Promise<void> {
    await fetchApi(`/tags/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async tagEntity(tagId: string, entityId: string, entityType: string): Promise<void> {
    await fetchApi('/tags/entity', {
      method: 'POST',
      body: JSON.stringify({ tagId, entityId, entityType }),
    });
  },

  async untagEntity(tagId: string, entityId: string, entityType: string): Promise<void> {
    await fetchApi('/tags/entity', {
      method: 'DELETE',
      body: JSON.stringify({ tagId, entityId, entityType }),
    });
  },

  async getEntityTags(entityType: string, entityId: string): Promise<ApiTag[]> {
    return fetchApi(`/tags/entity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`);
  },
};

export { ApiError };
