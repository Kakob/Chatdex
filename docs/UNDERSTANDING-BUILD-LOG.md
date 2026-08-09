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
