// Auth session orchestration. Drives the WebAuthn passkey ceremonies on the
// browser side and the encrypted-key handoff with the server. JWT lives in
// localStorage; the master key lives only in keyManager memory.

import {
  generateMasterKey,
  exportRawKey,
  importRawKey,
  encryptBytes,
  decryptBytes,
  setUnlocked,
  lock as lockVault,
  generateRecoveryCode,
  recoveryCodeToKey,
  parseRecoveryCode,
  type Sealed,
} from '../crypto';
import {
  enrollPasskey,
  assertPasskey,
  prfOutputToKey,
  isPasskeySupported,
} from './webauthn';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

const BACKEND_URL =
  import.meta.env.VITE_API_URL?.replace(/\/api$/, '') || 'http://localhost:3003';

const TOKEN_KEY = 'chatdex.authToken';
const USER_KEY = 'chatdex.user';

export interface SessionUser {
  userId: string;
  email: string;
}

interface WireSealed {
  iv: string; // base64
  ciphertext: string; // base64
}

interface WireMaterial {
  prfSalt: string;
  wrappedByPasskey: WireSealed;
  wrappedByRecovery: WireSealed;
}

// --- base64 helpers ---

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
function sealedToWire(s: Sealed): WireSealed {
  return { iv: bufToB64(s.iv), ciphertext: bufToB64(s.ciphertext) };
}
function wireToSealed(w: WireSealed): Sealed {
  return { iv: b64ToBuf(w.iv), ciphertext: b64ToBuf(w.ciphertext) };
}

// --- localStorage session ---

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

// --- HTTP helpers ---

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

// --- ceremonies ---

export interface SignupResult {
  user: SessionUser;
  recoveryCode: string;
}

/**
 * Enroll a passkey, generate a master key, wrap it twice (passkey-PRF + recovery
 * code), and create the server account.
 */
export async function signup(email: string): Promise<SignupResult> {
  if (!isPasskeySupported()) {
    throw new Error('This browser does not support passkeys');
  }

  // 1. Server gives us registration options + a signed challenge token.
  const init = await postJson<{
    options: PublicKeyCredentialCreationOptionsJSON;
    token: string;
  }>('/api/auth/passkey/register-init', { email });

  // 2. Browser/authenticator: enroll the passkey + harvest PRF output.
  const { response, prfOutput } = await enrollPasskey(init.options);

  // 3. Generate the master key + wrap it with the PRF-derived key.
  const masterKey = await generateMasterKey();
  const masterKeyRaw = await exportRawKey(masterKey);
  const wrappingKey = await prfOutputToKey(prfOutput);
  const wrappedByPasskey = await encryptBytes(wrappingKey, masterKeyRaw);

  // 4. Generate a recovery code and wrap the master key with it too.
  const { code: recoveryCode, raw: recoveryRaw } = generateRecoveryCode();
  const recoveryKey = await recoveryCodeToKey(recoveryRaw);
  const wrappedByRecovery = await encryptBytes(recoveryKey, masterKeyRaw);

  // 5. Hand the server the encrypted blobs + attestation. Server stores the
  //    user, hashes the recovery code, and returns a JWT.
  const finished = await postJson<{ token: string; userId: string; email: string }>(
    '/api/auth/passkey/register-finish',
    {
      email,
      token: init.token,
      attestationResponse: response,
      wrappedByPasskey: sealedToWire(wrappedByPasskey),
      wrappedByRecovery: sealedToWire(wrappedByRecovery),
      recoveryCode,
    }
  );

  setUnlocked(finished.userId, masterKey);
  const user = { userId: finished.userId, email: finished.email };
  persistSession(finished.token, user);
  return { user, recoveryCode };
}

/**
 * Assert the existing passkey, derive the same wrapping key from PRF, unwrap
 * the master key. Persists the JWT for subsequent reloads.
 */
