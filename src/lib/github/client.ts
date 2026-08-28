// Read-only GitHub REST client (SPEC-intent-trace §8.2), browser-direct.
//
// Security posture (audit S2/S6):
// - The API host is a constant. There is deliberately no base-URL option: a
//   configurable host would be a token-redirect vector.
// - The token travels only in the Authorization header, never in a URL.
//   `fetch` drops Authorization on cross-origin redirects by spec.
// - owner / repo / sha / path are validated before they touch a URL, and
//   every web link is built here, never string-concatenated in JSX.
// - Error messages are content-free (status only) — response bodies are
//   never echoed into errors, logs, or the UI.
// - Nothing here writes: no POST/PUT/PATCH/DELETE exists in this module.

export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_WEB_BASE = 'https://github.com';
/** Files larger than this are refused (excerpts are what get sent anyway). */
export const MAX_FILE_BYTES = 200 * 1024;
export const DEFAULT_COMMITS_PER_PAGE = 20;

const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
/** Branch / tag / sha as used in compare URLs: no spaces, no traversal, bounded. */
const REF_RE = /^(?!.*\.\.)[A-Za-z0-9_./-]{1,120}$/;
/** Classic-token scopes that grant more than read access. */
const OVER_PRIVILEGED_SCOPES = /^(repo|delete_repo|workflow|write:.*|admin:.*)$/;

export interface GitHubClientOptions {
  token?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message = `GitHub request failed (${status})`) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export class GitHubRateLimitError extends GitHubError {
  readonly resetAt?: Date;
  constructor(status: number, resetAt?: Date) {
    super(status, 'GitHub rate limit reached');
    this.name = 'GitHubRateLimitError';
    this.resetAt = resetAt;
  }
}

export interface RateLimitInfo {
  remaining?: number;
  resetAt?: Date;
}

let lastRateLimit: RateLimitInfo = {};
/** Most recent rate-limit headers seen, for the run summary. */
export function getLastRateLimit(): RateLimitInfo {
  return { ...lastRateLimit };
}

// --- validation ---

export function assertRepoName(owner: string, repo: string): void {
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo) || owner === '..' || repo === '..') {
    throw new Error('Invalid repository owner or name');
  }
}

export function assertSha(sha: string): void {
  if (!SHA_RE.test(sha)) throw new Error('Invalid commit sha');
}

/** Encode a repo-relative path segment by segment; rejects traversal and empties. */
export function assertRef(ref: string): void {
  if (!REF_RE.test(ref) || ref.startsWith('/') || ref.endsWith('/')) throw new Error('Invalid git ref');
}

export function encodeRepoPath(path: string): string {
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error('Invalid repository path');
  }
  return segments.map(encodeURIComponent).join('/');
}

/** Accepts `owner/repo`, a github.com URL, or a git@github.com: remote. */
export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  const patterns = [
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/,
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/,
    /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/,
  ];
  for (const re of patterns) {
    const m = re.exec(trimmed);
    if (m) {
      try {
        assertRepoName(m[1], m[2]);
        return { owner: m[1], repo: m[2] };
      } catch {
        return null;
      }
    }
  }
  return null;
}

// --- transport ---

