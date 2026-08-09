import { describe, it, expect } from 'vitest';
import { SSEParser } from './sse';

describe('SSEParser', () => {
  it('parses complete events in one chunk', () => {
    const parser = new SSEParser();
    expect(parser.push('data: {"a":1}\n\ndata: {"b":2}\n\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('reassembles events split across chunk boundaries', () => {
    const parser = new SSEParser();
    expect(parser.push('data: {"text":"hel')).toEqual([]);
    expect(parser.push('lo"}\n')).toEqual([]);
    expect(parser.push('\ndata: x\n\n')).toEqual(['{"text":"hello"}', 'x']);
  });

  it('joins multi-line data fields and handles CRLF', () => {
    const parser = new SSEParser();
    expect(parser.push('data: line1\r\ndata: line2\r\n\r\n')).toEqual(['line1\nline2']);
    expect(parser.push('data: line1\ndata: line2\n\n')).toEqual(['line1\nline2']);
  });

  it('handles a CRLF event delimiter split across chunks', () => {
    const parser = new SSEParser();
    expect(parser.push('data: a\r\n\r')).toEqual([]);
    expect(parser.push('\ndata: b\r\n\r\n')).toEqual(['a', 'b']);
  });

  it('ignores non-data lines (comments, event names)', () => {
    const parser = new SSEParser();
    expect(parser.push(': keepalive\n\nevent: ping\ndata: payload\n\n')).toEqual(['payload']);
  });

  it('flush returns a trailing unterminated event', () => {
    const parser = new SSEParser();
    expect(parser.push('data: tail')).toEqual([]);
    expect(parser.flush()).toBe('tail');
    expect(parser.flush()).toBeNull();
  });
});
