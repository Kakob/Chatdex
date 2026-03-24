import { User, Bot, Wrench } from 'lucide-react';
import { HighlightedText } from '../search/HighlightedText';
import { ContentBlocks } from './ContentBlocks';
import type { StoredMessage } from '../../types';

interface MessageBubbleProps {
  message: StoredMessage;
  highlightQuery?: string;
}

export function MessageBubble({ message, highlightQuery }: MessageBubbleProps) {
  const isUser = message.sender === 'user';
  const isTool = message.sender === 'tool';

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (isTool) {
    // Use ContentBlocks if available for richer rendering
    if (message.contentBlocks && message.contentBlocks.length > 0) {
      return (
        <div className="flex gap-3 py-2">
          <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
            <Wrench size={16} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                {message.toolName || 'Tool'}
              </span>
              <span className="text-xs text-gray-400">
                {formatTime(message.createdAt)}
              </span>
            </div>
            <ContentBlocks blocks={message.contentBlocks} highlightQuery={highlightQuery} />
          </div>
        </div>
      );
    }

    // Fallback for old data without contentBlocks
    return (
      <div className="flex gap-3 py-2">
        <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
          <Wrench size={16} className="text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {message.toolName || 'Tool'}
            </span>
            <span className="text-xs text-gray-400">
              {formatTime(message.createdAt)}
            </span>
          </div>
          {message.toolInput && (
            <pre className="text-xs bg-gray-100 dark:bg-gray-800 rounded p-2 overflow-x-auto text-gray-700 dark:text-gray-300 mb-2">
              {message.toolInput}
            </pre>
          )}
          {message.toolResult && (
            <pre className="text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-2 overflow-x-auto text-gray-600 dark:text-gray-400 max-h-32 overflow-y-auto">
              {message.toolResult}
            </pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 py-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser
            ? 'bg-violet-100 dark:bg-violet-900/30'
            : 'bg-gray-100 dark:bg-gray-800'
        }`}
      >
        {isUser ? (
          <User size={16} className="text-violet-600 dark:text-violet-400" />
        ) : (
          <Bot size={16} className="text-gray-600 dark:text-gray-400" />
        )}
      </div>

      <div className={`flex-1 min-w-0 ${isUser ? 'text-right' : ''}`}>
        <div className={`flex items-center gap-2 mb-1 ${isUser ? 'justify-end' : ''}`}>
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {isUser ? 'You' : 'Claude'}
          </span>
          {message.conversationName && (
            <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[200px]">
              in {message.conversationName}
            </span>
          )}
          <span className="text-xs text-gray-400">
            {formatTime(message.createdAt)}
          </span>
        </div>

        <div
          className={`max-w-none text-gray-900 dark:text-gray-100 ${
            isUser
              ? 'bg-violet-100 dark:bg-violet-900/30 rounded-2xl rounded-tr-sm px-4 py-2 inline-block text-left'
              : ''
          }`}
        >
          {message.contentBlocks && message.contentBlocks.length > 0 ? (
            <ContentBlocks blocks={message.contentBlocks} highlightQuery={highlightQuery} />
          ) : (
            <MessageContent text={message.text} highlightQuery={highlightQuery} />
          )}
        </div>
      </div>
    </div>
  );
}

// Filter out unsupported block placeholder text
const UNSUPPORTED_PATTERN = /This block is not supported on your current device yet\.?\s*/gi;

function filterUnsupportedText(text: string): string {
  return text.replace(UNSUPPORTED_PATTERN, '').trim();
}

function MessageContent({
  text,
  highlightQuery,
}: {
  text: string;
  highlightQuery?: string;
}) {
  // Filter out unsupported placeholders and split into code/text parts
  const filteredText = filterUnsupportedText(text);
  if (!filteredText) return null;

  const parts = filteredText.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          // Extract language and code
          const lines = part.slice(3, -3).split('\n');
          const language = lines[0]?.trim() || '';
          const code = lines.slice(language ? 1 : 0).join('\n');

          return (
            <pre
              key={i}
              className="bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg p-3 overflow-x-auto text-xs my-2"
            >
              {language && (
                <div className="text-xs text-gray-500 mb-2">{language}</div>
              )}
              <code>
                {highlightQuery ? (
                  <HighlightedText
                    text={code}
                    query={highlightQuery}
                    highlightClassName="bg-yellow-400 text-gray-900 rounded px-0.5"
                  />
                ) : (
                  code
                )}
              </code>
            </pre>
          );
        }

        // Regular text - preserve line breaks and highlight
        return (
          <span key={i} className="whitespace-pre-wrap">
            {highlightQuery ? (
              <HighlightedText text={part} query={highlightQuery} />
            ) : (
              part
            )}
          </span>
        );
      })}
    </>
  );
}
