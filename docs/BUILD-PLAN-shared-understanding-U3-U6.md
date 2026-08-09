# Shared Understanding Workspace — Build Plan for U3–U6

Companion to `PRD-shared-understanding-workspace.md` (stages),
`ASSESSMENT-shared-understanding-U0.md` (which planned U0–U2 and stopped
there), and `UNDERSTANDING-BUILD-LOG.md` (what was actually built). This doc
plans the **remainder**: U3.2 through U6, plus the cross-cutting backlog.

Same cadence as U0–U2: **one phase per session**, each phase small, testable,
and independently committable. Engine before UI within each stage (the U1
pattern). Every phase updates the build log when done.

## Where things stand (2026-08-09)

| Done | Commit | What |
|---|---|---|
| U0.1–U0.3 | `0e66dcb`…`b693caa` | Provider-neutral source layer, ChatGPT parser (Codex parser deferred) |
| U1.1–U1.3 | `72edaf6`…`cf9844b` | Understanding schema, discovery engine, Projects review UI |
| Subscription bridge | `856bd77` | Synthesis billed to Claude/ChatGPT subscriptions; both paths live-verified |
| U2.1–U2.2 + object review | `be2a55d`, `ef246ef`, `7cb3131` | Current Understanding panel, object accept/reject, message-level provenance |
| U3.1 | `c5aeaa1` | Event review gate: AI events pending until accepted |

Standing constraints that apply to every phase below:

- **Invariant 6 (CLAUDE.md):** synthesis is opt-in, provider calls disclosed
  (cross-provider explicitly), backend relay transit-only. Detection stays
  client-side; none of this work touches it.
- **Everything AI-proposed lands `pending`** — objects, associations, events.
  Human judgment is the gate (PRD §11, §22).
- **Provenance or it doesn't ship** (PRD §9): AI proposals without evidence
  are rejected at the persistence layer; hallucination guards validate every
  cited conversation id and message index against what was actually sent.
- **Cost awareness:** prefer the Anthropic subscription path for large runs
  (Codex adds ~14k tokens/call harness overhead); batch sizes configurable.

---

## Stage U3 — Temporal reconciliation (PRD §8, §10)

PRD success: *"Chatdex can distinguish an old project direction from a newer
one rather than presenting both as simultaneously current."*

### U3.1 — Event review gate ✅ (`c5aeaa1`)

Done. `UnderstandingEvent` carries `origin`/`reviewState`; AI events apply
their status effect only on acceptance.

### U3.2 — Reconciliation engine

`src/lib/understanding/reconcile.ts`, engine-only (no UI), mirroring how
U1.2 preceded U1.3.

- **Input:** one project; its current understanding objects (accepted +
  pending, with ids, type, title, body, status); a **chronological** batch of
  its associated conversations as message-granular digests (reuse
  `buildDigest`).
- **Model contract:** propose ops against the presented state —
  `introduce` (new object) / `support` / `refine` / `supersede` /
  `contradict` / `resolve` / `reopen` (existing object by id) — each with
  `detail` and evidence (`conversationId` + `messageIndexes`). Introduced
  objects get a response-local ref (`"n1"`) so a `supersede` in the same
  response can name its replacement (`supersededByObjectId` after ref
  resolution).
- **Guards (all tested):** op must be in the whitelist; target object id must
  be in the presented set; refs must resolve; evidence validated exactly like
  discovery (unknown conversation/message citations dropped with warnings);
  an op with no valid evidence is dropped entirely.
