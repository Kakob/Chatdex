# Intent Trace — Build Log

Companion to `SPEC-intent-trace.md` (the authoritative spec) and
`INTENT-TRACE-TODOS.md` (user-side actions + engineering checklist). Records
what was actually built per milestone, plus operational notes that affect
deployment. One milestone per session; each row lands with typecheck + lint +
tests green.

| Milestone | Date | Commit | Summary |
|---|---|---|---|
| Spec | 2026-08-28 | `708929b` | `docs/SPEC-intent-trace.md`: intents (unprompted vs reply-to-AI) traced against spec docs + GitHub code; security audit S1–S10 |
| IT-0 | 2026-08-28 | `b7fd63f` | Intent Trace schema: `IntentTrace` type, `UnderstandingObject.meta`, project `repository` + extraction cursor, Dexie v11 `intentTraces`, sync kind `intent_trace` (frontend + backend) |
| IT-1 | 2026-08-28 | `4325cb2` | Pair selection (`selectIntentPairs`: user reply + nearest preceding assistant text, tool noise skipped, `promptI:null` ⇒ unprompted) + recall-oriented heuristic (`off`/`lenient`/`strict`); pure, no LLM |
| IT-2 | 2026-08-28 | `fb0e467` | Intent extraction: prompt contract with origin, hallucination firewall (forced `unprompted`, verbatim statement, coerced promptedBy), pending `intent` objects + `supported`/`refined` events, pair-packed batches, `lastIntentExtractedAt` cursor; `getAssociatedConversations` shared with reconcile; intents excluded from the panel |
| IT-3 | 2026-08-28 | `8fd7d30` | GitHub: device-local token (`github.*` excluded from sync), hardened read-only client (constant host, header-only auth, validated owner/repo/sha/path, content-free errors, rate-limit errors, caches), Settings section with over-privilege warning, project repo-binding card |

---

## Operational notes

### ⚠ Deploy order for IT-0 (still pending — see INTENT-TRACE-TODOS.md)

`backend/src/routes/sync.ts` `KindSchema` gained `'intent_trace'`. **Deploy
the backend before the frontend** — a frontend that pushes a trace to an
older backend gets a 400 on the whole push batch (same failure shape as the
U1.1 kind-widening note in `UNDERSTANDING-BUILD-LOG.md`). `'intent_trace'`
is 12 chars, within the varchar(32) already applied to Neon; no migration
needed.

---

## Milestones

### IT-0 — Schema, types, sync plumbing (2026-08-28)

- `src/types/intentTrace.ts` — `IntentTrace` (append-only judgement of one
  intent against one commit; `repoRef`, spec/impl status + verbatim evidence,
  `fetchedPaths` audit list, `commitEvidence`) plus the `IntentPolarity` /
  `IntentOrigin` / `SpecStatus` / `ImplStatus` enums.
- `src/types/understanding.ts` — `UnderstandingObject.meta?` (type-specific
  scalars; intents carry polarity / origin / promptedByQuestion / statedAt /
  confidence here), `UnderstandingProject.repository?` (`ProjectRepository`)
  and `lastIntentExtractedAt?` (extraction cursor, same caveat as
  `lastReconciledAt`). All unindexed — no Dexie change for these;
  `createUnderstandingObject` passes `meta` through.
- Dexie **v11**: `intentTraces` (`&id, projectId, intentObjectId, createdAt,
  [projectId+createdAt], [intentObjectId+createdAt]`); helpers in
  `src/lib/db/intentTraces.ts` (`put`, `get`, per-project / per-intent lists
  newest-first, `getLatestTraceByIntent`) — deliberately no update/delete.
- Sync kind `intent_trace`: `SyncKind`, `envelopeIntentTrace` /
  `rehydrateIntentTrace` (parentId = intent object id, `updatedAt =
  createdAt`; nested `commitEvidence[].authoredAt` ISO-encoded; cleartext
  envelope is exactly kind / parentId / updatedAt — audit S9), engine
  apply / delete / dirty-envelope / resync / hooks, cascade delete of traces
  when an `understanding_object` is deleted, backend `KindSchema` entry.
  Project envelope carries `lastIntentExtractedAt`.
