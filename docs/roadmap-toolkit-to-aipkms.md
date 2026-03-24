# Roadmap: Power Toolkit → AIPKMS Integration

## Context

Claude Utils has a working core (search, analytics, import, conversation browser, activity tracker) but two layers remain unbuilt: the remaining **power toolkit** features (Prompt Library, Bookmarks, Conversation Tagging, Export, Keyboard Shortcuts) and the entire **AIPKMS** knowledge management system. The user wants a roadmap that shows how these layers connect — building toolkit features that naturally scaffold into AIPKMS capabilities.

**Key insight:** Several toolkit features are *simpler versions* of AIPKMS features. Building them first validates UX patterns, creates shared infrastructure, and provides a migration path.

---

## Phase 0: Shared Infrastructure (3-4 weeks) — COMPLETE

Build cross-cutting foundations that every subsequent phase depends on.

### 0A. Tag System ✅
- [x] `tags` + `entity_tags` tables in `backend/src/db/schema.ts`
- [x] Backend route: `backend/src/routes/tags.ts` (CRUD + entity tagging + autocomplete)
- [x] Frontend: `TagInput.tsx` (autocomplete), `TagBadge.tsx` (display), `tagStore.ts`
- [x] Tag/EntityTag types in `src/types/unified.ts`
- [x] `tagApi` methods in `src/lib/api.ts`
- [ ] Migrate `prompts.tags` text[] to join table (deferred to Phase 1A)

**Why first:** Tags are needed by Prompt Library, Conversation Tagging, Bookmarks, Anchors, and Auto-categorization. One system, not five.

### 0B. Export Infrastructure ✅
- [x] `src/lib/exporters/` — markdown.ts, json.ts, csv.ts, index.ts (dispatcher + download helper)
- [x] `src/components/common/ExportMenu.tsx` — shared format picker dropdown
- [x] Wired up Download button in `ConversationView.tsx` (Markdown + JSON export)
- [x] Refactored `TimelinePage.tsx` to use shared exporters

**Why first:** Both toolkit (conversation export) and AIPKMS (thread export, synthesis docs) need the same pipeline.

### 0C. Keyboard Shortcuts / Command Palette ✅
- [x] `useKeyboardShortcuts.ts` + `useGlobalShortcutListener` hooks with central registry
- [x] `shortcutStore.ts` — Zustand store for shortcut registry + palette state
- [x] `CommandPalette.tsx` (Cmd+K) — searchable action list with nav + registered shortcuts
- [x] Mounted in `Layout.tsx`, Cmd+K registered globally
- [x] Refactored `SearchBar.tsx` "/" shortcut to use the new system

---

## Phase 1: Power Toolkit Completion (4-5 weeks)

### 1A. Prompt Library
- Backend route: `backend/src/routes/prompts.ts` (CRUD, search, filter)
- Full UI: `PromptCard`, `PromptEditor`, `PromptList` with folder sidebar
- "Copy to clipboard" + "Insert as template" actions

→ **AIPKMS bridge:** The "inject" mechanic becomes the prototype for Resurfacing's "inject as context" (Phase 3B). Same code path, different source.

### 1B. Conversation Bookmarks
- `bookmarks` table (conversationId, messageId, note, tags via entity_tags)
- Bookmark icon on `MessageBubble.tsx` and `ConversationCard.tsx`
- Filterable bookmark list page

→ **AIPKMS bridge:** Bookmarks are the simpler precursor to Anchored Items. Schema designed to migrate to `anchored_items` by adding columns (annotation, priority, knowledge_type, embedding_vector). Same DOM placement as anchor buttons.

### 1C. Conversation Tagging
- Tag conversations via shared `entity_tags` (entity_type='conversation')
- Tag display/editing on `ConversationCard.tsx`, tag filter pills on list
- Batch tagging for multiple conversations

→ **AIPKMS bridge:** Conversation tags feed the vocabulary that Auto-categorization (Phase 3A) draws from. Tags propagate as suggestions when anchoring messages from tagged conversations.

---

## Phase 2: AIPKMS Foundation — Anchoring (4-6 weeks)

### 2A. Anchored Items
- `anchored_items` table (full PRD data model: content_type, user_prompt, claude_response, selected_text, tags, annotation, priority, knowledge_type, workspace_id)
- `AnchorButton.tsx` on `MessageBubble.tsx` — quick-click or shift-click for full modal
- `AnchorModal.tsx` with TagInput, annotation, priority, type selector
- `KnowledgePage.tsx` — new sidebar nav item with anchor list view
- Text selection anchoring (floating button on highlight)
- Auto-capture of preceding user prompt as context
- Optional migration path from bookmarks → anchored items