export async function login(email: string): Promise<SessionUser> {
  if (!isPasskeySupported()) {
    throw new Error('This browser does not support passkeys');
  }

  const init = await postJson<{
    options: PublicKeyCredentialRequestOptionsJSON;
    token: string;
  }>('/api/auth/passkey/login-init', { email });

  const { response, prfOutput } = await assertPasskey(init.options);

  const finished = await postJson<{
    token: string;
    userId: string;
    email: string;
    material: WireMaterial;
  }>('/api/auth/passkey/login-finish', {
    email,
    token: init.token,
    assertionResponse: response,
  });

  const wrappingKey = await prfOutputToKey(prfOutput);
  const masterKeyRaw = await decryptBytes(wrappingKey, wireToSealed(finished.material.wrappedByPasskey));
  const masterKey = await importRawKey(masterKeyRaw);

  setUnlocked(finished.userId, masterKey);
  const user = { userId: finished.userId, email: finished.email };
  persistSession(finished.token, user);
  return user;
}

/**
 * Same as login(): re-asserts the passkey and unwraps the master key. Used
 * after a page reload when the JWT is in localStorage but the vault is
 * locked.
 */
export async function unlock(): Promise<SessionUser | null> {
  const user = getCurrentUser();
  if (!user) return null;
  return login(user.email);
}

/**
 * Recovery flow: prove ownership with the recovery code, unwrap the master
 * key, enroll a NEW passkey on this device, push fresh wraps to the server.
 * Old passkey on the lost device stops working at the moment of /recover-finish.
 */
export async function recoverWithCode(
  email: string,
  recoveryCode: string
): Promise<SessionUser> {
  if (!isPasskeySupported()) {
    throw new Error('This browser does not support passkeys');
  }

  // 1. Server verifies the code and returns wrappedByRecovery + a new
  //    registration challenge.
  const init = await postJson<{
    wrappedByRecovery: WireSealed;
    options: PublicKeyCredentialCreationOptionsJSON;
    token: string;
  }>('/api/auth/recover-init', { email, recoveryCode });

  // 2. Unwrap the master key with the recovery code.
  const recoveryRaw = parseRecoveryCode(recoveryCode);
  const recoveryKey = await recoveryCodeToKey(recoveryRaw);
  const masterKeyRaw = await decryptBytes(recoveryKey, wireToSealed(init.wrappedByRecovery));
  const masterKey = await importRawKey(masterKeyRaw);

  // 3. Enroll a new passkey on this device.
  const { response, prfOutput } = await enrollPasskey(init.options);
  const wrappingKey = await prfOutputToKey(prfOutput);
  const wrappedByPasskey = await encryptBytes(wrappingKey, masterKeyRaw);

  // 4. Recovery code stays the same on the server (we re-send it so the
  //    server can re-hash with the same value). The wrappedByRecovery doesn't
  //    actually need to change — it's the same master key — but we re-encrypt
  //    so the server replaces the row atomically.
  const wrappedByRecovery = await encryptBytes(recoveryKey, masterKeyRaw);

  const finished = await postJson<{ token: string; userId: string; email: string }>(
    '/api/auth/recover-finish',
    {
      email,
      recoveryCode,
      token: init.token,
      attestationResponse: response,
      wrappedByPasskey: sealedToWire(wrappedByPasskey),
      wrappedByRecovery: sealedToWire(wrappedByRecovery),
    }
  );

  setUnlocked(finished.userId, masterKey);
  const user = { userId: finished.userId, email: finished.email };
  persistSession(finished.token, user);
  return user;
}

/**
 * Generate a new recovery code while logged in, re-wrapping the master key
 * with it. Returns the new code (show once) and updates the server.
 *
 * Implemented as a recover-init + recover-finish round trip with the *current*
 * recovery code so the server keeps the same hash semantics. Rather than add
 * a separate endpoint, we just call recoverWithCode with the existing code
 * and the new device — which assumes the user knows the current code. For
 * v1 this is the limitation; a dedicated /auth/material endpoint can replace
 * it later.
 */
export async function logout(): Promise<void> {
  const token = getAuthToken();
  if (token) {
    try {
      await postJson('/api/auth/logout', {}, token);
    } catch {
      // ignore — clearing local state regardless
    }
  }
  clearSession();
  lockVault();
}

export function lock(): void {
  lockVault();
}

// Used by the tests (and a future "is the JWT still valid?" check).
export async function fetchMe(): Promise<{ userId: string; email: string } | null> {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const me = await getJson<{ userId: string; email: string }>('/api/auth/me', token);
    return me;
  } catch {
    return null;
  }
}
