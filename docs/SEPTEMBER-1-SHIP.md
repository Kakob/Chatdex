# Chatdex September 1 ship boundary

## Outcome

Ship an employer-legible public demo where a reviewer can understand Chatdex in under five minutes and inspect a real evidence chain without importing private data.

The product sentence:

> Chatdex turns project conversation history into evidence-backed current understanding and a bounded, implementation-ready change handoff.

## Golden path

Use the synthetic **Slop Connoisseur** workspace and the question:

> Should Slop Connoisseur use contestant-specific judging rather than one universal judge?

The reviewer should be able to verify:

1. **Investigate History** preserves the full source, literal search record, exact pinned spans, hashes, and explicit review coverage.
2. Findings are visibly human-authored, finalized, and explicitly promoted.
3. **Current Understanding** shows the accepted belief, decision, constraint, and unresolved aggregation question with source links.
4. **Prepare Change** carries only selected accepted understanding into outcome, rationale, constraints, non-goals, acceptance criteria, and open choices.
5. The ready Markdown/JSON handoff is deterministic and tells the implementation agent to inspect the repository and report deviations. Chatdex does not execute the change.

## Release boundary

### Must ship

- Frontend production build on a public HTTPS URL
- Deep-link fallback for project routes
- One-click privacy-safe sample workspace
- Responsive project workflow at desktop and narrow widths
- Clean first-run state with no fake sync, billing, or autonomous-action controls
- Passing typecheck, full test suite, frontend build, and backend build
- A short screen recording or GIF following the golden path
- Repository README with local and deployment instructions

### Explicitly defer

- Generated summaries or verdicts
- Semantic/vector search and scoring
- Repository cloning, writes, or deployment from Chatdex (read-only inspection through the GitHub API — Intent Trace — is allowed and stays read-only)
- New connectors, databases, or hosted services
- Generalized knowledge graphs or task management
- Reworking optional passkey sync unless a deployment already depends on it

## Deployment checklist

- [ ] Create a clean production build with `npm ci && npm run build`
- [ ] Deploy `dist/` as a static SPA using Node 20.19+ or 22.12+
- [ ] Open the public URL in a fresh browser profile
- [ ] Confirm `/projects` loads directly and after refresh
- [ ] Load the sample and open all three workflow destinations
- [ ] Confirm source-event deep links work
- [ ] Confirm the ready handoff preview renders and Markdown/JSON download works
- [ ] Test at approximately 390 px and 1440 px viewport widths
- [ ] Verify the browser console has no uncaught errors on the golden path
- [ ] Record a 60–90 second walkthrough
- [ ] Add the public URL and walkthrough to the repository and job materials

## Demo script (about 75 seconds)

1. “AI project history is abundant, but the reasoning needed for the next change is scattered.”
2. Load the sample workspace and open its question in **Investigate History**.
3. Show literal search, the source chronology, pinned evidence, and the human-authored findings.
4. Open **Current Understanding** and point to the accepted constraint plus unresolved aggregation choice.
5. Open **Prepare Change**, show acceptance criteria and non-goals, then copy or download the deterministic handoff.
6. Close with: “Chatdex stops before execution; it makes the reasoning and evidence legible enough for a person or coding agent to implement responsibly.”

## Job-application copy

**Portfolio description**

> Chatdex is a local-first evidence workspace that turns scattered AI project conversations into a reviewable Current Understanding and a deterministic implementation handoff. I designed the trust model so source hashes and locators are machine-enforced while conclusions remain human-authored or explicitly review-gated.

**Resume bullets**

- Built a React/TypeScript local-first workflow that traces project decisions from immutable conversation sources through exact evidence and human-reviewed findings to implementation-ready change briefs.
- Designed and tested provenance, append-only history, readiness validation, encrypted sync serialization, and deterministic Markdown/JSON export across a Dexie/Fastify/PostgreSQL architecture.
- Shipped a privacy-safe one-click product demo and narrowed a broad knowledge-management toolkit into a coherent three-stage workflow for an employer-facing release.

**Interview angle**

Lead with the product judgment, not the feature count: Chatdex separates evidence collection, accepted understanding, and implementation intent so an AI coding workflow can move quickly without silently inventing why a change should exist.

## Suggested remaining schedule

| Date | Focus |
|---|---|
| Aug 24–26 | Visual QA, accessibility pass, fix golden-path friction |
| Aug 27 | Deploy the frontend-only demo and verify deep links |
| Aug 28 | Record walkthrough, collect two rounds of feedback |
| Aug 29–30 | Fix only demo-blocking defects; freeze scope |
| Aug 31 | Clean-profile smoke test and application-material updates |
| Sep 1 | Publish and begin applications |
