/**
 * Felix TM - Google Sheets Translation Memory Plugin
 *
 * Core TM engine (Levenshtein fuzzy matching) ported from felix-tm Python.
 * Based on Felix CAT System by Ryan Ginstrom (MIT License).
 * https://github.com/ibushimaru/felix-tm
 */

// ============================================================
// i18n
// ============================================================

const I18N = {
  en: {
    menuOpen: 'Open Sidebar', menuLookup: 'TM Lookup (selected cell)',
    menuRegister: 'Register Selection to TM', menuBuild: 'Build TM from Sheet',
    menuHighlight: 'Highlight Glossary Terms', menuExport: 'Export Glossary to Sheet',
    menuSettings: 'Settings', menuLang: 'Language: English → 日本語',
    menuClearTM: 'Clear TM', menuShowTM: 'Show/Hide TM Sheet',
    buildConfirm: 'Build Translation Memory from all rows in the active sheet?',
    clearConfirm: 'Delete ALL entries from the Translation Memory? This cannot be undone.',
    emptySource: 'Source cell is empty.', emptyGlossary: 'Glossary is empty.',
    emptyBoth: 'Both source and target cells must have content.',
    noMatch: 'No matches found.', insertConfirm: 'Insert this translation?',
  },
  ja: {
    menuOpen: 'サイドバーを開く', menuLookup: 'TM検索（選択セル）',
    menuRegister: '選択行をTMに登録', menuBuild: 'シートからTMを構築',
    menuHighlight: '用語集ハイライト', menuExport: '用語集をシートにエクスポート',
    menuSettings: '設定', menuLang: 'Language: 日本語 → English',
    menuClearTM: 'TMを全削除', menuShowTM: 'TMシートの表示/非表示',
    buildConfirm: 'アクティブシートの全行からTMを構築しますか？',
    clearConfirm: 'TMの全エントリを削除しますか？この操作は元に戻せません。',
    emptySource: '原文セルが空です。', emptyGlossary: '用語集が空です。',
    emptyBoth: '原文セルと訳文セルの両方に内容が必要です。',
    noMatch: 'マッチが見つかりません。', insertConfirm: 'この訳文を挿入しますか？',
  },
};

function _t(key) {
  const lang = getSettings().lang || 'en';
  return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
}

// ============================================================
// Menu
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Felix TM')
    .addItem(_t('menuOpen'), 'showSidebar')
    .addSeparator()
    .addItem(_t('menuLookup'), 'tmLookupSelected')
    .addItem(_t('menuRegister'), 'registerSelectionToTM')
    .addItem(_t('menuBuild'), 'buildTMFromSheetPrompt')
    .addSeparator()
    .addItem(_t('menuHighlight'), 'highlightGlossaryTerms')
    .addItem(_t('menuExport'), 'exportGlossaryToSheet')
    .addSeparator()
    .addItem(_t('menuClearTM'), 'clearTMPrompt')
    .addSeparator()
    .addItem(_t('menuSettings'), 'showSettings')
    .addItem(_t('menuLang'), 'toggleLanguage')
    .addToUi();
}

// Fires on every cell selection change — writes source value to cache
function onSelectionChange(e) {
  try {
    const settings = getSettings();
    const sheet = e.range.getSheet();
    const srcCol = _colNum(settings.sourceCol);
    const val = String(sheet.getRange(e.range.getRow(), srcCol).getValue());
    CacheService.getDocumentCache().put('felix_current_source', val, 300);
  } catch (_) {}
}

// Lightweight read from cache — no sheet access, fast for polling
function pollCurrentSource() {
  return CacheService.getDocumentCache().get('felix_current_source') || '';
}

function showSidebar() {
  const tpl = HtmlService.createTemplateFromFile('Sidebar');
  // Embed ALL data + current source — zero server calls needed after open
  const all = loadAllData();
  all.tmCount = all.tm.length;
  all.glossaryCount = all.glossary.length;
  // Pre-fetch current source cell
  try {
    const settings = getSettings();
    const sheet = SpreadsheetApp.getActiveSheet();
    all.currentSource = String(sheet.getRange(
      sheet.getActiveCell().getRow(), _colNum(settings.sourceCol)
    ).getValue());
  } catch (e) { all.currentSource = ''; }
  tpl.initData = JSON.stringify(all);
  SpreadsheetApp.getUi().showSidebar(
    tpl.evaluate().setTitle('Felix TM').setWidth(380)
  );
}

