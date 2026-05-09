// Background service worker for the extension
// Captures activities and sends them directly to the API

import type { ExtensionMessage, CapturedResponse, DOMActivity } from './types';

const API_URL = 'http://localhost:3003/api';

// Conversation title cache
const conversationTitles = new Map<string, string>();

// Generate unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

type ActivityPayload = {
  id: string;
  type: string;
  source: 'extension';
  conversationId: string | null;
  conversationTitle: string | null;
  model: string | null;
  timestamp: Date;
  tokens: { inputTokens: number; outputTokens: number; cacheCreationTokens?: number; cacheReadTokens?: number } | null;
  metadata: Record<string, unknown>;
};

// Send activity directly to the API
async function syncActivity(activity: ActivityPayload): Promise<void> {
  console.log('[Chatdex] Sending activity to API:', activity.type, activity.id);

  try {
    const response = await fetch(`${API_URL}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...activity,
        timestamp: activity.timestamp.toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    console.log('[Chatdex] Activity stored:', activity.type, activity.id);

    // Notify any open web app tabs for live UI updates
    notifyWebAppTabs(activity);
  } catch (error) {
    console.error('[Chatdex] Error sending activity to API:', error);
  }
}

// Best-effort notify open web app tabs for live UI refresh
async function notifyWebAppTabs(activity: ActivityPayload): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({
      url: ['http://localhost:*/*', 'http://127.0.0.1:*/*'],
    });

    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'ACTIVITY_STORED',
          activity: { ...activity, timestamp: activity.timestamp.toISOString() },
        }).catch(() => { /* tab not listening, that's fine */ });
      }
    }
  } catch {
    // No tabs open, that's fine
  }
}

// Process captured API response
function processResponse(data: CapturedResponse): void {
  const conversationTitle = data.conversationId
    ? conversationTitles.get(data.conversationId) ?? null
    : null;

  // Only track completion requests (actual messages)
  if (!data.url.includes('/completion')) {
    return;
  }

  const activity = {
    id: generateId(),
    type: 'message_received',
    source: 'extension' as const,
    conversationId: data.conversationId ?? null,
    conversationTitle,
    model: data.model ?? null,
    timestamp: new Date(data.timestamp),
    tokens: data.tokens ?? null,
    metadata: {
      messageRole: 'assistant' as const,
      messagePreview: data.messagePreview,
      fullContent: data.fullContent,
      userMessage: data.userMessage,
    },
  };

  syncActivity(activity);
}

// Process DOM activity
function processDOMActivity(data: DOMActivity): void {
  const conversationId = getCurrentConversationId();
  const conversationTitle = conversationId
    ? conversationTitles.get(conversationId) ?? null
    : null;

  let activityType: string;
  const metadata: Record<string, unknown> = {};

  switch (data.type) {
    case 'artifact':
      activityType = 'artifact_created';
      metadata.artifactTitle = data.title;
      metadata.artifactType = data.artifactType;
      break;
    case 'code_block':
      activityType = 'code_block';
      metadata.codeLanguage = data.language;
      metadata.codeContent = data.codeContent;
      break;
    case 'tool_use':
      activityType = 'tool_use';
      metadata.toolName = data.toolName;
      break;
    case 'tool_result':
      activityType = 'tool_result';
      metadata.toolName = data.toolName;
      break;
    default:
      return;
  }

  const activity = {
    id: generateId(),
    type: activityType,
    source: 'extension' as const,
    conversationId,
    conversationTitle,
    model: null,
    timestamp: new Date(data.timestamp),
    tokens: null,
    metadata,
  };

  syncActivity(activity);
}

// Track current conversation
let currentConversationId: string | null = null;

function getCurrentConversationId(): string | null {
  return currentConversationId;
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender) => {
  console.log('[Chatdex] Background received message:', message.type);

  // Extract conversation ID from tab URL
  if (sender.tab?.url) {
    const match = sender.tab.url.match(/\/chat\/([^/?]+)/);
    if (match) {
      currentConversationId = match[1];
    }
  }

  switch (message.type) {
    case 'CLAUDE_RESPONSE':
      processResponse(message.data);
      break;
    case 'DOM_ACTIVITY':
      processDOMActivity(message.data);
      break;
    case 'CONVERSATION_TITLE':
      conversationTitles.set(message.data.conversationId, message.data.title);
      break;
  }
});

console.log('[Chatdex] Background service worker initialized');
