# Codex handoff — Chatdex: investigable experience pilot

**Prepared:** 2026-10-17  
**Target:** `Kakob/Chatdex`; inspect the local checkout and active branch first. The reviewed branch was `feature/project-workspace-golden-path` (default repository branch is `main`). Do not assume the local checkout matches either.  
**Companion input:** `mit_research_sources.private.json` — a private *source registry seed*, not source content and not authorization to fetch accounts. Keep it outside Git.

## Mission

Make Chatdex ready for one **human-led, source-grounded investigation of lived experience** that also tests a reusable method for other investigations (software, hardware, humanities). The first case is: **“How has my question about MIT, and my method for investigating it, evolved from 2019 through 2026?”** The user will determine interpretations and conclusions. Do not presume an overall “good vs. bad MIT,” employment, nostalgia, institutional agency, or community-design thesis.

**Definition of done:** In the running local app, the user can create a question-first case *without requiring a single primary conversation*, attach multiple different source kinds, inspect and pin exact excerpts, preserve source and event dates separately, link two or more historical formulations of a question with reviewable evidence, write or revise their own finding, and export an inspectable private research packet. The workflow is useful even if no AI inference is available and even if only 2–3 source exports are locally present.

**Do not write a documentary script, synthesize the user's identity or motives, or auto-interpret their personal history.** Provide an investigation workspace, not an AI therapist or narrator.

## Repository context already observed (reverify locally)

On `feature/project-workspace-golden-path`:

- `README.md` describes **Investigate History → Current Understanding → Prepare Change**. Reuse these destinations and relationships; do not build a second app.
- `src/pages/InvestigatePage.tsx` and `src/pages/QuestionInvestigationPage.tsx` support question-first investigation, but starting a case currently requires an **accepted project conversation** and `InvestigationCase.conversationId`.
- `src/types/investigation.ts`: `CaseExhibit` supports transcript/code/tool events tied to a conversation; `InvestigationFinding` has reviewable, human-authored findings. `src/lib/investigation/cases.ts` enforces source-span validation.
- `src/types/understanding.ts`: accepted/review-gated `UnderstandingObject` and append-only `UnderstandingEvent` already represent questions, contradictions, revisions, and provenance. Prefer extending them rather than inventing a competing canonical-knowledge system.
- `src/lib/parsers/index.ts` already sniffs **ChatGPT** and Claude ZIP/JSON exports; `src/lib/import.ts` preserves raw conversation payloads using content hashes. `src/pages/ImportPage.tsx` currently advertises Claude formats although code supports ChatGPT—verify/fix misleading UI copy as part of import readiness.
- `src/lib/db/schema.ts` uses local-first Dexie; `src/lib/db/rawSources.ts` keeps raw conversation payloads local-only. `src/types/unified.ts` defines conversation providers, not general archival documents.
- `src/types/preparedChange.ts` already has evidence-linked software-change preparation. Preserve it; do not force every research finding to become a software change.
- `CLAUDE.md`, `docs/capabilities/decision-investigation/SPEC.md`, `docs/capabilities/understanding-workspace/PRD.md`, and `docs/changes/README.md` govern trust boundaries and change-package workflow. Read them before editing. In particular, Decision Investigation is intentionally human-led and LLM-free; its established behavior must not regress.

Source code links for orientation (not authoritative versus local HEAD):
- https://github.com/Kakob/Chatdex/blob/feature/project-workspace-golden-path/src/pages/QuestionInvestigationPage.tsx
- https://github.com/Kakob/Chatdex/blob/feature/project-workspace-golden-path/src/types/investigation.ts
- https://github.com/Kakob/Chatdex/blob/feature/project-workspace-golden-path/src/types/understanding.ts
- https://github.com/Kakob/Chatdex/blob/feature/project-workspace-golden-path/src/lib/parsers/index.ts

## Required behavior / product boundaries

1. **Keep sources distinct from claims.** Importing or linking a document establishes the existence of a source, not the truth of its assertions. Memories/recollections, contemporary documents, interviews, institutional statements, published media, AI outputs, and analyst hypotheses retain different provenance. No generic “verified truth” badges derived from an LLM.
2. **Preserve two clocks.** Distinguish `source_created_at` / authored date, `event_time` or period discussed (if supported), and `imported_at` / analysis time. Unknown or approximate times stay explicit; never silently substitute import time for occurrence time.
3. **Evidence must be recoverable.** A pinned quote resolves to a specific immutable snapshot, exact text span (or video timestamp/manual locator), and content hash. If a document changes after import, create a new version and keep prior exhibits anchored to the earlier version. URL-only references must visibly say “reference only / content not imported.”
4. **Separate who said it from who believes it.** Imported assistant text is an assistant statement, not automatically the user's belief. Later recollections are not transformed into contemporary records. Maintain source attribution for documents that speak on behalf of a group.
5. **Human judgment is authoritative.** Suggestions, if eventually added, are opt-in review proposals. Do not produce auto-finalized findings, automatically declare causal links, or infer lack of evidence from limited search coverage.
6. **Private by default.** Imported personal source bytes stay local-only unless an existing encrypted sync contract explicitly governs derived metadata. Do not place source text, source link manifest, email addresses, private URLs, identifiable material, or real excerpts in git, test fixtures, console logs, telemetry, server plaintext, or public demos. Respect existing encryption/disclosure requirements. No automatic Gmail/Drive/YouTube fetch or scraping; register links until the user explicitly supplies exports or an authorized integration exists.
7. **No destructive changes.** No dropping/migrating away old sources/cases, no clearing real IndexedDB data, no silently changing existing case semantics, no rewriting unrelated features. Create backup/export safeguards and backwards-compatible Dexie migrations.