function showSettings() {
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutputFromFile('Settings').setWidth(350).setHeight(350),
    _t('menuSettings')
  );
}

function toggleLanguage() {
  const s = getSettings();
  s.lang = s.lang === 'ja' ? 'en' : 'ja';
  saveSettings(s);
  onOpen();
}

// ============================================================
// Settings
// ============================================================

const DEFAULT_SETTINGS = {
  sourceCol: 'A', targetCol: 'B', minScore: 0.7, lang: 'en',
  tmSheetName: '_FelixTM', glossarySheetName: '_FelixGlossary',
};

let _settingsCache = null;

function getSettings() {
  if (_settingsCache) return _settingsCache;
  const saved = PropertiesService.getDocumentProperties().getProperty('felixSettings');
  _settingsCache = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };
  return _settingsCache;
}

function saveSettings(settings) {
  PropertiesService.getDocumentProperties().setProperty('felixSettings', JSON.stringify(settings));
  _settingsCache = settings;
  return settings;
}

function getLang() { return getSettings().lang || 'en'; }

// ============================================================
// Sheet Access
// ============================================================

let _ssCache = null;
function _ss() { return _ssCache || (_ssCache = SpreadsheetApp.getActiveSpreadsheet()); }
function _colNum(letter) { return letter.toUpperCase().charCodeAt(0) - 64; }

// TM Sheet columns (Felix record structure):
// A:source  B:target  C:context  D:source_cmp  E:refcount  F:reliability  G:validated  H:created  I:modified
const TM_COLS = { SOURCE: 1, TARGET: 2, CONTEXT: 3, CMP: 4, REFCOUNT: 5, RELIABILITY: 6, VALIDATED: 7, CREATED: 8, MODIFIED: 9 };
const TM_COL_COUNT = 9;
const TM_HEADERS = ['source', 'target', 'context', 'source_cmp', 'refcount', 'reliability', 'validated', 'created', 'modified'];

// Glossary Sheet columns:
// A:term  B:translation  C:notes  D:term_cmp
const GL_COL_COUNT = 4;
const GL_HEADERS = ['term', 'translation', 'notes', 'term_cmp'];

function _getTMSheet() {
  const name = getSettings().tmSheetName;
  let sheet = _ss().getSheetByName(name);
  if (!sheet) {
    sheet = _ss().insertSheet(name);
    sheet.getRange(1, 1, 1, TM_COL_COUNT).setValues([TM_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.setTabColor('#999999');
  }
  // Migration: old sheets may have fewer columns
  if (sheet.getLastColumn() < TM_COL_COUNT && sheet.getLastRow() >= 1) {
    const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headerRow.length < TM_COL_COUNT) {
      sheet.getRange(1, 1, 1, TM_COL_COUNT).setValues([TM_HEADERS]);
      // Backfill existing rows with defaults
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const fillCount = lastRow - 1;
        const now = new Date().toISOString();
        const defaults = Array.from({ length: fillCount }, () => [0, 0, '', now, now]);
        sheet.getRange(2, TM_COLS.REFCOUNT, fillCount, 5).setValues(defaults);
      }
    }
  }
  return sheet;
}

