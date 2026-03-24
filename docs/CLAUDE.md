# CLAUDE.md

> Instructions for Claude Code when working on this project

## Project Overview

**Claude Utils** — A browser-based power toolkit for Claude users. Search, analytics, export, conversation browser, prompt library, and a real-time activity tracker. Local-first by design: the core web app stores data in IndexedDB (Dexie.js) and requires no backend for basic usage.

**Architecture**: Three independently deployable pieces:
1. **Frontend webapp** (`src/`) — React 18 + Vite, port 4000. Standalone; uses IndexedDB when no backend is available.
2. **Chrome extension** (`extension/`) — injects into claude.ai to capture real-time activity (tokens, artifacts, tool calls). Manifest V3.
3. **Backend** (`backend/`) — optional Fastify + Postgres API, port 3003. Currently provides persistent cross-device storage and sync; planned for auth and AIPKMS AI features (auto-categorization, synthesis, embeddings).

**Business model**: Freemium with $29 one-time Pro tier.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 18 + TypeScript |
| Build | Vite |
| Routing | React Router v6 |
| State | Zustand |
| Storage | Dexie.js (IndexedDB) |
| Search | Fuse.js |
| Charts | Recharts |
| PDF | jsPDF + html2canvas |
| ZIP | JSZip |
| Styling | Tailwind CSS |
| Icons | Lucide React |

## Key Commands

```bash
# Development
npm run dev              # Frontend dev server → http://localhost:4000
npm run dev:backend      # Backend dev server → http://localhost:3003
npm run dev:all          # Both concurrently (requires Postgres running)
npm run dev:extension    # Extension build watcher → dist-extension/

# Build
npm run build            # Frontend production build → dist/
npm run build:extension  # Extension build → dist-extension/
npm run build:all        # Frontend + extension + backend

# Preview
npm run preview          # Preview frontend production build

# Docker / database
npm run docker:up        # Start Postgres (port 5433)
npm run docker:down      # Stop Postgres
npm run docker:logs      # Tail Docker logs
npm run db:push          # Apply Drizzle schema to running DB
npm run db:studio        # Drizzle Studio — DB GUI

# Quality
npm run lint             # ESLint check
npm run lint:fix         # ESLint auto-fix
npm run typecheck        # TypeScript check (no emit)
```

## Project Structure

```
claude-utils/
├── src/                         # Frontend web app (React 18 + Vite)
│   ├── components/
│   │   ├── common/              # Shared UI components
│   │   ├── layout/              # App shell, sidebar, header
│   │   ├── search/              # Search bar, results, filters
│   │   ├── analytics/           # Charts, stats cards
│   │   ├── conversations/       # List, detail view, messages
│   │   ├── export/              # Export modal, format options
│   │   ├── prompts/             # Prompt library UI
│   │   ├── import/              # Upload zone, progress
│   │   └── settings/            # Settings, license, data mgmt
│   ├── hooks/                   # Custom React hooks
│   ├── lib/
│   │   ├── api.ts               # Backend REST client
│   │   ├── db.ts                # Dexie IndexedDB schema
│   │   ├── search.ts            # Fuse.js setup
│   │   ├── analytics.ts         # Stats computation
│   │   ├── license.ts           # License validation
│   │   ├── parsers/             # claude-ai.ts, claude-code.ts
│   │   ├── exporters/           # markdown.ts, pdf.ts, etc.
│   │   └── utils/               # Helpers
│   ├── pages/                   # Route components
│   ├── stores/                  # Zustand stores
│   ├── types/                   # TypeScript interfaces
│   ├── App.tsx
│   └── main.tsx
│
├── extension/                   # Chrome extension (Manifest V3)
│   ├── background.ts            # Service worker
│   ├── content-script.ts        # Injected into claude.ai
│   ├── injected.ts              # Runs in page context (fetch interception)
│   ├── webapp-sync.ts           # Syncs captured data to backend
│   └── manifest.json
│
├── backend/                     # Optional Fastify + Postgres API
│   └── src/
│       ├── db/
│       │   ├── schema.ts        # Drizzle ORM schema
│       │   └── index.ts         # DB connection
│       └── routes/              # conversations, messages, activities, stats, import…
│
├── PRD-AND-CLAUDE-MDs/          # All project documentation ← you are here
├── docker-compose.yml           # Postgres + backend for local dev
├── vite.config.ts               # Frontend Vite config
├── vite.config.extension.ts     # Extension Vite config
└── package.json                 # Root scripts (runs frontend + delegates to backend)
```

