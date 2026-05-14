// Auth session. Holds the JWT in localStorage and exposes
// signup / login / logout / restore flows. Each flow ends with the vault
// either unlocked (master key in memory) or locked.

import {
  provisionAccount,
  unlockWithPassphrase,
  unlockWithRecoveryCode,
  rewrapWithPassphrase,
  regenerateRecoveryCode,
  lock as lockVault,
  type AccountKeyMaterial,
} from '../crypto';

const BACKEND_URL =
  import.meta.env.VITE_API_URL?.replace(/\/api$/, '') || 'http://localhost:3003';

const TOKEN_KEY = 'chatdex.authToken';
const USER_KEY = 'chatdex.user';

export interface SessionUser {
  userId: string;
  email: string;
}

interface WireSealed {
  iv: string;
  ciphertext: string;
}

interface WireMaterial {
  saltAuth: string;
  saltEnc: string;
  kdfParams: AccountKeyMaterial['kdfParams'];
  wrappedByPassphrase: WireSealed;
  wrappedByRecovery: WireSealed;
}

function bufToB64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function b64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function materialFromWire(w: WireMaterial): AccountKeyMaterial {
  return {
    saltAuth: b64ToBuf(w.saltAuth),
    saltEnc: b64ToBuf(w.saltEnc),
    kdfParams: w.kdfParams,
    wrappedByPassphrase: {
      iv: b64ToBuf(w.wrappedByPassphrase.iv),
      ciphertext: b64ToBuf(w.wrappedByPassphrase.ciphertext),
    },
    wrappedByRecovery: {
      iv: b64ToBuf(w.wrappedByRecovery.iv),
      ciphertext: b64ToBuf(w.wrappedByRecovery.ciphertext),
    },
  };
}

function materialToWire(m: AccountKeyMaterial): WireMaterial {
  return {
    saltAuth: bufToB64(m.saltAuth),
    saltEnc: bufToB64(m.saltEnc),
    kdfParams: m.kdfParams,
    wrappedByPassphrase: {
      iv: bufToB64(m.wrappedByPassphrase.iv),
      ciphertext: bufToB64(m.wrappedByPassphrase.ciphertext),
    },
    wrappedByRecovery: {
      iv: bufToB64(m.wrappedByRecovery.iv),
      ciphertext: bufToB64(m.wrappedByRecovery.ciphertext),
    },
  };
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getCurrentUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

function persistSession(token: string, user: SessionUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function postJson<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function getJson<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BACKEND_URL}${path}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function putJson<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface SignupResult {
  user: SessionUser;
  recoveryCode: string;
}

export async function signup(email: string, passphrase: string): Promise<SignupResult> {
  const bundle = await provisionAccount(passphrase);
  const wire = materialToWire(bundle.material);

  const res = await postJson<{ token: string; userId: string; email: string }>(
    '/api/auth/signup',
    {
      email,
      authKey: bufToB64(bundle.authKey),
      saltAuth: wire.saltAuth,
      saltEnc: wire.saltEnc,
      kdfParams: wire.kdfParams,
      wrappedByPassphrase: wire.wrappedByPassphrase,
      wrappedByRecovery: wire.wrappedByRecovery,
    }
  );

  const user = { userId: res.userId, email: res.email };
  persistSession(res.token, user);
  return { user, recoveryCode: bundle.recoveryCode };
}

export async function login(email: string, passphrase: string): Promise<SessionUser> {
  const challenge = await postJson<{ saltAuth: string; kdfParams: AccountKeyMaterial['kdfParams'] }>(
    '/api/auth/challenge',
    { email }
  );

  const { deriveKeyBytes } = await import('../crypto/kdf');
  const authKey = await deriveKeyBytes(passphrase, b64ToBuf(challenge.saltAuth), challenge.kdfParams);

  const res = await postJson<{
    token: string;
    userId: string;
    email: string;
    material: WireMaterial;
  }>('/api/auth/login', { email, authKey: bufToB64(authKey) });

  const material = materialFromWire(res.material);
  await unlockWithPassphrase(res.userId, passphrase, material);

  const user = { userId: res.userId, email: res.email };
  persistSession(res.token, user);
  return user;
}

/**
 * Restore a token from localStorage and try to unlock the vault with the
 * supplied passphrase. If no token exists or the unlock fails, returns null.
 */
export async function restoreAndUnlock(passphrase: string): Promise<SessionUser | null> {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const me = await getJson<{ userId: string; email: string; material: WireMaterial }>(
      '/api/auth/me',
      token
    );
    const material = materialFromWire(me.material);
    await unlockWithPassphrase(me.userId, passphrase, material);
    const user = { userId: me.userId, email: me.email };
    persistSession(token, user);
    return user;
  } catch {
    return null;
  }
}

/**
 * Recover access using the one-time recovery code. Sets a new passphrase and
 * uploads the rewrap to the server.
 */
export async function recoverWithCode(
  email: string,
  recoveryCode: string,
  newPassphrase: string
): Promise<SessionUser> {
  // We need the user's material. The challenge endpoint only returns the auth
  // salt; for recovery we need the full material. Use a no-op placeholder
  // login so the server returns it — this requires the auth key, which we
  // don't have. Workaround: hit /me only after a token-less recovery, which
  // means the server side needs an unauthenticated material-by-email endpoint
  // for recovery. Until that exists, recovery requires being still logged in.
  throw new Error('recoverWithCode requires server endpoint not yet implemented');
  void email;
  void recoveryCode;
  void newPassphrase;
}

export async function changePassphrase(newPassphrase: string): Promise<void> {
  const token = getAuthToken();
  if (!token) throw new Error('Not logged in');
  const me = await getJson<{ material: WireMaterial }>('/api/auth/me', token);
  const material = materialFromWire(me.material);
  const { authKey, updatedMaterial } = await rewrapWithPassphrase(newPassphrase, material);
  const wire = materialToWire(updatedMaterial);
  await putJson('/api/auth/material', {
    authKey: bufToB64(authKey),
    saltAuth: wire.saltAuth,
    saltEnc: wire.saltEnc,
    wrappedByPassphrase: wire.wrappedByPassphrase,
  }, token);
}

export async function rotateRecoveryCode(): Promise<string> {
  const token = getAuthToken();
  if (!token) throw new Error('Not logged in');
  const me = await getJson<{ material: WireMaterial }>('/api/auth/me', token);
  const material = materialFromWire(me.material);
  const { recoveryCode, updatedMaterial } = await regenerateRecoveryCode(material);
  const wire = materialToWire(updatedMaterial);
  await putJson('/api/auth/material', {
    wrappedByRecovery: wire.wrappedByRecovery,
  }, token);
  return recoveryCode;
}

export async function logout(): Promise<void> {
  const token = getAuthToken();
  if (token) {
    try {
      await postJson('/api/auth/logout', {}, token);
    } catch {
      // ignore — we're clearing local state anyway
    }
  }
  clearSession();
  lockVault();
}

export function lock(): void {
  lockVault();
}

// recoverWithCode is intentionally not exported until the corresponding
// server endpoint exists (see TODO above).
void unlockWithRecoveryCode;
