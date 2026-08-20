# Territory: Search and browse conversations

The default surface of the app: listing conversations, opening one, and searching across them — plus the caches that make (and unmake) it.

## The question

When I type a query or open a conversation, what data structure actually answers — where does it live, when was it built, and what makes it stale?

## User-visible behavior

```
/ redirects to /search  (search is the app's home)
    ↓
first search: "Building search index… This only happens once" (per page load)
    ↓
fuzzy results with snippets → click → /conversations/:id?highlight=<query>
    ↓
conversation view: all messages rendered, matches highlighted (sometimes — see below),
findings chips/markers overlaid, tags editable, Cmd+F for local literal search
```

Browse (`/conversations`) is a separate page: source-filter chips, tag filter, 50-at-a-time "Load more", batch tag mode. `conversations` and `conversations/:id` are **the same route component** branching on the URL param — while the detail is loading (or on "not found"), the list renders instead, silently. [CODE ConversationsPage.tsx:97]

## Entry point

- Search: `src/pages/SearchPage.tsx` → `useSearch` (`src/hooks/useSearch.ts`, 300 ms debounce) → `src/lib/search.ts:101 search()`.
- Browse list: `useConversations` (`src/hooks/useConversations.ts:19`) → `getConversations` (`src/lib/db/conversations.ts:17`).
- Detail: `useConversation(id)` (`useConversations.ts:93`) → `db.conversations.get` + `getMessagesForConversation`.

## Control-flow path

### Search

```
useSearch (debounce 300ms)
    ↓
ensureIndex()                       search.ts — lazy, module-singleton, MAIN THREAD
    ↓  getConversations({limit: 10000})   ← full-table in-memory sort first (see below)
    ↓  TWO Fuse.js indexes built: pro (all rows) + free (100 newest by createdAt)
       — both always built, even for free users
fuse.search(query)                  Bitap fuzzy, threshold 0.3, keys: name(2) summary(1.5) fullText(1)
    ↓
source filter applied AFTER search, BEFORE limit    ← filter shrinks results
    ↓
snippet: ±60 chars around first match index; result click → ?highlight=<query>
```

Key facts [CODE]:
- **No inverted index, no tokenizer, no worker, no message-level search.** The index is Fuse over whole conversation rows including the denormalized `fullText` transcript. Granularity is the conversation.
- **Invalidation is manual.** `invalidateIndex()` is called after import, settings data-clears, and native-chat writes — but **not** after sync pulls or conversation deletion → stale index after cross-device sync. [CODE sync/engine.ts writes db directly]
- **Free/pro gate**: `FREE_TIER_LIMIT = 100` newest conversations. `isPro` hydrates **only when the user visits Settings** — a returning pro user searches the free index until then (except on this dev machine, where `VITE_DEV_PRO=true` in `.env.local` forces pro at boot). [CODE appStore.ts:49, SettingsPage.tsx:37]

### Browse list

```
useConversations (one-shot useEffect fetch — NO Dexie live queries anywhere in the app)
    ↓
getConversations: where('source') or whole table
    → .sortBy('updatedAt')   ← Dexie IN-MEMORY sort: materializes EVERY matching row
      (fullText included) then reverse + slice.
      The [source+updatedAt] composite index declared in schema.ts:49 is NEVER used
      by any query — docs/architecture.md's claim that it backs paged lists is false.
    ↓
offset-append pagination via "Load more"; limit+1 trick for hasMore
    ↓
tag filter applied CLIENT-SIDE to the loaded page only → can show "no results"
                                                          while matches exist beyond page 1
```

### Detail view

`useConversation` loads the conversation row + **all messages at once** (the one genuine composite-index query: `[conversationId+createdAt]` range — ordering for free [CODE db/messages.ts:17, TEST db/index.test.ts:161]). No pagination, no virtualization — a 5,000-message session renders 5,000 bubbles. `ConversationView` (395 lines) layers: findings normalization + markers, tag editing, local Cmd+F, `?scrollTo=` deep links from Knowledge/evidence links, and export.

**Highlight mismatch worth knowing** [CODE]: matching is *fuzzy* (Bitap), but all downstream highlighting is *literal substring* (`HighlightByQuery`). A fuzzy hit ("kubernets" → kubernetes) opens the conversation with a "Highlighting matches for…" banner and **zero highlights**. Also `handleClearHighlight` does a full `window.location.replace` — a real page reload — to drop the query param.

