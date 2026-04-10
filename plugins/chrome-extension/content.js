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

  // Try multiple selectors to find the formula bar
  function findFormulaBar() {
    const selectors = [
      '#t-formula-bar-input-container',
      '#t-formula-bar-input',
      '.cell-input',
      '.formulabar-input',
      '[aria-label="Formula input"]',
      '[aria-label="数式入力"]',
      '[aria-label="数式の入力"]',
      '.waffle-formula-bar-input',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        log('Formula bar found:', sel, el.tagName);
        return el;
      }
    }

    // Fallback: find by structure - look for contenteditable in the toolbar area
    const editables = document.querySelectorAll('[contenteditable="true"]');
    for (const el of editables) {
      // The formula bar is usually a contenteditable div in the top area
      const rect = el.getBoundingClientRect();
      if (rect.top < 100 && rect.width > 200) {
        log('Formula bar found via contenteditable heuristic:', el.tagName, el.className);
        return el;
      }
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
    if (!formulaBarEl) formulaBarEl = findFormulaBar();
    if (!formulaBarEl) return '';

    // Try different ways to read the value
    const val = formulaBarEl.textContent
      || formulaBarEl.innerText
      || formulaBarEl.value
      || '';
    return val.trim();
  }

  function getCellRef() {
    if (!nameBoxEl) nameBoxEl = findNameBox();
    if (!nameBoxEl) return '';
    return (nameBoxEl.value || nameBoxEl.textContent || '').trim();
  }

  function checkForChanges() {
    const value = getCellValue();
    const ref = getCellRef();

    if (ref !== lastCellRef || value !== lastCellValue) {
      lastCellValue = value;
      lastCellRef = ref;

      chrome.runtime.sendMessage({
        type: 'CELL_CHANGED',
        value: value,
        ref: ref,
      }).catch(() => {});
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
      writeToCell(msg.value);
      sendResponse({ ok: true });
    }
    if (msg.type === 'GET_CELL') {
      sendResponse({ value: getCellValue(), ref: getCellRef() });
    }
    if (msg.type === 'DEBUG_DOM') {
      const info = {
        formulaBar: !!findFormulaBar(),
        nameBox: !!findNameBox(),
        cellValue: getCellValue(),
        cellRef: getCellRef(),
        editables: document.querySelectorAll('[contenteditable]').length,
      };
      sendResponse(info);
    }
  });

  function writeToCell(value) {
    navigator.clipboard.writeText(value).then(() => {
      // Simulate Ctrl+V paste into active cell
      const bar = findFormulaBar();
      if (bar) {
        bar.focus();
        document.execCommand('insertText', false, value);
      }
    }).catch(err => log('Write failed:', err));
  }

  chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {});
  log('Content script loaded');
})();
