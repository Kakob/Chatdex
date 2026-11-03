# Chatdex — Product Requirements Document

**Status:** Draft v0.1
**Owner:** Jacob
**Last updated:** April 7, 2026

---

## 1. Overview

Chatdex is a browser extension and companion app for Claude power users. It transforms a user's Claude conversation history from an ephemeral chat log into a structured, searchable, annotatable corpus that the user can study, curate, and learn from over time.

This PRD covers a major expansion of Chatdex (formerly Claude Utils) to add three new features on top of the existing search, knowledge management, and usage analytics:

1. **Pattern Mirror** — surfaces patterns in the user's own conversation history
2. **Collections** — user-curated groupings of saved messages, with proactive suggestions
3. **Tag-based Search Refinement** — tagging messages to build a personal knowledge graph that improves search

It also covers a **Security & Encryption** workstream that adds client-side encryption to the existing IndexedDB + Postgres hybrid storage architecture.

A future, separately-scoped feature — opt-in research contribution to a public dataset — is referenced in a final section but is **not in scope for this release**.

---

## 2. Goals and non-goals

### Goals

- Help power users discover patterns in their own Claude usage they couldn't see before.
- Make the user's Claude history feel like a corpus worth examining, not a log to scroll past.
- Build features that are intrinsically rewarding to use (curiosity, self-knowledge, curation), not features that depend on external incentives.
- Strengthen the privacy and security story of Chatdex so that users with high standards can trust it with their conversations.
- Lay technical groundwork that would later support an opt-in research contribution layer, without building that layer yet.

### Non-goals

- Not building the research contribution feature in this release.
- Not building cross-user social features (sharing collections publicly, leaderboards, comments).
- Not changing the existing search, knowledge management, or usage analytics features beyond what's needed to integrate the new features.
- Not supporting non-Claude conversations (GPT, Gemini) in this release. May be considered later.

---

## 3. Users and use cases

**Primary user:** A power user of Claude who has hundreds of conversations, treats Claude as a long-term thinking partner, and wants tools that respect that level of engagement.

**Representative use cases:**

- "I want to see how often Claude pushes back on me and what triggers it."
- "I want to find that one great response from a few months ago without scrolling through everything."
- "I want a collection of all the times Claude gave me good advice, so I can reread it."
- "I want to know which topics I talk to Claude about most, and when."
- "I want my conversation history to feel like something I own and can study, not a chat log."

---

## 4. Features

### 4.1 Pattern Mirror

**What it is:** A view that surfaces patterns and insights from the user's own Claude conversation history, computed from structured summaries of each conversation.

**How it works:**

1. **Structured extraction (one-time per conversation):** When a conversation is added to Chatdex, an extraction pipeline calls the Claude API once with a strict JSON schema and stores the resulting structured summary alongside the conversation in the user's local database. Extraction is cached forever — each conversation is processed exactly once unless the schema is updated.

2. **Pattern queries (instant, local):** Pattern Mirror queries the structured summaries using local SQL/queries. No API calls happen at view time. Patterns are computed instantly from the cached structured data.

3. **Optional rendering pass:** For human-readable descriptions of patterns, an optional second API call generates a short natural-language summary (e.g., "You started 14 new project ideas this month — here they are"). This call is small and only happens when the user opens a pattern view.

**Structured summary schema (v0.1):**

Each conversation is summarized into a JSON object with the following top-level fields:

- `metadata` — message counts, duration, time of day, day of week
- `topics` — primary topic, secondary topics, domain category
- `user_intent` — type of interaction (build, learn, decide, vent, etc.), stated goal, project mentioned
- `interaction_character` — tone, engagement level, conversation arc
- `notable_assistant_behaviors` — pushback instances, refusals, expressed uncertainty, tools used, artifacts produced
- `notable_user_behaviors` — direction changes, new projects introduced, frustration, enthusiasm
- `outcomes` — resolution status, decisions made, next actions
- `highlights` — memorable moments flagged by category (great_response, bad_response, funny, insightful, wrong, surprising)
- `extraction_confidence` — high / medium / low, with optional notes

