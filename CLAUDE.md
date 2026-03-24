# Claude Utils — AI Agent Instructions

> For the full, detailed instructions read **[PRD-AND-CLAUDE-MDs/CLAUDE.md](./PRD-AND-CLAUDE-MDs/CLAUDE.md)**.
> For the docs index (PRDs, vision, architecture) read **[PRD-AND-CLAUDE-MDs/README.md](./PRD-AND-CLAUDE-MDs/README.md)**.

---

## Project in one sentence

Claude Utils is a browser-based power toolkit for Claude users — search, analytics, export, conversation browser, prompt library, and a real-time activity tracker — with a planned AIPKMS (AI-Powered Knowledge Management System) feature layer.

## Architecture overview

- **Frontend** (`src/`): React 18 + TypeScript + Vite, port 4000. Local-first; uses Dexie.js (IndexedDB) for storage and calls backend when available.
- **Extension** (`extension/`): Chrome extension (Manifest V3) — content script, background service worker, injected page script.
- **Backend** (`backend/`): Optional Fastify + Postgres API on port 3003. Currently handles persistence/sync; planned for auth and AIPKMS AI features.

## Essential commands

```bash
# Development
npm run dev              # Frontend only → http://localhost:4000
npm run dev:backend      # Backend only  → http://localhost:3003
npm run dev:all          # Both servers concurrently
npm run dev:extension    # Extension build watcher

# Docker / database
npm run docker:up        # Start Postgres (port 5433)
npm run docker:down      # Stop Postgres
npm run db:push          # Apply schema to running DB
npm run db:studio        # Drizzle Studio (DB GUI)

# Build
npm run build            # Frontend production build → dist/
npm run build:extension  # Extension build → dist-extension/
npm run build:all        # Everything

# Quality
npm run lint             # ESLint
npm run lint:fix         # ESLint auto-fix
npm run typecheck        # TypeScript check
```

## Key files at a glance

| File | Purpose |
|---|---|
| `src/lib/api.ts` | Backend API client (all REST calls) |
| `src/lib/db.ts` | Dexie.js IndexedDB schema |
| `src/lib/parsers/` | Claude.ai + Claude Code parsers |
| `src/types/unified.ts` | Core shared TypeScript interfaces |
| `src/stores/appStore.ts` | Global Zustand state |
| `backend/src/db/schema.ts` | Postgres/Drizzle schema |
| `backend/src/index.ts` | Fastify server entry |
| `extension/background.ts` | Extension background service worker |
| `extension/content-script.ts` | Content script (injected into claude.ai) |

## Environment

```bash
# .env.local (frontend, not committed)
VITE_API_URL=http://localhost:3003/api
VITE_LICENSE_SECRET=your-hmac-secret

# backend/.env (not committed — see backend/.env.example)
DATABASE_URL=postgresql://claude_utils:dev_password@localhost:5432/claude_utils
PORT=3003
CORS_ORIGIN=http://localhost:4000
```

---

For full context — tech stack, feature list, coding conventions, common task recipes — see **[PRD-AND-CLAUDE-MDs/CLAUDE.md](./PRD-AND-CLAUDE-MDs/CLAUDE.md)**.