function _getGlossarySheet() {
  const name = getSettings().glossarySheetName;
  let sheet = _ss().getSheetByName(name);
  if (!sheet) {
    sheet = _ss().insertSheet(name);
    sheet.getRange(1, 1, 1, GL_COL_COUNT).setValues([GL_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.setTabColor('#999999');
  }
  return sheet;
}

// ============================================================
// Core: Text Normalization
// ============================================================

function makeCmp(text) {
  let s = text.replace(/<[^>]+>/g, '');
  s = s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  s = s.replace(/\u3000/g, ' ').toLowerCase();
  s = s.replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  return s.replace(/\s+/g, ' ').trim();
}

function containsCJK(text) { return /[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(text); }

// ============================================================
// Core: Levenshtein Edit Distance
// ============================================================

function editDistance(source, target, maxDistance) {
  let n = source.length, m = target.length;
  if (n === 0) return m; if (m === 0) return n;
  let prefix = 0;
  while (prefix < n && prefix < m && source[prefix] === target[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && source[n-1-suffix] === target[m-1-suffix]) suffix++;
  const s = source.substring(prefix, n - suffix), t = target.substring(prefix, m - suffix);
  const n2 = s.length, m2 = t.length;
  if (n2 === 0) return m2; if (m2 === 0) return n2;
  if (n2 === 1) return t.indexOf(s[0]) >= 0 ? m2 - 1 : m2;
  if (m2 === 1) return s.indexOf(t[0]) >= 0 ? n2 - 1 : n2;
  const [rows, cols] = n2 > m2 ? [t, s] : [s, t];
  const rl = rows.length, cl = cols.length;
  if (maxDistance === undefined) maxDistance = cl;
  const row = new Array(rl + 1);
  for (let i = 0; i <= rl; i++) row[i] = i;
  for (let j = 1; j <= cl; j++) {
    let prev = row[0]; row[0] = j; let rowMin = j;
    const cc = cols[j - 1];
    for (let i = 1; i <= rl; i++) {
      const temp = row[i];
      row[i] = Math.min(row[i] + 1, row[i-1] + 1, prev + (rows[i-1] === cc ? 0 : 1));
      prev = temp; if (row[i] < rowMin) rowMin = row[i];
    }
    if (rowMin > maxDistance) return maxDistance + 1;
  }
  return row[rl];
}

function editDistanceScore(source, target, minScore) {
  if (!source && !target) return 1.0;
  const highLen = Math.max(source.length, target.length);
  if (highLen === 0) return 1.0;
  const maxDist = Math.floor(highLen * (1.0 - (minScore || 0)));
  const dist = editDistance(source, target, maxDist);
  return dist > maxDist ? 0.0 : (highLen - dist) / highLen;
}

function bagDistance(source, target) {
  const freq = {};
  for (const ch of source) freq[ch] = (freq[ch] || 0) + 1;
  for (const ch of target) freq[ch] = (freq[ch] || 0) - 1;
  let diff = 0; for (const k in freq) diff += Math.abs(freq[k]);
  return diff;
}

// ============================================================
// Core: Fuzzy Match (Felix CAT faithful port)
// ============================================================

function _tokenize(text) {
  return text.split(/(\s+|[.,;:!?()"'\[\]{}<>])/).filter(t => t && !/^\s+$/.test(t));
}

function _wordLevelScore(query, source, minScore) {
  const qT = _tokenize(query), sT = _tokenize(source);
  if (!qT.length || !sT.length) return editDistanceScore(query, source, minScore);
  const n = qT.length, m = sT.length, highLen = Math.max(n, m);
  const row = new Array(n + 1);
  for (let i = 0; i <= n; i++) row[i] = i;
  for (let j = 1; j <= m; j++) {
    let prev = row[0]; row[0] = j;
    for (let i = 1; i <= n; i++) {
      const cost = 1.0 - editDistanceScore(qT[i-1], sT[j-1]);
      const temp = row[i];
      row[i] = Math.min(row[i] + 1, row[i-1] + 1, prev + cost);
      prev = temp;
    }
  }
  return Math.max(0, Math.min(1, highLen > 0 ? (highLen - row[n]) / highLen : 1));
}

function fuzzyMatchScore(queryCmp, sourceCmp, minScore) {
  if (queryCmp === sourceCmp) return 1.0;
  const qLen = queryCmp.length, sLen = sourceCmp.length, highLen = Math.max(qLen, sLen);
  if (highLen === 0) return 1.0;
  if ((highLen - (highLen - Math.min(qLen, sLen))) / highLen < minScore) return 0.0;
  if ((highLen - bagDistance(queryCmp, sourceCmp)) / highLen < minScore) return 0.0;
  const score = (containsCJK(queryCmp) || queryCmp.indexOf(' ') === -1)
    ? editDistanceScore(queryCmp, sourceCmp, minScore)
    : _wordLevelScore(queryCmp, sourceCmp, minScore);
  return score >= minScore ? score : 0.0;
}

// ============================================================
// TM Operations — Felix-faithful (refcount, dedup, delete)
// ============================================================

function _loadTMData() {
  const sheet = _getTMSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, TM_COL_COUNT).getValues();
  // Skip any row that looks like a header (source_cmp column = 'source_cmp')
  return data.filter(r => r[0] && String(r[0]) !== 'source' && String(r[3]) !== 'source_cmp');
}

/**
 * Add to TM with deduplication (Felix behavior).
 * If source+target already exist: increment refcount and update modified date.
 * If source exists with different target: add as new entry.
 * Otherwise: add new entry.
 */
function addToTM(source, target, context) {
  if (!source || !target) return { action: 'none' };

  const sheet = _getTMSheet();
  const lastRow = sheet.getLastRow();
  const sourceCmp = makeCmp(source);
  const targetCmp = makeCmp(target);
  const now = new Date().toISOString();

  // Check for existing duplicate
  if (lastRow > 1) {
    const data = sheet.getRange(2, 1, lastRow - 1, TM_COL_COUNT).getValues();
    for (let i = 0; i < data.length; i++) {
      const existCmp = data[i][TM_COLS.CMP - 1] || makeCmp(String(data[i][0]));
      if (existCmp === sourceCmp && makeCmp(String(data[i][1])) === targetCmp) {
        // Duplicate found — increment refcount, update modified date
        const row = i + 2;
        const oldRefcount = Number(data[i][TM_COLS.REFCOUNT - 1]) || 0;
        sheet.getRange(row, TM_COLS.REFCOUNT).setValue(oldRefcount + 1);
        sheet.getRange(row, TM_COLS.MODIFIED).setValue(now);
        return { action: 'refcount', refcount: oldRefcount + 1, row };
      }
    }
  }

  // New entry
  const nextRow = lastRow + 1;
  sheet.getRange(nextRow, 1, 1, TM_COL_COUNT).setValues([[
    source, target, context || '', sourceCmp,
    0,     // refcount
    0,     // reliability
    '',    // validated
    now,   // created
    now,   // modified
  ]]);
  return { action: 'added', row: nextRow };
}

/**
 * Bulk add with deduplication.
 * Uses in-memory dedup map for speed.
 */
function addToTMBulk(pairs) {
  if (!pairs || !pairs.length) return { added: 0, updated: 0 };

  const sheet = _getTMSheet();
  const lastRow = sheet.getLastRow();
  const now = new Date().toISOString();

  // Build existing index: key = sourceCmp + '|||' + targetCmp → row index
  const existingIndex = {};
  let existingData = [];
  if (lastRow > 1) {
    existingData = sheet.getRange(2, 1, lastRow - 1, TM_COL_COUNT).getValues();
    for (let i = 0; i < existingData.length; i++) {
      const sCmp = existingData[i][TM_COLS.CMP - 1] || makeCmp(String(existingData[i][0]));
      const tCmp = makeCmp(String(existingData[i][1]));
      existingIndex[sCmp + '|||' + tCmp] = i;
    }
  }

  const newRows = [];
  const refcountUpdates = []; // [{row, newRefcount}]
  let added = 0, updated = 0;

  for (const [source, target, context] of pairs) {
    const sCmp = makeCmp(source);
    const tCmp = makeCmp(target);
    const key = sCmp + '|||' + tCmp;

    if (key in existingIndex) {
      // Duplicate — queue refcount update
      const idx = existingIndex[key];
      const oldRef = Number(existingData[idx][TM_COLS.REFCOUNT - 1]) || 0;
      refcountUpdates.push({ row: idx + 2, refcount: oldRef + 1 });
      existingData[idx][TM_COLS.REFCOUNT - 1] = oldRef + 1; // update in-memory too
      updated++;
    } else {
      newRows.push([source, target, context || '', sCmp, 0, 0, '', now, now]);
      // Add to index to dedup within the batch itself
      existingIndex[key] = -1; // mark as seen
      added++;
    }
  }

  // Batch write new rows
  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, TM_COL_COUNT).setValues(newRows);
  }

  // Batch update refcounts
  for (const upd of refcountUpdates) {
    sheet.getRange(upd.row, TM_COLS.REFCOUNT).setValue(upd.refcount);
    sheet.getRange(upd.row, TM_COLS.MODIFIED).setValue(now);
  }

  return { added, updated, total: getTMCount() };
}

function deleteTMEntry(rowIndex) {
  // rowIndex is 0-based data index (row in sheet = rowIndex + 2)
  const sheet = _getTMSheet();
  sheet.deleteRow(rowIndex + 2);
  return { deleted: true };
}

function clearTMPrompt() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Clear TM', _t('clearConfirm'), ui.ButtonSet.YES_NO) === ui.Button.YES) {
    clearTM();
  }
}

function clearTM() {
  const sheet = _getTMSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  // Ensure header row is correct after clear
  sheet.getRange(1, 1, 1, TM_COL_COUNT).setValues([TM_HEADERS]);
  sheet.setFrozenRows(1);
}


function getTMCount() {
  return Math.max(0, _getTMSheet().getLastRow() - 1);
}

// ============================================================
// TM Lookup
// ============================================================

function tmLookup(query, minScore) {
  if (!query || !query.trim()) return [];
  if (minScore === undefined) minScore = getSettings().minScore;
  const queryCmp = makeCmp(query);
  const data = _loadTMData();
  const matches = [];

  for (let i = 0; i < data.length; i++) {
    const sourceCmp = data[i][TM_COLS.CMP - 1] || makeCmp(String(data[i][0]));
    const score = fuzzyMatchScore(queryCmp, sourceCmp, minScore);
    if (score >= minScore) {
      matches.push({
        score,
        source: data[i][0],
        target: data[i][1],
        context: data[i][2] || '',
        refcount: Number(data[i][TM_COLS.REFCOUNT - 1]) || 0,
        reliability: Number(data[i][TM_COLS.RELIABILITY - 1]) || 0,
        validated: !!data[i][TM_COLS.VALIDATED - 1],
        rowIndex: i,
      });
    }
  }

  // Sort: score desc, then refcount desc (Felix behavior)
  matches.sort((a, b) => b.score - a.score || b.refcount - a.refcount || b.reliability - a.reliability);
  return matches.slice(0, 20);
}

function tmLookupSelected() {
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  const query = String(sheet.getRange(row, _colNum(settings.sourceCol)).getValue());
  if (!query.trim()) { SpreadsheetApp.getUi().alert(_t('emptySource')); return; }
  const matches = tmLookup(query, settings.minScore);
  if (!matches.length) { SpreadsheetApp.getUi().alert(_t('noMatch')); return; }
  const top = matches[0];
  const pct = Math.round(top.score * 100);
  const ui = SpreadsheetApp.getUi();
  if (ui.alert(`TM Match: ${pct}%`,
    `Source: ${top.source}\nTarget: ${top.target}\n\n${_t('insertConfirm')}`,
    ui.ButtonSet.YES_NO) === ui.Button.YES) {
    sheet.getRange(row, _colNum(settings.targetCol)).setValue(top.target);
  }
}

function registerSelectionToTM() {
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  const maxCol = Math.max(_colNum(settings.sourceCol), _colNum(settings.targetCol));
  const vals = sheet.getRange(row, 1, 1, maxCol).getValues()[0];
  const source = String(vals[_colNum(settings.sourceCol) - 1]).trim();
  const target = String(vals[_colNum(settings.targetCol) - 1]).trim();
  if (!source || !target) { SpreadsheetApp.getUi().alert(_t('emptyBoth')); return; }
  addToTM(source, target);
}

function buildTMFromSheetPrompt() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Build TM', _t('buildConfirm'), ui.ButtonSet.YES_NO) === ui.Button.YES) {
    return buildTMFromSheet();
  }
}

