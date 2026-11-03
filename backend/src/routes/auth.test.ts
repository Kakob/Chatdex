// Auth route guarantees from architecture.md / auth-architecture.md that
// previously had no test: the boot-time secret guard, recovery that leaves
// the recovery wrap and hash untouched (Path B), and a cloned-authenticator
// counter turning into a clean 401.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const webauthn = vi.hoisted(() => ({
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/server')>()),
  verifyRegistrationResponse: webauthn.verifyRegistrationResponse,
  verifyAuthenticationResponse: webauthn.verifyAuthenticationResponse,
}));

import { buildApp } from '../app.js';
import { users } from '../db/schema.js';
import { b64, bearer, createTestApp, createTestDb, seedUser, type TestApp } from '../test/harness.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
afterEach(() => {
  vi.unstubAllEnvs();
  webauthn.verifyRegistrationResponse.mockReset();
  webauthn.verifyAuthenticationResponse.mockReset();
});

describe('boot guard (architecture.md: JWT_SECRET set and ≥32 chars)', () => {
  it('refuses to build the app without a secret or with a short one', async () => {
    const { db, close } = await createTestDb();
    try {
      vi.stubEnv('JWT_SECRET', '');
      await expect(buildApp({ db, logger: false })).rejects.toThrow('JWT_SECRET');
      vi.stubEnv('JWT_SECRET', 'x'.repeat(31));
      await expect(buildApp({ db, logger: false })).rejects.toThrow('JWT_SECRET');
      vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
      const app = await buildApp({ db, logger: false });
      await app.close();
    } finally {
      await close();
    }
  });
});

describe('GET /api/auth/me', () => {
  it('returns the wrapped material for the JWT user only', async () => {
    const u = await seedUser(t.db);
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: bearer(t.app, u.id, u.email) } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: u.id, email: u.email });
    expect(res.json().material.wrappedByRecovery.ciphertext).toBe(u.row.wrappedByRecoveryCt.toString('base64'));
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
  });
});

describe('recovery (auth-architecture.md Path B)', () => {
  it('recover-init gates on the recovery-code hash', async () => {
    const u = await seedUser(t.db);
    const wrong = await t.app.inject({ method: 'POST', url: '/api/auth/recover-init', payload: { email: u.email, recoveryCode: 'WRONG-CODE' } });
    expect(wrong.statusCode).toBe(401);
    const right = await t.app.inject({ method: 'POST', url: '/api/auth/recover-init', payload: { email: u.email, recoveryCode: u.recoveryCode } });
    expect(right.statusCode).toBe(200);
    expect(right.json().wrappedByRecovery.ciphertext).toBe(u.row.wrappedByRecoveryCt.toString('base64'));
    expect(right.json().token).toBeTruthy();
  });

  it('recover-finish replaces the passkey and its wrap, and leaves the recovery wrap and hash untouched', async () => {
    const u = await seedUser(t.db);
    const init = await t.app.inject({ method: 'POST', url: '/api/auth/recover-init', payload: { email: u.email, recoveryCode: u.recoveryCode } });
    webauthn.verifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: { id: 'new-cred', publicKey: new Uint8Array([9, 9, 9]), counter: 0, transports: ['internal'] },
      },
    });
    const newWrap = { iv: b64(12), ciphertext: b64(48) };
    const staleClientWrap = { iv: b64(12), ciphertext: b64(48) };
    const finish = await t.app.inject({
      method: 'POST',
      url: '/api/auth/recover-finish',
      payload: {
        email: u.email,
        recoveryCode: u.recoveryCode,
        token: init.json().token,
        attestationResponse: {},
        wrappedByPasskey: newWrap,
        // An older client re-sent a recovery wrap; the server must ignore it.
        wrappedByRecovery: staleClientWrap,
      },
    });
    expect(finish.statusCode).toBe(200);

    const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect(row.passkeyCredentialId).toBe('new-cred');
    expect(row.wrappedByPasskeyCt.toString('base64')).toBe(newWrap.ciphertext);
    expect(row.wrappedByPasskeyIv.toString('base64')).toBe(newWrap.iv);
    expect(row.wrappedByRecoveryCt.equals(u.row.wrappedByRecoveryCt)).toBe(true);
    expect(row.wrappedByRecoveryIv.equals(u.row.wrappedByRecoveryIv)).toBe(true);
    expect(row.recoveryCodeHash.equals(u.row.recoveryCodeHash)).toBe(true);
    expect(row.recoveryCodeServerSalt.equals(u.row.recoveryCodeServerSalt)).toBe(true);
    expect(row.prfSalt.equals(u.row.prfSalt)).toBe(false); // new PRF salt for the new passkey

    // The same recovery code still works afterwards.
    const again = await t.app.inject({ method: 'POST', url: '/api/auth/recover-init', payload: { email: u.email, recoveryCode: u.recoveryCode } });
    expect(again.statusCode).toBe(200);
  });

  it('recover-finish re-checks the code and rejects a failed attestation', async () => {
    const u = await seedUser(t.db);
    const init = await t.app.inject({ method: 'POST', url: '/api/auth/recover-init', payload: { email: u.email, recoveryCode: u.recoveryCode } });
    const base = { email: u.email, token: init.json().token, attestationResponse: {}, wrappedByPasskey: { iv: b64(12), ciphertext: b64(48) } };
    expect((await t.app.inject({ method: 'POST', url: '/api/auth/recover-finish', payload: { ...base, recoveryCode: 'WRONG' } })).statusCode).toBe(401);
    webauthn.verifyRegistrationResponse.mockResolvedValueOnce({ verified: false });
    expect((await t.app.inject({ method: 'POST', url: '/api/auth/recover-finish', payload: { ...base, recoveryCode: u.recoveryCode } })).statusCode).toBe(400);
    const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect(row.passkeyCredentialId).toBe(u.row.passkeyCredentialId);
  });
});

describe('login (architecture.md: signature counter / clone detection)', () => {
  async function loginInit(email: string) {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/passkey/login-init', payload: { email } });
    expect(res.statusCode).toBe(200);
    return res.json().token as string;
  }

  it('a non-increasing counter (SimpleWebAuthn throws) is a 401 with no detail', async () => {
    const u = await seedUser(t.db, { passkeyCounter: 7 });
    const token = await loginInit(u.email);
    webauthn.verifyAuthenticationResponse.mockRejectedValueOnce(new Error('Response counter value 3 was lower than expected 7'));
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/passkey/login-finish', payload: { email: u.email, token, assertionResponse: {} } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Assertion failed' });
    const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect(row.passkeyCounter).toBe(7);
  });

  it('a verified assertion stores the new counter and returns the material', async () => {
    const u = await seedUser(t.db, { passkeyCounter: 7 });
    const token = await loginInit(u.email);
    webauthn.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 8 } });
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/passkey/login-finish', payload: { email: u.email, token, assertionResponse: {} } });
    expect(res.statusCode).toBe(200);
    expect(res.json().material.prfSalt).toBe(u.row.prfSalt.toString('base64'));
    const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect(row.passkeyCounter).toBe(8);
  });

  it('rejects a login-finish token minted for another intent or email', async () => {
    const u = await seedUser(t.db);
    const other = await seedUser(t.db);
    const token = await loginInit(other.email);
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/passkey/login-finish', payload: { email: u.email, token, assertionResponse: {} } });
    expect(res.statusCode).toBe(400);
    expect(webauthn.verifyAuthenticationResponse).not.toHaveBeenCalled();
  });
});
