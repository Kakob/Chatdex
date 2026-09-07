# Decision Investigation MVP — implementation report

Required by `docs/SPEC-decision-investigation.md` §19. Written 2026-08-18 at the close of DI-4. Phase-by-phase details: `docs/DECISION-INVESTIGATION-BUILD-LOG.md`.

## What was built

The complete MVP loop, spec §4: import a Claude Code session → browse mechanically derived code-change anchors (`/investigate`) → open the three-region workbench (`/investigate/:anchorId`) → read the full verbatim transcript → literal search → pin transcript/tool/code exhibits → confirm reviewed ranges → author and finalize a verdict (immutable revisions, reopen/refinalize) → decision ledger (`/ledger`) → factual per-file coverage → continuation links to neighboring uninvestigated anchors. No LLM, embedding, classifier, or analytics call exists anywhere in the feature; the flow passes with all network access disabled (`constraints.test.ts`).

## Storage migrations (Dexie, `src/lib/db/schema.ts`)

| Version | Stores | Synced? |
|---|---|---|
| v5 | `rawSources` — immutable verbatim payloads, SHA-256 content-addressed | **No** (local-only by design, spec §21.3) |
| v6 | `investigationAnchors` — derived, stable key `{rawHash}#s{stepIndex}` | **No** (recomputable, §21.3–4) |
| v7 | `investigationCases`, `caseExhibits`, `reviewScopes` | Yes (encrypted kinds `investigation_case`, `case_exhibit`, `review_scope`) |
| v8 | `verdictRevisions` — append-only, `&[caseId+revisionNumber]` | Yes (`verdict_revision`) |

All migrations are additive — safe on populated databases; no upgrade transforms. Postgres needed **no migration**: sync rows are opaque ciphertext and all new kind names fit the existing `varchar(32)`.

## Major files

- **Ingestion/fidelity:** `src/lib/parsers/{claude-code,claude-ai,chatgpt,index}.ts` (tool_use id preservation, parser versions, per-file raw capture), `src/lib/import.ts`, `src/lib/utils/hash.ts`
- **Derivation:** `src/lib/detection/normalize.ts` (`Step.toolUseId`, shared substrate), `src/lib/investigation/anchors.ts`
- **Services (trust boundaries):** `src/lib/investigation/{cases,verdicts,context,search,filter,selection}.ts`
- **Persistence:** `src/lib/db/{rawSources,investigationAnchors,investigationCases}.ts`; sync plumbing in `src/lib/sync/{syncApi,serializer,engine}.ts` + `backend/src/{routes/sync.ts,db/schema.ts}`
- **UI:** `src/pages/{InvestigatePage,InvestigationWorkbenchPage,LedgerPage}.tsx`, `src/components/investigation/{TranscriptReader,CodeEventPanel,WorkbenchSearch,CaseNotebook,VerdictPanel,CoverageView}.tsx`, `src/hooks/{useInvestigationAnchors,useInvestigationCase}.ts`
- New dependency: `@tanstack/react-virtual` (the app's first virtualized list).

## Tests

74 investigation-specific tests among **639 frontend + 6 backend, all green** (baseline before the feature: 562). Typecheck clean; production build passes; lint unchanged from its pre-existing baseline. Coverage of the spec's §16.1 list: raw preservation/hashing/idempotency (1, 4, 5), deterministic anchors incl. shell-command exclusion (2, 3), offset round-trips incl. non-ASCII (6), source-mismatch invalidation without relocation (7), verbatim search records (9), explicit confirmed review scopes (10), category evidence rules (11), revision immutability (12), coverage math (13). §16.1.8 (timestamp-proximity “nearby sources”) is N/A — the related-reading feature was deferred (see deviations).

## Observed performance (§16.4, 10,000-event fixture, Apple Silicon dev machine)

| Operation | Observed |
|---|---|
| `normalizeSession` (10k events) | 53 ms |
| `stepDisplayText` ×10k | 3 ms |
| Literal search over 10k events | 3 ms |
| `deriveAnchorsForConversation` (2,000 anchors, ~4,000 SHA-256) | 349 ms |
| `getInvestigationCoverage` (2,000 anchors) | 290 ms |

Transcript rendering is bounded by virtualization (dynamic row measurement, overscan 8); opening an anchor reads stored rows and never re-parses the raw export.

## Spec deviations (all recorded in spec §21 / build log)

1. **Legacy anchor identity.** Conversations imported before raw retention have no source hash; their anchors use `conv:{conversationId}#s{n}` keys, are badged `legacy` in the UI, and upgrade on re-import. (§7.3 adaptation.)
2. **Sources frozen at import.** Pre-existing behavior: re-importing a grown session never merges. Accepted for the MVP; the content hash is the foundation for fixing it later. (§20 deferred.)
3. **Search is per-source.** The workbench search covers the open source only; there is no cross-source lexical index. Anchor/ledger browsing filters on metadata. (§8.6 as amended — Fuse.js is excluded from the feature entirely.)
4. **Related-reading “nearby conversations” deferred** (§5.1/§7.5), along with ledger export (explicitly optional, §9).
5. **Conversation deletion cascades investigation records** — including adjudicated cases — rather than tombstoning. §14 permits cascade; tombstones for adjudicated cases are future work.
6. **Search recording granularity:** executed queries are recorded once per distinct query when the user navigates matches, not per keystroke.
7. **Detection-layer machinery reuse** (normalize/signatures) is explicitly permitted by amended §2.2 — detector *conclusions* remain fully quarantined from the feature.

## Known limitations

- Pre-existing sessions need “Derive anchors” (Investigate page) once; new imports derive automatically.
- Per-hunk code-span pinning has no dedicated UI picker (service supports line ranges; UI offers whole-event and selection pinning).
- The anchor browser and ledger lists are unvirtualized (fine at current volumes; the transcript — the unbounded surface — is virtualized).
- Non-reactive reads app-wide: lists refresh on navigation/action, not live.
- `codex` sources have no parser (pre-existing); ChatGPT/Claude.ai imports can be read but produce no anchors (per spec §5.1).

## Manual QA script (§18)

Run against a real, privacy-safe Claude Code session. Steps 1–10 were the spec's acceptance scenario; record the qualitative answers in §18 afterwards.

1. Import the session (`/import`) or open `/investigate` and press **Derive anchors**.
2. Pick an anchor from its literal file/tool metadata only; note its state chip.
3. **Start investigation** → workbench opens centered on the change event. Read from the initiating user message through the tool event (j/k to walk).
4. Search two literal terms (`/` to focus); check exact highlighting, `[`/`]` navigation, and that the search count appears under "recorded searches" in the notebook.
5. Select transcript text → **Pin selection**; pin the code event; add a note to one exhibit.
6. Mark the reviewed interval via start/end step numbers → **I reviewed this range**; confirm green markers span it.
7. Fill the verdict (origin/status/confidence/rationale); watch the missing-requirements list shrink; **Finalize** and read the confirmation copy.
8. Verify closure: "Verdict recorded", continuation links; follow one to a neighboring anchor.
9. Open `/ledger`; confirm the entry shows your rationale first; **Open investigation** returns to the workbench; every exhibit's step link lands on the exact source event.
10. **Reopen**, change confidence, refinalize; confirm revision 1 is listed unchanged under earlier revisions.
11. Narrow the window below `lg`: the three regions become tabs; repeat steps 4–5 by keyboard only (labeled buttons, no pointer).
12. DevTools → Network: set **Offline**. Repeat steps 3–8 on a second anchor — everything must work; no request appears in the network log.
