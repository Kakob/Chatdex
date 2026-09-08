# Decision Recovery — Build Log

Companion to `docs/capabilities/decision-recovery/SPEC.md` (authoritative) and
`docs/capabilities/decision-recovery/TODOS.md`. Records what was actually built per
milestone plus operational notes. One milestone per session; each row lands
with typecheck + lint + tests green.

| Milestone | Date | Commit | Summary |
|---|---|---|---|
| DR-0 | 2026-09-07 | `16ca1b6` | Spec with §2 laws 2.1–2.10, data model (Decision object + `DecisionTrace` + `AgentInspection` + `DecisionDiff`), pipeline, blast radius v1, diff, security audit S1–S10, milestones DR-0…DR-7, killer-demo scenario; Flow Map draft moved to Dexie v14 |
| DR-1 | 2026-09-07 | `6b73106` | `src/types/decision.ts`; Dexie v13 (`decisionTraces` synced, `agentInspections` + `decisionDiffs` LOCAL-ONLY); sync kind `decision_trace` end to end; agent-inspection deriver + import hook + backfill; `extractSessionCommits`; cursor `lastDecisionRecoveredAt` |
| DR-2 | 2026-09-07 | `8ff344f` | Recovery pipeline: `candidates.ts` (user messages + per-anchor agent context + rendered hunks, pre-existing file oracle), `prompt.ts` (JSON contract), `firewall.ts` (span/code verification, recomputed offsets, basis constraints, derived madeBy), `runRecovery.ts` (`planRecovery` before any call; one call per conversation; pending objects + traces; cursor), `symbols.ts`, `decisionMatrix.ts`, `fromInvestigation.ts` (VerdictOrigin → Decision meta bridge); boundary guard extended |
| DR-3 | 2026-09-07 | `07154b6` | Decisions tab (`/projects/:id/decisions`) + detail (`decisions/:objectId`): basis / made-by / unsupported badges, session-or-file grouping, basis-count filters, review + history, Recover run with disclosure (hunk + excerpt counts), session-commit sha hints, `RepoBindingCard`; detail shows why, alternatives, assumptions with bases, implemented-by hunks (anchor route, read-only) + code lines (cache + blob links), transcript spans, source conversations |
| DR-4 | 2026-09-07 | `81a21fb` | Blast radius v1 (`blastRadius.ts` + panel: symbol references outside own files, sessions via the anchor reverse index, decisions sharing paths, tests; heuristic, zero network); `WorkspaceOriginKind 'decision'` + `PrepareChangePage ?decision=` seeding via `replacement.ts` (constraints from specified/inherited assumptions, open choices from the rest + alternatives, attached evidence, idempotent); `challenge.ts` (disclosed, verdict → pending supported/contradicted/refined event) |
| DR-5 | 2026-09-07 | `b0e57d9` | Semantic Decision Diff: `diff.ts` (`foldDecisionDiff` — new_decision / revised (+changedFields) / new_assumption / invalidated / unresolved, deterministic order; `computeOrLoadDiff` LOCAL-ONLY under `${from}..${to}`; `recordInvalidation` + `mergeDecisions` as user-origin events); `DecisionComparePage` at `decisions/compare` with run picker, counts, grouped entries, evidence links, Record-as-contradicted, Same-as merge |
| DR-7 | 2026-09-07 | `a4d967d` | Parser 1.2.0: `uuid`/`parentUuid`/`isSidechain`/`agentId` kept as `StoredMessage.sourceMeta`; subagent transcripts (sibling files carrying the parent's sessionId) get `${sessionId}:agent:${agentId}` ids, `providerMeta { isSidechain, agentId, parentSessionId }`, and a “· subagent” name; spans from delegated conversations labelled on the detail page. Built before DR-6 because the demo transcript is itself a subagent file |
| DR-6 | 2026-09-07 | _(this commit)_ | Dogfood demo: subagent run on `demo/project-deletion` → commit `9987455` (unmerged); sanitized fixture `tests/decision-fixtures/project-deletion.{jsonl,response.json,expected.json}` + test pinning 2 specified · 1 inherited · 3 inferred · 1 invented; pipeline fixes the fixture forced: Bash read-only commands derive inspections, closing agent statements always in excerpts, decision-level `inheritedFrom`, quiet-commit `git log --oneline` fallback; CLAUDE.md invariant-6 sentence; status → built |

---

## Operational notes

### ⚠ Deploy order for DR-1

`backend/src/routes/sync.ts` `KindSchema` gains `'decision_trace'`. **Deploy
the backend before the frontend** — a frontend pushing a trace to an older
backend gets a 400 on the whole push batch (same shape as IT-0). 14 chars,
within varchar(32); no column migration.

---

## Milestones

### DR-0 — Spec + docs (2026-09-07)

- `docs/capabilities/decision-recovery/SPEC.md`
- This log; `docs/capabilities/decision-recovery/TODOS.md`
- `docs/README.md` row; `CLAUDE.md` "Next up" paragraph
- Flow Map draft (`docs/capabilities/flow-map/SPEC.md`, its log and TODOs) moved from Dexie v13 to v14 so DR-1 can take v13.

### DR-1 — Types, storage, sync, deterministic capture (2026-09-07)

- `src/types/decision.ts`; Dexie v13 in `src/lib/db/schema.ts`; helpers in `src/lib/db/{decisionTraces,agentInspections,decisionDiffs}.ts`.
- `decision_trace` sync: `syncApi.ts`, `serializer.ts` (`envelopeDecisionTrace` / `rehydrateDecisionTrace`), `engine.ts` (remove / apply / read / full-push / hooks / understanding_object → traces cascade), backend `KindSchema` + kind type (also added the missing `intent_trace` to the backend type union).
- `src/lib/investigation/agentInspections.ts` (Read / Grep / Glob / LS → what the agent saw), hooked into `import.ts`, cascades with conversation delete.
- `src/lib/understanding/decisions/sessionCommits.ts`.
- Tests: `localOnly.test.ts` (verno 13), serializer + engine coverage, deriver, commits, db helpers. 893 + 6 green.

### DR-2 — Recovery pipeline (2026-09-07)

- `src/lib/understanding/decisions/` — `meta.ts`, `candidates.ts`, `prompt.ts`, `firewall.ts`, `symbols.ts`, `runRecovery.ts`, `decisionMatrix.ts`, `fromInvestigation.ts`, `index.ts`.
- Design notes: one `complete()` per conversation so step indexes are unambiguous; hunk paths are made repo-relative in the plan; `invalidates` land only on traces and resolve `statement:` placeholders against the target's latest trace assumptions; the cursor advances only for unscoped runs with zero errors.
- Tests: firewall (every basis downgrade, dropped unverifiable spans, offsets, caps, re-recognition), candidates, symbols, run integration with a mocked relay (plan-before-call, secret assertion, pending-only persistence, supported-event re-recognition, failure isolation), investigation bridge, boundary guard (`understanding/decisions` forbidden from detection/investigation; decisions reach investigation only via db accessors + the one-way promotion). 922 + 6 green.

### DR-3 — Decisions tab + detail (2026-09-07)

- `src/pages/DecisionsPage.tsx`, `src/pages/DecisionDetailPage.tsx`; routes in `App.tsx`; tab (Scale icon) after Intent Trace in `ProjectWorkspaceLayout`.
- `src/components/decisions/{BasisBadge,EvidenceLists,AssumptionList,DecisionList}.tsx`; `src/lib/understanding/decisions/links.ts` (`safeBlobUrl`).
- Disclosure copy names your messages, the agent's reasoning before each edit, the hunk count, and the repository excerpt count (law 2.6). The only accent on the surface is the unsupported-autonomous badge (law 2.7).
- Detail page fetches without setting state inside the effect (lint rule `react-hooks/set-state-in-effect`).
- Tests: `src/pages/DecisionsPage.test.tsx` (rows, badges, escaping, filters, grouping, review; disclosure before any provider call, then run; detail page sections + links). 925 + 6 green.

### DR-4 — Code links, blast radius, replacement change, challenge (2026-09-07)

- `src/lib/understanding/decisions/blastRadius.ts` — `computeBlastRadius(trace, projectId)`; `matchTreePath` resolves the agent's absolute hunk paths to snapshot paths by unique suffix. `src/components/decisions/BlastRadiusPanel.tsx` mounts behind a toggle on the detail page.
- `src/lib/understanding/decisions/replacement.ts` — `createReplacementWorkspace` / `findReplacementWorkspace`; a pending decision never enters `understandingPointIds` (the workspace creator enforces accepted understanding). `PrepareChangePage` handles `?decision=<id>` in a promise callback with a ref guard against double creation.
- `src/lib/understanding/decisions/challenge.ts` — own prompt + firewall rather than a fake `PreparedChange` through Assisted mode (default #5 resolved: the wrapper would have needed a synthetic workspace). Verdict map: holds → `supported`, challenged → `contradicted`, cannot_tell → `refined` ("Challenge inconclusive"), all `origin: 'ai'`, pending.
- Tests: blast radius (fixture snapshot, related sessions/decisions/tests, capping, missing snapshot, `fetch` spy never called), replacement (seeding, idempotence, accepted vs pending), challenge (plan-before-call, code windows, verdict mapping, token assertion), `PrepareChangePage.decision.test.tsx`. 936 + 6 green.

### DR-5 — Semantic Decision Diff (2026-09-07)

- `src/lib/understanding/decisions/diff.ts`, `src/pages/DecisionComparePage.tsx`, route `projects/:id/decisions/compare` (static segment ranks above `:objectId`). Compare button appears on the Decisions tab once two runs exist.
- Fold rules as spec §12; an invalidated decision is not also reported unresolved. `revised.changedFields` ∈ {why, alternatives, assumptions, assumption bases, implementing paths}.
- Human reactions never mutate the diff: `recordInvalidation` writes a user-origin `contradicted` event (applied immediately, law 2.3 is about AI output); `mergeDecisions` writes a user-origin `superseded` with `supersededByObjectId` (the default-#3 "same as…" action).
- Tests: `diff.test.ts` (five ops, deterministic ordering, idempotent id, persistence once per pair, user events), `DecisionComparePage.test.tsx` (two-run gate, default newest pair, grouped entries, record action). 943 + 6 green.

### DR-7 — Parser 1.2.0 + delegation (2026-09-07; before DR-6 by design)

- Observed from this very session's files: subagent transcripts are **sibling files** `<sessionId>/subagents/agent-<agentId>.jsonl`, every entry `isSidechain: true` with `agentId` and `promptId`, and they carry the **parent's** `sessionId` and `cwd`. Parser 1.1.0 would therefore have given a child the parent's conversation id (a silent collision). No inline sidechain entries exist in the main transcript; the import directory walker already recurses into `subagents/`.
- `src/types/claude-code.ts` metadata fields; `src/types/unified.ts` `MessageSourceMeta` + `StoredMessage.sourceMeta?` (only set when the source carried it — older fixtures byte-identical); `src/lib/parsers/claude-code.ts` 1.2.0.
- UI: `SpanLinks` / `AssumptionList` / `DecisionDetailPage` label spans from `providerMeta.isSidechain` conversations "delegated".
- Spec §18 item "sibling-file subagent transcripts" is therefore done, not deferred. Golden traces unchanged (parser version is metadata only).
- Tests: `claude-code.sidechain.test.ts`. 947 + 6 green.

### DR-6 — Dogfood demo + fixture (2026-09-07)

- **Route.** The classifier blocked a nested `claude -p --dangerously-skip-permissions` in a worktree, so the demo ran as a general-purpose **subagent of the building session** in the main repo on `demo/project-deletion` (branched from the DR-7 HEAD so the agent saw the code Jacob runs). Prompt: the spec §16 sentence plus "run typecheck and frontend tests, commit on the current branch, do not push". The agent added `deleteUnderstandingProject()` (cascade of every project-scoped table, conversations/messages/rawSources untouched, one delete per row for sync tombstones), reused it in the sync engine's tombstone path, and a "Delete project" section with an inline alertdialog on the overview; 951/951 tests, typecheck and lint clean on its side; commit `9987455`. Branch left unmerged (recon P5).
- **What the transcript taught the pipeline** (each fixed here, with tests):
  1. The agent never used `Read`; it read with `sed -n`, `cat`, `grep -rn`. `agentInspections` 1.1.0 now derives inspections from read-only Bash commands (`bashInspections`).
  2. It stated most decisions in its closing summary after the last edit — outside every anchor window. `buildTranscriptExcerpts` now always includes the last 2 agent statements after the final edit.
  3. "Mirrors the existing `deleteConversation`" is a decision-level inheritance; the prompt and firewall now accept `inheritedFrom` on decisions, not only on assumptions.
  4. It committed with `git commit -q … && git log --oneline -1`; `extractSessionCommits` falls back to the oneline `<sha> <subject>` and takes the branch from a leading `git branch --show-current`.
- **Fixture.** `tests/decision-fixtures/project-deletion.jsonl` (87 user/assistant entries, paths → `/home/user/chatdex`, ids fixed, identity fields dropped), `project-deletion.response.json` (canned answer quoting the transcript, plus one fabricated decision the firewall must drop), `project-deletion.expected.json`, `project-deletion.test.ts` (parse → normalize → anchors + inspections → excerpts → firewall; pins the split **2 specified · 1 inherited · 3 inferred · 1 invented = 1 unsupported autonomous**, 4 edit anchors, ≥5 inspections incl. `src/lib/db/conversations.ts`, 1 commit). No provider call.
- **Not done here:** the live browser pass with a real provider (Jacob, TODOs).
