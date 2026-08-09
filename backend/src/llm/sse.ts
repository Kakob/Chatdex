// SSE helpers for the streaming relay (transit-only — pure parsing, no I/O).

export interface RelayChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Collapse a message list into the system/prompt split the bridges expect. */
export function splitSystem(messages: RelayChatMessage[]): { system: string; prompt: string } {
  return {
    system: messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n'),
    prompt: messages
      .filter((m) => m.role !== 'system')
      .map((m) => m.content)
      .join('\n\n'),
  };
}

/** Yield the `data:` payloads of a provider SSE byte stream, one per event. */
export async function* sseDataPayloads(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const sep = /\r?\n\r?\n/.exec(buffer);
        if (!sep) break;
        const rawEvent = buffer.slice(0, sep.index);
        buffer = buffer.slice(sep.index + sep[0].length);
        const data = rawEvent
          .split('\n')
          .map((line) => line.replace(/\r$/, ''))
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
