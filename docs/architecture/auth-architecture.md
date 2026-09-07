# Chatdex Auth & Client-Side Encryption

Companion to [`architecture.md`](./architecture.md) §1–2, which describes the current WebAuthn+PRF flow and the crypto layer as they run today. This document covers the **design rationale** behind that architecture, the **security trade-offs** taken against the alternative it replaced, the **recovery story**, and the **planned enhancements** that are not yet built.

If you want to know *how the code works*, read `architecture.md` first. If you want to know *why we built it this way and what would have to change to make it stronger*, read this.

---

## Timeline: Argon2id → WebAuthn+PRF pivot

Chatdex's auth layer was rewritten from a passphrase-based flow to a passkey-based flow within a single day, before either shape ever shipped to real users. Both commits are on `main`:

- **`0fd627d` — "returning to local first"** (2026-05-14 morning). Added `src/lib/crypto/kdf.ts` using `hash-wasm`'s `argon2id`. Two keys derived from one passphrase: an `auth_key` sent to the server (server stored `argon2id(auth_key)`) and a master key for AES-GCM. Passphrase-only recovery.
- **`1c660b6` — "auth: replace KDF/password flow with WebAuthn"** (2026-05-14 evening). Deleted `kdf.ts` (83 lines). Added `src/lib/auth/webauthn.ts` (122 lines) using WebAuthn with the **PRF extension** and a 200-bit random recovery code as a break-glass fallback.

The pivot happened because the Argon2id path had three problems that WebAuthn+PRF resolves cleanly:

1. **Phishing.** A memorized passphrase can be entered into a lookalike page. A WebAuthn credential cannot — the browser refuses to release an assertion for a domain that doesn't match the credential's registered origin.
2. **UX under Argon2id.** Argon2id in a browser needs enough work factor to matter (~500–1000 ms of WASM per unlock). A passkey ceremony is sub-100 ms.
3. **Server-compromise blast radius.** Even with proper design, an attacker who logged the server's ciphertext could try offline attacks against weak passphrases. With WebAuthn+PRF there is no memorized secret to guess.

The trade-off accepted: WebAuthn PRF is only supported in Chrome, Edge, and Safari 17.4+. Firefox and older Safari cannot enable cloud sync until that changes.

---

## Architecture at a glance

The current flow (see `architecture.md` §1–2 for the code-level walkthrough):

```
  Primary path                                Recovery path
  ────────────                                ─────────────
  Passkey (authenticator)                     Recovery code (200 bits, one-time display)
        │                                          │
        │ PRF eval(prfSalt) → 32 B                 │ Crockford base32 decode → 25 B
        ▼                                          ▼
      SHA-256                                    SHA-256
        │                                          │
        ▼                                          ▼
   wrappingKey_A (AES-256)                    wrappingKey_R (AES-256)
        │                                          │
        │  unwrap(wrappedByPasskey)                │ unwrap(wrappedByRecovery)
        └──────────────► masterKey ◄───────────────┘
                              │
                              ▼
                 encrypt/decrypt session records
                    (AES-GCM, per-record IV)
```

Two independently-derived wrapping keys, one master key, two sealed copies on the server. Compromise of either wrapping key exposes the same master key, but the server never sees either wrapping key or the master key itself.

---

## Design decisions worth calling out

### 1. PRF output is client-only

`src/lib/auth/webauthn.ts:105` (`prfOutputToKey`) hashes the raw PRF bytes through SHA-256 and imports the digest as an AES-256 key. This all happens in the browser. The PRF output *never* touches the network. The only server-visible artifacts are:

- The per-user PRF salt (`users.prf_salt`, see `backend/src/db/schema.ts:49`) — the input to the PRF, not the output. Useless without the authenticator.
- The wrapped master-key ciphertext (`users.wrapped_by_passkey_iv/ct`, `schema.ts:53–54`).

A server compromise reveals ciphertext and salt, not key material. This is the invariant the whole design defends.

### 2. The `@simplewebauthn/browser` PRF workaround

`@simplewebauthn/browser` v13 converts the top-level binary fields on `PublicKeyCredentialCreationOptions` (challenge, `user.id`, `excludeCredentials`) from base64url to ArrayBuffer, but it passes `extensions` through unchanged. The PRF salt lives at `extensions.prf.eval.first` and arrives from the server as a base64url string, so it has to be decoded manually before the WebAuthn call. The `decodePrfInPlace` helper at `src/lib/auth/webauthn.ts:38–49` does exactly that. Without it, the browser rejects the options with `"The provided value is not of type 'ArrayBuffer or ArrayBufferView'"`.

