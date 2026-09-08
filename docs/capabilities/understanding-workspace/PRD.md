# Chatdex — Shared Understanding Workspace PRD

Status: Exploratory / staged implementation
Date: 2026-08-08

## 1. Product thesis

Chatdex should help maintain a continuously updated, inspectable model of what I currently understand about myself, my projects, and the work happening within those projects.

A large amount of this understanding is currently distributed across:

* Claude.ai conversations
* ChatGPT conversations
* Claude Code sessions
* Codex sessions/traces
* eventually other notes, documents, codebases, and artifacts

These sources contain decisions, ideas, questions, specifications, rejected directions, implementation discoveries, creative material, assumptions, and evolving project definitions.

Today, the burden is on me to remember where something was discussed, find the relevant conversation, determine whether it still represents my current thinking, manually update documents, and then give the resulting context to another AI system.

Chatdex should progressively eliminate that work.

The long-term loop is:

```
AI conversations + agent work + artifacts
                    ↓
             source ingestion
                    ↓
        understanding reconciliation
                    ↓
          CURRENT UNDERSTANDING
                    ↓
       ┌────────────┼────────────┐
       ↓            ↓            ↓
   visualization  living docs   AI context
       │            │            │
       └────────────┼────────────┘
                    ↓
               new work
                    ↓
             new evidence
                    ↺
```

The central object is therefore not a conversation or document.

It is the current understanding reconstructed from many sources while preserving their history and provenance.

---

## 2. Core product question

The initial product should help answer:

> Given all of the relevant conversations and agent sessions I have accumulated, what does Chatdex think I currently understand about my projects, and can I trust and use that reconstruction to continue working?

This should be tested before committing to a highly specific final ontology or workspace design.

---

## 3. Existing functionality to preserve

Do not remove or replace the existing Claude ingestion system.

Chatdex already supports importing/analyzing Claude Code JSONL/session traces and has existing Claude-related ingestion functionality.

Preserve this.

Existing observability/detector functionality should remain operational, but this PRD does not require the new understanding system to be designed around the detector architecture.

Treat existing Chatdex functionality as one subsystem of a larger product.

---

## 4. Multi-source ingestion

Extend the existing source-ingestion concept so Chatdex can progressively ingest:

Existing

* Claude Code
* Claude.ai conversation history

Add

* ChatGPT conversation history
* Codex traces/sessions

The goal is to normalize these into a common source model while preserving provider-specific information when useful.

Conceptually:

```
Claude.ai ─────┐
ChatGPT ───────┤
Claude Code ───┼──→ normalized source layer
Codex ─────────┘
```

Do not force every source into an identical representation if doing so destroys useful information.

At minimum preserve:

* provider
* source type
* conversation/session ID
* timestamp
* messages/events
* participant/model identity when available
* source ordering
* original provenance
* project association when known or inferred
* raw source reference sufficient for later inspection

Existing privacy and local-first guarantees must continue to apply.

---

## 5. Historical import before perfect live synchronization

Do not block this experiment on perfect realtime synchronization with ChatGPT, Claude, Codex, or Claude Code.

Historical/import-based ingestion is sufficient for the first stages.

The architecture should nevertheless distinguish:

```
SOURCE
What actually happened.
INGESTION
How Chatdex learned about it.
UNDERSTANDING
What Chatdex currently infers from it.
```

This separation should allow better automatic synchronization mechanisms to be added later without changing the underlying understanding model.

---

## 6. Project discovery and association

Chatdex should begin reconstructing projects from conversations rather than requiring every imported conversation to be manually organized first.

For an initial version, AI may propose project associations.

Example:

```
Conversation 819
Likely projects:
Chatdex        0.94
Floviate       0.21
Reason:
Conversation primarily discusses living documents,
shared AI memory, and knowledge reconciliation.
```

A conversation may relate to:

* one project
* multiple projects
* the user generally
* no known project

Do not require mutually exclusive folders.

Users must eventually be able to correct associations.

---

## 7. Current Understanding

Introduce Current Understanding as a first-class Chatdex concept and visible workspace panel.

This is one of the primary requirements of this PRD.

Chatdex should synthesize imported sources into an evolving representation of what currently appears to be true, important, unresolved, or active.

The initial ontology should remain deliberately flexible.

Potential understanding objects include:

* project
* concept
* observation
* idea
* decision
* hypothesis
* assumption
* question
* contradiction/tension
* requirement
* specification
* goal
* experiment
* implementation fact
* artifact
* theme/motif
* relationship

Do NOT assume this exact list is final.

