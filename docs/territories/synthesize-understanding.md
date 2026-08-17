# Territory: Synthesize understanding

The shared understanding workspace (PRD stages U1–U6): sending conversation digests to an LLM to discover projects, extract understanding objects with evidence, reconcile new conversations against existing understanding, and inject the result back into chat.

## The question

When I click "Discover projects" or "Reconcile", exactly what leaves my machine, what comes back, what guards stand between the model's output and my database, and how does human review gate what becomes "current understanding"?

## User-visible behavior

```
Projects page → "Discover projects" → disclosure modal (what goes to which provider)
    ↓ confirm
batched LLM calls → pending projects / associations / objects appear for review
    ↓ accept/reject (ReviewButtons; bulk-accept for "supports")
accepted objects render in the Current Understanding panel + living document
    ↓
new conversations happen (imports or native chats)
    ↓ "Reconcile" (manual; a nudge banner after 4 new chat messages — never automatic)
LLM proposes changes as EVENTS (supersede/refine/support/contradict/resolve/reopen)
    → pending events reviewed one by one → accepted events mutate object status
    ↓
Chat page: the living document (accepted objects only) is injected as system context —
gated by a one-time-per-chat disclosure — and the chat itself becomes a source
that future reconciliation reads. The loop closes.
```

## Entry point

- Discovery: `ProjectsPage.handleDiscoverClick` (`:126`) → `DisclosureModal` → `runDiscoveryInBatches` (`lib/understanding/runDiscovery.ts:86`).
- Reconcile: `ProjectUnderstandingPage.handleReconcileClick` (`:291`) and `ChatPage.handleReconcileClick` (`:506`, scoped to the active chat) → `reconcileProject` (`lib/understanding/reconcile.ts:342`).
- Chat context: `ChatPage.loadFreshContext` (`:440`) → `loadProjectChatContext` (`lib/chat/context.ts`).

## Control-flow path

### Discovery (U1)

```
getConversations()  ← NO arguments: the ENTIRE corpus, updatedAt DESC,
    ↓                 re-sent in full on every re-run [CODE ProjectsPage.tsx:128]
buildDisclosure → modal → confirm
    ↓
batches of 25 (hardcoded twice — page and engine constants drift independently)
    ↓ per batch, SEQUENTIAL:
buildDigest per conversation: ≤8 sampled messages (first 3 + last 5, indexes
    preserved), 200 chars each; or a 600-char fullText excerpt
    ↓
system prompt (JSON contract + existing project names) + user JSON
    ↓ complete() via relay (non-streaming)
parseDiscoveryResponse — the hallucination firewall:
    · non-JSON → THROW (stops the whole run, prior batches stay persisted)
    · unknown conversationIds → dropped (associations warn; objects silently skip ⚠ asymmetry)
    · invented message indexes → dropped + warning
    · object with zero valid evidence → dropped (PRD §9 enforced pre-persistence)
    · confidence clamped [0,1], missing → 0.5
    ↓ persist:
ensureProject (case-insensitive name match — INCLUDING rejected projects ⚠)
associations deduped by unique [projectId+conversationId]
objects NEVER deduped across runs — "the review queue absorbs the duplicates" [DOC build log]
```

### Reconciliation (U3.2/U6.1) — the temporal engine

```
getReconcilableConversations(projectId[, scope]):
    associations ≠ rejected  ∩  updatedAt > project.lastReconciledAt (strict >)
    ∩ not a freshly-reconciled chat — sorted ASCENDING (chronological,
    opposite of discovery — deliberate)
    ↓ batches of 10; per batch RELOADS current objects so batch 1's
      introductions are visible to batch 2 [TEST reconcile.test.ts:352]
system prompt: current objects {id,type,title,body,status} + change schema
    (introduce with response-local ref, or 6 event ops); "contradict" is
    explicitly allowed to stand unresolved (PRD §24)
    ↓ parse: same firewall + maxChanges cap + unknown-objectId drop
    ↓ persist two-pass: introduces first (ref→id map), then events —
      so supersededBy:"n1" resolves; unresolvable → field dropped, event kept
    ↓ cursor advances ONLY after all batches succeed; NEVER on scoped runs;
      chats stamped providerMeta.reconciledAt from the pre-run snapshot
```

