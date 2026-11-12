# Model-native engineering platform — vision, architecture, and first five tasks

**Status:** Proposed — not implemented  
**Date:** 2026-11-12  
**Working branch at time of assessment:** `feature/engineering-shared-code-workspace`  
**Primary purpose:** Make Chatdex a practical environment for creating, understanding, modifying, verifying, and maintaining *real* software through a persistent model, initially from a phone connected privately to the user's laptop.  
**Related capabilities:** [Repository Integration](../../capabilities/repository-integration/SPEC.md), [Understanding Workspace](../../capabilities/understanding-workspace/PRD.md), [Change Workspace](../../capabilities/change-workspace/SPEC.md).  
**Earlier experimental implementation:** [Engineering abstraction prototype](../engineering-abstraction-prototype/PLAN.md) and [Iteration 4 coding workspace](../engineering-abstraction-prototype/EXPLORER_CODING_WORKSPACE_4.md).

> **Working recommendation:** Deliver one thin end-to-end loop: local source → deterministic structural model → navigable model-scoped edit → guarded write to the laptop → reanalysis and expected-versus-actual check → targeted verification → local Git commit. Build the *same portable core* for web, CLI, and desktop. Do not spend the next iteration on AI provider integration, animated diagrams, or more authored sample models.

This plan records the direction discussed across the engineering workflow, concept definition, discovery, mobile editing, remote workspace, and local Git-control explorations. It is a proposal and a capability inventory, **not** a claim that its envisioned behavior exists today. Implemented details below are restricted to the engineering branch inspected on November 12, 2026.

## 1. What Chatdex is meant to become

Chatdex aims to be a persistent, navigable engineering abstraction *above source files*, through which an engineer can understand and change real software while retaining direct access to all its code. The primary entry point is the model, not necessarily a file tree. It should let people understand subsystems, interfaces, responsibilities, behaviors, data and relationships, then work through these objects to change the actual implementation.

The distinction from a code-outline/IDE feature is **persistent, reattachable engineering understanding with executable change workflows**. A graph of exported functions is useful, but not the product's differentiator. Likewise, a manually authored diagram that points to code is not the core.

The user's immediate goal is **private dogfooding on existing projects**, not public launch, external user feedback, or an artificial demo engineered around the Event Queue. Prefer bounded, working increments with real source read/write and honest reconciliation. Phone use is essential to current workflow: the user wants to perform engineering in Chatdex on an iPhone while source code and execution can remain on a laptop. Existing GitHub cloud-editing is useful, but GitHub should not be compulsory for local changes.

### Nonnegotiable principles

1. **Actual source is authoritative for source facts.** Derive and rebuild structure deterministically. Never save an authored imitation of a TypeScript symbol as the authoritative source graph.
2. **Persistent understanding is separate from derived structure.** Concepts, human intent, claims, explanations and accepted decisions survive source edits; they must resolve/re-attach to current source and report drift.
3. **Code is first-class.** The engineer may hand-code directly, paste code, or eventually delegate to an agent. Model-directed engineering cannot require accepting agent-generated code blindly.
4. **One change protocol.** Human, deterministic, and future agent changes all use the same version checks, source diffs, model reconciliation, and verification semantics.
5. **No silent staleness.** An outdated source-backed assertion must never appear current/verified simply because it is stored in a model.
6. **Generality over bespoke demonstrations.** Production engineering-core code may have TypeScript-specific adapters, but no Event-Queue-, Todo-, or Chatdex-specific structural model branches.
7. **Portable engine.** Reuse core types and algorithms across browser, CLI and desktop. Platform differences live in file/Git/execution adapters.
8. **Safe, explicit effects.** Restrict filesystem access to approved roots, use baseline checks, and never expose unrestricted shell execution to a remote browser.

## 2. Model vocabulary: do not conflate these things

