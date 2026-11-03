# Chatdex Ownership Audit

This is my working program for developing ownership of the Chatdex codebase.

The goal is not to memorize every line of code. The goal is to progressively become able to:

1. Predict important behavior before running the code.
2. Locate the implementation responsible for that behavior.
3. Trace relevant control flow, state, and data.
4. Make small changes safely.
5. Predict the consequences of those changes.
6. Verify the resulting behavior.
7. Understand important invariants, boundaries, and failure modes.
8. Explain and defend important implementation and design decisions.

## How This Works

The basic unit of work is an **ownership exercise**.

For each exercise:

1. Pick the next exercise from the backlog below.
2. Create an exercise file under `exercises/`.
3. Write my prediction **before** investigating the answer.
4. Trace the relevant code.
5. Make the modification if the exercise calls for one.
6. Verify my prediction or modification.
7. Record what I misunderstood and what I learned.
8. Mark the exercise complete here.
9. Add one row to [`audit-log.md`](audit-log.md).

Detailed evidence lives in `exercises/`.

The audit log records what I actually completed.

This README tracks the planned curriculum and overall progress.

---

# Exercise Types

Every exercise declares a type. The type determines what the record has to contain.

**Predict** — form a behavioral prediction before reading the implementation, then verify it.

**Trace** — follow control and data flow across one or more hops in my own words.

**Modify** — change behavior and predict the consequences before running anything.

**Boundary** — probe an edge: empty input, missing record, exceeded cap, absent permission.

**Failure** — force something to go wrong and find where the failure becomes visible.

**Characterize** — write a test that pins **current** behavior.

**Specify** — write a test that asserts **intended** behavior, taken from a spec law or an
architectural invariant.

## Characterize vs. Specify

These are not interchangeable, and the difference is the whole point of auditing AI-generated code.

A characterization test on code I have not yet interrogated **freezes whatever is there, bugs
included**, and makes the bug harder to fix later because now a test defends it.

A003 is the proof. `"12 passed, 0 failed"` is misclassified today. If I had written a
characterization test for it before predicting it, I would have locked the misclassification in.

**Sequencing rule: never write a test for code before the Predict exercise on that code.**

Per subsystem the order is:

```text
Predict → Trace → Characterize → Specify → Mutate
```

## Extra fields for test-writing exercises

A Characterize or Specify exercise records three things a Predict exercise does not:

1. **Will this test pass on the first run?** If I am certain it passes, I am characterizing, not
   specifying.
2. **Red-first check.** Did the test fail for the *right reason* before I made it pass? This applies
   even to tests written against existing code: break the code deliberately, confirm the test
   catches it, restore.
3. **What did I pin?** Explicitly — intended behavior, or accidental behavior I now cannot change
   without a failing test?

---

# Ownership Levels

**Unknown** — I have not investigated the behavior.

**Recognized** — I roughly know what it does and where it lives.

**Predictable** — I can predict representative behavior before executing it.

**Modifiable** — I can locate it, change it safely, and verify the result.

**Owned** — I understand its important responsibilities, boundaries, invariants, consequences, and failure modes well enough to change or defend it.

---

# Progress

## Part I — The ramp (A001-A075)

* [ IN PROGRESS ] Level 1 — Pure functions
* [ ] Level 2 — Transformations and small domain rules
* [ ] Level 3 — Data and persistence
* [ ] Level 4 — Golden-path vertical slices
* [ ] Level 5 — React/UI state
* [ ] Level 6 — Import, security, sync, and backend
* [ ] Level 7 — Ownership pressure tests

## Part II — Subsystem coverage (A076-A176)

* [ ] Block 1 — Normalization substrate
* [ ] Block 2 — Detectors and findings
* [ ] Block 3 — Findings surfacing
* [ ] Block 4 — Import and parsing
* [ ] Block 5 — Persistence and the local-only cache
* [ ] Block 6 — Crypto, unlock, session
* [ ] Block 7 — Sync and the ciphertext invariant
* [ ] Block 8 — LLM relay and provider boundary
* [ ] Block 9 — Understanding layer
* [ ] Block 10 — Investigation and Change Workspace laws
* [ ] Block 11 — UI state
* [ ] Block 12 — Invariant guard tests

## Part III — Test coverage (A177-A224)

* [ ] Block 13 — Test infrastructure
* [ ] Block 14 — Characterization tests
* [ ] Block 15 — Specification tests
* [ ] Block 16 — Mutation exercises
* [ ] Block 17 — Component and hook tests

**Completed:** 0 / 224

## Where to start

Not at A076. Two exercises jump the queue:

1. **A176** — enumerate all 25 binding rules and determine which are mechanically enforced. This
   produces the map of where the codebase is actually undefended, and will probably reorder
   everything below it.
