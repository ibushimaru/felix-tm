/**
 * Side panel — TM / Glossary / Rules management, import/export, settings.
 * Registered via manifest "side_panel.default_path"; opened from the flow
 * panel's ⚙ button or the extension icon. Storage via IndexedDB (shared
 * with content script through the background service worker).
 */

let tmData = [];
let glossaryData = [];
let rulesData = [];
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
    importFromSheet: 'Import from Sheet', sheetImportDesc: 'Import from the active Google Sheet using the configured source/target columns.',
    glossSheetImportDesc: 'Import from the active Google Sheet (column A=term, B=translation).',
    export: 'Export', exportTM: 'Export TM as TSV', exportTMX: 'Export TM as TMX', exportGloss: 'Export Glossary as TSV',
    rules: 'Rules', addRule: 'Add Rule', ruleSourceLabel: 'Source Pattern (regex)',
    ruleTargetLabel: 'Target Template (\\1, \\2...)', browseRules: 'Rules',
    ruleDesc: 'Rules use regex to replace formatted text (dates, currencies, etc.) in TM matches. The source pattern matches both the query and TM source; captured groups are substituted into the target template.',
    exportRules: 'Export Rules as TSV', ruleAdded: 'Rule added!', ruleExists: 'Rule already exists',
    invalidRegex: 'Invalid regex pattern',
    save: 'Save', saved: 'Saved!',
    tools: 'Tools',
    qcCheck: 'QC Check',
    qcDesc: 'Scan the TM for source/target issues. Click a result to view the row.',
    qcNumbers: 'Numbers', qcAllCaps: 'ALL CAPS', qcGlossary: 'Glossary',
    runQc: 'Run QC',
    qcClean: 'No issues found.',
    qcCount: '{n} issue(s) across {rows} row(s)',
    sr: 'Search & Replace',
    srDesc: 'Tags: source: trans: context: created-by: regex: <field>:* (replace whole field).',
    srFromPh: 'From — text or source:foo / regex:bar / source:*',
    srToPh: 'To — replacement text',
    find: 'Find', replaceAll: 'Replace All',
    srNoMatch: 'No matches.',
    srFoundN: 'Found {n} record(s)',
    srReplacedN: 'Replaced in {n} record(s)',
    danger: 'Danger Zone', clearTM: 'Clear TM', clearGloss: 'Clear Glossary',
    confirmClear: 'Delete all entries?', cancel: 'Cancel',
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
    importFromSheet: 'シートからインポート', sheetImportDesc: '現在のGoogleシートから設定済みの原文/訳文列を読み取ります。',
    glossSheetImportDesc: '現在のGoogleシートからインポート（A列=用語、B列=訳語）。',
    export: 'エクスポート', exportTM: 'TMをTSVでエクスポート', exportTMX: 'TMをTMXでエクスポート', exportGloss: '用語集をTSVでエクスポート',
    rules: 'ルール', addRule: 'ルールを追加', ruleSourceLabel: 'ソースパターン（正規表現）',
    ruleTargetLabel: 'ターゲットテンプレート（\\1, \\2...）', browseRules: 'ルール一覧',
    ruleDesc: 'ルールは正規表現を使い、TMマッチ内の書式付きテキスト（日付、通貨など）を置換します。ソースパターンがクエリとTMソース両方にマッチし、キャプチャグループがターゲットテンプレートに代入されます。',
    exportRules: 'ルールをTSVでエクスポート', ruleAdded: 'ルールを追加しました', ruleExists: '既に存在します',
    invalidRegex: '無効な正規表現です',
    save: '保存', saved: '保存しました',
    tools: 'ツール',
    qcCheck: 'QCチェック',
    qcDesc: 'TM の原文／訳文の問題をスキャン。結果クリックで該当行を表示。',
    qcNumbers: '数値', qcAllCaps: '全大文字', qcGlossary: '用語',
    runQc: 'QC実行',
    qcClean: '問題は見つかりませんでした。',
    qcCount: '{rows}行 / {n}件の問題',
    sr: '検索 & 置換',
    srDesc: 'タグ: source: trans: context: created-by: regex: <field>:* （フィールド全体置換）',
    srFromPh: '検索 — テキスト or source:foo / regex:bar / source:*',
    srToPh: '置換 — 置換後のテキスト',
    find: '検索', replaceAll: '一括置換',
    srNoMatch: '該当なし。',
    srFoundN: '{n} 件ヒット',
    srReplacedN: '{n} 件を置換',
    danger: '危険な操作', clearTM: 'TMを全削除', clearGloss: '用語集を全削除',
    confirmClear: '全エントリを削除しますか？', cancel: 'キャンセル',
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
  set('btn-import-sheet', t('importFromSheet'));
  set('p-sheet-import-desc', t('sheetImportDesc'));
  set('p-gloss-sheet-desc', t('glossSheetImportDesc'));
  set('btn-import-gloss-sheet', t('importFromSheet'));
  set('h-browse-tm', t('browseTM'));
  ph('tm-filter', t('filter'));
  set('drop-text', t('dropFile'));
  set('h-export', t('export'));
  set('btn-export-tm', t('exportTM'));
  set('btn-export-tmx', t('exportTMX'));
  // Glossary
  set('h-add-term', t('addTerm'));
  ph('gloss-term', t('termSrc'));
  ph('gloss-trans', t('termTgt'));
  set('btn-add-gloss', t('add'));
  set('h-gloss-import', t('glossImport'));
  set('h-browse-gloss', t('browse'));
  set('btn-export-gloss', t('exportGloss'));
  // Rules
  set('tab-rules', t('rules'));
  set('h-add-rule', t('addRule'));
  set('lbl-rule-src', t('ruleSourceLabel'));
  set('lbl-rule-tgt', t('ruleTargetLabel'));
  set('btn-add-rule', t('add'));
  set('h-browse-rules', t('browseRules'));
  set('p-rule-desc', t('ruleDesc'));
  set('btn-export-rules', t('exportRules'));
  // Tools
  set('tab-tools', t('tools'));
  set('h-qc', t('qcCheck'));
  set('p-qc-desc', t('qcDesc'));
  set('lbl-qc-numbers', t('qcNumbers'));
  set('lbl-qc-allcaps', t('qcAllCaps'));
  set('lbl-qc-glossary', t('qcGlossary'));
  set('btn-run-qc', t('runQc'));
  set('h-sr', t('sr'));
  set('p-sr-desc', t('srDesc'));
  ph('sr-from', t('srFromPh'));
  ph('sr-to', t('srToPh'));
  set('btn-sr-find', t('find'));
  set('btn-sr-replace', t('replaceAll'));
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