| Object | Meaning | Source of truth |
|---|---|---|
| Source entity | Actual file, module, class, method, function, type, property or declaration | Deterministic analyzer at a specific source snapshot |
| Structural relation | Containment, import/export, type relationship or analyzer-supported reference | Deterministic analyzer, with explicitly stated coverage |
| Engineering scope | An explicit selection or graph query, such as "all references to type T" or "module's public surface" | Saved query/selection, resolved against current graph |
| Software concept | Coherent, purposeful functionality in the sense of Daniel Jackson's *The Essence of Software* | Human-authored or AI-proposed, subject to review |
| Concept realization | Mappings between a concept's state/actions and the source that currently implements them | Versioned bindings and evidence, continually re-resolved |
| Claim | Statement about behavior, constraints, intent, or observation | Authored/inferred statement, with independent evidence and trust state |
| Engineering operation | A bounded requested source/model change | Saved change contract + actual edits, with before/after versions |
| Evidence | Source excerpt, tested result, execution observation, commit or document | Exact provenance and revision/time |

**Daniel Jackson-inspired software concept:** Name, purpose, operational principle, state, actions and relevant constraints. A meaningful concept may span many source files. A source graph *scope* is not automatically a software concept. The existing Chatdex Landscape uses "concept" for a navigational `LandscapeRegion`; preserve that UI vocabulary, but introduce a distinct typed *software-concept specification/realization* rather than silently changing old Landscape semantics.

The initial source model must work without any concepts at all. Concepts can be created by the engineer from one or more source seeds plus generic relationship-follow rules; an unimplemented concept can have intended actions/state with zero currently resolved implementation members. Later, AI may propose software-concept boundaries, purposes and candidate mappings. Suggestions remain pending, not verified.

Three independent state axes must not be collapsed:
- **Freshness:** current / reanalyzing / stale (relative to source snapshot and analyzer version).
- **Change:** proposed / pending / applied (relative to an engineering operation).
- **Trust:** asserted / needs review / evidence-backed (identify tests, source snapshot and limits). "Code observed" is not "behavior proven."

## 3. Full capability vision and prioritization

### A. Source understanding and persistent modeling

- Read actual GitHub, local and eventual remote-working-tree source snapshots; retain revision/provenance.
- Generate modules, declarations, signatures, types, imports/exports and supported references with a TypeScript compiler-backed analyzer, independently of project names.
- Navigate from whole system to subsystem, module, method and exact implementation; semantic zoom as projects scale.
- Track source-entity identity and changes across edits using paths/containers, signature and body fingerprints; handle ambiguous identity conservatively.
- Persist reusable graph scopes and purposeful software concepts, their implementation anchors, actions, claims and verification.
- Re-resolve attachments after source changes; flag missing, ambiguous and changed implementations.
- Support read-only static navigation first; richer architecture/workflow representations after the structural layer exists.
- Eventually extend language adapters beyond TypeScript and ingest tests, runtime observations, history, documents and conversations.

### B. Model-directed programming and verification

- Select a source entity or concept and inspect/edit its actual implementation; allow zero-code projects and concepts awaiting implementation.
- Capture expected changes using three constraint categories: **must appear**, **may change**, **must not change**. Define allowed effects and relevant verification.
- Support direct hand coding now, deterministic transformations later, and agent-produced code through the same protocol.
- Generate an inspectable patch/diff; reject stale baselines; write only to an approved source target.
- Rebuild source graph after writing; compare expected/actual structural effects, detect unexpected edits and concept-membership changes.
- Run targeted compiler/test commands and persist results as evidence (not as universal semantic proof).
- Preserve engineering operations as progress/history objects linked to concept, source versions, affected code, checks and eventual commits.
- Allow multi-file changes in time; avoid assuming one concept equals one file.

### C. Mobile, local development, Git, and cloud

- Use the existing Chatdex web UI from an iPhone to navigate the *real* working tree of an approved laptop project.
- Run a minimal, authenticated local companion service with private HTTPS access (e.g., a properly scoped private connection). Keep laptop running while remote access is needed.
- Read local code and Git status/diffs; safely edit code; ask for approved typecheck/tests; stage/commit selected changes; create/switch branches with safeguards.
- Show staged/unstaged/untracked files separately; never accidentally stage unrelated changes from Claude Code, the IDE, or other tools.
- Preserve GitHub as an optional source/remote adapter. A local Git commit does not require GitHub, push or pull.
- Allow a future CLI and desktop app to operate through the same analyzer/model/change contracts. Don't build a separate "CLI model" or "web model".
- Eventually support cloud development environments and GitHub-branch writes, but keep the first local workflow direct.

