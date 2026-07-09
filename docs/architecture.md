# Chatdex Architecture

Chatdex is a local-first power toolkit for Claude users — search, analytics, export, conversation browser, and prompt library — with an optional encrypted cloud sync layer. The browser is the source of truth: IndexedDB holds all user data, and the optional Fastify/Postgres backend stores only opaque ciphertext for cross-device sync. Authentication uses WebAuthn passkeys, and the PRF extension is what makes the encrypted-sync story work without passwords.

```
 ┌────────────────────────── Browser ──────────────────────────┐
 │  React 19 + Vite + TypeScript                               │
 │                                                             │
 │  Pages / UI ──► Zustand stores                              │
 │       │                                                     │
 │       ▼                                                     │
 │  api.ts ──► Dexie (IndexedDB, source of truth)              │
 │              │                                              │
 │              ├── Dexie hooks ──► sync dirty queue           │
 │              │                                              │
 │              ▼                                              │
 │       crypto (AES-GCM, master key in-memory only)           │
 │              │                                              │
 │              ▼                                              │
 │       sync engine ── encrypted blobs ──┐                    │
 └────────────────────────────────────────│────────────────────┘
                                          │ HTTPS + JWT
 ┌────────────────────────────────────────▼────────────────────┐
 │  Fastify 5 + Postgres 16 + Drizzle                          │
 │                                                             │
 │  /api/auth   WebAuthn ceremonies, JWT issuance              │
 │  /api/sync   Opaque ciphertext store, LWW reconciliation    │
 │                                                             │
 │  users (auth material + wrapped keys)                       │
 │  sync_records (iv + ciphertext, partitioned per user)       │
 └─────────────────────────────────────────────────────────────┘
```

The components below are ordered by load-bearing weight in the system.

---

## 1. WebAuthn + PRF Passkey Authentication

**Location**
- Client: `src/lib/auth/session.ts`, `src/lib/auth/webauthn.ts`
- Server: `backend/src/routes/auth.ts`, `backend/src/middleware/auth.ts`

**What it does** Passwordless authentication via platform passkeys, with a PRF (pseudorandom function) extension that doubles the passkey ceremony as a deterministic key-derivation step for end-to-end encryption.

**How it works** Two ceremonies — register and authenticate — each split across `*-init` and `*-finish` HTTP calls.

- *Register init.* Server generates a random 32-byte challenge and 32-byte PRF salt, mints a 5-minute HMAC-signed challenge token carrying `{intent, email, challenge, prfSalt, pendingUserId, exp}`, and returns WebAuthn registration options with the PRF extension requesting evaluation of `prfSalt`.
- *Register finish.* Browser invokes `navigator.credentials.create()` with the PRF extension; the authenticator returns an attestation plus a 32-byte PRF output. The client uses the PRF output as an AES-256 wrapping key, generates a fresh master key (`generateMasterKey`), and wraps it twice — once with the PRF key, once with a SHA-256 hash of a generated recovery code. The server verifies the attestation with `@simplewebauthn/server`, stores the COSE public key + counter + transports, persists both wrapped master-key blobs and a salted SHA-256 hash of the recovery code, and returns a JWT.
- *Authenticate init/finish.* Server issues a new challenge token, returns the user's stored wrapping material so the client knows what to PRF-evaluate. After the assertion verifies, the server updates the signature counter (clone detection) and returns the JWT plus wrapped key blobs; the client unwraps the master key with the PRF output.
- *Recovery.* Recovery-code flow re-derives the wrapping key by SHA-256 of the 25-byte (base32 Crockford-encoded) code, unwraps the master key, enrolls a new passkey, and re-wraps under the new PRF output while keeping the same recovery hash.

**Dependencies** `@simplewebauthn/browser` and `@simplewebauthn/server` (v13.x). JWT issued by `@fastify/jwt`. PRF output feeds directly into the crypto layer (§2).

---

## 2. End-to-End Encryption & Key Management

**Location** `src/lib/crypto/primitives.ts`, `src/lib/crypto/keyManager.ts`, `src/lib/crypto/recovery.ts`, `src/lib/crypto/index.ts`

**What it does** Provides AES-256-GCM encryption for everything that crosses the network or persists outside the browser, and holds the user's master key in volatile memory for the duration of a session.