This is documented inline at `webauthn.ts:7–12` because it's the kind of library-boundary bug that will bite anyone else building on this API.

### 3. Why no Argon2id on the recovery code

The recovery code is 200 bits of entropy generated by `crypto.getRandomValues` (`src/lib/crypto/recovery.ts:15`). At that entropy level a KDF adds effectively zero bits of security — even a well-resourced attacker cannot brute-force a random 200-bit secret regardless of hash speed. Argon2id exists to protect *low-entropy, memorized* secrets by making each guess expensive. A random 200-bit code doesn't need that.

The server does salt-and-hash the code (`schema.ts:61–62`) before storing it, as a defense-in-depth measure — that hash exists only to gate the recovery ceremony, not to protect the code's confidentiality.

### 4. Master key never persisted

`src/lib/crypto/keyManager.ts` holds the unwrapped master key in a single module-level `let _masterKey: CryptoKey | null`. There is no `localStorage`, no `sessionStorage`, no IndexedDB path that writes it. `lock()` drops the reference; closing the tab does the same automatically. Every reload requires an authenticator ceremony to unwrap the key again.

This is the reason the `crypto/` folder is gated by the "do not modify without explicit instruction" invariant in `CLAUDE.md` — the key-lifetime rules are load-bearing for the whole ciphertext-only-leaves-the-client claim.

---

## Security trade-offs vs. Argon2id + passphrase

Both approaches keep the master key on the client. What differs is the wrapping-key derivation and, downstream, what an attacker with server access can do.

| Axis | Argon2id + passphrase | WebAuthn + PRF (chosen) |
|---|---|---|
| Phishing resistance | Weak — user can enter passphrase into lookalike | **Strong** — credential is origin-bound |
| Offline attack on server ciphertext | Depends on passphrase entropy | Not applicable — no memorized secret |
| Unlock latency | 500–1000 ms (WASM Argon2id + typing) | Sub-100 ms (Touch ID / Windows Hello) |
| Key custody | Client-only | Client-only, hardware-bound |
| Device loss | Passphrase works anywhere | Needs syncable passkey OR recovery code |
| Cross-device onboarding | Type passphrase | Requires syncable passkey or cross-device flow |
| Browser support | Universal | Chrome / Edge / Safari 17.4+ only |
| Server-compromise blast radius | Weak passphrases become brute-forceable offline | Server ciphertext alone is inert |
| Portability of a recovery flow | Passphrase reset (careful, common attack point) | Recovery code + re-enroll (`/recover-*`) |

The one dimension where Argon2id has a real advantage is universal browser support. That's what we traded for the other six wins.

---

## Recovery paths today

Two paths exist. See `backend/src/routes/auth.ts` for the exact route handlers.

**Path A: normal login.** User has the passkey (either on the enrolling device or synced via a password manager). `assertPasskey` in `src/lib/auth/webauthn.ts:90` runs the ceremony, PRF output derives the wrapping key, server hands back the wrapped master key, client unwraps.

**Path B: recovery code.** User lost the device *and* the passkey did not sync. `/recover-init` verifies the recovery-code hash against `users.recovery_code_hash`. On match, the server issues a WebAuthn *registration* challenge (not an authentication one). `/recover-finish` verifies the new attestation, replaces `passkey_credential_id` and friends with the new credential, and stores a fresh `wrapped_by_passkey_*` under the new PRF output. The `wrapped_by_recovery_*` and `recovery_code_hash` rows stay unchanged, so the recovery code remains valid after re-enrollment.

Failure mode Path B does *not* cover: user loses both the passkey and the recovery code. There is no server-side fallback because the server cannot decrypt the master key. The account exists but the data is unrecoverable. This is the price of the "no plaintext leaves the client" invariant, and users are warned about it explicitly on the recovery-code screen (`src/components/settings/CloudSyncSection.tsx:157–195`).

---

## Recommended user backup strategy (today)

The lowest-friction backup that works with the current architecture, no schema change required:

