import { describe, it, expect, vi } from 'vitest';
import { stampedFilename, downloadFile } from './index';

describe('stampedFilename', () => {
  it('generates prefix-YYYY-MM-DD.ext format', () => {
    const result = stampedFilename('test', 'md');
    expect(result).toMatch(/^test-\d{4}-\d{2}-\d{2}\.md$/);
  });

  it('uses current date', () => {
    const today = new Date().toISOString().split('T')[0];
    const result = stampedFilename('export', 'json');
    expect(result).toBe(`export-${today}.json`);
  });
});

describe('downloadFile', () => {
  it('creates blob URL and triggers download', () => {
    const clickSpy = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      set href(_: string) {},
      set download(_: string) {},
      click: clickSpy,
    } as unknown as HTMLAnchorElement);

    downloadFile('content', 'file.txt', 'text/plain');

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
