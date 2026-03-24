import type { StoredConversation, StoredMessage } from '../../types';

/**
 * Format a conversation and its messages as Markdown.
 */
export function conversationToMarkdown(
  conversation: StoredConversation,
  messages: StoredMessage[]
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${conversation.name}`);
  lines.push('');
  lines.push(`**Source:** ${conversation.source}`);
  lines.push(`**Date:** ${conversation.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
  lines.push(`**Messages:** ${conversation.messageCount}`);
  if (conversation.estimatedTokens > 0) {
    lines.push(`**Estimated tokens:** ${conversation.estimatedTokens.toLocaleString()}`);
  }
  if (conversation.projectPath) {
    lines.push(`**Project:** ${conversation.projectPath}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Messages
  for (const msg of messages) {
    if (msg.sender === 'user' || msg.sender === 'assistant') {
      const label = msg.sender === 'user' ? '**User**' : '**Claude**';
      lines.push(`### ${label}`);
      lines.push('');
      lines.push(msg.text);
      lines.push('');
    }
  }

  return lines.join('\n');
}
