// Device-remembered key lifecycle (docs/changes/reliable-sync D1). The passkey
// ceremonies need a real authenticator, so these tests cover what happens
// around them: silent resume after a reload, lock, logout, and the opt-out.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resumeFromDevice,
  lock,
  logout,
  getStayUnlocked,
  setStayUnlocked,
} from './session';
import {
  importRawKey,
  randomBytes,
  saveDeviceKey,
  loadDeviceKey,
  clearDeviceKey,
  isUnlocked,
  getMasterKey,
  setUnlocked,
  lock as lockVault,
} from '../crypto';

const user = { userId: 'user-1', email: 'me@example.com' };

function signIn(): void {
  localStorage.setItem('chatdex.authToken', 'jwt');
  localStorage.setItem('chatdex.user', JSON.stringify(user));
}

async function remember(): Promise<CryptoKey> {
  const key = await importRawKey(randomBytes(32), false);
  await saveDeviceKey(user.userId, key);
  return key;
}

beforeEach(async () => {
  localStorage.clear();
  lockVault();
  await clearDeviceKey();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

describe('resume from the device-remembered key', () => {
  it('unlocks silently after a reload when signed in and remembered', async () => {
    signIn();
    await remember();

    expect(await resumeFromDevice()).toEqual(user);
    expect(isUnlocked()).toBe(true);
    // The live key is the opaque handle; its bytes cannot be exported.
    await expect(crypto.subtle.exportKey('raw', getMasterKey())).rejects.toThrow();
  });

  it('stays locked when nothing is remembered, or when signed out', async () => {
    signIn();
    expect(await resumeFromDevice()).toBeNull();

    localStorage.clear();
    await remember();
    expect(await resumeFromDevice()).toBeNull();
    expect(isUnlocked()).toBe(false);
  });

  it('ignores a key remembered for a different account', async () => {
    signIn();
    await saveDeviceKey('someone-else', await importRawKey(randomBytes(32), false));
    expect(await resumeFromDevice()).toBeNull();
  });
});

describe('lock and logout forget the key', () => {
  it('lock() drops the in-memory key and the remembered copy', async () => {
    signIn();
    await remember();
    await resumeFromDevice();

    await lock();
    expect(isUnlocked()).toBe(false);
    expect(await loadDeviceKey(user.userId)).toBeNull();
    expect(await resumeFromDevice()).toBeNull();
  });

  it('logout() forgets the key and the session', async () => {
    signIn();
    await remember();
    await logout();
    expect(await loadDeviceKey(user.userId)).toBeNull();
    expect(localStorage.getItem('chatdex.authToken')).toBeNull();
  });
});

describe('"Stay unlocked on this device" setting', () => {
  it('defaults to on', () => {
    expect(getStayUnlocked()).toBe(true);
  });

  it('turning it off forgets the key and blocks resume', async () => {
    signIn();
    await remember();
    await setStayUnlocked(false);
    expect(await loadDeviceKey(user.userId)).toBeNull();

    await remember(); // even a stray stored key is not used while off
    expect(await resumeFromDevice()).toBeNull();
  });

  it('turning it back on while unlocked remembers the current key', async () => {
    await setStayUnlocked(false);
    const key = await importRawKey(randomBytes(32), false);
    setUnlocked(user.userId, key);

    await setStayUnlocked(true);
    expect(await loadDeviceKey(user.userId)).not.toBeNull();
  });
});
