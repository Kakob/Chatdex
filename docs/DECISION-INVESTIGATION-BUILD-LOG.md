# Decision Investigation — build log

Spec: `docs/SPEC-decision-investigation.md` (revised 2026-08-18 with integration decisions in §21). Phase order: DI-0 … DI-4 (spec §17). One phase per session.

---

## DI-0 — Repository reconciliation (2026-08-18)

Full-repo scan against `main` @ `84c3ee7`. Findings folded into spec §3 (verified baseline), §21 (ten integration decisions), and inline `[Integration 2026-08-18]` amendments. Baseline recorded: typecheck clean, 562/562 frontend tests passing.

Key calls: reuse detection-layer normalization as the event substrate; raw sources local-only (never synced); anchors derived, not stored; workbench search is new and literal (Fuse.js excluded); `investigationAnchors` naming (AIPKMS owns "anchors"); sources frozen at import for MVP.

## DI-1a — Parser fidelity + raw retention (2026-08-18)

**Built:**

- `ContentBlock.toolUseId` (`src/types/unified.ts`) — tool_use block `id` / tool_result `tool_use_id`, preserved by both the Claude Code and Claude.ai parsers (previously read and discarded). Pairing for pre-existing imports falls back to positional adjacency until re-import.
- Parser version constants: `CLAUDE_CODE_PARSER_VERSION` / `CLAUDE_AI_PARSER_VERSION` = `1.1.0` (the toolUseId change), `CHATGPT_PARSER_VERSION` = `1.0.0`.
- `RawSource` (`src/types/investigation.ts`) + Dexie v5 `rawSources` table (`&id, &contentHash, importedAt, *conversationIds`) — immutable, content-addressed (SHA-256 via `src/lib/utils/hash.ts`), **local-only: intentionally not hooked into the sync engine**.
- `src/lib/db/rawSources.ts` — `storeRawSources` (hash-deduped, append-only), lookups by hash/conversation, `verifyRawSource` integrity check.
- Import wiring (`src/lib/parsers/index.ts`, `src/lib/import.ts`): every parsed file's verbatim payload (for ZIPs: the extracted `conversations.json`) is captured per-file and persisted *before* the normalized writes and *independently of conversation dedup* — a grown session file whose conversation is skipped still records a new raw version. `ImportResult.rawSourcesAdded` reports it.

**Tests (+16, all green; 578 frontend total):** parser toolUseId preservation (present + absent), SHA-256 published vectors + non-ASCII determinism, raw-store idempotency / new-version-on-change / multiEntry lookup / tamper detection, and end-to-end `importFiles` retention including the grown-session case.

**Not done here (next: DI-1b):** persisted source events (Step model + tool-pair alignment), derived investigation anchors with stable keys (source hash + ordinal + change index), golden-trace anchor fixtures.

Commit: `9af4f06`

## DI-1b — Derived investigation anchors (2026-08-18)

Completes spec milestone M1 (deterministic anchors; every anchor opens its exact source event via `messageId`/`stepIndex`).

**Built:**

- `Step.toolUseId` (`src/lib/detection/normalize.ts`) — the normalized step stream now carries the source-provided pairing id through from ContentBlock; additive, detectors untouched.
- `src/lib/investigation/anchors.ts` — `deriveAnchorsForConversation()`: one anchor per structured edit hunk group (Edit / Write / MultiEdit / NotebookEdit), derived from the detection layer's `normalizeSession` (shared substrate, §21 decision 1). Shell commands never anchor. `ANCHOR_DERIVER_VERSION = 1.0.0` stamped on rows.
- **Stable keys** = `{rawSourceContentHash}#s{stepIndex}` (anchor id ≡ stableKey → idempotent re-derivation). Pre-DI-1a conversations with no retained raw fall back to `conv:{conversationId}#s{n}` and are marked `sourceProvenance: 'legacy'` until re-imported — pragmatic deviation from spec §7.3, recorded here.
- Per-change `contentHash` (SHA-256 over NUL-separated path/old/new, with an explicit absent-vs-empty oldString marker) for future exhibit integrity checks.
- Dexie v6 `investigationAnchors` (`&id, conversationId, occurredAt, *filePaths`) — derived, **local-only, never synced**; replaced atomically per conversation; cascaded on conversation delete (rawSources deliberately not cascaded — a raw payload can back many conversations; deletion policy is a §14 open item).
- Import wiring: anchors derive automatically after detection for new claude-code sessions; derivation failure never fails an import.

**Tests (+9; 587 frontend total):** raw-hash stable keys, legacy fallback, MultiEdit parent/child ordering, Write-vs-empty-Edit hash distinction, shell-command exclusion, idempotent re-derivation, chronological + per-file listing, delete cascade, and end-to-end anchors from `importFiles`.

**Next (DI-2a):** Investigate route — chronological anchor browser with metadata filters (project/session/date/path substring/change type/case state), backfill derivation trigger for pre-existing conversations.

Commit: (pending)
