# Decision review experience

Status: Completed — implemented and verified locally on 2026-09-08; not deployed.
Change specification: [SPEC.md](SPEC.md). Build evidence: [BUILD-LOG.md](BUILD-LOG.md).
Primary capability: [Decision Recovery](../../capabilities/decision-recovery/SPEC.md).
Related capability: [Repository Integration](../../capabilities/repository-integration/SPEC.md)
for displaying the snapshot used, without changing connection behavior.

## Problem

During the 2026-09-08 browser review, an existing recovery showed 203 candidates
(37 specified, 144 inferred, 8 invented, 14 unknown). Important choices, routine edits,
and decisions about other projects appeared together in long cards. Session names were
frequently identical. Evidence required navigating away from the list.

The run initially displayed 281 warnings including dropped context, unverifiable quotes,
response failure, and output caps. Warning visibility did not survive detail navigation.
This is observed behavior from one run, not a claim about all stored runs.

Two inspected examples expose wording problems: a local-data/server-data separation
was attributed to the user from a bug report plus an agent edit; a two-second Copied
indicator was labeled Invented despite a supporting code edit. Quote presence alone
does not establish user authorship, rationale, adoption, or absence of existing patterns.

## Goal and preservation boundary

Make the existing recovered data useful without another provider run. Preserve decision
IDs, trace IDs, source evidence, original recovered text, run associations, and existing
review history. UI navigation, search, filtering, and evidence display make no model
calls. Do not automatically accept, reject, merge, reassociate, or rewrite candidates.

## Proposed changes

1. Compact searchable rows with a persistent evidence/detail panel. Preserve selection,
   filters, and scroll position when inspecting a candidate or opening its source.
   Use visual truncation of original titles initially; do not generate new summaries.
2. Explicit grouping by session or normalized file path, with date/ID context for repeated
   session names. Optional path-derived topics must expose the mapping and an ungrouped
   bucket; they are navigation aids, not claims about project relevance or importance.
3. Put concise source quotes and their roles before expanded code hunks. Distinguish
   original AI reconstruction from mechanically observed evidence and human review.
4. Replace overconfident presentation of legacy basis/made-by values with evidence-aware
   wording. A cited user message means user evidence is present, not that the exact
   implementation was requested. Retain original classification for audit. Do not infer
   undocumented rationale merely from a code change or rename every Invented item to
   Rationale not recorded without inspecting what its stored evidence supports.
5. Clarify that reviewing a reconstruction asks whether it accurately describes history;
   endorsing behavior for future work is a separate action. Verify existing accept/reject
   effects before relabeling shared controls; no UI-only change may promise unsupported
   semantics. Any new review state requires an explicit storage and migration design.
6. Show run revision and recoverable coverage warnings. Inspect persisted fields first.
   If run-wide diagnostics were never saved, display that limitation rather than
   reconstructing totals from incomplete trace warnings. Preserve future diagnostics
   separately if needed without fabricating a health report for this old run.

## Scope and exclusions

Initial delivery is a deterministic browser over existing objects, traces, and evidence.
User-selected filters must not delete or silently hide data by inferred importance.
Do not classify all decisions in a multi-project session as unrelated automatically.
Manual reversible organization (hide routine items, mark unrelated, or group related
candidates) is a follow-up phase after its persistence and undo behavior are designed.
Automatic semantic consolidation, new extraction, oversized-session recovery, attribution
reclassification by a model, repository polling, and repository writes are excluded.

## Contract amendments required

At proposal time, Decision Recovery sections 2.2 and 7.3 define mechanical basis/attribution rules;
sections 6 and 7 define stored vocabulary; section 2.7 restricts ranking and salience;
section 10 defines UI behavior. Presentation amendments are now defined in this change SPEC and applied to the capability SPEC; persisted derivation rules remain unchanged. The first phase must identify exact presentation changes
and distinguish them from any future change to persisted derivations.

Retain chronological ordering and transparent user-selected grouping; introduce no
importance score. If new evidence cues exceed section 2.7's permitted salience, amend
that clause explicitly. Review semantics must also respect the Understanding Workspace
review contract. Decision Investigation's quarantine remains unchanged.

## Implementation steps

1. **Assess existing data:** inspect decisionMatrix, meta, traces, review controls, run
   summaries, and diagnostics storage. Establish a sanitized representative fixture.
   Record fields available in old data, gaps, and required contract amendments.
2. **Browse and inspect:** implement compact rows, search/grouping, evidence panel,
   keyboard navigation, stable navigation state, and bounded rendering for large lists.
3. **Clarify evidence and review:** implement agreed wording and attribution limitations;
   verify review side effects; display the recorded revision and available diagnostics.
4. **Acceptance and reconciliation:** exercise the existing run without rerunning recovery,
   update the capability contract, and record limitations and follow-up packages.

## Acceptance criteria

- [x] Existing recovered objects and traces remain usable without migration-dependent regeneration.
- [x] Browsing/search/filter/group actions make zero provider calls and preserve raw records.
- [x] Selecting candidates reveals evidence without losing list position; source links still work.
- [x] Keyboard users can select, inspect, and return; large result sets do not require rendering all details.
- [x] Repeated session names are distinguishable; active filters and result counts are explicit and clearable.
- [x] Code evidence is not presented as proof of rationale or user adoption; legacy classification remains inspectable.
- [x] Review copy accurately describes persistence effects and does not conflate accuracy with endorsement.
- [x] Recorded run SHA is distinguished from current binding; unavailable coverage diagnostics are labeled unavailable.
- [x] Targeted tests cover old-data compatibility, filtering/navigation, evidence wording, and preservation; required repository checks pass.
- [x] Browser pass on the existing output succeeds without a new recovery run or unintended review mutations.

## Documentation updates

Amend Decision Recovery's relevant sections when corresponding behavior ships; link to
this plan from the capability index. Add a build log only when implementation begins.
Repository Integration's shared contract changes only if connection behavior changes,
which is outside this package. Do not create a separate Decision Review capability.

## Outcome

Delivered a local browser over existing candidates with pagination, search, explicit grouping,
keyboard selection, source-first evidence, original classification inspection and honest
provenance. Existing records and trace derivations are preserved. Verification: 973 frontend
and 6 backend tests, typecheck, lint, production build, and browser inspection of the existing
203-candidate run. See BUILD-LOG.md for precise checks and limitations.

No new recovery run, data migration, or review mutation was performed on the user's data.
Complete historical run-wide diagnostics cannot be reconstructed; persisting future run
reports, organization/undo and improved extraction remain follow-up work.