// Reflect the currently selected Sheet range into the Import-from-Sheet inputs.
// Handles single cells (A5), column ranges (A2:A), and rectangles (A2:B500).
function applySelectionToImportRanges(sel) {
  const m = sel.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/i);
  if (!m) return;
  const col1 = m[1].toUpperCase(), row1 = m[2] || '';
  const col2 = m[3] ? m[3].toUpperCase() : col1;
  const row2 = m[4] || '';
  const pairs = [
    ['import-src-range', 'import-tgt-range'],
    ['gloss-import-src-range', 'gloss-import-tgt-range'],
  ];
  for (const [srcId, tgtId] of pairs) {
    const srcEl = document.getElementById(srcId);
    const tgtEl = document.getElementById(tgtId);
    if (!srcEl || !tgtEl) continue;
    if (col1 !== col2) {
      srcEl.value = `${col1}${row1}:${col1}${row2}`;
      tgtEl.value = `${col2}${row1}:${col2}${row2}`;
    } else {
      srcEl.value = sel;
    }
  }
}

function applyGlossaryAction(payload) {
  if (!payload || !payload.term) return;
  const tabBtn = document.querySelector('.tab[data-panel="glossary"]');
  if (tabBtn) tabBtn.click();
  const termInput = document.getElementById('gloss-term');
  const transInput = document.getElementById('gloss-trans');
  const filterInput = document.getElementById('gloss-filter');
  if (payload.mode === 'browse') {
    // Browse — the caller wants to look the term up in existing entries,
    // not add a duplicate. Route to the filter and leave the add form
    // untouched so a half-finished add doesn't silently get wiped.
    if (filterInput) {
      filterInput.value = payload.term;
      filterInput.dispatchEvent(new Event('input', { bubbles: true }));
      filterInput.focus();
      filterInput.select();
    }
  } else {
    // Add — prefill the add form. prefillSide decides which field the
    // selection goes into; when omitted, default to the term field.
    // 'translation' is used by right-click-on-target flows where the
    // translator grabs the target-side text first and will type the
    // source-side term next.
    if (filterInput) filterInput.value = '';
    if (payload.prefillSide === 'translation') {
      if (transInput) transInput.value = payload.term;
      if (termInput) { termInput.value = ''; termInput.focus(); }
    } else {
      if (termInput) termInput.value = payload.term;
      if (transInput) { transInput.value = ''; transInput.focus(); }
    }
  }
}

async function consumePendingGlossaryAction() {
  try {
    const payload = await sendBg('CONSUME_PENDING_GLOSSARY_ACTION');
    if (payload) applyGlossaryAction(payload);
  } catch (_) {}
}

async function init() {
  settings = await sendBg('SETTINGS_LOAD') || settings;
  tmData = await sendBg('TM_LOAD') || [];
  glossaryData = await sendBg('GLOSSARY_LOAD') || [];
  rulesData = await sendBg('RULES_LOAD') || [];
  updateStats();
  applyLang();
  loadSettingsUI();
  renderTMList();

  // If the panel was just opened in response to an uncovered-term click,
  // consume the one-shot glossary action now. The background also sends
  // a GLOSSARY_ACTION broadcast for the already-open case, which the
  // message listener below handles.
  consumePendingGlossaryAction();

  // Ask content script for the current selection so Import range inputs
  // populate immediately instead of waiting for the next cell change.
  chrome.runtime.sendMessage({ type: 'GET_SELECTION' }, (resp) => {
    void chrome.runtime.lastError;
    if (resp && resp.ref) applySelectionToImportRanges(resp.ref);
  });

  // Setup tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.panel).classList.add('active');
      if (tab.dataset.panel === 'tm') renderTMList();
      if (tab.dataset.panel === 'glossary') renderGlossaryList();
      if (tab.dataset.panel === 'rules') renderRulesList();
    });
  });

  // Listen for data changes from content script (via broadcast)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'DATA_CHANGED') {
      // Reload from DB
      sendBg('TM_LOAD').then(data => { tmData = data || []; updateStats(); renderTMList(); });
      sendBg('GLOSSARY_LOAD').then(data => { glossaryData = data || []; updateStats(); renderGlossaryList(); });
      sendBg('RULES_LOAD').then(data => { rulesData = data || []; renderRulesList(); });
    }
    if (msg.type === 'SELECTION_CHANGED' && msg.ref) {
      applySelectionToImportRanges(msg.ref);
    }
    if (msg.type === 'GLOSSARY_ACTION' && msg.payload) {
      applyGlossaryAction(msg.payload);
    }
    if (msg.type === 'SETTINGS_CHANGED') {
      sendBg('SETTINGS_LOAD').then(data => { if (data && Object.keys(data).length) { settings = data; applyLang(); loadSettingsUI(); } });
    }
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

  showToast(action === 'refcount' ? t('alreadyExists') : t('registered'));
  document.getElementById('reg-target').value = '';
}

