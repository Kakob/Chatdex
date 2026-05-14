// AES-256-GCM primitives. Per-record random 96-bit IV; auth tag is appended
// to the ciphertext by SubtleCrypto. Wire format for callers is { iv, ciphertext }
// — both raw byte arrays.

const ALGO = { name: 'AES-GCM', length: 256 } as const;
const IV_BYTES = 12;

export interface Sealed {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export async function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(ALGO, true, ['encrypt', 'decrypt']);
}

export async function importRawKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) {
    throw new Error(`AES-256 key must be 32 bytes, got ${raw.length}`);
  }
  return crypto.subtle.importKey('raw', raw as BufferSource, ALGO, true, ['encrypt', 'decrypt']);
}

export async function exportRawKey(key: CryptoKey): Promise<Uint8Array> {
  const buf = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(buf);
}

export function randomIv(): Uint8Array {
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  return iv;
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export async function encryptBytes(key: CryptoKey, plaintext: Uint8Array): Promise<Sealed> {
  const iv = randomIv();
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource
  );
  return { iv, ciphertext: new Uint8Array(buf) };
}

export async function decryptBytes(key: CryptoKey, sealed: Sealed): Promise<Uint8Array> {
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.iv as BufferSource },
    key,
    sealed.ciphertext as BufferSource
  );
  return new Uint8Array(buf);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function encryptString(key: CryptoKey, plaintext: string): Promise<Sealed> {
  return encryptBytes(key, enc.encode(plaintext));
}

export async function decryptString(key: CryptoKey, sealed: Sealed): Promise<string> {
  return dec.decode(await decryptBytes(key, sealed));
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<Sealed> {
  return encryptString(key, JSON.stringify(value));
}

export async function decryptJSON<T = unknown>(key: CryptoKey, sealed: Sealed): Promise<T> {
  return JSON.parse(await decryptString(key, sealed)) as T;
}
