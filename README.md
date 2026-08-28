# Chatdex

Chatdex turns scattered project conversations into evidence-backed change intent.
It is a local-first React application with one primary workflow:

1. **Investigate History** — ask a project question, read the complete primary source, run literal search, pin exact evidence, and write findings.
2. **Current Understanding** — explicitly accept source-linked beliefs, decisions, constraints, consequences, and open questions.
3. **Prepare Change** — compile selected understanding into a bounded Markdown or JSON implementation handoff. Chatdex stops before execution.

The important trust boundary is intentional: source locators, hashes, review ranges, and append-only history are machine-managed; conclusions are human-authored or visibly review-gated.

## Try the complete demo

```bash
npm ci
npm run dev
```

Open [http://localhost:4000](http://localhost:4000), choose **Load sample workspace**, and follow the clearly labeled synthetic **Slop Connoisseur** project.

The sample is privacy-safe and uses the same persistence and domain services as imported data. It arrives with a completed investigation and a ready Prepared Change so the complete chain is inspectable immediately:

```text
immutable source → exact evidence → human finding → accepted understanding → deterministic handoff
```

You can also create a project, import a ChatGPT/Claude/Claude Code export, attach the conversation as a project source, and start a new question-first investigation.

## What is implemented

- Project-scoped workspace with exactly three primary destinations
- Import and full-source browsing across supported conversation formats
- Literal global and in-investigation search
- Immutable raw-source retention and SHA-256 evidence integrity
- Question-first and code-anchor investigations
- Exact transcript/code exhibits and explicitly confirmed review coverage
- Human-authored findings with explicit finalization and promotion
- Current Understanding with evidence navigation, review, and temporal history
- Prepared Change drafts, readiness validation, and deterministic Markdown/JSON export
- Local-first IndexedDB persistence; optional end-to-end encrypted sync
- A privacy-safe, one-click portfolio demo

Generated verdicts, semantic ranking, repository mutation, autonomous implementation, and task management are intentionally outside this shipping slice.

## Verification

```bash
npm run typecheck
npm test
npm run build:all
```

The source layer uses React 19, TypeScript, Vite, Tailwind CSS, Zustand, and Dexie. The optional service uses Fastify, Drizzle, PostgreSQL, WebAuthn, and opaque encrypted sync records.

## Deploy the portfolio demo

The fastest public deployment is frontend-only. It needs no database, API key, or user account: data remains in each visitor’s IndexedDB, and the synthetic sample makes the product legible on first visit.

Use any static host with:

| Setting | Value |
|---|---|
| Install | `npm ci` |
| Build | `npm run build` |
| Output | `dist` |
| Node | 20.19+ or 22.12+ |

SPA fallback files are included for Vercel and hosts that support `_redirects`, so deep links such as `/projects/:id/investigate` resolve to `index.html`. They follow the current [Vercel Vite SPA](https://vercel.com/docs/frameworks/frontend/vite) and [Netlify SPA rewrite](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/#history-pushstate-and-single-page-apps) guidance; Vite’s default production output is documented in its [static deployment guide](https://vite.dev/guide/static-deploy).

For a deployment with encrypted cross-device sync, set:

```bash
VITE_API_URL=https://api.example.com/api
```

and deploy `backend/` with PostgreSQL plus:

```bash
DATABASE_URL=postgresql://...
CORS_ORIGIN=https://chatdex.example.com
WEBAUTHN_RP_ID=chatdex.example.com
WEBAUTHN_ORIGIN=https://chatdex.example.com
```

The frontend-only deployment is the recommended portfolio scope. The optional backend should not block the public product story.

## Local development with sync

```bash
npm ci
npm ci --prefix backend
npm run docker:up
npm run db:push
npm run dev:all
```

Create `.env.local` from `.env.example`. Docker exposes PostgreSQL on host port `5434`; the backend container connects on its internal port.

## Repository map

```text
src/pages/                         workflow surfaces
src/lib/investigation/             evidence and finding invariants
src/lib/understanding/             current-understanding assembly/history
src/lib/prepare/                   Prepared Change validation/export
src/lib/demo/                      privacy-safe sample workspace
src/lib/db/                        local-first data model
src/lib/sync/                      encrypted replication
backend/                           optional auth/sync/LLM relay service
docs/                              product specifications and build history
```

See [docs/README.md](./docs/README.md) for the current specs and build logs.
