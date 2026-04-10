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

  function log(...args) {
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
      writeToTargetCell(msg.value, msg.targetCol || 'B');
      sendResponse({ ok: true });
    }
    if (msg.type === 'GET_CELL') {
      sendResponse({ value: getCellValue(), ref: getCellRef() });
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
   * Write value to the target column cell, then move to next row.
   *
   * Flow: current cell is A3 (source), targetCol is B
   *  1. Navigate to B3 via name box
   *  2. Write value to B3
   *  3. Navigate to A4 (next row source)
   */
  function writeToTargetCell(value, targetCol) {
    const ref = getCellRef(); // e.g. "A3"
    if (!ref) { log('No cell ref'); return; }

    // Parse row number from ref (e.g. "A3" -> 3, "AA15" -> 15)
    const match = ref.match(/([A-Z]+)(\d+)/i);
    if (!match) { log('Cannot parse ref:', ref); return; }
    const sourceCol = match[1];
    const rowNum = match[2];
    const targetRef = targetCol + rowNum;        // B3
    const nextSourceRef = sourceCol + (parseInt(rowNum) + 1); // A4

    log('Write:', targetRef, '=', value, 'then move to', nextSourceRef);

    // Step 1: Navigate to target cell via name box
    navigateToCell(targetRef, () => {
      // Step 2: Write value
      setTimeout(() => {
        writeToCellInput(value, () => {
          // Step 3: Navigate to next row source cell
          setTimeout(() => {
            navigateToCell(nextSourceRef);
          }, 200);
        });
      }, 200);
    });
  }

  /**
   * Navigate to a cell by typing into the Name Box and pressing Enter.
   */
  function navigateToCell(ref, callback) {
    const nameBox = findNameBox();
    if (!nameBox) { log('Name box not found'); return; }

    // Focus name box, clear it, type the cell reference, press Enter
    nameBox.focus();
    nameBox.select && nameBox.select();
    nameBox.value = ref;
    nameBox.dispatchEvent(new Event('input', { bubbles: true }));
    nameBox.dispatchEvent(new Event('change', { bubbles: true }));

    // Press Enter to navigate
    nameBox.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13,
      bubbles: true, cancelable: true,
    }));
    nameBox.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter', code: 'Enter', keyCode: 13,
      bubbles: true, cancelable: true,
    }));

    if (callback) setTimeout(callback, 150);
  }

  /**
   * Write text into the currently active cell via .cell-input.
   */
  function writeToCellInput(value, callback) {
    const cellInput = document.querySelector('.cell-input');
    if (!cellInput) { log('cell-input not found'); return; }

    cellInput.focus();

    // Select all existing content and replace
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(cellInput);
    sel.removeAllRanges();
    sel.addRange(range);

    // Use execCommand to insert text (works in contenteditable)
    document.execCommand('insertText', false, value);

    // Dispatch input event
    cellInput.dispatchEvent(new Event('input', { bubbles: true }));

    if (callback) setTimeout(callback, 100);
  }

  chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {});
  log('Content script loaded');
})();
