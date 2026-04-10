/**
 * Side Panel logic — TM search, registration, glossary management.
 * All search is client-side (instant). Storage via chrome.storage.local.
 */

let tmData = [];
let glossaryData = [];
let lastSearchValue = '';
let settings = { sourceCol: 'A', targetCol: 'B', minScore: 0.7, lang: 'en' };

// ============================================================
// i18n
// ============================================================

const I18N = {
  en: {
    search: 'Search', tm: 'TM', glossary: 'Glossary',
    activeCell: 'Active Cell', selectCell: 'Select a cell to auto-search',
    noMatch: 'No matches', registerToTM: 'Register to TM',
    source: 'Source', target: 'Target', registered: 'Registered!',
    alreadyExists: 'Already exists (refcount +1)',
    buildTM: 'Build TM from Sheet', bulkDesc: 'Paste TSV data (source[TAB]target per line) to bulk import.',
    bulkImport: 'Bulk Import', imported: 'Imported',
    addTerm: 'Add Term', termSrc: 'Term (source)', termTgt: 'Translation',
    add: 'Add', added: 'Added!', dupGloss: 'Already exists', noGloss: 'No glossary entries',
    importTM: 'Import TM', dropFile: 'Drop file here or click to browse',
    export: 'Export', exportTM: 'Export TM as TSV', exportGloss: 'Export Glossary as TSV',
    settings: 'Settings', save: 'Save', saved: 'Saved!',
    clearTM: 'Clear all TM', clearGloss: 'Clear all Glossary',
    confirmClear: 'Delete all entries? This cannot be undone.',
  },
  ja: {
    search: '検索', tm: 'TM', glossary: '用語集',
    activeCell: 'アクティブセル', selectCell: 'セルを選択すると自動検索します',
    noMatch: 'マッチなし', registerToTM: 'TMに登録',
    source: '原文', target: '訳文', registered: '登録しました',
    alreadyExists: '既に存在 (refcount +1)',
    buildTM: 'シートからTMを構築', bulkDesc: 'TSVデータを貼り付けて一括インポート（原文[TAB]訳文、1行ずつ）',
    bulkImport: '一括インポート', imported: 'インポート完了',
    addTerm: '用語を追加', termSrc: '用語（原文）', termTgt: '訳語',
    add: '追加', added: '追加しました', dupGloss: '既に登録済み', noGloss: '用語集は空です',
    importTM: 'TMインポート', dropFile: 'ここにファイルをドロップ、またはクリック',
    export: 'エクスポート', exportTM: 'TMをTSVでエクスポート', exportGloss: '用語集をTSVでエクスポート',
    settings: '設定', save: '保存', saved: '保存しました',
    clearTM: 'TMを全削除', clearGloss: '用語集を全削除',
    confirmClear: '全エントリを削除しますか？この操作は元に戻せません。',
  },
};

function t(key) {
  return (I18N[settings.lang] && I18N[settings.lang][key]) || I18N.en[key] || key;
}

function applyLang() {
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const ph = (id, text) => { const el = document.getElementById(id); if (el) el.placeholder = text; };

  // Tabs
  set('tab-search', t('search'));
  set('tab-tm', t('tm'));
  set('tab-glossary', t('glossary'));
  // Cell preview
  set('lbl-active-cell', t('activeCell'));
  // Search
  set('empty-search', t('selectCell'));
  // Register
  set('h-register', t('registerToTM'));
  ph('reg-source', t('source'));
  ph('reg-target', t('target'));
  set('btn-register', t('register'));
  set('h-build', t('buildTM'));
  set('p-bulk-desc', t('bulkDesc'));
  set('btn-bulk', t('bulkImport'));
  // Glossary
  set('h-add-term', t('addTerm'));
  ph('gloss-term', t('termSrc'));
  ph('gloss-trans', t('termTgt'));
  set('btn-add-gloss', t('add'));
  // Import
  set('h-import', t('importTM'));
  set('drop-text', t('dropFile'));
  set('h-export', t('export'));
  set('btn-export-tm', t('exportTM'));
  set('btn-export-gloss', t('exportGloss'));
  // Settings
  set('h-settings', t('settings'));
  set('btn-save-settings', t('save'));
  set('btn-clear-tm', t('clearTM'));
  set('btn-clear-gloss', t('clearGloss'));
}

// ============================================================
// Init
// ============================================================