2. **Block 16** — mutation exercises belong far earlier than their numbering suggests, probably
   right after Block 1. Breaking a line and seeing whether any test notices is the fastest
   available feedback on whether ownership is real or narrative.

Then Block 1 (highest leverage — three subsystems share the normalization substrate), then Block 6
or 8 (worst consequence, least existing coverage).

---

# Exercise Backlog

## Level 1 — Pure Functions

Goal: become comfortable reasoning about small pieces of existing code without having an agent explain them first.

* [ IN PROGRESS ] **A001 — Undefined run outcome**
  Predict `classifyRunOutcome(undefined)`.

* [ ] **A002 — Passing Vitest output**
  Predict `classifyRunOutcome()` for representative passing Vitest output.

* [ ] **A003 — Zero failures misclassification**
  Predict `"12 passed, 0 failed"`, investigate the result, and fix the misclassification.

* [ ] **A004 — Passing zero, failing three**
  Predict `"0 passed, 3 failed"`.

* [ ] **A005 — Test command recognition**
  Add one previously unsupported test-command form to `TEST_COMMAND_RE`.

* [ ] **A006 — Empty verification rows**
  Predict `verificationRows()` with zero criteria.

* [ ] **A007 — New verification rows**
  Predict `verificationRows()` with criteria but no existing verification.

* [ ] **A008 — Existing verification row**
  Predict `verificationRows()` with one existing verification row.

* [ ] **A009 — Verification timestamp**
  Modify the default `updatedAt` behavior and verify the consequences.

* [ ] **A010 — Hint without evidence**
  Predict `deriveVerificationHint()` with no evidence.

* [ ] **A011 — AI evidence only**
  Predict `deriveVerificationHint()` with AI evidence only.

* [ ] **A012 — Conflicting runtime evidence**
  Predict the result with one passing and one failing piece of evidence.

* [ ] **A013 — Code evidence only**
  Predict the result with code evidence but no runtime evidence.

* [ ] **A014 — Unverified criterion with note**
  Predict `verificationSummary()` with a note on an unverified criterion.

* [ ] **A015 — Summary rule modification**
  Change one summary rule and add a regression test.

### Level 1 Checkpoint

I can inspect a roughly 20–50 line pure function, form a behavioral prediction, locate its important decisions, and test my understanding without requiring an agent to explain the function first.

---

## Level 2 — Transformations and Small Domain Rules

Goal: move from isolated functions toward connected transformations.

* [ ] **A016 — Tool-call command extraction**
  Predict how a command is extracted from `command`, `cmd`, or `script`.

* [ ] **A017 — Command precedence**
  Change the precedence of `command`, `cmd`, and `script`.

* [ ] **A018 — Missing string command**
  Predict what happens when none of the command fields contains a string.

* [ ] **A019 — Test-run step extraction**
  Construct three `Step`s and predict `findTestRunSteps()`.

* [ ] **A020 — Missing matching tool result**
  Remove a matching tool result and predict fallback behavior.

* [ ] **A021 — Distant tool result**
  Move the result more than three steps away and predict the behavior.

* [ ] **A022 — Fallback search window**
  Change the fallback search window and verify the result.

* [ ] **A023 — Command truncation**
  Predict the 200-character command truncation behavior.

* [ ] **A024 — Command truncation modification**
  Change the command limit and verify it.

* [ ] **A025 — Result excerpt**
  Predict the 600-character result excerpt behavior.

* [ ] **A026 — Secret scrubbing**
  Feed a secret-looking value through the evidence path and locate where scrubbing occurs.

* [ ] **A027 — Blank manual observation**
  Predict `manualObservationEvidence()` for `"   "`.

* [ ] **A028 — Observation normalization**
  Predict it for `"  worked in Chrome  "`.

* [ ] **A029 — Normalization modification**
  Change one normalization rule.

* [ ] **A030 — Normalization boundary**
  Add a boundary test for the changed normalization rule.

### Level 2 Checkpoint

I can trace several cooperating functions and explain where transformation, normalization, classification, truncation, and evidence construction occur.

---

## Level 3 — Data and Persistence

Goal: understand one entity through its persistence lifecycle rather than attempting to read the entire database layer.

* [ ] **A031 — Persist one record**
  Create one record and predict its persisted representation.

* [ ] **A032 — Reconstruct one record**
  Retrieve it and identify transformations from persistence to domain object.

* [ ] **A033 — Missing ID**
  Predict lookup behavior for a nonexistent ID.

* [ ] **A034 — Duplicate ID**
  Predict duplicate-ID behavior.

* [ ] **A035 — Ordering rule**
  Change one ordering rule and verify the effect.

* [ ] **A036 — Deletion**
  Predict deletion behavior.

* [ ] **A037 — Parent deletion**
  Determine whether deleting a parent removes, rejects, or orphans its children.

