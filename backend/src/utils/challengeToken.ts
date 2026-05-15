// Signed, short-lived challenge tokens. Used to round-trip WebAuthn
// challenge state (challenge bytes + PRF salt + email + intent + expiry)
// between init/finish without needing a server-side challenge table.
//
// Format: base64url(JSON.stringify(payload)) + '.' + base64url(hmac-sha256)
// Signed with JWT_SECRET so only this server can mint valid tokens.

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export type ChallengeIntent = 'register' | 'authenticate' | 'recover-enroll';

export interface ChallengePayload {
  intent: ChallengeIntent;
  email: string;
  challenge: string; // base64url
  prfSalt: string; // base64url
  /** Pre-allocated user ID for new account creation; ignored otherwise. */
  pendingUserId?: string;
  exp: number; // unix ms
}

const TTL_MS = 5 * 60 * 1000;

function secret(): Buffer {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 chars for challenge signing');
  }
  return Buffer.from(s, 'utf8');
}

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export function newChallengeBytes(): Buffer {
  return randomBytes(32);
}

export function newPrfSalt(): Buffer {
  return randomBytes(32);
}

export function mintChallengeToken(
  payload: Omit<ChallengePayload, 'exp'>
): string {
  const full: ChallengePayload = { ...payload, exp: Date.now() + TTL_MS };
  const body = b64url(Buffer.from(JSON.stringify(full)));
  const sig = createHmac('sha256', secret()).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

export function verifyChallengeToken(token: string): ChallengePayload {
  const dot = token.indexOf('.');
  if (dot < 0) throw new Error('Malformed challenge token');
  const body = token.slice(0, dot);
  const sig = fromB64url(token.slice(dot + 1));
  const expected = createHmac('sha256', secret()).update(body).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    throw new Error('Invalid challenge token signature');
  }
  const payload = JSON.parse(fromB64url(body).toString('utf8')) as ChallengePayload;
  if (payload.exp < Date.now()) {
    throw new Error('Challenge token expired');
  }
  return payload;
}
