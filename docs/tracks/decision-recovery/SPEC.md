# Chatdex — Decision Recovery (the Decision spine)

**Status:** Approved 2026-09-07 (Jacob; roadmap decisions D1–D4 below). Milestones DR-0…DR-7, one per session.
**Area:** Understanding lineage — sibling of Intent Trace. Project tab **Decisions**.
**Companions:** build log `docs/tracks/decision-recovery/BUILD-LOG.md`; user todos `docs/tracks/decision-recovery/TODOS.md`.
**Working principle:** Chatdex makes implicit AI decisions explicit so AI-generated code is easier to understand, evaluate, and change.

---

## 0. Instructions to Claude Code

1. Read `CLAUDE.md` first. Invariant 6 governs every provider call here; the detection layer and `src/lib/crypto/` are untouched.
2. **Decision Investigation is quarantined** (`docs/tracks/decision-investigation/SPEC.md` §2). This track never modifies `src/lib/investigation/*`, its tables, or its spec. The single bridge is one-way promotion of a finalized finding into the Decision shape (§7.4).
3. Mirror Intent Trace (`src/lib/understanding/trace/`, `src/lib/understanding/intents/`, `src/pages/IntentTracePage.tsx`) file-for-file where a counterpart exists. Prefer reusing `locateQuote` / `verifyCodeEvidence` (`judge.ts`), `selectCandidateFiles` (`candidateFiles.ts`), `fetchPolicy.ts`, `DisclosureModal`, `ReviewButtons`, `HistoryDrawer`, `RepoBindingCard`.
4. One milestone per session (§15). Each lands with `npm run typecheck`, `npm run lint`, `npm run test:all` green and a build-log row with the commit hash.
5. If a request conflicts with §2, say so and stop.

---

## 1. Product thesis — the six stages

An agent coding session makes dozens of decisions the user never sees: which existing pattern to copy, what to do on failure, what not to keep. They disappear into transcripts and diffs. Chatdex recovers them and makes them reviewable.

| Stage | Promise | Where it lives after this track |
|---|---|---|
| 01 Capture AI work | Record what agents saw, did, changed, delegated | `investigationAnchors` (changed, existing), **`agentInspections`** (saw, new), session commits (did), parser v1.2.0 sidechains (delegated, DR-7) |
| 02 Recover decisions | Extract choices that would otherwise vanish | **Recovery pipeline** → `UnderstandingObject { type: 'decision' }` + **`DecisionTrace`** |
| 03 Connect decisions → code | Which decisions produced which files, symbols, tests | `DecisionTrace.anchorStableKeys` (exact hunks) + `implEvidence` (verified quotes) + `symbols` + `testPaths` |
| 04 Expose assumptions | specified · inherited · inferred · invented · unknown | `DecisionBasis` on every decision and every assumption, **mechanically constrained** (§9.4) |
| 05 Establish human understanding | prediction, teach-back, epistemic diff | **`DecisionDiff`** (this track); prediction and teach-back deferred (§18) |
| 06 Prepare deliberate change | consequences, blast radius, tests, decision changes before implementation | **Blast radius v1** (text-level) + `WorkspaceOriginRef { kind: 'decision' }` → Prepare Change |

**First-class object: Decision** — statement · made by · why · alternatives · assumptions (each with basis) · implemented by · evidence.

**Killer demo (§16):** an agent gets *"Add project deletion"* with two explicit constraints. Chatdex reconstructs the implementation decisions hidden in the session, labels each by basis, and lets the user open the unsupported autonomous one, inspect the hunks it produced, challenge it, see blast radius, and prepare a replacement change.

---

## 2. Non-negotiable product laws

### 2.1 Transcript-evidence law
Every decision and every assumption cites at least one verified verbatim span of a transcript step that was actually supplied to the model. Claims whose quotes cannot be located are dropped, never stored as text.

### 2.2 Basis-constraint law
Basis labels are mechanically constrained after the model answers. `specified` requires a verified `user_msg` span. `inherited` requires verified code evidence on a path that pre-existed in the bound snapshot, or an `inheritedFrom` pointer to a path the agent inspected or a dependency present in the snapshot's `package.json`. `invented` requires zero `user_msg` spans. `inferred` requires an `agent_text` or `tool_call` span. Labels that fail their constraint are downgraded and the downgrade is recorded as a warning on the trace. The model never sets `madeBy` or `unsupportedAutonomous`; both are derived (§7.3).

