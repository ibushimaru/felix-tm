/**
 * Background Service Worker
 * Routes messages between content script and side panel.
 * Manages TM storage in chrome.storage.local.
 */

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Enable side panel for Google Sheets
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Message routing: content script <-> side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CELL_CHANGED') {
    // Forward cell changes to all side panels
    chrome.runtime.sendMessage(msg).catch(() => {});
  }

  if (msg.type === 'WRITE_TO_SHEET') {
    // Forward write request to the content script of the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'WRITE_CELL',
          value: msg.value,
          targetColOffset: msg.targetColOffset,
        }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
  }

  if (msg.type === 'GET_CURRENT_CELL') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_CELL' }, (resp) => {
          sendResponse(resp || { value: '', ref: '' });
        });
        return true; // keep channel open
      }
      sendResponse({ value: '', ref: '' });
    });
    return true; // async response
  }

  // TM Storage operations
  if (msg.type === 'TM_SAVE') {
    chrome.storage.local.set({ felixTM: msg.data }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'TM_LOAD') {
    chrome.storage.local.get('felixTM', (result) => sendResponse(result.felixTM || []));
    return true;
  }
  if (msg.type === 'GLOSSARY_SAVE') {
    chrome.storage.local.set({ felixGlossary: msg.data }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'GLOSSARY_LOAD') {
    chrome.storage.local.get('felixGlossary', (result) => sendResponse(result.felixGlossary || []));
    return true;
  }
  if (msg.type === 'SETTINGS_SAVE') {
    chrome.storage.local.set({ felixSettings: msg.data }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'SETTINGS_LOAD') {
    chrome.storage.local.get('felixSettings', (result) => {
      sendResponse(result.felixSettings || { sourceCol: 'A', targetCol: 'B', minScore: 0.7, lang: 'en' });
    });
    return true;
  }
});