## Data Sources

### Claude.ai Export
- ZIP file from Settings → Privacy → Export Data
- Contains `conversations.json`
- Structure: `{ conversations: [{ uuid, name, chat_messages }] }`

### Claude Code Logs
- JSONL files in `~/.claude/projects/<project>/`
- One JSON object per line
- Types: `user`, `assistant`, `system`, `tool_use`, `tool_result`

## Core Features

1. **Search** — Full-text across all conversations (Fuse.js + Postgres full-text)
2. **Analytics** — Usage stats, charts, trends (Recharts)
3. **Export** — Markdown, PDF, JSON, HTML (jsPDF)
4. **Prompts** — Save, organize, reuse prompts
5. **Browser** — View conversations with syntax highlighting
6. **Import** — Parse both data formats; store in IndexedDB or Postgres
7. **Activity Tracker** — Chrome extension capturing real-time tokens, artifacts, tool calls
8. **AIPKMS** *(planned)* — Anchor, thread, resurface, synthesize knowledge from conversations

## Free vs Pro Limits

| Feature | Free | Pro ($29) |
|---------|------|-----------|
| Search | 100 convos | Unlimited |
| Analytics | Basic stats | Full dashboard |
| Export | Markdown only | All formats |
| Prompts | 10 | Unlimited |
| AIPKMS anchors | 20 | Unlimited |
| AIPKMS synthesis | — | Included (Power tier) |

## Architecture Decisions

1. **Local-first** — Core features work in-browser with IndexedDB; backend is additive, not required
2. **IndexedDB (Dexie.js)** — Primary client-side storage; handles large datasets without a server
3. **Optional backend (Fastify + Postgres)** — Used when available for persistence/sync; planned home for auth, AIPKMS AI features (embeddings, synthesis), and cross-device usage
4. **Unified data model** — Both claude.ai and Claude Code data normalized with a `source` field
5. **Web Workers** — For search/import on large datasets (non-blocking UI)
6. **License keys** — Simple HMAC validation; no server auth required for current tiers
7. **Extension (Manifest V3)** — Background service worker + content script + page-context injected script for fetch interception

## Common Tasks

### Adding a new parser
1. Create `src/lib/parsers/<source>.ts`
2. Export `parse(content: string): Conversation[]`
3. Add format detection in `src/lib/parsers/index.ts`
4. Update types in `src/types/`

### Adding a new exporter
1. Create `src/lib/exporters/<format>.ts`
2. Export `export(conversation: Conversation): Blob | string`
3. Add to format selector in `src/components/export/`

### Updating the IndexedDB schema (frontend)
1. Increment version in `src/lib/db.ts`
2. Add migration in `.upgrade()`
3. Update interfaces in `src/types/unified.ts`

### Updating the Postgres schema (backend)
1. Edit `backend/src/db/schema.ts`
2. Run `npm run db:push` (dev) or generate + run a migration
3. Update Zod schemas in affected route files

### Adding a new backend route
1. Create `backend/src/routes/<feature>.ts`
2. Register in `backend/src/index.ts`
3. Add corresponding API method in `src/lib/api.ts`

### Adding a new analytics metric
1. Add computation in `src/lib/analytics.ts`
2. Add to stats recomputation on import
3. Create display component in `src/components/analytics/`

## Performance Guidelines

- Use `react-window` for lists > 100 items
- Debounce search input (300ms)
- Lazy load conversation messages
- Code split routes with `React.lazy`
- Consider Web Worker for heavy computation

## Styling Guidelines

- Use Tailwind utilities, avoid custom CSS
- Dark mode: use `dark:` variants
- Colors: purple primary (`violet-500`/`violet-600`)
- Spacing: consistent with Tailwind scale
- Components: keep under 150 lines

## Code Style