### D. Rich navigation and observation (later)

- A unified structure explorer with multiple named workflow overlays; workflows reuse the same components rather than each owning a separate diagram.
- Semantic zoom, filtering, larger mobile code/test inspector, and relationships spanning multiple scopes and files.
- Real execution trace playback projected over model structures, distinguish recorded/live/proposed workflows, and animate active paths.
- Distinguish runtime states, architectural roles, source symbols and verification evidence; don't mix them as undifferentiated nodes.
- Scale benchmarking beyond Todo and Event Queue: a media publishing app; local file organizer; digital synthesizer/sequencer; interpreter; eventually existing larger projects.

### E. AI capabilities (explicitly deferred from next five tasks)

- Reuse existing Chatdex LLM relay and project-discovery patterns to **suggest** Daniel Jackson-style software concepts based on source-derived graph and bounded excerpts; validate proposed source entity IDs and verbatim evidence before review.
- Add AI-assisted concept boundary refinement and concept-to-source realization suggestions.
- Make in-app conversations with multiple AI providers preserve shared engineering context, with no provider owning the canonical model.
- Make agents implement edits through the same change protocol as human coding, supporting handoff/takeover.
- Later import conversation history, architectural decisions and other source materials into evidence-backed understanding.

## 4. Verified current state (engineering branch, 2026-11-12)

| Capability | Actual state | Code |
|---|---|---|
| Revision-oriented source reading | Exists (GitHub and supported local folder readers; bounded index) | `src/lib/repo/`, `src/lib/db/repoFiles.ts` |
| Symbol/relationship discovery | Textual and heuristic search, **not** arbitrary TypeScript semantic graph generation | `src/lib/repo/search.ts` |
| Generic graph projection | Works over *preexisting* concepts/edges; does not parse code | `src/lib/engineering/modelGraph.ts` |
| Example model structure | Largely authored; not generated from arbitrary source | `src/lib/engineering/demoProjects.ts`, `modelCatalog.ts`, `sourceCatalog.ts`, `fixture.ts` |
| Stored proposals, code bindings and history | Works in local-only engineering model storage | `src/lib/engineering/modelStore.ts` |
| Read source from a selected model entity | Works if binding exists; examples include authored binding catalogs | `src/components/engineering/BoundSourceInspector.tsx` |
| Human and agent-result code staging | Works for full-file drafts; not executing pasted code | `src/components/engineering/SourceBuildWorkspace.tsx`, `src/lib/engineering/codingStore.ts` |
| Actual source write | Guarded desktop Chromium local directory action; **not** iPhone → laptop filesystem | `src/lib/engineering/localWorkspaceWriter.ts` |
| Live examples | Actual in-browser Event Queue and Todo reducer; tailored examples | `src/lib/engineering/liveQueue.ts`, `todoModel.ts` |
| Deterministic code → structural model | **Missing** | No generic analyzer currently wired |
| Reconcile structural model on code change | **Missing** | No automatic parse/diff/reattach loop |
| Model → real code through generic operations | **Missing** | Wording proposals and full-file staging are not model-directed transforms |
| Mobile local-service editing / Git buttons | **Missing** | No authenticated laptop service/API for this workflow |
| Integrated compile/test on source edits | **Missing** | Existing CI/tests are external to the editor loop |
| AI software-concept discovery from source graph | **Missing** | Existing AI project discovery/Intent Trace are reusable precedents, not this feature |

Relevant implemented precedents: `src/lib/understanding/discovery.ts` (LLM proposals, evidence, review); `src/lib/understanding/trace/judge.ts` (source-quote verification); `src/lib/providers/relayClient.ts` (providers). Neither is needed to build the first deterministic engine.

**Assessment:** We have the shell—data readers, model/inspector UI, source staging—and real runnable examples, but **not yet the general engineering engine or bidirectional local workflow**. Claims of "continuously synchronized model" must remain future-tense.

## 5. Proposed platform boundary

Design a portable `engineering-core` library with **pure inputs/outputs** and no React, IndexedDB, network or Node filesystem requirement in its semantic algorithms:

