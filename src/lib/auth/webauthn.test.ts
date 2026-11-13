import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPasskeySupportError, isPasskeySupported } from './webauthn';
import { login, recoverWithCode, signup } from './session';

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('PublicKeyCredential', class {});
  vi.stubGlobal('navigator', { credentials: { create: vi.fn(), get: vi.fn() } });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('passkey availability', () => {
  it('explains LAN HTTP before checking browser features', () => {
    vi.stubGlobal('isSecureContext', false);
    vi.stubGlobal('PublicKeyCredential', undefined);
    expect(getPasskeySupportError()).toContain('same HTTPS Chatdex address');
    expect(isPasskeySupported()).toBe(false);
  });

  it('distinguishes missing browser support on a secure connection', () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    expect(getPasskeySupportError()).toContain('unavailable in this browser');
  });

  it('allows a secure browser with both credential ceremonies', () => {
    expect(getPasskeySupportError()).toBeNull();
    expect(isPasskeySupported()).toBe(true);
  });

  it('blocks partial credential APIs', () => {
    vi.stubGlobal('navigator', { credentials: { get: vi.fn() } });
    expect(isPasskeySupported()).toBe(false);
  });

  it('sends login to the same-origin API rather than the mobile device localhost', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Unknown account' }), { status: 404 }));
    await expect(login('me@example.com')).rejects.toThrow('Unknown account');
    expect(fetch).toHaveBeenCalledWith('/api/auth/passkey/login-init', expect.objectContaining({ method: 'POST' }));
  });

  it('blocks signup, login and recovery on insecure connections before sending credentials', async () => {
    vi.stubGlobal('isSecureContext', false);
    for (const ceremony of [signup('me@example.com'), login('me@example.com'), recoverWithCode('me@example.com', 'code')]) {
      await expect(ceremony).rejects.toThrow('secure connection');
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