async function request(
  pathname: string,
  opts: GitHubClientOptions,
  search?: Record<string, string | number | undefined>
): Promise<{ data: unknown; headers: Headers }> {
  const url = new URL(pathname, GITHUB_API_BASE);
  for (const [k, v] of Object.entries(search ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url.toString(), { method: 'GET', headers });

  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  lastRateLimit = {
    ...(remaining !== null ? { remaining: Number(remaining) } : {}),
    ...(reset !== null ? { resetAt: new Date(Number(reset) * 1000) } : {}),
  };

  if (res.status === 429 || (res.status === 403 && remaining === '0')) {
    throw new GitHubRateLimitError(res.status, lastRateLimit.resetAt);
  }
  if (!res.ok) throw new GitHubError(res.status);
  return { data: await res.json(), headers: res.headers };
}

// --- caches (per session; keyed by immutable sha) ---

const treeCache = new Map<string, RepoTree>();
const fileCache = new Map<string, FileContent>();

export function clearGitHubCaches(): void {
  treeCache.clear();
  fileCache.clear();
}

// --- API surface ---

export interface RepoInfo {
  defaultBranch: string;
  isPrivate: boolean;
  htmlUrl: string;
  /** True when the token can push — a sign it is broader than needed. */
  canPush: boolean;
}

export async function getRepo(
  owner: string,
  repo: string,
  opts: GitHubClientOptions = {}
): Promise<RepoInfo> {
  assertRepoName(owner, repo);
  const { data } = await request(`/repos/${owner}/${repo}`, opts);
  const d = data as {
    default_branch: string;
    private: boolean;
    html_url: string;
    permissions?: { push?: boolean };
  };
  return {
    defaultBranch: d.default_branch,
    isPrivate: Boolean(d.private),
    htmlUrl: d.html_url,
    canPush: d.permissions?.push === true,
  };
}

export async function resolveRef(
  owner: string,
  repo: string,
  ref: string,
  opts: GitHubClientOptions = {}
): Promise<{ sha: string }> {
  assertRepoName(owner, repo);
  if (!ref.trim() || ref.includes('..')) throw new Error('Invalid ref');
  const { data } = await request(
    `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref.trim())}`,
    opts
  );
  const sha = (data as { sha: string }).sha;
  assertSha(sha);
  return { sha };
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
  sha: string;
}

export interface RepoTree {
  truncated: boolean;
  entries: TreeEntry[];
}

export async function getTree(
  owner: string,
  repo: string,
  sha: string,
  opts: GitHubClientOptions = {}
): Promise<RepoTree> {
  assertRepoName(owner, repo);
  assertSha(sha);
  const key = `${owner}/${repo}@${sha}`;
  const cached = treeCache.get(key);
  if (cached) return cached;
  const { data } = await request(`/repos/${owner}/${repo}/git/trees/${sha}`, opts, {
    recursive: 1,
  });
  const d = data as {
    truncated?: boolean;
    tree: Array<{ path: string; type: string; size?: number; sha: string }>;
  };
  const tree: RepoTree = {
    truncated: Boolean(d.truncated),
    entries: d.tree
      .filter((e) => e.type === 'blob' || e.type === 'tree')
      .map((e) => ({
        path: e.path,
        type: e.type as 'blob' | 'tree',
        ...(e.size !== undefined ? { size: e.size } : {}),
        sha: e.sha,
      })),
  };
  treeCache.set(key, tree);
  return tree;
}

export interface FileContent {
  text: string;
  size: number;
  sha: string;
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  sha: string,
  opts: GitHubClientOptions = {}
): Promise<FileContent> {
  assertRepoName(owner, repo);
  assertSha(sha);
  const encodedPath = encodeRepoPath(path);
  const key = `${owner}/${repo}@${sha}:${path}`;
  const cached = fileCache.get(key);
  if (cached) return cached;
  const { data } = await request(`/repos/${owner}/${repo}/contents/${encodedPath}`, opts, {
    ref: sha,
  });
  const d = data as { type?: string; size?: number; sha: string; content?: string; encoding?: string };
  if (d.type !== 'file') throw new Error('Path is not a file');
  const size = d.size ?? 0;
  if (size > MAX_FILE_BYTES) throw new Error(`File too large (${size} bytes)`);
  if (d.encoding !== 'base64' || typeof d.content !== 'string') {
    throw new Error('Unexpected file encoding');
  }
  const file: FileContent = { text: decodeBase64Utf8(d.content), size, sha: d.sha };
  fileCache.set(key, file);
  return file;
}

export interface CommitSummary {
  sha: string;
  message: string;
  authoredAt: Date;
  htmlUrl: string;
}

export async function listCommits(
  owner: string,
  repo: string,
  params: { path?: string; since?: Date; sha?: string; perPage?: number } = {},
  opts: GitHubClientOptions = {}
): Promise<CommitSummary[]> {
  assertRepoName(owner, repo);
  if (params.sha) assertSha(params.sha);
  if (params.path) encodeRepoPath(params.path); // validation only; the API takes it raw as a query param
  const { data } = await request(`/repos/${owner}/${repo}/commits`, opts, {
    path: params.path,
    since: params.since?.toISOString(),
    sha: params.sha,
    per_page: params.perPage ?? DEFAULT_COMMITS_PER_PAGE,
  });
  const list = data as Array<{
    sha: string;
    html_url: string;
    commit: { message: string; author?: { date?: string }; committer?: { date?: string } };
  }>;
  return list.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    authoredAt: new Date(c.commit.author?.date ?? c.commit.committer?.date ?? 0),
    htmlUrl: c.html_url,
  }));
}

export interface TokenInfo {
  login: string;
  /** Classic-token scopes from x-oauth-scopes; empty for fine-grained tokens. */
  scopes: string[];
  /** True when the token grants write/admin access — more than Intent Trace needs. */
  overPrivileged: boolean;
}

export async function getTokenInfo(opts: GitHubClientOptions): Promise<TokenInfo> {
  if (!opts.token) throw new Error('No token to test');
  const { data, headers } = await request('/user', opts);
  const scopes = (headers.get('x-oauth-scopes') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    login: (data as { login: string }).login,
    scopes,
    overPrivileged: scopes.some((s) => OVER_PRIVILEGED_SCOPES.test(s)),
  };
}

// --- links ---

