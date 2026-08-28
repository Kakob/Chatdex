# Chatdex Change Workspace — Specification

**Status:** Approved for build (v1), 2026-08-28
**Source PRD:** `docs/PRD-code-ownership-loop.md` (Jacob's "Code Ownership & Understanding Loop" draft, verbatim). References below to "PRD §n" point there.
**Area:** Prepare Change / Current Understanding / Investigate History
**Companions:** `docs/CHANGE-WORKSPACE-BUILD-LOG.md` (what was built per milestone), `docs/CHANGE-WORKSPACE-TODOS.md` (Jacob's actions + engineering checklist)

---

## 0. Instructions to Claude Code

Same discipline as `SPEC-intent-trace.md` §0:

- One milestone (§17) per session. Typecheck + lint + `npm run test:all` green before a row lands in the build log; the build log row and the todos checklist are updated in the same session as the code.
- If a request conflicts with §2, say so and ask rather than silently diverging.
- Do not touch `src/lib/crypto/`, `src/lib/detection/`, or `src/lib/investigation/` (boundary law §2.6). Reading their **types** and **db helpers** from `src/lib/prepare/` is allowed; importing the other direction is not.
- Nothing in this feature makes an LLM call in Guided mode. Assisted mode (CW-7) is gated to after the September 1 ship.

---

## 1. Product thesis

Chatdex keeps a developer's understanding synchronized with rapidly changing software by turning every change into a durable record:

intent → evidence → trace → hypothesis → implementation → verification → what was learned → promoted understanding.

Ownership is *evidence of understanding*, never a manual-vs-AI LOC ratio (PRD §3). Chatdex integrates with existing coding environments; it does not run code, clone, or write to repositories (PRD §25). High automation must not destroy the path back to human understanding (PRD §19, §27).

---

## 2. Non-negotiable product laws

These outrank convenience and speed.

### 2.1 Provenance law
Every evidence item carries exactly one `EvidenceKind` (§8) and enough locator data to re-open the primary source (file + sha + lines, message ids, commit sha, transcript step). A claim without evidence is `unknown`, shown as such, never hidden and never auto-upgraded.

### 2.2 Verification vocabulary law
`verified` means *mechanically established* (observed in code at a pinned sha, recorded test/runtime evidence, commit history) or *human-observed and recorded*. AI output is `ai_inference` and can never itself set an edge, criterion, or claim to `verified`. UI copy uses "Check my interpretation", never "Verify", for AI actions.

### 2.3 Human-authorship law
Hypothesis, acceptance criteria, "what I learned", trace edits, verification statuses, and promotion are human-authored. AI may draft text only into a visibly separate *suggested* slot; accepting copies it and records `origin: 'ai'` on the resulting field's history.

### 2.4 Freeze law
The open hypothesis is timestamped and frozen the moment an implementation is attached. Intent + criteria freeze at `ready` (existing behaviour). Frozen text stays visible beside later sections for comparison; a new hypothesis appends, never replaces.

### 2.5 Read-only repository law
Identical to Intent Trace §2.4: `https://api.github.com` only, device-local token, no writes, no clones. Whole-file bodies may be **cached locally** (§9; LOCAL-ONLY Dexie table, never synced) but the synced workspace stores only paths, shas, line ranges, and capped quotes (≤ 500 chars). Local-directory reads (CW-8) follow the same rule: read-only, cache-only.

### 2.6 Boundary law
No module under `src/lib/detection/**` or `src/lib/investigation/**` imports `src/lib/prepare/**`, `src/lib/github/**`, or `src/lib/repo/**` (extend the S10 guard test). The LLM relay stays transit-only and unchanged.

### 2.7 Disclosure law
Assisted mode reuses Intent Trace's `DisclosureModal` + `fetchPolicy`; every prompt names the provider, the conversation sources, and the repository excerpts being sent. Guided mode makes **no LLM calls at all** — its actions are deterministic so they *cannot* leak interpretation.

### 2.8 Promotion law
Nothing enters Current Understanding from a workspace without an explicit per-item "Promote" click. Promoted objects are `origin: 'user'`, `reviewState: 'accepted'`, with an `introduced` event whose evidence is the workspace's selected evidence items.

---

## 3. Known baseline (what this spec builds on)

- `src/types/preparedChange.ts`, `src/lib/prepare/changes.ts` (create / draft / validate / ready), `src/lib/prepare/export.ts` (deterministic Markdown/JSON handoff), `src/pages/PrepareChangePage.tsx` (single page: list + draft form + readiness + preview). Route `/projects/:id/prepare`. Synced kind `prepared_change`. Creation currently **requires** ≥ 1 accepted understanding point (`requireAcceptedUnderstanding`) — relaxed by §7.
- `src/types/understanding.ts`: `UnderstandingObject` (open `type`, `meta`), `UnderstandingEvent` (append-only, `evidence: EvidenceRef[]` — conversation-only), `ProjectRepository` binding on the project.
- `src/lib/github/client.ts`: `getRepo`, `resolveRef`, `getTree`, `getFileContent` (200 KB cap), `listCommits`, `blobUrl`, validated inputs, rate-limit errors. `src/lib/github/credentials.ts`: device-local PAT.
- `src/lib/understanding/trace/{candidateFiles,fetchPolicy}.ts`: excluded dirs, sensitive-path denylist, `scrubSecrets`, `assertNoSecrets`.
- `src/types/investigation.ts`: `CaseExhibit` (`code_span` + `selectedContentHash` integrity pattern), `DerivedFileChange` (edits extracted from Claude Code tool events, with `contentHash`), `InvestigationFinding.promotedUnderstandingObjectId`.
- `src/lib/fs/directoryPicker.ts`: File System Access API pick / remember / permission helpers.
- Dexie at v11. Sync `KindSchema` in `backend/src/routes/sync.ts` + `src/lib/sync/syncApi.ts`; serializer revives **top-level** Dates only (`rehydratePreparedChange`).
- `docs/SEPTEMBER-1-SHIP.md` defers "generated summaries or verdicts" and cloning. Guided mode and all deterministic sections are ship-safe; Assisted mode (CW-7) is post-Sept-1.

---

## 4. Outcome

A developer takes one real Chatdex change and, inside one persistent workspace, states intent, finds code, builds an evidence-backed trace, records a hypothesis, attaches an implementation (own or an agent's), verifies against explicit criteria, explains what was learned, and promotes selected findings — then later reconstructs why the change was made and how the system was understood (PRD §26). Both the human-led and the AI-led examples in PRD §26 must be walkable in the §18 scenario.

---

## 5. Scope

### 5.1 In scope (v1)
PRD §22 sections: Intent (current / desired / why); Acceptance criteria (per-criterion ids); Evidence (repo search via GitHub file cache; links to Investigate History cases/findings and Current Understanding objects; attached conversations); My Trace (ordered nodes + edges, unknown nodes, per-edge evidence + derived verification state); My Hypothesis (frozen on attach); Implementation (GitHub compare / PR files, an ingested Claude Code session's `DerivedFileChange`s, or a pasted diff; provenance human / ai / human_ai / imported); Verification (criteria × evidence matrix with human statuses); What I Learned; Promote; Questions (`UnderstandingObject` `type: 'question'`); inspection log (for PRD §17); Guided mode (deterministic); Assisted mode (LLM, disclosed); workspace timeline in Investigate History (PRD §18); local-directory evidence source (CW-8, Chrome only).

### 5.2 Out of scope (v1)
Running tests/apps from Chatdex; callers/callees or any parser-based analysis; free-form graph canvas (v1 trace is an ordered list with branch + unknown nodes); autonomous/agentic mode (PRD §9 "Agentic", §19 automation); prediction prompts (PRD §11 — data model leaves room, no UI); AI review of the diff; comprehension/productivity scores; GitHub code-search API; GitHub OAuth; PR creation; understanding-history rollups beyond counts derivable from the inspection log.

---

## 6. Vocabulary

- **Workspace** — a `PreparedChange` row (extended per §7). "Prepared Change" and "Change Workspace" are the same record; the UI says *Change Workspace*.
- **Evidence item** — one `EvidenceItem` (§8).
- **Trace** — ordered `TraceNode[]` + `TraceEdge[]` embedded in the workspace.
- **Verification row** — one criterion's evidence list + human status.
- **Inspection** — a logged human view of a file / evidence item / node / diff (LOCAL-ONLY).
- **Guided / Assisted** — PRD §23 modes; a per-workspace setting, changeable any time, recorded in `modeHistory`.
- **Section editability** — `editable` (free edits), `appendable` (add only; existing entries immutable), `frozen` (read-only).

---

## 7. Conceptual data model

### 7.1 `PreparedChange` extension (`src/types/preparedChange.ts`)

All new fields are optional; **no Dexie index change and no migration** for this table; the serializer spread carries them. `state` widens to `'draft' | 'ready' | 'implementing' | 'verified' | 'closed' | 'superseded'`.

```ts
intent?: { currentBehavior: string; desiredBehavior: string; whyItMatters: string };
  // desiredOutcome / rationale remain for the handoff export; the UI mirrors desired→desiredOutcome, why→rationale
criteria?: Criterion[];             // { id, text, createdAt: ISO } — acceptanceCriteria: string[] is kept in sync (derived) for the export
evidence?: EvidenceItem[];          // §8
trace?: { nodes: TraceNode[]; edges: TraceEdge[] };   // §10
hypotheses?: Hypothesis[];          // { id, text, createdAt: ISO, frozenAt?: ISO, origin: 'user' | 'ai' } — append-only after freeze
implementation?: Implementation;    // §11
verification?: VerificationRow[];   // { criterionId, evidenceIds, status: 'supported'|'contradicted'|'partial'|'unverified', note?, updatedAt: ISO }
learned?: { text: string; createdAt: ISO; updatedAt: ISO; aiSuggested?: string };
promotions?: { evidenceIds: string[]; understandingObjectId: string; promotedAt: ISO }[];
questionIds?: string[];             // UnderstandingObject ids, type 'question'
mode?: 'guided' | 'assisted';
modeHistory?: { mode: 'guided' | 'assisted'; at: ISO }[];
originRef?: { kind: 'question'|'conversation'|'understanding'|'finding'|'issue'|'commit'|'manual'; id?: string; url?: string };
implementingAt?: Date; verifiedAt?: Date; closedAt?: Date;   // top-level Dates, revived by the serializer like readyAt
```

**Nested timestamps are ISO strings** (D11): the sync serializer revives only top-level Dates, and nested Dates would silently become strings after a resync. Top-level lifecycle timestamps stay `Date` and are revived explicitly.

**Creation relaxed (D7):** `createPreparedChange` accepts `understandingPointIds: []` plus optional `intent` and `originRef`. `validatePreparedChange` requires *either* accepted understanding *or* a non-empty `intent.desiredBehavior`. `markPreparedChangeReady` is otherwise unchanged.

**Lifecycle (`src/lib/prepare/lifecycle.ts`):**

| Transition | From → To | Guard / effect |
|---|---|---|
| `attachImplementation` | `ready` → `implementing` (also allowed from `draft` for the AI-led path, which auto-marks ready with whatever intent exists) | Freezes the open hypothesis (`frozenAt`), sets `implementingAt`. |
| `markVerified` | `implementing` → `verified` | Every criterion has a row whose status ≠ `unverified` **or** carries an explicit "accepted as unverified" note. Sets `verifiedAt`. |
| `closeWorkspace` | `verified` → `closed` | Requires `learned.text`. Sets `closedAt`. |
| `setWorkspaceMode` | any | Appends to `modeHistory`. |

**Section editability (`src/lib/prepare/editability.ts`):**

| Section | draft | ready | implementing | verified | closed |
|---|---|---|---|---|---|
| intent, criteria, non-goals, constraints, open choices, repositoryRef | editable | frozen | frozen | frozen | frozen |
| evidence, trace, questions | appendable | appendable | appendable | appendable | frozen |
| hypotheses | appendable | appendable | appendable (new entries only; earlier ones frozen) | appendable | frozen |
| implementation | — | attachable | replaceable (keeps history in `implementationHistory`) | frozen | frozen |
| verification | — | — | editable | editable | frozen |
| learned | — | — | editable | editable | frozen |
| promotions | — | — | — | appendable | appendable |

### 7.2 New LOCAL-ONLY tables (Dexie v12, never synced — mirrors the `rawSources` decision)

- `repoFiles: '&[repoKey+sha+path], repoKey, sha'` — `{ repoKey: 'gh:owner/repo' | 'fs:<handleName>', sha, path, size, content, fetchedAt }`. Whole files cached for search only; evicted per (repoKey, sha) on unbind or from Settings. Fetch goes through `fetchPolicy` (denylist + excluded dirs) so a disallowed path is never cached; `scrubSecrets` is applied on *display and quote*, not on the cached body.
- `inspections: '&id, workspaceId, projectId, [projectId+targetKey], at'` — `{ id, workspaceId?, projectId, kind: 'file'|'evidence'|'node'|'diff'|'history', targetKey, at }`. Written by the UI on open/expand. Feeds PRD §17 counts. Local-only in v1 (D9).

Both tables are cleared by `clearAllData()` and are **absent** from the sync engine's hook/resync table list (test S1).

### 7.3 Sync

No new kinds. The `prepared_change` payload grows; the cleartext envelope remains `{ kind, parentId, updatedAt }` (extend the S9 test to a workspace with every section populated). Backend untouched — **no deploy-order note** for CW-0.

---

## 8. Evidence model (`src/types/evidence.ts`, new)

```ts
type EvidenceKind = 'code' | 'test_runtime' | 'intent_history' | 'human_hypothesis' | 'ai_inference';   // PRD §24

interface EvidenceBase { id: string; kind: EvidenceKind; createdAt: ISO; note?: string; origin: 'user' | 'ai'; addedVia: 'search' | 'manual' | 'attach' | 'assisted' }
code:             { repoKey; sha; path; startLine; endLine; quote (≤ 500 chars, scrubbed); quoteHash: sha256 }
test_runtime:     { source: 'transcript' | 'manual'; conversationId?; messageId?; stepIndex?; command?; outcome: 'pass' | 'fail' | 'observed'; quote?; quoteHash? }
intent_history:   { source: 'conversation' | 'understanding' | 'finding' | 'commit' | 'spec'; conversationId?; messageIds?; understandingObjectId?; findingId?; commitSha?; path?; quote?; quoteHash? }
human_hypothesis: { hypothesisId }
ai_inference:     { runId; provider; promptDigest; text (≤ 2000 chars); checkedAgainst?: string[] /* evidence ids the model cited */ }
```

Rendering: kind chip + locator + "open source" (blob link via `blobUrl` for code; `?scrollTo=` deep link for messages; Investigate case link for findings). A `quoteHash` mismatch on re-fetch shows a "Source changed" badge (same UX as the exhibit "Source mismatch").

`EvidenceRef` (conversation-only) stays the evidence type on understanding events. Promotion (§12) converts transcript-backed `intent_history` / `test_runtime` items into `EvidenceRef`s and stores code/test items in the new optional field `UnderstandingEvent.codeEvidence?: EvidenceItem[]` — the only change to understanding types, unindexed.

---

## 9. Repository search (`src/lib/repo/`, new — CW-1, CW-8)

- `sources.ts` — `RepoSource { key; label; listFiles(sha); readFile(sha, path) }`.
  - `githubSource.ts` wraps the client + `repoFiles` cache; sha from `project.repository` via `resolveRef`; skips paths failing `fetchPolicy`; files > `MAX_FILE_BYTES` are skipped and listed.
  - `localDirSource.ts` (CW-8) uses File System Access; `sha = 'local'`; gated by `isDirectoryPickerSupported()`.
- `index.ts` — `ensureIndexed(source, sha, { maxFiles: 2000, onProgress })`: tree, then files in batches of 20 with the client's rate-limit abort; resumable; total-size cap 50 MB; reports "N skipped (size / denylist)".
- `search.ts` — pure functions over cached rows: `grep(query, { regex, caseSensitive, pathGlob })`, `findSymbol(name)` (word-boundary + declaration heuristic `function|const|let|class|interface|type|export default|=>`), `findReferences(name)` (word-boundary, excludes declaration lines). Results `{ path, line, text, sha }` with ± 2 context lines; "Add as evidence" creates a `code` item with the exact selected lines. Hit cap 500; linear-time regex guard (S8).
- Deterministic, no LLM; works offline once cached.

---

## 10. Trace (`src/lib/prepare/trace.ts` — CW-2)

- `TraceNode { id; label; kind: 'behavior'|'component'|'function'|'route'|'endpoint'|'service'|'db'|'event'|'state'|'external'|'test'|'unknown'|'other'; evidenceIds: string[]; order: number; branchOf?: string }`.
- `TraceEdge { id; from; to; claim?: string; evidenceIds: string[]; override?: { verification: 'contradicted'; note: string }; origin: 'user' | 'ai' }`.
- `deriveEdgeVerification(edge, evidence)` → `'verified' | 'hypothesis' | 'ai_inference' | 'contradicted' | 'unknown'`: `contradicted` iff the human override is set; else `verified` iff ≥ 1 attached item of kind `code`, `test_runtime`, or `intent_history` with `source: 'commit'`; else `hypothesis` iff any `human_hypothesis`; else `ai_inference` iff any `ai_inference`; else `unknown`. Never stored — always derived (D4).
- v1 editor: ordered list with insert / move / branch / `???` node; an edge row between consecutive nodes; evidence picker from the workspace's evidence list. No canvas.
- `traceSummary(trace, evidence)` — counts by derived state; feeds PRD §17 and the Investigate History card.

---

## 11. Implementation attach (`src/lib/prepare/implementation.ts` — CW-3)

```ts
Implementation { source: 'github_compare' | 'github_pr' | 'claude_code_session' | 'pasted_diff';
                 provenance: 'human' | 'ai' | 'human_ai' | 'imported'; provenanceNote?;
                 baseSha?; headSha?; prNumber?; conversationId?;
                 files: { path; additions; deletions; patch? (≤ 20 KB, scrubbed) }[]; attachedAt: ISO }
```

- GitHub: new client functions `compareCommits(owner, repo, base, head)` and `getPullFiles(owner, repo, n)` — same validation / host / auth rules through the existing `request()` helper; patches capped and scrubbed; `patch` optional (user may store stats only).
- Claude Code session: pick an associated conversation; files derived from `investigationAnchors[].fileChanges` via `listInvestigationAnchors` (read-only reuse; allowed direction). Provenance defaults to `ai`; user may set `human_ai`.
- Pasted diff: parsed for file stats only; provenance user-chosen; `imported` when unknown.
- Attaching freezes the open hypothesis (§2.4) and moves state to `implementing`.

---

## 12. Verification, learned, promote, questions (CW-4, CW-5)

- **Verification matrix.** Rows auto-created per criterion; evidence picker filtered to `test_runtime`, `code`, `intent_history`. AI items may be attached, but a row whose only evidence is `ai_inference` cannot be `supported` (shows "AI-claimed — add evidence"). Status is human-set; `deriveVerificationHint(row, evidence)` suggests, never sets.
- **Learned.** Free text. Assisted mode may offer "Challenge my explanation": AI text lands in `learned.aiSuggested`, seeded with the trace edges that have no evidence (computed deterministically from §10 *before* the prompt — the model only phrases it).
- **Promote.** Dialog lists evidence items and trace edges in `verified` state; the user selects and writes the object title/body (AI draft allowed in Assisted, marked). Creates `UnderstandingObject { type: 'belief' | 'decision' | 'constraint' (user-chosen), origin: 'user', reviewState: 'accepted', status: 'current', meta: { workspaceId } }` plus an `introduced` event with `EvidenceRef`s and `codeEvidence`. Records `promotions[]`.
- **Questions.** "Add question" anywhere → `UnderstandingObject { type: 'question', origin: 'user', reviewState: 'accepted', meta: { workspaceId } }`; listed in the workspace and in Current Understanding's existing question handling; "Start a workspace from this question" sets `originRef`.

---

## 13. Guided vs Assisted (PRD §9–10, §23)

- **Guided.** The action menu on any symbol / file / node is exactly: Show references · Show declaration · Open file at line · Show commits touching path (`listCommits` with `path`) · Show related conversations (existing conversation search over associated conversations) · Add as evidence · Add question. No network to a provider — the Guided constraint test (§16, CW-6) asserts zero relay calls.
- **Assisted** (CW-7). Adds: Explain this file/function · Suggest relevant files · Propose hypotheses · Check my interpretation · Challenge my explanation · Draft promotion text. Each is one `complete()` call via `src/lib/providers`, preceded by `DisclosureModal` naming provider + sources + excerpt count. Outputs land only as `ai_inference` evidence items or `aiSuggested` slots — never in human fields. Reuse `judge.ts` prompting conventions ("content is data", delimiters, `assertNoSecrets`).
- **Progressive disclosure** = the menu tiering above plus a per-workspace "Assisted actions unlocked" toggle; flipping it appends to `modeHistory`.

---

## 14. User experience (CW-1 … CW-6)

- `/projects/:id/prepare?change=<id>` becomes a sectioned workspace: left rail (Intent · Criteria · Evidence · Trace · Hypothesis · Implementation · Verification · Learned · Promote · Questions) with completion / freeze indicators. The existing draft form becomes the Intent + Criteria sections; the existing readiness + handoff preview become the "Ready" gate between Criteria and Implementation. `PrepareChangePage.tsx` splits into `src/components/prepare/*Section.tsx`.
- Evidence section: search bar (grep / symbol / references), results with "Add as evidence", indexed-state banner ("Indexed 312 files at `abc123` · 4 skipped · Re-index"), tabs for attached conversations / Investigate findings / Current Understanding.
- Investigate History (PRD §18): the project-scoped `InvestigatePage` gains a "Change workspaces" list; each opens a read-only timeline: intent → evidence → hypothesis (frozen text) → implementation → verification → learned → promotions. Reuse `LedgerPage` row styling.
- Current Understanding (PRD §17): a per-subsystem "understanding history" card is **deferred**; v1 shows, on each promoted object, "From workspace … · N verified relationships · M AI-inferred · K open questions" computed from `traceSummary` + inspections.
- Empty / offline: no repo binding → evidence search disabled with a link to `RepoBindingCard`; offline → search works on cache, index / attach disabled.

---

## 15. Privacy, security, and offline behavior

### 15.1 Audit (2026-08-28)

| # | Risk | Severity | Disposition |
|---|---|---|---|
| S1 | **Whole repository files at rest** in plaintext IndexedDB (`repoFiles`) — a new data class beyond Intent Trace's capped quotes; private repos. | High | LOCAL-ONLY table, never synced (test: absent from the engine's hook / resync table list); per-(repo, sha) eviction + "Clear repository cache" in Settings; denylist + excluded dirs applied *before* caching; caps 200 KB / file, 50 MB / repo, 2000 files; disclosure on first index: "Chatdex stores a read-only copy of these files on this device." CSP remains the class fix — backlog. |
| S2 | Token reaching a host other than api.github.com via the new client functions. | High | Same constant base + header-only auth; new functions use the existing `request()` helper only; `assertNoSecrets` before any prompt; test extends the "relay body never carries a GitHub field" assertion to workspace payloads. |
| S3 | Prompt injection via cached repo content or pasted diffs in Assisted prompts. | Medium | Same mitigations as Intent Trace S3; additionally Assisted outputs can only create `ai_inference` items (law 2.2) — no status, edge state, or promotion can be set by the model. |
| S4 | Secrets in cached files reaching the provider or the synced workspace via quotes / patches. | High | `scrubSecrets` on every quote, patch, and prompt excerpt; `fetchPolicy` denylist gates both caching and attach; pasted-diff path also scrubbed; redaction counts shown. |
| S5 | Spend: Assisted actions are one call each; "Suggest relevant files" may include many excerpts. | Medium | Per-action excerpt cap (≤ 12 files / 40 KB); count in disclosure; Anthropic hint; no batch or automatic actions. |
| S6 | Link integrity: blob / compare / PR URLs built from user-influenced owner / repo / sha / path / number. | Low–Medium | Validated builders only (`blobUrl` + new `compareUrl`, `pullUrl` with `assertRepoName` / `assertSha` / integer check); `rel="noopener noreferrer"`; text-node rendering; `<script>` regression tests for quotes, patches, node labels. |
| S7 | Synced workspace growth (patches, quotes, many evidence items) and LWW clobber between devices. | Low | Caps: quote 500 chars; patch 20 KB / file and 200 KB / workspace (stats-only beyond); 200 evidence items; 100 nodes. LWW documented (unchanged from today); no new sync kind. |
| S8 | ReDoS from user-supplied regex in `grep`. | Low | Regex mode: pattern length ≤ 200 chars; nested-quantifier pre-check; runs on ≤ 200 KB files with a per-file time budget; 10 KB adversarial timing test. |
| S9 | Sync envelope cleartext. | Low | Test: a workspace with all sections populated ⇒ cleartext fields exactly `{ kind, parentId, updatedAt }`. |
| S10 | Boundary (§2.6). | — | Extend the import-guard test: `src/lib/{detection,investigation}/**` must not import `src/lib/{prepare,github,repo}/**`. Prepare → investigation db/type reads allowed (documented). |
| S11 | Local-directory source (CW-8): a persisted handle grants read of an arbitrary folder; the user may pick `~`. | Medium | Reuse `ensureReadPermission`; refuse directories over caps; same denylist; handle name shown; "Forget directory" in Settings; never synced. |
| S12 | The inspection log is behavioral data about the user. | Low | Local-only; per-project clear; no server path; explained in help text; never sent to a provider. |

Not addressed here (pre-existing): CSP / hardening of the hosted origin; at-rest encryption of `metadata` credentials beyond the vault model.

### 15.2 Offline
Search (once cached), trace, hypothesis, verification, learned, promote, questions, and history views work offline from IndexedDB. Indexing, attach-from-GitHub, and Assisted actions require network. Detection and Investigation are untouched.

---

## 16. Required tests

- **CW-0:** serializer identity for a fully populated workspace (every section); envelope cleartext (S9); Dexie v12 — `repoFiles` / `inspections` exist, are cleared by `clearAllData`, and are absent from the sync engine's table list (S1); lifecycle transitions + editability table; hypothesis freeze on attach (2.4); creation without understanding points; `validatePreparedChange` either/or rule; existing `changes.test.ts` still green; boundary guard extended (S10).
- **CW-1:** `githubSource` with injected fetch — tree → batched fetch → cache rows; denylist / size skips listed; resume after rate-limit error; eviction. `search.ts` — grep / symbol / references over a fixture tree; hit cap; regex guard + 10 KB timing (S8); "Add as evidence" yields exact lines + `quoteHash`; scrubbed quote.
- **CW-2:** `deriveEdgeVerification` table over all kind combinations; node ordering / branch / unknown; `traceSummary`; RTL — add / move / attach evidence; `<script>` label renders escaped (S6).
- **CW-3:** `compareCommits` / `getPullFiles` with injected fetch (validation, caps, scrub, constant host — S2 extension); Claude Code session attach derives files from an anchors fixture with provenance `ai`; pasted-diff stats parser; freeze law.
- **CW-4:** verification rows track criteria; AI-only evidence cannot be `supported`; `deriveVerificationHint`; `markVerified` gate.
- **CW-5:** promotion creates an accepted user object + `introduced` event with `EvidenceRef`s + `codeEvidence`; `promotions[]` recorded; question creation + `originRef` seeding; existing understanding tests green.
- **CW-6:** Guided constraint test — full Guided walkthrough with `fetch` allowed **only** to `api.github.com`, relay URL asserted never called; history timeline renders from a fixture; inspection log writes.
- **CW-7:** Assisted actions with mocked `complete` — outputs land only as `ai_inference` / `aiSuggested`; disclosure precedes every call; excerpt caps; injected instructions inside a cached file alter no status (S3).
- **CW-8:** `localDirSource` with a mocked handle — permission gate, caps, denylist, never synced (S11).

---

## 17. Milestones

| Milestone | Deliverable | Acceptance |
|---|---|---|
| **Spec** | This document, the PRD copy, `docs/README.md` row, `CLAUDE.md` pointer, build log + todos created. | Committed on its own. |
| **CW-0** | `src/types/evidence.ts`; `PreparedChange` extension + widened `state`; `lifecycle.ts`, `editability.ts`; relaxed creation; Dexie v12 local-only tables + helpers; serializer date revival; guard test. | `npm run typecheck && npm run lint && npm run test:all` green; `db.verno === 12`; no backend change. |
| **CW-1** | `src/lib/repo/` (`sources`, `githubSource`, `index`, `search`); Evidence section UI with search + add-as-evidence + index banner; Settings "Clear repository cache". | Indexing `Kakob/Chatdex` at `main` completes within the rate limit; a references query returns exact lines. |
| **CW-2** | Trace model + `deriveEdgeVerification` + list editor + summary. | A trace with verified / hypothesis / unknown edges renders and persists. |
| **CW-3** | Hypothesis section (freeze); Implementation attach (compare / PR / Claude Code session / pasted); client functions; provenance. | Attaching any source freezes the hypothesis and moves to `implementing`. |
| **CW-4** | Verification matrix + `markVerified`. | Criteria × evidence with human statuses; AI-only rows blocked. |
| **CW-5** | Learned + Promote + Questions; `codeEvidence` on events; `closeWorkspace`. | Promoted object appears in Current Understanding with code-evidence links. |
| **CW-6** | Page split into sections; Guided action menu everywhere; Investigate History timeline; inspection log + per-object "from workspace" line; Guided constraint test. | §18 human-led scenario passes. |
| **CW-7** *(post-Sept-1)* | Assisted mode actions + disclosures; `aiSuggested` slots; "Challenge my explanation". | §18 AI-led scenario passes; every AI output is `ai_inference`. |
| **CW-8** | Local-directory source (Chrome), Settings entry, S11 controls. | The same searches work on a local clone without GitHub. |

---

## 18. Manual acceptance scenario (real Chatdex, real change)

**Human-led.** Projects → Chatdex → Prepare Change → New workspace "Search result should scroll to matching message" with no understanding points selected → Intent (current / desired / why) → 3 criteria → Ready. Evidence: index the repo; symbol search `scrollTo`, then references; add 3 code items. Trace: SearchPage → navigate → ConversationsPage → `???`; attach evidence; one edge derives `verified`, one `unknown`. Write the hypothesis. Implement in Claude Code *outside* Chatdex; import the JSONL; attach that session ⇒ provenance `ai`, hypothesis frozen. Verification: attach the session's `npm test` tool event as `test_runtime` to criterion 1; leave criterion 3 `unverified` with a note. Write "learned"; promote one belief; add the question "deleted-message targets?". Investigate History shows the timeline; the promoted object shows "From workspace … 1 verified · 1 unknown". Reload, then a second device: the workspace syncs; `repoFiles` and inspections do not.

**AI-led (after CW-7).** Open a workspace from an existing Claude Code session ("Understand this change") → implementation attached first → Assisted "Suggest relevant files" (disclosure) → items land as `ai_inference` → verify two edges by opening blob links and adding `code` items → "Challenge my explanation" names the edge with no evidence → promote.

The qualitative question: a week later, can Jacob answer PRD §2's ten questions for this change from the workspace alone?

---

## 19. Definition of done

- All milestones committed; typecheck, lint, `test:all`, `build` green.
- §18 passed in a browser on real data.
- Every AI output in a workspace is `ai_inference` or `aiSuggested`; no human field is ever written by the model.
- `repoFiles` and `inspections` never appear in a sync envelope; the GitHub token reaches only api.github.com.
- Build log has Spec + CW-0 … CW-8 rows; `CLAUDE.md` invariant list carries the §2.5 local-cache sentence.

---

## 20. Later work explicitly deferred

Agentic mode; parser-based callers/callees (tree-sitter wasm); free-graph canvas; prediction prompts; AI diff review; syncing inspections; per-subsystem understanding-history rollups; GitHub code search; PR creation; test-runner integration; CSP for the hosted origin.

None of these may weaken the laws in §2.

---

## 21. Decisions (2026-08-28)

| # | Decision | Why |
|---|---|---|
| D1 | The workspace *is* an extended `PreparedChange`; sections embedded; no new sync kind. | Jacob's choice; keeps the Sept-1 golden path and the handoff export; no backend deploy ordering. |
| D2 | Repo search = GitHub file cache first; local directory later (CW-8). | Jacob's choice; sha-pinned and consistent with Intent Trace; tarball / zipball blocked by CORS in the browser; the code-search API is not sha-pinned. |
| D3 | Whole files cached LOCAL-ONLY (Dexie table never hooked into sync). | Search needs bodies; synced records keep the ≤ 500-char-quote posture (S1 / S7). |
| D4 | Edge verification is derived from evidence kinds, with one human override (`contradicted`). | Enforces law 2.2 mechanically rather than by UI discipline. |
| D5 | Guided mode makes zero provider calls. | The only way progressive disclosure is leak-proof; also ship-safe under the Sept-1 deferrals. |
| D6 | Implementation attaches from GitHub compare / PR, ingested Claude Code sessions, or a pasted diff; Chatdex never reads a local git. | PRD §25 — integrate, don't replace; `DerivedFileChange` already exists. |
| D7 | Creation no longer requires accepted understanding points. | PRD §4 origins include bugs, questions, and manual intent. |
| D8 | Questions are `UnderstandingObject` `type: 'question'`. | Reuses existing question handling in Current Understanding and Investigate. |
| D9 | Inspection log is local-only in v1. | PRD §17 needs it from day one; syncing behavioral data is a separate disclosure decision. |
| D10 | Assisted mode is CW-7, after September 1. | `SEPTEMBER-1-SHIP.md` defers generated summaries / verdicts. |
| D11 | Nested section timestamps are ISO strings; only top-level lifecycle timestamps are `Date`. | The serializer revives top-level Dates only; nested Dates would silently degrade to strings after a resync. |