/**
 * Parse TSV/CSV text that may have quoted fields with embedded newlines.
 * Returns array of arrays (rows of columns).
 */
function parseTSV(text) {
  const rows = [];
  let i = 0;
  while (i < text.length) {
    const row = [];
    while (i < text.length) {
      if (text[i] === '"') {
        // Quoted field: read until closing quote (handle "" as escaped quote)
        i++; // skip opening quote
        let field = '';
        while (i < text.length) {
          if (text[i] === '"') {
            if (i + 1 < text.length && text[i + 1] === '"') {
              field += '"'; i += 2; // escaped quote
            } else {
              i++; break; // closing quote
            }
          } else {
            field += text[i++];
          }
        }
        row.push(field);
      } else {
        // Unquoted field: read until tab or newline
        let field = '';
        while (i < text.length && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i++];
        }
        row.push(field);
      }
      // After field: tab → next field, newline → end of row
      if (i < text.length && text[i] === '\t') { i++; continue; }
      // Skip \r\n or \n
      if (i < text.length && text[i] === '\r') i++;
      if (i < text.length && text[i] === '\n') i++;
      break;
    }
    if (row.length > 0 && row.some(f => f.trim())) rows.push(row);
  }
  return rows;
}

async function saveTM() {
  await sendBg('TM_SAVE', tmData);
  chrome.runtime.sendMessage({ type: 'BROADCAST', payload: { type: 'DATA_CHANGED' } }).catch(() => {});
}

async function saveGlossary() {
  await sendBg('GLOSSARY_SAVE', glossaryData);
  chrome.runtime.sendMessage({ type: 'BROADCAST', payload: { type: 'DATA_CHANGED' } }).catch(() => {});
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
      <span style="position:absolute;top:6px;right:8px;display:flex;gap:4px">
        <span style="font-size:13px;color:#1a73e8;cursor:pointer" data-tm-edit="${idx}" title="Edit">✎</span>
        <span style="font-size:13px;color:#ea4335;cursor:pointer" data-tm-del="${idx}" title="Delete">✕</span>
      </span>
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

  el.querySelectorAll('[data-tm-edit]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-tm-edit'));
      editTMEntry(idx);
    });
  });
}

function editTMEntry(idx) {
  const entry = tmData[idx];
  if (!entry) return;
  const div = document.querySelector(`[data-tm-idx="${idx}"]`);
  if (!div) return;

  div.innerHTML = `
    <input type="text" value="${escH(entry.source)}" style="width:100%;margin-bottom:4px;font-size:13px;padding:4px" data-field="source">
    <input type="text" value="${escH(entry.target)}" style="width:100%;margin-bottom:4px;font-size:13px;padding:4px" data-field="target">
    <div style="display:flex;gap:4px">
      <button class="btn btn-primary" style="flex:1;padding:3px 6px;font-size:12px" data-save>OK</button>
      <button class="btn" style="flex:1;padding:3px 6px;font-size:12px" data-cancel>Cancel</button>
    </div>`;

  div.querySelector('[data-save]').addEventListener('click', async () => {
    const newSrc = div.querySelector('[data-field="source"]').value.trim();
    const newTgt = div.querySelector('[data-field="target"]').value.trim();
    if (newSrc && newTgt) {
      entry.source = newSrc;
      entry.target = newTgt;
      entry.cmp = FelixEngine.makeCmp(newSrc);
      entry.targetCmp = FelixEngine.makeCmp(newTgt);
      entry.sourceLen = entry.cmp.length;
      await saveTM();
    }
    renderTMList();
  });
  div.querySelector('[data-cancel]').addEventListener('click', () => renderTMList());
}

// ============================================================
// Glossary Operations
// ============================================================

async function addGlossary() {
  const term = document.getElementById('gloss-term').value.trim();
  const trans = document.getElementById('gloss-trans').value.trim();
  if (!term || !trans) return;

  const action = FelixEngine.addGlossaryEntry(glossaryData, term, trans);
  if (action === 'added') {
    await saveGlossary();
    updateStats();
    showToast('Added!');
  } else {
    showToast('Already exists');
  }

  document.getElementById('gloss-term').value = '';
  document.getElementById('gloss-trans').value = '';
  renderGlossaryList();
}

