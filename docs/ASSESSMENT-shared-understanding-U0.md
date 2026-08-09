# Repo Assessment — Shared Understanding Workspace (PRD §26)

Date: 2026-08-08
Gates: Stage U0 of `PRD-shared-understanding-workspace.md`

## 1. Current ingestion architecture

- **Entry point:** `importFiles()` in `src/lib/import.ts:21` → `parseFiles()` (`src/lib/parsers/index.ts:61`) → chunked bulk writes to Dexie (`src/lib/import.ts:68-84`) → auto-runs failure detection over new conversation IDs (`src/lib/import.ts:40`).
- **Format detection:** `detectFileFormat()` (`src/lib/parsers/index.ts:21`) recognizes three formats: Claude.ai ZIP, Claude.ai JSON, Claude Code JSONL. Adding a format means one detector predicate + one switch case — the dispatch is already pluggable in practice.
- **Parsers:** both emit the same shape `{ conversations: StoredConversation[], messages: StoredMessage[] }`:
  - `claude-ai.ts` handles ZIP path-hunting and several JSON envelope variants (`claude-ai.ts:68-91`), tolerates malformed conversations per-row.
  - `claude-code.ts` parses JSONL line-by-line, sweeps entries for `sessionId`/`cwd`/`gitBranch` (`claude-code.ts:55-70`); one file = one conversation keyed by sessionId.
- **Storage:** Dexie v2 schema (`src/lib/db/schema.ts:38-56`) — `conversations` indexed on `source, updatedAt, [source+updatedAt]`; `messages` on `[conversationId+createdAt]`.
- **Sync:** rows wrapped in `SyncEnvelope` (`src/lib/sync/serializer.ts:15`), encrypted client-side, pushed in batches of 200 (`engine.ts:421`) to a generic `sync_records` table where the server sees only `{id, kind, parentId, iv, ciphertext}` (`backend/src/db/schema.ts:78-112`).

## 2. Provider-neutral source abstraction — fits with minimal disruption

There is already a de-facto unified model: `src/types/unified.ts`. `StoredConversation` has `source: DataSource` where `DataSource = 'claude.ai' | 'claude-code'` (`unified.ts:3`), and `StoredMessage` has provider-neutral `sender` + `ContentBlock[]`. The abstraction exists; it needs widening, minimally:

- **Widen `DataSource`** to add `'chatgpt' | 'codex'`. Consumed in ~10 UI files (`ConversationCard`, `SearchFilters`, `TimelineFilters`, `ImportProgress`, `appStore`, etc.) — mostly icons/labels/filters, a mechanical sweep, not a redesign.
- **Provenance:** currently *not* retained — parsers discard the raw source after normalization. PRD §4 requires "raw source reference sufficient for later inspection." Recommend an optional `providerMeta` field on `StoredConversation` (or a parallel blob store) rather than reshaping messages. See payload-size caution (§7.3).
- **Provider-specific fields:** the pattern exists — `projectPath`/`gitBranch` are Claude-Code-only optionals (`unified.ts:36-38`). ChatGPT/Codex extras follow the same optional-field pattern; no Dexie migration needed (unindexed fields are free), and sync payloads are opaque JSON so the backend needs zero changes.
- **`MetadataKey`** hardcodes `lastSync.claude.ai | lastSync.claude-code` (`unified.ts:96-97`) — widen similarly.

**Disruption level: low.** No storage, sync, or backend changes required for U0 beyond type widening; `sync_records.kind` stays `'conversation' | 'message'` regardless of provider.

## 3. ChatGPT ingestion requirements

Official export ZIP contains `conversations.json` where each conversation is a **`mapping` node graph** (id → node with `parent`/`children` and an optional `message`), not a linear array. A parser must:

1. Reconstruct the canonical path — walk from `current_node` up to root (yields the "active" branch; siblings are edits/regenerations).
2. Map `author.role` (`user`/`assistant`/`system`/`tool`) → `MessageSender` (already supports all four, `unified.ts:41`).
3. Handle `content.content_type` variants: `text` (parts array), `code`, `execution_output`, `multimodal_text` (image pointers → `unsupported` block), `thoughts`/reasoning summaries → `thinking` block. `ContentBlock` (`unified.ts:8`) covers these adequately.
4. Timestamps are unix floats (`create_time`); some system/hidden nodes have `null` messages — skip them.

**Gaps:** (a) **branches** — v1 keeps only the canonical path; store branch count in provider meta so the discarded evidence is at least visible. (b) **ZIP disambiguation** — both Claude.ai and ChatGPT ZIPs contain `conversations.json`, so `detectFileFormat` (`parsers/index.ts:22`) needs content-sniffing (mapping-graph vs array-of-`chat_messages`), not filename matching. This is the main touchy edit in existing code; needs Claude.ai regression tests.

## 4. Codex ingestion requirements

**Unknown — flagged, not guessed.** No `~/.codex` directory exists on this machine, so real session files could not be inspected. Codex CLI writes JSONL session/rollout files under `~/.codex/sessions/`, but the schema is not formally documented and has changed across releases. **Recommendation:** defer Codex to a later U0 sub-phase gated on obtaining a real sample file; do not write a parser against an assumed schema. PRD §21 permits this — U0's success criterion names only Claude + ChatGPT.

> **U0.3 spike outcome (2026-08-08): blocked, deferred.** Re-verified — no `~/.codex` on this machine. The Codex parser is deferred until a real sample exists. To unblock: run Codex CLI once on any task, then point Chatdex development at the resulting `~/.codex/sessions/**/*.jsonl` file (sanitize before committing any fixture derived from it). The `DataSource` union, UI surfaces, and import pipeline already accept `'codex'`, so the remaining work is one parser + one format-detection predicate.