> **Save the passkey in a syncing password manager** — 1Password, iCloud Keychain, Bitwarden, or Google Password Manager. On enrollment, the browser asks where to store the passkey; picking one of these keeps the same credential available on the user's other devices without any Chatdex-side changes. This effectively provides a "backup authenticator" via the credential-sync infrastructure the industry already runs.

A post-signup panel in `src/components/settings/CloudSyncSection.tsx` (adjacent to the recovery-code display) surfaces this guidance so users see it at the exact moment they're setting up sync.

If the user does *not* use a syncing manager, the recovery code becomes their sole backup path and must be stored somewhere durable (paper, printed and locked away; another password manager; a safe).

---

## Planned: multiple authenticators per account

The current schema stores one credential per user (`backend/src/db/schema.ts:33–71` uses singular `passkey_*` columns and `wrapped_by_passkey_*` blobs). "Register a backup passkey" as a Chatdex feature — as distinct from a syncing password manager, which is the workaround above — needs a real schema migration. Sketched here, not yet built.

### Schema change

Move all per-credential fields off `users` into a new `credentials` table:

```
credentials {
  id                          text  PK
  user_id                     text  FK → users.id  ON DELETE CASCADE
  credential_id               text  UNIQUE
  public_key                  bytea
  counter                     integer
  transports                  jsonb
  nickname                    text                       # user-editable label
  is_primary                  boolean
  wrapped_by_credential_iv    bytea                      # master key wrap under
  wrapped_by_credential_ct    bytea                      # this credential's PRF key
  created_at                  timestamptz
  last_used_at                timestamptz
}
```

Drop `passkey_credential_id`, `passkey_public_key`, `passkey_counter`, `passkey_transports`, `wrapped_by_passkey_iv`, and `wrapped_by_passkey_ct` from `users`. Keep `prf_salt` on `users` — the same PRF salt with different authenticators yields different PRF outputs, so one salt-per-user is fine.

### Backend routes

Both behind `app.authenticate` (`backend/src/middleware/auth.ts:24–42`) — enrolling a backup requires an already-authenticated session:

- `POST /passkey/add-init` — returns a registration challenge and a signed challenge token. The `excludeCredentials` list must include *all* of the user's existing credentials so the platform authenticator doesn't offer to overwrite one of them.
- `POST /passkey/add-finish` — accepts the new attestation and a `wrappedByNewCredential: { iv, ciphertext }` payload wrapping the *same* master key under the new PRF-derived key. Inserts a new row in `credentials`.

### Client flow

Analogous to signup's wrap step at `src/lib/auth/session.ts:143–151`, but starts from an already-unlocked master key rather than a freshly-generated one:

```
1. session must be unlocked (keyManager.isUnlocked() === true)
2. POST /passkey/add-init → { options, token }
3. enrollPasskey(options) → { response, prfOutput }         // uses same prfSalt
4. wrappingKey = prfOutputToKey(prfOutput)                   // per new credential
5. exportRawKey(masterKey) → masterKeyRaw
6. wrappedByNew = encryptBytes(wrappingKey, masterKeyRaw)
7. POST /passkey/add-finish { token, response, wrappedByNew }
```

Requiring "session must be unlocked" is a security constraint, not a limitation: the client needs the raw master key to produce the new wrap, and the server intentionally cannot help.

### Login refactor

`POST /passkey/login-init` currently reads the one stored credential and constructs `allowCredentials` from it. With N credentials it must return all of them so any registered authenticator can respond. `POST /passkey/login-finish` looks up the credential by `credential.id` in the assertion, unwraps under that credential's `wrapped_by_credential_ct`, and updates its `counter` + `last_used_at`.

### UI

A "Backup passkeys" section in `CloudSyncSection.tsx` visible when the user is unlocked (`status === 'unlocked'`): a list of registered credentials with nicknames and last-used timestamps, an "Add backup passkey" button, and a per-credential "Remove" action guarded by "you must keep at least one credential."

### Why not yet

Portfolio-time-versus-value: the syncable-passkey workaround gets ~90% of the resilience benefit with zero schema change and zero migration risk. The feature above is documented so it can be built when there's a real user need (or a real story to tell about it), not on speculation.

---

## Related documents

- [`architecture.md`](./architecture.md) — §1 (WebAuthn+PRF ceremony code), §2 (crypto primitives + key lifecycle), §3 (sync engine that consumes the master key)
- Root [`CLAUDE.md`](../CLAUDE.md) — the invariants that keep the "no plaintext leaves the client" claim honest