**Error asymmetry** [CODE]: discovery wraps batches in try/catch and reports "Stopped after batch N"; `reconcileProject` has **no try/catch** — a mid-run throw discards the result object (counts lost), doesn't advance the cursor, doesn't stamp chats, and **re-running duplicates what the completed batches already wrote**.

### Review gate (U3.1)

The two-axis state machine, enforced in `src/lib/db/understanding.ts` [CODE]:

```
reviewState (governance): pending → accepted | rejected | edited
status (semantics):       current ↔ superseded | resolved   (denormalized from events)
```

- AI-origin objects/events **must carry evidence or the write throws** — the invariant is structural, not advisory. [CODE db/understanding.ts:99-103, :166-170][TEST]
- Object + its `introduced` event are written in one transaction; `introduced` events are always accepted (the object's own reviewState gates existence).
- Accepting an event applies `OP_STATUS[op]` to the object; **`supported`/`refined`/`contradicted` are status-neutral** — which is exactly why bulk-accept is restricted to `supported`.
- Event review is **one-shot**: re-reviewing throws (reverting would require replaying the stream). Object/project/association review has no such guard — freely flippable.
- `'edited'` is handled everywhere (types, OP application, history, map) but **no UI ever produces it**. Known backlog item.
- **No un-reject path exists anywhere.** [DOC build log, known gap]
- `pending` is rendered-but-badged, `rejected` excluded everywhere — except `history.ts`, which deliberately shows rejected events as audit trail.

### Chat context injection (U5)

`context.ts`: renders the living document with `includePending: false` — **only accepted understanding reaches the model**. Budget 4000 estimated tokens with a 4-stage shrink ladder, then a hard character cut. The wrapper prompt tells the model the user can see exactly this context ("if asked what you were told, quote it freely") — and the `ContextPanel` renders it verbatim. Reloaded **per send**, so an accepted review lands in the very next message. [CODE + TEST context.test.ts]

The living document itself (`livingDocument.ts`) is a **pure, deterministic projection** — no LLM call, never stored, regenerated per render, clock injected. [CODE + TEST]

## Data flow

```
conversations/messages ──digests──► LLM ──JSON──► parse firewall
    ↓                                                   ↓
projects / associations (deduped)          objects + EVENTS (append-only,
    ↓ review                               evidence on the EVENT, not the object —
accepted graph ──► currentUnderstanding    "derived-from = union of event evidence")
    ↓ pure projection                          ↓ messageIndexes → real StoredMessage ids
living document (markdown, footnoted)          at persist time
    ↓ token-budgeted wrap
chat system prompt ──► chat replies ──► chat is itself a StoredConversation
                                        ──► future reconciliation input   (closed loop)
```

Evidence rendering: `mergeEvidence` dedupes to one link per conversation; deleted conversations render `(deleted conversation)`, never a dead link. `EvidenceRef.note` is plumbed end-to-end but **no producer ever sets it** — dead field in practice. [CODE]

## State ownership

```
Dexie v3 tables: understandingProjects / projectAssociations (unique
  [projectId+conversationId]) / understandingObjects / understandingEvents
  (append-only) — all four sync as ciphertext with LWW envelopes
three cursors: project.lastReconciledAt (full runs only) ·
  chat providerMeta.reconciledAt · chat providerMeta.contextDisclosedAt
UI: pending-review badge (Sidebar) recomputes by reading all four tables
  on EVERY route change [CODE Sidebar.tsx:35]
```

Conversation deletion cascades to associations only — objects/events survive: "synthesis outlives any single source." [CODE sync/engine.ts:91-93]

## Side effects and boundaries

- LLM provider boundary via the relay (see `relay-llm-calls.md`) — the only place conversation plaintext leaves the machine.
- **Disclosure**: computed by `buildDisclosure` (unknown-origin sources fail-safe to "cross-provider"), shown before every discovery/reconcile run; chat context discloses **once per chat** (stamped `contextDisclosedAt`). Discovery/reconcile consent is **recorded nowhere** — no audit trail of what was disclosed when. [CODE]
- Disclosure copy says "nothing is stored or logged server-side" — stronger than reality: Fastify's `logger: true` logs request metadata (path/timing/user) for relay calls. Content, no; existence and frequency, yes. [CODE vs UI copy]

## Decisions embodied by the code

**Decision:** Provenance is structural — AI writes without evidence throw.
**Evidence:** [CODE db/understanding.ts:1-8][TEST]
**Consequence:** the PRD's "every claim navigable to its source" is enforced at the storage layer, not by prompt hope. The strongest invariant in the app.

**Decision:** Understanding evolves via an append-only event stream; status is denormalized; review is one-shot.
**Evidence:** [CODE types/understanding.ts:100-125, db/understanding.ts:154-230]
**Trade-off:** full auditability and replayability vs. no undo (un-reject/re-review need stream replay machinery that doesn't exist).

**Decision:** Discovery and reconciliation coexist as two extraction engines — discovery proposes objects on first contact (whole corpus, newest-first, batches summarized independently — the PRD's own anti-pattern), reconciliation evolves them chronologically.
**Evidence:** [DOC build log: "Decision (Jacob, 2026-08-09): coexist for now… revisit once U3.3 is usable" — U3.3 through U6 have since shipped; the revisit hasn't happened]
**Consequence:** re-running discovery re-sends everything and duplicates objects into the review queue.

**Decision:** Hallucination containment by validating against exactly what was sent (known conv ids, known message indexes, known object ids), dropping-with-warning rather than failing.
**Evidence:** [CODE discovery.ts:184-283, reconcile.ts:194-284][TEST — well covered]
**Caveat:** warnings reach `console.warn` and a toast *count* only — never a visible surface.

**Decision:** Only accepted understanding reaches chat context; pending is withheld.
**Evidence:** [CODE context.ts:83-85][TEST]
**Consequence:** the review gate is also the quality gate on what the model is told about you.

## Invariants and assumptions

- CLAUDE.md invariant 6, condition by condition: **user-initiated/opt-in ✅** (every path is a button + modal; the nudge is a suggestion only); **transit-only relay ✅ in code** (see relay doc); **cross-provider disclosure ✅** with the once-per-chat caveat; **outputs are user data ✅** (plaintext local, ciphertext sync). [CODE-verified]
- Assumed: one project ≈ one reconcile consumer per conversation. **Violated for shared conversations**: project A reconciling a chat stamps `reconciledAt`, making project B *skip* it until the chat changes — a real cross-project bug, untested. [CODE reconcile.ts:293-297 + INFERRED]
- Assumed: `existing` projects list is trustworthy — but it includes rejected projects, so discovery can file new work under a rejected project, where the overview and badge **hide it**. Invisible-but-present rows. [CODE discovery.ts:303]

## Failure modes

1. Reconcile mid-run failure → duplicated proposals on retry (no engine-level catch, cursor unmoved).
2. Concurrent runs (two tabs/devices): no lock, no run record → duplicate projects (name index is non-unique; `ensureProject`'s dedup is in-memory), or a `ConstraintError` on the association index killing the batch.
3. Provider failure at 95% of a streamed chat reply **discards the partial text** (only user-initiated Stop preserves it) — the chat is left with a trailing user message and a "Generate response" recovery affordance. [CODE ChatPage.tsx:342-355]
4. Fence-plus-prose LLM output still fails JSON parse (only bare fences are stripped) → batch dies.
5. Rejected-project matching (above).
6. Cost: no rate limiting, no token estimates in the modal, batch size not configurable — a large corpus re-run is an unbounded spend the UI doesn't quantify. (Known backlog: "token estimate in disclosure modal".)

## Tests and verification

Strong engine-level coverage (~2,380 test lines vs ~2,050 source) [TEST]:
- All structural invariants (evidence-required, atomic writes, status ops, one-shot review, cascade behavior).
- The full hallucination-guard battery, both engines.
- The **golden temporal scenario**: contradicting conversation → pending replacement + pending `superseded` event with resolved ref, old object stays current until accept — the PRD U3 success criterion, encoded.
- U6.1 stamp semantics (6 cases), determinism of document and context, cycle-guarded history/map layout, context shrink ladder.

**Gaps:** zero component/page tests — the disclosure gate, "cancel sends nothing", bulk-accept scoping, and the nudge are UI-only logic with no coverage; prompt content has only smoke assertions (drift undetectable); no concurrency tests; U6.1/U6.2 are marked "not yet browser-exercised" in the build log.

## Visual map

```
                    ┌────────────── REVIEW GATE ──────────────┐
 conversations ──► LLM ──► pending projects/assocs/objects/events
      ▲                        accept ▼            reject ▼ (kept as audit)
      │             status transitions (OP_STATUS)   excluded everywhere
      │                        ▼
      │              accepted graph ──► living document (pure projection)
      │                                      │ ≤4000 tok, accepted only,
      │                                      ▼ disclosed once per chat
      └───── chat (source: 'chatdex') ◄── chat with injected context
              ▲ reconcile (cursor per project, stamp per chat ⚠ shared-chat bug)
```

## Suggested walk

1. Read `src/types/understanding.ts` in full — the entity model with its design comments is the territory's grammar.
2. Read `src/lib/db/understanding.ts` — find both structural invariants and the one-shot review throw.
3. Read `discovery.ts` top to bottom: digest building → prompt → parse firewall → persistence. Before the parse section, predict what a hostile/hallucinating model could inject, then check each guard.
4. Read `reconcile.ts:308-402` (selection + run). Ask: which of the three cursors advances when, and what happens on a scoped run?
5. Read `livingDocument.ts` and `context.ts` — pure functions, quick reads, and the chat seam.
6. Open `ChatPage.tsx:440-470` (`loadFreshContext` + `gateOnDisclosure`) to see the closed loop and the once-per-chat consent stamp.
7. Finish with `reconcile.test.ts:267-348` — the golden temporal scenario reads like the spec.

## Ownership challenge

Fix the shared-conversation reconcile bug: make the freshness stamp per-(project, conversation) instead of per-conversation (e.g., a map on `providerMeta` or a small join table), with a test where two projects reconcile one chat. Meaty but well-bounded, and it forces you through selection, stamping, and the cursor model. (Smaller: exclude rejected projects from discovery's `existing` list, with a test.)

## Fog

- ? Discovery re-sends the entire corpus every run and never dedupes objects — when does the "coexist for now" decision get revisited?
- ? Should disclosure consent for discovery/reconcile be recorded (audit trail), as chat context's is?
- ? Once-per-chat disclosure vs. context that can later derive from new cross-provider sources — re-prompt or accept?
- ? Will `'edited'` (accept-with-modification) ever get a producer, or should the union narrow?
- ? Is `EvidenceRef.note` abandoned since message-index citations landed?
- ? What should surface warnings (hallucination drops, stopped runs) beyond console + toast counts — a run log?
- ? Are the 4000-token budget and 4-message nudge tuned or placeholder?
- ? PRD §10's "associate existing understanding with another project" op — planned or dropped?
- ? Contradicted objects render as plain `current` — is a "contested" affordance intended (PRD §24 names the state)?
- ? Is the project map (U4.4 spike) staying or being deleted? The build log explicitly defers to real-use judgment.
