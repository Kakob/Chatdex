// Content script that runs on the localhost web app
// Listens for live activity notifications from the background to update the UI

// Listen for activity notifications from background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ACTIVITY_STORED') {
    // Dispatch custom event to notify the web app for live UI updates
    window.dispatchEvent(new CustomEvent('claude-utils-activity', {
      detail: { activity: message.activity },
    }));
    sendResponse({ success: true });
  }
  return true;
});

console.log('[Chatdex] Web app sync listener ready');
