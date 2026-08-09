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

---

## Operational notes

### ⚠ Pending migration: `sync_records.kind` widened (from `adf84aa`)

U1.1's four new sync kinds exposed two backend gaps that frontend checks
could not catch:

1. The Drizzle `$type<>` union on `sync_records.kind` did not include the new
   kinds (TypeScript-level only, no runtime effect).
2. `varchar('kind', { length: 20 })` was too short — `'understanding_project'`
   is 21 characters, so pushing any understanding row would fail at insert.

Both fixed in `adf84aa` (`kind` is now `varchar(32)`), **but the live database
column is not altered until someone runs:**

```
npm run docker:up     # if Postgres isn't running
npm run db:push
```

Until then, syncing understanding entities against a real backend will fail.

### Gap: `npm run typecheck` does not cover the backend

`tsc -b` at the root builds only the frontend project refs. The type errors
above were invisible to it and were only caught by running
`cd backend && npx tsc --noEmit` manually. Until the root `typecheck` script
includes the backend (or CI does), any change touching `backend/src/` should
run that command explicitly before being declared done.