* [ ] **A038 — Project isolation**
  Test whether data belonging to one project remains isolated from another.

* [ ] **A039 — Conversation in two projects**
  Test the same conversation associated with two projects.

* [ ] **A040 — Freshness calculation**
  Locate one timestamp/freshness calculation and perturb its timestamp.

* [ ] **A041 — Reload reconstruction**
  Write data, reload, and predict the reconstructed state.

* [ ] **A042 — Persistence failure**
  Force one persistence error and trace where the failure becomes visible.

### Level 3 Checkpoint

I can follow at least one important Chatdex entity through creation, storage, retrieval, transformation, update, deletion, and failure.

---

## Level 4 — Golden-Path Vertical Slices

Goal: understand Chatdex through its actual product workflow.

Core conceptual sequence:

```text
Project
→ Investigate
→ Current Understanding
→ Prepare Change
→ Verification
```

* [ ] **A043 — Project creation**
  Trace creation of a project.

* [ ] **A044 — Project rename**
  Change a project's name and predict every affected surface.

* [ ] **A045 — Conversation → project**
  Trace one conversation into a project.

* [ ] **A046 — Investigation selection**
  Trace selection of an investigation from UI event to rendered result.

* [ ] **A047 — No-investigation state**
  Predict the state when no investigation exists or is selected.

* [ ] **A048 — Investigation empty state**
  Change one empty-state behavior.

* [ ] **A049 — Finding → Current Understanding**
  Trace one finding into Current Understanding.

* [ ] **A050 — Whitespace-only finding**
  Prevent a whitespace-only finding.

* [ ] **A051 — Finding evidence**
  Trace evidence attached to a finding.

* [ ] **A052 — Finding/decision → Prepare Change**
  Trace one finding or decision into Prepare Change.

* [ ] **A053 — Criterion → verification**
  Trace one acceptance criterion through verification.

* [ ] **A054 — Criterion ordering**
  Change criterion ordering and verify the consequences.

* [ ] **A055 — Full vertical trace**
  Take one piece of demo data and trace it from seed → DB → domain → React → rendered UI.

### Level 4 Checkpoint

I can explain the important state transitions in the golden path and trace representative data across architectural layers.

---

## Level 5 — React/UI State

Goal: understand how visible behavior emerges from state transitions and how the UI behaves under awkward conditions.

For each exercise, predict:

```text
UI state
→ event
→ state transition
→ persistence effect
→ rendered result
```

* [ ] **A056 — Loading vs. empty**
* [ ] **A057 — Empty vs. nonexistent**
* [ ] **A058 — Selected entity deleted**
* [ ] **A059 — Project changes while entity selected**
* [ ] **A060 — Rapid user actions**
* [ ] **A061 — Rejected write**
* [ ] **A062 — Underlying data changes while mounted**
* [ ] **A063 — Refresh during golden path**

### Level 5 Checkpoint

I can trace important UI behavior from visible interaction through state and persistence and back to rendered output.

---

## Level 6 — Import, Security, Sync, and Backend

Goal: investigate important system boundaries where incorrect assumptions have larger consequences.

* [ ] **A064 — Minimal valid import**
  Import the smallest valid conversation and predict stored output.

* [ ] **A065 — Missing import field**
  Remove one required input field and trace failure handling.

* [ ] **A066 — Corrupt imported value**
  Corrupt one imported value and trace the consequences.

* [ ] **A067 — Encryption round trip**
  Encrypt and decrypt a known value and identify the important invariants.

* [ ] **A068 — Modified ciphertext**
  Alter ciphertext and predict failure behavior.

* [ ] **A069 — Frontend → backend → frontend**
  Trace one frontend API request through the backend and back.

* [ ] **A070 — Rejected sync**
  Trace one synchronization operation and determine what happens when the backend rejects it.

### Level 6 Checkpoint

I can trace representative behavior across import, security, client/server, and synchronization boundaries.

---

## Level 7 — Ownership Pressure Tests

Goal: move from asking "What does this code do?" to "Is this actually the behavior Chatdex should have?"

* [ ] **A071 — Cross-project identity**
  Determine whether the same conversation can exist in two project contexts without state leaking.

* [ ] **A072 — Staleness semantics**
  Determine exactly what makes Current Understanding stale and construct a counterexample.

* [ ] **A073 — Contradictory evidence**
  Determine whether contradictory evidence can accidentally appear verified.

* [ ] **A074 — Failure atomicity**
  Find a multi-step write, deliberately fail it partway through, and inspect what remains.

* [ ] **A075 — Golden-path reconstruction**
  Start with a fresh Chatdex and explain every important state transition from import through a verified prepared change. Then change one requirement and identify where the implementation must change.

### Final Checkpoint