The full schema is versioned (`schema_version: "0.1"`) and can be evolved without breaking existing data.

**Initial pattern views:**

- **Pushback History** — every time Claude pushed back on the user, with trigger, intensity, and the user's response. The flagship view, since this is the most distinctive thing the app surfaces.
- **Project Ideation Timeline** — every time the user introduced a new project or pivoted mid-conversation. Shows the user's own ideation patterns over time.
- **Time and Topic Patterns** — when the user talks to Claude most, and about what.
- **Highlights Reel** — a gallery of moments the model flagged as memorable, ready to be added to Collections.
- **Resolution Patterns** — which conversations reached resolution, which were abandoned, which pivoted.

**Annotation as fact-checking:** Each surfaced pattern can be corrected by the user. "Is this pattern accurate?" / "Was this really pushback?" Corrections refine the user's view of their own data and improve the local extraction over time. This is the primary way annotation enters the system — as fact-checking the mirror, not as a separate task.

**Out of scope for v1:** Cross-conversation entity linking (e.g., "every time you mentioned Flowviate"), graph visualizations, exported reports.

---

### 4.2 Collections

**What it is:** User-curated groupings of saved messages, with proactive suggestions from the model.

**How it works:**

- Users can create named collections (e.g., "Best advice," "Times Claude was wrong," "Funny moments," "Refusals").
- Messages can be added to collections from the conversation view, from search results, or from Pattern Mirror highlights.
- The app proactively suggests candidates for collections based on the structured summaries: "I found 6 refusals in your history. Want to start a Refusals collection?" / "This response looks like it might fit your Best Advice collection — add it?"
- Collections support reordering, notes per item, and exporting as a shareable artifact (a static HTML page or image — for the user, not for research).
- Collections live in the user's local database and are not shared by default.

**Why this works:** Collections are sticky once they exist, but they don't pull users in on their own. Suggestions from Pattern Mirror are the acquisition mechanic. Curation is the retention mechanic. Together they form a loop where the app surfaces interesting moments, the user collects them, and the act of collecting refines what the app surfaces next.

**Out of scope for v1:** Public sharing, collaborative collections, collection templates from other users.

---

### 4.3 Tag-based Search Refinement

**What it is:** A tagging system that lets users mark messages with categories, and a search experience that uses those tags as first-class filters.

**How it works:**

- Users can tag any message (from a conversation view, search result, or Pattern Mirror) with one or more tags.
- Tags can be free-form or selected from a suggested set derived from the structured summary (`pushback`, `refusal`, `great_response`, `bad_response`, etc.).
- Search supports tag filters alongside full-text search ("show me everything tagged `great_response` from the last 90 days").
- Tags are visible in the conversation view as small inline markers, so the user sees the structure of their own annotations as they reread.
- Tagging is the primary surface for the user to express their own judgment about a message — and it doubles as the annotation layer that would later feed research contribution.

**Why this works:** Users have a self-interested reason to tag (better search, personal organization). The research-relevant data is a byproduct of behavior they would do anyway.

**Out of scope for v1:** Tag taxonomies, tag hierarchies, suggested tags from other users, AI-suggested tags beyond what's already in the structured summary.

---

## 5. Architecture

### 5.1 Storage (existing, with security additions)

Chatdex already uses a hybrid storage architecture:

- **IndexedDB (primary, default):** All conversations, structured summaries, collections, tags, and user state are stored locally in the browser. This is the default mode and works fully offline.
- **Postgres (opt-in, for persistence and sync):** Users can connect to a Postgres database (hosted by Chatdex or self-hosted) to persist data across browser clears, sync across devices, and back up their corpus.

This hybrid model is **not changing** in this release. What is changing is the security layer on top of it (see Section 6).

### 5.2 Extraction pipeline

A new background pipeline processes conversations into structured summaries:

