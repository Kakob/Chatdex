// Injected script that runs in the page context to intercept fetch calls

interface TokenHeaders {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

interface CapturedData {
  url: string;
  method: string;
  status: number;
  tokens?: TokenHeaders;
  model?: string;
  conversationId?: string;
  messagePreview?: string;
  fullContent?: string;
  userMessage?: string;
  timestamp: number;
}

const originalFetch = window.fetch;

window.fetch = async function (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await originalFetch.call(this, input, init);

  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    // Only intercept claude.ai API calls
    if (url.includes('claude.ai/api/')) {
      const tokens = extractTokenHeaders(response.headers);
      const model = response.headers.get('x-model') ?? undefined;

      // Extract conversation ID from URL (handles both /chat_conversations/ and /conversations/)
      const conversationMatch = url.match(/\/(?:chat_)?conversations\/([a-f0-9-]+)/);
      const conversationId = conversationMatch?.[1];

      // For completion endpoints, capture the response body
      if (url.includes('/completion') && init?.method === 'POST') {
        // Clone the response so we can read it without affecting the original
        const clonedResponse = response.clone();

        // Try to extract model and user message from request body
        let requestModel: string | undefined;
        let userMessage: string | undefined;
        if (init?.body) {
          try {
            const bodyStr = typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer);
            const bodyJson = JSON.parse(bodyStr);
            requestModel = bodyJson.model;

            // Extract the user's message - usually the last user message in the prompt
            if (bodyJson.prompt) {
              // Legacy format: prompt is a string
              userMessage = bodyJson.prompt;
            } else if (bodyJson.messages && Array.isArray(bodyJson.messages)) {
              // Find the last user message
              const userMessages = bodyJson.messages.filter((m: { role: string }) => m.role === 'user');
              const lastUserMsg = userMessages[userMessages.length - 1];
              if (lastUserMsg) {
                if (typeof lastUserMsg.content === 'string') {
                  userMessage = lastUserMsg.content;
                } else if (Array.isArray(lastUserMsg.content)) {
                  // Content might be an array of text blocks
                  userMessage = lastUserMsg.content
                    .filter((c: { type: string }) => c.type === 'text')
                    .map((c: { text: string }) => c.text)
                    .join('\n');
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        }

        // Process the streaming response in the background
        processStreamingResponse(clonedResponse, {
          url,
          method: init?.method ?? 'POST',
          status: response.status,
          tokens: tokens ?? undefined,
          model: model || requestModel,
          conversationId,
          userMessage,
          timestamp: Date.now(),
        });
      } else {
        // For non-completion requests, just log basic info
        const capturedData: CapturedData = {
          url,
          method: init?.method ?? 'GET',
          status: response.status,
          tokens: tokens ?? undefined,
          model,
          conversationId,
          timestamp: Date.now(),
        };

        console.log('[Chatdex] Captured API call:', url, capturedData);

        // Dispatch custom event for content script to pick up
        window.dispatchEvent(
          new CustomEvent('claude-utils-response', {
            detail: capturedData,
          })
        );
      }
    }
  } catch (e) {
    // Silently ignore errors to not break the page
    console.error('[Chatdex] Error intercepting fetch:', e);
  }

  return response;
};

async function processStreamingResponse(
  response: Response,
  baseData: CapturedData
): Promise<void> {
  try {
    const reader = response.body?.getReader();
    if (!reader) {
      window.dispatchEvent(
        new CustomEvent('claude-utils-response', { detail: baseData })
      );
      return;
    }

    const decoder = new TextDecoder();
    let fullText = '';
    let extractedTokens: TokenHeaders | undefined;
    let extractedModel: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
    }

    // Parse the SSE stream to extract message content and token info
    const lines = fullText.split('\n');
    let messageContent = '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));

          // Extract message content from different event types
          if (data.type === 'content_block_delta' && data.delta?.text) {
            messageContent += data.delta.text;
          }

          // Extract completion message (legacy format)
          if (data.completion) {
            messageContent = data.completion;
          }

          // message_start contains model and input tokens
          if (data.type === 'message_start' && data.message) {
            // Claude.ai sometimes sends empty string for model
            if (data.message.model && data.message.model.length > 0) {
              extractedModel = data.message.model;
            }
            if (data.message.usage?.input_tokens) {
              inputTokens = data.message.usage.input_tokens;
            }
          }

          // message_delta contains output tokens
          if (data.type === 'message_delta' && data.usage?.output_tokens) {
            outputTokens = data.usage.output_tokens;
          }

          // Some responses include usage at the top level
          if (data.usage) {
            if (data.usage.input_tokens) inputTokens = data.usage.input_tokens;
            if (data.usage.output_tokens) outputTokens = data.usage.output_tokens;
          }

          // Extract model from various places
          if (data.model && !extractedModel) {
            extractedModel = data.model;
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    }

    // Build token object if we found any tokens
    if (inputTokens > 0 || outputTokens > 0) {
      extractedTokens = { inputTokens, outputTokens };
    }

    // Create preview (first 200 chars)
    const messagePreview = messageContent.slice(0, 200) + (messageContent.length > 200 ? '...' : '');

    const capturedData: CapturedData = {
      ...baseData,
      tokens: extractedTokens ?? baseData.tokens,
      model: extractedModel ?? baseData.model,
      messagePreview: messagePreview || undefined,
      fullContent: messageContent || undefined,
      userMessage: baseData.userMessage,
    };

    console.log('[Chatdex] Captured completion:', capturedData.model, {
      userMsgLen: baseData.userMessage?.length ?? 0,
      responseMsgLen: messageContent.length,
    });

    // Dispatch event with full data
    window.dispatchEvent(
      new CustomEvent('claude-utils-response', {
        detail: capturedData,
      })
    );
  } catch (e) {
    console.error('[Chatdex] Error processing streaming response:', e);

    // Still dispatch the basic data even if we couldn't parse the body
    window.dispatchEvent(
      new CustomEvent('claude-utils-response', {
        detail: baseData,
      })
    );
  }
}

function extractTokenHeaders(headers: Headers): TokenHeaders | null {
  const inputTokens = headers.get('anthropic-input-tokens');
  const outputTokens = headers.get('anthropic-output-tokens');

  if (!inputTokens || !outputTokens) {
    return null;
  }

  const result: TokenHeaders = {
    inputTokens: parseInt(inputTokens, 10),
    outputTokens: parseInt(outputTokens, 10),
  };

  const cacheCreation = headers.get('anthropic-cache-creation-input-tokens');
  const cacheRead = headers.get('anthropic-cache-read-input-tokens');

  if (cacheCreation) {
    result.cacheCreationTokens = parseInt(cacheCreation, 10);
  }

  if (cacheRead) {
    result.cacheReadTokens = parseInt(cacheRead, 10);
  }

  return result;
}

// Signal that the script is loaded
console.log('[Chatdex] Fetch interceptor loaded');
