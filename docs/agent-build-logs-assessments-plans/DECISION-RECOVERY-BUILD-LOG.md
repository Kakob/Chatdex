# Decision Recovery — Build Log

Companion to `docs/specs/SPEC-decision-recovery.md` (authoritative) and
`docs/TODOS/DECISION-RECOVERY-TODOS.md`. Records what was actually built per
milestone plus operational notes. One milestone per session; each row lands
with typecheck + lint + tests green.

| Milestone | Date | Commit | Summary |
|---|---|---|---|
| DR-0 | 2026-09-07 | `16ca1b6` | Spec with §2 laws 2.1–2.10, data model (Decision object + `DecisionTrace` + `AgentInspection` + `DecisionDiff`), pipeline, blast radius v1, diff, security audit S1–S10, milestones DR-0…DR-7, killer-demo scenario; Flow Map draft moved to Dexie v14 |
| DR-1 | 2026-09-07 | `6b73106` | `src/types/decision.ts`; Dexie v13 (`decisionTraces` synced, `agentInspections` + `decisionDiffs` LOCAL-ONLY); sync kind `decision_trace` end to end; agent-inspection deriver + import hook + backfill; `extractSessionCommits`; cursor `lastDecisionRecoveredAt` |
| DR-2 | 2026-09-07 | _(this commit)_ | Recovery pipeline: `candidates.ts` (user messages + per-anchor agent context + rendered hunks, pre-existing file oracle), `prompt.ts` (JSON contract), `firewall.ts` (span/code verification, recomputed offsets, basis constraints, derived madeBy), `runRecovery.ts` (`planRecovery` before any call; one call per conversation; pending objects + traces; cursor), `symbols.ts`, `decisionMatrix.ts`, `fromInvestigation.ts` (VerdictOrigin → Decision meta bridge); boundary guard extended |

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
