/**
 * Background Service Worker
 * Routes messages, manages storage, and handles content script injection.
 */

// Open side panel on icon click
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Inject content script programmatically when needed
async function ensureContentScript(tabId) {
  try {
    // Check if already injected by sending a ping
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return { injected: true, method: 'already' };
  } catch {
    // Not injected yet — inject programmatically
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      return { injected: true, method: 'programmatic' };
    } catch (err) {
      return { injected: false, error: err.message };
    }
  }
}

// Message routing
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Cell change: forward to all listeners (side panel)
  if (msg.type === 'CELL_CHANGED') {
    chrome.runtime.sendMessage(msg).catch(() => {});
    return;
  }

  // Ensure content script is injected, then forward message to it
  if (msg.type === 'ENSURE_CONTENT_SCRIPT') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]) {
        const result = await ensureContentScript(tabs[0].id);
        sendResponse(result);
      } else {
        sendResponse({ injected: false, error: 'No active tab' });
      }
    });
    return true;
  }

  // Forward to content script in active tab
  if (msg.type === 'TO_CONTENT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, msg.payload, (resp) => {
          sendResponse(resp || {});
        });
      } else {
        sendResponse({ error: 'No active tab' });
      }
    });
    return true;
  }

  if (msg.type === 'WRITE_TO_SHEET') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'WRITE_CELL', value: msg.value,
        }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
    return;
  }

  // Storage operations
  if (msg.type === 'TM_SAVE') {
    chrome.storage.local.set({ felixTM: msg.data }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'TM_LOAD') {
    chrome.storage.local.get('felixTM', (r) => sendResponse(r.felixTM || []));
    return true;
  }
  if (msg.type === 'GLOSSARY_SAVE') {
    chrome.storage.local.set({ felixGlossary: msg.data }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'GLOSSARY_LOAD') {
    chrome.storage.local.get('felixGlossary', (r) => sendResponse(r.felixGlossary || []));
    return true;
  }
  if (msg.type === 'SETTINGS_SAVE') {
    chrome.storage.local.set({ felixSettings: msg.data }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'SETTINGS_LOAD') {
    chrome.storage.local.get('felixSettings', (r) => {
      sendResponse(r.felixSettings || { sourceCol: 'A', targetCol: 'B', minScore: 0.7, lang: 'en' });
    });
    return true;
  }
});