async function init() {
  // Load settings, TM and glossary from storage
  settings = await sendBg('SETTINGS_LOAD') || settings;
  tmData = await sendBg('TM_LOAD') || [];
  glossaryData = await sendBg('GLOSSARY_LOAD') || [];
  updateStats();
  applyLang();
  loadSettingsUI();

  // Setup tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.panel).classList.add('active');
    });
  });

  // Listen for messages
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'CELL_CHANGED') {
      onCellChanged(msg.value, msg.ref);
    }
    if (msg.type === 'INSERT_TOP_MATCH') {
      insertTopMatch();
    }
    if (msg.type === 'SET_TO_TM') {
      setToTM();
    }
  });

  // Auto-inject content script and get initial cell
  try {
    await sendBg('ENSURE_CONTENT_SCRIPT');
    setTimeout(async () => {
      const resp = await sendBgPayload('GET_CELL');
      if (resp && resp.value) onCellChanged(resp.value, resp.ref);
    }, 1000);
  } catch (_) {}
}

// ============================================================
// Cell Change Handler — Real-time search
// ============================================================

function onCellChanged(value, ref) {
  document.getElementById('cell-value').textContent = value || '—';
  document.getElementById('cell-ref').textContent = ref ? `(${ref})` : '';

  // Auto-fill register fields
  document.getElementById('reg-source').value = value || '';

  // Auto-search if value changed
  if (value && value !== lastSearchValue) {
    lastSearchValue = value;
    doSearch(value);
  }
}

function doSearch(query) {
  if (!query) query = document.getElementById('cell-value').textContent;
  if (!query || query === '—') return;

  const minScore = parseFloat(document.getElementById('min-score').value);
  const searchType = document.getElementById('search-type').value;

  const t0 = performance.now();

  let matches;
  if (searchType === 'glossary') {
    matches = FelixEngine.glossarySearch(query, glossaryData);
  } else {
    matches = FelixEngine.search(query, tmData, minScore);
  }

  const ms = (performance.now() - t0).toFixed(1);
  renderResults(matches, ms);
}

function renderResults(matches, ms) {
  const el = document.getElementById('results');
  if (!matches || !matches.length) {
    el.innerHTML = `<div class="empty">No matches${ms ? ` (${ms}ms)` : ''}</div>`;
    return;
  }

  el.innerHTML = matches.map((m, i) => {
    const pct = Math.round(m.score * 100);
    const cls = pct >= 90 ? 'score-high' : pct >= 70 ? 'score-mid' : 'score-low';
    const meta = m.refcount ? `used ${m.refcount}x` : '';
    return `<div class="match" data-idx="${i}" data-target="${esc(m.target)}">
      <span class="score ${cls}">${pct}%</span>
      ${ms && i === 0 ? `<span style="float:right;font-size:10px;color:#9aa0a6">${ms}ms</span>` : ''}
      <div class="match-source">${escH(m.source)}</div>
      <div class="match-target">${escH(m.target)}</div>
      ${meta ? `<div class="match-meta">${meta}</div>` : ''}
    </div>`;
  }).join('');

  // Click to insert
  el.querySelectorAll('.match').forEach(el => {
    el.addEventListener('click', () => insertMatch(el));
  });
}

/**
 * Get (Felix-style): Insert match into target cell. Does NOT register to TM.
 * Translator should review and modify the translation, then explicitly Set.
 */
async function insertMatch(el) {
  const target = el.getAttribute('data-target');
  el.classList.add('inserted');

  // Write to target column cell only — no TM registration
  chrome.runtime.sendMessage({
    type: 'WRITE_TO_SHEET',
    value: target,
    targetCol: settings.targetCol || 'B',
  });
}

/** Insert the top match — called by keyboard shortcut (Cmd+Shift+S = Get) */
async function insertTopMatch() {
  const firstMatch = document.querySelector('.match');
  if (firstMatch) {
    await insertMatch(firstMatch);
  }
}

/**
 * Set (Felix-style): Register current source+target pair to TM.
 * Called explicitly by the translator after reviewing the translation.
 * Reads the actual cell values from the sheet (source col + target col).
 */
async function setToTM() {
  // Read current source from active cell preview
  const source = lastSearchValue;
  if (!source) return;

  // Read target from sheet (the translator may have edited it)
  const resp = await sendBgPayload('GET_TARGET_CELL');
  const target = resp && resp.value ? resp.value : '';

  if (!target) {
    showToast('results', '<div class="toast" style="background:#fce8e6;color:#c5221f">Target cell is empty</div>');
    return;
  }

  const action = addToTMInternal(source, target);
  await saveTM();
  updateStats();

  const msg = action === 'refcount' ? t('alreadyExists') : t('registered');
  showToast('results', '<div class="toast">' + msg + ': ' + escH(source.substring(0, 30)) + '...</div>');
}

// ============================================================
// TM Operations
// ============================================================