## Implement in small deliverable stages

### Stage 0 — reconnaissance and plan

Inspect local branch/working tree, existing tests, routing, import flows, schema and sync registration, and active changes (especially any `decision-authoring-evidence` overlap). Run baseline `npm run typecheck`, `npm test`, and `npm run build:all` (report pre-existing failures honestly). Create a bounded plan at `docs/changes/experience-inquiry/PLAN.md`, identify owners/contracts and design the smallest additive data migration. Do **not** commit private manifest or personal data. Do not switch branches or overwrite local work without user approval.

### Stage 1 — a local-first *research source shelf*

Implement a first-class research source distinct from `StoredConversation`, with metadata such as: stable ID, project associations, source kind, title, authorship/attribution when known, original URI, source-created time + precision, described-event time/range + precision, access state, imported time, privacy classification, and versioned snapshot details. Data model shape is up to you; maintain verifiable stable locators.

Minimum source handling:

- Existing ChatGPT/Claude/Claude Code conversations remain ingestible as before. Make ChatGPT ZIP/JSON explicitly discoverable in the Import UI; verify with existing parser tests.
- Add **user-selected `.txt` and `.md` import** for documentary sources (including Google Docs text/Markdown exports). Preserve original text exactly and hash the import; do not coerce it into fake chat messages.
- Add **external reference-only sources** with URL, title, type, source date, notes, and optional timestamp/page/section locator. This covers Gmail/Google Docs/YouTube links before authorized content is imported. Reference-only content is not full-text searchable, not evidence of the linked page's contents, and cannot yield a verified exact quote.
- If small and reliable, support `.eml` and text PDFs as follow-on importers. If not, give a clear user conversion path and label this limitation; do not ship a fragile parser or OCR in the initial milestone. For video, permit a reference with timestamps; no video downloads required.
- Support repeat imports idempotently, changed-file versions without destroying old citations, readable import errors, and an import preview showing what will be stored and whether it remains local.

Include an **import/reference registration path for `mit_research_sources.private.json`** if straightforward. If not, supply a clear manual source-registration walkthrough. Never fetch URLs merely because the manifest lists them. Never commit the private file.

### Stage 2 — cross-source question-first investigations

Extend the existing project Investigate UI so a case can start from a question alone and link any number of accepted project sources and conversations. Preserve historical anchored cases. Do not rely on the existing `conversationId` as the only source locator; use an additive linkage or carefully backward-compatible discriminated case type.

Within a case, allow:

- attach/remove a source *reference* without deleting the underlying source;
- open original text or conversation and pin exact spans with source version, offsets/hash, title, and human notes; for videos/link-only entries permit manually labeled unverified locator notes, never pretending the text was ingested;
- search within imported source text and associated conversations; show searched scope and misses without implying exhaustive coverage;
- organize exhibits into a small evidence board;
- write human-authored findings and questions, optionally label something as observed statement, participant account, interpretation, or unresolved; do not auto-promote quotes into causal facts;
- reopen and revise a finding without destroying previous versions, and navigate from finding back to its source excerpt;
- export a case as Markdown and JSON with inspectable locators, explicit uncertainty, source inventory, and a privacy/redaction preview. **Default export should omit raw source bodies and private URLs unless explicitly selected.**

Use existing review/finalization infrastructure where possible. Ensure broken/missing local source snapshots display “source unavailable” instead of substituting another document.

### Stage 3 — *question lineage* (the differentiating feature)

Build a focused view in the same project workspace that traces how a question changes across years. Reuse `UnderstandingObject(type='question')` + `UnderstandingEvent` if it satisfies provenance and history; add a small explicit relation model only for relationships that existing events cannot represent.

Required relations: **rephrased/refined, narrowed, branched, challenged, merged/combined, superseded**. Questions can fork and recombine; do not enforce one linear chain. Each node is the user's exact wording when available, with an author/role and source text pointer. Every relation must have a human-authored explanation or explicit user acceptance, may remain tentative, and must be reversible/correctable with history preserved. A model-generated suggestion is never silently adopted.

