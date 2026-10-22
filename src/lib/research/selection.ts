/** Textareas normalize CRLF/CR to LF. Persist offsets in the original text. */
export function sourceOffset(text: string, displayOffset: number): number {
  let raw = 0;
  let displayed = 0;
  while (raw < text.length && displayed < displayOffset) {
    raw += text[raw] === '\r' && text[raw + 1] === '\n' ? 2 : 1;
    displayed++;
  }
  return raw;
}
export function displayOffset(text: string, rawOffset: number): number {
  return text.slice(0, rawOffset).replace(/\r\n?/g, '\n').length;
}