Avoid prematurely constructing an elaborate universal ontology.

The purpose of the early implementation is partly to discover what structure is actually useful.

---

## 8. Understanding must be temporal

Chatdex must not treat extracted statements as timeless facts.

For example:

```
March:
Chatdex is primarily a conversation analyzer.
June:
Chatdex becomes an agent-observability system.
August:
Chatdex is being explored as shared,
version-controlled project understanding.
```

The current representation should be capable of saying:

> This appears to be the current direction.

while retaining:

> These were previous directions.

Understanding objects therefore need enough history to represent relationships such as:

* introduced
* supported
* refined
* superseded
* contradicted
* reopened
* resolved

Do not flatten the entire conversation corpus into one summary.

---

## 9. Provenance is mandatory

Every meaningful synthesized understanding should remain traceable to its source evidence.

For example:

```
Chatdex should maintain shared project understanding.
Current status:
Strong current direction
Derived from:
- ChatGPT conversation C182
- ChatGPT conversation C193
- Claude conversation C81
Refined by:
- ChatGPT C201
Related implementation:
- unknown/not yet linked
```

The user should eventually be able to navigate:

```
Current understanding
        ↓
understanding object
        ↓
evidence
        ↓
conversation
        ↓
exact relevant messages
```

The AI-generated synthesis must never erase the underlying source.

---

## 10. Understanding reconciliation

When new sources are ingested, do not merely summarize them independently.

Compare new evidence against existing understanding.

Conceptually:

```
Current understanding Kn
           +
new source evidence
           ↓
     reconciliation
           ↓
proposed understanding changes
           ↓
        Kn+1
```

Possible changes include:

* new understanding
* support existing understanding
* refine existing understanding
* supersede previous understanding
* contradict existing understanding
* resolve an open question
* reopen something previously resolved
* associate existing understanding with another project

The exact operation schema may evolve.

---

## 11. Human review

Do not assume all AI interpretations should automatically become canonical.

However, do not design a workflow that requires the user to manually extract knowledge from conversations.

The AI does the extraction and reconciliation.

Human effort should focus on judgment.

Possible states:

```
AI inferred
    ↓
pending
    ↓
accepted / edited / rejected
```

Explore ways to make review extremely fast.

High-volume review UX may eventually include:

* Accept
* Reject
* Edit
* Merge
* Supersede
* Mark uncertain
* Accept all low-risk changes

Do not require the complete review system in the first stage.

---

## 12. Current Understanding workspace panel

Create a visible Current Understanding panel/surface relatively early in implementation.

I want to be able to see the system beginning to reconstruct my world even while the underlying model is still primitive.

An early version might show:

```
CURRENT UNDERSTANDING
Me
│
├── Projects
│
│   ├── Chatdex
│   │    ├ current direction
│   │    ├ concepts
│   │    ├ decisions
│   │    ├ questions
│   │    └ recent changes
│   │
│   ├── Project B
│   └── Project C
│
├── Cross-project concepts
│
├── Open questions
│
└── Recent changes
```

Do not treat this exact tree as the final information architecture.

It is a starting visualization.

---

## 13. Graph exploration

Explore a graph representation of understanding.

Potential nodes:

```
Me
Project
Concept
Decision
Question
Artifact
Conversation
Codebase
```

Potential edges:

```
belongs to
derived from
affects
supports
contradicts
supersedes
implemented by
related to
```

The graph should help answer questions such as:

* What projects am I currently working on?
* What are the major concepts within Chatdex?
* Where did this idea originate?
* What changed recently?
* Which questions remain unresolved?
* Which ideas recur across projects?
* What evidence supports this current direction?

Do not build a giant force-directed visualization merely because the data is graph-shaped.

The visualization must help navigation.

A tree, outline, document, graph, timeline, or combination may prove superior.

---

## 14. Living understanding document

In addition to visualization, generate a readable projection of current understanding.

For example:

```
# Chatdex — Current Understanding
## Current Direction
...
## Major Product Ideas
...
## Current Architecture
...
## Decisions
...
## Open Questions
...
## Recent Changes
...
```

This document is generated from underlying understanding.

It is not manually maintained canonical truth.

It should eventually be possible to generate different projections from the same underlying state.

Examples:

* project overview
* product specification
* architecture document
* story bible
* agent context
* current-state briefing

Do not build all of these yet.

---

## 15. Workspace

Begin treating Chatdex as a workspace rather than only an analyzer.

The final workspace layout is intentionally unresolved.

Possible surfaces include:

* Current Understanding
* AI Chat
* Living Documents
* Source Conversations
* Graph/Map
* Timeline/History
* Code
* Running Application
* Agent Activity
* Pending Changes
* Search