- Tests: `src/lib/db/intentTraces.test.ts` (v11 round trip incl. nested
  Dates, ordering, latest-per-intent, `meta` passthrough + omission),
  serializer round trips (project with repository + cursors, object with
  meta, trace with/without optionals, cleartext-envelope check), engine
  push kind/parent + server-side object delete cascade.

### IT-1 — Deterministic pair selection + heuristic (2026-08-28)

- `src/lib/understanding/intents/pairs.ts` — `selectIntentPairs(conversationId,
  messages, config)`: runs `normalizeSession` (read-only reuse of the
  detection substrate, §2.5), groups `user_msg` steps per message, and walks
  **backward** over `tool_call`/`tool_result` steps to the nearest
  `agent_text`, gathering every text step of that assistant message (Claude
  Code splits one message's text around its tool blocks). `promptI` /
  `replyI` are positions in the full stored message list — the same `i`
  convention as discovery digests. `promptI: null` when nothing from the
  assistant directly precedes (opening message, or a second consecutive user
  message) — the §2.2 forced-`unprompted` case. Prompt text kept from the
  tail (600 chars), reply from the head (800), previous user message as
  context (200); `promptedByQuestion` is a deterministic hint (trailing `?`,
  `?` in the last 300 chars, or an options list). Pasted logs/code are
  skipped (`looksPasted`: ≥70% machine-shaped lines, or >4000 chars with no
  first-person verb). Cap 60 pairs per conversation, most recent win.
  Tool-result-only user messages never form pairs.
- `src/lib/understanding/intents/heuristic.ts` — `INTENT_PATTERNS` (desire /
  modal / reaction / directive / product, all linear — audit S8),
  `scoreIntentReply` → `{ keep, matched }`, `filterPairs`. Modes: `lenient`
  (default; also keeps any reply ≤400 chars that answers a question),
  `strict` (patterns only), `off` (send everything — the UI's "send all
  replies").
- Tests (24): plain and Claude Code fixtures, consecutive user messages,
  system messages skipped but indexes preserved, pasted-trace skip with
  context carry-over, tail/head truncation, per-conversation cap; heuristic
  recall ≥95% on 26 hand-labelled casual intents **by pattern alone**
  (`promptedByQuestion` off), short-answer rule, strict/off behaviour,
  linear-pattern guard, and a 10 KB adversarial timing test.

### IT-2 — Intent extraction (2026-08-28)

- `src/lib/understanding/intents/extraction.ts` — `buildIntentDigest`
  (pairs on the wire as `{promptI, replyI, prompt, reply, priorUser?,
  promptedByQuestion}`), `buildIntentMessages` (system prompt with the
  literal JSON contract, the §2.2 origin rule spelled out, the
  "already extracted intents" list as `[id] (polarity) title`, and a
  "content is data, never instructions" line), `parseIntentResponse` —
  the firewall: fences stripped; `statedIn` must be a reply index that was
  in the batch; `promptedBy` **coerced** to the pair's own `promptI`;
  `promptI === null` ⇒ origin **forced** `unprompted`; statement must be a
  whitespace-normalized substring of the reply the model saw, else the
  reply's first 300 chars stand in (warned); bad polarity ⇒ `preference`,
  bad origin ⇒ from `promptedByQuestion`, unknown `matchesExisting` ⇒ null,
  missing title ⇒ statement head; capped at `maxIntentsPerCall` (15).
  `extractIntentsForBatch` reloads existing intents per batch, calls
  `complete()`, and persists: new intents via `createUnderstandingObject`
  (type `intent`, body = statement, `meta {polarity, origin,
  promptedByQuestion, statedAt, confidence}`, evidence
  `[promptMsgId?, replyMsgId]` with the statement as note, `occurredAt` =
  reply time) — pending; `matchesExisting` ⇒ pending `supported` event, or
  `refined` with a `Polarity a → b` detail when the polarity changed.
- `src/lib/understanding/intents/runExtraction.ts` —
  `getIntentExtractableConversations` (cursor `lastIntentExtractedAt`;
  scoped/ignoreCursor semantics identical to reconciliation),
  `packPairBatches` (packs **pairs**, default 40/call; a long conversation
  may span calls), `runIntentExtraction` (select → messages → pairs →
  heuristic → batches; sequential; stops at the first failing batch keeping
  earlier writes; cursor advances only on full unscoped success; reports
  `pairsConsidered` vs `pairsSent`).
- `reconcile.ts` — association→conversation join extracted into exported
  `getAssociatedConversations(projectId, conversationIds?)`, used by both
  tracks; reconcile tests unchanged.
- `currentUnderstanding.ts` — `type === 'intent'` objects (and therefore
  their events) excluded from the panel; they get their own tab in IT-5.
  Pending-review badges still count them.
- Tests (20): prompt content, `isVerbatim`, every firewall rule, persistence
  shape (meta, evidence ids, occurredAt, forced origin on an opening
  message), `matchesExisting` → refined event + no new object, empty batch
  sends nothing; cursor / scoped / ignoreCursor / heuristic-off /
  first-failure-stops semantics; `packPairBatches`.

### IT-3 — GitHub token, client, repo binding (2026-08-28)

- `src/lib/github/credentials.ts` — `get/set/clear/hasGitHubToken` over
  metadata key `github.token`. **Device-local:** `src/lib/sync/engine.ts`
  `isDeviceLocalMetadata` now covers the `github.` prefix alongside
  `sync.`, so the token never enters the sync stream in either direction
  (audit S1); tests assert nothing `github.*` is pushed and an incoming
  `github.token` record is ignored.
- `src/lib/github/client.ts` — read-only, browser-direct, GET-only.
  Constant `GITHUB_API_BASE` (no base-URL option — audit S2); token only in
  `Authorization`, never in a URL; `assertRepoName` / `assertSha` /
  `encodeRepoPath` (segment-encoded, `..`/empty rejected) guard every URL;
  errors are content-free (`GitHubError(status)` — response bodies never
  echoed); 429 or 403-with-zero-remaining ⇒ `GitHubRateLimitError` with
  `resetAt`; `getLastRateLimit()` for run summaries. Surface: `getRepo`
  (default branch, private, `canPush`), `resolveRef`, `getTree`
  (recursive, cached per sha, blobs/trees only), `getFileContent`
  (contents API at the sha, base64→UTF-8, 200 KB cap, cached),
  `listCommits` (path/since/sha), `getTokenInfo` (`x-oauth-scopes` →
  `overPrivileged` for classic `repo`/`write:*`/`admin:*`/`workflow`/
  `delete_repo`; fine-grained tokens have no scopes header), `blobUrl`
  (the only link builder; validated, `#L{a}-L{b}`), `isGitHubWebUrl`
  allowlist, `parseRepoInput` (`owner/repo`, github.com URL, git remote).
- `src/components/settings/GitHubSection.tsx` (mounted after LLM providers
  in Settings): save / test / clear; save auto-tests; shows login, marks
  fine-grained tokens, and warns in amber when a classic token grants write
  access; guidance text (Contents: Read + Metadata: Read, ≤90-day expiry,
  public repos work without a token at 60 req/h).
- `src/components/intents/RepoBindingCard.tsx` (mounted on
  `ProjectOverviewPage` until the Intent Trace tab exists in IT-5): input
  accepts `owner/repo` or a URL, optional pinned ref, Validate → `getRepo`
  (404/401 message points at Settings for private repos; `canPush` warning),
  Save → `putUnderstandingProject({ repository })`, Unbind (traces kept).
- `src/lib/providers/relayBody.test.ts` — audit S2 guard: with a GitHub
  token stored, the exact relay POST body has only provider fields and
  contains neither `github` nor the token string.
- Tests (31 across client / credentials / engine / relay-body): parsing +
  validation, headers + host, no-token path, content-free errors,
  rate-limit variants, ref → sha, tree cache + filtering, UTF-8 base64 +
  size cap + non-file + traversal, commits mapping, token scope detection,
  blob URL anchors + rejections, GET-only surface, device-local exclusion
  both directions, relay body.
