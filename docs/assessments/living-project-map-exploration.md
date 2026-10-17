# Living Project Map: exploration and experiment boundary

Status: **Exploration, 2026-09-10. No production implementation authorized by this document.**

Primary proposed owner: Understanding Workspace. Related owners: Decision Recovery, Decision Authoring (proposed), Change Workspace, Repository Integration, Agent Observability, and Flow Map (draft). This is a possible integration direction, not a new parallel capability stack or an amendment to their contracts.

## 1. Recommendation and research question

Test a **small, manually organized concept index with an inspectable agent-context packet**, inside Current Understanding. Use it on one actual change in Chatdex and one in Slop Connoisseur. Begin with product language and existing records; do not begin with automatic architecture extraction, a graph database, a new ingestion platform, or MCP transport.

The strongest existing substrate is already an ownership loop:

```text
sources → understanding objects/events → explicit review
                    ↓                         ↓
          decisions and traces       prepared change / chat context
                                              ↓
                                external implementation + evidence
                                              ↓
                                  explicit understanding promotion
```

The missing connective tissue is stable topics, precise claims about those topics, scoped relationships, and a reliable distinction between the latest reconstruction and the interpretation a human actually endorsed. A visually richer map will not fix those distinctions.

Working hypothesis: **Chatdex helps an owner notice, decide, and communicate consequential differences between intended behavior and observed implementation.** That is narrower and more testable than promising to synchronize a human's mental model with an entire application. The product cannot measure comprehension from clicks or prove that an agent understood a context packet. It can preserve explicit commitments, show their evidence and limits, and record which commitments were handed to a particular change.

The experiment should be allowed to reject the map thesis: if an evidence-backed Current Understanding document plus a better Prepared Change export does the job, ship those improvements without a new map surface.

## 2. Reconnaissance method and authority

Inspected the working tree at Chatdex commit `1b4c8dba0277e711b5ecc3c1c8c450a4d6a610a3`. Read actual types, persistence helpers, imports, reconciliation and projection code, recovery/firewall/diff/bridges, repository access, provider boundaries, route components, current specs and change proposals. This is code reconnaissance, not a live-browser acceptance report or a complete security audit. No private conversation store or real agent session was opened for this assessment.

Pre-existing edits were present in `docs/changes/README.md` and the Decision Authoring PRD, SPEC, and PLAN. Those files were read as **working proposals**, left untouched, and not treated as accepted production behavior.

Authority order: shipped behavior establishes what exists; current capability contracts establish intended boundaries; current change plans identify proposed amendments and remaining acceptance; old PRDs, territory walkthroughs and build logs provide historical context. A code/spec disagreement is reported, not silently resolved in favor of code.

Evidence anchors used throughout:

| Reference | Primary files |
|---|---|
| U: understanding | [types](../../src/types/understanding.ts), [DB operations](../../src/lib/db/understanding.ts), [current projection](../../src/lib/understanding/currentUnderstanding.ts), [reconciliation](../../src/lib/understanding/reconcile.ts), [PRD](../capabilities/understanding-workspace/PRD.md) |
| P: projections and handoff | [map](../../src/lib/understanding/map.ts), [living document](../../src/lib/understanding/livingDocument.ts), [native chat context](../../src/lib/chat/context.ts), [Prepared Change export](../../src/lib/prepare/export.ts) |
| D: decisions | [types](../../src/types/decision.ts), [recovery](../../src/lib/understanding/decisions/runRecovery.ts), [firewall](../../src/lib/understanding/decisions/firewall.ts), [diff](../../src/lib/understanding/decisions/diff.ts), [current contract](../capabilities/decision-recovery/SPEC.md) |
| I: intent | [types](../../src/types/intentTrace.ts), [extraction](../../src/lib/understanding/intents/runExtraction.ts), [trace](../../src/lib/understanding/trace/runTrace.ts), [judgment validation](../../src/lib/understanding/trace/judge.ts) |
| C: change | [types](../../src/types/preparedChange.ts), [creation](../../src/lib/prepare/changes.ts), [lifecycle](../../src/lib/prepare/lifecycle.ts), [verification](../../src/lib/prepare/verification.ts), [promotion](../../src/lib/prepare/promote.ts) |
| E: evidence | [workspace evidence](../../src/types/evidence.ts), [investigation types](../../src/types/investigation.ts), [raw retention](../../src/lib/db/rawSources.ts), [anchors](../../src/lib/investigation/anchors.ts) |
| R: repository | [contract](../capabilities/repository-integration/SPEC.md), [source interface](../../src/lib/repo/sources.ts), [indexer](../../src/lib/repo/index.ts), [search](../../src/lib/repo/search.ts), [GitHub client](../../src/lib/github/client.ts) |
| S: storage and inference | [schema](../../src/lib/db/schema.ts), [sync](../../src/lib/sync/engine.ts), [relay client](../../src/lib/providers/relayClient.ts), [backend relay](../../backend/src/routes/llm.ts), [root invariants](../../CLAUDE.md) |

**BUILT** means executable paths exist, not that every manual acceptance has passed. **PARTIALLY BUILT** means a useful portion exists with identified missing behavior. **SPECIFIED** means documented but unimplemented, including drafts. **IDEA ONLY** means this exploration or future direction without a current implementing contract.

## 3. What already exists

### 3.1 Entities, services, and user surfaces

