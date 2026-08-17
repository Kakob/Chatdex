# Territory: Sync encrypted state

How rows in local IndexedDB become opaque ciphertext rows in Postgres, and how they come back on another device.

## The question

When I edit, import, or delete something locally, what exactly decides that it reaches the server, in what form, when — and what happens when two devices disagree?

## User-visible behavior

Almost nothing, and that is itself the headline finding of this territory. Sync has **no visible progress, success, or failure signal anywhere in the app** [CODE — see State ownership]. The observable behavior:

```
User visits Settings → Cloud Sync, unlocks with passkey
    ↓
sync engine starts (10-second tick loop)
    ↓
local writes silently queue and upload as ciphertext
    ↓
other devices' changes silently appear locally
```

Plus three explicit buttons in Settings: "Sync now", "Re-upload local data" (`resyncAll`), "Wipe server data".

**Sync does not start on app boot.** After every page reload, nothing syncs until the user visits Settings and unlocks — the master key lives only in memory and the sole `syncEngine.start()` call site is inside `CloudSyncSection` (`CloudSyncSection.tsx:42-46`). [CODE] Data imported before that is invisible to sync (see failure modes); the "Re-upload local data" button's own copy admits this: "Use this after a server wipe, or if data was imported while the vault was locked."

## Entry point

- `src/lib/sync/engine.ts` — `SyncEngine` (module singleton at :578). `start()` at :271, `tick()` at :298.
- Change capture: `installHooks()` (:403-474) registers Dexie `creating/updating/deleting` hooks on **all 15 tables**. This is the real entry point for "a write becomes a sync candidate": sync is coupled to storage via Dexie hooks, **not** via `src/lib/api.ts` (whose header claims sync "will sit underneath" it — it never did; that comment is stale). [CODE]

## Control-flow path

### Change tracking → push

```
any Dexie write on any of 15 tables
    ↓ hook
markDirty({id, kind, deleted?})                engine.ts:476   — coalesced per (id,kind);
    ↓                                                           queue persisted to metadata
                                                                'sync.dirty' via setTimeout(0)
every 10s: tick()                              engine.ts:298   — silent no-op if inflight,
    ↓                                                           suspended, or vault locked
flushDirty()                                   engine.ts:491
    ↓  splice(0, 200)  ← max 200 records per tick
buildEnvelope(entry)                           engine.ts:191   — re-reads the row from Dexie NOW
    ↓                                                           (no payload snapshot in the queue);
                                                                row gone → synthetic tombstone
encryptJSON(masterKey, payload)                per-record AES-256-GCM, fresh 12-byte IV
    ↓
POST /api/sync/push {records ≤200}             syncApi.ts:59   — on failure: batch prepended
    ↓                                                           back onto queue, pull skipped
server: Zod validate → one SELECT for existing → per-record LWW:
  skip if existing.updatedAt >= incoming       sync.ts:79-81   — ties go to the incumbent
  else INSERT ... ON CONFLICT DO UPDATE        sequential awaits, NO transaction
```

### Pull

```
pullDelta()                                    engine.ts:537
    ↓  cursor = metadata['sync.pullCursor']
GET /api/sync/pull?since=<ISO>&limit=500       up to 50 pages per tick
    ↓  server: WHERE userId AND updatedAt > since ORDER BY updatedAt ASC   ← strictly greater-than
decryptJSON per record  (failure: console.error, record SKIPPED, cursor still advances ⚠)
    ↓
applyIncomingRecord()                          engine.ts:79
    ├─ deleted → per-kind cascade: conversation delete also deletes its messages,
    │            anchors, findings, detectorRuns, projectAssociations — but deliberately
    │            SPARES understanding objects ("synthesis outlives any single source")
    └─ else → db.<table>.put(rehydrate(payload))   ← BLIND put, no local updatedAt comparison
    ↓
cursor := last row's updatedAt, persisted per page
```

Client-side conflict checking doesn't exist; LWW is enforced only server-side on push. The ordering "push before pull, and a push failure skips the pull" (`engine.ts:534`) is what protects local-newer rows from being clobbered — whether that coupling is intentional is fog. [CODE + INFERRED]

## Data flow

