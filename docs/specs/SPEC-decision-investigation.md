# Chatdex Decision Investigation MVP

**Status:** Claude Code implementation handoff — **revised 2026-08-18** after a repository reconciliation pass (the original spec's M0). Integration decisions are recorded in §21 and folded into the affected sections, marked **[Integration 2026-08-18]**.

**Scope:** One complete vertical slice, suitable for testing with real Chatdex/Claude Code history

**Primary user:** A solo software builder who delegates implementation to AI coding agents

**Working feature name:** Decision Investigation

---

## 0. Instructions to Claude Code

Implement this feature inside the existing Chatdex repository. Do not create a parallel application or replace existing ingestion, storage, encryption, search, or UI foundations when they can be extended.

Before changing code:

1. Read the repository instructions, package scripts, architecture notes, schemas, and relevant tests.
2. Locate the existing transcript ingestion, normalized message model, search implementation, persistence abstraction, encryption boundary, and session/message UI.
3. Run the existing typecheck and relevant tests and record the baseline.
4. Map the conceptual entities in this spec onto existing project conventions. The names in this document are semantic contracts, not mandatory table or file names.
5. Identify any contradiction between this spec and the repository. Prefer preserving existing stable architecture unless that would violate a product law below. Document consequential deviations in the final implementation report.

Continue through the milestones without requesting product choices that this spec already resolves. Stop and ask only if repository reality makes a required behavior impossible or if a destructive migration would be necessary.

Do not commit, push, deploy, introduce paid services, or make production data migrations unless the surrounding repository instructions explicitly authorize that action.

---

## 1. Product thesis

Chatdex helps people understand software they built by delegating to AI coding agents. The code contains the resulting implementation, but the development transcripts contain the narrated intentions, alternatives, constraints, reversals, and moments when an agent silently acted without discussion.

This feature must make a human want to investigate that history. It is not an AI decision extractor. It is a provenance investigation workspace in which mechanically aligned primary sources let the human reconstruct what happened and render the verdict.

The desired loop is:

1. Encounter a concrete code-change event.
2. Feel a real question: “How did this enter the project, and who chose it?”
3. Read the original conversation and inspect the resulting code change.
4. Pin exact source material as evidence.
5. Write and finalize a human verdict.
6. See that part of the project move from uninvestigated to adjudicated.
7. Follow another unresolved code event because the user genuinely wants to know what happened.

The reward is increased ownership of the codebase, not points or an AI-produced answer.

---

## 2. Non-negotiable product laws

These laws outrank convenience, engagement, and implementation speed.

### 2.1 Human-reading law

The human must read the primary sources and compose the verdict. The product must never replace that reading with a generated summary, extracted decision, inferred rationale, or model-written conclusion.

### 2.2 Mechanical-assistance law

The feature may assist only through operations whose relationship to the source can be inspected directly:

- parsing documented export structures;
- indexing;
- exact, substring, regex, or existing deterministic full-text search;
- literal lexical highlighting;
- timestamp sorting and joining;
- tool-call/message association by source identifiers;
- deterministic extraction of file paths, tool names, timestamps, and exact patches;
- hashing and source-integrity checks;
- navigation, filtering, collapsing, expanding, and virtualization;
- deterministic templates containing literal source metadata;
- counts and statuses computed from human-authored records.

No language model, embedding model, classifier, heuristic semantic scorer, or opaque ranking system may:

- read transcripts for the user;
- identify or rank likely decisions;
- summarize a session or passage;
- propose rationale, alternatives, ownership, or verdict language;
- label a change significant;
- decide that discussion is absent;
- generate a queue of findings for approval;
- score the quality or correctness of a human verdict.

**[Integration 2026-08-18]** Chatdex's existing detectors (`src/lib/detection/`) are *not* AI-backed — they are deterministic, versioned, and evidence-carrying. The quarantine is therefore narrower than originally written: do not surface detector **conclusions** (findings, severities, suppression outcomes) inside this feature or seed it with their output — that stays a product-purity rule. But the deterministic machinery underneath them is explicitly **permitted and preferred** for reuse: `normalize.ts` (Step model, `extractEditHunks()`), `signatures.ts` (canonical tool signatures), and `normalizePath()`. `classify.ts` (state-changing/verification-shaped heuristics) is not needed here — anchors derive only from structured edit payloads — and should not be used to label or filter anchors.

### 2.3 Primary-source integrity law

Every exhibit and finalized verdict must remain traceable to immutable source material. The user must be able to open the exact transcript passage, tool call, or code change from any derived record.

### 2.4 Bounded-negative-evidence law

The system must never claim globally that no discussion or rationale exists. It may record only what the human reviewed and what literal searches were performed. The correct language is:

> No rationale was located within the reviewed scope.

It is not:

> The agent made this decision silently.

The latter may be the human's verdict, but it must remain explicitly authored by the human and supported by a recorded review scope.

### 2.5 Honest-coverage law

Chatdex may show whether an anchor has no case, an open case, or an adjudicated case. It must not convert those states into a fabricated “percent understood,” comprehension score, or code-quality score.

---

## 3. Known baseline and integration assumptions

**[Integration 2026-08-18]** The baseline was verified against `main` (HEAD `84c3ee7`). Actual state:

- **Claude Code JSONL ingestion: exists** (`src/lib/parsers/claude-code.ts`), but parsers discard raw source text, drop `tool_use_id`/tool-block `id` pairing, and regenerate Claude Code message IDs per import. Re-import never merges grown sessions (id-existence dedup only).
- **Transcript browsing: exists** (`ConversationView.tsx`), unvirtualized. **Lexical search: does not exist** — search is Fuse.js *fuzzy* matching over a conversation-level `fullText` blob (see §8.6).
- **Normalized event model: exists in-memory only** — the detection layer's `Step` model (`src/lib/detection/normalize.ts`) with flat ordinals, tool payloads, and deterministic edit-hunk extraction; it is recomputed per detector run and never persisted.
- React 19 + strict TypeScript: yes. Dexie IndexedDB (canonical, plaintext) + ciphertext-only Postgres sync: yes. Client-side encryption: yes. Test suite: yes (562 tests at baseline, incl. a golden-trace harness).
- **No content hashes or parser versioning exist anywhere** outside crypto/auth code.

Extend the existing source model and repository abstraction. The investigation workflow must work locally/offline after sources are imported. Do not add a new database, search service, analytics vendor, or AI API.

If both local and server persistence already exist, use the existing synchronization and encryption rules. If the repository currently treats one store as canonical, preserve that choice.

---

## 4. MVP outcome

At the end of the MVP, a user can:

1. Open an imported Claude Code session containing prose, tool calls, and code-changing tool inputs/results.
2. Browse a chronological list of mechanically identified code-change anchors.
3. Open an anchor in a synchronized investigation workbench.
4. Read the complete surrounding transcript without generated compression.
5. search literal terms and jump among exact matches;
6. pin exact transcript spans, tool events, and code-change spans as exhibits;
7. mark the exact transcript interval they reviewed;
8. create a case and write a verdict using a constrained human-selected taxonomy plus freeform human rationale;
9. finalize, reopen, and revise that verdict without losing history;
10. revisit the decision from a ledger and return to every underlying source;
11. see a factual file/event coverage view showing uninvestigated, open, and adjudicated anchors.

The vertical slice is successful only if no semantic AI processing is required at runtime or during ingestion.

---

## 5. Scope

### 5.1 Required source support

Use existing importers where available. For the MVP:

- Claude Code JSONL is the required code-bearing source.
- Existing ChatGPT/Claude web or mobile transcript imports may appear as related reading sources when they have normalized timestamps and project/session associations.
- Do not build a new remote account connector.
- Do not require access to the current repository working tree. Exact code evidence may come from structured `Edit`, `Write`, `MultiEdit`, `apply_patch`, or equivalent tool payloads already present in the transcript.

If a source contains messages but no code-changing tool events, it can be read and searched but cannot independently create a code-change anchor in this MVP.

### 5.2 Included

- immutable source preservation and source hashes;
- deterministic event normalization;
- deterministic code-change anchors;
- timestamp and source-ID alignment;
- long-transcript reading and search;
- evidence selection;
- reviewed-scope recording;
- human-authored cases and verdict revisions;
- decision ledger;
- factual coverage by anchor and file;
- local/offline operation;
- keyboard-accessible core flow;
- automated unit, integration, and end-to-end tests.

### 5.3 Explicit non-goals

- AI decision extraction, summarization, question generation, or verdict generation;
- semantic search or embeddings;
- ranking changes by importance or “decision likelihood”;
- automatically inferring agreement from lack of objection;
- automatically inferring that an implementation represents a deliberate decision;
- current-repository cloning, GitHub integration, or remote source control actions;
- modifying the investigated repository;
- team collaboration, comments, permissions, or sharing;
- generalized architecture graphs;
- dependency/documentation lookup for inherited defaults;
- automatic ADR or `decisions.md` generation;
- streaks, XP, badges, leaderboards, push notifications, or infinite-feed mechanics;
- mobile-native applications;
- replacing existing Chatdex detector experiences.

---

## 6. Vocabulary

Use these distinctions consistently in UI copy, types, and documentation.

- **Source:** An imported immutable transcript or related raw artifact.
- **Source event:** A normalized message, tool call, tool result, or other ordered item that points back to raw source material.
- **Code-change event:** A source event with a structured, inspectable code mutation such as an edit patch or file write.
- **Anchor:** A neutral entry point derived from one code-change event. An anchor is not a detected decision.
- **Case:** A human-created investigation attached to one primary anchor and optionally other anchors.
- **Exhibit:** An exact human-selected transcript span, tool event, or code span.
- **Review scope:** A human-marked contiguous interval of source events they attest to having reviewed.
- **Search record:** The literal query, filters, result count, and time associated with a case.
- **Verdict:** The human's adjudication of a case.
- **Verdict revision:** An append-only snapshot of a finalized verdict. Revisions preserve earlier human judgments.
- **Decision ledger:** The collection of finalized human verdicts. Draft cases do not appear as decisions.
- **Coverage:** Counts and statuses derived from anchors and their cases, never a measure of comprehension.

---

## 7. Deterministic ingestion and alignment

### 7.1 Preserve raw input

For every imported source:

- retain the raw payload in a **local-only Dexie table excluded from the sync pipeline** — raw JSONL blobs must not flow through the per-record AES-GCM sync path (1000-record push cap, LWW); only the content hash and provenance metadata may sync **[Integration 2026-08-18]**;
- compute a SHA-256 content hash;
- store original source type, source-provided ID, original timestamp text, parsed timestamp when valid, import time, and parser version;
- never mutate the source to accommodate later parsing changes;
- treat a materially changed re-import as a new source version or follow the repository's existing versioning rule;
- make parser errors visible without discarding unaffected source events.

### 7.2 Normalize without interpretation

Normalize only directly represented facts:

- event order;
- event role/kind;
- source event ID and parent tool-call ID;
- exact text;
- tool name;
- literal file paths supplied to a tool;
- old/new strings or exact patch text;
- timestamps;
- command text and exact command output.

Do not normalize inferred intent, rationale, decision category, importance, topic, sentiment, or ownership.

### 7.3 Code-change anchor rules

Create one anchor for each successfully parsed structured code-changing event. Supported initial forms should be based on actual repository fixtures, but normally include:

- edit with explicit old and new text;
- patch/apply-patch with explicit hunks;
- file write with explicit written content;
- multi-edit represented as one parent anchor with literal child file changes.

An arbitrary shell command is not a code-change anchor merely because it could mutate files. It becomes anchorable only if the source contains a directly inspectable patch/diff or an existing parser can verify the resulting changes.

Anchor generation must be deterministic and idempotent. Re-importing the same source must not duplicate anchors. A stable anchor key should be derived from source identity, event identity, and literal change index—not a generated description.

**[Integration 2026-08-18]** Stable keys must derive from **source content hash + event ordinal + change index**, never from stored message IDs: Claude Code message IDs are regenerated on every import (`generateId()`), and conversation IDs fall back to generated values when `sessionId` is absent. Additionally, current import semantics never merge a grown session (same `sessionId`, more turns → skipped wholesale). For this MVP, **sources are accepted as frozen at import time**; merge-on-reimport is a prerequisite for live-session workflows and is deferred (§20). The raw-retention hash added in M1 is the foundation for fixing it later.

### 7.4 Anchor labels

Use literal metadata templates only, for example:

- `Edit · src/storage/db.ts · 2026-08-18 14:22`
- `Write · migrations/004_add_cases.sql · session-name`
- `Patch · 3 files · tool event 184`

Do not label an anchor “Database architecture decision,” “Important security choice,” or any other semantic conclusion.

### 7.5 Alignment precedence

Associate events in this order:

1. explicit source IDs such as tool-call/tool-result IDs;
2. source-defined nesting or ordinal adjacency;
3. timestamps, used only as a navigational join rather than proof of causation.

Related web/mobile conversations may be listed by user-selected project plus configurable timestamp proximity. UI copy must say “Nearby conversations,” not “Conversations that caused this change.”

---

## 8. User experience

### 8.1 Entry: anchor browser

Add an `Investigate` destination using existing navigation conventions.

The page lists neutral anchors chronologically. Each row shows only mechanically derived information:

- tool/change type;
- literal file path or file count;
- session title or source filename;
- timestamp or ordinal when timestamp is absent;
- case state: `Uninvestigated`, `Open`, or `Adjudicated`;
- count of linked exhibits/cases where applicable.

Required filters:

- project/source collection;
- session;
- date range;
- file path substring;
- tool/change type;
- case state.

Required ordering: chronological ascending or descending. Do not add “relevance,” “importance,” or “recommended” order.

Primary actions:

- `Open source`
- `Start investigation`
- `Resume investigation` when a case exists
- `Review verdict` when adjudicated

### 8.2 Investigation workbench

On wide screens, use three synchronized regions:

1. **Transcript:** full primary-source reader.
2. **Code event:** exact tool input/result, patch, before/after text when available, and literal metadata.
3. **Case notebook:** human question, exhibits, review scopes, searches, notes, and verdict controls.

On narrow screens, these become three clearly labeled tabs. Preserve reading position independently in each region.

The workbench opens at the anchor's source event with sufficient surrounding context, but the entire source must remain reachable. Tool payloads may be collapsed by default when clearly labeled; user and assistant prose must not be replaced by summaries. Any collapsed material must expand to the exact original content.

Selecting a source event updates the code panel when a direct tool-event association exists. Selecting an anchor or code hunk scrolls to the associated transcript event. Timestamp-nearby material may be offered separately but must not auto-assert association.

### 8.3 Creating a case

`Start investigation` creates a draft case attached to the anchor.

The initial title may use only a deterministic editable template:

`Investigate {change type}: {literal path or file count}`

The user may replace it with their own question. Do not generate a semantic question.

The notebook supports:

- editable human question/title;
- freeform human notes;
- pinned exhibits;
- human-created unresolved leads;
- recorded review scopes;
- case-scoped search history;
- verdict draft.

Notes and leads must be visibly labeled as the user's writing, not source evidence.

### 8.4 Pinning transcript exhibits

The user can select text inside one normalized message or tool result and choose `Pin transcript exhibit`.

Persist:

- source ID and version/hash;
- event ID;
- exact start/end offsets using an explicitly documented offset encoding;
- hash of the selected text;
- role/kind and original timestamp metadata;
- case ID;
- creation time.

Render the exhibit from source plus offsets whenever possible. A stored preview is a cache, not the authority. If source bytes or offsets no longer validate, mark the exhibit `Source mismatch` and retain its prior locator; never silently relocate it.

Selection must not cross source events in the MVP. The user can create multiple exhibits instead.

### 8.5 Pinning code exhibits

The user can pin:

- an entire code-change event;
- one explicit patch hunk;
- a line range within explicit before/after or written content.

Persist the literal code locator and a content hash. Never generate a prose explanation of the code. The user may add their own exhibit note.

### 8.6 Search

**[Integration 2026-08-18]** There is no existing deterministic search infrastructure to reuse: Chatdex's global search is Fuse.js fuzzy matching (threshold-scored, conversation-granularity, no regex), which the mechanical-assistance law (§2.2) disallows for this feature — fuzzy hits are not literal matches and the score is an opaque ranking. Do not route workbench search through Fuse. Instead, build a **new literal search scoped to the currently open source** inside the workbench (the existing Cmd+F literal search in `ConversationView.tsx` is the conceptual seed). A cross-source lexical index is **out of MVP scope**; the anchor browser filters on metadata only (§8.1) and does not need full-text search.

Required behavior (within the open source):

- literal query by default;
- regex mode is optional and may be deferred; if added, it must be safe (no catastrophic backtracking on user input — bound input length or use a linear-time engine);
- role/kind filter;
- exact highlighting of matched characters;
- result excerpts copied directly from source with clear ellipses;
- click-through to the full source event;
- previous/next match navigation.

When a case is open, record each executed query with its exact query string, mode, filters, result count, and timestamp. The search record is evidence about the user's process, not evidence that an unsearched concept was absent. Never generate synonyms or rewrite the query.

### 8.7 Marking review scope

The user can mark a contiguous range of transcript events as reviewed by selecting a start event and end event and explicitly confirming `I reviewed this range`.

Persist:

- source/version;
- start and end event IDs/ordinals;
- event count;
- confirmation time;
- the IDs of case search records completed before confirmation.

Display review scopes visually in the timeline and in the case notebook. Allow removal before a verdict is finalized. After finalization, preserve the scope in that verdict revision even if the case is later reopened.

The UI must never mark content reviewed merely because it was rendered, scrolled past, or remained on screen.

### 8.8 Verdict form

The human selects one origin category:

- `I explicitly directed this`
- `The agent proposed it and I explicitly adopted it`
- `The agent implemented it without recorded discussion`
- `It was inherited from a framework, library, template, or default`
- `It emerged across multiple exchanges`
- `The implementation conflicts with my recorded direction`
- `I cannot determine who chose it`

The human also selects one current status:

- `Active`
- `Experimental`
- `Superseded`
- `Reversed`
- `Unknown`

The human selects confidence: `Low`, `Medium`, or `High`, and writes a freeform rationale in their own words.

Finalization validation:

- every verdict requires a primary anchor;
- every verdict requires at least one code/tool exhibit;
- every verdict requires non-empty human rationale;
- explicit-direction, agent-proposed/adopted, and conflict categories require at least one transcript exhibit;
- agent-without-recorded-discussion and indeterminate categories require at least one review scope;
- inherited-default requires a review scope plus code/tool evidence; external documentation evidence is deferred;
- the UI states exactly which evidence requirement is missing;
- no automatic confidence or recommended category is shown.

### 8.9 Finalize, reopen, and revise

Finalizing a verdict:

- creates an immutable verdict revision snapshot;
- changes the case to `Adjudicated`;
- makes the entry visible in the decision ledger;
- retains links to all exhibits, review scopes, and case search records included in that revision.

Reopening:

- changes the case to `Reopened` or the repository-equivalent open state;
- never edits the prior finalized revision;
- permits new evidence, scope, and draft judgment;
- creates a new immutable revision on refinalization.

The ledger defaults to the newest revision while exposing the full revision history.

### 8.10 Closure and continued exploration

After finalization, show factual closure:

- `Verdict recorded`
- source/exhibit count;
- affected literal file paths;
- the anchor's new `Adjudicated` state;
- links to chronological previous/next uninvestigated anchors and other anchors touching the same literal file path.

Do not show confetti, XP, streaks, or artificial urgency. The continuation hook should be a real neighboring mystery in the user's project.

---

## 9. Decision ledger

Add a `Decision ledger` destination containing finalized human verdicts only.

Each row/card shows:

- human-authored case title;
- human-selected origin category;
- current status;
- confidence;
- literal affected file paths;
- finalized/last-revised time;
- revision count;
- exhibit and review-scope counts.

Filters:

- origin category;
- status;
- confidence;
- file path substring;
- source/session;
- finalized date.

Opening an entry shows the human rationale first, then its evidence and scope. Every exhibit must have `Open in source`. Do not add an AI summary above the human rationale.

The ledger may export deterministic structured data containing the human-authored fields and source locators only if an export utility already exists and this is low effort. Export is not required for MVP completion.

---

## 10. Coverage view

Add a factual coverage view organized by the literal file paths appearing in code-change anchors.

For each path show:

- total anchors;
- uninvestigated anchors;
- anchors with open/reopened cases;
- anchors with an adjudicated case;
- last human adjudication time.

Allow expanding a path into its anchors and cases. Also provide overall counts using the same statuses.

Do not use heat-map labels such as “known,” “mastered,” or “understood.” A file with adjudicated anchors can still contain unknown behavior; the UI must not imply otherwise.

---

## 11. Conceptual data model

Adapt this to existing schemas and ID conventions. Preserve referential integrity and existing encryption boundaries.

**[Integration 2026-08-18] Mapping onto the repository — these decisions are resolved, do not re-litigate them:**

1. **`SourceEvent` = the detection layer's `Step`, persisted.** Extend `src/lib/detection/normalize.ts` (adding `tool_use_id` pairing once parsers preserve it) rather than writing a second normalizer; detection and investigation must share one event substrate so they cannot drift. `Step.index` is the ordinal.
2. **Persisted `SourceEvent` rows do not sync.** They are deterministically recomputable from the retained raw source + parser version on any device, so sync carries only the raw-source *metadata* (hash, provenance) and the human-authored records. This roughly halves the sync surface. (Adding one synced entity type costs ~7 coordinated edits across `types/`, `db/schema.ts`, `db/index.ts:clearAllData`, `sync/syncApi.ts`, `sync/serializer.ts`, `sync/engine.ts` ×4 sites, and `backend/` schema+route — budget accordingly.)
3. **Do not persist `InvestigationAnchor` as its own synced table.** Anchors are derived 1:1 from code-change events (stable key = source hash + ordinal + change index); anchor *state* is computed from linked cases, as the interface already suggests. What syncs: cases, exhibits, review scopes, verdict revisions.
4. **Embed `CaseSearchRecord` rows in the case record** rather than as a separate synced entity.
5. **Naming: "anchor" is taken.** Chatdex has a live `anchors` Dexie table (AIPKMS message bookmarks → Knowledge page). Use `investigationAnchors`/`InvestigationAnchor` in code; prefer "change event" in UI copy to avoid two unrelated user-facing "anchors."
6. Backend sync `kind` column is `varchar(32)` — keep new kind names ≤32 chars.

```ts
type SourceKind = "claude_code_jsonl" | "chat_export" | "other_import";

interface InvestigationSource {
  id: string;
  kind: SourceKind;
  externalSourceId?: string;
  projectId?: string;
  rawContentHash: string; // SHA-256
  parserVersion: string;
  importedAt: string;
  sourceTimestampRaw?: string;
  sourceTimestamp?: string;
}

type SourceEventKind =
  | "user_message"
  | "assistant_message"
  | "system_message"
  | "tool_call"
  | "tool_result"
  | "other";

interface SourceEvent {
  id: string;
  sourceId: string;
  sourceOrdinal: number;
  kind: SourceEventKind;
  role?: string;
  exactText?: string;
  occurredAtRaw?: string;
  occurredAt?: string;
  externalEventId?: string;
  parentExternalEventId?: string;
  toolName?: string;
}

type CodeChangeKind = "edit" | "write" | "patch" | "multi_edit";

interface CodeChangeEvent {
  id: string;
  sourceEventId: string;
  stableKey: string;
  kind: CodeChangeKind;
  fileChanges: Array<{
    path: string;
    changeIndex: number;
    oldText?: string;
    newText?: string;
    exactPatch?: string;
    contentHash: string;
  }>;
}

type AnchorState = "uninvestigated" | "open" | "adjudicated";

interface InvestigationAnchor {
  id: string;
  codeChangeEventId: string;
  stableKey: string;
  state: AnchorState; // preferably computed from linked cases
  createdAt: string;
}

type CaseState = "draft" | "open" | "adjudicated" | "reopened";

interface InvestigationCase {
  id: string;
  primaryAnchorId: string;
  linkedAnchorIds: string[];
  title: string; // human editable; initial literal template permitted
  notes: string; // human-authored
  state: CaseState;
  createdAt: string;
  updatedAt: string;
}

type ExhibitKind = "transcript_span" | "tool_event" | "code_span";

interface CaseExhibit {
  id: string;
  caseId: string;
  kind: ExhibitKind;
  sourceId: string;
  sourceContentHash: string;
  sourceEventId: string;
  startOffset?: number;
  endOffset?: number;
  offsetEncoding?: "utf16";
  codeChangeEventId?: string;
  filePath?: string;
  changeIndex?: number;
  codeSide?: "before" | "after" | "patch";
  startLine?: number;
  endLine?: number;
  selectedContentHash: string;
  humanNote?: string;
  createdAt: string;
}

interface CaseSearchRecord {
  id: string;
  caseId: string;
  query: string;
  mode: "literal" | "regex";
  filtersJson: string;
  resultCount: number;
  createdAt: string;
}

interface ReviewScope {
  id: string;
  caseId: string;
  sourceId: string;
  sourceContentHash: string;
  startEventId: string;
  endEventId: string;
  startOrdinal: number;
  endOrdinal: number;
  eventCount: number;
  includedSearchRecordIds: string[];
  humanConfirmedAt: string;
}

type VerdictOrigin =
  | "user_directed"
  | "agent_proposed_user_adopted"
  | "agent_implemented_without_recorded_discussion"
  | "inherited_default"
  | "emergent_across_exchanges"
  | "conflicts_with_user_direction"
  | "indeterminate";

type VerdictStatus =
  | "active"
  | "experimental"
  | "superseded"
  | "reversed"
  | "unknown";

type VerdictConfidence = "low" | "medium" | "high";

interface VerdictRevision {
  id: string;
  caseId: string;
  revisionNumber: number;
  origin: VerdictOrigin;
  status: VerdictStatus;
  confidence: VerdictConfidence;
  rationale: string; // human-authored only
  exhibitIds: string[];
  reviewScopeIds: string[];
  searchRecordIds: string[];
  finalizedAt: string;
}
```

Implementation requirements:

- Use existing ULID/UUID conventions.
- Add schema migrations using the repository's migration system.
- Migrations must be safe on an existing populated database.
- Finalized revision records are append-only.
- Derive anchor state when practical rather than allowing contradictory stored state.
- Do not store generated summaries, inferred topics, decision scores, or model provenance because no model should participate.

---

## 12. Application/service operations

Expose these capabilities through the repository's existing client/service/API patterns. Do not create REST endpoints merely to match these names.

- `listInvestigationAnchors(filters, order)`
- `getInvestigationContext(anchorId)`
- `listNearbySources(anchorId, timeWindow, projectFilter)`
- `createInvestigationCase(anchorId)`
- `updateCaseHumanFields(caseId, title, notes)`
- `addTranscriptExhibit(caseId, locator)`
- `addCodeExhibit(caseId, locator)`
- `removeDraftExhibit(caseId, exhibitId)`
- `recordCaseSearch(caseId, exactSearch)`
- `addReviewScope(caseId, eventRange)`
- `removeDraftReviewScope(caseId, scopeId)`
- `saveVerdictDraft(caseId, humanInput)`
- `finalizeVerdict(caseId)`
- `reopenCase(caseId)`
- `listDecisionLedger(filters)`
- `getDecision(caseId, revision?)`
- `getInvestigationCoverage(filters)`

All mutations must validate source ownership, case ownership, source hashes, offsets/ranges, and allowed case state at the trust boundary—not only in UI controls.

---

## 13. UI behavior and accessibility

- Use existing design tokens and component conventions.
- Virtualize long transcripts without changing source order or text. **[Integration 2026-08-18]** No virtualization exists anywhere in the app today (`ConversationView` maps the full message array; no react-window/virtuoso dependency). The workbench reader is a **new component** with virtualization built in from the start — do not retrofit `ConversationView`.
- Preserve scroll position when switching workbench regions.
- Make exact source timestamps and roles visible.
- Clearly distinguish source text, code text, and human notes through labels and styling, not color alone.
- Provide visible focus states and semantic buttons.
- Ensure the entire core flow is keyboard accessible.
- Support text selection without hijacking normal copy behavior.
- Evidence pinning must have a button/menu alternative that works without a precision pointer.
- Use a confirmation step for finalizing a verdict and explain that finalization creates a revision.
- Draft deletion may use existing recoverability conventions. Never delete finalized revision history as a side effect of reopening.
- Empty and error states must explain what factual input is missing: no code-bearing events, parser failure, source mismatch, invalid timestamp, or missing evidence.

Suggested keyboard behaviors, if they fit existing conventions:

- `j` / `k`: next/previous source event when the reader is focused;
- `/`: focus source search;
- `e`: pin current selection after an explicit confirmation;
- `[` / `]`: previous/next literal search match.

Shortcuts are secondary to labeled controls and are not required if they would delay the core flow.

---

## 14. Privacy, security, and offline behavior

- Investigation must work with network access disabled after import.
- Do not send transcript text, code, queries, case notes, or verdicts to any model or external analytics service.
- Preserve existing client-side encryption behavior for all new persisted fields.
- Sanitize rendered imported HTML/Markdown using existing safe renderers.
- Treat tool outputs and code as untrusted display data.
- Do not execute imported commands, patches, or code.
- Do not resolve imported file paths against the host filesystem.
- Avoid logging source text, search queries, or verdict rationale to console/server logs.
- Existing authentication and data-ownership checks apply to every new operation.
- Deleting an imported source must follow existing deletion policy and either cascade safely or leave explicit unavailable-source tombstones; it must not leave exhibits that silently appear authoritative.

---

## 15. Local product instrumentation

If Chatdex already has a privacy-preserving local event ledger, add factual events without transcript content:

- `investigation_anchor_opened`
- `investigation_case_created`
- `source_search_executed`
- `case_exhibit_pinned`
- `review_scope_confirmed`
- `verdict_finalized`
- `case_reopened`
- `neighbor_anchor_opened_after_verdict`

Do not add a third-party analytics dependency. Do not capture source text, file contents, search terms, notes, or rationale in analytics payloads.

Product-experiment measures, computed locally or through existing consented aggregate analytics, may include:

- whether a user voluntarily opens another anchor after finalizing a verdict;
- time spent in primary-source panes versus form controls;
- cases completed and later revised;
- exhibits and review scopes per finalized verdict;
- return to an unfinished case.

Do not optimize for verdict speed alone. Faster adjudication can mean shallower reading.

---

## 16. Required tests

Use the existing test framework and fixture style. Add small synthetic primary-source fixtures whose expected structure is obvious to a human reviewer.

### 16.1 Unit tests

1. The Claude Code adapter preserves exact prose and tool payload text.
2. Structured edit/write/patch events create deterministic anchors.
3. Unsupported or ambiguous shell commands do not create code-change anchors.
4. Importing the same raw source twice does not duplicate source events or anchors according to current deduplication policy.
5. Source, selection, and code hashes are stable.
6. Transcript offsets round-trip correctly, including emoji and non-ASCII text; document and test the offset encoding.
7. A source mismatch invalidates an exhibit rather than silently relocating it.
8. Timestamp proximity orders nearby sources but does not create a causal association.
9. Search records preserve the exact user query, mode, filters, and result count.
10. Review scopes require explicit user confirmation and valid ordered boundaries.
11. Verdict-category evidence rules reject invalid finalization.
12. Finalization creates revision 1; reopen/refinalize creates revision 2 without mutating revision 1.
13. Coverage counts are computed correctly from anchors and cases.

### 16.2 Integration tests

1. Import a fixture containing user prose, assistant prose, an edit tool call, and a tool result.
2. Verify that the neutral anchor is shown with literal metadata only.
3. Open the anchor and verify transcript order and exact text.
4. Run a literal search and verify exact highlighting and click-through.
5. Pin a transcript span and code hunk; reload; verify both resolve to their exact sources.
6. Mark a review scope and verify it is not inferred from scroll position.
7. Finalize a valid human verdict and verify ledger and coverage updates.
8. Reopen, add evidence, change the human verdict, and verify both revisions remain inspectable.
9. Disable network access and repeat the read/search/adjudicate flow successfully.

### 16.3 End-to-end constraint test

During the complete investigation flow, fail the test if the feature attempts any request to a model, embedding, summarization, classification, or external analytics endpoint. Ordinary existing authenticated persistence/sync may be separately mocked according to the repository architecture, but offline mode must pass with no network.

Assert that:

- no AI-generated summary appears;
- no anchor is described semantically;
- no origin category or confidence is preselected;
- no verdict rationale is prefilled;
- all ledger prose comes from human-entered fields or fixed taxonomy labels;
- every exhibit opens its exact primary source.

### 16.4 Performance checks

Use a deterministic generated fixture of at least 10,000 source events.

- The transcript must use bounded rendering/virtualization rather than mounting every event.
- Opening an anchor should not parse the entire raw export on every render.
- Literal search should use the existing index and remain interactively usable on the project's supported baseline hardware.
- Record observed timings in the implementation report; do not invent a hard SLA without an existing performance-testing convention.

---

## 17. Milestones

**[Integration 2026-08-18]** This repo builds one phase per session (see `docs/UNDERSTANDING-BUILD-LOG.md` conventions). M1–M4 below are multi-session; the working slice order is tracked as DI-phases:

- **DI-0** = M0 (done 2026-08-18; findings in §3/§21)
- **DI-1a** — parser fidelity: preserve `tool_use_id`/tool-block `id` on `ContentBlock`; raw-source retention table (local-only) with SHA-256 hash + parser version stamped at import; tests. *(← start here)*
- **DI-1b** — persisted source events (Step model + tool-call pairing) and derived investigation anchors with stable keys; golden-trace tests. Completes M1.
- **DI-2a** — anchor browser page (metadata filters, chronological order, states).
- **DI-2b** — workbench reader (new virtualized component) + literal in-source search.
- **DI-2c** — exhibits + review scopes + case drafts (synced entities land here). Completes M2.
- **DI-3** — verdict form/validation, revisions, ledger, coverage. May split in-session.
- **DI-4** — hardening, offline/E2E constraint tests, implementation report.

### M0 — Repository reconciliation

- Run baseline checks.
- Map current ingestion, source models, search, persistence, encryption, and UI routes.
- Identify reusable components and required migrations.
- Produce a short implementation checklist in the working notes.

**Exit:** The chosen integration points are grounded in current code, and no parallel subsystem is planned without justification. **[Done 2026-08-18 — baseline: typecheck clean, 562/562 tests passing.]**

### M1 — Source integrity and deterministic anchors

- Add any missing raw/source hashes and parser versioning.
- Normalize supported code-change events.
- Generate stable, idempotent neutral anchors.
- Add adapter and migration tests.

**Exit:** A real Claude Code fixture produces a chronological anchor list, and every anchor opens the exact originating source event.

### M2 — Investigation workbench

- Build synchronized transcript, code event, and notebook regions.
- Add exact lexical search/navigation.
- Add transcript/code exhibit selection.
- Add explicit review-scope selection.
- Persist case drafts offline.

**Exit:** A user can investigate one real event, leave, return, and continue with all source links intact.

### M3 — Human verdict, ledger, and coverage

- Add verdict validation and finalization.
- Add immutable revision history and reopening.
- Add decision ledger.
- Add factual anchor/file coverage.
- Add neighboring-anchor continuation links.

**Exit:** The full import → read → evidence → verdict → ledger → next-anchor loop works without AI or network access.

### M4 — Hardening and handoff

- Complete unit/integration/end-to-end tests.
- Test long-source virtualization and source mismatches.
- Test keyboard and narrow-screen flow.
- Run full repository checks.
- Produce implementation report and manual QA script.

**Exit:** Definition of done is satisfied.

---

## 18. Manual acceptance scenario

Use at least one real, privacy-safe Claude Code session from Chatdex in addition to synthetic fixtures.

1. Import or open the session.
2. Choose an anchor only from its literal file/tool metadata.
3. Open the workbench and read from the initiating user message through the code-changing tool event.
4. Search at least two literal terms.
5. Pin one transcript passage and one code change.
6. Mark the reviewed interval explicitly.
7. Write a case question and verdict rationale without generated assistance.
8. Finalize the verdict.
9. Open it from the ledger and return to both exact sources.
10. Reopen it, revise the judgment, and confirm revision 1 remains unchanged.
11. Open a neighboring uninvestigated anchor touching the same file.
12. Repeat steps 3–8 with network access disabled.

Record qualitative answers:

- Did the workbench feel like investigating or merely rereading?
- Did aligning the code event with the transcript create a genuine question?
- Was any source material hidden at the moment it was needed?
- Did the user trust the evidence pointers?
- After finishing, did the user voluntarily want to open another case?
- Did the resulting verdict feel useful enough to revisit later?

These answers determine whether the product hypothesis is working. More automated detections do not.

---

## 19. Definition of done

The MVP is done when all of the following are true:

- Existing supported Chatdex behavior still passes its tests.
- At least one real Claude Code source produces stable neutral anchors.
- The source transcript is rendered verbatim and remains fully reachable.
- Search and highlighting are exact and non-generative.
- Transcript and code exhibits survive reload and validate against source hashes.
- Review scope is always explicitly confirmed by the user.
- The user can author, finalize, reopen, and revise a verdict.
- Finalized revisions are immutable and fully source-linked.
- The ledger contains only human verdicts.
- Coverage reports only factual anchor/case states.
- The entire primary flow works offline after import.
- No AI/embedding/classifier/summarizer request occurs anywhere in the feature.
- No verdict field is preselected or model-authored.
- Automated constraint tests pass.
- The implementation report lists migrations, major files changed, tests run, known limitations, and any spec deviations.

---

## 20. Later work explicitly deferred

Do not implement these while completing the MVP, but avoid choices that make them unnecessarily difficult:

- deterministic parsing of dependency additions, migrations, routes, and configuration changes into finer-grained anchors;
- user-attached official documentation as primary evidence for inherited defaults;
- cross-session evidence trails spanning agent and web/mobile chats;
- user-created links among related or contradictory verdicts;
- supersession graphs and decision lineage;
- deterministic exports to ADR/Markdown with exact citations;
- shared review or paired adjudication;
- repo snapshot/current-code linking;
- uniform-random “surprise me” exploration within user-selected filters;
- richer territory visualization based strictly on investigated anchors;
- controlled experiments comparing chronological replay, outcome-backtrace, and case-first entry modes.

None of those future features may weaken the human-reading, mechanical-assistance, primary-source-integrity, bounded-negative-evidence, or honest-coverage laws.

**[Integration 2026-08-18]** Also deferred, discovered during reconciliation:

- **Merge-on-reimport for grown Claude Code sessions.** Today re-import skips existing conversation IDs wholesale; sources are frozen at import (§7.3). The content hash added in DI-1a is the foundation for fixing this.
- **Cross-source lexical search index** (§8.6 scopes MVP search to the open source).
- Related-reading "nearby conversations" from ChatGPT/Claude web imports (§5.1/§7.5) — feasible via `understandingProjects`/`projectAssociations`, but additive scope; defer past DI-3.

---

## 21. Repository integration decisions (2026-08-18)

Recorded so the implementing session doesn't re-derive them. Verified against `main` @ `84c3ee7`; re-verify only if these files have since changed.

| # | Decision | Reason |
|---|---|---|
| 1 | Reuse `src/lib/detection/{normalize,signatures}.ts` (`Step`, `extractEditHunks`, `signatureFor`, `normalizePath`) as the event substrate; persist it rather than writing a parallel normalizer | Deterministic, tested, already extracts Edit/MultiEdit/Write/NotebookEdit hunks; two normalizers would drift |
| 2 | Detector *conclusions* stay out of this feature; deterministic detector *machinery* is allowed (§2.2 as amended) | Existing detectors are deterministic, not AI-backed; the original quarantine targeted a strawman |
| 3 | Raw source payloads: new local-only Dexie table, excluded from sync; hash + provenance metadata may sync | Raw JSONL blobs would swamp the per-record AES-GCM sync path |
| 4 | Persisted source events don't sync; recompute from raw source + parser version per device | Halves sync surface (~7 coordinated edits per synced entity type) |
| 5 | Anchors are derived, not stored-and-synced; stable key = source content hash + event ordinal + change index | Stored message IDs are regenerated per import and unusable as identity |
| 6 | Sources are frozen at import for the MVP; merge-on-reimport deferred | Current dedup is id-existence-only and non-transactional; fixing it is its own project |
| 7 | Workbench search is new, literal, scoped to the open source; Fuse.js is not used by this feature | Fuse is fuzzy + scored — disallowed by §2.2; conversation-granularity anyway |
| 8 | `investigationAnchors` naming; "change event" in UI copy | `anchors` table/feature already exists (AIPKMS bookmarks) |
| 9 | Workbench reader is a new virtualized component; `ConversationView` untouched | No virtualization exists in the app; retrofit is riskier than greenfield |
| 10 | Parsers must start preserving `tool_use_id`/tool-block `id` (new `ContentBlock` field); existing imported data won't have them until re-imported | Both parsers currently drop the IDs; `ContentBlock` has no field for them; tool_use↔tool_result pairing is otherwise positional-only |
