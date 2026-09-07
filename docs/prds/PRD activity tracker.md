# Product Requirements Document: Claude Activity Tracker

## Overview

A browser extension that provides real-time monitoring and historical tracking of all Claude usage across Claude Web and Claude Code, presented in a unified vertical timeline with rich metadata about artifacts, code reviews, token usage, and conversation context.

## Product Vision

Enable Claude power users to:
- Understand their usage patterns across all Claude products
- Quickly find past conversations and code reviews
- Track token consumption and costs in real-time
- Identify which conversations produced artifacts, code, or other valuable outputs
- Build better prompting habits through usage insights

## Target Users

- Software engineers using Claude for coding assistance
- Researchers and writers leveraging Claude extensively
- Teams managing Claude budgets and usage
- Power users wanting to optimize their Claude workflows

## Core Features

### 1. Real-Time Activity Timeline

**Description:** Vertical timeline showing all Claude activity as it happens

**Key Elements:**
- Timestamp (relative and absolute)
- Source indicator (Claude Web vs Claude Code)
- Message preview/snippet
- Token usage (input/output/cache)
- Activity type badges:
  - 💬 Regular message
  - 🎨 Artifact created/edited
  - 💻 Code block for review
  - 🔧 Tool use (web search, file creation, etc.)
  - 📊 Chart/visualization
  - 📄 Document generated
  - 🗂️ File uploaded

**User Stories:**
- As a developer, I want to see my Claude Code sessions appear in real-time so I know what Claude is working on
- As a writer, I want to see when artifacts are created so I can review them immediately
- As a user, I want to quickly scan my activity to find that conversation where Claude made a chart

### 2. Activity Detail View

**Description:** Click any timeline item to see full details

**Includes:**
- Complete message text
- Full response text
- All artifacts with previews
- Code blocks with syntax highlighting
- Token breakdown (input/output/cache read/cache write)
- Model used (Sonnet, Opus, Haiku)
- Conversation context link (jump to full conversation)
- Tools used in the interaction

### 3. Filtering & Search

**Filters:**
- Source (Web, Code, or both)
- Date range
- Model type
- Activity type (messages, artifacts, code, tools)
- Token usage threshold
- Conversation

**Search:**
- Full-text search across messages
- Search by artifact type
- Search by tools used

### 4. Usage Analytics Dashboard

**Metrics:**
- Total tokens (input/output) by day/week/month
- Token distribution by model
- Most active conversations
- Artifact creation frequency
- Average tokens per message
- Cache efficiency (cache hits vs regular tokens)
- Cost estimation based on token usage

**Visualizations:**
- Line chart: tokens over time
- Pie chart: token distribution by model
- Bar chart: daily activity levels
- Heatmap: usage patterns by hour/day

### 5. Conversation Timeline View

**Description:** Group timeline items by conversation

**Features:**
- Collapsible conversation threads
- Conversation title/preview
- Total tokens per conversation
- Artifacts produced in that conversation
- Quick jump to full conversation in Claude

### 6. Export & Data Management

**Export Options:**
- Export timeline as JSON
- Export specific conversations
- Export usage statistics as CSV
- One-time import from Claude data export (for historical data)

**Storage:**
- Local storage in extension
- Optional cloud sync (future feature)
- Data retention settings

## Technical Requirements

### Browser Extension Architecture

**Required Permissions:**
- `webRequest` - Monitor Claude API calls
- `storage` - Store activity data locally
- `tabs` - Manage Claude tabs
- Host permissions for `claude.ai/*`

**Components:**
- Background service worker (API monitoring)
- Content script (intercept fetch, extract artifacts)
- Popup UI (quick activity view)
- Full dashboard page (comprehensive timeline)

### Data Capture

**Claude Web:**
- Message send/receive events
- Token usage from response headers
- Artifact creation/updates
- Tool usage (web search, file operations, etc.)
- Code blocks marked for review
- Model information

**Claude Code (Optional):**
- Requires native messaging host
- Monitor log files for activity
- Capture coding sessions
- Track file operations

### Data Schema