```
StoredConversation (Dexie row, Date objects)
 ↓ envelope<Kind>()            serializer.ts — 15 hand-written pairs, dates → ISO
SyncEnvelope {kind, parentId, updatedAt, payload = whole row}
 ↓ AES-256-GCM(masterKey)
Sealed {iv, ciphertext}
 ↓ base64
PushRecord {id, kind, parentId, iv, ciphertext, updatedAt, deleted}   ← wire
 ↓
Postgres sync_records: (user_id, id) PK, kind varchar(32), parent_id,
                       iv bytea, ciphertext bytea, updated_at, deleted
 ↓ pull → base64 → decrypt → rehydrate<Kind>() (new Date(iso)) → db.put
```

Notes on this pipeline [CODE]:
- **Every kind's LWW key differs**: conversations/anchors/findings use `updatedAt`; messages use `createdAt` (append-only, no updatedAt); tags/folders/entity_tags use `createdAt`; **`metadata` and `daily_stats` use `new Date()` at serialization time** — the seed of the worst failure mode below.
- `serializer.ts:5-7` claims only varying fields are serialized, keeping ids outside the ciphertext. **The comment is wrong**: every envelope spreads the whole row, so ids are duplicated inside the ciphertext too.
- Rehydrators are bare `as` casts with zero runtime validation — except `rehydrateUnderstandingEvent`, which backfills pre-U3.1 fields. A newer client's payload shape deserializes into an older client unchecked.
- Adding a sync kind requires touching ~6 places across `syncApi`, `serializer`, `engine` (×4 sites), and the backend schema. No registry.

## State ownership

```
Dexie tables (15)          source of truth, plaintext           [DOC engine.ts:1-3 + CODE]
metadata['sync.dirty']     persisted dirty queue (crash mirror of the in-memory queue)
metadata['sync.pullCursor']per-device pull cursor
SyncEngine fields          inflight / suspended / dirty[] / timer (per-tab, in-memory)
server sync_records        opaque blobs; server is a blind blob store
authStore.syncing/lastSyncAt/syncError   ← DEAD. Setters exist, engine never calls them,
                           so the Settings spinner and "Last synced" label NEVER render.  [CODE]
```

`sync.*` metadata keys are deliberately excluded from syncing in three places (`isDeviceLocalMetadata`) — otherwise persisting the queue would re-dirty the queue, an infinite loop that a regression test now guards (`engine.test.ts:109`). [CODE][TEST]

## Side effects and boundaries

- Network: `POST /push`, `GET /pull`, `DELETE /all` — Bearer JWT, no timeouts, **no AbortController**: one hung fetch pins `inflight` forever and deadlocks `tick()`, `clearLocalData()`, and `wipeServer()` (whose wait is a 50 ms poll loop with no timeout, `engine.ts:323-331`). [CODE]
- Crypto boundary: `getMasterKey()` throws while locked — the only real vault gate in the app.
- Dexie hooks: **cannot be uninstalled.** `stop()` iterates `hookHandles`, which is never populated — a known, commented gap (`engine.ts:472-473`). After stop, the queue keeps growing; only the tick stops.

### Is the "ciphertext-only server" invariant upheld?

**Payloads: yes.** Backend schema has no content columns; routes never parse ciphertext; audited clean including error paths. [CODE]

**Metadata: partially.** In the clear, per user: `kind` (exact per-type record counts), `updated_at` (full activity-timing history), `id`+`parent_id` (the complete graph structure — which messages belong to which conversation), and two genuinely leaky id namespaces: `metadata` record ids are human-readable key strings (`settings.theme`, `license.key`, `detection.configOverrides`) and `daily_stats` ids are **date strings** — the server learns exactly which days you were active. Against CLAUDE.md's strict wording this is a partial violation; against "payload confidentiality" it's fine. Nobody has written down which reading is intended. [CODE vs DOC]

## Decisions embodied by the code

**Decision:** Per-record envelope encryption with a single flat master key; LWW by client wall-clock `updatedAt`, arbitrated server-side on push only.
**Evidence:** [CODE engine.ts:494, sync.ts:79-81; DOC engine.ts:6-9 — "good enough at v1 (messages are append-only...)"]
**Consequence:** no key rotation path for `sync_records`; clock skew silently decides conflicts; a fast-clock device wins everything.
**Possible alternative:** server-assigned versions or hybrid logical clocks.
**Trade-off:** gains a trivially simple blind-blob server; gives up causality, conflict surfacing, and rotation.

