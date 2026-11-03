# Experiment Lab — product requirements

Status: Proposed — revised 2026-09-08 after product discussion.
Delivery: [PLAN.md](PLAN.md). Behavior: [SPEC.md](SPEC.md).

## Purpose

A project has a browsable collection of ideas that develop over time. The user can
see what they are thinking about, planning, trying, and learning, and what a useful
next move might cost. Thinking about an idea already counts as development; creating
an attempt is not the admission requirement for appearing in the collection.

The initial population is the user's “Chatdex Experiment Lab — Expanded” bank.
The same experience should support their other apps. An idea can be adapted into
another project while its subsequent development remains independent.

## Agreed direction

The collection is the primary screen, combining ideas and work already started.
Visible states distinguish exploration, planning, and trying without separate product
silos or a compulsory sequence. Ideas intended for implementation belong alongside
uncertain experiments. Users may write or paste next moves and effort estimates, or
ask AI to suggest them. Origins remain visible where known.

An investigation can lead to an experiment, but is not required. Likewise, an
experiment need not become a Change Workspace. A user may prepare a change directly,
branch from a change into exploration, or stop after learning something useful.

## Experience

Open a project's Experiment Lab and browse cards or compact rows. Each entry shows
its title, area, state, current assessment, active attempt summary, and current next
move with a rough effort estimate. Search and explicit filters narrow this same
collection; an active-work filter does not relocate records into another workspace.
Open an idea to inspect its notes, questions, alternative next moves, attempts,
results, and linked changes. Original 30-minute / two-hour / deeper plans remain
visible as source suggestions rather than estimates of today's remaining work.

Example: “Execution Lights — Exploring. One mockup tried. Visually interesting;
usefulness uncertain. Next: instrument one real import step, roughly 30–60 minutes.”

Progress is expressed through state and recorded development, not a completion
percentage. A numerical score was discussed but not selected. An optional written
assessment is sufficient initially; no AI ranking or score is required.

## Catalog and ownership

Preserve all source entries, categories, original wording, effort tiers, and source
numbers where present. Numbering overlaps and some entries are unnumbered, so IDs
must be independent of numbers. Preserve introductory vision separately. Link likely
duplicates without silently merging them. Categories such as Attention need not
become capabilities. Blank source Notes labels are not observations of actual work.

The full collection is the default, not a curated six-card front door. Editorial
starter selections may be an optional filter. Listing future agent/security/runtime
ideas does not imply those capabilities are implemented. The full bank still needs
capture and reconciliation during implementation; these documents do not populate it.

## Next moves and attempts

An idea can have several possible next moves and one selected current move. Users
can type or paste descriptions and estimates. AI suggestions are explicit, scoped
requests; adoption is recorded and never starts work. Estimated effort has units,
optional range, uncertainty, and an optional reason. Unknown effort is valid.

A bounded attempt snapshots the question, action, prediction or uncertainty, and
relevant source material. Record observations, pause, resume, and finish with a lesson
or remaining uncertainty. Keep negative and abandoned attempts. Further trials get
new records; changing the parent idea cannot rewrite the starting conditions.

## Connections and shared example

[Decision Authoring & Evidence](../decision-authoring-evidence/PRD.md) investigates
how Chatdex fetches GitHub code and uses it as evidence. A discovered uncertainty can
seed an idea with backlinks and selected evidence. The lab could compare mockups or
external prototypes for future agent execution; it does not execute agents itself.
A chosen intervention can enter Prepare Change, and selected results can enter
[Share Build Story](../share-build-story/PRD.md) before the work is finished.

## Success and exclusions

The user can find an existing idea, record early thinking, see a useful next move,
resume an attempt, and retrieve a lesson. Adapting the idea into another app must not
mix project histories. Assess these through a real walkthrough, not telemetry.

Defer learned recommendations, compulsory scores, timers, automatic activity capture,
full graph canvases, generic multimodal ingestion, agent orchestration, and repository
writes. AI assistance for next moves is part of this proposal, not deferred entirely.