`SourceSnapshot` → analyze → `DerivedGraph`  
`DerivedGraph` + `ScopeDefinition` → resolve → `ResolvedScope`  
`PreviousGraph` + `CurrentGraph` → reconcile → `StructuralDelta / IdentityMatches`  
`ConceptDefinition` + `Graph` → resolve implementation → `ConceptResolution`  
`EngineeringOperation` + `Before / After` → check expected/may/forbidden → `ChangeCheckResult`

These are proposed interfaces, not shipped APIs. TypeScript compiler dependency belongs in a language adapter reused in both browser and Node; use compilation/language services only for facts the analyzer can actually establish. The derived graph may be cached but is reconstructable. Model concepts and history are persisted separately with versioned schema/migrations; persistent data should eventually be portable (a structured `.chatdex/` format is an option, **not** an accepted format yet).

**Workspace-adapter boundary:** A separate service supplies actual source snapshots, guarded patches, Git state, explicit Git operations and approved checks; browser-local and future GitHub adapters use the same contracts. Keep the existing read-only `RepoSource` semantics intact; introduce a distinct write-capable interface rather than silently granting writes to all readers.

**Phone-to-laptop architecture:** The service runs on laptop and operates on explicitly approved roots. The iPhone browser sends authenticated, scoped requests over a private HTTPS connection. Protect against arbitrary path traversal, symlink escapes, cross-origin request abuse, prompt/source injection in commands, command argument injection, replay, stale file writes and accidental dirty-tree loss. Do not offer arbitrary shell execution or unreviewed Git reset/force-push. Tests/builds run only via an allowlisted command set. The service should not silently push code to GitHub or ship source to an LLM.

**No need for desktop-first UI:** The web Explorer remains the phone interface. A CLI may later wrap identical service/core contracts. If mobile access proves impractical for editing larger source files, improve the UI and use laptop editing where appropriate without splitting the engine.

## 6. First dogfoodable vertical slice

The minimum *valuable* test is not a fancy diagram or an auto-generated function stub. It is:

1. Connect the phone to a **real, approved local TypeScript project** on the laptop.
2. Read its current source and Git status.
3. Build an actual source-derived structural model automatically, with no project-specific fixture.
4. Navigate to an operation (from the model), optionally save a purposeful concept from a generic scope query, and inspect code/tests.
5. Edit the implementation by hand through Chatdex on the phone.
6. Apply with exact revision/baseline guards; observe the edited file in the laptop's actual working tree.
7. Reanalyze in full, compare before/after graph, re-resolve affected concepts and check expected/allowed/forbidden changes.
8. Inspect local Git diff, run an approved check, stage specifically selected modifications, and commit locally.
9. Repeat on a different, previously unseen small TypeScript codebase **without adding application-specific engine code**.

Initially **always rebuild the model in full** after an edit; defer watcher/incremental parsing until measured performance requires it. For identity match by qualified name and containing scope, then independent signature/body fingerprints; ambiguity → needs review, never a fabricated match. A code-graph change is not automatic behavioral proof.

## 7. Next five ordered engineering tasks

Each task is a useful tested deliverable, not a separate UI demo. Finish with a real phone-to-laptop acceptance walkthrough.

### Task 1 — Portable source snapshot + deterministic TypeScript analyzer

**Goal:** Prove arbitrary source-to-graph derivation outside the handcrafted examples.

**Work:**
- Define versioned JSON-friendly `SourceSnapshot`, `SourceEntity`, `SourceRelation`, `DerivedGraph` and diagnostic/provenance types.
- Build a TypeScript compiler-based analyzer over an in-memory map of files. Start with modules, functions, classes, methods, interfaces/types, containment, imports/exports and resolvable references.
- Canonicalize graph order and source identity/fingerprints. Full rebuild is fine.
- Keep graph/query logic portable; no fixture-specific branches.

**Acceptance:**
- Same snapshot + analyzer version ⇒ equivalent graph.
- Works on the Todo model, Event Queue, and an unseen TS module.
- Empty source collection produces a valid empty graph.
- Unsupported or unresolved references are flagged, not invented.
- Automated tests run in Node; core can be imported in a browser build.
- Existing read-only repo code and examples continue to work.

### Task 2 — Secure, read-only local workspace bridge reachable from phone

**Goal:** Connect Chatdex mobile UI to actual source on the laptop, not a browser-local imitation.

