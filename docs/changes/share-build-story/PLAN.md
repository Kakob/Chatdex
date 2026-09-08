# Share Build Story

Status: Proposed — documentation prepared 2026-09-08; no implementation or publication.
Primary capability: Private → Shared (proposed).
Requirements: [PRD.md](PRD.md). Behavior: [SPEC.md](SPEC.md).
Related: [Decision Authoring & Evidence](../decision-authoring-evidence/PLAN.md),
[Experiment Lab](../experiment-lab/PLAN.md).

## Agreed scope

Collect material during unfinished work, write a narrative with directed AI assistance,
review selected evidence excerpts, and publish to a Chatdex-hosted unlisted page.
Export is also required. Updates are explicit; unpublish withdraws hosted access but
cannot recall downloads. Readers read, explore and reuse; feedback uses existing
external contact links. Analytics are aggregate only, not individual reader journeys.

The story demonstrates exploration and judgment, including unresolved results. It is
not required to claim success or supply runnable code. Default formats, exact routes,
local draft storage and analytics retention are proposed implementation choices.

## Dependencies and contract reconciliation

| Owner | Amendment when implementation lands |
| --- | --- |
| New Private → Shared capability | Own selection, sanitization, publication copies, exports and aggregate analytics. |
| [Root invariants](../../../CLAUDE.md) | Document the explicit public-publication storage path separately from private ciphertext sync and transit-only provider relay. Do not globally weaken either invariant. |
| [Understanding Workspace §9, §11, §15](../../capabilities/understanding-workspace/PRD.md) | Private Add to story selection and pinned revision provenance; no public access to source objects. |
| [Decision Recovery §10](../../capabilities/decision-recovery/SPEC.md) and authoring package | Collect selected interpretations; do not mutate traces/decisions through prose edits. |
| [Change Workspace §14](../../capabilities/change-workspace/SPEC.md) and Experiment Lab | Private source collection actions, selected snapshot handoff, no automatic publication. |
| Backend/auth/storage architecture docs | Separate owner/public routes and tables, retention, deletion and logging policy after implementation design is verified. |

There is no assumed existing publication service or public-story infrastructure.
Do not call private sync or AI relay a publishing backend. Source AI evidence can be
collected before advanced authoring exists; preserve its recorded origin and limits.
The three features can be delivered incrementally with adapters and explicit availability.

## Delivery

1. **SB-0: Publication boundary design.** Inspect current auth/storage/hosting/logging,
   select public routes/tables and response strategy, define snapshot schema and
   deletion/retention behavior. Use sanitized adversarial fixtures and threat cases.
2. **SB-1: Private composition.** Story collection, selected evidence tray, writing,
   attribution, source revision pinning and optional scoped AI drafts. No public reads yet.
3. **SB-2: Review and export.** Allowlist compiler, redaction/recipient preview,
   exact-candidate approval, static HTML/Markdown exports and leak/renderer checks.
4. **SB-3: Hosted publication.** Authenticated reviewed publish/update/unpublish,
   public reader page, active-only exports, owner management, idempotency and deletion.
   Deploy server schema/API before exposing publication controls; existing private
   sync/relay behavior stays intact. No deployment is authorized by drafting this plan.
5. **SB-4: Aggregate engagement.** Allowlisted counters, author dashboard, notices,
   retention and logging audit. Confirm no reader profiles or journey reconstruction.
6. **SB-5: Acceptance and reconciliation.** Logged-out walkthrough, privacy/security
   checks, full repo verification, lasting contracts and operational documentation.

## Acceptance

- [ ] Collect decisions/chats/code/specs/attempts into a private draft before work finishes.
- [ ] Write and reshape AI suggestions without inventing motives or hiding contribution origin.
- [ ] Review narrative, excerpt context, links and downloads as one exact candidate.
- [ ] Hosted responses and exports contain only approved fields, with no private-source access.
- [ ] Unlisted reader page needs no account and offers approved evidence and reusable material.
- [ ] Draft/source edits leave published content unchanged until reviewed update.
- [ ] Retried publish is idempotent; stale updates cannot revive an unpublished revision.
- [ ] Old revisions and all current public exports become unavailable after withdrawal.
- [ ] Offline export works and matches reviewed content; analytics code is absent from exports.
- [ ] Aggregate counters show activity with no reader/session IDs or profiling.
- [ ] Owner authorization, deletion, logging and unavailable-source behaviors pass inspection.

## Shared acceptance story

Build a private story about investigating Chatdex's GitHub code-to-evidence pipeline.
Select one revised interpretation, a scoped documentation gap and an unfinished lab
attempt. Explain what remains uncertain and include a reusable investigation checklist.
Remove a seeded private marker, inspect the final preview, export, and publish a test
snapshot. In a logged-out browser, read/expand/download without private access. Edit
the draft and confirm the page is unchanged; publish an update, inspect aggregates,
and unpublish. Verify prior/public endpoints cannot bypass withdrawal. Use sanitized
fixtures and a test environment rather than expose real private work for acceptance.

## Outcome

Documentation only. All implementation acceptance remains open. Typecheck, lint,
focused client/server/security tests and full frontend/backend tests are required as
behavior lands. Documentation-revision checks are recorded after this editing pass.

### Documentation verification — 2026-09-08

Local Markdown targets and change-index entries checked; `git diff --check`,
`npm run typecheck`, `npm run lint`, and `npm run test:all` passed (973 frontend
tests and 6 backend tests). These checks validate the current repository after a
documentation-only edit; they do not satisfy the feature acceptance checklist above.
