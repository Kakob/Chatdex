// Session-scoped key cache. Holds the unwrapped master key in memory only —
// never persists to disk or IndexedDB. lock() drops the reference so that
// closing the tab or calling lock() removes the ability to decrypt.

import { deriveAuthAndEncryption, DEFAULT_KDF_PARAMS, type KdfParams } from './kdf';
import {
  importRawKey,
  randomBytes,
  generateMasterKey,
  exportRawKey,
  type Sealed,
} from './primitives';
import {
  recoveryCodeToKey,
  parseRecoveryCode,
  wrapMasterKey,
  unwrapMasterKey,
  generateRecoveryCode,
} from './recovery';

export interface AccountKeyMaterial {
  saltAuth: Uint8Array;
  saltEnc: Uint8Array;
  kdfParams: KdfParams;
  wrappedByPassphrase: Sealed;
  wrappedByRecovery: Sealed;
}

export interface SignupBundle {
  /** Argon2id-derived auth key — sent to the server, hashed there. */
  authKey: Uint8Array;
  /** Salts and wrapped keys to persist on the server. */
  material: AccountKeyMaterial;
  /** Plaintext recovery code shown to the user once at signup. */
  recoveryCode: string;
}

let _masterKey: CryptoKey | null = null;
let _userId: string | null = null;

export function isUnlocked(): boolean {
  return _masterKey !== null;
}

export function getMasterKey(): CryptoKey {
  if (!_masterKey) {
    throw new Error('Vault is locked');
  }
  return _masterKey;
}

export function getCurrentUserId(): string | null {
  return _userId;
}

export function lock(): void {
  _masterKey = null;
  _userId = null;
}

/**
 * Generate fresh key material for a new account. The caller posts
 * `authKey` + `material` to the server, then shows `recoveryCode` to the user
 * exactly once.
 */
export async function provisionAccount(passphrase: string): Promise<SignupBundle> {
  const saltAuth = randomBytes(16);
  const saltEnc = randomBytes(16);
  const kdfParams = DEFAULT_KDF_PARAMS;

  const { authKey, encryptionKey } = await deriveAuthAndEncryption(
    passphrase,
    saltAuth,
    saltEnc,
    kdfParams
  );

  const masterKey = await generateMasterKey();
  const masterKeyRaw = await exportRawKey(masterKey);

  const { code: recoveryCode, raw: recoveryRaw } = generateRecoveryCode();
  const recoveryKey = await recoveryCodeToKey(recoveryRaw);

  const wrappedByPassphrase = await wrapMasterKey(encryptionKey, masterKeyRaw);
  const wrappedByRecovery = await wrapMasterKey(recoveryKey, masterKeyRaw);

  // Leave the new account in the unlocked state — the user just signed up
  // and expects to be able to use the app immediately. They can lock by
  // closing the tab or calling lock().
  _masterKey = masterKey;

  return {
    authKey,
    material: {
      saltAuth,
      saltEnc,
      kdfParams,
      wrappedByPassphrase,
      wrappedByRecovery,
    },
    recoveryCode,
  };
}

/**
 * Unlock the vault using a passphrase against material previously fetched
 * from the server. Returns the auth key so the caller can present it for
 * server-side verification (typically already done before this call).
 */
export async function unlockWithPassphrase(
  userId: string,
  passphrase: string,
  material: AccountKeyMaterial
): Promise<{ authKey: Uint8Array }> {
  const { authKey, encryptionKey } = await deriveAuthAndEncryption(
    passphrase,
    material.saltAuth,
    material.saltEnc,
    material.kdfParams
  );
  const masterKeyRaw = await unwrapMasterKey(encryptionKey, material.wrappedByPassphrase);
  _masterKey = await importRawKey(masterKeyRaw);
  _userId = userId;
  return { authKey };
}

/**
 * Unlock using the recovery code. Returns the master key plus a fresh wrapping
 * derived from `newPassphrase` — the caller is expected to push the new
 * `wrappedByPassphrase` back to the server so that future logins use the new
 * passphrase.
 */
export async function unlockWithRecoveryCode(
  userId: string,
  recoveryCode: string,
  material: AccountKeyMaterial,
  newPassphrase: string
): Promise<{ authKey: Uint8Array; updatedMaterial: AccountKeyMaterial }> {
  const recoveryRaw = parseRecoveryCode(recoveryCode);
  const recoveryKey = await recoveryCodeToKey(recoveryRaw);
  const masterKeyRaw = await unwrapMasterKey(recoveryKey, material.wrappedByRecovery);
  _masterKey = await importRawKey(masterKeyRaw);
  _userId = userId;

  // Re-wrap master key with a fresh passphrase + fresh salts.
  const saltAuth = randomBytes(16);
  const saltEnc = randomBytes(16);
  const { authKey, encryptionKey } = await deriveAuthAndEncryption(
    newPassphrase,
    saltAuth,
    saltEnc,
    material.kdfParams
  );
  const wrappedByPassphrase = await wrapMasterKey(encryptionKey, masterKeyRaw);

  return {
    authKey,
    updatedMaterial: {
      ...material,
      saltAuth,
      saltEnc,
      wrappedByPassphrase,
    },
  };
}

/**
 * Re-wrap the master key with a new passphrase, without rotating it. Used
 * by the "change passphrase" settings flow.
 */
export async function rewrapWithPassphrase(
  newPassphrase: string,
  currentMaterial: AccountKeyMaterial
): Promise<{ authKey: Uint8Array; updatedMaterial: AccountKeyMaterial }> {
  if (!_masterKey) throw new Error('Vault is locked');
  const masterKeyRaw = await exportRawKey(_masterKey);

  const saltAuth = randomBytes(16);
  const saltEnc = randomBytes(16);
  const { authKey, encryptionKey } = await deriveAuthAndEncryption(
    newPassphrase,
    saltAuth,
    saltEnc,
    currentMaterial.kdfParams
  );
  const wrappedByPassphrase = await wrapMasterKey(encryptionKey, masterKeyRaw);

  return {
    authKey,
    updatedMaterial: { ...currentMaterial, saltAuth, saltEnc, wrappedByPassphrase },
  };
}

/**
 * Generate a fresh recovery code, re-wrapping the (unchanged) master key.
 * Returns the new code (show once) and the updated material.
 */
export async function regenerateRecoveryCode(
  currentMaterial: AccountKeyMaterial
): Promise<{ recoveryCode: string; updatedMaterial: AccountKeyMaterial }> {
  if (!_masterKey) throw new Error('Vault is locked');
  const masterKeyRaw = await exportRawKey(_masterKey);

  const { code: recoveryCode, raw: recoveryRaw } = generateRecoveryCode();
  const recoveryKey = await recoveryCodeToKey(recoveryRaw);
  const wrappedByRecovery = await wrapMasterKey(recoveryKey, masterKeyRaw);

  return {
    recoveryCode,
    updatedMaterial: { ...currentMaterial, wrappedByRecovery },
  };
}
