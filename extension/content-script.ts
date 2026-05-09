// Content script that runs on claude.ai pages
// Injects the fetch interceptor and observes DOM for activities

import type { CapturedResponse, DOMActivity, ExtensionMessage } from './types';

// Inject the fetch interceptor script into page context
function injectScript(): void {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();
}

// Listen for captured responses from injected script
function setupResponseListener(): void {
  window.addEventListener('claude-utils-response', ((event: CustomEvent<CapturedResponse>) => {
    console.log('[Chatdex] Content script received response:', event.detail);
    sendToBackground({ type: 'CLAUDE_RESPONSE', data: event.detail });
  }) as EventListener);
}

// Observe DOM for artifacts, code blocks, and tool usage
function setupDOMObserver(): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          detectActivities(node);
        }
      }
    }
  });

  // Start observing when document is ready
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
}

function detectActivities(element: HTMLElement): void {
  // Detect artifacts (usually have data-artifact-* attributes or specific class names)
  const artifacts = element.querySelectorAll('[data-artifact-id], .artifact-container');
  for (const artifact of artifacts) {
    const title = artifact.getAttribute('data-artifact-title') ??
      artifact.querySelector('[class*="title"]')?.textContent ?? 'Untitled';
    const type = artifact.getAttribute('data-artifact-type') ?? 'unknown';

    sendDOMActivity({
      type: 'artifact',
      title,
      artifactType: type,
      timestamp: Date.now(),
    });
  }

  // Detect code blocks
  const codeBlocks = element.querySelectorAll('pre code, .code-block');
  for (const codeBlock of codeBlocks) {
    // Try to get language from class name (e.g., language-typescript)
    const classList = codeBlock.className;
    const langMatch = classList.match(/language-(\w+)/);
    const language = langMatch?.[1] ?? 'unknown';
    const codeContent = codeBlock.textContent ?? '';

    sendDOMActivity({
      type: 'code_block',
      language,
      codeContent,
      timestamp: Date.now(),
    });
  }

  // Detect tool usage (look for tool-related elements)
  const toolElements = element.querySelectorAll('[data-tool-name], .tool-use, .tool-result');
  for (const toolEl of toolElements) {
    const toolName = toolEl.getAttribute('data-tool-name') ??
      toolEl.querySelector('[class*="tool-name"]')?.textContent ?? 'unknown';
    const isResult = toolEl.classList.contains('tool-result') ||
      toolEl.getAttribute('data-tool-result') !== null;

    sendDOMActivity({
      type: isResult ? 'tool_result' : 'tool_use',
      toolName,
      timestamp: Date.now(),
    });
  }
}

function sendDOMActivity(activity: DOMActivity): void {
  sendToBackground({ type: 'DOM_ACTIVITY', data: activity });
}

// Track conversation title changes
function setupTitleObserver(): void {
  let lastTitle = '';

  const checkTitle = () => {
    // Try to get conversation title from page
    const titleEl = document.querySelector('h1, [data-conversation-title]');
    const title = titleEl?.textContent?.trim() ?? '';

    if (title && title !== lastTitle) {
      lastTitle = title;

      // Get conversation ID from URL
      const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
      const conversationId = match?.[1];

      if (conversationId) {
        sendToBackground({
          type: 'CONVERSATION_TITLE',
          data: { title, conversationId },
        });
      }
    }
  };

  // Check periodically and on navigation
  setInterval(checkTitle, 2000);
  window.addEventListener('popstate', checkTitle);
}

function sendToBackground(message: ExtensionMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Silently ignore if background is not ready
  });
}

// Initialize
injectScript();
setupResponseListener();
setupDOMObserver();
setupTitleObserver();

console.log('[Chatdex] Content script loaded');
