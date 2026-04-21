/**
 * Background Service Worker
 * Routes messages, manages storage (IndexedDB), and handles content script injection.
 */

// Import IndexedDB wrapper
importScripts('db.js', 'felix-engine.js');

// Track the last active Google Sheets tab
let _lastSheetsTabId = null;

// One-shot intent for the glossary tab of the side panel. Set by the
// content script when an uncovered term is clicked; consumed by the side
// panel on mount (via CONSUME_PENDING_GLOSSARY_ACTION) or live via the
// broadcast below when the panel is already open.
let _pendingGlossaryAction = null;

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (tab && tab.url && tab.url.includes('docs.google.com/spreadsheets/')) {
      _lastSheetsTabId = tabId;
    }
  });
});

// Click icon: toggle in-page overlay panel
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }, () => {
    void chrome.runtime.lastError;
  });
});

// Right-click on icon: offer to open the side panel.
// Icon click still toggles the in-page overlay (chrome.action.onClicked above).
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[FelixTM bg] onInstalled', details && details.reason);
  // create() throws on re-install if the id already exists, so guard with removeAll.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'open-side-panel',
      title: 'Felix TM — Open Side Panel',
      contexts: ['action'],
    });
  });

  // Icon click should NOT auto-open the side panel — we keep the toggle-overlay
  // behavior. The side panel opens via ⚙ in the overlay or this context menu.
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }

  // Migrate data from chrome.storage.local to IndexedDB (one-time)
  migrateFromChromeStorage().then(migrated => {
    if (migrated) console.log('[FelixTM] Migration to IndexedDB complete');
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'open-side-panel') {
    openSidePanel(tab && tab.windowId);
  }
});

function openSidePanel(windowId) {
  if (!chrome.sidePanel || !chrome.sidePanel.open) return;
  const args = windowId != null ? { windowId } : {};
  chrome.sidePanel.open(args).catch((err) => {
    console.warn('[FelixTM] sidePanel.open failed:', err && err.message);
  });
}

