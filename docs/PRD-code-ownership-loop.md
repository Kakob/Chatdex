# Chatdex — Code Ownership & Understanding Loop

**Status:** Draft (Jacob, 2026-08-28)
**Area:** Current Understanding / Investigate History / Prepare Change
**Working principle:** Automation may accelerate implementation. It must not erase provenance, intent, evidence, or the path back to human understanding.

> This is the product draft, reproduced verbatim. The binding implementation spec derived from it is `SPEC-change-workspace.md`; references there to "PRD §n" point at the sections below.

---

## 1. Problem

Modern software teams can produce and modify code faster than they can maintain an accurate understanding of it.

This problem exists across different development styles.

A developer coding primarily by hand may struggle to:

* orient themselves in a large codebase,
* identify the code responsible for a behavior,
* follow execution across files,
* remember why previous decisions were made,
* distinguish what they know from what they assume,
* and preserve what they learned for the next investigation.

A developer using coding agents heavily may struggle with a different version of the same problem:

* large changes arrive faster than they can review them,
* agent reasoning disappears into chat transcripts,
* implementation decisions are difficult to reconstruct,
* generated code becomes unfamiliar,
* assumptions and uncertainty are hidden,
* and the team's understanding falls behind the state of the software.

Chatdex should support both workflows.

The product should not prescribe how much code a human or AI ought to write.

Instead, Chatdex should make it possible to establish, inspect, verify, preserve, and recover human understanding of a software system regardless of how its implementation was produced.

---

## 2. Product Thesis

Chatdex helps developers keep their understanding synchronized with rapidly changing software.

The system connects:

Intent → investigation → understanding → change → verification → durable understanding

Every change should leave behind enough evidence that a developer can later answer:

1. What behavior were we trying to change?
2. Why did we want to change it?
3. How did the relevant system work at the time?
4. What evidence supported that understanding?
5. What did we think was causing the problem?
6. What implementation changed?
7. Who or what produced that implementation?
8. How was the result verified?
9. What did we learn?
10. What do we still not know?

---

## 3. Product Principle: Ownership ≠ Manual Coding

Chatdex must treat automation and ownership as independent dimensions.

A developer can manually write code they poorly understand.

A developer can also use an agent to produce code while maintaining strong understanding of its intent, architecture, behavior, risks, and verification.

Therefore Chatdex must not measure ownership using:

* percentage of manually written LOC,
* number of AI prompts,
* amount of generated code,
* whether an agent was used,
* or an arbitrary AI-vs-human score.

Instead, ownership is represented through available evidence of understanding.

Examples include:

* behavior inspected,
* code inspected,
* execution relationships verified,
* hypotheses recorded,
* predictions made,
* tests executed,
* runtime behavior observed,
* decisions reviewed,
* changes explained,
* unresolved questions explicitly recorded.

Chatdex should expose this evidence without claiming to know what is inside a developer's head.

---

## 4. Core Object: Change Workspace

Prepare Change gains a persistent Change Workspace.

A Change Workspace represents one attempt to understand and modify system behavior.

It can originate from:

* a question,
* bug,
* requirement,
* desired behavior,
* Current Understanding node,
* investigation,
* conversation,
* issue,
* commit,
* or manually entered intention.

Example:

> Change: Search results should navigate directly to the matching message.

The workspace persists the investigation, reasoning, implementation, and verification surrounding that change.

---

## 5. Change Workspace Structure

### 5.1 Intent

The developer records:

**Current behavior** — What happens now?

Example:

> Clicking a global search result opens the correct conversation but does not reliably scroll to the matching message.

**Desired behavior** — What should happen?

Example:

> Clicking a search result should open its conversation, scroll the matching message into view, and highlight it.

**Why it matters** — The user or system outcome motivating the change.

Example:

> Search is only useful as navigation if the result can take the user to the information they found.

### 5.2 Acceptance Criteria

The developer records observable conditions that would establish success.

Example:

* Clicking a result opens the correct conversation.
* The matching message enters the viewport.
* The matching message is highlighted.
* Direct conversation navigation continues working.
* Navigation works after a cold page load.

Chatdex may help clarify criteria but must distinguish desired behavior from implementation assumptions.

For example:

**Acceptance criterion** — Matching message enters the viewport.

**Implementation hypothesis** — ConversationView should perform the scroll.

The latter must not silently become a requirement.

---

## 6. Investigation

The Change Workspace provides tools for gathering evidence about the relevant system.

