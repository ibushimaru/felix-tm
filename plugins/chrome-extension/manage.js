/**
 * Manage page — TM/Glossary management, import/export, settings.
 * Opened as a popup window from the floating panel's ⚙ button.
 * Storage via chrome.storage.local (shared with content script).
 */

let tmData = [];
let glossaryData = [];
let settings = { sourceCol: 'A', targetCol: 'B', minScore: 0.7, lang: 'en' };

// ============================================================
// i18n
// ============================================================

const I18N = {
  en: {
    tm: 'TM', glossary: 'Glossary', settings: 'Settings',
    register: 'Register', registerToTM: 'Register to TM',
    source: 'Source', target: 'Target', registered: 'Registered!',
    alreadyExists: 'Already exists (refcount +1)',
    import: 'Import', bulkDesc: 'Select source+target columns in the sheet, copy (Ctrl+C), then click Import.',
    pasteImport: 'Paste from Clipboard', imported: 'Imported',
    browseTM: 'Browse TM', filter: 'Filter...',
    addTerm: 'Add Term', termSrc: 'Term (source)', termTgt: 'Translation',
    add: 'Add', browse: 'Browse',
    glossImport: 'Import', glossDesc: 'Select term+translation columns, copy (Ctrl+C), then click Import.',
    dropFile: 'Drop TMX/TSV file',
    export: 'Export', exportTM: 'Export TM as TSV', exportGloss: 'Export Glossary as TSV',
    save: 'Save', saved: 'Saved!',
    danger: 'Danger Zone', clearTM: 'Clear TM', clearGloss: 'Clear Glossary',
    confirmClear: 'Delete all entries? This cannot be undone.',
  },
  ja: {
    tm: 'TM', glossary: '用語集', settings: '設定',
    register: '登録', registerToTM: 'TMに登録',
    source: '原文', target: '訳文', registered: '登録しました',
    alreadyExists: '既に存在 (refcount +1)',
    import: 'インポート', bulkDesc: 'シートで原文+訳文列を選択し、コピー(Ctrl+C)してインポート',
    pasteImport: 'クリップボードから貼り付け', imported: 'インポート完了',
    browseTM: 'TMブラウズ', filter: 'フィルタ...',
    addTerm: '用語を追加', termSrc: '用語（原文）', termTgt: '訳語',
    add: '追加', browse: 'ブラウズ',
    glossImport: 'インポート', glossDesc: '用語+訳語列を選択し、コピー(Ctrl+C)してインポート',
    dropFile: 'TMX/TSVファイルをドロップ',
    export: 'エクスポート', exportTM: 'TMをTSVでエクスポート', exportGloss: '用語集をTSVでエクスポート',
    save: '保存', saved: '保存しました',
    danger: '危険な操作', clearTM: 'TMを全削除', clearGloss: '用語集を全削除',
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
  set('tab-tm', t('tm'));
  set('tab-glossary', t('glossary'));
  set('tab-settings', t('settings'));
  // TM
  set('h-register', t('registerToTM'));
  set('btn-register', t('register'));
  ph('reg-source', t('source'));
  ph('reg-target', t('target'));
  set('h-build', t('import'));
  set('p-bulk-desc', t('bulkDesc'));
  set('btn-paste-import', t('pasteImport'));
  set('h-browse-tm', t('browseTM'));
  ph('tm-filter', t('filter'));
  set('drop-text', t('dropFile'));
  set('h-export', t('export'));
  set('btn-export-tm', t('exportTM'));
  // Glossary
  set('h-add-term', t('addTerm'));
  ph('gloss-term', t('termSrc'));
  ph('gloss-trans', t('termTgt'));
  set('btn-add-gloss', t('add'));
  set('h-gloss-import', t('glossImport'));
  set('p-gloss-desc', t('glossDesc'));
  set('btn-paste-gloss', t('pasteImport'));
  set('h-browse-gloss', t('browse'));
  set('btn-export-gloss', t('exportGloss'));
  // Settings
  set('h-settings', t('settings'));
  set('btn-save-settings', t('save'));
  set('h-danger', t('danger'));
  set('btn-clear-tm', t('clearTM'));
  set('btn-clear-gloss', t('clearGloss'));
}

// ============================================================
// Init
// ============================================================

async function init() {
  settings = await sendBg('SETTINGS_LOAD') || settings;
  tmData = await sendBg('TM_LOAD') || [];
  glossaryData = await sendBg('GLOSSARY_LOAD') || [];
  updateStats();
  applyLang();
  loadSettingsUI();
  renderTMList();

  // Setup tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.panel).classList.add('active');
      if (tab.dataset.panel === 'tm') renderTMList();
      if (tab.dataset.panel === 'glossary') renderGlossaryList();
    });
  });

  // Listen for storage changes from content script (e.g. Set registered new TM)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.felixTM) { tmData = changes.felixTM.newValue || []; updateStats(); renderTMList(); }
    if (changes.felixGlossary) { glossaryData = changes.felixGlossary.newValue || []; updateStats(); renderGlossaryList(); }
    if (changes.felixSettings) { settings = changes.felixSettings.newValue || settings; applyLang(); loadSettingsUI(); }
  });
}