function processGlossaryText(text) {
  if (!text || !text.trim()) return;
  const rows = parseTSV(text);
  const startIdx = (rows.length > 0 && rows[0].length >= 1 &&
    /^(term|用語|source|en|src)/i.test(rows[0][0].trim())) ? 1 : 0;
  let added = 0, dup = 0;
  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    if (row.length >= 2 && row[0].trim() && row[1].trim()) {
      const notes = row.length >= 3 ? row[2].trim() : '';
      const action = FelixEngine.addGlossaryEntry(glossaryData, row[0].trim(), row[1].trim(), notes);
      if (action === 'added') added++; else dup++;
    }
  }
  saveGlossary();
  updateStats();
  renderGlossaryList();
  showToast(`${added} added, ${dup} duplicates`);
}


function renderGlossaryList() {
  const filter = (document.getElementById('gloss-filter').value || '').toLowerCase();
  const el = document.getElementById('gloss-list');
  const countEl = document.getElementById('gloss-list-count');

  let filtered = glossaryData;
  if (filter) {
    filtered = glossaryData.filter(g =>
      g.term.toLowerCase().includes(filter) ||
      g.translation.toLowerCase().includes(filter)
    );
  }

  const showing = filtered.slice(0, 100);
  countEl.textContent = `${showing.length} / ${glossaryData.length} entries`;

  if (!showing.length) {
    el.innerHTML = '<div class="empty">No glossary entries</div>';
    return;
  }
  el.innerHTML = showing.map((g) => {
    const idx = glossaryData.indexOf(g);
    return `<div class="match" style="cursor:default;padding:8px;position:relative" data-gloss-idx="${idx}">
      <span style="position:absolute;top:6px;right:8px;display:flex;gap:4px">
        <span style="font-size:13px;color:#1a73e8;cursor:pointer" data-gloss-edit="${idx}" title="Edit">✎</span>
        <span style="font-size:13px;color:#ea4335;cursor:pointer" data-del="${idx}" title="Delete">✕</span>
      </span>
      <div class="match-source">${escH(g.term)}</div>
      <div class="match-target">${escH(g.translation)}</div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-del'));
      glossaryData.splice(idx, 1);
      await saveGlossary();
      updateStats();
      renderGlossaryList();
    });
  });

  el.querySelectorAll('[data-gloss-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-gloss-edit'));
      editGlossaryEntry(idx);
    });
  });
}

function editGlossaryEntry(idx) {
  const entry = glossaryData[idx];
  if (!entry) return;
  const div = document.querySelector(`[data-gloss-idx="${idx}"]`);
  if (!div) return;

  div.innerHTML = `
    <input type="text" value="${escH(entry.term)}" style="width:100%;margin-bottom:4px;font-size:13px;padding:4px" data-field="term">
    <input type="text" value="${escH(entry.translation)}" style="width:100%;margin-bottom:4px;font-size:13px;padding:4px" data-field="translation">
    <div style="display:flex;gap:4px">
      <button class="btn btn-primary" style="flex:1;padding:3px 6px;font-size:12px" data-save>OK</button>
      <button class="btn" style="flex:1;padding:3px 6px;font-size:12px" data-cancel>Cancel</button>
    </div>`;

  div.querySelector('[data-save]').addEventListener('click', async () => {
    const newTerm = div.querySelector('[data-field="term"]').value.trim();
    const newTrans = div.querySelector('[data-field="translation"]').value.trim();
    if (newTerm && newTrans) {
      entry.term = newTerm;
      entry.translation = newTrans;
      entry.cmp = FelixEngine.makeCmp(newTerm);
      await saveGlossary();
    }
    renderGlossaryList();
  });
  div.querySelector('[data-cancel]').addEventListener('click', () => renderGlossaryList());
}

// ============================================================
// Rules Operations
// ============================================================

async function addRule() {
  const srcPat = document.getElementById('rule-source').value.trim();
  const tgtTpl = document.getElementById('rule-target').value.trim();
  if (!srcPat || !tgtTpl) return;

  // Validate regex
  try { new RegExp(srcPat); } catch (_) {
    showToast(t('invalidRegex'));
    return;
  }

  // Check duplicate
  const exists = rulesData.some(r => r.sourcePattern === srcPat && r.targetTemplate === tgtTpl);
  if (exists) {
    showToast(t('ruleExists'));
    return;
  }

  rulesData.push({ sourcePattern: srcPat, targetTemplate: tgtTpl, enabled: true });
  await saveRules();
  renderRulesList();
  showToast(t('ruleAdded'));
  document.getElementById('rule-source').value = '';
  document.getElementById('rule-target').value = '';
}

async function saveRules() {
  await sendBg('RULES_SAVE', rulesData);
  chrome.runtime.sendMessage({ type: 'BROADCAST', payload: { type: 'DATA_CHANGED' } }).catch(() => {});
}

function renderRulesList() {
  const el = document.getElementById('rules-list');
  const countEl = document.getElementById('rules-list-count');
  countEl.textContent = `${rulesData.length} rules`;

  if (!rulesData.length) {
    el.innerHTML = '<div class="empty">No rules</div>';
    return;
  }

  el.innerHTML = rulesData.map((r, idx) => {
    const dimStyle = r.enabled === false ? 'opacity:0.5;' : '';
    const toggleLabel = r.enabled === false ? '▶' : '⏸';
    return `<div class="match" style="cursor:default;padding:8px;position:relative;${dimStyle}" data-rule-idx="${idx}">
      <span style="position:absolute;top:6px;right:8px;font-size:13px;color:#ea4335;cursor:pointer" data-rule-del="${idx}">✕</span>
      <span style="position:absolute;top:6px;right:26px;font-size:13px;color:#5f6368;cursor:pointer" data-rule-toggle="${idx}">${toggleLabel}</span>
      <div class="match-source" style="font-family:monospace;font-size:13px">${escH(r.sourcePattern)}</div>
      <div class="match-target" style="font-family:monospace;font-size:13px">→ ${escH(r.targetTemplate)}</div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-rule-del]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-rule-del'));
      rulesData.splice(idx, 1);
      await saveRules();
      renderRulesList();
    });
  });

  el.querySelectorAll('[data-rule-toggle]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-rule-toggle'));
      rulesData[idx].enabled = rulesData[idx].enabled === false ? true : false;
      await saveRules();
      renderRulesList();
    });
  });
}

