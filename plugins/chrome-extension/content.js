/**
 * Content Script — Felix TM Overlay Panel
 * Injects a floating, draggable TM panel directly into Google Sheets.
 * Mouse Dictionary-style: always on top, no separate window needed.
 *
 * Supports clean re-injection: on extension update, the old instance is
 * fully torn down (AbortController aborts all listeners, timer is cleared,
 * DOM is removed) before the new instance starts.
 */

(() => {
  // === Cleanup previous instance ===
  // When the extension is updated and this script is re-injected,
  // the previous IIFE's closures are still alive. We use a global
  // cleanup hook so the new instance can kill the old one.
  if (window.__felixTMCleanup) {
    try { window.__felixTMCleanup(); } catch (_) {}
  }

  // === AbortController for all document-level listeners ===
  const ac = new AbortController();
  const signal = ac.signal;

  // === State ===
  let tmData = [];
  let glossaryData = [];
  let rulesData = [];
  let settings = { sourceCol: 'A', targetCol: 'B', minScore: 0.7, lang: 'en',
                    shortcutGet: 'Cmd+Shift+J', shortcutSet: 'Cmd+Shift+U' };
  let lastCellValue = '';
  let lastCellRef = '';
  let panelVisible = false;
  let panelMode = 'translate'; // 'translate' | 'review'
  let concRegex = false;
  const _undoStack = []; // { ssId, range, oldValue, newValue }
  let _pollTimer = null;

  // Register cleanup for next re-injection
  window.__felixTMCleanup = () => {
    ac.abort();
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    const old = document.getElementById('felix-tm-panel');
    if (old) old.remove();
  };

  // === i18n ===
  const I18N = {
    en: {
      activeCell: 'Active Cell', selectCell: 'Select a cell to search TM',
      noMatch: 'No matches',
      used: 'used', registered: 'Registered!', alreadyExists: 'Already exists (+1)',
      srcEmpty: 'Source cell is empty', tgtEmpty: 'Target cell is empty',
      autoFuzzy: '↓ Fuzzy', autoRange: '↓ Range',
    },
    ja: {
      activeCell: 'アクティブセル', selectCell: 'セルを選択するとTM検索します',
      noMatch: 'マッチなし',
      used: '使用', registered: '登録しました', alreadyExists: '既に存在 (+1)',
      srcEmpty: '原文セルが空です', tgtEmpty: '訳文セルが空です',
      autoFuzzy: '↓ Fuzzy', autoRange: '↓ 範囲',
    },
  };
  function t(key) { return (I18N[settings.lang] && I18N[settings.lang][key]) || I18N.en[key] || key; }

  // === Extension validity check ===
  function isValid() { try { return !!chrome.runtime.id; } catch (_) { return false; } }
  function msg(type, data) {
    return new Promise(r => {
      try { chrome.runtime.sendMessage({ type, data }, resp => { void chrome.runtime.lastError; r(resp); }); }
      catch (_) { r(null); }
    });
  }

  // === Load data from storage ===
  let _dataReady = false;
  async function loadData() {
    const [tm, gloss, rules, sets] = await Promise.all([
      msg('TM_LOAD'), msg('GLOSSARY_LOAD'), msg('RULES_LOAD'), msg('SETTINGS_LOAD')
    ]);
    tmData = tm || [];
    glossaryData = gloss || [];
    rulesData = rules || [];
    settings = sets || settings;
    _dataReady = true;
    updateBadge();
    // Preload source column cache via Sheets API
    preloadSourceCache();
    // Run initial search immediately after data is ready
    const value = getCellValue();
    if (value) {
      lastCellValue = value;
      lastCellRef = getCellRef();
      const s = getShadow();
      if (s) {
        s.getElementById('cell-value').textContent = value;
        s.getElementById('cell-ref').textContent = lastCellRef ? `(${lastCellRef})` : '';
      }
      doSearch(value);
    }
  }

  async function preloadSourceCache() {
    const ssId = getSpreadsheetId();
    if (!ssId) return;
    const col = settings.sourceCol || 'A';
    const range = sheetRef(`${col}1:${col}1000`);
    const resp = await msg('SHEETS_API_READ_BATCH', { spreadsheetId: ssId, range });
    if (resp && resp.values) {
      for (let i = 0; i < resp.values.length; i++) {
        const val = resp.values[i];
        if (val) _sourceCache[String(i + 1)] = val;
      }
    }
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
    if (!bar) return '';
    // innerText preserves line breaks from <br> / <div> in the formula bar
    return (bar.innerText || bar.textContent || '').trim();
  }

  function getCellRef() {
    const box = findNameBox();
    return box ? (box.value || box.textContent || '').trim() : '';
  }

  function getSpreadsheetId() {
    const m = location.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function getActiveSheetName() {
    const tab = document.querySelector('.docs-sheet-tab.docs-sheet-active-tab .docs-sheet-tab-name');
    return tab ? tab.textContent.trim() : '';
  }

  /** Prepend active sheet name to a cell reference (e.g. "B5" → "くれさが!B5") */
  function sheetRef(ref) {
    const name = getActiveSheetName();
    if (!name || ref.includes('!')) return ref;
    return `'${name}'!${ref}`;
  }

  // === Create the overlay panel ===
  function createPanel() {

    const host = document.createElement('div');
    host.id = 'felix-tm-panel';
    const shadow = host.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      #panel {
        position: fixed; top: 80px; right: 20px; width: 360px; max-height: calc(100vh - 100px);
        background: #fff; border: 1px solid #dadce0; border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15); z-index: 999999;
        display: flex; flex-direction: column; overflow: hidden;
        font-size: 13px; color: #202124; resize: both;
        min-width: 200px; min-height: 100px;
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
      #body { padding: 10px 14px; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
      #results-wrap { flex: 1; overflow-y: auto; }
      .cell-preview { background: #f1f3f4; border-radius: 4px; padding: 6px 10px; font-size: 12px; line-height: 1.4; color: #3c4043; margin-bottom: 8px; min-height: calc(1.4em + 12px); flex-shrink: 0; word-break: break-all; }
      .cell-label { font-size: 10px; color: #9aa0a6; margin-bottom: 2px; }
      .row { display: flex; gap: 6px; margin-bottom: 8px; }
      .row > * { flex: 1; }
      select { width: 100%; padding: 6px; border: 1px solid #dadce0; border-radius: 4px; font-size: 12px; }
      .match { background: #f8f9fa; border: 1px solid #e8eaed; border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer; transition: all 0.1s; position: relative; }
      .match:hover { border-color: #1a73e8; }
      .match.inserted { border-color: #34a853; opacity: 0.6; }
      .match.hover-left { cursor: pointer; border-color: #1a73e8 !important; }
      .match.hover-right { cursor: text; border-color: #f9ab00 !important; }
      .score { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 10px; font-weight: 600; color: #fff; }
      .score-high { background: #fff; color: #202124; border: 1px solid #34a853; }
      .score-mid { background: #fff; color: #202124; border: 1px solid #f9ab00; }
      .score-low { background: #fff; color: #202124; border: 1px solid #ea4335; }
      .match-source { color: #5f6368; font-size: 11px; margin-top: 3px; word-break: break-all; }
      .diff-missing { margin-left: 4px; }
      .match-target { color: #202124; font-size: 12px; margin-top: 2px; word-break: break-all; }
      .match-meta { color: #9aa0a6; font-size: 10px; margin-top: 3px; }
      .empty { text-align: center; color: #9aa0a6; padding: 16px 8px; font-size: 12px; }
      .action-bar { display: flex; gap: 6px; align-items: center; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #e8eaed; flex-shrink: 0; }
      .btn { padding: 6px 12px; border-radius: 4px; border: 1px solid #dadce0; cursor: pointer; font-size: 11px; font-weight: 500; background: #fff; color: #1a73e8; }
      .btn:hover { background: #f1f3f4; }
      .toast { padding: 6px 10px; border-radius: 4px; font-size: 11px; margin-top: 6px; background: #e6f4ea; color: #137333; white-space: pre-line; line-height: 1.4; }
      .diff-match { color: #137333; }
      .diff-sub { background: #fce8e6; color: #c5221f; }
      .diff-del { background: #fce8e6; color: #c5221f; }
      .diff-ins { background: #fce8e6; color: #c5221f; }
      .shortcut { font-size: 10px; color: #9aa0a6; }
      .gloss_match { text-decoration: underline; text-decoration-color: #1a73e8; text-underline-offset: 2px; cursor: pointer; position: relative; }
      .gloss_match::after { content: attr(data-tip); display: none; position: absolute; bottom: 100%; left: 0; background: #fff; border: 1px solid #dadce0; border-radius: 4px; padding: 2px 6px; font-size: 10px; color: #202124; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.12); z-index: 10; pointer-events: none; }
      .gloss_match:hover::after { display: block; }
      .gloss-copied { background: #e6f4ea; transition: background 0.3s; }
      .match-placed { border-color: #34a853; }
      .match-placed:hover { border-color: #137333; }
      .placed-badge { display: inline-block; background: #fff; color: #34a853; border: 1px solid #34a853; font-size: 9px; font-weight: 600; padding: 1px 4px; border-radius: 3px; margin-left: 4px; vertical-align: middle; }
      .placed-original { font-size: 10px; color: #9aa0a6; margin-top: 2px; }
      .placed-del { text-decoration: line-through; color: #c5221f; }
      .placed-ins { background: #e8f0fe; color: #1a73e8; border-radius: 2px; padding: 0 1px; }
      .placed-manual { background: #fce8e6; color: #c5221f; font-weight: 500; position: relative; cursor: help; }
      .placed-manual::after { content: attr(data-tip); display: none; position: absolute; bottom: 100%; left: 0; background: #fff; border: 1px solid #dadce0; border-radius: 4px; padding: 2px 6px; font-size: 10px; color: #202124; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.12); z-index: 10; pointer-events: none; }
      .placed-manual:hover::after { display: block; }
      .btn-del-tm:hover { color: #ea4335 !important; }
      .settings-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
      .mode-toggle { display: flex; border: 1px solid #dadce0; border-radius: 4px; }
      .mode-btn { padding: 3px 8px; font-size: 10px; cursor: pointer; color: #5f6368; user-select: none; }
      .mode-btn:first-child { border-radius: 3px 0 0 3px; }
      .mode-btn:last-child  { border-radius: 0 3px 3px 0; }
      .mode-btn.mode-active { background: #1a73e8; color: #fff; }
      .conc-row { display: flex; gap: 4px; margin-bottom: 6px; }
      .conc-input { flex: 1; padding: 4px 6px; border: 1px solid #dadce0; border-radius: 4px; font-size: 11px; }
      .conc-input:focus { outline: none; border-color: #1a73e8; }
      .conc-highlight { background: #fef7cd; border-radius: 2px; padding: 0 1px; }
      .regex-toggle { padding: 3px 6px; border: 1px solid #dadce0; border-radius: 4px; font-size: 11px; font-family: monospace; cursor: pointer; color: #9aa0a6; user-select: none; }
      .regex-toggle.active { background: #1a73e8; color: #fff; border-color: #1a73e8; }
      .auto-label { font-size: 10px; color: #5f6368; margin: 0 2px 0 4px; white-space: nowrap; }
      /* Tooltip via CSS Anchor Positioning (Chrome 125+).
         anchor-scope: --felix-tip confines each element's anchor to its own
         subtree so the ::after pseudo-element anchors to its own parent,
         not to the first .has-tip in DOM order. Two classes pick the
         preferred side:
           .has-tip          → prefers ABOVE  (mid / bottom controls)
           .has-tip-below    → prefers BELOW  (header controls)
         position: fixed keeps the tooltip out of #panel's overflow:hidden.
         position-try-fallbacks flips sides if the preferred side overflows
         the viewport. */
      .has-tip, .has-tip-below {
        anchor-name: --felix-tip;
        anchor-scope: --felix-tip;
      }
      .has-tip::after, .has-tip-below::after {
        content: attr(data-tip); display: none; position: fixed;
        position-anchor: --felix-tip;
        background: #fff; border: 1px solid #dadce0; border-radius: 4px;
        padding: 6px 8px; font-size: 10px; color: #202124;
        white-space: normal; width: max-content; max-width: 220px;
        text-align: left; line-height: 1.45;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 1000000;
        pointer-events: none;
        position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline;
      }
      .has-tip::after {
        position-area: block-start span-inline-end;   /* above, aligned left edge */
        margin-bottom: 4px;
      }
      .has-tip-below::after {
        position-area: block-end span-inline-start;   /* below, aligned right edge */
        margin-top: 4px;
      }
      .has-tip:hover::after, .has-tip-below:hover::after { display: block; }
      /* Wrapper for form controls (select / input) — ::after doesn't render
         on replaced elements, so we put the tooltip on a surrounding span. */
      .tip-wrap { display: inline-flex; }
      .tip-wrap > select, .tip-wrap > input { width: 100%; }
    </style>
    <div id="panel">
      <div id="header">
        <h1>Felix TM</h1>
        <span>
          <span class="badge" id="badge">TM: 0</span>
          <button class="btn-close has-tip-below" id="btn-manage" data-tip="サイドパネル（TM・用語集・ルール管理）">⚙</button>
          <button class="btn-close" id="btn-min" aria-label="Minimize">−</button>
          <button class="btn-close" id="btn-close" aria-label="Close">✕</button>
        </span>
      </div>
      <div id="body">
        <div class="action-bar">
          <button class="btn has-tip-below" id="btn-undo" data-tip="元に戻す（Auto Translate の一括挿入も 1 回で復元）" style="padding:6px 8px;color:#5f6368">↩</button>
          <span class="auto-label" id="lbl-auto">Auto:</span>
          <button class="btn has-tip-below" id="btn-auto-fuzzy" data-tip="現在行から下方向へ連続翻訳。完全一致＋数値／用語集で埋められる行まで続行、埋められない差分が出たら停止／既存訳文は上書き">↓ Fuzzy</button>
          <button class="btn has-tip-below" id="btn-auto-range" data-tip="選択範囲の空セルだけ翻訳（完全一致のみ）／既存訳文は上書きしない">↓ 範囲</button>
          <span style="flex:1"></span>
          <button class="btn has-tip-below" id="btn-set" data-tip="現在行の原文＋訳文を TM に登録（⌘⇧U）">Set</button>
        </div>
        <div class="cell-label"><span id="lbl-cell">Active Cell</span> <span id="cell-ref"></span></div>
        <div class="cell-preview" id="cell-value">—</div>
        <div class="settings-row">
          <div class="mode-toggle" id="mode-toggle">
            <span class="mode-btn mode-active has-tip" data-mode="translate" id="mode-translate" data-tip="原文を見て訳文候補を探す">Translate</span>
            <span class="mode-btn has-tip" data-mode="review" id="mode-review" data-tip="訳文を見て原文候補を探す（逆引き・チェック用）">Review</span>
          </div>
          <span class="tip-wrap has-tip" data-tip="候補を出す最低マッチ率" style="width:60px"><select id="min-score" style="padding:4px;font-size:11px">
            <option value="0.5">50%</option><option value="0.6">60%</option>
            <option value="0.7" selected>70%</option><option value="0.8">80%</option>
            <option value="0.9">90%</option>
          </select></span>
        </div>
        <div class="conc-row">
          <span class="tip-wrap has-tip" data-tip="TM 内を文字列検索（部分一致）" style="flex:1"><input class="conc-input" id="conc-query" placeholder="Concordance"></span>
          <span class="regex-toggle has-tip" id="btn-regex" data-tip="正規表現モードに切り替え">.*</span>
        </div>
        <div id="results-wrap"><div id="results"><div class="empty" id="lbl-empty">Select a cell to search TM</div></div></div>
        <div id="toast-area"></div>
      </div>
    </div>`;

    document.body.appendChild(host);

    const panel = shadow.getElementById('panel');
    const header = shadow.getElementById('header');

    // Dragging — listeners use AbortController signal
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
    }, { signal });
    document.addEventListener('mouseup', () => {
      isDragging = false;
    }, { signal });

    // Keep the panel inside the viewport when it shrinks — e.g. when the
    // Chrome side panel opens or the window is resized. Without this, a
    // panel that was dragged near the right edge can end up off-screen.
    function clampPanelToViewport() {
      const rect = panel.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;
      const margin = 8;
      // Horizontal
      if (rect.right > vw - margin) {
        panel.style.left = Math.max(margin, vw - pw - margin) + 'px';
        panel.style.right = 'auto';
      } else if (rect.left < margin) {
        panel.style.left = margin + 'px';
        panel.style.right = 'auto';
      }
      // Vertical (allow title bar to stay grabable)
      const headerH = header.offsetHeight || 36;
      if (rect.top > vh - headerH - margin) {
        panel.style.top = Math.max(margin, vh - ph - margin) + 'px';
      } else if (rect.top < margin) {
        panel.style.top = margin + 'px';
      }
    }
    window.addEventListener('resize', clampPanelToViewport, { signal });

    // Close / Minimize
    shadow.getElementById('btn-close').addEventListener('click', () => { host.style.display = 'none'; panelVisible = false; });
    shadow.getElementById('btn-min').addEventListener('click', () => {
      const body = shadow.getElementById('body');
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    // Score change — save to settings
    shadow.getElementById('min-score').addEventListener('change', () => {
      settings.minScore = parseFloat(shadow.getElementById('min-score').value);
      msg('SETTINGS_SAVE', settings);
      doSearch();
    });

    // Manage button — open Chrome side panel
    shadow.getElementById('btn-manage').addEventListener('click', () => {
      msg('OPEN_SIDE_PANEL');
    });

    // Undo button (Set action moved to side panel; keyboard shortcut still works)
    shadow.getElementById('btn-undo').addEventListener('click', () => undoLastWrite());

    // Auto-translate buttons
    shadow.getElementById('btn-auto-fuzzy').addEventListener('click', () => autoTranslateToFuzzy());
    shadow.getElementById('btn-auto-range').addEventListener('click', () => autoTranslateSelection());

    // Set (register current row to TM)
    shadow.getElementById('btn-set').addEventListener('click', () => doSet());

    // Mode toggle (Translate ↔ Review)
    shadow.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panelMode = btn.dataset.mode;
        shadow.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('mode-active'));
        btn.classList.add('mode-active');
        doSearch();
      });
    });

    // Regex toggle
    shadow.getElementById('btn-regex').addEventListener('click', (e) => {
      concRegex = !concRegex;
      e.target.classList.toggle('active', concRegex);
    });

    // Concordance search — live as you type
    const concInput = shadow.getElementById('conc-query');
    let _concTimer = null;
    concInput.addEventListener('input', () => {
      clearTimeout(_concTimer);
      _concTimer = setTimeout(() => doConcordance(), 150);
    });
    concInput.addEventListener('keydown', (e) => e.stopPropagation());
    concInput.addEventListener('paste', (e) => e.stopPropagation());
    concInput.addEventListener('copy', (e) => e.stopPropagation());
    concInput.addEventListener('cut', (e) => e.stopPropagation());

    // Store shadow ref for updates
    host._shadow = shadow;

    updateShortcutLabel();
    applyPanelLang();
    return shadow;
  }

  function applyPanelLang() {
    const s = getShadow();
    if (!s) return;
    const set = (id, text) => { const el = s.getElementById(id); if (el) el.textContent = text; };
    set('lbl-cell', t('activeCell'));
    set('lbl-empty', t('selectCell'));
    set('btn-auto-fuzzy', t('autoFuzzy'));
    set('btn-auto-range', t('autoRange'));
  }

  function getShadow() {
    const host = document.getElementById('felix-tm-panel');
    return host ? host._shadow : null;
  }

  function showPanel() {
    // Always remove old panel and create fresh (handles extension reload)
    const old = document.getElementById('felix-tm-panel');
    if (old) old.remove();
    createPanel();
    panelVisible = true;
    loadData();
  }

  function updateBadge() {
    const s = getShadow();
    if (s) {
      const parts = [`TM: ${tmData.length}`];
      if (glossaryData.length) parts.push(`Gloss: ${glossaryData.length}`);
      s.getElementById('badge').textContent = parts.join(' | ');
    }
  }

  /** Shortcut legend used to be shown at the bottom of the panel but has
   *  been removed; keep this as a no-op so existing call sites don't need
   *  branching while we decide whether / how to resurface the hints. */
  function updateShortcutLabel() {}

  // === Search ===
  // Auto-detects forward vs reverse based on which column is selected
  function isTargetColumn() {
    const ref = getCellRef();
    const match = ref ? ref.match(/([A-Z]+)/i) : null;
    if (!match) return false;
    return match[1].toUpperCase() === (settings.targetCol || 'B').toUpperCase();
  }

  // Cache: source value per row (populated when user is on source column)
  let _sourceCache = {}; // { rowNum: value }

  // Show placed target with changed parts in green
  // Find number token positions that differ between original and placed text
  function findNumDiffRegions(original, placed) {
    const numRe = /(?:\d+(?:[.,]\d+)*|[０-９]+(?:[．，][０-９]+)*)/g;
    function extract(t) { const r = []; let m; while ((m = numRe.exec(t)) !== null) r.push({ val: m[0], idx: m.index, len: m[0].length }); return r; }
    const oNums = extract(original);
    const pNums = extract(placed);
    const oDiffs = [], pDiffs = []; // { idx, len } regions that changed
    const len = Math.min(oNums.length, pNums.length);
    for (let i = 0; i < len; i++) {
      if (oNums[i].val !== pNums[i].val) {
        oDiffs.push({ idx: oNums[i].idx, len: oNums[i].len });
        pDiffs.push({ idx: pNums[i].idx, len: pNums[i].len });
      }
    }
    return { oDiffs, pDiffs };
  }

  function markRegions(text, regions, cls) {
    if (!regions.length) return esc(text);
    let html = '', cursor = 0;
    for (const r of regions) {
      html += esc(text.substring(cursor, r.idx));
      html += `<span class="${cls}">${esc(text.substring(r.idx, r.idx + r.len))}</span>`;
      cursor = r.idx + r.len;
    }
    html += esc(text.substring(cursor));
    return html;
  }

  function placedHighlightHtml(original, placed, manualDiffs) {
    const { pDiffs } = findNumDiffRegions(original, placed);
    let html = markRegions(placed, pDiffs, 'placed-ins');
    // Mark non-numeric diffs that still need manual fixing
    if (manualDiffs && manualDiffs.length) {
      for (const d of manualDiffs) {
        const sEsc = esc(d.sText);
        const qEsc = esc(d.qText);
        if (sEsc && html.includes(sEsc)) {
          html = html.replace(sEsc, `<span class="placed-manual" data-tip="→ ${qEsc}">${sEsc}</span>`);
        }
      }
    }
    return html;
  }

  function placedDiffHtml(original, placed) {
    const { oDiffs } = findNumDiffRegions(original, placed);
    return markRegions(original, oDiffs, 'placed-del');
  }

  function doSearch(query) {
    const s = getShadow();
    if (!s || !panelVisible) return;
    if (!query) query = lastCellValue;
    if (!query) return;

    const onTarget = isTargetColumn();
    const minScore = parseFloat(s.getElementById('min-score').value);

    let searchQuery = query;
    let isReverse = false;

    if (panelMode === 'review') {
      // Review mode: reverse search using target cell value
      if (onTarget) {
        // On target column — use this cell's value directly
        searchQuery = query;
      } else {
        // On source column — read the target cell from cache or API
        const ref = getCellRef();
        const rowMatch = ref ? ref.match(/(\d+)/i) : null;
        const rowNum = rowMatch ? rowMatch[1] : null;
        const tgtCol = settings.targetCol || 'B';
        const cachedTarget = rowNum ? _sourceCache[`${tgtCol}${rowNum}`] : null;
        if (cachedTarget) {
          searchQuery = cachedTarget;
        } else {
          // No cached target — just reverse search with source text as fallback
          searchQuery = query;
        }
      }
      isReverse = true;
    } else {
      // Translate mode: forward search
      if (onTarget) {
        const ref = getCellRef();
        const rowMatch = ref ? ref.match(/(\d+)/i) : null;
        const rowNum = rowMatch ? rowMatch[1] : null;
        const cachedSource = rowNum ? _sourceCache[rowNum] : null;
        if (cachedSource) {
          searchQuery = cachedSource;
        } else {
          isReverse = true;
        }
      }
    }

    const t0 = performance.now();
    const matches = isReverse
      ? FelixEngine.reverseSearch(searchQuery, tmData, minScore)
      : FelixEngine.search(searchQuery, tmData, minScore);
    const ms = (performance.now() - t0).toFixed(1);

    // Glossary hits for the query (used for highlighting and placement)
    // Filter: only keep hits whose term is findable in the original text (not just in makeCmp)
    const glossHitsRaw = glossaryData.length ? FelixEngine.glossarySearch(searchQuery, glossaryData) : [];
    const qLower = searchQuery.toLowerCase();
    const glossHits = glossHitsRaw.filter(g => qLower.includes(g.term.toLowerCase()));

    // Highlight glossary terms in the cell preview (Felix: GLOSS_MATCH on QUERY side)
    const cellPreview = s.getElementById('cell-value');
    if (glossHits.length && searchQuery) {
      const marked = FelixEngine.markGlossaryInSource(searchQuery, glossHits);
      if (marked) cellPreview.innerHTML = marked;
    }

    const el = s.getElementById('results');
    const label = panelMode === 'review' ? '↔ Review' : (onTarget ? (isReverse ? '↔ Reverse' : '← Source') : '');
    // Check if any match is 100% — if so, skip Placement entirely
    const has100 = !isReverse && matches.some(m => Math.round(m.score * 100) === 100);

    if (!matches.length) {
      el.innerHTML = `<div class="empty">${t('noMatch')} ${label} (${ms}ms)</div>`;
    } else {
      el.innerHTML = (label ? `<div style="font-size:10px;color:#1a73e8;margin-bottom:4px">${label}</div>` : '') +
      matches.map((m, i) => {
        const pct = Math.round(m.score * 100);
        const cls = pct >= 90 ? 'score-high' : pct >= 70 ? 'score-mid' : 'score-low';
        const meta = m.refcount ? `${t('used')} ${m.refcount}x` : '';
        const tmIdx = tmData.indexOf(m) !== -1 ? tmData.indexOf(m) : tmData.findIndex(e => e.source === m.source && e.target === m.target);

        let srcHtml, tgtDisplay, insertTarget, placed = false, insertHighlights = null;
        if (isReverse) {
          const diff = pct < 100 ? FelixEngine.diffHighlight(query, m.target) : null;
          srcHtml = diff ? diff.sourceHtml : esc(m.target);
          tgtDisplay = esc(m.source);
          insertTarget = m.source;
        } else {
          if (pct === 100) {
            srcHtml = esc(m.source);
          } else {
            const diff = FelixEngine.diffHighlight(searchQuery, m.source, glossHits);
            srcHtml = diff ? diff.queryHtml : esc(m.source);
          }

          insertTarget = m.target;
          tgtDisplay = esc(m.target);
          // Placement: only on the top result, and only if no 100% match.
          // Uses the same per-diff resolver as Auto Translate so what's
          // shown in the match panel matches exactly what would be written
          // if the user clicks the match (or runs ↓ Fuzzy on this row).
          if (!has100 && i === 0 && pct < 100) {
            const resolved = FelixEngine.resolveWithPlacement(
              searchQuery, m.source, m.target, glossaryData, rulesData);
            const placedTarget = resolved.target;
            const badges = resolved.placements;

            if (badges.length) {
              placed = true;
              insertTarget = placedTarget;
              const manualDiffs = FelixEngine.nonNumericDiffs(searchQuery, m.source);
              // Build cell formatting highlights for manual-fix parts
              if (manualDiffs.length) {
                const seen = new Set();
                const hl = [];
                for (const d of manualDiffs) {
                  if (!d.sText) continue;
                  const idx = insertTarget.indexOf(d.sText);
                  if (idx < 0) continue;
                  const key = idx + ':' + d.sText.length;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  hl.push({ start: idx, end: idx + d.sText.length });
                }
                if (hl.length) insertHighlights = hl;
              }
              tgtDisplay = placedHighlightHtml(m.target, placedTarget, manualDiffs) + `<span class="placed-badge">${badges.join('+')}置換</span>`;
            }
          }
        }

        return `<div class="match${placed ? ' match-placed' : ''}" data-idx="${i}" data-target="${escA(insertTarget)}" data-highlights="${insertHighlights ? escA(JSON.stringify(insertHighlights)) : ''}" data-tm-idx="${tmIdx}">
          <span class="score ${cls}">${pct}%</span>
          <span style="float:right;display:flex;align-items:center;gap:4px">
            ${i === 0 ? `<span style="font-size:10px;color:#9aa0a6">${ms}ms</span>` : ''}
            <span class="btn-del-tm" data-del-idx="${tmIdx}" title="Delete from TM" style="font-size:11px;color:#dadce0;cursor:pointer">✕</span>
          </span>
          <div class="match-source">${srcHtml}</div>
          <div class="match-target">${tgtDisplay}</div>
          ${placed ? `<div class="placed-original">${placedDiffHtml(m.target, insertTarget)}</div>` : ''}
          ${meta ? `<div class="match-meta">${meta}</div>` : ''}
        </div>`;
      }).join('');

      // Click: left half → next row, right half → edit target
      el.querySelectorAll('.match').forEach(div => {
        div.addEventListener('mousemove', (e) => {
          const rect = div.getBoundingClientRect();
          const isRight = (e.clientX - rect.left) > rect.width / 2;
          div.classList.toggle('hover-left', !isRight);
          div.classList.toggle('hover-right', isRight);
        });
        div.addEventListener('mouseleave', () => {
          div.classList.remove('hover-left', 'hover-right');
        });
        div.addEventListener('click', (e) => {
          if (e.target.classList.contains('btn-del-tm')) return;
          const rect = div.getBoundingClientRect();
          const isRight = (e.clientX - rect.left) > rect.width / 2;
          div.classList.add('inserted');
          doGet(div, isRight);
        });
      });

      // Delete button
      el.querySelectorAll('.btn-del-tm').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.getAttribute('data-del-idx'));
          if (idx >= 0 && idx < tmData.length) {
            tmData.splice(idx, 1);
            await msg('TM_SAVE', tmData);
            updateBadge();
            doSearch();
          }
        });
      });
    }

    // Glossary term click → copy translation to clipboard
    el.querySelectorAll('.gloss_match').forEach(span => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = span.getAttribute('data-tip');
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          span.classList.add('gloss-copied');
          showToast(`Copied: ${text}`);
          setTimeout(() => span.classList.remove('gloss-copied'), 500);
        }).catch(() => {});
      });
    });

    // Manual-fix term click → copy correct value
    el.querySelectorAll('.placed-manual').forEach(span => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = (span.getAttribute('data-tip') || '').replace(/^→\s*/, '');
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          showToast(`Copied: ${text}`);
        }).catch(() => {});
      });
    });

  }

  // === Concordance Search ===
  function doConcordance() {
    const s = getShadow();
    if (!s) return;
    const input = s.getElementById('conc-query');
    const query = input.value.trim();
    if (!query) { doSearch(); return; }

    // Validate regex if enabled
    if (concRegex) {
      try { new RegExp(query, 'i'); } catch (_) {
        s.getElementById('results').innerHTML = `<div class="empty">Invalid regex</div>`;
        return;
      }
    }

    const t0 = performance.now();
    const hits = FelixEngine.concordanceSearch(query, tmData, 50, concRegex);
    const ms = (performance.now() - t0).toFixed(1);

    const el = s.getElementById('results');
    if (!hits.length) {
      el.innerHTML = `<div class="empty">No concordance results (${ms}ms)</div>`;
      return;
    }

    const re = concRegex ? new RegExp(query, 'gi') : null;
    const qLower = concRegex ? null : query.toLowerCase();
    function highlightTerm(text) {
      if (re) {
        let result = '', lastIdx = 0;
        for (const m of text.matchAll(re)) {
          result += esc(text.substring(lastIdx, m.index));
          result += `<span class="conc-highlight">${esc(m[0])}</span>`;
          lastIdx = m.index + m[0].length;
        }
        result += esc(text.substring(lastIdx));
        return result;
      }
      const lower = text.toLowerCase();
      let result = '', cursor = 0;
      let pos;
      while ((pos = lower.indexOf(qLower, cursor)) !== -1) {
        result += esc(text.substring(cursor, pos));
        result += `<span class="conc-highlight">${esc(text.substring(pos, pos + query.length))}</span>`;
        cursor = pos + query.length;
      }
      result += esc(text.substring(cursor));
      return result;
    }

    el.innerHTML = `<div style="font-size:10px;color:#1a73e8;margin-bottom:4px">Concordance: ${hits.length} hits (${ms}ms)</div>` +
      hits.map((h, i) => {
        const tmIdx = tmData.findIndex(e => e.source === h.source && e.target === h.target);
        return `<div class="match" data-idx="${i}" data-target="${escA(h.target)}" data-tm-idx="${tmIdx}">
          <div class="match-source">${highlightTerm(h.source)}</div>
          <div class="match-target">${highlightTerm(h.target)}</div>
        </div>`;
      }).join('');

    // Click on concordance result → insert target
    el.querySelectorAll('.match').forEach(div => {
      div.addEventListener('click', () => {
        const target = div.getAttribute('data-target');
        writeToTarget(target, false);
      });
    });
  }



  // === Get (insert match, no TM registration) ===
  async function doGet(el, editMode) {
    const target = el.getAttribute('data-target');
    const hlAttr = el.getAttribute('data-highlights');
    const highlights = hlAttr ? JSON.parse(hlAttr) : null;
    await writeToTarget(target, editMode, highlights);
  }

  function doGetTop() {
    const s = getShadow();
    if (!s) return;
    const first = s.querySelector('.match');
    if (first) {
      first.classList.add('inserted');
      doGet(first, false);
    }
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
      msg('SHEETS_API_READ_DIRECT', { spreadsheetId: ssId, range: sheetRef(sourceRef) }),
      msg('SHEETS_API_READ_DIRECT', { spreadsheetId: ssId, range: sheetRef(targetRef) }),
    ]);

    const source = srcResp && srcResp.value ? srcResp.value : '';
    const target = tgtResp && tgtResp.value ? tgtResp.value : '';

    if (!source) {
      showToast(t('srcEmpty') + ' (' + sourceRef + ')');
      return;
    }

    if (!target) {
      showToast(t('tgtEmpty'));
      return;
    }

    // Dedup and add
    const action = FelixEngine.addEntry(tmData, source, target);

    await msg('TM_SAVE', tmData);
    updateBadge();
    showToast(action === 'refcount' ? t('alreadyExists') : t('registered'));
  }

  // === Write to target cell via Sheets API ===
  async function writeToTarget(value, editMode, highlights) {
    const ref = getCellRef();
    const match = ref ? ref.match(/([A-Z]+)(\d+)/i) : null;
    if (!match) return;

    const rowNum = parseInt(match[2]);
    const targetRef = (settings.targetCol || 'B') + rowNum;
    const ssId = getSpreadsheetId();
    if (!ssId) return;

    // Read old value for undo
    const fullRange = sheetRef(targetRef);
    const oldResp = await msg('SHEETS_API_READ_DIRECT', { spreadsheetId: ssId, range: fullRange });
    const oldValue = oldResp && oldResp.value ? oldResp.value : '';
    _undoStack.push({ ssId, range: fullRange, oldValue, newValue: value });

    // Write via background (with formatting if highlights exist)
    if (highlights && highlights.length) {
      await msg('SHEETS_API_WRITE_FORMATTED', { spreadsheetId: ssId, range: fullRange, value, highlights });
    } else {
      await msg('SHEETS_API_WRITE', { spreadsheetId: ssId, range: fullRange, value });
    }

    const nameBox = findNameBox();
    if (!nameBox) return;

    if (editMode) {
      // Navigate to target cell
      nameBox.focus();
      if (nameBox.select) nameBox.select();
      nameBox.value = targetRef;
      nameBox.dispatchEvent(new Event('input', { bubbles: true }));
      nameBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    } else {
      // Move to next row's source cell
      const nextRef = (settings.sourceCol || 'A') + (rowNum + 1);
      nameBox.focus();
      if (nameBox.select) nameBox.select();
      nameBox.value = nextRef;
      nameBox.dispatchEvent(new Event('input', { bubbles: true }));
      nameBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }
  }

  async function undoLastWrite() {
    const entry = _undoStack.pop();
    if (!entry) { showToast('Nothing to undo'); return { reason: 'empty_stack' }; }
    if (entry.batch && entry.batch.length) {
      const updates = entry.batch.map(b => ({ range: b.range, value: b.oldValue }));
      await msg('SHEETS_API_BATCH_WRITE', { spreadsheetId: entry.ssId, updates });
      showToast(`Undo: ${entry.batch.length} cells`);
      return { kind: 'batch', restored: entry.batch.length, firstRange: entry.batch[0].range };
    }
    await msg('SHEETS_API_WRITE', { spreadsheetId: entry.ssId, range: entry.range, value: entry.oldValue });
    showToast(`Undo: ${entry.range}`);
    return { kind: 'single', range: entry.range };
  }

  // === Auto Translate ===
  // Faithful to Felix's "Translate to Fuzzy" / "Auto Translate Selection":
  // only strict 100% TM matches are written. Placement (glossary/number/rule)
  // is deliberately NOT applied — we want zero-surprise auto-fills. All writes
  // from one invocation share a single undo entry so the user can undo the
  // whole run in one step.
  //
  // The decision logic lives in FelixEngine.planAutoTranslate* (pure, unit
  // tested). These wrappers handle I/O: read the source/target columns from
  // Sheets, call the planner, batch-write the results, move the cursor, and
  // push a single undo entry.

  /** Translate from the current row downward; stop at first fuzzy. */
  async function autoTranslateToFuzzy() {
    if (!tmData.length) { showToast('No TM loaded'); return; }
    const ref = getCellRef();
    if (!ref) { showToast('Select a cell first'); return; }

    // Accept a concrete cell (A2, A2:A5), a column-only ref (A:A, A2:A), or
    // even a rectangular selection — we always walk down from the anchor row
    // in settings.sourceCol. If no row is given (whole-column select), start
    // from row 1.
    const m = ref.match(/^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/i);
    if (!m) { showToast(`Unsupported selection: ${ref}`); return; }
    const startRow = m[2] ? parseInt(m[2]) : 1;
    const srcCol = settings.sourceCol || 'A';
    const tgtCol = settings.targetCol || 'B';
    const ssId = getSpreadsheetId();
    if (!ssId) return;

    const BATCH = 500;
    const srcRange = sheetRef(`${srcCol}${startRow}:${srcCol}${startRow + BATCH - 1}`);
    const tgtRange = sheetRef(`${tgtCol}${startRow}:${tgtCol}${startRow + BATCH - 1}`);
    showToast('Reading sheet…');
    const [srcResp, tgtResp] = await Promise.all([
      msg('SHEETS_API_READ_BATCH', { spreadsheetId: ssId, range: srcRange }),
      msg('SHEETS_API_READ_BATCH', { spreadsheetId: ssId, range: tgtRange }),
    ]);
    const srcValues = (srcResp && srcResp.values) || [];
    const tgtValues = (tgtResp && tgtResp.values) || [];

    const plan = FelixEngine.planAutoTranslateToFuzzy({
      startRow, srcValues, tgtValues, tmData,
      glossaryData, rulesData,
      // minScore defaults to 0.7 inside the planner so placement can try
      // covering non-100% matches. Exact matches still fast-path.
    });

    await executePlan(plan, { ssId, startRow, srcCol, tgtCol });
  }

  /**
   * Auto-translate the currently selected range. Writes 100% matches only,
   * and skips rows whose target cell is already non-empty so prior work is
   * preserved.
   */
  async function autoTranslateSelection() {
    if (!tmData.length) { showToast('No TM loaded'); return; }
    const ref = getCellRef();
    if (!ref) { showToast('Select a range first'); return; }

    // Accept both row-qualified refs (A2, A2:A5, A2:B5) and column-only refs
    // (A:A, A:B, A2:A — row missing on one side). For column-only selections
    // we read an unbounded range and let the actual data length decide endRow.
    const m = ref.match(/^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/i);
    if (!m) { showToast(`Unsupported selection: ${ref}`); return; }
    const startRow = m[2] ? parseInt(m[2]) : 1;
    const explicitEndRow = m[4] ? parseInt(m[4]) : null;
    if (explicitEndRow != null && explicitEndRow < startRow) { showToast('Empty range'); return; }

    const srcCol = settings.sourceCol || 'A';
    const tgtCol = settings.targetCol || 'B';
    const ssId = getSpreadsheetId();
    if (!ssId) return;

    // Unbounded range like "A2:A" is valid Sheets syntax — the API returns
    // rows up to the last populated one.
    const srcRange = sheetRef(explicitEndRow
      ? `${srcCol}${startRow}:${srcCol}${explicitEndRow}`
      : `${srcCol}${startRow}:${srcCol}`);
    const tgtRange = sheetRef(explicitEndRow
      ? `${tgtCol}${startRow}:${tgtCol}${explicitEndRow}`
      : `${tgtCol}${startRow}:${tgtCol}`);
    showToast('Reading sheet…');
    const [srcResp, tgtResp] = await Promise.all([
      msg('SHEETS_API_READ_BATCH', { spreadsheetId: ssId, range: srcRange }),
      msg('SHEETS_API_READ_BATCH', { spreadsheetId: ssId, range: tgtRange }),
    ]);
    const srcValues = (srcResp && srcResp.values) || [];
    const tgtValues = (tgtResp && tgtResp.values) || [];

    const endRow = explicitEndRow != null
      ? explicitEndRow
      : startRow + Math.max(srcValues.length, 1) - 1;

    const plan = FelixEngine.planAutoTranslateSelection({
      startRow, endRow, srcValues, tgtValues, tmData,
      glossaryData, rulesData,
      // minScore defaults to 0.7 for placement coverage; exact 100% fast-paths.
    });

    await executePlan(plan, { ssId, startRow, srcCol, tgtCol });
  }

  /**
   * Take a plan produced by a FelixEngine planner and execute the IO side
   * of Auto Translate: write the cells, push an undo entry, move the
   * cursor, and surface the human report. All pure helpers live in
   * felix-engine.js and are covered by Node tests; this function is the
   * thin glue that wires them to chrome.runtime + the Sheets API.
   */
  async function executePlan(plan, { ssId, startRow, srcCol, tgtCol }) {
    const sheetName = getActiveSheetName();
    const { updates, undoEntries, landingRow } =
      FelixEngine.buildPlanActions(plan, { tgtCol, sheetName, startRow });

    if (updates.length) {
      showToast(`Writing ${updates.length} cells…`);
      const resp = await msg('SHEETS_API_BATCH_WRITE', { spreadsheetId: ssId, updates });
      if (resp && resp.error) { showToast(`Error: ${resp.error}`); return; }
      _undoStack.push({ ssId, batch: undoEntries });
    }

    moveCursorTo(`${srcCol}${landingRow}`);

    const report = FelixEngine.describePlan(plan, {
      srcCol,
      minScoreDefault: settings.minScore,
    });
    showToast(report.text, report.ms);
  }

  function moveCursorTo(ref) {
    const nameBox = findNameBox();
    if (!nameBox) return;
    nameBox.focus();
    if (nameBox.select) nameBox.select();
    nameBox.value = ref;
    nameBox.dispatchEvent(new Event('input', { bubbles: true }));
    nameBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  }

  let _toastTimer = null;
  function showToast(text, ms) {
    const s = getShadow();
    if (!s) return;
    const el = s.getElementById('toast-area');
    if (!el) return;
    el.innerHTML = `<div class="toast">${esc(text)}</div>`;
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.innerHTML = ''; }, ms || 2000);
  }

  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escA(s) { return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  // === Polling ===
  function checkForChanges() {
    if (!isValid()) { if (_pollTimer) clearInterval(_pollTimer); return; }
    if (!panelVisible || !_dataReady) return;

    const value = getCellValue();
    const ref = getCellRef();

    if (value !== lastCellValue || ref !== lastCellRef) {
      lastCellValue = value;
      lastCellRef = ref;

      // Broadcast selection to the side panel (for active-cell preview + import range auto-fill)
      chrome.runtime.sendMessage({ type: 'BROADCAST', payload: { type: 'SELECTION_CHANGED', ref, value } }).catch(() => {});

      // Cache source column values per row
      const refMatch = ref ? ref.match(/([A-Z]+)(\d+)/i) : null;
      if (refMatch && refMatch[1].toUpperCase() === (settings.sourceCol || 'A').toUpperCase()) {
        _sourceCache[refMatch[2]] = value;
      }

      const s = getShadow();
      if (s) {
        s.getElementById('cell-value').textContent = value || '—';
        s.getElementById('cell-ref').textContent = ref ? `(${ref})` : '';
      }

      if (value) {
        doSearch(value);
      } else if (isTargetColumn()) {
        // Empty target cell: search using cached source for this row
        const refMatch2 = ref ? ref.match(/(\d+)/i) : null;
        const cached = refMatch2 ? _sourceCache[refMatch2[1]] : null;
        if (cached) {
          doSearch(cached);
        } else {
          // No cache, clear results
          const rs = s.getElementById('results');
          if (rs) rs.innerHTML = `<div class="empty">${t('selectCell')}</div>`;
        }
      }
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
  }, { signal });

  // === Listen for messages from background/side panel ===
  chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
    if (m.type === 'PING') { sendResponse({ pong: true }); return; }
    if (m.type === 'TOGGLE_PANEL') {
      if (panelVisible) {
        const p = document.getElementById('felix-tm-panel');
        if (p) p.remove();
        panelVisible = false;
      } else {
        showPanel();
      }
      sendResponse({ ok: true });
      return;
    }
    if (m.type === 'GET_CELL') { sendResponse({ value: getCellValue(), ref: getCellRef() }); return; }
    if (m.type === 'GET_SELECTION') {
      const ref = getCellRef();
      sendResponse({ ref, value: getCellValue(), selection: ref });
      return;
    }
    if (m.type === 'GET_SHEET_INFO') {
      // Read active sheet tab name from Google Sheets DOM
      const activeTab = document.querySelector('.docs-sheet-tab.docs-sheet-active-tab .docs-sheet-tab-name');
      const sheetName = activeTab ? activeTab.textContent.trim() : '';
      sendResponse({ spreadsheetId: getSpreadsheetId(), sheetName });
      return;
    }
    if (m.type === 'SHORTCUTS_UPDATED') {
      if (m.get) settings.shortcutGet = m.get;
      if (m.set) settings.shortcutSet = m.set;
      updateShortcutLabel();
      return;
    }
    if (m.type === 'SETTINGS_UPDATED' && m.settings) {
      Object.assign(settings, m.settings);
      updateShortcutLabel();
      applyPanelLang();
      const s = getShadow();
      if (s) {
        s.getElementById('min-score').value = String(settings.minScore || 0.7);
      }
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
        msg('SHEETS_API_READ_DIRECT', { spreadsheetId: ssId, range: sheetRef(targetRef) }).then(r => {
          sendResponse({ value: r && r.value ? r.value : '', ref: targetRef });
        });
        return true;
      }
      sendResponse({ value: '', ref: '' });
    }
  });

  // === Sync with data changes (from manage page, via broadcast) ===
  // IndexedDB has no onChanged event, so manage page broadcasts DATA_CHANGED
  chrome.runtime.onMessage.addListener((m2) => {
    if (m2.type === 'DATA_CHANGED') {
      msg('TM_LOAD').then(data => { tmData = data || []; updateBadge(); if (lastCellValue) doSearch(); });
      msg('GLOSSARY_LOAD').then(data => { glossaryData = data || []; updateBadge(); });
      msg('RULES_LOAD').then(data => { rulesData = data || []; });
    }
    if (m2.type === 'SETTINGS_CHANGED') {
      msg('SETTINGS_LOAD').then(data => {
        if (data && Object.keys(data).length) {
          const oldSourceCol = settings.sourceCol;
          Object.assign(settings, data);
          updateShortcutLabel();
          applyPanelLang();
          const s = getShadow();
          if (s) {
            s.getElementById('min-score').value = String(settings.minScore || 0.7);
          }
          if (settings.sourceCol !== oldSourceCol) {
            _sourceCache = {};
            preloadSourceCache();
          }
        }
      });
    }
  });

  // === Dev bridge: hot-reload the extension from the page ===
  // Only FELIX_TM_DEV_RELOAD — functional verification is the user's job,
  // logic verification is what the Node unit tests are for. Registered with
  // { signal } so a re-injected newer instance cleanly tears down this
  // listener via __felixTMCleanup. Remove before publishing.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.type === 'FELIX_TM_DEV_RELOAD') msg('DEV_RELOAD');
  }, { signal });

  // === Show panel on load ===
  setTimeout(() => {
    showPanel();
  }, 2000);

})();
