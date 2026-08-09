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
  with no stored messages keep the old excerpt fallback. **Cost note:** a full
  digest is now ~1.6k chars/conversation vs ~600 — roughly 2.7× input tokens
  per discovery batch. Still prefer the Anthropic subscription path for big
  runs (Codex adds ~14k tokens/call harness overhead on top).
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

Existing understanding objects keep conversation-level evidence; re-running
discovery produces message-anchored objects (idempotency note: re-runs dedupe
projects/associations but objects are created fresh each run — same behavior
as before, the review queue absorbs duplicates).

### Gap: `npm run typecheck` does not cover the backend

`tsc -b` at the root builds only the frontend project refs. The type errors
above were invisible to it and were only caught by running
`cd backend && npx tsc --noEmit` manually. Until the root `typecheck` script
includes the backend (or CI does), any change touching `backend/src/` should
run that command explicitly before being declared done.
