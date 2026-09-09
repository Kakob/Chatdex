import { afterEach, describe, expect, it, vi } from 'vitest';
import { mintChallengeToken, verifyChallengeToken } from './challengeToken.js';

const payload = {
  intent: 'register' as const,
  email: 'a@example.com',
  challenge: 'Y2hhbGxlbmdl',
  prfSalt: 'c2FsdA',
  pendingUserId: 'u-1',
};

describe('challenge tokens (architecture.md: signed, 5-minute, timing-safe)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('round-trips a payload and stamps a future expiry', () => {
    const before = Date.now();
    const token = mintChallengeToken(payload);
    const back = verifyChallengeToken(token);
    expect(back).toMatchObject(payload);
    expect(back.exp).toBeGreaterThan(before);
    expect(back.exp).toBeLessThanOrEqual(before + 5 * 60 * 1000 + 50);
  });

  it('rejects a token whose body was tampered with', () => {
    const token = mintChallengeToken(payload);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), email: 'b@example.com' }),
    ).toString('base64url');
    expect(() => verifyChallengeToken(`${forged}.${sig}`)).toThrow('Invalid challenge token signature');
  });

  it('rejects a token whose signature was tampered with, including a length change', () => {
    const token = mintChallengeToken(payload);
    const [body, sig] = token.split('.');
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(() => verifyChallengeToken(`${body}.${flipped}`)).toThrow('Invalid challenge token signature');
    expect(() => verifyChallengeToken(`${body}.${sig.slice(0, 10)}`)).toThrow('Invalid challenge token signature');
    expect(() => verifyChallengeToken(body)).toThrow('Malformed challenge token');
  });

  it('rejects replay after the 5-minute window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
    const token = mintChallengeToken(payload);
    vi.setSystemTime(new Date('2026-09-09T12:04:59Z'));
    expect(() => verifyChallengeToken(token)).not.toThrow();
    vi.setSystemTime(new Date('2026-09-09T12:05:01Z'));
    expect(() => verifyChallengeToken(token)).toThrow('Challenge token expired');
  });

  it('refuses to sign or verify without a 32+ char JWT_SECRET', () => {
    const token = mintChallengeToken(payload);
    vi.stubEnv('JWT_SECRET', 'short');
    expect(() => mintChallengeToken(payload)).toThrow('JWT_SECRET');
    expect(() => verifyChallengeToken(token)).toThrow('JWT_SECRET');
  });

  it('a token minted under one secret does not verify under another', () => {
    const token = mintChallengeToken(payload);
    vi.stubEnv('JWT_SECRET', 'another-secret-that-is-also-at-least-32-chars');
    expect(() => verifyChallengeToken(token)).toThrow('Invalid challenge token signature');
  });
});
