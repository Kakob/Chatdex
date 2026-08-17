# Territory: Unlock the vault

Account creation, passkey login, key wrapping/unwrapping, recovery codes, and sessions — the machinery that turns "a person with this browser" into "a user whose ciphertext the server will hand back and whose master key is in memory."

## The question

What actually happens, cryptographically and over the network, between "user clicks Sign up / Unlock in Settings" and "the sync engine can encrypt and decrypt records" — and what does the server ever get to see?

## User-visible behavior

All of this lives in one place: **Settings → Cloud Sync** (`CloudSyncSection.tsx`). There is no login wall anywhere else in the app.

```
User opens Settings
    ↓
enters email, clicks "Create account"
    ↓
browser passkey ceremony (Touch ID / security key)
    ↓
one-time recovery code shown ("save this now")
    ↓
status: unlocked → sync engine starts
```

Returning user:

```
User opens Settings (status shows "locked")
    ↓
clicks "Unlock with passkey"
    ↓
passkey ceremony
    ↓
status: unlocked → sync engine starts
```

Lost authenticator: enter email + recovery code → enroll a **new** passkey → old passkey is orphaned.

**Counter-intuitive but true:** the rest of the app (import, search, detection, understanding, chat) works fully while locked. The vault only gates *sync*. [CODE — see "How keys gate the app" below]

## Entry point

- `src/components/settings/CloudSyncSection.tsx` — `handleSignup` (:68), unlock/login handlers, recovery form. This is the **only** UI that touches auth. It renders only inside `SettingsPage.tsx:159`.
- The orchestration layer is `src/lib/auth/session.ts` — `signup()` (:128), `login()` (:177), `unlock()` (:215, which just calls `login()` with the stored email), `recoverWithCode()` (:226).

Why we believe this: `authStore.hydrate()` is called from exactly one place — `CloudSyncSection.tsx:38` — so auth state isn't even populated until the user visits Settings. [CODE]

## Control-flow path

### Signup (`session.ts:128`)

```
signup(email)
    ↓
POST /api/auth/passkey/register-init          ← server mints challenge + PRF salt,
    ↓                                            signs them into a stateless HMAC token
                                                 (challengeToken.ts:48, 5-min TTL; NO user row yet)
enrollPasskey(options)                         webauthn.ts:76
    ↓  navigator.credentials.create + PRF extension
readPrfFirst() → PRF output (32B)              webauthn.ts:68  — throws PrfNotSupportedError if absent
    ↓
generateMasterKey()  AES-256-GCM               primitives.ts:13
wrappingKey = importRawKey(SHA-256(prfOutput)) webauthn.ts:105
wrappedByPasskey  = encrypt(wrappingKey, masterKeyRaw)
recoveryCode      = 25 random bytes → Crockford base32 "XXXXX-…"   recovery.ts:15
wrappedByRecovery = encrypt(SHA-256(parsedCode), masterKeyRaw)
    ↓
POST /api/auth/passkey/register-finish        ← attestation + BOTH wraps + recovery code (see boundary
    ↓                                            section — the code travels in cleartext)
server verifies attestation, INSERTs users row, signs JWT (auth.ts:128-174)
    ↓
setUnlocked(userId, masterKey)                 keyManager.ts:26  (in-memory only)
persistSession(jwt, {userId,email})            session.ts:80 → localStorage
```

### Login / unlock (`session.ts:177`)

```
login(email)
    ↓
POST /api/auth/passkey/login-init             ← challenge + stored prf_salt in options
    ↓
assertPasskey() → PRF output                   webauthn.ts:90
    ↓
POST /api/auth/passkey/login-finish           ← assertion only
server verifies signature against stored COSE public key (auth.ts:238),
returns JWT + material{prfSalt, wrappedByPasskey, wrappedByRecovery}
    ↓
masterKeyRaw = decrypt(SHA-256(prfOutput), material.wrappedByPasskey)   session.ts:201
    ↓  (AES-GCM tag failure here throws a raw OperationError — no friendly message)
setUnlocked + persistSession
```

Note: `login()` uses only `wrappedByPasskey`; the other two `material` fields the server sends are silently ignored. [CODE session.ts:201] Why the server sends them is fog.

**There is no offline unlock.** The wrapped master key is stored *only* on the server, so every unlock requires the network round-trip. [CODE — no local copy of the wrap exists anywhere]

### Recovery (`session.ts:226`)

