# Change Workspace — Build Log

Companion to `SPEC-change-workspace.md` (the authoritative spec) and
`CHANGE-WORKSPACE-TODOS.md` (user-side actions + engineering checklist). Records
what was actually built per milestone, plus operational notes that affect
deployment. One milestone per session; each row lands with typecheck + lint +
tests green.

| Milestone | Date | Commit | Summary |
|---|---|---|---|
| Spec | 2026-08-28 | _pending_ | `docs/SPEC-change-workspace.md` (laws §2, data model §7–§12, audit §15 S1–S12, milestones CW-0…CW-8, decisions D1–D11); `docs/PRD-code-ownership-loop.md` (Jacob's draft, verbatim); README + CLAUDE.md pointers; this log + todos |

---

## Operational notes

### No backend change for CW-0

The workspace extends the existing `prepared_change` sync kind; no new
`KindSchema` entry, so there is **no deploy-order constraint** (unlike IT-0).
Older frontends that receive a grown payload keep the unknown fields through
the serializer spread and simply don't render them.

### Local-only tables (Dexie v12)

`repoFiles` (whole-file cache for search) and `inspections` (view log) are
LOCAL-ONLY by law §2.5 / decision D3 / D9. They must never be added to the
sync engine's table list; a test asserts this (audit S1).
