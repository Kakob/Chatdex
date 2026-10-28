# Reliable sync and storage-location labels

Status: Implemented — acceptance pending (Phase 1 and the conversation/message part of Phase 2)
Primary capability: none (shared infrastructure: sync engine, auth, key lifetime)
Affected contracts:
- [auth-architecture.md §4 "Master key never persisted"](../../architecture/auth-architecture.md) (amended by D1)
- [architecture.md §2 End-to-End Encryption & Key Management, §3 Sync Engine and Sync API](../../architecture/architecture.md)
- CLAUDE.md invariant 1 (sync is ciphertext-only) is **preserved unchanged**
- [invariant-register.md](../../assessments/invariant-register.md) INV-1, INV-2, INV-28 (must stay guarded), plus new rows for this plan

## Problem

On 2026-10-28 most of the user's local Chatdex data (all discovered projects and the
conversations behind them) was found missing. Investigation established:

1. Chrome's `localhost:4000` IndexedDB was recreated from scratch on 2026-09-24 08:39
   local time (origin storage cleared outside Chatdex; no app code path deletes the
   database). After that, sync pulled back what the server held: 15 conversations,
   2 projects.
2. The server never held the rest. It has no conversation newer than 2026-08-18 and
   **zero tombstones**, so the missing data was never uploaded, not deleted.
3. Sync then stopped on 2026-09-25 and has not run since. Everything created after
   that date (e.g. the "MIT Investigations" project, research data) is on this device
   only, and nothing in the UI says so.

Root causes in code:

- **Sync starts only from the Settings page.** `CloudSyncSection.tsx:42` calls
  `syncEngine.start()` when that component mounts while unlocked. Nothing else starts it.
- **Every reload locks the vault.** The master key lives only in `keyManager.ts`
  module memory (auth-architecture §4). After any reload sync stays off until the
  user opens Settings and runs a passkey ceremony.
- **Changes made while locked are never queued.** `engine.ts:412` installs the Dexie
  hooks inside `start()` and `stop()` removes them. Creates, updates and *deletes*
  made while sync is off are never queued; only the manual "Re-sync all" recovers
  creates, and nothing recovers deletes.
- **No visibility.** The UI never says whether a record exists only on this device.

The user's intent: what they create should be backed up to the cloud automatically,
and the app should say plainly what is saved where.

## Decisions for the user

**D1: Remember the key on this device. APPROVED 2026-10-28; auth §4 amended.**
After a successful unlock, store the master key in IndexedDB as a **non-extractable**
WebCrypto `CryptoKey` (structured-clone storage; JavaScript can use it to
encrypt/decrypt but can never read its bytes). On load, if a stored key exists for the
logged-in user, unlock silently and start sync.
- Server-side guarantees are unchanged: the server still sees only ciphertext, salt
  and wrapped keys.
- New local exposure: anyone with access to this browser profile can make the app
  sync. They could already read every conversation in plaintext from IndexedDB, so
  the marginal exposure is small.
- `Lock`, `Log out`, and "Delete all local data" delete the stored key. A per-device
  toggle "Stay unlocked on this device" (default on) allows opting out.
- Rejected alternative: turning off encryption. It does not fix any root cause above,
  and it would expose every conversation to the database host. It would also need
  invariant 1 removed.

**D2: Label vocabulary.** Shipped 2026-10-28 as *Backed up* / *Waiting to upload* / *This device only*. Originally proposed: *On this device only* / *Waiting to upload* /
*Backed up to cloud*. Local-only tables (repo files, research sources/snapshots,
raw payloads, agent inspections) always read *On this device only (by design)*.

## Proposed changes

### Phase 1: sync that runs by itself
1. Move sync startup out of `CloudSyncSection` into an app-level bootstrap
   (`App.tsx` or a `useSyncLifecycle` hook): on load, hydrate auth; if logged in and
   unlockable (D1), unlock and `start()`. Settings keeps manual controls only.
2. Install the Dexie change hooks **at app start, independent of lock state**. While
   locked, hooks append to the persisted dirty queue (ids and kinds only; no plaintext
   leaves IndexedDB). `tick()` keeps refusing to push while locked.
