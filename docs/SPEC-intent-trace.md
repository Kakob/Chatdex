# Chatdex Intent Trace — Specification

**Status:** Claude Code implementation handoff — drafted **2026-08-28** from an approved plan (exploration + design + security audit in one planning session). Integration decisions are recorded in §19 and folded into the affected sections.

**Scope:** One complete vertical slice — a fourth project-workspace tab that extracts the user's stated intents from conversation history, records whether each intent was raised unprompted or in reply to the AI, and traces each one against spec documents and the implemented code in a GitHub repository.

**Primary user:** A solo software builder who delegates implementation to AI coding agents and talks about what the software should do across Claude.ai, ChatGPT (web + mobile), Claude Code, and Codex.

**Working feature name:** Intent Trace

**Track:** Shared Understanding Workspace (PRD §19 "Software-development direction"); builds on the project-workspace golden path (`dc7c5d6`).

---

## 0. Instructions to Claude Code

Implement this feature inside the existing Chatdex repository. Extend the shared-understanding layer (`src/lib/understanding/`), the project workspace (`/projects/:id`), the Dexie schema, and the encrypted sync pipeline. Do not build a parallel knowledge system and do not touch `src/lib/crypto/`.

Before changing code:

1. Read `CLAUDE.md` (hard invariants — especially invariant 6, the AI synthesis boundary), `docs/PRD-shared-understanding-workspace.md` §7, §9, §11, §19, `docs/UNDERSTANDING-BUILD-LOG.md` (how the understanding track was built), and `docs/INTENT-TRACE-BUILD-LOG.md` (this track's progress).
2. Read the modules this spec reuses (§3, §12): `src/lib/understanding/discovery.ts`, `reconcile.ts`, `runDiscovery.ts`; `src/lib/db/understanding.ts`; `src/lib/detection/normalize.ts`; `src/lib/providers/{relayClient,credentials}.ts`; `src/lib/sync/{serializer,engine,syncApi}.ts`; `src/components/understanding/*`; `src/pages/ProjectUnderstandingPage.tsx`.
3. Run `npm run typecheck && npm run lint && npm run test:all` and record the baseline.
4. Build the milestones in §15 in order, **one milestone per session**, each ending with typecheck + lint + tests green and a row in `docs/INTENT-TRACE-BUILD-LOG.md`.

The names in this document are semantic contracts; follow repository conventions for file and table names where they differ. Stop and ask only if repository reality makes a required behavior impossible, if a destructive migration would be needed, or if a product law below would have to be broken.

Do not commit or push without confirmation. Never run `drizzle-kit push` for column-type changes on `sync_records` (see build log).

---

## 1. Product thesis

The transcripts contain the user's requirements in their natural form: casual, incremental, often stated as a reaction — "I want the badge on the sidebar", "no, don't do that", "it should never auto-accept". Nobody writes them down. The spec (when one exists) and the code drift away from them silently, and the user ends up being the only index of what they actually asked for.

Intent Trace closes PRD §19's loop one step at a time:

```
Chats → stated intents (with origin) → spec status → implementation status → human review
```

It answers three questions per intent, with evidence the user can open:

1. **What did I ask for, and was it my idea or a reply to the AI's question?**
2. **Is it written down anywhere (spec / PRD / README) — and does the doc agree?**
3. **Is it actually in the code at a specific commit — and where?**

The output is a triage matrix, not a verdict. Every AI-produced row lands pending human review, carries verifiable evidence, and says `unknown` rather than guessing.

---

## 2. Non-negotiable product laws

These outrank convenience and speed.

### 2.1 Evidence law
Every intent cites the real message(s) it came from (`EvidenceRef` with `conversationId` + `messageIds`), and every spec or implementation status cites a verbatim quote that is a substring of the fetched document or file at a pinned commit. A status with no surviving evidence is downgraded (`unknown` / `unspecified`), never invented.

### 2.2 Origin law
Every intent records `origin`: `unprompted` (the user raised it themselves — an opening message or a new want mid-conversation) or `response_to_ai` (the user answered or reacted to something the assistant asked or proposed). When no assistant text precedes the user message, origin is **forced** to `unprompted` mechanically; the model may not override it.

### 2.3 Review law
All AI output — intent objects, support/refine events, trace rows — lands `pending` and changes nothing until a human accepts it (PRD §11). Nothing auto-accepts, bulk or otherwise.

### 2.4 Read-only repository law
GitHub is read via `https://api.github.com` only, with a user-supplied token that is stored device-locally and sent nowhere but GitHub. Chatdex never writes to a repository, never clones, and never persists whole files — only `commitSha`, paths, line ranges, and capped quotes.

### 2.5 Boundary law
The detection layer (`src/lib/detection/`) and Decision Investigation (`src/lib/investigation/`) gain no network path and no import of this feature. `normalizeSession` is reused read-only. The LLM relay stays transit-only and unchanged.

### 2.6 Disclosure law
Before any content leaves the client, the user sees what is sent to which provider. Repository file excerpts are a **new disclosure category** and are named as such in plain words (invariant 6, amended by this spec — §13.3).

---

## 3. Known baseline and integration assumptions

Verified against the repository on 2026-08-28 (branch `feature/project-workspace-golden-path`):

- **Parsers:** Claude.ai export, Claude Code JSONL, ChatGPT export (`src/lib/parsers/`). `codex` exists as a `DataSource` but has **no parser**; Jacob's Codex use is web/cloud + ChatGPT mobile, so Codex-cloud transcripts are out of scope (no export exists). ChatGPT-mobile chats arrive via the ChatGPT export.
- **Unified model:** `StoredConversation` / `StoredMessage` (`sender: 'user'|'assistant'|'system'|'tool'`, `contentBlocks`), ordered by `[conversationId+createdAt]`; `getMessagesForConversation(id)` returns chronological. `normalizeSession(sessionId, messages)` → `Step[]` (`user_msg | agent_text | tool_call | tool_result`).
- **Understanding graph:** `UnderstandingProject`, `ProjectAssociation`, `UnderstandingObject` (open `type` string — PRD §7 already lists `requirement`/`specification`), `UnderstandingEvent` (append-only, `EvidenceRef[]`). `createUnderstandingObject` is atomic with its `introduced` event and rejects AI-origin objects without evidence. Review UI: `ReviewButtons`, `EvidenceLinks` (`/conversations/:id?scrollTo=messageId`), `HistoryDrawer`; badges via `pendingReviews.ts`.
- **LLM synthesis:** `complete(provider, { model?, messages })` from `src/lib/providers` over the transit-only relay; prompt-instructed JSON + hallucination firewall (`parseDiscoveryResponse`); batching + `buildDisclosure` + `DisclosureModal` in `runDiscovery.ts`. Subscription bridge: Anthropic via Agent SDK (`tools: []`, tmpdir), OpenAI via Codex SDK (read-only, tmpdir, ~14k tokens fixed overhead per call). No JSON mode, no retries, no cost estimate (known backlog).
- **Sync:** ciphertext-only; new kinds need `SyncKind`, serializer envelope/rehydrate, engine apply/delete/resync cases, and the backend `KindSchema` enum. Metadata under the `sync.` prefix is device-local (`engine.ts:76`); everything else in `metadata` (including `llm.apiKey.*`) syncs encrypted.
- **Project workspace:** `/projects/:id` → `ProjectWorkspaceLayout` with tabs Investigate History / Current Understanding / Prepare Change. `PreparedChangeRepositoryRef` is free-text and unverified — the only repo modeling today.
- **Security posture:** no raw-HTML rendering in `src/`; no markdown renderer; relay schema is a plain `z.object` (strips unknown keys); Fastify logs requests, not bodies; no secret-bearing files tracked in git; backend DB is Neon.

---

## 4. Outcome

On Jacob's own project (Chatdex, repo `Kakob/Chatdex`), the **Intent Trace** tab shows a reviewable matrix: one row per stated intent, with an origin chip (Unprompted / Reply to AI), a polarity chip (want / don't want / constraint / preference), the verbatim quote deep-linked to the message, a spec column (`specified` / `contradicted` / `unspecified` / `no_spec`), and an implementation column (`implemented` / `partial` / `not_implemented` / `diverged` / `unknown`) with file + line evidence linked to the GitHub blob at the traced commit.