### 2.3 Pending law
Recovery output lands `origin: 'ai'`, `reviewState: 'pending'`. Recovery never emits `superseded`, `contradicted`, or `resolved` understanding events. The model's `invalidates` claims land only on the trace and surface through the diff (§12) for a human to act on.

### 2.4 Recomputed-locator law
Line numbers and character offsets are recomputed from the located quote. The model's own numbers are discarded (Intent Trace §9.4 precedent).

### 2.5 Quarantine law
Decision Investigation tables, spec, and `src/lib/investigation/*` are not modified. Recovery never writes to DI tables; DI never reads recovery output. The one-way promotion of a finalized finding (§7.4) is a wrapper around the existing `promoteFindingToCurrentUnderstanding`.

### 2.6 Disclosure law
`planRecovery` runs before any provider call and produces the disclosure: which conversations, which source providers, whether the call is cross-provider, and how many repository excerpts and edit hunks will be sent. Transcript excerpts and edit hunks are user data under CLAUDE.md invariant 6, same as repository excerpts.

### 2.7 No-ranking law
Decisions are ordered by first citing step and grouped by primary path or session. There is no importance score. Ranking is itself an implicit AI decision, exactly what this product exposes. `basis` and `unsupportedAutonomous` are the only salience cues and both are mechanical.

### 2.8 Deterministic-diff law
`DecisionDiff` is a pure function of two trace sets. No model, no network. Same input twice produces deep-equal entries. `differVersion` is bumped when fold rules change.

### 2.9 Boundary law
`agentInspections` and `decisionDiffs` are LOCAL-ONLY and never enter the sync engine. `decision_trace` payloads carry only paths, shas, stable keys, line ranges, and quotes capped at `MAX_QUOTE_CHARS` (500). Whole files never sync (Change Workspace §2.5 precedent).

### 2.10 Read-only repository law
Nothing is written to the repository, the working tree, or GitHub.

---

## 3. Known baseline and integration assumptions

- Dexie `verno === 12` on `main`. DR-1 takes **v13**; the Flow Map draft moves to **v14** (its docs already say so).
- `UnderstandingObject.meta` is `Record<string, string | number | boolean>` — scalar only. Structured arrays therefore live on `DecisionTrace`, not on the object.
- `investigationAnchors` (LOCAL-ONLY, `*filePaths` multiEntry index) already gives exact hunks with content hashes per Edit/Write/MultiEdit/NotebookEdit step, keyed `${sourceRef}#s${stepIndex}`.
- Intent Trace provides the firewall (`judge.ts`), candidate selection (`candidateFiles.ts`), fetch gate (`fetchPolicy.ts`), repo binding UI, and the synced-kind checklist (`intent_trace` touchpoints in `syncApi.ts`, `serializer.ts`, `engine.ts`, `backend/src/db/schema.ts`, `backend/src/routes/sync.ts`).
- Change Workspace CW-7 Assisted mode (`src/lib/prepare/assisted.ts`) provides the `challenge_explanation` prompt and firewall.
- Recon P5: Chatdex has no project delete and three divergent conversation-delete cascade paths. The demo branch stays unmerged.

---

## 4. Outcome

A user imports an agent session, binds the repository at the commit the agent produced, presses **Recover decisions**, reviews the disclosure, and receives a chronological list of pending decisions. Each carries a basis badge, made-by, why, alternatives, assumptions with their own bases, the exact hunks that implemented it, verified code lines at the pinned sha, and every transcript span it rests on. Unsupported autonomous decisions are the only highlighted rows. From any decision the user can open its blast radius, challenge it, record a verdict, or start a replacement Change Workspace. Two recovery runs at two shas produce a Semantic Decision Diff.

---

## 5. Scope

### 5.1 In scope (v1)
Agent inspections deriver; session-commit extraction; recovery pipeline (candidates → plan → prompt → firewall → persist); `DecisionTrace` synced kind; Decisions tab + detail; basis badges; blast radius v1; replacement-change seeding; challenge via Assisted; `DecisionDiff` local-only; dogfood fixture; parser v1.2.0 with sidechain linking.

### 5.2 Out of scope (v1)
Prediction prompts (PRD §11); teach-back; AST or import-graph analysis (Flow Map); reverse traversal blast radius (Flow Map); `apply_patch` hunks; git history ingestion from `.git`; automatic supersession; merging the demo branch; ranking; any change to Decision Investigation.