I can reconstruct the important behavior of Chatdex, identify the code and decisions responsible for that behavior, modify important requirements, predict their consequences, and verify that the resulting system still satisfies its intended invariants.

---

# Part II — Subsystem Coverage Backlog

Part I is a ramp: 30 of its 75 exercises live in `src/lib/prepare/verification.ts` and its
neighbours, roughly 2,400 of ~43,000 LOC. That concentration is deliberate — low stakes are what
make it safe to be confused. Part II covers the rest of the system, weighted toward the code where
being wrong has consequences.

Each block names the investigation it feeds and the module it might eventually support. Those are
**candidates**, not a schedule. See "Candidate Investigations" and "Candidate Modules" below.

## Block 1 — Normalization substrate (A076-A084)

`src/lib/detection/normalize.ts`, `signatures.ts`, `classify.ts`

* [ ] **A076** Predict `normalizeSession()` step count and kinds for a 6-line JSONL fixture.
* [ ] **A077** Predict `normalizePath()` for three path forms (relative, absolute, `..`-containing).
* [ ] **A078** Predict `signatureFor()` on two tool calls differing only in whitespace and argument order.
* [ ] **A079** Drop one more volatile field from canonicalization; predict which golden traces flip.
* [ ] **A080** Predict `classifyBashCommand()` for one state-changing, one verification-shaped, and one neutral command.
* [ ] **A081** Predict `classifyToolCall()` and `isKnownTool()` for a tool the mapping has never seen.
* [ ] **A082** Add one command form to the classifier, plus its suppression/regression test.
* [ ] **A083** Predict `extractEditHunks()` output for a single edit.
* [ ] **A084** Trace normalize → signature → detector input: which `Step` fields survive, which are dropped?

**Feeds:** I1. **Toward module:** Normalization substrate — shared by detection, investigation, and
Intent Trace, making it the highest-leverage single module in the codebase.

## Block 2 — Detectors and findings (A085-A095)

`src/lib/detection/detectors/*`, `pipeline.ts`, `registry.ts`, `staleness.ts`, worker files

* [ ] **A085** Pick one golden trace; predict which detector fires before running `golden-traces.test.ts`.
* [ ] **A086** Predict `loop-legit-polling` — which suppression rule saves it, and is it recorded even when it does not fire?
* [ ] **A087** Change loop `N`/`M` via `DetectorConfig`; predict which golden traces flip.
* [ ] **A088** Predict `verificationAbsence` on a state change followed by a success assertion and no verification.
* [ ] **A089** Predict `reversion` on edit→revert, with and without acknowledgment language.
* [ ] **A090** **Invariant 4** — re-render "why this fired" from one stored finding's `evidence` alone. Find a detector where I cannot.
* [ ] **A091** **Invariant 3** — bump a detector's semver, re-run, predict the effect on existing findings and on `buildRunKey`.
* [ ] **A092** **Invariant 5** — register a no-op detector; predict what must change in pipeline, schema, or UI.
* [ ] **A093** Predict `computeDetectorRun` + `persistDetectorRun` on an already-analyzed session.
* [ ] **A094** Predict `findStaleSessions()` after a version bump.
* [ ] **A095** Trace `workerClient` → `worker` → `workerHandler` → `handleAnalyzeRequest`: what crosses the postMessage boundary, and what cannot?

**Feeds:** I2. **Toward module:** Detection pipeline.

## Block 3 — Findings surfacing (A096-A100)

`src/lib/detection/findingAnchors.ts`, `stats.ts`, `src/stores/findingsStore.ts`

* [ ] **A096** Predict `anchorMessageId` for a finding spanning steps with no backing message.
* [ ] **A097** Predict `getFindingChipSummaries` for a conversation with 0 and with 3 findings.
* [ ] **A098** Predict `busiestSpan` when two spans tie.
* [ ] **A099** Predict `weekStartOf` / `computeObservabilityStats` across a week boundary in a non-UTC timezone.
* [ ] **A100** Predict `findingsStore` state at each stage of an analyze run.

**Feeds:** I2, and the Level 5 UI questions.

## Block 4 — Import and parsing (A101-A108)

`src/lib/parsers/*`, `src/lib/db/rawSources.ts`

* [ ] **A101** Predict `sniffJSONContent` on a file that could plausibly be either format.
* [ ] **A102** Predict `detectFileFormat` precedence when two sniffs both return true.
* [ ] **A103** Predict `parseClaudeCodeContent` on a JSONL with one malformed line — skip, throw, or partial?
* [ ] **A104** Which parsers preserve `toolUseId`? Predict per parser, then verify. *(Upstream half of A001 — the proximity fallback exists because of whatever is found here.)*
* [ ] **A105** Predict `parseFiles` when one of three files fails.
* [ ] **A106** Predict ChatGPT mapping-tree flattening for a conversation with a regenerated branch.
* [ ] **A107** Re-import the same file; predict `rawSources` behavior.
* [ ] **A108** Add a format sniff for an unsupported export, with its test.

