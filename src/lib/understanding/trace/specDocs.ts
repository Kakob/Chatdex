// Spec leg retrieval (SPEC-intent-trace §9.1). Finds spec-like markdown in a
// repository tree and pulls keyword-matched, line-numbered windows for one
// intent. Pure; no network. When no spec docs exist the trace records
// `no_spec` without any model involvement — that decision is made by the
// caller from `findSpecPaths` returning nothing.

export const DEFAULT_SPEC_PATTERNS: readonly string[] = [
  'docs/**/*.md',
  'SPEC-*.md',
  'PRD-*.md',
  'README.md',
  'CLAUDE.md',
];

export const DEFAULT_SPEC_MAX_CHARS = 3000;
export const DEFAULT_SPEC_WINDOW_LINES = 12;
export const DEFAULT_SPEC_MAX_EXCERPTS = 4;
/** Tokens shorter than this carry no signal for retrieval. */
export const MIN_TOKEN_LENGTH = 4;

const STOPWORDS = new Set([
  'that', 'this', 'with', 'from', 'want', 'have', 'should', 'would', 'could', 'when', 'then',
  'than', 'them', 'they', 'there', 'their', 'what', 'which', 'will', 'just', 'like', 'also',
  'into', 'only', 'make', 'sure', 'dont', 'does', 'need', 'about', 'because', 'really', 'thing',
  'things', 'something', 'anything', 'never', 'always', 'instead', 'rather', 'please', 'keep',
  'user', 'users', 'code', 'file', 'files', 'project', 'feature', 'work', 'works', 'working',
]);

/** Minimal glob → RegExp: `**` any depth, `*` within a segment, `?` one char. Anchored. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more directories; bare `**` matches anything.
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

export function findSpecPaths(
  treePaths: string[],
  patterns: readonly string[] = DEFAULT_SPEC_PATTERNS
): string[] {
  const regexes = patterns.map(globToRegExp);
  return treePaths.filter((p) => regexes.some((re) => re.test(p))).sort();
}

/** Lowercased keyword tokens ≥ MIN_TOKEN_LENGTH, camelCase/kebab split, stopwords removed. */
export function tokenize(text: string): string[] {
  const split = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const out = new Set<string>();
  for (const t of split) {
    if (t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t)) out.add(t);
  }
  return [...out];
}

export interface SpecExcerpt {
  path: string;
  /** 1-based inclusive. */
  startLine: number;
  endLine: number;
  /** Numbered lines, `N: text`. */
  text: string;
  score: number;
}

export function numberLines(lines: string[], startLine: number): string {
  return lines.map((l, i) => `${startLine + i}: ${l}`).join('\n');
}

/**
 * Score every line by keyword hits (headings count double), take the best
 * non-overlapping windows across all docs, cap total characters.
 */
export function retrieveSpecExcerpts(
  intent: { title: string; statement: string },
  docs: Array<{ path: string; text: string }>,
  opts: { maxChars?: number; windowLines?: number; maxExcerpts?: number } = {}
): SpecExcerpt[] {
  const maxChars = opts.maxChars ?? DEFAULT_SPEC_MAX_CHARS;
  const windowLines = opts.windowLines ?? DEFAULT_SPEC_WINDOW_LINES;
  const maxExcerpts = opts.maxExcerpts ?? DEFAULT_SPEC_MAX_EXCERPTS;
  const keywords = tokenize(`${intent.title} ${intent.statement}`);
  if (keywords.length === 0) return [];

  const candidates: SpecExcerpt[] = [];
  for (const doc of docs) {
    const lines = doc.text.split('\n');
    const scores = lines.map((line) => {
      const lower = line.toLowerCase();
      let hits = 0;
      for (const k of keywords) if (lower.includes(k)) hits++;
      return hits * (line.trimStart().startsWith('#') ? 2 : 1);
    });
    // A window around every hit line; overlapping/adjacent windows merge so a
    // dense passage is one excerpt rather than a lottery of which hit won.
    const windows: Array<[number, number]> = [];
    scores.forEach((s, i) => {
      if (s <= 0) return;
      const start = Math.max(0, i - Math.floor(windowLines / 2));
      const end = Math.min(lines.length - 1, start + windowLines - 1);
      const last = windows[windows.length - 1];
      if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
      else windows.push([start, end]);
    });
    for (const [start, end] of windows) {
      let score = 0;
      for (let j = start; j <= end; j++) score += scores[j];
      candidates.push({
        path: doc.path,
        startLine: start + 1,
        endLine: end + 1,
        text: numberLines(lines.slice(start, end + 1), start + 1),
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine);
  const out: SpecExcerpt[] = [];
  let used = 0;
  for (const c of candidates) {
    if (out.length >= maxExcerpts) break;
    if (used + c.text.length > maxChars) continue;
    out.push(c);
    used += c.text.length;
  }
  return out;
}
