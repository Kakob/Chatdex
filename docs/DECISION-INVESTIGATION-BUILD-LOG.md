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

Commit: `fa62c05`

## DI-2a — Investigate page: neutral anchor browser (2026-08-18)

**Built:**

- `/investigate` route + sidebar entry (`src/pages/InvestigatePage.tsx`, FileSearch icon). Rows show only literal metadata (spec §7.4): change-type chip, file path or `N files`, session name, timestamp, case-state chip (`Uninvestigated` for all until DI-2c), and a `legacy` provenance badge for pre-DI-1a anchors with a re-import hint. `Open source` deep-links to `/conversations/:id?scrollTo=<messageId>` (existing ConversationView support).
- Filters (`src/lib/investigation/filter.ts`, pure + tested): session, project path, change kind, case-insensitive **literal** path substring (regex metacharacters are text), inclusive local-day date range, case state. Ordering is chronological asc/desc only — no relevance ordering exists anywhere, by design.
- `anchorCaseState()` — the §8.1 state vocabulary (`uninvestigated | open | adjudicated`) stubbed constant until cases exist; the filter and UI already speak the full enum so DI-2c doesn't change their shape.
- Backfill: `deriveAnchorsForAllAgentSessions()` (idempotent, per-conversation failure counting, progress callback) wired to a "Derive anchors" button — this is how sessions imported before DI-1b get anchors without re-import.
- `src/hooks/useInvestigationAnchors.ts` — one-shot fetch + manual refresh, matching the app's existing non-reactive read pattern.

**Tests (+10; 597 frontend total):** all filter dimensions incl. literal-substring semantics and inclusive date bounds, file-label literalness, backfill covers agent sessions only + progress reporting. Production build verified.

**Known limits (by phase design):** `Start investigation` action absent until cases exist (DI-2c); anchor list is unvirtualized (fine at current scale; workbench virtualization lands in DI-2b); anchors don't auto-refresh when an import finishes while the page is open (app-wide non-reactive pattern).

**Next (DI-2b):** investigation workbench — new virtualized three-region reader (transcript / code event / case notebook) + literal in-source search with exact highlighting and match navigation.

Commit: `02259a1`

## DI-2b — Investigation workbench (2026-08-18)

**Built:**

- `/investigate/:anchorId` route (`src/pages/InvestigationWorkbenchPage.tsx`, anchor ids URL-encoded — they contain `#`). Three regions per spec §8.2: transcript, code event, case notebook; side-by-side on wide screens, labeled tabs below `lg`. Each region scrolls independently. Anchor rows on the Investigate page gained `Open workbench`.
- **Transcript reader** (`src/components/investigation/TranscriptReader.tsx`) — the app's first virtualized list (`@tanstack/react-virtual`, new dependency, dynamic row measurement). Renders the complete normalized step stream: prose always verbatim and in full; tool payloads collapsible but clearly labeled with exact character counts, always expanding to the original content; role/tool/step-ordinal/timestamp metadata visible per row; `code change` badges on anchor steps. Opens centered on the anchor's step.
- **Code event panel** (`CodeEventPanel.tsx`) — verbatim old/new (or written content) per file change, literal metadata only (tool, step, timestamp, stable key, tool-use id, source provenance). Clicking a tool call in the transcript with edit hunks selects it here (`Show in code panel`); `Show in transcript` scrolls back; `Back to anchor event` restores the primary event. No generated prose about code anywhere.
- **Literal in-source search** (`src/lib/investigation/search.ts` + `WorkbenchSearch.tsx`) — case-insensitive exact-substring over `stepDisplayText` (the same text the reader renders, so highlighting is character-exact); match count, prev/next with wraparound, jumping auto-expands collapsed payloads containing the current match. Fuse.js is not involved (spec §8.6 as amended).
- **Context service** (`src/lib/investigation/context.ts`) — `getInvestigationContext(anchorId)`: anchor + conversation + full step stream with per-step timestamps + sibling anchors (which also power the notebook's "code changes in this session" cross-navigation list). Notebook region otherwise explains that cases land next phase.
- Keyboard (spec §13, secondary to labeled controls): `/` focuses search, `j`/`k` step navigation, `[`/`]` match navigation; all ignored while typing in fields.

**Tests (+12; 609 frontend total):** search offsets (exact characters, regex-metacharacters-as-text, non-ASCII, adjacent repeats, empty-query), `stepDisplayText` contract per step kind, context assembly (full stream reachable, anchor-step alignment incl. toolUseId, timestamps, null for unknown/orphaned anchors). Production build verified; react-compiler lint kept at baseline (sync-setState effects refactored to derived state; one documented eslint-disable for the virtualizer's compiler opt-out).

**Known limits (by phase design):** exhibit pinning, review scopes, and the real notebook are DI-2c; search is scoped to the open source (cross-source search out of MVP, spec §8.6); regex mode deferred.

**Next (DI-2c):** cases, exhibits (transcript spans + code hunks with offset/hash locators), review scopes, case-scoped search records — the first synced entities (~7-edit plumbing each, spec §21 decision 4 keeps sourceEvents/anchors out of sync).

Commit: `a731b0c`
