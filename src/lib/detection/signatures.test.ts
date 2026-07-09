import { describe, expect, it } from 'vitest';
import { normalizePath, signatureFor, VOLATILE_FIELDS } from './signatures';

describe('normalizePath', () => {
  it('collapses duplicate slashes', () => {
    expect(normalizePath('/app//src///config.ts')).toBe('/app/src/config.ts');
  });

  it('resolves . and .. segments', () => {
    expect(normalizePath('/app/src/./sub/../config.ts')).toBe('/app/src/config.ts');
  });

  it('strips trailing slashes', () => {
    expect(normalizePath('/app/src/')).toBe('/app/src');
  });

  it('keeps relative paths relative', () => {
    expect(normalizePath('src/../lib/db.ts')).toBe('lib/db.ts');
    expect(normalizePath('./x/..')).toBe('.');
  });
});

describe('signatureFor — equivalence (acceptance a)', () => {
  it('whitespace variants of a command produce identical signatures', () => {
    expect(signatureFor('Bash', { command: '  npm   test ' })).toBe(
      signatureFor('Bash', { command: 'npm test' })
    );
  });

  it('path spelling variants produce identical signatures', () => {
    expect(
      signatureFor('Read', { file_path: '/app//src/./config.ts' })
    ).toBe(signatureFor('Read', { file_path: '/app/src/config.ts' }));
  });

  it('key order does not affect the signature', () => {
    expect(
      signatureFor('Grep', { pattern: 'foo', path: '/app' })
    ).toBe(signatureFor('Grep', { path: '/app', pattern: 'foo' }));
  });

  it('different tool names never collide', () => {
    expect(signatureFor('Read', { file_path: '/a' })).not.toBe(
      signatureFor('Write', { file_path: '/a' })
    );
  });

  it('genuinely different args produce different signatures', () => {
    expect(signatureFor('Bash', { command: 'npm test' })).not.toBe(
      signatureFor('Bash', { command: 'npm run build' })
    );
  });
});

describe('signatureFor — volatile fields (acceptance b)', () => {
  const base = signatureFor('Bash', { command: 'npm test' });

  // Every enumerated volatile field is individually proven inert.
  for (const field of VOLATILE_FIELDS) {
    it(`ignores volatile field "${field}"`, () => {
      expect(
        signatureFor('Bash', { command: 'npm test', [field]: 'volatile-value-123' })
      ).toBe(base);
    });
  }

  it('drops volatile fields in nested objects too', () => {
    expect(
      signatureFor('Task', { spec: { goal: 'x', request_id: 'r-1' } })
    ).toBe(signatureFor('Task', { spec: { goal: 'x' } }));
  });

  it('does not drop non-volatile fields', () => {
    expect(
      signatureFor('Bash', { command: 'npm test', description: 'run tests' })
    ).not.toBe(base);
  });
});