// ============================================================
// TM Operations
// ============================================================

async function registerTM() {
  const source = document.getElementById('reg-source').value.trim();
  const target = document.getElementById('reg-target').value.trim();
  if (!source || !target) return;

  const action = FelixEngine.addEntry(tmData, source, target);
  await saveTM();
  updateStats();
  renderTMList();

  showToast('reg-toast', action === 'refcount' ? t('alreadyExists') : t('registered'));
  document.getElementById('reg-target').value = '';
}

async function pasteImport() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      showToast('bulk-toast', 'No data in clipboard');
      return;
    }

    const lines = text.split('\n');
    let added = 0, updated = 0, skipped = 0;

    const firstLine = lines[0].split('\t');
    const startIdx = (firstLine.length >= 2 &&
      /^(source|原文|en|src)/i.test(firstLine[0].trim())) ? 1 : 0;

    for (let i = startIdx; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
        const action = FelixEngine.addEntry(tmData, parts[0].trim(), parts[1].trim());
        if (action === 'added') added++;
        else updated++;
      } else {
        skipped++;
      }
    }

    await saveTM();
    updateStats();
    renderTMList();

    document.getElementById('paste-preview').textContent = `${lines.length - startIdx} rows parsed`;
    showToast('bulk-toast',
      `${t('imported')}: ${added} new, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}`
    );
  } catch (err) {
    showToast('bulk-toast', 'Clipboard access denied');
  }
}

async function saveTM() {
  await sendBg('TM_SAVE', tmData);
}