**Decision:** Change tracking via Dexie hooks + an id-only dirty queue (row re-read at push time).
**Evidence:** [CODE engine.ts:403-489]
**Consequence:** any write path syncs automatically — but only if the engine was started first; the queue misses everything written while stopped.
**Trade-off:** zero per-write ceremony vs. a structural blind spot that required a manual "Re-upload" escape hatch.

**Decision:** Tombstones forever; no GC. Cascades re-derived client-side on pull; understanding objects deliberately survive conversation deletion.
**Evidence:** [CODE engine.ts:85-93 and its comment]
**Consequence:** `sync_records` grows monotonically; deleting 100k conversations leaves 100k tombstones.

**Decision:** Push batch of 200 per 10 s tick (server accepts 1000).
**Evidence:** [CODE engine.ts:494; sync.ts schema max 1000]
**Consequence:** ~20 records/second ceiling — a 100k-message import needs ~83 minutes of open-tab time to upload. Why 200, not 1000, is fog.

## Invariants and assumptions

- The vault must be unlocked for any sync activity; `tick()` silently no-ops when locked. [CODE engine.ts:299]
- `sync.*` metadata must never sync (self-poisoning loop otherwise). [CODE + TEST engine.test.ts:98-133]
- Client clocks are assumed roughly correct and monotonic — nothing validates `updatedAt` server-side beyond "non-empty string"; an unparseable date is *accepted* (NaN comparisons are false) and poisons ordering. [CODE sync.ts]
- Re-applying a pulled record must be idempotent (`put`) — the cursor advances per page, so crash recovery replays a page.
- **Assumed but violated in docs:** `docs/architecture.md` §5 says `kind varchar(20)`, "nine record types". Code says `varchar(32)`, 15 kinds — and **the only checked-in migration still creates `varchar(20)`**, so a DB provisioned via `db:migrate` breaks on `understanding_project` (21 chars). Per the build log, Neon was patched by hand. [CODE vs DOC vs migration — three-way disagreement]

## Failure modes

