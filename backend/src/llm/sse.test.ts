import { describe, it, expect } from 'vitest';
import { splitSystem, sseDataPayloads } from './sse';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const payload of sseDataPayloads(stream)) out.push(payload);
  return out;
}

describe('splitSystem', () => {
  it('separates system messages from the conversational prompt', () => {
    expect(
      splitSystem([
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'more' },
      ])
    ).toEqual({ system: 'be brief', prompt: 'hi\n\nhello\n\nmore' });
  });

  it('returns empty system when none present', () => {
    expect(splitSystem([{ role: 'user', content: 'hi' }])).toEqual({
      system: '',
      prompt: 'hi',
    });
  });
});

describe('sseDataPayloads', () => {
  it('yields one payload per event', async () => {
    expect(await collect(streamOf(['data: {"a":1}\n\ndata: [DONE]\n\n']))).toEqual([
      '{"a":1}',
      '[DONE]',
    ]);
  });

  it('reassembles events split across chunks, including multi-byte boundaries', async () => {
    expect(await collect(streamOf(['data: {"text":"héll', 'o"}\n', '\n']))).toEqual([
      '{"text":"héllo"}',
    ]);
  });

  it('handles CRLF delimiters and ignores non-data lines', async () => {
    expect(
      await collect(streamOf(['event: ping\r\ndata: one\r\n\r\n: comment\n\ndata: two\n\n']))
    ).toEqual(['one', 'two']);
  });

  it('joins multi-line data fields', async () => {
    expect(await collect(streamOf(['data: a\ndata: b\n\n']))).toEqual(['a\nb']);
  });
});