function processRulesText(text) {
  if (!text || !text.trim()) return;
  const lines = text.split('\n');
  let added = 0, dup = 0, invalid = 0;
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      const srcPat = parts[0].trim();
      const tgtTpl = parts[1].trim();
      try { new RegExp(srcPat); } catch (_) { invalid++; continue; }
      const exists = rulesData.some(r => r.sourcePattern === srcPat && r.targetTemplate === tgtTpl);
      if (!exists) { rulesData.push({ sourcePattern: srcPat, targetTemplate: tgtTpl, enabled: true }); added++; }
      else { dup++; }
    }
  }
  saveRules();
  renderRulesList();
  showToast(`${added} added${dup ? `, ${dup} dup` : ''}${invalid ? `, ${invalid} invalid` : ''}`);
}

function exportRulesTSV() {
  const lines = ['source_pattern\ttarget_template\tenabled'];
  for (const r of rulesData) {
    lines.push(`${r.sourcePattern}\t${r.targetTemplate}\t${r.enabled !== false}`);
  }
  downloadText(lines.join('\n'), 'felix-rules-export.tsv');
}

// ============================================================
// Sheet Import (via Sheets API)
// ============================================================

async function getActiveSheetInfo() {
  // Ask the active Google Sheets tab for its spreadsheetId
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SHEET_INFO' }, (resp) => {
      resolve(resp || {});
    });
  });
}

async function readSheetRange(srcId, tgtId) {
  const srcRangeRaw = document.getElementById(srcId).value.trim() || 'A2:A';
  const tgtRangeRaw = document.getElementById(tgtId).value.trim() || 'B2:B';

  showToast('Reading from sheet...');

  const info = await getActiveSheetInfo();
  if (!info.spreadsheetId) {
    showToast('No active Google Sheet found. Open a spreadsheet first.');
    return null;
  }

  const prefix = info.sheetName && !srcRangeRaw.includes('!') ? `${info.sheetName}!` : '';
  const [srcResp, tgtResp] = await Promise.all([
    sendBg('SHEETS_API_READ_BATCH', { spreadsheetId: info.spreadsheetId, range: `${prefix}${srcRangeRaw}` }),
    sendBg('SHEETS_API_READ_BATCH', { spreadsheetId: info.spreadsheetId, range: `${prefix}${tgtRangeRaw}` }),
  ]);

  return { srcValues: srcResp?.values || [], tgtValues: tgtResp?.values || [] };
}

async function importFromSheet() {
  const data = await readSheetRange('import-src-range', 'import-tgt-range');
  if (!data) return;

  const len = Math.max(data.srcValues.length, data.tgtValues.length);
  let added = 0, updated = 0, skipped = 0;
  for (let i = 0; i < len; i++) {
    const src = (data.srcValues[i] || '').trim();
    const tgt = (data.tgtValues[i] || '').trim();
    if (src && tgt) {
      const action = FelixEngine.addEntry(tmData, src, tgt);
      if (action === 'added') added++;
      else updated++;
    } else { skipped++; }
  }

  await saveTM();
  updateStats();
  renderTMList();
  showToast(`${t('imported')}: ${added} new, ${updated} updated, ${skipped} skipped (${len} rows)`);
}

async function importGlossaryFromSheet() {
  const data = await readSheetRange('gloss-import-src-range', 'gloss-import-tgt-range');
  if (!data) return;

  const len = Math.max(data.srcValues.length, data.tgtValues.length);
  let added = 0, dup = 0;
  for (let i = 0; i < len; i++) {
    const term = (data.srcValues[i] || '').trim();
    const trans = (data.tgtValues[i] || '').trim();
    if (term && trans) {
      const action = FelixEngine.addGlossaryEntry(glossaryData, term, trans);
      if (action === 'added') added++; else dup++;
    }
  }

  await saveGlossary();
  updateStats();
  renderGlossaryList();
  showToast(`${added} added, ${dup} duplicates (${len} rows)`);
}

// ============================================================
// File Import
// ============================================================

function handleGlossaryFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    processGlossaryText(e.target.result);
  };
  reader.readAsText(file, 'utf-8');
}

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
  // Engine-side parser handles header srclang, x-context props,
  // multi-language TUs, and TUV inline tags. Carries metadata
  // (createdBy/modifiedBy/created/modified/refcount/context) onto
  // each addEntry call so audit info survives a round-trip.
  const { records } = FelixEngine.parseTmx(xml);
  let added = 0, dups = 0;
  for (const r of records) {
    if (!r.source || !r.target) continue;
    const status = FelixEngine.addEntry(tmData, r.source, r.target, {
      context: r.context || '',
      createdBy: r.createdBy || '',
      modifiedBy: r.modifiedBy || '',
      created: r.created || undefined,
      modified: r.modified || undefined,
    });
    if (status === 'added') added++;
    else dups++;
  }

  saveTM();
  updateStats();
  renderTMList();
  showToast(`Imported ${added} new entries from TMX${dups ? ` (${dups} dups skipped)` : ''}`);
}

function importTSV(text) {
  const rows = parseTSV(text);
  let added = 0;
  const startIdx = (rows.length > 0 && rows[0].length >= 1 &&
    /source/i.test(rows[0][0])) ? 1 : 0;

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    if (row.length >= 2 && row[0].trim() && row[1].trim()) {
      FelixEngine.addEntry(tmData, row[0].trim(), row[1].trim());
      added++;
    }
  }

  saveTM();
  updateStats();
  renderTMList();
  showToast(`Imported ${added} entries from TSV`);
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

function exportTMX() {
  // Engine serializer emits proper xml:lang tuvs, escapes entities,
  // and only writes optional attrs (creationid/changeid/usagecount)
  // when the record actually carries them.
  const xml = FelixEngine.serializeTmx(tmData, {
    sourceLang: (settings.sourceLang || 'en').toLowerCase(),
    targetLang: (settings.targetLang || 'ja').toLowerCase(),
    creationTool: 'Felix TM',
    creationToolVersion: '1.0',
  });
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'felix-tm-export.tmx'; a.click();
  URL.revokeObjectURL(url);
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

let _toastTimer = null;
function showToast(msg) {
  const container = document.getElementById('global-toast');
  if (!container) return;
  container.querySelector('div').textContent = msg;
  container.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { container.style.display = 'none'; }, 2000);
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
  chrome.runtime.sendMessage({
    type: 'BROADCAST',
    payload: { type: 'SETTINGS_CHANGED' },
  }).catch(() => {});
  applyLang();
  showToast(t('saved'));
}

function inlineConfirm(btnId, message, onConfirm) {
  const btn = document.getElementById(btnId);
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:4px;align-items:center;width:100%;margin-bottom:' + (btn.style.marginBottom || '0');
  div.innerHTML = `<span style="font-size:12px;color:#ea4335;flex:1">${escH(message)}</span>
    <button class="btn" style="padding:5px 10px;font-size:13px;color:#ea4335;border-color:#ea4335" data-ok>OK</button>
    <button class="btn" style="padding:5px 10px;font-size:13px" data-cancel>${t('cancel')}</button>`;
  function restore() { div.replaceWith(btn); }
  btn.replaceWith(div);
  div.querySelector('[data-ok]').addEventListener('click', () => { restore(); onConfirm(); });
  div.querySelector('[data-cancel]').addEventListener('click', restore);
}

function clearAllTM() {
  inlineConfirm('btn-clear-tm', t('confirmClear'), async () => {
    tmData = [];
    await saveTM();
    updateStats();
    renderTMList();
    showToast('TM cleared');
  });
}

function clearAllGlossary() {
  inlineConfirm('btn-clear-gloss', t('confirmClear'), async () => {
    glossaryData = [];
    await saveGlossary();
    updateStats();
    renderGlossaryList();
    showToast('Glossary cleared');
  });
}

function escH(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ============================================================
// Event Bindings
// ============================================================

document.getElementById('btn-register').addEventListener('click', () => registerTM());
document.getElementById('btn-import-sheet').addEventListener('click', () => importFromSheet());
document.getElementById('btn-import-gloss-sheet').addEventListener('click', () => importGlossaryFromSheet());
document.getElementById('tm-filter').addEventListener('input', () => renderTMList());
document.getElementById('btn-add-gloss').addEventListener('click', () => addGlossary());
document.getElementById('btn-export-tm').addEventListener('click', () => exportTSV());
document.getElementById('btn-export-tmx').addEventListener('click', () => exportTMX());
document.getElementById('gloss-filter').addEventListener('input', () => renderGlossaryList());
document.getElementById('btn-export-gloss').addEventListener('click', () => exportGlossaryTSV());

// Glossary file drop
const glossDropZone = document.getElementById('gloss-drop-zone');
const glossFileInput = document.getElementById('gloss-file-input');
glossDropZone.addEventListener('click', () => glossFileInput.click());
glossDropZone.addEventListener('dragover', e => { e.preventDefault(); glossDropZone.style.borderColor = '#1a73e8'; });
glossDropZone.addEventListener('dragleave', () => { glossDropZone.style.borderColor = '#dadce0'; });
glossDropZone.addEventListener('drop', e => { e.preventDefault(); glossDropZone.style.borderColor = '#dadce0'; handleGlossaryFile(e.dataTransfer.files[0]); });
glossFileInput.addEventListener('change', () => { if (glossFileInput.files[0]) handleGlossaryFile(glossFileInput.files[0]); });
document.getElementById('btn-save-settings').addEventListener('click', () => saveSettingsUI());
document.getElementById('btn-clear-tm').addEventListener('click', () => clearAllTM());
document.getElementById('btn-clear-gloss').addEventListener('click', () => clearAllGlossary());

// Rules
document.getElementById('btn-add-rule').addEventListener('click', () => addRule());
document.getElementById('rule-paste-zone').addEventListener('paste', (e) => {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  processRulesText(text);
  e.target.textContent = 'Ctrl+V';
});
document.getElementById('btn-export-rules').addEventListener('click', () => exportRulesTSV());

// File drop zone
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = '#1a73e8'; });
dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = '#dadce0'; });
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.style.borderColor = '#dadce0'; handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