Explore the architecture so these can eventually coexist without hard-coding one permanent three-column layout.

A possible early layout:

```
┌──────────────────┬──────────────────────────────┐
│                  │                              │
│ Current          │        Active Surface        │
│ Understanding    │                              │
│                  │  Chat / Document / Source    │
│ Projects         │  / Graph / etc.              │
│ Concepts         │                              │
│ Questions        │                              │
│ Recent Changes   │                              │
│                  │                              │
└──────────────────┴──────────────────────────────┘
```

The Current Understanding panel should be persistent or easily accessible so we can test whether having the project's current reconstructed state visible changes how it feels to work with AI.

---

## 16. Native AI chat inside Chatdex

Chatdex should eventually support first-class conversations with multiple AI systems from inside the workspace.

Initial targets:

* OpenAI / ChatGPT-related models and agents
* Claude

Investigate and use the appropriate supported SDKs/headless agent interfaces.

For this personal-use prototype, I would like to investigate using my existing personal provider subscriptions/authentication where officially supported by the relevant SDK/tool.

Do NOT assume that consumer-subscription authentication is supported universally.

During implementation:

1. inspect the current official OpenAI/Codex SDK authentication options;
2. inspect the current official Claude/Claude Code/Agent SDK authentication options;
3. document which authentication modes are officially supported for this local personal-use application;
4. implement only supported authentication paths;
5. keep provider authentication behind an abstraction so the strategy can change later.

Possible modes may include:

* supported consumer-account authentication
* API key
* Chatdex-managed credentials in the future

Do not hard-code the product around one billing/authentication model yet.

---

## 17. Chat should consume Current Understanding

A Chatdex-native AI conversation should not begin as an isolated blank thread.

Chatdex should be able to construct relevant context from Current Understanding.

Conceptually:

```
User message
      +
relevant current understanding
      +
relevant source evidence if needed
      ↓
model
```

Do not blindly inject the entire understanding graph.

The long-term goal is context selection/navigation.

For the first implementation, a simpler project-level context representation is acceptable.

---

## 18. Chat should feed understanding back

A Chatdex-native conversation should also be a source.

After meaningful discussion:

```
Chatdex chat
     ↓
reconciliation
     ↓
proposed understanding changes
     ↓
Current Understanding
```

This creates the first closed loop.

The user should not have to manually copy the conversation into the understanding system.

---

## 19. Software-development direction

Do not fully implement this yet, but preserve this intended workflow:

```
Chats
  ↓
Current project understanding
  ↓
Living product/design/specification views
  ↓
Build instructions
  ↓
Coding agent
  ↓
Code + running application
  ↓
Implementation evidence
  ↓
Updated understanding
```

A major future experiment is:

> Does keeping project understanding and design/specification views fresh across AI conversations reduce reorientation time, stale-context errors, and manual documentation work during software development?

Chatdex should eventually allow the user to work with:

* chat
* current understanding
* code
* running application

as connected representations of the same evolving project.

---

## 20. Fiction direction

Also preserve the possibility that the same underlying system supports fiction.

Conceptually:

```
Chats
  ↓
story understanding
  ↓
manuscript + story map/bible
  ↓
proposed changes
  ↓
accepted manuscript
  ↓
updated understanding
```

For a large novel, Chatdex may maintain higher-level abstractions such as:

* novel overview
* acts
* chapters
* characters
* relationships
* timeline
* established facts
* themes/motifs
* unresolved setups
* contradictions

These should ideally be derived from the underlying work rather than requiring separate manual maintenance.

Do not implement the fiction-specific ontology yet.

---

## 21. Staged implementation

Do NOT attempt this PRD in one implementation session.

Before coding, inspect the existing repo and produce a proposed phased implementation plan.

Optimize the phases for early experiential testing, not merely architectural dependency order.

A reasonable direction to evaluate is:

### Stage U0 — Unified source layer

Preserve existing Claude/Claude Code ingestion and introduce a common representation capable of supporting:

* Claude.ai
* Claude Code
* ChatGPT
* Codex

Implement the smallest additional importer needed to get real ChatGPT data into Chatdex.

Success:

> I can browse/search conversations from Claude and ChatGPT inside the same system with clear provenance.

---

### Stage U1 — Project reconstruction

Run an initial AI analysis over imported conversations to:

* identify likely projects
* associate conversations with projects
* extract a deliberately small set of candidate understanding objects
* preserve provenance

Success:

> Chatdex can reconstruct recognizable projects from real conversation history without me manually categorizing every conversation.

