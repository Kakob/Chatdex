# Product Requirements Document: AIPKMS
## Claude Utils — AI-Powered Knowledge Management System

**Author:** Jacob  
**Status:** Draft  
**Last Updated:** February 2026  
**Product:** Claude Utils Browser Extension

---

## How AIPKMS relates to the Activity Tracker

Claude Utils contains two complementary capture/curation systems:

| | Activity Tracker | AIPKMS |
|---|---|---|
| **What it is** | Passive telemetry layer | Active curation layer |
| **Mechanism** | Extension intercepts every message, token, artifact | User deliberately anchors exchanges that matter |
| **Output** | Real-time timeline, token usage, model stats | Anchored items, threads, workspaces, synthesis docs |
| **Question it answers** | "What happened?" | "What should I keep and build on?" |

AIPKMS is built **on top of** the conversation store that the Activity Tracker and import pipeline populate. The underlying data (conversations + messages in Postgres) is shared; AIPKMS adds the curation, organization, and resurfacing layer.

**Source-of-truth docs:**
- Core platform (search, analytics, export): [claude-utils-prd.md](./claude-utils-prd.md)
- Activity Tracker (real-time extension): [PRD activity tracker.md](./PRD%20activity%20tracker.md)
- AIPKMS (this doc): you are here

---

## 1. Overview

### 1.1 Product Summary

AIPKMS is a feature module within Claude Utils that transforms Claude conversations from ephemeral chat logs into a persistent, searchable, and intelligent personal knowledge management system. Users can anchor specific messages and responses, organize them across projects, and resurface relevant knowledge in future conversations.

### 1.2 Problem Statement

Claude power users generate significant intellectual value through their conversations — code patterns, architectural decisions, explanations, creative frameworks, study material — but have no mechanism to capture, organize, or reuse these knowledge artifacts. Current solutions (chat history, Claude memory, manual copy-paste) are either too broad, too shallow, or too manual.

### 1.3 Target Users

- **Primary:** Claude Pro/Team subscribers who use Claude daily across multiple projects (developers, researchers, writers, students)
- **Secondary:** Professional users managing complex, long-running projects where institutional knowledge from Claude conversations has recurring value

### 1.4 Success Metrics

| Metric | Target | Timeframe |
|---|---|---|
| Anchored items per active user per week | ≥ 5 | Month 2+ |
| Resurfaced items clicked/injected per week | ≥ 3 | Month 3+ |
| 30-day retention of AIPKMS users | ≥ 70% | Month 3+ |
| Users with 3+ project workspaces | ≥ 40% of AIPKMS users | Month 4+ |
| Net Promoter Score (AIPKMS feature) | ≥ 50 | Quarter 2 |

---

## 2. User Stories & Requirements

### 2.1 Anchor & Annotate