**Work:**
- Introduce a minimal Node companion service with approved root(s), narrow auth/pairing, private HTTPS access and explicit browser-origin policy.
- Read selected project files and Git branch/status/diff with read-only, bounded endpoints; no general command endpoint.
- Connect a phone-friendly project picker/connection indicator in the existing Explorer.
- Ensure no hidden GitHub requirement or LLM call.

**Acceptance:**
- With laptop/service running, phone can view a real approved local repository and its Git status/files.
- Unapproved directories/path traversal, unauthenticated requests, unsupported origins and oversized reads are denied.
- No write or shell capability exposed yet; existing Git changes are untouched.
- Tests cover both permitted and forbidden requests. LAN/private-network setup documented.

### Task 3 — Render *derived* structure in the real Explorer

**Goal:** Replace a project-specific model entry point with the new analyzer output.

**Work:**
- Feed the snapshots from Task 2 into the portable analyzer from Task 1.
- Add generic structure navigation from package/module → class → function/method → source.
- Show exact source locations and snapshot version; handle collapsed/filtered large structure on mobile.
- Keep existing authored engineering concepts separate rather than mixing them into derived fact tables.

**Acceptance:**
- Phone navigates a real local project by derived entities instead of a file tree.
- It can select a discovered method and open its current source.
- Rerun with an unfamiliar TS module; no new renderer or mapping fixture required.
- Missing/ambiguous source references are visible, not silently faked.

### Task 4 — Model-scoped guarded edit, write and deterministic reconciliation

**Goal:** Make the model a real entry point for programming.

**Work:**
- From a selected source entity, edit code (including paste) using the shared human/agent-ready source-revision format.
- Send a **version-checked edit** to the laptop working tree through a narrow write adapter; preserve unrelated edits.
- Reparse the resulting source; compute added/removed/changed entities; conservatively match identities.
- Track an expected/may/must-not change contract, report changes outside declared scope, and provide truthful stale/conflict status.
- Initially use full rebuild on every successful apply; no watcher required.

**Acceptance:**
- Change actual TypeScript on iPhone and see the modified laptop source file.
- Model recomputes from actual changed bytes without manual relationship fixture changes.
- Stale baseline or outside-root writes fail without modifying files.
- A hand edit external to Chatdex can be picked up by explicit refresh; unrelated edits don't trigger fictitious changes.
- A second unrelated TypeScript app exercises the same path.

### Task 5 — Persistent concept scope + local Git and verification loop

**Goal:** Complete a useful engineering session, not merely edit a file.

**Work:**
- Create a named software concept with a purpose plus source seed(s) and one generic scope rule. Save previous resolved membership and independently version any behavioral claims.
- Start a concept-scoped engineering operation; show resolved members, related files and linked tests. Check expected/allowed/forbidden deltas after change.
- Add narrowly scoped local Git status/diff/stage/commit actions and allowlisted typecheck/test commands to the companion service. Do not stage unrelated changes implicitly.
- Link results, code revisions and local commits to the concept/change session.
- Dogfood the full experience from iPhone on two unlike TS programs, keeping one previously unseen until acceptance.

**Acceptance:**
- Related source change updates or flags concept realization; unrelated change leaves it current where justified.
- Stage selected files only; local commit appears in laptop repository without GitHub.
- Approved compiler/test results are displayed with actual command, outcome and revision.
- From phone: choose model entity/concept → edit local code → reanalyze/check → verify → diff/stage/commit.
- Existing data untouched outside the explicitly approved project. No LLM required.

**Implementation sequencing note:** Task 5 combines concept semantics and Git/verification to reach the *complete* dogfoodable loop in five tasks, but it may be internally split into smaller commits. The model-scoped edit + reconciliation in Task 4 is the first critical engineering milestone. Task 2 can begin with a trivial two-file repo while Task 1's analyzer is under development.

## 8. Exclusions and decision register