## Data flow

```
StoredConversation rows (with fullText)  ──build──►  Fuse index ×2 (module singletons)
        ▲                                                 │ search(query)
   Dexie writes ──(import/chat: invalidate)──────────────►│  stale after sync pull ⚠
                                                          ▼
                                  SearchResult {id, name, snippet, matches, score}
                                                          │ navigate
                                                          ▼
                    /conversations/:id?highlight=…  → literal-substring highlighting
```

## State ownership

The pattern across this whole territory: **Dexie is the source of truth; every read surface keeps its own non-reactive snapshot; invalidation is manual and incomplete.** [CODE]

| State | Owner | Staleness trigger |
|---|---|---|
| conversation list page | `useConversations` local state | never refreshed after import/tag/sync (its `refresh()` is returned but unconsumed) |
| search index | `search.ts` module singletons | not invalidated on sync pull or delete |
| tag catalog | `tagStore` + Dexie | `tagEntity` via store updates **no** store state (usageCount cached stale) |
| per-page tag map | `useConversationTags` (N+1: one query per visible conversation) | detail-view tag edits never propagate to it |
| detail-view tags | `ConversationView` local state — a **fourth** copy of tag state | — |
| counts in Header | `appStore` — set only by import/Settings, **0 at every boot** | — |

## Side effects and boundaries

IndexedDB (Dexie) is the only boundary — no network, no worker. Which means the entire search cost (index build over the full corpus, twice) lands on the **main thread**; the "Building search index…" spinner sits on a blocked UI. Detection got a worker; search didn't — deliberate or just untouched is fog.

## Decisions embodied by the code

**Decision:** Fuzzy in-memory Fuse index over denormalized per-conversation `fullText`, rebuilt from scratch on invalidation.
**Evidence:** [CODE search.ts:19-55; DOC architecture.md:189-201 states the rationale; DOC architecture.md:165 frames `fullText` as intentional redundancy — "search needs to be cheap, rendering needs structure"]
**Consequence:** fuzzy recall, sub-ms queries — and the whole corpus in memory, with an explicit 10,000-conversation ceiling already flagged as at-risk for large ChatGPT histories [DOC ASSESSMENT-shared-understanding-U0.md:50].
**Possible alternative:** message-level inverted index in a worker (e.g. FlexSearch/minisearch), or Dexie full-text via an index table.

**Decision:** One-shot fetches + manual invalidation instead of live queries.
**Evidence:** [CODE — no `liveQuery` anywhere; CLAUDE.md: Zustand, no React Query]
**Consequence:** every cross-surface staleness bug in the table above is a direct corollary.

**Decision:** Two aggregation philosophies coexist on the Analytics page: `dailyStats` is **precomputed but only on a manual "Recompute" button**, while detection stats are **computed on-read from raw rows every mount**.
**Evidence:** [CODE api.ts:375 recomputeStats vs detection/stats.ts:77]
**Consequence:** Analytics is silently blank after a fresh import until the user finds the button; `modelUsage` is *never* populated (StoredMessage carries no model field), so the Model Usage chart is permanently "No data available". [CODE]

**Decision:** Timeline reads an `activities` table that **nothing in the app writes**.
**Evidence:** [CODE — only writer is `api.addActivity`, zero callers; the Chrome extension that fed it targets `/api/activities`, a route the backend no longer registers]
**Consequence:** the Timeline page is structurally dead — permanently showing its "Install the Chrome extension" empty state. A live listener (`chatdex-activity` window event) remains wired to a ghost.

## Invariants and assumptions

- Message ordering = `[conversationId+createdAt]`; native chat writes force strictly-increasing timestamps because ties would sort by random UUID. [CODE chats.ts:139-143][TEST db/index.test.ts:161]
- `entityTags` uniqueness (`&[tagId+entityId+entityType]`) backs `tagEntity` idempotence; `usageCount` is a denormalized counter mutated only inside those transactions. [CODE tags.ts:56][TEST db/index.test.ts:258]
- **Violated assumption:** conversation deletion cleans up dependents — it cascades messages/anchors/findings/runs but **not `entityTags`** → orphaned links and permanently inflated `usageCount`. (Contrast: `deleteFolder` does clean up its references.) [CODE db/conversations.ts:40-52]