---

## 5. Scope

### 5.1 In scope (v1)
- Intent extraction over a project's associated conversations from all ingested sources.
- Origin classification per intent (§2.2).
- Repository binding per project + GitHub token in Settings.
- Optional spec leg over spec-like markdown found in the repository.
- Implementation leg: retrieve-then-judge over files fetched at a pinned commit; commit history as secondary evidence.
- Append-only trace storage, synced; the Intent Trace tab with filters, review, evidence links.

### 5.2 Out of scope (v1)
- Codex-cloud transcript ingestion (no export exists); a local Codex rollout parser (Jacob has no local Codex sessions of interest).
- Agentic repository exploration (model-driven file browsing), GitHub code search, PR listing.
- Any repository write, spec authoring, PR creation, or spec generation from intents (PRD §19 "living specification").
- Backend GitHub proxy; GitHub OAuth (PAT only).
- Multi-intent judge batching, cost estimation, retries/JSON mode (existing backlog).
- Intent-vs-intent contradiction detection (reconciliation's class of problem).
- CSP hardening of the hosted origin (pre-existing gap; noted in §13).

---

## 6. Vocabulary

- **Intent:** one statement by the user about what the software should or should not do, stored as an `UnderstandingObject` of `type: 'intent'`.
- **Polarity:** `want | dont_want | constraint | preference`.
- **Origin:** `unprompted | response_to_ai` (§2.2).
- **Pair:** a user message (the *reply*) plus the nearest preceding assistant text (the *prompt*), skipping tool noise. `promptI === null` when no assistant text precedes.
- **Trace:** one append-only judgement of one intent against one repository commit (`IntentTrace`).
- **Repo ref:** `{ owner, repo, commitSha, ref? }` — traces bind to an immutable sha, never a branch.
- **Spec leg / implementation leg:** the two comparison halves of a trace.
- **Candidate file:** a repository path selected for an intent by mention, anchor, or keyword channel.
- **Fetch gate:** the single policy point every fetched path passes through (§9.3).
- **Cursor:** `UnderstandingProject.lastIntentExtractedAt` — extraction only considers conversations newer than it (same caveat as `lastReconciledAt`).

---

## 7. Intent extraction

### 7.1 Pair selection (deterministic, no LLM) — `src/lib/understanding/intents/pairs.ts`

```ts
export interface IntentPair {
  conversationId: string;
  promptI: number | null;        // index of nearest preceding assistant text; null ⇒ no AI message precedes
  replyI: number;                // index of the user message (same `i` convention as discovery digests)
  promptText: string;            // tail of assistant text ≤ maxPromptChars (questions sit at the end)
  replyText: string;             // head of user text ≤ maxReplyChars
  priorUserText?: string;        // previous user message excerpt ≤ maxContextChars
  promptedByQuestion: boolean;   // assistant text ends with '?' or an options list — deterministic hint only
}
export interface PairSelectionConfig {
  maxPromptChars?: number;          // default 600
  maxReplyChars?: number;           // default 800
  maxContextChars?: number;         // default 200
  maxPairsPerConversation?: number; // default 60 — keeps the most recent
}
export function selectIntentPairs(conversationId: string, messages: StoredMessage[], config?: PairSelectionConfig): IntentPair[];
```

Algorithm: `normalizeSession(conversationId, messages)`; for each `user_msg` step walk **backward** over `tool_call` / `tool_result` steps to the nearest `agent_text` (the inverse of `scanForward` in `src/lib/detection/detectors/verificationAbsence.ts`), merging consecutive `agent_text` steps that share a `messageId` (Claude Code splits text around tool blocks). Map `step.messageId → i` via the ordered message list. **Every user message yields a pair**; an opening message has `promptI: null`. Skip user messages that are pasted logs/code (mostly indented or brace-led lines, or > 4000 chars without a first-person verb). `system` and `tool` senders never form pairs.

### 7.2 Heuristic pre-filter (recall-oriented, configurable) — `heuristic.ts`

```ts
export type HeuristicMode = 'off' | 'lenient' | 'strict';
export interface HeuristicConfig { mode?: HeuristicMode; extraPatterns?: RegExp[]; shortReplyChars?: number /* 400 */ }
export const INTENT_PATTERNS: RegExp[];   // documented defaults below
export function scoreIntentReply(pair: IntentPair, config?: HeuristicConfig): { keep: boolean; matched: string[] };
export function filterPairs(pairs: IntentPair[], config?: HeuristicConfig): IntentPair[];
```

Default patterns (linear, no nested quantifiers — §13 S8): first-person want/need/like/prefer/expect/mean/intend; should/shouldn't/must/never/always/instead/rather/only; leading no/nope/yes/yeah/not that/not quite/exactly/correct; don't/do not/stop/avoid/keep/make sure/let's; product nouns (feature, behav-, user, button, page, option, setting, default). `lenient` (default) keeps a pair if any pattern matches **or** `promptedByQuestion && reply.length <= shortReplyChars`. `strict` = pattern match only. `off` = send every pair (UI: "Send all replies — more thorough, more tokens").

### 7.3 Extraction (LLM) — `extraction.ts`

Mirrors `discovery.ts`: `buildIntentMessages(project, digests, existingIntents, maxIntents)` → `complete()` → `parseIntentResponse(...)` → persist.

Prompt contract (system message with a literal JSON schema; user message is `JSON.stringify({ conversations: digests })` where each digest carries its pairs):

```
{ "intents": [{
    "title": string,
    "statement": string,                 // verbatim quote from the reply
    "polarity": "want" | "dont_want" | "constraint" | "preference",
    "origin": "unprompted" | "response_to_ai",
    "conversationId": string,
    "promptedBy": number | null,         // the pair's promptI
    "statedIn": number,                  // the pair's replyI
    "confidence": number,                // 0..1
    "matchesExisting": string | null     // id from "Already extracted intents"
}] }
```

Rules given to the model:
- `origin` is `response_to_ai` only when the statement answers or reacts to something the assistant asked or proposed in `promptText`; a user raising a new want mid-conversation is `unprompted` even though an assistant message precedes it.
- `statement` must be verbatim from the `statedIn` reply. Skip replies that are about the conversation itself ("explain more", "continue").
- Prefer `matchesExisting` over a near-duplicate of an already-extracted intent.
- At most `maxIntentsPerCall` (default 15). Only reference `conversationId` and index values given in the input.

Firewall (`parseIntentResponse(text, knownPairs, knownExistingIds, maxIntents)`):
- Strip markdown fences; non-JSON ⇒ throw (batch fails loudly).
- `statedIn` ∉ the conversation's known reply indexes ⇒ drop + warn.
- `promptedBy` is **coerced** to the pair's own `promptI` (validated, never trusted).
- `promptI === null` ⇒ `origin` **forced** `unprompted` (§2.2); otherwise the model's value is kept.
- `statement` not a whitespace-normalized substring of the reply ⇒ replaced by the reply's first 300 chars + warn "statement not verbatim".
- `matchesExisting` ∉ presented ids ⇒ `null` + warn; invalid enums ⇒ documented defaults + warn.

Persistence:
- New intent → `createUnderstandingObject({ projectId, type: 'intent', title, body: statement, origin: 'ai', meta: { polarity, origin, promptedByQuestion, statedAt, confidence }, evidence: [{ conversationId, messageIds: [promptMsgId?, replyMsgId], note: statement }], occurredAt: reply.createdAt })` — lands `pending`.
- `matchesExisting` → `recordUnderstandingEvent({ objectId, op: 'supported' | 'refined' (when polarity differs, with `detail`), evidence, origin: 'ai', occurredAt })` — lands `pending`, reviewed in the existing proposals strip / history drawer.

### 7.4 Run orchestration + cursor — `runExtraction.ts`

- `getIntentExtractableConversations(projectId, ignoreCursor = false, conversationIds?)` — non-rejected associations → conversations newer than `lastIntentExtractedAt`, ascending by `updatedAt`. Refactor: extract the association→conversation join from `getReconcilableConversations` (`reconcile.ts`) into an exported `getAssociatedConversations(projectId)` used by both; reconcile tests must stay green.
- `runIntentExtraction(projectId, config, { onProgress })` — batches **pairs** (default 40 per call; a long conversation's pairs may split across calls), sequential, stops at the first failing batch keeping earlier writes (same policy as `runDiscoveryInBatches`), reloads existing intents between batches, advances the cursor only when every batch succeeded **and** the run was unscoped.
- `currentUnderstanding.ts` excludes `type === 'intent'` from the panel buckets (intents have their own tab); `pendingReviews.ts` counts them unchanged.

---

## 8. Repository binding and GitHub reading

### 8.1 Token — `src/lib/github/credentials.ts`
`getGitHubToken / setGitHubToken / clearGitHubToken` over `src/lib/db/metadata.ts`, key `github.token`. **Device-local:** extend `isDeviceLocalMetadata` in `src/lib/sync/engine.ts` to also match the `github.` prefix, so the token never enters the sync stream (§13 S1). Settings section (`src/components/settings/GitHubSection.tsx`, mounted after `LLMProvidersSection`): save / clear / test; guidance: fine-grained PAT, one repository, permissions **Contents: Read** + **Metadata: Read**, ≤ 90-day expiry; `gh auth token` for a quick start. On save, `GET /user` and inspect `x-oauth-scopes`: a classic token carrying `repo`, `write:*`, or `admin:*` is accepted but flagged "over-privileged — use a fine-grained read-only token"; a `getRepo` response with `permissions.push === true` triggers the same warning.

### 8.2 Client — `src/lib/github/client.ts`

```ts
export interface GitHubClientOptions { token?: string; fetchImpl?: typeof fetch }   // no baseUrl — constant https://api.github.com
export class GitHubRateLimitError extends Error { resetAt?: Date }
getRepo(owner, repo, opts)                         → { defaultBranch, isPrivate, htmlUrl }
resolveRef(owner, repo, ref, opts)                 → { sha }                                   // GET /repos/{o}/{r}/commits/{ref}
getTree(owner, repo, sha, opts)                    → { truncated, entries[{ path, type, size?, sha }] }   // recursive=1; cached per `${owner}/${repo}@${sha}`
getFileContent(owner, repo, path, sha, opts)       → { text, size, sha }                      // contents API; base64 → TextDecoder; reject > 200 KB; cached per sha+path
listCommits(owner, repo, { path, since, sha, perPage }, opts) → [{ sha, message, authoredAt, htmlUrl }]
blobUrl(owner, repo, sha, path, start?, end?)      → 'https://github.com/o/r/blob/sha/path#L10-L20'
```

Headers: `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `Authorization: Bearer <token>` when present (public repos work unauthenticated at 60/h — surface as a hint). Read `x-ratelimit-remaining`; 403/429 ⇒ `GitHubRateLimitError` with reset time. Validation: `owner`/`repo` match `^[A-Za-z0-9_.-]+$`; `path` segments are `encodeURIComponent`-ed and any `..` segment is rejected; `sha` matches `^[0-9a-f]{7,40}$`. Token only ever in the header, never in a URL. No `searchCode`.

### 8.3 Binding — `RepoBindingCard.tsx`
`UnderstandingProject.repository?: { owner, repo, defaultBranch?, pinnedRef? }`. Accepts `owner/repo` or a github.com URL; **Validate** calls `getRepo` and fills `defaultBranch`; optional pinned ref/sha; **Save** via `putUnderstandingProject`. Rendered at the top of the Intent Trace tab when unbound.

---

## 9. Trace engine — `src/lib/understanding/trace/`

### 9.1 Spec leg (optional) — `specDocs.ts`
`DEFAULT_SPEC_PATTERNS = ['docs/**/*.md', 'SPEC-*.md', 'PRD-*.md', 'README.md', 'CLAUDE.md']` (in-house glob → RegExp, no new dependency). `findSpecPaths(treePaths, patterns)`; `retrieveSpecExcerpts(intent, docs, { maxChars, windowLines })` — keyword overlap (tokens ≥ 4 chars, stop-word list) scored over headings and lines, returning numbered-line windows. **No spec docs in the tree ⇒ the spec section is omitted from the prompt and the trace records `specStatus: 'no_spec'` with no model involvement.**

### 9.2 Candidate files — `candidateFiles.ts`
- `extractMentionedPaths(texts)` — path regex over the intent's cited messages ±3 (`src/…`, `backend/…`, `docs/…`, bare `*.ts/tsx/md/json` names).
- `toRepoRelative(absPath, roots)` — strips `projectPath` / `workingDirectory` prefixes from `investigationAnchors.filePaths` for the intent's conversations (transcript-side edits; blind to Codex-cloud and manual edits).
- `rankTreePathsByKeywords(intent, treePaths, max)` — camelCase/kebab-split path segments vs intent tokens.
- `selectCandidateFiles(intent, ctx)` → `[{ path, reason: 'mentioned' | 'anchor' | 'keyword' }]`, precedence mentioned > anchor > keyword, default cap 8 files.
- `excerptFile(text, keywords, { maxChars 6000, windowLines 40 })` — numbered lines, keyword-centred windows joined by `…`, head fallback.

### 9.3 Fetch gate — `fetchPolicy.ts`
The single gate every fetched path passes through — candidates, model `suggestedPaths`, and user-typed "add file to check" alike:
- `SENSITIVE_PATH_PATTERNS` denylist: `.env*`, `*.pem`, `*.key`, `*.p12`, `*id_rsa*`, `*credentials*`, `*secret*`, `auth.json`, `*.keychain`, `.npmrc`, `.netrc` — never fetched; recorded in the trace warnings as "skipped (sensitive)".
- `EXCLUDED_DIRS`: `node_modules`, `vendor`, `dist`, `build`, `.git`, `coverage`, lockfiles, `*.min.*`, binaries by extension — never candidates.
- `scrubSecrets(text)` — redacts secret-shaped tokens (`ghp_…`, `github_pat_…`, `sk-…`, `AKIA…`, JWT-shaped, `-----BEGIN … PRIVATE KEY-----`) to `[REDACTED]` before any excerpt enters a prompt; redaction counts go to warnings.
- Excerpts are wrapped in explicit data delimiters (`<file path="…">…</file>`, `<spec path="…">…</spec>`) and the system prompt states that file, spec, and conversation content is untrusted data, never instructions.

### 9.4 Judge — `judge.ts`
`buildTraceMessages(intent, specExcerpts, codeExcerpts, treeSample)`; contract:

```
{ "spec":           { "status": "specified" | "contradicted" | "unspecified", "rationale": string, "evidence": [{ "path": string, "quote": string }] },
  "implementation": { "status": "implemented" | "partial" | "not_implemented" | "diverged" | "unknown", "rationale": string,
                      "evidence": [{ "path": string, "quote": string }], "suggestedPaths": string[] } }
```

Rules: quotes verbatim from the provided excerpts; cite only provided paths; if the relevant code is not among the excerpts answer `unknown` and list up to 5 `suggestedPaths` from the tree sample.

`parseTraceResponse(text, fetched, specFetched)` + `verifyCodeEvidence(ev, fetched)`: path ∈ fetched set; whitespace-normalized quote ⊂ file text; **line numbers recomputed from the quote's position (the model's numbers are ignored)**. Downgrades: `implemented | partial | diverged` with zero surviving evidence ⇒ `unknown` + warn; `specified | contradicted` with none ⇒ `unspecified` + warn; `suggestedPaths` ∩ tree paths; invalid enums ⇒ `unknown`.

### 9.5 Run policy — `runTrace.ts`
- `planTrace(projectId, config)` — resolves sha (`pinnedRef` or default branch head), fetches the tree, selects candidates and spec docs per intent — **before any LLM call** — and returns the counts/paths the disclosure shows.
- `runTrace(projectId, plan, config, { onProgress })` — default selection: non-rejected `type: 'intent'` objects lacking a trace at this sha (`getLatestTraceByIntent`). Per intent: fetch (cached, through the gate) → `assertNoSecrets(messages, [token])` → judge → verify → `putIntentTrace`. Sequential. A per-intent failure records a trace with `implStatus: 'unknown'` and the error in `warnings` (intents are independent; a partial matrix is useful); abort the run only on `GitHubRateLimitError` or relay auth failure.
- Caps (documented defaults, surfaced in the disclosure): `maxIntentsPerRun` 50; `maxTreeEntries` 50k (beyond: warn, keyword channel disabled); `maxFiles` 8; `maxCharsPerFile` 6000; stored quotes ≤ 500 chars. Only sha, paths, line ranges, and capped quotes are persisted — never whole files.
- `includeCommits` (default on, milestone IT-6): `listCommits({ path, since: meta.statedAt, sha })` for ≤ 3 evidence paths per intent → `commitEvidence` (deterministic, no LLM). This is the only reachable trace of Codex-cloud work.

---

## 10. User experience

### 10.1 Placement
Fourth tab in `ProjectWorkspaceLayout`: **Intent Trace** (`/projects/:id/intents`; icon `GitCompare`; order: Investigate History → Current Understanding → Intent Trace → Prepare Change).

### 10.2 Matrix
Rows = intents (pending and accepted; rejected hidden). Columns:
- **Stated** — source chip (`SourceIcon`), **origin chip** (`Unprompted` / `Reply to AI`), polarity chip, verbatim quote, `EvidenceLinks` to the prompt and reply messages, `ReviewButtons` while pending, history entry → `HistoryDrawer`.
- **Spec** — status chip; expandable doc path + quote; blob link at the traced sha.
- **Implementation** — status chip; expandable `path L{a}–L{b}` + quote + blob link; `suggestedPaths` shown as "not checked: …"; commit evidence labelled "commits touching this file after the intent was stated".
Filters: origin, polarity, spec status, implementation status, review state. Header: "Traced against `owner/repo@sha` (date)"; stale hint when the default branch head has moved (cheap `resolveRef` on load; failure tolerated).

### 10.3 Actions and disclosures
- **Extract intents** → `getIntentExtractableConversations` → `buildDisclosure(conversations, provider)` → `DisclosureModal` (`actionLabel="Intent extraction"`; heuristic mode selector incl. "send all replies"; auto-disclosed full re-run when the cursor yields nothing) → `runIntentExtraction` → progress → outcome toast (created / supported / pairs sent / warnings).
- **Trace against repo** — disabled with a stated reason until a repository is bound (and a token is set for private repos) → `planTrace` → `DisclosureModal` with `title="Send repository excerpts to {provider}?"` and `sendsDescription="{N} intent statements, excerpts of {M} files from {owner}/{repo}@{sha}, and {K} spec documents. Excerpts are stored with your understanding (encrypted in sync)."`; the conversation list still comes from `buildDisclosure` over the intents' evidence conversations so cross-provider transfer is flagged → `runTrace` → progress → summary with rate-limit remaining and a warnings panel.
- Per row (IT-6): re-trace this intent; "add file to check" (path goes through the fetch gate; stored only in the resulting trace's `fetchedPaths`).
- Codex-path hint: "The OpenAI subscription path adds ~14k tokens per call; prefer Anthropic for large runs."

### 10.4 States and help text
Empty (no intents yet / no repository bound / no token), running, partial-failure, rate-limited (with reset time), stale. Help text states the honest failure modes: non-greppable intents ("make it faster") mostly resolve to `unknown` — the matrix is triage, not verdict; big repositories truncate; Codex-cloud and manual edits are invisible except via commit history; a convincing quote can still mislead a reviewer — open the link.

### 10.5 Rendering rules
All quotes and paths render as text nodes (no raw HTML, no markdown renderer). GitHub links are built only by `blobUrl` / validated helpers, rendered with `rel="noopener noreferrer"`; API-returned `htmlUrl`s render only if they start with `https://github.com/`.

---

## 11. Conceptual data model

### 11.1 Additions to existing types (`src/types/understanding.ts`) — unindexed, no Dexie bump; serializer spreads carry them

```ts
// UnderstandingObject
meta?: Record<string, string | number | boolean>;   // intents: polarity, origin, promptedByQuestion, statedAt (ISO), confidence
// UnderstandingProject
repository?: { owner: string; repo: string; defaultBranch?: string; pinnedRef?: string };
lastIntentExtractedAt?: Date;                        // extraction cursor; same caveat as lastReconciledAt
```
`CreateUnderstandingObjectInput` gains `meta?` passthrough. Project envelope/rehydrate handle `lastIntentExtractedAt` like `lastReconciledAt`.

### 11.2 New — `src/types/intentTrace.ts`

```ts
export type IntentPolarity = 'want' | 'dont_want' | 'constraint' | 'preference';
export type IntentOrigin = 'unprompted' | 'response_to_ai';
export type SpecStatus = 'no_spec' | 'specified' | 'contradicted' | 'unspecified';
export type ImplStatus = 'implemented' | 'partial' | 'not_implemented' | 'diverged' | 'unknown';

export interface RepoRef { owner: string; repo: string; commitSha: string; ref?: string }
export interface SpecEvidence { path: string; startLine?: number; endLine?: number; quote: string }
export interface CodeEvidence { path: string; startLine: number; endLine: number; quote: string }
export interface CommitEvidence { sha: string; path: string; message: string; authoredAt: Date; url: string }

/** One append-only judgement of one intent against one repository commit. */
export interface IntentTrace {
  id: string;
  projectId: string;
  intentObjectId: string;
  repoRef: RepoRef;
  specStatus: SpecStatus;
  specEvidence: SpecEvidence[];
  specRationale?: string;
  implStatus: ImplStatus;
  implEvidence: CodeEvidence[];
  implRationale?: string;
  /** Model's "look here next" hints, intersected with the tree; not fetched. */
  suggestedPaths?: string[];
  commitEvidence?: CommitEvidence[];
  /** Exactly which files/docs were sent (audit; shown as "checked"). */
  fetchedPaths: string[];
  provider: 'anthropic' | 'openai';
  model: string;
  warnings: string[];
  createdAt: Date;
}
```

### 11.3 Storage
Dexie **v11**: `intentTraces: '&id, projectId, intentObjectId, createdAt, [projectId+createdAt], [intentObjectId+createdAt]'` — append-only; a new commit produces a new row (DetectorRun / VerdictRevision precedent). Included in `clearAllData()`. Cascade: deleting an understanding object deletes its traces.

### 11.4 Sync
Kind `intent_trace` (`SyncKind`, serializer envelope with `parentId = intentObjectId`, `updatedAt = createdAt`, ISO-encoded `createdAt` and `commitEvidence[].authoredAt`; engine apply/delete/resync cases; backend `KindSchema` enum — **deploy backend before frontend**). Cleartext envelope fields are exactly `{ kind, parentId, updatedAt }`; `repoRef` stays inside the ciphertext. `github.token` is device-local and never synced.

---

## 12. Application/service operations

| Module | Exports |
|---|---|
| `src/lib/understanding/intents/pairs.ts` | `selectIntentPairs`, `IntentPair`, `PairSelectionConfig` |
| `src/lib/understanding/intents/heuristic.ts` | `INTENT_PATTERNS`, `scoreIntentReply`, `filterPairs`, `HeuristicMode` |
| `src/lib/understanding/intents/extraction.ts` | `buildIntentMessages`, `parseIntentResponse`, `extractIntentsForBatch`, `IntentExtractionConfig` |
| `src/lib/understanding/intents/runExtraction.ts` | `getIntentExtractableConversations`, `runIntentExtraction` |
| `src/lib/understanding/reconcile.ts` | `getAssociatedConversations` (extracted, shared) |
| `src/lib/github/credentials.ts` | `getGitHubToken`, `setGitHubToken`, `clearGitHubToken` |
| `src/lib/github/client.ts` | `getRepo`, `resolveRef`, `getTree`, `getFileContent`, `listCommits`, `blobUrl`, `GitHubRateLimitError` |
| `src/lib/understanding/trace/specDocs.ts` | `DEFAULT_SPEC_PATTERNS`, `findSpecPaths`, `retrieveSpecExcerpts` |
| `src/lib/understanding/trace/candidateFiles.ts` | `extractMentionedPaths`, `toRepoRelative`, `rankTreePathsByKeywords`, `selectCandidateFiles`, `excerptFile` |
| `src/lib/understanding/trace/fetchPolicy.ts` | `SENSITIVE_PATH_PATTERNS`, `EXCLUDED_DIRS`, `isFetchAllowed`, `scrubSecrets`, `assertNoSecrets` |
| `src/lib/understanding/trace/judge.ts` | `buildTraceMessages`, `parseTraceResponse`, `verifyCodeEvidence` |
| `src/lib/understanding/trace/runTrace.ts` | `planTrace`, `runTrace`, `TraceConfig` |
| `src/lib/db/intentTraces.ts` | `putIntentTrace`, `listTracesForProject`, `listTracesForIntent`, `getLatestTraceByIntent` |
| UI | `IntentTracePage`, `IntentTraceTable`, `IntentTraceRow`, `RepoBindingCard`, `GitHubSection`; `DisclosureModal` gains `title?` |

---

## 13. Privacy, security, and offline behavior

### 13.1 Audit (2026-08-28)

| # | Risk | Severity | Disposition |
|---|---|---|---|
| S1 | GitHub PAT at rest in IndexedDB on the hosted origin; any XSS exfiltrates it (same class as LLM keys, but reads private repos). No CSP today. | High (pre-existing class, new asset) | Device-local storage; on-save scope check + over-privilege warning; fine-grained, single-repo, read-only, expiring token guidance. CSP is the real fix for the class — backlog. |
| S2 | Token leaking to a host other than api.github.com (configurable base URL, redirect, inclusion in relay body or prompt). | High | Constant base URL; header-only auth; `fetch` drops `Authorization` on cross-origin redirects; `assertNoSecrets` before every `complete()`; test that relay bodies never carry a GitHub field. |
| S3 | Prompt injection via repository/spec content (fixtures, vendored code, a merged stranger's PR). Bounded: no tools, enum + verified-quote outputs, pending review — but injected text could yield a plausible false `implemented` quoting itself. | Medium | Excluded dirs; delimited "content is data" prompting; UI always shows path + quote; unverified statuses downgrade; nothing auto-accepts. Residual documented in help text. |
| S4 | Sensitive files reaching the provider via model `suggestedPaths` or user-typed paths (`.env`, keys); secret-shaped strings in excerpts. | High | Single fetch gate with denylist; `scrubSecrets` on every excerpt; redaction counts in warnings. |
| S5 | Unbounded spend (one judge call per intent; Codex path +14k tokens/call); no rate limiting or cost estimate exists. | Medium | `maxIntentsPerRun` 50, count in disclosure; Anthropic hint; GitHub 403/429 abort with reset time. |
| S6 | Link/rendering integrity: blob links from partially user-originated `owner/repo/sha/path`; `target="_blank"` without `rel`. | Low–Medium | Validated builders only; `rel="noopener noreferrer"`; `htmlUrl` allowlisted; text-node rendering; regression test with a `<script>` quote. |
| S7 | Repository content at rest in Chatdex (quotes in plaintext IndexedDB, ciphertext Neon) — a new data class for private repos. | Low | Quotes ≤ 500 chars; never whole files; disclosure copy says excerpts are stored; cascade-delete with the intent. |
| S8 | ReDoS in heuristic regexes over adversarial text. | Low | Linear patterns; inputs pre-capped; 10 KB timing test. |
| S9 | Sync surface: new kind exposes `id`, `parentId`, `updatedAt`, ciphertext only. | Low | `repoRef` inside payload; test that cleartext fields are exactly `{kind, parentId, updatedAt}`. |
| S10 | Invariant boundaries (§2.5). | — | Guard test: no module under `src/lib/investigation/**` or `src/lib/detection/**` imports `src/lib/github/**` or `src/lib/understanding/{intents,trace}/**`. |

Not addressed here (pre-existing): CSP/hardening of the hosted origin; at-rest encryption of `metadata` credentials beyond the vault model; validating subscription login with a cheap ping.

### 13.2 Offline
Extraction and tracing require the relay and GitHub; the matrix, filters, review actions, and evidence links work offline from IndexedDB. Detection remains network-independent (untouched).

### 13.3 Invariant-6 amendment (to be applied to `CLAUDE.md` in IT-6)
"Repository file excerpts fetched from GitHub are user data and may be sent to the provider under the same user-initiated, disclosed, transit-only rule as conversation content. The GitHub token is sent only to api.github.com, never to the relay." The same read-only rule ("Repository cloning, writes, or deployment from Chatdex remain out of scope; read-only inspection via the GitHub API is allowed") now lives in `SPEC-change-workspace.md` §3 — the former `SEPTEMBER-1-SHIP.md` was retired 2026-08-28.

---

## 14. Required tests

- **IT-0:** Dexie v11 round trip with Date fields; serializer identity for `intent_trace` and for a project with `repository` + `lastIntentExtractedAt`; engine cascade on `understanding_object` delete; envelope cleartext fields (S9).
- **IT-1:** pairs — claude.ai fixture, Claude Code fixture with tool blocks between assistant text and reply, opening message → `promptI: null`, determinism, log-paste skipped; heuristic — ≥ 95 % recall on a ~25-line casual-intent fixture in `lenient`, `off` keeps all, 10 KB timing (S8).
- **IT-2:** mocked `complete` (`vi.mock('../../providers', …)` as in `discovery.test.ts`), asserting persisted rows: origin forced for opening messages, model origin kept otherwise, real evidence ids, non-verbatim statement replaced + warning, `matchesExisting` ⇒ pending event not object, cursor / scoped / `ignoreCursor` behaviour; reconcile tests unchanged after the `getAssociatedConversations` refactor.
- **IT-3:** client with injected fetch — headers, UTF-8 base64, tree cache, size cap, rate-limit error with reset, `blobUrl` format, owner/path/sha validation; credentials round trip; `github.` keys excluded from sync (S1); relay body never carries a GitHub field (S2).
- **IT-4:** spec pattern matching + retrieval; candidate ranking, anchor path normalization, excerpt line numbers; fetch gate denylist incl. suggested and manual paths, `scrubSecrets` (S4); judge quote verification drops paraphrases, recomputes lines, downgrades statuses; `no_spec` path omits the spec section; `runTrace` with mocked `complete` + fetch: persisted traces, `fetchedPaths`, skip-already-traced, per-intent failure isolation, `maxIntentsPerRun`.
- **IT-5:** RTL — rows render from Dexie, origin filter narrows, Trace disabled without binding, review click flips state, `<script>` quote renders escaped, malformed owner yields no link (S6); tab present in layout.
- **Guard (S10):** import-boundary test for detection / investigation.

---

## 15. Milestones

| Milestone | Deliverable | Acceptance |
|---|---|---|
| **Spec** | This document; `docs/README.md` index entry; `CLAUDE.md` pointer. | Committed on its own. |
| **IT-0** | Types, Dexie v11, `intentTraces` helpers, sync kind end-to-end (frontend + backend enum), `meta` / `repository` / cursor fields. | `npm run typecheck && npm run lint && npm run test:all` green; `db.verno === 11`. |
| **IT-1** | `pairs.ts`, `heuristic.ts` + fixtures. | Pure, deterministic, no DB/network; recall target met. |
| **IT-2** | `extraction.ts`, `runExtraction.ts`, `getAssociatedConversations` refactor, panel exclusion. | Fixture run creates pending `intent` objects with correct origin and evidence; cursor semantics tested. |
| **IT-3** | GitHub credentials (device-local), client, Settings section, `RepoBindingCard`. | Binding `Kakob/Chatdex` validates `main`; token scope warning works. |
| **IT-4** | Trace engine (`specDocs`, `candidateFiles`, `fetchPolicy`, `judge`, `runTrace`). | Fixture project + fake repo ⇒ one trace per intent; every quote verifiable at the recorded lines. |
| **IT-5** | Intent Trace tab, table, disclosures, route, `DisclosureModal.title`. | §16 manual scenario passes. |
| **IT-6** | Commit evidence, re-trace / add-file, warnings panel, docs amendments (§13.3), build-log rows. | `npm run build` passes; docs updated. |

---

## 16. Manual acceptance scenario

On the real Chatdex project after IT-5:

1. Settings → GitHub → paste `gh auth token` output → Test → OK (fine-grained token shows no over-privilege warning).
2. Projects → Chatdex → Intent Trace → bind `Kakob/Chatdex` → Validate shows `main` → Save.
3. Extract intents (Anthropic, lenient) → disclosure lists claude.ai / claude-code / chatgpt counts with cross-provider flags → confirm → progress → toast with counts; rows appear pending. An opening-message intent shows **Unprompted**; a reply to a Claude question shows **Reply to AI**; deep links open the reply with `?scrollTo=`.
4. Accept a few intents, reject one; the layout's pending badge decrements.
5. Trace against repo → disclosure states intents + file count + spec docs (Chatdex has `docs/*.md`, so the spec leg is live) → confirm → matrix fills; open an `implemented` row and verify quote + line range against the GitHub blob link at that sha.
6. Re-run Trace: already-traced intents are skipped; pin an older sha → new traces appended, old ones still visible in the row's history.
7. Reload, then a second device (or clear + resync): intents and traces survive sync; the GitHub token does not appear on the second device.

The qualitative question the scenario must answer: does the matrix surface at least one intent Jacob had forgotten, and does opening its evidence confirm the statement and the status without further searching?

---

## 17. Definition of done

- All milestones committed; typecheck, lint, frontend + backend tests green.
- §16 scenario passed in a browser on real data.
- Every AI-produced row in the tab is pending until reviewed; every status has verifiable evidence or is `unknown` / `unspecified` / `no_spec`.
- The GitHub token is device-local, reaches only api.github.com, and is absent from every relay body and prompt (tests S1/S2).
- `docs/INTENT-TRACE-BUILD-LOG.md` has IT-0…IT-6 rows; `CLAUDE.md` carries the §13.3 wording.

---

## 18. Later work explicitly deferred

- Agentic repository exploration (Agent SDK / Codex SDK with read-only tools pointed at the repo) — the natural upgrade when retrieve-then-judge's `unknown` rate proves too high.
- GitHub code search, PR listing, PR-description ingestion as Codex-cloud evidence.
- Living-specification generation from accepted intents (PRD §19); spec authoring; PR creation.
- Intent-vs-intent contradiction and supersession detection (extend reconciliation ops to intents).
- Multi-intent judge batching; token/cost estimates in the disclosure; retries / JSON mode.
- GitHub OAuth; backend GitHub proxy.
- CSP for the hosted origin.
- Codex-cloud transcript ingestion if an export ever becomes available.

None of these may weaken the laws in §2.

---

## 19. Integration decisions (2026-08-28)

| # | Decision | Why |
|---|---|---|
| D1 | Intents are `UnderstandingObject`s with `type: 'intent'`. | Reuses review gate, evidence chain, deep links, history, badges, sync; no new intent table. |
| D2 | `UnderstandingObject.meta?` carries polarity / origin / statedAt / confidence. | Unindexed → no migration; serializer spread syncs it unchanged; avoids overloading `type` or `body`. |
| D3 | Repo binding + extraction cursor live on `UnderstandingProject`. | Unindexed; mirrors `lastReconciledAt`; distinct from free-text `PreparedChangeRepositoryRef`. |
| D4 | GitHub PAT in `metadata['github.token']`, **device-local**. | A PAT is a per-machine credential; excluding it from sync removes a replication path at near-zero UX cost (audit S1). |
| D5 | GitHub is read browser-direct, no backend surface. | Relay stays transit-only and unchanged; token goes only to api.github.com. |
| D6 | Retrieve-then-judge, client-orchestrated, non-agentic. | Works on api-key and both subscription paths; every byte sent is disclosed. |
| D7 | `intentTraces` append-only, Dexie v11, synced as `intent_trace`. | Synthesis outputs are user data; traces must follow intents across devices; old traces stay when a new commit is traced. |
| D8 | One judge call per intent (spec + implementation together). | Simplest firewall; token-bounded. |
| D9 | Extraction lives under `src/lib/understanding/intents/`, never `src/lib/investigation/`. | Decision Investigation is human-only by law (`constraints.test.ts`). |
| D10 | Both unprompted and AI-prompted intents are extracted; origin recorded per intent, forced mechanically when no assistant text precedes. | Jacob's requirement (2026-08-28): "both … but decipher which requirements are from which source." |
| D11 | Codex-cloud transcripts out of scope; commit history is the only Codex-cloud evidence. | No export exists; only 2 local rollouts (bridge tests) — Jacob's Codex use is web/cloud + ChatGPT mobile. |
| D12 | Spec leg optional; `no_spec` is a first-class, model-free outcome. | Jacob: "no spec available" for the target projects today. |