### 2B. Extension Anchor Support
- Inject anchor buttons into claude.ai DOM (via content-script)
- New `ANCHOR_REQUEST` message type → `POST /api/anchors`
- Pre-populate from activity metadata (fullContent, userMessage already captured)

---

## Phase 3: AIPKMS Intelligence (5-7 weeks)

### 3A. Auto-Categorization
- `backend/src/routes/categorize.ts` — calls Claude Haiku for tag suggestions + knowledge type detection
- Suggestions appear as accept/dismiss pills in `AnchorModal.tsx`
- Draws from shared tag vocabulary across all entity types (prompts, conversations, anchors)

### 3B. Knowledge Resurfacing
- `backend/src/routes/resurface.ts` — ranked anchor retrieval by tag match + keyword relevance
- Extension sidebar panel showing relevant anchors when typing on claude.ai
- One-click inject into conversation input (reuses Prompt Library inject code from 1A)
- Webapp: "Related knowledge" widget on Search page

### 3C. Cross-Conversation Threads
- `threads` + `thread_items` tables (ordered items with positions)
- Thread CRUD, drag-and-drop reordering, "Add to thread" on every anchor card
- Thread view: chronological display with annotations and source links
- Thread export via shared Markdown exporter (Phase 0B)

---

## Phase 4: Synthesis & Scale (5-7 weeks)

### 4A. Project Workspaces
- `workspaces` table, workspace_id FKs on anchors and threads
- Workspace dashboard, sidebar switcher, cross-workspace search
- Default "Unassigned" workspace

### 4B. Synthesis Engine
- `backend/src/routes/synthesis.ts` — Claude Sonnet API, customizable document types
- `synthesis_documents` table with source attribution
- SynthesisModal (type picker, prompt customization) + SynthesisView (rendered with source links)
- Export via shared Markdown exporter

### 4C. Embedding-Based Similarity
- pgvector extension, `embedding_vector` column on anchored_items
- Upgrades resurfacing from keyword → cosine similarity
- Connection detection ("Related items" panel on each anchor)
- Living threads auto-suggest new items by semantic match

---

## Phase 5: Polish & Expand (ongoing)
- Obsidian vault export (frontmatter, wiki-links)
- Active resurfacing (toast notifications for high-relevance matches)
- Auto-categorization learning from user corrections
- Cloud sync (encrypted, cross-device)
- Notion export

---

## Integration Dependency Map

```
Phase 0: Infrastructure
  Tag System ──────────┬──────────────────────────────────────┐
  Export Infra ─────────┤                                      │
  Keyboard Shortcuts ───┤                                      │
                        │                                      │
Phase 1: Toolkit        │                                      │
  Prompt Library ───────┤── "inject" pattern ──> Resurfacing   │
  Bookmarks ────────────┤── schema migration ──> Anchors       │
  Conv Tagging ─────────┤── tag vocabulary ────> Auto-Cat      │
                        │                                      │
Phase 2: Foundation     │                                      │
  Anchored Items <──────┘                                      │
  Extension Anchoring                                          │
                                                               │
Phase 3: Intelligence                                          │
  Auto-Categorization <── tag vocab from all entity types ─────┘
  Resurfacing <── inject pattern from Prompt Library
  Threads

Phase 4: Scale
  Workspaces <── folder pattern from Prompt Library
  Synthesis <── export infra + threads
  Embeddings <── upgrades auto-cat + resurfacing
```

## Key Files to Modify

| File | Changes |
|------|---------|
| `backend/src/db/schema.ts` | New tables: tags, entity_tags, bookmarks, anchored_items, threads, thread_items, workspaces, synthesis_documents |
| `src/types/unified.ts` | New interfaces: Tag, Bookmark, AnchoredItem, Thread, Workspace, SynthesisDocument |
| `src/components/conversations/MessageBubble.tsx` | Bookmark icon (Phase 1B) → Anchor button (Phase 2A) |
| `src/lib/api.ts` | Methods for every new backend route |
| `backend/src/index.ts` | Register new routes |
| `extension/content-script.ts` | Anchor button injection, topic detection for resurfacing |
| `src/pages/PromptsPage.tsx` | Replace stub with full implementation |

## Verification

Each phase should be testable end-to-end:
- **Phase 0:** Create a tag, see it autocomplete across TagInput instances; export a conversation as Markdown; open Command Palette with Cmd+K
- **Phase 1:** Save a prompt with tags, bookmark a message, tag a conversation, verify tags share vocabulary
- **Phase 2:** Anchor a message from conversation browser, verify context auto-captured, view in Knowledge page; anchor from extension on claude.ai
- **Phase 3:** Anchor something and see tag suggestions; start a new conversation and see relevant anchors in sidebar; create a thread from multiple anchors and export
- **Phase 4:** Create workspaces, assign anchors; generate a synthesis doc from a thread; see semantically similar items surface