**How it works**
- *Algorithm.* AES-GCM with a 256-bit key, a fresh 96-bit IV per record, and the 128-bit auth tag appended to the ciphertext by `SubtleCrypto`. The wire format is `Sealed = { iv: Uint8Array, ciphertext: Uint8Array }`, base64-encoded for JSON transport.
- *Master key lifecycle.* `generateMasterKey()` calls `crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt'])` once per account, ever. It is double-wrapped — by the passkey PRF key and by the recovery-code key — and only the wrapped blobs are persisted (locally and remotely). The unwrapped `CryptoKey` lives only in `keyManager.ts`'s module-level `_masterKey` reference and is dropped on logout, lock, or tab close. It never touches `localStorage` or IndexedDB.
- *Recovery code.* 25 random bytes encoded as eight groups of five Crockford base32 characters (200 bits of entropy, displayed as `XXXXX-XXXXX-…`). On use, the code is normalized, base32-decoded, SHA-256 hashed, and imported as an AES-256 key. The hash-derived key always yields exactly 32 bytes regardless of code formatting.
- *Helpers.* `encryptString`, `encryptJSON`, `encryptBytes` (and their inverses) wrap `TextEncoder`/`TextDecoder` and JSON serialization around the byte-level primitives. The sync engine uses `encryptJSON` for every record payload.

**Dependencies** Browser `SubtleCrypto`. Consumed by auth (§1) and sync (§3). No third-party crypto libraries.

---

## 3. Sync Engine and Sync API

**Location**
- Client: `src/lib/sync/engine.ts`, `src/lib/sync/syncApi.ts`, `src/lib/sync/serializer.ts`
- Server: `backend/src/routes/sync.ts`

**What it does** Reconciles the local Dexie database with the server using end-to-end encrypted record blobs, last-write-wins by `updatedAt`, and cursor-based incremental pull. The server is intentionally blind to record contents.

**How it works**
- *Dirty tracking.* Every Dexie table registers `creating` / `updating` / `deleting` hooks that push `(kind, id, deleted?)` entries into an in-memory dirty queue and persist a coalesced copy to `metadata.sync.dirty` for crash resilience.
- *Tick loop.* `syncEngine.start(intervalMs = 10_000)` polls. Each tick, if the vault is unlocked and no request is in-flight, the engine flushes the dirty queue then pulls deltas.
- *Push.* Up to 200 dirty entries per batch. For each entry the engine reads the current row, calls the kind-specific `envelope*` function (e.g. `envelopeConversation`) to convert `Date` to ISO strings, then `encryptJSON(masterKey, payload)` produces a `Sealed` blob. The request body carries `{id, kind, parentId, iv, ciphertext, updatedAt, deleted}` — only the `payload` is encrypted; routing metadata stays in the clear. Server upserts via `onConflictDoUpdate` on the composite `(userId, id)` PK and skips writes when the existing `updatedAt` is newer or equal.
- *Pull.* Cursor stored in `metadata.sync.pullCursor`. The engine requests `GET /api/sync/pull?since=<cursor>&limit=500`. The server queries `userId = current AND updatedAt > since`, ordered ascending by `updatedAt`, fetches `limit + 1` to detect `hasMore`, and returns the cursor `updatedAt` of the last returned row. The client decrypts each payload, applies the kind-specific `rehydrate*` function (ISO strings back to `Date`), and upserts to Dexie. Cascade deletes — e.g. a conversation tombstone removing its messages and anchors — are applied at this point. Up to 50 pages per tick for safety.
- *Conflict resolution.* No semantic merging. Atomic last-write-wins at the row level by `updatedAt`. Deletes are tombstones (`deleted: true`) and propagate the same way.

**Dependencies** Crypto layer (§2) for `encryptJSON`/`decryptJSON`. Dexie (§4) for both reads and hook-based dirty tracking. `getAuthToken()` from auth (§1) for the Bearer JWT on every request. Backend uses Drizzle's `onConflictDoUpdate` with composite-PK semantics.

---

## 4. Local-First Storage Layer (Dexie)

**Location** `src/lib/db.ts` (barrel), `src/lib/db/schema.ts`, `src/lib/db/{conversations,messages,activities,anchors,tags,folders,metadata,dailyStats}.ts`

