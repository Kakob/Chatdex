// Server-side hashing of the client-derived auth key. The auth key is already
// the output of a slow client-side Argon2id, so SHA-256 with a per-user salt
// is enough to ensure a leaked DB doesn't directly expose login material.
// Constant-time compare on verification.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function newServerSalt(): Buffer {
  return randomBytes(16);
}

export function hashAuthKey(authKey: Buffer, serverSalt: Buffer): Buffer {
  const h = createHash('sha256');
  h.update(serverSalt);
  h.update(authKey);
  return h.digest();
}

export function verifyAuthKey(
  authKey: Buffer,
  serverSalt: Buffer,
  storedHash: Buffer
): boolean {
  const candidate = hashAuthKey(authKey, serverSalt);
  if (candidate.length !== storedHash.length) return false;
  return timingSafeEqual(candidate, storedHash);
}
