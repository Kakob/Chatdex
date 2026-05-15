// Browser-side WebAuthn helpers. Wraps @simplewebauthn/browser to handle
// the PRF extension and to expose a single function per ceremony that
// returns both the response (for server verification) and the 32-byte PRF
// output (for client-side key wrapping).
//
// PRF caveat: as of @simplewebauthn/browser v13 the wrapper only converts the
// top-level binary fields (challenge, user.id, excludeCredentials) from
// base64url into ArrayBuffer. It spreads `extensions` through unchanged. So
// we have to decode `extensions.prf.eval.first` ourselves before calling
// startRegistration / startAuthentication, otherwise the browser rejects the
// options with "The provided value is not of type 'ArrayBuffer or
// ArrayBufferView'".

import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { importRawKey } from '../crypto';

function base64UrlToUint8Array(b64url: string): Uint8Array {
  // RFC 4648 §5: replace URL-safe chars and re-pad before atob.
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Decode any base64url-encoded PRF eval values in-place to Uint8Array. The
 * library passes extensions through verbatim, so this has to happen before
 * the call to navigator.credentials.create / .get.
 */
function decodePrfInPlace<T>(opts: T): T {
  const evalObj = (opts as { extensions?: { prf?: { eval?: { first?: unknown; second?: unknown } } } })
    .extensions?.prf?.eval;
  if (!evalObj) return opts;
  if (typeof evalObj.first === 'string') {
    evalObj.first = base64UrlToUint8Array(evalObj.first);
  }
  if (typeof evalObj.second === 'string') {
    evalObj.second = base64UrlToUint8Array(evalObj.second);
  }
  return opts;
}

export interface RegisterResult {
  response: RegistrationResponseJSON;
  prfOutput: Uint8Array;
}

export interface AssertResult {
  response: AuthenticationResponseJSON;
  prfOutput: Uint8Array;
}

export class PrfNotSupportedError extends Error {
  constructor(message = "This browser/authenticator didn't return a PRF output") {
    super(message);
    this.name = 'PrfNotSupportedError';
  }
}

function readPrfFirst(extResults: unknown): Uint8Array | null {
  if (!extResults || typeof extResults !== 'object') return null;
  const prf = (extResults as { prf?: { results?: { first?: ArrayBuffer | Uint8Array } } }).prf;
  const first = prf?.results?.first;
  if (!first) return null;
  return first instanceof Uint8Array ? first : new Uint8Array(first);
}

export async function enrollPasskey(
  options: PublicKeyCredentialCreationOptionsJSON
): Promise<RegisterResult> {
  const response = await startRegistration({ optionsJSON: decodePrfInPlace(options) });
  const ext = response.clientExtensionResults as unknown;
  const prfOutput = readPrfFirst(ext);
  if (!prfOutput) {
    throw new PrfNotSupportedError(
      'Passkey created, but your browser/authenticator did not return a PRF result. Try Chrome, Safari 17.4+, or a security key.'
    );
  }
  return { response, prfOutput };
}

export async function assertPasskey(
  options: PublicKeyCredentialRequestOptionsJSON
): Promise<AssertResult> {
  const response = await startAuthentication({ optionsJSON: decodePrfInPlace(options) });
  const ext = response.clientExtensionResults as unknown;
  const prfOutput = readPrfFirst(ext);
  if (!prfOutput) throw new PrfNotSupportedError();
  return { response, prfOutput };
}

/**
 * Hash a 32-byte PRF output through SHA-256 to produce a stable AES-256-GCM
 * key. The hash is defensive — if a future spec change ever varies the PRF
 * output length, this still yields a 32-byte key.
 */
export async function prfOutputToKey(prfOutput: Uint8Array): Promise<CryptoKey> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', prfOutput as BufferSource)
  );
  return importRawKey(digest);
}

/**
 * Quick browser capability sniff — used to gate the enrollment UI behind a
 * "your browser supports this" check.
 */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}