**What it does** Local IndexedDB acting as the application's source of truth. Every read and write in the UI goes through this layer; the network is an optimization, not a requirement.

**How it works**
- *Schema (version 1).* Nine tables — `conversations`, `messages`, `activities`, `anchors`, `tags`, `entityTags`, `knowledgeFolders`, `dailyStats`, `metadata` — with composite indexes tuned to access patterns: `[source+updatedAt]` for paged conversation lists, `[conversationId+createdAt]` for message ordering, junction-table indexes for tag lookups.
- *Hooks.* Each table installs Dexie `creating` / `updating` / `deleting` hooks that mark the affected row dirty for the sync engine. Hooks are the single integration point between storage and replication — application code never has to remember to "also tell sync."
- *Cascade transactions.* Operations that span tables — deleting a conversation removes its messages and anchors, importing a batch inserts conversations and messages together — are wrapped in Dexie transactions so they either all succeed or all roll back.
- *Schema highlights.* `StoredConversation` keeps a denormalized `fullText` field used by the Fuse.js search index (§10). `StoredMessage` carries both a flat `text` field for search and a structured `contentBlocks` discriminated-union array for rendering. `metadata` is a key/value store for sync cursors, last-sync timestamps, license state, and theme.

**Dependencies** `dexie@4`. Read by `api.ts` (§9) and consumed by the sync engine (§3) via hooks.

---

## 5. Backend Postgres Schema

**Location** `backend/src/db/schema.ts`, `backend/src/db/index.ts`, `backend/drizzle.config.ts`

**What it does** Stores two kinds of data: the user's auth material and wrapped encryption keys (in `users`), and per-user ciphertext blobs for sync (`sync_records`). The server never sees plaintext user data.

**How it works**
- *`users` table.* Holds `id`, `email` (unique), and the WebAuthn credential — `passkeyCredentialId` (unique), `passkeyPublicKey` (COSE-encoded `bytea`), `passkeyCounter`, `passkeyTransports` (jsonb). Encryption material: `prfSalt`, `wrappedByPasskeyIv` + `wrappedByPasskeyCt`, `wrappedByRecoveryIv` + `wrappedByRecoveryCt`, plus `recoveryCodeHash` and `recoveryCodeServerSalt`. The PRF salt is sent with every assertion so the client reproduces the same wrapping key deterministically.
- *`sync_records` table.* `(userId, id)` composite primary key partitions every user's records into their own keyspace and makes per-user range scans index-friendly. Columns: `kind` (`varchar(20)` enum across nine record types), `parentId`, `iv` and `ciphertext` (both `bytea`), `updatedAt`, `deleted` tombstone. Three indexes: `(userId, updatedAt)` for the pull query, `(userId, kind, updatedAt)` for kind-filtered pulls, `(userId, parentId)` for hierarchical lookups.
- *Migrations.* Drizzle Kit code-generates SQL migrations into `backend/drizzle/migrations/`. `db:push` applies them in development; `db:migrate` runs them in CI/production. Application code uses Drizzle's typed query builder exclusively — no raw SQL outside migrations.
- *Driver.* `postgres` (v3.4) single connection pool; Drizzle wraps it as `drizzle(client, { schema })`.

**Dependencies** PostgreSQL 16 (Docker Compose), `drizzle-orm`, `drizzle-kit`, `postgres`.

---

## 6. Stateless Challenge Tokens

**Location** `backend/src/utils/challengeToken.ts`, `backend/src/utils/passwordHash.ts`

**What it does** Carries WebAuthn challenge state between `*-init` and `*-finish` calls without a server-side session table, and verifies recovery codes without storing them.

**How it works**
- *Token format.* `base64url(JSON(payload)) + "." + base64url(hmacSHA256(JSON(payload)))`. The payload is `{intent, email, challenge, prfSalt, pendingUserId?, exp}`, where `intent` is one of `register | authenticate | recover-enroll` and `exp` is 5 minutes from issue.
- *Signing key.* HMAC-SHA256 with `JWT_SECRET` (≥32 chars, enforced at boot). The same secret signs JWTs, so token revocation is global if it ever needs to happen.
- *Verification.* Timing-safe HMAC comparison via `crypto.timingSafeEqual`, followed by an expiry check. Any tampering or replay outside the 5-minute window fails verification.
- *Recovery code hashing.* `SHA-256(serverSalt || recoveryCode)` where `serverSalt` is 16 random bytes per user. Verification is timing-safe. The 5-minute challenge TTL bounds brute-force attempts to the duration of an active recovery ceremony.