/** `https://github.com/o/r/blob/sha/path#L10-L20` — the only way links are built. */
export function blobUrl(
  owner: string,
  repo: string,
  sha: string,
  path: string,
  startLine?: number,
  endLine?: number
): string {
  assertRepoName(owner, repo);
  assertSha(sha);
  let url = `${GITHUB_WEB_BASE}/${owner}/${repo}/blob/${sha}/${encodeRepoPath(path)}`;
  if (startLine !== undefined && Number.isInteger(startLine) && startLine > 0) {
    url += `#L${startLine}`;
    if (endLine !== undefined && Number.isInteger(endLine) && endLine > startLine) {
      url += `-L${endLine}`;
    }
  }
  return url;
}

/** Only github.com links from API payloads are ever rendered (audit S6). */
export function isGitHubWebUrl(url: string): boolean {
  return url.startsWith(`${GITHUB_WEB_BASE}/`);
}

// --- diffs (SPEC-change-workspace §11, CW-3). Read-only; patches are returned
// raw here and capped + secret-scrubbed by src/lib/prepare/implementation.ts
// before anything is stored (audit S4, S7). ---

export interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  /** Unified-diff hunk text; absent for binary or very large files. */
  patch?: string;
  /** Previous path for renames. */
  previousPath?: string;
}

function mapDiffFiles(list: unknown): DiffFile[] {
  const files = list as Array<{
    filename: string;
    status?: string;
    additions?: number;
    deletions?: number;
    patch?: string;
    previous_filename?: string;
  }>;
  return files.map((f) => ({
    path: f.filename,
    status: f.status ?? 'modified',
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    ...(typeof f.patch === 'string' ? { patch: f.patch } : {}),
    ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
  }));
}

export interface CompareResult {
  baseSha: string;
  headSha: string;
  aheadBy: number;
  behindBy: number;
  totalCommits: number;
  files: DiffFile[];
}

/** `base...head` comparison. GitHub returns at most 300 files. */
export async function compareCommits(
  owner: string,
  repo: string,
  base: string,
  head: string,
  opts: GitHubClientOptions = {}
): Promise<CompareResult> {
  assertRepoName(owner, repo);
  assertRef(base);
  assertRef(head);
  const { data } = await request(
    `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    opts
  );
  const d = data as {
    base_commit: { sha: string };
    merge_base_commit?: { sha: string };
    commits: Array<{ sha: string }>;
    ahead_by?: number;
    behind_by?: number;
    total_commits?: number;
    files?: unknown[];
  };
  const headSha = d.commits.length > 0 ? d.commits[d.commits.length - 1].sha : d.base_commit.sha;
  return {
    baseSha: d.merge_base_commit?.sha ?? d.base_commit.sha,
    headSha,
    aheadBy: d.ahead_by ?? d.commits.length,
    behindBy: d.behind_by ?? 0,
    totalCommits: d.total_commits ?? d.commits.length,
    files: mapDiffFiles(d.files ?? []),
  };
}

export function assertPullNumber(n: number): void {
  if (!Number.isInteger(n) || n <= 0 || n > 10_000_000) throw new Error('Invalid pull request number');
}

export interface PullSummary {
  number: number;
  title: string;
  baseSha: string;
  headSha: string;
  htmlUrl: string;
  files: DiffFile[];
}

/** Pull request metadata + changed files (first 100). */
export async function getPullFiles(
  owner: string,
  repo: string,
  pullNumber: number,
  opts: GitHubClientOptions = {}
): Promise<PullSummary> {
  assertRepoName(owner, repo);
  assertPullNumber(pullNumber);
  const { data: pr } = await request(`/repos/${owner}/${repo}/pulls/${pullNumber}`, opts);
  const p = pr as { number: number; title: string; html_url: string; base: { sha: string }; head: { sha: string } };
  const { data: files } = await request(`/repos/${owner}/${repo}/pulls/${pullNumber}/files`, opts, {
    per_page: 100,
  });
  return {
    number: p.number,
    title: p.title,
    baseSha: p.base.sha,
    headSha: p.head.sha,
    htmlUrl: isGitHubWebUrl(p.html_url) ? p.html_url : pullUrl(owner, repo, pullNumber),
    files: mapDiffFiles(files),
  };
}

/** Validated builders only — never interpolate user input into a link elsewhere (audit S6). */
export function compareUrl(owner: string, repo: string, base: string, head: string): string {
  assertRepoName(owner, repo);
  assertRef(base);
  assertRef(head);
  return `${GITHUB_WEB_BASE}/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
}

export function pullUrl(owner: string, repo: string, pullNumber: number): string {
  assertRepoName(owner, repo);
  assertPullNumber(pullNumber);
  return `${GITHUB_WEB_BASE}/${owner}/${repo}/pull/${pullNumber}`;
}