## 5. Reuse vs. Claude-specific assumptions

**Reusable as-is:**

- Dexie tables + all `src/lib/db/` helpers (provider-agnostic, keyed on `source` string)
- Entire encryption/sync stack — envelopes, batching, `sync_records` (opaque ciphertext; server has no domain knowledge)
- Search — Fuse index over `name/summary/fullText` (`search.ts:19-31`), with existing per-source filter (`search.ts:120`). Free tier caps: 100 conversations searched, 10k index ceiling (`search.ts:33,43`) — a large ChatGPT history could approach the latter.
- Import UI flow / progress reporting

**Needs attention:**

- `autoAnalyzeConversations` runs detectors over **every** imported conversation with no source gate (`import.ts:40`). Detectors are tool-call-oriented; running them on ChatGPT chat history is wasted work at best, noise findings at worst. U0 gates auto-analysis to `claude-code` sources.
- UI components with per-source branding (~10 files) need chatgpt/codex cases.
- `parseFiles` returns a single `primarySource` per import batch (`parsers/index.ts:67`) — cosmetic, but mixed-provider imports misreport.

## 6. Proposed U0–U2 phase plan (one phase per session)

| Phase | Content | Payoff |
|---|---|---|
| U0.1 | Widen source model + `MetadataKey`, add provenance field, sweep UI consumers, gate auto-analysis to claude-code | groundwork (keep small) |
| U0.2 | ChatGPT parser (`parsers/chatgpt.ts`), content-sniffing format detection, canonical-path traversal, fixture tests | **U0 success criterion: ChatGPT history browsable/searchable next to Claude** |
| U0.3 | Provenance polish + Codex sample spike (parser or documented blocker) | Codex unblocked or explicitly deferred |
| U1.1 | Understanding/project schema: new Dexie tables + sync kinds + serializers; invariant tests first (mirroring observability I0) | foundation |
| U1.2 | Project-discovery analysis over imported conversations | **⚠ blocked on privacy decision (below)** |
| U1.3 | Association review UI (accept/correct project associations) | correction loop |
| U2.1 | Current Understanding panel, read-only: direction, ideas/decisions, questions, recent changes | **experiential milestone (PRD §21 U2)** |
| U2.2 | Provenance navigation: object → evidence → conversation → messages | PRD §9 navigation chain |

### The AI-analysis / privacy tension (decide before U1.2, not before U0)

CLAUDE.md's invariants say detection is client-side-only and "no plaintext leaves the client" — written for the detector layer but phrased globally. Project discovery and understanding synthesis at PRD quality almost certainly require LLM calls; purely lexical clustering (TF-IDF / in-browser embeddings) is feasible for U1.2 but will not deliver PRD §7-quality synthesis for U2. PRD §16 contemplates provider SDKs with user-owned auth; PRD §21 "later stages" defers LLM classification.

**Options:**
- (a) Local/lexical only for U1–U2; LLM synthesis later under an explicit spec amendment.
- (b) Amend the privacy invariant now to permit user-initiated calls to user-authenticated model providers — noting that plaintext going to "their own AI provider" is only true per-provider: sending ChatGPT history to Anthropic (or vice versa) is a **new disclosure**.

This needs an explicit decision from Jacob and probably a CLAUDE.md/spec amendment before U1.2.

> **Decision (2026-08-09): option (b), extended.** Jacob chose to sequester the
> client-side-only guarantee to the detection layer and permit user-authenticated
> LLM provider calls for synthesis — including **backend relay** (transit-only:
> no plaintext persistence or logging server-side), reflecting a strategic move
> away from the client-side-only power-user framing toward robust provider
> interactions. CLAUDE.md invariants amended accordingly (see "AI synthesis
> boundary", invariant 6): user-initiated/opt-in, transit-only relay, explicit
> cross-provider disclosure. **U1.2 is unblocked.**

## 7. PRD assumptions vs. codebase conflicts

1. **"Project" name collision:** PRD "projects" (reconstructed from conversations) ≠ `StoredConversation.projectPath` (Claude Code cwd, `unified.ts:36`) ≠ aipkms `Workspace` (`src/lib/aipkms/workspaces.ts`). Pick a distinct name (e.g. `UnderstandingProject`) or reuse/extend aipkms workspaces deliberately.
2. **Client-side-only invariant vs. AI synthesis** — the central conflict, §6 above.
3. **Raw-source retention isn't free:** conversations already embed `fullText` (whole transcript duplicated per row, `unified.ts:34`) and each row syncs as one encrypted blob. Full raw ChatGPT node-graphs on the same row could double payload sizes; prefer a separate opaque-blob store or pointer + pruned branches.
4. **Free-tier/search limits** (100-conversation cap, 10k index) predate a multi-provider corpus. Not a U0 blocker; monitor.
5. **Auto-detection on import** assumes all imports are agent sessions — source-gate in U0.1.
6. **Filename-based format detection** would misroute ChatGPT ZIPs today (both providers ship `conversations.json`) — U0.2 fixes detection with regression tests for existing Claude.ai users.
7. **PRD §3 honored:** nothing requires redesigning around detectors; the observability layer is additive and stays untouched.

## Verdict

**U0 can start.** The single decision needed before U1.2 (not before U0) is the AI-analysis/privacy-invariant question.
