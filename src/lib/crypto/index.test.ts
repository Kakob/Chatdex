import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptString,
  decryptString,
  encryptJSON,
  decryptJSON,
  encryptBytes,
  decryptBytes,
  randomBytes,
  randomIv,
} from './primitives';
import { generateMasterKey, importRawKey, exportRawKey } from './primitives';
import { deriveKeyBytes, deriveAesKey, type KdfParams } from './kdf';
import {
  generateRecoveryCode,
  formatRecoveryCode,
  parseRecoveryCode,
} from './recovery';
import {
  provisionAccount,
  unlockWithPassphrase,
  unlockWithRecoveryCode,
  rewrapWithPassphrase,
  regenerateRecoveryCode,
  lock,
  isUnlocked,
  getMasterKey,
} from './keyManager';

// Argon2id is intentionally slow. Use cheap params in tests.
const TEST_KDF: KdfParams = {
  algorithm: 'argon2id',
  iterations: 1,
  memoryKiB: 1024,
  parallelism: 1,
  hashBytes: 32,
};

beforeEach(() => {
  lock();
});

describe('AES-GCM primitives', () => {
  it('round-trips strings', async () => {
    const key = await generateMasterKey();
    const sealed = await encryptString(key, 'hello, world');
    expect(sealed.iv).toHaveLength(12);
    const out = await decryptString(key, sealed);
    expect(out).toBe('hello, world');
  });

  it('round-trips JSON', async () => {
    const key = await generateMasterKey();
    const value = { foo: 'bar', n: 42, nested: { arr: [1, 2, 3] } };
    const sealed = await encryptJSON(key, value);
    const out = await decryptJSON(key, sealed);
    expect(out).toEqual(value);
  });

  it('round-trips raw bytes', async () => {
    const key = await generateMasterKey();
    const plaintext = randomBytes(64);
    const sealed = await encryptBytes(key, plaintext);
    const out = await decryptBytes(key, sealed);
    expect(out).toEqual(plaintext);
  });

  it('produces a fresh IV per call', async () => {
    const key = await generateMasterKey();
    const a = await encryptString(key, 'x');
    const b = await encryptString(key, 'x');
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it('rejects tampered ciphertext', async () => {
    const key = await generateMasterKey();
    const sealed = await encryptString(key, 'top secret');
    sealed.ciphertext[0] ^= 0x01;
    await expect(decryptString(key, sealed)).rejects.toBeDefined();
  });

  it('rejects tampered IV', async () => {
    const key = await generateMasterKey();
    const sealed = await encryptString(key, 'top secret');
    sealed.iv[0] ^= 0x01;
    await expect(decryptString(key, sealed)).rejects.toBeDefined();
  });

  it('rejects decryption with the wrong key', async () => {
    const k1 = await generateMasterKey();
    const k2 = await generateMasterKey();
    const sealed = await encryptString(k1, 'top secret');
    await expect(decryptString(k2, sealed)).rejects.toBeDefined();
  });

  it('randomIv yields 12 bytes', () => {
    expect(randomIv()).toHaveLength(12);
  });

  it('exports and re-imports a raw key', async () => {
    const k = await generateMasterKey();
    const raw = await exportRawKey(k);
    expect(raw).toHaveLength(32);
    const restored = await importRawKey(raw);
    const sealed = await encryptString(k, 'roundtrip');
    expect(await decryptString(restored, sealed)).toBe('roundtrip');
  });
});

describe('Argon2id KDF', () => {
  it('is deterministic for the same passphrase + salt', async () => {
    const salt = randomBytes(16);
    const a = await deriveKeyBytes('correct horse', salt, TEST_KDF);
    const b = await deriveKeyBytes('correct horse', salt, TEST_KDF);
    expect(a).toEqual(b);
  });

  it('produces different output for different salts', async () => {
    const a = await deriveKeyBytes('p', randomBytes(16), TEST_KDF);
    const b = await deriveKeyBytes('p', randomBytes(16), TEST_KDF);
    expect(a).not.toEqual(b);
  });

  it('produces different output for different passphrases', async () => {
    const salt = randomBytes(16);
    const a = await deriveKeyBytes('p1', salt, TEST_KDF);
    const b = await deriveKeyBytes('p2', salt, TEST_KDF);
    expect(a).not.toEqual(b);
  });

  it('rejects salts shorter than 16 bytes', async () => {
    await expect(
      deriveKeyBytes('p', new Uint8Array(8), TEST_KDF)
    ).rejects.toThrow(/at least 16 bytes/);
  });

  it('deriveAesKey yields a usable AES-GCM CryptoKey', async () => {
    const salt = randomBytes(16);
    const k = await deriveAesKey('p', salt, TEST_KDF);
    const sealed = await encryptString(k, 'derived');
    expect(await decryptString(k, sealed)).toBe('derived');
  });
});

describe('recovery code format', () => {
  it('round-trips a freshly generated code', () => {
    const { code, raw } = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-Z-]+$/);
    const groups = code.split('-');
    expect(groups).toHaveLength(8);
    for (const g of groups) expect(g).toHaveLength(5);

    const reparsed = parseRecoveryCode(code);
    expect(reparsed).toEqual(raw);
  });

  it('normalizes lowercase, missing dashes, and confusable chars', () => {
    const raw = randomBytes(25);
    const formatted = formatRecoveryCode(raw);
    const messy = formatted.toLowerCase().replace(/-/g, '').replace(/0/g, 'O');
    const reparsed = parseRecoveryCode(messy);
    const directly = parseRecoveryCode(formatted);
    expect(reparsed).toEqual(directly);
  });

  it('rejects codes with the wrong length', () => {
    expect(() => parseRecoveryCode('ABC-123')).toThrow(/40 chars/);
  });

  it('rejects codes with invalid characters', () => {
    // U is not in Crockford alphabet
    const bad = 'UUUUU-UUUUU-UUUUU-UUUUU-UUUUU-UUUUU-UUUUU-UUUUU';
    expect(() => parseRecoveryCode(bad)).toThrow(/Invalid recovery-code character/);
  });
});

