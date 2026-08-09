# Shared Understanding Workspace — Build Log

Companion to `PRD-shared-understanding-workspace.md` and
`ASSESSMENT-shared-understanding-U0.md`. Records what was actually built per
phase, plus operational notes that affect deployment.

| Phase | Date | Commit | Summary |
|---|---|---|---|
| PRD | 2026-08-08 | `6757062` | PRD committed (stages U0–U6) |
| Assessment | 2026-08-08 | `daa4043` | PRD §26 repo assessment |
| U0.1 | 2026-08-08 | `0e66dcb` | Provider-neutral source model, `providerMeta`, source-gated auto-analysis |
| U0.2 | 2026-08-08 | `666690f` | ChatGPT mapping-graph parser + content-sniffing format detection |
| U0.3 | 2026-08-08 | `b693caa` | `sourceFilename` provenance on all parsers; Codex deferred (no sample) |
| U1.1 | 2026-08-09 | `72edaf6` | Understanding schema: 4 entities, Dexie v3, 4 sync kinds, invariant tests |
| Amendment | 2026-08-09 | `2fac73c` | Privacy invariants: detection sequestered client-side; synthesis may use user-authed LLM providers via transit-only backend relay |
| Scaffolding | 2026-08-09 | `adf84aa` | `src/lib/providers/` (registry, credentials, relay client) + `/api/llm/complete` relay route |
| U1.2 | 2026-08-09 | `f12f0fb` | Project-discovery engine: digest prompts, strict parse + hallucination guard, pending-review persistence |
| Migration | 2026-08-09 | `82bdc52` | `sync_records.kind` varchar(32) applied to Neon by hand (drizzle-kit push would have truncated) |
| U1.3 | 2026-08-09 | `cf9844b` | Projects page: review queue, discovery trigger, invariant-6 disclosure modal; provider-keys settings section |
| Subscription bridge | 2026-08-09 | `856bd77` | Bill synthesis to Claude / ChatGPT subscriptions via local CLI logins (Agent SDK / Codex SDK); per-provider auth-mode toggle |
| U2.1 | 2026-08-09 | `be2a55d` | Current Understanding panel (`/projects/:id`): direction / ideas & decisions / open questions / recent changes, evidence-linked |
| Object review | 2026-08-09 | `ef246ef` | Accept/reject on understanding objects in the panel; `/projects/unassigned` surfaces no-project objects |
| U2.2 | 2026-08-09 | `7cb3131` | Message-level provenance: digests carry indexed messages, evidence gains `messageIds`, panel deep-links to cited messages |
| U3.1 | 2026-08-09 | `c5aeaa1` | Event review gate: AI events land pending, status applies on accept; Dexie v4 backfill; sync LWW on review moment |
| U3.2 | 2026-08-09 | `10f2d16` | Reconciliation engine: chronological batches vs presented current state; op whitelist + ref resolution; all proposals pending |
| U3.3 | 2026-08-09 | `0266e97` | Reconciliation UI: "Update understanding" trigger + disclosure, proposed-changes review strip, pending badges, auto full re-run |
| U4.2 | 2026-08-09 | `d085de1` | Living understanding document: deterministic markdown projection with footnote provenance; Panel/Document toggle, copy + .md export |
| U4.1 | 2026-08-09 | `4851906` | Understanding overview on /projects: per-project stats, open-questions rollup, global recent-changes stream |
| U4.3 | 2026-08-09 | `aec1e8f` | History drawer: per-object audit-trail stream (rejected included), status replay, supersession-chain navigation |
| U4.4 | 2026-08-09 | `640f076` | Map spike: chain-lane timeline view (SVG, no graph lib); §13 coverage review recorded — cross-project recurrence parked as list candidate |

---

## Operational notes

### ✓ Migration applied 2026-08-09: `sync_records.kind` widened (from `adf84aa`)

U1.1's four new sync kinds exposed two backend gaps that frontend checks
could not catch:

1. The Drizzle `$type<>` union on `sync_records.kind` did not include the new
   kinds (TypeScript-level only, no runtime effect).
2. `varchar('kind', { length: 20 })` was too short — `'understanding_project'`
   is 21 characters, so pushing any understanding row would fail at insert.

