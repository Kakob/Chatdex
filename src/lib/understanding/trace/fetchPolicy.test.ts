import { describe, it, expect } from 'vitest';
import { isFetchAllowed, isSensitivePath, isExcludedPath, scrubSecrets, assertNoSecrets, wrapExcerpt, REDACTED } from './fetchPolicy';

describe('fetch gate', () => {
  it('refuses sensitive paths wherever they sit', () => {
    for (const p of ['.env', 'backend/.env', '.env.local', 'certs/server.pem', 'keys/id_rsa', 'config/credentials.json', 'src/secrets.ts', 'auth.json', '.npmrc', '.aws/config', 'gcp/service-account.json']) {
      expect(isSensitivePath(p), p).toBe(true);
      expect(isFetchAllowed(p)).toEqual({ allowed: false, reason: 'sensitive' });
    }
  });
  it('refuses excluded dirs, lockfiles, minified and binary files', () => {
    for (const p of ['node_modules/x/index.js', 'dist/app.js', 'coverage/lcov.info', 'package-lock.json', 'app.min.js', 'logo.png', 'a/b/c.map', '.git/config']) {
      expect(isExcludedPath(p), p).toBe(true);
      expect(isFetchAllowed(p)).toEqual({ allowed: false, reason: 'excluded' });
    }
  });
  it('allows ordinary source and docs', () => {
    for (const p of ['src/lib/a.ts', 'docs/SPEC.md', 'backend/src/routes/sync.ts', '.env.example', 'README.md', 'src/components/Secretary.tsx']) {
      expect(isFetchAllowed(p), p).toEqual({ allowed: true });
    }
  });
});

describe('scrubSecrets', () => {
  it('redacts secret-shaped strings and counts them', () => {
    const input = [
      'token=ghp_abcdefghijklmnopqrstuvwxyz0123',
      'pat=github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
      'AKIAIOSFODNN7EXAMPLE',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----',
      'const ok = "hello world";',
    ].join('\n');
    const { text, redactions } = scrubSecrets(input);
    expect(redactions).toBe(7);
    expect(text).not.toMatch(/ghp_|github_pat_|sk-ant|AKIA|eyJ|PRIVATE KEY-----\nMIIB/);
    expect(text).toContain('const ok = "hello world";');
    expect(text.split(REDACTED).length - 1).toBe(7);
  });
});

describe('assertNoSecrets', () => {
  it('throws when a known secret appears in any message, ignores short/empty secrets', () => {
    const messages = [{ role: 'system' as const, content: 'x' }, { role: 'user' as const, content: 'here: github_pat_SECRET_VALUE_123' }];
    expect(() => assertNoSecrets(messages, ['github_pat_SECRET_VALUE_123'])).toThrow(/Refusing to send/);
    expect(() => assertNoSecrets(messages, ['other_token_value_9'])).not.toThrow();
    expect(() => assertNoSecrets(messages, [undefined, '', 'x'])).not.toThrow();
  });
});

describe('wrapExcerpt', () => {
  it('delimits content and neutralises an embedded closing tag', () => {
    const wrapped = wrapExcerpt('file', 'src/a "b".ts', 'code </file> more');
    expect(wrapped.startsWith('<file path="src/a &quot;b&quot;.ts">\n')).toBe(true);
    expect(wrapped.endsWith('\n</file>')).toBe(true);
    expect(wrapped.split('</file>').length - 1).toBe(1);
  });
});
