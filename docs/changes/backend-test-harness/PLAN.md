# Backend test harness

Status: Completed — drafted and delivered 2026-09-09 (`8cd29d8` harness + relay/sync/util tests, `69e00c0` auth reconciliation + tests). Source: the [invariant register](../../assessments/invariant-register.md).
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

## Resolved choices

- **Database for route tests: `@electric-sql/pglite` 0.5.x via `drizzle-orm/pglite`** (in-process
  Postgres, no service). Neon stays the development/production database untouched; tests never
  reach it. Migrations are applied from `backend/drizzle/migrations` with the pglite migrator, so
  a new migration `0001_kind_varchar_32` was generated to bring the folder in line with the schema.
  The `bytea` custom type gained a `fromDriver` that normalizes PGlite's `Uint8Array` to `Buffer`.
- `buildApp` owns CORS, body limit, JWT registration, and route registration; `index.ts` only listens.
- Installing `vitest` into `backend/` needed `--legacy-peer-deps` (npm 10.9 arborist bug on vitest 4's
  optional peer set); recorded in case `npm ci` hits the same.

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

- [x] `cd backend && npm test` runs green with no network and no external service beyond the chosen database option.
- [x] A deliberate `app.log.info({ body: req.body })` in `routes/llm.ts` failed 9 of 16 relay tests (mutation check 1).
- [x] Removing the `userId` predicate from `/pull` failed 2 sync tests (mutation check 2).
- [x] Flipping `>=` to `>` in the LWW comparison failed 1 sync test (mutation check 3).
- [x] `buildApp` throws on a missing or short `JWT_SECRET` (`auth.test.ts::boot guard`).
- [x] INV-27 and INV-29 have one agreed behavior, one doc statement, one code path, and one test each (see Outcome).
- [x] The invariant register rows listed above read `guarded` with resolvable test names.
- [x] `npm run typecheck`, `npm run lint`, `npm run test:all` pass; `cd backend && npm run typecheck` (tests included) passes.

## Documentation updates

`docs/architecture/architecture.md` §"Backend" gains a sentence on `buildApp` and the test
entry point; the CLAUDE.md commands block gains `unit tests (backend): cd backend && npm test`.
Step 4 amends `architecture.md:50` or `routes/auth.ts`, and `auth-architecture.md:111` or
`routes/auth.ts:394-395`, whichever side is wrong. Register rows updated per step 6.

## Outcome

Delivered 2026-09-09.

**Shipped:** `backend/src/app.ts` (`buildApp`), database injected into `authRoutes`/`syncRoutes`
through plugin options, `backend/src/test/harness.ts` (PGlite + migrations + real app + log
capture + `seedUser`), backend `vitest.config.ts`, `test`/`typecheck` scripts, tests excluded from
the dist build via `tsconfig.json`/`tsconfig.test.json`. Tests: `utils/challengeToken.test.ts`,
`utils/passwordHash.test.ts`, `llm/subscription.test.ts`, `routes/llm.test.ts`,
`routes/sync.test.ts`, `routes/auth.test.ts`. 53 backend tests pass in about 5 s.

**Step 4 reconciliations.** INV-27: SimpleWebAuthn already throws on a non-increasing counter
(`verifyAuthenticationResponse.js:144-150`), so "clone detection" was implemented by the library
and the register's finding was wrong on that point; the route let the throw become a 500 and now
answers 401. INV-29: the documented behavior (recovery wrap and hash untouched) won; the route no
longer accepts a recovery wrap, the client no longer sends one, and the comment matches.

**Mutation checks** (each applied, the affected file's tests run, then reverted):

| # | Mutation | Result |
|---|---|---|
| 1 | `routes/llm.ts` logs `req.body` | 9 of 16 relay tests fail |
| 2 | `routes/sync.ts` `/pull` without the `userId` predicate | 2 of 10 sync tests fail |
| 3 | `routes/sync.ts` LWW `>=` → `>` | 1 of 10 sync tests fail |
| 4 | `routes/auth.ts` `/recover-finish` overwrites the recovery wrap again | 1 of 8 auth tests fail |
| 5 | `llm/subscription.ts` stops deleting `ANTHROPIC_API_KEY` | 1 of 3 bridge tests fail |

**Limitations.** The relay's "never persists" half is guarded by a source-text assertion (no
`/db/` or `drizzle-orm` import, no log call) plus the log capture, not by instrumenting the
database; a future write through some other module would need the same guard extended.
`/stream` is covered for one success and one provider-error path; client-abort mid-stream is
not. WebAuthn attestation/assertion verification is mocked at the library boundary, so the
ceremonies themselves are untested here. Drizzle-only/no-raw-SQL (INV-26) remains a policy row.