function buildTMFromSheet() {
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { added: 0, updated: 0, total: 0 };
  const srcCol = _colNum(settings.sourceCol);
  const tgtCol = _colNum(settings.targetCol);
  const maxCol = Math.max(srcCol, tgtCol);
  const allData = sheet.getRange(2, 1, lastRow - 1, maxCol).getValues();
  const pairs = [];
  for (const row of allData) {
    const source = String(row[srcCol - 1]).trim();
    const target = String(row[tgtCol - 1]).trim();
    if (source && target) pairs.push([source, target, '']);
  }
  return addToTMBulk(pairs);
}

// ============================================================
// Glossary Operations
// ============================================================

function _loadGlossaryData() {
  const sheet = _getGlossarySheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, GL_COL_COUNT).getValues();
}

function addToGlossary(term, translation, notes) {
  if (!term || !translation) return;
  const sheet = _getGlossarySheet();
  const termCmp = makeCmp(term);

  // Dedup check
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const data = sheet.getRange(2, 1, lastRow - 1, GL_COL_COUNT).getValues();
    for (let i = 0; i < data.length; i++) {
      if ((data[i][3] || makeCmp(String(data[i][0]))) === termCmp &&
          makeCmp(String(data[i][1])) === makeCmp(translation)) {
        return { action: 'duplicate' };
      }
    }
  }

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, GL_COL_COUNT)
    .setValues([[term, translation, notes || '', termCmp]]);
  return { action: 'added' };
}