| Area | Status | Repository reality and reuse |
|---|---|---|
| Project identity and source association | **BUILT** | `UnderstandingProject`, optional `ProjectRepository`, many-to-many `ProjectAssociation`; origin/review fields and explicit source association. Reuse this project identity, not an AIPKMS Workspace or Claude Code `projectPath`. [U] |
| Understanding objects and temporal events | **BUILT** | Open `UnderstandingObject.type`, scalar `meta`, lifecycle status, AI/user origin, review state. `UnderstandingEvent` supports introduced/supported/refined/superseded/contradicted/reopened/resolved, conversation evidence and optional promoted code evidence. AI creation requires a conversation evidence reference; user creation may be unsupported. [U] |
| Current Understanding | **BUILT** | Direction, ideas/decisions, questions, pending proposals, recent events, history drawer; list, living-document and map presentations. `ProjectUnderstandingPage.tsx` composes these. Pending and accepted objects are both visible. Intents are excluded from this projection and have a separate tab. [U, P] |
| Existing Project Map | **BUILT**, narrow | `assembleProjectMap` creates supersession chain lanes, with dashed pending edges. It is an evolution map of objects, not a product or architecture map. Preserve this as a temporal lens. [P] |
| Discovery and reconciliation | **BUILT**, limited scope | Disclosed provider calls discover projects and objects from conversation digests; reconciliation compares associated conversations with stored understanding and emits proposals. Cursor selection is based on conversation `updatedAt`, with scoped/full rerun escape hatches. No repository-driven reconciliation loop. [U] |
| Decision Investigation | **PARTIALLY BUILT** | Anchor browser, case workbench, exhibits, literal search, human review scope, verdict revisions and ledger exist. It is deliberately a protected human-reading workflow. Capability index calls MVP code-complete, but the invariant register identifies missing spec details including unresolved leads and search filters. No AI summaries or detector conclusions may flow into it. [E; DI §2] |
| Decision Recovery | **BUILT**, acceptance pending | A decision is already an UnderstandingObject, not a separate decision identity. `DecisionTrace` carries rationale, alternatives, assumptions, transcript spans, implementation anchors, symbols, test candidates and invalidation claims. Matrix/detail/compare screens, challenge and replacement-change actions exist. [D] |
| Decision review experience | **BUILT** | Newer review code/spec qualifies basis and actor derivations, groups by session/path, and preserves neutral ordering. These refinements supersede a naive reading of early recovery vocabulary. [review plan](../changes/decision-review-experience/PLAN.md) |
| Decision semantic diff | **BUILT**, limited | Deterministic comparison of two reconstruction runs produces new/revised/assumption/invalidated/unresolved entries. Determinism of the diff does not make the model interpretations it compares observed facts. An omitted decision is unresolved, not deleted. [D] |
| Intent Trace | **BUILT**, acceptance pending | Intent objects carry want/don't-want/constraint/preference and conversational origin. Append-only `IntentTrace` binds model judgments to a GitHub commit, with verified excerpts and deterministic commit evidence. This is already part of the intent–implementation comparison. [I] |
| Change Workspace / Prepared Change | **BUILT**, acceptance pending | Draft→ready→implementing→verified→closed, frozen intent/criteria, evidence, small flow traces, hypotheses, implementation attachments/history, per-criterion verification, learned text, questions and explicit promotions. Guided and disclosed Assisted modes exist. [C] |
| Agent consumption | **PARTIALLY BUILT** | Native project chat injects a budgeted living document with pending objects excluded. Prepared Change exports Markdown/JSON instructions and source IDs. There is no external accepted-context MCP/API, immutable context receipt, or automatic reconciliation of an agent's response. [P] |
| Agent observability | **BUILT** for imported Claude Code sessions | Client-side worker pipeline, versioned detector runs, immutable evidence-bearing loop/reversion/verification-absence findings; Browse/Analytics/Settings surfaces. Import also derives code-change anchors and local agent read/search/list records. These are useful signals, not project decisions. [detection](../../src/lib/detection/pipeline.ts), [import](../../src/lib/import.ts) |
| Observability intervention loop | **SPECIFIED** | Intervention amendment I0–I6 is not the built detector pipeline. Do not promise live intervention or coaching based on it. [amendment](../capabilities/agent-observability/AMENDMENT-intervention-v2.md) |
| Repository/code/docs access | **BUILT**, read-only | GitHub selected-ref resolution, immutable SHA caches, local directory source, bounded grep/symbol/reference search; specs and README files can be fetched as repository text. Shared binding UI is `RepoBindingCard`. No global architectural index. [R] |
| Git history/diffs/PRs | **PARTIALLY BUILT** | GitHub commit/path evidence, compare/PR implementation attachment, transcript commit hints and pasted diffs exist. General `.git` ingestion, local branch history, automatic follow/refresh and runtime observation feeds do not. PRs are not wholly future: a narrow attachment path is built. [R, C, D] |
| Flow Map | **SPECIFIED**, draft | Proposed cache-only code recognizers, surfaces/links, declared vs heuristic edges, fog, kept flows and workspace bridge. No `src/lib/flowmap` implementation or Flows route; current schema is v13. [draft](../capabilities/flow-map/SPEC.md) |
| Decision Authoring & Evidence | **SPECIFIED**, proposed | Stable decision identity plus revisions, field contributions/adoption, claim-specific evidence, search coverage and exploratory source workspace. Directly relevant to the map's truth problem; do not invent a competing decision revision system. [proposal](../changes/decision-authoring-evidence/SPEC.md) |
| Experiment Lab / Share Build Story | **SPECIFIED**, proposed | Experiment attempts and reviewed publishing are adjacent workflows, not prerequisites or existing map stores. Public sharing has separate disclosure/storage implications. [changes index](../changes/README.md) |
| AIPKMS curation | **PARTIALLY BUILT** | Anchors/tags/knowledge folders exist; Thread/Workspace/SynthesisDocument types and utilities are not the current project understanding model. Do not create another Project/Workspace equivalence or infer that every utility has a persisted UI workflow. [types](../../src/lib/aipkms/types.ts), [schema](../../src/lib/db/schema.ts) |
| Cross-source conceptual reconciliation and ownership map | **IDEA ONLY** | No stable product/system hierarchy, general claim relationships, review-at-revision coverage, or complete closed loop with external agents. These are the experiment questions. |

### 3.2 Ingestion and evidence flow

```text
Claude.ai / ChatGPT export / Claude Code JSONL
  → parsers: normalized StoredConversation + StoredMessage + raw payload capture
  → immutable content-hashed RawSource (LOCAL-ONLY; before normalized writes)
  → new conversation/message rows (conversation-ID dedup)
  → Claude Code only: detector runs + neutral edit anchors + agent inspections

associated conversations → discovery / reconciliation / intent extraction / recovery
  → bounded disclosed model inputs → validated references/quotes
  → pending objects/events or immutable traces → human review

GitHub selected ref → resolved SHA → LOCAL-ONLY file cache → bounded excerpts
user-picked directory → 'local' cache marker → bounded excerpts
  → Intent Trace / recovery / workspace evidence and search

workspace → external implementation attachment → criterion review
  → human-written learning + explicit per-item promotion → understanding
```

The parser set is Claude.ai, ChatGPT, and Claude Code. `DataSource` includes `codex`, but there is no Codex parser; `.jsonl` currently routes to Claude Code. Provider access through a Codex login is not Codex-session ingestion. Likewise, Activity Tracker docs and a Timeline page do not establish a working continuous capture path; the repository has no extension source tree matching the old docs' workflow.

Raw retention preserves the text actually parsed: for ZIPs, extracted `conversations.json`, not every archive attachment or the ZIP bytes. Full original exports still matter outside Chatdex. The system must retain raw evidence rather than replace it with this proposed model.

**Continuous-ingestion blocker:** `import.ts::storeData` keeps a changed raw payload even for an existing conversation ID, but skips the normalized conversation and its messages. Auto-analysis receives only added IDs. Thus a growing imported session does not refresh the analysis substrate. Separately, timestamp cursors can miss an old conversation associated later. A living loop needs source-version-aware processing, not merely another timer around current imports.