---

## 6. Vocabulary

- **Decision** — an `UnderstandingObject` with `type: 'decision'`. Title is the statement.
- **DecisionTrace** — one recovery run's structured reconstruction of one decision against one repository snapshot. Append-only per `(decisionObjectId, runId)`.
- **Basis** — `specified | inherited | inferred | invented | unknown`. "Specified" is the vision's REQUIRED.
- **Made by** — `user | agent | agent_user_adopted | unknown`, derived from span roles.
- **Unsupported autonomous** — `madeBy === 'agent'` and basis `invented` or `unknown`.
- **Transcript span** — a verified verbatim quote of one normalized step with recomputed offsets.
- **Agent inspection** — a Read / Grep / Glob / LS tool call, derived from the step stream. What the agent saw.
- **Run** — one invocation of recovery over a project; `runId` groups its traces and keys the diff.
- **Semantic Decision Diff** — entries `new_decision | revised | new_assumption | invalidated | unresolved` between two runs.

---

## 7. Data model

### 7.1 Decision object — `UnderstandingObject { type: 'decision' }`

Synced through the existing `understanding_object` kind. `title` = statement; `body` = why at creation. Scalar `meta`:

| key | type | source |
|---|---|---|
| `madeBy` | `DecisionMadeBy` | derived §7.3 |
| `basis` | `DecisionBasis` | model label after §9.4 constraint |
| `unsupportedAutonomous` | boolean | derived §7.3 |
| `conflictsWithUserDirection` | boolean | DI promotion only (§7.4) |
| `decidedAt` | ISO string | message time of first citing step |
| `firstStepIndex` | number | ordering key (law 2.7) |
| `primaryPath` | string | first edited path among cited anchors, else first code-evidence path, else `''` |
| `source` | `'recovery' \| 'investigation' \| 'workspace' \| 'manual'` | |
| `latestTraceId` | string | denormalized |
| `confidence` | number 0..1 | model's, display only |

### 7.2 New — `src/types/decision.ts`

```ts
export type DecisionBasis = 'specified' | 'inherited' | 'inferred' | 'invented' | 'unknown';
export type DecisionMadeBy = 'user' | 'agent' | 'agent_user_adopted' | 'unknown';
export type DecisionSource = 'recovery' | 'investigation' | 'workspace' | 'manual';

export interface TranscriptSpan {
  conversationId: string;
  messageId: string;
  stepIndex: number;
  role: StepKind;            // 'user_msg' | 'agent_text' | 'tool_call' | 'tool_result'
  quote: string;             // ≤ MAX_QUOTE_CHARS, substring-verified
  startOffset: number;       // recomputed (UTF-16)
  endOffset: number;
}

export interface DecisionAssumption {
  id: string;
  statement: string;
  basis: DecisionBasis;
  transcriptEvidence: TranscriptSpan[];
  codeEvidence: CodeEvidence[];        // from intentTrace.ts
  inheritedFrom?: string;
  rationale?: string;                  // ≤ MAX_AI_TEXT_CHARS
}

export interface DecisionAlternative {
  statement: string;
  transcriptEvidence: TranscriptSpan[];
  rejectedBecause?: string;
}

export interface DecisionInvalidation {
  decisionObjectId: string;
  assumptionId?: string;
  evidence: TranscriptSpan[];
  codeEvidence: CodeEvidence[];
}

export interface DecisionTrace {
  id: string;
  projectId: string;
  decisionObjectId: string;
  runId: string;
  repoKey?: string;                    // 'gh:owner/repo' | 'fs:<name>' when a snapshot was bound
  sha?: string;                        // 40-hex or 'local'
  why?: string;
  alternatives: DecisionAlternative[];
  assumptions: DecisionAssumption[];
  transcriptEvidence: TranscriptSpan[]; // ≥ 1 (law 2.1)
  anchorStableKeys: string[];           // exact hunks
  implEvidence: CodeEvidence[];         // firewall-verified
  symbols: string[];                    // declared identifiers in cited hunks (regex)
  testPaths: string[];                  // basename heuristic at trace time
  invalidates: DecisionInvalidation[];
  fetchedPaths: string[];               // audit
  provider: 'anthropic' | 'openai';
  model: string;
  warnings: string[];
  createdAt: Date;
}

export interface AgentInspection {       // LOCAL-ONLY
  id: string;                            // `${sourceRef}#s${stepIndex}`
  conversationId: string;
  messageId: string;
  stepIndex: number;
  toolName: string;
  kind: 'read' | 'search' | 'list';
  path?: string;                         // normalized, repo-relative when resolvable
  pattern?: string;
  occurredAt: Date;
  deriverVersion: string;
}