// ============================================================
// Tools tab — QC + Search & Replace
// ============================================================

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function jumpToTMRow(idx) {
  // Switch to the TM tab and scroll the list into view; the existing
  // tm-list rendering handles its own click → cell focus, so this is
  // just a navigation hop.
  const tmTab = document.querySelector('.tab[data-panel="tm"]');
  if (tmTab) tmTab.click();
  // Force the filter to a unique fragment so the targeted row is
  // visible in a small tm-list. Scope it to one record by source.
  const e = tmData[idx];
  if (e) {
    const filt = document.getElementById('tm-filter');
    if (filt) { filt.value = e.source; filt.dispatchEvent(new Event('input')); }
  }
}

// Toggle-button helpers — the QC type filters are <button data-on="..">
// rather than checkboxes, so the user gets the same visual language as
// the Run QC primary button instead of a tiny browser checkbox.
function toggleOn(id) { return document.getElementById(id).dataset.on === 'true'; }
function wireQcToggle(id) {
  const el = document.getElementById(id);
  el.addEventListener('click', () => {
    el.dataset.on = el.dataset.on === 'true' ? 'false' : 'true';
  });
}

const QC_RENDER_CAP = 200;

// Build a per-side list of {start, end, type, tip} ranges for an
// issue list. cmpLen-folding ensures full-width / case variants in
// source/target still find the literal needle from the engine.
function _findAllOccurrences(text, needle) {
  if (!text || !needle) return [];
  const folded = FelixEngine.cmpLen(text);
  const target = FelixEngine.cmpLen(needle);
  const out = [];
  let pos = 0;
  while (true) {
    const idx = folded.indexOf(target, pos);
    if (idx === -1) break;
    out.push({ start: idx, end: idx + needle.length });
    pos = idx + Math.max(1, needle.length);
  }
  return out;
}

function _collectRanges(text, issues, side) {
  const ranges = [];
  for (const x of issues) {
    if (x.type === 'number') {
      // Highlight on the side where the digit actually lives — the
      // other side is the gap. Tip = direction only; the value itself
      // is already visible in the highlighted span.
      const wantSide = x.side === 'target' ? 'source' : 'target';
      if (side !== wantSide) continue;
      const tip = x.side === 'target' ? '訳文に無し' : '原文に無し';
      for (const o of _findAllOccurrences(text, x.value)) {
        ranges.push({ ...o, type: 'number', tip });
      }
    } else if (x.type === 'allcaps') {
      if (side !== 'source') continue;
      for (const o of _findAllOccurrences(text, x.word)) {
        ranges.push({ ...o, type: 'allcaps', tip: '訳文に無し' });
      }
    } else if (x.type === 'glossary') {
      // Tip = just the registered translation. The user already sees
      // the source-side term in the highlight; what they need from
      // hover is "what should appear in target."
      if (side !== 'source') continue;
      for (const o of _findAllOccurrences(text, x.term)) {
        ranges.push({ ...o, type: 'glossary', tip: x.translation });
      }
    }
  }
  // Sort and drop overlaps (keep the earlier-starting one — usually
  // glossary terms are longer than number/caps so this is fine).
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  let lastEnd = 0;
  for (const r of ranges) {
    if (r.start < lastEnd) continue;
    kept.push(r);
    lastEnd = r.end;
  }
  return kept;
}

function _renderWithRanges(text, ranges) {
  if (!text) return '';
  if (!ranges.length) return escHtml(text);
  let out = '', cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) out += escHtml(text.slice(cursor, r.start));
    out += '<span class="qc-mark" data-type="' + r.type + '" data-tip="' + escHtml(r.tip) + '">' + escHtml(text.slice(r.start, r.end)) + '</span>';
    cursor = r.end;
  }
  if (cursor < text.length) out += escHtml(text.slice(cursor));
  return out;
}

function buildIssueCard(rec, recIdx, issues) {
  const srcRanges = _collectRanges(rec.source || '', issues, 'source');
  const tgtRanges = _collectRanges(rec.target || '', issues, 'target');
  const div = document.createElement('div');
  div.className = 'match';
  div.dataset.tmidx = String(recIdx);
  div.innerHTML =
    '<div class="match-source" style="line-height:1.6">' + _renderWithRanges(rec.source || '', srcRanges) + '</div>' +
    '<div class="match-target" style="line-height:1.6">' + _renderWithRanges(rec.target || '', tgtRanges) + '</div>';
  return div;
}