**Dependencies** Node `crypto`. Used by every endpoint in `/api/auth`.

---

## 7. Conversation Format Parsers

**Location** `src/lib/parsers/index.ts`, `src/lib/parsers/claude-ai.ts`, `src/lib/parsers/claude-code.ts`, `src/lib/import.ts`

**What it does** Converts raw Claude.ai exports (ZIP or JSON) and Claude Code session logs (JSONL) into the unified `StoredConversation` + `StoredMessage` model.

**How it works**
- *Format detection.* `detectFileFormat` switches on MIME type and extension: `.zip` → Claude.ai archive; `.json` → Claude.ai JSON; `.jsonl` → Claude Code log.
- *Claude.ai ZIP.* Uses `jszip` to locate `conversations.json` across known paths (root, `claude/`, `export/`, `data/`) and falls back to a glob search if not found.
- *Claude.ai conversion.* Accepts the array directly, `{conversations: […]}`, or `{chats: […]}`, with auto-detection of the first array property. For each message, it walks four possible content sources — `files[]` (Claude artifacts, with file-extension language detection), `attachments[]` (user uploads), the `text` field (markdown code-fence regex `/```(\w*)\n?([\s\S]*?)```/g`), and the modern `content[]` array (text, thinking, tool_use, tool_result, artifact blocks) — emitting the unified `ContentBlock[]` shape. "This block is not supported on your current device" placeholders are stripped and emit `{type: 'unsupported'}` only if nothing else remains.
- *Claude Code JSONL.* Parses one JSON object per line. Skips `system` entries, maps `user`/`assistant` to roles, and emits `sender: 'tool'` for `tool_use` / `tool_result` with appropriate `contentBlocks`. Conversation metadata (`sessionId`, `cwd`, `gitBranch`) is collected from the first non-empty value across the file; the conversation name falls back to the working-directory basename or filename. `tool_result` arrays are recursively flattened to text.
- *Bulk import.* `parseFiles` dispatches to the right parser per file and reports `{phase, file}` progress. `storeData` dedupes by conversation ID, bulk-inserts in 500-conversation chunks, and returns `{conversationsAdded, conversationsSkipped, messagesAdded, source}`.

**Dependencies** `jszip` for archive reads. Emits the shared types from §8. Output is consumed by `api.importData` (§9), which writes to Dexie (§4).

---

## 8. Unified Type System

**Location** `src/types/unified.ts`, `src/types/activity.ts`, `src/types/index.ts`

**What it does** A single discriminated-union type model that lets every part of the app — parsers, storage, API, sync, search, rendering — agree on what a conversation, a message, and a content block are.

**How it works**
- *`ContentBlock`.* Discriminated union on `type`: `text | code | thinking | tool_use | tool_result | artifact | unsupported`. Each variant carries only the fields it needs (`language` for code, `toolName`/`toolInput`/`toolResult` for tool blocks, `artifactTitle`/`artifactType` for artifacts). The union is exhaustive — adding a new block type forces every switch statement that handles content to be updated.
- *`StoredConversation` / `StoredMessage`.* Source-agnostic shapes with `source: DataSource = 'claude.ai' | 'claude-code'` for filtering. Messages carry both `text` (flat plain text for search) and `contentBlocks` (structured for rendering) — the redundancy is intentional, since search needs to be cheap and rendering needs structure.
- *`Tag`, `EntityTag`, `EntityType`.* Tags are first-class entities; the `entityTags` junction table supports tagging across `prompt | conversation | anchor | thread`.
- *`AppMetadata` + `MetadataKey`.* Typed key/value store; the union of known keys (`'lastSync.*'`, `'sync.dirty'`, `'license.*'`, `'settings.*'`) keeps the metadata table type-safe despite being a free-form KV.

**Dependencies** None — types only. Referenced by virtually every other module.

---

## 9. API Client Layer