export type DecisionDiffOp = 'new_decision' | 'revised' | 'new_assumption' | 'invalidated' | 'unresolved';

export interface DecisionDiffEntry {
  op: DecisionDiffOp;
  decisionObjectId: string;
  assumptionId?: string;
  fromTraceId?: string;
  toTraceId?: string;
  changedFields?: string[];
  evidence?: TranscriptSpan[];
  codeEvidence?: CodeEvidence[];
}

export interface DecisionDiff {          // LOCAL-ONLY, derived
  id: string;                            // `${fromRunId}..${toRunId}`
  projectId: string;
  fromRunId: string; toRunId: string;
  fromSha?: string; toSha?: string;
  entries: DecisionDiffEntry[];
  differVersion: string;
  createdAt: Date;
}
```

### 7.3 Derivations (never model-asserted)

- `madeBy`: any verified `user_msg` span → `user`; if an `agent_text` span with a lower `stepIndex` also cites the same decision → `agent_user_adopted`; only `agent_text`/`tool_call` spans → `agent`; no spans → the decision is dropped, so `unknown` arises only via §7.4.
- `unsupportedAutonomous = madeBy === 'agent' && (basis === 'invented' || basis === 'unknown')`.
- `primaryPath`, `firstStepIndex`, `decidedAt` from the cited anchors and spans.

### 7.4 Human override — promotion from Decision Investigation

`src/lib/understanding/decisions/fromInvestigation.ts` → `promoteDecisionFinding(findingId)` calls the existing `promoteFindingToCurrentUnderstanding`, reads the case's latest `VerdictRevision`, and writes meta from this map. No `DecisionTrace` is created; the detail view shows "Adjudicated by you in case …".

| VerdictOrigin | basis | madeBy | flags |
|---|---|---|---|
| `user_directed` | specified | user | |
| `agent_proposed_user_adopted` | specified | agent_user_adopted | |
| `agent_implemented_without_recorded_discussion` | invented | agent | unsupportedAutonomous |
| `inherited_default` | inherited | agent | |
| `emergent_across_exchanges` | inferred | unknown | |
| `conflicts_with_user_direction` | invented | agent | conflictsWithUserDirection, unsupportedAutonomous |
| `indeterminate` | unknown | unknown | |

### 7.5 Storage (Dexie v13)

```
decisionTraces:   '&id, projectId, decisionObjectId, runId, createdAt, [projectId+createdAt], [decisionObjectId+createdAt], [projectId+runId]'   // synced
agentInspections: '&id, conversationId, path, [conversationId+stepIndex]'                                                                      // LOCAL-ONLY
decisionDiffs:    '&id, projectId, toRunId, createdAt'                                                                                         // LOCAL-ONLY
```
`UnderstandingProject.lastDecisionRecoveredAt?: Date` — unindexed cursor, serializer spread, no bump.

### 7.6 Sync

New kind `decision_trace` (14 chars, within varchar(32)). Parent = `decisionObjectId`; deleting an `understanding_object` cascades its traces (mirror `engine.ts` intent_trace cascade). Backend: `KindSchema` + Drizzle enum. **Deploy backend before frontend.**

---

## 8. Capture (stage 01)

### 8.1 Agent inspections — `src/lib/investigation/agentInspections.ts`
Derived from `normalizeSession()` like anchors. Tools: `Read` → `read` (path from `file_path`), `Grep` → `search` (`pattern`, `path`), `Glob` → `search` (`pattern`, `path`), `LS` → `list` (`path`). **Read-only Bash commands count too** (added in DR-6 after the dogfood session read every file through the shell): `cat`/`sed -n`/`head`/`tail` → `read`, `grep`/`rg` → `search`, `ls`/`find` → `list`, parsed per `;`/`&&`/pipeline stage; segments that write or run anything (`sed -i`, redirections, `npm`, `git commit`, heredocs) are ignored. Deriver version 1.1.0. Paths normalized with `normalizePath` and made repo-relative with the conversation's `projectPath` / `workingDirectory`. `deriveAgentInspectionsForConversation`, `deriveAgentInspectionsForAllAgentSessions` (backfill), invoked from import alongside anchors. Cascades with conversation delete; cleared by `clearAllData`.

### 8.2 Session commits — `src/lib/understanding/decisions/sessionCommits.ts`
`extractSessionCommits(steps)`: Bash `tool_call` whose `command` matches `/\bgit\s+commit\b/`, paired to its `tool_result` (by `toolUseId`, fallback next step), regex `/^\[([^\s\]]+)\s+(?:\(root-commit\)\s+)?([0-9a-f]{7,40})\]/m`. Not persisted; shown in `RepoBindingCard` as a suggested sha.

### 8.3 Parser v1.2.0 — DR-7
`ClaudeCodeEntryMetadata` gains `uuid`, `parentUuid`, `isSidechain`, `agentId`, `promptId`, `userType`, `version`. `StoredMessage.sourceMeta?` carries the identity fields when present. Subagent transcripts are sibling files (`<sessionId>/subagents/agent-<agentId>.jsonl`) that carry the parent's `sessionId`; the parser gives them the conversation id `${sessionId}:agent:${agentId}` and `providerMeta { isSidechain: true, agentId, parentSessionId }`, and the detail view labels spans from such conversations "delegated" (observed 2026-09-07 from a real session).

---

## 9. Recovery pipeline — `src/lib/understanding/decisions/`

### 9.1 Candidates — `candidates.ts` (deterministic)
For each associated Claude Code conversation (reuse `getAssociatedConversations`): normalize; load anchors and inspections. Build transcript excerpts: every `user_msg` step in full (cap 4000 chars each); for each anchor, the preceding `agent_text` steps within a window of 6 plus the hunk (`oldString`/`newString` capped 1500 chars each, `scrubSecrets`); and the agent's **closing statements** — the last 2 `agent_text` steps after the final edit (cap 4000 each), kept like user messages because agents state permanence, cascades, and omissions in their wrap-up (DR-6 finding). Each excerpt is tagged `<step index=N role=R>`. Total cap 60 000 chars; over cap, drop oldest anchors first and record a warning. Repo excerpts only when `latestCachedSnapshot` exists: `selectCandidateFiles` seeded from anchor paths and inspected paths, `isFetchAllowed`, `excerptFile` windows; each path marked `preExisting` when it is in the tree and no `write` anchor created it. Existing decision objects (not rejected) summarized `{id, title, basis}` for re-recognition.

### 9.2 Plan — `runRecovery.ts` → `planRecovery(projectId, opts)`
`RecoveryPlan { projectId, runId, repoKey?, sha?, conversations[{conversationId, title, source, anchorCount, excerptChars}], filePaths, hunkCount, skipped[], existingDecisionIds, warnings }`. Built before any provider call; feeds `DisclosureModal`.

### 9.3 Prompt — `prompt.ts` → `buildRecoveryMessages(plan, excerpts)`
System prompt states the six stages briefly, the basis vocabulary with its constraints, and the verbatim-quote rule. JSON response:

```json
{ "decisions": [ {
    "existingObjectId": null,
    "statement": "…", "why": "…", "confidence": 0.8, "basis": "inferred", "inheritedFrom": null,
    "evidence": [ { "stepIndex": 12, "quote": "…" } ],
    "implementedBy": { "anchorStepIndexes": [14], "code": [ { "path": "src/…", "quote": "…" } ] },
    "alternatives": [ { "statement": "…", "evidence": [], "rejectedBecause": "…" } ],
    "assumptions": [ { "statement": "…", "basis": "inherited", "evidence": [ … ], "code": [ … ], "inheritedFrom": "src/lib/db/conversations.ts", "rationale": "…" } ]
  } ],
  "invalidates": [ { "existingObjectId": "…", "assumptionStatement": null, "evidence": [ … ], "code": [ … ] } ] }