**Feeds:** I1. **Toward module:** Import & parsing.

## Block 5 — Persistence and the local-only cache (A109-A117)

`src/lib/db/*`, `src/lib/repo/*` — concretizes Level 3

* [ ] **A109** Read `db/schema.ts` and predict which tables are local-only before opening `localOnly.ts`.
* [ ] **A110** **CW §2.5** — locate the enforcement keeping `repoFiles` out of sync. If there is none, write the test.
* [ ] **A111** Predict `planIndex` / `ensureIndexed` re-index cost when a sha changes.
* [ ] **A112** Predict `describeSkips` for a repo with binaries and oversized files.
* [ ] **A113** Predict `isSafePattern` and `grep` behavior for a pathological regex.
* [ ] **A114** Predict the difference between `findSymbol` and `findReferences` on the same name.
* [ ] **A115** Predict `excerpt` at file start and end boundaries.
* [ ] **A116** Predict `forgetLocalDirectory()`'s return value and what remains afterward.
* [ ] **A117** Delete a conversation; predict what happens to its findings, anchors, and cases. *(Concretizes A037.)*

**Feeds:** I4, I8. **Toward modules:** Storage & entity lifecycle; Repository access & cache.

## Block 6 — Crypto, unlock, session (A118-A125)

`src/lib/crypto/*`, `src/lib/auth/*` — one test file across ~670 LOC

* [ ] **A118** Predict the `Sealed` shape from `encryptString`; predict IV behavior across two calls.
* [ ] **A119** Flip one ciphertext byte; predict the failure mode and where it surfaces to the user.
* [ ] **A120** Predict what `wrapMasterKey` puts server-side vs. device-local.
* [ ] **A121** Predict `unlock()` when PRF is unavailable.
* [ ] **A122** Predict `recoverWithCode` with a wrong code, and `parseRecoveryCode` on malformed input.
* [ ] **A123** Predict what is still readable in IndexedDB after `lock()`. **Then run it.**
* [ ] **A124** Predict `getMasterKey()` while locked — throw or null? Who catches it?
* [ ] **A125** Write the first test for `keyManager.ts`.

**Feeds:** I6. **Toward module:** Crypto & unlock.

## Block 7 — Sync and the ciphertext invariant (A126-A133)

`src/lib/sync/*`, `backend/src/routes/sync.ts`

* [ ] **A126** Predict exactly which fields of `envelopeConversation` are ciphertext; locate the encrypt call.
* [ ] **A127** Compare `envelopeFinding` against `envelopeTag` — same encryption discipline, or does one differ?
* [ ] **A128** Predict what `routes/sync.ts` can see, then read it and check.
* [ ] **A129** Round-trip envelope → push → pull → rehydrate; predict lossy fields.
* [ ] **A130** Predict `pullRecords` with a `since` cursor under clock skew.
* [ ] **A131** Reject a push mid-batch; predict local state. *(Feeds A074.)*
* [ ] **A132** Predict local consequences of `wipeServerData`.
* [ ] **A133** **Invariant 1** — write the first sync-side backend test asserting no plaintext in a payload.

**Feeds:** I5. **Toward module:** Sync.

## Block 8 — LLM relay and provider boundary (A134-A141)

`backend/src/routes/llm.ts`, `backend/src/llm/*`, `src/lib/providers/*`, the `understanding/trace/` guards

* [ ] **A134** Predict, then enumerate, every place in `routes/llm.ts` where a request or response body could reach a log line, an error trace, or the DB.
* [ ] **A135** Predict what `llm/sse.ts` buffers, and whether any error path echoes content.
* [ ] **A136** Predict where a provider failure surfaces differently in `complete` vs `streamComplete`.
* [ ] **A137** Predict where provider API keys live and whether they sync.
* [ ] **A138** Predict `buildDisclosure` text for a cross-provider case; find any path that could skip it.
* [ ] **A139** Predict `isFetchAllowed` / `isSensitivePath` / `isExcludedPath` for `.env`, `id_rsa`, `node_modules/`.
* [ ] **A140** Feed a token-shaped string through `scrubSecrets` / `assertNoSecrets`. *(Concretizes A026.)*
* [ ] **A141** Trace every consumer of `getGitHubToken()`; prove none is a relay body or a prompt.

**Feeds:** I5, I7. **Toward module:** LLM boundary.

## Block 9 — Understanding layer (A142-A152)

`src/lib/understanding/*` — the largest module, 4,131 LOC

