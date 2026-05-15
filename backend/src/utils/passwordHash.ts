// Server-side hashing of secrets we need to verify but never want to store
// in cleartext. Used for the recovery code: SHA-256(serverSalt || code).
// Constant-time comparison on verification.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function newServerSalt(): Buffer {
  return randomBytes(16);
}

export function hashSecret(secret: Buffer, serverSalt: Buffer): Buffer {
  const h = createHash('sha256');
  h.update(serverSalt);
  h.update(secret);
  return h.digest();
}

export function verifySecret(
  secret: Buffer,
  serverSalt: Buffer,
  storedHash: Buffer
): boolean {
  const candidate = hashSecret(secret, serverSalt);
  if (candidate.length !== storedHash.length) return false;
  return timingSafeEqual(candidate, storedHash);
}
