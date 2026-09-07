# Decision Recovery — Build Log

Companion to `docs/specs/SPEC-decision-recovery.md` (authoritative) and
`docs/TODOS/DECISION-RECOVERY-TODOS.md`. Records what was actually built per
milestone plus operational notes. One milestone per session; each row lands
with typecheck + lint + tests green.

| Milestone | Date | Commit | Summary |
|---|---|---|---|
| DR-0 | 2026-09-07 | _(this commit)_ | Spec with §2 laws 2.1–2.10, data model (Decision object + `DecisionTrace` + `AgentInspection` + `DecisionDiff`), pipeline, blast radius v1, diff, security audit S1–S10, milestones DR-0…DR-7, killer-demo scenario; Flow Map draft moved to Dexie v14 |

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
