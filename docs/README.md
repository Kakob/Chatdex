# Claude Utils — Docs Index

This folder is the **canonical home for all project documentation** (PRDs, vision docs, and AI coding instructions). If you're human or an AI agent, start here.

---

## Navigation

### For AI Coding Agents (Claude Code / Cursor)

- **[CLAUDE.md](./CLAUDE.md)** — Primary instructions for AI agents. Read this before working on any part of the codebase. Covers tech stack, commands, project structure, architecture, and coding conventions.

### Product Requirements

| Document | What it covers | Status |
|---|---|---|
| **[claude-utils-prd.md](./claude-utils-prd.md)** | Core platform PRD: search, analytics, export, conversation browser, prompt library | Source of truth |
| **[prd-aipkms.md](./prd-aipkms.md)** | AIPKMS feature PRD: anchoring, threads, resurfacing, synthesis, workspaces | Source of truth |
| **[PRD activity tracker.md](./PRD%20activity%20tracker.md)** | Activity Tracker PRD: real-time timeline, token usage, artifact capture | Source of truth |

### Vision & Background

| Document | What it covers |
|---|---|
| **[claude-aipkms.md](./claude-aipkms.md)** | Narrative vision for AIPKMS — the "why" and compounding value story |
| **[Claude activity tracker.md](./Claude%20activity%20tracker.md)** | Technical implementation guide for the Activity Tracker browser extension |

---

## How the features relate

```
Activity Tracker          AIPKMS
─────────────────         ────────────────────────────────────────
Captures everything   →   User curates what matters
Real-time telemetry   →   Anchored knowledge artifacts
Timeline / history    →   Threads, workspaces, synthesis
"What happened?"      →   "What should I keep and resurface?"
```

**Activity Tracker** = passive capture layer. Records every Claude interaction as it happens: messages, tokens, artifacts, tool calls.

**AIPKMS** = active curation layer. User deliberately anchors the exchanges that matter, organizes them into threads and workspaces, and resurfaces them in future conversations. AIPKMS is built on top of the conversation store (and optionally the activity data) already in the system.

---

## Architecture at a glance

```
Browser (webapp at port 4000)
│
├── src/                   React 18 + TypeScript + Vite
│   ├── components/        UI components
│   ├── lib/               Parsers, exporters, API client
│   ├── stores/            Zustand state
│   └── types/             Shared TypeScript interfaces
│
├── extension/             Chrome extension (content-script, background, injected)
│   └── dist-extension/    Built output (load unpacked in Chrome)
│
└── backend/               Optional Fastify + Postgres API (port 3003)
    └── src/
        ├── routes/        REST endpoints
        └── db/            Drizzle ORM schema + migrations
```

The **frontend is local-first** — it works as a standalone web app that stores data in IndexedDB (Dexie.js). The **backend is optional today** (used for persistence/sync) and is the intended platform for future auth and AIPKMS AI features (auto-categorization, synthesis, embeddings).

---

## Quick start

```bash
# Frontend only (no backend required)
npm run dev                  # http://localhost:4000

# Frontend + backend
npm run docker:up            # Postgres on port 5433
npm run db:push              # Apply schema
npm run dev:all              # Both servers

# Extension dev
npm run dev:extension        # Watches and rebuilds dist-extension/
```

---

## Current development phase

Check the PRDs for phase status. Rough order of priority:

1. Core webapp (search, analytics, export, conversations) — **in progress**
2. Activity Tracker browser extension — **in progress**
3. AIPKMS — **planned** (Phase 1: anchor & annotate)
