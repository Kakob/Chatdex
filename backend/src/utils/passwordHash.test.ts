import { describe, expect, it } from 'vitest';
import { hashSecret, newServerSalt, verifySecret } from './passwordHash.js';

describe('recovery-code hashing (architecture.md: never stored cleartext, constant-time verify)', () => {
  const code = Buffer.from('ABCDE-FGHIJ-KLMNO-PQRST');

  it('stores a 32-byte digest that does not contain the code', () => {
    const salt = newServerSalt();
    const hash = hashSecret(code, salt);
    expect(hash.length).toBe(32);
    expect(hash.includes(code)).toBe(false);
    expect(salt.length).toBe(16);
  });

  it('verifies the same code under the same salt and nothing else', () => {
    const salt = newServerSalt();
    const hash = hashSecret(code, salt);
    expect(verifySecret(code, salt, hash)).toBe(true);
    expect(verifySecret(Buffer.from('ABCDE-FGHIJ-KLMNO-PQRSU'), salt, hash)).toBe(false);
    expect(verifySecret(code, newServerSalt(), hash)).toBe(false);
  });

  it('treats a stored hash of the wrong length as a mismatch instead of throwing', () => {
    const salt = newServerSalt();
    expect(verifySecret(code, salt, Buffer.alloc(31))).toBe(false);
    expect(verifySecret(code, salt, Buffer.alloc(0))).toBe(false);
  });

  it('salts: the same code hashes differently under different salts', () => {
    expect(hashSecret(code, newServerSalt()).equals(hashSecret(code, newServerSalt()))).toBe(false);
  });
});
