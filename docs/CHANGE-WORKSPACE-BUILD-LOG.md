# Change Workspace — Build Log

Companion to `SPEC-change-workspace.md` (the authoritative spec) and
`CHANGE-WORKSPACE-TODOS.md` (user-side actions + engineering checklist). Records
what was actually built per milestone, plus operational notes that affect
deployment. One milestone per session; each row lands with typecheck + lint +
tests green.

| Milestone | Date | Commit | Summary |
|---|---|---|---|
| Spec | 2026-08-28 | `4425b0b` | `docs/SPEC-change-workspace.md` (laws §2, data model §7–§12, audit §15 S1–S12, milestones CW-0…CW-8, decisions D1–D11); `docs/PRD-code-ownership-loop.md` (Jacob's draft, verbatim); README + CLAUDE.md pointers; this log + todos |
| CW-0 | 2026-08-28 | `a704ee0` | Workspace schema: `EvidenceItem` union (`src/types/evidence.ts`), `PreparedChange` sections + widened `state` (draft→ready→implementing→verified→closed), `UnderstandingEvent.codeEvidence?`, per-section editability table, lifecycle (`attachImplementation` freezes the open hypothesis, `markVerified` gate, `closeWorkspace`), relaxed creation (intent OR accepted understanding, D7), criteria↔acceptanceCriteria mirror, Dexie v12 LOCAL-ONLY `repoFiles` + `inspections` with helpers, serializer revives lifecycle Dates (nested ISO, D11), S10 guard extended, S1 sync-absence test |
| CW-1 | 2026-08-28 | _pending_ | Repository search: `src/lib/repo/` — `RepoSource` interface, GitHub source over the hardened client, resumable indexer into LOCAL-ONLY `repoFiles` (fetch-gate denylist + excluded dirs before caching, 200 KB / 2000 files / 50 MB caps, rate-limit stop with retry time, `shouldStop`), pure `grep` / `findSymbol` / `findReferences` with context lines, path globs, hit cap, regex safety pre-check + per-file time budget (S8), `buildCodeEvidence` (scrubbed, capped, hashed quote — S4); Evidence section on the Prepare Change page (index banner with on-device disclosure, search modes, add-as-evidence, manual line range, evidence list with validated blob links); Settings → GitHub "Clear repository cache" |

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
