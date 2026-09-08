# Decision Authoring & Evidence — proposed contract

Status: Proposed, 2026-09-08. [PLAN.md](PLAN.md) owns delivery; [PRD.md](PRD.md) owns purpose.

## 1. Ownership and compatibility

Propose a Decision Authoring capability for the shared editable interpretation and
its history. Decision Recovery remains the owner of AI extraction and immutable
recovery traces. Do not replace or weaken its quote firewall, basis derivation, or
pending-output rules. Existing Decisions, Intent Trace and history surfaces are entry
points into one authoring workspace, not independent copies of the decision.

The existing identity is `UnderstandingObject` with type decision. Add revision records
keyed by that identity; do not create a second unrelated decision identity. Existing
DecisionTrace rows remain immutable source records. Manual/code-only decisions use
an authoring path, not fabricated recovery traces or fabricated transcript evidence.

## 2. Records and revisions

Proposed records use stable IDs, schema versions, project IDs and ISO timestamps.

| Record | Contract |
| --- | --- |
| DecisionInvestigationWorkspace | Question, project, parent/source links, selected source references, conversation ID, decision IDs, status/open notes. Distinct from protected DI cases. |
| DecisionRevision | Decision ID, parent revision(s), statement, interpretation kind, optional rationale/alternatives/tradeoffs/ramifications, author/origin, adoptedBy/at, recordedAt, subject snapshot/time, evidence links and annotation references. |
| DecisionEvidenceLink | Revision and claim/field ID, supports/contradicts/context role, source locator and bounded quote, linking author, integrity status. |
| SearchCoverage | Query/method, source set and revisions, actor, attemptedAt, results, exclusions, failures, unavailable sources and explicit completeness limits. |
| DecisionAnnotation | Target decision/revision/claim, text, origin/time, correction/supersedes link when applicable. Append-only. |
| AssistanceRequest | Workspace conversation ID, action, selected context snapshot, request ID, provider/model, disclosure state, response/message IDs, status. |

Interpretation kind is historical, observed-choice or proposal. These are not
confidence levels. Historical authorship claims remain separately sourced and may
be unknown. Never overwrite derived recovery madeBy/basis with a human authorship
claim. User position (unresolved/acceptable-for-now/worth-changing), documentation
coverage and follow-up links are independent from review status and source support.

Every revision preserves AI/user/pasted-unknown origin at field/contribution level.
Approving a suggestion records adoption without relabeling the generated contribution
as user-authored. A later manual rewrite records a user contribution with ancestry.
Original evidence links remain available in old revisions when removed from the new.
Explicit branch creates a competing revision; no automatic synthesis erases dissent.

On first edit of a legacy decision, create an idempotent baseline revision from its
stored values/trace references, labeled legacy snapshot with unknown provenance where
not recorded. Do not invent a historical actor or acceptance time. Keep a pointer to
the chosen current revision; stale-base edits require review rather than overwrite.
Human adoption updates the current projection transactionally. AI suggestions remain
pending and cannot silently become the current accepted revision. Unreviewed draft
interpretations are still inspectable and usable for further investigation.

## 3. Sources and negative space

Use existing repository and transcript locators where compatible. Validate quote
membership and recompute offsets using existing mechanisms; invalid quotes cannot
be saved as verified source spans. Store document path/version or hash, code repo/SHA/
lines, and chat message/span identity. A local snapshot marker is not a commit SHA.
Separate source integrity from whether the source semantically supports a claim.

A manual statement without evidence may be saved as unsupported, with absent fields
shown unknown. An AI suggestion presented as grounded must include valid supplied
source references; unsupported speculation may appear separately as a question or
hypothesis, never as established behavior. Code proves neither rationale nor actor.

Coverage states: unlinked, support-found, searched-no-support, conflicting, unknown.
Searched-no-support requires a SearchCoverage record. A failed or partial search is
visibly partial, not exhaustive. Any “undocumented” badge expands to its bounded
search scope and date; it does not set unsupportedAutonomous or madeBy. Changes to
sources mark the old coverage as historical/stale until an explicit new search.

Later documentation support requires a locator to an observed new document revision.
A planned documentation change remains a follow-up link. No automatic spec writes.

## 4. Workspace, chat and scoped actions

Proposed route `/projects/:id/decisions/workspaces/:workspaceId` with entry actions
from question, decision, code, spec or chat. Preserve existing decision routes and
links. Question creation from a selection records the source and optional parent
question. Project ID must match every loaded referenced object.

Source panes show exact selections, snapshot/availability and attach-as-evidence
controls. Users edit statement and individual evidence links directly. Keyboard
navigation, focus restoration and a responsive tab layout must preserve selections.

Explain/Find support/Challenge/Suggest actions create one durable request and one
conversation turn. Show disclosure with provider and actual selected sources, including
repository excerpts and cross-provider history. Expanded scope needs a new context
snapshot/disclosure as required by the existing policy. No automatic full-repo send.
Contextual preview and chat render the same response ID; Continue in chat opens the
same thread without another provider call. Follow-up messages retain source references
and make newly selected context explicit. Failed/cancelled requests keep honest state;
retry does not overwrite the first response. No claim to reveal hidden model reasoning.

Selecting sources, opening the workspace and manual edits make no provider calls.
Generated patches remain suggestions until explicitly applied to a revision. Reuse
current opt-in provider credentials and transit-only relay, not a new logging backend.

## 5. Integration and persistence

Reuse the existing decision UnderstandingObject projection and encrypted sync for
accepted shared records. Introduce revision/evidence/annotation/coverage/workspace
kinds only with matched client and backend schema support, serializers, apply paths,
parent ordering, tombstones and reset integration. Whole repo files remain local-only;
synced excerpts obey existing caps. Private chat and assistance records follow existing
conversation storage and ciphertext-sync rules.

Append-only revisions have unique IDs; conflicts between current-revision pointers
are surfaced for human selection, never flattened into last-write-wins text. Apply
children arriving before parents idempotently with a pending-link state. Deploy backend
kind support before clients emit new kinds. Until that support ships, feature-gate
new writes rather than send invalid sync records. No crypto primitive changes.

Existing recovery filters/derivations continue reading their own trace fields; authored
interpretation is visibly a separate projection. Legacy decisions stay readable without
migration inventing fields. Protected Decision Investigation tables and internal modules
must not consume recovery/authoring AI output. Its finalized findings can remain
read-only source links through allowed existing promotion boundaries.

Experiment handoff snapshots selected question/revision/evidence/uncertainty; Prepare
Change uses the existing reviewed draft flow. Story collection copies selected revisions
into private story material; it is not publication or disclosure of all linked sources.

## 6. Verification

Test code-only manual creation, unsupported-state display, quote integrity, evidence
role edits, revision ancestry/origin/adoption, stale-base edits and branches, legacy
baseline idempotency, scoped missing-support searches, source refresh, and new spec
support. Exercise one request rendered in preview and chat, provider disclosure,
failed retries, no automatic writes, project isolation, offline manual use and sync
ordering/conflicts/deletion. Preserve recovery firewall tests and DI boundary guards.

No automatic actor attribution, forced resolution, importance ranking, repository
writes, or weakening of recovery's existing constraints is included.
