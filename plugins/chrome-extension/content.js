/**
 * Content Script — Injected into Google Sheets pages.
 * Monitors cell selection via formula bar and communicates with side panel.
 */

(() => {
  let lastCellValue = '';
  let lastCellRef = '';
  let formulaBarEl = null;
  let nameBoxEl = null;
  let debugMode = true;

  const _logs = [];
  function log(...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    _logs.push(msg);
    if (_logs.length > 50) _logs.shift();
    if (debugMode) console.log('[FelixTM]', ...args);
  }

  // Find the formula bar element.
  // Google Sheets uses .cell-input as the active cell editor overlay.
  // This element's textContent always reflects the selected cell's value.
  let _cachedBar = null;

  function findFormulaBar() {
    // Primary: .cell-input (confirmed working via debug)
    const ci = document.querySelector('.cell-input');
    if (ci) return ci;

    // Fallback selectors
    const selectors = [
      '#t-formula-bar-input',
      '[contenteditable="true"][aria-label]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    return null;
  }

  function findNameBox() {
    const selectors = [
      '#t-name-box .waffle-name-box',
      '.waffle-name-box',
      'input[aria-label="Name Box"]',
      'input[aria-label="名前ボックス"]',
      '#t-name-box input',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        log('Name box found:', sel);
        return el;
      }
    }
    return null;
  }

  function getCellValue() {
    // Don't cache — re-find every time (DOM can change)
    const bar = findFormulaBar();
    if (!bar) return '';
    return (bar.textContent || bar.innerText || bar.value || '').trim();
  }

  function getCellRef() {
    const box = findNameBox();
    if (!box) return '';
    return (box.value || box.textContent || '').trim();
  }

  function checkForChanges() {
    const value = getCellValue();
    const ref = getCellRef();

    // Send update if anything changed (value or ref)
    if (value !== lastCellValue || ref !== lastCellRef) {
      lastCellValue = value;
      lastCellRef = ref;

      // Only send if we have a non-empty value
      if (value) {
        chrome.runtime.sendMessage({
          type: 'CELL_CHANGED',
          value: value,
          ref: ref,
        }).catch(() => {});
      }
    }
  }

  // Poll at 200ms
  setInterval(checkForChanges, 200);

  // MutationObserver on formula bar for instant detection
  function setupObserver() {
    formulaBarEl = findFormulaBar();
    if (!formulaBarEl) {
      log('Formula bar not found yet, retrying in 2s...');
      setTimeout(setupObserver, 2000);
      return;
    }

    log('Setting up MutationObserver on formula bar');
    new MutationObserver(() => checkForChanges()).observe(formulaBarEl, {
      childList: true, subtree: true, characterData: true,
    });

    // Also observe parent in case the element gets replaced
    if (formulaBarEl.parentElement) {
      new MutationObserver(() => {
        const newBar = findFormulaBar();
        if (newBar && newBar !== formulaBarEl) {
          formulaBarEl = newBar;
          log('Formula bar element changed, re-observing');
        }
        checkForChanges();
      }).observe(formulaBarEl.parentElement, {
        childList: true, subtree: true, characterData: true,
      });
    }
  }

  // Wait for Sheets to fully load
  setTimeout(setupObserver, 3000);

  // Dump available selectors for debugging
  setTimeout(() => {
    log('=== DOM Debug ===');
    log('contenteditable elements:', document.querySelectorAll('[contenteditable]').length);
    log('#t-formula-bar-input-container:', !!document.querySelector('#t-formula-bar-input-container'));
    log('#t-formula-bar-input:', !!document.querySelector('#t-formula-bar-input'));
    log('.cell-input:', !!document.querySelector('.cell-input'));
    log('.waffle-name-box:', !!document.querySelector('.waffle-name-box'));
    log('Formula bar result:', !!findFormulaBar());
    log('Name box result:', !!findNameBox());
  }, 5000);

  // Listen for messages from side panel / background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ pong: true });
      return;
    }
    if (msg.type === 'WRITE_CELL') {
      writeToTargetAndAdvance(msg.value, msg.targetCol || 'B')
        .then(() => sendResponse({ ok: true }))
        .catch(e => { log('Write error:', e); sendResponse({ ok: false }); });
      return true; // async response
    }
    if (msg.type === 'GET_CELL') {
      sendResponse({ value: getCellValue(), ref: getCellRef() });
    }
    if (msg.type === 'GET_LOGS') {
      sendResponse({ logs: _logs.slice() });
      return;
    }
    if (msg.type === 'DEBUG_DOM') {
      const bar = findFormulaBar();
      const box = findNameBox();
      const info = {
        formulaBar: !!bar,
        nameBox: !!box,
        cellValue: getCellValue(),
        cellRef: getCellRef(),
        editables: document.querySelectorAll('[contenteditable]').length,
        barTag: bar ? bar.tagName : null,
        barClass: bar ? bar.className.substring(0, 60) : null,
        barChildren: bar ? bar.children.length : 0,
        barHTML: bar ? bar.innerHTML.substring(0, 100) : null,
        barText: bar ? (bar.textContent || '').substring(0, 50) : null,
        barValue: bar ? (bar.value || '').substring(0, 50) : null,
        barRole: bar ? bar.getAttribute('aria-label') : null,
      };
      sendResponse(info);
    }
  });

  /**
   * Extract spreadsheet ID from the current URL.
   */
  function getSpreadsheetId() {
    const m = location.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  /**
   * Get the active sheet's gid and convert to sheet name.
   */
  function getSheetGid() {
    const m = location.hash.match(/gid=(\d+)/);
    return m ? m[1] : '0';
  }

  /**
   * Write to a specific cell via Google Sheets internal API (same origin).
   * No OAuth needed — uses the session cookie.
   * Then move the active cell to the next row.
   */
  async function writeToTargetAndAdvance(value, targetCol) {
    const ref = getCellRef(); // e.g. "A3"
    if (!ref) { log('No cell ref'); return; }

    const match = ref.match(/([A-Z]+)(\d+)/i);
    if (!match) { log('Cannot parse ref:', ref); return; }

    const sourceCol = match[1];
    const rowNum = parseInt(match[2]);
    const targetRef = targetCol + rowNum;          // B3
    const nextSourceRef = sourceCol + (rowNum + 1); // A4

    const ssId = getSpreadsheetId();
    if (!ssId) { log('Cannot find spreadsheet ID'); return; }

    log('Writing', targetRef, '=', value, '(no navigation)');

    // Use the Google Sheets Values API via fetch with session cookies
    try {
      const range = encodeURIComponent(targetRef);
      const resp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/${range}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[value]] }),
        }
      );

      if (!resp.ok) {
        // Sheets API with cookies might not work — fall back to token from extension
        log('Sheets API cookie auth failed:', resp.status, await resp.text());
        // Try via background with chrome.identity
        chrome.runtime.sendMessage({
          type: 'SHEETS_API_WRITE',
          spreadsheetId: ssId,
          range: targetRef,
          value: value,
        });
      } else {
        log('Written via Sheets API');
      }
    } catch (err) {
      log('Fetch error:', err);
    }

    // Move to next row source cell via name box
    const nameBox = findNameBox();
    if (nameBox) {
      nameBox.focus();
      if (nameBox.select) nameBox.select();
      nameBox.value = nextSourceRef;
      nameBox.dispatchEvent(new Event('input', { bubbles: true }));
      nameBox.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true,
      }));
    }
  }

  chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {});
  log('Content script loaded');
})();