## Failure modes

- Stale search results after cloud sync (no invalidation). [CODE]
- Tag filter × pagination false-negatives. [CODE]
- Free index silently served to pro users at boot. [CODE]
- Fuzzy-match/literal-highlight mismatch. [CODE]
- Batch tagging is non-atomic (one transaction per conversation, unhandled rejections, no rollback). [CODE BatchTagBar.tsx:21]
- UTC/local timezone split: stats bucket on UTC day, all display is local → boundary-day misattribution. [CODE api.ts:381]
- Main-thread freezes on large corpora (index build, full-table sorts, `recomputeStats`'s `db.messages.toArray()`).

## Tests and verification

- `db/index.test.ts` is the real coverage: sort order, source filter, pagination (length only — not *which* rows), delete cascades, message ordering, tag idempotence/usageCount, dailyStats inclusive ranges. [TEST]
- `analytics.test.ts` covers the pure `aggregateStats` math only.
- Exporters are well tested (csv/json/markdown — including "system+tool messages are dropped from markdown export").
- **`src/lib/search.ts` has zero tests.** So do all the hooks in this territory, and `recomputeStats`. The most-used surface in the app is the least tested.

## Visual map

```
            SEARCH                      │           BROWSE
  query → debounce → Fuse (RAM,        │  list: full-table in-memory sort → page slice
  main thread, 2 indexes, manual       │  detail: PK get + [convId+createdAt] range
  invalidation ⚠ not on sync/delete)   │          → ALL messages, unvirtualized
        │                              │
        └── ?highlight=query ──────────►  literal substring highlight (fuzzy hits may
                                          highlight nothing)
  Staleness web: search index / list page / tagsMap / usageCount / Header counts —
  five caches over Dexie, none reactive, each invalidated by a different subset of writes.
```

## Suggested walk

1. Read `src/lib/search.ts` top to bottom (~165 lines) — it is the whole search engine. Before reading, predict where the index lives and when it rebuilds.
2. Read `useSearch.ts`; find the debounce and where `isPro` comes from; then check what sets `isPro` at boot (nothing — trace it to `SettingsPage`).
3. Read `getConversations` (`db/conversations.ts:17-31`) and compare against the indexes declared in `db/schema.ts:49`. Which are used?
4. Open `ConversationsPage.tsx`; find the tag-filter block and work out why it can show zero results when matches exist.
5. Read `useConversation` + `getMessagesForConversation` — the one clean composite-index query in the territory.
6. Skim `ConversationView.tsx` for the findings-overlay wiring (it's the seam to the detection territory).
7. Finish by grepping `invalidateIndex` call sites and listing the writes that *don't* call it.

## Ownership challenge

Write the first test file for `src/lib/search.ts` (index build, free-vs-pro selection, source-filter-after-search semantics, snippet extraction, invalidation), then fix one staleness hole it exposes — the natural candidate: call `invalidateIndex()` from the sync engine's `applyIncomingRecord` when a conversation is written. (Larger variant: rewrite `getConversations` to actually use `[source+updatedAt]` with `.reverse().offset().limit()` and benchmark the difference.)

## Fog

- ? Is the Timeline page intentionally dormant (extension moved to `extension-experimental`) or a regression nobody noticed? Should it be removed?
- ? Should `recomputeStats` run automatically after import? Was the manual button a cost decision or a leftover of the local-first migration?
- ? Is per-message model provenance planned (to feed the dead Model Usage chart), or should the chart go?
- ? Is `[source+updatedAt]` meant to be used, or should the index and the architecture-doc claim be dropped?
- ? Should the search index move to a worker like detection did?
- ? Fuzzy-match vs literal-highlight: pass Fuse indices through, make highlighting fuzzy, or accept the gap?
- ? Who owns `entityTags` cleanup on conversation delete?
- ? What should hydrate `appStore` (isPro, counts, theme) at boot? Nothing does today.
- ? `codex` is filterable everywhere but unproducible; `ExportMenu` is dead code while two pages hand-roll hover-only (keyboard-inaccessible) menus — adopt or remove?
- ? Free-tier gating is by `createdAt` while list order is `updatedAt` — a conversation can be on the first browse page yet unsearchable. Intentional?