function deleteGlossaryEntry(rowIndex) {
  _getGlossarySheet().deleteRow(rowIndex + 2);
  return { deleted: true };
}

function getGlossaryTerms() {
  return _loadGlossaryData().map(r => ({ term: r[0], translation: r[1], notes: r[2] }));
}

function getGlossaryCount() { return Math.max(0, _getGlossarySheet().getLastRow() - 1); }

function highlightGlossaryTerms() {
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  const sourceCol = _colNum(settings.sourceCol);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { count: 0 };
  const terms = getGlossaryTerms();
  if (!terms.length) { SpreadsheetApp.getUi().alert(_t('emptyGlossary')); return { count: 0 }; }
  const termsLower = terms.map(t => t.term.toLowerCase());
  const sourceRange = sheet.getRange(2, sourceCol, lastRow - 1, 1);
  const sourceValues = sourceRange.getValues();
  const backgrounds = sourceRange.getBackgrounds();
  let count = 0;
  for (let i = 0; i < sourceValues.length; i++) {
    const text = String(sourceValues[i][0]).toLowerCase();
    if (termsLower.some(t => text.includes(t))) { backgrounds[i][0] = '#FFF2CC'; count++; }
  }
  sourceRange.setBackgrounds(backgrounds);
  return { count };
}