UX: a compact chronological lineage/branch view (not a giant physics graph); selecting a node shows the original message/document passage, a date, and why the link was made. It should be easy to compare two versions side by side and open an investigation from either. Preserve both `when the question was expressed` and `when this relation was added`.

**Pilot lineage:** Link a passage from the Spring 2019 ANT paper about studying the making of one's own account to an actual passage from 2026 MIT investigation conversations/draft *only after the user inspects and accepts the relation*. These are research leads, not a pre-authorized interpretive claim.

### Stage 4 — ready-to-use research workspace and handoff

A local workspace named **MIT Investigations** should be creatable/seedable with the *registry*, not somebody's private document contents or finalized conclusions. Provide a short local walkthrough plus a **synthetic, privacy-safe fixture** demonstrating the end-to-end workflow, with filenames/people/text fabricated and clearly marked synthetic.

Have the UI present the starting case: **“How has my question about MIT, and my method for investigating it, changed?”** as an editable suggested title, without creating findings automatically. Include a second optional case: “How was Steer Roast 2016 coordinated across people, places, and organizations?”

Link the actual user's content only if the user has provided local exports or authenticated access explicitly available to the coding environment. If files/permissions are missing, show `reference-only / import needed` and make the app usable with the available subset; do not claim ingestion succeeded.

## Source preparation / user data

The companion manifest lists initial leads, including:

- Spring 2019 CMS.614 ANT paper (*They (cannot) look at Themselves*);
- October 2026 *The Beast Learns How Things Happen* script;
- May 2017 Senior House turnaround proposal;
- user-provided ChatGPT export containing evolving questions;
- Feb–Mar 2016 academic-support/study-group correspondence;
- March 2016 Milk Bar planning correspondence;
- 2016 Steer Roast video;
- other personal recollections and records when explicitly added.

**Do not assume the manifest entries' claimed dates or summaries constitute imported source evidence.** They are navigation leads. Preserve document provenance, distinguish user recollection from contemporary documentation, and never alter the original Google Docs or Gmail records.

Create a local, gitignored research-data directory (or use IndexedDB only) for user-provided exports. If local files are unavailable, do not create fake primary-source content. Tell the user exactly which exports or permissions they still need to provide.

## Mandatory acceptance checks

1. Existing imported conversations, investigative verdicts, linked findings, and Prepared Change records survive a backward-compatible schema upgrade. Old code-change investigation flows still work.
2. From one MIT project, start a question case with **zero conversations required**; attach at least one ChatGPT conversation and two exported text documents; save exhibits from all three.
3. Each saved text exhibit navigates back to the exact snapshot/span; reimport a modified text file and confirm the old quote still opens its earlier version. Unimported URL-only entries have no fabricated text matches.
4. Create two question formulations from **different years and source types**, add a tentative reframing edge, inspect both originals, correct/remove that edge, and retain the audit history.
5. Explicitly distinguish author date, event date, import date, and interpretation/revision date; allow unknown dates.
6. Save a finding with supporting and conflicting exhibits; its language remains user-authored. Reopen/revise it without deleting earlier revisions or evidence.
7. Repeated import of an identical export is idempotent; an altered version is versioned. Missing/deleted sources yield honest missing-source states rather than broken or relinked citations.
8. Export a private research packet; inspect it to ensure private URLs and full source contents are omitted by default and included only with deliberate opt-in.
9. Synthetic fixture covers cross-source linking, uncertain/missing metadata, assistant-vs-user attribution, consent boundaries, and adversarial cases (mismatched hashes/offsets; invalid relation edges; cross-project source permissions).
10. Run `npm run typecheck`, `npm test`, `npm run build:all`, and relevant backend tests; report exact results and any preexisting or outstanding failures. Update the change plan, contracts, and a concise human walkthrough.

## Out of scope for this handoff

Do not attempt automated psychological interpretation, AI-authored history, automated interviews, generalized event causality inference, a giant graph database, live multi-user collaboration, direct Gmail/Drive account ingestion, document mutation, public publishing, new LLM calls, a redesign of Flow Map, or repository-wide refactoring. These may be separate follow-ons after the research pilot demonstrates what is needed.

## Codex execution/output expectations

Work through the stages in reviewable increments on the local branch, preserving uncommitted changes. Follow `CLAUDE.md` and repo change-plan conventions. Implement the minimum complete vertical slice rather than leaving only a new PRD. Test and document limitations honestly. At the end, provide: changed files, migrations, tests run/results, how to start the MIT research project, which sources are registered versus actually imported, what is private/local-only, and the next concrete user action to begin investigating. Do not commit, push, deploy, or ingest private accounts without explicit user authorization.