// Message routing
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Dev-only: reload the whole extension. Triggered by an in-page
  // window.postMessage → content.js bridge so Claude in Chrome (a separate
  // extension) can request a reload without externally_connectable. Remove
  // this handler before publishing.
  if (msg.type === 'DEV_RELOAD') {
    console.log('[FelixTM] DEV_RELOAD requested — reloading in 50ms');
    sendResponse({ ok: true });
    setTimeout(() => chrome.runtime.reload(), 50);
    return true;
  }

  // Open the Chrome side panel (requested by ⚙ in the in-page overlay).
  // Must be called synchronously in response to a user gesture.
  if (msg.type === 'OPEN_SIDE_PANEL') {
    const windowId = sender && sender.tab ? sender.tab.windowId : undefined;
    openSidePanel(windowId);
    sendResponse({ ok: true });
    return;
  }

  // Open the side panel and stash a one-shot intent for the glossary tab.
  // Content scripts can't reach chrome.storage.session with the default
  // access level, and a direct broadcast would race the panel mount, so
  // the service worker holds the intent in memory and hands it off either
  // via the mount-time CONSUME_PENDING_GLOSSARY_ACTION request or via an
  // immediate GLOSSARY_ACTION broadcast for an already-open panel.
  if (msg.type === 'OPEN_GLOSSARY_WITH_ACTION') {
    _pendingGlossaryAction = msg.data || msg.payload || null;
    const windowId = sender && sender.tab ? sender.tab.windowId : undefined;
    openSidePanel(windowId);
    if (_pendingGlossaryAction) {
      chrome.runtime.sendMessage({ type: 'GLOSSARY_ACTION', payload: _pendingGlossaryAction }).catch(() => {});
    }
    // Safety net: if neither CONSUME nor the broadcast delivery picked up
    // the pending action (e.g. the panel was never open and never mounts),
    // drop it so a later unrelated open doesn't replay a stale click.
    setTimeout(() => { _pendingGlossaryAction = null; }, 5000);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'CONSUME_PENDING_GLOSSARY_ACTION') {
    const payload = _pendingGlossaryAction;
    _pendingGlossaryAction = null;
    sendResponse(payload);
    return;
  }

  // Broadcast to both content scripts (Sheets tabs) and extension pages
  // (side panel, popup). chrome.tabs.sendMessage reaches only content scripts,
  // so we also call chrome.runtime.sendMessage to cover extension contexts.
  if (msg.type === 'BROADCAST') {
    chrome.runtime.sendMessage(msg.payload).catch(() => {});
    chrome.tabs.query({ url: 'https://docs.google.com/spreadsheets/*' }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, msg.payload).catch(() => {});
      }
    });
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
      }).then(r => r.json()).then(data => sendResponse(data))
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }

  // Sheets API batch write — multiple ranges in one request.
  // Payload: { spreadsheetId, updates: [{ range: "Sheet1!B5", value: "..." }, ...] }
  // Uses values:batchUpdate under the hood.
  if (msg.type === 'SHEETS_API_BATCH_WRITE') {
    const d = msg.data || msg;
    const updates = Array.isArray(d.updates) ? d.updates : [];
    if (!updates.length) { sendResponse({ updatedCells: 0 }); return; }
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (!token) {
        sendResponse({ error: chrome.runtime.lastError?.message || 'No token' });
        return;
      }
      const body = {
        valueInputOption: 'USER_ENTERED',
        data: updates.map(u => ({ range: u.range, values: [[u.value]] })),
      };
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${d.spreadsheetId}/values:batchUpdate`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json()).then(data => sendResponse(data))
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }

  // Sheets API batch read (single column)
  if (msg.type === 'SHEETS_API_READ_BATCH') {
    const d = msg.data || msg;
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (!token) { sendResponse({ values: [] }); return; }
      const range = encodeURIComponent(d.range);
      fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${d.spreadsheetId}/values/${range}`,
        { headers: { 'Authorization': 'Bearer ' + token } }
      ).then(r => r.json()).then(data => {
        const values = (data.values || []).map(row => row[0] || '');
        sendResponse({ values });
      }).catch(() => sendResponse({ values: [] }));
    });
    return true;
  }

  // Sheets API read (from content script directly)
  if (msg.type === 'SHEETS_API_READ_DIRECT') {
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

  // Helper: find the correct Sheets tab (last active, or fallback to any)
  function findSheetsTab(callback) {
    if (_lastSheetsTabId) {
      chrome.tabs.get(_lastSheetsTabId, (tab) => {
        if (chrome.runtime.lastError || !tab || !tab.url || !tab.url.includes('docs.google.com/spreadsheets/')) {
          // Fallback
          chrome.tabs.query({ url: 'https://docs.google.com/spreadsheets/*' }, (tabs) => {
            callback(tabs.length ? tabs[0].id : null);
          });
        } else {
          callback(tab.id);
        }
      });
    } else {
      chrome.tabs.query({ url: 'https://docs.google.com/spreadsheets/*' }, (tabs) => {
        callback(tabs.length ? tabs[0].id : null);
      });
    }
  }

  // Get selection from Google Sheets content script
  if (msg.type === 'GET_SELECTION') {
    findSheetsTab((tabId) => {
      if (!tabId) { sendResponse({}); return; }
      chrome.tabs.sendMessage(tabId, { type: 'GET_SELECTION' }, (resp) => {
        sendResponse(resp || {});
      });
    });
    return true;
  }

  // Get spreadsheet info from the Google Sheets content script
  if (msg.type === 'GET_SHEET_INFO') {
    findSheetsTab((tabId) => {
      if (!tabId) { sendResponse({}); return; }
      chrome.tabs.sendMessage(tabId, { type: 'GET_SHEET_INFO' }, (resp) => {
        sendResponse(resp || {});
      });
    });
    return true;
  }

  // Sheets API write with rich text formatting (bold/color on specific ranges)
  if (msg.type === 'SHEETS_API_WRITE_FORMATTED') {
    const d = msg.data || msg;
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (!token) { sendResponse({ error: 'No token' }); return; }

      // First: get sheetId from sheet name
      const ssId = d.spreadsheetId;
      const rangeMatch = d.range.match(/^'?([^'!]+)'?!([A-Z]+)(\d+)$/i);
      if (!rangeMatch) { sendResponse({ error: 'Invalid range' }); return; }

      const sheetName = rangeMatch[1];
      const col = rangeMatch[2].toUpperCase().charCodeAt(0) - 65;
      const row = parseInt(rangeMatch[3]) - 1;

      // Get sheet ID
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}?fields=sheets.properties`, {
        headers: { 'Authorization': 'Bearer ' + token },
      }).then(r => r.json()).then(meta => {
        const sheet = meta.sheets.find(s => s.properties.title === sheetName);
        const sheetId = sheet ? sheet.properties.sheetId : 0;

        const runs = FelixEngine.buildCellFormatRuns(
          d.value, d.placedRanges || [], d.unverifiedRanges || [],
        );

        const body = {
          requests: [{
            updateCells: {
              rows: [{ values: [{
                userEnteredValue: { stringValue: d.value },
                textFormatRuns: runs,
              }] }],
              range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: col, endColumnIndex: col + 1 },
              fields: 'userEnteredValue,textFormatRuns',
            }
          }]
        };

        return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}:batchUpdate`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }).then(r => r.json()).then(data => {
        sendResponse(data);
      }).catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }

  // Storage operations (IndexedDB)
  if (msg.type === 'TM_SAVE') {
    tmSaveAll(msg.data).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'TM_LOAD') {
    tmGetAll().then(data => sendResponse(data)).catch(() => sendResponse([]));
    return true;
  }
  if (msg.type === 'TM_DELETE') {
    tmDelete(msg.data).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'TM_COUNT') {
    tmCount().then(n => sendResponse({ count: n })).catch(() => sendResponse({ count: 0 }));
    return true;
  }
  if (msg.type === 'GLOSSARY_SAVE') {
    glossarySaveAll(msg.data).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'GLOSSARY_LOAD') {
    glossaryGetAll().then(data => sendResponse(data)).catch(() => sendResponse([]));
    return true;
  }
  if (msg.type === 'RULES_SAVE') {
    rulesSaveAll(msg.data).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'RULES_LOAD') {
    rulesGetAll().then(data => sendResponse(data)).catch(() => sendResponse([]));
    return true;
  }
  if (msg.type === 'SETTINGS_SAVE') {
    settingsSave(msg.data).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'SETTINGS_LOAD') {
    settingsGet().then(data => {
      const defaults = { sourceCol: 'A', targetCol: 'B', minScore: 0.7, lang: 'en' };
      sendResponse(Object.keys(data).length ? data : defaults);
    }).catch(() => sendResponse({ sourceCol: 'A', targetCol: 'B', minScore: 0.7, lang: 'en' }));
    return true;
  }
});
