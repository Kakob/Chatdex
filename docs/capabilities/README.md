# Capabilities

A capability owns a lasting product responsibility. Its spec describes the current
agreed contract; draft or unimplemented behavior must be labeled explicitly.
A capability can serve several pages and need not map to one code directory.

Bounded implementation work belongs in [changes](../changes/README.md), which defines
the planning and completion workflow. Shared repository behavior belongs to
[Repository Integration](./repository-integration/SPEC.md); its consumers document
only how they use it.

## Document roles

- `SPEC.md`: current contract and boundaries. Amend existing rules when behavior changes.
- `PRD.md`: user needs and purpose, only when separate requirements add value.
- `ROADMAP.md`: future possibilities, explicitly distinct from current behavior.
- Existing `PLAN.md`, `BUILD-LOG.md`, `TODOS.md`, reports, and amendments remain in place
  as legacy delivery records. Preserve open checks; use change packages for new work.

Not every capability needs every file. Link to the owning document instead of copying
its rules. Build logs preserve historical decisions; they do not override current specs.

## Classification of the former tracks

Branch Binding moved to [changes/branch-binding](../changes/branch-binding/PLAN.md):
it is a bounded fix spanning several consumers. All other former tracks remain
capabilities. In particular, Change Workspace is a persistent user-facing capability,
and Flow Map is a proposed lasting capability despite having no implementation yet.

## Capability status

Ordered by build sequence, not by age.

| Capability | Status | Next action |
|---|---|---|
| [agent-observability](./agent-observability/) | Built — Phases 0–8 + browse chips; intervention amendment merged (SPEC §10, I0–I6) | Phase 8b or I0 |
| [understanding-workspace](./understanding-workspace/) | Built — U0–U6 (U0–U5 live-verified) | Browser pass on U6.1 + U6.2 |
| [decision-investigation](./decision-investigation/) | MVP code-complete — DI-0…DI-4 | Jacob's §18 manual acceptance pass, then the §20 deferred list |
| [intent-trace](./intent-trace/) | Code-complete — IT-0…IT-6 | Jacob's §16 browser pass |
| [change-workspace](./change-workspace/) | Code-complete — CW-0…CW-8 | Jacob's §18 browser passes |
| [decision-recovery](./decision-recovery/) | Code-complete — DR-0…DR-7 (demo fixture on unmerged `demo/project-deletion`) | Jacob's §16 browser pass; [review experience delivery](../changes/decision-review-experience/PLAN.md) |
| [flow-map](./flow-map/) | Draft spec (2026-09-07), no code | Approve the spec's §21 decisions D1–D10, then FM-0 |
| [repository-integration](./repository-integration/SPEC.md) | Existing shared behavior documented; read-only | Branch Binding acceptance checks in its change plan; future refresh/write work in roadmap |
| [activity-tracker](./activity-tracker/) | Chrome extension — in progress | — |

---

## Other documentation

| Location | What lives there |
|---|---|
| `docs/prds/` | Product-level PRDs that span capabilities (core platform, AIPKMS, PatternMirror, research contribution) |
| `docs/architecture/` | System and auth architecture |
| `docs/assessments/` | Point-in-time reconnaissance of the repo, plus `recon-screenshots/` |
| `docs/territories/` | Territory guides — how one capability works end to end |
| `docs/ownership/` | The code-ownership loop: exercises, investigations, module notes, audit log |
| `docs/vision/` | Narrative vision and roadmap documents |
| `docs/archive/` | Superseded documents, kept for history — do not update links here |
