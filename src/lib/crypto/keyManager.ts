// Session-scoped holder for the unwrapped master key. Never persists to disk.
// lock() drops the reference; closing the tab does the same automatically.
//
// All key material decisions (passkey vs recovery code, server material shape,
// etc.) live in src/lib/auth/session.ts. This module just guards in-memory
// state.

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

export function setUnlocked(userId: string, masterKey: CryptoKey): void {
  _masterKey = masterKey;
  _userId = userId;
}

export function lock(): void {
  _masterKey = null;
  _userId = null;
}
