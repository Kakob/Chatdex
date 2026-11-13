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

## Investigate research across documents and conversations

Open **Projects → Open / create MIT Investigations → Research sources & questions**.
The research shelf is also linked in every project header. It supports question-only
cases, text/Markdown exports, reference-only leads, pinned excerpts, human finding
revisions, and question lineage. **Open synthetic walkthrough** creates a separate
fabricated Fern Harbor example; it does not populate the MIT project with evidence.

The supplied [handoff](docs/changes/experience-inquiry/CODEX_HANDOFF_CHATDEX_INQUIRY.md)
and [walkthrough](docs/changes/experience-inquiry/WALKTHROUGH.md) are in the docs.
The private inventory is local at `research-data/mit/mit_research_sources.private.json`
and deliberately gitignored. Select it in **Private registry leads**, review the
preview, then register it. Source documents still require your exports.

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

Create `.env.local` from `.env.example` and `backend/.env` from `backend/.env.example`.
For a backend running on the host, use database port `5434`; the backend container
connects on PostgreSQL's internal port. Vite proxies `/api` to `DEV_API_TARGET`
(default `http://localhost:3003`). An existing absolute `VITE_API_URL` is used as
the proxy target when `DEV_API_TARGET` is unset. The browser always calls the
frontend origin during development, so a phone never contacts its own localhost.

## Mobile login and shared projects

Both devices must use the same Chatdex hostname, backend/database, and account.
The phone needs trusted HTTPS: `http://192.168.x.x:4002` cannot use passkeys.
Use a hostname rather than an IP address for the passkey relying-party ID.
See the [WebAuthn origin rules](https://www.w3.org/TR/webauthn-3/#rp-id).

For local development on a Mac and iPhone on the same network:

1. Find the Mac's local hostname with `scutil --get LocalHostName`. Use that name
   plus `.local` below (replace `your-mac.local`). It must resolve on both devices.
2. Install [mkcert](https://github.com/FiloSottile/mkcert#installation), then create
   a certificate for that hostname:

   ```bash
   mkcert -install
   mkdir -p .certs
   mkcert -cert-file .certs/chatdex.pem -key-file .certs/chatdex-key.pem your-mac.local
   ```

   Install mkcert's **public** `rootCA.pem` from the directory printed by
   `mkcert -CAROOT` on the phone and enable full trust for that certificate in
   iOS Certificate Trust Settings. Never transfer `rootCA-key.pem`. See
   [mkcert's mobile instructions](https://github.com/FiloSottile/mkcert#mobile-devices).
3. Set these values in the frontend's `.env.local`:

   ```dotenv
   VITE_API_URL=/api
   DEV_API_TARGET=http://localhost:3003
   DEV_HOSTNAME=your-mac.local
   DEV_HTTPS_CERT=.certs/chatdex.pem
   DEV_HTTPS_KEY=.certs/chatdex-key.pem
   ```

4. Set these values in `backend/.env`, keeping the existing database and JWT secret:

   ```dotenv
   CORS_ORIGIN=https://your-mac.local:4000
   WEBAUTHN_RP_ID=your-mac.local
   WEBAUTHN_ORIGIN=https://your-mac.local:4000
   ```

   These settings apply to `npm run dev:backend`. If running the backend in
   Docker instead, set the same values in that service's environment. Restart
   both servers. Vite uses a fixed port because passkey verification includes
   the port; to use `4002`, run `npm run dev -- --port 4002` and use `4002` in
   both backend origin values.
5. Open `https://your-mac.local:4000` on both devices. Enable cloud sync once,
   save the recovery code, then **Log in** with the same account and synced passkey
   on the other device. Wait for a successful sync on desktop; projects arriving
   on mobile appear automatically. A passkey provider supporting PRF is required
   to unlock the encrypted data.

**Existing localhost account:** passkeys are scoped to their original hostname.
Before switching addresses, sync your existing desktop data successfully and save
your recovery code (or export a backup from Settings if sync is not working).
Then configure the new hostname and use **Recover with code** there once to enroll
a replacement passkey for the same account. This replaces the old passkey. Log in
from both devices at the new address. Browser storage is also scoped to the origin:
projects that were never uploaded remain at the old address until backed up/imported.

For hosted use, configure the shared HTTPS deployment described above. Without
`VITE_API_URL`, production requests use same-origin `/api`, which the host must
route to the backend; otherwise set an absolute HTTPS API URL. The development
proxy and certificate settings do not apply to production builds.

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
