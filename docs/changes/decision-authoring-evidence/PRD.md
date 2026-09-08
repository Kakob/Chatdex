# Decision Authoring & Evidence — product requirements

Status: Proposed, 2026-09-08. Delivery: [PLAN.md](PLAN.md). Behavior: [SPEC.md](SPEC.md).

## Purpose and audience

Chatdex helps people identify implicit decisions in software so they can change it
closer to what they actually want. Users need to develop their own evidence-backed
interpretations, with substantial AI help, rather than only accept/reject generated
reconstructions. Technical literacy varies: the experience must explain a choice
without requiring users to independently read every relevant file.

Awareness is a successful result. An undocumented-choice inventory is not a list
of obligations to fix immediately. Recording a choice does not approve it, adopt it,
change code, or update a specification.

## Primary walkthrough

Ask “How does Chatdex fetch GitHub code and use it as evidence?” Open code,
specifications and chats side by side. Inspect how sources are selected, cached and
cited. Find choices that lack support in the material examined, describe their
tradeoffs and ramifications, and preserve uncertainty. Later explore the transition
from read-only access to agent execution using the lab and Prepare Change. This
package supports understanding that transition; it does not implement execution.

## Investigation workspace

A question is the default starting point. Starting from a source is equally possible:
select a passage and pose a question, preserving source and parent-investigation
links. New questions can branch while browsing; returning to the original question
must remain easy. The desktop layout shows source panes and an optional chat beside
the working interpretation; narrower screens preserve selections through tabs.

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

No automatic specification/code edits, automatic adoption, actor inference from
missing documentation, compulsory importance scores, or agent execution. The existing
Decision Investigation detector/verdict system remains quarantined from AI assistance.
