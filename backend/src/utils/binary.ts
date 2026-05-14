// Helpers for moving binary fields between JSON (base64) and Buffer.

export function b64ToBuf(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}

export function bufToB64(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64');
}

export interface SealedB64 {
  iv: string;
  ciphertext: string;
}

export interface SealedBuf {
  iv: Buffer;
  ciphertext: Buffer;
}

export function sealedFromB64(s: SealedB64): SealedBuf {
  return { iv: b64ToBuf(s.iv), ciphertext: b64ToBuf(s.ciphertext) };
}

export function sealedToB64(s: SealedBuf): SealedB64 {
  return { iv: bufToB64(s.iv), ciphertext: bufToB64(s.ciphertext) };
}
