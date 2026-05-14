// Recovery code: a 200-bit random secret shown to the user once at signup.
// Formatted as 8 groups of 5 base32 chars (Crockford alphabet, no I/L/O/U)
// for easier transcription. The user stores it (1Password, paper, etc.).
// 200 bits is far above the brute-force threshold and fits cleanly in 40
// displayed chars; we hash it through SHA-256 before using it as an AES key
// so the wrapping key is always 256 bits regardless.

import { randomBytes, importRawKey, encryptBytes, decryptBytes, type Sealed } from './primitives';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 chars, no I/L/O/U
const GROUP_SIZE = 5;
const NUM_GROUPS = 8;
const RAW_BYTES = 25; // 200 bits — encodes evenly into 40 base32 chars

export function generateRecoveryCode(): { code: string; raw: Uint8Array } {
  const raw = randomBytes(RAW_BYTES);
  return { code: formatRecoveryCode(raw), raw };
}

export function formatRecoveryCode(raw: Uint8Array): string {
  if (raw.length !== RAW_BYTES) {
    throw new Error(`Recovery code source must be ${RAW_BYTES} bytes, got ${raw.length}`);
  }
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of raw) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(value >>> bits) & 0x1f];
    }
  }
  // 25 bytes = 200 bits = exactly 40 base32 chars, no padding.
  const groups: string[] = [];
  for (let i = 0; i < out.length; i += GROUP_SIZE) {
    groups.push(out.slice(i, i + GROUP_SIZE));
  }
  return groups.join('-');
}

export function parseRecoveryCode(code: string): Uint8Array {
  // Normalize: uppercase, strip whitespace and dashes, map common confusions.
  const cleaned = code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/I/g, '1')
    .replace(/L/g, '1')
    .replace(/O/g, '0');
  if (cleaned.length !== GROUP_SIZE * NUM_GROUPS) {
    throw new Error(`Recovery code must be ${GROUP_SIZE * NUM_GROUPS} chars, got ${cleaned.length}`);
  }
  const out = new Uint8Array(RAW_BYTES);
  let bits = 0;
  let value = 0;
  let i = 0;
  for (const ch of cleaned) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid recovery-code character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[i++] = (value >>> bits) & 0xff;
    }
  }
  return out;
}

export async function recoveryCodeToKey(raw: Uint8Array): Promise<CryptoKey> {
  // Hash the parsed bytes through SHA-256 so we always end up with a 32-byte
  // key regardless of how many bits the displayed format actually carried.
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw as BufferSource));
  return importRawKey(digest);
}

export async function wrapMasterKey(
  wrappingKey: CryptoKey,
  masterKeyRaw: Uint8Array
): Promise<Sealed> {
  return encryptBytes(wrappingKey, masterKeyRaw);
}

export async function unwrapMasterKey(
  wrappingKey: CryptoKey,
  sealed: Sealed
): Promise<Uint8Array> {
  return decryptBytes(wrappingKey, sealed);
}