- Triggered when a conversation is first added to Chatdex.
- Calls the Claude API once per conversation with the extraction prompt and schema.
- Stores the resulting JSON in the local database, linked to the source conversation.
- Handles retries, errors, and low-confidence extractions (flagged for user review).
- Batched and rate-limited so processing a backlog of hundreds of conversations is feasible without hitting API limits.
- Cached forever — never re-processes a conversation unless the schema version changes.

### 5.3 Pattern engine

Pattern queries run locally against the structured summaries using SQL (Postgres) or IndexedDB queries. No model calls happen at query time. The optional natural-language rendering pass calls the model only when a user opens a pattern view, and the result is cached.

---

## 6. Security and encryption

This is a major workstream in this release. The current Postgres tier stores conversation data in a form that Chatdex operators can technically access. This needs to change before Chatdex can credibly market itself as a tool for users who care about the privacy of their AI conversations.

### 6.1 Goals

- Users on the Postgres tier should be able to trust that Chatdex operators **cannot read their conversation data**, even in principle.
- Users should be able to verify the security model rather than having to take it on faith.
- The security model should not break sync, search, or any of the core features.
- Failure modes (lost passwords, lost devices) should be clearly explained and have reasonable recovery paths.

### 6.2 Client-side encryption

**Approach:** Conversations and structured summaries are encrypted in the browser before being sent to Postgres. The encryption key is derived from a user-controlled secret (a password or passphrase) and never leaves the user's device in unencrypted form.

**Key derivation:**

- Use Argon2id (or scrypt as a fallback) to derive an encryption key from the user's passphrase, with a per-user salt.
- The derived key is held in memory in the browser session and never persisted to disk in unencrypted form.
- Optionally, the derived key can be stored in the browser's secure key storage (e.g., the Web Crypto API's non-extractable key support) so the user doesn't need to re-enter their passphrase every session.

**Encryption:**

- Use AES-GCM (256-bit) for symmetric encryption of conversation payloads.
- Each record gets a unique IV.
- Authenticated encryption ensures tampering is detectable.

**What gets encrypted:**

- Conversation message contents
- Structured summaries (the JSON output from the extraction pipeline)
- Tags and collection notes
- Any free-text user annotations

**What does not get encrypted (and why):**

- Record IDs, timestamps, and other metadata needed for indexing and querying.
- Schema version fields.
- Encrypted-blob length (an unavoidable side channel).

The tradeoff: the server can see *that* a user has N records and *when* they were created, but not *what* they say.

### 6.3 Search over encrypted data

Full-text search over encrypted data is a hard problem. For v1, Chatdex will use the following pragmatic approach:

- Search is performed **client-side** after decryption. The browser pulls the encrypted records, decrypts them in memory, and runs the search locally.
- For users with thousands of conversations, this requires an efficient client-side search index. Chatdex will build and maintain a local search index in IndexedDB, encrypted at rest and rebuilt as needed.
- This is slower than server-side search but it preserves the security model. It is acceptable for the target user base (power users with hundreds-to-low-thousands of conversations).
- Future work may explore searchable encryption schemes, but this is explicitly out of scope for v1.

### 6.4 Key recovery and loss

Client-side encryption creates a real risk: if the user loses their passphrase, their data is unrecoverable. Chatdex must handle this honestly.

- The first-run flow for enabling encryption explains this clearly: "If you lose this passphrase, no one — including Chatdex — can recover your data."
- Users are prompted to write down their passphrase or store it in a password manager.
- An optional **recovery key** is generated at setup time. The user can save this key (printed, stored in a password manager, etc.) as a backup. The recovery key can decrypt the data without the passphrase. This is opt-in because some users will prefer the stronger guarantee of "no recovery possible."
- Chatdex does not store either the passphrase or the recovery key in any form.

### 6.5 Migration from existing unencrypted data

Existing users on the Postgres tier have data stored unencrypted. Migration plan:

- Add encryption as an opt-in feature first, alongside the existing unencrypted mode.
- Existing users see a one-time prompt: "Chatdex now supports end-to-end encryption. Set up a passphrase to encrypt your data."
- Once a user opts in, their existing data is encrypted in batch (client-side decryption from the unencrypted server records, re-encryption with the new key, replacement on the server).
- After a transition period (3-6 months), encryption becomes the default for new users. Existing unencrypted users are migrated with explicit consent.
- Users on IndexedDB-only are unaffected — their data is already private to their device.

### 6.6 Other security improvements

In addition to encryption, this release adds:

- **Privacy policy update:** The current privacy policy needs to be rewritten to reflect both the existing storage architecture and the new encryption. The policy should be plain-language, specific, and honest about what Chatdex can and cannot see.
- **Data deletion:** A clear, working "delete all my data" button that actually removes data from both IndexedDB and Postgres, with confirmation.
- **Export:** A "download all my data" button that exports the user's full corpus (conversations, summaries, tags, collections) as a JSON file. This is both a transparency feature and a hedge against data loss.
- **Audit logging (server-side):** Log access to the Postgres database for operational visibility, with logs themselves not containing decryptable data.
- **Dependency review:** Before shipping the encryption work, review all third-party dependencies for known vulnerabilities and minimize the dependency surface for the crypto code path.

---

## 7. Privacy policy updates

The privacy policy needs to be rewritten alongside this release. Key points it should cover, in plain language:

- What Chatdex stores (conversations, summaries, tags, collections, usage data).
- Where it stores it (IndexedDB locally, Postgres optionally).
- Who can access it (the user; Chatdex operators only for unencrypted server data; nobody for encrypted server data).
- How users can delete it (one button, works immediately, includes Postgres).
- How users can export it (one button, full JSON dump).
- What changes when encryption is enabled (Chatdex cannot read encrypted data, users are responsible for their passphrase).
- What does not happen (no selling of data, no advertising, no sharing with third parties, no training of models on user data).

---

## 8. Open questions

- **Extraction cost:** How much does it actually cost to process a typical user's backlog (estimate: 50–500 conversations)? Need to test on real data and decide whether to absorb the cost, charge the user, or provide a free tier with a cap.
- **Schema iteration:** The structured summary schema will change as we learn what's useful. How do we handle re-extraction without re-charging users? Possibly: re-extract only when schema changes are major, and amortize the cost.
- **Client-side search performance:** At what corpus size does client-side decrypted search become too slow? Need to benchmark.
- **Recovery key UX:** How do we make recovery keys discoverable and usable without making users feel like they need a security degree to use the app?
- **Pattern Mirror false positives:** The model will sometimes mis-classify pushback or other behaviors. How do we surface low-confidence extractions in a way that invites correction without undermining trust in the patterns?

---

## 9. Future work (not in this release)

These are referenced for context but explicitly **not in scope** for this PRD:


- **Cross-model support:** Extending Chatdex to support GPT, Gemini, and other AI assistants. The architecture should not preclude this, but it is not a v1 feature.
- **Comparison features:** Showing how different models would have responded to the same prompt. Interesting but expensive and out of scope.
- **Wrapped-style annual recap:** A shareable annual summary of the user's Claude usage. Possible future feature, not in v1.

---

## 10. Definition of done

This release is done when:

1. The structured extraction pipeline runs end-to-end on a user's conversation backlog and stores summaries in the local database.
2. Pattern Mirror exists with at least three working pattern views, including Pushback History.
3. Collections can be created, populated, and exported. Suggestions from Pattern Mirror feed into Collections.
4. Tagging works on individual messages. Tags appear inline in the conversation view and as filters in search.
5. Client-side encryption is implemented for the Postgres tier, with passphrase setup, recovery key generation, and migration flow for existing users.
6. The privacy policy is rewritten and published.
7. The "delete all my data" and "export all my data" features work end-to-end.
8. The release is documented in a changelog and announced to existing Chatdex users.

Anything beyond this list is out of scope and goes to a future release. Hold the line.