Both fixed in `adf84aa` (`kind` is now `varchar(32)`). Applied to the live
database (Neon, per `backend/.env` DATABASE_URL) on 2026-08-09 via a direct
`ALTER TABLE sync_records ALTER COLUMN kind TYPE varchar(32)`.

**⚠ Do not use `npm run db:push` for column-type changes on this table.**
drizzle-kit push proposed *truncating* `sync_records` (2,521 rows of synced
ciphertext) to widen the varchar — a plain ALTER is metadata-only and loses
nothing. Run type changes by hand and keep `schema.ts` in sync.

### Subscription bridge (2026-08-09)

Synthesis can now bill the user's consumer subscriptions instead of API keys,
per provider, via `backend/src/llm/subscription.ts`:

- **Anthropic** → Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), which
  reuses the local Claude Code login (macOS keychain). This is the *only*
  sanctioned subscription path — raw OAuth against `/v1/messages` is banned.
  Usage shares the Claude plan's normal limits. Anthropic changed this billing
  model three times in 2026; re-verify if behavior shifts.
- **OpenAI** → Codex SDK (`@openai/codex-sdk`), which bundles the `codex`
  binary as a platform dependency — no global install needed. Auth comes from
  `~/.codex/auth.json`, i.e. the user must run `codex login` once with a
  ChatGPT-subscription account. Live-verified 2026-08-09 after login. Caveat:
  the Codex CLI wraps every call in its agent harness prompt (~14k input
  tokens observed for a one-line completion), which draws down the 5-hour
  subscription window much faster than the Anthropic path (~zero overhead) —
  prefer Anthropic for large discovery runs.

Operational details:

- **Env stripping:** `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `CODEX_API_KEY`
  are removed from the spawned CLI envs — a key in the environment would
  silently override the subscription login and switch billing to pay-per-token.
- **Transit-only:** Agent SDK runs with `persistSession: false`,
  `settingSources: []`, no tools, `cwd` = tmpdir. Codex runs with
  `history.persistence = 'none'`, read-only sandbox, approvals never; Codex may
  still write thread rollouts under `~/.codex/sessions`, which is the user's
  own local CLI state (same as normal Codex usage), not server-side persistence.
- **Model selection:** subscription mode omits `model` unless the caller sets
  one, so each CLI's own default applies (Codex model names can't be verified
  without a login). `maxTokens`/`temperature` are ignored on this path.
- **zod upgraded 3→4 in `backend/`** (Agent SDK peer dependency). Route schemas
  were compatible as-is.

### U2.1 — Current Understanding panel (2026-08-09)

Read-only per-project panel at `/projects/:id` (project names on `/projects`
link into it). Assembly logic lives in
`src/lib/understanding/currentUnderstanding.ts` (pure + unit-tested), the page
is a thin renderer.

Decisions:

- **Section routing over the open ontology:** `direction` and `question` types
  get dedicated sections; every other type (`decision`, `idea`, `goal`,
  whatever discovery emits) renders in "Ideas & decisions" with its type as a
  chip. No type whitelist — unknown types are displayed, not dropped.
- **Sections show status-`current` objects only.** Superseded/resolved
  lifecycle is visible through the "Recent changes" stream (all events for the
  project's objects, source-timeline order, capped at 15). Until U3 emits
  non-`introduced` events, that stream is effectively "recently introduced".
- **Pending objects render with a "pending" badge rather than being hidden** —
  discovery output is all pending, and an empty milestone panel would defeat
  the point. Rejected objects are excluded everywhere. (There was no
  accept/reject UI for *objects* in this phase — U1.3 covered
  projects/associations only; added in the object-review follow-up below.)
- **Evidence is unioned across each object's event stream**, deduped to one
  link per conversation (messageIds merged, first note kept), rendered as
  links to `/conversations/:id`. Deleted conversations show as
  "(deleted conversation)" instead of dead links.

### Object review UI (2026-08-09)

Completes the review loop U1.3 started: understanding *objects* now get
accept/reject controls, shown on pending cards in the Current Understanding
panel (shared `ReviewButtons` component, extracted from `ProjectReviewCard`).
Review writes through the existing `setObjectReviewState` helper, so the
`updatedAt` bump flows into sync like project/association reviews.

- **Unassigned bucket:** discovery can file objects under no project
  (`projectId: null`); those were unreachable in any UI, so they could never
  be reviewed. `/projects/unassigned` now renders the same panel over that
  bucket (`loadProjectUnderstanding(null)`), and the Projects page links to it
  with a count when non-rejected unassigned objects exist.
- Accepting keeps the card (badge disappears); rejecting removes the object
  from the panel everywhere, including recent changes — consistent with U2.1's
  assembly rules.

### Gap: rejected understanding objects cannot be un-rejected

Rejecting an object is final as far as the UI goes: the row keeps its
`rejected` reviewState in Dexie (nothing is deleted), but no surface lists
rejected objects or offers a way back to `pending`/`accepted`. A misclick on
the reject button is currently unrecoverable without dev tools. Projects and
associations have the same property, but their review cards at least stay
visible after accept; objects disappear entirely. Fix candidates: an "undo"
toast on reject, or a collapsed "Rejected" section on the panel.

### U2.2 — Provenance navigation to exact messages (2026-08-09)

Completes the PRD §9 chain: understanding object → evidence → conversation →
exact relevant messages. The tail already existed
(`/conversations/:id?scrollTo=<messageId>` scrolls to and flashes the
message); what was missing was message-level evidence to feed it.

- **Digests are now message-granular.** When a conversation has stored
  messages, its digest carries individual entries `{i, role, text}` instead of
  one fullText excerpt (`i` = position in the ordered message list). Sampling:
  all messages when ≤ `maxDigestMessages` (default 8), else first 3 + latest 5
  — openings establish the topic, endings carry current state. Per-message
  text capped at `messageExcerptLength` (default 200 chars). Conversations
  with no stored messages keep the old excerpt fallback.
- **The model cites indexes, not ids.** Object evidence in the response schema
  is now `[{conversationId, messageIndexes}]`; indexes are cheap to transmit
  and trivially validated. The hallucination guard extends to messages: only
  `i` values that were actually in that conversation's digest survive parsing
  (invented ones are dropped with a warning). The legacy `conversationIds`
  shape is still accepted as a fallback.
- **Indexes → real ids at persist time.** Valid indexes are translated to
  `StoredMessage.id`s against the same ordered list the digest was built
  from, landing in `EvidenceRef.messageIds` — which the schema had from U1.1
  but nothing populated until now.
- **Panel links go to the message.** Evidence links in the Current
  Understanding panel target `?scrollTo=<first cited message>`; additional
  cited messages render as numbered `#2 #3` links. Conversation-level
  evidence (no messageIds) links to the conversation as before.