Initial investigation actions may include:

* search repository,
* find symbol,
* find references,
* inspect imports,
* inspect callers/callees,
* inspect tests,
* inspect Git history,
* inspect previous changes,
* search imported conversations,
* search specifications,
* search Current Understanding,
* run application,
* run test,
* inspect runtime output.

Chatdex should prefer mechanically established information where possible.

AI interpretation is permitted but must remain distinguishable from source evidence.

---

## 7. Evidence Model

Every important claim about the system can carry provenance.

Initial evidence types:

**Observed in code** — Directly supported by repository contents.

**Observed at runtime** — Established through running the software.

**Supported by test** — Established or partially established by a test.

**Supported by history** — Supported by commits, diffs, issues, or historical development records.

**Supported by intent source** — Supported by a specification, requirement, conversation, or decision record.

**Human hypothesis** — A developer's current interpretation or prediction.

**AI inference** — An AI-generated interpretation not yet independently established.

A claim may have multiple evidence sources.

Example:

> ConversationView performs message scrolling after navigation.

Evidence:

* ConversationView.tsx:184–211 — Observed in code
* search-navigation.spec.ts — Supported by test
* Change Workspace #142 — previously verified
* Claude investigation — AI inference

The interface must make these distinctions visible.

---

## 8. Understanding Trace

Developers can construct a trace representing their current understanding of a behavior.

Example:

```
SearchResult
↓
handleResultClick
↓
router.push
↓
ConversationPage
↓
ConversationView
↓
scrollToMessage
```

Trace nodes may represent:

* behavior,
* UI component,
* function,
* route,
* API endpoint,
* service,
* database operation,
* event,
* state transition,
* external dependency,
* test,
* or another relevant system entity.

Trace edges represent claimed relationships.

Each edge can have evidence and verification state.

Example:

> handleResultClick → router.push — Verified in code
>
> router.push → ConversationView receives targetMessageId — Human hypothesis

Chatdex should allow incomplete traces.

Unknowns are first-class:

> router.push → ???

An incomplete trace is preferable to an automatically completed but poorly supported one.

---

## 9. Investigation Assistance Modes

The developer chooses how much assistance Chatdex provides during an investigation.

### Manual / Guided

Goal: *I want to build the understanding myself.*

Chatdex may:

* search,
* expose source evidence,
* answer targeted questions,
* verify proposed relationships,
* provide API/syntax explanations,
* execute requested tests,
* preserve findings.

Chatdex should avoid automatically revealing complete execution paths, root causes, or implementations unless requested.

### Collaborative

Goal: *Help me reason through this.*

Chatdex may additionally:

* suggest relevant files,
* propose possible relationships,
* suggest hypotheses,
* explain unfamiliar code,
* propose investigation steps,
* challenge the developer's current model.

AI-generated claims retain AI inference provenance until established through stronger evidence.

### Agentic

Goal: *Investigate this as far as possible.*

Chatdex or an integrated coding agent may:

* perform repository reconnaissance,
* construct proposed traces,
* identify likely root causes,
* propose implementation plans,
* implement changes where authorized,
* run verification.

The resulting reasoning must be captured as inspectable claims rather than disappearing inside the agent transcript.

The developer can later inspect or verify any portion of the agent's understanding.

---

## 10. Progressive Disclosure

Manual/Guided mode should support deliberate information boundaries.

Example — developer asks:

> Find references to handleResultClick.

Chatdex returns references.

It should not automatically add:

> The root cause is that targetMessageId is lost during route serialization and here is the patch.

The developer controls when additional interpretation is revealed.

Possible actions:

* Show references
* Explain this function
* Verify my interpretation
* Show callers
* Show callees
* Give me a hint
* Propose hypotheses
* Show likely execution path
* Show likely root cause

This allows Chatdex to support learning and ownership without artificially withholding information when the developer actually wants assistance.

---

## 11. Prediction

During manual or collaborative investigation, Chatdex can ask the developer to predict behavior before revealing additional evidence.

Example:

> After router.push() succeeds, where do you expect the target message identifier to be consumed?

The developer records a prediction.

Later evidence can mark it:

* supported,
* contradicted,
* partially supported,
* unresolved.

Predictions become part of the investigation history.

They are intended to promote active comprehension rather than passive reading.

---

## 12. Change Hypothesis

Before implementation, the workspace supports a structured hypothesis.

Template:

> I think ______ happens because ______.
>
> The evidence supporting this is ______.
>
> I expect changing ______ to cause ______.

Example:

> I think search navigation reaches the correct conversation but loses the target message because only the conversation ID survives route navigation.
>
> I observed handleResultClick receiving both IDs but only found the conversation ID in the destination route.
>
> I expect preserving the message ID through navigation to allow ConversationView to perform its existing scroll behavior.

The hypothesis is timestamped before implementation.

It must remain visible after the change so the developer can compare their expectation with what actually happened.

---

## 13. Implementation

Chatdex records implementation provenance.

Possible sources:

* human,
* AI agent,
* human + AI,
* unknown/imported.

Manual mode can optionally prevent implementation generation until explicitly unlocked.

Collaborative mode may provide implementation assistance.

Agentic mode may permit autonomous implementation.

Chatdex must not equate implementation provenance with correctness or ownership.

The resulting diff is attached to the Change Workspace.

---

## 14. Verification

Verification compares the resulting system against:

* desired behavior,
* acceptance criteria,
* change hypothesis,
* affected understanding,
* tests,
* runtime observations.

The verification interface should prioritize evidence rather than an AI-generated pass/fail judgment.

Example:

**Criterion** — Matching message enters viewport

Evidence:

* search-navigation.spec.ts passes
* manually observed in Chrome

Status: Supported

**Criterion** — Works after cold page load

Evidence: None.

Status: Unverified

AI review may identify possible problems, but those findings are represented as AI claims requiring appropriate evidence.

---

## 15. Explain the Change

After verification, Chatdex asks:

> What do you now understand that you did not understand before this change?

The developer can write their own explanation.

Example:

> Search navigation carries conversation identity through the route. Message scrolling belongs to ConversationView, which waits until messages have rendered before locating the target element.

Chatdex may then challenge the explanation:

> Where did you verify that ConversationView waits for message rendering?

or:

> Your trace currently does not contain evidence for this relationship.

AI may help edit the explanation, but the original human explanation should remain distinguishable if preservation of authorship is desired.

---

## 16. Promote to Current Understanding

Verified findings from a Change Workspace can be promoted into Current Understanding.

Promotion is deliberate.

Chatdex should not automatically treat every AI conclusion as project truth.

Candidate promotion:

> **Search-result navigation**
>
> Global search passes conversation and target-message identity into conversation navigation. ConversationView owns locating and scrolling the target message after messages render.

Supporting evidence:

* source locations,
* tests,
* runtime verification,
* Change Workspace,
* relevant commit.

Current Understanding therefore becomes an accumulated model of established project knowledge rather than simply an AI-generated repository summary.

---

## 17. Understanding History

Chatdex preserves how understanding itself changes.

A developer viewing a subsystem may see:

> **Search navigation**
>
> Previously investigated: 4 times
>
> Personally inspected:
> * GlobalSearch.tsx
> * ConversationView.tsx
> * navigation route
>
> Previously verified:
> * 7 code relationships
> * 3 runtime behaviors
>
> AI-inferred but not independently verified:
> * 2 relationships
>
> Open questions:
> * mobile navigation restoration
> * deleted-message targets
>
> Last meaningful investigation:
> * Change Workspace #142

This allows developers to return to a subsystem without restarting comprehension from zero.

---

## 18. Investigate History Integration

Every completed Change Workspace becomes part of Investigate History.

History can reconstruct:

Intent at the time ↓ Evidence available ↓ Developer/agent hypothesis ↓ Implementation ↓ Verification ↓ Resulting understanding

This enables questions such as:

* Why does this code exist?
* When did this behavior change?
* What assumption led to this implementation?
* Was this code human- or agent-generated?
* What did the developer believe before making this change?
* Which acceptance criteria were never verified?
* When did our current understanding of this subsystem change?

---

## 19. Agentic Workflow Support

Chatdex must remain highly useful to developers who want maximum AI automation.

An agentic change might produce:

> **Goal** — Fix search-result navigation.
>
> **Agent investigation** — 14 files inspected.
>
> **Proposed root cause** — Target message identity is lost during navigation.
>
> **Implementation** — 4 files changed / +71 −19.
>
> **Affected behaviors** — Search navigation; Conversation restoration
>
> **Verification** — 8 tests passed.
>
> **New assumptions** — ConversationView owns post-navigation scrolling.
>
> **Unverified** — Mobile restoration behavior.

The developer does not need to manually reconstruct the investigation.