3. Add a local-only **sync ledger** table (`&[kind+id]`, `pushedAt`, `pushedVersion`)
   written after each successful push. On `start()`, reconcile: enqueue any syncable
   row with no ledger entry or a newer local version. This makes catch-up automatic
   and replaces the manual "Re-sync all" as the normal recovery path (keep the button).
4. Global status indicator in the header, replacing the static "Local-first" label
   (requested 2026-10-28): *Synced · 2 min ago* / *Syncing…* / *N waiting* /
   *Locked · N waiting* / *Sync error* / *On this device only*. Clicking opens a
   menu with the explanation, Sync now, Lock / Unlock with passkey, and a link to
   sync settings.

### Phase 2: "where is this saved?" labels
5. Selector `getStorageLocation(kind, id)` derived from ledger + dirty queue +
   local-only table list.
6. Show the label on conversation rows/detail, project cards/overview, and the import
   result screen. Add a Settings → Storage summary: counts per label, per source.

### Deferred (separate plan if needed)
- **Cloud-only offload** (evict message bodies locally after a confirmed upload;
  fetch on open). The user's disk currently has ~17 GB free and transcripts total
  ~20 MB, so this is not urgent.
- Server-side backup/export of the ciphertext store.

## Scope and exclusions
- No change to the ciphertext envelope, the serializer, or the backend sync routes.
- No plaintext to the server. No change to detection (stays client-side).
- `src/lib/crypto/` changes are limited to D1 key persistence and are made only after
  D1 is approved.

## Implementation steps
1. D1 approval → amend auth-architecture §4 and architecture.md §2 in the same change.
2. Key persistence in `keyManager` (`persistKey` / `loadPersistedKey` / delete on
   lock and logout) and silent unlock in `session.ts`. Tests for each path.
3. App-level sync bootstrap; hooks always installed; locked-queue behavior. Tests.
4. Sync ledger table (Dexie v15, local-only, added to `localOnly.test.ts`) and
   start-up reconcile. Tests, including a create and a delete made while locked.
5. Header status indicator.
6. Phase 2 labels and Settings → Storage summary.

## Acceptance criteria
- Reload the app while logged in: sync resumes with no visit to Settings and no
  passkey prompt (D1 on). With D1 off, the header says *Locked: N changes waiting*.
- Create a project while locked, then unlock: it reaches the server without
  "Re-sync all". Delete a conversation while locked, then unlock: a tombstone reaches
  the server.
- After first run on the user's device, "MIT Investigations" and other post-09-25
  records exist on the server (verified by record counts per kind).
- Lock / Log out / Delete all local data removes the persisted key (test asserts the
  key store is empty).
- Every conversation and project shows one of the D2 labels; local-only tables are
  never labeled *Backed up*.
- INV-1, INV-2, INV-28 guard tests still pass; new guard: the persisted key is
  non-extractable (`exportKey` rejects).
- `npm run typecheck`, `npm test`, `cd backend && npm test` pass.

## Documentation updates
- auth-architecture.md §4 → "Master key persistence" (non-extractable, device-local,
  deleted on lock/logout).
- architecture.md §3 → hooks always installed; ledger; start-up reconcile.
- invariant-register.md → new rows for key non-extractability, locked-queue, ledger
  local-only.
- CLAUDE.md tech-stack crypto line if key-lifetime wording changes.

## Outcome

### Phase 1 (2026-10-28)

Delivered:
- `src/lib/crypto/deviceKey.ts`: non-extractable master key in its own IndexedDB
  database; `importRawKey(raw, extractable)`; every unlock path in `session.ts` goes
  through `finishUnlock`. `resumeFromDevice`, async `lock`, `logout`, and
  `get/setStayUnlocked` added. "Stay unlocked on this device" checkbox in Cloud Sync.
- `src/hooks/useSyncLifecycle.ts` (mounted in `App`): attaches hooks at boot,
  resumes from the device key, and starts/stops the engine on auth status.
  `CloudSyncSection` no longer starts sync. `authStore.hydrate()` no longer
  reports an unlocked vault as locked.
- `engine.ts`: `attach()` (hooks always on), `stop()` keeps hooks, `reconcile()`
  against the new Dexie v15 `syncLedger`, ledger writes on push/pull, a tick drains
  the whole queue, a concurrent `tick()` joins the running one, pulled records no
  longer re-queue themselves (pre-existing echo bug), status via `subscribe()`.
