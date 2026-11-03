// The fetch gate (SPEC-intent-trace §9.3, audit S3/S4). Every repository path
// the trace engine fetches — candidates, model-suggested paths, user-typed
// paths — passes through `isFetchAllowed`. Every excerpt passes through
// `scrubSecrets` before it can enter a prompt, and `assertNoSecrets` runs on
// the final messages so the GitHub token can never leak into a provider call.

import type { ChatMessage } from '../../providers';

/** Never fetched, whatever asks for them. Matched against the full path and the basename. */
export const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(?!\.(?:example|sample|template|dist)$)(\.|$)/i,
  /\.(pem|key|p12|pfx|jks|keystore|keychain)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|\/|[._-])credentials?([._-]|\/|$)/i,
  /(^|\/|[._-])secrets?([._-]|\/|$)/i,
  /(^|\/)auth\.json$/i,
  /(^|\/)\.(npmrc|netrc|pypirc|git-credentials)$/i,
  /(^|\/)\.(aws|ssh|gnupg)\//i,
  /(^|\/)service[-_]?account.*\.json$/i,
];

/** Directories that never yield candidates. */
export const EXCLUDED_DIRS: readonly string[] = [
  'node_modules', 'vendor', 'dist', 'build', 'out', 'coverage', '.git', '.next', '.turbo',
  '.cache', 'target', '__pycache__', '.venv', 'venv',
];

/** Generated / binary / lock files that never yield candidates. */
export const EXCLUDED_FILE_PATTERNS: readonly RegExp[] = [
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock)$/i,
  /\.min\.(js|css)$/i,
  /\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff|pdf|zip|gz|tgz|bz2|7z|rar|jar|war|exe|dll|so|dylib|bin|wasm|mp3|mp4|mov|avi|woff2?|ttf|otf|eot|sqlite|db)$/i,
  /\.map$/i,
];

export type FetchDecision = { allowed: true } | { allowed: false; reason: 'sensitive' | 'excluded' };

export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((re) => re.test(path));
}

export function isExcludedPath(path: string): boolean {
  const segments = path.split('/');
  if (segments.slice(0, -1).some((s) => EXCLUDED_DIRS.includes(s))) return true;
  return EXCLUDED_FILE_PATTERNS.some((re) => re.test(path));
}

export function isFetchAllowed(path: string): FetchDecision {
  if (isSensitivePath(path)) return { allowed: false, reason: 'sensitive' };
  if (isExcludedPath(path)) return { allowed: false, reason: 'excluded' };
  return { allowed: true };
}

export interface SecretPattern {
  name: string;
  pattern: RegExp;
}

/** Secret-shaped strings redacted from every excerpt before it enters a prompt. */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { name: 'github-fine-grained', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'openai-anthropic-key', pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/g },
  { name: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    name: 'private-key-block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { name: 'bearer-header', pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g },
];

export const REDACTED = '[REDACTED]';

export function scrubSecrets(text: string): { text: string; redactions: number } {
  let out = text;
  let redactions = 0;
  for (const { pattern } of SECRET_PATTERNS) {
    out = out.replace(pattern, () => {
      redactions++;
      return REDACTED;
    });
  }
  return { text: out, redactions };
}

/**
 * Last line of defence before `complete()`: throws if any provided secret
 * string appears in any message. Called with the GitHub token (and anything
 * else the run knows to be secret) — audit S2.
 */
export function assertNoSecrets(messages: ChatMessage[], secrets: Array<string | undefined>): void {
  const live = secrets.filter((s): s is string => Boolean(s && s.length >= 8));
  for (const m of messages) {
    for (const s of live) {
      if (m.content.includes(s)) {
        throw new Error('Refusing to send: a secret would be included in the prompt');
      }
    }
  }
}

function escapeCloser(text: string, tag: string): string {
  return text.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
}

/** Delimited data block for the prompt; content is data, never instructions. */
export function wrapExcerpt(tag: 'file' | 'spec', path: string, body: string): string {
  return `<${tag} path="${path.replace(/"/g, '&quot;')}">\n${escapeCloser(body, tag)}\n</${tag}>`;
}