* [ ] **A142** Predict `sampleDigestMessages` / `buildDigest` for a 500-message conversation.
* [ ] **A143** Predict `parseDiscoveryResponse` on malformed model output.
* [ ] **A144** Predict `runDiscoveryInBatches` when batch 2 of 4 fails.
* [ ] **A145** Predict `mergeEvidence` with duplicate refs.
* [ ] **A146** Predict `assembleCurrentUnderstanding` with two contradictory objects. *(Feeds A073.)*
* [ ] **A147** Predict what `parseReconcileResponse` lands as `pending`.
* [ ] **A148** **IT §2.1** — predict `isVerbatim` for a near-quote differing by whitespace.
* [ ] **A149** **IT §2.2** — predict `scoreIntentReply` / `endsWithQuestionOrOptions` / `looksPasted`, and when origin is mechanically forced.
* [ ] **A150** Predict `locateQuote` / `verifyCodeEvidence` when the quoted line has moved.
* [ ] **A151** Predict `rankTreePathsByKeywords` / `selectCandidateFiles` for a two-keyword intent.
* [ ] **A152** Predict `renderLivingDocument` for an empty project.

**Feeds:** I9. **Toward modules:** Understanding synthesis; Intent & trace (likely two).

## Block 10 — Investigation and Change Workspace laws (A153-A162)

`src/lib/investigation/*`, `src/lib/prepare/*` beyond verification

* [ ] **A153** Predict which drafts `validateVerdict` rejects.
* [ ] **A154** `finalizeVerdict` then `reopenCase` — predict the revision history.
* [ ] **A155** Predict deletion of an exhibit that `isReferencedByRevision`.
* [ ] **A156** **DI §2.4** — predict `getInvestigationCoverage`'s language; find where it could overclaim absence.
* [ ] **A157** **CW §2.4** — predict `assertEditability` for an edit attempted after an implementation is attached.
* [ ] **A158** **CW §2.2** — trace `applyAssistedOutcome`; prove AI output can only land as `ai_inference`.
* [ ] **A159** **CW §2.8** — predict exactly what one "Promote" click writes.
* [ ] **A160** **CW §2.5** — predict `capPatches` / `capExcerpts` at the 500-character boundary.
* [ ] **A161** Predict `parseUnifiedDiff` on a malformed diff.
* [ ] **A162** Predict `deriveEdgeVerification` / `reconcileEdges` after `removeNode`.

**Feeds:** I7. **Toward modules:** Investigation & verdicts; Change Workspace.

## Block 11 — UI state (A163-A170)

`src/stores/*`, `src/hooks/*`, key pages — concretizes Level 5, which is currently abstract

* [ ] **A163** Predict `prepareWorkspaceStore` after a rejected write.
* [ ] **A164** Predict `anchorStore` when the anchored conversation is deleted.
* [ ] **A165** Predict `appStore` on project switch with an entity selected.
* [ ] **A166** Predict `useInvestigationCase` under rapid case switching.
* [ ] **A167** Predict `toastStore` with overlapping toasts.
* [ ] **A168** Predict `ChatPage` for a conversation with zero messages vs. a nonexistent one.
* [ ] **A169** Refresh mid-golden-path; predict what survives.
* [ ] **A170** Trace one `seedWorkspace` item: seed → DB → store → render. *(Concretizes A055.)*

**Toward module:** UI state.

## Block 12 — Invariant guard tests (A171-A176)

These produce artifacts, not just understanding. A205/A206 in Block 15 absorb part of this block,
so it is the tail of several arcs rather than a separate capstone.

* [ ] **A171** Predict which import would break CW §2.6 first; extend `src/lib/understanding/trace/boundary.test.ts`.
* [ ] **A172** **Invariant 2** — prove detection has no network path. What change would break it?
* [ ] **A173** **Invariant 1** — write the guard that fails if a sync envelope carries plaintext.
* [ ] **A174** **Invariant 6** — write the guard that fails if a relay handler logs a body.
* [ ] **A175** **CW §2.5** — write the guard that fails if `repoFiles` enters the sync set.
* [ ] **A176** Enumerate all 25 binding rules; produce the list of which have mechanical enforcement and which are prose only. **Do this first.**

**Feeds:** I11. **Toward module:** Invariant enforcement map.

## Deliberately not covered

`src/lib/exporters/`, `src/lib/utils/`, `src/lib/aipkms/` (planned layer, already 1:1 tested), and
`src/lib/demo/` beyond A170. Low consequence — worth saying out loud rather than claiming 100%.

---

# Part III — Test Coverage Backlog

**187 of 275 source files have no sibling test.** That overstates it: ~17 are `types/*.ts` (the
typechecker covers those) and ~10 are `index.ts` barrels, so the real figure is around 160.