Worth knowing before the next discovery run:

- **Discovery input cost roughly 2.7×'d.** A full message-granular digest is
  ~1.6k chars/conversation vs ~600 for the old excerpt (~10k tokens per
  25-conversation batch). Prefer the Anthropic subscription path for big runs
  — the Codex path adds ~14k tokens/call of harness overhead on top.
- **Existing objects stay conversation-level.** Evidence created before U2.2
  has no messageIds and never will; only a fresh discovery run produces
  message-anchored objects. Re-runs dedupe projects/associations but create
  objects fresh each time (same behavior as before) — the review queue absorbs
  the duplicates.

### U3 phase plan (2026-08-09)

> Superseded 2026-08-09 by `BUILD-PLAN-shared-understanding-U3-U6.md`, which
> plans the full remainder of the PRD (U3.2 → U6 + backlog). The U3 breakdown
> below is unchanged there; it's kept here for the record.

Stage U3 (PRD §8/§10: temporal reconciliation) split like U1 was — invariants
first, engine second, UI third:

- **U3.1 (this entry):** event review gate — groundwork so reconciliation can
  write without bypassing human review.
- **U3.2:** reconciliation engine — process a project's conversations
  chronologically against its current understanding; the model proposes ops
  (introduce / support / refine / supersede / contradict / resolve / reopen)
  citing object ids + message-level evidence, guarded like discovery.
- **U3.3:** UI — per-project "update understanding" trigger; pending-event
  review (accept/reject proposed changes) in the panel; recent-changes rows
  show review state.

### U3.1 — Event review gate (2026-08-09)

Before U3.1, `recordUnderstandingEvent` applied an op's status effect
immediately — an AI-proposed supersession would have silently flipped a
current direction to `superseded` with no review. That contradicts PRD §11
and would have made the reconciliation engine untrustworthy by construction.