```
recoverWithCode(email, code)
    ↓
POST /api/auth/recover-init  {email, code}    ← code in cleartext; server verifies hash
    ↓                                            (passwordHash.ts:18, timingSafeEqual)
server returns wrappedByRecovery + REGISTRATION options (new PRF salt)
    ↓
client decrypts master key with SHA-256(parseRecoveryCode(code))    session.ts:245
    ↓
enrollPasskey() → NEW credential + NEW PRF output
re-wrap master key both ways (fresh IVs)
    ↓
POST /api/auth/recover-finish                 ← code in cleartext again + both new wraps
server overwrites passkey_* columns and BOTH wraps; recovery hash untouched (auth.ts:384-398)
```

The old passkey is orphaned the moment recover-finish commits — the credential row is overwritten. [CODE]

⚠️ **Likely real bug** [CODE, cross-checked client vs server]: the client normalizes recovery codes (lowercase, missing dashes, `O→0`, `recovery.ts:45-50`) before deriving the wrapping key, but the **server hashes the literal typed string** (`auth.ts:297`) against a hash of the originally-displayed uppercase-dashed code. UI only `.trim()`s (`CloudSyncSection.tsx:99`). So a user who types their code in lowercase gets a server-side 401 even though the crypto would have worked. No test spans both sides, so nothing catches it.

### Session lifecycle

- JWT = HS256 over `{sub, email}`, signed at `auth.ts:174/:262/:400`. **No `expiresIn` — issued tokens never expire.** [CODE middleware/auth.ts:29 registers fastify-jwt with secret only]
- Stored in `localStorage['chatdex.authToken']`; sent as `Authorization: Bearer` (`session.ts:93`, `syncApi.ts:48`).
- No refresh, no revocation. `POST /api/auth/logout` is `async () => ({success:true})` — a literal no-op (`auth.ts:273`). There is **no server-side session state at all**.
- On reload, `authStore.hydrate` (`authStore.ts:38`) sets `'locked'` if a token exists but never validates it. `fetchMe()` (`session.ts:306`) would validate — it is dead code, called nowhere. [CODE]

## Data flow (key material map)

```
authenticator PRF output (32B, per-ceremony, never persisted)
        │ SHA-256                       recovery code (25B → "XXXXX-…", shown once)
        ▼                                       │ SHA-256(parsed bytes)
  PRF wrapping key (memory only)          recovery wrapping key (memory only)
        │ AES-GCM wrap                          │ AES-GCM wrap
        ▼                                       ▼
  wrapped_by_passkey_{iv,ct}  ────────  wrapped_by_recovery_{iv,ct}
        └──────────── both stored ONLY on server (users table) ───────────┘
                                │ unwrap on login/recovery
                                ▼
                master key (AES-256-GCM, keyManager.ts:8,
                module-level variable, dies with the tab)
                                │
                                ▼
                encrypts every sync record directly
                (engine.ts:494/:539 — no per-record data keys)
```

Server `users` table (`backend/src/db/schema.ts:34-71`): email, COSE public key, credential id, counter, PRF salt, both wraps, `recovery_code_hash` = SHA-256(salt‖formatted code). One credential per user — singular columns. [CODE]

## State ownership

```
memory (keyManager.ts module var)   master key — the only holder; lock() drops it
localStorage                        JWT + {userId, email}
authStore (Zustand)                 UI status only: logged-out | locked | unlocked
server users table                  identity + wrapped keys + recovery hash
server sync_records                 opaque ciphertext blobs (separate territory)
```

Drift is possible: nothing recomputes `authStore` status from `keyManager.isUnlocked()`, and `keyManager` is per-tab with no `storage` event listener — two tabs can disagree about locked state. [CODE]

## Side effects and boundaries

What crosses the network, per flow:

| Flow | Leaves the client | Never leaves the client |
|---|---|---|
| register | email, attestation, both wraps, **recovery code in cleartext** | master key, PRF output, wrapping keys |
| login | email, assertion | PRF output, unwrapped master key |
| recover | email, **recovery code in cleartext (twice)** | master key |

⚠️ **The recovery-path asymmetry** [CODE session.ts:163/:240/:262 vs DOC auth-architecture.md:50]: the PRF output genuinely never crosses the network — but the recovery code does, in cleartext, in the same requests that carry (register) or return (recover) `wrappedByRecovery`. A party with server-side visibility at that moment can derive the recovery wrapping key and decrypt the master key. `docs/auth-architecture.md:50` claims "the server never sees either wrapping key or the master key itself" — **true for the passkey wrap, false for the recovery wrap.** No comment anywhere acknowledges this; whether it's an accepted trade-off or an oversight is fog.