**User Stories:**
- As a user, I want to pin a specific Claude response (or selection within a response) with one click so I can save it for later without leaving my conversation.
- As a user, I want to add tags and a brief annotation to an anchored item so I can remember why I saved it.
- As a user, I want the system to automatically capture the full context (my prompt, Claude's response, conversation ID, timestamp, detected topic) so I don't have to manually record metadata.

**Functional Requirements:**

| ID | Requirement | Priority |
|---|---|---|
| ANC-01 | One-click anchor button injected adjacent to each Claude response in the UI | P0 |
| ANC-02 | Text selection anchoring — highlight a portion of a response and anchor just that selection | P0 |
| ANC-03 | Anchor modal with fields: tags (autocomplete from existing), annotation (free text), priority (low/med/high) | P0 |
| ANC-04 | Auto-capture of context: user prompt, full Claude response, conversation URL, timestamp | P0 |
| ANC-05 | Anchor prompt-response pairs as a unit (not just the response) | P1 |
| ANC-06 | Bulk anchor — select multiple messages in a conversation and anchor as a group | P2 |
| ANC-07 | Keyboard shortcut for quick-anchor (e.g., Cmd+Shift+A) | P1 |

### 2.2 Auto-Categorization

**User Stories:**
- As a user, I want the system to suggest tags and project associations when I anchor something so I spend less time organizing.
- As a user, I want the system to detect the type of knowledge I'm saving (code snippet, explanation, decision, action item) so I can filter by type later.

**Functional Requirements:**

| ID | Requirement | Priority |
|---|---|---|
| CAT-01 | On anchor, send content to Claude API for tag suggestion (up to 5 suggested tags) | P1 |
| CAT-02 | Knowledge type detection: code pattern, architectural decision, explanation, creative idea, study material, action item, reference, debug solution | P1 |
| CAT-03 | Project workspace association — suggest matching existing workspaces or propose new one | P1 |
| CAT-04 | Connection detection — identify links to previously anchored items by semantic similarity | P2 |
| CAT-05 | User can accept, modify, or dismiss all auto-suggestions | P0 |
| CAT-06 | Learning from user corrections — improve suggestions over time based on user edits | P3 |

### 2.3 Cross-Conversation Threads

**User Stories:**
- As a user, I want to group related anchored items from different conversations into a single thread so I can see all my knowledge on a topic in one place.
- As a user, I want the system to suggest items for a thread based on its topic so I don't have to manually hunt for related anchors.

**Functional Requirements:**

| ID | Requirement | Priority |
|---|---|---|
| THR-01 | Create named threads with optional description | P0 |
| THR-02 | Add/remove anchored items to/from threads via drag-and-drop or menu action | P0 |
| THR-03 | Thread view: chronological display of all items with their annotations and source conversation links | P0 |
| THR-04 | Smart thread suggestions — system proposes anchored items that match thread topic | P1 |
| THR-05 | Living threads — opt-in auto-population where new anchors matching criteria are suggested for inclusion | P2 |
| THR-06 | Thread sharing — export a thread as a standalone document (Markdown) | P1 |
| THR-07 | Reorder items within a thread manually | P1 |

### 2.4 Knowledge Resurfacing Engine

**User Stories:**
- As a user, when I start a new Claude conversation, I want to see relevant previously anchored items in a sidebar so I can inject useful context without re-explaining things.
- As a user, I want to inject an anchored item into my current conversation as context with one click.

**Functional Requirements:**

| ID | Requirement | Priority |
|---|---|---|
| RES-01 | Topic detection from user's first message (and ongoing as conversation develops) | P1 |
| RES-02 | Sidebar panel showing relevant anchored items ranked by relevance | P1 |
| RES-03 | One-click inject — append anchored item content to the conversation input as context | P0 |
| RES-04 | Relevance scoring using tag matching + semantic similarity (via embeddings or API) | P1 |
| RES-05 | Option to dismiss/hide resurfaced items | P0 |
| RES-06 | Passive mode (sidebar only) vs. active mode (toast notification for high-relevance matches) | P2 |
| RES-07 | "Related knowledge" indicator on Claude Utils toolbar showing count of relevant items | P1 |

### 2.5 Synthesis Engine

**User Stories:**
- As a user, I want to generate a summary document from all anchored items on a topic or within a thread so I can create reference material without manual compilation.

**Functional Requirements:**

| ID | Requirement | Priority |
|---|---|---|
| SYN-01 | Generate synthesis from a thread or filtered set of anchored items | P1 |
| SYN-02 | Synthesis output formats: Markdown, plain text | P0 |
| SYN-03 | Customizable synthesis prompt — user can specify what kind of document to generate (study guide, decision log, reference sheet, retrospective) | P1 |
| SYN-04 | Source attribution — synthesis doc links back to original anchored items | P1 |
| SYN-05 | Regenerate with different parameters | P1 |
| SYN-06 | Uses Claude API for generation (consumes API credits or included in tier) | P0 |

### 2.6 Project Workspaces

**User Stories:**
- As a user, I want to organize my anchored items and threads by project so I can context-switch cleanly.

**Functional Requirements:**

| ID | Requirement | Priority |
|---|---|---|
| PRJ-01 | Create, rename, archive, delete project workspaces | P0 |
| PRJ-02 | Default workspace for unassigned items | P0 |
| PRJ-03 | Workspace dashboard: item count, recent anchors, threads, synthesis docs | P1 |
| PRJ-04 | Auto-generated project timeline from anchored items (chronological view of decisions and milestones) | P2 |
| PRJ-05 | Quick-switch between workspaces from Claude Utils toolbar | P1 |
| PRJ-06 | Cross-workspace search | P0 |

### 2.7 Export & Interop

**Functional Requirements:**

| ID | Requirement | Priority |
|---|---|---|
| EXP-01 | Export anchored items and threads as Markdown | P0 |
| EXP-02 | Export as JSON (full metadata) | P0 |
| EXP-03 | Obsidian vault export — proper frontmatter, wiki-links between related items | P1 |
| EXP-04 | Notion database export | P2 |
| EXP-05 | CSV export for spreadsheet analysis | P2 |
| EXP-06 | Full data export (complete backup) | P0 |

---

## 3. Technical Architecture

### 3.1 Data Model

```
AnchoredItem {
  id: uuid
  created_at: timestamp
  updated_at: timestamp
  
  // Content
  content_type: enum (full_response | selection | prompt_response_pair)
  user_prompt: text
  claude_response: text
  selected_text: text | null
  
  // Source
  conversation_id: string
  conversation_url: string
  message_index: integer
  
  // Metadata
  tags: string[]
  annotation: text | null
  priority: enum (low | medium | high)
  knowledge_type: enum (code_pattern | architecture_decision | explanation | creative_idea | study_material | action_item | reference | debug_solution)
  
  // Organization
  workspace_id: uuid | null
  thread_ids: uuid[]
  
  // Auto-generated
  auto_tags: string[]
  embedding_vector: float[] | null
  related_item_ids: uuid[]
}

Thread {
  id: uuid
  name: string
  description: text | null
  workspace_id: uuid | null
  item_ids: uuid[] (ordered)
  is_living: boolean
  living_criteria: json | null
  created_at: timestamp
  updated_at: timestamp
}

Workspace {
  id: uuid
  name: string
  description: text | null
  is_archived: boolean
  created_at: timestamp
}

SynthesisDocument {
  id: uuid
  thread_id: uuid | null
  source_item_ids: uuid[]
  document_type: enum (study_guide | decision_log | reference_sheet | retrospective | custom)
  content: text
  format: enum (markdown | plaintext)
  created_at: timestamp
}
```

### 3.2 Storage Strategy

**Local-first architecture:**
- All data stored in browser extension storage (IndexedDB via Dexie.js or similar)
- No mandatory server/cloud dependency for core features
- Optional encrypted cloud sync for cross-device usage (future)

**Storage estimates:**
- Average anchored item: ~2-5KB (text + metadata)
- 1,000 items ≈ 2-5MB — well within extension storage limits
- Embeddings (if local): ~6KB per item (1536-dim float32) — may require cloud for scale

### 3.3 API Usage

| Feature | API Call | Frequency | Cost Consideration |
|---|---|---|---|
| Auto-categorization | Claude Haiku | Per anchor event | Low (~$0.001/anchor) |
| Synthesis generation | Claude Sonnet | On-demand | Medium (~$0.01-0.05/synthesis) |
| Semantic similarity | Embeddings API or Claude | Per anchor + per resurface | Depends on approach |
| Topic detection | Claude Haiku | Per new conversation | Low |

**Cost management:**
- Haiku for lightweight classification tasks
- Sonnet for synthesis only
- Cache embeddings locally
- Batch API calls where possible
- User brings their own API key OR included in premium tier

### 3.4 Extension Integration Points

- **Content script:** Injects anchor buttons into Claude.ai DOM, captures message content
- **Sidebar panel:** Knowledge resurfacing UI, workspace navigation
- **Popup:** Quick search, recent anchors, workspace switcher
- **Background service worker:** API calls, auto-categorization queue, embedding computation
- **Storage:** IndexedDB for structured data, extension storage API for settings

---

## 4. UX Design Notes

### 4.1 Anchor Flow
1. User hovers over Claude response → anchor icon appears (top-right of message)
2. Click → quick-anchor (saves with auto-metadata, no modal)
3. Long-press or Shift+click → full anchor modal (tags, annotation, priority, workspace)
4. Toast confirmation: "Anchored to [workspace] • 3 tags suggested"
5. Undo available for 5 seconds

### 4.2 Resurfacing Flow
1. User types first message in new conversation
2. Before sending (or immediately after), sidebar populates with relevant items
3. Items shown as compact cards: title/snippet, tags, source date
4. Click card → expand to see full content
5. "Inject as context" button → prepends to message input
6. Sidebar persists and updates as conversation develops

### 4.3 Information Architecture
```
Claude Utils Toolbar
├── Search (existing)
├── Analytics (existing)
├── Knowledge Base (AIPKMS)
│   ├── All Anchors (filterable by tag, type, date, workspace)
│   ├── Threads
│   ├── Workspaces
│   │   ├── [Project Name]
│   │   │   ├── Anchored Items
│   │   │   ├── Threads
│   │   │   ├── Synthesis Docs
│   │   │   └── Timeline
│   │   └── ...
│   └── Synthesis
├── Prompt Library (existing)
└── Settings
```

---

## 5. Rollout Strategy

### Phase 1: Foundation (v1.0) — 4-6 weeks
- Anchor & annotate (ANC-01 through ANC-05)
- Manual tagging and organization
- Basic search and filter across anchored items
- Workspace creation and management
- Markdown export

**Goal:** Validate that users anchor items regularly and find value in retrieval.

### Phase 2: Intelligence (v1.5) — 4-6 weeks
- Auto-categorization (CAT-01 through CAT-03)
- Cross-conversation threads (THR-01 through THR-03, THR-06)
- Knowledge resurfacing sidebar (RES-01 through RES-03)
- Keyboard shortcuts

**Goal:** Validate that auto-features reduce friction and resurfacing changes conversation behavior.

### Phase 3: Synthesis & Scale (v2.0) — 4-6 weeks
- Synthesis engine (SYN-01 through SYN-05)
- Smart/living threads (THR-04, THR-05)
- Semantic similarity and connection detection (CAT-04)
- Project timeline view
- Obsidian integration

**Goal:** Demonstrate compounding value — users with 3+ months of data get qualitatively different experience.

### Phase 4: Polish & Expand (v2.5+)
- Active resurfacing mode (toasts)
- Notion export
- Cloud sync (encrypted)
- Auto-categorization learning from corrections
- Bulk operations and advanced thread management

---

## 6. Pricing Integration

AIPKMS should be positioned as the premium differentiator for Claude Utils:

| Tier | Price | AIPKMS Features |
|---|---|---|
| **Free** | $0 | 20 anchored items, 1 workspace, basic search |
| **Pro** | $15 one-time | Unlimited anchors, workspaces, threads, export, resurfacing |
| **Power** | $29 one-time | Everything in Pro + synthesis engine, auto-categorization, Obsidian integration |

**Alternative model:** If synthesis/auto-categorization API costs are significant, consider $10/one-time for core + $3-5/mo for AI-powered features (or BYOK — bring your own API key).

---

## 7. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Claude.ai DOM changes break anchor injection | High | High | Abstract DOM selectors, maintain selector config, automated detection of breakage |
| Users don't develop anchoring habit | High | Medium | Onboarding flow, smart prompts ("This looks important — anchor it?"), usage nudges |
| API costs for auto-features exceed revenue | Medium | Medium | BYOK option, aggressive caching, Haiku for classification |
| Storage limits for heavy users | Medium | Low | IndexedDB scales to hundreds of MB; implement archival for old items |
| Anthropic releases native feature overlap | High | Medium | Stay ahead on organization/synthesis; native features validate the category |
| Extension review/approval delays | Medium | Medium | Comply with Chrome Web Store policies from day one; no remote code execution |

---

## 8. Open Questions

1. **Embedding strategy:** Local embeddings (smaller model, no API cost, limited quality) vs. API embeddings (better quality, per-call cost)? Or hybrid — local for rough matching, API for synthesis?

2. **Multi-browser support:** Chrome first, but Firefox/Safari on the roadmap? Architecture decisions now affect portability later.

3. **Collaboration features:** Should workspaces/threads be shareable with team members? This changes the storage architecture significantly (requires server).

4. **Claude API key model:** Require users to bring their own key for AI features, or include API costs in pricing? BYOK is simpler but adds onboarding friction.

5. **Offline behavior:** Full offline capability for browsing/searching anchored items? Or require connectivity for all features?

6. **Conversation context injection format:** When resurfacing items, what's the optimal format for injecting them as context into a new conversation? Plain text? XML-tagged? System prompt style?
