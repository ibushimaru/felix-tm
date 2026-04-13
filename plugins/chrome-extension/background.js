/**
 * Background Service Worker
 * Routes messages, manages storage, and handles content script injection.
 */

// Click icon: toggle in-page overlay panel
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }, () => {
    void chrome.runtime.lastError;
  });
});

// Right-click: open manage page
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-manage',
    title: 'Felix TM — Manage',
    contexts: ['action'],
  });

  // Re-inject content script into all open Google Sheets tabs
  // so users don't need to manually reload after extension update
  chrome.tabs.query({ url: 'https://docs.google.com/spreadsheets/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['felix-engine.js', 'content.js'],
      }).catch(() => {});
    }
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'open-manage') {
    chrome.windows.create({
      url: 'manage.html', type: 'popup', width: 420, height: 700,
    });
  }
});

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

  // Cell change: forward to all listeners
  if (msg.type === 'CELL_CHANGED') {
    chrome.runtime.sendMessage(msg).catch(() => {});
    return;
  }

  // Broadcast to content scripts in all Google Sheets tabs
  if (msg.type === 'BROADCAST') {
    chrome.tabs.query({ url: 'https://docs.google.com/spreadsheets/*' }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, msg.payload).catch(() => {});
      }
    });
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
          type: 'WRITE_CELL', value: msg.value, targetCol: msg.targetCol || 'B',
        }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
    return;
  }

  // Sheets API write via chrome.identity token
  if (msg.type === 'SHEETS_API_WRITE') {
    const d = msg.data || msg; // support both { type, data: {...} } and flat format
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (!token) {
        sendResponse({ error: chrome.runtime.lastError?.message || 'No token' });
        return;
      }
      const range = encodeURIComponent(d.range);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${d.spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;
      fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [[d.value]] }),
      }).then(r => {
        // console.log('[FelixTM BG] Response status:', r.status);
        return r.json();
      }).then(data => {
        // console.log('[FelixTM BG] Response:', JSON.stringify(data).substring(0, 200));
        sendResponse(data);
      }).catch(err => {
        // console.log('[FelixTM BG] Error:', err.message);
        sendResponse({ error: err.message });
      });
    });
    return true;
  }

  // Sheets API read (from content script directly)
  if (msg.type === 'SHEETS_API_READ_DIRECT' || msg.type === 'SHEETS_API_READ') {
    const d = msg.data || msg;
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (!token) { sendResponse({ value: '' }); return; }
      const range = encodeURIComponent(d.range);
      fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${d.spreadsheetId}/values/${range}`,
        { headers: { 'Authorization': 'Bearer ' + token } }
      ).then(r => r.json()).then(data => {
        const val = data.values && data.values[0] ? data.values[0][0] : '';
        sendResponse({ value: val || '' });
      }).catch(() => sendResponse({ value: '' }));
    });
    return true;
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