function addToTMInternal(source, target, context) {
  const sCmp = FelixEngine.makeCmp(source);
  const tCmp = FelixEngine.makeCmp(target);

  // Dedup check
  for (const entry of tmData) {
    if ((entry.cmp || FelixEngine.makeCmp(entry.source)) === sCmp &&
        FelixEngine.makeCmp(entry.target) === tCmp) {
      entry.refcount = (entry.refcount || 0) + 1;
      return 'refcount';
    }
  }

  tmData.push({
    source, target, context: context || '',
    cmp: sCmp, refcount: 0,
  });
  return 'added';
}

async function registerTM() {
  const source = document.getElementById('reg-source').value.trim();
  const target = document.getElementById('reg-target').value.trim();
  if (!source || !target) return;

  const action = addToTMInternal(source, target);
  await saveTM();
  updateStats();

  showToast('reg-toast', action === 'refcount' ? 'Already exists (refcount +1)' : 'Registered!');
  document.getElementById('reg-target').value = '';
}

async function pasteImport() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      showToast('bulk-toast', t('noData') || 'No data in clipboard');
      return;
    }

    const lines = text.split('\n');
    let added = 0, updated = 0, skipped = 0;

    // Detect if first line is a header
    const firstLine = lines[0].split('\t');
    const startIdx = (firstLine.length >= 2 &&
      /^(source|原文|en|src)/i.test(firstLine[0].trim())) ? 1 : 0;

    for (let i = startIdx; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
        const action = addToTMInternal(parts[0].trim(), parts[1].trim());
        if (action === 'added') added++;
        else updated++;
      } else {
        skipped++;
      }
    }

    await saveTM();
    updateStats();

    const preview = document.getElementById('paste-preview');
    preview.textContent = `${lines.length - startIdx} rows parsed`;

    showToast('bulk-toast',
      `${t('imported') || 'Imported'}: ${added} ${t('added') || 'new'}, ${updated} ${t('alreadyExists') ? 'updated' : 'updated'}${skipped ? `, ${skipped} skipped` : ''}`
    );

    // Re-search current cell with new TM
    if (lastSearchValue) doSearch(lastSearchValue);

  } catch (err) {
    showToast('bulk-toast', 'Clipboard access denied. Try Ctrl+V in the text area below.');
  }
}

async function saveTM() {
  await sendBg('TM_SAVE', tmData);
}

// ============================================================
// Glossary Operations
// ============================================================

async function addGlossary() {
  const term = document.getElementById('gloss-term').value.trim();
  const trans = document.getElementById('gloss-trans').value.trim();
  if (!term || !trans) return;

  const tCmp = FelixEngine.makeCmp(term);

  // Dedup
  const exists = glossaryData.some(e =>
    (e.cmp || FelixEngine.makeCmp(e.term)) === tCmp &&
    FelixEngine.makeCmp(e.translation) === FelixEngine.makeCmp(trans)
  );

  if (!exists) {
    glossaryData.push({ term, translation: trans, notes: '', cmp: tCmp });
    await sendBg('GLOSSARY_SAVE', glossaryData);
    updateStats();
    showToast('gloss-toast', 'Added!');
  } else {
    showToast('gloss-toast', 'Already exists');
  }

  document.getElementById('gloss-term').value = '';
  document.getElementById('gloss-trans').value = '';
  renderGlossaryList();
}

function renderGlossaryList() {
  const el = document.getElementById('gloss-list');
  if (!glossaryData.length) {
    el.innerHTML = '<div class="empty">No glossary entries</div>';
    return;
  }
  el.innerHTML = glossaryData.map((g, i) =>
    `<div class="match" style="cursor:default">
      <div class="match-source">${escH(g.term)}</div>
      <div class="match-target">${escH(g.translation)}</div>
      <span style="float:right;font-size:11px;color:#ea4335;cursor:pointer" data-del="${i}">✕</span>
    </div>`
  ).join('');

  el.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-del'));
      glossaryData.splice(idx, 1);
      await sendBg('GLOSSARY_SAVE', glossaryData);
      updateStats();
      renderGlossaryList();
    });
  });
}

// ============================================================
// File Import
// ============================================================

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'tmx') {
      importTMX(text);
    } else {
      importTSV(text);
    }
  };
  reader.readAsText(file, 'utf-8');
}

function importTMX(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const tus = doc.querySelectorAll('tu');
  let added = 0;

  tus.forEach(tu => {
    const tuvs = tu.querySelectorAll('tuv');
    if (tuvs.length >= 2) {
      const src = tuvs[0].querySelector('seg')?.textContent || '';
      const tgt = tuvs[1].querySelector('seg')?.textContent || '';
      if (src && tgt) {
        addToTMInternal(src, tgt);
        added++;
      }
    }
  });

  saveTM();
  updateStats();
  showToast('import-toast', `Imported ${added} entries from TMX`);
}

