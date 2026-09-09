# Backend test harness

Status: Proposed — drafted 2026-09-09 from the [invariant register](../../assessments/invariant-register.md).
Primary capability: none (shared infrastructure). Owner of the affected contracts:
[architecture.md](../../architecture/architecture.md) §"Backend", [auth-architecture.md](../../architecture/auth-architecture.md),
CLAUDE.md invariants 1 and 6.
Affected contracts: CLAUDE.md inv. 1 (ciphertext-only sync), inv. 6 (transit-only relay);
architecture.md:84-86 (LWW conflict resolution), :116 (user scoping), :132-134 (JWT secret,
challenge token, recovery hash); auth-architecture.md:111 (recovery re-enrollment).

## Problem

`backend/` has exactly one test file, `backend/src/llm/sse.test.ts`, and it covers SSE
framing. `backend/package.json` has no `test` script; `npm run test:all` runs `cd backend
&& vitest run` and picks up vitest from the root `node_modules` by accident.

As a result nine of the twelve unguarded Tier 1 rows in the invariant register are backend
guarantees that hold only because nobody has edited the code:

| Register row | Guarantee | Enforcing code |
|---|---|---|
| INV-11, DR-25, UW-33 | Relay never persists or logs request/response content; error paths are content-free | `backend/src/routes/llm.ts` |
| INV-21 | `JWT_SECRET` must be set and ≥32 chars, enforced at boot | `backend/src/middleware/auth.ts:25-28` |
| INV-22 | Challenge-token verification is timing-safe; replay outside 5 min fails | `backend/src/utils/challengeToken.ts` |
| INV-23 | Recovery code never stored cleartext; constant-time compare | `backend/src/utils/passwordHash.ts` |
| INV-24 | Every sync read/write scoped to the JWT user | `backend/src/routes/sync.ts:79,134,153` |
| INV-25 | Sync conflict resolution is LWW by `updatedAt`; older/equal writes skipped | `backend/src/routes/sync.ts:87-113` |
| INV-27 | WebAuthn counter updated on assertion (and see Finding below) | `backend/src/routes/auth.ts:252-256` |
| INV-29 | Recovery re-enrollment leaves `wrapped_by_recovery_*` unchanged | `backend/src/routes/auth.ts:394-395` — **spec-drift** |
| ORPH-7 | Subscription bridge strips provider API keys from the subprocess env | `backend/src/llm/subscription.ts:44-47,99-106` |
| ORPH-8 | Relay request caps: 1–500 messages, `maxTokens` ≤64000, `temperature` 0–2 | `backend/src/routes/llm.ts:33-35` |

A one-line change to `backend/src/routes/llm.ts` that logged `request.body` would pass
typecheck, lint, and every existing test.

## Proposed changes

1. **Make the app buildable without listening.** Extract the Fastify construction from
   `backend/src/index.ts` into `backend/src/app.ts` exporting `buildApp(opts)`; `index.ts`
   calls it and listens. `opts` accepts a logger (or a log stream) and a database handle,
   defaulting to the current `logger: true` and `../db/index.js`. Route plugins receive the
   database through Fastify plugin options instead of importing the module singleton, so
   tests can substitute one. No behavior change for the running server.
2. **Give the backend a real test setup.** Add `"test": "vitest run"` to `backend/package.json`
   with `vitest` as a dev dependency, a `backend/vitest.config.ts` with `environment: 'node'`,
   and a `backend/src/test/` folder for helpers. Keep `npm run test:all` at the root working.