### 3.3 Privacy and provider boundaries

Local-first currently means plaintext IndexedDB on the device, with encrypted sync; it does **not** mean all local data is encrypted at rest. Whole repository caches, raw sources, derived investigation anchors, inspection logs, agent inspections and decision diffs are local-only. Understanding objects/events, normalized conversation data, recovery/intent traces, and workspaces use existing ciphertext sync paths.

Detection is deterministic, client-side and offline. Synthesis is a separate, explicitly enabled provider operation through the user's credentials/login and transit-only backend relay. Source/provider disclosure, bounded excerpts, secret scrubbing and prompt-body checks are existing reusable boundaries. A future map does not authorize background LLM calls, a plaintext server index, repository writes, or sending a whole project to an agent. Local-only evidence may be unavailable on a second device even when its derived record syncs.

### 3.4 Conflicts, supersession and unfinished contracts

| Finding | Treatment for this direction |
|---|---|
| Old platform PRD says no server; PatternMirror includes password/Argon2id and older server/extraction assumptions. | Treat those passages as superseded by root invariants, WebAuthn architecture and current capability contracts. Do not make them a second roadmap. |
| Docs index still describes React 18 and extension commands absent from current package scripts. | Use React 19/package scripts and the actual tree as the implementation baseline. |
| Territory Atlas dates from `63d7012`; invariant register still calls root worker documentation stale even though current CLAUDE.md has corrected it. | Recheck claims individually. The Atlas is a seed for concepts, not current truth; the register is an audit aid, not infallible. |
| Flow Map draft calls baseline schema v12, proposes v14 and a routes-first React/Vite/Fastify profile. | Schema is v13. Migration numbers must be chosen at implementation time. That profile also does not fit Slop's Node server/vanilla frontend. |
| Flow Map IDs include line numbers, while the draft suggests stability across regeneration. | Deterministic at one snapshot is not stable through line movement. Use durable concept IDs; relocate artifact bindings separately. |
| Flow Map “re-keep updates in place” vs proposed revision-specific acceptance. | Before shipping Keep, require preserved snapshots/adoption ancestry; renaming or keeping must not endorse every generated edge. |
| Recovery §2.5 literally prohibits investigation module changes, while its own §8.1 places agent inspection derivation there. | Preserve the actual protected DI consumer boundary. Do not use the wording inconsistency as permission to feed AI output into DI. |
| Recovery §2.7 forbids importance/relevance ranking; this direction asks to route attention. | Initial map uses explicit user-selected topics and factual filters, stable ordering. Any later machine prioritization requires a named contract amendment; moving it to a new page is not a loophole. |
| Authoring proposes revisions/claim evidence; current U events are not complete text revisions. | Reuse that proposal's semantics. This exploration does not silently implement it or declare it accepted. |
| Recovery/Intent/Change capability indexes say code-complete, while browser and second-device checks remain open. | Preserve acceptance-pending status. Do not report these workflows as proven useful merely because tests pass. |

Additional implementation limits: `recordUnderstandingEvent` applies lifecycle effects, but accepted `refined` detail does not rewrite title/body; accepted contradiction does not create a durable conflict lifecycle. AI objects' introduced events are internally accepted even while the objects remain pending. `setObjectReviewState` has no revision-targeted acceptance receipt. These distinctions matter to any export or fold. [U]

## 4. Minimal conceptual model

Use **existing project + understanding object + event + trace + Prepared Change**, with a thin concept/claim/link projection. A graph database is unnecessary.

| Primitive | Meaning and minimal representation |
|---|---|
| Project | Existing `UnderstandingProject`; project boundaries apply to every query and link. |
| Concept | Stable human-named subject, initially an UnderstandingObject with `type: 'feature'` or `'system'`. “Accounts”, “Blind Tasting”, “Encrypted sync”. Being a navigation concept does not assert that the feature is implemented. |
| Claim | Existing understanding object or trace-contained statement about a concept. Reuse decision, intent, belief/constraint and question. Assumptions stay inside a DecisionTrace until one needs independent review/history; then promote with a trace/assumption reference. |
| Change | Existing PreparedChange. The frozen change intent and its lifecycle remain a document/workflow, not scattered graph nodes. |
| Artifact reference | A typed locator into an existing message/span, raw source hash, repository snapshot/path, trace, finding, implementation or document. A projection over existing stores, not another copy of every file. |
| Evidence link | A claim-specific assertion that an artifact supports, contradicts or supplies context. Preserve linker origin and source integrity separately from semantic support. Adapt existing EvidenceRef/EvidenceItem/trace locators instead of flattening them. |

Only two new relationship needs are essential to the first navigation experiment: **contains** (concept hierarchy) and **about** (claim/change → concept). An artifact binding to a concept is a navigation association, not proof of implementation. Existing event supersession and evidence/trace references supply the rest.

For the broader model, supports/contradicts/context are evidence-link roles; supersedes is an event between claim revisions; constrained-by is a view of an applicable accepted constraint. Do not persist inverse pairs such as both changed-by and affects when one relation can answer both queries.

Defer `depends_on`, `implements`, `verified_by` and inferred blast-radius edges until a real task needs each. Each would itself be a scoped claim requiring provenance. A file mentioning Payments does not implement Payments; an import does not prove runtime dependency; a test path does not establish behavior. “Related by path” is a useful and honest result before any of those stronger relations exist.

Requirements and invariants need no separate tables initially. Reuse intent polarity/constraint objects with explicit scope. An invariant is a requirement marked as a continuing constraint, not an automatically proven theorem. Questions remain first-class because they can trigger a decision or change. Store feature/system as lens vocabulary, allowing a concept to participate in both views without duplicate identities.

Do not graph every message, tool call, token, read event, inspection, criterion, hypothesis paragraph or source line. Keep their native ordered records and show a source drawer when needed. Graph-shaped storage is not the same as a useful ownership model.

Critical additions, staged rather than all required up front: durable concept bindings; explicit statement intent (descriptive/normative/question); claim-scoped evidence roles; exact revision adoption; coverage/freshness records; unresolved competing claims; and a context packet tied to an actual change. General entity extraction is not the first missing primitive.

## 5. Truth, provenance and ownership semantics

**A map entry means “Chatdex has a subject or claim recorded.” Human endorsement means “this person explicitly adopted this exact interpretation, for this scope, at this revision.”** Neither means that the implementation necessarily conforms. An artifact can exist while its proposed explanation is wrong; a human can endorse a future requirement that the code violates today.

The five desired labels are useful presentations, but cannot be a single exclusive enum:

| Dimension | Values/meaning |
|---|---|
| Derivation | Mechanically observed; AI inferred; human asserted; imported/unknown origin. Deterministic heuristics are marked as heuristics, not promoted to observations of their semantic conclusion. |
| Statement mode | Describes observed/current behavior; prescribes desired behavior; asks a question; offers a hypothesis. |
| Human disposition | Pending, endorsed as interpretation, adopted as intent, rejected, withdrawn. Acceptance targets exact content/revision; “historically accurate” and “what I want” are different actions. |
| Support | Supported, challenged/conflicted, insufficient, or not evaluated, with evidence roles and bounded scope. A semantic support assessment carries its own author/deriver. |
| Applicability | Repository/branch/snapshot and time; current, historical, stale or unassessed against the selected revision. |

Examples: **AI inferred · human accepted · implementation unassessed**; **observed at SHA A · conflicts with accepted intent**; **human accepted · evidence unavailable on this device**. Unknown is not a confidence of zero. Rejected means a reviewed proposal was declined, not that its evidence is erased.

### 5.1 Separate evidence integrity from what it proves

Mechanically establish narrowly scoped facts: a source payload has a given hash; a verified quote occurs at a recomputed range; a diff names changed files; a recorded tool result contains a result string. Explain the method and snapshot. These do not establish why a change happened or that a test proves a business invariant.

Existing limitations that the map must not amplify:

- Recovery `madeBy` uses cited roles and ordering; `specified` requires a user quote. Those checks constrain provenance, but do not prove semantic authorship or adoption. The current spec explicitly says so. Code alone cannot identify who chose it.
- `deriveEdgeVerification` returns verified if any attached evidence is mechanical. `isMechanicalEvidence` includes code, test/runtime (including manual observations), and commit history. This is the workspace's current vocabulary, not a proof system for every relationship.
- Test outcome extraction uses recognizable commands/result text and can return `observed` when result text is absent. “Test mentioned”, “test run observed”, “reported pass”, and “criterion supported for this revision” must remain distinct. A manually reported result is a human report, not machine-verified execution.
- General understanding EvidenceRefs validate source identities, not the same verbatim-quote contract as recovery. A note can be a rationale rather than a direct quote. Do not render all notes as verified quotations.
- Native chat excludes pending objects, but accepted-object evidence is assembled from all non-rejected events, including pending events. The living document's includePending switch does not rebuild that evidence union. A stricter agent feed must select both claims **and** their eligible events/evidence.

### 5.2 Revisions, time and disagreement

Adopt Decision Authoring's proposed revision model for consequential decision text. A revision preserves statement, field origin, source references, parent revision(s), recorded time, subject snapshot/time and adoption receipt. Use unknown for missing legacy actor/time; never reconstruct an approval timestamp from `updatedAt`.

Keep three clocks distinct: when a source event occurred, when Chatdex observed/processed it, and when a human adopted an interpretation. Bind code evidence to repository identity plus immutable SHA; for a working tree, use a captured content manifest/hash and label it a local snapshot, not a Git commit. A hash identifies captured contents, not their origin or completeness.

Acceptance of a proposed refinement must point to its exact replacement content. Concurrent edits against the same accepted revision create competing candidates, not last-writer-wins “truth”. Current sync's LWW machinery alone is insufficient for that semantic pointer; revision conflicts need explicit handling before multi-device authoring ships.

Supersession preserves both old and new claims plus the human action, reason and effective scope. Do not supersede a product requirement because latest code disagrees. A conflict records the two claims/evidence sets and the scope of disagreement; it can remain unresolved. A new observation can increase uncertainty without revoking the historical fact of human acceptance.

“Reviewed” is narrower than “understood”. A view/scroll/inspection does not endorse anything. Avoid ownership percentages. Show concrete gaps: “No adoption recorded for this decision”, “Accepted at A; affected files changed at B”, or “No applicable invariant recorded in the selected scope.”

## 6. Reconciliation lifecycle

| Stage | Automatic work allowed | Review or explicit action |
|---|---|---|
| Ingest and anchor | Preserve source version, parser version, stable source IDs, warnings, hashes and exact spans; run existing local detectors. | Source access/binding remains deliberate. No provider call on import. |
| Register freshness | Compare a newly fetched immutable snapshot/content manifest with the previous one; mark affected bindings stale. | Initial experiment uses manual refresh. Follow-branch watching needs its own scope and controls. |
| Relate evidence | Follow explicit IDs, user bindings, exact repository-qualified paths and valid locators. Offer lexical/path candidates with reasons and coverage. | Human chooses a concept association if ambiguity matters. A match is never silently an implements/depends-on assertion. |
| Interpret | On disclosed request, AI proposes claims, associations or possible conflicts against accepted and pending context, clearly distinguished in the prompt. | Consequential interpretations remain proposals. Recovery keeps its existing trace-only invalidation contract. |
| Validate proposals | Check project identity, referenced IDs, quote membership, bounds, snapshot identity, and revision base; deduplicate exact repeats. | Invalid claims cannot be saved as verified. Unknown/unavailable stays visible. |
| Route attention | Group by selected concept/change and factual reason; collapse repeated evidence. Stable chronological ordering and user filters initially. | User can inspect source, accept interpretation, adopt intent, challenge, defer, or create a change. |
| Apply accepted update | Transactionally record the exact adoption and new projection; retain old revisions/evidence. | Replacing accepted intent or resolving consequential conflicts requires a human act. |
| Consume and repeat | Compile a scoped packet; after an external change, attach session/diff/results and compare against the packet baseline. | Human reviews only changed commitments or unresolved consequential uncertainty; promotion remains deliberate. |

Process identity should eventually include `(project, source content/version, parser/deriver version, analysis configuration, relevant accepted-model revision)`. Separate “source imported”, “normalized”, “analyzed” and “reviewed” progress. Retries and older late-arriving sources must not disappear behind an `updatedAt` cursor. Failure in one source does not establish coverage of it.

### Review fatigue and attention routing

Do not create an approval task for every line or supporting quote. Exact source refreshes and additional mechanically validated locators can update availability without changing accepted semantic content. Record them, but do not imply the human examined them. Batch attention by one change and its affected concepts, while preserving per-claim actions.

Start with user-chosen tracked concepts and explicit filters: affected accepted constraints, pending decisions, source changes, unresolved conflicts. A displayed count explains its population and coverage, never “your app is 82% understood.” Deferral preserves a proposal; repeated ingestion of unchanged evidence should not notify again. New evidence can reopen attention with a visible reason.

Later, test user-configured critical areas and AI suggestions about consequences, but make those suggestions inspectable and separate from the Recovery browser's neutral ordering. Amend Recovery §2.7 before any integration that implies semantic importance. Do not infer urgency from a detector severity, file size, confidence score or lack of a human click.