function importTSV(text) {
  const lines = text.split('\n');
  let added = 0;
  const startLine = (lines[0] && lines[0].toLowerCase().includes('source')) ? 1 : 0;

  for (let i = startLine; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      addToTMInternal(parts[0].trim(), parts[1].trim());
      added++;
    }
  }

  saveTM();
  updateStats();
  showToast('import-toast', `Imported ${added} entries from TSV`);
}

// ============================================================
// Export
// ============================================================

function exportTSV() {
  const lines = ['source\ttarget\tcontext\trefcount'];
  for (const e of tmData) {
    lines.push(`${e.source}\t${e.target}\t${e.context || ''}\t${e.refcount || 0}`);
  }
  downloadText(lines.join('\n'), 'felix-tm-export.tsv');
}

function exportGlossaryTSV() {
  const lines = ['term\ttranslation\tnotes'];
  for (const e of glossaryData) {
    lines.push(`${e.term}\t${e.translation}\t${e.notes || ''}`);
  }
  downloadText(lines.join('\n'), 'felix-glossary-export.tsv');
}

function downloadText(text, filename) {
  const blob = new Blob(['\uFEFF' + text], { type: 'text/tab-separated-values;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Utilities
// ============================================================

function sendBg(type, data) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type, data }, resolve);
  });
}

/** Send a message to the content script via background relay */
function sendBgPayload(contentType, extra) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({
      type: 'TO_CONTENT',
      payload: { type: contentType, targetCol: settings.targetCol || 'B', ...extra }
    }, resolve);
  });
}

function updateStats() {
  document.getElementById('stats-badge').innerHTML =
    `<span class="live-dot"></span>TM: ${tmData.length} | Gloss: ${glossaryData.length}`;
}

function showToast(elId, msg) {
  const el = document.getElementById(elId);
  el.innerHTML = `<div class="toast">${msg}</div>`;
  setTimeout(() => el.innerHTML = '', 3000);
}

// ============================================================
// Settings UI
// ============================================================

function loadSettingsUI() {
  document.getElementById('set-lang').value = settings.lang || 'en';
  document.getElementById('set-source-col').value = settings.sourceCol || 'A';
  document.getElementById('set-target-col').value = settings.targetCol || 'B';
  document.getElementById('set-min-score').value = String(settings.minScore || 0.7);
  document.getElementById('min-score').value = String(settings.minScore || 0.7);
}

async function saveSettingsUI() {
  settings.lang = document.getElementById('set-lang').value;
  settings.sourceCol = document.getElementById('set-source-col').value.toUpperCase();
  settings.targetCol = document.getElementById('set-target-col').value.toUpperCase();
  settings.minScore = parseFloat(document.getElementById('set-min-score').value);
  document.getElementById('min-score').value = String(settings.minScore);
  await sendBg('SETTINGS_SAVE', settings);
  applyLang();
  showToast('settings-toast', t('saved'));
}

async function clearAllTM() {
  if (!confirm(t('confirmClear'))) return;
  tmData = [];
  await saveTM();
  updateStats();
  showToast('settings-toast', 'TM cleared');
}

async function clearAllGlossary() {
  if (!confirm(t('confirmClear'))) return;
  glossaryData = [];
  await sendBg('GLOSSARY_SAVE', glossaryData);
  updateStats();
  renderGlossaryList();
  showToast('settings-toast', 'Glossary cleared');
}

async function showLogs() {
  const el = document.getElementById('log-output');
  el.style.display = 'block';
  el.textContent = 'Loading...';
  const resp = await sendBgPayload('GET_LOGS');
  if (resp && resp.logs) {
    el.textContent = resp.logs.join('\n') || '(no logs)';
  } else {
    el.textContent = '(no response from content script)';
  }
}

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function escH(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ============================================================
// Event Bindings (no inline onclick — required by Manifest V3 CSP)
// ============================================================

document.getElementById('min-score').addEventListener('change', () => doSearch());
document.getElementById('search-type').addEventListener('change', () => doSearch());
document.getElementById('btn-register').addEventListener('click', () => registerTM());
document.getElementById('btn-paste-import').addEventListener('click', () => pasteImport());
document.getElementById('btn-add-gloss').addEventListener('click', () => addGlossary());
document.getElementById('btn-export-tm').addEventListener('click', () => exportTSV());
document.getElementById('btn-export-gloss').addEventListener('click', () => exportGlossaryTSV());
document.getElementById('btn-set-tm').addEventListener('click', () => setToTM());
document.getElementById('btn-save-settings').addEventListener('click', () => saveSettingsUI());
document.getElementById('btn-clear-tm').addEventListener('click', () => clearAllTM());
document.getElementById('btn-clear-gloss').addEventListener('click', () => clearAllGlossary());

// File drop zone
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = '#1a73e8'; });
dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = '#dadce0'; });
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.style.borderColor = '#dadce0'; handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

// Init
init();
