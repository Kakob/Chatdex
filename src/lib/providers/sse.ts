// Minimal incremental SSE parsing for the relay's /api/llm/stream responses.
// Feed raw text chunks in; complete `data:` payloads come out. Handles events
// split across chunk boundaries and CRLF line endings.

/**
 * Stateful parser: push() returns the data payloads of every event completed
 * by that chunk (an event may span multiple pushes). flush() returns the
 * payload of a trailing event not terminated by a blank line, if any.
 */
export class SSEParser {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const payloads: string[] = [];
    for (;;) {
      const sep = /\r?\n\r?\n/.exec(this.buffer);
      if (!sep) break;
      const rawEvent = this.buffer.slice(0, sep.index);
      this.buffer = this.buffer.slice(sep.index + sep[0].length);
      const data = extractData(rawEvent);
      if (data !== null) payloads.push(data);
    }
    return payloads;
  }

  flush(): string | null {
    const data = extractData(this.buffer);
    this.buffer = '';
    return data;
  }
}

function extractData(rawEvent: string): string | null {
  const lines = rawEvent
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  return lines.length > 0 ? lines.join('\n') : null;
}
