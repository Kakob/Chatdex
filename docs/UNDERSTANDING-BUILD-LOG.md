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
| Subscription bridge | 2026-08-09 | — | Bill synthesis to Claude / ChatGPT subscriptions via local CLI logins (Agent SDK / Codex SDK); per-provider auth-mode toggle |

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
  ChatGPT-subscription account. **Unverified end-to-end**: no Codex login
  exists on this machine yet.

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

### Gap: `npm run typecheck` does not cover the backend

`tsc -b` at the root builds only the frontend project refs. The type errors
above were invisible to it and were only caught by running
`cd backend && npx tsc --noEmit` manually. Until the root `typecheck` script
includes the backend (or CI does), any change touching `backend/src/` should
run that command explicitly before being declared done.