function renderTMList() {
  const filter = (document.getElementById('tm-filter').value || '').toLowerCase();
  const el = document.getElementById('tm-list');
  const countEl = document.getElementById('tm-list-count');

  let filtered = tmData;
  if (filter) {
    filtered = tmData.filter(e =>
      e.source.toLowerCase().includes(filter) ||
      e.target.toLowerCase().includes(filter)
    );
  }

  const showing = filtered.slice(0, 100);
  countEl.textContent = `${showing.length} / ${tmData.length} entries`;

  if (!showing.length) {
    el.innerHTML = '<div class="empty">No entries</div>';
    return;
  }

  el.innerHTML = showing.map((e) => {
    const ref = e.refcount ? ` <span style="color:#9aa0a6">(${e.refcount}x)</span>` : '';
    const idx = tmData.indexOf(e);
    return `<div class="match" style="cursor:default;padding:8px;position:relative" data-tm-idx="${idx}">
      <span style="position:absolute;top:6px;right:8px;font-size:11px;color:#ea4335;cursor:pointer" data-tm-del="${idx}">✕</span>
      <div class="match-source">${escH(e.source)}${ref}</div>
      <div class="match-target">${escH(e.target)}</div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-tm-del]').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-tm-del'));
      tmData.splice(idx, 1);
      await saveTM();
      updateStats();
      renderTMList();
    });
  });
}

// ============================================================
// Glossary Operations
// ============================================================

async function addGlossary() {
  const term = document.getElementById('gloss-term').value.trim();
  const trans = document.getElementById('gloss-trans').value.trim();
  if (!term || !trans) return;

  const tCmp = FelixEngine.makeCmp(term);
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

async function pasteGlossary() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      showToast('gloss-toast', 'No data in clipboard');
      return;
    }

    const lines = text.split('\n');
    const startIdx = (lines[0] && /^(term|用語|source|en|src)/i.test(lines[0].split('\t')[0].trim())) ? 1 : 0;
    let added = 0, dup = 0;

    for (let i = startIdx; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
        const term = parts[0].trim();
        const trans = parts[1].trim();
        const notes = parts.length >= 3 ? parts[2].trim() : '';
        const tCmp = FelixEngine.makeCmp(term);

        const exists = glossaryData.some(e =>
          (e.cmp || FelixEngine.makeCmp(e.term)) === tCmp &&
          FelixEngine.makeCmp(e.translation) === FelixEngine.makeCmp(trans)
        );

        if (!exists) {
          glossaryData.push({ term, translation: trans, notes, cmp: tCmp });
          added++;
        } else {
          dup++;
        }
      }
    }

    await sendBg('GLOSSARY_SAVE', glossaryData);
    updateStats();
    renderGlossaryList();
    showToast('gloss-toast', `${added} added, ${dup} duplicates`);
  } catch (err) {
    showToast('gloss-toast', 'Clipboard access denied');
  }
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
    if (ext === 'tmx') importTMX(text);
    else importTSV(text);
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
      if (src && tgt) { FelixEngine.addEntry(tmData, src, tgt); added++; }
    }
  });

  saveTM();
  updateStats();
  renderTMList();
  showToast('import-toast', `Imported ${added} entries from TMX`);
}

function importTSV(text) {
  const lines = text.split('\n');
  let added = 0;
  const startLine = (lines[0] && lines[0].toLowerCase().includes('source')) ? 1 : 0;

  for (let i = startLine; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      FelixEngine.addEntry(tmData, parts[0].trim(), parts[1].trim());
      added++;
    }
  }

  saveTM();
  updateStats();
  renderTMList();
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

function updateStats() {
  document.getElementById('stats-badge').textContent = `TM: ${tmData.length} | Gloss: ${glossaryData.length}`;
}

function showToast(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
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
  document.getElementById('set-shortcut-get').value = settings.shortcutGet || 'Cmd+Shift+J';
  document.getElementById('set-shortcut-set').value = settings.shortcutSet || 'Cmd+Shift+U';
}

async function saveSettingsUI() {
  settings.lang = document.getElementById('set-lang').value;
  settings.sourceCol = document.getElementById('set-source-col').value.toUpperCase();
  settings.targetCol = document.getElementById('set-target-col').value.toUpperCase();
  settings.minScore = parseFloat(document.getElementById('set-min-score').value);
  settings.shortcutGet = document.getElementById('set-shortcut-get').value;
  settings.shortcutSet = document.getElementById('set-shortcut-set').value;
  await sendBg('SETTINGS_SAVE', settings);
  // Notify content script of changes
  chrome.runtime.sendMessage({
    type: 'BROADCAST',
    payload: { type: 'SETTINGS_UPDATED', settings },
  }).catch(() => {});
  applyLang();
  showToast('settings-toast', t('saved'));
}

async function clearAllTM() {
  if (!confirm(t('confirmClear'))) return;
  tmData = [];
  await saveTM();
  updateStats();
  renderTMList();
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

function escH(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ============================================================
// Event Bindings
// ============================================================

document.getElementById('btn-register').addEventListener('click', () => registerTM());
document.getElementById('btn-paste-import').addEventListener('click', () => pasteImport());
document.getElementById('tm-filter').addEventListener('input', () => renderTMList());
document.getElementById('btn-add-gloss').addEventListener('click', () => addGlossary());
document.getElementById('btn-export-tm').addEventListener('click', () => exportTSV());
document.getElementById('btn-paste-gloss').addEventListener('click', () => pasteGlossary());
document.getElementById('btn-export-gloss').addEventListener('click', () => exportGlossaryTSV());
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