Freshness has at least three independent indicators: selected branch currently resolves to B; available source snapshot is B; this claim was last assessed at A. Code-changing-under-the-claim is evidence to investigate, not evidence that the human wanted the change. A failed fetch, missing cache or force-push must never silently substitute another branch's contents.

## 7. Human workflows

### Ownership Recovery

Begin with “What can people do in this app?” and a small editable concept list. Offer a manually selected README/current specification as orientation. AI may suggest names later, visibly as proposals. Do not require a repository directory taxonomy or reading every implementation file.

Select “Blind Tasting” → see behavior, accepted intentions, implementation entry points, uncertain explanations and source availability. The user can say “This describes the implementation, but I do not want this behavior.” Record that as a new intended decision and open a Change Workspace. Product ownership is choosing the behavior and constraints; code literacy can deepen on demand.

### Ownership Continuity

Open “Since my last reviewed change” for a chosen concept. See changed sources and interpretations against the last accepted snapshot, the exact invariant potentially affected, and why it was included. Open only consequential differences. An engineer need not complete a teach-back exercise or accept every mechanical observation to continue.

### Deletion example, with honest states

1. An imported session/diff shows `deleted_at` and a deletion path. That is code/tool evidence. “A recovery period was intended” is a separate AI-inferred assumption.
2. The user confirms the reconstruction is historically accurate, then adopts new intent: “30-day recovery, then permanent deletion; billing-history records survive.” The first action does not itself endorse indefinite recovery.
3. Prepare a change from those exact adopted statements. Attach present implementation and define separate criteria for recovery, eventual deletion and retained billing history.
4. The agent receives the accepted intent plus a visibly uncertain section for unreviewed assumptions. It reports implementation refs, decisions and actual verification results.
5. Attach the session/compare/tests. Compare A to B and assess each criterion. An agent saying “done” does not resolve the invariant.
6. Record the new understanding and supersession explicitly; preserve the old indefinite-recovery interpretation as history. Another review is needed only for outstanding uncertainty or new consequential choices.

Chatdex already has replacement workspace and promotion pieces, but not automatic revision-aware completion of these steps. The repository's project-deletion demo branch remains an unmerged demo according to the capability index; this document neither validates nor merges it.

## 8. Relationship to the existing capabilities

| Capability | Role in the living model | Necessary caution/change |
|---|---|---|
| Current Understanding | Human-facing projection and likely home for concept navigation. | Add concept scoping, include relevant intents, distinct accepted/proposed lanes, claim-specific provenance and assessment revision. Keep document and temporal projections. Do not promote pending event evidence into accepted context. |
| Decision Recovery | Expensive reconstruction of candidate decisions and assumptions; anchored trace evidence and run comparisons. | Keep reconstruction immutable and visibly AI-origin even after adoption. Trace update is not accepted-text update. Treat role-based actor/basis values as constrained inferences. |
| Decision Authoring | Proposed home for exact human interpretation, contribution/adoption and competing revisions. | Reuse its identity, revision and evidence-link contracts when implementing; do not require the entire proposed reading/chat workspace for the first experiment. |
| Decision Investigation | Optional protected route to a human-composed, scoped verdict. | Only its existing one-way finalized-finding promotion may feed understanding. No model summary, recovered decision or detector finding back into the protected case workflow. |
| Intent Trace | Evidence-backed assessment of stated desires versus code/spec at a commit. | Its status is an AI judgment constrained by verified excerpts, not ground truth. Surface alongside decisions instead of leaving intentions absent from a topic packet. |
| Change Workspace | Operational boundary: accepted intent → implementation → verification → learning. | Freeze exact selected claim text/revisions in a packet. Existing export reloads UnderstandingObjects by ID, so IDs and frozen EvidenceRefs alone do not guarantee a reproducible content snapshot. Inherited/specifed recovered assumptions seeded as draft constraints still need explicit adoption before authoritative export. |
| Observability | Candidate attention evidence linked to a selected change/session. | Attach a compact count and exact finding drilldown; reading a file does not prove considering a constraint, and a detector firing does not prove a requirement violation. Keep detector code unchanged. |
| Repository Integration | Repository identity, selected ref, exact snapshot and source availability. | Add freshness and content-version processing separately from AI reruns. No automatic pull/write. Do not use `fs:<name>/local` as an immutable identity. |
| Flow Map | Possible future system/flow evidence projection over code snapshots. | Keep declared/heuristic/fog distinctions; use it as an artifact discovery adapter beneath concepts. It cannot infer product intent or historical rationale. A full recognizer system is not needed for the first experiment. |

## 9. Agent workflow and potential query contract

A human or agent query should use the same scoped projection, but an agent must receive authority and uncertainty as structured data rather than a green badge in a UI.

Start with four query shapes, implemented first as a local packet builder and export, not network services:

```ts
get_project_overview({ projectId, snapshot })
get_topic_context({ projectId, topicId, snapshot, includeProposals, budget })
get_change_context({ projectId, changeId, baseSnapshot, paths?, budget })
get_evidence({ projectId, claimRevisionId, evidenceIds })
```

Decisions, constraints/invariants, questions, assumptions, conflicts and recent conceptual changes can be sections/filters within these results. Do not create eleven endpoints before learning their retrieval semantics. File/symbol lookup returns candidate topics with matching reasons and ambiguity; it must not confidently choose between identically named symbols in different repositories.

Every response should include:

```text
schemaVersion, projectId, packetId/digest, generatedAt
selected repo/ref, observed snapshot, last assessed snapshot
exact claim/object/revision IDs and text
statement mode: descriptive | intended | hypothesis | question
original contributor/derivation + adoption kind/actor/time (unknown if absent)
accepted commitments
separate inferred/pending material (opt-in for claims, never silently mixed)
conflicts and gaps relevant to accepted commitments
claim-scoped evidence locators + integrity/availability + search coverage
selection reasons, omitted counts, truncation and freshness warnings
```

Default behavior exports applicable accepted intent and accepted interpretation separately. It excludes rejected/pending claims from authoritative sections, but it must still report that an accepted claim has a pending contradiction. A conflict cannot be hidden merely because the contradicting interpretation is unreviewed. “No results in indexed sources” is not “no constraints exist.” Critical requested constraints cannot silently disappear under a character cutoff; return an explicit incomplete packet or a smaller selectable scope.

The current `chat/context.ts` budget-and-preview pattern is useful, but a new packet must preserve structured completeness and evidence eligibility; arbitrary slicing is unsuitable for a normative constraint. Include source excerpts as untrusted evidence, never as higher-priority agent instructions. User adoption of a requirement does not grant a source document permission to run tools or send data.