```
Caps: `MAX_DECISIONS_PER_CALL` 20, `MAX_ASSUMPTIONS` 8, `MAX_ALTERNATIVES` 4.

### 9.4 Firewall — `firewall.ts` → `parseRecoveryResponse(text, ctx)`
1. `verifyTranscriptSpan`: `stepIndex` must be a supplied excerpt; `locateQuote` against the step text; offsets recomputed; role copied from the step. Unverifiable → dropped + warning.
2. Code evidence → `verifyCodeEvidence` against the fetched map.
3. `anchorStepIndexes` → must be supplied anchors → mapped to `stableKey`s.
4. Basis constraint (law 2.2) via `constrainBasis(label, spans, code, ctx)`.
5. Decision with zero verified spans → dropped. Assumption with zero verified spans → dropped.
6. `existingObjectId` not in the plan → treated as new.
7. `madeBy`, `unsupportedAutonomous` derived (§7.3).

### 9.5 Run — `runRecovery(plan, config, { onProgress })`
`assertNoSecrets` on the payload; `complete()` via `relayClient.ts`; per conversation batch, failures isolated as warnings. Persist per decision in one transaction: new → `createUnderstandingObject({ type: 'decision', origin: 'ai', evidence, meta })`; re-recognized → `recordUnderstandingEvent` `supported` or `refined`, pending; `putDecisionTrace`. Update `lastDecisionRecoveredAt`.

---

## 10. User experience

### 10.1 Placement
Project tab **Decisions** (`/projects/:id/decisions`) after Intent Trace; detail at `/projects/:id/decisions/:objectId`.

### 10.2 List
Rows ordered by `firstStepIndex` within session, grouped by session or by `primaryPath`. Row: basis badge · made-by chip · statement · assumption count · review state · latest trace sha (short) · evidence deep links. Filters: basis, made by, review state, unsupported only, session. Header: run picker, **Recover decisions**, **Compare runs**, `RepoBindingCard`. Unsupported autonomous rows carry the only accent treatment.

### 10.3 Detail
Sections: Decision · Made by · Why · Alternatives · Assumptions (basis badge, evidence links each) · Implemented by (hunks open the anchor route read-only; code lines open from the repo cache) · Evidence (transcript spans → conversation message) · Blast radius (lazy) · Actions: `ReviewButtons`, **Challenge**, **Prepare replacement change**. Investigation-promoted decisions show "Adjudicated by you in case …" instead of a trace.

### 10.4 Disclosures
Recovery: conversations, sources, cross-provider status, hunk count, repository-excerpt count. Challenge: reuses the Assisted disclosure.

### 10.5 Rendering rules
Every model-authored string is labelled AI and capped. Every evidence item opens its primary source. Nothing is preselected for review.

---

## 11. Decision → code and blast radius v1

### 11.1 implementedBy
`anchorStableKeys` (deterministic hunks) + `implEvidence` (verified). `symbols.ts` extracts declared identifiers from cited `newString`s with a declaration regex plus `symbolFromLabel`.

### 11.2 `blastRadius.ts` → `computeBlastRadius(trace, projectId)` — no model, no network, never stored
```ts
interface BlastRadius {
  symbols: Array<{ name: string; declaredIn: string[]; references: SearchHit[] }>;
  referencingFiles: string[];
  relatedSessions: Array<{ conversationId: string; paths: string[]; anchorCount: number }>;
  relatedDecisions: Array<{ objectId: string; sharedPaths: string[] }>;
  tests: string[];
  verification: 'heuristic';
  truncated: boolean;
}
```
`findReferences` / `grep` over `repoFiles` at `trace.sha` excluding the trace's own paths; `investigationAnchors.where('filePaths').anyOf(paths)`; latest traces per decision sharing paths; tests by `${basename}.(test|spec).*` and `__tests__/`. Flow Map later replaces the symbol/file/test legs with reverse link traversal.

### 11.3 Replacement change
`WorkspaceOriginKind` gains `'decision'`. `PrepareChangePage` reads `?decision=<objectId>` and seeds a draft: title `Replace: <statement>`, current behavior = statement + why, constraints = assumptions with basis specified/inherited, open choices = the rest, evidence from spans and `implEvidence`, `originRef { kind: 'decision', id }`.

### 11.4 Challenge
`challenge.ts` wraps the Assisted `challenge_explanation` pipeline with the decision's why + assumptions as the explanation and its evidence paths as context. Result → `recordUnderstandingEvent({ op: 'contradicted' | 'supported', origin: 'ai', reviewState: 'pending' })`. If `AssistedContext` cannot host it, add `challengeDecision` to `AssistedAction` with the same firewall.

---

## 12. Semantic Decision Diff — `diff.ts`

`foldDecisionDiff(fromTraces, toTraces)` given latest trace per decision in each run:
- object in `to`, not in `from` → `new_decision`
- in both, any of {why, alternatives set, assumptions set, basis, implEvidence path set} differ → `revised` + `changedFields`
- assumption (normalized statement) in `to` not in `from` → `new_assumption`
- each `to.invalidates[]` entry → `invalidated` (evidence copied)
- object in `from` with no trace in `to` and no invalidation → `unresolved`

Persisted LOCAL-ONLY with id `${fromRunId}..${toRunId}`; `DIFFER_VERSION = '1.0.0'`. UI: pick two runs → entries grouped by op → each opens the decision; `invalidated` offers "Record as contradicted" (user-origin event).

---

## 13. Privacy, security, and offline behavior

### 13.1 Audit
- **S1** `agentInspections`, `decisionDiffs` absent from `engine.ts` (test via `localOnly.test.ts` pattern).
- **S2** `assertNoSecrets` before every provider call; GitHub token and provider keys never enter a prompt.
- **S3** `scrubSecrets` on hunks, excerpts, and every stored quote.
- **S4** `isFetchAllowed` on every repository path; sensitive denylist honoured.
- **S5** Quote caps (`MAX_QUOTE_CHARS`), AI text caps (`MAX_AI_TEXT_CHARS`), excerpt caps (§9.1).
- **S6** Relay untouched; transit-only.
- **S7** Prompt-injection posture: transcript text is untrusted input; the firewall lets the model only *point at* text, never assert unlocatable facts. Free-text `statement/why/rationale` are capped and labelled AI.
- **S8** Blast radius makes zero network calls (guided-constraint test).
- **S9** Envelope cleartext fields for `decision_trace` are ids and timestamps only.
- **S10** Import-boundary guard extended: `src/lib/understanding/decisions/*` never imports `src/lib/investigation/*` except the read-only anchors/inspections db accessors.

### 13.2 Offline
List, detail, blast radius, and diff work offline from IndexedDB. Recovery and challenge require the user's provider.

### 13.3 CLAUDE.md amendment (DR-6)
Invariant 6 gains: *"Transcript excerpts and edit hunks sent for decision recovery are user data under the same user-initiated, disclosed, transit-only conditions."*

---

## 14. Required tests

- Dexie v13 round trips; `localOnly.test.ts` extended (verno 13, two new local tables absent from the engine).
- Serializer round trip for `decision_trace`; engine apply / remove / cascade / full-push coverage.
- `agentInspections` deriver on a golden trace; idempotent ids.
- `extractSessionCommits` on constructed steps.
- Firewall: every downgrade path in law 2.2; dropped unverifiable spans; recomputed offsets; re-recognition; `madeBy` derivation; plan-before-call ordering with a mocked relay.
- `symbols` extraction; blast radius over a fixture snapshot with `verification: 'heuristic'`; zero `fetch`.
- Diff: all five ops; idempotent id; determinism.
- Page test for the Decisions tab mirroring `IntentTracePage.test.tsx`.
- Fixture `tests/decision-fixtures/project-deletion.*` through candidates → firewall.

---

## 15. Milestones

| # | Scope | Acceptance |
|---|---|---|
| **DR-0** | This spec; build log; TODOs; README row; CLAUDE.md "Next up"; Flow Map draft → v14 | docs committed |
| **DR-1** | `src/types/decision.ts`; Dexie v13; db helpers; sync kind `decision_trace` frontend + backend; `agentInspections` deriver + backfill + import hook + cascade; `sessionCommits.ts` | typecheck + tests green; trace round-trips through sync in tests |
| **DR-2** | `candidates.ts`, `prompt.ts`, `firewall.ts`, `runRecovery.ts`, `symbols.ts`, `decisionMatrix.ts`, `fromInvestigation.ts` | canned response → N pending objects + traces, zero accepted, zero superseded |
| **DR-3** | Routes, tab, `DecisionsPage`, `BasisBadge`, `DecisionDetail`, `AssumptionList`, run + disclosure | page test; every row opens its step and hunk |
| **DR-4** | `blastRadius.ts` + panel; `WorkspaceOriginKind 'decision'` + `?decision=` seeding; `challenge.ts` | unsupported decision → blast radius → pre-filled draft workspace; challenge lands pending only |
| **DR-5** | `diff.ts`, `decisionDiffs` helpers, `DecisionDiffView`, run picker, record-as-contradicted | two runs → persisted diff; accepting `invalidated` writes a user event |
| **DR-6** | Dogfood session (§16), sanitized fixture, §16 manual scenario, CLAUDE.md amendment, status → built; Bash-read inspections; closing statements in excerpts; decision-level `inheritedFrom`; quiet-commit sha fallback | fixture tests green ✔ |
| **DR-7** | Parser v1.2.0, `sourceMeta`, sidechain linking, "delegated" labels | golden traces unchanged; sidechain fixture parses linked |

---

## 16. Manual acceptance scenario (the killer demo)

**How the demo session was produced (DR-6, 2026-09-07).** A nested `claude -p --dangerously-skip-permissions` run is blocked by the auto-mode classifier, so the session was run as a **subagent of the building session** in this repo on branch `demo/project-deletion` (from the DR-7 HEAD, not `main`, so it saw the same code Jacob runs). Its transcript is a real Claude Code sidechain file (`<sessionId>/subagents/agent-….jsonl`), sanitized into `tests/decision-fixtures/project-deletion.jsonl`. It committed `9987455` ("feat(projects): delete a project from its overview page, keeping conversations"); the branch is **not pushed and not merged** (recon P5). Two findings changed the pipeline: the agent read files only through Bash (§8.1 now derives inspections from `sed -n`/`cat`/`grep`), and it stated most decisions in its closing summary (§9.1 now always includes the closing agent statements). The canned response in `project-deletion.response.json` quotes that transcript; the firewall pins **2 specified · 1 inherited · 3 inferred · 1 invented (unsupported autonomous)** and drops a fabricated eighth decision.

1. On a branch from `main`, run an unsteered Claude Code session in this repo with the prompt: *"Add project deletion to Chatdex. It must be reachable from the project page, and deleting a project must not delete the conversations associated with it."* Let it commit. Push the branch. Do not merge.
2. Import the session JSONL from `~/.claude/projects/-Users-jacie-dev-apps-chatdex/` via the Import page directory picker.
3. Open the Chatdex understanding project, associate the conversation, bind `gh:Kakob/Chatdex` at the agent's commit sha (suggested by the session-commit extractor), index.
4. Decisions tab → **Recover decisions** → disclosure lists the conversation, source, hunk count, excerpt count → run.
5. Expect decisions of the shape: reachable from project page (specified); conversations survive (specified); cascade mirrors `deleteConversation` (inherited); confirmation pattern copied (inherited); active-project fallback (inferred); optimistic / failure restore (inferred or invented); no audit record, permanent (invented → unsupported autonomous). The real split is what the fixture pins.
6. Open the unsupported autonomous decision. Its transcript span, hunk, and code lines each open. Blast radius lists references, related sessions, tests, labelled heuristic.
7. **Challenge** → disclosure → a pending `contradicted` or `supported` event appears in history.
8. **Prepare replacement change** → a draft workspace opens with constraints and open choices pre-filled and origin "decision".
9. Recover again at a second sha → **Compare runs** shows diff entries.

---

## 17. Definition of done

All DR milestones committed with build-log hashes; §14 tests green; §16 walked once by Jacob on the real session; CLAUDE.md status "built"; TODOs file has only Jacob-side items open.

---

## 18. Later work explicitly deferred

- Flow Map approval → FM-0 at Dexie v14; FM-4 bridge "decisions implemented in this flow"; reverse traversal replaces blast-radius symbol/file/test legs.
- Prediction before reveal (PRD §11) as a form on the decision detail; teach-back as user-authored events.
- Manual "same as …" merge when re-recognition misses (planned in DR-5 if time allows).
- Batching oversized sessions into multiple calls.
- Sync-registry refactor (recon P9); `decision_trace` is the fourth hand-rolled kind.

---

## 19. Roadmap decisions (2026-09-07, Jacob)

- **D1** Decision Recovery is a new track in the Understanding lineage; Decision Investigation untouched; `VerdictOrigin` vocabulary reused.
- **D2** Decision object ships before Flow Map; blast radius is text-level until then.
- **D3** Demo runs on a dogfooded real session, not a synthetic fixture alone.
- **D4** Stage 05 in this wave is the epistemic diff only.
- **Defaults accepted:** Flow Map to v14; inherited oracle approximation acceptable; merge action in DR-5 if time allows; `gh:` snapshot for the demo; challenge via wrapper first; drop-oldest + warn for oversized sessions; caps + AI label suffice for free text; `agentInspections` joins the conversation cascade.
