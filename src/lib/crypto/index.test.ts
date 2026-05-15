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
  generateMasterKey,
  importRawKey,
  exportRawKey,
  isUnlocked,
  getMasterKey,
  setUnlocked,
  lock,
  generateRecoveryCode,
  formatRecoveryCode,
  parseRecoveryCode,
  recoveryCodeToKey,
  wrapMasterKey,
  unwrapMasterKey,
} from './index';

beforeEach(() => {
  lock();
});

describe('AES-GCM primitives', () => {
  it('round-trips strings', async () => {
    const key = await generateMasterKey();
    const sealed = await encryptString(key, 'hello, world');
    expect(sealed.iv).toHaveLength(12);
    expect(await decryptString(key, sealed)).toBe('hello, world');
  });

  it('round-trips JSON', async () => {
    const key = await generateMasterKey();
    const value = { foo: 'bar', n: 42, nested: { arr: [1, 2, 3] } };
    const sealed = await encryptJSON(key, value);
    expect(await decryptJSON(key, sealed)).toEqual(value);
  });

  it('round-trips raw bytes', async () => {
    const key = await generateMasterKey();
    const plaintext = randomBytes(64);
    const sealed = await encryptBytes(key, plaintext);
    expect(await decryptBytes(key, sealed)).toEqual(plaintext);
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
    const bad = 'UUUUU-UUUUU-UUUUU-UUUUU-UUUUU-UUUUU-UUUUU-UUUUU';
    expect(() => parseRecoveryCode(bad)).toThrow(/Invalid recovery-code character/);
  });
});

describe('recovery code wrap/unwrap', () => {
  it('round-trips the master key through the recovery wrap', async () => {
    const masterKey = await generateMasterKey();
    const masterKeyRaw = await exportRawKey(masterKey);

    const { code, raw } = generateRecoveryCode();
    const recoveryKey = await recoveryCodeToKey(raw);
    const sealed = await wrapMasterKey(recoveryKey, masterKeyRaw);

    // Simulate recovery: parse the displayed code and unwrap.
    const reparsedRaw = parseRecoveryCode(code);
    const reparsedKey = await recoveryCodeToKey(reparsedRaw);
    const unwrapped = await unwrapMasterKey(reparsedKey, sealed);
    expect(unwrapped).toEqual(masterKeyRaw);
  });

  it('refuses to unwrap with the wrong recovery code', async () => {
    const masterKey = await generateMasterKey();
    const masterKeyRaw = await exportRawKey(masterKey);

    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    const wrappingKey = await recoveryCodeToKey(a.raw);
    const wrongKey = await recoveryCodeToKey(b.raw);
    const sealed = await wrapMasterKey(wrappingKey, masterKeyRaw);

    await expect(unwrapMasterKey(wrongKey, sealed)).rejects.toBeDefined();
  });
});

describe('key manager', () => {
  it('starts locked', () => {
    expect(isUnlocked()).toBe(false);
    expect(() => getMasterKey()).toThrow(/locked/);
  });

  it('setUnlocked exposes a usable master key', async () => {
    const k = await generateMasterKey();
    setUnlocked('user-1', k);
    expect(isUnlocked()).toBe(true);
    const sealed = await encryptString(getMasterKey(), 'in session');
    expect(await decryptString(getMasterKey(), sealed)).toBe('in session');
  });

  it('lock() drops the key', async () => {
    setUnlocked('u', await generateMasterKey());
    lock();
    expect(isUnlocked()).toBe(false);
    expect(() => getMasterKey()).toThrow(/locked/);
  });
});