```json
{
  "activities": [
    {
      "id": "unique-id",
      "timestamp": 1234567890,
      "source": "claude_web | claude_code",
      "conversationId": "conv-id",
      "conversationTitle": "string",
      "type": "message | artifact | code | tool_use",
      "message": {
        "role": "user | assistant",
        "content": "string",
        "preview": "string (first 100 chars)"
      },
      "tokens": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "model": "claude-sonnet-4-20250514",
      "artifacts": [
        {
          "type": "react | html | markdown | svg | mermaid",
          "title": "string",
          "identifier": "string"
        }
      ],
      "codeBlocks": [
        {
          "language": "string",
          "content": "string",
          "isForReview": boolean
        }
      ],
      "tools": [
        {
          "name": "web_search | bash_tool | etc",
          "input": {},
          "output": {}
        }
      ]
    }
  ]
}
```

## UI/UX Requirements

### Timeline View

**Layout:**
```
┌─────────────────────────────────────────────┐
│  🔍 Search  [Filters ▼]  [Export ▼]        │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─ 2:34 PM ────────────────────────────┐  │
│  │ 🌐 Claude Web                        │  │
│  │ 💻 Code Review Request               │  │
│  │ "Can you review this React component"│  │
│  │ 📊 1.2K input • 3.4K output          │  │
│  │ [View Details]                       │  │
│  └──────────────────────────────────────┘  │
│                                             │
│  ┌─ 2:31 PM ────────────────────────────┐  │
│  │ 🌐 Claude Web                        │  │
│  │ 🎨 Artifact Created                  │  │
│  │ "Dashboard Component"                │  │
│  │ 📊 890 input • 5.6K output           │  │
│  │ [View Details] [Open Artifact]       │  │
│  └──────────────────────────────────────┘  │
│                                             │
│  ┌─ 1:15 PM ────────────────────────────┐  │
│  │ 💻 Claude Code                       │  │
│  │ 🔧 File Creation                     │  │
│  │ Created "utils.ts"                   │  │
│  │ [View in Code]                       │  │
│  └──────────────────────────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

**Interaction:**
- Hover to highlight
- Click to expand details inline
- Right-click for context menu (copy, export, open conversation)
- Infinite scroll for older activity

### Dashboard View

**Tabs:**
- Timeline (default)
- Analytics
- Conversations
- Settings

**Analytics View:**
- Date range selector
- Key metrics cards (total tokens, conversations, artifacts)
- Charts and visualizations
- Export options

## Success Metrics

### Engagement
- Daily active users opening the timeline
- Average time spent in dashboard
- Number of searches performed
- Export frequency

### Value
- Time saved finding past conversations
- User-reported usefulness (survey)
- Retention rate after 30 days

### Technical
- Activity capture success rate (>99%)
- UI responsiveness (<100ms interactions)
- Storage efficiency (data size vs features)

## Future Enhancements

### Phase 2
- Cloud sync across devices
- Team dashboards (shared usage insights)
- AI-powered conversation categorization
- Smart search with semantic understanding
- Cost tracking and budgeting
- Integration with productivity tools

### Phase 3
- Prompt library linked to successful outcomes
- A/B testing prompts with usage data
- Collaboration features (share timelines/insights)
- Advanced analytics (conversation flow analysis)
- Mobile app companion

## Open Questions

1. Should we support importing historical data from Claude's data export initially, or focus on capturing going forward?
2. Do we need Claude Code integration in MVP, or can that be Phase 2?
3. How do we handle privacy concerns with storing conversation data locally?
4. Should we add cost estimation based on current Anthropic pricing?
5. Do we want to support exporting artifacts directly from the timeline?

## Launch Strategy

### MVP Scope (v0.1)
- Claude Web monitoring only
- Basic timeline with activity types
- Token usage tracking
- Simple search and filters
- Manual data export

### Beta Release (v0.2)
- Enhanced artifact detection
- Analytics dashboard
- Conversation grouping
- Improved search

### v1.0
- Claude Code integration
- Full analytics suite
- Cloud sync
- Polish and optimization

## Dependencies

- Chrome Extensions Manifest V3
- Storage API for local data
- Chart.js or similar for visualizations
- Native messaging host (for Claude Code integration)

## Timeline

- Week 1-2: Core monitoring infrastructure
- Week 3: Timeline UI and basic features
- Week 4: Analytics dashboard
- Week 5: Testing and refinement
- Week 6: Beta release

## Resources Needed

- Browser extension development
- UI/UX design for dashboard
- Native app development (for Claude Code integration)
- Testing across different Claude usage patterns