function exportGlossaryToSheet() {
  const terms = getGlossaryTerms();
  if (!terms.length) { SpreadsheetApp.getUi().alert(_t('emptyGlossary')); return { count: 0 }; }
  const ss = _ss();
  let exportSheet = ss.getSheetByName('Glossary Export');
  if (exportSheet) ss.deleteSheet(exportSheet);
  exportSheet = ss.insertSheet('Glossary Export');
  const rows = [['Term', 'Translation', 'Notes'], ...terms.map(t => [t.term, t.translation, t.notes])];
  exportSheet.getRange(1, 1, rows.length, 3).setValues(rows);
  exportSheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  exportSheet.autoResizeColumns(1, 3);
  ss.setActiveSheet(exportSheet);
  return { count: terms.length };
}

// ============================================================
// Sidebar API
// ============================================================

function sidebarInsertTranslation(target) {
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  const srcCol = _colNum(settings.sourceCol);
  const tgtCol = _colNum(settings.targetCol);
  const source = String(sheet.getRange(row, srcCol).getValue());

  // Write translation
  sheet.getRange(row, tgtCol).setValue(target);

  // Register to TM (with dedup)
  if (source) addToTM(source, target);

  // Move to next row
  const nextRow = row + 1;
  sheet.getRange(nextRow, srcCol).activate();
  return { nextSource: String(sheet.getRange(nextRow, srcCol).getValue()) };
}

function sidebarGetCurrentSource() {
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  return String(sheet.getRange(sheet.getActiveCell().getRow(), _colNum(settings.sourceCol)).getValue());
}

function getStats() {
  return { tmCount: getTMCount(), glossaryCount: getGlossaryCount(), lang: getLang() };
}

// ============================================================
// Benchmark — measure actual latency of different approaches
// ============================================================

/** Minimal no-op — measures pure google.script.run overhead */
function benchNoop() { return 1; }

/** Read from CacheService only */
function benchCache() { return CacheService.getDocumentCache().get('felix_current_source') || ''; }

/** Read from PropertiesService */
function benchProps() { return PropertiesService.getDocumentProperties().getProperty('felixSettings') ? 1 : 0; }

/** Read one cell */
function benchCell() {
  return String(SpreadsheetApp.getActiveSheet().getActiveCell().getValue());
}

/** Read one cell + write to cache */
function benchCellAndCache() {
  const val = String(SpreadsheetApp.getActiveSheet().getActiveCell().getValue());
  CacheService.getDocumentCache().put('felix_current_source', val, 300);
  return val;
}

/** Return all TM + glossary data for client-side search */
function loadAllData() {
  const tm = _loadTMData().map(r => [
    String(r[0]), String(r[1]), String(r[2] || ''), String(r[3] || ''),
    Number(r[TM_COLS.REFCOUNT - 1]) || 0,
    Number(r[TM_COLS.RELIABILITY - 1]) || 0,
  ]);
  const gl = _loadGlossaryData().map(r => [String(r[0]), String(r[1]), String(r[2] || '')]);
  return { tm, glossary: gl, lang: getLang() };
}
