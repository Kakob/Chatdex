# Claude Activity Tracker - Technical Implementation Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Extension                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Background Service Worker               │   │
│  │  - Monitor webRequest API                          │   │
│  │  - Aggregate activity data                         │   │
│  │  - Manage storage                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↕                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Content Script (Claude.ai)             │   │
│  │  - Intercept fetch requests                        │   │
│  │  - Extract artifacts and metadata                  │   │
│  │  - Monitor DOM for activity                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↕                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Dashboard UI                     │   │
│  │  - Timeline view                                   │   │
│  │  - Analytics charts                                │   │
│  │  - Search and filters                              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↕
     ┌────────────────────────────────────────┐
     │   Native Messaging Host (Optional)      │
     │   - Monitor Claude Code logs            │
     │   - Watch file system                   │
     └────────────────────────────────────────┘
```

## Implementation Details

### 1. Manifest Configuration

**manifest.json**
```json
{
  "manifest_version": 3,
  "name": "Claude Activity Tracker",
  "version": "0.1.0",
  "description": "Track and analyze all your Claude usage in real-time",
  
  "permissions": [
    "storage",
    "webRequest",
    "tabs"
  ],
  
  "host_permissions": [
    "https://claude.ai/*"
  ],
  
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  
  "content_scripts": [
    {
      "matches": ["https://claude.ai/*"],
      "js": ["content-script.js"],
      "run_at": "document_start"
    }
  ],
  
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  
  "web_accessible_resources": [
    {
      "resources": ["injected.js"],
      "matches": ["https://claude.ai/*"]
    }
  ]
}
```

### 2. Content Script - Fetch Interception

**content-script.js**
```javascript
// Inject script into page context to intercept fetch
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() {
  this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Listen for intercepted data from injected script
window.addEventListener('claude_activity', (event) => {
  const { type, data } = event.detail;
  
  // Send to background script
  chrome.runtime.sendMessage({
    type: 'activity_captured',
    activityType: type,
    data: data,
    timestamp: Date.now()
  });
});

// Monitor DOM for artifacts and other elements
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === 1) {
        // Check for artifacts
        if (node.matches('[data-testid="artifact-container"]')) {
          extractArtifact(node);
        }
        
        // Check for code blocks
        if (node.matches('pre code, .code-block')) {
          extractCodeBlock(node);
        }
        
        // Check for tool use indicators
        if (node.matches('[data-tool-use]')) {
          extractToolUse(node);
        }
      }
    });
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

function extractArtifact(element) {
  const artifactData = {
    type: element.getAttribute('data-artifact-type') || 'unknown',
    title: element.querySelector('[data-artifact-title]')?.textContent,
    identifier: element.getAttribute('data-artifact-id'),
    content: element.querySelector('[data-artifact-content]')?.textContent,
    timestamp: Date.now()
  };
  
  window.dispatchEvent(new CustomEvent('claude_activity', {
    detail: {
      type: 'artifact_detected',
      data: artifactData
    }
  }));
}

function extractCodeBlock(element) {
  const language = element.className.match(/language-(\w+)/)?.[1] || 'text';
  const content = element.textContent;
  const isForReview = element.closest('[data-code-review]') !== null;
  
  window.dispatchEvent(new CustomEvent('claude_activity', {
    detail: {
      type: 'code_block_detected',
      data: {
        language,
        content,
        isForReview,
        timestamp: Date.now()
      }
    }
  }));
}

