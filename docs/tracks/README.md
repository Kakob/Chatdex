# Tracks

One folder per feature track. Each folder holds every document for that track —
spec, PRD, plan, build log, todos — so nothing about a track lives anywhere else.

**Filenames are fixed**, so a path is guessable without looking it up:

| File | What it is |
|---|---|
| `SPEC.md` | The binding implementation spec. Its numbered laws and security sections are authoritative. |
| `PRD.md` | Product requirements — the "why" and the user-facing shape. |
| `PLAN.md` | Phase/milestone ordering and acceptance criteria. |
| `BUILD-LOG.md` | Append-only record of what each milestone actually landed, with commit shas. |
| `TODOS.md` | What Jacob still has to do by hand (browser passes, approvals, decisions). |
| `ASSESSMENT-*.md`, `REPORT.md`, `AMENDMENT-*.md` | One-off documents that belong to this track. |

A track without a given file simply doesn't have one yet.

---

## Status

Ordered by build sequence, not by age.

| Track | Status | Next action |
|---|---|---|
| [agent-observability](./agent-observability/) | Built — Phases 0–8 + browse chips; intervention amendment merged (SPEC §10, I0–I6) | Phase 8b or I0 |
| [understanding-workspace](./understanding-workspace/) | Built — U0–U6 (U0–U5 live-verified) | Browser pass on U6.1 + U6.2 |
| [decision-investigation](./decision-investigation/) | MVP code-complete — DI-0…DI-4 | Jacob's §18 manual acceptance pass, then the §20 deferred list |
| [intent-trace](./intent-trace/) | Code-complete — IT-0…IT-6 | Jacob's §16 browser pass |
| [change-workspace](./change-workspace/) | Code-complete — CW-0…CW-8 | Jacob's §18 browser passes |
| [decision-recovery](./decision-recovery/) | Code-complete — DR-0…DR-7 (demo fixture on unmerged `demo/project-deletion`) | Jacob's §16 browser pass |
| [flow-map](./flow-map/) | Draft spec (2026-09-07), no code | Approve the spec's §21 decisions D1–D10, then FM-0 |
| [branch-binding](./branch-binding/) | Code-complete — steps 1–6 of the plan (parse, intake UI, both pages, recovery snapshot, tests) | Jacob's manual pass: PLAN.md §5 items 4–7 |
| [activity-tracker](./activity-tracker/) | Chrome extension — in progress | — |

---

## Documents that are not tracks

| Location | What lives there |
|---|---|
| `docs/prds/` | Product-level PRDs that span tracks (core platform, AIPKMS, PatternMirror, research contribution) |
| `docs/architecture/` | System and auth architecture |
| `docs/assessments/` | Point-in-time reconnaissance of the repo, plus `recon-screenshots/` |
| `docs/territories/` | Territory guides — how one capability works end to end |
| `docs/ownership/` | The code-ownership loop: exercises, investigations, module notes, audit log |
| `docs/vision/` | Narrative vision and roadmap documents |
| `docs/archive/` | Superseded documents, kept for history — do not update links here |
