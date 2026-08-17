# Territory: Import a conversation

From "user drops an export file / picks the `~/.claude/projects` folder" to "conversations exist in IndexedDB, are searchable, and (for Claude Code) have been analyzed."

## The question

What actually happens between file selection and the data being usable — which formats are detected how, what gets silently dropped, what makes an import idempotent (or not), and what downstream systems fire?

## User-visible behavior

```
User drops a file on one of two cards (Claude.ai/ChatGPT vs Claude Code)
  — or picks/resumes the Claude Code projects folder (Chrome/Edge only)
    ↓
progress: "parsing" per file → "storing" per 500-conversation chunk
    ↓ (hidden: auto-analysis of new Claude Code sessions runs here, unreported)
"Import complete — N conversations, M duplicates skipped"
    ↓
conversations appear in Browse/Search (search index invalidated, rebuilt lazily)
```

Analytics does **not** update (`dailyStats` is never written by import — see failure modes), and sync only picks the rows up if the sync engine was already started.

## Entry point

All three entry paths converge on one callback: `useImport().handleFiles(files)` (`src/hooks/useImport.ts:24`), wired in `src/pages/ImportPage.tsx:6-7`.

- Drag/drop + click-to-browse: `DropZone.tsx` — two instances, Claude.ai card (`.zip,.json`, single file) and Claude Code card (`.jsonl`, multiple). The `accept` filter applies only to the file dialog; **drops bypass it entirely** — format is decided later by content. [CODE]
- Folder picker: `useClaudeCodeFolder` → `showDirectoryPicker` (`src/lib/fs/directoryPicker.ts:23`), with the directory handle persisted into the Dexie `metadata` table for one-click resume. Gated on `'showDirectoryPicker' in window` (Chrome/Edge only).

## Control-flow path

```
handleFiles(files)                          useImport.ts:24 — one try/catch wraps EVERYTHING
    ↓
importFiles(files, onProgress)              lib/import.ts:21
    ↓
parseFiles → parseFile per file, SEQUENTIAL parsers/index.ts:171, :94
    │   .jsonl        → parseClaudeCodeJSONL        (forced 'claude-code')
    │   .zip          → JSZip → find conversations.json → sniff content
    │   .json         → sniff content:
    │        has mapping/current_node → parseChatGPTJSON
    │        else (INCLUDING unparseable/unknown) → parseClaudeAIJSON  ← default bias
    ↓
storeData(parsed)                           lib/import.ts:64
    │   existingIds = one bulkGet snapshot BEFORE the loop
    │   per 500-conv chunk: filter out existing ids →
    │       bulkPutConversations(...)   then   bulkPutMessages(...)
    │                                   ↑ two separate writes, NO shared transaction
    ↓
autoAnalyzeConversations(new ∩ claude-code) lib/import.ts:40 — AWAITED, swallows errors,
    ↓                                        no progress reporting (UI sits at "storing")
setStats(counts) + setLastSync + invalidateIndex()   useImport.ts:36-42
```

Error behavior is bimodal [CODE]:
- **Item level: swallow.** Malformed JSONL lines, malformed conversations, unknown entry types, hidden ChatGPT nodes — all `console.warn`ed and dropped, **uncounted and invisible in the UI**. `ImportResult` has no "dropped" field; "duplicates skipped" means deduped, not dropped.
- **File level: throw and abort the whole batch.** One bad file among 50 aborts all 50 (parse phase throws before any write, so parse failures are clean). But a *store* failure mid-batch leaves earlier chunks persisted while the UI reports only "Import Failed" — partial state with no report.

### The three parsers, one paragraph each