**Location** `src/lib/api.ts`

**What it does** Presents a stable, async, REST-shaped surface (`api.getConversations`, `tagApi.tagEntity`, `anchorApi.createAnchor`, …) backed by Dexie reads and writes, with `Date ↔ ISO string` shape conversion so the boundary stays serialization-friendly.

**How it works**
- *Shape converters.* `toApiConversation`, `toApiMessage`, `toApiActivity`, `toApiAnchor`, `toApiTag` map internal `Stored*` types (with `Date` fields) to wire-safe `Api*` types (with ISO strings). The reverse direction is handled by parsers and the sync engine's rehydrators.
- *Surface.* `api.*` handles conversations, messages, and activities (CRUD, paginated lists, `importData`, `recomputeStats`, `clearAllData`, `clearDataBySource`, `getCounts`). `tagApi.*` covers tag CRUD and entity tagging. `anchorApi.*` covers anchors and knowledge folders.
- *Bulk operations.* `importData` dedupes by ID and bulk-inserts in 500-row chunks. `recomputeStats` sweeps every message, rebuilds `DailyStats` by date, and estimates tokens as `text.length / 4`.
- *Error model.* `ApiError(status, message)` is thrown on validation and not-found cases; UI catches and surfaces via toast.

**Dependencies** Dexie (§4). Pure client-side — no network calls live here; that's the sync engine's responsibility.

---

## 10. Search (Tiered Fuse.js)

**Location** `src/lib/search.ts`

**What it does** Fuzzy full-text search over conversations, with a free tier capped at the 100 most recent conversations and a pro tier covering up to 10 000.

**How it works**
- *Index construction.* `buildSearchIndex` fetches all conversations, sorts by `createdAt` descending, and constructs two `Fuse` instances: `fuseIndex` (free, sliced to 100) and `fuseIndexPro` (up to 10 000). Both are cached in module scope; `invalidateIndex` clears them when data changes.
- *Configuration.* Fuzzy threshold `0.3`, `ignoreLocation: true`, `minMatchCharLength: 2`. Field weights `name: 2.0`, `summary: 1.5`, `fullText: 1.0` so name hits rank above body hits.
- *Querying.* `search(query, {isPro, source?})` selects the appropriate index, runs `Fuse.search`, optionally filters results by `source`, and maps each match to a `SearchResult` with a 60-character snippet extracted around the first match position.
- *Tier gating.* `getFreeTierLimit()`, `getIndexedCount()`, and `getTotalConversationCount()` let the UI explain to free-tier users why older conversations aren't searchable.

**Dependencies** `fuse.js@7`. Reads from Dexie via `api.getConversations` (§9).

---

## 11. State Management (Zustand)

**Location** `src/stores/appStore.ts`, `src/stores/authStore.ts`, `src/stores/tagStore.ts`, `src/stores/anchorStore.ts`, `src/stores/toastStore.ts`, `src/stores/shortcutStore.ts`

**What it does** Holds UI-facing global state — theme, sidebar, import progress, auth status, sync state, tag filters, toast queue, keyboard bindings.

**How it works** Zustand stores with synchronous action setters and no async middleware. Async work — ceremonies, fetches, imports — lives in components or effect hooks and writes results back through the stores' setters. `authStore.hydrate()` rebuilds the session from `localStorage` on page load and decides whether to render the logged-out, locked, or unlocked UI. Stores deliberately do not hold the master key; that lives only in `keyManager` (§2).

**Dependencies** `zustand@5`. Read by every React page and component.

---

## 12. Analytics Aggregation

**Location** `src/lib/analytics.ts`

**What it does** Rolls per-day `DailyStats` rows into the aggregates the dashboard charts.

**How it works** `aggregateStats(dailyStats[])` walks the array once, summing `inputTokens`, `outputTokens`, `messageCount`, `artifactCount`, `toolUseCount`, and merging the per-model usage map. It computes `avgTokensPerDay` and `avgMessagesPerDay`, and returns a `dailyData` array sorted by date for line/bar charts. `getDefaultDateRange(days)` returns the trailing-N-day window used by the default dashboard view.

**Dependencies** `recharts` consumes the output. Input comes from the `dailyStats` table (§4), which is rebuilt by `api.recomputeStats` (§9).