- "Delete all local data" also forgets the key and locks; otherwise sync would
  pull everything straight back.
- `src/components/layout/SyncStatusMenu.tsx` in the header.

Verification: `npm run typecheck`, `npm run lint`, `npm run build` clean;
`npm test` 1011/1011; `cd backend && npm test` 53/53. New tests:
`crypto/deviceKey.test.ts`, `auth/session.test.ts`,
`sync/engine.lifecycle.test.ts`, ledger guard in `db/localOnly.test.ts`.
In the browser, the header showed "Locked · 4 waiting" for the signed-in, locked
account, the menu rendered with Unlock, and there were no console errors.

Acceptance in the user's browser (2026-10-28):
- [x] First unlock: uploads began, then failed with HTTP 400. Cause: question and
      research investigation cases have `conversationId: ''`, which
      `envelopeInvestigationCase` sent as `parentId: ''`; the server's schema needs a
      non-empty string or null, and rejected the whole 152-record batch. This bug
      predates this change (`research/service.ts` creates such cases); it surfaced
      because those cases had never synced. Fixed in the serializer
      (`conversationId || null`) and with an engine-wide `parentId || null` guard;
      regression test in `engine.lifecycle.test.ts`.
- [x] After the fix: push 200, pull 200, header "Synced · just now". Server counts
      now match the device: understanding_project 3 (was 2), understanding_object 7
      and understanding_event 7 (were 4), investigation_case 2 (was 1).
- [x] Reload resumed silently from the device key, with no passkey prompt.
- [ ] Lock from the menu, reload: header stays "Locked".

One bad record still blocks its whole batch (head-of-line). The header now shows
the error, but a follow-up could isolate and report the offending record.

Limitations:
- JWTs issued by the backend have no expiry, so a remembered key plus the stored
  token resumes indefinitely. Pre-existing; out of scope here.
- Updates made in another tab while this tab holds no hooks are covered by the
  hooks in that tab; there is no cross-tab coordination (pre-existing).

### Phase 2 (2026-10-28)

Delivered (requested by the user: "see if each conversation or each message is
synced"):
- `src/lib/sync/storageLocation.ts`: per-record location from the ledger and the
  dirty queue (kinds and ids only; a key-only cursor groups messages by
  conversation without reading bodies). Signed out, anything not on the server
  shows as *This device only*.
- `StorageBadge` on every conversation card in Sources and in the conversation
  header (with "x/y messages" when partial); `StorageDot` beside each message's
  timestamp; totals for conversations, messages, and projects in the header menu.
  Hooks recompute, debounced, on sync progress.
- Tests: `sync/storageLocation.test.ts`. Full suite 1016/1016; typecheck and lint
  clean.
- In the browser: all 15 conversations show *Backed up*; the menu shows 15/15
  conversations, 2,419/2,419 messages, and 3/3 projects backed up.

Not done: badges on project cards, investigation cases, and other record types;
a Settings → Storage page.

### Sync timing (2026-10-28)

The fixed 10-second poll uploaded changes up to 10 s late and kept polling
(about 360 requests an hour per open tab, even in the background), which likely
keeps the Neon database awake whenever a tab is open. Changed (`src/lib/sync/engine.ts`):
- Uploads follow local writes: `PUSH_DELAY_MS` 2 s after writes go quiet,
  capped at `PUSH_MAX_WAIT_MS` 10 s during a burst (an import uploads as it goes).
- Polling for other devices' changes: `PULL_INTERVAL_MS` 90 s, skipped while the
  tab is hidden. Returning to the tab pulls immediately.
- Hiding or closing the tab pushes the queue immediately. Best-effort on close:
  the queue is persisted, so anything cut off uploads on the next open.
- A failed push is retried on the next write, poll, or tab return (previously
  every 10 s).
- Tests: three timing cases in `sync/engine.lifecycle.test.ts`. Full suite
  1019/1019 (one run hit the pre-existing intermittent failure in
  `investigation/constraints.test.ts`, which also fails about 1 in 8 runs on a
  clean HEAD); typecheck and lint clean.
