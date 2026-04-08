Blockers (can't deploy without these)

  1. Frontend build fails — TypeScript errors in
  useConversationTags.ts, api.ts, api.test.ts, and test/setup.ts.
  Need to fix before anything else.
  2. Bookmarks → Anchors migration is half-done — 43 uncommitted
  changes with deleted bookmark files and new anchor files. This
  needs to be completed and committed.
  3. No database migrations — backend/drizzle/migrations/ is empty.
   The Dockerfile uses drizzle-kit push --force which is dangerous
  for production data.
  4. Dockerfile port mismatch — EXPOSE 3001 but everything else
  uses port 3003.
  5. Extension hardcoded to localhost — extension/background.ts and
   manifest.json both point to localhost:3003 / localhost:4000.

  Production readiness gaps

  6. No deployment config — No vercel.json, fly.toml, or CI/CD
  pipeline.
  7. No error boundaries — Uncaught errors will white-screen the
  app.
  8. No rate limiting on the backend, and the body limit is 100MB.
  9. No DB connection pooling — will exhaust connections under
  load.
  10. CORS fallback defaults to localhost:4000 if CORS_ORIGIN isn't
   set.

  Nice-to-haves

  11. License/payment system (LemonSqueezy) not integrated
  12. No backend API tests
  13. No 404 page
  14. Extension has no retry/offline logic if backend is down
