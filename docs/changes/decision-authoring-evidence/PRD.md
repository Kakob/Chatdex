# Decision Authoring & Evidence — product requirements

Status: Proposed — revised 2026-09-09; no implementation. Delivery: [PLAN.md](PLAN.md). Behavior: [SPEC.md](SPEC.md).

## Purpose and audience

Chatdex helps people identify implicit decisions in software so they can change it
closer to what they actually want. Users need to develop their own evidence-backed
interpretations, with substantial AI help, rather than only accept/reject generated
reconstructions. Technical literacy varies: the experience must explain a choice
without requiring users to independently read every relevant file.

Awareness is a successful result. An undocumented-choice inventory is not a list
of obligations to fix immediately. Recording a choice does not approve it, adopt it,
change code, or update a specification.

## Product direction

The primary experience is exploring connected code around a question and preserving
understanding as it develops. This is especially useful for people navigating an
unfamiliar, AI-generated codebase. A file often contains irrelevant code while the
behavior being investigated spans several files. ChatDex should reduce the work of
finding those parts and mentally maintaining their connections.

Files remain the repository's storage format. Investigations assemble views over
selected source ranges; they do not create a second copy of the program. A capability
such as conversation search describes a durable behavior; an investigation asks a
focused question about it; a decision records an interpretation or proposed choice
and its rationale. The same code can participate in several of these contexts.
Capability-based entry is a future navigation option, not a requirement to classify
the repository before starting. An investigation can remain useful without producing
a decision. This workspace is distinct from the protected Decision Investigation
feature and does not expand its AI boundary.

## Primary walkthrough

Ask “How does Chatdex fetch GitHub code and use it as evidence?” Open code,
specifications and chats together. Assemble the relevant retrieval, cache and citation
code ranges from different files into one reading view. Inspect their connections,
expand surrounding source when necessary, and keep the question visible. Find choices
that lack support in the material examined, describe their
tradeoffs and ramifications, and preserve uncertainty. Later explore the transition
from read-only access to agent execution using the lab and Prepare Change. This
package supports understanding that transition; it does not implement execution.

## Investigation workspace

A question is the default starting point. Starting from a source is equally possible:
select a passage and pose a question, preserving source and parent-investigation
links. New questions can branch while browsing; returning to the original question
must remain easy. The desktop layout shows source panes and an optional chat beside
the working interpretation; narrower screens preserve selections through tabs.

Within the workspace, collect and arrange relevant functions, types, tests and other
source ranges from multiple files in one reading view. Each selection shows its path,
revision, reason for inclusion and available surrounding context. Users can pin,
reorder or remove selections without editing source files or historical evidence.
The collection is exploratory context; attaching a selection as support or contradiction
for a claim is a separate action. Preserve the collection when returning later.

Follow a source reference into related code and return without losing the collection
or question. Users can manually connect selections; AI can suggest relevant additions
and explain connections using disclosed sources. Distinguish observed source references,
user explanations and AI hypotheses. A collection is not proof that all dependencies
have been found. Expose search scope, unavailable material and uncertain connections.
Automatic caller resolution across arbitrary languages is not required for the first
slice; source links and explicit selections must remain useful without it.

Mobile reading and discussion are acceptance targets for this workspace, not merely
a compressed desktop layout. On a narrow screen, read the assembled code, select a
range, ask about it, inspect the response's sources and return to the same position.
A stacked collection and separate conversation tab are proposed layout defaults to
validate. Native mobile packaging, built-in voice and remote computer control are
not included; text input can include device-provided speech-to-text.

Capture code ranges, spec passages and chat excerpts as evidence. State a decision
manually, begin from an AI candidate, or ask AI to suggest candidates grounded in the
selected sources. Link support, contradiction and context to particular claims.
Keep unknown rationale/actor explicit. Annotations capture doubts, corrections and
later reflections without becoming an awkward substitute for editing the decision.

## Decisions and evolving interpretations

Support historical interpretations, observed implementation choices, and proposals,
visibly distinguished. Preserve the inception of an AI suggestion and subsequent
human/AI revisions. Version the interpretation of the system separately from changes
to the system itself. Editing “never refreshes” to “refreshes only on this action”
is a correction of understanding, not necessarily an architecture change.

Owning an interpretation differs from having made the original choice. A user can
stand behind “The agent introduced this; I investigated it and kept it” while AI
origin and uncertain historical authorship remain visible. Default to revisions of
the same decision; optional branches preserve competing interpretations.

## AI actions and conversation

Offer both ongoing chat and scoped actions such as Explain this, Find support,
Challenge interpretation and Suggest decisions. They share one conversation record.
With chat open, the answer appears there. With chat closed, a contextual preview can
show the same answer with Continue in chat; it must not create a disconnected answer
or issue a duplicate request. Show what sources are in scope.

AI suggests explanations, tradeoffs, ramifications and follow-up questions with
source connections. Unsupported portions remain hypotheses or questions. Accepting
an AI draft records adoption and preserves its origin. Manual work remains available
without AI credentials or connectivity.

## Source freshness and future editing

The long-term direction is a living workspace where source changes can be inspected
and reviewed human or AI edits can reach the underlying repository. This proposal's
first delivery is read-only source exploration and editable interpretations.

Historical evidence stays pinned to the revision actually examined. Loading a later
source revision must not rewrite an old quote or imply that the old explanation is
still correct. Show which revision is displayed and make unavailable source explicit.
Automated change watching, tracking selections through moved/renamed functions and
comparing current implementation with historical evidence require follow-up design.
Refreshing code and revalidating an interpretation are separate operations.

Mobile access must respect the existing repository contract: full file caches and
credentials are device-local, while eligible excerpts and locators can sync. A synced
investigation does not imply that the phone has its source files. The first slice
shows available excerpts and clearly identifies unavailable context; any supported
source retrieval uses the existing device-authorized read-only path. Choosing broader
mobile source access is a follow-up, not an implicit full-repository sync feature.

Repository editing requires a separate change covering execution location, reviewed
multi-file patches, stale-source conflicts, verification and recovery. Until then,
selected interventions use Prepare Change and existing external coding workflows.

## Negative space and follow-through

Distinguish no links yet, searched with no support found, and a documented conflict.
Show where the user or AI searched, at which revision, and what was unavailable.
No-support-found is scoped evidence about a search; it does not prove a choice was
made by AI, that documentation does not exist, or that behavior is wrong.

Keep interpretation, evidence support, documentation coverage, user position and
follow-up separate. Leave an item unresolved, acceptable for now, or worth changing.
Link a proposed documentation change without claiming the spec has changed. Only
new observed evidence can establish that a later specification includes the policy.

A selected question may enter [Experiment Lab](../experiment-lab/PRD.md); a known
intervention may go directly to Prepare Change. Selected revisions and evidence may
enter [Share Build Story](../share-build-story/PRD.md). The same decision identity
serves these surfaces so correction need not be repeated in several copies.

## Success and exclusions

A user can explain one previously implicit choice, inspect supporting material,
correct an AI interpretation, record a scoped documentation gap, and stop without
being forced to resolve it. The history explains who contributed what and why the
interpretation changed. A reader can follow selected evidence later in a story.

No repository or specification writes, automatic adoption, actor inference from
missing documentation, compulsory importance scores, or agent execution. The existing
Decision Investigation detector/verdict system remains quarantined from AI assistance.
