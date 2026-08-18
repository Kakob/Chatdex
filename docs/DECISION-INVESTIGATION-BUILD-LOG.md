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

Commit: (pending)