Other boundaries: WebAuthn browser API (`navigator.credentials`), localStorage, the Fastify backend (CORS locked to one origin, Bearer-only, no cookies).

## Decisions embodied by the code

**Decision:** Passkey-PRF-derived wrapping key instead of a password KDF.
**Evidence:** [DOC auth-architecture.md:16-22, CLAUDE.md "do not reintroduce a password KDF"]; git shows `kdf.ts` added then deleted; `passwordHash.ts` is a renamed survivor of that era, now used only for recovery-code hashing. [CODE git log]
**Consequence:** No password to phish or brute-force; but no PRF support ⇒ no cloud sync at all.
**Trade-off:** gains phishing-resistance and zero password UX; gives up browser compatibility (PRF support is uneven) and offline unlock.

**Decision:** Wrapped master key lives only on the server.
**Evidence:** [CODE — no local persistence of any wrap]
**Consequence:** unlock requires network; server outage = locked out of *sync* (local plaintext still fully usable).
**Possible alternative:** cache the wrap in IndexedDB for offline unlock.
**Trade-off:** gains simplicity and one source of truth; gives up offline unlock — arguably moot since only sync needs the key.

**Decision:** Stateless everything — HMAC challenge tokens (no challenges table), JWT sessions (no session table), no-op logout.
**Evidence:** [CODE challengeToken.ts:1-6, auth.ts:273]
**Consequence:** no server-side revocation of anything; a stolen JWT is valid forever (see failure modes).
**Trade-off:** gains zero session storage/cleanup; gives up expiry and revocation entirely.

**Decision:** Two independent wraps of one flat master key; every sync record encrypted directly with it.
**Evidence:** [CODE schema.ts:52-56, engine.ts:494]
**Consequence:** key rotation would require re-encrypting every record; recovery re-wrap is cheap.
**Possible alternative:** key hierarchy (master → data keys).
**Trade-off:** simplicity vs. rotation cost.

**Decision:** The vault gates only sync, not the app.
**Evidence:** [CODE App.tsx — no auth gate on any route; engine.ts:273/:299 are the only lock checks]
**Consequence:** anyone with device access reads all plaintext from IndexedDB; the passkey protects the *server copy* only. No doc states this threat model explicitly. [UNKNOWN whether intentional]

## Invariants and assumptions

- Master key never persisted anywhere, in any form, on the client. [CODE — keyManager.ts:8 is the only holder]
- Master key never leaves the client unwrapped. [CODE — upheld]
- Server never sees a wrapping key. **[VIOLATED in the recovery path — see boundaries]**
- PRF salt is stable per credential… except recovery rotates it (`auth.ts:304/:391`), so "one salt per user forever" does not hold. [CODE]
- `JWT_SECRET` ≥32 chars is hard-required at boot (`middleware/auth.ts:25-28`) and signs *both* JWTs and challenge tokens — rotating it invalidates everything at once. [CODE]

## Failure modes

- **PRF unsupported mid-signup:** the passkey is already created before PRF is read (`webauthn.ts:81-87`) → orphaned credential on the authenticator; retries stack more (`excludeCredentials` never populated). [CODE]
- **Recovery code case/format mismatch:** server 401 despite valid code (see control flow). [CODE]
- **Stolen JWT:** valid forever; only rotating `JWT_SECRET` (nuking all sessions + challenge tokens) revokes it. [CODE]
- **XSS on the origin:** total compromise — JWT in localStorage, `getMasterKey()`/`exportRawKey()` exported and the key is `extractable: true`. [CODE primitives.ts:13]
- **Cloned-authenticator counter regression:** counter is only ever written forward (`auth.ts:252`); a *lower* counter is never rejected. [CODE]
- **register-finish replay within 5-min token TTL:** unique email/credential constraint throws → unhandled 500 (no try/catch around the INSERT). [CODE auth.ts:158]
- **Lost passkey + lost code:** unrecoverable by design; UI warns. [CODE CloudSyncSection.tsx:174]
- **Email enumeration:** distinct 409/404 responses per route, no rate limiting anywhere in the backend. [CODE]
- **Right passkey, wrong PRF output:** JWT would be minted but the unwrap throws *before* `persistSession`, so the token is discarded — good ordering. [CODE session.ts:201-206]

## Tests and verification

