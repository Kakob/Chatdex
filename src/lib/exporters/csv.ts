/**
 * Build a CSV string from headers and rows.
 * Handles quoting and escaping.
 */
export function buildCsv(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): string {
  const escape = (cell: unknown): string =>
    `"${String(cell ?? '').replace(/"/g, '""')}"`;

  return [headers, ...rows]
    .map((row) => row.map(escape).join(','))
    .join('\n');
}