Before work: user selects topic/change → previews exact packet → deliberately copies/exports it to the existing coding agent. This is a data disclosure to that tool/provider even if no Chatdex provider call occurs. The packet is context, not authority to modify the repository beyond the user's requested change.

After work: attach the returned diff/session/results and optional structured report with packet ID, base/head refs, decisions made, deviations and tests. An agent receipt proves what was delivered/reported, not what the model attended to. Compare to the original packet, preserve observed artifacts, then propose understanding changes. No `accept_decision` or `resolve_conflict` write tool for the agent in this initial contract.

Future MCP transport must run on an authorized device with access to the user's local/decrypted state, or read an explicit exported bundle. The current backend cannot answer plaintext project queries from ciphertext sync alone. Define project-scoped read permissions, explicit excerpt/raw-source access, revocation, local audit and source unavailability before transport work. Do not solve this by giving the server a decryption key or syncing local raw caches.

## 10. Representations over the same records

These are alternative lenses, not five new navigation silos. Prototype one list/detail surface and compare it with the existing document.

### A. Product/system index — “What is this, and where do I start?”

```text
Chatdex                         Current Understanding
  Import conversations          [Product] [System] [Evidence]
  Search and browse             Import: user selects an export
  Understand projects           Accepted intent: preserve source provenance
  Prepare changes               Observed: parser → raw retention → new rows
  Encrypted sync                Gap: growing sessions do not update rows
                                [Open sources] [Prepare change]
```

Product/system switches reorganize the same concept and its claims. A shallow list is sufficient; no force layout. Nontechnical labels remain visible when implementation details are expanded.

### B. Decision/assumption view — “Why, whose interpretation, and do I endorse it?”

```text
Projects / Deletion
Interpretation                Origin / adoption       Support
Soft delete                   AI / not adopted        code at A
Recoverability is desired     AI / not adopted        insufficient
30-day recovery then purge    Human / adopted intent  requirement
Billing history survives      Human / adopted intent  implementation unassessed
[Review exact statement] [Show alternatives and sources]
```

A table may answer this better than a decision graph. Trace-contained assumptions can expand in place until promoted independently.

### C. Change/ownership view — “What needs my judgment before this change?”

```text
Change: deletion retention       Packet P17 · base A · head B
Accepted commitment             New evidence          Action
30-day purge                    code/test report      assess criterion
Billing history survives        affected path, no run inspect / defer
Agent chose retry policy        new proposal          adopt / change
Other source updates: 8         no claim edit         expand
```

Use observable reasons, no synthetic ownership score. “No claim edit” is only what this comparison found, not proof of no conceptual impact.

### D. Temporal view — “What changed in the project versus our interpretation?”

```text
Source time:       A code ─────────── B code ─── new test report
Recorded model:   inferred soft delete ─── proposed retention update
Human adoption:        accepted interpretation ─── adopted 30-day intent
```

Extend the existing supersession lanes; let users choose repository revisions or review events as endpoints. A rerun at unchanged code can change the reconstruction and must appear as interpretation change, not software change.

### E. Current Understanding / agent preview — “What would we tell another person or agent?”

A deterministic topic document contains intent, observed implementation, decisions, constraints, unanswered questions and evidence, with an exact export preview. This may be the winning primary representation. No prose summary is allowed to flatten AI proposals into accepted commitments.

## 11. Competitive inspiration and differentiation

