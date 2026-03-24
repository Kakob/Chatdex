# Claude Utils

**Product Requirements Document**

Version 2.0 | January 2026

---

## Executive Summary

Claude Utils is a browser-based power toolkit for Claude users. It provides search, analytics, export, and organization features that Anthropic doesn't offer natively. The product runs entirely client-side — no server, no data collection — which is both a technical constraint and a core selling point.

**Target customer**: Claude Pro/Max subscribers and Claude Code users who use Claude daily for work and have accumulated significant conversation history.

**Business model**: Freemium with one-time purchase option. Free tier provides value and builds trust; paid tier unlocks full functionality.

**Differentiators**:
1. Privacy-first (data never leaves browser)
2. Unified search across Claude.ai AND Claude Code
3. Toolkit approach (multiple features vs. single-purpose tools)
4. One-time purchase (no subscription fatigue)

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Solution Overview](#solution-overview)
3. [Target Users](#target-users)
4. [Feature Specifications](#feature-specifications)
5. [Data Architecture](#data-architecture)
6. [Technical Architecture](#technical-architecture)
7. [Business Model](#business-model)
8. [User Flows](#user-flows)
9. [UI/UX Design](#uiux-design)
10. [Development Roadmap](#development-roadmap)
11. [Success Metrics](#success-metrics)
12. [Competitive Analysis](#competitive-analysis)
13. [Open Questions](#open-questions)
14. [Risks & Mitigations](#risks--mitigations)
15. [Appendix](#appendix)

---

## Problem Statement

### The Pain Points

**1. Search is broken**
Claude.ai search only matches conversation titles. Users can't find information they know they discussed. With hundreds of conversations, this becomes a real productivity drain.

> "I know I figured out that regex pattern with Claude last month, but I can't find it."

**2. No visibility into usage**
Users pay $20-200/month for Claude but have no idea how they're actually using it. No message counts, no topic breakdowns, no trends over time.

> "Am I getting value from my Claude subscription? I genuinely don't know."

**3. Data is trapped**
Claude's export is a ZIP of raw JSON — not human readable, not useful for documentation or sharing. Users want markdown, PDF, or formatted exports.

> "I need to share this conversation with my team but there's no good way to export it."

**4. Claude Code has no tools at all**
Logs are buried in `~/.claude/projects/` as undocumented JSONL files. No search, no viewer, no export. Power users are flying blind.

> "I spent 3 hours with Claude Code yesterday solving a bug. Now I can't find what we did."

**5. Prompts get lost**
Users develop effective prompts through trial and error, then lose them. No native way to save, organize, or reuse prompts.

> "I had a perfect prompt for code review. Now I'm trying to recreate it from memory."

### Why These Problems Exist

Anthropic is focused on the core AI product, not power-user tooling. These are "nice to have" features that serve a subset of users. Third-party tools can move faster and serve this niche better.

---

## Solution Overview

Claude Utils is a browser-based toolkit that solves all five pain points:

| Problem | Solution |
|---------|----------|
| Search is broken | Full-text search across all conversations |
| No usage visibility | Analytics dashboard with stats and trends |
| Data is trapped | Export to Markdown, PDF, JSON |
| Claude Code has no tools | Unified support for Claude Code logs |
| Prompts get lost | Prompt library with organization |

### Core Principles

1. **Privacy-first**: All processing happens in-browser. No server, no tracking, no data collection. This isn't just a constraint — it's a feature.

2. **Works with exports**: Users upload their Claude export once. We parse and index locally. They re-upload to sync new data.

3. **Unified experience**: Claude.ai and Claude Code data in one place, one search, one analytics view.

4. **Progressive value**: Free tier is genuinely useful. Paid tier unlocks power features. Users upgrade when they hit limits.

---

## Target Users

### Primary Persona: The Professional Claude User

**Demographics**:
- Software developers, writers, researchers, consultants
- Uses Claude 5-20+ times per day
- Claude Pro or Max subscriber ($20-200/month)
- Technically comfortable but not necessarily a developer

**Behaviors**:
- Has 100-1000+ conversations accumulated
- Uses Claude for work (code, writing, research, analysis)
- Frequently thinks "I know I asked Claude about this before"
- Values productivity tools, willing to pay for time savings

**Quote**: "Claude is my second brain, but I can't search my own brain."

### Secondary Persona: The Claude Code Power User

**Demographics**:
- Software developers using Claude Code daily
- Working on multiple projects
- Generates hundreds of sessions per month

**Behaviors**:
- Needs to reference past solutions
- Wants to see what files were changed across sessions
- Debugging often requires finding "what did we try before"

**Quote**: "I pair program with Claude all day. I need to search our history."

### Tertiary Persona: The Curious Subscriber

**Demographics**:
- Claude Pro subscriber questioning the value
- Not sure if they're using it enough to justify $20/month
- Wants data to make an informed decision

**Behaviors**:
- Checks usage sporadically
- Interested in trends over time
- May downgrade or upgrade based on data

**Quote**: "Am I actually using this enough?"

---

## Feature Specifications

### Feature 1: Universal Search

**Priority**: P0 (Core — must ship in v1)

**Description**: Full-text search across all Claude conversations and Claude Code sessions. Fast, fuzzy, with highlighted results.

**Free tier**: Limited to most recent 100 conversations
**Paid tier**: Unlimited conversations

**Functional Requirements**:

| ID | Requirement | Priority |
|----|-------------|----------|
| S1 | Search as you type with debouncing (300ms) | P0 |
| S2 | Fuzzy matching (typo tolerance) | P0 |
| S3 | Results show conversation title, date, source badge, snippet | P0 |
| S4 | Search terms highlighted in snippets | P0 |
| S5 | Click result to view full conversation | P0 |
| S6 | Highlight all matches in conversation view | P0 |
| S7 | Jump between matches (prev/next) | P1 |
| S8 | Filter by source (All / Claude.ai / Claude Code) | P0 |
| S9 | Filter by date range | P1 |
| S10 | Search within specific conversation | P2 |
| S11 | Regex search mode | P2 |
| S12 | Search history (recent searches) | P2 |

**Performance Requirements**:
- Results returned in <100ms for up to 1,000 conversations
- Results returned in <500ms for up to 10,000 conversations
- UI remains responsive during search (non-blocking)

**Technical Approach**:
- Fuse.js for fuzzy search
- Pre-built search index stored in IndexedDB
- Web Worker for search execution (non-blocking UI)

---

### Feature 2: Analytics Dashboard

**Priority**: P0 (Core — must ship in v1)

**Description**: Visual insights into Claude usage patterns. Helps users understand their behavior and justify their subscription.

**Free tier**: Basic stats (total conversations, messages)
**Paid tier**: Full analytics with trends, breakdowns, exports

**Functional Requirements**:

| ID | Requirement | Priority |
|----|-------------|----------|
| A1 | Total conversation count (by source) | P0 |
| A2 | Total message count (by role: user/assistant) | P0 |
| A3 | Messages over time (daily/weekly/monthly chart) | P0 |
| A4 | Average conversation length | P1 |
| A5 | Busiest days/hours heatmap | P1 |
| A6 | Longest conversations list | P1 |
| A7 | Topic clustering (basic keyword extraction) | P2 |
| A8 | Token count estimates | P1 |
| A9 | Estimated API cost equivalent | P2 |
| A10 | Export stats as CSV/JSON | P1 |
| A11 | Date range filter for all stats | P1 |
| A12 | Compare periods (this month vs last month) | P2 |

**Visualizations**:
- Line chart: Messages over time
- Bar chart: Messages by day of week
- Heatmap: Activity by hour and day
- Pie chart: Claude.ai vs Claude Code split
- Number cards: Key metrics

**Technical Approach**:
- Recharts or Chart.js for visualizations
- Compute stats on import, store aggregates in IndexedDB
- Incremental updates on sync

---

### Feature 3: Export Center

**Priority**: P0 (Core — must ship in v1)

**Description**: Export conversations in useful formats. Transform Claude's raw JSON into shareable, readable documents.

**Free tier**: Markdown export only
**Paid tier**: All formats (Markdown, PDF, JSON, HTML)

**Functional Requirements**:

| ID | Requirement | Priority |
|----|-------------|----------|
| E1 | Export single conversation to Markdown | P0 |
| E2 | Export single conversation to PDF | P0 |
| E3 | Export single conversation to JSON (clean) | P1 |
| E4 | Export single conversation to HTML | P1 |
| E5 | Bulk export (multiple conversations) | P1 |
| E6 | Export all conversations as ZIP | P1 |
| E7 | Include/exclude timestamps option | P1 |
| E8 | Include/exclude code blocks option | P2 |
| E9 | Custom filename template | P2 |
| E10 | PDF styling options (font, margins) | P2 |
| E11 | Export analytics report as PDF | P2 |

**Format Specifications**:

*Markdown*:
```markdown
# Conversation Title
*Exported from Claude Utils • January 23, 2026*

---

**User** (2:34 PM):
How do I center a div?

**Claude** (2:34 PM):
Here are several ways to center a div...

```

*PDF*:
- Clean typography (system fonts)
- Code blocks with syntax highlighting
- Page headers with conversation title
- Page numbers in footer

**Technical Approach**:
- Markdown: String templating
- PDF: jsPDF or react-pdf
- HTML: Styled template
- Bulk: JSZip for packaging

---

### Feature 4: Prompt Library

**Priority**: P1 (Important — ship in v1.1)

**Description**: Save, organize, and reuse effective prompts. Build a personal collection of prompts that work.

**Free tier**: Up to 10 saved prompts
**Paid tier**: Unlimited prompts, folders, tags

**Functional Requirements**:

| ID | Requirement | Priority |
|----|-------------|----------|
| P1 | Save prompt with title and description | P0 |
| P2 | Copy prompt to clipboard | P0 |
| P3 | Edit saved prompts | P0 |
| P4 | Delete prompts | P0 |
| P5 | Search prompts | P1 |
| P6 | Organize with folders | P1 |
| P7 | Tag prompts | P1 |
| P8 | Filter by folder/tag | P1 |
| P9 | Import prompts from JSON | P2 |
| P10 | Export prompts to JSON | P2 |
| P11 | Extract prompt from conversation | P2 |
| P12 | Prompt templates with variables | P2 |

**Data Model**:
```typescript
interface Prompt {
  id: string;
  title: string;
  content: string;
  description?: string;
  folder?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
}
```

---

### Feature 5: Conversation Browser

**Priority**: P0 (Core — must ship in v1)

**Description**: A better way to browse and view conversations than Claude's native UI or raw JSON exports.

**Free tier**: Full access
**Paid tier**: Full access (no restrictions)

**Functional Requirements**:

| ID | Requirement | Priority |
|----|-------------|----------|
| B1 | List all conversations with title, date, message count | P0 |
| B2 | Sort by date, title, message count | P0 |
| B3 | Filter by source | P0 |
| B4 | View full conversation with proper formatting | P0 |
| B5 | Code blocks with syntax highlighting | P0 |
| B6 | Copy individual messages | P1 |
| B7 | Copy entire conversation | P1 |
| B8 | Keyboard navigation (j/k to move, enter to open) | P1 |
| B9 | Infinite scroll or pagination for large lists | P1 |
| B10 | Claude Code: Show tool use blocks | P1 |
| B11 | Claude Code: Show file diffs | P2 |
| B12 | Conversation bookmarking | P2 |

---

### Feature 6: Data Management

**Priority**: P0 (Core — must ship in v1)

**Description**: Import, sync, and manage local data. The foundation that makes everything else work.

**Free tier**: Full access
**Paid tier**: Full access (no restrictions)

**Functional Requirements**:

| ID | Requirement | Priority |
|----|-------------|----------|
| D1 | Import Claude.ai ZIP export | P0 |
| D2 | Import Claude.ai conversations.json | P0 |
| D3 | Import Claude Code JSONL files | P0 |
| D4 | Import multiple JSONL files at once | P0 |
| D5 | Auto-detect format on upload | P0 |
| D6 | Progress indicator for large imports | P0 |
| D7 | Merge new data with existing (no duplicates) | P0 |
| D8 | Show "last synced" timestamp per source | P0 |
| D9 | Clear all data | P1 |
| D10 | Clear data by source | P1 |
| D11 | Storage usage indicator | P1 |
| D12 | Export local database for backup | P2 |
| D13 | Import local database backup | P2 |

**Error Handling**:
- Invalid file format: Clear error message with expected formats
- Corrupted JSON: Partial import with error report
- Duplicate detection: Skip duplicates, report count

---

## Data Architecture

### Source Data Formats

#### Claude.ai Export

Location: User downloads ZIP from Settings → Privacy → Export Data

```typescript
// conversations.json (inside ZIP)
interface ClaudeAIExport {
  conversations: ClaudeAIConversation[];
}

interface ClaudeAIConversation {
  uuid: string;
  name: string;
  summary?: string;
  created_at: string;
  updated_at: string;
  chat_messages: ClaudeAIMessage[];
}

interface ClaudeAIMessage {
  uuid: string;
  sender: "human" | "assistant";
  text: string;
  created_at: string;
  attachments?: Attachment[];
  // Artifacts, thinking blocks, etc. may also be present
}
```

#### Claude Code Logs

Location: `~/.claude/projects/<project-id>/<session-id>.jsonl`

```typescript
// Each line is one of these entry types
type ClaudeCodeEntry = 
  | UserEntry 
  | AssistantEntry 
  | SystemEntry 
  | ToolUseEntry 
  | ToolResultEntry;

interface UserEntry {
  type: "user";
  message: { content: string | ContentBlock[] };
  timestamp: string;
}

interface AssistantEntry {
  type: "assistant";
  message: { content: string | ContentBlock[] };
  timestamp: string;
}

interface ToolUseEntry {
  type: "tool_use";
  tool_name: string;  // "bash", "str_replace", "write", etc.
  tool_input: object;
  timestamp: string;
}

interface ToolResultEntry {
  type: "tool_result";
  tool_name: string;
  result: string;
  timestamp: string;
}

interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  // Additional fields for tool blocks
}

// First entry often contains session metadata
interface SessionMetadata {
  session_id: string;
  cwd: string;           // Working directory
  git_branch?: string;
  model?: string;
}
```

### Unified Data Model (IndexedDB)

```typescript
// ============ CONVERSATIONS ============
interface StoredConversation {
  // Identity
  id: string;                      // Primary key (uuid or generated)
  source: "claude.ai" | "claude-code";
  
  // Display
  name: string;                    // Title or derived name
  summary: string | null;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  importedAt: Date;
  
  // Stats
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  estimatedTokens: number;
  
  // Search
  fullText: string;                // Concatenated for search indexing
  
  // Claude Code specific
  projectPath?: string;
  gitBranch?: string;
  workingDirectory?: string;
}

// ============ MESSAGES ============
interface StoredMessage {
  id: string;                      // Primary key
  conversationId: string;          // Foreign key (indexed)
  
  sender: "user" | "assistant" | "system" | "tool";
  text: string;
  createdAt: Date;
  
  // Tool use (Claude Code)
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
}

// ============ PROMPTS ============
interface StoredPrompt {
  id: string;
  title: string;
  content: string;
  description: string;
  folder: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
}

// ============ METADATA ============
interface AppMetadata {
  key: string;                     // Primary key
  value: any;
}

// Keys:
// - "lastSync.claude.ai" -> Date
// - "lastSync.claude-code" -> Date
// - "stats.totalConversations" -> number
// - "stats.totalMessages" -> number
// - "license.key" -> string | null
// - "license.validatedAt" -> Date | null
// - "settings.theme" -> "light" | "dark" | "system"
```

### IndexedDB Schema (Dexie.js)

```typescript
import Dexie, { Table } from 'dexie';

class ClaudeUtilsDB extends Dexie {
  conversations!: Table<StoredConversation>;
  messages!: Table<StoredMessage>;
  prompts!: Table<StoredPrompt>;
  metadata!: Table<AppMetadata>;

  constructor() {
    super('ClaudeUtils');
    
    this.version(1).stores({
      conversations: 'id, source, createdAt, updatedAt, name',
      messages: 'id, conversationId, createdAt',
      prompts: 'id, folder, *tags, createdAt',
      metadata: 'key'
    });
  }
}

export const db = new ClaudeUtilsDB();
```

### Storage Estimates

| Data | Size per unit | 1000 conversations |
|------|---------------|-------------------|
| Conversation metadata | ~500 bytes | 500 KB |
| Messages (avg 50/convo) | ~200 bytes each | 10 MB |
| Search index | ~100 bytes/convo | 100 KB |
| **Total** | | **~11 MB** |

IndexedDB typically allows 50MB-unlimited depending on browser. Should be fine for even heavy users.

---

## Technical Architecture

### Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Framework | React 18 + TypeScript | Industry standard, good ecosystem |
| Build | Vite | Fast dev server, optimized builds |
| Routing | React Router v6 | Simple client-side routing |
| State | Zustand | Lightweight, no boilerplate |
| Storage | Dexie.js (IndexedDB) | Best IndexedDB wrapper, typed |
| Search | Fuse.js | Client-side fuzzy search |
| Charts | Recharts | React-native, composable |
| PDF | jsPDF + html2canvas | Client-side PDF generation |
| ZIP | JSZip | Parse and create ZIPs |
| Styling | Tailwind CSS | Rapid development |
| Icons | Lucide React | Clean, consistent icons |
| Syntax Highlighting | Prism.js or Shiki | Code block formatting |

### Project Structure

```
claude-utils/
├── public/
│   ├── favicon.ico
│   └── og-image.png
├── src/
│   ├── components/
│   │   ├── common/
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Card.tsx
│   │   │   └── Badge.tsx
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── Layout.tsx
│   │   ├── search/
│   │   │   ├── SearchBar.tsx
│   │   │   ├── SearchResults.tsx
│   │   │   ├── SearchFilters.tsx
│   │   │   └── SearchHighlight.tsx
│   │   ├── analytics/
│   │   │   ├── StatsCards.tsx
│   │   │   ├── ActivityChart.tsx
│   │   │   ├── HeatmapChart.tsx
│   │   │   └── SourceBreakdown.tsx
│   │   ├── conversations/
│   │   │   ├── ConversationList.tsx
│   │   │   ├── ConversationView.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   └── ToolUseBlock.tsx
│   │   ├── export/
│   │   │   ├── ExportModal.tsx
│   │   │   ├── FormatSelector.tsx
│   │   │   └── ExportProgress.tsx
│   │   ├── prompts/
│   │   │   ├── PromptList.tsx
│   │   │   ├── PromptEditor.tsx
│   │   │   └── PromptCard.tsx
│   │   ├── import/
│   │   │   ├── ImportZone.tsx
│   │   │   ├── ImportProgress.tsx
│   │   │   └── ImportSummary.tsx
│   │   └── settings/
│   │       ├── SettingsPage.tsx
│   │       ├── LicenseInput.tsx
│   │       └── DataManagement.tsx
│   ├── hooks/
│   │   ├── useSearch.ts
│   │   ├── useConversations.ts
│   │   ├── useAnalytics.ts
│   │   ├── usePrompts.ts
│   │   ├── useExport.ts
│   │   ├── useLicense.ts
│   │   └── useTheme.ts
│   ├── lib/
│   │   ├── db.ts                 # Dexie schema
│   │   ├── search.ts             # Fuse.js setup
│   │   ├── analytics.ts          # Stats computation
│   │   ├── license.ts            # License validation
│   │   ├── parsers/
│   │   │   ├── index.ts          # Format detection
│   │   │   ├── claude-ai.ts      # Claude.ai parser
│   │   │   └── claude-code.ts    # Claude Code parser
│   │   ├── exporters/
│   │   │   ├── markdown.ts
│   │   │   ├── pdf.ts
│   │   │   ├── json.ts
│   │   │   └── html.ts
│   │   └── utils/
│   │       ├── tokens.ts         # Token estimation
│   │       ├── dates.ts          # Date formatting
│   │       └── strings.ts        # Text utilities
│   ├── pages/
│   │   ├── SearchPage.tsx
│   │   ├── AnalyticsPage.tsx
│   │   ├── ConversationsPage.tsx
│   │   ├── PromptsPage.tsx
│   │   ├── ImportPage.tsx
│   │   └── SettingsPage.tsx
│   ├── stores/
│   │   ├── appStore.ts           # Global app state
│   │   └── searchStore.ts        # Search state
│   ├── types/
│   │   ├── claude-ai.ts
│   │   ├── claude-code.ts
│   │   ├── unified.ts
│   │   └── app.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── docs/
│   └── prd.md
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── CLAUDE.md
├── LICENSE
└── README.md
```

### Performance Considerations

**Large Dataset Handling**:
- Parse imports in Web Worker (non-blocking UI)
- Search in Web Worker
- Virtual scrolling for long lists (react-window)
- Paginate database queries (100 items per page)
- Lazy load conversation messages (fetch on view)

**Initial Load**:
- Code split by route (React.lazy)
- Preload critical CSS
- Service worker for offline support (future)

**Search Optimization**:
- Build Fuse index on import, store serialized
- Debounce search input (300ms)
- Limit results (show top 50, load more on scroll)

---

## Business Model

### Pricing Strategy

**One-time purchase** (not subscription)

| Tier | Price | Rationale |
|------|-------|-----------|
| Free | $0 | Acquisition, trust building |
| Pro | $29 | One-time, lifetime access |

**Why one-time vs subscription**:
- Developer tools have subscription fatigue
- No server costs to justify recurring
- Simpler to implement (no auth system)
- Higher conversion rate for impulse purchases
- "Pay once, own forever" is a selling point

### Free vs Pro Features

| Feature | Free | Pro |
|---------|------|-----|
| Search | 100 conversations | Unlimited |
| Analytics | Basic stats only | Full dashboard |
| Export | Markdown only | All formats |
| Prompts | 10 prompts | Unlimited |
| Browser | Full access | Full access |
| Import | Full access | Full access |
| Support | Community | Email |

### Revenue Projections (Conservative)

| Scenario | Monthly visitors | Conversion | Revenue/month |
|----------|-----------------|------------|---------------|
| Launch | 500 | 2% = 10 sales | $290 |
| Growth | 2,000 | 2% = 40 sales | $1,160 |
| Mature | 5,000 | 3% = 150 sales | $4,350 |

**Break-even analysis**:
- Domain: $12/year
- Hosting (Vercel): Free tier
- Payment processing: 2.9% + $0.30 per transaction
- Time investment: 40-60 hours initial build

### Payment & Licensing

**Payment processor**: LemonSqueezy or Gumroad
- Handles payments, taxes, refunds
- Provides license key generation
- No need to build auth system

**License validation**:
```typescript
// Simple client-side check
interface License {
  key: string;
  email: string;
  createdAt: string;
  signature: string;  // HMAC signature for offline validation
}

function validateLicense(license: License): boolean {
  // Verify signature matches (prevents tampering)
  const expected = hmac(SECRET, `${license.key}:${license.email}:${license.createdAt}`);
  return license.signature === expected;
}
```

**Piracy consideration**: 
Yes, it's crackable. Every client-side app is. The target customer (professional Claude user) is likely to pay $29 for a legitimate tool. Don't over-engineer DRM.

---

## User Flows

### Flow 1: First-Time User

```
1. Land on marketing page (/)
2. Click "Try Free" → App (/app)
3. See empty state with import prompt
4. Click "Import Data"
5. Choose source:
   a. Claude.ai → Drag ZIP file
   b. Claude Code → Drag JSONL files
6. See import progress
7. Import complete → Redirect to Search
8. Search works! Explore analytics, export
9. Hit free tier limit → See upgrade prompt
10. Click "Upgrade" → LemonSqueezy checkout
11. Enter license key in Settings
12. Full access unlocked
```

### Flow 2: Returning User

```
1. Visit app (/app)
2. Data loaded from IndexedDB automatically
3. Last page remembered (e.g., Analytics)
4. Use app normally
5. Optionally sync new data:
   a. Click "Sync" in header
   b. Upload new export
   c. New conversations merged (deduped)
```

### Flow 3: Search

```
1. Focus search bar (/ shortcut)
2. Type query
3. Results appear in real-time (debounced)
4. Filter by source if needed
5. Click result
6. View conversation with highlights
7. Navigate matches (n/p or arrows)
8. Export conversation if needed
```

### Flow 4: Export

```
1. View conversation OR select from list
2. Click "Export"
3. Choose format (Markdown, PDF, etc.)
4. Configure options (timestamps, etc.)
5. Click "Download"
6. File saved to Downloads
```

---

## UI/UX Design

### Design Principles

1. **Clean and minimal**: No visual clutter. Focus on content.
2. **Fast feedback**: Instant response to all actions.
3. **Keyboard-first**: Power users live on the keyboard.
4. **Accessible**: WCAG 2.1 AA compliance.
5. **Dark mode native**: Many developers prefer dark.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [Logo] Claude Utils          [Sync] [Settings] [Theme] [Pro]  │
├──────────┬──────────────────────────────────────────────────────┤
│          │                                                      │
│  Search  │                                                      │
│          │                                                      │
│  ────────│                    Main Content                      │
│          │                                                      │
│ Analytics│                                                      │
│          │                                                      │
│  ────────│                                                      │
│          │                                                      │
│  Browse  │                                                      │
│          │                                                      │
│  ────────│                                                      │
│          │                                                      │
│  Prompts │                                                      │
│          │                                                      │
│  ────────│                                                      │
│          │                                                      │
│  Import  │                                                      │
│          │                                                      │
└──────────┴──────────────────────────────────────────────────────┘
```

### Color Palette

**Light mode**:
- Background: #FFFFFF
- Surface: #F9FAFB
- Border: #E5E7EB
- Text: #111827
- Text secondary: #6B7280
- Primary: #8B5CF6 (purple — Claude's color)
- Primary hover: #7C3AED

**Dark mode**:
- Background: #111827
- Surface: #1F2937
- Border: #374151
- Text: #F9FAFB
- Text secondary: #9CA3AF
- Primary: #A78BFA
- Primary hover: #8B5CF6

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `/` | Focus search |
| `Esc` | Clear search / close modal |
| `↑↓` or `jk` | Navigate results |
| `Enter` | Open selected |
| `⌘K` | Command palette (future) |
| `n` / `p` | Next/previous match |
| `e` | Export current |
| `?` | Show shortcuts |

### Responsive Behavior

- **Desktop (1024px+)**: Full sidebar, spacious layout
- **Tablet (768-1023px)**: Collapsible sidebar, touch-friendly
- **Mobile (< 768px)**: Bottom navigation, stacked layout

---

## Development Roadmap

### Phase 1: Foundation (Week 1-2)

**Goal**: Core infrastructure and import working

- [ ] Project setup (Vite, React, TypeScript, Tailwind)
- [ ] Dexie.js database schema
- [ ] Claude.ai parser (ZIP and JSON)
- [ ] Claude Code parser (JSONL)
- [ ] Import flow with progress indicator
- [ ] Basic conversation list view
- [ ] Basic conversation detail view

**Deliverable**: Can import data and browse conversations

### Phase 2: Search (Week 2-3)

**Goal**: Search is fast and useful

- [ ] Fuse.js integration
- [ ] Search bar component
- [ ] Search results with snippets
- [ ] Highlight matches in results
- [ ] Highlight matches in conversation view
- [ ] Source filtering
- [ ] Web Worker for search (non-blocking)

**Deliverable**: Full-text search working

### Phase 3: Analytics (Week 3-4)

**Goal**: Users can see their usage

- [ ] Stats computation on import
- [ ] Stats cards (totals)
- [ ] Activity over time chart
- [ ] Day/hour heatmap
- [ ] Source breakdown
- [ ] Date range filtering

**Deliverable**: Analytics dashboard complete

### Phase 4: Export (Week 4-5)

**Goal**: Users can get their data out

- [ ] Markdown exporter
- [ ] PDF exporter
- [ ] JSON exporter
- [ ] HTML exporter
- [ ] Export modal with options
- [ ] Bulk export (ZIP)

**Deliverable**: All export formats working

### Phase 5: Polish & Launch Prep (Week 5-6)

**Goal**: Ready for public launch

- [ ] Dark mode
- [ ] Keyboard shortcuts
- [ ] Empty states
- [ ] Error states
- [ ] Loading states
- [ ] Mobile responsive
- [ ] Landing page
- [ ] README and docs

**Deliverable**: MVP ready for launch

### Phase 6: Monetization (Week 6-7)

**Goal**: Payment and licensing working

- [ ] LemonSqueezy integration
- [ ] License key input
- [ ] License validation
- [ ] Free tier limits
- [ ] Upgrade prompts
- [ ] Purchase flow

**Deliverable**: Can accept payments

### Phase 7: Prompt Library (Week 7-8)

**Goal**: Prompt management complete

- [ ] Prompt CRUD
- [ ] Folders and tags
- [ ] Search prompts
- [ ] Copy to clipboard
- [ ] Import/export prompts

**Deliverable**: Full prompt library

### Post-Launch

- [ ] Analytics export
- [ ] Regex search
- [ ] Claude Code diff viewer
- [ ] Token counting
- [ ] Command palette
- [ ] Browser extension (stretch)

---

## Success Metrics

### Launch Criteria (MVP)

| Metric | Target |
|--------|--------|
| Import Claude.ai ZIP | Works |
| Import Claude Code JSONL | Works |
| Search returns results | < 200ms |
| Export to Markdown | Works |
| Export to PDF | Works |
| Basic analytics | 5 key metrics |
| Works in Chrome | Yes |
| Works in Firefox | Yes |
| Works in Safari | Yes |
| Mobile usable | Basic functionality |

### Growth Metrics (Post-Launch)

| Metric | 30 days | 90 days | 180 days |
|--------|---------|---------|----------|
| Unique visitors | 500 | 2,000 | 5,000 |
| Imports completed | 100 | 500 | 2,000 |
| Conversion rate | 1% | 2% | 3% |
| Revenue | $145 | $1,160 | $4,350 |
| GitHub stars | 50 | 200 | 500 |

### Quality Metrics

| Metric | Target |
|--------|--------|
| Lighthouse performance | > 90 |
| Lighthouse accessibility | > 90 |
| Bundle size (gzipped) | < 200 KB |
| Time to interactive | < 2s |
| Crash rate | < 0.1% |

---

## Competitive Analysis

### Direct Competitors

| Tool | Type | Strengths | Weaknesses |
|------|------|-----------|------------|
| claude-chat-viewer | OSS web app | Good viewer, OSS | Search limited, no analytics |
| Claude Exporter | Chrome ext | Multiple formats | Per-conversation, no search |
| claude-conversation-extractor | CLI tool | Claude Code support | CLI only, no web UI |
| Built-in Claude search | Native | No setup | Title-only, no Claude Code |

### Competitive Positioning

**Claude Utils vs claude-chat-viewer**:
- We have analytics (they don't)
- We have persistent storage (they don't)
- We have prompt library (they don't)
- We have paid tier with support
- They're more mature, more GitHub stars

**Claude Utils vs Claude Exporter**:
- We're web-based (no extension install)
- We have search (they don't)
- We have analytics (they don't)
- They have more export formats (for now)
- They can export without manual download

**Claude Utils vs built-in Claude**:
- We search message content (they don't)
- We support Claude Code (they don't)
- We have analytics (they don't)
- They have no friction (already there)

### Sustainable Advantage

1. **Toolkit approach**: Multiple features means multiple reasons to choose us
2. **Privacy story**: "Data never leaves your browser" is unique and valuable
3. **One-time pricing**: No subscription fatigue
4. **Claude Code support**: Only unified tool for both products
5. **Open source core**: Community contributions, trust

---

## Open Questions

### Product Questions

**Q1: Should we support Claude Team/Enterprise exports?**
- Context: Team/Enterprise may have different export formats or restrictions
- Options: (a) Ignore for now, (b) Test and support if compatible, (c) Explicitly target as premium feature
- Recommendation: Test compatibility, support if trivial, otherwise defer
- Decision: TBD

**Q2: How do we handle conversation branches?**
- Context: Claude.ai supports conversation branching (editing past messages creates branches)
- Options: (a) Show only main branch, (b) Show all branches with UI to switch, (c) Flatten all branches
- Recommendation: Start with main branch only, add branch support in v2
- Decision: TBD

**Q3: Should we index artifacts and attachments?**
- Context: Conversations may include artifacts (code, documents) and uploaded files
- Options: (a) Index artifact content, (b) Index artifact titles only, (c) Ignore artifacts
- Recommendation: Index artifact titles and code content, ignore binary attachments
- Decision: TBD

**Q4: What about Claude for Sheets/Docs/etc?**
- Context: Anthropic has integrations with Google Workspace
- Options: (a) Ignore, (b) Research if exports exist, (c) Build custom integrations
- Recommendation: Out of scope for v1, revisit based on user demand
- Decision: TBD

**Q5: How do we handle very long conversations?**
- Context: Some conversations have 500+ messages, performance concern
- Options: (a) Virtualized scrolling, (b) Pagination, (c) Collapse old messages
- Recommendation: Virtualized scrolling (react-window) with option to load all
- Decision: TBD

### Technical Questions

**Q6: Should search happen in a Web Worker?**
- Context: Large datasets could block UI during search
- Options: (a) Main thread with chunking, (b) Web Worker, (c) Wasm search engine
- Recommendation: Start main thread, add Web Worker if performance issues arise
- Decision: TBD

**Q7: How do we handle IndexedDB storage limits?**
- Context: Browsers have storage quotas (varies by browser)
- Options: (a) Warn user when approaching limit, (b) Compress data, (c) LRU eviction
- Recommendation: Show storage usage, warn at 80%, let user manually clear old data
- Decision: TBD

**Q8: Should we support offline mode?**
- Context: Service Worker could enable offline access
- Options: (a) No offline, (b) Full offline with SW, (c) Offline read-only
- Recommendation: Defer to post-launch, app already works offline once loaded
- Decision: TBD

**Q9: What token counting method should we use?**
- Context: Accurate token counting requires model-specific tokenizers
- Options: (a) Rough estimate (chars/4), (b) tiktoken WASM, (c) Claude tokenizer if available
- Recommendation: Rough estimate for v1, note it's approximate
- Decision: TBD

**Q10: How do we version the database schema?**
- Context: Schema changes need migrations for existing users
- Options: (a) Dexie's built-in versioning, (b) Manual migrations, (c) Nuke and re-import
- Recommendation: Use Dexie versioning with careful migration code
- Decision: TBD

### Business Questions

**Q11: What's our refund policy?**
- Context: Digital products often have no-refund policies
- Options: (a) No refunds, (b) 30-day refund, (c) Case-by-case
- Recommendation: 30-day no-questions-asked refund (builds trust, reduces friction)
- Decision: TBD

**Q12: Should we offer a discount for open source contributors?**
- Context: OSS contributors could help grow the product
- Options: (a) Free for contributors, (b) 50% discount, (c) No special treatment
- Recommendation: Free license for anyone who contributes meaningful PR
- Decision: TBD

**Q13: How do we handle support?**
- Context: Paid users expect some support
- Options: (a) GitHub Issues only, (b) Email support, (c) Discord community
- Recommendation: GitHub Issues + email for paid users
- Decision: TBD

**Q14: Should we have an affiliate program?**
- Context: Affiliates could drive sales
- Options: (a) No affiliates, (b) 20-30% commission, (c) Invite-only
- Recommendation: Defer to post-launch, implement if organic growth stalls
- Decision: TBD

**Q15: What's our pricing in other currencies?**
- Context: $29 USD converts differently worldwide
- Options: (a) USD only, (b) Regional pricing, (c) PPP discounts
- Recommendation: Let LemonSqueezy handle currency conversion, consider PPP later
- Decision: TBD

### Marketing Questions

**Q16: Where do we launch?**
- Context: Need to reach Claude power users
- Options: Product Hunt, Hacker News, Reddit (r/ClaudeAI, r/LocalLLaMA), Twitter/X, LinkedIn
- Recommendation: All of the above, staggered over 2 weeks
- Decision: TBD

**Q17: Should we have a waitlist pre-launch?**
- Context: Build anticipation vs. ship faster
- Options: (a) No waitlist, ship when ready, (b) Waitlist for 2 weeks, (c) Beta invites
- Recommendation: Skip waitlist, ship MVP publicly, iterate in public
- Decision: TBD

**Q18: What's our SEO strategy?**
- Context: Organic search could drive free traffic
- Options: (a) Landing page only, (b) Blog with tutorials, (c) Documentation site
- Recommendation: Landing page + 3-5 SEO-focused blog posts (e.g., "How to search Claude history")
- Decision: TBD

---

## Risks & Mitigations

### Risk 1: Anthropic ships native search

**Likelihood**: Medium (6-18 months)
**Impact**: High (core feature becomes redundant)

**Mitigation**:
- Diversify features (analytics, export, prompts are still valuable)
- Move fast, build user base before this happens
- Pivot messaging: "power tools beyond what Claude offers"

### Risk 2: Export format changes

**Likelihood**: Medium
**Impact**: Medium (parser breaks)

**Mitigation**:
- Version detection in parser
- Graceful degradation (partial import with warnings)
- Community contributions for format updates

### Risk 3: Low conversion rate

**Likelihood**: Medium
**Impact**: Medium (no revenue)

**Mitigation**:
- Validate pricing with early users
- A/B test free tier limits
- Consider lower price point ($19)
- Offer team/bulk pricing

### Risk 4: IndexedDB data loss

**Likelihood**: Low (rare but possible)
**Impact**: High (users lose imported data)

**Mitigation**:
- Clear documentation that data is local-only
- Export/backup feature for local database
- Encourage periodic re-sync from source

### Risk 5: Browser compatibility issues

**Likelihood**: Low
**Impact**: Medium

**Mitigation**:
- Test on Chrome, Firefox, Safari, Edge
- Polyfills for older browsers
- Minimum browser version requirements

### Risk 6: Scope creep

**Likelihood**: High
**Impact**: Medium (delays launch)

**Mitigation**:
- Strict MVP definition (this document)
- Defer all "nice to have" to post-launch
- Time-box phases, ship incrementally

---

## Appendix

### A. Glossary

| Term | Definition |
|------|------------|
| Conversation | A single chat thread with Claude |
| Message | One turn in a conversation (user or assistant) |
| Claude.ai | Anthropic's web chat interface |
| Claude Code | Anthropic's CLI coding assistant |
| JSONL | JSON Lines format (one JSON object per line) |
| IndexedDB | Browser-based database for structured data |
| Fuse.js | Client-side fuzzy search library |

### B. Example Claude.ai Export

```json
{
  "conversations": [
    {
      "uuid": "abc123",
      "name": "React Hooks Help",
      "summary": "Discussion about useState and useEffect",
      "created_at": "2025-01-20T10:30:00Z",
      "updated_at": "2025-01-20T11:45:00Z",
      "chat_messages": [
        {
          "uuid": "msg1",
          "sender": "human",
          "text": "How do I use useEffect correctly?",
          "created_at": "2025-01-20T10:30:00Z"
        },
        {
          "uuid": "msg2",
          "sender": "assistant",
          "text": "useEffect is used for side effects in React...",
          "created_at": "2025-01-20T10:30:15Z"
        }
      ]
    }
  ]
}
```

### C. Example Claude Code Log

```jsonl
{"type":"system","session_id":"sess_123","cwd":"/Users/dev/my-project","git_branch":"main","timestamp":"2025-01-20T14:00:00Z"}
{"type":"user","message":{"content":"Fix the bug in auth.ts"},"timestamp":"2025-01-20T14:00:05Z"}
{"type":"assistant","message":{"content":"I'll look at auth.ts and fix the issue..."},"timestamp":"2025-01-20T14:00:10Z"}
{"type":"tool_use","tool_name":"read_file","tool_input":{"path":"src/auth.ts"},"timestamp":"2025-01-20T14:00:11Z"}
{"type":"tool_result","tool_name":"read_file","result":"export function login()...","timestamp":"2025-01-20T14:00:12Z"}
{"type":"assistant","message":{"content":"I found the bug. The issue is..."},"timestamp":"2025-01-20T14:00:20Z"}
{"type":"tool_use","tool_name":"str_replace","tool_input":{"path":"src/auth.ts","old":"broken code","new":"fixed code"},"timestamp":"2025-01-20T14:00:25Z"}
```

### D. UI Mockup: Search Results

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  🔍  useEffect                                              ⌘K │
│                                                                 │
│  Filter: [All ▼]  [Claude.ai]  [Claude Code]    12 results     │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 🌐  React Hooks Help                                      │ │
│  │ Jan 20, 2025 • 24 messages                                │ │
│  │                                                           │ │
│  │ "...The **useEffect** hook is used for side effects.      │ │
│  │ Common use cases include data fetching, subscriptions..." │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 💻  my-dashboard                                          │ │
│  │ Jan 19, 2025 • 89 messages • feature/charts               │ │
│  │                                                           │ │
│  │ "...let's add a **useEffect** to fetch the chart data     │ │
│  │ when the component mounts. Here's the updated code..."    │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 🌐  Interview Prep                                        │ │
│  │ Jan 15, 2025 • 156 messages                               │ │
│  │                                                           │ │
│  │ "...explain the dependency array in **useEffect**. If     │ │
│  │ you pass an empty array, it only runs on mount..."        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│                    Load more results...                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### E. UI Mockup: Analytics Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Analytics                              Jan 1 - Jan 23, 2025 ▼  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │    847      │ │   12,453    │ │     32      │ │   ~485K   │ │
│  │ Conversations│ │  Messages   │ │  Avg Length │ │  Tokens   │ │
│  │  +12 today  │ │  +89 today  │ │  msgs/convo │ │ estimated │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
│                                                                 │
│  Messages Over Time                                             │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                                              ╭─╮          │ │
│  │                                    ╭─╮      ╭╯ ╰╮         │ │
│  │                          ╭─╮      ╭╯ ╰╮    ╭╯   ╰╮        │ │
│  │            ╭─╮    ╭─╮   ╭╯ ╰╮    ╭╯   │   ╭╯     │        │ │
│  │     ╭─╮   ╭╯ ╰╮  ╭╯ ╰─╮╭╯   ╰────╯    ╰───╯      ╰────    │ │
│  │ ────╯ ╰───╯   ╰──╯    ╰╯                                  │ │
│  │ Jan 1        Jan 8        Jan 15        Jan 22            │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  By Source                    │  Activity Heatmap              │
│  ┌────────────────────────────┤  ┌──────────────────────────┐ │
│  │  🌐 Claude.ai    623 (74%) │  │  M  T  W  T  F  S  S     │ │
│  │  ████████████████████      │  │  ░░ ▒▒ ▓▓ ▓▓ ▒▒ ░░ ░░ 6a │ │
│  │                            │  │  ▒▒ ▓▓ ██ ██ ▓▓ ▒▒ ░░ 9a │ │
│  │  💻 Claude Code  224 (26%) │  │  ▓▓ ██ ██ ██ ██ ▓▓ ▒▒12p │ │
│  │  ███████                   │  │  ▓▓ ██ ██ ██ ██ ▓▓ ▒▒ 3p │ │
│  └────────────────────────────┤  │  ▒▒ ▓▓ ▓▓ ▓▓ ▒▒ ░░ ░░ 6p │ │
│                               │  │  ░░ ▒▒ ▒▒ ▒▒ ░░ ░░ ░░ 9p │ │
│                               │  └──────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

*Document authored by Claude & Jacob | Last updated: January 2026*