However, Chatdex preserves a path back into it.

The developer can select:

> Understand this change

and enter the same evidence/trace interface used by manual developers.

Thus high automation does not destroy future inspectability.

---

## 20. Ownership Recovery

Any existing behavior or historical change can enter an Understand / Reclaim workflow.

Use case:

> This subsystem was mostly agent-generated six months ago and I no longer understand it.

The developer selects a behavior and works through:

1. Locate behavior.
2. Inspect relevant evidence.
3. Construct or inspect its execution trace.
4. Review historical intent.
5. Identify unknown relationships.
6. Predict behavior.
7. Run relevant tests/runtime experiments.
8. Modify code if desired.
9. Explain the resulting understanding.
10. Promote established knowledge into Current Understanding.

This allows Chatdex to help developers regain familiarity with code regardless of how it was originally created.

---

## 21. Questions as First-Class Objects

Unknowns discovered during any workflow become Questions.

Examples:

> Why does ConversationView own scrolling instead of the route?
>
> What happens if the target message has been deleted?
>
> Does search navigation restoration work on mobile?

Questions can:

* remain attached to a Change Workspace,
* appear in Current Understanding,
* seed future investigations,
* become Prepare Change workspaces,
* or be resolved by later evidence.

Chatdex therefore preserves uncertainty rather than forcing every investigation into a falsely complete model.

---

## 22. MVP

The first implementation should not attempt the entire system.

Add one persistent Change Workspace inside Prepare Change containing:

**Intent** — Current behavior · Desired behavior · Why it matters

**Evidence** — Repo search · Symbol/reference search · relevant existing Chatdex knowledge

**My Trace** — A manually editable sequence/graph with evidence attached to nodes and edges.

**My Hypothesis** — Developer-written explanation of the suspected cause.

**Acceptance Criteria** — Observable success conditions.

**Implementation** — Current Git diff and implementation provenance.

**Verification** — Criteria mapped to tests/runtime/manual evidence.

**What I Learned** — Developer explanation after implementation.

**Promote** — Explicit promotion of selected findings into Current Understanding.

---

## 23. MVP Assistance Modes

Support two modes initially:

**Guided** — Chatdex does not proactively reveal root cause or implementation. The developer requests progressively deeper assistance.

**Assisted** — Chatdex may perform reconnaissance, suggest hypotheses, and explain relevant code.

Do not initially build autonomous agent execution into Chatdex.

Instead, allow externally produced AI changes and conversations to be attached to the workspace.

This tests the ownership model without requiring Chatdex to become another coding agent.

---

## 24. MVP Evidence Types

Start with only:

* Code
* Test/runtime
* Intent/history
* Human hypothesis
* AI inference

More granular provenance can be introduced after observing real use.

---

## 25. Non-Goals for MVP

Do not initially build:

* an IDE replacement,
* autonomous coding agent,
* full static-analysis platform,
* universal runtime tracing,
* automatic comprehension scores,
* developer productivity scoring,
* LOC-based AI attribution,
* mandatory educational exercises,
* automatic promotion of AI conclusions into Current Understanding.

Chatdex should integrate with existing coding environments rather than require implementation to happen inside Chatdex.

---

## 26. Success Criteria

The MVP succeeds if it enables a developer to take one real change in Chatdex and:

1. state the desired behavior,
2. find relevant code,
3. construct an evidence-backed understanding of the behavior,
4. record a hypothesis,
5. make or receive a change,
6. verify it against explicit criteria,
7. explain what was learned,
8. preserve useful findings,
9. and later reconstruct why the change was made and how the system was understood.

It should work for both:

**Human-led example** — I want to investigate and implement this bug myself without Chatdex solving it for me.

and:

**AI-led example** — Claude Code implemented this feature. Help me understand what it did, determine whether I trust it, and preserve the important knowledge so we don't have to rediscover it later.

If both workflows produce useful additions to the same Current Understanding and Investigate History systems, the underlying model is working.

---

## 27. Central Design Test

For every proposed Chatdex feature, ask:

> Does this increase the developer's ability to understand, verify, recover, or deliberately delegate control over their software?

If the feature merely causes AI to do more work without improving those capabilities, it is not part of the Code Ownership & Understanding Loop.

If the feature artificially prevents useful automation without increasing ownership, it is also not part of the loop.

The target is not maximum human effort or maximum AI automation.

The target is:

> High-leverage software development without losing the path back to human understanding.