Unblocked describes continuous cross-source indexing, relevance selection over relationships, and a common context engine reached by humans and agents. Its published description also discusses conflicts, source authority and AI-generated documents. Those are useful patterns, not capabilities unique to this proposal. [Unblocked context-engine description](https://getunblocked.com/blog/inside-the-unblocked-context-engine/), accessed 2026-09-10.

Its public MCP presentation makes task-time agent context a useful reference point. This assessment did not independently test the product or establish that it lacks human review features. [Unblocked MCP](https://getunblocked.com/unblocked-mcp/), accessed 2026-09-10.

Chatdex's proposed emphasis is explicit, revision-specific human commitment and a return loop from implementation into reviewable understanding, with local-first evidence custody. A generic knowledge graph provides relationships; a context engine selects useful information; this workflow must additionally answer **“which exact statement did I adopt, for what change, and what now challenges it?”** Citation coverage and attractive diagrams alone do not demonstrate ownership.

## 12. Risks and likely failure modes

| Risk | Failure signal | Smallest mitigation/test |
|---|---|---|
| Curated map is busywork | Owner can answer faster from README + existing decision screen. | Compare timed tasks against that baseline; abandon separate map if it adds no value. |
| False authority | User/agent reads an inferred statement as adopted intent. | Explicit sections; negative export tests; ask a reviewer to identify one pending claim. Zero tolerated authority leaks in pilot. |
| Source citation laundering | Correct quote is used to justify unrelated behavior/actor. | Show claim-specific role and bounded conclusion; separate integrity from semantic support. |
| Accepted text changes underneath a packet | Same change export differs after a recovery rerun. | Freeze packet text/revision/digest and test byte-stable rerendering. |
| Latest code wins | Broken implementation silently replaces intended constraint. | Keep intent and observed state independent; demonstrate an intentional discrepancy. |
| AI-to-AI feedback amplifies invention | New summaries cite prior summaries as new independent support. | Retain primary-source lineage and common-source dedup; separate interpretation from observation. |
| Notification overload | Dozens of proposed updates for one small change. | Track a narrow scope, group by change, collapse duplicate support, measure review minutes and useful actions. |
| Hidden gaps | Missing source, truncated cache or failed parse looks like no rationale. | Coverage and availability are first-class; show searched scope and omissions. |
| Identity churn | Rename/line insertion creates new concept or false supersession. | Stable concept IDs; snapshot-qualified bindings and explicit relocation. |
| Generality too early | Work becomes parsers/ontology/framework support for months. | Two repos, manual bindings, existing sources and no recognizers initially. |
| Privacy regression | “Agent context” quietly exposes whole private repo/history. | User previews exact local packet; capped selected excerpts; existing provider disclosure boundaries. |
| Existing acceptance gaps undermine demo | Code-complete workspace fails the real loop. | Use real existing flows first; fix blockers as bounded capability work rather than burying them under map code. |
| Clicks become ownership | Inspection count presented as understanding. | Only explicit actions create adoption; inspections are optional process evidence. |

## 13. Open product decisions

1. Is the first recurring value pre-change context or post-change surprise detection? Test both; they imply different defaults.
2. Will users distinguish “accurate reconstruction” from “adopt as intended behavior”? If not, use clearer action copy rather than collapsing the data semantics.
3. Should feature/system concepts be a single open type with lens tags or two suggested types? Start with existing open types and change only after real overlap appears.
4. When does an assumption merit independent identity? Promote only when it gets independent review, reuse or supersession.
5. Can one owner endorsement suffice for the pilot? Yes as an experiment assumption; multi-owner disagreement remains a future contract, never fabricated unanimity.
6. What should re-review mean after source movement without semantic change? Mark source validation separately; do not force re-adoption of unchanged intent.
7. What minimum coverage makes a “no support found” statement useful? Start with an explicitly enumerated source set, method, exclusions and time; no global claims.
8. Does a separate map tab earn its navigation cost? Default to a lens inside Current Understanding.
9. Should selected source bindings sync? First experiment keeps its working binding manifest local; production shared bindings require a deliberate schema/privacy decision.
10. Does risk-based attention require machine ranking? First try tracked concepts plus explicit filters; revisit Recovery's no-ranking contract only with measured evidence of benefit.
11. Should code-only AI claims be allowed in general understanding? Current AI creation requires conversation evidence. Use a legitimate manual/code-evidence path for the first experiment; amend the invariant deliberately before adding AI code-only concepts. Never invent a conversation citation to satisfy it.
12. Does the prototype need continuous capture? No: one explicit before/after loop can test usefulness. Continuous ingestion needs a separate source-version design if the loop succeeds.

## 14. Ranked implementation experiments

Estimates are planning ranges for a developer familiar with this repository, not measured delivery promises. Scores are comparative (5 = highest); cost includes meaningful verification but excludes unrelated existing defects.

| Rank | Experiment | Learning | Cost | Existing reuse | Immediate utility | Demo value |
|---|---|---:|---|---:|---:|---:|
| 1 | **Topic → evidence → exact agent-context packet** | 5 | 2–4 focused days | 5 | 5 | 4 |
| 2 | **One real before/after change, reconciled by a human** | 5 | 3–5 days after #1, depending on bridge defects | 5 | 5 | 5 |
| 3 | **One completed Claude Code session → proposed topic updates** | 4 | 3–5 days after #1; expanding-session ingest excluded | 4 | 4 | 5 |

### Experiment 1: topic index and packet

Manually create roughly 10 concepts per repository, bind two deeply and leave the rest visibly sparse. Link existing understanding/intent/decision/change IDs and selected repository paths. Generate deterministic **candidate** associations from explicit references and exact paths; require selection before they become meaningful claim links. No new AI call. Compare a topic list/detail lens with the existing Current Understanding document.

Chatdex seed candidates: importing conversations, searching/browsing, project understanding, intent tracing, decision recovery, preparing changes, verification, encrypted sync, provider relay, source retention. Deep slice: **Importing an updated session** and **Preserving provenance**; source entries include `src/lib/import.ts`, `src/lib/parsers/index.ts`, `src/lib/db/rawSources.ts`, `src/lib/import.test.ts` and the understanding evidence types. The current re-import limitation is a real, inspectable discrepancy to discuss, not an instruction here to fix it.

Slop Connoisseur was located at `/Users/jacie/dev/apps/slop-game`, commit `7d61a5da487a48e295c630b5e71d2bc9ca523206`. A bounded read of README/docs, source inventory, `src/web/challenges.ts` and server route references confirmed a different stack and a concrete slice: **Blind Tasting / anonymous reveal**. Relevant source paths: `src/web/challenges.ts`, `src/web/server.ts`, `src/domain/types.ts`, `test/blind-challenges.test.ts`, `docs/spec-blind-tasting.md`, and `docs/build-blind-tasting-2026-09-08.md`. `Challenges.open` constructs an anonymous projection; `reveal` requires a locked guess. Do not claim the runtime was verified in this exploration.

Slop seed candidates: prompts, human writing, machine contestants, anonymous answers, detection/deception, taste voting, reveal/scoring, Blind Tasting, creator results, persistence. Its README says Blind Tasting is implemented locally and hosted/live pilot checks remain pending; Code Tasting is specified, multiplayer deferred. Its docs index still contains earlier “no application implementation” wording. Preserve the current/older document disagreement rather than ingesting `archive/chatdex-era/` as current intent. This is a useful test of source authority, not a reason to reintroduce Chatdex coupling into Slop.

Protocol: record a baseline using existing docs/search/screens; ask the owner to identify current behavior, one constraint, one uncertainty and the relevant implementation entry. Repeat with the concept lens on a comparable question. Export a packet and ask another person or existing coding agent to describe its authoritative vs uncertain content without additional source hunting. Use existing user-approved project data; do not silently populate either project with AI-authored “accepted” facts.

Provisional success: useful source/constraint retrieval on at least 4 of 5 chosen questions per repo; at least 30% less retrieval time or one consequential omission caught that baseline missed; no pending claim exported as accepted; owner wants to reuse a packet on a real change. These thresholds are proposed decision rules, not product benchmarks. Record setup/curation time too. If the document ties or wins, retain packet export and drop the extra lens.

### Experiment 2: one before/after loop

Use one already-desired, bounded change per repo, selected at implementation time. Freeze packet A, use existing Prepared Change and external coding agent, attach actual implementation/results, then manually reconcile one changed claim. Prove the user can answer a week later: what changed, why, who adopted it, what was checked and what remains uncertain.

Demonstrate both preserved intent and changed implementation, including an unresolved criterion; do not manufacture a bug or modify live app behavior merely for the demo. No auto-supersession. Use existing `implementationHistory`, verification and promotion. Add only the packet-to-change link and before/after read model necessary for the experiment. Success: one useful corrected/retained commitment per repo, reconstructible from evidence, with under ten minutes of review for the selected small change. Failure: reconciliation costs more than its benefit or produces only restated diffs.

### Experiment 3: proposed updates from one session

Import one **completed, previously unimported** Claude Code session; run existing disclosed Decision Recovery; map its anchors/trace references to two tracked concepts. Present at most a user-selected small batch of suggestions, with source counts/coverage and an expand-all path. Keep neutral ordering and distinguish “new reconstruction” from “new code behavior”. Compare suggestions with the owner's independently written change summary. Measure relevant suggestions, missed consequential changes, dismissals and review time.

Success: catches at least one useful assumption or discrepancy without generating more review work than manual inspection. Include a negative case: an agent says tests passed but no suitable result evidence is available; it must remain unverified. This experiment does not fix growing-session imports, add Codex format support, or implement live watching. If repeated-session support becomes essential, stop and scope source-version normalization as its own change.

Do not start the full Flow Map recognizer implementation as experiment #1: it tests structural extraction quality and framework coverage before establishing whether the ownership interaction matters. A manually curated five-step flow inside an existing WorkspaceTrace can test the system lens much more cheaply.

## 15. Concrete boundary for the recommended first experiment

**Outcome:** in Current Understanding, select a manually named concept, inspect existing claims and repository/source bindings, and export the exact scoped context with acceptance and uncertainty visible. This is the only recommended initial implementation. The rest remains proposed.

### 15.1 Included behavior and storage

- Reuse `UnderstandingProject` and user-created `UnderstandingObject` feature/system identities. Concept creation records the user's actual input; suggested sample labels remain suggestions until chosen and do not imply implementation or endorse attached decisions.
- A small **local experiment manifest**, explicitly loaded/saved as JSON, holds concept membership, selected artifact locators and optional hierarchy. Refer to existing IDs; do not copy all source content or invent duplicate decision identities. Validate project identity, source kind, size and dangling references. Explain unsaved state and offer export; no hidden localStorage store or new sync kind.
- Read existing understanding objects/events, relevant intents/traces, decision traces, Prepared Changes and selected cached paths. Build one pure topic read model with separate accepted/pending lanes and source availability. General evidence adaptation is limited to the concrete locator types present in the two chosen slices.
- Show exact path/ID candidates with deterministic reasons. Do not make AI associations or semantic dependency claims. No background ingestion, repository fetching or provider calls on opening/selecting a topic.
- Build a bounded Markdown + JSON packet with current text snapshots, IDs, content digests, explicit disposition and unavailable/omitted coverage. A legacy `accepted/edited` flag can be displayed as legacy review; it must not invent actor, time or approval of the latest DecisionTrace. Explicit packet review can record a **new** dated endorsement/adoption of selected exact statements, preserving their original AI/user/unknown origin.
- Keep the exported packet/adoption receipt as the experiment artifact. Do not mutate legacy accepted text or add an alternative production revision store. A successful pilot should move revision semantics into the shared Decision Authoring/Understanding contract, not leave manifests as a permanent parallel truth system.

### 15.2 Likely participating files and planned edits

All files below already exist unless marked **new proposal**. This table identifies probable boundaries, not changes made by this exploration.

| File/module | Role in first experiment |
|---|---|
| `src/types/understanding.ts` | Reuse project/object/event types and open feature/system type values; no new union or DB schema required. |
| `src/lib/db/understanding.ts` | Reuse loaders and deliberate user concept creation; do not treat its review setters as exact revision adoption. |
| `src/lib/understanding/currentUnderstanding.ts` | Reference grouping logic, but build claim/event eligibility explicitly; do not feed its merged evidence unchanged to an accepted packet. |
| `src/lib/understanding/livingDocument.ts` | Reuse deterministic formatting pattern; preserve existing document behavior during the experiment. |
| `src/lib/understanding/map.ts` | Keep existing temporal map; no graph library or replacement layout. |
| `src/lib/understanding/decisions/meta.ts`, `decisionMatrix.ts` | Reuse qualified labels and metadata, with legacy/trace qualifications visible. |
| `src/lib/db/decisionTraces.ts`, `src/lib/db/intentTraces.ts`, `src/lib/db/preparedChanges.ts` | Read existing related records by ID/project; validate cross-project references in the adapter. |
| `src/lib/repo/search.ts`, `src/lib/db/repoFiles.ts`, `src/types/repo.ts` | Read already indexed selected snapshot paths; exact-match candidates and unavailable-cache state. No new indexer. |
| `src/types/evidence.ts`, `src/types/intentTrace.ts`, `src/types/decision.ts` | Preserve different locator/source contracts; wrap with explicit claim role instead of coercing everything into mechanical evidence. |
| `src/lib/prepare/export.ts`, `src/lib/chat/context.ts` | Reference existing handoff/preview approach. Do not change global export or chat context behavior in this slice; packet export uses its own stricter pure builder. |
| **New proposal:** `src/lib/understanding/topicExperiment.ts` | Small local manifest validator, scoped record adapter and candidate association logic. No providers or network imports. |
| **New proposal:** `src/lib/understanding/topicContext.ts` | Pure packet selection, frozen text/digests, explicit origin/adoption/uncertainty, budget and coverage reporting. |
| **New proposal:** `src/components/understanding/TopicExperimentView.tsx` | List/detail, manifest load/save, source links, exact packet preview/export; feature-gated experimental lens. |
| `src/pages/ProjectUnderstandingPage.tsx` | Only production page integration expected: explicit experimental lens beside existing views. No new top-level route. |
| **New proposal:** adjacent `topicExperiment.test.ts`, `topicContext.test.ts`, `TopicExperimentView.test.tsx` | Verify trust boundaries and usable selection/export, not snapshots that merely mirror implementation. |

No expected edits to `backend/`, crypto, detection, protected investigation modules, provider relay, sync kinds, schema migrations, parsers, repository write access, or either app's product behavior. Slop is read-only input for this experiment. If those changes become necessary, stop expanding this slice and create a separate bounded plan.

### 15.3 Acceptance and stop conditions

Required tests: reject cross-project and invalid references; pending/rejected claim exclusion from authoritative sections; pending evidence cannot become accepted support; accepted claim plus pending contradiction stays visibly challenged; latest unreviewed trace cannot inherit old adoption; missing raw/cache sources remain explicit; no invented actor/time; deterministic identical packet from identical inputs; oversized constraints cause visible incompleteness rather than silent truncation; no provider/network calls during read/selection/export; source text cannot inject UI markup or packet authority.

Manually verify on both repos: create/reopen concept selection through manifest export/import, inspect exact evidence, distinguish observation from intent, preview/export the same packet, and follow unavailable-source behavior. Record retrieval time, errors, setup effort and the owner's qualitative reaction. No requirement for a visually elaborate graph or an arbitrary number of accepted nodes.

Stop after this slice and the comparison protocol. If the semantic distinctions confuse users, revise language and workflow before adding automation. If setup dominates value, try improving the existing document export before automatic entity extraction. If the packet materially helps but the lens does not, keep the packet. If both help, proceed to one actual change loop; only then consider continuous reconciliation or MCP transport.

## 16. Exploration verification

Production code and existing proposal files were left unchanged. All Markdown repository links resolve; inline paths absent from Chatdex are explicitly proposed new files or identified Slop paths. `git diff --check` passed for tracked changes; this new document was also checked for trailing whitespace.

- `npm run typecheck`: passed.
- Frontend suite in `npm run test:all`: 118 files, 978 tests passed.
- The initial combined command's backend phase failed JWT-secret validation and consequently skipped route tests. A backend-local `npm test` rerun with an explicit non-production test-only `JWT_SECRET` passed: 7 files, 53 tests. No environment files or test code were changed.
- No browser acceptance, live-provider request, imported private-session analysis, Slop test run or proposed experiment was performed. Passing existing tests establishes a limited baseline, not the proposed UI's behavior or product usefulness.
