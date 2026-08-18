// Content hashing for primary-source integrity
// (SPEC-decision-investigation §7.1). Not a crypto boundary — key material
// and encryption live in src/lib/crypto/ and must not be touched from here.

/** SHA-256 of a UTF-8 encoding of `text`, as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
