# Decision Recovery — Build Log

Companion to `docs/specs/SPEC-decision-recovery.md` (authoritative) and
`docs/TODOS/DECISION-RECOVERY-TODOS.md`. Records what was actually built per
milestone plus operational notes. One milestone per session; each row lands
with typecheck + lint + tests green.

| Milestone | Date | Commit | Summary |
|---|---|---|---|
| DR-0 | 2026-09-07 | `16ca1b6` | Spec with §2 laws 2.1–2.10, data model (Decision object + `DecisionTrace` + `AgentInspection` + `DecisionDiff`), pipeline, blast radius v1, diff, security audit S1–S10, milestones DR-0…DR-7, killer-demo scenario; Flow Map draft moved to Dexie v14 |
| DR-1 | 2026-09-07 | `6b73106` | `src/types/decision.ts`; Dexie v13 (`decisionTraces` synced, `agentInspections` + `decisionDiffs` LOCAL-ONLY); sync kind `decision_trace` end to end; agent-inspection deriver + import hook + backfill; `extractSessionCommits`; cursor `lastDecisionRecoveredAt` |
| DR-2 | 2026-09-07 | `8ff344f` | Recovery pipeline: `candidates.ts` (user messages + per-anchor agent context + rendered hunks, pre-existing file oracle), `prompt.ts` (JSON contract), `firewall.ts` (span/code verification, recomputed offsets, basis constraints, derived madeBy), `runRecovery.ts` (`planRecovery` before any call; one call per conversation; pending objects + traces; cursor), `symbols.ts`, `decisionMatrix.ts`, `fromInvestigation.ts` (VerdictOrigin → Decision meta bridge); boundary guard extended |
| DR-3 | 2026-09-07 | `07154b6` | Decisions tab (`/projects/:id/decisions`) + detail (`decisions/:objectId`): basis / made-by / unsupported badges, session-or-file grouping, basis-count filters, review + history, Recover run with disclosure (hunk + excerpt counts), session-commit sha hints, `RepoBindingCard`; detail shows why, alternatives, assumptions with bases, implemented-by hunks (anchor route, read-only) + code lines (cache + blob links), transcript spans, source conversations |
| DR-4 | 2026-09-07 | _(this commit)_ | Blast radius v1 (`blastRadius.ts` + panel: symbol references outside own files, sessions via the anchor reverse index, decisions sharing paths, tests; heuristic, zero network); `WorkspaceOriginKind 'decision'` + `PrepareChangePage ?decision=` seeding via `replacement.ts` (constraints from specified/inherited assumptions, open choices from the rest + alternatives, attached evidence, idempotent); `challenge.ts` (disclosed, verdict → pending supported/contradicted/refined event) |

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

- `docs/specs/SPEC-decision-recovery.md`
- This log; `docs/TODOS/DECISION-RECOVERY-TODOS.md`
- `docs/README.md` row; `CLAUDE.md` "Next up" paragraph
- Flow Map draft (`SPEC-flow-map.md`, its log and TODOs) moved from Dexie v13 to v14 so DR-1 can take v13.

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
