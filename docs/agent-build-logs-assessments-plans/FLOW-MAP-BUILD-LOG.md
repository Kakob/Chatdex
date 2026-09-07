# Flow Map — Build Log

Companion to `docs/specs/SPEC-flow-map.md` (the authoritative spec) and
`docs/TODOS/FLOW-MAP-TODOS.md` (user-side actions + engineering checklist). Records
what was actually built per milestone, plus operational notes that affect
deployment. One milestone per session; each row lands with typecheck + lint +
tests green.

| Milestone | Date | Commit | Summary |
|---|---|---|---|
| Spec | 2026-09-07 | _(draft, uncommitted)_ | `docs/specs/SPEC-flow-map.md` (laws §2, data model §7–§8, recognizers §9, derivation §10, bridges §12, audit §15 S1–S12, milestones FM-0…FM-5, proposed decisions D1–D10 pending Jacob's confirmation); README + CLAUDE.md pointers; this log + todos |

---

## Operational notes

- No backend change is planned in any milestone: the derived map is LOCAL-ONLY (Dexie v14) and kept flows reuse the existing `understanding_object` / `understanding_event` sync kinds (D1, D2).
