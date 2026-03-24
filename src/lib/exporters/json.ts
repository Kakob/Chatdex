/**
 * Export data as clean JSON with optional metadata wrapper.
 */
export function buildJson(
  data: unknown,
  meta?: { exportedAt?: string; source?: string; version?: string }
): string {
  const payload = meta
    ? {
        meta: {
          exportedAt: meta.exportedAt || new Date().toISOString(),
          ...meta,
        },
        data,
      }
    : data;

  return JSON.stringify(payload, null, 2);
}