describe('keyManager full lifecycle', () => {
  // Override default KDF in keyManager by going through provisionAccount with
  // a slow-but-real flow would exceed the test timeout. Use a passphrase-level
  // shortcut: keyManager always uses DEFAULT_KDF_PARAMS, but we can test the
  // end-to-end shape by accepting the slower path for one test.

  it('provision -> unlockWithPassphrase round-trips master key', async () => {
    // Deliberately slow: this exercises the real KDF params end-to-end.
    const bundle = await provisionAccount('correct horse battery staple');
    expect(bundle.recoveryCode).toMatch(/^[0-9A-Z-]+$/);
    expect(bundle.authKey).toHaveLength(32);
    expect(isUnlocked()).toBe(true);

    lock();
    expect(isUnlocked()).toBe(false);

    const { authKey } = await unlockWithPassphrase(
      'user-1',
      'correct horse battery staple',
      bundle.material
    );
    expect(isUnlocked()).toBe(true);
    expect(authKey).toEqual(bundle.authKey);

    const sealed = await encryptString(getMasterKey(), 'session payload');
    expect(await decryptString(getMasterKey(), sealed)).toBe('session payload');
  }, 30_000);

  it('unlockWithPassphrase rejects the wrong passphrase', async () => {
    const bundle = await provisionAccount('right answer');
    lock();
    await expect(
      unlockWithPassphrase('u', 'wrong answer', bundle.material)
    ).rejects.toBeDefined();
    expect(isUnlocked()).toBe(false);
  }, 30_000);

  it('unlockWithRecoveryCode unlocks and re-wraps with new passphrase', async () => {
    const bundle = await provisionAccount('original passphrase');
    lock();

    const { authKey, updatedMaterial } = await unlockWithRecoveryCode(
      'u',
      bundle.recoveryCode,
      bundle.material,
      'new passphrase'
    );
    expect(isUnlocked()).toBe(true);
    expect(updatedMaterial.saltAuth).not.toEqual(bundle.material.saltAuth);
    expect(updatedMaterial.wrappedByPassphrase.ciphertext).not.toEqual(
      bundle.material.wrappedByPassphrase.ciphertext
    );

    // The new passphrase now unlocks against the updated material.
    lock();
    const reopened = await unlockWithPassphrase('u', 'new passphrase', updatedMaterial);
    expect(reopened.authKey).toEqual(authKey);
  }, 60_000);

  it('rewrapWithPassphrase rotates auth key without rotating master', async () => {
    const bundle = await provisionAccount('first');
    const masterAfterUnlock = await exportRawKey(getMasterKey());

    const { updatedMaterial } = await rewrapWithPassphrase('second', bundle.material);
    expect(updatedMaterial.wrappedByRecovery).toEqual(bundle.material.wrappedByRecovery);

    lock();
    await unlockWithPassphrase('u', 'second', updatedMaterial);
    const masterAfterRewrap = await exportRawKey(getMasterKey());
    expect(masterAfterRewrap).toEqual(masterAfterUnlock);
  }, 60_000);

  it('regenerateRecoveryCode rotates only the recovery wrap', async () => {
    const bundle = await provisionAccount('p');
    const { recoveryCode, updatedMaterial } = await regenerateRecoveryCode(bundle.material);

    expect(recoveryCode).not.toBe(bundle.recoveryCode);
    expect(updatedMaterial.wrappedByPassphrase).toEqual(bundle.material.wrappedByPassphrase);
    expect(updatedMaterial.wrappedByRecovery).not.toEqual(bundle.material.wrappedByRecovery);

    lock();
    // Old recovery code no longer works.
    await expect(
      unlockWithRecoveryCode('u', bundle.recoveryCode, updatedMaterial, 'np')
    ).rejects.toBeDefined();

    // New recovery code does.
    await expect(
      unlockWithRecoveryCode('u', recoveryCode, updatedMaterial, 'np')
    ).resolves.toBeDefined();
  }, 90_000);

  it('lock() drops the master key', async () => {
    await provisionAccount('p');
    expect(isUnlocked()).toBe(true);
    lock();
    expect(isUnlocked()).toBe(false);
    expect(() => getMasterKey()).toThrow(/locked/);
  }, 30_000);
});
