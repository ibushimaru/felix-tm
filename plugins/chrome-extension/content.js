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
  const UNDO_STACK_MAX = 50;
  let _pollTimer = null;

  function pushUndo(entry) {
    _undoStack.push(entry);
    // Cap the stack so a long translation session doesn't grow unbounded.
    // 50 is deep enough to cover typical undo depth; the oldest entry
    // that falls off was for a cell the translator edited ~50 inserts
    // ago, i.e. beyond any realistic undo reach.
    while (_undoStack.length > UNDO_STACK_MAX) _undoStack.shift();
  }

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
      signInBanner: 'Sign in to enable Auto Translate, Set, and Sheets sync.',
      signInButton: 'Sign in with Google',
      signedInToast: '✓ Signed in',
      signInCancelled: 'Sign-in cancelled',
      // Tooltips
      tipManage: 'Side panel (TM / Glossary / Rules)',
      tipUndo: 'Undo (also restores an Auto Translate batch in one step)',
      tipAutoFuzzy: 'Translate downward from the active row. Continues while exact matches plus numbers/glossary fill the row; stops on the first uncovered diff. Overwrites existing target.',
      tipAutoRange: 'Translate every empty cell in the selection. Rows without a confident match are skipped (not blockers); existing target cells are left untouched.',
      tipSet: "Register the active row's source + target to TM (⌘⇧U)",
      tipModeTranslate: 'Look up target translations from source',
      tipModeReview: 'Look up source from target (reverse / check)',
      tipMinScore: 'Minimum match score for candidates',
      tipConcordance: 'Substring search inside the TM',
      tipRegex: 'Toggle regex mode',
      // Concordance placeholder
      phConcordance: 'Concordance',
      // Toasts
      nothingToUndo: 'Nothing to undo',
      noTmLoaded: 'No TM loaded',
      selectCellFirst: 'Select a cell first',
      selectRangeFirst: 'Select a range first',
      emptyRange: 'Empty range',
      readingSheet: 'Reading sheet…',
      loadingSource: 'Reading source row…',
      emptySourceRow: 'Source row is empty',
      copiedPrefix: 'Copied: ',
      readSourceFailed: 'Could not read source row',
      undoCellsTpl: 'Undo: {n} cells',
      undoRangePrefix: 'Undo: ',
      unsupportedSelection: 'Unsupported selection: {ref}',
      writingCellsTpl: 'Writing {n} cells…',
      errorPrefix: 'Error: ',
      searchPrefix: 'Search: ',
      toGlossary: 'To glossary: ',
      toTerm: 'To term: ',
      toTranslation: 'To translation: ',
      invalidRegex: 'Invalid regex',
    },
    ja: {
      activeCell: 'アクティブセル', selectCell: 'セルを選択するとTM検索します',
      noMatch: 'マッチなし',
      used: '使用', registered: '登録しました', alreadyExists: '既に存在 (+1)',
      srcEmpty: '原文セルが空です', tgtEmpty: '訳文セルが空です',
      autoFuzzy: '↓ Fuzzy', autoRange: '↓ 範囲',
      signInBanner: 'Auto Translate・Set・シート同期を使うにはサインインしてください。',
      signInButton: 'Google でサインイン',
      signedInToast: '✓ サインインしました',
      signInCancelled: 'サインインをキャンセルしました',
      // Tooltips
      tipManage: 'サイドパネル（TM・用語集・ルール管理）',
      tipUndo: '元に戻す（Auto Translate の一括挿入も 1 回で復元）',
      tipAutoFuzzy: '現在行から下方向へ連続翻訳。完全一致＋数値／用語集で埋められる行まで続行、埋められない差分が出たら停止／既存訳文は上書き',
      tipAutoRange: '選択範囲の空セルをまとめて翻訳。マッチしない行はスキップ（処理は止まらない）／既存訳文は上書きしない',
      tipSet: '現在行の原文＋訳文を TM に登録（⌘⇧U）',
      tipModeTranslate: '原文を見て訳文候補を探す',
      tipModeReview: '訳文を見て原文候補を探す（逆引き・チェック用）',
      tipMinScore: '候補を出す最低マッチ率',
      tipConcordance: 'TM 内を文字列検索（部分一致）',
      tipRegex: '正規表現モードに切り替え',
      // Concordance placeholder
      phConcordance: 'コンコーダンス',
      // Toasts
      nothingToUndo: '元に戻す操作がありません',
      noTmLoaded: 'TM が読み込まれていません',
      selectCellFirst: 'セルを選択してください',
      selectRangeFirst: '範囲を選択してください',
      emptyRange: '範囲が空です',
      readingSheet: 'シートを読み込み中…',
      loadingSource: '原文行を読み込み中…',
      emptySourceRow: '原文行が空です',
      copiedPrefix: 'コピー: ',
      readSourceFailed: '原文行を読み込めませんでした',
      undoCellsTpl: '元に戻す: {n} セル',
      undoRangePrefix: '元に戻す: ',
      unsupportedSelection: '未対応の選択: {ref}',
      writingCellsTpl: '{n} セル書き込み中…',
      errorPrefix: 'エラー: ',
      searchPrefix: '検索: ',
      toGlossary: '用語集へ: ',
      toTerm: '用語へ: ',
      toTranslation: '訳語へ: ',
      invalidRegex: '無効な正規表現',
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

  // Sheets API errors that come back from background.js are surfaced
  // via showToast at the call site. The previous per-spreadsheet
  // authorization banner was removed when we switched from
  // drive.file to spreadsheets scope — one consent now covers any
  // sheet the user opens.

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
    // preloadSourceCache used to hit Sheets API on panel mount,
    // which costs a request before the user has done anything.
    // The cache still works opportunistically — see the
    // SELECTION_CHANGED broadcast handler below where we record
    // cell values as the user navigates.
    // Run initial search immediately if the cell value is already in the
    // DOM. When the panel mounts faster than Sheets stabilises the
    // selection DOM, the first read comes back empty; schedule a
    // one-shot retry so the translator doesn't have to click a cell
    // just to get the first card.
    const kickOff = () => {
      const value = getCellValue();
      if (!value) return false;
      lastCellValue = value;
      lastCellRef = getCellRef();
      const s = getShadow();
      if (s) {
        s.getElementById('cell-value').textContent = value;
        s.getElementById('cell-ref').textContent = lastCellRef ? `(${lastCellRef})` : '';
      }
      doSearch(value);
      return true;
    };
    if (!kickOff()) {
      setTimeout(kickOff, 500);
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
      .match-target { color: #202124; font-size: 12px; margin-top: 2px; word-break: break-all; }
      .match-meta { color: #9aa0a6; font-size: 10px; margin-top: 3px; }
      .empty { text-align: center; color: #9aa0a6; padding: 16px 8px; font-size: 12px; }
      .action-bar { display: flex; gap: 6px; align-items: center; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #e8eaed; flex-shrink: 0; }
      #auth-banner { display: none; flex-direction: column; gap: 8px; padding: 10px 12px; margin-bottom: 8px; background: #f8f9fa; border: 1px solid #e8eaed; border-radius: 8px; font-size: 12px; color: #5f6368; flex-shrink: 0; }
      #auth-banner.visible { display: flex; }
      #auth-banner .msg { line-height: 1.4; }
      #auth-banner .btn { align-self: flex-start; }
      .btn { padding: 6px 12px; border-radius: 4px; border: 1px solid #dadce0; cursor: pointer; font-size: 11px; font-weight: 500; background: #fff; color: #1a73e8; }
      .btn:hover { background: #f1f3f4; }
      .toast { padding: 6px 10px; border-radius: 4px; font-size: 11px; margin-top: 6px; background: #e6f4ea; color: #137333; white-space: pre-line; line-height: 1.4; }
      /* Card preview of the placement output:
         - placed-ins (blue): chars the system rewrote itself (numbers,
           resolved-glossary, rules) — positions are known exactly.
         - placed-unverified (dotted underline): the non-placed range
           when any uncovered diff survived. Range-level "contamination
           somewhere in here" marker, not a pinpoint. */
      .placed-ins { background: #e8f0fe; color: #1a73e8; border-radius: 2px; padding: 0 1px; }
      .placed-unverified { border-bottom: 1px dotted #9aa0a6; }
      .diff-match { color: #137333; }
      /* Uncovered-diff palette has two axes:
           background  → glossary registration (red = missing, amber = registered)
           decoration  → post-placement action:
                           none           = substitution / swap
                           dashed under   = must ADD (cell has it, TM doesn't)
                           line-through   = must REMOVE (TM has it, cell doesn't)
         The decoration mirrors the actual edit the translator will make
         on top of the placed TM target, so add/remove read as opposite
         actions instead of two flavors of "ins/del". */
      .diff-uncovered-missing { background: #fce8e6; color: #c5221f; font-weight: 500; }
      .diff-uncovered-present { background: #feefc3; color: #b06000; font-weight: 500; }
      .diff-uncovered-add { text-decoration: underline dashed; text-underline-offset: 2px; }
      .diff-uncovered-remove { text-decoration: line-through; }
      .diff-sub { background: #feefc3; color: #b06000; }
      .diff-del { background: #fce8e6; color: #c5221f; text-decoration: underline dashed; text-underline-offset: 2px; }
      .diff-ins { background: #fce8e6; color: #c5221f; text-decoration: line-through; }
      .gloss_match { text-decoration: underline; text-decoration-color: #1a73e8; text-underline-offset: 2px; cursor: pointer; position: relative; }
      .gloss_match::after { content: attr(data-tip); display: none; position: absolute; bottom: 100%; left: 0; background: #fff; border: 1px solid #dadce0; border-radius: 4px; padding: 2px 6px; font-size: 10px; color: #202124; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.12); z-index: 10; pointer-events: none; }
      .gloss_match:hover::after { display: block; }
      .gloss-copied { background: #e6f4ea; transition: background 0.3s; }
      .match-placed { border-color: #34a853; }
      .match-placed:hover { border-color: #137333; }
      .placed-badge { display: inline-block; background: #fff; color: #34a853; border: 1px solid #34a853; font-size: 9px; font-weight: 600; padding: 1px 4px; border-radius: 3px; margin-left: 4px; vertical-align: middle; }
      /* Reference block: muted colour so the insert preview stays dominant.
         No label text — the dashed divider alone is enough to read the
         two lines as "registered memory". */
      .match-ref { border-top: 1px dashed #e8eaed; margin-top: 8px; padding-top: 6px; cursor: text; user-select: text; }
      .ref-row { color: #9aa0a6; font-size: 11px; margin-top: 2px; word-break: break-all; }
      .btn-del-tm:hover { color: #ea4335 !important; }
      /* Right-click popover for glossary registration from a text
         selection inside the card. Sits above every other panel chrome. */
      .settings-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
      .mode-toggle { display: flex; border: 1px solid #dadce0; border-radius: 4px; }
      .mode-btn { padding: 3px 8px; font-size: 10px; cursor: pointer; color: #5f6368; user-select: none; }
      .mode-btn:first-child { border-radius: 3px 0 0 3px; }
      .mode-btn:last-child  { border-radius: 0 3px 3px 0; }
      .mode-btn.mode-active { color: #1a73e8; font-weight: 600; }
      .conc-row { display: flex; gap: 4px; margin-bottom: 6px; }
      .conc-input { flex: 1; padding: 4px 6px; border: 1px solid #dadce0; border-radius: 4px; font-size: 11px; }
      .conc-input:focus { outline: none; border-color: #1a73e8; }
      .conc-highlight { background: #fef7cd; border-radius: 2px; padding: 0 1px; }
      .regex-toggle { padding: 3px 6px; border: 1px solid #dadce0; border-radius: 4px; font-size: 11px; font-family: monospace; cursor: pointer; color: #9aa0a6; user-select: none; }
      .regex-toggle.active { color: #1a73e8; border-color: #1a73e8; font-weight: 600; }
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
          <button class="btn-close has-tip-below" id="btn-manage" data-tip="">⚙</button>
          <button class="btn-close" id="btn-min" aria-label="Minimize">−</button>
          <button class="btn-close" id="btn-close" aria-label="Close">✕</button>
        </span>
      </div>
      <div id="body">
        <div id="auth-banner">
          <div class="msg">Sign in to enable Auto Translate, Set, and Sheets sync.</div>
          <button class="btn" id="btn-sign-in-banner">Sign in with Google</button>
        </div>
        <div class="action-bar">
          <button class="btn has-tip-below" id="btn-undo" data-tip="" style="padding:6px 8px;color:#5f6368">↩</button>
          <span class="auto-label" id="lbl-auto">Auto:</span>
          <button class="btn has-tip-below" id="btn-auto-fuzzy" data-tip="">↓ Fuzzy</button>
          <button class="btn has-tip-below" id="btn-auto-range" data-tip="">↓ Range</button>
          <span style="flex:1"></span>
          <button class="btn has-tip-below" id="btn-set" data-tip="">Set</button>
        </div>
        <div class="cell-label"><span id="lbl-cell">Active Cell</span> <span id="cell-ref"></span></div>
        <div class="cell-preview" id="cell-value">—</div>
        <div class="settings-row">
          <div class="mode-toggle" id="mode-toggle">
            <span class="mode-btn mode-active has-tip" data-mode="translate" id="mode-translate" data-tip="">Translate</span>
            <span class="mode-btn has-tip" data-mode="review" id="mode-review" data-tip="">Review</span>
          </div>
          <span class="tip-wrap has-tip" id="min-score-wrap" data-tip="" style="width:60px"><select id="min-score" style="padding:4px;font-size:11px">
            <option value="0.5">50%</option><option value="0.6">60%</option>
            <option value="0.7" selected>70%</option><option value="0.8">80%</option>
            <option value="0.9">90%</option>
          </select></span>
        </div>
        <div class="conc-row">
          <span class="tip-wrap has-tip" id="conc-query-wrap" data-tip="" style="flex:1"><input class="conc-input" id="conc-query" placeholder=""></span>
          <span class="regex-toggle has-tip" id="btn-regex" data-tip="">.*</span>
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

    // === Auth banner ===
    // The in-page overlay is the user's primary surface; forcing a trip
    // to the side panel just to sign in adds friction. The banner shows
    // up only when no token is cached and disappears the moment the
    // SIGN_IN handler reports success (also reacts to AUTH_CHANGED so
    // signing out from the side panel re-shows the banner here).
    function refreshAuthBanner() {
      msg('AUTH_STATUS').then(resp => {
        const banner = shadow.getElementById('auth-banner');
        if (banner) banner.classList.toggle('visible', !(resp && resp.signedIn));
      });
    }
    shadow.getElementById('btn-sign-in-banner').addEventListener('click', () => {
      msg('SIGN_IN').then(resp => {
        refreshAuthBanner();
        if (resp && resp.signedIn) showToast(t('signedInToast'));
        else showToast(t('signInCancelled'));
      });
    });
    refreshAuthBanner();

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

    // Right-click → glossary registration shortcut. Bound here at panel
    // creation so it survives every doSearch re-render and works on the
    // active-cell preview even before the first search runs. The handler
    // uses the user's text selection when there is one; otherwise it
    // walks up from the click target to find a known span (glossary
    // underline, uncovered red/yellow) and uses that span's text.
    shadow.addEventListener('contextmenu', (e) => {
      const text = pickContextMenuText(shadow, e.target);
      if (!text) return;  // no usable text → leave the browser default menu
      e.preventDefault();
      e.stopPropagation();
      openCtxMenu(e.clientX, e.clientY, text);
    });

    applyPanelLang();
    return shadow;
  }

  function applyPanelLang() {
    const s = getShadow();
    if (!s) return;
    const setText = (id, text) => { const el = s.getElementById(id); if (el) el.textContent = text; };
    const setTip  = (id, text) => { const el = s.getElementById(id); if (el) el.setAttribute('data-tip', text); };
    const setPh   = (id, text) => { const el = s.getElementById(id); if (el) el.placeholder = text; };
    // Labels
    setText('lbl-cell', t('activeCell'));
    setText('lbl-empty', t('selectCell'));
    setText('btn-auto-fuzzy', t('autoFuzzy'));
    setText('btn-auto-range', t('autoRange'));
    setText('btn-sign-in-banner', t('signInButton'));
    const bannerMsg = s.querySelector('#auth-banner .msg');
    if (bannerMsg) bannerMsg.textContent = t('signInBanner');
    // Tooltips (data-tip drives the ::after popover)
    setTip('btn-manage', t('tipManage'));
    setTip('btn-undo', t('tipUndo'));
    setTip('btn-auto-fuzzy', t('tipAutoFuzzy'));
    setTip('btn-auto-range', t('tipAutoRange'));
    setTip('btn-set', t('tipSet'));
    setTip('mode-translate', t('tipModeTranslate'));
    setTip('mode-review', t('tipModeReview'));
    setTip('min-score-wrap', t('tipMinScore'));
    setTip('conc-query-wrap', t('tipConcordance'));
    setTip('btn-regex', t('tipRegex'));
    // Placeholders
    setPh('conc-query', t('phConcordance'));
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

  // === Search ===
  // Translate mode = forward search; Review mode = reverse search.
  // The user picks the mode explicitly via the Translate / Review toggle.
  function isTargetColumn() {
    const ref = getCellRef();
    const match = ref ? ref.match(/([A-Z]+)/i) : null;
    if (!match) return false;
    return match[1].toUpperCase() === (settings.targetCol || 'B').toUpperCase();
  }

  // Cache: source value per row (populated when user is on source column)
  let _sourceCache = {}; // { rowNum: value }
  // Dedupe in-flight Sheets fetches by row, so a quick selection bounce
  // doesn't fire multiple reads for the same cell.
  const _pendingSourceFetch = new Set();

  // Translate mode + cursor on target cell + no cache hit for this row →
  // read the row's source from the spreadsheet and re-run search. Without
  // this, the panel sits blank on a fresh target cell until the user has
  // navigated through the source column at least once.
  async function fetchSourceForRow(rowNum) {
    if (!rowNum || _pendingSourceFetch.has(rowNum)) return;
    _pendingSourceFetch.add(rowNum);
    try {
      const ssId = getSpreadsheetId();
      if (!ssId) { _sourceCache[rowNum] = ''; return; }
      const srcCol = settings.sourceCol || 'A';
      const range = sheetRef(`${srcCol}${rowNum}`);
      let val = '';
      // Race the fetch against an 8s timeout so a hung background or a
      // dropped sendResponse doesn't leave the row pinned in the dedupe
      // set forever.
      try {
        const resp = await Promise.race([
          msg('SHEETS_API_READ_DIRECT', { spreadsheetId: ssId, range }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
        ]);
        val = (resp && resp.value) ? resp.value : '';
      } catch (_) { val = ''; }
      // Always cache, even when empty, so a fresh selection on the same
      // row goes straight to the "empty source row" message instead of
      // re-fetching forever. `in _sourceCache` distinguishes "we tried
      // and got nothing" from "we never tried".
      _sourceCache[rowNum] = val;
      // Re-run only if the user is still on the row that triggered this
      // fetch (otherwise the result would clobber a more recent cell).
      const curRef = getCellRef();
      if (!curRef || !new RegExp(`(?:^|[^0-9])${rowNum}$`).test(curRef)) return;
      if (val) {
        // Pass the cached value explicitly. doSearch() with no args
        // falls back to lastCellValue, which is '' when the active
        // cell is a blank target — and doSearch early-returns on empty
        // query before ever consulting the cache, leaving the "Reading
        // source row…" placeholder pinned forever.
        doSearch(val);
      } else {
        // Source row is genuinely empty — paint the message directly
        // for the same reason: no truthy query means doSearch would
        // early-return.
        const sh = getShadow();
        const rs = sh && sh.getElementById('results');
        if (rs) rs.innerHTML = `<div class="empty">${t('emptySourceRow')}</div>`;
      }
    } finally {
      _pendingSourceFetch.delete(rowNum);
    }
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

  /** Render `placed` as HTML with per-region classes + optional data-tip
   *  attributes. Regions must be non-overlapping; overlaps and malformed
   *  entries (missing idx/len) are dropped so a bad region can't corrupt
   *  the cursor and cause the tail to re-emit the whole string. */
  function markRegionsMixed(text, regions) {
    const safe = regions.filter(r =>
      typeof r.idx === 'number' && typeof r.len === 'number' &&
      r.idx >= 0 && r.len > 0 && r.idx + r.len <= text.length);
    if (!safe.length) return esc(text);
    const sorted = [...safe].sort((a, b) => a.idx - b.idx);
    let html = '', cursor = 0;
    for (const r of sorted) {
      if (r.idx < cursor) continue;
      html += esc(text.substring(cursor, r.idx));
      const tip = r.dataTip ? ` data-tip="→ ${escA(r.dataTip)}"` : '';
      html += `<span class="${r.cls}"${tip}>${esc(text.substring(r.idx, r.idx + r.len))}</span>`;
      cursor = r.idx + r.len;
    }
    html += esc(text.substring(cursor));
    return html;
  }

  function placedHighlightHtml(original, placed, uncoveredCount) {
    const placedRegions = FelixEngine.findDiffRegions(original, placed);
    const regions = placedRegions.map(r => ({
      idx: r.idx, len: r.len, cls: 'placed-ins',
    }));
    if (uncoveredCount > 0) {
      for (const r of FelixEngine.unverifiedRegions(placedRegions, placed.length)) {
        regions.push({ idx: r.idx, len: r.len, cls: 'placed-unverified' });
      }
    }
    return markRegionsMixed(placed, regions);
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
      // Translate mode: forward search. When the cursor lands on a target
      // cell, use the same row's source as the query so the panel keeps
      // showing source-side matches as the translator navigates between
      // source and target columns. Cache first; on miss, fall back to a
      // direct Sheets API read for that one cell and re-run when it
      // arrives — without this fallback the panel is blank on the very
      // first target cell the user touches in a session.
      if (onTarget) {
        const ref = getCellRef();
        const rowMatch = ref ? ref.match(/(\d+)/i) : null;
        const rowNum = rowMatch ? rowMatch[1] : null;
        if (rowNum && rowNum in _sourceCache) {
          const cached = _sourceCache[rowNum];
          if (cached) {
            searchQuery = cached;
          } else {
            // Already fetched and the source row is genuinely empty —
            // don't refetch, just say so (otherwise the panel sits on
            // "Reading source row…" forever).
            const rs = s.getElementById('results');
            if (rs) rs.innerHTML = `<div class="empty">${t('emptySourceRow')}</div>`;
            return;
          }
        } else if (rowNum) {
          fetchSourceForRow(rowNum);
          const rs = s.getElementById('results');
          if (rs) rs.innerHTML = `<div class="empty">${t('loadingSource')}</div>`;
          return;
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

    const el = s.getElementById('results');
    const label = panelMode === 'review' ? '↔ Review' : (onTarget ? '← Source' : '');
    // Check if any match is 100% — if so, skip Placement entirely
    const has100 = !isReverse && matches.some(m => Math.round(m.score * 100) === 100);

    // Compute uncovered for the top non-reverse fuzzy match up front so the
    // active-cell preview can paint query-side uncovered regions (red for
    // the side missing from glossary, yellow for the side present but
    // blocked by a missing counterpart). The same resolved object is reused
    // inside the match loop to avoid recomputing.
    let topResolved = null;
    if (!isReverse && !has100 && matches.length) {
      const top = matches[0];
      const topPct = Math.round(top.score * 100);
      if (topPct < 100) {
        topResolved = FelixEngine.resolveWithPlacement(
          searchQuery, top.source, top.target, glossaryData, rulesData);
      }
    }
    const topUncovered = topResolved ? topResolved.uncovered : [];

    // Cell preview: glossary underlines + uncovered coloring on the query
    const cellPreview = s.getElementById('cell-value');
    if (searchQuery) {
      const rendered = FelixEngine.renderQueryCellWithUncovered(
        searchQuery, glossHits, topUncovered);
      if (rendered) cellPreview.innerHTML = rendered;
    }

    if (!matches.length) {
      el.innerHTML = `<div class="empty">${t('noMatch')} ${label} (${ms}ms)</div>`;
    } else {
      el.innerHTML = (label ? `<div style="font-size:10px;color:#1a73e8;margin-bottom:4px">${label}</div>` : '') +
      matches.map((m, i) => {
        const pct = Math.round(m.score * 100);
        const cls = pct >= 90 ? 'score-high' : pct >= 70 ? 'score-mid' : 'score-low';
        const meta = m.refcount ? `${t('used')} ${m.refcount}x` : '';
        const tmIdx = typeof m.tmIdx === 'number' ? m.tmIdx : tmData.findIndex(e => e.source === m.source && e.target === m.target);

        let srcHtml, memSrcHtml = '', tgtDisplay, insertTarget, placed = false;
        if (isReverse) {
          const diff = pct < 100 ? FelixEngine.diffHighlight(query, m.target) : null;
          srcHtml = diff ? diff.sourceHtml : esc(m.target);
          tgtDisplay = esc(m.source);
          insertTarget = m.source;
        } else {
          if (pct === 100) {
            srcHtml = esc(m.source);
          } else {
            // Query (what the user is translating now) with glossary hits
            // underlined + diff marks vs. TM source. TM source is shown on
            // its own line below so the translator can compare directly
            // and, when a glossary entry is missing, copy both terms at once.
            const diff = FelixEngine.diffHighlight(searchQuery, m.source, glossHits);
            srcHtml = diff ? diff.queryHtml : esc(m.source);
            memSrcHtml = diff ? diff.sourceHtml : esc(m.source);
          }

          insertTarget = m.target;
          tgtDisplay = esc(m.target);
          // Placement: only on the top result, and only if no 100% match.
          // Uses the same per-diff resolver as Auto Translate so what's
          // shown in the match panel matches exactly what would be written
          // if the user clicks the match (or runs ↓ Fuzzy on this row).
          if (!has100 && i === 0 && pct < 100) {
            const resolved = topResolved || FelixEngine.resolveWithPlacement(
              searchQuery, m.source, m.target, glossaryData, rulesData);
            const placedTarget = resolved.target;
            const badges = resolved.placements;

            if (badges.length) {
              placed = true;
              insertTarget = placedTarget;
              const uncoveredCount = resolved.uncovered.length;
              tgtDisplay = placedHighlightHtml(m.target, placedTarget, uncoveredCount) + `<span class="placed-badge">${badges.join('+')}置換</span>`;
            }
          }
        }

        // Layout: insert preview on top, optional reference block below.
        // Reference block uses .match-ref everywhere (dashed separator,
        // gray padding, click-excluded for select/copy) so Source and
        // Reverse modes look the same.
        //   Source mode  → top: TM.target placed, ref: TM.source vs query
        //   Reverse mode → top: TM.source plain,  ref: TM.target vs query
        // Both modes hide the reference at 100% — at that point there is
        // no diff to show.
        const showRef = pct < 100 && (isReverse ? !!srcHtml : !!memSrcHtml);
        // TM.source in the reference block gets uncovered coloring only for
        // the top match (where topResolved was computed). Subsequent cards
        // stay plain since placement is only applied to the top result.
        const refSrcHtml = (showRef && !isReverse && i === 0 && topUncovered.length)
          ? FelixEngine.markUncoveredHtml(m.source, topUncovered, 's')
          : esc(m.source);
        let refBlock = '';
        if (showRef) {
          if (isReverse) {
            refBlock = `<div class="match-ref"><div class="ref-row">${srcHtml}</div></div>`;
          } else {
            refBlock = `<div class="match-ref">
              <div class="ref-row">${refSrcHtml}</div>
              ${placed ? `<div class="ref-row">${esc(m.target)}</div>` : ''}
            </div>`;
          }
        }
        return `<div class="match${placed ? ' match-placed' : ''}" data-idx="${i}" data-target="${escA(insertTarget)}" data-tm-idx="${tmIdx}">
          <span class="score ${cls}">${pct}%</span>
          <span style="float:right;display:flex;align-items:center;gap:4px">
            ${i === 0 ? `<span style="font-size:10px;color:#9aa0a6">${ms}ms</span>` : ''}
            <span class="btn-del-tm" data-del-idx="${tmIdx}" title="Delete from TM" style="font-size:11px;color:#dadce0;cursor:pointer">✕</span>
          </span>
          <div class="match-target">${tgtDisplay}</div>
          ${refBlock}
          ${meta ? `<div class="match-meta">${meta}</div>` : ''}
        </div>`;
      }).join('');

      // Click: left half → next row, right half → edit target.
      // The reference block (match-ref) is a read-only lookup area for the
      // translator to copy TM.source / TM.target from (e.g. into a new
      // glossary entry), so clicks there must NOT trigger an insert and
      // hover there must NOT show the active-card halves.
      const inRef = (target) => target && typeof target.closest === 'function' && !!target.closest('.match-ref');
      el.querySelectorAll('.match').forEach(div => {
        div.addEventListener('mousemove', (e) => {
          if (inRef(e.target)) {
            div.classList.remove('hover-left', 'hover-right');
            return;
          }
          const rect = div.getBoundingClientRect();
          const isRight = (e.clientX - rect.left) > rect.width / 2;
          div.classList.toggle('hover-left', !isRight);
          div.classList.toggle('hover-right', isRight);
        });
        div.addEventListener('mouseleave', () => {
          div.classList.remove('hover-left', 'hover-right');
        });
        // Track press position so a drag-to-select doesn't get treated
        // as a click-to-insert. The card click is the primary insert UX
        // (left half = ↓ insert, right half = → insert), but the placed
        // target preview is also useful as a thing to copy text from —
        // and a copy starts with a drag-select, which without this check
        // would land in the click handler and move the cursor away.
        let downX = 0, downY = 0;
        div.addEventListener('mousedown', (e) => {
          downX = e.clientX; downY = e.clientY;
        });
        div.addEventListener('click', (e) => {
          if (e.target.classList.contains('btn-del-tm')) return;
          if (inRef(e.target)) return;
          // Drag distance > a few pixels → treat as a selection gesture.
          if (Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3) return;
          // Even a stationary click can complete a prior selection (the
          // user double-clicked a word, then single-clicked to confirm).
          // If a selection survived in either the shadow root or the
          // window, leave it alone so the user can copy it.
          if (getShadowSelectionText(s)) return;
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
          showToast(t('copiedPrefix') + text);
          setTimeout(() => span.classList.remove('gloss-copied'), 500);
        }).catch(() => {});
      });
    });

    // Uncovered term click → open the Chrome side panel with a one-shot
    // intent. Red (missing) sends 'add' so the translator can type the
    // translation straight away; yellow (registered elsewhere but blocked
    // by a missing counterpart) sends 'browse' so they jump to the
    // existing entry in the glossary list. The intent is held in the
    // service worker because content scripts can't read chrome.storage.session
    // by default, and a direct broadcast would race the panel mount.
    // stopPropagation prevents the click from bubbling into the .match
    // card's insert handler.
    const bindUncoveredClick = (root) => {
      if (!root) return;
      root.querySelectorAll('.diff-uncovered-missing, .diff-uncovered-present').forEach(span => {
        if (span.dataset.bound === '1') return;
        span.dataset.bound = '1';
        span.style.cursor = 'pointer';
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          const term = span.textContent || '';
          if (!term) return;
          const registered = span.classList.contains('diff-uncovered-present');
          const mode = registered ? 'browse' : 'add';
          msg('OPEN_GLOSSARY_WITH_ACTION', { term, mode });
          showToast((registered ? t('searchPrefix') : t('toGlossary')) + term);
        });
      });
    };
    bindUncoveredClick(el);
    bindUncoveredClick(s.getElementById('cell-value'));
  }

  function getShadowSelectionText(shadow) {
    // ShadowRoot.getSelection is a Chromium extension on closed shadow
    // roots; window.getSelection sometimes still returns the selected
    // text even though the anchorNode is reported as the host. Try both
    // and return the first non-empty result.
    try {
      if (shadow && typeof shadow.getSelection === 'function') {
        const sel = shadow.getSelection();
        const t = sel ? (sel.toString() || '').trim() : '';
        if (t) return t;
      }
    } catch (_) {}
    try {
      const sel = window.getSelection();
      const t = sel ? (sel.toString() || '').trim() : '';
      if (t) return t;
    } catch (_) {}
    return '';
  }

  function pickContextMenuText(shadow, target) {
    const sel = getShadowSelectionText(shadow);
    if (sel) return sel;
    // No selection: prefer a meaningful span the cursor is over (glossary
    // underline, uncovered red/yellow, placement-result span). Falling
    // back to the whole .ref-row would dump the entire TM line, which is
    // never what the translator wanted to register.
    if (!target || typeof target.closest !== 'function') return '';
    const span = target.closest('.gloss_match, .diff-uncovered-missing, .diff-uncovered-present, .placed-ins, .placed-badge');
    if (span && span.textContent) return span.textContent.trim();
    return '';
  }

  // The menu attaches to document.body (not the shadow root) because the
  // in-page panel has overflow:hidden on its #panel wrapper; rendering a
  // position:fixed child inside the shadow was getting clipped. Inline
  // styles stand in for the shadow-scoped CSS we no longer inherit.
  const CTX_MENU_ID = 'felix-tm-ctx-menu';
  function openCtxMenu(x, y, text) {
    closeCtxMenu();
    const menu = document.createElement('div');
    menu.id = CTX_MENU_ID;
    menu.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'background:#fff',
      'border:1px solid #dadce0',
      'border-radius:6px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
      'min-width:200px',
      'padding:4px 0',
      'font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'font-size:13px',
      'color:#202124',
      'user-select:none',
    ].join(';');

    const label = document.createElement('div');
    label.textContent = text.length > 40 ? text.slice(0, 40) + '…' : text;
    label.style.cssText = 'padding:4px 12px;font-size:11px;color:#9aa0a6;border-bottom:1px solid #e8eaed;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px';
    menu.appendChild(label);

    const mkItem = (caption, onPick) => {
      const item = document.createElement('div');
      item.textContent = caption;
      item.style.cssText = 'padding:7px 14px;cursor:pointer;white-space:nowrap';
      item.addEventListener('mouseenter', () => { item.style.background = '#f1f3f4'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        onPick();
        closeCtxMenu();
      });
      menu.appendChild(item);
    };
    mkItem('用語として用語集へ', () => sendGlossaryAction(text, 'add', 'term'));
    mkItem('訳語として用語集へ', () => sendGlossaryAction(text, 'add', 'translation'));
    mkItem('用語集で検索', () => sendGlossaryAction(text, 'browse'));

    document.body.appendChild(menu);

    // Clamp to viewport so the menu doesn't shoot off the right or
    // bottom edge when the cursor is near those boundaries.
    const rect = menu.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 4;
    const maxY = window.innerHeight - rect.height - 4;
    menu.style.left = Math.max(4, Math.min(x, maxX)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, maxY)) + 'px';

    // One AbortController tears down whichever of the two dismiss
    // listeners (mousedown / Escape) fires first, so the other doesn't
    // linger on `document` waiting forever.
    const abort = new AbortController();
    const dismiss = (ev) => {
      if (ev.type === 'keydown' && ev.key !== 'Escape') return;
      abort.abort();
      closeCtxMenu();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', dismiss, { capture: true, signal: abort.signal });
      document.addEventListener('keydown', dismiss, { capture: true, signal: abort.signal });
    }, 0);
    _ctxMenuAbort = abort;
  }

  let _ctxMenuAbort = null;
  function closeCtxMenu() {
    const existing = document.getElementById(CTX_MENU_ID);
    if (existing) existing.remove();
    if (_ctxMenuAbort) { _ctxMenuAbort.abort(); _ctxMenuAbort = null; }
  }

  function sendGlossaryAction(text, mode, prefillSide) {
    // mode: 'add' | 'browse'
    // prefillSide (only when mode === 'add'): 'term' | 'translation'
    msg('OPEN_GLOSSARY_WITH_ACTION', { term: text, mode, prefillSide });
    showToast((mode === 'browse' ? t('searchPrefix') : (prefillSide === 'translation' ? t('toTranslation') : t('toTerm'))) + text);
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
        s.getElementById('results').innerHTML = `<div class="empty">${t('invalidRegex')}</div>`;
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
        const tmIdx = typeof h.tmIdx === 'number' ? h.tmIdx : tmData.findIndex(e => e.source === h.source && e.target === h.target);
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
    await writeToTarget(target, editMode);
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

    // Refresh the results panel so the just-registered pair shows up
    // as the 100% top match. Without this, the translator is left
    // looking at whatever fuzzy-candidate card led them to hit Set.
    doSearch(source);
  }

  // === Write to target cell via Sheets API ===
  async function writeToTarget(value, editMode) {
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
    pushUndo({ ssId, range: fullRange, oldValue, newValue: value });

    // Use the formatted write with empty ranges so any residual
    // textFormatRuns from a previous insert (older builds painted the
    // cell blue / underline) get reset. The batchUpdate path writes
    // `textFormatRuns: [{ startIndex: 0, format: {} }]` which clears
    // prior custom formatting and leaves the cell fully plain.
    await msg('SHEETS_API_WRITE_FORMATTED', {
      spreadsheetId: ssId, range: fullRange, value,
      placedRanges: [], unverifiedRanges: [],
    });

    // Edit mode → jump to the target cell; otherwise → next row's source.
    moveCursorTo(editMode ? targetRef : (settings.sourceCol || 'A') + (rowNum + 1));
  }

  async function undoLastWrite() {
    const entry = _undoStack.pop();
    if (!entry) { showToast(t('nothingToUndo')); return { reason: 'empty_stack' }; }
    let result;
    if (entry.batch && entry.batch.length) {
      const updates = entry.batch.map(b => ({ range: b.range, value: b.oldValue }));
      await msg('SHEETS_API_BATCH_WRITE', { spreadsheetId: entry.ssId, updates });
      showToast(t('undoCellsTpl').replace('{n}', String(entry.batch.length)));
      result = { kind: 'batch', restored: entry.batch.length, firstRange: entry.batch[0].range };
    } else {
      await msg('SHEETS_API_WRITE', { spreadsheetId: entry.ssId, range: entry.range, value: entry.oldValue });
      showToast(t('undoRangePrefix') + entry.range);
      result = { kind: 'single', range: entry.range };
    }
    // Refresh the panel so the card that triggered the now-undone insert
    // reflects the restored state instead of the post-insert view it was
    // left in. No-op when no query is active.
    if (lastCellValue) doSearch();
    return result;
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
    if (!tmData.length) { showToast(t('noTmLoaded')); return; }
    const ref = getCellRef();
    if (!ref) { showToast(t('selectCellFirst')); return; }

    // Accept a concrete cell (A2, A2:A5), a column-only ref (A:A, A2:A), or
    // even a rectangular selection — we always walk down from the anchor row
    // in settings.sourceCol. If no row is given (whole-column select), start
    // from row 1.
    const parsed = FelixEngine.parseA1(ref);
    if (!parsed) { showToast(t('unsupportedSelection').replace('{ref}', ref)); return; }
    const startRow = parsed.row || 1;
    const srcCol = settings.sourceCol || 'A';
    const tgtCol = settings.targetCol || 'B';
    const ssId = getSpreadsheetId();
    if (!ssId) return;

    const BATCH = 500;
    const srcRange = sheetRef(`${srcCol}${startRow}:${srcCol}${startRow + BATCH - 1}`);
    const tgtRange = sheetRef(`${tgtCol}${startRow}:${tgtCol}${startRow + BATCH - 1}`);
    showToast(t('readingSheet'));
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
   * Auto-translate the currently selected range. Walks every row in the
   * selection independently — a row that can't be translated (no candidate
   * above threshold, or fuzzy with uncovered diffs) is recorded and
   * surfaced in the result toast but does NOT stop the rest of the range
   * from being processed. Existing non-empty target cells are left
   * untouched so prior work is preserved.
   */
  async function autoTranslateSelection() {
    if (!tmData.length) { showToast(t('noTmLoaded')); return; }
    const ref = getCellRef();
    if (!ref) { showToast(t('selectRangeFirst')); return; }

    // Accept both row-qualified refs (A2, A2:A5, A2:B5) and column-only refs
    // (A:A, A:B, A2:A — row missing on one side). For column-only selections
    // we read an unbounded range and let the actual data length decide endRow.
    const parsed = FelixEngine.parseA1(ref);
    if (!parsed) { showToast(t('unsupportedSelection').replace('{ref}', ref)); return; }
    const startRow = parsed.row || 1;
    const explicitEndRow = parsed.row2 || null;
    if (explicitEndRow != null && explicitEndRow < startRow) { showToast(t('emptyRange')); return; }

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
    showToast(t('readingSheet'));
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
      showToast(t('writingCellsTpl').replace('{n}', String(updates.length)));
      const resp = await msg('SHEETS_API_BATCH_WRITE', { spreadsheetId: ssId, updates });
      if (resp && resp.error) { showToast(t('errorPrefix') + resp.error); return; }
      pushUndo({ ssId, batch: undoEntries });
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
        // Empty target cell: search using the row's source. Cache first,
        // then fall back to a Sheets read for the row.
        const refMatch2 = ref ? ref.match(/(\d+)/i) : null;
        const rowNum2 = refMatch2 ? refMatch2[1] : null;
        if (rowNum2 && rowNum2 in _sourceCache) {
          const cached = _sourceCache[rowNum2];
          if (cached) {
            doSearch(cached);
          } else {
            const rs = s.getElementById('results');
            if (rs) rs.innerHTML = `<div class="empty">${t('emptySourceRow')}</div>`;
          }
        } else if (rowNum2) {
          fetchSourceForRow(rowNum2);
          const rs = s.getElementById('results');
          if (rs) rs.innerHTML = `<div class="empty">${t('loadingSource')}</div>`;
        } else {
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
    if (m.type === 'SETTINGS_UPDATED' && m.settings) {
      Object.assign(settings, m.settings);
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
  });

  // === Sync with data changes (from manage page, via broadcast) ===
  // IndexedDB has no onChanged event, so manage page broadcasts DATA_CHANGED
  chrome.runtime.onMessage.addListener((m2) => {
    if (m2.type === 'DATA_CHANGED') {
      // Re-fetch all three in parallel, then run a single doSearch so
      // the card picks up TM, glossary, and rule changes atomically.
      // Without the single doSearch at the end, adding a glossary
      // entry from the side panel or via right-click would leave the
      // active card painted red / underlined even though the new
      // entry would now resolve it.
      Promise.all([
        msg('TM_LOAD').then(data => { tmData = data || []; }),
        msg('GLOSSARY_LOAD').then(data => { glossaryData = data || []; }),
        msg('RULES_LOAD').then(data => { rulesData = data || []; }),
      ]).then(() => {
        updateBadge();
        if (lastCellValue) doSearch();
      });
    }
    if (m2.type === 'AUTH_CHANGED') {
      const s = getShadow();
      const banner = s && s.getElementById('auth-banner');
      if (banner) banner.classList.toggle('visible', !m2.signedIn);
    }
    if (m2.type === 'SETTINGS_CHANGED') {
      msg('SETTINGS_LOAD').then(data => {
        if (data && Object.keys(data).length) {
          const oldSourceCol = settings.sourceCol;
          const oldMinScore = settings.minScore;
          Object.assign(settings, data);
          applyPanelLang();
          const s = getShadow();
          if (s) {
            s.getElementById('min-score').value = String(settings.minScore || 0.7);
          }
          if (settings.sourceCol !== oldSourceCol) {
            _sourceCache = {};
            preloadSourceCache();
          }
          // If the threshold or source column changed, current results
          // are stale — rerun so the visible card reflects the new
          // settings without waiting for the translator to touch a
          // different cell.
          if ((settings.minScore !== oldMinScore || settings.sourceCol !== oldSourceCol) && lastCellValue) {
            doSearch();
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