What exists: 99 frontend test files, 9 of them `.test.tsx` (in `components/prepare/`,
`components/common/`, `components/detection/`, and three pages). Component testing is already set
up — Testing Library, jsdom, `fake-indexeddb`, `user-event` — with working patterns to copy.
Everything else in `components/`, all of `hooks/`, and 3 of 4 stores are untested. The backend has
exactly one test file, `backend/src/llm/sse.test.ts`, and no `backend/vitest.config.*` at all.

Coverage tooling is configured (`v8`, scoped to `lib/`, `stores/`, `hooks/`, `components/`), so
`npm run test:coverage` produces real numbers to predict against.

## Block 13 — Test infrastructure (A177-A184)

* [ ] **A177** Predict what `src/test/setup.ts` provides before reading it.
* [ ] **A178** Predict which existing tests break if `fake-indexeddb` is removed.
* [ ] **A179** Read `tests/golden-traces/fixture-builder.ts`; hand-build a fixture and predict its normalized step count.
* [ ] **A180** Add a golden trace for a failure pattern I have personally watched my agents do; predict which detector fires.
* [ ] **A181** Hand-write an `.expected.json` before generating it; diff mine against the real one.
* [ ] **A182** There is no backend vitest config. Predict what `cd backend && vitest run` currently picks up, and whether `test:all` would catch a new backend test at all.
* [ ] **A183** Predict `npm run test:coverage` for `src/lib/prepare/` — write the number down first.
* [ ] **A184** Same for `src/lib/crypto/` and `backend/`. Compare all three predictions to reality.

**Feeds:** I10. **Toward module:** Test architecture & fixtures.

## Block 14 — Characterization tests (A185-A196)

One per untested load-bearing file, each written **after** its Predict exercise. Every record must
answer: which assertions am I pinning deliberately, and which am I pinning only because they
happen to be true today?

* [ ] **A185** `crypto/primitives.ts`
* [ ] **A186** `crypto/keyManager.ts`
* [ ] **A187** `crypto/recovery.ts`
* [ ] **A188** `auth/webauthn.ts`
* [ ] **A189** `auth/session.ts`
* [ ] **A190** `db/findings.ts` + `db/detectorRuns.ts`
* [ ] **A191** `db/conversations.ts` — cascade behavior
* [ ] **A192** `db/repoFiles.ts` — local-only behavior
* [ ] **A193** `detection/registry.ts`
* [ ] **A194** `detection/staleness.ts`
* [ ] **A195** `detection/workerHandler.ts`
* [ ] **A196** `lib/search.ts`

**Feeds:** I10, I12.

## Block 15 — Specification tests (A197-A206)

Assert what the spec says, not what the code does. **Some of these are expected to fail.** That is
the point — a failing Specify test is a finding, not a mistake.

* [ ] **A197** **CW §2.2** — AI output can never set `verified` (across `applyAssistedOutcome`).
* [ ] **A198** **IT §2.3** — all AI output lands `pending`.
* [ ] **A199** **IT §2.2** — origin forced to `unprompted` when no assistant text precedes.
* [ ] **A200** **Invariant 1** — every enveloper encrypts its payload.
* [ ] **A201** **Invariant 6** — no relay handler logs a request or response body.
* [ ] **A202** **CW §2.5** — `repoFiles` excluded from sync; quote cap ≤ 500.
* [ ] **A203** **Invariant 3** — findings never mutate across detector versions.
* [ ] **A204** **Invariant 4** — every detector's findings carry re-renderable evidence.
* [ ] **A205** **Invariant 2** — no network-capable import reachable from `src/lib/detection/**`.
* [ ] **A206** **DI §2.2** — no LLM/provider import reachable from `src/lib/investigation/**`.

**Feeds:** I11. **Toward module:** Invariant enforcement map.

## Block 16 — Mutation exercises (A207-A216)

The strongest available ownership measure, and cheap. Break something, predict which test fails,
run, restore. A mutation nothing catches means that coverage line is decorative.

* [ ] **A207** Change `!result` to `result === undefined` in `classifyRunOutcome`. Predict which test fails. *(Tells me whether the `''` path — the load-bearing half — is actually covered.)*
* [ ] **A208** Change a loop threshold constant; predict which golden trace fails.
* [ ] **A209** Delete one suppression rule.
* [ ] **A210** Remove the encrypt call from one enveloper. Does anything fail?
* [ ] **A211** Make `isVerbatim` always return true.
* [ ] **A212** Change a 500-character cap to 5000.
* [ ] **A213** Force the proximity fallback to always run (ignore `toolUseId`).
* [ ] **A214** Invert `isSensitivePath`.
* [ ] **A215** For every mutation above that nothing caught, write the test that catches it.
* [ ] **A216** Pick three mutations myself, in code I *believe* is well tested. Record the hit rate.

**Feeds:** I10, I12.

## Block 17 — Component and hook tests (A217-A224)

