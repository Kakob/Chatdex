// Shared export utilities

export type ExportFormat = 'markdown' | 'json' | 'csv';

/**
 * Trigger a file download in the browser.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generate a date-stamped filename.
 */
export function stampedFilename(prefix: string, extension: string): string {
  const date = new Date().toISOString().split('T')[0];
  return `${prefix}-${date}.${extension}`;
}

const MIME_TYPES: Record<ExportFormat, string> = {
  markdown: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
};

const EXTENSIONS: Record<ExportFormat, string> = {
  markdown: 'md',
  json: 'json',
  csv: 'csv',
};

/**
 * Download content in the given format with auto-generated filename.
 */
export function downloadExport(
  content: string,
  prefix: string,
  format: ExportFormat
): void {
  downloadFile(
    content,
    stampedFilename(prefix, EXTENSIONS[format]),
    MIME_TYPES[format]
  );
}