Ranked by consequence [CODE-grounded; #1 partially INFERRED]:

1. **Metadata/daily_stats ping-pong (suspected infinite loop).** Their envelopes stamp `updatedAt: new Date()` at serialization. Pull applies via `put` with hooks live → re-dirtied → re-pushed with a *strictly newer* timestamp → server accepts → pulled again... every 10 s, forever, amplified across devices. The one open question: whether Dexie 4's `updating` hook fires on a byte-identical `put`. If it doesn't, this collapses to a one-shot echo. **Highest-value thing to verify empirically in this whole territory.**
2. **Pull-echo re-push (all kinds).** Every pulled record is re-encrypted and re-pushed once (hooks are live during apply; no suspension) — server rejects it by LWW tie-skip, but bandwidth is ~2× on every pull.
3. **Cursor tie-loss (silent data loss).** Pull uses `updatedAt > since` with the cursor set to the last row's timestamp. If >500 rows share one millisecond (bulk import), rows beyond the page boundary sharing that timestamp are skipped forever. The composite PK could break ties (`ORDER BY updated_at, id`) but isn't used.
4. **Undecryptable record = permanently skipped.** Decrypt failure logs and continues, but the cursor still advances past it. Nothing retries except a manual cursor wipe that no UI exposes.
5. **`wipeServer` + a second device = resurrection.** Device B keeps its queue and cursor; its next tick re-uploads its dirty rows to the "wiped" server, and its ahead-cursor means it never re-pulls.
6. **Total silence on failure.** `tick()` swallows all errors to console; a 401 (say, after `JWT_SECRET` rotation) looks identical to healthy sync — green "Synced as {email}" forever.
7. **Non-atomic server push batch** — sequential inserts, no transaction; a mid-batch failure commits half. Idempotent retry makes this wasteful rather than corrupting.
8. **O(n²) dirty-queue persistence during bulk import** — every `markDirty` rewrites the whole queue array to IndexedDB.

## Tests and verification

`engine.test.ts` (6 tests) and `serializer.test.ts` (6 tests). What they establish [TEST]:
- `sync.*` metadata never pushes, never applies from pull, doesn't self-loop (regression suite for the commit `6b82984` bug-fix batch — these are patches-turned-tests, not a behavioral spec).
- `clearLocalData` empties tables without emitting tombstones; `wipeServer` waits out an in-flight push; `resyncAll` re-pushes rows the hooks never saw.
- Serializer round-trips for the 4 understanding kinds only, including the one explicit LWW-key assertion in the codebase and the one backward-compat test.

**Untested, notably:** conflict resolution itself (the headline behavior — zero tests, client or server); the entire backend sync route (LWW, cursor, tenant isolation, auth gating); encryption in the sync path (both suites mock crypto); pagination/`hasMore`; 11 of 15 serializer kinds — including the two with the `new Date()` LWW key; pull-side cascades; the >200 batch boundary; requeue-on-failure.

## Visual map

```
        WRITE PATH                              READ PATH
Dexie write ──hook──► dirty queue        server rows (updatedAt > cursor)
                │  (id+kind only)               │ pages of 500, ≤50/tick
      10s tick  ▼                               ▼
        re-read row → envelope → encrypt   decrypt → rehydrate → blind put
                │                               │         │
                ▼                               │         └─► hooks fire again!
   POST /push (≤200) ──► server LWW:            │             (echo re-push)
   skip if existing ≥ incoming                  ▼
   ties → incumbent wins             cursor := last updatedAt  (ties can lose rows)

   Vault locked / Settings never visited  ⇒  NONE of this runs.
```

## Suggested walk

1. Read `engine.ts:1-76` (header comment, `DirtyEntry`, `isDeviceLocalMetadata`) — the design intent is stated here.
2. Before reading `installHooks()`, predict: how would *you* capture every write across 15 tables, and what goes wrong if the queue itself is stored in one of them?
3. Read `installHooks()` + `markDirty()`; find the `setTimeout(0)` and read its comment.
4. Read `flushDirty()`; note what happens to the batch on failure and why pull is skipped.
5. Open `backend/src/routes/sync.ts` (148 lines, read it all); stare at lines 79-81 — this is the entire conflict-resolution system.
6. Read `pullDelta()` + `applyIncomingRecord()`; ask yourself what happens to the record you just applied (hooks are still live).
7. Read `serializer.ts` envelope functions for `metadata` and `daily_stats`; compare their `updatedAt` to the others'.
8. Finish with `engine.test.ts` and notice which of the behaviors you just traced have no test.

## Ownership challenge

Pick one:
- **Empirically settle failure mode #1**: two browser profiles against a local backend, watch the network tab for a `metadata` record ping-ponging. Then fix it (e.g., derive a stable `updatedAt` for those kinds, or suspend hooks during `applyIncomingRecord`) and write the missing test.
- Smaller: add `ORDER BY updated_at, id` keyset pagination to the pull route to close the cursor tie-loss, with a test that pushes >limit rows sharing one timestamp.

## Fog

- ? Does Dexie 4's `updating` hook fire on a byte-identical `put`? (Decides whether the ping-pong is infinite or one-shot.)
- ? Which schema is actually deployed — the hand-patched `varchar(32)` or the migration's `varchar(20)`? No migration `0001` exists.
- ? Was the `authStore.syncing/lastSyncAt` UI wiring built-and-lost or never built?
- ? Why 200 per batch when the server takes 1000?
- ? Is the push-before-pull ordering (which incidentally protects unpushed local edits) load-bearing on purpose?
- ? Is there any tombstone GC planned, or is `sync_records` monotonic by design?
- ? Was the pull-side blind `put` (no local updatedAt comparison) a deliberate simplification?
- ? What is the multi-device recovery story after `recoverWithCode` — full re-pull is implied by cursor absence on a fresh device, but untested.
- ? Is the plaintext id/kind/timestamp metadata on the server an accepted disclosure? `daily_stats` ids leak active days; `metadata` ids leak key names.
- ? `resyncAll` aborts if the queue didn't shrink between rounds — a single concurrent write can silently cancel a full re-upload. Intended?
