import { describe, it, expect, beforeEach } from 'vitest';
import { saveDeviceKey, loadDeviceKey, clearDeviceKey } from './deviceKey';
import { importRawKey, encryptString, decryptString, randomBytes } from './primitives';

beforeEach(async () => {
  await clearDeviceKey();
});

describe('device-remembered master key', () => {
  it('round-trips a non-extractable key that still encrypts and decrypts', async () => {
    const raw = randomBytes(32);
    const key = await importRawKey(raw, false);
    await saveDeviceKey('user-1', key);

    const loaded = await loadDeviceKey('user-1');
    expect(loaded).not.toBeNull();
    const sealed = await encryptString(loaded!, 'hello');
    // Same key material: the original handle decrypts what the loaded one sealed.
    expect(await decryptString(key, sealed)).toBe('hello');
  });

  it('never yields key bytes: the stored key cannot be exported', async () => {
    await saveDeviceKey('user-1', await importRawKey(randomBytes(32), false));
    const loaded = await loadDeviceKey('user-1');
    expect(loaded!.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', loaded!)).rejects.toThrow();
  });

  it('refuses to persist an extractable key', async () => {
    const extractable = await importRawKey(randomBytes(32));
    await expect(saveDeviceKey('user-1', extractable)).rejects.toThrow(/extractable/);
    expect(await loadDeviceKey('user-1')).toBeNull();
  });

  it('returns null for a different user', async () => {
    await saveDeviceKey('user-1', await importRawKey(randomBytes(32), false));
    expect(await loadDeviceKey('user-2')).toBeNull();
  });

  it('clearDeviceKey removes it', async () => {
    await saveDeviceKey('user-1', await importRawKey(randomBytes(32), false));
    await clearDeviceKey();
    expect(await loadDeviceKey('user-1')).toBeNull();
  });
});
