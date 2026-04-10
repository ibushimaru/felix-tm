/**
 * Content Script — Injected into Google Sheets pages.
 * Monitors cell selection and communicates with the side panel.
 */

(() => {
  let lastCellValue = '';
  let lastCellRef = '';

  // Google Sheets formula bar selector
  const FORMULA_BAR_SELECTORS = [
    '#t-formula-bar-input-container',
    '.cell-input',
    '[aria-label="Formula input"]',
  ];

  const NAME_BOX_SELECTORS = [
    '#t-name-box .waffle-name-box',
    '.waffle-name-box',
    '[aria-label="Name Box"]',
  ];

  function getFormulaBarElement() {
    for (const sel of FORMULA_BAR_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function getNameBoxElement() {
    for (const sel of NAME_BOX_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function getCellValue() {
    const bar = getFormulaBarElement();
    if (bar) {
      return bar.textContent || bar.innerText || '';
    }
    return '';
  }

  function getCellRef() {
    const box = getNameBoxElement();
    if (box) {
      return (box.value || box.textContent || '').trim();
    }
    return '';
  }

  function checkForChanges() {
    const value = getCellValue();
    const ref = getCellRef();

    if (ref !== lastCellRef || value !== lastCellValue) {
      lastCellValue = value;
      lastCellRef = ref;

      // Send to side panel via background
      chrome.runtime.sendMessage({
        type: 'CELL_CHANGED',
        value: value,
        ref: ref,
      }).catch(() => {});
    }
  }

  // Poll for changes at 200ms intervals — fast enough to feel real-time
  setInterval(checkForChanges, 200);

  // Also observe DOM mutations on the formula bar for instant detection
  function observeFormulaBar() {
    const bar = getFormulaBarElement();
    if (!bar) {
      setTimeout(observeFormulaBar, 1000);
      return;
    }

    const observer = new MutationObserver(() => {
      checkForChanges();
    });

    observer.observe(bar, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Wait for Google Sheets to fully load
  setTimeout(observeFormulaBar, 2000);

  // Listen for commands from side panel
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'WRITE_CELL') {
      writeToCellBelow(msg.value, msg.targetColOffset);
      sendResponse({ ok: true });
    }
    if (msg.type === 'GET_CELL') {
      sendResponse({ value: getCellValue(), ref: getCellRef() });
    }
  });

  /**
   * Write a value to the target column of the current row.
   * Uses clipboard paste approach for reliability.
   */
  function writeToCellBelow(value, colOffset) {
    // Click on the target cell: we need to simulate navigation
    // For now, use keyboard simulation: Tab to move to target column, type value
    // This is a simplified approach — may need refinement
    const bar = getFormulaBarElement();
    if (!bar) return;

    // Copy value to clipboard and paste
    navigator.clipboard.writeText(value).then(() => {
      // Focus the formula bar and paste
      document.execCommand('paste');
    }).catch(() => {
      // Fallback: use a temporary textarea
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  }

  // Notify background that content script is ready
  chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {});
})();