| Idea | Status | Revisit when |
|---|---|---|
| General source-derived model and phone-to-laptop source access | **Build now** | Tasks 1–3 |
| Guarded model-scoped writes, full reanalysis, source diff | **Build now** | Task 4 |
| Persistent concept membership and expected-change checks | **Build now (minimal)** | Task 5 |
| Git stage/commit/test controls on phone | **Build now (minimal)** | Task 5 |
| Cloud GitHub commit adapter | Deferred | Local flow works or cloud-only requirement appears |
| CLI interface | Deferred interface, **core contract built now** | Portable core validated; wrap it cheaply |
| Desktop app | Deferred interface | Real OS integration/distribution need |
| AI-suggested software concepts | Deferred to after deterministic graph | Source IDs/quote validation exists for arbitrary source |
| Multiple LLM agents and in-app provider switching | Deferred | Shared human change pipeline proven |
| Conversation history, docs and other evidence ingestion | Deferred | Source-grounded concept model stable |
| Trace animation and recorded runtime workflows | Deferred | Real trace sources and structure mapping exist |
| Rich workflow overlays and semantic zoom | Deferred polish | Medium project usability demands it |
| New full-application sample | Deferred | Unseen existing programs validate core |
| Code generation / complex refactoring transforms | Deferred | Hand-code loop and checks work |
| Incremental parsing, file watching, complex move detection | Deferred hardening | Full rebuild is too slow or misses real needs |
| Public feedback, pricing, launch | Deferred | Private dogfooding demonstrates genuine benefit |

## 9. Risks and safeguards

**IDE-outline trap:** A file/function tree alone is not the product. Track meaningful concept-scoped work early.

**Hardcoded-demo trap:** Never create `analyzeEventQueue()` or `analyzeTodo()` in production core. Keep examples in tests and configurations only.

**Overclaiming freshness:** If source changed after analysis, show stale/reanalysis. If concept evidence is only a quote, do not call semantic behavior verified.

**Overengineering identity:** Support conservative matching now; complex rename+rewrite, splits and merges can report ambiguous.

**Remote security:** Source mutation and Git execution on a laptop require explicit authorization and strict API constraints. Avoid generic "run shell command" endpoints.

**Dirty working tree:** Apply with baseline hashes; expose Git status before and after. Stage explicit file paths (and eventually hunks), not an automatic `git add .`.

**Phone ergonomics:** Code editors require enough viewport height; long-lived project context and consistent selection should survive toggling between structure, code and checks.

**Persistence:** Structural graph cache can rebuild; authored concepts and changes need a portable, versioned storage plan. Do not silently sync private code or credentials to remote providers.

## 10. End-to-end definition of done

The proposed first platform milestone is complete when, **from the user's iPhone**, Chatdex can:

> Connect privately to a laptop's real TypeScript working tree, derive a structural model without hand-authored fixtures, select an operation and a persistent purposeful concept, change the actual source through that model, reanalyze and explain the model delta, run an approved check, inspect Git diff, stage selected changes, and create a local commit—with no GitHub push or LLM call.

Repeat on an unseen TS module with the same engine; record what fails or feels worse than ordinary code editing. If concept-scoped engineering does not improve the experience, refine the abstraction before adding animations, extra sample apps, or autonomous agent code.

## 11. Evidence, existing implementation, and document authority

This plan is a future proposal and **does not amend shipping capability contracts**. Its "now" labels refer to implementation priorities, not shipped status. As work lands, link relevant commits/test results and update the actual owning capability specifications; keep earlier experimental engineering records as historical documents.

Read in conjunction with:
- [Engineering iteration 4 — coding workspace](../engineering-abstraction-prototype/EXPLORER_CODING_WORKSPACE_4.md)
- [Engineering iteration 3.5 — general graph projection and source bindings](../engineering-abstraction-prototype/EXPLORER_ITERATION_3_5.md)
- [Engineering prototype handoff](../engineering-abstraction-prototype/CHATDEX_ENGINEERING_ABSTRACTION_PROTOTYPE_HANDOFF.md)
- [Repository integration contracts](../../capabilities/repository-integration/SPEC.md)
- [Change Workspace contracts](../../capabilities/change-workspace/SPEC.md)
- [Understanding Workspace](../../capabilities/understanding-workspace/PRD.md)

**Final priority call:** Task 1 (portable deterministic analyzer) and Task 2 (minimal read-only local bridge) are the first two investments. The actual demonstration that matters is Task 4: model-selected source editing on iPhone modifies the *real laptop file* and regenerates the model without project-specific mapping code. Task 5 turns that into a complete engineering session.
