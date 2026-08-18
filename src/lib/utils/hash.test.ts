import { describe, it, expect } from 'vitest';
import { sha256Hex } from './hash';

// Hash stability is a spec requirement (SPEC-decision-investigation §16.1.5):
// exhibits and raw sources are content-addressed, so the digest must match
// the published SHA-256 vectors and be stable across runs and encodings.
describe('sha256Hex', () => {
  it('matches the published SHA-256 test vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('matches the published SHA-256 vector for the empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('is deterministic for non-ASCII and emoji input', async () => {
    const text = 'naïve café — 🎉 日本語';
    const first = await sha256Hex(text);
    expect(await sha256Hex(text)).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinguishes nearly identical inputs', async () => {
    expect(await sha256Hex('line1\nline2')).not.toBe(await sha256Hex('line1\nline2 '));
  });
});
