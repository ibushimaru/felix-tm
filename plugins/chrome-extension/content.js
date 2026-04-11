/**
 * Content Script — Felix TM Overlay Panel
 * Injects a floating, draggable TM panel directly into Google Sheets.
 * Mouse Dictionary-style: always on top, no separate window needed.
 */

(() => {
  // === State ===
  let tmData = [];
  let glossaryData = [];
  let settings = { sourceCol: 'A', targetCol: 'B', minScore: 0.7, lang: 'en',
                    shortcutGet: 'Cmd+Shift+J', shortcutSet: 'Cmd+Shift+U' };
  let lastCellValue = '';
  let lastCellRef = '';
  let panelVisible = false;
  let _pollTimer = null;

  // === Extension validity check ===
  function isValid() { try { return !!chrome.runtime.id; } catch (_) { return false; } }
  function msg(type, data) {
    return new Promise(r => {
      try { chrome.runtime.sendMessage({ type, data }, resp => { void chrome.runtime.lastError; r(resp); }); }
      catch (_) { r(null); }
    });
  }

  // === Load data from storage ===
  async function loadData() {
    tmData = await msg('TM_LOAD') || [];
    glossaryData = await msg('GLOSSARY_LOAD') || [];
    settings = await msg('SETTINGS_LOAD') || settings;
    updateBadge();
  }

  // === Google Sheets DOM ===
  function findFormulaBar() {
    return document.querySelector('.cell-input') ||
           document.querySelector('#t-formula-bar-input') ||
           document.querySelector('[contenteditable="true"][aria-label]');
  }

  function findNameBox() {
    const sels = ['.waffle-name-box', 'input[aria-label="Name Box"]', 'input[aria-label="名前ボックス"]', '#t-name-box input'];
    for (const s of sels) { const el = document.querySelector(s); if (el) return el; }
    return null;
  }

  function getCellValue() {
    const bar = findFormulaBar();
    return bar ? (bar.textContent || bar.innerText || '').trim() : '';
  }

  function getCellRef() {
    const box = findNameBox();
    return box ? (box.value || box.textContent || '').trim() : '';
  }

  function getSpreadsheetId() {
    const m = location.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  // === Create the overlay panel ===
  function createPanel() {
    if (document.getElementById('felix-tm-panel')) return;

    const host = document.createElement('div');
    host.id = 'felix-tm-panel';
    const shadow = host.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      #panel {
        position: fixed; top: 80px; right: 20px; width: 360px; max-height: 80vh;
        background: #fff; border: 1px solid #dadce0; border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15); z-index: 999999;
        display: flex; flex-direction: column; overflow: hidden;
        font-size: 13px; color: #202124; resize: both;
      }
      #header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px; background: #f8f9fa; border-bottom: 1px solid #e8eaed;
        cursor: move; user-select: none;
      }
      #header h1 { font-size: 14px; font-weight: 600; }
      .badge { background: #e8eaed; color: #5f6368; padding: 2px 8px; border-radius: 12px; font-size: 10px; }
      .btn-close { background: none; border: none; font-size: 18px; cursor: pointer; color: #5f6368; padding: 0 4px; }
      .btn-close:hover { color: #202124; }
      #body { padding: 10px 14px; overflow-y: auto; flex: 1; }
      .cell-preview { background: #f1f3f4; border-radius: 4px; padding: 6px 10px; font-size: 12px; color: #3c4043; margin-bottom: 8px; min-height: 20px; word-break: break-all; }
      .cell-label { font-size: 10px; color: #9aa0a6; margin-bottom: 2px; }
      .row { display: flex; gap: 6px; margin-bottom: 8px; }
      .row > * { flex: 1; }
      select { width: 100%; padding: 6px; border: 1px solid #dadce0; border-radius: 4px; font-size: 12px; }
      .match { background: #f8f9fa; border: 1px solid #e8eaed; border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer; transition: all 0.1s; }
      .match:hover { border-color: #1a73e8; background: #e8f0fe; }
      .match.inserted { border-color: #34a853; opacity: 0.6; }
      .score { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 10px; font-weight: 600; color: #fff; }
      .score-high { background: #34a853; }
      .score-mid { background: #f9ab00; }
      .score-low { background: #ea4335; }
      .match-source { color: #5f6368; font-size: 11px; margin-top: 3px; word-break: break-all; }
      .match-target { color: #202124; font-size: 12px; margin-top: 2px; word-break: break-all; }
      .match-meta { color: #9aa0a6; font-size: 10px; margin-top: 3px; }
      .empty { text-align: center; color: #9aa0a6; padding: 16px 8px; font-size: 12px; }
      .set-bar { display: flex; gap: 6px; margin-top: 6px; padding-top: 6px; border-top: 1px solid #e8eaed; }
      .btn { padding: 6px 12px; border-radius: 4px; border: 1px solid #dadce0; cursor: pointer; font-size: 11px; font-weight: 500; background: #fff; color: #1a73e8; }
      .btn:hover { background: #f1f3f4; }
      .toast { padding: 6px 10px; border-radius: 4px; font-size: 11px; margin-top: 6px; background: #e6f4ea; color: #137333; }
      .diff-match { color: #137333; }
      .diff-sub { background: #fef7cd; color: #8a6d00; border-radius: 2px; padding: 0 1px; }
      .diff-del { background: #fce8e6; color: #c5221f; border-radius: 2px; padding: 0 1px; text-decoration: line-through; }
      .diff-ins { background: #e6f4ea; color: #137333; border-radius: 2px; padding: 0 1px; }
      .shortcut { font-size: 10px; color: #9aa0a6; }
    </style>
    <div id="panel">
      <div id="header">
        <h1>Felix TM</h1>
        <span>
          <span class="badge" id="badge">TM: 0</span>
          <button class="btn-close" id="btn-min">−</button>
          <button class="btn-close" id="btn-close">✕</button>
        </span>
      </div>
      <div id="body">
        <div class="cell-label">Active Cell <span id="cell-ref"></span></div>
        <div class="cell-preview" id="cell-value">—</div>
        <div class="row">
          <select id="min-score">
            <option value="0.5">50%</option><option value="0.6">60%</option>
            <option value="0.7" selected>70%</option><option value="0.8">80%</option>
            <option value="0.9">90%</option>
          </select>
        </div>
        <div id="results"><div class="empty">Select a cell to search TM</div></div>
        <div class="set-bar">
          <button class="btn" id="btn-set" style="flex:1">Set (register to TM)</button>
          <span class="shortcut" id="shortcut-label"></span>
        </div>
        <div id="toast-area"></div>
      </div>
    </div>`;

    document.body.appendChild(host);

    const panel = shadow.getElementById('panel');
    const header = shadow.getElementById('header');

    // Dragging
    let isDragging = false, dx = 0, dy = 0;
    header.addEventListener('mousedown', e => {
      isDragging = true;
      dx = e.clientX - panel.offsetLeft;
      dy = e.clientY - panel.offsetTop;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      panel.style.left = (e.clientX - dx) + 'px';
      panel.style.top = (e.clientY - dy) + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });

    // Close / Minimize
    shadow.getElementById('btn-close').addEventListener('click', () => { host.style.display = 'none'; panelVisible = false; });
    shadow.getElementById('btn-min').addEventListener('click', () => {
      const body = shadow.getElementById('body');
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    // Score change
    shadow.getElementById('min-score').addEventListener('change', () => doSearch());

    // Set button
    shadow.getElementById('btn-set').addEventListener('click', () => doSet());

    // Store shadow ref for updates
    host._shadow = shadow;

    updateShortcutLabel();
    return shadow;
  }

  function getShadow() {
    const host = document.getElementById('felix-tm-panel');
    return host ? host._shadow : null;
  }

  function showPanel() {
    let host = document.getElementById('felix-tm-panel');
    if (!host) createPanel();
    else host.style.display = 'block';
    panelVisible = true;
    loadData();
  }

  function updateBadge() {
    const s = getShadow();
    if (s) s.getElementById('badge').textContent = `TM: ${tmData.length}`;
  }

  function updateShortcutLabel() {
    const s = getShadow();
    if (!s) return;
    const getKey = (settings.shortcutGet || 'Cmd+Shift+J').replace('Cmd', '⌘').replace('Shift', '⇧').replace('Ctrl', '⌃');
    const setKey = (settings.shortcutSet || 'Cmd+Shift+U').replace('Cmd', '⌘').replace('Shift', '⇧').replace('Ctrl', '⌃');
    s.getElementById('shortcut-label').textContent = `Get:${getKey} Set:${setKey}`;
  }

  // === Search ===
  function doSearch(query) {
    const s = getShadow();
    if (!s || !panelVisible) return;
    if (!query) query = lastCellValue;
    if (!query) return;

    const minScore = parseFloat(s.getElementById('min-score').value);
    const t0 = performance.now();
    const matches = FelixEngine.search(query, tmData, minScore);
    const ms = (performance.now() - t0).toFixed(1);

    const el = s.getElementById('results');
    if (!matches.length) {
      el.innerHTML = `<div class="empty">No matches (${ms}ms)</div>`;
      return;
    }

    el.innerHTML = matches.map((m, i) => {
      const pct = Math.round(m.score * 100);
      const cls = pct >= 90 ? 'score-high' : pct >= 70 ? 'score-mid' : 'score-low';
      const diff = pct < 100 ? FelixEngine.diffHighlight(query, m.source) : null;
      const srcHtml = diff ? diff.sourceHtml : esc(m.source);
      const meta = m.refcount ? `used ${m.refcount}x` : '';
      return `<div class="match" data-idx="${i}" data-target="${escA(m.target)}">
        <span class="score ${cls}">${pct}%</span>
        ${i === 0 ? `<span style="float:right;font-size:10px;color:#9aa0a6">${ms}ms</span>` : ''}
        <div class="match-source">${srcHtml}</div>
        <div class="match-target">${esc(m.target)}</div>
        ${meta ? `<div class="match-meta">${meta}</div>` : ''}
      </div>`;
    }).join('');

    el.querySelectorAll('.match').forEach(div => {
      div.addEventListener('click', () => doGet(div));
    });
  }

  // === Get (insert match, no TM registration) ===
  async function doGet(el) {
    const target = el.getAttribute('data-target');
    el.classList.add('inserted');
    await writeToTarget(target);
  }

  function doGetTop() {
    const s = getShadow();
    if (!s) return;
    const first = s.querySelector('.match');
    if (first) doGet(first);
  }

  // === Set (register to TM) ===
  // Always reads source col + target col for the current row, regardless of which cell is selected.
  async function doSet() {
    const ref = getCellRef();
    const match = ref ? ref.match(/([A-Z]+)(\d+)/i) : null;
    if (!match) return;

    const rowNum = match[2];
    const sourceRef = (settings.sourceCol || 'A') + rowNum;
    const targetRef = (settings.targetCol || 'B') + rowNum;
    const ssId = getSpreadsheetId();
    if (!ssId) return;

    // Read both source and target from Sheets API
    const [srcResp, tgtResp] = await Promise.all([
      msg('SHEETS_API_READ_DIRECT', { spreadsheetId: ssId, range: sourceRef }),
      msg('SHEETS_API_READ_DIRECT', { spreadsheetId: ssId, range: targetRef }),
    ]);

    const source = srcResp && srcResp.value ? srcResp.value : '';
    const target = tgtResp && tgtResp.value ? tgtResp.value : '';

    if (!source) {
      showToast('Source cell (' + sourceRef + ') is empty');
      return;
    }

    if (!target) {
      showToast('Target cell is empty');
      return;
    }

    // Dedup and add
    const sCmp = FelixEngine.makeCmp(source);
    const tCmp = FelixEngine.makeCmp(target);
    let action = 'added';
    for (const e of tmData) {
      if ((e.cmp || FelixEngine.makeCmp(e.source)) === sCmp && FelixEngine.makeCmp(e.target) === tCmp) {
        e.refcount = (e.refcount || 0) + 1;
        action = 'refcount';
        break;
      }
    }
    if (action === 'added') tmData.push({ source, target, context: '', cmp: sCmp, refcount: 0 });

    await msg('TM_SAVE', tmData);
    updateBadge();
    showToast(action === 'refcount' ? 'Already exists (+1)' : 'Registered!');
  }

  // === Write to target cell via Sheets API ===
  async function writeToTarget(value) {
    const ref = getCellRef();
    const match = ref ? ref.match(/([A-Z]+)(\d+)/i) : null;
    if (!match) return;

    const sourceCol = match[1];
    const rowNum = parseInt(match[2]);
    const targetRef = (settings.targetCol || 'B') + rowNum;
    const nextRef = sourceCol + (rowNum + 1);
    const ssId = getSpreadsheetId();
    if (!ssId) return;

    // Write via background
    msg('SHEETS_API_WRITE', { spreadsheetId: ssId, range: targetRef, value });

    // Move to next row
    const nameBox = findNameBox();
    if (nameBox) {
      nameBox.focus();
      if (nameBox.select) nameBox.select();
      nameBox.value = nextRef;
      nameBox.dispatchEvent(new Event('input', { bubbles: true }));
      nameBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }
  }

  function showToast(text) {
    const s = getShadow();
    if (!s) return;
    const el = s.getElementById('toast-area');
    el.innerHTML = `<div class="toast">${esc(text)}</div>`;
    setTimeout(() => el.innerHTML = '', 3000);
  }

  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escA(s) { return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  // === Polling ===
  function checkForChanges() {
    if (!isValid()) { if (_pollTimer) clearInterval(_pollTimer); return; }
    if (!panelVisible) return;

    const value = getCellValue();
    const ref = getCellRef();

    if (value !== lastCellValue || ref !== lastCellRef) {
      lastCellValue = value;
      lastCellRef = ref;

      const s = getShadow();
      if (s) {
        s.getElementById('cell-value').textContent = value || '—';
        s.getElementById('cell-ref').textContent = ref ? `(${ref})` : '';
      }

      if (value) doSearch(value);
    }
  }

  _pollTimer = setInterval(checkForChanges, 200);

  // === Keyboard shortcuts ===
  function matchesShortcut(e, shortcut) {
    const parts = shortcut.toLowerCase().split('+').map(s => s.trim());
    const needCmd = parts.includes('cmd') || parts.includes('command') || parts.includes('meta');
    const needCtrl = parts.includes('ctrl') || parts.includes('control');
    const needShift = parts.includes('shift');
    const needAlt = parts.includes('alt') || parts.includes('option');
    const key = parts.filter(p => !['cmd','command','meta','ctrl','control','shift','alt','option'].includes(p))[0];
    if (needCmd && !e.metaKey) return false;
    if (needCtrl && !e.ctrlKey) return false;
    if (needShift && !e.shiftKey) return false;
    if (needAlt && !e.altKey) return false;
    if (key && e.key.toLowerCase() !== key) return false;
    return true;
  }

  document.addEventListener('keydown', (e) => {
    if (matchesShortcut(e, settings.shortcutGet || 'Cmd+Shift+J')) {
      e.preventDefault();
      doGetTop();
    }
    if (matchesShortcut(e, settings.shortcutSet || 'Cmd+Shift+U')) {
      e.preventDefault();
      doSet();
    }
  });

  // === Listen for messages from background/side panel ===
  chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
    if (m.type === 'PING') { sendResponse({ pong: true }); return; }
    if (m.type === 'TOGGLE_PANEL') { panelVisible ? (document.getElementById('felix-tm-panel').style.display = 'none', panelVisible = false) : showPanel(); sendResponse({ ok: true }); return; }
    if (m.type === 'GET_CELL') { sendResponse({ value: getCellValue(), ref: getCellRef() }); return; }
    if (m.type === 'GET_LOGS') { sendResponse({ logs: [] }); return; }
    if (m.type === 'SHORTCUTS_UPDATED') {
      if (m.get) settings.shortcutGet = m.get;
      if (m.set) settings.shortcutSet = m.set;
      updateShortcutLabel();
      return;
    }
    if (m.type === 'WRITE_CELL') {
      writeToTarget(m.value);
      sendResponse({ ok: true });
      return;
    }
    if (m.type === 'GET_TARGET_CELL') {
      const ref = getCellRef();
      const match = ref ? ref.match(/([A-Z]+)(\d+)/i) : null;
      if (match) {
        const targetRef = (m.targetCol || settings.targetCol || 'B') + match[2];
        const ssId = getSpreadsheetId();
        msg('SHEETS_API_READ_DIRECT', { spreadsheetId: ssId, range: targetRef }).then(r => {
          sendResponse({ value: r && r.value ? r.value : '', ref: targetRef });
        });
        return true;
      }
      sendResponse({ value: '', ref: '' });
    }
  });

  // === Background: toggle panel on icon click ===
  // Show panel on load
  setTimeout(() => {
    showPanel();
  }, 3000);

})();