- **`UnderstandingEvent` gains `origin` + `reviewState`** (and optional
  `updatedAt`, stamped on review). User-origin events are accepted and applied
  immediately; AI-origin events land `pending` and change nothing until
  `setEventReviewState` accepts them. AI events require evidence, mirroring
  the object-creation invariant. `introduced` events are always `accepted` —
  the object's own reviewState already gates its existence.
- **Review is one-shot** (pending → accepted/rejected). Re-reviewing throws:
  reverting an applied status would require replaying the object's whole
  event stream — deferred until something actually needs it. Rejected events
  stay in Dexie as audit trail but assert nothing: the panel assembly excludes
  them from evidence and recent changes (pending events do render — they're
  proposals, and U3.3 will let you act on them from the panel).
- **Migration:** Dexie v4 upgrade backfills existing events (all discovery
  `introduced` rows, already applied) as `origin: 'ai'`, `reviewState:
  'accepted'`. No index changes. Sync-side, event envelopes now key LWW on
  `updatedAt ?? createdAt` (events were pure-append before; review makes them
  mutable), and rehydration defaults pre-U3.1 payloads from other devices to
  accepted AI events.

### U3.2 — Reconciliation engine (2026-08-09)

`src/lib/understanding/reconcile.ts`, engine-only (UI is U3.3), per
`BUILD-PLAN-shared-understanding-U3-U6.md`.

- **Decision (Jacob, 2026-08-09): reconciliation and discovery's
  object-extraction coexist for now** — discovery keeps proposing objects on
  first contact; reconciliation evolves them. Revisit once U3.3 is usable.
- **Shape:** `reconcileProject(projectId, config)` loads the project's
  non-rejected associated conversations newer than its cursor, sorts
  chronologically, and processes them in sequential batches (default 10 —
  smaller than discovery's 25 because each call also carries the presented
  object list). State reloads between batches, so an object introduced by
  batch 1 is presented to (and can be superseded by) batch 2.
- **Model contract:** current objects presented as `{id, type, title, body,
  status}`; response is a `changes` list — `introduce` (with response-local
  `ref` "n1"…) or `support/refine/supersede/contradict/resolve/reopen` (by
  `objectId`, optional `supersededBy` naming an existing id or a ref from the
  same response). The prompt explicitly prefers ops on existing objects over
  near-duplicate introduces, and tells the model contradiction without a
  clear winner is a legitimate state (PRD §24).
- **Guards:** everything discovery has (conversation ids, message indexes →
  translated to real message ids) plus: unknown ops dropped, ops targeting
  unpresented object ids dropped, changes with no valid evidence dropped,
  `maxChanges` cap (default 10) enforced with a warning, unresolvable
  `supersededBy` dropped while keeping the event.
- **Everything pending:** introduces go through `createUnderstandingObject`
  (pending), other ops through `recordUnderstandingEvent` origin `'ai'` —
  U3.1's gate means nothing changes status until reviewed. Golden test covers
  the acceptance scenario: old direction + contradicting newer conversation →
  pending replacement object + pending `superseded` event linked via
  `supersededByObjectId`, old object untouched until accept.
- **Cursor:** `UnderstandingProject.lastReconciledAt` (syncs via serializer;
  explicit date handling added). Advances only after all batches succeed, to
  the newest processed conversation's `updatedAt`. Known limitation (noted on
  the field): conversations imported/associated later with older timestamps
  are skipped until a full re-run — U3.3 should offer one.

### U3.3 — Reconciliation UI (2026-08-09)

Completes stage U3: the engine is now reachable, and its proposals are
reviewable where they land.