// Yield to the event loop so the browser can repaint between chunks.
// setTimeout(0) is the lowest-overhead way to do this; rAF would
// couple our cadence to the display refresh, which we don't need.
function _yield() { return new Promise(r => setTimeout(r, 0)); }

let _qcRunning = false;
async function runQC() {
  if (_qcRunning) return;
  _qcRunning = true;

  const opts = {
    numbers: toggleOn('qc-numbers'),
    allCaps: toggleOn('qc-allcaps'),
    glossary: toggleOn('qc-glossary'),
  };
  const results = document.getElementById('qc-results');
  const summary = document.getElementById('qc-summary');
  const progress = document.getElementById('qc-progress');
  const progressText = document.getElementById('qc-progress-text');
  const progressBar = document.getElementById('qc-progress-bar');
  const btn = document.getElementById('btn-run-qc');

  results.innerHTML = '';
  summary.textContent = '';
  progress.style.display = 'block';
  progressBar.style.width = '0%';
  btn.disabled = true;
  btn.style.opacity = '0.6';

  try {
    const total = tmData.length;
    // 500-row chunks: small enough to keep the panel responsive on
    // mid-sized TMs, large enough that scheduler overhead stays under
    // ~5% of total runtime.
    const CHUNK = 500;
    const flagged = [];
    let totalIssues = 0;

    for (let start = 0; start < total; start += CHUNK) {
      const end = Math.min(start + CHUNK, total);
      for (let i = start; i < end; i++) {
        const rec = tmData[i];
        const issues = FelixEngine.qcCheck(rec, glossaryData, opts);
        if (!issues.length) continue;
        flagged.push({ recIdx: i, rec, issues });
        totalIssues += issues.length;
      }
      // Update progress and yield. The text shows the running issue
      // count too so the user gets two signals at once.
      const pct = Math.round((end / total) * 100);
      progressBar.style.width = pct + '%';
      progressText.textContent = `スキャン中… ${end} / ${total}` + (flagged.length ? `  (${flagged.length}行 問題あり)` : '');
      await _yield();
    }

    if (!flagged.length) {
      summary.textContent = t('qcClean');
      return;
    }

    // Cap visible rows — 9000+ DOM nodes makes the panel unusable.
    progressText.textContent = '結果を描画中…';
    await _yield();

    const frag = document.createDocumentFragment();
    const visible = Math.min(flagged.length, QC_RENDER_CAP);
    for (let k = 0; k < visible; k++) {
      const f = flagged[k];
      frag.appendChild(buildIssueCard(f.rec, f.recIdx, f.issues));
    }
    if (flagged.length > visible) {
      const more = document.createElement('div');
      more.style.cssText = 'text-align:center;color:#9aa0a6;padding:8px;font-size:12px';
      more.textContent = '… +' + (flagged.length - visible) + ' more rows hidden';
      frag.appendChild(more);
    }
    results.appendChild(frag);

    summary.textContent = t('qcCount')
      .replace('{n}', totalIssues)
      .replace('{rows}', flagged.length)
      + (flagged.length > visible ? '  ·  rendered ' + visible : '');
  } finally {
    progress.style.display = 'none';
    btn.disabled = false;
    btn.style.opacity = '1';
    _qcRunning = false;
  }
}

function srFind() {
  const expr = document.getElementById('sr-from').value;
  const list = document.getElementById('sr-results');
  const summary = document.getElementById('sr-summary');
  list.innerHTML = '';
  if (!expr) { summary.textContent = ''; return; }
  const hits = FelixEngine.searchAndReplace(tmData, expr);
  if (!hits.length) { summary.textContent = t('srNoMatch'); return; }
  for (const h of hits) {
    const div = document.createElement('div');
    div.className = 'match';
    div.style.cursor = 'pointer';
    div.innerHTML =
      '<div style="font-size:11px;color:#9aa0a6">[' + escHtml(h.matchField) + ']</div>' +
      '<div class="match-source">' + escHtml(h.source) + '</div>' +
      '<div class="match-target">' + escHtml(h.target) + '</div>';
    div.addEventListener('click', () => jumpToTMRow(h.tmIdx));
    list.appendChild(div);
  }
  summary.textContent = t('srFoundN').replace('{n}', hits.length);
}

function srReplaceAll() {
  const fromExpr = document.getElementById('sr-from').value;
  const toExpr = document.getElementById('sr-to').value;
  const summary = document.getElementById('sr-summary');
  if (!fromExpr) return;
  const result = FelixEngine.applyReplace(tmData, fromExpr, toExpr);
  saveTM();
  updateStats();
  renderTMList();
  summary.textContent = t('srReplacedN').replace('{n}', result.changed);
  // Refresh the find list so the user sees the post-replace state.
  srFind();
  showToast(t('srReplacedN').replace('{n}', result.changed));
}

document.getElementById('btn-run-qc').addEventListener('click', runQC);
document.getElementById('btn-sr-find').addEventListener('click', srFind);
document.getElementById('btn-sr-replace').addEventListener('click', srReplaceAll);
wireQcToggle('qc-numbers');
wireQcToggle('qc-allcaps');
wireQcToggle('qc-glossary');

// Init
init();