3. **Route tests via `app.inject()`**, no network:
   - `llm.test.ts`: stub `globalThis.fetch`; send a request whose messages contain a unique
     marker string; assert the marker never appears in captured log output, in any database
     call, or in any error response body across success, provider-4xx, provider-5xx,
     malformed-JSON, and stream-abort paths. Assert the request caps. Add a source-text
     guard (same pattern as `src/lib/db/localOnly.test.ts`) that `llm.ts` and
     `subscription.ts` import nothing from `../db/`.
   - `sync.test.ts`: two users push overlapping ids; each pulls only its own rows. Push an
     older `updatedAt` over a newer row and assert the newer survives; push equal and assert
     no write. Assert the schema rejects any field other than `iv`/`ciphertext` plus routing.
   - `auth.test.ts`: boot without `JWT_SECRET` and with a 31-char secret and assert
     `buildApp` throws. Drive `/recover-finish` against a seeded user and assert the exact
     rows that change.
   - `subscription.test.ts`: assert the child-process env passed to the bridge has no
     `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `CODEX_API_KEY`.
   - `challengeToken.test.ts`, `passwordHash.test.ts`: pure-function tests for tamper,
     expiry, and constant-time compare (the `timingSafeEqual` call site, not timing).
4. **Resolve the two auth findings before writing their tests**, because a test codifies
   whichever behavior it asserts:
   - INV-29: `auth-architecture.md:111` says `wrapped_by_recovery_*` stays unchanged on
     re-enrollment; `routes/auth.ts:394-395` overwrites it from the request body; the
     comment at `auth.ts:343` says the hash is regenerated. Decide which is right, fix the
     other two, then test it.
   - INV-27: `architecture.md:50` calls the counter update "clone detection", but a stale or
     equal counter is accepted, not rejected. Either reject non-increasing counters or
     reword the architecture doc. Then test whichever was chosen.

## Scope and exclusions

Includes the harness, the tests for the rows in the table above, and the two doc/code
reconciliations in step 4. Excludes: the frontend, any change to relay or sync behavior
beyond step 4, load or timing tests, and WebAuthn ceremony tests against a real
authenticator (the `@simplewebauthn/server` verify calls are stubbed at the boundary).

## Unresolved choices

- **Database for route tests.** Options: (a) `@electric-sql/pglite` with `drizzle-orm/pglite`,
  an in-process Postgres needing no service (recommended; one dev dependency); (b) the Docker
  Postgres on port 5433 via `npm run docker:up`, requiring Docker in every environment that
  runs `test:all`; (c) a hand-written fake of the Drizzle query surface, which drifts.
  Jacob's development database is Neon, so (b) is not the default today.
- Whether `buildApp` should also own CORS origin and body-limit configuration (proposed yes,
  so tests exercise the same instance shape).

## Implementation steps

1. `buildApp` extraction + plugin-option database injection; verify `npm run dev:backend`
   still boots and `/health` answers.
2. Backend vitest config, `test` script, dev dependency; `sse.test.ts` still passes.
3. Pure-function tests (`challengeToken`, `passwordHash`), then `llm.test.ts`, then
   `subscription.test.ts`.
4. Database choice, then `sync.test.ts`.
5. Step 4 reconciliations, then `auth.test.ts`.
6. Update the register rows to `guarded` with the new test names; update
   `architecture.md` / `auth-architecture.md` where step 4 changed the doc.

## Acceptance criteria

- [ ] `cd backend && npm test` runs green with no network and no external service beyond the chosen database option.
- [ ] A deliberate `fastify.log.info(request.body)` or `db.insert(...)` added to `routes/llm.ts` fails at least one test.
- [ ] A deliberate removal of the `userId` predicate in `routes/sync.ts` fails a test.
- [ ] A deliberate `>=` → `>` flip in the LWW comparison fails a test.
- [ ] `buildApp` throws on a missing or short `JWT_SECRET`.
- [ ] INV-27 and INV-29 have one agreed behavior, one doc statement, one code path, and one test each.
- [ ] The invariant register rows listed above read `guarded` with resolvable test names.
- [ ] `npm run typecheck`, `npm run lint`, `npm run test:all` pass.

## Documentation updates

`docs/architecture/architecture.md` §"Backend" gains a sentence on `buildApp` and the test
entry point; the CLAUDE.md commands block gains `unit tests (backend): cd backend && npm test`.
Step 4 amends `architecture.md:50` or `routes/auth.ts`, and `auth-architecture.md:111` or
`routes/auth.ts:394-395`, whichever side is wrong. Register rows updated per step 6.

## Outcome

Populate when delivered.
