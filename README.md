# Claude Utils

A browser-based power toolkit for Claude users — search, analytics, export, conversation browser, prompt library, and a real-time activity tracker. Built with React + TypeScript. Local-first with an optional Fastify + Postgres backend.

**[Full docs and PRDs → PRD-AND-CLAUDE-MDs/](./PRD-AND-CLAUDE-MDs/README.md)**

---

## Features

- **Universal search** — Full-text search across Claude.ai and Claude Code conversations
- **Analytics dashboard** — Usage stats, token trends, activity heatmaps
- **Export** — Markdown, PDF, JSON, HTML
- **Conversation browser** — View conversations with syntax highlighting
- **Prompt library** — Save, organize, and reuse prompts
- **Activity tracker** — Chrome extension capturing real-time tokens, artifacts, and tool calls
- **AIPKMS** *(planned)* — Anchor insights, build knowledge threads, resurface context in future conversations

---

## Quick start

### Frontend only (no backend required)

```bash
npm install
npm run dev              # http://localhost:4000
```

Import your Claude data export (ZIP from claude.ai or JSONL from `~/.claude/`) and start searching.

### With backend (persistent storage + sync)

Requires Docker.

```bash
npm install
npm run docker:up        # Start Postgres on port 5433
npm run db:push          # Apply schema
npm run dev:all          # Frontend (4000) + backend (3003)
```

Create a `.env.local` at the root:

```bash
VITE_API_URL=http://localhost:3003/api
```

### Chrome extension (activity tracker)

```bash
npm run dev:extension    # Watches and rebuilds → dist-extension/
```

Then in Chrome: Settings → Extensions → Load unpacked → select `dist-extension/`.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Client storage | Dexie.js (IndexedDB) |
| Search | Fuse.js |
| Charts | Recharts |
| PDF export | jsPDF + html2canvas |
| Backend | Fastify 5, Drizzle ORM |
| Database | PostgreSQL 16 |
| Extension | Chrome Manifest V3 |

---

## Project structure

```
claude-utils/
├── src/                      # Frontend React app
├── extension/                # Chrome extension source
├── backend/                  # Fastify + Postgres API
├── PRD-AND-CLAUDE-MDs/       # All docs, PRDs, and agent instructions
├── CLAUDE.md                 # AI agent quick-start (points to PRD-AND-CLAUDE-MDs/)
├── docker-compose.yml        # Postgres + backend
└── package.json              # Root scripts
```

---

## Scripts reference

```bash
npm run dev              # Frontend dev server
npm run dev:backend      # Backend dev server
npm run dev:all          # Both servers
npm run dev:extension    # Extension build watcher

npm run build            # Frontend production build
npm run build:extension  # Extension build
npm run build:all        # Everything

npm run docker:up        # Start Postgres
npm run docker:down      # Stop Postgres
npm run db:push          # Apply DB schema
npm run db:studio        # Drizzle Studio GUI

npm run lint             # ESLint
npm run typecheck        # TypeScript check
```

---

## Documentation

All project documentation lives in `PRD-AND-CLAUDE-MDs/`:

| Doc | Purpose |
|---|---|
| [README.md](./PRD-AND-CLAUDE-MDs/README.md) | Docs index and architecture overview |
| [CLAUDE.md](./PRD-AND-CLAUDE-MDs/CLAUDE.md) | Full AI agent instructions |
| [claude-utils-prd.md](./PRD-AND-CLAUDE-MDs/claude-utils-prd.md) | Core platform PRD |
| [prd-aipkms.md](./PRD-AND-CLAUDE-MDs/prd-aipkms.md) | AIPKMS feature PRD |
| [claude-aipkms.md](./PRD-AND-CLAUDE-MDs/claude-aipkms.md) | AIPKMS vision doc |
| [PRD activity tracker.md](./PRD-AND-CLAUDE-MDs/PRD%20activity%20tracker.md) | Activity Tracker PRD |

---

## Business model

Freemium with a one-time purchase:

| Tier | Price | Highlights |
|---|---|---|
| Free | $0 | 100 search results, basic analytics, Markdown export, 10 prompts |
| Pro | $29 | Unlimited everything, all export formats |
| Power | $29+ | Pro + synthesis engine, auto-categorization, Obsidian export |