* [ ] **A217** Read the four `components/prepare/*.test.tsx`; predict the shared setup pattern before reading the fourth.
* [ ] **A218** First test for `FindingChips` — predict the assertions.
* [ ] **A219** `DisclosureModal` — assert it names provider and sources before any call (**Invariant 6**, enforced in UI).
* [ ] **A220** `StaleAnalysisBanner` — stale vs fresh.
* [ ] **A221** `CoverageView` — assert **DI §2.4** language never overclaims absence.
* [ ] **A222** `GuidedActionMenu` — assert Guided mode exposes no LLM action (**CW §2.7**).
* [ ] **A223** `SearchResults` — empty vs loading vs nonexistent.
* [ ] **A224** `useInvestigationCase` under rapid switching.

**Toward module:** UI state.

---

# Completed Work

See [`audit-log.md`](audit-log.md).

Detailed exercise records are stored in [`exercises/`](exercises/).

---

# Future Synthesis

Do not create these merely to fill out documentation.

As exercises accumulate, related evidence may justify a broader **investigation**:

```text
exercises
→ investigation
```

When an investigation produces stable, durable understanding of a subsystem, distill that understanding into **module documentation**:

```text
exercises
→ investigations
→ modules
```

## Candidate Investigations

Twelve, in rough dependency order, with the blocks whose evidence would feed them. **Do not create
any of these until two or three of its exercises are done and the pull is real.** An investigation
written ahead of its evidence is an architecture report, not understanding.

| | Question | Fed by |
|---|---|---|
| **I1** | How does a raw export become a normalized step stream? | Blocks 1, 4 |
| **I2** | How does Chatdex decide an agent failed, and how does that stay explainable offline? | Blocks 1, 2, 3 |
| **I3** | How does captured test execution become verification evidence? | Levels 1-2, Block 10 |
| **I4** | How does one entity live and die across tables? | Block 5 |
| **I5** | What can the server actually see? | Blocks 6, 7, 8 |
| **I6** | What survives a lock, a failed sync, and a reload? | Blocks 5, 6, 7, 11 |
| **I7** | How does AI output stay quarantined from verified state? | Blocks 8, 9, 10 |
| **I8** | What is the repository cache allowed to hold, and who enforces it? | Blocks 5, 8 |
| **I9** | How does a finding travel from Investigate into Current Understanding? | Blocks 9, 10 |
| **I10** | What does our test suite actually guarantee? | Blocks 13, 14, 16 |
| **I11** | Which of the 25 binding rules is enforced by a test, and which only by prose? | Block 12, Block 15 |
| **I12** | Where have we pinned behavior we did not intend to pin? | Blocks 14, 16 |

I12 is the question most specific to auditing AI-generated code, and has no equivalent in a
codebase written by hand.

## Candidate Modules

A module emerges when enough exercises and investigations support a useful current model — not
because a directory exists. Listed with the evidence that would justify writing one.

| Module | Responsibility it would describe | Supported by |
|---|---|---|
| Verification & test-run evidence | How command output becomes recorded evidence | Levels 1-2, I3 |
| Normalization substrate | The shared `Step`/signature model under three subsystems | Block 1, I1 |
| Detection pipeline | Detectors, runs, versioning, worker boundary | Blocks 2, 3, I2 |
| Import & parsing | Three provider formats into one unified model | Block 4, I1 |
| Storage & entity lifecycle | Dexie schema, cascades, local-only tables | Block 5, I4 |
| Crypto & unlock | Key material, PRF unlock, recovery, lock state | Block 6, I6 |
| Sync | Envelopes, push/pull, conflict, the ciphertext invariant | Block 7, I5 |
| LLM boundary | Relay, providers, disclosure, credential handling | Block 8, I5, I7 |
| Understanding synthesis | Discovery, digest, reconcile, current understanding | Block 9, I9 |
| Intent & trace | Intent extraction, origin, quote verification | Block 9, I7 |
| Investigation & verdicts | Cases, exhibits, coverage, verdict lifecycle | Block 10, I9 |
| Change Workspace | Intent → evidence → trace → hypothesis → verification → promote | Block 10, I7 |
| Repository access & cache | GitHub client, local dir, index, search | Blocks 5, 8, I8 |
| UI state | Stores, hooks, page-level state transitions | Blocks 11, 17 |
| Test architecture & fixtures | Golden traces, fixture builder, harness, coverage | Block 13, I10 |
| **Invariant enforcement map** | Which of the 25 rules are defended, by what, and how a regression would show | Blocks 12, 15, I11 |

The last one is arguably the most valuable document this audit could produce, and it is the only
module worth starting early — A176 is its first entry.
* Persistence
* Projects
* Investigations
* Current Understanding
* Prepare Change
* UI state
* Import
* Crypto
* Sync
* Backend

These should emerge from completed audit work rather than being written speculatively.
