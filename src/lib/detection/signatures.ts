// Tool-call signature generation (SPEC §2.1 step 1).
// A signature is `tool_name + canonicalized_args`; two calls that differ only
// in volatile fields, path spelling, or whitespace must produce the same
// signature so the loop detector can match repeats.

/**
 * Fields dropped from tool inputs before signing. Enumerated explicitly —
 * each entry has a corresponding unit test in signatures.test.ts.
 */
export const VOLATILE_FIELDS: readonly string[] = [
  'timestamp',
  'request_id',
  'requestId',
  'session_id',
  'sessionId',
  'trace_id',
  'traceId',
  'run_id',
  'runId',
  'nonce',
];

/** Input keys whose string values are treated as filesystem paths. */
export const PATH_FIELDS: readonly string[] = [
  'file_path',
  'notebook_path',
  'path',
  'cwd',
];

/**
 * Normal form for filesystem paths: collapse duplicate slashes, resolve `.`
 * and `..` segments, strip trailing slash. Purely textual — never touches
 * the filesystem.
 */
export function normalizePath(path: string): string {
  const isAbsolute = path.startsWith('/');
  const segments = path.split('/');
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') {
        out.pop();
      } else if (!isAbsolute) {
        out.push('..');
      }
      continue;
    }
    out.push(segment);
  }
  const joined = out.join('/');
  if (isAbsolute) return '/' + joined;
  return joined === '' ? '.' : joined;
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function canonicalize(value: unknown, keyHint?: string): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (keyHint !== undefined && PATH_FIELDS.includes(keyHint)) {
      return normalizePath(value.trim());
    }
    return collapseWhitespace(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(source).sort()) {
      if (VOLATILE_FIELDS.includes(key)) continue;
      out[key] = canonicalize(source[key], key);
    }
    return out;
  }
  // Functions/symbols can't appear in parsed JSONL; stringify defensively.
  return String(value);
}

export function signatureFor(
  toolName: string,
  input: Record<string, unknown>
): string {
  return `${toolName}:${JSON.stringify(canonicalize(input))}`;
}