- **Claude.ai** (`parsers/claude-ai.ts`): accepts several envelope shapes; converts `files[]`/`attachments[]`/`content[]` into content blocks (artifact/code/thinking/tool_use/tool_result), strips Claude.ai's "not supported on your device" placeholder strings into `unsupported` blocks. **Only parser with no NaN-date guard** — an unparseable `created_at` becomes an Invalid Date, which is not a valid IndexedDB key, making the message *stored but invisible* (reads go exclusively through the `[conversationId+createdAt]` index). [CODE claude-ai.ts:152, db/messages.ts:20]
- **Claude Code** (`parsers/claude-code.ts`): one conversation per JSONL file; metadata (sessionId/cwd/gitBranch) swept from *all* entries (a fixed regression — real logs don't lead with a `system` entry); `system` entries skipped; top-level `tool_use`/`tool_result` entries become `sender:'tool'` rows while *inline* tool blocks stay attached to their message — two representations of the same thing in the DB.
- **ChatGPT** (`parsers/chatgpt.ts`): walks the `mapping` tree from `current_node` to root (cycle-guarded) — **only the canonical branch is kept**; pruned edit-branches are counted (`prunedBranches`) into `providerMeta` rather than stored. [CODE + DOC — header comment: "discarded evidence stays visible"]

## Data flow

```
File
 ↓ (whole file in memory — file.text() / JSZip.loadAsync; no streaming, main thread)
raw provider shapes (ClaudeAIConversation / ClaudeCodeEntry[] / ChatGPT mapping tree)
 ↓ parser
ParsedData { conversations: StoredConversation[], messages: StoredMessage[], source }
 ↓ storeData (no further transformation)
Dexie rows — the unified objects verbatim, Dates and nested contentBlocks structured-cloned
```

**ID provenance — the load-bearing table** [CODE]:

| Entity | Derivation | Stable across re-import? |
|---|---|---|
| claude.ai conv/msg | `conv.uuid` / `msg.uuid` | yes |
| claude-code conv | `sessionId` from entries, **else `generateId()`** | only if the file carries one |
| claude-code msg | **`generateId()` per entry** | **no** |
| chatgpt conv | `conversation_id ?? id ?? generateId()` | usually |
| chatgpt msg | `message.id ?? nodeId` | yes |

`generateId()` = `Date.now()` + random suffix — not a UUID. `estimatedTokens` = `chars/4`, no tokenizer. `fullText` = all message text joined, denormalized onto the conversation row (this feeds search).

## State ownership

```
useImport local state        isImporting / progress / error / result — the REAL import state
appStore                     conversationCount/messageCount (set here, never at boot) +
                             isImporting/importProgress/setImportState — DEAD, never called [CODE]
Dexie conversations/messages durable rows
Dexie metadata               claudeCode.projectsDirHandle (the FS handle itself, structured-cloned)
appStore.lastSync            in-memory only — the lastSync.* metadata keys declared in
                             types/unified.ts are never written. Lost on reload. [CODE]
```

## Side effects and boundaries

- **File System Access API**: recursive `.jsonl` walk with no depth cap, no file-count cap, no abort; the walk's progress-callback parameter exists but is never passed — UI shows a static "Scanning…". [CODE directoryPicker.ts:72-99]
- **Detection**: fires automatically for newly-added `claude-code` conversations, awaited before "complete" — on a big folder import this is the long pole with zero progress feedback.
- **Sync**: no direct call. Rows sync only via Dexie hooks — which exist only if `syncEngine.start()` already ran (Settings visited + unlocked). Otherwise the rows are permanently invisible to sync until manual "Re-upload local data".
- **Search**: `invalidateIndex()` only; rebuild is lazy on next search.
- **Not triggered**: `dailyStats` recompute (Analytics stays stale), `activities`, understanding discovery.

## Decisions embodied by the code

**Decision:** Format detection by content sniffing, with ambiguity defaulting to the Claude.ai parser.
**Evidence:** [CODE parsers/index.ts:21-25, :121-124 — comment explains: both providers ship `conversations.json`; defaulting protects existing users and surfaces Claude.ai's error messages for garbage input]
**Consequence:** unknown JSON produces a *Claude.ai-flavored* error; a heterogeneous file is classified by its **first element only**.

**Decision:** Dedup = conversation-id existence check, nothing else. No content hash, no updatedAt comparison, no merge.
**Evidence:** [CODE import.ts:69-73, :83]
**Consequence:** re-import never updates. A growing Claude Code session (same sessionId, more turns) is **skipped wholesale forever** — new turns are never ingested short of delete-and-reimport. Whether this is an immutability stance or a gap is fog; nothing documents an intent.
**Trade-off:** trivially safe idempotency for the static-export case; wrong model for append-only session files.

**Decision:** Skip-and-continue at item level, throw at file level, no reporting of dropped items.
**Evidence:** [CODE all three parsers' try/catch + console.warn]
**Consequence:** silent data loss is possible and unmeasurable from the UI.

**Decision:** Two-step non-transactional persistence (`bulkPutConversations` then `bulkPutMessages`), while deletes elsewhere use explicit transactions.
**Evidence:** [CODE import.ts:93-94 vs db/conversations.ts:41-52]
**Consequence:** a failure between the writes creates a conversation with `messageCount: N` and zero message rows — and because dedup is existence-only, **retrying skips it forever**. Permanent message-less conversation.

**Decision:** Everything parses on the main thread, whole-file in memory (detection got a worker; parsing didn't).
**Evidence:** [CODE claude-code.ts:19, JSZip.loadAsync]
**Consequence:** big imports freeze the UI; no cancel.

## Invariants and assumptions

- One `StoredConversation` per Claude Code JSONL file. [CODE]
- Every message's `conversationId` matches a conversation in the same batch (so the chunk filter can't orphan). [CODE]
- `conversationsAdded + conversationsSkipped === parsed.conversations.length`. [CODE]
- A detection failure cannot fail an import. [CODE autoAnalyze.ts:50-54]
- **Assumed: message `createdAt` values are valid and unique.** Same-timestamp Claude Code entries sort by random primary key — step order for detection is not guaranteed to match file order for same-second entries. [CODE + INFERRED]
- **Assumed: no duplicate conversation ids *within* one batch.** The dedup snapshot is taken before the loop, so dropping the same folder twice in one action double-writes messages (claude-code message ids never collide) while `bulkPut` dedupes the conversation row — `messageCount` then disagrees with actual rows. [CODE]

## Failure modes

1. **Append-only sessions never update** (see decisions) — probably the most consequential product-level gap in this territory.
2. **Partial store on failure** → orphaned/message-less conversations that re-import can't repair.
3. **Intra-batch duplicates double messages.**
4. **Claude.ai Invalid Dates** → stored-but-invisible messages (and NaN comparisons in the search sort).
5. **Silent uncounted drops** at every parser level.
6. **Unstable ids** where the source lacks them → every re-import creates a new conversation.
7. **Unbounded memory/main-thread freeze** on large files/folders; no cancel anywhere.
8. **`resumeFolder` with a stale handle**: `getRememberedHandle()` is not wrapped in try/catch — a rejecting read escapes as an unhandled rejection. [CODE useClaudeCodeFolder.ts:82]

## Tests and verification

What exists [TEST]:
- `claude-code.test.ts` (10) — malformed-line skip, metadata sweep regression (`101e063`), inline tool blocks, gitBranch.
- `chatgpt.test.ts` (19) — canonical-path pruning with exact counts, hidden-node skip, content-type dispatch, unix timestamps, envelope shapes, and the **sniffer regression tests** (Claude.ai arrays must not be misrouted).
- `provenance.test.ts` (3) — `providerMeta.sourceFilename` on all three parsers.
- `import.test.ts` (3) — **only `selectAutoAnalyzeIds`**. `importFiles`/`storeData` themselves: zero tests.
- Golden traces byte-compare committed JSONL fixtures and assert the parser stays normalizable — the closest thing to an ingestion contract test.

**Untested, notably:** the entire **Claude.ai parser** (no dedicated test file — the richest, least-guarded parser has the least coverage); `parseFile` routing; dedup/idempotency (the user-visible promise!); chunk boundaries; the non-transactional write; both hooks; the directory walker.

## Visual map

```
 DropZone ─┐                          ┌─ parseClaudeCodeJSONL (.jsonl, 1 conv/file)
 Folder ───┼─ handleFiles ─ parseFile ┼─ sniff ─ parseChatGPTJSON (mapping tree → canonical path)
 picker    │   (sequential,           └─ else → parseClaudeAIJSON (default bias)
           │    all-or-nothing)                       │
           │                                          ▼
           │                    ParsedData ── storeData ── conversations ┐ two writes,
           │                    (dedup: id-existence only)  messages ────┘ no transaction
           │                                          │
           └──────────────── UI progress ◄────────────┼──► autoAnalyze (claude-code only,
                                                      │     awaited, invisible)
                                        invalidateIndex() → search rebuilds lazily
                            dailyStats: NEVER touched → Analytics stays stale
```

## Suggested walk

1. Start at `ImportPage.tsx` — note the two DropZone configs and the folder-picker gating.
2. Read `useImport.ts` end to end (60 lines). Predict: what happens if `storeData` throws halfway?
3. Read `parsers/index.ts:94-125` (`parseFile` + `sniffJSONContent`). Before reading the sniffers, predict how you'd distinguish a ChatGPT export from a Claude.ai one.
4. Read `parseClaudeCodeContent` + `parseEntries`; find where message ids come from, and what happens to a `system` entry.
5. Read `storeData` (`import.ts:64-111`); stare at the `existingIds` snapshot and the two bulk writes. Predict the intra-batch duplicate behavior, then convince yourself from the code.
6. Skim `chatgpt.ts:153-243` for the canonical-path walk — the most algorithmically interesting parser.
7. Finish with `import.test.ts` and notice how little of what you just read is covered.

## Ownership challenge

Make re-import of a **grown Claude Code session** merge instead of skip: detect an existing conversation id, compare message counts (or last timestamps), append only the new tail, update `messageCount`/`updatedAt`/`fullText`, and invalidate findings staleness. Add the test that `import.test.ts` is missing. (Smaller variant: just add a NaN-date guard to `claude-ai.ts` with a test containing an unparseable `created_at`.)

## Fog

- ? Is re-import-never-updates a deliberate immutability stance or an unhandled case? Nothing documents it.
- ? Are intra-batch duplicates (same folder dropped twice in one action) an accepted edge case?
- ? Where should `lastSync.*` metadata be persisted? The keys are declared, never written.
- ? Were `activities`/`dailyStats` meant to be populated by import after the extension path was dropped, or abandoned?
- ? Do real Claude Code logs still emit top-level `tool_use` entries, or is that path fixture-only legacy?
- ? Are the dead exports (`detectFileFormat`, `parseClaudeAIZip`, `parseChatGPTZip`, the `isXxx` predicates) intended public API for something (CLI? extension?) or removable?
- ? What's the intended scale ceiling before main-thread parsing becomes unacceptable — and should parsing join detection in a worker?
- ? `codex` is a selectable source across the UI with no parser — placeholder with a plan, or dead enum?
