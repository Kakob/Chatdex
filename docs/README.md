# Chatdex — Docs Index

This folder is the **canonical home for all project documentation** (PRDs, vision docs, and AI coding instructions). If you're human or an AI agent, start here.

---

## Navigation

### For AI coding agents (Claude Code / Cursor)

- **[CLAUDE.md](../CLAUDE.md)** — primary instructions. Read this before working on any part of the codebase: tech stack, commands, structure, architecture invariants, conventions.

### Feature work

- **[tracks/](./tracks/)** — one folder per feature track, holding that track's spec, PRD, plan, build log and todos. **[tracks/README.md](./tracks/README.md)** carries the status table for every track and is the single place track status is recorded.

### Everything else

| Folder | What lives there |
|---|---|
| **[prds/](./prds/)** | Product-level PRDs spanning tracks: [core platform](./prds/chatdex-prd.md), [AIPKMS](./prds/prd-aipkms.md), [PatternMirror](./prds/PRD-patternmirror.md), [research contribution](./prds/PRD-research-contribution.md) |
| **[architecture/](./architecture/)** | [System architecture](./architecture/architecture.md) and [auth architecture](./architecture/auth-architecture.md) |
| **[territories/](./territories/)** | Territory guides — how one capability works end to end ([index](./territories/README.md)) |
| **[ownership/](./ownership/)** | The code-ownership loop: exercises, investigations, module notes, audit log ([index](./ownership/README.md)) |
| **[assessments/](./assessments/)** | Point-in-time repo reconnaissance ([current state](./assessments/chatdex-current-state-reconnaissance.md)) and `recon-screenshots/` |
| **[vision/](./vision/)** | Narrative vision: [AIPKMS](./vision/claude-aipkms.md), [toolkit → AIPKMS roadmap](./vision/roadmap-toolkit-to-aipkms.md) |
| **[archive/](./archive/)** | Superseded documents, kept for history — links inside are intentionally not maintained |

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