function extractToolUse(element) {
  const toolName = element.getAttribute('data-tool-name');
  const toolInput = element.querySelector('[data-tool-input]')?.textContent;
  const toolOutput = element.querySelector('[data-tool-output]')?.textContent;
  
  window.dispatchEvent(new CustomEvent('claude_activity', {
    detail: {
      type: 'tool_use_detected',
      data: {
        name: toolName,
        input: toolInput,
        output: toolOutput,
        timestamp: Date.now()
      }
    }
  }));
}
```

**injected.js**
```javascript
// This runs in the page context and can intercept fetch
(function() {
  const originalFetch = window.fetch;
  
  window.fetch = async function(...args) {
    const [url, options] = args;
    
    // Capture request
    if (url.includes('claude.ai/api')) {
      const requestData = {
        url,
        method: options?.method || 'GET',
        timestamp: Date.now()
      };
      
      // Try to parse request body
      if (options?.body) {
        try {
          requestData.body = JSON.parse(options.body);
        } catch (e) {
          requestData.body = options.body;
        }
      }
      
      window.dispatchEvent(new CustomEvent('claude_activity', {
        detail: {
          type: 'api_request',
          data: requestData
        }
      }));
    }
    
    // Make actual request
    const response = await originalFetch(...args);
    
    // Capture response
    if (url.includes('claude.ai/api')) {
      const clonedResponse = response.clone();
      
      try {
        const responseData = await clonedResponse.text();
        let parsedData;
        
        try {
          parsedData = JSON.parse(responseData);
        } catch (e) {
          parsedData = responseData;
        }
        
        // Extract token usage from headers
        const tokens = {
          input: response.headers.get('anthropic-input-tokens'),
          output: response.headers.get('anthropic-output-tokens'),
          cacheRead: response.headers.get('anthropic-cache-read-tokens'),
          cacheWrite: response.headers.get('anthropic-cache-creation-tokens')
        };
        
        window.dispatchEvent(new CustomEvent('claude_activity', {
          detail: {
            type: 'api_response',
            data: {
              url,
              status: response.status,
              data: parsedData,
              tokens,
              timestamp: Date.now()
            }
          }
        }));
      } catch (e) {
        console.error('Error capturing response:', e);
      }
    }
    
    return response;
  };
})();
```

### 3. Background Service Worker

**background.js**
```javascript
// Activity aggregator and storage manager
class ActivityManager {
  constructor() {
    this.activities = [];
    this.currentConversation = null;
    this.setupListeners();
    this.loadActivities();
  }
  
  setupListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'activity_captured') {
        this.processActivity(message);
      }
    });
    
    // Listen for webRequest events (fallback/additional data)
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => this.handleRequest(details),
      { urls: ["https://claude.ai/api/*"] },
      ["requestBody"]
    );
    
    chrome.webRequest.onCompleted.addListener(
      (details) => this.handleResponse(details),
      { urls: ["https://claude.ai/api/*"] }
    );
  }
  
  async loadActivities() {
    const result = await chrome.storage.local.get(['activities']);
    this.activities = result.activities || [];
  }
  
  async saveActivities() {
    await chrome.storage.local.set({ activities: this.activities });
  }
  
  processActivity(message) {
    const { activityType, data, timestamp } = message;
    
    switch (activityType) {
      case 'api_request':
        this.handleApiRequest(data);
        break;
      case 'api_response':
        this.handleApiResponse(data);
        break;
      case 'artifact_detected':
        this.addArtifactToLatestActivity(data);
        break;
      case 'code_block_detected':
        this.addCodeBlockToLatestActivity(data);
        break;
      case 'tool_use_detected':
        this.addToolUseToLatestActivity(data);
        break;
    }
  }
  
  handleApiRequest(data) {
    // Extract conversation ID from URL
    const conversationId = this.extractConversationId(data.url);
    
    if (conversationId) {
      this.currentConversation = conversationId;
    }
    
    // Create activity entry for user message
    if (data.body && data.body.prompt) {
      const activity = {
        id: this.generateId(),
        timestamp: data.timestamp,
        source: 'claude_web',
        conversationId: conversationId,
        conversationTitle: data.body.conversationTitle || 'Untitled',
        type: 'message',
        message: {
          role: 'user',
          content: data.body.prompt,
          preview: this.createPreview(data.body.prompt)
        },
        model: data.body.model || 'unknown',
        tokens: null, // Will be filled by response
        artifacts: [],
        codeBlocks: [],
        tools: []
      };
      
      this.activities.unshift(activity);
      this.saveActivities();
      this.notifyUIUpdate();
    }
  }
  
  handleApiResponse(data) {
    // Find the corresponding request activity
    const latestActivity = this.activities[0];
    
    if (latestActivity && !latestActivity.tokens) {
      // Update with response data
      latestActivity.tokens = {
        input: parseInt(data.tokens.input) || 0,
        output: parseInt(data.tokens.output) || 0,
        cacheRead: parseInt(data.tokens.cacheRead) || 0,
        cacheWrite: parseInt(data.tokens.cacheWrite) || 0
      };
      
      // Add assistant's response
      if (data.data && data.data.completion) {
        const responseActivity = {
          id: this.generateId(),
          timestamp: data.timestamp,
          source: 'claude_web',
          conversationId: latestActivity.conversationId,
          conversationTitle: latestActivity.conversationTitle,
          type: 'message',
          message: {
            role: 'assistant',
            content: data.data.completion,
            preview: this.createPreview(data.data.completion)
          },
          model: latestActivity.model,
          tokens: latestActivity.tokens,
          artifacts: [],
          codeBlocks: [],
          tools: []
        };
        
        this.activities.unshift(responseActivity);
      }
      
      this.saveActivities();
      this.notifyUIUpdate();
    }
  }
  
  addArtifactToLatestActivity(artifactData) {
    const latestActivity = this.findLatestAssistantMessage();
    if (latestActivity) {
      latestActivity.artifacts.push(artifactData);
      
      // Update type to indicate artifact
      if (!latestActivity.type.includes('artifact')) {
        latestActivity.type = 'artifact';
      }
      
      this.saveActivities();
      this.notifyUIUpdate();
    }
  }
  
  addCodeBlockToLatestActivity(codeData) {
    const latestActivity = this.findLatestAssistantMessage();
    if (latestActivity) {
      latestActivity.codeBlocks.push(codeData);
      
      if (codeData.isForReview) {
        latestActivity.type = 'code';
      }
      
      this.saveActivities();
      this.notifyUIUpdate();
    }
  }
  
  addToolUseToLatestActivity(toolData) {
    const latestActivity = this.findLatestAssistantMessage();
    if (latestActivity) {
      latestActivity.tools.push(toolData);
      
      if (!latestActivity.type.includes('tool')) {
        latestActivity.type = 'tool_use';
      }
      
      this.saveActivities();
      this.notifyUIUpdate();
    }
  }
  
  findLatestAssistantMessage() {
    return this.activities.find(a => a.message?.role === 'assistant');
  }
  
  extractConversationId(url) {
    const match = url.match(/chat_conversations\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }
  
  createPreview(text, maxLength = 100) {
    if (!text) return '';
    return text.length > maxLength 
      ? text.substring(0, maxLength) + '...'
      : text;
  }
  
  generateId() {
    return `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  notifyUIUpdate() {
    // Notify popup/dashboard of new activity
    chrome.runtime.sendMessage({
      type: 'activities_updated',
      activities: this.activities.slice(0, 50) // Send latest 50
    });
  }
  
  handleRequest(details) {
    // Additional webRequest monitoring as fallback
    // Can capture things the fetch intercept might miss
  }
  
  handleResponse(details) {
    // Track response timing and status codes
  }
}

// Initialize
const activityManager = new ActivityManager();

// Handle messages from popup/dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get_activities') {
    sendResponse({ activities: activityManager.activities });
  }
  
  if (message.type === 'clear_activities') {
    activityManager.activities = [];
    activityManager.saveActivities();
    sendResponse({ success: true });
  }
  
  if (message.type === 'export_activities') {
    const dataStr = JSON.stringify(activityManager.activities, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + 
                    encodeURIComponent(dataStr);
    
    chrome.downloads.download({
      url: dataUri,
      filename: `claude-activity-${Date.now()}.json`,
      saveAs: true
    });
    
    sendResponse({ success: true });
  }
  
  return true; // Keep channel open for async response
});
```

### 4. Timeline UI Component

**timeline.js**
```javascript
class TimelineView {
  constructor(container) {
    this.container = container;
    this.activities = [];
    this.filters = {
      source: 'all',
      type: 'all',
      dateRange: 'all',
      search: ''
    };
    
    this.setupEventListeners();
    this.loadActivities();
  }
  
  setupEventListeners() {
    // Listen for activity updates
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'activities_updated') {
        this.activities = message.activities;
        this.render();
      }
    });
    
    // Filter controls
    document.getElementById('source-filter')?.addEventListener('change', (e) => {
      this.filters.source = e.target.value;
      this.render();
    });
    
    document.getElementById('type-filter')?.addEventListener('change', (e) => {
      this.filters.type = e.target.value;
      this.render();
    });
    
    document.getElementById('search-input')?.addEventListener('input', (e) => {
      this.filters.search = e.target.value.toLowerCase();
      this.render();
    });
  }
  
  async loadActivities() {
    const response = await chrome.runtime.sendMessage({ type: 'get_activities' });
    this.activities = response.activities || [];
    this.render();
  }
  
  filterActivities() {
    return this.activities.filter(activity => {
      // Source filter
      if (this.filters.source !== 'all' && 
          activity.source !== this.filters.source) {
        return false;
      }
      
      // Type filter
      if (this.filters.type !== 'all' && 
          activity.type !== this.filters.type) {
        return false;
      }
      
      // Search filter
      if (this.filters.search) {
        const searchableText = [
          activity.message?.content,
          activity.conversationTitle,
          activity.message?.preview
        ].join(' ').toLowerCase();
        
        if (!searchableText.includes(this.filters.search)) {
          return false;
        }
      }
      
      return true;
    });
  }
  
  render() {
    const filteredActivities = this.filterActivities();
    
    this.container.innerHTML = filteredActivities.length === 0
      ? this.renderEmptyState()
      : filteredActivities.map(activity => this.renderActivity(activity)).join('');
    
    // Attach event listeners to activity items
    this.attachActivityListeners();
  }
  
  renderActivity(activity) {
    const timeAgo = this.getTimeAgo(activity.timestamp);
    const icon = this.getActivityIcon(activity);
    const badge = this.getActivityBadge(activity);
    
    return `
      <div class="activity-item" data-activity-id="${activity.id}">
        <div class="activity-header">
          <span class="activity-time">${timeAgo}</span>
          <span class="activity-source ${activity.source}">
            ${activity.source === 'claude_web' ? '🌐 Claude Web' : '💻 Claude Code'}
          </span>
        </div>
        
        <div class="activity-content">
          <div class="activity-icon">${icon}</div>
          <div class="activity-details">
            <div class="activity-type-badge ${activity.type}">${badge}</div>
            
            ${activity.conversationTitle ? `
              <div class="conversation-title">${activity.conversationTitle}</div>
            ` : ''}
            
            <div class="activity-preview">${activity.message?.preview || ''}</div>
            
            ${activity.tokens ? `
              <div class="token-usage">
                <span class="token-input">📥 ${this.formatNumber(activity.tokens.input)}</span>
                <span class="token-output">📤 ${this.formatNumber(activity.tokens.output)}</span>
                ${activity.tokens.cacheRead > 0 ? `
                  <span class="token-cache">💾 ${this.formatNumber(activity.tokens.cacheRead)}</span>
                ` : ''}
              </div>
            ` : ''}
            
            ${this.renderArtifacts(activity.artifacts)}
            ${this.renderCodeBlocks(activity.codeBlocks)}
            ${this.renderTools(activity.tools)}
          </div>
        </div>
        
        <div class="activity-actions">
          <button class="btn-view-details" data-id="${activity.id}">View Details</button>
          ${activity.conversationId ? `
            <button class="btn-open-conversation" data-id="${activity.conversationId}">
              Open Conversation
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }
  
  renderArtifacts(artifacts) {
    if (!artifacts || artifacts.length === 0) return '';
    
    return `
      <div class="artifacts">
        ${artifacts.map(artifact => `
          <div class="artifact-tag">
            🎨 ${artifact.type}: ${artifact.title || 'Untitled'}
          </div>
        `).join('')}
      </div>
    `;
  }
  
  renderCodeBlocks(codeBlocks) {
    if (!codeBlocks || codeBlocks.length === 0) return '';
    
    const reviewBlocks = codeBlocks.filter(cb => cb.isForReview);
    if (reviewBlocks.length === 0) return '';
    
    return `
      <div class="code-blocks">
        ${reviewBlocks.map(block => `
          <div class="code-block-tag">
            💻 Code (${block.language}) - For Review
          </div>
        `).join('')}
      </div>
    `;
  }
  
  renderTools(tools) {
    if (!tools || tools.length === 0) return '';
    
    return `
      <div class="tools">
        ${tools.map(tool => `
          <div class="tool-tag">
            🔧 ${tool.name}
          </div>
        `).join('')}
      </div>
    `;
  }
  
  getActivityIcon(activity) {
    const iconMap = {
      'message': '💬',
      'artifact': '🎨',
      'code': '💻',
      'tool_use': '🔧'
    };
    return iconMap[activity.type] || '💬';
  }
  
  getActivityBadge(activity) {
    const badgeMap = {
      'message': 'Message',
      'artifact': 'Artifact Created',
      'code': 'Code Review',
      'tool_use': 'Tool Use'
    };
    return badgeMap[activity.type] || 'Activity';
  }
  
  getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
  
  formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }
  
  renderEmptyState() {
    return `
      <div class="empty-state">
        <h3>No activity yet</h3>
        <p>Start using Claude and your activity will appear here!</p>
      </div>
    `;
  }
  
  attachActivityListeners() {
    // View details buttons
    document.querySelectorAll('.btn-view-details').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        this.showActivityDetails(id);
      });
    });
    
    // Open conversation buttons
    document.querySelectorAll('.btn-open-conversation').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const conversationId = e.target.dataset.id;
        chrome.tabs.create({
          url: `https://claude.ai/chat/${conversationId}`
        });
      });
    });
  }
  
  showActivityDetails(activityId) {
    const activity = this.activities.find(a => a.id === activityId);
    if (!activity) return;
    
    // Show modal with full details
    const modal = document.getElementById('activity-detail-modal');
    modal.querySelector('.detail-content').innerHTML = `
      <h2>Activity Details</h2>
      
      <div class="detail-section">
        <h3>Message</h3>
        <pre>${activity.message?.content || 'N/A'}</pre>
      </div>
      
      ${activity.tokens ? `
        <div class="detail-section">
          <h3>Token Usage</h3>
          <table>
            <tr><td>Input:</td><td>${activity.tokens.input}</td></tr>
            <tr><td>Output:</td><td>${activity.tokens.output}</td></tr>
            <tr><td>Cache Read:</td><td>${activity.tokens.cacheRead}</td></tr>
            <tr><td>Cache Write:</td><td>${activity.tokens.cacheWrite}</td></tr>
          </table>
        </div>
      ` : ''}
      
      ${activity.artifacts?.length > 0 ? `
        <div class="detail-section">
          <h3>Artifacts</h3>
          ${activity.artifacts.map(a => `
            <div class="artifact-detail">
              <strong>${a.title}</strong> (${a.type})
              <pre>${a.content?.substring(0, 500)}...</pre>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
    
    modal.classList.add('visible');
  }
}

// Initialize timeline
const timeline = new TimelineView(document.getElementById('timeline-container'));
```

### 5. Analytics Dashboard

**analytics.js**
```javascript
class AnalyticsDashboard {
  constructor() {
    this.activities = [];
    this.charts = {};
    this.loadData();
  }
  
  async loadData() {
    const response = await chrome.runtime.sendMessage({ type: 'get_activities' });
    this.activities = response.activities || [];
    this.renderDashboard();
  }
  
  renderDashboard() {
    this.renderKeyMetrics();
    this.renderTokenUsageChart();
    this.renderActivityHeatmap();
    this.renderModelDistribution();
    this.renderTopConversations();
  }
  
  renderKeyMetrics() {
    const totalTokens = this.activities.reduce((sum, a) => {
      return sum + (a.tokens?.input || 0) + (a.tokens?.output || 0);
    }, 0);
    
    const totalConversations = new Set(
      this.activities.map(a => a.conversationId).filter(Boolean)
    ).size;
    
    const totalArtifacts = this.activities.reduce((sum, a) => {
      return sum + (a.artifacts?.length || 0);
    }, 0);
    
    const totalMessages = this.activities.filter(a => a.type === 'message').length;
    
    document.getElementById('metric-tokens').textContent = 
      this.formatNumber(totalTokens);
    document.getElementById('metric-conversations').textContent = 
      totalConversations;
    document.getElementById('metric-artifacts').textContent = 
      totalArtifacts;
    document.getElementById('metric-messages').textContent = 
      totalMessages;
  }
  
  renderTokenUsageChart() {
    // Group by day and calculate token usage
    const dailyData = this.groupByDay();
    
    const ctx = document.getElementById('token-usage-chart');
    this.charts.tokenUsage = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dailyData.map(d => d.date),
        datasets: [
          {
            label: 'Input Tokens',
            data: dailyData.map(d => d.inputTokens),
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.2)'
          },
          {
            label: 'Output Tokens',
            data: dailyData.map(d => d.outputTokens),
            borderColor: 'rgb(153, 102, 255)',
            backgroundColor: 'rgba(153, 102, 255, 0.2)'
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }
  
  groupByDay() {
    const groups = {};
    
    this.activities.forEach(activity => {
      const date = new Date(activity.timestamp).toLocaleDateString();
      
      if (!groups[date]) {
        groups[date] = {
          date,
          inputTokens: 0,
          outputTokens: 0,
          count: 0
        };
      }
      
      groups[date].inputTokens += activity.tokens?.input || 0;
      groups[date].outputTokens += activity.tokens?.output || 0;
      groups[date].count += 1;
    });
    
    return Object.values(groups).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    );
  }
  
  renderModelDistribution() {
    const modelCounts = {};
    
    this.activities.forEach(activity => {
      const model = activity.model || 'unknown';
      modelCounts[model] = (modelCounts[model] || 0) + 1;
    });
    
    const ctx = document.getElementById('model-distribution-chart');
    this.charts.modelDistribution = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: Object.keys(modelCounts),
        datasets: [{
          data: Object.values(modelCounts),
          backgroundColor: [
            'rgba(255, 99, 132, 0.8)',
            'rgba(54, 162, 235, 0.8)',
            'rgba(255, 206, 86, 0.8)'
          ]
        }]
      }
    });
  }
  
  formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }
}
```

## Claude Code Integration (Optional Phase)

### Native Messaging Host Setup

**claude-code-monitor.py**
```python
#!/usr/bin/env python3
import json
import sys
import struct
import os
import time
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class ClaudeCodeMonitor(FileSystemEventHandler):
    def __init__(self):
        self.log_dir = Path.home() / '.claude_code' / 'logs'
        
    def on_modified(self, event):
        if event.src_path.endswith('.log'):
            self.process_log_file(event.src_path)
    
    def process_log_file(self, filepath):
        """Parse Claude Code log and extract activity"""
        try:
            with open(filepath, 'r') as f:
                # Read last N lines (new activity)
                lines = f.readlines()[-100:]
                
                for line in lines:
                    activity = self.parse_log_line(line)
                    if activity:
                        self.send_to_extension(activity)
        except Exception as e:
            print(f"Error processing log: {e}", file=sys.stderr)
    
    def parse_log_line(self, line):
        """Extract structured data from log line"""
        # Parse based on Claude Code log format
        # This will need to be adjusted based on actual log format
        if 'tokens' in line.lower():
            return {
                'type': 'claude_code_activity',
                'timestamp': time.time(),
                'log': line.strip()
            }
        return None
    
    def send_to_extension(self, message):
        """Send message to browser extension via native messaging"""
        encoded = json.dumps(message).encode('utf-8')
        sys.stdout.buffer.write(struct.pack('I', len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()

def main():
    monitor = ClaudeCodeMonitor()
    observer = Observer()
    observer.schedule(monitor, str(monitor.log_dir), recursive=True)
    observer.start()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()

if __name__ == '__main__':
    main()
```

## Testing Strategy

### Unit Tests
- Activity parsing and formatting
- Filter logic
- Token aggregation
- Time formatting

### Integration Tests
- Fetch interception
- Message flow (content script → background → UI)
- Storage persistence
- Export functionality

### Manual Testing Checklist
- [ ] Messages captured in real-time
- [ ] Artifacts detected correctly
- [ ] Code blocks marked properly
- [ ] Tool use tracked
- [ ] Token usage accurate
- [ ] Timeline renders correctly
- [ ] Filters work as expected
- [ ] Search functionality
- [ ] Analytics calculations correct
- [ ] Export/import working

## Performance Considerations

1. **Batch updates**: Don't update UI on every activity, batch updates every 500ms
2. **Lazy rendering**: Only render visible timeline items (virtual scrolling)
3. **Storage optimization**: Compress old activities, keep recent ones in memory
4. **Debounce search**: Wait 300ms after user stops typing
5. **Limit storage**: Cap at 10,000 activities, archive older ones

## Deployment Checklist

- [ ] Manifest V3 compliant
- [ ] Icons and assets included
- [ ] Privacy policy written
- [ ] Store listing prepared
- [ ] Screenshots for Chrome Web Store
- [ ] Testing on multiple Chrome versions
- [ ] Handle errors gracefully
- [ ] Add analytics (optional)
- [ ] Set up feedback mechanism
- [ ] Document known limitations

## Future Enhancements

1. **Cloud sync** - Store activities in cloud for multi-device access
2. **Advanced search** - Semantic search using embeddings
3. **Prompt library** - Save effective prompts with outcomes
4. **Team features** - Share insights with team
5. **Cost tracking** - Calculate actual API costs
6. **Smart notifications** - Alert on high token usage
7. **Conversation analysis** - Identify patterns in successful prompts
