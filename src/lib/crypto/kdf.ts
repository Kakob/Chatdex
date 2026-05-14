// Argon2id key derivation via hash-wasm. We derive two keys from a single
// passphrase by using two distinct salts:
//   - auth_key: sent to the server (server stores argon2id(auth_key))
//   - encryption KEK: never leaves the client; wraps the master key
//
// Params (m=64MiB, t=3, p=1) match OWASP's interactive baseline as of 2026.
// Bumping any of these fields is a forward-only migration: re-derive on next
// unlock and re-wrap the master key.

import { argon2id } from 'hash-wasm';
import { importRawKey } from './primitives';

export interface KdfParams {
  algorithm: 'argon2id';
  iterations: number;
  memoryKiB: number;
  parallelism: number;
  hashBytes: number;
}

export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: 'argon2id',
  iterations: 3,
  memoryKiB: 64 * 1024,
  parallelism: 1,
  hashBytes: 32,
};

export async function deriveKeyBytes(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS
): Promise<Uint8Array> {
  if (salt.length < 16) {
    throw new Error(`KDF salt must be at least 16 bytes, got ${salt.length}`);
  }
  if (params.algorithm !== 'argon2id') {
    throw new Error(`Unsupported KDF algorithm: ${params.algorithm}`);
  }
  const result = await argon2id({
    password: passphrase,
    salt,
    iterations: params.iterations,
    memorySize: params.memoryKiB,
    parallelism: params.parallelism,
    hashLength: params.hashBytes,
    outputType: 'binary',
  });
  return result;
}

export async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS
): Promise<CryptoKey> {
  const raw = await deriveKeyBytes(passphrase, salt, params);
  return importRawKey(raw);
}

export interface DerivedSecrets {
  /** Sent to the server for authentication. Server stores argon2id(authKey). */
  authKey: Uint8Array;
  /** Stays on the client; wraps the master key. Never sent anywhere. */
  encryptionKey: CryptoKey;
}

/**
 * Derive both auth and encryption secrets from a single passphrase.
 * Two distinct salts are used so the two keys are unlinkable.
 */
export async function deriveAuthAndEncryption(
  passphrase: string,
  saltAuth: Uint8Array,
  saltEnc: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS
): Promise<DerivedSecrets> {
  const [authKey, encryptionKey] = await Promise.all([
    deriveKeyBytes(passphrase, saltAuth, params),
    deriveAesKey(passphrase, saltEnc, params),
  ]);
  return { authKey, encryptionKey };
}