---

### Stage U2 — Current Understanding

Add the first Current Understanding panel.

For a selected project, show at minimum:

* concise current direction
* important current ideas/decisions
* unresolved questions
* recent changes
* source provenance

Success:

> When I open Chatdex and select a project, the Current Understanding view is recognizably representative of where my thinking currently is.

This is an important experiential milestone.

---

### Stage U3 — Temporal reconciliation

Process conversations chronologically against existing understanding rather than independently summarizing them.

Begin representing:

* additions
* refinements
* supersessions
* contradictions
* resolutions

Success:

> Chatdex can distinguish an old project direction from a newer one rather than presenting both as simultaneously current.

---

### Stage U4 — Understanding navigation

Explore better representations of Current Understanding:

* hierarchical outline
* graph
* generated current-understanding document
* provenance navigation
* recent-change timeline

Do not assume graph visualization is automatically best.

Success:

> I can navigate from a high-level understanding of a project to the relevant concept and then back to the source conversations without manually searching chat history.

---

### Stage U5 — Chatdex-native AI chat

Add an AI chat surface using supported OpenAI and/or Claude SDK/headless interfaces.

Investigate authentication before implementation.

Chat should be able to receive selected current project context automatically.

Success:

> I can discuss a project inside Chatdex without manually explaining its current state to the model.

---

### Stage U6 — Closed-loop reconciliation

Treat Chatdex-native chats as new sources and automatically propose updates to Current Understanding.

Success:

> I can have a meaningful project conversation and see Chatdex update/propose updates to its representation of the project without manually extracting what mattered.

---

### Later stages

Only after learning from U0–U6, consider:

* living specification generation
* tracked changes
* coding-agent handoffs
* build instruction generation
* implementation receipts
* code ↔ understanding links
* running-app integration
* fiction-specific story views
* multiple model collaboration
* automated external-source synchronization
* branches/merges
* richer knowledge version control

---

## 22. Important design principle: AI does the clerical work

Chatdex must not require me to become the librarian for my own conversations.

Bad workflow:

```
Read old conversation
↓
identify important idea myself
↓
categorize it
↓
copy it into Chatdex
↓
manually update project document
```

Desired workflow:

```
Chatdex ingests source
↓
AI identifies/reconciles understanding
↓
Chatdex presents useful current state
↓
I correct the AI when necessary
```

Human attention should be spent primarily on judgment, creation, and correction—not transcription and synchronization.

---

## 23. Important design principle: current state + history

Chatdex should provide both:

**HEAD**

> What do I currently think this project is?

and:

**HISTORY**

> How did I arrive here?

Normal usage should emphasize HEAD.

History should remain available for provenance, debugging understanding, revisiting abandoned ideas, and examining evolution.

---

## 24. Important design principle: uncertainty is allowed

Do not force every conflicting conversation into one clean answer.

Chatdex must eventually be capable of representing:

> We currently appear to lean toward A.

while also retaining:

> B remains plausible and unresolved.

Contradiction, uncertainty, and incomplete decisions are legitimate states.

---

## 25. Initial product success criteria

This experiment is succeeding if, after importing a meaningful portion of my actual Claude and ChatGPT history:

1. Chatdex discovers projects and themes that I recognize.
2. Opening a project gives me a useful representation of what I currently think about it.
3. Old/superseded ideas are not routinely presented as current.
4. Important claims can be traced back to the conversations that produced them.
5. I need to manually search old AI conversations substantially less often.
6. I can return to a project after time away and orient myself substantially faster.
7. The Current Understanding panel feels useful enough that I want it visible while chatting or working.
8. New conversations can eventually update that understanding with minimal clerical work from me.
9. The system begins to reveal what additional workspace surfaces—documents, graphs, code, running apps, timelines, pending changes, etc.—would actually improve the workflow.

The objective of these stages is not to prove the final Chatdex architecture.

It is to build enough of the conversation corpus → evolving understanding → workspace loop that we can use Chatdex itself to discover what Chatdex should become.

## 26. Immediate next action

Before implementing Stage U0, inspect the existing repository and report:

1. the current Claude.ai and Claude Code ingestion architecture;
2. where a provider-neutral source abstraction could fit with minimal disruption;
3. what is required to ingest ChatGPT conversation history;
4. what is required to ingest Codex traces;
5. which existing storage/encryption/search systems can be reused;
6. a proposed U0–U2 implementation plan broken into small testable phases;
7. any assumptions in this PRD that conflict with the actual codebase.

Do not begin a large refactor until this assessment is complete.