- **Persistence:** `introduce` → `createUnderstandingObject` (pending);
  everything else → `recordUnderstandingEvent` with origin `'ai'` → pending,
  so nothing changes status until reviewed (U3.1's gate).
- **Incremental processing:** add `lastReconciledAt?: Date` to
  `UnderstandingProject` (serializer spreads rows, so it syncs without
  migration). A re-run processes only conversations updated since then;
  stamped per successful run.
- **Open decision for this phase:** whether reconciliation replaces the
  object-extraction half of discovery (discovery keeps finding
  projects/associations; reconciliation becomes the only object writer) or
  they coexist. Leaning: coexist until U3.3 is usable, then revisit.

Acceptance: golden-fixture test where an old direction + a newer contradicting
conversation yields a pending `superseded` event on the old object and a
pending replacement object, correctly linked, with message-level evidence.

### U3.3 — Reconciliation UI

- Per-project **"Update understanding"** trigger on the panel (disclosure
  modal, chronological batching, progress — reuse the U1.3 run pattern).
- **Pending changes strip** on the panel: proposed events rendered as
  reviewable rows (op, target object, detail, evidence links) with
  accept/reject wired to `setEventReviewState`. This is also where PRD §11's
  "review must be fast" starts getting real: keyboard-friendly, one decision
  per row.
- Recent-changes rows show a `pending` badge; superseded objects link to
  their replacement (`supersededByObjectId` navigation).

Acceptance: the U3 PRD success criterion, exercised live on real data — run
reconciliation over a project with a known direction change; the old
direction shows as superseded after accepting, never alongside the new one.

---

## Stage U4 — Understanding navigation (PRD §12, §13, §14, §23)

PRD success: *"I can navigate from a high-level understanding of a project to
the relevant concept and back to the source conversations without manually
searching chat history."*

PRD §13 explicitly warns against building a graph visualization by default.
Plan: outline + document + history first; graph only as a later spike if
navigation still feels lacking.

### U4.1 — Understanding overview (the §12 tree, minus the tree dogma)

A home surface for understanding across projects: projects with object
counts/recency, cross-project (unassigned) items, open questions rollup,
global recent changes. Effectively a smarter `/projects` — likely an
evolution of that page rather than a new route. Pure assembly over existing
queries; no LLM calls.

### U4.2 — Living understanding document (PRD §14)

Generated markdown projection per project: Current Direction / Ideas /
Decisions / Open Questions / Recent Changes, each entry carrying provenance
footnotes. **Deterministic projection from understanding objects — no LLM
call needed** (the objects were already synthesized); an optional LLM-polish
pass can come later. Rendered in-app + exportable (existing exporters
pattern). This doubles as the "agent context" seed for U5.2.

### U4.3 — History drawer (PRD §23: HEAD vs HISTORY)

Per-object history: its full event stream (including rejected, labeled as
such — audit trail), replayable status timeline, supersession chain
navigation (old ↔ new direction). Entry point: click any object card.

### U4.4 (optional spike) — Graph/map

Only if U4.1–U4.3 leave real navigation questions unanswered (PRD §13 lists
them). Time-boxed spike, decision recorded in the build log either way.

---

## Stage U5 — Chatdex-native AI chat (PRD §16, §17)

PRD success: *"I can discuss a project inside Chatdex without manually
explaining its current state to the model."*

The §16 auth investigation is **already done and live-verified** (subscription
bridge, `856bd77`): Agent SDK on the Claude Code login, Codex SDK on the
ChatGPT login, API-key mode per provider, all behind the provider
abstraction. U5 builds the surface on top.

### U5.1 — Chat surface + storage

- New `/chat` surface (per-project entry from the panel): streaming
  conversation through the existing relay/subscription bridge.
- **Chats are sources** (PRD §18 groundwork): persist as conversations with a
  new `DataSource` `'chatdex'` — they immediately get browse/search/export
  and sync for free. Provider/model recorded in `providerMeta`.
- Relay needs a streaming completion path (current `/api/llm/complete` is
  request/response); transit-only rules unchanged.

### U5.2 — Context injection (PRD §17)

- Project context builder: compact representation of the selected project's
  current understanding (accepted objects first; the U4.2 document projection
  is the natural format). Injected as system context; **shown to the user**
  (what the model was told), with a size budget — not the whole graph.
- Disclosure covers it: sending understanding derived from provider A's
  history to provider B is the cross-provider case again.

### U5.3 — Chat UX

Provider/model picker, per-project chat history, regenerate/continue. Sized
by what actually hurts after using U5.1/U5.2 — deliberately underspecified
until then.

---

## Stage U6 — Closed-loop reconciliation (PRD §18)

PRD success: *"I can have a meaningful project conversation and see Chatdex
update/propose updates to its representation of the project without manually
extracting what mattered."*

### U6.1 — Chats feed reconciliation

`'chatdex'`-source conversations flow through the U3.2 engine: a finished
chat (user-triggered "reconcile this chat" first; auto-prompt after N
messages later) produces pending proposals reviewed in the U3.3 strip. The
loop closes: chat → reconciliation → Current Understanding → context for the
next chat (U5.2).

### U6.2 — Loop ergonomics

Whatever friction U6.1 reveals: auto-suggest reconciliation at chat end,
badge counts for pending changes, "accept all low-risk" (PRD §11) if review
volume becomes the bottleneck. Underspecified by design.

---

## Cross-cutting backlog (not stage-gated)

Ordered roughly by value; each is a candidate filler when a session has room
left, or when blocked on the main track.

1. **Codex session parser** (deferred from U0.3, now unblocked —
   `~/.codex/sessions` exists locally since the Codex CLI login). Completes
   the four-source ingestion story (PRD §4).
2. **Un-reject surface** for objects/events (gap logged in build log): undo
   toast or collapsed "Rejected" section.
3. **Object dedupe across runs:** discovery re-runs create duplicate objects
   (review absorbs them today). Reconciliation's present-state prompting
   (U3.2) should mostly obsolete this; verify, then close or fix.
4. **Edit as a review action** (PRD §11): accept-with-modification for
   objects and event details. `'edited'` exists in `ReviewState` but no UI
   produces it.
5. **`associate existing understanding with another project`** (PRD §10 op
   list): a projectId change, not an `UnderstandingOp` — needs its own small
   design (move vs. multi-project objects).
6. **Cost visibility:** token estimate in the disclosure modal; batch size in
   settings.
7. **Smoke tests pending on Jacob:** real ChatGPT export import; OpenAI-path
   discovery run.

## Explicitly out of scope (PRD "Later stages", §20)

Living specification generation, tracked changes, coding-agent handoffs,
implementation receipts, code↔understanding links, running-app integration,
fiction ontology, multi-model collaboration, automated source sync,
branches/merges. Revisit only after U6 works and PRD §25's success criteria
have been honestly evaluated against real usage.

## Sequencing summary

```
U3.2 engine → U3.3 UI          ← temporality: the core differentiator
→ U4.2 living doc → U4.1 overview → U4.3 history   ← cheap, high-value navigation
→ U5.1 chat → U5.2 context → (U5.3)               ← workspace becomes a place you work
→ U6.1 closed loop → (U6.2)                        ← the PRD's long-term loop, closed
(U4.4 graph spike only if navigation still hurts; backlog items as filler)
```

Rationale: U3 completes the thing no other tool does (temporal understanding
with provenance). U4.2 before U4.1 because the living document is both a
user surface and the U5.2 context format — one artifact, two consumers. U5
before U4.3/U4.4 polish because PRD §25 criterion 7 (panel useful while
chatting) can only be tested once chatting exists.