`src/lib/crypto/index.test.ts` is the **only** crypto/auth test file. It establishes [TEST]:
- AES-GCM round-trips; fresh 12-byte IV per encryption; tamper/wrong-key rejection
- recovery code format, normalization (`0↔O` etc.), wrap/unwrap round-trip
- keyManager lock/unlock semantics

**Untested:** all of `webauthn.ts`, all of `session.ts`, `authStore`, and the **entire backend auth surface** (challenge tokens, recovery hashing, all 7 routes, JWT middleware). The sync tests *mock* `isUnlocked: () => true` rather than exercising the gate (`engine.test.ts:9-10`). The recovery normalization bug lives exactly in the untested client↔server seam.

## Doc vs code disagreements

- `auth-architecture.md:50/:63` — "server never sees key material": false for the recovery path. [CODE vs DOC]
- `auth-architecture.md:111` — claims recover-finish leaves `wrapped_by_recovery_*` unchanged; it **does** overwrite them (`auth.ts:394-395`). [CODE vs DOC]
- `auth-architecture.md:22` says Firefox can't sync; `CloudSyncSection.tsx:157` says "Firefox 122+" works. Neither is backed by a capability probe — `isPasskeySupported()` only checks `window.PublicKeyCredential`, so Firefox passes the gate and fails later at PRF read. [CODE vs DOC vs CODE]
- `auth.ts:342-344` comment claims recover-finish regenerates the recovery hash; it doesn't. [CODE vs comment]
- `session.ts:277-287` — a 10-line docstring describing a "rotate recovery code" feature is attached to `logout()`; that feature exists nowhere. [CODE — orphaned doc]
- `CLAUDE.md` says never touch `src/crypto/`; actual path is `src/lib/crypto/`.

## Visual map

```
                 CLIENT                          │            SERVER
                                                 │
  authenticator ──PRF──► SHA-256 ──► wrap key    │   users: COSE pubkey, prf_salt,
                                        │        │          wrapped_by_passkey{iv,ct},
  master key (memory only) ◄──unwrap────┘        │          wrapped_by_recovery{iv,ct},
        │                                        │          recovery_code_hash
        ├─ encrypts sync records                 │
        │                                        │   JWT (HS256, NO EXPIRY) ──► gates
  recovery code ──SHA-256──► wrap key            │   /api/sync/*, /api/llm/*
        (crosses the wire in cleartext           │
         during register & recover ⚠)            │   stateless HMAC challenge tokens (5 min)
```

## Suggested walk

1. Start at `CloudSyncSection.tsx:68` (`handleSignup`) and note what state transitions it drives.
2. Before opening `session.ts:signup`, predict: what must the client generate, and what must the server end up storing?
3. Read `signup()` top to bottom, following into `webauthn.ts:enrollPasskey` and `primitives.ts`.
4. Open `backend/src/routes/auth.ts:84` (`register-init`) and `:128` (`register-finish`); check your prediction against the INSERT at `:158`.
5. Read `challengeToken.ts` in full (71 lines) — ask why there's no challenges table.
6. Read `login()` and find the field of `material` that gets used — and the two that don't.
7. Read `recoverWithCode()` and trace the recovery code's journey; count how many times it crosses the network.
8. Finish with `keyManager.ts` (34 lines) and `engine.ts:273/:299` to see the *entire* extent of what the lock actually gates.

## Ownership challenge

Fix the recovery-code normalization mismatch: make the server hash a canonical form (or have the client send the canonical form), and add the first cross-boundary test proving a lowercase, dash-less code recovers an account. Small diff, touches both sides of the seam, and removes a real user-facing failure.

(Alternative, larger: give JWTs an `expiresIn` and make the client re-login on 401.)

## Fog

- ? Is the recovery-code cleartext exposure known and accepted, or an oversight? The doc claims the opposite; no comment acknowledges it.
- ? Has recovery ever been exercised end-to-end against a real server, given the normalization mismatch?
- ? Is the unbounded JWT lifetime deliberate?
- ? Why does `login-finish` return three `material` fields when the client uses one? Is `material.prfSalt` meant to be authoritative after a recovery rotates salts?
- ? What was the rotate-recovery-code feature described by `logout()`'s orphaned docstring — deleted code or never-landed plan?
- ? What should happen to passkeys orphaned by PRF failure or recovery? (No cleanup, no `excludeCredentials`.)
- ? Is "device access = full plaintext access, passkey protects only the server copy" the intended threat model? Nothing states it.
- ? Multi-tab semantics: `keyManager` is per-tab and `authStore` doesn't sync across tabs — intended?
- ? Is there any intended path to rotate a recovery code? Currently it's permanent.