- **"Update understanding"** button on `/projects/:id` (project view only —
  reconciliation is per-project, the unassigned bucket has no trigger).
  Provider select when several are ready, disclosure modal before anything is
  sent (modal copy parameterized via `actionLabel` — it said "Project
  discovery" unconditionally), batch progress, outcome toast.
- **Cursor UX:** incremental by default via `getReconcilableConversations`
  (exported from the engine so the disclosure lists exactly what a run will
  send). When the cursor leaves nothing new, the run automatically falls back
  to a **full re-run** (`ignoreCursor` config, added this phase) — disclosed
  as such in the modal title, so cost is never a surprise. This is the escape
  hatch for the cursor's late-import limitation.
- **Proposed-changes strip** at the top of the panel: amber cards, one per
  pending event — op chip, target object, detail, "→ Replaced by" when the
  supersession names its replacement, evidence links (message-anchored), and
  accept/reject wired to `setEventReviewState`. Assembly gained
  `pendingChanges` (uncapped — review must see everything, not the
  recent-changes window) with resolved evidence + replacement titles.
- **Recent changes** rows now show `(pending)` markers and supersession
  targets (`old → new`).

Stage U3 acceptance (PRD: old direction vs new never both current) is
implemented end-to-end but not yet exercised on real data — Jacob should run
"Update understanding" on a real project and review the proposals.

### Gap: `npm run typecheck` does not cover the backend

`tsc -b` at the root builds only the frontend project refs. The type errors
above were invisible to it and were only caught by running
`cd backend && npx tsc --noEmit` manually. Until the root `typecheck` script
includes the backend (or CI does), any change touching `backend/src/` should
run that command explicitly before being declared done.

### U4.2 — Living understanding document (2026-08-09)

PRD §14: a readable projection of current understanding, generated from the
underlying objects — never manually maintained. Built before U4.1/U4.3 (build
plan order) because the same projection is the U5.2 agent-context seed.

- **`src/lib/understanding/livingDocument.ts`** — `renderLivingDocument(project,
  understanding, options)`: pure, deterministic markdown projection over the
  already-assembled `CurrentUnderstanding`. **No LLM call** — the objects were
  synthesized upstream; this only renders them. Identical input → identical
  string: dates render as UTC ISO days, and the generation stamp is
  caller-supplied (`generatedAt` option), never read from the clock.
- **Structure:** header (name, description, "projection — regenerate, don't
  edit" note) → Current Direction → one section per open-ontology type from
  the ideas-and-decisions bucket (naive pluralizer: `decision` → Decisions,
  unknown types still get a heading) → Open Questions → Recent Changes
  (ISO date, op label, `old → new` supersession, `*(pending)*` markers).
- **Provenance as markdown footnotes:** one footnote per cited conversation
  across the whole document, numbered in first-citation order and reused on
  repeat citations; label is the conversation name plus the first evidence
  note as a quote; deleted conversations render as `(deleted conversation)`.
  Plain-markdown on purpose — readable in-app, exported, and as model context.
- **`includePending` option** (default true, annotated `*(pending review)*`).
  When false — the U5.2 context mode — pending objects are dropped from
  sections *and* from Recent Changes: their 'introduced' events are always
  accepted (U3.1 gates existence via object reviewState), so filtering by
  event state alone would still name the excluded object.
- **UI:** Panel/Document toggle on `/projects/:id` (works for the unassigned
  bucket too). Document view (`LivingDocumentView`) renders the markdown
  source formatted, with Copy and Download-.md (existing `downloadExport`
  pattern, `understanding-<slug>-<date>.md`). No markdown-renderer dependency
  added — source view is deliberate: what you see is exactly what travels.
- `OP_LABEL` moved out of the page into `livingDocument.ts` (both surfaces
  use it).

Not built (deliberately, PRD §14 "do not build all of these yet"): alternate
projections (spec, architecture doc, briefing), LLM-polish pass.

### U4.1 — Understanding overview (2026-08-09)

PRD §12's home surface, built as an evolution of `/projects` rather than a
new route (build-plan call: the tree is a starting visualization, not the
information architecture). Pure assembly — no LLM calls.

- **`src/lib/understanding/overview.ts`** — `assembleOverview(projects,
  objects, events)` (pure, tested) + `loadUnderstandingOverview()` Dexie
  loader. Inclusion rules mirror the panel: rejected
  projects/objects/events excluded everywhere, pending included and counted
  as awaiting review. Objects under a rejected project are excluded with it.
- **Per-project stats** (`ProjectOverviewStats`): current-object count, open
  question count, pending-review count (pending objects + pending events —
  the reconciliation proposals), last activity (newest live event,
  source-timeline). Projects ordered by last activity, not `updatedAt`.
- **Open-questions rollup**: current questions across all projects *and* the
  unassigned bucket, each linking to its panel, recency-ordered.
- **Global recent-changes stream**: newest 15 events across everything, with
  op label, supersession target, project link, `(pending)` markers.
- **UI**: `ProjectReviewCard` gains an optional stats line (kept as the one
  card — replacing it with a stats-only card would have dropped association
  review for reviewed projects); page header counts open questions; empty
  state now keys off overview content, not just project count (an
  unassigned-only store previously rendered "No projects yet" with data
  behind the link).

U3 note: Jacob live-ran "Update understanding" (reconciliation) on real data
on 2026-08-09 — U3 is now smoke-tested; stage closed.

### U4.3 — History drawer (2026-08-09)

PRD §23's HISTORY half: the panel stays the HEAD view, and clicking any
object card opens a slide-over reconstructing how that belief got there.

- **`src/lib/understanding/history.ts`** — `assembleObjectHistory(objectId,
  objects, events, conversationNames)` (pure, tested) + `loadObjectHistory`
  Dexie loader. Loads the whole understanding store (small by construction)
  because supersession chains may cross project boundaries.
- **Audit-trail stream:** the object's full event list, oldest first
  (source timeline, analysis time as tiebreak) — **rejected events
  included**, rendered greyed with "rejected — not applied"; pending events
  marked "pending review". Each row: date, op label, AI marker, detail,
  replaced-by title, per-event evidence links (same `mergeEvidence` path as
  the panel).
- **Status replay:** rows that applied (accepted/edited, U3.1 gate) and
  carry a status-effecting op show the status they set (`→ superseded` etc.)
  via the now-exported `OP_STATUS` map from `db/understanding.ts` — the
  timeline reads as a replay of the object's lifecycle.
- **Supersession chain navigation:** "Replaces:" (direct predecessors) and
  "Replaced by:" (hop-by-hop forward chain ending at the newest holder of
  the belief). Only applied supersessions build the chain — pending
  proposals stay in the stream. Cycle-guarded; clicking a chain entry
  re-targets the drawer in place, so old ↔ new navigation is two clicks.
- **UI wiring:** `HistoryDrawer` (Escape/backdrop close), object cards get
  cursor/hover affordance + keyboard activation; `EvidenceLinks` extracted
  from the page into `components/understanding/EvidenceLinks.tsx` (now
  swallows click propagation so links inside clickable cards don't open the
  drawer).

Scope note: entry points are the panel's object cards (build-plan call).
Recent-changes rows and pending-change cards don't open the drawer yet.

### U4.4 — Map spike (2026-08-09)

The build plan gated this on U4.1–U4.3 leaving real navigation questions;
Jacob called the spike explicitly. Built deliberately small, honoring §13's
warning: **no force-directed graph, no graph library, no new dependency.**

- **What it is:** a third "Map" view on `/projects/:id` (unassigned too) —
  a chain-lane timeline. The only true cross-object edge in the data model
  is supersession, so each supersession chain gets one row reading left →
  right as evolution; unchained objects sit in single-node rows,
  most-recently-started chains on top. Node click opens the U4.3 history
  drawer (map and drawer share the navigation loop).
- **`src/lib/understanding/map.ts`** — `assembleProjectMap(objects,
  events)` (pure, tested) + `loadProjectMap` loader. Inclusion mirrors the
  panel (rejected excluded, pending shown). Edges: non-rejected
  supersessions, deduped from→to with applied winning over pending; rows =
  connected components; within-row order is topological (Kahn), first-seen
  tiebreak, cycle-tolerant fallback.
- **Rendering:** hand-rolled SVG (`ProjectMapView`) in an
  `overflow-x-auto` card. Status = border color (violet current / gray
  superseded / blue resolved); dashed border = pending object; solid arrow
  = applied supersession; dashed amber arrow = pending proposal. Legend
  under the map. Lazy-loaded on first Map view, refreshed after reviews.

**§13 question review (the actual spike output):**

| Question | Answered by |
|---|---|
| What projects am I working on? | U4.1 overview |
| Major concepts within a project? | Panel sections |
| Where did this idea originate? | U4.3 drawer (introduced + evidence) |
| What changed recently? | Recent-changes streams |
| Which questions remain unresolved? | Open-questions rollup |
| Evidence for current direction? | Evidence links everywhere |
| How did direction evolve, at a glance? | **This map** |
| Which ideas recur across projects? | **Still unanswered** |

Verdict on the remainder: cross-project recurrence is an evidence-overlap
question (which conversations feed multiple projects, which objects cite
shared sources) — a ranked *list* would answer it more directly than any
graph; parked as a backlog candidate, not a U4 blocker. Whether the map
itself earns permanence is Jacob's call after using it on real data; if it
doesn't help, delete `map.ts` + `ProjectMapView` and the toggle entry — the
spike touched nothing else. U4 (navigation) is otherwise complete.

## Stage U5 — Chatdex-native AI chat

### U5.1 — Chat surface + storage (2026-08-09, `807c984`)

PRD §16/§18 groundwork: a native chat surface whose transcripts are ordinary
Chatdex sources. No context injection yet — that's U5.2; a U5.1 chat starts
blank, so no conversation history crosses a provider boundary and no
disclosure modal is needed (invariant 6's opt-in is the user typing into the
provider they picked).

- **Chats are sources.** New `DataSource` `'chatdex'` (rose `MessageCircle`
  in `SOURCE_META`). Each chat is a `StoredConversation` + `StoredMessage`
  rows, so browse/search/export/sync apply with zero extra plumbing (sync
  hooks fire on the same tables). `providerMeta` records `{provider, model,
  projectId?}` — model is filled lazily from the first completion in
  subscription mode (the CLI resolves it).
- **`src/lib/chat/chats.ts`** — `createChat` (conversation + first user
  message + accepted user-origin `ProjectAssociation` at confidence 1 when
  started from a project, in one Dexie transaction), `appendChatMessage`
  (keeps messageCount/userMessageCount/assistantMessageCount/fullText/
  estimatedTokens/updatedAt consistent with the import pipeline's rows),
  `listChats`, `getChat`. Search index invalidated on write. Tested (9).
- **Streaming relay** — `POST /api/llm/stream` (SSE: `delta` fragments,
  authoritative `done` completion, content-free `error`), same zod schema
  and transit-only rules as `/complete`. All four paths stream: api-key
  Anthropic/OpenAI via provider SSE (`stream: true`, usage captured),
  subscription Anthropic via Agent SDK `includePartialMessages`
  (text_delta events, top-level only), subscription OpenAI via Codex
  `runStreamed` (agent_message item growth → suffix deltas). Client
  disconnect aborts api-key upstream fetches; PassThrough guarded against
  post-disconnect writes. Shared helpers extracted to `backend/src/llm/
  sse.ts` — the backend's **first vitest file** (6 tests; `test:all` was
  exiting 1 on "no test files" before this).
- **Frontend client** — `streamComplete()` in `relayClient.ts` +
  incremental `SSEParser` (`src/lib/providers/sse.ts`, CRLF- and
  chunk-boundary-safe, tested). Deltas are display-only; the `done` payload
  is what gets persisted.
- **`/chat` page** — single route `chat/:id?` (optional param so
  /chat → /chat/:id navigation can't remount mid-stream): chat list rail,
  bubble thread, Enter-to-send composer, provider select for new chats
  (ready providers only); an existing chat is pinned to the provider that
  started it. Per-project entry: "Chat" button on `/projects/:id` →
  `/chat?project=<id>` with project chip; the association makes the chat
  part of that project's future reconciliation set (U6.1 will just work).
  Assistant text persists only on completion — a failed stream keeps the
  user message and toasts.
- **Disclosure plumbing kept honest:** `NATIVE_PROVIDER` in
  `runDiscovery.ts` became per-conversation `nativeProvider()` — a chatdex
  chat's native provider is read from its `providerMeta`, unknown ⇒
  disclosed as cross-provider.

Not built (deliberate): context injection (U5.2), model picker /
regenerate / per-project history filters (U5.3), reconcile-this-chat
(U6.1). **Not yet browser-exercised** — Jacob should open /chat, run one
subscription-path chat, and confirm the transcript appears under Browse
with the Chatdex chip and syncs.

### U5.2 — Context injection (2026-08-09, `6e707f1`)

PRD §17: a project chat starts already knowing the project. The injected
context is the U4.2 living-document projection in agent-context mode
(`includePending: false` — accepted objects only), wrapped in a system
prompt, size-budgeted, and always visible to the user.

- **`src/lib/chat/context.ts`** — pure `buildProjectContext(project,
  understanding, config)` (tested, deterministic) + Dexie loader
  `loadProjectChatContext(projectId)`. Returns null when nothing accepted
  exists — the chat then runs context-free and the panel says so. Budget
  default 4000 estimated tokens (`maxContextTokens`), enforced by staged
  shrink: full document → drop Recent Changes → cap ideas/decisions at 10 +
  questions at 10 → direction + 5 questions only → hard character cut with
  a visible truncation note. `truncated` flag surfaces in the UI.
- **Injection** — the system message precedes the transcript on *every*
  send, and the context is reloaded per send: accept a pending object
  mid-chat and the next message already carries it. Existing chats resolve
  their project from `providerMeta.projectId`, so project scope survives
  past the first message (U5.1 only read the ?project= param).
- **Shown to the user** — collapsible "Context sent to the model" panel
  above the thread (token estimate, truncation marker, full system prompt
  verbatim). What the model was told is never invisible.
- **Disclosure (invariant 6)** — injecting understanding is a new
  disclosure: the first context-carrying send of each chat is gated on the
  DisclosureModal, listing the source conversations the understanding
  derives from (the project's non-rejected associations, minus the chat
  itself) with cross-provider sources flagged. Modal copy is
  parameterized via new `sendsDescription`/`confirmLabel` props ("sends
  Chatdex's synthesized understanding of X … along with your message").
  Acceptance is stamped per chat (`providerMeta.contextDisclosedAt`, new
  `markChatContextDisclosed`, tested); cancel sends nothing and keeps the
  typed message in the composer.

Not built (deliberate): context for non-project chats, per-send disclosure
re-prompts (once per chat matches discovery/reconcile's per-run modal),
model-visible evidence deep links (footnotes carry conversation names
only). **Not yet browser-exercised** — Jacob: open a project chat, confirm
the disclosure modal on first send, expand the context panel, and check
the model actually answers from the injected understanding.

### U5.3 — Chat UX (2026-08-09)

The build plan sized this by "what actually hurts" — with only one live
session to draw on, this pass covers the plan's three named items plus the
one gap streaming exposed immediately (no way to stop a generation).

- **Model picker** — `ProviderInfo` gains `chatModels` (curated:
  Opus 5 / Sonnet 5 / Haiku 4.5; GPT-4o); anthropic `defaultModel` bumped
  `claude-sonnet-4-6` → `claude-opus-5` (api-key mode only; subscription
  mode still omits the model so the CLI default applies). Picker offers
  Default (provider/CLI default) / curated / **Custom…** free-text (Codex
  model ids aren't knowable in advance). Per-chat persistence via
  `providerMeta.modelOverride` (`setChatModelOverride`, tested) — distinct
  from `model`, which keeps recording what actually answered. Works on new
  *and* open chats; provider stays fixed per chat.
- **Per-project chat history** — rail scope toggle (This project / All
  chats) appears on project-scoped chats, defaulting to the project's own
  history (`listChats(projectId)` from U5.1).
- **Regenerate / continue** — "Regenerate" under a trailing assistant
  message deletes it (`deleteLastAssistantMessage`: aggregate recompute
  from remaining rows, tested) and re-streams from history; "Generate
  response" appears when the last message is a user message (failed
  stream, cancelled disclosure) and streams without appending. Both reload
  fresh context and are disclosure-gated like send (the modal's
  `sendsDescription` adapts: "along with this chat").
- **Stop** — Send becomes Stop while streaming; abort keeps the partial
  text as the assistant message (it was already on screen) and toasts
  "Generation stopped". Client abort propagates via `streamComplete`'s
  AbortSignal → relay → provider fetch (api-key mode; subscription bridges
  finish server-side, response discarded).
- **Ordering bug fixed (latent since U5.1):** messages sort by
  `[conversationId+createdAt]`; same-millisecond appends tied and sorted
  by random uuid — garbling both the rendered thread and the history sent
  to the model. `appendChatMessage` now keeps per-conversation timestamps
  strictly increasing. (Surfaced as a test flake; the fix is why it can't
  recur.)

Send/regenerate/continue share one `streamReply` core; disclosure gating
generalized to all three actions. Not built: message editing, branching,
per-message model display, provider switching mid-chat. **Not yet
browser-exercised.**