- Functional components with hooks
- Named exports (not default)
- Types in separate files
- Explicit return types on functions
- Descriptive variable names
- Comments for non-obvious logic

## Testing Approach

- Manual testing with real exports
- Test data in `test-data/` (gitignored)
- Test scenarios:
  - Small export (10 conversations)
  - Large export (1000+ conversations)
  - Malformed/incomplete data
  - Both sources combined

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/api.ts` | Backend REST client — all HTTP calls |
| `src/lib/db.ts` | Dexie IndexedDB schema |
| `src/lib/parsers/index.ts` | Format detection, routing |
| `src/lib/search.ts` | Fuse.js configuration |
| `src/stores/appStore.ts` | Global Zustand state |
| `src/types/unified.ts` | Core data interfaces |
| `backend/src/db/schema.ts` | Drizzle/Postgres schema |
| `backend/src/index.ts` | Fastify server + route registration |
| `extension/background.ts` | Extension service worker |
| `extension/content-script.ts` | DOM monitor + fetch capture (claude.ai) |

## Environment Variables

```bash
# .env.local (frontend, not committed)
VITE_API_URL=http://localhost:3003/api   # Backend URL (optional; falls back to IndexedDB)
VITE_LICENSE_SECRET=your-hmac-secret     # For license validation

# backend/.env (not committed — see backend/.env.example)
DATABASE_URL=postgresql://claude_utils:dev_password@localhost:5432/claude_utils
PORT=3003
CORS_ORIGIN=http://localhost:4000
```

## Deployment

Frontend deployed to Vercel. Push to `main` triggers deploy.

```bash
npx vercel --prod  # Manual deploy (frontend)
```

Backend can be deployed to Fly.io, Railway, or any Postgres-compatible host. Set `DATABASE_URL`, `PORT`, and `CORS_ORIGIN` env vars.

## Useful Links

### Project docs (in this repo)
- [Docs index](./README.md) — Start here for all docs
- [Core product PRD](./claude-utils-prd.md) — Search, analytics, export, etc.
- [AIPKMS PRD](./prd-aipkms.md) — Anchor, threads, resurfacing, synthesis
- [AIPKMS vision](./claude-aipkms.md) — The "why" and compounding value story
- [Activity Tracker PRD](./PRD%20activity%20tracker.md) — Real-time extension PRD
- [Activity Tracker impl guide](./Claude%20activity%20tracker.md) — Technical implementation

### External libraries
- [Dexie.js docs](https://dexie.org/)
- [Fuse.js docs](https://fusejs.io/)
- [Recharts docs](https://recharts.org/)
- [Tailwind docs](https://tailwindcss.com/)
- [Drizzle ORM docs](https://orm.drizzle.team/)
- [Fastify docs](https://fastify.dev/)
- [LemonSqueezy](https://lemonsqueezy.com/) — Payment processing

## Current Phase

See the [Docs index](./README.md) for phase status and the PRDs for detailed requirements.

Tag GitHub Issues with:
- `bug` — Something broken
- `feature` — New functionality
- `parser` — Data format related
- `search` — Search functionality
- `analytics` — Stats and charts
- `export` — Export functionality
- `extension` — Chrome extension / activity tracker
- `aipkms` — Knowledge management features
- `backend` — Fastify/Postgres API
- `ui` — Visual/UX
- `perf` — Performance

## Quick Reference: Data Flow

### Import flow (file upload)
```
User uploads file
    ↓
Format detection (parsers/index.ts)
    ↓
Parse to unified format (parsers/claude-ai.ts or claude-code.ts)
    ↓
POST /api/import  →  Postgres (backend)
    ↓ (also)
Store in IndexedDB (lib/db.ts) — local fallback
    ↓
Build search index (lib/search.ts)
    ↓
Compute analytics (lib/analytics.ts)
    ↓
Ready for use
```

### Extension activity capture flow
```
User sends message on claude.ai
    ↓
injected.ts intercepts fetch → dispatches custom event
    ↓
content-script.ts receives event → chrome.runtime.sendMessage
    ↓
background.ts aggregates + saves to extension storage
    ↓
webapp-sync.ts POSTs to POST /api/activities (backend)
    ↓
Available in Analytics / Activity Timeline
```
